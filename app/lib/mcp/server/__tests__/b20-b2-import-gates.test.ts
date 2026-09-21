/**
 * [B20 B2] What the MCP server side may import (AST-resolved over the production tree): the bearer principal module is
 * reachable only from the canonical wrapper module and the MCP server modules; the server modules, the MCP routes and the
 * well-known route REACH — through their whole runtime import closure, not only directly — no grant, execution,
 * reauthorization, invocation, fabrication, egress or client-transport module, import no server auth module directly, and
 * load no module opaquely; the B11 trace files stay free of MCP identifiers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_SOURCE_EXTENSIONS,
  collectProductionFiles,
  moduleImportOffenders,
  moduleReferences,
  opaqueModuleLoads,
  resolveSpecifier,
  type FileMap,
} from "@/app/lib/project/__tests__/_import-gate-helpers";

const ROOT = process.cwd();
const production = collectProductionFiles(ROOT);
const MCP_SERVER_SIDE = (path: string): boolean => path.startsWith("app/lib/mcp/server/") || path.startsWith("app/api/mcp/") || path.startsWith("app/.well-known/");
const serverSide = [...production.keys()].filter(MCP_SERVER_SIDE).sort();

/** Never reached, directly or transitively, at run time. */
const FORBIDDEN = [
  "app/lib/agent/gateway",
  "app/lib/agent/execution-dispatch",
  "app/lib/execution-grant/consume",
  "app/lib/execution-grant/mint",
  "app/lib/execution-grant/settle",
  "app/lib/execution-grant/store",
  "app/lib/execution-grant/route-contract",
  "app/lib/project/membership-reauthorization",
  "app/lib/engineering/tool-invocation", // B3 moves this line deliberately, when tools/call serves reads
  "app/lib/mcp/http-transport",
  "app/lib/net/outbound-fetch",
  "app/lib/engineering/pcb-commit-gateway",
  "app/lib/agent/trace",
  "app/lib/agent/trace-recorder",
  "app/lib/agent/replay-capsule",
  "app/lib/agent/replay-context",
  "app/lib/agent/evaluation",
  "app/lib/agent/evaluation-cases",
] as const;
/** F14c: the server auth modules are imported only by app/lib/auth (mcp-bearer, route-handlers), never directly from here. */
const DIRECT_ONLY = [
  "app/lib/auth/supabase-server",
  "app/lib/auth/postgres-membership",
  "app/lib/auth/worker-principal",
  "app/lib/auth/identity-provider",
] as const;
const FAB_PREFIX = "app/lib/pcb/fab/";
const B11_FILES = ["trace.ts", "trace-recorder.ts", "replay-capsule.ts", "replay-context.ts", "evaluation.ts", "evaluation-cases.ts", "pcb-shape-projection.ts", "pcb-shape-types.ts", "generated/pcb-shape-descriptor.ts"];

/** The specifiers a file imports or re-exports for their VALUES (a declaration whose every binding is type-only is erased). */
function runtimeDeclarationSpecifiers(path: string, source: string): Set<string> {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specifiers = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      const allTypes = bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
      const typeOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && allTypes));
      if (!typeOnly) specifiers.add(statement.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const clause = statement.exportClause;
      const allTypes = clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((element) => element.isTypeOnly);
      if (!statement.isTypeOnly && !allTypes) specifiers.add(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

// [B20 B2 lead] Sirkit's filesystems are case-insensitive, like the direct-import helper this closure replaced
// (_import-gate-helpers.ts referencesModule): a case-variant specifier reaches the same file, so it is resolved by folded path.
const FOLDED_INDEX = new WeakMap<FileMap, ReadonlyMap<string, string>>();
function foldedIndex(files: FileMap): ReadonlyMap<string, string> {
  let index = FOLDED_INDEX.get(files);
  if (index === undefined) {
    const built = new Map<string, string>();
    for (const file of files.keys()) if (!built.has(file.toLowerCase())) built.set(file.toLowerCase(), file);
    index = built;
    FOLDED_INDEX.set(files, index);
  }
  return index;
}
function fileOf(files: FileMap, module: string): string | null {
  for (const candidate of [module, `${module}/index`]) {
    for (const extension of PRODUCTION_SOURCE_EXTENSIONS) {
      const exact = `${candidate}${extension}`;
      if (files.has(exact)) return exact;
      const folded = foldedIndex(files).get(exact.toLowerCase());
      if (folded !== undefined) return folded;
    }
  }
  return null;
}

/**
 * The runtime import closure of `entries` over `files`, each reached file with the chain that first reaches it: every static
 * import, re-export, import-equals, dynamic import and require whose specifier resolves to a production file is followed,
 * except a declaration whose bindings are all type-only (erased at run time) and an `import("…")` type.
 */
function importClosure(files: FileMap, entries: readonly string[]): Map<string, readonly string[]> {
  const chains = new Map<string, readonly string[]>(entries.map((entry) => [entry, [entry]]));
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift()!;
    const source = files.get(file)!;
    const runtime = runtimeDeclarationSpecifiers(file, source);
    for (const reference of moduleReferences(file, source)) {
      if (reference.kind === "import-type") continue;
      if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
      const resolution = resolveSpecifier(file, reference.specifier);
      if (resolution.kind !== "module") continue;
      const target = fileOf(files, resolution.module);
      if (target === null || chains.has(target)) continue;
      chains.set(target, [...chains.get(file)!, target]);
      queue.push(target);
    }
  }
  return chains;
}

const EXTENSION = /\.[cm]?[jt]sx?$/;
/** The closure members that are a forbidden module or lie under pcb/fab, each as the chain that reaches it. */
function forbiddenReached(closure: ReadonlyMap<string, readonly string[]>): string[] {
  const forbidden = new Set<string>(FORBIDDEN);
  return [...closure].filter(([file]) => forbidden.has(file.replace(EXTENSION, "")) || file.startsWith(FAB_PREFIX)).map(([, chain]) => chain.join(" -> "));
}

describe("[B20 B2] J — the MCP server side's import boundary", () => {
  it("1. mcp-bearer.ts is imported only by route-handlers.ts and app/lib/mcp/server/**", { timeout: 120_000 }, () => {
    const importers = moduleImportOffenders(production, "app/lib/auth/mcp-bearer", new Set());
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.filter((path) => path !== "app/lib/auth/route-handlers.ts" && !path.startsWith("app/lib/mcp/server/"))).toEqual([]);
    expect(importers).toContain("app/lib/auth/route-handlers.ts");
  });

  it("2. the server modules, /api/mcp and app/.well-known reach no forbidden module and nothing under pcb/fab through their whole runtime import closure, and import no server auth module directly", { timeout: 120_000 }, () => {
    expect(serverSide).toEqual(expect.arrayContaining(["app/api/mcp/route.ts", "app/api/mcp/token/route.ts", "app/.well-known/oauth-protected-resource/api/mcp/route.ts", "app/lib/mcp/server/dispatch.ts", "app/lib/mcp/server/protocol.ts"]));
    const closure = importClosure(production, serverSide);
    expect(closure.size).toBeGreaterThan(serverSide.length);
    expect(closure.has("app/lib/auth/route-handlers.ts")).toBe(true);
    expect(closure.has("app/lib/engineering/tool-catalog.ts")).toBe(true);
    expect(forbiddenReached(closure)).toEqual([]);
    const scoped = new Map([...production].filter(([path]) => MCP_SERVER_SIDE(path)));
    for (const forbidden of DIRECT_ONLY) expect(moduleImportOffenders(scoped, forbidden, new Set()), forbidden).toEqual([]);
    // negative tripwires: a direct import, a helper one hop outside the server side, a literal dynamic import and a bare
    // side-effect import under pcb/fab are all caught; a type-only import is not a runtime edge
    const injected = new Map(production);
    injected.set("app/lib/mcp/server/evil-direct.ts", 'import { createExecutionGrantMinter } from "../../execution-grant/mint";\nexport const x = createExecutionGrantMinter;');
    injected.set("app/lib/mcp/server/evil-hop.ts", 'import { bridge } from "../call-bridge-b2-fixture";\nexport const x = bridge;');
    injected.set("app/lib/mcp/call-bridge-b2-fixture.ts", 'export { invokeTool as bridge } from "../engineering/tool-invocation";');
    injected.set("app/lib/mcp/server/evil-dynamic.ts", 'export const load = () => import("../../pcb/fab/presets");');
    injected.set("app/lib/mcp/server/evil-side-effect.ts", 'import "@/app/lib/pcb/fab/presets";');
    // [B20 B2 lead] Sirkit's filesystems are case-insensitive: a case-variant specifier reaches the same module and must be followed
    injected.set("app/lib/mcp/server/evil-case.ts", 'import { invokeTool } from "../../engineering/Tool-Invocation";\nexport const x = invokeTool;');
    injected.set("app/lib/mcp/server/evil-case-fab.ts", 'import "@/app/lib/pcb/FAB/presets";');
    injected.set("app/lib/mcp/server/types-only.ts", 'import type { ToolInvocationResult } from "../../engineering/tool-invocation";\nexport type T = ToolInvocationResult;');
    const reached = (entry: string): string[] => forbiddenReached(importClosure(injected, [entry]));
    expect(reached("app/lib/mcp/server/evil-direct.ts")[0]).toBe("app/lib/mcp/server/evil-direct.ts -> app/lib/execution-grant/mint.ts");
    expect(reached("app/lib/mcp/server/evil-hop.ts")[0]).toBe("app/lib/mcp/server/evil-hop.ts -> app/lib/mcp/call-bridge-b2-fixture.ts -> app/lib/engineering/tool-invocation.ts");
    expect(reached("app/lib/mcp/server/evil-dynamic.ts")[0]).toBe("app/lib/mcp/server/evil-dynamic.ts -> app/lib/pcb/fab/presets/index.ts");
    expect(reached("app/lib/mcp/server/evil-side-effect.ts")[0]).toBe("app/lib/mcp/server/evil-side-effect.ts -> app/lib/pcb/fab/presets/index.ts");
    expect(reached("app/lib/mcp/server/evil-case.ts")[0]).toBe("app/lib/mcp/server/evil-case.ts -> app/lib/engineering/tool-invocation.ts");
    expect(reached("app/lib/mcp/server/evil-case-fab.ts")[0]).toBe("app/lib/mcp/server/evil-case-fab.ts -> app/lib/pcb/fab/presets/index.ts");
    expect(reached("app/lib/mcp/server/types-only.ts")).toEqual([]);
    // the direct-only gate still catches a direct import of a server auth module
    const direct = new Map(scoped);
    direct.set("app/lib/mcp/server/evil-auth.ts", 'import { WORKER_SECRET_ENV } from "../../auth/worker-principal";');
    expect(moduleImportOffenders(direct, "app/lib/auth/worker-principal", new Set())).toEqual(["app/lib/mcp/server/evil-auth.ts"]);
  });

  it("3. the nine B11 files still carry no MCP or multi-agent identifier, and the trace provider is still openai | anthropic", () => {
    for (const file of B11_FILES) {
      expect(readFileSync(join(ROOT, "app", "lib", "agent", file), "utf8"), file).not.toMatch(/modelcontextprotocol|mcpServer|spawnAgent|multiAgent/i);
    }
    expect(readFileSync(join(ROOT, "app", "lib", "agent", "trace-recorder.ts"), "utf8")).toContain('provider: "openai" | "anthropic";');
  });

  it("4. no opaque module load in the new modules", { timeout: 120_000 }, () => {
    const scoped = new Map([...production].filter(([path]) => MCP_SERVER_SIDE(path) || path === "app/lib/auth/mcp-bearer.ts" || path === "app/lib/auth/route-tree.ts"));
    expect(scoped.size).toBeGreaterThanOrEqual(10);
    expect(opaqueModuleLoads(scoped)).toEqual([]);
  });
});
