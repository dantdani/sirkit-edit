/**
 * [B20 B4] F4 — nothing reachable over MCP starts a process or a thread by any means this gate checks (runbook B20-B: no raw
 * shell or process; the process-spawn rule). Over the RUNTIME import closure of the three MCP routes (POST /api/mcp, POST
 * /api/mcp/token and the RFC 9728 metadata route), with the edges b20-b2-import-gates J2 and b20-b3-import-gates walk
 * (`_import-closure.ts`), no first-party module is reached that
 *  - references a process or thread module (`child_process`, `worker_threads`, `cluster`), `vm`, or ([B20 B4 lead]) `module`
 *    (it mints a `require`), with or without `node:`, by
 *    any reference the AST gate extracts (import, re-export, require and its loader aliases, dynamic import); or
 *  - [B20 B4 review] loads a built-in by name without one: `getBuiltinModule` under any static spelling (a static module name
 *    counts as that module; any other use fails closed as `getBuiltinModule(unresolved)`), `binding` of `process`, or
 *    `_linkedBinding` / `dlopen` of anything; or compiles code from a string (`eval`, the `Function` constructor, also through
 *    `.call`, `.apply` or `.bind`); [B20 B4 lead] a name spelled with an escape (`\u`, `\x`) is read as the name, and a
 *    computed key that statically spells a loader name fails closed;
 * so none of the app's five process spawners is. [B20 B4 review] The third-party packages the closure imports are not walked:
 * their exact specifiers are pinned to a reviewed list (a new package, or a new subpath of a reviewed one, fails). Not
 * analysed: code inside those packages; a member name computed at run time; `binding`, `eval` or `Function` reached through
 * an alias of `process`, of a global object or of `Function`; and reflection (`Reflect`, property descriptors). J2 forbids
 * only the kicad-cli runner (under pcb/fab), so until B4 the dispatch header's "or run a process (J2)" held for four of the
 * five spawners by absence alone (F4). [B20 B4 lead] The gate is a tripwire against a spawner reaching MCP by accident; review
 * stays the guarantee against a deliberate one, as OD-81 says of the directive filter.
 */
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap, type ModuleReference } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { importClosure, runtimeDeclarationSpecifiers } from "./_import-closure";

const ROOT = process.cwd();
const production = collectProductionFiles(ROOT);
const ENDPOINT = "app/api/mcp/route.ts";
const ROUTES = [ENDPOINT, "app/api/mcp/token/route.ts", "app/.well-known/oauth-protected-resource/api/mcp/route.ts"] as const;
/** The node built-ins that start a process or a thread, or ([B20 B4 review]) compile code from a string (`vm`), or ([B20 B4
 *  lead]) mint a loader that can load any of them (`module`: `createRequire`): a bare or `node:` specifier, or a subpath. */
const PROCESS_MODULE = /^(?:node:)?(?:child_process|worker_threads|cluster|vm|module)(?:\/|$)/;
/** The app's process spawners: the non-test files under app/ that name child_process and call spawn( on 4299067. */
const APP_SPAWNERS = [
  "app/api/simulate/route.ts",
  "app/api/spice/models/smoke-test/route.ts",
  "app/lib/pcb/autoroute/runner.ts",
  "app/lib/pcb/fab/kicad-cli-runner.ts",
  "app/lib/spice/server/worker.ts",
];
/**
 * [B20 B4 review] The exact bare specifiers of third-party packages the MCP routes import at run time, reviewed on 4299067:
 * in the installed version of each (and of its runtime dependencies) no file names `child_process`, `worker_threads`,
 * `cluster` or `getBuiltinModule`, except `openai/helpers/audio`, which spawns ffmpeg and is NOT on this list. Adding a
 * package or a subpath is a reviewed move of this list (mcp-server-proposals.md section 6 names each one).
 */
const REVIEWED_PACKAGES: ReadonlySet<string> = new Set([
  "@supabase/ssr",
  "drizzle-orm",
  "drizzle-orm/pg-core",
  "drizzle-orm/postgres-js",
  "drizzle-orm/supabase",
  "flatbush",
  "immer",
  "openai",
  "polygon-clipping",
  "postgres",
]);
const BUILTINS = new Set(builtinModules);

const runtimeDeclarationCache = new Map<string, { source: string; specifiers: Set<string> }>();
/** A file's module references that survive to run time (the closure's rule: an `import("…")` type and a declaration whose
 *  every binding is type-only are erased). The declaration check is cached per file. */
function runtimeReferences(path: string, source: string): ModuleReference[] {
  const references = moduleReferences(path, source).filter((reference) => reference.kind !== "import-type");
  if (!references.some((reference) => reference.kind === "static-import" || reference.kind === "re-export")) return references;
  let cached = runtimeDeclarationCache.get(path);
  if (cached?.source !== source) {
    cached = { source, specifiers: runtimeDeclarationSpecifiers(path, source) };
    runtimeDeclarationCache.set(path, cached);
  }
  const runtime = cached.specifiers;
  return references.filter((reference) => !((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)));
}

/** Side-effect-free static string evaluation (a literal, parenthesized, or a `+` of those), as the AST gate's. */
function staticString(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return staticString(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left);
    const right = left === null ? null : staticString(node.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current) || ts.isSatisfiesExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;
  return current;
}
/** The member name of `x.name`, or of `x[<static string>]`, else null. */
function memberName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) return staticString(node.argumentExpression);
  return null;
}
/** The node that spells a member's name (`.name`, or the element-access argument). */
const memberNameNode = (node: ts.PropertyAccessExpression | ts.ElementAccessExpression): ts.Node => (ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression);
const isMemberAccess = (node: ts.Node): node is ts.PropertyAccessExpression | ts.ElementAccessExpression => ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
const isProcessObject = (node: ts.Expression): boolean => { const target = unwrap(node); return (ts.isIdentifier(target) && target.text === "process") || memberName(target) === "process"; };
const isGlobalObject = (node: ts.Expression): boolean => { const target = unwrap(node); return ts.isIdentifier(target) && ["globalThis", "global", "window", "self"].includes(target.text); };
/** The prefilter: a file with none of these texts cannot hold a finding below. Each finding needs one of the names, or a
 *  static member name built by `+` from string pieces (a quote, optional closing parentheses, then `+`), or ([B20 B4 lead]) an
 *  escape (`\u`, `\x`), through which a name or a string can be spelled without its text. */
const LOADER_TEXT = /getBuiltinModule|_linkedBinding|dlopen|\beval\b|\bFunction\b|\bprocess\b|["'`]\s*\)*\s*\+|\\[ux]/;
const builtinLoadCache = new Map<string, { source: string; found: string[] }>();
/**
 * [B20 B4 review] regressions-1 / security-1: what loads a built-in, or runs code, with no module reference the AST gate
 * extracts. A member name is read when it is static (`x.name`, `x["name"]`, `x["na" + "me"]`).
 *  - `getBuiltinModule` as a member or a name: called with a static module name, that name when it is a process, thread or
 *    vm module; called otherwise, or referenced without a call (an alias, a destructured binding), `getBuiltinModule(unresolved)`;
 *  - a member `binding` of `process` (spelled on `process` itself), and a member `_linkedBinding` or `dlopen` of anything
 *    (`process.<name>`);
 *  - `eval` as a name, or as a member of a global object, and `Function` called, constructed, or as a member of a global
 *    object (`eval`, `Function`).
 */
function builtinLoadsOf(path: string, source: string): string[] {
  if (!LOADER_TEXT.test(source)) return [];
  const cached = builtinLoadCache.get(path);
  if (cached?.source === source) return cached.found;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const consumed = new Set<ts.Node>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = unwrap(node.expression);
      if ((ts.isIdentifier(callee) && callee.text === "getBuiltinModule") || (isMemberAccess(callee) && memberName(callee) === "getBuiltinModule")) {
        consumed.add(ts.isIdentifier(callee) ? callee : memberNameNode(callee));
        const first = node.arguments?.[0];
        const specifier = first === undefined ? null : staticString(first);
        if (specifier === null) found.push("getBuiltinModule(unresolved)");
        else if (PROCESS_MODULE.test(specifier)) found.push(specifier);
      }
      if (ts.isIdentifier(callee) && callee.text === "Function") found.push("Function");
    }
    if (isMemberAccess(node)) {
      const member = memberName(node);
      if (member === "getBuiltinModule" && !consumed.has(memberNameNode(node))) { consumed.add(memberNameNode(node)); found.push("getBuiltinModule(unresolved)"); }
      if ((member === "binding" && isProcessObject(node.expression)) || member === "_linkedBinding" || member === "dlopen") found.push(`process.${member}`);
      if (member === "eval" || member === "Function") {
        consumed.add(memberNameNode(node));
        if (isGlobalObject(node.expression)) found.push(member);
      }
    }
    // [B20 B4 lead] a computed key that statically spells a loader name (a destructuring key or an object key) fails closed,
    // and `Function` reached through .call / .apply / .bind is the Function constructor called
    if (ts.isComputedPropertyName(node)) {
      const key = staticString(node.expression);
      const literal = unwrap(node.expression);
      if (key === "getBuiltinModule") { consumed.add(literal); found.push("getBuiltinModule(unresolved)"); }
      else if (key === "eval" || key === "Function") { consumed.add(literal); found.push(key); }
      else if (key === "_linkedBinding" || key === "dlopen") { consumed.add(literal); found.push(`process.${key}`); }
    }
    if (isMemberAccess(node) && ["call", "apply", "bind"].includes(memberName(node) ?? "")) {
      const target = unwrap(node.expression);
      if (ts.isIdentifier(target) && target.text === "Function") found.push("Function");
    }
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === "getBuiltinModule" && !consumed.has(node)) found.push("getBuiltinModule(unresolved)");
    if (ts.isIdentifier(node) && node.text === "eval" && !consumed.has(node)) found.push("eval");
    ts.forEachChild(node, visit);
  };
  visit(file);
  builtinLoadCache.set(path, { source, found });
  return found;
}

/** The process, thread and vm modules a file references at RUN time, then what it loads or compiles without a reference. */
function processModulesOf(path: string, source: string): string[] {
  const named = moduleReferences(path, source).some((reference) => reference.kind !== "import-type" && PROCESS_MODULE.test(reference.specifier))
    ? runtimeReferences(path, source).filter((reference) => PROCESS_MODULE.test(reference.specifier)).map((reference) => reference.specifier)
    : [];
  return [...named, ...builtinLoadsOf(path, source)];
}
/** The third-party package specifiers a file imports at run time (bare, and not a node built-in). */
function packageSpecifiersOf(path: string, source: string): string[] {
  return runtimeReferences(path, source).map((reference) => reference.specifier)
    .filter((specifier) => resolveSpecifier(path, specifier).kind === "bare" && !specifier.startsWith("node:") && !BUILTINS.has(specifier) && !BUILTINS.has(specifier.split("/")[0]!));
}
/** Every production file that references a process, thread or vm module, or loads or compiles without a reference. */
function processImporters(files: FileMap): string[] {
  return [...files].filter(([path, source]) => processModulesOf(path, source).length > 0).map(([path]) => path).sort();
}
/** Each third-party specifier the closure imports at run time, with the chain to its first importer. */
function packagesReached(files: FileMap, entries: readonly string[]): Map<string, string> {
  const reached = new Map<string, string>();
  for (const [path, chain] of importClosure(files, entries)) {
    for (const specifier of packageSpecifiersOf(path, files.get(path)!)) if (!reached.has(specifier)) reached.set(specifier, chain.join(" -> "));
  }
  return reached;
}
/** The closure members that fail the gate, each as the chain that reaches it and what it names: a process, thread or vm
 *  module, a load or compile without a reference, or `package <specifier>` for an unreviewed third-party specifier. */
function processReached(files: FileMap, entries: readonly string[]): string[] {
  const findings: string[] = [];
  for (const [path, chain] of importClosure(files, entries)) {
    const source = files.get(path)!;
    const named = [...processModulesOf(path, source), ...packageSpecifiersOf(path, source).filter((specifier) => !REVIEWED_PACKAGES.has(specifier)).map((specifier) => `package ${specifier}`)];
    if (named.length > 0) findings.push(`${chain.join(" -> ")} => ${named.join(",")}`);
  }
  return findings.sort();
}

describe("[B20 B4] the MCP routes reach no process or thread module (F4)", () => {
  it("1. the production tree's process and thread importers under app/ are exactly the five spawners (simulate, SPICE smoke test, autoroute runner, kicad-cli runner, SPICE worker); each names child_process", { timeout: 120_000 }, () => {
    const importers = processImporters(production);
    expect(importers.filter((path) => path.startsWith("app/"))).toEqual(APP_SPAWNERS);
    for (const spawner of APP_SPAWNERS) expect(processModulesOf(spawner, production.get(spawner)!).some((specifier) => specifier.endsWith("child_process")), spawner).toBe(true);
    // the scripts that spawn are importers too (never reachable from a route, and gated the same way)
    expect(importers.filter((path) => path.startsWith("scripts/")).length).toBeGreaterThan(0);
  });

  it("2. the runtime closure of the three MCP routes holds the served-read pipeline and the token and metadata modules, and reaches no process or thread importer: none of the five spawners, no child_process, worker_threads, cluster or vm, no built-in loaded by name, no internal binding, no string-compiled code and no unreviewed package", { timeout: 120_000 }, () => {
    for (const route of ROUTES) expect(production.has(route), route).toBe(true);
    const closure = importClosure(production, ROUTES);
    for (const member of ["app/lib/mcp/server/dispatch.ts", "app/lib/mcp/server/read-call.ts", "app/lib/mcp/server/token-issuance.ts", "app/lib/mcp/server/resource-metadata.ts", "app/lib/engineering/tool-invocation.ts", "app/lib/engineering/durable-read-bundle.ts", "app/lib/auth/route-handlers.ts"]) {
      expect(closure.has(member), member).toBe(true);
    }
    expect(closure.size).toBeGreaterThan(200); // 232 files on 4299067 (243 from every MCP-tree module)
    expect(processReached(production, ROUTES)).toEqual([]);
    for (const spawner of APP_SPAWNERS) expect(closure.get(spawner)?.join(" -> ") ?? null, spawner).toBeNull();
    expect([...closure.keys()].filter((file) => processModulesOf(file, production.get(file)!).length > 0)).toEqual([]);
  });

  it("3. tripwire: a probe reached from /api/mcp that imports a process or thread module — directly, by re-export, through a hop, by require, by a dynamic import, as cluster, or by importing an app spawner — or ([B20 B4 review]) loads one by name, reaches an internal binding, compiles a string or imports an unreviewed package, is caught with its chain; a type-only import is erased and not caught, and a static non-process built-in and a property merely named binding are not caught", { timeout: 120_000 }, () => {
    const PROBE = "app/lib/mcp/server/b4-probe.ts";
    const HOP = "app/lib/mcp/server/b4-probe-hop.ts";
    const probes: ReadonlyArray<readonly [string, string, string]> = [
      ["a direct import", 'import { spawn } from "node:child_process";\nexport const run = spawn;', `${ENDPOINT} -> ${PROBE} => node:child_process`],
      ["a bare re-export", 'export { Worker } from "worker_threads";', `${ENDPOINT} -> ${PROBE} => worker_threads`],
      ["a require", 'const cp = require("child_process");\nexport const run = cp.spawn;', `${ENDPOINT} -> ${PROBE} => child_process`],
      ["a dynamic import", 'export const load = () => import("node:worker_threads");', `${ENDPOINT} -> ${PROBE} => node:worker_threads`],
      ["cluster", 'import cluster from "node:cluster";\nexport const fork = cluster.fork;', `${ENDPOINT} -> ${PROBE} => node:cluster`],
      ["a hop", 'import { run } from "./b4-probe-hop";\nexport const x = run;', `${ENDPOINT} -> ${PROBE} -> ${HOP} => node:child_process`],
      ["an app spawner", 'import * as runner from "../../pcb/autoroute/runner";\nexport const x = runner;', `${ENDPOINT} -> ${PROBE} -> app/lib/pcb/autoroute/runner.ts => child_process`],
      // [B20 B4 review] regressions-1 / security-1: a built-in loaded by name, an internal binding, string-compiled code and a
      // third-party package carry no module reference of first-party code, so the first B4 gate passed each of these
      ["process.getBuiltinModule", 'export const cp = process.getBuiltinModule("node:child_process");', `${ENDPOINT} -> ${PROBE} => node:child_process`],
      ["globalThis.process.getBuiltinModule", 'export const w = globalThis.process.getBuiltinModule("worker_threads");', `${ENDPOINT} -> ${PROBE} => worker_threads`],
      ["getBuiltinModule by element access", 'export const cp = process["getBuiltinModule"]("child_process");', `${ENDPOINT} -> ${PROBE} => child_process`],
      ["getBuiltinModule by a concatenated member name", 'export const cp = process["getBuilt" + "inModule"]("node:" + "child_process");', `${ENDPOINT} -> ${PROBE} => node:child_process`],
      ["getBuiltinModule by a concatenated member name and a computed module name", 'const name = ["node", "worker_threads"].join(":");\nexport const w = process["getBuilt" + "inModule"](name);', `${ENDPOINT} -> ${PROBE} => getBuiltinModule(unresolved)`],
      ["process.binding by a concatenated member name", 'export const sync = (process as unknown as Record<string, (name: string) => unknown>)["bin" + "ding"]("spawn_sync");', `${ENDPOINT} -> ${PROBE} => process.binding`],
      ["getBuiltinModule destructured", 'const { getBuiltinModule } = process;\nexport const c = getBuiltinModule("node:cluster");', `${ENDPOINT} -> ${PROBE} => getBuiltinModule(unresolved),node:cluster`],
      ["getBuiltinModule of a computed name", 'const name = ["node", "child_process"].join(":");\nexport const cp = process.getBuiltinModule(name);', `${ENDPOINT} -> ${PROBE} => getBuiltinModule(unresolved)`],
      ["process.binding", 'export const sync = (process as unknown as { binding(name: string): unknown }).binding("spawn_sync");', `${ENDPOINT} -> ${PROBE} => process.binding`],
      ["process.dlopen", 'export const load = (m: { exports: unknown }, file: string) => process.dlopen(m, file);', `${ENDPOINT} -> ${PROBE} => process.dlopen`],
      ["dlopen on an alias of process", 'const host = process;\nexport const load = (m: { exports: unknown }, file: string) => host.dlopen(m, file);', `${ENDPOINT} -> ${PROBE} => process.dlopen`],
      ["eval", 'export const run = (code: string): unknown => eval(code);', `${ENDPOINT} -> ${PROBE} => eval`],
      ["eval by a concatenated member name of globalThis", 'export const run = (code: string): unknown => (globalThis as unknown as Record<string, (c: string) => unknown>)["ev" + "al"](code);', `${ENDPOINT} -> ${PROBE} => eval`],
      ["new Function", 'export const compile = (code: string) => new Function(code);', `${ENDPOINT} -> ${PROBE} => Function`],
      ["node:vm", 'import { runInThisContext } from "node:vm";\nexport const run = runInThisContext;', `${ENDPOINT} -> ${PROBE} => node:vm`],
      ["an unreviewed package", 'import { execa } from "execa";\nexport const run = execa;', `${ENDPOINT} -> ${PROBE} => package execa`],
      ["an unreviewed subpath of a reviewed package", 'export * from "openai/helpers/audio";', `${ENDPOINT} -> ${PROBE} => package openai/helpers/audio`],
      // [B20 B4 lead] the check's three new issues: a name spelled by an escape (the text prefilter skipped the file), the
      // `module` built-in (a loader: `createRequire`), a computed key that spells a loader name, and `Function` through .call/.apply
      ["getBuiltinModule spelled with a unicode escape", 'export const cp = globalThis.\\u0070rocess.\\u0067etBuiltinModule("node:child_process");', `${ENDPOINT} -> ${PROBE} => node:child_process`],
      ["eval spelled with a unicode escape", 'export const run = (c: string): unknown => \\u0065val(c);', `${ENDPOINT} -> ${PROBE} => eval`],
      ["getBuiltinModule as a hex-escaped member name", 'export const cp = (globalThis as unknown as Record<string, Record<string, (m: string) => unknown>>)["\\x70rocess"]["\\x67etBuiltinModule"]("child_process");', `${ENDPOINT} -> ${PROBE} => child_process`],
      ["getBuiltinModule of module, then createRequire by element access", 'export const run = (cmd: string) => process.getBuiltinModule("module")["createRequire"](import.meta.url)("node:child_process").execFileSync(cmd);', `${ENDPOINT} -> ${PROBE} => module`],
      ["node:module imported", 'import { createRequire } from "node:module";\nexport const req = createRequire(import.meta.url);', `${ENDPOINT} -> ${PROBE} => node:module`],
      ["getBuiltinModule by a concatenated computed destructuring key", 'const { ["getBuilt" + "inModule"]: load } = process;\nexport const cp = load("node:child_process");', `${ENDPOINT} -> ${PROBE} => getBuiltinModule(unresolved)`],
      ["eval by a computed destructuring key of globalThis", 'const { ["ev" + "al"]: run } = globalThis as unknown as Record<string, (c: string) => unknown>;\nexport const go = run;', `${ENDPOINT} -> ${PROBE} => eval`],
      ["Function.call", 'export const compile = (code: string) => Function.call(null, code);', `${ENDPOINT} -> ${PROBE} => Function`],
      ["Function.apply", 'export const compile = (code: string) => Function.apply(null, [code]);', `${ENDPOINT} -> ${PROBE} => Function`],
    ];
    const routed = `${production.get(ENDPOINT)!}\nimport "../../lib/mcp/server/b4-probe";\n`;
    for (const [label, probe, expected] of probes) {
      const injected = new Map(production);
      injected.set(ENDPOINT, routed);
      injected.set(PROBE, probe);
      injected.set(HOP, 'import { spawn } from "node:child_process";\nexport const run = spawn;');
      expect.soft(processReached(injected, ROUTES), label).toEqual([expected]);
    }
    const typeOnly = new Map(production);
    typeOnly.set(ENDPOINT, routed);
    typeOnly.set(PROBE, 'import type { ChildProcess } from "node:child_process";\nexport type T = ChildProcess;');
    expect(importClosure(typeOnly, ROUTES).has(PROBE)).toBe(true);
    expect(processReached(typeOnly, ROUTES)).toEqual([]);
    // [B20 B4 review] precision: a built-in loaded by a static name that starts nothing, and a property merely NAMED binding
    const benign = new Map(production);
    benign.set(ENDPOINT, routed);
    benign.set(PROBE, 'export const fs = process.getBuiltinModule("node:fs");\nexport const status = (item: { binding: { status: string } }) => item.binding.status;');
    expect(processReached(benign, ROUTES)).toEqual([]);
  });

  it("4. the dispatch header names this gate for processes and threads, and J2 for approve..release only (F4), and claims no more than this gate checks; every B20 page paragraph that says what the import gate proves names this gate; the endpoint route no longer says a proposal is refused until B4", () => {
    const dispatch = readFileSync(join(ROOT, "app", "lib", "mcp", "server", "dispatch.ts"), "utf8");
    const header = dispatch.slice(0, dispatch.indexOf("*/"));
    expect(header).toContain("b20-b4-process-gate");
    expect(header).not.toContain("or run a process (b20-b2-import-gates J2)");
    expect(header).not.toMatch(/B4 decides/);
    // [B20 B4 review] regressions-1 / security-1: the claim names what the gate checks, and that packages are a reviewed list
    expect.soft(header.replace(/\s*\n\s*\*\s*/g, " ")).toContain("a built-in loaded by name, an internal binding or string-compiled code, and the third-party packages it reaches are a reviewed list");
    const page = readFileSync(join(ROOT, "artifacts", "ai-control-plane-b20", "mcp-server-proposals.md"), "utf8");
    const gateSection = page.slice(page.indexOf("## 6."), page.indexOf("## 7."));
    expect.soft(gateSection).not.toContain("by any runtime reference");
    expect.soft(gateSection).toContain("Not analysed:");
    // [B20 B4 review] coverage-3: B3's pages credited J2 with "no process run"; every such statement now names this gate
    const pages = ["mcp-server-endpoint.md", "mcp-server-reads.md", "mcp-server-proposals.md", "mcp-exposure.md"];
    const uncorrected = pages.flatMap((name) => readFileSync(join(ROOT, "artifacts", "ai-control-plane-b20", name), "utf8").split(/\n(?:\s*\n|(?=\d+\. |- ))/)
      .filter((paragraph) => paragraph.includes("import gate proves") && !paragraph.includes("b20-b4-process-gate")).map((paragraph) => `${name}: ${paragraph.slice(0, 80)}`));
    expect.soft(uncorrected).toEqual([]);
    const route = readFileSync(join(ROOT, "app", "api", "mcp", "route.ts"), "utf8");
    expect(route).not.toMatch(/until B4/);
  });

  it("5. [B20 B4 review] the third-party package specifiers the three routes import at run time are exactly the reviewed list, and section 6 of the page names each one; a package outside it, or an unreviewed subpath of a reviewed one, fails the gate (case 3)", { timeout: 120_000 }, () => {
    const reached = packagesReached(production, ROUTES);
    expect([...reached.keys()].sort()).toEqual([...REVIEWED_PACKAGES].sort());
    for (const [specifier, chain] of reached) expect(chain.startsWith("app/"), specifier).toBe(true);
    const page = readFileSync(join(ROOT, "artifacts", "ai-control-plane-b20", "mcp-server-proposals.md"), "utf8");
    const gateSection = page.slice(page.indexOf("## 6."), page.indexOf("## 7."));
    for (const specifier of REVIEWED_PACKAGES) expect(gateSection, specifier).toContain(`\`${specifier}\``);
  });
});
