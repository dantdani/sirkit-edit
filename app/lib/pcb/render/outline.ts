/**
 * Board outline rendering + editing math (PCB Stage 3).
 *
 * The outline renders on the `edge` container as a 0.15 mm amber stroke.
 * rect/roundrect outlines get four corner drag handles; polygon outlines get
 * one handle per vertex (move only — add/remove vertex is post-MVP).
 * `applyHandleDrag` is pure so the editor reducer can own the mutation;
 * dragging clamps to ≥ 10×10 mm and never touches footprints.
 */

import { Graphics } from "pixi.js";
import type { BoardOutline } from "../types";
import { NM_PER_MM, mmToNm } from "../units";
import type { Vec2, BBox } from "../geometry";
import { layerColor } from "./colors";
import type { OutlineHandleId } from "./pick";

export const OUTLINE_STROKE_MM = 0.15;
export const MIN_BOARD_NM = mmToNm(10);

const mm = (nm: number): number => nm / NM_PER_MM;

export function outlineBBoxNm(outline: BoardOutline): BBox {
  if (outline.kind === "polygon") {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of outline.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }
  return {
    minX: outline.origin.x,
    minY: outline.origin.y,
    maxX: outline.origin.x + outline.width,
    maxY: outline.origin.y + outline.height,
  };
}

/** Draw the outline into `g` (world mm), 0.15 mm stroke in the edge color. */
export function drawOutline(g: Graphics, outline: BoardOutline): void {
  g.clear();
  const stroke = { width: OUTLINE_STROKE_MM, color: layerColor("edge") };
  if (outline.kind === "rect") {
    g.rect(
      mm(outline.origin.x),
      mm(outline.origin.y),
      mm(outline.width),
      mm(outline.height),
    ).stroke(stroke);
    return;
  }
  if (outline.kind === "roundrect") {
    const r = Math.min(mm(outline.cornerRadius), mm(outline.width) / 2, mm(outline.height) / 2);
    g.roundRect(
      mm(outline.origin.x),
      mm(outline.origin.y),
      mm(outline.width),
      mm(outline.height),
      r,
    ).stroke(stroke);
    return;
  }
  const pts: number[] = [];
  for (const p of outline.points) pts.push(mm(p.x), mm(p.y));
  if (pts.length >= 6) g.poly(pts, true).stroke(stroke);
}

export interface HandleSpot {
  handle: OutlineHandleId;
  /** Handle centre, integer nm. */
  x: number;
  y: number;
}

/** Drag-handle positions for an outline (corners, or one per polygon vertex). */
export function outlineHandleSpots(outline: BoardOutline): HandleSpot[] {
  if (outline.kind === "polygon") {
    return outline.points.map((p, i) => ({ handle: `v${i}` as const, x: p.x, y: p.y }));
  }
  const { x, y } = outline.origin;
  const w = outline.width;
  const h = outline.height;
  return [
    { handle: "nw", x, y },
    { handle: "ne", x: x + w, y },
    { handle: "sw", x, y: y + h },
    { handle: "se", x: x + w, y: y + h },
  ];
}

/**
 * Move one handle to `world` (nm) and return the new outline. Rect/roundrect
 * corners resize against the fixed opposite corner, clamped to ≥ 10×10 mm.
 * Polygon vertices move freely. Never mutates its input.
 */
export function applyHandleDrag(
  outline: BoardOutline,
  handle: OutlineHandleId,
  world: Vec2,
): BoardOutline {
  if (outline.kind === "polygon") {
    if (!handle.startsWith("v")) return outline;
    const i = Number(handle.slice(1));
    if (!Number.isInteger(i) || i < 0 || i >= outline.points.length) return outline;
    const points = outline.points.map((p, j) =>
      j === i ? { x: Math.round(world.x), y: Math.round(world.y) } : p,
    );
    return { ...outline, points };
  }

  // Opposite corner stays fixed; the dragged corner follows the pointer but
  // may not cross within MIN_BOARD_NM of the fixed edges (no corner flipping).
  const { x, y } = outline.origin;
  const w = outline.width;
  const h = outline.height;
  const fixedX = handle === "nw" || handle === "sw" ? x + w : x;
  const fixedY = handle === "nw" || handle === "ne" ? y + h : y;
  const isRightHandle = handle === "ne" || handle === "se";
  const isBottomHandle = handle === "sw" || handle === "se";

  const newX = isRightHandle
    ? Math.max(Math.round(world.x), fixedX + MIN_BOARD_NM)
    : Math.min(Math.round(world.x), fixedX - MIN_BOARD_NM);
  const newY = isBottomHandle
    ? Math.max(Math.round(world.y), fixedY + MIN_BOARD_NM)
    : Math.min(Math.round(world.y), fixedY - MIN_BOARD_NM);

  return {
    ...outline,
    origin: { x: Math.min(fixedX, newX), y: Math.min(fixedY, newY) },
    width: Math.abs(newX - fixedX),
    height: Math.abs(newY - fixedY),
  };
}
