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
import { assertValidBoardReferences } from "../integrity";
import type { PadShape } from "../geometry";
import { transformPoint } from "../geometry";
import type { LayerId } from "../layers";
import { mmToNm } from "../units";
import { getBoardStackup } from "../stackup";
import { padWorldShape, padCopperLayers } from "../geometry-copper";
import { physicalPadInstances } from "../pad-identity";
import { computeElectricalTruth } from "../electrical-truth";
import { getNetClass, DEFAULT_CLASSES, type NetClassId } from "../netclass";
import { stackupPlaneZoneId } from "../zones/plane";
import { zoneFillIsCurrent } from "../zones/fill-lifecycle";
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
    .map((layer, index) => {
      const zone = board.zones.find((candidate) =>
        candidate.id === stackupPlaneZoneId(layer.id)
        && candidate.source === "stackup-plane"
        && candidate.sourceLayerId === layer.id
        && candidate.netId === layer.planeNetId,
      );
      const net = zone ? board.nets.find((candidate) => candidate.id === zone.netId) : undefined;
      const plane = zone && net?.stableId && zoneFillIsCurrent(board, zone) && zone.fill.length > 0 && zone.fillState?.fillHash
        ? {
            zoneId: zone.id,
            stableNetId: net.stableId,
            netName: dsnNetName(net),
            polygonNm: zone.polygon.map((point) => ({ ...point })),
            sourceRevision: zone.fillState.sourceRevision,
            fillHash: zone.fillState.fillHash,
            algorithmVersion: zone.fillState.algorithmVersion,
            fillStatus: "current" as const,
            regionCount: zone.fill.length,
            holeCount: zone.fill.reduce((sum, region) => sum + region.holes.length, 0),
            filledAreaNm2: zone.fill.reduce((sum, region) => sum + region.areaNm2, 0),
            exportedRepresentationId: `dsn-plane:${layer.name}:${zone.id}`,
            unsupportedConstructs: [],
          }
        : undefined;
      return {
        name: layer.name,
        type: layer.role === "plane" ? "power" as const : "signal" as const,
        index,
        role: layer.role,
        autorouteEnabled: layer.autorouteEnabled && layer.role !== "plane",
        preferredDirection: layer.preferredDirection,
        traceWidthNm: mmToNm(layer.defaultTraceWidthMm ?? 0.25),
        ...(plane ? { planeNetName: plane.netName, plane } : {}),
      };
    });
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

export interface BoardToDsnOptions {
  /** When set, only these nets are offered as unrouted work. Existing copper on all nets remains protected. */
  includeNetIds?: readonly number[];
}

export function boardToDsn(board: PcbBoard, options: BoardToDsnOptions = {}): DsnBoard {
  assertValidBoardReferences(board);
  const electricalTruth = computeElectricalTruth(board);
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
  const expectedEndpoints: NonNullable<DsnBoard["integrity"]>["expectedEndpoints"] = [];
  for (const inst of board.footprints) {
    const emittedPads = physicalPadInstances(inst).flatMap((physicalPad) => {
      const pad = physicalPad.pad;
      if (pad.type === "np_thru_hole") return [];
      const copper = padCopperLayers(inst, pad).filter((layer) => activeCopper.has(layer));
      const layers = copper.map(layerIdToDsn).filter((layer): layer is DsnLayerName => layer !== null);
      return layers.length > 0 ? [{ physicalPad, pad, layers }] : [];
    });
    const padNumberCounts = new Map<string, number>();
    for (const { pad } of emittedPads) padNumberCounts.set(pad.number, (padNumberCounts.get(pad.number) ?? 0) + 1);
    const padNumberOccurrences = new Map<string, number>();
    const exportedPads = emittedPads.map(({ physicalPad, pad, layers }) => {
      const occurrence = (padNumberOccurrences.get(pad.number) ?? 0) + 1;
      padNumberOccurrences.set(pad.number, occurrence);
      const exportPadNumber = (padNumberCounts.get(pad.number) ?? 0) > 1
        ? `${pad.number}@${occurrence}`
        : pad.number;
      return { physicalPad, pad, layers, exportPadNumber };
    });
    const exportPadNumbersBySource = new Map<string, string[]>();
    const physicalPadIdsBySource = new Map<string, string[]>();
    for (const { physicalPad, pad, exportPadNumber } of exportedPads) {
      const bucket = exportPadNumbersBySource.get(pad.number) ?? [];
      bucket.push(exportPadNumber);
      exportPadNumbersBySource.set(pad.number, bucket);
      const physicalBucket = physicalPadIdsBySource.get(pad.number) ?? [];
      physicalBucket.push(physicalPad.id);
      physicalPadIdsBySource.set(pad.number, physicalBucket);
    }
    for (const mapping of inst.pinPadMappings ?? []) {
      if (mapping.mappingKind === "intentional-no-connect" || mapping.mappingKind === "schematic-only") continue;
      const netIds = new Set(mapping.padNumbers.map((padNumber) => inst.padNets[padNumber] ?? 0).filter((id) => id !== 0));
      if (netIds.size !== 1) continue;
      const netId = [...netIds][0];
      const net = board.nets.find((candidate) => candidate.id === netId);
      if (!net) continue;
      expectedEndpoints.push({
        endpointKey: mapping.endpointKey,
        componentId: inst.id,
        componentRef: inst.ref,
        symbolPinNumber: mapping.symbolPinNumber,
        sourcePadNumbers: [...mapping.padNumbers],
        padNumbers: mapping.padNumbers.flatMap((padNumber) => exportPadNumbersBySource.get(padNumber) ?? []),
        physicalPadInstanceIds: mapping.padNumbers.flatMap((padNumber) => physicalPadIdsBySource.get(padNumber) ?? []).sort(),
        netId,
        ...(net.stableId ? { netStableId: net.stableId } : {}),
        netName: dsnNetName(net),
      });
    }
    const pins: DsnPin[] = [];
    for (const { physicalPad, pad, layers: dsnLayers, exportPadNumber } of exportedPads) {
      const ws = padWorldShape(inst, pad);
      const dsnShape = padShapeToDsn(ws.shape, ws.rotationDeg);
      const psName = internPadstack(dsnShape, pad.drill?.diameter, dsnLayers);
      pins.push({
        padNumber: exportPadNumber,
        sourcePadNumber: pad.number,
        padInstanceId: physicalPad.id,
        padstackName: psName,
        atNm: { x: ws.at.x, y: ws.at.y },
      });

      const netId = inst.padNets[pad.number];
      if (netId) {
        const list = nodesByNet.get(netId) ?? [];
        const endpointKey = inst.pinPadMappings?.find((mapping) => mapping.padNumbers.includes(pad.number))?.endpointKey;
        list.push({
          componentRef: inst.ref,
          padNumber: exportPadNumber,
          componentId: inst.id,
          padInstanceId: physicalPad.id,
          ...(endpointKey ? { endpointKey } : {}),
        });
        nodesByNet.set(netId, list);
      }
    }
    components.push({ ref: inst.ref, imageName: `img-${inst.id}`, pins, componentId: inst.id });
  }

  const networks: DsnNetwork[] = [];
  const usedClasses = new Set<NetClassId>();
  const effectiveByClass = new Map<NetClassId, ReturnType<typeof getNetClass>[]>();
  const includedNetIds = options.includeNetIds ? new Set(options.includeNetIds) : undefined;
  for (const net of board.nets) {
    if (net.id === 0) continue;
    if (includedNetIds && !includedNetIds.has(net.id)) continue;
    const nodes = nodesByNet.get(net.id);
    if (!nodes || nodes.length === 0) continue; // net with no pins won't route
    const effectiveClass = getNetClass(board, net.id);
    const classRef = effectiveClass.id as DsnClassId;
    usedClasses.add(classRef);
    effectiveByClass.set(classRef, [...(effectiveByClass.get(classRef) ?? []), effectiveClass]);
    networks.push({ name: dsnNetName(net), nodes, classRef });
  }

  // Vias — one candidate per class (Freerouting picks from these).
  const viaNameByClass = new Map<NetClassId, string>();
  const resolvedByClass = new Map<NetClassId, { trackWidth: number; clearance: number; viaSize: number; viaDrill: number }>();
  const vias: DsnVia[] = (Object.keys(VIA_NAME_BY_CLASS) as NetClassId[]).map((classId) => {
    const base = DEFAULT_CLASSES[classId];
    const effective = effectiveByClass.get(classId) ?? [];
    const resolved = {
      trackWidth: Math.max(base.trackWidth, ...effective.map((item) => item.trackWidth)),
      clearance: Math.max(base.clearance, ...effective.map((item) => item.clearance)),
      viaSize: Math.max(base.viaSize, ...effective.map((item) => item.viaSize)),
      viaDrill: Math.max(base.viaDrill, ...effective.map((item) => item.viaDrill)),
    };
    resolvedByClass.set(classId, resolved);
    const name = resolved.viaSize === base.viaSize && resolved.viaDrill === base.viaDrill
      ? VIA_NAME_BY_CLASS[classId]
      : existingViaName(resolved.viaSize, resolved.viaDrill);
    viaNameByClass.set(classId, name);
    return {
      name,
      diameterNm: resolved.viaSize,
      drillNm: resolved.viaDrill,
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
      widthNm: resolvedByClass.get("Default")!.trackWidth,
      clearanceNm: resolvedByClass.get("Default")!.clearance,
      viaCandidateName: viaNameByClass.get("Default")!,
      layerWidthsNm: Object.fromEntries(dsnLayers.map((layer) => [layer.name, layer.traceWidthNm])),
    },
  ];
  for (const classId of ["Default", "Power", "HighCurrent"] as NetClassId[]) {
    if (!usedClasses.has(classId)) continue;
    const resolved = resolvedByClass.get(classId)!;
    rules.push({
      scope: { kind: "class", classId },
      widthNm: resolved.trackWidth,
      clearanceNm: resolved.clearance,
      viaCandidateName: viaNameByClass.get(classId)!,
      layerWidthsNm: Object.fromEntries(
        dsnLayers.map((layer) => [layer.name, Math.max(layer.traceWidthNm, resolved.trackWidth)]),
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
    name: `sirkit-export-${electricalTruth.designRevision}`,
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
    integrity: {
      schemaVersion: "sirkit.dsn-integrity.v2",
      sourceRevision: electricalTruth.designRevision,
      electricalTruthSchema: electricalTruth.schemaVersion,
      nets: electricalTruth.nets.map((net) => ({
        stableNetId: net.stableNetId,
        numericNetId: net.netId,
        serializedName: dsnNetName({ id: net.netId, name: net.name }),
        endpointKeys: [...net.endpointKeys],
        terminalGroupIds: [...net.terminalGroupIds],
        physicalPadInstanceIds: [...net.physicalPadInstanceIds],
      })).sort((a, b) => a.stableNetId.localeCompare(b.stableNetId)),
      layers: dsnLayers.map((layer) => ({
        layerId: stackup.copperLayers.find((candidate) => candidate.name === layer.name)?.id ?? layer.name,
        dsnName: layer.name,
      })),
      planes: dsnLayers.flatMap((layer) => layer.plane ? [{
        layerId: stackup.copperLayers.find((candidate) => candidate.name === layer.name)?.id ?? layer.name,
        dsnName: layer.name,
        zoneId: layer.plane.zoneId,
        stableNetId: layer.plane.stableNetId,
        sourceRevision: layer.plane.sourceRevision,
        fillHash: layer.plane.fillHash,
        algorithmVersion: layer.plane.algorithmVersion,
        fillStatus: layer.plane.fillStatus,
        regionCount: layer.plane.regionCount,
        holeCount: layer.plane.holeCount,
        filledAreaNm2: layer.plane.filledAreaNm2,
        exportedRepresentationId: layer.plane.exportedRepresentationId,
        unsupportedConstructs: [...layer.plane.unsupportedConstructs],
      }] : []),
      viaPadstacks: vias.map((via) => ({
        name: via.name,
        diameterNm: via.diameterNm,
        drillNm: via.drillNm,
        onLayers: [...via.onLayers],
      })).sort((a, b) => a.name.localeCompare(b.name)),
      expectedEndpoints: expectedEndpoints.sort((a, b) => a.endpointKey.localeCompare(b.endpointKey)),
      ...(board.constraintState?.activeProgram ? {
        constraintProgramHash: board.constraintState.activeProgram.programHash,
        constraintLoss: (() => {
          const loss: NonNullable<DsnBoard["integrity"]>["constraintLoss"] = [];
          for (const classId of [...usedClasses].sort()) {
            const members = effectiveByClass.get(classId) ?? [];
            const signatures = new Set(members.map((item) => `${item.trackWidth}/${item.clearance}/${item.viaSize}/${item.viaDrill}`));
            if (signatures.size > 1) loss.push({
              constraintIds: [...new Set(members.flatMap((item) => item.constraintIds ?? []))].sort(),
              disposition: "conservative",
              severity: "warning",
              message: `DSN class ${classId} conservatively uses the most restrictive width, clearance, and via dimensions across its member nets.`,
            });
          }
          for (const net of board.nets.filter((item) => item.id !== 0 && item.stableId)) {
            const physical = board.constraintState?.activeProgram?.lowerings.physicalByTarget[net.stableId!];
            if (!physical) continue;
            if (physical.allowedLayerIds || physical.forbiddenLayerIds) loss.push({
              constraintIds: [...physical.constraintIds],
              disposition: "unsupported",
              severity: "error",
              message: `FreeRouting DSN cannot preserve the exact per-net layer set for ${net.stableId}.`,
            });
            if (physical.allowedViaTypes || physical.allowedViaSpans) loss.push({
              constraintIds: [...physical.constraintIds],
              disposition: "unsupported",
              severity: "error",
              message: `FreeRouting DSN cannot prove the exact per-net via type/span policy for ${net.stableId}.`,
            });
            if (physical.maxViaCount !== undefined) loss.push({
              constraintIds: [...physical.constraintIds],
              disposition: "post_route_check",
              severity: "warning",
              message: `Maximum via count for ${net.stableId} requires deterministic post-route evaluation.`,
            });
          }
          return loss.sort((a, b) => a.severity.localeCompare(b.severity) || a.message.localeCompare(b.message));
        })(),
      } : {}),
    },
  };
}

// ── writeDsn ────────────────────────────────────────────────────────────────

/**
 * [B19-D I5e row 52] A refusal to write a DSN token outside its vocabulary. The file is handed to the FreeRouting subprocess;
 * the board (and its stackup) arrives in a request or a shared project, so every token written by hand is checked here and
 * nothing is written at all when one fails.
 */
export class DsnEmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DsnEmitError";
  }
}

const DSN_LAYER_NAMES: ReadonlySet<string> = new Set(["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]);
const DSN_DIRECTIONS: ReadonlySet<string> = new Set(["horizontal", "vertical", "any"]);
const DSN_BARE_TOKEN = /^[A-Za-z0-9_.:+-]+$/;

function layerToken(name: unknown): string {
  if (typeof name !== "string" || !DSN_LAYER_NAMES.has(name)) throw new DsnEmitError("A DSN layer is not one of the supported copper layers.");
  return name;
}

function costToken(value: unknown, field: string): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new DsnEmitError(`The routing ${field} is not a finite, non-negative number.`);
  return String(value);
}

function q(s: string): string {
  // a line break or other control character inside a quoted DSN string is refused, never written
  if (typeof s !== "string" || /[\u0000-\u001f\u007f]/.test(s)) throw new DsnEmitError("A DSN name contains a control character.");
  // [B19-D I5e review] FreeRouting's lexer has no escape inside a quoted string (a backslash is a plain character and the next
  // quote ends the string), so a quote cannot be written safely and a backslash would not read back as the same name
  if (/["\\]/.test(s)) throw new DsnEmitError("A DSN name contains a quote or backslash, which FreeRouting cannot read back exactly.");
  return `"${s}"`;
}

function n(v: number): string {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new DsnEmitError("A DSN coordinate is not a finite number.");
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
      return `(shape (circle ${layerToken(layer)} ${n(shape.diameterNm)}))`;
    case "rect": {
      const hw = shape.wNm / 2;
      const hh = shape.hNm / 2;
      return `(shape (rect ${layerToken(layer)} ${n(-hw)} ${n(-hh)} ${n(hw)} ${n(hh)}))`;
    }
    case "polygon": {
      const coords = shape.pointsNm.map((p) => `${n(p.x)} ${n(p.y)}`).join(" ");
      return `(shape (polygon ${layerToken(layer)} 0 ${coords}))`;
    }
  }
}

export function writeDsn(dsn: DsnBoard): string {
  if (typeof dsn.name !== "string" || !DSN_BARE_TOKEN.test(dsn.name)) throw new DsnEmitError("The DSN design name is not a bare token.");
  if (!DSN_BARE_TOKEN.test(String(dsn.resolution))) throw new DsnEmitError("The DSN resolution is not a bare token.");
  for (const layer of dsn.layers) {
    layerToken(layer.name);
    if (layer.type !== "signal" && layer.type !== "power") throw new DsnEmitError("A DSN layer type is not signal or power.");
    if (!DSN_DIRECTIONS.has(layer.preferredDirection)) throw new DsnEmitError("A DSN layer's preferred direction is not horizontal, vertical or any.");
  }
  const viaCost = costToken(dsn.routingSettings.viaCost, "via cost");
  const planeViaCost = costToken(dsn.routingSettings.planeViaCost, "plane via cost");
  const startRipupCost = costToken(dsn.routingSettings.startRipupCost, "start ripup cost");
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
    if (layer.role !== "plane" || !layer.plane) continue;
    const coords = layer.plane.polygonNm.map((point) => `${n(point.x)} ${n(point.y)}`).join(" ");
    const firstPlanePoint = layer.plane.polygonNm[0];
    const closedPlane = firstPlanePoint ? `${coords} ${n(firstPlanePoint.x)} ${n(firstPlanePoint.y)}` : coords;
    L.push(`    (plane ${q(layer.plane.netName)} (polygon ${layer.name} 0 ${closedPlane}))`);
  }
  L.push(`    (via ${dsn.vias.map((v) => q(v.name)).join(" ")})`);
  const defRule = dsn.rules.find((r) => r.scope.kind === "default");
  if (defRule) L.push(`    (rule (width ${n(defRule.widthNm)}) (clearance ${n(defRule.clearanceNm)}))`);
  L.push(`    (autoroute_settings`);
  L.push(`      (fanout ${dsn.routingSettings.fanout ? "on" : "off"})`);
  L.push(`      (autoroute on)`);
  L.push(`      (postroute ${dsn.routingSettings.postroute ? "on" : "off"})`);
  L.push(`      (vias ${dsn.routingSettings.viasAllowed ? "on" : "off"})`);
  L.push(`      (via_costs ${viaCost})`);
  L.push(`      (plane_via_costs ${planeViaCost})`);
  L.push(`      (start_ripup_costs ${startRipupCost})`);
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
    for (const layer of via.onLayers) L.push(`      (shape (circle ${layerToken(layer)} ${n(via.diameterNm)}))`);
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
        `    (wire (path ${layerToken(item.layer)} ${n(item.widthNm)} ${n(item.startNm.x)} ${n(item.startNm.y)} ${n(item.endNm.x)} ${n(item.endNm.y)})(net ${q(item.netName)})(type protect))`,
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
