import type { Track, Via } from "../types";
import type { RouteRequest } from "./types";

export type RouteCopperObject = Track | Via;
export type CopperMutationClass = "locked" | "imported_preserve" | "manual_preserve" | "unknown_preserve" | "generated" | "selected_manual";

export function classifyCopperMutation(object: RouteCopperObject, request: Pick<RouteRequest, "mutationScope" | "preservePolicy">): CopperMutationClass {
  if (object.locked) return "locked";
  if (object.source === "imported") return "imported_preserve";
  const selected = request.mutationScope.objectIds.includes(`track:${object.id}`) || request.mutationScope.objectIds.includes(`via:${object.id}`) || request.mutationScope.objectIds.includes(object.id);
  if (object.source === "human") return selected && request.preservePolicy === "selected_manual_movable" ? "selected_manual" : "manual_preserve";
  if (object.source === undefined) return "unknown_preserve";
  return "generated";
}

export function canMutateCopper(object: RouteCopperObject, request: Pick<RouteRequest, "mutationScope" | "preservePolicy">): { allowed: boolean; classification: CopperMutationClass; reason: string } {
  const classification = classifyCopperMutation(object, request);
  const inScope = request.mutationScope.kind === "selected_net" || request.mutationScope.objectIds.some((id) => id === object.id || id.endsWith(`:${object.id}`));
  if (classification === "locked") return { allowed: false, classification, reason: "Locked copper is immutable." };
  if (classification === "imported_preserve") return { allowed: false, classification, reason: "Imported copper is preserved unless separately unlocked and migrated." };
  if (classification === "manual_preserve") return { allowed: false, classification, reason: "Manual copper is outside explicit movable scope." };
  if (classification === "unknown_preserve") return { allowed: false, classification, reason: "Unknown-provenance copper is preserved until classified." };
  if (classification === "selected_manual") return { allowed: true, classification, reason: "Manual copper was explicitly selected under the movable-manual policy." };
  return { allowed: inScope, classification, reason: inScope ? "Generated copper is inside the explicit mutation scope." : "Generated copper is outside the explicit mutation scope." };
}
