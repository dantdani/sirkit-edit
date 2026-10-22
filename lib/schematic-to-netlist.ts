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
 *
 * [PR-J, 2026-10-22] Section J increment 2 (OD-255 items 2, 3): the partition comes from THE project connectivity authority
 * (app/lib/schematic/project-connectivity.ts). A document without sheets keeps its exact legacy output (the authority's union IS
 * buildNetUnionFind; naming as above: the first label on a net names it, a ground symbol makes it "GND"). A document with sheets
 * takes the strict scoped nets: each net is named once by the authority (a sheet-local net "Power/OUT"; ground and power rails by
 * their exact names, so AGND and DGND stay two ground nets - run the ERC with `groundNodes: "per-name"`), an unnamed 3+-pin net
 * gets a generated NETn that no named net uses, and a sheet-structure error refuses (SHEET_HIERARCHY_INVALID) - nothing is guessed.
 * Every sheet is included; one sheet's view is refused (SHEET_LENS_NOT_PROJECT).
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
import { kicadPinWorldPos, pinWorldPos } from "@/app/lib/geometry";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { assertWholeProject, sheetOf } from "@/app/lib/schematic/sheets";

type Pin = { refDes: string; number: string; sheetId: string; point: Point };

export function schematicToBuildNetlist(
  state: SchematicState,
  parts: Map<string, CachedPart>,
): BuildLogicalNetlist {
  assertWholeProject(state, "erc-netlist");
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

  // Real (KiCad) pins + their sheets and world positions.
  const pins: Pin[] = [];
  for (const inst of kicad) {
    const part = parts.get(inst.partId);
    if (!part) continue;
    for (const p of part.pins) {
      const point = kicadPinWorldPos(inst, p);
      pins.push({ refDes: inst.refDes, number: p.number, sheetId: sheetOf(inst), point });
    }
  }

  // THE project connectivity authority (a document without sheets: the same buildNetUnionFind union as before).
  const connectivity = resolveProjectConnectivity(state, (partId) => parts.get(partId) ?? null);
  const strict = connectivity.mode === "multi-sheet";
  if (!connectivity.ok) {
    const error = connectivity.diagnostics.find((item) => item.severity === "error");
    throw new Error(`SHEET_HIERARCHY_INVALID: ${error?.code ?? "SHEET_SET_INVALID"}: ${error?.message ?? "the sheet structure is invalid"}`);
  }

  // Which net roots carry a label, and which are ground (the legacy naming of a document without sheets).
  const labelByRoot = new Map<string, { name: string; kind: NetLabelKind }>();
  for (const l of netLabels) {
    const root = connectivity.rootAt(sheetOf(l), l.position);
    if (root !== null && !labelByRoot.has(root)) {
      labelByRoot.set(root, { name: l.name, kind: l.kind });
    }
  }
  const groundRoots = new Set<string>();
  for (const c of state.components) {
    if (c.type !== "ground") continue;
    const root = connectivity.rootAt(sheetOf(c), pinWorldPos(c, "pin"));
    if (root !== null) groundRoots.add(root);
  }

  // Group KiCad pins by net root.
  const pinsByRoot = new Map<string, Pin[]>();
  for (const pin of pins) {
    const root = connectivity.rootAt(pin.sheetId, pin.point);
    if (root === null) continue;
    const list = pinsByRoot.get(root);
    if (list) list.push(pin);
    else pinsByRoot.set(root, [pin]);
  }

  const connections: BuildLogicalConnection[] = [];
  let netCounter = 0;
  const ref = (p: Pin) => `${p.refDes}.${p.number}`;
  // strict: a generated NETn never takes a name the authority already gave a net (the ERC joins nets by name)
  const usedNames = new Set(connectivity.nets.flatMap((net) => (net.name === null ? [] : [net.name.toUpperCase()])));
  const nextNetName = (): string => {
    let name = `NET${++netCounter}`;
    while (strict && usedNames.has(name)) name = `NET${++netCounter}`;
    return name;
  };

  for (const [root, group] of pinsByRoot) {
    if (group.length === 0) continue;
    if (strict) {
      // the authority's one name per net (scoped, exact rail names); never the first label it happens to meet
      const net = connectivity.netAt(group[0].sheetId, group[0].point);
      if (net && net.name !== null) {
        const labelKind: NetLabelKind = net.kind === "ground" ? "ground" : net.kind === "power" ? "power" : "label";
        for (const p of group) connections.push({ kind: "label", pin: ref(p), labelName: net.name, labelKind });
      } else if (group.length === 2) {
        connections.push({ kind: "wire", from: ref(group[0]), to: ref(group[1]) });
      } else if (group.length > 2) {
        const name = nextNetName();
        for (const p of group) connections.push({ kind: "label", pin: ref(p), labelName: name, labelKind: "label" });
      }
      continue;
    }
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
      const name = nextNetName();
      for (const p of group) connections.push({ kind: "label", pin: ref(p), labelName: name, labelKind: "label" });
    }
    // length 1 with no label/ground → floating; nothing to emit.
  }

  return { components, connections, explanation: "" };
}
