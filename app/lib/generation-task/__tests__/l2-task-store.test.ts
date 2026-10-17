/**
 * [PR-L, 2026-10-17] Increment 2 (runbook L.2/L.3; task-worker-contract.md sections 1-3): the generation-task store over the
 * IN-MEMORY durable repository (the fixture runtime's repository). The core properties (A-H) are shared with the PGlite suite
 * (`_l2-store-scenarios.ts`); the control-plane cases (I-P) run here:
 *
 *  A. start/attach idempotency, IDEMPOTENCY_KEY_REUSED, one active task per scope (also under a race), refusals accept nothing;
 *  B. a foreign scope's id, an unknown id and a malformed id are the same refusal;
 *  C. claim/renew/end of slices; a fenced-out writer writes nothing, and a writer fenced out between its block revision and its
 *     head commit appends a revision the head never references;
 *  D. a redelivered (stale) slice event is a no-op; a repeated end answers its replay;
 *  E. an ambiguous commit (transport error after commit) is retried with the same key and applied once;
 *  F. checkpoints, saved blocks and facts survive a restart (a fresh store); a lapsed slice resumes from its checkpoint;
 *  G. S1: a delayed next slice is scheduled atomically and is not claimable before its time;
 *  H. cancellation: owners stop and settle, late results are fenced, a cancelled task is never resumed;
 *  I. pause yields at the boundary and resume schedules FRESH slice ids (old events become stale);
 *  J. invalid transitions and actions are refused with nothing written;
 *  K. a full run to awaiting-review, the review evidence, and a new task after it;
 *  L-N. revocation fails the task; lost workers become platform_failure; the allowance parks the task until extended;
 *  O. ordered events with a durable cursor, and live activity;
 *  P. a blocked block with saved siblings is partial_available: retry-block, then review-partial reaches a partial result.
 *
 * No provider, no database, no network: the in-memory repository and a manual clock.
 */
import { describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { GENERATION_SLICE_TOPIC } from "../contracts";
import { generationTaskEvent } from "../events";
import { GenerationTaskStore, GenerationTaskStoreError, type GenerationSliceLease } from "../store";
import { ALLOW, HEAD_MARK, MOVED_DIGEST, PLAN, SCHEMATIC_DIGEST, T0, checkpointFor, manualClock, resultFor, startInput } from "./_l2-fixtures";
import {
  loaded, plannedTask, scenarioAmbiguousCommits, scenarioCancel, scenarioDelayedSlice, scenarioForeignScope, scenarioRestart, scenarioSlicesAndFencing, scenarioStaleEvents, scenarioStartAndAttach, scopeOf,
  type L2StoreEnv,
} from "./_l2-store-scenarios";

const env: L2StoreEnv = {
  name: "memory",
  repository: () => new InMemoryDurableWorkflowRepository(),
  restarted: async (repository, options) => new GenerationTaskStore({ repository, ...options }),
  quiesce: async () => undefined,
};
const iso = (ms: number) => new Date(ms).toISOString();
const editor = { principalId: "user-l2-editor", role: "pcb_editor" as const };
const SINGLE = { planner: { state: "single" as const, reason: "simple_request" as const }, rationale: "One block.", assumptions: [] as string[], blocks: [{ name: "Main", brief: "The whole circuit", sharedNets: [] as string[] }] };

describe("[PR-L I2] generation-task store (in-memory repository)", () => {
  it("A. start and attach: idempotent by (scope, principal, clientRequestId); a different request digest is refused; one active task per scope", () => scenarioStartAndAttach(env));
  it("B. a foreign scope's task id, an unknown id and a malformed id are the SAME refusal", () => scenarioForeignScope(env));
  it("C. slices: claim, renew and end; a fenced-out writer writes nothing; a late writer's revision is never referenced", () => scenarioSlicesAndFencing(env));
  it("D. a redelivered slice event is a no-op and a repeated end answers its replay", () => scenarioStaleEvents(env));
  it("E. an ambiguous commit is retried with the same key and applied once", () => scenarioAmbiguousCommits(env));
  it("F. checkpoints, saved blocks and facts survive a restart; a lapsed slice resumes from its checkpoint under a newer fence", () => scenarioRestart(env));
  it("G. S1: a delayed slice is scheduled with its checkpoint and is not claimable before its time", () => scenarioDelayedSlice(env));
  it("H. cancel: owners stop and settle, late results are fenced, a cancelled task is never resumed", () => scenarioCancel(env));

  it("I. pause lets running slices finish at a boundary without scheduling more; resume schedules FRESH slice ids and the old events are stale", async () => {
    const { store, scope, taskId, leases } = await plannedTask(env, "i-pause");
    const paused = await store.control({ scope, taskId, principal: editor, action: "pause", clientActionId: "pause-1" });
    expect(paused).toMatchObject({ ok: true, task: { state: "running", control: { pause: { action: "pause" } } } }); // live owners keep running
    // b1 yields at a turn boundary: its checkpoint is kept, its continuation is NOT scheduled
    expect(await store.endSlice(leases.b1, { checkpoint: checkpointFor(leases.b1), block: { turnsUsed: 2 }, schedule: [{ kind: "block", blockId: "b1" }] })).toMatchObject({ ok: true, task: { state: "running" } });
    expect(await store.releaseSlice(leases.b2)).toMatchObject({ ok: true, task: { state: "running" } }); // dropped under the pause
    const last = await store.endSlice(leases.b3, { checkpoint: checkpointFor(leases.b3, { saved: true }), block: { status: "saved", turnsUsed: 2 } });
    expect(last).toMatchObject({ ok: true, task: { state: "paused", pending: {} } });
    if (!last.ok) return;
    expect(last.task.milestones.at(-1)!.type).toBe("paused");
    const before = last.task.nextSliceSeq;
    const resumed = await store.control({ scope, taskId, principal: editor, action: "resume", clientActionId: "resume-1" });
    if (!resumed.ok) throw new Error(resumed.code);
    expect(resumed.task.state).toBe("queued");
    const fresh = Object.entries(resumed.task.pending).map(([sliceId, entry]) => [Number(sliceId.split(":s")[1]), entry.blockId]).sort();
    expect(fresh).toEqual([[before, "b1"], [before + 1, "b2"]]); // the saved b3 is not redone
    const claims = await store.claimSlices({ workerId: "worker-b", limit: 5, revalidate: ALLOW });
    expect(claims.filter((claim) => claim.outcome === "claimed").map((claim) => claim.outcome === "claimed" && claim.lease.blockId).sort()).toEqual(["b1", "b2"]);
    expect(claims.flatMap((claim) => (claim.outcome === "stale-event" ? [claim.eventId] : []))).toEqual([leases.b2.eventId]); // the released old slice
  });

  it("J. invalid transitions and actions are refused, and nothing is written", async () => {
    const repository = new InMemoryDurableWorkflowRepository(), clock = manualClock(), store = new GenerationTaskStore({ repository, clock: clock.now }), scope = scopeOf(env, "j-invalid");
    const started = await store.createOrAttach(startInput({ scope }));
    if (!started.ok) throw new Error(started.code);
    const id = started.task.taskId, control = (action: Parameters<GenerationTaskStore["control"]>[0]["action"], clientActionId: string, extra: object = {}) => store.control({ scope, taskId: id, principal: editor, action, clientActionId, ...extra });
    for (const [action, code] of [["record-review", "GENERATION_TASK_STATE_CONFLICT"], ["resume", "GENERATION_TASK_STATE_CONFLICT"], ["retry-block", "GENERATION_TASK_STATE_CONFLICT"], ["review-partial", "GENERATION_TASK_STATE_CONFLICT"], ["report-base", "GENERATION_TASK_STATE_CONFLICT"], ["rebase", "GENERATION_TASK_ACTION_UNSUPPORTED"], ["start-from-saved", "GENERATION_TASK_ACTION_UNSUPPORTED"]] as const) {
      expect(await control(action, `j-${action}`), action).toMatchObject({ ok: false, code });
    }
    expect(await store.control({ scope, taskId: id, principal: { principalId: "user-l2-viewer", role: "viewer" }, action: "cancel", clientActionId: "j-viewer" })).toEqual({ ok: false, code: "GENERATION_TASK_FORBIDDEN" });
    expect(await control("pause", "j-same-id")).toMatchObject({ ok: true, task: { state: "paused" } });
    expect(await control("cancel", "j-same-id")).toEqual({ ok: false, code: "IDEMPOTENCY_KEY_REUSED" }); // one client action id, one action
    expect(await control("pause", "j-same-id")).toMatchObject({ ok: true, replayed: true });
    expect(await control("resume", "j-resume")).toMatchObject({ ok: true, task: { state: "queued" } });
    expect((await loaded(store, scope, id)).revision).toBe(3);
    // slice ends that would leave the task with nothing to do, or patch what the slice does not own, are refused whole
    clock.advance(1_000);
    const claims = await store.claimSlices({ workerId: "worker-a", limit: 5, revalidate: ALLOW });
    const plan = claims.find((claim) => claim.outcome === "claimed");
    if (plan?.outcome !== "claimed") throw new Error("plan not claimed");
    expect(claims.filter((claim) => claim.outcome === "stale-event")).toHaveLength(1); // the plan slice dropped by the pause
    const revision = (await loaded(store, scope, id)).revision;
    expect(await store.endSlice(plan.lease, { plan: PLAN })).toMatchObject({ ok: false, code: "GENERATION_SLICE_END_INVALID" });
    expect(await store.endSlice(plan.lease, { plan: PLAN, schedule: "next-work", block: { status: "saved" } })).toMatchObject({ ok: false, code: "GENERATION_TASK_STATE_CONFLICT" });
    expect(await store.endSlice(plan.lease, { result: resultFor(id, [{ blockId: "b1", recordId: "durable-record:0123456789abcdef0123456789abcdef", recordDigest: `dw1-${"a".repeat(64)}` }], iso(T0)) })).toMatchObject({ ok: false, code: "GENERATION_SLICE_END_INVALID" });
    expect(await store.endSlice(plan.lease, { plan: { ...PLAN, planner: { state: "single", reason: "no_plan" } } , schedule: "next-work" })).toMatchObject({ ok: false, code: "GENERATION_SLICE_END_INVALID" }); // single = exactly the main block
    expect((await loaded(store, scope, id)).revision).toBe(revision);
    await expect(store.checkpointSlice(plan.lease, 1, { usage: { dollars: 1 } as never })).rejects.toThrow(/usage/);
    expect(() => new GenerationTaskStore({ repository: { ...repository, renewOutboxLease: undefined } as never })).toThrow(GenerationTaskStoreError);
  });

  it("K. a full run reaches awaiting-review with a verified result; the review needs THIS result's digest and, when applied, the post-apply head mark", async () => {
    const { store, scope, taskId, leases } = await plannedTask(env, "k-review");
    for (const block of ["b1", "b2"] as const) expect(await store.endSlice(leases[block], { checkpoint: checkpointFor(leases[block], { saved: true }), block: { status: "saved", turnsUsed: 2 }, milestones: [generationTaskEvent("block_saved", { at: iso(T0 + 2_000), blockId: block, message: `Saved block ${block}.`, data: { turnsUsed: 2, partsSurfaced: 2 } })] })).toMatchObject({ ok: true, task: { state: "running" } });
    const merged = await store.endSlice(leases.b3, { checkpoint: checkpointFor(leases.b3, { saved: true }), block: { status: "saved", turnsUsed: 2 }, schedule: "next-work" });
    expect(merged).toMatchObject({ ok: true, task: { state: "queued" } });
    const [merge] = await store.claimSlices({ workerId: "worker-a", limit: 1, revalidate: ALLOW });
    if (merge?.outcome !== "claimed") throw new Error("merge not claimed");
    expect(merge.lease.kind).toBe("merge");
    const head = merge.task, refs = (["b1", "b2", "b3"] as const).map((block) => ({ blockId: block, ...head.blocks[block]!.artifactRef! }));
    const result = resultFor(taskId, refs, iso(T0 + 3_000));
    const delivered = await store.endSlice(merge.lease, { result });
    if (!delivered.ok) throw new Error(`${delivered.code} ${delivered.issue ?? ""}`);
    expect(delivered.task).toMatchObject({ state: "awaiting-review", phase: "review", result: { resultDigest: result.resultDigest, status: "complete", omittedBlocks: [] } });
    expect(await store.readResult(scope, delivered.task)).toEqual(result);
    expect(await store.control({ scope, taskId, principal: editor, action: "record-review", clientActionId: "review-0", review: { outcome: "discarded", resultDigest: `dw1-${"b".repeat(64)}` } })).toMatchObject({ ok: false, code: "GENERATION_TASK_STATE_CONFLICT" });
    expect(await store.control({ scope, taskId, principal: editor, action: "record-review", clientActionId: "review-1", review: { outcome: "applied", resultDigest: result.resultDigest } })).toMatchObject({ ok: false, code: "GENERATION_TASK_TRANSITION_REFUSED" });
    expect(await store.control({ scope, taskId, principal: editor, action: "pause", clientActionId: "pause-review" })).toMatchObject({ ok: false, code: "GENERATION_TASK_STATE_CONFLICT" });
    expect(await store.control({ scope, taskId, principal: editor, action: "cancel", clientActionId: "cancel-review" })).toMatchObject({ ok: false, code: "GENERATION_TASK_STATE_CONFLICT" });
    expect(await store.control({ scope, taskId, principal: editor, action: "report-base", clientActionId: "base-same", liveBase: { schematicDigest: SCHEMATIC_DIGEST, recipe: "build-pin" } })).toMatchObject({ ok: true, replayed: true, task: { state: "awaiting-review" } }); // an unmoved base changes nothing
    const reviewed = await store.control({ scope, taskId, principal: editor, action: "record-review", clientActionId: "review-2", review: { outcome: "applied", resultDigest: result.resultDigest, headMark: HEAD_MARK } });
    expect(reviewed).toMatchObject({ ok: true, task: { state: "succeeded", review: { outcome: "applied", headMark: HEAD_MARK, principalId: "user-l2-editor" } } });
    expect((await store.loadIndex(scope)).index).toMatchObject({ active: null, recent: [{ taskId, state: "succeeded" }] });
    expect(await store.createOrAttach(startInput({ scope }))).toMatchObject({ ok: true, attached: false });
  });

  it("K2. a result whose base moved is reported stale, never applied over a newer sheet", async () => {
    const { store, scope, taskId, leases } = await plannedTask(env, "k2-stale");
    for (const block of ["b1", "b2"] as const) await store.endSlice(leases[block], { checkpoint: checkpointFor(leases[block], { saved: true }), block: { status: "saved" } });
    await store.endSlice(leases.b3, { checkpoint: checkpointFor(leases.b3, { saved: true }), block: { status: "saved" }, schedule: "next-work" });
    const [merge] = await store.claimSlices({ workerId: "worker-a", limit: 1, revalidate: ALLOW });
    if (merge?.outcome !== "claimed") throw new Error("merge not claimed");
    const result = resultFor(taskId, (["b1", "b2", "b3"] as const).map((block) => ({ blockId: block, ...merge.task.blocks[block]!.artifactRef! })), iso(T0 + 3_000));
    expect(await store.endSlice(merge.lease, { result })).toMatchObject({ ok: true, task: { state: "awaiting-review" } });
    expect(await store.control({ scope, taskId, principal: editor, action: "report-base", clientActionId: "base-other-recipe", liveBase: { schematicDigest: MOVED_DIGEST, recipe: "chat-sheet" } })).toMatchObject({ ok: false, code: "GENERATION_TASK_STATE_CONFLICT" });
    const stale = await store.control({ scope, taskId, principal: editor, action: "report-base", clientActionId: "base-moved", liveBase: { schematicDigest: MOVED_DIGEST, recipe: "build-pin" } });
    expect(stale).toMatchObject({ ok: true, task: { state: "stale", base: { moved: true, schematicDigest: SCHEMATIC_DIGEST } } });
    expect(await store.control({ scope, taskId, principal: editor, action: "record-review", clientActionId: "review-late", review: { outcome: "applied", resultDigest: result.resultDigest, headMark: HEAD_MARK } })).toMatchObject({ ok: false, code: "GENERATION_TASK_STATE_CONFLICT" });
  });

  it("L. a principal revoked while the task was queued fails it at the next claim: no provider call, nothing pending, the scope freed", async () => {
    const repository = new InMemoryDurableWorkflowRepository(), clock = manualClock(), store = new GenerationTaskStore({ repository, clock: clock.now }), scope = scopeOf(env, "l-revoked");
    const started = await store.createOrAttach(startInput({ scope }));
    if (!started.ok) throw new Error(started.code);
    let asked = 0;
    const [claim] = await store.claimSlices({ workerId: "worker-a", limit: 1, revalidate: async () => { asked += 1; return { ok: false, failure: "authority_revoked" }; } });
    expect(claim).toMatchObject({ outcome: "failed", code: "authority_revoked" });
    expect(asked).toBe(1);
    const failed = (await loaded(store, scope, started.task.taskId)).task;
    expect(failed).toMatchObject({ state: "failed", failure: { reason: "authority_revoked" }, pending: {}, fenceCounter: 0, usage: { attempts: 0, modelCalls: 0 } });
    expect((await store.loadIndex(scope)).index.active).toBeNull();
    expect((await repository.listOutbox({ scope, topic: GENERATION_SLICE_TOPIC }))[0]!.state).toBe("completed");
  });

  it("M. a slice that loses its worker repeatedly becomes platform_failure (a visible state, not an endless queue); resume schedules it again", async () => {
    const repository = new InMemoryDurableWorkflowRepository(), clock = manualClock(), store = new GenerationTaskStore({ repository, clock: clock.now, maxAttemptsPerSlice: 2 }), scope = scopeOf(env, "m-lost");
    const started = await store.createOrAttach(startInput({ scope }));
    if (!started.ok) throw new Error(started.code);
    for (const attempt of [1, 2]) {
      const [claim] = await store.claimSlices({ workerId: `worker-${attempt}`, limit: 1, revalidate: ALLOW });
      expect(claim).toMatchObject({ outcome: "claimed", lease: { attempt } });
      clock.advance(46_000); // the worker dies: the lease lapses with no commit
    }
    const [third] = await store.claimSlices({ workerId: "worker-3", limit: 1, revalidate: ALLOW });
    expect(third).toMatchObject({ outcome: "blocked", code: "platform_failure" });
    const blocked = (await loaded(store, scope, started.task.taskId)).task;
    expect(blocked).toMatchObject({ state: "waiting-for-resource", blocker: { code: "platform_failure", blockId: null }, pending: {} });
    expect(blocked.reservations.map((entry) => [entry.attempt, entry.state])).toEqual([[1, "uncertain"], [2, "uncertain"]]); // completion unknown: charged at worst case
    const resumed = await store.control({ scope, taskId: started.task.taskId, principal: editor, action: "resume", clientActionId: "after-workers-fixed" });
    expect(resumed).toMatchObject({ ok: true, task: { state: "queued", blocker: null } });
    expect(await store.claimSlices({ workerId: "worker-4", limit: 1, revalidate: ALLOW })).toMatchObject([{ outcome: "claimed", lease: { attempt: 1, kind: "plan" } }]);
  });

  it("N. the allowance (operator-lowered here) parks the task as waiting-for-resource; an explicit, recorded extension resumes it, at most four times", async () => {
    const repository = new InMemoryDurableWorkflowRepository(), clock = manualClock(), store = new GenerationTaskStore({ repository, clock: clock.now }), scope = scopeOf(env, "n-allowance");
    const started = await store.createOrAttach(startInput({ scope, allowanceUnit: { modelCalls: 6, outputTokens: 60_000, catalogSearches: 30, wallClockMs: 3_600_000 } }));
    if (!started.ok) throw new Error(started.code);
    expect(await store.createOrAttach(startInput({ scope: scopeOf(env, "n-over"), allowanceUnit: { modelCalls: 61, outputTokens: 60_000, catalogSearches: 30, wallClockMs: 3_600_000 } }))).toMatchObject({ ok: false, code: "GENERATION_TASK_INVALID_REQUEST" }); // never raised
    const [plan] = await store.claimSlices({ workerId: "worker-a", limit: 1, revalidate: ALLOW });
    if (plan?.outcome !== "claimed") throw new Error("plan not claimed");
    expect(await store.endSlice(plan.lease, { plan: SINGLE, schedule: "next-work", usage: { modelCalls: 1, outputTokens: 900 } })).toMatchObject({ ok: true, task: { state: "queued" } });
    const [refused] = await store.claimSlices({ workerId: "worker-a", limit: 1, revalidate: ALLOW });
    expect(refused).toMatchObject({ outcome: "blocked", code: "allowance_exhausted" }); // 1 spent + 6 reserved > 6
    const parked = (await loaded(store, scope, started.task.taskId)).task;
    expect(parked).toMatchObject({ state: "waiting-for-resource", blocker: { code: "allowance_exhausted", blockId: "main" }, blocks: { main: { status: "blocked", blocker: "allowance_exhausted" } } });
    expect(parked.milestones.at(-1)).toMatchObject({ type: "waiting_resource", data: { code: "allowance_exhausted" } });
    const extended = await store.control({ scope, taskId: started.task.taskId, principal: editor, action: "resume", clientActionId: "more-1", extendAllowance: true });
    expect(extended).toMatchObject({ ok: true, task: { state: "queued", allowance: { units: 2, extensions: [{ principalId: "user-l2-editor", clientActionId: "more-1" }] }, blocks: { main: { status: "queued", blocker: null } } } });
    expect(await store.claimSlices({ workerId: "worker-a", limit: 1, revalidate: ALLOW })).toMatchObject([{ outcome: "claimed", lease: { blockId: "main" } }]);
    // the cap: at most four recorded extensions per task
    const capScope = scopeOf(env, "n-cap"), capped = await store.createOrAttach(startInput({ scope: capScope }));
    if (!capped.ok) throw new Error(capped.code);
    for (let n = 1; n <= 5; n += 1) {
      expect(await store.control({ scope: capScope, taskId: capped.task.taskId, principal: editor, action: "pause", clientActionId: `cap-pause-${n}` })).toMatchObject({ ok: true, task: { state: "paused" } });
      const extended = await store.control({ scope: capScope, taskId: capped.task.taskId, principal: editor, action: "resume", clientActionId: `cap-more-${n}`, extendAllowance: true });
      if (n <= 4) expect(extended).toMatchObject({ ok: true, task: { state: "queued", allowance: { units: 1 + n } } });
      else expect(extended).toEqual({ ok: false, code: "GENERATION_TASK_STATE_CONFLICT", issue: "resume: the allowance extension cap is reached" });
    }
  });

  it("O. ordered public events page by a durable cursor across commits; live activity is bounded and owned", async () => {
    const { store, clock, scope, taskId, leases } = await plannedTask(env, "o-events");
    const first = await store.events(scope, taskId, { after: 0, limit: 3 });
    if (!first.ok) throw new Error(first.code);
    expect(first.page.events.map((event) => event.type)).toEqual(["task_accepted", "worker_claimed", "plan_ready"]);
    expect(first.page).toMatchObject({ cursor: 3, hasMore: true, gap: false });
    const rest = await store.events(scope, taskId, { after: first.page.cursor });
    if (!rest.ok) throw new Error(rest.code);
    expect(rest.page.events.map((event) => event.seq)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(rest.page.events.filter((event) => event.type === "block_started").map((event) => event.blockId).sort()).toEqual(["b1", "b2", "b3"]);
    const reconnect = await store.events(scope, taskId, { after: rest.page.cursor });
    expect(reconnect).toMatchObject({ ok: true, page: { events: [], cursor: rest.page.cursor, gap: false } }); // a reconnect replays nothing twice
    // activity: the owner's lines, throttled, bounded
    expect(await store.writeActivity(leases.b1, "checking catalog candidates for 'logic-level N-MOSFET' (5 found, 2 new)")).toEqual({ written: true });
    expect(await store.writeActivity(leases.b1, "too soon")).toEqual({ written: false });
    clock.advance(3_000);
    expect(await store.writeActivity(leases.b1, "pin contract checked: 2 issues")).toEqual({ written: true });
    const lines = await store.readActivity(scope, (await loaded(store, scope, taskId)).task);
    expect(lines.map((activity) => activity.lines.map((entry) => entry.text))).toEqual([["checking catalog candidates for 'logic-level N-MOSFET' (5 found, 2 new)", "pin contract checked: 2 issues"]]);
  });

  it("P. a blocked block beside saved ones is partial_available; retry-block retries ONLY that block; review-partial merges the saved blocks into a partial result", async () => {
    const { store, scope, taskId, leases } = await plannedTask(env, "p-partial");
    const saved = (lease: GenerationSliceLease) => ({ checkpoint: checkpointFor(lease, { saved: true }), block: { status: "saved" as const, turnsUsed: 2 } });
    await store.endSlice(leases.b1, saved(leases.b1));
    await store.endSlice(leases.b3, saved(leases.b3));
    const blocked = await store.endSlice(leases.b2, { checkpoint: checkpointFor(leases.b2), block: { status: "blocked", blocker: "missing_part", turnsUsed: 6 } });
    expect(blocked).toMatchObject({ ok: true, task: { state: "waiting-for-resource", blocker: { code: "partial_available", blockId: "b2", evidence: { savedBlocks: 2, blockedBlocks: 1, cause: "missing_part" } } } });
    const retried = await store.control({ scope, taskId, principal: editor, action: "retry-block", clientActionId: "retry-b2", blockId: "b2" });
    if (!retried.ok) throw new Error(retried.code);
    expect(Object.values(retried.task.pending).map((entry) => entry.blockId)).toEqual(["b2"]);
    expect(retried.task.blocks).toMatchObject({ b1: { status: "saved" }, b2: { status: "queued", blocker: null }, b3: { status: "saved" } });
    const [again] = await store.claimSlices({ workerId: "worker-b", limit: 1, revalidate: ALLOW });
    if (again?.outcome !== "claimed") throw new Error("b2 not claimed");
    expect(await store.readBlock(scope, again.task, "b2")).toEqual(checkpointFor(leases.b2)); // resumes from its checkpoint
    expect(await store.endSlice(again.lease, { block: { status: "blocked", blocker: "missing_part" } })).toMatchObject({ ok: true, task: { state: "waiting-for-resource" } });
    const partial = await store.control({ scope, taskId, principal: editor, action: "review-partial", clientActionId: "partial-1" });
    expect(partial).toMatchObject({ ok: true, task: { state: "queued", blocks: { b2: { status: "omitted" } } } });
    const [merge] = await store.claimSlices({ workerId: "worker-b", limit: 1, revalidate: ALLOW });
    if (merge?.outcome !== "claimed" || merge.lease.kind !== "merge") throw new Error("merge not claimed");
    const result = resultFor(taskId, (["b1", "b3"] as const).map((block) => ({ blockId: block, ...merge.task.blocks[block]!.artifactRef! })), iso(T0 + 5_000), ["Power"]);
    expect(await store.endSlice(merge.lease, { result })).toMatchObject({ ok: true, task: { state: "awaiting-review", result: { status: "partial", omittedBlocks: ["Power"] } } });
  });
});
