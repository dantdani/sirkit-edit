/**
 * [B16-B] The ordered migration manifest — the ONE list of SQL migrations a
 * Sirkit database receives, and the integrity rules that keep it honest.
 *
 * Audit findings this closes (recorded in the B16 closeout artifacts):
 *  - `drizzle/meta/_journal.json` registers 0000–0026 only; `0027_project_membership.sql`
 *    and `0028_bom_project_ownership.sql` were hand-written after the journal
 *    stopped being regenerated (snapshots exist only for 0000–0008), so no
 *    Drizzle migrator could ever apply them and `drizzle-kit generate` cannot
 *    diff against a snapshot it does not have.
 *  - No `db:migrate` command existed; the documented clean-database path was
 *    `drizzle-kit push` from `schema.ts`, which does not carry the 0028 CHECK
 *    constraints or owner indexes (see the divergence audit).
 *
 * Contract: the manifest is the journal's entries IN JOURNAL ORDER followed by
 * the explicitly REGISTERED post-journal migrations (listed here, reviewed by a
 * human, never inferred from the directory). `loadMigrationManifest` refuses
 * to run when a `.sql` file in the directory is neither journaled nor
 * registered, when a journaled/registered file is missing, when a name is
 * covered twice, or when the numeric prefixes are not strictly ascending — so
 * the directory, the journal and this list can never silently disagree. No
 * Drizzle metadata is invented: the journal and snapshots are read, not
 * written, and the runner keeps its OWN transactional ledger.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compareCodePoints } from "../../stable-compare";

/** Migrations written after the journal stopped being regenerated (B16.0 / B16.0.2). Reviewed by hand; extend ONLY with a reviewed entry. */
export const REGISTERED_POST_JOURNAL_MIGRATIONS: readonly string[] = Object.freeze([
  "0027_project_membership",
  "0028_bom_project_ownership",
  "0029_part_offers_mpn", // [B19-D I5b] offers carry their exact MPN
  "0030_atomic_revision_status_events", // [B19-E E3] append-only withdrawal of published atomic revisions
]);

export const MIGRATION_RUNNER_VERSION = "sirkit.db-migration-runner.v1" as const;
export const MIGRATION_LEDGER_TABLE = "sirkit_schema_migrations" as const;

/**
 * Platform objects the migrations ASSUME exist before the first file runs
 * (Supabase provisions them per project; a plain PostgreSQL does not):
 *  - the `vector` extension (`0000` declares `vector(1536)` columns and an hnsw
 *    index without a CREATE EXTENSION);
 *  - the `authenticated` role and the `auth.uid()` function that `0027`'s RLS
 *    policy references.
 * The runner does NOT create them silently: `checkMigrationPrerequisites`
 * reports what is missing so an operator provisions them deliberately (the
 * disposable test harness provisions documented shims).
 */
export const MIGRATION_PREREQUISITES = Object.freeze({
  extensions: ["vector"] as const,
  roles: ["authenticated"] as const,
  functions: ["auth.uid"] as const,
});

export interface MigrationManifestEntry {
  /** File name without extension, e.g. `0027_project_membership`. */
  name: string;
  /** Numeric prefix (`27`). */
  ordinal: number;
  /** `journal` (from drizzle/meta/_journal.json) or `registered` (this module). */
  source: "journal" | "registered";
  /** Absolute path of the SQL file. */
  path: string;
  /** sha256 of the file text with line endings normalized to LF. */
  checksum: string;
  /** Executable statement chunks (split on `--> statement-breakpoint`; comments-only chunks dropped). */
  statements: string[];
}

export interface MigrationManifest {
  directory: string;
  entries: MigrationManifestEntry[];
  /** Journal metadata as read (never modified). */
  journal: { version: string; dialect: string; entryCount: number };
}

export class MigrationManifestError extends Error {
  constructor(readonly code: "DB_MIGRATION_DIRECTORY_MISSING" | "DB_MIGRATION_JOURNAL_INVALID" | "DB_MIGRATION_FILE_MISSING" | "DB_MIGRATION_FILE_UNREGISTERED" | "DB_MIGRATION_DUPLICATE" | "DB_MIGRATION_ORDER_INVALID", detail: string) {
    super(`${code}: ${detail}`);
    this.name = "MigrationManifestError";
  }
}

export function migrationChecksum(text: string): string {
  return `sha256:${createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex")}`;
}

/** Split a Drizzle-style migration into executable chunks. A chunk that is only comments/whitespace is dropped. */
export function splitMigrationStatements(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/-->\s*statement-breakpoint/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.replace(/^\s*--[^\n]*$/gm, "").trim().length > 0);
}

function ordinalOf(name: string): number {
  const match = /^(\d{4})_/.exec(name);
  if (!match) throw new MigrationManifestError("DB_MIGRATION_ORDER_INVALID", `migration name lacks a 4-digit ordinal prefix: ${name}`);
  return Number(match[1]);
}

export function loadMigrationManifest(directory = join(process.cwd(), "drizzle")): MigrationManifest {
  if (!existsSync(directory)) throw new MigrationManifestError("DB_MIGRATION_DIRECTORY_MISSING", directory);
  const journalPath = join(directory, "meta", "_journal.json");
  if (!existsSync(journalPath)) throw new MigrationManifestError("DB_MIGRATION_JOURNAL_INVALID", `missing ${journalPath}`);
  let journal: { version?: unknown; dialect?: unknown; entries?: unknown };
  try { journal = JSON.parse(readFileSync(journalPath, "utf8")) as typeof journal; } catch (error) { throw new MigrationManifestError("DB_MIGRATION_JOURNAL_INVALID", error instanceof Error ? error.message : String(error)); }
  if (!Array.isArray(journal.entries) || typeof journal.version !== "string" || journal.dialect !== "postgresql") throw new MigrationManifestError("DB_MIGRATION_JOURNAL_INVALID", "journal shape");
  const journaled = (journal.entries as Array<{ tag?: unknown; idx?: unknown }>).map((entry, index) => {
    if (typeof entry.tag !== "string" || typeof entry.idx !== "number" || entry.idx !== index) throw new MigrationManifestError("DB_MIGRATION_JOURNAL_INVALID", `entry ${index}`);
    return entry.tag;
  });

  const names: Array<{ name: string; source: MigrationManifestEntry["source"] }> = [
    ...journaled.map((name) => ({ name, source: "journal" as const })),
    ...REGISTERED_POST_JOURNAL_MIGRATIONS.map((name) => ({ name, source: "registered" as const })),
  ];
  const seen = new Set<string>();
  for (const { name } of names) {
    if (seen.has(name)) throw new MigrationManifestError("DB_MIGRATION_DUPLICATE", name);
    seen.add(name);
  }
  const onDisk = readdirSync(directory).filter((file) => file.endsWith(".sql")).map((file) => file.slice(0, -4)).sort(compareCodePoints);
  for (const name of onDisk) if (!seen.has(name)) throw new MigrationManifestError("DB_MIGRATION_FILE_UNREGISTERED", `${name}.sql is neither journaled nor registered in REGISTERED_POST_JOURNAL_MIGRATIONS`);

  let previous = -1;
  const entries = names.map(({ name, source }): MigrationManifestEntry => {
    const path = join(directory, `${name}.sql`);
    if (!existsSync(path)) throw new MigrationManifestError("DB_MIGRATION_FILE_MISSING", path);
    const ordinal = ordinalOf(name);
    if (ordinal <= previous) throw new MigrationManifestError("DB_MIGRATION_ORDER_INVALID", `${name} does not follow ${String(previous).padStart(4, "0")}`);
    previous = ordinal;
    const text = readFileSync(path, "utf8");
    return { name, ordinal, source, path, checksum: migrationChecksum(text), statements: splitMigrationStatements(text) };
  });
  return { directory, entries, journal: { version: journal.version, dialect: journal.dialect, entryCount: journaled.length } };
}

/** A manifest truncated to the first `count` entries (upgrade tests: "the last supported schema"). */
export function truncateManifest(manifest: MigrationManifest, count: number): MigrationManifest {
  return { ...manifest, entries: manifest.entries.slice(0, count) };
}
