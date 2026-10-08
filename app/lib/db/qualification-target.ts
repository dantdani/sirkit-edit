/**
 * [B24-A4] D24-12, OD-191, OD-201: the shared test-data guard (runbook :1044 "Never reuse production data in tests.").
 *
 * A database-gated suite awaits `claimQualificationTarget` (or, holding an executor already, `requireDisposableQualificationTarget`)
 * before its first database statement, read or write. A target is accepted in two cases only:
 *  - it already carries the claim marker - a row in `sirkit_qualification.claim`, a schema outside `public`, so no schema fingerprint
 *    and no `public` table count moves (`b16-b-postgres-qualification.test.ts:35-36` counts `public` tables only);
 *  - no `public` table holds a row (`publicTablesHoldingRows`, the migration ledger excepted) - and then it is claimed.
 * "Empty" is "empty when this database was first claimed" (Lead note 4): the bounded footprint ingest that `ingest-integrity` needs,
 * and every re-run on the same database, find a claimed target. Anything else - an unclaimed target holding rows, or one whose rows
 * row security may hide from the connecting role - is refused `DB_QUALIFICATION_TARGET_NOT_EMPTY` before any write; the refusal names
 * tables and counts, never row content or the URL. The claim runs in one transaction under
 * `pg_advisory_xact_lock(hashtext('sirkit_qualification_claim'))` and re-reads the marker and the rows inside the lock, so two workers
 * claiming one empty target never race `CREATE SCHEMA/TABLE IF NOT EXISTS` (the hazard `runner.ts` avoids the same way); the claim
 * row is a singleton, so an interleaved second claim adds nothing. A caller that migrates from nothing passes `requireNoPublicTable`,
 * so a target holding any `public` table is refused inside the lock before the claim is read or written. Row security "may hide"
 * rows from a role without superuser or BYPASSRLS on another owner's table, and on its own table when row security is FORCEd.
 *
 * Reachable from no route; imports neither PGlite nor the disposable instance, so the gated suites stay in their CI jobs
 * (b19-e-ci-job-scope.test.ts); the postgres-js executor only inside `claimQualificationTarget`; reads no environment variable
 * itself (callers pass the URL and the driver's facts).
 * `acceptanceDriverRefusal` is the acceptance driver's start check (scripts/e2e-prompt-to-gerber.ts), pure over what it is given.
 */

import { isLoopbackDatabaseUrl } from "./connection-security";
import { MIGRATION_LEDGER_TABLE } from "./migrations/manifest";
import type { MigrationExecutor, MigrationStatementRunner } from "./migrations/runner";

export const QUALIFICATION_CLAIM_SCHEMA = "sirkit_qualification" as const;
export const QUALIFICATION_CLAIM_MARKER = "sirkit.db-qualification-claim.v1" as const;
export const QUALIFICATION_CLAIM_LOCK_KEY = "sirkit_qualification_claim" as const;
export type QualificationClaimOutcome = "claimed" | "already-claimed";

export class QualificationTargetRefusal extends Error {
  readonly code = "DB_QUALIFICATION_TARGET_NOT_EMPTY" as const;
  constructor(detail: string, readonly holding: ReadonlyArray<{ readonly table: string; readonly rows: number }>) {
    super(`DB_QUALIFICATION_TARGET_NOT_EMPTY: ${detail}`);
    this.name = "QualificationTargetRefusal";
  }
}

const quoted = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** The strict predicate: every `public` table holding a row (the migration ledger excepted), with its count - never a row's content. */
export async function publicTablesHoldingRows(runner: MigrationStatementRunner): Promise<Array<{ table: string; rows: number }>> {
  const tables = await runner.query<{ relname: string }>("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> $1 ORDER BY c.relname COLLATE \"C\"", [MIGRATION_LEDGER_TABLE]);
  const holding: Array<{ table: string; rows: number }> = [];
  for (const { relname } of tables) {
    const rows = Number((await runner.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.${quoted(relname)}`))[0]?.n ?? "0");
    if (rows > 0) holding.push({ table: relname, rows });
  }
  return holding;
}

/** `public` tables whose rows row security may hide from the connecting role: RLS on, no superuser or BYPASSRLS, and another owner -
 *  or the role's own table with row security FORCEd, which binds the owner too ([B24-A4 review, 2026-10-08]: FORCE was not read). */
export async function tablesRowSecurityMayHide(runner: MigrationStatementRunner): Promise<string[]> {
  const rows = await runner.query<{ relname: string }>(
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND (c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user) OR c.relforcerowsecurity) AND NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) ORDER BY c.relname COLLATE \"C\"",
  );
  return rows.map((row) => row.relname);
}

async function claimed(runner: MigrationStatementRunner): Promise<boolean> {
  const present = (await runner.query<{ present: boolean }>(`SELECT to_regclass('${QUALIFICATION_CLAIM_SCHEMA}.claim') IS NOT NULL AS present`))[0]?.present === true;
  if (!present) return false;
  return Number((await runner.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${QUALIFICATION_CLAIM_SCHEMA}.claim WHERE marker = $1`, [QUALIFICATION_CLAIM_MARKER]))[0]?.n ?? "0") > 0;
}

export interface QualificationClaimSeams {
  /** Test seam: called inside the claim's transaction after the checks and before its writes (to interleave another claim). */
  beforeClaimWrite?(tx: MigrationStatementRunner): Promise<void> | void;
  /** A stricter precondition for a caller that migrates from nothing (b16-b-postgres-qualification): the target holds no `public`
   *  table at all, checked inside the lock before the claim is read or written, so a migrated but row-free target is refused
   *  unclaimed ([B24-A4 review, 2026-10-08]: the claim was written first and the caller's own check refused afterwards). */
  requireNoPublicTable?: boolean;
}

/** The guard over an executor the caller holds (it needs `transaction()`, which `MigrationStatementRunner` lacks). */
export async function requireDisposableQualificationTarget(executor: MigrationExecutor, label: string, seams: QualificationClaimSeams = {}): Promise<{ outcome: QualificationClaimOutcome }> {
  return executor.transaction(async (tx) => {
    await tx.exec(`SELECT pg_advisory_xact_lock(hashtext('${QUALIFICATION_CLAIM_LOCK_KEY}'))`);
    if (seams.requireNoPublicTable) {
      const tables = Number((await tx.query<{ n: string }>("SELECT count(*)::text AS n FROM pg_tables WHERE schemaname = 'public'"))[0]?.n ?? "0");
      if (tables > 0) throw new QualificationTargetRefusal(`${label} holds ${tables} public table(s) and this qualification migrates from nothing - point it at an EMPTY disposable database (no table in public)`, []);
    }
    if (await claimed(tx)) return { outcome: "already-claimed" as const };
    const hidden = await tablesRowSecurityMayHide(tx);
    if (hidden.length > 0) throw new QualificationTargetRefusal(`${label} is unclaimed and row security may hide the rows of ${hidden.length} public table(s) from this role (${hidden.slice(0, 5).join(", ")}${hidden.length > 5 ? ", ..." : ""}), so its emptiness cannot be read - connect as the tables' owner or claim an empty disposable database`, []);
    const holding = await publicTablesHoldingRows(tx);
    if (holding.length > 0) throw new QualificationTargetRefusal(`${label} is unclaimed and ${holding.length} public table(s) hold rows (${holding.slice(0, 10).map((item) => `${item.table}: ${item.rows}`).join(", ")}${holding.length > 10 ? ", ..." : ""}) - point the qualification at an empty disposable database`, holding);
    await seams.beforeClaimWrite?.(tx);
    await tx.exec(`CREATE SCHEMA IF NOT EXISTS ${QUALIFICATION_CLAIM_SCHEMA}`);
    await tx.exec(`CREATE TABLE IF NOT EXISTS ${QUALIFICATION_CLAIM_SCHEMA}.claim (claim_key smallint PRIMARY KEY DEFAULT 1 CHECK (claim_key = 1), label text NOT NULL, marker text NOT NULL, claimed_at timestamp with time zone NOT NULL DEFAULT now())`);
    await tx.query(`INSERT INTO ${QUALIFICATION_CLAIM_SCHEMA}.claim (label, marker) VALUES ($1, $2) ON CONFLICT (claim_key) DO NOTHING`, [label, QUALIFICATION_CLAIM_MARKER]);
    return { outcome: "claimed" as const };
  });
}

/** The guard over a URL: opens `createPostgresMigrationExecutor(url)` (so the TLS rule applies), runs the guard, closes the connection. */
export async function claimQualificationTarget(url: string, label: string): Promise<{ outcome: QualificationClaimOutcome }> {
  // imported here, not at the top: the strict predicate above is the restore's too (recovery/logical-dump.ts), which reaches no network package
  const { createPostgresMigrationExecutor } = await import("./migrations/postgres-executor");
  const executor = createPostgresMigrationExecutor(url);
  try {
    return await requireDisposableQualificationTarget(executor, label);
  } finally {
    await executor.close();
  }
}

export const DISPOSABLE_TARGET_FLAG = "--disposable-target" as const;
export type AcceptanceDriverRefusalCode = "E2E_DISPOSABLE_TARGET_REQUIRED" | "E2E_BASE_URL_NOT_LOOPBACK" | "E2E_CATALOG_DATABASE_NOT_LOOPBACK";

function loopbackHttp(base: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const name = parsed.hostname.toLowerCase();
  return name === "localhost" || name === "[::1]" || /^127\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/.test(name);
}

/**
 * The acceptance driver starts only against a disposable target (OD-201, narrowed - OD-226): it is invoked with
 * `--disposable-target`, its base URL is loopback, and its own catalog read cannot reach a non-loopback database - the fixture
 * runtime serves it (parts-search.ts) or the driver's `DATABASE_URL` is unset or loopback by `databaseTls`'s loopback rule. The
 * server's own database is not checked (no route reports it) and stays the operator's (BLOCKED-LIVE-QUALIFICATION, LB-14).
 * Pure: the driver passes every fact; no refusal echoes a URL.
 */
export function acceptanceDriverRefusal(argv: readonly string[], baseUrl: string, catalog: { readonly fixtureRuntime: boolean; readonly databaseUrl: string | undefined }): { code: AcceptanceDriverRefusalCode; message: string } | null {
  if (!argv.includes(DISPOSABLE_TARGET_FLAG)) return { code: "E2E_DISPOSABLE_TARGET_REQUIRED", message: `the acceptance driver writes to the server's database; run it only against a disposable target and say so with ${DISPOSABLE_TARGET_FLAG}` };
  if (!loopbackHttp(baseUrl)) return { code: "E2E_BASE_URL_NOT_LOOPBACK", message: "the driver's base URL is not an http(s) URL on loopback; start a local server on a disposable database" };
  if (!catalog.fixtureRuntime && catalog.databaseUrl !== undefined && catalog.databaseUrl !== "") {
    let loopback = false;
    try {
      loopback = isLoopbackDatabaseUrl(catalog.databaseUrl);
    } catch {
      loopback = false;
    }
    if (!loopback) return { code: "E2E_CATALOG_DATABASE_NOT_LOOPBACK", message: "the driver's own catalog read would use a database off loopback; enable the fixture runtime or unset that URL in the driver's environment" };
  }
  return null;
}
