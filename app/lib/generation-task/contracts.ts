/**
 * [PR-L, 2026-10-17] Runbook L.2, increment 2: the durable generation task's documents (task-worker-contract.md sections 1-3).
 *
 * A generation task is a LOGICAL task that outlives any provider turn, worker attempt or HTTP request. Its state lives on the
 * existing durable-workflow substrate (no schema change) as six aggregates per scope:
 *
 *  - the HEAD `schematic.generation-task.v1` (`sirkit.generation-task.v1`, at most 64 KB): identity, immutable request, base pin,
 *    plan, per-block status, pending slices with their fenced owners, cumulative usage/reservations/allowance, control intent,
 *    blocker, result reference, ordered public milestones;
 *  - the per-scope INDEX `schematic.generation-task-index.v1` (one active non-terminal task per project branch, by CAS);
 *  - BLOCK checkpoints, FACTS and the RESULT, each content read ONLY through the `{recordId, recordDigest}` the head references,
 *    so a fenced-out late writer can append a revision but never become referenced content;
 *  - ACTIVITY lines (display only).
 *
 * Every document is judged with closed key sets at every level, bounded and redacted text, recomputed digests and a size bound
 * (`GENERATION_TASK_TOO_LARGE`, never a silent cut). States, transitions and the evidence each transition requires are data
 * (`GENERATION_TASK_TRANSITIONS`) and checked on every commit (`generationTaskTransitionIssue`).
 *
 * Corrections to the contract, each forced by its own text or the source (recorded in the increment's report):
 *  - the head gains `facts: {recordId, recordDigest, revision} | null` (section 1.1 reads facts only by a head reference, but the
 *    section 1.2 head had no field for it) and `failure: {reason, at} | null` (a `failed` state must carry its closed reason);
 *  - `usage` gains `uncertainModelCalls` / `uncertainOutputTokens`: an uncertain reservation folded out of the 12-entry list stays
 *    charged at its worst case instead of being dropped;
 *  - `waiting-for-resource` is also entered from `queued` / `waiting-for-provider` by the claimer (section 3.2 steps 2-3 commit
 *    `platform_failure`, allowance or provider refusals at claim time, before the task is running);
 *  - `paused` is entered from the work-bearing states only (queued, running, waiting-for-provider, waiting-for-resource): pausing
 *    `awaiting-review` has no work to pause and resuming it would discard its result; a `cancel-requested` task stays cancelling.
 */
import { durableWorkflowDigest, durableWorkflowId } from "../durable-workflow/stable";
import { LLM_PROVIDER_IDS, type LLMProviderId } from "../llm/types";
import type { ProjectRole } from "../engineering/types";
import { validateSchematicCanonicalMark, type SchematicCanonicalMark } from "../engineering/schematic-projection";
import { BUILD_BUDGET, resolveBuildIterationCap, type BuildPlannerStatus, type ElectricalCheckStatus } from "../schematic/build-result";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";
import { compareCodePoints } from "../stable-compare";
import { electricalCheckJudge, netlistJudge, normalizeElectricalCheck, normalizeNetlist, normalizePartFacts, partFactsDigest, partFactsJudge, type GenerationPartFacts } from "./checkpoint";
import { generationTaskMilestonesIssue, type GenerationTaskEvent } from "./events";
import {
  CLIENT_REQUEST_ID, ENGINEERING_DIGEST, GENERATION_BASE_RECIPES, GENERATION_BLOCKER_CODES, GENERATION_BLOCK_STATUSES, GENERATION_CATALOG_PROFILES, GENERATION_CONTROL_ACTIONS, GENERATION_FAILURE_REASONS,
  GENERATION_REVIEW_OUTCOMES, GENERATION_SLICE_KINDS, GENERATION_STRATEGIES, GENERATION_STRATEGY_OUTCOMES, GENERATION_TASK_ORIGINS, GENERATION_TASK_PHASES, GENERATION_TASK_STATES, GENERATION_WAITING_REASONS, LEASE_TOKEN,
  GenerationTaskContractError, arrayOf, blockId, bool, canonicalBytes, cleanLine, cleanModelText, count, durableDigest, identifier, isPlainRecord, isTerminalGenerationTaskState, isoInstant, line, modelText, nullable,
  oneOf, pattern, recordId, recordOf, shape, sliceId, taskId,
  type GenerationBaseRecipe, type GenerationBlockId, type GenerationBlockStatus, type GenerationBlockerCode, type GenerationCatalogProfile, type GenerationControlAction, type GenerationFailureReason,
  type GenerationReviewOutcome, type GenerationSliceKind, type GenerationStrategyId, type GenerationStrategyOutcome, type GenerationTaskOrigin, type GenerationTaskPhase, type GenerationTaskState,
  type GenerationWaitingReason, type Issue, type Judge,
} from "./vocabulary";

// ─── Identities ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const GENERATION_TASK_SCHEMA = "sirkit.generation-task.v1" as const;
export const GENERATION_TASK_INDEX_SCHEMA = "sirkit.generation-task-index.v1" as const;
export const GENERATION_TASK_FACTS_SCHEMA = "sirkit.generation-task-facts.v1" as const;
export const GENERATION_TASK_RESULT_SCHEMA = "sirkit.generation-task-result.v1" as const;
export const GENERATION_SLICE_CONTRACT = "sirkit.generation-slice.v1" as const;
export const GENERATION_TASK_AGGREGATES = Object.freeze({
  head: "schematic.generation-task.v1",
  index: "schematic.generation-task-index.v1",
  block: "schematic.generation-task-block.v1",
  facts: "schematic.generation-task-facts.v1",
  result: "schematic.generation-task-result.v1",
  activity: "schematic.generation-task-activity.v1",
} as const);
/** The index is one aggregate per scope (tenant, project, branch). */
export const GENERATION_TASK_INDEX_KEY = "project" as const;
/** The outbox topic, event type and version of one scheduled slice. Never dispatched by the generic effect pump (S3, increment 3). */
export const GENERATION_SLICE_TOPIC = "generation-task.slice" as const;
export const GENERATION_SLICE_EVENT = Object.freeze({ eventType: "generation-task.slice", eventVersion: 1 } as const);
/** Replay partitions: every task commit, and the start commit (section 6.1). */
export const GENERATION_TASK_SCOPE_SUFFIX = "generation-task" as const;
export const GENERATION_TASK_START_SCOPE_SUFFIX = "generation-task-start" as const;

export interface GenerationTaskScope { tenantId: string; projectId: string; branchId: string }

/** `generation-task:<32 hex>` from (scope, initiating principal, client request id): a lost 202 is recovered by retrying the SAME
 *  client request id; a new user request carries a new one. Not authority: every load is scoped by the trusted context. */
export function generationTaskId(scope: GenerationTaskScope, principalId: string, clientRequestId: string): string {
  return durableWorkflowId("generation-task", { scope: { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId }, principalId, clientRequestId });
}
export function generationSliceId(taskIdValue: string, seq: number): string { return `${taskIdValue}:s${seq}`; }
export function generationSliceSeq(sliceIdValue: string): number { return Number(sliceIdValue.slice(sliceIdValue.lastIndexOf(":s") + 2)); }
export function generationBlockAggregateKey(taskIdValue: string, block: GenerationBlockId): string { return `${taskIdValue}/${block}`; }
export function generationActivityAggregateKey(sliceIdValue: string, attempt: number): string { return `${sliceIdValue}/a${attempt}`; }

// ─── Bounds, slice policy and allowance ────────────────────────────────────────────────────────────────────────────────────

export const GENERATION_TASK_BOUNDS = Object.freeze({
  headBytes: 64 * 1024,
  indexBytes: 16 * 1024,
  factsBytes: 512 * 1024,
  resultBytes: 1024 * 1024,
  promptChars: 4_000,
  rationaleChars: 600,
  assumptions: 8,
  assumptionChars: 200,
  blocks: 8,
  blockNameChars: 120,
  blockBriefChars: 600,
  sharedNets: 16,
  netNameChars: 64,
  pending: 16,
  reservations: 12,
  controlApplied: 16,
  strategyHistory: 12,
  recentTasks: 20,
  extensions: 4,
  blockerChars: 400,
  blockerEvidenceKeys: 8,
  factsParts: 256,
  factsLookups: 512,
  queryChars: 200,
  explanationChars: 4_000,
});

/** Section 3.1: a FINITE execution-slice policy - never the total work a task may do. */
export const GENERATION_SLICE_POLICY = Object.freeze({
  leaseMs: 45_000,
  renewEveryMs: 15_000,
  planWindowMs: 90_000,
  blockWindowMs: 300_000,
  perCallMs: 120_000,
  minTurnStartMs: 60_000,
  maxBlockTurnsPerSlice: 6,
  mergeWindowMs: 30_000,
  controlPollMs: 2_000,
  activityMinIntervalMs: 3_000,
  workerPickupGraceMs: 15_000,
  maxAttemptsPerSlice: 5,
  stagnantSlicesPerStrategy: 3,
  workerConcurrency: BUILD_BUDGET.concurrencyCap,
  /** claim-commit conflicts reload and repeat at most this often (section 3.2 step 4) */
  claimRetries: 5,
  /** the rebase rule's retries (section 3.2) */
  rebaseRetries: 8,
  planOutputTokens: 4_096,
  turnOutputTokens: 8_192,
});
/** `min(6, resolveBuildIterationCap())`: the operator's iteration cap may only lower a slice's turns. */
export function generationBlockTurnsPerSlice(environment?: Record<string, string | undefined>): number {
  return Math.min(GENERATION_SLICE_POLICY.maxBlockTurnsPerSlice, resolveBuildIterationCap(environment));
}

/** Section 5's proposed per-task allowance unit (OD-252 (1)); a task may hold up to 1 + 4 explicit extensions. An operator may only
 *  LOWER the unit at creation (the judge refuses any field above this). There is no USD price table in the product (F18). */
export const GENERATION_TASK_ALLOWANCE_UNIT = Object.freeze({ modelCalls: 60, outputTokens: 480_000, catalogSearches: 300, wallClockMs: 72 * 3_600_000 });
export type GenerationAllowanceUnit = { modelCalls: number; outputTokens: number; catalogSearches: number; wallClockMs: number };

/** The roles that may start (and therefore stop) a generation: `route-policy.ts` EDITORS, the propose policy's roles. */
export const GENERATION_TASK_EDITOR_ROLES = Object.freeze(["pcb_editor", "reviewer", "project_admin", "automation"] as const satisfies readonly ProjectRole[]);
export const isGenerationEditorRole = (role: unknown): role is ProjectRole => typeof role === "string" && (GENERATION_TASK_EDITOR_ROLES as readonly string[]).includes(role);

// ─── The head ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GenerationPlanBlock { blockId: GenerationBlockId; name: string; brief: string; sharedNets: string[] }
export interface GenerationTaskPlan { planDigest: string; planner: BuildPlannerStatus; rationale: string; assumptions: string[]; blocks: GenerationPlanBlock[] }
export interface GenerationArtifactRef { recordId: string; recordDigest: string }
export interface GenerationStrategyHistoryEntry { id: GenerationStrategyId; slices: number; outcome: GenerationStrategyOutcome }
export interface GenerationBlockState {
  blockId: GenerationBlockId; name: string; brief: string; sharedNets: string[]; status: GenerationBlockStatus; strategy: GenerationStrategyId;
  strategyHistory: GenerationStrategyHistoryEntry[]; artifactRef: GenerationArtifactRef | null; turnsUsed: number; stagnantSlices: number; lastProgressKey: string | null; blocker: GenerationBlockerCode | null;
}
export interface GenerationSliceOwner { attempt: number; fence: number; workerId: string; leaseToken: string; claimedAt: string }
export interface GenerationPendingSlice { kind: GenerationSliceKind; blockId: GenerationBlockId | null; notBefore: string; state: "queued" | "running"; owner: GenerationSliceOwner | null }
export const GENERATION_USAGE_KEYS = Object.freeze(["slices", "attempts", "modelCalls", "inputTokens", "outputTokens", "catalogSearches", "cacheHits", "embeddingCalls", "rerankCalls", "rerankSkipped", "uncertainModelCalls", "uncertainOutputTokens"] as const);
export type GenerationTaskUsage = Record<(typeof GENERATION_USAGE_KEYS)[number], number>;
export interface GenerationReservation { sliceId: string; attempt: number; modelCalls: number; outputTokens: number; state: "held" | "uncertain"; at: string }
export interface GenerationTaskAllowance { unit: GenerationAllowanceUnit; units: number; extensions: Array<{ principalId: string; clientActionId: string; at: string }> }
export interface GenerationControlStamp { action: GenerationControlAction; clientActionId: string; principalId: string; at: string }
export interface GenerationTaskBlocker { code: GenerationBlockerCode; message: string; resolution: string; blockId: GenerationBlockId | null; evidence: Record<string, string | number> }
export interface GenerationTaskResultRef extends GenerationArtifactRef { resultDigest: string; status: "complete" | "partial"; omittedBlocks: string[] }
export interface GenerationTaskFactsRef extends GenerationArtifactRef { revision: number }

export interface GenerationTaskHead {
  schema: typeof GENERATION_TASK_SCHEMA;
  taskId: string;
  scope: GenerationTaskScope;
  initiator: { principalId: string; role: ProjectRole; membershipRevision: string; origin: GenerationTaskOrigin; chatRunId: string | null };
  request: { clientRequestId: string; prompt: string; provider: LLMProviderId; mode: "build"; requestDigest: string };
  base: { schematicDigest: string; recipe: GenerationBaseRecipe; headMark: SchematicCanonicalMark | null; moved: boolean };
  identities: { catalogProfile: GenerationCatalogProfile; embeddingModel: string; promptDigests: { plan: string; build: string; subsystem: string }; sliceContract: typeof GENERATION_SLICE_CONTRACT };
  state: GenerationTaskState;
  phase: GenerationTaskPhase | null;
  plan: GenerationTaskPlan | null;
  blocks: Partial<Record<GenerationBlockId, GenerationBlockState>>;
  pending: Record<string, GenerationPendingSlice>;
  nextSliceSeq: number;
  fenceCounter: number;
  usage: GenerationTaskUsage;
  reservations: GenerationReservation[];
  allowance: GenerationTaskAllowance;
  control: { cancel: GenerationControlStamp | null; pause: GenerationControlStamp | null; applied: GenerationControlStamp[] };
  blocker: GenerationTaskBlocker | null;
  result: GenerationTaskResultRef | null;
  facts: GenerationTaskFactsRef | null;
  review: { outcome: GenerationReviewOutcome; at: string; principalId: string; headMark: SchematicCanonicalMark | null } | null;
  failure: { reason: GenerationFailureReason; at: string } | null;
  derivedFrom: { taskId: string; reason: "rebase" | "start-from-saved" } | null;
  milestones: GenerationTaskEvent[];
  eventSeq: number;
  createdAt: string;
  updatedAt: string;
}

/** The immutable request identity: what the user asked, on which base, through which surface. A retry of the same client request
 *  id with a different digest is IDEMPOTENCY_KEY_REUSED, never a silent attach. */
export function generationRequestDigest(input: { prompt: string; provider: LLMProviderId; mode: "build"; origin: GenerationTaskOrigin; base: { schematicDigest: string; recipe: GenerationBaseRecipe } }): string {
  return durableWorkflowDigest({ schema: "sirkit.generation-task-request.v1", prompt: input.prompt, provider: input.provider, mode: input.mode, origin: input.origin, base: { schematicDigest: input.base.schematicDigest, recipe: input.base.recipe } });
}
export function generationPlanDigest(plan: Omit<GenerationTaskPlan, "planDigest">): string {
  return durableWorkflowDigest({ schema: "sirkit.generation-task-plan.v1", planner: plan.planner, rationale: plan.rationale, assumptions: plan.assumptions, blocks: plan.blocks });
}

// ─── Judges ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const scopeId: Judge = (value, path) => (typeof value === "string" && value.length >= 1 && value.length <= 512 && value === value.normalize("NFC").trim() && !/[\p{Cc}]/u.test(value) ? null : `${path}: a canonical scope id is required`);
const scopeShape = shape({ tenantId: scopeId, projectId: scopeId, branchId: scopeId });
const canonicalMark: Judge = (value, path) => (validateSchematicCanonicalMark(value) === null ? `${path}: a schematic canonical mark is required` : null);
const plannerJudge: Judge = (value, path) => {
  if (!isPlainRecord(value)) return `${path}: an object is required`;
  if (value.state === "planned") return shape({ state: oneOf(["planned"]), blocks: count(GENERATION_TASK_BOUNDS.blocks, 1) })(value, path);
  if (value.state === "single") return shape({ state: oneOf(["single"]), reason: oneOf(["simple_request", "no_plan"]) })(value, path);
  if (value.state === "failed_fallback") return shape({ state: oneOf(["failed_fallback"]), reason: line(200, 1) })(value, path);
  return `${path}.state: outside the closed list`;
};
const netNames = arrayOf(line(GENERATION_TASK_BOUNDS.netNameChars, 1), GENERATION_TASK_BOUNDS.sharedNets);
const planBlockShape = shape({ blockId, name: line(GENERATION_TASK_BOUNDS.blockNameChars, 1), brief: line(GENERATION_TASK_BOUNDS.blockBriefChars), sharedNets: netNames });
const planShape = shape({ planDigest: durableDigest, planner: plannerJudge, rationale: line(GENERATION_TASK_BOUNDS.rationaleChars), assumptions: arrayOf(line(GENERATION_TASK_BOUNDS.assumptionChars, 1), GENERATION_TASK_BOUNDS.assumptions), blocks: arrayOf(planBlockShape, GENERATION_TASK_BOUNDS.blocks, 1) });
const artifactRefShape = shape({ recordId, recordDigest: durableDigest });
const blockStateShape = shape({
  blockId, name: line(GENERATION_TASK_BOUNDS.blockNameChars, 1), brief: line(GENERATION_TASK_BOUNDS.blockBriefChars), sharedNets: netNames, status: oneOf(GENERATION_BLOCK_STATUSES), strategy: oneOf(GENERATION_STRATEGIES),
  strategyHistory: arrayOf(shape({ id: oneOf(GENERATION_STRATEGIES), slices: count(), outcome: oneOf(GENERATION_STRATEGY_OUTCOMES) }), GENERATION_TASK_BOUNDS.strategyHistory),
  artifactRef: nullable(artifactRefShape), turnsUsed: count(), stagnantSlices: count(1_000), lastProgressKey: nullable(durableDigest), blocker: nullable(oneOf(GENERATION_BLOCKER_CODES)),
});
const ownerShape = shape({ attempt: count(1_000_000, 1), fence: count(Number.MAX_SAFE_INTEGER, 1), workerId: identifier(200), leaseToken: pattern(LEASE_TOKEN, "a lease token"), claimedAt: isoInstant });
const pendingShape = shape({ kind: oneOf(GENERATION_SLICE_KINDS), blockId: nullable(blockId), notBefore: isoInstant, state: oneOf(["queued", "running"]), owner: nullable(ownerShape) });
const usageShape = shape(Object.fromEntries(GENERATION_USAGE_KEYS.map((key) => [key, count()])));
const reservationShape = shape({ sliceId, attempt: count(1_000_000, 1), modelCalls: count(), outputTokens: count(), state: oneOf(["held", "uncertain"]), at: isoInstant });
const unit = GENERATION_TASK_ALLOWANCE_UNIT;
const allowanceShape = shape({
  unit: shape({ modelCalls: count(unit.modelCalls, 1), outputTokens: count(unit.outputTokens, 1), catalogSearches: count(unit.catalogSearches, 1), wallClockMs: count(unit.wallClockMs, 1) }),
  units: count(1 + GENERATION_TASK_BOUNDS.extensions, 1),
  extensions: arrayOf(shape({ principalId: identifier(200), clientActionId: identifier(128), at: isoInstant }), GENERATION_TASK_BOUNDS.extensions),
});
const stampShape = shape({ action: oneOf(GENERATION_CONTROL_ACTIONS), clientActionId: identifier(128), principalId: identifier(200), at: isoInstant });
const controlShape = shape({ cancel: nullable(stampShape), pause: nullable(stampShape), applied: arrayOf(stampShape, GENERATION_TASK_BOUNDS.controlApplied) });
const evidenceValue: Judge = (value, path) => (typeof value === "number" ? count()(value, path) : line(120)(value, path));
const blockerShape = shape({ code: oneOf(GENERATION_BLOCKER_CODES), message: line(GENERATION_TASK_BOUNDS.blockerChars, 1), resolution: line(GENERATION_TASK_BOUNDS.blockerChars, 1), blockId: nullable(blockId), evidence: recordOf(pattern(/^[a-z][A-Za-z0-9]{0,31}$/, "an evidence key"), evidenceValue, GENERATION_TASK_BOUNDS.blockerEvidenceKeys) });
const resultRefShape = shape({ recordId, recordDigest: durableDigest, resultDigest: durableDigest, status: oneOf(["complete", "partial"]), omittedBlocks: arrayOf(line(GENERATION_TASK_BOUNDS.blockNameChars, 1), GENERATION_TASK_BOUNDS.blocks) });
const factsRefShape = shape({ recordId, recordDigest: durableDigest, revision: count(Number.MAX_SAFE_INTEGER, 1) });
const headShape = shape({
  schema: oneOf([GENERATION_TASK_SCHEMA]), taskId, scope: scopeShape,
  initiator: shape({ principalId: identifier(200), role: oneOf(GENERATION_TASK_EDITOR_ROLES), membershipRevision: identifier(128), origin: oneOf(GENERATION_TASK_ORIGINS), chatRunId: nullable(identifier(200)) }),
  request: shape({ clientRequestId: pattern(CLIENT_REQUEST_ID, "a client request uuid"), prompt: modelText(GENERATION_TASK_BOUNDS.promptChars, 1), provider: oneOf(LLM_PROVIDER_IDS), mode: oneOf(["build"]), requestDigest: durableDigest }),
  base: shape({ schematicDigest: pattern(ENGINEERING_DIGEST, "a schematic digest"), recipe: oneOf(GENERATION_BASE_RECIPES), headMark: nullable(canonicalMark), moved: bool }),
  identities: shape({ catalogProfile: oneOf(GENERATION_CATALOG_PROFILES), embeddingModel: identifier(100), promptDigests: shape({ plan: durableDigest, build: durableDigest, subsystem: durableDigest }), sliceContract: oneOf([GENERATION_SLICE_CONTRACT]) }),
  state: oneOf(GENERATION_TASK_STATES), phase: nullable(oneOf(GENERATION_TASK_PHASES)), plan: nullable(planShape),
  blocks: recordOf(blockId, blockStateShape, GENERATION_TASK_BOUNDS.blocks + 1), pending: recordOf(sliceId, pendingShape, GENERATION_TASK_BOUNDS.pending),
  nextSliceSeq: count(999_999, 1), fenceCounter: count(), usage: usageShape, reservations: arrayOf(reservationShape, GENERATION_TASK_BOUNDS.reservations), allowance: allowanceShape,
  control: controlShape, blocker: nullable(blockerShape), result: nullable(resultRefShape), facts: nullable(factsRefShape),
  review: nullable(shape({ outcome: oneOf(GENERATION_REVIEW_OUTCOMES), at: isoInstant, principalId: identifier(200), headMark: nullable(canonicalMark) })),
  failure: nullable(shape({ reason: oneOf(GENERATION_FAILURE_REASONS), at: isoInstant })),
  derivedFrom: nullable(shape({ taskId, reason: oneOf(["rebase", "start-from-saved"]) })),
  milestones: (value, path) => (Array.isArray(value) ? null : `${path}: a list is required`), eventSeq: count(),
  createdAt: isoInstant, updatedAt: isoInstant,
});

const ownersOf = (head: Pick<GenerationTaskHead, "pending">) => Object.entries(head.pending).filter(([, entry]) => entry.owner !== null);
export const hasGenerationOwner = (head: Pick<GenerationTaskHead, "pending">): boolean => ownersOf(head).length > 0;

/** Cross-field invariants of a head that already passed its closed shape. */
function headInvariantIssue(head: GenerationTaskHead): Issue {
  if (head.taskId !== generationTaskId(head.scope, head.initiator.principalId, head.request.clientRequestId)) return "head.taskId: not derived from its scope, principal and client request";
  if (head.request.requestDigest !== generationRequestDigest({ ...head.request, origin: head.initiator.origin, base: head.base })) return "head.request.requestDigest: does not match the request";
  if (head.initiator.origin === "build" && head.initiator.chatRunId !== null) return "head.initiator.chatRunId: only a chat start names a chat run";
  if (Date.parse(head.updatedAt) < Date.parse(head.createdAt)) return "head.updatedAt: before createdAt";
  const milestones = generationTaskMilestonesIssue(head.milestones, head.eventSeq);
  if (milestones) return milestones;
  // plan and blocks
  const blockKeys = Object.keys(head.blocks).sort(compareCodePoints);
  if (head.plan === null) { if (blockKeys.length) return "head.blocks: no plan, so no block"; }
  else {
    if (head.plan.planDigest !== generationPlanDigest(head.plan)) return "head.plan.planDigest: does not match the plan";
    const ids = head.plan.blocks.map((block) => block.blockId);
    const expected = ids.length === 1 && ids[0] === "main" ? ["main"] : ids.map((_, index) => `b${index + 1}`);
    if (ids.join(",") !== expected.join(",")) return "head.plan.blocks: ids are main alone, or b1..bn in order";
    if (blockKeys.join(",") !== [...ids].sort(compareCodePoints).join(",")) return "head.blocks: exactly the planned blocks";
    for (const planned of head.plan.blocks) {
      const state = head.blocks[planned.blockId]!;
      if (state.blockId !== planned.blockId || state.name !== planned.name || state.brief !== planned.brief || state.sharedNets.join("\n") !== planned.sharedNets.join("\n")) return `head.blocks.${planned.blockId}: does not match its planned block`;
      if (state.status === "saved" && state.artifactRef === null) return `head.blocks.${planned.blockId}: a saved block references its checkpoint`;
      if (state.status === "blocked" && state.blocker === null) return `head.blocks.${planned.blockId}: a blocked block names its blocker`;
    }
  }
  // pending slices and ownership
  const fences = new Set<number>();
  for (const [key, entry] of Object.entries(head.pending)) {
    if (!key.startsWith(`${head.taskId}:s`) || generationSliceSeq(key) >= head.nextSliceSeq) return "head.pending: a slice of this task, scheduled before nextSliceSeq";
    if ((entry.kind === "block") !== (entry.blockId !== null)) return `head.pending.${key}: only a block slice names a block`;
    if (entry.blockId !== null && !head.blocks[entry.blockId]) return `head.pending.${key}: names an unplanned block`;
    if (entry.kind !== "plan" && head.plan === null) return `head.pending.${key}: only the plan slice runs before a plan`;
    if ((entry.state === "running") !== (entry.owner !== null)) return `head.pending.${key}: running exactly when owned`;
    if (entry.owner) { if (entry.owner.fence > head.fenceCounter || fences.has(entry.owner.fence)) return `head.pending.${key}: an owner's fence is unique and at most fenceCounter`; fences.add(entry.owner.fence); }
  }
  const reservationKeys = new Set(head.reservations.map((entry) => `${entry.sliceId}#${entry.attempt}`));
  if (reservationKeys.size !== head.reservations.length) return "head.reservations: one per slice attempt";
  if (head.allowance.units !== 1 + head.allowance.extensions.length) return "head.allowance.units: one plus the recorded extensions";
  if (new Set(head.control.applied.map((stamp) => stamp.clientActionId)).size !== head.control.applied.length) return "head.control.applied: one stamp per client action id";
  if (head.result !== null && head.plan === null) return "head.result: requires a plan";
  // state rules (section 2)
  const owned = hasGenerationOwner(head), pending = Object.keys(head.pending).length;
  const blockerStates: readonly GenerationTaskState[] = ["waiting-for-resource", "paused", "cancel-requested", "cancelled", "failed"];
  if (head.blocker !== null && !blockerStates.includes(head.state)) return "head.blocker: only a blocked, paused, cancelling or ended task keeps one";
  if ((head.failure !== null) !== (head.state === "failed")) return "head.failure: exactly when failed";
  if (head.review !== null && head.state !== "succeeded") return "head.review: only a reviewed task records a review";
  if (isTerminalGenerationTaskState(head.state) && pending) return "head.pending: a terminal task schedules nothing";
  switch (head.state) {
    case "running": return owned ? null : "head.state: running needs a live owner";
    case "queued": case "waiting-for-provider": return pending && !owned ? null : `head.state: ${head.state} needs pending, unowned slices`;
    case "waiting-for-resource": return head.blocker !== null && !pending ? null : "head.state: waiting-for-resource names a blocker and schedules nothing";
    case "awaiting-review": return head.result !== null && !pending && head.control.cancel === null ? null : "head.state: awaiting-review references a result and schedules nothing";
    case "paused": return head.control.pause !== null && !owned ? null : "head.state: paused carries its stamp and no owner";
    case "cancel-requested": return head.control.cancel !== null ? null : "head.state: cancel-requested carries its stamp";
    case "cancelled": return head.control.cancel !== null ? null : "head.state: cancelled carries its stamp";
    case "succeeded": return head.result !== null && head.review !== null ? null : "head.state: succeeded references its result and review";
    case "stale": return head.result !== null && head.base.moved ? null : "head.state: stale references its result and a moved base";
    case "failed": return null;
  }
}

/** The first rule a head breaks, or null: closed shape, bounded redacted text, derived identities and digests, the state rules, the size bound. */
export function generationTaskHeadIssue(value: unknown): Issue {
  const issue = headShape(value, "head") ?? headInvariantIssue(value as GenerationTaskHead);
  if (issue) return issue;
  return canonicalBytes(value) <= GENERATION_TASK_BOUNDS.headBytes ? null : "head: larger than the head bound";
}
export function assertGenerationTaskHead(value: unknown): GenerationTaskHead {
  const issue = generationTaskHeadIssue(value);
  if (issue) throw new GenerationTaskContractError(issue.endsWith("larger than the head bound") ? "GENERATION_TASK_TOO_LARGE" : "GENERATION_TASK_INVALID", issue);
  return value as GenerationTaskHead;
}

// ─── The per-scope index ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface GenerationTaskIndexRef { taskId: string; state: GenerationTaskState; origin: GenerationTaskOrigin; createdAt: string; updatedAt: string; requestDigest: string }
export interface GenerationTaskIndex { schema: typeof GENERATION_TASK_INDEX_SCHEMA; active: GenerationTaskIndexRef | null; recent: GenerationTaskIndexRef[] }
const indexRefShape = shape({ taskId, state: oneOf(GENERATION_TASK_STATES), origin: oneOf(GENERATION_TASK_ORIGINS), createdAt: isoInstant, updatedAt: isoInstant, requestDigest: durableDigest });
const indexShape = shape({ schema: oneOf([GENERATION_TASK_INDEX_SCHEMA]), active: nullable(indexRefShape), recent: arrayOf(indexRefShape, GENERATION_TASK_BOUNDS.recentTasks) });
export function generationTaskIndexIssue(value: unknown): Issue {
  const issue = indexShape(value, "index");
  if (issue) return issue;
  const index = value as GenerationTaskIndex;
  if (index.active && isTerminalGenerationTaskState(index.active.state)) return "index.active: a terminal task is never active";
  if (new Set(index.recent.map((entry) => entry.taskId)).size !== index.recent.length) return "index.recent: one entry per task";
  return canonicalBytes(value) <= GENERATION_TASK_BOUNDS.indexBytes ? null : "index: larger than the index bound";
}
export const emptyGenerationTaskIndex = (): GenerationTaskIndex => ({ schema: GENERATION_TASK_INDEX_SCHEMA, active: null, recent: [] });
export function generationIndexRef(head: GenerationTaskHead): GenerationTaskIndexRef {
  return { taskId: head.taskId, state: head.state, origin: head.initiator.origin, createdAt: head.createdAt, updatedAt: head.updatedAt, requestDigest: head.request.requestDigest };
}
/** The index after a start or a terminal transition of `head`: the head becomes (or stops being) the active task, newest first in `recent`. */
export function generationIndexWith(index: GenerationTaskIndex, head: GenerationTaskHead): GenerationTaskIndex {
  const ref = generationIndexRef(head), terminal = isTerminalGenerationTaskState(head.state);
  const active = terminal ? (index.active?.taskId === head.taskId ? null : index.active) : ref;
  const recent = [ref, ...index.recent.filter((entry) => entry.taskId !== head.taskId)].slice(0, GENERATION_TASK_BOUNDS.recentTasks);
  return { schema: GENERATION_TASK_INDEX_SCHEMA, active, recent };
}

// ─── Facts (validated catalog facts shared by a task's blocks) ─────────────────────────────────────────────────────────────

export interface GenerationLookup { query: string; category: string | null; partIds: string[]; resultDigest: string; count: number; lastUsedSeq: number }
export interface GenerationTaskFacts {
  schema: typeof GENERATION_TASK_FACTS_SCHEMA;
  taskId: string;
  /** the LRU clock */
  seq: number;
  parts: Record<string, { part: GenerationPartFacts; factsDigest: string; blocks: GenerationBlockId[]; lastUsedSeq: number }>;
  lookups: Record<string, GenerationLookup>;
  optional: { rerank: { state: "available" | "unavailable"; reason: string | null; since: string; probeAfter: string | null } | null };
}
const factsShape = shape({
  schema: oneOf([GENERATION_TASK_FACTS_SCHEMA]), taskId, seq: count(),
  parts: recordOf(identifier(128), shape({ part: partFactsJudge, factsDigest: durableDigest, blocks: arrayOf(blockId, GENERATION_TASK_BOUNDS.blocks + 1, 1), lastUsedSeq: count() }), GENERATION_TASK_BOUNDS.factsParts),
  lookups: recordOf(durableDigest, shape({ query: line(GENERATION_TASK_BOUNDS.queryChars, 1), category: nullable(line(128, 1)), partIds: arrayOf(identifier(128), 10), resultDigest: durableDigest, count: count(1_000_000), lastUsedSeq: count() }), GENERATION_TASK_BOUNDS.factsLookups),
  optional: shape({ rerank: nullable(shape({ state: oneOf(["available", "unavailable"]), reason: nullable(line(120, 1)), since: isoInstant, probeAfter: nullable(isoInstant) })) }),
});
export function generationTaskFactsIssue(value: unknown): Issue {
  const issue = factsShape(value, "facts");
  if (issue) return issue;
  const facts = value as GenerationTaskFacts;
  for (const [partId, entry] of Object.entries(facts.parts)) {
    if (entry.part.partId !== partId || entry.factsDigest !== partFactsDigest(entry.part)) return "facts.parts: keyed by part id with its facts digest";
    if (entry.lastUsedSeq > facts.seq) return "facts.parts: lastUsedSeq at most seq";
  }
  for (const entry of Object.values(facts.lookups)) if (entry.lastUsedSeq > facts.seq) return "facts.lookups: lastUsedSeq at most seq";
  return canonicalBytes(value) <= GENERATION_TASK_BOUNDS.factsBytes ? null : "facts: larger than the facts bound";
}

/** Section 1.4's lookup key: the NFC lower-cased query with punctuation as spaces, its tokens sorted and de-duplicated; the
 *  normalized category; the catalog profile and the embedding model. Different punctuation of the same search is the same key. */
export function generationSearchKey(input: { query: string; category: string | null | undefined; catalogProfile: GenerationCatalogProfile; embeddingModel: string }): string {
  const tokens = [...new Set(input.query.normalize("NFC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").split(/\s+/).filter(Boolean))].sort(compareCodePoints);
  const category = typeof input.category === "string" ? input.category.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ") : "";
  return durableWorkflowDigest({ schema: "sirkit.generation-search-key.v1", tokens, category: category || null, catalogProfile: input.catalogProfile, embeddingModel: input.embeddingModel });
}

export interface GenerationFactsDelta {
  parts?: ReadonlyArray<{ part: GenerationPartFacts; blockId: GenerationBlockId }>;
  lookups?: ReadonlyArray<{ query: string; category: string | null; partIds: readonly string[]; resultDigest: string; count: number }>;
  rerank?: GenerationTaskFacts["optional"]["rerank"];
}
/** Merge a slice's facts onto the referenced facts: a part's surfacing blocks union, a lookup is refreshed, the least recently used
 *  entries are evicted past the bounds (ties by key). Deterministic and commutative across sibling slices' deltas up to the LRU clock. */
export function applyGenerationFactsDelta(base: GenerationTaskFacts | null, delta: GenerationFactsDelta, context: { taskId: string; catalogProfile: GenerationCatalogProfile; embeddingModel: string }): GenerationTaskFacts {
  const facts: GenerationTaskFacts = base ? structuredClone(base) : { schema: GENERATION_TASK_FACTS_SCHEMA, taskId: context.taskId, seq: 0, parts: {}, lookups: {}, optional: { rerank: null } };
  for (const entry of delta.parts ?? []) {
    const part = normalizePartFacts(entry.part), seq = (facts.seq += 1), previous = facts.parts[part.partId];
    const blocks = [...new Set([...(previous?.blocks ?? []), entry.blockId])].sort(compareCodePoints) as GenerationBlockId[];
    facts.parts[part.partId] = { part, factsDigest: partFactsDigest(part), blocks, lastUsedSeq: seq };
  }
  for (const entry of delta.lookups ?? []) {
    const key = generationSearchKey({ query: entry.query, category: entry.category, catalogProfile: context.catalogProfile, embeddingModel: context.embeddingModel });
    facts.lookups[key] = { query: cleanLine(entry.query, GENERATION_TASK_BOUNDS.queryChars) || "(empty)", category: entry.category ? cleanLine(entry.category, 128) || null : null, partIds: entry.partIds.slice(0, 10).map(String), resultDigest: entry.resultDigest, count: entry.count, lastUsedSeq: (facts.seq += 1) };
  }
  if (delta.rerank !== undefined) facts.optional = { rerank: delta.rerank === null ? null : { ...delta.rerank, reason: delta.rerank.reason === null ? null : cleanLine(delta.rerank.reason, 120) || null } };
  const evict = <T extends { lastUsedSeq: number }>(record: Record<string, T>, max: number) => {
    const keys = Object.keys(record);
    if (keys.length <= max) return;
    keys.sort((a, b) => record[a]!.lastUsedSeq - record[b]!.lastUsedSeq || compareCodePoints(a, b)).slice(0, keys.length - max).forEach((key) => { delete record[key]; });
  };
  evict(facts.parts, GENERATION_TASK_BOUNDS.factsParts);
  evict(facts.lookups, GENERATION_TASK_BOUNDS.factsLookups);
  const issue = generationTaskFactsIssue(facts);
  if (issue) throw new GenerationTaskContractError(issue.endsWith("larger than the facts bound") ? "GENERATION_TASK_TOO_LARGE" : "GENERATION_TASK_FACTS_INVALID", issue);
  return facts;
}

// ─── The result ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GenerationTaskResultPayload {
  schema: typeof GENERATION_TASK_RESULT_SCHEMA;
  taskId: string;
  at: string;
  status: "complete" | "partial";
  omittedBlocks: string[];
  netlist: BuildLogicalNetlist;
  explanation: string;
  electricalCheck: ElectricalCheckStatus;
  planner: BuildPlannerStatus;
  /** every plan shared net labelled in at least two blocks, else a finding */
  sharedNets: { checked: number; findings: string[] };
  /** the saved block checkpoints the merge read (by reference) */
  blocks: Array<{ blockId: GenerationBlockId; recordId: string; recordDigest: string }>;
  resultDigest: string;
}
const resultShape = shape({
  schema: oneOf([GENERATION_TASK_RESULT_SCHEMA]), taskId, at: isoInstant, status: oneOf(["complete", "partial"]), omittedBlocks: arrayOf(line(GENERATION_TASK_BOUNDS.blockNameChars, 1), GENERATION_TASK_BOUNDS.blocks),
  netlist: netlistJudge(1), explanation: modelText(GENERATION_TASK_BOUNDS.explanationChars), electricalCheck: electricalCheckJudge, planner: plannerJudge,
  sharedNets: shape({ checked: count(1_000), findings: arrayOf(line(200, 1), 20) }), blocks: arrayOf(shape({ blockId, recordId, recordDigest: durableDigest }), GENERATION_TASK_BOUNDS.blocks, 1), resultDigest: durableDigest,
});
export function generationResultDigest(payload: Omit<GenerationTaskResultPayload, "resultDigest">): string {
  const { schema, taskId: id, at, status, omittedBlocks, netlist, explanation, electricalCheck, planner, sharedNets, blocks } = payload;
  return durableWorkflowDigest({ schema, taskId: id, at, status, omittedBlocks, netlist, explanation, electricalCheck, planner, sharedNets, blocks });
}
export function generationTaskResultIssue(value: unknown): Issue {
  const issue = resultShape(value, "result");
  if (issue) return issue;
  const payload = value as GenerationTaskResultPayload;
  if (payload.resultDigest !== generationResultDigest(payload)) return "result.resultDigest: does not match the result";
  if ((payload.status === "complete") !== (payload.omittedBlocks.length === 0)) return "result.status: complete exactly when no block is omitted";
  return canonicalBytes(value) <= GENERATION_TASK_BOUNDS.resultBytes ? null : "result: larger than the result bound";
}
/** Build the result document from the merge slice's outputs (normalized, digested, judged; a refusal throws). */
export function buildGenerationTaskResult(input: Omit<GenerationTaskResultPayload, "schema" | "resultDigest">): GenerationTaskResultPayload {
  const body: Omit<GenerationTaskResultPayload, "resultDigest"> = {
    schema: GENERATION_TASK_RESULT_SCHEMA, taskId: input.taskId, at: input.at, status: input.status, omittedBlocks: input.omittedBlocks.map((name) => cleanLine(name, GENERATION_TASK_BOUNDS.blockNameChars)),
    netlist: normalizeNetlist(input.netlist), explanation: cleanModelText(input.explanation, GENERATION_TASK_BOUNDS.explanationChars), electricalCheck: normalizeElectricalCheck(input.electricalCheck), planner: structuredClone(input.planner),
    sharedNets: { checked: input.sharedNets.checked, findings: input.sharedNets.findings.slice(0, 20).map((finding) => cleanLine(finding, 200)) }, blocks: input.blocks.map((entry) => ({ ...entry })),
  };
  const payload = { ...body, resultDigest: generationResultDigest(body) };
  const issue = generationTaskResultIssue(payload);
  if (issue) throw new GenerationTaskContractError(issue.endsWith("larger than the result bound") ? "GENERATION_TASK_TOO_LARGE" : "GENERATION_TASK_RESULT_INVALID", issue);
  return payload;
}

// ─── Derived state, work and accounting ────────────────────────────────────────────────────────────────────────────────────

/** Section 2's state, recomputed from the head's facts after a commit's delta: cancel wins, then a live owner, then pause, then a
 *  result, then pending work (all delayed = waiting for the provider), then a blocker. Null when nothing is pending, owned, held
 *  or blocking (an end commit must schedule, deliver or block). Terminal states are sticky. */
export function deriveGenerationTaskState(head: GenerationTaskHead, nowMs: number): GenerationTaskState | null {
  if (isTerminalGenerationTaskState(head.state)) return head.state;
  if (head.failure) return "failed";
  const owned = hasGenerationOwner(head), pending = Object.values(head.pending);
  if (head.control.cancel) return owned ? "cancel-requested" : "cancelled";
  if (owned) return "running";
  if (head.control.pause) return "paused";
  if (head.result) return "awaiting-review";
  if (pending.length) return pending.every((entry) => Date.parse(entry.notBefore) > nowMs) ? "waiting-for-provider" : "queued";
  if (head.blocker) return "waiting-for-resource";
  return null;
}

/** The slices a resume schedules (fresh ids): the plan when there is none; otherwise every block not yet saved or omitted; otherwise
 *  the merge when no result exists. */
export function nextGenerationWork(head: GenerationTaskHead): Array<{ kind: GenerationSliceKind; blockId: GenerationBlockId | null }> {
  if (head.result) return [];
  if (!head.plan) return [{ kind: "plan", blockId: null }];
  const open = head.plan.blocks.filter((block) => !["saved", "omitted"].includes(head.blocks[block.blockId]!.status));
  if (open.length) return open.map((block) => ({ kind: "block" as const, blockId: block.blockId }));
  return head.plan.blocks.some((block) => head.blocks[block.blockId]!.status === "saved") ? [{ kind: "merge", blockId: null }] : [];
}

/** One slice attempt's worst-case reservation (section 5): a block slice reserves its turns x 8 192 output tokens, the planner one
 *  4 096-token call, the merge nothing. */
export function generationReservationFor(kind: GenerationSliceKind, turns: number): { modelCalls: number; outputTokens: number } {
  if (kind === "plan") return { modelCalls: 1, outputTokens: GENERATION_SLICE_POLICY.planOutputTokens };
  if (kind === "merge") return { modelCalls: 0, outputTokens: 0 };
  return { modelCalls: turns, outputTokens: turns * GENERATION_SLICE_POLICY.turnOutputTokens };
}
export function generationAllowanceLimits(allowance: GenerationTaskAllowance): GenerationAllowanceUnit {
  return { modelCalls: allowance.unit.modelCalls * allowance.units, outputTokens: allowance.unit.outputTokens * allowance.units, catalogSearches: allowance.unit.catalogSearches * allowance.units, wallClockMs: allowance.unit.wallClockMs * allowance.units };
}
/** Spent plus every held or uncertain reservation (and the folded uncertain worst case): the cross-process spend bound. */
export function generationCommitted(head: Pick<GenerationTaskHead, "usage" | "reservations">): { modelCalls: number; outputTokens: number } {
  return head.reservations.reduce((sum, entry) => ({ modelCalls: sum.modelCalls + entry.modelCalls, outputTokens: sum.outputTokens + entry.outputTokens }), { modelCalls: head.usage.modelCalls + head.usage.uncertainModelCalls, outputTokens: head.usage.outputTokens + head.usage.uncertainOutputTokens });
}
/** Why a new reservation does not fit the allowance, or null when it does. */
export function generationAllowanceRefusal(head: GenerationTaskHead, reservation: { modelCalls: number; outputTokens: number }, nowMs: number): "allowance_exhausted" | "task_window_elapsed" | null {
  const limits = generationAllowanceLimits(head.allowance), committed = generationCommitted(head);
  if (nowMs - Date.parse(head.createdAt) > limits.wallClockMs) return "task_window_elapsed";
  if (committed.modelCalls + reservation.modelCalls > limits.modelCalls || committed.outputTokens + reservation.outputTokens > limits.outputTokens) return "allowance_exhausted";
  if (reservation.modelCalls > 0 && head.usage.catalogSearches >= limits.catalogSearches) return "allowance_exhausted";
  return null;
}
export function generationReservationsWithinAllowance(head: GenerationTaskHead): boolean {
  const limits = generationAllowanceLimits(head.allowance), committed = generationCommitted(head);
  return committed.modelCalls <= limits.modelCalls && committed.outputTokens <= limits.outputTokens;
}

/** Server sentences for each blocker (what happened, and what resolves it). Never model text. */
export const GENERATION_BLOCKER_TEXT: Readonly<Record<GenerationBlockerCode, { message: string; resolution: string }>> = Object.freeze({
  provider_credentials: { message: "The model provider is not configured or its credentials were refused.", resolution: "Configure the provider credentials, then resume the design." },
  provider_quota: { message: "The model provider reported its quota or credit as exhausted.", resolution: "Restore the provider quota or credit, then resume the design." },
  provider_access: { message: "The model provider denied access to the configured model.", resolution: "Grant access to the model or choose another provider, then resume." },
  allowance_exhausted: { message: "This design used its model-call and token allowance.", resolution: "Continue with another allowance, review the saved blocks, or stop the design." },
  no_progress: { message: "Every strategy for a block stopped making progress.", resolution: "Retry the block after changing the request, review the saved blocks, or stop the design." },
  missing_part: { message: "A block needs a part the catalog does not contain.", resolution: "Add or approve the missing part, then retry the block." },
  missing_evidence: { message: "A block needs evidence (pins, footprint or authority) that is not available.", resolution: "Supply the missing evidence, then retry the block." },
  platform_failure: { message: "A slice of this design lost its worker repeatedly.", resolution: "Check that a generation worker is running and healthy, then resume." },
  task_window_elapsed: { message: "This design reached its wall-clock window.", resolution: "Continue with another allowance, review the saved blocks, or stop the design." },
  partial_available: { message: "Some blocks are saved and another is blocked.", resolution: "Review the saved blocks as a partial design, or retry the blocked block." },
});

// ─── Transitions (section 2) ─────────────────────────────────────────────────────────────────────────────────────────────

export const GENERATION_TRANSITION_ACTORS = Object.freeze(["start-api", "worker", "control-api"] as const);
export type GenerationTransitionActor = (typeof GENERATION_TRANSITION_ACTORS)[number];
/** What an actor attests beyond the heads themselves (the heads are checked structurally). */
export interface GenerationTransitionAttestation {
  providerServable?: boolean;
  leaseToken?: string;
  membershipLive?: boolean;
  /** slice ids whose outbox effects ride the SAME commit */
  scheduled?: readonly string[];
  waitingReason?: GenerationWaitingReason;
  controlAction?: GenerationControlAction;
  clientActionId?: string;
  principalRole?: ProjectRole;
  resultVerified?: boolean;
  noLiveLease?: boolean;
  resultDigest?: string;
  liveBaseDigest?: string;
}
export interface GenerationTransitionRule { id: string; from: ReadonlyArray<GenerationTaskState | null>; to: GenerationTaskState; actors: readonly GenerationTransitionActor[]; evidence: string }
const WORK: readonly GenerationTaskState[] = ["queued", "running", "waiting-for-provider", "waiting-for-resource"];
const NON_TERMINAL: readonly GenerationTaskState[] = ["queued", "running", "waiting-for-provider", "waiting-for-resource", "awaiting-review", "paused", "cancel-requested"];
export const GENERATION_TASK_TRANSITIONS: readonly GenerationTransitionRule[] = Object.freeze([
  { id: "start", from: [null], to: "queued", actors: ["start-api"], evidence: "trusted context with an editor role; validated request; provider servable; ONE commit of head revision 1, the index CAS and the first plan slice's outbox effect" },
  { id: "claim", from: ["queued", "waiting-for-provider"], to: "running", actors: ["worker"], evidence: "outbox lease token; head CAS claim commit (fence + 1, owner); live membership re-check; the reservation fits the allowance" },
  { id: "yield", from: ["running"], to: "queued", actors: ["worker"], evidence: "end commit with checkpoint refs and the next slice's outbox effect in the same commit; no owner remains" },
  { id: "wait-provider", from: ["running"], to: "waiting-for-provider", actors: ["worker"], evidence: "a retryable provider reason or an admission pause; every pending slice delayed (Retry-After / backoff) by an outbox effect with availableAt" },
  { id: "wait-resource", from: ["running", "queued", "waiting-for-provider"], to: "waiting-for-resource", actors: ["worker"], evidence: "a closed blocker code with evidence; no pending slice; saved blocks untouched" },
  { id: "resume-resource", from: ["waiting-for-resource"], to: "queued", actors: ["control-api"], evidence: "resume / retry-block / review-partial (optionally with an allowance extension) by an editor role, recorded with its principal; fresh slices scheduled in the same commit" },
  { id: "result", from: ["running"], to: "awaiting-review", actors: ["worker"], evidence: "the result aggregate committed and verified (resultDigest, non-empty merged netlist, ERC state, shared-net check); nothing pending" },
  { id: "pause", from: WORK, to: "paused", actors: ["control-api", "worker"], evidence: "a pause stamp; the state flips only when no owner remains (running slices yield at a turn boundary)" },
  { id: "resume-paused", from: ["paused"], to: "queued", actors: ["control-api"], evidence: "a resume stamp; fresh slice ids scheduled in the same commit" },
  { id: "cancel-request", from: ["queued", "running", "waiting-for-provider", "waiting-for-resource", "paused"], to: "cancel-requested", actors: ["control-api"], evidence: "a cancel stamp" },
  { id: "cancel-settle", from: ["cancel-requested"], to: "cancelled", actors: ["worker", "control-api"], evidence: "owners aborted and fenced (nothing pending); the API only when no live lease exists" },
  { id: "review", from: ["awaiting-review"], to: "succeeded", actors: ["control-api"], evidence: "the review outcome and principal; the result digest matches; an applied outcome carries the post-apply head mark" },
  { id: "stale", from: ["awaiting-review"], to: "stale", actors: ["control-api"], evidence: "the page's live base digest (same recipe) differs from the pinned base" },
  { id: "fail", from: NON_TERMINAL, to: "failed", actors: ["worker", "control-api"], evidence: "authority_revoked, invalid_persisted_state or invalid_request only; nothing pending" },
] satisfies GenerationTransitionRule[]);

const queuedCount = (head: GenerationTaskHead) => Object.values(head.pending).filter((entry) => entry.owner === null).length;
const EVIDENCE: Readonly<Record<string, (prev: GenerationTaskHead | null, next: GenerationTaskHead, attest: GenerationTransitionAttestation) => Issue>> = {
  start: (_prev, next, attest) => {
    const pending = Object.values(next.pending);
    if (attest.providerServable !== true) return "start: the provider must be servable";
    if (!isGenerationEditorRole(next.initiator.role)) return "start: an editor role is required";
    if (pending.length !== 1 || pending[0]!.kind !== "plan" || pending[0]!.owner !== null || next.fenceCounter !== 0) return "start: exactly the first plan slice, unowned";
    return (attest.scheduled ?? []).length === 1 ? null : "start: the plan slice's effect rides the start commit";
  },
  claim: (prev, next, attest) => {
    if (attest.membershipLive !== true) return "claim: the live membership re-check is required";
    if (!attest.leaseToken) return "claim: the outbox lease token is required";
    if (next.fenceCounter !== prev!.fenceCounter + 1) return "claim: the fence advances by one";
    if (!ownersOf(next).some(([, entry]) => entry.owner!.fence === next.fenceCounter && entry.owner!.leaseToken === attest.leaseToken)) return "claim: the new owner holds the new fence and the lease token";
    return generationReservationsWithinAllowance(next) ? null : "claim: the reservation must fit the allowance";
  },
  yield: (_prev, next) => (!hasGenerationOwner(next) && queuedCount(next) > 0 ? null : "yield: no owner remains and a slice is queued"),
  "wait-provider": (_prev, next, attest) => {
    if (!attest.waitingReason || !(GENERATION_WAITING_REASONS as readonly string[]).includes(attest.waitingReason)) return "wait-provider: a retryable provider reason or an admission pause is required";
    const pending = Object.values(next.pending);
    return pending.length > 0 && !hasGenerationOwner(next) && pending.every((entry) => Date.parse(entry.notBefore) > Date.parse(next.updatedAt)) ? null : "wait-provider: every pending slice is delayed";
  },
  "wait-resource": (prev, next) => {
    if (next.blocker === null || Object.keys(next.pending).length) return "wait-resource: a blocker and nothing pending";
    for (const [id, state] of Object.entries(prev?.blocks ?? {})) {
      if (state?.status !== "saved") continue;
      const after = next.blocks[id as GenerationBlockId];
      if (after?.status !== "saved" || after.artifactRef?.recordId !== state.artifactRef?.recordId) return "wait-resource: a saved block is untouched";
    }
    return null;
  },
  "resume-resource": (_prev, next, attest) => {
    if (!attest.controlAction || !["resume", "retry-block", "review-partial"].includes(attest.controlAction)) return "resume-resource: resume, retry-block or review-partial";
    if (!isGenerationEditorRole(attest.principalRole)) return "resume-resource: an editor role is required";
    if (!next.control.applied.some((stamp) => stamp.action === attest.controlAction && stamp.clientActionId === attest.clientActionId)) return "resume-resource: the action is recorded with its principal";
    return next.blocker === null && queuedCount(next) > 0 ? null : "resume-resource: the blocker is cleared and work is scheduled";
  },
  result: (_prev, next, attest) => (attest.resultVerified === true && next.result !== null && Object.keys(next.pending).length === 0 ? null : "result: a verified result and nothing pending"),
  pause: (_prev, next) => (next.control.pause !== null && !hasGenerationOwner(next) ? null : "pause: a pause stamp and no owner"),
  "resume-paused": (_prev, next, attest) => (next.control.pause === null && next.control.applied.some((stamp) => stamp.action === "resume" && stamp.clientActionId === attest.clientActionId) && queuedCount(next) > 0 ? null : "resume-paused: a resume stamp and fresh work"),
  "cancel-request": (_prev, next) => (next.control.cancel !== null ? null : "cancel-request: a cancel stamp"),
  "cancel-settle": (_prev, next, attest) => (next.control.cancel !== null && Object.keys(next.pending).length === 0 && (attest.noLiveLease === true) ? null : "cancel-settle: nothing pending and no live lease"),
  review: (_prev, next, attest) => {
    if (next.review === null || next.result === null || attest.resultDigest !== next.result.resultDigest) return "review: the outcome and the matching result digest";
    return next.review.outcome !== "applied" || next.review.headMark !== null ? null : "review: an applied outcome carries the post-apply head mark";
  },
  stale: (_prev, next, attest) => (typeof attest.liveBaseDigest === "string" && attest.liveBaseDigest !== next.base.schematicDigest && next.base.moved ? null : "stale: the live base differs from the pinned base"),
  fail: (_prev, next) => (next.failure !== null && Object.keys(next.pending).length === 0 ? null : "fail: a closed failure reason and nothing pending"),
};

/** The rule of a state change, or null when none permits it for this actor. */
export function generationTransitionRule(from: GenerationTaskState | null, to: GenerationTaskState, actor: GenerationTransitionActor): GenerationTransitionRule | null {
  return GENERATION_TASK_TRANSITIONS.find((rule) => rule.to === to && rule.from.includes(from) && rule.actors.includes(actor)) ?? null;
}
/** Why `prev -> next` is refused (no rule for the actor, or the rule's evidence is missing), or null. A commit that keeps the
 *  state is not a transition and answers null. Composite steps (`via`) are checked one by one against the same `next`. */
export function generationTaskTransitionIssue(prev: GenerationTaskHead | null, next: GenerationTaskHead, actor: GenerationTransitionActor, attest: GenerationTransitionAttestation = {}, via?: GenerationTaskState): Issue {
  const from = prev?.state ?? null;
  if (via !== undefined) {
    const first = generationTransitionRule(from, via, actor);
    if (!first) return `transition ${from ?? "(none)"} -> ${via}: not permitted for ${actor}`;
    const viaHead = { ...next, state: via };
    const firstIssue = EVIDENCE[first.id]!(prev, viaHead, attest);
    if (firstIssue) return firstIssue;
    return generationTaskTransitionIssue(viaHead, next, actor, attest);
  }
  if (from === next.state) return null;
  const rule = generationTransitionRule(from, next.state, actor);
  if (!rule) return `transition ${from ?? "(none)"} -> ${next.state}: not permitted for ${actor}`;
  return EVIDENCE[rule.id]!(prev, next, attest);
}
