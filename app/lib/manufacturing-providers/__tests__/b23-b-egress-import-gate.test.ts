/**
 * [B23-B2] Who can reach the send (D23-3, D23-4; OD-165, OD-167; the mission's "never allow an agent ... to order hardware or spend
 * money", runbook :950). `provider-egress.ts` is the ONLY module that sends a provider exchange, and the only caller of the boundary's
 * `outboundUpload`; only the exchange service imports it, and the exchange service sends only after B1's revalidation, a consumed
 * plan and an admitting answer. This gate pins, over the runtime import graph (type-only imports erased):
 *  1. the importers: provider-egress.ts has exactly one production importer, provider-exchange.ts; `outboundUpload` is named in
 *     production only by its definition and provider-egress.ts; the exchange record is imported only by the exchange service (types)
 *     and the provider exchange route (its composition);
 *  2. the agent loop, the gateway, the chat route, the MCP server and every orchestration module reach none of the three B23-B2
 *     modules, nor the exchange service;
 *  3. the provider exchange route reaches the egress boundary only through provider-egress.ts;
 *  4. no outbox handler reaches a send: the outbox dispatcher, the effects runtime and every production module that names the
 *     dispatcher or an effect handler reach neither provider-egress.ts nor the exchange record, and the record's every commit carries
 *     an empty outbox (no event can ever be re-claimed after an expired lease, `repository.ts:36`, `server-repository.ts:32`);
 *  5. provider-egress.ts imports exactly its reviewed modules;
 *  6. each rule bites on an injected violation.
 *
 * Files are read as text and parsed; nothing is written to disk and nothing leaves the process.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { fileOf, importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";

const ROOT = process.cwd();
const EGRESS = "app/lib/manufacturing-providers/provider-egress.ts";
const LEDGER = "app/lib/manufacturing-providers/exchange-ledger.ts";
const SERVICE = "app/lib/manufacturing-providers/provider-exchange.ts";
const ROUTE = "app/api/pcb/provider-exchange/route.ts";
const BOUNDARY = "app/lib/net/outbound-fetch.ts";
const SENDING = [EGRESS, LEDGER, SERVICE] as const;
/** The agent's reach: the loop, the gateway, the chat route, the MCP server and orchestration (named entries, then whole directories). */
const AGENT_ENTRIES = ["app/lib/agent/loop.ts", "app/lib/agent/gateway.ts", "app/api/chat/route.ts", "app/api/chat/orchestration-runtime.ts", "app/api/mcp/route.ts", "app/api/mcp/read-runtime.ts", "app/lib/mcp/server/dispatch.ts"] as const;
const AGENT_DIRECTORIES = ["app/lib/agent/", "app/lib/mcp/", "app/api/chat/", "app/api/mcp/"] as const;
/** The outbox's own modules. */
const OUTBOX_ENTRIES = ["app/lib/durable-workflow/outbox.ts", "app/lib/durable-workflow/effects-runtime.ts", "app/lib/durable-workflow/runtime.ts"] as const;
/** provider-egress.ts's reviewed runtime imports. */
const EGRESS_IMPORTS = ["../acquisition/admission-control", "../net/outbound-fetch", "./outbound-package", "./provider-registry", "../durable-workflow/stable", "node:crypto"].sort();

let production: FileMap | null = null;
const files = (): FileMap => (production ??= collectProductionFiles(ROOT));
/** A file's runtime import edges to production files: the rule `importClosure` follows (type-only declarations erased). */
function runtimeEdges(map: FileMap, file: string): string[] {
  const source = map.get(file)!;
  const runtime = runtimeDeclarationSpecifiers(file, source);
  const edges: string[] = [];
  for (const reference of moduleReferences(file, source)) {
    if (reference.kind === "import-type") continue;
    if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
    const resolution = resolveSpecifier(file, reference.specifier);
    if (resolution.kind !== "module") continue;
    const target = fileOf(map, resolution.module);
    if (target !== null && !edges.includes(target)) edges.push(target);
  }
  return edges;
}
/** The direct runtime importers of `target` among `map`'s files (a type-only import does not count); only a file whose text names the
 *  target's file name can import it (the B23 directory holds no index module). */
function importersOf(map: FileMap, target: string): string[] {
  const name = target.split("/").at(-1)!.replace(/\.ts$/, "");
  return [...map.keys()].filter((file) => file !== target && map.get(file)!.includes(name) && runtimeEdges(map, file).includes(target)).sort();
}
const reaches = (map: FileMap, entries: readonly string[], targets: readonly string[], bridges: ReadonlySet<string> = new Set()): string[] => {
  const closure = importClosure(map, entries.filter((entry) => map.has(entry)), bridges);
  return targets.filter((target) => closure.has(target));
};
/** Every production module under the agent's directories. */
const agentModules = (map: FileMap): string[] => [...map.keys()].filter((file) => AGENT_DIRECTORIES.some((dir) => file.startsWith(dir)));
/** Production modules that name the outbox dispatcher or an effect handler (they run outbox events). */
const outboxModules = (map: FileMap): string[] => [...map.keys()].filter((file) => /\bDurableOutboxDispatcher\b|\bDurableEffectHandler\b|OutboxHandlers\b/.test(map.get(file)!));
/** Every `X.commit({...})` object literal in `source` and whether its `outbox` property is an empty array literal. */
function commitOutboxes(path: string, source: string): Array<{ line: number; empty: boolean }> {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: Array<{ line: number; empty: boolean }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "commit") {
      const argument = node.arguments[0];
      const outbox = argument && ts.isObjectLiteralExpression(argument) ? argument.properties.find((property) => property.name !== undefined && ts.isIdentifier(property.name) && property.name.text === "outbox") : undefined;
      const empty = outbox !== undefined && ts.isPropertyAssignment(outbox) && ts.isArrayLiteralExpression(outbox.initializer) && outbox.initializer.elements.length === 0;
      found.push({ line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1, empty });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

describe("[B23-B2] only the exchange service reaches the send (OD-165, OD-167)", () => {
  it("1. provider-egress.ts has exactly one production importer, the exchange service; outboundUpload is named only by its definition and provider-egress.ts; the exchange record is imported only by the exchange service and by the provider exchange route, which composes it; the exchange service only by that route", { timeout: 120_000 }, () => {
    const map = files();
    expect(map.has(EGRESS) && map.has(LEDGER)).toBe(true);
    expect(importersOf(map, EGRESS)).toEqual([SERVICE]);
    expect([...map.keys()].filter((file) => /\boutboundUpload\b/.test(map.get(file)!)).sort()).toEqual([BOUNDARY, EGRESS].sort());
    expect(importersOf(map, LEDGER)).toEqual([ROUTE, SERVICE].sort());
    expect(importersOf(map, SERVICE)).toEqual([ROUTE]);
  });

  it("2. the agent loop, the gateway, the chat route, the MCP server and every orchestration module reach neither the send, the exchange record nor the exchange service", { timeout: 120_000 }, async () => {
    const map = files();
    for (const entry of AGENT_ENTRIES) {
      expect(map.has(entry), entry).toBe(true);
      expect(reaches(map, [entry], SENDING), entry).toEqual([]);
    }
    const modules = agentModules(map);
    expect(modules.length).toBeGreaterThanOrEqual(80);
    expect(modules.filter((file) => file.startsWith("app/lib/agent/orchestration/")).length).toBeGreaterThan(5);
    for (const [index, module] of modules.entries()) {
      expect(reaches(map, [module], SENDING), module).toEqual([]);
      if (index % 20 === 19) await new Promise((resolve) => setImmediate(resolve)); // yield between walks (lead lesson 3)
    }
  });

  it("3. the provider exchange route reaches the egress boundary, and only through provider-egress.ts: with that one module bridged, the boundary is out of its closure, and its chain to the boundary runs route -> exchange service -> provider-egress.ts", { timeout: 120_000 }, () => {
    const map = files();
    const closure = importClosure(map, [ROUTE]);
    expect(closure.has(BOUNDARY)).toBe(true);
    expect(closure.get(BOUNDARY)!.slice(0, 3)).toEqual([ROUTE, SERVICE, EGRESS]);
    expect(reaches(map, [ROUTE], [BOUNDARY], new Set([EGRESS]))).toEqual([]);
  });

  it("4. no outbox handler reaches a send: the outbox dispatcher, the effects runtime and every module that names the dispatcher or an effect handler reach neither provider-egress.ts nor the exchange record, and every commit the exchange record makes carries an empty outbox", { timeout: 120_000 }, () => {
    const map = files();
    const runners = [...new Set([...OUTBOX_ENTRIES, ...outboxModules(map)])].sort();
    expect(runners).toEqual(expect.arrayContaining([...OUTBOX_ENTRIES]));
    expect(runners.length).toBeGreaterThanOrEqual(4);
    for (const runner of runners) expect(reaches(map, [runner], [EGRESS, LEDGER]), runner).toEqual([]);
    const commits = commitOutboxes(LEDGER, map.get(LEDGER)!);
    expect(commits.length).toBeGreaterThanOrEqual(1);
    expect(commits.filter((commit) => !commit.empty)).toEqual([]);
    expect(commitOutboxes(EGRESS, map.get(EGRESS)!)).toEqual([]);
    for (const outboxModule of ["../durable-workflow/outbox", "../durable-workflow/effects-runtime", "../durable-workflow/runtime"]) {
      expect(runtimeDeclarationSpecifiers(LEDGER, map.get(LEDGER)!).has(outboxModule), outboxModule).toBe(false);
      expect(runtimeDeclarationSpecifiers(EGRESS, map.get(EGRESS)!).has(outboxModule), outboxModule).toBe(false);
    }
  });

  it("5. provider-egress.ts imports exactly its reviewed modules: the meters, the boundary, the package's types and path, the registry's version and the digest", () => {
    const map = files();
    expect([...runtimeDeclarationSpecifiers(EGRESS, map.get(EGRESS)!)].sort()).toEqual(EGRESS_IMPORTS);
  });

  it("6. each rule bites on an injected violation: a gateway that imports provider-egress.ts, a second importer, an outbox handler module that reaches the send, a route reaching the boundary around provider-egress.ts, and an exchange-record commit with an outbox effect", { timeout: 120_000 }, () => {
    const map = files();
    const withGateway: FileMap = new Map(map).set("app/lib/agent/gateway.ts", `${map.get("app/lib/agent/gateway.ts")!}\nimport { sendProviderExchange } from "../manufacturing-providers/provider-egress";\nvoid sendProviderExchange;\n`);
    expect(reaches(withGateway, ["app/lib/agent/gateway.ts"], SENDING)).toContain(EGRESS);
    const withSecond: FileMap = new Map(map).set("app/lib/bom/b23-probe.ts", 'import { sendProviderExchange } from "../manufacturing-providers/provider-egress";\nexport const probe = sendProviderExchange;\n');
    expect(importersOf(withSecond, EGRESS)).toEqual(["app/lib/bom/b23-probe.ts", SERVICE]);
    const withHandler: FileMap = new Map(map).set("app/lib/durable-workflow/b23-probe-handlers.ts", 'import type { DurableEffectHandler } from "./outbox";\nimport { sendProviderExchange } from "../manufacturing-providers/provider-egress";\nexport const probeHandler: DurableEffectHandler = async () => { void sendProviderExchange; };\n');
    expect(outboxModules(withHandler)).toContain("app/lib/durable-workflow/b23-probe-handlers.ts");
    expect(reaches(withHandler, ["app/lib/durable-workflow/b23-probe-handlers.ts"], [EGRESS, LEDGER])).toEqual([EGRESS]);
    const around: FileMap = new Map(map).set(ROUTE, `${map.get(ROUTE)!}\nimport { outboundFetch } from "@/app/lib/net/outbound-fetch";\nvoid outboundFetch;\n`);
    expect(reaches(around, [ROUTE], [BOUNDARY], new Set([EGRESS]))).toEqual([BOUNDARY]);
    const effectful = map.get(LEDGER)!.replace("outbox: []", 'outbox: [{ owner: { aggregateType: "x", aggregateKey: "y" }, eventType: "mfg.provider-send", eventVersion: 1, topic: "mfg.provider-send", payload: {} }]');
    expect(effectful).not.toBe(map.get(LEDGER));
    expect(commitOutboxes(LEDGER, effectful).filter((commit) => !commit.empty).length).toBeGreaterThanOrEqual(1);
    const runtimeImport = map.get(EGRESS)!.replace('from "../net/outbound-fetch";', 'from "../net/outbound-fetch";\nimport { DurableOutboxDispatcher } from "../durable-workflow/outbox";\nvoid DurableOutboxDispatcher;');
    expect(runtimeDeclarationSpecifiers(EGRESS, runtimeImport).has("../durable-workflow/outbox")).toBe(true);
  });
});
