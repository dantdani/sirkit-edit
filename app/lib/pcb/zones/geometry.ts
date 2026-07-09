/**
 * Zone geometry helpers (PCB Stage 11) — pure, integer-nm in/out, no clipping
 * library involved. Everything the fill engine, island filter, DRC zone check
 * and connectivity extension need that isn't a boolean op:
 *
 * - polygonization of copper shapes (circles, capsules, board outlines, pads)
 *   with CIRCUMSCRIBED arcs, so an approximated clearance cutout is never
 *   smaller than the true inflation (fills err on the safe side — DRC clean);
 * - point/segment vs polygon predicates;
 * - `regionShapeDistance`: hole-aware distance from a FilledRegion to any
 *   Stage 1 `PlacedShape` (the zone analogue of geometry-copper's pair
 *   distances; ≤ 0 means touching/overlap).
 *
 * Rotation convention matches Stage 1 geometry.ts (KiCad CCW, +y down).
 */

import type { Nm } from "../units";
import type { Vec2, BBox, PlacedShape } from "../geometry";
import { shapeDistance } from "../geometry";
import type { BoardOutline, FilledRegion } from "../types";

const DEG_TO_RAD = Math.PI / 180;

/** Chords per full circle when polygonizing round copper. */
export const CIRCLE_SEGMENTS = 16;
/** Chords per semicircular capsule end cap. */
export const CAPSULE_ARC_SEGMENTS = 8;

const round = (v: number): Nm => Math.round(v) + 0;

/** Stage 1 rotation: x' = x·cosθ + y·sinθ, y' = −x·sinθ + y·cosθ (CCW, +y down). */
function rotate(x: number, y: number, rotationDeg: number): { x: number; y: number } {
  if (rotationDeg === 0) return { x, y };
  const c = Math.cos(rotationDeg * DEG_TO_RAD);
  const s = Math.sin(rotationDeg * DEG_TO_RAD);
  return { x: x * c + y * s, y: -x * s + y * c };
}

export function polygonBBox(pts: readonly Vec2[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Unsigned shoelace area of one ring (doubles; stats-grade precision). */
export function ringAreaNm2(ring: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return Math.abs(sum / 2);
}

/** Net copper area of a region: outer minus holes. */
export function regionAreaNm2(outer: readonly Vec2[], holes: readonly Vec2[][]): number {
  let area = ringAreaNm2(outer);
  for (const h of holes) area -= ringAreaNm2(h);
  return Math.max(area, 0);
}

/** Ray-casting point-in-polygon (boundary points may land either way). */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
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

/** Inside the outer ring AND outside every hole. */
export function regionContainsPoint(region: FilledRegion, p: Vec2): boolean {
  if (!pointInPolygon(p, region.outer)) return false;
  for (const hole of region.holes) {
    if (pointInPolygon(p, hole)) return false;
  }
  return true;
}

/**
 * Regular polygon CONTAINING the disk (circumscribed: vertex radius
 * r / cos(π/n)), so cutouts inflated this way never under-clear.
 */
export function circlePolygon(center: Vec2, radius: number, segments = CIRCLE_SEGMENTS): Vec2[] {
  const rr = radius / Math.cos(Math.PI / segments);
  const pts: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pts.push({ x: round(center.x + rr * Math.cos(a)), y: round(center.y + rr * Math.sin(a)) });
  }
  return pts;
}

/**
 * Stadium polygon around segment a→b swept by `radius`, circumscribed end
 * caps. Degenerates to `circlePolygon` when a === b.
 */
export function capsulePolygon(
  a: Vec2,
  b: Vec2,
  radius: number,
  arcSegments = CAPSULE_ARC_SEGMENTS,
): Vec2[] {
  if (a.x === b.x && a.y === b.y) return circlePolygon(a, radius, arcSegments * 2);
  const theta = Math.atan2(b.y - a.y, b.x - a.x);
  const rr = radius / Math.cos(Math.PI / (2 * arcSegments));
  const pts: Vec2[] = [];
  const arc = (c: Vec2, from: number): void => {
    for (let i = 0; i <= arcSegments; i++) {
      const ang = from + (Math.PI * i) / arcSegments;
      pts.push({ x: round(c.x + rr * Math.cos(ang)), y: round(c.y + rr * Math.sin(ang)) });
    }
  };
  // Half-disk around b (right cap), then around a (left cap); the straight
  // sides emerge between the cap endpoints.
  arc(b, theta - Math.PI / 2);
  arc(a, theta + Math.PI / 2);
  return pts;
}

/** Board outline as one polygon ring (roundrect corners as chord arcs). */
export function outlinePolygon(outline: BoardOutline, cornerSegments = 4): Vec2[] {
  if (outline.kind === "polygon") return outline.points.map((p) => ({ ...p }));
  const { x, y } = outline.origin;
  const w = outline.width;
  const h = outline.height;
  if (outline.kind === "roundrect") {
    const r = Math.min(outline.cornerRadius, w / 2, h / 2);
    if (r > 0) {
      const pts: Vec2[] = [];
      const arc = (cx: number, cy: number, a0: number, a1: number): void => {
        for (let i = 0; i <= cornerSegments; i++) {
          const a = a0 + ((a1 - a0) * i) / cornerSegments;
          pts.push({ x: round(cx + r * Math.cos(a)), y: round(cy + r * Math.sin(a)) });
        }
      };
      arc(x + r, y + r, Math.PI, Math.PI * 1.5);
      arc(x + w - r, y + r, Math.PI * 1.5, Math.PI * 2);
      arc(x + w - r, y + h - r, 0, Math.PI * 0.5);
      arc(x + r, y + h - r, Math.PI * 0.5, Math.PI);
      return pts;
    }
  }
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** Board outline boundary as segments (roundrect corners as chord arcs). */
export function outlineSegments(outline: BoardOutline, cornerSegments = 4): [Vec2, Vec2][] {
  const ring = outlinePolygon(outline, cornerSegments);
  const segs: [Vec2, Vec2][] = [];
  for (let i = 0; i < ring.length; i++) segs.push([ring[i], ring[(i + 1) % ring.length]]);
  return segs;
}

/**
 * Minkowski decomposition of a placed shape in WORLD coordinates: a point set
 * plus an inflation radius (mirrors Stage 1 geometry.ts's private
 * `decompose`, which we may not import — read-only file). The shape is the
 * point hull swept by a disk of radius `r`; inflating a shape by `extra`
 * means sweeping the same points by `r + extra`.
 */
export function decomposeShape(s: PlacedShape): { pts: Vec2[]; r: number } {
  const { at, rotationDeg } = s;
  const place = (x: number, y: number): Vec2 => {
    const p = rotate(x, y, rotationDeg);
    return { x: round(p.x + at.x), y: round(p.y + at.y) };
  };
  const sh = s.shape;
  switch (sh.kind) {
    case "circle":
      return { pts: [{ x: at.x, y: at.y }], r: sh.radius };
    case "rect": {
      const hw = sh.width / 2;
      const hh = sh.height / 2;
      return { pts: [place(-hw, -hh), place(hw, -hh), place(hw, hh), place(-hw, hh)], r: 0 };
    }
    case "roundrect": {
      const cr = Math.min(sh.cornerRadius, sh.width / 2, sh.height / 2);
      const hw = sh.width / 2 - cr;
      const hh = sh.height / 2 - cr;
      return { pts: [place(-hw, -hh), place(hw, -hh), place(hw, hh), place(-hw, hh)], r: cr };
    }
    case "oval": {
      if (sh.width === sh.height) return { pts: [{ x: at.x, y: at.y }], r: sh.width / 2 };
      if (sh.width > sh.height) {
        const half = (sh.width - sh.height) / 2;
        return { pts: [place(-half, 0), place(half, 0)], r: sh.height / 2 };
      }
      const half = (sh.height - sh.width) / 2;
      return { pts: [place(0, -half), place(0, half)], r: sh.width / 2 };
    }
    case "polygon":
      return { pts: sh.points.map((p) => place(p.x, p.y)), r: 0 };
  }
}

/** Max distance from a shape's placement center to its boundary (spoke sizing). */
export function shapeOuterBoundNm(s: PlacedShape): number {
  const { pts, r } = decomposeShape(s);
  let max = 0;
  for (const p of pts) {
    const d = Math.hypot(p.x - s.at.x, p.y - s.at.y);
    if (d > max) max = d;
  }
  return Math.ceil(max + r);
}

/** A bare segment as a PlacedShape (2-point polygon) for shapeDistance calls. */
export function edgeShape(a: Vec2, b: Vec2): PlacedShape {
  return { shape: { kind: "polygon", points: [a, b] }, at: { x: 0, y: 0 }, rotationDeg: 0 };
}

/**
 * Hole-aware distance from a filled region to a placed shape; ≤ 0 means
 * touching/overlap. `anchor` must be a point INSIDE the shape's copper
 * (track endpoint, via/pad center) — it decides containment when the shape
 * has no boundary contact with the region. Exact for the sign; the negative
 * magnitude is depth-to-boundary, not true penetration (same contract as
 * Stage 1's shapeDistance).
 */
export function regionShapeDistance(region: FilledRegion, shape: PlacedShape, anchor: Vec2): Nm {
  let d = Infinity;
  const rings = [region.outer, ...region.holes];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const dd = shapeDistance(edgeShape(ring[i], ring[(i + 1) % ring.length]), shape);
      if (dd < d) d = dd;
      if (d <= 0) return d; // boundary contact/crossing — sign settled
    }
  }
  return regionContainsPoint(region, anchor) ? -d : d;
}

/**
 * Does segment a→b overlap the region's copper? True when an endpoint sits in
 * the copper or the segment crosses the outer boundary. (Island scoring —
 * boundary-grazing precision is not required.)
 */
export function segmentOverlapsRegion(region: FilledRegion, a: Vec2, b: Vec2): boolean {
  if (regionContainsPoint(region, a) || regionContainsPoint(region, b)) return true;
  const seg = edgeShape(a, b);
  const ring = region.outer;
  for (let i = 0; i < ring.length; i++) {
    if (shapeDistance(edgeShape(ring[i], ring[(i + 1) % ring.length]), seg) <= 0) return true;
  }
  return false;
}
