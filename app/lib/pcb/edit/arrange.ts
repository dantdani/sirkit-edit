/**
 * Arrange math (PCB Stage 17 Phase D) — PURE functions computing per-item
 * position deltas for the `align` / `distribute` / `snap-to-grid` commands.
 * apply.ts compiles the commands through these; the Arrange UI, context menu
 * and palette are thin wrappers over the same commands.
 *
 * Axis convention (Figma-style): left/right/centerH act on X, top/bottom/
 * centerV act on Y. Align targets the selection's bbox union; distribute
 * sorts by center along the axis, anchors first/last, equalizes CENTER
 * spacing; snap-to-grid snaps each item's anchor point (footprint/via `at`,
 * track `start`, text `position`, zone first vertex) and moves the whole
 * item by that delta so geometry never skews.
 */

import type { Vec2, BBox } from "../geometry";
import { transformPoint, bboxUnion } from "../geometry";
import type { PcbBoard, FootprintInstance } from "../types";
import type { SelectionRef } from "./commands";
import { refKey } from "./commands";
import { findTrack, findVia, findZone, findSilkText, findFootprint } from "./validate";

// ── Item geometry (shared with apply.ts) ────────────────────────────────────

export function footprintWorldBBox(fp: FootprintInstance): BBox {
  const b = fp.def.bodyBBox;
  const corners: Vec2[] = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
  let out: BBox | null = null;
  for (const c of corners) {
    const p = transformPoint(c, fp.at, fp.rotationDeg, fp.side === "bottom");
    const box = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
    out = out ? bboxUnion(out, box) : box;
  }
  return out ?? { minX: fp.at.x, minY: fp.at.y, maxX: fp.at.x, maxY: fp.at.y };
}

/** World bbox of one referenced item; null for unknown/pad refs. */
export function refBBox(board: PcbBoard, ref: SelectionRef): BBox | null {
  switch (ref.kind) {
    case "footprint": {
      const fp = findFootprint(board, ref.id);
      return fp ? footprintWorldBBox(fp) : null;
    }
    case "via": {
      const v = findVia(board, ref.id);
      if (!v) return null;
      const r = v.size / 2;
      return { minX: v.at.x - r, minY: v.at.y - r, maxX: v.at.x + r, maxY: v.at.y + r };
    }
    case "track": {
      const t = findTrack(board, ref.id);
      if (!t) return null;
      const r = t.width / 2;
      return {
        minX: Math.min(t.start.x, t.end.x) - r,
        minY: Math.min(t.start.y, t.end.y) - r,
        maxX: Math.max(t.start.x, t.end.x) + r,
        maxY: Math.max(t.start.y, t.end.y) + r,
      };
    }
    case "zone": {
      const z = findZone(board, ref.id);
      if (!z || z.polygon.length === 0) return null;
      let box: BBox | null = null;
      for (const p of z.polygon) {
        const b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
        box = box ? bboxUnion(box, b) : b;
      }
      return box;
    }
    case "text": {
      const item = findSilkText(board, ref.id);
      if (!item) return null;
      return {
        minX: item.position.x,
        minY: item.position.y,
        maxX: item.position.x,
        maxY: item.position.y,
      };
    }
    case "dimension":
    case "pad":
      return null; // pads/dimensions are never arrange targets (validator rejects)
  }
}

/** Selection-bbox center — the default rotate pivot (existing 90° machinery). */
export function selectionBBoxCenter(board: PcbBoard, refs: SelectionRef[]): Vec2 {
  let box: BBox | null = null;
  for (const ref of refs) {
    const b = refBBox(board, ref);
    if (b) box = box ? bboxUnion(box, b) : b;
  }
  if (!box) return { x: 0, y: 0 };
  return { x: Math.round((box.minX + box.maxX) / 2), y: Math.round((box.minY + box.maxY) / 2) };
}

/** The item's anchor point — what snap-to-grid actually snaps. */
export function refAnchor(board: PcbBoard, ref: SelectionRef): Vec2 | null {
  switch (ref.kind) {
    case "footprint":
      return findFootprint(board, ref.id)?.at ?? null;
    case "via":
      return findVia(board, ref.id)?.at ?? null;
    case "track":
      return findTrack(board, ref.id)?.start ?? null;
    case "zone":
      return findZone(board, ref.id)?.polygon[0] ?? null;
    case "text":
      return findSilkText(board, ref.id)?.position ?? null;
    case "dimension":
    case "pad":
      return null;
  }
}

// ── The three arrange computations (refKey → whole-item delta) ──────────────

export type AlignMode = "left" | "right" | "top" | "bottom" | "centerH" | "centerV";

export function computeAlign(
  board: PcbBoard,
  refs: SelectionRef[],
  mode: AlignMode,
): Map<string, Vec2> {
  const boxes: { ref: SelectionRef; box: BBox }[] = [];
  let union: BBox | null = null;
  for (const ref of refs) {
    const box = refBBox(board, ref);
    if (!box) continue;
    boxes.push({ ref, box });
    union = union ? bboxUnion(union, box) : box;
  }
  const deltas = new Map<string, Vec2>();
  if (!union || boxes.length < 2) return deltas;

  for (const { ref, box } of boxes) {
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case "left":
        dx = union.minX - box.minX;
        break;
      case "right":
        dx = union.maxX - box.maxX;
        break;
      case "centerH":
        dx = Math.round((union.minX + union.maxX) / 2 - (box.minX + box.maxX) / 2);
        break;
      case "top":
        dy = union.minY - box.minY;
        break;
      case "bottom":
        dy = union.maxY - box.maxY;
        break;
      case "centerV":
        dy = Math.round((union.minY + union.maxY) / 2 - (box.minY + box.maxY) / 2);
        break;
    }
    deltas.set(refKey(ref), { x: Math.round(dx), y: Math.round(dy) });
  }
  return deltas;
}

export function computeDistribute(
  board: PcbBoard,
  refs: SelectionRef[],
  axis: "h" | "v",
): Map<string, Vec2> {
  const items: { ref: SelectionRef; center: number }[] = [];
  for (const ref of refs) {
    const box = refBBox(board, ref);
    if (!box) continue;
    items.push({
      ref,
      center: axis === "h" ? (box.minX + box.maxX) / 2 : (box.minY + box.maxY) / 2,
    });
  }
  const deltas = new Map<string, Vec2>();
  if (items.length < 3) return deltas;

  items.sort((a, b) => a.center - b.center);
  const first = items[0].center;
  const last = items[items.length - 1].center;
  const step = (last - first) / (items.length - 1);

  items.forEach(({ ref, center }, i) => {
    const target = first + step * i;
    const d = Math.round(target - center);
    deltas.set(refKey(ref), axis === "h" ? { x: d, y: 0 } : { x: 0, y: d });
  });
  return deltas;
}

export function computeSnapToGrid(
  board: PcbBoard,
  refs: SelectionRef[],
  gridNm: number,
): Map<string, Vec2> {
  const deltas = new Map<string, Vec2>();
  if (!(gridNm > 0)) return deltas;
  for (const ref of refs) {
    const anchor = refAnchor(board, ref);
    if (!anchor) continue;
    deltas.set(refKey(ref), {
      x: Math.round(anchor.x / gridNm) * gridNm - anchor.x,
      y: Math.round(anchor.y / gridNm) * gridNm - anchor.y,
    });
  }
  return deltas;
}
