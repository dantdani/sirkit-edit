/**
 * [B18-A] Permission tiers are a MAPPING onto the registry's existing approval
 * vocabulary; the autonomy setting defaults to proposal-only and only a
 * project administrator may change it; the execution decision is pure and
 * fail-closed (Tier 3 never, Tier 2 proposal-only, Tier 1 preview unless the
 * project opted in AND the operation is the exact user-requested one, Tier 0
 * direct for readers).
 */
import { describe, expect, it } from "vitest";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { sirkitToolRegistry } from "../tool-catalog";
import {
  AUTONOMY_MODES, AUTONOMY_WRITE_ROLES, PERMISSION_TIERS, TIER1_EXECUTE_ROLES, TIER3_FAMILY_PATTERN,
  canChangeAutonomy, decideAgentExecution, defaultAutonomySetting, isAutonomyMode, permissionTierOfAction, permissionTierOfApproval, permissionTierOfDescriptor,
  type AgentAutonomySetting,
} from "../permission-tiers";

const registry = sirkitToolRegistry();
const tierOf = (toolId: string) => permissionTierOfDescriptor(registry.list().find((item) => item.toolId === toolId)!);
const actionTier = (id: string) => permissionTierOfAction(ACTION_COVERAGE_REGISTRY.find((item) => item.id === id)!);

describe("B18-A §1 — tiers map onto the existing approval vocabulary", () => {
  it("every registered tool and every action record maps to exactly one tier; the mapping is total over the vocabulary", () => {
    for (const descriptor of registry.list()) expect(PERMISSION_TIERS, descriptor.toolId).toContain(permissionTierOfDescriptor(descriptor));
    for (const record of ACTION_COVERAGE_REGISTRY) expect(PERMISSION_TIERS, record.id).toContain(permissionTierOfAction(record));
    for (const approval of ["none", "reversible", "topology-or-geometry", "destructive", "release"] as const) {
      for (const kind of ["read", "propose", "mutate", "destructive", "release", "view-session"] as const) expect(PERMISSION_TIERS).toContain(permissionTierOfApproval(approval, kind));
    }
  });

  it("Tier 0 = every exposed read and view-session tool; Tier 1 = reversible mutations and exact undo/redo; Tier 2 = topology/geometry/destructive and every proposal path; Tier 3 = release and the release families", () => {
    for (const descriptor of registry.list().filter((item) => item.agentExposed && (item.operationClass === "read" || item.operationClass === "view-session"))) expect(tierOf(descriptor.toolId), descriptor.toolId).toBe(0);
    for (const descriptor of registry.list().filter((item) => item.agentExposed && item.operationClass === "propose")) expect(tierOf(descriptor.toolId), descriptor.toolId).toBe(2);
    expect(tierOf("sirkit.pcb.move-footprint")).toBe(1);
    expect(tierOf("sirkit.pcb.rotate-side-footprint")).toBe(1);
    expect(tierOf("sirkit.pcb.arrange")).toBe(1);
    expect(tierOf("sirkit.pcb.undo-redo-canonical")).toBe(1);
    expect(tierOf("sirkit.pcb.edit-track")).toBe(2);
    expect(tierOf("sirkit.pcb.delete-item")).toBe(2);
    expect(tierOf("sirkit.pcb.create-via")).toBe(2);
    expect(tierOf("sirkit.pcb.zone-edit")).toBe(2);
    expect(tierOf("sirkit.pcb.dimension")).toBe(2);
    expect(tierOf("sirkit.schematic.add-component")).toBe(2);
    expect(tierOf("sirkit.manufacturing.release")).toBe(3);
    expect(actionTier("manufacturing.release")).toBe(3);
    expect(actionTier("manufacturing.export-engineering")).toBe(3);
    expect(actionTier("cd.release-engineering.workbench")).toBe(3); // the family floor, whatever the record says
    expect(actionTier("schematic.set-property")).toBe(1);
    expect(actionTier("schematic.move-rotate")).toBe(1);
    expect(actionTier("pcb.silkscreen-text")).toBe(1);
    expect(actionTier("project.undo-redo")).toBe(1);
    expect(actionTier("schematic.connect")).toBe(2);
    expect(actionTier("schematic.delete-component")).toBe(2);
    expect(actionTier("schematic.replace-component")).toBe(2);
    expect(actionTier("pcb.route-copper")).toBe(2);
    expect(actionTier("pcb.dimension")).toBe(2);
    expect(actionTier("view.canvas-navigation")).toBe(0);
    for (const id of ["manufacturing.release", "sirkit.manufacturing.release", "bom.order", "publish-authority", "external.upload", "purchase"]) expect(TIER3_FAMILY_PATTERN.test(id), id).toBe(true);
  });
});

describe("B18-A §2 — the autonomy setting", () => {
  it("defaults to proposal-only at revision 0 with no author; only a project administrator may change it; modes are a closed pair", () => {
    const setting = defaultAutonomySetting({ tenantId: "local", projectId: "p" });
    expect(setting).toEqual({ schema: "sirkit.agent-autonomy-setting.v1", tenantId: "local", projectId: "p", mode: "proposal_only", revision: 0, updatedAt: null, updatedBy: null });
    expect([...AUTONOMY_MODES]).toEqual(["proposal_only", "execute_explicit_tier1"]);
    expect(isAutonomyMode("execute_explicit_tier1")).toBe(true);
    expect(isAutonomyMode("execute_everything")).toBe(false);
    expect([...AUTONOMY_WRITE_ROLES]).toEqual(["project_admin"]);
    for (const role of ["viewer", "commenter", "pcb_editor", "reviewer"] as const) expect(canChangeAutonomy(role), role).toBe(false);
    expect(canChangeAutonomy("project_admin")).toBe(true);
  });
});

describe("B18-A §3 — the execution decision is pure and fail-closed", () => {
  const optIn: AgentAutonomySetting = { ...defaultAutonomySetting({ tenantId: "local", projectId: "p" }), mode: "execute_explicit_tier1", revision: 1, updatedAt: "2026-09-10T12:00:00.000Z", updatedBy: { principalId: "admin", membershipRevision: "m1", role: "project_admin" } };

  it("Tier 3 is never executable and Tier 2 is proposal-only, whatever the mode, role or explicitness", () => {
    for (const setting of [null, optIn]) {
      for (const actorRole of ["viewer", "pcb_editor", "project_admin"] as const) {
        for (const explicitUserRequest of [true, false]) {
          expect(decideAgentExecution({ tier: 3, setting, actorRole, explicitUserRequest })).toMatchObject({ decision: "never", requiresGrant: false, requiresHumanApproval: false });
          expect(decideAgentExecution({ tier: 2, setting, actorRole, explicitUserRequest })).toMatchObject({ decision: "proposal_only", requiresGrant: false, requiresHumanApproval: true });
        }
      }
    }
  });

  it("Tier 1 previews by default; executes only with the project opt-in AND a proven exact user request, always under a grant; never for a viewer/commenter/reviewer", () => {
    expect(decideAgentExecution({ tier: 1, setting: null, actorRole: "pcb_editor", explicitUserRequest: true })).toMatchObject({ decision: "preview_then_confirm", requiresGrant: true, requiresHumanApproval: true });
    expect(decideAgentExecution({ tier: 1, setting: optIn, actorRole: "pcb_editor", explicitUserRequest: false })).toMatchObject({ decision: "preview_then_confirm", requiresGrant: true, requiresHumanApproval: true });
    expect(decideAgentExecution({ tier: 1, setting: optIn, actorRole: "project_admin", explicitUserRequest: true })).toMatchObject({ decision: "execute_explicit", requiresGrant: true, requiresHumanApproval: false });
    for (const actorRole of ["viewer", "commenter", "reviewer"] as const) {
      expect(decideAgentExecution({ tier: 1, setting: optIn, actorRole, explicitUserRequest: true })).toMatchObject({ decision: "never" });
    }
    expect([...TIER1_EXECUTE_ROLES]).toEqual(["pcb_editor", "project_admin"]);
  });

  it("Tier 0 executes directly for every project reader, with no grant and no approval", () => {
    for (const actorRole of ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"] as const) {
      expect(decideAgentExecution({ tier: 0, setting: null, actorRole, explicitUserRequest: false })).toMatchObject({ decision: "execute_direct", requiresGrant: false, requiresHumanApproval: false });
    }
  });
});
