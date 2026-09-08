/**
 * B16-B — divergence audit between the two ways a database has been created:
 *
 *  (a) the DOCUMENTED clean-database path before B16-B, `pnpm run db:push`
 *      (drizzle-kit applies `schema.ts`); reproduced here without a live
 *      server through `drizzle-kit export` (the DDL push would emit) applied
 *      to a disposable PostgreSQL;
 *  (b) the migration files through the B16-B runner.
 *
 * The test does not demand byte-identical catalogs (drizzle-kit names some
 * objects differently and the SQL migrations carry hand-written statements);
 * it demands that BOTH reach every runbook criterion and it records the exact
 * structural differences so the closeout artifact states them instead of
 * guessing. A NEW difference that touches membership/ownership/RLS fails.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrationManifest, splitMigrationStatements } from "../migrations/manifest";
import { migrateDatabase } from "../migrations/runner";
import { captureSchemaSnapshot, verifyMembershipAndOwnership, type SchemaSnapshot } from "../migrations/verify-schema";
import { disposablePostgres, type DisposablePostgres } from "./pglite-harness";

let pushed: DisposablePostgres, migrated: DisposablePostgres;
let exportDdl = "";

function exportSchemaDdl(): string {
  // The config must resolve `drizzle-kit` from the repository's node_modules, so it lives under node_modules/.cache (ignored, never committed).
  const cache = join(process.cwd(), "node_modules", ".cache", "sirkit-b16b-export");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, "run-"));
  const config = join(dir, "drizzle.config.ts");
  writeFileSync(config, `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ schema: ${JSON.stringify(join(process.cwd(), "app/lib/db/schema.ts").replace(/\\/g, "/"))}, out: ${JSON.stringify(join(dir, "out").replace(/\\/g, "/"))}, dialect: "postgresql", entities: { roles: { provider: "supabase" } } });\n`);
  const bin = join(process.cwd(), "node_modules", "drizzle-kit", "bin.cjs");
  return execFileSync(process.execPath, [bin, "export", "--config", config], { encoding: "utf8", cwd: process.cwd(), timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
}

beforeAll(async () => {
  exportDdl = exportSchemaDdl();
  pushed = await disposablePostgres();
  // AUDIT FINDING (recorded in the closeout artifact): the schema-first path emits NO `CREATE EXTENSION` at all — a clean
  // database reached through `db:push` needs `vector` AND `pg_trgm` pre-enabled by the platform (the migration path
  // creates pg_trgm/pgcrypto itself in 0005/0024 and only assumes `vector`). The push reproduction provisions them here.
  expect(/CREATE EXTENSION/i.test(exportDdl)).toBe(false);
  await pushed.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS pgcrypto;");
  // `drizzle-kit export` prints tables, then foreign keys, then indexes; a foreign key may reference a UNIQUE INDEX that
  // is printed later, so the DDL is applied in dependency order (as drizzle-kit push itself sequences it): tables and
  // extensions, indexes, foreign keys / other ALTERs, then row security and policies.
  const statements = splitMigrationStatements(exportDdl).flatMap((chunk) => chunk.split(/;\s*\n(?=CREATE|ALTER|DROP)/).map((s) => s.trim()).filter(Boolean)).map((s) => (s.endsWith(";") ? s : `${s};`));
  const rank = (s: string): number => /^CREATE (TABLE|EXTENSION|SCHEMA|TYPE)/i.test(s) ? 0 : /^CREATE (UNIQUE )?INDEX/i.test(s) ? 1 : /ENABLE ROW LEVEL SECURITY/i.test(s) ? 3 : /^CREATE POLICY/i.test(s) ? 4 : 2;
  const ordered = statements.map((s, i) => ({ s, i, r: rank(s) })).sort((a, b) => a.r - b.r || a.i - b.i).map((item) => item.s);
  await pushed.transaction(async (tx) => { for (const statement of ordered) await tx.exec(statement); });
  migrated = await disposablePostgres();
  await migrateDatabase(migrated, { manifest: loadMigrationManifest() });
}, 180_000);
afterAll(async () => { await pushed?.close(); await migrated?.close(); });

function differences(a: SchemaSnapshot, b: SchemaSnapshot): { onlyInPush: string[]; onlyInMigrations: string[]; changed: string[] } {
  const keyed = (snapshot: SchemaSnapshot): Map<string, string> => new Map([
    ...snapshot.tables.map((item): [string, string] => [`table:${item.name}`, `rls=${item.rlsEnabled}`]),
    ...snapshot.columns.map((item): [string, string] => [`column:${item.table}.${item.name}`, `${item.type} ${item.nullable ? "NULL" : "NOT NULL"}`]),
    ...snapshot.constraints.map((item): [string, string] => [`constraint:${item.table}.${item.name}`, item.definition]),
    ...snapshot.indexes.map((item): [string, string] => [`index:${item.table}.${item.name}`, item.definition.replace(/^CREATE (UNIQUE )?INDEX \S+ ON /, "")]),
    ...snapshot.policies.map((item): [string, string] => [`policy:${item.table}.${item.name}`, `${item.command} ${item.roles.join(",")} ${item.using}`]),
  ]);
  const ka = keyed(a), kb = keyed(b);
  return {
    onlyInPush: [...ka.keys()].filter((key) => !kb.has(key)).sort(),
    onlyInMigrations: [...kb.keys()].filter((key) => !ka.has(key)).sort(),
    changed: [...ka.keys()].filter((key) => kb.has(key) && ka.get(key) !== kb.get(key)).sort(),
  };
}

describe("B16-B §schema parity — schema-first push vs SQL migrations", () => {
  it("both paths satisfy every membership / ownership / RLS criterion", async () => {
    const viaPush = verifyMembershipAndOwnership(await captureSchemaSnapshot(pushed)).filter((row) => !row.ok);
    const viaMigrations = verifyMembershipAndOwnership(await captureSchemaSnapshot(migrated)).filter((row) => !row.ok);
    expect(viaMigrations, JSON.stringify(viaMigrations)).toEqual([]);
    expect(viaPush, JSON.stringify(viaPush)).toEqual([]);
  });

  it("records the exact structural differences and refuses any that touch membership, ownership or policies", async () => {
    const push = await captureSchemaSnapshot(pushed), viaMigrations = await captureSchemaSnapshot(migrated);
    const diff = differences(push, viaMigrations);
    const definitionOf = (snapshot: SchemaSnapshot, key: string): string => snapshot.indexes.find((i) => `index:${i.table}.${i.name}` === key)?.definition ?? snapshot.constraints.find((c) => `constraint:${c.table}.${c.name}` === key)?.definition ?? "";
    for (const key of diff.changed) console.log(`[B16-B schema parity] changed ${key}: push=${JSON.stringify(definitionOf(push, key))} migrations=${JSON.stringify(definitionOf(viaMigrations, key))}`);
    // KNOWN divergence (recorded, not hidden): schema.ts declares the owner indexes with `taken_at DESC` / `created_at DESC`,
    // which drizzle-kit emits as `DESC NULLS LAST`, while migration 0028 writes plain `DESC` (PostgreSQL default NULLS FIRST).
    // Both columns are NOT NULL, so the two definitions index identical key sets and order every row identically.
    const KNOWN_DIVERGENCES = new Set(["index:bom_notifications.bom_notifications_owner_idx", "index:bom_snapshots.bom_snapshots_owner_idx"]);
    for (const key of KNOWN_DIVERGENCES) {
      expect(diff.changed, `${key} is the documented NULLS-ordering divergence`).toContain(key);
      const table = key.split(":")[1]!.split(".")[0]!;
      expect(push.columns.find((c) => c.table === table && c.name === (table === "bom_snapshots" ? "taken_at" : "created_at"))?.nullable, `${table} order column must be NOT NULL for the divergence to be harmless`).toBe(false);
    }
    const sensitive = [...diff.onlyInPush, ...diff.onlyInMigrations, ...diff.changed].filter((key) => /project_members|bom_snapshots|bom_notifications|policy:/.test(key) && !KNOWN_DIVERGENCES.has(key));
    expect(sensitive, JSON.stringify(sensitive)).toEqual([]);
    // Evidence for the closeout artifact (read by the orchestrator from the test output).
    console.log(`[B16-B schema parity] onlyInPush=${diff.onlyInPush.length} onlyInMigrations=${diff.onlyInMigrations.length} changed=${diff.changed.length}\n${[...diff.onlyInPush.map((k) => `  push-only ${k}`), ...diff.onlyInMigrations.map((k) => `  migrations-only ${k}`), ...diff.changed.map((k) => `  changed ${k}`)].join("\n")}`);
  });
});
