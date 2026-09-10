"use client";

/**
 * [B17-D] The PCB editor's `pcb` (2D canvas) view session: ONE bus per
 * editor mount. Every navigation, selection, layer, highlight, reveal and
 * measurement entry point — toolbar, palette, context menu, layer panel,
 * inspector, DRC rows, keyboard and (B17-F) agent tools — issues the same
 * `pcb.*` command; the editor APPLIES the resulting view state to its
 * owners (the Pixi scene, the selection store, the layer reducer) and
 * MIRRORS what the human changes outside the bus (a canvas click, a wheel
 * zoom) back through `pcb.observe`, so the bus revision versions the
 * selection an agent may later call "this component".
 *
 * Nothing here is engineering state: a measurement never becomes a
 * dimension, a highlight never edits a net, a selection is view state.
 */
import { useEffect, useRef } from "react";
import type { ProjectRole } from "@/app/lib/engineering/types";
import type { SelectionRef } from "@/app/lib/pcb/edit/commands";
import type { LayerId } from "@/app/lib/pcb/layers";
import type { PcbScene } from "@/app/lib/pcb/render/scene";
import type { SelectionStore } from "@/app/lib/pcb/selection";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { DrcResult } from "@/app/lib/pcb/drc/types";
import type { AutorouteUnresolvedConnection } from "@/app/lib/pcb/autoroute/completion";
import { pcbCommands, pcbInitialState, pcbViewProbe, type PcbViewState } from "@/app/lib/view-session/pcb";
import { selectionDigest, type ViewTarget } from "@/app/lib/view-session/targets";
import type { ViewCommandDescriptor, ViewCommandEnvelope, ViewCommandResult, ViewSessionIdentity } from "@/app/lib/view-session/types";
import { useViewSession, type ViewCommandOk, type ViewCommandRefusal } from "@/app/components/view-session/useViewSession";

export interface PcbViewSessionInput {
  projectId: string;
  branchId: string;
  actorId: string;
  role?: ProjectRole;
  board: PcbBoard | null;
  scene: PcbScene | null;
  selectionStore: SelectionStore;
  /** The editor's layer/grid state and the explicit-value actions the bus applies. */
  layers: { visible: (layer: LayerId) => boolean; active: LayerId; grid: boolean; stackup: 2 | 4 };
  applyLayers: (change: { visible?: Array<{ layer: LayerId; visible: boolean }>; active?: LayerId; grid?: boolean }) => void;
  drc: DrcResult | null;
  routingFailures: readonly AutorouteUnresolvedConnection[] | null;
  /** Flash the revealed items (the DRC hook's transient overlay) — supplied by the editor. */
  flash: (locationNm: { x: number; y: number }, itemIds: string[]) => void;
}

export type PcbViewResult = ViewCommandOk | ViewCommandRefusal;

export interface PcbViewSession {
  view: PcbViewState;
  viewRevision: number;
  command: (commandId: string, payload: unknown) => Promise<PcbViewResult>;
  dispatch: (envelope: ViewCommandEnvelope) => Promise<ViewCommandResult<PcbViewState>>;
  sessionId: string;
  /** [B17-F] the session identity the view-session bridge registers (labels for tracing; never authority). */
  identity: ViewSessionIdentity;
  // Named entry points (the control inventory classifies these callee names).
  fitBoard: () => void;
  fitSelection: () => void;
  zoomBy: (factor: number) => void;
  panTo: (target: ViewTarget) => void;
  focus: (target: ViewTarget) => Promise<PcbViewResult>;
  select: (refs: SelectionRef[]) => void;
  selectTarget: (target: ViewTarget) => Promise<PcbViewResult>;
  selectNet: (net: { netId?: number; name?: string }) => void;
  clearSelection: () => void;
  setLayerVisible: (layer: LayerId, visible: boolean) => void;
  toggleLayer: (layer: LayerId) => void;
  setActiveLayer: (layer: LayerId) => void;
  isolateLayer: (layer: LayerId) => void;
  showCopper: () => void;
  setGrid: (visible: boolean) => void;
  toggleGrid: () => void;
  highlightNet: (net: { netId?: number; name?: string }) => void;
  clearHighlight: () => void;
  revealFinding: (findingId: string) => Promise<PcbViewResult>;
  measure: (a: ViewTarget, b: ViewTarget) => Promise<PcbViewResult>;
  clearMeasurement: () => void;
}

interface Deps { board: PcbBoard | null; drc: DrcResult | null; routingFailures: readonly AutorouteUnresolvedConnection[] | null }
const PCB_INITIAL_STATE = pcbInitialState();
const pcbSessionCommands = (deps: () => Deps): ViewCommandDescriptor<PcbViewState, never>[] => pcbCommands(() => { const d = deps(); return pcbViewProbe({ board: d.board, drc: d.drc, routingFailures: d.routingFailures }); });

const LAYER_IDS: readonly LayerId[] = ["copperTop", "in1", "in2", "copperBottom", "silkTop", "silkBottom", "maskTop", "maskBottom", "pasteTop", "pasteBottom", "edge", "courtyardTop", "courtyardBottom", "fabTop", "fabBottom"];

export function usePcbViewSession(input: PcbViewSessionInput): PcbViewSession {
  const session = useViewSession<PcbViewState, Deps>({
    editor: "pcb",
    projectId: input.projectId,
    branchId: input.branchId,
    actorId: input.actorId,
    role: input.role,
    initialState: PCB_INITIAL_STATE,
    deps: { board: input.board, drc: input.drc, routingFailures: input.routingFailures },
    commands: pcbSessionCommands,
  });
  const { view, command } = session;
  // The latest inputs for effects that must not re-subscribe on every render.
  const latest = useRef(input);
  useEffect(() => { latest.current = input; });

  // ── Apply bus state → owners ────────────────────────────────────────────────
  // Camera intents fly once per sequence number.
  const appliedCameraSeq = useRef(0);
  useEffect(() => {
    const scene = input.scene;
    if (!scene || view.camera.seq === appliedCameraSeq.current) return;
    appliedCameraSeq.current = view.camera.seq;
    if (view.camera.kind === "board") scene.zoomToFit();
    else if (view.camera.centerNm) scene.centerOn(view.camera.centerNm, view.camera.pxPerMm ?? undefined);
  }, [input.scene, view.camera]);
  // Selection: apply when the bus selection differs from the store's.
  useEffect(() => {
    const store = latest.current.selectionStore;
    const current = store.get();
    if (selectionDigest(current.refs, current.primary ?? null) === view.selection.digest) return;
    if (view.selection.refs.length === 0) store.clear();
    else store.replace(view.selection.refs, view.selection.primary ?? undefined);
  }, [view.selection]);
  // Layers and grid: explicit-value actions, only for what differs.
  useEffect(() => {
    const { layers, applyLayers } = latest.current;
    const visible = LAYER_IDS.filter((id) => layers.visible(id) !== view.layers.visible[id]).map((id) => ({ layer: id, visible: view.layers.visible[id] }));
    const change: Parameters<typeof applyLayers>[0] = {};
    if (visible.length > 0) change.visible = visible;
    if (layers.active !== view.layers.active) change.active = view.layers.active;
    if (layers.grid !== view.grid) change.grid = view.grid;
    if (change.visible || change.active !== undefined || change.grid !== undefined) applyLayers(change);
  }, [view.layers, view.grid]);
  // Highlight overlay.
  useEffect(() => { input.scene?.setHighlightRefs(view.highlight?.refs ?? []); }, [input.scene, view.highlight]);
  // Reveal: flash the finding's items once per sequence number (the camera intent already moved).
  const appliedRevealSeq = useRef(0);
  useEffect(() => {
    if (!view.reveal || view.reveal.seq === appliedRevealSeq.current) return;
    appliedRevealSeq.current = view.reveal.seq;
    latest.current.flash(view.reveal.locationNm, view.reveal.itemIds);
  }, [view.reveal]);

  // ── Mirror owners → bus (`pcb.observe`, the editor's own human actor) ──────
  const observe = (payload: Record<string, unknown>): void => { void command("pcb.observe", payload); };
  useEffect(() => {
    const store = input.selectionStore;
    const push = (): void => { const s = store.get(); observe({ selection: { refs: s.refs, primary: s.primary ?? null } }); };
    push();
    return store.subscribe(push);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.selectionStore]);
  const layerKey = LAYER_IDS.map((id) => (input.layers.visible(id) ? "1" : "0")).join("") + "|" + input.layers.active + "|" + (input.layers.grid ? "g" : "-");
  useEffect(() => {
    const visible = Object.fromEntries(LAYER_IDS.map((id) => [id, latest.current.layers.visible(id)])) as Record<LayerId, boolean>;
    observe({ layers: { visible, active: latest.current.layers.active }, grid: latest.current.layers.grid });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerKey]);
  useEffect(() => {
    const scene = input.scene;
    if (!scene) return;
    let frame: number | null = null;
    const push = (): void => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const state = scene.viewState();
        if (state) observe({ camera: state });
      });
    };
    push();
    const off = scene.onViewChange(push);
    return () => { off(); if (frame !== null) cancelAnimationFrame(frame); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.scene]);

  const fire = (commandId: string, payload: unknown): void => { void command(commandId, payload); };
  return {
    view,
    viewRevision: session.viewRevision,
    command,
    dispatch: session.dispatch,
    sessionId: session.sessionId,
    identity: session.identity,
    fitBoard: () => fire("pcb.fit-board", null),
    fitSelection: () => fire("pcb.fit-selection", {}),
    zoomBy: (factor) => fire("pcb.zoom", { factor }),
    panTo: (target) => fire("pcb.pan-to", { target }),
    focus: (target) => command("pcb.focus", { target }),
    select: (refs) => fire("pcb.select", { refs }),
    selectTarget: (target) => command("pcb.select", { target }),
    selectNet: (net) => fire("pcb.select-net", net),
    clearSelection: () => fire("pcb.clear-selection", null),
    setLayerVisible: (layer, visible) => fire("pcb.set-layer-visible", { layer, visible }),
    toggleLayer: (layer) => fire("pcb.toggle-layer", { layer }),
    setActiveLayer: (layer) => fire("pcb.set-active-layer", { layer }),
    isolateLayer: (layer) => fire("pcb.isolate-layer", { layer }),
    showCopper: () => fire("pcb.show-copper", null),
    setGrid: (visible) => fire("pcb.set-grid", { visible }),
    toggleGrid: () => fire("pcb.toggle-grid", null),
    highlightNet: (net) => fire("pcb.highlight-net", net),
    clearHighlight: () => fire("pcb.clear-highlight", null),
    revealFinding: (findingId) => command("pcb.reveal-finding", { findingId }),
    measure: (a, b) => command("pcb.measure", { a, b }),
    clearMeasurement: () => fire("pcb.clear-measurement", null),
  };
}
