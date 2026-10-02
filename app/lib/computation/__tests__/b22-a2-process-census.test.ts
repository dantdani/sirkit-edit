/**
 * [B22-A2] The process census (discovery D22-18; 9.5 item 28): which routes reach an external-process spawner, derived from the
 * source, compared with the B16.0.2 classification CSV's `external_process` column (`route-data-and-resource-classification.csv`,
 * byte-pinned by `b16-0-2-gates`, regenerated only by `scripts/generate-b16-0-2-artifacts.ts`).
 *
 * The derivation: the spawners are the production files under app/ that reference a process, thread or vm module at run time
 * (the b20-b4 process gate's reading); a route reaches one when the spawner is in the route's RUNTIME import closure, walked with
 * the edges the MCP gates walk (`_import-closure.ts`); a route that reaches a spawner is taken to start it, unless a REVIEWED
 * exemption (one reason each) shows by call reachability that it cannot: every chain to the spawner passes through one gateway
 * module, the route calls only the gateway functions listed, and none of those reaches the spawning call inside the gateway.
 * [B22-A2 review] tests-1: the exemption is checked over the route's WHOLE closure up to the gateway (every module in it that
 * imports the gateway imports only non-starting bindings, by name), the gateway's starting exports follow every top-level binding
 * and reference (not only function declarations and direct calls), and a failed check removes the exemption in the census itself.
 * A spawn behind a mode switch counts: qualify starts FreeRouting outside fixture mode, and inside it when the fixture router's
 * mode is record or live (only replay starts nothing). The column is per path: every method row of a path carries the path's
 * census. No process is started.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { fileOf, importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { reachableImportedCalls } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { listRouteFiles, routePathOf } from "@/app/lib/auth/route-tree";
import { routeResourceClassification } from "@/app/lib/auth/route-resource-classification";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CSV = "artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv";
const THREAT_MODEL = "artifacts/ai-control-plane-b22/threat-model.md";
const production = collectProductionFiles(ROOT);
/** The b20-b4 process gate's module set: a process, a thread, string-compiled code or a loader that can reach them. */
const PROCESS_MODULE = /^(?:node:)?(?:child_process|worker_threads|cluster|vm|module)(?:\/|$)/;
/** The executable each spawner starts, as the classification names it. A spawner missing here fails case 1 (a reviewed move). [B22-A3,
 *  2026-10-01] Reviewed move (OD-136): the three ngspice sites became one spawner, the diagnostic runner; its own tree kill (taskkill
 *  on win32) ends ngspice and is no engineering executable, so the column still names ngspice. */
const EXECUTABLE_OF: Readonly<Record<string, string>> = {
  "app/lib/computation/diagnostic-runner.ts": "ngspice",
  "app/lib/pcb/autoroute/runner.ts": "freerouting (java)",
  "app/lib/pcb/fab/kicad-cli-runner.ts": "kicad-cli",
};
/** [B22-B, 2026-10-01] Reviewed move (OD-140): the bounded engine host and its one worker entry reference worker_threads - they start
 *  a worker THREAD of the server process for Sirkit's closed in-process engines, never an external process, so they carry no
 *  `external_process` label. The census still lists every route that reaches one (case 7, threat-model.md); b22-b-no-generic-exec pins
 *  that the host constructs its one Worker from its closed entry table and that the entry loads and compiles nothing. */
const THREAD_STARTERS: Readonly<Record<string, string>> = {
  "app/lib/computation/engine-host.ts": "the bounded engine host: a worker_threads Worker per named computation, terminated at its budget",
  "app/lib/computation/engine-worker.mjs": "the engine host's one worker entry: runs inside the worker thread, imports worker_threads only",
};
const JOB_STORE = "app/lib/spice/server/job-store.ts";
/** The job store's call into the worker that runs ngspice. */
const JOB_STORE_SPAWN_CALL = "executeRunPoint";

interface Exemption { via: string; calls: readonly string[]; reason: string }
/**
 * [B22-A2] Reviewed: routes whose import closure reaches a spawner but which never start a process (discovery 9.5 item 28). Each
 * reaches the SPICE worker only through the job store and calls only job-store functions that never reach `executeRunPoint`.
 */
const NON_STARTING: Readonly<Record<string, Exemption>> = {
  "/api/spice/runs/[id]": { via: JOB_STORE, calls: ["getRun", "cancelRun"], reason: "GET reads a run record; DELETE stops a live run through cancelRun, which aborts the run's signal so the worker kills its child: it stops a process and never starts one" },
  "/api/spice/runs/[id]/bundle": { via: JOB_STORE, calls: ["getRun"], reason: "reads a run record and zips what it carries (bounded logs, the parsed results; no file is read since B22-A3); starts nothing" },
  "/api/spice/runs/[id]/events": { via: JOB_STORE, calls: ["getRun", "subscribeRun"], reason: "streams a run record's events; starts nothing" },
  "/api/spice/runs/[id]/waveforms": { via: JOB_STORE, calls: ["getRun"], reason: "slices a run record's waveforms; starts nothing" },
};

const edgeCache = new WeakMap<FileMap, Map<string, string[]>>();
/** A file's runtime import edges to production files: the rule `importClosure` follows (type-only declarations erased). */
function edgesOf(files: FileMap, file: string): string[] {
  let cache = edgeCache.get(files);
  if (cache === undefined) {
    cache = new Map();
    edgeCache.set(files, cache);
  }
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const source = files.get(file)!;
  const runtime = runtimeDeclarationSpecifiers(file, source);
  const edges: string[] = [];
  for (const reference of moduleReferences(file, source)) {
    if (reference.kind === "import-type") continue;
    if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
    const resolution = resolveSpecifier(file, reference.specifier);
    if (resolution.kind !== "module") continue;
    const target = fileOf(files, resolution.module);
    if (target !== null && !edges.includes(target)) edges.push(target);
  }
  cache.set(file, edges);
  return edges;
}
/** The runtime import closure of one entry (a bridge is neither walked through nor reached), each file with its first chain. */
function closureOf(files: FileMap, entry: string, bridges: ReadonlySet<string> = new Set()): Map<string, readonly string[]> {
  const chains = new Map<string, readonly string[]>([[entry, [entry]]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const target of edgesOf(files, file)) {
      if (chains.has(target) || bridges.has(target)) continue;
      chains.set(target, [...chains.get(file)!, target]);
      queue.push(target);
    }
  }
  return chains;
}
/** The production files under app/ that reference a process, thread or vm module at run time. */
function spawnersOf(files: FileMap): string[] {
  return [...files.keys()].filter((path) => {
    if (!path.startsWith("app/")) return false;
    const source = files.get(path)!;
    const references = moduleReferences(path, source).filter((reference) => reference.kind !== "import-type" && PROCESS_MODULE.test(reference.specifier));
    if (references.length === 0) return false;
    const runtime = runtimeDeclarationSpecifiers(path, source);
    return references.some((reference) => !((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)));
  }).sort();
}

/**
 * [B22-A2 review] tests-1: the exports of a gateway module that can reach `target` (an identifier) through the module's own
 * top-level bindings, and whether code that runs at import reaches it. Every top-level function, class, variable and export
 * assignment is a node; an edge is ANY identifier its body or initializer names (a call, a callback, a value); a variable whose
 * initializer is not a function runs at import, like a top-level statement. An over-approximation - a reference that never runs
 * still counts - which is the safe side for an exemption.
 */
function exportsReaching(path: string, source: string, target: string): { exports: string[]; atImport: boolean; reexportsAll: boolean } {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const references = new Map<string, Set<string>>();
  const exported = new Map<string, string>();
  // [B22-A2 lead] a re-export from another module forwards bindings this module's source does not show: each forwarded name counts
  // as reaching (the safe side), and `export *` forwards a set no check can read
  const forwarded = new Set<string>();
  let reexportsAll = false;
  const atImport = new Set<string>();
  const collect = (node: ts.Node, into: Set<string>): void => {
    if (ts.isIdentifier(node)) into.add(node.text);
    ts.forEachChild(node, (child) => collect(child, into));
  };
  const has = (statement: ts.Node, kind: ts.SyntaxKind): boolean => (ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : []).some((modifier) => modifier.kind === kind);
  const names = (binding: ts.BindingName): string[] => (ts.isIdentifier(binding) ? [binding.text] : binding.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : names(element.name))));
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      const name = statement.name?.text ?? "default";
      const named = new Set<string>();
      collect(statement, named);
      references.set(name, named);
      if (ts.isClassDeclaration(statement)) for (const identifier of named) atImport.add(identifier); // static members run at import
      if (has(statement, ts.SyntaxKind.ExportKeyword)) exported.set(has(statement, ts.SyntaxKind.DefaultKeyword) ? "default" : name, name);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const named = new Set<string>();
        if (declaration.initializer !== undefined) collect(declaration.initializer, named);
        const deferred = declaration.initializer !== undefined && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer));
        if (!deferred) for (const identifier of named) atImport.add(identifier);
        for (const name of names(declaration.name)) {
          references.set(name, named);
          if (has(statement, ts.SyntaxKind.ExportKeyword)) exported.set(name, name);
        }
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier === undefined && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) exported.set(element.name.text, (element.propertyName ?? element.name).text);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && !statement.isTypeOnly) {
      if (statement.exportClause === undefined || ts.isNamespaceExport(statement.exportClause)) reexportsAll = true;
      else for (const element of statement.exportClause.elements) if (!element.isTypeOnly) forwarded.add(element.name.text);
    } else if (ts.isExportAssignment(statement)) {
      const named = new Set<string>();
      collect(statement.expression, named);
      references.set("default", named);
      exported.set("default", "default");
      for (const identifier of named) atImport.add(identifier);
    } else if (!ts.isImportDeclaration(statement) && !ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement) && !ts.isExportDeclaration(statement)) {
      collect(statement, atImport); // a statement that runs at import
    }
  }
  const reaches = (name: string, seen: Set<string>): boolean => {
    if (name === target) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return [...(references.get(name) ?? [])].some((identifier) => reaches(identifier, seen));
  };
  return {
    exports: [...new Set([...[...exported].filter(([, local]) => reaches(local, new Set())).map(([name]) => name), ...forwarded])].sort(),
    atImport: [...atImport].some((identifier) => reaches(identifier, new Set())),
    reexportsAll,
  };
}

/**
 * [B22-A2 review] tests-1: what one module imports from the gateway at run time - the bindings by name, and every form that names
 * none (a namespace or default import, `export *`, a dynamic import, a require), which an exemption cannot check and refuses.
 */
function gatewayUse(files: FileMap, file: string, via: string): { names: string[]; opaque: string[] } {
  const source = files.get(file)!;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const toGateway = (specifier: string): boolean => {
    const resolution = resolveSpecifier(file, specifier);
    return resolution.kind === "module" && fileOf(files, resolution.module) === via;
  };
  const names: string[] = [];
  const opaque: string[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier) && toGateway(statement.moduleSpecifier.text)) {
      const clause = statement.importClause;
      if (clause === undefined || clause.isTypeOnly) continue; // a bare import runs the module (atImport); a type import is erased
      if (clause.name !== undefined) opaque.push("default-import");
      const bindings = clause.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) opaque.push("namespace-import");
      else if (bindings !== undefined) for (const element of bindings.elements) if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && ts.isStringLiteralLike(statement.moduleSpecifier) && toGateway(statement.moduleSpecifier.text) && !statement.isTypeOnly) {
      if (statement.exportClause === undefined || ts.isNamespaceExport(statement.exportClause)) opaque.push("export-all");
      else for (const element of statement.exportClause.elements) if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text);
    }
  }
  for (const reference of moduleReferences(file, source)) {
    if ((reference.kind === "dynamic-import" || reference.kind === "require" || reference.kind === "import-equals") && toGateway(reference.specifier)) opaque.push(reference.kind);
  }
  return { names: [...new Set(names)].sort(), opaque };
}

/**
 * [B22-A2 review] tests-1: every reason a reviewed exemption does not hold for the route `file` (empty when it holds): the gateway
 * starts a process at import; a spawner is reachable around the gateway; some module of the route's closure (the route, `_scope.ts`
 * or any helper) imports a starting gateway binding or uses the gateway in a form that names no binding; or the route's own calls
 * into the gateway are not exactly the reviewed list.
 */
function exemptionViolations(files: FileMap, file: string, exemption: Exemption, spawners: readonly string[] = spawnersOf(files)): string[] {
  const out: string[] = [];
  const gateway = exportsReaching(exemption.via, files.get(exemption.via)!, JOB_STORE_SPAWN_CALL);
  if (gateway.atImport) out.push("GATEWAY_STARTS_AT_IMPORT");
  if (gateway.reexportsAll) out.push("GATEWAY_REEXPORTS_ALL");
  const bridged = closureOf(files, file, new Set([exemption.via]));
  for (const spawner of spawners) if (bridged.has(spawner)) out.push(`AROUND_THE_GATEWAY:${spawner}`);
  for (const member of bridged.keys()) {
    if (!edgesOf(files, member).includes(exemption.via)) continue;
    const use = gatewayUse(files, member, exemption.via);
    for (const kind of use.opaque) out.push(`OPAQUE_GATEWAY_USE:${member}:${kind}`);
    for (const name of use.names) if (gateway.exports.includes(name)) out.push(`STARTING_IMPORT:${member}:${name}`);
  }
  const calls = callsInto(files, file, exemption.via);
  if (calls.join(",") !== [...exemption.calls].sort().join(",")) out.push(`ROUTE_CALLS:${calls.join(",")}`);
  return out;
}

/** The gateway functions a route calls (imported by name from `via`, reachable in the route's source). */
function callsInto(files: FileMap, route: string, via: string): string[] {
  return reachableImportedCalls(files.get(route)!, route)
    .filter((call) => {
      const resolution = resolveSpecifier(route, call.specifier);
      return resolution.kind === "module" && fileOf(files, resolution.module) === via;
    })
    .map((call) => call.name)
    .sort();
}

interface CensusRow { path: string; file: string; reached: string[]; label: string; exempt: boolean }
const routeEntries = listRouteFiles(ROOT).map((file) => ({ path: routePathOf(ROOT, file), file: relative(ROOT, file).split("\\").join("/") }));
function census(files: FileMap, routes: ReadonlyArray<{ path: string; file: string }>): CensusRow[] {
  const spawners = spawnersOf(files);
  return routes.map(({ path, file }) => {
    const closure = closureOf(files, file);
    const reached = spawners.filter((spawner) => closure.has(spawner));
    // [B22-A2 review] tests-1: a path's exemption holds only while its check passes; otherwise the route is taken to start the spawner
    const exemption = NON_STARTING[path];
    const exempt = reached.length > 0 && exemption !== undefined && exemptionViolations(files, file, exemption, spawners).length === 0;
    const label = exempt ? "" : [...new Set(reached.filter((spawner) => THREAD_STARTERS[spawner] === undefined).map((spawner) => EXECUTABLE_OF[spawner] ?? `unlabelled spawner ${spawner}`))].sort().join(" + "); // [B22-B] a thread starter is no external process
    return { path, file, reached, label, exempt };
  });
}

/** The committed CSV's `external_process` values per path (a quoted cell may hold a comma). */
function csvExternalProcess(): Map<string, Set<string>> {
  const lines = readFileSync(join(ROOT, CSV), "utf8").replace(/\r\n/g, NEWLINE).split(NEWLINE).filter((line) => line !== "");
  const cells = (line: string): string[] => {
    const out: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]!;
      if (quoted) {
        if (character === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
        else if (character === '"') quoted = false;
        else cell += character;
      } else if (character === '"') quoted = true;
      else if (character === ",") { out.push(cell); cell = ""; }
      else cell += character;
    }
    out.push(cell);
    return out;
  };
  const header = cells(lines[0]!);
  const pathIndex = header.indexOf("path");
  const processIndex = header.indexOf("external_process");
  expect([pathIndex, processIndex]).toEqual([0, 6]);
  const byPath = new Map<string, Set<string>>();
  for (const line of lines.slice(1)) {
    const row = cells(line);
    const set = byPath.get(row[pathIndex]!) ?? new Set<string>();
    set.add(row[processIndex]!);
    byPath.set(row[pathIndex]!, set);
  }
  return byPath;
}

const CENSUS = census(production, routeEntries);

describe("[B22-A2] the process census (D22-18)", () => {
  it("1. the spawners are derived from the source: the production files under app/ that reference a process module at run time are exactly the ones the census labels, each naming child_process", { timeout: 120_000 }, () => {
    expect(spawnersOf(production)).toEqual([...Object.keys(EXECUTABLE_OF), ...Object.keys(THREAD_STARTERS)].sort()); // [B22-B] + the two thread starters (OD-140)
    for (const spawner of Object.keys(EXECUTABLE_OF)) expect(production.get(spawner), spawner).toMatch(/\bspawn\(/);
    // [B22-B] a thread starter starts no process: no child_process, no spawn, exec or fork call; the host is the one Worker constructor
    for (const starter of Object.keys(THREAD_STARTERS)) {
      expect(production.get(starter), starter).not.toMatch(/child_process|\bspawn\(|\bexecFile\(|\bexec\(|\bfork\(/);
      expect(moduleReferences(starter, production.get(starter)!).filter((reference) => PROCESS_MODULE.test(reference.specifier)).map((reference) => reference.specifier), starter).toEqual(["node:worker_threads"]);
      expect(THREAD_STARTERS[starter]!.length, starter).toBeGreaterThan(20);
    }
    expect(production.get("app/lib/computation/engine-host.ts")).toMatch(/new Worker\(entry, options\)/);
    // the census covers every route file, and the route files are exactly the policy table's paths (165 rows over these paths)
    expect(routeEntries.map((entry) => entry.path).sort()).toEqual([...new Set(routeResourceClassification().map((row) => row.path))].sort());
    expect(routeResourceClassification().length).toBe(165);
  });

  it("2. the census walks the gates' edges: for every route that reaches a spawner, its closure is exactly importClosure's", { timeout: 120_000 }, () => {
    const reaching = CENSUS.filter((row) => row.reached.length > 0);
    expect(reaching.length).toBeGreaterThan(5);
    for (const row of reaching) expect([...closureOf(production, row.file).keys()].sort(), row.path).toEqual([...importClosure(production, [row.file]).keys()].sort());
  });

  it("3. every path's external_process in the committed CSV (every method row) equals the census derived from the source, and the renderer agrees", () => {
    const csv = csvExternalProcess();
    const derived = new Map(CENSUS.map((row) => [row.path, row.label]));
    const mismatches: string[] = [];
    for (const [path, values] of csv) {
      const expected = derived.get(path);
      if (expected === undefined) mismatches.push(`${path}: no route file`);
      else if (values.size !== 1 || !values.has(expected)) mismatches.push(`${path}: csv=${JSON.stringify([...values])} derived=${JSON.stringify(expected)}`);
    }
    for (const row of CENSUS) if (!csv.has(row.path)) mismatches.push(`${row.path}: no CSV row`);
    expect(mismatches).toEqual([]);
    for (const row of routeResourceClassification()) expect(row.externalProcess, `${row.method} ${row.path}`).toBe(derived.get(row.path));
  });

  it("4. the reviewed exemptions hold by reachability over each route's whole closure: each reaches a spawner only through the job store, every module of its closure imports only job-store bindings that never reach the worker's run, the route calls exactly the listed ones; DELETE stops a live child through cancelRun; none is stale", { timeout: 120_000 }, () => {
    const gateway = exportsReaching(JOB_STORE, production.get(JOB_STORE)!, JOB_STORE_SPAWN_CALL);
    expect(gateway).toEqual({ exports: ["startRunPlan"], atImport: false, reexportsAll: false });
    expect(production.get(JOB_STORE)).toMatch(new RegExp(`import \\{ ${JOB_STORE_SPAWN_CALL} \\} from "\\./worker";`));
    const byPath = new Map(CENSUS.map((row) => [row.path, row]));
    for (const [path, exemption] of Object.entries(NON_STARTING)) {
      const row = byPath.get(path);
      expect(row, path).toBeDefined();
      expect(row!.reached, path).toEqual(["app/lib/computation/diagnostic-runner.ts"]); // [B22-A3] reviewed pin move: through the job store and the worker, the one ngspice spawner (was the worker)
      expect(row!.exempt, path).toBe(true);
      expect(exemption.reason.length, path).toBeGreaterThan(20);
      expect(exemptionViolations(production, row!.file, exemption), path).toEqual([]);
      const bridged = closureOf(production, row!.file, new Set([exemption.via]));
      expect(spawnersOf(production).filter((spawner) => bridged.has(spawner)), path).toEqual([]);
      expect(callsInto(production, row!.file, exemption.via), path).toEqual([...exemption.calls].sort());
      expect(exemption.calls.filter((call) => gateway.exports.includes(call)), path).toEqual([]);
      // the closure's runtime importers of the job store: the route itself only (`_scope.ts` imports a type)
      expect([...bridged.keys()].filter((member) => edgesOf(production, member).includes(JOB_STORE)), path).toEqual([row!.file]);
    }
    // DELETE /api/spice/runs/[id] aborts a live child through cancelRun -> cancelInternal -> the run's AbortController
    const store = production.get(JOB_STORE)!;
    expect(store).toMatch(/export function cancelRun\([^)]*\): boolean \{\s*if \(!ownedJob\(runId, scope\)\) return false;\s*return cancelInternal\(runId\);/);
    expect(store.slice(store.indexOf("function cancelInternal("), store.indexOf("async function executeQueuedRun("))).toContain("job.abort.abort();");
    // the parent route starts runs: it is not exempt and carries ngspice
    expect(byPath.get("/api/spice/runs")).toMatchObject({ exempt: false, label: "ngspice" });
    expect(callsInto(production, "app/api/spice/runs/route.ts", JOB_STORE)).toContain("startRunPlan");
  });

  it("5. D22-18's three rows: /api/chat and /api/pcb/qualify carry freerouting (java); /api/pcb/release reaches no spawner and carries none; qualify spawns outside fixture mode and inside it in the fixture router's record and live modes (only replay starts nothing), and the page and the classification say so", () => {
    const byPath = new Map(CENSUS.map((row) => [row.path, row]));
    expect(byPath.get("/api/chat")).toMatchObject({ label: "freerouting (java)", exempt: false, reached: ["app/lib/computation/engine-host.ts", "app/lib/pcb/autoroute/runner.ts"] }); // [B22-B] the chat route also reaches the engine host (the named computation reads): a thread, so the label stays FreeRouting's
    expect(byPath.get("/api/pcb/qualify")).toMatchObject({ label: "freerouting (java)", exempt: false });
    expect(byPath.get("/api/pcb/release")).toMatchObject({ label: "", reached: [] });
    expect(byPath.get("/api/pcb/export/gerbers")).toMatchObject({ label: "kicad-cli" });
    expect(byPath.get("/api/pcb/autoroute")).toMatchObject({ label: "freerouting (java)" });
    const router = production.get("app/lib/pcb/autonomous/production-router.ts")!;
    expect(router).toMatch(/if \(fixtureRuntimeEnabled\(\)\) return fixtureRouteExecutor\(\(\) => createRealAutonomousRouteExecutor\(options\)\);/);
    expect(router).toMatch(/await runFreerouting\(/);
    // [B22-A2 review] regressions-3, coverage-3: inside fixture mode the router's record and live modes call createReal() - the
    // real FreeRouting executor - and only the default replay does not (discovery 9.5 item 28's "only outside fixture mode" is wrong)
    const fixtureRouter = production.get("app/lib/fixture-runtime/router.ts")!;
    expect(fixtureRouter).toMatch(/return value === "record" \|\| value === "live" \? value : "replay";/);
    expect(fixtureRouter).toMatch(/if \(mode === "live"\) \{\s*const live = await createReal\(\);/);
    expect(fixtureRouter).toMatch(/if \(mode === "record"\) \{[^}]*recordingRouteExecutor\(await createReal\(\), sink\)/);
    expect(fixtureRouter.slice(fixtureRouter.indexOf("const fixture = loadRouteFixture(path);"))).not.toContain("createReal(");
    const page = readFileSync(join(ROOT, THREAT_MODEL), "utf8");
    expect(page).not.toMatch(/spawns only outside fixture mode|FreeRouting \(java\), outside fixture mode \|/);
    expect(page).toMatch(/\| `POST \/api\/pcb\/qualify` \| [^\n]*FreeRouting \(java\)[^\n]*`record` or `live`/);
    expect(page).toContain("`SIRKIT_FIXTURE_ROUTER` is `record` or `live`");
    const classification = production.get("app/lib/auth/route-resource-classification.ts")!.split(NEWLINE);
    const qualify = classification.find((line) => line.startsWith('  "/api/pcb/qualify":'))!;
    expect(qualify).toContain("SIRKIT_FIXTURE_ROUTER record or live");
    expect(qualify).not.toMatch(/\(outside fixture mode\)$/);
    for (const row of routeResourceClassification().filter((candidate) => ["/api/chat", "/api/pcb/qualify", "/api/pcb/release"].includes(candidate.path))) {
      expect(row.externalProcess, `${row.method} ${row.path}`).toBe(row.path === "/api/pcb/release" ? "" : "freerouting (java)");
      expect(row.isPublic).toBe(false);
    }
  });

  it("6. tripwire: a synthetic route reaching kicad-cli through a hop is derived as kicad-cli; an exempt route loses its exemption in the census when it, or any helper in its closure, imports a starting job-store binding, when the job store reaches the run through a const or at import, when it reaches the worker around the job store, or uses the job store opaquely; a new spawner is unlabelled", { timeout: 240_000 }, () => {
    const injected = new Map(production);
    injected.set("app/api/b22-probe/route.ts", 'import { exportIt } from "./hop";\nexport const POST = () => exportIt();\n');
    injected.set("app/api/b22-probe/hop.ts", 'import { runKicadCli } from "@/app/lib/pcb/fab/kicad-cli-runner";\nexport const exportIt = () => runKicadCli({ cliPath: "kicad-cli", args: [] });\n');
    expect(census(injected, [{ path: "/api/b22-probe", file: "app/api/b22-probe/route.ts" }])).toEqual([{ path: "/api/b22-probe", file: "app/api/b22-probe/route.ts", reached: ["app/lib/pcb/fab/kicad-cli-runner.ts"], label: "kicad-cli", exempt: false }]);
    // [B22-A2 review] tests-1: every mutation below is run through the exemption check AND the census itself, which must drop the
    // exemption (label ngspice); the unmutated route keeps it
    const route = "app/api/spice/runs/[id]/route.ts";
    const exemption = NON_STARTING["/api/spice/runs/[id]"]!;
    const entry = [{ path: "/api/spice/runs/[id]", file: route }];
    const WORKER = "app/lib/spice/server/worker.ts"; const RUNNER = "app/lib/computation/diagnostic-runner.ts"; // [B22-A3] reviewed pin move: the spawner reached is the runner, through the worker
    expect(census(production, entry)[0]).toMatchObject({ reached: [RUNNER], exempt: true, label: "" });
    const mutated = (file: string, from: string, to: string): Map<string, string> => {
      const source = production.get(file)!;
      expect(source.split(from).length, `${file}: ${from}`).toBe(2);
      return new Map(production).set(file, source.replace(from, to));
    };
    const dropsExemption = (files: Map<string, string>, reason: string): void => {
      expect(exemptionViolations(files, route, exemption), reason).toContain(reason);
      expect(census(files, entry)[0], reason).toMatchObject({ reached: [RUNNER], exempt: false, label: "ngspice" });
    };
    // (a) the route itself imports and calls startRunPlan
    const starting = new Map(production).set(route, `${production.get(route)!}\nimport { startRunPlan } from "@/app/lib/spice/server/job-store";\nexport const PUT = () => startRunPlan({} as never);\n`);
    expect(callsInto(starting, route, JOB_STORE)).toContain("startRunPlan");
    expect(exportsReaching(JOB_STORE, production.get(JOB_STORE)!, JOB_STORE_SPAWN_CALL).exports).toContain("startRunPlan");
    dropsExemption(starting, `STARTING_IMPORT:${route}:startRunPlan`);
    // (b) a helper in the route's closure - `_scope.ts`, which imports only a job-store type today - starts runs; the route's own calls
    // into the job store are unchanged, so a check of the route file alone would still pass
    const scope = "app/api/spice/runs/_scope.ts";
    const helper = mutated(scope, 'import type { RunScope } from "@/app/lib/spice/server/job-store";', 'import { type RunScope, startRunPlan } from "@/app/lib/spice/server/job-store";\nexport const resume = () => startRunPlan({} as never);');
    expect(callsInto(helper, route, JOB_STORE)).toEqual([...exemption.calls].sort());
    dropsExemption(helper, `STARTING_IMPORT:${scope}:startRunPlan`);
    // (c) a top-level const arrow inside the job store makes cancelRun reach the worker's run (not a function declaration, and
    // not a direct call from cancelRun)
    const arrow = mutated(JOB_STORE, "function cancelInternal(runId: string): boolean {", "const resumeNext = (id: string): void => { void executeQueuedRun(id as never); };\nfunction cancelInternal(runId: string): boolean {\n  resumeNext(runId);");
    expect(exportsReaching(JOB_STORE, arrow.get(JOB_STORE)!, JOB_STORE_SPAWN_CALL).exports).toEqual(["cancelRun", "startRunPlan"]);
    dropsExemption(arrow, `STARTING_IMPORT:${route}:cancelRun`);
    // (d) the job store starts a run when it is imported
    const atImport = new Map(production).set(JOB_STORE, `${production.get(JOB_STORE)!}\nvoid executeQueuedRun("boot" as never);\n`);
    dropsExemption(atImport, "GATEWAY_STARTS_AT_IMPORT");
    // (e) the route reaches the worker around the job store
    const around = new Map(production).set(route, `${production.get(route)!}\nimport { executeRunPoint } from "@/app/lib/spice/server/worker";\nexport const PATCH = executeRunPoint;\n`);
    expect([...closureOf(around, route, new Set([JOB_STORE])).keys()]).toContain(WORKER);
    dropsExemption(around, `AROUND_THE_GATEWAY:${RUNNER}`); // the worker imports the runner: reaching the worker around the job store reaches the spawner
    // (f) a namespace import of the job store names no binding the check could read
    const opaque = mutated(scope, 'import type { RunScope } from "@/app/lib/spice/server/job-store";', 'import type { RunScope } from "@/app/lib/spice/server/job-store";\nimport * as store from "@/app/lib/spice/server/job-store";\nexport const peek = () => store;');
    dropsExemption(opaque, `OPAQUE_GATEWAY_USE:${scope}:namespace-import`);
    // [B22-A2 lead] the check's new issue: (g) the job store forwards the worker's run under another name by a re-export from a
    // module, and a helper imports and calls it - a forwarded binding is not read here, so it counts as starting
    const forward = mutated(scope, 'import type { RunScope } from "@/app/lib/spice/server/job-store";', 'import { type RunScope, resume } from "@/app/lib/spice/server/job-store";\nexport const go = () => resume({} as never);');
    forward.set(JOB_STORE, `${production.get(JOB_STORE)!}\nexport { executeRunPoint as resume } from "./worker";\n`);
    dropsExemption(forward, `STARTING_IMPORT:${scope}:resume`);
    // (h) `export *` from another module forwards a set the check cannot read
    dropsExemption(new Map(production).set(JOB_STORE, `${production.get(JOB_STORE)!}\nexport * from "./worker";\n`), "GATEWAY_REEXPORTS_ALL");
    const spawner = new Map(production);
    spawner.set("app/lib/computation/b22-probe-spawner.ts", 'import { execFile } from "node:child_process";\nexport const run = execFile;\n');
    expect(spawnersOf(spawner)).toContain("app/lib/computation/b22-probe-spawner.ts");
    expect(spawnersOf(spawner).filter((path) => EXECUTABLE_OF[path] === undefined && THREAD_STARTERS[path] === undefined)).toEqual(["app/lib/computation/b22-probe-spawner.ts"]); // [B22-B] the reviewed thread starters aside
  });

  it("7. threat-model.md's census table names every route that reaches a spawner, with the census label or its reviewed exemption", () => {
    const page = readFileSync(join(ROOT, THREAT_MODEL), "utf8");
    const rows = [...page.matchAll(/^\| `(\/api\/[^`]+)` \| ((?:`app\/[^`]+`(?:, )?)+) \| (`[^`]+`|none - [^|]+) \|$/gm)].map((match) => ({
      path: match[1]!,
      reached: [...match[2]!.matchAll(/`([^`]+)`/g)].map((spawner) => spawner[1]!).sort(),
      label: match[3]!.startsWith("`") ? match[3]!.slice(1, -1) : "",
    }));
    const expected = CENSUS.filter((row) => row.reached.length > 0).map((row) => ({ path: row.path, reached: [...row.reached].sort(), label: row.label }));
    expect(rows.sort((a, b) => (a.path < b.path ? -1 : 1))).toEqual(expected.sort((a, b) => (a.path < b.path ? -1 : 1)));
  });
});
