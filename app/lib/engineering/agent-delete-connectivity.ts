import { kicadPinWorldPos, pinWorldPos } from "../geometry";
import { PIN_NAMES, type Point, type SchematicState } from "@/lib/schematic-types";
import type { KicadPin } from "../kicad/types";
import { resolveProjectConnectivity } from "../schematic/project-connectivity";
import { assertWholeProject, sheetOf } from "../schematic/sheets";
import type { SchematicDeleteImpactPlan } from "./schematic-plans";

/** OD-229: AI-only preflight. Compare canonical electrical partitions of
 * surviving pins, labels and retained wire vertices, not polyline counts.
 * Human deletion keeps its existing semantics; no automatic repair is made.
 *
 * [PR-J, 2026-10-22] Section J increment 2 (OD-255 item 2): both partitions are THE project connectivity authority's
 * (app/lib/schematic/project-connectivity.ts): a document without sheets compares exactly what it compared before (the authority's
 * union IS buildNetUnionFind; a removed part's own pins register no extra connection), a document with sheets compares its scoped
 * nets site by site ON EACH SITE'S SHEET, and a sheet-structure error before or after the deletion refuses it. */
export function agentDeleteConnectivityRefusal(
  state: SchematicState,
  plans: readonly SchematicDeleteImpactPlan[],
  pinsByPartId: ReadonlyMap<string, readonly KicadPin[]>,
): string | null {
  assertWholeProject(state, "agent-delete-connectivity");
  const removedWires = new Set(plans.flatMap((plan) => plan.removeWireIds));
  const removedLabels = new Set(plans.flatMap((plan) => plan.removeNetLabelIds));
  if (!removedWires.size && !removedLabels.size) return null;
  const removedTheory = new Set(plans.filter((plan) => plan.family === "theory").map((plan) => plan.componentId));
  const removedKicad = new Set(plans.filter((plan) => plan.family === "kicad").map((plan) => plan.componentId));
  const components = state.components.filter((item) => !removedTheory.has(item.id));
  const kicad = (state.kicadComponents ?? []).filter((item) => !removedKicad.has(item.id));
  const kicadSites: Array<{ sheetId: string; point: Point }> = [];
  for (const component of kicad) {
    const pins = pinsByPartId.get(component.partId);
    if (!pins?.length) return "AI deletion requires pin evidence for surviving KiCad components before removing wires or labels.";
    kicadSites.push(...pins.map((pin) => ({ sheetId: sheetOf(component), point: kicadPinWorldPos(component, pin) })));
  }
  const wires = state.wires.filter((wire) => !removedWires.has(wire.id));
  const labels = (state.netLabels ?? []).filter((label) => !removedLabels.has(label.id));
  const sites = [
    ...components.flatMap((component) => (PIN_NAMES[component.type] ?? []).map((pin) => ({ sheetId: sheetOf(component), point: pinWorldPos(component, pin) }))),
    ...kicadSites, ...labels.map((label) => ({ sheetId: sheetOf(label), point: label.position })), ...wires.flatMap((wire) => wire.vertices.map((point) => ({ sheetId: sheetOf(wire), point }))),
  ];
  const lookup = (partId: string): { pins: readonly KicadPin[] } | null => {
    const pins = pinsByPartId.get(partId);
    return pins ? { pins } : null;
  };
  const before = resolveProjectConnectivity(state, lookup);
  const after = resolveProjectConnectivity({ ...state, components, kicadComponents: kicad, wires, netLabels: labels }, lookup);
  if (!before.ok || !after.ok) {
    return "AI deletion cannot check connectivity on a schematic whose sheet structure has an error. No changes were proposed; fix the sheet structure first.";
  }
  const partitions = new Map<string, string>();
  for (const site of sites) {
    // every surviving site is registered in both unions (pins, labels and wire vertices all are)
    const oldRoot = before.rootAt(site.sheetId, site.point) ?? `\u0001site\u0000${site.sheetId}\u0000${site.point.x},${site.point.y}`;
    const newRoot = after.rootAt(site.sheetId, site.point) ?? `\u0001site\u0000${site.sheetId}\u0000${site.point.x},${site.point.y}`;
    const prior = partitions.get(oldRoot);
    if (prior !== undefined && prior !== newRoot) {
      return "AI deletion would disconnect surviving pins, labels or wires. No changes were proposed; edit the shared wiring explicitly first.";
    }
    partitions.set(oldRoot, newRoot);
  }
  return null;
}
