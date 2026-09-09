/**
 * B16-B item 5 (LB-4) — explicit qualification marker for DB-backed tests.
 *
 * WHY THIS EXISTS
 *   The default deterministic suite must never depend on the developer's
 *   environment. The owner's `.env.local` points at a Supabase project that no
 *   longer resolves; a test that loaded `.env.local` and gated on `DATABASE_URL`
 *   turned that dead network dependency into a "functional" failure of the
 *   default `pnpm test` run ("PostgresError: (ENOTFOUND) tenant/user … not
 *   found"). Other DB tests each invented a private env name
 *   (`R03_B06_DATABASE_URL`, `R05_RC01_DATABASE_URL`, …), so there was no single
 *   switch that says "this run is a database qualification".
 *
 * CONTRACT
 *   A DB-backed test is enabled ONLY when BOTH of these are present in the REAL
 *   process environment (exported by the operator for that run):
 *
 *     SIRKIT_DB_QUALIFICATION=1
 *     SIRKIT_DB_QUALIFICATION_URL=postgres://…   (or postgresql://…)
 *
 *   Anything else — marker absent or not exactly "1", URL missing/empty, URL
 *   not a postgres scheme — yields `enabled: false` with a precise, secret-free
 *   `reason`, and the test SKIPS. A skipped DB case is therefore always
 *   distinguishable from a broken one.
 *
 * INVARIANTS (tripwired by app/lib/db/__tests__/b16-b-database-qualification.test.ts)
 *   - never calls `loadEnvLocal` (no test reads `.env.local`, ever);
 *   - never reads `DATABASE_URL` — the operator's ambient database is not a
 *     qualification target; tests that must hand the URL to the shared client
 *     set `process.env.DATABASE_URL` themselves from the returned `url`;
 *   - never logs the URL (it carries credentials).
 *
 *   This is the DATABASE gate only. The LIVE auth gate
 *   (`SIRKIT_LIVE_AUTH_QUALIFICATION`, B16.1B) is deliberately separate.
 *
 * This module is production-safe: no test-framework imports, no side effects.
 */

/** Explicit opt-in marker; must be exactly "1". */
export const DB_QUALIFICATION_MARKER = "SIRKIT_DB_QUALIFICATION";
/** Connection string for the qualification database; postgres:// or postgresql://. */
export const DB_QUALIFICATION_URL = "SIRKIT_DB_QUALIFICATION_URL";

export type DatabaseQualificationReason = "marker not set" | "url missing" | "url malformed" | "enabled";

export interface DatabaseQualification {
  /** true ONLY when the marker is "1" AND the URL is a well-formed postgres URL. */
  readonly enabled: boolean;
  /** The qualification URL when enabled; null otherwise (never DATABASE_URL). */
  readonly url: string | null;
  /** Secret-free explanation of the decision. */
  readonly reason: DatabaseQualificationReason;
}

const POSTGRES_SCHEME = /^postgres(?:ql)?:\/\//;

/**
 * Environment shape accepted by the helper. Deliberately looser than
 * `NodeJS.ProcessEnv` (which Next augments with a required `NODE_ENV`) so a
 * bare object literal can be passed in tests; `process.env` satisfies it.
 */
export type QualificationEnv = Readonly<Record<string, string | undefined>>;

/**
 * Decide whether DB-backed tests may run for this process.
 *
 * Reads exactly two keys from `env` (default `process.env`); every other key —
 * including `DATABASE_URL` and anything `.env.local` could have provided — is
 * ignored by construction.
 */
export function databaseQualification(env: QualificationEnv = process.env): DatabaseQualification {
  if (env[DB_QUALIFICATION_MARKER] !== "1") return { enabled: false, url: null, reason: "marker not set" };
  const url = env[DB_QUALIFICATION_URL];
  if (typeof url !== "string" || url.length === 0) return { enabled: false, url: null, reason: "url missing" };
  if (!POSTGRES_SCHEME.test(url)) return { enabled: false, url: null, reason: "url malformed" };
  return { enabled: true, url, reason: "enabled" };
}

/**
 * The qualification URL, or throw `DB_QUALIFICATION_NOT_ENABLED`.
 *
 * For test bodies that must publish the URL to the shared client before
 * touching it (`process.env.DATABASE_URL = withQualifiedDatabase()`); the throw
 * guarantees such a body can never fall through to an ambient DATABASE_URL.
 */
export function withQualifiedDatabase(env: QualificationEnv = process.env): string {
  const qualification = databaseQualification(env);
  if (!qualification.enabled || qualification.url === null) throw new Error("DB_QUALIFICATION_NOT_ENABLED");
  return qualification.url;
}
