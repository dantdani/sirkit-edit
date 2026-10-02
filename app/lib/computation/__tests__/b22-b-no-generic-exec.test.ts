/**
 * [B22-B] Named computations, never generic execution (runbook B22-B :918, global :148, :157; discovery D22-16; OD-139, OD-140,
 * OD-149). Read from the source with the B14.4 AST helpers and the TypeScript parser: under app/ only the diagnostic runner
 * (child_process) and the bounded engine host with its one worker entry (worker_threads) start a process or a thread among the
 * computation modules - beside the two legacy runners B22-A3 left (FreeRouting, kicad-cli); the host starts a Worker in exactly one
 * place, from its closed entry table, never from source text; the worker entry loads nothing and compiles nothing; its engine table
 * is the host's closed list; no tool, computation, engine, validator or parser name spells a generic operation; the MCP routes reach
 * none of it and no B11-scanned file names it. No process or worker is started here.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { collectProductionFiles, moduleReferences } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { B11_SCANNED_FILES } from "@/app/lib/agent/orchestration/tripwires";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { ANALYTICAL_MICROCASES, ARTIFACT_PARSERS, COMPUTATION_CATALOG, COMPUTATION_VALIDATOR_IDS } from "@/app/lib/computation/catalog";
import { ENGINE_HOST_ENGINE_IDS, ENGINE_HOST_PROFILES } from "@/app/lib/computation/engine-host";

const production = collectProductionFiles(process.cwd());
const RUNNER = "app/lib/computation/diagnostic-runner.ts";
const HOST = "app/lib/computation/engine-host.ts";
const WORKER_ENTRY = "app/lib/computation/engine-worker.mjs";
const LEGACY_RUNNERS = ["app/lib/pcb/autoroute/runner.ts", "app/lib/pcb/fab/kicad-cli-runner.ts"];
const PROCESS_MODULE = /^(?:node:)?(?:child_process|worker_threads|cluster|vm|module)(?:\/|$)/;
const MCP_ROUTES = ["app/api/mcp/route.ts", "app/api/mcp/token/route.ts", "app/.well-known/oauth-protected-resource/api/mcp/route.ts"];
/** A generic operation, as a whole dot- or hyphen-delimited word of a name. */
const GENERIC_WORD = /(?:^|[./-])(?:shell|exec|execute|eval|script|scripts|code|command|cmd|spawn|process|python|javascript|js|ts|node|npm|pip|install|package|fetch|url|uri|http|https|file|files|fs|path|sql|query|terminal|bash|powershell|sh|generic|arbitrary|anything)(?:[./-]|$)/i;

function processModules(path: string): string[] {
  const source = production.get(path)!;
  const runtime = runtimeDeclarationSpecifiers(path, source);
  return moduleReferences(path, source)
    .filter((reference) => reference.kind !== "import-type" && PROCESS_MODULE.test(reference.specifier))
    .filter((reference) => !((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)))
    .map((reference) => reference.specifier);
}
function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, production.get(path)!, ts.ScriptTarget.Latest, true, path.endsWith(".mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS);
}
function visit(file: ts.SourceFile, each: (node: ts.Node) => void): void {
  const walk = (node: ts.Node): void => { each(node); ts.forEachChild(node, walk); };
  walk(file);
}

describe("[B22-B] named computations, never generic execution", () => {
  it("1. under app/ the process and thread importers are exactly the diagnostic runner (child_process), the engine host and its worker entry (worker_threads) and the two legacy runners; no other computation module - the catalog, the requests, the executors, the port - references one", { timeout: 120_000 }, () => {
    const importers = [...production.keys()].filter((path) => path.startsWith("app/") && processModules(path).length > 0).sort();
    expect(importers).toEqual([HOST, WORKER_ENTRY, RUNNER, ...LEGACY_RUNNERS].sort());
    expect(processModules(RUNNER)).toEqual(["node:child_process"]);
    expect(processModules(HOST)).toEqual(["node:worker_threads"]);
    expect(processModules(WORKER_ENTRY)).toEqual(["node:worker_threads"]);
    const computation = [...production.keys()].filter((path) => path.startsWith("app/lib/computation/"));
    for (const name of ["catalog.ts", "requests.ts", "request-executors.ts", "computation-port.ts"]) expect(computation, name).toContain(`app/lib/computation/${name}`);
    expect(computation.filter((path) => processModules(path).length > 0).sort()).toEqual([RUNNER, HOST, WORKER_ENTRY].sort());
    expect(processModules("app/api/chat/computation-runtime.ts")).toEqual([]);
    expect(processModules("app/lib/agent/computation-reads.ts")).toEqual([]);
  });

  it("2. the host starts a Worker in exactly one place, with an entry from its closed table (never a string, a template or source text) and options that never name `eval`; nothing else under app/ constructs a Worker from worker_threads", () => {
    const constructions: Array<{ path: string; first: ts.Expression | undefined; options: ts.Expression | undefined }> = [];
    for (const path of [...production.keys()].filter((candidate) => candidate.startsWith("app/") && /\.(?:ts|mjs)$/.test(candidate) && production.get(candidate)!.includes("Worker("))) {
      visit(parse(path), (node) => {
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Worker") constructions.push({ path, first: node.arguments?.[0], options: node.arguments?.[1] });
      });
    }
    // the browser's autoplace web worker (app/components) is a DOM Worker in a client bundle, not worker_threads: it is excluded by
    // module (it imports no worker_threads), and the only worker_threads Worker is the host's
    const threaded = constructions.filter((entry) => processModules(entry.path).some((specifier) => specifier.endsWith("worker_threads")));
    expect(threaded.map((entry) => entry.path)).toEqual([HOST]);
    const [only] = threaded;
    expect(only!.first).toBeDefined();
    expect(ts.isStringLiteralLike(only!.first!) || ts.isTemplateExpression(only!.first!)).toBe(false);
    expect(only!.first!.getText()).toBe("entry");
    expect(only!.options && ts.isIdentifier(only!.options) ? only!.options.text : null).toBe("options");
    const host = production.get(HOST)!;
    expect(host).not.toMatch(/\beval\s*:/);
    expect(host).toContain("export const ENGINE_WORKER_ENTRY = new URL(\"./engine-worker.mjs\", import.meta.url);");
  });

  it("3. the worker entry loads nothing and compiles nothing: its only import is worker_threads; no require, no dynamic import, no eval, no Function, no getBuiltinModule, no process.binding; its engine table is exactly the host's engines that have an entry", () => {
    const file = parse(WORKER_ENTRY);
    const specifiers = moduleReferences(WORKER_ENTRY, production.get(WORKER_ENTRY)!).map((reference) => `${reference.kind}:${reference.specifier}`);
    expect(specifiers).toEqual(["static-import:node:worker_threads"]);
    const findings: string[] = [];
    visit(file, (node) => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) findings.push("dynamic import");
      if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isIdentifier(node.expression) && ["eval", "Function", "require"].includes(node.expression.text)) findings.push(node.expression.text);
      if (ts.isPropertyAccessExpression(node) && ["getBuiltinModule", "binding", "_linkedBinding", "dlopen", "eval"].includes(node.name.text)) findings.push(node.name.text);
    });
    expect(findings).toEqual([]);
    const table: string[] = [];
    visit(file, (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "ENGINES" && node.initializer) {
        const collect = (inner: ts.Node): void => {
          if (ts.isPropertyAssignment(inner) && ts.isStringLiteral(inner.name)) table.push(inner.name.text);
          ts.forEachChild(inner, collect);
        };
        collect(node.initializer);
      }
    });
    const available = ENGINE_HOST_ENGINE_IDS.filter((engineId) => ENGINE_HOST_PROFILES[engineId]!.entry !== null);
    expect(table.sort()).toEqual([...available].sort());
    expect(available.length).toBe(ENGINE_HOST_ENGINE_IDS.length - 1);
  });

  it("4. no descriptor, tool, computation, engine, validator, parser or microcase name spells a generic operation; every computation descriptor's title names its one engineering computation", () => {
    const registry = sirkitToolRegistry();
    const names = [
      ...registry.list().map((descriptor) => descriptor.toolId),
      ...COMPUTATION_CATALOG.map((kind) => kind.id),
      ...ENGINE_HOST_ENGINE_IDS,
      ...COMPUTATION_VALIDATOR_IDS,
      ...ARTIFACT_PARSERS,
      ...ANALYTICAL_MICROCASES,
    ];
    expect(names.filter((name) => GENERIC_WORD.test(name))).toEqual([]);
    // the vocabulary bites (counterexamples)
    for (const bad of ["sirkit.computation.shell", "sirkit.computation.run-script", "sirkit.engine.eval/1", "sirkit.computation.fetch-url", "sirkit.computation.python", "sirkit.tools.file-read"]) expect(GENERIC_WORD.test(bad), bad).toBe(true);
    for (const kind of COMPUTATION_CATALOG) {
      const descriptor = registry.get(kind.id);
      expect(descriptor, kind.id).toBeDefined();
      expect(`${descriptor!.title} ${descriptor!.description}`, kind.id).not.toMatch(/\b(?:shell|script|code|command line|arbitrary|any program|javascript|python)\b/i);
    }
  });

  it("5. the MCP routes' runtime closure reaches none of the computation runtime - not the host, its entry, the port, the requests or the runner - and no B11-scanned file names a computation module or a B22 identifier", { timeout: 120_000 }, () => {
    const closure = importClosure(production, MCP_ROUTES);
    expect(closure.size).toBeGreaterThan(200);
    for (const member of [HOST, WORKER_ENTRY, RUNNER, "app/lib/computation/computation-port.ts", "app/lib/computation/requests.ts", "app/lib/computation/request-executors.ts", "app/api/chat/computation-runtime.ts", "app/lib/agent/computation-reads.ts"]) {
      expect(closure.get(member)?.join(" -> ") ?? null, member).toBeNull();
    }
    for (const scanned of B11_SCANNED_FILES) {
      const source = production.get(scanned);
      if (source === undefined) continue;
      expect(source, scanned).not.toMatch(/computation|engine-host|engine-worker|\bB22\b|b22-/i);
    }
  });
});
