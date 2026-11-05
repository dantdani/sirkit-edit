/**
 * [PR-D d2] The agent's catalog part inspection, `sirkit.parts.catalog-inspect`: ONE catalog part by id through the chat route's
 * injected catalog port, over the SAME `loadCatalogPartDetail` the parts detail route answers the browser's part cache with.
 *
 *  - the descriptor: registered, valid, strict-compatible, Tier 0, its example validates against its schema, exposed in the reviewed
 *    list, withheld from MCP, bound to the one shared loader; the registry refuses a stray claim of the catalog authority on another
 *    class and an exposed catalog read bound elsewhere (parts.search, unexposed, stays valid);
 *  - denied discovery, with the reason: no catalog fact (authority_missing) at the registry AND at the run toolset; with the fact,
 *    offered even without a board or a schematic (the catalog is server-owned) and to a viewer; integrity in both directions;
 *  - the happy path through the REAL gateway with a FAKE port: the closed bounded projection (no raw symbol text, no properties
 *    blob, no links), the port asked once with the id, scope, run id and a deadline; a miss is data (found false), never an error;
 *  - failures returned as data: no port, no fact, a bad id, an extra or authority-shaped key, a failed port (closed code), a throwing
 *    port (redacted), a hanging port (timeout), a cancelled run; bounded pins;
 *  - the chat runtime boundary over the REAL fixture catalog, and the parts route as a thin caller of the same loader (one reader).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sirkitToolRegistry } from "../tool-catalog";
import { validateToolDescriptor, type ToolDescriptor } from "../tool-registry";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { validateAgainstSchema } from "../tool-io-validation";
import { discoverTools } from "../tool-discovery";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, agentExposureReport } from "../agent-exposure";
import { MCP_WITHHELD_TOOL_IDS, mcpExposureReport } from "../mcp-exposure";
import { NEVER_EXPOSED_TOOL_PATTERNS } from "../granted-execution-families";
import { TIER3_FLOOR_PATTERN, permissionTierOfDescriptor } from "../permission-tiers";
import type { ProjectRole } from "../types";
import { strictCompatibility } from "../../agent/provider-tools";
import { assembleAgentRunContext } from "../../agent/context";
import { createAgentToolGateway, verifyAgentContextIntegrity } from "../../agent/gateway";
import { buildRunToolset } from "../../agent/loop";
import type { AgentRunContext } from "../../agent/contracts";
import { CATALOG_INSPECTION_AUTHORITY, CATALOG_INSPECTION_BINDING, CATALOG_INSPECTION_VERIFICATION, CATALOG_INSPECT_INPUT_EXAMPLE, CATALOG_INSPECT_TOOL_ID, MAX_INSPECTED_PINS, resolveCatalogInspectionBinding, type CatalogPartInspectionPort, type CatalogPartInspectionPortAnswer, type CatalogPartInspectionPortRequest } from "../../agent/catalog-inspection-reads";
import type { CatalogPartDetail } from "../../atomic/catalog-part-detail";
import type { AtomicRevisionStatus } from "../../atomic/revision-status";
import { createEmptyBoard } from "../../pcb/types";
import { BLINKER_PART_IDS } from "../../fixture-runtime/blinker/catalog";
import { resetFixtureContainer } from "../../fixture-runtime/container";
import { CATALOG_DATABASE_SETTING, catalogInspectionServable, resetCatalogInspectionPortFactory, resolveCatalogInspectionPort, setCatalogInspectionPortFactory } from "@/app/api/chat/catalog-inspection-runtime";
import { loadCatalogPartDetail } from "@/app/lib/atomic/catalog-part-detail";
import { GET as partDetailRoute } from "@/app/api/parts/[id]/route";

const registry = sirkitToolRegistry();
const KNOWN = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
const TOOL = CATALOG_INSPECT_TOOL_ID;
const descriptor = (): ToolDescriptor => registry.get(TOOL)!;
const SCOPE = { tenantId: "local", projectId: "p-prd-catalog", branchId: "main" };
const PART_ID = CATALOG_INSPECT_INPUT_EXAMPLE.partId;

interface ContextOptions { catalog?: boolean; role?: ProjectRole; board?: boolean }
function contextFor(options: ContextOptions = {}): AgentRunContext {
  const assembly = assembleAgentRunContext({
    ...SCOPE,
    ...(options.board === false ? {} : { board: createEmptyBoard() }),
    verifiedActor: { principalId: "u-1", actorRole: options.role ?? "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" },
    ...(options.catalog === false ? {} : { catalogInspectionAvailable: true }),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
const reasonFor = (context: AgentRunContext): string => {
  const result = discoverTools(registry, context.discovery);
  if (result.included.some((item) => item.toolId === TOOL)) return "included";
  return result.excluded.find((item) => item.toolId === TOOL)?.reason ?? "absent";
};
const offered = (context: AgentRunContext, warnings: string[] = []): string[] => buildRunToolset(registry, context, (message) => { warnings.push(message); }).declarations.map((declaration) => declaration.toolId);

const pin = (number: string, name: string, type = "passive") => ({ number, name, type, position: { x: 0, y: 0 }, orientation: "right" as const, length: 2.54 });
const DETAIL: CatalogPartDetail = {
  id: PART_ID, name: "NE555D", description: "Precision timer, SOIC-8", keywords: null, mpn: "NE555DR", manufacturer: "Texas Instruments", datasheet: "https://example.invalid/ne555.pdf",
  footprintHint: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", mainCategory: "Timer", libraryName: "Timer", pins: [pin("1", "GND", "power_in"), pin("2", "TR", "input"), pin("3", "Q", "output")],
  symbolRaw: "(symbol \"NE555D\" ...)", properties: { Footprint: "Package_SO:SOIC-8", Datasheet: "x" }, internalPartNumber: null, lifecycleStatus: "active", rohsStatus: "compliant", packageNormalized: "SOIC-8", keySpecs: null, isGeneric: false,
  atomicAssignments: { "": { revisionId: "rev-default", symbolVersionId: "sym-1", footprintVersionId: "fp-1", mappingCertificateId: "map-1", footprintFullName: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", approved: true }, "10k": { revisionId: "rev-10k", symbolVersionId: "sym-2", footprintVersionId: "fp-2", mappingCertificateId: "map-2", footprintFullName: "Resistor_SMD:R_0603_1608Metric", approved: true } },
  withdrawnValueKeys: ["1k"],
} as unknown as CatalogPartDetail;
const STATUS: Record<string, AtomicRevisionStatus> = { "rev-default": { revisionId: "rev-default", logicalPartId: "lp-1", state: "published", selectable: true, pinnable: true } };

function fakePort(answer: CatalogPartInspectionPortAnswer | "hang" | "throw"): { port: CatalogPartInspectionPort; requests: CatalogPartInspectionPortRequest[] } {
  const requests: CatalogPartInspectionPortRequest[] = [];
  return {
    requests,
    port: {
      inspect: async (request) => {
        requests.push(request);
        if (answer === "hang") return new Promise<never>(() => { /* only the race ends this */ });
        if (answer === "throw") throw new Error("connection refused sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop");
        return answer;
      },
    },
  };
}
const gatewayWith = (port?: CatalogPartInspectionPort) => createAgentToolGateway(registry, { ...(port ? { catalogInspection: port } : {}), now: () => 1_760_000_000_000 });
const invoke = (gateway: ReturnType<typeof createAgentToolGateway>, context: AgentRunContext, args: Record<string, unknown>, timeoutMs = 5_000, signal?: AbortSignal) =>
  gateway.invoke({ runId: "run-prd-catalog", provider: "openai", callId: "call-cat-1", toolId: TOOL, version: "1.0.0", args, context, timeoutMs, ...(signal ? { signal } : {}) });
const resultOf = (outcome: Awaited<ReturnType<ReturnType<typeof createAgentToolGateway>["invoke"]>>): Record<string, unknown> => {
  if (outcome.kind !== "read") throw new Error(`not a read: ${JSON.stringify(outcome)}`);
  return outcome.output.result as Record<string, unknown>;
};

afterEach(() => { resetCatalogInspectionPortFactory(); vi.unstubAllEnvs(); resetFixtureContainer(); });

describe("PR-D d2 parts.catalog-inspect — the descriptor", () => {
  it("is registered, valid and strict-compatible: a Tier 0 parts read requiring exactly the catalog authority and no project state, bound to the one shared loader, exposed and MCP-withheld", () => {
    const d = descriptor();
    expect(validateToolDescriptor(d, KNOWN)).toEqual([]);
    expect(d).toMatchObject({
      version: "1.0.0", lifecycle: "active", owningCommandId: "parts.catalog-read", category: "parts", operationClass: "read", sideEffects: "none", approvalTier: "none",
      requiredCapability: "read_project", requiredRoles: ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"], requiredProjectState: [], requiredAuthority: [CATALOG_INSPECTION_AUTHORITY],
      requiresExpectedRevision: false, requiresLineage: false, discovery: "discoverable", callability: "callable", agentExposed: true, budgetClass: "interactive",
      binding: { status: "bound-read", module: CATALOG_INSPECTION_BINDING.module, symbol: CATALOG_INSPECTION_BINDING.symbol },
    });
    expect(strictCompatibility(d).ok).toBe(true);
    expect(resolveCatalogInspectionBinding(d)).toEqual({ state: "resolved" });
    expect(resolveCatalogInspectionBinding(registry.get("sirkit.parts.search")!).state).toBe("not_callable");
    expect(permissionTierOfDescriptor(d)).toBe(0);
    expect(TIER3_FLOOR_PATTERN.test(TOOL)).toBe(false);
    for (const pattern of NEVER_EXPOSED_TOOL_PATTERNS) expect(pattern.test(TOOL), String(pattern)).toBe(false);
    expect(validateAgainstSchema(CATALOG_INSPECT_INPUT_EXAMPLE, d.inputSchema)).toEqual([]);
    expect(validateAgainstSchema({}, d.inputSchema)).toEqual(["$.partId: required"]);
    expect(validateAgainstSchema({ partId: PART_ID, live: true }, d.inputSchema)).toEqual(["$.live: unknown field"]);
    expect(d.description).toContain(JSON.stringify(CATALOG_INSPECT_INPUT_EXAMPLE));
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toContain(TOOL);
    expect(agentExposureReport(registry)).toMatchObject({ ok: true, missing: [], unexpected: [], classViolations: [], executionViolations: [] });
    expect(MCP_WITHHELD_TOOL_IDS).toContain(TOOL);
    const mcp = mcpExposureReport(registry);
    expect(mcp.ok).toBe(true);
    expect(mcp.excludedByReason.withheld).toContain(TOOL);
  });

  it("the registry refuses the catalog authority on a non-read, on a side-effecting or approval-tiered read, and on an exposed read bound elsewhere; the unexposed parts.search keeps it", () => {
    const d = descriptor();
    expect(validateToolDescriptor({ ...registry.get("sirkit.schematic.propose-tier1-edit")!, requiredAuthority: ["catalog"] }, KNOWN).some((issue) => issue.includes("read class only"))).toBe(true);
    expect(validateToolDescriptor({ ...d, sideEffects: "engineering-state" }, KNOWN).some((issue) => issue.includes("no side effects beyond a derived cache"))).toBe(true);
    expect(validateToolDescriptor({ ...d, approvalTier: "reversible" }, KNOWN).some((issue) => issue.includes("carries no approval tier"))).toBe(true);
    expect(validateToolDescriptor({ ...d, binding: { status: "bound-read", module: "app/lib/parts-search.ts", symbol: "searchPartsForAI" } }, KNOWN).some((issue) => issue.includes("must bind the shared catalog part detail loader"))).toBe(true);
    expect(validateToolDescriptor(registry.get("sirkit.parts.search")!, KNOWN)).toEqual([]);
  });
});

describe("PR-D d2 parts.catalog-inspect — denied discovery, with the reason, at the registry and at the run", () => {
  it("with the server's catalog fact: included and offered - without a board or a schematic (the catalog is server-owned) and to a viewer", () => {
    const context = contextFor();
    expect(context.catalogInspectionAvailable).toBe(true);
    expect(context.discovery.availableAuthority).toContain("catalog");
    expect(verifyAgentContextIntegrity(context)).toEqual([]);
    expect(reasonFor(context)).toBe("included");
    expect(offered(context)).toContain(TOOL);
    const bare = contextFor({ board: false });
    expect(bare.canonicalState).toBeNull();
    expect(bare.schematic).toBeNull();
    expect(reasonFor(bare)).toBe("included");
    expect(offered(bare)).toContain(TOOL);
    expect(reasonFor(contextFor({ role: "viewer" }))).toBe("included");
  });

  it("no catalog fact (the server bound no catalog port): authority_missing; the authority is not advertised; the run toolset withholds it", () => {
    const context = contextFor({ catalog: false });
    expect(context.catalogInspectionAvailable).toBeUndefined();
    expect(context.discovery.availableAuthority).not.toContain("catalog");
    expect(reasonFor(context)).toBe("authority_missing");
    const warnings: string[] = [];
    expect(offered(context, warnings)).not.toContain(TOOL);
  });

  it("a context that advertises the authority without the server's fact (or the fact without the authority) fails integrity in both directions", () => {
    const advertised = contextFor({ catalog: false });
    (advertised.discovery as unknown as { availableAuthority: string[] }).availableAuthority = [...advertised.discovery.availableAuthority, "catalog"];
    expect(verifyAgentContextIntegrity(advertised)).toContain("the catalog authority is advertised without the server's catalog inspection fact");
    const claimed = contextFor({ catalog: false });
    (claimed as { catalogInspectionAvailable?: boolean }).catalogInspectionAvailable = true;
    expect(verifyAgentContextIntegrity(claimed)).toContain("the server's catalog inspection fact is present but the catalog authority is not advertised");
  });
});

describe("PR-D d2 parts.catalog-inspect — the happy path through the real gateway with a fake catalog", () => {
  it("answers the closed bounded projection: identity, library, hint, lifecycle, pins, exact revisions per value key with their status, the withdrawn keys - never the raw symbol, the properties blob or a link; the port was asked once", async () => {
    const fake = fakePort({ state: "found", detail: DETAIL, revisionStatus: STATUS });
    const context = contextFor();
    const outcome = await invoke(gatewayWith(fake.port), context, { partId: PART_ID });
    expect(outcome).toMatchObject({ kind: "read", ok: true, toolId: TOOL, version: "1.0.0", verification: CATALOG_INSPECTION_VERIFICATION, sourceRevisionDigest: context.canonicalRevisionDigest });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ partId: PART_ID, scope: SCOPE, runId: "run-prd-catalog" });
    expect(fake.requests[0]!.deadlineMs).toBeGreaterThan(0);
    expect(fake.requests[0]!.deadlineMs).toBeLessThanOrEqual(5_000);
    const result = resultOf(outcome);
    expect(result).toMatchObject({
      partId: PART_ID, found: true, source: "sirkit-catalog",
      part: { id: PART_ID, name: "NE555D", description: "Precision timer, SOIC-8", mpn: "NE555DR", manufacturer: "Texas Instruments", library: "Timer", mainCategory: "Timer", footprintHint: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", packageNormalized: "SOIC-8", lifecycleStatus: "active", rohsStatus: "compliant", isGeneric: false, internalPartNumber: null },
      pins: { count: 3, items: [{ number: "1", name: "GND", type: "power_in" }, { number: "2", name: "TR", type: "input" }, { number: "3", name: "Q", type: "output" }], truncated: 0 },
      authority: {
        exactRevisions: [
          { valueKey: "", revisionId: "rev-default", footprintFullName: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", approved: true, status: { state: "published", selectable: true, pinnable: true, successorRevisionId: null } },
          { valueKey: "10k", revisionId: "rev-10k", footprintFullName: "Resistor_SMD:R_0603_1608Metric", approved: true, status: { state: "unknown", selectable: null, pinnable: null, successorRevisionId: null } },
        ],
        withdrawnValueKeys: ["1k"],
      },
    });
    const text = JSON.stringify(outcome);
    expect(text).not.toContain("(symbol");
    expect(text).not.toContain("example.invalid");
    expect(text).not.toContain("Datasheet");
    expect(Object.keys(result).sort()).toEqual(["authority", "found", "部件".length === 2 ? "part" : "part", "partId", "pins", "source"].sort());
  });

  it("a part that is not in the catalog is DATA (ok, found false), never an error; nothing else is looked up", async () => {
    const fake = fakePort({ state: "not_found" });
    const outcome = await invoke(gatewayWith(fake.port), contextFor(), { partId: "b16-1c-part-none" });
    expect(outcome).toMatchObject({ kind: "read", ok: true });
    expect(resultOf(outcome)).toMatchObject({ partId: "b16-1c-part-none", found: false, note: expect.stringContaining("never calls a distributor") });
    expect(fake.requests).toHaveLength(1);
  });

  it("the pins are bounded: at most 128 listed, the rest counted", async () => {
    const many = { ...DETAIL, pins: Array.from({ length: MAX_INSPECTED_PINS + 72 }, (_, index) => pin(String(index + 1), `P${index + 1}`)) } as unknown as CatalogPartDetail;
    const outcome = await invoke(gatewayWith(fakePort({ state: "found", detail: many, revisionStatus: {} }).port), contextFor(), { partId: PART_ID });
    const pins = resultOf(outcome).pins as { count: number; items: unknown[]; truncated: number };
    expect(pins.count).toBe(MAX_INSPECTED_PINS + 72);
    expect(pins.items).toHaveLength(MAX_INSPECTED_PINS);
    expect(pins.truncated).toBe(72);
  });
});

describe("PR-D d2 parts.catalog-inspect — failures are returned as data; the port is never asked when it must not be", () => {
  it("no port: authority_unavailable although the context carries the fact; no fact: authority_unavailable; a bad, empty or over-long id, an extra key and an authority-shaped key (mpn, live, bind): invalid_input - the port is never asked", async () => {
    const fake = fakePort({ state: "found", detail: DETAIL, revisionStatus: STATUS });
    expect(await invoke(gatewayWith(), contextFor(), { partId: PART_ID })).toMatchObject({ kind: "refused", status: "authority_unavailable" });
    expect(await invoke(gatewayWith(fake.port), contextFor({ catalog: false }), { partId: PART_ID })).toMatchObject({ kind: "refused", status: "authority_unavailable" });
    const gateway = gatewayWith(fake.port);
    const context = contextFor();
    for (const [args, expected] of [
      [{}, /partId must be a catalog part id/],
      [{ partId: "" }, /partId must be a catalog part id/],
      [{ partId: "../etc/passwd" }, /partId must be a catalog part id/],
      [{ partId: "x".repeat(129) }, /partId must be a catalog part id/],
      [{ partId: PART_ID, limit: 5 }, /Unexpected argument/],
      [{ partId: PART_ID, mpn: "NE555DR" }, /authority-shaped/],
      [{ partId: PART_ID, live: true }, /authority-shaped/],
      [{ partId: PART_ID, bind: true }, /authority-shaped/],
    ] as Array<[Record<string, unknown>, RegExp]>) {
      const outcome = await invoke(gateway, context, args);
      expect(outcome, JSON.stringify(args).slice(0, 60)).toMatchObject({ kind: "refused", status: "invalid_input" });
      if (outcome.kind === "refused") expect(outcome.diagnostics[0], JSON.stringify(args).slice(0, 60)).toMatch(expected);
    }
    expect(fake.requests).toHaveLength(0);
  });

  it("a failed port is implementation_failed with its closed code (an unsafe code becomes UNKNOWN); a throwing port is redacted; a hanging port is a timeout; a cancelled run is cancelled", async () => {
    const context = contextFor();
    expect(await invoke(gatewayWith(fakePort({ state: "failed", code: "CATALOG_UNAVAILABLE" }).port), context, { partId: PART_ID })).toMatchObject({ kind: "refused", status: "implementation_failed", diagnostics: ["CATALOG_READ_FAILED:CATALOG_UNAVAILABLE"] });
    expect(await invoke(gatewayWith(fakePort({ state: "failed", code: "boom: connection to db-host failed" }).port), context, { partId: PART_ID })).toMatchObject({ kind: "refused", status: "implementation_failed", diagnostics: ["CATALOG_READ_FAILED:UNKNOWN"] });
    const thrown = await invoke(gatewayWith(fakePort("throw").port), context, { partId: PART_ID });
    expect(thrown).toMatchObject({ kind: "refused", status: "implementation_failed" });
    expect(JSON.stringify(thrown)).not.toContain("sk-ant-api03");
    expect(JSON.stringify(thrown)).not.toContain("connection refused");
    const hang = fakePort("hang");
    expect(await invoke(gatewayWith(hang.port), context, { partId: PART_ID }, 50)).toMatchObject({ kind: "refused", status: "timeout" });
    expect(hang.requests[0]!.deadlineMs).toBeLessThanOrEqual(50);
    const aborted = new AbortController();
    aborted.abort();
    const fake = fakePort({ state: "found", detail: DETAIL, revisionStatus: STATUS });
    expect(await invoke(gatewayWith(fake.port), context, { partId: PART_ID }, 5_000, aborted.signal)).toMatchObject({ kind: "refused", status: "cancelled" });
    expect(fake.requests).toHaveLength(0);
  });
});

describe("PR-D d2 parts.catalog-inspect — the chat route's runtime boundary and the one shared reader", () => {
  it("the port is servable only with a configured database (the setting's presence, never its value) or under the fixture runtime; the factory resolves accordingly; the seam overrides and resets; a throwing factory resolves to null", () => {
    expect(catalogInspectionServable({})).toBe(false);
    expect(catalogInspectionServable({ [CATALOG_DATABASE_SETTING]: "   " })).toBe(false);
    expect(catalogInspectionServable({ [CATALOG_DATABASE_SETTING]: "set" })).toBe(true);
    expect(catalogInspectionServable({ SIRKIT_FIXTURE_RUNTIME: "blinker" })).toBe(true);
    vi.stubEnv(CATALOG_DATABASE_SETTING, "");
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
    expect(resolveCatalogInspectionPort()).toBeNull();
    setCatalogInspectionPortFactory(() => { throw new Error("boom"); });
    expect(resolveCatalogInspectionPort()).toBeNull();
    const fake = fakePort({ state: "not_found" });
    setCatalogInspectionPortFactory(() => fake.port);
    expect(resolveCatalogInspectionPort()).toBe(fake.port);
    resetCatalogInspectionPortFactory();
    expect(resolveCatalogInspectionPort()).toBeNull();
  });

  it("under the fixture runtime the production port reads the committed catalog through the shared loader: a known part is found with its pins and exact revision status, an unknown id is not found; the parts route answers the SAME loader's part", async () => {
    vi.stubEnv(CATALOG_DATABASE_SETTING, "");
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
    const port = resolveCatalogInspectionPort();
    expect(port).not.toBeNull();
    const signal = new AbortController().signal;
    const found = await port!.inspect({ partId: BLINKER_PART_IDS.capacitor, scope: SCOPE, runId: "run-fixture", deadlineMs: 2_000, signal });
    expect(found.state).toBe("found");
    if (found.state !== "found") throw new Error("unreachable");
    expect(found.detail.id).toBe(BLINKER_PART_IDS.capacitor);
    expect(found.detail.pins.length).toBeGreaterThan(0);
    const revisionIds = Object.values(found.detail.atomicAssignments ?? {}).map((assignment) => assignment.revisionId);
    expect(revisionIds.length).toBeGreaterThan(0);
    for (const id of revisionIds) expect(found.revisionStatus[id]).toMatchObject({ state: "published", selectable: true });
    expect(await port!.inspect({ partId: "b16-1c-part-none", scope: SCOPE, runId: "run-fixture", deadlineMs: 2_000, signal })).toEqual({ state: "not_found" });
    // the whole gateway path over the real fixture port
    const outcome = await invoke(gatewayWith(port!), contextFor(), { partId: BLINKER_PART_IDS.capacitor });
    expect(outcome).toMatchObject({ kind: "read", ok: true });
    expect(resultOf(outcome)).toMatchObject({ found: true, part: { id: BLINKER_PART_IDS.capacitor } });
    // the route is a thin caller of the same loader: byte-identical part
    const response = await partDetailRoute(new Request(`http://localhost/api/parts/${BLINKER_PART_IDS.capacitor}`, { method: "GET" }), { params: Promise.resolve({ id: BLINKER_PART_IDS.capacitor }) });
    const body = (await response.json()) as { ok: boolean; part: unknown };
    expect(body.ok).toBe(true);
    expect(body.part).toEqual(await loadCatalogPartDetail(BLINKER_PART_IDS.capacitor));
  });

  it("one reader: the parts route imports the shared loader and holds no database read of its own; the agent module imports no database and no route", () => {
    const route = readFileSync(resolve(process.cwd(), "app/api/parts/[id]/route.ts"), "utf8");
    expect(route).toContain('import { loadCatalogPartDetail } from "@/app/lib/atomic/catalog-part-detail";');
    expect(route).not.toMatch(/getDb|drizzle-orm|partLifecycleStatus|selectableRevisionIdSql/);
    const loader = readFileSync(resolve(process.cwd(), "app/lib/atomic/catalog-part-detail.ts"), "utf8");
    expect(loader).toMatch(/partLifecycleStatus/);
    expect(loader).toContain("if (!UUID_RE.test(id)) return null;");
    const agent = readFileSync(resolve(process.cwd(), "app/lib/agent/catalog-inspection-reads.ts"), "utf8");
    const imports = [...agent.matchAll(/^import[^;]+from\s+"([^"]+)";?$/gm)].map((match) => match[1]);
    for (const specifier of imports) expect(specifier, specifier).not.toMatch(/\/db\/|\/api\/|server-catalog|drizzle/);
    expect(agent).not.toMatch(/getDb|fetch\(|process\.env/);
  });
});
