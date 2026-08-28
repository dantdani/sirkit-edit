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
  // B06: schematic semantic mutations require edit_components — which the
  // AI-delegation rule below categorically refuses for ai actors.
  if (operation.kind.startsWith("schematic_")) return "edit_components";
  if (operation.kind === "move_footprint") return "edit_placement";
  // B08 — protection changes (footprint AND copper/zone) are their own
  // capability; a generic edit capability can never flip locked state.
  if (operation.kind === "set_footprint_protection" || operation.kind === "set_copper_protection") return "manage_protection";
  if (operation.kind === "add_track" || operation.kind === "update_track" || operation.kind === "remove_track" || operation.kind === "add_via" || operation.kind === "update_via" || operation.kind === "remove_via") return "edit_copper";
  // B08 — padstacks define via geometry; routing history accompanies copper
  // commits: both are copper-editing authority.
  if (operation.kind === "add_padstack" || operation.kind === "update_padstack" || operation.kind === "remove_padstack" || operation.kind === "update_routing_history") return "edit_copper";
  if (operation.kind === "add_zone" || operation.kind === "update_zone" || operation.kind === "remove_zone") return "edit_zones";
  if (operation.kind === "update_board_outline" || operation.kind === "update_stackup") return "edit_stackup_outline";
  // B08 — annotation/documentation placement (board text, silkscreen,
  // dimension annotations) is ordinary editor placement authority.
  if (operation.kind === "add_text" || operation.kind === "update_text" || operation.kind === "remove_text") return "edit_placement";
  if (operation.kind === "add_silk" || operation.kind === "update_silk" || operation.kind === "remove_silk") return "edit_placement";
  if (operation.kind === "add_dimension" || operation.kind === "update_dimension" || operation.kind === "remove_dimension") return "edit_placement";
  if (operation.kind === "update_placement_settings") return "edit_placement";
  // B08 — keepouts, net-class rules, and the typed constraint program are
  // constraint authority.
  if (operation.kind === "add_keepout" || operation.kind === "update_keepout" || operation.kind === "remove_keepout") return "edit_constraints";
  if (operation.kind === "update_net_classing" || operation.kind === "update_constraint_state") return "edit_constraints";
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
