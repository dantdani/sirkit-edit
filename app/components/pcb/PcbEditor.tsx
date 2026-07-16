"use client";

/**
 * PCB editor shell. Stage 3 built the canvas + panels; Stage 4 wires the
 * schematic → board bridge: empty-state "Schematic → PCB" CTA, a
 * toolbar Sync button (badged when the schematic drifted from the last sync),
 * automatic footprint resolution, and board persistence on the project's
 * `pcb` field (750 ms debounce). No manual assignment drawer is mounted.
 *
 * The bundled demo board stays reachable via `?pcbdemo=` (`=high` for the
 * perf build) and NEVER persists.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { produce } from "immer";
import dynamic from "next/dynamic";
import { CircuitBoard, Loader2, ShieldCheck, X } from "lucide-react";
import type { SchematicState } from "@/lib/schematic-types";
import type { PcbBoard, BoardOutline, RoutingPreferences } from "@/app/lib/pcb/types";
import { LAYERS, type LayerId } from "@/app/lib/pcb/layers";
import type { PcbScene, ScenePointerEvent } from "@/app/lib/pcb/render/scene";
import { bboxUnion } from "@/app/lib/pcb/geometry";
import { localCourtyardBBox, worldCourtyardBBox } from "@/app/lib/pcb/autoplace/geometry";
import { mmToNm } from "@/app/lib/pcb/units";
import { applyHandleDrag } from "@/app/lib/pcb/render/outline";
import type { OutlineHandleId } from "@/app/lib/pcb/render/pick";
import { buildDemoBoard } from "@/app/lib/pcb/demo/demo-board";
import {
  buildNetlist,
  netlistHash,
  syncFromSchematic,
  type PcbNetlist,
  type SyncOptions,
  type SyncReport,
} from "@/app/lib/pcb/netlist-bridge";
import { loadCurrentBoard, saveCurrentBoard } from "@/app/lib/pcb/board-persistence";
import { createHistory, type PcbHistory, type PcbHistoryRecord } from "@/app/lib/pcb/history";
import {
  createSelectMoveTool,
  type SelectMoveTool,
  type ContextMenuRequest,
} from "@/app/lib/pcb/tools/select-move";
import { createSelectionStore } from "@/app/lib/pcb/selection"; // Stage 17
import { selectSimilar, selectNet, getItems } from "@/app/lib/pcb/selection-queries"; // Stage 17
import { applyEdits, liveRefs, selectionBBoxCenter } from "@/app/lib/pcb/edit/apply"; // Stage 17
import type { EditCommand, SelectionRef } from "@/app/lib/pcb/edit/commands"; // Stage 17
import { ContextMenu, type ContextMenuItem } from "./ContextMenu"; // Stage 17
import { Inspector } from "./Inspector"; // Stage 17 Phase B
import { ensureBoardPadstacks } from "@/app/lib/pcb/padstack/migrate"; // Stage 17 Phase C
import { PadstackPanel } from "./PadstackPanel"; // Stage 17 Phase C
import { CommandPalette, type PaletteAction } from "./CommandPalette"; // Stage 17 Phase D
import { AssistBox } from "./AssistBox"; // Stage 17 Phase D
import { ARRANGE_GRID_NM, movableRefs } from "./inspectors/ArrangeSection"; // Stage 17 Phase D
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo"; // Stage 7 integration
import { buildSmartRoutingDemo } from "@/app/lib/pcb/demo/smart-routing-demo";
import { buildStoryDemo } from "@/app/lib/pcb/demo/story-demo"; // Stage 16
import { useRouteTool } from "./hooks/useRouteTool"; // Stage 7 integration
import { useNetClass } from "./hooks/useNetClass";
import { useAutoroute } from "./hooks/useAutoroute"; // Stage 9 integration
import { useAutoPlace } from "./hooks/useAutoPlace"; // Stage 8 integration
import { useDrc } from "./hooks/useDrc"; // Stage 12 integration
import { usePcbRepair } from "./hooks/usePcbRepair";
import { useZoneFills } from "./hooks/useZoneFills"; // Stage 11 integration
import { ZoneTool, AddPlaneDialog } from "./ZoneTool"; // Stage 11
import { makePlaneZone } from "@/app/lib/pcb/zones/plane"; // Stage 11
import { mutateBoardWithZoneCommand, zoneCommandLabel, type ZoneCommand } from "@/app/lib/pcb/zones/command"; // Stage 11
import { downloadKicadPcb } from "@/app/lib/pcb/kicad/export-client"; // Stage 13 integration
import { FabDialog } from "./FabDialog"; // Stage 14
import { useFabExport } from "./hooks/useFabExport"; // Stage 14
import { SilkTool } from "./SilkTool"; // Stage 16
import { useSilkTool } from "./hooks/useSilkTool"; // Stage 16
import { ShortcutsHelp } from "./ShortcutsHelp"; // Stage 16
import { useShortcutsHelp } from "./hooks/useShortcutsHelp"; // Stage 16
import { EmptyState } from "./EmptyState"; // Stage 16
import { DrcPanel } from "./DrcPanel"; // Stage 12
import { getPreset } from "@/app/lib/pcb/drc/presets"; // Stage 12
import { runDrc } from "@/app/lib/pcb/drc/run-drc";
import { getCachedPart, ensurePartLoaded, subscribeToPart } from "@/app/lib/parts-cache";
import { PcbCanvas } from "./PcbCanvas";
import { LayerPanel } from "./LayerPanel";
import { PcbToolbar } from "./PcbToolbar";
import { DebugHud } from "./DebugHud";
import { SyncButton } from "./SyncButton";
import { SyncPlacementDialog } from "./SyncPlacementDialog";
import { RoutingControls } from "./RoutingControls";
import { RoutingRulesPanel } from "./RoutingRulesPanel";
import { AutorouteSetup } from "./AutorouteSetup";
import { PlacementSetup } from "./PlacementSetup";
import { stackupProfile } from "@/app/lib/pcb/stackup";

// Stage 15: 3D preview is client-only and heavy (three.js) — lazy chunk.
const PcbPreview3D = dynamic(
  () => import("./PcbPreview3D").then((m) => m.PcbPreview3D),
  { ssr: false },
);

// ─── State ───────────────────────────────────────────────────────────────────

interface EditorState {
  board: PcbBoard | null; // null = no board yet → empty-state CTA
  activeLayer: LayerId;
  /** Overrides on top of LAYERS defaultVisible. */
  visibleOverrides: Partial<Record<LayerId, boolean>>;
  // Stage 17: selection moved out of React into the global SelectionStore
  // (app/lib/pcb/selection.ts) — the tool, scene overlay and inspector share it.
  tool: "select" | "pan" | "route" | "zone" | "silk"; // Stages 7/11/16 add route/zone/silk
  gridOn: boolean;
}

type EditorAction =
  | { type: "set-board"; board: PcbBoard }
  | { type: "set-outline"; outline: BoardOutline }
  | { type: "set-stackup"; stackup: 2 | 4 }
  | { type: "toggle-layer"; layer: LayerId }
  | { type: "isolate-layer"; layer: LayerId }
  | { type: "show-copper" }
  | { type: "set-active-layer"; layer: LayerId }
  | { type: "set-tool"; tool: "select" | "pan" | "route" | "zone" | "silk" } // Stages 7 + 11 + 16
  | { type: "toggle-grid" };

const DEFAULT_VISIBLE: Record<LayerId, boolean> = Object.fromEntries(
  LAYERS.map((l) => [l.id, l.defaultVisible]),
) as Record<LayerId, boolean>;

function reducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "set-board":
      return { ...state, board: action.board };
    case "set-outline":
      if (!state.board) return state;
      // Same footprints array reference — the scene fast-paths this rebuild.
      return { ...state, board: { ...state.board, outline: action.outline } };
    case "set-stackup":
      if (!state.board) return state;
      return {
        ...state,
        board: {
          ...state.board,
          stackup: action.stackup,
          stackupConfig: stackupProfile(action.stackup === 4 ? "all-signal-4" : "simple-2"),
        },
      };
    case "toggle-layer": {
      const current = state.visibleOverrides[action.layer] ?? DEFAULT_VISIBLE[action.layer];
      return {
        ...state,
        visibleOverrides: { ...state.visibleOverrides, [action.layer]: !current },
      };
    }
    case "isolate-layer":
      return {
        ...state,
        visibleOverrides: Object.fromEntries(LAYERS.map((layer) => [layer.id, layer.id === action.layer])),
      };
    case "show-copper": {
      const next = { ...state.visibleOverrides };
      for (const layer of LAYERS) {
        if (layer.kind === "copper") next[layer.id] = state.board?.stackup === 4 || (layer.id !== "in1" && layer.id !== "in2");
      }
      return { ...state, visibleOverrides: next };
    }
    case "set-active-layer":
      return { ...state, activeLayer: action.layer };
    case "set-tool":
      return { ...state, tool: action.tool };
    case "toggle-grid":
      return { ...state, gridOn: !state.gridOn };
  }
}

function makeEditorState(board: PcbBoard | null): EditorState {
  return {
    board,
    activeLayer: "copperTop",
    visibleOverrides: {},
    tool: "select",
    gridOn: true,
  };
}

function formatSyncToast(report: SyncReport): string {
  const placed = report.added.length - report.unresolved.length + report.kept.length;
  const parts = [`${placed} placed`];
  if (report.resolvedBy.hint > 0) parts.push(`${report.resolvedBy.hint} by hint`);
  if (report.resolvedBy.heuristic > 0) parts.push(`${report.resolvedBy.heuristic} by package`);
  if (report.removed.length > 0) parts.push(`${report.removed.length} removed`);
  if (report.unresolved.length > 0) parts.push(`${report.unresolved.length} skipped — missing footprint metadata`);
  if (report.added.length > 0) parts.push(report.placement.mode === "centered" ? "new parts centered" : "coordinates preserved");
  if (report.placement.warning) parts.push(report.placement.warning);
  return parts.join(" · ");
}

// ─── Component ───────────────────────────────────────────────────────────────

function replaceBoardContents(target: PcbBoard, source: PcbBoard): void {
  const targetRecord = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(targetRecord)) {
    if (!(key in source)) delete targetRecord[key];
  }
  Object.assign(target, source);
}

interface HistoryView {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  entries: readonly PcbHistoryRecord[];
}

function historyView(history: PcbHistory): HistoryView {
  return {
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    ...(history.undoLabel ? { undoLabel: history.undoLabel } : {}),
    ...(history.redoLabel ? { redoLabel: history.redoLabel } : {}),
    entries: history.entries,
  };
}

export default function PcbEditor({ schematic }: { schematic: SchematicState }) {
  // One-shot init: demo board via ?pcbdemo= (never persisted), otherwise the
  // current project's saved board (or none → empty state).
  const [init] = useState(() => {
    const demoParam =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("pcbdemo")
        : null;
    if (demoParam !== null) {
      // Stage 7: ?pcbdemo=routed loads the hand-routed fixture; Phase-1 Smart
      // Route: =smart-route loads the reproducible CW/CCW blocker fixture;
      // Stage 16: =story loads the five-click demo start (unplaced ESP32
      // breakout); =high/default keep Stage 3's grid demo.
      const board =
        demoParam === "routed"
          ? buildRoutedDemo()
          : demoParam === "smart-route"
            ? buildSmartRoutingDemo()
          : demoParam === "story"
            ? buildStoryDemo()
            : buildDemoBoard(demoParam === "high" ? "high" : "default");
      ensureBoardPadstacks(board); // Stage 17 — demos bypass board-persistence
      return { board, demo: true, lastSyncHash: null as string | null };
    }
    const { board, lastSyncHash } = loadCurrentBoard();
    return { board, demo: false, lastSyncHash };
  });

  const [state, dispatch] = useReducer(reducer, init.board, makeEditorState);
  const [scene, setScene] = useState<PcbScene | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [placementWarning, setPlacementWarning] = useState<string | null>(null);
  const [lastSyncHash, setLastSyncHash] = useState<string | null>(init.lastSyncHash);
  const [netlist, setNetlist] = useState<PcbNetlist | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Refs so the (stable) pointer callback sees current values without resubscribing.
  const boardRef = useRef(state.board);
  const toolRef = useRef(state.tool);
  const dragRef = useRef<OutlineHandleId | null>(null);
  const schematicRef = useRef(schematic);
  useEffect(() => {
    boardRef.current = state.board;
    toolRef.current = state.tool;
    schematicRef.current = schematic;
  }, [state.board, state.tool, schematic]);

  // Stage 17: the global selection store — synchronous, shared by the
  // select-move tool, the scene overlay and (Phase B) the inspector.
  const [selectionStore] = useState(() => createSelectionStore());
  // Stage 17: right-click context menu (select-move emits the request).
  const [ctxMenu, setCtxMenu] = useState<ContextMenuRequest | null>(null);

  // Stage 5: undo/redo history + select/move tool (see app/lib/pcb/history.ts
  // and app/lib/pcb/tools/select-move.ts).
  const historyRef = useRef<PcbHistory | null>(null);
  const [visibleHistory, setVisibleHistory] = useState<HistoryView>({ canUndo: false, canRedo: false, entries: [] });
  const moveToolRef = useRef<SelectMoveTool | null>(null);
  const historyCleanupRef = useRef<(() => void) | null>(null);

  const handleSceneReady = useCallback((s: PcbScene | null) => setScene(s), []);

  // ── Toast auto-dismiss ─────────────────────────────────────────────────────
  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Dirty badge: netlist hash vs last synced hash ──────────────────────────
  // Re-hash when async part data lands (getCachedPart triggers loads).
  const [partsTick, setPartsTick] = useState(0);
  useEffect(() => {
    const ids = [...new Set((schematic.kicadComponents ?? []).map((k) => k.partId))];
    const unsubs = ids.map((id) => subscribeToPart(id, () => setPartsTick((t) => t + 1)));
    return () => unsubs.forEach((u) => u());
  }, [schematic.kicadComponents]);

  const currentHash = useMemo(() => {
    void partsTick; // re-run when a part loads
    try {
      return netlistHash(buildNetlist(schematic, getCachedPart));
    } catch {
      return null;
    }
  }, [schematic, partsTick]);
  const dirty =
    state.board !== null &&
    !init.demo &&
    currentHash !== null &&
    currentHash !== lastSyncHash;

  // ── Persistence: debounced 750 ms, flush on unmount, never for the demo ───
  const pendingSaveRef = useRef<{ board: PcbBoard; hash: string | null } | null>(null);
  useEffect(() => {
    if (init.demo || !state.board) return;
    pendingSaveRef.current = { board: state.board, hash: lastSyncHash };
    const t = setTimeout(() => {
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (!pending) return;
      if (!saveCurrentBoard(pending.board, schematicRef.current, pending.hash)) {
        setToast("Couldn't save the board — browser storage is full or unavailable.");
      }
    }, 750);
    return () => clearTimeout(t);
  }, [init.demo, state.board, lastSyncHash]);
  useEffect(
    () => () => {
      const pending = pendingSaveRef.current;
      if (pending) saveCurrentBoard(pending.board, schematicRef.current, pending.hash);
    },
    [],
  );

  // ── Sync (also the empty-state CTA) ────────────────────────────────────────
  const handleSync = useCallback(async (placement?: NonNullable<SyncOptions["placement"]>) => {
    if (syncing) return;
    setSyncing(true);
    try {
      const s = schematicRef.current;
      // Part catalog data must be in the cache before buildNetlist runs.
      await Promise.allSettled(
        [...new Set((s.kicadComponents ?? []).map((k) => k.partId))].map((id) =>
          ensurePartLoaded(id),
        ),
      );
      const { board, report, netlist } = await syncFromSchematic(
        s,
        boardRef.current ?? undefined,
        { getPart: getCachedPart, placement },
      );
      // Stage 17 — sync results bypass board-persistence; the synced board can
      // share frozen (immer) subtrees with the previous one, so migrate a draft.
      const migrated = produce(board, (d) => void ensureBoardPadstacks(d));
      const history = historyRef.current;
      if (history && boardRef.current && history.present === boardRef.current) {
        history.execute("Sync schematic to PCB", (draft) => replaceBoardContents(draft, migrated), {
          operationType: "schematic-sync",
          affectedObjects: [...report.added, ...report.removed, ...report.footprintChanged].map((id) => `footprints:${id}`),
          details: { placement: report.placement, kept: report.kept.length, unresolved: report.unresolved.length },
        });
      } else {
        dispatch({ type: "set-board", board: migrated });
      }
      setNetlist(netlist);
      setLastSyncHash(netlistHash(netlist));
      setToast(formatSyncToast(report));
      setPlacementWarning(report.placement.warning ?? null);
      setSyncDialogOpen(false);
    } catch (err) {
      setToast(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  // ── History + move tool lifecycle ──────────────────────────────────────────
  // Boards arriving from OUTSIDE the history stack (initial load, demo, sync)
  // reseed it — undo does not span a re-sync. Boards emitted BY the stack are
  // recognized by identity and keep it.
  useEffect(() => {
    if (!scene || !state.board) return;
    if (historyRef.current && historyRef.current.present === state.board) return;
    historyCleanupRef.current?.();
    const history = createHistory(state.board);
    historyRef.current = history;
    setVisibleHistory(historyView(history));
    const tool = createSelectMoveTool({
      scene,
      history,
      selection: selectionStore, // Stage 17: the tool writes the global store
      toast: setToast,
      onContextMenu: (request) => setCtxMenu(request),
    });
    moveToolRef.current = tool;
    const unsubscribe = history.subscribe((board) => {
      dispatch({ type: "set-board", board });
      setVisibleHistory(historyView(history));
      // Stage 17: drop selection refs whose items vanished (delete, undo, sync).
      const refs = selectionStore.get().refs;
      const live = liveRefs(board, refs);
      if (live.length !== refs.length) selectionStore.replace(live);
    });
    tool.refreshAirwires();
    historyCleanupRef.current = () => {
      unsubscribe();
      tool.destroy();
      moveToolRef.current = null;
    };
  }, [scene, selectionStore, state.board]);
  useEffect(() => () => historyCleanupRef.current?.(), []);

  // ── Stage 7: interactive routing tool (active only in "route" mode) ─────────
  const netClasses = useNetClass({ getHistory: () => historyRef.current });
  const routeTool = useRouteTool({
    scene,
    getHistory: () => historyRef.current,
    getActiveLayer: () => state.activeLayer,
    toast: setToast,
  });
  const { activate: activateRoute, deactivate: deactivateRoute } = routeTool;
  useEffect(() => {
    if (state.tool === "route") activateRoute();
    else deactivateRoute();
  }, [state.tool, activateRoute, deactivateRoute]);

  const updateRoutingPreferences = useCallback((preferences: RoutingPreferences): void => {
    const history = historyRef.current;
    if (history) {
      history.execute("Set routing width and via preset", (draft) => {
        draft.routingPreferences = preferences;
      });
      return;
    }
    const board = boardRef.current;
    if (board) dispatch({ type: "set-board", board: { ...board, routingPreferences: preferences } });
  }, []);

  // ── Stage 12: batch DRC (panel + toolbar button + zoom-to) ──────────────────
  const drc = useDrc({
    scene,
    getHistory: () => historyRef.current,
    board: state.board,
    // Stage 17: the flash borrows the selection overlay — hand it back.
    restoreSelection: () => scene?.setSelectionRefs(selectionStore.get().refs),
  });
  const repair = usePcbRepair({
    getHistory: () => historyRef.current,
    getRules: () => getPreset(drc.activePresetId).rules,
    getPresetId: () => drc.activePresetId,
    toast: setToast,
    onApplied: () => drc.run(),
  });
  const liveReadiness = useMemo(() => {
    if (!state.board) {
      return { state: "not-ready" as const, errors: 0, warnings: 0, incompleteNets: 0, unroutedConnections: 0, message: "No PCB has been created." };
    }
    return runDrc(state.board, getPreset(drc.activePresetId).rules, { presetId: drc.activePresetId }).readiness;
  }, [state.board, drc.activePresetId]);

  // ── Stage 15: 3D preview panel ──────────────────────────────────────────────
  const [preview3dOpen, setPreview3dOpen] = useState(false);

  // ── Stage 17: padstack library panel (right column, not a modal) ───────────
  const [padstacksOpen, setPadstacksOpen] = useState(false);

  // ── Stage 17 Phase D: command palette (Ctrl+K) + floating AI assist ────────
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);

  // ── Stage 14: "Send to fab" bundle export ───────────────────────────────────
  const [fabDialogOpen, setFabDialogOpen] = useState(false);
  const fabExport = useFabExport({ getBoard: () => boardRef.current, getNetlist: () => netlist });

  // ── Stage 16: shortcut cheat sheet + modal keyboard guard ────────────────────
  /** While any modal dialog owns the screen, global shortcuts are gated —
   *  including Ctrl+Z, which used to undo board state UNDER the fab dialog. */
  const modalGuardRef = useRef({ anyModalOpen: false, otherModalOpen: false, preview3dOpen: false });
  const shortcuts = useShortcutsHelp(() => modalGuardRef.current.otherModalOpen);

  // ── Stage 11: zone fills (derived state — recomputed after commits) ─────────
  const zoneFills = useZoneFills({ getHistory: () => historyRef.current, board: state.board });
  const [planeDialogOpen, setPlaneDialogOpen] = useState(false);
  const addPlane = useCallback((layer: LayerId, netId: number) => {
    const h = historyRef.current;
    if (!h) return;
    const cmd: ZoneCommand = { kind: "AddZone", zone: makePlaneZone(h.present, layer, netId) };
    h.execute(zoneCommandLabel(cmd, h.present), (d) => mutateBoardWithZoneCommand(d, cmd));
    setToast("Plane added — filling…");
  }, []);

  // ── Stage 16: silkscreen tool ────────────────────────────────────────────────
  const silkTool = useSilkTool({
    scene,
    active: state.tool === "silk",
    getHistory: () => historyRef.current,
    toast: setToast,
  });

  // ── Stage 8: one-click auto-place (single-undo batch) ───────────────────────
  const autoPlace = useAutoPlace({
    getHistory: () => historyRef.current,
    getNetlist: () => netlist,
    toast: setToast,
  });
  const enlargeBoardToFit = useCallback((): void => {
    const history = historyRef.current;
    if (!history) return;
    const current = history.present;
    if (current.outline.kind !== "rect" && current.outline.kind !== "roundrect") {
      setToast("Automatic outline enlargement currently supports rectangular and rounded-rectangle boards.");
      return;
    }
    const bounds = current.footprints
      .map((footprint) => worldCourtyardBBox(localCourtyardBBox(footprint.def), footprint.at, footprint.rotationDeg, footprint.side === "bottom"))
      .reduce((union, box) => union ? bboxUnion(union, box) : box, null as ReturnType<typeof localCourtyardBBox> | null);
    if (!bounds) return;
    const margin = mmToNm(5);
    const oldMaxX = current.outline.origin.x + current.outline.width;
    const oldMaxY = current.outline.origin.y + current.outline.height;
    const origin = {
      x: Math.min(current.outline.origin.x, Math.floor(bounds.minX - margin)),
      y: Math.min(current.outline.origin.y, Math.floor(bounds.minY - margin)),
    };
    const maxX = Math.max(oldMaxX, Math.ceil(bounds.maxX + margin));
    const maxY = Math.max(oldMaxY, Math.ceil(bounds.maxY + margin));
    history.execute("Enlarge board to fit imported parts", (draft) => {
      if (draft.outline.kind !== "rect" && draft.outline.kind !== "roundrect") return;
      draft.outline.origin = origin;
      draft.outline.width = maxX - origin.x;
      draft.outline.height = maxY - origin.y;
    });
    setPlacementWarning(null);
    setToast("Board outline enlarged with a 5 mm placement margin. Undo is available.");
  }, []);

  // ── Stage 9: one-click Freerouting autoroute (single-undo import) ───────────
  const autoroute = useAutoroute({
    getHistory: () => historyRef.current,
    toast: setToast,
    getDrcRules: () => getPreset(drc.activePresetId).rules, // Stage 12: DRC on completion
  });

  // ── Scene sync (state → scene) ────────────────────────────────────────────
  useEffect(() => {
    if (state.board) scene?.setBoard(state.board);
  }, [scene, state.board]);

  useEffect(() => {
    if (!scene) return;
    for (const l of LAYERS) {
      scene.setLayerVisible(l.id, state.visibleOverrides[l.id] ?? DEFAULT_VISIBLE[l.id]);
    }
  }, [scene, state.visibleOverrides]);

  useEffect(() => {
    scene?.setActiveLayer(state.activeLayer);
  }, [scene, state.activeLayer]);

  // Stage 17: selection store → scene overlay (refs — copper items included).
  useEffect(() => {
    if (!scene) return;
    scene.setSelectionRefs(selectionStore.get().refs);
    return selectionStore.subscribe((s) => scene.setSelectionRefs(s.refs));
  }, [scene, selectionStore]);

  useEffect(() => {
    // Route/zone/silk modes reuse the select viewport (middle-drag pans, left draws).
    scene?.setTool(
      state.tool === "route" || state.tool === "zone" || state.tool === "silk" ? "select" : state.tool,
    );
  }, [scene, state.tool]);

  useEffect(() => {
    scene?.setGridVisible(state.gridOn);
  }, [scene, state.gridOn]);

  // ── Pointer interaction (scene → state) ───────────────────────────────────
  useEffect(() => {
    if (!scene) return;
    return scene.onPointer((e: ScenePointerEvent) => {
      if (toolRef.current === "route") return; // useRouteTool owns route-mode pointers
      if (toolRef.current === "zone") return; // ZoneTool owns zone-mode pointers
      if (toolRef.current === "silk") return; // useSilkTool owns silk-mode pointers (Stage 16)
      if (toolRef.current === "pan") {
        // Viewport owns left-drag in pan mode; just keep hover clean.
        if (e.type === "move" || e.type === "leave") scene.setHover(null);
        return;
      }
      switch (e.type) {
        case "down": {
          if ((e.buttons & 2) !== 0) {
            // Right button: the select-move tool owns the context-menu flow.
            moveToolRef.current?.handlePointer(e);
            return;
          }
          if ((e.buttons & 1) === 0) return; // left button only
          if (e.pick?.kind === "outline-handle") {
            dragRef.current = e.pick.handle;
            return;
          }
          moveToolRef.current?.handlePointer(e);
          return;
        }
        case "move": {
          const handle = dragRef.current;
          if (handle !== null && boardRef.current) {
            dispatch({
              type: "set-outline",
              outline: applyHandleDrag(boardRef.current.outline, handle, e.world),
            });
            return;
          }
          moveToolRef.current?.handlePointer(e);
          return;
        }
        case "up": {
          if (dragRef.current !== null) {
            // Outline handle drag ends: record ONE history entry for the gesture.
            dragRef.current = null;
            const h = historyRef.current;
            const outline = boardRef.current?.outline;
            if (h && outline && outline !== h.present.outline) {
              h.execute("Edit outline", (d) => {
                d.outline = outline;
              });
            }
            return;
          }
          moveToolRef.current?.handlePointer(e);
          return;
        }
        case "leave":
          dragRef.current = null;
          moveToolRef.current?.handlePointer(e);
          return;
      }
    });
  }, [scene]);

  // Stage 16: keep the modal guard + global-action bindings current.
  // Stage 17: the palette gates global shortcuts too (it owns the keyboard).
  useEffect(() => {
    modalGuardRef.current = {
      anyModalOpen: fabDialogOpen || planeDialogOpen || shortcuts.open || paletteOpen || syncDialogOpen,
      otherModalOpen: fabDialogOpen || planeDialogOpen || syncDialogOpen,
      preview3dOpen,
    };
  });
  const globalActionsRef = useRef({
    autoPlace: () => {},
    autoroute: () => {},
    runDrc: () => {},
    toggle3d: () => {},
    openFab: () => {},
  });
  useEffect(() => {
    globalActionsRef.current = {
      autoPlace: () => void autoPlace.run(),
      autoroute: () => void autoroute.run(),
      runDrc: () => void drc.run(),
      toggle3d: () => setPreview3dOpen((o) => !o),
      openFab: () => setFabDialogOpen(true),
    };
  });

  // Keyboard: select/move tool first (R/F/arrows/Delete/Escape/undo/redo).
  // Stage 7: "R" toggles route mode (only when select-move didn't consume it —
  // e.g. no selection to rotate); route-mode keys are owned by useRouteTool.
  // Stage 16: modal dialogs gate EVERYTHING (no Ctrl+Z under the fab dialog);
  // Ctrl+P/E/D/3/B are the global action shortcuts (see ShortcutsHelp).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Stage 17: Ctrl+K toggles the palette from anywhere except a modal.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        if (!modalGuardRef.current.otherModalOpen) {
          e.preventDefault();
          setPaletteOpen((o) => !o);
        }
        return;
      }
      if (modalGuardRef.current.anyModalOpen) return; // dialogs own the keyboard
      const editable =
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
      if (e.key === "Escape" && modalGuardRef.current.preview3dOpen) {
        e.preventDefault();
        setPreview3dOpen(false);
        return;
      }
      // Undo/redo are editor-global. Route/zone/silk own their drawing keys,
      // but they must never make an already-committed gesture unreachable by
      // Ctrl+Z (Smart Route commits an entire candidate as one history entry).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !editable) {
        const key = e.key.toLowerCase();
        if (key === "z" || key === "y") {
          e.preventDefault();
          if (key === "y" || (key === "z" && e.shiftKey)) historyRef.current?.redo();
          else historyRef.current?.undo();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !editable) {
        const k = e.key.toLowerCase();
        const actions = globalActionsRef.current;
        const run =
          k === "p" ? actions.autoPlace
          : k === "e" ? actions.autoroute
          : k === "d" ? actions.runDrc
          : k === "3" ? actions.toggle3d
          : k === "b" ? actions.openFab
          : null;
        if (run) {
          e.preventDefault(); // Ctrl+P/D would otherwise print/bookmark
          run();
          return;
        }
      }
      if (
        toolRef.current !== "route" &&
        toolRef.current !== "zone" &&
        toolRef.current !== "silk" &&
        moveToolRef.current?.handleKey(e)
      ) {
        return;
      }
      if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !editable) {
        e.preventDefault();
        dispatch({ type: "set-tool", tool: toolRef.current === "route" ? "select" : "route" });
        return;
      }
      // Stage 11: "Z" toggles the zone-draw tool.
      if ((e.key === "z" || e.key === "Z") && !e.ctrlKey && !e.metaKey && !editable) {
        e.preventDefault();
        dispatch({ type: "set-tool", tool: toolRef.current === "zone" ? "select" : "zone" });
        return;
      }
      // Stage 16: "S" toggles the silkscreen tool.
      if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey && !editable) {
        e.preventDefault();
        dispatch({ type: "set-tool", tool: toolRef.current === "silk" ? "select" : "silk" });
        return;
      }
      if (toolRef.current === "route") return; // useRouteTool owns V/Tab/Backspace/Escape/X
      if (toolRef.current === "zone") return; // ZoneTool owns Enter/Escape
      if (toolRef.current === "silk") return; // useSilkTool owns Enter/Escape (Stage 16)
      if (e.key === "Escape") selectionStore.clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionStore]);

  const isVisible = useCallback(
    (layer: LayerId) => state.visibleOverrides[layer] ?? DEFAULT_VISIBLE[layer],
    [state.visibleOverrides],
  );

  // ── Stage 17: context-menu items for the current right-click pick ─────────
  // Items are thin wrappers over the same primitives the palette and
  // inspector use: selectSimilar / selectNet / applyEdits.
  const buildCtxItems = (): ContextMenuItem[] => {
    const board = state.board;
    if (!board || !ctxMenu) return [];
    const items: ContextMenuItem[] = [];
    const pick = ctxMenu.pick;
    const ref: SelectionRef | null =
      pick && pick.kind !== "outline-handle"
        ? pick.kind === "pad"
          ? { kind: "pad", footprintId: pick.footprintId, padNumber: pick.padNumber }
          : { kind: pick.kind, id: pick.id }
        : null;

    if (ref) {
      const [item] = getItems(board, [ref]);
      if (item) {
        const netId =
          item.kind === "track"
            ? item.track.netId
            : item.kind === "via"
              ? item.via.netId
              : item.kind === "zone"
                ? item.zone.netId
                : item.kind === "pad"
                  ? item.netId
                  : undefined;
        if (netId !== undefined && netId !== 0) {
          const name = board.nets.find((n) => n.id === netId)?.name || `net ${netId}`;
          items.push({
            label: `Select net ${name}`,
            onClick: () => selectionStore.replace(selectNet(board, netId)),
          });
        }
        if (item.kind === "via") {
          items.push({
            label: "Select similar vias",
            onClick: () => selectionStore.replace(selectSimilar(board, ref, "padstack")),
          });
        }
        if (item.kind === "track" || item.kind === "zone" || item.kind === "text") {
          items.push({
            label: "Select same layer",
            onClick: () => selectionStore.replace(selectSimilar(board, ref, "layer")),
          });
        }
      }
    }

    // Delete acts on the whole current selection (right-click selected the
    // picked item already); footprints are schematic-owned.
    const refs = selectionStore.get().refs;
    const deletable = refs.filter(
      (r) => r.kind === "track" || r.kind === "via" || r.kind === "zone" || r.kind === "text",
    );
    const h = historyRef.current;

    // Stage 17 Phase D: arrange on multi-select — same commands as the
    // inspector's Arrange section and the palette.
    const movable = movableRefs(refs);
    if (movable.length >= 2 && h) {
      const arrange = (cmds: EditCommand[]) => () => {
        const result = applyEdits(h, cmds);
        if (!result.ok) setToast(result.errors[0]);
      };
      items.push(
        { label: "Align left", onClick: arrange([{ op: "align", refs: movable, mode: "left" }]) },
        { label: "Align top", onClick: arrange([{ op: "align", refs: movable, mode: "top" }]) },
      );
      if (movable.length >= 3) {
        items.push({
          label: "Distribute horizontally",
          onClick: arrange([{ op: "distribute", refs: movable, axis: "h" }]),
        });
      }
      items.push({
        label: "Snap to 0.5 mm grid",
        onClick: arrange([{ op: "snap-to-grid", refs: movable, gridNm: ARRANGE_GRID_NM }]),
      });
    }
    if (deletable.length > 0 && h) {
      items.push({
        label:
          deletable.length === 1
            ? `Delete ${deletable[0].kind === "text" ? "silk text" : deletable[0].kind}`
            : `Delete ${deletable.length} items`,
        danger: true,
        onClick: () => {
          const result = applyEdits(h, [{ op: "delete-items", refs: deletable }]);
          if (!result.ok) setToast(result.errors[0]);
        },
      });
    } else if (ref?.kind === "footprint") {
      items.push({
        label: "Delete",
        disabled: true,
        reason: "Parts are removed by editing the schematic and re-syncing.",
      });
    }
    return items;
  };

  // ── Stage 17 Phase D: the palette's action registry ────────────────────────
  // Every EditCommand-backed action + editor actions; the palette is the
  // discoverability answer (and mirrors the AI's action vocabulary).
  const buildPaletteActions = (): PaletteAction[] => {
    const board = state.board;
    const refs = selectionStore.get().refs;
    const movable = movableRefs(refs);
    const primary = selectionStore.get().primary;
    const h = historyRef.current;
    const commit = (cmds: EditCommand[]): void => {
      if (!h) return;
      const result = applyEdits(h, cmds);
      if (!result.ok) setToast(result.errors[0]);
    };
    const needTwo = movable.length >= 2 ? null : "select 2+ items";
    const needThree = movable.length >= 3 ? null : "select 3+ items";
    const alignAction = (
      mode: "left" | "right" | "top" | "bottom" | "centerH" | "centerV",
      title: string,
    ): PaletteAction => ({
      id: `align-${mode}`,
      title,
      hint: "Arrange",
      disabled: needTwo,
      run: () => commit([{ op: "align", refs: movable, mode }]),
    });

    const actions: PaletteAction[] = [
      { id: "assist", title: "Ask AI to edit the board…", hint: "AI", run: () => setAssistOpen(true) },
      { id: "zoom-fit", title: "Zoom to fit", run: () => scene?.zoomToFit() },
      {
        id: "zoom-selection",
        title: "Zoom to selection",
        disabled: refs.length > 0 ? null : "nothing selected",
        run: () => {
          if (board && scene) scene.centerOn(selectionBBoxCenter(board, refs));
        },
      },
      { id: "run-drc", title: "Run design rule check", hint: "Ctrl+D", run: () => void drc.run() },
      { id: "autoplace", title: "Auto-place components", hint: "Ctrl+P", run: () => void autoPlace.run() },
      { id: "autoroute", title: "Autoroute board", hint: "Ctrl+E", run: () => void autoroute.run() },
      { id: "3d", title: "Toggle 3D preview", hint: "Ctrl+3", run: () => setPreview3dOpen((o) => !o) },
      { id: "fab", title: "Send to fab…", hint: "Ctrl+B", run: () => setFabDialogOpen(true) },
      {
        id: "export-kicad",
        title: "Export .kicad_pcb",
        run: () => {
          const b = boardRef.current;
          if (b) void downloadKicadPcb(b, netlist);
        },
      },
      { id: "padstacks", title: "Open padstack library", run: () => setPadstacksOpen(true) },
      { id: "grid", title: state.gridOn ? "Hide grid" : "Show grid", run: () => dispatch({ type: "toggle-grid" }) },
      { id: "shortcuts", title: "Keyboard shortcuts", hint: "?", run: shortcuts.show },
      alignAction("left", "Align left"),
      alignAction("centerH", "Align horizontal centers"),
      alignAction("right", "Align right"),
      alignAction("top", "Align top"),
      alignAction("centerV", "Align vertical centers"),
      alignAction("bottom", "Align bottom"),
      {
        id: "distribute-h",
        title: "Distribute horizontally",
        hint: "Arrange",
        disabled: needThree,
        run: () => commit([{ op: "distribute", refs: movable, axis: "h" }]),
      },
      {
        id: "distribute-v",
        title: "Distribute vertically",
        hint: "Arrange",
        disabled: needThree,
        run: () => commit([{ op: "distribute", refs: movable, axis: "v" }]),
      },
      {
        id: "snap-grid",
        title: "Snap selection to 0.5 mm grid",
        hint: "Arrange",
        disabled: movable.length > 0 ? null : "nothing selected",
        run: () => commit([{ op: "snap-to-grid", refs: movable, gridNm: ARRANGE_GRID_NM }]),
      },
      {
        id: "delete-selection",
        title: "Delete selected copper/text",
        disabled: refs.some((r) => r.kind !== "footprint" && r.kind !== "pad")
          ? null
          : "nothing deletable selected",
        run: () =>
          commit([
            {
              op: "delete-items",
              refs: refs.filter(
                (r) => r.kind === "track" || r.kind === "via" || r.kind === "zone" || r.kind === "text",
              ),
            },
          ]),
      },
    ];

    // Select-similar for the primary item (same queries as the context menu).
    if (board && primary && primary.kind !== "pad" && primary.kind !== "footprint") {
      actions.push({
        id: "select-net",
        title: "Select everything on this net",
        run: () => selectionStore.replace(selectSimilar(board, primary, "net")),
      });
      actions.push({
        id: "select-layer",
        title: "Select everything on this layer",
        run: () => selectionStore.replace(selectSimilar(board, primary, "layer")),
      });
      if (primary.kind === "via") {
        actions.push({
          id: "select-padstack",
          title: "Select vias with this padstack",
          run: () => selectionStore.replace(selectSimilar(board, primary, "padstack")),
        });
      }
    }

    // Layer visibility toggles (copper + silk — the everyday set).
    for (const layer of LAYERS) {
      if (layer.kind !== "copper" && layer.kind !== "silk") continue;
      if ((layer.id === "in1" || layer.id === "in2") && board?.stackup !== 4) continue;
      actions.push({
        id: `layer-${layer.id}`,
        title: `Toggle ${layer.displayName}`,
        hint: "Layers",
        run: () => dispatch({ type: "toggle-layer", layer: layer.id }),
      });
    }
    return actions;
  };

  // ── Empty state: no board yet ─────────────────────────────────────────────
  if (!state.board) {
    return (
      <>
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
          <div className="flex flex-col items-center text-center max-w-sm">
          <CircuitBoard className="size-10 text-zinc-700" />
          <p className="mt-3 text-sm font-medium text-zinc-300">No board yet</p>
          <p className="mt-1 text-xs text-zinc-500">
            Convert your schematic into a board — footprints are assigned
            automatically where possible.
          </p>
          <button
            type="button"
            onClick={() => void handleSync({ centerNewParts: true, spreadOverlaps: true })}
            disabled={syncing}
            className="mt-4 flex items-center gap-2 px-3 py-1.5 rounded bg-teal-600 text-sm text-white hover:bg-teal-500 transition-colors disabled:opacity-50"
          >
            {syncing && <Loader2 className="size-3.5 animate-spin" />}
            Schematic → PCB
          </button>
          <button
            type="button"
            onClick={() => setSyncDialogOpen(true)}
            disabled={syncing}
            className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
          >
            Placement options
          </button>
          {toast && <p className="mt-3 text-xs text-zinc-400">{toast}</p>}
          </div>
        </div>
        <SyncPlacementDialog
          open={syncDialogOpen}
          syncing={syncing}
          onClose={() => setSyncDialogOpen(false)}
          onConfirm={(placement) => void handleSync(placement)}
        />
      </>
    );
  }

  return (
    <div className="absolute inset-0 flex bg-zinc-950">
      {/* Canvas column */}
      <div className="flex-1 flex flex-col min-w-0">
        <PcbToolbar
          tool={state.tool}
          onToolChange={(tool) => dispatch({ type: "set-tool", tool })}
          onZoomToFit={() => scene?.zoomToFit()}
          gridOn={state.gridOn}
          onToggleGrid={() => dispatch({ type: "toggle-grid" })}
          stackup={state.board.stackup}
          onStackupChange={(stackup) => {
            const h = historyRef.current;
            if (h) h.execute("Set stackup", (d) => {
              d.stackup = stackup;
              d.stackupConfig = stackupProfile(stackup === 4 ? "all-signal-4" : "simple-2");
            });
            else dispatch({ type: "set-stackup", stackup });
          }}
          outline={state.board.outline}
          onOutlineChange={(outline) => {
            const h = historyRef.current;
            if (h) h.execute("Edit outline", (d) => void (d.outline = outline));
            else dispatch({ type: "set-outline", outline });
          }}
          onAutoPlace={() => void autoPlace.run()}
          onCancelAutoPlace={autoPlace.cancel}
          autoPlacing={autoPlace.state === "running"}
          autoPlaceProgress={autoPlace.progress?.percent}
          onRouteBoard={() => void autoroute.run()}
          routing={autoroute.state === "queued" || autoroute.state === "running"}
          routingElapsedMs={autoroute.elapsedMs}
          onRunDrc={() => void drc.run()}
          drcRunning={drc.state === "running"}
          onAddPlane={() => setPlaneDialogOpen(true)} // Stage 11
          zoneFilling={zoneFills.isFilling} // Stage 11
          onToggle3d={() => setPreview3dOpen((o) => !o)} // Stage 15
          preview3dOpen={preview3dOpen} // Stage 15
          onTogglePadstacks={() => setPadstacksOpen((o) => !o)} // Stage 17
          padstacksOpen={padstacksOpen} // Stage 17
          onUndo={() => historyRef.current?.undo()}
          onRedo={() => historyRef.current?.redo()}
          canUndo={visibleHistory.canUndo}
          canRedo={visibleHistory.canRedo}
          undoLabel={visibleHistory.undoLabel}
          redoLabel={visibleHistory.redoLabel}
          historyEntries={visibleHistory.entries}
          readiness={liveReadiness}
          onExportKicad={() => { const b = boardRef.current; if (b) void downloadKicadPcb(b, netlist); }} // Stage 13
          onSendToFab={() => setFabDialogOpen(true)} // Stage 14
          onShowShortcuts={shortcuts.show} // Stage 16
        >
          <SyncButton
            dirty={dirty}
            syncing={syncing}
            onSync={() => void handleSync({ centerNewParts: true, spreadOverlaps: true })}
            onOptions={() => setSyncDialogOpen(true)}
          />
        </PcbToolbar>
        <div className="relative flex-1 min-h-0">
          <PcbCanvas onReady={handleSceneReady} />
          <DebugHud scene={scene} />
          {state.tool === "route" && (
            <RoutingControls
              board={state.board}
              onChange={updateRoutingPreferences}
              status={routeTool.status}
            />
          )}
          {/* Stage 11: zone draw tool (Z) + plane dialog */}
          <ZoneTool
            scene={scene}
            active={state.tool === "zone"}
            board={state.board}
            getHistory={() => historyRef.current}
            activeLayer={state.activeLayer}
            toast={setToast}
          />
          <SilkTool silk={silkTool} active={state.tool === "silk"} /> {/* Stage 16 */}
          <AddPlaneDialog
            open={planeDialogOpen}
            board={state.board}
            onClose={() => setPlaneDialogOpen(false)}
            onAdd={addPlane}
          />
          {/* Stage 15: 3D preview side sheet (three.js mounts only while open) */}
          {preview3dOpen && (
            <div className="absolute inset-y-0 right-0 z-40 w-[min(560px,85%)] flex flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
              <div className="flex items-center justify-between h-9 px-3 shrink-0 border-b border-zinc-800 text-xs">
                <span className="font-medium text-zinc-200">3D preview</span>
                <button
                  type="button"
                  aria-label="Close 3D preview"
                  onClick={() => setPreview3dOpen(false)}
                  className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <PcbPreview3D board={state.board} />
              </div>
            </div>
          )}
          {placementWarning && (
            <div className="absolute bottom-12 left-3 z-50 max-w-md rounded-lg border border-amber-500/35 bg-zinc-900/95 p-3 text-xs text-zinc-200 shadow-xl">
              <p className="text-amber-200">{placementWarning}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => void autoPlace.run()} disabled={autoPlace.state === "running"} className="rounded bg-teal-600 px-2 py-1 text-[11px] text-white hover:bg-teal-500 disabled:opacity-40">Auto-arrange parts</button>
                <button type="button" onClick={enlargeBoardToFit} className="rounded border border-zinc-600 px-2 py-1 text-[11px] text-zinc-300 hover:text-white">Enlarge board to fit</button>
                <button type="button" onClick={() => setPlacementWarning(null)} className="px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-200">Dismiss</button>
              </div>
            </div>
          )}
          {toast && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded border border-zinc-700 bg-zinc-900/95 text-xs text-zinc-200 shadow-lg">
              {toast}
            </div>
          )}
          {/* Stage 17: right-click context menu */}
          {ctxMenu && (
            <ContextMenu
              x={ctxMenu.screen.x}
              y={ctxMenu.screen.y}
              items={
                // Legacy action builders capture editor refs for click handlers.
                // eslint-disable-next-line react-hooks/refs
                buildCtxItems()
              }
              onClose={() => setCtxMenu(null)}
            />
          )}
          {/* Stage 17 Phase D: command palette (Ctrl+K) */}
          <CommandPalette
            open={paletteOpen}
            actions={
              // Legacy action builders capture editor refs for click handlers.
              // eslint-disable-next-line react-hooks/refs
              buildPaletteActions()
            }
            onClose={() => setPaletteOpen(false)}
          />
          {/* Stage 17 Phase D: floating AI assist (palette-launched; works
              without a selection — the inspector footer has its own box) */}
          {assistOpen && (
            <div className="absolute bottom-3 right-3 z-40 w-72 rounded-lg border border-zinc-700 bg-zinc-900/95 shadow-xl">
              <div className="flex items-center justify-between px-3 pt-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  AI assist
                </span>
                <button
                  type="button"
                  aria-label="Close AI assist"
                  onClick={() => setAssistOpen(false)}
                  className="p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <AssistBox
                board={state.board}
                getSelectionRefs={() => selectionStore.get().refs}
                getHistory={() => historyRef.current}
                rules={getPreset(drc.activePresetId).rules}
                presetId={drc.activePresetId}
                toast={setToast}
              />
            </div>
          )}
        </div>
      </div>

      {/* Right panel column */}
      <div className="w-60 shrink-0 border-l border-zinc-800 bg-zinc-900/50 flex flex-col min-h-0 overflow-y-auto overflow-x-hidden">
        <LayerPanel
          stackup={state.board.stackup}
          activeLayer={state.activeLayer}
          isVisible={isVisible}
          onToggleVisible={(layer) => dispatch({ type: "toggle-layer", layer })}
          onActivate={(layer) => dispatch({ type: "set-active-layer", layer })}
          onIsolate={(layer) => dispatch({ type: "isolate-layer", layer })}
          onShowAllCopper={() => dispatch({ type: "show-copper" })}
          layerUsage={autoroute.lastResult?.layerUsage}
        />
        <AutorouteSetup
          board={state.board}
          result={autoroute.lastResult}
          onFocusFailure={(failure) => {
            scene?.centerOn(failure.location, 40);
            scene?.setSelection([failure.from?.footprintId, failure.to?.footprintId].filter((id): id is string => Boolean(id)));
          }}
          onChange={(stackup, label) => {
            const h = historyRef.current;
            if (!h) return;
            h.execute(label, (draft) => {
              draft.stackup = stackup.copperLayers.length as 2 | 4;
              draft.stackupConfig = stackup;
            });
          }}
        />
        <PlacementSetup
          board={state.board}
          result={autoPlace.lastResult}
          onChange={(preferences) => {
            const h = historyRef.current;
            if (!h) return;
            h.execute("Set auto-placement spacing", (draft) => {
              draft.placementPreferences = preferences;
            });
          }}
        />
        <RoutingRulesPanel board={state.board} netClasses={netClasses} toast={setToast} />
        {/* Stage 17: properties inspector — renders nothing when selection is empty */}
        <Inspector
          board={state.board}
          selection={selectionStore}
          getHistory={() => historyRef.current}
          scene={scene}
          rules={getPreset(drc.activePresetId).rules}
          presetId={drc.activePresetId}
          toast={setToast}
          onRefillZones={() => void zoneFills.fillAllDirty()}
        />
        {padstacksOpen ? (
          // Stage 17: the padstack library borrows the DRC panel's slot.
          <PadstackPanel
            board={state.board}
            getHistory={() => historyRef.current}
            rules={getPreset(drc.activePresetId).rules}
            toast={setToast}
            onClose={() => setPadstacksOpen(false)}
          />
        ) : drc.state === "idle" && !drc.lastResult ? (
          <EmptyState // Stage 16: before the first run the panel explains itself
            icon={ShieldCheck}
            title="Design rule check"
            subtitle="Run DRC to check the board against the current fab preset."
            actionLabel="Run DRC"
            onAction={() => void drc.run()}
          />
        ) : (
          <DrcPanel drc={drc} repair={repair} />
        )}
      </div>
      <FabDialog open={fabDialogOpen} onClose={() => setFabDialogOpen(false)} fab={fabExport} onZoomToViolation={drc.zoomToViolation} /> {/* Stage 14 */}
      <ShortcutsHelp open={shortcuts.open} onClose={shortcuts.hide} /> {/* Stage 16 */}
      <SyncPlacementDialog
        open={syncDialogOpen}
        syncing={syncing}
        onClose={() => setSyncDialogOpen(false)}
        onConfirm={(placement) => void handleSync(placement)}
      />
    </div>
  );
}
