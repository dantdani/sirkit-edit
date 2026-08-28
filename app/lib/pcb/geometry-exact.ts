/**
 * B15.2.1 §A — EXACT integer-polygon geometry predicates.
 *
 * One shared authority for containment and simple-polygon validity at every
 * coordinate magnitude the bounded-edit parser allows (±10^10 nm). Cross
 * products of such coordinates reach ~10^20, well past Number's safe-integer
 * range, so every orientation, area, and intersection predicate here is
 * computed with BigInt — nothing can lose sign or shoelace correctness.
 *
 * These predicates operate on INTEGER polygons. The board OUTLINE is still
 * converted to a polygon by the shared `outlinePolygon` authority
 * (app/lib/pcb/zones/geometry.ts) — this module does not define a second
 * outline model. For a roundrect, `outlinePolygon` inscribes chords in the
 * true arcs, so requiring containment in that polygon is CONSERVATIVE
 * (stricter, never looser) — the safe direction for a keepout/dimension that
 * must stay on the board.
 *
 * There is NO finite sampling anywhere: segment containment is decided by
 * computing the exact set of boundary-crossing parameters and testing the
 * midpoint of every resulting sub-interval, so an arbitrarily narrow
 * concavity cannot be stepped over.
 */

export interface IntPoint {
  x: number;
  y: number;
}

type BigPoint = { x: bigint; y: bigint };

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

function big(point: IntPoint): BigPoint {
  return { x: BigInt(Math.trunc(point.x)), y: BigInt(Math.trunc(point.y)) };
}

/** Twice the signed area of triangle (a,b,c): >0 left, <0 right, 0 collinear. */
function cross(a: BigPoint, b: BigPoint, c: BigPoint): bigint {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function sign(value: bigint): -1 | 0 | 1 {
  return value > ZERO ? 1 : value < ZERO ? -1 : 0;
}

/** Is p on the CLOSED segment [a,b] (a,b,p all BigInt)? */
function onSegment(a: BigPoint, b: BigPoint, p: BigPoint): boolean {
  if (cross(a, b, p) !== ZERO) return false;
  return p.x >= (a.x < b.x ? a.x : b.x) && p.x <= (a.x > b.x ? a.x : b.x)
    && p.y >= (a.y < b.y ? a.y : b.y) && p.y <= (a.y > b.y ? a.y : b.y);
}

/** Classify the intersection of two CLOSED segments. */
export type SegmentIntersection = "none" | "proper" | "touch";

function classifyIntersection(p1: BigPoint, p2: BigPoint, p3: BigPoint, p4: BigPoint): SegmentIntersection {
  const d1 = sign(cross(p3, p4, p1));
  const d2 = sign(cross(p3, p4, p2));
  const d3 = sign(cross(p1, p2, p3));
  const d4 = sign(cross(p1, p2, p4));
  if (d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0) return "proper";
  if ((d1 === 0 && onSegment(p3, p4, p1)) || (d2 === 0 && onSegment(p3, p4, p2))
    || (d3 === 0 && onSegment(p1, p2, p3)) || (d4 === 0 && onSegment(p1, p2, p4))) return "touch";
  return "none";
}

// ── Point-in-polygon in a SCALED integer space ───────────────────────────────

/**
 * Even/odd ray cast for a point whose exact coordinates are (px/den, py/den)
 * against an INTEGER polygon. Scaling the polygon vertices by `den` puts
 * everything in one BigInt space, so a rational midpoint can be tested
 * without any floating point. Returns whether the point is inside OR on the
 * boundary (closed containment).
 */
function scaledPointInClosedPolygon(px: bigint, py: bigint, den: bigint, poly: readonly IntPoint[]): boolean {
  const scaled: BigPoint[] = poly.map((point) => ({ x: BigInt(Math.trunc(point.x)) * den, y: BigInt(Math.trunc(point.y)) * den }));
  const p: BigPoint = { x: px, y: py };
  const n = scaled.length;
  for (let i = 0; i < n; i += 1) {
    if (onSegment(scaled[i]!, scaled[(i + 1) % n]!, p)) return true; // on boundary
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const vi = scaled[i]!;
    const vj = scaled[j]!;
    if ((vi.y > py) !== (vj.y > py)) {
      // horizontal ray to +x crosses edge (vi,vj)?  intersectionX > px ?
      const dy = vj.y - vi.y; // nonzero here
      const lhs = (py - vi.y) * (vj.x - vi.x);
      const rhs = (px - vi.x) * dy;
      const crossesRight = dy > ZERO ? lhs > rhs : lhs < rhs;
      if (crossesRight) inside = !inside;
    }
  }
  return inside;
}

/** Integer point in the closed polygon (den = 1). */
export function pointInClosedPolygon(point: IntPoint, poly: readonly IntPoint[]): boolean {
  return scaledPointInClosedPolygon(BigInt(Math.trunc(point.x)), BigInt(Math.trunc(point.y)), ONE, poly);
}

// ── Exact segment-in-polygon (no sampling) ───────────────────────────────────

/** A boundary-crossing parameter t = n/d along [a,b], kept as an exact ratio. */
interface Ratio { n: bigint; d: bigint }

function normalizeRatio(n: bigint, d: bigint): Ratio {
  return d < ZERO ? { n: -n, d: -d } : { n, d };
}

function compareRatio(a: Ratio, b: Ratio): number {
  const lhs = a.n * b.d;
  const rhs = b.n * a.d;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

/**
 * Is the CLOSED segment [a,b] entirely within the closed polygon? Exact:
 *  1. both endpoints are in the closed polygon;
 *  2. collect every parameter t at which the segment meets the boundary
 *     (transversal crossings AND collinear/vertex touches);
 *  3. the midpoint of every consecutive pair of these parameters lies in the
 *     closed polygon.
 * With no sampling, an arbitrarily narrow notch produces boundary-crossing
 * parameters whose enclosing midpoint falls outside — and is rejected.
 */
export function segmentInClosedPolygon(a: IntPoint, b: IntPoint, poly: readonly IntPoint[]): boolean {
  const A = big(a);
  const B = big(b);
  if (!pointInClosedPolygon(a, poly) || !pointInClosedPolygon(b, poly)) return false;
  if (A.x === B.x && A.y === B.y) return true; // degenerate: a point already tested inside

  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const events: Ratio[] = [{ n: ZERO, d: ONE }, { n: ONE, d: ONE }];
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    const C = big(poly[i]!);
    const D = big(poly[(i + 1) % n]!);
    const ex = D.x - C.x;
    const ey = D.y - C.y;
    const denom = dx * ey - dy * ex;
    if (denom !== ZERO) {
      // Non-parallel: single intersection. t = ((C-A) × e) / denom.
      const tNum = (C.x - A.x) * ey - (C.y - A.y) * ex;
      const sNum = (C.x - A.x) * dy - (C.y - A.y) * dx;
      // t and s must both be within [0,1]; keep denom sign consistent.
      const t = normalizeRatio(tNum, denom);
      const s = normalizeRatio(sNum, denom);
      if (t.n >= ZERO && t.n <= t.d && s.n >= ZERO && s.n <= s.d) events.push(t);
    } else {
      // Parallel; if collinear, add the edge endpoints' t where they land on [a,b].
      if (cross(A, B, C) === ZERO) {
        for (const point of [C, D]) {
          const tn = dx !== ZERO ? (point.x - A.x) : (point.y - A.y);
          const td = dx !== ZERO ? dx : dy;
          const t = normalizeRatio(tn, td);
          if (t.n >= ZERO && t.n <= t.d) events.push(t);
        }
      }
    }
  }
  events.sort(compareRatio);
  for (let i = 0; i + 1 < events.length; i += 1) {
    const lo = events[i]!;
    const hi = events[i + 1]!;
    if (compareRatio(lo, hi) === 0) continue;
    // midpoint tm = (lo + hi)/2 = (lo.n*hi.d + hi.n*lo.d) / (2*lo.d*hi.d)
    const mNum = lo.n * hi.d + hi.n * lo.d;
    const mDen = TWO * lo.d * hi.d;
    // point at tm, scaled by mDen: (A + t*(B-A)) * mDen = A*mDen + (B-A)*mNum
    const px = A.x * mDen + dx * mNum;
    const py = A.y * mDen + dy * mNum;
    if (!scaledPointInClosedPolygon(px, py, mDen, poly)) return false;
  }
  return true;
}

// ── Simple-polygon validity ──────────────────────────────────────────────────

export type PolygonValidity = { ok: true } | { ok: false; reason: string };

/**
 * A keepout polygon is a valid simple polygon iff: ≥3 vertices, no repeated
 * vertex, no zero edge, nonzero area, and no pair of edges shares any point
 * other than the single vertex adjacent edges legitimately share. This
 * rejects proper self-intersection, non-adjacent endpoint touches,
 * endpoint-on-interior contact, and collinear overlap/retracing.
 */
export function validateSimplePolygon(poly: readonly IntPoint[]): PolygonValidity {
  const n = poly.length;
  if (n < 3) return { ok: false, reason: "fewer than three vertices" };
  const pts = poly.map(big);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (pts[i]!.x === pts[j]!.x && pts[i]!.y === pts[j]!.y) return { ok: false, reason: "repeated vertex" };
    }
  }
  for (let i = 0; i < n; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    if (a.x === b.x && a.y === b.y) return { ok: false, reason: "zero-length edge" };
  }
  // Shoelace area (BigInt) must be nonzero.
  let area2 = ZERO;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    area2 += a.x * b.y - b.x * a.y;
  }
  if (area2 === ZERO) return { ok: false, reason: "zero area (collinear vertices)" };
  // Edge-pair intersections.
  for (let i = 0; i < n; i += 1) {
    const a1 = pts[i]!;
    const a2 = pts[(i + 1) % n]!;
    for (let j = i + 1; j < n; j += 1) {
      const b1 = pts[j]!;
      const b2 = pts[(j + 1) % n]!;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const kind = classifyIntersection(a1, a2, b1, b2);
      if (adjacent) {
        // Adjacent edges legitimately share exactly one endpoint. Any OTHER
        // contact — the far endpoint of one lying on the other, or collinear
        // overlap — is invalid.
        const shared = j === i + 1 ? a2 : a1; // the common vertex
        const farA = j === i + 1 ? a1 : a2;
        const farB = j === i + 1 ? b2 : b1;
        if (kind === "proper") return { ok: false, reason: "adjacent edges cross" };
        if (onSegment(b1, b2, farA) && !(farA.x === shared.x && farA.y === shared.y)) return { ok: false, reason: "vertex on a non-adjacent edge or collinear overlap" };
        if (onSegment(a1, a2, farB) && !(farB.x === shared.x && farB.y === shared.y)) return { ok: false, reason: "vertex on a non-adjacent edge or collinear overlap" };
      } else if (kind !== "none") {
        return { ok: false, reason: kind === "proper" ? "self-intersection" : "non-adjacent edge touch/overlap" };
      }
    }
  }
  return { ok: true };
}

// ── B15.2.2 §A — EXACT OUTLINE authority (rect / roundrect / polygon) ─────────

/**
 * [B15.2.2 §A] The AUTHORITATIVE outline containment predicates.
 *
 * B15.2.1 routed roundrect containment through `outlinePolygon`'s chord
 * vertices, ROUNDED to integers. A rounded chord vertex can land OUTSIDE the
 * true arc, so the polygon locally bulges beyond the board and a genuinely
 * off-board point was accepted (R22: `{x: 96305, y: 18039657}` on an
 * 80×80 mm / r=20 mm roundrect). The "conservative-exact" claim was false.
 *
 * Roundrect containment is now decided EXACTLY, with BigInt squared-distance
 * against the applicable corner circle — no trigonometry, no chords, no
 * rounding. Rect is exact bbox containment. Polygon keeps the proven BigInt
 * ray-cast / boundary-parameter algorithm above.
 */

export type ExactOutline =
  | { kind: "rect"; width: number; height: number; origin: IntPoint }
  | { kind: "roundrect"; width: number; height: number; cornerRadius: number; origin: IntPoint }
  | { kind: "polygon"; points: readonly IntPoint[] };

function outlineBounds(outline: ExactOutline): { minX: bigint; minY: bigint; maxX: bigint; maxY: bigint } {
  if (outline.kind === "polygon") {
    const xs = outline.points.map((p) => BigInt(Math.trunc(p.x)));
    const ys = outline.points.map((p) => BigInt(Math.trunc(p.y)));
    return {
      minX: xs.reduce((a, b) => (a < b ? a : b)), maxX: xs.reduce((a, b) => (a > b ? a : b)),
      minY: ys.reduce((a, b) => (a < b ? a : b)), maxY: ys.reduce((a, b) => (a > b ? a : b)),
    };
  }
  const ox = BigInt(Math.trunc(outline.origin.x));
  const oy = BigInt(Math.trunc(outline.origin.y));
  return { minX: ox, minY: oy, maxX: ox + BigInt(Math.trunc(outline.width)), maxY: oy + BigInt(Math.trunc(outline.height)) };
}

/**
 * EXACT point-in-outline. For a roundrect the corner radius is clamped the
 * same way the product does (`min(r, w/2, h/2)`), and a point inside a corner
 * square must satisfy `dx² + dy² <= r²` in BigInt — true circle, not a chord.
 */
export function pointInExactOutline(point: IntPoint, outline: ExactOutline): boolean {
  if (outline.kind === "polygon") return pointInClosedPolygon(point, outline.points);
  const px = BigInt(Math.trunc(point.x));
  const py = BigInt(Math.trunc(point.y));
  const b = outlineBounds(outline);
  if (px < b.minX || px > b.maxX || py < b.minY || py > b.maxY) return false;
  if (outline.kind === "rect") return true;
  // Clamp exactly as the product's own roundrect model does.
  const width = BigInt(Math.trunc(outline.width));
  const height = BigInt(Math.trunc(outline.height));
  let r = BigInt(Math.trunc(outline.cornerRadius));
  const halfW = width / TWO;
  const halfH = height / TWO;
  if (r > halfW) r = halfW;
  if (r > halfH) r = halfH;
  if (r <= ZERO) return true;
  const cx = px < b.minX + r ? b.minX + r : px > b.maxX - r ? b.maxX - r : null;
  const cy = py < b.minY + r ? b.minY + r : py > b.maxY - r ? b.maxY - r : null;
  if (cx === null || cy === null) return true; // not inside a corner square
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r; // EXACT, BigInt
}

/**
 * EXACT segment-in-outline.
 *
 * INVARIANT (permanently tested): rect and roundrect outlines are CONVEX, so
 * a segment lies entirely inside iff BOTH endpoints lie inside. Polygons are
 * not necessarily convex, so they keep the full boundary-parameter algorithm
 * that handles arbitrarily narrow concavities.
 */
export function segmentInExactOutline(a: IntPoint, b: IntPoint, outline: ExactOutline): boolean {
  if (outline.kind === "polygon") return segmentInClosedPolygon(a, b, outline.points);
  return pointInExactOutline(a, outline) && pointInExactOutline(b, outline);
}
