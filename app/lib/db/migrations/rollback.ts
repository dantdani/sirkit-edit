/**
 * [B24-A4] D24-2 offline, OD-193: a supported rollback of the NEWEST applied migration, by reviewed DOWN SQL.
 *
 * Where the DOWN SQL lives: `drizzle/rollback/<name>.down.sql`, never inside the forward file - every byte of a forward migration is
 * in its checksum and every non-comment chunk of it runs forward (manifest.ts `migrationChecksum`, `splitMigrationStatements`), so an
 * executable DOWN section inside it would run on the way up and, once edited, be `DB_MIGRATION_CHECKSUM_DRIFT` on every database
 * that applied it. `loadMigrationManifest` lists `.sql` files of `drizzle/` only, so it never reads the subdirectory.
 *
 * The rollback manifest binds each DOWN to its forward name and forward checksum and to its own checksum, with one class each:
 *  - `0031_rls_default_deny`: lossless (it disables row security again; no row is read or written);
 *  - `0030`..`0027`: requires empty - the DOWN runs only while no row holds what it would drop (a withdrawal event, a stored exact
 *    MPN, a server-derived BOM owner, a membership); otherwise `DB_ROLLBACK_DATA_PRESENT`;
 *  - `0000`..`0026`: forward-only - rollback means restore (app/lib/db/recovery/logical-dump.ts).
 *
 * `rollbackNewestMigration` runs ONE transaction under the runner's own advisory lock (so it never interleaves with a migrate) and
 * re-reads the ledger inside it. Before touching anything it refuses: the runner's drift, unknown-row and gap refusals
 * (`MigrationRefusal`), `DB_ROLLBACK_NOT_NEWEST`, `DB_ROLLBACK_FORWARD_ONLY`, `DB_ROLLBACK_BINDING_MISMATCH`,
 * `DB_ROLLBACK_DATA_PRESENT` (the table and a count, never row content) and, unless it is a dry run,
 * `DB_ROLLBACK_CONFIRMATION_REQUIRED` (the operator types `ROLLBACK_CONFIRMATION`). It then runs the DOWN and deletes the ledger row
 * together, and verifies that the ledger is the manifest prefix without that entry before the transaction commits.
 * An operator path only (scripts/db-migrate.ts `--rollback`): reachable from no route and no model-facing tool (runbook :156-157).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATION_LEDGER_TABLE, migrationChecksum, splitMigrationStatements, type MigrationManifest } from "./manifest";
import { MigrationRefusal, reconcileLedger, type MigrationExecutor, type MigrationLedgerRow, type MigrationStatementRunner } from "./runner";

/** The confirmation the operator types (`--confirm`); the CLI never supplies it itself. */
export const ROLLBACK_CONFIRMATION = "roll_back_newest_migration" as const;
/** The runner's own advisory-lock key (runner.ts `LOCK_KEY`): a rollback and a migrate never interleave. */
const LOCK_KEY = MIGRATION_LEDGER_TABLE;
export const ROLLBACK_DIRECTORY = join(process.cwd(), "drizzle", "rollback");

export type RollbackClass = "lossless" | "requires-empty";
export interface RollbackEmptyCheck {
  /** The table the DOWN would lose data of. */
  readonly table: string;
  /** A SQL predicate over that table's rows; any row matching it blocks the rollback. */
  readonly predicate: string;
  /** What must hold, in words (the refusal names it). */
  readonly condition: string;
}
export interface RollbackBinding {
  readonly name: string;
  readonly class: RollbackClass;
  readonly forwardChecksum: string;
  readonly down: string;
  readonly downChecksum: string;
  readonly emptyChecks: readonly RollbackEmptyCheck[];
}

/** Reviewed bindings, newest first. Extend ONLY with a reviewed entry (a new migration's DOWN, or none: forward-only). */
export const ROLLBACK_BINDINGS: readonly RollbackBinding[] = Object.freeze([
  {
    name: "0031_rls_default_deny",
    class: "lossless",
    forwardChecksum: "sha256:155cedf3a80d99f9228b7edb4b82b84a8c6666d1367104ad948c778c7ebb5d4e",
    down: "0031_rls_default_deny.down.sql",
    downChecksum: "sha256:dab715e0f3b0871851f8dc38309e89c4901ea3fdbef5309599615f119ddafeae",
    emptyChecks: [],
  },
  {
    name: "0030_atomic_revision_status_events",
    class: "requires-empty",
    forwardChecksum: "sha256:be4b577b801f3786e659acf7eb7075d37703651457da0b0963917bc5dcbd7aaa",
    down: "0030_atomic_revision_status_events.down.sql",
    downChecksum: "sha256:ff27114f5180124e465b8e26447464dd82a9cd3426c555babdc248ab2d2882e3",
    emptyChecks: [{ table: "atomic_revision_status_events", predicate: "true", condition: "atomic_revision_status_events holds no row" }],
  },
  {
    name: "0029_part_offers_mpn",
    class: "requires-empty",
    forwardChecksum: "sha256:47f67966e79cef50c836c8b1276b4816ba914f257b64409ffd298be6138857db",
    down: "0029_part_offers_mpn.down.sql",
    downChecksum: "sha256:308c5d38b43e6674c3ec830036b285365ff408cf83083964e821b5a260df8e50",
    emptyChecks: [{ table: "part_offers", predicate: "mpn IS NOT NULL", condition: "every part_offers.mpn is NULL" }],
  },
  {
    name: "0028_bom_project_ownership",
    class: "requires-empty",
    forwardChecksum: "sha256:ad91424b7f15455aed1db37424672abadd83a201f36e268b0c47f39d8b89cc60",
    down: "0028_bom_project_ownership.down.sql",
    downChecksum: "sha256:a9fe5d25feb2862693b5a291786cacc3b9b1f5d25245fcea5b4d6a48c87bec55",
    emptyChecks: [
      { table: "bom_snapshots", predicate: "tenant_id IS NOT NULL OR project_id IS NOT NULL OR branch_id IS NOT NULL", condition: "no bom_snapshots row has an ownership column set" },
      { table: "bom_notifications", predicate: "tenant_id IS NOT NULL OR project_id IS NOT NULL OR branch_id IS NOT NULL", condition: "no bom_notifications row has an ownership column set" },
    ],
  },
  {
    name: "0027_project_membership",
    class: "requires-empty",
    forwardChecksum: "sha256:100ddbd9375b4b45c64d77fc4d78dad895f08a705e7fb044c28424d1305ce0c0",
    down: "0027_project_membership.down.sql",
    downChecksum: "sha256:ea23bf6f058885c4b0658827b0474a04a6f5b70f97552bf7a14b6762c81e26e4",
    emptyChecks: [{ table: "project_members", predicate: "true", condition: "project_members holds no row" }],
  },
].map((binding) => Object.freeze({ ...binding, emptyChecks: Object.freeze(binding.emptyChecks.map((check) => Object.freeze(check))) }) as RollbackBinding));

export function rollbackClassOf(name: string): RollbackClass | "forward-only" {
  return ROLLBACK_BINDINGS.find((binding) => binding.name === name)?.class ?? "forward-only";
}

export type RollbackRefusalCode = "DB_ROLLBACK_NOT_NEWEST" | "DB_ROLLBACK_FORWARD_ONLY" | "DB_ROLLBACK_BINDING_MISMATCH" | "DB_ROLLBACK_DATA_PRESENT" | "DB_ROLLBACK_CONFIRMATION_REQUIRED" | "DB_ROLLBACK_LEDGER_UNVERIFIED";

export class RollbackRefusal extends Error {
  constructor(readonly code: RollbackRefusalCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "RollbackRefusal";
  }
}

export interface RollbackOptions {
  manifest: MigrationManifest;
  /** The migration to roll back: it must be the newest applied one. */
  name: string;
  /** The operator's typed confirmation (`ROLLBACK_CONFIRMATION`); not needed for a dry run. */
  confirmation: string | null;
  /** Plan only: every check runs, nothing is changed. */
  dryRun?: boolean;
  /** Test seam: called before each DOWN statement, inside the transaction (may throw to simulate an interruption). */
  beforeStatement?(binding: RollbackBinding, index: number, tx: MigrationStatementRunner): Promise<void> | void;
  /** Test seam: the bindings (default `ROLLBACK_BINDINGS`). */
  bindings?: readonly RollbackBinding[];
  /** Test seam: a DOWN file's text by its file name, or null when absent (default: read from `drizzle/rollback/`). */
  readDown?(file: string): string | null;
}

export interface RollbackResult {
  name: string;
  class: RollbackClass;
  /** The DOWN's statement count. */
  statements: number;
  dryRun: boolean;
  /** The ledger as the rollback leaves it (a dry run: as it would leave it). */
  ledger: MigrationLedgerRow[];
}

function readDownFile(file: string): string | null {
  const path = join(ROLLBACK_DIRECTORY, file);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

async function readLedger(runner: MigrationStatementRunner): Promise<MigrationLedgerRow[]> {
  const present = (await runner.query<{ present: boolean }>(`SELECT to_regclass('public.${MIGRATION_LEDGER_TABLE}') IS NOT NULL AS present`))[0]?.present === true;
  if (!present) return [];
  const rows = await runner.query<MigrationLedgerRow>(`SELECT name, checksum, applied_at::text AS applied_at, statement_count, runner_version FROM "${MIGRATION_LEDGER_TABLE}" ORDER BY name`);
  return rows.map((row) => ({ ...row, statement_count: Number(row.statement_count) }));
}

function refuseOnInconsistency(manifest: MigrationManifest, ledger: MigrationLedgerRow[]): MigrationLedgerRow[] {
  const status = reconcileLedger(manifest, ledger);
  if (status.drift.length > 0) throw new MigrationRefusal("DB_MIGRATION_CHECKSUM_DRIFT", status.drift.map((item) => `${item.name} ledger=${item.ledgerChecksum} file=${item.fileChecksum}`).join("; "));
  if (status.unknown.length > 0) throw new MigrationRefusal("DB_MIGRATION_LEDGER_UNKNOWN", status.unknown.map((row) => row.name).join(", "));
  if (status.gap) throw new MigrationRefusal("DB_MIGRATION_LEDGER_GAP", "applied migrations are not a prefix of the manifest");
  return status.applied;
}

/** Roll back the newest applied migration by its reviewed DOWN, in one transaction with its ledger row (see the module header). */
export async function rollbackNewestMigration(executor: MigrationExecutor, options: RollbackOptions): Promise<RollbackResult> {
  const { manifest, name } = options;
  const bindings = options.bindings ?? ROLLBACK_BINDINGS;
  const readDown = options.readDown ?? readDownFile;
  return executor.transaction(async (tx) => {
    await tx.exec(`SELECT pg_advisory_xact_lock(hashtext('${LOCK_KEY}'))`);
    const applied = refuseOnInconsistency(manifest, await readLedger(tx));
    const appliedNames = new Set(applied.map((row) => row.name));
    const newestIndex = manifest.entries.reduce((last, entry, index) => (appliedNames.has(entry.name) ? index : last), -1);
    const newest = newestIndex >= 0 ? manifest.entries[newestIndex]! : null;
    if (!newest || newest.name !== name) throw new RollbackRefusal("DB_ROLLBACK_NOT_NEWEST", `${name} is not the newest applied migration (newest applied: ${newest?.name ?? "none"}); only the newest can be rolled back`);
    const binding = bindings.find((candidate) => candidate.name === name);
    if (!binding) throw new RollbackRefusal("DB_ROLLBACK_FORWARD_ONLY", `${name} is forward-only: it has no reviewed DOWN; the way back is a restore (app/lib/db/recovery/logical-dump.ts)`);
    if (binding.forwardChecksum !== newest.checksum) throw new RollbackRefusal("DB_ROLLBACK_BINDING_MISMATCH", `${name}'s DOWN is bound to another forward file (bound ${binding.forwardChecksum}, file ${newest.checksum})`);
    const text = readDown(binding.down);
    if (text === null) throw new RollbackRefusal("DB_ROLLBACK_BINDING_MISMATCH", `${name}'s DOWN file drizzle/rollback/${binding.down} is missing`);
    if (migrationChecksum(text) !== binding.downChecksum) throw new RollbackRefusal("DB_ROLLBACK_BINDING_MISMATCH", `${name}'s DOWN file changed after review (bound ${binding.downChecksum}, file ${migrationChecksum(text)})`);
    const statements = splitMigrationStatements(text);
    if (statements.length === 0) throw new RollbackRefusal("DB_ROLLBACK_BINDING_MISMATCH", `${name}'s DOWN file has no statement`);
    for (const check of binding.emptyChecks) {
      const rows = Number((await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM public."${check.table}" WHERE ${check.predicate}`))[0]?.n ?? "0");
      if (rows > 0) throw new RollbackRefusal("DB_ROLLBACK_DATA_PRESENT", `${name} needs ${check.condition}; ${check.table}: ${rows} row(s) would be lost - the way back is a restore`);
    }
    const remaining = applied.filter((row) => row.name !== name);
    if (options.dryRun) return { name, class: binding.class, statements: statements.length, dryRun: true, ledger: remaining };
    if (options.confirmation !== ROLLBACK_CONFIRMATION) throw new RollbackRefusal("DB_ROLLBACK_CONFIRMATION_REQUIRED", `type --confirm ${ROLLBACK_CONFIRMATION} to roll back ${name}`);
    for (let index = 0; index < statements.length; index += 1) {
      await options.beforeStatement?.(binding, index, tx);
      await tx.exec(statements[index]!);
    }
    await tx.query(`DELETE FROM "${MIGRATION_LEDGER_TABLE}" WHERE name = $1`, [name]);
    const after = await readLedger(tx);
    const expected = manifest.entries.slice(0, newestIndex).map((entry) => entry.name);
    const status = reconcileLedger(manifest, after);
    if (status.drift.length > 0 || status.unknown.length > 0 || status.gap || status.applied.map((row) => row.name).join(",") !== expected.join(",")) {
      throw new RollbackRefusal("DB_ROLLBACK_LEDGER_UNVERIFIED", `after the DOWN the ledger is not the manifest prefix through ${expected.at(-1) ?? "nothing"}`);
    }
    return { name, class: binding.class, statements: statements.length, dryRun: false, ledger: status.applied };
  });
}
