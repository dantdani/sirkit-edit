/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md section 7): the BROWSER side of the durable generation task - the
 * one client the page's composer (and, since increment 5, the chat's generation intake) uses to start or attach a design, follow its real
 * public progress, control it and fetch its validated result. Browser-safe: no server import (types are mirrored and every answer is
 * READ defensively - a server answer that is not the snapshot shape is dropped, never trusted).
 *
 *  - Start: `startGenerationTask` POSTs the request with a client request id the caller keeps for the request; a network failure after
 *    the request left (a lost 202) is retried with the SAME id, so the server answers the same task (`attached: true`), never a second.
 *  - Follow: `subscribeGenerationTask` reads `GET /api/generation-tasks/[id]/events` from a durable cursor: an EventSource stream when
 *    the browser has one (milestones, snapshots, heartbeats; resumed with Last-Event-ID), falling back to JSON polling (1 s, backoff on
 *    failure) when the stream errors before its first message or sends nothing for 5 s. Unsubscribing only stops observing: the design
 *    keeps running (Stop design is `controlGenerationTask(..., "cancel")`).
 *  - View: `reduceGenerationTaskView` is pure: snapshot + new milestones -> the view the activity log shows (state, phase, liveness,
 *    blocks, counts, elapsed time from the SERVER's clock, the live activity line, the valid actions) and the milestones not yet shown.
 *    No percentage is ever computed: a design has no known end.
 */
import { aiRequestHeaders, type AiRequestScope } from "./ai-request";
import { projectSelectorQuery } from "./project-selector";
import type { BuildLogicalNetlist } from "@/lib/schematic-types"; import { readGeneratedSheets, type GeneratedSheets } from "@/app/lib/schematic/generated-sheets"; // [PR-J, 2026-10-22] J5-1: a pure, browser-safe reader

export const GENERATION_TASKS_ENDPOINT = "/api/generation-tasks";
export const GENERATION_TASK_SNAPSHOT_SCHEMA = "sirkit.generation-task-snapshot.v1";

export const GENERATION_TASK_CLIENT_STATES = Object.freeze(["queued", "running", "waiting-for-provider", "waiting-for-resource", "awaiting-review", "paused", "cancel-requested", "cancelled", "succeeded", "failed", "stale"] as const);
export type GenerationTaskClientState = (typeof GENERATION_TASK_CLIENT_STATES)[number];
export const GENERATION_TASK_CLIENT_LIVENESS = Object.freeze(["running", "lease_expired", "waiting_for_worker", "no_worker", "workers_busy", "scheduled", "idle"] as const);
export type GenerationTaskClientLiveness = (typeof GENERATION_TASK_CLIENT_LIVENESS)[number];
/** The server-computed control actions a snapshot may list. */
export const GENERATION_TASK_CLIENT_ACTIONS = Object.freeze(["cancel", "pause", "resume", "extend-allowance", "retry-block", "review-partial", "record-review", "report-base"] as const);
export type GenerationTaskClientAction = (typeof GENERATION_TASK_CLIENT_ACTIONS)[number];

export interface GenerationTaskSnapshotView {
  taskId: string;
  clientRequestId: string;
  scope: { tenantId: string; projectId: string; branchId: string };
  state: GenerationTaskClientState;
  terminal: boolean;
  phase: string | null;
  /** [PR-L, 2026-10-18] who started it: the Build composer, or the assistant in the chat (runbook L.5) - the same task either way */
  origin: "build" | "chat";
  provider: string;
  createdAt: string;
  updatedAt: string;
  serverNow: string;
  liveness: { state: GenerationTaskClientLiveness; since: string | null; retryAt: string | null };
  /** [PR-L6, 2026-10-19] `coverage` (the planner's requested functions) and a block's `missing` roles (it waits for those parts) only when present */
  plan: { planner: string; rationale: string; assumptions: string[]; coverage?: string[]; blocks: Array<{ blockId: string; name: string; status: string; strategy: string; turnsUsed: number; blocker: string | null; missing?: Array<{ role: string; query: string; category: string | null }>; /** [PR-J, 2026-11-04] J7-2: queued again while running blocks hold the allowance it needs */ waiting?: "allowance" }> } | null;
  blocker: { code: string; message: string; resolution: string; blockId: string | null } | null;
  failure: { reason: string; at: string } | null;
  usage: { slices: number; attempts: number; modelCalls: number; uncertainModelCalls: number; inputTokens: number; outputTokens: number; catalogSearches: number; cacheHits: number }; /** [K2, 2026-11-04] K1 case 6 (OD-260 item 5): what is LEFT of the task's allowance in units (calls, tokens, searches - never money), as the server snapshot says; absent when the snapshot has none or it is malformed */ allowance?: GenerationTaskAllowanceView;
  base: { schematicDigest: string; recipe: string; moved: boolean };
  result: { status: "complete" | "partial"; omittedBlocks: string[]; resultDigest: string } | null;
  review: { outcome: string; at: string } | null;
  control: { cancelRequested: boolean; pauseRequested: boolean };
  actions: GenerationTaskClientAction[];
  retryBlocks: string[];
  eventCursor: number;
  activity: Array<{ at: string; text: string }>;
  /** the request's prompt, present only on `GET /api/generation-tasks/[id]` (project members) */
  prompt?: string;
}
export interface GenerationTaskEventView { seq: number; at: string; type: string; phase: string | null; blockId: string | null; message: string }
export interface GenerationTaskResultView {
  status: "complete" | "partial";
  omittedBlocks: string[];
  netlist: BuildLogicalNetlist;
  explanation: string;
  electricalCheck: { state: string; [key: string]: unknown };
  resultDigest: string; /** [PR-J, 2026-10-22] J5-1 (OD-255 item 9): a planned result's sheet set (or why it stays one page), read defensively; absent when the result has none or it is malformed. [PR-J5 integration, 2026-10-26] review B-7: the page lays it out as real sheets (lib/build-sheet-layout.ts) before the review. */ sheets?: GeneratedSheets;
}
export interface GenerationTaskFailure { ok: false; status: number; code: string; message: string; retryable: boolean; activeTask?: GenerationTaskSnapshotView | null }

// ─── Defensive readers ───────────────────────────────────────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown, max = 4_000): value is string => typeof value === "string" && value.length <= max;
const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
/** [PR-L6, 2026-10-19] A block's unfilled roles as the snapshot lists them (at most 3, bounded strings), or nothing. */
function missingRolesOf(value: unknown): { missing?: Array<{ role: string; query: string; category: string | null }> } {
  if (!Array.isArray(value)) return {};
  const missing = value.filter(isRecord).filter((entry) => str(entry.role, 200)).slice(0, 3).map((entry) => ({ role: entry.role as string, query: str(entry.query, 400) ? (entry.query as string) : "", category: str(entry.category, 200) ? (entry.category as string) : null }));
  return missing.length ? { missing } : {};
}
const strOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The snapshot, or null when the value is not the snapshot shape (never trusted half-read). */
export function readGenerationTaskSnapshot(value: unknown): GenerationTaskSnapshotView | null {
  if (!isRecord(value) || value.schema !== GENERATION_TASK_SNAPSHOT_SCHEMA) return null;
  if (!str(value.taskId, 200) || !str(value.clientRequestId, 64) || !(GENERATION_TASK_CLIENT_STATES as readonly string[]).includes(value.state as string)) return null;
  if (!isRecord(value.scope) || !str(value.scope.tenantId) || !str(value.scope.projectId) || !str(value.scope.branchId)) return null;
  if (!str(value.createdAt, 40) || !str(value.updatedAt, 40) || !str(value.serverNow, 40) || !isRecord(value.liveness) || !(GENERATION_TASK_CLIENT_LIVENESS as readonly string[]).includes(value.liveness.state as string)) return null;
  if (!isRecord(value.usage) || !isRecord(value.base) || !isRecord(value.control) || !Array.isArray(value.actions) || !Array.isArray(value.activity) || !num(value.eventCursor)) return null;
  const usage = value.usage, plan = isRecord(value.plan) ? value.plan : null;
  return {
    taskId: value.taskId, clientRequestId: value.clientRequestId,
    scope: { tenantId: value.scope.tenantId, projectId: value.scope.projectId, branchId: value.scope.branchId },
    state: value.state as GenerationTaskClientState, terminal: value.terminal === true, phase: strOrNull(value.phase), origin: value.origin === "chat" ? "chat" : "build", provider: str(value.provider, 40) ? value.provider : "",
    createdAt: value.createdAt, updatedAt: value.updatedAt, serverNow: value.serverNow,
    liveness: { state: value.liveness.state as GenerationTaskClientLiveness, since: strOrNull(value.liveness.since), retryAt: strOrNull(value.liveness.retryAt) },
    plan: plan && Array.isArray(plan.blocks)
      ? {
        planner: str(plan.planner, 40) ? plan.planner : "", rationale: str(plan.rationale, 1_000) ? plan.rationale : "",
        assumptions: Array.isArray(plan.assumptions) ? plan.assumptions.filter((entry): entry is string => str(entry, 400)).slice(0, 8) : [],
        ...(Array.isArray(plan.coverage) && plan.coverage.some((entry) => str(entry, 400)) ? { coverage: plan.coverage.filter((entry): entry is string => str(entry, 400)).slice(0, 8) } : {}), // [PR-L6, 2026-10-19]
        blocks: plan.blocks.filter(isRecord).slice(0, 8).map((block) => ({ blockId: str(block.blockId, 8) ? block.blockId : "", name: str(block.name, 200) ? block.name : "", status: str(block.status, 40) ? block.status : "", strategy: str(block.strategy, 40) ? block.strategy : "", turnsUsed: num(block.turnsUsed) ? block.turnsUsed : 0, blocker: strOrNull(block.blocker), ...missingRolesOf(block.missing), ...(block.waiting === "allowance" ? { waiting: "allowance" as const } : {}) })), // [PR-J, 2026-11-04] J7-2: any other value is dropped
      }
      : null,
    blocker: isRecord(value.blocker) && str(value.blocker.code, 40) && str(value.blocker.message, 600) && str(value.blocker.resolution, 600) ? { code: value.blocker.code, message: value.blocker.message, resolution: value.blocker.resolution, blockId: strOrNull(value.blocker.blockId) } : null,
    failure: isRecord(value.failure) && str(value.failure.reason, 40) ? { reason: value.failure.reason, at: str(value.failure.at, 40) ? value.failure.at : "" } : null,
    ...allowanceOf(value.allowance), /* [K2, 2026-11-04] K1 case 6: the remaining allowance is kept (read defensively; on this line so no cited line moves) */ usage: { slices: num(usage.slices) ? usage.slices : 0, attempts: num(usage.attempts) ? usage.attempts : 0, modelCalls: num(usage.modelCalls) ? usage.modelCalls : 0, uncertainModelCalls: num(usage.uncertainModelCalls) ? usage.uncertainModelCalls : 0, inputTokens: num(usage.inputTokens) ? usage.inputTokens : 0, outputTokens: num(usage.outputTokens) ? usage.outputTokens : 0, catalogSearches: num(usage.catalogSearches) ? usage.catalogSearches : 0, cacheHits: num(usage.cacheHits) ? usage.cacheHits : 0 },
    base: { schematicDigest: str(value.base.schematicDigest, 200) ? value.base.schematicDigest : "", recipe: str(value.base.recipe, 40) ? value.base.recipe : "", moved: value.base.moved === true },
    result: isRecord(value.result) && (value.result.status === "complete" || value.result.status === "partial") && str(value.result.resultDigest, 100) ? { status: value.result.status, omittedBlocks: Array.isArray(value.result.omittedBlocks) ? value.result.omittedBlocks.filter((entry): entry is string => str(entry, 200)) : [], resultDigest: value.result.resultDigest } : null,
    review: isRecord(value.review) && str(value.review.outcome, 40) ? { outcome: value.review.outcome, at: str(value.review.at, 40) ? value.review.at : "" } : null,
    control: { cancelRequested: value.control.cancelRequested === true, pauseRequested: value.control.pauseRequested === true },
    actions: value.actions.filter((action): action is GenerationTaskClientAction => (GENERATION_TASK_CLIENT_ACTIONS as readonly string[]).includes(action as string)),
    retryBlocks: Array.isArray(value.retryBlocks) ? value.retryBlocks.filter((entry): entry is string => str(entry, 8)) : [],
    eventCursor: value.eventCursor,
    activity: value.activity.filter(isRecord).filter((line) => str(line.at, 40) && str(line.text, 400)).slice(-8).map((line) => ({ at: line.at as string, text: line.text as string })),
    ...(str(value.prompt, 4_000) ? { prompt: value.prompt } : {}),
  };
}
function readEvent(value: unknown): GenerationTaskEventView | null {
  if (!isRecord(value) || !num(value.seq) || !str(value.at, 40) || !str(value.type, 40) || !str(value.message, 400)) return null;
  return { seq: value.seq, at: value.at, type: value.type, phase: strOrNull(value.phase), blockId: strOrNull(value.blockId), message: value.message };
}
function readResult(value: unknown): GenerationTaskResultView | null {
  if (!isRecord(value) || (value.status !== "complete" && value.status !== "partial") || !isRecord(value.netlist) || !Array.isArray(value.netlist.components) || !Array.isArray(value.netlist.connections)) return null;
  if (!str(value.explanation, 10_000) || !isRecord(value.electricalCheck) || !str(value.electricalCheck.state, 40) || !str(value.resultDigest, 100)) return null;
  return { status: value.status, omittedBlocks: Array.isArray(value.omittedBlocks) ? value.omittedBlocks.filter((entry): entry is string => str(entry, 200)) : [], netlist: value.netlist as unknown as BuildLogicalNetlist, explanation: value.explanation, electricalCheck: value.electricalCheck as GenerationTaskResultView["electricalCheck"], resultDigest: value.resultDigest, ...sheetsOf(value.sheets) }; // [PR-J, 2026-10-22] J5-1: a malformed sheet set is dropped, never the result
}

// ─── Requests ────────────────────────────────────────────────────────────────────────────────────────────────────────────

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchLike = (input, init) => fetch(input, init);
const isAbort = (error: unknown): boolean => (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError");

async function failureOf(response: Response): Promise<GenerationTaskFailure> {
  const body: unknown = await response.json().catch(() => null);
  const record = isRecord(body) ? body : {};
  const code = str(record.code, 80) ? record.code : `HTTP_${response.status}`;
  const message = str(record.error, 600) ? record.error : `The design task request failed (${response.status}).`;
  return { ok: false, status: response.status, code, message, retryable: response.status >= 500 || code === "GENERATION_TASK_CONTENDED", ...(record.activeTask !== undefined ? { activeTask: readGenerationTaskSnapshot(record.activeTask) } : {}) };
}
const networkFailure = (error: unknown): GenerationTaskFailure => ({ ok: false, status: 0, code: isAbort(error) ? "ABORTED" : "NETWORK", message: isAbort(error) ? "The request was cancelled." : "The server could not be reached.", retryable: !isAbort(error) });

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  const handle = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(handle); resolve(); }, { once: true });
});

/** A random v4 UUID from `crypto.getRandomValues` - deliberately NOT `crypto.randomUUID`, which the editor's own ids (components, wires,
 *  log lines) come from: a design task's request and action ids are transport identities and must not shift the editor's id sequence
 *  (the fixture browser numbers `randomUUID` draws, and the committed router recording is keyed by the placed board those ids name). */
export function randomGenerationUuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A client request id: the given source's value when it is a v1-8 UUID, else a random v4 one (the server's shape). */
export function newGenerationClientRequestId(random: () => string = randomGenerationUuid): string {
  const candidate = random();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate)) return candidate;
  return randomGenerationUuid();
}

/** One control action's id (a repeat of the same id answers the same result): a random v4 UUID, never a `crypto.randomUUID` draw. */
export function newGenerationClientActionId(): string { return randomGenerationUuid(); }

let activityLineSeq = 0;
/** The id of one activity-log line the design task writes (its milestones, its status lines): a page-local sequence, never a
 *  `crypto.randomUUID` draw, for the same reason as `randomGenerationUuid` - the task's progress lines do not shift the editor's ids. */
export function generationActivityLineId(): string { activityLineSeq += 1; return `generation-task-line-${activityLineSeq}`; }

export interface StartGenerationTaskInput {
  scope: AiRequestScope;
  clientRequestId: string;
  prompt: string;
  provider: string;
  base: { schematicDigest: string; recipe: "build-pin" | "chat-sheet"; headMark?: unknown };
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  /** network retries of the SAME request after a lost answer (default 2) */
  retries?: number;
  retryDelayMs?: number;
}
export type StartGenerationTaskOutcome = { ok: true; task: GenerationTaskSnapshotView; attached: boolean; durability: string | null } | GenerationTaskFailure;

/** Start (or attach to) the design; a lost answer is retried with the SAME client request id (the server's idempotent start). */
export async function startGenerationTask(input: StartGenerationTaskInput): Promise<StartGenerationTaskOutcome> {
  const fetchImpl = input.fetchImpl ?? defaultFetch;
  const body = JSON.stringify({ clientRequestId: input.clientRequestId, prompt: input.prompt, provider: input.provider, base: { schematicDigest: input.base.schematicDigest, recipe: input.base.recipe, ...(input.base.headMark ? { headMark: input.base.headMark } : {}) } });
  const retries = input.retries ?? 2;
  let last: GenerationTaskFailure = networkFailure(new Error("unsent"));
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep((input.retryDelayMs ?? 500) * attempt, input.signal);
    if (input.signal?.aborted) return networkFailure(new DOMException("aborted", "AbortError"));
    let response: Response;
    try { response = await fetchImpl(GENERATION_TASKS_ENDPOINT, { method: "POST", headers: aiRequestHeaders(input.scope), body, ...(input.signal ? { signal: input.signal } : {}) }); }
    catch (error) { last = networkFailure(error); if (isAbort(error)) return last; continue; } // the answer may be lost after acceptance: the same id again
    if (response.status !== 202) return failureOf(response);
    const parsed: unknown = await response.json().catch(() => null);
    const task = isRecord(parsed) ? readGenerationTaskSnapshot(parsed.task) : null;
    if (!task) return { ok: false, status: 502, code: "GENERATION_TASK_ANSWER_INVALID", message: "The server's answer was not a design task.", retryable: true };
    return { ok: true, task, attached: isRecord(parsed) && parsed.attached === true, durability: isRecord(parsed) && str(parsed.durability, 40) ? parsed.durability : null };
  }
  return last;
}

/** The scope's active task (what a reload or a project switch reattaches to), or null. */
export async function fetchActiveGenerationTask(scope: AiRequestScope, options: { signal?: AbortSignal; fetchImpl?: FetchLike } = {}): Promise<{ ok: true; active: GenerationTaskSnapshotView | null } | GenerationTaskFailure> {
  try {
    const response = await (options.fetchImpl ?? defaultFetch)(GENERATION_TASKS_ENDPOINT, { method: "GET", headers: aiRequestHeaders(scope), cache: "no-store", ...(options.signal ? { signal: options.signal } : {}) });
    if (!response.ok) return failureOf(response);
    const body: unknown = await response.json().catch(() => null);
    return { ok: true, active: isRecord(body) && body.active !== null ? readGenerationTaskSnapshot(body.active) : null };
  } catch (error) { return networkFailure(error); }
}

/** One task's snapshot and, when asked, its validated result. */
export async function fetchGenerationTask(scope: AiRequestScope, taskId: string, options: { includeResult?: boolean; signal?: AbortSignal; fetchImpl?: FetchLike } = {}): Promise<{ ok: true; task: GenerationTaskSnapshotView; result: GenerationTaskResultView | null } | GenerationTaskFailure> {
  try {
    const url = `${GENERATION_TASKS_ENDPOINT}/${encodeURIComponent(taskId)}${options.includeResult ? "?include=result" : ""}`;
    const response = await (options.fetchImpl ?? defaultFetch)(url, { method: "GET", headers: aiRequestHeaders(scope), cache: "no-store", ...(options.signal ? { signal: options.signal } : {}) });
    if (!response.ok) return failureOf(response);
    const body: unknown = await response.json().catch(() => null);
    const task = isRecord(body) ? readGenerationTaskSnapshot(body.task) : null;
    if (!task) return { ok: false, status: 502, code: "GENERATION_TASK_ANSWER_INVALID", message: "The server's answer was not a design task.", retryable: true };
    return { ok: true, task, result: isRecord(body) && body.result ? readResult(body.result) : null };
  } catch (error) { return networkFailure(error); }
}

export interface GenerationTaskUpdate { task: GenerationTaskSnapshotView; events: GenerationTaskEventView[]; gap: boolean }

/** One JSON page of milestones after `after`, with the snapshot. */
export async function fetchGenerationTaskEvents(scope: AiRequestScope, taskId: string, after: number, options: { signal?: AbortSignal; fetchImpl?: FetchLike } = {}): Promise<({ ok: true; hasMore: boolean; cursor: number } & GenerationTaskUpdate) | GenerationTaskFailure> {
  try {
    const url = `${GENERATION_TASKS_ENDPOINT}/${encodeURIComponent(taskId)}/events?after=${Math.max(0, Math.floor(after))}&limit=50`;
    const response = await (options.fetchImpl ?? defaultFetch)(url, { method: "GET", headers: aiRequestHeaders(scope), cache: "no-store", ...(options.signal ? { signal: options.signal } : {}) });
    if (!response.ok) return failureOf(response);
    const body: unknown = await response.json().catch(() => null);
    const task = isRecord(body) ? readGenerationTaskSnapshot(body.task) : null;
    if (!task || !isRecord(body) || !Array.isArray(body.events)) return { ok: false, status: 502, code: "GENERATION_TASK_ANSWER_INVALID", message: "The server's answer was not a design task.", retryable: true };
    return { ok: true, task, events: body.events.map(readEvent).filter((event): event is GenerationTaskEventView => event !== null), gap: body.gap === true, hasMore: body.hasMore === true, cursor: num(body.cursor) ? body.cursor : after };
  } catch (error) { return networkFailure(error); }
}

export interface ControlGenerationTaskInput {
  action: GenerationTaskClientAction;
  clientActionId: string;
  blockId?: string;
  review?: { outcome: "applied" | "discarded"; resultDigest: string; headMark?: unknown };
  liveBase?: { schematicDigest: string; recipe: "build-pin" | "chat-sheet" };
}
/** A control action (Stop design is `cancel`); the store judges it; the snapshot after it. */
export async function controlGenerationTask(scope: AiRequestScope, taskId: string, input: ControlGenerationTaskInput, options: { signal?: AbortSignal; fetchImpl?: FetchLike } = {}): Promise<{ ok: true; task: GenerationTaskSnapshotView } | GenerationTaskFailure> {
  try {
    const body = JSON.stringify({ action: input.action, clientActionId: input.clientActionId, ...(input.blockId ? { blockId: input.blockId } : {}), ...(input.review ? { review: { outcome: input.review.outcome, resultDigest: input.review.resultDigest, ...(input.review.headMark ? { headMark: input.review.headMark } : {}) } } : {}), ...(input.liveBase ? { liveBase: input.liveBase } : {}) });
    const response = await (options.fetchImpl ?? defaultFetch)(`${GENERATION_TASKS_ENDPOINT}/${encodeURIComponent(taskId)}/control`, { method: "POST", headers: aiRequestHeaders(scope), body, ...(options.signal ? { signal: options.signal } : {}) });
    if (!response.ok) return failureOf(response);
    const parsed: unknown = await response.json().catch(() => null);
    const task = isRecord(parsed) ? readGenerationTaskSnapshot(parsed.task) : null;
    if (!task) return { ok: false, status: 502, code: "GENERATION_TASK_ANSWER_INVALID", message: "The server's answer was not a design task.", retryable: true };
    return { ok: true, task };
  } catch (error) { return networkFailure(error); }
}

// ─── Subscription ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The EventSource the subscription uses (the browser's; a test passes its own). */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data: string; lastEventId?: string }) => void): void;
  close(): void;
  onerror: ((event: unknown) => void) | null;
}
export interface SubscribeGenerationTaskInput {
  scope: AiRequestScope;
  taskId: string;
  /** the cursor already shown (0 = from the start) */
  after: number;
  onUpdate: (update: GenerationTaskUpdate) => void;
  /** a failure streak began (the subscription keeps trying; a 404 ends it) */
  onError?: (failure: GenerationTaskFailure) => void;
  pollMs?: number;
  /** use the server-sent stream when the browser has one (default true) */
  stream?: boolean;
  /** how long a stream may stay silent before the subscription falls back to polling */
  streamSilenceMs?: number;
  fetchImpl?: FetchLike;
  eventSourceFactory?: ((url: string) => EventSourceLike) | null;
}

/** Follow a task until it is terminal or the caller unsubscribes (unsubscribing never cancels the design). */
export function subscribeGenerationTask(input: SubscribeGenerationTaskInput): () => void {
  const controller = new AbortController();
  let cursor = Math.max(0, input.after), stopped = false, source: EventSourceLike | null = null, silence: ReturnType<typeof setTimeout> | null = null;
  const pollMs = input.pollMs ?? 1_000;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    if (silence) clearTimeout(silence);
    try { source?.close(); } catch { /* already closed */ }
  };
  const deliver = (update: GenerationTaskUpdate): void => {
    if (stopped) return;
    for (const event of update.events) cursor = Math.max(cursor, event.seq);
    input.onUpdate(update);
    if (update.task.terminal) stop();
  };
  const poll = async (): Promise<void> => {
    let failures = 0;
    while (!stopped) {
      const page = await fetchGenerationTaskEvents(input.scope, input.taskId, cursor, { signal: controller.signal, ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}) });
      if (stopped) return;
      if (!page.ok) {
        if (page.code === "ABORTED") return;
        failures += 1;
        if (failures === 1) input.onError?.(page);
        if (page.status === 404) { stop(); return; }
        await sleep(Math.min(30_000, pollMs * 2 ** Math.min(5, failures)), controller.signal);
        continue;
      }
      failures = 0;
      cursor = Math.max(cursor, page.cursor);
      deliver({ task: page.task, events: page.events, gap: page.gap });
      if (!page.hasMore) await sleep(pollMs, controller.signal);
    }
  };
  const factory = input.eventSourceFactory === undefined ? (typeof EventSource === "function" ? (url: string) => new EventSource(url) as unknown as EventSourceLike : null) : input.eventSourceFactory;
  if (input.stream === false || factory === null) { void poll(); return stop; }
  // the stream: authorization travels as the selector query (EventSource cannot set headers; never authority)
  const query = projectSelectorQuery(input.scope.projectId ? { tenantId: "local", projectId: input.scope.projectId, branchId: input.scope.branchId } : null);
  const url = `${GENERATION_TASKS_ENDPOINT}/${encodeURIComponent(input.taskId)}/events?after=${cursor}${query ? `&${query}` : ""}`;
  let heard = false, buffered: GenerationTaskEventView[] = [];
  const fallBack = (): void => { if (stopped) return; try { source?.close(); } catch { /* closed */ } source = null; void poll(); };
  const armSilence = (): void => { if (silence) clearTimeout(silence); silence = setTimeout(() => { if (!heard) fallBack(); }, input.streamSilenceMs ?? 5_000); };
  try { source = factory(url); } catch { void poll(); return stop; }
  armSilence();
  source.addEventListener("milestone", (event) => { heard = true; try { const parsed = readEvent(JSON.parse(event.data)); if (parsed && parsed.seq > cursor) buffered.push(parsed); } catch { /* not JSON: dropped */ } });
  source.addEventListener("snapshot", (event) => {
    heard = true;
    let parsed: unknown = null;
    try { parsed = JSON.parse(event.data); } catch { return; }
    const task = isRecord(parsed) ? readGenerationTaskSnapshot(parsed.task) : null;
    if (!task) return;
    const events = buffered.sort((a, b) => a.seq - b.seq);
    buffered = [];
    deliver({ task, events, gap: isRecord(parsed) && parsed.gap === true });
  });
  source.addEventListener("refused", () => { input.onError?.({ ok: false, status: 404, code: "GENERATION_TASK_NOT_FOUND", message: "No such design task in this project.", retryable: false }); stop(); });
  source.onerror = () => { if (!heard) fallBack(); }; // after a first message the browser reconnects by itself, resuming after Last-Event-ID
  return stop;
}

// ─── The view ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GenerationTaskView extends GenerationTaskSnapshotView {
  /** elapsed time on the SERVER's clock (serverNow - createdAt), ms */
  elapsedMs: number;
  /** the milestones shown so far (newest last, at most 60) */
  milestones: GenerationTaskEventView[];
  /** a cursor older than the server's ring was read: the snapshot stands in for the missing milestones */
  gap: boolean;
}

/** Pure: the next view and the milestones it adds (in order, each once). */
export function reduceGenerationTaskView(previous: GenerationTaskView | null, update: GenerationTaskUpdate): { view: GenerationTaskView; added: GenerationTaskEventView[] } {
  const known = previous && previous.taskId === update.task.taskId ? previous : null;
  const seen = new Set((known?.milestones ?? []).map((event) => event.seq));
  const added = [...update.events].sort((a, b) => a.seq - b.seq).filter((event) => { if (seen.has(event.seq)) return false; seen.add(event.seq); return true; });
  const milestones = [...(known?.milestones ?? []), ...added].slice(-60);
  const elapsedMs = Math.max(0, Date.parse(update.task.serverNow) - Date.parse(update.task.createdAt)) || 0;
  return { view: { ...update.task, elapsedMs, milestones, gap: update.gap || (known?.gap ?? false) }, added };
}

/** "45 s", "3 min 05 s", "2 h 07 min". */
export function formatGenerationElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${String(seconds % 60).padStart(2, "0")} s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
  return `${Math.floor(hours / 24)} d ${String(hours % 24).padStart(2, "0")} h`;
}

/** Whether the design still occupies the project's composer (a reviewable result opens the review dialog instead). */
export function generationTaskBusy(view: Pick<GenerationTaskView, "terminal" | "state"> | null): boolean {
  return view !== null && !view.terminal && view.state !== "awaiting-review";
}

const FAILURE_TEXT: Readonly<Record<string, string>> = Object.freeze({
  authority_revoked: "The design stopped: the person who started it no longer has an editor role in this project.",
  invalid_persisted_state: "The design stopped: its stored record failed validation.",
  invalid_request: "The design stopped: its request was not valid.",
});

/** One status sentence from the store's facts (the state and the liveness) - never "running" without a worker holding a live lease. */
export function generationTaskStatusText(view: GenerationTaskView): string {
  const live = view.liveness.state;
  const waitingWorker = live === "no_worker"
    ? "Waiting for a worker: no generation worker has picked this design up, so it has not started. It starts as soon as a worker runs."
    : live === "lease_expired"
      ? "Waiting for a worker: the worker running this design stopped responding; another worker resumes it from its last saved step."
      : live === "workers_busy"
        ? "Waiting for a worker: the generation workers are busy with other designs; this one is queued."
        : "Queued: waiting for a generation worker to pick it up.";
  switch (view.state) {
    case "queued": return live === "scheduled" ? `Waiting for the model provider; the design continues by itself${view.liveness.retryAt ? ` at ${view.liveness.retryAt.slice(11, 19)} UTC` : ""}.` : waitingWorker;
    case "running": {
      if (live !== "running") return waitingWorker;
      const designing = (view.plan?.blocks ?? []).filter((block) => block.status === "designing").map((block) => `"${block.name}"`);
      if (view.phase === "planning") return "Running: planning the design.";
      if (view.phase === "merging" || view.phase === "validating") return "Running: merging the saved blocks and checking the result.";
      return designing.length ? `Running: designing ${designing.join(", ")}${generationQueueClause(view)}.` : "Running."; // [PR-J, 2026-10-22] J.7: the blocks still queued, said (nothing queued: the sentence is unchanged)
    }
    case "waiting-for-provider": return `Waiting for the model provider; the design continues by itself${view.liveness.retryAt ? ` at ${view.liveness.retryAt.slice(11, 19)} UTC` : ""}.`;
    case "waiting-for-resource": return view.blocker ? `Needs your decision: ${view.blocker.message} ${view.blocker.resolution}` : "Needs your decision.";
    case "awaiting-review": return `Design ready (${view.result?.status === "partial" ? "partial" : "complete"}): it is offered in the review dialog; nothing is applied until you approve it.`;
    case "paused": return "Paused: saved work is kept; Resume continues it.";
    case "cancel-requested": return "Stopping: no new design work starts; the running step is being stopped.";
    case "cancelled": return "Stopped by you: nothing more runs, and a late result is refused.";
    case "succeeded": return view.review?.outcome === "applied" ? "Done: the reviewed design was applied." : "Done: the reviewed design was discarded.";
    case "failed": return FAILURE_TEXT[view.failure?.reason ?? ""] ?? "The design stopped.";
    case "stale": return "The sheet changed while this design ran, so its result was not offered. Start again to design against the current sheet.";
  }
}

/** The counts line: model calls and catalog searches so far, and the elapsed time (no percentage: a design has no known end). */
export function generationTaskCountsText(view: GenerationTaskView): string {
  const calls = view.usage.modelCalls, searches = view.usage.catalogSearches;
  return `${formatGenerationElapsed(view.elapsedMs)} elapsed · ${calls} model call${calls === 1 ? "" : "s"} · ${searches} catalog search${searches === 1 ? "" : "es"}`;
}

/** The accessible label of each button the page shows for a valid action. */
export const GENERATION_TASK_ACTION_LABELS: Readonly<Record<"cancel" | "pause" | "resume" | "extend-allowance" | "review-partial", string>> = Object.freeze({
  cancel: "Stop design",
  pause: "Pause design",
  resume: "Resume design",
  "extend-allowance": "Continue with another allowance",
  "review-partial": "Review the saved blocks",
});
/** Whether "Start again" (a NEW design from the same request) is offered: only once this task can do nothing more. */
export const generationTaskRestartable = (view: Pick<GenerationTaskView, "state">): boolean => view.state === "cancelled" || view.state === "failed" || view.state === "stale";

// [PR-J, 2026-10-22] Runbook J.7 (OD-255 item 10), appended after the last line (a function declaration is hoisted), so no cited line
// moves: a design has more logical blocks than a worker has slots (8 blocks, 3 slots per worker), and the blocks that do not fit wait in
// the durable queue - never dropped. While some blocks design, the status sentence says how many still wait and for what: a queued block
// whose latest milestone is the model provider's wait waits for the provider; every other queued block waits for a free worker slot.
// Nothing queued: the empty clause (the sentence is byte-identical to the one before).
// [PR-J, 2026-11-04] J7-2: a queued block the snapshot marks `waiting: "allowance"` (re-queued because the running blocks' reservations fill
// the task's allowance; it starts when one of them ends) is said to wait for exactly that, never for "a free worker slot" - the mark is the
// head's own pending entry, so it holds across a reconnect that missed milestones. Without the mark the sentence is unchanged.
function generationQueueClause(view: Pick<GenerationTaskView, "plan" | "milestones">): string {
  const queued = (view.plan?.blocks ?? []).filter((block) => block.status === "queued");
  if (!queued.length) return "";
  const latest = new Map<string, string>();
  for (const event of view.milestones) if (event.blockId) latest.set(event.blockId, event.type);
  const allowance = queued.filter((block) => block.waiting === "allowance").length;
  const provider = queued.filter((block) => block.waiting !== "allowance" && latest.get(block.blockId) === "waiting_provider").length, slot = queued.length - allowance - provider;
  return `${slot ? `; ${slot} more block(s) queued for a free worker slot` : ""}${allowance ? `; ${allowance} more block(s) waiting for a running block to release its reserved allowance` : ""}${provider ? `; ${provider} more block(s) waiting for the model provider` : ""}`;
}

// [PR-J, 2026-10-22] Runbook J.6.3, increment J5-1, appended after the last line (a function declaration is hoisted): the result's optional
// sheet set read with the shared defensive reader (app/lib/schematic/generated-sheets.ts); anything malformed is dropped and the result kept.
function sheetsOf(value: unknown): { sheets?: GeneratedSheets } {
  if (value === undefined) return {};
  const sheets = readGeneratedSheets(value);
  return sheets ? { sheets } : {};
}

// [K2, 2026-11-04] K1 case 6 (runbook K.4, OD-260 item 5), appended after the last line (a declaration is hoisted), so no cited line moves:
// the server snapshot's remaining allowance, kept by the reader, and the one line the Work log shows for it - units of the task's own
// allowance (model calls, output and input tokens, catalog searches), never a price: the product has no USD table (F18), and the US$5
// builder ledger is not the product's.
export interface GenerationTaskAllowanceView { units: number; extensions: number; maxExtensions: number; remaining: { modelCalls: number; outputTokens: number; catalogSearches: number; inputTokens?: number }; windowEndsAt: string }
function allowanceOf(value: unknown): { allowance?: GenerationTaskAllowanceView } {
  if (!isRecord(value) || !isRecord(value.remaining)) return {};
  const remaining = value.remaining;
  if (!num(value.units) || !num(value.extensions) || !num(value.maxExtensions) || !str(value.windowEndsAt, 40)) return {};
  if (!num(remaining.modelCalls) || !num(remaining.outputTokens) || !num(remaining.catalogSearches) || (remaining.inputTokens !== undefined && !num(remaining.inputTokens))) return {};
  return { allowance: { units: value.units, extensions: value.extensions, maxExtensions: value.maxExtensions, remaining: { modelCalls: remaining.modelCalls, outputTokens: remaining.outputTokens, catalogSearches: remaining.catalogSearches, ...(remaining.inputTokens !== undefined ? { inputTokens: remaining.inputTokens as number } : {}) }, windowEndsAt: value.windowEndsAt } };
}
const plural = (count: number, one: string, many: string): string => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
/** The allowance line ("Allowance left: 58 model calls · 470,000 output tokens · 298 catalog searches (task units, not money)"), or null. */
export function generationTaskAllowanceText(view: Pick<GenerationTaskSnapshotView, "allowance">): string | null {
  const allowance = view.allowance;
  if (!allowance) return null;
  const left = allowance.remaining;
  const parts = [plural(left.modelCalls, "model call", "model calls"), plural(left.outputTokens, "output token", "output tokens"), ...(left.inputTokens !== undefined ? [plural(left.inputTokens, "input token", "input tokens")] : []), plural(left.catalogSearches, "catalog search", "catalog searches")];
  const extensions = allowance.maxExtensions > 0 ? `; ${allowance.extensions} of ${allowance.maxExtensions} extensions used` : "";
  return `Allowance left: ${parts.join(" · ")} (task units, not money${extensions})`;
}
