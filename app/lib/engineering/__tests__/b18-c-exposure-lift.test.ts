/**
 * [B18-C I3] The exposure lift — `sirkit.pcb.move-footprint` becomes the first
 * reviewed granted execution. Pins:
 *
 *  - the B18-C additions to the intentional set are EXACTLY the reviewed
 *    granted-execution ids (derived from the list, never a count);
 *  - the lifted descriptor's reviewed shape (1.1.1 since B18-E E3, granted, Tier 1,
 *    edit_placement, engineering-state, bound to the canonical editor session,
 *    named targets with no selection gate, an integer-nanometre schema that is
 *    strict-representable for both providers);
 *  - every other mutation stays unexposed and still matches the never-exposed
 *    patterns; no exposed tool binds a never-granted command; release,
 *    qualification and the replay primitive stay unexposed;
 *  - discovery: the agent channel offers it ONLY with the server-derived grant
 *    context (the actor's own capability and the schematic lineage never count
 *    there); automation never; the trusted interactive UI keeps it.
 */
import { describe, expect, it } from "vitest";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS, agentExposureReport, isAgentExposableDescriptor } from "../agent-exposure";
import { GRANTED_EXECUTION_TOOLS, GRANTED_EXECUTION_TOOL_IDS, NEVER_GRANTED_COMMAND_IDS, grantedExecutionViolations } from "../granted-execution-families";
import { permissionTierOfDescriptor } from "../permission-tiers";
import { sirkitToolRegistry } from "../tool-catalog";
import { discoverTools, type DiscoveryContext } from "../tool-discovery";
import { strictCompatibility } from "../../agent/provider-tools";

const registry = sirkitToolRegistry();
const MOVE_ID = "sirkit.pcb.move-footprint";
/** The intentional set at the close of B17-F — the B18-C additions are measured against it. */
const B17_BASELINE: readonly string[] = [
  "sirkit.component-authority.inspect", "sirkit.manufacturing.readiness-inspect", "sirkit.pcb.board-inspect", "sirkit.pcb.propose-bounded-edit",
  "sirkit.pcb.revision-inspect", "sirkit.placement.propose", "sirkit.project.canonical-revision-inspect", "sirkit.project.history-inspect",
  "sirkit.routing.propose", "sirkit.schematic.inspect", "sirkit.schematic.propose-component-replacement", "sirkit.schematic.propose-tier1-edit",
  "sirkit.selection.control", "sirkit.selection.inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run",
  "sirkit.view.canvas-navigation", "sirkit.view.layers", "sirkit.view.measure", "sirkit.view.pcb3d", "sirkit.view.read-state", "sirkit.view.reveal-finding",
];

function agentContext(overrides: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return {
    tenantId: "local", projectId: "p", branchId: "main", actorId: "u1", actorRole: "pcb_editor", grantedCapabilities: ["read_project"], channel: "assistant-agent",
    currentRevisionDigest: "eng1-0000000000000000", lineageId: "", currentEditor: "", selectedKinds: [], projectState: ["board-present"], availableAuthority: ["local-working-copy"],
    providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 64, maxToolCount: 64 }, riskCeiling: "propose", approvalsAvailable: [], enabledFlags: [], requestedCategories: [],
    ...overrides,
  };
}
const GRANT_CONTEXT: Partial<DiscoveryContext> = { riskCeiling: "mutate", approvalsAvailable: ["reversible"], grantableCapabilities: ["edit_placement"], grantLineageId: "lin1-0000000000000001" };
const included = (context: DiscoveryContext): string[] => discoverTools(registry, context).included.map((item) => item.toolId);

describe("B18-C I3 — the exposure lift", () => {
  it("the B18-C additions to the intentional set are exactly the reviewed granted-execution ids; every reviewed row carries its reason; the report is clean", () => {
    expect(GRANTED_EXECUTION_TOOL_IDS).toContain(MOVE_ID);
    expect(B17_BASELINE.every((id) => INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.includes(id))).toBe(true);
    // [B18-E E11] one reviewed READ was added after B18-C (the bounded mechanical read scenario 3 needs); the set stays
    // EXACT — every other addition beyond the B17 baseline is still a reviewed granted execution.
    // [B19-E E6] reviewed pin move: + the two bounded Tier 0 external reads (sirkit.parts.evidence-read, sirkit.parts.external-search),
    // reviewed in agent-exposure.ts and pinned in b19-e-external-read-descriptors; still no other non-granted addition.
    // [B20 A4] reviewed pin move: + the one bounded Tier 0 external tool read of approved MCP servers (sirkit.mcp.observation-read),
    // reviewed in agent-exposure.ts and pinned in b20-a4-observation-descriptor.
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.filter((id) => !B17_BASELINE.includes(id))).toEqual([...GRANTED_EXECUTION_TOOL_IDS, "sirkit.computation.analytical-equation", "sirkit.computation.artifact-compare", "sirkit.computation.artifact-parse", "sirkit.mcp.observation-read", "sirkit.parts.evidence-read", "sirkit.parts.external-search", "sirkit.pcb.board-page-inspect", "sirkit.pcb.mechanical-inspect", "sirkit.pcb.via-inspect"].sort()); // [B22-B, 2026-10-01] reviewed pin move (OD-139): + the three bounded Tier 0 named computation reads, reviewed in agent-exposure.ts and pinned in b22-b-exposure; [B24-D2, 2026-10-09] reviewed pin move (OD-213): + the bounded paged board read, reviewed in agent-exposure.ts and pinned in b24-d2-board-read
    for (const tool of GRANTED_EXECUTION_TOOLS) expect(tool.reason.length, tool.toolId).toBeGreaterThan(40);
    expect(agentExposureReport(registry)).toMatchObject({ ok: true, missing: [], unexpected: [], classViolations: [], executionViolations: [] });
  });

  it("the lifted descriptor has the reviewed shape and renders the exact strict schema both providers receive", () => {
    const move = registry.get(MOVE_ID)!;
    expect(move).toMatchObject({
      version: "1.1.1", operationClass: "mutate", agentExposed: true, executionMode: "granted", requiredCapability: "edit_placement", // [B18-E E3] pin moved with the id-source wording
      requiredRoles: ["pcb_editor", "project_admin"], approvalTier: "reversible", requiredSelectionKinds: [], sideEffects: "engineering-state",
      callability: "callable", lifecycle: "active", discovery: "discoverable", requiresExpectedRevision: true, requiresLineage: true,
      binding: { status: "bound-mutation-editor-session", symbol: "CanonicalEditorSession.commit", canonicalCommandId: "pcb.move-footprint" },
    });
    expect(move.grantOnly).toBeUndefined();
    expect(permissionTierOfDescriptor(move)).toBe(1);
    expect(grantedExecutionViolations(move)).toEqual([]);
    expect(isAgentExposableDescriptor(move)).toBe(true);
    expect(move.description).toMatch(/EXECUTION tool/);
    expect(move.description).toMatch(/never changes the board by itself/);
    const strict = strictCompatibility(move);
    expect(strict.ok).toBe(true);
    if (!strict.ok) return;
    expect(strict.schema).toEqual({
      type: "object", additionalProperties: false, required: ["moves"],
      properties: {
        moves: {
          type: "array", description: expect.any(String),
          items: {
            type: "object", additionalProperties: false, required: ["footprintId", "x", "y"],
            properties: { footprintId: { type: "string", description: expect.any(String) }, x: { type: "integer", description: expect.any(String) }, y: { type: "integer", description: expect.any(String) } },
          },
        },
      },
    });
  });

  it("every other mutation stays unexposed; no exposed tool binds a never-granted command; release, qualification and the replay primitive stay unexposed", () => {
    for (const descriptor of registry.list()) {
      if (descriptor.operationClass === "mutate" && !GRANTED_EXECUTION_TOOL_IDS.includes(descriptor.toolId)) expect(descriptor.agentExposed, descriptor.toolId).toBe(false);
      if (["destructive", "release"].includes(descriptor.operationClass)) expect(descriptor.agentExposed, descriptor.toolId).toBe(false);
      if (descriptor.agentExposed && descriptor.binding.canonicalCommandId) expect(NEVER_GRANTED_COMMAND_IDS, descriptor.toolId).not.toContain(descriptor.binding.canonicalCommandId);
      if (descriptor.agentExposed) for (const pattern of NEVER_EXPOSED_TOOL_PATTERNS) expect(pattern.test(descriptor.toolId), `${descriptor.toolId} vs ${pattern}`).toBe(false);
    }
    for (const id of ["sirkit.pcb.edit-track", "sirkit.pcb.delete-item", "sirkit.pcb.create-via", "sirkit.pcb.zone-edit", "sirkit.pcb.undo-redo-canonical", "sirkit.manufacturing.release"]) { // [B18-C I5/I7] rotate/flip, arrange and dimension were lifted
      expect(registry.get(id)?.agentExposed, id).toBe(false);
      expect(NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(id)), id).toBe(true);
    }
    expect(NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(MOVE_ID))).toBe(false);
  });

  it("discovery: the agent channel offers it ONLY with the server-derived grant context; the actor's own capability and the schematic lineage never count there; automation never; the trusted interactive UI keeps it", () => {
    expect(included(agentContext(GRANT_CONTEXT))).toContain(MOVE_ID);
    expect(included(agentContext())).not.toContain(MOVE_ID);
    // An actor CLAIMING edit_placement on the agent channel (the gateway's integrity check refuses such a run) still gets nothing without the grant context.
    expect(included(agentContext({ grantedCapabilities: ["read_project", "edit_placement"], riskCeiling: "mutate", approvalsAvailable: ["reversible"], lineageId: "lin1-schematic" }))).not.toContain(MOVE_ID);
    // The schematic head mark's lineage never stands in for the grant lineage.
    expect(discoverTools(registry, agentContext({ ...GRANT_CONTEXT, grantLineageId: "", lineageId: "lin1-schematic" })).excluded.find((entry) => entry.toolId === MOVE_ID)?.reason).toBe("lineage_required");
    for (const role of ["viewer", "commenter", "reviewer"] as const) expect(included(agentContext({ ...GRANT_CONTEXT, actorRole: role })), role).not.toContain(MOVE_ID);
    expect(included(agentContext({ ...GRANT_CONTEXT, channel: "automation" }))).not.toContain(MOVE_ID);
    expect(included(agentContext({ channel: "interactive-ui", grantedCapabilities: ["read_project", "edit_placement"], lineageId: "lin1-0000000000000001", riskCeiling: "mutate", approvalsAvailable: ["reversible"] }))).toContain(MOVE_ID);
  });
});
