// Silk-over-pad (#9) — PCB Stage 12. Silkscreen ink printed over exposed pad
// copper smears/misregisters. For each silk graphic we build a world-placed
// shape and measure it against every pad on the same physical side.
//
// MVP scope: line / circle / rect silk primitives (the footprint-outline case),
// measured precisely with shapeDistance. Reference-designator text is skipped
// (allowed near its own pads); arc / poly / free text silk are deferred. Warning
// severity — silk-over-pad is a yield risk, not a hard failure.

import Flatbush from "flatbush";
import type { PcbBoard, FootprintInstance, FpGraphic } from "../../types";
import type { Vec2, PlacedShape, BBox } from "../../geometry";
import { shapeDistance, shapeBBox, transformPoint } from "../../geometry";
import { trackShape, padWorldShape, padCopperLayers } from "../../geometry-copper";
import type { LayerId } from "../../layers";
import type { CopperItemRef } from "../../connectivity-board";
import type { DrcCheckContext, DrcViolation } from "../types";
import { fmtMm, layerName, violationId } from "../format";
import { silkItemShapes } from "../../silk/geometry"; // Stage 16

interface SilkPrim {
  shape: PlacedShape;
  bbox: BBox;
  side: "top" | "bottom";
  layer: LayerId; // silkTop | silkBottom (physical)
  gid: string; // stable per graphic for the violation id
}

interface PadEntry {
  shape: PlacedShape;
  bbox: BBox;
  ref: CopperItemRef;
  side: "top" | "bottom";
}

function world(p: Vec2, inst: FootprintInstance): Vec2 {
  return transformPoint(p, inst.at, inst.rotationDeg, inst.side === "bottom");
}

/** Physical silk side: a silkTop graphic on a bottom-mounted part prints on silkBottom. */
function silkSide(inst: FootprintInstance, layer: LayerId): "top" | "bottom" | null {
  if (layer !== "silkTop" && layer !== "silkBottom") return null;
  const top = layer === "silkTop";
  const flipped = inst.side === "bottom" ? !top : top;
  return flipped ? "top" : "bottom";
}

function silkPrim(inst: FootprintInstance, g: FpGraphic, idx: number): SilkPrim | null {
  const side = silkSide(inst, g.layer);
  if (!side) return null;
  let shape: PlacedShape | null = null;
  if (g.kind === "line") {
    const t = { id: "", layer: g.layer, width: Math.max(g.width, 1), start: world(g.start, inst), end: world(g.end, inst), netId: 0 };
    shape = trackShape(t);
  } else if (g.kind === "circle") {
    const c = world(g.center, inst);
    const e = world(g.end, inst);
    const radius = Math.hypot(e.x - c.x, e.y - c.y);
    if (radius > 0) shape = { shape: { kind: "circle", radius }, at: c, rotationDeg: 0 };
  } else if (g.kind === "rect") {
    const s = g.start;
    const e = g.end;
    const centerLocal: Vec2 = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
    const width = Math.abs(e.x - s.x);
    const height = Math.abs(e.y - s.y);
    if (width > 0 && height > 0) {
      shape = {
        shape: { kind: "rect", width, height },
        at: world(centerLocal, inst),
        rotationDeg: inst.side === "bottom" ? -inst.rotationDeg : inst.rotationDeg,
      };
    }
  }
  if (!shape) return null;
  const physicalLayer: LayerId = side === "top" ? "silkTop" : "silkBottom";
  return { shape, bbox: shapeBBox(shape), side, layer: physicalLayer, gid: `${inst.id}#${idx}` };
}

function collectPads(board: PcbBoard): PadEntry[] {
  const out: PadEntry[] = [];
  for (const inst of board.footprints) {
    for (const pad of inst.def.pads) {
      const copper = padCopperLayers(inst, pad);
      if (copper.length === 0) continue;
      const side: "top" | "bottom" = copper.includes("copperTop") ? "top" : "bottom";
      const shape = padWorldShape(inst, pad);
      out.push({ shape, bbox: shapeBBox(shape), ref: { kind: "pad", instanceId: inst.id, padNumber: pad.number }, side });
    }
  }
  return out;
}

export function checkSilkOverPad(ctx: DrcCheckContext): DrcViolation[] {
  const threshold = ctx.rules.default.minSilkPadClearanceNm;
  const board = ctx.board;

  // Collect silk primitives (skip reference-designator text and unsupported kinds).
  const prims: SilkPrim[] = [];
  for (const inst of board.footprints) {
    inst.def.graphics.forEach((g, i) => {
      if (g.kind === "text" && g.textKind === "reference") return;
      const prim = silkPrim(inst, g, i);
      if (prim) prims.push(prim);
    });
  }
  // Stage 16: user silk items (text/line/rect/circle) join the same loop —
  // each expands to capsule/solid shapes measured exactly by shapeDistance.
  for (const item of board.silkItems ?? []) {
    const side = item.layer === "silkTop" ? "top" : "bottom";
    silkItemShapes(item).forEach((shape, i) => {
      prims.push({ shape, bbox: shapeBBox(shape), side, layer: item.layer, gid: `${item.id}#${i}` });
    });
  }
  if (prims.length === 0) return [];

  const pads = collectPads(board);
  if (pads.length === 0) return [];

  const tree = new Flatbush(pads.length);
  for (const p of pads) tree.add(p.bbox.minX, p.bbox.minY, p.bbox.maxX, p.bbox.maxY);
  tree.finish();

  const out: DrcViolation[] = [];
  const seen = new Set<string>();
  for (const prim of prims) {
    const q = threshold;
    for (const idx of tree.search(prim.bbox.minX - q, prim.bbox.minY - q, prim.bbox.maxX + q, prim.bbox.maxY + q)) {
      const pad = pads[idx];
      if (pad.side !== prim.side) continue;
      const gap = shapeDistance(prim.shape, pad.shape);
      if (gap >= threshold) continue;
      const key = `${prim.gid}|${pad.ref.kind === "pad" ? `${pad.ref.instanceId}.${pad.ref.padNumber}` : ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const items = [pad.ref];
      out.push({
        id: violationId("silkOverPad", items, gap, threshold, prim.gid),
        kind: "silkOverPad",
        severity: "warning",
        items,
        layer: prim.layer,
        location: { ...pad.shape.at },
        measuredNm: gap,
        thresholdNm: threshold,
        summary: `Silk on ${layerName(prim.layer)} is ${fmtMm(gap)} mm from a pad; need ≥ ${fmtMm(threshold)} mm.`,
        detail: `Silkscreen sits ${fmtMm(gap)} mm from pad copper (negative = printed over it), inside the ${fmtMm(threshold)} mm gap this fab needs to keep ink off pads. Move or trim the silk.`,
      });
    }
  }
  return out;
}
