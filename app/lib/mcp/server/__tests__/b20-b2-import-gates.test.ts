/**
 * [B20 B2] What the MCP server side may import (AST-resolved over the production tree): the bearer principal module is
 * reachable only from the canonical wrapper module and the MCP server modules; the server modules, the MCP routes and the
 * well-known route REACH — through their whole runtime import closure, not only directly — no grant, execution,
 * reauthorization, egress or client-transport module and nothing under pcb/fab but its static preset data, import no server
 * auth module directly, and load no module opaquely; the B11 trace files stay free of MCP identifiers.
 *
 * [B20 B3 review] What this gate no longer proves since B3: the closure now holds the B05 read service (reached from the MCP
 * tree only through read-call.ts, b20-b3-import-gates G1), the static fabrication preset data, and durable modules that CAN
 * write — the pcb-sync board repository and lineage store (reached only through the durable read bundle) and the durable
 * workflow runtime with its Postgres repository (reached only through the read runtime), both pinned by G7. That nothing
 * reachable over MCP writes a database is enforced at run time: a served read reaches the durable repository only through
 * `readOnlyDurableWorkflow`, which refuses every write without delegating (b20-b3-durable-read-bundle A12,
 * b20-b3-mcp-tools-call-reads H10 and H15).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectProductionFiles, moduleImportOffenders, opaqueModuleLoads } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { importClosure } from "./_import-closure";

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
  // [B20 B3] pin move, deliberate: "app/lib/engineering/tool-invocation" left this list when tools/call began serving reads
  // through the B05 service; b20-b3-import-gates G1 pins that every runtime chain from the MCP tree to it passes through
  // app/lib/mcp/server/read-call.ts
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
// [B20 B3] pin move: the static fabrication presets are data (JSON in the repository), and every served read reaches them —
// the readiness read consumes a fab preset, and the B05 bindings' board snapshot (pcb/ai/snapshot.ts) imports them. Every
// other pcb/fab module (qualification, release, export, the kicad-cli runner) stays forbidden.
const FAB_DATA = new Set(["app/lib/pcb/fab/presets/index.ts"]);
const B11_FILES = ["trace.ts", "trace-recorder.ts", "replay-capsule.ts", "replay-context.ts", "evaluation.ts", "evaluation-cases.ts", "pcb-shape-projection.ts", "pcb-shape-types.ts", "generated/pcb-shape-descriptor.ts"];

// [B20 B3 review] runtimeDeclarationSpecifiers, the case-folded resolution and importClosure moved unchanged to _import-closure.ts

const EXTENSION = /\.[cm]?[jt]sx?$/;
/** The closure members that are a forbidden module or lie under pcb/fab, each as the chain that reaches it. */
function forbiddenReached(closure: ReadonlyMap<string, readonly string[]>): string[] {
  const forbidden = new Set<string>(FORBIDDEN);
  return [...closure].filter(([file]) => forbidden.has(file.replace(EXTENSION, "")) || (file.startsWith(FAB_PREFIX) && !FAB_DATA.has(file))).map(([, chain]) => chain.join(" -> "));
}

describe("[B20 B2] J — the MCP server side's import boundary", () => {
  it("1. mcp-bearer.ts is imported only by route-handlers.ts and app/lib/mcp/server/**", { timeout: 120_000 }, () => {
    const importers = moduleImportOffenders(production, "app/lib/auth/mcp-bearer", new Set());
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.filter((path) => path !== "app/lib/auth/route-handlers.ts" && !path.startsWith("app/lib/mcp/server/"))).toEqual([]);
    expect(importers).toContain("app/lib/auth/route-handlers.ts");
  });

  it("2. the server modules, /api/mcp and app/.well-known reach no forbidden module and nothing under pcb/fab but its static preset data through their whole runtime import closure, and import no server auth module directly", { timeout: 120_000 }, () => {
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
    // [B20 B3] the tripwires retarget from tool-invocation and the fab presets (now reachable by design) to still-forbidden modules
    injected.set("app/lib/mcp/call-bridge-b2-fixture.ts", 'export { createAgentToolGateway as bridge } from "../agent/gateway";');
    injected.set("app/lib/mcp/server/evil-dynamic.ts", 'export const load = () => import("../../pcb/fab/release-gate");');
    injected.set("app/lib/mcp/server/evil-side-effect.ts", 'import "@/app/lib/pcb/fab/release-gate";');
    // [B20 B2 lead] Sirkit's filesystems are case-insensitive: a case-variant specifier reaches the same module and must be followed
    injected.set("app/lib/mcp/server/evil-case.ts", 'import { createAgentToolGateway } from "../../agent/Gateway";\nexport const x = createAgentToolGateway;');
    injected.set("app/lib/mcp/server/evil-case-fab.ts", 'import "@/app/lib/pcb/FAB/release-gate";');
    injected.set("app/lib/mcp/server/types-only.ts", 'import type { AgentGatewayOptions } from "../../agent/gateway";\nexport type T = AgentGatewayOptions;');
    const reached = (entry: string): string[] => forbiddenReached(importClosure(injected, [entry]));
    expect(reached("app/lib/mcp/server/evil-direct.ts")[0]).toBe("app/lib/mcp/server/evil-direct.ts -> app/lib/execution-grant/mint.ts");
    expect(reached("app/lib/mcp/server/evil-hop.ts")[0]).toBe("app/lib/mcp/server/evil-hop.ts -> app/lib/mcp/call-bridge-b2-fixture.ts -> app/lib/agent/gateway.ts");
    expect(reached("app/lib/mcp/server/evil-dynamic.ts")[0]).toBe("app/lib/mcp/server/evil-dynamic.ts -> app/lib/pcb/fab/release-gate.ts");
    expect(reached("app/lib/mcp/server/evil-side-effect.ts")[0]).toBe("app/lib/mcp/server/evil-side-effect.ts -> app/lib/pcb/fab/release-gate.ts");
    expect(reached("app/lib/mcp/server/evil-case.ts")[0]).toBe("app/lib/mcp/server/evil-case.ts -> app/lib/agent/gateway.ts");
    expect(reached("app/lib/mcp/server/evil-case-fab.ts")[0]).toBe("app/lib/mcp/server/evil-case-fab.ts -> app/lib/pcb/fab/release-gate.ts");
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
