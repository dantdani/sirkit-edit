/**
 * [B20 B3] F — the reviewed MCP subset move (D-1, D-4; OD-68, OD-69): schematic.inspect and project.history-inspect move from
 * the exposed list to the withheld list (each needs browser-only state), the nine servable reads stay exposed, the five
 * proposals stay listed; six board reads declare the durable-server-board authority beside the local working copy. No
 * descriptor's version, no other field and no other descriptor changes, and the agent path is byte-identical.
 * [B20 B4] pin move (OD-82, OD-87): B4 moved the five proposals to the withheld list too, so the subset is the nine reads and
 * seven ids are withheld (b20-b4-withhold-proposals).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "../agent-exposure";
import { DURABLE_BUILDABLE_RESOURCE_KINDS } from "../durable-read-bundle";
import { INTENTIONAL_MCP_EXPOSED_TOOL_IDS, MCP_WITHHELD_TOOL_IDS, mcpExposureReport } from "../mcp-exposure";
import { engineeringDigest } from "../stable";
import { SIRKIT_TOOL_CATALOG, sirkitToolRegistry } from "../tool-catalog";
import { resolveReadBinding } from "../tool-bindings-readonly";
import { discoverTools, type DiscoveryContext } from "../tool-discovery";
import { ToolRegistry, TOOL_AUTHORITY_SOURCES, TOOL_PROJECT_STATES, TOOL_SELECTION_KINDS, type ToolDescriptor } from "../tool-registry";
import { renderMcpToolListing, renderMcpToolManifestCsv, renderMcpToolManifestJson } from "../../mcp/server/tool-definitions";

const registry = sirkitToolRegistry();
const descriptor = (toolId: string): ToolDescriptor => registry.get(toolId)!;
/**
 * [B20 A4] pin move: B20-A4 ADDED one descriptor after this move (sirkit.mcp.observation-read, the agent's external tool read of
 * approved MCP servers; never MCP-exposed). The base pins below state B3's move, so they are compared over the registry WITHOUT
 * that one addition; cases 4 and 5 also pin that the addition is the only difference [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): with B22-B's five named computations, left out of the base the same way] (one more descriptor, one more agent id,
 * and under these contexts one more exclusion: `authority_missing` since none carries its authority, or `project_state_missing`
 * where the board is absent, a reason checked first).
 */
const A4_ADDITION = "sirkit.mcp.observation-read";
const B22B_ADDITIONS = ["sirkit.computation.analytical-equation", "sirkit.computation.artifact-compare", "sirkit.computation.artifact-parse", "sirkit.computation.circuit-analysis", "sirkit.computation.layout-experiment"]; const B24D2_ADDITION = "sirkit.pcb.board-page-inspect"; const baseRegistry = new ToolRegistry(SIRKIT_TOOL_CATALOG.filter((item) => item.toolId !== A4_ADDITION && !B22B_ADDITIONS.includes(item.toolId) && item.toolId !== B24D2_ADDITION)); // [B22-B, 2026-10-01] reviewed pin move: the base also leaves out B22-B's five named computations, so B3's base pins stand; [B24-D2, 2026-10-09] and B24-D2's paged board read (OD-213), left out of the base the same way: it is offered wherever via-inspect is (case 5)
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);

const SERVED_READS = [
  "sirkit.component-authority.inspect", "sirkit.manufacturing.readiness-inspect", "sirkit.pcb.board-inspect", "sirkit.pcb.mechanical-inspect",
  "sirkit.pcb.revision-inspect", "sirkit.pcb.via-inspect", "sirkit.project.canonical-revision-inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run",
];
const PROPOSALS = ["sirkit.pcb.propose-bounded-edit", "sirkit.placement.propose", "sirkit.routing.propose", "sirkit.schematic.propose-component-replacement", "sirkit.schematic.propose-tier1-edit"];
const WITHHELD_READS = ["sirkit.project.history-inspect", "sirkit.schematic.inspect"];
// [B20 B4] pin move (OD-82, OD-87): the five proposals are withheld too
const WITHHELD = [...WITHHELD_READS, ...PROPOSALS, B24D2_ADDITION].sort(); // [B24-D2, 2026-10-09] pin move (OD-235): a third withheld category beside B3's reads and B4's proposals - B24-D2's paged board read, servable from durable state (unlike WITHHELD_READS, case 3) and withheld by choice
const WIDENED = ["sirkit.project.canonical-revision-inspect", "sirkit.pcb.board-inspect", "sirkit.pcb.mechanical-inspect", "sirkit.pcb.via-inspect", "sirkit.validation.drc-run", "sirkit.validation.connectivity-verify"];
const WIDENED_NOTE = "B20-B3: durable-server-board declared (served over MCP from the durable board)";

/** Pins computed at the base (HEAD 0e80b30, before the registry change) by the same formulas as below. */
const BASE = {
  strippedAll: "eng1-7b927366bac0c15d",
  untouchedFull: "eng1-5d4d572683658fe9",
  versions: { "sirkit.project.canonical-revision-inspect": "1.0.0", "sirkit.pcb.board-inspect": "1.1.0", "sirkit.pcb.mechanical-inspect": "1.0.0", "sirkit.pcb.via-inspect": "1.0.0", "sirkit.validation.drc-run": "1.0.0", "sirkit.validation.connectivity-verify": "1.0.0" } as Record<string, string>,
  discovery: { agent: "eng1-eb6f4eefc1b63aaa", agentLocalOnly: "eng1-eb6f4eefc1b63aaa", agentViewer: "eng1-f592e27ad690b4f5", agentNoBoard: "eng1-136fc4d92a1d0b80", agentGrant: "eng1-4cfcbf5d8ec8e1cc" } as Record<string, string>,
  count: 41,
};

/** The B04 suite's editor context (b04-tool-registry.test.ts editorContext). */
function editorContext(overrides?: Partial<DiscoveryContext>): DiscoveryContext {
  return {
    tenantId: "tenant-a", projectId: "project-a", branchId: "main", actorId: "local-editor", actorRole: "pcb_editor",
    grantedCapabilities: ["read_project", "edit_placement", "edit_copper", "edit_zones", "run_automation", "export_project"],
    channel: "interactive-ui", currentRevisionDigest: "eng1-headdigest", lineageId: "lin1-lineage", currentEditor: "pcb",
    selectedKinds: ["footprint", "track", "via", "zone"], projectState: ["board-present", "schematic-present", "catalog-available"],
    availableAuthority: ["local-working-copy", "durable-server-board", "catalog"], providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 64, maxToolCount: 100 },
    riskCeiling: "destructive", approvalsAvailable: ["reversible", "topology-or-geometry", "destructive"], enabledFlags: [], requestedCategories: [],
    ...overrides,
  };
}
const AGENT_CONTEXTS: Record<string, Partial<DiscoveryContext>> = {
  agent: { channel: "assistant-agent", riskCeiling: "propose" },
  agentLocalOnly: { channel: "assistant-agent", riskCeiling: "propose", availableAuthority: ["local-working-copy"] },
  agentViewer: { channel: "assistant-agent", riskCeiling: "propose", actorRole: "viewer", grantedCapabilities: ["read_project"] },
  agentNoBoard: { channel: "assistant-agent", riskCeiling: "propose", projectState: ["schematic-present"], availableAuthority: ["local-working-copy"] },
  agentGrant: { channel: "assistant-agent", grantedCapabilities: ["read_project"], grantableCapabilities: ["edit_placement"], grantLineageId: "lin1-pcb", riskCeiling: "mutate", approvalsAvailable: ["reversible"] },
};
const identityOf = (result: ReturnType<typeof discoverTools>): string => engineeringDigest({
  included: result.included.map((item) => [item.toolId, item.version]),
  excluded: result.excluded.map((item) => [item.toolId, item.version, item.reason]),
});
const strip = (item: ToolDescriptor): Record<string, unknown> => {
  const { requiredAuthority: _authority, versionNotes: _notes, ...rest } = item as ToolDescriptor & { versionNotes?: string };
  void _authority; void _notes;
  return rest;
};
/** The rule a read must meet to be served from durable state (D-3): declared kinds buildable, the durable authority, board state only. */
function servableFromDurableState(item: ToolDescriptor): boolean {
  const binding = resolveReadBinding(item);
  if (binding.state !== "resolved") return false;
  return binding.binding.requiredResources.every((kind) => (DURABLE_BUILDABLE_RESOURCE_KINDS as readonly string[]).includes(kind))
    && item.requiredAuthority.includes("durable-server-board")
    && item.requiredProjectState.every((state) => state === "board-present");
}

describe("[B20 B3] F — the reviewed MCP subset move", () => {
  it("1. exactly 9 exposed ids and 7 withheld ids, sorted and frozen, each withheld id with its reason comment; the report is clean with count 9", () => { // [B24-D2, 2026-10-09] eight withheld since B24-D2 (+ the paged board read, OD-235); assertions over WITHHELD
    // [B20 B4] pin move: 14 exposed / 2 withheld -> 9 / 7 (the five proposals withheld, OD-82, OD-87)
    expect([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS]).toEqual([...SERVED_READS]);
    expect([...MCP_WITHHELD_TOOL_IDS]).toEqual(WITHHELD);
    for (const list of [INTENTIONAL_MCP_EXPOSED_TOOL_IDS, MCP_WITHHELD_TOOL_IDS]) {
      expect(Object.isFrozen(list)).toBe(true);
      expect([...list]).toEqual([...new Set(list)].sort());
    }
    const source = read("app/lib/engineering/mcp-exposure-review.ts");
    const withheldBlock = source.slice(source.indexOf("export const MCP_WITHHELD_TOOL_IDS"));
    for (const id of WITHHELD) expect(withheldBlock, id).toMatch(new RegExp(`"${id.replaceAll(".", "\\.")}",\\s+// .{20,}`));
    const report = mcpExposureReport(registry);
    expect(report).toMatchObject({ ok: true, missing: [], unexpected: [], outsideAgentSet: [], duplicates: [], count: 9 });
    expect([...report.excludedByReason.withheld]).toEqual(WITHHELD);
  });

  it("2. every exposed read is servable from durable state: its declared kinds are buildable, it accepts the durable authority, it needs board state only", () => {
    for (const id of SERVED_READS) expect(servableFromDurableState(descriptor(id)), id).toBe(true);
  });

  it("3. each withheld read fails that rule", () => {
    for (const id of WITHHELD_READS) expect(servableFromDurableState(descriptor(id)), id).toBe(false); expect(servableFromDurableState(descriptor(B24D2_ADDITION))).toBe(true); // [B24-D2, 2026-10-09] the third withheld category is excluded from this rule: B24-D2's paged board read IS servable from durable state and is withheld by choice (OD-235)
  });

  it("4. the six widened descriptors carry exactly the new authority at their base version; every other field and every other descriptor equals its base pin", () => {
    for (const id of WIDENED) {
      const item = descriptor(id);
      expect([...item.requiredAuthority], id).toEqual(["local-working-copy", "durable-server-board"]);
      expect(item.version, id).toBe(BASE.versions[id]);
      expect(item.versionNotes?.endsWith(WIDENED_NOTE), id).toBe(true);
    }
    expect(baseRegistry.list()).toHaveLength(BASE.count);
    expect(registry.list().map((item) => item.toolId).filter((id) => !baseRegistry.get(id))).toEqual([...B22B_ADDITIONS, A4_ADDITION, B24D2_ADDITION].sort()); // [B24-D2, 2026-10-09] + the paged board read // [B20 A4]; [B22-B, 2026-10-01] reviewed pin move (OD-139): + the five named computations, left out of the base like A4's addition
    expect(engineeringDigest(Object.fromEntries(baseRegistry.list().map((item) => [`${item.toolId}@${item.version}`, engineeringDigest(strip(item))])))).toBe(BASE.strippedAll);
    expect(engineeringDigest(Object.fromEntries(baseRegistry.list().filter((item) => !WIDENED.includes(item.toolId)).map((item) => [`${item.toolId}@${item.version}`, engineeringDigest(item)])))).toBe(BASE.untouchedFull);
    // pcb.revision-inspect and readiness-inspect already declared it; the withheld reads keep their own authority
    expect([...descriptor("sirkit.pcb.revision-inspect").requiredAuthority]).toEqual(["local-working-copy", "durable-server-board"]);
    expect([...descriptor("sirkit.schematic.inspect").requiredAuthority]).toEqual(["local-working-copy"]);
  });

  it("5. the agent set is still B3's 32 without A4's one addition and B22-B's three named computation reads (33 with A4's, 36 with both) and assistant-agent discovery under the B04 contexts is byte-equal to the base pins (B22-B's five descriptors excluded under every context)", () => { // [B24-D2, 2026-10-09] 37 with B24-D2's paged board read too, left out of the base and offered wherever via-inspect is // [B22 closeout, 2026-10-02] retitled (D22-16): 36 since B22-B (OD-139); assertions unchanged
    // [B20 A4] pin move: 32 + the external tool read (33); B3's 32 are unchanged
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.filter((id) => id !== A4_ADDITION && !B22B_ADDITIONS.includes(id) && id !== B24D2_ADDITION)).toHaveLength(32);
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toHaveLength(37); // [B22-B, 2026-10-01] pin move (OD-139): + the three named computation reads; [B24-D2, 2026-10-09] pin move (OD-213): + the paged board read
    const actual = Object.fromEntries(Object.entries(AGENT_CONTEXTS).map(([name, overrides]) => [name, identityOf(discoverTools(baseRegistry, editorContext(overrides)))]));
    expect(actual).toEqual(BASE.discovery);
    for (const overrides of Object.values(AGENT_CONTEXTS)) {
      const base = discoverTools(baseRegistry, editorContext(overrides));
      const now = discoverTools(registry, editorContext(overrides));
      expect(now.included.filter((entry) => entry.toolId !== B24D2_ADDITION)).toEqual(base.included); expect(now.included.some((entry) => entry.toolId === B24D2_ADDITION)).toBe(now.included.some((entry) => entry.toolId === "sirkit.pcb.via-inspect")); // [B24-D2, 2026-10-09] the paged board read is the one addition, offered wherever via-inspect is
      expect(now.excluded.filter((entry) => entry.toolId !== A4_ADDITION && !B22B_ADDITIONS.includes(entry.toolId) && entry.toolId !== B24D2_ADDITION)).toEqual(base.excluded); expect(B22B_ADDITIONS.every((id) => now.excluded.some((entry) => entry.toolId === id) && !now.included.some((item) => item.toolId === id))).toBe(true); // [B22-B] no context here carries the computation-engine authority: each computation is excluded, never included
      // no context here carries the external-mcp-observation authority; agentNoBoard also lacks the board, a reason checked first
      const expected = overrides.projectState !== undefined && !overrides.projectState.includes("board-present") ? "project_state_missing" : "authority_missing";
      expect(now.excluded.filter((entry) => entry.toolId === A4_ADDITION).map((entry) => entry.reason)).toEqual([expected]);
    }
  });

  it("6. under the most permissive context the mcp channel includes exactly the 9 reads ([B20 B4] the 5 proposals are withheld)", () => {
    const context: DiscoveryContext = {
      tenantId: "local", projectId: "p", branchId: "main", actorId: "u1", actorRole: "project_admin",
      grantedCapabilities: ["read_project", "edit_placement", "edit_copper", "edit_zones", "edit_stackup_outline", "edit_constraints", "edit_components", "manage_protection", "run_automation", "approve_proposal", "restore_project", "migrate_project", "export_project"],
      channel: "mcp", currentRevisionDigest: "eng1-0000000000000000", lineageId: "lineage-1", currentEditor: "", selectedKinds: [...TOOL_SELECTION_KINDS],
      projectState: [...TOOL_PROJECT_STATES], availableAuthority: [...TOOL_AUTHORITY_SOURCES],
      providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 128, maxToolCount: 64 },
      riskCeiling: "release", approvalsAvailable: ["reversible", "topology-or-geometry", "destructive", "release"], enabledFlags: [], requestedCategories: [],
      grantableCapabilities: ["edit_placement"], grantLineageId: "grant-lineage-1",
    };
    const included = discoverTools(registry, context).included.map((item) => item.toolId).sort();
    expect(included).toEqual([...SERVED_READS]); // [B20 B4] pin move: the proposals left the channel with the subset
    for (const id of WITHHELD) expect(included).not.toContain(id);
  });

  it("7. mcp-tool-manifest.csv and .json byte-equal the renderers: 9 rows exposed, the 7 withheld rows with reason withheld", () => { // [B24-D2, 2026-10-09] the 8 withheld rows since B24-D2 (OD-235)
    expect(read("artifacts/ai-control-plane-b20/mcp-tool-manifest.csv")).toBe(renderMcpToolManifestCsv(registry));
    expect(read("artifacts/ai-control-plane-b20/mcp-tool-manifest.json")).toBe(renderMcpToolManifestJson(registry));
    const rows = renderMcpToolManifestCsv(registry).split(NEWLINE).slice(1, -1).map((row) => row.split(","));
    // [B20 B4] pin move: 14 / 2 -> 9 / 7 (OD-82, OD-87)
    expect(rows.filter((row) => row[5] === "yes").map((row) => row[0])).toEqual([...SERVED_READS]);
    expect(rows.filter((row) => row[6] === "withheld").map((row) => row[0])).toEqual(WITHHELD);
    expect(renderMcpToolListing(registry).tools.map((tool) => tool.name)).toEqual([...SERVED_READS]);
  });

  it("8. the page states 9, 7, 2 and 5 and each B3 suite's case count, and every file:line reference resolves to the code it quotes", () => {
    const page = read("artifacts/ai-control-plane-b20/mcp-server-reads.md");
    // [B20 B4] pin move (OD-82, OD-87): the page's subset sentence moves with the withholding of the five proposals
    expect(page).toMatch(/The MCP subset is 9 tools: the 9 served reads; 7 tools are withheld: 2 reads and, since B4, the 5 proposals\./);
    const suites = [
      "app/lib/engineering/__tests__/b20-b3-durable-read-bundle.test.ts",
      "app/lib/mcp/server/__tests__/b20-b3-read-arguments.test.ts",
      "app/lib/mcp/server/__tests__/b20-b3-read-call.test.ts",
      "app/lib/mcp/server/__tests__/b20-b3-replay-cache.test.ts",
      "app/lib/mcp/server/__tests__/b20-b3-read-trace.test.ts",
      "app/lib/engineering/__tests__/b20-b3-mcp-subset-move.test.ts",
      "app/lib/mcp/server/__tests__/b20-b3-import-gates.test.ts",
      "app/api/mcp/__tests__/b20-b3-mcp-tools-call-reads.test.ts",
    ];
    for (const suite of suites) {
      const cases = (read(suite).match(/^\s*it\(/gm) ?? []).length;
      expect(cases, suite).toBeGreaterThan(0);
      expect(page, suite).toContain(`| \`${suite}\` | ${cases} |`);
    }
    const references = [...page.matchAll(/`((?:app|scripts)\/[A-Za-z0-9_./-]+\.ts):(\d+)` \(`([^`]+)`\)/g)];
    expect(references.length).toBeGreaterThanOrEqual(12);
    const wrong = references.filter(([, file, line, quoted]) => !(read(file!).split(NEWLINE)[Number(line) - 1] ?? "").includes(quoted!)).map(([reference]) => reference);
    expect(wrong).toEqual([]);
  });
});
