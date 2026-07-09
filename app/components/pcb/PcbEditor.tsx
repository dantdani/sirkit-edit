"use client";

/**
 * PCB editor shell. Stage 3 built the canvas + panels; Stage 4 wires the
 * schematic → board bridge: empty-state "Send schematic to board" CTA, a
 * toolbar Sync button (badged when the schematic drifted from the last sync),
 * the footprint assignment queue, and board persistence on the project's
 * `pcb` field (750 ms debounce).
 *
 * The bundled demo board stays reachable via `?pcbdemo=` (`=high` for the
 * perf build) and NEVER persists.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CircuitBoard, ListTodo, Loader2, ShieldCheck, X } from "lucide-react";
import type { SchematicState } from "@/lib/schematic-types";
import type { PcbBoard, BoardOutline, FootprintInstance } from "@/app/lib/pcb/types";
import { LAYERS, type LayerId } from "@/app/lib/pcb/layers";
import type { PcbScene, ScenePointerEvent } from "@/app/lib/pcb/render/scene";
import { applyHandleDrag } from "@/app/lib/pcb/render/outline";
import type { OutlineHandleId } from "@/app/lib/pcb/render/pick";
import { buildDemoBoard } from "@/app/lib/pcb/demo/demo-board";
import { parseKicadMod } from "@/app/lib/pcb/kicad-mod";
import {
  buildNetlist,
  createFetchFootprintResolver,
  netlistHash,
  placeNewFootprint,
  syncFromSchematic,
  type PcbNetlist,
  type SyncReport,
} from "@/app/lib/pcb/netlist-bridge";
import { loadCurrentBoard, saveCurrentBoard } from "@/app/lib/pcb/board-persistence";
import { createHistory, type PcbHistory } from "@/app/lib/pcb/history";
import { createSelectMoveTool, type SelectMoveTool } from "@/app/lib/pcb/tools/select-move";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo"; // Stage 7 integration
import { buildStoryDemo } from "@/app/lib/pcb/demo/story-demo"; // Stage 16
import { useRouteTool } from "./hooks/useRouteTool"; // Stage 7 integration
import { useAutoroute } from "./hooks/useAutoroute"; // Stage 9 integration
import { useAutoPlace } from "./hooks/useAutoPlace"; // Stage 8 integration
import { useDrc } from "./hooks/useDrc"; // Stage 12 integration
import { useZoneFills } from "./hooks/useZoneFills"; // Stage 11 integration
import { ZoneTool, AddPlaneDialog } from "./ZoneTool"; // Stage 11
import { renderZones } from "@/app/lib/pcb/render/zones"; // Stage 11
import { makePlaneZone } from "@/app/lib/pcb/zones/plane"; // Stage 11
import { mutateBoardWithZoneCommand, zoneCommandLabel, type ZoneCommand } from "@/app/lib/pcb/zones/command"; // Stage 11
import { downloadKicadPcb } from "@/app/lib/pcb/kicad/export-client"; // Stage 13 integration
import { FabDialog } from "./FabDialog"; // Stage 14
import { useFabExport } from "./hooks/useFabExport"; // Stage 14
import { SilkTool } from "./SilkTool"; // Stage 16
import { useSilkTool } from "./hooks/useSilkTool"; // Stage 16
import { renderSilkItems } from "@/app/lib/pcb/render/silk"; // Stage 16
import { ShortcutsHelp } from "./ShortcutsHelp"; // Stage 16
import { useShortcutsHelp } from "./hooks/useShortcutsHelp"; // Stage 16
import { EmptyState } from "./EmptyState"; // Stage 16
import { DrcPanel } from "./DrcPanel"; // Stage 12
import { getPreset } from "@/app/lib/pcb/drc/presets"; // Stage 12
import { getCachedPart, ensurePartLoaded, subscribeToPart } from "@/app/lib/parts-cache";
import { PcbCanvas } from "./PcbCanvas";
import { LayerPanel } from "./LayerPanel";
import { PcbToolbar } from "./PcbToolbar";
import { DebugHud } from "./DebugHud";
import { SyncButton } from "./SyncButton";
import { AssignmentQueue, type FootprintPick, type QueueItem } from "./AssignmentQueue";

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
  selection: string[];
  tool: "select" | "pan" | "route" | "zone" | "silk"; // Stages 7/11/16 add route/zone/silk
  gridOn: boolean;
}

type EditorAction =
  | { type: "set-board"; board: PcbBoard }
  | { type: "set-outline"; outline: BoardOutline }
  | { type: "set-stackup"; stackup: 2 | 4 }
  | { type: "toggle-layer"; layer: LayerId }
  | { type: "set-active-layer"; layer: LayerId }
  | { type: "set-selection"; ids: string[] }
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
      return { ...state, board: { ...state.board, stackup: action.stackup } };
    case "toggle-layer": {
      const current = state.visibleOverrides[action.layer] ?? DEFAULT_VISIBLE[action.layer];
      return {
        ...state,
        visibleOverrides: { ...state.visibleOverrides, [action.layer]: !current },
      };
    }
    case "set-active-layer":
      return { ...state, activeLayer: action.layer };
    case "set-selection":
      return { ...state, selection: action.ids };
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
    selection: [],
    tool: "select",
    gridOn: true,
  };
}

/** pad number → net id for one component, from the synced netlist. */
function padNetsFor(netlist: PcbNetlist, componentId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const net of netlist.nets) {
    for (const node of net.nodes) {
      if (node.componentId === componentId) out[node.pinNumber] = net.id;
    }
  }
  return out;
}

function formatSyncToast(report: SyncReport): string {
  const placed = report.added.length - report.unresolved.length + report.kept.length;
  const parts = [`${placed} placed`];
  if (report.resolvedBy.hint > 0) parts.push(`${report.resolvedBy.hint} by hint`);
  if (report.resolvedBy.heuristic > 0) parts.push(`${report.resolvedBy.heuristic} by package`);
  if (report.removed.length > 0) parts.push(`${report.removed.length} removed`);
  if (report.unresolved.length > 0) parts.push(`${report.unresolved.length} need attention`);
  return parts.join(" · ");
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PcbEditor({ schematic }: { schematic: SchematicState }) {
  // One-shot init: demo board via ?pcbdemo= (never persisted), otherwise the
  // current project's saved board (or none → empty state).
  const [init] = useState(() => {
    const demoParam =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("pcbdemo")
        : null;
    if (demoParam !== null) {
      // Stage 7: ?pcbdemo=routed loads the hand-routed fixture (interactive-
      // routing start point); Stage 16: =story loads the five-click demo
      // start (unplaced ESP32 breakout); =high/default keep Stage 3's grid demo.
      const board =
        demoParam === "routed"
          ? buildRoutedDemo()
          : demoParam === "story"
            ? buildStoryDemo()
            : buildDemoBoard(demoParam === "high" ? "high" : "default");
      return { board, demo: true, lastSyncHash: null as string | null };
    }
    const { board, lastSyncHash } = loadCurrentBoard();
    return { board, demo: false, lastSyncHash };
  });

  const [state, dispatch] = useReducer(reducer, init.board, makeEditorState);
  const [scene, setScene] = useState<PcbScene | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncHash, setLastSyncHash] = useState<string | null>(init.lastSyncHash);
  const [netlist, setNetlist] = useState<PcbNetlist | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Refs so the (stable) pointer callback sees current values without resubscribing.
  const boardRef = useRef(state.board);
  const toolRef = useRef(state.tool);
  const dragRef = useRef<OutlineHandleId | null>(null);
  const schematicRef = useRef(schematic);
  const selectionRef = useRef(state.selection);
  useEffect(() => {
    boardRef.current = state.board;
    toolRef.current = state.tool;
    schematicRef.current = schematic;
    selectionRef.current = state.selection;
  }, [state.board, state.tool, schematic, state.selection]);

  // Stage 5: undo/redo history + select/move tool (see app/lib/pcb/history.ts
  // and app/lib/pcb/tools/select-move.ts).
  const historyRef = useRef<PcbHistory | null>(null);
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
  const handleSync = useCallback(async () => {
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
        { getPart: getCachedPart },
      );
      dispatch({ type: "set-board", board });
      setNetlist(netlist);
      setLastSyncHash(netlistHash(netlist));
      setQueueItems(
        report.unresolved.flatMap((u) => {
          const component = netlist.components.find((c) => c.id === u.componentId);
          return component ? [{ ...u, component }] : [];
        }),
      );
      setToast(formatSyncToast(report));
      if (report.unresolved.length > 0) setQueueOpen(true);
    } catch (err) {
      setToast(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  // ── Assignment-queue pick: fetch def, place in staging strip ──────────────
  const handleAssign = useCallback(
    async (componentId: string, pick: FootprintPick) => {
      const board = boardRef.current;
      const nl = netlist;
      if (!board || !nl) return;
      const component = nl.components.find((c) => c.id === componentId);
      if (!component) return;
      const detail = await createFetchFootprintResolver().detail(pick.id);
      if (!detail) throw new Error("footprint source unavailable");
      const def = parseKicadMod(detail.rawSexpr, detail.libName);
      const inst: Omit<FootprintInstance, "at"> = {
        id: component.id,
        ref: component.ref,
        footprintId: pick.fullName,
        def,
        rotationDeg: 0,
        side: "top",
        padNets: padNetsFor(nl, component.id),
      };
      const placed = placeNewFootprint(board, inst);
      const h = historyRef.current;
      if (h && h.present === board) {
        h.execute(`Place ${component.ref}`, (d) => {
          d.footprints = placed.footprints;
        });
      } else {
        dispatch({ type: "set-board", board: placed });
      }
      setQueueItems((items) => items.filter((i) => i.componentId !== componentId));
      setToast(`${component.ref} → ${pick.fullName}`);
    },
    [netlist],
  );

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
    const tool = createSelectMoveTool({
      scene,
      history,
      getSelection: () => selectionRef.current,
      setSelection: (ids) => {
        selectionRef.current = ids; // synchronous — the tool re-reads immediately
        dispatch({ type: "set-selection", ids });
      },
      toast: setToast,
    });
    moveToolRef.current = tool;
    const unsubscribe = history.subscribe((board) => dispatch({ type: "set-board", board }));
    tool.refreshAirwires();
    historyCleanupRef.current = () => {
      unsubscribe();
      tool.destroy();
      moveToolRef.current = null;
    };
  }, [scene, state.board]);
  useEffect(() => () => historyCleanupRef.current?.(), []);

  // ── Stage 7: interactive routing tool (active only in "route" mode) ─────────
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

  // ── Stage 12: batch DRC (panel + toolbar button + zoom-to) ──────────────────
  const drc = useDrc({ scene, getHistory: () => historyRef.current });

  // ── Stage 15: 3D preview panel ──────────────────────────────────────────────
  const [preview3dOpen, setPreview3dOpen] = useState(false);

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

  // Zone fill rendering: batched Graphics per copper layer, under tracks/pads.
  useEffect(() => {
    if (!scene || !state.board) return;
    try {
      renderZones(state.board, (layer) => scene.getLayerContainer(layer));
    } catch {
      /* scene torn down mid-frame */
    }
  }, [scene, state.board]);

  // Stage 16: user silk items, one batched Graphics per silk layer.
  useEffect(() => {
    if (!scene || !state.board) return;
    try {
      renderSilkItems(state.board, (layer) => scene.getLayerContainer(layer));
    } catch {
      /* scene torn down mid-frame */
    }
  }, [scene, state.board]);

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

  useEffect(() => {
    scene?.setSelection(state.selection);
  }, [scene, state.selection]);

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
  useEffect(() => {
    modalGuardRef.current = {
      anyModalOpen: fabDialogOpen || planeDialogOpen || shortcuts.open,
      otherModalOpen: fabDialogOpen || planeDialogOpen,
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
      if (modalGuardRef.current.anyModalOpen) return; // dialogs own the keyboard
      const editable =
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
      if (e.key === "Escape" && modalGuardRef.current.preview3dOpen) {
        e.preventDefault();
        setPreview3dOpen(false);
        return;
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
      if (e.key === "Escape") dispatch({ type: "set-selection", ids: [] });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isVisible = useCallback(
    (layer: LayerId) => state.visibleOverrides[layer] ?? DEFAULT_VISIBLE[layer],
    [state.visibleOverrides],
  );

  // ── Empty state: no board yet ─────────────────────────────────────────────
  if (!state.board) {
    return (
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
            onClick={() => void handleSync()}
            disabled={syncing}
            className="mt-4 flex items-center gap-2 px-3 py-1.5 rounded bg-teal-600 text-sm text-white hover:bg-teal-500 transition-colors disabled:opacity-50"
          >
            {syncing && <Loader2 className="size-3.5 animate-spin" />}
            Send schematic to board
          </button>
          {toast && <p className="mt-3 text-xs text-zinc-400">{toast}</p>}
        </div>
      </div>
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
            if (h) h.execute("Set stackup", (d) => void (d.stackup = stackup));
            else dispatch({ type: "set-stackup", stackup });
          }}
          outline={state.board.outline}
          onOutlineChange={(outline) => {
            const h = historyRef.current;
            if (h) h.execute("Edit outline", (d) => void (d.outline = outline));
            else dispatch({ type: "set-outline", outline });
          }}
          onAutoPlace={() => void autoPlace.run()}
          autoPlacing={autoPlace.state === "running"}
          onRouteBoard={() => void autoroute.run()}
          routing={autoroute.state === "running"}
          routingElapsedMs={autoroute.elapsedMs}
          onRunDrc={() => void drc.run()}
          drcRunning={drc.state === "running"}
          onAddPlane={() => setPlaneDialogOpen(true)} // Stage 11
          zoneFilling={zoneFills.isFilling} // Stage 11
          onToggle3d={() => setPreview3dOpen((o) => !o)} // Stage 15
          preview3dOpen={preview3dOpen} // Stage 15
          onExportKicad={() => { const b = boardRef.current; if (b) void downloadKicadPcb(b, netlist); }} // Stage 13
          onSendToFab={() => setFabDialogOpen(true)} // Stage 14
          onShowShortcuts={shortcuts.show} // Stage 16
        >
          {!init.demo && (
            <>
              {queueItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setQueueOpen((o) => !o)}
                  title="Footprint assignment queue"
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-amber-400 hover:bg-amber-500/10 transition-colors"
                >
                  <ListTodo className="size-3.5" />
                  {queueItems.length}
                </button>
              )}
              <SyncButton dirty={dirty} syncing={syncing} onSync={() => void handleSync()} />
            </>
          )}
        </PcbToolbar>
        <div className="relative flex-1 min-h-0">
          <PcbCanvas onReady={handleSceneReady} />
          <DebugHud scene={scene} />
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
          <AssignmentQueue
            open={queueOpen}
            items={queueItems}
            onClose={() => setQueueOpen(false)}
            onAssign={handleAssign}
          />
          {toast && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded border border-zinc-700 bg-zinc-900/95 text-xs text-zinc-200 shadow-lg">
              {toast}
            </div>
          )}
        </div>
      </div>

      {/* Right panel column */}
      <div className="w-60 shrink-0 border-l border-zinc-800 bg-zinc-900/50 flex flex-col min-h-0">
        <LayerPanel
          stackup={state.board.stackup}
          activeLayer={state.activeLayer}
          isVisible={isVisible}
          onToggleVisible={(layer) => dispatch({ type: "toggle-layer", layer })}
          onActivate={(layer) => dispatch({ type: "set-active-layer", layer })}
        />
        {drc.state === "idle" && !drc.lastResult ? (
          <EmptyState // Stage 16: before the first run the panel explains itself
            icon={ShieldCheck}
            title="Design rule check"
            subtitle="Run DRC to check the board against the current fab preset."
            actionLabel="Run DRC"
            onAction={() => void drc.run()}
          />
        ) : (
          <DrcPanel drc={drc} />
        )}
      </div>
      <FabDialog open={fabDialogOpen} onClose={() => setFabDialogOpen(false)} fab={fabExport} onZoomToViolation={drc.zoomToViolation} /> {/* Stage 14 */}
      <ShortcutsHelp open={shortcuts.open} onClose={shortcuts.hide} /> {/* Stage 16 */}
    </div>
  );
}
