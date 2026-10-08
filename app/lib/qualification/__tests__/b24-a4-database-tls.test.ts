/**
 * [B24-A4] D24-3, OD-192: TLS for every non-loopback database URL. The rule (`databaseTls`, app/lib/db/connection-security.ts) is pure
 * and imports nothing; every `postgres(` call site takes its `ssl` from it, and no `includes("supabase.")` rule is left.
 *
 *  1. the rule's table: a pooler host, a direct host, an IP, a host off the old `supabase.` rule, the loopback spellings, a Unix
 *     socket, a multi-host URL, each sslmode on and off loopback, the other TLS parameters, and malformed URLs; no refusal echoes
 *     the URL or any of its segments;
 *  2. why the mode must be passed at every site: postgres-js gives an explicit `ssl` option precedence over the URL's own sslmode
 *     (node_modules/postgres/src/index.js), so the old `ssl: undefined` silently dropped a URL's `sslmode=require`;
 *  3. the census (red on 3cd7d6e): the files under app, lib, components, scripts and e2e that import `postgres` at run time are
 *     exactly the five, every `postgres(` call takes `ssl: databaseTls(<its own url>)`, and no `includes("supabase.")` remains;
 *  4. drizzle-kit connections take their TLS from `drizzle.config.ts` - RECORDED as the unsupported sixth client: drizzle-kit
 *     0.31.10 drops an `ssl` key beside `url` (its credential schema strips it) and hands the URL to postgres-js unchanged, so its
 *     TLS is only what the URL's own sslmode names; the config is unchanged (`:10`, and `:14` as b16-1b-membership-schema-parity
 *     pins it);
 *  5. the rule's module is pure: it imports nothing, reads no environment and logs nothing;
 *  6. [B24-A4 review, 2026-10-08] wherever the rule answers no TLS, every host postgres-js 3.4.9 would connect to (an oracle restating
 *     the driver's pinned parseUrl lines: the host list after the FIRST `@` when it holds a comma) is loopback or no host name;
 *  7. [B24-A4 review, 2026-10-08] the census follows a namespace import, `{ default as x }`, a destructured or whole-module dynamic
 *     import and require(), and names any run-time reference it cannot follow (planted files).
 *
 * No URL here holds a password, and nothing connects anywhere.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { databaseTls, isLoopbackDatabaseUrl, DatabaseUrlRefusal } from "../../db/connection-security";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);

/** What the rule answers for a URL: the mode, `undefined` for no TLS, or the refusal's code. */
function answer(url: string): string {
  try {
    return String(databaseTls(url));
  } catch (error) {
    if (error instanceof DatabaseUrlRefusal) return error.code;
    throw error;
  }
}

/** [url, expected answer, why] - every URL is assembled here with no password. */
const TABLE: ReadonlyArray<readonly [string, string, string]> = [
  ["postgresql://postgres.projectref@aws-0-us-east-1.pooler.supabase.com:6543/postgres", "require", "a Supabase pooler host"],
  ["postgresql://postgres@db.projectref.supabase.co:5432/postgres", "require", "a Supabase direct host"],
  ["postgres://sirkit@203.0.113.7:5432/sirkit", "require", "an IP address off loopback"],
  ["postgres://sirkit@db.internal.example:5432/sirkit", "require", "a host the old `supabase.` rule left without TLS"],
  ["postgres://sirkit@db-a.internal.example:5432,db-b.internal.example:5433/sirkit", "require", "a multi-host URL"],
  ["postgres://sirkit@localhost:5432,db.internal.example:5432/sirkit", "require", "a multi-host URL with one host off loopback"],
  ["postgres://sirkit@localhost:5432/sirkit", "undefined", "localhost"],
  ["postgres://sirkit@LOCALHOST/sirkit", "undefined", "localhost, upper case"],
  ["postgres://sirkit@localhost./sirkit", "undefined", "localhost with its root dot"],
  ["postgres://sirkit@127.0.0.1:5432/sirkit", "undefined", "127.0.0.1"],
  ["postgres://sirkit@127.10.20.30/sirkit", "undefined", "anywhere in 127.0.0.0/8"],
  ["postgres://sirkit@[::1]:5432/sirkit", "undefined", "::1"],
  ["postgres://sirkit@localhost:5432,127.0.0.1:5433/sirkit", "undefined", "a multi-host URL, every host loopback"],
  ["postgres://sirkit@%2Fvar%2Frun%2Fpostgresql/sirkit", "undefined", "a Unix socket directory"],
  ["postgres://sirkit@localhost.example.com/sirkit", "require", "a name that only starts with localhost"],
  ["postgres://sirkit@127.0.0.1.example.com/sirkit", "require", "a name that only starts with a loopback address"],
  ["postgres://sirkit@128.0.0.1/sirkit", "require", "an address just off 127.0.0.0/8"],
  ["postgres://sirkit@127.1/sirkit", "require", "a shorthand address is not read as loopback (fail closed: TLS required)"],
  ["postgres://sirkit@0.0.0.0/sirkit", "require", "the unspecified address"],
  ["postgres://sirkit@[::2]/sirkit", "require", "an IPv6 address other than ::1"],
  ["postgres://sirkit@db.internal.example/sirkit?sslmode=require", "require", "sslmode=require kept"],
  ["postgres://sirkit@db.internal.example/sirkit?sslmode=verify-ca", "verify-full", "verify-ca: kept verifying, never downgraded (postgres-js has no CA-only mode)"],
  ["postgres://sirkit@db.internal.example/sirkit?sslmode=verify-full", "verify-full", "verify-full kept"],
  ["postgres://sirkit@db.internal.example/sirkit?sslmode=disable", "DB_TLS_REQUIRED", "a weaker mode off loopback is refused"],
  ["postgres://sirkit@db.internal.example/sirkit?sslmode=allow", "DB_TLS_REQUIRED", "a weaker mode off loopback is refused"],
  ["postgres://sirkit@db.internal.example/sirkit?sslmode=prefer", "DB_TLS_REQUIRED", "a weaker mode off loopback is refused"],
  ["postgres://sirkit@localhost/sirkit?sslmode=disable", "undefined", "a weaker mode on loopback is no TLS"],
  ["postgres://sirkit@localhost/sirkit?sslmode=prefer", "undefined", "a weaker mode on loopback is no TLS"],
  ["postgres://sirkit@localhost/sirkit?sslmode=require", "require", "a stronger mode on loopback is kept"],
  ["postgres://sirkit@127.0.0.1/sirkit?sslmode=verify-full", "verify-full", "a stronger mode on loopback is kept"],
  ["postgres://sirkit@db.internal.example/sirkit?sslmode=no-verify", "DB_URL_MALFORMED", "an sslmode libpq does not define"],
  ["postgres://sirkit@db.internal.example/sirkit?ssl=true", "DB_URL_MALFORMED", "another TLS parameter, which the explicit option would silently override"],
  ["postgres://sirkit@db.internal.example/sirkit?sslrootcert=system", "DB_URL_MALFORMED", "another TLS parameter, which the explicit option would silently override"],
  ["postgres:///sirkit", "DB_URL_MALFORMED", "no host named"],
  ["mysql://sirkit@db.internal.example/sirkit", "DB_URL_MALFORMED", "not a postgres scheme"],
  ["db.internal.example:5432/sirkit", "DB_URL_MALFORMED", "no scheme"],
  ["postgres://sirkit@db internal example/sirkit", "DB_URL_MALFORMED", "a host that does not parse"],
  ["", "DB_URL_MALFORMED", "empty"],
  // [B24-A4 review, 2026-10-08] an unencoded `@` in the credentials: postgres-js reads the host list after the FIRST `@` when that
  // text holds a comma (index.js parseUrl), the URL parser after the last - so these would reach db.internal.example, or `t`, with
  // no TLS while the rule read loopback; with no comma both read the last `@` and agree
  ["postgres://sirkit@db.internal.example,y@localhost/sirkit", "DB_URL_MALFORMED", "an unencoded @ before a host list (the driver's first host is off loopback)"],
  ["postgres://sirkit@t,x@127.0.0.1:5432/sirkit", "DB_URL_MALFORMED", "an unencoded @ and a comma in the user part (the driver would try host t first)"],
  ["postgres://sirkit@extra@localhost/sirkit", "undefined", "an unencoded @ with no host list: the driver and the URL parser both read localhost"],
  ["postgres://sirkit@extra@db.internal.example/sirkit", "require", "an unencoded @ with no host list, off loopback"],
  ["postgres://sirkit,x@localhost/sirkit", "undefined", "a comma before the only @ is not a host list"],
];

/** Every source file under the five production roots (the census's scope), repository-relative. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(?:ts|tsx|mts|mjs|js)$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
  }
  return out;
}
const ROOTS = ["app", "lib", "components", "scripts", "e2e"] as const;
const parse = (path: string, text = read(path)): ts.SourceFile => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /\.(?:tsx)$/.test(path) ? ts.ScriptKind.TSX : /\.(?:m?js)$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS);

/**
 * The local names a file binds to the `postgres` package at run time, read from the syntax tree ([B24-A4 review, 2026-10-08]: no
 * longer from the text of an initializer, and no form dropped): a default import, a namespace import, `{ default as x }`, and a
 * variable initialised by `import("postgres")` or `require("postgres")` - the module or its `.default`, by name or destructured
 * `{ default: x }`. Every other run-time reference - a side-effect import, a named import other than default, a re-export, an
 * import() or require() that binds nothing - is returned as unrecognised (`<file>:<line> <text>`), so the census fails on it. A
 * type-only import binds nothing at run time and is no reference.
 */
function postgresBindings(source: ts.SourceFile): { names: string[]; unrecognised: string[] } {
  const names: string[] = [];
  const unrecognised: string[] = [];
  const at = (node: ts.Node): string => `${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${node.getText(source).replace(/\s+/g, " ").slice(0, 100)}`;
  const isPostgres = (node: ts.Node | undefined): boolean => Boolean(node && ts.isStringLiteralLike(node) && node.text === "postgres");
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isPostgres(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (!clause) unrecognised.push(at(node));
      else if (!clause.isTypeOnly) {
        if (clause.name) names.push(clause.name.text);
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) names.push(bindings.name.text);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (element.isTypeOnly) continue;
            if ((element.propertyName ?? element.name).text === "default") names.push(element.name.text);
            else unrecognised.push(at(element));
          }
        }
      }
    }
    if (ts.isExportDeclaration(node) && isPostgres(node.moduleSpecifier) && !node.isTypeOnly) unrecognised.push(at(node));
    if (ts.isCallExpression(node) && isPostgres(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      // climb through await, parentheses, `!`, `as` and one `.default` to the declaration the reference initialises
      let outer: ts.Node = node;
      while (outer.parent && (ts.isAwaitExpression(outer.parent) || ts.isParenthesizedExpression(outer.parent) || ts.isNonNullExpression(outer.parent) || ts.isAsExpression(outer.parent) || (ts.isPropertyAccessExpression(outer.parent) && outer.parent.name.text === "default"))) outer = outer.parent;
      const declaration = outer.parent;
      const bound: string[] = [];
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer === outer) {
        if (ts.isIdentifier(declaration.name)) bound.push(declaration.name.text);
        else if (ts.isObjectBindingPattern(declaration.name)) {
          for (const element of declaration.name.elements) if (ts.isIdentifier(element.name) && ((element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text) === "default")) bound.push(element.name.text);
        }
      }
      if (bound.length > 0) names.push(...bound);
      else unrecognised.push(at(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { names, unrecognised };
}

/** Every call of a bound name - `x(...)`, or `x.default(...)` for a namespace or module object - with whether its options take
 *  `ssl: databaseTls(<the same url expression>)`. */
function postgresCalls(source: ts.SourceFile, names: readonly string[]): Array<{ line: number; ok: boolean; text: string }> {
  const calls: Array<{ line: number; ok: boolean; text: string }> = [];
  const strip = (text: string): string => text.replace(/!$/, "").replace(/\s+/g, "");
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && names.includes(node.expression.text)) || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "default" && ts.isIdentifier(node.expression.expression) && names.includes(node.expression.expression.text)))) {
      const [url, options] = node.arguments;
      const ssl = options && ts.isObjectLiteralExpression(options) ? options.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(source) === "ssl") : undefined;
      const value = ssl && ts.isPropertyAssignment(ssl) ? ssl.initializer : undefined;
      const ok = Boolean(url && value && ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === "databaseTls" && value.arguments.length === 1 && strip(value.arguments[0]!.getText(source)) === strip(url.getText(source)));
      calls.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, ok, text: node.getText(source).slice(0, 160) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls;
}

/** The census over `files` (their text from `textOf`): the files that reach the `postgres` module at run time, the references to it
 *  that bind nothing the census can follow, and every call of a bound name. */
function postgresCensus(files: readonly string[], textOf: (file: string) => string = read): { importers: string[]; unrecognised: string[]; calls: Array<{ file: string; line: number; ok: boolean; text: string }> } {
  const importers: string[] = [];
  const unrecognised: string[] = [];
  const calls: Array<{ file: string; line: number; ok: boolean; text: string }> = [];
  for (const file of files) {
    const text = textOf(file);
    if (!/["']postgres["']/.test(text)) continue;
    const source = parse(file, text);
    const bindings = postgresBindings(source);
    unrecognised.push(...bindings.unrecognised);
    if (bindings.names.length === 0 && bindings.unrecognised.length === 0) continue;
    importers.push(file);
    calls.push(...postgresCalls(source, bindings.names).map((call) => ({ file, ...call })));
  }
  return { importers: importers.sort(), unrecognised, calls };
}

const FIVE = [
  "app/lib/auth/__tests__/b16-1b-live-qualification.test.ts",
  "app/lib/db/client.ts",
  "app/lib/db/migrations/postgres-executor.ts",
  "app/lib/physical-binding/__tests__/schema-integrity.test.ts",
  "scripts/backfill-mpn-and-generics.ts",
] as const;

describe("[B24-A4] TLS for every non-loopback database URL (D24-3, OD-192)", () => {
  it("1. the rule's table: require off loopback, a stronger mode kept, a weaker one refused DB_TLS_REQUIRED, no TLS on loopback or a socket, DB_URL_MALFORMED for what does not parse; no refusal echoes the URL", () => {
    const wrong = TABLE.filter(([url, expected]) => answer(url) !== expected).map(([url, expected, why]) => `${why}: ${answer(url)} (expected ${expected}) for ${url}`);
    expect(wrong).toEqual([]);
    for (const [url, expected] of TABLE) {
      if (!expected.startsWith("DB_")) continue;
      const message = (() => { try { databaseTls(url); return ""; } catch (error) { return (error as Error).message; } })();
      expect(message.startsWith(`${expected}: `), url).toBe(true);
      // the scheme and libpq's six mode words are a closed vocabulary, not URL content
      const segments = url.split(/[/:@?=&,%[\]]+/).filter((segment) => segment.length > 3 && !["postgres", "postgresql", "sslmode", "mysql", "disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(segment));
      for (const segment of segments) expect(message, `${url} -> ${segment}`).not.toContain(segment);
    }
    // the loopback rule the acceptance driver reuses (qualification-target.ts) is the same rule
    expect(isLoopbackDatabaseUrl("postgres://sirkit@127.0.0.1/sirkit")).toBe(true);
    expect(isLoopbackDatabaseUrl("postgres://sirkit@%2Ftmp/sirkit")).toBe(true);
    expect(isLoopbackDatabaseUrl("postgresql://postgres@db.projectref.supabase.co:5432/postgres")).toBe(false);
    expect(() => isLoopbackDatabaseUrl("not a url")).toThrow(/^DB_URL_MALFORMED: /);
  });

  it("2. why every site must pass the mode: postgres-js takes an explicit `ssl` option over the URL's sslmode, so the old `ssl: undefined` dropped a URL's own sslmode=require on every host but `supabase.` ones", () => {
    const driver = read("node_modules/postgres/src/index.js");
    expect(driver).toContain("query.sslmode && (query.ssl = query.sslmode, delete query.sslmode)");
    expect(driver).toMatch(/const value = k in o \? o\[k\] : k in query/);
    // the old rule, restated: TLS only for a URL containing `supabase.`; every other non-loopback row of the table went without
    const marker = ["supabase", "."].join(""); // assembled, so this file is no hit of case 3's census
    const oldRule = (url: string): string | undefined => (url.includes(marker) ? "require" : undefined);
    const dropped = TABLE.filter(([url, expected]) => (expected === "require" || expected === "verify-full") && oldRule(url) === undefined).map(([url]) => url);
    expect(dropped.length).toBeGreaterThanOrEqual(12);
  });

  it("3. the census (red on 3cd7d6e): exactly five files import postgres at run time, every postgres( call takes ssl from databaseTls with its own url, and no includes(\"supabase.\") rule remains", { timeout: 60_000 }, () => {
    const files = ROOTS.flatMap((root) => sourceFiles(join(ROOT, root)));
    expect(files.length).toBeGreaterThan(1_000);
    const { importers, unrecognised, calls } = postgresCensus(files);
    expect(importers).toEqual([...FIVE]);
    expect(unrecognised).toEqual([]);
    expect(calls.map((call) => call.file).sort()).toEqual([...FIVE]);
    expect(calls.filter((call) => !call.ok).map((call) => `${call.file}:${call.line} ${call.text}`)).toEqual([]);
    for (const file of importers) expect(read(file), file).toMatch(/\bdatabaseTls\b/);
    const supabaseRule = files.filter((file) => /includes\(\s*["']supabase\.["']\s*\)/.test(read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")));
    expect(supabaseRule).toEqual([]);
    // the guard's own connection goes through the migration executor, so the rule covers it too (qualification-target.ts)
    expect(read("app/lib/db/qualification-target.ts")).toMatch(/createPostgresMigrationExecutor\(url\)/);
  });

  it("4. drizzle-kit connections take their TLS from drizzle.config.ts - RECORDED as the unsupported sixth client: drizzle-kit 0.31.10 strips an ssl key beside url and hands the URL to postgres-js as is, so its TLS is only the URL's own sslmode; the config is unchanged", () => {
    const config = read("drizzle.config.ts").split(NEWLINE);
    expect(config[9]).toBe("  dbCredentials: { url: process.env.DATABASE_URL! },");
    expect(config[13]).toBe('  entities: { roles: { provider: "supabase" } },');
    expect(config.join(NEWLINE)).not.toMatch(/\bssl\b/);
    expect(read("node_modules/drizzle-kit/package.json")).toMatch(/"version": "0\.31\.10"/);
    const kit = read("node_modules/drizzle-kit/bin.cjs");
    const schema = kit.slice(kit.indexOf("postgresCredentials = unionType(["), kit.indexOf("printConfigConnectionIssues4 ="));
    expect(schema.length).toBeGreaterThan(200);
    // the url form is an object of driver and url only (zod strips every other key); the ssl key exists only in the host form
    expect(schema).toMatch(/objectType\(\{\s*driver: undefinedType\(\),\s*url: stringType\(\)\.min\(1\)\s*\}\)/);
    expect(kit).toContain('const client = "url" in credentials2 ? postgres.default(credentials2.url, { max: 1 }) : postgres.default({ ...credentials2, max: 1 });');
    expect(existsSync(join(ROOT, "node_modules/pg/package.json"))).toBe(false); // so drizzle-kit takes its postgres-js path, not pg's
  });

  it("5. the rule's module is pure: it imports nothing, reads no environment, logs nothing", () => {
    const code = read("app/lib/db/connection-security.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/\bimport\b|\brequire\(/);
    expect(code).not.toMatch(/process\.|console\./);
  });

  it("6. [B24-A4 review, 2026-10-08] the rule reads the hosts as the driver does: wherever it answers no TLS, every host postgres-js 3.4.9 would connect to is loopback or no host name at all; the driver lines the oracle restates are pinned", () => {
    const driver = read("node_modules/postgres/src/index.js");
    for (const line of [
      "host = host.slice(host.indexOf('://') + 3).split(/[?/]/)[0]",
      "host = decodeURIComponent(host.slice(host.indexOf('@') + 1))",
      "const urlObj = new URL(url.replace(host, host.split(',')[0]))",
      "multihost: host.indexOf(',') > -1 && host",
      ", host = o.hostname || o.host || multihost || url.hostname || env.PGHOST || 'localhost'",
      "host            : Array.isArray(host) ? host : host.split(',').map(x => x.split(':')[0]),",
    ]) expect(driver, line).toContain(line);
    // the driver's hosts for a URL, restating those lines: the text after the FIRST `@` when it holds a comma, else the URL parser's
    const driverHosts = (url: string): string[] => {
      let host = url.slice(url.indexOf("://") + 3).split(/[?/]/)[0]!;
      host = decodeURIComponent(host.slice(host.indexOf("@") + 1));
      const hostname = new URL(url.replace(host, host.split(",")[0]!)).hostname;
      const chosen = (host.indexOf(",") > -1 && host) || hostname;
      return chosen.split(",").map((part) => part.split(":")[0]!);
    };
    // a name the driver could resolve: letters, digits, dots and hyphens (an IPv4 literal included); `%`-encoded or bracketed text is none
    const resolvable = (host: string): boolean => /^[A-Za-z0-9.-]+$/.test(host);
    const noTls = TABLE.filter(([url]) => answer(url) === "undefined").map(([url]) => url);
    expect(noTls.length).toBeGreaterThanOrEqual(12);
    const reached = noTls.flatMap((url) => driverHosts(url).filter((host) => resolvable(host) && !isLoopbackDatabaseUrl(`postgres://${host}/x`)).map((host) => `${url} -> ${host}`));
    expect(reached).toEqual([]);
    // the oracle is not vacuous: for the two URLs with an unencoded `@` before a host list, the driver's first host is off loopback
    expect(driverHosts("postgres://sirkit@db.internal.example,y@localhost/sirkit")[0]).toBe("db.internal.example");
    expect(driverHosts("postgres://sirkit@t,x@127.0.0.1:5432/sirkit")[0]).toBe("t");
  });

  it("7. [B24-A4 review, 2026-10-08] the census follows every way a file can bind the postgres module at run time - a namespace, `{ default as x }`, a destructured or whole-module dynamic import, require() - and names any reference it cannot follow, so a sixth client cannot drop out of it", () => {
    const planted: Record<string, string> = {
      "scripts/planted-namespace.ts": `import * as pg from "postgres";${NEWLINE}export const sql = pg.default(process.argv[2]!, { ssl: false });`,
      "scripts/planted-destructured.ts": `export async function open(url: string) {${NEWLINE}  const { default: pg } = await import("postgres");${NEWLINE}  return pg(url);${NEWLINE}}`,
      "scripts/planted-default-alias.ts": `import { default as pg } from "postgres";${NEWLINE}export const sql = pg(process.argv[2]!);`,
      "scripts/planted-module-object.ts": `export async function open(url: string) {${NEWLINE}  const driver = await import("postgres");${NEWLINE}  return driver.default(url, { ssl: "require" });${NEWLINE}}`,
      "scripts/planted-required.ts": `const pg = require("postgres");${NEWLINE}module.exports = pg(process.argv[2]);`,
      "scripts/planted-reexport.ts": `export { default } from "postgres";`,
      "scripts/planted-bare.ts": `export const load = () => import("postgres");`,
      "scripts/planted-ok.ts": `import postgres from "postgres";${NEWLINE}import { databaseTls } from "../app/lib/db/connection-security";${NEWLINE}export const open = (url: string) => postgres(url, { max: 1, ssl: databaseTls(url) });`,
      "scripts/planted-types-only.ts": `import type { Sql } from "postgres";${NEWLINE}export type Client = Sql;`,
      "scripts/planted-word-only.ts": `export const provider = { kind: "postgres" };`,
    };
    const census = postgresCensus(Object.keys(planted), (file) => planted[file]!);
    // every file that reaches the module at run time is in the census; a type-only import and a mere string are not
    expect(census.importers).toEqual(Object.keys(planted).filter((file) => !/(?:types|word)-only\.ts$/.test(file)).sort());
    // the references it cannot follow fail it by name
    expect([...new Set(census.unrecognised.map((entry) => entry.split(" ")[0]))].sort()).toEqual(["scripts/planted-bare.ts:1", "scripts/planted-reexport.ts:1"]);
    // every call it can follow is checked; only planted-ok's takes its ssl from databaseTls
    expect(census.calls.map((call) => `${call.file} ${call.ok}`).sort()).toEqual([
      "scripts/planted-default-alias.ts false",
      "scripts/planted-destructured.ts false",
      "scripts/planted-module-object.ts false",
      "scripts/planted-namespace.ts false",
      "scripts/planted-ok.ts true",
      "scripts/planted-required.ts false",
    ]);
  });
});
