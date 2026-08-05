/**
 * Lazily-initialized Drizzle client over a single `postgres` connection.
 *
 * Initialization is lazy (rather than at import time) so that:
 *  - the standalone ingestion script can load `.env.local` *before* the
 *    connection is created, and
 *  - importing the schema for `drizzle-kit` never requires a live DB.
 *
 * Both `getDb()` and `getSqlClient()` cache a singleton for the process.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

let sqlClient: Sql | null = null;
let dbInstance: PostgresJsDatabase<typeof schema> | null = null;

/** Raw `postgres` connection — used for the one CREATE EXTENSION call. */
export function getSqlClient(): Sql {
  if (sqlClient) return sqlClient;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add the Supabase Postgres connection string " +
        "to .env.local (Project Settings → Database → Connection string → URI).",
    );
  }
  sqlClient = postgres(url, {
    // `prepare: false` keeps us compatible with Supabase's connection pooler.
    prepare: false,
    // Supabase requires TLS; harmless for the direct connection too.
    ssl: url.includes("supabase.") ? "require" : undefined,
    // Fail fast with a real error instead of hanging on a cold/unreachable host.
    connect_timeout: 15,
    // Supabase's session-mode pooler caps concurrent clients (15 by default).
    // Concurrent request handlers — per-component binding writes, parallel
    // subsystem builds — otherwise exhaust it and every query fails with
    // EMAXCONNSESSION. Bound our own pool well under that ceiling and let
    // callers queue instead; idle sockets are returned promptly.
    max: Number(process.env.SIRKIT_DB_POOL_MAX ?? 8),
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    // Swallow benign server NOTICEs (e.g. "extension already exists").
    onnotice: () => {},
  });
  return sqlClient;
}

/** Drizzle ORM handle bound to the schema. */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (dbInstance) return dbInstance;
  dbInstance = drizzle(getSqlClient(), { schema });
  return dbInstance;
}
