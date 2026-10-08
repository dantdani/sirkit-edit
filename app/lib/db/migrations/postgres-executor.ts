/**
 * [B16-B] The production executor: the migration runner over a `postgres`
 * (postgres-js) connection. Used by `scripts/db-migrate.ts` and by the opt-in
 * qualification tests against a real PostgreSQL server
 * (`SIRKIT_DB_QUALIFICATION=1` + `SIRKIT_DB_QUALIFICATION_URL`).
 *
 * No `search_path` pinning: the drizzle-generated migrations carry 25 explicit
 * `"public"."<table>"` references (foreign-key targets), so a scratch-schema
 * copy cannot host them — a qualification run needs a DISPOSABLE DATABASE
 * (see app/lib/db/__tests__/b16-b-postgres-qualification.test.ts).
 */

import postgres, { type Sql } from "postgres";
import type { MigrationExecutor, MigrationStatementRunner } from "./runner"; import { databaseTls } from "../connection-security"; // [B24-A4] D24-3, OD-192

export interface PostgresExecutorOptions {
  /** Connection pool size; the runner needs one connection. */
  max?: number;
}

function runnerFor(client: Sql): MigrationStatementRunner {
  return {
    async exec(sql) { await client.unsafe(sql); },
    async query(sql, params = []) { return (await client.unsafe(sql, params as never)) as unknown as never; },
  };
}

export function createPostgresMigrationExecutor(url: string, options: PostgresExecutorOptions = {}): MigrationExecutor & { close(): Promise<void> } {
  const client = postgres(url, {
    prepare: false,
    max: options.max ?? 1,
    ssl: databaseTls(url), // [B24-A4] D24-3, OD-192: TLS for every non-loopback URL; a weaker sslmode off loopback is refused before any connection
    connect_timeout: 15,
    onnotice: () => {},
  });
  const base = runnerFor(client);
  return {
    ...base,
    async transaction(fn) {
      return client.begin(async (tx) => fn(runnerFor(tx as unknown as Sql))) as Promise<never>;
    },
    async close() { await client.end({ timeout: 5 }); },
  };
}
