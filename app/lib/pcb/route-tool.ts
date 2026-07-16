/**
 * Interactive routing tool (PCB Stage 7) — PURE state machine + clearance
 * guard. NO Pixi/React/DOM: it takes world-nm coordinates and a board getter,
 * emits `RouteCommand`s through `applyCommand`, and exposes a plain state
 * object the renderer reads. Everything Pixi lives in render/route-preview.ts;
 * everything React in hooks/useRouteTool.ts.
 *
 * `checkClearance` is the pinned live guard — Stage 12's DRC imports it VERBATIM
 * to run at batch scope over all copper. Do not fork it. The tool calls it every
 * pointer-move; an illegal result makes the commit a hard no-op (cannot-commit-
 * illegal-geometry is inviolable — no "warn and allow").
 *
 * Net-class defaults are hard-coded here until Stage 10 lands `getNetClass`;
 * pass `options.netClass` to override (the hook wires it in when Stage 10 ships).
 */

import Flatbush from "flatbush";
import type { PcbBoard, Track, Via, Pad, FootprintInstance, BoardOutline, FilledRegion } from "./types";
import type { Vec2, BBox, PlacedShape } from "./geometry";
import { shapeDistance, shapeBBox } from "./geometry";
import { COPPER_LAYERS, type LayerId } from "./layers";
import {
  trackShape,
  padWorldShape,
  padWorldPosition,
  padCopperLayers,
  trackTrackDistance,
  trackViaDistance,
  trackPadDistance,
  viaViaDistance,
  viaPadDistance,
  viaShape,
  viaSpannedLayers,
  segmentDistance,
} from "./geometry-copper";
import { polygonBBox, regionAreaNm2, regionShapeDistance } from "./zones/geometry"; // Stage 11: zone fills are obstacles
import type { CopperItemRef } from "./connectivity-board";
import type { RouteCommand } from "./route-tool.commands";
import { buildRipupNetCommand } from "./route-tool.commands";
import { classDefaultPadstack, applyPadstackToVia } from "./padstack/defaults"; // Stage 17
import { getPadstack } from "./padstack/registry";
import { adaptBoardToRoutingWorld } from "./smart-routing/world";
import { resolveSmartRoutingRules } from "./smart-routing/rules";
import { routeSmart } from "./smart-routing/engine";
import {
  beginPreviewTransaction,
  createRoutingHistoryEvent,
  stagePreviewCandidates,
} from "./smart-routing/transaction";
import type {
  EffectiveRoutingRules,
  RoutingWorld,
  SmartRouteCandidate,
  SmartRouteIntent,
  SmartRouteResult,
} from "./smart-routing/types";

// ── Net-class defaults (Stage 10 `getNetClass` supersedes; see options.netClass)
export const DEFAULT_TRACK_WIDTH = 250_000; // 0.25 mm
export const DEFAULT_CLEARANCE = 200_000; // 0.2 mm
export const DEFAULT_VIA_SIZE = 800_000; // 0.8 mm outer
export const DEFAULT_VIA_DRILL = 400_000; // 0.4 mm drill
export const DEFAULT_EDGE_CLEARANCE = 250_000; // 0.25 mm to board edge
export const DEFAULT_GRID = 25_000; // 0.025 mm routing grid
/** World-nm pointer travel that turns a track-down into a stretch (vs a click). */
const STRETCH_DRAG_THRESHOLD = 30_000;

export interface NetClass {
  trackWidth: number;
  clearance: number;
  viaSize: number;
  viaDrill: number;
}

// ── Tool state (pinned; `blockedText` is an additive, render-facing field) ────

export interface RoutePreview {
  corner: Vec2; // 45°-constrained bend point
  end: Vec2; // cursor position, grid-snapped (or a same-net pad center)
  legal: boolean; // false when any candidate segment fails clearance
  blockedBy?: CopperItemRef; // first offender (deterministic order)
  blockedByKeepoutId?: string;
  /** Plain-English tooltip built from `blockedBy` + board (see describeBlock). */
  blockedText?: string;
  /** Full route polyline; legacy `corner` remains for compatible consumers. */
  points?: readonly Vec2[];
  /** Independently validated alternatives. Tab cycles this array. */
  candidates?: readonly SmartRouteCandidate[];
  selectedCandidateId?: string;
  smartStatus?: SmartRouteResult["status"];
  smartExplanation?: string;
  searchElapsedMs?: number;
}

export interface StretchPreview {
  end: Vec2;
  legal: boolean;
  blockedBy?: CopperItemRef;
  blockedText?: string;
}

export type RouteToolState =
  | { kind: "idle" }
  | {
      kind: "routing";
      netId: number;
      activeLayer: LayerId;
      trackWidth: number;
      clearance: number;
      viaSize: number;
      viaDrill: number;
      viaPadstackId?: string;
      anchor: Vec2; // last committed vertex (world nm)
      preview: RoutePreview;
      preferHorizontalFirst: boolean; // Tab toggles this
    }
  | {
      kind: "stretching";
      trackId: string;
      grabbedEnd: "a" | "b";
      /** Live moved geometry (additive — the renderer draws these). */
      segments: Track[];
      preview: StretchPreview;
    };

export interface RouteToolAPI {
  state: RouteToolState;
  onPointerDown(world: Vec2, event: { shiftKey: boolean; altKey: boolean }): void;
  onPointerMove(world: Vec2): void;
  onPointerUp(world: Vec2): void;
  onKey(key: "V" | "Escape" | "Backspace" | "X" | "Tab"): void;
  cancel(): void;
  /** Rip up the whole net under `world` (right-click). Returns true if it acted. */
  ripupNetAt(world: Vec2): boolean;
  /** Frozen copy safe to render from. */
  snapshot(): RouteToolState;
}

export interface RouteToolOptions {
  /** Delegates to Stage 5 history.undo() for Backspace (remove last segment). */
  undo?: () => void;
  /** Board's active copper layer — the start layer for THT pads. */
  getActiveLayer?: () => LayerId;
  /** Stage 10 `getNetClass`; defaults to the constants above. */
  netClass?: (netId: number) => NetClass;
  routingProfile?: (netId: number) => {
    trackWidth: number;
    clearance: number;
    viaSize: number;
    viaDrill: number;
    viaPadstackId?: string;
  };
  grid?: number;
}

// ── 45° corner (pinned math) ─────────────────────────────────────────────────

/**
 * Bend point so that `anchor→corner` and `corner→end` are each axis-aligned or
 * exactly 45°. The two orientations (Tab toggles `preferHorizontalFirst`):
 *   true  → straight axis run first, then the 45° diagonal
 *   false → the 45° diagonal first, then the straight axis run
 * Both are always geometrically valid. Axis-aligned or perfect-diagonal targets
 * collapse to a single segment (corner === end; the renderer skips zero-length).
 */
export function fortyFiveCorner(anchor: Vec2, end: Vec2, preferHorizontalFirst: boolean): Vec2 {
  const dx = end.x - anchor.x;
  const dy = end.y - anchor.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx === 0 || ady === 0 || adx === ady) return { x: end.x, y: end.y };
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const m = Math.min(adx, ady);
  if (preferHorizontalFirst) {
    // straight-first: consume the excess of the dominant axis, then diagonal
    return adx >= ady
      ? { x: anchor.x + sx * (adx - m), y: anchor.y }
      : { x: anchor.x, y: anchor.y + sy * (ady - m) };
  }
  // diagonal-first: 45° diagonal of length m·√2, then the straight axis run
  return { x: anchor.x + sx * m, y: anchor.y + sy * m };
}

// ── Clearance guard (pinned; Stage 12 imports this) ──────────────────────────

export interface ClearanceGuardInput {
  candidateSegments: Track[];
  candidateVias?: Via[];
  ignoreItemIds?: Set<string>;
  netId: number;
  clearance: number;
  /** Distance every candidate must keep from the board outline. */
  edgeClearance?: number;
}

export interface ClearanceGuardResult {
  legal: boolean;
  blockedBy?: CopperItemRef;
  /** A typed routing keepout is not conductive, so it is not a CopperItemRef. */
  blockedByKeepoutId?: string;
  distance?: number; // nm; negative = overlap
  /** Additive: the first violation is the board edge (has no CopperItemRef). */
  blockedByEdge?: boolean;
}

interface Obstacle {
  ref?: CopperItemRef;
  rank: 0 | 1 | 2 | 3 | 4; // pad/hole < track < via < zone < keepout (edge is 5)
  key: string; // deterministic tiebreak within a rank
  netId: number;
  bbox: BBox;
  kind: "pad" | "track" | "via" | "zone" | "keepout";
  track?: Track;
  via?: Via;
  inst?: FootprintInstance;
  pad?: Pad;
  /** Stage 11: zone fill region (+ its layer) — same-net zones never obstruct. */
  region?: FilledRegion;
  zoneLayer?: LayerId;
  padLayers?: readonly LayerId[];
  throughAllLayers?: boolean;
  keepoutId?: string;
  forbidTracks?: boolean;
  forbidVias?: boolean;
}

function trackBBox(t: Track): BBox {
  const r = t.width / 2;
  return {
    minX: Math.min(t.start.x, t.end.x) - r,
    minY: Math.min(t.start.y, t.end.y) - r,
    maxX: Math.max(t.start.x, t.end.x) + r,
    maxY: Math.max(t.start.y, t.end.y) + r,
  };
}

function viaBBox(v: Via): BBox {
  const r = v.size / 2;
  return { minX: v.at.x - r, minY: v.at.y - r, maxX: v.at.x + r, maxY: v.at.y + r };
}

function padRefKey(instanceId: string, padNumber: string): string {
  return `${instanceId}.${padNumber}`;
}

function collectObstacles(board: PcbBoard, ignore: Set<string>): Obstacle[] {
  const out: Obstacle[] = [];
  const allCopper: readonly LayerId[] =
    board.stackup === 2 ? ["copperTop", "copperBottom"] : COPPER_LAYERS;
  for (const inst of board.footprints) {
    for (const pad of inst.def.pads) {
      const throughAllLayers = pad.type === "np_thru_hole";
      const padLayers = throughAllLayers ? allCopper : padCopperLayers(inst, pad);
      if (padLayers.length === 0) continue;
      const key = padRefKey(inst.id, pad.number);
      if (ignore.has(key)) continue;
      out.push({
        ref: { kind: "pad", instanceId: inst.id, padNumber: pad.number },
        rank: 0,
        key,
        netId: throughAllLayers ? 0 : (inst.padNets[pad.number] ?? 0),
        bbox: shapeBBox(padWorldShape(inst, pad)),
        kind: "pad",
        inst,
        pad,
        padLayers,
        throughAllLayers,
      });
    }
  }
  for (const track of board.tracks) {
    if (ignore.has(track.id)) continue;
    out.push({
      ref: { kind: "track", id: track.id },
      rank: 1,
      key: track.id,
      netId: track.netId,
      bbox: trackBBox(track),
      kind: "track",
      track,
    });
  }
  for (const via of board.vias) {
    if (ignore.has(via.id)) continue;
    out.push({
      ref: { kind: "via", id: via.id },
      rank: 2,
      key: via.id,
      netId: via.netId,
      bbox: viaBBox(via),
      kind: "via",
      via,
    });
  }
  // Stage 11: filled zone regions are copper. Foreign-net fills block routing
  // (the corridor prescription); same-net fills are skipped at query time —
  // the pour re-flows around/onto committed copper.
  for (const zone of board.zones) {
    if (ignore.has(zone.id)) continue;
    zone.fill.forEach((region, regionIndex) => {
      out.push({
        ref: { kind: "zone-region", zoneId: zone.id, regionIndex },
        rank: 3,
        key: `${zone.id}#${regionIndex}`,
        netId: zone.netId,
        bbox: region.boundingBox,
        kind: "zone",
        region,
        zoneLayer: zone.layer,
      });
    });
  }
  for (const keepout of board.routingKeepouts ?? []) {
    if (ignore.has(keepout.id) || keepout.polygon.length < 3) continue;
    const boundingBox = polygonBBox(keepout.polygon);
    out.push({
      rank: 4,
      key: keepout.id,
      netId: 0,
      bbox: boundingBox,
      kind: "keepout",
      region: {
        outer: keepout.polygon,
        holes: [],
        boundingBox,
        areaNm2: regionAreaNm2(keepout.polygon, []),
      },
      keepoutId: keepout.id,
      padLayers: keepout.layers,
      forbidTracks: keepout.forbidTracks,
      forbidVias: keepout.forbidVias,
    });
  }
  return out;
}

function trackToObstacleDistance(t: Track, o: Obstacle): number {
  if (o.kind === "track") return trackTrackDistance(t, o.track as Track);
  if (o.kind === "via") return trackViaDistance(t, o.via as Via);
  if (o.kind === "zone") {
    if (o.zoneLayer !== t.layer) return Infinity;
    return regionShapeDistance(o.region as FilledRegion, trackShape(t), t.start);
  }
  if (o.kind === "keepout") {
    if (!o.forbidTracks || !o.padLayers?.includes(t.layer)) return Infinity;
    return regionShapeDistance(o.region as FilledRegion, trackShape(t), t.start);
  }
  if (o.throughAllLayers) return shapeDistance(trackShape(t), padWorldShape(o.inst as FootprintInstance, o.pad as Pad));
  if (!o.throughAllLayers && !o.padLayers?.includes(t.layer)) return Infinity;
  return trackPadDistance(t, o.inst as FootprintInstance, o.pad as Pad);
}

function viaToObstacleDistance(v: Via, o: Obstacle): number {
  if (o.kind === "track") return trackViaDistance(o.track as Track, v);
  if (o.kind === "via") return viaViaDistance(v, o.via as Via);
  if (o.kind === "zone") {
    if (!viaSpannedLayers(v).includes(o.zoneLayer as LayerId)) return Infinity;
    return regionShapeDistance(o.region as FilledRegion, viaShape(v), v.at);
  }
  if (o.kind === "keepout") {
    if (!o.forbidVias || !viaSpannedLayers(v).some((layer) => o.padLayers?.includes(layer))) return Infinity;
    return regionShapeDistance(o.region as FilledRegion, viaShape(v), v.at);
  }
  if (o.throughAllLayers) return shapeDistance(viaShape(v), padWorldShape(o.inst as FootprintInstance, o.pad as Pad));
  if (!o.throughAllLayers && !viaSpannedLayers(v).some((layer) => o.padLayers?.includes(layer))) return Infinity;
  return viaPadDistance(v, o.inst as FootprintInstance, o.pad as Pad);
}

/** A gap violates when: same net → 0 < d < clearance; else → d < clearance. */
function isViolation(d: number, obstacleNet: number, netId: number, clearance: number): boolean {
  if (d === Infinity) return false; // not on a shared copper layer
  const sameNet = obstacleNet === netId && netId !== 0;
  if (sameNet) return d > 0 && d < clearance;
  return d < clearance;
}

const CORNER_CHORDS = 4; // arc-chords per rounded corner

/** Boundary of a roundrect as chord segments following the true (rounded) edge. */
function roundRectSegments(x: number, y: number, w: number, h: number, r: number): [Vec2, Vec2][] {
  const pts: Vec2[] = [];
  const arc = (cx: number, cy: number, a0: number, a1: number): void => {
    for (let i = 0; i <= CORNER_CHORDS; i++) {
      const a = a0 + ((a1 - a0) * i) / CORNER_CHORDS;
      pts.push({ x: Math.round(cx + r * Math.cos(a)), y: Math.round(cy + r * Math.sin(a)) });
    }
  };
  // +y down; walk NW → NE → SE → SW. Straight edges emerge from the gaps.
  arc(x + r, y + r, Math.PI, Math.PI * 1.5);
  arc(x + w - r, y + r, Math.PI * 1.5, Math.PI * 2);
  arc(x + w - r, y + h - r, 0, Math.PI * 0.5);
  arc(x + r, y + h - r, Math.PI * 0.5, Math.PI);
  const segs: [Vec2, Vec2][] = [];
  for (let i = 0; i < pts.length; i++) segs.push([pts[i], pts[(i + 1) % pts.length]]);
  return segs;
}

function outlineSegments(outline: BoardOutline): [Vec2, Vec2][] {
  if (outline.kind === "polygon") {
    const p = outline.points;
    const segs: [Vec2, Vec2][] = [];
    for (let i = 0; i < p.length; i++) segs.push([p[i], p[(i + 1) % p.length]]);
    return segs;
  }
  const { x, y } = outline.origin;
  const w = outline.width;
  const h = outline.height;
  if (outline.kind === "roundrect") {
    const r = Math.min(outline.cornerRadius, w / 2, h / 2);
    if (r > 0) return roundRectSegments(x, y, w, h, r);
  }
  const nw = { x, y };
  const ne = { x: x + w, y };
  const se = { x: x + w, y: y + h };
  const sw = { x, y: y + h };
  return [
    [nw, ne],
    [ne, se],
    [se, sw],
    [sw, nw],
  ];
}

/** Is `p` inside the board outline? (Rounded corners approximated as square.) */
function pointInOutline(outline: BoardOutline, p: Vec2): boolean {
  if (outline.kind === "polygon") {
    const pts = outline.points;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }
  const { x, y } = outline.origin;
  return p.x >= x && p.x <= x + outline.width && p.y >= y && p.y <= y + outline.height;
}

interface Violation {
  rank: number;
  key: string;
  distance: number;
  ref?: CopperItemRef;
  keepoutId?: string;
  edge?: boolean;
}

export function checkClearance(board: PcbBoard, input: ClearanceGuardInput): ClearanceGuardResult {
  const { candidateSegments, candidateVias = [], netId, clearance } = input;
  const ignore = input.ignoreItemIds ?? new Set<string>();
  const edgeClearance = input.edgeClearance ?? DEFAULT_EDGE_CLEARANCE;

  const obstacles = collectObstacles(board, ignore);
  const violations: Violation[] = [];

  if (obstacles.length > 0) {
    const tree = new Flatbush(obstacles.length);
    for (const o of obstacles) tree.add(o.bbox.minX, o.bbox.minY, o.bbox.maxX, o.bbox.maxY);
    tree.finish();

    const query = (bb: BBox): number[] =>
      tree.search(bb.minX - clearance, bb.minY - clearance, bb.maxX + clearance, bb.maxY + clearance);

    for (const seg of candidateSegments) {
      for (const hit of query(trackBBox(seg))) {
        const o = obstacles[hit];
        if (o.kind === "zone" && o.netId === netId) continue; // pour joins same-net copper
        const d = trackToObstacleDistance(seg, o);
        if (isViolation(d, o.netId, netId, clearance)) {
          violations.push({ rank: o.rank, key: o.key, distance: d, ref: o.ref, keepoutId: o.keepoutId });
        }
      }
    }
    for (const v of candidateVias) {
      for (const hit of query(viaBBox(v))) {
        const o = obstacles[hit];
        if (o.kind === "zone" && o.netId === netId) continue; // pour joins same-net copper
        const d = viaToObstacleDistance(v, o);
        if (isViolation(d, o.netId, netId, clearance)) {
          violations.push({ rank: o.rank, key: o.key, distance: d, ref: o.ref, keepoutId: o.keepoutId });
        }
      }
    }
  }

  // Board edge (no CopperItemRef): rank 4, after all copper (zones are 3). Distances are
  // UNSIGNED (proximity to the outline), so an endpoint OUTSIDE the board is
  // flagged explicitly — the proximity check alone can't tell inside from out
  // (matters for Stage 12 DRC over arbitrary copper; interactively the anchor
  // is always inside so a crossing sub-segment already trips the proximity check).
  const edges = outlineSegments(board.outline);
  for (const seg of candidateSegments) {
    if (!pointInOutline(board.outline, seg.start) || !pointInOutline(board.outline, seg.end)) {
      violations.push({ rank: 5, key: "", distance: -edgeClearance, edge: true });
    }
    for (const [a, b] of edges) {
      const d = segmentDistance(seg.start, seg.end, a, b) - seg.width / 2;
      if (d < edgeClearance) violations.push({ rank: 5, key: "", distance: d, edge: true });
    }
  }
  for (const v of candidateVias) {
    if (!pointInOutline(board.outline, v.at)) {
      violations.push({ rank: 5, key: "", distance: -v.size / 2, edge: true });
    }
    for (const [a, b] of edges) {
      const d = segmentDistance(v.at, v.at, a, b) - v.size / 2;
      if (d < edgeClearance) violations.push({ rank: 5, key: "", distance: d, edge: true });
    }
  }

  if (violations.length === 0) return { legal: true };

  violations.sort(
    (x, y) => x.rank - y.rank || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0) || x.distance - y.distance,
  );
  const first = violations[0];
  return {
    legal: false,
    blockedBy: first.ref,
    blockedByKeepoutId: first.keepoutId,
    distance: first.distance,
    blockedByEdge: first.edge,
  };
}

// ── Tooltip text (tool owns it — has board + net names; renderer just emits) ──

function netName(board: PcbBoard, netId: number): string {
  return board.nets.find((n) => n.id === netId)?.name || `net ${netId}`;
}

const nmMm = (nm: number): string => (nm / 1_000_000).toFixed(2);

function describeBlock(
  board: PcbBoard,
  netId: number,
  clearance: number,
  res: ClearanceGuardResult,
): string {
  if (res.blockedByEdge) return "Too close to board edge";
  if (res.blockedByKeepoutId) {
    const name = board.routingKeepouts?.find((item) => item.id === res.blockedByKeepoutId)?.name;
    return `Route enters ${name || "a copper keepout"}`;
  }
  const ref = res.blockedBy;
  const d = res.distance ?? 0;
  const near = (label: string): string =>
    `Too close to ${label} (${nmMm(d)} mm; need ≥ ${nmMm(clearance)} mm)`;
  if (!ref) return "Clearance violation";
  if (ref.kind === "pad") {
    const inst = board.footprints.find((f) => f.id === ref.instanceId);
    const padNet = inst?.padNets[ref.padNumber] ?? 0;
    const label = inst ? `${inst.ref}.${ref.padNumber}` : ref.padNumber;
    if (padNet !== netId && d <= 0) return `Would touch ${netName(board, padNet)} (short)`;
    return near(label);
  }
  if (ref.kind === "track") {
    const t = board.tracks.find((x) => x.id === ref.id);
    const tNet = t?.netId ?? 0;
    if (tNet !== netId && d <= 0) return `Would touch ${netName(board, tNet)} (short)`;
    return near(`a ${netName(board, tNet)} track`);
  }
  if (ref.kind === "zone-region") {
    // Stage 11: filled zone copper.
    const zNet = board.zones.find((z) => z.id === ref.zoneId)?.netId ?? 0;
    if (zNet !== netId && d <= 0) return `Would touch the ${netName(board, zNet)} zone (short)`;
    return near(`the ${netName(board, zNet)} zone`);
  }
  const v = board.vias.find((x) => x.id === ref.id);
  const vNet = v?.netId ?? 0;
  if (vNet !== netId && d <= 0) return `Would touch ${netName(board, vNet)} (short)`;
  return near(`a ${netName(board, vNet)} via`);
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

const samePoint = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};
const pointShape = (p: Vec2): PlacedShape => ({
  shape: { kind: "circle", radius: 0 },
  at: p,
  rotationDeg: 0,
});

interface PadHit {
  inst: FootprintInstance;
  pad: Pad;
  netId: number;
  world: Vec2;
  layer: LayerId;
}

/** First pad whose copper contains `world` (linear — click-rate only). */
function hitPad(board: PcbBoard, world: Vec2, preferLayer?: LayerId): PadHit | null {
  const p = pointShape(world);
  for (const inst of board.footprints) {
    for (const pad of inst.def.pads) {
      if (pad.type === "np_thru_hole") continue;
      const layers = padCopperLayers(inst, pad);
      if (layers.length === 0) continue;
      if (shapeDistance(padWorldShape(inst, pad), p) <= 0) {
        const layer = preferLayer && layers.includes(preferLayer) ? preferLayer : layers[0];
        return { inst, pad, netId: inst.padNets[pad.number] ?? 0, world: padWorldPosition(inst, pad), layer };
      }
    }
  }
  return null;
}

interface TrackHit {
  track: Track;
  grabbedEnd: "a" | "b";
}

/** Closest track whose capsule contains `world` (linear — click-rate only). */
function hitTrack(board: PcbBoard, world: Vec2): TrackHit | null {
  const p = pointShape(world);
  let best: Track | null = null;
  let bestD = Infinity;
  for (const t of board.tracks) {
    const d = shapeDistance(trackShape(t), p);
    if (d <= 0 && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  if (!best) return null;
  const grabbedEnd = dist2(world, best.start) <= dist2(world, best.end) ? "a" : "b";
  return { track: best, grabbedEnd };
}

// ── Id generation (nanoid isn't a dependency; salted counter is unique) ──────
let idSeq = 0;
const idSalt = Math.random().toString(36).slice(2, 8);
function freshId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSalt}-${idSeq}`;
}

/** MVP 2-layer flip; 4-layer inner-layer via posture is post-Stage-10. */
function flipCopperLayer(layer: LayerId): LayerId {
  return layer === "copperTop" ? "copperBottom" : "copperTop";
}

// ── The tool ─────────────────────────────────────────────────────────────────

export function createRouteTool(
  getBoard: () => PcbBoard,
  applyCommand: (cmd: RouteCommand) => void,
  options: RouteToolOptions = {},
): RouteToolAPI {
  const grid = options.grid ?? DEFAULT_GRID;
  const netClassOf = (netId: number): NetClass =>
    options.netClass?.(netId) ?? {
      trackWidth: DEFAULT_TRACK_WIDTH,
      clearance: DEFAULT_CLEARANCE,
      viaSize: DEFAULT_VIA_SIZE,
      viaDrill: DEFAULT_VIA_DRILL,
    };

  const snap = (v: Vec2): Vec2 => ({
    x: Math.round(v.x / grid) * grid,
    y: Math.round(v.y / grid) * grid,
  });

  let state: RouteToolState = { kind: "idle" };
  let lastMoveWorld: Vec2 | null = null;
  let cachedWorldBoard: PcbBoard | null = null;
  let cachedWorld: RoutingWorld | null = null;

  function worldFor(board: PcbBoard): RoutingWorld {
    if (board !== cachedWorldBoard || !cachedWorld) {
      cachedWorldBoard = board;
      cachedWorld = adaptBoardToRoutingWorld(board);
    }
    return cachedWorld;
  }

  // Routing bookkeeping (Backspace unwind of anchor + layer per committed step).
  let routeStack: { anchor: Vec2; activeLayer: LayerId }[] = [];

  // Pending track-grab: idle down on a track → resolves to stretch (on drag) or
  // route-from-endpoint (on release without drag).
  let pendingGrab: { trackId: string; grabbedEnd: "a" | "b"; downWorld: Vec2 } | null = null;

  // Stretch bookkeeping.
  let stretch: {
    grabPos: Vec2;
    movedIds: Set<string>;
    origins: Track[];
    after: Track[];
    netId: number;
    clearance: number;
  } | null = null;

  function makeTrack(start: Vec2, end: Vec2, layer: LayerId, width: number, netId: number): Track {
    return { id: freshId("rt-t"), layer, width, start, end, netId };
  }

  function buildSegmentsFromPoints(
    points: readonly Vec2[],
    layer: LayerId,
    width: number,
    netId: number,
    committed: boolean,
  ): Track[] {
    const segs: Track[] = [];
    for (let index = 0; index + 1 < points.length; index++) {
      if (samePoint(points[index], points[index + 1])) continue;
      segs.push(committed
        ? makeTrack(points[index], points[index + 1], layer, width, netId)
        : {
            id: `smart-preview-${index}`,
            layer,
            width,
            start: { ...points[index] },
            end: { ...points[index + 1] },
            netId,
          });
    }
    return segs;
  }

  interface RoutingResolve {
    corner: Vec2;
    end: Vec2;
    segments: Track[];
    legal: boolean;
    blockedBy?: CopperItemRef;
    blockedByKeepoutId?: string;
    blockedText?: string;
    targetPad: PadHit | null;
    points: readonly Vec2[];
    candidates: readonly SmartRouteCandidate[];
    selectedCandidate?: SmartRouteCandidate;
    smartResult: SmartRouteResult;
    smartIntent: SmartRouteIntent;
    smartRules: EffectiveRoutingRules;
    smartWorld: RoutingWorld;
  }

  function resolveRouting(world: Vec2): RoutingResolve {
    if (state.kind !== "routing") throw new Error("resolveRouting outside routing");
    const board = getBoard();
    const { netId, activeLayer, trackWidth, clearance, anchor, preferHorizontalFirst } = state;

    // Snap the end: a same-net pad with copper on the ACTIVE layer is an exact
    // connection; else the grid. (A same-net pad whose copper is on the other
    // layer is NOT a completion target — the user must drop a via first, or the
    // trace would end at the pad center electrically unconnected.)
    const padHit = hitPad(board, world, activeLayer);
    let end: Vec2;
    let targetPad: PadHit | null = null;
    if (
      padHit &&
      padHit.netId === netId &&
      padHit.layer === activeLayer &&
      !samePoint(padHit.world, anchor)
    ) {
      end = padHit.world;
      targetPad = padHit;
    } else {
      end = snap(world);
    }

    const smartWorld = worldFor(board);
    const smartIntent: SmartRouteIntent = {
      schemaVersion: 1,
      netId,
      layer: activeLayer,
      start: anchor,
      end,
      movementPolicy: "keep-existing-copper-fixed",
      maxCandidates: 4,
    };
    const smartRules = resolveSmartRoutingRules(board, netId, activeLayer, {
      session: {
        trackWidthNm: trackWidth,
        clearanceNm: clearance,
        viaSizeNm: state.viaSize,
        viaDrillNm: state.viaDrill,
        gridNm: grid,
      },
    });
    const smartResult = routeSmart(smartWorld, smartIntent, smartRules);
    const preferredId = state.preview.selectedCandidateId;
    const selectedCandidate = smartResult.candidates.find((candidate) => candidate.id === preferredId)
      ?? smartResult.candidates.find((candidate) => candidate.id === smartResult.selectedCandidateId)
      ?? smartResult.candidates[0];
    if (selectedCandidate) {
      const points = selectedCandidate.points;
      const segments = buildSegmentsFromPoints(points, activeLayer, trackWidth, netId, false);
      const corner = points[1] ?? end;
      return {
        corner,
        end,
        points,
        segments,
        legal: true,
        targetPad,
        candidates: smartResult.candidates,
        selectedCandidate,
        smartResult,
        smartIntent,
        smartRules,
        smartWorld,
      };
    }

    // Keep the blocked direct posture visible. The independent engine has
    // already exhausted both direct postures and bounded CW/CCW walk-around.
    const rawCorner = fortyFiveCorner(anchor, end, preferHorizontalFirst);
    const corner = samePoint(rawCorner, end) ? end : snap(rawCorner);
    const points = samePoint(anchor, end)
      ? [anchor]
      : samePoint(corner, end)
        ? [anchor, end]
        : [anchor, corner, end];
    const segments = buildSegmentsFromPoints(points, activeLayer, trackWidth, netId, false);
    if (segments.length === 0) {
      return {
        corner,
        end,
        points,
        segments,
        legal: true,
        targetPad: null,
        candidates: [],
        smartResult,
        smartIntent,
        smartRules,
        smartWorld,
      };
    }
    const res = checkClearance(board, { candidateSegments: segments, netId, clearance });
    return {
      corner,
      end,
      points,
      segments,
      legal: res.legal,
      blockedBy: res.blockedBy,
      blockedByKeepoutId: res.blockedByKeepoutId,
      blockedText: res.legal ? undefined : describeBlock(board, netId, clearance, res),
      targetPad,
      candidates: [],
      smartResult,
      smartIntent,
      smartRules,
      smartWorld,
    };
  }

  function updateRoutingPreview(world: Vec2): void {
    if (state.kind !== "routing") return;
    lastMoveWorld = world;
    const r = resolveRouting(world);
    state.preview = {
      corner: r.corner,
      end: r.end,
      legal: r.legal,
      blockedBy: r.blockedBy,
      blockedByKeepoutId: r.blockedByKeepoutId,
      blockedText: r.blockedText,
      points: r.points,
      candidates: r.candidates,
      selectedCandidateId: r.selectedCandidate?.id,
      smartStatus: r.smartResult.status,
      smartExplanation: r.smartResult.explanation,
      searchElapsedMs: r.smartResult.diagnostics.elapsedMs,
    };
  }

  function startRouting(netId: number, activeLayer: LayerId, anchor: Vec2): void {
    const nc = netClassOf(netId);
    const profile = options.routingProfile?.(netId) ?? nc;
    const automaticPadstack = options.routingProfile ? undefined : classDefaultPadstack(getBoard(), netId);
    const profilePadstackId =
      "viaPadstackId" in profile && typeof profile.viaPadstackId === "string"
        ? profile.viaPadstackId
        : automaticPadstack?.id;
    const effective = resolveSmartRoutingRules(getBoard(), netId, activeLayer, {
      session: {
        trackWidthNm: profile.trackWidth,
        clearanceNm: profile.clearance,
        viaSizeNm: automaticPadstack?.outerNm ?? profile.viaSize,
        viaDrillNm: automaticPadstack?.drillNm ?? profile.viaDrill,
        gridNm: grid,
      },
    });
    state = {
      kind: "routing",
      netId,
      activeLayer,
      trackWidth: effective.trackWidthNm,
      clearance: effective.clearanceNm,
      viaSize: effective.viaSizeNm,
      viaDrill: effective.viaDrillNm,
      ...(profilePadstackId ? { viaPadstackId: profilePadstackId } : {}),
      anchor,
      preview: {
        corner: anchor,
        end: anchor,
        legal: true,
        points: [anchor],
        candidates: [],
        smartStatus: "ready",
        smartExplanation: "Move the pointer to preview a deterministic route.",
      },
      preferHorizontalFirst: true,
    };
    routeStack = [{ anchor, activeLayer }];
    lastMoveWorld = null;
  }

  function commitRouting(world: Vec2): void {
    if (state.kind !== "routing") return;
    const r = resolveRouting(world);
    if (!r.legal || !r.selectedCandidate || r.segments.length === 0) return; // cannot commit illegal / no-op
    const segments = buildSegmentsFromPoints(
      r.points,
      state.activeLayer,
      state.trackWidth,
      state.netId,
      true,
    );
    const transaction = stagePreviewCandidates(
      beginPreviewTransaction(r.smartWorld, r.smartIntent),
      r.smartResult.candidates,
      r.selectedCandidate.id,
    );
    const historyEvent = createRoutingHistoryEvent(
      transaction,
      r.selectedCandidate,
      r.smartRules,
      segments.map((segment) => segment.id),
    );
    applyCommand({
      kind: "CommitRouteSegment",
      segments,
      netId: state.netId,
      historyEvents: [historyEvent],
    });
    state.anchor = r.end;
    routeStack.push({ anchor: r.end, activeLayer: state.activeLayer });
    if (r.targetPad) {
      cancel(); // completed a connection to a same-net pad
      return;
    }
    state.preview = {
      corner: r.end,
      end: r.end,
      legal: true,
      points: [r.end],
      candidates: [],
      smartStatus: "ready",
      smartExplanation: "Segment committed atomically.",
    };
  }

  function placeVia(): void {
    if (state.kind !== "routing") return;
    const newLayer = flipCopperLayer(state.activeLayer);
    const via: Via = {
      id: freshId("rt-v"),
      at: { ...state.anchor },
      size: state.viaSize,
      drill: state.viaDrill,
      netId: state.netId,
      layers: [state.activeLayer, newLayer],
    };
    // Stage 17: the active net class's default padstack wins when the board
    // has a library (dims denormalized onto the via — see padstack/registry).
    const padstack = state.viaPadstackId ? getPadstack(getBoard(), state.viaPadstackId) : undefined;
    if (padstack) applyPadstackToVia(via, padstack);
    // Guard the via itself before committing (edge / other-net proximity).
    const res = checkClearance(getBoard(), {
      candidateSegments: [],
      candidateVias: [via],
      netId: state.netId,
      clearance: state.clearance,
    });
    if (!res.legal) return; // cannot drop an illegal via
    applyCommand({ kind: "PlaceViaAndFlipLayer", via, segments: [] });
    state.activeLayer = newLayer;
    routeStack.push({ anchor: state.anchor, activeLayer: newLayer });
    if (lastMoveWorld) updateRoutingPreview(lastMoveWorld);
  }

  function undoLastSegment(): void {
    if (state.kind !== "routing") return;
    if (routeStack.length <= 1) {
      cancel();
      return;
    }
    options.undo?.();
    routeStack.pop();
    const top = routeStack[routeStack.length - 1];
    state.anchor = top.anchor;
    state.activeLayer = top.activeLayer;
    if (lastMoveWorld) updateRoutingPreview(lastMoveWorld);
    else state.preview = { corner: top.anchor, end: top.anchor, legal: true };
  }

  // ── Stretch ─────────────────────────────────────────────────────────────────

  function enterStretching(world: Vec2): void {
    if (!pendingGrab) return;
    const board = getBoard();
    const grabbed = board.tracks.find((t) => t.id === pendingGrab!.trackId);
    if (!grabbed) {
      pendingGrab = null;
      return;
    }
    const grabPos = pendingGrab.grabbedEnd === "a" ? grabbed.start : grabbed.end;
    // Every SAME-NET track sharing the grabbed vertex moves rigidly with it (a
    // real junction is same-net; a coincident other-net track is a short, left
    // in place).
    const origins = board.tracks
      .filter(
        (t) => t.netId === grabbed.netId && (samePoint(t.start, grabPos) || samePoint(t.end, grabPos)),
      )
      .map((t) => ({ ...t, start: { ...t.start }, end: { ...t.end } }));
    const nc = netClassOf(grabbed.netId);
    stretch = {
      grabPos,
      movedIds: new Set(origins.map((t) => t.id)),
      origins,
      after: origins,
      netId: grabbed.netId,
      clearance: nc.clearance,
    };
    state = {
      kind: "stretching",
      trackId: pendingGrab.trackId,
      grabbedEnd: pendingGrab.grabbedEnd,
      segments: origins,
      preview: { end: grabPos, legal: true },
    };
    pendingGrab = null;
    updateStretchPreview(world);
  }

  function updateStretchPreview(world: Vec2): void {
    if (state.kind !== "stretching" || !stretch) return;
    lastMoveWorld = world;
    const end = snap(world);
    const after = stretch.origins.map((t) => {
      const next: Track = { ...t, start: { ...t.start }, end: { ...t.end } };
      if (samePoint(t.start, stretch!.grabPos)) next.start = end;
      if (samePoint(t.end, stretch!.grabPos)) next.end = end;
      return next;
    });
    stretch.after = after;
    state.segments = after;
    const res = checkClearance(getBoard(), {
      candidateSegments: after,
      ignoreItemIds: stretch.movedIds,
      netId: stretch.netId,
      clearance: stretch.clearance,
    });
    state.preview = {
      end,
      legal: res.legal,
      blockedBy: res.blockedBy,
      blockedText: res.legal ? undefined : describeBlock(getBoard(), stretch.netId, stretch.clearance, res),
    };
  }

  function finishStretch(world: Vec2): void {
    if (state.kind !== "stretching" || !stretch) {
      cancel();
      return;
    }
    updateStretchPreview(world);
    const moved = !samePoint(state.preview.end, stretch.grabPos);
    if (state.preview.legal && moved) {
      applyCommand({ kind: "StretchTrack", before: stretch.origins, after: stretch.after });
    }
    cancel();
  }

  // ── Public surface ───────────────────────────────────────────────────────────

  function cancel(): void {
    state = { kind: "idle" };
    pendingGrab = null;
    stretch = null;
    routeStack = [];
    lastMoveWorld = null;
  }

  return {
    get state(): RouteToolState {
      return state;
    },

    onPointerDown(world: Vec2): void {
      if (state.kind === "routing") {
        commitRouting(world);
        return;
      }
      if (state.kind === "stretching") return; // already dragging
      // idle: pad → route immediately; track → pending (stretch vs route).
      const board = getBoard();
      const padHit = hitPad(board, world, options.getActiveLayer?.());
      if (padHit) {
        const layer =
          padHit.pad.type === "thru_hole" ? options.getActiveLayer?.() ?? padHit.layer : padHit.layer;
        startRouting(padHit.netId, layer, padHit.world);
        updateRoutingPreview(world);
        return;
      }
      const trackHit = hitTrack(board, world);
      if (trackHit) {
        pendingGrab = { trackId: trackHit.track.id, grabbedEnd: trackHit.grabbedEnd, downWorld: world };
      }
    },

    onPointerMove(world: Vec2): void {
      if (state.kind === "routing") {
        updateRoutingPreview(world);
        return;
      }
      if (state.kind === "stretching") {
        updateStretchPreview(world);
        return;
      }
      if (pendingGrab && dist2(world, pendingGrab.downWorld) > STRETCH_DRAG_THRESHOLD ** 2) {
        enterStretching(world);
      }
    },

    onPointerUp(world: Vec2): void {
      if (state.kind === "stretching") {
        finishStretch(world);
        return;
      }
      if (pendingGrab) {
        // A click (no drag) on a track → start routing from that endpoint.
        const board = getBoard();
        const t = board.tracks.find((x) => x.id === pendingGrab!.trackId);
        if (t) {
          const anchor = pendingGrab.grabbedEnd === "a" ? t.start : t.end;
          startRouting(t.netId, t.layer, { ...anchor });
          updateRoutingPreview(world);
        }
        pendingGrab = null;
      }
    },

    onKey(key): void {
      switch (key) {
        case "V":
          placeVia();
          return;
        case "Escape":
        case "X":
          cancel();
          return;
        case "Backspace":
          undoLastSegment();
          return;
        case "Tab":
          if (state.kind === "routing") {
            state.preferHorizontalFirst = !state.preferHorizontalFirst;
            const routingState = state;
            const candidates = routingState.preview.candidates ?? [];
            if (candidates.length > 1) {
              const current = Math.max(0, candidates.findIndex((candidate) => candidate.id === routingState.preview.selectedCandidateId));
              const selected = candidates[(current + 1) % candidates.length];
              routingState.preview = {
                ...routingState.preview,
                corner: selected.points[1] ?? selected.points[0],
                end: selected.points[selected.points.length - 1],
                points: selected.points,
                selectedCandidateId: selected.id,
                legal: selected.validation.legal,
                blockedBy: undefined,
                blockedByKeepoutId: undefined,
                blockedText: undefined,
                smartExplanation: selected.explanation,
              };
            } else if (lastMoveWorld) {
              updateRoutingPreview(lastMoveWorld);
            }
          }
          return;
      }
    },

    cancel,

    ripupNetAt(world: Vec2): boolean {
      const board = getBoard();
      const hit = hitTrack(board, world);
      if (!hit || hit.track.netId === 0) return false;
      applyCommand(buildRipupNetCommand(board, hit.track.netId));
      cancel(); // always drop any in-flight gesture (incl. a pending track grab)
      return true;
    },

    snapshot(): RouteToolState {
      return structuredClone(state);
    },
  };
}
