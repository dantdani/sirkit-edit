/**
 * [B24-C3] The read mode on PostgreSQL (D24-26, OD-211; OD-201): `runTraceReadCli` with `repositoryFor` constructing
 * `PostgresDurableWorkflowRepository` (as `scripts/retention-purge.ts` does) against a real, migrated PostgreSQL (PGlite, in process,
 * nothing on disk) holding the four kinds, written through their own stores. No real database is contacted: the database client is the
 * PGlite instance below (the B23-B2, B24-C1 and B24-C2 precedent); this is the ONLY place the read mode ever runs against PostgreSQL
 * (OD-191, LB-14).
 *
 *  1. the four kinds round-trip over `PostgresDurableWorkflowRepository`: one record each, the stored digest and the stored payload
 *     (jsonb keeps no key order: equal by content and by digest), exit 0;
 *  2. every table of the migrated schema - enumerated at run time from information_schema (`table_schema = 'public'`, BASE TABLE), the
 *     four durable tables among them - is identical (row count and a digest of every row) before and after a read, a refused read
 *     (a purge flag beside --read; a production runtime unacknowledged) and a read that meets a corrupt row;
 *  3. a payload changed in SQL reads as `corrupt` with its store's code and nothing of it printed; a foreign-scope row is never
 *     returned (listed under its own scope, absent from this one);
 *  4. [B24-C3 review fix, 2026-10-09] the dispatcher `main` of `scripts/retention-purge.ts`, imported and DRIVEN (its entry guard is
 *     false under vitest; its loader, writers, port and close are stubbed; its repository is the real default over the mocked `getDb`):
 *     `--read` reaches the read runner and the PostgreSQL repository, never the retention port; a purge argv runs C2's dry run through
 *     the port and never the loader; `--read` beside a purge flag is refused before the loader; a read flag without `--read` is the
 *     purge parser's refusal; every table identical throughout.
 *
 * Stated limit (RECORDED): PGlite is one connection and runs one transaction at a time, so no interleaved writer is proven against
 * (the B23-B2 statement). This suite starts PostgreSQL, so it lives outside every prompt-to-gerber directory filter and runs in the
 * database-delivery job by an explicit entry (b19-e-ci-job-scope).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../../db/schema";
import { loadMigrationManifest } from "../../../db/migrations/manifest";
import { migrateDatabase } from "../../../db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "../../../db/disposable-postgres";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../../../db/client", () => ({ getDb: () => orm, getSqlClient: () => { throw new Error("b24-c3-trace-read-pglite: no raw client over PGlite (the dispatcher's close is stubbed)"); } }));

import { main } from "../../../../../scripts/retention-purge";
import { PostgresDurableWorkflowRepository } from "../../../durable-workflow/server-repository";
import { PostgresRetentionPort } from "../../../durable-workflow/retention";
import { DurableOrchestrationTraceStore, specialistTraceRunId } from "../../../agent/orchestration/trace-attribution";
import { DurableRunTraceStore, RUN_TRACE_MISMATCH, runTraceAggregateKey } from "../../../observability/run-trace-store";
import { DurableRunTraceAttributionStore, runTraceAttributionAggregateKey } from "../../../observability/run-trace-attribution";
import { DurableLlmCallRecordStore, llmCallAggregateKey } from "../../../observability/llm-call-record-store";
import { TRACE_READ_AGGREGATE_TYPES, TRACE_READ_ENTRY_CODES, TRACE_READ_EXIT, TRACE_READ_EXPORT_KEYS, TRACE_READ_KINDS, runTraceReadCli, specialistTraceAggregateKey, type TraceReadExport, type TraceReadKind } from "../../../observability/trace-read";
import { C3_AT, C3_OTHER_SCOPE, C3_PARENT_RUN, C3_SCOPE, c3Attribution, c3CallRecord, c3SpecialistTrace, c3Trace } from "../../__tests__/_b24-c3-fixtures";

const NOW = "2026-10-09T12:34:56.000Z";
const URL_NAME = ["DATABASE", "URL"].join("_");
const FAKE_URL = `postgres://${["oper", "ator"].join("")}:${["pass", "word"].join("")}@db.invalid:5433/sirkit`;
const repository = (): PostgresDurableWorkflowRepository => new PostgresDurableWorkflowRepository();
const readArgs = (kind: TraceReadKind | string, scope = C3_SCOPE, ...more: string[]): string[] => ["--read", "--kind", kind, "--tenant", scope.tenantId, "--project", scope.projectId, "--branch", scope.branchId, ...more];

interface Run { code: number; out: string[]; err: string[]; document: TraceReadExport | null }
async function cli(argv: readonly string[], options: { production?: boolean } = {}): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runTraceReadCli({ argv, env: { [URL_NAME]: FAKE_URL }, loadEnv: () => {}, stdout: (text) => out.push(text), stderr: (line) => err.push(line), repositoryFor: () => repository(), now: () => new Date(NOW), productionRuntime: () => options.production ?? false });
  return { code, out, err, document: out.length === 1 ? (JSON.parse(out[0]!) as TraceReadExport) : null };
}
/** Every base table of the public schema with its row count and a digest over every row's text, in table order. */
async function snapshot(): Promise<Array<[table: string, rows: string, digest: string]>> {
  const tables = (await pg.db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name")).rows.map((row) => row.table_name);
  const out: Array<[string, string, string]> = [];
  for (const table of tables) {
    const row = (await pg.db.query<{ n: string; d: string }>(`select count(*)::text as n, coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as d from "${table.replace(/"/g, '""')}" t`)).rows[0]!;
    out.push([table, row.n, row.d]);
  }
  return out;
}
const written: Partial<Record<TraceReadKind, { key: string; recordDigest: string }>> = {};
let before: Array<[string, string, string]>;

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  const trace = await new DurableRunTraceStore(repository()).append({ scope: C3_SCOPE, document: c3Trace("run-b24c3-pg", "trace-b24c3-pg-a"), at: C3_AT });
  const attribution = await new DurableRunTraceAttributionStore(repository()).append({ scope: C3_SCOPE, document: c3Attribution("run-b24c3-pg", "trace-b24c3-pg-a"), at: C3_AT });
  const call = await new DurableLlmCallRecordStore(repository()).append({ scope: C3_SCOPE, record: c3CallRecord(7) });
  const specialist = await new DurableOrchestrationTraceStore(repository()).append({ scope: C3_SCOPE, document: c3SpecialistTrace(1, "circuit-topology"), at: C3_AT });
  if (!trace.ok || !attribution.ok || !call.ok || !specialist.ok) throw new Error(`b24-c3 pglite seed refused: ${JSON.stringify({ trace, attribution, call, specialist })}`);
  written["run-trace"] = { key: runTraceAggregateKey(C3_SCOPE, "run-b24c3-pg"), recordDigest: trace.recordDigest };
  written["run-trace-attribution"] = { key: runTraceAttributionAggregateKey(C3_SCOPE, "trace-b24c3-pg-a"), recordDigest: attribution.recordDigest };
  written["llm-call-record"] = { key: llmCallAggregateKey(C3_SCOPE, c3CallRecord(7).callId), recordDigest: call.recordDigest };
  written["specialist-trace"] = { key: specialistTraceAggregateKey(C3_SCOPE, specialistTraceRunId(C3_PARENT_RUN, 1, "circuit-topology")), recordDigest: specialist.recordDigest };
  // a foreign scope's run trace, for case 3
  const foreign = await new DurableRunTraceStore(repository()).append({ scope: C3_OTHER_SCOPE, document: c3Trace("run-b24c3-pg-foreign", "trace-b24c3-pg-foreign", { scope: C3_OTHER_SCOPE }), at: C3_AT });
  if (!foreign.ok) throw new Error("b24-c3 pglite seed refused the foreign trace");
  before = await snapshot();
}, 180_000);
afterAll(async () => { await pg?.close(); });

describe("[B24-C3] the read mode on PostgreSQL (PGlite)", () => {
  it("1. the four kinds round-trip over PostgresDurableWorkflowRepository: one record each with the stored digest and the stored payload, the closed keys, exit 0", { timeout: 120_000 }, async () => {
    for (const kind of TRACE_READ_KINDS) {
      const run = await cli(readArgs(kind));
      expect(run.code, kind).toBe(TRACE_READ_EXIT.ok);
      expect(run.out, kind).toHaveLength(1);
      const document = run.document!;
      expect(Object.keys(document), kind).toEqual([...TRACE_READ_EXPORT_KEYS]);
      expect(document, kind).toMatchObject({ kind, target: "db.invalid:5433/sirkit", scope: C3_SCOPE, accessAudit: "not_recorded", refused: [], truncated: false, omitted: 0 });
      expect(document.records, kind).toHaveLength(1);
      expect(document.records[0], kind).toMatchObject({ key: written[kind]!.key, revision: 1, recordDigest: written[kind]!.recordDigest });
      const row = (await pg.db.query<{ payload: unknown; record_digest: string }>("select payload, record_digest from durable_workflow_records where tenant_id = $1 and aggregate_type = $2 and aggregate_key = $3", [C3_SCOPE.tenantId, TRACE_READ_AGGREGATE_TYPES[kind], written[kind]!.key])).rows;
      expect(row, kind).toHaveLength(1);
      expect(document.records[0]!.document, kind).toEqual(row[0]!.payload); // equal by content (jsonb keeps no key order) ...
      expect(document.records[0]!.recordDigest, kind).toBe(row[0]!.record_digest); // ... and by the digest the store recomputed
    }
  });

  it("2. every table of the migrated schema (the four durable tables among them) is identical, row for row, before and after a read, a refused read and a read that meets a corrupt row", { timeout: 120_000 }, async () => {
    const tables = before.map(([table]) => table);
    expect(tables.length).toBeGreaterThan(20);
    for (const durable of ["durable_workflow_heads", "durable_workflow_records", "durable_workflow_replays", "durable_workflow_outbox"]) expect(tables, durable).toContain(durable);
    expect(before.find(([table]) => table === "durable_workflow_records")![1]).toBe("5"); // the four kinds and the foreign trace
    for (const kind of TRACE_READ_KINDS) expect((await cli(readArgs(kind))).code, kind).toBe(TRACE_READ_EXIT.ok);
    expect((await cli(readArgs("run-trace", C3_SCOPE, "--run", "run-b24c3-pg"))).code).toBe(TRACE_READ_EXIT.ok);
    expect(await snapshot()).toEqual(before);
    // a refused read: a purge flag beside --read, and a production runtime unacknowledged
    const purgeFlag = await cli(readArgs("run-trace", C3_SCOPE, "--apply"));
    expect(purgeFlag.code).toBe(TRACE_READ_EXIT.refused);
    expect(purgeFlag.err.join(" ")).toContain("REFUSED read_arguments_conflict:");
    const production = await cli(readArgs("run-trace"), { production: true });
    expect(production.code).toBe(TRACE_READ_EXIT.refused);
    expect(production.err.join(" ")).toContain("REFUSED read_production_unacknowledged:");
    expect(await snapshot()).toEqual(before);
    // a read that meets a corrupt row (planted in SQL, case 3's edit): the table is as the edit left it, before and after the read
    await pg.db.query("update durable_workflow_records set payload = jsonb_set(payload, '{document,warnings}', $1::jsonb) where tenant_id = $2 and aggregate_type = $3 and aggregate_key = $4", [JSON.stringify(["planted-b24c3-sql"]), C3_SCOPE.tenantId, TRACE_READ_AGGREGATE_TYPES["run-trace"], written["run-trace"]!.key]);
    const edited = await snapshot();
    expect(edited).not.toEqual(before);
    const corrupt = await cli(readArgs("run-trace"));
    expect(corrupt.code).toBe(TRACE_READ_EXIT.failed);
    expect(await snapshot()).toEqual(edited);
  });

  it("3. a payload changed in SQL reads as `corrupt` AGENT_RUN_TRACE_MISMATCH with nothing of it printed; a foreign-scope row is never returned under this scope and is listed under its own", { timeout: 120_000 }, async () => {
    const corrupt = await cli(readArgs("run-trace"));
    expect(corrupt.code).toBe(TRACE_READ_EXIT.failed);
    expect(corrupt.document!.records).toEqual([]);
    expect(corrupt.document!.refused).toEqual([{ key: written["run-trace"]!.key, revision: 1, status: "corrupt", code: RUN_TRACE_MISMATCH }]);
    expect([...corrupt.out, ...corrupt.err].join(" ")).not.toContain("planted-b24c3-sql");
    expect([...corrupt.out, ...corrupt.err].join(" ")).not.toMatch(/a stored|failed its digest/);
    expect(TRACE_READ_ENTRY_CODES.absent).toBe("TRACE_READ_ABSENT");
    const byRun = await cli(readArgs("run-trace", C3_SCOPE, "--run", "run-b24c3-pg"));
    expect(byRun.code).toBe(TRACE_READ_EXIT.failed);
    expect(byRun.document!.refused).toEqual([{ key: written["run-trace"]!.key, revision: null, status: "corrupt", code: RUN_TRACE_MISMATCH }]);
    // the foreign scope's trace: never under this scope, listed under its own
    for (const run of [corrupt, byRun]) expect(JSON.stringify(run.document)).not.toContain("foreign");
    const foreign = await cli(readArgs("run-trace", C3_OTHER_SCOPE));
    expect(foreign.code).toBe(TRACE_READ_EXIT.ok);
    expect(foreign.document!.records.map((record) => record.key)).toEqual([runTraceAggregateKey(C3_OTHER_SCOPE, "run-b24c3-pg-foreign")]);
    expect(JSON.stringify(foreign.document!.records)).not.toContain(JSON.stringify({ tenantId: C3_SCOPE.tenantId }).slice(1, -1)); // the quoted id: this scope's tenant id is a prefix of the other's
    const other = await cli(readArgs("run-trace", C3_SCOPE, "--run", "run-b24c3-pg-foreign"));
    expect(other.code).toBe(TRACE_READ_EXIT.ok);
    expect(other.document!.refused).toEqual([{ key: runTraceAggregateKey(C3_SCOPE, "run-b24c3-pg-foreign"), revision: null, status: "absent", code: TRACE_READ_ENTRY_CODES.absent }]);
  });

  it("4. the dispatcher `main` of scripts/retention-purge.ts, imported and driven: --read hands the arguments, the environment, the loader, the writers, the clock and the production predicate to the read runner and constructs the PostgreSQL repository through its own default repositoryFor - the export holds the seeded specialist trace, the loader ran once, the retention port was never reached, the client was closed once over an opened repository; a purge argv (--limit 1, no --read) runs C2's dry run through the retention port (the inventory, never a purge), never the loader, and closes nothing; --read beside --apply exits 2 read_arguments_conflict before the loader, the close over no repository; a read flag without --read is the purge parser's RETENTION_ARGUMENT_UNKNOWN; every table identical throughout", { timeout: 120_000 }, async () => {
    const start = await snapshot();
    const out: string[] = [];
    const err: string[] = [];
    let loads = 0;
    const closes: boolean[] = [];
    const portCalls: string[] = [];
    const port = new Proxy(new PostgresRetentionPort(), { get(target, property, receiver) { const value = Reflect.get(target, property, receiver) as unknown; if (typeof property === "string" && typeof value === "function") { portCalls.push(property); return (value as (...args: unknown[]) => unknown).bind(target); } return value; } });
    const overrides = { loadEnv: () => { loads += 1; }, stdout: (text: string) => { out.push(text); }, stderr: (line: string) => { err.push(line); }, port: () => port, now: () => new Date(NOW), productionRuntime: () => false, close: async (opened: boolean) => { closes.push(opened); } };
    const env = { [URL_NAME]: FAKE_URL };
    // the read mode through the dispatcher, the repository its own default (PostgresDurableWorkflowRepository over the mocked getDb): the specialist trace, untouched by case 2's SQL edit
    expect(await main(readArgs("specialist-trace"), env, overrides)).toBe(TRACE_READ_EXIT.ok);
    expect(out).toHaveLength(1);
    const document = JSON.parse(out[0]!) as TraceReadExport;
    expect(Object.keys(document)).toEqual([...TRACE_READ_EXPORT_KEYS]);
    expect(document).toMatchObject({ kind: "specialist-trace", generatedAt: NOW, target: "db.invalid:5433/sirkit", scope: C3_SCOPE, accessAudit: "not_recorded", refused: [], truncated: false, omitted: 0 });
    expect(document.records).toHaveLength(1);
    expect(document.records[0]).toMatchObject({ key: written["specialist-trace"]!.key, revision: 1, recordDigest: written["specialist-trace"]!.recordDigest });
    expect(err.join(" ")).toContain("trace-read specialist-trace: records 1; refused 0");
    expect(loads).toBe(1);
    expect(portCalls).toEqual([]);
    expect(closes).toEqual([true]);
    // the purge mode through the dispatcher: C2's dry run over its port (the inventory read, never a purge), no loader, no close
    out.length = 0; err.length = 0;
    expect(await main(["--limit", "1"], env, overrides)).toBe(0);
    expect(out[0]).toBe("retention-purge: dry run (nothing is deleted)");
    expect(out).toContain("limit: 1");
    expect(out).toContain("runtime: non-production");
    expect(out.some((line) => line.startsWith("planDigest: "))).toBe(true);
    expect(portCalls).toContain("expiredAggregates");
    expect(portCalls).not.toContain("purgeAggregate");
    expect(loads).toBe(1);
    expect(closes).toEqual([true]);
    expect([...out, ...err].join(" ")).not.toContain("db.invalid"); // the purge mode prints no target
    // --read beside a purge flag: the read parser's refusal, before the loader and before any repository; the close runs over no repository
    out.length = 0; err.length = 0; portCalls.length = 0;
    expect(await main(readArgs("run-trace", C3_SCOPE, "--apply"), env, overrides)).toBe(TRACE_READ_EXIT.refused);
    expect(out).toEqual([]);
    expect(err.join(" ")).toContain("REFUSED read_arguments_conflict:");
    expect(loads).toBe(1);
    expect(portCalls).toEqual([]);
    expect(closes).toEqual([true, false]);
    // a read flag without --read: the purge parser's refusal (D12), nothing loaded, no port call
    out.length = 0; err.length = 0;
    expect(await main(["--kind", "run-trace"], env, overrides)).toBe(2);
    expect(out).toEqual([]);
    expect(err.join(" ")).toContain("REFUSED RETENTION_ARGUMENT_UNKNOWN:");
    expect(loads).toBe(1);
    expect(portCalls).toEqual([]);
    expect(closes).toEqual([true, false]);
    // the production predicate is the dispatcher's own seam: a production runtime refuses the read without the acknowledgement - after the loader (the runner's order: arguments, loader, URL, predicate), before any repository
    out.length = 0; err.length = 0;
    expect(await main(readArgs("specialist-trace"), env, { ...overrides, productionRuntime: () => true })).toBe(TRACE_READ_EXIT.refused);
    expect(err.join(" ")).toContain("REFUSED read_production_unacknowledged:");
    expect(loads).toBe(2);
    expect(portCalls).toEqual([]);
    expect(closes).toEqual([true, false, false]);
    expect(await snapshot()).toEqual(start);
  });
});
