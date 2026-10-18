/**
 * [PR-L, 2026-10-18] Runbook L.5, increment 5 (task-worker-contract.md section 8; OD-252 item 6): the PURE, browser-safe contracts the
 * chat's three durable-generation tools share with the page that receives their events. Nothing here runs a design, reads a store or
 * calls a provider; the services live in generation-proposals.ts, the page's receivers in app/lib/project/generation-proposal-events.ts.
 *
 *  - `sirkit.schematic.generate-proposal@2.0.0` starts or attaches the scope's ONE durable generation task through the SAME
 *    `GenerationTaskService.start` the Build composer's `POST /api/generation-tasks` calls. Its outcome is a TASK REFERENCE
 *    (`sirkit.generation-task-ref.v1`), never a sealed design: the page receives it as `generation_task_ready` and follows the task
 *    with the same status card and the same review intake as a Build start. A reference grants nothing: the page re-reads the task
 *    through its own authorized `GET /api/generation-tasks/[id]`.
 *  - `sirkit.generation.task-inspect@1.0.0` is a Tier 0 read of the task's PUBLIC snapshot (never the prompt, the conversation, a tool
 *    output or hidden reasoning) and, once it is reviewable, a bounded summary of its validated result (counts and checks, never the
 *    netlist).
 *  - `sirkit.generation.task-control@1.0.0` SEALS a control request (`sirkit.generation-task-control-request.v1`: cancel, pause,
 *    resume or retry one block) that the page shows as a confirm chip; only the human's click sends it to the task's control route,
 *    under the human's own authorization (OD-252 item 6: no direct agent control).
 *
 * Stop answer vs Stop design: the chat's Stop answer ends the streaming turn only - the route aborts the run, never the task; a chat
 * turn's 120 s run deadline likewise ends the TURN. Stop design is the task's `cancel` (the status card's button, or a confirmed chip).
 */
import { engineeringDigest } from "../engineering/stable";

/** The start tool (generation-proposals.ts AGENT_GENERATION_PROPOSAL_TOOL_ID is this constant), here so the page can name it without the services. */
export const GENERATION_START_TOOL_ID = "sirkit.schematic.generate-proposal" as const;
export const GENERATION_TASK_INSPECT_TOOL_ID = "sirkit.generation.task-inspect" as const;
export const GENERATION_TASK_CONTROL_TOOL_ID = "sirkit.generation.task-control" as const;
/** The reference a start or attach answers (the `generation_task_ready` event's payload). */
export const GENERATION_TASK_REF_SCHEMA = "sirkit.generation-task-ref.v1" as const;
/** The sealed control request (the `generation_task_control_ready` event's payload): a chip the human confirms or dismisses. */
export const GENERATION_TASK_CONTROL_SCHEMA = "sirkit.generation-task-control-request.v1" as const;
/** The inspection report's schema. */
export const GENERATION_TASK_INSPECTION_SCHEMA = "sirkit.generation-task-inspection.v1" as const;
/** A control request expires like a sealed proposal; an expired chip can only be asked for again. */
export const GENERATION_TASK_CONTROL_TTL_MS = 10 * 60 * 1000;
/** The inspection's serialized bound (characters of the canonical JSON the model receives); a snapshot is far below it. */
export const GENERATION_TASK_INSPECT_MAX_CHARS = 16_000;
/** The control actions the assistant may ASK for (the human confirms each); extending an allowance and reviews stay the page's own. */
export const GENERATION_TASK_CONTROL_TOOL_ACTIONS = Object.freeze(["cancel", "pause", "resume", "retry-block"] as const);
export type GenerationTaskControlToolAction = (typeof GENERATION_TASK_CONTROL_TOOL_ACTIONS)[number];
/** The chip's confirm label per action: the SAME words as the status card's buttons (generation-task-client.ts GENERATION_TASK_ACTION_LABELS). */
export const GENERATION_TASK_CONTROL_LABELS: Readonly<Record<GenerationTaskControlToolAction, string>> = Object.freeze({ cancel: "Stop design", pause: "Pause design", resume: "Resume design", "retry-block": "Retry block" });
/** The task id shape (generation-task/vocabulary.ts TASK_ID), repeated here so this module stays free of the store's imports. */
export const GENERATION_TASK_ID_PATTERN = /^generation-task:[0-9a-f]{32}$/;
/** The block ids a retry may name (vocabulary.ts GENERATION_BLOCK_IDS). */
export const GENERATION_TASK_BLOCK_IDS = Object.freeze(["main", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"] as const);

/** The semantics the manuals, the page's chat footer and the coverage matrix state (one sentence each, never paraphrased per surface). */
export const STOP_ANSWER_SEMANTICS = "Stop answer ends the assistant's streaming reply only (the chat run); a design task it started or attached keeps running in its worker - Stop design stops that." as const;
export const STOP_DESIGN_SEMANTICS = "Stop design cancels the project's durable design task (its control route's cancel): nothing more runs, and a late result is refused; the chat conversation is unaffected." as const;

export interface GenerationTaskScopeRef { tenantId: string; projectId: string; branchId: string }

/** How a start call reached its task. */
export const GENERATION_TASK_DISPOSITIONS = Object.freeze(["started", "attached-same-request", "attached-active"] as const);
export type GenerationTaskDisposition = (typeof GENERATION_TASK_DISPOSITIONS)[number];

/** A task reference: identity, scope and the state when the call answered - display data, never authority. */
export interface GenerationTaskReference {
  schema: typeof GENERATION_TASK_REF_SCHEMA;
  taskId: string;
  scope: GenerationTaskScopeRef;
  disposition: GenerationTaskDisposition;
  /** whether the attached task was asked for the same request as this call (false: the project's running design was attached instead) */
  sameRequest: boolean;
  state: string;
  phase: string | null;
  origin: "build" | "chat";
  liveness: string;
  base: { schematicDigest: string; recipe: string };
  result: { status: "complete" | "partial"; omittedBlocks: string[]; resultDigest: string } | null;
  durability: "durable" | "process-memory";
  createdAt: string;
}

/** The sealed control request a chip carries. Receiving or showing it changes NOTHING; the human's click sends it. */
export interface SealedGenerationTaskControlRequest {
  schema: typeof GENERATION_TASK_CONTROL_SCHEMA;
  requestId: string;
  toolId: typeof GENERATION_TASK_CONTROL_TOOL_ID;
  version: string;
  scope: GenerationTaskScopeRef;
  taskId: string;
  action: GenerationTaskControlToolAction;
  blockId: string | null;
  /** the chip's confirm label (GENERATION_TASK_CONTROL_LABELS, with the block's name for a retry) */
  label: string;
  /** the task's state when the request was sealed (the server judges the action again when the human confirms it) */
  stateAtRequest: string;
  actor: { actorId: string; kind: "ai" };
  effectiveActor: { actorId: string; kind: "human" | "worker" };
  provenance: { provider: string; runId: string };
  createdAt: number;
  expiresAt: number;
}

const CONTROL_KEYS = Object.freeze(["schema", "requestId", "toolId", "version", "scope", "taskId", "action", "blockId", "label", "stateAtRequest", "actor", "effectiveActor", "provenance", "createdAt", "expiresAt"] as const);
const CONTROL_IDENTITY_SCHEMA = "sirkit.generation-task-control-request-id.v1";
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const boundedString = (value: unknown, max: number): value is string => typeof value === "string" && value.length >= 1 && value.length <= max;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Seal a control request. Pure: the caller supplied every server-derived fact (the task was read in the trusted scope). */
export function sealGenerationTaskControlRequest(input: Omit<SealedGenerationTaskControlRequest, "schema" | "requestId" | "toolId" | "expiresAt">): SealedGenerationTaskControlRequest {
  const body = {
    schema: GENERATION_TASK_CONTROL_SCHEMA, toolId: GENERATION_TASK_CONTROL_TOOL_ID, version: input.version,
    scope: { tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId },
    taskId: input.taskId, action: input.action, blockId: input.blockId, label: input.label, stateAtRequest: input.stateAtRequest,
    actor: { ...input.actor }, effectiveActor: { ...input.effectiveActor }, provenance: { provider: input.provenance.provider, runId: input.provenance.runId },
    createdAt: input.createdAt, expiresAt: input.createdAt + GENERATION_TASK_CONTROL_TTL_MS,
  };
  return deepFreeze({ ...body, requestId: `gtctl-${engineeringDigest({ schema: CONTROL_IDENTITY_SCHEMA, body }).slice(5)}` });
}

export type GenerationTaskControlVerification = { ok: true } | { ok: false; code: "malformed" | "wrong-version" | "altered"; detail: string };

/** INTEGRITY-ONLY verification (the page's receiver runs it first): schema, exact key set, the closed action, the sealed identity.
 *  Currency (the page's project, expiry) is the receiver's own check; the action's validity is the control route's when confirmed. */
export function verifySealedGenerationTaskControlRequest(candidate: unknown): GenerationTaskControlVerification {
  if (!isRecord(candidate)) return { ok: false, code: "malformed", detail: "The control request is not an object." };
  if (candidate.schema !== GENERATION_TASK_CONTROL_SCHEMA) return { ok: false, code: "wrong-version", detail: `The control request is not a ${GENERATION_TASK_CONTROL_SCHEMA} artifact.` };
  if (Object.keys(candidate).sort().join(",") !== [...CONTROL_KEYS].sort().join(",")) return { ok: false, code: "malformed", detail: "The control request does not carry exactly the sealed key set." };
  if (candidate.toolId !== GENERATION_TASK_CONTROL_TOOL_ID || !boundedString(candidate.version, 20)) return { ok: false, code: "malformed", detail: "The control request names another tool." };
  const scope = candidate.scope;
  if (!isRecord(scope) || !boundedString(scope.tenantId, 200) || !boundedString(scope.projectId, 200) || !boundedString(scope.branchId, 200) || Object.keys(scope).length !== 3) return { ok: false, code: "malformed", detail: "The control request's scope is malformed." };
  if (typeof candidate.taskId !== "string" || !GENERATION_TASK_ID_PATTERN.test(candidate.taskId)) return { ok: false, code: "malformed", detail: "The control request names no task." };
  if (typeof candidate.action !== "string" || !(GENERATION_TASK_CONTROL_TOOL_ACTIONS as readonly string[]).includes(candidate.action)) return { ok: false, code: "malformed", detail: "The control request's action is outside the closed list." };
  if (candidate.action === "retry-block" ? !(typeof candidate.blockId === "string" && (GENERATION_TASK_BLOCK_IDS as readonly string[]).includes(candidate.blockId)) : candidate.blockId !== null) return { ok: false, code: "malformed", detail: "The control request's block does not fit its action." };
  if (!boundedString(candidate.label, 160) || !boundedString(candidate.stateAtRequest, 40)) return { ok: false, code: "malformed", detail: "The control request's label or state is malformed." };
  if (!isRecord(candidate.actor) || candidate.actor.kind !== "ai" || !boundedString(candidate.actor.actorId, 200) || !isRecord(candidate.effectiveActor) || (candidate.effectiveActor.kind !== "human" && candidate.effectiveActor.kind !== "worker") || !boundedString(candidate.effectiveActor.actorId, 200)) return { ok: false, code: "malformed", detail: "The control request's actors are malformed." };
  if (!isRecord(candidate.provenance) || !boundedString(candidate.provenance.provider, 40) || !boundedString(candidate.provenance.runId, 200)) return { ok: false, code: "malformed", detail: "The control request's provenance is malformed." };
  if (typeof candidate.createdAt !== "number" || !Number.isFinite(candidate.createdAt) || candidate.expiresAt !== candidate.createdAt + GENERATION_TASK_CONTROL_TTL_MS) return { ok: false, code: "malformed", detail: "The control request's times are malformed." };
  const { requestId, ...body } = candidate;
  if (`gtctl-${engineeringDigest({ schema: CONTROL_IDENTITY_SCHEMA, body }).slice(5)}` !== requestId) return { ok: false, code: "altered", detail: "The control request does not match its sealed identity." };
  return { ok: true };
}

/** A task reference, or null when the value is not one (the page's receiver reads every field defensively). */
export function readGenerationTaskReference(value: unknown): GenerationTaskReference | null {
  if (!isRecord(value) || value.schema !== GENERATION_TASK_REF_SCHEMA) return null;
  if (typeof value.taskId !== "string" || !GENERATION_TASK_ID_PATTERN.test(value.taskId)) return null;
  const scope = value.scope;
  if (!isRecord(scope) || !boundedString(scope.tenantId, 200) || !boundedString(scope.projectId, 200) || !boundedString(scope.branchId, 200)) return null;
  if (typeof value.disposition !== "string" || !(GENERATION_TASK_DISPOSITIONS as readonly string[]).includes(value.disposition)) return null;
  if (!boundedString(value.state, 40) || !boundedString(value.liveness, 40) || (value.origin !== "build" && value.origin !== "chat") || (value.durability !== "durable" && value.durability !== "process-memory") || !boundedString(value.createdAt, 40)) return null;
  const base = value.base;
  if (!isRecord(base) || !boundedString(base.schematicDigest, 200) || !boundedString(base.recipe, 40)) return null;
  const result = isRecord(value.result) && (value.result.status === "complete" || value.result.status === "partial") && boundedString(value.result.resultDigest, 100)
    ? { status: value.result.status as "complete" | "partial", omittedBlocks: Array.isArray(value.result.omittedBlocks) ? value.result.omittedBlocks.filter((entry): entry is string => boundedString(entry, 200)).slice(0, 8) : [], resultDigest: value.result.resultDigest }
    : null;
  return {
    schema: GENERATION_TASK_REF_SCHEMA, taskId: value.taskId, scope: { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId },
    disposition: value.disposition as GenerationTaskDisposition, sameRequest: value.sameRequest === true, state: value.state, phase: typeof value.phase === "string" ? value.phase.slice(0, 40) : null,
    origin: value.origin, liveness: value.liveness, base: { schematicDigest: base.schematicDigest, recipe: base.recipe }, result, durability: value.durability, createdAt: value.createdAt,
  };
}

/** The deterministic client request id of a chat start: one per (scope, run, provider call). A retried call of the same run attaches to
 *  the task it started (the store's idempotency); a new turn is a new request (and attaches to the scope's active task, if any). A v8
 *  uuid (the store's CLIENT_REQUEST_ID shape) from two salted engineering digests: browser-safe, no randomness. */
export function generationChatClientRequestId(input: { scope: GenerationTaskScopeRef; runId: string; callId: string }): string {
  const material = { schema: "sirkit.generation-chat-request.v1", scope: { tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId }, runId: input.runId, callId: input.callId };
  const hex = `${engineeringDigest({ salt: "a", material }).slice(5)}${engineeringDigest({ salt: "b", material }).slice(5)}`;
  const variant = "89ab"[parseInt(hex[16]!, 16) & 3]!;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
