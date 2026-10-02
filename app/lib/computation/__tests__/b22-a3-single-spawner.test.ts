/**
 * [B22-A3] OD-136: one ngspice spawner. Read from the source with the B14.4 AST helpers (comments and formatting cannot hide an
 * import): among the SPICE files - every production file under `app/lib/spice`, `app/api/spice`, `app/api/simulate` and
 * `app/lib/computation` - only the diagnostic runner references a process module; the three ngspice entry points (`/api/simulate`,
 * the SPICE Studio worker, the model smoke test) call the runner and import no `child_process`; nothing reads `NGSPICE_BIN`; the
 * runner's two spawns are ngspice (the pinned executable, the profile's filled argv and exact environment, `windowsHide`, no shell,
 * the run directory as cwd) and its own tree kill (`taskkill`, a fixed argv); and the runner stays out of the MCP routes' runtime
 * closure and out of every B11-scanned file.
 *
 * Test-first: RED on c037627 (three SPICE files imported `child_process`; no runner existed). No process starts.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { collectProductionFiles, moduleReferences } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { B11_SCANNED_FILES } from "@/app/lib/agent/orchestration/tripwires";

const RUNNER = "app/lib/computation/diagnostic-runner.ts";
const ENTRY_POINTS = ["app/api/simulate/route.ts", "app/api/spice/models/smoke-test/route.ts", "app/lib/spice/server/worker.ts"] as const;
const SPICE_TREES = ["app/lib/spice/", "app/api/spice/", "app/api/simulate/", "app/lib/computation/"];
const PROCESS_MODULE = /^(?:node:)?(?:child_process|worker_threads|cluster|vm|module)(?:\/|$)/;
const MCP_ROUTES = ["app/api/mcp/route.ts", "app/api/mcp/token/route.ts", "app/.well-known/oauth-protected-resource/api/mcp/route.ts"];
const production = collectProductionFiles(process.cwd());

/** The process modules a file references at run time (a type-only import is erased). */
function processModules(path: string): string[] {
  const source = production.get(path)!;
  const runtime = runtimeDeclarationSpecifiers(path, source);
  return moduleReferences(path, source)
    .filter((reference) => reference.kind !== "import-type" && PROCESS_MODULE.test(reference.specifier))
    .filter((reference) => !((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)))
    .map((reference) => reference.specifier);
}
/** Every call whose callee is the identifier `name`, with its argument texts. */
function callsOf(path: string, name: string): string[][] {
  const file = ts.createSourceFile(path, production.get(path)!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) out.push(node.arguments.map((argument) => argument.getText(file)));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

describe("[B22-A3] one ngspice spawner (OD-136)", () => {
  it("1. among the SPICE files only the diagnostic runner references a process module, and it names child_process (since B22-B the bounded engine host and its worker entry reference worker_threads, and no other module)", { timeout: 120_000 }, () => {
    const spice = [...production.keys()].filter((path) => SPICE_TREES.some((tree) => path.startsWith(tree))).sort();
    expect(spice.length).toBeGreaterThan(30); // [B22-A3] 34 on c037627 (the red run found the first bound, 40, wrong: a test bug, fixed before any production edit)
    for (const entry of ENTRY_POINTS) expect(spice, entry).toContain(entry);
    expect(spice.filter((path) => processModules(path).length > 0)).toEqual(["app/lib/computation/diagnostic-runner.ts", "app/lib/computation/engine-host.ts", "app/lib/computation/engine-worker.mjs"]); expect(spice.filter((path) => processModules(path).some((specifier) => specifier.endsWith("child_process")))).toEqual([RUNNER]); // [B22-B, 2026-10-01] reviewed move (OD-140): the engine host's two thread starters join the tree; the ngspice spawner is still the runner alone
    expect(processModules(RUNNER)).toEqual(["node:child_process"]);
  });

  it("2. the three entry points call the runner and import no process module; nothing in the tree reads NGSPICE_BIN or exports an ngspice executable", { timeout: 120_000 }, () => {
    for (const entry of ENTRY_POINTS) {
      const source = production.get(entry)!;
      expect(processModules(entry), entry).toEqual([]);
      expect(moduleReferences(entry, source).map((reference) => reference.specifier), entry).toContain("@/app/lib/computation/diagnostic-runner");
      expect(source, entry).toMatch(/\brunDiagnosticNgspice\(|\bdiagnosticNgspiceVersion\(/);
      expect(callsOf(entry, "spawn"), entry).toEqual([]);
    }
    // a comment may name NGSPICE_BIN (to say it no longer chooses the binary); no code reads it or exports an executable
    const readers = [...production.entries()].filter(([path, source]) => path.startsWith("app/") && /process\.env(?:\.NGSPICE_BIN\b|\[\s*["'`]NGSPICE_BIN)|\bNGSPICE_EXECUTABLE\b/.test(source)).map(([path]) => path);
    expect(readers).toEqual([]);
  });

  it("3. the runner spawns exactly twice: ngspice (the pinned executable, the profile's filled argv, the exact environment, the run directory as cwd, windowsHide, no shell, detached off Windows) and its own taskkill (a fixed argv: /PID, the child's pid, /T, /F)", () => {
    const source = production.get(RUNNER)!;
    const spawns = callsOf(RUNNER, "spawn");
    expect(spawns).toHaveLength(2);
    const [taskkill, ngspice] = spawns as [string[], string[]];
    expect(ngspice[0]).toBe("input.executable");
    expect(ngspice[1]).toBe("[...input.argv]");
    expect(ngspice[2]).toBe('{ cwd: input.cwd, env: { ...input.env }, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"], detached: !input.place.win32 }');
    expect(taskkill[0]).toBe('win32.join(place.systemRoot, "System32", "taskkill.exe")');
    expect(taskkill[1]).toBe('["/PID", String(pid), "/T", "/F"]');
    expect(taskkill[2]).toBe('{ env: systemRootOnly, windowsHide: true, shell: false, stdio: "ignore" }');
    expect(source).toContain("const systemRootOnly = { SystemRoot: place.systemRoot } as unknown as NodeJS.ProcessEnv;");
    // the executable and argv come from the profile and the server settings only; the environment is the profile's map, filled
    expect(source).toContain("executable: join(place.root, ...relative)");
    expect(source).toContain('argv: filled(profile.argvTemplates[request.operation]!, { "{deckFile}": DIAGNOSTIC_DECK_FILE })');
    expect(source).toContain("Object.entries(profile.environment)");
    expect(source).not.toMatch(/process\.env\.(?:PATH|Path|HOME|USERPROFILE|NGSPICE)/);
    expect(source).not.toMatch(/shell:\s*true|\bexec(?:Sync|File|FileSync)?\(|\bspawnSync\(|\bfork\(/);
  });

  it("4. the runner stays out of the MCP routes' runtime closure and out of every B11-scanned file", { timeout: 120_000 }, () => {
    const closure = importClosure(production, MCP_ROUTES);
    expect(closure.size).toBeGreaterThan(200);
    expect(closure.has(RUNNER)).toBe(false);
    for (const entry of ENTRY_POINTS) expect(closure.has(entry), entry).toBe(false);
    for (const scanned of B11_SCANNED_FILES) {
      expect(scanned.startsWith("app/lib/computation/"), scanned).toBe(false);
      const source = production.get(scanned);
      if (source === undefined) continue;
      expect(moduleReferences(scanned, source).some((reference) => reference.specifier.includes("diagnostic-runner")), scanned).toBe(false);
    }
    // the runner's own closure reaches no route and no MCP module
    const own = importClosure(production, [RUNNER]);
    expect([...own.keys()].filter((path) => path.startsWith("app/api/") || path.startsWith("app/lib/mcp/"))).toEqual([]);
  });
});
