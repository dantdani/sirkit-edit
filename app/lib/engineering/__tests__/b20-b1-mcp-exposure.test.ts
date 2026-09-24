/**
 * [B20 B1] The MCP exposure subset of Sirkit's own registry: exposure needs BOTH the structural rule and the reviewed
 * decision (INTENTIONAL_MCP_EXPOSED_TOOL_IDS, MCP_WITHHELD_TOOL_IDS), the report compares them in both directions, every
 * other registry descriptor carries exactly one closed reason, the MCP set is a subset of the agent set, a forged
 * descriptor is refused by the rule itself (not by a list), a reviewed removal is a list move, and the deny-by-default
 * discovery channel "mcp" includes exactly the subset while every existing channel is unchanged.
 * B1 serves nothing: no endpoint, principal or route exists here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS } from "../agent-exposure";
import {
  INTENTIONAL_MCP_EXPOSED_TOOL_IDS,
  MCP_EXCLUSION_REASONS,
  MCP_EXCLUSION_REASON_DECISIONS,
  MCP_WITHHELD_TOOL_IDS,
  mcpExclusionReason,
  mcpExposureReport,
  type McpExclusionReason,
} from "../mcp-exposure";
import { permissionTierOfDescriptor } from "../permission-tiers";
import { sirkitToolRegistry, SIRKIT_TOOL_CATALOG } from "../tool-catalog";
import { DISCOVERY_CHANNELS, EXCLUSION_REASONS, discoverTools, type DiscoveryContext } from "../tool-discovery";
import { TOOL_AUTHORITY_SOURCES, TOOL_PROJECT_STATES, TOOL_SELECTION_KINDS, ToolRegistry, type ToolDescriptor } from "../tool-registry";
import { engineeringDigest } from "../stable";
import { McpToolRenderError, mcpOutputSchemaDecision, renderMcpToolListing } from "../../mcp/server/tool-definitions";

const registry = sirkitToolRegistry();
const descriptor = (toolId: string): ToolDescriptor => {
  const found = registry.get(toolId);
  if (!found) throw new Error(`fixture: ${toolId} is not registered`);
  return found;
};
const forged = (base: ToolDescriptor, patch: Record<string, unknown>): ToolDescriptor => ({ ...base, ...patch }) as ToolDescriptor;

const MCP_READS = [
  "sirkit.component-authority.inspect",
  "sirkit.manufacturing.readiness-inspect",
  "sirkit.pcb.board-inspect",
  "sirkit.pcb.mechanical-inspect",
  "sirkit.pcb.revision-inspect",
  "sirkit.pcb.via-inspect",
  "sirkit.project.canonical-revision-inspect",
  // [B20 B3] pin move (OD-69): sirkit.project.history-inspect and sirkit.schematic.inspect moved to MCP_WITHHELD_TOOL_IDS —
  // each needs browser-only state (the captured timeline; the editor's SchematicState), so no durable source can serve it
  "sirkit.validation.connectivity-verify",
  "sirkit.validation.drc-run",
];
// [B20 B4] pin move (OD-82, OD-87): the five proposals joined the withheld list (2 -> 7): B20 serves no proposal over MCP
const MCP_PROPOSALS = [
  "sirkit.pcb.propose-bounded-edit",
  "sirkit.placement.propose",
  "sirkit.routing.propose",
  "sirkit.schematic.propose-component-replacement",
  "sirkit.schematic.propose-tier1-edit",
];
const MCP_WITHHELD = ["sirkit.project.history-inspect", "sirkit.schematic.inspect", ...MCP_PROPOSALS].sort();

/** One row per closed reason with the registry ids that carry it (the production registry at B1). */
const EXCLUDED_BY_REASON: Record<McpExclusionReason, readonly string[]> = {
  tier3: ["sirkit.manufacturing.release"],
  never_exposed: ["sirkit.pcb.create-via", "sirkit.pcb.delete-item", "sirkit.pcb.edit-track", "sirkit.pcb.undo-redo-canonical", "sirkit.pcb.zone-edit"],
  not_agent_exposed: ["sirkit.parts.search", "sirkit.pcb.repair-plan", "sirkit.schematic.add-component"],
  granted_execution: ["sirkit.pcb.arrange", "sirkit.pcb.dimension", "sirkit.pcb.move-footprint", "sirkit.pcb.rotate-side-footprint", "sirkit.pcb.silkscreen-text", "sirkit.pcb.undo-redo-granted"],
  view_session: ["sirkit.selection.control", "sirkit.view.canvas-navigation", "sirkit.view.layers", "sirkit.view.measure", "sirkit.view.pcb3d", "sirkit.view.reveal-finding"],
  not_read_or_propose: [],
  side_effects: [],
  // [B20 A4] pin move: + the external tool read of approved MCP servers (an external read: never MCP-exposed, OD-74)
  external_read: ["sirkit.mcp.observation-read", "sirkit.parts.evidence-read", "sirkit.parts.external-search"],
  view_state_read: ["sirkit.selection.inspect", "sirkit.view.read-state"],
  not_servable: [],
  withheld: MCP_WITHHELD, // [B20 B3] pin move (OD-69): the two reads that need browser-only state; [B20 B4] and the five proposals
  not_mcp_reviewed: [],
};

const ALL_CAPABILITIES = ["read_project", "edit_placement", "edit_copper", "edit_zones", "edit_stackup_outline", "edit_constraints", "edit_components", "manage_protection", "run_automation", "approve_proposal", "restore_project", "migrate_project", "export_project"] as const;

/** The most permissive context discovery accepts: every capability, state, authority, approval and a grant context. */
function contextFor(channel: DiscoveryContext["channel"], overrides: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return {
    tenantId: "local", projectId: "p", branchId: "main", actorId: "u1", actorRole: "project_admin",
    grantedCapabilities: [...ALL_CAPABILITIES], channel,
    currentRevisionDigest: "eng1-0000000000000000", lineageId: "lineage-1",
    currentEditor: "", selectedKinds: [...TOOL_SELECTION_KINDS],
    projectState: [...TOOL_PROJECT_STATES], availableAuthority: [...TOOL_AUTHORITY_SOURCES],
    providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 128, maxToolCount: 64 },
    riskCeiling: "release", approvalsAvailable: ["reversible", "topology-or-geometry", "destructive", "release"],
    enabledFlags: [], requestedCategories: [],
    grantableCapabilities: ["edit_placement"], grantLineageId: "grant-lineage-1",
    ...overrides,
  };
}
const CONTEXTS: Record<string, Partial<DiscoveryContext>> = {
  permissive: {},
  viewer: { actorRole: "viewer", grantedCapabilities: ["read_project"], riskCeiling: "propose", approvalsAvailable: [], grantableCapabilities: undefined, grantLineageId: undefined },
  schematicEditor: { actorRole: "pcb_editor", currentEditor: "schematic", riskCeiling: "mutate", approvalsAvailable: ["reversible"] },
};
const identityOf = (result: ReturnType<typeof discoverTools>): string => engineeringDigest({
  included: result.included.map((item) => [item.toolId, item.version]),
  excluded: result.excluded.map((item) => [item.toolId, item.version, item.reason]),
});
/** A registry equal to production except for one descriptor's patch (the constructor validates it as it would a real edit). */
const patched = (toolId: string, patch: Record<string, unknown>): ToolRegistry =>
  new ToolRegistry(SIRKIT_TOOL_CATALOG.map((item) => (item.toolId === toolId ? ({ ...item, ...patch } as ToolDescriptor) : item)));

// [B20 B1 review] A reviewed REMOVAL is a list move: the same modules, loaded fresh with the reviewed-decision module
// replaced by a further move of the same kind. Loaded while the file is collected, because a cold import inside a timed test
// body can outrun its timeout under load. [B20 B3] pin move: B3 made the move this fixture simulated (history-inspect and
// schematic.inspect are withheld for real), so the simulated move is now a STILL-EXPOSED read, via-inspect.
const MOVED = "sirkit.pcb.via-inspect";
vi.resetModules();
vi.doMock("../mcp-exposure-review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mcp-exposure-review")>();
  return {
    ...actual,
    INTENTIONAL_MCP_EXPOSED_TOOL_IDS: Object.freeze(actual.INTENTIONAL_MCP_EXPOSED_TOOL_IDS.filter((id) => id !== MOVED)),
    MCP_WITHHELD_TOOL_IDS: Object.freeze([...actual.MCP_WITHHELD_TOOL_IDS, MOVED].sort()), // a simulated reviewed withholding
  };
});
const moved = {
  exposure: await import("../mcp-exposure"),
  discovery: await import("../tool-discovery"),
  catalog: await import("../tool-catalog"),
  agent: await import("../agent-exposure"),
  definitions: await import("../../mcp/server/tool-definitions"),
};
vi.doUnmock("../mcp-exposure-review");
vi.resetModules();

describe("[B20 B1] the MCP exposure subset — reviewed list, structural rule, closed reasons", () => {
  it("the structural subset equals the reviewed list in both directions: exactly 9 ids, sorted and unique, the report clean", () => {
    const report = mcpExposureReport(registry);
    expect(report).toMatchObject({ ok: true, missing: [], unexpected: [], outsideAgentSet: [], duplicates: [] });
    expect(report.actual).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS]);
    // [B20 B3] pin move (OD-69): the rule still admits the two withheld reads; the reviewed decision withholds them. [B20 B4]
    // pin move (OD-82, OD-87): and the five withheld proposals
    expect(report.admitted).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS, ...MCP_WITHHELD].sort());
    expect(report.expected).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS]);
    expect(report.count).toBe(9); // [B20 B3] pin move: 16 -> 14 (two reads withheld); [B20 B4] pin move: 14 -> 9 (every proposal withheld)
    expect(INTENTIONAL_MCP_EXPOSED_TOOL_IDS).toHaveLength(9);
    expect([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS]).toEqual([...new Set(INTENTIONAL_MCP_EXPOSED_TOOL_IDS)].sort());
    expect(Object.isFrozen(INTENTIONAL_MCP_EXPOSED_TOOL_IDS)).toBe(true);
    // the withheld list: frozen, sorted, unique, disjoint from the exposed list, inside the agent set; [B20 B3] pin move: the
    // two reads B3 cannot serve from durable state (it was empty at B1); [B20 B4] pin move: and the five proposals
    expect([...MCP_WITHHELD_TOOL_IDS]).toEqual(MCP_WITHHELD);
    expect(Object.isFrozen(MCP_WITHHELD_TOOL_IDS)).toBe(true);
    expect([...MCP_WITHHELD_TOOL_IDS]).toEqual([...new Set(MCP_WITHHELD_TOOL_IDS)].sort());
    for (const id of MCP_WITHHELD_TOOL_IDS) {
      expect(INTENTIONAL_MCP_EXPOSED_TOOL_IDS, id).not.toContain(id);
      expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, id).toContain(id);
    }
  });

  // [B20 B4] pin move (OD-82, OD-87): the 5 inert proposals left the exposed list; each is still the Tier 2 inert proposal the
  // rule admits, now withheld by the reviewed decision
  it("the 9 are the 9 bound reads of project or design state (Tier 0): nothing else; the 5 inert proposals (Tier 2) are withheld", () => {
    expect([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS].sort()).toEqual([...MCP_READS].sort());
    for (const id of MCP_READS) {
      const item = descriptor(id);
      expect([item.operationClass, item.binding.status, permissionTierOfDescriptor(item), item.sideEffects === "none" || item.sideEffects === "derived-cache"], id).toEqual(["read", "bound-read", 0, true]);
    }
    for (const id of MCP_PROPOSALS) {
      const item = descriptor(id);
      expect([item.operationClass, item.binding.status, permissionTierOfDescriptor(item), item.sideEffects], id).toEqual(["propose", "bound-proposal", 2, "proposal-artifact"]);
      expect(mcpExclusionReason(item), id).toBe("withheld");
    }
    for (const id of INTENTIONAL_MCP_EXPOSED_TOOL_IDS) {
      const item = descriptor(id);
      expect([item.lifecycle, item.discovery, item.callability, item.approvalTier, item.agentExposed, item.executionMode, item.grantOnly], id).toEqual(["active", "discoverable", "callable", "none", true, undefined, undefined]);
    }
  });

  it("every other registry descriptor carries exactly one closed reason; one row per reason with the ids that carry it", () => {
    expect([...MCP_EXCLUSION_REASONS]).toEqual([
      "tier3", "never_exposed", "not_agent_exposed", "granted_execution", "view_session", "not_read_or_propose", "side_effects",
      "external_read", "view_state_read", "not_servable", "withheld", "not_mcp_reviewed",
    ]);
    expect(Object.keys(MCP_EXCLUSION_REASON_DECISIONS).sort()).toEqual([...MCP_EXCLUSION_REASONS].sort());
    for (const reason of MCP_EXCLUSION_REASONS) expect(MCP_EXCLUSION_REASON_DECISIONS[reason].length, reason).toBeGreaterThan(20);
    const report = mcpExposureReport(registry);
    const byReason = Object.fromEntries(MCP_EXCLUSION_REASONS.map((reason) => [reason, [...report.excludedByReason[reason]]]));
    expect(byReason).toEqual(EXCLUDED_BY_REASON);
    const excludedIds = report.excluded.map((entry) => entry.toolId);
    expect(new Set(excludedIds).size).toBe(excludedIds.length);
    expect(report.count + report.excluded.length).toBe(registry.list().length);
    for (const item of registry.list()) {
      const reason = mcpExclusionReason(item);
      if (INTENTIONAL_MCP_EXPOSED_TOOL_IDS.includes(item.toolId)) expect(reason, item.toolId).toBeNull();
      else expect(report.excluded.find((entry) => entry.toolId === item.toolId), item.toolId).toEqual({ toolId: item.toolId, version: item.version, reason });
    }
  });

  it("the MCP set is a subset of the agent set; the 24 agent tools it leaves out are the granted executions, the external reads, the open-editor tools and the seven withheld tools", () => {
    for (const id of INTENTIONAL_MCP_EXPOSED_TOOL_IDS) expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, id).toContain(id);
    const left = INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.filter((id) => !INTENTIONAL_MCP_EXPOSED_TOOL_IDS.includes(id));
    // [B20 B3] pin move: 16 -> 18 (the two withheld reads); [B20 B4] 18 -> 23 (the five withheld proposals); [B20 A4] 23 -> 24
    // (the external tool read, an external read) - the merge of the two tracks, so both moves apply
    expect(left).toHaveLength(24);
    const reasons = new Set(left.map((id) => mcpExclusionReason(descriptor(id))));
    expect([...reasons].sort()).toEqual(["external_read", "granted_execution", "view_session", "view_state_read", "withheld"]);
    // D20-2 / D20-33: every granted execution and every grant-only tool is excluded, whatever else it is
    for (const item of registry.list().filter((entry) => entry.executionMode !== undefined || entry.grantOnly !== undefined)) {
      expect(mcpExclusionReason(item), item.toolId).toBe("granted_execution");
    }
  });

  it("the rule itself refuses a forged agent-exposed descriptor: granted, grant-only, view-session, external, mutate, destructive, release, a Tier 3 family, a never-exposed pattern, state-writing side effects, an open-editor read, an unserved binding, an unreviewed id", () => {
    const read = descriptor("sirkit.pcb.board-inspect");
    const proposal = descriptor("sirkit.placement.propose");
    expect(mcpExclusionReason(read)).toBeNull();
    // [B20 B4] pin move (OD-87): placement is withheld, so the reviewed decision (not the rule) excludes the unforged proposal;
    // every forged proposal below still names its structural reason first
    expect(mcpExclusionReason(proposal)).toBe("withheld");
    const cases: ReadonlyArray<readonly [string, ToolDescriptor, McpExclusionReason]> = [
      ["the reviewed granted move", descriptor("sirkit.pcb.move-footprint"), "granted_execution"],
      ["a read claiming executionMode granted", forged(read, { executionMode: "granted" }), "granted_execution"],
      ["a proposal claiming grantOnly", forged(proposal, { grantOnly: true }), "granted_execution"],
      ["a read reclassified view-session", forged(read, { operationClass: "view-session" }), "view_session"],
      ["a read bound as an external read", forged(read, { binding: { status: "bound-external-read", module: "m.ts", symbol: "s" } }), "external_read"],
      ["a read requiring the external-observation authority", forged(read, { requiredAuthority: ["external-observation"] }), "external_read"],
      // [B20 A4] defence in depth: the external tool read's own authority is read as an external read too
      ["a read requiring the external-mcp-observation authority", forged(read, { requiredAuthority: ["external-mcp-observation"] }), "external_read"],
      ["a read reclassified mutate", forged(read, { operationClass: "mutate" }), "not_read_or_propose"],
      ["a read reclassified destructive", forged(read, { operationClass: "destructive" }), "not_read_or_propose"],
      ["a read reclassified release", forged(read, { operationClass: "release" }), "tier3"],
      ["a read carrying a release approval tier", forged(read, { approvalTier: "release" }), "tier3"],
      ["a Tier 3 family: upload", forged(read, { toolId: "sirkit.pcb.upload-inspect" }), "tier3"],
      ["a Tier 3 family: order", forged(read, { toolId: "sirkit.parts.order-inspect" }), "tier3"],
      ["a Tier 3 family: publication", forged(proposal, { toolId: "sirkit.parts.publication-propose" }), "tier3"],
      ["a Tier 3 family: qualification", forged(read, { toolId: "sirkit.pcb.qualify-inspect" }), "tier3"],
      ["a Tier 3 family: ship", forged(read, { toolId: "sirkit.manufacturing.ship-inspect" }), "tier3"],
      ["a never-exposed id: edit-track", forged(read, { toolId: "sirkit.pcb.edit-track" }), "never_exposed"],
      ["a never-exposed id: the canonical replay", forged(read, { toolId: "sirkit.pcb.undo-redo-canonical" }), "never_exposed"],
      ["a never-exposed id: catalog approval", forged(read, { toolId: "sirkit.parts.atomic.approve-revision" }), "never_exposed"],
      ["a read of the view category", forged(read, { category: "view" }), "view_state_read"],
      ["a read of the selection category", forged(read, { category: "selection" }), "view_state_read"],
      ["a read requiring an open editor surface", forged(read, { requiredProjectState: ["board-present", "pcb-surface"] }), "view_state_read"],
      ["a proposal requiring an open 3D surface", forged(proposal, { requiredProjectState: ["pcb3d-surface"] }), "view_state_read"],
      ["a test double", forged(read, { binding: { status: "test-double" } }), "not_servable"],
      ["an unbound read", forged(read, { binding: { status: "unbound" } }), "not_servable"],
      ["a view-session binding on a read", forged(read, { binding: { status: "bound-view-session", module: "m.ts", symbol: "s" } }), "not_servable"],
      ["a deprecated read", forged(read, { lifecycle: "deprecated", deprecation: { reason: "old" } }), "not_servable"],
      ["an internal-only read", forged(read, { discovery: "internal-only" }), "not_servable"],
      ["a non-callable read", forged(read, { callability: "not-callable" }), "not_servable"],
      ["a read with an approval tier of its own", forged(read, { approvalTier: "reversible" }), "not_servable"],
      ["a read outside the agent set", forged(read, { agentExposed: false }), "not_agent_exposed"],
      // [B20 B1 review] side effects: a read may declare none or a derived cache, a proposal a proposal artifact only — the
      // rule the executors behind MCP apply (tool-invocation.ts, gateway.ts, layout-proposals.ts)
      ["a read that writes engineering state", forged(read, { sideEffects: "engineering-state" }), "side_effects"],
      ["a read that writes a release artifact", forged(read, { sideEffects: "release-artifact" }), "side_effects"],
      ["a read that writes session state", forged(read, { sideEffects: "session-state" }), "side_effects"],
      ["a read that writes a proposal artifact", forged(read, { sideEffects: "proposal-artifact" }), "side_effects"],
      ["a read with no side-effect classification", forged(read, { sideEffects: undefined }), "side_effects"],
      ["a proposal that writes engineering state", forged(proposal, { sideEffects: "engineering-state" }), "side_effects"],
      ["a proposal that writes a release artifact", forged(proposal, { sideEffects: "release-artifact" }), "side_effects"],
      ["a proposal declaring no proposal artifact", forged(proposal, { sideEffects: "none" }), "side_effects"],
      ["a proposal declaring a derived cache", forged(proposal, { sideEffects: "derived-cache" }), "side_effects"],
      // [B20 B1 review] the reviewed decision: an admissible id that is not listed is never exposed
      ["an admissible agent-exposed read under an unreviewed id", forged(read, { toolId: "sirkit.pcb.extra-inspect" }), "not_mcp_reviewed"],
      ["an admissible agent-exposed proposal under an unreviewed id", forged(proposal, { toolId: "sirkit.placement.propose-extra" }), "not_mcp_reviewed"],
    ];
    const wrong = cases.filter(([, item, reason]) => mcpExclusionReason(item) !== reason).map(([label, item]) => `${label}: ${String(mcpExclusionReason(item))}`);
    expect(wrong).toEqual([]);
  });

  it("a descriptor cannot become MCP-exposed by joining the agent set: a new agent-exposed read is refused (not_mcp_reviewed), reported unexpected and outside the agent set; a withdrawn one is reported missing", () => {
    const board = descriptor("sirkit.pcb.board-inspect");
    const extra = { ...board, toolId: "sirkit.pcb.extra-inspect", version: "1.0.0" } as ToolDescriptor;
    const widened = new ToolRegistry([...SIRKIT_TOOL_CATALOG, extra]);
    expect(mcpExclusionReason(extra)).toBe("not_mcp_reviewed");
    const report = mcpExposureReport(widened);
    expect(report.ok).toBe(false);
    expect(report.admitted).toContain("sirkit.pcb.extra-inspect");
    expect(report.actual).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS]);
    expect(report.unexpected).toEqual(["sirkit.pcb.extra-inspect"]);
    expect(report.outsideAgentSet).toEqual(["sirkit.pcb.extra-inspect"]);
    expect(report.excludedByReason.not_mcp_reviewed).toEqual(["sirkit.pcb.extra-inspect"]);
    // and the channel never offers it, whatever the context claims
    expect(discoverTools(widened, contextFor("mcp")).included.map((item) => item.toolId).sort()).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS]);
    // [B20 B3] pin move: the narrowed example is a still-exposed read (history-inspect is withheld since B3, so not "missing")
    const narrowed = new ToolRegistry(SIRKIT_TOOL_CATALOG.map((item) => (item.toolId === "sirkit.pcb.via-inspect" ? { ...item, agentExposed: false } : item)));
    const narrowedReport = mcpExposureReport(narrowed);
    expect(narrowedReport).toMatchObject({ ok: false, missing: ["sirkit.pcb.via-inspect"], unexpected: [] });
    // two exposed versions of one id would be two tools under one MCP name: the report refuses it
    const twice = new ToolRegistry([...SIRKIT_TOOL_CATALOG, { ...board, version: "9.0.0" } as ToolDescriptor]);
    expect(mcpExposureReport(twice)).toMatchObject({ ok: false, duplicates: ["sirkit.pcb.board-inspect"] });
  });

  it("an agent-set tool made structurally admissible without review is never exposed and is drift: only `unexpected` names it, the report is not ok, the listing refuses and the channel excludes it", () => {
    // sirkit.view.read-state is in the agent set and excluded as view_state_read; re-categorised to "project" the structural
    // rule admits it (bound read, board-present, no authority), so only the reviewed decision stands between it and MCP
    const recategorised = patched("sirkit.view.read-state", { category: "project" });
    const item = recategorised.get("sirkit.view.read-state")!;
    // the runtime gate first: the channel never offers it
    const channel = discoverTools(recategorised, contextFor("mcp"));
    expect(channel.included.map((entry) => entry.toolId).sort()).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS]);
    expect(channel.excluded.find((entry) => entry.toolId === "sirkit.view.read-state")?.reason).toBe("not_mcp_exposed");
    expect(mcpExclusionReason(descriptor("sirkit.view.read-state"))).toBe("view_state_read");
    expect(mcpExclusionReason(item)).toBe("not_mcp_reviewed");
    const report = mcpExposureReport(recategorised);
    expect(report).toMatchObject({ ok: false, missing: [], unexpected: ["sirkit.view.read-state"], outsideAgentSet: [], duplicates: [] });
    expect(report.actual).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS]);
    expect(report.admitted).toContain("sirkit.view.read-state");
    expect(report.excludedByReason.not_mcp_reviewed).toEqual(["sirkit.view.read-state"]);
    let refusal: unknown = null;
    try { renderMcpToolListing(recategorised); } catch (error) { refusal = error; }
    expect(refusal).toBeInstanceOf(McpToolRenderError);
    expect((refusal as McpToolRenderError).code).toBe("exposure_drift");
  });

  it("a read or proposal whose declared side effects write state is refused by the rule, so the report, the listing and the channel refuse it too (the registry constructor accepts it)", () => {
    const writes = patched("sirkit.validation.drc-run", { sideEffects: "engineering-state" });
    const item = writes.get("sirkit.validation.drc-run")!;
    expect(item.sideEffects).toBe("engineering-state");
    expect(mcpExclusionReason(item)).toBe("side_effects");
    const report = mcpExposureReport(writes);
    expect(report).toMatchObject({ ok: false, missing: ["sirkit.validation.drc-run"], unexpected: [] });
    expect(report.excludedByReason.side_effects).toEqual(["sirkit.validation.drc-run"]);
    let refusal: unknown = null;
    try { renderMcpToolListing(writes); } catch (error) { refusal = error; }
    expect((refusal as McpToolRenderError | null)?.code).toBe("exposure_drift");
    const channel = discoverTools(writes, contextFor("mcp"));
    expect(channel.included.map((entry) => entry.toolId)).not.toContain("sirkit.validation.drc-run");
    expect(channel.excluded.find((entry) => entry.toolId === "sirkit.validation.drc-run")?.reason).toBe("not_mcp_exposed");
    const proposes = patched("sirkit.placement.propose", { sideEffects: "engineering-state" });
    expect(mcpExclusionReason(proposes.get("sirkit.placement.propose")!)).toBe("side_effects");
    // [B20 B4] pin move (OD-87): placement is withheld, so it cannot go missing from the report; the rule still names the
    // structural reason first (side_effects precedes the reviewed withholding), and the listing never carries it
    expect(mcpExposureReport(proposes)).toMatchObject({ ok: true, missing: [] });
    expect(mcpExposureReport(proposes).excludedByReason.side_effects).toEqual(["sirkit.placement.propose"]);
    expect(renderMcpToolListing(proposes).tools.map((tool) => tool.name)).not.toContain("sirkit.placement.propose");
  });

  it("a reviewed REMOVAL is a list move: via-inspect moved to the withheld list, with no descriptor change, gives a clean report, an 8-tool listing, the channel excluding it, and an unchanged agent path", () => {
    // [B20 B3] pin move: the simulated move is now via-inspect on top of B3's real withholding (14 -> 13, withheld 2 -> 3);
    // [B20 B4] pin move: and on top of B4's (9 -> 8, withheld 7 -> 8)
    const movedRegistry = moved.catalog.sirkitToolRegistry();
    expect(movedRegistry.digest()).toBe(registry.digest()); // the registry, and every descriptor in it, is untouched
    expect(moved.exposure.INTENTIONAL_MCP_EXPOSED_TOOL_IDS).toHaveLength(8);
    expect([...moved.exposure.MCP_WITHHELD_TOOL_IDS]).toEqual([...MCP_WITHHELD, MOVED].sort());
    expect(moved.exposure.mcpExclusionReason(movedRegistry.get(MOVED)!)).toBe("withheld");
    const report = moved.exposure.mcpExposureReport(movedRegistry);
    expect(report).toMatchObject({ ok: true, missing: [], unexpected: [], outsideAgentSet: [], duplicates: [], count: 8 });
    expect(report.excludedByReason.withheld).toEqual([...MCP_WITHHELD, MOVED].sort());
    expect(report.admitted).toContain(MOVED);
    const listing = moved.definitions.renderMcpToolListing(movedRegistry);
    expect(listing.tools.map((tool) => tool.name)).toEqual(INTENTIONAL_MCP_EXPOSED_TOOL_IDS.filter((id) => id !== MOVED));
    expect(listing.excluded.find((entry) => entry.toolId === MOVED)).toEqual({ toolId: MOVED, version: descriptor(MOVED).version, reason: "withheld" });
    const channel = moved.discovery.discoverTools(movedRegistry, contextFor("mcp"));
    expect(channel.included.map((entry) => entry.toolId).sort()).toEqual(INTENTIONAL_MCP_EXPOSED_TOOL_IDS.filter((id) => id !== MOVED));
    expect(channel.excluded.find((entry) => entry.toolId === MOVED)?.reason).toBe("not_mcp_exposed");
    // the agent path is not touched by an MCP removal
    expect(moved.agent.agentExposureReport(movedRegistry).ok).toBe(true);
    expect(identityOf(moved.discovery.discoverTools(movedRegistry, contextFor("assistant-agent")))).toBe(identityOf(discoverTools(registry, contextFor("assistant-agent"))));
  });

  it("annotation-like fields on a descriptor change neither its MCP exposure nor its permission tier (Sirkit's classification is the only input)", () => {
    const hostile = [
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    ];
    const drift: string[] = [];
    for (const item of registry.list()) {
      for (const hints of hostile) {
        const withHints = forged(item, { ...hints, annotations: { ...hints }, _meta: { "dev.sirkit/permissionTier": 0 }, permissionTier: 0 });
        if (mcpExclusionReason(withHints) !== mcpExclusionReason(item)) drift.push(`${item.toolId}: exposure`);
        if (permissionTierOfDescriptor(withHints) !== permissionTierOfDescriptor(item)) drift.push(`${item.toolId}: tier`);
      }
    }
    expect(drift).toEqual([]);
    // a forged read-only claim on the granted move or the release keeps them excluded, at their own tier
    expect(mcpExclusionReason(forged(descriptor("sirkit.pcb.move-footprint"), { readOnlyHint: true, annotations: { readOnlyHint: true } }))).toBe("granted_execution");
    expect(permissionTierOfDescriptor(forged(descriptor("sirkit.manufacturing.release"), { readOnlyHint: true }))).toBe(3);
  });

  it("the b17-f lexical tripwire and the never-exposed patterns hold for every MCP-exposed id; none is Tier 3, mutate, destructive, release or view-session", () => {
    for (const id of INTENTIONAL_MCP_EXPOSED_TOOL_IDS) {
      const item = descriptor(id);
      expect(id).not.toMatch(/process|exec|shell|database|db\.|file\.|replace-state|import-state/i);
      for (const pattern of NEVER_EXPOSED_TOOL_PATTERNS) expect(pattern.test(id), `${id} vs ${pattern}`).toBe(false);
      expect(permissionTierOfDescriptor(item), id).not.toBe(3);
      expect(["mutate", "destructive", "release", "view-session"], id).not.toContain(item.operationClass);
    }
    // the readiness report is a Tier 0 read that authorizes nothing (the B16.1C tripwire keeps it exposed to the agent)
    const readiness = descriptor("sirkit.manufacturing.readiness-inspect");
    expect([readiness.operationClass, permissionTierOfDescriptor(readiness), readiness.sideEffects]).toEqual(["read", 0, "none"]);
    expect(readiness.description).toMatch(/never authorizes a release/);
  });

  it("mcpExclusionReason never throws: malformed, hostile and getter-throwing inputs answer not_servable or another closed reason", () => {
    const throwing = new Proxy({}, { get() { throw new Error("hostile getter"); } });
    const inputs: unknown[] = [null, undefined, 5, "sirkit.pcb.board-inspect", [], {}, { agentExposed: true }, { ...descriptor("sirkit.pcb.board-inspect"), binding: null }, { ...descriptor("sirkit.pcb.board-inspect"), requiredAuthority: "local-working-copy" }, { ...descriptor("sirkit.pcb.board-inspect"), toolId: 7 }, throwing];
    for (const input of inputs) {
      let reason: unknown;
      expect(() => { reason = mcpExclusionReason(input as ToolDescriptor); }).not.toThrow();
      expect(MCP_EXCLUSION_REASONS as readonly unknown[]).toContain(reason);
    }
    expect(mcpExclusionReason(null as unknown as ToolDescriptor)).toBe("not_servable");
    expect(mcpExclusionReason(throwing as ToolDescriptor)).toBe("not_servable");
    expect(mcpExclusionReason({ ...descriptor("sirkit.pcb.board-inspect"), binding: null } as unknown as ToolDescriptor)).toBe("not_servable");
    expect(mcpExclusionReason({ ...descriptor("sirkit.pcb.board-inspect"), toolId: 7 } as unknown as ToolDescriptor)).toBe("not_servable");
  });

  it("mcpExposureReport never throws: a registry whose list() throws, or yields a hostile descriptor, reports every reviewed id missing (ok false)", () => {
    const throwingList = { list(): readonly ToolDescriptor[] { throw new Error("hostile registry"); } };
    const hostile = new Proxy({}, { get() { throw new Error("hostile getter"); } }) as ToolDescriptor;
    // an excluded descriptor's version is read for its exclusion entry
    const throwingVersion = new Proxy({ ...descriptor("sirkit.pcb.move-footprint") }, { get(target, key) { if (key === "version") throw new Error("hostile version"); return Reflect.get(target, key); } });
    const sources: ReadonlyArray<readonly [string, Pick<ToolRegistry, "list">]> = [
      ["a throwing list()", throwingList],
      ["a list of one hostile descriptor", { list: () => [hostile] }],
      ["an exposed read and a descriptor whose version getter throws", { list: () => [descriptor("sirkit.pcb.board-inspect"), throwingVersion] }],
    ];
    for (const [label, source] of sources) {
      const run = (): ReturnType<typeof mcpExposureReport> => mcpExposureReport(source);
      expect(run, label).not.toThrow();
      const report = run();
      expect(report.ok, label).toBe(false);
      expect(report.count, label).toBe(0);
      expect([...report.missing], label).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS]);
    }
  });

  it("the report is built fresh per call and frozen at every level", () => {
    const first = mcpExposureReport(registry);
    const second = mcpExposureReport(registry);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(first.actual).not.toBe(INTENTIONAL_MCP_EXPOSED_TOOL_IDS);
    for (const value of [first, first.actual, first.admitted, first.expected, first.missing, first.unexpected, first.outsideAgentSet, first.duplicates, first.excluded, first.excludedByReason, ...first.excluded, ...Object.values(first.excludedByReason)]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Object.isFrozen(MCP_EXCLUSION_REASONS)).toBe(true);
    expect(Object.isFrozen(MCP_EXCLUSION_REASON_DECISIONS)).toBe(true);
  });
});

describe("[B20 B1] the deny-by-default discovery channel mcp", () => {
  it("the channel list gains mcp and the exclusion reasons gain not_mcp_exposed, both appended: every existing value keeps its place", () => {
    expect([...DISCOVERY_CHANNELS]).toEqual(["interactive-ui", "assistant-agent", "automation", "api", "mcp"]);
    expect(EXCLUSION_REASONS.at(-1)).toBe("not_mcp_exposed");
    expect(EXCLUSION_REASONS.slice(0, 21)).toEqual([
      "lifecycle", "internal_only", "not_agent_exposed", "grant_only", "role_not_permitted", "capability_missing", "revision_required",
      "lineage_required", "editor_mismatch", "selection_kind_missing", "project_state_missing", "authority_missing", "not_callable",
      "approval_unavailable", "risk_ceiling", "provider_schema_unsupported", "provider_name_length", "provider_tool_count",
      "feature_flag_disabled", "category_not_requested", "budget_exceeded",
    ]);
    expect(EXCLUSION_REASONS).toHaveLength(22);
  });

  it("under the most permissive context (release ceiling, every approval, a grant context, the external-observation authority claimed) the channel includes exactly the 9", () => {
    const result = discoverTools(registry, contextFor("mcp"));
    expect(result.included.map((item) => item.toolId).sort()).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS]);
    const included = new Set(result.included.map((item) => item.toolId));
    for (const id of [...EXCLUDED_BY_REASON.granted_execution, ...EXCLUDED_BY_REASON.external_read, ...EXCLUDED_BY_REASON.view_session, ...EXCLUDED_BY_REASON.view_state_read, "sirkit.pcb.undo-redo-granted", "sirkit.manufacturing.release"]) {
      expect(included.has(id), id).toBe(false);
    }
  });

  it("every other descriptor is excluded on mcp: not_agent_exposed outside the agent set, not_mcp_exposed inside it; internal-only tools are not even reported", () => {
    const result = discoverTools(registry, contextFor("mcp"));
    const reasonOf = new Map(result.excluded.map((entry) => [entry.toolId, entry.reason]));
    for (const item of registry.list()) {
      if (INTENTIONAL_MCP_EXPOSED_TOOL_IDS.includes(item.toolId)) continue;
      if (item.discovery === "internal-only") { expect(reasonOf.has(item.toolId), item.toolId).toBe(false); continue; }
      const expected = item.lifecycle !== "active" ? "lifecycle" : item.agentExposed ? "not_mcp_exposed" : "not_agent_exposed";
      expect(reasonOf.get(item.toolId), item.toolId).toBe(expected);
    }
    // grant-only and external reads never appear on mcp, even with a grant context and the external authority claimed
    expect(result.excluded.find((entry) => entry.toolId === "sirkit.pcb.undo-redo-granted")?.reason).toBe("not_mcp_exposed");
    expect(result.excluded.find((entry) => entry.toolId === "sirkit.parts.external-search")?.reason).toBe("not_mcp_exposed");
  });

  it("the channel still applies every contextual rule: a viewer gets no proposal, no board means no board read, a short name budget excludes long names", () => {
    const viewer = discoverTools(registry, contextFor("mcp", CONTEXTS.viewer)).included.map((item) => item.toolId);
    for (const id of viewer) expect(INTENTIONAL_MCP_EXPOSED_TOOL_IDS, id).toContain(id);
    expect(viewer.filter((id) => MCP_PROPOSALS.includes(id))).toEqual([]);
    expect(viewer).toContain("sirkit.pcb.board-inspect");
    const noBoard = discoverTools(registry, contextFor("mcp", { projectState: ["schematic-present"] })).included.map((item) => item.toolId);
    expect(noBoard).not.toContain("sirkit.pcb.board-inspect");
    // [B20 B3] pin move: schematic.inspect is withheld, so the board-free read that stays is the canonical revision read
    expect(noBoard).toContain("sirkit.project.canonical-revision-inspect");
    expect(noBoard).not.toContain("sirkit.schematic.inspect");
    const short = discoverTools(registry, contextFor("mcp", { providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 24, maxToolCount: 64 } }));
    expect(short.included.every((item) => item.toolId.length <= 24)).toBe(true);
    // [B20 B4] pin move: the long name was a proposal, withheld since B4 (so excluded as not_mcp_exposed before the name
    // budget applies); the longest exposed read shows the budget instead
    expect(short.excluded.find((entry) => entry.toolId === "sirkit.project.canonical-revision-inspect")?.reason).toBe("provider_name_length");
  });

  // Pins computed at HEAD 0ae9b57 (before the mcp channel existed) over the included and excluded ids, versions and reasons.
  // A reviewed registry change moves them with the registry, as a pin move with its reason written here.
  // [B20 A4 review, coverage-02 / tests-6] NOT a pin move: B20-A4 ADDED one descriptor (sirkit.mcp.observation-read), so the
  // pre-B1 values are compared over the registry WITHOUT that one addition — the technique B3 uses (`baseRegistry` in
  // b20-b3-mcp-subset-move) — and the addition is then pinned as the ONLY difference on every channel. Regenerating the 12
  // digests instead would have recorded any other move of an old channel as the new truth.
  const A4_ADDITION = "sirkit.mcp.observation-read";
  const baseRegistry = new ToolRegistry(SIRKIT_TOOL_CATALOG.filter((item) => item.toolId !== A4_ADDITION));
  it("every existing channel is unchanged: interactive-ui, assistant-agent, automation and api byte-match the pre-B1 pins under three contexts, and A4's one descriptor is the only difference", () => {
    const PINS: Record<string, Record<string, string>> = {
      "interactive-ui": { permissive: "eng1-c15d068f466d4bf6", viewer: "eng1-68f97b000530aadb", schematicEditor: "eng1-3ede31afeec8fb9e" },
      "assistant-agent": { permissive: "eng1-217baeb7a064d922", viewer: "eng1-d154b4c4b1740593", schematicEditor: "eng1-ffe7d7bfe71abd5a" },
      automation: { permissive: "eng1-9da9e74cb28c312f", viewer: "eng1-b6488d3009f3d103", schematicEditor: "eng1-9596049a79cbbc65" },
      api: { permissive: "eng1-697b17f01c6ec323", viewer: "eng1-ad045717a321fd7e", schematicEditor: "eng1-d63980106046feab" },
    };
    expect(registry.list().map((item) => item.toolId).filter((id) => !baseRegistry.get(id))).toEqual([A4_ADDITION]);
    const actual: Record<string, Record<string, string>> = {};
    for (const channel of ["interactive-ui", "assistant-agent", "automation", "api"] as const) {
      actual[channel] = {};
      for (const [name, overrides] of Object.entries(CONTEXTS)) {
        const context = contextFor(channel, overrides);
        const base = discoverTools(baseRegistry, context);
        const result = discoverTools(registry, context);
        actual[channel]![name] = identityOf(base);
        expect(result.excluded.some((entry) => entry.reason === "not_mcp_exposed"), `${channel}/${name}`).toBe(false);
        // the whole registry differs from the base by that ONE descriptor and nothing else: it is offered on the
        // assistant-agent channel (the only channel on which its authority counts) and excluded `authority_missing` on
        // every other, and every other tool's inclusion, exclusion and reason is byte-identical to the base
        expect(result.included.filter((entry) => entry.toolId !== A4_ADDITION), `${channel}/${name} included`).toEqual(base.included);
        expect(result.excluded.filter((entry) => entry.toolId !== A4_ADDITION), `${channel}/${name} excluded`).toEqual(base.excluded);
        const added = result.included.filter((entry) => entry.toolId === A4_ADDITION).map(() => "included");
        const reasons = result.excluded.filter((entry) => entry.toolId === A4_ADDITION).map((entry) => entry.reason);
        expect([...added, ...reasons], `${channel}/${name} A4`).toEqual([channel === "assistant-agent" ? "included" : "authority_missing"]);
      }
    }
    expect(actual).toEqual(PINS);
  });
});

describe("[B20 B1] mcp-exposure.md states what the code and the suites say", () => {
  const PAGE = "artifacts/ai-control-plane-b20/mcp-exposure.md";
  const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8").replaceAll(`${String.fromCharCode(13)}${String.fromCharCode(10)}`, String.fromCharCode(10));

  it("the page lists the 9 exposed ids with their class and tier, every excluded id under its closed reason, and states the code's counts", () => {
    const page = read(PAGE);
    const report = mcpExposureReport(registry);
    const count = (pattern: RegExp): number[] => { const match = pattern.exec(page); expect(match, String(pattern)).not.toBeNull(); return match!.slice(1).map(Number); };
    expect(count(/^## 1\. The (\d+) exposed tools/m)).toEqual([report.count]);
    expect(count(/admits exactly these (\d+) from the production\s+registry of (\d+) descriptors/)).toEqual([report.count, registry.list().length]);
    // [B20 B4] pin move (OD-82, OD-87): the page says the proposals are withheld, and the sum names the seven withheld tools
    expect(count(/agent set's (\d+) bound reads of project or design state; its (\d+) inert proposals are withheld/)).toEqual([MCP_READS.length, MCP_PROPOSALS.length]);
    expect(count(/^## 2\. The (\d+) excluded descriptors/m)).toEqual([report.excluded.length]);
    // [B20 B3] pin move: the sum gains the withheld reads (OD-69)
    expect(count(/(\d+) ids = the (\d+) above \+ (\d+) granted executions \+ (\d+) external reads \+ (\d+) view-session controls \+ (\d+) open-editor reads \+ (\d+) withheld tools/)).toEqual([
      INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length, report.count, report.excludedByReason.granted_execution.length, report.excludedByReason.external_read.length,
      report.excludedByReason.view_session.length, report.excludedByReason.view_state_read.length, report.excludedByReason.withheld.length,
    ]);
    expect(count(/the longest exposed id is (\d+) characters/)).toEqual([Math.max(...INTENTIONAL_MCP_EXPOSED_TOOL_IDS.map((id) => id.length))]);
    expect(count(/At B1 all (\d+) exposed tools declare it/)).toEqual([INTENTIONAL_MCP_EXPOSED_TOOL_IDS.filter((id) => mcpOutputSchemaDecision(descriptor(id)).declared).length]);
    expect(INTENTIONAL_MCP_EXPOSED_TOOL_IDS.every((id) => mcpOutputSchemaDecision(descriptor(id)).declared)).toBe(true); // "all" is part of the claim
    const exposedRows = [...page.matchAll(/^\| `(sirkit\.[a-z0-9.-]+)` \| (read|propose) \| (\d) \| exposed \|/gm)].map((match) => [match[1], match[2], Number(match[3])]);
    expect(exposedRows).toEqual(INTENTIONAL_MCP_EXPOSED_TOOL_IDS.map((id) => [id, descriptor(id).operationClass, permissionTierOfDescriptor(descriptor(id))]));
    for (const reason of MCP_EXCLUSION_REASONS) {
      const row = new RegExp("^\\| `" + reason + "` \\| ([^|]*) \\|", "m").exec(page);
      expect(row, reason).not.toBeNull();
      const ids = [...row![1]!.matchAll(/`(sirkit\.[a-z0-9.-]+)`/g)].map((match) => match[1]);
      expect(ids, reason).toEqual([...EXCLUDED_BY_REASON[reason]]);
    }
  });

  it("every file:line reference on the page points at the line it quotes", () => {
    const page = read(PAGE);
    const references = [...page.matchAll(/`((?:app|scripts)\/[A-Za-z0-9_./-]+\.ts):(\d+)` \(`([^`]+)`\)/g)];
    expect(references.length).toBeGreaterThanOrEqual(8);
    const wrong = references.filter(([, file, line, quoted]) => !(read(file!).split(String.fromCharCode(10))[Number(line) - 1] ?? "").includes(quoted!)).map(([reference]) => reference);
    expect(wrong).toEqual([]);
  });

  it("the page states the case count of each B1 suite as it is", () => {
    const page = read(PAGE);
    for (const suite of ["app/lib/engineering/__tests__/b20-b1-mcp-exposure.test.ts", "app/lib/mcp/server/__tests__/b20-b1-tool-definitions.test.ts"]) {
      const cases = (read(suite).match(/^\s*it\(/gm) ?? []).length;
      const stated = new RegExp("`" + suite.replace(/\./g, "\\.") + "`[^0-9`]{1,5}(\\d+) cases").exec(page);
      expect(stated?.[1], suite).toBe(String(cases));
    }
  });
});
