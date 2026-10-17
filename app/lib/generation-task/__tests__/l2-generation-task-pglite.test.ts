/**
 * [PR-L, 2026-10-17] Increment 2 on PostgreSQL (runbook L.2; task-worker-contract.md sections 1-3, 3.4): the generation-task store's
 * core properties over `PostgresDurableWorkflowRepository` against a real, migrated PostgreSQL (PGlite, in process, nothing on disk).
 * No real database is contacted: the database client is the PGlite instance below (the b24-c1-durable-records-pglite pattern).
 *
 *  S1. an outbox effect's later `availableAt` is stored and honoured by the claim; an earlier or unparseable one rolls the whole
 *      commit back (no head, record, outbox row or replay);
 *  S2. the fenced lease renewal: a held, unexpired lease of its scope, owner and token only; a lapsed, re-claimed, foreign or
 *      completed one is DW_OUTBOX_LEASE_LOST and changes nothing;
 *  A-H. the SAME scenarios the in-memory suite runs (`_l2-store-scenarios.ts`): start/attach idempotency and the one-active-task
 *      index CAS, the uniform foreign-scope refusal, claim/renew/end with fencing and the never-referenced late writer, stale
 *      events, ambiguous commits, a RESTART (`vi.resetModules()` and fresh modules over the same database), the S1 delayed slice,
 *      and cancellation.
 *
 * Stated limits (RECORDED): PGlite is one connection running one transaction at a time, so the races here interleave the store's
 * reads and commits, not two server transactions (the B23-B2 statement); a real server restart is not exercised. Each scenario
 * first settles leftover slice events (a worker's claim is cross-scope by design). This suite starts PostgreSQL, so it lives outside
 * every prompt-to-gerber directory filter; its database-delivery workflow entry is a separate, line-pinned workflow edit (F20) that
 * increment 2 does not make.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../db/schema";
import { loadMigrationManifest } from "../../db/migrations/manifest";
import { migrateDatabase } from "../../db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "../../db/disposable-postgres";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../../db/client", () => ({ getDb: () => orm }));

import { PostgresDurableWorkflowRepository } from "../../durable-workflow/server-repository";
import { durableAggregateIdentity } from "../../durable-workflow/stable";
import { GENERATION_SLICE_TOPIC } from "../contracts";
import type { GenerationTaskStore } from "../store";
import {
  scenarioAmbiguousCommits, scenarioCancel, scenarioDelayedSlice, scenarioForeignScope, scenarioRestart, scenarioSlicesAndFencing, scenarioStaleEvents, scenarioStartAndAttach, type L2StoreEnv,
} from "./_l2-store-scenarios";

const env: L2StoreEnv = {
  name: "pglite",
  repository: () => new PostgresDurableWorkflowRepository(),
  restarted: async (_repository, options) => {
    vi.resetModules(); // the process singletons and module state are dropped; the database is kept
    const [{ PostgresDurableWorkflowRepository: FreshRepository }, { GenerationTaskStore: FreshStore }] = await Promise.all([import("../../durable-workflow/server-repository"), import("../store")]);
    return new FreshStore({ repository: new FreshRepository(), ...options }) as unknown as GenerationTaskStore;
  },
  quiesce: async () => {
    await pg.db.query("update durable_workflow_outbox set state = 'completed', lease_owner = null, lease_token = null, lease_expires_at = null, completed_at = now() where topic = $1 and state in ('pending', 'processing')", [GENERATION_SLICE_TOPIC]);
  },
};

const SCOPE = { tenantId: "tenant-l2-pglite-substrate", projectId: "project-l2", branchId: "main" };
const OTHER = { ...SCOPE, tenantId: "tenant-l2-pglite-other" };
/** one topic per case: a case's leftover leased event must not be claimed by the next case */
const TOPIC = { s1: "l2.pglite.substrate.s1", s2: "l2.pglite.substrate.s2" } as const;
const owner = (key: string) => ({ aggregateType: "l2.pglite.owner.v1", aggregateKey: key });
const effect = (key: string, topic: string, availableAt?: string) => ({ owner: owner(key), eventType: "l2.pglite.effect", eventVersion: 1, topic, payload: { key }, ...(availableAt === undefined ? {} : { availableAt }) });
async function count(table: string, tenantId = SCOPE.tenantId): Promise<number> {
  return (await pg.db.query<{ n: number }>(`select count(*)::int as n from ${table} where tenant_id = $1`, [tenantId])).rows[0]!.n;
}

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
}, 120_000);
afterAll(async () => { await pg?.close(); });

describe("[PR-L I2] the S1/S2 substrate on PostgreSQL (PGlite)", () => {
  it("S1. a later availableAt is stored and honoured by the claim; an earlier or unparseable one rolls the whole commit back", { timeout: 60_000 }, async () => {
    const repository = new PostgresDurableWorkflowRepository(), at = "2026-10-17T12:00:00.000Z", later = "2026-10-17T12:01:30.000Z";
    const committed = await repository.commit({ scope: SCOPE, scopeKey: "l2-s1", idempotencyKey: "delayed", operations: [{ ...owner("s1"), expectedRevision: 0, payload: { value: 1 } }], outbox: [effect("s1", TOPIC.s1, later)], result: {}, committedAt: at });
    expect(committed.outbox[0]).toMatchObject({ availableAt: later, createdAt: at, state: "pending" });
    const stored = await pg.db.query<{ available_at: Date }>("select available_at from durable_workflow_outbox where event_id = $1", [committed.outbox[0]!.eventId]);
    expect(new Date(stored.rows[0]!.available_at).toISOString()).toBe(later);
    expect(await repository.claimOutbox({ workerId: "w", now: "2026-10-17T12:01:29.999Z", leaseUntil: "2026-10-17T12:02:15.000Z", limit: 5, topics: [TOPIC.s1] })).toEqual([]);
    expect((await repository.claimOutbox({ workerId: "w", now: later, leaseUntil: "2026-10-17T12:02:15.000Z", limit: 5, topics: [TOPIC.s1] })).map((event) => event.eventId)).toEqual([committed.outbox[0]!.eventId]);
    const before = [await count("durable_workflow_heads"), await count("durable_workflow_records"), await count("durable_workflow_outbox"), await count("durable_workflow_replays")];
    for (const [n, bad] of ["2026-10-17T11:59:59.999Z", "not-a-time"].entries()) {
      await expect(repository.commit({ scope: SCOPE, scopeKey: "l2-s1", idempotencyKey: `bad-${n}`, operations: [{ ...owner(`bad-${n}`), expectedRevision: 0, payload: { value: n } }], outbox: [effect(`bad-${n}`, TOPIC.s1, bad)], result: {}, committedAt: at })).rejects.toThrow("DW_OUTBOX_AVAILABLE_AT_INVALID");
      expect(await repository.loadHead(durableAggregateIdentity(SCOPE, owner(`bad-${n}`).aggregateType, `bad-${n}`))).toBeNull();
      expect(await repository.getReplay(SCOPE, "l2-s1", `bad-${n}`)).toBeNull();
    }
    expect([await count("durable_workflow_heads"), await count("durable_workflow_records"), await count("durable_workflow_outbox"), await count("durable_workflow_replays")]).toEqual(before);
  });

  it("S2. a held, unexpired lease renews by one fenced update; a lapsed, re-claimed, foreign, wrong-token or completed lease is DW_OUTBOX_LEASE_LOST and changes nothing", { timeout: 60_000 }, async () => {
    const repository = new PostgresDurableWorkflowRepository();
    await repository.commit({ scope: SCOPE, scopeKey: "l2-s2", idempotencyKey: "one", operations: [{ ...owner("s2"), expectedRevision: 0, payload: { value: 1 } }], outbox: [effect("s2", TOPIC.s2)], result: {}, committedAt: "2026-10-17T13:00:00.000Z" });
    const held = (await repository.claimOutbox({ workerId: "worker-a", now: "2026-10-17T13:00:01.000Z", leaseUntil: "2026-10-17T13:00:46.000Z", limit: 1, topics: [TOPIC.s2] }))[0]!;
    const lease = async () => (await pg.db.query<{ lease_owner: string; lease_token: string; lease_expires_at: Date }>("select lease_owner, lease_token, lease_expires_at from durable_workflow_outbox where event_id = $1", [held.eventId])).rows[0]!;
    const renew = (input: Partial<{ scope: typeof SCOPE; workerId: string; leaseToken: string; now: string; leaseUntil: string }> = {}) => repository.renewOutboxLease({ scope: SCOPE, eventId: held.eventId, workerId: "worker-a", leaseToken: held.leaseToken!, now: "2026-10-17T13:00:16.000Z", leaseUntil: "2026-10-17T13:01:01.000Z", ...input });
    await renew();
    expect(new Date((await lease()).lease_expires_at).toISOString()).toBe("2026-10-17T13:01:01.000Z");
    expect(await repository.claimOutbox({ workerId: "worker-b", now: "2026-10-17T13:00:47.000Z", leaseUntil: "2026-10-17T13:01:30.000Z", limit: 1, topics: [TOPIC.s2] })).toEqual([]);
    for (const wrong of [{ leaseToken: "durable-lease:00000000000000000000000000000000" }, { workerId: "worker-b" }, { scope: OTHER }]) await expect(renew(wrong)).rejects.toThrow("DW_OUTBOX_LEASE_LOST");
    await expect(renew({ now: "2026-10-17T13:00:20.000Z", leaseUntil: "2026-10-17T13:00:20.000Z" })).rejects.toThrow("DW_OUTBOX_LEASE_INVALID");
    await expect(renew({ now: "2026-10-17T13:01:01.000Z", leaseUntil: "2026-10-17T13:02:00.000Z" })).rejects.toThrow("DW_OUTBOX_LEASE_LOST"); // lapsed: lost even before anyone reclaims it
    expect(new Date((await lease()).lease_expires_at).toISOString()).toBe("2026-10-17T13:01:01.000Z");
    const taken = (await repository.claimOutbox({ workerId: "worker-b", now: "2026-10-17T13:01:02.000Z", leaseUntil: "2026-10-17T13:01:47.000Z", limit: 1, topics: [TOPIC.s2] }))[0]!;
    expect(taken).toMatchObject({ leaseOwner: "worker-b", attempts: 2 });
    await expect(renew({ now: "2026-10-17T13:01:03.000Z", leaseUntil: "2026-10-17T13:01:50.000Z" })).rejects.toThrow("DW_OUTBOX_LEASE_LOST");
    expect(await lease()).toMatchObject({ lease_owner: "worker-b", lease_token: taken.leaseToken });
    await repository.completeOutbox({ scope: SCOPE, eventId: held.eventId, workerId: "worker-b", leaseToken: taken.leaseToken!, completedAt: "2026-10-17T13:01:04.000Z" });
    await expect(repository.renewOutboxLease({ scope: SCOPE, eventId: held.eventId, workerId: "worker-b", leaseToken: taken.leaseToken!, now: "2026-10-17T13:01:05.000Z", leaseUntil: "2026-10-17T13:01:50.000Z" })).rejects.toThrow("DW_OUTBOX_LEASE_LOST");
  });
});

describe("[PR-L I2] generation-task store on PostgreSQL (PGlite)", () => {
  it("A. start and attach: idempotent by (scope, principal, clientRequestId); a different request digest is refused; one active task per scope", { timeout: 60_000 }, () => scenarioStartAndAttach(env));
  it("B. a foreign scope's task id, an unknown id and a malformed id are the SAME refusal", { timeout: 60_000 }, () => scenarioForeignScope(env));
  it("C. slices: claim, renew and end; a fenced-out writer writes nothing; a late writer's revision is never referenced", { timeout: 60_000 }, () => scenarioSlicesAndFencing(env));
  it("D. a redelivered slice event is a no-op and a repeated end answers its replay", { timeout: 60_000 }, () => scenarioStaleEvents(env));
  it("E. an ambiguous commit is retried with the same key and applied once", { timeout: 60_000 }, () => scenarioAmbiguousCommits(env));
  it("G. S1: a delayed slice is scheduled with its checkpoint and is not claimable before its time", { timeout: 60_000 }, () => scenarioDelayedSlice(env));
  it("H. cancel: owners stop and settle, late results are fenced, a cancelled task is never resumed", { timeout: 60_000 }, () => scenarioCancel(env));
  // last: it resets the module registry (a restarted process)
  it("F. checkpoints, saved blocks and facts survive a RESTART (fresh modules over the same database); a lapsed slice resumes from its checkpoint", { timeout: 120_000 }, async () => {
    await scenarioRestart(env);
    expect(await count("durable_workflow_heads", "tenant-l2-pglite")).toBeGreaterThan(0); // the scenarios wrote to the real tables
  });
});
