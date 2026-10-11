/**
 * [B24-A4] Test-only emulation of the hosted platform's Data API roles (D24-3, OD-192; Lead note 7).
 *
 * The B16-B disposable instance has no `anon` role and grants `authenticated` only `project_members`
 * (`app/lib/db/disposable-postgres.ts:28-41`), so it cannot show what a Data API caller reaches. This helper creates `anon` and grants
 * both API roles schema usage and table-level SELECT/INSERT/UPDATE/DELETE on every table in `public` - the platform's documented
 * default grants, INFERRED from its documentation; the real project's grants and exposure stay UNKNOWN (LB-14). It is applied to a
 * PGlite instance only, never written into a migration (`b24-a4-rls-default-deny` refuses any GRANT under `drizzle/`).
 */
import type { DisposablePostgres } from "../../../db/disposable-postgres";

export const DATA_API_ROLES = ["anon", "authenticated"] as const;

export const DATA_API_GRANT_EMULATION_SQL = `
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
`;

/** Run `fn` under `SET ROLE <role>` on the instance's one session (RLS applies to a non-owner without BYPASSRLS), then reset. */
export async function asRole<T>(db: DisposablePostgres, role: string, fn: () => Promise<T>): Promise<T> {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("asRole: a plain role name");
  await db.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("RESET ROLE");
  }
}

/** Rows a role reads from one table (a count, never row content). */
export async function rowsSeenAs(db: DisposablePostgres, role: string, table: string): Promise<number> {
  return asRole(db, role, async () => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table.replaceAll('"', '""')}"`))[0]!.n);
}
