/**
 * [B16-B] The production executor: the migration runner over a `postgres`
 * (postgres-js) connection. Used by `scripts/db-migrate.ts` and by the opt-in
 * qualification tests against a real PostgreSQL server
 * (`SIRKIT_DB_QUALIFICATION=1` + `SIRKIT_DB_QUALIFICATION_URL`).
 *
 * `search_path` may be pinned to a scratch schema so a shared qualification
 * server hosts a disposable copy (every unqualified object lands there and the
 * schema is dropped afterwards); production runs leave it at the default.
 */

import postgres, { type Sql } from "postgres";
import type { MigrationExecutor, MigrationStatementRunner } from "./runner";

export interface PostgresExecutorOptions {
  /** Pin every session to this schema (qualification scratch schema). */
  searchPath?: string;
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
    ssl: url.includes("supabase.") ? "require" : undefined,
    connect_timeout: 15,
    onnotice: () => {},
    ...(options.searchPath ? { connection: { search_path: options.searchPath } } : {}),
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
