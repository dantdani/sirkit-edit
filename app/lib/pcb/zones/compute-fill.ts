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
import { generateThermalSpokes } from "./thermals";
import { filterIslandsByConnection } from "./islands";
import type { ComputeFillInput, ComputeFillResult, FilledRegion } from "./types";
import { DEFAULT_BOARD_EDGE_CLEARANCE_NM, thermalParamsFor } from "./types";

interface SameNetPad {
  inst: FootprintInstance;
  pad: Pad;
  world: Vec2;
  worldRotationDeg: number;
}

function toRegions(polys: PolyWithHoles[]): FilledRegion[] {
  const out: FilledRegion[] = [];
  for (const rings of polys) {
    const [outer, ...holes] = rings;
    if (!outer || outer.length < 3) continue;
    out.push({
      outer,
      holes,
      boundingBox: polygonBBox(outer),
      areaNm2: Math.round(regionAreaNm2(outer, holes)),
    });
  }
  return out;
}

export function computeFill(input: ComputeFillInput): ComputeFillResult {
  const t0 = performance.now();
  const { board, zone, effectiveClearance } = input;
  const edgeClearance = input.boardEdgeClearanceNm ?? DEFAULT_BOARD_EDGE_CLEARANCE_NM;
  const layer = zone.layer;

  const empty = (): ComputeFillResult => ({
    regions: [],
    stats: { rawRegions: 0, islandsDropped: 0, elapsedMs: performance.now() - t0 },
  });
  if (zone.polygon.length < 3) return empty();

  // 1 — subject: zone polygon clipped to the outline inset by edge clearance.
  const inset = polygonInflate(outlinePolygon(board.outline), -edgeClearance);
  const subject = polygonIntersection([zone.polygon], inset);
  if (subject.length === 0) return empty();

  // 2 — clearance cutouts around foreign copper on this layer.
  const clips: Vec2[][] = [];
  for (const t of board.tracks) {
    if (t.layer !== layer || t.netId === zone.netId) continue;
    clips.push(capsulePolygon(t.start, t.end, t.width / 2 + effectiveClearance(t.netId, layer)));
  }
  for (const v of board.vias) {
    if (v.netId === zone.netId || !viaSpannedLayers(v).includes(layer)) continue;
    clips.push(circlePolygon(v.at, v.size / 2 + effectiveClearance(v.netId, layer)));
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
      if (netId !== zone.netId) {
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
  // Later-drawn foreign zones on the same layer cut into this fill (draw
  // order precedence: later zones win the contested area).
  const myIndex = board.zones.findIndex((z) => z.id === zone.id);
  for (let i = 0; i < board.zones.length; i++) {
    const other = board.zones[i];
    if (other.layer !== layer || other.netId === zone.netId) continue;
    if (myIndex >= 0 && i <= myIndex) continue;
    if (other.polygon.length < 3) continue;
    clips.push(...polygonInflate(other.polygon, effectiveClearance(other.netId, layer)));
  }

  const allowed = differenceWithHoles(subject, clips);

  // 3 — same-net pad connection: thermal gap + spokes, or direct (solid).
  let filled = allowed;
  if (zone.connection === "thermal" && sameNetPads.length > 0) {
    const params = thermalParamsFor(board, zone);
    const gapCutouts: Vec2[][] = [];
    const spokes: Vec2[][] = [];
    for (const { pad, world, worldRotationDeg, inst } of sameNetPads) {
      const { pts, r } = decomposeShape(padWorldShape(inst, pad));
      gapCutouts.push(...inflatePointSet(pts, r + params.gapNm));
      spokes.push(...generateThermalSpokes(pad, world, worldRotationDeg, params));
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
    },
  };
}
