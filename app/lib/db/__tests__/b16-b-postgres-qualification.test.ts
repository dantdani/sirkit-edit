/**
 * B16-B — OPT-IN qualification of the migration mechanism against a REAL
 * PostgreSQL server (never the default suite, never `.env.local`):
 *
 *   SIRKIT_DB_QUALIFICATION=1 SIRKIT_DB_QUALIFICATION_URL=postgres://… \
 *   [SIRKIT_DB_QUALIFICATION_URL_2=postgres://…] pnpm exec vitest run app/lib/db/__tests__/b16-b-postgres-qualification.test.ts
 *
 * Why a whole DISPOSABLE DATABASE (not a scratch schema): the drizzle-generated
 * migrations carry 25 explicit `"public"."<table>"` references (foreign-key
 * targets), so they cannot be hosted in another schema; and extensions created
 * by the migrations (`pg_trgm`, `pgcrypto`) install server-wide. The target
 * database must therefore be EMPTY (no table in `public`) — the suite refuses
 * anything else (`DB_QUALIFICATION_TARGET_NOT_EMPTY`) and leaves the migrated
 * schema in place afterwards for inspection (dropping a database is the
 * operator's act). The upgrade-from-0026 proof needs a SECOND empty database
 * (`SIRKIT_DB_QUALIFICATION_URL_2`); without it that case is reported skipped.
 * The server must carry the platform prerequisites the migrations assume
 * (`vector` extension, `authenticated` role, `auth.uid()`); a plain server is
 * reported as `DB_MIGRATION_PREREQUISITE_MISSING`, not worked around. Use only
 * a dedicated disposable server or an isolated Supabase project — never a
 * personal or production project.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrationManifest, truncateManifest } from "../migrations/manifest";
import { createPostgresMigrationExecutor } from "../migrations/postgres-executor";
import { checkMigrationPrerequisites, migrateDatabase, migrationStatus } from "../migrations/runner";
import { captureSchemaSnapshot, schemaFingerprint, verifyMembershipAndOwnership } from "../migrations/verify-schema";
import { databaseQualification, withQualifiedDatabase } from "../test-qualification";

const qualification = databaseQualification();
if (!qualification.enabled) console.log(`[b16-b postgres qualification] skipped — ${qualification.reason}`);
const secondUrl = process.env.SIRKIT_DB_QUALIFICATION_URL_2?.trim() || null;

async function requireEmpty(executor: ReturnType<typeof createPostgresMigrationExecutor>, label: string): Promise<void> {
  const rows = await executor.query<{ n: string }>("SELECT count(*)::text AS n FROM pg_tables WHERE schemaname = 'public'");
  if (rows[0]?.n !== "0") throw new Error(`DB_QUALIFICATION_TARGET_NOT_EMPTY: ${label} has ${rows[0]?.n} tables in public — point the qualification at an EMPTY disposable database`);
  const prerequisites = await checkMigrationPrerequisites(executor);
  if (prerequisites.missing.length > 0) throw new Error(`DB_MIGRATION_PREREQUISITE_MISSING on ${label}: ${prerequisites.missing.join(", ")} — provision them deliberately before qualifying`);
}

describe.runIf(qualification.enabled)("B16-B §qualified PostgreSQL — clean, replay, status (disposable empty database)", () => {
  let executor: ReturnType<typeof createPostgresMigrationExecutor>;
  let cleanPrint = "";

  beforeAll(async () => {
    executor = createPostgresMigrationExecutor(withQualifiedDatabase());
    await requireEmpty(executor, "SIRKIT_DB_QUALIFICATION_URL");
  }, 60_000);
  afterAll(async () => { await executor?.close(); }, 60_000);

  it("clean database → every migration applied; every runbook criterion holds against the server's catalog", async () => {
    const manifest = loadMigrationManifest();
    const result = await migrateDatabase(executor, { manifest });
    expect(result.applied).toHaveLength(manifest.entries.length);
    const snapshot = await captureSchemaSnapshot(executor);
    const criteria = verifyMembershipAndOwnership(snapshot);
    expect(criteria.filter((row) => !row.ok), JSON.stringify(criteria.filter((row) => !row.ok))).toEqual([]);
    cleanPrint = schemaFingerprint(snapshot);
    console.log(`[b16-b postgres qualification] clean fingerprint ${cleanPrint}`);
  }, 300_000);

  it("replay is idempotent and the status is clean", async () => {
    const manifest = loadMigrationManifest();
    const again = await migrateDatabase(executor, { manifest });
    expect(again.applied).toEqual([]);
    expect(await migrationStatus(executor, manifest)).toMatchObject({ pending: [], drift: [], unknown: [], gap: false });
  }, 120_000);

  it.runIf(Boolean(secondUrl))("upgrade from 0000–0026 on a SECOND empty database reaches the clean fingerprint", async () => {
    const manifest = loadMigrationManifest();
    const upgrader = createPostgresMigrationExecutor(secondUrl!);
    try {
      await requireEmpty(upgrader, "SIRKIT_DB_QUALIFICATION_URL_2");
      await migrateDatabase(upgrader, { manifest: truncateManifest(manifest, 27) });
      const upgrade = await migrateDatabase(upgrader, { manifest });
      expect(upgrade.applied).toEqual(["0027_project_membership", "0028_bom_project_ownership"]);
      expect(schemaFingerprint(await captureSchemaSnapshot(upgrader))).toBe(cleanPrint);
    } finally {
      await upgrader.close();
    }
  }, 600_000);
  if (!secondUrl && qualification.enabled) console.log("[b16-b postgres qualification] upgrade case skipped — SIRKIT_DB_QUALIFICATION_URL_2 (a second empty database) not provided");
});
