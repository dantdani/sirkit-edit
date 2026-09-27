/**
 * [B21 A] The durable orchestration record (OD-111): the aggregate `agent.orchestration-run.v1` on the durable-workflow
 * substrate, scoped by tenant/project/branch and keyed by the coordinator run id; every accepted write a compare-and-set commit
 * under the idempotency key `orchestration:<runId>:<taskId>:<attempt>:<kind>` in a PER-RUN replay partition (a replay returns the
 * committed result and writes nothing; two runs never share a replay whatever their ids spell); only validated, digest-bound
 * documents and closed decision records are stored, a request bound to its run and task, a result to the request it answers;
 * every load is digest-verified (`revision` the head, `history` the whole chain); a malformed scope on a read throws one documented
 * sentence; no outbox effect exists (D21-28); `history` is the append-only audit. The repository is the in-memory durable one; the
 * production binding belongs to the composition root (B21-B), so the default resolver is the UNAVAILABLE store that fails every
 * caller closed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { durableScopeKey } from "@/app/lib/durable-workflow/stable";
import type { DurableAggregateRecord, DurableCommitRequest, DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { SPECIALIST_REQUEST_SCHEMA, SPECIALIST_RESULT_SCHEMA, validateSpecialistRequest, validateSpecialistResult, validatedDigestOf, type ValidatedSpecialistRequest, type ValidatedSpecialistResult } from "../contracts";
import {
  DurableOrchestrationRunStore, ORCHESTRATION_AGGREGATE_TYPE, ORCHESTRATION_DECISIONS, ORCHESTRATION_RECORD_KINDS, ORCHESTRATION_RECORD_SCHEMA,
  ORCHESTRATION_SCOPE_SUFFIX, ORCHESTRATION_STORE_BOUNDS, ORCHESTRATION_STORE_REFUSALS, orchestrationIdempotencyKey, orchestrationRecordDigest, orchestrationReplayScopeKey,
  resetOrchestrationRunStoreFactory, resolveOrchestrationRunStore, setOrchestrationRunStoreFactory,
  type OrchestrationAppendRequest, type OrchestrationRecord, type OrchestrationRunScope, type OrchestrationStoredPayload,
} from "../store";
import { SCOPE as REQUEST_SCOPE, validRequest, validResult } from "./_fixtures";

const ROOT = process.cwd();
const MODULE = "app/lib/agent/orchestration/store.ts";
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const SCOPE: OrchestrationRunScope = { tenantId: "local", projectId: "p21", branchId: "main", runId: "run-1" };
const WORKFLOW_SCOPE = { tenantId: "local", projectId: "p21", branchId: "main" };
const T0 = "2026-09-24T12:00:00.000Z";
const chars = (n: number): string => "x".repeat(n);
/** a key-shaped string assembled at run time (never a literal) */
const keyShaped = (): string => ["sk-", "ant-api03-", "A".repeat(40)].join("");

/** a validated request and the result that ANSWERS it: the same task (`task-1`), the same scope, the same role */
function validated(over: { request?: Record<string, unknown>; result?: Record<string, unknown> } = {}): { request: ValidatedSpecialistRequest; result: ValidatedSpecialistResult } {
  const request = validateSpecialistRequest(validRequest(over.request));
  const result = validateSpecialistResult(validResult({ role: "verification-critic", ...over.result }));
  if (!request.ok || !result.ok) throw new Error("the fixtures must validate");
  return { request: request.value, result: result.value };
}
const decision = (over: Record<string, unknown> = {}): OrchestrationRecord => ({ kind: "decision", decision: "accepted", reason: "connectivity verified against the current board", subjectDigest: null, ...over } as OrchestrationRecord);
const append = (over: Partial<OrchestrationAppendRequest> = {}): OrchestrationAppendRequest => ({ scope: SCOPE, taskId: "task-1", attempt: 0, expectedRevision: 0, record: decision(), at: T0, ...over });
async function ok(store: DurableOrchestrationRunStore, request: OrchestrationAppendRequest): Promise<{ revision: number; recordDigest: string; replayed: boolean }> {
  const outcome = await store.append(request);
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  if (!outcome.ok) throw new Error("refused");
  return outcome;
}
/** the raw records of one run, as the substrate holds them */
async function raw(workflow: InMemoryDurableWorkflowRepository, scope: OrchestrationRunScope): Promise<Array<DurableAggregateRecord<OrchestrationStoredPayload>>> {
  const heads = await workflow.listHeads<OrchestrationStoredPayload>({ aggregateType: ORCHESTRATION_AGGREGATE_TYPE, scope: { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId } });
  const head = heads.find((record) => record.payload.runId === scope.runId);
  if (!head) return [];
  return workflow.history<OrchestrationStoredPayload>({ scope: head.scope, aggregateType: head.aggregateType, aggregateKey: head.aggregateKey });
}
/** a repository whose `history` and `loadHead` answers are rewritten: tampered storage, never a tampered store */
function tampered(workflow: DurableWorkflowRepository, rewrite: (records: Array<DurableAggregateRecord<OrchestrationStoredPayload>>) => Array<DurableAggregateRecord<OrchestrationStoredPayload>>): DurableWorkflowRepository {
  return new Proxy(workflow, {
    get(target, property, receiver) {
      if (property === "history") return async (identity: Parameters<DurableWorkflowRepository["history"]>[0]) => rewrite(await target.history<OrchestrationStoredPayload>(identity));
      if (property === "loadHead") return async (identity: Parameters<DurableWorkflowRepository["loadHead"]>[0]) => { const head = await target.loadHead<OrchestrationStoredPayload>(identity); return head ? (rewrite([head])[0] ?? null) : null; };
      return Reflect.get(target, property, receiver);
    },
  });
}
/** one stored record with its payload rewritten and its record digest RECOMPUTED, so only the named field disagrees */
function resealed(record: DurableAggregateRecord<OrchestrationStoredPayload>, payload: OrchestrationStoredPayload): DurableAggregateRecord<OrchestrationStoredPayload> {
  return { ...record, payload, recordDigest: orchestrationRecordDigest(payload) };
}

afterEach(() => resetOrchestrationRunStoreFactory());

describe("[B21 A] the durable orchestration record", () => {
  it("1. the vocabularies are closed, pinned and frozen: the aggregate type, the record schema, five record kinds, six decisions, three store refusals, the bounds (the attempt bound included), the scope suffix, the idempotency key format (the task attempt's identity `orchestration:<runId>:<taskId>:<attempt>` plus the record kind, since one attempt writes its request, its result and a decision) and the per-run replay scope key", () => {
    expect(ORCHESTRATION_AGGREGATE_TYPE).toBe("agent.orchestration-run.v1");
    expect(ORCHESTRATION_RECORD_SCHEMA).toBe("sirkit.orchestration-run-record.v1");
    expect(ORCHESTRATION_RECORD_KINDS).toEqual(["plan", "request", "result", "decision", "dissent"]);
    expect(ORCHESTRATION_DECISIONS).toEqual(["accepted", "stale", "contradicted", "expired", "malformed", "escalated"]);
    expect(ORCHESTRATION_STORE_REFUSALS).toEqual(["stale_revision", "unvalidated_document", "invalid_record"]);
    expect(ORCHESTRATION_STORE_BOUNDS).toEqual({ maxReasonChars: 1_000, maxPlanTasks: 32, maxAttempt: 1_000 });
    expect(ORCHESTRATION_SCOPE_SUFFIX).toBe("agent-orchestration");
    expect(orchestrationIdempotencyKey("run-1", "task-1", 0, "request")).toBe("orchestration:run-1:task-1:0:request");
    expect(orchestrationIdempotencyKey("run-1", "task-1", 0, "result")).toBe("orchestration:run-1:task-1:0:result");
    expect(orchestrationIdempotencyKey("run-1", "task-1", 3, "decision")).toBe("orchestration:run-1:task-1:3:decision");
    expect(orchestrationIdempotencyKey("run-1", "task-1", 0, "request").startsWith("orchestration:run-1:task-1:0")).toBe(true);
    // [B21 A review] the replay partition carries the run id (the key text is not injective across runs when an id carries `:`)
    expect(orchestrationReplayScopeKey(SCOPE)).toBe(durableScopeKey(WORKFLOW_SCOPE, "agent-orchestration:run-1"));
    expect(orchestrationReplayScopeKey(SCOPE)).toMatch(/^durable-scope:[0-9a-f]{32}$/);
    expect(orchestrationReplayScopeKey({ ...SCOPE, runId: "run-2" })).not.toBe(orchestrationReplayScopeKey(SCOPE));
    for (const value of [ORCHESTRATION_RECORD_KINDS, ORCHESTRATION_DECISIONS, ORCHESTRATION_STORE_REFUSALS, ORCHESTRATION_STORE_BOUNDS]) expect(Object.isFrozen(value)).toBe(true);
  });

  it("2. the first accepted write is revision 1: one aggregate record whose digest is recomputable from its payload, its replay stored under the idempotency key in the run's own partition (and under no run-independent one), the head revision readable, and the history holding exactly that record", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationRunStore(workflow);
    expect(await store.revision(SCOPE)).toBe(0);
    expect(await store.history(SCOPE)).toEqual([]);
    const first = await ok(store, append());
    expect(first).toMatchObject({ revision: 1, replayed: false });
    expect(first.recordDigest).toMatch(/^eng1-[0-9a-f]{16}$/);
    expect(await store.revision(SCOPE)).toBe(1);
    const records = await raw(workflow, SCOPE);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ aggregateType: ORCHESTRATION_AGGREGATE_TYPE, revision: 1, scope: WORKFLOW_SCOPE, recordDigest: first.recordDigest });
    expect(records[0]!.payload).toMatchObject({ schema: ORCHESTRATION_RECORD_SCHEMA, runId: "run-1", taskId: "task-1", attempt: 0, revision: 1, at: T0, record: { kind: "decision", decision: "accepted", subjectDigest: null } });
    expect(orchestrationRecordDigest(records[0]!.payload)).toBe(first.recordDigest);
    expect(engineeringDigest({ schema: ORCHESTRATION_AGGREGATE_TYPE, payload: records[0]!.payload })).toBe(first.recordDigest);
    const key = orchestrationIdempotencyKey("run-1", "task-1", 0, "decision");
    const replay = await workflow.getReplay(WORKFLOW_SCOPE, orchestrationReplayScopeKey(SCOPE), key);
    expect(replay).not.toBeNull();
    expect(replay!.result).toEqual({ revision: 1, recordDigest: first.recordDigest });
    // [B21 A review] no replay lives under the run-independent scope key: the partition is per run
    expect(await workflow.getReplay(WORKFLOW_SCOPE, durableScopeKey(WORKFLOW_SCOPE, ORCHESTRATION_SCOPE_SUFFIX), key)).toBeNull();
    const history = await store.history(SCOPE);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ revision: 1, taskId: "task-1", attempt: 0, at: T0, recordDigest: first.recordDigest, record: { kind: "decision", decision: "accepted" } });
  });

  it("3. compare-and-set: a stale expectedRevision refuses `stale_revision` with the current revision and writes nothing; the current revision is accepted", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationRunStore(workflow);
    await ok(store, append());
    const stale = await store.append(append({ taskId: "task-2", expectedRevision: 0 }));
    expect(stale).toEqual({ ok: false, code: "stale_revision", message: expect.stringContaining("revision 1"), currentRevision: 1 });
    expect(await store.revision(SCOPE)).toBe(1);
    expect(await raw(workflow, SCOPE)).toHaveLength(1);
    const ahead = await store.append(append({ taskId: "task-2", expectedRevision: 7 }));
    expect(ahead).toMatchObject({ ok: false, code: "stale_revision", currentRevision: 1 });
    expect(await ok(store, append({ taskId: "task-2", expectedRevision: 1 }))).toMatchObject({ revision: 2, replayed: false });
    expect(await store.revision(SCOPE)).toBe(2);
  });

  it("4. idempotency: the same run + task + attempt replays the committed result (its revision and digest) whatever the new record or expectedRevision says, and writes nothing; another attempt of the same task is a new write", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationRunStore(workflow);
    const first = await ok(store, append());
    const replayed = await store.append(append({ record: decision({ decision: "escalated", reason: "a different record under the same key" }), expectedRevision: 0 }));
    expect(replayed).toEqual({ ok: true, revision: 1, recordDigest: first.recordDigest, replayed: true });
    const replayedStale = await store.append(append({ record: decision({ decision: "stale" }), expectedRevision: 5 }));
    expect(replayedStale).toEqual({ ok: true, revision: 1, recordDigest: first.recordDigest, replayed: true });
    expect(await raw(workflow, SCOPE)).toHaveLength(1);
    expect((await store.history(SCOPE))[0]!.record).toMatchObject({ kind: "decision", decision: "accepted" });
    const retry = await ok(store, append({ attempt: 1, expectedRevision: 1, record: decision({ decision: "escalated" }) }));
    expect(retry).toMatchObject({ revision: 2, replayed: false });
    expect((await store.history(SCOPE)).map((entry) => `${entry.taskId}@${entry.attempt}:${entry.revision}`)).toEqual(["task-1@0:1", "task-1@1:2"]);
  });

  it("5. a tampered stored record is refused on load, never trusted - history() verifies the whole chain and revision() the HEAD record only: a changed payload, a changed digest, a changed revision, a changed run id, a changed aggregate type, a dropped record, a tampered stored document, and - each with everything else consistent, the record digest recomputed - a rewritten durable scope, a rewritten aggregate key, a rewritten stored-document digest, a rewritten record schema and a rewritten run id each throw AGENT_ORCHESTRATION_RECORD_MISMATCH from history() and, when the head is touched, from revision(); the real store is intact", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationRunStore(workflow);
    const { request } = validated();
    await ok(store, append());
    await ok(store, append({ expectedRevision: 1, record: { kind: "request", document: request } })); // the head
    // [label, rewrite, whether the rewrite touches the HEAD record (then revision() must refuse too; a non-head record is invisible to it by design)]
    const tamperings: Array<[string, (records: Array<DurableAggregateRecord<OrchestrationStoredPayload>>) => Array<DurableAggregateRecord<OrchestrationStoredPayload>>, boolean]> = [
      ["payload", (records) => records.map((record) => (record.payload.record.kind === "decision" ? { ...record, payload: { ...record.payload, record: { ...record.payload.record, reason: "rewritten" } } } : record)), false],
      ["digest", (records) => records.map((record) => ({ ...record, recordDigest: engineeringDigest({ tampered: record.recordDigest }) })), true],
      ["revision", (records) => records.map((record) => ({ ...record, revision: record.revision + 1, payload: { ...record.payload, revision: record.revision + 1 } })), true],
      ["run id", (records) => records.map((record) => ({ ...record, payload: { ...record.payload, runId: "run-9" } })), true],
      ["aggregate type", (records) => records.map((record) => ({ ...record, aggregateType: "agent.autonomy-settings.v1" })), true],
      ["dropped record", (records) => records.slice(1), false],
      ["document", (records) => records.map((record) => (record.payload.record.kind === "request" ? { ...record, payload: { ...record.payload, record: { ...record.payload.record, document: { ...record.payload.record.document, objective: "rewritten" } as unknown as ValidatedSpecialistRequest } } } : record)), true],
      // [B21 A review] each guard of the load isolated: ONLY the named field disagrees, every digest is consistent with the rewrite
      ["durable scope only", (records) => records.map((record) => ({ ...record, scope: { ...record.scope, tenantId: "t2" } })), true],
      ["aggregate key only", (records) => records.map((record) => ({ ...record, aggregateKey: `${record.aggregateKey}x` })), true],
      ["stored-document digest, record digest recomputed", (records) => records.map((record) => (record.payload.record.kind === "request" ? resealed(record, { ...record.payload, record: { ...record.payload.record, digest: engineeringDigest({ tampered: record.payload.record.digest }) } }) : record)), true],
      ["record schema, record digest recomputed", (records) => records.map((record) => resealed(record, { ...record.payload, schema: "sirkit.orchestration-run-record.v0" as typeof ORCHESTRATION_RECORD_SCHEMA })), true],
      ["run id, record digest recomputed", (records) => records.map((record) => resealed(record, { ...record.payload, runId: "run-9" })), true],
    ];
    const { result: answer } = validated();
    for (const [label, rewrite, head] of tamperings) {
      const suspect = new DurableOrchestrationRunStore(tampered(workflow, rewrite));
      await expect(suspect.history(SCOPE), label).rejects.toThrow(/AGENT_ORCHESTRATION_RECORD_MISMATCH/);
      if (head) await expect(suspect.revision(SCOPE), label).rejects.toThrow(/AGENT_ORCHESTRATION_RECORD_MISMATCH/);
      // [B21 A lead] the one throw on the WRITE path, by design: a result append reads the chain to bind its request, so nothing is
      // ever written onto a chain that fails verification (page section 5)
      await expect(suspect.append(append({ expectedRevision: 2, record: { kind: "result", document: answer } })), `${label} (result append)`).rejects.toThrow(/AGENT_ORCHESTRATION_RECORD_MISMATCH/);
    }
    expect(await store.revision(SCOPE)).toBe(2);
    expect((await store.history(SCOPE)).map((entry) => entry.record.kind)).toEqual(["decision", "request"]);
  });

  it("6. scope isolation: another run id, another branch, another project and another tenant never see this run's records, and each holds its own revision; the identical idempotency key text under another scope is its own commit (`replayed: false`), never a replay of this one", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationRunStore(workflow);
    const others: OrchestrationRunScope[] = [{ ...SCOPE, runId: "run-2" }, { ...SCOPE, branchId: "dev" }, { ...SCOPE, projectId: "other" }, { ...SCOPE, tenantId: "t2" }];
    await ok(store, append());
    await ok(store, append({ taskId: "task-2", expectedRevision: 1 }));
    for (const other of others) {
      expect(await store.revision(other), JSON.stringify(other)).toBe(0);
      expect(await store.history(other), JSON.stringify(other)).toEqual([]);
      // [B21 A review] the three that keep runId "run-1" reuse the SCOPE write's key text exactly; none replays it
      expect(await ok(store, append({ scope: other, record: decision({ reason: `written under ${other.runId}/${other.branchId}/${other.projectId}/${other.tenantId}` }) })), JSON.stringify(other)).toMatchObject({ revision: 1, replayed: false });
      expect(await store.revision(other)).toBe(1);
      expect(await store.history(other)).toHaveLength(1);
    }
    expect(await store.revision(SCOPE)).toBe(2);
    expect(await store.history(SCOPE)).toHaveLength(2);
    // another run id is another key text AND another partition
    expect(await ok(store, append({ scope: { ...SCOPE, runId: "run-3" } }))).toMatchObject({ revision: 1, replayed: false });
  });

  it("7. history is the append-only record in order: plan, request, result, decision and dissent land as revisions 1..5 with their task, attempt and time; a request or result entry carries the validated document verbatim with its own digest, and a result the digest of the request it answers", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationRunStore(workflow);
    const { request, result } = validated();
    const requestDigest = validatedDigestOf(request)!.digest;
    const resultDigest = validatedDigestOf(result)!.digest;
    await ok(store, append({ taskId: "plan", record: { kind: "plan", tasks: [{ taskId: "task-1", role: "verification-critic" }, { taskId: "task-2", role: "schematic" }], reason: "a bounded replacement needs the schematic specialist and the critic" } }));
    await ok(store, append({ expectedRevision: 1, record: { kind: "request", document: request } }));
    await ok(store, append({ expectedRevision: 2, at: "2026-09-24T12:00:05.000Z", record: { kind: "result", document: result } }));
    await ok(store, append({ expectedRevision: 3, attempt: 1, record: decision({ subjectDigest: resultDigest }) }));
    await ok(store, append({ expectedRevision: 4, taskId: "task-2", record: { kind: "dissent", decision: "contradicted", reason: "the two results name different timing resistors", subjectDigest: resultDigest } }));
    const history = await store.history(SCOPE);
    expect(history.map((entry) => `${entry.revision}:${entry.record.kind}:${entry.taskId}@${entry.attempt}`)).toEqual(["1:plan:plan@0", "2:request:task-1@0", "3:result:task-1@0", "4:decision:task-1@1", "5:dissent:task-2@0"]);
    expect(history[0]!.record).toEqual({ kind: "plan", tasks: [{ taskId: "task-1", role: "verification-critic" }, { taskId: "task-2", role: "schematic" }], reason: "a bounded replacement needs the schematic specialist and the critic" });
    expect(history[1]!.record).toEqual({ kind: "request", schema: SPECIALIST_REQUEST_SCHEMA, digest: requestDigest, document: request });
    expect(history[2]!.record).toEqual({ kind: "result", schema: SPECIALIST_RESULT_SCHEMA, digest: resultDigest, requestDigest, document: result });
    expect(history[2]!.at).toBe("2026-09-24T12:00:05.000Z");
    expect(history[3]!.record).toEqual({ kind: "decision", decision: "accepted", reason: "connectivity verified against the current board", subjectDigest: resultDigest });
    expect(history[4]!.record).toMatchObject({ kind: "dissent", decision: "contradicted", subjectDigest: resultDigest });
    for (const entry of history) expect(entry.recordDigest).toMatch(/^eng1-[0-9a-f]{16}$/);
    expect(new Set(history.map((entry) => entry.recordDigest)).size).toBe(5);
    expect(await store.revision(SCOPE)).toBe(5);
  });

  it("8. no outbox event is ever emitted: every commit carries an empty outbox, the run's replay scope key and one operation, and the substrate holds no event after the whole history was written (D21-28: no handler exists)", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const commits: Array<DurableCommitRequest<object>> = [];
    const spied = new Proxy(workflow, { get(target, property, receiver) { if (property !== "commit") return Reflect.get(target, property, receiver); return async (request: DurableCommitRequest<object>) => { commits.push(request); return target.commit(request); }; } });
    const store = new DurableOrchestrationRunStore(spied);
    const { request, result } = validated();
    await ok(store, append({ taskId: "plan", record: { kind: "plan", tasks: [{ taskId: "task-1", role: "schematic" }], reason: "one specialist" } }));
    await ok(store, append({ expectedRevision: 1, record: { kind: "request", document: request } }));
    await ok(store, append({ expectedRevision: 2, record: { kind: "result", document: result } }));
    await ok(store, append({ expectedRevision: 3, record: decision() }));
    await ok(store, append({ expectedRevision: 4, taskId: "task-2", record: { kind: "dissent", decision: "expired", reason: "older than its TTL at merge time", subjectDigest: null } }));
    expect(commits).toHaveLength(5);
    for (const commit of commits) {
      expect(commit.outbox).toEqual([]);
      expect(commit.operations).toHaveLength(1);
      expect(commit.operations[0]!.aggregateType).toBe(ORCHESTRATION_AGGREGATE_TYPE);
      expect(commit.scopeKey).toBe(orchestrationReplayScopeKey(SCOPE));
      expect(commit.idempotencyKey).toMatch(/^orchestration:run-1:[a-z0-9-]+:[0-9]+:(?:plan|request|result|decision|dissent)$/);
    }
    expect(await workflow.listOutbox()).toEqual([]);
  });

  it("9. an unvalidated document cannot be stored: the caller's raw object, a structuredClone of a validated snapshot and a validated document under the other kind each refuse `unvalidated_document` before anything is written", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationRunStore(workflow);
    const { request, result } = validated();
    const attempts: Array<[string, OrchestrationRecord]> = [
      ["raw request", { kind: "request", document: validRequest() as unknown as ValidatedSpecialistRequest }],
      ["raw result", { kind: "result", document: validResult() as unknown as ValidatedSpecialistResult }],
      ["cloned request", { kind: "request", document: structuredClone(request) }],
      ["cloned result", { kind: "result", document: structuredClone(result) }],
      ["request under result", { kind: "result", document: request as unknown as ValidatedSpecialistResult }],
      ["result under request", { kind: "request", document: result as unknown as ValidatedSpecialistRequest }],
      ["no document", { kind: "request" } as unknown as OrchestrationRecord],
    ];
    for (const [label, record] of attempts) {
      const outcome = await store.append(append({ record }));
      expect(outcome, label).toMatchObject({ ok: false, code: "unvalidated_document", path: "$.record.document" });
    }
    expect(await store.revision(SCOPE)).toBe(0);
    expect(await raw(workflow, SCOPE)).toEqual([]);
    expect(await workflow.listOutbox()).toEqual([]);
    // the validated snapshots themselves are accepted
    expect(await ok(store, append({ record: { kind: "request", document: request } }))).toMatchObject({ revision: 1 });
    expect(await ok(store, append({ expectedRevision: 1, record: { kind: "result", document: result } }))).toMatchObject({ revision: 2 });
  });

  it("10. a malformed append refuses `invalid_record` with its path and writes nothing - never a throw: an unknown or missing kind, a decision outside the six, an unknown key, an oversize, control-bearing or credential-shaped reason, a malformed subject digest, an oversize plan, a plan task with a role outside the nine or a credential-shaped task id, a malformed or credential-shaped task id, an attempt that is negative, fractional or over the bound, a malformed expectedRevision, time or scope id, a hostile record with an accessor, a revoked-Proxy scope and an accessor on the envelope's task id", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationRunStore(workflow);
    const withGetter = decision();
    Object.defineProperty(withGetter, "reason", { enumerable: true, get: () => "read later" });
    const { proxy: revokedScope, revoke } = Proxy.revocable({ ...SCOPE }, {});
    revoke();
    const cases: Array<[string, Partial<OrchestrationAppendRequest>, string]> = [
      ["unknown kind", { record: { kind: "note", reason: "x" } as unknown as OrchestrationRecord }, "$.record.kind"],
      ["missing kind", { record: { reason: "x" } as unknown as OrchestrationRecord }, "$.record.kind"],
      ["non-object record", { record: "decision" as unknown as OrchestrationRecord }, "$.record"],
      ["decision outside the six", { record: decision({ decision: "approved" }) }, "$.record.decision"],
      ["unknown key", { record: decision({ rationale: "hidden" }) }, "$.record.rationale"],
      ["oversize reason", { record: decision({ reason: chars(1_001) }) }, "$.record.reason"],
      ["control character", { record: decision({ reason: `x${String.fromCharCode(27)}` }) }, "$.record.reason"],
      ["credential-shaped reason", { record: decision({ reason: `${["api", "key"].join("_")}: ABCDEFGH12345678` }) }, "$.record.reason"],
      ["malformed subject digest", { record: decision({ subjectDigest: "sha256:abc" }) }, "$.record.subjectDigest"],
      ["dissent without a reason", { record: { kind: "dissent", decision: "stale", subjectDigest: null } as unknown as OrchestrationRecord }, "$.record.reason"],
      ["oversize plan", { record: { kind: "plan", tasks: Array.from({ length: 33 }, (_, index) => ({ taskId: `task-${index}`, role: "schematic" })), reason: "too many" } }, "$.record.tasks"],
      ["plan role outside the nine", { record: { kind: "plan", tasks: [{ taskId: "task-1", role: "planner" }], reason: "x" } as unknown as OrchestrationRecord }, "$.record.tasks[0].role"],
      ["plan task unknown key", { record: { kind: "plan", tasks: [{ taskId: "task-1", role: "schematic", tools: [] }], reason: "x" } as unknown as OrchestrationRecord }, "$.record.tasks[0].tools"],
      ["plan task credential-shaped id", { record: { kind: "plan", tasks: [{ taskId: keyShaped(), role: "schematic" }], reason: "x" } }, "$.record.tasks[0].taskId"],
      ["malformed task id", { taskId: "task 1" }, "$.taskId"],
      ["credential-shaped task id", { taskId: keyShaped() }, "$.taskId"],
      ["negative attempt", { attempt: -1 }, "$.attempt"],
      ["fractional attempt", { attempt: 1.5 }, "$.attempt"],
      ["attempt over the bound", { attempt: ORCHESTRATION_STORE_BOUNDS.maxAttempt + 1 }, "$.attempt"],
      ["negative expectedRevision", { expectedRevision: -1 }, "$.expectedRevision"],
      ["malformed time", { at: "2026-09-24T12:00:00+02:00" }, "$.at"],
      ["empty tenant", { scope: { ...SCOPE, tenantId: "" } }, "$.scope.tenantId"],
      ["malformed run id", { scope: { ...SCOPE, runId: "run 1" } }, "$.scope.runId"],
      ["credential-shaped run id", { scope: { ...SCOPE, runId: keyShaped() } }, "$.scope.runId"],
      ["accessor on the record", { record: withGetter }, "$.record.reason"],
      ["revoked Proxy scope", { scope: revokedScope }, "$.scope"],
    ];
    for (const [label, over, path] of cases) {
      const outcome = await store.append(append(over));
      expect(outcome, label).toMatchObject({ ok: false, code: "invalid_record", path });
    }
    // [B21 A review] the envelope itself is captured before any field is read: an accessor on its task id never runs
    let reads = 0;
    const withTaskGetter = append();
    Object.defineProperty(withTaskGetter, "taskId", { enumerable: true, get: () => { reads += 1; return "task-1"; } });
    expect(await store.append(withTaskGetter)).toMatchObject({ ok: false, code: "invalid_record", path: "$.taskId" });
    expect(reads).toBe(0);
    expect(await store.append("append" as unknown as OrchestrationAppendRequest)).toMatchObject({ ok: false, code: "invalid_record", path: "$" });
    // [B21 A lead] a STATEFUL Proxy envelope whose descriptor trap hands back a revoked Proxy once the scalar fields were read, and
    // one whose trap throws: each is the closed refusal, never a TypeError escaping from a reflective read after the capture
    let handled = 0;
    const stateful = new Proxy(append(), { getOwnPropertyDescriptor(target, key) { handled += 1; return key === "record" && handled > 1 ? { value: revokedScope, enumerable: true, configurable: true, writable: true } : Reflect.getOwnPropertyDescriptor(target, key); } });
    expect(await store.append(stateful)).toMatchObject({ ok: false, code: "invalid_record" });
    expect(handled).toBeGreaterThan(1);
    const throwing = new Proxy(append(), { getOwnPropertyDescriptor(target, key) { if (key === "record") throw new Error("trap"); return Reflect.getOwnPropertyDescriptor(target, key); } });
    expect(await store.append(throwing)).toMatchObject({ ok: false, code: "invalid_record", path: "$" });
    // a document record with a symbol key or a foreign prototype is refused at $.record (its keys are read through the descriptors)
    const { request: validatedRequest } = validated();
    expect(await store.append(append({ record: { kind: "request", document: validatedRequest, [Symbol("hidden")]: 1 } as unknown as OrchestrationRecord }))).toMatchObject({ ok: false, code: "invalid_record", path: "$.record" });
    expect(await store.append(append({ record: Object.assign(Object.create({ inherited: 1 }), { kind: "request", document: validatedRequest }) as unknown as OrchestrationRecord }))).toMatchObject({ ok: false, code: "invalid_record", path: "$.record" });
    // the attempt bound itself is accepted
    expect(await ok(store, append({ attempt: ORCHESTRATION_STORE_BOUNDS.maxAttempt }))).toMatchObject({ revision: 1 });
    expect(await store.revision(SCOPE)).toBe(1);
    expect(await raw(workflow, SCOPE)).toHaveLength(1);
  });

  it("11. the resolver seam: the default store is UNAVAILABLE (no repository is bound here; the composition root binds one) and every call fails closed with AGENT_ORCHESTRATION_STORE_UNAVAILABLE; a test injects a store; reset restores the unavailable default; resolve never throws", async () => {
    const unavailable = resolveOrchestrationRunStore();
    await expect(unavailable.revision(SCOPE)).rejects.toThrow(/AGENT_ORCHESTRATION_STORE_UNAVAILABLE/);
    await expect(unavailable.history(SCOPE)).rejects.toThrow(/AGENT_ORCHESTRATION_STORE_UNAVAILABLE/);
    await expect(unavailable.append(append())).rejects.toThrow(/AGENT_ORCHESTRATION_STORE_UNAVAILABLE/);
    const injected = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
    setOrchestrationRunStoreFactory(() => injected);
    expect(resolveOrchestrationRunStore()).toBe(injected);
    expect(await resolveOrchestrationRunStore().revision(SCOPE)).toBe(0);
    setOrchestrationRunStoreFactory(() => { throw new Error("a factory that throws"); });
    await expect(resolveOrchestrationRunStore().revision(SCOPE)).rejects.toThrow(/AGENT_ORCHESTRATION_STORE_UNAVAILABLE/);
    resetOrchestrationRunStoreFactory();
    await expect(resolveOrchestrationRunStore().revision(SCOPE)).rejects.toThrow(/AGENT_ORCHESTRATION_STORE_UNAVAILABLE/);
  });

  it("12. the module read as text: its imports are the durable substrate's pure modules, the engineering digest, the contracts, the capture and the redaction - never the durable runtime (whose production path reaches a provider SDK, D21-32); the commit's outbox is spelled empty and no event type or topic exists; one mismatch sentence, one unavailable sentence, one scope-invalid sentence; no provider SDK; nothing that names a route, an executor, a grant, an approval, a release, a qualification or a minter", () => {
    const source = read(MODULE);
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]!).sort();
    expect(imports).toEqual(["../../durable-workflow/stable", "../../durable-workflow/types", "../../engineering/stable", "../plain-capture", "../redaction", "./contracts", "./trace-attribution"]); // [B21 E2b] + ./trace-attribution (a reviewed pin move: every durable record binds the per-task trace store on its own repository; that module reaches no durable runtime - the A gate walks its closure, case 2)
    expect(source).toMatch(/^import type \{[^}]*\} from "\.\.\/\.\.\/durable-workflow\/types";$/m);
    expect(source).not.toContain(["durable-workflow/", "runtime"].join(""));
    expect(source).toContain("outbox: [],");
    expect(source).not.toMatch(/eventType|topic:|eventVersion/);
    expect(source.match(/AGENT_ORCHESTRATION_RECORD_MISMATCH/g)).toHaveLength(1);
    expect(source.match(/AGENT_ORCHESTRATION_STORE_UNAVAILABLE/g)).toHaveLength(1);
    expect(source.match(/AGENT_ORCHESTRATION_SCOPE_INVALID/g)).toHaveLength(1);
    expect(source).not.toMatch(/from\s+["'](?:openai|@anthropic-ai\/sdk)/);
    expect(source).not.toMatch(/\bOpenAI\b|\bAnthropic\b/);
    for (const subject of [["rou", "te"].join(""), ["execu", "tor"].join(""), ["gra", "nt"].join(""), ["appro", "v"].join(""), ["relea", "se"].join(""), ["quali", "f"].join(""), ["min", "ter"].join(""), ["app/", "api"].join("")]) {
      expect(source.toLowerCase().includes(subject), subject).toBe(false);
    }
    const returned = new Set([...source.matchAll(/refuse\("([a-z_]+)"/g)].map((match) => match[1]!));
    expect([...returned].sort()).toEqual([...ORCHESTRATION_STORE_REFUSALS].filter((code) => code !== "stale_revision").sort());
  });

  it("13. [B21 A review] the replay partition is per run: two task attempts of two runs whose ids carry `:` build the IDENTICAL key text (`run` + `t:0` and `run:t` + `0`), and neither replays the other - each is its own commit in its own run, and only a retry of the same run replays", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationRunStore(workflow);
    const runA: OrchestrationRunScope = { ...SCOPE, runId: "run" };
    const runB: OrchestrationRunScope = { ...SCOPE, runId: "run:t" };
    expect(orchestrationIdempotencyKey("run", "t:0", 0, "decision")).toBe(orchestrationIdempotencyKey("run:t", "0", 0, "decision"));
    expect(orchestrationReplayScopeKey(runA)).not.toBe(orchestrationReplayScopeKey(runB));
    const first = await ok(store, append({ scope: runA, taskId: "t:0" }));
    const second = await ok(store, append({ scope: runB, taskId: "0", record: decision({ reason: "the second run's own decision" }) }));
    expect(second).toMatchObject({ revision: 1, replayed: false });
    expect(second.recordDigest).not.toBe(first.recordDigest);
    expect((await store.history(runB)).map((entry) => `${entry.taskId}:${(entry.record as { reason: string }).reason}`)).toEqual(["0:the second run's own decision"]);
    expect((await store.history(runA)).map((entry) => entry.taskId)).toEqual(["t:0"]);
    // a retry of the SAME run and task attempt still replays
    expect(await store.append(append({ scope: runB, taskId: "0", record: decision({ reason: "retried" }) }))).toEqual({ ok: true, revision: 1, recordDigest: second.recordDigest, replayed: true });
    expect(await store.history(runB)).toHaveLength(1);
  });

  it("14. [B21 A review] a malformed scope on the READ path throws the one documented sentence AGENT_ORCHESTRATION_SCOPE_INVALID from revision() and from history() - never an internal refusal code, never a TypeError: an empty tenant, a run id with a space, a credential-shaped run id, a non-object, null and a revoked Proxy; the write path answers the same scope with a closed `invalid_record`", async () => {
    const store = new DurableOrchestrationRunStore(new InMemoryDurableWorkflowRepository());
    const { proxy: revokedScope, revoke } = Proxy.revocable({ ...SCOPE }, {});
    revoke();
    const malformed: Array<[string, unknown]> = [["empty tenant", { ...SCOPE, tenantId: "" }], ["run id with a space", { ...SCOPE, runId: "run 1" }], ["credential-shaped run id", { ...SCOPE, runId: keyShaped() }], ["a string", "scope"], ["null", null], ["revoked Proxy", revokedScope]];
    for (const [label, scope] of malformed) {
      await expect(store.revision(scope as OrchestrationRunScope), label).rejects.toThrow(/^AGENT_ORCHESTRATION_SCOPE_INVALID$/);
      await expect(store.history(scope as OrchestrationRunScope), label).rejects.toThrow(/^AGENT_ORCHESTRATION_SCOPE_INVALID$/);
    }
    expect(await store.append(append({ scope: { ...SCOPE, runId: "run 1" } }))).toMatchObject({ ok: false, code: "invalid_record", path: "$.scope.runId" });
    expect(await store.revision(SCOPE)).toBe(0);
  });

  it("15. [B21 A review] a stored request is bound to the run and task it is appended under, and a stored result to the request it answers: a request whose document names another task or another project refuses `invalid_record` at the document's field; a result with no request of the same task attempt in this run, one under another attempt than its request, and one whose role is not the requested role each refuse `invalid_record`; the bound result carries `requestDigest`, the answered request's whole-body digest; nothing is written on a refusal", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationRunStore(workflow);
    const { request, result } = validated();
    const foreignTask = validated({ request: { taskId: "task-9" } }).request;
    const foreignProject = validated({ request: { scope: { ...REQUEST_SCOPE, projectId: "other" } } }).request;
    const otherRole = validated({ result: { role: "schematic" } }).result;
    // a request is bound to its run and task
    expect(await store.append(append({ record: { kind: "request", document: foreignTask } }))).toMatchObject({ ok: false, code: "invalid_record", path: "$.record.document.taskId" });
    expect(await store.append(append({ taskId: "task-9", record: { kind: "request", document: request } }))).toMatchObject({ ok: false, code: "invalid_record", path: "$.record.document.taskId" });
    expect(await store.append(append({ record: { kind: "request", document: foreignProject } }))).toMatchObject({ ok: false, code: "invalid_record", path: "$.record.document.scope" });
    expect(await store.append(append({ scope: { ...SCOPE, projectId: "other" }, record: { kind: "request", document: request } }))).toMatchObject({ ok: false, code: "invalid_record", path: "$.record.document.scope" });
    // a result answers exactly one request of this run: none yet
    expect(await store.append(append({ record: { kind: "result", document: result } }))).toMatchObject({ ok: false, code: "invalid_record", path: "$.record.document" });
    expect(await store.revision(SCOPE)).toBe(0);
    expect(await raw(workflow, SCOPE)).toEqual([]);
    // the request lands; a result under another attempt, another task or another role still answers no request
    const stored = await ok(store, append({ record: { kind: "request", document: request } }));
    expect(await store.append(append({ expectedRevision: 1, attempt: 1, record: { kind: "result", document: result } }))).toMatchObject({ ok: false, code: "invalid_record", path: "$.record.document" });
    expect(await store.append(append({ expectedRevision: 1, taskId: "task-2", record: { kind: "result", document: result } }))).toMatchObject({ ok: false, code: "invalid_record", path: "$.record.document" });
    expect(await store.append(append({ expectedRevision: 1, record: { kind: "result", document: otherRole } }))).toMatchObject({ ok: false, code: "invalid_record", path: "$.record.document.role" });
    expect(await store.revision(SCOPE)).toBe(1);
    // the answering result is bound to the request by digest
    await ok(store, append({ expectedRevision: 1, record: { kind: "result", document: result } }));
    const history = await store.history(SCOPE);
    expect(history[0]!.recordDigest).toBe(stored.recordDigest);
    expect(history[1]!.record).toMatchObject({ kind: "result", requestDigest: validatedDigestOf(request)!.digest });
    // a result of another run never answers this run's request
    expect(await store.append(append({ scope: { ...SCOPE, runId: "run-2" }, record: { kind: "result", document: result } }))).toMatchObject({ ok: false, code: "invalid_record", path: "$.record.document" });
    expect(await store.history({ ...SCOPE, runId: "run-2" })).toEqual([]);
  });
});
