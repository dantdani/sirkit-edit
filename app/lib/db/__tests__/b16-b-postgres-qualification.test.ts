/**
 * B16-B — OPT-IN qualification of the migration mechanism against a REAL
 * PostgreSQL server (never the default suite, never `.env.local`):
 *
 *   SIRKIT_DB_QUALIFICATION=1 SIRKIT_DB_QUALIFICATION_URL=postgres://… pnpm exec vitest run app/lib/db/__tests__/b16-b-postgres-qualification.test.ts
 *
 * The run is disposable: everything lands in a scratch schema
 * `sirkit_mig_<random>` pinned through `search_path`, verified, replayed, and
 * dropped CASCADE at the end. The server must carry the platform
 * prerequisites the migrations assume (`vector` extension, `authenticated`
 * role, `auth.uid()`); a plain server without them is reported as
 * `DB_MIGRATION_PREREQUISITE_MISSING`, not worked around. Use only a dedicated
 * disposable server or an isolated Supabase project — never a personal or
 * production project.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrationManifest, truncateManifest } from "../migrations/manifest";
import { createPostgresMigrationExecutor } from "../migrations/postgres-executor";
import { checkMigrationPrerequisites, migrateDatabase, migrationStatus } from "../migrations/runner";
import { captureSchemaSnapshot, schemaFingerprint, verifyMembershipAndOwnership } from "../migrations/verify-schema";
import { databaseQualification, withQualifiedDatabase } from "../test-qualification";

const qualification = databaseQualification();
if (!qualification.enabled) console.log(`[b16-b postgres qualification] skipped — ${qualification.reason}`);

describe.runIf(qualification.enabled)("B16-B §qualified PostgreSQL — clean, upgrade, replay, drift (disposable scratch schema)", () => {
  const scratch = `sirkit_mig_${randomBytes(6).toString("hex")}`;
  let admin: ReturnType<typeof createPostgresMigrationExecutor>;
  let executor: ReturnType<typeof createPostgresMigrationExecutor>;

  beforeAll(async () => {
    const url = withQualifiedDatabase();
    admin = createPostgresMigrationExecutor(url);
    await admin.exec(`CREATE SCHEMA "${scratch}"`);
    executor = createPostgresMigrationExecutor(url, { searchPath: `${scratch},public` });
    const prerequisites = await checkMigrationPrerequisites(executor);
    if (prerequisites.missing.length > 0) throw new Error(`DB_MIGRATION_PREREQUISITE_MISSING on the qualified server: ${prerequisites.missing.join(", ")} — provision them deliberately before qualifying`);
  }, 60_000);

  afterAll(async () => {
    try { await executor?.close(); } finally {
      try { await admin?.exec(`DROP SCHEMA IF EXISTS "${scratch}" CASCADE`); } finally { await admin?.close(); }
    }
  }, 60_000);

  it("clean database → every migration applied; every runbook criterion holds against the server's catalog", async () => {
    const manifest = loadMigrationManifest();
    const result = await migrateDatabase(executor, { manifest });
    expect(result.applied).toHaveLength(manifest.entries.length);
    // The catalog readers query `public`; on the shared server the scratch schema is what was migrated (see scratchReader).
    const criteria = verifyMembershipAndOwnership(await captureSchemaSnapshot(scratchReader(executor, scratch)));
    expect(criteria.filter((row) => !row.ok), JSON.stringify(criteria.filter((row) => !row.ok))).toEqual([]);
  }, 300_000);

  it("replay is idempotent, status is clean, and an upgrade from 0000–0026 reaches the same fingerprint", async () => {
    const manifest = loadMigrationManifest();
    const again = await migrateDatabase(executor, { manifest });
    expect(again.applied).toEqual([]);
    const status = await migrationStatus(executor, manifest);
    expect(status).toMatchObject({ pending: [], drift: [], unknown: [], gap: false });
    const cleanPrint = schemaFingerprint(await captureSchemaSnapshot(scratchReader(executor, scratch)));

    const upgradeSchema = `${scratch}_up`;
    await admin.exec(`CREATE SCHEMA "${upgradeSchema}"`);
    const upgrader = createPostgresMigrationExecutor(withQualifiedDatabase(), { searchPath: `${upgradeSchema},public` });
    try {
      await migrateDatabase(upgrader, { manifest: truncateManifest(manifest, 27) });
      const upgrade = await migrateDatabase(upgrader, { manifest });
      expect(upgrade.applied).toEqual(["0027_project_membership", "0028_bom_project_ownership"]);
      expect(schemaFingerprint(await captureSchemaSnapshot(scratchReader(upgrader, upgradeSchema)))).toBe(cleanPrint);
    } finally {
      await upgrader.close();
      await admin.exec(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`);
    }
  }, 600_000);
});

/** The catalog readers in verify-schema.ts query `public`; on a shared qualification server the scratch schema is what was migrated. */
function scratchReader(executor: ReturnType<typeof createPostgresMigrationExecutor>, schema: string) {
  return {
    exec: (sql: string) => executor.exec(sql),
    query: <Row = Record<string, unknown>>(sql: string, params?: unknown[]) => executor.query<Row>(sql.replace(/'public'/g, `'${schema}'`).replace(/= 'public'/g, `= '${schema}'`), params),
  };
}
