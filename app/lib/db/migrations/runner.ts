/**
 * [B16-B] Explicit, reviewed migration runner with a TRANSACTIONAL applied-migration ledger.
 *
 * Why not the Drizzle migrator: the journal is incomplete (0027/0028 were never
 * journaled, snapshots stop at 0008) and no `__drizzle_migrations` table was
 * ever created on any Sirkit database, so the supported toolchain cannot
 * express the real applied state. This runner is narrow on purpose:
 *
 *  - one migration = ONE transaction: every statement chunk of the file AND the
 *    ledger row are committed together, so an interrupted migration leaves
 *    nothing behind (no half-applied file, no ledger row) and a re-run resumes
 *    exactly where it stopped;
 *  - the ledger (`sirkit_schema_migrations`) records name + checksum; a replay
 *    is idempotent (already-applied entries are skipped after their checksum is
 *    re-verified) and any checksum drift, unknown ledger row, or gap in the
 *    applied prefix REFUSES the whole run before touching anything;
 *  - a transaction-scoped advisory lock serializes concurrent runners;
 *  - the runner never edits Drizzle metadata and never creates platform
 *    prerequisites (extensions, roles) silently — it reports them.
 *
 * The executor abstraction is the only driver seam: the CLI binds it to
 * `postgres` (postgres-js); the deterministic tests bind it to an in-process
 * PostgreSQL (PGlite) so clean / upgrade / interrupted / drift behaviour is
 * proven in default CI with no live database.
 */

import { MIGRATION_LEDGER_TABLE, MIGRATION_PREREQUISITES, MIGRATION_RUNNER_VERSION, type MigrationManifest, type MigrationManifestEntry } from "./manifest";

export interface MigrationStatementRunner {
  /** Execute a (possibly multi-statement) SQL text with no parameters. */
  exec(sql: string): Promise<void>;
  /** Parameterized query returning rows. */
  query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<Row[]>;
}

export interface MigrationExecutor extends MigrationStatementRunner {
  /** Run `fn` inside ONE database transaction; a throw rolls everything back. */
  transaction<T>(fn: (tx: MigrationStatementRunner) => Promise<T>): Promise<T>;
}

export interface MigrationLedgerRow {
  name: string;
  checksum: string;
  applied_at: string;
  statement_count: number;
  runner_version: string;
}

export type MigrationRefusalCode =
  | "DB_MIGRATION_CHECKSUM_DRIFT"
  | "DB_MIGRATION_LEDGER_UNKNOWN"
  | "DB_MIGRATION_LEDGER_GAP"
  | "DB_MIGRATION_PREREQUISITE_MISSING"
  | "DB_MIGRATION_LEDGER_UNVERIFIED";

export class MigrationRefusal extends Error {
  constructor(readonly code: MigrationRefusalCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "MigrationRefusal";
  }
}

export interface MigrationStatus {
  applied: MigrationLedgerRow[];
  pending: MigrationManifestEntry[];
  /** Entries whose file checksum no longer matches the ledger. */
  drift: Array<{ name: string; ledgerChecksum: string; fileChecksum: string }>;
  /** Ledger rows for names the manifest does not know. */
  unknown: MigrationLedgerRow[];
  /** True when the applied set is not a prefix of the manifest (a hole). */
  gap: boolean;
}

export interface MigrateOptions {
  manifest: MigrationManifest;
  /** Report the plan without executing (ledger table is still created). */
  dryRun?: boolean;
  /** Observer per migration THIS run applied (called inside its transaction, after the ledger row). Never called for a verified skip. */
  onApplied?(entry: MigrationManifestEntry, statementCount: number): void;
  /** Test seam: called before each statement chunk of each migration, inside its transaction (may throw to simulate an interruption; `tx` lets a test simulate a concurrent instance's writes). */
  beforeStatement?(entry: MigrationManifestEntry, index: number, tx: MigrationStatementRunner): Promise<void> | void;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
  ledger: MigrationLedgerRow[];
  dryRun: boolean;
}

const LOCK_KEY = "sirkit_schema_migrations";

function ledgerDdl(): string {
  return `CREATE TABLE IF NOT EXISTS "${MIGRATION_LEDGER_TABLE}" (
  "name" text PRIMARY KEY NOT NULL,
  "checksum" text NOT NULL,
  "applied_at" timestamp with time zone NOT NULL DEFAULT now(),
  "statement_count" integer NOT NULL,
  "runner_version" text NOT NULL,
  CONSTRAINT "${MIGRATION_LEDGER_TABLE}_checksum_check" CHECK (checksum LIKE 'sha256:%'),
  CONSTRAINT "${MIGRATION_LEDGER_TABLE}_count_check" CHECK (statement_count >= 0)
)`;
}

async function readLedger(runner: MigrationStatementRunner): Promise<MigrationLedgerRow[]> {
  const rows = await runner.query<MigrationLedgerRow>(`SELECT name, checksum, applied_at::text AS applied_at, statement_count, runner_version FROM "${MIGRATION_LEDGER_TABLE}" ORDER BY name`);
  return rows.map((row) => ({ ...row, statement_count: Number(row.statement_count) }));
}

/** Compare the ledger with the manifest. Pure over the rows; refuses nothing itself. */
export function reconcileLedger(manifest: MigrationManifest, ledger: MigrationLedgerRow[]): MigrationStatus {
  const byName = new Map(ledger.map((row) => [row.name, row]));
  const known = new Set(manifest.entries.map((entry) => entry.name));
  const drift: MigrationStatus["drift"] = [];
  const pending: MigrationManifestEntry[] = [];
  let sawPending = false;
  let gap = false;
  for (const entry of manifest.entries) {
    const row = byName.get(entry.name);
    if (row) {
      if (sawPending) gap = true;
      if (row.checksum !== entry.checksum) drift.push({ name: entry.name, ledgerChecksum: row.checksum, fileChecksum: entry.checksum });
    } else {
      sawPending = true;
      pending.push(entry);
    }
  }
  const unknown = ledger.filter((row) => !known.has(row.name));
  return { applied: ledger.filter((row) => known.has(row.name)), pending, drift, unknown, gap };
}

function refuseOnInconsistency(status: MigrationStatus): void {
  if (status.drift.length > 0) throw new MigrationRefusal("DB_MIGRATION_CHECKSUM_DRIFT", status.drift.map((item) => `${item.name} ledger=${item.ledgerChecksum} file=${item.fileChecksum}`).join("; "));
  if (status.unknown.length > 0) throw new MigrationRefusal("DB_MIGRATION_LEDGER_UNKNOWN", status.unknown.map((row) => row.name).join(", "));
  if (status.gap) throw new MigrationRefusal("DB_MIGRATION_LEDGER_GAP", "applied migrations are not a prefix of the manifest");
}

/** Which platform prerequisites (extension / role / function) are absent. Never creates them. */
export async function checkMigrationPrerequisites(runner: MigrationStatementRunner): Promise<{ missing: string[] }> {
  const missing: string[] = [];
  for (const extension of MIGRATION_PREREQUISITES.extensions) {
    const rows = await runner.query<{ n: string }>("SELECT count(*)::text AS n FROM pg_extension WHERE extname = $1", [extension]);
    if (rows[0]?.n !== "1") missing.push(`extension:${extension}`);
  }
  for (const role of MIGRATION_PREREQUISITES.roles) {
    const rows = await runner.query<{ n: string }>("SELECT count(*)::text AS n FROM pg_roles WHERE rolname = $1", [role]);
    if (rows[0]?.n !== "1") missing.push(`role:${role}`);
  }
  for (const fn of MIGRATION_PREREQUISITES.functions) {
    const [schema, name] = fn.split(".");
    const rows = await runner.query<{ n: string }>("SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1 AND p.proname = $2", [schema, name]);
    if (rows[0]?.n === "0") missing.push(`function:${fn}`);
  }
  return { missing };
}

/**
 * Create the ledger table if absent — inside a transaction that holds the
 * runner's advisory lock, so two runners meeting an absent ledger on the same
 * server never race `CREATE TABLE IF NOT EXISTS` (which is not race-safe
 * across sessions in PostgreSQL) into a spurious duplicate-type error.
 */
export async function ensureLedger(executor: MigrationExecutor): Promise<void> {
  await executor.transaction(async (tx) => {
    await tx.exec(`SELECT pg_advisory_xact_lock(hashtext('${LOCK_KEY}'))`);
    await tx.exec(ledgerDdl());
  });
}

/** Read-only status (creates the ledger table if absent so status works on a clean database). */
export async function migrationStatus(executor: MigrationExecutor, manifest: MigrationManifest): Promise<MigrationStatus> {
  await ensureLedger(executor);
  return reconcileLedger(manifest, await readLedger(executor));
}

export async function migrateDatabase(executor: MigrationExecutor, options: MigrateOptions): Promise<MigrateResult> {
  const { manifest } = options;
  await ensureLedger(executor);
  const prerequisites = await checkMigrationPrerequisites(executor);
  if (prerequisites.missing.length > 0) throw new MigrationRefusal("DB_MIGRATION_PREREQUISITE_MISSING", prerequisites.missing.join(", "));
  const before = reconcileLedger(manifest, await readLedger(executor));
  refuseOnInconsistency(before);
  const skipped = before.applied.map((row) => row.name);
  const applied: string[] = [];
  if (options.dryRun) return { applied: [], skipped, ledger: before.applied, dryRun: true };

  for (const entry of before.pending) {
    await executor.transaction(async (tx) => {
      // Serialize concurrent runners for the life of this transaction; re-check
      // the ledger INSIDE the lock so a racing runner that applied this entry
      // first turns our run into a verified skip, never a double apply.
      await tx.exec(`SELECT pg_advisory_xact_lock(hashtext('${LOCK_KEY}'))`);
      const current = await tx.query<MigrationLedgerRow>(`SELECT name, checksum, applied_at::text AS applied_at, statement_count, runner_version FROM "${MIGRATION_LEDGER_TABLE}" WHERE name = $1`, [entry.name]);
      if (current.length > 0) {
        if (current[0]!.checksum !== entry.checksum) throw new MigrationRefusal("DB_MIGRATION_CHECKSUM_DRIFT", `${entry.name} applied concurrently with a different checksum`);
        skipped.push(entry.name);
        return;
      }
      for (let index = 0; index < entry.statements.length; index += 1) {
        await options.beforeStatement?.(entry, index, tx);
        await tx.exec(entry.statements[index]!);
      }
      await tx.query(`INSERT INTO "${MIGRATION_LEDGER_TABLE}" (name, checksum, statement_count, runner_version) VALUES ($1, $2, $3, $4)`, [entry.name, entry.checksum, entry.statements.length, MIGRATION_RUNNER_VERSION]);
      applied.push(entry.name);
      // Observed only for a migration THIS run applied — never for the in-lock verified skip above.
      options.onApplied?.(entry, entry.statements.length);
    });
  }

  // Post-run verification: the ledger must now be exactly the manifest prefix we intended.
  const after = reconcileLedger(manifest, await readLedger(executor));
  if (after.pending.length > 0 || after.drift.length > 0 || after.unknown.length > 0 || after.gap) {
    throw new MigrationRefusal("DB_MIGRATION_LEDGER_UNVERIFIED", `pending=${after.pending.length} drift=${after.drift.length} unknown=${after.unknown.length} gap=${after.gap}`);
  }
  return { applied, skipped, ledger: after.applied, dryRun: false };
}
