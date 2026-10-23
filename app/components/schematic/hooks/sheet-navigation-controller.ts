"use client";

/**
 * [PR-J3, 2026-10-22] Runbook J.3 items 1-3, 5-8, J.8.2-J.8.4, J.9 (OD-257 items 1, 2, 5, 6): the Sheets navigator's CONTROLLER - the
 * framework-free owner of the active sheet, the per-sheet cameras, the sheet commands and the async-retirement rules, which
 * `useSchematicSheetLens` subscribes to (useSyncExternalStore) and the `SheetNavigator` component drives.
 *
 * Retirement (J.3 item 8; the B07.4 / B07.5 discipline, SR-1..SR-4 of the J3 plan):
 *  SR-1 every sheet-scoped continuation (a notice after a command, a replayed view command after a remount, the camera write)
 *       captures `{ projectId, activation }` and touches the lens or the presentation only while BOTH are current;
 *  SR-2 canonical mutations are the page's project-scoped FIFO jobs (`runSchematicCommand`, with the captured project scope when the
 *       page hands one): a sheet switch never cancels them (they land on the sheet captured at invocation), a project switch does;
 *  SR-3 a sheet switch synchronously cancels an active gesture (`graph.cancel()` rolls the preview back), asks the page to clear its
 *       wire draft and selection (`onSheetSwitch`, else the bus's clear-selection after the remount), increments the ACTIVATION (the
 *       editor's React key: a fresh mount, a fresh view bus, the B17-F bridge re-registers) and closes every preview (the navigator's
 *       dialogs are keyed by the activation);
 *  SR-4 A -> B -> A yields a NEW activation, so a continuation captured during the first A is refused and never revived; a missing
 *       active sheet (deleted, undone, another tab) falls back to its last known parent, else the root, with a notice and NO document
 *       write (J.8.4).
 *
 * Ids: new sheet and port ids are minted here, from `randomGenerationUuid` (crypto.getRandomValues) on the user's explicit action, never
 * `crypto.randomUUID` (the fixture browser numbers those draws and the committed router recording is keyed by them). Every command is
 * pre-applied with the executor's own operation code (`applySchematicOperationsToCanonical`) so a refusal (SHEET_NOT_EMPTY,
 * SHEET_NOT_EQUIVALENT, SHEET_RAIL_JOIN_REFUSED, ...) is shown verbatim before anything is submitted; the submission itself is the
 * page's canonical command runner (one transaction, one undo step).
 *
 * [PR-J3 integration, 2026-10-23] Review fixes: (J3N-1) the hook reads the camera of a sheet from the LIVE record (`cameraOf`, kept
 * current synchronously by `onCameraChange`) instead of the snapshot emitted at the last switch, so the editor remounted at the
 * single-sheet <-> multi-sheet boundary (the page keys it `legacy ? undefined : activation`) starts from the camera the person was at;
 * (J3-PAGE-3) a single-sheet document never writes the presentation store (the camera stays in memory for that boundary); (J3N-6)
 * `planMove` is pure - the operation-id prefix is stamped at apply - and answers from a cache keyed by the document, the active sheet,
 * the input, the selection and the parts still unresolved, so a re-render (StrictMode's double render, a parent update) never re-plans.
 */

import type { ViewSessionBridge } from "@/app/lib/agent/view-session-bridge";
import { applySchematicOperationsToCanonical } from "@/app/lib/engineering/operations";
import type { ProjectAsyncScope } from "@/app/lib/engineering/project-async-scope";
import { fromCanonicalSchematic, schematicStateDigest, toCanonicalSchematic, type CanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import type { EngineeringOperation } from "@/app/lib/engineering/types";
import { randomGenerationUuid } from "@/app/lib/project/generation-task-client";
import { emptySheetView, pruneSheetView, readSheetView, resolveStoredActiveSheet, withActiveSheet, withSheetCamera, writeSheetView, type SheetCamera, type SheetViewRecord, type StorageLike } from "@/app/lib/project/sheet-navigation-store";
import { resolveProjectConnectivity, type PartPinsLookup, type ProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import {
  MOVE_OFFSET_CANDIDATES,
  addPortOperations,
  attachedSelection,
  connectedSelection,
  deleteSheetImpact,
  deleteSheetOperations,
  freeBlockSlot,
  interfaceSignals,
  movableContents,
  parentSheetOf,
  reorderedSheets,
  sheetNameProblem,
  sheetOfComponentRef,
  type DeleteSheetImpact,
  type InterfaceSignal,
  type PartPinsSource,
  type SchematicGraphApi,
  type SheetSelection,
  type SignalDestination,
} from "@/app/lib/schematic/sheet-lens";
import { createSheetOperation, planMoveToSheet, renameSheetOperation, reorderSheetsOperation, type MoveEntityRef, type MoveToSheetInput, type MoveToSheetPlan } from "@/app/lib/schematic/sheet-operations";
import { sheetOf, sheetsOf } from "@/app/lib/schematic/sheets";
import { ROOT_SHEET_ID, type SchematicState, type SheetPortDirection } from "@/lib/schematic-types";

/** app/page.tsx `runSchematicCommand`: the project-scoped FIFO canonical command runner. */
export type RunSchematicCommand = (
  label: string,
  commandId: string,
  buildOperations: (schematic: CanonicalSchematic) => EngineeringOperation[],
  options?: { expectedBaseDigest?: string; scope?: ProjectAsyncScope },
) => Promise<{ ok: boolean; state?: SchematicState }>;

export interface SheetControllerInputs {
  authoritative: SchematicState;
  projectId: string | null;
  /** The page's RAW graph authority (the coordinator's begin / preview / cancel / commit and the command runner). */
  graph: SchematicGraphApi;
  runSchematicCommand: RunSchematicCommand;
  getPart: PartPinsSource;
  viewSessionBridge: ViewSessionBridge | null;
  /** The page's selection when it hands it over; otherwise the schematic view session's selection is read through the bridge. */
  selectedId: string | null | undefined;
  selectedKicadId: string | null | undefined;
  /** The page's project async scope capture (B07.4); without it the controller's own project / activation token guards. */
  captureScope: (() => ProjectAsyncScope | null) | undefined;
  /** Called synchronously at every sheet switch (the page clears its wire draft and selection here). */
  onSheetSwitch: (() => void) | undefined;
}

export interface SheetLensSnapshot {
  projectId: string | null;
  activeSheetId: string;
  /** The editor's mount key: incremented by every sheet switch and project change. */
  activation: number;
  notice: string | null;
  /** The camera stored for the active sheet (undefined: the editor fits the page on mount). */
  initialCamera: SheetCamera | undefined;
}

export type SheetCommandOutcome = { ok: true } | { ok: false; message: string };

export interface SelectionInfo extends SheetSelection {
  /** The reference designator (or the stable id). */
  label: string;
  sheetId: string;
}

export type MovePlanMode = "selection" | "group" | "contents";

export interface MovePlanInput {
  mode: MovePlanMode;
  /** For mode "contents": the sheet being emptied. */
  sourceSheetId?: string;
  /** For the selection modes: the part (defaults to the current selection). */
  selection?: SheetSelection;
  target: { sheetId: string } | { newSheet: { id: string; name: string } };
}

export type PlannedMove =
  | { ok: true; input: MoveToSheetInput; plan: Extract<MoveToSheetPlan, { ok: true }>; baseDigest: string; entityCount: number; targetName: string; offset: { dx: number; dy: number } }
  | { ok: false; message: string; code: string | null; entityCount: number };

export interface ReplayCommand {
  commandId: string;
  payload: unknown;
}

/** The navigator's controls call exactly these (bound arrow functions, so the B17 scanner sees their names). */
export interface SheetNavigatorApi {
  openSheet(sheetId: string): void;
  goBack(): void;
  dismissNotice(): void;
  mintId(prefix: string): string;
  currentSelection(): SelectionInfo | null;
  createSheet(name: string, parentId: string): Promise<SheetCommandOutcome>;
  renameSheet(sheetId: string, name: string): Promise<SheetCommandOutcome>;
  reorderSheet(sheetId: string, delta: -1 | 1): Promise<SheetCommandOutcome>;
  addPort(sheetId: string, name: string, direction: SheetPortDirection): Promise<SheetCommandOutcome>;
  deleteImpact(sheetId: string): DeleteSheetImpact;
  deleteSheet(sheetId: string): Promise<SheetCommandOutcome>;
  planMove(input: MovePlanInput): PlannedMove;
  applyMove(planned: PlannedMove): Promise<SheetCommandOutcome>;
  interfaceSignals(): InterfaceSignal[];
  followDestination(destination: SignalDestination): void;
}

const isEmptyDocument = (state: SchematicState): boolean =>
  state.sheets === undefined && state.components.length === 0 && state.wires.length === 0 && (state.kicadComponents ?? []).length === 0 && (state.netLabels ?? []).length === 0;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const CAMERA_WRITE_DELAY_MS = 250;
/** [PR-J3 integration, 2026-10-23] J3N-6: the operation-id prefix of a PREVIEW plan (pure); the applied transaction gets its own. */
export const MOVE_PREVIEW_PREFIX = "sheets:move:preview";

export class SheetNavigationController {
  private readonly listeners = new Set<() => void>();
  private snapshot: SheetLensSnapshot;
  private inputs: SheetControllerInputs;
  private record: SheetViewRecord;
  /** The stored record waits for the project's document (hydration lands after the first render). */
  private deferredRecord: boolean;
  private pendingReplay: { activation: number; commands: ReplayCommand[] } | null = null;
  private cameraTimer: ReturnType<typeof setTimeout> | null = null;
  private operationCounter = 0;
  private connectivityCache: { state: SchematicState; conn: ProjectConnectivity } | null = null;
  /** [PR-J3 integration, 2026-10-23] J3N-6: the last move plan and what it was planned over. */
  private planCache: { key: string; authoritative: SchematicState; activeSheetId: string; planned: PlannedMove } | null = null;
  /** [PR-J3 integration, 2026-10-23] J3N-1: the projects this controller has seen WITH a sheet tree (the boundary remount hands the live camera only then). */
  private readonly seenSheets = new Set<string>();
  private readonly lastKnownParents = new Map<string, string>();
  private disposed = false;

  constructor(inputs: SheetControllerInputs, private readonly storage?: StorageLike | null) {
    this.inputs = inputs;
    this.noteSheets(inputs);
    this.record = inputs.projectId === null ? emptySheetView() : readSheetView(inputs.projectId, storage) ?? emptySheetView();
    this.deferredRecord = isEmptyDocument(inputs.authoritative);
    const resolved = this.deferredRecord ? { sheetId: ROOT_SHEET_ID, notice: null } : resolveStoredActiveSheet(this.record, sheetsOf(inputs.authoritative));
    this.rememberParents(inputs.authoritative);
    this.snapshot = { projectId: inputs.projectId, activeSheetId: resolved.sheetId, activation: 1, notice: resolved.notice, initialCamera: this.record.cameras[resolved.sheetId] };
  }

  // ── the external store ────────────────────────────────────────────────────────────────────────────────────────────────────

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getSnapshot = (): SheetLensSnapshot => this.snapshot;

  private emit(next: Partial<SheetLensSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }

  authoritative(): SchematicState { return this.inputs.authoritative; }
  activeSheetId(): string { return this.snapshot.activeSheetId; }

  /** The hook calls this from its layout effect whenever an input changed. */
  sync(inputs: SheetControllerInputs): void {
    if (this.disposed) return;
    const previousProject = this.snapshot.projectId;
    this.inputs = inputs;
    this.noteSheets(inputs);
    if (inputs.projectId !== previousProject) { this.loadProject(previousProject, inputs); return; }
    if (this.deferredRecord && !isEmptyDocument(inputs.authoritative)) {
      this.deferredRecord = false;
      this.record = pruneSheetView(this.record, new Set(sheetsOf(inputs.authoritative).map((sheet) => sheet.id)));
      const resolved = resolveStoredActiveSheet(this.record, sheetsOf(inputs.authoritative));
      this.rememberParents(inputs.authoritative);
      if (resolved.sheetId !== this.snapshot.activeSheetId || resolved.notice !== null) this.switchTo(resolved.sheetId, { cancelGesture: false, notice: resolved.notice, replay: [] });
      return;
    }
    const active = this.snapshot.activeSheetId;
    if (active !== ROOT_SHEET_ID && !sheetsOf(inputs.authoritative).some((sheet) => sheet.id === active)) {
      // SR-4: the sheet is gone (deleted, undone, another tab): its last known parent when that still exists, else the root; no write
      const parent = this.lastKnownParents.get(active);
      const fallback = parent !== undefined && (parent === ROOT_SHEET_ID || sheetsOf(inputs.authoritative).some((sheet) => sheet.id === parent)) ? parent : ROOT_SHEET_ID;
      const fallbackName = fallback === ROOT_SHEET_ID ? "the overview" : `"${sheetsOf(inputs.authoritative).find((sheet) => sheet.id === fallback)?.name ?? fallback}"`;
      this.switchTo(fallback, { cancelGesture: true, notice: `The open sheet no longer exists (deleted, undone or changed elsewhere); showing ${fallbackName}. Nothing was changed.`, replay: [] });
    }
    this.rememberParents(inputs.authoritative);
  }

  private rememberParents(state: SchematicState): void {
    for (const sheet of sheetsOf(state)) if (sheet.parentId !== null) this.lastKnownParents.set(sheet.id, sheet.parentId);
  }

  private noteSheets(inputs: SheetControllerInputs): void {
    if (inputs.projectId !== null && inputs.authoritative.sheets !== undefined) this.seenSheets.add(inputs.projectId);
  }

  /** [PR-J3 integration, 2026-10-23] Review J3N-1: the camera the record holds for `sheetId` RIGHT NOW - `onCameraChange` updates the
   *  record synchronously, `switchTo` / `loadProject` read the same record - so the hook hands the editor remounted at the single-sheet
   *  <-> multi-sheet boundary the camera the person was at, not the one the snapshot carried from the last switch or the open. */
  cameraOf(sheetId: string): SheetCamera | undefined {
    return this.record.cameras[sheetId];
  }

  /** True once `projectId` was seen with a sheet tree by this controller: a single-sheet document keeps the fit-on-mount until then. */
  hasSeenSheets(projectId: string | null): boolean {
    return projectId !== null && this.seenSheets.has(projectId);
  }

  private loadProject(previousProject: string | null, inputs: SheetControllerInputs): void {
    this.flushCamera(previousProject);
    this.pendingReplay = null;
    this.connectivityCache = null;
    this.lastKnownParents.clear();
    this.record = inputs.projectId === null ? emptySheetView() : readSheetView(inputs.projectId, this.storage) ?? emptySheetView();
    this.deferredRecord = isEmptyDocument(inputs.authoritative);
    const resolved = this.deferredRecord ? { sheetId: ROOT_SHEET_ID, notice: null } : resolveStoredActiveSheet(this.record, sheetsOf(inputs.authoritative));
    this.rememberParents(inputs.authoritative);
    this.emit({ projectId: inputs.projectId, activeSheetId: resolved.sheetId, activation: this.snapshot.activation + 1, notice: resolved.notice, initialCamera: this.record.cameras[resolved.sheetId] });
  }

  /** The hook calls this after every commit of a new activation: the replay queued for THIS activation runs on the fresh editor. */
  afterCommit(activation: number): void {
    const pending = this.pendingReplay;
    if (!pending || pending.activation !== activation || this.disposed) return;
    this.pendingReplay = null;
    void this.replay(pending.commands, activation);
  }

  dispose(): void {
    this.flushCamera(this.snapshot.projectId);
    this.disposed = true;
    this.pendingReplay = null;
    this.listeners.clear();
  }

  /** [PR-J3, 2026-10-22] The hook's mount effect: React StrictMode (Next's dev default) runs the effect cleanup once on a simulated
   *  unmount and mounts again with the SAME controller instance, so a disposal must be reversible or the navigator is dead under
   *  `next dev`. The store's subscribers re-subscribe through useSyncExternalStore; nothing else was lost by the flush. */
  revive(): void {
    this.disposed = false;
  }

  // ── retirement tokens (SR-1, SR-4) ────────────────────────────────────────────────────────────────────────────────────────

  private token(): { projectId: string | null; activation: number } {
    return { projectId: this.snapshot.projectId, activation: this.snapshot.activation };
  }

  private isCurrent(token: { projectId: string | null; activation: number }): boolean {
    return !this.disposed && token.projectId === this.snapshot.projectId && token.activation === this.snapshot.activation;
  }

  private setNotice(notice: string | null): void {
    if (this.disposed || this.snapshot.notice === notice) return;
    this.emit({ notice });
  }

  // ── navigation ────────────────────────────────────────────────────────────────────────────────────────────────────────────

  private switchTo(sheetId: string, options: { cancelGesture: boolean; notice: string | null; replay: ReplayCommand[] }): void {
    this.flushCamera(this.snapshot.projectId);
    if (options.cancelGesture) {
      this.inputs.graph.cancel(); // SR-3: an active gesture is rolled back, never carried to another sheet
      this.inputs.onSheetSwitch?.();
    }
    const activation = this.snapshot.activation + 1;
    this.record = withActiveSheet(this.record, sheetId);
    this.writeRecord(this.snapshot.projectId);
    this.pendingReplay = { activation, commands: [{ commandId: "schematic.clear-selection", payload: null }, ...options.replay] };
    this.emit({ activeSheetId: sheetId, activation, notice: options.notice, initialCamera: this.record.cameras[sheetId] });
  }

  private async replay(commands: readonly ReplayCommand[], activation: number): Promise<void> {
    const token = { projectId: this.snapshot.projectId, activation };
    for (const command of commands) {
      if (!this.isCurrent(token)) return; // SR-4: a later switch retires the continuation
      const bridge = this.inputs.viewSessionBridge;
      if (!bridge) return;
      try { await bridge.dispatchPageCommand("schematic", command.commandId, command.payload); } catch { return; }
    }
  }

  readonly openSheet = (sheetId: string): void => { this.open(sheetId, []); };

  private open(sheetId: string, replay: ReplayCommand[]): void {
    if (this.disposed) return;
    const sheets = sheetsOf(this.inputs.authoritative);
    if (sheetId !== ROOT_SHEET_ID && !sheets.some((sheet) => sheet.id === sheetId)) { this.setNotice(`Sheet ${sheetId} does not exist. Nothing was changed.`); return; }
    if (sheetId === this.snapshot.activeSheetId) {
      if (replay.length > 0) void this.replay(replay, this.snapshot.activation);
      return;
    }
    this.switchTo(sheetId, { cancelGesture: true, notice: null, replay });
  }

  readonly goBack = (): void => {
    const active = this.snapshot.activeSheetId;
    if (active === ROOT_SHEET_ID) return;
    this.openSheet(parentSheetOf(this.inputs.authoritative, active));
  };

  readonly dismissNotice = (): void => { this.setNotice(null); };

  /** The editor's Go to found no such component on the active sheet: open the part's sheet and replay select + focus there. */
  readonly locateElsewhere = (ref: string): boolean => {
    const sheetId = sheetOfComponentRef(this.inputs.authoritative, ref);
    if (sheetId === null || sheetId === this.snapshot.activeSheetId) return false;
    this.open(sheetId, [{ commandId: "schematic.select", payload: { target: { kind: "component", ref } } }, { commandId: "schematic.focus", payload: { target: { kind: "component", ref } } }]);
    return true;
  };

  readonly followDestination = (destination: SignalDestination): void => {
    this.open(destination.sheetId, [
      { commandId: "schematic.highlight-net", payload: { name: destination.labelName } },
      { commandId: "schematic.focus", payload: { target: { kind: "point", x: destination.position.x, y: destination.position.y } } },
    ]);
  };

  // ── the presentation store (OD-257 item 5) ────────────────────────────────────────────────────────────────────────────────

  readonly onCameraChange = (camera: SheetCamera): void => {
    if (this.disposed || !Number.isFinite(camera.zoom) || camera.zoom <= 0 || !Number.isFinite(camera.pan.x) || !Number.isFinite(camera.pan.y)) return;
    this.record = withSheetCamera(this.record, this.snapshot.activeSheetId, camera);
    // [PR-J3 integration, 2026-10-23] review J3-PAGE-3: a single-sheet document writes NOTHING to the presentation store (the hook's
    // contract: nothing about today's editor changes until the person creates a sheet); the camera stays in the in-memory record so the
    // editor remounted when the first sheet is created starts from it (J3N-1). A document with sheets writes after the delay, as before.
    if (this.inputs.authoritative.sheets === undefined) return;
    if (this.cameraTimer !== null) clearTimeout(this.cameraTimer);
    const projectId = this.snapshot.projectId;
    this.cameraTimer = setTimeout(() => { this.cameraTimer = null; if (!this.disposed && this.snapshot.projectId === projectId) this.writeRecord(projectId); }, CAMERA_WRITE_DELAY_MS);
  };

  private flushCamera(projectId: string | null): void {
    if (this.cameraTimer === null) return;
    clearTimeout(this.cameraTimer);
    this.cameraTimer = null;
    this.writeRecord(projectId);
  }

  private writeRecord(projectId: string | null): void {
    if (projectId === null) return;
    writeSheetView(projectId, this.record, this.storage);
  }

  // ── ids and selection ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A new sheet or port id: `crypto.getRandomValues`, never `crypto.randomUUID` (fixture replay), on the user's action only. */
  readonly mintId = (prefix: string): string => `${prefix}-${randomGenerationUuid()}`;

  readonly currentSelection = (): SelectionInfo | null => {
    const { selectedId, selectedKicadId, viewSessionBridge, authoritative } = this.inputs;
    let id: string | null = null;
    if (selectedId !== undefined || selectedKicadId !== undefined) {
      id = selectedKicadId ?? selectedId ?? null;
    } else {
      const captured = viewSessionBridge?.capture();
      const selection = captured?.editors.schematic?.state.selection;
      if (typeof selection === "object" && selection !== null && typeof (selection as { id?: unknown }).id === "string") id = (selection as { id: string }).id;
    }
    if (id === null) return null;
    const theory = authoritative.components.find((item) => item.id === id);
    if (theory) return { family: "theory", id, label: theory.refDes ?? theory.id, sheetId: sheetOf(theory) };
    const kicad = (authoritative.kicadComponents ?? []).find((item) => item.id === id);
    if (kicad) return { family: "kicad", id, label: kicad.refDes, sheetId: sheetOf(kicad) };
    return null;
  };

  private partLookup(): PartPinsLookup {
    const getPart = this.inputs.getPart;
    return (partId) => getPart(partId) ?? null;
  }

  private connectivity(): ProjectConnectivity {
    const state = this.inputs.authoritative;
    if (this.connectivityCache?.state === state) return this.connectivityCache.conn;
    const conn = resolveProjectConnectivity(state, this.partLookup());
    this.connectivityCache = { state, conn };
    return conn;
  }

  // ── the structural commands (schematic.sheet-structure) ───────────────────────────────────────────────────────────────────

  private operationPrefix(kind: string): string {
    this.operationCounter += 1;
    return `sheets:${kind}:${this.operationCounter}`;
  }

  /** The executor's own apply over the current document: the verbatim refusal, or null. */
  private preflight(operations: readonly EngineeringOperation[]): string | null {
    try {
      applySchematicOperationsToCanonical(toCanonicalSchematic(this.inputs.authoritative), operations);
      return null;
    } catch (error) {
      return messageOf(error);
    }
  }

  private refuse(message: string): SheetCommandOutcome {
    this.setNotice(message);
    return { ok: false, message };
  }

  private async runStructural(label: string, operations: EngineeringOperation[]): Promise<SheetCommandOutcome> {
    const problem = this.preflight(operations);
    if (problem !== null) return this.refuse(problem);
    const token = this.token();
    const scope = this.inputs.captureScope?.() ?? null;
    const result = await this.inputs.runSchematicCommand(label, "schematic.sheet-structure", () => operations, scope ? { scope } : undefined);
    if (result.ok) return { ok: true };
    const message = `"${label}" was not applied. Nothing was changed.`;
    if (this.isCurrent(token)) this.setNotice(message);
    return { ok: false, message };
  }

  readonly createSheet = async (name: string, parentId: string): Promise<SheetCommandOutcome> => {
    const state = this.inputs.authoritative;
    if (parentId !== ROOT_SHEET_ID && !sheetsOf(state).some((sheet) => sheet.id === parentId)) return this.refuse(`Sheet ${parentId} does not exist. Nothing was changed.`);
    const problem = sheetNameProblem(state, parentId, name);
    if (problem !== null) return this.refuse(problem);
    const trimmed = name.trim();
    const id = this.mintId("sheet");
    const operation = createSheetOperation(state, { operationId: `${this.operationPrefix("create")}:${id}`, sheet: { id, name: trimmed, parentId, block: freeBlockSlot(state, parentId) }, rootName: "Overview" });
    return this.runStructural(`Created sheet ${trimmed}`, [operation]);
  };

  readonly renameSheet = async (sheetId: string, name: string): Promise<SheetCommandOutcome> => {
    const state = this.inputs.authoritative;
    const sheet = sheetsOf(state).find((item) => item.id === sheetId);
    if (!sheet || state.sheets === undefined) return this.refuse("The sheet does not exist. Nothing was changed.");
    const problem = sheetNameProblem(state, sheet.parentId, name, sheetId);
    if (problem !== null) return this.refuse(problem);
    const trimmed = name.trim();
    if (trimmed === sheet.name) return { ok: true };
    return this.runStructural(`Renamed sheet ${sheet.name} to ${trimmed}`, [renameSheetOperation(`${this.operationPrefix("rename")}:${sheetId}`, sheetId, trimmed)]);
  };

  readonly reorderSheet = async (sheetId: string, delta: -1 | 1): Promise<SheetCommandOutcome> => {
    const state = this.inputs.authoritative;
    const order = reorderedSheets(state, sheetId, delta);
    if (order === null) return this.refuse(`The sheet cannot move further ${delta < 0 ? "up" : "down"}. Nothing was changed.`);
    const name = sheetsOf(state).find((item) => item.id === sheetId)?.name ?? sheetId;
    return this.runStructural(`Moved sheet ${name} ${delta < 0 ? "up" : "down"}`, [reorderSheetsOperation(`${this.operationPrefix("reorder")}:${sheetId}`, order)]);
  };

  readonly addPort = async (sheetId: string, name: string, direction: SheetPortDirection): Promise<SheetCommandOutcome> => {
    const state = this.inputs.authoritative;
    const portId = this.mintId("port");
    const built = addPortOperations(state, { sheetId, port: { id: portId, name, direction }, labelId: `${portId}:label`, pinId: `${portId}:pin`, operationIdPrefix: this.operationPrefix("port") });
    if (!built.ok) return this.refuse(built.message);
    const sheetName = sheetsOf(state).find((item) => item.id === sheetId)?.name ?? sheetId;
    return this.runStructural(`Added port ${name.trim()} to ${sheetName}`, built.operations);
  };

  readonly deleteImpact = (sheetId: string): DeleteSheetImpact => deleteSheetImpact(this.inputs.authoritative, sheetId);

  readonly deleteSheet = async (sheetId: string): Promise<SheetCommandOutcome> => {
    const state = this.inputs.authoritative;
    const built = deleteSheetOperations(state, sheetId, this.operationPrefix("delete"));
    if (!built.ok) return this.refuse(built.message);
    const name = sheetsOf(state).find((item) => item.id === sheetId)?.name ?? sheetId;
    // the sheet being deleted is open: leave it first (its parent), so the lens never shows a sheet the document no longer has
    if (this.snapshot.activeSheetId === sheetId) this.open(parentSheetOf(state, sheetId), []);
    return this.runStructural(`Deleted sheet ${name}`, built.operations);
  };

  // ── moving a selection (schematic.move-to-sheet; OD-257 items 1, 2, 6) ────────────────────────────────────────────────────

  /** [PR-J3 integration, 2026-10-23] Review J3N-6: the plan is PURE (no counter; the operation-id prefix is stamped by `applyMove`) and
   *  answered from a cache while the document (by identity), the active sheet, the input, the resolved selection and the set of parts
   *  whose pins are still unresolved are the ones it was planned over - a re-render alone never resolves the project connectivity again
   *  (the planner does so three times per candidate offset); a part whose pins arrive re-plans (the unresolved-pins refusal clears). */
  readonly planMove = (input: MovePlanInput): PlannedMove => {
    const state = this.inputs.authoritative;
    const selection = input.mode === "contents" ? null : input.selection ?? this.currentSelection();
    const unresolved = (state.kicadComponents ?? []).filter((item) => !this.inputs.getPart(item.partId)).map((item) => item.partId).sort();
    const key = JSON.stringify([input.mode, input.sourceSheetId ?? null, selection ? [selection.family, selection.id] : null, input.target, unresolved]);
    const cached = this.planCache;
    if (cached !== null && cached.authoritative === state && cached.activeSheetId === this.snapshot.activeSheetId && cached.key === key) return cached.planned;
    const planned = this.computeMovePlan(input, selection);
    this.planCache = { key, authoritative: state, activeSheetId: this.snapshot.activeSheetId, planned };
    return planned;
  };

  private computeMovePlan(input: MovePlanInput, resolvedSelection: SheetSelection | null): PlannedMove {
    const state = this.inputs.authoritative;
    const getPart = this.inputs.getPart;
    let entities: MoveEntityRef[] | null;
    let sourceSheetId: string;
    if (input.mode === "contents") {
      sourceSheetId = input.sourceSheetId ?? this.snapshot.activeSheetId;
      entities = movableContents(state, sourceSheetId);
    } else {
      const selection = resolvedSelection;
      if (!selection) return { ok: false, message: "Select a component on this sheet first; the move takes the selected part with its attached wires and local labels, or its connected group.", code: null, entityCount: 0 };
      entities = input.mode === "group" ? connectedSelection(state, selection, getPart) : attachedSelection(state, selection, getPart);
      const pool: ReadonlyArray<{ id: string; sheetId?: string }> = selection.family === "theory" ? state.components : state.kicadComponents ?? [];
      const entity = pool.find((item) => item.id === selection.id);
      sourceSheetId = entity ? sheetOf(entity) : this.snapshot.activeSheetId;
      // OD-257 item 1: the move takes the selection on the OPEN sheet; a stale selection on another sheet is named, never moved blind
      if (entity && sourceSheetId !== this.snapshot.activeSheetId) {
        const name = sheetsOf(state).find((sheet) => sheet.id === sourceSheetId);
        return { ok: false, message: `The selected part is on ${name?.parentId === null ? "the overview" : `sheet "${name?.name ?? sourceSheetId}"`}, not on the open sheet; open that sheet to move it. Nothing was changed.`, code: null, entityCount: 0 };
      }
    }
    if (entities === null || entities.length === 0) return { ok: false, message: "Nothing to move: the selection is not on this sheet.", code: null, entityCount: 0 };
    const sheets = sheetsOf(state);
    const target: MoveToSheetInput["target"] = "newSheet" in input.target
      ? { newSheet: { id: input.target.newSheet.id, name: input.target.newSheet.name.trim(), block: freeBlockSlot(state, sourceSheetId) } }
      : { sheetId: input.target.sheetId };
    const targetName = "newSheet" in target ? target.newSheet.name : (sheets.find((sheet) => sheet.id === target.sheetId)?.name ?? target.sheetId);
    if ("newSheet" in target) {
      const problem = sheetNameProblem(state, sourceSheetId, target.newSheet.name);
      if (problem !== null) return { ok: false, message: problem, code: null, entityCount: entities.length };
    }
    const base: Omit<MoveToSheetInput, "offset"> = { entities, target, rootName: "Overview", operationIdPrefix: MOVE_PREVIEW_PREFIX }; // [PR-J3 integration, 2026-10-23] J3N-6: a constant prefix at preview; applyMove stamps the transaction's own
    const lookup = this.partLookup();
    let last: Extract<MoveToSheetPlan, { ok: false }> | null = null;
    for (const offset of "newSheet" in target ? [MOVE_OFFSET_CANDIDATES[0]!] : MOVE_OFFSET_CANDIDATES) {
      const plan = planMoveToSheet(state, { ...base, offset }, lookup);
      if (plan.ok) return { ok: true, input: { ...base, offset }, plan, baseDigest: schematicStateDigest(state), entityCount: entities.length, targetName, offset };
      last = plan;
      // only a landing on the target sheet's existing connections is worth another offset; every other refusal stands
      if (!(plan.code === "SHEET_MOVE_NOT_EQUIVALENT" && plan.message.includes("would touch other connections"))) break;
    }
    return { ok: false, message: last?.message ?? "The move was refused.", code: last?.code ?? null, entityCount: entities.length };
  }

  readonly applyMove = async (planned: PlannedMove): Promise<SheetCommandOutcome> => {
    if (!planned.ok) return this.refuse(planned.message);
    const token = this.token();
    const scope = this.inputs.captureScope?.() ?? null;
    const lookup = this.partLookup();
    const label = `Moved ${planned.entityCount} item${planned.entityCount === 1 ? "" : "s"} to ${planned.targetName}`;
    const input: MoveToSheetInput = { ...planned.input, operationIdPrefix: this.operationPrefix("move") }; // [PR-J3 integration, 2026-10-23] J3N-6: the transaction's operation ids are stamped here, once, never during a render
    let refusal: string | null = null;
    const result = await this.inputs.runSchematicCommand(label, "schematic.move-to-sheet", (canonical) => {
      // re-planned on the canonical base INSIDE the serialized queue: the previewed partition must be the one that results
      const again = planMoveToSheet(fromCanonicalSchematic(canonical), input, lookup);
      if (!again.ok) { refusal = again.message; throw new Error(again.message); }
      if (again.preview.partitionDigest !== planned.plan.preview.partitionDigest) {
        refusal = "The design changed since this move was previewed: the connections it would produce differ from the preview. Review the move again. Nothing was changed.";
        throw new Error(refusal);
      }
      return again.operations;
    }, { expectedBaseDigest: planned.baseDigest, ...(scope ? { scope } : {}) });
    if (result.ok) return { ok: true };
    const message = refusal ?? `"${label}" was not applied. Nothing was changed.`;
    if (this.isCurrent(token)) this.setNotice(message);
    return { ok: false, message };
  };

  // ── cross-sheet signals (J.3 item 6) ──────────────────────────────────────────────────────────────────────────────────────

  readonly interfaceSignals = (): InterfaceSignal[] => {
    const state = this.inputs.authoritative;
    if (state.sheets === undefined) return [];
    return interfaceSignals(state, this.connectivity(), this.snapshot.activeSheetId);
  };

  /** The controls' API (bound methods only). */
  readonly api: SheetNavigatorApi = {
    openSheet: this.openSheet,
    goBack: this.goBack,
    dismissNotice: this.dismissNotice,
    mintId: this.mintId,
    currentSelection: this.currentSelection,
    createSheet: this.createSheet,
    renameSheet: this.renameSheet,
    reorderSheet: this.reorderSheet,
    addPort: this.addPort,
    deleteImpact: this.deleteImpact,
    deleteSheet: this.deleteSheet,
    planMove: this.planMove,
    applyMove: this.applyMove,
    interfaceSignals: this.interfaceSignals,
    followDestination: this.followDestination,
  };
}
