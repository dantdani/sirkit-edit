/**
 * [B24-A4] The shared test-data guard (D24-12; OD-191, OD-201; runbook :1044 "Never reuse production data in tests.").
 *
 *  1. the DB-gated set is exactly the eight files: the files importing `db/test-qualification`, minus its contract suite and minus
 *     the one importer that opens no database (B24-A1's `b24-a1-flags`, which reads the gate's default);
 *  2. each of the eight awaits the guard before its first database statement, read or write: a gated describe's first hook is a
 *     `beforeAll` whose first await is the guard, and a test that picks a database itself (`withQualifiedDatabase`,
 *     `databaseQualification`, `createPostgresMigrationExecutor`) awaits the guard first;
 *  3. the write census (red on 3cd7d6e at schema-integrity.test.ts:54-58, :173-184, :189, :198 and :203-207): across the eight and
 *     every `__tests__` helper they import (walked as `startsPostgresVia` does, depth 4, plus the `@/` alias), no DELETE, UPDATE,
 *     TRUNCATE or DROP lacks a predicate naming the run - a WHERE over a bound value; the census follows `_schema-integrity-scope.ts`,
 *     so moving the DELETEs there cannot turn it green by relocation; and every INSERT ... SELECT reads only the run's rows
 *     (red on 3cd7d6e at :190 and :213);
 *  4. no `__tests__` file imports or spawns `scripts/db-migrate` or `scripts/e2e-prompt-to-gerber` (importing either runs it);
 *  5-10. the guard on PGlite: it claims an empty target and the fingerprint is unchanged; it accepts a claimed target; it refuses an
 *     unclaimed non-empty target before any write, the catalog identical; a second claim that interleaves (a test seam) leaves one
 *     claim row and no error; its message names tables and counts, never a row or a URL, and the claim path refuses a weak sslmode
 *     before connecting; rows that row security may hide from a non-owner role are refused, never read as empty;
 *  11. a foreign aggregate, with a readiness row, survives the scoped cleanup; the run's own rows are gone;
 *  12. the acceptance driver's refusal table (`acceptanceDriverRefusal`), and 13. its call order on the driver's source text (AST),
 *     never by importing it.
 * [B24-A4 review, 2026-10-08] 8 also reads the claim's advisory lock from pg_locks; 14. a caller that migrates from nothing
 *     (`requireNoPublicTable`) is refused on a migrated row-free target before the claim is written, and b16-b-postgres-qualification
 *     passes it; 15. a cleanup hook runs statements only under the flag the guard's beforeAll sets once it admitted the target (vitest
 *     runs afterAll after a failed beforeAll); 16. an owner without BYPASSRLS whose table is FORCEd is refused, never read as empty.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../../db/schema";
import { loadMigrationManifest } from "../../../db/migrations/manifest";
import { migrateDatabase } from "../../../db/migrations/runner";
import { captureSchemaSnapshot, schemaFingerprint } from "../../../db/migrations/verify-schema";
import { disposablePostgres, type DisposablePostgres } from "../../../db/disposable-postgres";

let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../../../db/client", () => ({ getDb: () => orm }));

import { acceptanceDriverRefusal, claimQualificationTarget, publicTablesHoldingRows, QualificationTargetRefusal, requireDisposableQualificationTarget, DISPOSABLE_TARGET_FLAG, QUALIFICATION_CLAIM_LOCK_KEY, QUALIFICATION_CLAIM_SCHEMA } from "../../../db/qualification-target";
import { PostgresPhysicalBindingRepository } from "../../../physical-binding/server-repository";
import { clearRunScope, physicalBindingAggregate, runScopePrefix } from "../../../physical-binding/__tests__/_schema-integrity-scope";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const readRaw = (path: string): string | null => { try { return statSync(join(ROOT, path)).isFile() ? readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE) : null; } catch { return null; } };
const read = (path: string): string => readRaw(path) ?? "";

const CONTRACT = "app/lib/db/__tests__/b16-b-database-qualification.test.ts";
const EIGHT = [
  "app/api/pcb-sync/__tests__/route.test.ts",
  "app/components/pcb/__tests__/pcb-sync-authority.test.tsx",
  "app/lib/assignment-queue/__tests__/revalidation.test.ts",
  "app/lib/db/__tests__/b16-b-postgres-qualification.test.ts",
  "app/lib/durable-workflow/__tests__/tenant-scope.test.ts",
  "app/lib/pcb/__tests__/electrical-identity-boundary.test.ts",
  "app/lib/pcb/__tests__/ingest-integrity.test.ts",
  "app/lib/physical-binding/__tests__/schema-integrity.test.ts",
] as const;
const IMPORT_SPECIFIER = /(?:from\s+|import\(\s*|import\s+)["']([^"']+)["']/g;
const GUARDS = new Set(["claimQualificationTarget", "requireDisposableQualificationTarget"]);
/** What picks a database URL inside a test (and so makes that test a region of its own). */
const URL_PICKERS = /\b(?:withQualifiedDatabase|databaseQualification|createPostgresMigrationExecutor)\s*\(/;
/** What opens a database at all (a DB-gated file names one of these; an importer of the gate that names none opens nothing). */
const OPENERS = /\b(?:getSqlClient|getDb|createPostgresMigrationExecutor|PostgresDurableWorkflowRepository|PostgresPhysicalBindingRepository)\b|from ["']postgres["']|import\(["']postgres["']\)/;

function testTreeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) testTreeFiles(full, out);
    else if (/\.test\.tsx?$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
  }
  return out;
}
const ALL_TESTS = ["app", "lib", "components"].flatMap((root) => (existsSync(join(ROOT, root)) ? testTreeFiles(join(ROOT, root)) : []));
/** The repository path an import specifier names (relative or the `@/` alias), or null for a package. */
const resolvedSpecifier = (file: string, specifier: string): string | null => (specifier.startsWith(".") ? posix.normalize(posix.join(posix.dirname(file), specifier)) : specifier.startsWith("@/") ? specifier.slice(2) : null);
const importsGate = (file: string): boolean => [...read(file).matchAll(IMPORT_SPECIFIER)].some((match) => resolvedSpecifier(file, match[1]!)?.replace(/\.ts$/, "") === "app/lib/db/test-qualification");

const parse = (path: string, text = read(path)): ts.SourceFile => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const lineOf = (source: ts.SourceFile, node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

/** The first await expression in a function's own body, in source order (nested functions run later or elsewhere, so they are skipped). */
function firstAwait(fn: ts.FunctionLikeDeclaration): ts.AwaitExpression | null {
  let found: ts.AwaitExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== fn && ts.isFunctionLike(node)) return;
    if (ts.isAwaitExpression(node)) { found = node; return; }
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  return found;
}
const isGuard = (node: ts.AwaitExpression | null): boolean => Boolean(node && ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression) && GUARDS.has(node.expression.expression.text));
const callbackOf = (call: ts.CallExpression): ts.FunctionLikeDeclaration | null => {
  const fn = [...call.arguments].reverse().find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
  return (fn as ts.FunctionLikeDeclaration | undefined) ?? null;
};
/** `describe.runIf(x)` itself, or a name bound to it (`const live = describe.runIf(...)`). */
function gatedDescribeNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && /^describe\.runIf\(/.test(node.initializer.getText(source))) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}
const hookName = (call: ts.CallExpression): string => {
  let callee: ts.Expression = call.expression;
  while (ts.isCallExpression(callee)) callee = callee.expression;
  return callee.getText().split(".")[0]!;
};

/** Every region of one DB-gated file and whether it awaits the guard first. */
function guardRegions(file: string): Array<{ region: string; ok: boolean }> {
  const source = parse(file);
  const aliases = gatedDescribeNames(source);
  const regions: Array<{ region: string; ok: boolean }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const text = node.expression.getText(source);
      const gated = /^describe\.runIf\(/.test(text) || (ts.isIdentifier(node.expression) && aliases.has(node.expression.text));
      if (gated) {
        const body = callbackOf(node)?.body;
        const calls = body && ts.isBlock(body) ? body.statements.flatMap((statement) => (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) ? [statement.expression] : [])) : [];
        const first = calls.find((call) => ["beforeAll", "beforeEach", "it", "test"].includes(hookName(call)));
        const fn = first ? callbackOf(first) : null;
        regions.push({ region: `${file}:${lineOf(source, node)} gated describe`, ok: Boolean(first && hookName(first) === "beforeAll" && fn && isGuard(firstAwait(fn))) });
      }
      const name = hookName(node);
      if (["it", "test"].includes(name)) {
        const fn = callbackOf(node);
        if (fn?.body && URL_PICKERS.test(fn.body.getText(source))) regions.push({ region: `${file}:${lineOf(source, node)} test`, ok: isGuard(firstAwait(fn)) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return regions;
}

/** A suite and every `__tests__` helper it imports, walked as `startsPostgresVia` does (relative imports, depth 4) plus the `@/` alias. */
function walkedFiles(file: string, depth = 4, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  const source = readRaw(file);
  if (source === null) return seen;
  seen.add(file);
  if (depth === 0) return seen;
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1]!;
    const base = specifier.startsWith(".") ? posix.normalize(posix.join(posix.dirname(file), specifier)) : specifier.startsWith("@/") ? specifier.slice(2) : null;
    if (base === null) continue;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (readRaw(candidate) !== null) { walkedFiles(candidate, depth - 1, seen); break; }
    }
  }
  return seen;
}

const WRITE = [/^DELETE\s+FROM\s/i, /^UPDATE\s+[\w."]+\s+SET\s/i, /^TRUNCATE\b/i, /^DROP\s+(?:TABLE|INDEX|SCHEMA|VIEW|SEQUENCE|TYPE|FUNCTION|POLICY|TRIGGER|ROLE|DATABASE|EXTENSION|OWNED)\b/i];
const INSERT_SELECT = /^INSERT\s+INTO\s+[\w."]+(?:\s*\([^)]*\))?\s+SELECT\s/i;
/** Every SQL statement held in a string or template literal: its text with `${n}` for each bound value, and the bound expressions. */
function sqlStatements(file: string, text = read(file)): Array<{ line: number; statement: string; bound: boolean[] }> {
  const source = parse(file, text);
  const out: Array<{ line: number; statement: string; bound: boolean[] }> = [];
  const visit = (node: ts.Node): void => {
    let text: string | null = null;
    const bound: boolean[] = [];
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) {
      text = node.head.text;
      node.templateSpans.forEach((span, index) => {
        bound.push(!(ts.isStringLiteral(span.expression) || ts.isNumericLiteral(span.expression) || ts.isNoSubstitutionTemplateLiteral(span.expression)));
        text += `\${${index}}${span.literal.text}`;
      });
    }
    if (text !== null) {
      const code = text.split(NEWLINE).map((line) => (/^\s*--/.test(line) ? "" : line)).join(NEWLINE).replace(/'(?:[^']|'')*'/g, "''");
      for (const statement of code.split(";").map((part) => part.trim()).filter(Boolean)) out.push({ line: lineOf(source, node), statement: statement.replace(/\s+/g, " "), bound });
    }
    if (!ts.isTemplateExpression(node)) ts.forEachChild(node, visit);
    else node.templateSpans.forEach((span) => visit(span.expression));
  };
  visit(source);
  return out;
}
/** A predicate naming the run: a WHERE that reads a bound value (`${n}` of a non-literal expression, or a positional `$n`). */
function namesRun(statement: string, bound: readonly boolean[]): boolean {
  const where = /\bWHERE\b([\s\S]*)$/i.exec(statement);
  if (!where) return false;
  return [...where[1]!.matchAll(/\$\{(\d+)\}/g)].some((match) => bound[Number(match[1])] === true) || /\$\d+\b/.test(where[1]!);
}
function unscoped(files: Iterable<string>, text?: (file: string) => string): { writes: string[]; insertSelects: string[] } {
  const writes: string[] = [];
  const insertSelects: string[] = [];
  for (const file of files) {
    if (!file.includes("/__tests__/")) continue;
    for (const { line, statement, bound } of sqlStatements(file, text ? text(file) : read(file))) {
      if (WRITE.some((pattern) => pattern.test(statement)) && (/^(?:TRUNCATE|DROP)\b/i.test(statement) || !namesRun(statement, bound))) writes.push(`${file}:${line}`);
      if (INSERT_SELECT.test(statement) && !namesRun(statement, bound)) insertSelects.push(`${file}:${line}`);
    }
  }
  return { writes, insertSelects };
}

const open: DisposablePostgres[] = [];
async function migrated(): Promise<DisposablePostgres> {
  const db = await disposablePostgres();
  open.push(db);
  await migrateDatabase(db, { manifest: loadMigrationManifest() });
  return db;
}
afterEach(async () => { for (const db of open.splice(0)) await db.close(); });
const claimRows = async (db: DisposablePostgres): Promise<number> => (await db.query<{ present: boolean }>(`SELECT to_regclass('${QUALIFICATION_CLAIM_SCHEMA}.claim') IS NOT NULL AS present`))[0]!.present ? (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${QUALIFICATION_CLAIM_SCHEMA}.claim`))[0]!.n : 0;
const namespaces = async (db: DisposablePostgres): Promise<string[]> => (await db.query<{ nspname: string }>("SELECT nspname FROM pg_namespace ORDER BY nspname")).map((row) => row.nspname);
const refusalOf = async (promise: Promise<unknown>): Promise<QualificationTargetRefusal> => { try { await promise; } catch (error) { return error as QualificationTargetRefusal; } throw new Error("expected a refusal"); };
/** [B24-A4 review] Whether THIS backend holds the transaction-scoped advisory lock `hashtext(key)`: pg_locks shows a bigint key as
 *  classid (its high 32 bits) and objid (its low 32), objsubid 1. */
const advisoryLockHeld = async (runner: Pick<DisposablePostgres, "query">, key: string): Promise<boolean> =>
  (await runner.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted AND pid = pg_backend_pid() AND objsubid = 1 AND classid = ((hashtext($1)::bigint >> 32) & 4294967295)::oid AND objid = (hashtext($1)::bigint & 4294967295)::oid", [key]))[0]!.n === 1;

describe("[B24-A4] the DB-gated suites use the shared guard (D24-12, OD-201)", () => {
  it("1. the DB-gated set is exactly the eight files: importers of db/test-qualification, minus its contract suite and minus b24-a1-flags, the one importer that opens no database", { timeout: 60_000 }, () => {
    const importers = ALL_TESTS.filter(importsGate).sort();
    expect(importers.filter((file) => file !== CONTRACT && OPENERS.test(read(file)))).toEqual([...EIGHT]);
    expect(importers.filter((file) => !EIGHT.includes(file as (typeof EIGHT)[number]))).toEqual([CONTRACT, "app/lib/qualification/__tests__/b24-a1-flags.test.ts"]);
    expect(OPENERS.test(read("app/lib/qualification/__tests__/b24-a1-flags.test.ts"))).toBe(false);
  });

  it("2. each of the eight awaits the guard before its first database statement: a gated describe's first hook is a beforeAll awaiting it first, and every test that picks a database itself awaits it first", { timeout: 60_000 }, () => {
    const regions = EIGHT.flatMap((file) => guardRegions(file));
    for (const file of EIGHT) {
      expect(regions.some((region) => region.region.startsWith(`${file}:`)), file).toBe(true);
      expect(read(file), file).toMatch(/import \{[^}]*\b(?:claimQualificationTarget|requireDisposableQualificationTarget)\b[^}]*\} from "(?:[^"]*\/db|\.\.)\/qualification-target";/);
    }
    expect(regions.filter((region) => !region.ok).map((region) => region.region)).toEqual([]);
    expect(regions.length).toBeGreaterThanOrEqual(9);
    // ingest-integrity keeps its synchronous publication (b16-b-database-qualification.test.ts:224-234) after the async guard hook
    const ingest = read("app/lib/pcb/__tests__/ingest-integrity.test.ts");
    expect(ingest.indexOf("beforeAll(async () => {")).toBeGreaterThan(-1);
    expect(ingest.indexOf("beforeAll(async () => {")).toBeLessThan(ingest.indexOf("beforeAll(() => {"));
  });

  it("3. the write census (red on 3cd7d6e at schema-integrity.test.ts:54-58, :173-184, :189, :198, :203-207): no DELETE, UPDATE, TRUNCATE or DROP in the eight or their __tests__ helpers lacks a predicate naming the run; the census follows _schema-integrity-scope.ts; every INSERT ... SELECT reads only the run's rows", { timeout: 60_000 }, () => {
    const walked = new Set(EIGHT.flatMap((file) => [...walkedFiles(file)]));
    expect(walked.has("app/lib/physical-binding/__tests__/_schema-integrity-scope.ts")).toBe(true);
    expect([...walked].filter((file) => file.includes("/__tests__/")).length).toBeGreaterThan(EIGHT.length);
    const { writes, insertSelects } = unscoped(walked);
    expect(writes).toEqual([]);
    expect(insertSelects).toEqual([]);
    // the scoped DELETEs are there, in the helper the census follows: five, each a prefix-equality predicate, never LIKE
    const scope = sqlStatements("app/lib/physical-binding/__tests__/_schema-integrity-scope.ts").filter(({ statement }) => /^DELETE\s/i.test(statement));
    expect(scope).toHaveLength(5);
    expect(scope.every(({ statement }) => /left\(tenant_id, length\(\$1\)\) = \$1/.test(statement) && !/\bLIKE\b/i.test(statement))).toBe(true);
    // the census is not vacuous: on the 3cd7d6e forms (an unscoped DELETE, UPDATE and INSERT ... SELECT ... LIMIT 1), a TRUNCATE, a
    // DROP and a WHERE over a literal it reports every line; the scoped forms pass
    const PLANTED = "app/lib/physical-binding/__tests__/planted.test.ts";
    const tick = String.fromCharCode(96);
    const plantedText = [
      `await tx${tick}DELETE FROM physical_binding_audit_events${tick};`,
      `await expectConstraint(sql!${tick}UPDATE physical_binding_revisions SET revision = 0${tick}, "x");`,
      `await sql!.unsafe(${tick}INSERT INTO physical_binding_revisions SELECT 'cross-scope-revision', binding_id FROM physical_binding_revisions LIMIT 1${tick});`,
      `await sql!.unsafe("TRUNCATE physical_binding_sets");`,
      `await sql!.unsafe("DROP TABLE physical_binding_sets");`,
      `await sql!${tick}UPDATE physical_binding_sets SET revision = 2 WHERE tenant_id = \${"tenant-1"}${tick};`,
      `await sql!${tick}UPDATE physical_binding_sets SET revision = 2 WHERE left(tenant_id, length(\${RUN})) = \${RUN}${tick};`,
      `await tx.query("DELETE FROM physical_binding_sets WHERE left(tenant_id, length($1)) = $1", [run]);`,
    ].join(NEWLINE);
    const census = unscoped([PLANTED], () => plantedText);
    expect(census.writes).toEqual([1, 2, 4, 5, 6].map((line) => `${PLANTED}:${line}`));
    expect(census.insertSelects).toEqual([`${PLANTED}:3`]);
  });

  it("4. no __tests__ file imports or spawns scripts/db-migrate or scripts/e2e-prompt-to-gerber (importing either runs it: it loads .env.local and connects or posts)", { timeout: 60_000 }, () => {
    const SCRIPT = /(^|\/)scripts\/(?:db-migrate|e2e-prompt-to-gerber)(?:\.ts)?$/;
    const importing = ALL_TESTS.filter((file) => [...read(file).matchAll(IMPORT_SPECIFIER)].some((match) => SCRIPT.test(match[1]!)));
    expect(importing).toEqual([]);
    const spawning = ALL_TESTS.filter((file) => read(file).split(NEWLINE).some((line) => /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(/.test(line) && /db-migrate|e2e-prompt-to-gerber/.test(line)));
    expect(spawning).toEqual([]);
  });
});

describe("[B24-A4] the guard on PGlite (requireDisposableQualificationTarget)", () => {
  it("5. it claims an empty migrated target: one claim row, outside public, and the schema fingerprint is unchanged", { timeout: 120_000 }, async () => {
    const db = await migrated();
    const before = schemaFingerprint(await captureSchemaSnapshot(db));
    expect(await publicTablesHoldingRows(db)).toEqual([]);
    expect(await requireDisposableQualificationTarget(db, "fresh")).toEqual({ outcome: "claimed" });
    expect(await claimRows(db)).toBe(1);
    expect(schemaFingerprint(await captureSchemaSnapshot(db))).toBe(before);
    expect(await publicTablesHoldingRows(db)).toEqual([]);
    // a bare server (no table at all) is empty too: the qualification suite claims it before migrating
    const bare = await disposablePostgres();
    open.push(bare);
    expect(await requireDisposableQualificationTarget(bare, "bare")).toEqual({ outcome: "claimed" });
  });

  it("6. it accepts a claimed target that has since gained rows (the bounded ingest, an earlier run): the claim, not emptiness, is the marker", { timeout: 120_000 }, async () => {
    const db = await migrated();
    await requireDisposableQualificationTarget(db, "first");
    await db.exec("INSERT INTO libraries (name, main_category) VALUES ('Device', 'Passives')");
    expect(await publicTablesHoldingRows(db)).toEqual([{ table: "libraries", rows: 1 }]);
    expect(await requireDisposableQualificationTarget(db, "second")).toEqual({ outcome: "already-claimed" });
    expect(await claimRows(db)).toBe(1);
  });

  it("7. it refuses an unclaimed non-empty target before any write, and the catalog is identical afterwards", { timeout: 120_000 }, async () => {
    const db = await migrated();
    await db.exec("INSERT INTO libraries (name, main_category) VALUES ('Device', 'Passives'); INSERT INTO libraries (name, main_category) VALUES ('Timer', 'ICs')");
    const [fingerprint, spaces] = [schemaFingerprint(await captureSchemaSnapshot(db)), await namespaces(db)];
    const refusal = await refusalOf(requireDisposableQualificationTarget(db, "production-shaped"));
    expect(refusal).toBeInstanceOf(QualificationTargetRefusal);
    expect(refusal.code).toBe("DB_QUALIFICATION_TARGET_NOT_EMPTY");
    expect(refusal.message).toMatch(/^DB_QUALIFICATION_TARGET_NOT_EMPTY: /);
    expect(refusal.message).toContain("libraries: 2");
    expect(schemaFingerprint(await captureSchemaSnapshot(db))).toBe(fingerprint);
    expect(await namespaces(db)).toEqual(spaces);
    expect(spaces).not.toContain(QUALIFICATION_CLAIM_SCHEMA);
    expect(await claimRows(db)).toBe(0);
  });

  it("8. a second claim that interleaves inside the first (a test seam) leaves one claim row and no error", { timeout: 120_000 }, async () => {
    const db = await migrated();
    let interleaved = false;
    const held: boolean[] = [];
    const result = await requireDisposableQualificationTarget(db, "first", {
      beforeClaimWrite: async (tx) => {
        if (interleaved) return;
        interleaved = true;
        // [B24-A4 review, 2026-10-08] the claim runs under its own advisory lock (pg_locks, this backend), not only ON CONFLICT
        held.push(await advisoryLockHeld(tx, QUALIFICATION_CLAIM_LOCK_KEY), await advisoryLockHeld(tx, "sirkit_schema_migrations"));
        // another worker's claim lands first (simulated on the same session: PGlite is single-connection)
        await tx.exec(`CREATE SCHEMA IF NOT EXISTS ${QUALIFICATION_CLAIM_SCHEMA}`);
        await tx.exec(`CREATE TABLE IF NOT EXISTS ${QUALIFICATION_CLAIM_SCHEMA}.claim (claim_key smallint PRIMARY KEY DEFAULT 1 CHECK (claim_key = 1), label text NOT NULL, marker text NOT NULL, claimed_at timestamp with time zone NOT NULL DEFAULT now())`);
        await tx.query(`INSERT INTO ${QUALIFICATION_CLAIM_SCHEMA}.claim (label, marker) VALUES ($1, $2)`, ["other-worker", "sirkit.db-qualification-claim.v1"]);
      },
    });
    expect(interleaved).toBe(true);
    expect(held).toEqual([true, false]);
    expect(await advisoryLockHeld(db, QUALIFICATION_CLAIM_LOCK_KEY)).toBe(false); // released with the claim's transaction
    expect(result.outcome).toBe("claimed");
    expect(await claimRows(db)).toBe(1);
    expect(await requireDisposableQualificationTarget(db, "third")).toEqual({ outcome: "already-claimed" });
  });

  it("9. its message names tables and counts, never a row or a URL; the claim path refuses a weak sslmode before it connects", { timeout: 120_000 }, async () => {
    const db = await migrated();
    const ROW = "row-content-b24a4-sentinel";
    await db.exec(`INSERT INTO libraries (name, main_category) VALUES ('${ROW}', 'Passives')`);
    const refusal = await refusalOf(requireDisposableQualificationTarget(db, "label-only"));
    expect(refusal.message).not.toContain(ROW);
    expect(refusal.message).not.toMatch(/postgres(?:ql)?:\/\//);
    // claimQualificationTarget opens its connection through the migration executor, so the TLS rule refuses first - no socket opens
    const weak = await refusalOf(claimQualificationTarget("postgres://qualification@db.internal.example:5432/disposable?sslmode=disable", "weak"));
    expect((weak as unknown as { code: string }).code).toBe("DB_TLS_REQUIRED");
    expect(weak.message).not.toMatch(/db\.internal\.example|qualification@|disposable/);
  });

  it("10. rows that row security may hide from a non-owner role without BYPASSRLS are refused, never read as an empty target", { timeout: 120_000 }, async () => {
    const db = await migrated();
    await db.exec("INSERT INTO libraries (name, main_category) VALUES ('Device', 'Passives'); CREATE ROLE sirkit_test_reader NOLOGIN NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO sirkit_test_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO sirkit_test_reader;");
    await db.exec("SET ROLE sirkit_test_reader");
    try {
      expect(await publicTablesHoldingRows(db)).toEqual([]); // what a naive count sees: nothing
      const refusal = await refusalOf(requireDisposableQualificationTarget(db, "hidden"));
      expect(refusal.code).toBe("DB_QUALIFICATION_TARGET_NOT_EMPTY");
      expect(refusal.message).toMatch(/row security/);
    } finally {
      await db.exec("RESET ROLE");
    }
    expect(await claimRows(db)).toBe(0);
  });

  it("11. a foreign aggregate, with a readiness row, survives the scoped cleanup; the run's own rows are gone (prefix equality, never LIKE)", { timeout: 120_000 }, async () => {
    const db = await migrated();
    orm = drizzle(db.db, { schema });
    const run = runScopePrefix("iso");
    const repository = new PostgresPhysicalBindingRepository();
    await repository.commit(await physicalBindingAggregate("foreign", `x${run}tenant`));
    await repository.commit(await physicalBindingAggregate("foreign-2", "foreign-tenant-b24a4"));
    await repository.commit(await physicalBindingAggregate("own", `${run}tenant-1`));
    await repository.commit(await physicalBindingAggregate("own-other", `${run}tenant-other`));
    const counts = async (predicate: string) => (await db.query<{ revisions: number; sets: number; audits: number; migrations: number; assessments: number }>(`
      SELECT (SELECT count(*)::int FROM physical_binding_revisions WHERE ${predicate}) AS revisions,
             (SELECT count(*)::int FROM physical_binding_sets WHERE ${predicate}) AS sets,
             (SELECT count(*)::int FROM physical_binding_audit_events WHERE ${predicate}) AS audits,
             (SELECT count(*)::int FROM physical_binding_migration_records WHERE ${predicate}) AS migrations,
             (SELECT count(*)::int FROM physical_readiness_assessments WHERE binding_revision_id IN (SELECT revision_id FROM physical_binding_revisions WHERE ${predicate})) AS assessments`))[0]!;
    const own = `left(tenant_id, ${run.length}) = '${run}'`;
    const foreign = `NOT (${own})`;
    expect(await counts(own)).toEqual({ revisions: 2, sets: 2, audits: 2, migrations: 2, assessments: 2 });
    const before = await counts(foreign);
    expect(before).toEqual({ revisions: 2, sets: 2, audits: 2, migrations: 2, assessments: 2 });
    await clearRunScope(db, run);
    expect(await counts(foreign)).toEqual(before);
    expect(await counts(own)).toEqual({ revisions: 0, sets: 0, audits: 0, migrations: 0, assessments: 0 });
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM physical_readiness_assessments"))[0]!.n).toBe(2);
  });
});

describe("[B24-A4] the acceptance driver refuses to start on anything but a disposable target", () => {
  const LOCAL = "http://localhost:3000";
  it("12. the refusal table: --disposable-target, a loopback base URL, and a catalog read that cannot reach a non-loopback database (the fixture runtime, or DATABASE_URL unset or loopback); no refusal echoes a URL", { timeout: 60_000 }, () => {
    const FLAG = [DISPOSABLE_TARGET_FLAG];
    const rows: Array<[readonly string[], string, { fixtureRuntime: boolean; databaseUrl: string | undefined }, string | null]> = [
      [[], LOCAL, { fixtureRuntime: true, databaseUrl: undefined }, "E2E_DISPOSABLE_TARGET_REQUIRED"],
      [["--project", "p1"], LOCAL, { fixtureRuntime: true, databaseUrl: undefined }, "E2E_DISPOSABLE_TARGET_REQUIRED"],
      [["--disposable-target=yes"], LOCAL, { fixtureRuntime: true, databaseUrl: undefined }, "E2E_DISPOSABLE_TARGET_REQUIRED"],
      [FLAG, LOCAL, { fixtureRuntime: true, databaseUrl: undefined }, null],
      [["--project", "p1", ...FLAG, "--keep"], "http://127.0.0.1:3000", { fixtureRuntime: false, databaseUrl: undefined }, null],
      [FLAG, "http://[::1]:3000", { fixtureRuntime: false, databaseUrl: "" }, null],
      [FLAG, "https://app.sirkit.example", { fixtureRuntime: true, databaseUrl: undefined }, "E2E_BASE_URL_NOT_LOOPBACK"],
      [FLAG, "http://localhost.example.com:3000", { fixtureRuntime: true, databaseUrl: undefined }, "E2E_BASE_URL_NOT_LOOPBACK"],
      [FLAG, "not a url", { fixtureRuntime: true, databaseUrl: undefined }, "E2E_BASE_URL_NOT_LOOPBACK"],
      [FLAG, "ftp://localhost/", { fixtureRuntime: true, databaseUrl: undefined }, "E2E_BASE_URL_NOT_LOOPBACK"],
      [FLAG, LOCAL, { fixtureRuntime: false, databaseUrl: "postgres://sirkit@localhost:5432/scratch" }, null],
      [FLAG, LOCAL, { fixtureRuntime: false, databaseUrl: "postgresql://postgres@db.projectref.supabase.co:5432/postgres" }, "E2E_CATALOG_DATABASE_NOT_LOOPBACK"],
      [FLAG, LOCAL, { fixtureRuntime: false, databaseUrl: "not a url" }, "E2E_CATALOG_DATABASE_NOT_LOOPBACK"],
      [FLAG, LOCAL, { fixtureRuntime: true, databaseUrl: "postgresql://postgres@db.projectref.supabase.co:5432/postgres" }, null],
    ];
    for (const [argv, base, catalog, expected] of rows) {
      const refusal = acceptanceDriverRefusal(argv, base, catalog);
      expect(refusal?.code ?? null, `${argv.join(" ")} ${base} ${JSON.stringify(catalog)}`).toBe(expected);
      if (refusal) {
        expect(refusal.message).not.toMatch(/localhost:3000|sirkit\.example|projectref|supabase\.co|scratch/);
      }
    }
  });

  it("13. the driver calls the check first - before its first request and its catalog read - and exits on a refusal; checked on its source text (AST), never by importing it", { timeout: 60_000 }, () => {
    const path = "scripts/e2e-prompt-to-gerber.ts";
    const source = parse(path);
    const imports = [...read(path).matchAll(IMPORT_SPECIFIER)].map((match) => match[1]!);
    expect(imports).toEqual(expect.arrayContaining(["../app/lib/db/qualification-target", "../app/lib/fixture-runtime/mode"]));
    let main: ts.FunctionDeclaration | undefined;
    source.forEachChild((node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === "main") main = node; });
    expect(main).toBeDefined();
    const calls: Array<{ name: string; at: number; node: ts.CallExpression }> = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.push({ name: node.expression.text, at: node.getStart(source), node });
      ts.forEachChild(node, visit);
    };
    visit(main!.body!);
    const first = (name: string): number => calls.find((call) => call.name === name)?.at ?? -1;
    const check = calls.find((call) => call.name === "acceptanceDriverRefusal");
    expect(check).toBeDefined();
    expect(first("request")).toBeGreaterThan(check!.at);
    expect(first("post")).toBeGreaterThan(check!.at);
    expect(first("getFullPartsByIds")).toBeGreaterThan(check!.at);
    expect(calls.filter((call) => ["request", "post", "getFullPartsByIds"].includes(call.name)).every((call) => call.at > check!.at)).toBe(true);
    const text = check!.node.getText(source).replace(/\s+/g, " ");
    expect(text).toBe("acceptanceDriverRefusal(args, BASE, { fixtureRuntime: fixtureRuntimeEnabled(), databaseUrl: process.env.DATABASE_URL })");
    // the statement after the check exits on a refusal, before anything else runs
    const statements = main!.body!.statements;
    const at = statements.findIndex((statement) => statement.getText(source).includes("acceptanceDriverRefusal("));
    expect(at).toBe(0);
    expect(statements[at + 1]!.getText(source)).toMatch(/^if \(refusal\) \{ console\.error\(.*\); process\.exit\(2\); \}$/);
    // nothing at module level sends a request or reads the catalog
    const topLevel = source.statements.filter((statement) => !ts.isFunctionDeclaration(statement)).map((statement) => statement.getText(source)).join(NEWLINE);
    expect(topLevel).not.toMatch(/\b(?:request|post|getFullPartsByIds)\(/);
    expect(read(path)).toMatch(/Usage: pnpm exec tsx scripts\/e2e-prompt-to-gerber\.ts --disposable-target /);
  });
});

/** [B24-A4 review] The flag a describe's guard hook sets once the guard has admitted the target: an `<id> = true` after the guard's
 *  await in the first beforeAll of the block that holds `hook`, or null. */
function admissionFlag(hook: ts.CallExpression): string | null {
  const block = hook.parent?.parent;
  if (!block || !(ts.isBlock(block) || ts.isSourceFile(block))) return null;
  const guardHook = block.statements.flatMap((statement) => (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && hookName(statement.expression) === "beforeAll" ? [statement.expression] : [])).find((call) => { const fn = callbackOf(call); return Boolean(fn && isGuard(firstAwait(fn))); });
  const fn = guardHook ? callbackOf(guardHook) : null;
  const guard = fn ? firstAwait(fn) : null;
  if (!fn?.body || !guard) return null;
  let flag: string | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && node.right.kind === ts.SyntaxKind.TrueKeyword && node.getStart() > guard.getEnd()) flag ??= node.left.text;
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return flag;
}
const STATEMENT_CALLS = new Set(["clearRun", "clearRunScope"]);
const STATEMENT_METHODS = new Set(["query", "exec", "unsafe", "transaction", "begin"]);
/** Database statements a cleanup hook (afterAll, afterEach) runs without the guard's admission: every `clearRun`/`clearRunScope`
 *  call, every `.query(`, `.exec(`, `.unsafe(`, `.transaction(` or `.begin(` call and every tagged template must sit under
 *  `if (<flag>)` with the flag `admissionFlag` finds; a statement helper passed by reference has no flag at all. */
function unadmittedCleanups(file: string, text = read(file)): string[] {
  const source = parse(file, text);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ["afterAll", "afterEach"].includes(hookName(node))) {
      const fn = callbackOf(node);
      const flag = admissionFlag(node);
      const underFlag = (inner: ts.Node): boolean => {
        for (let at: ts.Node | undefined = inner; at && at !== fn; at = at.parent) {
          const parent: ts.Node | undefined = at.parent;
          if (parent && ts.isIfStatement(parent) && parent.thenStatement === at && ts.isIdentifier(parent.expression) && parent.expression.text === flag) return true;
        }
        return false;
      };
      const check = (inner: ts.Node): void => {
        const statement = ts.isTaggedTemplateExpression(inner) || (ts.isCallExpression(inner) && (ts.isIdentifier(inner.expression) ? STATEMENT_CALLS.has(inner.expression.text) : ts.isPropertyAccessExpression(inner.expression) && STATEMENT_METHODS.has(inner.expression.name.text)));
        if (statement && !(flag && underFlag(inner))) out.push(`${file}:${lineOf(source, inner)} ${inner.getText(source).replace(/\s+/g, " ").slice(0, 80)}`);
        ts.forEachChild(inner, check);
      };
      if (fn?.body) check(fn.body);
      const [first] = node.arguments;
      if (first && ts.isIdentifier(first) && STATEMENT_CALLS.has(first.text)) out.push(`${file}:${lineOf(source, node)} ${first.text} passed by reference`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe("[B24-A4 review, 2026-10-08] the guard's preconditions, its cleanup rule and FORCE", () => {
  it("14. a caller that migrates from nothing passes requireNoPublicTable: a migrated but row-free target is refused before any write (no claim, no schema, the fingerprint unchanged), claimed or not; a bare one is claimed; b16-b-postgres-qualification passes it at both guard sites", { timeout: 120_000 }, async () => {
    const db = await migrated();
    expect(await publicTablesHoldingRows(db)).toEqual([]);
    const [fingerprint, spaces] = [schemaFingerprint(await captureSchemaSnapshot(db)), await namespaces(db)];
    const outcome = await requireDisposableQualificationTarget(db, "migrated-row-free", { requireNoPublicTable: true }).then((result) => result.outcome as string, (error: QualificationTargetRefusal) => error.code);
    expect(outcome).toBe("DB_QUALIFICATION_TARGET_NOT_EMPTY");
    expect(await claimRows(db)).toBe(0);
    expect(await namespaces(db)).toEqual(spaces);
    expect(schemaFingerprint(await captureSchemaSnapshot(db))).toBe(fingerprint);
    const refusal = await refusalOf(requireDisposableQualificationTarget(db, "migrated-row-free", { requireNoPublicTable: true }));
    expect(refusal.message).toMatch(/^DB_QUALIFICATION_TARGET_NOT_EMPTY: migrated-row-free holds 144 public table\(s\)/);
    // the default (no option) still claims it - the gated suites that run on a migrated database rely on that - and a claimed target
    // holding tables is still refused under the option
    expect(await requireDisposableQualificationTarget(db, "default")).toEqual({ outcome: "claimed" });
    expect((await refusalOf(requireDisposableQualificationTarget(db, "strict-after-claim", { requireNoPublicTable: true }))).code).toBe("DB_QUALIFICATION_TARGET_NOT_EMPTY");
    const bare = await disposablePostgres();
    open.push(bare);
    expect(await requireDisposableQualificationTarget(bare, "bare", { requireNoPublicTable: true })).toEqual({ outcome: "claimed" });
    expect(await requireDisposableQualificationTarget(bare, "bare-again", { requireNoPublicTable: true })).toEqual({ outcome: "already-claimed" });
    expect(await claimRows(bare)).toBe(1);
    const suite = read("app/lib/db/__tests__/b16-b-postgres-qualification.test.ts");
    expect([...suite.matchAll(/await requireDisposableQualificationTarget\(([^;]*?)\);/g)].map((match) => match[1])).toEqual([
      'executor, "SIRKIT_DB_QUALIFICATION_URL", { requireNoPublicTable: true }',
      'upgrader, "SIRKIT_DB_QUALIFICATION_URL_2", { requireNoPublicTable: true }',
    ]);
  });

  it("15. a cleanup hook runs database statements only once the guard admitted the target (vitest runs afterAll after a failed beforeAll, @vitest/runner 3.2.6 runSuite): in the eight, every afterAll or afterEach statement sits under the flag the guard's beforeAll sets after its await", { timeout: 60_000 }, () => {
    expect(EIGHT.flatMap((file) => unadmittedCleanups(file))).toEqual([]);
    // the rule is not vacuous: an unconditioned statement, a query, a helper passed by reference, and a flag set before the await
    const PLANTED = "app/lib/physical-binding/__tests__/planted-hooks.test.ts";
    const plantedText = [
      'live("admitted", () => {',
      "  let admitted = false;",
      '  beforeAll(async () => { await claimQualificationTarget(url, "x"); admitted = true; });',
      "  afterAll(async () => { if (admitted) await clearRun(); await sql.end(); await scope.close(); });",
      "  afterAll(async () => { await clearRun(); });",
      '  afterEach(async () => { await scope.query("DELETE FROM t WHERE k = $1", [k]); });',
      "  afterAll(clearRun);",
      "});",
      'live("flag too early", () => {',
      "  let admitted = false;",
      '  beforeAll(async () => { admitted = true; await claimQualificationTarget(url, "x"); });',
      "  afterAll(async () => { if (admitted) await clearRun(); });",
      "});",
    ].join(NEWLINE);
    expect(unadmittedCleanups(PLANTED, plantedText).map((entry) => entry.split(" ")[0])).toEqual([5, 6, 7, 12].map((line) => `${PLANTED}:${line}`));
  });

  it("16. an owner without BYPASSRLS whose table is FORCEd is refused, never read as empty (FORCE puts the owner under row security too); control: without FORCE the same owner reads its row and the target is refused as holding it", { timeout: 180_000 }, async () => {
    const db = await migrated();
    await db.exec("INSERT INTO libraries (name, main_category) VALUES ('Device', 'Passives'); ALTER TABLE libraries FORCE ROW LEVEL SECURITY;");
    const tables = (await db.query<{ relname: string }>("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'")).map((row) => row.relname);
    expect(tables).toHaveLength(144);
    const database = (await db.query<{ name: string }>("SELECT current_database() AS name"))[0]!.name;
    // the role owns every public table, the ledger included, and may create the claim schema: nothing but FORCE can hide a row from it
    await db.exec(`CREATE ROLE sirkit_test_owner NOLOGIN NOSUPERUSER NOBYPASSRLS; GRANT CREATE ON DATABASE "${database}" TO sirkit_test_owner; ${tables.map((table) => `ALTER TABLE "${table}" OWNER TO sirkit_test_owner;`).join(" ")}`);
    await db.exec("SET ROLE sirkit_test_owner");
    try {
      expect(await publicTablesHoldingRows(db)).toEqual([]); // the owner's own count: FORCE hides the row from it
      const outcome = await requireDisposableQualificationTarget(db, "forced").then((result) => result.outcome as string, (error: QualificationTargetRefusal) => error.code);
      expect(outcome).toBe("DB_QUALIFICATION_TARGET_NOT_EMPTY");
      const refusal = await refusalOf(requireDisposableQualificationTarget(db, "forced"));
      expect(refusal.message).toMatch(/row security/);
      expect(refusal.message).toContain("libraries");
    } finally {
      await db.exec("RESET ROLE");
    }
    expect(await claimRows(db)).toBe(0);
    await db.exec("ALTER TABLE libraries NO FORCE ROW LEVEL SECURITY");
    await db.exec("SET ROLE sirkit_test_owner");
    try {
      expect(await publicTablesHoldingRows(db)).toEqual([{ table: "libraries", rows: 1 }]);
      expect((await refusalOf(requireDisposableQualificationTarget(db, "owner"))).message).toContain("libraries: 1");
    } finally {
      await db.exec("RESET ROLE");
    }
    expect(await claimRows(db)).toBe(0);
  });
});
