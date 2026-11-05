/**
 * B09 — the bounded, deterministic, provider-neutral agent loop.
 *
 * The loop owns step/call budgets, tool discovery, provider-name→registry
 * resolution, input parsing, invocation dispatch, result normalization,
 * cancellation, cycle detection, and final-result construction. It never
 * touches provider SDK types (the adapter owns translation/continuation)
 * and never executes anything itself (the gateway owns authorization and
 * execution). Tool output is DATA: it returns to the provider as bounded,
 * redacted JSON with explicit success/failure status — never as
 * instructions, never as raw dumps, never with secrets or stack traces.
 *
 * No silent cross-provider fallback exists here: the selected provider is
 * explicit, and after any tool result or proposal artifact exists the run
 * can only complete or fail on that provider.
 */

import { sanitizeModelBoundText } from "./redaction"; // [B19-D I5e row 25]
import { normalizeToolArguments } from "./normalize-tool-arguments";
import { discoverTools } from "../engineering/tool-discovery";
import { grantedExecutionViolations } from "../engineering/granted-execution-families";
import { permissionTierOfDescriptor } from "../engineering/permission-tiers";
import type { ExecutionDecisionMode, PublicExecutionGrant } from "../engineering/execution-grant";
import { REPLAY_FAMILY } from "../engineering/execution-grant";
import type { ToolRegistry } from "../engineering/tool-registry";
import { resolveReadBinding } from "../engineering/tool-bindings-readonly";
import { resolveExternalReadBinding } from "./acquisition-reads"; // [B19-E E6]
import { resolveMcpObservationBinding } from "./mcp-observation-reads"; // [B20 A4]
import type { AgentTraceRecorder } from "./trace-recorder";
import type { ReadResourceKind } from "../engineering/resource-envelopes";
import { REPLACEMENT_PROPOSAL_SCHEMA } from "../engineering/replacement-proposals";
import { engineeringDigest } from "../engineering/stable";
import { LAYOUT_CANDIDATE_NOTE, PLACEMENT_INTENT_NOTE, placementReport, routingReport } from "./layout-report"; // [B18-E E17] what a candidate may say; [PR-F fE] + the intent's own note
import { LLMProviderError } from "../llm/errors";
import {
  buildAgentToolDeclarations,
  strictCompatibility,
} from "./provider-tools";
import type {
  AgentExecutionGrantMinter,
  AgentExecutionSettlement,
  AgentRunContext,
  ExternalToolAttribution,
  AgentRunEvent,
  AgentRunRequest,
  AgentRunResult,
  AgentStep,
  AgentToolInvocationGateway,
  AgentToolResult,
  ProviderAgentAdapter,
  ProviderToolDeclaration,
} from "./contracts";

/** [B18-E E3] The model transfer budget for one tool result, exported so a test can measure real results against it. */
export const MAX_RESULT_CHARS = 60_000;
const MAX_ARGUMENT_CHARS = 20_000;

export interface AgentLoopDeps {
  adapter: ProviderAgentAdapter;
  gateway: AgentToolInvocationGateway;
  registry: ToolRegistry;
  context: AgentRunContext;
  system: string;
  emit(event: AgentRunEvent): void;
  /** [B09.1] context-assembly warnings — emitted AFTER run_started so the
   *  protocol always begins with exactly one run_started event. */
  contextWarnings?: readonly string[];
  now?: () => number;
  /** [B11] optional injectable run-trace recorder. Recording is PASSIVE:
   *  it observes normalized events only and can never alter tool
   *  authorization, execution outcomes, or terminal semantics. */
  trace?: AgentTraceRecorder;
  /** [B18-B] the composition root's execution-grant minter. The loop uses
   *  it ONLY to await the browser's settlement of an execute_explicit grant
   *  (read from the durable record, never from the browser directly) and to
   *  retire this run's still-issued explicit grants when the run ends without
   *  them. Minting itself happens in the gateway. */
  executionGrants?: AgentExecutionGrantMinter; /** [B21 C] a specialist role's allowlist (A4L): buildRunToolset narrows to it after every gate; absent on every coordinator run (today's set) */ allowedToolIds?: readonly string[];
}

/**
 * [B19-D I5e row 25] every string in a tool result is cleaned before the model sees it (bounded walk, cycle-safe).
 * [B19-D I5e review] only the objects on the current path count as a cycle; an object shared by two branches is written in both.
 */
function modelSafe(value: unknown, depth = 0, ancestors = new Set<object>()): unknown {
  if (typeof value === "string") return sanitizeModelBoundText(value);
  if (!value || typeof value !== "object") return value;
  if (depth > 32 || ancestors.has(value)) return "[omitted]";
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => modelSafe(item, depth + 1, ancestors));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [sanitizeModelBoundText(key), modelSafe(item, depth + 1, ancestors)]));
  } finally {
    ancestors.delete(value);
  }
}

function resultText(payload: Record<string, unknown>): string {
  const text = JSON.stringify(modelSafe(payload));
  if (text.length <= MAX_RESULT_CHARS) return text;
  return JSON.stringify({ ok: false, status: "output_too_large_for_model", note: "The tool result exceeded the model transfer budget; ask a narrower question." });
}

/** [B10] the resource kinds the run's sealed bundle can actually supply —
 *  derived ONLY from verified context constituents (mirrors
 *  buildAgentResourceBundle; nothing is fabricated). */
export function availableResourceKinds(context: AgentRunContext): Set<ReadResourceKind> {
  const kinds = new Set<ReadResourceKind>();
  if (context.canonicalState && context.canonicalRevisionDigest) {
    kinds.add("canonical-state");
    kinds.add("drc-rules");
    kinds.add("drc-preset");
    kinds.add("fab-preset");
    if (context.selection) kinds.add("selection-snapshot");
    if (context.netlist) kinds.add("netlist");
    // [B13] the server-owned component-authority resource is available only
    // when the durable loader produced it (mirrors buildAgentResourceBundle).
    if (context.componentAuthority) kinds.add("component-authority-records");
    // [B17-F] the captured view context (and the timeline it carries).
    if (context.view) {
      kinds.add("view-state-snapshot");
      if (context.view.timeline) kinds.add("project-timeline-snapshot");
    }
  }
  return kinds;
}

/** [B18-C I4] What the model is told about a grant's intent — read from the server-bound record, never the model's own claim. */
function describeGrant(grant: PublicExecutionGrant, decision: ExecutionDecisionMode) {
  const b = grant.binding;
  return {
    family: b.operation.family,
    tier: b.operation.tier,
    decision,
    understood: { excerpt: b.instruction.excerpt, coverage: b.instruction.explicit.coverage },
    targets: { objectIds: [...b.targets.objectIds], netIds: [...b.targets.netIds], kinds: [...b.targets.kinds] },
    before: b.proposal.preview.before,
    after: b.proposal.preview.after,
    compileWarnings: [...b.proposal.preview.warnings],
  };
}

/** [B17-F] the layout proposals need ONLY a verified canonical board (no schematic head mark). */
const LAYOUT_PROPOSAL_TOOL_IDS = new Set(["sirkit.placement.propose", "sirkit.routing.propose", "sirkit.stackup.propose"]); // [PR-F fE, 2026-10-17] + the stackup / via-policy proposal: its basis is the verified canonical board too (never a schematic head mark)

/** Build the exact provider-exposed declaration subset for this run. */
export function buildRunToolset(registry: ToolRegistry, context: AgentRunContext, warn: (message: string) => void, allowedToolIds?: readonly string[]): {
  declarations: ProviderToolDeclaration[];
  resolve(providerName: string): { toolId: string; version: string } | null;
} {
  const discovery = discoverTools(registry, context.discovery);
  const descriptors = discovery.included
    .map((item) => registry.get(item.toolId, item.version))
    .filter((descriptor): descriptor is NonNullable<typeof descriptor> => descriptor !== undefined)
    // Defense in depth beyond discovery's channel gate.
    .filter((descriptor) => descriptor.agentExposed && descriptor.lifecycle === "active" && descriptor.callability === "callable")
    // [B09.1] a proposal tool without an authoritative basis cannot
    // scope-seal — it is withheld from the model entirely (fail closed).
    // [B15.3] the PCB proposal's basis is the verified canonical BOARD plus
    // the PCB history basis (head/lineage/active preset), never the
    // schematic head mark; the schematic proposals keep their B09.1 gate.
    .filter((descriptor) => {
      if (descriptor.operationClass !== "propose") return true;
      if (LAYOUT_PROPOSAL_TOOL_IDS.has(descriptor.toolId)) {
        if (!context.canonicalState?.pcb) {
          warn(`Tool ${descriptor.toolId} unavailable: no verified canonical board for this run.`);
          return false;
        }
        return true;
      }
      if (descriptor.toolId === "sirkit.pcb.propose-bounded-edit") {
        if (!context.canonicalState?.pcb || !context.pcbProposalBasis) {
          warn(`Tool ${descriptor.toolId} unavailable: no verified canonical board and PCB history basis for this run.`);
          return false;
        }
        return true;
      }
      if (!context.schematicHeadMark) {
        warn(`Tool ${descriptor.toolId} unavailable: no canonical schematic head mark for this run.`);
        return false;
      }
      return true;
    })
    // [B09.3/B10] resource satisfaction is part of the per-run toolset —
    // now GENERIC over each read binding's declared requiredResources: a
    // read is advertised only when the run's sealed resource bundle
    // contains EVERY resource its allowlisted B05/B05.1 binding requires
    // (optional resources stay optional). Proposal prerequisites remain
    // separate. A zero-tool conversational run is a truthful outcome; no
    // resource is ever fabricated to preserve tool count.
    .filter((descriptor) => {
      // [B18-C] a granted execution (a reviewed Tier 1 mutate tool) is
      // advertised ONLY to a run with an execution-grant minter, a verified
      // canonical board and a PCB history basis; the gateway re-derives all of
      // it per call. Any other mutation never reaches the model.
      if (descriptor.operationClass === "mutate") {
        if (grantedExecutionViolations(descriptor, registry.grantedExecutionTools()).length > 0) {
          warn(`Tool ${descriptor.toolId} unavailable: not a reviewed granted execution.`);
          return false;
        }
        if (!context.executionGrantsAvailable || !context.canonicalState?.pcb || !context.pcbProposalBasis) {
          warn(`Tool ${descriptor.toolId} unavailable: no execution-grant minter, verified canonical board and PCB history basis for this run.`);
          return false;
        }
        return true;
      }
      // [B17-F] a view-session tool is advertised only with a captured view
      // context (discovery already required its surface); no read binding.
      if (descriptor.operationClass === "view-session") {
        if (!context.view) {
          warn(`Tool ${descriptor.toolId} unavailable: no view context was captured for this run.`);
          return false;
        }
        return true;
      }
      if (resolveCadAcquisitionBinding(descriptor).state === "resolved") return cadAcquisitionToolAvailable(descriptor, context, warn); /* [PR-M, 2026-10-18] M2: the CAD acquisition start (propose class) and status (read) BEFORE the propose and read branches: a verified schematic and the server's acquisition fact, no board, no head-mark gate of a sealed edit */ if (resolveComponentResolutionBinding(descriptor).state === "resolved") return componentResolutionProposalAvailable(descriptor, context, warn); /* [PR-M, 2026-10-17] the component resolution batch: beside the head-mark gate above, the server's catalog and revision evidence facts (no board) */ if (resolveSheetOrganizationBinding(descriptor).state === "resolved") return sheetOrganizationProposalAvailable(descriptor, context, warn); /* [PR-J5, 2026-10-23] the organise proposal: beside the head-mark gate above, the server's catalog fact (the pins the planner proves over; no board) */ if (descriptor.operationClass === "propose") {
        // [B14] the replacement proposal additionally requires the
        // SERVER-OWNED component-authority resource for this run — without
        // it the tool is withheld entirely (fail closed, truthful reason).
        if (descriptor.toolId === "sirkit.schematic.propose-component-replacement"
          && !availableResourceKinds(context).has("component-authority-records")) {
          warn(`Tool ${descriptor.toolId} unavailable: required resource(s) component-authority-records cannot be supplied for this run.`);
          return false;
        }
        return true;
      }
      // [B20 A4] the external tool read (approved MCP servers) is advertised only when ITS allowlisted binding resolves, the server
      // bound the external tool port to this run (its own fact) and a verified canonical state exists
      if (resolveMcpObservationBinding(descriptor).state === "resolved") {
        if (context.mcpObservationAvailable !== true || !context.canonicalState || !context.canonicalRevisionDigest) {
          warn(`Tool ${descriptor.toolId} unavailable: no approved external tool server and verified canonical state for this run.`);
          return false;
        }
        return true;
      }
      // [B19-E E6] a bound external read is advertised only when its allowlisted binding resolves, the server bound an external
      // acquisition port to this run (the availability fact) and a verified canonical state exists; it has no B05 read binding.
      if (descriptor.binding.status === "bound-external-read") {
        if (resolveExternalReadBinding(descriptor).state !== "resolved") {
          warn(`Tool ${descriptor.toolId} unavailable: no resolved external read binding.`);
          return false;
        }
        if (context.externalAcquisitionAvailable !== true || !context.canonicalState || !context.canonicalRevisionDigest) {
          warn(`Tool ${descriptor.toolId} unavailable: no external acquisition source and verified canonical state for this run.`);
          return false;
        }
        return true;
      } if (descriptor.binding.status === "bound-computation") return computationReadAvailable(descriptor, context, warn); if (resolvePcbSyncPreflightBinding(descriptor).state === "resolved") return pcbSyncPreflightReadAvailable(descriptor, context, warn); if (resolveCatalogInspectionBinding(descriptor).state === "resolved") return catalogInspectionReadAvailable(descriptor, context, warn); if (resolveMissingFactsBinding(descriptor).state === "resolved") return missingFactsReadAvailable(descriptor, context, warn); if (resolveGenerationTaskInspectBinding(descriptor).state === "resolved") return generationTaskInspectAvailable(descriptor, context, warn); /* [PR-L, 2026-10-18] the durable task's Tier 0 inspection: its binding and the server's generation fact (no board) */ if (resolveInstanceInspectionBinding(descriptor).state === "resolved") return instanceInspectionReadAvailable(descriptor, context, warn); if (resolveCandidateSearchBinding(descriptor).state === "resolved") return candidateSearchReadAvailable(descriptor, context, warn); /* [PR-M, 2026-10-17] the schematic-instance inspection (a verified schematic, no board; the catalog optional) and the candidate search (the catalog, search and evidence facts) */ /* [PR-F] the missing-facts read: its own binding and a verified schematic snapshot, no board, no catalog needed */ // [B22-B] a named computation read: its own binding and the server's computation fact; [PR-D d2] the Schematic to PCB preflight read (its own binding and a verified schematic snapshot, no board) and the catalog inspection (its own binding and the server's catalog fact): neither has a B05 read binding
      const resolution = resolveReadBinding(descriptor);
      if (resolution.state !== "resolved") {
        warn(`Tool ${descriptor.toolId} unavailable: no resolved read binding.`);
        return false;
      }
      const available = availableResourceKinds(context);
      const missing = resolution.binding.requiredResources.filter((kind) => !available.has(kind));
      if (missing.length > 0) {
        warn(`Tool ${descriptor.toolId} unavailable: required resource(s) ${missing.join(", ")} cannot be supplied for this run.`);
        return false;
      }
      return true;
    })
    .filter((descriptor) => {
      const strict = strictCompatibility(descriptor);
      if (!strict.ok) warn(`Tool ${descriptor.toolId} excluded: schema is not wire-strict compatible.`);
      return strict.ok;
    });
  return buildAgentToolDeclarations(allowedToolIds === undefined ? descriptors : narrowToRunAllowlist(descriptors, allowedToolIds, warn)); // [B21 C] AFTER every gate above: it only narrows (OD-121)
}

export async function runAgentLoop(request: AgentRunRequest, deps: AgentLoopDeps): Promise<AgentRunResult> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const emit = deps.emit;
  const usage = { inputTokens: 0, outputTokens: 0 };
  let steps = 0;
  let toolCallsUsed = 0;
  let anyToolExecuted = false;
  let proposalIssued = false;
  let executionIssued = false;
  let completedNormally = false;
  const identicalCalls = new Map<string, number>();

  const trace = deps.trace;
  let terminalEmitted = false;
  const emitOnce = (event: AgentRunEvent): void => {
    // [B09.2] exactly ONE terminal event per run; nothing may follow it.
    if (terminalEmitted) return;
    if (event.type === "run_failed" || event.type === "run_completed") terminalEmitted = true;
    emit(event);
    // [B11] the trace mirrors the NORMALIZED event order. Recording is
    // wrapped so a recorder/sink defect can never change run behavior.
    try {
      if (event.type === "run_started") trace?.recordRunStarted();
      else if (event.type === "warning") trace?.recordWarning(event.message);
      else if (event.type === "run_completed") trace?.recordTerminal("completed", null);
      else if (event.type === "run_failed") trace?.recordTerminal(event.reason === "cancelled" ? "cancelled" : "failed", event.reason);
    } catch { /* passive observer: never affects authorization or outcome */ }
  };

  // [B09.1] run_started is ALWAYS the first event, exactly once; context
  // warnings follow it.
  emitOnce({ type: "run_started", runId: request.runId, provider: request.provider });
  for (const message of deps.contextWarnings ?? []) emitOnce({ type: "warning", runId: request.runId, message });
  const fail = (reason: string, message: string): AgentRunResult => {
    emitOnce({ type: "run_failed", runId: request.runId, reason, message });
    return { runId: request.runId, status: reason === "cancelled" ? "cancelled" : "failed", finalText: "", steps, toolCalls: toolCallsUsed, failureReason: reason };
  };
  // [B09.1] the overall run deadline is ENFORCED DURING awaits: a run-owned
  // AbortController composes the caller's cancellation signal with a
  // deadline timer, and the composed signal reaches every provider start/
  // continuation and gateway invocation. External cancellation and deadline
  // expiry stay deterministically distinguishable.
  const runController = new AbortController();
  let deadlineExpired = false;
  const deadlineTimer = setTimeout(() => { deadlineExpired = true; runController.abort(); }, request.budget.runDeadlineMs);
  const onExternalAbort = (): void => runController.abort();
  if (request.signal?.aborted) runController.abort();
  request.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const runSignal = runController.signal;
  const deadlineExceeded = (): boolean => deadlineExpired || now() - startedAt > request.budget.runDeadlineMs;

  // [B09.2] the deadline is HARD: every awaited operation races against the
  // run boundary, so a provider or gateway that ignores AbortSignal (or
  // resolves/rejects only after the deadline) can neither stall the run nor
  // land a late result. A boundary win discards the operation's eventual
  // settlement (its rejection is swallowed — never an unhandled rejection),
  // and every consumed result is re-checked against the terminal state.
  const BOUNDARY: unique symbol = Symbol("run-boundary");
  const guard = <T>(work: Promise<T>): Promise<T | typeof BOUNDARY> =>
    new Promise<T | typeof BOUNDARY>((resolve, reject) => {
      work.catch(() => undefined); // a late rejection is never unhandled
      if (runSignal.aborted) { resolve(BOUNDARY); return; }
      const onAbort = (): void => resolve(BOUNDARY);
      runSignal.addEventListener("abort", onAbort, { once: true });
      work.then(
        (value) => { runSignal.removeEventListener("abort", onAbort); resolve(runSignal.aborted ? BOUNDARY : value); },
        (error: unknown) => { runSignal.removeEventListener("abort", onAbort); if (runSignal.aborted) resolve(BOUNDARY); else reject(error); },
      );
    });
  const boundaryFailure = (): AgentRunResult =>
    deadlineExpired
      ? fail("deadline", "The run exceeded its overall deadline while an operation was pending.")
      : fail("cancelled", "The run was cancelled.");

  try {
    // [B09.2] a pre-aborted request never calls the provider.
    if (runSignal.aborted) return boundaryFailure();

    let toolset: ReturnType<typeof buildRunToolset>;
    try {
      toolset = buildRunToolset(deps.registry, deps.context, (message) => emitOnce({ type: "warning", runId: request.runId, message }), deps.allowedToolIds);
    } catch (error) {
      return fail("toolset_invalid", error instanceof Error ? error.message.slice(0, 300) : "Tool rendering failed.");
    }
    const firstStep = await guard(deps.adapter.start({
      system: deps.system,
      history: request.history,
      userMessage: request.userMessage,
      tools: toolset.declarations,
      signal: runSignal,
    }));
    if (firstStep === BOUNDARY) return boundaryFailure();
    let step: AgentStep = firstStep;

    for (;;) {
      // [B09.2] recheck the terminal state BEFORE consuming any step —
      // a normal result arriving after the deadline is discarded.
      if (runSignal.aborted || deadlineExceeded()) return boundaryFailure();
      steps += 1;
      usage.inputTokens += step.usage.inputTokens ?? 0;
      usage.outputTokens += step.usage.outputTokens ?? 0;
      // [B11] normalized step metadata only — never model text, never
      // provider continuation state.
      try { trace?.recordStep({ model: step.model, usage: step.usage, toolCallCount: step.toolCalls.length }); } catch { /* passive */ }
      // [B18-D I2] Rule 2 - model text never announces a change before it exists: a step that calls a side-effecting tool
      // (operationClass mutate - an execution grant - or propose - a sealed proposal or layout candidate) emits its text
      // only AFTER its calls resolved (after the settlement, the preview or the proposal), and never after a boundary
      // failure; every other step emits in place. Text beside a tool call is "interim"; the closing answer is "final".
      const textPhase: "interim" | "final" = step.toolCalls.length === 0 ? "final" : "interim";
      const holdText = step.toolCalls.some((toolCall) => {
        const resolvedCall = toolset.resolve(toolCall.providerName);
        const operationClass = resolvedCall ? deps.registry.get(resolvedCall.toolId, resolvedCall.version)?.operationClass : undefined;
        return operationClass === "mutate" || operationClass === "propose";
      });
      if (step.text && !holdText) emitOnce({ type: "text_delta", runId: request.runId, text: step.text, phase: textPhase });

      if (step.toolCalls.length === 0) {
        completedNormally = true;
        emitOnce({ type: "run_completed", runId: request.runId, finalText: step.text, steps, toolCalls: toolCallsUsed, usage, model: step.model });
        return { runId: request.runId, status: "completed", finalText: step.text, steps, toolCalls: toolCallsUsed };
      }
      if (steps >= request.budget.maxModelSteps) {
        return fail("max_steps", `The run exceeded the ${request.budget.maxModelSteps}-step budget while tools were still being requested.`);
      }

      // Deterministic sequential handling — every issued call receives a
      // result, in provider order (parallel tool calls are disabled at both
      // providers; a multi-call batch still resolves strictly in order).
      const results: AgentToolResult[] = [];
      for (const call of step.toolCalls) {
        const errorResult = (status: string, detail: string): AgentToolResult => ({
          callId: call.callId,
          outputText: resultText({ ok: false, status, detail }),
          isError: true,
        });
        // [B18-D I10] a call refused BEFORE it runs is also shown to the user, as an UNTRACED `tool_refused` event (the
        // model still receives the same error result; the run trace and the evaluation capsules are unchanged).
        const refuse = (status: string, detail: string, known: { toolId: string; title: string; tier: ReturnType<typeof permissionTierOfDescriptor> | null } | null): void => {
          emitOnce({ type: "tool_refused", runId: request.runId, callId: call.callId, toolId: known?.toolId ?? null, title: known?.title ?? null, tier: known?.tier ?? null, status });
          results.push(errorResult(status, detail));
        };

        const resolved = toolset.resolve(call.providerName);
        if (!resolved) {
          emitOnce({ type: "warning", runId: request.runId, message: `The model requested unknown tool "${call.providerName.slice(0, 80)}" — refused.` });
          refuse("unknown_tool", "No such tool is exposed in this run.", null);
          continue;
        }
        const descriptor = deps.registry.get(resolved.toolId, resolved.version);
        const title = descriptor?.title ?? resolved.toolId;
        const tier = descriptor ? permissionTierOfDescriptor(descriptor) : null; // [B18-D I2] display data on the tool events
        if (toolCallsUsed >= request.budget.maxToolCalls) {
          refuse("budget_exhausted", "The run's tool-call budget is exhausted; answer from the results you already have.", { toolId: resolved.toolId, title, tier });
          continue;
        }
        if (call.argumentsText.length > MAX_ARGUMENT_CHARS) {
          refuse("invalid_input", "Tool arguments exceeded the size limit.", { toolId: resolved.toolId, title, tier });
          continue;
        }
        let args: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(call.argumentsText === "" ? "{}" : call.argumentsText);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
          args = parsed as Record<string, unknown>;
        } catch {
          refuse("invalid_input", "Tool arguments were not a valid JSON object.", { toolId: resolved.toolId, title, tier });
          continue;
        }
        // Cycle detection: tool id/version + canonical argument digest.
        const normalized = descriptor ? normalizeToolArguments(args, descriptor.inputSchema) : { ok: false as const };
        if (!normalized.ok) {
          refuse("invalid_input", "Tool arguments must be bounded plain JSON.", { toolId: resolved.toolId, title, tier });
          continue;
        }
        const observed = deps.gateway.observedRevision ? await observedTaskRevision(deps.gateway, { runId: request.runId, provider: request.provider, toolId: resolved.toolId, version: resolved.version, args: normalized.args, context: deps.context, signal: runSignal }) : null; if (runSignal.aborted || deadlineExpired) return boundaryFailure(); /* the flag, never another clock read (a replay clock ticks per read) */ const plainKey = `${resolved.toolId}@${resolved.version}:${engineeringDigest({ args: normalized.args })}`; const cycleKey = observed === null ? plainKey : `${plainKey}#${observed}`; if (observed !== null) identicalCalls.set(plainKey, (identicalCalls.get(plainKey) ?? 0) + 1); // [K2, 2026-11-04] K1 case 3: a status read of a live task is keyed on the stored revision it would observe (the gateway's side-effect-free probe; null for every other tool, whose key is unchanged); the args-only count still counts every identical call, so a probe that fails later (null) is judged on ALL of them - never looser
        const seen = (identicalCalls.get(cycleKey) ?? 0) + 1;
        identicalCalls.set(cycleKey, seen);
        if (seen > request.budget.maxIdenticalCalls) {
          refuse("repeated_call", observed === null ? "This exact call already ran in this run; its result has not changed." : REPEATED_UNCHANGED_TASK_READ, { toolId: resolved.toolId, title, tier }); // [K2, 2026-11-04] the revision-keyed refusal says what was proved: the task is stored unchanged since the earlier identical reads
          continue;
        }
        // Proposal single-flight: never two proposal artifacts per run — a
        // provider/network retry can never double-issue a side-effecting call.
        // [B18-B] an execution grant is the run's ONE side-effecting artifact
        // too: after a grant no proposal is sealed and no second grant is
        // minted (execution_exists); after a proposal no grant is minted.
        const isProposal = descriptor?.operationClass === "propose";
        const isExecution = descriptor?.operationClass === "mutate";
        if (isProposal && (proposalIssued || executionIssued)) {
          refuse("proposal_exists", proposalIssued ? "A sealed proposal already exists for this run; ask the user to review it." : "An execution grant was already issued in this run; report its outcome before proposing more.", { toolId: resolved.toolId, title, tier });
          continue;
        }
        if (isExecution && (executionIssued || proposalIssued)) {
          refuse("execution_exists", executionIssued ? "An execution grant was already issued in this run; its outcome has not changed." : "A sealed proposal already exists for this run; nothing executes beside it.", { toolId: resolved.toolId, title, tier });
          continue;
        }

        toolCallsUsed += 1;
        emitOnce({ type: "tool_started", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier });
        // [B17-F] a long-running proposal (placement / routing engines) may use
        // its registered timeout up to the REMAINING run deadline — the run
        // boundary stays hard; every other tool keeps the per-tool budget.
        const remainingRunMs = Math.max(1_000, request.budget.runDeadlineMs - (now() - startedAt));
        const timeoutMs = descriptor?.budgetClass === "long-running"
          ? Math.min(descriptor.timeoutMs, remainingRunMs)
          : Math.min(request.budget.perToolTimeoutMs, descriptor?.timeoutMs ?? request.budget.perToolTimeoutMs);
        let outcome;
        try {
          const raced = await guard(deps.gateway.invoke({
            runId: request.runId,
            provider: request.provider,
            callId: call.callId,
            toolId: resolved.toolId,
            version: resolved.version,
            args,
            context: deps.context,
            timeoutMs,
            signal: runSignal,
          }));
          if (raced === BOUNDARY) return boundaryFailure();
          outcome = raced;
        } catch {
          outcome = { kind: "refused" as const, ok: false as const, toolId: resolved.toolId, status: "implementation_failed", diagnostics: ["The tool failed internally (details redacted)."] };
        }
        anyToolExecuted = true;
        // [B11] bounded metadata: identities, argument/output DIGESTS, the
        // closed-vocabulary outcome class, and the verification state.
        // [B20 A4] + external_observation, and `external`: an external tool call's attribution (identities and hashes, never content)
        const recordTrace = (outcomeClass: "read" | "proposal" | "proposal_blocked" | "refused" | "view_command" | "layout_candidate" | "execution_grant" | "external_observation", status: string, extra?: { verification?: string | null; output?: Record<string, unknown> | null; proposal?: { proposalId: string; operationsDigest: string } | null; external?: ExternalToolAttribution }): void => {
          try {
            trace?.recordTool({
              callId: call.callId, toolId: resolved.toolId, version: resolved.version,
              operationClass: descriptor?.operationClass ?? "unknown",
              args, outcomeClass, status,
              verification: extra?.verification ?? null,
              output: extra?.output ?? null,
              proposal: extra?.proposal ?? null,
              ...(extra?.external ? { external: extra.external } : {}),
            });
          } catch { /* passive */ }
        };
        if (outcome.kind === "read" && outcome.ok) {
          recordTrace("read", "succeeded", { verification: outcome.verification, output: outcome.output });
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: "succeeded" });
          results.push({
            callId: call.callId,
            outputText: resultText({ ok: true, tool: outcome.toolId, revision: outcome.sourceRevisionDigest, verification: outcome.verification, output: outcome.output }),
            isError: false,
          });
        } else if (outcome.kind === "external-observation" && outcome.ok) {
          // [B20 A4] an external tool read over an approved MCP server: the model gets the closed view (labels, and untrusted text
          // only under untrusted keys); a server-reported tool error is an error result the model may correct; the trace keeps the
          // attribution (identities and hashes) and the output digest only.
          recordTrace("external_observation", "succeeded", { verification: outcome.verification, output: outcome.output, external: outcome.external });
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: "succeeded" });
          results.push({
            callId: call.callId,
            outputText: resultText({ ok: !outcome.toolError, tool: outcome.toolId, revision: outcome.sourceRevisionDigest, verification: outcome.verification, output: outcome.output }),
            isError: outcome.toolError,
          });
        } else if (outcome.kind === "view-command" && outcome.ok) {
          // [B17-F] the browser executes the validated request on the user's
          // own view bus; the model learns only that it was dispatched. The
          // trace stores the request identity and the command id.
          const viewRequest = outcome.request;
          recordTrace("view_command", "view_command_dispatched", { verification: `expected view revision ${viewRequest.expectedViewRevision}`, output: { editor: viewRequest.editor, commandId: viewRequest.commandId, requestId: viewRequest.requestId } });
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: "view_command_dispatched" });
          emitOnce({ type: "view_command_ready", runId: request.runId, toolId: resolved.toolId, request: viewRequest });
          results.push({
            callId: call.callId,
            outputText: resultText({
              ok: true,
              status: "view_command_dispatched",
              dispatched: true,
              editor: viewRequest.editor,
              commandId: viewRequest.commandId,
              expectedViewRevision: viewRequest.expectedViewRevision,
              note: "The view command was handed to the user's editor, which applies it to the VIEW only (never the design). If the user's view changed since this run started, the editor may refuse it as stale; say what you asked the view to do, never that the design changed.",
            }),
            isError: false,
          });
        } else if (outcome.kind === "layout-candidate" && outcome.ok) {
          proposalIssued = true;
          // [B17-F] the shared candidate lands in the editor's review panel; the
          // trace stores its identity and content digest only.
          const candidate = outcome.candidate;
          recordTrace("layout_candidate", "layout_candidate_ready", { proposal: { proposalId: candidate.candidateId, operationsDigest: candidate.digest } });
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: "layout_candidate_ready" });
          emitOnce({ type: "layout_candidate_ready", runId: request.runId, toolId: resolved.toolId, candidate });
          // [B18-E E17] the model is handed what the candidate MEASURED, bounded: every placement objective's state (an
          // objective the engine could not evaluate is reported as unknown, never as met) and, for routing, the
          // unresolved connections themselves — which net, why, what blocked it, what to try — not only their count.
          // "Show me anything that failed" is the last clause of scenario 5's sentence, and it is answerable only from
          // these facts; without them the model could report a number and nothing else.
          const summary = candidate.kind === "placement"
            ? { kind: "placement", scope: candidate.scope.instanceIds === "all" ? "whole board" : `${candidate.scope.instanceIds.length} footprint(s)`, termination: candidate.run.termination, candidateCount: candidate.run.candidateCount, ...placementReport(candidate), ...(candidate.intent ? { intentNote: PLACEMENT_INTENT_NOTE } : {}) } // [PR-F fE] the intent's conflicts ride placementReport (bounded) with their own honesty note
            : { kind: "routing", scope: candidate.scope.netIds === "all" ? "every incomplete net" : `${candidate.scope.netIds.length} net(s)`, ...routingReport(candidate) };
          results.push({
            callId: call.callId,
            outputText: resultText({
              ok: true,
              status: "layout_candidate_ready",
              candidateId: candidate.candidateId,
              baseRevision: candidate.base.revision,
              expiresAt: candidate.expiresAt,
              ...summary,
              note: LAYOUT_CANDIDATE_NOTE,
            }),
            isError: false,
          });
        } else if (outcome.kind === "stackup-candidate" && outcome.ok) { proposalIssued = true; const stackup = outcome.candidate; recordTrace("proposal", "proposal_sealed", { proposal: { proposalId: stackup.candidateId, operationsDigest: stackup.digest } }); emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: "stackup_candidate_ready" }); emitOnce({ type: "stackup_candidate_ready", runId: request.runId, toolId: resolved.toolId, candidate: stackup }); results.push({ callId: call.callId, outputText: resultText({ ok: true, status: "stackup_candidate_ready", candidateId: stackup.candidateId, baseRevision: stackup.base.revision, expiresAt: stackup.expiresAt, current: { profileId: stackup.base.stackup.profileId, physicalLayerCount: stackup.base.stackup.physicalLayerCount, routableSignalLayerCount: stackup.base.stackup.routableSignalLayerCount }, recommendation: { profileId: stackup.recommendation.profileId, physicalLayerCount: stackup.recommendation.physicalLayerCount, routableSignalLayerCount: stackup.recommendation.routableSignalLayerCount, layers: stackup.recommendation.layers.map((layer) => ({ id: layer.id, role: layer.role, planeNet: layer.planeNet?.name ?? null })), manufacturing: { presetId: stackup.recommendation.manufacturing.presetId, copperLayerCount: stackup.recommendation.manufacturing.copperLayerCount, releaseQualified: stackup.recommendation.manufacturing.releaseQualified }, viaPolicy: { technology: stackup.recommendation.viaPolicy.technology, padstacks: stackup.recommendation.viaPolicy.padstacks.map((padstack) => ({ id: padstack.id, meetsManufacturingMinimum: padstack.meetsManufacturingMinimum })) } }, scope: stackup.scope, invalidation: { changesLayerCount: stackup.invalidation.changesLayerCount, changesProfile: stackup.invalidation.changesProfile, changesManufacturingPreset: stackup.invalidation.changesManufacturingPreset, dependentApprovalsInvalidated: stackup.invalidation.dependentApprovalsInvalidated }, notValidated: stackup.notValidated, note: "The stackup recommendation is a sealed candidate awaiting the user's review - NOTHING on the board has changed; the stackup is changed only through the PCB editor's Stackup selector. Tell the user the physical and the routable signal layer counts apart, whether the manufacturing profile is release-qualified, which via profiles meet the manufacturer's minimum, and that a different layer count or profile invalidates dependent approvals (DRC, export preflight, qualification re-run); never claim impedance, manufacturability or that it was applied." }), isError: false }); /* [PR-F fE] the stackup / via-policy candidate: its own event (as the layout candidate), the trace keeps identity and the content digest only, the model is told the recommendation's DATA (layer counts apart, qualification, via minima, invalidation), never a validation */
        } else if (outcome.kind === "execution-grant" && outcome.ok) {
          executionIssued = true;
          // [B18-B] the server-minted grant. The trace stores the grant identity
          // and the operations digest only; the model learns the decision and —
          // for execute_explicit — ONLY what the durable record says afterwards.
          const grant = outcome.grant;
          const explicit = outcome.decision === "execute_explicit";
          const issuedStatus = explicit ? "execution_grant_issued" : "execution_preview_issued";
          recordTrace("execution_grant", issuedStatus, { verification: `grant ${grant.grantId} (${outcome.decision}) expires ${grant.binding.expiresAt}`, proposal: { proposalId: grant.grantId, operationsDigest: grant.binding.proposal.operationsDigest } });
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: issuedStatus });
          emitOnce({ type: "execution_grant_ready", runId: request.runId, toolId: resolved.toolId, grant, decision: outcome.decision, note: outcome.note });
          if (!explicit) {
            results.push({
              callId: call.callId,
              outputText: resultText({
                ok: true,
                status: "execution_preview_issued",
                grantId: grant.grantId,
                ...describeGrant(grant, outcome.decision),
                expiresAt: grant.binding.expiresAt,
                confirmationRequired: true,
                preview: grant.binding.proposal.preview,
                ...(outcome.note ? { note: outcome.note } : {}),
                guidance: "The exact change is shown to the user for confirmation — NOTHING has changed. Tell the user to confirm or cancel it in the editor; never claim the edit happened.",
              }),
              isError: false,
            });
          } else {
            // Await the browser-attested settlement from the DURABLE record,
            // bounded by the settlement budget and the remaining run deadline.
            const waitMs = Math.max(0, Math.min(request.budget.executionSettlementTimeoutMs, request.budget.runDeadlineMs - (now() - startedAt)));
            let settled: AgentExecutionSettlement = { status: "unsettled", grant: null };
            if (deps.executionGrants) {
              try {
                const raced = await guard(deps.executionGrants.awaitSettlement(grant.grantId, { timeoutMs: waitMs, signal: runSignal }));
                if (raced === BOUNDARY) return boundaryFailure();
                settled = raced;
              } catch {
                settled = { status: "unsettled", grant: null };
              }
            }
            const settlement = settled.grant?.state.settlement ?? null;
            const retirement = settled.grant?.state.retirement ?? null;
            emitOnce({ type: "execution_settled", runId: request.runId, toolId: resolved.toolId, grantId: grant.grantId, status: settled.status, outcome: settlement?.outcome ?? null, reason: retirement?.reason ?? null, settlement: settlement ? { transactionId: settlement.transactionId, revisionBefore: settlement.revisionBefore, revisionAfter: settlement.revisionAfter, headSequenceAfter: settlement.headSequenceAfter, validations: settlement.validations, undoEligible: settlement.undoEligible } : null });
            // [B18-C / R18-7] the trace mirrors what the run learned from the DURABLE record, on the SAME call id.
            recordTrace("execution_grant", settled.status === "settled" && settlement ? `execution_settled:${settlement.outcome}` : `execution_settled:${settled.status}`, {
              verification: settled.status === "retired" ? `retired ${retirement?.reason ?? "unknown"}` : settlement?.transactionId ? `transaction ${settlement.transactionId}` : null,
              proposal: { proposalId: grant.grantId, operationsDigest: grant.binding.proposal.operationsDigest },
            });
            if (settled.status === "settled" && settlement?.outcome === "committed") {
              results.push({
                callId: call.callId,
                outputText: resultText({
                  ok: true,
                  status: "executed",
                  grantId: grant.grantId,
                  ...describeGrant(grant, outcome.decision),
                  transactionId: settlement.transactionId,
                  revisionBefore: settlement.revisionBefore,
                  revisionAfter: settlement.revisionAfter,
                  headSequenceAfter: settlement.headSequenceAfter,
                  changeSetDigest: settlement.changeSetDigest,
                  validations: {
                    drc: settlement.validations?.drc ?? { ran: false, violations: 0 },
                    attestation: settlement.validations?.drc.ran
                      ? "browser-attested: the user's editor ran its design rule check (the project's active preset) on the committed board; violations counts errors; copper zones are re-evaluated once the editor refills them; edit-time compile warnings are listed separately"
                      : "no design rule check was reported for this commit; do not claim the board passes DRC",
                  },
                  undo: {
                    eligible: settlement.undoEligible,
                    how: !settlement.undoEligible
                      ? "It is no longer the latest change (or undo is unavailable); the user reverts it from the revision history."
                      : grant.binding.operation.family === REPLAY_FAMILY
                        // [B18-C review 3] the user's Undo reverses THIS step: after an AI undo it re-applies the change, after an AI redo it removes it again.
                        ? grant.binding.proposal.replay?.direction === "redo"
                          ? "This redo is itself a new history entry: the editor's Undo (one step) reverses it — removing the change again — while it is still the latest change."
                          : "This undo is itself a new history entry: the editor's Undo (one step) reverses it — re-applying the change — while it is still the latest change."
                        : "The user can undo it with the editor's Undo (one step), or ask you to undo it, while it is still the latest change.",
                  },
                  note: "The user's editor committed exactly this change through its canonical session (one transaction, one undo entry). Say what changed, the DRC result and how to undo it; never call the board safe or manufacturing-ready.",
                }),
                isError: false,
              });
            } else if (settled.status === "settled" && settlement?.outcome === "poisoned") {
              // A transaction LANDED but could not be verified against the grant: the board may have changed. Never "nothing changed".
              results.push({ callId: call.callId, outputText: resultText({ ok: false, status: "execution_poisoned", grantId: grant.grantId, intended: grant.binding.proposal.preview.after, outcome: "poisoned", note: "A transaction LANDED in the user's editor under this grant but could NOT be verified against it; the board may have changed and this grant is permanently refused. Do NOT say nothing changed: tell the user to inspect the board and the revision history, undo the last AI transaction if it is wrong, and repeat the request if they still want it." }), isError: true });
            } else if (settled.status === "settled") {
              results.push({ callId: call.callId, outputText: resultText({ ok: false, status: "execution_not_committed", grantId: grant.grantId, intended: grant.binding.proposal.preview.after, outcome: settlement?.outcome ?? null, note: "The user's editor did NOT commit the change (it refused or the commit failed). Nothing changed; say so." }), isError: true });
            } else if (settled.status === "retired") {
              results.push({ callId: call.callId, outputText: resultText({ ok: false, status: "execution_retired", grantId: grant.grantId, intended: grant.binding.proposal.preview.after, reason: retirement?.reason ?? null, note: "The grant was retired before the change was committed. Nothing changed; say so and, if the user still wants it, ask them to repeat the request." }), isError: true });
            } else {
              // Still issued (never tendered) or consumed but unsettled: the run
              // does not wait longer. An untendered grant is retired so it can
              // never be spent after this run answered; a consumed one settles
              // late on its own and the record keeps the truth.
              if (settled.status === "unsettled" && deps.executionGrants) {
                try { await deps.executionGrants.retireIssued("run_unsettled", true); } catch { /* the grant expires lazily */ }
              }
              results.push({ callId: call.callId, outputText: resultText({ ok: false, status: "execution_unsettled", grantId: grant.grantId, intended: grant.binding.proposal.preview.after, note: "The user's editor did not report the outcome in time. Do NOT claim the change happened; tell the user to check the board and the revision history." }), isError: true });
            }
          }
        } else if (outcome.kind === "pcb-proposal" && outcome.ok) {
          proposalIssued = true;
          // [B15.3] the sealed bounded PCB edit — DISTINCT event, never the
          // schematic proposal_ready. The trace stores bounded identity and
          // digests only; the provider result text confirms zero mutation.
          const sealedPcb = outcome.proposal;
          recordTrace("proposal", "proposal_sealed", { proposal: { proposalId: sealedPcb.proposalId, operationsDigest: sealedPcb.operationsDigest } });
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: "proposal_sealed" });
          emitOnce({ type: "pcb_proposal_ready", runId: request.runId, toolId: resolved.toolId, proposal: sealedPcb });
          results.push({
            callId: call.callId,
            outputText: resultText({
              ok: true,
              status: "proposal_sealed",
              proposalId: sealedPcb.proposalId,
              operations: sealedPcb.operations.length,
              expiresAt: sealedPcb.expiresAt,
              note: "The sealed PCB proposal is awaiting explicit human review in the PCB editor — NOTHING has been changed. Tell the user to review and approve or cancel it; never claim the edit happened, and never call it safe or manufacturing-ready.",
            }),
            isError: false,
          });
        } else if (outcome.kind === "proposal" && outcome.ok) {
          proposalIssued = true;
          // [B14] discriminated proposal union: Tier-1 carries operations +
          // impacts; a replacement carries ONE operation + its impact plan.
          // The trace stores bounded identity/digests only, never content.
          const sealedProposal = outcome.proposal;
          const isReplacementProposal = sealedProposal.schema === REPLACEMENT_PROPOSAL_SCHEMA;
          const proposalDigest = isReplacementProposal ? sealedProposal.operationDigest : sealedProposal.operationsDigest;
          recordTrace("proposal", "proposal_sealed", { proposal: { proposalId: sealedProposal.proposalId, operationsDigest: proposalDigest } });
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: "proposal_sealed" });
          emitOnce({ type: "proposal_ready", runId: request.runId, toolId: resolved.toolId, proposal: sealedProposal });
          results.push({
            callId: call.callId,
            outputText: resultText({
              ok: true,
              status: "proposal_sealed",
              proposalId: sealedProposal.proposalId,
              baseSchematicDigest: sealedProposal.baseSchematicDigest,
              operations: isReplacementProposal ? 1 : sealedProposal.operations.length,
              destructive: isReplacementProposal ? true : sealedProposal.impacts.destructive,
              note: "The proposal is awaiting explicit user review — NOTHING has been changed. Tell the user to review and apply it; never claim the edit happened.",
            }),
            isError: false,
          });
        } else if (outcome.kind === "generation-task" && outcome.ok) { proposalIssued = true; const reference = outcome.task; const taskStatus = reference.disposition === "started" ? "task_started" : "task_attached"; recordTrace("proposal", taskStatus, { proposal: { proposalId: reference.taskId, operationsDigest: generationTaskReferenceDigest(reference) } }); emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: taskStatus }); emitOnce({ type: "generation_task_ready", runId: request.runId, toolId: resolved.toolId, task: reference }); results.push({ callId: call.callId, outputText: resultText({ ok: true, status: taskStatus, taskId: reference.taskId, disposition: reference.disposition, sameRequest: reference.sameRequest, state: reference.state, phase: reference.phase, origin: reference.origin, liveness: reference.liveness, result: reference.result, durability: reference.durability, note: reference.disposition === "attached-active" ? (reference.state === "awaiting-review" ? "The previous design for this project has FINISHED (it was not started for this message): its result is waiting in the schematic review dialog. Nothing new was started and nothing has been changed. Tell the user to approve or discard that result there before asking for a new design; Stop design does not apply to it." : reference.state === "cancel-requested" ? "A design for this project is already STOPPING (it was not started for this message): nothing new was started and nothing has been changed. Tell the user it is being stopped; they can ask for a new design once it has stopped." : "A design was ALREADY running for this project (it was not started for this message): the page follows THAT task; nothing new was started and nothing has been changed. Tell the user so; they can stop it (Stop design) before asking for a new design.") /* [PR-L/M integration, 2026-10-18] L5-2: the attached task's REAL state picks the note - a finished design waiting for review is not running and Stop design does not apply to it (the store refuses cancel from awaiting-review); one being cancelled is stopping */ : `The design runs as a durable task in a generation worker, NOT inside this chat turn: this turn ending, or the user pressing Stop answer, does not stop it (Stop design does). The page shows its live status and offers its result in the schematic review dialog, where only the user approves it; NOTHING has been changed. Never claim the design is finished or applied; use sirkit.generation.task-inspect in a later turn to report its real state.${reference.durability === "process-memory" ? " This server keeps tasks in memory: a server restart loses it." : ""}` }), isError: false }); /* [PR-L, 2026-10-18] runbook L.5: the durable generation task (generate-proposal@2.0.0): its OWN event carries the task reference (the page follows it with the same status card and review intake as a Build start), the trace keeps the task id and the reference digest only, the model is told the task's real state and that the turn is not the task (a start or an attach is the run's one side-effecting artifact, as a proposal) */ } else if (outcome.kind === "acquisition-task" && outcome.ok) { const reference = outcome.task; const taskStatus = reference.disposition === "started" ? "acquisition_task_started" : "acquisition_task_attached"; recordTrace("read", taskStatus, { verification: outcome.verification, output: outcome.output }); emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: taskStatus }); emitOnce({ type: "acquisition_task_ready", runId: request.runId, toolId: resolved.toolId, callId: call.callId, task: reference }); results.push({ callId: call.callId, outputText: resultText({ ok: true, tool: outcome.toolId, revision: outcome.sourceRevisionDigest, verification: outcome.verification, output: outcome.output }), isError: false }); /* [K2, 2026-11-04] runbook K.2 (OD-260 item 6): the durable acquisition task's start or attach - the model gets the SAME result text a read gave it (no contract change), the trace the read's class with the task's own status, and the page the typed reference on its own event (it follows the task's stored progress in the Work log); not the run's one side-effecting artifact (as before: a start mutates no design) */ } else if (outcome.kind === "generation-task-control" && outcome.ok) { proposalIssued = true; const control = outcome.request; recordTrace("proposal", "control_requested", { proposal: { proposalId: control.requestId, operationsDigest: engineeringDigest({ schema: control.schema, requestId: control.requestId, taskId: control.taskId, action: control.action }) } }); emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: "control_requested" }); emitOnce({ type: "generation_task_control_ready", runId: request.runId, toolId: resolved.toolId, request: control }); results.push({ callId: call.callId, outputText: resultText({ ok: true, status: "control_requested", requestId: control.requestId, taskId: control.taskId, action: control.action, blockId: control.blockId, label: control.label, stateAtRequest: control.stateAtRequest, note: `The request "${control.label}" is a chip awaiting the user's confirmation - NOTHING has happened to the design yet. Tell the user to confirm it (or dismiss it) on the chip; never claim the design was stopped, paused, resumed or retried.` }), isError: false }); /* [PR-L, 2026-10-18] runbook L.5 (OD-252 item 6): a sealed control request rides its own event to the page's confirm chip; only the human's click calls the control route, under the human's authorization; the model is told nothing happened yet */ } else if (outcome.kind === "draft-request-proposal" && outcome.ok) { proposalIssued = true; const sealedDraft = outcome.proposal; recordTrace("proposal", "proposal_sealed", { proposal: { proposalId: sealedDraft.proposalId, operationsDigest: sealedDraft.requestDigest } }); emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: "proposal_sealed" }); emitOnce({ type: "draft_request_ready", runId: request.runId, toolId: resolved.toolId, proposal: sealedDraft }); results.push({ callId: call.callId, outputText: resultText({ ok: true, status: "proposal_sealed", proposalId: sealedDraft.proposalId, baseSchematicDigest: sealedDraft.baseSchematicDigest, verification: sealedDraft.verification, instance: sealedDraft.instance, profile: sealedDraft.draftRequest.profile, documentedFacts: sealedDraft.documented.length, missing: sealedDraft.missing, pcbAssignment: sealedDraft.pcbAssignment, catalogCrossCheck: sealedDraft.catalogCrossCheck, reviewTask: sealedDraft.reviewTask, note: "The draft request is a sealed UNVERIFIED review task awaiting a human - NOTHING has been changed, published or verified. Tell the user which facts are documented, which are missing, and that PCB assignment stays blocked until the human review, the publication and the deterministic mapping checks pass; never claim the part exists, is approved or is assignable." }), isError: false }); /* [PR-F] the part draft request: its own event (as the generation proposal), the trace keeps identity and the request digest only, the model is told the facts' DATA (documented count, the missing list, the PCB-assignment blockers, the human path), never a verification */ } else if (outcome.kind === "module-contract-proposal" && outcome.ok) { proposalIssued = true; const sealedContracts = outcome.proposal; const set = sealedContracts.contractSet; recordTrace("proposal", "proposal_sealed", { proposal: { proposalId: sealedContracts.proposalId, operationsDigest: sealedContracts.contractDigest } }); emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: "proposal_sealed" }); emitOnce({ type: "module_contracts_ready", runId: request.runId, toolId: resolved.toolId, proposal: sealedContracts }); results.push({ callId: call.callId, outputText: resultText({ ok: true, status: "proposal_sealed", proposalId: sealedContracts.proposalId, baseSchematicDigest: sealedContracts.baseSchematicDigest, verification: sealedContracts.verification, electricalCheck: sealedContracts.electricalCheck, modules: set.modules.map((module) => ({ id: module.id, components: module.components.map((component) => component.refDes), ports: module.ports.length, requirements: module.requirements.length, unknown: module.unknown, partAuthorityGaps: module.partAuthorityGaps })), constraints: set.constraints.map((constraint) => ({ id: constraint.id, kind: constraint.kind, net: constraint.net, modules: constraint.modules, loading: constraint.loading?.state ?? null })), coverage: set.coverage, partAuthority: set.partAuthority.filter((row) => row.state === "unresolved"), reviewTask: sealedContracts.reviewTask, note: "The module contracts are a sealed engineering note awaiting the human's review in the run log - NOTHING has been changed, verified electrically or approved. Tell the user which modules own which components, which interfaces are stated, which facts stay unknown and which parts lack published authority; never claim the circuit passes, that a module is verified, or that a part is PCB-assignable." }), isError: false }); /* [PR-F fD] the module contracts: their own event (as the draft request), the trace keeps identity and the contract digest only, the model is told the set's DATA (modules, owned references, stated interfaces, unknowns, part-authority gaps, coverage), never a verification */ } else if (outcome.kind === "resolution-proposal" && outcome.ok) { proposalIssued = true; const sealedResolution = outcome.proposal; recordTrace("proposal", "proposal_sealed", { proposal: { proposalId: sealedResolution.proposalId, operationsDigest: sealedResolution.operationsDigest } }); emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: "proposal_sealed" }); emitOnce({ type: "component_resolution_ready", runId: request.runId, toolId: resolved.toolId, proposal: sealedResolution }); results.push({ callId: call.callId, outputText: resultText({ ok: true, status: "proposal_sealed", proposalId: sealedResolution.proposalId, baseSchematicDigest: sealedResolution.baseSchematicDigest, items: sealedResolution.impact.items.map((item) => ({ componentId: item.componentInstanceId, refDes: item.refDes, from: { partId: item.current.partId, missing: item.current.missing }, to: { catalogPartId: item.target.catalogPartId, exactMpn: item.target.exactMpn, manufacturer: item.target.manufacturer, atomicPartRevisionId: item.target.atomicPartRevisionId, footprint: item.target.footprintFullName }, mode: item.mode, permutation: item.permutation, mapping: item.mapping.map((entry) => `${entry.fromPin}->${entry.toPin} (${entry.function})`), netsKept: item.nets.map((entry) => `${entry.pin}:${entry.net}`), equivalence: item.equivalence, warnings: item.warnings })), connectivity: "the sheet's net partition is unchanged (proved over the server catalog pins)", note: "The resolution is a sealed batch awaiting explicit human review - NOTHING has been changed. Tell the user which instances would be bound to which exact parts and revisions, the material warnings, and that the change happens only when they review and apply it; never claim it was applied, that the parts are verified electrically equivalent, or that the PCB is prepared." }), isError: false }); /* [PR-M, 2026-10-17] the component resolution batch: its own event (as the draft request), the trace keeps identity and the operations digest only, the model is told the batch's DATA (identities, the proved mapping, the kept nets, the warnings), never that anything changed */ } else if (outcome.kind === "sheet-organization-proposal" && outcome.ok) { proposalIssued = true; const sealedOrganization = outcome.proposal; recordTrace("proposal", "proposal_sealed", { proposal: { proposalId: sealedOrganization.proposalId, operationsDigest: sealedOrganization.operationsDigest } }); emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: true, status: "proposal_sealed" }); emitOnce({ type: "sheet_organization_ready", runId: request.runId, toolId: resolved.toolId, proposal: sealedOrganization }); results.push({ callId: call.callId, outputText: resultText({ ok: true, status: "proposal_sealed", proposalId: sealedOrganization.proposalId, baseSchematicDigest: sealedOrganization.baseSchematicDigest, sheets: sealedOrganization.groups.map((group) => ({ name: group.name, sheetId: group.sheetId, members: group.members.map((member) => member.refDes) })), interfaces: sealedOrganization.interfaces.map((item) => ({ port: item.portName, net: item.net, sheet: item.childSheetName, ...(item.defaultName !== null && item.defaultName !== item.portName ? { renamedFrom: item.defaultName } : {}) })), unassigned: sealedOrganization.unassigned, checkThese: sealedOrganization.checkThese.slice(0, 10).map((check) => check.reason), renamedNets: sealedOrganization.renamedNets.map((item) => `${item.from} -> ${item.to ?? "(unnamed)"}`), equivalence: "the project pin-to-net partition and every component identity are unchanged (proved by the organise planner over the catalog pins)", operations: sealedOrganization.operationCount, note: "The organisation is a sealed proposal awaiting the user's review - NOTHING has been changed. Tell the user which parts go to which sheet, which interfaces (ports) carry the connections between the sheets, which parts stay on the overview and which placements to check; the sheets are created only when they review and approve it (one undoable transaction); never claim the schematic was organised." }), isError: false }); /* [PR-J5, 2026-10-23] the organise proposal: its own event (as the component resolution batch), the trace keeps identity and the operations digest only, the model is told the plan's DATA (sheets, members, interfaces, unassigned parts, check-these), never that anything changed */ } else if (outcome.kind === "proposal-blocked") {
          recordTrace("proposal_blocked", "proposal_blocked"); // the TRACE keeps carrying the code only — never content
          // [B18-E E12] the user is told WHY, in the compiler's own words: the first blocker's detail rides the display
          // event (the model already receives every blocker below). Without it the chat showed a bare code and the human
          // depended on the model's prose for the reason the change could not be prepared.
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: false, status: "proposal_blocked", ...(outcome.blockers[0]?.detail ? { reason: outcome.blockers[0].detail } : {}) });
          results.push({
            callId: call.callId,
            outputText: resultText({ ok: false, status: "proposal_blocked", blockers: outcome.blockers.slice(0, 10) }),
            isError: true,
          });
        } else if (outcome.kind === "refused") {
          recordTrace("refused", outcome.status, outcome.external ? { external: outcome.external } : undefined); // [B20 A4] attribution when the port was asked
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: false, status: outcome.status });
          results.push({
            callId: call.callId,
            outputText: resultText({ ok: false, status: outcome.status, diagnostics: outcome.diagnostics.slice(0, 5) }),
            isError: true,
          });
        } else {
          recordTrace("refused", "invalid_outcome");
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, tier, ok: false, status: "invalid_outcome" });
          results.push(errorResult("invalid_outcome", "The tool returned an unrecognized outcome shape."));
        }
        if (runSignal.aborted || deadlineExceeded()) return boundaryFailure();
      }

      if (step.text && holdText) emitOnce({ type: "text_delta", runId: request.runId, text: step.text, phase: "interim" });
      const nextStep = await guard(deps.adapter.continueWith({
        continuation: step.continuation,
        results,
        tools: toolset.declarations,
        signal: runSignal,
      }));
      if (nextStep === BOUNDARY) return boundaryFailure();
      step = nextStep;
    }
  } catch (error) {
    if (deadlineExpired) return fail("deadline", "The run exceeded its overall deadline while a provider or tool call was pending.");
    if (request.signal?.aborted) return fail("cancelled", "The run was cancelled.");
    if (error instanceof LLMProviderError) {
      // Structured, redacted provider failure — reason stays actionable,
      // upstream bodies/credentials never surface. NOTE: no fallback here —
      // once any tool result or proposal exists the run never restarts on
      // another provider.
      void anyToolExecuted;
      return fail(`provider_${error.reason}`, error.message.slice(0, 300));
    }
    return fail("internal_error", "The agent run failed internally (details redacted).");
  } finally {
    // [B09.1] deterministic cleanup on EVERY exit path.
    clearTimeout(deadlineTimer);
    request.signal?.removeEventListener("abort", onExternalAbort);
    // [B18-B] a run that ends without completing (cancelled, deadline,
    // provider or internal failure) retires its still-issued explicit grants
    // so an abandoned run's grant can never be spent later; preview grants
    // stay for the human to confirm or cancel.
    // Not gated on a consumed outcome: a grant minted while the run boundary discarded the gateway's answer is still this
    // minter's grant, and retireIssued is a no-op when nothing was minted.
    if (!completedNormally && deps.executionGrants) {
      try { await deps.executionGrants.retireIssued("run_cancelled", true); } catch { /* the grant expires lazily */ }
    }
  }
}

/** [B21 C] The largest role allowlist a run accepts: the A4L bound (the orchestration contracts bound a request's list the same). */
export const RUN_ALLOWLIST_MAX_IDS = 32;

/**
 * [B21 C] The A4L judgement of a run allowlist (OD-121): the ids it approves, or null when it approves NOTHING. Sound is an array
 * of at most RUN_ALLOWLIST_MAX_IDS ids, strictly ascending (sorted, duplicate-free), every id in the exposure list and matching no
 * never-exposed pattern; anything else - or a list that throws while it is read - is null, never a truncated or partly read list.
 * An empty list is sound and approves nothing. `exposed` is the reviewed exposure list; it is a parameter only so the suite can
 * reach the pattern clause, which no id of the reviewed list reaches today (defense in depth, b21-c-least-privilege case 7).
 */
export function approvedRunAllowlist(allowedToolIds: unknown, exposed: readonly string[] = INTENTIONAL_AGENT_EXPOSED_TOOL_IDS): ReadonlySet<string> | null {
  try {
    if (!Array.isArray(allowedToolIds) || allowedToolIds.length > RUN_ALLOWLIST_MAX_IDS) return null;
    const ids: unknown[] = Array.from(allowedToolIds as unknown[]);
    const sound = ids.length <= RUN_ALLOWLIST_MAX_IDS && ids.every((id, index) => typeof id === "string" && exposed.includes(id) && !NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(id)) && (index === 0 || (ids[index - 1] as string) < id));
    return sound ? new Set(ids as string[]) : null;
  } catch {
    return null;
  }
}

/**
 * [B21 C] A specialist role's allowlist, applied by `buildRunToolset` AFTER every gate above: it only NARROWS the set those gates
 * admitted and can never bring back a tool one of them withheld. A list `approvedRunAllowlist` refuses approves NOTHING: an empty
 * toolset and one warning naming `allowlist_invalid`.
 */
function narrowToRunAllowlist<T extends { toolId: string }>(descriptors: T[], allowedToolIds: unknown, warn: (message: string) => void): T[] {
  const approved = approvedRunAllowlist(allowedToolIds);
  if (approved === null) {
    warn(`The run's tool allowlist is invalid (allowlist_invalid): it must hold at most ${RUN_ALLOWLIST_MAX_IDS} reviewed, exposed tool ids, sorted and duplicate-free; it approves nothing, so no tool is offered to this run.`);
    return [];
  }
  return descriptors.filter((descriptor) => approved.has(descriptor.toolId));
}

// [B21 C] the allowlist's ids, on their own line at the END (an import is hoisted): the B20 pages cite this file by line, and a
// line-anchored import gate (the B19-D chat-closure walker) sees an import only where a line starts with it
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS } from "../engineering/agent-exposure";

// [B22-B] the computation read binding and the descriptor type, on their own lines at the END (imports are hoisted), as B21 C's import
// above: no cited line moves, and a line-anchored import gate still sees each import where its line starts
import { resolveComputationBinding } from "./computation-reads";
import type { ToolDescriptor } from "../engineering/tool-registry";

/** [B22-B] A named computation read is advertised only when its allowlisted binding resolves and the server bound the computation
 *  port to this run (the computation fact); it has no B05 read binding and needs no canonical state (a parse refuses an absent board). */
function computationReadAvailable(descriptor: ToolDescriptor, context: AgentRunContext, warn: (message: string) => void): boolean {
  if (resolveComputationBinding(descriptor).state !== "resolved") {
    warn(`Tool ${descriptor.toolId} unavailable: no resolved computation binding.`);
    return false;
  }
  if (context.computationAvailable !== true) {
    warn(`Tool ${descriptor.toolId} unavailable: no computation engine is bound to this run.`);
    return false;
  }
  return true;
}

// [PR-D d2] the Schematic to PCB preflight read and the catalog inspection read: their bindings and per-run availability rules, on their own
// lines at the END (imports are hoisted), as B22-B's import above: no cited line moves
import { pcbSyncPreflightReadAvailable, resolvePcbSyncPreflightBinding } from "./pcb-sync-preflight-reads";
import { catalogInspectionReadAvailable, resolveCatalogInspectionBinding } from "./catalog-inspection-reads";
// [PR-F] the missing-facts read: its binding and per-run availability rule, on its own line at the END too: no cited line moves
import { missingFactsReadAvailable, resolveMissingFactsBinding } from "./missing-facts-reads";
// [PR-M, 2026-10-17] the schematic-instance inspection, the candidate search and the component resolution proposal: their bindings and per-run availability rules, on their own lines at the END too: no cited line moves
import { instanceInspectionReadAvailable, resolveInstanceInspectionBinding } from "./instance-inspection-reads";
import { candidateSearchReadAvailable, resolveCandidateSearchBinding } from "./candidate-search-reads";
import { cadAcquisitionToolAvailable, resolveCadAcquisitionBinding } from "./cad-acquisition-reads"; // [PR-M, 2026-10-18] M2
import { componentResolutionProposalAvailable, resolveComponentResolutionBinding } from "./component-resolution-proposals";
import { resolveSheetOrganizationBinding, sheetOrganizationProposalAvailable } from "./sheet-organization-proposals"; // [PR-J5, 2026-10-23] the organise proposal's binding and per-run rule, at the END too: no cited line moves
// [PR-L, 2026-10-18] runbook L.5: the durable generation task's inspection rule and the reference digest, on their own line at the END too: no cited line moves
import { generationTaskInspectAvailable, generationTaskReferenceDigest, resolveGenerationTaskInspectBinding } from "./generation-proposals";
// [K2, 2026-11-04] K1 case 3: the identical-call guard's revision probe and its truthful refusal, appended (a function declaration is hoisted): no cited line moves
const REPEATED_UNCHANGED_TASK_READ = "This exact status read already ran twice in this run and the task it reads is stored unchanged since (the same stored revision); report the state you have, or read it again in a later turn.";
/** The stored revision the gateway's probe reports for this call, or null (no probe for the tool, a refusal, an error, a hang past the run's
 *  boundary or 5 s): a null is judged on the args-only key, which counts every identical call of the run, so a failing probe never loosens the guard. */
async function observedTaskRevision(gateway: AgentToolInvocationGateway, input: Parameters<NonNullable<AgentToolInvocationGateway["observedRevision"]>>[0]): Promise<string | null> {
  if (!gateway.observedRevision || input.signal?.aborted) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const bounded = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 5_000); onAbort = () => resolve(null); input.signal?.addEventListener("abort", onAbort, { once: true }); });
    const probed = gateway.observedRevision(input).catch(() => null);
    const revision = await Promise.race([probed, bounded]);
    return typeof revision === "string" && revision.length > 0 && revision.length <= 400 ? revision : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) input.signal?.removeEventListener("abort", onAbort);
  }
}
