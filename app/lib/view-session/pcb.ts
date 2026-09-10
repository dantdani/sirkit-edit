/**
 * [B17-D] The `pcb` (2D canvas) view-session command set.
 *
 * What the PCB canvas SHOWS is view state on the bus: the camera intent
 * (fit the board, or a centre + zoom the renderer flies to), the versioned
 * selection, layer visibility and the active layer, the grid, a highlighted
 * net, a revealed finding (DRC violation or routing failure) and a
 * non-persisting measurement. Semantic targets (`targets.ts`) name WHAT to
 * show — a reference designator, an object, a net, a world point the caller
 * already holds, or the session's current selection; nothing is a screen
 * coordinate. Geometry questions are answered by a probe over the CURRENT
 * board in world nanometres; when the probe cannot answer, the command
 * settles as a bounded `VS_UNAVAILABLE` refusal. No command here touches the
 * board: a measurement is never a dimension (dimensions stay the canonical
 * `pcb.dimension` transaction), a highlight is never a net edit, and a
 * selection is never engineering state.
 *
 * `pcb.observe` is the editor's own mirror of what the human changed outside
 * the bus (a canvas click, a wheel zoom, the layer panel); it is human-only —
 * an agent can never assert what is selected.
 */
import { refAnchor, refBBox } from "../pcb/edit/arrange";
import type { SelectionRef } from "../pcb/edit/commands";
import type { BBox, Vec2 } from "../pcb/geometry";
import { LAYERS, type LayerId } from "../pcb/layers";
import { getItems, selectNet } from "../pcb/selection-queries";
import type { PcbBoard } from "../pcb/types";
import { NM_PER_MM } from "../pcb/units";
import type { DrcResult } from "../pcb/drc/types";
import { refHighlightId } from "../pcb/drc/format";
import type { AutorouteUnresolvedConnection } from "../pcb/autoroute/completion";
import { isObject, isSelectionRef, isSelectionRelative, readSelectionDigest, resolveSelectionTarget, validateViewTarget, viewSelection, type ViewSelection, type ViewTarget } from "./targets";
import type { ViewCommandContext, ViewCommandDescriptor, ViewCommandOutcome } from "./types";

/** The renderer's zoom bounds (px per mm) — the same clamp `createPcbScene` applies. */
export const PCB_MIN_PX_PER_MM = 0.1;
export const PCB_MAX_PX_PER_MM = 400;
/** A focus never zooms closer than this (a single 0402 part would otherwise fill the screen). */
export const PCB_FOCUS_MAX_PX_PER_MM = 40;
/** Relative zoom is bounded per command. */
export const PCB_ZOOM_FACTOR_MIN = 0.25;
export const PCB_ZOOM_FACTOR_MAX = 4;

export const PCB_LAYER_IDS: readonly LayerId[] = LAYERS.map((layer) => layer.id);
export const PCB_COPPER_LAYER_IDS: readonly LayerId[] = LAYERS.filter((layer) => layer.kind === "copper").map((layer) => layer.id);

export interface PcbCameraIntent {
  /** `board`: the renderer frames the board and every placed footprint; `custom`: centre + zoom. */
  kind: "board" | "custom";
  centerNm: Vec2 | null;
  /** null = keep the current zoom. */
  pxPerMm: number | null;
  /** Increments on every camera command so the renderer flies even to the same frame again. */
  seq: number;
}

/** What the renderer currently shows (mirrored by `pcb.observe`; null until the canvas reports). */
export interface PcbObservedCamera { centerNm: Vec2; pxPerMm: number; viewportPx: { width: number; height: number } }

export interface PcbHighlight { netId: number; name: string; refs: SelectionRef[] }

export interface PcbReveal { findingId: string; source: "drc" | "routing"; summary: string; locationNm: Vec2; itemIds: string[]; seq: number }

export type PcbMeasureEnd =
  | { kind: "component"; ref: string; atNm: Vec2 }
  | { kind: "object"; ref: SelectionRef; atNm: Vec2 }
  | { kind: "point"; atNm: Vec2 };

/** A measurement is VIEW state: never a board dimension (that is the canonical `pcb.dimension` transaction). */
export interface PcbMeasurement { a: PcbMeasureEnd; b: PcbMeasureEnd; dxNm: number; dyNm: number; distanceNm: number; distanceMm: number }

export interface PcbViewState {
  camera: PcbCameraIntent;
  observed: PcbObservedCamera | null;
  selection: ViewSelection;
  layers: { visible: Record<LayerId, boolean>; active: LayerId };
  grid: boolean;
  highlight: PcbHighlight | null;
  reveal: PcbReveal | null;
  measurement: PcbMeasurement | null;
}

export const PCB_DEFAULT_VISIBLE: Readonly<Record<LayerId, boolean>> = Object.freeze(Object.fromEntries(LAYERS.map((layer) => [layer.id, layer.defaultVisible])) as Record<LayerId, boolean>);

export function pcbInitialState(): PcbViewState {
  return {
    camera: { kind: "board", centerNm: null, pxPerMm: null, seq: 0 },
    observed: null,
    selection: viewSelection([], null),
    layers: { visible: { ...PCB_DEFAULT_VISIBLE }, active: "copperTop" },
    grid: true,
    highlight: null,
    reveal: null,
    measurement: null,
  };
}

/** A finding the canvas can reveal: a DRC violation (`drc:<id>`) or an unresolved routing connection (`routing:<n>`). */
export interface PcbFinding { findingId: string; source: "drc" | "routing"; summary: string; locationNm: Vec2; itemIds: string[] }

/** Geometry and findings the commands may ask about — answered from the CURRENT board in world nm, or null when unavailable. */
export interface PcbViewProbe {
  hasBoard(): boolean;
  stackup(): 2 | 4;
  /** The outline ∪ every placed footprint (what "fit board" frames). */
  boardBoundsNm(): BBox | null;
  componentRef(ref: string): { ref: SelectionRef; refdes: string } | null;
  objectExists(ref: SelectionRef): boolean;
  boundsNm(refs: readonly SelectionRef[]): BBox | null;
  anchorNm(ref: SelectionRef): Vec2 | null;
  net(net: { netId?: number; name?: string }): { netId: number; name: string; refs: SelectionRef[] } | null;
  finding(findingId: string): PcbFinding | null;
  findings(): PcbFinding[];
}

export interface PcbProbeSources {
  board: PcbBoard | null;
  drc?: DrcResult | null;
  routingFailures?: readonly AutorouteUnresolvedConnection[] | null;
}

const union = (a: BBox | null, b: BBox): BBox => (a ? { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) } : b);

function outlineBBox(board: PcbBoard): BBox | null {
  const outline = board.outline;
  if (outline.kind === "rect") return { minX: outline.origin.x, minY: outline.origin.y, maxX: outline.origin.x + outline.width, maxY: outline.origin.y + outline.height };
  const points = (outline as { points?: Array<{ x: number; y: number }> }).points ?? [];
  if (points.length === 0) return null;
  return { minX: Math.min(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxX: Math.max(...points.map((p) => p.x)), maxY: Math.max(...points.map((p) => p.y)) };
}

/** The probe over the current board, DRC result and routing failures (pure; the React host re-creates it when they change). */
export function pcbViewProbe(sources: PcbProbeSources): PcbViewProbe {
  const { board } = sources;
  const bounds = (refs: readonly SelectionRef[]): BBox | null => {
    if (!board) return null;
    let box: BBox | null = null;
    for (const ref of refs) {
      if (ref.kind === "pad") {
        // Pads have no arrange bbox: frame the owning footprint.
        const fb = refBBox(board, { kind: "footprint", id: ref.footprintId });
        if (fb) box = union(box, fb);
        continue;
      }
      const b = refBBox(board, ref);
      if (b) box = union(box, b);
      else {
        const anchor = refAnchor(board, ref);
        if (anchor) box = union(box, { minX: anchor.x, minY: anchor.y, maxX: anchor.x, maxY: anchor.y });
      }
    }
    return box;
  };
  const findings = (): PcbFinding[] => {
    const out: PcbFinding[] = [];
    for (const violation of sources.drc?.violations ?? []) {
      out.push({ findingId: `drc:${violation.id}`, source: "drc", summary: violation.summary, locationNm: { ...violation.location }, itemIds: violation.items.map(refHighlightId).filter((id) => id.length > 0) });
    }
    (sources.routingFailures ?? []).forEach((failure, index) => {
      out.push({ findingId: `routing:${index}`, source: "routing", summary: `${failure.netName}: ${failure.failure}`, locationNm: { ...failure.location }, itemIds: [failure.from?.footprintId, failure.to?.footprintId].filter((id): id is string => Boolean(id)) });
    });
    return out;
  };
  return {
    hasBoard: () => board !== null,
    stackup: () => (board?.stackup === 4 ? 4 : 2),
    boardBoundsNm: () => {
      if (!board) return null;
      let box = outlineBBox(board);
      for (const footprint of board.footprints) {
        const fb = refBBox(board, { kind: "footprint", id: footprint.id });
        if (fb && [fb.minX, fb.minY, fb.maxX, fb.maxY].every(Number.isFinite)) box = union(box, fb);
      }
      return box;
    },
    componentRef: (ref) => {
      const footprint = board?.footprints.find((item) => item.ref === ref || item.id === ref);
      return footprint ? { ref: { kind: "footprint", id: footprint.id }, refdes: footprint.ref } : null;
    },
    objectExists: (ref) => board !== null && getItems(board, [ref]).length === 1,
    boundsNm: bounds,
    anchorNm: (ref) => {
      if (!board) return null;
      if (ref.kind === "pad") {
        const b = bounds([ref]);
        return b ? { x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2) } : null;
      }
      return refAnchor(board, ref) ?? null;
    },
    net: ({ netId, name }) => {
      if (!board) return null;
      const net = board.nets.find((item) => (netId !== undefined ? item.id === netId : false) || (name !== undefined ? item.name === name || item.name === `/root/${name}` || item.name.endsWith(`/${name}`) : false));
      if (!net || net.id === 0) return null;
      return { netId: net.id, name: net.name, refs: selectNet(board, net.id) };
    },
    finding: (findingId) => findings().find((item) => item.findingId === findingId) ?? null,
    findings,
  };
}

const unavailable = (what: string): ViewCommandOutcome<PcbViewState> => ({ ok: false, refusal: { code: "VS_UNAVAILABLE", message: `geometry unavailable: ${what}` } });
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);
const center = (b: BBox): Vec2 => ({ x: Math.round((b.minX + b.maxX) / 2), y: Math.round((b.minY + b.maxY) / 2) });

/** The zoom that frames `bounds` in `viewportPx` with the renderer's 0.85 margin, clamped to the renderer's bounds. */
export function fitPxPerMm(bounds: BBox, viewportPx: { width: number; height: number }): number {
  const wMm = Math.max((bounds.maxX - bounds.minX) / NM_PER_MM, 1);
  const hMm = Math.max((bounds.maxY - bounds.minY) / NM_PER_MM, 1);
  return clamp(Math.min(Math.max(viewportPx.width, 1) / wMm, Math.max(viewportPx.height, 1) / hMm) * 0.85, PCB_MIN_PX_PER_MM, PCB_MAX_PX_PER_MM);
}

const isLayerId = (value: unknown): value is LayerId => typeof value === "string" && (PCB_LAYER_IDS as readonly string[]).includes(value);
const isVec2 = (value: unknown): value is Vec2 => isObject(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y);

type Resolved = { ok: true; refs: SelectionRef[]; bounds: BBox | null; point: Vec2 | null; label: string } | { ok: false; refusal: ViewCommandOutcome<PcbViewState> };

export function pcbCommands(probe: () => PcbViewProbe): ViewCommandDescriptor<PcbViewState, never>[] {
  const define = <P,>(descriptor: ViewCommandDescriptor<PcbViewState, P>): ViewCommandDescriptor<PcbViewState, never> => descriptor as unknown as ViewCommandDescriptor<PcbViewState, never>;
  const withCamera = (state: PcbViewState, camera: Omit<PcbCameraIntent, "seq">): PcbViewState => ({ ...state, camera: { ...camera, seq: state.camera.seq + 1 } });

  /** Resolve a semantic target to refs/bounds/point on the current board; selection-relative targets are versioned. */
  const resolve = (target: ViewTarget, context: ViewCommandContext<PcbViewState>, selectionDigest: string | undefined): Resolved => {
    const p = probe();
    if (!p.hasBoard()) return { ok: false, refusal: unavailable("no board is loaded") };
    if (isSelectionRelative(target)) {
      const resolved = resolveSelectionTarget({ target, selection: context.state.selection, rebased: context.rebased, expectedSelectionDigest: selectionDigest });
      if (!resolved.ok) return { ok: false, refusal: { ok: false, refusal: resolved.refusal } };
      const live = resolved.refs.filter((ref) => p.objectExists(ref));
      if (live.length === 0) return { ok: false, refusal: unavailable("the selection is no longer on the board") };
      return { ok: true, refs: live, bounds: p.boundsNm(live), point: null, label: target.kind === "primary" ? "the selected item" : "the selection" };
    }
    switch (target.kind) {
      case "component": {
        const found = p.componentRef(target.ref);
        if (!found) return { ok: false, refusal: unavailable(`component ${target.ref} is not on the board`) };
        return { ok: true, refs: [found.ref], bounds: p.boundsNm([found.ref]), point: null, label: found.refdes };
      }
      case "object": {
        if (!p.objectExists(target.ref)) return { ok: false, refusal: unavailable(`${target.ref.kind} ${"id" in target.ref ? target.ref.id : `${target.ref.footprintId}:${target.ref.padNumber}`} is not on the board`) };
        return { ok: true, refs: [target.ref], bounds: p.boundsNm([target.ref]), point: null, label: `${target.ref.kind}` };
      }
      case "net": {
        const net = p.net(target);
        if (!net) return { ok: false, refusal: unavailable(`net ${target.name ?? target.netId} has no copper on the board`) };
        const bounds = p.boundsNm(net.refs);
        if (!bounds) return { ok: false, refusal: unavailable(`net ${net.name} has no geometry on the board`) };
        return { ok: true, refs: net.refs, bounds, point: null, label: `net ${net.name}` };
      }
      case "point":
        return { ok: true, refs: [], bounds: null, point: { x: Math.round(target.x), y: Math.round(target.y) }, label: "point" };
      default:
        return { ok: false, refusal: unavailable("unsupported target") };
    }
  };
  const targetPayload = (payload: unknown): { ok: true; value: { target: ViewTarget; selectionDigest?: string } } | { ok: false; message: string } => {
    if (!isObject(payload)) return { ok: false, message: "payload must be an object with a target" };
    const target = validateViewTarget(payload.target);
    if (!target.ok) return target;
    const digest = readSelectionDigest(payload);
    if (!digest.ok) return digest;
    return { ok: true, value: { target: target.value, ...(digest.value !== undefined ? { selectionDigest: digest.value } : {}) } };
  };
  const refsPayload = (payload: unknown): { ok: true; value: { refs?: SelectionRef[]; target?: ViewTarget } } | { ok: false; message: string } => {
    if (!isObject(payload)) return { ok: false, message: "payload must carry refs (selection references) or a target" };
    if (payload.refs !== undefined) {
      if (!Array.isArray(payload.refs) || !payload.refs.every(isSelectionRef)) return { ok: false, message: "refs must be a list of selection references" };
      return { ok: true, value: { refs: payload.refs as SelectionRef[] } };
    }
    const target = validateViewTarget(payload.target);
    if (!target.ok) return target;
    if (isSelectionRelative(target.value)) return { ok: false, message: "a selection command cannot target the selection itself" };
    return { ok: true, value: { target: target.value } };
  };
  const resolveRefs = (value: { refs?: SelectionRef[]; target?: ViewTarget }, context: ViewCommandContext<PcbViewState>): { ok: true; refs: SelectionRef[] } | { ok: false; refusal: ViewCommandOutcome<PcbViewState> } => {
    const p = probe();
    if (!p.hasBoard()) return { ok: false, refusal: unavailable("no board is loaded") };
    if (value.refs) {
      const missing = value.refs.filter((ref) => !p.objectExists(ref));
      if (missing.length > 0) return { ok: false, refusal: unavailable(`${missing.length} referenced object(s) are not on the board`) };
      return { ok: true, refs: value.refs };
    }
    const resolved = resolve(value.target!, context, undefined);
    return resolved.ok ? { ok: true, refs: resolved.refs } : resolved;
  };
  const layerPayload = (payload: unknown): { ok: true; value: { layer: LayerId } } | { ok: false; message: string } => (isObject(payload) && isLayerId(payload.layer) ? { ok: true, value: { layer: payload.layer } } : { ok: false, message: `layer must be one of ${PCB_LAYER_IDS.join(", ")}` });
  const layerOnBoard = (layer: LayerId): boolean => !((layer === "in1" || layer === "in2") && probe().stackup() !== 4);
  const focusCamera = (state: PcbViewState, bounds: BBox | null, point: Vec2 | null): PcbViewState | ViewCommandOutcome<PcbViewState> => {
    if (point) return withCamera(state, { kind: "custom", centerNm: point, pxPerMm: PCB_FOCUS_MAX_PX_PER_MM });
    if (!bounds) return unavailable("the target has no geometry on the board");
    if (!state.observed) return unavailable("the canvas has not reported its size yet");
    return withCamera(state, { kind: "custom", centerNm: center(bounds), pxPerMm: Math.min(fitPxPerMm(bounds, state.observed.viewportPx), PCB_FOCUS_MAX_PX_PER_MM) });
  };
  const netPayload = (p: unknown): { ok: true; value: { netId?: number; name?: string } } | { ok: false; message: string } => (isObject(p) && ((typeof p.netId === "number" && Number.isInteger(p.netId) && p.netId > 0) || (typeof p.name === "string" && p.name.trim().length > 0)) ? { ok: true, value: { ...(typeof p.netId === "number" ? { netId: p.netId } : {}), ...(typeof p.name === "string" ? { name: p.name.trim() } : {}) } } : { ok: false, message: "netId (> 0) or name is required" });
  const measureEnd = (target: ViewTarget, context: ViewCommandContext<PcbViewState>, selectionDigest: string | undefined): { ok: true; end: PcbMeasureEnd } | { ok: false; refusal: ViewCommandOutcome<PcbViewState> } => {
    if (target.kind === "selection" || target.kind === "net") return { ok: false, refusal: { ok: false, refusal: { code: "VS_PAYLOAD_INVALID", message: "a measurement end must be one component, one object, the primary selected item or a point" } } };
    const resolved = resolve(target, context, selectionDigest);
    if (!resolved.ok) return resolved;
    if (target.kind === "point") return { ok: true, end: { kind: "point", atNm: resolved.point! } };
    const ref = resolved.refs[0];
    const at = probe().anchorNm(ref);
    if (!at) return { ok: false, refusal: unavailable(`${resolved.label} has no anchor on the board`) };
    if (target.kind === "component") return { ok: true, end: { kind: "component", ref: resolved.label, atNm: at } };
    return { ok: true, end: { kind: "object", ref, atNm: at } };
  };

  return [
    define<null>({ commandId: "pcb.fit-board", editor: "pcb", title: "Fit the board and every placed footprint", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => (probe().hasBoard() ? { ok: true, state: withCamera(state, { kind: "board", centerNm: null, pxPerMm: null }) } : unavailable("no board is loaded")) }),
    define<{ selectionDigest?: string }>({ commandId: "pcb.fit-selection", editor: "pcb", title: "Fit the current selection (versioned; refuses a stale view)", staleness: "rebase",
      validate: (p) => { const d = readSelectionDigest(isObject(p) ? p : {}); return d.ok ? { ok: true, value: d.value !== undefined ? { selectionDigest: d.value } : {} } : d; },
      apply: (payload, context) => { const r = resolve({ kind: "selection" }, context, payload.selectionDigest); if (!r.ok) return r.refusal; const next = focusCamera(context.state, r.bounds, null); return "ok" in next ? next : { ok: true, state: next }; } }),
    define<{ factor: number }>({ commandId: "pcb.zoom", editor: "pcb", title: "Zoom by a bounded factor (relative — refuses a stale view)", staleness: "refuse",
      validate: (p) => (isObject(p) && typeof p.factor === "number" && Number.isFinite(p.factor) && p.factor >= PCB_ZOOM_FACTOR_MIN && p.factor <= PCB_ZOOM_FACTOR_MAX ? { ok: true, value: { factor: p.factor } } : { ok: false, message: `factor must be a number between ${PCB_ZOOM_FACTOR_MIN} and ${PCB_ZOOM_FACTOR_MAX}` }),
      apply: ({ factor }, { state }) => { if (!state.observed) return unavailable("the canvas has not reported its view yet"); return { ok: true, state: withCamera(state, { kind: "custom", centerNm: state.observed.centerNm, pxPerMm: clamp(state.observed.pxPerMm * factor, PCB_MIN_PX_PER_MM, PCB_MAX_PX_PER_MM) }) }; } }),
    define<{ pxPerMm: number }>({ commandId: "pcb.zoom-to", editor: "pcb", title: "Zoom to an absolute scale (px per mm)", staleness: "rebase",
      validate: (p) => (isObject(p) && typeof p.pxPerMm === "number" && Number.isFinite(p.pxPerMm) && p.pxPerMm > 0 ? { ok: true, value: { pxPerMm: p.pxPerMm } } : { ok: false, message: "pxPerMm must be a positive number" }),
      apply: ({ pxPerMm }, { state }) => ({ ok: true, state: withCamera(state, { kind: "custom", centerNm: state.observed?.centerNm ?? null, pxPerMm: clamp(pxPerMm, PCB_MIN_PX_PER_MM, PCB_MAX_PX_PER_MM) }) }) }),
    define<{ target: ViewTarget; selectionDigest?: string }>({ commandId: "pcb.pan-to", editor: "pcb", title: "Pan to a semantic target (keeps the zoom)", staleness: "rebase", validate: targetPayload,
      apply: ({ target, selectionDigest }, context) => { const r = resolve(target, context, selectionDigest); if (!r.ok) return r.refusal; const at = r.point ?? (r.bounds ? center(r.bounds) : null); if (!at) return unavailable(`${r.label} has no geometry on the board`); return { ok: true, state: withCamera(context.state, { kind: "custom", centerNm: at, pxPerMm: null }) }; } }),
    define<{ target: ViewTarget; selectionDigest?: string }>({ commandId: "pcb.focus", editor: "pcb", title: "Focus a semantic target (centre and frame it)", staleness: "rebase", validate: targetPayload,
      apply: ({ target, selectionDigest }, context) => { const r = resolve(target, context, selectionDigest); if (!r.ok) return r.refusal; const next = focusCamera(context.state, r.bounds, r.point); return "ok" in next ? next : { ok: true, state: next }; } }),
    define<{ refs?: SelectionRef[]; target?: ViewTarget }>({ commandId: "pcb.select", editor: "pcb", title: "Replace the selection", staleness: "rebase", validate: refsPayload,
      apply: (value, context) => { const r = resolveRefs(value, context); if (!r.ok) return r.refusal; const next = viewSelection(r.refs, r.refs[r.refs.length - 1] ?? null); return { ok: true, state: next.digest === context.state.selection.digest ? context.state : { ...context.state, selection: next } }; } }),
    define<{ refs?: SelectionRef[]; target?: ViewTarget }>({ commandId: "pcb.select-add", editor: "pcb", title: "Add to the selection (relative — refuses a stale view)", staleness: "refuse", validate: refsPayload,
      apply: (value, context) => { const r = resolveRefs(value, context); if (!r.ok) return r.refusal; const key = (ref: SelectionRef): string => (ref.kind === "pad" ? `pad:${ref.footprintId}:${ref.padNumber}` : `${ref.kind}:${ref.id}`); const have = new Set(context.state.selection.refs.map(key)); const merged = [...context.state.selection.refs, ...r.refs.filter((ref) => !have.has(key(ref)))]; const next = viewSelection(merged, r.refs[r.refs.length - 1] ?? context.state.selection.primary); return { ok: true, state: next.digest === context.state.selection.digest ? context.state : { ...context.state, selection: next } }; } }),
    define<{ refs?: SelectionRef[]; target?: ViewTarget }>({ commandId: "pcb.select-remove", editor: "pcb", title: "Remove from the selection (relative — refuses a stale view)", staleness: "refuse", validate: refsPayload,
      apply: (value, context) => { const r = resolveRefs(value, context); if (!r.ok) return r.refusal; const key = (ref: SelectionRef): string => (ref.kind === "pad" ? `pad:${ref.footprintId}:${ref.padNumber}` : `${ref.kind}:${ref.id}`); const drop = new Set(r.refs.map(key)); const kept = context.state.selection.refs.filter((ref) => !drop.has(key(ref))); const primary = context.state.selection.primary && !drop.has(key(context.state.selection.primary)) ? context.state.selection.primary : kept[kept.length - 1] ?? null; const next = viewSelection(kept, primary); return { ok: true, state: next.digest === context.state.selection.digest ? context.state : { ...context.state, selection: next } }; } }),
    define<null>({ commandId: "pcb.clear-selection", editor: "pcb", title: "Clear the selection", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => ({ ok: true, state: state.selection.refs.length === 0 ? state : { ...state, selection: viewSelection([], null) } }) }),
    define<{ netId?: number; name?: string }>({ commandId: "pcb.select-net", editor: "pcb", title: "Select every copper item on a net", staleness: "rebase", validate: netPayload,
      apply: (target, { state }) => { const net = probe().net(target); if (!net) return unavailable(`net ${target.name ?? target.netId} has no copper on the board`); const next = viewSelection(net.refs, net.refs[net.refs.length - 1] ?? null); return { ok: true, state: next.digest === state.selection.digest ? state : { ...state, selection: next } }; } }),
    define<{ layer: LayerId; visible: boolean }>({ commandId: "pcb.set-layer-visible", editor: "pcb", title: "Show or hide a layer (explicit target)", staleness: "rebase",
      validate: (p) => { const l = layerPayload(p); if (!l.ok) return l; return isObject(p) && typeof p.visible === "boolean" ? { ok: true, value: { layer: l.value.layer, visible: p.visible } } : { ok: false, message: "visible must be a boolean" }; },
      apply: ({ layer, visible }, { state }) => { if (!layerOnBoard(layer)) return unavailable(`layer ${layer} does not exist on a ${probe().stackup()}-layer board`); return { ok: true, state: state.layers.visible[layer] === visible ? state : { ...state, layers: { ...state.layers, visible: { ...state.layers.visible, [layer]: visible } } } }; } }),
    define<{ layer: LayerId }>({ commandId: "pcb.toggle-layer", editor: "pcb", title: "Toggle a layer (relative — refuses a stale view)", staleness: "refuse", validate: layerPayload,
      apply: ({ layer }, { state }) => { if (!layerOnBoard(layer)) return unavailable(`layer ${layer} does not exist on a ${probe().stackup()}-layer board`); return { ok: true, state: { ...state, layers: { ...state.layers, visible: { ...state.layers.visible, [layer]: !state.layers.visible[layer] } } } }; } }),
    define<{ layer: LayerId }>({ commandId: "pcb.set-active-layer", editor: "pcb", title: "Make a copper layer active", staleness: "rebase", validate: layerPayload,
      apply: ({ layer }, { state }) => { if (!(PCB_COPPER_LAYER_IDS as readonly string[]).includes(layer)) return { ok: false, refusal: { code: "VS_PAYLOAD_INVALID", message: `only a copper layer can be active (${PCB_COPPER_LAYER_IDS.join(", ")})` } }; if (!layerOnBoard(layer)) return unavailable(`layer ${layer} does not exist on a ${probe().stackup()}-layer board`); return { ok: true, state: state.layers.active === layer ? state : { ...state, layers: { ...state.layers, active: layer } } }; } }),
    define<{ layer: LayerId }>({ commandId: "pcb.isolate-layer", editor: "pcb", title: "Show only one layer", staleness: "rebase", validate: layerPayload,
      apply: ({ layer }, { state }) => { if (!layerOnBoard(layer)) return unavailable(`layer ${layer} does not exist on a ${probe().stackup()}-layer board`); const visible = Object.fromEntries(PCB_LAYER_IDS.map((id) => [id, id === layer])) as Record<LayerId, boolean>; return { ok: true, state: { ...state, layers: { ...state.layers, visible } } }; } }),
    define<null>({ commandId: "pcb.show-copper", editor: "pcb", title: "Show every copper layer of the stackup", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => { const visible = { ...state.layers.visible }; for (const id of PCB_COPPER_LAYER_IDS) visible[id] = layerOnBoard(id); return { ok: true, state: { ...state, layers: { ...state.layers, visible } } }; } }),
    define<{ visible: boolean }>({ commandId: "pcb.set-grid", editor: "pcb", title: "Show or hide the grid", staleness: "rebase",
      validate: (p) => (isObject(p) && typeof p.visible === "boolean" ? { ok: true, value: { visible: p.visible } } : { ok: false, message: "visible must be a boolean" }),
      apply: ({ visible }, { state }) => ({ ok: true, state: state.grid === visible ? state : { ...state, grid: visible } }) }),
    define<null>({ commandId: "pcb.toggle-grid", editor: "pcb", title: "Toggle the grid (relative — refuses a stale view)", staleness: "refuse", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => ({ ok: true, state: { ...state, grid: !state.grid } }) }),
    define<{ netId?: number; name?: string }>({ commandId: "pcb.highlight-net", editor: "pcb", title: "Highlight a net's copper (view only)", staleness: "rebase", validate: netPayload,
      apply: (target, { state }) => { const net = probe().net(target); if (!net) return unavailable(`net ${target.name ?? target.netId} has no copper on the board`); return { ok: true, state: { ...state, highlight: { netId: net.netId, name: net.name, refs: net.refs } } }; } }),
    define<null>({ commandId: "pcb.clear-highlight", editor: "pcb", title: "Clear the net highlight", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => ({ ok: true, state: state.highlight ? { ...state, highlight: null } : state }) }),
    define<{ findingId: string }>({ commandId: "pcb.reveal-finding", editor: "pcb", title: "Reveal a DRC violation or routing failure on the canvas", staleness: "rebase",
      validate: (p) => (isObject(p) && typeof p.findingId === "string" && /^(drc|routing):.+$/.test(p.findingId) ? { ok: true, value: { findingId: p.findingId } } : { ok: false, message: "findingId must be drc:<violation id> or routing:<index>" }),
      apply: ({ findingId }, { state }) => { const finding = probe().finding(findingId); if (!finding) return unavailable(`finding ${findingId} is not in the current results`); const revealed: PcbReveal = { findingId, source: finding.source, summary: finding.summary, locationNm: finding.locationNm, itemIds: finding.itemIds, seq: (state.reveal?.seq ?? 0) + 1 }; return { ok: true, state: { ...withCamera(state, { kind: "custom", centerNm: finding.locationNm, pxPerMm: PCB_FOCUS_MAX_PX_PER_MM }), reveal: revealed } }; } }),
    define<{ a: ViewTarget; b: ViewTarget; selectionDigest?: string }>({ commandId: "pcb.measure", editor: "pcb", title: "Measure between two stable objects or points (never a dimension)", staleness: "rebase",
      validate: (p) => { if (!isObject(p)) return { ok: false, message: "payload must carry a and b targets" }; const a = validateViewTarget(p.a); if (!a.ok) return { ok: false, message: `a: ${a.message}` }; const b = validateViewTarget(p.b); if (!b.ok) return { ok: false, message: `b: ${b.message}` }; const d = readSelectionDigest(p); if (!d.ok) return d; return { ok: true, value: { a: a.value, b: b.value, ...(d.value !== undefined ? { selectionDigest: d.value } : {}) } }; },
      apply: ({ a, b, selectionDigest }, context) => { const ea = measureEnd(a, context, selectionDigest); if (!ea.ok) return ea.refusal; const eb = measureEnd(b, context, selectionDigest); if (!eb.ok) return eb.refusal; const dxNm = eb.end.atNm.x - ea.end.atNm.x, dyNm = eb.end.atNm.y - ea.end.atNm.y; const distanceNm = Math.round(Math.hypot(dxNm, dyNm)); return { ok: true, state: { ...context.state, measurement: { a: ea.end, b: eb.end, dxNm, dyNm, distanceNm, distanceMm: Math.round((distanceNm / NM_PER_MM) * 1000) / 1000 } } }; } }),
    define<null>({ commandId: "pcb.clear-measurement", editor: "pcb", title: "Clear the measurement", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => ({ ok: true, state: state.measurement ? { ...state, measurement: null } : state }) }),
    define<null>({ commandId: "pcb.read-state", editor: "pcb", title: "Read the current canvas view state", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => ({ ok: true, state }) }),
    define<{ selection?: { refs: SelectionRef[]; primary: SelectionRef | null }; layers?: { visible: Record<LayerId, boolean>; active: LayerId }; grid?: boolean; camera?: PcbObservedCamera }>({
      commandId: "pcb.observe", editor: "pcb", title: "The editor mirrors what the human changed outside the bus (editor-only)", staleness: "rebase",
      validate: (p) => {
        if (!isObject(p)) return { ok: false, message: "payload must be an object" };
        const out: { selection?: { refs: SelectionRef[]; primary: SelectionRef | null }; layers?: { visible: Record<LayerId, boolean>; active: LayerId }; grid?: boolean; camera?: PcbObservedCamera } = {};
        if (p.selection !== undefined) {
          if (!isObject(p.selection) || !Array.isArray(p.selection.refs) || !p.selection.refs.every(isSelectionRef) || !(p.selection.primary === null || isSelectionRef(p.selection.primary))) return { ok: false, message: "selection must be { refs, primary }" };
          out.selection = { refs: p.selection.refs as SelectionRef[], primary: (p.selection.primary as SelectionRef | null) ?? null };
        }
        if (p.layers !== undefined) {
          if (!isObject(p.layers) || !isObject(p.layers.visible) || !isLayerId(p.layers.active) || !PCB_LAYER_IDS.every((id) => typeof (p.layers as Record<string, Record<string, unknown>>).visible[id] === "boolean")) return { ok: false, message: "layers must be { visible: Record<layer, boolean>, active }" };
          out.layers = { visible: Object.fromEntries(PCB_LAYER_IDS.map((id) => [id, (p.layers as { visible: Record<string, boolean> }).visible[id]])) as Record<LayerId, boolean>, active: p.layers.active };
        }
        if (p.grid !== undefined) { if (typeof p.grid !== "boolean") return { ok: false, message: "grid must be a boolean" }; out.grid = p.grid; }
        if (p.camera !== undefined) {
          if (!isObject(p.camera) || !isVec2(p.camera.centerNm) || typeof p.camera.pxPerMm !== "number" || !Number.isFinite(p.camera.pxPerMm) || p.camera.pxPerMm <= 0 || !isObject(p.camera.viewportPx) || typeof p.camera.viewportPx.width !== "number" || typeof p.camera.viewportPx.height !== "number") return { ok: false, message: "camera must be { centerNm, pxPerMm, viewportPx }" };
          out.camera = { centerNm: { x: p.camera.centerNm.x, y: p.camera.centerNm.y }, pxPerMm: p.camera.pxPerMm, viewportPx: { width: p.camera.viewportPx.width as number, height: p.camera.viewportPx.height as number } };
        }
        return { ok: true, value: out };
      },
      apply: (observed, { state, actor }) => {
        if (actor.actorKind !== "human") return { ok: false, refusal: { code: "VS_ROLE_FORBIDDEN", message: "pcb.observe is the editor's own mirror; an agent cannot assert what the human sees or selects" } };
        let next = state;
        if (observed.selection) { const sel = viewSelection(observed.selection.refs, observed.selection.primary); if (sel.digest !== next.selection.digest) next = { ...next, selection: sel }; }
        if (observed.layers) next = { ...next, layers: observed.layers };
        if (observed.grid !== undefined) next = { ...next, grid: observed.grid };
        if (observed.camera) next = { ...next, observed: observed.camera };
        return { ok: true, state: next };
      } }),
  ];
}
