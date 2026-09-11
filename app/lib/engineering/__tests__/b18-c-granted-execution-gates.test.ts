/**
 * [B18-C I1] The granted-execution vocabulary and every gate re-derived from
 * it — proven on a TEST registry whose list is injected (the production list
 * is still empty here, so nothing is exposed on the real registry):
 *
 *  - the descriptor validator keeps the B04 invariant for every mutation that
 *    is not a reviewed Tier 1 granted execution;
 *  - discovery advertises a granted execution ONLY on the assistant-agent
 *    channel with the SERVER-derived grantable capability, the grant lineage,
 *    the `mutate` ceiling and the reversible approval — the actor's own
 *    capabilities never widen; grant-only tools never reach other channels;
 *  - context assembly derives grantability from server facts only (minter
 *    bound + Tier 1 execute role + verified board + PCB basis) while the actor
 *    keeps read_project; the gateway's integrity check refuses every tampered
 *    combination;
 *  - the production registry's exposure report is clean and unchanged.
 */
import { describe, expect, it } from "vitest";
import { ToolRegistry, validateToolDescriptor, type ToolDescriptor } from "../tool-registry";
import { SIRKIT_TOOL_CATALOG, sirkitToolRegistry } from "../tool-catalog";
import { discoverTools, type DiscoveryContext } from "../tool-discovery";
import { GRANTED_EXECUTION_TOOLS, GRANTED_EXECUTION_TOOL_IDS, NEVER_GRANTED_COMMAND_IDS, grantedExecutionViolations, isGrantedExecutionDescriptor, type GrantedExecutionTool } from "../granted-execution-families";
import { AGENT_EXPOSABLE_OPERATION_CLASSES, INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, agentExposureReport, isAgentExposableDescriptor } from "../agent-exposure";
import { assembleAgentRunContext } from "../../agent/context";
import { verifyAgentContextIntegrity } from "../../agent/gateway";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";
import { PRESETS } from "../../pcb/drc/presets";

const MOVE = SIRKIT_TOOL_CATALOG.find((d) => d.toolId === "sirkit.pcb.move-footprint")!;
const EDIT_TRACK = SIRKIT_TOOL_CATALOG.find((d) => d.toolId === "sirkit.pcb.edit-track")!;
const DELETE = SIRKIT_TOOL_CATALOG.find((d) => d.toolId === "sirkit.pcb.delete-item")!;
const ROWS: readonly GrantedExecutionTool[] = [{ toolId: "sirkit.pcb.move-footprint", family: "pcb.move-footprint", reason: "test" }];
const GRANTED: ToolDescriptor = { ...MOVE, agentExposed: true, executionMode: "granted", requiredSelectionKinds: [] };
const COMMANDS = new Set(["pcb.move-footprint", "pcb.edit-track", "pcb.delete-item"]);

function agentContext(overrides: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return {
    tenantId: "local", projectId: "p18", branchId: "main", actorId: "u-1", actorRole: "pcb_editor", grantedCapabilities: ["read_project"], channel: "assistant-agent",
    currentRevisionDigest: "eng1-headdigest", lineageId: "", currentEditor: "", selectedKinds: [], projectState: ["board-present"], availableAuthority: ["local-working-copy"],
    providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 64, maxToolCount: 100 }, riskCeiling: "propose", approvalsAvailable: [], enabledFlags: [], requestedCategories: [],
    ...overrides,
  };
}
const GRANTABLE: Partial<DiscoveryContext> = { riskCeiling: "mutate", approvalsAvailable: ["reversible"], grantableCapabilities: ["edit_placement"], grantLineageId: "lin1-0000000000000001" };
const reasonFor = (registry: ToolRegistry, context: DiscoveryContext, toolId: string): string => {
  const result = discoverTools(registry, context);
  if (result.included.some((item) => item.toolId === toolId)) return "included";
  return result.excluded.find((item) => item.toolId === toolId)?.reason ?? "absent";
};

describe("B18-C — the reviewed list and the production exposure derived from it", () => {
  it("executionMode only on reviewed rows; every row exposed and violation-free; every other mutation unexposed; the report is clean; the predicate is the class rule plus the reviewed rows", () => {
    // I1 landed the list empty; I3 added the first reviewed row. No gate carries a count.
    expect(GRANTED_EXECUTION_TOOL_IDS).toEqual(GRANTED_EXECUTION_TOOLS.map((tool) => tool.toolId).sort());
    const registry = sirkitToolRegistry();
    expect(agentExposureReport(registry)).toMatchObject({ ok: true, executionViolations: [], classViolations: [], missing: [], unexpected: [] });
    expect(registry.coverageReport().agentExecutedCount).toBe(GRANTED_EXECUTION_TOOL_IDS.length);
    for (const descriptor of registry.list()) {
      const granted = GRANTED_EXECUTION_TOOL_IDS.includes(descriptor.toolId);
      expect(descriptor.executionMode === "granted", descriptor.toolId).toBe(granted);
      expect(descriptor.grantOnly, descriptor.toolId).toBeUndefined();
      expect(isAgentExposableDescriptor(descriptor), descriptor.toolId).toBe((AGENT_EXPOSABLE_OPERATION_CLASSES as readonly string[]).includes(descriptor.operationClass) || granted);
      if (["destructive", "release"].includes(descriptor.operationClass)) expect(descriptor.agentExposed, descriptor.toolId).toBe(false);
      if (descriptor.operationClass === "mutate") expect(descriptor.agentExposed, descriptor.toolId).toBe(granted);
    }
    for (const tool of GRANTED_EXECUTION_TOOLS) expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, tool.toolId).toContain(tool.toolId);
    expect(NEVER_GRANTED_COMMAND_IDS).toContain("pcb.edit-via");
    expect(NEVER_GRANTED_COMMAND_IDS).toContain("pcb.bounded-edit-apply");
  });
});

describe("B18-C I1 — the validator: B04 stays the rule, the granted family is the one derived exception", () => {
  it("an exposed mutation is refused without a reviewed row / executionMode / Tier 1 / grantable capability / canonical binding; the reviewed shape validates", () => {
    const forbidden = /agent-exposed mutation capability is forbidden/;
    expect(validateToolDescriptor({ ...MOVE, agentExposed: true, executionMode: undefined }, COMMANDS).join("\n")).toMatch(forbidden); // no executionMode
    expect(validateToolDescriptor({ ...GRANTED, toolId: "sirkit.pcb.move-footprint-shadow" }, COMMANDS).join("\n")).toMatch(/not in the reviewed granted-execution list/); // executionMode without a reviewed row
    expect(validateToolDescriptor(GRANTED, COMMANDS, { grantedExecutionTools: ROWS })).toEqual([]);
    expect(validateToolDescriptor({ ...GRANTED, approvalTier: "destructive" }, COMMANDS, { grantedExecutionTools: ROWS }).join("\n")).toMatch(/permission tier 2 is not Tier 1/);
    expect(validateToolDescriptor({ ...GRANTED, requiredCapability: "edit_copper" }, COMMANDS, { grantedExecutionTools: ROWS }).join("\n")).toMatch(/capability edit_copper is not grantable/);
    expect(validateToolDescriptor({ ...EDIT_TRACK, agentExposed: true, executionMode: "granted" }, COMMANDS, { grantedExecutionTools: [...ROWS, { toolId: "sirkit.pcb.edit-track", family: "pcb.move-footprint", reason: "x" }] }).join("\n")).toMatch(/can never be granted|not an execution family|differs from the reviewed family/);
    expect(validateToolDescriptor({ ...DELETE, agentExposed: true, executionMode: "granted" }, COMMANDS, { grantedExecutionTools: [...ROWS, { toolId: "sirkit.pcb.delete-item", family: "pcb.move-footprint", reason: "x" }] }).join("\n")).toMatch(/operation class destructive is not mutate|can never be granted/);
    expect(validateToolDescriptor({ ...MOVE, agentExposed: false }, COMMANDS, { grantedExecutionTools: ROWS })).toEqual([]); // executionMode without exposure is inert metadata
    const read = SIRKIT_TOOL_CATALOG.find((d) => d.toolId === "sirkit.pcb.board-inspect")!;
    expect(validateToolDescriptor({ ...read, executionMode: "granted" }, COMMANDS).join("\n")).toMatch(/legal only on a mutate tool/);
    expect(validateToolDescriptor({ ...GRANTED, grantOnly: true, executionMode: undefined }, COMMANDS, { grantedExecutionTools: ROWS }).join("\n")).toMatch(/grant-only tool must be a granted execution/);
    expect(grantedExecutionViolations(GRANTED, ROWS)).toEqual([]);
    expect(isGrantedExecutionDescriptor(GRANTED, ROWS)).toBe(true);
    expect(isGrantedExecutionDescriptor({ ...GRANTED, agentExposed: false }, ROWS)).toBe(false);
    expect(new ToolRegistry([GRANTED], COMMANDS, { grantedExecutionTools: ROWS }).coverageReport().agentExecutedCount).toBe(1);
    expect(() => new ToolRegistry([{ ...GRANTED, toolId: "sirkit.pcb.move-footprint-shadow" }], COMMANDS)).toThrow(forbidden);
    expect(() => new ToolRegistry([GRANTED], COMMANDS)).not.toThrow(); // [B18-C I3] the production list carries the reviewed row
  });
});

describe("B18-C I1 — discovery: the capability is the grant's, the lineage is the grant base's, the agent channel only", () => {
  const registry = new ToolRegistry([GRANTED, EDIT_TRACK, DELETE], COMMANDS, { grantedExecutionTools: ROWS });
  const ID = "sirkit.pcb.move-footprint";

  it("included ONLY with grantable capability + grant lineage + mutate ceiling + reversible approval on the assistant-agent channel; every missing piece excludes with its exact reason", () => {
    expect(reasonFor(registry, agentContext(GRANTABLE), ID)).toBe("included");
    expect(reasonFor(registry, agentContext(), ID)).toBe("capability_missing"); // the actor's read_project never suffices
    expect(reasonFor(registry, agentContext({ ...GRANTABLE, grantableCapabilities: [] }), ID)).toBe("capability_missing");
    expect(reasonFor(registry, agentContext({ ...GRANTABLE, grantLineageId: "" }), ID)).toBe("lineage_required"); // the schematic head mark never satisfies a granted execution
    expect(reasonFor(registry, agentContext({ ...GRANTABLE, riskCeiling: "propose" }), ID)).toBe("risk_ceiling");
    expect(reasonFor(registry, agentContext({ ...GRANTABLE, approvalsAvailable: [] }), ID)).toBe("approval_unavailable");
    for (const role of ["viewer", "commenter", "reviewer", "automation"] as const) expect(reasonFor(registry, agentContext({ ...GRANTABLE, actorRole: role }), ID), role).toBe("role_not_permitted");
    // Other channels: the grantable set is never counted (automation), and an interactive editor still needs the real capability.
    expect(reasonFor(registry, agentContext({ ...GRANTABLE, channel: "automation" }), ID)).toBe("capability_missing");
    expect(reasonFor(registry, agentContext({ ...GRANTABLE, channel: "interactive-ui", grantedCapabilities: ["read_project"] }), ID)).toBe("capability_missing");
    // Never-granted commands stay excluded on the agent channel whatever the context claims.
    expect(reasonFor(registry, agentContext(GRANTABLE), "sirkit.pcb.edit-track")).toBe("not_agent_exposed");
    expect(reasonFor(registry, agentContext(GRANTABLE), "sirkit.pcb.delete-item")).toBe("not_agent_exposed");
  });

  it("a grant-only tool is invisible on every channel but the assistant-agent one", () => {
    const grantOnly = new ToolRegistry([{ ...GRANTED, grantOnly: true }], COMMANDS, { grantedExecutionTools: ROWS });
    expect(reasonFor(grantOnly, agentContext(GRANTABLE), ID)).toBe("included");
    for (const channel of ["interactive-ui", "api", "automation"] as const) {
      const result = discoverTools(grantOnly, agentContext({ ...GRANTABLE, channel, grantedCapabilities: ["read_project", "edit_placement"] }));
      expect(result.included.some((item) => item.toolId === ID), channel).toBe(false);
      expect(result.excluded.find((item) => item.toolId === ID)?.reason, channel).toBe(channel === "interactive-ui" ? "grant_only" : "grant_only");
    }
  });
});

describe("B18-C I1 — context assembly and integrity", () => {
  const board = makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2);
  const basis = { historyHeadSequence: 4, historyHeadLabel: null, lineageId: "lin1-0000000000000001", activeDrcPresetId: PRESETS[0]!.id };
  const assemble = (over: { role?: "viewer" | "pcb_editor" | "project_admin"; flag?: boolean; board?: unknown; basis?: boolean } = {}) => {
    const assembly = assembleAgentRunContext({
      tenantId: "local", projectId: "p18", branchId: "main", board: "board" in over ? over.board : board, ...(over.basis === false ? {} : { pcbProposalBasis: basis }),
      verifiedActor: { principalId: "u-1", actorRole: over.role ?? "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" },
      ...(over.flag === undefined ? {} : { executionGrantsAvailable: over.flag }),
    });
    if (!assembly.ok) throw new Error(assembly.reason);
    return assembly.context;
  };

  it("grantability derives from server facts only (minter bound + Tier 1 role + verified board + PCB basis); the actor keeps read_project; absent the grant context the discovery object is unchanged", () => {
    const grantable = assemble({ flag: true });
    expect(grantable.executionGrantsAvailable).toBe(true);
    expect(grantable.discovery).toMatchObject({ riskCeiling: "mutate", approvalsAvailable: ["reversible"], grantableCapabilities: ["edit_placement"], grantLineageId: basis.lineageId, grantedCapabilities: ["read_project"] });
    expect(grantable.actor.grantedCapabilities).toEqual(["read_project"]);
    expect(verifyAgentContextIntegrity(grantable)).toEqual([]);
    for (const [label, context] of [["no flag", assemble()], ["flag false", assemble({ flag: false })], ["viewer", assemble({ flag: true, role: "viewer" })], ["no basis", assemble({ flag: true, basis: false })], ["no board", assemble({ flag: true, board: undefined })]] as const) {
      expect(context.executionGrantsAvailable, label).toBe(false);
      expect(context.discovery.riskCeiling, label).toBe("propose");
      expect(context.discovery.approvalsAvailable, label).toEqual([]);
      expect("grantableCapabilities" in context.discovery, label).toBe(false);
      expect("grantLineageId" in context.discovery, label).toBe(false);
      expect(verifyAgentContextIntegrity(context), label).toEqual([]);
    }
  });

  it("integrity refuses every tampered combination: an actor holding a grantable capability, a widened ceiling / approval / grantable set / lineage on a non-grantable run, and a narrowed one on a grantable run", () => {
    const plain = assemble();
    const grantable = assemble({ flag: true });
    const tampered: Array<[string, () => ReturnType<typeof assemble>]> = [
      ["actor holds edit_placement", () => ({ ...plain, actor: { ...plain.actor, grantedCapabilities: ["read_project", "edit_placement"] }, discovery: { ...plain.discovery, grantedCapabilities: ["read_project", "edit_placement"] } })],
      ["ceiling widened", () => ({ ...plain, discovery: { ...plain.discovery, riskCeiling: "mutate" } })],
      ["approval widened", () => ({ ...plain, discovery: { ...plain.discovery, approvalsAvailable: ["reversible"] } })],
      ["grantable set claimed", () => ({ ...plain, discovery: { ...plain.discovery, grantableCapabilities: ["edit_placement"] } })],
      ["lineage claimed", () => ({ ...plain, discovery: { ...plain.discovery, grantLineageId: basis.lineageId } })],
      ["flag flipped without discovery", () => ({ ...plain, executionGrantsAvailable: true })],
      ["grantable run narrowed", () => ({ ...grantable, discovery: { ...grantable.discovery, riskCeiling: "propose" } })],
      ["grantable run with a foreign lineage", () => ({ ...grantable, discovery: { ...grantable.discovery, grantLineageId: "lin1-0000000000000002" } })],
      ["grantable run with edit_copper", () => ({ ...grantable, discovery: { ...grantable.discovery, grantableCapabilities: ["edit_placement", "edit_copper"] } })],
    ];
    for (const [label, build] of tampered) expect(verifyAgentContextIntegrity(build()).length, label).toBeGreaterThan(0);
  });
});
