/**
 * Footprint render planner (PCB Stage 3) — PURE module, no Pixi imports.
 *
 * Turns a Stage 1 `FootprintDef` (integer nanometers) into per-layer draw ops
 * in MILLIMETER floats. The scene builds ONE shared GraphicsContext per
 * (footprint def, layer) from these ops; every instance then reuses it — this
 * instancing is what the Stage 3 performance budget depends on. Keeping the
 * planner Pixi-free lets vitest exercise geometry + primitive counts in node.
 *
 * Conventions (load-bearing):
 * - World space is mm floats, +y DOWN (world = nm / 1e6). Never feed raw nm
 *   into Pixi — f32 vertex precision dies at 1e8.
 * - KiCad rotations are CCW-positive in a +y-down world; Pixi rotation is
 *   CW-positive radians in the same world ⇒ pixiRotation = -deg * PI / 180.
 */

import { NM_PER_MM } from "../units";
import type { FootprintDef, Pad, FpGraphic } from "../types";
import type { LayerId } from "../layers";
import { oppositeLayer } from "../side";

/** Renderable target: a real layer, or the synthetic drill-hole layer. */
export type RenderLayerKey = LayerId | "holes";

/** One draw command, coordinates in mm (footprint-local, +y down). */
export type DrawOp =
  | { op: "circle"; cx: number; cy: number; r: number; fill: boolean; strokeWidth: number }
  | {
      op: "poly";
      /** Flat [x0, y0, x1, y1, …] in mm. */
      points: number[];
      closed: boolean;
      fill: boolean;
      strokeWidth: number;
    }
  | {
      op: "arc";
      cx: number;
      cy: number;
      r: number;
      startAngle: number;
      endAngle: number;
      anticlockwise: boolean;
      strokeWidth: number;
    };

/** One text item (rendered per-instance as BitmapText, not in the context). */
export interface TextOp {
  text: string;
  xMm: number;
  yMm: number;
  rotationDeg: number;
  sizeMm: number;
  layer: LayerId;
}

export interface FootprintPlan {
  ops: Map<RenderLayerKey, DrawOp[]>;
  texts: TextOp[];
  /** Pads + graphic items + texts, each counted ONCE (drill holes excluded). */
  primitives: number;
  /** Per-layer op/text counts — pads recount on every layer they draw to. */
  perLayerPrimitives: Map<RenderLayerKey, number>;
}

/** KiCad CCW degrees (+y down) → Pixi CW radians. */
export function pixiRotation(rotationDeg: number): number {
  return (-rotationDeg * Math.PI) / 180;
}

const mm = (nm: number): number => nm / NM_PER_MM;

/** Rotate a local mm point by KiCad-convention degrees (CCW, +y down). */
export function rotateLocalMm(x: number, y: number, deg: number): { x: number; y: number } {
  if (deg === 0) return { x, y };
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: x * c + y * s, y: -x * s + y * c };
}

/** Segments per 90° of arc when tessellating pad outlines. */
const CORNER_SEGMENTS = 6;

/**
 * Tessellate a (round)rect centred on (cx, cy), rotated by `deg`, into a flat
 * polygon point list. cr = 0 gives the plain rect; cr = min(w, h)/2 gives the
 * oval/stadium. One code path handles every pad rotation exactly.
 */
function roundRectPoints(
  cx: number,
  cy: number,
  w: number,
  h: number,
  cr: number,
  deg: number,
): number[] {
  const r = Math.min(cr, w / 2, h / 2);
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  // Corner arc centres in local space, with the angle range each corner spans.
  // +y down: "ne" (x=+hw, y=-hh) sweeps screen-up-right, etc. Directions don't
  // matter for a filled polygon as long as the boundary is traced in order.
  const corners: Array<{ x: number; y: number; a0: number }> = [
    { x: hw, y: -hh, a0: -Math.PI / 2 },
    { x: hw, y: hh, a0: 0 },
    { x: -hw, y: hh, a0: Math.PI / 2 },
    { x: -hw, y: -hh, a0: Math.PI },
  ];
  const pts: number[] = [];
  for (const corner of corners) {
    if (r === 0) {
      const p = rotateLocalMm(corner.x, corner.y, deg);
      pts.push(p.x + cx, p.y + cy);
      continue;
    }
    for (let i = 0; i <= CORNER_SEGMENTS; i++) {
      const a = corner.a0 + (i / CORNER_SEGMENTS) * (Math.PI / 2);
      const p = rotateLocalMm(corner.x + r * Math.cos(a), corner.y + r * Math.sin(a), deg);
      pts.push(p.x + cx, p.y + cy);
    }
  }
  return pts;
}

/** Circumcenter of three points, or null when (nearly) collinear. */
function circumcenter(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  return {
    x: (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d,
    y: (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d,
  };
}

/** Convert a KiCad three-point arc (start, mid, end — mm) into an arc op. */
function threePointArc(
  sx: number,
  sy: number,
  mx: number,
  my: number,
  ex: number,
  ey: number,
  strokeWidth: number,
): DrawOp {
  const c = circumcenter(sx, sy, mx, my, ex, ey);
  if (!c) {
    // Degenerate (collinear) — draw the chord.
    return { op: "poly", points: [sx, sy, ex, ey], closed: false, fill: false, strokeWidth };
  }
  const r = Math.hypot(sx - c.x, sy - c.y);
  const a0 = Math.atan2(sy - c.y, sx - c.x);
  const a1 = Math.atan2(ey - c.y, ex - c.x);
  const am = Math.atan2(my - c.y, mx - c.x);
  // Choose the sweep direction that passes through the mid point.
  const tau = Math.PI * 2;
  const fwdEnd = (a1 - a0 + tau) % tau;
  const fwdMid = (am - a0 + tau) % tau;
  const anticlockwise = fwdMid > fwdEnd;
  return { op: "arc", cx: c.x, cy: c.y, r, startAngle: a0, endAngle: a1, anticlockwise, strokeWidth };
}

/** Layers a pad shape is drawn on (drills are handled separately). */
const PAD_RENDER_LAYERS: ReadonlySet<LayerId> = new Set<LayerId>([
  "copperTop",
  "in1",
  "in2",
  "copperBottom",
  "maskTop",
  "maskBottom",
  "pasteTop",
  "pasteBottom",
]);

/** Minimum stroke so zero-width file strokes stay visible. */
const MIN_STROKE_MM = 0.01;

function padShapeOp(pad: Pad): DrawOp {
  const cx = mm(pad.at.x);
  const cy = mm(pad.at.y);
  const s = pad.shape;
  switch (s.kind) {
    case "circle":
      return { op: "circle", cx, cy, r: mm(s.radius), fill: true, strokeWidth: 0 };
    case "rect":
      return {
        op: "poly",
        points: roundRectPoints(cx, cy, mm(s.width), mm(s.height), 0, pad.rotationDeg),
        closed: true,
        fill: true,
        strokeWidth: 0,
      };
    case "roundrect":
      return {
        op: "poly",
        points: roundRectPoints(
          cx,
          cy,
          mm(s.width),
          mm(s.height),
          mm(s.cornerRadius),
          pad.rotationDeg,
        ),
        closed: true,
        fill: true,
        strokeWidth: 0,
      };
    case "oval": {
      const w = mm(s.width);
      const h = mm(s.height);
      return {
        op: "poly",
        points: roundRectPoints(cx, cy, w, h, Math.min(w, h) / 2, pad.rotationDeg),
        closed: true,
        fill: true,
        strokeWidth: 0,
      };
    }
    case "polygon": {
      const points: number[] = [];
      for (const p of s.points) {
        const r = rotateLocalMm(mm(p.x), mm(p.y), pad.rotationDeg);
        points.push(r.x + cx, r.y + cy);
      }
      return { op: "poly", points, closed: true, fill: true, strokeWidth: 0 };
    }
  }
}

/** Drill "hole" op — punched in background color above all copper. */
function drillOp(pad: Pad): DrawOp | null {
  const drill = pad.drill;
  if (!drill) return null;
  const cx = mm(pad.at.x) + (drill.offset ? mm(drill.offset.x) : 0);
  const cy = mm(pad.at.y) + (drill.offset ? mm(drill.offset.y) : 0);
  if (drill.width !== undefined && drill.height !== undefined) {
    const w = mm(drill.width);
    const h = mm(drill.height);
    return {
      op: "poly",
      points: roundRectPoints(cx, cy, w, h, Math.min(w, h) / 2, pad.rotationDeg),
      closed: true,
      fill: true,
      strokeWidth: 0,
    };
  }
  return { op: "circle", cx, cy, r: mm(drill.diameter) / 2, fill: true, strokeWidth: 0 };
}

function graphicOp(g: Exclude<FpGraphic, { kind: "text" }>): DrawOp {
  switch (g.kind) {
    case "line":
      return {
        op: "poly",
        points: [mm(g.start.x), mm(g.start.y), mm(g.end.x), mm(g.end.y)],
        closed: false,
        fill: false,
        strokeWidth: Math.max(mm(g.width), MIN_STROKE_MM),
      };
    case "arc":
      return threePointArc(
        mm(g.start.x),
        mm(g.start.y),
        mm(g.mid.x),
        mm(g.mid.y),
        mm(g.end.x),
        mm(g.end.y),
        Math.max(mm(g.width), MIN_STROKE_MM),
      );
    case "circle": {
      const r = Math.hypot(mm(g.end.x) - mm(g.center.x), mm(g.end.y) - mm(g.center.y));
      return {
        op: "circle",
        cx: mm(g.center.x),
        cy: mm(g.center.y),
        r,
        fill: g.fill,
        strokeWidth: Math.max(mm(g.width), MIN_STROKE_MM),
      };
    }
    case "rect": {
      const x0 = mm(g.start.x);
      const y0 = mm(g.start.y);
      const x1 = mm(g.end.x);
      const y1 = mm(g.end.y);
      return {
        op: "poly",
        points: [x0, y0, x1, y0, x1, y1, x0, y1],
        closed: true,
        fill: g.fill,
        strokeWidth: Math.max(mm(g.width), MIN_STROKE_MM),
      };
    }
    case "poly": {
      const points: number[] = [];
      for (const p of g.points) points.push(mm(p.x), mm(p.y));
      return {
        op: "poly",
        points,
        closed: true,
        fill: g.fill,
        strokeWidth: Math.max(mm(g.width), MIN_STROKE_MM),
      };
    }
  }
}

/** Build the per-layer draw plan for one footprint definition. */
export function planFootprint(def: FootprintDef): FootprintPlan {
  const ops = new Map<RenderLayerKey, DrawOp[]>();
  const perLayer = new Map<RenderLayerKey, number>();
  const texts: TextOp[] = [];
  let primitives = 0;

  const push = (layer: RenderLayerKey, op: DrawOp): void => {
    let list = ops.get(layer);
    if (!list) {
      list = [];
      ops.set(layer, list);
    }
    list.push(op);
    perLayer.set(layer, (perLayer.get(layer) ?? 0) + 1);
  };

  for (const pad of def.pads) {
    const shapeOp = padShapeOp(pad);
    let drawn = false;
    for (const layer of pad.layers) {
      if (!PAD_RENDER_LAYERS.has(layer)) continue;
      push(layer, shapeOp);
      drawn = true;
    }
    const drill = drillOp(pad);
    if (drill) {
      push("holes", drill);
      drawn = true;
    }
    if (drawn) primitives += 1; // a pad is ONE primitive however many layers show it
  }

  for (const g of def.graphics) {
    if (g.kind === "text") {
      texts.push({
        text: g.text,
        xMm: mm(g.at.x),
        yMm: mm(g.at.y),
        rotationDeg: g.rotationDeg,
        sizeMm: mm(g.sizeY),
        layer: g.layer,
      });
      perLayer.set(g.layer, (perLayer.get(g.layer) ?? 0) + 1);
      primitives += 1;
      continue;
    }
    push(g.layer, graphicOp(g));
    primitives += 1;
  }

  return { ops, texts, primitives, perLayerPrimitives: perLayer };
}

// ── Bottom-side mirroring (PCB Stage 5) ──────────────────────────────────────

function mirrorOp(op: DrawOp): DrawOp {
  switch (op.op) {
    case "circle":
      return { ...op, cx: -op.cx };
    case "poly": {
      const points = op.points.slice();
      for (let i = 0; i < points.length; i += 2) points[i] = -points[i];
      return { ...op, points };
    }
    case "arc":
      // (cos a, sin a) under x → −x becomes (cos(π−a), sin(π−a)); the sweep
      // direction flips with the handedness change.
      return {
        ...op,
        cx: -op.cx,
        startAngle: Math.PI - op.startAngle,
        endAngle: Math.PI - op.endAngle,
        anticlockwise: !op.anticlockwise,
      };
  }
}

function mirrorLayerKey(key: RenderLayerKey): RenderLayerKey {
  return key === "holes" ? key : oppositeLayer(key);
}

/**
 * The bottom-side variant of a footprint plan: every op mirrored in local X
 * and every layer mapped through `oppositeLayer` (drill holes stay drill
 * holes). Text keeps its top-side local rotation; the scene composes the
 * mirror at instance level (X-flipped glyphs — the KiCad
 * readable-through-the-board convention).
 */
export function mirrorPlan(plan: FootprintPlan): FootprintPlan {
  const ops = new Map<RenderLayerKey, DrawOp[]>();
  for (const [key, list] of plan.ops) {
    ops.set(mirrorLayerKey(key), list.map(mirrorOp));
  }
  const perLayer = new Map<RenderLayerKey, number>();
  for (const [key, n] of plan.perLayerPrimitives) {
    const k = mirrorLayerKey(key);
    perLayer.set(k, (perLayer.get(k) ?? 0) + n);
  }
  const texts: TextOp[] = plan.texts.map((t) => ({
    ...t,
    xMm: -t.xMm,
    layer: oppositeLayer(t.layer),
  }));
  return { ops, texts, primitives: plan.primitives, perLayerPrimitives: perLayer };
}
