/**
 * [B17-F] Tool exposure — the ONE reviewed intentional set, registry-derived
 * gates, view-session tools as bound bus-command tools, never-exposed
 * capabilities, and contextual discovery (no 3D tools without a 3D surface,
 * no routing without a board, no proposals to a viewer).
 */
import { describe, expect, it } from "vitest";
import { AGENT_EXPOSABLE_OPERATION_CLASSES, INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS, agentExposureReport, isAgentExposableDescriptor } from "../agent-exposure";
import { sirkitToolRegistry, SIRKIT_TOOL_CATALOG } from "../tool-catalog";
import { discoverTools, type DiscoveryContext } from "../tool-discovery";
import { ToolRegistry, validateToolDescriptor, type ToolDescriptor } from "../tool-registry";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { GRANTED_EXECUTION_TOOL_IDS } from "../granted-execution-families"; // [B18-C I3]
import { permissionTierOfDescriptor } from "../permission-tiers";
import { serverViewCommands } from "../../agent/view-context";
import { VIEW_EDITORS } from "../../view-session/types";

const registry = sirkitToolRegistry();
const KNOWN = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));

function agentContext(overrides: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return {
    tenantId: "local", projectId: "p", branchId: "main",
    actorId: "u1", actorRole: "project_admin", grantedCapabilities: ["read_project"],
    channel: "assistant-agent",
    currentRevisionDigest: "eng1-0000000000000000", lineageId: "",
    currentEditor: "", selectedKinds: [],
    projectState: ["board-present", "schematic-present", "pcb-surface", "pcb3d-surface", "schematic-surface", "workspace-surface"],
    availableAuthority: ["local-working-copy"],
    providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 64, maxToolCount: 64 },
    riskCeiling: "propose", approvalsAvailable: [], enabledFlags: [], requestedCategories: [],
    ...overrides,
  };
}
const includedIds = (context: DiscoveryContext): string[] => discoverTools(registry, context).included.map((item) => item.toolId);

describe("B17-F §1 — the intentional exposure set is derived, reviewed and exact", () => {
  it("the registry's actual exposure equals the intentional list; the report is clean; the list is sorted and unique", () => {
    const report = agentExposureReport(registry);
    expect(report).toMatchObject({ ok: true, missing: [], unexpected: [], classViolations: [] });
    expect(report.actual).toEqual([...INTENTIONAL_AGENT_EXPOSED_TOOL_IDS]);
    expect(report.count).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    expect([...INTENTIONAL_AGENT_EXPOSED_TOOL_IDS]).toEqual([...new Set(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS)].sort());
    expect(registry.coverageReport().agentExposedCount).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
  });

  it("only read / propose / view-session classes — or a reviewed Tier 1 granted execution — are exposable; every exposed tool is active, discoverable, callable and bound", () => {
    expect([...AGENT_EXPOSABLE_OPERATION_CLASSES]).toEqual(["read", "propose", "view-session"]);
    for (const descriptor of registry.list().filter((item) => item.agentExposed)) {
      expect(isAgentExposableDescriptor(descriptor), descriptor.toolId).toBe(true);
      expect(descriptor.lifecycle, descriptor.toolId).toBe("active");
      expect(descriptor.discovery, descriptor.toolId).toBe("discoverable");
      expect(descriptor.callability, descriptor.toolId).toBe("callable");
      expect(descriptor.binding.status, descriptor.toolId).not.toBe("unbound");
      if (GRANTED_EXECUTION_TOOL_IDS.includes(descriptor.toolId)) {
        // [B18-C I3] a granted execution changes engineering state ONLY under a server-minted grant; Tier 1 by derivation.
        expect(descriptor.sideEffects, descriptor.toolId).toBe("engineering-state");
        expect(["reversible", "none"], descriptor.toolId).toContain(descriptor.approvalTier);
        expect(permissionTierOfDescriptor(descriptor), descriptor.toolId).toBe(1);
      } else {
        expect(["none", "derived-cache", "proposal-artifact", "session-state"], descriptor.toolId).toContain(descriptor.sideEffects);
        expect(descriptor.approvalTier, descriptor.toolId).toBe("none");
      }
    }
  });

  it("nothing that qualifies or releases manufacturing, replays canonical history, executes a raw process, replaces state wholesale or mutates a database/file is exposed", () => {
    const exposed = registry.list().filter((item) => item.agentExposed);
    for (const descriptor of exposed) {
      for (const pattern of NEVER_EXPOSED_TOOL_PATTERNS) expect(pattern.test(descriptor.toolId), `${descriptor.toolId} vs ${pattern}`).toBe(false);
      expect(descriptor.toolId).not.toMatch(/process|exec|shell|database|db\.|file\.|replace-state|import-state/i);
      expect(["destructive", "release"], descriptor.toolId).not.toContain(descriptor.operationClass);
      expect(isAgentExposableDescriptor(descriptor), descriptor.toolId).toBe(true);
      if (descriptor.operationClass === "mutate") expect(GRANTED_EXECUTION_TOOL_IDS, descriptor.toolId).toContain(descriptor.toolId);
    }
    // [B18-C I3] every reviewed granted execution is exposed; release, the replay primitive and the never-granted mutations never are.
    for (const id of GRANTED_EXECUTION_TOOL_IDS) expect(exposed.map((item) => item.toolId), id).toContain(id);
    for (const id of ["sirkit.manufacturing.release", "sirkit.pcb.undo-redo-canonical", "sirkit.pcb.delete-item", "sirkit.pcb.edit-track"]) {
      const descriptor = registry.list().find((item) => item.toolId === id);
      expect(descriptor, id).toBeDefined();
      expect(descriptor!.agentExposed, id).toBe(false);
    }
  });

  it("the B17-F additions are exactly the view/session reads, the six view-session tools, the timeline read and the two layout proposals", () => {
    // (B18-C granted executions are pinned by b18-c-exposure-lift; the B18-E E11 bounded mechanical read is excluded
    //  by name below — it is a later reviewed addition, not a B17-F one.)
    // [B19-E E6] reviewed pin move: the two bounded external reads (sirkit.parts.evidence-read, sirkit.parts.external-search) are
    // excluded by name like the other later additions — they are B19-E E6 additions, pinned in b19-e-external-read-descriptors.
    // [B20 A4] reviewed pin move: the agent's one external tool read of approved MCP servers (sirkit.mcp.observation-read) is
    // excluded by name too — a B20-A4 addition, pinned in b20-a4-observation-descriptor.
    const added = INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.filter((id) => !GRANTED_EXECUTION_TOOL_IDS.includes(id) && !["sirkit.computation.analytical-equation", "sirkit.computation.artifact-compare", "sirkit.computation.artifact-parse", "sirkit.component-authority.inspect", "sirkit.generation.task-control", "sirkit.generation.task-inspect", /* [PR-L, 2026-10-18] reviewed pin move: runbook L.5's two later additions, excluded by name like the others (pinned in l5-generation-task-tool) */ "sirkit.manufacturing.readiness-inspect", "sirkit.mcp.observation-read", "sirkit.parts.acquisition-start", "sirkit.parts.acquisition-status", /* [PR-M, 2026-10-18] reviewed pin move: section M2's two later additions (the CAD acquisition start and status), excluded by name like the others (pinned in m2-1-schematic-acquisition-discovery) */ "sirkit.parts.evidence-read", "sirkit.parts.external-search", "sirkit.pcb.board-inspect", "sirkit.pcb.board-page-inspect", "sirkit.pcb.mechanical-inspect", "sirkit.pcb.via-inspect", "sirkit.pcb.propose-bounded-edit", "sirkit.pcb.revision-inspect", "sirkit.project.canonical-revision-inspect", "sirkit.schematic.inspect", "sirkit.schematic.propose-component-replacement", "sirkit.schematic.propose-tier1-edit", "sirkit.selection.inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run", "sirkit.schematic.generate-proposal", "sirkit.parts.catalog-inspect", "sirkit.pcb-sync.preflight", "sirkit.parts.draft-request", "sirkit.parts.missing-facts", "sirkit.module.propose-contracts", "sirkit.stackup.propose", "sirkit.schematic.instance-inspect", "sirkit.parts.candidate-search", "sirkit.schematic.propose-component-resolution", "sirkit.schematic.propose-sheet-organization"].includes(id)); // [PR-J5, 2026-10-23] reviewed pin move: + the organise proposal (runbook J.6, OD-259 item 4), excluded by name the same way - pinned in j5-organize-proposal-tool; // [PR-M, 2026-10-17] reviewed pin move: + the schematic-instance inspection, the resolution candidate search and the component resolution proposal, excluded by name the same way - pinned in m1-led-dimmer-resolution; // [PR-F fE, 2026-10-17] reviewed pin move: + the stackup / via-policy proposal, excluded by name the same way - pinned in pr-f-stackup-candidate; // [PR-F fD, 2026-10-17] reviewed pin move: + the module contract proposal, excluded by name the same way - pinned in pr-f-module-propose; // [PR-F fB, 2026-10-17] reviewed pin move: + the missing-facts read and the part draft request, excluded by name the same way - pinned in pr-f-missing-parts-parity; // [PR-D d2, 2026-10-16] reviewed pin move: + the Schematic to PCB preflight read and the catalog part inspection (two Tier 0 reads), excluded by name the same way - pinned in pr-d-pcb-sync-preflight and pr-d-catalog-inspect; [B24-D2, 2026-10-09] reviewed pin move (OD-213): + the paged board read, excluded by name like the other later additions - a B24-D2 addition, pinned in b24-d2-board-read; [PR-D, 2026-10-16] reviewed pin move (OD-243): + the Build-mode generation proposal, excluded by name the same way - pinned in pr-d-generate-proposal
    expect(added).toEqual(["sirkit.placement.propose", "sirkit.project.history-inspect", "sirkit.routing.propose", "sirkit.selection.control", "sirkit.view.canvas-navigation", "sirkit.view.layers", "sirkit.view.measure", "sirkit.view.pcb3d", "sirkit.view.read-state", "sirkit.view.reveal-finding"]); // [B22-B, 2026-10-01] reviewed pin move (OD-139): the three named computation reads are excluded by name above like the other later additions - B22-B additions, pinned in b22-b-exposure
  });
});

describe("B17-F §2 — view-session tools are bound bus-command tools", () => {
  const viewTools = registry.list().filter((item) => item.agentExposed && item.operationClass === "view-session");
  const busCommands = new Map(VIEW_EDITORS.map((editor) => [editor, new Set(serverViewCommands(editor, null, null).map((command) => command.commandId))]));

  it("every exposed view-session tool lists real bus commands of its editors, never an observe mirror, with session-state side effects and no authority", () => {
    expect(viewTools.map((item) => item.toolId).sort()).toEqual(["sirkit.selection.control", "sirkit.view.canvas-navigation", "sirkit.view.layers", "sirkit.view.measure", "sirkit.view.pcb3d", "sirkit.view.reveal-finding"]);
    for (const descriptor of viewTools) {
      expect(descriptor.binding.status, descriptor.toolId).toBe("bound-view-session");
      expect(descriptor.sideEffects, descriptor.toolId).toBe("session-state");
      expect(descriptor.requiredAuthority, descriptor.toolId).toEqual(["none"]);
      expect(descriptor.requiredCapability, descriptor.toolId).toBe("read_project");
      expect(descriptor.viewCommands?.length ?? 0, descriptor.toolId).toBeGreaterThan(0);
      for (const commandId of descriptor.viewCommands ?? []) {
        const editor = commandId.split(".")[0] as (typeof VIEW_EDITORS)[number];
        expect(busCommands.get(editor)?.has(commandId), `${descriptor.toolId} → ${commandId}`).toBe(true);
        expect(commandId.endsWith(".observe")).toBe(false);
      }
    }
    // Every human-only observe mirror stays out of every tool.
    for (const [, commands] of busCommands) for (const commandId of commands) if (commandId.endsWith(".observe")) expect(viewTools.some((tool) => tool.viewCommands?.includes(commandId))).toBe(false);
  });

  it("the registry refuses an exposed-but-unbound view tool, an observe command, a view command on a read tool, and an exposed mutation", () => {
    const base = registry.get("sirkit.view.layers", "1.0.0")!;
    const errorsOf = (patch: Partial<ToolDescriptor>): string[] => validateToolDescriptor({ ...base, ...patch } as ToolDescriptor, KNOWN);
    expect(errorsOf({ binding: { status: "unbound" } })).toEqual(expect.arrayContaining([expect.stringMatching(/bound-view-session|callable/)]));
    expect(errorsOf({ viewCommands: ["pcb.observe"] })).toEqual(expect.arrayContaining([expect.stringMatching(/observe/)]));
    expect(errorsOf({ viewCommands: [] })).toEqual(expect.arrayContaining([expect.stringMatching(/bus command ids/)]));
    expect(errorsOf({ viewCommands: ["nonsense"] })).toEqual(expect.arrayContaining([expect.stringMatching(/not an <editor>\.<name>/)]));
    expect(errorsOf({ sideEffects: "engineering-state" })).toEqual(expect.arrayContaining([expect.stringMatching(/session-state/)]));
    const read = registry.get("sirkit.pcb.board-inspect", "1.0.0")!;
    expect(validateToolDescriptor({ ...read, viewCommands: ["pcb.fit-board"] } as ToolDescriptor, KNOWN)).toEqual(expect.arrayContaining([expect.stringMatching(/only view-session tools/)]));
    const mutation = registry.get("sirkit.pcb.edit-track")!; // [B18-C I3] a mutation that is never granted (Tier 2)
    expect(validateToolDescriptor({ ...mutation, agentExposed: true } as ToolDescriptor, KNOWN)).toEqual(expect.arrayContaining([expect.stringMatching(/forbidden/)]));
    // The real catalog validates cleanly (the registry constructor would throw otherwise).
    expect(() => new ToolRegistry(SIRKIT_TOOL_CATALOG)).not.toThrow();
  });
});

describe("B17-F §3 — discovery is contextual", () => {
  it("3D tools need a pcb3d surface; layers/measure/reveal need a pcb surface; view tools need their surface; nothing view-related without any surface", () => {
    const full = includedIds(agentContext());
    for (const id of ["sirkit.view.pcb3d", "sirkit.view.layers", "sirkit.view.measure", "sirkit.view.reveal-finding", "sirkit.view.canvas-navigation", "sirkit.selection.control", "sirkit.view.read-state", "sirkit.project.history-inspect"]) expect(full, id).toContain(id);
    const no3d = includedIds(agentContext({ projectState: ["board-present", "schematic-present", "pcb-surface", "schematic-surface", "workspace-surface"] }));
    expect(no3d).not.toContain("sirkit.view.pcb3d");
    expect(no3d).toContain("sirkit.view.layers");
    const noPcb = includedIds(agentContext({ projectState: ["board-present", "schematic-present", "schematic-surface", "workspace-surface"] }));
    for (const id of ["sirkit.view.pcb3d", "sirkit.view.layers", "sirkit.view.measure", "sirkit.view.reveal-finding"]) expect(noPcb, id).not.toContain(id);
    expect(noPcb).toContain("sirkit.view.canvas-navigation"); // schematic + workspace navigation still exists
  });

  it("routing and placement proposals need a board; no proposal of any kind reaches a viewer, commenter or reviewer; a viewer keeps read + view tools", () => {
    const noBoard = includedIds(agentContext({ projectState: ["schematic-present", "schematic-surface", "workspace-surface"] }));
    expect(noBoard).not.toContain("sirkit.routing.propose");
    expect(noBoard).not.toContain("sirkit.placement.propose");
    expect(noBoard).not.toContain("sirkit.view.read-state"); // the read boundary needs the canonical board
    const proposalsFor = (role: "viewer" | "commenter" | "reviewer" | "pcb_editor"): string[] => includedIds(agentContext({ actorRole: role })).filter((id) => registry.list().find((item) => item.toolId === id)!.operationClass === "propose");
    // A viewer or commenter never sees a proposal of any kind but keeps reads and their own view.
    for (const role of ["viewer", "commenter"] as const) {
      expect(proposalsFor(role), role).toEqual([]);
      const ids = includedIds(agentContext({ actorRole: role }));
      expect(ids).toContain("sirkit.view.pcb3d");
      expect(ids).toContain("sirkit.pcb.board-inspect");
    }
    // A reviewer keeps the B14/B15.3 sealed proposals but never the layout candidates (pcb_editor / project_admin only).
    expect(proposalsFor("reviewer").filter((id) => id.startsWith("sirkit.placement") || id.startsWith("sirkit.routing"))).toEqual([]);
    const editor = includedIds(agentContext({ actorRole: "pcb_editor" }));
    expect(editor).toContain("sirkit.routing.propose");
    expect(editor).toContain("sirkit.placement.propose");
  });

  it("the whole intentional set fits the derived provider tool budget, with headroom", () => {
    const budget = Math.max(16, INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length + 4);
    expect(budget).toBeGreaterThan(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    const included = discoverTools(registry, agentContext({ providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 64, maxToolCount: budget } }));
    expect(included.excluded.filter((entry) => entry.reason === "provider_tool_count")).toEqual([]);
  });
});
