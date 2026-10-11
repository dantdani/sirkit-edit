/**
 * [B24-C1 review, 2026-10-08] correctness-5, security-4: vitest's ONE setup file (`vitest.config.ts`, `setupFiles`). It runs before
 * every test file and removes an ambient `DATABASE_URL` from the test process, so no suite can reach a database the shell happens to
 * name (runbook :1044 "Never reuse production data in tests."; OD-201). Since B24-C1 the chat route binds a durable run-trace sink
 * (`app/api/chat/trace-runtime.ts`), so every chat suite that drives the route without its own store schedules one durable write per
 * finalized run; before this guard only the shell's discipline kept those writes off a real database.
 *
 * It removes the variable whatever else is set: the DB-backed qualification suites take their database from
 * `SIRKIT_DB_QUALIFICATION_URL` behind `SIRKIT_DB_QUALIFICATION=1` (B16-B: never `DATABASE_URL`, never `.env.local`) and publish it into
 * the process themselves after this has run, so keeping an ambient value under the marker would only let the other suites of that run
 * reach it. CI sets no `DATABASE_URL` (deterministic-manufacturing.yml), so there this changes nothing. Nothing else is touched.
 */
const AMBIENT_DATABASE = "DATABASE_URL";
/** Set once this guard has run in the test process (b24-c1-durable-trace 14 reads it at load). */
export const DATABASE_ENV_GUARD = Symbol.for("sirkit.b24-c1.database-env-guard");

/** Remove the ambient database URL from `env` (the test process's environment by default); every other entry is kept. */
export function clearAmbientDatabaseUrl(env: Record<string, string | undefined> = process.env): void {
  delete env[AMBIENT_DATABASE];
}

clearAmbientDatabaseUrl();
(globalThis as unknown as Record<symbol, unknown>)[DATABASE_ENV_GUARD] = true;
