/**
 * Zone-fill DRC (PCB Stage 11 → wired into Stage 12's run-drc.ts where the
 * TODO(stage11) marker sat). Three checks over every `Zone.fill` region:
 *
 *  1. zone-to-copper clearance: region vs every FOREIGN-net track/via/pad on
 *     the zone's layer; threshold = max(zone net rules, item net rules)
 *     clearance. Fills are poured with that clearance subtracted, so this
 *     only fires when the pour used a smaller `clearanceOverrideNm` than the
 *     rules demand (or the board mutated and the re-fill hasn't run).
 *     Touching (d ≤ 0) is a SHORT — the connectivity check owns those.
 *  2. zone-to-edge: region vs board outline, threshold minEdgeClearanceNm.
 *  3. no-net zone: warning (netId 0 pours are almost always a mistake).
 *
 * Hatched appearance is irrelevant here — every fill is checked as solid.
 */

import type { Vec2, BBox, PlacedShape } from "../geometry";
import { shapeBBox, shapeDistance } from "../geometry";
import type { PcbBoard, FilledRegion, Zone } from "../types";
import type { LayerId } from "../layers";
import { padCopperLayers, padWorldPosition, padWorldShape, trackShape, viaShape, viaSpannedLayers } from "../geometry-copper";
import type { CopperItemRef } from "../connectivity-board";
import type { DrcCheckContext, DrcViolation } from "../drc/types";
import { fmtMm, layerName, violationId } from "../drc/format";
import { edgeShape, outlineSegments, regionShapeDistance } from "./geometry";
import { classifyNetRelation } from "../copper-policy";
import { zoneFillIsCurrent } from "./fill-lifecycle";

interface CopperCandidate {
  ref: CopperItemRef;
  netId: number;
  shape: PlacedShape;
  anchor: Vec2; // a point inside the copper (containment side of regionShapeDistance)
  bbox: BBox;
}

function collectForeignCopper(board: PcbBoard, layer: LayerId, zoneNetId: number): CopperCandidate[] {
  const out: CopperCandidate[] = [];
  for (const t of board.tracks) {
    if (t.layer !== layer || classifyNetRelation(board, zoneNetId, t.netId) === "same-proven-net") continue;
    const shape = trackShape(t);
    out.push({ ref: { kind: "track", id: t.id }, netId: t.netId, shape, anchor: t.start, bbox: shapeBBox(shape) });
  }
  for (const v of board.vias) {
    if (classifyNetRelation(board, zoneNetId, v.netId) === "same-proven-net" || !viaSpannedLayers(v).includes(layer)) continue;
    const shape = viaShape(v);
    out.push({ ref: { kind: "via", id: v.id }, netId: v.netId, shape, anchor: v.at, bbox: shapeBBox(shape) });
  }
  for (const inst of board.footprints) {
    for (const pad of inst.def.pads) {
      if (pad.type === "np_thru_hole") continue;
      if (!padCopperLayers(inst, pad).includes(layer)) continue;
      const netId = inst.padNets[pad.number] ?? 0;
      if (classifyNetRelation(board, zoneNetId, netId) === "same-proven-net") continue;
      const shape = padWorldShape(inst, pad);
      out.push({
        ref: { kind: "pad", instanceId: inst.id, padNumber: pad.number },
        netId,
        shape,
        anchor: padWorldPosition(inst, pad),
        bbox: shapeBBox(shape),
      });
    }
  }
  return out;
}

function bboxesWithin(a: BBox, b: BBox, gap: number): boolean {
  return (
    a.minX - gap <= b.maxX && a.maxX + gap >= b.minX && a.minY - gap <= b.maxY && a.maxY + gap >= b.minY
  );
}

function regionRef(zone: Zone, regionIndex: number): CopperItemRef {
  return { kind: "zone-region", zoneId: zone.id, regionIndex };
}

function minEdgeDistance(region: FilledRegion, outlineSegs: [Vec2, Vec2][]): number {
  let min = Infinity;
  const ring = region.outer;
  for (const [a, b] of outlineSegs) {
    const seg = edgeShape(a, b);
    for (let i = 0; i < ring.length; i++) {
      const d = shapeDistance(edgeShape(ring[i], ring[(i + 1) % ring.length]), seg);
      if (d < min) min = d;
      if (min <= 0) return min;
    }
  }
  return min;
}

export function checkZoneFills(ctx: DrcCheckContext): DrcViolation[] {
  const { board } = ctx;
  const out: DrcViolation[] = [];
  const outlineSegs = outlineSegments(board.outline);

  for (const zone of board.zones) {
    if (!zoneFillIsCurrent(board, zone) || zone.fill.length === 0) continue;
    const zoneEff = ctx.eff(zone.netId);

    if (zone.netId === 0) {
      const loc = zone.polygon[0] ?? { x: 0, y: 0 };
      out.push({
        id: violationId("unconnected", [regionRef(zone, 0)], 0, 0, zone.id),
        kind: "unconnected",
        severity: "warning",
        items: [regionRef(zone, 0)],
        layer: zone.layer,
        location: { x: loc.x, y: loc.y },
        measuredNm: 0,
        thresholdNm: 0,
        summary: `A copper zone on ${layerName(zone.layer)} has no net assigned.`,
        detail: `This zone pours copper that isn't connected to any net. Assign a net (usually GND) or delete the zone — floating copper is an EMI antenna and confuses fabrication reviews.`,
      });
    }

    const foreign = collectForeignCopper(board, zone.layer, zone.netId);
    const seenPairs = new Set<string>();

    zone.fill.forEach((region, regionIndex) => {
      // 1 — clearance to foreign copper.
      for (const item of foreign) {
        const itemEff = ctx.eff(item.netId);
        const threshold = Math.max(zoneEff.clearanceNm, itemEff.clearanceNm);
        if (!bboxesWithin(region.boundingBox, item.bbox, threshold)) continue;
        const d = regionShapeDistance(region, item.shape, item.anchor);
        if (d <= 0 || d >= threshold) continue; // touching = short (connectivity check owns it)
        const pairKey = `${zone.id}|${JSON.stringify(item.ref)}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        const items = [regionRef(zone, regionIndex), item.ref];
        const where = layerName(zone.layer);
        out.push({
          id: violationId("clearance", items, d, threshold),
          kind: "clearance",
          severity: "error",
          items,
          layer: zone.layer,
          location: { ...item.anchor },
          measuredNm: d,
          thresholdNm: threshold,
          summary: `Zone copper on ${where} is ${fmtMm(d)} mm from other-net copper; need ≥ ${fmtMm(threshold)} mm.`,
          detail: `A filled zone approaches copper on a different net closer than the rules allow (${fmtMm(d)} mm measured, ${fmtMm(threshold)} mm required). Raise the zone's clearance (or remove its override) and re-fill.`,
        });
      }

      // 2 — edge clearance.
      const edgeD = minEdgeDistance(region, outlineSegs);
      if (edgeD < zoneEff.minEdgeClearanceNm) {
        const items = [regionRef(zone, regionIndex)];
        out.push({
          id: violationId("edgeClearance", items, edgeD, zoneEff.minEdgeClearanceNm, zone.id),
          kind: "edgeClearance",
          severity: "error",
          items,
          layer: zone.layer,
          location: {
            x: Math.round((region.boundingBox.minX + region.boundingBox.maxX) / 2),
            y: Math.round((region.boundingBox.minY + region.boundingBox.maxY) / 2),
          },
          measuredNm: edgeD,
          thresholdNm: zoneEff.minEdgeClearanceNm,
          summary: `Zone copper is ${fmtMm(edgeD)} mm from the board edge; need ≥ ${fmtMm(zoneEff.minEdgeClearanceNm)} mm.`,
          detail: `A filled zone sits ${fmtMm(edgeD)} mm from the board outline — inside the ${fmtMm(zoneEff.minEdgeClearanceNm)} mm edge keep-out this fab requires. Re-fill with a larger board-edge clearance.`,
        });
      }
    });
  }

  return out;
}
