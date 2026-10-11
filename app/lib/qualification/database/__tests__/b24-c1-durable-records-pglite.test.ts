/**
 * [B24-C1] The durable records on PostgreSQL (D24-20, D24-21; OD-207, OD-201): `agent.run-trace.v1` and `llm.call-record.v1` over the
 * PostgreSQL durable-workflow repository, against a real, migrated PostgreSQL (PGlite, in process, nothing on disk). No real database
 * is contacted: the database client is the PGlite instance below (the B23-B2 precedent, b23-b-exchange-ledger-pglite).
 *
 *  1. the run trace's round trip: a validated trace appended through `DurableRunTraceStore(new PostgresDurableWorkflowRepository())`
 *     loads back verified, equal by content (jsonb keeps no key order) and by its record and trace digests;
 *  2. replay and resume: the same trace id again writes no row (a replay), a second trace of the run (a resume) is revision 2;
 *  3. a tamper caught after a direct row edit: a stored document edited in the table is AGENT_RUN_TRACE_MISMATCH on the next load;
 *  4. two concurrent appends of one run serialize: revisions 1 and 2, one row each, the head at 2, nothing lost;
 *  5. [B24-C1b] the call record's round trip: appended, loaded and listed verified under its scope (the reserved operator scope too),
 *     the same record again a replay with no new row, and a direct row edit caught as LLM_CALL_RECORD_MISMATCH;
 *  6. [B24-C1 review 2, security-1] a trace whose project id carries a leading space is keyed by the scope as PostgreSQL stores it
 *     (the trimmed id in the row), and loads back through the canonical scope and through the padded one.
 *
 * Stated limit (RECORDED): PGlite is one connection and runs one transaction at a time, so case 4 proves the revision and replay paths,
 * not two interleaved server transactions (the B23-B2 statement). This suite starts PostgreSQL, so it lives outside every
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
import { AgentTraceRecorder, InMemoryTraceSink } from "../../../agent/trace-recorder";
import { agentRunTraceDigest, type AgentRunTrace } from "../../../agent/trace";
import { DurableRunTraceStore, RUN_TRACE_AGGREGATE_TYPE, RUN_TRACE_MISMATCH, RunTraceIntegrityError, runTraceAggregateKey } from "../../../observability/run-trace-store";
import { LLM_CALL_RECORD_SCHEMA, PUBLIC_MODEL_EGRESS_SCOPE, type LlmCallRecord } from "../../../observability/llm-call-record";
import { DurableLlmCallRecordStore, LLM_CALL_AGGREGATE_TYPE, LLM_CALL_RECORD_MISMATCH, LlmCallRecordIntegrityError, llmCallAggregateKey } from "../../../observability/llm-call-record-store";

const SCOPE = { tenantId: "tenant-b24c1-pglite", projectId: "project-b24c1", branchId: "main" };
const AT = "2026-10-08T12:00:00.000Z";
function trace(runId: string, traceId: string, scope = SCOPE): AgentRunTrace {
  let clock = 2_000;
  const recorder = new AgentTraceRecorder({
    runId, traceId, provider: "openai", promptVersion: "b24-c1", promptDigest: "eng1-b24c1prompt", registryDigest: "eng1-b24c1registry", scope,
    contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
  }, new InMemoryTraceSink(), () => (clock += 7));
  recorder.recordRunStarted();
  recorder.recordStep({ model: "scripted", usage: { inputTokens: 11, outputTokens: 13 }, toolCallCount: 0 });
  return recorder.finalize({ outcome: "completed", failureReason: null });
}
const store = (): DurableRunTraceStore => new DurableRunTraceStore(new PostgresDurableWorkflowRepository());
async function rowsOf(aggregateType: string, aggregateKey: string): Promise<Array<{ revision: number }>> {
  const result = await pg.db.query<{ revision: number }>("select revision from durable_workflow_records where tenant_id = $1 and aggregate_type = $2 and aggregate_key = $3 order by revision", [SCOPE.tenantId, aggregateType, aggregateKey]);
  return result.rows;
}

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
}, 120_000);
afterAll(async () => { await pg?.close(); });

describe("[B24-C1] agent.run-trace.v1 on PostgreSQL (PGlite)", () => {
  it("1. the round trip: an appended trace loads back verified - the record schema, revision 1, the document equal to the one appended and its trace digest unchanged", { timeout: 60_000 }, async () => {
    const document = trace("run-pglite-1", "trace-pglite-1a");
    expect(await store().append({ scope: SCOPE, document, at: AT })).toMatchObject({ ok: true, revision: 1, replayed: false });
    const history = await store().history(SCOPE, "run-pglite-1");
    expect(history).toHaveLength(1);
    expect(history[0]!.record).toMatchObject({ schema: "sirkit.agent-run-trace-record.v1", runId: "run-pglite-1", traceId: "trace-pglite-1a", revision: 1, at: AT });
    expect(history[0]!.record.document).toEqual(document); // jsonb keeps no key order: equal by content, and by digest
    expect(history[0]!.record.digest).toBe(agentRunTraceDigest(document));
    expect(await rowsOf(RUN_TRACE_AGGREGATE_TYPE, runTraceAggregateKey(SCOPE, "run-pglite-1"))).toEqual([{ revision: 1 }]);
  });

  it("2. replay and resume: the same trace id again writes no row and answers its replay; a second trace of the run is revision 2", { timeout: 60_000 }, async () => {
    const first = trace("run-pglite-2", "trace-pglite-2a");
    const written = await store().append({ scope: SCOPE, document: first, at: AT });
    expect(await store().append({ scope: SCOPE, document: first, at: "2026-10-08T12:00:05.000Z" })).toEqual({ ...written, replayed: true });
    expect(await store().append({ scope: SCOPE, document: trace("run-pglite-2", "trace-pglite-2b"), at: AT })).toMatchObject({ ok: true, revision: 2, replayed: false });
    expect((await store().history(SCOPE, "run-pglite-2")).map((entry) => entry.record.traceId)).toEqual(["trace-pglite-2a", "trace-pglite-2b"]);
    expect(await rowsOf(RUN_TRACE_AGGREGATE_TYPE, runTraceAggregateKey(SCOPE, "run-pglite-2"))).toEqual([{ revision: 1 }, { revision: 2 }]);
  });

  it("3. a tamper caught after a direct row edit: the stored document's model edited in the table fails the next load with AGENT_RUN_TRACE_MISMATCH, and the error names nothing of the row", { timeout: 60_000 }, async () => {
    await store().append({ scope: SCOPE, document: trace("run-pglite-3", "trace-pglite-3a"), at: AT });
    const edited = await pg.db.query("update durable_workflow_records set payload = jsonb_set(payload, '{document,model}', '\"edited-model\"') where tenant_id = $1 and aggregate_type = $2 and aggregate_key = $3", [SCOPE.tenantId, RUN_TRACE_AGGREGATE_TYPE, runTraceAggregateKey(SCOPE, "run-pglite-3")]);
    expect(edited.affectedRows).toBe(1);
    const error = await store().history(SCOPE, "run-pglite-3").then(() => null, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(RunTraceIntegrityError);
    expect((error as RunTraceIntegrityError).code).toBe(RUN_TRACE_MISMATCH);
    expect((error as Error).message).not.toContain("edited-model");
  });

  it("4. two concurrent appends of one run serialize: revisions 1 and 2, one row each, both trace ids kept, the head at 2", { timeout: 60_000 }, async () => {
    const [a, b] = await Promise.all([
      store().append({ scope: SCOPE, document: trace("run-pglite-4", "trace-pglite-4a"), at: AT }),
      store().append({ scope: SCOPE, document: trace("run-pglite-4", "trace-pglite-4b"), at: AT }),
    ]);
    expect([a, b].map((result) => (result.ok ? result.revision : 0)).sort()).toEqual([1, 2]);
    const history = await store().history(SCOPE, "run-pglite-4");
    expect(history.map((entry) => entry.record.traceId).sort()).toEqual(["trace-pglite-4a", "trace-pglite-4b"]);
    expect(await rowsOf(RUN_TRACE_AGGREGATE_TYPE, runTraceAggregateKey(SCOPE, "run-pglite-4"))).toEqual([{ revision: 1 }, { revision: 2 }]);
    const heads = await pg.db.query<{ revision: number }>("select revision from durable_workflow_heads where tenant_id = $1 and aggregate_type = $2 and aggregate_key = $3", [SCOPE.tenantId, RUN_TRACE_AGGREGATE_TYPE, runTraceAggregateKey(SCOPE, "run-pglite-4")]);
    expect(heads.rows).toEqual([{ revision: 2 }]);
  });
});

describe("[B24-C1b] llm.call-record.v1 on PostgreSQL (PGlite)", () => {
  const record = (index: number): LlmCallRecord => ({ schema: LLM_CALL_RECORD_SCHEMA, callId: `llmc-11111111-2222-4333-8444-${String(index).padStart(12, "0")}`, requestRef: "llmr-66666666-7777-4888-9999-000000000000", seq: index, routeId: "/api/schematic/review", method: "POST", provider: "anthropic", model: "claude-fake-b24c1", kind: "generate", inputTokens: 11, outputTokens: 7, latencyMs: 3, outcome: index === 2 ? "rate_limit" : "completed", startedAt: AT });
  const calls = (): DurableLlmCallRecordStore => new DurableLlmCallRecordStore(new PostgresDurableWorkflowRepository());
  const OPERATOR = { ...PUBLIC_MODEL_EGRESS_SCOPE }; // [B24-C1 review 2, 2026-10-08] security-7: the constant itself, so the row below proves the reserved id on PostgreSQL (was a literal copy)

  it("5. the call record's round trip: two records appended, loaded and listed verified, one under the reserved operator scope; the same record again is a replay with no new row; a direct row edit is LLM_CALL_RECORD_MISMATCH", { timeout: 60_000 }, async () => {
    const [one, two] = [record(1), record(2)];
    expect(await calls().append({ scope: SCOPE, record: one })).toMatchObject({ ok: true, replayed: false });
    expect(await calls().append({ scope: SCOPE, record: two })).toMatchObject({ ok: true, replayed: false });
    expect(await calls().append({ scope: SCOPE, record: one })).toMatchObject({ ok: true, replayed: true });
    expect(await calls().append({ scope: OPERATOR, record: { ...record(3), routeId: "/api/parts/search", kind: "embedding", provider: "openai", model: "text-embedding-3-small", outputTokens: null } })).toMatchObject({ ok: true, replayed: false });
    expect((await calls().load(SCOPE, one.callId))!.record).toEqual(one);
    expect((await calls().list(SCOPE)).map((entry) => entry.record.outcome).sort()).toEqual(["completed", "rate_limit"]);
    expect((await calls().list(OPERATOR)).map((entry) => [entry.record.routeId, entry.record.kind])).toEqual([["/api/parts/search", "embedding"]]);
    expect(await rowsOf(LLM_CALL_AGGREGATE_TYPE, llmCallAggregateKey(SCOPE, one.callId))).toEqual([{ revision: 1 }]);
    const edited = await pg.db.query("update durable_workflow_records set payload = jsonb_set(payload, '{outcome}', '\"completed\"') where tenant_id = $1 and aggregate_type = $2 and aggregate_key = $3", [SCOPE.tenantId, LLM_CALL_AGGREGATE_TYPE, llmCallAggregateKey(SCOPE, two.callId)]);
    expect(edited.affectedRows).toBe(1);
    for (const read of [() => calls().load(SCOPE, two.callId), () => calls().list(SCOPE)]) {
      const error = await read().then(() => null, (thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(LlmCallRecordIntegrityError);
      expect((error as LlmCallRecordIntegrityError).code).toBe(LLM_CALL_RECORD_MISMATCH);
    }
  });
});

describe("[B24-C1 review 2] the scope as PostgreSQL stores it (security-1)", () => {
  it("6. a trace whose project id carries a leading space is keyed by the scope as the substrate stores it: appended under the padded scope, its row's project_id is the trimmed id and its aggregate key the canonical scope's; it loads back verified through the canonical scope and through the padded one, the document's own id kept as the recorder wrote it", { timeout: 60_000 }, async () => {
    const padded = { ...SCOPE, projectId: ` ${SCOPE.projectId}` };
    const document = trace("run-pglite-6", "trace-pglite-6a", padded);
    expect(await store().append({ scope: padded, document, at: AT })).toMatchObject({ ok: true, revision: 1, replayed: false });
    expect(runTraceAggregateKey(padded, "run-pglite-6")).toBe(runTraceAggregateKey(SCOPE, "run-pglite-6"));
    const rows = await pg.db.query<{ project_id: string }>("select project_id from durable_workflow_records where tenant_id = $1 and aggregate_type = $2 and aggregate_key = $3", [SCOPE.tenantId, RUN_TRACE_AGGREGATE_TYPE, runTraceAggregateKey(SCOPE, "run-pglite-6")]);
    expect(rows.rows).toEqual([{ project_id: SCOPE.projectId }]);
    const canonical = await store().history(SCOPE, "run-pglite-6");
    expect(canonical.map((entry) => entry.record.document.scope.projectId)).toEqual([` ${SCOPE.projectId}`]);
    expect(canonical[0]!.record.digest).toBe(agentRunTraceDigest(document));
    expect(await store().history(padded, "run-pglite-6")).toEqual(canonical);
  });
});
