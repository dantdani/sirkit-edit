/**
 * B16-B — the supported migration mechanism, proven on a disposable in-process
 * PostgreSQL (PGlite, real PostgreSQL 17) in the DEFAULT deterministic suite:
 *
 *  - manifest integrity (journal + registered 0027/0028; nothing unregistered,
 *    nothing missing, strictly ascending, no duplicates);
 *  - clean database → every migration applied, ledger complete, prerequisites reported;
 *  - upgrade from the last journal-covered schema (0000–0026) → the SAME
 *    verified schema fingerprint as the clean database;
 *  - idempotent replay (second run applies nothing, ledger unchanged);
 *  - checksum drift is refused before anything is touched;
 *  - an interrupted migration (failure mid-file) leaves NO partial objects and
 *    NO ledger row; the re-run resumes and completes;
 *  - a racing runner that applied an entry first is detected inside the lock
 *    (verified skip, never a double apply);
 *  - ledger rows the manifest does not know, or a gap, are refused.
 */
import { mkdtempSync, writeFileSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMigrationManifest, migrationChecksum, REGISTERED_POST_JOURNAL_MIGRATIONS, splitMigrationStatements, truncateManifest, MigrationManifestError, MIGRATION_LEDGER_TABLE } from "../migrations/manifest";
import { adoptBaseline, BASELINE_CONFIRMATION, BASELINE_RUNNER_VERSION } from "../migrations/baseline";
import { checkMigrationPrerequisites, migrateDatabase, migrationStatus, reconcileLedger } from "../migrations/runner";
import { captureSchemaSnapshot, schemaFingerprint } from "../migrations/verify-schema";
import { disposablePostgres, type DisposablePostgres } from "../disposable-postgres";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");
const open: DisposablePostgres[] = [];
async function fresh(options?: { shims?: boolean }): Promise<DisposablePostgres> { const db = await disposablePostgres(options); open.push(db); return db; }
afterEach(async () => { for (const db of open.splice(0)) await db.close(); });

describe("B16-B §manifest — journal + registered migrations, refusing disagreement", () => {
  it("covers every .sql file exactly once, in strictly ascending order, with 0027/0028 registered after the journal", () => {
    const manifest = loadMigrationManifest(MIGRATIONS_DIR);
    expect(manifest.journal).toMatchObject({ version: "7", dialect: "postgresql", entryCount: 27 });
    expect(manifest.entries).toHaveLength(29);
    expect(manifest.entries.map((entry) => entry.ordinal)).toEqual([...Array(29).keys()]);
    expect(manifest.entries.slice(27).map((entry) => [entry.name, entry.source])).toEqual([["0027_project_membership", "registered"], ["0028_bom_project_ownership", "registered"]]);
    expect(REGISTERED_POST_JOURNAL_MIGRATIONS).toEqual(["0027_project_membership", "0028_bom_project_ownership"]);
    for (const entry of manifest.entries) {
      expect(entry.checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(entry.statements.length).toBeGreaterThan(0);
      expect(entry.checksum).toBe(migrationChecksum(readFileSync(entry.path, "utf8")));
    }
  });

  it("checksums are line-ending independent and statement splitting drops comment-only chunks", () => {
    expect(migrationChecksum("a\r\nb")).toBe(migrationChecksum("a\nb"));
    expect(splitMigrationStatements("-- only a comment\n--> statement-breakpoint\nCREATE TABLE t (x int);--> statement-breakpoint\n\n")).toEqual(["CREATE TABLE t (x int);"]);
  });

  it("refuses an unregistered file, a missing registered file, and a duplicate/out-of-order name", () => {
    const dir = mkdtempSync(join(tmpdir(), "sirkit-manifest-"));
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    writeFileSync(join(dir, "0029_unregistered_change.sql"), "CREATE TABLE stray (x int);\n");
    expect(() => loadMigrationManifest(dir)).toThrow(/DB_MIGRATION_FILE_UNREGISTERED: 0029_unregistered_change/);
    const dir2 = mkdtempSync(join(tmpdir(), "sirkit-manifest-"));
    cpSync(MIGRATIONS_DIR, dir2, { recursive: true });
    const journal = JSON.parse(readFileSync(join(dir2, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
    journal.entries.push({ ...journal.entries[26]!, idx: 27, tag: "0030_missing_file" });
    writeFileSync(join(dir2, "meta", "_journal.json"), JSON.stringify(journal));
    const error = (() => { try { loadMigrationManifest(dir2); return null; } catch (e) { return e as MigrationManifestError; } })();
    expect(error).toBeInstanceOf(MigrationManifestError);
    expect(["DB_MIGRATION_FILE_MISSING", "DB_MIGRATION_ORDER_INVALID"]).toContain(error!.code);
  });
});

describe("B16-B §clean / upgrade / replay / drift / interruption (disposable PostgreSQL)", () => {
  it("a clean database receives every migration in one run; the ledger is the full manifest; prerequisites are reported, never created", async () => {
    const manifest = loadMigrationManifest(MIGRATIONS_DIR);
    const bare = await fresh({ shims: false });
    await expect(migrateDatabase(bare, { manifest })).rejects.toMatchObject({ code: "DB_MIGRATION_PREREQUISITE_MISSING" });
    expect((await checkMigrationPrerequisites(bare)).missing).toEqual(["extension:vector", "role:authenticated", "function:auth.uid"]);

    const db = await fresh();
    expect((await checkMigrationPrerequisites(db)).missing).toEqual([]);
    const result = await migrateDatabase(db, { manifest });
    expect(result.applied).toEqual(manifest.entries.map((entry) => entry.name));
    expect(result.skipped).toEqual([]);
    expect(result.ledger.map((row) => row.name)).toEqual(manifest.entries.map((entry) => entry.name));
    expect(result.ledger.every((row) => row.runner_version === "sirkit.db-migration-runner.v1" && row.statement_count > 0)).toBe(true);
    const snapshot = await captureSchemaSnapshot(db);
    expect(snapshot.tables.length).toBeGreaterThan(100);
    expect(snapshot.tables.some((table) => table.name === MIGRATION_LEDGER_TABLE)).toBe(false); // fingerprints describe the schema, not the runner
    expect(snapshot.tables.find((table) => table.name === "project_members")?.rlsEnabled).toBe(true);
  }, 60_000);

  it("upgrading from the last journal-covered schema (0000–0026) reaches EXACTLY the clean-database fingerprint", async () => {
    const manifest = loadMigrationManifest(MIGRATIONS_DIR);
    const clean = await fresh();
    await migrateDatabase(clean, { manifest });
    const cleanPrint = schemaFingerprint(await captureSchemaSnapshot(clean));

    const upgraded = await fresh();
    const legacy = await migrateDatabase(upgraded, { manifest: truncateManifest(manifest, 27) });
    expect(legacy.applied).toHaveLength(27);
    const before = await captureSchemaSnapshot(upgraded);
    expect(before.tables.some((table) => table.name === "project_members")).toBe(false);
    expect(before.columns.some((column) => column.table === "bom_snapshots" && column.name === "tenant_id")).toBe(false);
    const upgrade = await migrateDatabase(upgraded, { manifest });
    expect(upgrade.applied).toEqual(["0027_project_membership", "0028_bom_project_ownership"]);
    expect(upgrade.skipped).toHaveLength(27);
    expect(schemaFingerprint(await captureSchemaSnapshot(upgraded))).toBe(cleanPrint);
  }, 60_000);

  it("replay is idempotent: a second run applies nothing and the ledger is byte-identical", async () => {
    const manifest = loadMigrationManifest(MIGRATIONS_DIR);
    const db = await fresh();
    const first = await migrateDatabase(db, { manifest });
    const second = await migrateDatabase(db, { manifest });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(first.ledger.map((row) => row.name));
    expect(second.ledger).toEqual(first.ledger);
    const status = await migrationStatus(db, manifest);
    expect(status).toMatchObject({ pending: [], drift: [], unknown: [], gap: false });
    expect(status.applied).toHaveLength(29);
  }, 60_000);

  it("checksum drift is refused BEFORE anything is applied (an edited 0027 after it was applied)", async () => {
    const manifest = loadMigrationManifest(MIGRATIONS_DIR);
    const db = await fresh();
    await migrateDatabase(db, { manifest: truncateManifest(manifest, 28) });
    const drifted = { ...manifest, entries: manifest.entries.map((entry) => entry.name === "0027_project_membership" ? { ...entry, checksum: migrationChecksum(entry.statements.join("\n") + "\n-- edited after apply"), statements: [...entry.statements, "SELECT 1"] } : entry) };
    await expect(migrateDatabase(db, { manifest: drifted })).rejects.toMatchObject({ code: "DB_MIGRATION_CHECKSUM_DRIFT" });
    const status = await migrationStatus(db, manifest);
    expect(status.applied).toHaveLength(28);
    expect((await captureSchemaSnapshot(db)).columns.some((column) => column.table === "bom_snapshots" && column.name === "tenant_id")).toBe(false); // 0028 untouched
  }, 60_000);

  it("an interrupted migration leaves NO partial objects and NO ledger row; the re-run resumes and completes", async () => {
    const manifest = loadMigrationManifest(MIGRATIONS_DIR);
    const db = await fresh();
    await migrateDatabase(db, { manifest: truncateManifest(manifest, 26) });
    // 0026 has two statement chunks (CREATE TABLE parts_atomic_links …, then its index): the outage strikes after the
    // first chunk already ran inside the transaction, so a non-transactional runner would leave the table behind.
    const target = manifest.entries[26]!;
    expect(target.name).toBe("0026_parts_atomic_links");
    expect(target.statements).toHaveLength(2);
    const interrupted = migrateDatabase(db, { manifest, beforeStatement: (entry, index) => { if (entry.name === target.name && index === 1) throw new Error("ECONNRESET simulated outage"); } });
    await expect(interrupted).rejects.toThrow(/ECONNRESET/);
    const status = await migrationStatus(db, manifest);
    expect(status.applied).toHaveLength(26);
    expect(status.applied.map((row) => row.name)).not.toContain(target.name);
    expect(status.pending.map((entry) => entry.name)).toEqual([target.name, "0027_project_membership", "0028_bom_project_ownership"]);
    const snapshot = await captureSchemaSnapshot(db);
    expect(snapshot.tables.some((table) => table.name === "parts_atomic_links")).toBe(false); // the first chunk was rolled back with the failed transaction
    expect(snapshot.tables.some((table) => table.name === "project_members")).toBe(false);
    const resumed = await migrateDatabase(db, { manifest });
    expect(resumed.applied).toEqual([target.name, "0027_project_membership", "0028_bom_project_ownership"]);
    expect((await migrationStatus(db, manifest)).pending).toEqual([]);
    expect((await captureSchemaSnapshot(db)).tables.some((table) => table.name === "parts_atomic_links")).toBe(true);
  }, 60_000);

  it("a racing runner that applied the next entry first is detected inside the lock: verified skip, never a double apply", async () => {
    const manifest = loadMigrationManifest(MIGRATIONS_DIR);
    const db = await fresh();
    await migrateDatabase(db, { manifest: truncateManifest(manifest, 27) });
    const target = manifest.entries[28]!; // 0028
    let raced = false;
    const result = await migrateDatabase(db, {
      manifest,
      beforeStatement: async (entry, index, tx) => {
        // While 0027 is being applied by "us", another instance completes 0028 (its objects + ledger row are committed
        // before our 0028 transaction starts — simulated through the same connection, since the disposable instance is single-user).
        if (entry.name === "0027_project_membership" && index === 0 && !raced) {
          raced = true;
          for (const statement of target.statements) await tx.exec(statement);
          await tx.query(`INSERT INTO "${MIGRATION_LEDGER_TABLE}" (name, checksum, statement_count, runner_version) VALUES ($1, $2, $3, $4)`, [target.name, target.checksum, target.statements.length, "other-instance"]);
        }
      },
    });
    expect(result.applied).toEqual(["0027_project_membership"]);
    expect(result.skipped).toContain("0028_bom_project_ownership");
    expect((await migrationStatus(db, manifest)).pending).toEqual([]);
  }, 60_000);

  it("a ledger row the manifest does not know, or a gap in the applied prefix, is refused", async () => {
    const manifest = loadMigrationManifest(MIGRATIONS_DIR);
    const db = await fresh();
    await migrateDatabase(db, { manifest: truncateManifest(manifest, 5) });
    await db.query(`INSERT INTO "${MIGRATION_LEDGER_TABLE}" (name, checksum, statement_count, runner_version) VALUES ($1, $2, $3, $4)`, ["9999_from_a_future_version", "sha256:" + "0".repeat(64), 1, "x"]);
    await expect(migrateDatabase(db, { manifest })).rejects.toMatchObject({ code: "DB_MIGRATION_LEDGER_UNKNOWN" });
    await db.query(`DELETE FROM "${MIGRATION_LEDGER_TABLE}" WHERE name = $1`, ["9999_from_a_future_version"]);
    await db.query(`DELETE FROM "${MIGRATION_LEDGER_TABLE}" WHERE name = $1`, [manifest.entries[2]!.name]);
    await expect(migrateDatabase(db, { manifest })).rejects.toMatchObject({ code: "DB_MIGRATION_LEDGER_GAP" });
    expect(reconcileLedger(manifest, [{ name: manifest.entries[0]!.name, checksum: manifest.entries[0]!.checksum, applied_at: "", statement_count: 1, runner_version: "x" }]).pending).toHaveLength(28);
  }, 60_000);

  it("dry run plans without applying", async () => {
    const manifest = loadMigrationManifest(MIGRATIONS_DIR);
    const db = await fresh();
    const plan = await migrateDatabase(db, { manifest, dryRun: true });
    expect(plan).toMatchObject({ dryRun: true, applied: [], skipped: [] });
    expect((await captureSchemaSnapshot(db)).tables).toEqual([]);
  });
});

describe("B16-B §baseline adoption — databases that pre-date the ledger (review finding)", () => {
  /** A database built through the journaled prefix WITHOUT any ledger — every pre-B16-B Sirkit database. */
  async function legacyDatabase(count = 27): Promise<{ db: DisposablePostgres; manifest: ReturnType<typeof loadMigrationManifest> }> {
    const db = await fresh();
    const manifest = loadMigrationManifest(MIGRATIONS_DIR);
    await migrateDatabase(db, { manifest: truncateManifest(manifest, count) });
    await db.exec(`DROP TABLE "${MIGRATION_LEDGER_TABLE}"`);
    return { db, manifest };
  }
  /** What the CLI computes on a disposable instance: the prefix catalog and the tables later migrations add. */
  async function expectedFor(manifest: ReturnType<typeof loadMigrationManifest>, count: number) {
    const prefix = await fresh();
    await migrateDatabase(prefix, { manifest: truncateManifest(manifest, count) });
    const expected = await captureSchemaSnapshot(prefix);
    const full = await fresh();
    await migrateDatabase(full, { manifest });
    const known = new Set(expected.tables.map((table) => table.name));
    const laterTables = (await captureSchemaSnapshot(full)).tables.map((table) => table.name).filter((name) => !known.has(name));
    return { expected, laterTables };
  }
  const adoption = (manifest: ReturnType<typeof loadMigrationManifest>, expected: Awaited<ReturnType<typeof expectedFor>>) => ({ manifest, through: "0026_parts_atomic_links", expected: expected.expected, laterTables: expected.laterTables, confirmation: BASELINE_CONFIRMATION, adoptedAt: "2026-09-09T12:00:00.000Z" });

  it("REPRODUCTION: a legacy database (0000–0026 applied by hand, no ledger) cannot be migrated and is misreported as empty", async () => {
    const { db, manifest } = await legacyDatabase();
    await expect(migrateDatabase(db, { manifest })).rejects.toThrow(/already exists/);
    const status = await migrationStatus(db, manifest);
    expect(status.applied).toHaveLength(0);
    expect(status.pending).toHaveLength(29);
    expect((await captureSchemaSnapshot(db)).tables.length).toBeGreaterThan(100);
  }, 120_000);

  it("verified adoption writes the prefix ledger (marked adopted); the ordinary run then applies exactly 0027/0028 and reaches the clean fingerprint", async () => {
    const { db, manifest } = await legacyDatabase();
    await db.exec(`DROP TABLE IF EXISTS "${MIGRATION_LEDGER_TABLE}"`);
    const expected = await expectedFor(manifest, 27);
    expect(expected.laterTables).toEqual(["project_members"]);
    const result = await adoptBaseline(db, adoption(manifest, expected));
    expect(result.adopted).toHaveLength(27);
    expect(result.divergences).toEqual([]);
    const status = await migrationStatus(db, manifest);
    expect(status.applied.map((row) => row.name)).toEqual(manifest.entries.slice(0, 27).map((entry) => entry.name));
    expect(status.applied.every((row) => row.runner_version === BASELINE_RUNNER_VERSION)).toBe(true);
    expect(status.pending.map((entry) => entry.name)).toEqual(["0027_project_membership", "0028_bom_project_ownership"]);
    const upgrade = await migrateDatabase(db, { manifest });
    expect(upgrade.applied).toEqual(["0027_project_membership", "0028_bom_project_ownership"]);
    const clean = await fresh();
    await migrateDatabase(clean, { manifest });
    expect(schemaFingerprint(await captureSchemaSnapshot(db))).toBe(schemaFingerprint(await captureSchemaSnapshot(clean)));
  }, 180_000);

  it("adoption refuses a wrong confirmation, an unknown baseline, a non-empty ledger, a later table already present, and a missing table", async () => {
    const { db, manifest } = await legacyDatabase();
    const expected = await expectedFor(manifest, 27);
    await expect(adoptBaseline(db, { ...adoption(manifest, expected), confirmation: "yes" as never })).rejects.toMatchObject({ code: "DB_MIGRATION_BASELINE_CONFIRMATION_REQUIRED" });
    await expect(adoptBaseline(db, { ...adoption(manifest, expected), through: "0099_nope" })).rejects.toMatchObject({ code: "DB_MIGRATION_BASELINE_UNKNOWN" });
    // a later object present → the database is past the named baseline
    await db.exec(`CREATE TABLE project_members (membership_id text primary key)`);
    await expect(adoptBaseline(db, adoption(manifest, expected))).rejects.toMatchObject({ code: "DB_MIGRATION_BASELINE_LATER_OBJECTS_PRESENT" });
    await db.exec(`DROP TABLE project_members`);
    // a missing table → mismatch, nothing written
    await db.exec(`DROP TABLE parts_atomic_links`);
    await expect(adoptBaseline(db, adoption(manifest, expected))).rejects.toMatchObject({ code: "DB_MIGRATION_BASELINE_MISMATCH" });
    expect((await migrationStatus(db, manifest)).applied).toHaveLength(0);
    // a non-empty ledger → never adopt over an existing history
    const adopted = await fresh();
    await migrateDatabase(adopted, { manifest: truncateManifest(manifest, 3) });
    await expect(adoptBaseline(adopted, adoption(manifest, expected))).rejects.toMatchObject({ code: "DB_MIGRATION_BASELINE_LEDGER_NOT_EMPTY" });
  }, 180_000);

  it("constraint / index divergences (e.g. a db:push-built database) are RECORDED, not refused", async () => {
    const { db, manifest } = await legacyDatabase();
    await db.exec(`DROP INDEX parts_atomic_links_revision_idx`);
    const expected = await expectedFor(manifest, 27);
    const result = await adoptBaseline(db, adoption(manifest, expected));
    expect(result.adopted).toHaveLength(27);
    expect(result.divergences).toEqual(["missing index:parts_atomic_links.parts_atomic_links_revision_idx"]);
  }, 180_000);
});
