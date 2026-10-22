/**
 * [PR-D] The agent's Build-mode GENERATION, `sirkit.schematic.generate-proposal`, the semantic equivalent of the Build composer's
 * Generate. [PR-L, 2026-10-18] Runbook L.5, increment 5 (task-worker-contract.md section 8; OD-252 items 6 and 8): version 2.0.0 no
 * longer runs a design inside the chat turn. The in-turn path (the run's ~120 s clamped `runBuildMultiGeneration` sealed into a v1
 * artifact) is REMOVED from the agent tool; the deprecated synchronous `POST /api/schematic/build-multi` route keeps its own copy for
 * compatibility and nothing in the chat reaches it. One durable generation now serves Build and chat alike:
 *
 *  - `SchematicGenerationProposalService` (generate-proposal@2.0.0, propose) STARTS OR ATTACHES the scope's durable generation task
 *    through the SAME `GenerationTaskService.start` the start route `POST /api/generation-tasks` calls (the chat route's injected port,
 *    app/api/chat/schematic-generation-runtime.ts): the same closed request, the same idempotency (a client request id derived from the
 *    run and the provider call, so a retried call attaches to its own task), one active task per project and branch (a running design
 *    is ATTACHED, never duplicated), the same editor roles, the same provider-servable rule and the same per-task allowance. It answers
 *    a task REFERENCE (`generation-task` outcome, `generation_task_ready` event) within milliseconds; the design runs in a generation
 *    worker in finite, checkpointed slices. The chat's run deadline ends the TURN; it never touches the accepted task.
 *  - `GenerationTaskInspectService` (`sirkit.generation.task-inspect@1.0.0`, Tier 0 read): the task's PUBLIC snapshot (state, phase,
 *    liveness, blocks, counts, blocker, valid actions) and, when a result exists, a bounded summary of it - never the prompt, the
 *    conversation, a tool output, hidden reasoning or the netlist.
 *  - `GenerationTaskControlProposalService` (`sirkit.generation.task-control@1.0.0`, propose): a SEALED control request (cancel, pause,
 *    resume, retry one block) the page shows as a confirm chip; only the human's click sends it to the task's control route under the
 *    human's own authorization (OD-252 item 6). Nothing here changes a task.
 *
 * Every service checks, per invocation: the exact allowlisted binding, the context integrity, the server's generation fact AND port,
 * fresh discovery, the role and capability of the effective actor, and a closed argument surface. The scope and the principal come from
 * the server-assembled run context only; a task id names a task only inside that scope (a foreign or guessed id is the uniform
 * not_found). Nothing is ever applied here: the result reaches the page's ONE review intake (offerBuildResult -> the schematic review
 * dialog), once per (task, result digest), where only the human approves it.
 */
import type { LLMProviderId } from "../llm/types";
import type { ProjectRole } from "../engineering/types";
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS, DEFAULT_OUTPUT_LIMITS, validateAgainstSchema } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import { engineeringDigest } from "../engineering/stable";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";
import { sanitizeTraceText } from "./redaction"; import { readGeneratedSheets } from "../schematic/generated-sheets"; // [PR-J, 2026-10-22] J5-1: the pure sheet-set reader
import {
  GENERATION_TASK_CONTROL_LABELS, GENERATION_TASK_CONTROL_TOOL_ACTIONS, GENERATION_TASK_CONTROL_TOOL_ID, GENERATION_TASK_ID_PATTERN, GENERATION_TASK_INSPECT_MAX_CHARS, GENERATION_TASK_INSPECT_TOOL_ID,
  GENERATION_TASK_INSPECTION_SCHEMA, GENERATION_TASK_REF_SCHEMA, GENERATION_TASK_BLOCK_IDS, GENERATION_START_TOOL_ID, generationChatClientRequestId, sealGenerationTaskControlRequest,
  type GenerationTaskControlToolAction, type GenerationTaskDisposition, type GenerationTaskReference, type GenerationTaskScopeRef, type SealedGenerationTaskControlRequest,
} from "./generation-task-tools";

export const AGENT_GENERATION_PROPOSAL_TOOL_ID = GENERATION_START_TOOL_ID;
/** The authority source the three generation tools require: advertised ONLY when the chat route bound the durable generation-task port
 *  to the run (a durable task store here and the run's provider servable) and a validated schematic exists. */
export const GENERATION_AUTHORITY = "schematic-generation" as const;
/** [PR-L, 2026-10-18] The ONE implementation all three descriptors bind: the shared durable generation-task service the routes call. */
export const GENERATION_BINDING = Object.freeze({ module: "app/lib/generation-task/service.ts", symbol: "GenerationTaskService" });
/** The generation tools' ids (generate, inspect, control): the registry's schematic-generation authority belongs to exactly these. */
export const GENERATION_TASK_TOOL_IDS = Object.freeze([AGENT_GENERATION_PROPOSAL_TOOL_ID, GENERATION_TASK_INSPECT_TOOL_ID, GENERATION_TASK_CONTROL_TOOL_ID] as const);
/** The prompt bound (the composer's request is one paragraph; the store refuses more; the B05 input limits bound the raw argument first). */
export const MAX_GENERATION_PROMPT_CHARS = 4_000;
/** The descriptor's valid input example (the manual's example; pr-d-generate-proposal validates it against the schema). */
export const GENERATE_PROPOSAL_INPUT_EXAMPLE = Object.freeze({ prompt: "A 555 timer LED blinker powered from a 9 V battery through a 5 V linear regulator." });
export const GENERATION_TASK_INSPECT_INPUT_EXAMPLE = Object.freeze({});
export const GENERATION_TASK_CONTROL_INPUT_EXAMPLE = Object.freeze({ action: "cancel" });
/** The verification label of an inspection (the task store's own record, read in the trusted scope). */
export const GENERATION_TASK_INSPECT_VERIFICATION = "generation-task-store-read" as const;
/** The constant membership revision of an actor that carries none (the local-only build; the store needs an identifier). */
export const UNREVISIONED_MEMBERSHIP = "membership-unrevisioned" as const;

// ─── The port the chat route injects ────────────────────────────────────────────────────────────────────────────────────────

export interface GenerationTaskPortPrincipal { principalId: string; role: ProjectRole; membershipRevision: string }
/** A service answer: the HTTP status the route would answer and its JSON body (app/lib/generation-task/service.ts). */
export interface GenerationTaskPortAnswer { status: number; body: Record<string, unknown> }
export interface GenerationTaskPortStart {
  scope: GenerationTaskScopeRef;
  principal: GenerationTaskPortPrincipal;
  /** the chat run that asked (recorded on the task as its initiator's run) */
  chatRunId: string;
  /** the start route's CLOSED body, exactly */
  body: { clientRequestId: string; prompt: string; provider: LLMProviderId; base: { schematicDigest: string; recipe: "chat-sheet"; headMark?: unknown } };
}
/** The server port: `GenerationTaskService` over the resolved durable store (app/api/chat/schematic-generation-runtime.ts); faked in tests. */
export interface SchematicGenerationPort {
  readonly durability: "durable" | "process-memory";
  start(input: GenerationTaskPortStart): Promise<GenerationTaskPortAnswer>;
  list(scope: GenerationTaskScopeRef): Promise<GenerationTaskPortAnswer>;
  inspect(scope: GenerationTaskScopeRef, taskId: string, options: { includeResult: boolean }): Promise<GenerationTaskPortAnswer>;
}

// ─── Binding resolution and the run toolset's availability rule ────────────────────────────────────────────────────────────

export type GenerationBindingResolution = { state: "resolved" } | { state: "not_callable"; reason: string };

/** Allowlist-only: one of the three generation tools, of its exact class, over the one shared service, requiring exactly its authority. */
export function resolveGenerationBinding(descriptor: ToolDescriptor): GenerationBindingResolution {
  if (!(GENERATION_TASK_TOOL_IDS as readonly string[]).includes(descriptor.toolId)) return { state: "not_callable", reason: "Only the three generation tools are invocable here." };
  const read = descriptor.toolId === GENERATION_TASK_INSPECT_TOOL_ID;
  if (read ? (descriptor.operationClass !== "read" || descriptor.sideEffects !== "none" || descriptor.approvalTier !== "none") : (descriptor.operationClass !== "propose" || descriptor.sideEffects !== "proposal-artifact" || descriptor.approvalTier !== "none")) {
    return { state: "not_callable", reason: read ? "The task inspection is a Tier 0 read with no side effects." : "A generation start or control request is a sealed artifact (propose class, proposal-artifact side effects, no approval tier of its own)." };
  }
  if ((descriptor.binding.status !== (read ? "bound-read" : "bound-proposal")) || descriptor.binding.module !== GENERATION_BINDING.module || descriptor.binding.symbol !== GENERATION_BINDING.symbol) return { state: "not_callable", reason: "The descriptor does not bind the one shared durable generation-task service." };
  if (descriptor.requiredAuthority.length !== 1 || descriptor.requiredAuthority[0] !== GENERATION_AUTHORITY) return { state: "not_callable", reason: "The generation tools require exactly the schematic-generation authority." };
  return { state: "resolved" };
}
export function resolveGenerationTaskInspectBinding(descriptor: ToolDescriptor): GenerationBindingResolution {
  return descriptor.toolId === GENERATION_TASK_INSPECT_TOOL_ID ? resolveGenerationBinding(descriptor) : { state: "not_callable", reason: "Only the task inspection is invocable here." };
}

/** The loop's per-run rule for the inspection (a read with no B05 binding): its binding resolves and the server's generation fact is set. */
export function generationTaskInspectAvailable(descriptor: ToolDescriptor, context: AgentRunContext, warn: (message: string) => void): boolean {
  if (resolveGenerationTaskInspectBinding(descriptor).state !== "resolved") { warn(`Tool ${descriptor.toolId} unavailable: no resolved generation-task binding.`); return false; }
  if (context.schematicGenerationAvailable !== true) { warn(`Tool ${descriptor.toolId} unavailable: no durable generation-task store and servable provider for this run.`); return false; }
  return true;
}

// ─── Shared gates ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GenerationServiceOptions {
  /** the server port, injected by the composition root; absent: every generation tool refuses authority_unavailable */
  port?: SchematicGenerationPort;
  /** the gateway's context integrity check (injected so this module never imports the gateway) */
  integrity: (context: AgentRunContext) => readonly string[];
  now?: () => number;
}
export interface GenerationInvocationInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; provider: LLMProviderId; timeoutMs: number; signal?: AbortSignal; callId?: string }

const AUTHORITY_KEYS = new Set(["actor", "actorId", "role", "capability", "capabilities", "authority", "approval", "approvals", "apply", "commit", "scope", "tenantId", "projectId", "branchId", "headMark", "revision", "expectedRevision", "lineageId", "provider", "netlist", "schematic", "budget", "deadline", "clientRequestId", "base", "principal", "worker", "lease", "allowance", "review", "liveBase", "extendAllowance"]);
type Refusal = (status: string, diagnostics: string[]) => GatewayInvocationOutcome;
const refusalFor = (input: GenerationInvocationInput): Refusal => (status, diagnostics) => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
const blockedFor = (input: GenerationInvocationInput) => (blockers: Array<{ code: string; detail: string }>): GatewayInvocationOutcome => ({ kind: "proposal-blocked", ok: false, toolId: input.toolId, version: input.version, blockers });
const scopeOf = (context: AgentRunContext): GenerationTaskScopeRef => ({ tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId });
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const NOT_FOUND_SENTENCE = "No such design task in this project (a task id names a task only inside the project and branch it was started in).";

/** The common prelude: descriptor, binding, integrity, the server's fact and port, fresh discovery, role and capability. */
function prelude(registry: ToolRegistry, options: GenerationServiceOptions, input: GenerationInvocationInput, expectedToolId: string): { ok: true; descriptor: ToolDescriptor; port: SchematicGenerationPort } | { ok: false; outcome: GatewayInvocationOutcome } {
  const refuse = refusalFor(input);
  const descriptor = registry.get(input.toolId, input.version);
  if (!descriptor) return { ok: false, outcome: refuse("not_registered", ["Unknown tool."]) };
  if (descriptor.toolId !== expectedToolId) return { ok: false, outcome: refuse("not_callable", ["This generation service does not serve that tool."]) };
  const resolution = resolveGenerationBinding(descriptor);
  if (resolution.state !== "resolved") return { ok: false, outcome: refuse("not_callable", [resolution.reason]) };
  const integrity = options.integrity(input.context);
  if (integrity.length > 0) return { ok: false, outcome: refuse("context_integrity", integrity.slice(0, 5)) };
  const port = options.port;
  if (!port || input.context.schematicGenerationAvailable !== true) return { ok: false, outcome: refuse("authority_unavailable", ["No durable generation-task store and servable provider are bound to this run; the generation tools are unavailable and nothing was started or read."]) };
  const discovery = discoverTools(registry, input.context.discovery);
  if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
    const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
    return { ok: false, outcome: refuse("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`]) };
  }
  const actor = input.context.actor;
  if (!descriptor.requiredRoles.includes(actor.actorRole) || !actor.grantedCapabilities.includes(descriptor.requiredCapability)) {
    return { ok: false, outcome: refuse("unauthorized", [`Role ${actor.actorRole} / capability ${descriptor.requiredCapability} is not permitted for this tool.`]) };
  }
  const safety = assertSafeJsonValue(input.args, DEFAULT_INPUT_LIMITS, "args");
  if (safety.length > 0) return { ok: false, outcome: refuse("invalid_input", safety.slice(0, 5)) };
  return { ok: true, descriptor, port };
}

/** Exactly the allowed keys (authority-shaped keys refused by name); null when the surface is clean. */
function closedSurface(args: Record<string, unknown>, allowed: readonly string[], tool: string): string | null {
  for (const key of Object.keys(args)) {
    if (allowed.includes(key)) continue;
    return AUTHORITY_KEYS.has(key) ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim - ${tool} accepts only ${allowed.join(", ") || "no arguments"}; the scope, principal, base and provider come from the server.` : `Unexpected argument "${key.slice(0, 40)}" - ${tool} accepts only ${allowed.join(", ") || "no arguments"}.`;
  }
  return null;
}

/** The public snapshot a service answer carries (the service's `buildGenerationTaskSnapshot`), or null. */
const snapshotOf = (value: unknown): Record<string, unknown> | null => (isRecord(value) && value.schema === "sirkit.generation-task-snapshot.v1" && typeof value.taskId === "string" && GENERATION_TASK_ID_PATTERN.test(value.taskId) ? value : null);

/** A refusal or blocker for a service answer that is not a success, in the service's own closed codes (never its free text). */
function answerFailure(input: GenerationInvocationInput, answer: GenerationTaskPortAnswer): GatewayInvocationOutcome {
  const refuse = refusalFor(input), blocked = blockedFor(input);
  const code = typeof answer.body.code === "string" ? answer.body.code : "";
  const sentence = sanitizeTraceText(typeof answer.body.error === "string" ? answer.body.error : "", 240);
  switch (code) {
    case "GENERATION_TASK_NOT_FOUND": return refuse("not_found", [NOT_FOUND_SENTENCE]);
    case "GENERATION_TASK_FORBIDDEN": return refuse("unauthorized", [sentence || "Your project role cannot start or control a design."]);
    case "GENERATION_TASK_INVALID_REQUEST": return refuse("invalid_input", [`The design request is not valid (${sanitizeTraceText(typeof answer.body.issue === "string" ? answer.body.issue : "refused", 160)}); nothing was started.`]);
    case "GENERATION_PROVIDER_UNAVAILABLE": return blocked([{ code: "provider_unavailable", detail: "No model provider is configured for this design; nothing was started." }, { code: "not_retryable", detail: "A retry will not help until a provider is configured on the server; nothing was started or changed." }]);
    case "GENERATION_TASK_CONTENDED": return blocked([{ code: "task_contended", detail: "The project's design task was busy; nothing was started." }, { code: "retryable", detail: "A retry can help; nothing was started or changed." }]);
    case "IDEMPOTENCY_KEY_REUSED": return refuse("idempotency_conflict", ["This chat call's request id was already used for a different request; nothing was started."]);
    case "GENERATION_TASK_INVALID_PERSISTED_STATE": return refuse("implementation_failed", ["The stored design task failed validation and is not used; nothing was started or changed."]);
    default: return refuse("implementation_failed", [`The design task service answered ${Number.isInteger(answer.status) ? answer.status : "an unknown status"}${code ? ` (${code.slice(0, 60)})` : ""}; nothing was started or changed.`]);
  }
}

/** The task reference a start answers (identity, scope and state; never the prompt). */
export function generationTaskReferenceOf(snapshot: Record<string, unknown>, disposition: GenerationTaskDisposition, durability: SchematicGenerationPort["durability"]): GenerationTaskReference {
  const scope = isRecord(snapshot.scope) ? snapshot.scope : {};
  const liveness = isRecord(snapshot.liveness) ? snapshot.liveness : {};
  const base = isRecord(snapshot.base) ? snapshot.base : {};
  const result = isRecord(snapshot.result) && (snapshot.result.status === "complete" || snapshot.result.status === "partial") && typeof snapshot.result.resultDigest === "string"
    ? { status: snapshot.result.status as "complete" | "partial", omittedBlocks: Array.isArray(snapshot.result.omittedBlocks) ? snapshot.result.omittedBlocks.filter((entry): entry is string => typeof entry === "string").slice(0, 8) : [], resultDigest: snapshot.result.resultDigest }
    : null;
  return {
    schema: GENERATION_TASK_REF_SCHEMA,
    taskId: String(snapshot.taskId),
    scope: { tenantId: String(scope.tenantId ?? ""), projectId: String(scope.projectId ?? ""), branchId: String(scope.branchId ?? "") },
    disposition,
    sameRequest: disposition !== "attached-active",
    state: String(snapshot.state ?? ""),
    phase: typeof snapshot.phase === "string" ? snapshot.phase : null,
    origin: snapshot.origin === "build" ? "build" : "chat",
    liveness: typeof liveness.state === "string" ? liveness.state : "idle",
    base: { schematicDigest: String(base.schematicDigest ?? ""), recipe: String(base.recipe ?? "") },
    result,
    durability,
    createdAt: String(snapshot.createdAt ?? ""),
  };
}
/** The digest the trace records for a reference (identity and disposition only). */
export const generationTaskReferenceDigest = (reference: GenerationTaskReference): string => engineeringDigest({ schema: GENERATION_TASK_REF_SCHEMA, taskId: reference.taskId, disposition: reference.disposition });

// ─── generate-proposal@2.0.0: start or attach ────────────────────────────────────────────────────────────────────────────────

/** Back-compat name of the start input (the gateway's call shape). */
export type SchematicGenerationProposalInput = GenerationInvocationInput;

export class SchematicGenerationProposalService {
  constructor(private readonly registry: ToolRegistry, private readonly options: GenerationServiceOptions) {}

  async invoke(input: GenerationInvocationInput): Promise<GatewayInvocationOutcome> {
    const refuse = refusalFor(input);
    const gate = prelude(this.registry, this.options, input, AGENT_GENERATION_PROPOSAL_TOOL_ID);
    if (!gate.ok) return gate.outcome;
    const context = input.context;
    // the base the task pins: the validated schematic as the chat run posted it (the `chat-sheet` recipe) and its head mark when present
    if (!context.schematic || !context.schematicDigest) return refuse("authority_unavailable", ["No verified schematic snapshot is available for this run; nothing was started."]);
    const surface = closedSurface(input.args, ["prompt"], "the generation start");
    if (surface) return refuse("invalid_input", [surface]);
    const prompt = typeof input.args.prompt === "string" ? input.args.prompt.trim() : "";
    if (prompt.length === 0 || prompt.length > MAX_GENERATION_PROMPT_CHARS) return refuse("invalid_input", [`prompt must be 1 to ${MAX_GENERATION_PROMPT_CHARS} characters of plain text describing the circuit.`]);
    if (typeof input.callId !== "string" || input.callId.length === 0 || input.callId.length > 200) return refuse("not_callable", ["A provider call id is required: it keys the start's idempotency (a retried call attaches to the task it started)."]);
    if (input.signal?.aborted) return refuse("cancelled", ["The turn ended before the design was started; nothing was started."]);
    const scope = scopeOf(context);
    const body: GenerationTaskPortStart["body"] = {
      clientRequestId: generationChatClientRequestId({ scope, runId: input.runId, callId: input.callId }),
      prompt, provider: input.provider,
      base: { schematicDigest: context.schematicDigest, recipe: "chat-sheet", ...(context.schematicHeadMark ? { headMark: { ...context.schematicHeadMark } } : {}) },
    };
    let answer: GenerationTaskPortAnswer;
    try {
      // deliberately NOT raced against the turn: a start is one durable commit; once it lands the task outlives the turn either way
      answer = await gate.port.start({ scope, principal: { principalId: context.actor.actorId, role: context.actor.actorRole, membershipRevision: context.actor.membershipRevision ?? UNREVISIONED_MEMBERSHIP }, chatRunId: input.runId, body });
    } catch (error) {
      return refuse("implementation_failed", [`The design task service failed: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing is known to have started; the project's design status shows any task that did.`]);
    }
    if (answer.status === 202) {
      const snapshot = snapshotOf(answer.body.task);
      if (!snapshot) return refuse("invalid_output", ["The design task service answered without a task snapshot."]);
      return { kind: "generation-task", ok: true, toolId: input.toolId, version: input.version, task: generationTaskReferenceOf(snapshot, answer.body.attached === true ? "attached-same-request" : "started", gate.port.durability) };
    }
    if (answer.status === 409 && answer.body.code === "GENERATION_TASK_ACTIVE") {
      // one design at a time per project and branch: the running one is ATTACHED (as the composer's Generate follows it), never a second
      const active = snapshotOf(answer.body.activeTask);
      if (!active) return blockedFor(input)([{ code: "task_active", detail: "A design is already running for this project; nothing new was started." }, { code: "retryable", detail: "Ask again once the running design is finished or stopped." }]);
      return { kind: "generation-task", ok: true, toolId: input.toolId, version: input.version, task: generationTaskReferenceOf(active, "attached-active", gate.port.durability) };
    }
    return answerFailure(input, answer);
  }
}

// ─── sirkit.generation.task-inspect@1.0.0 ───────────────────────────────────────────────────────────────────────────────────

/** The snapshot keys the inspection hands the model: an ALLOWLIST (a key added to the snapshot later is not forwarded until reviewed). */
const INSPECTED_SNAPSHOT_KEYS = Object.freeze(["taskId", "scope", "state", "terminal", "phase", "origin", "provider", "createdAt", "updatedAt", "serverNow", "liveness", "plan", "blocker", "failure", "usage", "allowance", "base", "result", "review", "control", "actions", "retryBlocks", "eventCursor", "activity"] as const);

export function publicTaskProjection(snapshot: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(INSPECTED_SNAPSHOT_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(snapshot, key)).map((key) => [key, structuredClone(snapshot[key])]));
}
/** A bounded summary of a validated result: completeness, omitted blocks, counts and the electrical check's numbers (never the netlist). */
export function resultSummaryOf(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result) || (result.status !== "complete" && result.status !== "partial")) return null;
  const netlist = isRecord(result.netlist) ? result.netlist : {};
  const check = isRecord(result.electricalCheck) ? result.electricalCheck : {};
  return {
    status: result.status,
    omittedBlocks: Array.isArray(result.omittedBlocks) ? result.omittedBlocks.filter((entry): entry is string => typeof entry === "string").slice(0, 8) : [],
    components: Array.isArray(netlist.components) ? netlist.components.length : 0,
    connections: Array.isArray(netlist.connections) ? netlist.connections.length : 0,
    electricalCheck: { state: typeof check.state === "string" ? check.state : "not_run", criticalCount: typeof check.criticalCount === "number" ? check.criticalCount : null, warningCount: typeof check.warningCount === "number" ? check.warningCount : null },
    resultDigest: typeof result.resultDigest === "string" ? result.resultDigest : null, ...sheetSummaryOf(result.sheets), // [PR-J, 2026-10-22] J5-1: a planned result's sheet summary (names, counts, interfaces; never the netlist)
  };
}

export class GenerationTaskInspectService {
  constructor(private readonly registry: ToolRegistry, private readonly options: GenerationServiceOptions) {}

  async invoke(input: GenerationInvocationInput): Promise<GatewayInvocationOutcome> {
    const refuse = refusalFor(input);
    const gate = prelude(this.registry, this.options, input, GENERATION_TASK_INSPECT_TOOL_ID);
    if (!gate.ok) return gate.outcome;
    const surface = closedSurface(input.args, ["taskId"], "the task inspection");
    if (surface) return refuse("invalid_input", [surface]);
    const asked = input.args.taskId;
    if (asked !== undefined && (typeof asked !== "string" || asked.length > 200)) return refuse("invalid_input", ["taskId, when given, is a design task id (generation-task:<32 hex>); omit it for the project's current or most recent design."]);
    if (input.signal?.aborted) return refuse("cancelled", ["The turn ended before the inspection ran."]);
    const scope = scopeOf(input.context);
    let taskId: string | null = typeof asked === "string" ? asked.trim() : null;
    try {
      if (taskId === null) {
        const listed = await gate.port.list(scope);
        if (listed.status !== 200) return answerFailure(input, listed);
        const active = snapshotOf(listed.body.active);
        const recent = Array.isArray(listed.body.recent) ? listed.body.recent.find((ref): ref is { taskId: string } => isRecord(ref) && typeof ref.taskId === "string" && GENERATION_TASK_ID_PATTERN.test(ref.taskId)) : undefined;
        taskId = active ? String(active.taskId) : recent ? recent.taskId : null;
        if (taskId === null) return this.read(input, { schema: GENERATION_TASK_INSPECTION_SCHEMA, found: false, durability: gate.port.durability, note: "This project has no design task. A design is started from the Build composer's Generate or with the generation start tool; nothing was changed." }, engineeringDigest({ schema: GENERATION_TASK_INSPECTION_SCHEMA, scope, found: false }), gate.descriptor);
      }
      if (!GENERATION_TASK_ID_PATTERN.test(taskId)) return refuse("not_found", [NOT_FOUND_SENTENCE]);
      const answer = await gate.port.inspect(scope, taskId, { includeResult: true });
      if (answer.status !== 200) return answerFailure(input, answer);
      const snapshot = snapshotOf(answer.body.task);
      if (!snapshot) return refuse("invalid_output", ["The design task service answered without a task snapshot."]);
      const report = {
        schema: GENERATION_TASK_INSPECTION_SCHEMA, found: true, durability: gate.port.durability,
        task: publicTaskProjection(snapshot), result: resultSummaryOf(answer.body.result),
        note: "The task's public state from the durable task store (never its conversation, tool outputs or reasoning). A design runs in a generation worker, not in this chat: a turn ending or Stop answer does not stop it; Stop design (the status card, or a confirmed control request) does. A reviewable result is offered to the user in the schematic review dialog, where only they approve it. Report the state as it is; liveness no_worker means no worker is consuming designs right now, never that the design is running.",
      };
      return this.read(input, fitInspectionBound(report), engineeringDigest({ schema: GENERATION_TASK_INSPECTION_SCHEMA, taskId, updatedAt: snapshot.updatedAt, eventCursor: snapshot.eventCursor }), gate.descriptor); // [PR-L6 integration, 2026-10-19] F6: shortened to the bound, never refused for its size
    } catch (error) {
      return refuse("implementation_failed", [`The task inspection failed: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing was changed.`]);
    }
  }

  private read(input: GenerationInvocationInput, report: Record<string, unknown>, digest: string, descriptor: ToolDescriptor): GatewayInvocationOutcome {
    const output = { report };
    const errors = [...assertSafeJsonValue(output, DEFAULT_OUTPUT_LIMITS, "output"), ...validateAgainstSchema(output, descriptor.outputSchema, "output")];
    if (JSON.stringify(output).length > GENERATION_TASK_INSPECT_MAX_CHARS) errors.push(`output: over the inspection bound (${GENERATION_TASK_INSPECT_MAX_CHARS} characters)`);
    if (errors.length > 0) return refusalFor(input)("invalid_output", errors.slice(0, 5));
    return { kind: "read", ok: true, toolId: input.toolId, version: input.version, output, sourceRevisionDigest: digest, verification: GENERATION_TASK_INSPECT_VERIFICATION };
  }
}

// ─── sirkit.generation.task-control@1.0.0: a confirm chip ────────────────────────────────────────────────────────────────────

export class GenerationTaskControlProposalService {
  constructor(private readonly registry: ToolRegistry, private readonly options: GenerationServiceOptions) {}

  async invoke(input: GenerationInvocationInput): Promise<GatewayInvocationOutcome> {
    const refuse = refusalFor(input), blocked = blockedFor(input);
    const gate = prelude(this.registry, this.options, input, GENERATION_TASK_CONTROL_TOOL_ID);
    if (!gate.ok) return gate.outcome;
    const surface = closedSurface(input.args, ["action", "taskId", "blockId"], "the task control request");
    if (surface) return refuse("invalid_input", [surface]);
    const action = input.args.action;
    if (typeof action !== "string" || !(GENERATION_TASK_CONTROL_TOOL_ACTIONS as readonly string[]).includes(action)) return refuse("invalid_input", [`action is one of ${GENERATION_TASK_CONTROL_TOOL_ACTIONS.join(", ")}.`]);
    const asked = input.args.taskId, block = input.args.blockId;
    if (asked !== undefined && (typeof asked !== "string" || asked.length > 200)) return refuse("invalid_input", ["taskId, when given, is a design task id; omit it for the project's running design."]);
    if (action === "retry-block" ? !(typeof block === "string" && (GENERATION_TASK_BLOCK_IDS as readonly string[]).includes(block)) : block !== undefined) return refuse("invalid_input", [action === "retry-block" ? "retry-block needs blockId: a planned block id the task lists as retryable (main, b1..b8)." : "blockId is only for retry-block."]);
    if (input.signal?.aborted) return refuse("cancelled", ["The turn ended before the control request was prepared."]);
    const scope = scopeOf(input.context);
    try {
      let taskId: string | null = typeof asked === "string" ? asked.trim() : null;
      if (taskId === null) {
        const listed = await gate.port.list(scope);
        if (listed.status !== 200) return answerFailure(input, listed);
        const active = snapshotOf(listed.body.active);
        if (!active) return blocked([{ code: "no_active_task", detail: "This project has no running design task to control; nothing was requested." }]);
        taskId = String(active.taskId);
      }
      if (!GENERATION_TASK_ID_PATTERN.test(taskId)) return refuse("not_found", [NOT_FOUND_SENTENCE]);
      const answer = await gate.port.inspect(scope, taskId, { includeResult: false });
      if (answer.status !== 200) return answerFailure(input, answer);
      const snapshot = snapshotOf(answer.body.task);
      if (!snapshot) return refuse("invalid_output", ["The design task service answered without a task snapshot."]);
      const state = String(snapshot.state ?? "");
      const actions = Array.isArray(snapshot.actions) ? snapshot.actions.filter((entry): entry is string => typeof entry === "string") : [];
      const retryBlocks = Array.isArray(snapshot.retryBlocks) ? snapshot.retryBlocks.filter((entry): entry is string => typeof entry === "string") : [];
      const valid = actions.includes(action) && (action !== "retry-block" || retryBlocks.includes(String(block)));
      if (!valid) {
        const offered = actions.filter((entry) => (GENERATION_TASK_CONTROL_TOOL_ACTIONS as readonly string[]).includes(entry));
        return blocked([{ code: "action_not_available", detail: `${action} is not valid while the design is ${state}${action === "retry-block" ? ` (retryable blocks: ${retryBlocks.join(", ") || "none"})` : ""}; valid now: ${offered.join(", ") || "none"}. Nothing was requested.` }]);
      }
      const plan = isRecord(snapshot.plan) && Array.isArray(snapshot.plan.blocks) ? snapshot.plan.blocks.filter(isRecord) : [];
      const blockName = action === "retry-block" ? String(plan.find((entry) => entry.blockId === block)?.name ?? block).slice(0, 120) : null;
      const now = this.options.now ? this.options.now() : Date.now();
      const actor = input.context.actor;
      const request: SealedGenerationTaskControlRequest = sealGenerationTaskControlRequest({
        version: gate.descriptor.version, scope, taskId, action: action as GenerationTaskControlToolAction, blockId: action === "retry-block" ? String(block) : null,
        label: blockName ? `${GENERATION_TASK_CONTROL_LABELS["retry-block"]} ${blockName}` : GENERATION_TASK_CONTROL_LABELS[action as GenerationTaskControlToolAction], stateAtRequest: state,
        actor: { actorId: `agent:${input.provider}`, kind: "ai" }, effectiveActor: { actorId: actor.actorId, kind: actor.source === "verified-worker" ? "worker" : "human" },
        provenance: { provider: input.provider, runId: input.runId }, createdAt: now,
      });
      return { kind: "generation-task-control", ok: true, toolId: input.toolId, version: input.version, request };
    } catch (error) {
      return refuse("implementation_failed", [`The control request could not be prepared: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing was requested.`]);
    }
  }
}

// [PR-L6 integration, 2026-10-19] F6 (the engine review of increment 6), appended after the last line (a function declaration is hoisted):
// increment 6 added plan.coverage, filled plan.assumptions and block.missing to the snapshot, so a reachable head (8 blocks waiting at S6
// with three long reported roles each, full assumptions and coverage) projects above GENERATION_TASK_INSPECT_MAX_CHARS, and the
// inspection refused as invalid_output exactly when chat must report the blocker (L.7 item 8). The bound is kept; the projection shrinks.
/** The report itself when it fits the inspection bound; otherwise a shortened copy, `truncated: true`, shrunk step by step until it fits:
 *  each missing role's search query, then its category, then all but each block's first missing role, then the plan's assumptions and
 *  coverage from the end, then the oldest activity lines. A report that still does not fit is left to `read`'s honest refusal. */
function fitInspectionBound(report: Record<string, unknown>): Record<string, unknown> {
  const fits = (value: Record<string, unknown>): boolean => JSON.stringify({ report: value }).length <= GENERATION_TASK_INSPECT_MAX_CHARS;
  if (fits(report)) return report;
  const shortened: Record<string, unknown> = { ...structuredClone(report), truncated: true, truncation: "This inspection is shortened to fit its bound: some missing-part search queries, categories or extra roles, trailing assumptions or coverage lines, or older activity lines, or sheet details (each sheet's rails and ports, trailing interfaces and findings) are left out. The status card on the page shows them all." }; // [PR-J, 2026-10-22] + sheet details
  const task = isRecord(shortened.task) ? shortened.task : null;
  const plan = task && isRecord(task.plan) ? task.plan : null;
  const blocks = plan && Array.isArray(plan.blocks) ? plan.blocks.filter(isRecord) : [];
  const missingOf = (block: Record<string, unknown>): Record<string, unknown>[] => (Array.isArray(block.missing) ? block.missing.filter(isRecord) : []);
  const steps: Array<() => void> = [
    () => { for (const block of blocks) for (const entry of missingOf(block)) delete entry.query; },
    () => { for (const block of blocks) for (const entry of missingOf(block)) delete entry.category; },
    () => { for (const block of blocks) if (Array.isArray(block.missing) && block.missing.length > 1) block.missing = block.missing.slice(0, 1); },
  ...sheetSummarySteps(shortened, fits)]; // [PR-J, 2026-10-22] J5-1: then the sheet summary's details
  for (const step of steps) { step(); if (fits(shortened)) return shortened; }
  const lists = plan ? (["assumptions", "coverage"] as const).filter((key) => Array.isArray(plan[key])) : [];
  for (;;) {
    const longest = lists.map((key) => plan![key] as unknown[]).filter((list) => list.length > 0).sort((a, b) => b.length - a.length)[0];
    if (!longest) break;
    longest.pop();
    if (fits(shortened)) return shortened;
  }
  while (task && Array.isArray(task.activity) && task.activity.length > 0 && !fits(shortened)) task.activity.shift();
  return shortened;
}

// [PR-J, 2026-10-22] Runbook J.6.7, increment J5-1 (OD-255 item 9), appended after the last line (function declarations are hoisted): a
// planned result's sheet set as the inspection's bounded summary - the overview, each sheet's name, status, component COUNT, ports and
// rails, the interfaces between sheets, the project rails and the findings (why a result stays on one page, an omitted sheet's unbound
// ports). Never a reference designator list or the netlist. A malformed or absent sheet set adds nothing. `fitInspectionBound` shortens
// it after the missing-role steps: findings beyond the first 3, each sheet's rails, each sheet's ports, the project rails' sheet lists,
// then trailing interfaces (counted, never silently).
/** The inspection's sheet summary of a result's `sheets` field, or nothing. */
function sheetSummaryOf(value: unknown): { sheets?: Record<string, unknown> } {
  if (value === undefined) return {};
  const doc = readGeneratedSheets(value);
  if (!doc) return {};
  if (!doc.sheets) return { sheets: { layout: "one-page", findings: [...doc.findings] } };
  const set = doc.sheets;
  return {
    sheets: {
      layout: "sheets", overview: set.root.name,
      sheets: set.children.map((child) => ({ sheetKey: child.sheetKey, name: child.name, status: child.status, components: child.components.length, localNets: child.localNets.length, ports: child.ports.map((port) => ({ net: port.net, direction: port.direction, state: port.state })), rails: child.rails.map((rail) => rail.net) })),
      interfaces: set.interfaces.map((entry) => ({ net: entry.net, sheets: entry.ports.map((key) => key.slice(0, key.indexOf(":"))), state: entry.state })),
      rails: set.rails.map((rail) => ({ net: rail.net, kind: rail.kind, sheets: [...rail.sheets] })),
      findings: [...doc.findings],
    },
  };
}
/** The shortening steps of the sheet summary inside a report copy (each step runs only while the report does not fit). */
function sheetSummarySteps(report: Record<string, unknown>, fits: (value: Record<string, unknown>) => boolean): Array<() => void> {
  const result = isRecord(report.result) ? report.result : null;
  const summary = result && isRecord(result.sheets) ? result.sheets : null;
  if (!summary) return [];
  const sheets = Array.isArray(summary.sheets) ? summary.sheets.filter(isRecord) : [];
  return [
    () => { if (Array.isArray(summary.findings) && summary.findings.length > 3) summary.findings = summary.findings.slice(0, 3); },
    () => { for (const sheet of sheets) delete sheet.rails; },
    () => { for (const sheet of sheets) delete sheet.ports; },
    () => { if (Array.isArray(summary.rails)) for (const rail of summary.rails) if (isRecord(rail)) delete rail.sheets; },
    () => {
      if (!Array.isArray(summary.interfaces)) return;
      const total = summary.interfaces.length;
      while (summary.interfaces.length > 0 && !fits(report)) { summary.interfaces.pop(); summary.interfacesOmitted = total - summary.interfaces.length; }
    },
  ];
}
