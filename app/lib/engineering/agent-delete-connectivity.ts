import { buildNetUnionFind } from "../connectivity";
import { kicadPinWorldPos, pinWorldPos, pointKey } from "../geometry";
import { PIN_NAMES, type Point, type SchematicState } from "@/lib/schematic-types";
import type { KicadPin } from "../kicad/types";
import type { SchematicDeleteImpactPlan } from "./schematic-plans";

/** OD-229: AI-only preflight. Compare canonical electrical partitions of
 * surviving pins, labels and retained wire vertices, not polyline counts.
 * Human deletion keeps its existing semantics; no automatic repair is made. */
export function agentDeleteConnectivityRefusal(
  state: SchematicState,
  plans: readonly SchematicDeleteImpactPlan[],
  pinsByPartId: ReadonlyMap<string, readonly KicadPin[]>,
): string | null {
  const removedWires = new Set(plans.flatMap((plan) => plan.removeWireIds));
  const removedLabels = new Set(plans.flatMap((plan) => plan.removeNetLabelIds));
  if (!removedWires.size && !removedLabels.size) return null;
  const removedTheory = new Set(plans.filter((plan) => plan.family === "theory").map((plan) => plan.componentId));
  const removedKicad = new Set(plans.filter((plan) => plan.family === "kicad").map((plan) => plan.componentId));
  const components = state.components.filter((item) => !removedTheory.has(item.id));
  const kicad = (state.kicadComponents ?? []).filter((item) => !removedKicad.has(item.id));
  const kicadSites: Point[] = [];
  for (const component of kicad) {
    const pins = pinsByPartId.get(component.partId);
    if (!pins?.length) return "AI deletion requires pin evidence for surviving KiCad components before removing wires or labels.";
    kicadSites.push(...pins.map((pin) => kicadPinWorldPos(component, pin)));
  }
  const wires = state.wires.filter((wire) => !removedWires.has(wire.id));
  const labels = (state.netLabels ?? []).filter((label) => !removedLabels.has(label.id));
  const sites = [
    ...components.flatMap((component) => (PIN_NAMES[component.type] ?? []).map((pin) => pinWorldPos(component, pin))),
    ...kicadSites, ...labels.map((label) => label.position), ...wires.flatMap((wire) => wire.vertices),
  ];
  const before = buildNetUnionFind(state.components, state.wires, kicadSites, state.netLabels ?? []);
  const after = buildNetUnionFind(components, wires, kicadSites, labels);
  const partitions = new Map<string, string>();
  for (const site of sites) {
    const key = pointKey(site), oldRoot = before.find(key), newRoot = after.find(key);
    const prior = partitions.get(oldRoot);
    if (prior !== undefined && prior !== newRoot) {
      return "AI deletion would disconnect surviving pins, labels or wires. No changes were proposed; edit the shared wiring explicitly first.";
    }
    partitions.set(oldRoot, newRoot);
  }
  return null;
}
