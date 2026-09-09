/**
 * [B16-B] Disposable in-process PostgreSQL for the deterministic migration
 * tests: PGlite (real PostgreSQL 17 compiled to WASM, single connection,
 * superuser session) with the extensions the migrations use (pgvector,
 * pg_trgm, pgcrypto) and the PLATFORM SHIMS the migrations assume exist on
 * Supabase and never create themselves:
 *
 *  - `CREATE EXTENSION vector` (0000 declares `vector(1536)` columns);
 *  - schema `auth` + `auth.uid()` reading `request.jwt.claim.sub` (0027's
 *    RLS policy; the same contract Supabase's function exposes);
 *  - role `authenticated` (0027's `TO authenticated`).
 *
 * These shims are documented as shims: the tests prove the MIGRATIONS and
 * the executable RLS/CHECK behaviour, not the Supabase platform. A real
 * server run stays opt-in (`SIRKIT_DB_QUALIFICATION=1`).
 *
 * PGlite is a devDependency: this module is imported by the test suites and by
 * the operator CLI (`scripts/db-migrate.ts`, to compute a verified baseline),
 * never by a route or any production bundle.
 */

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite/vector";
import type { MigrationExecutor, MigrationStatementRunner } from "./migrations/runner";

export const PLATFORM_SHIM_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;
`;

/** Supabase grants the API roles usage/select on public objects by default; the shim grants only what the RLS test needs. */
export const PLATFORM_GRANT_SQL = `
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_members TO authenticated;
`;

function runnerFor(db: PGlite | Transaction): MigrationStatementRunner {
  return {
    async exec(sql) { await db.exec(sql); },
    async query(sql, params = []) { return (await db.query(sql, params as never)).rows as never; },
  };
}

export interface DisposablePostgres extends MigrationExecutor {
  db: PGlite;
  /** Run `fn` as the `authenticated` role with the given JWT subject (RLS applies), restoring the superuser afterwards. */
  asAuthenticated<T>(subject: string | null, fn: (runner: MigrationStatementRunner) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function disposablePostgres(options: { shims?: boolean } = {}): Promise<DisposablePostgres> {
  const db = new PGlite({ extensions: { vector, pg_trgm, pgcrypto } });
  await db.waitReady;
  if (options.shims !== false) await db.exec(PLATFORM_SHIM_SQL);
  const base = runnerFor(db);
  return {
    ...base,
    db,
    async transaction(fn) {
      return db.transaction(async (tx) => fn(runnerFor(tx))) as Promise<never>;
    },
    async asAuthenticated(subject, fn) {
      await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${subject ?? ""}', false);`);
      try { return await fn(base); } finally { await db.exec("RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);"); }
    },
    async close() { await db.close(); },
  };
}
