/**
 * B16.0.2 §F — the sealed `requiredApplyRole` is LOAD-BEARING.
 *
 * R7 closure: an explicit accepted-role mapping (no invented role ordering),
 * both the family-permitted list AND the sealed required role must admit the
 * live role, unknown roles fail closed, and tamper/downgrade tests cover all
 * three proposal families (tier-1, replacement, bounded PCB) through their
 * real evaluators + the B12 apply service with ZERO mutation on refusal.
 */

import { afterEach, describe, expect, it } from "vitest";
import { ACCEPTED_LIVE_ROLES_FOR_REQUIRED_APPLY_ROLE, acceptedLiveRolesFor, evaluateMembershipReauthorization, type MembershipReauthorization } from "../membership-reauthorization";
import { evaluatePcbApplyReauthorization } from "../pcb-apply-reauthorization";
import { buildAuthorizationBinding, isWellFormedAuthorizationBinding, SCHEMATIC_APPLY_ROLES } from "@/app/lib/engineering/proposal-authorization";
import { PCB_APPLY_ROLES, type SealedPcbEditProposal } from "@/app/lib/pcb/proposal/sealed-pcb-edit-proposal";
import type { ProjectRole } from "@/app/lib/engineering/types";
import type { SchematicState } from "@/lib/schematic-types";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "@/app/lib/engineering/approved-mutation-journal";
import { compileTier1Proposal } from "@/app/lib/engineering/schematic-plans";
import { sealTier1Proposal, verifySealedTier1Proposal, type SealedTier1Proposal } from "@/app/lib/engineering/schematic-proposals";
import { ApprovedMutationAuditLedger, ApprovedMutationRegistry, applyApprovedTier1Proposal } from "@/app/lib/engineering/approved-agent-mutations";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { resetInjectedIdentity } from "@/app/lib/auth/test-support";

const SCOPE = { tenantId: "local", projectId: "project-f", branchId: "main" };
const ALL_ROLES: ProjectRole[] = ["viewer", "commenter", "pcb_editor", "automation", "reviewer", "project_admin", "migration_admin"];

function live(role: ProjectRole, overrides: Partial<Extract<MembershipReauthorization, { ok: true }>> = {}): MembershipReauthorization {
  return { ok: true, principalId: "u", role, membershipRevision: "r", scope: { ...SCOPE }, ...overrides };
}
function binding(requiredApplyRole: ProjectRole) {
  return buildAuthorizationBinding({ principalId: "u", membershipRevision: "r", scope: { ...SCOPE }, requiredApplyRole });
}

afterEach(() => { resetInjectedIdentity(); });

describe("B16.0.2 §F — the explicit accepted-role mapping (gate-pinned)", () => {
  it("is EXACTLY {project_admin: [project_admin], pcb_editor: [pcb_editor, project_admin]} and frozen", () => {
    expect(Object.keys(ACCEPTED_LIVE_ROLES_FOR_REQUIRED_APPLY_ROLE).sort()).toEqual(["pcb_editor", "project_admin"]);
    expect([...acceptedLiveRolesFor("project_admin")]).toEqual(["project_admin"]);
    expect([...acceptedLiveRolesFor("pcb_editor")]).toEqual(["pcb_editor", "project_admin"]);
    expect(Object.isFrozen(ACCEPTED_LIVE_ROLES_FOR_REQUIRED_APPLY_ROLE)).toBe(true);
    for (const unknown of ["viewer", "commenter", "reviewer", "automation", "migration_admin", "admin", "owner", "", "PROJECT_ADMIN"]) {
      expect([...acceptedLiveRolesFor(unknown)], unknown).toEqual([]);
    }
  });

  it("R7: requiredApplyRole=project_admin accepts ONLY project_admin (a live pcb_editor is refused role-insufficient)", () => {
    for (const role of ALL_ROLES) {
      const denial = evaluateMembershipReauthorization(binding("project_admin"), live(role), SCHEMATIC_APPLY_ROLES);
      if (role === "project_admin") expect(denial, role).toBeNull();
      else { expect(denial?.code, role).toBe("role-insufficient"); }
    }
    expect(evaluateMembershipReauthorization(binding("project_admin"), live("pcb_editor"), SCHEMATIC_APPLY_ROLES)?.detail).toMatch(/required apply role \(project_admin\)/);
  });

  it("requiredApplyRole=pcb_editor accepts pcb_editor or project_admin and nothing else", () => {
    for (const role of ALL_ROLES) {
      const denial = evaluateMembershipReauthorization(binding("pcb_editor"), live(role), SCHEMATIC_APPLY_ROLES);
      if (role === "pcb_editor" || role === "project_admin") expect(denial, role).toBeNull();
      else expect(denial?.code, role).toBe("role-insufficient");
    }
  });

  it("BOTH gates must pass: a family list that omits the live role refuses even when the required-role mapping admits it, and vice versa", () => {
    // family list narrower than the mapping
    expect(evaluateMembershipReauthorization(binding("pcb_editor"), live("project_admin"), ["pcb_editor"])?.code).toBe("role-insufficient");
    // mapping narrower than the family list
    expect(evaluateMembershipReauthorization(binding("project_admin"), live("pcb_editor"), ["pcb_editor", "project_admin"])?.code).toBe("role-insufficient");
    // both admit
    expect(evaluateMembershipReauthorization(binding("project_admin"), live("project_admin"), ["pcb_editor", "project_admin"])).toBeNull();
  });

  it("an UNKNOWN sealed required role fails closed for EVERY live role (required-role-unknown), before the family check", () => {
    const tampered = { ...binding("pcb_editor"), requiredApplyRole: "migration_admin" as ProjectRole };
    for (const role of ALL_ROLES) expect(evaluateMembershipReauthorization(tampered, live(role), ALL_ROLES)?.code, role).toBe("required-role-unknown");
    const garbage = { ...binding("pcb_editor"), requiredApplyRole: "owner" as ProjectRole };
    expect(evaluateMembershipReauthorization(garbage, live("project_admin"), ALL_ROLES)?.code).toBe("required-role-unknown");
  });

  it("the earlier checks keep their precedence: unavailable → principal → scope → required-role → family/role → revision", () => {
    expect(evaluateMembershipReauthorization(binding("project_admin"), { ok: false, code: "http-401", detail: "out" }, SCHEMATIC_APPLY_ROLES)?.code).toBe("membership-unavailable");
    expect(evaluateMembershipReauthorization(binding("project_admin"), live("pcb_editor", { principalId: "other" }), SCHEMATIC_APPLY_ROLES)?.code).toBe("principal-changed");
    expect(evaluateMembershipReauthorization(binding("project_admin"), live("pcb_editor", { scope: { ...SCOPE, branchId: "dev" } }), SCHEMATIC_APPLY_ROLES)?.code).toBe("scope-changed");
    expect(evaluateMembershipReauthorization(binding("project_admin"), live("project_admin", { membershipRevision: "moved" }), SCHEMATIC_APPLY_ROLES)?.code).toBe("membership-changed");
  });
});

describe("B16.0.2 §F — all three proposal families", () => {
  it("SCHEMATIC families (tier-1 + replacement share the binding): a project_admin-required binding is well-formed and refuses a live pcb_editor", () => {
    const adminOnly = binding("project_admin");
    expect(isWellFormedAuthorizationBinding(adminOnly)).toBe(true);
    expect(evaluateMembershipReauthorization(adminOnly, live("pcb_editor"), SCHEMATIC_APPLY_ROLES)?.code).toBe("role-insufficient");
    expect(evaluateMembershipReauthorization(adminOnly, live("project_admin"), SCHEMATIC_APPLY_ROLES)).toBeNull();
    // tamper: a role outside the family's apply roles cannot even be sealed
    expect(isWellFormedAuthorizationBinding({ ...adminOnly, requiredApplyRole: "reviewer" })).toBe(false);
    expect(isWellFormedAuthorizationBinding({ ...adminOnly, requiredApplyRole: "migration_admin" })).toBe(false);
  });

  it("BOUNDED PCB family: evaluatePcbApplyReauthorization honours the sealed required role (admin-only refuses pcb_editor; pcb_editor-required admits both)", () => {
    const pcbProposal = (requiredApplyRole: ProjectRole) => ({
      authorizationBinding: { authorizationSchema: "sirkit.pcb-proposal-authorization.v1", principalId: "u", membershipRevision: "r", ...SCOPE, requiredApplyRole },
    } as unknown as SealedPcbEditProposal);
    expect(PCB_APPLY_ROLES).toEqual(["pcb_editor", "project_admin"]);
    expect(evaluatePcbApplyReauthorization(pcbProposal("project_admin"), live("pcb_editor"))?.code).toBe("role-insufficient");
    expect(evaluatePcbApplyReauthorization(pcbProposal("project_admin"), live("project_admin"))).toBeNull();
    expect(evaluatePcbApplyReauthorization(pcbProposal("pcb_editor"), live("pcb_editor"))).toBeNull();
    expect(evaluatePcbApplyReauthorization(pcbProposal("pcb_editor"), live("project_admin"))).toBeNull();
    expect(evaluatePcbApplyReauthorization(pcbProposal("pcb_editor"), live("reviewer"))?.code).toBe("role-insufficient");
    expect(evaluatePcbApplyReauthorization(pcbProposal("owner" as ProjectRole), live("project_admin"))?.code).toBe("required-role-unknown");
  });

  it("TIER-1 end-to-end through the REAL apply service: an admin-required sealed proposal is refused for a live pcb_editor with ZERO mutation, and applies for a live project_admin", async () => {
    const state: SchematicState = { components: [{ id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" }], wires: [] };
    async function production(liveRole: ProjectRole) {
      const store = new InMemoryAtomicProjectStore();
      const editor = new SchematicEditorSession({ ...SCOPE }, { store });
      await editor.openForProject(structuredClone(state), null);
      let visible = structuredClone(state);
      const coordinator = new SchematicGestureCoordinator({
        currentState: () => structuredClone(visible),
        applyPreviewFrame: () => {},
        applyCanonicalProjection: (_label, next) => { visible = structuredClone(next); coordinator.notifyAuthoritativeProjection(next); },
        applyRollbackProjection: (s) => { visible = structuredClone(s); },
        execute: (base, request) => editor.execute(base, request),
        notify: () => {},
      });
      const sealed = sealTier1Proposal({
        state: structuredClone(state),
        compilation: compileTier1Proposal(state, { ops: [{ op: "set-value", target: "R1", value: "4k7" }], pinsByPartId: new Map() }),
        provenance: { provider: "anthropic", note: "", instruction: "x" },
        now: Date.now(),
        scope: { ...SCOPE, headMark: editor.headMark()! },
        authorization: binding("project_admin"),
      });
      if (sealed.kind !== "sealed") throw new Error("seal blocked");
      const proposal: SealedTier1Proposal = sealed.proposal;
      expect(verifySealedTier1Proposal(proposal, { currentSchematicDigest: schematicStateDigest(state), expectedScope: { ...SCOPE, headMark: editor.headMark()! }, now: Date.now() }).ok).toBe(true);
      const outcome = await applyApprovedTier1Proposal({
        proposal, session: editor, gateway: coordinator, interlock: new ProjectCommitInterlock(),
        journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), { ...SCOPE }),
        reauthorize: async () => live(liveRole),
        stillCurrent: () => true, currentProjectId: SCOPE.projectId, currentBranchId: "main", originRunId: null,
        registry: new ApprovedMutationRegistry(), audit: new ApprovedMutationAuditLedger(),
      });
      const head = (await store.load(SCOPE.projectId, "main"))?.snapshotRevision.headSequence ?? -1;
      return { outcome, head, value: visible.components[0]?.value };
    }
    const editor = await production("pcb_editor");
    expect(editor.outcome.ok).toBe(false);
    if (!editor.outcome.ok) expect(editor.outcome.code).toBe("reauthorization-role-insufficient");
    expect(editor.head).toBe(0);
    expect(editor.value).toBe("1k");
    const admin = await production("project_admin");
    expect(admin.outcome.ok && admin.outcome.status === "committed").toBe(true);
    expect(admin.head).toBe(1);
    expect(admin.value).toBe("4k7");
  });
});
