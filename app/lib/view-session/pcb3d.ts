/**
 * [B17-C] The `pcb3d` view-session command set.
 *
 * Everything the 3D preview shows is VIEW state on the bus: whether the view
 * is open, the camera (preset or a focus target), what is focused, which
 * scene layers are visible (top and bottom silkscreen INDEPENDENTLY, mask,
 * copper, zones, vias, footprints, reference labels, substrate) and the
 * visual finish. Geometry questions (where is J1, where is the selection,
 * where is net GND) are answered by a probe over the CURRENT board in scene
 * millimetres; when the probe cannot answer, the command settles as a bounded
 * `VS_UNAVAILABLE` refusal ("model/geometry unavailable") instead of
 * pretending the focus succeeded. No command here touches the board.
 */
import { refBBox } from "../pcb/edit/arrange";
import type { SelectionRef } from "../pcb/edit/commands";
import { toMm } from "../pcb/3d/convert";
import { DEFAULT_PALETTE_ID, PALETTES, type PaletteId } from "../pcb/3d/palette";
import type { PcbBoard } from "../pcb/types";
import type { ViewCommandDescriptor, ViewCommandOutcome } from "./types";

export const PCB3D_CAMERA_PRESETS = ["top", "bottom", "iso"] as const;
export type Pcb3dCameraPreset = (typeof PCB3D_CAMERA_PRESETS)[number];

export const PCB3D_LAYERS = ["silkTop", "silkBottom", "mask", "copper", "zones", "vias", "footprints", "refdes", "substrate"] as const;
export type Pcb3dLayer = (typeof PCB3D_LAYERS)[number];

export interface SceneBoundsMm { minX: number; minY: number; maxX: number; maxY: number }

export interface Pcb3dCamera {
  /** A named preset, or `custom` after a focus. */
  preset: Pcb3dCameraPreset | "custom";
  /** Scene-mm target the camera looks at (board centre for presets, the focus centre after a focus). */
  targetMm: { x: number; y: number; z: number };
  /** Framing distance in scene mm (board span for presets, focus span for a focus). */
  distanceMm: number;
  /** Increments on every camera command so the renderer flies even to the same preset again. */
  seq: number;
}

export type Pcb3dFocus =
  | { kind: "component"; ref: string; boundsMm: SceneBoundsMm }
  | { kind: "selection"; refs: SelectionRef[]; boundsMm: SceneBoundsMm }
  | { kind: "net"; netId: number; name: string; boundsMm: SceneBoundsMm };

export interface Pcb3dViewState {
  open: boolean;
  camera: Pcb3dCamera;
  focus: Pcb3dFocus | null;
  layers: Record<Pcb3dLayer, boolean>;
  finish: PaletteId;
}

export const PCB3D_DEFAULT_LAYERS: Readonly<Record<Pcb3dLayer, boolean>> = Object.freeze({ silkTop: true, silkBottom: true, mask: true, copper: true, zones: true, vias: true, footprints: true, refdes: true, substrate: true });

export function pcb3dInitialState(finish: PaletteId = DEFAULT_PALETTE_ID): Pcb3dViewState {
  return { open: false, camera: { preset: "iso", targetMm: { x: 0, y: 0, z: 0 }, distanceMm: 0, seq: 0 }, focus: null, layers: { ...PCB3D_DEFAULT_LAYERS }, finish };
}

/** Geometry the commands may ask about — answered from the CURRENT board in scene mm, or null when unavailable. */
export interface Pcb3dGeometryProbe {
  boardBoundsMm(): SceneBoundsMm | null;
  componentBoundsMm(ref: string): SceneBoundsMm | null;
  selectionBoundsMm(refs: readonly SelectionRef[]): SceneBoundsMm | null;
  netBoundsMm(net: { netId?: number; name?: string }): { netId: number; name: string; boundsMm: SceneBoundsMm } | null;
}

function toSceneBounds(nm: { minX: number; minY: number; maxX: number; maxY: number }): SceneBoundsMm {
  const a = toMm({ x: nm.minX, y: nm.minY }), b = toMm({ x: nm.maxX, y: nm.maxY });
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

function union(a: SceneBoundsMm | null, b: SceneBoundsMm): SceneBoundsMm {
  return a ? { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) } : b;
}

/** The probe over a board (pure; the React host re-creates it when the board changes). */
export function boardGeometryProbe(board: PcbBoard | null): Pcb3dGeometryProbe {
  const bounds = (refs: readonly SelectionRef[]): SceneBoundsMm | null => {
    if (!board) return null;
    let box: SceneBoundsMm | null = null;
    for (const ref of refs) {
      const b = refBBox(board, ref);
      if (b) box = union(box, toSceneBounds(b));
    }
    return box;
  };
  return {
    boardBoundsMm: () => {
      if (!board) return null;
      const outline = board.outline;
      if (outline.kind === "rect") return toSceneBounds({ minX: outline.origin.x, minY: outline.origin.y, maxX: outline.origin.x + outline.width, maxY: outline.origin.y + outline.height });
      const points = (outline as { points?: Array<{ x: number; y: number }> }).points ?? [];
      if (points.length === 0) return null;
      return toSceneBounds({ minX: Math.min(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxX: Math.max(...points.map((p) => p.x)), maxY: Math.max(...points.map((p) => p.y)) });
    },
    componentBoundsMm: (ref) => {
      if (!board) return null;
      const footprint = board.footprints.find((item) => item.ref === ref || item.id === ref);
      return footprint ? bounds([{ kind: "footprint", id: footprint.id }]) : null;
    },
    selectionBoundsMm: (refs) => bounds(refs),
    netBoundsMm: ({ netId, name }) => {
      if (!board) return null;
      const net = board.nets.find((item) => (netId !== undefined ? item.id === netId : false) || (name !== undefined ? item.name === name || item.name === `/root/${name}` || item.name.endsWith(`/${name}`) : false));
      if (!net || net.id === 0) return null;
      const refs: SelectionRef[] = [
        ...board.tracks.filter((track) => track.netId === net.id).map((track) => ({ kind: "track" as const, id: track.id })),
        ...board.vias.filter((via) => via.netId === net.id).map((via) => ({ kind: "via" as const, id: via.id })),
      ];
      let box = bounds(refs);
      for (const footprint of board.footprints) {
        if (!Object.values(footprint.padNets).includes(net.id)) continue;
        const fb = refBBox(board, { kind: "footprint", id: footprint.id });
        if (fb) box = union(box, toSceneBounds(fb));
      }
      return box ? { netId: net.id, name: net.name, boundsMm: box } : null;
    },
  };
}

function framing(bounds: SceneBoundsMm): { targetMm: Pcb3dCamera["targetMm"]; distanceMm: number } {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 4);
  return { targetMm: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, z: 0 }, distanceMm: span * 1.25 };
}

const unavailable = (what: string): ViewCommandOutcome<Pcb3dViewState> => ({ ok: false, refusal: { code: "VS_UNAVAILABLE", message: `model/geometry unavailable: ${what}` } });
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isSelectionRef = (value: unknown): value is SelectionRef => isObject(value) && typeof value.kind === "string" && (value.kind === "pad" ? typeof value.footprintId === "string" && typeof value.padNumber === "string" : typeof value.id === "string" && ["via", "track", "zone", "text", "footprint", "dimension"].includes(value.kind));

/** The command descriptors; `probe()` returns the current board's geometry probe (null while no board is loaded). */
export function pcb3dCommands(probe: () => Pcb3dGeometryProbe | null): ViewCommandDescriptor<Pcb3dViewState, never>[] {
  const cameraTo = (state: Pcb3dViewState, preset: Pcb3dCamera["preset"], bounds: SceneBoundsMm, focus: Pcb3dFocus | null): Pcb3dViewState => {
    const frame = framing(bounds);
    return { ...state, camera: { preset, targetMm: frame.targetMm, distanceMm: frame.distanceMm, seq: state.camera.seq + 1 }, focus };
  };
  const boardOrUnavailable = (): SceneBoundsMm | ViewCommandOutcome<Pcb3dViewState> => probe()?.boardBoundsMm() ?? unavailable("no board is loaded");
  const define = <P,>(descriptor: ViewCommandDescriptor<Pcb3dViewState, P>): ViewCommandDescriptor<Pcb3dViewState, never> => descriptor as unknown as ViewCommandDescriptor<Pcb3dViewState, never>;
  return [
    define<null>({ commandId: "pcb3d.open", editor: "pcb3d", title: "Open the 3D view", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => ({ ok: true, state: state.open ? state : { ...state, open: true } }) }),
    define<null>({ commandId: "pcb3d.close", editor: "pcb3d", title: "Close the 3D view", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => ({ ok: true, state: state.open ? { ...state, open: false } : state }) }),
    define<{ preset: Pcb3dCameraPreset }>({ commandId: "pcb3d.camera-preset", editor: "pcb3d", title: "Camera preset (top / bottom / isometric)", staleness: "rebase",
      validate: (p) => (isObject(p) && typeof p.preset === "string" && (PCB3D_CAMERA_PRESETS as readonly string[]).includes(p.preset) ? { ok: true, value: { preset: p.preset as Pcb3dCameraPreset } } : { ok: false, message: `preset must be one of ${PCB3D_CAMERA_PRESETS.join(", ")}` }),
      apply: ({ preset }, { state }) => { const b = boardOrUnavailable(); if ("ok" in b) return b; return { ok: true, state: cameraTo(state, preset, state.focus?.boundsMm ?? b, state.focus) }; } }),
    define<null>({ commandId: "pcb3d.fit-board", editor: "pcb3d", title: "Fit the whole board", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => { const b = boardOrUnavailable(); if ("ok" in b) return b; return { ok: true, state: cameraTo(state, state.camera.preset === "custom" ? "iso" : state.camera.preset, b, null) }; } }),
    define<null>({ commandId: "pcb3d.reset-camera", editor: "pcb3d", title: "Reset the camera (isometric, whole board)", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => { const b = boardOrUnavailable(); if ("ok" in b) return b; return { ok: true, state: cameraTo(state, "iso", b, null) }; } }),
    define<{ ref: string }>({ commandId: "pcb3d.focus-component", editor: "pcb3d", title: "Focus a component by reference designator or id", staleness: "rebase",
      validate: (p) => (isObject(p) && typeof p.ref === "string" && p.ref.trim().length > 0 ? { ok: true, value: { ref: p.ref.trim() } } : { ok: false, message: "ref (reference designator or footprint id) is required" }),
      apply: ({ ref }, { state }) => { const b = probe()?.componentBoundsMm(ref); if (!b) return unavailable(`component ${ref} is not on the board`); return { ok: true, state: cameraTo(state, "custom", b, { kind: "component", ref, boundsMm: b }) }; } }),
    define<{ refs: SelectionRef[] }>({ commandId: "pcb3d.focus-selection", editor: "pcb3d", title: "Focus the current selection", staleness: "rebase",
      validate: (p) => (isObject(p) && Array.isArray(p.refs) && p.refs.every(isSelectionRef) ? { ok: true, value: { refs: p.refs as SelectionRef[] } } : { ok: false, message: "refs must be a list of selection references" }),
      apply: ({ refs }, { state }) => { if (refs.length === 0) return unavailable("nothing is selected"); const b = probe()?.selectionBoundsMm(refs); if (!b) return unavailable("the selection has no geometry on the board"); return { ok: true, state: cameraTo(state, "custom", b, { kind: "selection", refs, boundsMm: b }) }; } }),
    define<{ netId?: number; name?: string }>({ commandId: "pcb3d.focus-net", editor: "pcb3d", title: "Focus a net when it has geometry", staleness: "rebase",
      validate: (p) => (isObject(p) && ((typeof p.netId === "number" && Number.isInteger(p.netId) && p.netId > 0) || (typeof p.name === "string" && p.name.trim().length > 0)) ? { ok: true, value: { ...(typeof p.netId === "number" ? { netId: p.netId } : {}), ...(typeof p.name === "string" ? { name: p.name.trim() } : {}) } } : { ok: false, message: "netId (> 0) or name is required" }),
      apply: (target, { state }) => { const n = probe()?.netBoundsMm(target); if (!n) return unavailable(`net ${target.name ?? target.netId} has no geometry on the board`); return { ok: true, state: cameraTo(state, "custom", n.boundsMm, { kind: "net", netId: n.netId, name: n.name, boundsMm: n.boundsMm }) }; } }),
    define<{ layer: Pcb3dLayer; visible: boolean }>({ commandId: "pcb3d.set-layer-visible", editor: "pcb3d", title: "Show or hide a scene layer (explicit target)", staleness: "rebase",
      validate: (p) => (isObject(p) && typeof p.layer === "string" && (PCB3D_LAYERS as readonly string[]).includes(p.layer) && typeof p.visible === "boolean" ? { ok: true, value: { layer: p.layer as Pcb3dLayer, visible: p.visible } } : { ok: false, message: `layer must be one of ${PCB3D_LAYERS.join(", ")} and visible a boolean` }),
      apply: ({ layer, visible }, { state }) => ({ ok: true, state: state.layers[layer] === visible ? state : { ...state, layers: { ...state.layers, [layer]: visible } } }) }),
    define<{ layer: Pcb3dLayer }>({ commandId: "pcb3d.toggle-layer", editor: "pcb3d", title: "Toggle a scene layer (relative — refuses a stale view)", staleness: "refuse",
      validate: (p) => (isObject(p) && typeof p.layer === "string" && (PCB3D_LAYERS as readonly string[]).includes(p.layer) ? { ok: true, value: { layer: p.layer as Pcb3dLayer } } : { ok: false, message: `layer must be one of ${PCB3D_LAYERS.join(", ")}` }),
      apply: ({ layer }, { state }) => ({ ok: true, state: { ...state, layers: { ...state.layers, [layer]: !state.layers[layer] } } }) }),
    define<{ finish: PaletteId }>({ commandId: "pcb3d.set-finish", editor: "pcb3d", title: "Visual finish / palette (a workspace preference; never a stackup change)", staleness: "rebase",
      persist: { scope: "workspace-preference", keys: ["finish"], project: (state) => ({ finish: state.finish }) },
      validate: (p) => (isObject(p) && typeof p.finish === "string" && p.finish in PALETTES ? { ok: true, value: { finish: p.finish as PaletteId } } : { ok: false, message: `finish must be one of ${Object.keys(PALETTES).join(", ")}` }),
      apply: ({ finish }, { state }) => ({ ok: true, state: state.finish === finish ? state : { ...state, finish } }) }),
    define<null>({ commandId: "pcb3d.read-state", editor: "pcb3d", title: "Read the current 3D view state", staleness: "rebase", validate: () => ({ ok: true, value: null }),
      apply: (_p, { state }) => ({ ok: true, state }) }),
  ];
}
