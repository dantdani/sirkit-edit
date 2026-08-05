/**
 * Island removal (PCB Stage 11). After the boolean fill, each disjoint region
 * is kept only if it actually connects to the zone's net:
 *
 *   keep ⇔ the region contains a same-net pad, OR overlaps a same-net
 *          track/via that itself connects (via Stage 6 connectivity) to a
 *          same-net pad.
 *
 * Special case: when the board has NO copper on the zone's net at all
 * (no-net zones, or a net that exists only in the schematic), every region is
 * kept — there is nothing to be disconnected FROM, and DRC warns separately.
 *
 * Pad containment tests the OUTER ring only: with a thermal connection the
 * pad center sits inside the annular-gap hole, but the island still connects
 * through the spokes.
 */

import type { PcbBoard, FilledRegion, Zone } from "../types";
import { computeConnectivity } from "../connectivity-board";
import { padCopperLayers, padWorldPosition, viaSpannedLayers } from "../geometry-copper";
import { pointInPolygon, segmentOverlapsRegion, regionContainsPoint } from "./geometry";
import { classifyNetRelation } from "../copper-policy";

export function filterIslandsByConnection(
  rawRegions: FilledRegion[],
  board: PcbBoard,
  zone: Zone,
): { keep: FilledRegion[]; dropped: number } {
  const netId = zone.netId;
  const layer = zone.layer;
  const minimumArea = Math.max(0, zone.minIslandAreaNm2 ?? 0);
  const applyAreaRule = (regions: FilledRegion[]): { keep: FilledRegion[]; dropped: number } => {
    const keep = regions.filter((region) => region.areaNm2 >= minimumArea);
    return { keep, dropped: regions.length - keep.length };
  };

  if (zone.keepUnconnectedIslands) return applyAreaRule([...rawRegions]);

  // Same-net copper on the zone's layer.
  const padCenters: { x: number; y: number }[] = [];
  for (const inst of board.footprints) {
    for (const pad of inst.def.pads) {
      if (pad.type === "np_thru_hole") continue;
      if (classifyNetRelation(board, netId, inst.padNets[pad.number] ?? 0) !== "same-proven-net") continue;
      if (!padCopperLayers(inst, pad).includes(layer)) continue;
      padCenters.push(padWorldPosition(inst, pad));
    }
  }
  const tracks = board.tracks.filter((t) => classifyNetRelation(board, netId, t.netId) === "same-proven-net" && t.layer === layer);
  const vias = board.vias.filter((v) => classifyNetRelation(board, netId, v.netId) === "same-proven-net" && viaSpannedLayers(v).includes(layer));

  // Nothing on this net anywhere on this layer → nothing to connect to; keep all.
  if (padCenters.length === 0 && tracks.length === 0 && vias.length === 0) {
    return applyAreaRule([...rawRegions]);
  }

  // Tracks/vias only anchor an island if they themselves reach a pad of the
  // net (Stage 6 clusters). A floating same-net stub must not rescue an island.
  const anchored = new Set<string>();
  const conn = computeConnectivity(board).nets.get(netId);
  if (conn) {
    for (const cluster of conn.clusters) {
      if (!cluster.some((ref) => ref.kind === "pad")) continue;
      for (const ref of cluster) {
        if (ref.kind === "track" || ref.kind === "via") anchored.add(`${ref.kind}:${ref.id}`);
      }
    }
  }

  const keep: FilledRegion[] = [];
  let dropped = 0;
  for (const region of rawRegions) {
    let connected = padCenters.some((p) => pointInPolygon(p, region.outer));
    if (!connected) {
      connected = vias.some(
        (v) => anchored.has(`via:${v.id}`) && regionContainsPoint(region, v.at),
      );
    }
    if (!connected) {
      connected = tracks.some(
        (t) => anchored.has(`track:${t.id}`) && segmentOverlapsRegion(region, t.start, t.end),
      );
    }
    if (connected) keep.push(region);
    else dropped++;
  }
  const area = applyAreaRule(keep);
  return { keep: area.keep, dropped: dropped + area.dropped };
}
