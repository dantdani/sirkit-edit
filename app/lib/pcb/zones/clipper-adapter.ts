/**
 * Polygon boolean ops for zone fill (PCB Stage 11).
 *
 * LIBRARY CHOICE (documented deviation from the "clipper2-wasm" default): the
 * pinned plan allowed `polygon-clipping` (pure JS, Martinez–Rueda) as the
 * substitute path when the wasm loader is painful — which it is here: Next.js
 * 16 + vitest would each need async wasm bootstrapping threaded through the
 * synchronous fill engine and the test suite. polygon-clipping is MIT,
 * dependency-free, robust (splay-tree sweep with rounding guards), works on
 * our integer-nm coordinates verbatim, and needs zero init. Perf is within
 * the 300 ms budget on the routed fixture (measured in compute-fill.test.ts).
 * If a future board blows the budget, swap this adapter's internals for
 * clipper2-wasm — the wrapper interface below is the pinned seam.
 *
 * Interop note: polygon-clipping's runtime builds export ONLY a default
 * object while its bundled d.ts declares named exports; the shim below
 * accepts both module shapes so vitest (node ESM) and Next (bundler) agree.
 *
 * Conventions: rings are `Vec2[]`, open (first !== last); output multi-
 * polygons are `[outer, ...holes][]` exactly as the library emits them.
 */

import * as pcModule from "polygon-clipping";
import type { Vec2 } from "../geometry";
import { capsulePolygon } from "./geometry";

type Pair = [number, number];
type Ring = Pair[];
type Poly = Ring[];
type MultiPoly = Poly[];
type Geom = Poly | MultiPoly;

interface PcOps {
  union(geom: Geom, ...geoms: Geom[]): MultiPoly;
  intersection(geom: Geom, ...geoms: Geom[]): MultiPoly;
  difference(subjectGeom: Geom, ...clipGeoms: Geom[]): MultiPoly;
}

const pc: PcOps =
  (pcModule as unknown as { default?: PcOps }).default ?? (pcModule as unknown as PcOps);

/** A polygon with holes: [outer, ...holes]. */
export type PolyWithHoles = Vec2[][];

/**
 * Idempotent init hook. polygon-clipping needs none; kept so a clipper2-wasm
 * swap-in (which must await wasm compilation) doesn't change call sites.
 */
export async function initClipper(): Promise<void> {
  /* no-op — pure-JS backend */
}

function toRing(pts: readonly Vec2[]): Ring {
  return pts.map((p): Pair => [p.x, p.y]);
}

function fromRing(ring: Ring): Vec2[] {
  const out: Vec2[] = ring.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) }));
  // The library may close rings (last === first); our convention is open.
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (a.x === b.x && a.y === b.y) out.pop();
  }
  return out;
}

/** Simple polygons (no holes) → library geometry. */
function toGeom(polygons: readonly Vec2[][]): MultiPoly {
  return polygons.filter((p) => p.length >= 3).map((p): Poly => [toRing(p)]);
}

function fromMulti(multi: MultiPoly): PolyWithHoles[] {
  const out: PolyWithHoles[] = [];
  for (const poly of multi) {
    const rings = poly.map(fromRing).filter((r) => r.length >= 3);
    if (rings.length > 0 && rings[0].length >= 3) out.push(rings);
  }
  return out;
}

/**
 * subject − clip. Both sides are lists of simple polygons (holes not needed
 * on the way in); the result carries holes.
 */
export function polygonDifference(
  subject: readonly Vec2[][],
  clip: readonly Vec2[][],
): PolyWithHoles[] {
  const s = toGeom(subject);
  if (s.length === 0) return [];
  const c = toGeom(clip);
  if (c.length === 0) return fromMulti(pc.union(s));
  return fromMulti(pc.difference(s, c));
}

/** Union of simple polygons (used to weld thermal spokes into the raw fill). */
export function polygonUnion(polygons: readonly Vec2[][]): PolyWithHoles[] {
  const g = toGeom(polygons);
  if (g.length === 0) return [];
  return fromMulti(pc.union(g));
}

/** Intersection of two polygon sets (fill area ∩ outline inset). */
export function polygonIntersection(
  a: readonly Vec2[][],
  b: readonly Vec2[][],
): PolyWithHoles[] {
  const ga = toGeom(a);
  const gb = toGeom(b);
  if (ga.length === 0 || gb.length === 0) return [];
  return fromMulti(pc.intersection(ga, gb));
}

// ── Hole-aware variants (internal to the fill pipeline) ─────────────────────
// The pinned wrapper interface above works on lists of SIMPLE polygons; the
// fill engine chains ops, so intermediate results carry holes. These accept
// them without flattening.

function toGeomWithHoles(polys: readonly PolyWithHoles[]): MultiPoly {
  return polys
    .filter((rings) => rings.length > 0 && rings[0].length >= 3)
    .map((rings): Poly => rings.filter((r) => r.length >= 3).map(toRing));
}

/** subject (with holes) − clips (simple polygons). */
export function differenceWithHoles(
  subject: readonly PolyWithHoles[],
  clips: readonly Vec2[][],
): PolyWithHoles[] {
  const s = toGeomWithHoles(subject);
  if (s.length === 0) return [];
  const c = toGeom(clips);
  if (c.length === 0) return fromMulti(pc.union(s));
  return fromMulti(pc.difference(s, c));
}

/** a (with holes) ∩ clips (simple polygons). */
export function intersectionWithHoles(
  a: readonly PolyWithHoles[],
  clips: readonly Vec2[][],
): PolyWithHoles[] {
  const ga = toGeomWithHoles(a);
  const gc = toGeom(clips);
  if (ga.length === 0 || gc.length === 0) return [];
  return fromMulti(pc.intersection(ga, gc));
}

/** Union of two hole-carrying polygon sets. */
export function unionWithHoles(
  a: readonly PolyWithHoles[],
  b: readonly PolyWithHoles[],
): PolyWithHoles[] {
  const ga = toGeomWithHoles(a);
  const gb = toGeomWithHoles(b);
  if (ga.length === 0) return b.map((rings) => rings.map((r) => r.map((p) => ({ ...p }))));
  if (gb.length === 0) return a.map((rings) => rings.map((r) => r.map((p) => ({ ...p }))));
  return fromMulti(pc.union(ga, gb));
}

/**
 * Offset a simple polygon by `deltaNm` (positive = grow, negative = shrink).
 * Positive: union of the polygon with a capsule swept along each edge
 * (exact Minkowski sum up to the circumscribed arc chords). Negative: erode
 * by subtracting the same boundary band. Can return several polygons (a
 * shrink can split a waisted shape) or none (shrunk to nothing).
 */
export function polygonInflate(polygon: readonly Vec2[], deltaNm: number): Vec2[][] {
  if (polygon.length < 3) return [];
  if (deltaNm === 0) return [polygon.map((p) => ({ ...p }))];
  const band: Vec2[][] = [];
  const r = Math.abs(deltaNm);
  for (let i = 0; i < polygon.length; i++) {
    band.push(capsulePolygon(polygon[i], polygon[(i + 1) % polygon.length], r));
  }
  const result =
    deltaNm > 0
      ? pc.union(toGeom([polygon as Vec2[]]), toGeom(band))
      : pc.difference(toGeom([polygon as Vec2[]]), toGeom(band));
  // Outer rings only — a pure offset of a simple polygon has no true holes
  // (positive offsets can pinch tiny slivers; dropping them is safe).
  return fromMulti(result).map((rings) => rings[0]);
}

/**
 * Inflate a Minkowski point set (see zones/geometry.decomposeShape) by radius
 * `r` — the polygonized shape every pad/track/via cutout is built from.
 */
export function inflatePointSet(pts: readonly Vec2[], r: number): Vec2[][] {
  if (pts.length === 0) return [];
  if (r <= 0) return pts.length >= 3 ? [pts.map((p) => ({ ...p }))] : [];
  if (pts.length === 1) {
    return [capsulePolygon(pts[0], pts[0], r)];
  }
  if (pts.length === 2) {
    return [capsulePolygon(pts[0], pts[1], r)];
  }
  return polygonInflate(pts as Vec2[], r);
}
