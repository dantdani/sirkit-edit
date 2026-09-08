/**
 * [B16-B] The ONE supported way to bring a Sirkit PostgreSQL database to the
 * current schema:
 *
 *   pnpm run db:migrate            apply every pending migration (transactional ledger)
 *   pnpm run db:migrate -- --status  report applied / pending / drift, change nothing
 *   pnpm run db:migrate -- --dry-run plan only
 *
 * The target is `DATABASE_URL` (loaded from `.env.local` ONLY here, in the
 * operator's CLI — never in tests). Platform prerequisites the migrations
 * assume (the `vector` extension, the `authenticated` role, `auth.uid()`) are
 * REPORTED, never created silently. Nothing is printed that could carry a
 * credential: the URL is shown as host/database only.
 */

import { loadEnvLocal } from "../app/lib/load-env-local";
import { loadMigrationManifest } from "../app/lib/db/migrations/manifest";
import { createPostgresMigrationExecutor } from "../app/lib/db/migrations/postgres-executor";
import { checkMigrationPrerequisites, migrateDatabase, migrationStatus, MigrationRefusal } from "../app/lib/db/migrations/runner";

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
  const args = new Set(process.argv.slice(2));
  loadEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write("DATABASE_URL is not set (add it to .env.local or the environment). Nothing was changed.\n"); return 2; }
  const manifest = loadMigrationManifest();
  process.stdout.write(`manifest: ${manifest.entries.length} migrations (${manifest.journal.entryCount} journaled + ${manifest.entries.length - manifest.journal.entryCount} registered) → ${redactedTarget(url)}\n`);
  const executor = createPostgresMigrationExecutor(url);
  try {
    const prerequisites = await checkMigrationPrerequisites(executor);
    if (prerequisites.missing.length > 0) process.stdout.write(`prerequisites missing (provision them deliberately): ${prerequisites.missing.join(", ")}\n`);
    if (args.has("--status")) {
      const status = await migrationStatus(executor, manifest);
      process.stdout.write(`applied: ${status.applied.length}; pending: ${status.pending.map((entry) => entry.name).join(", ") || "none"}; drift: ${status.drift.length}; unknown: ${status.unknown.length}; gap: ${status.gap}\n`);
      return status.drift.length || status.unknown.length || status.gap ? 1 : 0;
    }
    const result = await migrateDatabase(executor, { manifest, dryRun: args.has("--dry-run"), onApplied: (entry, count) => process.stdout.write(`applied ${entry.name} (${count} statements)\n`) });
    process.stdout.write(`${result.dryRun ? "dry run: " : ""}applied ${result.applied.length}, already applied ${result.skipped.length}, ledger ${result.ledger.length}\n`);
    return 0;
  } catch (error) {
    if (error instanceof MigrationRefusal) { process.stderr.write(`REFUSED ${error.message}\n`); return 1; }
    process.stderr.write(`FAILED ${redactedError(error instanceof Error ? error.message : String(error), url)}\n`);
    return 1;
  } finally {
    await executor.close();
  }
}

main().then((code) => process.exit(code), (error) => { process.stderr.write(String(error)); process.exit(1); });
