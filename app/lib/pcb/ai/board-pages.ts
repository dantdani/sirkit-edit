/**
 * [B24-D2] D24-29, OD-213 - the BOUNDED, PAGED board read (`sirkit.pcb.board-page-inspect`, binding `read.board-page`).
 *
 * board-inspect answers with the whole AI PCB snapshot, and on every recorded ROUTED board that snapshot is over the loop's
 * 60,000-character result budget (b18-e-board-inspect-budget), so the model receives `output_too_large_for_model` and no board
 * facts at all. This read selects ONE layer, ONE net or ONE flat region of the same snapshot and pages it: each page's whole tool
 * result, as the loop serializes it, stays within BOARD_PAGE_MAX_RESULT_CHARS, and following `nextCursor` from the first page
 * visits every selected item exactly once. The items are board-inspect's own projections, selected from `buildAIPcbSnapshot`
 * (snapshot.ts is not edited), so the two reads cannot disagree. Pure over the board: no clock, no I/O, no session state.
 *
 * Membership (the descriptor's verificationStrategy and every page's `membership` state the same):
 *  - layer, an enabled copper layer of the board: footprints with a pad on it, pads whose copper layers include it, tracks on it,
 *    vias whose span includes it, zones on it, keepouts that list it; nets are not selected by layer;
 *  - net, the board's own net name matched exactly (case and surrounding space forgiven, as via-inspect matches it): the net, the
 *    footprints with a pad on it, its pads, tracks, vias and zones; a keepout carries no net;
 *  - region, a closed rectangle in mm: footprints whose body bounds meet it, pads and vias whose position lies in it, tracks whose
 *    segment meets it, zones and keepouts whose polygon's bounding box meets it; nets are not selected by region.
 * Order: kinds in BOARD_PAGE_KINDS, ids by code point within a kind. A page holds whole items only: an item larger than a whole page
 * is refused by kind and id (`item_over_budget`) on the page where it falls, never truncated. A cursor names one page of one
 * selection of one board revision; with another revision or selector it is refused (`stale_cursor`).
 */
import { compareCodePoints } from "@/app/lib/stable-compare";
import { viaSpannedLayers } from "../geometry-copper";
import { stableHash } from "../smart-routing/hash";
import { getBoardStackup } from "../stackup";
import type { PcbBoard, Via } from "../types";
import { buildAIPcbSnapshot } from "./snapshot";

export const BOARD_PAGE_SCHEMA = "sirkit.board-page.v1" as const;
/** The page constant: a page's whole tool result, as the loop serializes it (`loop.ts` resultText), is at most this many characters. */
export const BOARD_PAGE_MAX_RESULT_CHARS = 48_000;
/** The stated margin: the page constant plus this is the loop's MAX_RESULT_CHARS (60,000). [B24-D2 review, 2026-10-09] The sanitizer's
 *  lengthening is not left to it: every size below is measured on the model-bound text too (`measured`, at the end of this file). */
export const BOARD_PAGE_MARGIN_CHARS = 12_000;
/** What the builder leaves, inside the page constant, for the binding's `{"page":...}` and the loop's
 *  `{"ok":true,"tool":...,"revision":...,"verification":...,"output":...}` around the page object (about 160 characters). */
export const BOARD_PAGE_ENVELOPE_CHARS = 1_000;
/** The budget of the page object itself, in JSON characters. */
export const BOARD_PAGE_OUTPUT_CHARS = BOARD_PAGE_MAX_RESULT_CHARS - BOARD_PAGE_ENVELOPE_CHARS;

export const BOARD_PAGE_KINDS = Object.freeze(["nets", "footprints", "pads", "tracks", "vias", "zones", "keepouts"] as const);
export type BoardPageKind = (typeof BOARD_PAGE_KINDS)[number];
/** The closed refusals of a whole call. */
export const BOARD_PAGE_REFUSALS = Object.freeze(["selector_missing", "selector_doubled", "region_incomplete", "region_inverted", "unknown_layer", "unknown_net", "cursor_invalid", "stale_cursor"] as const);
export type BoardPageRefusalCode = (typeof BOARD_PAGE_REFUSALS)[number];
/** The one refusal of a single item: larger than a whole page. */
export const ITEM_OVER_BUDGET = "item_over_budget" as const;
/** How many known layer or net names a refusal lists (the true count beside them). */
export const MAX_KNOWN_NAMES = 64;

type SelectorKind = "layer" | "net" | "region";
const MEMBERSHIP: Readonly<Record<SelectorKind, Partial<Record<BoardPageKind, string>>>> = Object.freeze({
  layer: { footprints: "a pad on the layer", pads: "copper on the layer", tracks: "on the layer", vias: "span includes the layer", zones: "on the layer", keepouts: "lists the layer" },
  net: { nets: "the net itself", footprints: "a pad on the net", pads: "on the net", tracks: "on the net", vias: "on the net", zones: "on the net" },
  region: { footprints: "body bounds meet the region", pads: "position in the region", tracks: "segment meets the region", vias: "position in the region", zones: "polygon bounding box meets the region", keepouts: "polygon bounding box meets the region" },
});

export interface BoardPageRegion { xMinMm: number; yMinMm: number; xMaxMm: number; yMaxMm: number }
export type BoardPageSelector = { layer: string } | { netName: string; net: { id: string; name: string } } | { region: BoardPageRegion };
export interface BoardPageRefusedItem { kind: BoardPageKind; id: string; code: typeof ITEM_OVER_BUDGET; chars: number }

export interface BoardPage {
  schema: typeof BOARD_PAGE_SCHEMA;
  units: "mm";
  boardRevisionId: string;
  selector: BoardPageSelector;
  /** Which membership each selected kind uses for this selector. */
  membership: Partial<Record<BoardPageKind, string>>;
  /** The TRUE count per kind for the whole selection (every page states it). */
  counts: Partial<Record<BoardPageKind, number>>;
  page: number;
  pageCount: number;
  /** This page's items: board-inspect's own projections, every selected kind present (possibly empty). */
  items: Partial<Record<BoardPageKind, unknown[]>>;
  refusedItems: BoardPageRefusedItem[];
  /** The next page's cursor, null on the last page. */
  nextCursor: string | null;
}

export interface BoardPageRefusal {
  schema: typeof BOARD_PAGE_SCHEMA;
  units: "mm";
  boardRevisionId: string;
  refused: { code: BoardPageRefusalCode; detail: string; known?: string[]; knownCount?: number };
}

type Item = Record<string, unknown> & { id: string };
type Point = { x: number; y: number };
interface Projections { boardRevisionId: string; footprints: Item[]; pads: Item[]; nets: Item[]; tracks: Item[]; vias: Item[]; zones: Item[]; keepouts: Item[] }

const CURSOR = /^bp1\.(\d{1,6})\.([0-9a-f]{8})$/;
/** Absent: undefined, null, or a string of spaces (a strict model's empty value). */
const given = (value: unknown): boolean => value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function refusal(boardRevisionId: string, code: BoardPageRefusalCode, detail: string, known?: readonly string[]): BoardPageRefusal {
  return boundedRefusal(boardRevisionId, code, detail, known); // [B24-D2 review, 2026-10-09] the known names as a prefix that fits a page, measured on the model-bound text
}

const inRegion = (r: BoardPageRegion, p: Point): boolean => p.x >= r.xMinMm && p.x <= r.xMaxMm && p.y >= r.yMinMm && p.y <= r.yMaxMm;
const boxMeets = (r: BoardPageRegion, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean => b.minX <= r.xMaxMm && b.maxX >= r.xMinMm && b.minY <= r.yMaxMm && b.maxY >= r.yMinMm;
/** Liang-Barsky: does the closed segment a-b meet the closed rectangle? */
function segmentMeets(r: BoardPageRegion, a: Point, b: Point): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, a.x - r.xMinMm) && clip(dx, r.xMaxMm - a.x) && clip(-dy, a.y - r.yMinMm) && clip(dy, r.yMaxMm - a.y);
}
function polygonBoxMeets(r: BoardPageRegion, polygon: readonly Point[]): boolean {
  if (polygon.length === 0) return false;
  return boxMeets(r, { minX: Math.min(...polygon.map((p) => p.x)), minY: Math.min(...polygon.map((p) => p.y)), maxX: Math.max(...polygon.map((p) => p.x)), maxY: Math.max(...polygon.map((p) => p.y)) });
}
const viaSpan = (via: Item): string[] => viaSpannedLayers({ layers: [via.startLayerId, via.endLayerId] } as unknown as Via);

/** The selected items per kind, each kind sorted by id (code point). */
function select(snapshot: Projections, kind: SelectorKind, key: string, region: BoardPageRegion | null): Partial<Record<BoardPageKind, Item[]>> {
  const out: Partial<Record<BoardPageKind, Item[]>> = {};
  if (kind === "layer") {
    out.pads = snapshot.pads.filter((pad) => Array.isArray(pad.layers) && (pad.layers as string[]).includes(key));
    const footprintIds = new Set(out.pads.map((pad) => String(pad.footprintId)));
    out.footprints = snapshot.footprints.filter((footprint) => footprintIds.has(footprint.id));
    out.tracks = snapshot.tracks.filter((track) => track.layerId === key);
    out.vias = snapshot.vias.filter((via) => viaSpan(via).includes(key));
    out.zones = snapshot.zones.filter((zone) => zone.layerId === key);
    out.keepouts = snapshot.keepouts.filter((keepout) => Array.isArray(keepout.layers) && (keepout.layers as string[]).includes(key));
  } else if (kind === "net") {
    out.nets = snapshot.nets.filter((net) => net.id === key);
    out.pads = snapshot.pads.filter((pad) => pad.netId === key);
    const footprintIds = new Set(out.pads.map((pad) => String(pad.footprintId)));
    out.footprints = snapshot.footprints.filter((footprint) => footprintIds.has(footprint.id));
    out.tracks = snapshot.tracks.filter((track) => track.netId === key);
    out.vias = snapshot.vias.filter((via) => via.netId === key);
    out.zones = snapshot.zones.filter((zone) => zone.netId === key);
  } else if (region) {
    out.footprints = snapshot.footprints.filter((footprint) => boxMeets(region, footprint.bodyBounds as { minX: number; minY: number; maxX: number; maxY: number }));
    out.pads = snapshot.pads.filter((pad) => inRegion(region, pad.position as Point));
    out.tracks = snapshot.tracks.filter((track) => { const [a, b] = track.geometry as [Point, Point]; return segmentMeets(region, a, b); });
    out.vias = snapshot.vias.filter((via) => inRegion(region, via.position as Point));
    out.zones = snapshot.zones.filter((zone) => polygonBoxMeets(region, zone.polygon as Point[]));
    out.keepouts = snapshot.keepouts.filter((keepout) => polygonBoxMeets(region, keepout.polygon as Point[]));
  }
  for (const name of BOARD_PAGE_KINDS) if (out[name]) out[name] = [...out[name]!].sort((a, b) => compareCodePoints(a.id, b.id));
  return out;
}

const cursorHash = (boardRevisionId: string, selectorKey: string, page: number): string => stableHash(`${BOARD_PAGE_SCHEMA}|${boardRevisionId}|${selectorKey}|${page}`);
const cursorFor = (boardRevisionId: string, selectorKey: string, page: number): string => `bp1.${page}.${cursorHash(boardRevisionId, selectorKey, page)}`;

/**
 * One page of one selection of `board`. `args` are the tool's arguments as the B05 validator passed them: exactly one selector -
 * `layer`, `netName`, or the four region bounds `xMinMm`, `yMinMm`, `xMaxMm`, `yMaxMm` - and an optional `cursor` from the previous
 * page. A refusal of the whole call is an answer too (`refused`, a closed code), so the model is told what was wrong and nothing is
 * guessed. The same board and the same arguments always give the same bytes.
 */
export function buildBoardPage(board: PcbBoard, args: Readonly<Record<string, unknown>>): BoardPage | BoardPageRefusal {
  const snapshot = buildAIPcbSnapshot(board) as unknown as Projections;
  const revision = snapshot.boardRevisionId;
  const regionKeys = ["xMinMm", "yMinMm", "xMaxMm", "yMaxMm"] as const;
  const regionGiven = regionKeys.filter((key) => given(args[key]));
  const selectors = [given(args.layer), given(args.netName), regionGiven.length > 0].filter(Boolean).length;
  if (selectors === 0) return refusal(revision, "selector_missing", "name exactly one selector: layer, netName, or the region xMinMm, yMinMm, xMaxMm, yMaxMm (mm)");
  if (selectors > 1) return refusal(revision, "selector_doubled", "name exactly one selector: layer, netName, or one region");

  let kind: SelectorKind;
  let selector: BoardPageSelector;
  let key: string;
  let region: BoardPageRegion | null = null;
  if (given(args.layer)) {
    const layers = getBoardStackup(board).copperLayers.filter((layer) => layer.enabled).map((layer) => layer.id as string);
    const layer = String(args.layer).trim();
    if (!layers.includes(layer)) return refusal(revision, "unknown_layer", "the layer is not an enabled copper layer of this board", layers);
    kind = "layer";
    selector = { layer };
    key = layer;
  } else if (given(args.netName)) {
    const requested = String(args.netName).trim();
    const nets = snapshot.nets.map((net) => ({ id: String(net.id), name: String(net.name) }));
    const match = nets.find((net) => net.name.toLowerCase() === requested.toLowerCase());
    if (!match) return refusal(revision, "unknown_net", "no net of this board has that name (matched exactly; case and surrounding space forgiven)", nets.map((net) => net.name));
    kind = "net";
    selector = { netName: requested, net: match };
    key = match.id;
  } else {
    if (regionGiven.length !== regionKeys.length || !regionKeys.every((name) => finite(args[name]))) return refusal(revision, "region_incomplete", "a region needs all four bounds in mm: xMinMm, yMinMm, xMaxMm, yMaxMm");
    const bounds: BoardPageRegion = { xMinMm: args.xMinMm as number, yMinMm: args.yMinMm as number, xMaxMm: args.xMaxMm as number, yMaxMm: args.yMaxMm as number };
    if (bounds.xMinMm > bounds.xMaxMm || bounds.yMinMm > bounds.yMaxMm) return refusal(revision, "region_inverted", "a region's minimum must not exceed its maximum on either axis");
    kind = "region";
    selector = { region: bounds };
    region = bounds;
    key = JSON.stringify([bounds.xMinMm, bounds.yMinMm, bounds.xMaxMm, bounds.yMaxMm]);
  }
  const selectorKey = `${kind}:${key}`;

  let pageNumber = 1;
  if (given(args.cursor)) {
    const parsed = typeof args.cursor === "string" ? CURSOR.exec(args.cursor) : null;
    if (!parsed || Number(parsed[1]) < 2) return refusal(revision, "cursor_invalid", "a cursor is the nextCursor of a previous page, unchanged; omit it for the first page");
    pageNumber = Number(parsed[1]);
    if (parsed[2] !== cursorHash(revision, selectorKey, pageNumber)) return refusal(revision, "stale_cursor", "the cursor belongs to another board revision or another selector; start again without a cursor");
  }

  const selected = select(snapshot, kind, key, region);
  const kinds = BOARD_PAGE_KINDS.filter((name) => selected[name] !== undefined);
  const membership = Object.fromEntries(kinds.map((name) => [name, MEMBERSHIP[kind][name]!]));
  const counts = Object.fromEntries(kinds.map((name) => [name, selected[name]!.length]));
  const frame = (page: number, pageCount: number, items: Partial<Record<BoardPageKind, unknown[]>>, refusedItems: BoardPageRefusedItem[], nextCursor: string | null): BoardPage => ({
    schema: BOARD_PAGE_SCHEMA, units: "mm", boardRevisionId: revision, selector, membership, counts, page, pageCount, items, refusedItems, nextCursor,
  });

  // Pack whole items in order, greedily: the empty frame at its widest (the largest page numbers, a cursor) plus each item's JSON and
  // its separator. An item that cannot fit an empty page is refused where it falls, never cut.
  const empty = Object.fromEntries(kinds.map((name) => [name, [] as unknown[]]));
  const capacity = BOARD_PAGE_OUTPUT_CHARS - measured(frame(999_999, 999_999, empty, [], `bp1.999999.${"f".repeat(8)}`)); // [B24-D2 review, 2026-10-09] measured: raw or model-bound, the larger
  type Slot = { kind: BoardPageKind; item: Item; refused: BoardPageRefusedItem | null; cost: number };
  const pages: Slot[][] = [[]];
  let used = 0;
  for (const name of kinds) {
    for (const item of selected[name]!) {
      const chars = measured(item);
      const refused: BoardPageRefusedItem | null = chars + 1 > capacity ? { kind: name, id: item.id, code: ITEM_OVER_BUDGET, chars } : null;
      const cost = (refused ? measured(refused) : chars) + 1;
      if (used + cost > capacity && pages[pages.length - 1]!.length > 0) { pages.push([]); used = 0; }
      pages[pages.length - 1]!.push({ kind: name, item, refused, cost });
      used += cost;
    }
  }
  if (pageNumber > pages.length) return refusal(revision, "stale_cursor", "the cursor names a page this selection does not have; start again without a cursor");

  const slots = pages[pageNumber - 1]!;
  const items = Object.fromEntries(kinds.map((name) => [name, slots.filter((slot) => slot.kind === name && !slot.refused).map((slot) => slot.item)]));
  const refusedItems = slots.flatMap((slot) => (slot.refused ? [slot.refused] : []));
  const page = frame(pageNumber, pages.length, items, refusedItems, pageNumber < pages.length ? cursorFor(revision, selectorKey, pageNumber + 1) : null);
  if (measured(page) > BOARD_PAGE_OUTPUT_CHARS) throw new Error("BOARD_PAGE_OVER_BUDGET"); // unreachable by the packing above; never truncated
  return page;
}

// ─── [B24-D2 review, 2026-10-09] the page bound, measured on the text the model receives ──────────────────────────────────────────
// The loop hands a tool result to the model as JSON.stringify(modelSafe(payload)) (`loop.ts` resultText): every string and key
// through the model-bound sanitizer, which can lengthen a string (a redaction marker longer than what it replaces, e.g. a
// URL-credential shape) or shorten one. So the packing measures each item, the frame and a refusal as the LARGER of its raw JSON and
// its model-bound JSON: a page, and a refusal's list of known names, stay within BOARD_PAGE_OUTPUT_CHARS either way, and a crafted
// board name can never push a page over the loop's budget and lose its nextCursor.

/** A value as the loop hands it to the model: every string and key through `sanitizeModelBoundText` (`loop.ts` modelSafe; a page is
 *  far shallower than modelSafe's depth cut-off, and plain JSON has no cycles). */
function modelBound(value: unknown): unknown {
  if (typeof value === "string") return sanitizeModelBoundText(value);
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(modelBound);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [sanitizeModelBoundText(key), modelBound(item)]));
}
/** The characters a value takes on a page: the larger of its raw JSON and its model-bound JSON. */
function measured(value: unknown): number {
  return Math.max(JSON.stringify(value).length, JSON.stringify(modelBound(value)).length);
}
/** A refusal of the whole call; with known names, as many of the first MAX_KNOWN_NAMES (in their own order) as fit a page, the true
 *  count beside them - never a cut name. */
function boundedRefusal(boardRevisionId: string, code: BoardPageRefusalCode, detail: string, known?: readonly string[]): BoardPageRefusal {
  const answer = (names?: readonly string[]): BoardPageRefusal => ({ schema: BOARD_PAGE_SCHEMA, units: "mm", boardRevisionId, refused: { code, detail, ...(known && names ? { known: [...names], knownCount: known.length } : {}) } });
  if (!known) return answer();
  const names: string[] = [];
  let used = measured(answer([]));
  for (const name of known.slice(0, MAX_KNOWN_NAMES)) {
    const cost = measured(name) + 1;
    if (used + cost > BOARD_PAGE_OUTPUT_CHARS) break;
    names.push(name);
    used += cost;
  }
  return answer(names);
}

// [B24-D2 review, 2026-10-09] imported at the END (imports are hoisted) so no line cited above moves; the redaction authority imports nothing
import { sanitizeModelBoundText } from "@/app/lib/agent/redaction";
