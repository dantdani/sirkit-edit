/**
 * [B20 B2] The one route-tree helper (D-12, OD-66): every route inventory walks `app/api` AND `app/.well-known` through
 * `app/lib/auth/route-tree.ts`, so a route file under either root is counted by the census, the policy bijection, the B01
 * coverage, the wrapper adoption, the matrices and the confinement gates alike. Below a root the walker skips only what Next
 * never serves (`__tests__`) and dependencies: dot and route-group directories are walked, because Next's route discovery
 * has no dot filter (it serves `app/.well-known` itself). `app/.well-known` is pinned to exactly one reviewed file, every
 * route handler Next would serve from app/ is one the helper lists, and no other file under app/ or scripts/ carries a
 * route-file matcher of its own.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_TREE_ROOTS, isRouteTreePath, listRouteFiles, listRouteFilesWith, routePathOf, type RouteTreeFs } from "../route-tree";
import { classifyRouteMethodForm, exportedHttpMethods } from "./_boundary-analysis";

const ROOT = process.cwd();
/** the route file name, assembled so this file never carries a matcher itself */
const ROUTE_FILE = ["route", "ts"].join(".");
/** the route file name as a regular-expression source, assembled for the same reason */
const ROUTE_RX = ["route", "ts"].join("\\.");
const METADATA_ROUTE = "app/.well-known/oauth-protected-resource/api/mcp/route.ts";
const rel = (file: string): string => relative(ROOT, file).replaceAll("\\", "/");
const posix = (path: string): string => path.replaceAll("\\", "/");

/**
 * The route-file matchers the tripwire forbids outside route-tree.ts, built at run time: a quoted route-file name compared
 * with `==`/`===`/`!=`/`!==` (either side, any quote, with or without a leading slash), passed to `.endsWith(`, used as a
 * `case` label or bound to a named constant, and the name spelled as a regular expression (its dot escaped, in a regex
 * literal or inside a string) anywhere except as the first argument of `.replace(` (path mapping stays allowed).
 */
const QUOTED = `(["'\`])\\/?${ROUTE_RX}\\1`;
const MATCHERS: readonly RegExp[] = [
  new RegExp(`[=!]==?\\s*${QUOTED}`),
  new RegExp(`${QUOTED}\\s*[=!]==?`),
  new RegExp(`\\.endsWith\\(\\s*(["'\`])[^"'\`\\n]*${ROUTE_RX}\\1`),
  new RegExp(`\\bcase\\s+${QUOTED}\\s*:`),
  new RegExp(`\\b(?:const|let|var)\\s+[A-Za-z_$][\\w$]*\\s*(?::\\s*string\\s*)?=\\s*${QUOTED}`),
];
const REGEX_SPELLINGS: readonly RegExp[] = [new RegExp(["route", "ts"].join(String.raw`\\\.`)), new RegExp(["route", "ts"].join(String.raw`\\\\\.`))];
const REPLACE_REGEX_ARGUMENT = /\.replace\(\s*\/(?:\\.|[^/\\\n])+\/[a-z]*\s*,/g;
function carriesRouteMatcher(source: string): boolean {
  if (MATCHERS.some((matcher) => matcher.test(source))) return true;
  const withoutPathMapping = source.replace(REPLACE_REGEX_ARGUMENT, "");
  return REGEX_SPELLINGS.some((spelling) => spelling.test(withoutPathMapping));
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs|mts)$/.test(entry)) out.push(full);
  }
  return out;
}

/** A read-only virtual tree of repository-relative files under the root `/v`, spoken through the walker's seam. */
function virtualTree(files: readonly string[]): RouteTreeFs {
  const dirs = new Map<string, Set<string>>();
  const leaves = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    leaves.add(`/v/${file}`);
    for (let index = 0; index < parts.length; index += 1) {
      const parent = ["/v", ...parts.slice(0, index)].join("/");
      if (!dirs.has(parent)) dirs.set(parent, new Set());
      dirs.get(parent)!.add(parts[index]!);
    }
  }
  return {
    existsSync: (path) => dirs.has(posix(path)) || leaves.has(posix(path)),
    readdirSync: (path) => [...(dirs.get(posix(path)) ?? [])].sort(),
    statSync: (path) => ({ isDirectory: () => dirs.has(posix(path)) }),
  };
}

/** Next's route-handler file names (`route` plus a page extension; every source extension is taken, to stay conservative). */
const ROUTE_HANDLER_NAME = new RegExp(`^${["route", "(?:tsx?|jsx?|mjs|cjs|mts|cts)"].join("\\.")}$`);
/** The route handlers Next would serve (no `_`-prefixed part: Next ignores private folders) that the helper does not list. */
function unlistedServedRouteFiles(appRelPaths: readonly string[], listed: readonly string[]): string[] {
  const inventory = new Set(listed);
  return appRelPaths.filter((path) => {
    const parts = path.split("/");
    if (parts.some((part) => part.startsWith("_") || part === "node_modules")) return false;
    return ROUTE_HANDLER_NAME.test(parts.at(-1)!) && !inventory.has(path);
  });
}

describe("[B20 B2] C — the route-tree helper", () => {
  it("1. the roots are exact, and the helper's app/api subset equals a plain recursive listing (only tests and dependencies excluded)", () => {
    expect([...ROUTE_TREE_ROOTS]).toEqual(["app/api", "app/.well-known"]);
    const listed = listRouteFiles(ROOT).map(rel);
    expect(listed).toEqual([...listed].sort());
    const plain = (readdirSync(join(ROOT, "app", "api"), { recursive: true }) as string[])
      .map((entry) => entry.replaceAll("\\", "/"))
      .filter((entry) => basename(entry) === ROUTE_FILE && !entry.split("/").some((part) => part === "__tests__" || part === "node_modules"))
      .map((entry) => `app/api/${entry}`)
      .sort();
    expect(listed.filter((file) => file.startsWith("app/api/"))).toEqual(plain);
    expect(plain.length).toBeGreaterThan(100);
    expect(listed.filter((file) => !file.startsWith("app/api/"))).toEqual([METADATA_ROUTE]);
    expect(listRouteFiles(join(ROOT, "no-such-root-b20"))).toEqual([]);
  });

  it("2. app/.well-known holds exactly one file, the metadata route, exporting only GET through publicRoute", () => {
    const files = (readdirSync(join(ROOT, "app", ".well-known"), { recursive: true }) as string[])
      .map((entry) => `app/.well-known/${entry.replaceAll("\\", "/")}`)
      .filter((entry) => statSync(join(ROOT, entry)).isFile());
    expect(files).toEqual([METADATA_ROUTE]);
    const file = join(ROOT, METADATA_ROUTE);
    const source = readFileSync(file, "utf8");
    expect(exportedHttpMethods(source, file)).toEqual(["GET"]);
    expect(classifyRouteMethodForm(source, "GET", file, ROOT)).toEqual({ form: "canonical-wrapper", wrapper: "publicRoute" });
  });

  it("3. tripwire: no file under app/ or scripts/ except route-tree.ts carries a route-file matcher, in any common spelling; synthetic offenders of every form are caught", { timeout: 120_000 }, () => {
    const offenders = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "scripts"))]
      .filter((file) => carriesRouteMatcher(readFileSync(file, "utf8")))
      .map(rel);
    expect(offenders).toEqual(["app/lib/auth/route-tree.ts"]);
    const [dq, sq, bq] = ['"', "'", "`"];
    const regexSpelling = ROUTE_RX;
    const stringSpelling = ["route", "ts"].join("\\\\.");
    const synthetic = [
      `else if (entry === ${dq}${ROUTE_FILE}${dq}) out.push(full);`,
      `files.filter((file) => /\\/${regexSpelling}$/.test(file))`,
      ...[dq, sq, bq].map((q) => `if (entry.endsWith(${q}${ROUTE_FILE}${q})) out.push(full);`),
      `files.filter((file) => file.endsWith(${dq}/${ROUTE_FILE}${dq}))`,
      `if (name === ${sq}${ROUTE_FILE}${sq}) count += 1;`,
      `if (${dq}${ROUTE_FILE}${dq} === basename(file)) count += 1;`,
      `if (name !== ${dq}${ROUTE_FILE}${dq}) continue;`,
      `if (name == ${dq}/${ROUTE_FILE}${dq}) continue;`,
      `switch (entry) { case ${dq}${ROUTE_FILE}${dq}: out.push(full); }`,
      `const ROUTE_NAME = ${dq}${ROUTE_FILE}${dq};`,
      `const ROUTE_NAME: string = ${sq}${ROUTE_FILE}${sq};`,
      `files.filter((file) => /(^|\\/)${regexSpelling}$/.test(file))`,
      `const hit = file.match(/${regexSpelling}$/);`,
      `const pattern = new RegExp(${dq}${stringSpelling}$${dq});`,
    ];
    for (const source of synthetic) expect(carriesRouteMatcher(source), source).toBe(true);
    // path mapping, a path built from segments and a default parameter stay allowed
    const allowed = [
      `const path = "/" + rel.replace(/^app\\//, "").replace(/\\/${regexSpelling}$/, "");`,
      `readFileSync(join(ROOT, ${dq}app${dq}, ${dq}api${dq}, ${dq}chat${dq}, ${dq}${ROUTE_FILE}${dq}), "utf8")`,
      `export function exportedHttpMethods(source: string, filePath = ${dq}${ROUTE_FILE}${dq}): string[] {`,
    ];
    for (const source of allowed) expect(carriesRouteMatcher(source), source).toBe(false);
  });

  it("4. the identity-header gate and the CI gates filter route handlers through isRouteTreePath, not an app/api prefix", () => {
    const header = readFileSync(join(ROOT, "app", "api", "__tests__", "b16-0-identity-header-gate.test.ts"), "utf8");
    expect(header).toContain("isRouteTreePath(");
    expect(header).not.toContain('startsWith("app/api/")');
    const gates = readFileSync(join(ROOT, "app", "lib", "auth", "__tests__", "b16-0-1-ci-gates.test.ts"), "utf8");
    expect(gates).toMatch(/const apiFiles = new Map\(\[\.\.\.production\]\.filter\(\(\[path\]\) => isRouteTreePath\(path\)\)\);/);
    // the one remaining app/api prefix there is the server-auth import confinement, which stays (C2 pins app/.well-known instead)
    const prefixes = gates.split("\n").filter((line) => line.includes('startsWith("app/api/")'));
    expect(prefixes).toHaveLength(1);
    expect(prefixes[0]).toContain('!path.startsWith("app/lib/auth/")');
    expect(isRouteTreePath("app/api/mcp/route.ts")).toBe(true);
    expect(isRouteTreePath("app/.well-known/oauth-protected-resource/api/mcp/route.ts")).toBe(true);
    expect(isRouteTreePath("app/apix/route.ts")).toBe(false);
    expect(isRouteTreePath("app/api")).toBe(false);
    expect(isRouteTreePath("app/lib/api/route.ts")).toBe(false);
  });

  it("5. routePathOf maps both roots to their URL paths", () => {
    expect(routePathOf(ROOT, join(ROOT, METADATA_ROUTE))).toBe("/.well-known/oauth-protected-resource/api/mcp");
    expect(routePathOf(ROOT, join(ROOT, "app", "api", "chat", ROUTE_FILE))).toBe("/api/chat");
    expect(routePathOf(ROOT, join(ROOT, "app", "api", "parts", "[id]", ROUTE_FILE))).toBe("/api/parts/[id]");
  });

  it("6. tsconfig includes app/.well-known explicitly (TypeScript wildcards skip dot-directories)", () => {
    const tsconfig = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8")) as { include: string[] };
    expect(tsconfig.include).toContain("app/.well-known/**/*.ts");
  });

  it("7. below a root the walker skips only __tests__ and node_modules: route files under dot and route-group directories are counted", () => {
    const at = (path: string): string => `${path}/${ROUTE_FILE}`;
    const tree = virtualTree([
      at("app/api/chat"),
      at("app/api/.internal"),
      at("app/api/.v2/mcp"),
      at("app/api/(group)/feed"),
      at("app/api/__tests__"),
      at("app/api/node_modules/pkg"),
      "app/api/chat/route.test.ts",
      at("app/.well-known/oauth-protected-resource/api/mcp"),
      at("app/.well-known/.hidden"),
      at("app/lib/not-a-root"),
    ]);
    const listed = listRouteFilesWith("/v", tree).map((file) => posix(file).replace(/^\/v\//, ""));
    expect(listed).toEqual([
      at("app/.well-known/.hidden"),
      at("app/.well-known/oauth-protected-resource/api/mcp"),
      at("app/api/(group)/feed"),
      at("app/api/.internal"),
      at("app/api/.v2/mcp"),
      at("app/api/chat"),
    ]);
    expect(listRouteFilesWith("/v", virtualTree([at("app/lib/x")]))).toEqual([]);
  });

  it("8. every route handler Next would serve from app/ (dot and group directories included) is a route.ts the helper lists; synthetic strays are caught", () => {
    const all = (readdirSync(join(ROOT, "app"), { recursive: true }) as string[]).map((entry) => `app/${entry.replaceAll("\\", "/")}`);
    const listed = listRouteFiles(ROOT).map(rel);
    expect(listed).toContain(METADATA_ROUTE);
    expect(unlistedServedRouteFiles(all, listed)).toEqual([]);
    const strays = [`app/(marketing)/feed/${ROUTE_FILE}`, `app/.other/x/${ROUTE_FILE}`, "app/api/legacy/route.js", "app/api/tsx/route.tsx", "app/rss/route.mjs"];
    const ignored = [`app/api/__tests__/${ROUTE_FILE}`, `app/_private/x/${ROUTE_FILE}`, "app/api/chat/route.test.ts"];
    expect(unlistedServedRouteFiles([...all, ...strays, ...ignored], listed)).toEqual(strays);
  });
});
