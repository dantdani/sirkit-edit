import { legacyFootprintAssignmentView } from "./legacy";
import { evaluatePhysicalReadiness } from "./readiness";
import type { ComponentPhysicalBinding, ShadowBindingComparison } from "./types";

export const PHYSICAL_BINDING_SHADOW_FLAG = "SIRKIT_PHYSICAL_BINDING_SHADOW" as const;

/** Read-only comparison. The production callback runs exactly once and its result is returned unchanged. */
export async function withPhysicalBindingShadow<T>(input: {
  production: () => Promise<T>;
  binding: ComponentPhysicalBinding;
  effectiveSelectedRevisionId?: string;
  legacyFootprint: string | null;
  assessedAt: string;
  enabled: boolean;
  observe?: (comparison: ShadowBindingComparison) => void;
}): Promise<T> {
  const result = await input.production();
  if (!input.enabled) return result;
  const view = legacyFootprintAssignmentView(input.binding);
  const assessment = evaluatePhysicalReadiness(input.binding, { assessedAt: input.assessedAt, effectiveSelectedRevisionId: input.effectiveSelectedRevisionId });
  const agreement = input.legacyFootprint === null && view.footprint === null ? "both_unresolved" : input.legacyFootprint === view.footprint ? "same" : "different";
  input.observe?.({
    schemaVersion: "sirkit.physical-binding-shadow.v1",
    productionBehaviorChanged: false,
    componentInstanceId: input.binding.scope.componentInstanceId,
    legacyFootprint: input.legacyFootprint,
    shadowFootprint: view.footprint,
    agreement,
    assessment,
    diagnostics: agreement === "different" ? ["PB_SHADOW_LEGACY_DISAGREEMENT"] : [],
  });
  return result;
}

export function physicalBindingShadowEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment[PHYSICAL_BINDING_SHADOW_FLAG]?.trim().toLowerCase() === "true";
}
