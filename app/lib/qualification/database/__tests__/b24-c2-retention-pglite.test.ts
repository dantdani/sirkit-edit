/**
 * [B24-C2] The purge on PostgreSQL (D24-13, OD-202; OD-201): `PostgresRetentionPort` and `runRetentionCli` against a real, migrated
 * PostgreSQL (PGlite, in process, nothing on disk) holding synthetic expired and fresh aggregates of every purgeable class, an expired
 * aggregate of a kept class, an expired aggregate with a completed outbox row, a mixed commit and an in-flight outbox row. No real
 * database is contacted: the database client is the PGlite instance below (the B23-B2 and B24-C1 precedent); this is the ONLY place the
 * purge ever runs (OD-191, LB-14).
 *
 *  1. the dry run lists the plan and deletes nothing: every row count is unchanged;
 *  2. the apply at the dry run's `--as-of` with its digest deletes exactly the plan - heads, records, replays and outbox rows of the
 *     purgeable expired aggregates - and no surviving row holds a purged payload;
 *  3. the kept classes and the fresh aggregates are untouched, row for row;
 *  4. an aggregate with a COMPLETED outbox row is purged whole in one transaction and nothing dangles (0024's deferred foreign keys hold
 *     at commit: no record without its head, no head without its record, no outbox row without its owner record);
 *  5. a `mixed_commit` (a replay row that also references a kept record) and an `outbox_in_flight` (a pending outbox row) are refused and
 *     left whole - never a partial chain; a second apply with the first digest is refused (the set moved), a fresh dry run plans only the
 *     two refused aggregates, and still refuses them;
 *  6. `head_moved` by the port itself ([B24-C2 review, 2026-10-09]): a planned target whose head moved (revision 2 landed through the
 *     repository), whose record set differs from the plan's, or whose replay set grew (a replay row referencing a planned record landed) is
 *     refused inside the transaction and left whole; a fresh plan then purges what is still expired.
 *
 * Stated limit (RECORDED): PGlite is one connection running one transaction at a time, so the per-aggregate transaction is proven for its
 * atomicity under the deferred constraints, not against an interleaved writer. This suite starts PostgreSQL, so it lives outside every
 * prompt-to-gerber directory filter and runs in the database-delivery job by an explicit entry (b19-e-ci-job-scope).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../../db/schema";
import { loadMigrationManifest } from "../../../db/migrations/manifest";
import { migrateDatabase } from "../../../db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "../../../db/disposable-postgres";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../../../db/client", () => ({ getDb: () => orm }));

import { PostgresDurableWorkflowRepository } from "../../../durable-workflow/server-repository";
import { durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../../../durable-workflow/stable";
import type { DurableWorkflowScope } from "../../../durable-workflow/types";
import { PostgresRetentionPort, RETENTION_LIMITS, applyRetention, planRetention } from "../../../durable-workflow/retention";
import { RETENTION_CLI_EXIT, runRetentionCli } from "../../../durable-workflow/retention-cli";
import { retentionPurgeRows } from "../../../observability/retention-policy";
import { RUN_TRACE_AGGREGATE_TYPE } from "../../../observability/run-trace-store";
import { LLM_CALL_AGGREGATE_TYPE } from "../../../observability/llm-call-record-store";
import { ORCHESTRATION_AGGREGATE_TYPE } from "../../../agent/orchestration/store";

const SCOPE: DurableWorkflowScope = { tenantId: "tenant-b24c2-pglite", projectId: "project-b24c2", branchId: "main" };
const NOW = "2026-10-08T12:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z";
const repository = (): PostgresDurableWorkflowRepository => new PostgresDurableWorkflowRepository();
const keyOf = (aggregateType: string, name: string): string => durableWorkflowId("b24-c2-retention", { ...SCOPE, aggregateType, name });
/** One synthetic aggregate (one record at revision 1) of `aggregateType`, committed at `at`, its payload carrying `sentinel`. */
async function seed(aggregateType: string, name: string, at: string, sentinel: string, options: { outbox?: "none" | "completed" | "pending"; also?: { aggregateType: string; name: string; sentinel: string } } = {}): Promise<string> {
  const aggregateKey = keyOf(aggregateType, name);
  const operations = [{ aggregateType, aggregateKey, expectedRevision: 0, payload: { schema: "sirkit.b24-c2-synthetic.v1", name, sentinel } }];
  if (options.also) operations.push({ aggregateType: options.also.aggregateType, aggregateKey: keyOf(options.also.aggregateType, options.also.name), expectedRevision: 0, payload: { schema: "sirkit.b24-c2-synthetic.v1", name: options.also.name, sentinel: options.also.sentinel } });
  const outbox = options.outbox && options.outbox !== "none" ? [{ owner: { aggregateType, aggregateKey }, eventType: "b24-c2.synthetic", eventVersion: 1, topic: `b24-c2-${options.outbox}`, payload: { sentinel } }] : [];
  const committed = await repository().commit({ scope: SCOPE, scopeKey: durableScopeKey(SCOPE, `b24-c2:${aggregateType}:${name}`), idempotencyKey: `b24-c2:${aggregateType}:${name}`, operations, outbox, result: { name }, committedAt: at });
  if (options.outbox === "completed") {
    const [claimed] = await repository().claimOutbox({ workerId: "b24-c2-worker", now: at, leaseUntil: "2026-01-01T01:00:00.000Z", limit: 10, topics: ["b24-c2-completed"], scope: SCOPE });
    expect(claimed?.eventId).toBe(committed.outbox[0]!.eventId);
    await repository().completeOutbox({ scope: SCOPE, eventId: claimed!.eventId, workerId: "b24-c2-worker", leaseToken: claimed!.leaseToken!, completedAt: at });
  }
  return aggregateKey;
}
type Counts = { heads: number; records: number; replays: number; outbox: number };
async function counts(): Promise<Counts> {
  const one = async (sql: string): Promise<number> => Number((await pg.db.query<{ n: string }>(sql, [SCOPE.tenantId])).rows[0]!.n);
  return { heads: await one("select count(*)::text as n from durable_workflow_heads where tenant_id = $1"), records: await one("select count(*)::text as n from durable_workflow_records where tenant_id = $1"), replays: await one("select count(*)::text as n from durable_workflow_replays where tenant_id = $1"), outbox: await one("select count(*)::text as n from durable_workflow_outbox where tenant_id = $1") };
}
async function rowsHolding(sentinel: string): Promise<Counts> {
  const one = async (sql: string): Promise<number> => Number((await pg.db.query<{ n: string }>(sql, [`%${sentinel}%`])).rows[0]!.n);
  return { heads: 0, records: await one("select count(*)::text as n from durable_workflow_records where payload::text like $1"), replays: await one("select count(*)::text as n from durable_workflow_replays where result::text like $1"), outbox: await one("select count(*)::text as n from durable_workflow_outbox where payload::text like $1") };
}
async function aggregateRows(aggregateType: string, aggregateKey: string): Promise<{ heads: number; records: number }> {
  const one = async (table: string): Promise<number> => Number((await pg.db.query<{ n: string }>(`select count(*)::text as n from ${table} where tenant_id = $1 and aggregate_type = $2 and aggregate_key = $3`, [SCOPE.tenantId, aggregateType, aggregateKey])).rows[0]!.n);
  return { heads: await one("durable_workflow_heads"), records: await one("durable_workflow_records") };
}
/** Dangling rows under 0024's deferred foreign keys: none may survive a committed purge. */
async function dangling(): Promise<{ recordsWithoutHead: number; headsWithoutRecord: number; outboxWithoutOwner: number }> {
  const one = async (sql: string): Promise<number> => Number((await pg.db.query<{ n: string }>(sql)).rows[0]!.n);
  return {
    recordsWithoutHead: await one("select count(*)::text as n from durable_workflow_records r left join durable_workflow_heads h on h.head_id = r.head_id where h.head_id is null"),
    headsWithoutRecord: await one("select count(*)::text as n from durable_workflow_heads h left join durable_workflow_records r on r.record_id = h.record_id where r.record_id is null"),
    outboxWithoutOwner: await one("select count(*)::text as n from durable_workflow_outbox o left join durable_workflow_records r on r.tenant_id = o.tenant_id and r.project_id = o.project_id and r.branch_id = o.branch_id and r.aggregate_type = o.owner_aggregate_type and r.aggregate_key = o.owner_aggregate_key and r.revision = o.owner_aggregate_revision where r.record_id is null"),
  };
}
interface Run { code: number; out: string[]; err: string[] }
async function cli(argv: readonly string[]): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runRetentionCli(argv, { port: new PostgresRetentionPort(), now: () => new Date(NOW), stdout: (line) => out.push(line), stderr: (line) => err.push(line), productionRuntime: false });
  return { code, out, err };
}
const digestOf = (run: Run): string => run.out.find((line) => line.startsWith("planDigest: "))!.slice("planDigest: ".length);

const expired = new Map<string, string>();
const fresh = new Map<string, string>();
let keptOld = "";
let withCompletedOutbox = "";
let mixed = "";
let inFlight = "";
let firstDigest = "";
let before: Counts;

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  for (const row of retentionPurgeRows()) {
    expired.set(row.aggregateType, await seed(row.aggregateType, "expired", OLD, `purge-me-${row.aggregateType}`));
    fresh.set(row.aggregateType, await seed(row.aggregateType, "fresh", NOW, `fresh-${row.aggregateType}`));
  }
  keptOld = await seed(ORCHESTRATION_AGGREGATE_TYPE, "kept-old", OLD, "keep-me-orchestration-run");
  withCompletedOutbox = await seed(RUN_TRACE_AGGREGATE_TYPE, "completed-outbox", OLD, "purge-me-completed-outbox", { outbox: "completed" });
  mixed = await seed(RUN_TRACE_AGGREGATE_TYPE, "mixed", OLD, "mixed-run-trace", { also: { aggregateType: ORCHESTRATION_AGGREGATE_TYPE, name: "mixed-kept", sentinel: "mixed-kept-run" } });
  inFlight = await seed(LLM_CALL_AGGREGATE_TYPE, "in-flight", OLD, "in-flight-call", { outbox: "pending" });
  before = await counts();
}, 180_000);
afterAll(async () => { await pg?.close(); });

describe("[B24-C2] the purge on PostgreSQL (PGlite)", () => {
  it("1. the dry run lists the plan - five purgeable classes, the completed-outbox aggregate among the targets, the mixed commit and the in-flight outbox refused - and deletes nothing: every row count is unchanged", { timeout: 120_000 }, async () => {
    expect(before.heads).toBe(retentionPurgeRows().length * 2 + 5); // 5 expired + 5 fresh + kept-old + completed-outbox + mixed (two aggregates) + in-flight
    const dry = await cli(["--as-of", NOW]);
    expect(dry.code).toBe(RETENTION_CLI_EXIT.ok);
    expect(dry.out[0]).toBe("retention-purge: dry run (nothing is deleted)");
    expect(dry.out.find((line) => line.startsWith(`${RUN_TRACE_AGGREGATE_TYPE} `))).toBe(`${RUN_TRACE_AGGREGATE_TYPE} (90 days, cutoff 2026-07-10T12:00:00.000Z): aggregates 2 purgeable, 1 refused (mixed_commit 1, outbox_in_flight 0); records 2; replays 2; outbox 1`);
    expect(dry.out.find((line) => line.startsWith(`${LLM_CALL_AGGREGATE_TYPE} `))).toBe(`${LLM_CALL_AGGREGATE_TYPE} (90 days, cutoff 2026-07-10T12:00:00.000Z): aggregates 1 purgeable, 1 refused (mixed_commit 0, outbox_in_flight 1); records 1; replays 1; outbox 0`);
    expect(digestOf(dry)).toMatch(/^eng1-[0-9a-f]{16}$/);
    expect(await counts()).toEqual(before);
    const plan = await planRetention(new PostgresRetentionPort(), { rows: retentionPurgeRows(), asOf: NOW, limit: RETENTION_LIMITS.default });
    expect(plan.targets.map((target) => target.aggregateKey).sort()).toEqual([...expired.values(), withCompletedOutbox].sort());
    expect(plan.targets.every((target) => target.headRevision === 1 && target.recordIds.length === 1 && target.replayIds.length === 1)).toBe(true);
    expect(plan.rows.reduce((sum, row) => sum + row.refused.mixed_commit + row.refused.outbox_in_flight, 0)).toBe(2);
  });

  it("2. the apply at the dry run's --as-of with its digest deletes exactly the plan: the expired purgeable aggregates' heads, records, replays and outbox rows are gone, and no surviving row holds a purged payload", { timeout: 120_000 }, async () => {
    const dry = await cli(["--as-of", NOW]);
    firstDigest = digestOf(dry);
    const applied = await cli(["--apply", "--confirm", firstDigest, "--as-of", NOW]);
    expect(applied.code).toBe(RETENTION_CLI_EXIT.ok);
    expect(applied.out[0]).toBe("retention-purge: APPLY");
    expect(applied.out.at(-1)).toBe("deleted: aggregates 6, records 6, replays 6, outbox 1; refused: mixed_commit 0, outbox_in_flight 0, head_moved 0, not_found 0");
    for (const [aggregateType, aggregateKey] of expired) expect(await aggregateRows(aggregateType, aggregateKey), aggregateType).toEqual({ heads: 0, records: 0 });
    expect(await aggregateRows(RUN_TRACE_AGGREGATE_TYPE, withCompletedOutbox)).toEqual({ heads: 0, records: 0 });
    for (const sentinel of [...retentionPurgeRows().map((row) => `purge-me-${row.aggregateType}`), "purge-me-completed-outbox"]) expect(await rowsHolding(sentinel), sentinel).toEqual({ heads: 0, records: 0, replays: 0, outbox: 0 });
    const after = await counts();
    expect(after).toEqual({ heads: before.heads - 6, records: before.records - 6, replays: before.replays - 6, outbox: before.outbox - 1 });
  });

  it("3. the kept classes and the fresh aggregates are untouched, row for row", { timeout: 60_000 }, async () => {
    for (const [aggregateType, aggregateKey] of fresh) {
      expect(await aggregateRows(aggregateType, aggregateKey), aggregateType).toEqual({ heads: 1, records: 1 });
      expect(await rowsHolding(`fresh-${aggregateType}`), aggregateType).toMatchObject({ records: 1, replays: 1 });
    }
    expect(await aggregateRows(ORCHESTRATION_AGGREGATE_TYPE, keptOld)).toEqual({ heads: 1, records: 1 });
    expect(await rowsHolding("keep-me-orchestration-run")).toMatchObject({ records: 1, replays: 1 });
  });

  it("4. the aggregate with a completed outbox row was purged whole in one transaction and nothing dangles: no record without its head, no head without its record, no outbox row without its owner record (0024's deferred foreign keys held at commit)", { timeout: 60_000 }, async () => {
    expect(await dangling()).toEqual({ recordsWithoutHead: 0, headsWithoutRecord: 0, outboxWithoutOwner: 0 });
    const outbox = await pg.db.query<{ n: string }>("select count(*)::text as n from durable_workflow_outbox where tenant_id = $1 and owner_aggregate_key = $2", [SCOPE.tenantId, withCompletedOutbox]);
    expect(outbox.rows).toEqual([{ n: "0" }]);
    // the port's own purge of an aggregate that is not there is `not_found`, and nothing changes
    const port = new PostgresRetentionPort();
    expect(await port.purgeAggregate({ scope: SCOPE, aggregateType: RUN_TRACE_AGGREGATE_TYPE, aggregateKey: withCompletedOutbox, headRevision: 1, recordIds: ["gone"], replayIds: [] })).toEqual({ ok: false, code: "not_found" });
    expect(await dangling()).toEqual({ recordsWithoutHead: 0, headsWithoutRecord: 0, outboxWithoutOwner: 0 });
  });

  it("5. a mixed commit and an in-flight outbox are refused and left whole; the first digest no longer confirms (the set moved); a fresh dry run plans only the two refusals and an apply of it deletes nothing of them - never a partial chain", { timeout: 120_000 }, async () => {
    const mixedIdentity = durableAggregateIdentity(SCOPE, RUN_TRACE_AGGREGATE_TYPE, mixed);
    expect(await aggregateRows(RUN_TRACE_AGGREGATE_TYPE, mixed)).toEqual({ heads: 1, records: 1 });
    expect(await aggregateRows(ORCHESTRATION_AGGREGATE_TYPE, keyOf(ORCHESTRATION_AGGREGATE_TYPE, "mixed-kept"))).toEqual({ heads: 1, records: 1 });
    expect(await rowsHolding("mixed-run-trace")).toMatchObject({ records: 1, replays: 1 });
    expect(await aggregateRows(LLM_CALL_AGGREGATE_TYPE, inFlight)).toEqual({ heads: 1, records: 1 });
    const pending = await pg.db.query<{ state: string }>("select state from durable_workflow_outbox where tenant_id = $1 and owner_aggregate_key = $2", [SCOPE.tenantId, inFlight]);
    expect(pending.rows).toEqual([{ state: "pending" }]);
    const port = new PostgresRetentionPort();
    const [mixedInventory] = await port.expiredAggregates({ aggregateType: RUN_TRACE_AGGREGATE_TYPE, cutoff: NOW, limit: 100 });
    expect(mixedInventory).toMatchObject({ aggregateKey: mixed, mixedCommit: true, headRevision: 1 });
    expect(await port.purgeAggregate({ scope: SCOPE, aggregateType: RUN_TRACE_AGGREGATE_TYPE, aggregateKey: mixed, headRevision: 1, recordIds: mixedInventory!.recordIds, replayIds: mixedInventory!.replayIds })).toEqual({ ok: false, code: "mixed_commit" });
    const [flightInventory] = await port.expiredAggregates({ aggregateType: LLM_CALL_AGGREGATE_TYPE, cutoff: NOW, limit: 100 });
    expect(flightInventory).toMatchObject({ aggregateKey: inFlight, outbox: { terminal: 0, inFlight: 1 } });
    expect(await port.purgeAggregate({ scope: SCOPE, aggregateType: LLM_CALL_AGGREGATE_TYPE, aggregateKey: inFlight, headRevision: 1, recordIds: flightInventory!.recordIds, replayIds: flightInventory!.replayIds })).toEqual({ ok: false, code: "outbox_in_flight" });
    expect(await repository().loadHead(mixedIdentity)).toMatchObject({ revision: 1 });
    const stale = await cli(["--apply", "--confirm", firstDigest, "--as-of", NOW]); // the first dry run's digest: its set is gone, so the confirmation no longer matches
    expect(stale.code).toBe(RETENTION_CLI_EXIT.refused);
    expect(stale.err.join(" ")).toContain("RETENTION_CONFIRMATION_MISMATCH");
    const dry = await cli(["--as-of", NOW]);
    expect(dry.out.find((line) => line.startsWith(`${RUN_TRACE_AGGREGATE_TYPE} `))).toContain("aggregates 0 purgeable, 1 refused (mixed_commit 1, outbox_in_flight 0)");
    expect(dry.out.find((line) => line.startsWith(`${LLM_CALL_AGGREGATE_TYPE} `))).toContain("aggregates 0 purgeable, 1 refused (mixed_commit 0, outbox_in_flight 1)");
    const applied = await cli(["--apply", "--confirm", digestOf(dry), "--as-of", NOW]);
    expect(applied.code).toBe(RETENTION_CLI_EXIT.ok);
    expect(applied.out.at(-1)).toBe("deleted: aggregates 0, records 0, replays 0, outbox 0; refused: mixed_commit 0, outbox_in_flight 0, head_moved 0, not_found 0");
    const countsNow = await counts();
    expect(countsNow.heads).toBe(before.heads - 6);
    expect(await aggregateRows(RUN_TRACE_AGGREGATE_TYPE, mixed)).toEqual({ heads: 1, records: 1 });
    expect(await aggregateRows(LLM_CALL_AGGREGATE_TYPE, inFlight)).toEqual({ heads: 1, records: 1 });
    expect(await dangling()).toEqual({ recordsWithoutHead: 0, headsWithoutRecord: 0, outboxWithoutOwner: 0 });
  });

  it("6. [B24-C2 review, 2026-10-09] head_moved on PostgreSQL, by the port itself: a planned target whose head moved (a resumed run wrote revision 2 through the repository), whose record set differs from the plan's, or whose replay set grew (a replay row referencing a planned record landed between planning and purging) is refused inside the transaction and left whole, never a partial chain; a fresh plan then purges what is still expired, the landed replay row with it", { timeout: 120_000 }, async () => {
    const port = new PostgresRetentionPort();
    const movedHead = await seed(RUN_TRACE_AGGREGATE_TYPE, "head-moved-revision", OLD, "head-moved-revision");
    const movedRecords = await seed(RUN_TRACE_AGGREGATE_TYPE, "head-moved-records", OLD, "head-moved-records");
    const movedReplays = await seed(LLM_CALL_AGGREGATE_TYPE, "head-moved-replays", OLD, "head-moved-replays");
    const plan = await planRetention(port, { rows: retentionPurgeRows(), asOf: NOW, limit: RETENTION_LIMITS.default });
    expect(plan.targets.map((target) => target.aggregateKey).sort()).toEqual([movedHead, movedRecords, movedReplays].sort());
    expect(plan.targets.every((target) => target.headRevision === 1 && target.recordIds.length === 1 && target.replayIds.length === 1)).toBe(true);
    // (a) the head moved: a resumed run commits revision 2 through the repository after the plan (and refreshes updated_at)
    await repository().commit({ scope: SCOPE, scopeKey: durableScopeKey(SCOPE, "b24-c2:head-moved-revision:2"), idempotencyKey: "b24-c2:head-moved-revision:2", operations: [{ aggregateType: RUN_TRACE_AGGREGATE_TYPE, aggregateKey: movedHead, expectedRevision: 1, payload: { schema: "sirkit.b24-c2-synthetic.v1", name: "head-moved-revision", sentinel: "head-moved-revision-2" } }], outbox: [], result: { name: "head-moved-revision-2" }, committedAt: NOW });
    expect(await repository().loadHead(durableAggregateIdentity(SCOPE, RUN_TRACE_AGGREGATE_TYPE, movedHead))).toMatchObject({ revision: 2 });
    // (c) a replay row referencing a planned record lands after the plan - planted directly: the repository writes a replay row only with a
    //     commit, which also moves the head, so this is the one way to reach the replay-set guard on its own
    const plannedRecord = plan.targets.find((target) => target.aggregateKey === movedReplays)!.recordIds[0]!;
    await pg.db.query("insert into durable_workflow_replays (replay_id, tenant_id, project_id, branch_id, scope_key, idempotency_key, result, committed_at) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)", ["b24-c2-late-replay", SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId, durableScopeKey(SCOPE, "b24-c2:late-replay"), "b24-c2:late-replay", JSON.stringify({ records: [{ recordId: plannedRecord }], outbox: [], result: { name: "late-replay" }, idempotent: false }), OLD]);
    const lateReplayRows = async (): Promise<number> => Number((await pg.db.query<{ n: string }>("select count(*)::text as n from durable_workflow_replays where replay_id = $1", ["b24-c2-late-replay"])).rows[0]!.n);
    expect(await lateReplayRows()).toBe(1);
    // (b) the plan's record set differs from the chain's (a stale plan)
    const stale = { ...plan, targets: plan.targets.map((target) => (target.aggregateKey === movedRecords ? { ...target, recordIds: [...target.recordIds, "rec1-not-in-the-chain"] } : target)) };
    const beforeApply = await counts();
    expect(await applyRetention(port, stale)).toEqual({ deleted: { aggregates: 0, records: 0, replays: 0, outbox: 0 }, refused: { mixed_commit: 0, outbox_in_flight: 0, head_moved: 3, not_found: 0 } });
    expect(await counts()).toEqual(beforeApply);
    expect(await aggregateRows(RUN_TRACE_AGGREGATE_TYPE, movedHead)).toEqual({ heads: 1, records: 2 });
    expect(await aggregateRows(RUN_TRACE_AGGREGATE_TYPE, movedRecords)).toEqual({ heads: 1, records: 1 });
    expect(await aggregateRows(LLM_CALL_AGGREGATE_TYPE, movedReplays)).toEqual({ heads: 1, records: 1 });
    expect(await lateReplayRows()).toBe(1);
    expect(await dangling()).toEqual({ recordsWithoutHead: 0, headsWithoutRecord: 0, outboxWithoutOwner: 0 });
    // each guard on its own, against the chain as the port now reads it: the revision, the record set, the replay set
    const [inventory] = await port.expiredAggregates({ aggregateType: LLM_CALL_AGGREGATE_TYPE, cutoff: NOW, limit: 100 });
    expect(inventory).toMatchObject({ aggregateKey: movedReplays, headRevision: 1 });
    expect(inventory!.replayIds).toHaveLength(2);
    expect(inventory!.replayIds).toContain("b24-c2-late-replay");
    const current = { scope: inventory!.scope, aggregateType: inventory!.aggregateType, aggregateKey: inventory!.aggregateKey, headRevision: inventory!.headRevision, recordIds: inventory!.recordIds, replayIds: inventory!.replayIds };
    expect(await port.purgeAggregate({ ...current, headRevision: 2 })).toEqual({ ok: false, code: "head_moved" });
    expect(await port.purgeAggregate({ ...current, recordIds: [] })).toEqual({ ok: false, code: "head_moved" });
    expect(await port.purgeAggregate({ ...current, replayIds: current.replayIds.slice(0, 1) })).toEqual({ ok: false, code: "head_moved" });
    expect(await aggregateRows(LLM_CALL_AGGREGATE_TYPE, movedReplays)).toEqual({ heads: 1, records: 1 });
    // a fresh plan sees the moved head as fresh (its updated_at is now) and purges the other two with their current chains, the landed replay row among them
    const dry = await cli(["--as-of", NOW]);
    expect(dry.out.find((line) => line.startsWith(`${LLM_CALL_AGGREGATE_TYPE} `))).toContain("aggregates 1 purgeable, 1 refused (mixed_commit 0, outbox_in_flight 1); records 1; replays 2; outbox 0");
    const fresh = await cli(["--apply", "--confirm", digestOf(dry), "--as-of", NOW]);
    expect(fresh.code).toBe(RETENTION_CLI_EXIT.ok);
    expect(fresh.out.at(-1)).toBe("deleted: aggregates 2, records 2, replays 3, outbox 0; refused: mixed_commit 0, outbox_in_flight 0, head_moved 0, not_found 0");
    expect(await aggregateRows(RUN_TRACE_AGGREGATE_TYPE, movedHead)).toEqual({ heads: 1, records: 2 });
    expect(await rowsHolding("head-moved-revision")).toMatchObject({ records: 2, replays: 2 });
    for (const sentinel of ["head-moved-records", "head-moved-replays"]) expect(await rowsHolding(sentinel), sentinel).toEqual({ heads: 0, records: 0, replays: 0, outbox: 0 });
    expect(await lateReplayRows()).toBe(0);
    expect(await dangling()).toEqual({ recordsWithoutHead: 0, headsWithoutRecord: 0, outboxWithoutOwner: 0 });
  });
});
