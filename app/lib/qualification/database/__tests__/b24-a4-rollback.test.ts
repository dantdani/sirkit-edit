/**
 * [B24-A4] Supported rollback (D24-2 offline, OD-193), proven on PGlite only - a real-server rollback is BLOCKED-LIVE-QUALIFICATION
 * (LB-14).
 *
 *  1. the rollback manifest: each binding matches its forward checksum (0027-0030 pinned literally at their 3cd7d6e values, so the
 *     forward files stay byte-identical) and its DOWN file's own checksum; the classes are 0031 lossless, 0027-0030 requires
 *     empty, 0000-0026 forward-only; the migration manifest ignores drizzle/rollback/ (32 entries, none from it);
 *  2. apply all, roll back 0031, re-apply: after the rollback the fingerprint equals a fresh database migrated through 0030 and the
 *     emulated Data API role reads the seeded row again (the D24-3 counterexample state, on purpose); after the re-apply it is the
 *     clean fingerprint and the role reads nothing;
 *  3. roll back 0031 through 0027 newest-first: the result equals the 0000-0026 fingerprint, and re-applying reaches the clean one;
 *  4. every refusal - the runner's own drift, unknown-row and gap refusals, not the newest, forward-only, a binding mismatch, data
 *     present, no typed confirmation - leaves the ledger and the fingerprint byte-identical; each "requires empty" check meets a
 *     row that matches it (a withdrawal event, a stored MPN, an owned BOM snapshot, an owned BOM notification, a membership) and,
 *     where a row may stay, one that does not (a NULL MPN, an unowned notification) [B24-A4 review, 2026-10-08];
 *  5. an interruption in the middle of a DOWN leaves no change; the re-run completes; the DOWN runs under the runner's advisory
 *     lock, read from pg_locks [B24-A4 review, 2026-10-08];
 *  6. a dry run plans only and needs no confirmation;
 *  7. the argument parser, imported from cli-arguments.ts only (never scripts/db-migrate.ts, which runs when imported): the
 *     legitimate inputs of the forward CLI parse as before; --rollback needs a name; --rollback with --baseline (or --status)
 *     refuses; --confirm is only for --rollback; an unknown flag refuses; the CLI wires the parser and the rollback in place.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMigrationManifest, migrationChecksum, truncateManifest, MIGRATION_LEDGER_TABLE } from "../../../db/migrations/manifest";
import { migrateDatabase, type MigrationLedgerRow, type MigrationStatementRunner } from "../../../db/migrations/runner";
import { captureSchemaSnapshot, schemaFingerprint } from "../../../db/migrations/verify-schema";
import { disposablePostgres, type DisposablePostgres } from "../../../db/disposable-postgres";
import { DATA_API_GRANT_EMULATION_SQL, rowsSeenAs } from "./_b24-a4-data-api";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const rollback = () => import("../../../db/migrations/rollback");
const cli = () => import("../../../db/migrations/cli-arguments");

/** The forward files' checksums at 3cd7d6e: the bindings must name these, and the files must still hash to them. */
const FORWARD_AT_BASE: Readonly<Record<string, string>> = {
  "0027_project_membership": "sha256:100ddbd9375b4b45c64d77fc4d78dad895f08a705e7fb044c28424d1305ce0c0",
  "0028_bom_project_ownership": "sha256:ad91424b7f15455aed1db37424672abadd83a201f36e268b0c47f39d8b89cc60",
  "0029_part_offers_mpn": "sha256:47f67966e79cef50c836c8b1276b4816ba914f257b64409ffd298be6138857db",
  "0030_atomic_revision_status_events": "sha256:be4b577b801f3786e659acf7eb7075d37703651457da0b0963917bc5dcbd7aaa",
};
const NEWEST_FIRST = ["0031_rls_default_deny", "0030_atomic_revision_status_events", "0029_part_offers_mpn", "0028_bom_project_ownership", "0027_project_membership"] as const;

const open: DisposablePostgres[] = [];
async function migrated(count?: number): Promise<DisposablePostgres> {
  const db = await disposablePostgres();
  open.push(db);
  const manifest = loadMigrationManifest();
  await migrateDatabase(db, { manifest: count === undefined ? manifest : truncateManifest(manifest, count) });
  return db;
}
afterEach(async () => { for (const db of open.splice(0)) await db.close(); });
const fingerprint = async (db: DisposablePostgres): Promise<string> => schemaFingerprint(await captureSchemaSnapshot(db));
const ledger = async (db: DisposablePostgres): Promise<MigrationLedgerRow[]> => db.query<MigrationLedgerRow>(`SELECT name, checksum, applied_at::text AS applied_at, statement_count, runner_version FROM "${MIGRATION_LEDGER_TABLE}" ORDER BY name`);
/** [B24-A4 review] Whether THIS backend holds the transaction-scoped advisory lock `hashtext(key)`: pg_locks shows a bigint key as
 *  classid (its high 32 bits) and objid (its low 32), objsubid 1. */
const advisoryLockHeld = async (runner: MigrationStatementRunner, key: string): Promise<boolean> =>
  (await runner.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid = pg_backend_pid() AND objsubid = 1 AND classid = ((hashtext($1)::bigint >> 32) & 4294967295)::oid AND objid = (hashtext($1)::bigint & 4294967295)::oid", [key]))[0]!.n === 1;
async function refusalOf(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code: string; message: string };
  }
  throw new Error("expected a refusal");
}

describe("[B24-A4] the rollback manifest (OD-193)", () => {
  it("1. each binding matches its forward checksum (0027-0030 pinned at 3cd7d6e) and its DOWN file's own; 0031 lossless, 0027-0030 requires empty, 0000-0026 forward-only; the manifest ignores drizzle/rollback/", { timeout: 60_000 }, async () => {
    const { ROLLBACK_BINDINGS, rollbackClassOf } = await rollback();
    const manifest = loadMigrationManifest();
    expect(manifest.entries).toHaveLength(32);
    expect(manifest.entries.some((entry) => entry.path.includes("rollback"))).toBe(false);
    expect(ROLLBACK_BINDINGS.map((binding) => binding.name)).toEqual([...NEWEST_FIRST]);
    for (const binding of ROLLBACK_BINDINGS) {
      const entry = manifest.entries.find((candidate) => candidate.name === binding.name)!;
      expect(binding.forwardChecksum, binding.name).toBe(entry.checksum);
      if (binding.name in FORWARD_AT_BASE) expect(entry.checksum, `${binding.name} is byte-identical to 3cd7d6e`).toBe(FORWARD_AT_BASE[binding.name]);
      expect(binding.down).toBe(`${binding.name}.down.sql`);
      expect(migrationChecksum(read(`drizzle/rollback/${binding.down}`)), binding.down).toBe(binding.downChecksum);
      expect(binding.class).toBe(binding.name === "0031_rls_default_deny" ? "lossless" : "requires-empty");
      expect(binding.emptyChecks.length, binding.name).toBe(binding.class === "lossless" ? 0 : binding.name === "0028_bom_project_ownership" ? 2 : 1);
    }
    expect(manifest.entries.slice(0, 27).map((entry) => rollbackClassOf(entry.name))).toEqual(Array(27).fill("forward-only"));
    expect(NEWEST_FIRST.map((name) => rollbackClassOf(name))).toEqual(["lossless", "requires-empty", "requires-empty", "requires-empty", "requires-empty"]);
    // the commented DOWN sections of 0027 and 0028 are what their DOWN files run, uncommented and unchanged
    expect(read("drizzle/rollback/0027_project_membership.down.sql")).toContain(read("drizzle/0027_project_membership.sql").split(NEWLINE).slice(57, 62).map((line) => line.slice(3)).join(`${NEWLINE}--> statement-breakpoint${NEWLINE}`));
    expect(read("drizzle/rollback/0028_bom_project_ownership.down.sql")).toContain(read("drizzle/0028_bom_project_ownership.sql").split(NEWLINE).slice(62, 72).map((line) => line.slice(3)).join(`${NEWLINE}--> statement-breakpoint${NEWLINE}`));
  });
});

describe("[B24-A4] rollback on PGlite (rollbackNewestMigration)", () => {
  it("2. counterexample (red on 3cd7d6e: no rollback path): apply all, roll back 0031, re-apply - through 0030's fingerprint (the emulated role reads again) and back to the clean one (it reads nothing)", { timeout: 180_000 }, async () => {
    const { rollbackNewestMigration, ROLLBACK_CONFIRMATION } = await rollback();
    const manifest = loadMigrationManifest();
    const clean = await fingerprint(await migrated());
    const through0030 = await fingerprint(await migrated(31));
    const db = await migrated();
    await db.exec(DATA_API_GRANT_EMULATION_SQL);
    await db.exec("INSERT INTO bom_snapshots (project_key, snapshot_data, bom_meta) VALUES ('k', '[]'::jsonb, '{}'::jsonb)");
    expect(await rowsSeenAs(db, "anon", "bom_snapshots")).toBe(0);
    const result = await rollbackNewestMigration(db, { manifest, name: "0031_rls_default_deny", confirmation: ROLLBACK_CONFIRMATION });
    expect(result).toMatchObject({ name: "0031_rls_default_deny", class: "lossless", statements: 143, dryRun: false });
    expect(result.ledger.map((row) => row.name)).toEqual(manifest.entries.slice(0, 31).map((entry) => entry.name));
    expect(await fingerprint(db)).toBe(through0030);
    expect((await ledger(db)).map((row) => row.name)).toEqual(manifest.entries.slice(0, 31).map((entry) => entry.name));
    expect(await rowsSeenAs(db, "anon", "bom_snapshots")).toBe(1);
    expect((await db.query<{ relrowsecurity: boolean }>(`SELECT relrowsecurity FROM pg_class WHERE relname = '${MIGRATION_LEDGER_TABLE}'`))[0]!.relrowsecurity).toBe(false);
    const again = await migrateDatabase(db, { manifest });
    expect(again.applied).toEqual(["0031_rls_default_deny"]);
    expect(await fingerprint(db)).toBe(clean);
    expect(await rowsSeenAs(db, "anon", "bom_snapshots")).toBe(0);
  });

  it("3. roll back 0031 through 0027 newest-first: the 0000-0026 fingerprint; re-applying reaches the clean fingerprint", { timeout: 180_000 }, async () => {
    const { rollbackNewestMigration, ROLLBACK_CONFIRMATION } = await rollback();
    const manifest = loadMigrationManifest();
    const clean = await fingerprint(await migrated());
    const through0026 = await fingerprint(await migrated(27));
    const db = await migrated();
    for (const name of NEWEST_FIRST) await rollbackNewestMigration(db, { manifest, name, confirmation: ROLLBACK_CONFIRMATION });
    expect(await fingerprint(db)).toBe(through0026);
    expect((await ledger(db)).map((row) => row.name)).toEqual(manifest.entries.slice(0, 27).map((entry) => entry.name));
    const again = await migrateDatabase(db, { manifest });
    expect(again.applied).toEqual([...NEWEST_FIRST].reverse());
    expect(await fingerprint(db)).toBe(clean);
  });

  it("4. every refusal leaves the ledger and the fingerprint byte-identical: drift, an unknown row, a gap, not the newest, forward-only, a binding mismatch, data present, no typed confirmation", { timeout: 300_000 }, async () => {
    const { rollbackNewestMigration, ROLLBACK_BINDINGS, ROLLBACK_CONFIRMATION } = await rollback();
    const manifest = loadMigrationManifest();
    const unchanged = async (db: DisposablePostgres, attempt: () => Promise<unknown>, code: string, detail?: RegExp): Promise<{ code: string; message: string }> => {
      const [rows, print] = [await ledger(db), await fingerprint(db)];
      const refusal = await refusalOf(attempt());
      expect(refusal.code, code).toBe(code);
      expect(refusal.message.startsWith(`${code}: `), refusal.message).toBe(true);
      if (detail) expect(refusal.message).toMatch(detail);
      expect(await ledger(db), code).toEqual(rows);
      expect(await fingerprint(db), code).toBe(print);
      return refusal;
    };
    const db = await migrated();
    const go = (name: string, extra: Record<string, unknown> = {}) => rollbackNewestMigration(db, { manifest, name, confirmation: ROLLBACK_CONFIRMATION, ...extra });
    await unchanged(db, () => go("0030_atomic_revision_status_events"), "DB_ROLLBACK_NOT_NEWEST", /newest applied: 0031_rls_default_deny/);
    await unchanged(db, () => go("9999_unknown"), "DB_ROLLBACK_NOT_NEWEST");
    await unchanged(db, () => go("0031_rls_default_deny", { confirmation: "yes" }), "DB_ROLLBACK_CONFIRMATION_REQUIRED");
    await unchanged(db, () => go("0031_rls_default_deny", { confirmation: null }), "DB_ROLLBACK_CONFIRMATION_REQUIRED");
    const tampered = ROLLBACK_BINDINGS.map((binding) => (binding.name === "0031_rls_default_deny" ? { ...binding, forwardChecksum: `sha256:${"0".repeat(64)}` } : binding));
    await unchanged(db, () => go("0031_rls_default_deny", { bindings: tampered }), "DB_ROLLBACK_BINDING_MISMATCH");
    await unchanged(db, () => go("0031_rls_default_deny", { readDown: (file: string) => `${read(`drizzle/rollback/${file}`)}-- edited after review${NEWLINE}` }), "DB_ROLLBACK_BINDING_MISMATCH");
    await unchanged(db, () => go("0031_rls_default_deny", { readDown: () => null }), "DB_ROLLBACK_BINDING_MISMATCH");
    // the runner's own refusals, inside the lock
    await db.query(`UPDATE "${MIGRATION_LEDGER_TABLE}" SET checksum = $1 WHERE name = $2`, [`sha256:${"1".repeat(64)}`, "0005_nice_meteorite"]);
    await unchanged(db, () => go("0031_rls_default_deny"), "DB_MIGRATION_CHECKSUM_DRIFT");
    await db.query(`UPDATE "${MIGRATION_LEDGER_TABLE}" SET checksum = $1 WHERE name = $2`, [manifest.entries[5]!.checksum, "0005_nice_meteorite"]);
    await db.query(`INSERT INTO "${MIGRATION_LEDGER_TABLE}" (name, checksum, statement_count, runner_version) VALUES ($1, $2, 1, 'x')`, ["9999_from_a_future_version", `sha256:${"0".repeat(64)}`]);
    await unchanged(db, () => go("0031_rls_default_deny"), "DB_MIGRATION_LEDGER_UNKNOWN");
    await db.query(`DELETE FROM "${MIGRATION_LEDGER_TABLE}" WHERE name = $1`, ["9999_from_a_future_version"]);
    const second = await db.query<MigrationLedgerRow>(`SELECT name, checksum, applied_at::text AS applied_at, statement_count, runner_version FROM "${MIGRATION_LEDGER_TABLE}" WHERE name = $1`, [manifest.entries[2]!.name]);
    await db.query(`DELETE FROM "${MIGRATION_LEDGER_TABLE}" WHERE name = $1`, [manifest.entries[2]!.name]);
    await unchanged(db, () => go("0031_rls_default_deny"), "DB_MIGRATION_LEDGER_GAP");
    await db.query(`INSERT INTO "${MIGRATION_LEDGER_TABLE}" (name, checksum, applied_at, statement_count, runner_version) VALUES ($1, $2, $3, $4, $5)`, [second[0]!.name, second[0]!.checksum, second[0]!.applied_at, second[0]!.statement_count, second[0]!.runner_version]);
    // data present, each binding's own check run against a row that matches it and, where a row may stay, one that does not
    // ([B24-A4 review, 2026-10-08] 0030's, 0029's and bom_notifications' checks had never met a matching row): 0030 with a withdrawal
    // event, 0029 with a stored exact MPN (a NULL one does not block), 0028 with an owned BOM snapshot and then an owned BOM
    // notification (an unowned one does not block), 0027 with a membership; forward-only below 0027
    await go("0031_rls_default_deny");
    // the event's revision and audit parents play no part in 0030's check, so the row goes in with the foreign keys off: a session
    // setting of this superuser session only, reset at once - nothing in the schema changes
    await db.exec("SET session_replication_role = replica; INSERT INTO atomic_revision_status_events (id, revision_id, to_state, actor_id, actor_role, reason, at, audit_event_id) VALUES ('event-b24a4', 'revision-b24a4', 'revoked', 'publisher-b24a4', 'admin', 'withdrawn', now(), 'audit-b24a4'); RESET session_replication_role;");
    await unchanged(db, () => go("0030_atomic_revision_status_events"), "DB_ROLLBACK_DATA_PRESENT", /atomic_revision_status_events: 1 row/);
    await db.exec("DELETE FROM atomic_revision_status_events WHERE id = 'event-b24a4'");
    await go("0030_atomic_revision_status_events");
    await db.exec("WITH l AS (INSERT INTO libraries (name, main_category) VALUES ('Device', 'Passives') RETURNING id), p AS (INSERT INTO parts (library_id, name, properties, pins, symbol_raw) SELECT id, 'R1', '{}'::jsonb, '[]'::jsonb, '' FROM l RETURNING id) INSERT INTO part_offers (part_id, distributor, mpn) SELECT id, 'distributor-b24a4', 'MPN-B24A4-0603' FROM p");
    const mpn = await unchanged(db, () => go("0029_part_offers_mpn"), "DB_ROLLBACK_DATA_PRESENT", /part_offers: 1 row/);
    expect(mpn.message).not.toContain("MPN-B24A4-0603");
    await db.exec("UPDATE part_offers SET mpn = NULL WHERE distributor = 'distributor-b24a4'");
    await go("0029_part_offers_mpn"); // the offer stays: a NULL mpn does not block, the DOWN drops a column holding only NULLs
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM part_offers"))[0]!.n).toBe(1);
    await db.exec("INSERT INTO bom_snapshots (project_key, snapshot_data, bom_meta, tenant_id, project_id, branch_id) VALUES ('k', '[]'::jsonb, '{}'::jsonb, 't', 'p', 'b')");
    await unchanged(db, () => go("0028_bom_project_ownership"), "DB_ROLLBACK_DATA_PRESENT", /bom_snapshots: 1 row/);
    await db.exec("DELETE FROM bom_snapshots WHERE tenant_id = 't'");
    await db.exec("INSERT INTO bom_notifications (project_key, type, severity, summary, tenant_id, project_id, branch_id) VALUES ('k', 'price', 'info', 'summary-b24a4', 't', 'p', 'b')");
    await unchanged(db, () => go("0028_bom_project_ownership"), "DB_ROLLBACK_DATA_PRESENT", /bom_notifications: 1 row/);
    await db.exec("UPDATE bom_notifications SET tenant_id = NULL, project_id = NULL, branch_id = NULL WHERE summary = 'summary-b24a4'");
    await go("0028_bom_project_ownership"); // the notification stays: an unowned one does not block
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM bom_notifications"))[0]!.n).toBe(1);
    await db.exec("INSERT INTO project_members VALUES ('m1','t','p','11111111-1111-1111-1111-111111111111','admin','active',1,now(),now(),'operator')");
    await unchanged(db, () => go("0027_project_membership"), "DB_ROLLBACK_DATA_PRESENT", /project_members: 1 row/);
    await db.exec("DELETE FROM project_members WHERE membership_id = 'm1'");
    await go("0027_project_membership");
    await unchanged(db, () => go("0026_parts_atomic_links"), "DB_ROLLBACK_FORWARD_ONLY", /restore/);
    const refusal = await refusalOf(go("0026_parts_atomic_links"));
    expect(refusal.message).not.toMatch(/'t'|11111111/);
  });

  it("5. an interruption in the middle of a DOWN leaves no change (DOWN statements and the ledger row in one transaction); the re-run completes", { timeout: 120_000 }, async () => {
    const { rollbackNewestMigration, ROLLBACK_CONFIRMATION } = await rollback();
    const manifest = loadMigrationManifest();
    const db = await migrated();
    const [rows, print] = [await ledger(db), await fingerprint(db)];
    const secured = async () => (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity"))[0]!.n;
    expect(await secured()).toBe(144);
    // [B24-A4 review, 2026-10-08] the DOWN runs under the runner's own advisory lock (pg_locks, this backend): the probe tells one key
    // from another inside a transaction, and the lock is gone once the rollback's transaction has ended
    await db.transaction(async (tx) => {
      await tx.exec("SELECT pg_advisory_xact_lock(hashtext('b24a4-control'))");
      expect(await advisoryLockHeld(tx, "b24a4-control")).toBe(true);
      expect(await advisoryLockHeld(tx, MIGRATION_LEDGER_TABLE)).toBe(false);
    });
    const held: boolean[] = [];
    const interrupted = rollbackNewestMigration(db, { manifest, name: "0031_rls_default_deny", confirmation: ROLLBACK_CONFIRMATION, beforeStatement: async (_binding: unknown, index: number, tx: MigrationStatementRunner) => { if (index === 0) held.push(await advisoryLockHeld(tx, MIGRATION_LEDGER_TABLE)); if (index === 70) throw new Error("ECONNRESET simulated outage"); } });
    await expect(interrupted).rejects.toThrow(/ECONNRESET/);
    expect(held).toEqual([true]);
    expect(await advisoryLockHeld(db, MIGRATION_LEDGER_TABLE)).toBe(false);
    expect(await ledger(db)).toEqual(rows);
    expect(await fingerprint(db)).toBe(print);
    expect(await secured()).toBe(144);
    await rollbackNewestMigration(db, { manifest, name: "0031_rls_default_deny", confirmation: ROLLBACK_CONFIRMATION });
    expect(await secured()).toBe(1);
  });

  it("6. a dry run plans only - the class, the statement count, the ledger it would leave - needs no confirmation, and changes nothing", { timeout: 120_000 }, async () => {
    const { rollbackNewestMigration } = await rollback();
    const manifest = loadMigrationManifest();
    const db = await migrated();
    const [rows, print] = [await ledger(db), await fingerprint(db)];
    const plan = await rollbackNewestMigration(db, { manifest, name: "0031_rls_default_deny", confirmation: null, dryRun: true });
    expect(plan).toMatchObject({ name: "0031_rls_default_deny", class: "lossless", statements: 143, dryRun: true });
    expect(plan.ledger.map((row) => row.name)).toEqual(manifest.entries.slice(0, 31).map((entry) => entry.name));
    expect(await ledger(db)).toEqual(rows);
    expect(await fingerprint(db)).toBe(print);
  });
});

describe("[B24-A4] the CLI arguments (cli-arguments.ts; the script is never imported)", () => {
  it("7. the forward CLI's legitimate inputs parse as before; --rollback needs a name and takes --confirm and --dry-run; --rollback with --baseline or --status refuses; --confirm alone refuses; an unknown flag refuses; db-migrate.ts wires the parser and the rollback", { timeout: 60_000 }, async () => {
    const { parseMigrateArguments } = await cli();
    const ok = (argv: string[]) => { const parsed = parseMigrateArguments(argv); if (!parsed.ok) throw new Error(parsed.message); return parsed.command; };
    const refused = (argv: string[]) => { const parsed = parseMigrateArguments(argv); return parsed.ok ? "ok" : parsed.code; };
    expect(ok([])).toEqual({ mode: "apply", dryRun: false });
    expect(ok(["--"])).toEqual({ mode: "apply", dryRun: false });
    expect(ok(["--dry-run"])).toEqual({ mode: "apply", dryRun: true });
    expect(ok(["--status"])).toEqual({ mode: "status" });
    expect(ok(["--baseline", "0026_parts_atomic_links"])).toEqual({ mode: "baseline", through: "0026_parts_atomic_links" });
    expect(ok(["--rollback", "0031_rls_default_deny", "--confirm", "roll_back_newest_migration"])).toEqual({ mode: "rollback", name: "0031_rls_default_deny", confirmation: "roll_back_newest_migration", dryRun: false });
    expect(ok(["--", "--rollback", "0031_rls_default_deny", "--dry-run"])).toEqual({ mode: "rollback", name: "0031_rls_default_deny", confirmation: null, dryRun: true });
    expect(refused(["--baseline"])).toBe("DB_MIGRATE_ARGUMENT_MISSING");
    expect(refused(["--baseline", "--status"])).toBe("DB_MIGRATE_ARGUMENT_MISSING");
    expect(refused(["--rollback"])).toBe("DB_MIGRATE_ARGUMENT_MISSING");
    expect(refused(["--rollback", "--confirm", "x"])).toBe("DB_MIGRATE_ARGUMENT_MISSING");
    expect(refused(["--rollback", "0031_rls_default_deny", "--confirm"])).toBe("DB_MIGRATE_ARGUMENT_MISSING");
    expect(refused(["--rollback", "0031_rls_default_deny", "--baseline", "0026_parts_atomic_links"])).toBe("DB_MIGRATE_ARGUMENTS_CONFLICT");
    expect(refused(["--baseline", "0026_parts_atomic_links", "--rollback", "0031_rls_default_deny"])).toBe("DB_MIGRATE_ARGUMENTS_CONFLICT");
    expect(refused(["--rollback", "0031_rls_default_deny", "--status"])).toBe("DB_MIGRATE_ARGUMENTS_CONFLICT");
    expect(refused(["--rollback", "a", "--rollback", "b"])).toBe("DB_MIGRATE_ARGUMENTS_CONFLICT");
    expect(refused(["--confirm", "roll_back_newest_migration"])).toBe("DB_MIGRATE_ARGUMENTS_CONFLICT");
    expect(refused(["--force"])).toBe("DB_MIGRATE_ARGUMENT_UNKNOWN");
    expect(refused(["0031_rls_default_deny"])).toBe("DB_MIGRATE_ARGUMENT_UNKNOWN");
    const { ROLLBACK_CONFIRMATION } = await rollback();
    expect(ROLLBACK_CONFIRMATION).toBe("roll_back_newest_migration");
    // the script: the parser and the rollback wired in place; the confirmation is the operator's (never passed by the script itself,
    // unlike --baseline's, db-migrate.ts:79 at 3cd7d6e); arguments are parsed before .env.local is loaded or anything connects
    const script = read("scripts/db-migrate.ts");
    expect(script).toMatch(/import \{ parseMigrateArguments \} from "\.\.\/app\/lib\/db\/migrations\/cli-arguments";/);
    expect(script).toMatch(/rollbackNewestMigration\(executor, \{ manifest, name: command\.name, confirmation: command\.confirmation, dryRun: command\.dryRun \}\)/);
    expect(script).not.toMatch(/confirmation: ROLLBACK_CONFIRMATION/);
    const loader = ["loadEnv", "Local();"].join(""); // assembled: b16-b-database-qualification refuses any test file that names the loader as a call
    expect(script.indexOf("parseMigrateArguments(")).toBeLessThan(script.indexOf(loader));
    expect(script.indexOf(loader)).toBeGreaterThan(0);
    expect(script).toMatch(/--rollback <name> --confirm/);
  });
});
