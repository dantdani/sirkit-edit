/**
 * [PR-L, 2026-10-17] Runbook L.2/L.3, increment 2: the generation-task store over the EXISTING durable-workflow repository
 * (task-worker-contract.md sections 1-3; OD-252). The repository is INJECTED (the orchestration store's pattern): this module
 * never imports the durable runtime or the database client, so a composition root binds the PostgreSQL repository, the fixture
 * runtime's in-memory one, or a test's; without one nothing is accepted.
 *
 *  - Start / attach: the task id is derived from (scope, principal, clientRequestId); ONE commit writes head revision 1, the
 *    per-scope index (CAS: at most one non-terminal task per project branch) and the first `plan` slice's outbox effect, under
 *    the idempotency key `start:<taskId>`. The same request again attaches (`attached: true`); the same client request id with a
 *    different request digest is IDEMPOTENCY_KEY_REUSED (409); a second request while one is active is GENERATION_TASK_ACTIVE (409).
 *  - Reads are scoped by the trusted scope: an unknown id, a foreign scope's id and a malformed id are the SAME refusal
 *    (GENERATION_TASK_NOT_FOUND). Block checkpoints, facts and the result are read ONLY through the `{recordId, recordDigest}`
 *    the head references, each digest recomputed (GENERATION_TASK_RECORD_MISMATCH).
 *  - Slices: `claimSlices` claims outbox events of the slice topic (no scope; free capacity only), then CLAIMS the head (CAS:
 *    `fenceCounter + 1`, the owner with the lease token, a worst-case reservation, state `running`). Every later head commit of the
 *    slice follows the rebase rule: on a CAS conflict reload; continue ONLY while `pending[sliceId].owner` still holds this fence
 *    and token (else GENERATION_SLICE_FENCED, nothing written) and the task is not cancelling; re-apply ONLY this slice's delta; at
 *    most 8 retries. A slice's end commit removes its pending entry, settles its reservation and schedules the next slices as
 *    outbox effects of the SAME commit (S1 `availableAt` for a delay). `renewSlice` is the fenced S2 renewal; `releaseSlice` hands
 *    the slice back for immediate takeover.
 *  - Duplicate or stale slice events are no-ops (the slice id must still be pending). An ambiguous commit (a transport error after
 *    the commit) is retried with the SAME idempotency key and answers the replay; model work is never re-run to re-derive a commit.
 *
 * Correction to the contract (section 3.4 / 1.1): a facts write is committed TOGETHER with the head commit that references it (a
 * two-aggregate commit, like start and terminal commits). Two sibling block slices committing facts first and the head reference
 * after could otherwise interleave so that the later head commit references the OLDER facts revision and silently drops the other
 * slice's facts; a joint commit makes the reference and the content move together under the head CAS and the fence.
 */
import { canonicalDurableScope, durableAggregateIdentity, durableScopeKey, durableWorkflowDigest, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableAggregateRecord, DurableAppendOperation, DurableCommitResult, DurableOutboxEffect, DurableOutboxEvent, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import type { LLMProviderId } from "../llm/types";
import type { ProjectRole } from "../engineering/types";
import { validateSchematicCanonicalMark, type SchematicCanonicalMark } from "../engineering/schematic-projection";
import type { BuildPlannerStatus } from "../schematic/build-result";
import { assertBuildLoopCheckpoint, buildLoopCheckpointIssue, type BuildLoopCheckpoint } from "./checkpoint";
import {
  GENERATION_BLOCKER_TEXT, GENERATION_SLICE_CONTRACT, GENERATION_SLICE_EVENT, GENERATION_SLICE_POLICY, GENERATION_SLICE_TOPIC, GENERATION_TASK_AGGREGATES, GENERATION_TASK_ALLOWANCE_UNIT, GENERATION_TASK_BOUNDS,
  GENERATION_TASK_INDEX_KEY, GENERATION_TASK_SCHEMA, GENERATION_TASK_SCOPE_SUFFIX, GENERATION_TASK_START_SCOPE_SUFFIX, GENERATION_USAGE_KEYS, GENERATION_OPTIONAL_USAGE_KEYS,
  applyGenerationFactsDelta, assertGenerationTaskHead, deriveGenerationTaskState, emptyGenerationTaskIndex, generationActivityAggregateKey, generationAllowanceLimits, generationAllowanceRefusal, generationBlockAggregateKey, generationCommitted, GENERATION_ALLOWANCE_WAIT, generationAllowanceContended, generationAllowanceWaitMs, generationInputContended, generationLiveHolders, // [PR-J, 2026-11-04] J7-2
  generationBlockTurnsPerSlice, generationIndexWith, generationPlanDigest, generationRequestDigest, generationReservationFor, generationSliceId, generationTaskFactsIssue, generationTaskHeadIssue,
  generationTaskId, generationTaskIndexIssue, generationTaskResultIssue, generationTaskTransitionIssue, hasGenerationOwner, isGenerationEditorRole, nextGenerationWork,
  type GenerationAllowanceUnit, type GenerationBlockState, type GenerationControlStamp, type GenerationFactsDelta, type GenerationMissingRole, type GenerationPendingSlice, type GenerationPendingWait, type GenerationReservation, type GenerationTaskFacts,
  type GenerationTaskHead, type GenerationTaskIndex, type GenerationTaskResultPayload, type GenerationTaskUsage, type GenerationTransitionActor, type GenerationTransitionAttestation,
} from "./contracts";
import { appendGenerationTaskActivity, appendGenerationTaskEvents, generationTaskActivityIssue, generationTaskEvent, generationTaskEventsPage, type GenerationTaskActivity, type GenerationTaskEventDraft, type GenerationTaskEventsPage } from "./events";
import {
  CLIENT_REQUEST_ID, ENGINEERING_DIGEST, GENERATION_BASE_RECIPES, GENERATION_CATALOG_PROFILES, GENERATION_REVIEW_OUTCOMES, SLICE_ID, TASK_ID,
  GenerationTaskContractError, cleanLine, cleanModelText, isTerminalGenerationTaskState, isoOf,
  type GenerationBaseRecipe, type GenerationBlockId, type GenerationBlockerCode, type GenerationCatalogProfile, type GenerationControlAction, type GenerationReviewOutcome, type GenerationSliceKind,
  type GenerationTaskOrigin, type GenerationTaskPhase, type GenerationTaskState, type GenerationWaitingReason, type GenerationQueueWaitReason,
} from "./vocabulary";

// ─── Public types ────────────────────────────────────────────────────────────────────────────────────────────────────────

export class GenerationTaskStoreError extends Error {
  constructor(readonly code: string, detail = code) {
    super(detail);
    this.name = "GenerationTaskStoreError";
  }
}

type RenewingRepository = DurableWorkflowRepository & { renewOutboxLease: NonNullable<DurableWorkflowRepository["renewOutboxLease"]> };

export interface GenerationTaskStoreOptions {
  repository: DurableWorkflowRepository;
  /** the task clock (epoch ms) for leases and timestamps; `Date.now` by default (the fixture runtime passes its unfrozen clock) */
  clock?: () => number;
  /** a block slice's turns (section 3.1): `min(6, resolveBuildIterationCap())` by default */
  blockTurnsPerSlice?: number;
  leaseMs?: number;
  maxAttemptsPerSlice?: number;
}

export interface GenerationTaskStartInput {
  /** the TRUSTED scope (the route's verified context; never the body) */
  scope: DurableWorkflowScope;
  principal: { principalId: string; role: ProjectRole; membershipRevision: string };
  origin: GenerationTaskOrigin;
  chatRunId?: string | null;
  request: { clientRequestId: string; prompt: string; provider: LLMProviderId };
  base: { schematicDigest: string; recipe: GenerationBaseRecipe; headMark?: SchematicCanonicalMark | null };
  identities: { catalogProfile: GenerationCatalogProfile; embeddingModel: string; promptDigests: { plan: string; build: string; subsystem: string } };
  /** the caller's `schematicGenerationServable` verdict: false accepts NOTHING */
  providerServable: boolean;
  /** an operator-lowered unit (never above the default; the judge refuses more) */
  allowanceUnit?: GenerationAllowanceUnit;
}
export type GenerationTaskStartOutcome =
  | { ok: true; status: 202; attached: boolean; replayed: boolean; task: GenerationTaskHead }
  | { ok: false; status: 400; code: "GENERATION_TASK_INVALID_REQUEST"; issue: string }
  | { ok: false; status: 403; code: "GENERATION_TASK_FORBIDDEN" }
  | { ok: false; status: 409; code: "IDEMPOTENCY_KEY_REUSED" }
  | { ok: false; status: 409; code: "GENERATION_TASK_ACTIVE"; activeTask: { taskId: string; state: GenerationTaskState; createdAt: string } }
  | { ok: false; status: 409; code: "GENERATION_TASK_CONTENDED" }
  | { ok: false; status: 500; code: "GENERATION_TASK_INVALID_PERSISTED_STATE"; taskId: string }
  | { ok: false; status: 503; code: "GENERATION_PROVIDER_UNAVAILABLE" };

export type GenerationTaskLoad =
  | { ok: true; task: GenerationTaskHead; revision: number }
  | { ok: false; code: "GENERATION_TASK_NOT_FOUND" }
  | { ok: false; code: "GENERATION_TASK_INVALID_PERSISTED_STATE"; taskId: string; issue: string };

export interface GenerationSliceLease {
  scope: DurableWorkflowScope; taskId: string; sliceId: string; kind: GenerationSliceKind; blockId: GenerationBlockId | null;
  attempt: number; fence: number; workerId: string; leaseToken: string; eventId: string; leaseExpiresAt: string;
}
export type GenerationSliceRevalidation = { ok: true } | { ok: false; failure: "authority_revoked" } | { ok: false; blocker: "provider_credentials" | "provider_quota" | "provider_access" };
/** Section 3.2 step 3, before any provider call: live membership and role, the provider still servable. */
export type GenerationSliceRevalidator = (task: GenerationTaskHead) => Promise<GenerationSliceRevalidation>;
export type GenerationClaimOutcome =
  | { outcome: "claimed"; lease: GenerationSliceLease; task: GenerationTaskHead }
  | { outcome: "stale-event" | "not-before" | "dropped" | "blocked" | "failed" | "cancelled" | "requeued"; eventId: string; taskId: string | null; code?: string }; // [PR-J, 2026-11-04] J7-2: `requeued` - only live siblings' reservations filled the allowance

export type GenerationCommitRefusalCode =
  | "GENERATION_TASK_NOT_FOUND" | "GENERATION_TASK_INVALID_PERSISTED_STATE" | "GENERATION_SLICE_FENCED" | "GENERATION_TASK_CANCEL_REQUESTED" | "GENERATION_TASK_STATE_CONFLICT"
  | "GENERATION_TASK_TRANSITION_REFUSED" | "GENERATION_TASK_CONTENDED" | "GENERATION_TASK_FORBIDDEN" | "IDEMPOTENCY_KEY_REUSED" | "GENERATION_TASK_ACTION_UNSUPPORTED" | "GENERATION_SLICE_END_INVALID"
  | "GENERATION_TASK_TOO_LARGE" | "GENERATION_INPUT_ALLOWANCE_EXHAUSTED" | "GENERATION_INPUT_ALLOWANCE_CONTENDED"; // [PR-L6 integration, 2026-10-19] F2: admitCall only (a worker refusal, never a route answer); [PR-J, 2026-11-04] J7-2: CONTENDED - only live siblings' in-flight input fills the limit
export type GenerationCommitOutcome =
  | { ok: true; task: GenerationTaskHead; revision: number; replayed: boolean }
  | { ok: false; code: GenerationCommitRefusalCode; issue?: string };

/** Only this slice's own block may be patched. */
export interface GenerationBlockPatch {
  status?: GenerationBlockState["status"]; strategy?: GenerationBlockState["strategy"]; strategyHistory?: GenerationBlockState["strategyHistory"]; turnsUsed?: number;
  stagnantSlices?: number; lastProgressKey?: string | null; blocker?: GenerationBlockerCode | null;
  /** [PR-L6, 2026-10-19] the roles a missing_part block waits for (null or [] clears them) */
  missing?: readonly GenerationMissingRole[] | null;
}
export interface GenerationSliceDelta {
  checkpoint?: BuildLoopCheckpoint;
  block?: GenerationBlockPatch;
  facts?: GenerationFactsDelta;
  /** additive counters of this attempt */
  usage?: Partial<GenerationTaskUsage>;
  milestones?: readonly GenerationTaskEventDraft[];
  /** [PR-L6, 2026-10-19] the input bound of this attempt's call in flight (0 once the calls so far are reported in `usage`) */
  inFlightInput?: number;
}
export interface GenerationPlanInput { planner: BuildPlannerStatus; rationale: string; assumptions: readonly string[]; coverage?: readonly string[]; blocks: ReadonlyArray<{ name: string; brief: string; sharedNets: readonly string[] }> }
export interface GenerationSliceEnd extends GenerationSliceDelta {
  /** the plan slice's plan (once) */
  plan?: GenerationPlanInput;
  /** the merge slice's verified result document */
  result?: GenerationTaskResultPayload;
  /** the next slices, scheduled atomically (`notBefore` later than now becomes the effect's `availableAt`); "next-work" = what a resume would schedule */
  schedule?: ReadonlyArray<{ kind: GenerationSliceKind; blockId: GenerationBlockId | null; notBefore?: string; /** [PR-J, 2026-11-04] J7-2: this block again, after the store's bounded allowance wait (its `notBefore` is the store's) */ wait?: GenerationQueueWaitReason }> | "next-work";
  /** why every scheduled slice is delayed (required when the task becomes waiting-for-provider) */
  waitingReason?: GenerationWaitingReason;
  /** a task-level blocker when nothing else remains (a block-level blocker rides `block`) */
  blocker?: GenerationBlockerCode;
}

export interface GenerationControlInput {
  scope: DurableWorkflowScope;
  taskId: string;
  principal: { principalId: string; role: ProjectRole };
  action: GenerationControlAction;
  clientActionId: string;
  blockId?: GenerationBlockId;
  extendAllowance?: boolean;
  review?: { outcome: GenerationReviewOutcome; resultDigest: string; headMark?: SchematicCanonicalMark | null };
  liveBase?: { schematicDigest: string; recipe: GenerationBaseRecipe };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const HEAD = GENERATION_TASK_AGGREGATES.head;
const CAS = "DW_OPTIMISTIC_REVISION_CONFLICT";
const isCasConflict = (error: unknown): boolean => error instanceof Error && error.message === CAS;
const clone = <T>(value: T): T => structuredClone(value);
const zeroUsage = (): GenerationTaskUsage => Object.fromEntries(GENERATION_USAGE_KEYS.map((key) => [key, 0])) as GenerationTaskUsage;
const phaseOf = (kind: GenerationSliceKind): GenerationTaskPhase => (kind === "plan" ? "planning" : kind === "block" ? "designing" : "merging");
const sameScope = (a: DurableWorkflowScope, b: DurableWorkflowScope) => a.tenantId === b.tenantId && a.projectId === b.projectId && a.branchId === b.branchId;
function addUsage(usage: GenerationTaskUsage, delta: Partial<GenerationTaskUsage> | undefined): void {
  for (const [key, value] of Object.entries(delta ?? {})) {
    const optional = (GENERATION_OPTIONAL_USAGE_KEYS as readonly string[]).includes(key); // [PR-L6, 2026-10-19] carried only once non-zero
    if ((!(GENERATION_USAGE_KEYS as readonly string[]).includes(key) && !optional) || typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new GenerationTaskContractError("GENERATION_TASK_USAGE_INVALID", `usage.${key.length > 40 ? "[key]" : key}: a nonnegative integer`);
    if (optional && value === 0) continue;
    usage[key as keyof GenerationTaskUsage] = (usage[key as keyof GenerationTaskUsage] ?? 0) + value;
  }
}
/** The repository's record id for an operation (both repositories derive it identically); checked again after the commit. */
function expectedRecordId(scope: DurableWorkflowScope, aggregateType: string, aggregateKey: string, revision: number, recordDigest: string): string {
  return durableWorkflowId("durable-record", { ...durableAggregateIdentity(scope, aggregateType, aggregateKey), revision, recordDigest });
}
function pushStamp(head: GenerationTaskHead, stamp: GenerationControlStamp): void {
  head.control.applied = [...head.control.applied, stamp].slice(-GENERATION_TASK_BOUNDS.controlApplied);
}
/** Keep at most the bound of reservations: the oldest UNCERTAIN ones fold into the usage's uncertain worst case (never dropped). */
function foldReservations(head: GenerationTaskHead): void {
  while (head.reservations.length > GENERATION_TASK_BOUNDS.reservations) {
    const index = head.reservations.findIndex((entry) => entry.state === "uncertain");
    if (index < 0) throw new GenerationTaskContractError("GENERATION_TASK_TOO_LARGE", "head.reservations: more held reservations than the bound");
    const [folded] = head.reservations.splice(index, 1);
    head.usage.uncertainModelCalls += folded!.modelCalls;
    head.usage.uncertainOutputTokens += folded!.outputTokens;
    if (folded!.inputTokens) head.usage.uncertainInputTokens = (head.usage.uncertainInputTokens ?? 0) + folded!.inputTokens; // [PR-L6, 2026-10-19] the in-flight input bound stays charged
  }
}
/** [PR-L6, 2026-10-19] Record the input bound of this attempt's call in flight on its HELD reservation (replace; 0 removes the field). */
function setInFlightInput(head: GenerationTaskHead, sliceIdValue: string, attempt: number, bound: number | undefined): void {
  if (bound === undefined) return;
  const entry = head.reservations.find((reservation) => reservation.sliceId === sliceIdValue && reservation.attempt === attempt && reservation.state === "held");
  if (!entry) return;
  if (bound > 0) entry.inputTokens = bound; else delete entry.inputTokens;
}
/** An attempt whose completion is unknown keeps its reservation, charged at worst case. */
function markUncertain(head: GenerationTaskHead, sliceIdValue: string, attempt: number): void {
  for (const entry of head.reservations) if (entry.sliceId === sliceIdValue && entry.attempt === attempt) entry.state = "uncertain";
}
/** Usage a slice reports mid-flight draws its held reservation down, so committed spend is never counted twice (usage + reservation). */
function consumeReservation(head: GenerationTaskHead, sliceIdValue: string, attempt: number, usage: Partial<GenerationTaskUsage> | undefined): void {
  const entry = head.reservations.find((reservation) => reservation.sliceId === sliceIdValue && reservation.attempt === attempt && reservation.state === "held");
  if (!entry || !usage) return;
  entry.modelCalls = Math.max(0, entry.modelCalls - (usage.modelCalls ?? 0));
  entry.outputTokens = Math.max(0, entry.outputTokens - (usage.outputTokens ?? 0));
}
function settleReservation(head: GenerationTaskHead, sliceIdValue: string, attempt: number): void {
  head.reservations = head.reservations.filter((entry) => !(entry.sliceId === sliceIdValue && entry.attempt === attempt));
}
function newBlockState(blockIdValue: GenerationBlockId, name: string, brief: string, sharedNets: string[]): GenerationBlockState {
  return { blockId: blockIdValue, name, brief, sharedNets, status: "queued", strategy: "S1-baseline", strategyHistory: [], artifactRef: null, turnsUsed: 0, stagnantSlices: 0, lastProgressKey: null, blocker: null };
}
/** When nothing remains pending: the task blocker - the explicit one, else the first blocked block's; partial when blocks are saved. */
function settleBlocker(head: GenerationTaskHead, explicit: GenerationBlockerCode | undefined): void {
  if (Object.keys(head.pending).length || head.result || head.control.cancel || head.failure) { if (!head.control.pause && !head.control.cancel) head.blocker = null; return; }
  const blocks = Object.values(head.blocks).filter((block): block is GenerationBlockState => Boolean(block));
  const blocked = blocks.find((block) => block.status === "blocked" || block.status === "needs-revalidation");
  const saved = blocks.filter((block) => block.status === "saved").length, blockedCount = blocks.filter((block) => block.status === "blocked" || block.status === "needs-revalidation").length;
  const cause = explicit ?? blocked?.blocker ?? (blocked ? "missing_evidence" : undefined);
  if (!cause) return;
  const code: GenerationBlockerCode = saved > 0 && blockedCount > 0 && cause !== "partial_available" ? "partial_available" : cause;
  const text = GENERATION_BLOCKER_TEXT[code];
  // [PR-L6, 2026-10-19] item 8: the roles the blocked block waits for ride the blocker's evidence (missing1..3, bounded lines)
  const missing = Object.fromEntries((blocked?.missing ?? []).slice(0, GENERATION_TASK_BOUNDS.missingRoles).map((entry, index) => [`missing${index + 1}`, cleanLine(`${entry.role}: ${entry.query}${entry.category ? ` (${entry.category})` : ""}`, 120) || entry.role.slice(0, 120)]));
  head.blocker = { code, message: text.message, resolution: text.resolution, blockId: blocked?.blockId ?? null, evidence: { savedBlocks: saved, blockedBlocks: blockedCount, cause, ...missing } };
}
/** [PR-L6, 2026-10-19] A block's unfilled roles, bounded and redacted as stored (at most 3; empty clears). */
function boundedMissing(missing: readonly GenerationMissingRole[] | null | undefined): GenerationMissingRole[] {
  return (missing ?? []).slice(0, GENERATION_TASK_BOUNDS.missingRoles).map((entry) => ({
    role: cleanLine(String(entry.role ?? ""), GENERATION_TASK_BOUNDS.missingRoleChars) || "unnamed role",
    query: cleanLine(String(entry.query ?? ""), GENERATION_TASK_BOUNDS.queryChars),
    category: entry.category ? cleanLine(String(entry.category), 128) || null : null,
  }));
}

interface HeadChange {
  next: GenerationTaskHead;
  attest?: GenerationTransitionAttestation;
  via?: GenerationTaskState;
  outbox?: DurableOutboxEffect[];
  extraOperations?: Array<DurableAppendOperation<object>>;
  /** slice ids whose effects ride this commit */
  scheduled?: string[];
  /** the commit's result is not needed: answer the current head (an idempotent no-op) */
  noop?: boolean;
}
type Refusal = { ok: false; code: GenerationCommitRefusalCode; issue?: string };
const refuse = (code: GenerationCommitRefusalCode, issue?: string): Refusal => ({ ok: false, code, ...(issue ? { issue } : {}) });

// ─── The store ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export class GenerationTaskStore {
  private readonly repository: RenewingRepository;
  private readonly clock: () => number;
  private readonly turns: number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;

  constructor(options: GenerationTaskStoreOptions) {
    if (!options?.repository || typeof options.repository.renewOutboxLease !== "function") throw new GenerationTaskStoreError("GENERATION_TASK_STORE_UNAVAILABLE", "a durable repository with lease renewal is required");
    this.repository = options.repository as RenewingRepository;
    this.clock = options.clock ?? (() => Date.now());
    this.turns = Math.max(1, Math.min(GENERATION_SLICE_POLICY.maxBlockTurnsPerSlice, Math.floor(options.blockTurnsPerSlice ?? generationBlockTurnsPerSlice())));
    this.leaseMs = options.leaseMs ?? GENERATION_SLICE_POLICY.leaseMs;
    this.maxAttempts = options.maxAttemptsPerSlice ?? GENERATION_SLICE_POLICY.maxAttemptsPerSlice;
  }

  private nowIso(): string { return isoOf(this.clock()); }
  private scopeKey(scope: DurableWorkflowScope): string { return durableScopeKey(scope, GENERATION_TASK_SCOPE_SUFFIX); }

  // ── reads ──

  private async readHead(scope: DurableWorkflowScope, id: string): Promise<{ kind: "missing" } | { kind: "invalid"; issue: string } | { kind: "ok"; head: GenerationTaskHead; revision: number }> {
    if (typeof id !== "string" || !TASK_ID.test(id)) return { kind: "missing" };
    let canonical: DurableWorkflowScope;
    try { canonical = canonicalDurableScope(scope); } catch { return { kind: "missing" }; }
    const record = await this.repository.loadHead<GenerationTaskHead>(durableAggregateIdentity(canonical, HEAD, id));
    if (!record) return { kind: "missing" };
    if (durableWorkflowDigest(record.payload) !== record.recordDigest) return { kind: "invalid", issue: "GENERATION_TASK_RECORD_MISMATCH" };
    const issue = generationTaskHeadIssue(record.payload);
    if (issue) return { kind: "invalid", issue };
    if (record.payload.taskId !== id || !sameScope(record.payload.scope, canonical)) return { kind: "invalid", issue: "head: not this scope's task" };
    return { kind: "ok", head: record.payload, revision: record.revision };
  }

  /** The validated head, or the uniform refusal (an unknown id, a foreign scope's id and a malformed id answer the same). */
  async load(scope: DurableWorkflowScope, id: string): Promise<GenerationTaskLoad> {
    const read = await this.readHead(scope, id);
    if (read.kind === "missing") return { ok: false, code: "GENERATION_TASK_NOT_FOUND" };
    if (read.kind === "invalid") return { ok: false, code: "GENERATION_TASK_INVALID_PERSISTED_STATE", taskId: id, issue: read.issue };
    return { ok: true, task: read.head, revision: read.revision };
  }

  async loadIndex(scope: DurableWorkflowScope): Promise<{ index: GenerationTaskIndex; revision: number }> {
    const canonical = canonicalDurableScope(scope);
    const record = await this.repository.loadHead<GenerationTaskIndex>(durableAggregateIdentity(canonical, GENERATION_TASK_AGGREGATES.index, GENERATION_TASK_INDEX_KEY));
    if (!record) return { index: emptyGenerationTaskIndex(), revision: 0 };
    const issue = durableWorkflowDigest(record.payload) !== record.recordDigest ? "GENERATION_TASK_RECORD_MISMATCH" : generationTaskIndexIssue(record.payload);
    if (issue) throw new GenerationTaskStoreError("GENERATION_TASK_INVALID_PERSISTED_STATE", `index: ${issue}`);
    return { index: record.payload, revision: record.revision };
  }

  /** A record the head references, verified: the aggregate it belongs to, its digest as referenced and as recomputed. */
  private async referenced<T extends object>(scope: DurableWorkflowScope, ref: { recordId: string; recordDigest: string }, aggregateType: string, aggregateKey: string): Promise<DurableAggregateRecord<T>> {
    const record = await this.repository.loadRecord<T>(canonicalDurableScope(scope), ref.recordId);
    if (!record || record.aggregateType !== aggregateType || record.aggregateKey !== aggregateKey || record.recordDigest !== ref.recordDigest || durableWorkflowDigest(record.payload) !== ref.recordDigest) {
      throw new GenerationTaskStoreError("GENERATION_TASK_RECORD_MISMATCH", "a referenced record is missing or does not match its reference");
    }
    return record;
  }
  /** A block's checkpoint, ONLY as the head references it (null when the block has none). */
  async readBlock(scope: DurableWorkflowScope, task: GenerationTaskHead, block: GenerationBlockId): Promise<BuildLoopCheckpoint | null> {
    const ref = task.blocks[block]?.artifactRef;
    if (!ref) return null;
    const record = await this.referenced<BuildLoopCheckpoint>(scope, ref, GENERATION_TASK_AGGREGATES.block, generationBlockAggregateKey(task.taskId, block));
    if (buildLoopCheckpointIssue(record.payload) || record.payload.taskId !== task.taskId || record.payload.blockId !== block) throw new GenerationTaskStoreError("GENERATION_TASK_RECORD_MISMATCH", "a referenced checkpoint is invalid");
    return record.payload;
  }
  async readFacts(scope: DurableWorkflowScope, task: GenerationTaskHead): Promise<GenerationTaskFacts | null> {
    if (!task.facts) return null;
    const record = await this.referenced<GenerationTaskFacts>(scope, task.facts, GENERATION_TASK_AGGREGATES.facts, task.taskId);
    if (record.revision !== task.facts.revision || generationTaskFactsIssue(record.payload) || record.payload.taskId !== task.taskId) throw new GenerationTaskStoreError("GENERATION_TASK_RECORD_MISMATCH", "the referenced facts are invalid");
    return record.payload;
  }
  async readResult(scope: DurableWorkflowScope, task: GenerationTaskHead): Promise<GenerationTaskResultPayload | null> {
    if (!task.result) return null;
    const record = await this.referenced<GenerationTaskResultPayload>(scope, task.result, GENERATION_TASK_AGGREGATES.result, task.taskId);
    if (generationTaskResultIssue(record.payload) || record.payload.taskId !== task.taskId || record.payload.resultDigest !== task.result.resultDigest) throw new GenerationTaskStoreError("GENERATION_TASK_RECORD_MISMATCH", "the referenced result is invalid");
    return record.payload;
  }
  /** One page of the ordered public milestones after `after` (section 6.3). */
  async events(scope: DurableWorkflowScope, id: string, input: { after?: number; limit?: number } = {}): Promise<{ ok: true; page: GenerationTaskEventsPage; state: GenerationTaskState } | Exclude<GenerationTaskLoad, { ok: true }>> {
    const loaded = await this.load(scope, id);
    if (!loaded.ok) return loaded;
    return { ok: true, page: generationTaskEventsPage(loaded.task, input), state: loaded.task.state };
  }

  // ── commits ──

  /** Commit; an error other than a CAS conflict may have landed (a transport error after commit): retry ONCE with the same key,
   *  which answers the replay when it did. */
  private async commitOnce<T extends object>(request: Parameters<DurableWorkflowRepository["commit"]>[0] & { result: T }): Promise<DurableCommitResult<T>> {
    try { return await this.repository.commit<T>(request); }
    catch (error) {
      if (isCasConflict(error)) throw error;
      return this.repository.commit<T>(request);
    }
  }
  private replayedHead(result: DurableCommitResult<object>, id: string): GenerationTaskHead | null {
    const record = result.records.find((entry) => entry.aggregateType === HEAD && entry.aggregateKey === id);
    return record ? (record.payload as GenerationTaskHead) : null;
  }

  /** A slice commit already made under this idempotency key (an ambiguous commit retried, or a worker repeating its call). */
  private async replayOf(scope: DurableWorkflowScope, id: string, key: string): Promise<GenerationCommitOutcome | null> {
    const canonical = canonicalDurableScope(scope), replay = await this.repository.getReplay<object>(canonical, this.scopeKey(canonical), key);
    const head = replay ? this.replayedHead(replay, id) : null;
    return replay && head ? { ok: true, task: head, revision: replay.records.find((entry) => entry.aggregateType === HEAD)!.revision, replayed: true } : null;
  }

  /** The one head-commit path: load, fence check, delta, judge, transition check, index on a terminal transition, CAS commit;
   *  a CAS conflict reloads and re-applies the delta (the rebase rule). */
  private async commitHead(input: {
    scope: DurableWorkflowScope; taskId: string; key: string; actor: GenerationTransitionActor;
    fence?: { sliceId: string; fence: number; leaseToken: string; allowCancel?: boolean };
    mutate: (current: GenerationTaskHead) => Promise<HeadChange | Refusal> | HeadChange | Refusal;
    retries?: number;
  }): Promise<GenerationCommitOutcome> {
    const scope = canonicalDurableScope(input.scope), scopeKey = this.scopeKey(scope);
    const replayed = await this.replayOf(scope, input.taskId, input.key);
    if (replayed) return replayed;
    const retries = input.retries ?? GENERATION_SLICE_POLICY.rebaseRetries;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const read = await this.readHead(scope, input.taskId);
      if (read.kind === "missing") return refuse("GENERATION_TASK_NOT_FOUND");
      if (read.kind === "invalid") return refuse("GENERATION_TASK_INVALID_PERSISTED_STATE", read.issue);
      const current = read.head;
      if (input.fence) {
        const owner = current.pending[input.fence.sliceId]?.owner;
        if (!owner || owner.fence !== input.fence.fence || owner.leaseToken !== input.fence.leaseToken) return refuse("GENERATION_SLICE_FENCED");
        if (!input.fence.allowCancel && (current.state === "cancel-requested" || current.state === "cancelled" || current.control.cancel)) return refuse("GENERATION_TASK_CANCEL_REQUESTED");
      }
      const change = await input.mutate(clone(current));
      if ("ok" in change) return change;
      if (change.noop) return { ok: true, task: current, revision: read.revision, replayed: true };
      const next = change.next;
      // the delta's own clock reading is the commit time (its scheduled effects' availableAt were judged against it); never backwards
      if (next.updatedAt === current.updatedAt) next.updatedAt = this.nowIso();
      if (Date.parse(next.updatedAt) < Date.parse(current.updatedAt)) next.updatedAt = current.updatedAt;
      try { assertGenerationTaskHead(next); }
      catch (error) { if (error instanceof GenerationTaskContractError) return refuse(error.code === "GENERATION_TASK_TOO_LARGE" ? "GENERATION_TASK_TOO_LARGE" : "GENERATION_TASK_STATE_CONFLICT", `${error.code}: ${error.issue}`); throw error; }
      const scheduled = new Set(change.scheduled ?? []);
      for (const key of Object.keys(next.pending)) if (!current.pending[key] && !scheduled.has(key)) return refuse("GENERATION_TASK_STATE_CONFLICT", "a newly pending slice has no outbox effect in its commit");
      const transitionIssue = generationTaskTransitionIssue(current, next, input.actor, { ...change.attest, scheduled: [...scheduled] }, change.via);
      if (transitionIssue) return refuse("GENERATION_TASK_TRANSITION_REFUSED", transitionIssue);
      const operations: Array<DurableAppendOperation<object>> = [{ aggregateType: HEAD, aggregateKey: input.taskId, expectedRevision: read.revision, payload: next }, ...(change.extraOperations ?? [])];
      if (isTerminalGenerationTaskState(next.state) && !isTerminalGenerationTaskState(current.state)) {
        const { index, revision } = await this.loadIndex(scope);
        operations.push({ aggregateType: GENERATION_TASK_AGGREGATES.index, aggregateKey: GENERATION_TASK_INDEX_KEY, expectedRevision: revision, payload: generationIndexWith(index, next) });
      }
      try {
        const committed = await this.commitOnce({ scope, scopeKey, idempotencyKey: input.key, operations, outbox: change.outbox ?? [], result: { taskId: input.taskId, state: next.state }, committedAt: next.updatedAt });
        const head = this.replayedHead(committed as DurableCommitResult<object>, input.taskId) ?? next;
        for (const operation of change.extraOperations ?? []) {
          const record = committed.records.find((entry) => entry.aggregateType === operation.aggregateType && entry.aggregateKey === operation.aggregateKey);
          if (!record || (operation.aggregateType === GENERATION_TASK_AGGREGATES.facts && record.recordId !== head.facts?.recordId)) throw new GenerationTaskStoreError("GENERATION_TASK_RECORD_MISMATCH", "a joint record does not match the head's reference");
        }
        return { ok: true, task: head, revision: committed.records.find((entry) => entry.aggregateType === HEAD)!.revision, replayed: committed.idempotent };
      } catch (error) {
        if (isCasConflict(error)) continue;
        throw error;
      }
    }
    return refuse("GENERATION_TASK_CONTENDED");
  }

  /** The joint facts operation: the referenced facts (never an unreferenced revision) merged with this slice's delta. */
  private async factsOperation(scope: DurableWorkflowScope, current: GenerationTaskHead, next: GenerationTaskHead, delta: GenerationFactsDelta): Promise<DurableAppendOperation<object>> {
    const base = await this.readFacts(scope, current);
    const aggregate = await this.repository.loadHead(durableAggregateIdentity(canonicalDurableScope(scope), GENERATION_TASK_AGGREGATES.facts, current.taskId));
    const revision = (aggregate?.revision ?? 0) + 1;
    const facts = applyGenerationFactsDelta(base, delta, { taskId: current.taskId, catalogProfile: current.identities.catalogProfile, embeddingModel: current.identities.embeddingModel });
    const recordDigest = durableWorkflowDigest(facts);
    next.facts = { recordId: expectedRecordId(canonicalDurableScope(scope), GENERATION_TASK_AGGREGATES.facts, current.taskId, revision, recordDigest), recordDigest, revision };
    return { aggregateType: GENERATION_TASK_AGGREGATES.facts, aggregateKey: current.taskId, expectedRevision: revision - 1, payload: facts, recordDigest };
  }

  /** A single-aggregate artifact commit (a block checkpoint or the result): CAS on that aggregate only; its ref for the head. */
  private async commitArtifact(scope: DurableWorkflowScope, aggregateType: string, aggregateKey: string, payload: object, key: string): Promise<{ recordId: string; recordDigest: string }> {
    const canonical = canonicalDurableScope(scope), scopeKey = this.scopeKey(canonical);
    for (let attempt = 0; attempt <= GENERATION_SLICE_POLICY.rebaseRetries; attempt += 1) {
      const current = await this.repository.loadHead(durableAggregateIdentity(canonical, aggregateType, aggregateKey));
      try {
        const committed = await this.commitOnce({ scope: canonical, scopeKey, idempotencyKey: key, operations: [{ aggregateType, aggregateKey, expectedRevision: current?.revision ?? 0, payload }], outbox: [], result: { aggregateType, aggregateKey }, committedAt: this.nowIso() });
        const record = committed.records[0]!;
        return { recordId: record.recordId, recordDigest: record.recordDigest };
      } catch (error) {
        if (isCasConflict(error)) continue;
        throw error;
      }
    }
    throw new GenerationTaskStoreError("GENERATION_TASK_CONTENDED", "an artifact commit stayed contended");
  }

  private sliceEffect(head: GenerationTaskHead, sliceIdValue: string, kind: GenerationSliceKind, block: GenerationBlockId | null, notBefore: string): DurableOutboxEffect {
    return {
      owner: { aggregateType: HEAD, aggregateKey: head.taskId }, eventType: GENERATION_SLICE_EVENT.eventType, eventVersion: GENERATION_SLICE_EVENT.eventVersion, topic: GENERATION_SLICE_TOPIC,
      payload: { schema: GENERATION_SLICE_CONTRACT, taskId: head.taskId, sliceId: sliceIdValue, kind, blockId: block }, idempotencyKey: sliceIdValue,
      ...(Date.parse(notBefore) > Date.parse(head.updatedAt) ? { availableAt: notBefore } : {}),
    };
  }
  /** Schedule slices onto `next` (fresh ids) and answer their effects. */
  private schedule(next: GenerationTaskHead, work: ReadonlyArray<{ kind: GenerationSliceKind; blockId: GenerationBlockId | null; notBefore?: string; wait?: GenerationPendingWait }>, nowIso: string): { outbox: DurableOutboxEffect[]; scheduled: string[] } {
    const outbox: DurableOutboxEffect[] = [], scheduled: string[] = [];
    next.updatedAt = nowIso;
    for (const entry of work) {
      const id = generationSliceId(next.taskId, next.nextSliceSeq);
      next.nextSliceSeq += 1;
      const notBefore = entry.notBefore && Date.parse(entry.notBefore) > Date.parse(nowIso) ? isoOf(Date.parse(entry.notBefore)) : nowIso;
      next.pending[id] = { kind: entry.kind, blockId: entry.blockId, notBefore, state: "queued", owner: null, ...(entry.wait ? { wait: { ...entry.wait } } : {}) }; // [PR-J, 2026-11-04] J7-2
      if (entry.kind === "block" && entry.blockId) { const block = next.blocks[entry.blockId]; if (block && (block.status === "blocked" || block.status === "needs-revalidation")) { block.status = "queued"; block.blocker = null; delete block.missing; } } // [PR-L6, 2026-10-19] a re-queued block no longer waits for its roles (the S3 re-search reads them from its conversation)
      outbox.push(this.sliceEffect(next, id, entry.kind, entry.blockId, notBefore));
      scheduled.push(id);
    }
    return { outbox, scheduled };
  }
  private milestones(next: GenerationTaskHead, drafts: readonly GenerationTaskEventDraft[]): void {
    const appended = appendGenerationTaskEvents(next, drafts);
    next.milestones = appended.milestones;
    next.eventSeq = appended.eventSeq;
  }
  /** Slices whose owner still holds an unexpired outbox lease with the owner's token. */
  private async liveOwners(scope: DurableWorkflowScope, head: GenerationTaskHead, nowMs: number): Promise<Set<string>> {
    const owned = Object.entries(head.pending).filter(([, entry]) => entry.owner !== null);
    if (!owned.length) return new Set();
    const events = await this.repository.listOutbox({ scope: canonicalDurableScope(scope), topic: GENERATION_SLICE_TOPIC, state: "processing" });
    const live = new Set<string>();
    for (const [id, entry] of owned) if (events.some((event) => event.payload.sliceId === id && event.leaseToken === entry.owner!.leaseToken && Date.parse(event.leaseExpiresAt ?? "") > nowMs)) live.add(id);
    return live;
  }
  /** Drop pending slices that have no live owner (their late results are fenced out); an owned one keeps its reservation as uncertain. */
  private dropUnlive(next: GenerationTaskHead, live: ReadonlySet<string>): void {
    for (const [id, entry] of Object.entries(next.pending)) {
      if (live.has(id)) continue;
      if (entry.owner) markUncertain(next, id, entry.owner.attempt);
      delete next.pending[id];
    }
  }

  // ── start / attach ──

  async createOrAttach(input: GenerationTaskStartInput): Promise<GenerationTaskStartOutcome> {
    let scope: DurableWorkflowScope;
    try { scope = canonicalDurableScope(input.scope); } catch { return { ok: false, status: 400, code: "GENERATION_TASK_INVALID_REQUEST", issue: "scope: a trusted scope is required" }; }
    if (!isGenerationEditorRole(input.principal?.role)) return { ok: false, status: 403, code: "GENERATION_TASK_FORBIDDEN" };
    const request = input.request;
    if (typeof request?.clientRequestId !== "string" || !CLIENT_REQUEST_ID.test(request.clientRequestId)) return { ok: false, status: 400, code: "GENERATION_TASK_INVALID_REQUEST", issue: "request.clientRequestId: a client request uuid is required" };
    if (typeof request.prompt !== "string" || request.prompt.trim().length < 1 || request.prompt.length > GENERATION_TASK_BOUNDS.promptChars) return { ok: false, status: 400, code: "GENERATION_TASK_INVALID_REQUEST", issue: "request.prompt: 1..4000 characters" };
    if (typeof input.base?.schematicDigest !== "string" || !ENGINEERING_DIGEST.test(input.base.schematicDigest) || !(GENERATION_BASE_RECIPES as readonly string[]).includes(input.base.recipe)) return { ok: false, status: 400, code: "GENERATION_TASK_INVALID_REQUEST", issue: "base: a schematic digest and its recipe are required" };
    if (input.base.headMark !== undefined && input.base.headMark !== null && validateSchematicCanonicalMark(input.base.headMark) === null) return { ok: false, status: 400, code: "GENERATION_TASK_INVALID_REQUEST", issue: "base.headMark: a schematic canonical mark" };
    if (!(GENERATION_CATALOG_PROFILES as readonly string[]).includes(input.identities?.catalogProfile)) return { ok: false, status: 400, code: "GENERATION_TASK_INVALID_REQUEST", issue: "identities.catalogProfile: outside the closed list" };
    if (input.providerServable !== true) return { ok: false, status: 503, code: "GENERATION_PROVIDER_UNAVAILABLE" };
    const prompt = cleanModelText(request.prompt, GENERATION_TASK_BOUNDS.promptChars);
    const id = generationTaskId(scope, input.principal.principalId, request.clientRequestId);
    const requestDigest = generationRequestDigest({ prompt, provider: request.provider, mode: "build", origin: input.origin, base: input.base });
    const startScopeKey = durableScopeKey(scope, GENERATION_TASK_START_SCOPE_SUFFIX), key = `start:${id}`;
    for (let attempt = 0; attempt <= GENERATION_SLICE_POLICY.claimRetries; attempt += 1) {
      const existing = await this.readHead(scope, id);
      if (existing.kind === "ok") return existing.head.request.requestDigest === requestDigest ? { ok: true, status: 202, attached: true, replayed: false, task: existing.head } : { ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" };
      if (existing.kind === "invalid") return { ok: false, status: 500, code: "GENERATION_TASK_INVALID_PERSISTED_STATE", taskId: id };
      const { index, revision } = await this.loadIndex(scope);
      if (index.active && index.active.taskId !== id) {
        const active = await this.readHead(scope, index.active.taskId);
        if (active.kind === "ok" && !isTerminalGenerationTaskState(active.head.state)) return { ok: false, status: 409, code: "GENERATION_TASK_ACTIVE", activeTask: { taskId: active.head.taskId, state: active.head.state, createdAt: active.head.createdAt } };
      }
      const now = this.nowIso();
      const head: GenerationTaskHead = {
        schema: GENERATION_TASK_SCHEMA, taskId: id, scope,
        initiator: { principalId: input.principal.principalId, role: input.principal.role, membershipRevision: input.principal.membershipRevision, origin: input.origin, chatRunId: input.origin === "chat" ? input.chatRunId ?? null : null },
        request: { clientRequestId: request.clientRequestId, prompt, provider: request.provider, mode: "build", requestDigest },
        base: { schematicDigest: input.base.schematicDigest, recipe: input.base.recipe, headMark: input.base.headMark ?? null, moved: false },
        identities: { catalogProfile: input.identities.catalogProfile, embeddingModel: input.identities.embeddingModel, promptDigests: { ...input.identities.promptDigests }, sliceContract: GENERATION_SLICE_CONTRACT },
        state: "queued", phase: "planning", plan: null, blocks: {}, pending: {}, nextSliceSeq: 1, fenceCounter: 0,
        usage: zeroUsage(), reservations: [], allowance: { unit: { ...(input.allowanceUnit ?? GENERATION_TASK_ALLOWANCE_UNIT) }, units: 1, extensions: [] },
        control: { cancel: null, pause: null, applied: [] }, blocker: null, result: null, facts: null, review: null, failure: null, derivedFrom: null,
        milestones: [], eventSeq: 0, createdAt: now, updatedAt: now,
      };
      const { outbox, scheduled } = this.schedule(head, [{ kind: "plan", blockId: null }], now);
      this.milestones(head, [generationTaskEvent("task_accepted", { at: now, phase: "planning", message: `Design request accepted (${input.origin}); waiting for a generation worker to plan it.`, data: { origin: input.origin, provider: request.provider } })]);
      const issue = generationTaskHeadIssue(head) ?? generationTaskTransitionIssue(null, head, "start-api", { providerServable: true, scheduled });
      if (issue) return { ok: false, status: 400, code: "GENERATION_TASK_INVALID_REQUEST", issue };
      try {
        const committed = await this.commitOnce({
          scope, scopeKey: startScopeKey, idempotencyKey: key, outbox, result: { taskId: id }, committedAt: now,
          operations: [{ aggregateType: GENERATION_TASK_AGGREGATES.index, aggregateKey: GENERATION_TASK_INDEX_KEY, expectedRevision: revision, payload: generationIndexWith(index, head) }, { aggregateType: HEAD, aggregateKey: id, expectedRevision: 0, payload: head }],
        });
        return { ok: true, status: 202, attached: false, replayed: committed.idempotent, task: this.replayedHead(committed as DurableCommitResult<object>, id) ?? head };
      } catch (error) {
        if (isCasConflict(error)) continue;
        throw error;
      }
    }
    return { ok: false, status: 409, code: "GENERATION_TASK_CONTENDED" };
  }

  // ── control (section 2's control-API transitions; rebase and start-from-saved create a new task: increment 4) ──

  async control(input: GenerationControlInput): Promise<GenerationCommitOutcome> {
    if (!isGenerationEditorRole(input.principal?.role)) return refuse("GENERATION_TASK_FORBIDDEN");
    if (typeof input.clientActionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.clientActionId)) return refuse("GENERATION_TASK_STATE_CONFLICT", "clientActionId: an identifier is required");
    if (input.action === "rebase" || input.action === "start-from-saved") return refuse("GENERATION_TASK_ACTION_UNSUPPORTED", `${input.action} creates a new task (increment 4)`);
    const key = `control:${input.clientActionId}`;
    try { canonicalDurableScope(input.scope); } catch { return refuse("GENERATION_TASK_NOT_FOUND"); }
    // one client action id names ONE action: its committed replay answers the same action and refuses another
    const replayed = await this.replayOf(input.scope, input.taskId, key);
    if (replayed?.ok) return replayed.task.control.applied.some((stamp) => stamp.clientActionId === input.clientActionId && stamp.action !== input.action) ? refuse("IDEMPOTENCY_KEY_REUSED") : replayed;
    return this.commitHead({
      scope: input.scope, taskId: input.taskId, key, actor: "control-api",
      mutate: async (head) => {
        const previous = head.control.applied.find((stamp) => stamp.clientActionId === input.clientActionId);
        if (previous) return previous.action === input.action ? { next: head, noop: true } : refuse("IDEMPOTENCY_KEY_REUSED");
        const now = this.nowIso(), nowMs = Date.parse(now);
        const stamp: GenerationControlStamp = { action: input.action, clientActionId: input.clientActionId, principalId: input.principal.principalId, at: now };
        const next = clone(head);
        next.updatedAt = now;
        const attest: GenerationTransitionAttestation = { controlAction: input.action, clientActionId: input.clientActionId, principalRole: input.principal.role };
        switch (input.action) {
          case "cancel": {
            if (head.state === "cancel-requested" || head.state === "cancelled") return { next: head, noop: true };
            if (!["queued", "running", "waiting-for-provider", "waiting-for-resource", "paused"].includes(head.state)) return refuse("GENERATION_TASK_STATE_CONFLICT", `cancel: not from ${head.state}`);
            next.control.cancel = stamp; pushStamp(next, stamp);
            this.dropUnlive(next, await this.liveOwners(input.scope, head, nowMs));
            const drafts = [generationTaskEvent("cancel_requested", { at: now, message: "Stop requested; no new design work will start." })];
            const settled = !hasGenerationOwner(next);
            if (settled) { next.phase = null; drafts.push(generationTaskEvent("cancelled", { at: now, message: "The design was stopped; saved blocks stay readable." })); }
            this.milestones(next, drafts);
            next.state = settled ? "cancelled" : "cancel-requested";
            return { next, attest: { ...attest, noLiveLease: settled }, ...(settled ? { via: "cancel-requested" as const } : {}) };
          }
          case "pause": {
            if (head.state === "paused") return { next: head, noop: true };
            if (!["queued", "running", "waiting-for-provider", "waiting-for-resource"].includes(head.state)) return refuse("GENERATION_TASK_STATE_CONFLICT", `pause: not from ${head.state}`);
            next.control.pause = stamp; pushStamp(next, stamp);
            this.dropUnlive(next, await this.liveOwners(input.scope, head, nowMs));
            if (!hasGenerationOwner(next)) { next.state = "paused"; this.milestones(next, [generationTaskEvent("paused", { at: now, phase: next.phase, message: "The design is paused; saved work is kept." })]); }
            return { next, attest };
          }
          case "resume": {
            if (head.state !== "paused" && head.state !== "waiting-for-resource") return refuse("GENERATION_TASK_STATE_CONFLICT", `resume: not from ${head.state}`);
            pushStamp(next, stamp);
            if (input.extendAllowance) {
              if (next.allowance.extensions.length >= GENERATION_TASK_BOUNDS.extensions) return refuse("GENERATION_TASK_STATE_CONFLICT", "resume: the allowance extension cap is reached");
              next.allowance.extensions.push({ principalId: input.principal.principalId, clientActionId: input.clientActionId, at: now });
              next.allowance.units += 1;
            }
            next.control.pause = null; next.blocker = null;
            const work = nextGenerationWork(next);
            if (!work.length) return refuse("GENERATION_TASK_STATE_CONFLICT", "resume: nothing left to schedule");
            const { outbox, scheduled } = this.schedule(next, work, now);
            next.phase = work[0]!.kind === "plan" ? "planning" : work[0]!.kind === "merge" ? "merging" : "designing";
            this.milestones(next, [generationTaskEvent("resumed", { at: now, phase: next.phase, message: `Design resumed: ${work.length} slice(s) scheduled.` })]);
            next.state = "queued";
            return { next, attest, outbox, scheduled };
          }
          case "retry-block":
          case "review-partial": {
            if (head.state !== "waiting-for-resource") return refuse("GENERATION_TASK_STATE_CONFLICT", `${input.action}: not from ${head.state}`);
            pushStamp(next, stamp);
            let work: Array<{ kind: GenerationSliceKind; blockId: GenerationBlockId | null }>;
            if (input.action === "retry-block") {
              const block = input.blockId ? next.blocks[input.blockId] : undefined;
              if (!block || block.status === "saved" || block.status === "omitted") return refuse("GENERATION_TASK_STATE_CONFLICT", "retry-block: a planned block that is not saved");
              block.status = "queued"; block.blocker = null; block.stagnantSlices = 0; delete block.missing;
              work = [{ kind: "block", blockId: block.blockId }];
            } else {
              const blocks = Object.values(next.blocks).filter((block): block is GenerationBlockState => Boolean(block));
              if (!blocks.some((block) => block.status === "saved")) return refuse("GENERATION_TASK_STATE_CONFLICT", "review-partial: no saved block");
              for (const block of blocks) if (block.status !== "saved") { block.status = "omitted"; block.blocker = null; } // [PR-L6, 2026-10-19] an omitted block keeps its `missing` roles: the partial result names them
              work = [{ kind: "merge", blockId: null }];
            }
            next.blocker = null;
            const { outbox, scheduled } = this.schedule(next, work, now);
            next.phase = work[0]!.kind === "merge" ? "merging" : "designing";
            this.milestones(next, [generationTaskEvent("resumed", { at: now, phase: next.phase, blockId: work[0]!.blockId, message: input.action === "retry-block" ? "Retrying the blocked block." : "Reviewing the saved blocks as a partial design." })]);
            next.state = "queued";
            return { next, attest, outbox, scheduled };
          }
          case "record-review": {
            if (head.state !== "awaiting-review" || !head.result) return refuse("GENERATION_TASK_STATE_CONFLICT", `record-review: not from ${head.state}`);
            const review = input.review;
            if (!review || !(GENERATION_REVIEW_OUTCOMES as readonly string[]).includes(review.outcome) || review.resultDigest !== head.result.resultDigest) return refuse("GENERATION_TASK_STATE_CONFLICT", "record-review: the outcome of THIS result");
            const headMark = review.headMark ?? null;
            if (headMark !== null && validateSchematicCanonicalMark(headMark) === null) return refuse("GENERATION_TASK_STATE_CONFLICT", "record-review: a canonical head mark");
            pushStamp(next, stamp);
            next.review = { outcome: review.outcome, at: now, principalId: input.principal.principalId, headMark };
            next.phase = null;
            this.milestones(next, [generationTaskEvent("review_recorded", { at: now, message: review.outcome === "applied" ? "The reviewed design was applied." : "The reviewed design was discarded.", data: { outcome: review.outcome } })]);
            next.state = "succeeded";
            return { next, attest: { ...attest, resultDigest: review.resultDigest } };
          }
          case "report-base": {
            if (head.state !== "awaiting-review") return refuse("GENERATION_TASK_STATE_CONFLICT", `report-base: not from ${head.state}`);
            const live = input.liveBase;
            if (!live || live.recipe !== head.base.recipe || typeof live.schematicDigest !== "string" || !ENGINEERING_DIGEST.test(live.schematicDigest)) return refuse("GENERATION_TASK_STATE_CONFLICT", "report-base: the live base digest of the same recipe");
            if (live.schematicDigest === head.base.schematicDigest) return { next: head, noop: true };
            pushStamp(next, stamp);
            next.base.moved = true; next.phase = null;
            this.milestones(next, [generationTaskEvent("stale", { at: now, message: "The sheet changed since this design started; the result needs a rebase before review." })]);
            next.state = "stale";
            return { next, attest: { ...attest, liveBaseDigest: live.schematicDigest } };
          }
          default: return refuse("GENERATION_TASK_ACTION_UNSUPPORTED");
        }
      },
    });
  }

  // ── slices ──

  /** Claim up to `limit` slices of any scope - or, with `scope` ([PR-L6, 2026-10-19] the worker's `--scope`), of that scope only - (the
   *  caller's FREE capacity), then claim each slice's head. */
  async claimSlices(input: { workerId: string; limit: number; revalidate: GenerationSliceRevalidator; scope?: DurableWorkflowScope }): Promise<GenerationClaimOutcome[]> {
    const nowMs = this.clock();
    const events = await this.repository.claimOutbox({ workerId: input.workerId, now: isoOf(nowMs), leaseUntil: isoOf(nowMs + this.leaseMs), limit: input.limit, topics: [GENERATION_SLICE_TOPIC], ...(input.scope ? { scope: canonicalDurableScope(input.scope) } : {}) });
    const outcomes: GenerationClaimOutcome[] = [];
    for (const event of events) outcomes.push(await this.claimOne(event, input.workerId, input.revalidate));
    return outcomes;
  }

  private async finish(event: DurableOutboxEvent, workerId: string, how: { terminal?: string; retryAt?: string }): Promise<void> {
    const base = { scope: event.scope, eventId: event.eventId, workerId, leaseToken: event.leaseToken! };
    try {
      if (how.terminal) await this.repository.failOutbox({ ...base, errorCode: how.terminal, failedAt: this.nowIso(), retryAt: this.nowIso(), terminal: true });
      else if (how.retryAt) await this.repository.failOutbox({ ...base, errorCode: "GENERATION_SLICE_NOT_YET", failedAt: this.nowIso(), retryAt: how.retryAt, terminal: false });
      else await this.repository.completeOutbox({ ...base, completedAt: this.nowIso() });
    } catch (error) {
      if (!(error instanceof Error && error.message === "DW_OUTBOX_LEASE_CONFLICT")) throw error; // the event moved on: the head already decides
    }
  }

  private async claimOne(event: DurableOutboxEvent, workerId: string, revalidate: GenerationSliceRevalidator): Promise<GenerationClaimOutcome> {
    const payload = event.payload as Record<string, unknown>;
    const id = typeof payload?.taskId === "string" && TASK_ID.test(payload.taskId) ? payload.taskId : null;
    const slice = typeof payload?.sliceId === "string" && SLICE_ID.test(payload.sliceId) ? payload.sliceId : null;
    if (!event.leaseToken || payload?.schema !== GENERATION_SLICE_CONTRACT || !id || !slice || !slice.startsWith(`${id}:s`)) {
      if (event.leaseToken) await this.finish(event, workerId, { terminal: "GENERATION_SLICE_EVENT_INVALID" });
      return { outcome: "dropped", eventId: event.eventId, taskId: id, code: "GENERATION_SLICE_EVENT_INVALID" };
    }
    const attempt = event.attempts, leaseToken = event.leaseToken;
    for (let round = 0; round <= GENERATION_SLICE_POLICY.claimRetries; round += 1) {
      const read = await this.readHead(event.scope, id);
      if (read.kind !== "ok") {
        const code = read.kind === "missing" ? "GENERATION_TASK_NOT_FOUND" : "GENERATION_TASK_INVALID_PERSISTED_STATE";
        await this.finish(event, workerId, { terminal: code });
        return { outcome: "dropped", eventId: event.eventId, taskId: id, code };
      }
      const head = read.head, entry = head.pending[slice];
      if (isTerminalGenerationTaskState(head.state) || !entry) { await this.finish(event, workerId, {}); return { outcome: "stale-event", eventId: event.eventId, taskId: id }; }
      const nowMs = this.clock(), now = isoOf(nowMs);
      // a cancelling or pausing task: this (lapsed or queued) slice is dropped; the task settles when no live owner remains
      if (head.control.cancel || head.control.pause) {
        const live = await this.liveOwners(event.scope, head, nowMs);
        const outcome = await this.commitHead({
          scope: event.scope, taskId: id, key: `${slice}:a${attempt}:drop`, actor: "worker",
          mutate: (current) => {
            const next = clone(current), dropped = next.pending[slice];
            if (!dropped) return { next: current, noop: true };
            if (dropped.owner) markUncertain(next, slice, dropped.owner.attempt);
            delete next.pending[slice];
            next.updatedAt = now;
            const owned = Object.keys(next.pending).some((key) => live.has(key) && next.pending[key]!.owner !== null);
            if (current.control.cancel) {
              if (!owned) { this.dropUnlive(next, live); next.phase = null; next.state = "cancelled"; this.milestones(next, [generationTaskEvent("cancelled", { at: now, message: "The design was stopped; saved blocks stay readable." })]); }
              return { next, attest: { noLiveLease: !owned } };
            }
            const state = deriveGenerationTaskState(next, nowMs);
            if (state === "paused" && current.state !== "paused") this.milestones(next, [generationTaskEvent("paused", { at: now, phase: next.phase, message: "The design is paused; saved work is kept." })]);
            next.state = state ?? current.state;
            return { next };
          },
        });
        await this.finish(event, workerId, {});
        return { outcome: head.control.cancel ? "cancelled" : "stale-event", eventId: event.eventId, taskId: id, ...(outcome.ok ? {} : { code: outcome.code }) };
      }
      if (Date.parse(entry.notBefore) > nowMs) { await this.finish(event, workerId, { retryAt: entry.notBefore }); return { outcome: "not-before", eventId: event.eventId, taskId: id }; }
      // refusals before any provider call: lost workers, authority, provider, allowance (section 3.2 steps 2-3)
      let blockerCode: GenerationBlockerCode | null = attempt - 1 >= this.maxAttempts ? "platform_failure" : null;
      let failure: "authority_revoked" | null = null;
      if (!blockerCode) {
        const verdict = await revalidate(clone(head));
        if (!verdict.ok) { if ("failure" in verdict) failure = verdict.failure; else blockerCode = verdict.blocker; }
      }
      const reservation = generationReservationFor(entry.kind, this.turns);
      if (!blockerCode && !failure) { blockerCode = generationAllowanceRefusal(head, reservation, nowMs); if (blockerCode === "allowance_exhausted" && entry.owner === null) { const waited = await this.waitForAllowance(event, workerId, head, slice, entry, reservation, nowMs); if (waited === "retry") continue; if (waited) return waited; } } // [PR-J, 2026-11-04] J7-2: ONLY live siblings' held reservations refuse it - re-queued (bounded), never parked; revalidated above first
      if (failure || blockerCode) {
        const outcome = await this.commitHead({
          scope: event.scope, taskId: id, key: `${slice}:a${attempt}:refuse`, actor: "worker",
          mutate: (current) => {
            const next = clone(current), refused = next.pending[slice];
            if (!refused) return { next: current, noop: true };
            next.updatedAt = now;
            if (failure) {
              for (const [key, pendingEntry] of Object.entries(next.pending)) { if (pendingEntry.owner) markUncertain(next, key, pendingEntry.owner.attempt); delete next.pending[key]; }
              next.failure = { reason: failure, at: now }; next.blocker = null; next.phase = null; next.state = "failed";
              this.milestones(next, [generationTaskEvent("failed", { at: now, message: "The design stopped: the requester no longer has access to this project.", data: { reason: failure } })]);
              return { next };
            }
            if (refused.owner) markUncertain(next, slice, refused.owner.attempt);
            delete next.pending[slice];
            if (refused.blockId) { const block = next.blocks[refused.blockId]; if (block && block.status !== "saved") { block.status = "blocked"; block.blocker = blockerCode; } }
            settleBlocker(next, refused.kind === "block" ? undefined : blockerCode!); const woken = this.wakeAllowanceWaiters(next, now, false); // [PR-J, 2026-11-04] J7-2: no owner left - nothing holds what a waiter waits for
            const state = deriveGenerationTaskState(next, nowMs);
            if (!state) return refuse("GENERATION_SLICE_END_INVALID", "a refused slice left nothing to do");
            if (state === "waiting-for-resource" && current.state !== "waiting-for-resource") this.milestones(next, [generationTaskEvent("waiting_resource", { at: now, blockId: next.blocker?.blockId ?? null, message: next.blocker!.message, data: { code: next.blocker!.code } })]);
            next.state = state;
            return { next, ...woken };
          },
        });
        await this.finish(event, workerId, {});
        return { outcome: failure ? "failed" : "blocked", eventId: event.eventId, taskId: id, code: failure ?? blockerCode ?? (outcome.ok ? undefined : outcome.code) };
      }
      const claimed = await this.commitHead({
        scope: event.scope, taskId: id, key: `${slice}:a${attempt}:claim`, actor: "worker", retries: 0,
        mutate: (current) => {
          const next = clone(current), pendingEntry = next.pending[slice];
          if (!pendingEntry) return refuse("GENERATION_SLICE_FENCED", "the slice is no longer pending");
          if (pendingEntry.owner) markUncertain(next, slice, pendingEntry.owner.attempt); // the lapsed owner's attempt: completion unknown
          if (generationAllowanceRefusal(next, reservation, nowMs)) return refuse("GENERATION_TASK_CONTENDED", "a sibling claim used the allowance first"); // repeat steps 2-4
          next.fenceCounter += 1;
          next.pending[slice] = { ...pendingEntry, state: "running", owner: { attempt, fence: next.fenceCounter, workerId, leaseToken, claimedAt: now } } satisfies GenerationPendingSlice;
          if (reservation.modelCalls > 0 || reservation.outputTokens > 0) next.reservations.push({ sliceId: slice, attempt, ...reservation, state: "held", at: now } satisfies GenerationReservation);
          foldReservations(next);
          next.usage.attempts += 1;
          next.phase = phaseOf(pendingEntry.kind);
          next.updatedAt = now;
          const drafts = [generationTaskEvent("worker_claimed", { at: now, phase: next.phase, blockId: pendingEntry.blockId, message: `A generation worker started the ${pendingEntry.kind} slice (attempt ${attempt}).`, data: { sliceKind: pendingEntry.kind, attempt } })];
          if (pendingEntry.kind === "block" && pendingEntry.blockId) {
            const block = next.blocks[pendingEntry.blockId]!;
            block.status = "designing";
            drafts.push(generationTaskEvent("block_started", { at: now, phase: "designing", blockId: block.blockId, message: `Designing block "${block.name}".`, data: { strategy: block.strategy, turnsUsed: block.turnsUsed } }));
          }
          this.milestones(next, drafts);
          next.state = "running";
          return { next, attest: { leaseToken, membershipLive: true } };
        },
      });
      if (!claimed.ok && claimed.code === "GENERATION_TASK_CONTENDED") continue; // a concurrent commit moved the head: repeat steps 2-4
      if (!claimed.ok) { await this.finish(event, workerId, {}); return { outcome: "stale-event", eventId: event.eventId, taskId: id, code: claimed.code }; }
      const owner = claimed.task.pending[slice]!.owner!;
      return { outcome: "claimed", task: claimed.task, lease: { scope: canonicalDurableScope(event.scope), taskId: id, sliceId: slice, kind: entry.kind, blockId: entry.blockId, attempt, fence: owner.fence, workerId, leaseToken, eventId: event.eventId, leaseExpiresAt: event.leaseExpiresAt! } };
    }
    return { outcome: "stale-event", eventId: event.eventId, taskId: id, code: "GENERATION_TASK_CONTENDED" };
  }

  /** S2: extend this slice's outbox lease; a lapsed or re-claimed lease answers LEASE_LOST and the slice must stop. */
  async renewSlice(lease: GenerationSliceLease): Promise<{ ok: true; leaseExpiresAt: string } | { ok: false; code: "GENERATION_SLICE_LEASE_LOST" }> {
    const nowMs = this.clock(), leaseUntil = isoOf(nowMs + this.leaseMs);
    try {
      await this.repository.renewOutboxLease({ scope: lease.scope, eventId: lease.eventId, workerId: lease.workerId, leaseToken: lease.leaseToken, now: isoOf(nowMs), leaseUntil });
      lease.leaseExpiresAt = leaseUntil;
      return { ok: true, leaseExpiresAt: leaseUntil };
    } catch (error) {
      if (error instanceof Error && error.message === "DW_OUTBOX_LEASE_LOST") return { ok: false, code: "GENERATION_SLICE_LEASE_LOST" };
      throw error;
    }
  }

  /** The control poll: is this slice still the owner, and has the user asked to stop or pause? */
  async pollControl(lease: GenerationSliceLease): Promise<{ fenced: boolean; cancel: boolean; pause: boolean }> {
    const read = await this.readHead(lease.scope, lease.taskId);
    if (read.kind !== "ok") return { fenced: true, cancel: false, pause: false };
    const owner = read.head.pending[lease.sliceId]?.owner;
    return { fenced: !owner || owner.fence !== lease.fence || owner.leaseToken !== lease.leaseToken, cancel: read.head.control.cancel !== null, pause: read.head.control.pause !== null };
  }

  private applyDelta(next: GenerationTaskHead, lease: GenerationSliceLease, delta: GenerationSliceDelta, artifact: { recordId: string; recordDigest: string } | null): Refusal | null {
    if (delta.block || artifact) {
      if (!lease.blockId) return refuse("GENERATION_TASK_STATE_CONFLICT", "only a block slice patches a block");
      const block = next.blocks[lease.blockId];
      if (!block) return refuse("GENERATION_TASK_STATE_CONFLICT", "the slice's block is not planned");
      const patch = delta.block ?? {};
      if (patch.status !== undefined) block.status = patch.status;
      if (patch.strategy !== undefined) block.strategy = patch.strategy;
      if (patch.strategyHistory !== undefined) block.strategyHistory = clone(patch.strategyHistory);
      if (patch.turnsUsed !== undefined) block.turnsUsed = patch.turnsUsed;
      if (patch.stagnantSlices !== undefined) block.stagnantSlices = patch.stagnantSlices;
      if (patch.lastProgressKey !== undefined) block.lastProgressKey = patch.lastProgressKey;
      if (patch.blocker !== undefined) block.blocker = patch.blocker;
      if (patch.missing !== undefined) { const missing = boundedMissing(patch.missing); if (missing.length) block.missing = missing; else delete block.missing; } // [PR-L6, 2026-10-19]
      if (artifact) block.artifactRef = { ...artifact };
    }
    addUsage(next.usage, delta.usage);
    if (delta.milestones?.length) this.milestones(next, delta.milestones);
    return null;
  }
  private async checkpointRef(lease: GenerationSliceLease, checkpoint: BuildLoopCheckpoint | undefined, key: string): Promise<{ recordId: string; recordDigest: string } | null> {
    if (!checkpoint) return null;
    const valid = assertBuildLoopCheckpoint(checkpoint);
    if (valid.taskId !== lease.taskId || valid.blockId !== lease.blockId || valid.sliceId !== lease.sliceId || valid.attempt !== lease.attempt || valid.fence !== lease.fence) {
      throw new GenerationTaskContractError("GENERATION_TASK_CHECKPOINT_INVALID", "checkpoint: written by this slice attempt for its own block");
    }
    return this.commitArtifact(lease.scope, GENERATION_TASK_AGGREGATES.block, generationBlockAggregateKey(lease.taskId, lease.blockId!), valid, key);
  }
  /** Fenced pre-check: a slice that already lost its ownership writes nothing at all. */
  private async stillOwner(lease: GenerationSliceLease, allowCancel = false): Promise<Refusal | null> {
    const control = await this.pollControl(lease);
    if (control.fenced) return refuse("GENERATION_SLICE_FENCED");
    if (control.cancel && !allowCancel) return refuse("GENERATION_TASK_CANCEL_REQUESTED");
    return null;
  }

  /** A mid-slice checkpoint at a complete turn boundary: the block revision, then the fenced head commit that references it. */
  async checkpointSlice(lease: GenerationSliceLease, seq: number, delta: GenerationSliceDelta): Promise<GenerationCommitOutcome> {
    const prefix = `${lease.sliceId}:a${lease.attempt}`;
    const replayed = await this.replayOf(lease.scope, lease.taskId, `${prefix}:ckpt:${seq}`);
    if (replayed) return replayed;
    const early = await this.stillOwner(lease);
    if (early) return early;
    const artifact = await this.checkpointRef(lease, delta.checkpoint, `${prefix}:block:${seq}`);
    return this.commitHead({
      scope: lease.scope, taskId: lease.taskId, key: `${prefix}:ckpt:${seq}`, actor: "worker", fence: lease,
      mutate: async (current) => {
        const next = clone(current);
        next.updatedAt = this.nowIso();
        const refusal = this.applyDelta(next, lease, delta, artifact);
        if (refusal) return refusal;
        consumeReservation(next, lease.sliceId, lease.attempt, delta.usage); const own = next.pending[lease.sliceId]; if (own?.wait && delta.checkpoint) delete own.wait; // [PR-J, 2026-11-04] J7-2: a committed turn is progress - its allowance-wait count ends
        setInFlightInput(next, lease.sliceId, lease.attempt, delta.inFlightInput); // [PR-L6, 2026-10-19]
        const extraOperations = delta.facts ? [await this.factsOperation(lease.scope, current, next, delta.facts)] : [];
        return { next, extraOperations };
      },
    });
  }

  /** [PR-L6, 2026-10-19] Pre-call input admission, made durable (OD-253 item 6): BEFORE a call is sent, its input bound is recorded on the
   *  attempt's held reservation by a fenced head commit, so a process that dies inside the call leaves it charged (the next claimer marks
   *  the reservation uncertain, and every admission after it counts it). A fenced or cancelled slice writes nothing and must not send. */
  async admitCall(lease: GenerationSliceLease, seq: number, bound: number): Promise<GenerationCommitOutcome> {
    if (!Number.isSafeInteger(bound) || bound < 0) return refuse("GENERATION_SLICE_END_INVALID", "admit: an input bound is a nonnegative integer");
    return this.commitHead({
      scope: lease.scope, taskId: lease.taskId, key: `${lease.sliceId}:a${lease.attempt}:admit:${seq}`, actor: "worker", fence: lease,
      mutate: async (current) => {
        const next = clone(current);
        if (!next.reservations.some((entry) => entry.sliceId === lease.sliceId && entry.attempt === lease.attempt && entry.state === "held")) return refuse("GENERATION_SLICE_END_INVALID", "admit: the attempt holds no reservation");
        setInFlightInput(next, lease.sliceId, lease.attempt, bound);
        const limit = generationAllowanceLimits(next.allowance).inputTokens; if (limit !== undefined && generationCommitted(next).inputTokens > limit) return (await this.inputContended(lease, next)) ? refuse("GENERATION_INPUT_ALLOWANCE_CONTENDED", "admit: only live siblings' in-flight input bounds fill the task's input limit; not sent (the block is re-queued)") : refuse("GENERATION_INPUT_ALLOWANCE_EXHAUSTED", "admit: settled + uncertain + every in-flight input bound would exceed the task's input limit; not sent"); // [PR-L6 integration, 2026-10-19] F2: the TASK's input, shared by every slice and worker (the fenced head commit serializes them); [PR-J, 2026-11-04] J7-2: CONTENDED when only live siblings' bounds stop it
        next.updatedAt = this.nowIso(); return { next };
      },
    });
  }

  /** The slice's end: its checkpoint and result first (by reference), then ONE fenced head commit that removes its pending entry,
   *  settles its reservation, applies its delta and schedules the next slices as outbox effects of the same commit. */
  async endSlice(lease: GenerationSliceLease, end: GenerationSliceEnd): Promise<GenerationCommitOutcome> {
    const prefix = `${lease.sliceId}:a${lease.attempt}`;
    const replayed = await this.replayOf(lease.scope, lease.taskId, `${prefix}:end`);
    if (replayed) { await this.finish({ scope: lease.scope, eventId: lease.eventId, leaseToken: lease.leaseToken } as DurableOutboxEvent, lease.workerId, {}); return replayed; }
    const early = await this.stillOwner(lease);
    if (early) return early;
    if (end.plan && lease.kind !== "plan") return refuse("GENERATION_SLICE_END_INVALID", "only the plan slice delivers a plan");
    if (end.result && lease.kind !== "merge") return refuse("GENERATION_SLICE_END_INVALID", "only the merge slice delivers a result");
    const artifact = await this.checkpointRef(lease, end.checkpoint, `${prefix}:block:end`);
    let resultRef: { recordId: string; recordDigest: string } | null = null;
    if (end.result) {
      const issue = generationTaskResultIssue(end.result);
      if (issue || end.result.taskId !== lease.taskId) return refuse("GENERATION_SLICE_END_INVALID", issue ?? "result: of this task");
      resultRef = await this.commitArtifact(lease.scope, GENERATION_TASK_AGGREGATES.result, lease.taskId, end.result, `${prefix}:result`);
    }
    const outcome = await this.commitHead({
      scope: lease.scope, taskId: lease.taskId, key: `${prefix}:end`, actor: "worker", fence: lease,
      mutate: async (current) => {
        const now = this.nowIso(), nowMs = Date.parse(now), next = clone(current);
        next.updatedAt = now;
        delete next.pending[lease.sliceId];
        settleReservation(next, lease.sliceId, lease.attempt);
        next.usage.slices += 1;
        if (end.plan) {
          if (current.plan) return refuse("GENERATION_SLICE_END_INVALID", "the plan is already set");
          const planned = end.plan.planner.state === "planned";
          if (end.plan.blocks.length < 1 || end.plan.blocks.length > GENERATION_TASK_BOUNDS.blocks || (!planned && end.plan.blocks.length !== 1)) return refuse("GENERATION_SLICE_END_INVALID", "plan: 1..8 planned blocks, or exactly the main block");
          const blocks = end.plan.blocks.map((block, index) => ({ blockId: (planned ? `b${index + 1}` : "main") as GenerationBlockId, name: cleanLine(block.name, GENERATION_TASK_BOUNDS.blockNameChars) || `Block ${index + 1}`, brief: cleanLine(block.brief, GENERATION_TASK_BOUNDS.blockBriefChars), sharedNets: block.sharedNets.slice(0, GENERATION_TASK_BOUNDS.sharedNets).map((net) => cleanLine(net, GENERATION_TASK_BOUNDS.netNameChars)).filter(Boolean) }));
          const coverage = (end.plan.coverage ?? []).slice(0, GENERATION_TASK_BOUNDS.coverage).map((text) => cleanLine(text, GENERATION_TASK_BOUNDS.coverageChars)).filter(Boolean); // [PR-L6, 2026-10-19] OD-253 item 3: stored only when the planner listed any
          const body = { planner: clone(end.plan.planner), rationale: cleanLine(end.plan.rationale, GENERATION_TASK_BOUNDS.rationaleChars), assumptions: end.plan.assumptions.slice(0, GENERATION_TASK_BOUNDS.assumptions).map((text) => cleanLine(text, GENERATION_TASK_BOUNDS.assumptionChars)).filter(Boolean), ...(coverage.length ? { coverage } : {}), blocks };
          next.plan = { planDigest: generationPlanDigest(body), ...body };
          for (const block of blocks) next.blocks[block.blockId] = newBlockState(block.blockId, block.name, block.brief, [...block.sharedNets]);
        }
        const refusal = this.applyDelta(next, lease, end, artifact);
        if (refusal) return refusal;
        if (end.result && resultRef) {
          next.result = { ...resultRef, resultDigest: end.result.resultDigest, status: end.result.status, omittedBlocks: [...end.result.omittedBlocks] };
          next.phase = "review";
        }
        const extraOperations = end.facts ? [await this.factsOperation(lease.scope, current, next, end.facts)] : [];
        const work = this.allowanceWaitWork(current, next, lease, end.schedule === "next-work" ? nextGenerationWork(next) : end.schedule ?? [], now); if ("ok" in work) return work; // [PR-J, 2026-11-04] J7-2: an allowance wait becomes the store's bounded re-queue (or a park at the bound)
        const scheduledWork = next.control.pause || next.control.cancel ? { outbox: [], scheduled: [] } : this.withWoken(next, this.schedule(next, work, now), now, !work.some((entry) => entry.wait)); // [PR-J, 2026-11-04] J7-2: a real end wakes the allowance waiters
        settleBlocker(next, end.blocker);
        const state = deriveGenerationTaskState(next, nowMs);
        if (!state) return refuse("GENERATION_SLICE_END_INVALID", "an end must schedule work, deliver a result or name a blocker");
        const drafts: GenerationTaskEventDraft[] = [];
        if (state === "waiting-for-resource" && current.state !== "waiting-for-resource") drafts.push(generationTaskEvent("waiting_resource", { at: now, blockId: next.blocker?.blockId ?? null, message: next.blocker!.message, data: { code: next.blocker!.code } }));
        if (state === "waiting-for-provider" && current.state !== "waiting-for-provider") { const retryAt = Object.values(next.pending).map((entry) => entry.notBefore).sort()[0]!; drafts.push(generationTaskEvent("waiting_provider", { at: now, message: "The model provider asked to wait; the design continues automatically.", data: { reason: end.waitingReason ?? "overloaded", retryAt } })); }
        if (state === "paused" && current.state !== "paused") drafts.push(generationTaskEvent("paused", { at: now, phase: next.phase, message: "The design is paused; saved work is kept." }));
        if (drafts.length) this.milestones(next, drafts);
        next.state = state;
        return { next, outbox: scheduledWork.outbox, scheduled: scheduledWork.scheduled, extraOperations, attest: { scheduled: scheduledWork.scheduled, ...(end.waitingReason ? { waitingReason: end.waitingReason } : {}), resultVerified: Boolean(end.result && resultRef) } };
      },
    });
    if (outcome.ok) await this.finish({ scope: lease.scope, eventId: lease.eventId, leaseToken: lease.leaseToken } as DurableOutboxEvent, lease.workerId, {});
    return outcome;
  }

  /** The owner's answer to a cancel: its pending entry removed (usage it reports settles its reservation; otherwise the reservation
   *  stays uncertain), and the task settles to `cancelled` once no live owner remains. Late results after this are fenced. */
  async settleCancel(lease: GenerationSliceLease, usage?: Partial<GenerationTaskUsage>): Promise<GenerationCommitOutcome> {
    const outcome = await this.commitHead({
      scope: lease.scope, taskId: lease.taskId, key: `${lease.sliceId}:a${lease.attempt}:cancel`, actor: "worker", fence: { ...lease, allowCancel: true },
      mutate: async (current) => {
        if (!current.control.cancel) return refuse("GENERATION_TASK_STATE_CONFLICT", "settle-cancel: no cancel was requested");
        const now = this.nowIso(), nowMs = Date.parse(now), next = clone(current);
        next.updatedAt = now;
        delete next.pending[lease.sliceId];
        if (usage) { addUsage(next.usage, usage); settleReservation(next, lease.sliceId, lease.attempt); } else markUncertain(next, lease.sliceId, lease.attempt);
        const live = await this.liveOwners(lease.scope, next, nowMs);
        const settled = live.size === 0;
        if (settled) { this.dropUnlive(next, live); next.phase = null; next.state = "cancelled"; this.milestones(next, [generationTaskEvent("cancelled", { at: now, message: "The design was stopped; saved blocks stay readable." })]); }
        return { next, attest: { noLiveLease: settled } };
      },
    });
    if (outcome.ok) await this.finish({ scope: lease.scope, eventId: lease.eventId, leaseToken: lease.leaseToken } as DurableOutboxEvent, lease.workerId, {});
    return outcome;
  }

  /** Hand the slice back for IMMEDIATE takeover (worker shutdown after its grace, section 4): its owner cleared, its reservation
   *  uncertain, the event pending again now. Under a pause the slice is dropped (a resume reschedules the work); under a cancel the
   *  slice settles the cancel instead. A delayed continuation is an end with a scheduled `notBefore`, never a release. */
  async releaseSlice(lease: GenerationSliceLease): Promise<GenerationCommitOutcome> {
    const retryAt = this.nowIso();
    const outcome = await this.commitHead({
      scope: lease.scope, taskId: lease.taskId, key: `${lease.sliceId}:a${lease.attempt}:release`, actor: "worker", fence: lease,
      mutate: (current) => {
        const now = this.nowIso(), nowMs = Date.parse(now), next = clone(current), entry = next.pending[lease.sliceId]!;
        next.updatedAt = now;
        markUncertain(next, lease.sliceId, lease.attempt);
        if (next.control.pause) delete next.pending[lease.sliceId];
        else next.pending[lease.sliceId] = { ...entry, state: "queued", owner: null, notBefore: now };
        settleBlocker(next, undefined);
        const state = deriveGenerationTaskState(next, nowMs);
        if (!state) return refuse("GENERATION_SLICE_END_INVALID", "a released slice left nothing to do");
        if (state === "paused" && current.state !== "paused") this.milestones(next, [generationTaskEvent("paused", { at: now, phase: next.phase, message: "The design is paused; saved work is kept." })]);
        next.state = state;
        return { next };
      },
    });
    if (!outcome.ok && outcome.code === "GENERATION_TASK_CANCEL_REQUESTED") return this.settleCancel(lease);
    try { await this.repository.failOutbox({ scope: lease.scope, eventId: lease.eventId, workerId: lease.workerId, leaseToken: lease.leaseToken, errorCode: "GENERATION_SLICE_RELEASED", failedAt: this.nowIso(), retryAt, terminal: false }); }
    catch (error) { if (!(error instanceof Error && error.message === "DW_OUTBOX_LEASE_CONFLICT")) throw error; }
    return outcome;
  }

  // ── live activity (display only; written by the owning attempt, at most once per interval) ──

  async writeActivity(lease: GenerationSliceLease, text: string): Promise<{ written: boolean }> {
    const control = await this.pollControl(lease);
    if (control.fenced) return { written: false };
    const scope = canonicalDurableScope(lease.scope), key = generationActivityAggregateKey(lease.sliceId, lease.attempt);
    const current = await this.repository.loadHead<GenerationTaskActivity>(durableAggregateIdentity(scope, GENERATION_TASK_AGGREGATES.activity, key));
    const nowMs = this.clock();
    if (current && nowMs - Date.parse(current.payload.updatedAt) < GENERATION_SLICE_POLICY.activityMinIntervalMs) return { written: false };
    const next = appendGenerationTaskActivity(current && !generationTaskActivityIssue(current.payload) ? current.payload : null, { taskId: lease.taskId, sliceId: lease.sliceId, attempt: lease.attempt, at: isoOf(nowMs), text });
    try {
      await this.commitOnce({ scope, scopeKey: this.scopeKey(scope), idempotencyKey: `${lease.sliceId}:a${lease.attempt}:activity:${(current?.revision ?? 0) + 1}`, operations: [{ aggregateType: GENERATION_TASK_AGGREGATES.activity, aggregateKey: key, expectedRevision: current?.revision ?? 0, payload: next }], outbox: [], result: {}, committedAt: isoOf(nowMs) });
      return { written: true };
    } catch (error) {
      if (isCasConflict(error)) return { written: false };
      throw error;
    }
  }
  /** The live activity of the task's current owners (display data; never authority). */
  async readActivity(scope: DurableWorkflowScope, task: GenerationTaskHead): Promise<GenerationTaskActivity[]> {
    const canonical = canonicalDurableScope(scope), out: GenerationTaskActivity[] = [];
    for (const [id, entry] of Object.entries(task.pending)) {
      if (!entry.owner) continue;
      const record = await this.repository.loadHead<GenerationTaskActivity>(durableAggregateIdentity(canonical, GENERATION_TASK_AGGREGATES.activity, generationActivityAggregateKey(id, entry.owner.attempt)));
      if (record && durableWorkflowDigest(record.payload) === record.recordDigest && !generationTaskActivityIssue(record.payload) && record.payload.taskId === task.taskId) out.push(record.payload);
    }
    return out;
  }

  // ── [PR-J, 2026-11-04] Runbook J.7, increment J7-2: allowance contention (multi-sheet/workload-limits.md). Appended at the class's end, so
  //    no cited line moves (the B24 trust-boundary map pins this file's lines). ──

  /** A claim the allowance refused although ONLY live siblings' held reservations fill it (spent + uncertain + every other reservation +
   *  this slice's own need fit): the slice is re-queued under a fresh id after `generationAllowanceWaitMs(requeues)` - nothing is reserved
   *  while it waits - and its event completes; a sibling's real end wakes it at once (`withWoken`). The caller revalidated authority and
   *  the provider first, and the re-queue commit judges the contention again on the head it lands on. Null: a genuine exhaustion, or the
   *  bound of consecutive re-queues with no sibling end - the caller parks it `allowance_exhausted` exactly as before. "retry": the head
   *  moved (the claim is judged again from the top: membership, cancel, allowance). */
  private async waitForAllowance(event: DurableOutboxEvent, workerId: string, head: GenerationTaskHead, slice: string, entry: GenerationPendingSlice, reservation: { modelCalls: number; outputTokens: number }, nowMs: number): Promise<GenerationClaimOutcome | "retry" | null> {
    const live = await this.liveOwners(event.scope, head, nowMs);
    if (!generationAllowanceContended(head, reservation, nowMs, generationLiveHolders(head, live, slice))) return null;
    const requeues = (entry.wait?.requeues ?? 0) + 1;
    if (requeues > GENERATION_ALLOWANCE_WAIT.maxRequeues) return null;
    const now = isoOf(nowMs), notBefore = isoOf(nowMs + generationAllowanceWaitMs(requeues));
    const outcome = await this.commitHead({
      scope: event.scope, taskId: head.taskId, key: `${slice}:a${event.attempts}:wait`, actor: "worker",
      mutate: (current) => {
        const next = clone(current), waiting = next.pending[slice];
        if (!waiting || waiting.owner || current.control.cancel || current.control.pause || current.failure) return refuse("GENERATION_TASK_CONTENDED", "the slice or the task moved on: the claim is judged again");
        if (!generationAllowanceContended(next, reservation, nowMs, generationLiveHolders(next, live, slice))) return refuse("GENERATION_TASK_CONTENDED", "the held reservations changed: the claim is judged again");
        delete next.pending[slice];
        return { next, ...this.schedule(next, [{ kind: waiting.kind, blockId: waiting.blockId, notBefore, wait: { reason: "allowance", requeues } }], now) };
      },
    });
    if (!outcome.ok) return outcome.code === "GENERATION_TASK_CONTENDED" ? "retry" : null;
    await this.finish(event, workerId, {});
    return { outcome: "requeued", eventId: event.eventId, taskId: head.taskId, code: "GENERATION_ALLOWANCE_CONTENDED" };
  }

  /** Wake the allowance waiters at once (fresh ids, due now, their count reset): on a sibling's real end (`force`: its reservation was
   *  settled), or whenever no owner remains (nothing holds what they wait for, and a delayed retry would read as the provider's wait). Their
   *  old events find no pending entry and complete as stale. Nothing under a pause, a cancel or a failure (those drop pending work). */
  private wakeAllowanceWaiters(next: GenerationTaskHead, nowIso: string, force: boolean): { outbox: DurableOutboxEffect[]; scheduled: string[] } {
    if (next.control.pause || next.control.cancel || next.failure || (!force && hasGenerationOwner(next))) return { outbox: [], scheduled: [] };
    const nowMs = Date.parse(nowIso);
    const waiting = Object.entries(next.pending).filter(([, entry]) => entry.owner === null && entry.wait !== undefined && Date.parse(entry.notBefore) > nowMs);
    if (!waiting.length) return { outbox: [], scheduled: [] };
    for (const [id] of waiting) delete next.pending[id];
    return this.schedule(next, waiting.map(([, entry]) => ({ kind: entry.kind, blockId: entry.blockId })), nowIso);
  }
  private withWoken(next: GenerationTaskHead, work: { outbox: DurableOutboxEffect[]; scheduled: string[] }, nowIso: string, force: boolean): { outbox: DurableOutboxEffect[]; scheduled: string[] } {
    const woken = this.wakeAllowanceWaiters(next, nowIso, force);
    return { outbox: [...work.outbox, ...woken.outbox], scheduled: [...work.scheduled, ...woken.scheduled] };
  }

  /** An end's allowance wait (the pre-call input admission found only live siblings' in-flight input in the way, `GENERATION_INPUT_ALLOWANCE_
   *  CONTENDED`): the slice's own block again under a fresh id, after the bounded wait - at once when no owner remains - with its consecutive
   *  count; past the bound the block parks `allowance_exhausted` instead. Every other entry passes unchanged. */
  private allowanceWaitWork(current: GenerationTaskHead, next: GenerationTaskHead, lease: GenerationSliceLease, work: ReadonlyArray<{ kind: GenerationSliceKind; blockId: GenerationBlockId | null; notBefore?: string; wait?: GenerationQueueWaitReason }>, nowIso: string): Array<{ kind: GenerationSliceKind; blockId: GenerationBlockId | null; notBefore?: string; wait?: GenerationPendingWait }> | Refusal {
    const out: Array<{ kind: GenerationSliceKind; blockId: GenerationBlockId | null; notBefore?: string; wait?: GenerationPendingWait }> = [];
    for (const entry of work) {
      if (entry.wait === undefined) { out.push({ kind: entry.kind, blockId: entry.blockId, ...(entry.notBefore !== undefined ? { notBefore: entry.notBefore } : {}) }); continue; }
      if (entry.wait !== "allowance" || lease.kind !== "block" || entry.kind !== "block" || entry.blockId === null || entry.blockId !== lease.blockId) return refuse("GENERATION_SLICE_END_INVALID", "an allowance wait re-queues the slice's own block only");
      const requeues = (current.pending[lease.sliceId]?.wait?.requeues ?? 0) + 1;
      if (requeues > GENERATION_ALLOWANCE_WAIT.maxRequeues) { const block = next.blocks[entry.blockId]; if (block && block.status !== "saved") { block.status = "blocked"; block.blocker = "allowance_exhausted"; } continue; }
      out.push({ kind: "block", blockId: entry.blockId, notBefore: hasGenerationOwner(next) ? isoOf(Date.parse(nowIso) + generationAllowanceWaitMs(requeues)) : nowIso, wait: { reason: "allowance", requeues } });
    }
    return out;
  }

  /** Whether only live siblings' in-flight input fills the task's input limit for this admission (`generationInputContended`). */
  private async inputContended(lease: GenerationSliceLease, next: GenerationTaskHead): Promise<boolean> {
    const live = await this.liveOwners(lease.scope, next, this.clock());
    return generationInputContended(next, generationLiveHolders(next, live, lease.sliceId));
  }
}
