/**
 * [B16-B, review finding] VERIFIED BASELINE ADOPTION for databases that
 * pre-date the migration ledger.
 *
 * Reproduced defect: every existing Sirkit database was built without any
 * migrator (journal 0000–0026 applied by hand / `db:push`, no ledger table),
 * so `migrateDatabase` would replay `0000` and fail with `relation "libraries"
 * already exists`, and `db:migrate:status` would report "applied 0 / pending
 * 29" on a database with 141 tables. The upgrade proof therefore only covered
 * databases the runner itself had created.
 *
 * Adoption is an EXPLICIT, VERIFIED operator act — never a guess:
 *  - the operator names the last migration the database was built through
 *    (`through`, e.g. `0026_parts_atomic_links`) and passes the literal
 *    confirmation `adopt_verified_baseline`;
 *  - the caller supplies the EXPECTED catalog of that prefix (the CLI obtains
 *    it by replaying the prefix into a disposable in-process PostgreSQL) and
 *    the set of tables that LATER migrations create;
 *  - the live catalog must contain every expected table and column (same type
 *    and nullability) and none of the later tables; constraint/index
 *    differences are RECORDED as divergences (a `db:push`-built database lacks
 *    the hand-written integrity constraints — see migration-delivery-contract.md
 *    §4) and returned, never hidden;
 *  - the ledger must be empty; the rows for the prefix are inserted in ONE
 *    transaction under the runner's advisory lock, with `runner_version`
 *    marking them as ADOPTED (not applied by this runner).
 * After adoption the ordinary `migrateDatabase` applies the remaining entries.
 */

import { MIGRATION_LEDGER_TABLE, MIGRATION_RUNNER_VERSION, type MigrationManifest } from "./manifest";
import { migrationStatus, type MigrationExecutor } from "./runner";
import { captureSchemaSnapshot, type SchemaSnapshot } from "./verify-schema";

export const BASELINE_CONFIRMATION = "adopt_verified_baseline" as const;
export const BASELINE_RUNNER_VERSION = `${MIGRATION_RUNNER_VERSION}/adopted-baseline` as const;

export interface BaselineAdoptionInput {
  manifest: MigrationManifest;
  /** The last manifest entry the database was built through (inclusive). */
  through: string;
  /** The catalog a fresh database has after exactly that prefix (from a disposable instance). */
  expected: SchemaSnapshot;
  /** Tables that migrations AFTER `through` create — none may exist yet. */
  laterTables: string[];
  confirmation: typeof BASELINE_CONFIRMATION;
  adoptedAt: string;
}

export interface BaselineAdoptionResult {
  adopted: string[];
  /** Constraint / index differences between the expected prefix catalog and the live one (recorded, not refused). */
  divergences: string[];
}

export type BaselineRefusalCode = "DB_MIGRATION_BASELINE_CONFIRMATION_REQUIRED" | "DB_MIGRATION_BASELINE_UNKNOWN" | "DB_MIGRATION_BASELINE_LEDGER_NOT_EMPTY" | "DB_MIGRATION_BASELINE_MISMATCH" | "DB_MIGRATION_BASELINE_LATER_OBJECTS_PRESENT";

export class BaselineRefusal extends Error {
  constructor(readonly code: BaselineRefusalCode, detail: string) { super(`${code}: ${detail}`); this.name = "BaselineRefusal"; }
}

/** Pure comparison of an expected prefix catalog with a live catalog. */
export function compareBaseline(expected: SchemaSnapshot, live: SchemaSnapshot, laterTables: string[]): { missing: string[]; changed: string[]; laterPresent: string[]; divergences: string[] } {
  const liveTables = new Set(live.tables.map((table) => table.name));
  const liveColumns = new Map(live.columns.map((column) => [`${column.table}.${column.name}`, column]));
  const missing: string[] = [];
  const changed: string[] = [];
  for (const table of expected.tables) if (!liveTables.has(table.name)) missing.push(`table:${table.name}`);
  for (const column of expected.columns) {
    const key = `${column.table}.${column.name}`;
    const found = liveColumns.get(key);
    if (!found) { if (liveTables.has(column.table)) missing.push(`column:${key}`); continue; }
    if (found.type !== column.type || found.nullable !== column.nullable) changed.push(`column:${key} expected ${column.type} ${column.nullable ? "NULL" : "NOT NULL"} live ${found.type} ${found.nullable ? "NULL" : "NOT NULL"}`);
  }
  const laterPresent = laterTables.filter((name) => liveTables.has(name)).map((name) => `table:${name}`);
  const keyed = (snapshot: SchemaSnapshot): Map<string, string> => new Map([
    ...snapshot.constraints.map((item): [string, string] => [`constraint:${item.table}.${item.name}`, item.definition]),
    ...snapshot.indexes.map((item): [string, string] => [`index:${item.table}.${item.name}`, item.definition.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ /, "")]),
  ]);
  const expectedKeyed = keyed(expected), liveKeyed = keyed(live);
  const divergences: string[] = [];
  for (const [key, definition] of expectedKeyed) {
    if (!liveKeyed.has(key)) divergences.push(`missing ${key}`);
    else if (liveKeyed.get(key) !== definition) divergences.push(`changed ${key}`);
  }
  for (const key of liveKeyed.keys()) if (!expectedKeyed.has(key) && !/^(constraint|index):sirkit_schema_migrations\./.test(key)) divergences.push(`extra ${key}`);
  return { missing, changed, laterPresent, divergences: divergences.sort() };
}

export async function adoptBaseline(executor: MigrationExecutor, input: BaselineAdoptionInput): Promise<BaselineAdoptionResult> {
  if (input.confirmation !== BASELINE_CONFIRMATION) throw new BaselineRefusal("DB_MIGRATION_BASELINE_CONFIRMATION_REQUIRED", `confirmation must be "${BASELINE_CONFIRMATION}"`);
  const index = input.manifest.entries.findIndex((entry) => entry.name === input.through);
  if (index < 0) throw new BaselineRefusal("DB_MIGRATION_BASELINE_UNKNOWN", input.through);
  const prefix = input.manifest.entries.slice(0, index + 1);
  const status = await migrationStatus(executor, input.manifest);
  if (status.applied.length > 0 || status.unknown.length > 0) throw new BaselineRefusal("DB_MIGRATION_BASELINE_LEDGER_NOT_EMPTY", `${status.applied.length + status.unknown.length} ledger rows exist — adoption is only for a database without a ledger`);
  const live = await captureSchemaSnapshot(executor);
  const comparison = compareBaseline(input.expected, live, input.laterTables);
  if (comparison.laterPresent.length > 0) throw new BaselineRefusal("DB_MIGRATION_BASELINE_LATER_OBJECTS_PRESENT", `${comparison.laterPresent.join(", ")} already exist — the database is past ${input.through}; name the correct baseline`);
  if (comparison.missing.length > 0 || comparison.changed.length > 0) throw new BaselineRefusal("DB_MIGRATION_BASELINE_MISMATCH", [...comparison.missing, ...comparison.changed].slice(0, 20).join("; "));
  await executor.transaction(async (tx) => {
    await tx.exec("SELECT pg_advisory_xact_lock(hashtext('sirkit_schema_migrations'))");
    const rows = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${MIGRATION_LEDGER_TABLE}"`);
    if (rows[0]?.n !== "0") throw new BaselineRefusal("DB_MIGRATION_BASELINE_LEDGER_NOT_EMPTY", "ledger changed concurrently");
    for (const entry of prefix) {
      await tx.query(`INSERT INTO "${MIGRATION_LEDGER_TABLE}" (name, checksum, applied_at, statement_count, runner_version) VALUES ($1, $2, $3, $4, $5)`, [entry.name, entry.checksum, input.adoptedAt, entry.statements.length, BASELINE_RUNNER_VERSION]);
    }
  });
  return { adopted: prefix.map((entry) => entry.name), divergences: comparison.divergences };
}
