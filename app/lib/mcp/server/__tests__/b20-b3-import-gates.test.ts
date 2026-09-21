/**
 * [B20 B3] G — the import boundary of the served reads (AST-resolved over the production tree): the B05 service is reached
 * from the MCP tree through read-call.ts alone — every runtime chain, not only the direct imports; the durable read bundle is
 * MCP-free and reached only from read-call.ts and the read runtime; the agent and the chat route never import it (chat stays
 * on the local working copy); the MCP server modules import no agent run module, no execution module, nothing under pcb/fab
 * or pcb-sync; only the read runtime composes the durable repository, the component-authority runtime and the identity
 * runtime; the durable modules that can write are reached only through the durable read bundle and the read runtime, which
 * builds the board reader over the read-only view alone; no module is loaded opaquely.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectProductionFiles, moduleImportOffenders, moduleReferences, opaqueModuleLoads, resolveSpecifier } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { importClosure } from "./_import-closure";

const ROOT = process.cwd();
const production = collectProductionFiles(ROOT);
const MCP_TREE = (path: string): boolean => path.startsWith("app/lib/mcp/") || path.startsWith("app/api/mcp/");
const mcpTree = new Map([...production].filter(([path]) => MCP_TREE(path)));
const serverModules = new Map([...production].filter(([path]) => path.startsWith("app/lib/mcp/server/")));
const BUNDLE = "app/lib/engineering/durable-read-bundle";
const READ_CALL = "app/lib/mcp/server/read-call.ts";
const READ_RUNTIME = "app/api/mcp/read-runtime.ts";
const TOOL_INVOCATION = "app/lib/engineering/tool-invocation.ts";
/** The durable modules that can write, and the one bridge each may be reached through from the MCP tree (G7). */
const DURABLE_WRITERS: ReadonlyArray<readonly [string, string]> = [
  ["app/lib/durable-workflow/runtime.ts", READ_RUNTIME],
  ["app/lib/durable-workflow/server-repository.ts", READ_RUNTIME],
  ["app/lib/pcb-sync/durable.ts", `${BUNDLE}.ts`],
  ["app/lib/pcb-sync/board-lineage.ts", `${BUNDLE}.ts`],
];

/** The modules a file references (resolved, extensionless), for every kind of reference. */
function referencedModules(path: string): string[] {
  const source = production.get(path);
  if (source === undefined) throw new Error(`not a production file: ${path}`);
  return moduleReferences(path, source).map((reference) => resolveSpecifier(path, reference.specifier)).filter((resolution): resolution is { kind: "module"; module: string } => resolution.kind === "module").map((resolution) => resolution.module);
}

describe("[B20 B3] G — the served reads' import boundary", () => {
  it("1. within app/lib/mcp and app/api/mcp, engineering/tool-invocation is imported by read-call.ts alone, and every runtime chain to it passes through read-call.ts (the deliberate move of B2's J2); a bridge outside the MCP tree is caught", { timeout: 120_000 }, () => {
    expect(moduleImportOffenders(mcpTree, "app/lib/engineering/tool-invocation", new Set())).toEqual([READ_CALL]);
    // [B20 B3 review] the whole runtime closure, not only direct imports: with read-call.ts as the one bridge nothing in the MCP
    // tree reaches the B05 service; without it the service is reached, through read-call.ts
    const entries = [...mcpTree.keys()];
    const open = importClosure(production, entries);
    expect(open.get(TOOL_INVOCATION)).toEqual(expect.arrayContaining([READ_CALL, TOOL_INVOCATION]));
    const bridged = importClosure(production, entries, new Set([READ_CALL]));
    expect(bridged.size).toBeGreaterThan(entries.length);
    expect(bridged.get(TOOL_INVOCATION)?.join(" -> ") ?? null).toBeNull();
    // tripwires: a module of the MCP tree that imports the read-replay fixtures (which load the service dynamically) or the
    // engineering barrel (which re-exports it) reaches the service around read-call.ts
    const injected = new Map(production);
    injected.set("app/lib/mcp/server/evil-replay.ts", 'import { buildReadReplayFixtures } from "../../engineering/tool-read-replay";\nexport const x = buildReadReplayFixtures;');
    injected.set("app/lib/mcp/server/evil-barrel.ts", 'export * from "../../engineering";');
    expect(importClosure(injected, ["app/lib/mcp/server/evil-replay.ts"], new Set([READ_CALL])).get(TOOL_INVOCATION)).toEqual(["app/lib/mcp/server/evil-replay.ts", "app/lib/engineering/tool-read-replay.ts", TOOL_INVOCATION]);
    expect(importClosure(injected, ["app/lib/mcp/server/evil-barrel.ts"], new Set([READ_CALL])).get(TOOL_INVOCATION)).toEqual(["app/lib/mcp/server/evil-barrel.ts", "app/lib/engineering/index.ts", TOOL_INVOCATION]);
    // and the direct-import gate alone misses both (why the closure is needed)
    expect(moduleImportOffenders(new Map([...injected].filter(([path]) => MCP_TREE(path))), "app/lib/engineering/tool-invocation", new Set())).toEqual([READ_CALL]);
  });

  it("2. the durable read bundle imports nothing from agent, mcp, auth, app/api or llm, and only read-call.ts and the read runtime import it", { timeout: 120_000 }, () => {
    const imported = referencedModules(`${BUNDLE}.ts`);
    expect(imported.length).toBeGreaterThan(5);
    expect(imported.filter((target) => /^app\/(lib\/(agent|mcp|auth|llm)\/|api\/)/.test(target))).toEqual([]);
    expect(moduleImportOffenders(production, BUNDLE, new Set()).sort()).toEqual(["app/api/mcp/read-runtime.ts", "app/lib/mcp/server/read-call.ts"]);
  });

  it("3. app/lib/agent and app/api/chat never import it; the chat route still refuses every authority but the local working copy", { timeout: 120_000 }, () => {
    const agentAndChat = new Map([...production].filter(([path]) => path.startsWith("app/lib/agent/") || path.startsWith("app/api/chat/")));
    expect(agentAndChat.size).toBeGreaterThan(10);
    expect(moduleImportOffenders(agentAndChat, BUNDLE, new Set())).toEqual([]);
    const chat = readFileSync(join(ROOT, "app", "api", "chat", "route.ts"), "utf8");
    expect(chat).toContain('if (editorContext.authoritySource !== "local-working-copy") {');
  });

  it("4. app/lib/mcp/server imports no agent run module, no execution module, nothing under pcb/fab and nothing under pcb-sync", { timeout: 120_000 }, () => {
    expect(serverModules.size).toBeGreaterThanOrEqual(11); // B2 seven, B3 four
    const offenders: string[] = [];
    for (const path of serverModules.keys()) {
      for (const target of referencedModules(path)) {
        if (/^app\/lib\/agent\/(context|gateway|loop|contracts)$/.test(target) || /^app\/lib\/(execution-|agent\/execution-)/.test(target) || target.startsWith("app/lib/pcb/fab/") || target.startsWith("app/lib/pcb-sync/")) offenders.push(`${path} -> ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("5. in the MCP tree only the read runtime imports the durable-workflow runtime, the component-authority runtime and the identity runtime", { timeout: 120_000 }, () => {
    for (const target of ["app/lib/durable-workflow/runtime", "app/api/chat/component-authority-runtime", "app/lib/auth/identity-runtime"]) {
      expect(moduleImportOffenders(mcpTree, target, new Set()), target).toEqual(["app/api/mcp/read-runtime.ts"]);
    }
    // the route resolves the dependencies inside the wrapper callback only (never at module scope, before authentication)
    const route = readFileSync(join(ROOT, "app", "api", "mcp", "route.ts"), "utf8");
    expect(route).toMatch(/mcpBearerJsonRoute\([^;]*\(input\) => handleMcpRequest\(input, \{ reads: resolveMcpReadDependencies\(\) \}\)\);/);
    expect(route.match(/resolveMcpReadDependencies\(/g) ?? []).toHaveLength(1);
  });

  it("6. no opaque module load in the B3 modules", { timeout: 120_000 }, () => {
    const scoped = new Map([...production].filter(([path]) => ["app/lib/engineering/durable-read-bundle.ts", "app/api/mcp/read-runtime.ts", "app/api/mcp/route.ts"].includes(path) || path.startsWith("app/lib/mcp/server/")));
    expect(scoped.size).toBeGreaterThanOrEqual(14);
    expect(opaqueModuleLoads(scoped)).toEqual([]);
  });

  it("7. the durable modules that can write are reached from the MCP tree only through the read-only composition: the durable-workflow runtime and its Postgres repository only through the read runtime, the pcb-sync board repository and lineage store only through the durable read bundle; the read runtime builds the board reader over the read-only view alone", { timeout: 120_000 }, () => {
    const entries = [...mcpTree.keys()];
    const open = importClosure(production, entries);
    for (const [writer, bridge] of DURABLE_WRITERS) {
      expect(open.get(writer), `${writer} is reached`).toEqual(expect.arrayContaining([bridge, writer]));
      expect(importClosure(production, entries, new Set([bridge])).get(writer)?.join(" -> ") ?? null, `${writer} around ${bridge}`).toBeNull();
    }
    // the read runtime touches the repository only inside the read-only view, and builds the reader only over that view
    const runtime = production.get(READ_RUNTIME)!;
    expect(runtime.match(/getDurableWorkflowRepository\(/g) ?? []).toHaveLength(1);
    expect(runtime).toContain("return readOnlyDurableWorkflow(getDurableWorkflowRepository());");
    expect(runtime.match(/createDurableBoardReader\(/g) ?? []).toHaveLength(1);
    expect(runtime).toContain("boardReader: createDurableBoardReader(productionMcpReadWorkflow()),");
    // tripwire: a dispatch-side module that imports the durable-workflow runtime directly is caught
    const injected = new Map(production);
    injected.set("app/lib/mcp/server/evil-writer.ts", 'import { getDurableWorkflowRepository } from "../../durable-workflow/runtime";\nexport const x = getDurableWorkflowRepository;');
    expect(importClosure(injected, ["app/lib/mcp/server/evil-writer.ts"], new Set([READ_RUNTIME])).get("app/lib/durable-workflow/server-repository.ts")).toEqual(["app/lib/mcp/server/evil-writer.ts", "app/lib/durable-workflow/runtime.ts", "app/lib/durable-workflow/server-repository.ts"]);
  });
});
