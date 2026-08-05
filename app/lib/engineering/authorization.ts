import type { EngineeringActor, EngineeringCapability, EngineeringOperation, ProjectRole } from "./types";

const ROLE_CAPABILITIES: Record<ProjectRole, readonly EngineeringCapability[]> = {
  viewer: ["read_project", "export_project"],
  commenter: ["read_project", "export_project"],
  pcb_editor: ["read_project", "edit_placement", "edit_copper", "edit_zones", "run_automation", "export_project"],
  automation: ["read_project", "run_automation", "edit_placement", "edit_copper", "edit_zones"],
  reviewer: ["read_project", "approve_proposal", "export_project"],
  project_admin: ["read_project", "edit_placement", "edit_copper", "edit_zones", "edit_stackup_outline", "edit_constraints", "edit_components", "manage_protection", "run_automation", "approve_proposal", "restore_project", "export_project"],
  migration_admin: ["read_project", "migrate_project", "restore_project", "export_project"],
};

export function requiredCapability(operation: EngineeringOperation): EngineeringCapability {
  if (operation.kind === "move_footprint") return "edit_placement";
  if (operation.kind === "set_footprint_protection") return "manage_protection";
  if (operation.kind === "add_track" || operation.kind === "update_track" || operation.kind === "remove_track" || operation.kind === "add_via" || operation.kind === "update_via" || operation.kind === "remove_via") return "edit_copper";
  if (operation.kind === "add_zone" || operation.kind === "update_zone" || operation.kind === "remove_zone") return "edit_zones";
  if (operation.kind === "update_board_outline") return "edit_stackup_outline";
  if (operation.kind === "pin_asset" || operation.kind === "remove_pinned_asset") return "edit_components";
  return "edit_constraints";
}

export function actorCapabilities(actor: EngineeringActor, now = new Date()): Set<EngineeringCapability> {
  const base = new Set(ROLE_CAPABILITIES[actor.role]);
  if (actor.delegatedCapabilities) {
    if (!actor.delegationExpiresAt || Date.parse(actor.delegationExpiresAt) <= now.getTime()) return new Set(["read_project"]);
    return new Set([...base].filter((capability) => actor.delegatedCapabilities!.includes(capability)));
  }
  return base;
}

export function authorizeOperations(actor: EngineeringActor, operations: readonly EngineeringOperation[], now = new Date()): { allowed: boolean; capability?: EngineeringCapability; reason: string } {
  const capabilities = actorCapabilities(actor, now);
  for (const operation of operations) {
    const capability = requiredCapability(operation);
    if (!capabilities.has(capability)) return { allowed: false, capability, reason: `Actor ${actor.actorId} lacks ${capability}.` };
    if (actor.actorKind === "ai" && (capability === "manage_protection" || capability === "edit_stackup_outline" || capability === "edit_components")) return { allowed: false, capability, reason: "AI delegation cannot directly change protection, stackup/outline, or pinned assets." };
  }
  return { allowed: true, reason: "All operation capabilities are authorized." };
}
