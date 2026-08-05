import type { PcbBoard } from "../types";
import type { BBox, Vec2 } from "../geometry";
import { computePlacementRatsnestProxy } from "../ratsnest";
import { padWorldPosition } from "../geometry-copper";
import { mmToNm } from "../units";
import { bboxesOverlap, courtyardFitsOutline, pointInOutline, worldCourtyardBBox } from "./geometry";
import { buildPlacementEnvelope } from "./envelope";

export interface PinAccessFailure {
  footprintId: string;
  ref: string;
  padNumber: string;
  reason: "outside-board" | "no-escape-corridor";
}

export interface PlacementRouteabilityReport {
  score: number;
  courtyardOverlaps: number;
  footprintsOutside: number;
  padsOutside: number;
  pinAccessFailures: PinAccessFailure[];
  airwireCrossings: number;
  ratsnestLengthNm: number;
  estimatedViaDemand: number;
  congestionScore: number;
}

export interface PlacementRouteabilityOptions {
  envelopeScale?: number;
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function corridorHitsBox(from: Vec2, to: Vec2, box: BBox): boolean {
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  if (maxX < box.minX || minX > box.maxX || maxY < box.minY || minY > box.maxY) return false;
  if (from.x === to.x) return from.x >= box.minX && from.x <= box.maxX;
  if (from.y === to.y) return from.y >= box.minY && from.y <= box.maxY;
  return true;
}

export function analyzePlacementRouteability(
  board: PcbBoard,
  options: PlacementRouteabilityOptions = {},
): PlacementRouteabilityReport {
  const boxes = board.footprints.map((footprint) => ({
    footprint,
    box: worldCourtyardBBox(
      buildPlacementEnvelope(board, footprint, { scale: options.envelopeScale }).effectiveBounds,
      footprint.at,
      footprint.rotationDeg,
      footprint.side === "bottom",
    ),
  }));
  let courtyardOverlaps = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (bboxesOverlap(boxes[i].box, boxes[j].box)) courtyardOverlaps += 1;
    }
  }
  const footprintsOutside = boxes.filter(({ box }) => !courtyardFitsOutline(box, board.outline)).length;
  const pinAccessFailures: PinAccessFailure[] = [];
  let padsOutside = 0;
  const escape = mmToNm(1.25);
  for (const { footprint } of boxes) {
    for (const pad of footprint.def.pads) {
      if (pad.type === "np_thru_hole" || !footprint.padNets[pad.number]) continue;
      const at = padWorldPosition(footprint, pad);
      if (!pointInOutline(at, board.outline)) {
        padsOutside += 1;
        pinAccessFailures.push({ footprintId: footprint.id, ref: footprint.ref, padNumber: pad.number, reason: "outside-board" });
        continue;
      }
      const exits: Vec2[] = [
        { x: at.x + escape, y: at.y },
        { x: at.x - escape, y: at.y },
        { x: at.x, y: at.y + escape },
        { x: at.x, y: at.y - escape },
      ];
      const hasEscape = exits.some(
        (to) =>
          pointInOutline(to, board.outline) &&
          !boxes.some(({ footprint: other, box }) => other.id !== footprint.id && corridorHitsBox(at, to, box)),
      );
      if (!hasEscape) {
        pinAccessFailures.push({
          footprintId: footprint.id,
          ref: footprint.ref,
          padNumber: pad.number,
          reason: "no-escape-corridor",
        });
      }
    }
  }

  const airwires = computePlacementRatsnestProxy(board);
  let ratsnestLengthNm = 0;
  let airwireCrossings = 0;
  for (let i = 0; i < airwires.length; i++) {
    ratsnestLengthNm += Math.hypot(airwires[i].to.x - airwires[i].from.x, airwires[i].to.y - airwires[i].from.y);
    for (let j = i + 1; j < airwires.length; j++) {
      if (airwires[i].netId === airwires[j].netId) continue;
      if (segmentsCross(airwires[i].from, airwires[i].to, airwires[j].from, airwires[j].to)) airwireCrossings += 1;
    }
  }
  const estimatedViaDemand = airwireCrossings + Math.floor(ratsnestLengthNm / mmToNm(30));
  const congestionScore =
    courtyardOverlaps * 1_000 +
    footprintsOutside * 1_000 +
    padsOutside * 500 +
    pinAccessFailures.length * 100 +
    airwireCrossings * 10 +
    ratsnestLengthNm / mmToNm(10);
  return {
    score: Math.round(congestionScore * 100) / 100,
    courtyardOverlaps,
    footprintsOutside,
    padsOutside,
    pinAccessFailures,
    airwireCrossings,
    ratsnestLengthNm,
    estimatedViaDemand,
    congestionScore,
  };
}
