/**
 * Internal geometry helpers for auto-place (PCB Stage 8).
 *
 * The courtyard-bbox semantics deliberately MIRROR Stage 5's select-move tool
 * (its helpers are private to that module, which is read-only for this stage):
 * courtyard = def.courtyardBBox, falling back to bodyBBox inflated by 0.25 mm;
 * collision = STRICT world-bbox overlap (shared edges do not collide). Exact
 * polygon courtyards are Stage 12's DRC problem.
 */

import type { FootprintDef, BoardOutline } from "../types";
import type { Vec2, BBox } from "../geometry";
import { transformPoint } from "../geometry";
import { mmToNm } from "../units";

/** bodyBBox inflation when a def has no courtyard layer (Stage 5 convention). */
const COURTYARD_FALLBACK_NM = mmToNm(0.25);

export function localCourtyardBBox(def: FootprintDef): BBox {
  if (def.courtyardBBox) return def.courtyardBBox;
  const b = def.bodyBBox;
  return {
    minX: b.minX - COURTYARD_FALLBACK_NM,
    minY: b.minY - COURTYARD_FALLBACK_NM,
    maxX: b.maxX + COURTYARD_FALLBACK_NM,
    maxY: b.maxY + COURTYARD_FALLBACK_NM,
  };
}

/** Axis-aligned world bbox of a local bbox under mirror → rotate → translate. */
export function worldCourtyardBBox(local: BBox, at: Vec2, rotationDeg: number, mirrorX: boolean): BBox {
  const corners: Vec2[] = [
    { x: local.minX, y: local.minY },
    { x: local.maxX, y: local.minY },
    { x: local.maxX, y: local.maxY },
    { x: local.minX, y: local.maxY },
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    const p = transformPoint(c, at, rotationDeg, mirrorX);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Strict overlap — shared edges do not violate (Stage 5 convention). */
export function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

export function outlineBBox(outline: BoardOutline): BBox {
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

export function outlineCenter(outline: BoardOutline): Vec2 {
  const b = outlineBBox(outline);
  return { x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2) };
}

function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInOutline(p: Vec2, outline: BoardOutline): boolean {
  if (outline.kind === "polygon") return pointInPolygon(p, outline.points);
  const b = outlineBBox(outline);
  if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) return false;
  if (outline.kind === "roundrect") return cornerOk(p, b, outline.cornerRadius);
  return true;
}

/** Inside the bbox: also inside the four corner arcs of a roundrect. */
function cornerOk(p: Vec2, b: BBox, r: number): boolean {
  const cx = p.x < b.minX + r ? b.minX + r : p.x > b.maxX - r ? b.maxX - r : null;
  const cy = p.y < b.minY + r ? b.minY + r : p.y > b.maxY - r ? b.maxY - r : null;
  if (cx === null || cy === null) return true; // not in a corner square
  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * True when the world courtyard bbox sits entirely inside the outline.
 * Rect: exact containment. Roundrect: containment + all four bbox corners
 * inside the corner arcs. Polygon: all four bbox corners inside (exact for
 * convex outlines; concave outlines may accept a bbox spanning a notch —
 * Stage 12's DRC surfaces those).
 */
export function courtyardFitsOutline(box: BBox, outline: BoardOutline): boolean {
  const corners: Vec2[] = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  if (outline.kind === "polygon") return corners.every((c) => pointInPolygon(c, outline.points));
  const b = outlineBBox(outline);
  if (box.minX < b.minX || box.maxX > b.maxX || box.minY < b.minY || box.maxY > b.maxY) return false;
  if (outline.kind === "roundrect") return corners.every((c) => cornerOk(c, b, outline.cornerRadius));
  return true;
}

/**
 * Nearest in-outline point to `p` — the boundary-force target. Rect-like
 * outlines clamp into the bbox (corner radius ignored: the force is soft;
 * the hard clip in the collision resolver is exact). Polygons project onto
 * the nearest edge when outside.
 */
export function nearestPointInOutline(p: Vec2, outline: BoardOutline): Vec2 {
  if (outline.kind !== "polygon") {
    const b = outlineBBox(outline);
    return {
      x: Math.min(Math.max(p.x, b.minX), b.maxX),
      y: Math.min(Math.max(p.y, b.minY), b.maxY),
    };
  }
  if (pointInPolygon(p, outline.points)) return p;
  let best: Vec2 = outline.points[0] ?? p;
  let bestD = Infinity;
  const pts = outline.points;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j];
    const b = pts[i];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    let t = 0;
    if (len2 > 0) {
      t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const q = { x: a.x + t * abx, y: a.y + t * aby };
    const dx = p.x - q.x;
    const dy = p.y - q.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = { x: Math.round(q.x), y: Math.round(q.y) };
    }
  }
  return best;
}
