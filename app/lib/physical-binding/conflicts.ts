import type { BindingConflict, ComponentPhysicalBinding, PhysicalBindingScope } from "./types";

export function variantScopesOverlap(left: PhysicalBindingScope, right: PhysicalBindingScope): boolean {
  if (left.tenantId !== right.tenantId || left.projectId !== right.projectId || left.branchId !== right.branchId || left.boardInstanceId !== right.boardInstanceId || left.componentInstanceId !== right.componentInstanceId) return false;
  if (left.hierarchyPath.join("\0") !== right.hierarchyPath.join("\0")) return false;
  const leftVariants = new Set(left.assemblyVariantIds);
  return left.assemblyVariantIds.length === 0 || right.assemblyVariantIds.length === 0 || right.assemblyVariantIds.some((variant) => leftVariants.has(variant));
}

/** Pure cross-set check used by persistence/API consumers before activating a selection. */
export function detectSelectedVariantConflicts(binding: ComponentPhysicalBinding, selectedPeers: readonly ComponentPhysicalBinding[]): BindingConflict {
  const conflictIds = selectedPeers
    .filter((peer) => peer.revisionId !== binding.revisionId && peer.lifecycleState === "selected" && variantScopesOverlap(binding.scope, peer.scope))
    .map((peer) => peer.revisionId)
    .sort();
  return conflictIds.length ? { state: "present", conflictIds, reasonCodes: ["PB_OVERLAPPING_VARIANT_SELECTION"] } : { state: "none", conflictIds: [], reasonCodes: [] };
}
