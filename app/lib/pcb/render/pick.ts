/**
 * Hit-testing for the PCB canvas (PCB Stage 3, copper-level since Stage 17) —
 * PURE module, no Pixi.
 *
 * Static flatbush R-tree over item bounding boxes, rebuilt from scratch on
 * every board mutation (thousands of entries build in well under a
 * millisecond — do NOT add incremental indexing). Broad phase = R-tree bbox
 * query; narrow phase = exact point-in-bbox confirmation, or an entry's
 * `hit` closure for shaped items (via circles, track capsules, pad shapes,
 * zone outlines — Stage 17).
 *
 * Priority when overlapping (Stage 17 contract):
 *   outline handle > via > pad > track > text > footprint > zone.
 * Copper/text picks get a fixed model-space tolerance (0.15 mm at-cursor);
 * footprint bbox picks stay exact.
 *
 * All coordinates are integer nanometers, matching the model space.
 */

import Flatbush from "flatbush";
import type { Vec2, BBox, PlacedShape } from "../geometry";
import { shapeDistance, shapeBBox } from "../geometry";
import type { PcbBoard } from "../types";
import { trackShape, padWorldShape, segmentDistance } from "../geometry-copper";
import { silkItemPolylines } from "../silk/geometry";
import { dimensionGeometry, dimensionHitDistanceNm } from "../dimensions/geometry";
import { mmToNm } from "../units";

export type OutlineHandleId = "nw" | "ne" | "sw" | "se" | `v${number}`;

export type PickResult =
  | { kind: "footprint"; id: string }
  | { kind: "outline-handle"; handle: OutlineHandleId }
  // Stage 17: copper-level picking. These mirror SelectionRef shapes exactly.
  | { kind: "via"; id: string }
  | { kind: "track"; id: string }
  | { kind: "zone"; id: string }
  | { kind: "text"; id: string }
  // B08: dimension annotations.
  | { kind: "dimension"; id: string }
  | { kind: "pad"; footprintId: string; padNumber: string };

/** Fixed at-cursor pick tolerance for copper/text items (Stage 17). */
export const PICK_TOLERANCE_NM = mmToNm(0.15);

/** Overlap priority, higher wins. Handles are resolved before the index. */
const PRIORITY: Record<PickResult["kind"], number> = {
  "outline-handle": 100,
  via: 6,
  pad: 5,
  track: 4,
  text: 3,
  dimension: 3,
  footprint: 2,
  zone: 1,
};

export interface PickEntry {
  result: PickResult;
  bbox: BBox;
  /** Exact narrow phase (already tolerance-aware). Absent = point-in-bbox. */
  hit?: (point: Vec2) => boolean;
}

export interface PickIndex {
  /**
   * Topmost entry at a point, or null. Priority per kind (see PRIORITY);
   * within a kind the LAST entry in insertion order wins (paint order).
   * `tolNm` expands the broad-phase query for entries with a `hit` closure;
   * bbox-only entries (footprints) stay exact.
   */
  pickAt(point: Vec2, tolNm?: number): PickResult | null;
  /** Marquee query: every entry whose bbox is fully contained in `rect`. */
  pickIn(rect: BBox): PickResult[];
}

const EMPTY_INDEX: PickIndex = {
  pickAt: () => null,
  pickIn: () => [],
};

export function buildPickIndex(entries: PickEntry[]): PickIndex {
  if (entries.length === 0) return EMPTY_INDEX; // flatbush rejects 0 items

  const tree = new Flatbush(entries.length);
  for (const e of entries) {
    tree.add(e.bbox.minX, e.bbox.minY, e.bbox.maxX, e.bbox.maxY);
  }
  tree.finish();

  return {
    pickAt(point: Vec2, tolNm = 0): PickResult | null {
      const candidates = tree.search(
        point.x - tolNm,
        point.y - tolNm,
        point.x + tolNm,
        point.y + tolNm,
      );
      let best: { result: PickResult; order: number } | null = null;
      for (const i of candidates) {
        const e = entries[i];
        if (e.hit) {
          if (!e.hit(point)) continue;
        } else {
          // Narrow phase: exact (inclusive) point-in-bbox confirmation.
          const b = e.bbox;
          if (point.x < b.minX || point.x > b.maxX || point.y < b.minY || point.y > b.maxY) {
            continue;
          }
        }
        // Kind priority first; ties break to the later entry (paint order).
        const order = PRIORITY[e.result.kind] * 1_000_000_000 + i;
        if (!best || order > best.order) best = { result: e.result, order };
      }
      return best?.result ?? null;
    },

    pickIn(rect: BBox): PickResult[] {
      const candidates = tree.search(rect.minX, rect.minY, rect.maxX, rect.maxY);
      const out: PickResult[] = [];
      for (const i of candidates.sort((a, b) => a - b)) {
        const b = entries[i].bbox;
        if (
          b.minX >= rect.minX &&
          b.maxX <= rect.maxX &&
          b.minY >= rect.minY &&
          b.maxY <= rect.maxY
        ) {
          out.push(entries[i].result);
        }
      }
      return out;
    },
  };
}

// ── Stage 17: board → copper/text pick entries ───────────────────────────────

/** Zero-radius circle — turns shapeDistance into an exact point-to-shape gap. */
function pointShape(p: Vec2): PlacedShape {
  return { shape: { kind: "circle", radius: 0 }, at: p, rotationDeg: 0 };
}

function polylineBBox(lines: Vec2[][], inflateNm: number): BBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of lines) {
    for (const p of line) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (minX === Infinity) return null;
  return {
    minX: minX - inflateNm,
    minY: minY - inflateNm,
    maxX: maxX + inflateNm,
    maxY: maxY + inflateNm,
  };
}

/**
 * Exact-hit pick entries for everything selectable beyond footprints:
 * vias (barrel circle), tracks (capsule), pads (world-transformed shape),
 * zone OUTLINES (edge proximity — the fill interior is deliberately not a
 * hit target), and silk text (stroke bbox). Combine with the footprint bbox
 * entries and feed `buildPickIndex`.
 */
export function buildBoardPickEntries(
  board: PcbBoard,
  tolNm: number = PICK_TOLERANCE_NM,
): PickEntry[] {
  const entries: PickEntry[] = [];

  for (const zone of board.zones) {
    const poly = zone.polygon;
    if (poly.length < 2) continue;
    // Exact bbox: pickAt expands its QUERY by the tolerance, and pickIn's
    // full-containment marquee must not demand tolerance-inflated slack.
    const bbox = polylineBBox([poly], 0);
    if (!bbox) continue;
    entries.push({
      result: { kind: "zone", id: zone.id },
      bbox,
      hit: (p) => {
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % poly.length];
          if (segmentDistance(a, b, p, p) <= tolNm) return true;
        }
        return false;
      },
    });
  }

  for (const track of board.tracks) {
    const shape = trackShape(track);
    entries.push({
      result: { kind: "track", id: track.id },
      bbox: shapeBBox(shape),
      hit: (p) => shapeDistance(shape, pointShape(p)) <= tolNm,
    });
  }

  for (const fp of board.footprints) {
    for (const pad of fp.def.pads) {
      const shape = padWorldShape(fp, pad);
      entries.push({
        result: { kind: "pad", footprintId: fp.id, padNumber: pad.number },
        bbox: shapeBBox(shape),
        hit: (p) => shapeDistance(shape, pointShape(p)) <= tolNm,
      });
    }
  }

  for (const via of board.vias) {
    const r = via.size / 2;
    entries.push({
      result: { kind: "via", id: via.id },
      bbox: {
        minX: via.at.x - r,
        minY: via.at.y - r,
        maxX: via.at.x + r,
        maxY: via.at.y + r,
      },
      hit: (p) => Math.hypot(p.x - via.at.x, p.y - via.at.y) <= r + tolNm,
    });
  }

  // B08: dimension annotations pick on their exact strokes (shared geometry).
  for (const dimension of board.dimensions ?? []) {
    const geometry = dimensionGeometry(dimension);
    entries.push({
      result: { kind: "dimension", id: dimension.id },
      bbox: geometry.bbox,
      hit: (p) => dimensionHitDistanceNm(dimension, p) <= dimension.strokeWidthNm / 2 + tolNm,
    });
  }

  for (const item of board.silkItems ?? []) {
    if (item.kind !== "text") continue; // lines/rects/circles stay silk-tool-owned
    const bbox = polylineBBox(silkItemPolylines(item), Math.round(item.strokeWidthNm / 2));
    if (!bbox) continue;
    entries.push({
      result: { kind: "text", id: item.id },
      bbox,
      hit: (p) =>
        p.x >= bbox.minX - tolNm &&
        p.x <= bbox.maxX + tolNm &&
        p.y >= bbox.minY - tolNm &&
        p.y <= bbox.maxY + tolNm,
    });
  }

  return entries;
}
