/**
 * Hit-testing for the PCB canvas (PCB Stage 3) — PURE module, no Pixi.
 *
 * Static flatbush R-tree over instance bounding boxes, rebuilt from scratch on
 * every board mutation (thousands of entries build in well under a
 * millisecond — do NOT add incremental indexing). Broad phase = R-tree bbox
 * query; narrow phase = exact point-in-bbox confirmation (bbox-level picking
 * is the Stage 3 contract; exact pad-level picking arrives in Stage 5).
 *
 * All coordinates are integer nanometers, matching the model space.
 */

import Flatbush from "flatbush";
import type { Vec2, BBox } from "../geometry";

export type OutlineHandleId = "nw" | "ne" | "sw" | "se" | `v${number}`;

export type PickResult =
  | { kind: "footprint"; id: string }
  | { kind: "outline-handle"; handle: OutlineHandleId };

export interface PickEntry {
  result: PickResult;
  bbox: BBox;
}

export interface PickIndex {
  /**
   * Topmost entry at a point, or null. Outline handles win over footprints;
   * among footprints the LAST entry in insertion order wins (paint order).
   */
  pickAt(point: Vec2): PickResult | null;
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
    pickAt(point: Vec2): PickResult | null {
      const candidates = tree.search(point.x, point.y, point.x, point.y);
      let best: { result: PickResult; order: number } | null = null;
      for (const i of candidates) {
        const e = entries[i];
        const b = e.bbox;
        // Narrow phase: exact (inclusive) point-in-bbox confirmation.
        if (point.x < b.minX || point.x > b.maxX || point.y < b.minY || point.y > b.maxY) {
          continue;
        }
        // Handles always beat footprints; ties break to the later entry.
        const isHandle = e.result.kind === "outline-handle";
        const order = (isHandle ? 1_000_000_000 : 0) + i;
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
