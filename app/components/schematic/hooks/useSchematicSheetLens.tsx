"use client";

/**
 * [PR-J3, 2026-10-22] Runbook J.3 items 1-3, 5-8 (OD-255 item 7, OD-257): THE sheet lens of the schematic editor. app/page.tsx calls it
 * once (the frozen wiring of the J3 plan):
 *
 *   const sheetLens = useSchematicSheetLens({ authoritative: authoritativeSchematic, graph: rawSchematicGraphApi, runSchematicCommand,
 *     projectId: project?.id ?? null, getPart: getCachedPart, components, wires, kicadComponents, netLabels, viewSessionBridge });
 *   const schematicGraphApi = sheetLens.graph;
 *   <SchematicEditor key={sheetLens.activation} components={sheetLens.components} wires={sheetLens.wires}
 *     kicadComponents={sheetLens.kicadComponents} netLabels={sheetLens.netLabels} graph={schematicGraphApi} {...sheetLens.editorProps} />
 *   <SheetNavigator {...sheetLens.navigatorProps} />
 *
 * What it returns: the ACTIVE sheet's entities as plain arrays (the canvas draws one sheet; the React arrays and `authoritative` stay
 * whole-project, so every consumer - PCB sync, ERC, BOM, SPICE, export - keeps the complete design), the graph authority wrapped for
 * that sheet (a command queued on sheet A lands on A after a switch to B; previews and commits are merged back onto the whole
 * project by id), the `activation` that keys the editor (a sheet switch = a fresh mount: a fresh view bus, the bridge re-registers),
 * the editor's sheet props (`initialCamera` from the per-project presentation store, `onCameraChange`, the overview's block layer,
 * `onLocateElsewhere` for a Go to that misses the active sheet) and the navigator's props. A single-sheet document (no `sheets`)
 * is handed back untouched: the same array references and the same graph object (`legacy`), so nothing about today's editor
 * changes until the user creates a sheet.
 *
 * The state lives in `SheetNavigationController` (framework-free; subscribed through useSyncExternalStore), which also holds the
 * async-retirement rules (SR-1..SR-4). The optional inputs (`selectedId` / `selectedKicadId`, `captureScope`, `onSheetSwitch`,
 * `storage`) are not part of the frozen call: without them the selection is read through the view-session bridge, the controller's
 * own project / activation token guards continuations, and the page's selection is cleared through the bus after each remount.
 *
 * [PR-J3 integration, 2026-10-23] Review J3N-1 / J3-PAGE-3: `initialCamera` is the controller's live camera of the active sheet (see
 * `editorProps` below), and a single-sheet document never writes the presentation store (the controller gates the write).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ViewSessionBridge } from "@/app/lib/agent/view-session-bridge";
import type { ProjectAsyncScope } from "@/app/lib/engineering/project-async-scope";
import type { SheetCamera, StorageLike } from "@/app/lib/project/sheet-navigation-store";
import { projectSheet, scopedGraph, type PartPinsSource, type SchematicGraphApi } from "@/app/lib/schematic/sheet-lens";
import { sheetPathName, sheetsOf } from "@/app/lib/schematic/sheets";
import { ROOT_SHEET_ID, type KicadComponentInstance, type NetLabel, type SchComponent, type SchematicState, type Wire } from "@/lib/schematic-types";
import { SheetBlocksLayer } from "../SheetBlocksLayer";
import type { SheetNavigatorProps } from "../SheetNavigator";
import { SheetNavigationController, type RunSchematicCommand } from "./sheet-navigation-controller";

export type { SchematicGraphApi } from "@/app/lib/schematic/sheet-lens";
export type { RunSchematicCommand, SheetCommandOutcome, SheetLensSnapshot } from "./sheet-navigation-controller";

export interface UseSchematicSheetLensInput {
  /** The page's authoritative schematic (whole project; `authoritativeSchematic`). */
  authoritative: SchematicState;
  /** The page's RAW graph authority (`rawSchematicGraphApi`). */
  graph: SchematicGraphApi;
  runSchematicCommand: RunSchematicCommand;
  projectId: string | null;
  /** `getCachedPart`: the parts cache (pins for the move planner and the connectivity). */
  getPart: PartPinsSource;
  /** The page's React arrays (they carry gesture preview frames; whole project). */
  components: SchComponent[];
  wires: Wire[];
  kicadComponents: KicadComponentInstance[];
  netLabels: NetLabel[];
  /** The page-owned bridge (`viewSessionBridgeRef.current`): the navigator replays select / focus / highlight on the fresh bus. */
  viewSessionBridge: ViewSessionBridge | null | undefined;
  // ── optional (not in the frozen call) ──
  selectedId?: string | null;
  selectedKicadId?: string | null;
  captureScope?: () => ProjectAsyncScope | null;
  onSheetSwitch?: () => void;
  storage?: StorageLike | null;
}

export interface SheetLensEditorProps {
  /** The stored camera of the active sheet; undefined: fit the page on mount. */
  initialCamera: SheetCamera | undefined;
  onCameraChange: (camera: SheetCamera) => void;
  /** The overview's subsystem blocks, rendered inside the editor's world group before the label map. */
  sheetLayer: ReactNode;
  /** Go to found no such component on the active sheet: true when the part's sheet was opened (select + focus replay there). */
  onLocateElsewhere: (ref: string) => boolean;
  /** [PR-J5, 2026-10-23] Runbook J.6.5: the sheets the agent's `schematic.open-sheet` view command resolves (id, display name, path; the
   *  document's order), undefined for a single-sheet document (the command then answers unavailable), and its open action (false when
   *  the document has no such sheet). Navigation stays a view command: the controller switches the canvas as the navigator does. */
  viewSheets: ReadonlyArray<{ id: string; name: string; path: string }> | undefined;
  openViewSheet: (sheetId: string) => boolean;
}

export interface SchematicSheetLens {
  /** No sheet tree: same arrays, same graph object, no layer. */
  legacy: boolean;
  /** The editor's React key. */
  activation: number;
  activeSheetId: string;
  notice: string | null;
  components: SchComponent[];
  wires: Wire[];
  kicadComponents: KicadComponentInstance[];
  netLabels: NetLabel[];
  graph: SchematicGraphApi;
  editorProps: SheetLensEditorProps;
  navigatorProps: SheetNavigatorProps;
  controller: SheetNavigationController;
}

export function useSchematicSheetLens(input: UseSchematicSheetLensInput): SchematicSheetLens {
  const { authoritative, graph: rawGraph, runSchematicCommand, projectId, getPart, components, wires, kicadComponents, netLabels, viewSessionBridge, selectedId, selectedKicadId, captureScope, onSheetSwitch, storage } = input;
  const bridge = viewSessionBridge ?? null;
  const [controller] = useState(() => new SheetNavigationController({ authoritative, projectId, graph: rawGraph, runSchematicCommand, getPart, viewSessionBridge: bridge, selectedId, selectedKicadId, captureScope, onSheetSwitch }, storage));
  useLayoutEffect(() => {
    controller.sync({ authoritative, projectId, graph: rawGraph, runSchematicCommand, getPart, viewSessionBridge: bridge, selectedId, selectedKicadId, captureScope, onSheetSwitch });
  }, [controller, authoritative, projectId, rawGraph, runSchematicCommand, getPart, bridge, selectedId, selectedKicadId, captureScope, onSheetSwitch]);
  useEffect(() => { controller.revive(); return () => controller.dispose(); }, [controller]); // [PR-J3, 2026-10-22] revive on (re)mount: StrictMode's simulated unmount disposes once and mounts the same instance again
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  // The replay queued for a new activation runs after its commit (the fresh editor has registered its bus with the bridge).
  useEffect(() => { controller.afterCommit(snapshot.activation); }, [controller, snapshot.activation]);

  const legacy = authoritative.sheets === undefined;
  // Derived for THIS render: the controller syncs after the commit, so a project it has not seen yet, or a sheet the document no
  // longer has, shows the root until the controller's own fallback lands (one frame; nothing is written).
  const activeSheetId = !legacy && snapshot.projectId === projectId && (snapshot.activeSheetId === ROOT_SHEET_ID || sheetsOf(authoritative).some((sheet) => sheet.id === snapshot.activeSheetId)) ? snapshot.activeSheetId : ROOT_SHEET_ID;
  const sheets = authoritative.sheets;
  const projection = useMemo(() => projectSheet({ components, wires, kicadComponents, netLabels, sheets }, activeSheetId), [components, wires, kicadComponents, netLabels, sheets, activeSheetId]);
  const graph = useMemo(() => (legacy ? rawGraph : scopedGraph(rawGraph, () => controller.authoritative(), () => controller.activeSheetId())), [legacy, rawGraph, controller]);

  const sheetLayer: ReactNode = legacy ? null : <SheetBlocksLayer state={authoritative} activeSheetId={activeSheetId} openSheet={controller.openSheet} />;
  // [PR-J5, 2026-10-23] the open-sheet view command's sheets and its open action (runbook J.6.5), from the authoritative tree
  const viewSheets = useMemo(() => (sheets === undefined ? undefined : sheets.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, path: sheetPathName({ sheets }, sheet.id) }))), [sheets]);
  const openViewSheet = useCallback((sheetId: string): boolean => {
    const tree = controller.authoritative().sheets;
    if (tree === undefined || !tree.sheets.some((sheet) => sheet.id === sheetId)) return false;
    controller.openSheet(sheetId);
    return true;
  }, [controller]);
  const editorProps: SheetLensEditorProps = {
    // [PR-J3 integration, 2026-10-23] review J3N-1: the camera comes from the controller's LIVE record (onCameraChange updates it
    // synchronously; a switch and a project load read the same record), not from the snapshot emitted at the last switch, so the editor
    // remounted when `sheets` appears or disappears (the page keys it `legacy ? undefined : activation`) starts from the camera the person
    // was at. A single-sheet document that has not had sheets in this project still fits the page on mount (hook test 1).
    initialCamera: legacy && !controller.hasSeenSheets(projectId) ? undefined : controller.cameraOf(activeSheetId),
    onCameraChange: controller.onCameraChange,
    sheetLayer,
    onLocateElsewhere: controller.locateElsewhere,
    viewSheets,
    openViewSheet,
  };
  const navigatorProps: SheetNavigatorProps = { state: authoritative, activeSheetId, activation: snapshot.activation, notice: snapshot.notice, controller: controller.api };
  return {
    legacy,
    activation: snapshot.activation,
    activeSheetId,
    notice: snapshot.notice,
    components: projection.components,
    wires: projection.wires,
    kicadComponents: projection.kicadComponents,
    netLabels: projection.netLabels,
    graph,
    editorProps,
    navigatorProps,
    controller,
  };
}
