/**
 * Zone fill engine (PCB Stage 11) — PINNED entry point. Pure and synchronous:
 * board + zone in, `FilledRegion[]` out. No Pixi/React/DOM.
 *
 * Pipeline:
 *   1. subject  = zone.polygon ∩ (board outline inset by boardEdgeClearanceNm)
 *   2. allowed  = subject − clearance cutouts around every FOREIGN-net
 *                 track/via/pad on the zone's layer (per-pair clearance =
 *                 max(zone class/override, item class) via effectiveClearance),
 *                 NPTH drills, and later-drawn foreign zones on the same layer
 *                 (draw order wins: LATER zones cut into EARLIER fills)
 *   3. thermal  = if connection === 'thermal', subtract an annular gap around
 *                 each same-net pad, then union the wagon-wheel spokes back
 *                 (spokes are clipped to `allowed` so they never bridge into
 *                 foreign clearance)
 *   4. islands  = drop regions that don't reach the zone's net (islands.ts)
 *   5. stats    = bbox + area per region, elapsed ms
 *
 * Same-net tracks/vias get NO cutouts — the pour joins them directly. All
 * arcs are polygonized CIRCUMSCRIBED (zones/geometry.ts), so a cutout is
 * never smaller than the true inflation and DRC stays clean by construction.
 */

import type { Vec2 } from "../geometry";
import type { Pad, FootprintInstance } from "../types";
import { padCopperLayers, padWorldPosition, padWorldShape, viaSpannedLayers } from "../geometry-copper";
import {
  capsulePolygon,
  circlePolygon,
  decomposeShape,
  outlinePolygon,
  polygonBBox,
  regionAreaNm2,
} from "./geometry";
import {
  differenceWithHoles,
  inflatePointSet,
  intersectionWithHoles,
  polygonInflate,
  polygonIntersection,
  unionWithHoles,
  type PolyWithHoles,
} from "./clipper-adapter";
import { generateRadialThermalSpokes, generateThermalSpokes } from "./thermals";
import { filterIslandsByConnection } from "./islands";
import type { ComputeFillInput, ComputeFillResult, FilledRegion } from "./types";
import { DEFAULT_BOARD_EDGE_CLEARANCE_NM, thermalParamsFor } from "./types";
import { classifyNetRelation } from "../copper-policy";

interface SameNetPad {
  inst: FootprintInstance;
  pad: Pad;
  world: Vec2;
  worldRotationDeg: number;
}

function canonicalRing(input: Vec2[]): Vec2[] {
  const ring = input.length > 1 && input[0].x === input[input.length - 1].x && input[0].y === input[input.length - 1].y
    ? input.slice(0, -1)
    : [...input];
  if (ring.length < 2) return ring.map((point) => ({ ...point }));
  const compare = (a: Vec2[], b: Vec2[]): number => {
    for (let index = 0; index < a.length; index++) {
      if (a[index].x !== b[index].x) return a[index].x - b[index].x;
      if (a[index].y !== b[index].y) return a[index].y - b[index].y;
    }
    return 0;
  };
  const bestRotation = (points: Vec2[]): Vec2[] => {
    let minX = Infinity;
    let minY = Infinity;
    for (const point of points) {
      if (point.x < minX || (point.x === minX && point.y < minY)) {
        minX = point.x;
        minY = point.y;
      }
    }
    let best: Vec2[] | undefined;
    points.forEach((point, index) => {
      if (point.x !== minX || point.y !== minY) return;
      const candidate = [...points.slice(index), ...points.slice(0, index)];
      if (!best || compare(candidate, best) < 0) best = candidate;
    });
    return best ?? points;
  };
  const forward = bestRotation(ring);
  const reverse = bestRotation([...ring].reverse());
  return (compare(forward, reverse) <= 0 ? forward : reverse).map((point) => ({ ...point }));
}

function toRegions(polys: PolyWithHoles[]): FilledRegion[] {
  const out: FilledRegion[] = [];
  for (const rings of polys) {
    const [rawOuter, ...rawHoles] = rings;
    const outer = rawOuter ? canonicalRing(rawOuter) : undefined;
    if (!outer || outer.length < 3) continue;
    const holes = rawHoles.map(canonicalRing).filter((ring) => ring.length >= 3)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    out.push({
      outer,
      holes,
      boundingBox: polygonBBox(outer),
      areaNm2: Math.round(regionAreaNm2(outer, holes)),
    });
  }
  return out.sort((a, b) => JSON.stringify({ outer: a.outer, holes: a.holes }).localeCompare(JSON.stringify({ outer: b.outer, holes: b.holes })));
}

export function computeFill(input: ComputeFillInput): ComputeFillResult {
  const t0 = performance.now();
  const { board, zone, effectiveClearance } = input;
  const edgeClearance = input.boardEdgeClearanceNm ?? DEFAULT_BOARD_EDGE_CLEARANCE_NM;
  const layer = zone.layer;

  const empty = (): ComputeFillResult => ({
    regions: [],
    stats: { rawRegions: 0, islandsDropped: 0, elapsedMs: performance.now() - t0, thermalAccessCount: 0 },
  });
  if (zone.polygon.length < 3) return empty();

  // 1 — subject: zone polygon clipped to the outline inset by edge clearance.
  const inset = polygonInflate(outlinePolygon(board.outline), -edgeClearance);
  const subject = polygonIntersection([zone.polygon], inset);
  if (subject.length === 0) return empty();

  // 2 — clearance cutouts around foreign copper on this layer.
  const clips: Vec2[][] = [];
  const sameNet = (netId: number): boolean => classifyNetRelation(board, zone.netId, netId) === "same-proven-net";
  for (const t of board.tracks) {
    if (t.layer !== layer || sameNet(t.netId)) continue;
    clips.push(capsulePolygon(t.start, t.end, t.width / 2 + effectiveClearance(t.netId, layer)));
  }
  const sameNetVias = [] as typeof board.vias;
  for (const v of board.vias) {
    if (!viaSpannedLayers(v).includes(layer)) continue;
    if (sameNet(v.netId)) {
      sameNetVias.push(v);
      continue;
    }
    clips.push(circlePolygon(v.at, v.size / 2 + effectiveClearance(v.netId, layer)));
  }
  for (const keepout of board.routingKeepouts ?? []) {
    if (!keepout.layers.includes(layer) || (!keepout.forbidTracks && !keepout.forbidVias) || keepout.polygon.length < 3) continue;
    clips.push(canonicalRing(keepout.polygon));
  }
  const sameNetPads: SameNetPad[] = [];
  for (const inst of board.footprints) {
    for (const pad of inst.def.pads) {
      if (pad.type === "np_thru_hole") {
        // Plated-nothing hole: keep copper away from the drill.
        if (pad.drill) {
          const r = Math.max(pad.drill.diameter, pad.drill.width ?? 0, pad.drill.height ?? 0) / 2;
          clips.push(circlePolygon(padWorldPosition(inst, pad), r + effectiveClearance(0, layer)));
        }
        continue;
      }
      if (!padCopperLayers(inst, pad).includes(layer)) continue;
      const netId = inst.padNets[pad.number] ?? 0;
      const shape = padWorldShape(inst, pad);
      if (!sameNet(netId)) {
        const { pts, r } = decomposeShape(shape);
        clips.push(...inflatePointSet(pts, r + effectiveClearance(netId, layer)));
      } else {
        sameNetPads.push({
          inst,
          pad,
          world: padWorldPosition(inst, pad),
          worldRotationDeg: shape.rotationDeg,
        });
      }
    }
  }
  // Explicit priority wins contested copper; stable id is the deterministic tie-break.
  for (const other of board.zones) {
    if (other.id === zone.id || other.layer !== layer || sameNet(other.netId)) continue;
    const otherPriority = other.priority ?? 0;
    const myPriority = zone.priority ?? 0;
    if (otherPriority < myPriority || (otherPriority === myPriority && other.id.localeCompare(zone.id) <= 0)) continue;
    if (other.polygon.length < 3) continue;
    clips.push(...polygonInflate(other.polygon, effectiveClearance(other.netId, layer)));
  }

  const allowed = differenceWithHoles(subject, clips);

  // 3 — same-net pad connection: thermal gap + spokes, or direct (solid).
  let filled = allowed;
  let thermalAccessCount = 0;
  if (zone.connection === "thermal" && (sameNetPads.length > 0 || sameNetVias.length > 0)) {
    const params = thermalParamsFor(board, zone);
    const gapCutouts: Vec2[][] = [];
    const spokes: Vec2[][] = [];
    for (const { pad, world, worldRotationDeg, inst } of sameNetPads) {
      const { pts, r } = decomposeShape(padWorldShape(inst, pad));
      gapCutouts.push(...inflatePointSet(pts, r + params.gapNm));
      spokes.push(...generateThermalSpokes(pad, world, worldRotationDeg, params));
      thermalAccessCount++;
    }
    for (const via of sameNetVias) {
      gapCutouts.push(circlePolygon(via.at, via.size / 2 + params.gapNm));
      spokes.push(...generateRadialThermalSpokes(via.at, via.size / 2 + 2 * params.gapNm, 0, params));
      thermalAccessCount++;
    }
    const relieved = differenceWithHoles(allowed, gapCutouts);
    const clippedSpokes = intersectionWithHoles(allowed, spokes);
    filled = unionWithHoles(relieved, clippedSpokes);
  }

  // 4 — island removal.
  const rawRegions = toRegions(filled);
  const { keep, dropped } = filterIslandsByConnection(rawRegions, board, zone);

  return {
    regions: keep,
    stats: {
      rawRegions: rawRegions.length,
      islandsDropped: dropped,
      elapsedMs: performance.now() - t0,
      thermalAccessCount,
    },
  };
}
