/**
 * [B24-C3] D24-26, OD-211 - the read mode of B24-C2's purge CLI (`scripts/retention-purge.ts --read`), in memory: the pure core
 * `app/lib/observability/trace-read.ts` over `InMemoryDurableWorkflowRepository`, a fixed clock, no database, no file, no network.
 *
 * Red first (recorded on observability-and-replay.md part 3): at 600d1ba this suite fails to load (the core is missing), and the one
 * operator CLI refuses `--read` as an unknown flag (`b24-c2-retention` 5) - with C1's store written, no operator path returned a trace.
 *
 *  1. the four kinds read back what their own stores wrote (never a hand-built document): the run trace, the attribution, the call
 *     record and the specialist trace, each record's digest the store's; the specialist key formula the core restates is the store's;
 *  2. read-only by construction: a counting Proxy sees only listHeads, history, loadHead (loadRecord allowed, unreached); the adapter
 *     rejects every write TRACE_READ_WRITE_REFUSED and getReplay / listOutbox TRACE_READ_METHOD_REFUSED; the repository holds the same
 *     heads, replays and outbox after a read; the purge is never reached (no retention module in the core's closure);
 *  3. scope isolation: another scope's records are never listed; a stored payload that names another scope is `corrupt`;
 *  4. a corrupt digest, payload, key or type each `corrupt` with a bounded code: no payload, message or stack in the output; a head-only
 *     tamper (the listing edited, the chain untouched) is `corrupt` TRACE_READ_HEAD_MISMATCH for every kind; a store reader's own throw
 *     with no bounded code is `corrupt` TRACE_READ_FAILED, its value never printed;
 *  5. a planted PEM marker the B11 validators admit is `withheld` and never printed; a key-shaped value never reaches `ok` (the
 *     validators refuse it on write and on read) and never reaches the output either; `containsSecretShapedText(stdout)` is false; the
 *     whole-document check: two records each clean alone whose compact renderings together match a credential-in-URL shape are withheld
 *     whole, every collected record (kept and dropped by the cap) counted in `omitted`;
 *  6. refusals and bounds: with `--read`, `--limit` 0 and 101 refused, 20 by default; C2's purge-only flags beside `--read` refused;
 *     an unknown, a stray, a repeated or a malformed argument refused before any repository call; the purge range untouched; the
 *     1 MiB cap drops whole records from the end; the 30 s deadline is on the WHOLE read (a repository answering each statement in 20 s
 *     is still pending at 29 999 ms and `read_unavailable` at 30 000 ms; a hanging first call likewise) and a throwing repository
 *     exits 3 `read_unavailable`;
 *  7. a production runtime refuses without `--acknowledge-unaudited-read` and reads with it, `accessAudit: "not_recorded"`;
 *  8. the excluded kinds, each by its exact aggregate type name, are `read_kind_unknown` with zero repository calls;
 *  9. the CLI: `env: {}` exits 2 naming DATABASE_URL only, `.env.local` is loaded after the arguments parse and before the URL is
 *     read, the target is host:port/database, and a driver error carrying a user:password URL is never printed;
 * 10. the import gates (AST, `importClosure`): the core and the CLI in no route, MCP server, loop, gateway or orchestration closure;
 *     the core's one production importer is the CLI; its closure imports no provider SDK and none of the durable runtime, the server
 *     repository, the database client or the schema, and no auth module (the database credential is the only authorization); no
 *     `process.env` in its source; the constructor census is exactly the durable runtime and the CLI (D11); C1's approved-importer gates
 *     admit the core with neither importer list moved; the CLI's text pins, and its entry guard's pattern parsed from the source (the
 *     dispatch itself is EXECUTED by b24-c3-trace-read-pglite 4).
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { fileOf, importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { listRouteFiles } from "@/app/lib/auth/route-tree";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { RETENTION_CLI_FLAGS, parseRetentionArguments } from "@/app/lib/durable-workflow/retention-cli";
import { RETENTION_LIMITS } from "@/app/lib/durable-workflow/retention";
import type { DurableAggregateRecord, DurableWorkflowRepository, DurableWorkflowScope } from "@/app/lib/durable-workflow/types";
import { agentRunTraceDigest } from "@/app/lib/agent/trace";
import { containsSecretShapedText } from "@/app/lib/agent/redaction";
import { ORCHESTRATION_AGGREGATE_TYPE, ORCHESTRATION_RESUME_AGGREGATE_TYPE } from "@/app/lib/agent/orchestration/store";
import { DurableOrchestrationTraceStore, ORCHESTRATION_TRACE_AGGREGATE_TYPE, orchestrationTraceRecordDigest, specialistTraceRunId } from "@/app/lib/agent/orchestration/trace-attribution";
import { EXECUTION_GRANT_AGGREGATE_TYPE, EXECUTION_GRANT_INDEX_AGGREGATE_TYPE } from "@/app/lib/engineering/execution-grant";
import { AUTONOMY_AGGREGATE_TYPE } from "@/app/lib/agent/autonomy-store";
import { COMPUTATION_EVIDENCE_AGGREGATE_TYPE } from "@/app/lib/computation/evidence-store";
import { PROVIDER_EXCHANGE_AGGREGATE_TYPE } from "@/app/lib/manufacturing-providers/exchange-ledger";
import { DurableRunTraceStore, RUN_TRACE_AGGREGATE_TYPE, RUN_TRACE_MISMATCH, RUN_TRACE_RECORD_SCHEMA, runTraceAggregateKey, runTraceRecordDigest, type RunTraceRecord } from "@/app/lib/observability/run-trace-store";
import { DurableRunTraceAttributionStore, RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, RUN_TRACE_ATTRIBUTION_MISMATCH, runTraceAttributionAggregateKey } from "@/app/lib/observability/run-trace-attribution";
import { DurableLlmCallRecordStore, LLM_CALL_AGGREGATE_TYPE, LLM_CALL_RECORD_MISMATCH, llmCallAggregateKey } from "@/app/lib/observability/llm-call-record-store";
import {
  TRACE_READ_ACCESS_AUDIT, TRACE_READ_AGGREGATE_TYPES, TRACE_READ_BOUNDS, TRACE_READ_ENTRY_CODES, TRACE_READ_EXIT, TRACE_READ_EXPORT_KEYS, TRACE_READ_EXPORT_SCHEMA, TRACE_READ_FLAGS, TRACE_READ_KINDS, TRACE_READ_LIMITS,
  TRACE_READ_METHOD_REFUSED, TRACE_READ_PURGE_ONLY_FLAGS, TRACE_READ_RUN_SELECTABLE_KINDS, TRACE_READ_WRITE_REFUSED, TraceReadUnavailableError, parseTraceReadArguments, readOnlyTraceRepository, readTraceExport, redactedTraceReadTarget, runTraceReadCli,
  secretShapedRendering, selectsTraceRead, specialistTraceAggregateKey, type TraceReadExport, type TraceReadKind,
} from "@/app/lib/observability/trace-read";
import { C3_AT, C3_OTHER_SCOPE, C3_PARENT_RUN, C3_SCOPE, c3Attribution, c3CallRecord, c3SpecialistTrace, c3Trace } from "./_b24-c3-fixtures";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const CORE = "app/lib/observability/trace-read.ts";
const CLI = "scripts/retention-purge.ts";
const NOW = "2026-10-09T12:34:56.000Z";
/** the environment's one name and a fake connection string, each assembled at run time (B16-B: a test never spells the gate forms) */
const URL_NAME = ["DATABASE", "URL"].join("_");
const FAKE_USER = ["oper", "ator"].join("");
const FAKE_PASSWORD = ["pass", "word"].join("");
const FAKE_URL = `postgres://${FAKE_USER}:${FAKE_PASSWORD}@db.invalid:5433/sirkit`;
const SCOPE_ARGS = ["--tenant", C3_SCOPE.tenantId, "--project", C3_SCOPE.projectId, "--branch", C3_SCOPE.branchId];
const readArgs = (kind: TraceReadKind | string, ...more: string[]): string[] => ["--read", "--kind", kind, ...SCOPE_ARGS, ...more];

interface Run { code: number; out: string[]; err: string[]; document: TraceReadExport | null; loads: number; repositoryCalls: number }
interface CliOptions { repository?: DurableWorkflowRepository; env?: Record<string, string | undefined>; production?: boolean; repositoryFor?: (url: string) => DurableWorkflowRepository; now?: string }
/** The CLI through its exported runner, with injected everything; `document` is stdout parsed (null when nothing or several were written). */
async function cli(argv: readonly string[], options: CliOptions = {}): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  let loads = 0;
  let repositoryCalls = 0;
  const repository = options.repository ?? new InMemoryDurableWorkflowRepository();
  const code = await runTraceReadCli({
    argv, env: options.env ?? { [URL_NAME]: FAKE_URL }, loadEnv: () => { loads += 1; }, stdout: (text) => out.push(text), stderr: (line) => err.push(line),
    repositoryFor: options.repositoryFor ?? ((url) => { repositoryCalls += 1; expect(url).toBe(FAKE_URL); return repository; }), now: () => new Date(options.now ?? NOW), productionRuntime: () => options.production ?? false,
  });
  return { code, out, err, document: out.length === 1 ? (JSON.parse(out[0]!) as TraceReadExport) : null, loads, repositoryCalls };
}
const printed = (run: Run): string => [...run.out, ...run.err].join(NEWLINE);

/** The repository behind a Proxy that records every method reached. */
function counting(repository: DurableWorkflowRepository): { repository: DurableWorkflowRepository; reached: Set<string> } {
  const reached = new Set<string>();
  const proxy = new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof property === "string" && typeof value === "function") { reached.add(property); return (value as (...args: unknown[]) => unknown).bind(target); }
      return value;
    },
  });
  return { repository: proxy, reached };
}
/** The repository behind a Proxy that edits every row it hands out (a tampered table). */
function tampered(repository: DurableWorkflowRepository, edit: (row: DurableAggregateRecord<Record<string, unknown>>) => void): DurableWorkflowRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      const method = (value as (...args: unknown[]) => Promise<unknown>).bind(target);
      if (property === "listHeads" || property === "history") return async (...args: unknown[]) => { const rows = (await method(...args)) as Array<DurableAggregateRecord<Record<string, unknown>>>; rows.forEach(edit); return rows; };
      if (property === "loadHead") return async (...args: unknown[]) => { const row = (await method(...args)) as DurableAggregateRecord<Record<string, unknown>> | null; if (row) edit(row); return row; };
      return method;
    },
  });
}
/** Every stored kind written once through its own store; the keys and digests the stores answered. */
async function seeded(repository: DurableWorkflowRepository, scope: DurableWorkflowScope = C3_SCOPE): Promise<Record<TraceReadKind, { key: string; recordDigest: string }>> {
  const trace = await new DurableRunTraceStore(repository).append({ scope, document: c3Trace("run-b24c3-1", "trace-b24c3-1a", { scope }), at: C3_AT });
  const attribution = await new DurableRunTraceAttributionStore(repository).append({ scope, document: c3Attribution("run-b24c3-1", "trace-b24c3-1a", scope), at: C3_AT });
  const call = await new DurableLlmCallRecordStore(repository).append({ scope, record: c3CallRecord(1) });
  const specialist = await new DurableOrchestrationTraceStore(repository).append({ scope, document: c3SpecialistTrace(1, "circuit-topology", { scope }), at: C3_AT });
  for (const [name, result] of Object.entries({ trace, attribution, call, specialist })) expect(result.ok, name).toBe(true);
  if (!trace.ok || !attribution.ok || !call.ok || !specialist.ok) throw new Error("unreachable");
  return {
    "run-trace": { key: runTraceAggregateKey(scope, "run-b24c3-1"), recordDigest: trace.recordDigest },
    "run-trace-attribution": { key: runTraceAttributionAggregateKey(scope, "trace-b24c3-1a"), recordDigest: attribution.recordDigest },
    "llm-call-record": { key: llmCallAggregateKey(scope, c3CallRecord(1).callId), recordDigest: call.recordDigest },
    "specialist-trace": { key: specialistTraceAggregateKey(scope, specialistTraceRunId(C3_PARENT_RUN, 1, "circuit-topology")), recordDigest: specialist.recordDigest },
  };
}
/** The repository's whole state by its four read methods: every head of the readable types, every replay the stores could ask for, the outbox. */
async function stateOf(repository: InMemoryDurableWorkflowRepository, scope: DurableWorkflowScope = C3_SCOPE): Promise<string> {
  const heads = await Promise.all(TRACE_READ_KINDS.map((kind) => repository.listHeads({ aggregateType: TRACE_READ_AGGREGATE_TYPES[kind], scope, limit: 10_000 })));
  return JSON.stringify({ heads, outbox: await repository.listOutbox() });
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
/** The repository behind a Proxy whose listing comes back in the given key order (the in-memory order is by aggregate key, a digest). */
function inOrder(repository: DurableWorkflowRepository, keys: readonly string[]): DurableWorkflowRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      const method = (value as (...args: unknown[]) => Promise<unknown>).bind(target);
      return property === "listHeads" ? async (...args: unknown[]) => [...((await method(...args)) as DurableAggregateRecord[])].sort((a, b) => keys.indexOf(a.aggregateKey) - keys.indexOf(b.aggregateKey)) : method;
    },
  });
}
/** The repository behind a Proxy that edits the LISTING's rows only (history and loadHead untouched): a head that disagrees with its chain. */
function headOnly(repository: DurableWorkflowRepository, edit: (row: DurableAggregateRecord<Record<string, unknown>>) => void): DurableWorkflowRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      const method = (value as (...args: unknown[]) => Promise<unknown>).bind(target);
      return property === "listHeads" ? async (...args: unknown[]) => { const rows = (await method(...args)) as Array<DurableAggregateRecord<Record<string, unknown>>>; rows.forEach(edit); return rows; } : method;
    },
  });
}
/** The repository behind a Proxy that answers every call after `delayMs` on the (fake) clock. */
function slow(repository: DurableWorkflowRepository, delayMs: number): DurableWorkflowRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      const method = (value as (...args: unknown[]) => Promise<unknown>).bind(target);
      return (...args: unknown[]) => new Promise((resolve, reject) => { setTimeout(() => { method(...args).then(resolve, reject); }, delayMs); });
    },
  });
}
const utf8Length = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

describe("[B24-C3] the read mode reads the four kinds through their own stores (D24-26, OD-211)", () => {
  it("1. the four kinds read back exactly what their own stores wrote: one record each, keyed by the aggregate, its revision and digest the store's, the document the stored record; the closed export keys in order; exit 0; the specialist key the core restates is the store's own", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const written = await seeded(repository);
    for (const kind of TRACE_READ_KINDS) {
      const run = await cli(readArgs(kind), { repository });
      expect(run.code, kind).toBe(TRACE_READ_EXIT.ok);
      expect(run.out, kind).toHaveLength(1);
      const document = run.document!;
      expect(Object.keys(document), kind).toEqual([...TRACE_READ_EXPORT_KEYS]);
      expect(document, kind).toMatchObject({ schema: TRACE_READ_EXPORT_SCHEMA, generatedAt: NOW, target: "db.invalid:5433/sirkit", scope: C3_SCOPE, kind, accessAudit: TRACE_READ_ACCESS_AUDIT, refused: [], truncated: false, omitted: 0 });
      expect(document.records, kind).toHaveLength(1);
      expect(document.records[0], kind).toMatchObject({ key: written[kind].key, revision: 1, recordDigest: written[kind].recordDigest });
      const head = (await repository.listHeads({ aggregateType: TRACE_READ_AGGREGATE_TYPES[kind], scope: C3_SCOPE }))[0]!;
      expect(document.records[0]!.document, kind).toEqual(head.payload); // the verified record IS the stored payload (jsonb keeps no key order on PostgreSQL; in memory the clone is equal)
      expect(head.aggregateKey, kind).toBe(written[kind].key);
      expect(run.err.join(" "), kind).toContain(`trace-read ${kind}: records 1; refused 0`);
    }
    // the specialist trace's record digest and key as the orchestration store derives them
    const specialist = (await repository.listHeads({ aggregateType: ORCHESTRATION_TRACE_AGGREGATE_TYPE, scope: C3_SCOPE }))[0]!;
    expect(orchestrationTraceRecordDigest(specialist.payload as never)).toBe(specialist.recordDigest);
    expect(specialistTraceAggregateKey(C3_SCOPE, (specialist.payload as { runId: string }).runId)).toBe(specialist.aggregateKey);
    // --run selects one run-id-keyed aggregate, its whole history (a resume's revision 2 included)
    await new DurableRunTraceStore(repository).append({ scope: C3_SCOPE, document: c3Trace("run-b24c3-1", "trace-b24c3-1b"), at: "2026-10-09T12:00:05.000Z" });
    const byRun = await cli(readArgs("run-trace", "--run", "run-b24c3-1"), { repository });
    expect(byRun.code).toBe(TRACE_READ_EXIT.ok);
    expect(byRun.document!.records.map((record) => [record.key, record.revision, (record.document as RunTraceRecord).traceId])).toEqual([[written["run-trace"].key, 1, "trace-b24c3-1a"], [written["run-trace"].key, 2, "trace-b24c3-1b"]]);
    const specialistByRun = await cli(readArgs("specialist-trace", "--run", specialistTraceRunId(C3_PARENT_RUN, 1, "circuit-topology")), { repository });
    expect(specialistByRun.document!.records.map((record) => record.recordDigest)).toEqual([written["specialist-trace"].recordDigest]);
    const absent = await cli(readArgs("run-trace", "--run", "run-b24c3-nobody"), { repository });
    expect(absent.code).toBe(TRACE_READ_EXIT.ok);
    expect(absent.document!.refused).toEqual([{ key: runTraceAggregateKey(C3_SCOPE, "run-b24c3-nobody"), revision: null, status: "absent", code: TRACE_READ_ENTRY_CODES.absent }]);
    expect(TRACE_READ_AGGREGATE_TYPES).toEqual({ "run-trace": RUN_TRACE_AGGREGATE_TYPE, "run-trace-attribution": RUN_TRACE_ATTRIBUTION_AGGREGATE_TYPE, "llm-call-record": LLM_CALL_AGGREGATE_TYPE, "specialist-trace": ORCHESTRATION_TRACE_AGGREGATE_TYPE });
  });

  it("2. read-only by construction: the methods a read reaches are a subset of {listHeads, history, loadHead, loadRecord}; the adapter rejects commit, claimOutbox, completeOutbox and failOutbox TRACE_READ_WRITE_REFUSED and getReplay, listOutbox TRACE_READ_METHOD_REFUSED; the repository's heads, replays and outbox are the same after every read; the purge is never reached", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    await seeded(repository);
    const before = await stateOf(repository);
    const { repository: counted, reached } = counting(repository);
    for (const kind of TRACE_READ_KINDS) expect((await cli(readArgs(kind), { repository: counted })).code, kind).toBe(TRACE_READ_EXIT.ok);
    expect((await cli(readArgs("run-trace", "--run", "run-b24c3-1"), { repository: counted })).code).toBe(TRACE_READ_EXIT.ok);
    expect([...reached].sort()).toEqual(["history", "listHeads", "loadHead"]);
    expect([...reached].every((method) => ["listHeads", "history", "loadHead", "loadRecord"].includes(method))).toBe(true);
    expect(await stateOf(repository)).toBe(before);
    const adapter = readOnlyTraceRepository(repository);
    const identity = { scope: C3_SCOPE, aggregateType: RUN_TRACE_AGGREGATE_TYPE, aggregateKey: runTraceAggregateKey(C3_SCOPE, "run-b24c3-1") };
    await expect(adapter.commit({ scope: C3_SCOPE, scopeKey: "x", idempotencyKey: "y", operations: [{ aggregateType: RUN_TRACE_AGGREGATE_TYPE, aggregateKey: "k", expectedRevision: 0, payload: {} }], outbox: [], result: {}, committedAt: C3_AT })).rejects.toThrow(TRACE_READ_WRITE_REFUSED);
    await expect(adapter.claimOutbox({ workerId: "w", now: C3_AT, leaseUntil: C3_AT, limit: 1 })).rejects.toThrow(TRACE_READ_WRITE_REFUSED);
    await expect(adapter.completeOutbox({ scope: C3_SCOPE, eventId: "e", workerId: "w", leaseToken: "t", completedAt: C3_AT })).rejects.toThrow(TRACE_READ_WRITE_REFUSED);
    await expect(adapter.failOutbox({ scope: C3_SCOPE, eventId: "e", workerId: "w", leaseToken: "t", errorCode: "X", failedAt: C3_AT, retryAt: C3_AT, terminal: true })).rejects.toThrow(TRACE_READ_WRITE_REFUSED);
    await expect(adapter.getReplay(C3_SCOPE, "x", "y")).rejects.toThrow(TRACE_READ_METHOD_REFUSED);
    await expect(adapter.listOutbox()).rejects.toThrow(TRACE_READ_METHOD_REFUSED);
    expect((await adapter.history(identity)).length).toBe(1); // the four reads pass through
    expect(await adapter.loadHead(identity)).toMatchObject({ revision: 1 });
    expect(await adapter.loadRecord(C3_SCOPE, "no-such-record")).toBeNull();
    expect(await stateOf(repository)).toBe(before);
    // the purge is never reached: no retention module in the core's runtime closure, and the core names no purge
    const map = collectProductionFiles(ROOT);
    const closure = importClosure(map, [CORE]);
    expect([...closure.keys()].filter((file) => file.startsWith("app/lib/durable-workflow/retention"))).toEqual([]);
    expect(map.get(CORE)!).not.toMatch(/purgeAggregate|applyRetention|planRetention|PostgresRetentionPort/);
  });

  it("3. scope isolation: another scope's records are never listed; a stored payload that names another scope (a record of scope B kept under scope A's own key, digests consistent) reads as `corrupt` AGENT_RUN_TRACE_MISMATCH with nothing of it printed", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    await seeded(repository, C3_OTHER_SCOPE);
    for (const kind of TRACE_READ_KINDS) {
      const run = await cli(readArgs(kind), { repository });
      expect(run.code, kind).toBe(TRACE_READ_EXIT.ok);
      expect(run.document!.records, kind).toEqual([]);
      expect(run.document!.refused, kind).toEqual([]);
      expect(printed(run), kind).not.toContain(C3_OTHER_SCOPE.tenantId);
    }
    // a run trace of scope B planted under scope A's aggregate key for the same run id, every digest consistent: the store's own scope check refuses it
    const document = c3Trace("run-b24c3-foreign", "trace-b24c3-foreign", { scope: C3_OTHER_SCOPE });
    const record: RunTraceRecord = { schema: RUN_TRACE_RECORD_SCHEMA, runId: "run-b24c3-foreign", traceId: "trace-b24c3-foreign", revision: 1, at: C3_AT, digest: agentRunTraceDigest(document), document };
    await repository.commit({ scope: C3_SCOPE, scopeKey: "b24-c3-foreign", idempotencyKey: "b24-c3-foreign", operations: [{ aggregateType: RUN_TRACE_AGGREGATE_TYPE, aggregateKey: runTraceAggregateKey(C3_SCOPE, "run-b24c3-foreign"), expectedRevision: 0, payload: record, recordDigest: runTraceRecordDigest(record) }], outbox: [], result: {}, committedAt: C3_AT });
    const run = await cli(readArgs("run-trace"), { repository });
    expect(run.code).toBe(TRACE_READ_EXIT.failed);
    expect(run.document!.records).toEqual([]);
    expect(run.document!.refused).toEqual([{ key: runTraceAggregateKey(C3_SCOPE, "run-b24c3-foreign"), revision: 1, status: "corrupt", code: RUN_TRACE_MISMATCH }]);
    expect(printed(run)).not.toContain(C3_OTHER_SCOPE.tenantId);
    expect(printed(run)).not.toContain("trace-b24c3-foreign");
  });

  it("4. a corrupt digest, payload, key or type (a tampered table behind a Proxy) each reads as `corrupt` with its store's bounded code - for every kind - and the output carries no payload, no thrown message and no stack; a head-only tamper (the listing's revision or digest edited, the chain untouched) is `corrupt` TRACE_READ_HEAD_MISMATCH for every kind; a store reader's own throw with no bounded code (a bare object, then a free-text Error) is `corrupt` TRACE_READ_FAILED with nothing of it printed; the same bare throw from the REPOSITORY is the adapter's read_unavailable", { timeout: 60_000 }, async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const written = await seeded(repository);
    const MISMATCH: Record<TraceReadKind, string> = { "run-trace": RUN_TRACE_MISMATCH, "run-trace-attribution": RUN_TRACE_ATTRIBUTION_MISMATCH, "llm-call-record": LLM_CALL_RECORD_MISMATCH, "specialist-trace": "AGENT_ORCHESTRATION_TRACE_MISMATCH" };
    const plant = "planted-b24c3-payload";
    const edits: Record<string, { edit: (row: DurableAggregateRecord<Record<string, unknown>>) => void; code: (kind: TraceReadKind) => string }> = {
      digest: { edit: (row) => { row.recordDigest = "eng1-0000000000000000"; }, code: (kind) => MISMATCH[kind] },
      payload: { edit: (row) => { row.payload.at = plant; row.payload.startedAt = plant; }, code: (kind) => MISMATCH[kind] },
      key: { edit: (row) => { row.aggregateKey = `${row.aggregateKey}-moved`; }, code: () => TRACE_READ_ENTRY_CODES.keyMismatch },
      type: { edit: (row) => { row.aggregateType = `${row.aggregateType}-moved`; }, code: (kind) => MISMATCH[kind] },
    };
    for (const kind of TRACE_READ_KINDS) {
      for (const [name, { edit, code }] of Object.entries(edits)) {
        const run = await cli(readArgs(kind), { repository: tampered(repository, edit) });
        expect(run.code, `${kind} ${name}`).toBe(TRACE_READ_EXIT.failed);
        expect(run.document!.records, `${kind} ${name}`).toEqual([]);
        expect(run.document!.refused, `${kind} ${name}`).toHaveLength(1);
        expect(run.document!.refused[0], `${kind} ${name}`).toMatchObject({ revision: 1, status: "corrupt", code: code(kind) });
        expect(run.document!.refused[0]!.key.startsWith(written[kind].key), `${kind} ${name}`).toBe(true);
        const text = printed(run);
        expect(text, `${kind} ${name}`).not.toContain(plant);
        expect(text, `${kind} ${name}`).not.toContain("scripted"); // the stored model name
        expect(text, `${kind} ${name}`).not.toMatch(/a stored|failed its digest|\bat .*\.ts:\d+|Error:/); // the stores' messages and a stack
      }
    }
    // [B24-C3 review fix, 2026-10-09] a head-only tamper: the listing's row is edited, the chain (history, loadHead) is not - the store's reader verifies the chain, and the chain's last record is not the listed head
    const headEdits: Array<[name: string, edit: (row: DurableAggregateRecord<Record<string, unknown>>) => void, listedRevision: number]> = [["revision", (row) => { row.revision = 7; }, 7], ["digest", (row) => { row.recordDigest = "eng1-0000000000000000"; }, 1]];
    for (const kind of TRACE_READ_KINDS) {
      for (const [name, edit, listedRevision] of headEdits) {
        const run = await cli(readArgs(kind), { repository: headOnly(repository, edit) });
        expect(run.code, `${kind} head ${name}`).toBe(TRACE_READ_EXIT.failed);
        expect(run.document!.records, `${kind} head ${name}`).toEqual([]);
        expect(run.document!.refused, `${kind} head ${name}`).toEqual([{ key: written[kind].key, revision: listedRevision, status: "corrupt", code: TRACE_READ_ENTRY_CODES.headMismatch }]);
      }
    }
    // a store reader's own throw (the repository answered; the store's verifier threw a bare object with no code, then an Error whose message is free text): the generic code TRACE_READ_FAILED, exit 1, nothing of the value printed
    const reader = vi.spyOn(DurableRunTraceStore.prototype, "history").mockRejectedValue({ message: plant });
    const bare = await cli(readArgs("run-trace"), { repository });
    expect(bare.code).toBe(TRACE_READ_EXIT.failed);
    expect(bare.document!.refused).toEqual([{ key: written["run-trace"].key, revision: 1, status: "corrupt", code: TRACE_READ_ENTRY_CODES.failed }]);
    expect(printed(bare)).not.toContain(plant);
    reader.mockRejectedValue(new Error(`a stored run trace failed its digest check: ${plant}`));
    const freeText = await cli(readArgs("run-trace"), { repository });
    expect(freeText.code).toBe(TRACE_READ_EXIT.failed);
    expect(freeText.document!.refused).toEqual([{ key: written["run-trace"].key, revision: 1, status: "corrupt", code: TRACE_READ_ENTRY_CODES.failed }]);
    expect(printed(freeText)).not.toContain(plant);
    expect(printed(freeText)).not.toContain("failed its digest");
    reader.mockRestore();
    expect((await cli(readArgs("run-trace"), { repository })).code).toBe(TRACE_READ_EXIT.ok); // the store's reader is itself again
    // the same bare throw from the REPOSITORY (not a store): the adapter classes it a driver failure, read_unavailable, exit 3 (case 6), never printed
    const hostile = new Proxy(repository, { get(target, property, receiver) { const value = Reflect.get(target, property, receiver) as unknown; return property === "history" ? async () => { throw { message: plant }; } : typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value; } });
    const repositoryThrow = await cli(readArgs("run-trace"), { repository: hostile });
    expect(repositoryThrow.code).toBe(TRACE_READ_EXIT.unavailable);
    expect(printed(repositoryThrow)).not.toContain(plant);
  });

  it("5. no secret: a PEM marker the B11 validators admit (a run trace warning) is kept by C1's store yet `withheld` by the read (TRACE_READ_SECRET_SHAPED) and never printed; a key-shaped value never reaches `ok` - the validators refuse it on write (the store) and on read (`corrupt`) - and never reaches the output either; the stdout is clear of secret shapes; the WHOLE-document check: two records each clean alone whose compact renderings together match the credential-in-URL shape are withheld whole (one entry keyed by the kind, exit 1), in the other order both are read, and with the cap dropping a third record first `omitted` counts the dropped record too", { timeout: 60_000 }, async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    const pem = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    const key = ["sk", "-", "abcdefghijklmnopqrstuvwxyz0123456789"].join("");
    expect(containsSecretShapedText(pem)).toBe(false); // the redaction authority does not know the marker ...
    expect(secretShapedRendering(pem)).toBe(true); // ... the call record's key-shape rule does
    expect(secretShapedRendering(key)).toBe(true);
    const store = new DurableRunTraceStore(repository);
    expect(await store.append({ scope: C3_SCOPE, document: c3Trace("run-b24c3-pem", "trace-b24c3-pem", { warnings: [`the operator planted ${pem}`] }), at: C3_AT })).toMatchObject({ ok: true }); // admitted by B11's validator
    expect(await store.append({ scope: C3_SCOPE, document: { ...c3Trace("run-b24c3-key", "trace-b24c3-key"), warnings: [key] }, at: C3_AT })).toMatchObject({ ok: false, code: "invalid_document" }); // refused on write
    expect(await store.append({ scope: C3_SCOPE, document: c3Trace("run-b24c3-clean", "trace-b24c3-clean"), at: C3_AT })).toMatchObject({ ok: true });
    const run = await cli(readArgs("run-trace"), { repository });
    expect(run.code).toBe(TRACE_READ_EXIT.failed);
    expect(run.document!.records.map((record) => (record.document as RunTraceRecord).runId)).toEqual(["run-b24c3-clean"]);
    expect(run.document!.refused).toEqual([{ key: runTraceAggregateKey(C3_SCOPE, "run-b24c3-pem"), revision: 1, status: "withheld", code: TRACE_READ_ENTRY_CODES.withheld }]);
    expect(printed(run)).not.toContain("BEGIN");
    expect(secretShapedRendering(printed(run))).toBe(false);
    // a key-shaped value planted in a stored row (a tampered table): the store's verifier refuses it, so it is `corrupt`, never `ok`, and never printed
    const planted = tampered(repository, (row) => { if ((row.payload as { runId?: unknown }).runId === "run-b24c3-clean") (row.payload.document as { warnings: string[] }).warnings.push(key); });
    const tamper = await cli(readArgs("run-trace", "--run", "run-b24c3-clean"), { repository: planted });
    expect(tamper.code).toBe(TRACE_READ_EXIT.failed);
    expect(tamper.document!.refused).toEqual([{ key: runTraceAggregateKey(C3_SCOPE, "run-b24c3-clean"), revision: null, status: "corrupt", code: RUN_TRACE_MISMATCH }]);
    expect(printed(tamper)).not.toContain(key.slice(0, 12));
    expect(containsSecretShapedText(printed(tamper))).toBe(false);
    expect(containsSecretShapedText(printed(run))).toBe(false);
    // [B24-C3 review fix, 2026-10-09] the second check, over the WHOLE document: two records each clean alone whose compact renderings together match the redaction authority's credential-in-URL shape (`scheme://` ends one record's last warning; an `@` before any whitespace opens the next record's; JSON.stringify emits no whitespace between them) - the document is withheld whole: one `withheld` entry keyed by the kind, no record, exit 1, nothing of either printed
    const joint = new InMemoryDurableWorkflowRepository();
    const jointStore = new DurableRunTraceStore(joint);
    const urlWarning = "see https://example.invalid/b24c3";
    const atWarning = "op@example.invalid";
    expect(secretShapedRendering(urlWarning) || secretShapedRendering(atWarning)).toBe(false); // each clean alone ...
    expect(secretShapedRendering(JSON.stringify([urlWarning, atWarning]))).toBe(true); // ... a credential-in-URL shape together
    for (const [runId, warning] of [["run-b24c3-url", urlWarning], ["run-b24c3-at", atWarning]] as const) expect(await jointStore.append({ scope: C3_SCOPE, document: c3Trace(runId, `trace-${runId}`, { warnings: [warning] }), at: C3_AT })).toMatchObject({ ok: true });
    const jointKeys = ["run-b24c3-url", "run-b24c3-at"].map((runId) => runTraceAggregateKey(C3_SCOPE, runId));
    const whole = await cli(readArgs("run-trace"), { repository: inOrder(joint, jointKeys) });
    expect(whole.code).toBe(TRACE_READ_EXIT.failed);
    expect(Object.keys(whole.document!)).toEqual([...TRACE_READ_EXPORT_KEYS]);
    expect(whole.document).toMatchObject({ kind: "run-trace", scope: C3_SCOPE, records: [], refused: [{ key: "run-trace", revision: null, status: "withheld", code: TRACE_READ_ENTRY_CODES.withheld }], truncated: true, omitted: 2 });
    expect(printed(whole)).not.toContain("example.invalid");
    expect(whole.err.join(" ")).toContain("withheld 1");
    expect(secretShapedRendering(printed(whole))).toBe(false);
    // in the other order the two renderings are clean together, and both records are read: the check is the rendering's, not the records'
    const reversed = await cli(readArgs("run-trace"), { repository: inOrder(joint, [...jointKeys].reverse()) });
    expect(reversed.code).toBe(TRACE_READ_EXIT.ok);
    expect(reversed.document!.records.map((record) => record.key)).toEqual([...jointKeys].reverse());
    // with the cap dropping a third, large record first: the remaining rendering is still withheld whole, and `omitted` counts the dropped record too (three, not the two that were left when the check ran)
    expect(await jointStore.append({ scope: C3_SCOPE, document: c3Trace("run-b24c3-bulk", "trace-run-b24c3-bulk", { steps: 250 }), at: C3_AT })).toMatchObject({ ok: true });
    const bulkKey = runTraceAggregateKey(C3_SCOPE, "run-b24c3-bulk");
    const entrySizes = new Map((await joint.listHeads({ aggregateType: RUN_TRACE_AGGREGATE_TYPE, scope: C3_SCOPE })).map((head) => [head.aggregateKey, utf8Length({ key: head.aggregateKey, revision: head.revision, recordDigest: head.recordDigest, document: head.payload })]));
    const twoRecords = entrySizes.get(jointKeys[0]!)! + entrySizes.get(jointKeys[1]!)!;
    const cap = twoRecords + 2_048; // the two small records and the document's frame fit; the third alone does not
    expect(entrySizes.get(bulkKey)!).toBeGreaterThan(cap);
    const parsed = parseTraceReadArguments(readArgs("run-trace"));
    if (!parsed.ok) throw new Error("unreachable");
    const capped = await readTraceExport({ repository: inOrder(joint, [...jointKeys, bulkKey]), command: parsed.command, target: "db.invalid:5433/sirkit", now: () => new Date(NOW), bounds: { maxOutputBytes: cap } });
    expect(capped.exit).toBe(TRACE_READ_EXIT.failed);
    expect(capped.document).toMatchObject({ records: [], refused: [{ key: "run-trace", revision: null, status: "withheld", code: TRACE_READ_ENTRY_CODES.withheld }], truncated: true, omitted: 3 });
    expect(capped.text).toBe(JSON.stringify(capped.document));
    expect(capped.text).not.toContain("example.invalid");
    const cappedClean = await readTraceExport({ repository: inOrder(joint, [...jointKeys].reverse().concat(bulkKey)), command: parsed.command, target: "db.invalid:5433/sirkit", now: () => new Date(NOW), bounds: { maxOutputBytes: cap } });
    expect(cappedClean.exit).toBe(TRACE_READ_EXIT.ok);
    expect(cappedClean.document).toMatchObject({ truncated: true, omitted: 1 }); // the same cap over the clean order: the bulk record dropped, the two kept
    expect(cappedClean.document.records.map((record) => record.key)).toEqual([...jointKeys].reverse());
  });

  it("6. refusals and bounds: with --read, --limit 0 and 101 refused and 20 by default; C2's purge-only flags beside --read refused; an unknown flag, a stray word, a repeated flag, a malformed value, a bad scope, a bad or unsupported --run and a secret-shaped value each refused with its own code BEFORE any repository call; the purge's own range 1..10000 default 1,000 is untouched; the 1 MiB cap drops whole records from the end; the 30 s deadline is on the WHOLE read (fake timer: a hanging first call, and a repository answering each statement in 20 s, are each still pending at 29 999 ms and read_unavailable at 30 000 ms) and a throwing repository exits 3 read_unavailable with the code and no driver text", { timeout: 60_000 }, async () => {
    expect([...TRACE_READ_FLAGS]).toEqual(["--read", "--kind", "--tenant", "--project", "--branch", "--run", "--limit", "--acknowledge-unaudited-read"]);
    expect([...TRACE_READ_PURGE_ONLY_FLAGS]).toEqual(RETENTION_CLI_FLAGS.filter((flag) => flag !== "--limit"));
    expect(TRACE_READ_LIMITS).toEqual({ default: 20, max: 100 });
    expect(RETENTION_LIMITS).toEqual({ default: 1_000, max: 10_000 });
    expect(parseRetentionArguments(["--limit", "10000"])).toMatchObject({ ok: true, command: { limit: 10_000 } });
    expect(parseRetentionArguments(["--limit", "101"])).toMatchObject({ ok: true, command: { limit: 101 } });
    expect(parseRetentionArguments([])).toMatchObject({ ok: true, command: { limit: 1_000 } });
    expect(selectsTraceRead(["--read"])).toBe(true);
    expect(selectsTraceRead(["--as-of", NOW])).toBe(false);
    const secret = ["sk", "-", "abcdefghijklmnopqrstuvwxyz0123456789"].join("");
    const refusals: Array<[argv: string[], code: string]> = [
      [readArgs("run-trace", "--limit", "0"), "read_argument_malformed"], [readArgs("run-trace", "--limit", "101"), "read_argument_malformed"], [readArgs("run-trace", "--limit", "abc"), "read_argument_malformed"], [readArgs("run-trace", "--limit", "1.5"), "read_argument_malformed"], [readArgs("run-trace", "--limit"), "read_argument_missing"],
      [readArgs("run-trace", "--apply"), "read_arguments_conflict"], [readArgs("run-trace", "--confirm", "eng1-0000000000000000"), "read_arguments_conflict"], [readArgs("run-trace", "--as-of", NOW), "read_arguments_conflict"],
      [readArgs("run-trace", "--force"), "read_argument_unknown"], [readArgs("run-trace", "stray"), "read_argument_unknown"],
      [readArgs("run-trace", "--kind", "run-trace"), "read_argument_repeated"], [readArgs("run-trace", "--read"), "read_argument_repeated"], [readArgs("run-trace", "--acknowledge-unaudited-read", "--acknowledge-unaudited-read"), "read_argument_repeated"],
      [["--read"], "read_argument_missing"], [["--read", "--kind", "run-trace", "--tenant", "t", "--project", "p"], "read_argument_missing"], [["--kind", "run-trace", ...SCOPE_ARGS], "read_argument_missing"],
      [readArgs("nonsense"), "read_kind_unknown"], [readArgs("agent.run-trace.v1"), "read_kind_unknown"],
      [["--read", "--kind", "run-trace", "--tenant", "", "--project", "p", "--branch", "b"], "read_scope_invalid"], [["--read", "--kind", "run-trace", "--tenant", `t${String.fromCharCode(7)}`, "--project", "p", "--branch", "b"], "read_scope_invalid"],
      [readArgs("run-trace", "--run", "bad id"), "read_argument_malformed"], [readArgs("llm-call-record", "--run", "run-1"), "read_run_unsupported"], [readArgs("run-trace-attribution", "--run", "run-1"), "read_run_unsupported"], [readArgs("specialist-trace", "--run", C3_PARENT_RUN), "read_run_unsupported"],
      [["--read", "--kind", "run-trace", "--tenant", "t", "--project", secret, "--branch", "b"], "read_argument_malformed"], [readArgs("run-trace", "--run", secret), "read_argument_malformed"],
    ];
    for (const [argv, code] of refusals) {
      const { repository, reached } = counting(new InMemoryDurableWorkflowRepository());
      const run = await cli(argv, { repository });
      expect(run.code, argv.join(" ")).toBe(TRACE_READ_EXIT.refused);
      expect(run.out, argv.join(" ")).toEqual([]);
      expect(run.err.join(" "), argv.join(" ")).toContain(`REFUSED ${code}:`);
      expect(run.err.join(" "), argv.join(" ")).toContain("nothing was read");
      expect([...reached], argv.join(" ")).toEqual([]);
      expect(run.repositoryCalls, argv.join(" ")).toBe(0);
      expect(run.loads, argv.join(" ")).toBe(0); // the arguments are refused before .env.local is loaded (db-migrate's order)
      expect(printed(run)).not.toContain(secret.slice(0, 12));
      const parsed = parseTraceReadArguments(argv);
      expect(parsed.ok, argv.join(" ")).toBe(false);
      if (!parsed.ok) expect(parsed.code).toBe(code);
    }
    expect(parseTraceReadArguments(readArgs("run-trace"))).toEqual({ ok: true, command: { kind: "run-trace", scope: C3_SCOPE, runId: null, limit: 20, acknowledge: false } });
    expect(parseTraceReadArguments(["--", ...readArgs("run-trace", "--limit", "100", "--acknowledge-unaudited-read", "--run", "run-1")])).toEqual({ ok: true, command: { kind: "run-trace", scope: C3_SCOPE, runId: "run-1", limit: 100, acknowledge: true } });
    expect(parseTraceReadArguments(["--read", "--kind", "run-trace", "--tenant", ` ${C3_SCOPE.tenantId} `, "--project", C3_SCOPE.projectId, "--branch", C3_SCOPE.branchId])).toMatchObject({ ok: true, command: { scope: C3_SCOPE } }); // the scope as the substrate stores it
    expect([...TRACE_READ_RUN_SELECTABLE_KINDS]).toEqual(["run-trace", "specialist-trace"]);
    // the default limit of 20 aggregates and the 1 MiB cap: 60 run traces of 250 steps each (about 25 KB a record, 1.5 MB in all)
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableRunTraceStore(repository);
    for (let n = 0; n < 60; n += 1) expect(await store.append({ scope: C3_SCOPE, document: c3Trace(`run-b24c3-big-${n}`, `trace-b24c3-big-${n}`, { steps: 250 }), at: C3_AT })).toMatchObject({ ok: true });
    const twenty = await cli(readArgs("run-trace"), { repository });
    expect(twenty.code).toBe(TRACE_READ_EXIT.ok);
    expect(twenty.document!.records).toHaveLength(20);
    expect(twenty.document!.truncated).toBe(false);
    const all = await cli(readArgs("run-trace", "--limit", "100"), { repository });
    expect(all.code).toBe(TRACE_READ_EXIT.ok);
    expect(TRACE_READ_BOUNDS).toEqual({ maxOutputBytes: 1_048_576, readDeadlineMs: 30_000 });
    expect(new TextEncoder().encode(all.out[0]!).length).toBeLessThanOrEqual(TRACE_READ_BOUNDS.maxOutputBytes);
    expect(all.document!.truncated).toBe(true);
    expect(all.document!.omitted).toBeGreaterThanOrEqual(1);
    expect(all.document!.records.length + all.document!.omitted).toBe(60);
    const heads = await repository.listHeads({ aggregateType: RUN_TRACE_AGGREGATE_TYPE, scope: C3_SCOPE, limit: 100 });
    expect(all.document!.records.map((record) => record.key)).toEqual(heads.slice(0, all.document!.records.length).map((head) => head.aggregateKey)); // whole records from the front, in the repository's order
    for (const record of all.document!.records) expect(record.recordDigest).toBe(heads.find((head) => head.aggregateKey === record.key)!.recordDigest); // every kept record whole
    expect(all.err.join(" ")).toContain(`truncated true (omitted ${all.document!.omitted})`);
    // the deadline: a repository whose listHeads never answers; the fake clock advances 30 s - and one millisecond before it the read is still pending ([B24-C3 review fix, 2026-10-09]: a shorter deadline than the constant would have settled it)
    const slowBase = new InMemoryDurableWorkflowRepository();
    await seeded(slowBase);
    vi.useFakeTimers();
    const hanging = new Proxy(new InMemoryDurableWorkflowRepository(), { get(target, property, receiver) { const value = Reflect.get(target, property, receiver) as unknown; return property === "listHeads" ? () => new Promise(() => {}) : typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value; } });
    let hangSettled = false;
    const pending = cli(readArgs("run-trace"), { repository: hanging }).then((result) => { hangSettled = true; return result; });
    await vi.advanceTimersByTimeAsync(TRACE_READ_BOUNDS.readDeadlineMs - 1);
    expect(hangSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(hangSettled).toBe(true);
    const expired = await pending;
    expect(expired.code).toBe(TRACE_READ_EXIT.unavailable);
    expect(expired.document).toMatchObject({ schema: TRACE_READ_EXPORT_SCHEMA, kind: "run-trace", records: [], refused: [{ key: "run-trace", revision: null, status: "unavailable", code: TRACE_READ_ENTRY_CODES.unavailable }], truncated: false, omitted: 0 });
    expect(expired.err.join(" ")).toContain(`FAILED ${TRACE_READ_ENTRY_CODES.unavailable}`);
    // [B24-C3 review fix, 2026-10-09] the deadline is on the WHOLE read, one clock from the first repository call, not on each call alone: a repository that answers every statement after 20 s (the listing, then the one chain: 40 s in all) is still pending at 29 999 ms and read_unavailable at 30 000 ms
    let slowSettled = false;
    const slowRead = cli(readArgs("run-trace"), { repository: slow(slowBase, 20_000) }).then((result) => { slowSettled = true; return result; });
    await vi.advanceTimersByTimeAsync(TRACE_READ_BOUNDS.readDeadlineMs - 1);
    expect(slowSettled).toBe(false); // the listing answered at 20 s; the chain is pending
    await vi.advanceTimersByTimeAsync(1);
    expect(slowSettled).toBe(true); // the whole read expired at 30 s, though no single call had
    const late = await slowRead;
    vi.useRealTimers();
    expect(late.code).toBe(TRACE_READ_EXIT.unavailable);
    expect(late.document).toMatchObject({ kind: "run-trace", records: [], refused: [{ key: "run-trace", revision: null, status: "unavailable", code: TRACE_READ_ENTRY_CODES.unavailable }] });
    expect(late.err.join(" ")).toContain(`FAILED ${TRACE_READ_ENTRY_CODES.unavailable}`);
    // a driver error after the first repository call: the code, never the driver's text
    const throwing = new Proxy(new InMemoryDurableWorkflowRepository(), { get(target, property, receiver) { const value = Reflect.get(target, property, receiver) as unknown; return property === "listHeads" ? async () => { throw new Error(`connection refused for ${FAKE_URL}`); } : typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value; } });
    const failed = await cli(readArgs("run-trace"), { repository: throwing });
    expect(failed.code).toBe(TRACE_READ_EXIT.unavailable);
    expect(failed.document!.refused).toEqual([{ key: "run-trace", revision: null, status: "unavailable", code: TRACE_READ_ENTRY_CODES.unavailable }]);
    for (const text of [printed(failed), printed(expired)]) { expect(text).not.toContain("connection refused"); expect(text).not.toContain(FAKE_PASSWORD); expect(text).not.toContain(FAKE_USER); expect(text).not.toContain("postgres://"); }
    expect(new TraceReadUnavailableError("driver")).toMatchObject({ code: TRACE_READ_ENTRY_CODES.unavailable, reason: "driver", message: TRACE_READ_ENTRY_CODES.unavailable });
  });

  it("7. production acknowledgement: in a production runtime the read is refused read_production_unacknowledged with zero repository calls; with --acknowledge-unaudited-read it reads, and the export states accessAudit not_recorded (OD-211; OD-111 stands)", async () => {
    const repository = new InMemoryDurableWorkflowRepository();
    await seeded(repository);
    const { repository: counted, reached } = counting(repository);
    const refused = await cli(readArgs("run-trace"), { repository: counted, production: true });
    expect(refused.code).toBe(TRACE_READ_EXIT.refused);
    expect(refused.out).toEqual([]);
    expect(refused.err.join(" ")).toContain("REFUSED read_production_unacknowledged:");
    expect(refused.err.join(" ")).toContain("--acknowledge-unaudited-read");
    expect([...reached]).toEqual([]);
    expect(refused.repositoryCalls).toBe(0);
    const acknowledged = await cli(readArgs("run-trace", "--acknowledge-unaudited-read"), { repository: counted, production: true });
    expect(acknowledged.code).toBe(TRACE_READ_EXIT.ok);
    expect(acknowledged.document!.records).toHaveLength(1);
    expect(acknowledged.document!.accessAudit).toBe("not_recorded");
    expect(TRACE_READ_ACCESS_AUDIT).toBe("not_recorded");
    expect(acknowledged.err.join(" ")).toContain("access audit not_recorded");
    expect((await cli(readArgs("run-trace"), { repository: counted, production: false })).code).toBe(TRACE_READ_EXIT.ok); // a non-production runtime needs no flag
  });

  it("8. the excluded kinds, each by its exact aggregate type name - the orchestration run and resume records, the grant and its index, the autonomy setting, the provider exchange, the computation evidence - are read_kind_unknown with zero repository calls; the readable four are exactly the kinds", async () => {
    const excluded = [ORCHESTRATION_AGGREGATE_TYPE, ORCHESTRATION_RESUME_AGGREGATE_TYPE, EXECUTION_GRANT_AGGREGATE_TYPE, EXECUTION_GRANT_INDEX_AGGREGATE_TYPE, AUTONOMY_AGGREGATE_TYPE, PROVIDER_EXCHANGE_AGGREGATE_TYPE, COMPUTATION_EVIDENCE_AGGREGATE_TYPE];
    expect(excluded).toEqual(["agent.orchestration-run.v1", "agent.orchestration-resume.v1", "agent.execution-grant.v1", "agent.execution-grant-index.v1", "agent.autonomy-settings.v1", "mfg.provider-exchange.v1", "computation.evidence.v1"]);
    for (const name of [...excluded, "orchestration-run", "orchestration-resume", "execution-grant", "autonomy-settings", "provider-exchange", "computation-evidence", "trace-salt", "agent.trace-salt.v1"]) {
      const { repository, reached } = counting(new InMemoryDurableWorkflowRepository());
      const run = await cli(readArgs(name), { repository });
      expect(run.code, name).toBe(TRACE_READ_EXIT.refused);
      expect(run.err.join(" "), name).toContain("REFUSED read_kind_unknown:");
      expect([...reached], name).toEqual([]);
      expect(run.repositoryCalls, name).toBe(0);
    }
    expect([...TRACE_READ_KINDS]).toEqual(["run-trace", "run-trace-attribution", "llm-call-record", "specialist-trace"]);
    expect(Object.values(TRACE_READ_AGGREGATE_TYPES).some((type) => excluded.includes(type))).toBe(false);
    // the core imports no store of an excluded kind
    const specifiers = [...runtimeDeclarationSpecifiers(CORE, read(CORE))].sort();
    expect(specifiers).toEqual(["../agent/orchestration/trace-attribution", "../agent/redaction", "../durable-workflow/stable", "./llm-call-record", "./llm-call-record-store", "./run-trace-attribution", "./run-trace-store"]);
  });

  it("9. the CLI through runTraceReadCli with env {}: exit 2 naming DATABASE_URL only, after .env.local was loaded once and before any repository is opened; with a connection string the target is host:port/database; a driver error carrying the URL's user and password - at the repository's opening or at its first call - exits 3 with nothing of it printed", async () => {
    const missing = await cli(readArgs("run-trace"), { env: {} });
    expect(missing.code).toBe(TRACE_READ_EXIT.refused);
    expect(missing.out).toEqual([]);
    expect(missing.err).toEqual([`REFUSED read_database_url_missing: ${URL_NAME} is not set (add it to .env.local or the environment). - nothing was read.`]);
    expect(missing.loads).toBe(1);
    expect(missing.repositoryCalls).toBe(0);
    const empty = await cli(readArgs("run-trace"), { env: { [URL_NAME]: "" } });
    expect(empty.code).toBe(TRACE_READ_EXIT.refused);
    expect(empty.loads).toBe(1);
    expect(redactedTraceReadTarget(FAKE_URL)).toBe("db.invalid:5433/sirkit");
    expect(redactedTraceReadTarget("postgres://u:p@host.invalid/db")).toBe("host.invalid:5432/db");
    expect(redactedTraceReadTarget("not a url")).toBe("<unparseable url>");
    const repository = new InMemoryDurableWorkflowRepository();
    await seeded(repository);
    const ok = await cli(readArgs("run-trace"), { repository });
    expect(ok.loads).toBe(1);
    expect(ok.repositoryCalls).toBe(1);
    expect(ok.document!.target).toBe("db.invalid:5433/sirkit");
    const opening = await cli(readArgs("run-trace"), { repositoryFor: (url) => { throw new Error(`could not open ${url}: password authentication failed for user "${FAKE_USER}"`); } });
    expect(opening.code).toBe(TRACE_READ_EXIT.unavailable);
    expect(opening.document).toMatchObject({ target: "db.invalid:5433/sirkit", records: [], refused: [{ key: "run-trace", revision: null, status: "unavailable", code: TRACE_READ_ENTRY_CODES.unavailable }] });
    const firstCall = await cli(readArgs("run-trace"), { repository: new Proxy(repository, { get(target, property, receiver) { const value = Reflect.get(target, property, receiver) as unknown; return property === "listHeads" ? async () => { throw new Error(`connection to ${FAKE_URL} refused`); } : typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value; } }) });
    expect(firstCall.code).toBe(TRACE_READ_EXIT.unavailable);
    for (const run of [missing, empty, ok, opening, firstCall]) {
      const text = printed(run);
      expect(text).not.toContain(FAKE_PASSWORD);
      expect(text).not.toContain(FAKE_USER);
      expect(text).not.toContain("postgres://");
      expect(text).not.toContain("authentication failed");
      expect(text).not.toContain("refused for");
      expect(containsSecretShapedText(text)).toBe(false);
    }
  });
});

// ── The import gates (AST; the B21-A and B24-C1 patterns) ─────────────────────────────────────────────────────────────────────────
const NEVER = ["app/lib/durable-workflow/runtime.ts", "app/lib/durable-workflow/server-repository.ts", "app/lib/db/client.ts", "app/lib/db/schema.ts"] as const;
/** [B20 A5] the provider SDK specifiers, matched on the bare specifier the closure walk never follows */
const SDK_SPECIFIER = /^(?:openai|@anthropic-ai\/sdk)(?:\/.*)?$/;
function runtimeEdges(map: FileMap, file: string): string[] {
  const source = map.get(file)!;
  const runtime = runtimeDeclarationSpecifiers(file, source);
  const edges: string[] = [];
  for (const reference of moduleReferences(file, source)) {
    if (reference.kind === "import-type") continue;
    if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
    const resolution = resolveSpecifier(file, reference.specifier);
    if (resolution.kind !== "module") continue;
    const target = fileOf(map, resolution.module);
    if (target !== null && !edges.includes(target)) edges.push(target);
  }
  return edges;
}
/** The direct runtime importers of `target` (a type-only import does not count); only a file naming the target's basename can. */
function importersOf(map: FileMap, target: string): string[] {
  const name = target.split("/").at(-1)!.replace(/\.ts$/, "");
  return [...map.keys()].filter((file) => file !== target && map.get(file)!.includes(name) && runtimeEdges(map, file).includes(target)).sort();
}
/** every provider-SDK specifier a closure member imports for its VALUE */
function sdkReached(files: FileMap, closure: ReadonlyMap<string, readonly string[]>): string[] {
  const found: string[] = [];
  for (const [file, chain] of closure) {
    const source = files.get(file)!;
    const runtime = runtimeDeclarationSpecifiers(file, source);
    for (const reference of moduleReferences(file, source)) {
      if (reference.kind === "import-type") continue;
      if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
      if (SDK_SPECIFIER.test(reference.specifier)) found.push(`SDK: ${chain.join(" -> ")} -> ${reference.specifier}`);
    }
  }
  return found;
}
const yieldNow = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("[B24-C3] the import gates: the read core and the CLI stay at the operator's edge", () => {
  it("10. the core and the CLI are in no app/api/**/route.ts closure, in no app/lib/mcp/server/** closure and in no closure of the agent loop, the gateway or app/lib/agent/orchestration/**; the core's one production importer is the CLI; the core's runtime closure imports no provider SDK and holds none of the durable runtime, the server repository, the database client or the schema; its source has no process.env reference and never names the provider directory; the PostgreSQL repository is constructed by exactly the durable runtime and the CLI (D11); the core sits under app/lib/observability/ and C1's approved-importer gates admit it with neither importer list moved; the CLI dispatches --read before the purge parser, loads .env.local for the read mode only and runs only as the entry module", { timeout: 180_000 }, async () => {
    const map = collectProductionFiles(ROOT);
    expect(map.has(CORE) && map.has(CLI)).toBe(true);
    expect(CORE.startsWith("app/lib/observability/")).toBe(true);
    const routeFiles = listRouteFiles(ROOT).map((file) => relative(ROOT, file).split(sep).join("/"));
    expect(routeFiles.length).toBeGreaterThan(100);
    const routes = importClosure(map, routeFiles);
    expect(routes.size).toBeGreaterThan(300);
    expect(routes.has(CORE) || routes.has(CLI)).toBe(false);
    await yieldNow();
    const mcp = importClosure(map, [...map.keys()].filter((file) => file.startsWith("app/lib/mcp/server/")));
    expect(mcp.size).toBeGreaterThan(20);
    expect(mcp.has(CORE) || mcp.has(CLI)).toBe(false);
    await yieldNow();
    const agent = importClosure(map, ["app/lib/agent/loop.ts", "app/lib/agent/gateway.ts", ...[...map.keys()].filter((file) => file.startsWith("app/lib/agent/orchestration/"))]);
    expect(agent.size).toBeGreaterThan(100);
    expect(agent.has(CORE) || agent.has(CLI)).toBe(false);
    await yieldNow();
    expect(importersOf(map, CORE)).toEqual([CLI]);
    const core = importClosure(map, [CORE]);
    expect(core.size).toBeGreaterThan(8);
    for (const member of ["app/lib/observability/run-trace-store.ts", "app/lib/observability/run-trace-attribution.ts", "app/lib/observability/llm-call-record-store.ts", "app/lib/agent/orchestration/trace-attribution.ts", "app/lib/agent/redaction.ts", "app/lib/durable-workflow/stable.ts"]) expect(core.has(member), member).toBe(true);
    expect(NEVER.filter((never) => core.has(never))).toEqual([]);
    expect([...core.keys()].filter((file) => file.startsWith("app/lib/durable-workflow/retention") || file.startsWith("app/api/") || file.startsWith("app/lib/mcp/") || file === "app/lib/agent/loop.ts" || file === "app/lib/agent/gateway.ts" || file === "app/lib/agent/adapters.ts" || file === "app/lib/embeddings.ts")).toEqual([]);
    expect([...core.keys()].filter((file) => file.startsWith("app/lib/auth/") || file.startsWith("app/lib/db/"))).toEqual([]); // [B24-C3 review fix, 2026-10-09] no membership, role or policy module and no database module in the core: the scope flags are the operator's assertions and the database credential is the only authorization (section 36)
    expect(sdkReached(map, core)).toEqual([]);
    const source = map.get(CORE)!;
    expect(source).not.toContain(["process", ".env"].join(""));
    expect(source).not.toContain(["manufacturing", "-providers"].join(""));
    expect(map.get(CLI)!).not.toContain(["manufacturing", "-providers"].join(""));
    // the constructor census (D11): the durable runtime's singleton and the CLI's repositoryFor, nothing else
    expect([...map].filter(([, text]) => /new\s+PostgresDurableWorkflowRepository\s*\(/.test(text)).map(([path]) => path).sort()).toEqual(["app/lib/durable-workflow/runtime.ts", CLI]);
    expect(map.get("app/lib/durable-workflow/retention.ts")!).not.toMatch(/new\s+PostgresDurableWorkflowRepository\s*\(/);
    // C1's approved-importer gates, unmoved: the stores' importers outside app/lib/observability/ are the two composition roots only
    expect(importersOf(map, "app/lib/observability/run-trace-store.ts").filter((file) => file !== "app/api/chat/trace-runtime.ts" && !file.startsWith("app/lib/observability/"))).toEqual([]);
    expect(importersOf(map, "app/lib/observability/llm-call-record-store.ts").filter((file) => !file.startsWith("app/lib/observability/"))).toEqual([]);
    expect(importersOf(map, "app/lib/observability/run-trace-attribution.ts").filter((file) => file !== "app/api/chat/attribution-runtime.ts" && !file.startsWith("app/lib/observability/"))).toEqual([]);
    for (const store of ["app/lib/observability/run-trace-store.ts", "app/lib/observability/llm-call-record-store.ts", "app/lib/observability/run-trace-attribution.ts"]) expect(importersOf(map, store), store).toContain(CORE);
    // the CLI: its runtime imports, the dispatch, the loader for the read mode only, the entry guard on its last line - TEXT pins; the dispatch, the hand-over of the loader, the repository and the port, and the client's close are EXECUTED by b24-c3-trace-read-pglite 4 ([B24-C3 review fix, 2026-10-09]: + `../app/lib/db/client`, whose raw client the read mode ends after a read)
    expect([...runtimeDeclarationSpecifiers(CLI, map.get(CLI)!)].sort()).toEqual(["../app/lib/auth/deployment-profile", "../app/lib/auth/mode", "../app/lib/db/client", "../app/lib/durable-workflow/retention", "../app/lib/durable-workflow/retention-cli", "../app/lib/durable-workflow/server-repository", "../app/lib/load-env-local", "../app/lib/observability/trace-read"]);
    const cliSource = map.get(CLI)!;
    expect(cliSource).toContain("selectsTraceRead(argv)");
    expect(cliSource).toContain("runTraceReadCli({");
    expect(cliSource).toContain("runRetentionCli(argv, {");
    expect(cliSource.match(/loadEnvLocal/g)).toHaveLength(2); // the import and the one hand-over into the read runner
    const lines = cliSource.trimEnd().split(NEWLINE);
    expect(lines.at(-1)).toMatch(/^if \(ENTRY_MODULE\) void main\(process\.argv\.slice\(2\), process\.env\)/);
    expect(cliSource).toContain('const ENTRY_MODULE = /retention-purge(?:\\.[cm]?[jt]s)?$/.test(process.argv[1] ?? "");'); // [B24-C3 review fix, 2026-10-09] the suffix is optional: `tsx scripts/retention-purge` resolves argv[1] without one
    expect(cliSource.match(/\bmain\(/g)).toHaveLength(2); // its declaration and the guarded call
    // [B24-C3 review fix, 2026-10-09] the guard's pattern, parsed from the source: the script's path with or without a suffix, in any of the four extensions, on either separator; never vitest's own entry, another script, a backup copy or an empty argv[1]
    const guardSource = /const ENTRY_MODULE = \/(.+?)\/\.test\(process\.argv\[1\] \?\? ""\);/.exec(cliSource);
    expect(guardSource).not.toBeNull();
    const guard = new RegExp(guardSource![1]!);
    const BACKSLASH = String.fromCharCode(92);
    for (const admitted of ["/x/sirkit/scripts/retention-purge.ts", "/x/sirkit/scripts/retention-purge", ["C:", "sirkit", "scripts", "retention-purge.ts"].join(BACKSLASH), ["C:", "sirkit", "scripts", "retention-purge"].join(BACKSLASH), "/x/scripts/retention-purge.mts", "/x/scripts/retention-purge.cts", "/x/scripts/retention-purge.cjs", "/x/scripts/retention-purge.mjs", "/x/scripts/retention-purge.js"]) expect(guard.test(admitted), admitted).toBe(true);
    for (const refused of [process.argv[1] ?? "", "/x/node_modules/vitest/vitest.mjs", "/x/scripts/retention-purge-report.ts", "/x/scripts/db-migrate.ts", "/x/scripts/retention-purge.ts.bak", "/x/scripts/retention-purge.test.ts", ""]) expect(guard.test(refused), refused).toBe(false);
    // injected probes: a route importing the core, an MCP module importing the CLI, a loop-side import of the core, each caught; a type-only import is not
    const probe = (path: string, append: string): FileMap => new Map(map).set(path, `${map.get(path)!}${NEWLINE}${append}${NEWLINE}`);
    expect(importClosure(probe("app/api/chat/route.ts", 'import { runTraceReadCli as b24c3Probe } from "@/app/lib/observability/trace-read";' + NEWLINE + "export const b24c3 = b24c3Probe;"), ["app/api/chat/route.ts"]).get(CORE)).toEqual(["app/api/chat/route.ts", CORE]);
    expect(importClosure(probe("app/lib/mcp/server/dispatch.ts", 'import "../../../../scripts/retention-purge";'), ["app/lib/mcp/server/dispatch.ts"]).has(CLI)).toBe(true);
    expect(importersOf(probe("app/lib/agent/loop.ts", 'import { readTraceExport as b24c3Probe } from "../observability/trace-read";' + NEWLINE + "export const b24c3 = b24c3Probe;"), CORE).sort()).toEqual(["app/lib/agent/loop.ts", CLI]);
    expect(importersOf(probe("app/lib/agent/loop.ts", 'import type { TraceReadExport } from "../observability/trace-read";' + NEWLINE + "export type B24c3Probe = TraceReadExport;"), CORE)).toEqual([CLI]);
    expect(importClosure(probe(CORE, 'import { getDurableWorkflowRepository } from "../durable-workflow/runtime";' + NEWLINE + "export const b24c3Probe = getDurableWorkflowRepository;"), [CORE]).has("app/lib/durable-workflow/runtime.ts")).toBe(true);
    const sdkProbe = probe(CORE, 'import OpenAI from "openai";' + NEWLINE + "export const b24c3Probe = OpenAI;");
    expect(sdkReached(sdkProbe, importClosure(sdkProbe, [CORE]))).toEqual([`SDK: ${CORE} -> openai`]);
  });
});
