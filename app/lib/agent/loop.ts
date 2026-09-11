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

import { discoverTools } from "../engineering/tool-discovery";
import { grantedExecutionViolations } from "../engineering/granted-execution-families";
import type { ExecutionDecisionMode, PublicExecutionGrant } from "../engineering/execution-grant";
import { REPLAY_FAMILY } from "../engineering/execution-grant";
import type { ToolRegistry } from "../engineering/tool-registry";
import { resolveReadBinding } from "../engineering/tool-bindings-readonly";
import type { AgentTraceRecorder } from "./trace-recorder";
import type { ReadResourceKind } from "../engineering/resource-envelopes";
import { REPLACEMENT_PROPOSAL_SCHEMA } from "../engineering/replacement-proposals";
import { engineeringDigest } from "../engineering/stable";
import { LLMProviderError } from "../llm/errors";
import {
  buildAgentToolDeclarations,
  strictCompatibility,
} from "./provider-tools";
import type {
  AgentExecutionGrantMinter,
  AgentExecutionSettlement,
  AgentRunContext,
  AgentRunEvent,
  AgentRunRequest,
  AgentRunResult,
  AgentStep,
  AgentToolInvocationGateway,
  AgentToolResult,
  ProviderAgentAdapter,
  ProviderToolDeclaration,
} from "./contracts";

const MAX_RESULT_CHARS = 60_000;
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
  executionGrants?: AgentExecutionGrantMinter;
}

function resultText(payload: Record<string, unknown>): string {
  const text = JSON.stringify(payload);
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
const LAYOUT_PROPOSAL_TOOL_IDS = new Set(["sirkit.placement.propose", "sirkit.routing.propose"]);

/** Build the exact provider-exposed declaration subset for this run. */
export function buildRunToolset(registry: ToolRegistry, context: AgentRunContext, warn: (message: string) => void): {
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
      if (descriptor.operationClass === "propose") {
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
  return buildAgentToolDeclarations(descriptors);
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
      toolset = buildRunToolset(deps.registry, deps.context, (message) => emitOnce({ type: "warning", runId: request.runId, message }));
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
      if (step.text) emitOnce({ type: "text_delta", runId: request.runId, text: step.text });

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

        const resolved = toolset.resolve(call.providerName);
        if (!resolved) {
          emitOnce({ type: "warning", runId: request.runId, message: `The model requested unknown tool "${call.providerName.slice(0, 80)}" — refused.` });
          results.push(errorResult("unknown_tool", "No such tool is exposed in this run."));
          continue;
        }
        const descriptor = deps.registry.get(resolved.toolId, resolved.version);
        const title = descriptor?.title ?? resolved.toolId;
        if (toolCallsUsed >= request.budget.maxToolCalls) {
          results.push(errorResult("budget_exhausted", "The run's tool-call budget is exhausted; answer from the results you already have."));
          continue;
        }
        if (call.argumentsText.length > MAX_ARGUMENT_CHARS) {
          results.push(errorResult("invalid_input", "Tool arguments exceeded the size limit."));
          continue;
        }
        let args: Record<string, unknown>;
        try {
          const parsed: unknown = JSON.parse(call.argumentsText === "" ? "{}" : call.argumentsText);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
          args = parsed as Record<string, unknown>;
        } catch {
          results.push(errorResult("invalid_input", "Tool arguments were not a valid JSON object."));
          continue;
        }
        // Cycle detection: tool id/version + canonical argument digest.
        const cycleKey = `${resolved.toolId}@${resolved.version}:${engineeringDigest({ args })}`;
        const seen = (identicalCalls.get(cycleKey) ?? 0) + 1;
        identicalCalls.set(cycleKey, seen);
        if (seen > request.budget.maxIdenticalCalls) {
          results.push(errorResult("repeated_call", "This exact call already ran in this run; its result has not changed."));
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
          results.push(errorResult("proposal_exists", proposalIssued ? "A sealed proposal already exists for this run; ask the user to review it." : "An execution grant was already issued in this run; report its outcome before proposing more."));
          continue;
        }
        if (isExecution && (executionIssued || proposalIssued)) {
          results.push(errorResult("execution_exists", executionIssued ? "An execution grant was already issued in this run; its outcome has not changed." : "A sealed proposal already exists for this run; nothing executes beside it."));
          continue;
        }

        toolCallsUsed += 1;
        emitOnce({ type: "tool_started", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title });
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
        const recordTrace = (outcomeClass: "read" | "proposal" | "proposal_blocked" | "refused" | "view_command" | "layout_candidate" | "execution_grant", status: string, extra?: { verification?: string | null; output?: Record<string, unknown> | null; proposal?: { proposalId: string; operationsDigest: string } | null }): void => {
          try {
            trace?.recordTool({
              callId: call.callId, toolId: resolved.toolId, version: resolved.version,
              operationClass: descriptor?.operationClass ?? "unknown",
              args, outcomeClass, status,
              verification: extra?.verification ?? null,
              output: extra?.output ?? null,
              proposal: extra?.proposal ?? null,
            });
          } catch { /* passive */ }
        };
        if (outcome.kind === "read" && outcome.ok) {
          recordTrace("read", "succeeded", { verification: outcome.verification, output: outcome.output });
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, ok: true, status: "succeeded" });
          results.push({
            callId: call.callId,
            outputText: resultText({ ok: true, tool: outcome.toolId, revision: outcome.sourceRevisionDigest, verification: outcome.verification, output: outcome.output }),
            isError: false,
          });
        } else if (outcome.kind === "view-command" && outcome.ok) {
          // [B17-F] the browser executes the validated request on the user's
          // own view bus; the model learns only that it was dispatched. The
          // trace stores the request identity and the command id.
          const viewRequest = outcome.request;
          recordTrace("view_command", "view_command_dispatched", { verification: `expected view revision ${viewRequest.expectedViewRevision}`, output: { editor: viewRequest.editor, commandId: viewRequest.commandId, requestId: viewRequest.requestId } });
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, ok: true, status: "view_command_dispatched" });
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
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, ok: true, status: "layout_candidate_ready" });
          emitOnce({ type: "layout_candidate_ready", runId: request.runId, toolId: resolved.toolId, candidate });
          const summary = candidate.kind === "placement"
            ? { kind: "placement", scope: candidate.scope.instanceIds === "all" ? "whole board" : `${candidate.scope.instanceIds.length} footprint(s)`, legal: candidate.legal, termination: candidate.run.termination, candidateCount: candidate.run.candidateCount }
            : { kind: "routing", scope: candidate.scope.netIds === "all" ? "every incomplete net" : `${candidate.scope.netIds.length} net(s)`, completion: candidate.completion.status, tracks: candidate.stats.tracks, vias: candidate.stats.vias, unresolved: candidate.completion.failures.length };
          results.push({
            callId: call.callId,
            outputText: resultText({
              ok: true,
              status: "layout_candidate_ready",
              candidateId: candidate.candidateId,
              baseRevision: candidate.base.revision,
              expiresAt: candidate.expiresAt,
              ...summary,
              note: "The candidate is awaiting the user's explicit review in the PCB editor's placement/routing panel — NOTHING on the board has changed. Tell the user to preview and apply or discard it; never claim it was applied, and never call it manufacturing-ready.",
            }),
            isError: false,
          });
        } else if (outcome.kind === "execution-grant" && outcome.ok) {
          executionIssued = true;
          // [B18-B] the server-minted grant. The trace stores the grant identity
          // and the operations digest only; the model learns the decision and —
          // for execute_explicit — ONLY what the durable record says afterwards.
          const grant = outcome.grant;
          const explicit = outcome.decision === "execute_explicit";
          const issuedStatus = explicit ? "execution_grant_issued" : "execution_preview_issued";
          recordTrace("execution_grant", issuedStatus, { verification: `grant ${grant.grantId} (${outcome.decision}) expires ${grant.binding.expiresAt}`, proposal: { proposalId: grant.grantId, operationsDigest: grant.binding.proposal.operationsDigest } });
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, ok: true, status: issuedStatus });
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
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, ok: true, status: "proposal_sealed" });
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
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, ok: true, status: "proposal_sealed" });
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
        } else if (outcome.kind === "proposal-blocked") {
          recordTrace("proposal_blocked", "proposal_blocked");
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, ok: false, status: "proposal_blocked" });
          results.push({
            callId: call.callId,
            outputText: resultText({ ok: false, status: "proposal_blocked", blockers: outcome.blockers.slice(0, 10) }),
            isError: true,
          });
        } else if (outcome.kind === "refused") {
          recordTrace("refused", outcome.status);
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, ok: false, status: outcome.status });
          results.push({
            callId: call.callId,
            outputText: resultText({ ok: false, status: outcome.status, diagnostics: outcome.diagnostics.slice(0, 5) }),
            isError: true,
          });
        } else {
          recordTrace("refused", "invalid_outcome");
          emitOnce({ type: "tool_finished", runId: request.runId, callId: call.callId, toolId: resolved.toolId, title, ok: false, status: "invalid_outcome" });
          results.push(errorResult("invalid_outcome", "The tool returned an unrecognized outcome shape."));
        }
        if (runSignal.aborted || deadlineExceeded()) return boundaryFailure();
      }

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
