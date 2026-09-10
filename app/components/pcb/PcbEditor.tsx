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

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
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
  type PcbNetlist,
  type SyncReport,
} from "@/app/lib/pcb/netlist-bridge";
import type { EditorContextBridge } from "@/app/lib/agent/editor-context-bridge"; // B10
import { useEditorContextPublisher } from "@/app/lib/agent/use-editor-context-publisher"; // B10.1
import { projectAgentNetlist } from "@/app/lib/agent/netlist-validation"; // B10.1
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model"; // B10
import { ensureCurrentProjectScope, loadCurrentProjectScope, loadPcbSnapshotRevision, loadStageEvidence, loadWorkingCopy, normalizeBoardForEditor, saveAuthoritativeBoardCache, saveCurrentManufacturingRelease, savePcbSnapshotRevision, saveStageEvidence, saveWorkingCopy, stashWorkingConflict } from "@/app/lib/pcb/board-persistence";
import { pcbBoardInstanceId, pcbDesignInstanceId, PCB_BOARD_ASSEMBLY_VARIANT_ID } from "@/app/lib/pcb/board-identity";
import { checkpointStore } from "@/app/lib/project/checkpoints";
import type { AiRequestOwnership } from "@/app/lib/ai-preferences";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { arrangeStagedFootprints } from "@/app/lib/pcb/autoplace/arrange-staged";
import { BOARD_RESTORE_EVENT, consumePendingBoardRestore } from "@/app/lib/pcb/board-restore";
import { PcbSyncClient } from "@/app/lib/pcb-sync/client";
import { PCB_SYNC_APPLY_REQUEST_VERSION, PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION, PCB_SYNC_REQUEST_VERSION, type PcbSyncBoardRecord, type PcbSyncBoardRevisionPreviewResult, type PcbSyncPreflightResult } from "@/app/lib/pcb-sync/types";
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
import { ApprovedPcbMutationJournal } from "@/app/lib/engineering/approved-pcb-mutation-journal";
import { IndexedDbApprovedPcbMutationJournalStore } from "@/app/lib/engineering/approved-pcb-mutation-journal-idb";
import { approveAndApplyPcbEdit } from "@/app/lib/project/pcb-edit-approval-controller.internal";
import { createPcbApplyReauthorizer } from "@/app/lib/project/pcb-apply-reauthorization";
import { isPcbEditProposalExpired, verifySealedPcbEditProposalIntegrity, type SealedPcbEditProposal } from "@/app/lib/pcb/proposal/sealed-pcb-edit-proposal";
import { PcbProposalReviewDialog } from "./PcbProposalReviewDialog";
import type { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
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
import { getPreset, DEFAULT_PRESET_ID } from "@/app/lib/pcb/drc/presets"; // Stage 12
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { evaluatePcbFabricationReadiness, readinessViewModel } from "@/app/lib/pcb/readiness/evaluate";
import { getCachedPart, ensurePartLoaded, subscribeToPart } from "@/app/lib/parts-cache";
import { PcbCanvas } from "./PcbCanvas";
import { LayerPanel } from "./LayerPanel";
import { PcbToolbar } from "./PcbToolbar";
import { DebugHud } from "./DebugHud";
import { produce } from "immer";
import { divergenceNoticeCurrent, LOCAL_PCB_LIFECYCLE_IDENTITY, PcbBoardLifecycleOwner, settleServerCommit, type PcbBoardLifecycleIdentity, type PcbBoardLifecycleScope, type PcbServerDivergenceNotice, type ServerCommitSettlement } from "@/app/lib/pcb/lifecycle/board-lifecycle";
import { PcbOwnedOperationRegistry, runOwnedSyncPreparation, runVerifiedServerAdoption, type SyncPreparationServerStage } from "@/app/lib/pcb/lifecycle/owned-operations";
import { PcbEditorRuntime } from "@/app/lib/pcb/lifecycle/editor-runtime";
import { commitPcbCandidate } from "@/app/lib/engineering/pcb-commit-gateway";
import { SyncButton } from "./SyncButton";
import { SyncPlacementDialog } from "./SyncPlacementDialog";
import { ManufacturingWorkflowPanel } from "./ManufacturingWorkflowPanel"; // [B16.1C §F]
import { useManufacturingWorkflow } from "./hooks/useManufacturingWorkflow"; // [B16.1C §C/§F]
import { useComponentReview } from "./hooks/useComponentReview"; // [B16-C.2]
import { ComponentReviewPanel } from "./ComponentReviewPanel"; // [B16-C.2]
import { usePcb3dViewSession } from "./hooks/usePcb3dViewSession"; // [B17-C]
import { SnapshotConflictDialog } from "./SnapshotConflictDialog"; // [B16-C.3]
import { BoardRevisionDialog } from "./BoardRevisionDialog"; // [B16-C.1]
import { preflightBlockedByProtectedCopper, type BoardRevisionCarry } from "@/app/lib/pcb-sync/board-revision"; // [B16-C.1]
import type { PcbSyncSnapshotRevisionConflictDetails } from "@/app/lib/pcb-sync/types";
import { RoutingControls } from "./RoutingControls";
import { RoutingRulesPanel } from "./RoutingRulesPanel";
import { AutorouteSetup } from "./AutorouteSetup";
import { PlacementSetup } from "./PlacementSetup";
import { useDimensionTool } from "./hooks/useDimensionTool"; // B08
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
  tool: "select" | "pan" | "route" | "zone" | "silk" | "dimension"; // Stages 7/11/16 + B08 dimension
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
  | { type: "set-tool"; tool: "select" | "pan" | "route" | "zone" | "silk" | "dimension" } // Stages 7 + 11 + 16 + B08
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
  gateSchematicSync,
  aiOwnership,
  editorContextBridge,
  pcbProposalIntake,
  onPcbProposalSettled,
  currentInterlock,
}: {
  schematic: SchematicState;
  /** R06: false while the editor is mounted but hidden (another workspace
   *  tab is fronted) — window-level shortcuts must not fire then. */
  active?: boolean;
  /** R06: bump to re-run board hydration (checkpoint restore, project switch). */
  hydrateToken?: number;
  /** B07.2 — readiness gate evaluated at SYNC time: while the schematic's
   *  canonical session is conflicted or not ready, synchronization refuses
   *  truthfully instead of consuming an unresolved projection. */
  gateSchematicSync?: () => { allowed: true } | { allowed: false; reason: string };
  /** B07.5 (failure F) — project-generation ownership factory for AI
   *  requests (AssistBox, net-class briefs): captured per request so
   *  provider-failure events, retries, and response application all die
   *  with the owning project generation. */
  aiOwnership?: () => AiRequestOwnership;
  /** B10 — the page-owned editor-context bridge: this editor is the SOLE
   *  producer of the chat request's PCB working-copy snapshot (exact
   *  state.board + live selection + live netlist). Demo mode never
   *  publishes. */
  editorContextBridge?: EditorContextBridge;
  /** [B15.3 §I] the pending sealed bounded PCB edit proposal narrowed by the
   *  page's SAFE discriminator. Display grants nothing; apply authority
   *  lives behind this editor's approval controller (the PCB composition
   *  root), never the chat page or agent layer. */
  pcbProposalIntake?: { proposal: SealedPcbEditProposal; originRunId: string | null } | null;
  /** Settle the pending proposal (applied / cancelled / retired). */
  onPcbProposalSettled?: (outcome: "applied" | "cancelled" | "retired") => void;
  /** [B15.3 §J] the page-owned transition interlock accessor — the apply
   *  acquires its commit lease at the serialized position. */
  currentInterlock?: () => ProjectCommitInterlock | null;
}) {
  // Lint note (B08.3): this editor is an imperative orchestrator — canvas
  // scene, gesture tool, and history/session refs are deliberately mutated
  // across effects, which the react-hooks compiler rules reject (the same
  // pre-existing rule family as the accepted app/page.tsx baseline).
  // Before B08.3 those diagnostics were HIDDEN because the render-branch
  // lazy ref-init made the compiler bail out of the whole component; the
  // B08.3 state-held lifecycle owner removed that accidental bailout, so
  // the pre-existing findings now surface (documented baseline — not
  // suppressed, not introduced by B08.3 logic).
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
  const [authoritativeRecord, setAuthoritativeRecord] = useState<PcbSyncBoardRecord | null>(null);
  const authorityRef = useRef<PcbSyncBoardRecord | null>(null);
  // [B16-C.1] the board this session works on: the lineage ROOT (`board:<project>`) until the server's lineage says a
  // derived revision is current — then the editor follows it (a fresh browser learns this from the board load).
  const [currentBoardId, setCurrentBoardId] = useState<string | null>(null);
  const syncIdentity = useMemo(() => init.scope ? { ...init.scope, designId: pcbDesignInstanceId(init.scope.projectId), boardId: currentBoardId ?? pcbBoardInstanceId(init.scope.projectId), assemblyVariantId: PCB_BOARD_ASSEMBLY_VARIANT_ID } : null, [init.scope, currentBoardId]);
  // [B16-C.1] the rework plan for a NEW board revision (preview → human review → derive).
  const [boardRevisionOpen, setBoardRevisionOpen] = useState(false);
  const [boardRevisionPreview, setBoardRevisionPreview] = useState<PcbSyncBoardRevisionPreviewResult | null>(null);
  const [boardRevisionCarry, setBoardRevisionCarry] = useState<BoardRevisionCarry>({ copper: true, placement: true, constraints: true });
  const [boardRevisionBusy, setBoardRevisionBusy] = useState(false);
  const [boardRevisionError, setBoardRevisionError] = useState<string | null>(null);
  // B16.0: the client no longer asserts an actor/role — identity is derived
  // server-side from the authenticated session and project membership.
  const client = useMemo(() => syncIdentity ? new PcbSyncClient({ tenantId: syncIdentity.tenantId, projectId: syncIdentity.projectId, branchId: syncIdentity.branchId }) : null, [syncIdentity]);
  const snapshotRevisionRef = useRef(syncIdentity ? loadPcbSnapshotRevision(syncIdentity.projectId) : 0);
  // B08.2 — the FULL board lifecycle identity: the durable sync scope's
  // exact tenant/project/branch plus its board id (never a hardcoded
  // branch); demo/local editors carry an explicit local sentinel identity.
  const boardLifecycleIdentity = useMemo<PcbBoardLifecycleIdentity>(() => syncIdentity
    ? { tenantId: syncIdentity.tenantId, projectId: syncIdentity.projectId, branchId: syncIdentity.branchId, boardId: syncIdentity.boardId }
    : { ...LOCAL_PCB_LIFECYCLE_IDENTITY, projectId: init.demo ? "demo" : "local", boardId: init.demo ? "board:demo" : "board:local" }, [syncIdentity, init.demo]);
  // B08.2/B08.3 — THE PCB board lifecycle owner and the request-owned
  // server-workflow registry (sync preparation / sync apply /
  // qualification). One-shot state: the instances are stable for the
  // component's lifetime (identity is bounded by the project-keyed mount)
  // and safe to read during render.
  const [pcbLifecycle] = useState(() => {
    const owner = new PcbBoardLifecycleOwner();
    owner.adopt(boardLifecycleIdentity);
    return owner;
  });
  const [ownedOps] = useState(() => new PcbOwnedOperationRegistry(pcbLifecycle));
  // [B16-C.5] mount re-arms (StrictMode runs this cleanup once and mounts again), unmount disposes.
  useEffect(() => { pcbLifecycle.resume(); return () => pcbLifecycle.dispose(); }, [pcbLifecycle]);
  // B08.3 — busy state derives from the registry (request-owned records,
  // retired synchronously by lifecycle adoption) — never ambient booleans.
  const [ownedBusy, setOwnedBusy] = useState({ syncing: false, applying: false, qualifying: false });
  useEffect(() => {
    const update = (): void => setOwnedBusy({ syncing: ownedOps.busy("sync-preparation"), applying: ownedOps.busy("sync-apply"), qualifying: ownedOps.busy("qualification") });
    update();
    const unsubscribe = ownedOps.subscribe(update);
    return () => { unsubscribe(); };
  }, [ownedOps]);
  const { syncing, applying, qualifying } = ownedBusy;
  // [B16.1C §C/§F] bumped after every verified server adoption so the durable
  // manufacturing truth (authority/release currency) is re-read from the server.
  const [manufacturingRefreshToken, setManufacturingRefreshToken] = useState(0);
  // [B16-C.3] "another session published a newer revision" — surfaced as its
  // own dialog (current vs expected revision, refresh / rebase), never as a
  // bare code, never resolved by overwriting.
  const [snapshotConflict, setSnapshotConflict] = useState<PcbSyncSnapshotRevisionConflictDetails | null>(null);
  const lastSyncPlacementRef = useRef<{ centerNewParts?: boolean; spreadOverlaps?: boolean; preserveAbsoluteCoordinates?: boolean } | undefined>(undefined);
  // [B16-C.2] the component-binding review handoff: an editor REQUESTS reviewer
  // approval of each exact candidate; a reviewer approves/rejects against the
  // server-projected evidence; the durable result survives any refresh.
  // (Declared here, before handleSync, which reads it when a bind is refused.)
  const reviewScopeHeaders = useCallback((): Record<string, string> => syncIdentity ? {
    "x-sirkit-tenant-id": syncIdentity.tenantId,
    "x-sirkit-project-id": syncIdentity.projectId,
    "x-sirkit-branch-id": syncIdentity.branchId,
  } : {}, [syncIdentity]);
  const reviewableComponents = useMemo(
    () => (schematic.kicadComponents ?? []).filter((k) => k.atomicPartRevisionId).map((k) => ({ id: k.id, refDes: k.refDes, atomicPartRevisionId: k.atomicPartRevisionId! })),
    [schematic.kicadComponents],
  );
  const componentReview = useComponentReview({
    enabled: !init.demo && Boolean(syncIdentity),
    scopeHeaders: reviewScopeHeaders,
    boardInstanceId: syncIdentity?.boardId ?? null,
    components: reviewableComponents,
    refreshToken: manufacturingRefreshToken + hydrateToken,
    onNotice: setToast,
  });
  const bumpManufacturingTruth = useCallback(() => setManufacturingRefreshToken((n) => n + 1), []);
  // B09.0 — the live history/gesture-tool/teardown trio lives behind ONE
  // stable method-encapsulated runtime (the PcbBoardLifecycleOwner
  // pattern), replacing bare refs mutated from effects. The runtime also
  // publishes the history VIEW snapshot for useSyncExternalStore, so the
  // reseed effect never calls setState synchronously.
  const [editorRuntime] = useState(() => new PcbEditorRuntime<SelectMoveTool, HistoryView>({ canUndo: false, canRedo: false, entries: [] }));
  const subscribeEditorRuntime = useCallback((listener: () => void) => editorRuntime.subscribe(listener), [editorRuntime]);
  const getEditorRuntimeSnapshot = useCallback(() => editorRuntime.getSnapshot(), [editorRuntime]);
  const visibleHistory = useSyncExternalStore(subscribeEditorRuntime, getEditorRuntimeSnapshot, getEditorRuntimeSnapshot);
  // Bumped by every lifecycle adoption — drives the hook invalidation
  // effect and the AssistBox remount key (old previews/candidates/pending
  // chips are discarded the moment the board is replaced).
  const [lifecycleGeneration, setLifecycleGeneration] = useState(0);
  // B08.2 — recorded server divergence (the ONE reconciliation-notice
  // boundary's output): display-only, retired automatically by any later
  // lifecycle adoption or identity change.
  const [serverDivergence, setServerDivergence] = useState<PcbServerDivergenceNotice | null>(null);

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
  // B08 — the TYPED PCB lifecycle-adoption boundary. Every board
  // REPLACEMENT that is not an ordinary user edit flows through here with a
  // declared reason: initial hydration, working-copy restore, verified
  // server-authority adoption, durable-sync adoption, qualification
  // adoption, and checkpoint restore. Adoption dispatches a NEW board
  // identity, which the history effect answers by reseeding PcbHistory and
  // rebinding a fresh CanonicalEditorSession (verified head claims only,
  // staged in pendingCanonicalClaims) — so undo can never cross the
  // replacement, no lifecycle change ever masquerades as an undoable edit,
  // and project identity is bounded by the project-keyed mount (B07.5).
  // Late async producers are rejected by their effect's cancellation flag
  // and, for stale service bindings, by the history-identity guards.
  type BoardLifecycleReason =
    | "initial-hydration"
    | "working-copy-restore"
    | "server-authority-adoption"
    | "sync-adoption"
    | "qualification-adoption"
    | "checkpoint-restore";
  const adoptBoardLifecycle = useCallback((reason: BoardLifecycleReason, board: PcbBoard): void => {
    void reason; // classification anchor for the B08 mutation tripwire
    // B08.1 — SYNCHRONOUS retirement before the replacement board is
    // exposed: the previous canonical session/history ownership retires
    // (its history becomes a permanent tombstone — no bare fallback), the
    // gesture tool dies, and the PCB lifecycle GENERATION advances so every
    // outstanding asynchronous producer (sync apply, qualification,
    // hydration, autoroute, auto-place, repair) goes permanently stale
    // before any of its callbacks can publish. Only then is the
    // replacement dispatched; the reseed effect binds a fresh session.
    editorRuntime.retire();
    // B08.2 — full identity, generation-first: adoption ALWAYS advances the
    // generation (even for a board with an identical digest), aborting every
    // scope-signal listener (autoroute fetch, auto-place worker, repair)
    // before the replacement board is dispatched.
    pcbLifecycle.adopt(boardLifecycleIdentity);
    // B08.3 — synchronously retire the server-workflow busy records (sync
    // preparation/apply/qualification) so the replacement generation starts
    // idle without waiting for any now-stale finalizer — including the
    // SUCCESSFUL operation whose own adoption triggered this transition —
    // and clear the sync progress line that belonged to the old generation.
    ownedOps.retireGeneration();
    setSyncProgress(null);
    setLifecycleGeneration((generation) => generation + 1);
    dispatch({ type: "set-board", board });
  }, [boardLifecycleIdentity, ownedOps, pcbLifecycle, editorRuntime]);

  // Explicit checkpoint restore beats every other hydration source.
  useEffect(() => {
    if (init.demo) return;
    const onRestore = () => {
      const board = consumePendingBoardRestore();
      if (board) adoptBoardLifecycle("checkpoint-restore", board);
    };
    window.addEventListener(BOARD_RESTORE_EVENT, onRestore);
    return () => window.removeEventListener(BOARD_RESTORE_EVENT, onRestore);
  }, [init.demo, adoptBoardLifecycle]);

  useEffect(() => {
    if (init.demo || !client || !syncIdentity) return;
    let cancelled = false;
    // B08.1 — a same-generation guard beyond the effect's own cleanup: a
    // checkpoint restore mid-load advances the lifecycle generation, and
    // this resolution must not overwrite the restored board.
    const scope = pcbLifecycle.capture();
    void client.loadBoard(syncIdentity.boardId).then((loaded) => {
      if (cancelled || !scope.isCurrent()) return;
      // [B16-C.1] a superseded board revision is history: follow the lineage to the current revision before adopting anything.
      if (loaded.ok && loaded.value.lineage && loaded.value.lineage.currentBoardId !== syncIdentity.boardId) {
        setToast(`Board ${syncIdentity.boardId} was superseded by revision ${loaded.value.lineage.currentBoardId}; opening the current revision. The earlier board and its releases are kept as history.`);
        setCurrentBoardId(loaded.value.lineage.currentBoardId);
        return;
      }
      const restored = consumePendingBoardRestore();
      if (restored) {
        if (loaded.ok && loaded.value.status === "found" && loaded.value.record) {
          saveAuthoritativeBoardCache(loaded.value.record);
          setAuthoritativeRecord(loaded.value.record);
        }
        adoptBoardLifecycle("checkpoint-restore", restored);
        return;
      }
      const working = loadWorkingCopy(syncIdentity.projectId);
      if (!loaded.ok) {
        if (loaded.kind !== "not_found") {
          setToast(`Server board load failed: ${loaded.code}${loaded.detail ? ` — ${loaded.detail}` : ""}${working ? ". Restored your local working copy; durable authority unverified." : ""}`);
        }
        if (working) {
          if (working.canonicalHead) pendingCanonicalClaims.set(working.board, working.canonicalHead);
          adoptBoardLifecycle("working-copy-restore", working.board);
        }
        return;
      }
      if (loaded.value.status !== "found" || !loaded.value.record) {
        if (working) {
          if (working.canonicalHead) pendingCanonicalClaims.set(working.board, working.canonicalHead);
          adoptBoardLifecycle("working-copy-restore", working.board);
        }
        return;
      }
      const record = loaded.value.record;
      saveAuthoritativeBoardCache(record);
      setAuthoritativeRecord(record);
      if (!working) {
        adoptBoardLifecycle("server-authority-adoption", normalizeBoardForEditor(record.board, syncIdentity.projectId));
        return;
      }
      if (working.baseRevision === record.revision) {
        // Same ancestry: the local copy extends the current authority — it is
        // the newest complete state. Restore the user's editor work.
        if (working.canonicalHead) pendingCanonicalClaims.set(working.board, working.canonicalHead);
        adoptBoardLifecycle("working-copy-restore", working.board);
        return;
      }
      // Diverged: server moved past this copy's base. Preserve, don't pick.
      stashWorkingConflict(syncIdentity.projectId, working, `Server board advanced to revision ${record.revision} while this local copy was based on ${working.baseRevision ?? "no durable base"}.`);
      adoptBoardLifecycle("server-authority-adoption", normalizeBoardForEditor(record.board, syncIdentity.projectId));
      setToast("The durable server board advanced past your local working copy. The server board was loaded; your local copy was preserved as a recoverable conflict record.");
    });
    return () => { cancelled = true; };
  }, [client, init.demo, syncIdentity, hydrateToken, adoptBoardLifecycle, pcbLifecycle]);

  // Stage 17: the global selection store — synchronous, shared by the
  // select-move tool, the scene overlay and (Phase B) the inspector.
  const [selectionStore] = useState(() => createSelectionStore());
  // Stage 17: right-click context menu (select-move emits the request).
  const [ctxMenu, setCtxMenu] = useState<ContextMenuRequest | null>(null);

  // Stage 5: undo/redo history + select/move tool (see app/lib/pcb/history.ts
  // and app/lib/pcb/tools/select-move.ts) — owned by `editorRuntime` above
  // (B09.0); `visibleHistory` is its published external-store snapshot.
  // B08.2 — THE PCB board lifecycle owner (full identity, generation-first):
  // every non-edit board replacement advances the generation, aborts every
  // captured scope's signal, and stales everything captured before it.
  // (B08.3 — `pcbLifecycle` and `ownedOps` are declared with the board
  // lifecycle identity above; busy state is the registry-derived
  // `syncing`/`applying`/`qualifying`.)
  const captureLifecycle = useCallback((): PcbBoardLifecycleScope => pcbLifecycle.capture(), [pcbLifecycle]);
  // B08.2 — AI request ownership = the page's project generation (B07.5)
  // AND this board's lifecycle generation: an assist/brief response captured
  // before a board replacement can never publish edits, notices, or retries
  // into the replacement board's UI.
  const assistOwnership = useCallback((): AiRequestOwnership => {
    const pageOwner = aiOwnership?.();
    const scope = pcbLifecycle.capture();
    return { isCurrent: () => scope.isCurrent() && (pageOwner ? pageOwner.isCurrent() : true) };
  }, [aiOwnership, pcbLifecycle]);
  // B08.2 — THE reconciliation-notice boundary: a VERIFIED durable server
  // commit whose scope went stale records ONLY a divergence notice (same
  // board identity) or is discarded entirely (identity changed). It never
  // adopts a board, writes caches/checkpoints/evidence, or toasts success.
  const settleStaleServerCommit = useCallback((settlement: ServerCommitSettlement): void => {
    if (settlement.kind !== "reconcile-required") return;
    setServerDivergence(settlement.notice);
    setToast(settlement.notice.description);
  }, []);

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

  // B10/B10.1 — editor-context publisher: the chat request's PCB read
  // source is the EXACT visible working copy (state.board via boardRef —
  // so UNSAVED edits are captured), the live selectionStore selection, and
  // the AUTHORITY-NEUTRAL projection of the live netlist. NEVER
  // authorityRef (the durable server board can lag unsaved local edits),
  // never storage reconstruction, never a refetch. Demo boards never
  // publish. Registration lifecycle lives in the extracted PRODUCTION hook
  // (useEditorContextPublisher): effect-local Strict-Mode-safe liveness +
  // a captured PCB lifecycle scope, re-registered on every board lifecycle
  // adoption via `lifecycleGeneration`; a hidden tab keeps publishing
  // (`active` is display state, never board authority).
  const liveNetlistRef = useRef<PcbNetlist | null>(null);
  useEffect(() => { liveNetlistRef.current = liveNetlist; }, [liveNetlist]);
  // [B15.3] mirror of the DRC hook's active preset for the read callback
  // (the hook is initialized later in the component; the ref keeps the
  // capture callback stable and always-current).
  const activeDrcPresetIdRef = useRef<string>(DEFAULT_PRESET_ID);
  const publisherScope = useMemo(
    () => init.scope ? { tenantId: init.scope.tenantId, projectId: init.scope.projectId, branchId: init.scope.branchId } : null,
    [init.scope],
  );
  const readEditorContext = useCallback(() => {
    const currentSelection = selectionStore.get();
    let digest: string | null = null;
    try { digest = schematicStateDigest(schematicRef.current); } catch { digest = null; }
    // [B15.3] the PCB proposal BASIS — captured atomically with the board:
    // the canonical session head (sequence + lineage) for the EXACT current
    // board, the head entry's label, and the ACTIVE DRC preset. When the
    // session cannot prove the board is its canonical head (loading,
    // transient, legacy-diverged, retired), the basis is truthfully null
    // and the PCB proposal tool stays unavailable — nothing is fabricated.
    let pcbProposalBasis: { historyHeadSequence: number; historyHeadLabel: string | null; lineageId: string; activeDrcPresetId: string } | null = null;
    const liveHistory = editorRuntime.getHistory();
    const liveBoard = boardRef.current;
    if (liveHistory && liveBoard) {
      const head = canonicalSessionFor(liveHistory)?.headMetadataFor(liveBoard) ?? null;
      // A head without a lineage identity (legacy) cannot scope-seal.
      if (head && typeof head.lineageId === "string" && head.lineageId.length > 0) {
        pcbProposalBasis = {
          historyHeadSequence: head.headSequence,
          historyHeadLabel: liveHistory.undoLabel ?? null,
          lineageId: head.lineageId,
          activeDrcPresetId: activeDrcPresetIdRef.current,
        };
      }
    }
    return {
      board: boardRef.current,
      selection: { refs: currentSelection.refs, primary: currentSelection.primary ?? null },
      netlist: liveNetlistRef.current ? projectAgentNetlist(liveNetlistRef.current) : null,
      schematicDigest: digest,
      pcbProposalBasis,
    };
  }, [selectionStore, editorRuntime]);
  useEditorContextPublisher({
    bridge: editorContextBridge,
    enabled: !init.demo && init.scope !== null,
    scope: publisherScope,
    lifecycle: pcbLifecycle,
    lifecycleGeneration,
    read: readEditorContext,
  });

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
    // B07.2 — refuse truthfully while the schematic's canonical session is
    // conflicted or not ready: an unresolved projection must never be
    // published to the durable board.
    const gate = gateSchematicSync?.();
    if (gate && !gate.allowed) {
      setToast(gate.reason);
      return;
    }
    placementChoiceRef.current = { centerNewParts: placement?.centerNewParts !== false && placement?.preserveAbsoluteCoordinates !== true };
    lastSyncPlacementRef.current = placement; // [B16-C.3] a rebase re-runs exactly this request
    if (!client || !syncIdentity) return;
    const s = schematicRef.current;
    // Every instance carrying published atomic authority gets its Stage 1
    // physical binding ensured through the ordinary lifecycle
    // (create → select → revalidate → approve) under this user's identity
    // before publication, so preflight resolution finds rank-1 authority.
    // Instances without atomic identity are left alone and fail closed.
    const atomicInstances = (s.kicadComponents ?? []).filter((k) => k.atomicPartRevisionId);
    // B16.0: only the project/branch SELECTOR is sent; identity/role are
    // server-derived from the authenticated session + project membership.
    const bindingHeaders = {
      "content-type": "application/json",
      "x-sirkit-tenant-id": syncIdentity.tenantId,
      "x-sirkit-project-id": syncIdentity.projectId,
      "x-sirkit-branch-id": syncIdentity.branchId,
    };
    // B08.3 — the whole preparation (bindings → publication → snapshot-
    // revision persistence → preflight → plan/dialog/toast publication)
    // runs as ONE owned workflow: request-owned busy record, ownership
    // verified around every await, bindings/preflight on the lifecycle
    // AbortSignal, per-stage truthful settlement when a lifecycle
    // replacement races it. Each binding is a durable multi-write
    // transaction; the small concurrency cap overlaps latency without
    // crowding the database pooler, and replays of already-bound parts are
    // fast and idempotent, so restarting Sync after an interruption resumes.
    const run = await runOwnedSyncPreparation(ownedOps, {
      instances: atomicInstances,
      concurrency: 3,
      // Part catalog data must be in the cache before buildNetlist runs.
      warmup: async () => {
        await Promise.allSettled(
          [...new Set((s.kicadComponents ?? []).map((k) => k.partId))].map((id) =>
            ensurePartLoaded(id),
          ),
        );
      },
      bind: async (k, signal) => {
        try {
          const res = await fetch("/api/physical-bindings", {
            method: "POST",
            headers: bindingHeaders,
            body: JSON.stringify({ operation: "bind_atomic_selection", componentInstanceId: k.id, boardInstanceId: syncIdentity.boardId, atomicPartRevisionId: k.atomicPartRevisionId }),
            signal,
          });
          if (res.ok) return { ok: true };
          const detail = (await res.json().catch(() => null)) as { code?: string; handoff?: string } | null;
          // [B16-C.2] an editor cannot publish a binding (403): say what the visible handoff is instead of a bare code.
          if (res.status === 403 && detail?.handoff === "request_atomic_review") {
            void componentReview.refresh();
            return { ok: false, failure: `${k.refDes} (reviewer approval required — use “Request review” in the Component review panel)` };
          }
          return { ok: false, failure: `${k.refDes} (${detail?.code ?? res.status})` };
        } catch {
          return { ok: false, failure: k.refDes };
        }
      },
      publish: async () => {
        const currentNetlist = buildNetlist(s, getCachedPart), graph = buildPcbSyncPublicationGraph(s, getCachedPart), token = graph.sourceDigest.replace(/^sha256:/, "").slice(0, 40), now = new Date().toISOString();
        const published = await client.publish({ requestSchemaVersion: PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION, requestId: `publish:${token}`, designId: syncIdentity.designId, boardId: syncIdentity.boardId, boardName: "Main Board", projectRevision: `project:${token}`, designRevision: `design:${token}`, schematicRevision: `schematic:${token}`, componentSetRevision: `components:${token}`, netGraphRevision: `netgraph:${token}`, assemblyVariantId: syncIdentity.assemblyVariantId, assemblyVariantRevision: "variant:default:1", librarySnapshotRevision: "library:current:1", expectedSnapshotRevision: snapshotRevisionRef.current, idempotencyKey: `publish:${token}`, components: graph.components, nets: graph.nets, prerequisiteIssues: graph.prerequisiteIssues, sourceDigest: graph.sourceDigest, requestedAt: now });
        if (!published.ok) {
          // [B16-C.3] a newer revision from another session is its own outcome: the dialog names both revisions and offers refresh / rebase.
          if (published.code === "PS_SNAPSHOT_REVISION_CONFLICT" && published.conflict) {
            setSnapshotConflict(published.conflict);
            return { ok: false, message: `Another session published schematic revision ${published.conflict.currentRevision} (you expected ${published.conflict.expectedRevision}) — nothing was overwritten. Refresh or rebase from the dialog.` };
          }
          return { ok: false, message: `Publication failed: ${published.code}${published.detail ? ` — ${published.detail}` : ""}` };
        }
        return { ok: true, value: { published: published.value, currentNetlist, token, now } };
      },
      persistSnapshotRevision: ({ published }) => {
        snapshotRevisionRef.current = published.snapshotRevision;
        savePcbSnapshotRevision(syncIdentity.projectId, published.snapshotRevision);
      },
      preflight: async ({ published, currentNetlist, token, now }, signal) => {
        const current = authorityRef.current;
        const result = await client.preflight({ requestSchemaVersion: PCB_SYNC_REQUEST_VERSION, requestId: `preflight:${token}`, designId: syncIdentity.designId, schematicRevision: published.snapshot.schematicRevision, assemblyVariantId: syncIdentity.assemblyVariantId, target: current ? { kind: "existing_board", boardId: syncIdentity.boardId, expectedBoardRevision: current.revision } : { kind: "new_board", boardId: syncIdentity.boardId, boardName: "Main Board", boardFormatVersion: "sirkit-json-pcb/1" }, resolutionPolicyId: "sirkit.default-footprint-resolution", resolutionPolicyVersion: "1.0.0", syncPolicyId: "sirkit.safe-pcb-sync", syncPolicyVersion: "1.0.0", requestedAt: now, mode: "prepare_apply" }, { signal });
        if (!result.ok) return { ok: false, message: `Preflight failed: ${result.code}${result.detail ? ` — ${result.detail}` : ""}` };
        return { ok: true, value: { preflighted: result.value, syncHash: netlistHash(currentNetlist) } };
      },
      progress: setSyncProgress,
      fail: setToast,
      complete: ({ preflighted, syncHash }) => {
        // (Owned-gated by the workflow — a stale preflight result can never
        // repopulate pendingPreflight or touch the dialog/toast.)
        setLastSyncHash(syncHash);
        setPendingPreflight(preflighted.plan ? preflighted : null);
        setPlacementWarning(null);
        setToast(preflighted.status === "ready_to_apply" && preflighted.plan ? "Preflight ready. Review and explicitly apply the durable plan." : preflighted.status === "ready_no_changes" ? "PCB is already synchronized." : `Sync blocked: ${preflighted.blockers.map((item) => `${item.code} ${item.displayRefs.join(",")}`).join("; ") || preflighted.status}`);
        setSyncDialogOpen(false);
      },
      settleStale: (stage: SyncPreparationServerStage, scope) => {
        if (stage === "none") return; // nothing durable happened — discard
        const settlement = settleServerCommit({
          scope, owner: pcbLifecycle,
          description: stage === "published"
            ? "Sync preparation DID change server state (component bindings and the schematic snapshot publication committed) before this board was replaced locally. Restart Schematic → PCB to reconcile with the server."
            : "Sync preparation had started changing server state (durable component bindings) before this board was replaced locally. Restart Schematic → PCB to resume and reconcile.",
        });
        settleStaleServerCommit(settlement);
      },
    });
    // [B16-C.5] a click must never do nothing silently: a refused (already running) or a
    // stale-before-any-server-call run says so; every other outcome already spoke.
    if (run.status === "refused-busy") setToast("Schematic → PCB is already running — wait for it to finish.");
    else if (run.status === "stale" && run.stage === "none") setToast("Schematic → PCB was not started: the board changed while it was starting. Try again.");
  }, [client, syncIdentity, gateSchematicSync, settleStaleServerCommit, ownedOps, pcbLifecycle, componentReview]);

  const handleApplySync = useCallback(async () => {
    const plan = pendingPreflight?.plan; if (!client || !syncIdentity || !plan) return;
    // B08.3 — request-owned apply: the workflow captures the lifecycle
    // scope at submission, settles a stale server commit truthfully (the
    // server may have committed irreversibly — never called canceled or
    // unchanged), verifies the reloaded authority against the EXACT
    // committed revision+digest+identity, and releases only its own busy
    // record (a zombie finalizer cannot clear a newer request's state).
    await runVerifiedServerAdoption(ownedOps, "sync-apply", pcbLifecycle, {
      commit: async () => {
        const result = await client.apply({ requestSchemaVersion: PCB_SYNC_APPLY_REQUEST_VERSION, requestId: `apply:${plan.planId}`, designId: syncIdentity.designId, boardId: syncIdentity.boardId, planId: plan.planId, planDigest: plan.planDigest, expectedPlanLifecycle: "applicable", confirmation: "apply_exact_plan", idempotencyKey: `apply:${plan.planId}`, warningAcknowledgements: plan.prerequisites.filter((item) => !item.blocking).map((item) => item.code), requestedAt: new Date().toISOString() });
        if (!result.ok || !["applied", "idempotent_replay"].includes(result.value.status)) {
          return { committed: false, message: `Apply failed: ${result.ok ? result.value.status : `${result.code}${result.detail ? ` — ${result.detail}` : ""}`}` };
        }
        return { committed: true, value: result.value, expected: { revision: result.value.committedBoardRevision ?? "", digest: result.value.committedBoardDigest ?? "" } };
      },
      reload: async () => {
        const loaded = await client.loadBoard(syncIdentity.boardId);
        return loaded.ok && loaded.value.status === "found" && loaded.value.record ? loaded.value.record : null;
      },
      recordKeys: (record) => ({ revision: record.revision, digest: record.digest }),
      recordIdentity: (record) => ({ tenantId: record.tenantId, projectId: record.projectId, branchId: record.branchId, boardId: record.boardId }),
      staleDescription: "The durable PCB plan WAS applied on the server, but this board was replaced locally while it ran. The local board was kept — re-open sync to reconcile with the server authority.",
      verifyFailedDescription: "The durable PCB plan WAS applied on the server, but the authoritative board could not be verified locally. The local board was kept — reload the server authority to reconcile",
      commitFailed: setToast,
      adopt: (record) => {
        if (!saveAuthoritativeBoardCache(record)) { setToast("Authoritative board committed, but its matching browser cache could not be stored."); }
        setAuthoritativeRecord(record);
        // Honor the sync dialog's placement choice: staged (off-board) plan
        // footprints are arranged onto the board deterministically. The
        // server record stays the untouched authority; the arranged board
        // is the local working copy layered on it.
        const adopted = normalizeBoardForEditor(record.board, syncIdentity.projectId);
        const arranged = placementChoiceRef.current?.centerNewParts ? arrangeStagedFootprints(adopted) : null;
        adoptBoardLifecycle("sync-adoption", arranged ?? adopted);
        setPendingPreflight(null);
        setToast(arranged
          ? "Durable PCB plan applied and verified; imported footprints were arranged near the board center."
          : "Durable PCB plan applied and verified from the authoritative server board.");
        boardCheckpoint(`Synchronized PCB (server revision ${record.revision.slice(0, 12)}…)`, arranged ?? record.board);
        bumpManufacturingTruth(); // [B16.1C] the board moved: authority/release currency must be re-read
      },
      settle: settleStaleServerCommit,
    });
  }, [client, pendingPreflight, syncIdentity, boardCheckpoint, adoptBoardLifecycle, settleStaleServerCommit, ownedOps, pcbLifecycle, bumpManufacturingTruth]);

  // ── History + move tool lifecycle ──────────────────────────────────────────
  // Boards arriving from OUTSIDE the history stack (initial load, demo, sync)
  // reseed it — undo does not span a re-sync. Boards emitted BY the stack are
  // recognized by identity and keep it.
  useEffect(() => {
    if (!scene || !state.board) return;
    const liveHistory = editorRuntime.getHistory();
    if (liveHistory && liveHistory.present === state.board) return;
    editorRuntime.retire();
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
    editorRuntime.publishSnapshot(historyView(history));
    const tool = createSelectMoveTool({
      scene,
      history,
      selection: selectionStore, // Stage 17: the tool writes the global store
      toast: setToast,
      onContextMenu: (request) => setCtxMenu(request),
    });
    const unsubscribe = history.subscribe((board) => {
      dispatch({ type: "set-board", board });
      editorRuntime.publishSnapshot(historyView(history));
      // Stage 17: drop selection refs whose items vanished (delete, undo, sync).
      const refs = selectionStore.get().refs;
      const live = liveRefs(board, refs);
      if (live.length !== refs.length) selectionStore.replace(live);
    });
    tool.refreshAirwires();
    // B09.0 — one atomic runtime adoption; retire() (reseed, lifecycle
    // replacement, unmount) runs this teardown exactly once.
    editorRuntime.bind(history, tool, () => {
      unsubscribe();
      tool.destroy();
      bound.session.dispose();
    });
  }, [scene, selectionStore, state.board, syncIdentity, init.demo, editorRuntime]);
  useEffect(() => () => editorRuntime.retire(), [editorRuntime]);

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
      const canonicalHead = canonicalSessionFor(editorRuntime.getHistory())?.headMetadataFor(board) ?? null;
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
  }, [state.board, init.demo, syncIdentity, editorRuntime]);
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
  // B08.3 — `qualifying` (like `syncing`/`applying`) is derived from the
  // request-owned operation registry above, never an ambient boolean.
  // [B16.1C §F] `releasing` is now the registry's "release" slot as well (a
  // second click while a release is in flight is refused, never a second
  // request) — see useManufacturingWorkflow below.
  // B16.0: qualify/release send only the project/branch SELECTOR; the server
  // derives identity/role from the authenticated session + project membership.
  const scopeHeaders = useCallback((): Record<string, string> => syncIdentity ? {
    "content-type": "application/json",
    "x-sirkit-tenant-id": syncIdentity.tenantId,
    "x-sirkit-project-id": syncIdentity.projectId,
    "x-sirkit-branch-id": syncIdentity.branchId,
  } : {}, [syncIdentity]);
  // [B16.1C §C/§F] durable manufacturing truth (snapshot head, qualification
  // authority currency, ledgered release) is hydrated from the server on
  // mount and after every verified adoption; the explicit workflow state is
  // reconstructed from it — never from browser memory.
  const manufacturingIdentity = useMemo(() => syncIdentity ? { tenantId: syncIdentity.tenantId, projectId: syncIdentity.projectId, branchId: syncIdentity.branchId, designId: syncIdentity.designId, boardId: syncIdentity.boardId } : null, [syncIdentity]);
  const manufacturing = useManufacturingWorkflow({
    client: init.demo ? null : client,
    identity: init.demo ? null : manufacturingIdentity,
    scopeHeaders,
    ownedOps,
    lifecycle: pcbLifecycle,
    hasSchematic: schematic.components.length + (schematic.kicadComponents?.length ?? 0) > 0,
    schematicBaseDigest: null,
    refreshToken: manufacturingRefreshToken + hydrateToken,
    onNotice: setToast,
    onReleased: (result) => {
      if (init.demo || !syncIdentity) return;
      const board = authorityRef.current?.board ?? boardRef.current;
      if (!board) return;
      saveStageEvidence(syncIdentity.projectId, { releasedBoardRevision: result.boardRevision || pcbRevisionId(board), releasedAt: Date.now(), releaseId: result.releaseId });
      boardCheckpoint("Released manufacturing package", board);
    },
  });
  const releasing = manufacturing.releasing;
  // [B16.1C §C/§F] pre-edit probe P1: a fresh browser remembered NO snapshot
  // revision (localStorage empty → 0) and every publication against an
  // already-published design collided with PS_SNAPSHOT_REVISION_CONFLICT.
  // The durable snapshot head now arrives with the manufacturing truth and
  // becomes the publication base — server truth wins over browser memory.
  const manufacturingSnapshotHead = manufacturing.hydration.status === "loaded" ? manufacturing.hydration.truth?.snapshot ?? null : null;
  useEffect(() => {
    if (init.demo || !syncIdentity || !manufacturingSnapshotHead) return;
    if (snapshotRevisionRef.current === manufacturingSnapshotHead.revision) return;
    snapshotRevisionRef.current = manufacturingSnapshotHead.revision;
    savePcbSnapshotRevision(syncIdentity.projectId, manufacturingSnapshotHead.revision);
  }, [init.demo, syncIdentity, manufacturingSnapshotHead]);

  // [B16-C.3] the two explicit ways out of a snapshot-revision conflict.
  const handleSnapshotConflictRefresh = useCallback(() => {
    setSnapshotConflict(null);
    setManufacturingRefreshToken((token) => token + 1); // re-reads snapshot head, board, authority, release — publishes nothing
    setToast("Durable truth refreshed from the server; your schematic was not published.");
  }, []);
  const handleSnapshotConflictRebase = useCallback(async () => {
    const conflict = snapshotConflict;
    if (!conflict || !syncIdentity) return;
    setSnapshotConflict(null);
    // Adopt the CURRENT revision as the publication base and republish THIS session's schematic on top of it.
    snapshotRevisionRef.current = conflict.currentRevision;
    savePcbSnapshotRevision(syncIdentity.projectId, conflict.currentRevision);
    setToast(`Rebasing on schematic revision ${conflict.currentRevision} and republishing your schematic…`);
    await handleSync(lastSyncPlacementRef.current);
  }, [snapshotConflict, syncIdentity, handleSync]);

  // [B16-C.1] derive a new board revision: preview the rework plan (pure, server-computed), review it, derive it.
  const boardRevisionRequest = useCallback((carry: BoardRevisionCarry) => {
    if (!syncIdentity || !pendingPreflight || !authoritativeRecord) return null;
    return {
      requestSchemaVersion: "sirkit.pcb-board-revision-request.v1" as const, requestId: `board-revision:${pendingPreflight.preflightId}:${carry.copper ? "c" : "-"}${carry.placement ? "p" : "-"}${carry.constraints ? "k" : "-"}`,
      designId: syncIdentity.designId, schematicRevision: pendingPreflight.snapshot.schematicRevision, assemblyVariantId: syncIdentity.assemblyVariantId,
      parent: { boardId: syncIdentity.boardId, expectedBoardRevision: authoritativeRecord.revision }, carry,
      resolutionPolicyId: "sirkit.default-footprint-resolution", resolutionPolicyVersion: "1.0.0", syncPolicyId: "sirkit.safe-pcb-sync", syncPolicyVersion: "1.0.0", requestedAt: new Date().toISOString(),
    };
  }, [syncIdentity, pendingPreflight, authoritativeRecord]);
  const handlePreviewBoardRevision = useCallback(async (carry: BoardRevisionCarry = boardRevisionCarry) => {
    const request = boardRevisionRequest(carry);
    if (!client || !request) { setToast("A derived revision needs a durable board and a refused sync preflight to start from."); return; }
    setBoardRevisionOpen(true); setBoardRevisionBusy(true); setBoardRevisionError(null); setBoardRevisionPreview(null);
    const result = await client.previewBoardRevision(request);
    setBoardRevisionBusy(false);
    if (!result.ok) { setBoardRevisionError(`The rework plan could not be computed: ${result.code}${result.detail ? ` — ${result.detail}` : ""}`); return; }
    setBoardRevisionPreview(result.value);
  }, [client, boardRevisionRequest, boardRevisionCarry]);
  const handleBoardRevisionCarryChange = useCallback((carry: BoardRevisionCarry) => { setBoardRevisionCarry(carry); void handlePreviewBoardRevision(carry); }, [handlePreviewBoardRevision]);
  const handleDeriveBoardRevision = useCallback(async () => {
    const preview = boardRevisionPreview, request = boardRevisionRequest(boardRevisionCarry);
    if (!client || !preview || !request || !syncIdentity) return;
    setBoardRevisionBusy(true); setBoardRevisionError(null);
    const result = await client.deriveBoardRevision({ ...request, requestId: `${request.requestId}:derive`, planId: preview.revisionPlan.planId, planDigest: preview.revisionPlan.planDigest, syncPlanDigest: preview.derivedPreflight.planDigest, confirmation: "derive_board_revision", idempotencyKey: `derive:${preview.revisionPlan.planDigest}` });
    setBoardRevisionBusy(false);
    if (!result.ok) { setBoardRevisionError(`Derivation refused: ${result.code}${result.detail ? ` — ${result.detail}` : ""}`); return; }
    setBoardRevisionOpen(false); setBoardRevisionPreview(null); setPendingPreflight(null);
    setToast(`Derived board revision ${result.value.derivedBoardId} (generation ${result.value.generation}). The previous board and its releases are kept as history; place, route and qualify the new revision before releasing.`);
    setCurrentBoardId(result.value.derivedBoardId); // the load effect adopts the derived board and re-hydrates its (empty) manufacturing truth
    bumpManufacturingTruth();
  }, [client, boardRevisionPreview, boardRevisionRequest, boardRevisionCarry, syncIdentity, bumpManufacturingTruth]);
  const syncBlockedByProtectedCopper = Boolean(pendingPreflight && pendingPreflight.blockers.length > 0 && preflightBlockedByProtectedCopper(pendingPreflight.blockers));

  const handleQualify = useCallback(async () => {
    if (!syncIdentity || !client) return;
    if (!authorityRef.current) { setToast("Qualification needs an applied durable board — run Schematic → PCB and apply the sync plan first."); return; }
    // B08.3 — VERIFIED qualification adoption: the server's response must
    // carry a non-empty boardRevision AND boardDigest, and the reloaded
    // authoritative record must match BOTH (plus the captured tenant/
    // project/branch/board identity) before anything is cached, adopted,
    // written into evidence, checkpointed, or described as qualified. A
    // missing/failed/mismatched reload preserves the local board and
    // records a truthful authority-reconciliation notice — the server's
    // irreversible qualification is never called unchanged.
    await runVerifiedServerAdoption(ownedOps, "qualification", pcbLifecycle, {
      commit: async () => {
        try {
          const res = await fetch("/api/pcb/qualify", { method: "POST", headers: scopeHeaders(), body: JSON.stringify({ boardId: syncIdentity.boardId, designId: syncIdentity.designId }) });
          const body = (await res.json().catch(() => null)) as { ok?: boolean; code?: string; error?: string; rc02?: { remainingConnections: number; shorts: number; routeBlockingDrcErrors: number }; boardRevision?: string; boardDigest?: string; committedBoardRevision?: string; committedBoardDigest?: string } | null;
          if (!res.ok || !body?.ok) return { committed: false, message: `Qualification failed: ${body?.code ?? res.status}${body?.error ? ` — ${body.error}` : ""}` };
          // [B16-C.5] verify against the committed board RECORD's revision/digest (what the reload returns) — never the authority's own digest.
          return { committed: true, value: body, expected: { revision: body.committedBoardRevision ?? body.boardRevision ?? "", digest: body.committedBoardDigest ?? "" } };
        } catch (error) {
          return { committed: false, message: `Qualification failed: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
      reload: async () => {
        const loaded = await client.loadBoard(syncIdentity.boardId);
        return loaded.ok && loaded.value.status === "found" && loaded.value.record ? loaded.value.record : null;
      },
      recordKeys: (record) => ({ revision: record.revision, digest: record.digest }),
      recordIdentity: (record) => ({ tenantId: record.tenantId, projectId: record.projectId, branchId: record.branchId, boardId: record.boardId }),
      staleDescription: "The board WAS qualified and routed on the server, but this board was replaced locally while it ran. The local board was kept — reload the server authority to reconcile.",
      verifyFailedDescription: "The board WAS qualified and routed on the server, but the authoritative result could not be verified locally. The local board was kept — reload the server authority to reconcile",
      commitFailed: setToast,
      adopt: (record, body) => {
        // Adopt the EXACT verified server-routed board as the new authority.
        saveAuthoritativeBoardCache(record);
        setAuthoritativeRecord(record);
        const editorBoard = normalizeBoardForEditor(record.board, syncIdentity.projectId);
        adoptBoardLifecycle("qualification-adoption", editorBoard);
        saveStageEvidence(syncIdentity.projectId, { routedBoardRevision: pcbRevisionId(editorBoard), routedAt: Date.now() });
        setRouteStaleNotice(null);
        boardCheckpoint("Qualified and routed board (server, RC01–RC03 verified)", editorBoard);
        setToast(`Board qualified: routed with 0 remaining connections, 0 shorts, 0 route-blocking DRC errors (server revision ${body.boardRevision?.slice(0, 12) ?? "?"}…).`);
        bumpManufacturingTruth(); // [B16.1C] re-read the sealed authority head
      },
      settle: settleStaleServerCommit,
    });
  }, [syncIdentity, client, scopeHeaders, boardCheckpoint, adoptBoardLifecycle, settleStaleServerCommit, ownedOps, pcbLifecycle, bumpManufacturingTruth]);

  /**
   * MFG01 verified release: the server reloads its OWN durable authority,
   * recomputes RC01–RC03, and packages a deterministic ZIP. A browser board
   * never becomes release authority.
   *
   * [B16.1C §F] release is a human administrator's SEPARATE decision: this
   * entry (shared by the toolbar and the Send-to-fab dialog) never releases
   * directly — it checks that a CURRENT qualification authority exists for
   * this exact board and opens the authorization dialog, which names the
   * authority revision/digest the administrator confirms. The release request
   * itself runs request-owned (single-flight) in useManufacturingWorkflow.
   */
  const performVerifiedRelease = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    if (!syncIdentity) return { ok: false, message: "No durable project scope is active." };
    if (releasing) return { ok: false, message: "A release is already running." };
    if (manufacturing.hydration.status !== "loaded") return { ok: false, message: "Release is unavailable until the durable manufacturing truth has been read for this board." };
    if (!manufacturing.canRequestRelease) {
      return { ok: false, message: manufacturing.truth?.authority ? "Release blocked: the qualification authority is not current for this board. Run “Qualify & route” again first." : "Release blocked: no manufacturing authority exists yet. Run “Qualify & route” first." };
    }
    manufacturing.requestRelease();
    return { ok: false, message: "Release requires a separate administrator authorization — review the sealed authority in the manufacturing panel and authorize it there." };
  }, [syncIdentity, releasing, manufacturing]);

  const handleRelease = useCallback(async () => {
    const result = await performVerifiedRelease();
    if (!result.ok && !manufacturing.releaseConfirmation) setToast(result.message);
  }, [performVerifiedRelease, manufacturing.releaseConfirmation]);

  // ── Stage 7: interactive routing tool (active only in "route" mode) ─────────
  const netClasses = useNetClass({ getHistory: () => editorRuntime.getHistory() }, { ownership: assistOwnership });
  const routeTool = useRouteTool({
    scene,
    getHistory: () => editorRuntime.getHistory(),
    getActiveLayer: () => state.activeLayer,
    toast: setToast,
  });
  const { activate: activateRoute, deactivate: deactivateRoute } = routeTool;
  useEffect(() => {
    if (state.tool === "route") activateRoute();
    else deactivateRoute();
  }, [state.tool, activateRoute, deactivateRoute]);

  const updateRoutingPreferences = useCallback((preferences: RoutingPreferences): void => {
    const history = editorRuntime.getHistory();
    if (!history) {
      // B08 — no history means no canonical session yet: refuse truthfully
      // instead of the former silent, non-undoable board replacement.
      setToast("The board is still loading — routing preferences were not changed. Retry in a moment.");
      return;
    }
    void commitPcbCandidate(history, {
      commandId: "pcb.rules",
      label: "Set routing width and via preset",
      buildCandidate: (board) => ({ ...structuredClone(board), routingPreferences: structuredClone(preferences) }),
    }).then((result) => { if (!result.ok) setToast(result.message); });
  }, [editorRuntime]);

  // ── Stage 12: batch DRC (panel + toolbar button + zoom-to) ──────────────────
  const drc = useDrc({
    scene,
    getHistory: () => editorRuntime.getHistory(),
    board: state.board,
    // Stage 17: the flash borrows the selection overlay — hand it back.
    restoreSelection: () => scene?.setSelectionRefs(selectionStore.get().refs),
  });
  useEffect(() => { activeDrcPresetIdRef.current = drc.activePresetId; }, [drc.activePresetId]);
  const repair = usePcbRepair({
    getHistory: () => editorRuntime.getHistory(),
    captureLifecycle,
    getScope: () => syncIdentity ? { tenantId: syncIdentity.tenantId, projectId: syncIdentity.projectId, branchId: syncIdentity.branchId } : null, // [B16.0.2 §B] selector only
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

  // ── [B15.3 §I] the PCB proposal review + human-gated apply ─────────────────
  const pendingPcbProposal = pcbProposalIntake?.proposal ?? null;
  const [pcbProposalBusy, setPcbProposalBusy] = useState(false);
  const [pcbProposalTick, setPcbProposalTick] = useState(0);
  const pcbJournalStoreRef = useRef<IndexedDbApprovedPcbMutationJournalStore | null>(null);
  if (pcbJournalStoreRef.current === null) pcbJournalStoreRef.current = new IndexedDbApprovedPcbMutationJournalStore();
  // Expiry is time-based: tick while a proposal is open so the disable
  // reason stays current without a manual refresh.
  useEffect(() => {
    if (!pendingPcbProposal) return;
    const timer = setInterval(() => setPcbProposalTick((tick) => tick + 1), 5_000);
    return () => clearInterval(timer);
  }, [pendingPcbProposal]);
  // Board lifecycle adoption / retirement while a proposal is pending
  // RETIRES it (and any unused capability dies with its controller call).
  const pcbProposalGenerationRef = useRef(lifecycleGeneration);
  useEffect(() => {
    if (pcbProposalGenerationRef.current !== lifecycleGeneration && pendingPcbProposal) {
      onPcbProposalSettled?.("retired");
    }
    pcbProposalGenerationRef.current = lifecycleGeneration;
  }, [lifecycleGeneration, pendingPcbProposal, onPcbProposalSettled]);
  /** null ⇒ approval enabled; otherwise the PRECISE visible reason. Every
   *  condition re-verifies against the LIVE editor state — and the apply
   *  boundary re-verifies all of it AGAIN at the serialized position. */
  const pcbProposalDisableReason = useMemo((): string | null => {
    void pcbProposalTick; // expiry re-evaluation tick
    if (!pendingPcbProposal) return null;
    const verification = verifySealedPcbEditProposalIntegrity(pendingPcbProposal);
    if (!verification.ok) return `the proposal failed integrity verification (${verification.code}).`;
    if (isPcbEditProposalExpired(pendingPcbProposal, Date.now())) return "the proposal has expired — request a fresh proposal.";
    if (init.demo || !syncIdentity) return "demo boards have no durable project scope; proposals cannot be applied here.";
    if (pendingPcbProposal.scope.tenantId !== syncIdentity.tenantId
      || pendingPcbProposal.scope.projectId !== syncIdentity.projectId
      || pendingPcbProposal.scope.branchId !== syncIdentity.branchId
      || pendingPcbProposal.scope.boardInstanceId !== syncIdentity.boardId) {
      return "the proposal belongs to a different project, branch, or board instance — request a fresh proposal.";
    }
    if (currentInterlock?.()?.retired) return "the project is retiring; no further applies are accepted.";
    const liveHistory = editorRuntime.getHistory();
    const board = state.board;
    if (!liveHistory || !board) return "the editor session is still loading (revalidation has not completed).";
    if (pcbRevisionId(board) !== pendingPcbProposal.base.pcbRevisionId) {
      return "the live board changed since the proposal was created — request a fresh proposal.";
    }
    const head = canonicalSessionFor(liveHistory)?.headMetadataFor(board) ?? null;
    if (!head) return "the canonical editing session cannot prove the current board is its head (revalidation has not completed).";
    if (head.headSequence !== pendingPcbProposal.base.historyHead.sequence) {
      return "the board history advanced since the proposal was created — request a fresh proposal.";
    }
    if (head.lineageId !== pendingPcbProposal.base.lineageId) {
      return "the editing session lineage changed since the proposal was created — request a fresh proposal.";
    }
    if (drc.activePresetId !== pendingPcbProposal.validationPolicy.presetId) {
      return `the active DRC preset (${drc.activePresetId}) differs from the proposal's sealed validation policy (${pendingPcbProposal.validationPolicy.presetId}) — request a fresh proposal.`;
    }
    if (pcbProposalBusy) return "an apply is already in progress.";
    return null;
  }, [pendingPcbProposal, pcbProposalTick, init.demo, syncIdentity, currentInterlock, editorRuntime, state.board, drc.activePresetId, pcbProposalBusy]);

  const applyPcbProposal = useCallback(async () => {
    const proposal = pendingPcbProposal;
    const liveHistory = editorRuntime.getHistory();
    const interlock = currentInterlock?.() ?? null;
    if (!proposal || !liveHistory || !interlock || !syncIdentity) {
      setToast("The PCB proposal cannot be applied: the editor session or project interlock is unavailable. Nothing was changed.");
      return;
    }
    const lifecycleScope = pcbLifecycle.capture();
    setPcbProposalBusy(true);
    try {
      const journal = new ApprovedPcbMutationJournal(pcbJournalStoreRef.current!, {
        tenantId: syncIdentity.tenantId,
        projectId: syncIdentity.projectId,
        branchId: syncIdentity.branchId,
        boardInstanceId: syncIdentity.boardId,
      });
      const outcome = await approveAndApplyPcbEdit({
        proposal,
        history: liveHistory,
        interlock,
        journal,
        // [B16.0.1 §F] reload the live membership through the one narrow
        // same-origin endpoint before any capability is minted — a revoked,
        // downgraded, or logged-out author can never apply this sealed proposal.
        reauthorize: createPcbApplyReauthorizer(),
        stillCurrent: () => lifecycleScope.isCurrent(),
        currentProjectId: syncIdentity.projectId,
        currentBranchId: syncIdentity.branchId,
        tenantId: syncIdentity.tenantId,
        activeDrcPresetId: drc.activePresetId,
        originRunId: pcbProposalIntake?.originRunId ?? null,
        // §J step 17 — flush the working copy (with the canonical head
        // claim) BEFORE final success is reported; failures are truthful.
        settleAutosave: () => {
          const settledHistory = editorRuntime.getHistory();
          const settledBoard = settledHistory?.committedPresent ?? null;
          if (!settledHistory || !settledBoard) return false;
          const base = authorityRef.current ? { revision: authorityRef.current.revision, digest: authorityRef.current.digest } : null;
          const canonicalHead = canonicalSessionFor(settledHistory)?.headMetadataFor(settledBoard) ?? null;
          return saveWorkingCopy(syncIdentity.projectId, settledBoard, base, canonicalHead);
        },
      });
      if (outcome.ok) {
        if (outcome.status === "committed") {
          setToast(`PCB proposal applied as ONE canonical transaction (${outcome.receipt.transactionId.slice(0, 18)}…). Undo restores the exact previous board.${outcome.autosaveSettled ? "" : " WARNING: the working-copy autosave did not settle — your latest board is committed canonically but the browser working copy save failed."}`);
        } else {
          setToast("This PCB proposal was already applied; no second transaction was created.");
        }
        if (lifecycleScope.isCurrent()) drc.run();
        onPcbProposalSettled?.("applied");
      } else {
        setToast(`PCB proposal not applied: ${outcome.message}`);
        if (outcome.code === "session-superseded" || outcome.code === "foreign-scope" || outcome.code === "identity-poisoned" || outcome.code === "proposal-expired") {
          onPcbProposalSettled?.("retired");
        }
      }
    } finally {
      setPcbProposalBusy(false);
    }
  }, [pendingPcbProposal, editorRuntime, currentInterlock, syncIdentity, pcbLifecycle, drc, pcbProposalIntake, onPcbProposalSettled]);
  const liveReadiness = liveReadinessReport ? readinessViewModel(liveReadinessReport) : undefined;

  // ── Stage 15: 3D preview panel ──────────────────────────────────────────────
  // [B17-C] the 3D preview is VIEW state on the pcb3d view-session bus (open/close, camera, focus, layers, finish);
  // every entry point (toolbar, palette, Ctrl+3, Escape, the preview's own controls) issues the same command.
  const pcb3d = usePcb3dViewSession({ projectId: init.scope?.projectId ?? (init.demo ? "demo" : "local"), branchId: init.scope?.branchId ?? "main", board: state.board, actorId: init.scope ? "trusted-session" : "local", demo: init.demo });
  const preview3dOpen = pcb3d.view.open;

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
    getScope: () => syncIdentity ? { tenantId: syncIdentity.tenantId, projectId: syncIdentity.projectId, branchId: syncIdentity.branchId } : null, // [B16.0.2 §G] selector only
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
  const zoneFills = useZoneFills({ getHistory: () => editorRuntime.getHistory(), board: state.board });
  const [planeDialogOpen, setPlaneDialogOpen] = useState(false);
  const addPlane = useCallback((layer: LayerId, netId: number) => {
    const h = editorRuntime.getHistory();
    if (!h) return;
    const cmd: ZoneCommand = { kind: "AddZone", zone: makePlaneZone(h.present, layer, netId) };
    void commitPcbCandidate(h, {
      commandId: "pcb.zone",
      label: zoneCommandLabel(cmd, h.present),
      buildCandidate: (board) => produce(board, (d) => mutateBoardWithZoneCommand(d, cmd)),
    }).then((result) => { setToast(result.ok ? "Plane added — filling…" : result.message); });
  }, [editorRuntime]);

  // ── Stage 16: silkscreen tool ────────────────────────────────────────────────
  const silkTool = useSilkTool({
    scene,
    active: state.tool === "silk",
    getHistory: () => editorRuntime.getHistory(),
    toast: setToast,
  });

  // ── B08: dimension-annotation tool ──────────────────────────────────────────
  const dimensionTool = useDimensionTool({
    scene,
    active: state.tool === "dimension",
    getHistory: () => editorRuntime.getHistory(),
    toast: setToast,
  });
  void dimensionTool; // kind selection UI arrives with the toolbar segment

  // ── Stage 8: one-click auto-place (single-undo batch) ───────────────────────
  const autoPlace = useAutoPlace({
    getHistory: () => editorRuntime.getHistory(),
    captureLifecycle,
    getNetlist: () => liveNetlist,
    toast: setToast,
  });
  const enlargeBoardToFit = useCallback((): void => {
    const history = editorRuntime.getHistory();
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
    void commitPcbCandidate(history, {
      commandId: "pcb.board-geometry",
      label: "Enlarge board to fit imported parts",
      buildCandidate: (board) => produce(board, (draft) => {
        if (draft.outline.kind !== "rect" && draft.outline.kind !== "roundrect") return;
        draft.outline.origin = origin;
        draft.outline.width = maxX - origin.x;
        draft.outline.height = maxY - origin.y;
      }),
    }).then((result) => {
      if (!result.ok) { setToast(result.message); return; }
      setPlacementWarning(null);
      setToast("Board outline enlarged with a 5 mm placement margin. Undo is available.");
    });
  }, [editorRuntime]);

  // ── Stage 9: one-click Freerouting autoroute (single-undo import) ───────────
  const autoroute = useAutoroute({
    getHistory: () => editorRuntime.getHistory(),
    captureLifecycle,
    getScope: () => syncIdentity ? { tenantId: syncIdentity.tenantId, projectId: syncIdentity.projectId, branchId: syncIdentity.branchId } : null, // [B16.0.2 §B] selector only
    toast: setToast,
    getDrcRules: () => getPreset(drc.activePresetId).rules, // Stage 12: DRC on completion
    getDrcPresetId: () => drc.activePresetId,
    getNetlist: () => liveNetlist,
  });

  // B08.2 — lifecycle replacement IMMEDIATELY releases the new generation:
  // the adoption already aborted every captured scope's signal (fetches,
  // workers) synchronously; this effect then discards the stale visible
  // artifacts (previews, candidates, plans, busy state) so the fresh board
  // starts clean and usable. The invalidate() calls are silent by contract.
  const invalidateAutoPlace = autoPlace.invalidate;
  const invalidateAutoroute = autoroute.invalidate;
  const invalidateRepair = repair.invalidate;
  useEffect(() => {
    if (lifecycleGeneration === 0) return;
    invalidateAutoPlace();
    invalidateAutoroute();
    invalidateRepair();
  }, [lifecycleGeneration, invalidateAutoPlace, invalidateAutoroute, invalidateRepair]);

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
      state.tool === "route" || state.tool === "zone" || state.tool === "silk" || state.tool === "dimension" ? "select" : state.tool,
    );
  }, [scene, state.tool]);

  useEffect(() => {
    scene?.setGridVisible(state.gridOn);
  }, [scene, state.gridOn]);

  // B08 — outline-handle gestures commit ONE canonical transaction from the
  // rubber-band outline (the transient frames live only in the reducer's
  // set-outline preview; the canonical commit re-applies the final outline
  // to the board at serialized execution time).
  const commitOutlineGesture = useCallback((): void => {
    const h = editorRuntime.getHistory();
    const outline = boardRef.current?.outline;
    if (!h || !outline || outline === h.present.outline) return;
    void commitPcbCandidate(h, {
      commandId: "pcb.board-geometry",
      label: "Edit outline",
      buildCandidate: (board) => produce(board, (d) => { d.outline = structuredClone(outline); }),
    }).then((result) => { if (!result.ok) setToast(result.message); });
  }, [editorRuntime]);

  // ── Pointer interaction (scene → state) ───────────────────────────────────
  useEffect(() => {
    if (!scene) return;
    return scene.onPointer((e: ScenePointerEvent) => {
      if (toolRef.current === "route") return; // useRouteTool owns route-mode pointers
      if (toolRef.current === "zone") return; // ZoneTool owns zone-mode pointers
      if (toolRef.current === "silk") return; // useSilkTool owns silk-mode pointers (Stage 16)
      if (toolRef.current === "dimension") return; // useDimensionTool owns dimension-mode pointers (B08)
      if (toolRef.current === "pan") {
        // Viewport owns left-drag in pan mode; just keep hover clean.
        if (e.type === "move" || e.type === "leave") scene.setHover(null);
        return;
      }
      switch (e.type) {
        case "down": {
          if ((e.buttons & 2) !== 0) {
            // Right button: the select-move tool owns the context-menu flow.
            editorRuntime.getTool()?.handlePointer(e);
            return;
          }
          if ((e.buttons & 1) === 0) return; // left button only
          if (e.pick?.kind === "outline-handle") {
            dragRef.current = e.pick.handle;
            return;
          }
          editorRuntime.getTool()?.handlePointer(e);
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
          editorRuntime.getTool()?.handlePointer(e);
          return;
        }
        case "up": {
          if (dragRef.current !== null) {
            // Outline handle drag ends: ONE canonical transaction for the gesture.
            dragRef.current = null;
            commitOutlineGesture();
            return;
          }
          editorRuntime.getTool()?.handlePointer(e);
          return;
        }
        case "leave": {
          if (dragRef.current !== null) {
            // R06: an interrupted outline-handle drag must not leave a silent
            // uncommitted mutation — commit it as a visible history entry,
            // exactly like pointer-up does.
            dragRef.current = null;
            commitOutlineGesture();
            return;
          }
          editorRuntime.getTool()?.handlePointer(e);
          return;
        }
      }
    });
  }, [scene, commitOutlineGesture, editorRuntime]);

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
    close3d: () => {},
    openFab: () => {},
  });
  useEffect(() => {
    globalActionsRef.current = {
      autoPlace: () => void autoPlace.run(),
      autoroute: () => void autoroute.run(),
      runDrc: () => void drc.run(),
      toggle3d: () => pcb3d.toggle(), // [B17-C] pcb3d.open / pcb3d.close on the view-session bus
      close3d: () => pcb3d.setOpen(false),
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
        globalActionsRef.current.close3d(); // [B17-C] pcb3d.close through the same ref as the other global actions
        return;
      }
      // Undo/redo are editor-global. Route/zone/silk own their drawing keys,
      // but they must never make an already-committed gesture unreachable by
      // Ctrl+Z (Smart Route commits an entire candidate as one history entry).
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !editable) {
        const key = e.key.toLowerCase();
        if (key === "z" || key === "y") {
          e.preventDefault();
          if (key === "y" || (key === "z" && e.shiftKey)) editorRuntime.getHistory()?.redo();
          else editorRuntime.getHistory()?.undo();
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
        editorRuntime.getTool()?.handleKey(e)
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
  }, [selectionStore, editorRuntime]);

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
      (r) => r.kind === "track" || r.kind === "via" || r.kind === "zone" || r.kind === "text" || r.kind === "dimension",
    );
    const h = editorRuntime.getHistory();

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
  // B09.0 — the export handler reads STATE (boardRef/authorityRef are mere
  // mirrors of it), keeping the render-time palette builder free of any
  // ref access.
  const exportKicadFromPalette = useCallback((): void => {
    const board = init.demo ? state.board : authoritativeRecord?.board ?? null;
    if (board) void downloadKicadPcb(board, liveNetlist);
  }, [init.demo, state.board, authoritativeRecord, liveNetlist]);
  const buildPaletteActions = (): PaletteAction[] => {
    const board = state.board;
    const refs = selectionStore.get().refs;
    const movable = movableRefs(refs);
    const primary = selectionStore.get().primary;
    const h = editorRuntime.getHistory();
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
      { id: "3d", title: "Toggle 3D preview", hint: "Ctrl+3", run: () => pcb3d.toggle() },
      { id: "fab", title: "Send to fab…", hint: "Ctrl+B", run: () => setFabDialogOpen(true) },
      { id: "export-kicad", title: "Export .kicad_pcb", run: exportKicadFromPalette },
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
                (r) => r.kind === "track" || r.kind === "via" || r.kind === "zone" || r.kind === "text" || r.kind === "dimension",
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
        <div className="absolute inset-0 flex flex-col items-center justify-center overflow-auto bg-zinc-950" data-testid="pcb-empty-state">
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
            data-testid="sync-schematic-to-pcb"
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
          {syncBlockedByProtectedCopper && <button type="button" onClick={() => void handlePreviewBoardRevision()} disabled={syncing || applying || boardRevisionBusy} data-testid="derive-board-revision" className="mt-3 rounded border border-amber-500 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-50">Protected copper blocks this sync — derive a new board revision…</button>}
          {pendingPreflight?.plan && <button type="button" data-testid="apply-sync-plan" onClick={() => void handleApplySync()} disabled={applying} className="mt-3 rounded border border-teal-500 px-3 py-1.5 text-xs text-teal-200 disabled:opacity-50">{applying ? "Applying…" : "Apply verified plan"}</button>}
          {toast && <p className="mt-3 text-xs text-zinc-400">{toast}</p>}
          </div>
          {/* [B16-C.2/C.5] the review handoff is reachable BEFORE any board exists: an editor's first
              Schematic → PCB stops at binding here, and the reviewer decides here too. It sits in the
              flow below the call to action (an overlay covered the button on a small viewport). */}
          {!init.demo && syncIdentity && (
            <div className="mt-6 w-full max-w-2xl px-4">
              <ComponentReviewPanel review={componentReview} />
            </div>
          )}
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
            const h = editorRuntime.getHistory();
            // B08 — no history means no canonical session: refuse truthfully
            // (the former set-stackup dispatch was a silent, non-undoable write).
            if (!h) { setToast("The board is still loading — the stackup was not changed. Retry in a moment."); return; }
            void commitPcbCandidate(h, {
              commandId: "pcb.board-geometry",
              label: "Set stackup",
              buildCandidate: (board) => produce(board, (d) => {
                d.stackup = stackup;
                d.stackupConfig = stackupProfile(stackup === 4 ? "all-signal-4" : "simple-2");
                reconcileStackupPlaneZones(d);
              }),
            }).then((result) => { if (!result.ok) setToast(result.message); });
          }}
          outline={state.board.outline}
          onOutlineChange={(outline) => {
            // R06 Section 10: outline edits must be VISIBLE history entries.
            // The old fallback dispatched a silent set-outline before the
            // history existed — an untraceable board mutation that immediately
            // invalidated routing evidence. Refuse instead of mutating silently.
            const h = editorRuntime.getHistory();
            if (!h) { setToast("Board outline is still loading — try again in a moment."); return; }
            void commitPcbCandidate(h, {
              commandId: "pcb.board-geometry",
              label: "Edit outline",
              buildCandidate: (board) => produce(board, (d) => {
                d.outline = structuredClone(outline);
                reconcileStackupPlaneZones(d);
              }),
            }).then((result) => { if (!result.ok) setToast(result.message); });
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
          onToggle3d={() => pcb3d.toggle()} // Stage 15 / [B17-C] via the pcb3d view-session bus
          preview3dOpen={preview3dOpen} // Stage 15
          onTogglePadstacks={() => setPadstacksOpen((o) => !o)} // Stage 17
          padstacksOpen={padstacksOpen} // Stage 17
          onToggleAssignments={assignmentScope ? () => setAssignmentsOpen((open) => !open) : undefined}
          assignmentsOpen={assignmentsOpen}
          onUndo={() => editorRuntime.getHistory()?.undo()}
          onRedo={() => editorRuntime.getHistory()?.redo()}
          canUndo={visibleHistory.canUndo}
          canRedo={visibleHistory.canRedo}
          undoLabel={visibleHistory.undoLabel}
          redoLabel={visibleHistory.redoLabel}
          historyEntries={visibleHistory.entries}
          readiness={liveReadiness}
          onExportKicad={() => { const b = init.demo ? boardRef.current : authorityRef.current?.board; if (b) void downloadKicadPcb(b, liveNetlist, undefined, setToast); else setToast("Export requires a verified authoritative board."); }} // Stage 13
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
          {syncBlockedByProtectedCopper && <button type="button" onClick={() => void handlePreviewBoardRevision()} disabled={syncing || applying || boardRevisionBusy} data-testid="derive-board-revision" className="ml-2 rounded border border-amber-500 px-2 py-1 text-[11px] text-amber-200 disabled:opacity-50">Derive new board revision…</button>}
          {pendingPreflight?.plan && <button type="button" data-testid="apply-sync-plan-toolbar" onClick={() => void handleApplySync()} disabled={applying} className="ml-2 rounded border border-teal-500 px-2 py-1 text-[11px] text-teal-200 disabled:opacity-50">{applying ? "Applying…" : "Apply sync plan"}</button>}
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
                disabled={releasing || qualifying || routeStaleNotice !== null || !manufacturing.canRequestRelease}
                title={routeStaleNotice ? `Release blocked — ${routeStaleNotice}` : !manufacturing.canRequestRelease ? "Release needs a CURRENT qualification authority for this exact board (run Qualify & route first)" : "MFG01 verified manufacturing release — a separate administrator authorization follows (server recomputes RC01–RC03, deterministic Gerber ZIP)"}
                className="ml-1 rounded border border-zinc-600 px-2 py-1 text-[11px] text-zinc-200 hover:border-teal-500 disabled:opacity-50"
                data-testid="pcb-release-button"
              >
                {releasing ? "Releasing…" : "Request release"}
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
          {/* [B16.1C §F] the visible manufacturing workflow: durable truth,
              explicit state, qualification/release actions (disabled while
              pending), separate administrator authorization, explicit
              retry, and the release result — all reconstructed from the
              server after any refresh. */}
          {!init.demo && syncIdentity && (
            <div className="absolute bottom-2 left-2 z-30 flex max-w-2xl flex-col gap-1">
              {/* [B16-C.2] the review handoff sits with the manufacturing workflow: request → reviewer decision → resume. */}
              <ComponentReviewPanel review={componentReview} />
              <ManufacturingWorkflowPanel
                workflow={manufacturing}
                qualifying={qualifying}
                canQualify={Boolean(authoritativeRecord)}
                onQualify={() => void handleQualify()}
                routeStaleNotice={routeStaleNotice}
              />
            </div>
          )}
          {!init.demo && (
            <SnapshotConflictDialog conflict={snapshotConflict} busy={syncing} onRefresh={handleSnapshotConflictRefresh} onRebase={() => void handleSnapshotConflictRebase()} onDismiss={() => setSnapshotConflict(null)} />
          )}
          {!init.demo && (
            <BoardRevisionDialog open={boardRevisionOpen} preview={boardRevisionPreview} carry={boardRevisionCarry} busy={boardRevisionBusy} error={boardRevisionError} onCarryChange={handleBoardRevisionCarryChange} onDerive={() => void handleDeriveBoardRevision()} onDismiss={() => { if (!boardRevisionBusy) setBoardRevisionOpen(false); }} />
          )}
          {/* B08.2 — divergence notice from the reconciliation boundary:
              display-only, and self-retiring — any later lifecycle adoption
              or identity change makes it disappear (never a stale banner
              for an unrelated board). */}
          {serverDivergence && divergenceNoticeCurrent(serverDivergence, pcbLifecycle) && (
            <div className="absolute top-10 left-1/2 -translate-x-1/2 z-40 max-w-xl rounded border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200" data-testid="server-divergence-banner">
              Server authority diverged: {serverDivergence.description}
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
            getHistory={() => editorRuntime.getHistory()}
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
                  onClick={() => pcb3d.setOpen(false)}
                  className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <PcbPreview3D board={state.board} view={pcb3d.view} command={pcb3d.command} />
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
              items={buildCtxItems()}
              onClose={() => setCtxMenu(null)}
            />
          )}
          {/* Stage 17 Phase D: command palette (Ctrl+K) */}
          <CommandPalette
            open={paletteOpen}
            actions={buildPaletteActions()}
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
                key={`assist-generation-${lifecycleGeneration}`}
                board={state.board}
                getSelectionRefs={() => selectionStore.get().refs}
                getHistory={() => editorRuntime.getHistory()}
                rules={getPreset(drc.activePresetId).rules}
                presetId={drc.activePresetId}
                toast={setToast}
                aiOwnership={assistOwnership}
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
            const h = editorRuntime.getHistory();
            if (!h) return;
            void commitPcbCandidate(h, {
              commandId: "pcb.board-geometry",
              label,
              buildCandidate: (board) => produce(board, (draft) => {
                draft.stackup = stackup.copperLayers.length as 2 | 4;
                draft.stackupConfig = structuredClone(stackup);
                reconcileStackupPlaneZones(draft);
              }),
            }).then((result) => { if (!result.ok) setToast(result.message); });
          }}
        />
        <PlacementSetup
          board={state.board}
          result={autoPlace.lastResult}
          onApply={autoPlace.apply}
          onDiscard={autoPlace.discard}
          onChange={(preferences) => {
            const h = editorRuntime.getHistory();
            if (!h) return;
            void commitPcbCandidate(h, {
              commandId: "pcb.placement-settings",
              label: "Set auto-placement spacing",
              buildCandidate: (board) => produce(board, (draft) => {
                draft.placementPreferences = structuredClone(preferences);
              }),
            }).then((result) => { if (!result.ok) setToast(result.message); });
          }}
        />
        <RoutingRulesPanel board={state.board} netClasses={netClasses} toast={setToast} />
        {/* Stage 17: properties inspector — renders nothing when selection is empty */}
        <Inspector
          board={state.board}
          selection={selectionStore}
          getHistory={() => editorRuntime.getHistory()}
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
            getHistory={() => editorRuntime.getHistory()}
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
      {/* [B15.3 §I] the human-gated PCB proposal review — display grants
          nothing; only the explicit Approve click reaches the controller. */}
      <PcbProposalReviewDialog
        proposal={pendingPcbProposal}
        busy={pcbProposalBusy}
        disableReason={pcbProposalDisableReason}
        onApply={() => void applyPcbProposal()}
        onCancel={() => onPcbProposalSettled?.("cancelled")}
      />

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
