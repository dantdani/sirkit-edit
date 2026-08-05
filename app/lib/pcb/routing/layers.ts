import type { EffectiveConstraintRule } from "@/app/lib/constraints/types";
import type { LayerId } from "../layers";
import { getBoardStackup, routableCopperLayers } from "../stackup";
import type { PcbBoard } from "../types";
import { routingStableId } from "./stable";
import type { ViaTransitionChoice } from "./types";

const copper = (value: string): LayerId | undefined => {
  const layer = value.replace(/^layer:/, "") as LayerId;
  return ["copperTop", "in1", "in2", "copperBottom"].includes(layer) ? layer : undefined;
};

function values(rule: EffectiveConstraintRule): string[] {
  if (rule.requirement.form === "allowed_set" || rule.requirement.form === "forbidden_set" || rule.requirement.form === "required_set") return rule.requirement.values.map(String);
  if (rule.requirement.form === "equals") return [String(rule.requirement.value)];
  return [];
}

function netRules(board: PcbBoard, netId: number): EffectiveConstraintRule[] {
  const stableNetId = board.nets.find((net) => net.id === netId)?.stableId;
  if (!stableNetId) return [];
  return (board.constraintState?.activeProgram?.effectiveRules ?? []).filter((rule) => rule.targetId === stableNetId || rule.targetId === `net:${stableNetId}`);
}

export function allowedSignalLayers(board: PcbBoard, netId: number): { layers: LayerId[]; constraintIds: string[]; unsupported: string[] } {
  const physical = routableCopperLayers(board).map((layer) => layer.id);
  let allowed = [...physical];
  const constraintIds: string[] = [];
  const unsupported: string[] = [];
  for (const rule of netRules(board, netId)) {
    if (rule.kind === "allowed_layers") {
      constraintIds.push(...rule.contributingConstraintIds);
      const set = values(rule).map(copper).filter((layer): layer is LayerId => layer !== undefined);
      if (set.length === 0 && rule.strength === "hard") unsupported.push(...rule.contributingConstraintIds);
      else allowed = allowed.filter((layer) => set.includes(layer));
    }
    if (rule.kind === "forbidden_layers") {
      constraintIds.push(...rule.contributingConstraintIds);
      const set = new Set(values(rule).map(copper).filter((layer): layer is LayerId => layer !== undefined));
      allowed = allowed.filter((layer) => !set.has(layer));
    }
  }
  return { layers: [...new Set(allowed)].sort((a, b) => physical.indexOf(a) - physical.indexOf(b)), constraintIds: [...new Set(constraintIds)].sort(), unsupported: [...new Set(unsupported)].sort() };
}

/** Current manufacturing boundary: one physical through-via spans outer copper and contacts every enabled copper layer. */
export function legalViaTransitions(board: PcbBoard, netId: number, fromLayer: LayerId): ViaTransitionChoice[] {
  const stackup = getBoardStackup(board);
  const enabled = stackup.copperLayers.filter((layer) => layer.enabled).sort((a, b) => a.order - b.order);
  const signal = allowedSignalLayers(board, netId);
  const throughSupported = stackup.routing.viasAllowed;
  const outer: [LayerId, LayerId] = [enabled[0]?.id ?? "copperTop", enabled.at(-1)?.id ?? "copperBottom"];
  const rules = netRules(board, netId);
  const viaTypeRules = rules.filter((rule) => rule.kind === "via_type");
  const viaTypeSupported = viaTypeRules.every((rule) => values(rule).some((value) => ["through", "through-via", "thru"].includes(value.toLowerCase())) || rule.strength !== "hard");
  if (!enabled.some((layer) => layer.id === fromLayer)) return [];
  return signal.layers.filter((layer) => layer !== fromLayer).map((targetLayer) => {
    const legal = throughSupported && viaTypeSupported && signal.unsupported.length === 0;
    const constraintIds = [...new Set([...signal.constraintIds, ...viaTypeRules.flatMap((rule) => rule.contributingConstraintIds)])].sort();
    return {
      choiceId: routingStableId("via-transition", { netId, fromLayer, targetLayer, span: outer, constraints: constraintIds }),
      fromLayer,
      targetLayer,
      viaType: "through" as const,
      physicalSpan: outer,
      connectedLayers: enabled.map((layer) => layer.id),
      legal,
      constraintIds,
      explanation: legal
        ? `Through-via spans ${enabled.map((layer) => layer.name).join(" → ")} and continues routing on ${enabled.find((layer) => layer.id === targetLayer)?.name ?? targetLayer}.`
        : "No supported through-via transition satisfies the active manufacturing and hard layer/via rules.",
    };
  }).sort((a, b) => {
    const from = enabled.find((layer) => layer.id === fromLayer)?.order ?? 0;
    const da = Math.abs((enabled.find((layer) => layer.id === a.targetLayer)?.order ?? 0) - from);
    const db = Math.abs((enabled.find((layer) => layer.id === b.targetLayer)?.order ?? 0) - from);
    return da - db || (enabled.find((layer) => layer.id === a.targetLayer)?.order ?? 0) - (enabled.find((layer) => layer.id === b.targetLayer)?.order ?? 0) || a.choiceId.localeCompare(b.choiceId);
  });
}

export function defaultViaTransition(board: PcbBoard, netId: number, fromLayer: LayerId): ViaTransitionChoice | undefined {
  return legalViaTransitions(board, netId, fromLayer).find((choice) => choice.legal);
}
