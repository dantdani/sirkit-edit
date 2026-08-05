// Fab-capability geometry checks (PCB Stage 12): min track width (#2), via
// outer/drill/annular (#3–#5), hole-to-hole (#6), courtyard overlap (#8).
// Edge clearance (#7) is emitted by the clearance check (it reuses Stage 7's
// checkClearance, which already tests the board outline).

import Flatbush from "flatbush";
import type { PcbBoard, FootprintInstance } from "../../types";
import type { Vec2, PlacedShape } from "../../geometry";
import { shapeDistance, transformPoint } from "../../geometry";
import { padWorldPosition } from "../../geometry-copper";
import type { CopperItemRef } from "../../connectivity-board";
import type { DrcCheckContext, DrcViolation } from "../types";
import { fmtMm, layerName, violationId } from "../format";

function trackMidpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ── #2 Min track width ────────────────────────────────────────────────────────

export function checkMinTrackWidth(ctx: DrcCheckContext): DrcViolation[] {
  const out: DrcViolation[] = [];
  for (const track of ctx.board.tracks) {
    const threshold = ctx.eff(track.netId).minTrackWidthNm;
    if (track.width >= threshold) continue;
    const items: CopperItemRef[] = [{ kind: "track", id: track.id }];
    const where = layerName(track.layer);
    out.push({
      id: violationId("minTrackWidth", items, track.width, threshold),
      kind: "minTrackWidth",
      severity: "error",
      items,
      layer: track.layer,
      location: trackMidpoint(track.start, track.end),
      measuredNm: track.width,
      thresholdNm: threshold,
      summary: `Track on ${where} is ${fmtMm(track.width)} mm wide; need ≥ ${fmtMm(threshold)} mm.`,
      detail: `This trace is ${fmtMm(track.width)} mm wide, thinner than the ${fmtMm(threshold)} mm minimum this fab can reliably etch. Widen the trace or pick a fab with finer capabilities.`,
    });
  }
  return out;
}

// ── #3–#5 Via outer / drill / annular ring ────────────────────────────────────

export function checkVia(ctx: DrcCheckContext): DrcViolation[] {
  const out: DrcViolation[] = [];
  for (const via of ctx.board.vias) {
    const rules = ctx.eff(via.netId);
    const items: CopperItemRef[] = [{ kind: "via", id: via.id }];
    const loc: Vec2 = { ...via.at };

    if (via.size < rules.minViaOuterNm) {
      out.push({
        id: violationId("viaOuterDiameter", items, via.size, rules.minViaOuterNm),
        kind: "viaOuterDiameter",
        severity: "error",
        items,
        layer: via.layers[0],
        location: loc,
        measuredNm: via.size,
        thresholdNm: rules.minViaOuterNm,
        summary: `Via is ${fmtMm(via.size)} mm across; need ≥ ${fmtMm(rules.minViaOuterNm)} mm.`,
        detail: `This via's outer diameter is ${fmtMm(via.size)} mm, below the ${fmtMm(rules.minViaOuterNm)} mm minimum pad this fab plates. Increase the via size.`,
      });
    }
    if (via.drill < rules.minViaDrillNm) {
      out.push({
        id: violationId("viaDrill", items, via.drill, rules.minViaDrillNm),
        kind: "viaDrill",
        severity: "error",
        items,
        layer: via.layers[0],
        location: loc,
        measuredNm: via.drill,
        thresholdNm: rules.minViaDrillNm,
        summary: `Via drill is ${fmtMm(via.drill)} mm; need ≥ ${fmtMm(rules.minViaDrillNm)} mm.`,
        detail: `This via's hole is ${fmtMm(via.drill)} mm, smaller than the ${fmtMm(rules.minViaDrillNm)} mm minimum drill this fab offers. Enlarge the drill.`,
      });
    }
    const annular = (via.size - via.drill) / 2;
    if (annular < rules.minAnnularRingNm) {
      out.push({
        id: violationId("annularRing", items, annular, rules.minAnnularRingNm),
        kind: "annularRing",
        severity: "error",
        items,
        layer: via.layers[0],
        location: loc,
        measuredNm: annular,
        thresholdNm: rules.minAnnularRingNm,
        summary: `Via annular ring is ${fmtMm(annular)} mm; need ≥ ${fmtMm(rules.minAnnularRingNm)} mm.`,
        detail: `The copper ring around this via is ${fmtMm(annular)} mm wide ((outer − drill) / 2), below the ${fmtMm(rules.minAnnularRingNm)} mm this fab needs to avoid breakout. Increase the via size or reduce the drill.`,
      });
    }
  }
  return out;
}

// ── #6 Hole-to-hole ───────────────────────────────────────────────────────────

interface Hole {
  center: Vec2;
  radius: number;
  ref: CopperItemRef;
}

function collectHoles(board: PcbBoard): Hole[] {
  const holes: Hole[] = [];
  for (const via of board.vias) {
    holes.push({ center: via.at, radius: via.drill / 2, ref: { kind: "via", id: via.id } });
  }
  for (const inst of board.footprints) {
    for (const pad of inst.def.pads) {
      if (!pad.drill) continue; // SMD pads have no hole
      holes.push({
        center: padWorldPosition(inst, pad),
        radius: pad.drill.diameter / 2,
        ref: { kind: "pad", instanceId: inst.id, padNumber: pad.number },
      });
    }
  }
  return holes;
}

export function checkHoleToHole(ctx: DrcCheckContext): DrcViolation[] {
  const threshold = ctx.rules.default.minHoleToHoleNm;
  const holes = collectHoles(ctx.board);
  if (holes.length < 2) return [];

  const maxR = holes.reduce((m, h) => Math.max(m, h.radius), 0);
  const tree = new Flatbush(holes.length);
  for (const h of holes) tree.add(h.center.x - h.radius, h.center.y - h.radius, h.center.x + h.radius, h.center.y + h.radius);
  tree.finish();

  const out: DrcViolation[] = [];
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    const pad = h.radius + maxR + threshold;
    for (const j of tree.search(h.center.x - pad, h.center.y - pad, h.center.x + pad, h.center.y + pad)) {
      if (j <= i) continue; // each unordered pair once
      const o = holes[j];
      const gap = Math.hypot(h.center.x - o.center.x, h.center.y - o.center.y) - h.radius - o.radius;
      if (gap >= threshold) continue;
      const items = [h.ref, o.ref];
      out.push({
        id: violationId("holeToHole", items, gap, threshold),
        kind: "holeToHole",
        severity: "error",
        items,
        location: trackMidpoint(h.center, o.center),
        measuredNm: gap,
        thresholdNm: threshold,
        summary: `Two holes are ${fmtMm(gap)} mm apart (rim to rim); need ≥ ${fmtMm(threshold)} mm.`,
        detail: `The nearest edges of two drilled holes are ${fmtMm(gap)} mm apart, closer than the ${fmtMm(threshold)} mm hole-to-hole spacing this fab requires (a negative value means the holes overlap). Move a via or footprint.`,
      });
    }
  }
  return out;
}

// ── #8 Courtyard overlap ──────────────────────────────────────────────────────

/** The footprint's courtyard as a world-placed oriented rectangle, or null. */
/**
 * Strict interior-overlap test for two placed rects (SAT with a 1 nm touch
 * tolerance). Needed because `shapeDistance` is sign-only for zero-radius
 * shapes: two OVERLAPPING rect courtyards measure gap 0, identical to
 * touching — so with a preset courtyard clearance of 0 (touching allowed),
 * `gap >= threshold` could never flag a true overlap.
 */
function rectInteriorsOverlap(a: PlacedShape, b: PlacedShape): boolean {
  if (a.shape.kind !== "rect" || b.shape.kind !== "rect") return false;
  const corners = (p: PlacedShape): Vec2[] => {
    const { width, height } = p.shape as { width: number; height: number };
    const hw = width / 2, hh = height / 2;
    return [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }]
      .map((corner) => transformPoint(corner, p.at, p.rotationDeg, false));
  };
  const ca = corners(a), cb = corners(b);
  const axes: Vec2[] = [];
  for (const poly of [ca, cb]) for (let i = 0; i < 2; i++) {
    const edge = { x: poly[(i + 1) % 4]!.x - poly[i]!.x, y: poly[(i + 1) % 4]!.y - poly[i]!.y };
    axes.push({ x: -edge.y, y: edge.x });
  }
  const TOUCH_NM = 1;
  for (const axis of axes) {
    const length = Math.hypot(axis.x, axis.y);
    if (length === 0) continue;
    const project = (pts: Vec2[]) => {
      let min = Infinity, max = -Infinity;
      for (const pt of pts) { const d = (pt.x * axis.x + pt.y * axis.y) / length; if (d < min) min = d; if (d > max) max = d; }
      return { min, max };
    };
    const pa = project(ca), pb = project(cb);
    if (Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min) <= TOUCH_NM) return false; // separated or merely touching on this axis
  }
  return true;
}

function courtyardShape(inst: FootprintInstance): PlacedShape | null {
  const cb = inst.def.courtyardBBox;
  if (!cb) return null;
  const width = cb.maxX - cb.minX;
  const height = cb.maxY - cb.minY;
  if (width <= 0 || height <= 0) return null;
  const centerLocal: Vec2 = { x: (cb.minX + cb.maxX) / 2, y: (cb.minY + cb.maxY) / 2 };
  const bottom = inst.side === "bottom";
  return {
    shape: { kind: "rect", width, height },
    at: transformPoint(centerLocal, inst.at, inst.rotationDeg, bottom),
    rotationDeg: bottom ? -inst.rotationDeg : inst.rotationDeg,
  };
}

export function checkCourtyardOverlap(ctx: DrcCheckContext): DrcViolation[] {
  const threshold = ctx.rules.default.minCourtyardClearanceNm;
  const insts = ctx.board.footprints;
  const shapes = insts.map(courtyardShape);
  const out: DrcViolation[] = [];

  for (let i = 0; i < insts.length; i++) {
    const a = shapes[i];
    if (!a) continue;
    for (let j = i + 1; j < insts.length; j++) {
      const b = shapes[j];
      if (!b) continue;
      if (insts[i].side !== insts[j].side) continue; // opposite sides never collide
      const gap = shapeDistance(a, b);
      if (gap >= threshold && !rectInteriorsOverlap(a, b)) continue;
      const layer = insts[i].side === "bottom" ? "courtyardBottom" : "courtyardTop";
      const extra = [insts[i].id, insts[j].id].sort().join("|");
      out.push({
        id: violationId("courtyardOverlap", [], gap, threshold, extra),
        kind: "courtyardOverlap",
        severity: "error",
        items: [],
        objectIds: [insts[i].id, insts[j].id],
        layer,
        location: trackMidpoint(a.at, b.at),
        measuredNm: gap,
        thresholdNm: threshold,
        summary: `Footprints ${insts[i].ref} and ${insts[j].ref} courtyards overlap.`,
        detail: `The courtyards of ${insts[i].ref} and ${insts[j].ref} are ${fmtMm(gap)} mm apart (negative = overlapping), inside the ${fmtMm(threshold)} mm courtyard gap this preset requires. Move the parts apart.`,
      });
    }
  }
  return out;
}
