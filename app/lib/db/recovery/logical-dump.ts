/**
 * [B24-A4] D24-7 offline, OD-194: an in-repository logical dump and restore, proven on PGlite (`b24-a4-restore`).
 *
 * Why not `pg_dump`: no dump tool ships with the dependencies (`@electric-sql/pglite` 0.4.6, `postgres` ^3.4.9) and OD-42 forbids
 * adding one. `pg_dump`/`pg_restore` and the platform's own backups and point-in-time recovery stay the owner's steps; a real-server
 * backup and restore is BLOCKED-LIVE-QUALIFICATION (LB-14).
 *
 * The dump (`sirkit.db-logical-dump.v1`) holds the schema fingerprint, the migration ledger (name and checksum), the session settings
 * that shape the rows' text, and for every `public` table but the ledger: its row count, the SHA-256 of its rows, and the rows as the
 * database's own JSON text (`row_to_json(t)::text`) - no value passes through a JavaScript number. Rows are ordered by the primary
 * key where the table has one (its columns' text under `COLLATE "C"`) and otherwise by the row's JSON text under `COLLATE "C"`
 * (42 of the 143 tables have no primary key), so equal rows dump to equal digests whatever their insertion order or the server's
 * collation. A role that row security may hide rows from is refused `DB_DUMP_ROWS_HIDDEN` before any row is read (`DumpRefusal`,
 * at the end of this file; [B24-A4 review, 2026-10-08]): after 0031 it would read an empty ledger and empty tables.
 *
 * The restore refuses `DB_RESTORE_TARGET_NOT_EMPTY` unless no `public` table holds a row (`publicTablesHoldingRows`, the guard's
 * strict predicate - the claim marker is never a reason to accept a restore target); refuses `DB_RESTORE_SCHEMA_MISMATCH` unless the
 * dump's ledger is a prefix of the manifest and the target's ledger a prefix of the dump's, then migrates the target through exactly
 * the dump's ledger and requires the dump's fingerprint and tables; loads every table in foreign-key order in ONE transaction with the
 * deferrable keys deferred (`json_populate_recordset`); and verifies the fingerprint, the counts and the digests, refusing
 * `DB_RESTORE_DIGEST_MISMATCH` - before any write when the envelope already shows the mismatch, otherwise by rolling the load back.
 * Works over a `MigrationStatementRunner` (the restore needs an executor's transaction); imports no network package and no PGlite;
 * reachable from no route; no CLI (an operator step, recorded on database-and-recovery.md).
 */

import { createHash } from "node:crypto";
import { MIGRATION_LEDGER_TABLE, truncateManifest, type MigrationManifest } from "../migrations/manifest";
import { migrateDatabase, type MigrationExecutor, type MigrationStatementRunner } from "../migrations/runner";
import { captureSchemaSnapshot, schemaFingerprint } from "../migrations/verify-schema";
import { publicTablesHoldingRows, tablesRowSecurityMayHide } from "../qualification-target";

export const LOGICAL_DUMP_SCHEMA = "sirkit.db-logical-dump.v1" as const;
/** The settings that shape `row_to_json`'s text (time zone, date, interval, bytea and float output), recorded with the dump. */
export const DUMP_SETTINGS = ["TimeZone", "DateStyle", "IntervalStyle", "bytea_output", "extra_float_digits"] as const;

export interface LogicalDumpTable {
  readonly name: string;
  readonly order: "primary-key" | "row-text";
  readonly rows: number;
  /** SHA-256 (hex) of the rows, each followed by a line feed. */
  readonly sha256: string;
  /** The rows as the database's own JSON text, in dump order. */
  readonly data: readonly string[];
}
export interface LogicalDump {
  readonly schema: typeof LOGICAL_DUMP_SCHEMA;
  readonly fingerprint: string;
  readonly settings: Readonly<Record<(typeof DUMP_SETTINGS)[number], string>>;
  readonly ledger: ReadonlyArray<{ readonly name: string; readonly checksum: string }>;
  readonly tables: readonly LogicalDumpTable[];
}

export type RestoreRefusalCode = "DB_RESTORE_TARGET_NOT_EMPTY" | "DB_RESTORE_SCHEMA_MISMATCH" | "DB_RESTORE_DIGEST_MISMATCH";
export class RestoreRefusal extends Error {
  constructor(readonly code: RestoreRefusalCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "RestoreRefusal";
  }
}

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const rowsDigest = (rows: readonly string[]): string => createHash("sha256").update(rows.map((row) => `${row}\n`).join("")).digest("hex");

async function publicTables(runner: MigrationStatementRunner): Promise<string[]> {
  return (await runner.query<{ relname: string }>("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> $1 ORDER BY c.relname COLLATE \"C\"", [MIGRATION_LEDGER_TABLE])).map((row) => row.relname);
}

async function primaryKeyColumns(runner: MigrationStatementRunner, table: string): Promise<string[]> {
  return (await runner.query<{ attname: string }>(
    "SELECT a.attname FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum WHERE i.indisprimary AND n.nspname = 'public' AND c.relname = $1 ORDER BY k.ord",
    [table],
  )).map((row) => row.attname);
}

async function ledgerOf(runner: MigrationStatementRunner): Promise<Array<{ name: string; checksum: string }>> {
  const present = (await runner.query<{ present: boolean }>(`SELECT to_regclass('public.${MIGRATION_LEDGER_TABLE}') IS NOT NULL AS present`))[0]?.present === true;
  if (!present) return [];
  return (await runner.query<{ name: string; checksum: string }>(`SELECT name, checksum FROM "${MIGRATION_LEDGER_TABLE}" ORDER BY name COLLATE "C"`)).map((row) => ({ name: row.name, checksum: row.checksum }));
}

/** Dump every `public` table (the ledger aside) of the database `runner` reads, as described in the module header. */
export async function createLogicalDump(runner: MigrationStatementRunner): Promise<LogicalDump> {
  await refuseHiddenRows(runner); // [B24-A4 review, 2026-10-08] before any row is read: after 0031 a weak role would dump nothing
  const settings = {} as Record<(typeof DUMP_SETTINGS)[number], string>;
  for (const name of DUMP_SETTINGS) settings[name] = (await runner.query<{ value: string }>("SELECT current_setting($1) AS value", [name]))[0]!.value; // one at a time: a transaction's session runs one statement
  const tables: LogicalDumpTable[] = [];
  for (const name of await publicTables(runner)) {
    const key = await primaryKeyColumns(runner, name);
    const orderBy = key.length > 0 ? key.map((column) => `t.${quoted(column)}::text COLLATE "C"`).join(", ") : `row_to_json(t)::text COLLATE "C"`;
    const data = (await runner.query<{ row: string }>(`SELECT row_to_json(t)::text AS row FROM public.${quoted(name)} AS t ORDER BY ${orderBy}`)).map((row) => row.row);
    tables.push({ name, order: key.length > 0 ? "primary-key" : "row-text", rows: data.length, sha256: rowsDigest(data), data });
  }
  return { schema: LOGICAL_DUMP_SCHEMA, fingerprint: schemaFingerprint(await captureSchemaSnapshot(runner)), settings, ledger: await ledgerOf(runner), tables };
}

/** What the envelope itself shows wrong, before anything is written (digests and counts only; never a row's content). */
function envelopeProblems(dump: LogicalDump): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const table of dump.tables) {
    if (seen.has(table.name)) problems.push(`${table.name}: listed twice`);
    seen.add(table.name);
    if (!Array.isArray(table.data) || table.data.some((row) => typeof row !== "string")) { problems.push(`${table.name}: rows are not text`); continue; }
    if (table.rows !== table.data.length) problems.push(`${table.name}: ${table.rows} rows stated, ${table.data.length} present`);
    if (rowsDigest(table.data) !== table.sha256) problems.push(`${table.name}: the rows do not hash to the stated digest`);
  }
  return problems;
}

/** Tables in foreign-key order (a referenced table before its referrer), over the keys that are checked per statement; name order breaks ties. */
async function foreignKeyOrder(runner: MigrationStatementRunner, tables: readonly string[]): Promise<string[]> {
  const edges = await runner.query<{ child: string; parent: string }>(
    "SELECT DISTINCT ch.relname AS child, pa.relname AS parent FROM pg_constraint c JOIN pg_class ch ON ch.oid = c.conrelid JOIN pg_class pa ON pa.oid = c.confrelid JOIN pg_namespace n ON n.oid = ch.relnamespace WHERE c.contype = 'f' AND n.nspname = 'public' AND NOT c.condeferrable AND ch.relname <> pa.relname",
  );
  const pending = new Map(tables.map((table) => [table, new Set(edges.filter((edge) => edge.child === table && tables.includes(edge.parent)).map((edge) => edge.parent))]));
  const order: string[] = [];
  while (pending.size > 0) {
    const ready = [...pending.entries()].filter(([, parents]) => [...parents].every((parent) => !pending.has(parent))).map(([table]) => table).sort();
    if (ready.length === 0) throw new RestoreRefusal("DB_RESTORE_SCHEMA_MISMATCH", "the schema's non-deferrable foreign keys form a cycle; a table-by-table load cannot order it");
    for (const table of ready) { order.push(table); pending.delete(table); }
  }
  return order;
}

const LOAD_CHUNK_ROWS = 500;

/** Restore `dump` into the empty database `executor` opens, as described in the module header. */
export async function restoreLogicalDump(executor: MigrationExecutor, dump: LogicalDump, options: { manifest: MigrationManifest }): Promise<{ tables: number; rows: number }> {
  if (dump.schema !== LOGICAL_DUMP_SCHEMA) throw new RestoreRefusal("DB_RESTORE_SCHEMA_MISMATCH", `the dump is not ${LOGICAL_DUMP_SCHEMA}`);
  const envelope = envelopeProblems(dump);
  if (envelope.length > 0) throw new RestoreRefusal("DB_RESTORE_DIGEST_MISMATCH", `the dump's envelope does not hold: ${envelope.slice(0, 5).join("; ")}`);
  const hidden = await tablesRowSecurityMayHide(executor);
  if (hidden.length > 0) throw new RestoreRefusal("DB_RESTORE_TARGET_NOT_EMPTY", `row security may hide the rows of ${hidden.length} public table(s) from this role, so the target's emptiness cannot be read - restore as the tables' owner`);
  const holding = await publicTablesHoldingRows(executor);
  if (holding.length > 0) throw new RestoreRefusal("DB_RESTORE_TARGET_NOT_EMPTY", `${holding.length} public table(s) of the target hold rows (${holding.slice(0, 10).map((item) => `${item.table}: ${item.rows}`).join(", ")}) - restore only into an empty database`);
  // the schema: the dump's ledger must be the manifest's own prefix, and the target's the dump's
  const { manifest } = options;
  const prefix = manifest.entries.slice(0, dump.ledger.length);
  if (prefix.length !== dump.ledger.length || dump.ledger.some((row, index) => row.name !== prefix[index]!.name || row.checksum !== prefix[index]!.checksum)) throw new RestoreRefusal("DB_RESTORE_SCHEMA_MISMATCH", "the dump's ledger is not a prefix of this manifest (a migration it names is unknown here, or its checksum differs)");
  const targetLedger = await ledgerOf(executor);
  if (targetLedger.length > dump.ledger.length || targetLedger.some((row, index) => row.name !== dump.ledger[index]!.name || row.checksum !== dump.ledger[index]!.checksum)) throw new RestoreRefusal("DB_RESTORE_SCHEMA_MISMATCH", `the target's ledger (${targetLedger.length} migrations) has passed or left the dump's (${dump.ledger.length})`);
  await migrateDatabase(executor, { manifest: truncateManifest(manifest, dump.ledger.length) });
  const migratedLedger = await ledgerOf(executor);
  const fingerprint = schemaFingerprint(await captureSchemaSnapshot(executor));
  const tables = await publicTables(executor);
  if (JSON.stringify(migratedLedger) !== JSON.stringify(dump.ledger) || fingerprint !== dump.fingerprint || JSON.stringify(tables) !== JSON.stringify(dump.tables.map((table) => table.name))) {
    throw new RestoreRefusal("DB_RESTORE_SCHEMA_MISMATCH", "after migrating through the dump's ledger the target's schema is not the dump's (fingerprint or tables differ)");
  }
  const byName = new Map(dump.tables.map((table) => [table.name, table]));
  return executor.transaction(async (tx) => {
    for (const name of DUMP_SETTINGS) await tx.query("SELECT set_config($1, $2, true)", [name, dump.settings[name]]);
    await tx.exec("SET CONSTRAINTS ALL DEFERRED");
    let rows = 0;
    for (const name of await foreignKeyOrder(tx, tables)) {
      const table = byName.get(name)!;
      for (let start = 0; start < table.data.length; start += LOAD_CHUNK_ROWS) {
        const chunk = table.data.slice(start, start + LOAD_CHUNK_ROWS);
        await tx.query(`INSERT INTO public.${quoted(name)} SELECT * FROM json_populate_recordset(NULL::public.${quoted(name)}, $1::json)`, [`[${chunk.join(",")}]`]);
      }
      rows += table.data.length;
    }
    await tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
    const copy = await createLogicalDump(tx);
    const mismatched = dump.tables.filter((table, index) => copy.tables[index]?.name !== table.name || copy.tables[index]!.rows !== table.rows || copy.tables[index]!.sha256 !== table.sha256).map((table) => table.name);
    if (copy.fingerprint !== dump.fingerprint || mismatched.length > 0) throw new RestoreRefusal("DB_RESTORE_DIGEST_MISMATCH", `the loaded rows do not reproduce the dump (${mismatched.slice(0, 10).join(", ") || "the fingerprint"}); the load was rolled back`);
    return { tables: dump.tables.length, rows };
  });
}

/** [B24-A4 review, 2026-10-08] A dump that row security would empty: the connecting role is neither superuser nor BYPASSRLS, and some
 *  `public` table - the migration ledger included - has row security under another owner, or FORCEd on its own (0031 enables it on
 *  every table but `project_members`, with no policy). Such a role reads zero rows and an empty ledger, and the dump would still look
 *  valid; it is refused before any row is read. Dump as the tables' owner (no FORCE) or as a BYPASSRLS role. */
export class DumpRefusal extends Error {
  readonly code = "DB_DUMP_ROWS_HIDDEN" as const;
  constructor(detail: string) {
    super(`DB_DUMP_ROWS_HIDDEN: ${detail}`);
    this.name = "DumpRefusal";
  }
}

async function refuseHiddenRows(runner: MigrationStatementRunner): Promise<void> {
  const hidden = await tablesRowSecurityMayHide(runner);
  if (hidden.length > 0) throw new DumpRefusal(`row security may hide the rows of ${hidden.length} public table(s) from this role (${hidden.slice(0, 5).join(", ")}${hidden.length > 5 ? ", ..." : ""}), so the dump would be empty - dump as the tables' owner or a BYPASSRLS role`);
}
