/**
 * [PR-L, 2026-10-17] The generation-task store's core properties as scenarios, run by l2-task-store (the in-memory repository) and
 * l2-generation-task-pglite (the PostgreSQL repository on PGlite) with the SAME assertions. Each scenario owns its scopes; the
 * environment's `quiesce` settles leftover slice events first, because a worker's claim is deliberately cross-scope (section 3.2).
 * Not a suite (no `.test.` in the name).
 */
import { expect } from "vitest";
import { durableAggregateIdentity } from "../../durable-workflow/stable";
import type { DurableAggregateIdentity, DurableCommitRequest, DurableWorkflowRepository, DurableWorkflowScope } from "../../durable-workflow/types";
import { GENERATION_SLICE_TOPIC, GENERATION_TASK_AGGREGATES, emptyGenerationTaskIndex, generationTaskId, type GenerationTaskHead } from "../contracts";
import { generationTaskEvent } from "../events";
import { GenerationTaskStore, type GenerationSliceLease, type GenerationTaskStoreOptions } from "../store";
import { ALLOW, PLAN, T0, checkpointFor, clientRequestId, manualClock, startInput } from "./_l2-fixtures";

export interface L2StoreEnv {
  name: string;
  /** the durable state one scenario works on (in-memory: a new repository; PGlite: the shared migrated database) */
  repository(): DurableWorkflowRepository;
  /** a store built the way a RESTARTED process builds it, over the same durable state */
  restarted(repository: DurableWorkflowRepository, options: Omit<GenerationTaskStoreOptions, "repository">): Promise<GenerationTaskStore>;
  /** settle every leftover slice event, so a cross-scope claim sees only the running scenario's slices */
  quiesce(): Promise<void>;
}

export interface RepositoryHooks {
  /** runs after the inner commit of each request (a race injected between two commits of one slice) */
  afterCommit?: (request: DurableCommitRequest<object>) => Promise<void> | void;
  /** idempotency keys answered with a transport error AFTER they were committed (an ambiguous commit), once each */
  ambiguousKeys?: Set<string>;
  /** event ids whose acknowledgement crashes the worker (after its head commit landed) */
  crashOnComplete?: Set<string>;
}
export function hookedRepository(inner: DurableWorkflowRepository, hooks: RepositoryHooks): DurableWorkflowRepository {
  return {
    loadHead: <T extends object = object>(identity: DurableAggregateIdentity) => inner.loadHead<T>(identity),
    listHeads: <T extends object = object>(input: { aggregateType: string; scope: DurableWorkflowScope; limit?: number }) => inner.listHeads<T>(input),
    loadRecord: <T extends object = object>(scope: DurableWorkflowScope, recordId: string) => inner.loadRecord<T>(scope, recordId),
    history: <T extends object = object>(identity: DurableAggregateIdentity) => inner.history<T>(identity),
    getReplay: <T extends object = object>(scope: DurableWorkflowScope, scopeKey: string, key: string) => inner.getReplay<T>(scope, scopeKey, key),
    commit: async <T extends object = object>(request: DurableCommitRequest<T>) => {
      const result = await inner.commit<T>(request);
      await hooks.afterCommit?.(request as DurableCommitRequest<object>);
      if (hooks.ambiguousKeys?.delete(request.idempotencyKey)) throw new Error("ECONNRESET after commit");
      return result;
    },
    claimOutbox: (input) => inner.claimOutbox(input),
    completeOutbox: async (input) => { if (hooks.crashOnComplete?.has(input.eventId)) throw new Error("WORKER_CRASHED"); return inner.completeOutbox(input); },
    failOutbox: (input) => inner.failOutbox(input),
    listOutbox: (input) => inner.listOutbox(input),
    renewOutboxLease: (input) => inner.renewOutboxLease!(input),
  };
}

export const scopeOf = (env: L2StoreEnv, name: string): DurableWorkflowScope => ({ tenantId: `tenant-l2-${env.name}`, projectId: `project-${name}`, branchId: "main" });
const iso = (ms: number) => new Date(ms).toISOString();
const blockKey = (taskId: string, block: string) => `${taskId}/${block}`;
/** The validated head and its revision (a refusal fails the scenario). */
export async function loaded(store: GenerationTaskStore, scope: DurableWorkflowScope, taskId: string): Promise<{ task: GenerationTaskHead; revision: number }> {
  const outcome = await store.load(scope, taskId);
  if (!outcome.ok) throw new Error(`load refused: ${outcome.code}`);
  return { task: outcome.task, revision: outcome.revision };
}

/** A task planned into three blocks whose slices worker A holds (leases from T0 + 2 s to T0 + 47 s). */
export async function plannedTask(env: L2StoreEnv, name: string, hooks: RepositoryHooks = {}, requestId = clientRequestId()) {
  await env.quiesce();
  const inner = env.repository(), repository = hookedRepository(inner, hooks), clock = manualClock(), scope = scopeOf(env, name);
  const store = new GenerationTaskStore({ repository, clock: clock.now });
  const started = await store.createOrAttach(startInput({ scope, requestId }));
  if (!started.ok) throw new Error(`start refused: ${started.code}`);
  const taskId = started.task.taskId;
  clock.advance(1_000);
  const [plan] = await store.claimSlices({ workerId: "worker-a", limit: 1, revalidate: ALLOW });
  if (plan?.outcome !== "claimed") throw new Error(`plan not claimed: ${plan?.outcome}`);
  const planned = await store.endSlice(plan.lease, { plan: PLAN, schedule: "next-work", usage: { modelCalls: 1, inputTokens: 900, outputTokens: 700 }, milestones: [generationTaskEvent("plan_ready", { at: iso(clock.now()), phase: "planning", message: "Planned three subsystem blocks.", data: { blocks: 3, planner: "planned" } })] });
  if (!planned.ok) throw new Error(`plan end refused: ${planned.code} ${planned.issue ?? ""}`);
  clock.advance(1_000);
  const claims = await store.claimSlices({ workerId: "worker-a", limit: 3, revalidate: ALLOW });
  const leases: Record<string, GenerationSliceLease> = {};
  for (const claim of claims) { if (claim.outcome !== "claimed") throw new Error(`block not claimed: ${claim.outcome}`); leases[claim.lease.blockId!] = claim.lease; }
  if (Object.keys(leases).sort().join() !== "b1,b2,b3") throw new Error("three block slices expected");
  return { inner, repository, store, clock, scope, taskId, started, planLease: plan.lease, leases: leases as Record<"b1" | "b2" | "b3", GenerationSliceLease> };
}

// ─── A. start and attach ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function scenarioStartAndAttach(env: L2StoreEnv): Promise<void> {
  await env.quiesce();
  const repository = env.repository(), clock = manualClock(), store = new GenerationTaskStore({ repository, clock: clock.now });
  const scope = scopeOf(env, "a-start"), input = startInput({ scope });
  const first = await store.createOrAttach(input);
  if (!first.ok) throw new Error(first.code);
  expect(first).toMatchObject({ status: 202, attached: false, replayed: false });
  const task = first.task;
  expect(task.taskId).toBe(generationTaskId(scope, input.principal.principalId, input.request.clientRequestId));
  expect(task.state).toBe("queued");
  expect(Object.entries(task.pending)).toEqual([[`${task.taskId}:s1`, { kind: "plan", blockId: null, notBefore: iso(T0), state: "queued", owner: null }]]);
  expect(task.milestones.map((event) => event.type)).toEqual(["task_accepted"]);
  expect((await store.loadIndex(scope)).index.active).toMatchObject({ taskId: task.taskId, state: "queued" });
  const outbox = await repository.listOutbox({ scope, topic: GENERATION_SLICE_TOPIC });
  expect(outbox.map((event) => event.payload)).toEqual([{ schema: "sirkit.generation-slice.v1", taskId: task.taskId, sliceId: `${task.taskId}:s1`, kind: "plan", blockId: null }]);
  // a lost 202: the same request again attaches to the same task and writes nothing
  clock.advance(1_000);
  const again = await store.createOrAttach(input);
  expect(again).toMatchObject({ ok: true, attached: true, task: { taskId: task.taskId } });
  expect(await repository.history(durableAggregateIdentity(scope, GENERATION_TASK_AGGREGATES.head, task.taskId))).toHaveLength(1);
  expect(await repository.listOutbox({ scope, topic: GENERATION_SLICE_TOPIC })).toHaveLength(1);
  // the same client request id with a different request is refused, never attached
  expect(await store.createOrAttach({ ...input, request: { ...input.request, prompt: "build a different circuit" } })).toEqual({ ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  expect(await store.createOrAttach({ ...input, base: { ...input.base, schematicDigest: "eng1-99999999999999999999999999999999" } })).toEqual({ ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  // a NEW request while one is active: one active task per project branch
  expect(await store.createOrAttach(startInput({ scope }))).toEqual({ ok: false, status: 409, code: "GENERATION_TASK_ACTIVE", activeTask: { taskId: task.taskId, state: "queued", createdAt: iso(T0) } });
  // refusals accept nothing
  const empty = scopeOf(env, "a-empty");
  expect(await store.createOrAttach(startInput({ scope: empty, principal: { principalId: "user-l2-viewer", role: "viewer", membershipRevision: "mbr1-0123456789abcdef" } }))).toEqual({ ok: false, status: 403, code: "GENERATION_TASK_FORBIDDEN" });
  expect(await store.createOrAttach(startInput({ scope: empty, providerServable: false }))).toEqual({ ok: false, status: 503, code: "GENERATION_PROVIDER_UNAVAILABLE" });
  expect(await store.createOrAttach(startInput({ scope: empty, prompt: "x".repeat(4_001) }))).toMatchObject({ ok: false, status: 400, code: "GENERATION_TASK_INVALID_REQUEST" });
  expect(await store.loadIndex(empty)).toEqual({ index: emptyGenerationTaskIndex(), revision: 0 });
  expect(await repository.listOutbox({ scope: empty })).toEqual([]);
  // two NEW requests at once: exactly one is accepted, the other sees it active
  const raced = scopeOf(env, "a-race");
  const outcomes = await Promise.all([store.createOrAttach(startInput({ scope: raced })), store.createOrAttach(startInput({ scope: raced }))]);
  expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
  expect(outcomes.filter((outcome) => !outcome.ok && outcome.code === "GENERATION_TASK_ACTIVE")).toHaveLength(1);
}

// ─── B. scoping ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function scenarioForeignScope(env: L2StoreEnv): Promise<void> {
  await env.quiesce();
  const repository = env.repository(), clock = manualClock(), store = new GenerationTaskStore({ repository, clock: clock.now });
  const scope = scopeOf(env, "b-owner");
  const started = await store.createOrAttach(startInput({ scope }));
  if (!started.ok) throw new Error(started.code);
  const id = started.task.taskId, NOT_FOUND = { ok: false, code: "GENERATION_TASK_NOT_FOUND" };
  const otherTenant = { ...scope, tenantId: `${scope.tenantId}-other` }, otherProject = { ...scope, projectId: `${scope.projectId}-other` }, otherBranch = { ...scope, branchId: "feature" };
  // a foreign scope's id, an unknown id and a malformed id are the SAME refusal
  for (const [where, outcome] of [
    ["other tenant", await store.load(otherTenant, id)], ["other project", await store.load(otherProject, id)], ["other branch", await store.load(otherBranch, id)],
    ["unknown id", await store.load(scope, generationTaskId(scope, "nobody", clientRequestId(424_242)))], ["malformed id", await store.load(scope, "generation-task:../../etc")], ["malformed scope", await store.load({ tenantId: "", projectId: "x", branchId: "main" }, id)],
  ] as const) expect(outcome, where).toEqual(NOT_FOUND);
  expect(await store.control({ scope: otherTenant, taskId: id, principal: { principalId: "user-l2-editor", role: "project_admin" }, action: "cancel", clientActionId: "foreign-stop" })).toEqual(NOT_FOUND);
  expect(await store.events(otherProject, id)).toEqual(NOT_FOUND);
  const owner = await store.load(scope, id);
  expect(owner).toMatchObject({ ok: true, revision: 1, task: { state: "queued", control: { cancel: null } } }); // untouched by the foreign control
}

// ─── C. slices, fencing and the late writer ──────────────────────────────────────────────────────────────────────────────

export async function scenarioSlicesAndFencing(env: L2StoreEnv): Promise<void> {
  const hooks: RepositoryHooks = {};
  const { repository, store, clock, scope, taskId, leases } = await plannedTask(env, "c-fence", hooks);
  let task = (await loaded(store, scope, taskId)).task;
  expect(task.state).toBe("running");
  expect(Object.values(leases).map((lease) => lease.fence).sort()).toEqual([2, 3, 4]);
  expect(task.reservations.map((entry) => [entry.modelCalls, entry.outputTokens, entry.state])).toEqual([[6, 49_152, "held"], [6, 49_152, "held"], [6, 49_152, "held"]]);
  expect(task.usage).toMatchObject({ slices: 1, attempts: 4, modelCalls: 1, inputTokens: 900, outputTokens: 700 });
  // A keeps b2 and b3 alive; b1's lease lapses and worker B takes the slice over with a NEW fence
  clock.set(T0 + 32_000);
  expect(await store.renewSlice(leases.b2)).toMatchObject({ ok: true, leaseExpiresAt: iso(T0 + 77_000) });
  expect(await store.renewSlice(leases.b3)).toMatchObject({ ok: true });
  clock.set(T0 + 48_000);
  const [taken] = await store.claimSlices({ workerId: "worker-b", limit: 1, revalidate: ALLOW });
  if (taken?.outcome !== "claimed") throw new Error(`b1 not taken over: ${taken?.outcome}`);
  expect(taken.lease).toMatchObject({ blockId: "b1", sliceId: leases.b1.sliceId, attempt: 2, fence: 5, workerId: "worker-b" });
  task = taken.task;
  expect(task.reservations.find((entry) => entry.sliceId === leases.b1.sliceId && entry.attempt === 1)?.state).toBe("uncertain"); // A's lapsed attempt stays charged
  // A, fenced out, writes NOTHING: no block revision, no head revision, no renewal
  const { revision } = await loaded(store, scope, taskId);
  const b1History = () => repository.history(durableAggregateIdentity(scope, GENERATION_TASK_AGGREGATES.block, blockKey(taskId, "b1")));
  expect(await store.checkpointSlice(leases.b1, 1, { checkpoint: checkpointFor(leases.b1), block: { turnsUsed: 2 } })).toEqual({ ok: false, code: "GENERATION_SLICE_FENCED" });
  expect(await store.endSlice(leases.b1, { checkpoint: checkpointFor(leases.b1, { saved: true }), block: { status: "saved", turnsUsed: 2 } })).toEqual({ ok: false, code: "GENERATION_SLICE_FENCED" });
  expect(await store.renewSlice(leases.b1)).toEqual({ ok: false, code: "GENERATION_SLICE_LEASE_LOST" });
  expect(await store.pollControl(leases.b1)).toEqual({ fenced: true, cancel: false, pause: false });
  expect(await b1History()).toHaveLength(0);
  expect((await loaded(store, scope, taskId)).revision).toBe(revision);
  // B, the owner, checkpoints b1 and the head references exactly B's revision
  const bCheckpoint = checkpointFor(taken.lease, { turns: 3 });
  const committed = await store.checkpointSlice(taken.lease, 1, { checkpoint: bCheckpoint, block: { turnsUsed: 3 }, usage: { modelCalls: 3, outputTokens: 2_400, catalogSearches: 3 } });
  expect(committed).toMatchObject({ ok: true, replayed: false });
  const afterB = (await loaded(store, scope, taskId)).task;
  expect(await store.readBlock(scope, afterB, "b1")).toEqual(bCheckpoint);
  expect(afterB.blocks.b1).toMatchObject({ status: "designing", turnsUsed: 3 });
  expect(afterB.reservations.find((entry) => entry.sliceId === leases.b1.sliceId && entry.attempt === 2)).toMatchObject({ modelCalls: 3, outputTokens: 49_152 - 2_400, state: "held" }); // reported usage draws the reservation down: never counted twice
  expect(afterB.usage).toMatchObject({ modelCalls: 4, outputTokens: 3_100, catalogSearches: 3 });
  // the late writer RACE: A's b3 revision lands, then B takes b3 over before A's head commit - A's revision is never referenced
  expect(await store.renewSlice(leases.b2)).toMatchObject({ ok: true }); // b2 stays A's (until T0 + 93 s)
  let racedLease: GenerationSliceLease | null = null;
  hooks.afterCommit = async (request) => {
    if (request.idempotencyKey !== `${leases.b3.sliceId}:a1:block:1`) return;
    hooks.afterCommit = undefined;
    clock.set(T0 + 78_000); // A's b3 lease (renewed to T0 + 77 s) has lapsed
    const [raced] = await store.claimSlices({ workerId: "worker-b", limit: 1, revalidate: ALLOW });
    if (raced?.outcome === "claimed") racedLease = raced.lease;
  };
  const late = await store.checkpointSlice(leases.b3, 1, { checkpoint: checkpointFor(leases.b3), block: { turnsUsed: 2 } });
  expect(late).toEqual({ ok: false, code: "GENERATION_SLICE_FENCED" });
  expect(racedLease).toMatchObject({ blockId: "b3", attempt: 2, fence: 6 });
  expect(await repository.history(durableAggregateIdentity(scope, GENERATION_TASK_AGGREGATES.block, blockKey(taskId, "b3")))).toHaveLength(1); // appended...
  const afterRace = (await loaded(store, scope, taskId)).task;
  expect(afterRace.blocks.b3!.artifactRef).toBeNull(); // ...but never referenced
  expect(await store.readBlock(scope, afterRace, "b3")).toBeNull();
}

// ─── D. duplicate and stale slice events ─────────────────────────────────────────────────────────────────────────────────

export async function scenarioStaleEvents(env: L2StoreEnv): Promise<void> {
  const hooks: RepositoryHooks = { crashOnComplete: new Set() };
  const { repository, store, clock, scope, taskId, leases } = await plannedTask(env, "d-stale", hooks);
  // A saves b1, then crashes before acknowledging the event: the head commit landed, the event stays leased
  hooks.crashOnComplete!.add(leases.b1.eventId);
  const end = { checkpoint: checkpointFor(leases.b1, { saved: true }), block: { status: "saved" as const, turnsUsed: 2 }, usage: { modelCalls: 2, outputTokens: 1_500 } };
  await expect(store.endSlice(leases.b1, end)).rejects.toThrow("WORKER_CRASHED");
  hooks.crashOnComplete!.clear();
  const saved = await loaded(store, scope, taskId);
  expect(saved.task.blocks.b1).toMatchObject({ status: "saved", turnsUsed: 2 });
  expect(saved.task.pending[leases.b1.sliceId]).toBeUndefined();
  expect(saved.task.usage).toMatchObject({ slices: 2, modelCalls: 3 });
  // the event is redelivered after its lease lapses: a NO-OP (the slice is no longer pending), acknowledged, nothing written
  clock.set(T0 + 32_000);
  await store.renewSlice(leases.b2); await store.renewSlice(leases.b3);
  clock.set(T0 + 48_000);
  const [redelivered] = await store.claimSlices({ workerId: "worker-c", limit: 1, revalidate: ALLOW });
  expect(redelivered).toMatchObject({ outcome: "stale-event", eventId: leases.b1.eventId, taskId });
  expect((await loaded(store, scope, taskId)).revision).toBe(saved.revision);
  expect((await repository.listOutbox({ scope, topic: GENERATION_SLICE_TOPIC })).find((event) => event.eventId === leases.b1.eventId)?.state).toBe("completed");
  // the crashed worker repeating its end answers the replay and writes nothing
  expect(await store.endSlice(leases.b1, end)).toMatchObject({ ok: true, replayed: true });
  expect(await loaded(store, scope, taskId)).toMatchObject({ revision: saved.revision, task: { usage: { slices: 2 } } });
}

// ─── E. ambiguous commits ────────────────────────────────────────────────────────────────────────────────────────────────

export async function scenarioAmbiguousCommits(env: L2StoreEnv): Promise<void> {
  const requestId = clientRequestId(), scope = scopeOf(env, "e-ambiguous");
  const expectedId = generationTaskId(scope, "user-l2-editor", requestId);
  const hooks: RepositoryHooks = { ambiguousKeys: new Set([`start:${expectedId}`]) };
  const { store, scope: taskScope, taskId, started, leases } = await plannedTask(env, "e-ambiguous", hooks, requestId);
  expect(taskId).toBe(expectedId);
  expect(started).toMatchObject({ ok: true, attached: false, replayed: true }); // the transport error came after the commit: the retry answered the replay
  // a slice's end commit answered with a transport error after it landed: retried with the SAME key, applied ONCE
  hooks.ambiguousKeys!.add(`${leases.b2.sliceId}:a1:end`);
  const end = { checkpoint: checkpointFor(leases.b2, { saved: true }), block: { status: "saved" as const, turnsUsed: 2 }, usage: { modelCalls: 2 } };
  expect(await store.endSlice(leases.b2, end)).toMatchObject({ ok: true, replayed: true });
  const after = await loaded(store, taskScope, taskId);
  expect(after.task.usage).toMatchObject({ slices: 2, modelCalls: 3 });
  expect(after.task.blocks.b2).toMatchObject({ status: "saved" });
  expect(await store.endSlice(leases.b2, end)).toMatchObject({ ok: true, replayed: true });
  expect((await loaded(store, taskScope, taskId)).revision).toBe(after.revision);
}

// ─── F. restart ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function scenarioRestart(env: L2StoreEnv): Promise<void> {
  const { repository, store, clock, scope, taskId, leases } = await plannedTask(env, "f-restart");
  const b3Checkpoint = checkpointFor(leases.b3, { turns: 4 });
  expect(await store.checkpointSlice(leases.b3, 1, { checkpoint: b3Checkpoint, block: { turnsUsed: 4 }, facts: { parts: [{ part: b3Checkpoint.surfaced["p-1a"]!.part, blockId: "b3" }] } })).toMatchObject({ ok: true });
  const b2Saved = checkpointFor(leases.b2, { saved: true });
  expect(await store.endSlice(leases.b2, { checkpoint: b2Saved, block: { status: "saved", turnsUsed: 2 } })).toMatchObject({ ok: true });
  // the process restarts: a NEW store (and, on PostgreSQL, new modules) over the same durable state
  const restarted = await env.restarted(repository, { clock: clock.now });
  const reloaded = await loaded(restarted, scope, taskId);
  expect(reloaded.task).toEqual((await loaded(store, scope, taskId)).task);
  expect(await restarted.readBlock(scope, reloaded.task, "b3")).toEqual(b3Checkpoint);
  expect(await restarted.readBlock(scope, reloaded.task, "b2")).toEqual(b2Saved);
  expect(Object.keys((await restarted.readFacts(scope, reloaded.task))!.parts)).toEqual(["p-1a"]);
  // the crashed owners' leases lapse; the restarted worker resumes b3 from its checkpoint with a newer fence
  clock.set(T0 + 48_000);
  const claims = await restarted.claimSlices({ workerId: "worker-d", limit: 3, revalidate: ALLOW });
  const b3 = claims.find((claim) => claim.outcome === "claimed" && claim.lease.blockId === "b3");
  if (!b3 || b3.outcome !== "claimed") throw new Error("b3 not resumed");
  expect(b3.lease).toMatchObject({ attempt: 2, workerId: "worker-d" });
  expect(b3.lease.fence).toBeGreaterThan(leases.b3.fence);
  expect(await restarted.readBlock(scope, b3.task, "b3")).toEqual(b3Checkpoint); // the resume point survived
  expect(b3.task.blocks.b2).toMatchObject({ status: "saved" }); // a saved block is never redone
  expect(claims.some((claim) => claim.outcome === "claimed" && claim.lease.blockId === "b2")).toBe(false);
}

// ─── G. S1: a delayed next slice, atomic with its checkpoint ─────────────────────────────────────────────────────────────

export async function scenarioDelayedSlice(env: L2StoreEnv): Promise<void> {
  await env.quiesce();
  const repository = env.repository(), clock = manualClock(), scope = scopeOf(env, "g-delay"), store = new GenerationTaskStore({ repository, clock: clock.now });
  const started = await store.createOrAttach(startInput({ scope }));
  if (!started.ok) throw new Error(started.code);
  clock.advance(1_000);
  const [plan] = await store.claimSlices({ workerId: "worker-a", limit: 1, revalidate: ALLOW });
  if (plan?.outcome !== "claimed") throw new Error("plan not claimed");
  const single = { planner: { state: "single" as const, reason: "simple_request" as const }, rationale: "One block.", assumptions: [], blocks: [{ name: "Main", brief: "The whole circuit", sharedNets: [] }] };
  const notBefore = iso(T0 + 61_000);
  const before = (await loaded(store, scope, started.task.taskId)).revision;
  // a delay without its provider reason is refused (and nothing is committed)
  expect(await store.endSlice(plan.lease, { plan: single, schedule: [{ kind: "block", blockId: "main", notBefore }] })).toMatchObject({ ok: false, code: "GENERATION_TASK_TRANSITION_REFUSED" });
  expect(await loaded(store, scope, started.task.taskId)).toMatchObject({ revision: before, task: { plan: null } });
  const ended = await store.endSlice(plan.lease, { plan: single, schedule: [{ kind: "block", blockId: "main", notBefore }], waitingReason: "rate_limit", usage: { modelCalls: 1 } });
  if (!ended.ok) throw new Error(ended.code);
  expect(ended.task.state).toBe("waiting-for-provider");
  expect(ended.task.milestones.at(-1)).toMatchObject({ type: "waiting_provider", data: { reason: "rate_limit", retryAt: notBefore } });
  const delayed = (await repository.listOutbox({ scope, topic: GENERATION_SLICE_TOPIC, state: "pending" }));
  expect(delayed.map((event) => [event.payload.blockId, event.availableAt])).toEqual([["main", notBefore]]);
  expect(await store.claimSlices({ workerId: "worker-a", limit: 5, revalidate: ALLOW })).toEqual([]);
  clock.set(T0 + 60_999);
  expect(await store.claimSlices({ workerId: "worker-a", limit: 5, revalidate: ALLOW })).toEqual([]);
  clock.set(T0 + 61_000);
  const [main] = await store.claimSlices({ workerId: "worker-a", limit: 5, revalidate: ALLOW });
  expect(main).toMatchObject({ outcome: "claimed", lease: { blockId: "main", kind: "block" }, task: { state: "running" } });
}

// ─── H. cancellation ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function scenarioCancel(env: L2StoreEnv): Promise<void> {
  const { store, scope, taskId, leases } = await plannedTask(env, "h-cancel");
  const editor = { principalId: "user-l2-editor", role: "pcb_editor" as const };
  const requested = await store.control({ scope, taskId, principal: editor, action: "cancel", clientActionId: "stop-design-1" });
  expect(requested).toMatchObject({ ok: true, task: { state: "cancel-requested", control: { cancel: { action: "cancel", principalId: "user-l2-editor" } } } });
  // live owners stop: no new checkpoint, the control poll says so, each settles; the last settles the task
  expect(await store.checkpointSlice(leases.b2, 1, { checkpoint: checkpointFor(leases.b2) })).toEqual({ ok: false, code: "GENERATION_TASK_CANCEL_REQUESTED" });
  expect(await store.pollControl(leases.b2)).toEqual({ fenced: false, cancel: true, pause: false });
  expect(await store.settleCancel(leases.b1, { modelCalls: 2, outputTokens: 1_000 })).toMatchObject({ ok: true, task: { state: "cancel-requested" } });
  expect(await store.settleCancel(leases.b2)).toMatchObject({ ok: true, task: { state: "cancel-requested" } });
  const settled = await store.settleCancel(leases.b3);
  expect(settled).toMatchObject({ ok: true, task: { state: "cancelled", pending: {} } });
  if (!settled.ok) return;
  expect(settled.task.milestones.at(-1)!.type).toBe("cancelled");
  expect(settled.task.milestones.filter((event) => event.type === "cancel_requested")).toHaveLength(1);
  expect(settled.task.reservations.filter((entry) => entry.state === "uncertain").map((entry) => entry.sliceId).sort()).toEqual([leases.b2.sliceId, leases.b3.sliceId].sort()); // no usage reported: charged at worst case
  expect((await store.loadIndex(scope)).index).toMatchObject({ active: null, recent: [{ taskId, state: "cancelled" }] });
  // a late result after the cancel is fenced; the cancel is never undone by a later action
  expect(await store.endSlice(leases.b3, { block: { status: "saved" } })).toEqual({ ok: false, code: "GENERATION_SLICE_FENCED" });
  expect(await store.control({ scope, taskId, principal: editor, action: "resume", clientActionId: "resume-after-cancel" })).toMatchObject({ ok: false, code: "GENERATION_TASK_STATE_CONFLICT" });
  // a queued task with no live owner is cancelled at once; the same action again is a replay
  const next = await store.createOrAttach(startInput({ scope }));
  if (!next.ok) throw new Error(next.code);
  const immediate = await store.control({ scope, taskId: next.task.taskId, principal: editor, action: "cancel", clientActionId: "stop-design-2" });
  expect(immediate).toMatchObject({ ok: true, replayed: false, task: { state: "cancelled", pending: {} } });
  if (immediate.ok) expect(immediate.task.milestones.slice(-2).map((event) => event.type)).toEqual(["cancel_requested", "cancelled"]);
  expect(await store.control({ scope, taskId: next.task.taskId, principal: editor, action: "cancel", clientActionId: "stop-design-2" })).toMatchObject({ ok: true, replayed: true, task: { state: "cancelled" } });
  // the stale plan event of the cancelled task is a no-op
  const [stale] = await store.claimSlices({ workerId: "worker-a", limit: 1, revalidate: ALLOW });
  expect(stale).toMatchObject({ outcome: "stale-event", taskId: next.task.taskId });
}
