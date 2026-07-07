/**
 * Copper distance primitives (PCB Stage 6) — PINNED: Stage 7 (interactive
 * routing) and Stage 12 (DRC) reuse these for clearance checks.
 *
 * Everything is built on Stage 1's `shapeDistance`/`transformPoint` — a track
 * is a capsule, i.e. an `{kind:'oval'}` placed along its segment; no shape
 * math is duplicated here. Distances are integer nanometers; a result ≤ 0
 * means touching/overlap, `Infinity` means "not on a shared copper layer".
 *
 * Exactness invariant (kept, zero epsilon fudge): a track ending exactly on a
 * circular pad's center yields `trackPadDistance ≤ 0` — integer nm in, exact
 * sign out.
 */

import type { Nm } from "./units";
import type { Vec2, PlacedShape } from "./geometry";
import { shapeDistance, transformPoint } from "./geometry";
import type { Track, Via, Pad, FootprintInstance } from "./types";
import type { LayerId } from "./layers";
import { COPPER_LAYERS } from "./layers";

// ── Shape builders ───────────────────────────────────────────────────────────

/**
 * Capsule (stadium) for a segment swept by `width/2`. `width` 0 gives the bare
 * segment. The placed `at` may be a half-integer midpoint — that is fine:
 * Stage 1's decomposition works in doubles and only the final distance rounds.
 */
function capsule(start: Vec2, end: Vec2, width: Nm): PlacedShape {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    return { shape: { kind: "circle", radius: width / 2 }, at: start, rotationDeg: 0 };
  }
  return {
    // width > height always holds (len > 0), so the oval spine lies along the
    // local x axis and decomposes to exactly this segment + width/2 disk.
    shape: { kind: "oval", width: len + width, height: width },
    at: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    rotationDeg: (-Math.atan2(dy, dx) * 180) / Math.PI, // KiCad CCW, +y down
  };
}

/** World-space capsule of a track. */
export function trackShape(t: Track): PlacedShape {
  return capsule(t.start, t.end, t.width);
}

/** World-space barrel circle of a via. */
export function viaShape(v: Via): PlacedShape {
  return { shape: { kind: "circle", radius: v.size / 2 }, at: v.at, rotationDeg: 0 };
}

/** World position of a pad center (instance placement + bottom-side mirror). */
export function padWorldPosition(inst: FootprintInstance, pad: Pad): Vec2 {
  return transformPoint(pad.at, inst.at, inst.rotationDeg, inst.side === "bottom");
}

/**
 * World-space placed shape of a pad. Bottom-side instances mirror across x:
 * mirror∘rotate(α) = rotate(−α)∘mirror, so the effective world rotation flips
 * the pad's local rotation and polygon points mirror explicitly (every other
 * pad shape is x-symmetric, so only the rotation matters).
 */
export function padWorldShape(inst: FootprintInstance, pad: Pad): PlacedShape {
  const mirror = inst.side === "bottom";
  let shape = pad.shape;
  if (mirror && shape.kind === "polygon") {
    shape = { kind: "polygon", points: shape.points.map((p) => ({ x: -p.x, y: p.y })) };
  }
  return {
    shape,
    at: padWorldPosition(inst, pad),
    rotationDeg: mirror
      ? inst.rotationDeg - pad.rotationDeg
      : inst.rotationDeg + pad.rotationDeg,
  };
}

// ── Layer mapping ────────────────────────────────────────────────────────────

// PENDING (Stage 6 integration window): replace this private helper with
// `effectivePadLayers` from Stage 5's side.ts once it merges — same semantics
// (bottom-side instances flip front/back layers).
const FLIP_SIDE: Partial<Record<LayerId, LayerId>> = {
  copperTop: "copperBottom",
  copperBottom: "copperTop",
  silkTop: "silkBottom",
  silkBottom: "silkTop",
  maskTop: "maskBottom",
  maskBottom: "maskTop",
  pasteTop: "pasteBottom",
  pasteBottom: "pasteTop",
  courtyardTop: "courtyardBottom",
  courtyardBottom: "courtyardTop",
  fabTop: "fabBottom",
  fabBottom: "fabTop",
};

function effectivePadLayers(inst: FootprintInstance, pad: Pad): LayerId[] {
  if (inst.side === "top") return pad.layers;
  return pad.layers.map((l) => FLIP_SIDE[l] ?? l);
}

const COPPER_SET: ReadonlySet<LayerId> = new Set(COPPER_LAYERS);

/** Copper layers a pad's copper actually sits on, in world (side-aware). */
export function padCopperLayers(inst: FootprintInstance, pad: Pad): LayerId[] {
  return effectivePadLayers(inst, pad).filter((l) => COPPER_SET.has(l));
}

/** Copper layers a via's barrel spans, inclusive, in stack order. */
export function viaSpannedLayers(v: Via): LayerId[] {
  const i0 = COPPER_LAYERS.indexOf(v.layers[0]);
  const i1 = COPPER_LAYERS.indexOf(v.layers[1]);
  if (i0 < 0 || i1 < 0) return [];
  const lo = Math.min(i0, i1);
  const hi = Math.max(i0, i1);
  return COPPER_LAYERS.slice(lo, hi + 1) as LayerId[];
}

function viaSpansLayer(v: Via, layer: LayerId): boolean {
  return viaSpannedLayers(v).includes(layer);
}

// ── Distances (pinned five + two additive pair kinds) ────────────────────────

/** Minimum distance between two bare segments (0 when they intersect). */
export function segmentDistance(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Nm {
  return shapeDistance(capsule(a1, a2, 0), capsule(b1, b2, 0));
}

/** Capsule–capsule gap; Infinity if the tracks are on different layers. */
export function trackTrackDistance(a: Track, b: Track): Nm {
  if (a.layer !== b.layer) return Infinity;
  return shapeDistance(trackShape(a), trackShape(b));
}

/** Capsule–circle (via barrel); Infinity if the via doesn't span t.layer. */
export function trackViaDistance(t: Track, v: Via): Nm {
  if (!viaSpansLayer(v, t.layer)) return Infinity;
  return shapeDistance(trackShape(t), viaShape(v));
}

/** Capsule vs pad shape in world space; Infinity if the pad has no copper on t.layer. */
export function trackPadDistance(t: Track, inst: FootprintInstance, pad: Pad): Nm {
  if (!padCopperLayers(inst, pad).includes(t.layer)) return Infinity;
  return shapeDistance(trackShape(t), padWorldShape(inst, pad));
}

/** Barrel–barrel gap; Infinity if the via spans don't share a copper layer. */
export function viaViaDistance(a: Via, b: Via): Nm {
  const sa = viaSpannedLayers(a);
  const sb = new Set(viaSpannedLayers(b));
  if (!sa.some((l) => sb.has(l))) return Infinity;
  return shapeDistance(viaShape(a), viaShape(b));
}

/** Barrel vs pad shape; Infinity without a shared copper layer. (Additive — the connectivity engine needs the full pair matrix.) */
export function viaPadDistance(v: Via, inst: FootprintInstance, pad: Pad): Nm {
  if (!padCopperLayers(inst, pad).some((l) => viaSpansLayer(v, l))) return Infinity;
  return shapeDistance(viaShape(v), padWorldShape(inst, pad));
}

/** Pad vs pad in world space; Infinity without a shared copper layer. (Additive.) */
export function padPadDistance(
  instA: FootprintInstance,
  padA: Pad,
  instB: FootprintInstance,
  padB: Pad,
): Nm {
  const la = padCopperLayers(instA, padA);
  const lb = new Set(padCopperLayers(instB, padB));
  if (!la.some((l) => lb.has(l))) return Infinity;
  return shapeDistance(padWorldShape(instA, padA), padWorldShape(instB, padB));
}
