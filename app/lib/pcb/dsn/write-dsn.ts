/**
 * Specctra DSN emitter (PCB Stage 9) — turns a PcbBoard into the .dsn text
 * Freerouting consumes. Two pure steps so each is trivially testable:
 *
 *   boardToDsn(board): DsnBoard   — structural transform (no strings)
 *   writeDsn(dsn): string         — deterministic textual emit
 *
 * DESIGN — baked absolute placement (rationale). Our board is KiCad-convention
 * (+y down, rotationDeg CCW-on-screen). Freerouting composes a component's
 * `(place x y side rot)` with each image pin's local offset using its OWN
 * rotation/mirror convention; if that differs from ours (it uses standard CCW
 * math, which flips the sign of y relative to our +y-down rotation), every
 * rotated or bottom-side footprint would be misplaced and the routed tracks
 * would not land on our pads. To make correctness independent of Freerouting's
 * convention, we emit ONE image per instance, place every component at
 * `(place ref 0 0 front 0)`, and bake each pin's ABSOLUTE world coordinate
 * (padWorldPosition) into the image. Freerouting's composition is then the
 * identity, so its returned SES tracks connect our exact pad centers. Padstack
 * dedup (shape+drill+layers) is unaffected and still collapses identical pads.
 *
 * Pad-shape orientation for non-orthogonal rotations is approximated (we bake
 * orthogonal 90/270 by swapping w/h, and rotate polygon vertices exactly;
 * arbitrary angles keep the nominal axis-aligned rect). Positions — what
 * determines whether the board routes — are always exact.
 */

import type { PcbBoard } from "../types";
import type { PadShape } from "../geometry";
import { transformPoint } from "../geometry";
import type { LayerId } from "../layers";
import { mmToNm } from "../units";
import { getBoardStackup } from "../stackup";
import { padWorldShape, padCopperLayers } from "../geometry-copper";
import { getNetClass, DEFAULT_CLASSES, type NetClassId } from "../netclass";
import type {
  DsnBoard,
  DsnBoundary,
  DsnLayer,
  DsnLayerName,
  DsnPadShape,
  DsnPadstack,
  DsnComponent,
  DsnPin,
  DsnNetwork,
  DsnNetworkNode,
  DsnVia,
  DsnRule,
  DsnClassId,
  Vec2Nm,
} from "./types";

// ── Shared constants (read-ses.ts imports the via catalog + net-name rule) ────

/** Via candidate name per class — referenced by rules and by SES via parsing. */
export const VIA_NAME_BY_CLASS: Record<NetClassId, string> = {
  Default: "via_default",
  Power: "via_power",
  HighCurrent: "via_highcurrent",
};

/** Outer diameter + drill for each via candidate (from Stage 10's class model). */
export const VIA_DIMENSIONS: Record<string, { sizeNm: number; drillNm: number }> = {
  via_default: { sizeNm: DEFAULT_CLASSES.Default.viaSize, drillNm: DEFAULT_CLASSES.Default.viaDrill },
  via_power: { sizeNm: DEFAULT_CLASSES.Power.viaSize, drillNm: DEFAULT_CLASSES.Power.viaDrill },
  via_highcurrent: { sizeNm: DEFAULT_CLASSES.HighCurrent.viaSize, drillNm: DEFAULT_CLASSES.HighCurrent.viaDrill },
};

function existingViaName(sizeNm: number, drillNm: number): string {
  return `via_existing_${Math.round(sizeNm)}_${Math.round(drillNm)}`;
}

export function viaDimensionsForName(
  name: string,
): { sizeNm: number; drillNm: number } | undefined {
  const known = VIA_DIMENSIONS[name];
  if (known) return known;
  const match = /^via_existing_(\d+)_(\d+)$/.exec(name);
  if (!match) return undefined;
  return { sizeNm: Number(match[1]), drillNm: Number(match[2]) };
}

/** Canonical net name used in both DSN emit and SES import (net 0 excluded upstream). */
export function dsnNetName(net: { id: number; name?: string }): string {
  const n = typeof net.name === "string" ? net.name.trim() : "";
  return n.length > 0 ? n : `net${net.id}`;
}

// ── Layer helpers ─────────────────────────────────────────────────────────────

const DSN_LAYER_ORDER: readonly DsnLayerName[] = ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"];

function layerIdToDsn(id: LayerId): DsnLayerName | null {
  switch (id) {
    case "copperTop":
      return "F.Cu";
    case "in1":
      return "In1.Cu";
    case "in2":
      return "In2.Cu";
    case "copperBottom":
      return "B.Cu";
    default:
      return null; // non-copper — Freerouting ignores it
  }
}

function activeDsnLayers(board: PcbBoard): DsnLayer[] {
  const stackup = getBoardStackup(board);
  return stackup.copperLayers
    .filter((layer) => layer.enabled)
    .sort((a, b) => a.order - b.order)
    .map((layer, index) => ({
      name: layer.name,
      type: layer.role === "plane" ? "power" : "signal",
      index,
      role: layer.role,
      autorouteEnabled: layer.autorouteEnabled && layer.role !== "plane",
      preferredDirection: layer.preferredDirection,
      traceWidthNm: mmToNm(layer.defaultTraceWidthMm ?? 0.25),
      planeNetName:
        layer.role === "plane" && layer.planeNetId !== undefined
          ? dsnNetName(board.nets.find((net) => net.id === layer.planeNetId) ?? { id: layer.planeNetId })
          : undefined,
    }));
}

function sortDsnLayers(ls: DsnLayerName[]): DsnLayerName[] {
  return [...new Set(ls)].sort((a, b) => DSN_LAYER_ORDER.indexOf(a) - DSN_LAYER_ORDER.indexOf(b));
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Snap to an orthogonal multiple if within tolerance, else null (keep nominal). */
function orthogonal(deg: number): 0 | 90 | 180 | 270 | null {
  const d = ((deg % 360) + 360) % 360;
  const near = (t: number): boolean => Math.abs(d - t) < 0.5 || Math.abs(d - t - 360) < 0.5;
  if (near(0)) return 0;
  if (near(90)) return 90;
  if (near(180)) return 180;
  if (near(270)) return 270;
  return null;
}

function padShapeToDsn(shape: PadShape, worldRotDeg: number): DsnPadShape {
  const orth = orthogonal(worldRotDeg);
  const swap = orth === 90 || orth === 270;
  switch (shape.kind) {
    case "circle":
      return { kind: "circle", diameterNm: shape.radius * 2 };
    case "rect":
    case "roundrect":
      return { kind: "rect", wNm: swap ? shape.height : shape.width, hNm: swap ? shape.width : shape.height };
    case "oval":
      // MVP: approximate the stadium as its bounding rect (positions exact; clearance ~ok).
      return { kind: "rect", wNm: swap ? shape.height : shape.width, hNm: swap ? shape.width : shape.height };
    case "polygon": {
      // Points are shape-origin-relative (already bottom-mirrored by padWorldShape).
      const origin: Vec2Nm = { x: 0, y: 0 };
      const pointsNm = shape.points.map((p) => transformPoint(p, origin, worldRotDeg, false));
      return { kind: "polygon", pointsNm };
    }
  }
}

// ── Deterministic ids ─────────────────────────────────────────────────────────

/** FNV-1a 32-bit → 8 hex chars. Pure, dependency-free, deterministic. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function shapeKey(s: DsnPadShape): string {
  switch (s.kind) {
    case "circle":
      return `c:${s.diameterNm}`;
    case "rect":
      return `r:${s.wNm}x${s.hNm}`;
    case "polygon":
      return `p:${s.pointsNm.map((p) => `${p.x},${p.y}`).join(";")}`;
  }
}

function padstackKey(shape: DsnPadShape, drillNm: number | undefined, layers: DsnLayerName[]): string {
  return `${shapeKey(shape)}|d:${drillNm ?? "none"}|l:${layers.join(",")}`;
}

// ── boardToDsn ──────────────────────────────────────────────────────────────

function boardBoundary(board: PcbBoard): DsnBoundary {
  const o = board.outline;
  if (o.kind === "polygon") {
    return { polygon: o.points.map((p) => ({ x: p.x, y: p.y })), layer: "pcb" };
  }
  const { origin, width, height } = o; // rect | roundrect (radius ignored for the outline)
  return {
    polygon: [
      { x: origin.x, y: origin.y },
      { x: origin.x + width, y: origin.y },
      { x: origin.x + width, y: origin.y + height },
      { x: origin.x, y: origin.y + height },
    ],
    layer: "pcb",
  };
}

function stableBoardKey(board: PcbBoard): string {
  return JSON.stringify({
    stackup: board.stackup,
    outline: board.outline,
    nets: board.nets,
    footprints: board.footprints.map((f) => ({
      id: f.id,
      ref: f.ref,
      at: f.at,
      rotationDeg: f.rotationDeg,
      side: f.side,
      padNets: f.padNets,
      pads: f.def.pads.map((p) => ({ number: p.number, shape: p.shape, at: p.at, rotationDeg: p.rotationDeg })),
    })),
  });
}

export interface BoardToDsnOptions {
  /** When set, only these nets are offered as unrouted work. Existing copper on all nets remains protected. */
  includeNetIds?: readonly number[];
}

export function boardToDsn(board: PcbBoard, options: BoardToDsnOptions = {}): DsnBoard {
  const stackup = getBoardStackup(board);
  const dsnLayers = activeDsnLayers(board);
  const activeCopper = new Set<LayerId>(
    stackup.copperLayers.filter((layer) => layer.enabled).map((layer) => layer.id),
  );

  // Padstacks are interned (deduped) across all pads of all instances. Names are
  // FNV-hash-derived; a collision guard keeps them unique (Freerouting rejects
  // two library padstacks with the same name).
  const padstacks = new Map<string, DsnPadstack>();
  const usedNames = new Set<string>();
  const internPadstack = (shape: DsnPadShape, drillNm: number | undefined, layers: DsnLayerName[]): string => {
    const onLayers = sortDsnLayers(layers);
    const key = padstackKey(shape, drillNm, onLayers);
    const existing = padstacks.get(key);
    if (existing) return existing.name;
    let name = `ps_${fnv1a(key)}`;
    for (let i = 1; usedNames.has(name); i++) name = `ps_${fnv1a(key)}_${i}`;
    usedNames.add(name);
    padstacks.set(key, { name, shape, drillNm, onLayers });
    return name;
  };

  // Net membership is derived from the EMITTED pins (not raw padNets), so a
  // network can never reference a pin that has no image entry.
  const components: DsnComponent[] = [];
  const nodesByNet = new Map<number, DsnNetworkNode[]>();
  for (const inst of board.footprints) {
    const pins: DsnPin[] = [];
    for (const pad of inst.def.pads) {
      if (pad.type === "np_thru_hole") continue; // mechanical hole — never a routing target
      const copper = padCopperLayers(inst, pad).filter((l) => activeCopper.has(l));
      const dsnLayers = copper.map(layerIdToDsn).filter((l): l is DsnLayerName => l !== null);
      if (dsnLayers.length === 0) continue; // non-copper pad — no routing target
      const ws = padWorldShape(inst, pad);
      const dsnShape = padShapeToDsn(ws.shape, ws.rotationDeg);
      const psName = internPadstack(dsnShape, pad.drill?.diameter, dsnLayers);
      pins.push({ padNumber: pad.number, padstackName: psName, atNm: { x: ws.at.x, y: ws.at.y } });

      const netId = inst.padNets[pad.number];
      if (netId) {
        const list = nodesByNet.get(netId) ?? [];
        list.push({ componentRef: inst.ref, padNumber: pad.number });
        nodesByNet.set(netId, list);
      }
    }
    components.push({ ref: inst.ref, imageName: `img-${inst.id}`, pins });
  }

  const networks: DsnNetwork[] = [];
  const usedClasses = new Set<NetClassId>();
  const includedNetIds = options.includeNetIds ? new Set(options.includeNetIds) : undefined;
  for (const net of board.nets) {
    if (net.id === 0) continue;
    if (includedNetIds && !includedNetIds.has(net.id)) continue;
    const nodes = nodesByNet.get(net.id);
    if (!nodes || nodes.length === 0) continue; // net with no pins won't route
    const classRef = getNetClass(board, net.id).id as DsnClassId;
    usedClasses.add(classRef);
    networks.push({ name: dsnNetName(net), nodes, classRef });
  }

  // Vias — one candidate per class (Freerouting picks from these).
  const vias: DsnVia[] = (Object.keys(VIA_NAME_BY_CLASS) as NetClassId[]).map((classId) => {
    const name = VIA_NAME_BY_CLASS[classId];
    return {
      name,
      diameterNm: VIA_DIMENSIONS[name].sizeNm,
      drillNm: VIA_DIMENSIONS[name].drillNm,
      onLayers: dsnLayers.map((l) => l.name),
      startLayer: dsnLayers[0].name,
      endLayer: dsnLayers[dsnLayers.length - 1].name,
    };
  });
  for (const via of board.vias) {
    const start = dsnLayers.findIndex((layer) => layerIdToDsn(via.layers[0]) === layer.name);
    const end = dsnLayers.findIndex((layer) => layerIdToDsn(via.layers[1]) === layer.name);
    if (start < 0 || end < 0) continue;
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const name = existingViaName(via.size, via.drill);
    if (vias.some((candidate) => candidate.name === name)) continue;
    vias.push({
      name,
      diameterNm: via.size,
      drillNm: via.drill,
      onLayers: dsnLayers.slice(lo, hi + 1).map((layer) => layer.name),
      startLayer: dsnLayers[lo].name,
      endLayer: dsnLayers[hi].name,
    });
  }

  // Rules — board default + one per used class (from the class model, not hard-coded).
  const rules: DsnRule[] = [
    {
      scope: { kind: "default" },
      widthNm: DEFAULT_CLASSES.Default.trackWidth,
      clearanceNm: DEFAULT_CLASSES.Default.clearance,
      viaCandidateName: VIA_NAME_BY_CLASS.Default,
      layerWidthsNm: Object.fromEntries(dsnLayers.map((layer) => [layer.name, layer.traceWidthNm])),
    },
  ];
  for (const classId of ["Default", "Power", "HighCurrent"] as NetClassId[]) {
    if (!usedClasses.has(classId)) continue;
    rules.push({
      scope: { kind: "class", classId },
      widthNm: DEFAULT_CLASSES[classId].trackWidth,
      clearanceNm: DEFAULT_CLASSES[classId].clearance,
      viaCandidateName: VIA_NAME_BY_CLASS[classId],
      layerWidthsNm: Object.fromEntries(
        dsnLayers.map((layer) => [layer.name, Math.max(layer.traceWidthNm, DEFAULT_CLASSES[classId].trackWidth)]),
      ),
    });
  }

  const netNameById = new Map(board.nets.filter((net) => net.id !== 0).map((net) => [net.id, dsnNetName(net)]));
  const wiring: DsnBoard["wiring"] = [];
  for (const track of board.tracks) {
    const layer = layerIdToDsn(track.layer);
    const netName = netNameById.get(track.netId);
    if (!layer || !netName || !dsnLayers.some((candidate) => candidate.name === layer)) continue;
    wiring.push({
      kind: "wire",
      layer,
      widthNm: track.width,
      startNm: { ...track.start },
      endNm: { ...track.end },
      netName,
    });
  }
  for (const via of board.vias) {
    const netName = netNameById.get(via.netId);
    if (!netName) continue;
    wiring.push({ kind: "via", viaName: existingViaName(via.size, via.drill), atNm: { ...via.at }, netName });
  }

  return {
    name: `sirkit-export-${fnv1a(stableBoardKey(board))}`,
    resolution: "um",
    boundary: boardBoundary(board),
    layers: dsnLayers,
    padstacks: [...padstacks.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    vias,
    components,
    networks,
    rules,
    routingSettings: { ...stackup.routing },
    wiring,
  };
}

// ── writeDsn ────────────────────────────────────────────────────────────────

function q(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function n(v: number): string {
  // PcbBoard stores integer nanometers; DSN uses Freerouting's supported
  // micrometer unit. Preserve all nanometer precision with up to 3 decimals.
  const micrometers = Math.round(v) / 1000;
  return Number.isInteger(micrometers)
    ? String(micrometers)
    : micrometers.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function shapeSexpr(shape: DsnPadShape, layer: DsnLayerName): string {
  switch (shape.kind) {
    case "circle":
      return `(shape (circle ${layer} ${n(shape.diameterNm)}))`;
    case "rect": {
      const hw = shape.wNm / 2;
      const hh = shape.hNm / 2;
      return `(shape (rect ${layer} ${n(-hw)} ${n(-hh)} ${n(hw)} ${n(hh)}))`;
    }
    case "polygon": {
      const coords = shape.pointsNm.map((p) => `${n(p.x)} ${n(p.y)}`).join(" ");
      return `(shape (polygon ${layer} 0 ${coords}))`;
    }
  }
}

export function writeDsn(dsn: DsnBoard): string {
  const L: string[] = [];
  L.push(`(pcb ${dsn.name}`);
  L.push(`  (parser`);
  L.push(`    (string_quote ")`);
  L.push(`    (space_in_quoted_tokens on)`);
  L.push(`    (host_cad "sirkit")`);
  L.push(`    (host_version "0.1")`);
  L.push(`  )`);
  // Freerouting v2.2.4 rejects `nm`; keep a 1:1 transform using its `um` token.
  L.push(`  (resolution ${dsn.resolution} 1)`);

  // structure
  L.push(`  (structure`);
  for (const layer of dsn.layers) {
    L.push(`    (layer ${layer.name}`);
    L.push(`      (type ${layer.type})`);
    L.push(`    )`);
  }
  const boundaryCoords = dsn.boundary.polygon.map((p) => `${n(p.x)} ${n(p.y)}`).join(" ");
  // close the polygon back to the first vertex
  const first = dsn.boundary.polygon[0];
  const closed = first ? `${boundaryCoords} ${n(first.x)} ${n(first.y)}` : boundaryCoords;
  L.push(`    (boundary (path pcb 0 ${closed}))`);
  for (const layer of dsn.layers) {
    if (layer.role !== "plane" || !layer.planeNetName) continue;
    L.push(`    (plane ${q(layer.planeNetName)} (polygon ${layer.name} 0 ${closed}))`);
  }
  L.push(`    (via ${dsn.vias.map((v) => q(v.name)).join(" ")})`);
  const defRule = dsn.rules.find((r) => r.scope.kind === "default");
  if (defRule) L.push(`    (rule (width ${n(defRule.widthNm)}) (clearance ${n(defRule.clearanceNm)}))`);
  L.push(`    (autoroute_settings`);
  L.push(`      (fanout ${dsn.routingSettings.fanout ? "on" : "off"})`);
  L.push(`      (autoroute on)`);
  L.push(`      (postroute ${dsn.routingSettings.postroute ? "on" : "off"})`);
  L.push(`      (vias ${dsn.routingSettings.viasAllowed ? "on" : "off"})`);
  L.push(`      (via_costs ${dsn.routingSettings.viaCost})`);
  L.push(`      (plane_via_costs ${dsn.routingSettings.planeViaCost})`);
  L.push(`      (start_ripup_costs ${dsn.routingSettings.startRipupCost})`);
  L.push(`      (start_pass_no 1)`);
  for (const layer of dsn.layers) {
    L.push(`      (layer_rule ${layer.name}`);
    L.push(`        (active ${layer.autorouteEnabled ? "on" : "off"})`);
    if (layer.preferredDirection !== "any") {
      L.push(`        (preferred_direction ${layer.preferredDirection})`);
      L.push(`        (preferred_direction_trace_costs 1.0)`);
      L.push(`        (against_preferred_direction_trace_costs 2.5)`);
    }
    L.push(`      )`);
  }
  L.push(`    )`);
  L.push(`  )`);

  // placement — every component at origin, front, 0 (positions baked into images)
  L.push(`  (placement`);
  for (const c of dsn.components) {
    L.push(`    (component ${q(c.imageName)}`);
    L.push(`      (place ${q(c.ref)} 0 0 front 0)`);
    L.push(`    )`);
  }
  L.push(`  )`);

  // library — one image per instance, then padstacks, then via padstacks
  L.push(`  (library`);
  for (const c of dsn.components) {
    L.push(`    (image ${q(c.imageName)}`);
    for (const pin of c.pins) {
      L.push(`      (pin ${q(pin.padstackName)} ${q(pin.padNumber)} ${n(pin.atNm.x)} ${n(pin.atNm.y)})`);
    }
    L.push(`    )`);
  }
  for (const ps of dsn.padstacks) {
    L.push(`    (padstack ${q(ps.name)}`);
    for (const layer of ps.onLayers) L.push(`      ${shapeSexpr(ps.shape, layer)}`);
    L.push(`      (attach off)`);
    L.push(`    )`);
  }
  for (const via of dsn.vias) {
    L.push(`    (padstack ${q(via.name)}`);
    for (const layer of via.onLayers) L.push(`      (shape (circle ${layer} ${n(via.diameterNm)}))`);
    L.push(`      (attach off)`);
    L.push(`    )`);
  }
  L.push(`  )`);

  // network — nets with their pins, then class blocks grouping nets
  L.push(`  (network`);
  for (const net of dsn.networks) {
    // Specctra pin syntax tokenizes each side of the hyphen independently.
    const pins = net.nodes.map((nd) => `${q(nd.componentRef)}-${q(nd.padNumber)}`).join(" ");
    L.push(`    (net ${q(net.name)}`);
    L.push(`      (pins ${pins})`);
    L.push(`    )`);
  }
  for (const classId of ["Default", "Power", "HighCurrent"] as DsnClassId[]) {
    const nets = dsn.networks.filter((net) => net.classRef === classId);
    if (nets.length === 0) continue;
    const rule =
      dsn.rules.find((r) => r.scope.kind === "class" && r.scope.classId === classId) ??
      dsn.rules.find((r) => r.scope.kind === "default");
    const viaName = rule?.viaCandidateName ?? VIA_NAME_BY_CLASS[classId];
    L.push(`    (class ${classId} ${nets.map((net) => q(net.name)).join(" ")}`);
    L.push(`      (circuit (use_via ${q(viaName)}))`);
    if (rule) L.push(`      (rule (width ${n(rule.widthNm)}) (clearance ${n(rule.clearanceNm)}))`);
    if (rule) {
      for (const layer of dsn.layers) {
        const width = rule.layerWidthsNm[layer.name];
        if (width && width > 0) L.push(`      (layer_rule ${layer.name} (rule (width ${n(width)})))`);
      }
    }
    L.push(`    )`);
  }
  L.push(`  )`);

  L.push(`  (wiring`);
  for (const item of dsn.wiring) {
    if (item.kind === "wire") {
      L.push(
        `    (wire (path ${item.layer} ${n(item.widthNm)} ${n(item.startNm.x)} ${n(item.startNm.y)} ${n(item.endNm.x)} ${n(item.endNm.y)})(net ${q(item.netName)})(type protect))`,
      );
    } else {
      L.push(
        `    (via ${q(item.viaName)} ${n(item.atNm.x)} ${n(item.atNm.y)} (net ${q(item.netName)})(type protect))`,
      );
    }
  }
  L.push(`  )`);

  L.push(`)`);
  return L.join("\n") + "\n";
}
