/**
 * [B17-D] The `schematic` view-session command set.
 *
 * The schematic canvas shows a sheet (page) at a pan/zoom, one selected
 * component (theory or KiCad family) and, on the bus, a highlighted net (by
 * label name). Targets are stable identities — a reference designator or
 * component id, a sheet point the caller already holds, or the versioned
 * current selection ("this component") — never screen coordinates. The
 * probe answers from the CURRENT sheet or the command settles as a bounded
 * `VS_UNAVAILABLE`. Nothing here touches the schematic: selection and
 * highlight are view state; no canonical command runs.
 *
 * ERC findings: this editor produces none today (design review findings are
 * chat text), so `schematic.reveal-finding` settles unavailable with that
 * exact reason rather than pretending.
 */
import { engineeringDigest } from "../engineering/stable";
import { checkSelectionVersion, isObject, validateViewTarget, type ViewTarget } from "./targets";
import type { ViewCommandContext, ViewCommandDescriptor, ViewCommandOutcome } from "./types";

export interface SheetPoint { x: number; y: number }

/** The canvas' own zoom clamp, reconciled: fit may go down to 0.05, wheel zoom to 0.2; the bus allows the union. */
export const SCHEMATIC_MIN_ZOOM = 0.05;
export const SCHEMATIC_MAX_ZOOM = 4;
export const SCHEMATIC_FOCUS_ZOOM = 2;
export const SCHEMATIC_ZOOM_FACTOR_MIN = 0.25;
export const SCHEMATIC_ZOOM_FACTOR_MAX = 4;

export type SchematicFamily = "theory" | "kicad";

export interface SchematicCameraIntent {
  /** `page`: frame the whole sheet; `custom`: centre a sheet point at a zoom. */
  kind: "page" | "custom";
  centerPx: SheetPoint | null;
  /** null = keep the current zoom. */
  zoom: number | null;
  seq: number;
}

export interface SchematicObservedCamera { pan: SheetPoint; zoom: number; viewportPx: { width: number; height: number } }

export interface SchematicSelection { id: string | null; family: SchematicFamily | null; refdes: string | null; digest: string }

export interface SchematicHighlight { name: string; labelIds: string[] }

export interface SchematicViewState {
  camera: SchematicCameraIntent;
  observed: SchematicObservedCamera | null;
  selection: SchematicSelection;
  highlight: SchematicHighlight | null;
}

export const SCHEMATIC_SELECTION_SCHEMA = "sirkit.schematic-selection.v1" as const;

export function schematicSelection(id: string | null, family: SchematicFamily | null, refdes: string | null): SchematicSelection {
  return { id, family, refdes, digest: engineeringDigest({ schema: SCHEMATIC_SELECTION_SCHEMA, id, family }) };
}

export function schematicInitialState(): SchematicViewState {
  return { camera: { kind: "page", centerPx: null, zoom: null, seq: 0 }, observed: null, selection: schematicSelection(null, null, null), highlight: null };
}

export interface SchematicComponentHit { id: string; family: SchematicFamily; refdes: string; at: SheetPoint }

/** What the commands may ask about — answered from the CURRENT sheet, or null when unavailable. */
export interface SchematicViewProbe {
  hasSheet(): boolean;
  pagePx(): { width: number; height: number };
  /** By reference designator (display ref) or stable id, either family. */
  component(ref: string): SchematicComponentHit | null;
  componentById(id: string): SchematicComponentHit | null;
  /** Net labels sharing a (case-insensitive) name. */
  net(name: string): { name: string; labelIds: string[]; positions: SheetPoint[] } | null;
  /** ERC findings — none exist in this editor today. */
  finding(findingId: string): null;
}

export interface SchematicProbeSources {
  components: ReadonlyArray<{ id: string; x: number; y: number; refDes?: string }>;
  kicadComponents: ReadonlyArray<{ id: string; x: number; y: number; refDes: string }>;
  netLabels: ReadonlyArray<{ id: string; name: string; position: SheetPoint }>;
  pagePx: { width: number; height: number };
}

export function schematicViewProbe(sources: SchematicProbeSources | null): SchematicViewProbe {
  const hit = (ref: string): SchematicComponentHit | null => {
    if (!sources) return null;
    const key = ref.trim().toUpperCase();
    for (const c of sources.components) {
      const display = (c.refDes ?? c.id).trim();
      if (display.toUpperCase() === key || c.id === ref) return { id: c.id, family: "theory", refdes: display, at: { x: c.x, y: c.y } };
    }
    for (const k of sources.kicadComponents) {
      if (k.refDes.trim().toUpperCase() === key || k.id === ref) return { id: k.id, family: "kicad", refdes: k.refDes.trim(), at: { x: k.x, y: k.y } };
    }
    return null;
  };
  return {
    hasSheet: () => sources !== null,
    pagePx: () => sources?.pagePx ?? { width: 0, height: 0 },
    component: hit,
    componentById: (id) => {
      if (!sources) return null;
      const c = sources.components.find((item) => item.id === id);
      if (c) return { id: c.id, family: "theory", refdes: (c.refDes ?? c.id).trim(), at: { x: c.x, y: c.y } };
      const k = sources.kicadComponents.find((item) => item.id === id);
      return k ? { id: k.id, family: "kicad", refdes: k.refDes.trim(), at: { x: k.x, y: k.y } } : null;
    },
    net: (name) => {
      if (!sources) return null;
      const key = name.trim().toUpperCase();
      const labels = sources.netLabels.filter((label) => label.name.trim().toUpperCase() === key);
      return labels.length > 0 ? { name: labels[0].name.trim(), labelIds: labels.map((label) => label.id), positions: labels.map((label) => ({ ...label.position })) } : null;
    },
    finding: () => null,
  };
}

const unavailable = (what: string): ViewCommandOutcome<SchematicViewState> => ({ ok: false, refusal: { code: "VS_UNAVAILABLE", message: `sheet unavailable: ${what}` } });
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

export function schematicCommands(probe: () => SchematicViewProbe): ViewCommandDescriptor<SchematicViewState, never>[] {
  const define = <P,>(descriptor: ViewCommandDescriptor<SchematicViewState, P>): ViewCommandDescriptor<SchematicViewState, never> => descriptor as unknown as ViewCommandDescriptor<SchematicViewState, never>;
  const withCamera = (state: SchematicViewState, camera: Omit<SchematicCameraIntent, "seq">): SchematicViewState => ({ ...state, camera: { ...camera, seq: state.camera.seq + 1 } });
  const targetPayload = (payload: unknown): { ok: true; value: { target: ViewTarget; selectionDigest?: string } } | { ok: false; message: string } => {
    if (!isObject(payload)) return { ok: false, message: "payload must be an object with a target" };
    const target = validateViewTarget(payload.target);
    if (!target.ok) return target;
    if (target.value.kind === "object" || target.value.kind === "net") return { ok: false, message: "a schematic target is a component (by reference designator or id), a sheet point, the selection or the primary item" };
    if (payload.selectionDigest !== undefined && typeof payload.selectionDigest !== "string") return { ok: false, message: "selectionDigest must be a string" };
    return { ok: true, value: { target: target.value, ...(typeof payload.selectionDigest === "string" ? { selectionDigest: payload.selectionDigest } : {}) } };
  };
  /** Resolve a target to a sheet point (and the component, when it is one). */
  const resolve = (target: ViewTarget, context: ViewCommandContext<SchematicViewState>, selectionDigest: string | undefined): { ok: true; at: SheetPoint; component: SchematicComponentHit | null } | { ok: false; refusal: ViewCommandOutcome<SchematicViewState> } => {
    const p = probe();
    if (!p.hasSheet()) return { ok: false, refusal: unavailable("no sheet is open") };
    if (target.kind === "selection" || target.kind === "primary") {
      const stale = checkSelectionVersion({ rebased: context.rebased, expectedSelectionDigest: selectionDigest, currentDigest: context.state.selection.digest });
      if (stale) return { ok: false, refusal: { ok: false, refusal: stale } };
      const id = context.state.selection.id;
      if (!id) return { ok: false, refusal: unavailable("no current selection: 'this component' cannot be resolved") };
      const component = p.componentById(id);
      if (!component) return { ok: false, refusal: unavailable("the selected component is no longer on the sheet") };
      return { ok: true, at: component.at, component };
    }
    if (target.kind === "component") {
      const component = p.component(target.ref);
      if (!component) return { ok: false, refusal: unavailable(`component ${target.ref} is not on the sheet`) };
      return { ok: true, at: component.at, component };
    }
    if (target.kind === "point") return { ok: true, at: { x: target.x, y: target.y }, component: null };
    return { ok: false, refusal: unavailable("unsupported target") };
  };
  return [
    define<null>({ commandId: "schematic.fit-page", editor: "schematic", title: "Fit the sheet to the view", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => (probe().hasSheet() ? { ok: true, state: withCamera(state, { kind: "page", centerPx: null, zoom: null }) } : unavailable("no sheet is open")) }),
    define<{ factor: number }>({ commandId: "schematic.zoom", editor: "schematic", title: "Zoom by a bounded factor (relative — refuses a stale view)", staleness: "refuse",
      validate: (p) => (isObject(p) && typeof p.factor === "number" && Number.isFinite(p.factor) && p.factor >= SCHEMATIC_ZOOM_FACTOR_MIN && p.factor <= SCHEMATIC_ZOOM_FACTOR_MAX ? { ok: true, value: { factor: p.factor } } : { ok: false, message: `factor must be a number between ${SCHEMATIC_ZOOM_FACTOR_MIN} and ${SCHEMATIC_ZOOM_FACTOR_MAX}` }),
      apply: ({ factor }, { state }) => {
        if (!state.observed) return unavailable("the canvas has not reported its view yet");
        const { pan, zoom, viewportPx } = state.observed;
        // The centre of the current view in sheet px: screen centre mapped through pan/zoom.
        const centerPx = { x: (viewportPx.width / 2 - pan.x) / zoom, y: (viewportPx.height / 2 - pan.y) / zoom };
        return { ok: true, state: withCamera(state, { kind: "custom", centerPx, zoom: clamp(zoom * factor, SCHEMATIC_MIN_ZOOM, SCHEMATIC_MAX_ZOOM) }) };
      } }),
    define<{ zoom: number }>({ commandId: "schematic.zoom-to", editor: "schematic", title: "Zoom to an absolute scale", staleness: "rebase",
      validate: (p) => (isObject(p) && typeof p.zoom === "number" && Number.isFinite(p.zoom) && p.zoom > 0 ? { ok: true, value: { zoom: p.zoom } } : { ok: false, message: "zoom must be a positive number" }),
      apply: ({ zoom }, { state }) => {
        const o = state.observed;
        const centerPx = o ? { x: (o.viewportPx.width / 2 - o.pan.x) / o.zoom, y: (o.viewportPx.height / 2 - o.pan.y) / o.zoom } : null;
        return { ok: true, state: withCamera(state, { kind: "custom", centerPx, zoom: clamp(zoom, SCHEMATIC_MIN_ZOOM, SCHEMATIC_MAX_ZOOM) }) };
      } }),
    define<{ target: ViewTarget; selectionDigest?: string }>({ commandId: "schematic.pan-to", editor: "schematic", title: "Pan to a component or sheet point (keeps the zoom)", staleness: "rebase", validate: targetPayload,
      apply: ({ target, selectionDigest }, context) => { const r = resolve(target, context, selectionDigest); if (!r.ok) return r.refusal; return { ok: true, state: withCamera(context.state, { kind: "custom", centerPx: r.at, zoom: null }) }; } }),
    define<{ target: ViewTarget; selectionDigest?: string }>({ commandId: "schematic.focus", editor: "schematic", title: "Focus a component or sheet point (centre it and zoom in)", staleness: "rebase", validate: targetPayload,
      apply: ({ target, selectionDigest }, context) => { const r = resolve(target, context, selectionDigest); if (!r.ok) return r.refusal; return { ok: true, state: withCamera(context.state, { kind: "custom", centerPx: r.at, zoom: Math.max(context.state.observed?.zoom ?? 0, SCHEMATIC_FOCUS_ZOOM) }) }; } }),
    define<{ target: ViewTarget }>({ commandId: "schematic.select", editor: "schematic", title: "Select a component by reference designator or id", staleness: "rebase",
      validate: (p) => { const t = targetPayload(p); if (!t.ok) return t; return t.value.target.kind === "component" ? { ok: true, value: { target: t.value.target } } : { ok: false, message: "select needs a component target" }; },
      apply: ({ target }, { state }) => { if (target.kind !== "component") return unavailable("unsupported target"); const c = probe().component(target.ref); if (!c) return unavailable(`component ${target.ref} is not on the sheet`); const next = schematicSelection(c.id, c.family, c.refdes); return { ok: true, state: next.digest === state.selection.digest ? state : { ...state, selection: next } }; } }),
    define<null>({ commandId: "schematic.clear-selection", editor: "schematic", title: "Clear the selection", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => ({ ok: true, state: state.selection.id === null ? state : { ...state, selection: schematicSelection(null, null, null) } }) }),
    define<{ name: string }>({ commandId: "schematic.highlight-net", editor: "schematic", title: "Highlight a net's labels (view only)", staleness: "rebase",
      validate: (p) => (isObject(p) && typeof p.name === "string" && p.name.trim().length > 0 ? { ok: true, value: { name: p.name.trim() } } : { ok: false, message: "name is required" }),
      apply: ({ name }, { state }) => { const net = probe().net(name); if (!net) return unavailable(`net ${name} has no labels on the sheet`); return { ok: true, state: { ...state, highlight: { name: net.name, labelIds: net.labelIds } } }; } }),
    define<null>({ commandId: "schematic.clear-highlight", editor: "schematic", title: "Clear the net highlight", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => ({ ok: true, state: state.highlight ? { ...state, highlight: null } : state }) }),
    define<{ findingId: string }>({ commandId: "schematic.reveal-finding", editor: "schematic", title: "Reveal an ERC finding (none are produced by this editor today)", staleness: "rebase",
      validate: (p) => (isObject(p) && typeof p.findingId === "string" && p.findingId.length > 0 ? { ok: true, value: { findingId: p.findingId } } : { ok: false, message: "findingId is required" }),
      apply: ({ findingId }) => (probe().finding(findingId) ? unavailable("unreachable") : unavailable(`no ERC findings are produced by the schematic editor; ${findingId} cannot be revealed`)) }),
    define<null>({ commandId: "schematic.read-state", editor: "schematic", title: "Read the current schematic view state", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => ({ ok: true, state }) }),
    define<{ selection?: { id: string | null }; camera?: SchematicObservedCamera }>({ commandId: "schematic.observe", editor: "schematic", title: "The editor mirrors what the human changed outside the bus (editor-only)", staleness: "rebase",
      validate: (p) => {
        if (!isObject(p)) return { ok: false, message: "payload must be an object" };
        const out: { selection?: { id: string | null }; camera?: SchematicObservedCamera } = {};
        if (p.selection !== undefined) { if (!isObject(p.selection) || !(p.selection.id === null || typeof p.selection.id === "string")) return { ok: false, message: "selection must be { id }" }; out.selection = { id: p.selection.id as string | null }; }
        if (p.camera !== undefined) {
          const c = p.camera;
          if (!isObject(c) || !isObject(c.pan) || typeof c.pan.x !== "number" || typeof c.pan.y !== "number" || typeof c.zoom !== "number" || !Number.isFinite(c.zoom) || c.zoom <= 0 || !isObject(c.viewportPx) || typeof c.viewportPx.width !== "number" || typeof c.viewportPx.height !== "number") return { ok: false, message: "camera must be { pan, zoom, viewportPx }" };
          out.camera = { pan: { x: c.pan.x as number, y: c.pan.y as number }, zoom: c.zoom, viewportPx: { width: c.viewportPx.width as number, height: c.viewportPx.height as number } };
        }
        return { ok: true, value: out };
      },
      apply: (observed, { state, actor }) => {
        if (actor.actorKind !== "human") return { ok: false, refusal: { code: "VS_ROLE_FORBIDDEN", message: "schematic.observe is the editor's own mirror; an agent cannot assert what the human sees or selects" } };
        let next = state;
        if (observed.selection) {
          const c = observed.selection.id ? probe().componentById(observed.selection.id) : null;
          const sel = c ? schematicSelection(c.id, c.family, c.refdes) : schematicSelection(observed.selection.id, null, null);
          if (sel.digest !== next.selection.digest) next = { ...next, selection: sel };
        }
        if (observed.camera) next = { ...next, observed: observed.camera };
        return { ok: true, state: next };
      } }),
  ];
}
