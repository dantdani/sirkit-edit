/**
 * Inverse of autoLayoutBuild: serialize the current Build-mode schematic geometry
 * back into a BuildLogicalNetlist, so the topology editor can hand Claude the
 * circuit's *intent* (components + connections) rather than pixels.
 *
 * Connections are derived from the ACTUAL electrical net partition (the same
 * coordinate-coincidence union-find SPICE/validation use), so this stays correct
 * even after manual edits:
 *   - a net carrying a NetLabel  → label connections (its name + kind)
 *   - a net touching ground      → "GND" ground labels
 *   - an unnamed 2-pin net       → a wire connection
 *   - an unnamed 3+-pin net      → labels under a generated NETn name
 * The ground symbol itself is dropped (re-layout recreates it from GND labels).
 */

import type {
  BuildLogicalNetlist,
  BuildLogicalComponent,
  BuildLogicalConnection,
  NetLabelKind,
  SchematicState,
  Point,
} from "./schematic-types";
import { normalizeComponentRole, inferNetLabelKind } from "./schematic-types";
import type { CachedPart } from "@/app/lib/parts-cache";
import { buildNetUnionFind } from "@/app/lib/connectivity";
import { kicadPinWorldPos, pinWorldPos, pointKey } from "@/app/lib/geometry";

type Pin = { refDes: string; number: string; point: Point };

export function schematicToBuildNetlist(
  state: SchematicState,
  parts: Map<string, CachedPart>,
): BuildLogicalNetlist {
  const kicad = state.kicadComponents ?? [];
  const netLabels = state.netLabels ?? [];

  const components: BuildLogicalComponent[] = kicad.map((inst) => {
    const part = parts.get(inst.partId);
    return {
      refDes: inst.refDes,
      partId: inst.partId,
      value: inst.value,
      role: normalizeComponentRole(undefined, inst.refDes, part?.pins.length ?? 0),
    };
  });

  // Real (KiCad) pins + their world positions.
  const pins: Pin[] = [];
  const kicadPinPoints: Point[] = [];
  for (const inst of kicad) {
    const part = parts.get(inst.partId);
    if (!part) continue;
    for (const p of part.pins) {
      const point = kicadPinWorldPos(inst, p);
      pins.push({ refDes: inst.refDes, number: p.number, point });
      kicadPinPoints.push(point);
    }
  }

  const uf = buildNetUnionFind(state.components, state.wires, kicadPinPoints, netLabels);

  // Which net roots carry a label, and which are ground.
  const labelByRoot = new Map<string, { name: string; kind: NetLabelKind }>();
  for (const l of netLabels) {
    const k = pointKey(l.position);
    if (uf.has(k) && !labelByRoot.has(uf.find(k))) {
      labelByRoot.set(uf.find(k), { name: l.name, kind: l.kind });
    }
  }
  const groundRoots = new Set<string>();
  for (const c of state.components) {
    if (c.type !== "ground") continue;
    const k = pointKey(pinWorldPos(c, "pin"));
    if (uf.has(k)) groundRoots.add(uf.find(k));
  }

  // Group KiCad pins by net root.
  const pinsByRoot = new Map<string, Pin[]>();
  for (const pin of pins) {
    const k = pointKey(pin.point);
    if (!uf.has(k)) continue;
    const root = uf.find(k);
    const list = pinsByRoot.get(root);
    if (list) list.push(pin);
    else pinsByRoot.set(root, [pin]);
  }

  const connections: BuildLogicalConnection[] = [];
  let netCounter = 0;
  const ref = (p: Pin) => `${p.refDes}.${p.number}`;

  for (const [root, group] of pinsByRoot) {
    if (group.length === 0) continue;
    const label = labelByRoot.get(root);

    if (groundRoots.has(root)) {
      for (const p of group) connections.push({ kind: "label", pin: ref(p), labelName: "GND", labelKind: "ground" });
    } else if (label) {
      const kind = label.kind ?? inferNetLabelKind(label.name);
      const name = label.name.toUpperCase();
      for (const p of group) connections.push({ kind: "label", pin: ref(p), labelName: name, labelKind: kind });
    } else if (group.length === 2) {
      connections.push({ kind: "wire", from: ref(group[0]), to: ref(group[1]) });
    } else if (group.length > 2) {
      const name = `NET${++netCounter}`;
      for (const p of group) connections.push({ kind: "label", pin: ref(p), labelName: name, labelKind: "label" });
    }
    // length 1 with no label/ground → floating; nothing to emit.
  }

  return { components, connections, explanation: "" };
}
