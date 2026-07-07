// Geometry kit for the PCB core. All coordinates are integer nanometers
// (`Nm`), +x right, +y DOWN — see units.ts. Doubles are used for intermediate
// math; results are rounded back to integers (1 nm epsilon).
//
// Rotation convention (KiCad): positive `rotationDeg` rotates counter-
// clockwise as seen on screen. With +y down that is
//   x' = x·cosθ + y·sinθ
//   y' = −x·sinθ + y·cosθ
// so (1, 0) rotated +90° lands at (0, −1) (screen up).

import type { Nm } from "./units";

export interface Vec2 {
  x: Nm;
  y: Nm;
}

export interface BBox {
  minX: Nm;
  minY: Nm;
  maxX: Nm;
  maxY: Nm;
}

export type PadShape =
  | { kind: "circle"; radius: Nm }
  | { kind: "rect"; width: Nm; height: Nm }
  | { kind: "roundrect"; width: Nm; height: Nm; cornerRadius: Nm }
  | { kind: "oval"; width: Nm; height: Nm }
  | { kind: "polygon"; points: Vec2[] }; // relative to shape origin, unrotated

export interface PlacedShape {
  shape: PadShape;
  at: Vec2;
  rotationDeg: number;
}

const DEG_TO_RAD = Math.PI / 180;

/** Round to integer nm, normalizing -0 to +0 (JSON/deep-equal safety). */
function roundNm(v: number): Nm {
  return Math.round(v) + 0;
}

/** Double-precision point, internal only. */
interface DVec {
  x: number;
  y: number;
}

function rotateD(x: number, y: number, rotationDeg: number): DVec {
  if (rotationDeg === 0) return { x, y };
  const c = Math.cos(rotationDeg * DEG_TO_RAD);
  const s = Math.sin(rotationDeg * DEG_TO_RAD);
  return { x: x * c + y * s, y: -x * s + y * c };
}

/**
 * Transform a local point into world space: mirror (x → −x) if `mirrorX`,
 * then rotate by `rotationDeg` (see convention above), then translate by `at`.
 */
export function transformPoint(
  p: Vec2,
  at: Vec2,
  rotationDeg: number,
  mirrorX?: boolean,
): Vec2 {
  const x = mirrorX ? -p.x : p.x;
  const r = rotateD(x, p.y, rotationDeg);
  return { x: roundNm(r.x + at.x), y: roundNm(r.y + at.y) };
}

export function bboxUnion(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function bboxOfDPoints(pts: DVec[], inflate: number): BBox {
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
  // Conservative rounding: floor mins, ceil maxes (-0 normalized to +0).
  return {
    minX: Math.floor(minX - inflate) + 0,
    minY: Math.floor(minY - inflate) + 0,
    maxX: Math.ceil(maxX + inflate) + 0,
    maxY: Math.ceil(maxY + inflate) + 0,
  };
}

/**
 * Minkowski decomposition of a placed shape: a point set (world coordinates,
 * doubles) plus an inflation radius. The shape is the Minkowski sum of the
 * polygon/segment/point hull of `pts` with a disk of radius `r`. This is
 * exact for circle, rect, roundrect (inner rect + corner disk) and oval
 * (spine segment + end disk); pad polygons are their own point set (r = 0)
 * and may be non-convex.
 */
interface Decomposed {
  pts: DVec[];
  r: number;
}

function decompose(s: PlacedShape): Decomposed {
  const { at, rotationDeg } = s;
  const place = (x: number, y: number): DVec => {
    const p = rotateD(x, y, rotationDeg);
    return { x: p.x + at.x, y: p.y + at.y };
  };
  const sh = s.shape;
  switch (sh.kind) {
    case "circle":
      return { pts: [{ x: at.x, y: at.y }], r: sh.radius };
    case "rect": {
      const hw = sh.width / 2;
      const hh = sh.height / 2;
      return {
        pts: [place(-hw, -hh), place(hw, -hh), place(hw, hh), place(-hw, hh)],
        r: 0,
      };
    }
    case "roundrect": {
      // Inner rect of the straight edges + corner disks. Clamp the corner
      // radius so a malformed radius > min(w, h)/2 degrades to an oval-ish
      // shape instead of an inverted rect.
      const cr = Math.min(sh.cornerRadius, sh.width / 2, sh.height / 2);
      const hw = sh.width / 2 - cr;
      const hh = sh.height / 2 - cr;
      return {
        pts: [place(-hw, -hh), place(hw, -hh), place(hw, hh), place(-hw, hh)],
        r: cr,
      };
    }
    case "oval": {
      // Stadium: spine segment along the long axis + end disks.
      if (sh.width === sh.height) {
        return { pts: [{ x: at.x, y: at.y }], r: sh.width / 2 };
      }
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

export function shapeBBox(s: PlacedShape): BBox {
  const d = decompose(s);
  return bboxOfDPoints(d.pts, d.r);
}

// ── Low-level distance primitives (doubles) ─────────────────────────────────

function pointSegDist(p: DVec, a: DVec, b: DVec): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  let t = 0;
  if (len2 > 0) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const dx = p.x - (a.x + t * abx);
  const dy = p.y - (a.y + t * aby);
  return Math.hypot(dx, dy);
}

function orient(a: DVec, b: DVec, c: DVec): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: DVec, b: DVec, p: DVec): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

function segmentsIntersect(p1: DVec, p2: DVec, p3: DVec, p4: DVec): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
}

function segSegDist(p1: DVec, p2: DVec, p3: DVec, p4: DVec): number {
  if (segmentsIntersect(p1, p2, p3, p4)) return 0;
  return Math.min(
    pointSegDist(p1, p3, p4),
    pointSegDist(p2, p3, p4),
    pointSegDist(p3, p1, p2),
    pointSegDist(p4, p1, p2),
  );
}

/** Ray-casting point-in-polygon; boundary contact is handled by segSegDist. */
function pointInPoly(p: DVec, poly: DVec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Edges of a point set: a point yields a degenerate segment, 2 points one
 * segment, ≥3 points a closed polygon boundary. */
function edges(pts: DVec[]): [DVec, DVec][] {
  if (pts.length === 1) return [[pts[0], pts[0]]];
  if (pts.length === 2) return [[pts[0], pts[1]]];
  const out: [DVec, DVec][] = [];
  for (let i = 0; i < pts.length; i++) {
    out.push([pts[i], pts[(i + 1) % pts.length]]);
  }
  return out;
}

/**
 * Minimum gap between two placed shapes; <= 0 when touching or overlapping.
 *
 * Exact (up to double precision + 1 nm rounding) for every pair of circle /
 * rect / roundrect / oval, and for disjoint polygon pads: each shape reduces
 * to a point set + inflation radius (Minkowski decomposition, see above), so
 * the gap is the minimum boundary-to-boundary segment distance minus both
 * radii. Containment with no boundary crossing is detected by point-in-
 * polygon tests. When the underlying point sets overlap the result is
 * −(rA + rB) (or 0 for two zero-radius shapes) — a correct sign, NOT a true
 * penetration depth. Stage 7 routing-guard and Stage 12 DRC only need the
 * sign and positive gaps.
 */
export function shapeDistance(a: PlacedShape, b: PlacedShape): Nm {
  const da = decompose(a);
  const db = decompose(b);

  let base = Infinity;
  const ea = edges(da.pts);
  const eb = edges(db.pts);
  for (const [a1, a2] of ea) {
    for (const [b1, b2] of eb) {
      const d = segSegDist(a1, a2, b1, b2);
      if (d < base) base = d;
      if (base === 0) break;
    }
    if (base === 0) break;
  }

  // Containment without boundary contact: one point set strictly inside the
  // other polygon. (If boundaries touch or cross, base is already 0.)
  if (base > 0) {
    if (da.pts.length >= 3 && pointInPoly(db.pts[0], da.pts)) base = 0;
    else if (db.pts.length >= 3 && pointInPoly(da.pts[0], db.pts)) base = 0;
  }

  return roundNm(base - da.r - db.r);
}
