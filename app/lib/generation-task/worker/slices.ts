/**
 * [PR-L, 2026-10-17] Runbook L.3, increment 3 part 2 (task-worker-contract.md sections 3.1, 3.2 and 5): ONE claimed slice - plan, block
 * or merge - run through the slice core under the slice's own cancellation boundary, and settled into the durable task.
 *
 *  - plan: the planner call (build-multi-generation.ts `planGeneration`, at most 8 blocks) inside the plan window; the plan and the first
 *    block slices are committed together (`schedule: "next-work"`). A cut or unreadable plan, after its one correction attempt, is
 *    designed as ONE block and says so (`planner.state` "failed_fallback"), as the request-lifetime route does.
 *  - block: one finite slice of the block's conversation (`designBlockSlice` for S1, `runBlockSlice` for a seeded strategy) resumed from
 *    the block's checkpoint, at most the slice's RESERVED turns, in the block window. At every complete turn boundary the supervisor
 *    renews the lease when due and polls control; the boundary's checkpoint, the usage since the last boundary and the facts learnt are
 *    committed (fenced); a pause or a worker shutdown yields there. A submission that passes validation and the ERC gate saves the block
 *    IMMEDIATELY; the merge is scheduled only by the end commit that sees no other block open. Reaching the turn allowance or the window
 *    queues the next slice: never a failed block. A no-progress run walks the strategy ladder (progress.ts).
 *  - merge: the saved blocks' netlists read by reference, their part facts revalidated against the catalog, `mergeAndValidate` (the
 *    deterministic merge, the post-merge electrical check, the shared-net obligations) and the result aggregate; `partial` only when a
 *    block was omitted by an explicit `review-partial`.
 *
 * Every end is ONE fenced commit through the store (`endSlice`): a late or fenced-out slice writes nothing (GENERATION_SLICE_FENCED); a
 * slice the user stopped settles the cancel with what it spent (`settleCancel`); a slice the worker could not finish (shutdown after the
 * grace, a lost lease, an unexpected failure) hands its work back for another attempt (`releaseSlice`; repeated loss becomes
 * `platform_failure` at the next claim). No canonical engineering state is ever mutated here.
 */
import { LLMProviderError, isRetryableReason } from "../../llm/errors";
import type { AiPartResult } from "../../parts-search";
import { resolveMainCategory, MAIN_CATEGORIES } from "../../kicad/categories";
import { BuildBoundaryError, withinBuildBoundary } from "../../schematic/build-boundary";
import { runBlockSlice, type BlockSliceOutcome, type BlockSliceTurn, type BuildCatalogPort, type BuildLlmPort, type BuildLoopBlock } from "../../schematic/build-loop-slice";
import { blockDesignRequest, designBlockSlice, generationPlanInput, mergeAndValidate, planGeneration, type GenerationPlanDraft, type PlanGenerationOutcome, type PlannedBlock } from "../../schematic/build-multi-generation";
import type { BuildBudgetReport } from "../../schematic/build-result";
import { BUILD_BUDGET } from "../../schematic/build-result";
import { sanitizeTraceText } from "../../agent/redaction";
import { normalizePartFacts, type BuildLoopCheckpoint, type GenerationPartFacts } from "../checkpoint";
import {
  GENERATION_SLICE_POLICY, GENERATION_TASK_BOUNDS, buildGenerationTaskResult, generationBlockTurnsPerSlice,
  type GenerationBlockState, type GenerationTaskHead, type GenerationTaskUsage,
} from "../contracts";
import { generationTaskEvent, type GenerationTaskEventDraft } from "../events";
import type { GenerationBlockPatch, GenerationSliceEnd, GenerationSliceLease, GenerationTaskStore } from "../store";
import { GenerationTaskContractError, cleanLine, isoOf, type GenerationBlockId, type GenerationStrategyId, type GenerationTaskState } from "../vocabulary";
import { FactsCatalogPort, MeteredLlmPort, SliceMeter, consecutiveProviderWaits, isAdmissionPause, providerBlockerOf, providerWait, zeroSpend, type GenerationLlmAdmission, type SliceSpend } from "./accounting";
import { blockLearning, historyClosed, historyWithSlice, judgeSliceProgress, nextStrategyOf, quotedQuery, strategyAtClaim, strategySeedText, type BlockLearning } from "./progress";

// ─── The worker's side of a slice ────────────────────────────────────────────────────────────────────────────────────────

/** Why a running slice was stopped from outside: the user's cancel, a lease the worker could not renew, another owner took the slice,
 *  or the worker shut down after its grace. */
export type SliceStopReason = "cancel" | "lease_lost" | "fenced" | "shutdown";
/** What the supervisor answers at a complete turn boundary. */
export type BoundaryVerdict = "continue" | "yield" | "cancel" | "fenced";
/** The worker's handle on one running slice (worker.ts implements it). */
export interface SliceSupervisor {
  /** aborted on cancel, lease loss, fencing or shutdown after the grace */
  readonly signal: AbortSignal;
  stopReason(): SliceStopReason | null;
  /** at a complete turn boundary: renew the lease when due, poll control, and say whether the slice may continue */
  boundary(): Promise<BoundaryVerdict>;
}
export interface GenerationSlicePorts {
  llm: BuildLlmPort;
  catalog: BuildCatalogPort;
  /** the process LLM meters (purpose `agent`); absent = not metered (tests, the fixture) */
  admission?: GenerationLlmAdmission;
}
/** The finite execution-slice windows (section 3.1); never the work a task may do. */
export interface GenerationSliceWindows {
  planWindowMs: number;
  blockWindowMs: number;
  mergeWindowMs: number;
  perCallMs: number;
  minTurnStartMs: number;
  stagnantSlicesPerStrategy: number;
}
export const DEFAULT_SLICE_WINDOWS: Readonly<GenerationSliceWindows> = Object.freeze({
  planWindowMs: GENERATION_SLICE_POLICY.planWindowMs, blockWindowMs: GENERATION_SLICE_POLICY.blockWindowMs, mergeWindowMs: GENERATION_SLICE_POLICY.mergeWindowMs,
  perCallMs: GENERATION_SLICE_POLICY.perCallMs, minTurnStartMs: GENERATION_SLICE_POLICY.minTurnStartMs, stagnantSlicesPerStrategy: GENERATION_SLICE_POLICY.stagnantSlicesPerStrategy,
});
export interface SliceContext {
  store: GenerationTaskStore;
  lease: GenerationSliceLease;
  /** the head as the claim committed it */
  task: GenerationTaskHead;
  ports: GenerationSlicePorts;
  supervisor: SliceSupervisor;
  windows: GenerationSliceWindows;
  /** the task clock (the store's): timestamps, notBefore */
  clock: () => number;
  random: () => number;
  log: (line: string) => void;
}
export type GenerationSliceOutcomeKind = "planned" | "saved" | "yielded" | "strategy_changed" | "waiting_provider" | "blocked" | "result" | "cancelled" | "released" | "fenced";
export interface GenerationSliceReport {
  sliceId: string;
  taskId: string;
  kind: GenerationSliceLease["kind"];
  blockId: GenerationBlockId | null;
  attempt: number;
  outcome: GenerationSliceOutcomeKind;
  /** the task's state after the slice's last commit (null when nothing was committed) */
  state: GenerationTaskState | null;
  /** one bounded server sentence */
  detail: string;
}

class SliceFencedError extends Error {
  constructor() { super("GENERATION_SLICE_FENCED"); this.name = "SliceFencedError"; }
}
class SliceCommitError extends Error {
  constructor(readonly code: string, readonly issue?: string) { super(`${code}${issue ? `: ${issue}` : ""}`); this.name = "SliceCommitError"; }
}
const bounded = (error: unknown): string => sanitizeTraceText(error instanceof Error ? error.message : String(error), 240).trim() || "unknown failure";
const report = (ctx: SliceContext, outcome: GenerationSliceOutcomeKind, state: GenerationTaskState | null, detail: string): GenerationSliceReport => ({
  sliceId: ctx.lease.sliceId, taskId: ctx.lease.taskId, kind: ctx.lease.kind, blockId: ctx.lease.blockId, attempt: ctx.lease.attempt, outcome, state, detail: cleanLine(detail, 240),
});

// ─── Settling ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Hand the slice back for another attempt (its reservation stays uncertain, charged at worst case). */
async function release(ctx: SliceContext, detail: string): Promise<GenerationSliceReport> {
  try {
    const outcome = await ctx.store.releaseSlice(ctx.lease);
    if (outcome.ok) return report(ctx, "released", outcome.task.state, detail);
    if (outcome.code === "GENERATION_SLICE_FENCED") return report(ctx, "fenced", null, "the slice had already lost its ownership; nothing more was written");
    return report(ctx, "released", null, `${detail} (release refused: ${outcome.code})`);
  } catch (error) {
    // the store is unreachable: the lease lapses within leaseMs and the next claimer takes the slice from its last checkpoint
    return report(ctx, "released", null, `${detail} (release not recorded: ${bounded(error)}; the lease will lapse)`);
  }
}

/** The user stopped the design: settle with what this attempt spent (an unfinished call stays uncertain). */
async function settleCancel(ctx: SliceContext, usage: Partial<GenerationTaskUsage>): Promise<GenerationSliceReport> {
  const outcome = await ctx.store.settleCancel(ctx.lease, usage);
  if (outcome.ok) return report(ctx, "cancelled", outcome.task.state, "stopped by the user's cancel; nothing more will run");
  if (outcome.code === "GENERATION_SLICE_FENCED") return report(ctx, "fenced", null, "the slice had already lost its ownership; nothing more was written");
  throw new SliceCommitError(outcome.code, outcome.issue);
}

/** A slice stopped from outside before its end commit: settle it by why it was stopped. */
async function stopped(ctx: SliceContext, usage: Partial<GenerationTaskUsage>): Promise<GenerationSliceReport> {
  const reason = ctx.supervisor.stopReason();
  if (reason === "cancel") return settleCancel(ctx, usage);
  if (reason === "fenced") return report(ctx, "fenced", null, "another owner holds the slice; nothing more was written");
  return release(ctx, reason === "shutdown" ? "the worker shut down; the slice resumes from its last checkpoint" : "the lease could not be renewed; the slice resumes from its last checkpoint");
}

/** The task's facts are a CACHE of validated catalog answers: a facts delta the facts aggregate cannot hold (its byte bound, e.g. parts
 *  with very long pin lists) is dropped - logged - and the commit made without it, never wedging the slice. Anything else is rethrown. */
async function withFactsFallback<T>(ctx: SliceContext, payload: { facts?: GenerationSliceEnd["facts"] }, commit: (payload: { facts?: GenerationSliceEnd["facts"] }) => Promise<T>): Promise<T> {
  try {
    return await commit(payload);
  } catch (error) {
    if (!payload.facts || !(error instanceof GenerationTaskContractError) || (error.code !== "GENERATION_TASK_TOO_LARGE" && error.code !== "GENERATION_TASK_FACTS_INVALID")) throw error;
    ctx.log(`slice ${ctx.lease.sliceId}: the facts learnt could not be stored (${error.code}); committed without them (the facts are a cache)`);
    const { facts: _dropped, ...rest } = payload;
    void _dropped;
    return commit(rest);
  }
}

/** The ONE end commit. A cancel that arrived first settles the cancel instead; a fenced slice writes nothing. */
async function end(ctx: SliceContext, payload: GenerationSliceEnd, outcome: GenerationSliceOutcomeKind, detail: string): Promise<GenerationSliceReport> {
  const committed = await withFactsFallback(ctx, payload, (attempt) => ctx.store.endSlice(ctx.lease, { ...payload, facts: attempt.facts }));
  if (committed.ok) return report(ctx, outcome, committed.task.state, detail);
  if (committed.code === "GENERATION_SLICE_FENCED") return report(ctx, "fenced", null, "another owner holds the slice; its late result was not committed");
  if (committed.code === "GENERATION_TASK_CANCEL_REQUESTED") return settleCancel(ctx, payload.usage ?? {});
  throw new SliceCommitError(committed.code, committed.issue);
}

// ─── Entry point ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Run one claimed slice to its settlement. Never throws: an unexpected failure releases the slice for another attempt. */
export async function runGenerationSlice(ctx: SliceContext): Promise<GenerationSliceReport> {
  try {
    switch (ctx.lease.kind) {
      case "plan": return await runPlanSlice(ctx);
      case "block": return await runDesignSlice(ctx);
      case "merge": return await runMergeSlice(ctx);
    }
  } catch (error) {
    if (error instanceof SliceFencedError) return report(ctx, "fenced", null, "another owner holds the slice; nothing more was written");
    const reason = ctx.supervisor.stopReason();
    if (reason === "fenced") return report(ctx, "fenced", null, "another owner holds the slice; nothing more was written");
    ctx.log(`slice ${ctx.lease.sliceId} (attempt ${ctx.lease.attempt}) failed: ${bounded(error)}`);
    return release(ctx, `the slice failed (${bounded(error)}) and was released for another attempt`);
  }
}

// ─── plan ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function runPlanSlice(ctx: SliceContext): Promise<GenerationSliceReport> {
  const { task } = ctx;
  const llm = new MeteredLlmPort(ctx.ports.llm, ctx.ports.admission);
  const meter = new SliceMeter(GENERATION_SLICE_POLICY.planOutputTokens);
  let planned: PlanGenerationOutcome | null = null;
  try {
    planned = await withinBuildBoundary(Date.now() + ctx.windows.planWindowMs, ctx.supervisor.signal, (signal) =>
      planGeneration({ prompt: task.request.prompt, provider: task.request.provider, signal, llm, maxBlocks: GENERATION_TASK_BOUNDS.blocks }));
  } catch (error) {
    if (!(error instanceof BuildBoundaryError)) throw error;
    if (error.kind === "cancelled") return stopped(ctx, meter.peek(llm.spend()));
  }
  const usage = meter.peek(llm.spend()), now = ctx.clock();
  // the window ended with the planner call unanswered, or a transient provider failure: the plan slice is retried after a backoff
  if (planned === null || (planned.kind === "provider_error" && isRetryableReason(planned.error.reason))) {
    const error = planned?.kind === "provider_error" ? planned.error : null;
    const wait = providerWait({ reason: error?.reason ?? "timeout", retryAfterMs: error?.retryAfterMs ?? null, admission: error !== null && isAdmissionPause(error), consecutive: consecutiveProviderWaits(task, null) + 1, random: ctx.random, now });
    return end(ctx, { usage, schedule: [{ kind: "plan", blockId: null, notBefore: wait.notBefore }], waitingReason: wait.waitingReason }, "waiting_provider", `the planner waits for the provider (${wait.waitingReason}) until ${wait.notBefore}`);
  }
  if (planned.kind === "provider_error") {
    const blocker = providerBlockerOf(planned.error.reason);
    ctx.log(`plan slice ${ctx.lease.sliceId}: the provider refused (${planned.error.reason}); the task waits (${blocker})`);
    return end(ctx, { usage, blocker }, "blocked", `the provider refused the planner (${planned.error.reason}): ${blocker}`);
  }
  const draft: GenerationPlanDraft = planned.kind === "planned"
    ? planned.plan
    : { planner: { state: "failed_fallback", reason: cleanLine(planned.reason, 200) || "the planner failed" }, rationale: "", assumptions: [], blocks: [] };
  const plan = generationPlanInput(draft, task.request.prompt);
  const names = plan.blocks.map((block) => block.name).join(", ");
  const milestone = generationTaskEvent("plan_ready", {
    at: isoOf(now), phase: "planning",
    message: draft.planner.state === "planned" ? `Planned ${plan.blocks.length} subsystem blocks: ${names}.` : draft.planner.state === "single" ? "Designing the request as one circuit." : "The plan could not be read; designing the request as one circuit.",
    data: { blocks: plan.blocks.length, planner: draft.planner.state },
  });
  return end(ctx, { plan, usage, schedule: "next-work", milestones: [milestone] }, "planned", `planned ${plan.blocks.length} block(s) (${draft.planner.state})`);
}

// ─── block ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

function plannedBlockOf(task: GenerationTaskHead, blockId: GenerationBlockId): PlannedBlock | null {
  if (blockId === "main") return null;
  const block = task.plan?.blocks.find((entry) => entry.blockId === blockId);
  if (!block) throw new SliceCommitError("GENERATION_TASK_STATE_CONFLICT", "the slice's block is not planned");
  return { name: block.name, brief: block.brief, sharedNets: [...block.sharedNets] };
}
/** The turns this slice attempt reserved at its claim (the allowance it may spend); the operator-lowered default otherwise. */
function reservedTurns(task: GenerationTaskHead, lease: GenerationSliceLease): number {
  const held = task.reservations.find((entry) => entry.sliceId === lease.sliceId && entry.attempt === lease.attempt);
  const turns = held?.modelCalls ?? generationBlockTurnsPerSlice();
  return Math.max(1, Math.min(GENERATION_SLICE_POLICY.maxBlockTurnsPerSlice, turns));
}
/** The first user message of a checkpoint's conversation, without a compaction note. */
function checkpointPrompt(checkpoint: BuildLoopCheckpoint): string {
  const first = checkpoint.messages[0]!.content;
  if (typeof first === "string") return first;
  const part = first[0];
  return part && part.type === "text" ? part.text : "";
}
/** One activity line for the turn a boundary just completed (display data: counts and server words, the model's query bounded). */
function turnLine(blockName: string, checkpoint: BuildLoopCheckpoint): string {
  const messages = checkpoint.messages, assistant = messages[messages.length - 2], answer = messages[messages.length - 1];
  if (!assistant || !answer || !Array.isArray(assistant.content) || !Array.isArray(answer.content)) return `${blockName}: turn ${checkpoint.turnsUsed} complete`;
  const parts: string[] = [];
  for (const call of assistant.content) {
    if (call.type !== "tool_call") continue;
    const result = answer.content.find((part) => part.type === "tool_result" && part.toolCallId === call.id);
    if (call.name === "search_parts") {
      let found = "?";
      try { const parsed: unknown = JSON.parse(result && result.type === "tool_result" ? result.output : "null"); found = String(Array.isArray(parsed) ? parsed.length : Array.isArray((parsed as { results?: unknown[] } | null)?.results) ? (parsed as { results: unknown[] }).results.length : "?"); } catch { found = "?"; }
      parts.push(`checked catalog candidates for ${quotedQuery(String(call.input.query ?? ""))} (${found} found)`);
    } else if (call.name === "find_alternates") parts.push("looked up alternates");
    else if (call.name === "submit_schematic") parts.push(result && result.type === "tool_result" && result.isError ? "submission returned for correction" : "submitted");
  }
  if (!parts.length) parts.push("asked to submit");
  return `${blockName}: ${parts.join("; ")}`;
}

const NO_TURNS = { usage: { modelCalls: 0, uncertainModelCalls: 0, inputTokens: 0, outputTokens: 0, catalogSearches: 0, alternatesLookups: 0 } } as const;
/** The slice's whole spend so far: the core's turns, the seed's calls, the catalog port's work. */
function spendOf(run: { usage: BlockSliceOutcome["usage"] | BlockSliceTurn["usage"] }, seedLlm: MeteredLlmPort, coreLlm: MeteredLlmPort, catalog: FactsCatalogPort): SliceSpend {
  const seed = seedLlm.spend();
  return {
    ...zeroSpend(), ...catalog.spend(),
    modelCalls: run.usage.modelCalls + seed.modelCalls, uncertainModelCalls: run.usage.uncertainModelCalls + seed.uncertainModelCalls, admissionRefusals: coreLlm.admissionRefusals,
    inputTokens: run.usage.inputTokens + seed.inputTokens, outputTokens: run.usage.outputTokens + seed.outputTokens,
  };
}

async function runDesignSlice(ctx: SliceContext): Promise<GenerationSliceReport> {
  const { store, lease, task } = ctx;
  const blockId = lease.blockId!;
  const state: GenerationBlockState = task.blocks[blockId]!;
  const planned = plannedBlockOf(task, blockId);
  const base = blockDesignRequest(task.request.prompt, planned);
  const facts = await store.readFacts(lease.scope, task);
  const catalog = new FactsCatalogPort(ctx.ports.catalog, facts, blockId, ctx.clock);
  const seedLlm = new MeteredLlmPort(ctx.ports.llm, ctx.ports.admission), coreLlm = new MeteredLlmPort(ctx.ports.llm, ctx.ports.admission);
  const meter = new SliceMeter();
  const previous = await store.readBlock(lease.scope, task, blockId);
  const claim = strategyAtClaim(state);
  const strategy = claim.strategy;
  let history = state.strategyHistory.map((entry) => ({ ...entry }));
  let stagnantSlices = claim.restartedFrom ? 0 : state.stagnantSlices, lastKey = claim.restartedFrom ? null : state.lastProgressKey;
  const pendingMilestones: GenerationTaskEventDraft[] = claim.restartedFrom
    ? [generationTaskEvent("strategy_changed", { at: isoOf(ctx.clock()), phase: "designing", blockId, message: `Retrying block "${state.name}" with strategy ${strategy} after ${claim.restartedFrom}.`, data: { from: claim.restartedFrom, to: strategy } })]
    : [];
  let maxTurns = reservedTurns(task, lease);
  const windowDeadlineAt = Date.now() + ctx.windows.blockWindowMs;
  // S6 runs no conversation: a block found there (a history whose S6 entry is not the last) is judged again, with zero model calls
  if (strategy === "S6-missing-part") {
    const withNothing = (payload: GenerationSliceEnd): GenerationSliceEnd => ({ ...payload, milestones: [...pendingMilestones, ...(payload.milestones ?? [])] });
    return advanceStrategy(ctx, { state, strategy, history, lastKey, turnsUsed: state.turnsUsed, learning: blockLearning(previous), withFacts: withNothing, cause: "stagnant" });
  }

  // the conversation this slice continues or begins
  let checkpoint = previous && previous.strategy === strategy ? previous : null;
  let block: BuildLoopBlock = { ...base, allowEmpty: false };
  if (strategy !== "S1-baseline") {
    // resume the seeded conversation this strategy began (its first message IS the seed; the store verified the record is this block's)
    if (checkpoint) block = { systemPrompt: base.systemPrompt, userMessage: checkpointPrompt(checkpoint), allowEmpty: false };
    else {
      checkpoint = null;
      let seeded: Awaited<ReturnType<typeof seedConversation>>;
      try {
        seeded = await withinBuildBoundary(windowDeadlineAt, ctx.supervisor.signal, (signal) => seedConversation({ strategy, base, learning: blockLearning(previous), catalog, seedLlm, provider: task.request.provider, signal, maxTurns }));
      } catch (error) {
        if (error instanceof BuildBoundaryError && error.kind === "cancelled") return stopped(ctx, meter.peek(spendOf(NO_TURNS, seedLlm, coreLlm, catalog)));
        if (error instanceof BuildBoundaryError) { // the seeding outlived the window: try again next slice (nothing of it is lost: the facts are kept)
          const usage = meter.peek(spendOf(NO_TURNS, seedLlm, coreLlm, catalog));
          return end(ctx, { usage, facts: catalog.takeDelta(), block: { status: "queued" }, schedule: [{ kind: "block", blockId }] }, "yielded", `seeding ${strategy} reached the slice window; it continues in the next slice`);
        }
        throw error;
      }
      if (seeded.providerError) return endSeedProviderError(ctx, seeded.providerError, meter.peek(spendOf(NO_TURNS, seedLlm, coreLlm, catalog)), catalog, state);
      block = seeded.block;
      maxTurns = Math.max(1, maxTurns - seedLlm.started);
    }
  }

  // the slice's turns
  let boundaryStop: "cancel" | "yield" | null = null, boundaries = 0; // why the slice yielded at a boundary on the supervisor's word
  const onTurn = async (turn: BlockSliceTurn): Promise<void | "yield"> => {
    const verdict = await ctx.supervisor.boundary();
    if (verdict === "fenced") throw new SliceFencedError();
    if (verdict === "cancel") { boundaryStop = "cancel"; return "yield"; }
    boundaries += 1;
    const spend = spendOf(turn, seedLlm, coreLlm, catalog), usage = meter.peek(spend), factsDelta = catalog.takeDelta();
    const milestones = pendingMilestones.splice(0);
    const delta = { checkpoint: turn.checkpoint, block: { turnsUsed: state.turnsUsed + turn.turns, strategy, status: "designing" as const }, usage, ...(milestones.length ? { milestones } : {}) };
    const committed = await withFactsFallback(ctx, factsDelta ? { facts: factsDelta } : {}, (attempt) => store.checkpointSlice(lease, boundaries, { ...delta, ...attempt }));
    if (!committed.ok) {
      catalog.restore(factsDelta);
      pendingMilestones.unshift(...milestones);
      if (committed.code === "GENERATION_SLICE_FENCED") throw new SliceFencedError();
      if (committed.code === "GENERATION_TASK_CANCEL_REQUESTED") { boundaryStop = "cancel"; return "yield"; }
      throw new SliceCommitError(committed.code, committed.issue);
    }
    meter.mark(spend);
    await store.writeActivity(lease, turnLine(state.name, turn.checkpoint)).catch(() => undefined); // display only
    if (verdict === "yield") { boundaryStop = "yield"; return "yield"; }
    return undefined;
  };
  const identity = { taskId: lease.taskId, blockId, sliceId: lease.sliceId, attempt: lease.attempt, fence: lease.fence, strategy };
  const policy = { maxTurns, windowDeadlineAt, perCallMs: ctx.windows.perCallMs, minTurnStartMs: ctx.windows.minTurnStartMs };
  const outcome = strategy === "S1-baseline"
    ? await designBlockSlice({ prompt: task.request.prompt, block: planned, checkpoint, identity, policy, provider: task.request.provider, signal: ctx.supervisor.signal, llm: coreLlm, catalog, now: ctx.clock, onTurn })
    : await runBlockSlice({ block, checkpoint, identity, policy, signal: ctx.supervisor.signal, provider: task.request.provider, llm: coreLlm, catalog, now: ctx.clock, onTurn });

  const usage = meter.peek(spendOf(outcome, seedLlm, coreLlm, catalog));
  const factsDelta = catalog.takeDelta();
  const now = ctx.clock(), at = isoOf(now), turnsUsed = state.turnsUsed + outcome.turns;
  const withFacts = (payload: GenerationSliceEnd): GenerationSliceEnd => ({ ...payload, usage, ...(factsDelta ? { facts: factsDelta } : {}), milestones: [...pendingMilestones, ...(payload.milestones ?? [])] });

  if (boundaryStop === "cancel" || (outcome.status === "cancelled" && ctx.supervisor.stopReason() === "cancel")) return settleCancel(ctx, usage);
  switch (outcome.status) {
    case "submitted": {
      history = historyClosed(historyWithSlice(history, strategy), strategy, "succeeded");
      const patch: GenerationBlockPatch = { status: "saved", turnsUsed, strategy, strategyHistory: history, stagnantSlices: 0, lastProgressKey: outcome.progress.key, blocker: null };
      const saved = generationTaskEvent("block_saved", { at, phase: "designing", blockId, message: `Saved block "${state.name}" (${Object.keys(outcome.checkpoint.surfaced).length} catalog parts).`, data: { turnsUsed, partsSurfaced: Object.keys(outcome.checkpoint.surfaced).length } });
      return endSaved(ctx, withFacts({ checkpoint: outcome.checkpoint, block: patch, milestones: [saved] }), state.name);
    }
    case "cancelled":
      return stopped(ctx, usage);
    case "yielded": {
      if (outcome.turns === 0 && outcome.reason !== "requested") {
        return end(ctx, withFacts({ block: { status: "queued", strategy }, schedule: [{ kind: "block", blockId }] }), "yielded", `${strategy}: the slice window left no room for a turn; continued in the next slice`);
      }
      history = outcome.turns > 0 ? historyWithSlice(history, strategy) : history;
      const yielded = generationTaskEvent("slice_yielded", { at, phase: "designing", blockId, message: `Block "${state.name}": ${outcome.turns} turn(s) this slice; the design continues in the next slice.`, data: { sliceKind: "block", turns: outcome.turns } });
      if (outcome.reason === "requested") {
        // a pause or a worker shutdown: the checkpoint is committed; the continuation is scheduled (a paused task schedules nothing)
        return end(ctx, withFacts({ block: { status: "queued", turnsUsed, strategy, strategyHistory: history, stagnantSlices, lastProgressKey: lastKey }, schedule: [{ kind: "block", blockId }], milestones: [yielded] }), "yielded", `yielded at a turn boundary (${ctx.supervisor.stopReason() ?? "pause or shutdown"})`);
      }
      const verdict = judgeSliceProgress({ stagnantSlices, lastProgressKey: lastKey, strategy, progress: outcome.progress, stagnantSlicesPerStrategy: ctx.windows.stagnantSlicesPerStrategy });
      stagnantSlices = verdict.stagnantSlices;
      lastKey = verdict.lastProgressKey;
      if (!verdict.change) {
        return end(ctx, withFacts({ block: { status: "queued", turnsUsed, strategy, strategyHistory: history, stagnantSlices, lastProgressKey: lastKey }, schedule: [{ kind: "block", blockId }], milestones: [yielded] }), "yielded", `${outcome.turns} turn(s) under ${strategy}${verdict.stagnant ? ` (no new progress: ${stagnantSlices}/${ctx.windows.stagnantSlicesPerStrategy})` : ""}; continued in the next slice`);
      }
      return advanceStrategy(ctx, { state, strategy, history, lastKey, turnsUsed, learning: blockLearning(outcome.checkpoint), withFacts, cause: "stagnant" });
    }
    case "provider_waiting": {
      const consecutive = consecutiveProviderWaits(task, blockId) + 1;
      const admission = outcome.reason === "rate_limit" && coreLlm.lastWasAdmissionRefusal; // the meters refused the call: nothing was sent
      const wait = providerWait({ reason: outcome.reason, retryAfterMs: outcome.retryAfterMs, admission, consecutive, random: ctx.random, now });
      const waiting = generationTaskEvent("waiting_provider", { at, phase: "designing", blockId, message: `Block "${state.name}" waits for the model provider (${wait.waitingReason}); it continues automatically.`, data: { reason: wait.waitingReason, retryAt: wait.notBefore } });
      history = outcome.turns > 0 ? historyWithSlice(history, strategy) : history;
      return end(ctx, withFacts({ block: { status: "queued", turnsUsed, strategy, strategyHistory: history }, schedule: [{ kind: "block", blockId, notBefore: wait.notBefore }], waitingReason: wait.waitingReason, milestones: [waiting] }), "waiting_provider", `waits for the provider (${outcome.reason}) until ${wait.notBefore}`);
    }
    case "provider_failed":
      return endProviderFailure(ctx, new LLMProviderError(outcome.provider, outcome.reason), usage, catalog, state, { withFacts, turnsUsed, history: outcome.turns > 0 ? historyWithSlice(history, strategy) : history });
    case "refused": {
      if (outcome.code === "loop_failed") {
        ctx.log(`block slice ${lease.sliceId}: the build loop failed (${cleanLine(outcome.error, 200)}); released for another attempt`);
        return release(ctx, "the build loop failed locally; the slice was released for another attempt");
      }
      // a conversation no checkpoint can hold (or one this strategy cannot continue): the next strategy starts its own conversation
      return advanceStrategy(ctx, { state, strategy, history, lastKey, turnsUsed, learning: blockLearning(outcome.checkpoint ?? previous), withFacts, cause: "unrepresentable" });
    }
  }
}

/** A saved block's end: the merge is scheduled only by the end that sees no other block open (the CAS makes that one commit). */
async function endSaved(ctx: SliceContext, payload: GenerationSliceEnd, name: string): Promise<GenerationSliceReport> {
  const current = await ctx.store.load(ctx.lease.scope, ctx.lease.taskId);
  const othersOpen = current.ok && current.task.plan !== null && current.task.plan.blocks.some((block) => block.blockId !== ctx.lease.blockId && !["saved", "omitted"].includes(current.task.blocks[block.blockId]!.status));
  const first = await withFactsFallback(ctx, payload, (attempt) => ctx.store.endSlice(ctx.lease, { ...payload, facts: attempt.facts, schedule: othersOpen ? [] : "next-work" }));
  if (first.ok) return report(ctx, "saved", first.task.state, `saved block "${name}"`);
  if (first.code === "GENERATION_SLICE_END_INVALID" && othersOpen) {
    // the other open blocks finished meanwhile: this is the last end, so it schedules the merge
    return end(ctx, { ...payload, schedule: "next-work" }, "saved", `saved block "${name}" (the last open block: the merge is scheduled)`);
  }
  if (first.code === "GENERATION_SLICE_FENCED") return report(ctx, "fenced", null, "another owner holds the slice; its late submission was not committed");
  if (first.code === "GENERATION_TASK_CANCEL_REQUESTED") return settleCancel(ctx, payload.usage ?? {});
  throw new SliceCommitError(first.code, first.issue);
}

/** The S5 planner call failed before the conversation began: a transient failure waits and retries this slice's strategy; any other
 *  failure blocks the block like a turn's would. */
async function endSeedProviderError(ctx: SliceContext, error: LLMProviderError, usage: Partial<GenerationTaskUsage>, catalog: FactsCatalogPort, state: GenerationBlockState): Promise<GenerationSliceReport> {
  if (!isRetryableReason(error.reason)) return endProviderFailure(ctx, error, usage, catalog, state, null);
  const blockId = ctx.lease.blockId!, now = ctx.clock();
  const wait = providerWait({ reason: error.reason, retryAfterMs: error.retryAfterMs ?? null, admission: isAdmissionPause(error), consecutive: consecutiveProviderWaits(ctx.task, blockId) + 1, random: ctx.random, now });
  const waiting = generationTaskEvent("waiting_provider", { at: isoOf(now), phase: "designing", blockId, message: `Block "${state.name}" waits for the model provider (${wait.waitingReason}); it continues automatically.`, data: { reason: wait.waitingReason, retryAt: wait.notBefore } });
  const factsDelta = catalog.takeDelta();
  return end(ctx, { usage, ...(factsDelta ? { facts: factsDelta } : {}), block: { status: "queued" }, schedule: [{ kind: "block", blockId, notBefore: wait.notBefore }], waitingReason: wait.waitingReason, milestones: [waiting] }, "waiting_provider", `waits for the provider (${error.reason}) until ${wait.notBefore}`);
}

/** A provider refusal no retry can fix: the block waits for the named resource; finished blocks are untouched. */
async function endProviderFailure(
  ctx: SliceContext, error: LLMProviderError, usage: Partial<GenerationTaskUsage>, catalog: FactsCatalogPort, state: GenerationBlockState,
  extra: { withFacts: (payload: GenerationSliceEnd) => GenerationSliceEnd; turnsUsed: number; history: GenerationBlockState["strategyHistory"] } | null,
): Promise<GenerationSliceReport> {
  const blocker = providerBlockerOf(error.reason);
  ctx.log(`block slice ${ctx.lease.sliceId}: the provider refused (${error.reason}); block "${cleanLine(state.name, 80)}" waits (${blocker})`);
  const payload: GenerationSliceEnd = { block: { status: "blocked", blocker, ...(extra ? { turnsUsed: extra.turnsUsed, strategyHistory: extra.history } : {}) } };
  if (extra) return end(ctx, extra.withFacts(payload), "blocked", `the provider refused (${error.reason}): ${blocker}`);
  const factsDelta = catalog.takeDelta();
  return end(ctx, { ...payload, usage, ...(factsDelta ? { facts: factsDelta } : {}) }, "blocked", `the provider refused (${error.reason}): ${blocker}`);
}

/** The current strategy ends (stagnant, or a conversation no checkpoint can hold): the next rung starts a FRESH conversation in the next
 *  slice; at S6 the block waits for the part its empty searches name (zero model calls), or - with no such evidence - for a person
 *  (`no_progress`). Never an invented part. */
async function advanceStrategy(ctx: SliceContext, input: {
  state: GenerationBlockState; strategy: GenerationStrategyId; history: GenerationBlockState["strategyHistory"]; lastKey: string | null; turnsUsed: number;
  learning: BlockLearning; withFacts: (payload: GenerationSliceEnd) => GenerationSliceEnd; cause: "stagnant" | "unrepresentable";
}): Promise<GenerationSliceReport> {
  const { state, strategy } = input, blockId = ctx.lease.blockId!, at = isoOf(ctx.clock());
  const next = nextStrategyOf(strategy);
  if (next !== null && next !== "S6-missing-part") {
    const history = historyClosed(input.history, strategy, "stagnant");
    const changed = generationTaskEvent("strategy_changed", { at, phase: "designing", blockId, message: `Block "${state.name}" stopped making progress under ${strategy}${input.cause === "unrepresentable" ? " (its conversation could not be stored)" : ""}; trying ${next}.`, data: { from: strategy, to: next } });
    return end(ctx, input.withFacts({ block: { status: "queued", turnsUsed: input.turnsUsed, strategy: next, strategyHistory: history, stagnantSlices: 0, lastProgressKey: null }, schedule: [{ kind: "block", blockId }], milestones: [changed] }), "strategy_changed", `${strategy} -> ${next}`);
  }
  const missing = input.learning.emptySearches;
  if (missing.length > 0) {
    const history = historyClosed(strategy === "S6-missing-part" ? input.history : historyClosed(input.history, strategy, "stagnant"), "S6-missing-part", "exhausted");
    const names = missing.slice(0, 3).map((miss) => `${quotedQuery(miss.query)}${miss.category ? ` (${cleanLine(miss.category, 40)})` : ""}`).join(", ");
    const changed = generationTaskEvent("strategy_changed", { at, phase: "designing", blockId, message: `Block "${state.name}" needs a part the catalog search did not find; it waits for that part instead of guessing one.`, data: { from: strategy, to: "S6-missing-part" } });
    const waiting = generationTaskEvent("waiting_resource", { at, phase: "designing", blockId, message: `Block "${state.name}": no catalog part for ${names}. Add or approve the part, then retry the block.`, data: { code: "missing_part" } });
    return end(ctx, input.withFacts({ block: { status: "blocked", blocker: "missing_part", turnsUsed: input.turnsUsed, strategy: "S6-missing-part", strategyHistory: history, stagnantSlices: 0, lastProgressKey: input.lastKey }, milestones: [changed, waiting] }), "blocked", `missing part: ${names}`);
  }
  const history = historyClosed(input.history, strategy, "exhausted");
  const waiting = generationTaskEvent("waiting_resource", { at, phase: "designing", blockId, message: `Block "${state.name}" stopped making progress under every strategy; change the request or retry the block.`, data: { code: "no_progress" } });
  return end(ctx, input.withFacts({ block: { status: "blocked", blocker: "no_progress", turnsUsed: input.turnsUsed, strategy, strategyHistory: history, lastProgressKey: input.lastKey }, milestones: [waiting] }), "blocked", `no progress after ${strategy}`);
}

/** A fresh conversation for strategy S2-S5: the base request plus a seed built from the block's recorded facts. */
async function seedConversation(input: {
  strategy: GenerationStrategyId; base: { systemPrompt: string; userMessage: string }; learning: BlockLearning; catalog: FactsCatalogPort; seedLlm: MeteredLlmPort;
  provider: GenerationTaskHead["request"]["provider"]; signal: AbortSignal; maxTurns: number;
}): Promise<{ block: BuildLoopBlock; providerError: null } | { block: null; providerError: LLMProviderError }> {
  const { strategy, learning, catalog } = input;
  const seeds = new Map<string, GenerationPartFacts>();
  const addSeeds = (parts: readonly AiPartResult[] | readonly GenerationPartFacts[]) => { for (const part of parts) { const facts = normalizePartFacts(part as GenerationPartFacts); if (!seeds.has(facts.partId)) seeds.set(facts.partId, facts); } };
  const guidance: string[] = [];
  if (strategy === "S3-catalog-guided") {
    const queries = (learning.emptySearches.length ? learning.emptySearches : learning.searches.slice(-4)).slice(0, 4);
    guidance.push(`The catalog's category names (use one of them exactly as search_parts' category, or leave the category out): ${MAIN_CATEGORIES.join(", ")}.`);
    if (queries.length) guidance.push("A catalog-guided re-search of this block's earlier queries (fresh, with the catalog's own category names) found:");
    catalog.bypassCache = true;
    try {
      for (const query of queries) {
        const resolution = resolveMainCategory(query.category);
        let found = await catalog.searchParts(query.query, resolution.applied ?? undefined, 5, { signal: input.signal });
        if (found.length === 0 && resolution.applied) found = await catalog.searchParts(query.query, undefined, 5, { signal: input.signal });
        addSeeds(found);
        guidance.push(`- ${quotedQuery(query.query)}${resolution.applied ? ` in ${resolution.applied}` : " (no category)"}: ${found.length} part(s)${found.length ? ` - ${found.map((part) => part.partId).join(", ")}` : ""}`);
      }
    } finally {
      catalog.bypassCache = false;
    }
  } else if (strategy === "S4-alternates-guided") {
    const targets = learning.rejectedPartIds.length ? learning.rejectedPartIds : learning.surfaced.filter((part) => part.lifecycleStatus !== "active").map((part) => part.partId);
    const chosen = (targets.length ? targets : learning.surfaced.slice(-3).map((part) => part.partId)).slice(0, 4);
    if (chosen.length) guidance.push("Catalog alternates for the parts earlier submissions were rejected with (or that are not in active production):");
    for (const partId of chosen) {
      const alternates = await input.catalog.findAlternates(partId, "all", 5, { signal: input.signal });
      const parts = alternates.length ? await input.catalog.partsByIds(alternates.map((entry) => entry.partId)) : [];
      addSeeds(parts);
      guidance.push(`- alternates for ${partId}: ${parts.length ? parts.map((part) => part.partId).join(", ") : "none in the catalog"}`);
    }
  } else if (strategy === "S5-block-split") {
    if (input.maxTurns >= 2) {
      const plan = await planGeneration({ prompt: input.base.userMessage, provider: input.provider, signal: input.signal, llm: input.seedLlm, maxBlocks: 4 });
      if (plan.kind === "provider_error") return { block: null, providerError: plan.error };
      if (plan.kind === "planned" && plan.plan.blocks.length > 1) {
        guidance.push("Design this block as these sub-functions, one at a time, then submit them together in ONE submit_schematic:");
        plan.plan.blocks.forEach((sub, index) => guidance.push(`${index + 1}. ${quotedQuery(sub.name)}: ${quotedQuery(sub.brief)}${sub.sharedNets.length ? ` (nets ${sub.sharedNets.slice(0, 8).map((net) => quotedQuery(net)).join(", ")})` : ""}`));
      } else guidance.push("The block could not be split into smaller sub-functions; design it one function at a time and submit the whole block once.");
    } else guidance.push("Design this block one function at a time (for example the main part first, then its support parts) and submit the whole block once.");
  }
  addSeeds(learning.surfaced.slice(-24));
  const seedParts = [...seeds.values()].slice(0, 24);
  const text = strategySeedText({ strategy, learning, seedParts, guidance });
  return { block: { systemPrompt: input.base.systemPrompt, userMessage: `${input.base.userMessage}\n\n${text}`, seedParts: seedParts as AiPartResult[], allowEmpty: false }, providerError: null };
}

// ─── merge ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The identity facts a saved netlist depends on (pins, name, MPN, category); the search similarity and the lifecycle read are not. */
const identityOf = (part: GenerationPartFacts) => JSON.stringify([part.partId, part.name, part.mpn, part.mainCategory, part.pins.map((pin) => [pin.number, pin.name, pin.type])]);

async function runMergeSlice(ctx: SliceContext): Promise<GenerationSliceReport> {
  const { store, lease, task } = ctx;
  const plan = task.plan!;
  const open = plan.blocks.filter((block) => !["saved", "omitted"].includes(task.blocks[block.blockId]!.status));
  if (open.length) return end(ctx, { schedule: "next-work" }, "yielded", "a block is still open; its design is scheduled before the merge");
  const savedBlocks = plan.blocks.filter((block) => task.blocks[block.blockId]!.status === "saved");
  const omitted = plan.blocks.filter((block) => task.blocks[block.blockId]!.status === "omitted").map((block) => block.name);
  const at = () => isoOf(ctx.clock());
  const started = await store.checkpointSlice(lease, 0, { milestones: [generationTaskEvent("merge_started", { at: at(), phase: "merging", message: `Merging ${savedBlocks.length} saved block(s) and checking the result.`, data: { blocks: savedBlocks.length } })] });
  if (!started.ok) {
    if (started.code === "GENERATION_SLICE_FENCED") throw new SliceFencedError();
    if (started.code === "GENERATION_TASK_CANCEL_REQUESTED") return settleCancel(ctx, {});
    throw new SliceCommitError(started.code, started.issue);
  }
  let merged: Awaited<ReturnType<typeof mergeSaved>>;
  try {
    merged = await withinBuildBoundary(Date.now() + ctx.windows.mergeWindowMs, ctx.supervisor.signal, () => mergeSaved(ctx, savedBlocks, omitted));
  } catch (error) {
    if (error instanceof BuildBoundaryError && error.kind === "cancelled") return stopped(ctx, {});
    if (error instanceof BuildBoundaryError) return release(ctx, "the merge outlived its window (a catalog read did not answer); it is retried");
    throw error;
  }
  if (merged.kind === "stale-facts") {
    const names = merged.blocks.join(", ");
    const event = generationTaskEvent("validation_result", { at: at(), phase: "validating", message: `The catalog facts of ${names} changed since the block was saved; the design waits for the parts to be revalidated.`, data: { erc: "not_run", critical: 0, warnings: 0, sharedNetFindings: 0 } });
    return end(ctx, { blocker: "missing_evidence", milestones: [event] }, "blocked", `catalog facts changed for ${names}`);
  }
  if (merged.kind === "refused") return end(ctx, { blocker: "missing_evidence" }, "blocked", merged.error);
  const { result } = merged;
  const erc = result.electricalCheck;
  const validation = generationTaskEvent("validation_result", {
    at: at(), phase: "validating",
    message: erc.state === "passed" ? "The merged design passed the electrical check." : erc.state === "findings" ? `The electrical check reported ${erc.criticalCount} critical finding(s) and ${erc.warningCount} warning(s).` : `The electrical check did not run: ${erc.reason}`,
    data: { erc: erc.state, critical: erc.state === "passed" || erc.state === "findings" ? erc.criticalCount : 0, warnings: erc.state === "passed" || erc.state === "findings" ? erc.warningCount : 0, sharedNetFindings: result.sharedNets.findings.length },
  });
  const ready = generationTaskEvent("result_ready", { at: at(), phase: "review", message: result.status === "complete" ? "A complete design is ready for review." : `A partial design is ready for review (${result.omittedBlocks.length} block(s) omitted).`, data: { status: result.status, omitted: result.omittedBlocks.length } });
  return end(ctx, { result, milestones: [validation, ready] }, "result", `${result.status} result ${result.resultDigest}`);
}

async function mergeSaved(ctx: SliceContext, savedBlocks: NonNullable<GenerationTaskHead["plan"]>["blocks"], omitted: string[]) {
  const { store, lease, task } = ctx;
  const checkpoints: Array<{ blockId: GenerationBlockId; name: string; sharedNets: string[]; checkpoint: BuildLoopCheckpoint; ref: { recordId: string; recordDigest: string } }> = [];
  for (const block of savedBlocks) {
    const checkpoint = await store.readBlock(lease.scope, task, block.blockId);
    const ref = task.blocks[block.blockId]!.artifactRef;
    if (!checkpoint?.result || !ref) throw new GenerationTaskContractError("GENERATION_TASK_RECORD_MISMATCH", "a saved block has no saved result");
    checkpoints.push({ blockId: block.blockId, name: block.name, sharedNets: block.sharedNets, checkpoint, ref });
  }
  // revalidate the facts each saved netlist relied on (the parts it uses), against the catalog as it is now
  const used = new Map<string, string[]>();
  for (const entry of checkpoints) for (const component of entry.checkpoint.result!.netlist.components) used.set(component.partId, [...(used.get(component.partId) ?? []), entry.name]);
  const fresh = new Map((await ctx.ports.catalog.partsByIds([...used.keys()])).map((part) => [part.partId, normalizePartFacts(part as GenerationPartFacts)] as const));
  const stale = new Set<string>();
  for (const entry of checkpoints) {
    for (const component of entry.checkpoint.result!.netlist.components) {
      const saved = entry.checkpoint.surfaced[component.partId]?.part, now = fresh.get(component.partId);
      if (!saved || !now || identityOf(saved) !== identityOf(now)) stale.add(entry.name);
    }
  }
  if (stale.size) return { kind: "stale-facts" as const, blocks: [...stale] };
  const budget = (): BuildBudgetReport => ({ iterationCap: task.allowance.unit.modelCalls * task.allowance.units, iterationsUsed: task.usage.modelCalls, deadlineMs: task.allowance.unit.wallClockMs * task.allowance.units, elapsedMs: Math.max(0, ctx.clock() - Date.parse(task.createdAt)), concurrencyCap: BUILD_BUDGET.concurrencyCap });
  const merged = await mergeAndValidate({
    designed: checkpoints.map((entry) => ({ name: entry.name, netlist: entry.checkpoint.result!.netlist, sharedNets: entry.sharedNets })),
    omittedBlocks: omitted, rationale: task.plan!.rationale, planner: task.plan!.planner, budget, emptyBlocks: "refuse",
    partsByIds: (ids) => ctx.ports.catalog.partsByIds(ids),
  });
  if (merged.kind === "refused") return { kind: "refused" as const, error: merged.error };
  const result = buildGenerationTaskResult({
    taskId: task.taskId, at: isoOf(ctx.clock()), status: omitted.length ? "partial" : "complete", omittedBlocks: omitted,
    netlist: merged.body.netlist, explanation: merged.body.explanation, electricalCheck: merged.body.electricalCheck, planner: merged.body.planner,
    sharedNets: merged.sharedNets, blocks: checkpoints.map((entry) => ({ blockId: entry.blockId, recordId: entry.ref.recordId, recordDigest: entry.ref.recordDigest })),
  });
  return { kind: "merged" as const, result };
}
