/**
 * [B24-A4] Logical dump and restore (D24-7 offline, OD-194) and a lost connection failing closed (D24-7, D24-3), proven on PGlite
 * only. A real-platform backup, PITR, failover, reconnection and a real-server restore stay BLOCKED-LIVE-QUALIFICATION (LB-14).
 *
 *  1. counterexample (red on 3cd7d6e: nothing dumps or restores): the fixture - an active and a revoked membership, an owned BOM
 *     snapshot, one physical-binding aggregate, one `mfg.provider-exchange.v1` attempt settled through B23's fakes and one
 *     `computation.evidence.v1` record appended through `createComputationEvidenceStore(new PostgresDurableWorkflowRepository())` -
 *     dumps (`sirkit.db-logical-dump.v1`) and restores into a bare target and into a migrated empty one, each copy with an equal
 *     fingerprint, ledger, counts and digests;
 *  2. the row-order rule: a table with no primary key (`architecture_candidates`; 42 of the 143 have none) dumps the same rows
 *     inserted in two orders to equal digests; a table with one is ordered by it; no row value passes through a JavaScript number;
 *  3. both aggregates load on the copy through their own verifying stores, with the same digests;
 *  4. the refusals: a target holding a row (claimed or not - the claim marker is never a reason to accept one), a ledger that is
 *     not the manifest's or that the target has passed, a tampered envelope (all before any write), and a mismatch only the loaded
 *     rows show (rolled back);
 *  5. a lost connection fails closed: with the PostgreSQL membership repository bound and every query failing, the trusted context
 *     never resolves and no handler runs (the request rejects, so no Sirkit body is built - the framework's 500, INFERRED); an
 *     exchange `prepare` and an evidence append that lose the connection after their first statement leave no head, record or
 *     replay row, and each retried append writes exactly once;
 *  6. [B24-A4 review, 2026-10-08] a dump as a role that row security may hide rows from - a SELECT-only role without BYPASSRLS after
 *     0031, or an owner without BYPASSRLS whose table is FORCEd - is refused `DB_DUMP_ROWS_HIDDEN` before it reads a row (it would
 *     otherwise be an empty dump that looks valid), and the restore refuses that owner as a target.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import * as schema from "../../../db/schema";
import { loadMigrationManifest, truncateManifest, MIGRATION_LEDGER_TABLE } from "../../../db/migrations/manifest";
import { migrateDatabase } from "../../../db/migrations/runner";
import { captureSchemaSnapshot, schemaFingerprint } from "../../../db/migrations/verify-schema";
import { disposablePostgres, type DisposablePostgres } from "../../../db/disposable-postgres";

let orm: unknown;
vi.mock("../../../db/client", () => ({ getDb: () => orm }));

import { requireDisposableQualificationTarget } from "../../../db/qualification-target";
import { resetAdmissionControl } from "../../../acquisition/admission-control";
import { PostgresDurableWorkflowRepository } from "../../../durable-workflow/server-repository";
import { createComputationEvidenceStore, encodeEvidenceNumber, type ComputationEvidenceDocument } from "../../../computation/evidence-store";
import { buildOutboundPackage } from "../../../manufacturing-providers/outbound-package";
import { sendProviderExchange } from "../../../manufacturing-providers/provider-egress";
import { createProviderExchangeLedger, exchangeAggregateKey, exchangeAttemptInput, type ExchangeAggregate } from "../../../manufacturing-providers/exchange-ledger";
import { syntheticLedgerRecord, syntheticRelease } from "../../../manufacturing-providers/__tests__/_b23-b-release-fixture";
import { FAKE_ENV, PUBLIC_RESOLVE, fakeCredential, fakeDescriptor, fakeProvider } from "../../../manufacturing-providers/__tests__/_b23-b2-fake-provider";
import { PostgresPhysicalBindingRepository } from "../../../physical-binding/server-repository";
import { physicalBindingAggregate } from "../../../physical-binding/__tests__/_schema-integrity-scope";
import { PostgresProjectMembershipRepository } from "../../../auth/postgres-membership";
import { resolveTrustedRequestContext } from "../../../auth/trusted-request-context";
import { authenticatedRoute } from "../../../auth/route-handlers";
import { injectIdentity, injectMembershipRepository, resetInjectedIdentity } from "../../../auth/test-support";

const recovery = () => import("../../../db/recovery/logical-dump");
type LogicalDump = Awaited<ReturnType<Awaited<ReturnType<typeof recovery>>["createLogicalDump"]>>;
const U1 = "11111111-1111-1111-1111-111111111111", U2 = "22222222-2222-2222-2222-222222222222";
const T0 = Date.parse("2026-10-08T12:00:00.000Z");
const AT = new Date(T0).toISOString();
const TENANT = "tenant-b24a4-restore";
const EXCHANGE: ExchangeAggregate = { scope: { tenantId: TENANT, projectId: "proj-r", branchId: "main" }, designId: "design:proj-r", boardId: "board:proj-r-1", providerId: "jlcpcb" };
const EVIDENCE_SCOPE = { tenantId: TENANT, projectId: "proj-r", branchId: "main" };
const hex = (character: string): string => character.repeat(64);
const PLAN = (key: string, pkg = "c") => ({ planId: `provider-exchange-plan:${key}`, planDigest: `dw1-${"9".repeat(64)}`, requestDigest: `dw1-${pkg.repeat(64)}`, purpose: "quote" as const, provider: { operationId: "pcb-quote", descriptorVersion: "1.0.0", descriptorDigest: `dw1-${"d".repeat(64)}` }, release: { releaseId: "mfg-release-pglite", archiveSha256: "e".repeat(64) }, outbound: { outboundPackageDigest: `mfg-outbound-${pkg.repeat(64)}` } });

function evidenceDocument(subjectId: string): ComputationEvidenceDocument {
  return {
    schema: "sirkit.computation-evidence.v1",
    kind: "spice-run",
    subjectId,
    labels: ["diagnostic_only", "environment_dependent"],
    authority: "evidence_only",
    input: { binding: "bound to a submitted snapshot", snapshotSha256: hex("1") },
    profile: { profileId: "ngspice-local-diagnostic", profileDigest: hex("2"), installDigest: `sirkit-install-tree-sha256/1:${hex("3")}`, seed: "1" },
    modelLibraries: [{ id: "model-1", contentRef: `artifact://sha256/${hex("8")}` }],
    rawArtifacts: [{ role: "executed-netlist", sha256: hex("4"), bytes: null }, { role: "ngspice-ascii-raw", sha256: hex("5"), bytes: 1024 }],
    summary: {
      scalars: [{ name: "VOUT", unit: "V", status: "pass", value: encodeEvidenceNumber(2.5) }, { name: "GAIN", unit: "dB", status: "not-evaluated", value: encodeEvidenceNumber(Number.NaN) }],
      waveforms: [{ name: "v(out)", unit: "V", xName: "time", xUnit: "s", points: 3, valuesSha256: hex("6") }],
    },
  } as ComputationEvidenceDocument;
}

/** One whole exchange of `key` against the PostgreSQL record (B23-B2's pattern): prepare, and for a fresh attempt send and settle. */
async function exchangeOnce(target: ExchangeAggregate, key: string) {
  resetAdmissionControl();
  const release = syntheticRelease();
  const built = buildOutboundPackage({ release, ledger: syntheticLedgerRecord(release) });
  if (!built.ok) throw new Error(built.refusal);
  const ledger = createProviderExchangeLedger(new PostgresDurableWorkflowRepository());
  const descriptor = fakeDescriptor();
  const provider = fakeProvider();
  const begun = await ledger.prepare({ aggregate: target, attempt: exchangeAttemptInput({ plan: PLAN(key), key, actorId: "u-b24-admin", descriptor, capabilityProfile: { profileId: "jlcpcb-2l", version: 2 } }), at: AT });
  if (!begun.ok || begun.replayed) throw new Error("expected a fresh attempt");
  const outcome = await sendProviderExchange({ descriptor, package: built.package, idempotencyKey: begun.attempt.providerIdempotencyKey, env: { [FAKE_ENV]: fakeCredential() }, beforeSend: async (request) => { await ledger.markSent({ aggregate: target, idempotencyKey: key, request, at: AT }); } }, { fetch: provider.fetch, resolve: PUBLIC_RESOLVE, clock: () => T0 });
  return ledger.settle({ aggregate: target, idempotencyKey: key, outcome, at: AT });
}

/** The fixture of 9.4: memberships, an owned BOM snapshot, a physical-binding aggregate, an exchange attempt and an evidence record. */
async function seedFixture(db: DisposablePostgres): Promise<void> {
  orm = drizzle(db.db, { schema });
  await db.exec(`
    INSERT INTO project_members VALUES ('m-active','${TENANT}','proj-r','${U1}','editor','active',1,'2026-10-08T00:00:00Z','2026-10-08T00:00:00Z','operator');
    INSERT INTO project_members VALUES ('m-revoked','${TENANT}','proj-r','${U2}','viewer','revoked',2,'2026-10-08T00:00:00Z','2026-10-08T01:00:00Z','operator');
    INSERT INTO bom_snapshots (project_key, label, snapshot_data, bom_meta, tenant_id, project_id, branch_id, taken_at) VALUES ('proj-r', 'Pre-EVT', '[{"ref":"R1","qty":2,"unitPrice":0.0123456789012345678}]'::jsonb, '{"total":0.0246913578024691356,"risk":"low"}'::jsonb, '${TENANT}', 'proj-r', 'main', '2026-10-08T00:00:00Z');
  `);
  await new PostgresPhysicalBindingRepository().commit(await physicalBindingAggregate("restore", TENANT));
  const settled = await exchangeOnce(EXCHANGE, "restore-key-1");
  expect(settled.state).toBe("acknowledged");
  const appended = await createComputationEvidenceStore(new PostgresDurableWorkflowRepository()).append({ scope: EVIDENCE_SCOPE, evidenceId: "run_b24a4", expectedRevision: 0, document: evidenceDocument("run_b24a4"), at: AT });
  expect(appended).toMatchObject({ ok: true, revision: 1 });
}

const open: DisposablePostgres[] = [];
async function fresh(migrate: boolean | number = true): Promise<DisposablePostgres> {
  const db = await disposablePostgres();
  open.push(db);
  const manifest = loadMigrationManifest();
  if (migrate !== false) await migrateDatabase(db, { manifest: migrate === true ? manifest : truncateManifest(manifest, migrate) });
  return db;
}
let source: DisposablePostgres;
beforeAll(async () => {
  source = await disposablePostgres();
  await migrateDatabase(source, { manifest: loadMigrationManifest() });
  await seedFixture(source);
}, 180_000);
afterAll(async () => { await source?.close(); });
afterEach(async () => { for (const db of open.splice(0)) await db.close(); resetInjectedIdentity(); });

const ledgerOf = async (db: DisposablePostgres) => ((await db.query<{ present: boolean }>(`SELECT to_regclass('public.${MIGRATION_LEDGER_TABLE}') IS NOT NULL AS present`))[0]!.present ? db.query<{ name: string; checksum: string }>(`SELECT name, checksum FROM "${MIGRATION_LEDGER_TABLE}" ORDER BY name`) : []);
const fingerprintOf = async (db: DisposablePostgres) => schemaFingerprint(await captureSchemaSnapshot(db));
async function refusalOf(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; message: string };
  }
  throw new Error("expected a refusal");
}

describe("[B24-A4] logical dump and restore (D24-7 offline, OD-194)", () => {
  it("1. counterexample (red on 3cd7d6e: nothing dumps or restores): the fixture round-trips into a bare target and into a migrated empty one - equal fingerprint, ledger, counts and digests", { timeout: 240_000 }, async () => {
    const { createLogicalDump, restoreLogicalDump, LOGICAL_DUMP_SCHEMA } = await recovery();
    const manifest = loadMigrationManifest();
    const dump = await createLogicalDump(source);
    expect(dump.schema).toBe(LOGICAL_DUMP_SCHEMA);
    expect(LOGICAL_DUMP_SCHEMA).toBe("sirkit.db-logical-dump.v1");
    expect(dump.fingerprint).toBe(await fingerprintOf(source));
    expect(dump.ledger).toEqual((await ledgerOf(source)).map((row) => ({ name: row.name, checksum: row.checksum })));
    expect(dump.ledger).toHaveLength(32);
    expect(dump.tables).toHaveLength(143);
    const counts = Object.fromEntries(dump.tables.filter((table) => table.rows > 0).map((table) => [table.name, table.rows]));
    expect(counts).toMatchObject({ project_members: 2, bom_snapshots: 1, physical_binding_revisions: 1, physical_binding_sets: 1, physical_binding_audit_events: 1, physical_binding_migration_records: 1, physical_readiness_assessments: 1 });
    expect(counts.durable_workflow_records).toBe(4); // the exchange's prepared, sent and settled records and the evidence record
    for (const target of [await fresh(false), await fresh(true)]) {
      const result = await restoreLogicalDump(target, dump, { manifest });
      expect(result.rows).toBe(dump.tables.reduce((sum, table) => sum + table.rows, 0));
      const copy = await createLogicalDump(target);
      expect(copy.fingerprint).toBe(dump.fingerprint);
      expect(copy.ledger).toEqual(dump.ledger);
      expect(copy.tables.map((table) => [table.name, table.rows, table.sha256])).toEqual(dump.tables.map((table) => [table.name, table.rows, table.sha256]));
    }
  });

  it("2. the row-order rule: architecture_candidates (no primary key; 42 of the 143 tables have none) dumps the same rows inserted in two orders to equal digests; a keyed table is ordered by its key; values never pass through a JavaScript number", { timeout: 180_000 }, async () => {
    const { createLogicalDump } = await recovery();
    const rows = ["('c3','t','p','b','l',1,'d3','p1','s3','proposed','{\"n\":3}'::jsonb,'2026-10-08T00:00:03Z')", "('c1','t','p','b','l',1,'d1','p1','s1','proposed','{\"n\":1}'::jsonb,'2026-10-08T00:00:01Z')", "('c2','t','p','b','l',1,'d2','p1','s2','proposed','{\"n\":2}'::jsonb,'2026-10-08T00:00:02Z')"];
    const insert = (order: readonly number[]) => `INSERT INTO architecture_candidates (candidate_id, tenant_id, project_id, branch_id, lineage_id, revision, candidate_digest, problem_digest, structural_signature, status, candidate, created_at) VALUES ${order.map((index) => rows[index]).join(", ")}`;
    const first = await fresh();
    const second = await fresh();
    await first.exec(insert([0, 1, 2]));
    await second.exec(insert([2, 1, 0]));
    const [a, b] = [await createLogicalDump(first), await createLogicalDump(second)];
    const table = (dump: typeof a) => dump.tables.find((item) => item.name === "architecture_candidates")!;
    expect(table(a).order).toBe("row-text");
    expect(table(a).sha256).toBe(table(b).sha256);
    expect(table(a).data).toEqual(table(b).data);
    expect(a.tables.filter((item) => item.order === "row-text")).toHaveLength(42);
    expect(a.tables.filter((item) => item.order === "primary-key")).toHaveLength(101);
    // a 19-significant-digit numeric in the source's JSON survives as the database's own text, never rounded through a double
    const bom = (await createLogicalDump(source)).tables.find((item) => item.name === "bom_snapshots")!;
    expect(bom.order).toBe("primary-key");
    expect(bom.data[0]).toContain("0.0123456789012345678");
    expect(bom.data.every((row) => typeof row === "string")).toBe(true);
  });

  it("3. both aggregates load on the copy through their own verifying stores, with the same digests", { timeout: 180_000 }, async () => {
    const { createLogicalDump, restoreLogicalDump } = await recovery();
    const target = await fresh(false);
    await restoreLogicalDump(target, await createLogicalDump(source), { manifest: loadMigrationManifest() });
    orm = drizzle(source.db, { schema });
    const exchangeOnSource = createProviderExchangeLedger(new PostgresDurableWorkflowRepository());
    const [sourceExchange, sourceHistory] = [await exchangeOnSource.load(EXCHANGE), await exchangeOnSource.history(EXCHANGE)];
    const sourceEvidence = await createComputationEvidenceStore(new PostgresDurableWorkflowRepository()).load(EVIDENCE_SCOPE, "run_b24a4");
    orm = drizzle(target.db, { schema });
    const exchangeOnCopy = createProviderExchangeLedger(new PostgresDurableWorkflowRepository());
    expect(await exchangeOnCopy.load(EXCHANGE)).toEqual(sourceExchange);
    expect((await exchangeOnCopy.history(EXCHANGE)).map((record) => [record.revision, record.phase, record.recordDigest])).toEqual(sourceHistory.map((record) => [record.revision, record.phase, record.recordDigest]));
    expect(sourceHistory.map((record) => record.phase)).toEqual(["prepared", "sent", "settled"]);
    const copyEvidence = await createComputationEvidenceStore(new PostgresDurableWorkflowRepository()).load(EVIDENCE_SCOPE, "run_b24a4");
    expect(copyEvidence).toEqual(sourceEvidence);
    expect(copyEvidence?.recordDigest).toBe(sourceEvidence?.recordDigest);
    expect(copyEvidence?.documentDigest).toBe(sourceEvidence?.documentDigest);
    expect(await new PostgresProjectMembershipRepository().loadActiveMembership({ tenantId: TENANT, projectId: "proj-r", userId: U1 })).toMatchObject({ role: "editor", state: "active" });
    expect(await new PostgresProjectMembershipRepository().loadActiveMembership({ tenantId: TENANT, projectId: "proj-r", userId: U2 })).toBeNull();
  });

  it("4. the refusals: a target holding a row - claimed or not - before any write; a ledger not the manifest's, or one the target has passed, before any write; a tampered envelope before any write; a mismatch only the loaded rows show, rolled back", { timeout: 300_000 }, async () => {
    const { createLogicalDump, restoreLogicalDump } = await recovery();
    const manifest = loadMigrationManifest();
    const dump = await createLogicalDump(source);
    const state = async (db: DisposablePostgres) => ({ fingerprint: await fingerprintOf(db), ledger: await ledgerOf(db), rows: (await db.query<{ n: number }>("SELECT (SELECT count(*) FROM libraries)::int + (SELECT count(*) FROM project_members)::int AS n").catch(() => [{ n: -1 }]))[0]!.n });
    const refusedBeforeWrite = async (db: DisposablePostgres, candidate: typeof dump, code: string, detail?: RegExp) => {
      const before = await state(db);
      const refusal = await refusalOf(restoreLogicalDump(db, candidate, { manifest }));
      expect(refusal.code, code).toBe(code);
      expect(refusal.message.startsWith(`${code}: `)).toBe(true);
      if (detail) expect(refusal.message).toMatch(detail);
      expect(await state(db), code).toEqual(before);
      return refusal;
    };
    // a target holding one row, unclaimed and claimed: the claim marker is never a reason to accept a restore target
    const holding = await fresh();
    await holding.exec("INSERT INTO libraries (name, main_category) VALUES ('Device', 'Passives')");
    await refusedBeforeWrite(holding, dump, "DB_RESTORE_TARGET_NOT_EMPTY", /libraries: 1/);
    const claimed = await fresh();
    await requireDisposableQualificationTarget(claimed, "claimed-then-written");
    await claimed.exec("INSERT INTO libraries (name, main_category) VALUES ('Device', 'Passives')");
    const refusal = await refusedBeforeWrite(claimed, dump, "DB_RESTORE_TARGET_NOT_EMPTY", /libraries: 1/);
    expect(refusal.message).not.toContain("Device");
    // ledgers
    const bare = await fresh(false);
    await refusedBeforeWrite(bare, { ...dump, ledger: dump.ledger.map((row, index) => (index === 3 ? { ...row, checksum: `sha256:${"0".repeat(64)}` } : row)) }, "DB_RESTORE_SCHEMA_MISMATCH");
    await refusedBeforeWrite(bare, { ...dump, ledger: [...dump.ledger, { name: "9999_from_a_future_version", checksum: `sha256:${"0".repeat(64)}` }] }, "DB_RESTORE_SCHEMA_MISMATCH");
    const older = await fresh(31);
    const olderDump = await createLogicalDump(older);
    const passed = await fresh(true);
    await refusedBeforeWrite(passed, olderDump, "DB_RESTORE_SCHEMA_MISMATCH", /passed/);
    // a tampered envelope: a row changed without its digest, a count that disagrees, a schema version
    const members = dump.tables.findIndex((table) => table.name === "project_members");
    const tamper = (change: (table: (typeof dump.tables)[number]) => (typeof dump.tables)[number]) => ({ ...dump, tables: dump.tables.map((table, index) => (index === members ? change(table) : table)) });
    await refusedBeforeWrite(bare, tamper((table) => ({ ...table, data: table.data.map((row) => row.replace('"editor"', '"admin"')) })), "DB_RESTORE_DIGEST_MISMATCH", /project_members/);
    await refusedBeforeWrite(bare, tamper((table) => ({ ...table, rows: table.rows + 1 })), "DB_RESTORE_DIGEST_MISMATCH");
    await refusedBeforeWrite(bare, { ...dump, schema: "sirkit.db-logical-dump.v0" as never }, "DB_RESTORE_SCHEMA_MISMATCH");
    expect(await ledgerOf(bare)).toEqual([]); // nothing was migrated: every refusal above came before any write
    // a mismatch only the loaded rows show: an equivalent but differently spaced row text, its digest recomputed to match
    const { createHash } = await import("node:crypto");
    const respaced = tamper((table) => {
      const data = table.data.map((row) => row.replace('"role":"editor"', '"role": "editor"'));
      return { ...table, data, sha256: createHash("sha256").update(data.map((row) => `${row}\n`).join("")).digest("hex") };
    });
    expect(respaced.tables[members]!.data.join("")).toContain('"role": "editor"');
    const loaded = await fresh(false);
    const late = await refusalOf(restoreLogicalDump(loaded, respaced, { manifest }));
    expect(late.code).toBe("DB_RESTORE_DIGEST_MISMATCH");
    expect(late.message).toMatch(/project_members/);
    const rowsAfter = await (await import("../../../db/qualification-target")).publicTablesHoldingRows(loaded);
    expect(rowsAfter).toEqual([]); // rolled back: the target holds the migrated schema and no row
  });
});

/** A fault-injecting double over PGlite (the B23 PGlite suite's `db/client` mock, with the connection lost). */
type Fault = { failAll: boolean; failTxAfter: number | null };
const lost = (): Error => Object.assign(new Error("connection lost (injected): the server closed the connection unexpectedly"), { code: "CONNECTION_CLOSED" });
/** The injected loss, anywhere in an error's cause chain (drizzle wraps a failed query in a DrizzleQueryError whose cause it is). */
function connectionLost(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current: unknown = error; current !== null && typeof current === "object" && !seen.has(current); current = (current as { cause?: unknown }).cause) {
    seen.add(current);
    if ((current as { code?: unknown }).code === "CONNECTION_CLOSED") return true;
  }
  return false;
}
const rejection = (promise: Promise<unknown>): Promise<unknown> => promise.then(() => null, (error: unknown) => error);
function faultyOrm(db: DisposablePostgres, fault: Fault) {
  const client = {
    query: async (...args: Parameters<PGlite["query"]>) => {
      if (fault.failAll) throw lost();
      return db.db.query(...args);
    },
    transaction: async <T,>(fn: (tx: Transaction) => Promise<T>): Promise<T> => {
      if (fault.failAll) throw lost();
      return db.db.transaction(async (tx) => {
        let statements = 0;
        const wrapped = new Proxy(tx, {
          get(target, property, receiver) {
            if (property === "query") {
              return async (...args: Parameters<Transaction["query"]>) => {
                statements += 1;
                if (fault.failTxAfter !== null && statements > fault.failTxAfter) { fault.failTxAfter = null; throw lost(); }
                return target.query(...args);
              };
            }
            const value = Reflect.get(target, property, receiver) as unknown;
            return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          },
        });
        return fn(wrapped);
      });
    },
  };
  return drizzle({ client: client as unknown as PGlite, schema });
}

describe("[B24-A4] a lost connection fails closed (D24-7, D24-3)", () => {
  it("5a. with the PostgreSQL membership repository bound and every query failing, the trusted context never resolves and no handler runs: the request rejects, so no Sirkit body is built (the framework answers 500, INFERRED)", { timeout: 60_000 }, async () => {
    orm = faultyOrm(source, { failAll: true, failTxAfter: null });
    injectIdentity({ userId: U1 });
    injectMembershipRepository(new PostgresProjectMembershipRepository());
    const request = () => new Request("http://localhost/api/pcb-sync", { headers: { "x-sirkit-tenant-id": TENANT, "x-sirkit-project-id": "proj-r" } });
    // observed on the unedited code (recorded on database-and-recovery.md): the read rejects with drizzle's DrizzleQueryError, whose
    // cause is the lost connection - no context, no refusal Response, nothing for a handler
    expect(connectionLost(await rejection(resolveTrustedRequestContext(request())))).toBe(true);
    let handled = 0;
    const route = authenticatedRoute(undefined, async () => { handled += 1; return Response.json({ ok: true }); });
    const answer = await route(request()).then((response) => ({ settled: "response" as const, status: response.status, lost: false, message: "" }), (error: unknown) => ({ settled: "rejected" as const, status: 0, lost: connectionLost(error), message: (error as Error).message }));
    expect(answer).toMatchObject({ settled: "rejected", status: 0, lost: true });
    expect(handled).toBe(0);
    // the rejection's own text is drizzle's: the query and its parameters (ids) - never a URL or a credential; it reaches the server
    // log, and no Sirkit body carries it (Next answers an uncaught route error with its own 500, INFERRED)
    expect(answer.message).toMatch(/^Failed query: select "membership_id"/);
    expect(answer.message).not.toMatch(/postgres(?:ql)?:\/\/|password/i);
    // the same repository over a healthy connection answers the active membership (the case is not vacuous)
    orm = drizzle(source.db, { schema });
    const healthy = await resolveTrustedRequestContext(request());
    expect(healthy.ok).toBe(true);
  });

  it("5b. an exchange prepare and an evidence append that lose the connection after their first statement leave no head, record or replay row; each retried append writes exactly once", { timeout: 120_000 }, async () => {
    const counts = async (where: string) => (await source.query<{ records: number; heads: number; replays: number }>(`SELECT (SELECT count(*)::int FROM durable_workflow_records WHERE ${where}) AS records, (SELECT count(*)::int FROM durable_workflow_heads WHERE ${where}) AS heads, (SELECT count(*)::int FROM durable_workflow_replays WHERE ${where.replace(/aggregate_type = '[^']+' AND /, "")}) AS replays`))[0]!;
    // the exchange record's prepare
    const aggregate: ExchangeAggregate = { scope: { tenantId: "tenant-b24a4-lost", projectId: "proj-lost", branchId: "main" }, designId: "design:proj-lost", boardId: "board:proj-lost-1", providerId: "jlcpcb" };
    const where = `aggregate_type = 'mfg.provider-exchange.v1' AND tenant_id = 'tenant-b24a4-lost'`;
    const prepare = () => createProviderExchangeLedger(new PostgresDurableWorkflowRepository()).prepare({ aggregate, attempt: exchangeAttemptInput({ plan: PLAN("lost-key"), key: "lost-key", actorId: "u-b24-admin", descriptor: fakeDescriptor(), capabilityProfile: { profileId: "jlcpcb-2l", version: 2 } }), at: AT });
    orm = faultyOrm(source, { failAll: false, failTxAfter: 1 });
    expect(connectionLost(await rejection(prepare()))).toBe(true);
    orm = drizzle(source.db, { schema });
    expect(await counts(where)).toEqual({ records: 0, heads: 0, replays: 0 });
    expect(await prepare()).toMatchObject({ ok: true, replayed: false });
    expect(await prepare()).toMatchObject({ ok: true, replayed: true });
    expect(await counts(where)).toEqual({ records: 1, heads: 1, replays: 1 });
    expect((await source.query<{ aggregate_key: string }>(`SELECT aggregate_key FROM durable_workflow_heads WHERE ${where}`))[0]!.aggregate_key).toBe(exchangeAggregateKey(aggregate));
    // the evidence append
    const scope = { tenantId: "tenant-b24a4-lost-evidence", projectId: "proj-lost", branchId: "main" };
    const evidenceWhere = `aggregate_type = 'computation.evidence.v1' AND tenant_id = 'tenant-b24a4-lost-evidence'`;
    const append = () => createComputationEvidenceStore(new PostgresDurableWorkflowRepository()).append({ scope, evidenceId: "run_lost", expectedRevision: 0, document: evidenceDocument("run_lost"), at: AT });
    orm = faultyOrm(source, { failAll: false, failTxAfter: 1 });
    expect(connectionLost(await rejection(append()))).toBe(true);
    orm = drizzle(source.db, { schema });
    expect(await counts(evidenceWhere)).toEqual({ records: 0, heads: 0, replays: 0 });
    expect(await append()).toMatchObject({ ok: true, revision: 1, replayed: false });
    expect(await append()).toMatchObject({ ok: true, revision: 1, replayed: true });
    expect(await counts(evidenceWhere)).toEqual({ records: 1, heads: 1, replays: 1 });
  });
});

describe("[B24-A4 review, 2026-10-08] a dump that row security would empty is refused (D24-7)", () => {
  it("6. a dump as a role row security may hide rows from is refused DB_DUMP_ROWS_HIDDEN before it reads a row - a SELECT-only role without BYPASSRLS after 0031, and an owner of every table without BYPASSRLS whose table is FORCEd - and the restore refuses that owner as a target", { timeout: 240_000 }, async () => {
    const { createLogicalDump, restoreLogicalDump } = await recovery();
    const outcome = (promise: Promise<LogicalDump>) => promise.then((dump) => ({ code: "dumped", ledger: dump.ledger.length, tables: dump.tables.length, rows: dump.tables.reduce((sum, table) => sum + table.rows, 0), message: "" }), (error: { code?: string; message: string }) => ({ code: error.code ?? "thrown", ledger: -1, tables: -1, rows: -1, message: error.message }));
    // the runbook's least privilege: a backup role that may SELECT every table and nothing else
    const db = await fresh();
    await db.exec("INSERT INTO libraries (name, main_category) VALUES ('Device', 'Passives'); CREATE ROLE sirkit_test_backup NOLOGIN NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO sirkit_test_backup; GRANT SELECT ON ALL TABLES IN SCHEMA public TO sirkit_test_backup;");
    expect(await outcome(createLogicalDump(db))).toMatchObject({ code: "dumped", ledger: 32, tables: 143, rows: 1 }); // the superuser reads everything
    await db.exec("SET ROLE sirkit_test_backup");
    try {
      const refused = await outcome(createLogicalDump(db));
      expect(refused, JSON.stringify(refused)).toMatchObject({ code: "DB_DUMP_ROWS_HIDDEN" });
      expect(refused.message).toMatch(/^DB_DUMP_ROWS_HIDDEN: /);
      expect(refused.message).not.toContain("Device");
    } finally {
      await db.exec("RESET ROLE");
    }
    // an owner of every public table, the ledger included, without BYPASSRLS, with one table FORCEd
    const dump = await createLogicalDump(source);
    const forced = await fresh();
    await forced.exec("INSERT INTO libraries (name, main_category) VALUES ('Device', 'Passives'); ALTER TABLE libraries FORCE ROW LEVEL SECURITY;");
    const tables = (await forced.query<{ relname: string }>("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'")).map((row) => row.relname);
    await forced.exec(`CREATE ROLE sirkit_test_owner NOLOGIN NOSUPERUSER NOBYPASSRLS; ${tables.map((table) => `ALTER TABLE "${table}" OWNER TO sirkit_test_owner;`).join(" ")}`);
    await forced.exec("SET ROLE sirkit_test_owner");
    try {
      const owner = await outcome(createLogicalDump(forced));
      expect(owner, JSON.stringify(owner)).toMatchObject({ code: "DB_DUMP_ROWS_HIDDEN" });
      const restore = await refusalOf(restoreLogicalDump(forced, dump, { manifest: loadMigrationManifest() }));
      expect(restore.code).toBe("DB_RESTORE_TARGET_NOT_EMPTY");
      expect(restore.message).toMatch(/row security/);
    } finally {
      await forced.exec("RESET ROLE");
    }
    expect((await forced.query<{ n: number }>("SELECT count(*)::int AS n FROM libraries"))[0]!.n).toBe(1); // nothing was written
  });
});
