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
  buildPcbSyncPublicationGraph,
  netlistHash,
  type SyncReport,
} from "@/app/lib/pcb/netlist-bridge";
import { ensureCurrentProjectScope, loadCurrentProjectScope, loadPcbSnapshotRevision, loadStageEvidence, loadWorkingCopy, normalizeBoardForEditor, saveAuthoritativeBoardCache, saveCurrentManufacturingRelease, savePcbSnapshotRevision, saveStageEvidence, saveWorkingCopy, stashWorkingConflict } from "@/app/lib/pcb/board-persistence";
import { checkpointStore } from "@/app/lib/project/checkpoints";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { arrangeStagedFootprints } from "@/app/lib/pcb/autoplace/arrange-staged";
import { BOARD_RESTORE_EVENT, consumePendingBoardRestore } from "@/app/lib/pcb/board-restore";
import { PcbSyncClient } from "@/app/lib/pcb-sync/client";
import { PCB_SYNC_APPLY_REQUEST_VERSION, PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION, PCB_SYNC_REQUEST_VERSION, type PcbSyncBoardRecord, type PcbSyncPreflightResult } from "@/app/lib/pcb-sync/types";
import { createHistory, type PcbHistory, type PcbHistoryRecord } from "@/app/lib/pcb/history";
import {
  createSelectMoveTool,
  type SelectMoveTool,
  type ContextMenuRequest,
} from "@/app/lib/pcb/tools/select-move";
import { createSelectionStore } from "@/app/lib/pcb/selection"; // Stage 17
import { selectSimilar, selectNet, getItems } from "@/app/lib/pcb/selection-queries"; // Stage 17
import { liveRefs, selectionBBoxCenter } from "@/app/lib/pcb/edit/apply"; // Stage 17
// B03: the canonical editor session — slice mutations run through the
// canonical executor; the wrapped history keeps undo/redo UI semantics.
import { applyEditsCanonical, bindCanonicalEditorSession, canonicalSessionFor } from "@/app/lib/engineering/editor-adapter";
import { BrowserIndexedDbProjectStore } from "@/app/lib/engineering/browser-indexeddb-store";
import type { PcbCanonicalHead } from "@/lib/persistence";

// B03.1: durable canonical-envelope store (IndexedDB). One per tab; every
// canonical commit mirrors the validated envelope so reload can reopen the
// EXACT transaction head. Unavailable IndexedDB degrades safely — the session
// records the failure and reload falls back to a fresh verified lineage.
let sharedCanonicalEnvelopeStore: BrowserIndexedDbProjectStore | null | undefined;
function canonicalEnvelopeStore(): BrowserIndexedDbProjectStore | null {
  if (sharedCanonicalEnvelopeStore === undefined) {
    sharedCanonicalEnvelopeStore = typeof indexedDB === "undefined" ? null : new BrowserIndexedDbProjectStore();
  }
  return sharedCanonicalEnvelopeStore;
}

// B03: persisted canonical-head claims, keyed by the EXACT board object they
// were saved with (a claim is only meaningful for that board). Hydration
// stages a claim; the history (re)seed effect consumes it when — and only
// when — that board becomes the editor board. The session then VERIFIES the
// claim; a stale one is refused and a fresh lineage derives from the board.
const pendingCanonicalClaims = new WeakMap<PcbBoard, PcbCanonicalHead>();
import type { EditCommand, SelectionRef } from "@/app/lib/pcb/edit/commands"; // Stage 17
import { ContextMenu, type ContextMenuItem } from "./ContextMenu"; // Stage 17
import { Inspector } from "./Inspector"; // Stage 17 Phase B
import { ensureBoardPadstacks } from "@/app/lib/pcb/padstack/migrate"; // Stage 17 Phase C
import { migrateBoardElectricalIdentities } from "@/app/lib/pcb/integrity";
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
import { makePlaneZone, reconcileStackupPlaneZones } from "@/app/lib/pcb/zones/plane"; // Stage 11 / native planes
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
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { evaluatePcbFabricationReadiness, readinessViewModel } from "@/app/lib/pcb/readiness/evaluate";
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
import { AssignmentQueuePanel } from "./AssignmentQueuePanel";

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

// Retained only for explicit legacy-import reporting; durable sync never calls it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

// Retained for explicit legacy import; authoritative sync adopts a verified GET record.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

export default function PcbEditor({
  schematic,
  active = true,
  hydrateToken = 0,
}: {
  schematic: SchematicState;
  /** R06: false while the editor is mounted but hidden (another workspace
   *  tab is fronted) — window-level shortcuts must not fire then. */
  active?: boolean;
  /** R06: bump to re-run board hydration (checkpoint restore, project switch). */
  hydrateToken?: number;
}) {
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
      const migration = migrateBoardElectricalIdentities(board, `demo:${demoParam ?? "default"}`);
      return { board: migration.board, demo: true, scope: null, lastSyncHash: null as string | null, diagnostics: migration.diagnostics };
    }
    try { return { board: null, demo: false, scope: ensureCurrentProjectScope(schematic), lastSyncHash: null as string | null, diagnostics: [] }; }
    catch { return { board: null, demo: false, scope: null, lastSyncHash: null as string | null, diagnostics: [] }; }
  });

  const [state, dispatch] = useReducer(reducer, init.board, makeEditorState);
  const [scene, setScene] = useState<PcbScene | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [placementWarning, setPlacementWarning] = useState<string | null>(null);
  const [lastSyncHash, setLastSyncHash] = useState<string | null>(init.lastSyncHash);
  // R06 final audit: the sync-time netlist SNAPSHOT state was removed. It had
  // no revision binding to the current schematic, and it was only ever
  // consulted when the live netlist could not be built — exactly the moment a
  // stale snapshot must NOT silently feed fabrication checks, readiness,
  // repair/verification context, or KiCad export. `liveNetlist` (derived from
  // the current schematic) is the only netlist source; when the schematic
  // cannot produce one, the truthful value is null ("unavailable").
  const [toast, setToast] = useState<string | null>(() => init.diagnostics[0]?.summary ?? null);
  const [pendingPreflight, setPendingPreflight] = useState<PcbSyncPreflightResult | null>(null);
  const [applying, setApplying] = useState(false);
  const [authoritativeRecord, setAuthoritativeRecord] = useState<PcbSyncBoardRecord | null>(null);
  const applyingRef = useRef(false);
  const authorityRef = useRef<PcbSyncBoardRecord | null>(null);
  const syncIdentity = useMemo(() => init.scope ? { ...init.scope, designId: `design:${init.scope.projectId}`, boardId: `board:${init.scope.projectId}`, assemblyVariantId: "variant-default" } : null, [init.scope]);
  const client = useMemo(() => syncIdentity ? new PcbSyncClient({ tenantId: syncIdentity.tenantId, projectId: syncIdentity.projectId, branchId: syncIdentity.branchId, actor: { actorId: "local-user", actorKind: "human", role: "project_admin", sessionId: "pcb-editor-demo" } }) : null, [syncIdentity]);
  const snapshotRevisionRef = useRef(syncIdentity ? loadPcbSnapshotRevision(syncIdentity.projectId) : 0);

  // Refs so the (stable) pointer callback sees current values without resubscribing.
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  const boardRef = useRef(state.board);
  const toolRef = useRef(state.tool);
  const dragRef = useRef<OutlineHandleId | null>(null);
  const schematicRef = useRef(schematic);
  useEffect(() => {
    boardRef.current = state.board;
    toolRef.current = state.tool;
    schematicRef.current = schematic;
  }, [state.board, state.tool, schematic]);
  useEffect(() => { authorityRef.current = authoritativeRecord; }, [authoritativeRecord]);
  // ── R06 board hydration: durable server authority + local working copy ────
  // Rules (Section 5): same ancestry → newest complete valid state wins (the
  // working copy extends the exact authoritative base, so it wins when its
  // base matches the server revision); diverged → the working copy is stashed
  // as a recoverable conflict record, never silently overwritten; no server
  // board → the working copy alone restores the editor.
  // Explicit checkpoint restore beats every other hydration source.
  useEffect(() => {
    if (init.demo) return;
    const onRestore = () => {
      const board = consumePendingBoardRestore();
      if (board) dispatch({ type: "set-board", board });
    };
    window.addEventListener(BOARD_RESTORE_EVENT, onRestore);
    return () => window.removeEventListener(BOARD_RESTORE_EVENT, onRestore);
  }, [init.demo]);

  useEffect(() => {
    if (init.demo || !client || !syncIdentity) return;
    let cancelled = false;
    void client.loadBoard(syncIdentity.boardId).then((loaded) => {
      if (cancelled) return;
      const restored = consumePendingBoardRestore();
      if (restored) {
        if (loaded.ok && loaded.value.status === "found" && loaded.value.record) {
          saveAuthoritativeBoardCache(loaded.value.record);
          setAuthoritativeRecord(loaded.value.record);
        }
        dispatch({ type: "set-board", board: restored });
        return;
      }
      const working = loadWorkingCopy(syncIdentity.projectId);
      if (!loaded.ok) {
        if (loaded.kind !== "not_found") {
          setToast(`Server board load failed: ${loaded.code}${loaded.detail ? ` — ${loaded.detail}` : ""}${working ? ". Restored your local working copy; durable authority unverified." : ""}`);
        }
        if (working) {
          if (working.canonicalHead) pendingCanonicalClaims.set(working.board, working.canonicalHead);
          dispatch({ type: "set-board", board: working.board });
        }
        return;
      }
      if (loaded.value.status !== "found" || !loaded.value.record) {
        if (working) {
          if (working.canonicalHead) pendingCanonicalClaims.set(working.board, working.canonicalHead);
          dispatch({ type: "set-board", board: working.board });
        }
        return;
      }
      const record = loaded.value.record;
      saveAuthoritativeBoardCache(record);
      setAuthoritativeRecord(record);
      if (!working) {
        dispatch({ type: "set-board", board: normalizeBoardForEditor(record.board, syncIdentity.projectId) });
        return;
      }
      if (working.baseRevision === record.revision) {
        // Same ancestry: the local copy extends the current authority — it is
        // the newest complete state. Restore the user's editor work.
        if (working.canonicalHead) pendingCanonicalClaims.set(working.board, working.canonicalHead);
        dispatch({ type: "set-board", board: working.board });
        return;
      }
      // Diverged: server moved past this copy's base. Preserve, don't pick.
      stashWorkingConflict(syncIdentity.projectId, working, `Server board advanced to revision ${record.revision} while this local copy was based on ${working.baseRevision ?? "no durable base"}.`);
      dispatch({ type: "set-board", board: normalizeBoardForEditor(record.board, syncIdentity.projectId) });
      setToast("The durable server board advanced past your local working copy. The server board was loaded; your local copy was preserved as a recoverable conflict record.");
    });
    return () => { cancelled = true; };
  }, [client, init.demo, syncIdentity, hydrateToken]);

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

  // R06 follow-up: the schematic netlist is DERIVED state — build it live
  // from the current schematic instead of only materializing it as a side
  // effect of clicking Sync. Before this, every reload left `netlist` null,
  // so fabrication checks reported SCHEMATIC_PARITY_NOT_EVALUATED, DRC ran
  // without connectivity intent, and KiCad export went netlist-less until the
  // user happened to re-sync. Null only while parts are still loading or the
  // schematic fails netlist prerequisites (both truthful "unavailable" cases).
  const liveNetlist = useMemo(() => {
    void partsTick; // re-run when a part loads
    try {
      return buildNetlist(schematic, getCachedPart);
    } catch {
      return null;
    }
  }, [schematic, partsTick]);
  const currentHash = useMemo(() => (liveNetlist ? netlistHash(liveNetlist) : null), [liveNetlist]);
  const dirty =
    state.board !== null &&
    !init.demo &&
    currentHash !== null &&
    currentHash !== lastSyncHash;

  // R06: durable checkpoint carrying the board (placement/route/sync/release).
  const boardCheckpoint = useCallback((label: string, board: PcbBoard) => {
    const scope = init.scope;
    if (!scope) return;
    const s = schematicRef.current;
    void checkpointStore().add({
      projectId: scope.projectId, label, at: Date.now(),
      schematic: { components: s.components, wires: s.wires, kicadComponents: s.kicadComponents ?? [], netLabels: s.netLabels ?? [] },
      board,
      boardBase: { revision: authorityRef.current?.revision ?? null, digest: authorityRef.current?.digest ?? null },
      workflowView: "pcb",
    }).catch((error: unknown) => setToast(`Checkpoint could not be saved: ${error instanceof Error ? error.message : String(error)}`));
  }, [init.scope]);

  // ── Sync (also the empty-state CTA) ────────────────────────────────────────
  // R06: the placement dialog's choice is honored at APPLY time — staged
  // (off-board) footprints from the durable plan are arranged onto the board.
  const placementChoiceRef = useRef<{ centerNewParts: boolean } | null>(null);
  const handleSync = useCallback(async (placement?: { centerNewParts?: boolean; spreadOverlaps?: boolean; preserveAbsoluteCoordinates?: boolean }) => {
    placementChoiceRef.current = { centerNewParts: placement?.centerNewParts !== false && placement?.preserveAbsoluteCoordinates !== true };
    if (syncing || !client || !syncIdentity) return;
    setSyncing(true);
    try {
      const s = schematicRef.current;
      // Part catalog data must be in the cache before buildNetlist runs.
      await Promise.allSettled(
        [...new Set((s.kicadComponents ?? []).map((k) => k.partId))].map((id) =>
          ensurePartLoaded(id),
        ),
      );
      // Every instance carrying published atomic authority gets its Stage 1
      // physical binding ensured through the ordinary lifecycle
      // (create → select → revalidate → approve) under this user's identity
      // before publication, so preflight resolution finds rank-1 authority.
      // Instances without atomic identity are left alone and fail closed.
      const atomicInstances = (s.kicadComponents ?? []).filter((k) => k.atomicPartRevisionId);
      const bindingHeaders = {
        "content-type": "application/json",
        "x-sirkit-tenant-id": syncIdentity.tenantId,
        "x-sirkit-project-id": syncIdentity.projectId,
        "x-sirkit-branch-id": syncIdentity.branchId,
        "x-sirkit-actor-id": "local-user",
        "x-sirkit-actor-kind": "human",
        "x-sirkit-role": "project_admin",
        "x-sirkit-session-id": "pcb-editor-demo",
      };
      // Each binding is a durable multi-write transaction; a small concurrency
      // cap overlaps their latency without crowding the database pooler's
      // session limit. Live progress is shown on the Sync button — the first
      // pass takes seconds per component; replays of already-bound parts are
      // fast and idempotent, so re-clicking Sync after an interruption resumes.
      const bindingFailures: string[] = [];
      const bindQueue = [...atomicInstances];
      let boundCount = 0;
      if (atomicInstances.length) setSyncProgress(`Binding parts 0/${atomicInstances.length}…`);
      const bindWorker = async () => {
        for (let k = bindQueue.shift(); k; k = bindQueue.shift()) {
          try {
            const res = await fetch("/api/physical-bindings", {
              method: "POST",
              headers: bindingHeaders,
              body: JSON.stringify({ operation: "bind_atomic_selection", componentInstanceId: k.id, boardInstanceId: syncIdentity.boardId, atomicPartRevisionId: k.atomicPartRevisionId }),
            });
            if (!res.ok) {
              const detail = (await res.json().catch(() => null)) as { code?: string } | null;
              bindingFailures.push(`${k.refDes} (${detail?.code ?? res.status})`);
            }
          } catch {
            bindingFailures.push(k.refDes);
          }
          boundCount += 1;
          setSyncProgress(`Binding parts ${boundCount}/${atomicInstances.length}…`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, atomicInstances.length) }, bindWorker));
      if (bindingFailures.length) { setToast(`Component binding failed: ${bindingFailures.join(", ")}`); return; }
      setSyncProgress("Publishing schematic…");
      const currentNetlist = buildNetlist(s, getCachedPart), graph = buildPcbSyncPublicationGraph(s, getCachedPart), token = graph.sourceDigest.replace(/^sha256:/, "").slice(0, 40), now = new Date().toISOString();
      const published = await client.publish({ requestSchemaVersion: PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION, requestId: `publish:${token}`, designId: syncIdentity.designId, boardId: syncIdentity.boardId, boardName: "Main Board", projectRevision: `project:${token}`, designRevision: `design:${token}`, schematicRevision: `schematic:${token}`, componentSetRevision: `components:${token}`, netGraphRevision: `netgraph:${token}`, assemblyVariantId: syncIdentity.assemblyVariantId, assemblyVariantRevision: "variant:default:1", librarySnapshotRevision: "library:current:1", expectedSnapshotRevision: snapshotRevisionRef.current, idempotencyKey: `publish:${token}`, components: graph.components, nets: graph.nets, prerequisiteIssues: graph.prerequisiteIssues, sourceDigest: graph.sourceDigest, requestedAt: now });
      if (!published.ok) { setToast(`Publication failed: ${published.code}${published.detail ? ` — ${published.detail}` : ""}`); return; }
      snapshotRevisionRef.current = published.value.snapshotRevision; savePcbSnapshotRevision(syncIdentity.projectId, published.value.snapshotRevision);
      setSyncProgress("Preflighting board plan…");
      const current = authorityRef.current, result = await client.preflight({ requestSchemaVersion: PCB_SYNC_REQUEST_VERSION, requestId: `preflight:${token}`, designId: syncIdentity.designId, schematicRevision: published.value.snapshot.schematicRevision, assemblyVariantId: syncIdentity.assemblyVariantId, target: current ? { kind: "existing_board", boardId: syncIdentity.boardId, expectedBoardRevision: current.revision } : { kind: "new_board", boardId: syncIdentity.boardId, boardName: "Main Board", boardFormatVersion: "sirkit-json-pcb/1" }, resolutionPolicyId: "sirkit.default-footprint-resolution", resolutionPolicyVersion: "1.0.0", syncPolicyId: "sirkit.safe-pcb-sync", syncPolicyVersion: "1.0.0", requestedAt: now, mode: "prepare_apply" });
      if (!result.ok) { setToast(`Preflight failed: ${result.code}${result.detail ? ` — ${result.detail}` : ""}`); return; }
      setLastSyncHash(netlistHash(currentNetlist)); setPendingPreflight(result.value.plan ? result.value : null); setPlacementWarning(null);
      setToast(result.value.status === "ready_to_apply" && result.value.plan ? "Preflight ready. Review and explicitly apply the durable plan." : result.value.status === "ready_no_changes" ? "PCB is already synchronized." : `Sync blocked: ${result.value.blockers.map((item) => `${item.code} ${item.displayRefs.join(",")}`).join("; ") || result.value.status}`);
      setSyncDialogOpen(false);
    } catch (err) {
      setToast(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }, [client, syncIdentity, syncing]);

  const handleApplySync = useCallback(async () => {
    const plan = pendingPreflight?.plan; if (!client || !syncIdentity || !plan || applyingRef.current) return;
    applyingRef.current = true; setApplying(true);
    try {
      const result = await client.apply({ requestSchemaVersion: PCB_SYNC_APPLY_REQUEST_VERSION, requestId: `apply:${plan.planId}`, designId: syncIdentity.designId, boardId: syncIdentity.boardId, planId: plan.planId, planDigest: plan.planDigest, expectedPlanLifecycle: "applicable", confirmation: "apply_exact_plan", idempotencyKey: `apply:${plan.planId}`, warningAcknowledgements: plan.prerequisites.filter((item) => !item.blocking).map((item) => item.code), requestedAt: new Date().toISOString() });
      if (!result.ok || !["applied", "idempotent_replay"].includes(result.value.status) || !result.value.committedBoardRevision || !result.value.committedBoardDigest) { setToast(`Apply failed: ${result.ok ? result.value.status : `${result.code}${result.detail ? ` — ${result.detail}` : ""}`}`); return; }
      const loaded = await client.loadBoard(syncIdentity.boardId); if (!loaded.ok || loaded.value.status !== "found" || !loaded.value.record || loaded.value.record.revision !== result.value.committedBoardRevision || loaded.value.record.digest !== result.value.committedBoardDigest) { setToast("Apply committed, but authoritative board verification failed; the current editor board was preserved."); return; }
      const record = loaded.value.record; if (!saveAuthoritativeBoardCache(record)) { setToast("Authoritative board committed, but its matching browser cache could not be stored."); }
      setAuthoritativeRecord(record);
      // Honor the sync dialog's placement choice: staged (off-board) plan
      // footprints are arranged onto the board deterministically. The server
      // record stays the untouched authority; the arranged board is the local
      // working copy layered on it.
      const adopted = normalizeBoardForEditor(record.board, syncIdentity.projectId);
      const arranged = placementChoiceRef.current?.centerNewParts ? arrangeStagedFootprints(adopted) : null;
      dispatch({ type: "set-board", board: arranged ?? adopted });
      setPendingPreflight(null);
      setToast(arranged
        ? "Durable PCB plan applied and verified; imported footprints were arranged near the board center."
        : "Durable PCB plan applied and verified from the authoritative server board.");
      boardCheckpoint(`Synchronized PCB (server revision ${record.revision.slice(0, 12)}…)`, arranged ?? record.board);
    } finally { applyingRef.current = false; setApplying(false); }
  }, [client, pendingPreflight, syncIdentity, boardCheckpoint]);

  // ── History + move tool lifecycle ──────────────────────────────────────────
  // Boards arriving from OUTSIDE the history stack (initial load, demo, sync)
  // reseed it — undo does not span a re-sync. Boards emitted BY the stack are
  // recognized by identity and keep it.
  useEffect(() => {
    if (!scene || !state.board) return;
    if (historyRef.current && historyRef.current.present === state.board) return;
    historyCleanupRef.current?.();
    // B03: every fresh history gets a canonical session. The wrapped history
    // is a drop-in PcbHistory — undo/redo stay synchronous for the UI and are
    // reconciled onto the canonical lineage as audited inverse transactions.
    // A reseed (sync, restore, project switch) starts a NEW lineage, so a
    // pending claim is consumed exactly once, for the board it was saved with.
    const raw = createHistory(state.board);
    const claim = pendingCanonicalClaims.get(state.board) ?? null;
    const bound = bindCanonicalEditorSession(
      raw,
      syncIdentity
        ? { tenantId: syncIdentity.tenantId, projectId: syncIdentity.projectId, branchId: syncIdentity.branchId }
        : { tenantId: "local", projectId: init.demo ? "demo" : "local", branchId: "main" },
      // Demo boards never persist; real projects mirror the canonical
      // envelope durably for exact-head reload (B03.1).
      { claim, ...(init.demo || !syncIdentity ? {} : { durableStore: canonicalEnvelopeStore() ?? undefined }) },
    );
    const history = bound.history;
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
      bound.session.dispose();
    };
  }, [scene, selectionStore, state.board, syncIdentity, init.demo]);
  useEffect(() => () => historyCleanupRef.current?.(), []);

  // ── R06: working-copy autosave, staleness, board checkpoints ───────────────
  const [boardSaveState, setBoardSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [routeStaleNotice, setRouteStaleNotice] = useState<string | null>(null);
  const boardSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBoardSaveRef = useRef<(() => void) | null>(null);
  const lastCheckpointEntryRef = useRef<string | null>(null);

  useEffect(() => {
    if (init.demo || !syncIdentity || !state.board) return;
    const board = state.board;
    // Deferred so the effect body itself never sets state synchronously.
    const savingTick = setTimeout(() => setBoardSaveState("saving"), 0);
    const run = () => {
      pendingBoardSaveRef.current = null;
      const base = authorityRef.current ? { revision: authorityRef.current.revision, digest: authorityRef.current.digest } : null;
      // B03: persist the canonical head identity ONLY when this exact board is
      // the canonical head (a legacy-path edit clears it — reload then derives
      // a fresh lineage from the board instead of trusting a stale claim).
      const canonicalHead = canonicalSessionFor(historyRef.current)?.headMetadataFor(board) ?? null;
      const ok = saveWorkingCopy(syncIdentity.projectId, board, base, canonicalHead);
      setBoardSaveState(ok ? "saved" : "error");
      if (!ok) setToast("PCB autosave FAILED: browser storage write failed (quota exceeded or unavailable). Your latest board changes are not saved.");
      // Section 8: routing evidence names an exact board revision — when the
      // board content moved past it, the routing (and any release) is stale.
      const evidence = loadStageEvidence(syncIdentity.projectId);
      if (evidence.routedBoardRevision) {
        const current = pcbRevisionId(board);
        setRouteStaleNotice(current === evidence.routedBoardRevision ? null : `The board changed after the last routing run (now ${current.slice(0, 18)}…, routed at ${evidence.routedBoardRevision.slice(0, 18)}…). The routed result and any release evidence are stale — re-route before releasing.`);
      } else {
        setRouteStaleNotice(null);
      }
    };
    pendingBoardSaveRef.current = run;
    if (boardSaveTimerRef.current) clearTimeout(boardSaveTimerRef.current);
    boardSaveTimerRef.current = setTimeout(run, 600);
    return () => { clearTimeout(savingTick); if (boardSaveTimerRef.current) clearTimeout(boardSaveTimerRef.current); };
  }, [state.board, init.demo, syncIdentity]);
  // Flush the pending board save on navigation/close and on unmount.
  useEffect(() => {
    const flush = () => pendingBoardSaveRef.current?.();
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, []);

  // Durable checkpoints + stage evidence for large committed transactions.
  useEffect(() => {
    if (init.demo || !syncIdentity || !state.board) return;
    const entries = visibleHistory.entries;
    const last = entries.at(-1);
    if (!last || last.state !== "applied" || lastCheckpointEntryRef.current === last.id) return;
    const label = last.metadata.operationType === "auto_place_footprints" ? "Placed footprints"
      : last.metadata.operationType === "autoroute_completion" ? "Routed PCB"
      : null;
    if (!label) return;
    lastCheckpointEntryRef.current = last.id;
    boardCheckpoint(label, state.board);
    if (last.metadata.operationType === "autoroute_completion") {
      const board = state.board;
      // Deferred: persisting evidence + clearing the banner are reactions to
      // an external commit, not synchronous render state.
      const tick = setTimeout(() => {
        saveStageEvidence(syncIdentity.projectId, { routedBoardRevision: pcbRevisionId(board), routedAt: Date.now() });
        setRouteStaleNotice(null);
      }, 0);
      return () => clearTimeout(tick);
    }
  }, [visibleHistory, state.board, init.demo, syncIdentity, boardCheckpoint]);

  // ── R06: server qualification (real router + RC01–RC03) and MFG01 release ──
  const [qualifying, setQualifying] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const scopeHeaders = useCallback((): Record<string, string> => syncIdentity ? {
    "content-type": "application/json",
    "x-sirkit-tenant-id": syncIdentity.tenantId,
    "x-sirkit-project-id": syncIdentity.projectId,
    "x-sirkit-branch-id": syncIdentity.branchId,
    "x-sirkit-actor-id": "local-user",
    "x-sirkit-actor-kind": "human",
    "x-sirkit-role": "project_admin",
    "x-sirkit-session-id": "pcb-editor-demo",
  } : {}, [syncIdentity]);

  const handleQualify = useCallback(async () => {
    if (!syncIdentity || qualifying) return;
    if (!authorityRef.current) { setToast("Qualification needs an applied durable board — run Schematic → PCB and apply the sync plan first."); return; }
    setQualifying(true);
    try {
      const res = await fetch("/api/pcb/qualify", { method: "POST", headers: scopeHeaders(), body: JSON.stringify({ boardId: syncIdentity.boardId, designId: syncIdentity.designId }) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; code?: string; error?: string; rc02?: { remainingConnections: number; shorts: number; routeBlockingDrcErrors: number }; boardRevision?: string } | null;
      if (!res.ok || !body?.ok) { setToast(`Qualification failed: ${body?.code ?? res.status}${body?.error ? ` — ${body.error}` : ""}`); return; }
      // Adopt the server-routed, verified board as the new authority.
      const loaded = await client?.loadBoard(syncIdentity.boardId);
      if (loaded?.ok && loaded.value.status === "found" && loaded.value.record) {
        const record = loaded.value.record;
        saveAuthoritativeBoardCache(record);
        setAuthoritativeRecord(record);
        const editorBoard = normalizeBoardForEditor(record.board, syncIdentity.projectId);
        dispatch({ type: "set-board", board: editorBoard });
        saveStageEvidence(syncIdentity.projectId, { routedBoardRevision: pcbRevisionId(editorBoard), routedAt: Date.now() });
        setRouteStaleNotice(null);
        boardCheckpoint("Qualified and routed board (server, RC01–RC03 verified)", editorBoard);
      }
      setToast(`Board qualified: routed with 0 remaining connections, 0 shorts, 0 route-blocking DRC errors (server revision ${body.boardRevision?.slice(0, 12) ?? "?"}…).`);
    } catch (error) {
      setToast(`Qualification failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setQualifying(false);
    }
  }, [syncIdentity, qualifying, client, scopeHeaders, boardCheckpoint]);

  /**
   * MFG01 verified release: the server reloads its OWN durable authority,
   * recomputes RC01–RC03, and packages a deterministic ZIP. A browser board
   * never becomes release authority — this is the only verified-release
   * path, shared by the toolbar button AND the Send-to-fab dialog.
   */
  const performVerifiedRelease = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    if (!syncIdentity) return { ok: false, message: "No durable project scope is active." };
    if (releasing) return { ok: false, message: "A release is already running." };
    setReleasing(true);
    try {
      const res = await fetch("/api/pcb/release", { method: "POST", headers: scopeHeaders(), body: JSON.stringify({ boardId: syncIdentity.boardId, designId: syncIdentity.designId }) });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string; error?: string } | null;
        return {
          ok: false,
          message: body?.code === "MFG_AUTHORITY_NOT_FOUND"
            ? "Release blocked: no manufacturing authority exists yet. Run “Qualify & route” first."
            : `Release failed: ${body?.code ?? res.status}${body?.error ? ` — ${body.error}` : ""}`,
        };
      }
      const releaseId = res.headers.get("X-Sirkit-Release-Id") ?? "release";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sirkit-${syncIdentity.boardId.replace(/[^A-Za-z0-9_-]/g, "-")}-${releaseId.slice(-12)}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      const board = authorityRef.current?.board ?? boardRef.current;
      if (board) {
        saveStageEvidence(syncIdentity.projectId, { releasedBoardRevision: pcbRevisionId(board), releasedAt: Date.now(), releaseId });
        boardCheckpoint("Released manufacturing package", board);
      }
      return { ok: true, message: `Verified manufacturing release downloaded (${releaseId.slice(-12)}). RC01–RC03 were recomputed server-side against the durable authority before packaging.` };
    } catch (error) {
      return { ok: false, message: `Release failed: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      setReleasing(false);
    }
  }, [syncIdentity, releasing, scopeHeaders, boardCheckpoint]);

  const handleRelease = useCallback(async () => {
    const result = await performVerifiedRelease();
    setToast(result.message);
  }, [performVerifiedRelease]);

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
    getNetlist: () => liveNetlist,
    toast: setToast,
    onApplied: () => drc.run(),
  });
  const liveReadinessReport = useMemo(() => {
    if (!state.board) return undefined;
    const drcPreset = getPreset(drc.activePresetId);
    const fabPreset = getFabPreset(drc.activePresetId);
    return evaluatePcbFabricationReadiness({
      board: state.board,
      netlist: liveNetlist ?? undefined,
      drcPreset,
      fabPreset,
    });
  }, [state.board, liveNetlist, drc.activePresetId]);
  const liveReadiness = liveReadinessReport ? readinessViewModel(liveReadinessReport) : undefined;

  // ── Stage 15: 3D preview panel ──────────────────────────────────────────────
  const [preview3dOpen, setPreview3dOpen] = useState(false);

  // ── Stage 17: padstack library panel (right column, not a modal) ───────────
  const [padstacksOpen, setPadstacksOpen] = useState(false);
  const [assignmentsOpen, setAssignmentsOpen] = useState(false);
  const [assignmentScope] = useState(() => loadCurrentProjectScope());

  // ── Stage 17 Phase D: command palette (Ctrl+K) + floating AI assist ────────
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);

  // ── Stage 14: "Send to fab" bundle export ───────────────────────────────────
  const [fabDialogOpen, setFabDialogOpen] = useState(false);
  const fabExport = useFabExport({
    getBoard: () => init.demo ? boardRef.current : authorityRef.current?.board ?? null,
    getNetlist: () => liveNetlist,
    recordRelease: (manifest) => {
      if (!init.demo && !saveCurrentManufacturingRelease(manifest)) {
        setToast("Bundle downloaded, but the historical release record could not be saved to this project.");
      }
    },
    // R06 follow-up: verified releases go through the MFG01 server-
    // authoritative loader — the legacy endpoint rightly refuses to mint
    // release authority from a browser board.
    ...(init.demo ? {} : { verifiedRelease: performVerifiedRelease }),
  });

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
    getNetlist: () => liveNetlist,
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
    getDrcPresetId: () => drc.activePresetId,
    getNetlist: () => liveNetlist,
  });

  // ── Scene sync (state → scene) ────────────────────────────────────────────
  useEffect(() => {
    if (state.board) scene?.setBoard(state.board);
  }, [scene, state.board]);

  useEffect(() => {
    const candidate = autoPlace.state === "done" && autoPlace.lastResult?.report.success
      ? autoPlace.lastResult.engineering?.selectedCandidate
      : undefined;
    scene?.setPlacementPreview(candidate ? candidate.moves.map((move) => ({ id: move.instanceId, at: move.after.position, rotationDeg: move.after.rotationDeg, side: move.after.side })) : null);
  }, [scene, state.board, autoPlace.state, autoPlace.lastResult]);

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
        case "leave": {
          if (dragRef.current !== null) {
            // R06: an interrupted outline-handle drag must not leave a silent
            // uncommitted mutation — commit it as a visible history entry,
            // exactly like pointer-up does.
            dragRef.current = null;
            const h = historyRef.current;
            const outline = boardRef.current?.outline;
            if (h && outline && outline !== h.present.outline) {
              h.execute("Edit outline", (d) => { d.outline = outline; });
            }
            return;
          }
          moveToolRef.current?.handlePointer(e);
          return;
        }
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
      if (!activeRef.current) return; // hidden editor never owns the keyboard
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
        void applyEditsCanonical(h, cmds).then((result) => {
          if (!result.ok) setToast(result.errors[0]);
        });
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
          void applyEditsCanonical(h, [{ op: "delete-items", refs: deletable }]).then((result) => {
            if (!result.ok) setToast(result.errors[0]);
          });
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
      void applyEditsCanonical(h, cmds).then((result) => {
        if (!result.ok) setToast(result.errors[0]);
      });
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
          const b = init.demo ? boardRef.current : authorityRef.current?.board;
          if (b) void downloadKicadPcb(b, liveNetlist);
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
            {syncing && syncProgress ? syncProgress : "Schematic → PCB"}
          </button>
          <button
            type="button"
            onClick={() => setSyncDialogOpen(true)}
            disabled={syncing}
            className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
          >
            Placement options
          </button>
          {pendingPreflight?.plan && <button type="button" onClick={() => void handleApplySync()} disabled={applying} className="mt-3 rounded border border-teal-500 px-3 py-1.5 text-xs text-teal-200 disabled:opacity-50">{applying ? "Applying…" : "Apply verified plan"}</button>}
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
              reconcileStackupPlaneZones(d);
            });
            else dispatch({ type: "set-stackup", stackup });
          }}
          outline={state.board.outline}
          onOutlineChange={(outline) => {
            // R06 Section 10: outline edits must be VISIBLE history entries.
            // The old fallback dispatched a silent set-outline before the
            // history existed — an untraceable board mutation that immediately
            // invalidated routing evidence. Refuse instead of mutating silently.
            const h = historyRef.current;
            if (!h) { setToast("Board outline is still loading — try again in a moment."); return; }
            h.execute("Edit outline", (d) => {
              d.outline = outline;
              reconcileStackupPlaneZones(d);
            });
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
          onToggleAssignments={assignmentScope ? () => setAssignmentsOpen((open) => !open) : undefined}
          assignmentsOpen={assignmentsOpen}
          onUndo={() => historyRef.current?.undo()}
          onRedo={() => historyRef.current?.redo()}
          canUndo={visibleHistory.canUndo}
          canRedo={visibleHistory.canRedo}
          undoLabel={visibleHistory.undoLabel}
          redoLabel={visibleHistory.redoLabel}
          historyEntries={visibleHistory.entries}
          readiness={liveReadiness}
          onExportKicad={() => { const b = init.demo ? boardRef.current : authorityRef.current?.board; if (b) void downloadKicadPcb(b, liveNetlist); else setToast("Export requires a verified authoritative board."); }} // Stage 13
          onSendToFab={() => setFabDialogOpen(true)} // Stage 14
          onShowShortcuts={shortcuts.show} // Stage 16
        >
          <SyncButton
            dirty={dirty}
            syncing={syncing}
            progress={syncProgress}
            onSync={() => void handleSync({ centerNewParts: true, spreadOverlaps: true })}
            onOptions={() => setSyncDialogOpen(true)}
          />
          {pendingPreflight?.plan && <button type="button" onClick={() => void handleApplySync()} disabled={applying} className="ml-2 rounded border border-teal-500 px-2 py-1 text-[11px] text-teal-200 disabled:opacity-50">{applying ? "Applying…" : "Apply sync plan"}</button>}
          {!init.demo && syncIdentity && (
            <>
              <button
                type="button"
                onClick={() => void handleQualify()}
                disabled={qualifying || !authoritativeRecord}
                title={!authoritativeRecord ? "Needs an applied durable board — run Schematic → PCB and apply the plan first" : "Server-side autonomous placement + real FreeRouting + RC01–RC03 verification"}
                className="ml-2 rounded border border-zinc-600 px-2 py-1 text-[11px] text-zinc-200 hover:border-teal-500 disabled:opacity-50"
              >
                {qualifying ? "Qualifying… (runs the real router)" : "Qualify & route"}
              </button>
              <button
                type="button"
                onClick={() => void handleRelease()}
                disabled={releasing || routeStaleNotice !== null}
                title={routeStaleNotice ? `Release blocked — ${routeStaleNotice}` : "MFG01 verified manufacturing release (server recomputes RC01–RC03, deterministic Gerber ZIP)"}
                className="ml-1 rounded border border-zinc-600 px-2 py-1 text-[11px] text-zinc-200 hover:border-teal-500 disabled:opacity-50"
              >
                {releasing ? "Releasing…" : "Release ZIP"}
              </button>
              <span
                className={`ml-2 text-[11px] ${boardSaveState === "error" ? "text-red-300" : "text-zinc-500"}`}
                data-testid="pcb-save-status"
              >
                {boardSaveState === "saving" ? "Saving…" : boardSaveState === "saved" ? "Saved" : boardSaveState === "error" ? "Save failed" : ""}
              </span>
            </>
          )}
        </PcbToolbar>
        <div className="relative flex-1 min-h-0">
          <PcbCanvas onReady={handleSceneReady} />
          {routeStaleNotice && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 max-w-xl rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-200" data-testid="route-stale-banner">
              Routing evidence is stale: {routeStaleNotice}
            </div>
          )}
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
          {assignmentsOpen && assignmentScope && <AssignmentQueuePanel scope={{ ...assignmentScope, assemblyVariantId: "default" }} onClose={() => setAssignmentsOpen(false)} />}
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
              reconcileStackupPlaneZones(draft);
            });
          }}
        />
        <PlacementSetup
          board={state.board}
          result={autoPlace.lastResult}
          onApply={autoPlace.apply}
          onDiscard={autoPlace.discard}
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
          <DrcPanel drc={drc} repair={repair} readiness={liveReadinessReport} constraintProgram={state.board.constraintState?.activeProgram} />
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
