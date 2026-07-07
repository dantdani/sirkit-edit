/**
 * Build-mode auto-layout.
 *
 * Converts a `BuildLogicalNetlist` (real catalog parts addressed by refDes/pin)
 * into a `SchematicState` using role-based zone placement:
 *
 *   signal connectors → inputs → processors → outputs / indicators (L→R)
 *   regulators, sources, and power connectors in the top-right
 *   support passives hug their parent IC; other passives sit between the
 *   components they bridge; one shared ground at the bottom center.
 *
 * Wires are routed orthogonally around component bounding boxes (`routeWire`).
 * Crossing another WIRE is allowed by design — crossings stay electrically
 * separate unless the user adds an explicit junction in the editor.
 */

import type {
  BuildLogicalNetlist,
  BuildLogicalComponent,
  BuildLogicalWireConnection,
  ComponentRole,
  SchematicState,
  KicadComponentInstance,
  NetLabel,
  NetLabelKind,
  Rotation,
  SchComponent,
  Wire,
  Point,
} from "./schematic-types";
import {
  normalizeComponentRole,
  isLabelConnection,
  inferNetLabelKind,
  DEFAULT_PAGE_SIZE,
} from "./schematic-types";
import { planPageFit, type Bounds } from "./page-sizes";
import type { CachedPart } from "@/app/lib/parts-cache";
import type { KicadPin } from "@/app/lib/kicad/types";
import type { Direction } from "@/app/lib/geometry";
import {
  snap, pointEquals, pointKey, pointStrictlyOnWireInterior,
  kicadPinWorldPos, KICAD_SCALE_PX_PER_MM, rotateXY,
  pinDirection, pinStubEnd, kicadPinExitDirection,
} from "@/app/lib/geometry";
import { consolidateWires, splitWiresAtPoint } from "@/app/lib/connectivity";
import {
  parseSExp, isList, head, findChild, findChildren, getNumber, type SExpr,
} from "@/app/lib/kicad/sexp";
import {
  validateSchematicNetlist,
  rerouteToLabels,
  type NetlistValidation,
} from "./validate-netlist";

// ─── Layout constants ─────────────────────────────────────────────────────────

const COL_W = 200;          // nominal column width (passive offsets, edge columns)
const ROW_H = 160;          // minimum vertical spacing within a zone stack
const PADDING = 80;         // edge padding
const ORIGIN_X = 600;       // center (processor) column x
const CENTER_Y = 460;       // vertical center of the main zones
const TOP_Y = PADDING + 80; // first row of the "near top" zones
const SUPPORT_GAP = 40;     // support passives sit this far off their parent
const GND_DROP = 120;       // how far below the lowest component the ground sits

const ZONE_X = {
  inputs: ORIGIN_X - 360,
  processors: ORIGIN_X,
  outputs: ORIGIN_X + 360,
  indicators: ORIGIN_X + 360,
  regulators: ORIGIN_X + 540,
  sources: ORIGIN_X + 720,
  signalConnectors: Math.max(PADDING, ORIGIN_X - 360 - COL_W),
  powerConnectors: ORIGIN_X + 720,
} as const;

// ─── Wire routing (Part B) ────────────────────────────────────────────────────

export type Bbox = { x: number; y: number; width: number; height: number };

const MIN_OBSTACLE_DIM = 24;  // degenerate spans (2-pin passives) still block
const ROUTE_CLEARANCE = 20;   // detour lines sit this far off an obstacle edge

function bboxContains(b: Bbox, p: Point): boolean {
  return p.x > b.x && p.x < b.x + b.width && p.y > b.y && p.y < b.y + b.height;
}

// Axis-aligned segment vs box, strict-interior overlap: a segment that merely
// touches a box edge (a wire leaving a pin on the boundary) does not collide.
function segHitsBbox(a: Point, b: Point, box: Bbox): boolean {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  return x2 > box.x && x1 < box.x + box.width && y2 > box.y && y1 < box.y + box.height;
}

function pathViolations(verts: Point[], obstacles: Bbox[]): number {
  let n = 0;
  for (let i = 0; i < verts.length - 1; i++) {
    for (const box of obstacles) {
      if (segHitsBbox(verts[i], verts[i + 1], box)) n++;
    }
  }
  return n;
}

function dedupeVerts(verts: Point[]): Point[] {
  const out: Point[] = [];
  for (const v of verts) {
    if (out.length === 0 || !pointEquals(out[out.length - 1], v)) out.push(v);
  }
  return out;
}

// Candidate detour coordinates: the midpoint between the endpoints plus a line
// just past each obstacle edge, nearest-to-midpoint first so gentle detours win.
function detourCandidates(a: number, b: number, edges: number[]): number[] {
  const mid = (a + b) / 2;
  const cands = new Set<number>([snap(mid)]);
  for (const e of edges) cands.add(snap(e));
  return [...cands].sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
}

export type RouteResult = {
  verts: Point[];
  /** Component boxes the path crosses. 0 means a clean route. */
  crossings: number;
};

/**
 * Orthogonal route from `from` to `to` avoiding component bounding boxes.
 * Tries direct → L-bends → Z-bends, then falls back to the least-bad L-bend
 * (reported via `crossings`, so callers can choose a label-pair instead).
 * Obstacles are COMPONENTS only — wires may cross other wires freely.
 */
export function routeWireInfo(from: Point, to: Point, obstacleBboxes: Bbox[]): RouteResult {
  if (pointEquals(from, to)) return { verts: [from], crossings: 0 };
  // A box that already contains an endpoint can never be avoided (the wire has
  // to reach into it), so drop it rather than letting it veto every candidate.
  const obstacles = obstacleBboxes.filter(
    (b) => !bboxContains(b, from) && !bboxContains(b, to),
  );
  const clear = (verts: Point[]) => pathViolations(verts, obstacles) === 0;

  // 1. Direct, when colinear.
  const colinear = from.x === to.x || from.y === to.y;
  if (colinear) {
    if (clear([from, to])) return { verts: [from, to], crossings: 0 };
  } else {
    // 2. L-bends — horizontal-first preferred.
    const l1 = [from, { x: to.x, y: from.y }, to];
    const l2 = [from, { x: from.x, y: to.y }, to];
    if (clear(l1)) return { verts: l1, crossings: 0 };
    if (clear(l2)) return { verts: l2, crossings: 0 };
  }

  // 3. Z-bends — detour along a horizontal line y_mid (vertical-horizontal-
  //    vertical) or a vertical line x_mid (horizontal-vertical-horizontal).
  const yEdges = obstacles.flatMap((b) => [b.y - ROUTE_CLEARANCE, b.y + b.height + ROUTE_CLEARANCE]);
  for (const yMid of detourCandidates(from.y, to.y, yEdges)) {
    const z = dedupeVerts([from, { x: from.x, y: yMid }, { x: to.x, y: yMid }, to]);
    if (z.length >= 2 && clear(z)) return { verts: z, crossings: 0 };
  }
  const xEdges = obstacles.flatMap((b) => [b.x - ROUTE_CLEARANCE, b.x + b.width + ROUTE_CLEARANCE]);
  for (const xMid of detourCandidates(from.x, to.x, xEdges)) {
    const z = dedupeVerts([from, { x: xMid, y: from.y }, { x: xMid, y: to.y }, to]);
    if (z.length >= 2 && clear(z)) return { verts: z, crossings: 0 };
  }

  // 4. Cornered — return the least-bad option and report the overlap.
  const fallbacks: Point[][] = colinear
    ? [[from, to]]
    : [
        [from, { x: to.x, y: from.y }, to],
        [from, { x: from.x, y: to.y }, to],
      ];
  let best = fallbacks[0];
  let bestN = pathViolations(best, obstacles);
  for (const f of fallbacks.slice(1)) {
    const n = pathViolations(f, obstacles);
    if (n < bestN) { best = f; bestN = n; }
  }
  return { verts: best, crossings: bestN };
}

/** Back-compat wrapper: route and accept the least-bad path, warning on overlap. */
export function routeWire(from: Point, to: Point, obstacleBboxes: Bbox[]): Point[] {
  const { verts, crossings } = routeWireInfo(from, to, obstacleBboxes);
  if (crossings > 0) {
    console.warn(
      `[build-auto-layout] routeWire cornered: (${from.x},${from.y})→(${to.x},${to.y}) crosses ${crossings} component box(es)`,
    );
  }
  return verts;
}

// ─── Pin-escape routing ───────────────────────────────────────────────────────
//
// A pin plus the direction a wire should leave it. Routing between endpoints
// (rather than bare points) lets every wire escape STUB_LENGTH px straight out
// of each pin before bending, so it never clips the component's own neighbouring
// pins on the way out.
export type WireEndpoint = { position: Point; exitDirection: Direction };

/**
 * Like `routeWireInfo`, but forces a perpendicular stub out of each pin: the
 * wire leaves `from` in its exit direction, runs the orthogonal route between
 * the two stub ends (obstacle-avoiding, so a "destination behind the pin" U-turn
 * detours cleanly around the body instead of cutting back across the pins), then
 * approaches `to` head-on along its exit axis. Crossings are re-tallied over the
 * FULL path (stubs included) so callers still get an honest count for fallback.
 */
export function routeWireEndpoints(
  from: WireEndpoint,
  to: WireEndpoint,
  obstacleBboxes: Bbox[],
): RouteResult {
  if (pointEquals(from.position, to.position)) {
    return { verts: [from.position], crossings: 0 };
  }
  const fromStub = pinStubEnd(from.position, from.exitDirection);
  const toStub = pinStubEnd(to.position, to.exitDirection);
  const mid = routeWireInfo(fromStub, toStub, obstacleBboxes);
  const verts = dedupeVerts([from.position, fromStub, ...mid.verts, toStub, to.position]);
  // The stubs leave each pin OUTWARD (never into the owning box), so re-tally
  // crossings over the whole path against every box that doesn't contain a pin.
  const obstacles = obstacleBboxes.filter(
    (b) => !bboxContains(b, from.position) && !bboxContains(b, to.position),
  );
  return { verts, crossings: pathViolations(verts, obstacles) };
}

// ─── Wire congestion: parallel-run detection ─────────────────────────────────

const PARALLEL_NEAR_DIST = 10;   // lateral distance (px) that counts as "parallel to"
const PARALLEL_MAX_OVERLAP = 60; // longest tolerated parallel run (px)

// Longest stretch (px) where the candidate path runs parallel to (within
// PARALLEL_NEAR_DIST of) an already-routed wire segment. Long shared runs read
// as tangles even when nothing technically overlaps.
function longestParallelRun(verts: Point[], existing: Wire[]): number {
  let worst = 0;
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i];
    const b = verts[i + 1];
    const horizontal = a.y === b.y;
    if (!horizontal && a.x !== b.x) continue; // non-orthogonal — shouldn't happen
    for (const w of existing) {
      for (let j = 0; j < w.vertices.length - 1; j++) {
        const c = w.vertices[j];
        const d = w.vertices[j + 1];
        if (horizontal && c.y === d.y && Math.abs(c.y - a.y) <= PARALLEL_NEAR_DIST) {
          const lo = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
          const hi = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
          worst = Math.max(worst, hi - lo);
        } else if (!horizontal && c.x === d.x && Math.abs(c.x - a.x) <= PARALLEL_NEAR_DIST) {
          const lo = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
          const hi = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
          worst = Math.max(worst, hi - lo);
        }
      }
    }
  }
  return worst;
}

// ─── Generated net names ──────────────────────────────────────────────────────

const NET_NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// Deterministic 4-char suffix from an FNV-1a hash of the connection endpoints:
// the same netlist always generates the same fallback names.
function netNameSuffix(key: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let out = "";
  for (let k = 0; k < 4; k++) {
    out = NET_NAME_CHARS[h % NET_NAME_CHARS.length] + out;
    h = Math.floor(h / NET_NAME_CHARS.length);
  }
  return out;
}

// ─── Categorization helpers ──────────────────────────────────────────────────

function isPowerConnector(part: CachedPart | undefined, value: string): boolean {
  const hay = `${value} ${part?.name ?? ""} ${part?.description ?? ""}`.toLowerCase();
  return /usb|barrel|jack|power|dc[-\s]?in|vbus|battery/.test(hay);
}

// ─── Pin resolution ───────────────────────────────────────────────────────────

function findPin(part: CachedPart, token: string): KicadPin | undefined {
  const target = token.trim().toLowerCase();
  return part.pins.find(
    (p) => p.name.toLowerCase() === target || p.number.toLowerCase() === target,
  );
}

type Endpoint = { ground: true } | { refDes: string; pin: string };

function parseEndpoint(ep: string): Endpoint {
  const trimmed = ep.trim();
  if (trimmed.toUpperCase() === "GND") return { ground: true };
  const idx = trimmed.indexOf(".");
  if (idx < 0) return { refDes: trimmed, pin: "" };
  return { refDes: trimmed.slice(0, idx), pin: trimmed.slice(idx + 1) };
}

// ─── Placement ────────────────────────────────────────────────────────────────

type Sized = {
  comp: BuildLogicalComponent;
  part: CachedPart | undefined;
  role: ComponentRole;
  width: number;
  height: number;
  instance: KicadComponentInstance;
  placed: boolean;
  /**
   * Extra courtyard clearance (px) for the body de-overlap pass. Default 0. The
   * layout critic (vision pass) sets this on components a rendered view shows as
   * too crowded, so `resolveComponentCollisions` spreads them further apart than
   * the uniform SYMBOL_CLEARANCE — without ever emitting coordinates itself.
   */
  spread?: number;
};

// Footprint used for zone spacing (and as the obstacle box when a part has no
// usable pin geometry). Real pin extents win when available — pin-count
// formulas grossly undersize big symbols (a 49-pin ESP32-PICO is ~616px tall),
// which would let the ground/zone math place things inside the body.
function estimateSize(part: CachedPart | undefined, role: ComponentRole): { w: number; h: number } {
  if (part && part.pins.length >= 2) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pin of part.pins) {
      const x = pin.position.x * KICAD_SCALE_PX_PER_MM;
      const y = pin.position.y * KICAD_SCALE_PX_PER_MM;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    if (Number.isFinite(minX)) {
      return { w: Math.max(60, maxX - minX), h: Math.max(40, maxY - minY) };
    }
  }
  if (role === "support") return { w: 60, h: 40 };
  const pinCount = part?.pins.length ?? 2;
  return {
    w: Math.max(120, pinCount * 8),
    h: Math.max(80, Math.ceil(pinCount / 2) * 12),
  };
}

// Vertical gap between two stacked components: at least ROW_H, more when the
// estimated bodies wouldn't fit.
function stackGap(a: Sized, b: Sized): number {
  return Math.max(ROW_H, (a.height + b.height) / 2 + 40);
}

// Stack a zone's components vertically at x, centered on centerY.
function stackZone(list: Sized[], x: number, centerY: number): void {
  if (list.length === 0) return;
  const gaps: number[] = [];
  for (let i = 1; i < list.length; i++) gaps.push(stackGap(list[i - 1], list[i]));
  const total = gaps.reduce((a, b) => a + b, 0);
  let y = centerY - total / 2;
  list.forEach((p, i) => {
    if (i > 0) y += gaps[i - 1];
    p.instance.x = snap(x);
    p.instance.y = snap(y);
    p.placed = true;
  });
}

// Stack a zone's components vertically at x, growing downward from topY.
function stackZoneFromTop(list: Sized[], x: number, topY: number): void {
  let y = topY;
  list.forEach((p, i) => {
    if (i > 0) y += stackGap(list[i - 1], list[i]);
    p.instance.x = snap(x);
    p.instance.y = snap(y);
    p.placed = true;
  });
}

function zoneBottom(list: Sized[]): number | null {
  let bottom = -Infinity;
  for (const p of list) {
    if (p.placed) bottom = Math.max(bottom, p.instance.y + p.height / 2);
  }
  return Number.isFinite(bottom) ? bottom : null;
}

// ─── Accurate component body boxes ────────────────────────────────────────────
//
// Routing obstacles and collision spacing both need a box that reflects where a
// component actually SITS on the sheet. Pin-tip extents alone fall short: a part
// whose pins are all on one side (connectors, switches, single-row headers) has
// its body extending AWAY from the pins, so the pin-tip box collapses to a thin
// sliver at the pin column — and wires route straight through the unrepresented
// body. We fix this by also reading the symbol's drawn body from `symbolRaw` and
// unioning it with the pin extents.

type BodyMm = { minX: number; minY: number; maxX: number; maxY: number };

// Symbol-space (millimetre, y-up) bounding box of a part's GRAPHIC body —
// rectangles/polylines/circles/arcs, excluding pins and text. Cached per part;
// a malformed or graphic-less symbol yields null (caller falls back to pins).
const symbolBodyCache = new WeakMap<CachedPart, BodyMm | null>();

function symbolBodyMm(part: CachedPart): BodyMm | null {
  const cached = symbolBodyCache.get(part);
  if (cached !== undefined) return cached;
  let body: BodyMm | null = null;
  const raw = part.symbolRaw?.trim();
  if (raw) {
    try {
      const pts: Array<[number, number]> = [];
      collectGraphicPoints(parseSExp(raw), pts);
      if (pts.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of pts) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
        body = { minX, minY, maxX, maxY };
      }
    } catch {
      body = null; // unparseable symbol → pin-extent fallback
    }
  }
  symbolBodyCache.set(part, body);
  return body;
}

// Walk the symbol tree collecting body-graphic coordinates. `pin`/text tags are
// skipped so pin stubs and label text don't inflate the box.
function collectGraphicPoints(node: SExpr, out: Array<[number, number]>): void {
  if (!isList(node)) return;
  const tag = head(node);
  if (
    tag === "pin" || tag === "property" || tag === "text" ||
    tag === "pin_names" || tag === "pin_numbers"
  ) return;
  const xy = (child: SExpr[] | null): void => {
    if (!child) return;
    const x = getNumber(child[1]);
    const y = getNumber(child[2]);
    if (x !== null && y !== null) out.push([x, y]);
  };
  switch (tag) {
    case "rectangle":
      xy(findChild(node, "start"));
      xy(findChild(node, "end"));
      return;
    case "polyline":
    case "polygon":
    case "bezier": {
      const pts = findChild(node, "pts");
      if (pts) for (const p of findChildren(pts, "xy")) xy(p);
      return;
    }
    case "arc":
      xy(findChild(node, "start"));
      xy(findChild(node, "mid"));
      xy(findChild(node, "end"));
      return;
    case "circle": {
      const c = findChild(node, "center");
      const r = getNumber(findChild(node, "radius")?.[1]) ?? 0;
      if (c) {
        const x = getNumber(c[1]);
        const y = getNumber(c[2]);
        if (x !== null && y !== null) out.push([x - r, y - r], [x + r, y + r]);
      }
      return;
    }
    default:
      for (const child of node) collectGraphicPoints(child, out);
  }
}

// When a symbol carries no readable body graphics, estimate the body by padding
// the pin extents this far on each side — enough that a one-sided part (pins all
// on one edge) doesn't collapse to a sliver the router would thread straight
// through. Real catalog symbols carry graphics; this is the malformed/missing
// path.
const BODY_FALLBACK_PAD = 30;

// World-space box covering a placed component's pins AND its drawn body. The one
// source of truth for "where the component is"; obstacleFor and footprintBox
// layer their own margins on top.
export function componentBodyBox(instance: KicadComponentInstance, part: CachedPart): Bbox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const pin of part.pins) {
    const w = kicadPinWorldPos(instance, pin);
    grow(w.x, w.y);
  }
  const body = symbolBodyMm(part);
  if (body) {
    // Transform the four body corners from symbol mm-space to world px, matching
    // kicadPinWorldPos (scale, KiCad y-flip, instance rotation, translate).
    const corners: Array<[number, number]> = [
      [body.minX, body.minY], [body.maxX, body.minY],
      [body.maxX, body.maxY], [body.minX, body.maxY],
    ];
    for (const [xmm, ymm] of corners) {
      const r = rotateXY(xmm * KICAD_SCALE_PX_PER_MM, -ymm * KICAD_SCALE_PX_PER_MM, instance.rotation);
      grow(instance.x + r.x, instance.y + r.y);
    }
  }
  if (!Number.isFinite(minX)) {
    const s = BODY_FALLBACK_PAD;
    return { x: instance.x - s, y: instance.y - s, width: 2 * s, height: 2 * s };
  }
  if (!body) {
    // No drawn body to read: pad the pin extents so a one-sided part still gets a
    // body-sized box rather than a pin-column sliver.
    minX -= BODY_FALLBACK_PAD; minY -= BODY_FALLBACK_PAD;
    maxX += BODY_FALLBACK_PAD; maxY += BODY_FALLBACK_PAD;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Obstacle box for wire routing: the pin+body extent, clamped to a minimum
// thickness so a thin part (a 2-pin passive seen edge-on) still blocks crossings.
function obstacleFor(p: Sized): Bbox {
  if (p.part && p.part.pins.length >= 1) {
    let { x, y, width, height } = componentBodyBox(p.instance, p.part);
    if (width < MIN_OBSTACLE_DIM)  { x = x + width / 2 - MIN_OBSTACLE_DIM / 2;  width = MIN_OBSTACLE_DIM; }
    if (height < MIN_OBSTACLE_DIM) { y = y + height / 2 - MIN_OBSTACLE_DIM / 2; height = MIN_OBSTACLE_DIM; }
    return { x, y, width, height };
  }
  return {
    x: p.instance.x - p.width / 2,
    y: p.instance.y - p.height / 2,
    width: p.width,
    height: p.height,
  };
}

// ─── Placement validation: non-overlapping component bodies ───────────────────
//
// A PCB placement rule — "no component footprint may overlap another's body /
// courtyard / keepout" — adapted to the layer this generator actually produces:
// a SCHEMATIC, not a board. There are no real footprints, courtyards, PCB sides,
// or silkscreen/assembly clearances in this codebase; the schematic analog of a
// courtyard is the symbol's full pin-extent box expanded by a clearance margin
// (which folds the rule's separate silkscreen/assembly/courtyard clearances into
// one symbol clearance). The opposite-PCB-side / footprint-metadata exemptions
// don't apply — everything is one logical sheet.
//
// After placement we check every component pair and slide the more-movable one
// (smaller / passive before larger / processor-connector-source) out of the
// other's occupied area until no two boxes intersect. Electrical nets are
// preserved for free: wires and labels are routed AFTER this pass, from the
// final pin positions — moving a symbol just moves where its nets attach.

const SYMBOL_CLEARANCE = 30; // px around a symbol's extent (courtyard analog)
const RESOLVE_MARGIN = 10;   // extra grid step when pushing apart (snap safety)

// Higher rank = more of an anchor; the lower-ranked partner in a collision moves.
const ANCHOR_RANK: Record<ComponentRole, number> = {
  processor: 5, connector: 5, source: 5, regulator: 4,
  input: 3, output: 3, indicator: 2, passive: 1, support: 1,
};

// Full symbol extent (pins + drawn body) expanded by `clearance` on every side:
// the schematic stand-in for a footprint courtyard. Shares the body-aware box
// with routing, so one-sided parts (connectors) are spaced by their real size
// rather than a pin-column sliver.
export function footprintBox(p: Sized, clearance = SYMBOL_CLEARANCE): Bbox {
  const base = (p.part && p.part.pins.length >= 1)
    ? componentBodyBox(p.instance, p.part)
    : { x: p.instance.x - p.width / 2, y: p.instance.y - p.height / 2, width: p.width, height: p.height };
  return {
    x: base.x - clearance,
    y: base.y - clearance,
    width: base.width + 2 * clearance,
    height: base.height + 2 * clearance,
  };
}

function bboxesIntersect(a: Bbox, b: Bbox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// Of a colliding pair, which one moves: more-movable role first, then the
// smaller body, then higher refDes (purely for determinism). The other stays.
function moverOf(a: Sized, b: Sized): Sized {
  const ra = ANCHOR_RANK[a.role];
  const rb = ANCHOR_RANK[b.role];
  if (ra !== rb) return ra < rb ? a : b;
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  if (areaA !== areaB) return areaA < areaB ? a : b;
  return a.comp.refDes > b.comp.refDes ? a : b;
}

// Courtyard box for the de-overlap pass: the uniform symbol clearance plus any
// per-component `spread` the layout critic requested. Keeping `spread` here (and
// out of the page-fit/obstacle boxes) means extra breathing room only affects
// how far components are pushed apart, never net geometry or routing.
function collisionBox(p: Sized): Bbox {
  return footprintBox(p, SYMBOL_CLEARANCE + (p.spread ?? 0));
}

// Slide `mover` just clear of `other` along the axis of least overlap.
function nudgeApart(mover: Sized, other: Sized): void {
  const m = collisionBox(mover);
  const o = collisionBox(other);
  const overlapX = Math.min(m.x + m.width, o.x + o.width) - Math.max(m.x, o.x);
  const overlapY = Math.min(m.y + m.height, o.y + o.height) - Math.max(m.y, o.y);
  const mCx = m.x + m.width / 2, mCy = m.y + m.height / 2;
  const oCx = o.x + o.width / 2, oCy = o.y + o.height / 2;
  if (overlapX <= overlapY) {
    const dir = mCx >= oCx ? 1 : -1;
    mover.instance.x = snap(mover.instance.x + dir * (overlapX + RESOLVE_MARGIN));
  } else {
    const dir = mCy >= oCy ? 1 : -1;
    mover.instance.y = snap(mover.instance.y + dir * (overlapY + RESOLVE_MARGIN));
  }
}

// Iteratively separate overlapping component bodies/courtyards. Returns the
// number of pairs still overlapping after the pass budget (0 = fully clean).
export function resolveComponentCollisions(items: Sized[]): number {
  const maxPasses = items.length * 8 + 16;
  for (let pass = 0; pass < maxPasses; pass++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (!bboxesIntersect(collisionBox(items[i]), collisionBox(items[j]))) continue;
        const mover = moverOf(items[i], items[j]);
        nudgeApart(mover, mover === items[i] ? items[j] : items[i]);
        moved = true;
      }
    }
    if (!moved) return 0;
  }
  let remaining = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (bboxesIntersect(collisionBox(items[i]), collisionBox(items[j]))) remaining++;
    }
  }
  return remaining;
}

// ─── Pin-coincidence guard ────────────────────────────────────────────────────
//
// Body de-overlap (above) can still leave two DIFFERENT components with a PIN on
// the exact same grid point — which buildNetUnionFind reads as one node,
// silently SHORTING the two nets (the `unintended-merge` failures). This pass
// nudges the more-movable owner until no pin coordinate is shared by more than
// one component. Electrical correctness wins over perfect body spacing, so it
// runs AFTER resolveComponentCollisions and before wire routing (which reads the
// final pin positions, so nets are preserved).

const PIN_NUDGE = 20; // grid-aligned push per step (~one KiCad pin pitch)

function instancePinPoints(p: Sized): Point[] {
  if (!p.part) return [];
  return p.part.pins.map((pin) => kicadPinWorldPos(p.instance, pin));
}

/** Owner index set per pin coordinate. */
function pinOwners(items: Sized[]): Map<string, Set<number>> {
  const owners = new Map<string, Set<number>>();
  items.forEach((it, idx) => {
    for (const pt of instancePinPoints(it)) {
      const k = `${pt.x},${pt.y}`;
      const set = owners.get(k);
      if (set) set.add(idx);
      else owners.set(k, new Set([idx]));
    }
  });
  return owners;
}

/** Push `mover` a grid step away from `other` (snapped) so their pins separate. */
function pushPinsApart(mover: Sized, other: Sized): void {
  const m = obstacleFor(mover);
  const o = obstacleFor(other);
  let dx = m.x + m.width / 2 - (o.x + o.width / 2);
  const dy = m.y + m.height / 2 - (o.y + o.height / 2);
  if (dx === 0 && dy === 0) dx = 1;
  if (Math.abs(dx) >= Math.abs(dy)) {
    mover.instance.x = snap(mover.instance.x + (dx >= 0 ? PIN_NUDGE : -PIN_NUDGE));
  } else {
    mover.instance.y = snap(mover.instance.y + (dy >= 0 ? PIN_NUDGE : -PIN_NUDGE));
  }
}

export function resolvePinCoincidences(items: Sized[]): number {
  const maxPasses = items.length * 8 + 16;
  for (let pass = 0; pass < maxPasses; pass++) {
    const owners = pinOwners(items);
    const movedThisPass = new Set<number>();
    for (const set of owners.values()) {
      if (set.size < 2) continue;
      const idxs = [...set];
      // Mover = the most-movable owner (passive before processor); push it off.
      let moverIdx = idxs[0];
      for (const i of idxs) {
        if (ANCHOR_RANK[items[i].role] < ANCHOR_RANK[items[moverIdx].role]) moverIdx = i;
      }
      if (movedThisPass.has(moverIdx)) continue;
      const otherIdx = idxs.find((i) => i !== moverIdx) ?? moverIdx;
      pushPinsApart(items[moverIdx], items[otherIdx]);
      movedThisPass.add(moverIdx);
    }
    if (movedThisPass.size === 0) return 0;
  }
  let residual = 0;
  for (const set of pinOwners(items).values()) if (set.size >= 2) residual++;
  return residual;
}

// ─── Respacing regression guard (layout critic) ──────────────────────────────
//
// The layout critic re-runs the WHOLE layout with extra clearance on crowded
// components — which reshuffles every component, not just the flagged ones. These
// helpers let the caller confirm the re-layout actually helped the flagged parts
// WITHOUT pushing any previously-comfortable part into a tight spot ("moving the
// problem elsewhere"). The metric is each component's nearest-neighbour gap (the
// true edge-to-edge distance to its closest neighbour).

// "Comfortable" spacing: a fully-resolved layout separates inflated courtyards,
// so any non-overlapping pair sits ≥ 2× the per-side clearance apart. A
// non-flagged component that was at/above this but drops below it has been
// crowded by the respacing.
export const DEFAULT_COMFORT_GAP = 2 * SYMBOL_CLEARANCE;

// Minimum edge-to-edge distance between two axis-aligned boxes (0 if they
// overlap). Separation on each axis is 0 unless the boxes are disjoint there.
function rectGap(a: Bbox, b: Bbox): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
}

/** refDes → distance to its nearest neighbour (body box). Lone parts → Infinity. */
export function nearestNeighborGaps(
  instances: KicadComponentInstance[],
  parts: Map<string, CachedPart>,
): Map<string, number> {
  const boxes: Array<{ refDes: string; box: Bbox }> = [];
  for (const inst of instances) {
    const part = parts.get(inst.partId);
    if (part) boxes.push({ refDes: inst.refDes, box: componentBodyBox(inst, part) });
  }
  const gaps = new Map<string, number>();
  for (let i = 0; i < boxes.length; i++) {
    let min = Infinity;
    for (let j = 0; j < boxes.length; j++) {
      if (i === j) continue;
      const g = rectGap(boxes[i].box, boxes[j].box);
      if (g < min) min = g;
    }
    gaps.set(boxes[i].refDes, min);
  }
  return gaps;
}

/**
 * Compare nearest-neighbour spacing before vs after a respacing.
 *  - `improved`: the flagged components, in aggregate, gained breathing room.
 *  - `regressed`: NON-flagged components that were comfortable (≥ `comfort`)
 *    before but are now below it — i.e. the respacing crowded them.
 * The caller applies the new layout only when `improved && regressed.length === 0`.
 */
export function evaluateRespacing(
  before: Map<string, number>,
  after: Map<string, number>,
  flagged: Iterable<string>,
  comfort: number = DEFAULT_COMFORT_GAP,
): { improved: boolean; regressed: string[] } {
  const flaggedSet = new Set(flagged);
  let flaggedBefore = 0;
  let flaggedAfter = 0;
  let flaggedSeen = 0;
  for (const r of flaggedSet) {
    const b = before.get(r);
    const a = after.get(r);
    if (b === undefined || a === undefined) continue;
    flaggedBefore += b;
    flaggedAfter += a;
    flaggedSeen++;
  }
  const improved = flaggedSeen > 0 && flaggedAfter > flaggedBefore;

  const regressed: string[] = [];
  for (const [r, a] of after) {
    if (flaggedSet.has(r)) continue;
    const b = before.get(r);
    if (b === undefined) continue;
    if (b >= comfort && a < comfort) regressed.push(r);
  }
  regressed.sort();
  return { improved, regressed };
}

// ─── Net-label placement helpers ─────────────────────────────────────────────

// Which way a pin "exits" its component: the dominant axis from the body
// center to the pin's world position. Robust to instance rotation and the
// KiCad y-flip because it works purely on world coordinates.
function pinExitDirection(owner: Sized, pinPoint: Point): Direction {
  const box = obstacleFor(owner);
  const dx = pinPoint.x - (box.x + box.width / 2);
  const dy = pinPoint.y - (box.y + box.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

// Each glyph has a natural direction it extends from its anchor: power flags
// point up, ground symbols hang down, generic flags extend east. The stored
// orientation is the clockwise rotation that aligns the glyph with the pin's
// exit direction.
const DIRECTION_ANGLE: Record<Direction, number> = {
  north: 0, east: 90, south: 180, west: 270,
};

const NATURAL_LABEL_DIRECTION: Record<NetLabelKind, Direction> = {
  power: "north",
  ground: "south",
  label: "east",
};

function labelOrientation(kind: NetLabelKind, exit: Direction): Rotation {
  const delta = DIRECTION_ANGLE[exit] - DIRECTION_ANGLE[NATURAL_LABEL_DIRECTION[kind]];
  return (((delta % 360) + 360) % 360) as Rotation;
}

// Inverse of labelOrientation: the world direction a placed label's glyph
// extends (== its pin's exit direction).
const DIRECTION_ORDER: Direction[] = ["north", "east", "south", "west"];

function labelExitDirection(label: NetLabel): Direction {
  const angle = (DIRECTION_ANGLE[NATURAL_LABEL_DIRECTION[label.kind]] + label.orientation) % 360;
  return DIRECTION_ORDER[angle / 90];
}

// ─── Label staggering ─────────────────────────────────────────────────────────
//
// Labels on adjacent pins of the same edge (the classic +3V3 stack over an
// MCU's VDD row) crowd each other now that glyphs and text are large. Labels
// can't shrink, so alternate members of each crowded run move STAGGER_OFFSET
// further out along their exit direction, tied back to the pin by a short wire
// stub. The label anchor then sits exactly on the stub's far vertex, so the
// exact-position net binding (connectivity + validation) is preserved.

const STAGGER_OFFSET = 20;    // px further from the pin (2 grid steps)
const STAGGER_NEAR = 30;      // primary-axis gap that counts as crowded
const STAGGER_EDGE_TOL = 60;  // secondary-axis gap that still reads as one edge

const DIRECTION_VECTOR: Record<Direction, Point> = {
  north: { x: 0, y: -1 },
  east:  { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west:  { x: -1, y: 0 },
};

// Does any existing wire vertex sit strictly inside the (axis-aligned)
// pin→anchor stub? Splitting/exporting would weld the label's net onto that
// vertex's net, so such a stub must not be created.
function stubSwallowsVertex(pin: Point, moved: Point, wires: Wire[]): boolean {
  const vertical = pin.x === moved.x;
  const lo = vertical ? Math.min(pin.y, moved.y) : Math.min(pin.x, moved.x);
  const hi = vertical ? Math.max(pin.y, moved.y) : Math.max(pin.x, moved.x);
  for (const w of wires) {
    for (const v of w.vertices) {
      if (vertical) {
        if (v.x === pin.x && v.y > lo && v.y < hi) return true;
      } else {
        if (v.y === pin.y && v.x > lo && v.x < hi) return true;
      }
    }
  }
  return false;
}

// Chain-cluster a sorted coordinate list: consecutive labels within `tol` of
// each other share a cluster.
function chainClusters(labels: NetLabel[], coord: (l: NetLabel) => number, tol: number): NetLabel[][] {
  const sorted = [...labels].sort((a, b) => coord(a) - coord(b));
  const clusters: NetLabel[][] = [];
  for (const l of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && coord(l) - coord(last[last.length - 1]) <= tol) last.push(l);
    else clusters.push([l]);
  }
  return clusters;
}

/**
 * Stagger crowded label runs in place, appending a pin→anchor wire stub for
 * every label moved. `occupied` (pointKey set of live geometry: pins, wire
 * vertices, label anchors) guards against parking an anchor on top of another
 * net, which would short it.
 */
function staggerCrowdedLabels(netLabels: NetLabel[], wires: Wire[], occupied: Set<string>): void {
  const byDirection = new Map<Direction, NetLabel[]>();
  for (const l of netLabels) {
    const dir = labelExitDirection(l);
    byDirection.set(dir, [...(byDirection.get(dir) ?? []), l]);
  }
  for (const [dir, group] of byDirection) {
    const vertical = dir === "north" || dir === "south";
    const primary = (l: NetLabel) => (vertical ? l.position.x : l.position.y);
    const secondary = (l: NetLabel) => (vertical ? l.position.y : l.position.x);
    // Split into edges (rows/columns) first, then find crowded runs along each.
    for (const edge of chainClusters(group, secondary, STAGGER_EDGE_TOL)) {
      for (const run of chainClusters(edge, primary, STAGGER_NEAR)) {
        // Even members keep their natural anchor; odd members move out.
        for (let i = 1; i < run.length; i += 2) {
          const label = run[i];
          const pin = label.position;
          const v = DIRECTION_VECTOR[dir];
          const moved = {
            x: snap(pin.x + v.x * STAGGER_OFFSET),
            y: snap(pin.y + v.y * STAGGER_OFFSET),
          };
          const key = pointKey(moved);
          if (occupied.has(key)) continue; // would land on live geometry
          // Routing detours run ROUTE_CLEARANCE (20px) off obstacle edges —
          // the same line staggered anchors land on. An anchor strictly
          // inside a foreign wire segment reads as a junction and, in the
          // KiCad export, genuinely shorts the two nets (KiCad binds a label
          // to any wire crossing its position). Likewise a stub swallowing a
          // foreign vertex. Skip the stagger in both cases.
          if (wires.some((w) => pointStrictlyOnWireInterior(moved, w))) continue;
          if (stubSwallowsVertex(pin, moved, wires)) continue;
          occupied.add(key);
          wires.push({ id: crypto.randomUUID(), vertices: [pin, moved] });
          label.position = moved;
        }
      }
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Optional layout tuning. `spread` maps a refDes to EXTRA courtyard clearance
 * (px) for the body de-overlap pass — the layout critic (vision pass) sets it on
 * components a rendered view shows as crowded, so they get pushed further from
 * their neighbours. Anything not listed keeps the default spacing.
 */
export type AutoLayoutOptions = { spread?: Record<string, number> };

export function autoLayoutBuild(
  netlist: BuildLogicalNetlist,
  parts: Map<string, CachedPart>,
  opts?: AutoLayoutOptions,
): SchematicState {
  // Deterministic ordering so the same netlist always lays out identically.
  const comps = [...netlist.components].sort((a, b) => a.refDes.localeCompare(b.refDes));

  const byRefDes = new Map<string, Sized>();
  for (const c of comps) {
    const part = parts.get(c.partId);
    const role = normalizeComponentRole(c.role, c.refDes, part?.pins.length ?? 0);
    const { w, h } = estimateSize(part, role);
    byRefDes.set(c.refDes, {
      comp: c,
      part,
      role,
      width: w,
      height: h,
      placed: false,
      spread: opts?.spread?.[c.refDes],
      instance: {
        id: crypto.randomUUID(),
        partId: c.partId,
        x: 0,
        y: 0,
        rotation: 0,
        refDes: c.refDes,
        value: c.value,
      },
    });
  }
  const all = [...byRefDes.values()];

  // Adjacency (component-level) + which components touch the ground rail —
  // used to place loose passives between the things they bridge.
  const neighbors = new Map<string, string[]>();
  const groundedRefs = new Set<string>();
  const addNeighbor = (a: string, b: string) => {
    const list = neighbors.get(a) ?? [];
    if (!list.includes(b)) list.push(b);
    neighbors.set(a, list);
  };
  for (const conn of netlist.connections) {
    if (isLabelConnection(conn)) {
      // A ground label anchors its component to the ground rail for placement
      // purposes (hang grounded passives below their neighbor). Power/signal
      // labels are long-distance by design and contribute no adjacency.
      const kind = conn.labelKind ?? inferNetLabelKind(conn.labelName);
      if (kind === "ground") {
        const parsed = parseEndpoint(conn.pin);
        if (!("ground" in parsed)) groundedRefs.add(parsed.refDes);
      }
      continue;
    }
    const f = parseEndpoint(conn.from);
    const t = parseEndpoint(conn.to);
    const fg = "ground" in f;
    const tg = "ground" in t;
    if (fg && tg) continue;
    if (fg || tg) {
      groundedRefs.add((fg ? (t as { refDes: string }) : (f as { refDes: string })).refDes);
      continue;
    }
    const fr = (f as { refDes: string }).refDes;
    const tr = (t as { refDes: string }).refDes;
    if (fr !== tr) { addNeighbor(fr, tr); addNeighbor(tr, fr); }
  }

  // ── Zone assignment ─────────────────────────────────────────────────────────
  const ofRole = (r: ComponentRole) => all.filter((p) => p.role === r);
  const inputs = ofRole("input");
  const processors = ofRole("processor");
  const outputs = ofRole("output");
  const indicators = ofRole("indicator");
  const regulators = ofRole("regulator");
  const sources = ofRole("source");
  const connectors = ofRole("connector");
  const passives = ofRole("passive");
  const supports = ofRole("support");

  const powerConn = connectors.filter((p) => isPowerConnector(p.part, p.comp.value));
  const signalConn = connectors.filter((p) => !isPowerConnector(p.part, p.comp.value));

  stackZone(signalConn, ZONE_X.signalConnectors, CENTER_Y);
  stackZone(inputs, ZONE_X.inputs, CENTER_Y);
  stackZone(processors, ZONE_X.processors, CENTER_Y);
  stackZone(outputs, ZONE_X.outputs, CENTER_Y);
  stackZoneFromTop(indicators, ZONE_X.indicators, (zoneBottom(outputs) ?? CENTER_Y) + ROW_H);
  stackZoneFromTop(regulators, ZONE_X.regulators, TOP_Y);
  stackZoneFromTop(sources, ZONE_X.sources, TOP_Y);
  stackZoneFromTop(powerConn, ZONE_X.powerConnectors, (zoneBottom(sources) ?? TOP_Y - ROW_H) + ROW_H);

  // ── Support components: cluster around their parent IC ─────────────────────
  const looseFallback: Sized[] = []; // supports without a usable parent
  const supportIndexByParent = new Map<string, number>();
  for (const s of supports) {
    const parent = s.comp.parentRefDes ? byRefDes.get(s.comp.parentRefDes) : undefined;
    if (!parent || !parent.placed || parent === s) {
      looseFallback.push(s);
      continue;
    }
    const i = supportIndexByParent.get(parent.comp.refDes) ?? 0;
    supportIndexByParent.set(parent.comp.refDes, i + 1);
    // Corner rotation: top-right, bottom-right, top-left, bottom-left, then
    // repeat one ring further out.
    const corner = i % 4;
    const ring = Math.floor(i / 4);
    const right = corner === 0 || corner === 1;
    const top = corner === 0 || corner === 2;
    const dx = (parent.width / 2 + SUPPORT_GAP + ring * 60) * (right ? 1 : -1);
    const dy = (SUPPORT_GAP + ring * 60) * (top ? -1 : 1);
    s.instance.x = snap(parent.instance.x + dx);
    s.instance.y = snap(parent.instance.y + dy);
    s.placed = true;
  }

  // ── Loose passives: between the components they connect ────────────────────
  const loosePassives = [...passives, ...looseFallback];
  const occupied = new Set<string>();
  for (const p of all) {
    if (p.placed) occupied.add(`${p.instance.x},${p.instance.y}`);
  }
  // Multi-pass so chains of passives resolve once one end is anchored.
  for (let pass = 0; pass < 4; pass++) {
    for (const p of loosePassives) {
      if (p.placed) continue;
      const ns = (neighbors.get(p.comp.refDes) ?? [])
        .map((r) => byRefDes.get(r))
        .filter((n): n is Sized => n !== undefined && n.placed)
        // Prefer anchoring to non-passive components when both kinds connect.
        .sort((a, b) => Number(a.role === "passive") - Number(b.role === "passive"));
      if (ns.length === 0) continue;

      let x: number;
      let y: number;
      let vertical = false;
      if (ns.length >= 2) {
        const a = ns[0].instance;
        const b = ns[1].instance;
        x = (a.x + b.x) / 2;
        y = (a.y + b.y) / 2;
        vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
      } else {
        const n = ns[0].instance;
        if (groundedRefs.has(p.comp.refDes)) {
          // Other end is the ground rail (at the bottom) — hang it below.
          x = n.x;
          y = n.y + ROW_H * 0.75;
          vertical = true;
        } else {
          x = n.x + (n.x <= ORIGIN_X ? -COL_W : COL_W) * 0.8;
          y = n.y;
        }
      }
      let px = snap(x);
      let py = snap(y);
      while (occupied.has(`${px},${py}`)) {
        if (vertical) px += 80;
        else py += 60;
      }
      p.instance.x = px;
      p.instance.y = py;
      p.instance.rotation = vertical ? 90 : 0;
      p.placed = true;
      occupied.add(`${px},${py}`);
    }
  }
  // Anything still unplaced (no resolvable neighbors): fallback row at the bottom-left.
  let fx = ZONE_X.inputs;
  for (const p of loosePassives) {
    if (p.placed) continue;
    p.instance.x = snap(fx);
    p.instance.y = snap(CENTER_Y + 2 * ROW_H);
    p.placed = true;
    fx += COL_W / 2;
  }

  // ── Placement validation: no two component bodies/courtyards overlap ────────
  // Runs BEFORE ground placement and wire/label routing so the ground sits below
  // the final layout and every net routes from de-overlapped pin positions.
  const unresolvedOverlaps = resolveComponentCollisions(all);
  if (unresolvedOverlaps > 0) {
    console.warn(
      `[autoLayoutBuild] ${unresolvedOverlaps} component overlap(s) could not be fully resolved within the pass budget.`,
    );
  }

  // Separate any pins that still share a grid point — those silently short two
  // nets, so this matters more than residual body overlap.
  const unresolvedPins = resolvePinCoincidences(all);
  if (unresolvedPins > 0) {
    console.warn(
      `[autoLayoutBuild] ${unresolvedPins} pin coincidence(s) (potential shorts) could not be resolved.`,
    );
  }

  // ── Single shared ground at the bottom center ───────────────────────────────
  const bottom = zoneBottom(all) ?? CENTER_Y;
  const ground: SchComponent = {
    id: crypto.randomUUID(),
    type: "ground",
    x: snap(ORIGIN_X),
    // Ground pin offset is { x: 0, y: -20 }; place so the pin sits GND_DROP
    // below the lowest component.
    y: snap(bottom + GND_DROP + 20),
    rotation: 0,
    value: "",
  };
  const groundPin: Point = { x: ground.x, y: snap(ground.y - 20) };
  let groundUsed = false;

  // ── Net labels + wires ──────────────────────────────────────────────────────
  const obstacles = all.map(obstacleFor);
  let wires: Wire[] = [];
  // Connection endpoints (pin sites + ground pin). Wires are pre-split at these
  // — and ONLY these — points so T-junctions render dots and union into one
  // net, while plain corner/crossing points stay electrically separate.
  const terminals: Point[] = [];
  const netLabels: NetLabel[] = [];
  const placedLabelKeys = new Set<string>();   // "x,y|NAME" — dedupe per anchor
  const usedFallbackNames = new Map<string, string>(); // name → connection key

  function resolvePinEndpoint(parsed: { refDes: string; pin: string }): WireEndpoint | null {
    const target = byRefDes.get(parsed.refDes);
    if (!target || !target.part) return null;
    const pin = findPin(target.part, parsed.pin);
    if (!pin) return null;
    return {
      position: kicadPinWorldPos(target.instance, pin),
      exitDirection: kicadPinExitDirection(target.instance, pin),
    };
  }

  function resolvePinPoint(parsed: { refDes: string; pin: string }): Point | null {
    return resolvePinEndpoint(parsed)?.position ?? null;
  }

  function placeLabel(
    pinPoint: Point,
    owner: Sized | undefined,
    rawName: string,
    kind: NetLabelKind,
  ): void {
    const name = rawName.trim().toUpperCase();
    const key = `${pinPoint.x},${pinPoint.y}|${name}`;
    if (placedLabelKeys.has(key)) return; // same label on the same pin twice
    placedLabelKeys.add(key);
    const exit = owner ? pinExitDirection(owner, pinPoint) : NATURAL_LABEL_DIRECTION[kind];
    netLabels.push({
      id: crypto.randomUUID(),
      position: pinPoint,
      name,
      kind,
      orientation: labelOrientation(kind, exit),
    });
  }

  // Deterministic generated net name for a failed route: "NET_" + 4-char hash
  // of the connection endpoints (≤ 8 chars total). On the rare hash collision
  // between different connections, re-hash with a salt until unique.
  function fallbackNetName(connKey: string): string {
    for (let salt = 0; ; salt++) {
      const name = `NET_${netNameSuffix(salt === 0 ? connKey : `${connKey}#${salt}`)}`;
      const holder = usedFallbackNames.get(name);
      if (holder === undefined || holder === connKey) {
        usedFallbackNames.set(name, connKey);
        return name;
      }
    }
  }

  function pushVerts(verts: Point[], a: Point, b: Point): void {
    // One single-segment Wire per consecutive vertex pair.
    for (let i = 0; i < verts.length - 1; i++) {
      if (!pointEquals(verts[i], verts[i + 1])) {
        wires.push({ id: crypto.randomUUID(), vertices: [verts[i], verts[i + 1]] });
      }
    }
    terminals.push(a, b);
  }

  // PHASE 1 — explicit label connections first, so power/ground pins are
  // flagged before any wire routing happens around them.
  for (const conn of netlist.connections) {
    if (!isLabelConnection(conn)) continue;
    const parsed = parseEndpoint(conn.pin);
    if ("ground" in parsed) continue;
    const pinPoint = resolvePinPoint(parsed);
    if (!pinPoint) continue;
    const kind = conn.labelKind ?? inferNetLabelKind(conn.labelName);
    placeLabel(pinPoint, byRefDes.get(parsed.refDes), conn.labelName, kind);
  }

  // PHASE 2 — wire connections, with fallback-to-label when no clean route
  // exists (the path would cross a component body, or would run parallel to
  // existing wires for more than PARALLEL_MAX_OVERLAP px).
  let fallbackCount = 0;

  function routeOrFail(a: WireEndpoint, b: WireEndpoint): Point[] | null {
    const { verts, crossings } = routeWireEndpoints(a, b, obstacles);
    if (crossings > 0) return null;
    if (longestParallelRun(verts, wires) > PARALLEL_MAX_OVERLAP) return null;
    return verts;
  }

  for (const conn of netlist.connections) {
    if (isLabelConnection(conn)) continue;
    const wireConn = conn as BuildLogicalWireConnection;
    const from = parseEndpoint(wireConn.from);
    const to = parseEndpoint(wireConn.to);
    const fromGround = "ground" in from;
    const toGround = "ground" in to;
    if (fromGround && toGround) continue; // nonsensical; skip

    if (fromGround || toGround) {
      const pinEnd = (fromGround ? to : from) as { refDes: string; pin: string };
      const pinEndpoint = resolvePinEndpoint(pinEnd);
      if (!pinEndpoint) continue;
      // The ground symbol's pin sits at its top and the wire leaves it going up
      // (north) toward the circuit above.
      const groundEndpoint: WireEndpoint = {
        position: groundPin,
        exitDirection: pinDirection(ground, "pin"),
      };
      const verts = routeOrFail(pinEndpoint, groundEndpoint);
      if (verts) {
        groundUsed = true;
        pushVerts(verts, pinEndpoint.position, groundPin);
      } else {
        // Unroutable ground wire → a ground label right at the pin.
        fallbackCount++;
        placeLabel(pinEndpoint.position, byRefDes.get(pinEnd.refDes), "GND", "ground");
      }
      continue;
    }

    const fromEnd = from as { refDes: string; pin: string };
    const toEnd = to as { refDes: string; pin: string };
    const aEnd = resolvePinEndpoint(fromEnd);
    const bEnd = resolvePinEndpoint(toEnd);
    if (!aEnd || !bEnd) continue;
    const verts = routeOrFail(aEnd, bEnd);
    if (verts) {
      pushVerts(verts, aEnd.position, bEnd.position);
    } else {
      // Unroutable signal wire → a label pair sharing a generated net name.
      fallbackCount++;
      const name = fallbackNetName(`${wireConn.from}->${wireConn.to}`);
      placeLabel(aEnd.position, byRefDes.get(fromEnd.refDes), name, "label");
      placeLabel(bEnd.position, byRefDes.get(toEnd.refDes), name, "label");
    }
  }

  if (fallbackCount > 0) {
    console.log(
      `[autoLayoutBuild] fallback-to-label: ${fallbackCount} wires converted to labels.`,
    );
  }

  // ── Stagger crowded labels (before terminal splitting / page fit) ───────────
  const occupiedPoints = new Set<string>();
  for (const p of all) {
    for (const pin of p.part?.pins ?? []) {
      occupiedPoints.add(pointKey(kicadPinWorldPos(p.instance, pin)));
    }
  }
  occupiedPoints.add(pointKey(groundPin));
  for (const w of wires) for (const v of w.vertices) occupiedPoints.add(pointKey(v));
  for (const l of netLabels) occupiedPoints.add(pointKey(l.position));
  staggerCrowdedLabels(netLabels, wires, occupiedPoints);

  for (const t of terminals) wires = splitWiresAtPoint(wires, t);
  wires = consolidateWires(wires);

  // ── Page fit ────────────────────────────────────────────────────────────────
  // Size the sheet to the drawn result and shift it inside the printable margin
  // so nothing floats off the page. A rigid (grid-snapped) translation preserves
  // every pin position — and therefore every wire route and label anchor
  // computed above — so this runs last, after the geometry is final.
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (x: number, y: number): void => {
    if (x < bounds.minX) bounds.minX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y > bounds.maxY) bounds.maxY = y;
  };
  for (const p of all) {
    const b = footprintBox(p, 0); // pure pin extent (no clearance — margin is added by the page fit)
    grow(b.x, b.y);
    grow(b.x + b.width, b.y + b.height);
  }
  if (groundUsed) {
    grow(ground.x - 20, ground.y - 20);
    grow(ground.x + 20, ground.y + 20);
  }
  for (const l of netLabels) grow(l.position.x, l.position.y);
  for (const w of wires) for (const v of w.vertices) grow(v.x, v.y);

  const fit = Number.isFinite(bounds.minX)
    ? planPageFit(bounds)
    : { pageSize: DEFAULT_PAGE_SIZE, dx: 0, dy: 0 };

  if (fit.dx !== 0 || fit.dy !== 0) {
    for (const p of all) {
      p.instance.x = snap(p.instance.x + fit.dx);
      p.instance.y = snap(p.instance.y + fit.dy);
    }
    if (groundUsed) {
      ground.x = snap(ground.x + fit.dx);
      ground.y = snap(ground.y + fit.dy);
    }
    for (const l of netLabels) {
      l.position = { x: snap(l.position.x + fit.dx), y: snap(l.position.y + fit.dy) };
    }
    wires = wires.map((w) => ({
      ...w,
      vertices: w.vertices.map((v) => ({ x: snap(v.x + fit.dx), y: snap(v.y + fit.dy) })),
    }));
  }

  return {
    components: groundUsed ? [ground] : [],
    wires,
    kicadComponents: all.map((p) => p.instance),
    netLabels,
    pageSize: fit.pageSize,
  };
}

/**
 * Lay out the netlist, then VALIDATE the drawn result against the intended
 * netlist (see validate-netlist.ts). When validation finds broken connections —
 * a wire the netlist intended that didn't electrically take — reroute those nets
 * as labels and try again (bounded, and only while the violation count strictly
 * drops). Returns the best `state` plus the final `validation`. Merges and
 * self-shorts are geometry faults relabeling can't fix; they survive in
 * `validation.violations` for the caller to surface as hard errors rather than
 * silently shipping an electrically wrong schematic.
 */
export function autoLayoutBuildValidated(
  netlist: BuildLogicalNetlist,
  parts: Map<string, CachedPart>,
  maxAttempts = 3,
  opts?: AutoLayoutOptions,
): { state: SchematicState; validation: NetlistValidation } {
  let current = netlist;
  let state = autoLayoutBuild(current, parts, opts);
  let validation = validateSchematicNetlist(current, state, parts);

  for (let attempt = 1; !validation.ok && attempt < maxAttempts; attempt++) {
    const rerouted = rerouteToLabels(current, parts, state, validation.violations);
    if (rerouted === current) break; // nothing reroutable (no broken connections)
    const nextState = autoLayoutBuild(rerouted, parts, opts);
    const nextValidation = validateSchematicNetlist(rerouted, nextState, parts);
    // Keep the reroute only if it strictly reduced violations.
    if (nextValidation.violations.length >= validation.violations.length) break;
    current = rerouted;
    state = nextState;
    validation = nextValidation;
  }

  if (!validation.ok) {
    // warn, not error — this is a surfaced finding (also shown in the UI), not a
    // crash; console.error trips Next.js's dev error overlay.
    console.warn(
      `[autoLayoutBuildValidated] ${validation.violations.length} unresolved netlist violation(s):`,
      validation.violations.map((v) => `${v.kind}: ${v.message}`).join("\n  "),
    );
  }
  return { state, validation };
}
