/**
 * [PR-L, 2026-10-17] Runbook L.4, increment 4 (task-worker-contract.md sections 6 and 8): the ONE generation-task service the routes call
 * (and, in increment 5, the chat port): start or attach, the scope's active task, inspect, ordered event pages and control - each over
 * the injected durable store, each answering a plain `{ status, body }` the canonical route wrappers return as JSON with `no-store`.
 *
 *  - Start: the request body is a CLOSED shape (`clientRequestId`, `prompt`, `provider?`, `base: { schematicDigest, recipe, headMark? }`);
 *    the scope and the principal come from the trusted request context only. The answer is `202 { task, attached }` the moment the
 *    durable start commit lands - the design runs later, in a worker. A lost 202 is recovered by sending the same `clientRequestId`
 *    again (the same task, `attached: true`); a different request under that id is `409 IDEMPOTENCY_KEY_REUSED`; a second request
 *    while one runs is `409 GENERATION_TASK_ACTIVE` with the running task's snapshot (the page attaches to it).
 *  - Every read and control is scoped by the trusted scope: an unknown id, a foreign scope's id and a malformed id are the SAME
 *    `404 GENERATION_TASK_NOT_FOUND`. A guessed task id is never access.
 *  - Liveness is the store's (snapshot.ts): the processing slice events are listed from the repository on every snapshot.
 *  - Control: `cancel`, `pause`, `resume`, `extend-allowance` (a resume with one more allowance unit), `retry-block`, `review-partial`,
 *    `record-review`, `report-base` - the store judges each transition; `rebase` and `start-from-saved` are refused here (a new task
 *    is a new user request: the page starts one with a new client request id).
 *
 * Nothing here runs a slice, calls a provider or touches engineering state.
 */
import { canonicalDurableScope } from "../durable-workflow/stable";
import type { DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import type { ProjectRole } from "../engineering/types";
import { isLLMProviderId, type LLMProviderId } from "../llm/types";
import { GENERATION_SLICE_TOPIC, type GenerationTaskHead, type GenerationTaskResultPayload } from "./contracts";
import { GENERATION_TASK_EVENT_BOUNDS } from "./events";
import { buildGenerationTaskSnapshot, type GenerationProcessingSlice, type GenerationTaskSnapshot } from "./snapshot";
import { GenerationTaskStore, type GenerationCommitRefusalCode, type GenerationTaskStartInput } from "./store";
import { GENERATION_BASE_RECIPES, GENERATION_BLOCK_IDS, GENERATION_REVIEW_OUTCOMES, isPlainRecord, isTerminalGenerationTaskState, type GenerationBaseRecipe, type GenerationBlockId, type GenerationReviewOutcome, type GenerationTaskOrigin } from "./vocabulary";

/** Where the task store keeps its records: the durable PostgreSQL store, or the fixture runtime's process memory (lost when the dev
 *  server restarts - said so, never presented as recoverable). */
export type GenerationTaskDurability = "durable" | "process-memory";

export interface GenerationTaskPrincipal { principalId: string; role: ProjectRole; membershipRevision: string }
export interface GenerationTaskAnswer { status: number; body: Record<string, unknown> }

export interface GenerationTaskServiceOptions {
  store: GenerationTaskStore;
  repository: DurableWorkflowRepository;
  /** the store's task clock (epoch ms) */
  clock: () => number;
  /** `schematicGenerationServable`, injected by the composition root */
  providerServable: (provider: LLMProviderId) => boolean;
  identities: () => GenerationTaskStartInput["identities"];
  durability: GenerationTaskDurability;
  pickupGraceMs?: number;
}

/** The control route's actions (snapshot.ts lists the ones valid now). */
export const GENERATION_TASK_CONTROL_ROUTE_ACTIONS = Object.freeze(["cancel", "pause", "resume", "extend-allowance", "retry-block", "review-partial", "record-review", "report-base"] as const);
export type GenerationTaskControlRouteAction = (typeof GENERATION_TASK_CONTROL_ROUTE_ACTIONS)[number];

const START_KEYS = ["clientRequestId", "prompt", "provider", "base"] as const;
const BASE_KEYS = ["schematicDigest", "recipe", "headMark"] as const;
const CONTROL_KEYS = ["action", "clientActionId", "blockId", "review", "liveBase"] as const;
const REVIEW_KEYS = ["outcome", "resultDigest", "headMark"] as const;
const LIVE_BASE_KEYS = ["schematicDigest", "recipe"] as const;

const SENTENCES: Readonly<Record<string, string>> = Object.freeze({
  GENERATION_TASK_NOT_FOUND: "No such design task in this project.",
  GENERATION_TASK_INVALID_REQUEST: "The design request is not valid.",
  GENERATION_TASK_FORBIDDEN: "Your project role cannot start or control a design.",
  IDEMPOTENCY_KEY_REUSED: "This request id was already used for a different request.",
  GENERATION_TASK_ACTIVE: "A design is already running for this project; it is shown instead of starting another.",
  GENERATION_TASK_CONTENDED: "The design task was busy; try again.",
  GENERATION_TASK_INVALID_PERSISTED_STATE: "The stored design task failed validation and is not used.",
  GENERATION_PROVIDER_UNAVAILABLE: "No model provider is configured for this design; nothing was started.",
  GENERATION_TASK_STATE_CONFLICT: "That action is not valid for the design's current state.",
  GENERATION_TASK_TRANSITION_REFUSED: "That action is not valid for the design's current state.",
  GENERATION_TASK_CANCEL_REQUESTED: "The design is being stopped.",
  GENERATION_TASK_ACTION_UNSUPPORTED: "That action is not supported; start a new design instead.",
  GENERATION_TASK_TOO_LARGE: "The design task would exceed its size bound.",
  GENERATION_SLICE_FENCED: "The design task changed meanwhile; try again.",
  GENERATION_SLICE_END_INVALID: "The design task refused the change.",
});
const STATUS: Readonly<Record<GenerationCommitRefusalCode, number>> = Object.freeze({
  GENERATION_TASK_NOT_FOUND: 404, GENERATION_TASK_INVALID_PERSISTED_STATE: 500, GENERATION_SLICE_FENCED: 409, GENERATION_TASK_CANCEL_REQUESTED: 409, GENERATION_TASK_STATE_CONFLICT: 409,
  GENERATION_TASK_TRANSITION_REFUSED: 409, GENERATION_TASK_CONTENDED: 409, GENERATION_TASK_FORBIDDEN: 403, IDEMPOTENCY_KEY_REUSED: 409, GENERATION_TASK_ACTION_UNSUPPORTED: 400, GENERATION_SLICE_END_INVALID: 409,
  GENERATION_TASK_TOO_LARGE: 413,
});

const refusal = (status: number, code: string, extra: Record<string, unknown> = {}): GenerationTaskAnswer => ({ status, body: { ok: false, code, error: SENTENCES[code] ?? "The design task refused the request.", ...extra } });
const notFound = (): GenerationTaskAnswer => refusal(404, "GENERATION_TASK_NOT_FOUND");
const invalid = (issue: string): GenerationTaskAnswer => refusal(400, "GENERATION_TASK_INVALID_REQUEST", { issue });

/** The first unknown key of a closed body shape, by position only (never the key's text: it is caller data). */
function unknownKey(record: Record<string, unknown>, allowed: readonly string[], path: string): string | null {
  return Object.keys(record).some((key) => !allowed.includes(key)) ? `${path}: an unknown key is refused` : null;
}

export class GenerationTaskService {
  readonly store: GenerationTaskStore;
  readonly durability: GenerationTaskDurability;
  private readonly repository: DurableWorkflowRepository;
  private readonly clock: () => number;
  private readonly providerServable: (provider: LLMProviderId) => boolean;
  private readonly identities: () => GenerationTaskStartInput["identities"];
  private readonly pickupGraceMs: number | undefined;

  constructor(options: GenerationTaskServiceOptions) {
    this.store = options.store;
    this.repository = options.repository;
    this.clock = options.clock;
    this.providerServable = options.providerServable;
    this.identities = options.identities;
    this.durability = options.durability;
    this.pickupGraceMs = options.pickupGraceMs;
  }

  /** The processing slice events of the topic (global; bounded by workers x concurrency): the liveness evidence. */
  private async processing(): Promise<GenerationProcessingSlice[]> {
    const events = await this.repository.listOutbox({ topic: GENERATION_SLICE_TOPIC, state: "processing" });
    return events.map((event) => ({ sliceId: typeof event.payload?.sliceId === "string" ? event.payload.sliceId : "", leaseToken: event.leaseToken ?? null, leaseExpiresAt: event.leaseExpiresAt ?? null }));
  }

  /** The public snapshot of a validated head: liveness from the store, the current owners' live activity. */
  async snapshot(scope: DurableWorkflowScope, head: GenerationTaskHead, options: { includePrompt?: boolean } = {}): Promise<GenerationTaskSnapshot> {
    const [processing, activity] = await Promise.all([this.processing(), this.store.readActivity(scope, head).catch(() => [])]);
    return buildGenerationTaskSnapshot(head, { nowMs: this.clock(), processing, activity, includePrompt: options.includePrompt === true, ...(this.pickupGraceMs !== undefined ? { pickupGraceMs: this.pickupGraceMs } : {}) });
  }

  private loadFailure(load: { ok: false; code: "GENERATION_TASK_NOT_FOUND" } | { ok: false; code: "GENERATION_TASK_INVALID_PERSISTED_STATE"; taskId: string; issue: string }): GenerationTaskAnswer {
    return load.code === "GENERATION_TASK_NOT_FOUND" ? notFound() : refusal(500, "GENERATION_TASK_INVALID_PERSISTED_STATE");
  }

  // ── start / attach ──

  /** [PR-L, 2026-10-18] runbook L.5: the chat's start (origin `chat`, the asking chat run recorded on the task) is THIS method, through
   *  the chat route's port (app/api/chat/schematic-generation-runtime.ts) - the same closed body, idempotency, index and allowance. */
  async start(scope: DurableWorkflowScope, principal: GenerationTaskPrincipal, body: unknown, origin: GenerationTaskOrigin = "build", chatRunId: string | null = null): Promise<GenerationTaskAnswer> {
    if (!isPlainRecord(body)) return invalid("body: an object is required");
    const keyIssue = unknownKey(body, START_KEYS, "body");
    if (keyIssue) return invalid(keyIssue);
    if (typeof body.clientRequestId !== "string") return invalid("body.clientRequestId: a client request uuid is required");
    if (typeof body.prompt !== "string") return invalid("body.prompt: 1..4000 characters");
    if (body.provider !== undefined && !isLLMProviderId(body.provider)) return invalid("body.provider: openai or anthropic");
    const base = body.base;
    if (!isPlainRecord(base)) return invalid("body.base: the schematic base pin is required");
    const baseIssue = unknownKey(base, BASE_KEYS, "body.base");
    if (baseIssue) return invalid(baseIssue);
    if (typeof base.schematicDigest !== "string" || typeof base.recipe !== "string" || !(GENERATION_BASE_RECIPES as readonly string[]).includes(base.recipe)) return invalid("body.base: a schematic digest and its recipe are required");
    const provider: LLMProviderId = body.provider === undefined ? "openai" : (body.provider as LLMProviderId);
    const outcome = await this.store.createOrAttach({
      scope, principal, origin, ...(origin === "chat" ? { chatRunId } : {}),
      request: { clientRequestId: body.clientRequestId, prompt: body.prompt, provider },
      base: { schematicDigest: base.schematicDigest, recipe: base.recipe as GenerationBaseRecipe, ...(base.headMark !== undefined ? { headMark: base.headMark as GenerationTaskStartInput["base"]["headMark"] } : {}) },
      identities: this.identities(),
      providerServable: this.providerServable(provider),
    });
    if (outcome.ok) return { status: 202, body: { ok: true, attached: outcome.attached, durability: this.durability, task: await this.snapshot(scope, outcome.task) } };
    switch (outcome.code) {
      case "GENERATION_TASK_INVALID_REQUEST": return invalid(outcome.issue);
      case "GENERATION_TASK_ACTIVE": {
        const active = await this.store.load(scope, outcome.activeTask.taskId);
        return refusal(409, "GENERATION_TASK_ACTIVE", active.ok ? { activeTask: await this.snapshot(scope, active.task) } : {});
      }
      case "GENERATION_TASK_INVALID_PERSISTED_STATE": return refusal(500, outcome.code);
      default: return refusal(outcome.status, outcome.code);
    }
  }

  // ── reads ──

  /** The scope's active task (the one to reattach) and its most recent tasks (refs only, newest first). */
  async list(scope: DurableWorkflowScope): Promise<GenerationTaskAnswer> {
    const { index } = await this.store.loadIndex(scope);
    let active: GenerationTaskSnapshot | null = null;
    if (index.active) {
      const load = await this.store.load(scope, index.active.taskId);
      if (load.ok && !isTerminalGenerationTaskState(load.task.state)) active = await this.snapshot(scope, load.task);
    }
    const recent = index.recent.map((ref) => ({ taskId: ref.taskId, origin: ref.origin, createdAt: ref.createdAt }));
    return { status: 200, body: { ok: true, durability: this.durability, active, recent } };
  }

  async inspect(scope: DurableWorkflowScope, id: string, options: { includeResult?: boolean } = {}): Promise<GenerationTaskAnswer> {
    const load = await this.store.load(scope, id);
    if (!load.ok) return this.loadFailure(load);
    const task = await this.snapshot(scope, load.task, { includePrompt: true });
    let result: GenerationTaskResultPayload | null = null;
    if (options.includeResult && load.task.result) {
      try { result = await this.store.readResult(scope, load.task); }
      catch { return refusal(500, "GENERATION_TASK_INVALID_PERSISTED_STATE"); }
    }
    return { status: 200, body: { ok: true, durability: this.durability, task, ...(options.includeResult ? { result: result ? publicResult(result) : null } : {}) } };
  }

  /** One page of ordered milestones after `after`, with the snapshot (a `gap` means: show the snapshot, then continue at `cursor`). */
  async events(scope: DurableWorkflowScope, id: string, input: { after?: number; limit?: number } = {}): Promise<GenerationTaskAnswer> {
    const page = await this.store.events(scope, id, input);
    if (!page.ok) return this.loadFailure(page);
    const load = await this.store.load(scope, id);
    if (!load.ok) return this.loadFailure(load);
    return { status: 200, body: { ok: true, events: page.page.events, cursor: page.page.cursor, hasMore: page.page.hasMore, gap: page.page.gap, task: await this.snapshot(scope, load.task) } };
  }

  // ── control ──

  async control(scope: DurableWorkflowScope, principal: GenerationTaskPrincipal, id: string, body: unknown): Promise<GenerationTaskAnswer> {
    // the task is resolved in the trusted scope FIRST: a foreign or unknown id is the uniform 404 whatever the body says
    const load = await this.store.load(scope, id);
    if (!load.ok) return this.loadFailure(load);
    if (!isPlainRecord(body)) return invalid("body: an object is required");
    const keyIssue = unknownKey(body, CONTROL_KEYS, "body");
    if (keyIssue) return invalid(keyIssue);
    const action = body.action;
    if (typeof action !== "string" || !(GENERATION_TASK_CONTROL_ROUTE_ACTIONS as readonly string[]).includes(action)) return refusal(400, "GENERATION_TASK_ACTION_UNSUPPORTED");
    if (typeof body.clientActionId !== "string") return invalid("body.clientActionId: an identifier is required");
    let blockId: GenerationBlockId | undefined;
    if (body.blockId !== undefined) {
      if (typeof body.blockId !== "string" || !(GENERATION_BLOCK_IDS as readonly string[]).includes(body.blockId)) return invalid("body.blockId: a planned block id");
      blockId = body.blockId as GenerationBlockId;
    }
    let review: { outcome: GenerationReviewOutcome; resultDigest: string; headMark?: GenerationTaskStartInput["base"]["headMark"] } | undefined;
    if (body.review !== undefined) {
      const raw = body.review;
      if (!isPlainRecord(raw) || unknownKey(raw, REVIEW_KEYS, "body.review") || typeof raw.outcome !== "string" || !(GENERATION_REVIEW_OUTCOMES as readonly string[]).includes(raw.outcome) || typeof raw.resultDigest !== "string") return invalid("body.review: the outcome and the result digest");
      review = { outcome: raw.outcome as GenerationReviewOutcome, resultDigest: raw.resultDigest, ...(raw.headMark !== undefined ? { headMark: raw.headMark as GenerationTaskStartInput["base"]["headMark"] } : {}) };
    }
    let liveBase: { schematicDigest: string; recipe: GenerationBaseRecipe } | undefined;
    if (body.liveBase !== undefined) {
      const raw = body.liveBase;
      if (!isPlainRecord(raw) || unknownKey(raw, LIVE_BASE_KEYS, "body.liveBase") || typeof raw.schematicDigest !== "string" || typeof raw.recipe !== "string" || !(GENERATION_BASE_RECIPES as readonly string[]).includes(raw.recipe)) return invalid("body.liveBase: the live base digest and its recipe");
      liveBase = { schematicDigest: raw.schematicDigest, recipe: raw.recipe as GenerationBaseRecipe };
    }
    const storeAction = action === "extend-allowance" ? "resume" : (action as Exclude<GenerationTaskControlRouteAction, "extend-allowance">);
    const outcome = await this.store.control({
      scope, taskId: id, principal: { principalId: principal.principalId, role: principal.role }, action: storeAction, clientActionId: body.clientActionId,
      ...(blockId ? { blockId } : {}), ...(action === "extend-allowance" ? { extendAllowance: true } : {}), ...(review ? { review } : {}), ...(liveBase ? { liveBase } : {}),
    });
    if (!outcome.ok) return refusal(STATUS[outcome.code] ?? 409, outcome.code, outcome.issue && outcome.code !== "GENERATION_TASK_NOT_FOUND" ? { issue: outcome.issue.slice(0, 300) } : {});
    return { status: 200, body: { ok: true, replayed: outcome.replayed, task: await this.snapshot(scope, outcome.task) } };
  }
}

/** The result document as the page's intake reads it (the netlist, its notes, the checks; the block references stay server-side). */
export function publicResult(result: GenerationTaskResultPayload): Record<string, unknown> {
  return {
    status: result.status, omittedBlocks: [...result.omittedBlocks], netlist: result.netlist, explanation: result.explanation, electricalCheck: result.electricalCheck,
    planner: result.planner, sharedNets: { checked: result.sharedNets.checked, findings: [...result.sharedNets.findings] }, resultDigest: result.resultDigest, at: result.at,
  };
}

/** The bounded query of an events page: `after` (a nonnegative integer, 0 by default) and `limit` (1..50). Anything else refused. */
export function generationEventsQuery(query: Readonly<Record<string, string>> | undefined, lastEventId?: string): { ok: true; after: number; limit: number } | { ok: false; answer: GenerationTaskAnswer } {
  const read = (value: string | undefined, max: number): number | null | undefined => (value === undefined || value === "" ? undefined : /^\d{1,9}$/.test(value) && Number(value) <= max ? Number(value) : null);
  const after = read(query?.after, Number.MAX_SAFE_INTEGER), limit = read(query?.limit, GENERATION_TASK_EVENT_BOUNDS.pageLimit), resumed = read(lastEventId, Number.MAX_SAFE_INTEGER);
  if (after === null || limit === null || limit === 0) return { ok: false, answer: invalid("query: after is a nonnegative integer and limit is 1..50") };
  return { ok: true, after: Math.max(after ?? 0, typeof resumed === "number" ? resumed : 0), limit: limit ?? GENERATION_TASK_EVENT_BOUNDS.pageLimit };
}

/** A trusted scope for the store (the canonical form; a malformed scope is the uniform not-found). */
export function generationScopeOf(context: { tenantId: string; projectId: string; branchId: string }): DurableWorkflowScope | null {
  try { return canonicalDurableScope({ tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId }); } catch { return null; }
}

/** The bound a start body must fit (the route's maxBytes): the prompt bound plus the base pin and keys. */
export const GENERATION_TASK_START_MAX_BYTES = 64_000;
