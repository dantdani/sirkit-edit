/**
 * [PR-J, 2026-11-04] Runbook J.7, increment J7-2's review (multi-sheet/workload-limits.md, "J7-2, allowance contention"): the confirmed
 * findings of the J7-2 review, each a case that is red without its fix - over the PRODUCTION `GenerationTaskStore` (its claims, ends,
 * admissions and releases called directly, a slice at a time, so every interleaving is exact) and, for R1, the production worker and slice
 * runner with a scripted provider.
 *
 *  C1  a woken waiter whose re-claim is a genuine exhaustion beside a sibling's provider-delayed slice parks, and the head takes it: the
 *      claimer never asks for `queued -> waiting-for-provider` (no rule), so no slice is left pending without an outbox event;
 *  C1b a refusal commit the head did not take (here: it stayed contended) is judged again with its event kept, never completed beside a
 *      pending slice;
 *  C2  a slice whose earlier attempt lapsed, re-delivered while only live siblings' reservations fill the allowance, re-queues (its lapsed
 *      reservation stays charged as uncertain) instead of parking;
 *  C3  a waiter that was claimed and handed back for takeover is not shown as waiting for a running block's allowance;
 *  R2  a sibling that ends completely while a claim (or an admission) reads liveness is never taken for a lapsed holder: the claim is
 *      judged again and runs, the admission is judged again and admits;
 *  T1  the consecutive re-queue count climbs 1..12 with the deterministic waits, and the 13th parks `allowance_exhausted` - at the claim and
 *      at the pre-call admission;
 *  T2  beside a live sibling, a claim whose own need does not fit even without the sibling's reservation parks (the fit re-check), and an
 *      admission whose committed input minus the sibling's bound still passes the limit is EXHAUSTED (not CONTENDED);
 *  R1  a block on a seeded strategy (S5's planner call; a retry's restarted S2) whose first core call is contended keeps its seeded
 *      conversation: the next claim resumes it - the seed is not paid again, the restart milestone not said again.
 *
 * Fixture proof only: the in-memory durable repository, a simulated clock and (R1) a scripted provider. No paid call, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import type { DurableCommitRequest, DurableCommitResult, DurableOutboxEvent, DurableOutboxState, DurableWorkflowScope } from "../../durable-workflow/types";
import type { LLMRequest, LLMResponse } from "../../llm/types";
import type { BuildLlmPort } from "../../schematic/build-loop-slice";
import {
  GENERATION_ALLOWANCE_WAIT, GENERATION_SLICE_TOPIC, GENERATION_TASK_ALLOWANCE_UNIT, generationAllowanceLimits, generationAllowanceWaitMs, generationCommitted,
  type GenerationAllowanceUnit, type GenerationStrategyHistoryEntry, type GenerationTaskHead, type GenerationTaskUsage,
} from "../contracts";
import { buildGenerationTaskSnapshot } from "../snapshot";
import type { GenerationClaimOutcome, GenerationSliceLease, GenerationSliceRevalidator } from "../store";
import { isoOf, type GenerationBlockId } from "../vocabulary";
import { generationRequestInputBound } from "../worker/accounting";
import { DRONE_BLOCKS, ScriptedModel, droneCatalog, droneScripts, head, l3Env, planReply, settle, startTask, type L3Env } from "./_l3-worker-fixtures";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const OK: GenerationSliceRevalidator = async () => ({ ok: true });
type Claimed = Extract<GenerationClaimOutcome, { outcome: "claimed" }>;
const unitOf = (patch: Partial<GenerationAllowanceUnit>): GenerationAllowanceUnit => ({ ...GENERATION_TASK_ALLOWANCE_UNIT, ...patch });

/** A repository whose next `conflicts` commits under an idempotency key ending in `suffix` meet a compare-and-set conflict, and whose next
 *  `listOutbox` runs `onList` first (a sibling ending exactly while liveness is read). */
class SeamRepository extends InMemoryDurableWorkflowRepository {
  conflicts = 0;
  suffix = ":refuse";
  onList: (() => Promise<void>) | null = null;
  override async commit<TResult extends object = Record<string, unknown>>(request: DurableCommitRequest<TResult>): Promise<DurableCommitResult<TResult>> {
    if (this.conflicts > 0 && request.idempotencyKey.endsWith(this.suffix)) { this.conflicts -= 1; throw new Error("DW_OPTIMISTIC_REVISION_CONFLICT"); }
    return super.commit<TResult>(request);
  }
  override async listOutbox(input: { scope?: DurableWorkflowScope; scopeKey?: string; state?: DurableOutboxState; topic?: string; eventType?: string } = {}): Promise<DurableOutboxEvent[]> {
    const hook = this.onList;
    if (hook) { this.onList = null; await hook(); }
    return super.listOutbox(input);
  }
}

/** A task planned (through the store, one slice at a time) as the drone's first `blocks` blocks, the plan's usage as given. */
async function planned(name: string, unit: GenerationAllowanceUnit, options: { blocks?: number; planUsage?: Partial<GenerationTaskUsage>; repository?: SeamRepository } = {}) {
  const repository = options.repository ?? new SeamRepository();
  const env = l3Env({ name, repository, catalog: droneCatalog() });
  const task = await startTask(env, { allowanceUnit: unit });
  const [plan] = leasesOf(await claim(env, "w-plan", 1));
  const blocks = DRONE_BLOCKS.slice(0, options.blocks ?? 3);
  const ended = await env.store.endSlice(plan!, {
    plan: { planner: { state: "planned", blocks: blocks.length }, rationale: "The drone's subsystem blocks.", assumptions: [], blocks: blocks.map((block) => ({ name: block.name, brief: block.brief, sharedNets: [...block.sharedNets] })) },
    usage: { modelCalls: 1, ...(options.planUsage ?? {}) }, schedule: "next-work",
  });
  expect(ended.ok, JSON.stringify(ended)).toBe(true);
  return { env, repository, taskId: task.taskId };
}
const claim = (env: L3Env, workerId: string, limit: number, revalidate: GenerationSliceRevalidator = OK): Promise<GenerationClaimOutcome[]> => env.store.claimSlices({ workerId, limit, revalidate });
function leasesOf(outcomes: readonly GenerationClaimOutcome[]): GenerationSliceLease[] {
  return outcomes.map((outcome) => { expect(outcome.outcome, JSON.stringify(outcome)).toBe("claimed"); return (outcome as Claimed).lease; });
}
/** Let simulated time reach `at` in steps shorter than a lease, renewing `live` at each step (a sibling that keeps running without ending). */
async function until(env: L3Env, at: number, live: readonly GenerationSliceLease[]): Promise<void> {
  while (env.time.now() < at) {
    env.time.jump(Math.min(at, env.time.now() + 30_000));
    for (const lease of live) expect((await env.store.renewSlice(lease)).ok).toBe(true);
  }
}
const entriesOf = (task: GenerationTaskHead, block: GenerationBlockId | null) => Object.entries(task.pending).filter(([, entry]) => entry.blockId === block);
const waiterOf = (task: GenerationTaskHead, block: GenerationBlockId | null) => { const found = entriesOf(task, block); expect(found, JSON.stringify(task.pending)).toHaveLength(1); return found[0]!; };
/** Every pending slice has an outbox event that can still deliver it (pending or processing): nothing is pending without its event. */
async function orphans(env: L3Env, task: GenerationTaskHead): Promise<string[]> {
  const events = (await env.repository.listOutbox({ topic: GENERATION_SLICE_TOPIC })).filter((event) => event.state === "pending" || event.state === "processing");
  return Object.keys(task.pending).filter((sliceId) => !events.some((event) => event.payload.sliceId === sliceId));
}

describe("[J7-2 review] the claim's refusal commit", () => {
  it("C1. a woken waiter genuinely exhausted at its re-claim beside a sibling's provider-delayed slice parks, the head takes it, and the task never wedges", async () => {
    // unit 13: P and A hold 6 each; W fits only once they end (1 + 6 = 7)
    const { env, taskId } = await planned("j7-review-c1", unitOf({ modelCalls: 13 }));
    const [p, a] = leasesOf(await claim(env, "w1", 2));
    const [first] = await claim(env, "w2", 1);
    expect(first).toMatchObject({ outcome: "requeued", code: "GENERATION_ALLOWANCE_CONTENDED" }); // W1: contended by P and A
    const wBlock = (["b1", "b2", "b3"] as const).find((block) => block !== p!.blockId && block !== a!.blockId)!;
    expect(waiterOf(await head(env, taskId), wBlock)[1].wait).toEqual({ reason: "allowance", requeues: 1 });
    // P meets a rate_limit: its block is delayed 60 s by the provider; its real end wakes W (due now)
    const delayed = isoOf(env.time.now() + 60_000);
    expect((await env.store.endSlice(p!, { usage: { modelCalls: 1 }, block: { status: "queued" }, schedule: [{ kind: "block", blockId: p!.blockId, notBefore: delayed }], waitingReason: "rate_limit" })).ok).toBe(true);
    const afterP = await head(env, taskId);
    expect(waiterOf(afterP, p!.blockId)[1]).toMatchObject({ notBefore: delayed, providerWait: "rate_limit", owner: null });
    expect(waiterOf(afterP, wBlock)[1].wait).toBeUndefined(); // woken: due now, its count reset
    // W2: contended again (A still holds) - re-queued
    expect(await claim(env, "w2", 1)).toMatchObject([{ outcome: "requeued" }]);
    // A ends (its turns spent 6): its real end wakes W again; the head yields to queued (W due, P delayed)
    expect((await env.store.endSlice(a!, { usage: { modelCalls: 6 }, block: { status: "blocked", blocker: "missing_part" }, schedule: [] })).ok).toBe(true);
    expect((await head(env, taskId)).state).toBe("queued");
    // W4: spent 8 + 6 > 13 with nothing held - a genuine exhaustion; only P's delayed slice remains pending
    const [parked] = await claim(env, "w2", 1);
    expect(parked).toMatchObject({ outcome: "blocked", code: "allowance_exhausted" });
    const after = await head(env, taskId);
    expect(after.blocks[wBlock]).toMatchObject({ status: "blocked", blocker: "allowance_exhausted" });
    expect(entriesOf(after, wBlock)).toEqual([]); // the head took the park: W is no longer pending
    expect(Object.values(after.pending).map((entry) => entry.blockId)).toEqual([p!.blockId]);
    expect(after.state).toBe("queued"); // the claimer has no rule to waiting-for-provider; the liveness reads P's delay
    expect(buildGenerationTaskSnapshot(after, { nowMs: env.time.now(), processing: [] }).liveness).toMatchObject({ state: "scheduled", retryAt: delayed });
    expect(await orphans(env, after)).toEqual([]);
    // P's slice is due and claimed (8 spent: its own 6 do not fit either, so it parks too); the woken waiters' old events are stale. Nothing
    // is left pending: the task waits for a decision with another allowance offered - never wedged in queued
    env.time.jump(Date.parse(delayed));
    const due = await claim(env, "w3", 3);
    expect(due.filter((outcome) => outcome.outcome !== "stale-event")).toMatchObject([{ outcome: "blocked", code: "allowance_exhausted" }]);
    const settled = await head(env, taskId);
    expect(settled).toMatchObject({ state: "waiting-for-resource", pending: {} });
    expect(settled.blocks[p!.blockId!]).toMatchObject({ status: "blocked", blocker: "allowance_exhausted" });
    expect(settled.blocks[wBlock]).toMatchObject({ status: "blocked", blocker: "allowance_exhausted" });
    expect(await orphans(env, settled)).toEqual([]);
  });

  it("C1b. a refusal commit that stays contended is judged again with its event kept: the slice is never left pending without its event", async () => {
    const repository = new SeamRepository();
    const { env, taskId } = await planned("j7-review-c1b", unitOf({ modelCalls: 6 }), { repository, blocks: 1 }); // 1 + 6 > 6: the block's claim is refused
    repository.conflicts = 9; // the refusal commit's compare-and-set loses every one of its 9 tries once
    const [refused] = await claim(env, "w1", 1);
    expect(refused).toMatchObject({ outcome: "blocked", code: "allowance_exhausted" });
    expect(repository.conflicts).toBe(0);
    const after = await head(env, taskId);
    expect(after).toMatchObject({ state: "waiting-for-resource", pending: {}, blocker: { code: "allowance_exhausted" } });
    expect(await orphans(env, after)).toEqual([]);
  });
});

describe("[J7-2 review] a lapsed attempt's own takeover (C2)", () => {
  it("C2. re-delivered while only live siblings' reservations fill the allowance, the slice re-queues; its lapsed reservation stays charged as uncertain", async () => {
    // unit 20, spent 1: A, B and C hold 6 each (19); A#2 needs 6 more (25 > 20), but leaving out live B and C it fits (1 + 6 + 6 = 13)
    const { env, taskId } = await planned("j7-review-c2", unitOf({ modelCalls: 20 }));
    const claimedAt = env.time.now();
    const [a, b, c] = leasesOf(await claim(env, "w1", 3));
    await until(env, claimedAt + 30_000, [b!, c!]); // B and C keep renewing; A's worker is gone
    await until(env, claimedAt + 50_000, [b!, c!]); // A's lease (45 s) lapsed
    const [again] = await claim(env, "w2", 1);
    expect(again).toMatchObject({ outcome: "requeued", code: "GENERATION_ALLOWANCE_CONTENDED" });
    const after = await head(env, taskId);
    expect(after.blocks[a!.blockId!]).toMatchObject({ status: "queued", blocker: null }); // never parked
    const [waiterId, waiter] = waiterOf(after, a!.blockId);
    expect(waiterId).not.toBe(a!.sliceId);
    expect(waiter).toMatchObject({ owner: null, wait: { reason: "allowance", requeues: 1 }, notBefore: isoOf(env.time.now() + generationAllowanceWaitMs(1)) });
    expect(after.reservations.find((entry) => entry.sliceId === a!.sliceId)).toMatchObject({ attempt: 1, state: "uncertain", modelCalls: 6 }); // still charged
    expect(after.reservations.filter((entry) => entry.state === "held").map((entry) => entry.sliceId).sort()).toEqual([b!.sliceId, c!.sliceId].sort());
    expect(generationCommitted(after).modelCalls).toBeLessThanOrEqual(20);
    expect(after.state).toBe("running");
    // the lapsed attempt's late commit is fenced out
    expect(await env.store.endSlice(a!, { usage: { modelCalls: 1 }, block: { status: "queued" }, schedule: [{ kind: "block", blockId: a!.blockId }] })).toMatchObject({ ok: false, code: "GENERATION_SLICE_FENCED" });
  });
});

describe("[J7-2 review] the card for a waiter handed back for takeover (C3)", () => {
  it("C3. a claimed waiter released for takeover keeps its count but is not shown as waiting for a running block's allowance", async () => {
    const { env, taskId } = await planned("j7-review-c3", unitOf({ inputTokens: 1_000 }), { planUsage: { inputTokens: 100 } });
    const [s, x] = leasesOf(await claim(env, "w1", 2));
    expect((await env.store.admitCall(s!, 1, 600)).ok).toBe(true);
    expect(await env.store.admitCall(x!, 1, 600)).toMatchObject({ ok: false, code: "GENERATION_INPUT_ALLOWANCE_CONTENDED" });
    expect((await env.store.endSlice(s!, { usage: { modelCalls: 1, inputTokens: 240 }, block: { status: "queued" }, schedule: [{ kind: "block", blockId: s!.blockId }] })).ok).toBe(true);
    expect((await env.store.endSlice(x!, { block: { status: "queued" }, schedule: [{ kind: "block", blockId: x!.blockId, wait: "allowance" }] })).ok).toBe(true); // no owner left: due now, count 1
    const claimed = leasesOf(await claim(env, "w2", 3));
    const xAgain = claimed.find((lease) => lease.blockId === x!.blockId)!;
    expect((await head(env, taskId)).pending[xAgain.sliceId]).toMatchObject({ state: "running", wait: { reason: "allowance", requeues: 1 } }); // the count rides the claim by design
    expect((await env.store.releaseSlice(xAgain)).ok).toBe(true); // a worker shutdown past its grace hands it back
    const released = await head(env, taskId);
    expect(released.pending[xAgain.sliceId]).toMatchObject({ state: "queued", owner: null, notBefore: released.updatedAt, wait: { requeues: 1 } });
    const snapshot = buildGenerationTaskSnapshot(released, { nowMs: env.time.now(), processing: [] });
    expect(snapshot.plan!.blocks.find((block) => block.blockId === x!.blockId)).not.toHaveProperty("waiting");
    expect(snapshot.plan!.blocks.some((block) => "waiting" in block)).toBe(false);
  });
});

describe("[J7-2 review] liveness read after the head (R2)", () => {
  it("R2a. a sibling that ends completely while a claim reads liveness is not taken for a lapsed holder: the claim is judged again and runs", async () => {
    // unit 12, spent 1: S holds 6; X needs 6 (13 > 12) - once S has ended (spent 3) X fits (9)
    const { env, taskId } = await planned("j7-review-r2a", unitOf({ modelCalls: 12 }));
    const [s] = leasesOf(await claim(env, "w1", 1));
    let hooked = true;
    const revalidate: GenerationSliceRevalidator = async () => {
      if (hooked) { hooked = false; expect((await env.store.endSlice(s!, { usage: { modelCalls: 2 }, block: { status: "queued" }, schedule: [{ kind: "block", blockId: s!.blockId }] })).ok).toBe(true); }
      return { ok: true };
    };
    const [x] = await claim(env, "w2", 1, revalidate);
    expect(hooked).toBe(false);
    expect(x).toMatchObject({ outcome: "claimed" });
    const after = await head(env, taskId);
    expect(Object.values(after.blocks).filter((block) => block!.blocker === "allowance_exhausted")).toEqual([]);
    expect(generationCommitted(after).modelCalls).toBeLessThanOrEqual(12);
  });

  it("R2b. a sibling that ends completely while an admission reads liveness is not taken for a lapsed holder: the admission is judged again and admits", async () => {
    const repository = new SeamRepository();
    const { env, taskId } = await planned("j7-review-r2b", unitOf({ inputTokens: 1_000 }), { repository, planUsage: { inputTokens: 100 } });
    const [s, x] = leasesOf(await claim(env, "w1", 2));
    expect((await env.store.admitCall(s!, 1, 600)).ok).toBe(true); // 700 of 1 000
    repository.onList = async () => { expect((await env.store.endSlice(s!, { usage: { modelCalls: 1, inputTokens: 200 }, block: { status: "queued" }, schedule: [{ kind: "block", blockId: s!.blockId }] })).ok).toBe(true); };
    // X's bound: 100 + 600 (S in flight) + 600 > 1 000 when judged; S ends while liveness is read; then 100 + 200 + 600 = 900 fits
    const admitted = await env.store.admitCall(x!, 1, 600);
    expect(repository.onList).toBeNull();
    expect(admitted, JSON.stringify(admitted)).toMatchObject({ ok: true });
    const after = await head(env, taskId);
    expect(after.reservations.find((entry) => entry.sliceId === x!.sliceId)).toMatchObject({ state: "held", inputTokens: 600 });
    expect(generationCommitted(after).inputTokens).toBeLessThanOrEqual(1_000);
  });
});

describe("[J7-2 review] the wait bound (T1)", () => {
  const expectedWaits = Array.from({ length: GENERATION_ALLOWANCE_WAIT.maxRequeues }, (_, index) => generationAllowanceWaitMs(index + 1));

  it("T1a. at the claim: beside a sibling that keeps running without ending, the count climbs 1..12 with the deterministic waits and the 13th parks", async () => {
    const { env, taskId } = await planned("j7-review-t1a", unitOf({ modelCalls: 12 }), { blocks: 2 }); // S holds 6; X needs 6 (13 > 12)
    const [s] = leasesOf(await claim(env, "w1", 1));
    const counts: number[] = [], waits: number[] = [];
    let xBlock: GenerationBlockId | null = null;
    for (let index = 0; index < GENERATION_ALLOWANCE_WAIT.maxRequeues; index += 1) {
      expect(await claim(env, "w2", 1)).toMatchObject([{ outcome: "requeued", code: "GENERATION_ALLOWANCE_CONTENDED" }]);
      const task = await head(env, taskId);
      xBlock ??= Object.values(task.pending).find((entry) => entry.owner === null)!.blockId;
      const [, waiter] = waiterOf(task, xBlock);
      counts.push(waiter.wait!.requeues);
      waits.push(Date.parse(waiter.notBefore) - env.time.now());
      await until(env, Date.parse(waiter.notBefore), [s!]);
    }
    expect(counts).toEqual(Array.from({ length: GENERATION_ALLOWANCE_WAIT.maxRequeues }, (_, index) => index + 1));
    expect(waits).toEqual(expectedWaits);
    const [parked] = await claim(env, "w2", 1);
    expect(parked).toMatchObject({ outcome: "blocked", code: "allowance_exhausted" });
    const after = await head(env, taskId);
    expect(after.blocks[xBlock!]).toMatchObject({ status: "blocked", blocker: "allowance_exhausted" });
    expect(entriesOf(after, xBlock)).toEqual([]);
    expect(after).toMatchObject({ state: "running" });
    expect(after.pending[s!.sliceId]?.owner).not.toBeNull();
  });

  it("T1b. at the pre-call admission: the count rides each claim, climbs 1..12 with the deterministic waits, and the 13th end parks", async () => {
    const { env, taskId } = await planned("j7-review-t1b", unitOf({ inputTokens: 1_000 }), { blocks: 2, planUsage: { inputTokens: 100 } });
    const [s, first] = leasesOf(await claim(env, "w1", 2));
    expect((await env.store.admitCall(s!, 1, 600)).ok).toBe(true);
    const xBlock = first!.blockId!;
    const counts: number[] = [], waits: number[] = [];
    let x = first!;
    for (let index = 0; index <= GENERATION_ALLOWANCE_WAIT.maxRequeues; index += 1) {
      expect(await env.store.admitCall(x, 1, 600)).toMatchObject({ ok: false, code: "GENERATION_INPUT_ALLOWANCE_CONTENDED" }); // 100 + 600 + 600 > 1 000; 700 without S
      expect((await env.store.endSlice(x, { block: { status: "queued" }, schedule: [{ kind: "block", blockId: xBlock, wait: "allowance" }] })).ok).toBe(true);
      const task = await head(env, taskId);
      if (index === GENERATION_ALLOWANCE_WAIT.maxRequeues) break;
      const [, waiter] = waiterOf(task, xBlock);
      counts.push(waiter.wait!.requeues);
      waits.push(Date.parse(waiter.notBefore) - env.time.now());
      await until(env, Date.parse(waiter.notBefore), [s!]);
      [x] = leasesOf(await claim(env, "w2", 1));
      expect((await head(env, taskId)).pending[x.sliceId]!.wait).toEqual({ reason: "allowance", requeues: index + 1 });
    }
    expect(counts).toEqual(Array.from({ length: GENERATION_ALLOWANCE_WAIT.maxRequeues }, (_, index) => index + 1));
    expect(waits).toEqual(expectedWaits);
    const after = await head(env, taskId);
    expect(after.blocks[xBlock]).toMatchObject({ status: "blocked", blocker: "allowance_exhausted" });
    expect(entriesOf(after, xBlock)).toEqual([]);
    expect(after.state).toBe("running");
  });
});

describe("[J7-2 review] contention or exhaustion beside a live sibling (T2)", () => {
  it("T2a. at the claim: beside a live sibling, a need that does not fit even without the sibling's reservation parks; one that fits re-queues", async () => {
    // the catalog-search dimension: a sibling's turns spent every search while S holds its reservation
    const { env, taskId } = await planned("j7-review-t2a", unitOf({ catalogSearches: 5 }));
    const [s, t] = leasesOf(await claim(env, "w1", 2));
    expect((await env.store.endSlice(t!, { usage: { modelCalls: 1, catalogSearches: 5 }, block: { status: "queued" }, schedule: [{ kind: "block", blockId: t!.blockId }] })).ok).toBe(true);
    const [z] = await claim(env, "w2", 1); // the third block: 5 of 5 searches spent - leaving out S's reservation changes nothing
    expect(z).toMatchObject({ outcome: "blocked", code: "allowance_exhausted" });
    const after = await head(env, taskId);
    const parked = Object.values(after.blocks).filter((block) => block!.blocker === "allowance_exhausted");
    expect(parked).toHaveLength(1);
    expect(Object.values(after.pending).some((entry) => entry.wait !== undefined)).toBe(false); // never re-queued
    expect(after.pending[s!.sliceId]?.owner).not.toBeNull(); // S was live and holding all along
    // the control: model calls, where leaving out S's live reservation does fit, re-queue (C2, T1a)
  });

  it("T2b. at the admission: beside a live sibling's bound, committed input minus that bound still above the limit is EXHAUSTED; within it, CONTENDED", async () => {
    const { env, taskId } = await planned("j7-review-t2b", unitOf({ inputTokens: 1_000 }), { blocks: 2, planUsage: { inputTokens: 700 } });
    const [s, x] = leasesOf(await claim(env, "w1", 2));
    expect((await env.store.admitCall(s!, 1, 200)).ok).toBe(true); // 900 of 1 000
    expect(await env.store.admitCall(x!, 1, 400)).toMatchObject({ ok: false, code: "GENERATION_INPUT_ALLOWANCE_EXHAUSTED" }); // 1 300; 1 100 without S
    expect(await env.store.admitCall(x!, 2, 250)).toMatchObject({ ok: false, code: "GENERATION_INPUT_ALLOWANCE_CONTENDED" }); // 1 150; 950 without S
    const after = await head(env, taskId);
    expect(after.reservations.find((entry) => entry.sliceId === x!.sliceId)?.inputTokens).toBeUndefined(); // a refused admission records nothing
    expect(generationCommitted(after).inputTokens).toBe(900);
  });
});

// ─── R1: a seeded conversation kept across an allowance wait (the production worker and slice runner) ───────────────────────────────────

/** Reports 40 % of each request's bound and records every call's bound by what it was: the plan, a block's sub-plan (S5's seed) or a turn. */
class MeteredModel implements BuildLlmPort {
  readonly calls: Array<{ kind: "plan" | "subplan" | "block"; block: string; turn: number; bound: number; reported: number }> = [];
  constructor(readonly inner: ScriptedModel) {}
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const bound = generationRequestInputBound(request), index = this.inner.calls.length; // the scripted model records the call before its first await
    const response = await this.inner.generate(request);
    const call = this.inner.calls[index]!, reported = Math.floor(bound * 0.4);
    this.calls.push({ kind: call.kind, block: call.block, turn: call.turn, bound, reported });
    return { ...response, usage: { inputTokens: reported, outputTokens: 60 } };
  }
}
function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  return { promise: new Promise<void>((yes) => { resolve = yes; }), resolve };
}
const TWO_BLOCKS = DRONE_BLOCKS.slice(0, 2);
const SUBPLAN = [{ name: "Sensing", brief: "The sensor and its decoupling.", sharedNets: ["+3V3", "GND"] }, { name: "Control", brief: "The controller and its outputs.", sharedNets: ["+3V3", "GND"] }];
const STAGNANT_TO_S5: GenerationStrategyHistoryEntry[] = (["S1-baseline", "S2-fresh-seeded", "S3-catalog-guided", "S4-alternates-guided"] as const).map((id) => ({ id, slices: 3, outcome: "stagnant" }));

/** Two drone blocks; X put on S5 with `history` by an end through the store (as `advanceStrategy` does), due 1 s later. `start()`: a worker
 *  of two slots claims Y, whose first call is then held in the provider (its input bound in flight) until `releaseY`; once that call is
 *  there, X is due and claimed - so X's calls always meet Y's bound. */
async function seededRun(name: string, setup: { history: GenerationStrategyHistoryEntry[]; inputTokens: number }) {
  const env = l3Env({ name, repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
  const scripted = new ScriptedModel({ ...droneScripts(), plan: () => planReply(TWO_BLOCKS), subplan: () => planReply(SUBPLAN) }, env.time, () => 1_000);
  const model = new MeteredModel(scripted);
  const task = await startTask(env, { allowanceUnit: unitOf({ inputTokens: setup.inputTokens }) });
  const worker = env.worker({ llm: model, policy: { concurrency: 2 } });
  await worker.runOnce(); // the plan
  const [x] = leasesOf(await claim(env, "w-setup", 1));
  const xDue = env.time.now() + 1_000;
  expect((await env.store.endSlice(x!, { block: { status: "queued", strategy: "S5-block-split", strategyHistory: setup.history }, schedule: [{ kind: "block", blockId: x!.blockId, notBefore: isoOf(xDue) }] })).ok).toBe(true);
  const planned0 = await head(env, task.taskId);
  const xBlock = x!.blockId!, xName = planned0.blocks[xBlock]!.name, yName = Object.values(planned0.blocks).find((block) => block!.blockId !== xBlock)!.name;
  const releaseY = deferred();
  scripted.intercept = async (_request, kind, block) => { if (kind === "block" && block === yName) await releaseY.promise; return undefined; };
  const start = async (): Promise<void> => {
    void worker.tick();
    await scripted.whenBlockCalls(1); // Y's first call is in the provider, its bound recorded
    env.time.jump(xDue);
    void worker.tick();
  };
  return { env, model, task, worker, xBlock, xName, yName, releaseY, start };
}
/** Settle steps until `done` holds (the slices run concurrently on the simulated clock; no wall-clock deadline). */
async function eventually(done: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let step = 0; step < 5_000; step += 1) { if (await done()) return; await settle(1); }
  throw new Error(`never: ${what}`);
}
const settledAs = (env: L3Env, outcome: string): string[] => env.logs.filter((line) => line.startsWith("settled block slice") && line.includes(`: ${outcome}`));
/** The calibration: the same run with a limit that never binds, both slices to their end; the calls' measured bounds. */
async function calibrate(name: string, history: GenerationStrategyHistoryEntry[]) {
  const run = await seededRun(name, { history, inputTokens: 50_000_000 });
  await run.start();
  await eventually(() => run.model.calls.some((call) => call.kind === "block" && call.block === run.xName), "X's first core call");
  run.releaseY.resolve();
  await eventually(() => run.worker.runningSlices().length === 0, "both slices settled");
  const calls = run.model.calls;
  return {
    spent: calls.find((call) => call.kind === "plan")!.reported,
    y: calls.find((call) => call.kind === "block" && call.block === run.yName)!,
    seed: calls.find((call) => call.kind === "subplan") ?? null,
    core: calls.find((call) => call.kind === "block" && call.block === run.xName)!,
  };
}

describe("[J7-2 review] a seeded conversation kept across an allowance wait (R1)", () => {
  it("R1a. S5: the planner seed is paid once - the contended block's next claim resumes its seeded conversation", { timeout: 60_000 }, async () => {
    const { spent, y, seed, core } = await calibrate("j7-review-r1a-calibration", STAGNANT_TO_S5);
    // a limit that admits the seed beside Y's bound (and again after the first seed's input is settled), then refuses X's first core call
    // only because of Y's bound
    const limit = spent + y.bound + seed!.bound + seed!.reported;
    expect(core.bound, "the core call's bound is larger than the seed's").toBeGreaterThan(seed!.bound);
    expect(seed!.reported + core.bound, "without Y's bound the core call fits").toBeLessThanOrEqual(y.bound + seed!.bound);

    const run = await seededRun("j7-review-r1a", { history: STAGNANT_TO_S5, inputTokens: limit });
    await run.start();
    await eventually(() => settledAs(run.env, "waiting_allowance").length === 1, "X's first allowance wait");
    expect(run.model.calls.filter((call) => call.kind === "subplan")).toHaveLength(1);
    const waited = await head(run.env, run.task.taskId);
    const [, waiter] = waiterOf(waited, run.xBlock);
    expect(waiter.wait).toEqual({ reason: "allowance", requeues: 1 });
    // Y still holds its bound; X's wait ends and it is claimed again
    run.env.time.jump(Date.parse(waiter.notBefore));
    void run.worker.tick();
    await eventually(() => settledAs(run.env, "waiting_allowance").length === 2, "X's second allowance wait");
    expect(run.model.calls.filter((call) => call.kind === "subplan"), "the planner seed was paid again").toHaveLength(1);
    const again = await head(run.env, run.task.taskId);
    expect(again.usage.modelCalls).toBe(2); // the plan and ONE seed (Y's held call is not reported yet; X's core calls were never sent)
    expect(waiterOf(again, run.xBlock)[1].wait).toEqual({ reason: "allowance", requeues: 2 });
    expect(again.blocks[run.xBlock]).toMatchObject({ strategy: "S5-block-split", turnsUsed: 0 });
    expect(again.blocks[run.xBlock]!.artifactRef).not.toBeNull(); // the seeded conversation is the block's checkpoint
    for (const revision of [waited, again]) expect(generationCommitted(revision).inputTokens).toBeLessThanOrEqual(generationAllowanceLimits(revision.allowance).inputTokens!);
    run.releaseY.resolve();
    await run.worker.idle();
  });

  it("R1b. a retry's restarted strategy (S2 after an exhausted S5) begins once: the next claim resumes it - the restart is not said again", { timeout: 60_000 }, async () => {
    const history: GenerationStrategyHistoryEntry[] = [...STAGNANT_TO_S5, { id: "S5-block-split", slices: 3, outcome: "exhausted" }];
    const { spent, y, seed, core } = await calibrate("j7-review-r1b-calibration", history);
    expect(seed).toBeNull(); // S2 seeds from the block's recorded facts: no call
    const limit = spent + y.bound + core.bound - 1; // X's first core call fits alone, not beside Y's bound

    const run = await seededRun("j7-review-r1b", { history, inputTokens: limit });
    const restarts = async (): Promise<number> => (await head(run.env, run.task.taskId)).milestones.filter((event) => event.type === "strategy_changed" && event.blockId === run.xBlock && event.message.startsWith("Retrying block")).length;
    await run.start();
    await eventually(() => settledAs(run.env, "waiting_allowance").length === 1, "X's first allowance wait");
    expect(await restarts()).toBe(1);
    const [, waiter] = waiterOf(await head(run.env, run.task.taskId), run.xBlock);
    run.env.time.jump(Date.parse(waiter.notBefore));
    void run.worker.tick();
    await eventually(() => settledAs(run.env, "waiting_allowance").length === 2, "X's second allowance wait");
    expect(await restarts(), "the restart was said, and its conversation begun, again").toBe(1);
    const again = await head(run.env, run.task.taskId);
    expect(waiterOf(again, run.xBlock)[1].wait).toEqual({ reason: "allowance", requeues: 2 });
    expect(again.blocks[run.xBlock]).toMatchObject({ strategy: "S2-fresh-seeded", stagnantSlices: 0, lastProgressKey: null });
    expect(again.blocks[run.xBlock]!.strategyHistory.at(-1)).toEqual({ id: "S2-fresh-seeded", slices: 1, outcome: "progress" });
    run.releaseY.resolve();
    await run.worker.idle();
  });
});
