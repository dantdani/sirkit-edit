/**
 * [B16-B] The ONE supported way to bring a Sirkit PostgreSQL database to the
 * current schema:
 *
 *   pnpm run db:migrate                       apply every pending migration (transactional ledger)
 *   pnpm run db:migrate -- --status           report applied / pending / drift, change nothing
 *   pnpm run db:migrate -- --dry-run          plan only
 *   pnpm run db:migrate -- --baseline <name>  ADOPT a database that pre-dates the ledger (built
 *                                             through <name>, e.g. 0026_parts_atomic_links): the
 *                                             prefix is replayed into a disposable in-process
 *                                             PostgreSQL, the live catalog must carry every table and
 *                                             column of that prefix and none of the later tables,
 *                                             constraint/index divergences are printed, and only then
 *                                             are the ledger rows written (marked ADOPTED). Then run
 *                                             `db:migrate` normally.
 *   pnpm run db:migrate -- --rollback <name> --confirm <ROLLBACK_CONFIRMATION> [--dry-run]
 *                                             [B24-A4] OD-193: roll back the NEWEST applied migration by its reviewed
 *                                             DOWN (drizzle/rollback/<name>.down.sql, bound to the forward checksum), in
 *                                             one transaction with its ledger row; 0031 is lossless, 0027-0030 run only
 *                                             while they would lose no row, 0000-0026 are forward-only (rollback means
 *                                             restore). The operator types the confirmation; --dry-run plans only;
 *                                             --rollback with --baseline refuses.
 *
 * The target is `DATABASE_URL` (loaded from `.env.local` ONLY here, in the
 * operator's CLI — never in tests). Platform prerequisites the migrations
 * assume (the `vector` extension, the `authenticated` role, `auth.uid()`) are
 * REPORTED, never created silently. Nothing is printed that could carry a
 * credential: the URL is shown as host/database only and driver errors are
 * stripped of the URL's user and password.
 */

import { loadEnvLocal } from "../app/lib/load-env-local";
import { adoptBaseline, BASELINE_CONFIRMATION, BaselineRefusal } from "../app/lib/db/migrations/baseline";
import { loadMigrationManifest, truncateManifest } from "../app/lib/db/migrations/manifest";
import { createPostgresMigrationExecutor } from "../app/lib/db/migrations/postgres-executor";
import { checkMigrationPrerequisites, migrateDatabase, migrationStatus, MigrationRefusal } from "../app/lib/db/migrations/runner";
import { parseMigrateArguments } from "../app/lib/db/migrations/cli-arguments";
import { rollbackNewestMigration, RollbackRefusal } from "../app/lib/db/migrations/rollback";
import { captureSchemaSnapshot } from "../app/lib/db/migrations/verify-schema";

function redactedTarget(url: string): string {
  try { const parsed = new URL(url); return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`; } catch { return "<unparseable url>"; }
}

/** Driver errors echo the connection's user/tenant; strip the URL's credentials and user segment before printing. */
function redactedError(message: string, url: string): string {
  let out = message.replace(url, "<url>");
  try {
    const parsed = new URL(url);
    for (const secret of [parsed.password, parsed.username].filter((value) => value.length > 0)) out = out.split(decodeURIComponent(secret)).join("<redacted>");
  } catch { /* unparseable url: nothing more to redact */ }
  return out;
}

async function main(): Promise<number> {
  // [B24-A4] OD-193: the arguments are parsed (cli-arguments.ts, side-effect free) before .env.local is loaded or anything connects;
  // an unknown flag now refuses instead of falling through to an apply
  const parsed = parseMigrateArguments(process.argv.slice(2));
  if (!parsed.ok) { process.stderr.write(`REFUSED ${parsed.code}: ${parsed.message} Nothing was changed.\n`); return 2; }
  const command = parsed.command;
  loadEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("DATABASE_URL is not set (add it to .env.local or the environment). Nothing was changed.\n"); return 2; }
  const manifest = loadMigrationManifest();
  process.stdout.write(`manifest: ${manifest.entries.length} migrations (${manifest.journal.entryCount} journaled + ${manifest.entries.length - manifest.journal.entryCount} registered) → ${redactedTarget(url)}\n`);
  const executor = createPostgresMigrationExecutor(url);
  try {
    const prerequisites = await checkMigrationPrerequisites(executor);
    if (prerequisites.missing.length > 0) process.stdout.write(`prerequisites missing (provision them deliberately): ${prerequisites.missing.join(", ")}\n`);
    if (command.mode === "status") {
      const status = await migrationStatus(executor, manifest);
      process.stdout.write(`applied: ${status.applied.length}; pending: ${status.pending.map((entry) => entry.name).join(", ") || "none"}; drift: ${status.drift.length}; unknown: ${status.unknown.length}; gap: ${status.gap}\n`);
      return status.drift.length || status.unknown.length || status.gap ? 1 : 0;
    }
    if (command.mode === "baseline") {
      const baselineThrough = command.through;
      const index = manifest.entries.findIndex((entry) => entry.name === baselineThrough);
      if (index < 0) { process.stderr.write(`REFUSED DB_MIGRATION_BASELINE_UNKNOWN: ${baselineThrough}\n`); return 1; }
      // The expected catalog of the prefix — and of the full manifest, to know which tables are "later" — from a disposable instance.
      const { disposablePostgres } = await import("../app/lib/db/disposable-postgres");
      const prefixInstance = await disposablePostgres();
      const fullInstance = await disposablePostgres();
      try {
        await migrateDatabase(prefixInstance, { manifest: truncateManifest(manifest, index + 1) });
        await migrateDatabase(fullInstance, { manifest });
        const expected = await captureSchemaSnapshot(prefixInstance);
        const expectedTables = new Set(expected.tables.map((table) => table.name));
        const laterTables = (await captureSchemaSnapshot(fullInstance)).tables.map((table) => table.name).filter((name) => !expectedTables.has(name));
        const result = await adoptBaseline(executor, { manifest, through: baselineThrough, expected, laterTables, confirmation: BASELINE_CONFIRMATION, adoptedAt: new Date().toISOString() });
        process.stdout.write(`adopted baseline through ${baselineThrough}: ${result.adopted.length} ledger rows written (marked adopted)\n`);
        if (result.divergences.length > 0) process.stdout.write(`recorded divergences from the prefix catalog (constraints/indexes; review migration-delivery-contract.md §4):\n${result.divergences.map((line) => `  ${line}`).join("\n")}\n`);
        process.stdout.write("next: pnpm run db:migrate\n");
        return 0;
      } finally {
        await prefixInstance.close();
        await fullInstance.close();
      }
    }
    if (command.mode === "rollback") {
      const rolled = await rollbackNewestMigration(executor, { manifest, name: command.name, confirmation: command.confirmation, dryRun: command.dryRun });
      process.stdout.write(`${rolled.dryRun ? "dry run: would roll back" : "rolled back"} ${rolled.name} (${rolled.class}, ${rolled.statements} DOWN statements); ledger ${rolled.ledger.length}\n`);
      return 0;
    }
    const result = await migrateDatabase(executor, { manifest, dryRun: command.dryRun, onApplied: (entry, count) => process.stdout.write(`applied ${entry.name} (${count} statements)\n`) });
    process.stdout.write(`${result.dryRun ? "dry run: " : ""}applied ${result.applied.length}, already applied ${result.skipped.length}, ledger ${result.ledger.length}\n`);
    return 0;
  } catch (error) {
    if (error instanceof MigrationRefusal || error instanceof BaselineRefusal || error instanceof RollbackRefusal) { process.stderr.write(`REFUSED ${error.message}\n`); return 1; }
    process.stderr.write(`FAILED ${redactedError(error instanceof Error ? error.message : String(error), url)}\n`);
    return 1;
  } finally {
    await executor.close();
  }
}

main().then((code) => process.exit(code), (error) => { process.stderr.write(String(error)); process.exit(1); });
