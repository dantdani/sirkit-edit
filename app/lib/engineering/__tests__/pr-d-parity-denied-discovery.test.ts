/**
 * [PR-D] Denied discovery and no escalation (D.8, D.10 (c) and (e)) — the
 * negative half of the parity suite, extending the B17-F / B18-C discovery
 * pins with the EXCLUSION REASON each denial carries and with the run-level
 * toolset the model actually receives (`buildRunToolset` over a context the
 * assembler derived from server facts):
 *
 *  - a viewer or commenter is offered no mutate and no propose tool, even under
 *    the full grant context (role_not_permitted), at the registry AND at the run;
 *  - without a board there is no routing / placement proposal, no granted
 *    execution and no board read (project_state_missing), and the run toolset
 *    withholds them;
 *  - without a selection the sealed selection resource withholds
 *    `selection.inspect` (B10), and every selection-GATED descriptor is excluded
 *    `selection_kind_missing` — none of them is agent-exposed, so a selection
 *    can never widen the agent's set;
 *  - the 3D tools need a pcb3d surface (project_state_missing without one);
 *  - no intentional id matches the Tier 3 floor; no exposed tool binds a
 *    never-granted command; the MCP subset is inside the agent set; a Tier 3
 *    word in an id (release / purchase / order / publish) makes any descriptor
 *    Tier 3, non-exposable and refused by the validator.
 *
 * b17-f-agent-exposure keeps the positive pins (what IS offered); nothing here
 * repeats an assertion that suite already carries.
 */
import { describe, expect, it } from "vitest";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, agentExposureReport, grantedExecutionReport, isAgentExposableDescriptor } from "../agent-exposure";
import { GRANTED_EXECUTION_TOOL_IDS, NEVER_GRANTED_COMMAND_IDS, grantedExecutionViolations } from "../granted-execution-families";
import { TIER3_FLOOR_PATTERN, permissionTierOfDescriptor } from "../permission-tiers";
import { INTENTIONAL_MCP_EXPOSED_TOOL_IDS, mcpExposureReport } from "../mcp-exposure";
import { sirkitToolRegistry } from "../tool-catalog";
import { discoverTools, type DiscoveryContext, type ExclusionReason } from "../tool-discovery";
import { validateToolDescriptor, type ToolDescriptor } from "../tool-registry";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { assembleAgentRunContext } from "../../agent/context";
import { buildRunToolset } from "../../agent/loop";
import type { ProjectRole } from "../types";
import { composition, fixtureBoard, r3Of, runContext } from "./b18c-harness";

const registry = sirkitToolRegistry();
const KNOWN = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
const descriptorOf = (toolId: string): ToolDescriptor => registry.list().find((item) => item.toolId === toolId)!;
const PROPOSE_IDS = registry.list().filter((item) => item.agentExposed && item.operationClass === "propose").map((item) => item.toolId).sort();
const FULL_STATE: DiscoveryContext["projectState"] = ["board-present", "schematic-present", "pcb-surface", "pcb3d-surface", "schematic-surface", "workspace-surface"];

/** The B17-F agent context (b17-f-agent-exposure.test.ts) with the B18-C grant context (b18-c-exposure-lift.test.ts) on top. */
function grantedContext(overrides: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return {
    tenantId: "local", projectId: "p", branchId: "main", actorId: "u1", actorRole: "pcb_editor", grantedCapabilities: ["read_project"], channel: "assistant-agent",
    currentRevisionDigest: "eng1-0000000000000000", lineageId: "", currentEditor: "", selectedKinds: [], projectState: FULL_STATE, availableAuthority: ["local-working-copy"],
    providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 64, maxToolCount: 64 },
    riskCeiling: "mutate", approvalsAvailable: ["reversible"], grantableCapabilities: ["edit_placement"], grantLineageId: "lin1-0000000000000001", enabledFlags: [], requestedCategories: [],
    ...overrides,
  };
}
const reasonFor = (context: DiscoveryContext, toolId: string): ExclusionReason | "included" | "absent" => {
  const result = discoverTools(registry, context);
  if (result.included.some((item) => item.toolId === toolId)) return "included";
  return result.excluded.find((item) => item.toolId === toolId)?.reason ?? "absent";
};
const includedClasses = (context: DiscoveryContext): Set<string> => new Set(discoverTools(registry, context).included.map((item) => item.operationClass));

/** A run the server assembled from its own facts (as the chat route does), varying only the role and whether a board exists. */
function runToolIds(input: { role: ProjectRole; board?: boolean }): string[] {
  const basis = { historyHeadSequence: 1, historyHeadLabel: null, lineageId: "lin1-0000000000000001", activeDrcPresetId: DEFAULT_PRESET_ID };
  const assembly = assembleAgentRunContext({
    tenantId: "local", projectId: "p-pr-d", branchId: "main",
    ...(input.board === false ? {} : { board: fixtureBoard(), pcbProposalBasis: basis }),
    verifiedActor: { principalId: `u-${input.role}`, actorRole: input.role, membershipRevision: "mbr1-a", authMethod: "local_dev" },
    executionGrantsAvailable: true,
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return buildRunToolset(registry, assembly.context, () => undefined).declarations.map((declaration) => declaration.toolId).sort();
}
const classesOf = (ids: readonly string[]): Set<string> => new Set(ids.map((id) => descriptorOf(id).operationClass));

describe("PR-D parity (c) — denied discovery carries its closed reason, at the registry and at the run", () => {
  it("a viewer or commenter is offered no mutate and no propose tool even under the full grant context: every granted execution and every proposal is excluded role_not_permitted; the run toolset the server assembles for them carries neither class", () => {
    for (const role of ["viewer", "commenter"] as const) {
      const context = grantedContext({ actorRole: role });
      const classes = includedClasses(context);
      expect(classes.has("mutate"), role).toBe(false);
      expect(classes.has("propose"), role).toBe(false);
      for (const id of GRANTED_EXECUTION_TOOL_IDS) expect(reasonFor(context, id), `${role} ${id}`).toBe("role_not_permitted");
      for (const id of PROPOSE_IDS) expect(reasonFor(context, id), `${role} ${id}`).toBe("role_not_permitted");
      const run = runToolIds({ role });
      expect(classesOf(run).has("mutate"), role).toBe(false);
      expect(classesOf(run).has("propose"), role).toBe(false);
      expect(run, `${role} keeps reads`).toContain("sirkit.pcb.board-inspect");
    }
    // The positive control: the editor role is offered both classes by the same contexts.
    expect(includedClasses(grantedContext()).has("mutate")).toBe(true);
    expect(classesOf(runToolIds({ role: "pcb_editor" })).has("mutate")).toBe(true);
  });

  it("without a board: no routing or placement proposal, no granted execution and no board read — project_state_missing at the registry; the run assembled without a board offers none of them", () => {
    const noBoard = grantedContext({ projectState: ["schematic-present", "schematic-surface", "workspace-surface"] });
    for (const id of ["sirkit.routing.propose", "sirkit.placement.propose", "sirkit.pcb.board-inspect", "sirkit.pcb.propose-bounded-edit", ...GRANTED_EXECUTION_TOOL_IDS]) expect(reasonFor(noBoard, id), id).toBe("project_state_missing");
    const run = runToolIds({ role: "pcb_editor", board: false });
    expect(run.filter((id) => descriptorOf(id).category === "pcb" || descriptorOf(id).category === "routing" || descriptorOf(id).category === "placement")).toEqual([]);
    expect(classesOf(run).has("mutate")).toBe(false);
    expect(run).not.toContain("sirkit.pcb.board-inspect");
  });

  it("without a selection: the run withholds selection.inspect until the sealed selection resource exists (B10); every selection-GATED descriptor is excluded selection_kind_missing on the editor's own channel, and none of them is agent-exposed, so a selection can never widen the agent's set", async () => {
    const c = await composition("proposal_only");
    const without = buildRunToolset(registry, runContext(c), () => undefined).declarations.map((declaration) => declaration.toolId);
    expect(without).not.toContain("sirkit.selection.inspect");
    const refs = [{ kind: "footprint" as const, id: r3Of(c).id }];
    const withSelection = buildRunToolset(registry, runContext(c, { refs, primary: refs[0]! }), () => undefined).declarations.map((declaration) => declaration.toolId);
    expect(withSelection).toContain("sirkit.selection.inspect");
    const gated = registry.list().filter((item) => item.requiredSelectionKinds.length > 0);
    expect(gated.length).toBeGreaterThan(0);
    const editorNoSelection = grantedContext({ channel: "interactive-ui", grantedCapabilities: ["read_project", "edit_placement", "edit_copper", "edit_zones"], approvalsAvailable: ["reversible", "topology-or-geometry", "destructive"], riskCeiling: "destructive", lineageId: "lin1-0000000000000001", selectedKinds: [] });
    for (const descriptor of gated) {
      expect(descriptor.agentExposed, descriptor.toolId).toBe(false);
      expect(reasonFor(editorNoSelection, descriptor.toolId), descriptor.toolId).toBe("selection_kind_missing");
      expect(reasonFor(grantedContext(), descriptor.toolId), `${descriptor.toolId} on the agent channel`).toBe("not_agent_exposed");
    }
  }, 30_000);

  it("the 3D tools need a pcb3d surface: without it sirkit.view.pcb3d is excluded project_state_missing, and a run whose captured view proves no surface is offered no view-session tool at all", async () => {
    expect(reasonFor(grantedContext({ projectState: ["board-present", "schematic-present", "pcb-surface", "schematic-surface", "workspace-surface"] }), "sirkit.view.pcb3d")).toBe("project_state_missing");
    expect(reasonFor(grantedContext(), "sirkit.view.pcb3d")).toBe("included");
    const c = await composition("proposal_only");
    const ids = buildRunToolset(registry, runContext(c), () => undefined).declarations.map((declaration) => declaration.toolId);
    expect(ids.filter((id) => descriptorOf(id).operationClass === "view-session")).toEqual([]);
  }, 30_000);
});

describe("PR-D parity (e) — no escalation", () => {
  it("no id in INTENTIONAL_AGENT_EXPOSED_TOOL_IDS matches the Tier 3 floor; every exposed descriptor is Tier 0, 1 or 2 and exactly the granted executions are Tier 1 mutations", () => {
    for (const id of INTENTIONAL_AGENT_EXPOSED_TOOL_IDS) expect(TIER3_FLOOR_PATTERN.test(id), id).toBe(false);
    for (const descriptor of registry.list().filter((item) => item.agentExposed)) {
      const tier = permissionTierOfDescriptor(descriptor);
      expect(tier, descriptor.toolId).toBeLessThan(3);
      expect(descriptor.operationClass === "mutate", descriptor.toolId).toBe(GRANTED_EXECUTION_TOOL_IDS.includes(descriptor.toolId));
      if (descriptor.operationClass === "mutate") expect(tier, descriptor.toolId).toBe(1);
    }
  });

  it("no exposed tool is bound to a never-granted command, and the granted-execution report over the production registry is empty", () => {
    for (const descriptor of registry.list().filter((item) => item.agentExposed)) {
      const command = descriptor.binding.canonicalCommandId;
      if (command) expect(NEVER_GRANTED_COMMAND_IDS, `${descriptor.toolId} → ${command}`).not.toContain(command);
    }
    expect(grantedExecutionReport(registry.list())).toEqual([]);
    expect(agentExposureReport(registry)).toMatchObject({ ok: true, executionViolations: [], classViolations: [] });
  });

  it("the MCP-exposed subset is within the agent-exposed set: the report names nothing outside it, every reviewed MCP id is an intentional agent id, and under the most permissive context the mcp channel's discovered set is a subset of the assistant-agent channel's", () => {
    const report = mcpExposureReport(registry);
    expect(report.ok).toBe(true);
    expect(report.outsideAgentSet).toEqual([]);
    for (const id of INTENTIONAL_MCP_EXPOSED_TOOL_IDS) expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, id).toContain(id);
    const permissive = grantedContext({ riskCeiling: "release", approvalsAvailable: ["reversible", "topology-or-geometry", "destructive", "release"], availableAuthority: ["local-working-copy", "durable-server-board", "external-observation", "external-mcp-observation", "computation-engine"] });
    const agent = new Set(discoverTools(registry, permissive).included.map((item) => item.toolId));
    const mcp = discoverTools(registry, { ...permissive, channel: "mcp" }).included.map((item) => item.toolId);
    expect(mcp.length).toBeGreaterThan(0);
    for (const id of mcp) expect(agent.has(id), id).toBe(true);
    for (const id of mcp) expect(descriptorOf(id).operationClass, id).not.toBe("mutate");
  });

  it("a Tier 3 word in an id (release / purchase / order / publish) makes a descriptor Tier 3, non-exposable and a granted-execution violation, and the validator refuses to expose it — even when it copies a reviewed granted execution field for field", () => {
    const move = registry.get("sirkit.pcb.move-footprint")!;
    for (const word of ["release", "purchase", "order", "publish"]) {
      const forged: ToolDescriptor = { ...move, toolId: `sirkit.pcb.${word}-footprints` };
      expect(TIER3_FLOOR_PATTERN.test(forged.toolId), word).toBe(true);
      expect(permissionTierOfDescriptor(forged), word).toBe(3);
      expect(isAgentExposableDescriptor(forged), word).toBe(false);
      expect(grantedExecutionViolations(forged), word).toEqual(expect.arrayContaining([expect.stringMatching(/permission tier 3 is not Tier 1/), expect.stringMatching(/not in the reviewed granted-execution list/)]));
      expect(validateToolDescriptor(forged, KNOWN).join("\n"), word).toMatch(/forbidden|Tier 3|tier 3|never/i);
    }
  });
});
