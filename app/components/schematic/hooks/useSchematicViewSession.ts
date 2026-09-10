"use client";

/**
 * [B17-D] The schematic editor's view session: ONE bus per editor mount.
 * Fit, zoom, pan/focus by reference designator or id, select, net-label
 * highlight and "this component" from the versioned selection are
 * `schematic.*` view commands; the hook applies the bus state to the
 * canvas' pan/zoom and the page's selection, and mirrors what the human
 * changes outside the bus (wheel zoom, drag pan, a click) back through
 * `schematic.observe`. Nothing here is engineering state.
 */
import { useEffect, useRef } from "react";
import type { ProjectRole } from "@/app/lib/engineering/types";
import { schematicCommands, schematicInitialState, schematicViewProbe, type SchematicFamily, type SchematicProbeSources, type SchematicViewState, type SheetPoint } from "@/app/lib/view-session/schematic";
import type { ViewTarget } from "@/app/lib/view-session/targets";
import type { ViewCommandDescriptor, ViewCommandEnvelope, ViewCommandResult } from "@/app/lib/view-session/types";
import { useViewSession, type ViewCommandOk, type ViewCommandRefusal } from "@/app/components/view-session/useViewSession";

export interface SchematicViewSessionInput {
  projectId: string;
  branchId: string;
  actorId: string;
  role?: ProjectRole;
  sources: SchematicProbeSources | null;
  selectedId: string | null;
  selectedKicadId: string | null;
  applySelection: (id: string | null, family: SchematicFamily | null) => void;
  camera: { pan: SheetPoint; zoom: number };
  viewportPx: () => { width: number; height: number } | null;
  applyCamera: (next: { pan: SheetPoint; zoom: number }) => void;
  fitToPage: () => void;
}

export type SchematicViewResult = ViewCommandOk | ViewCommandRefusal;

export interface SchematicViewSession {
  view: SchematicViewState;
  viewRevision: number;
  command: (commandId: string, payload: unknown) => Promise<SchematicViewResult>;
  dispatch: (envelope: ViewCommandEnvelope) => Promise<ViewCommandResult<SchematicViewState>>;
  sessionId: string;
  fitPage: () => void;
  zoomBy: (factor: number) => void;
  focus: (target: ViewTarget) => Promise<SchematicViewResult>;
  select: (target: ViewTarget) => Promise<SchematicViewResult>;
  clearSelection: () => void;
  highlightNet: (name: string) => Promise<SchematicViewResult>;
  clearHighlight: () => void;
}

type Deps = { sources: SchematicProbeSources | null };
const INITIAL_STATE = schematicInitialState();
const schematicSessionCommands = (deps: () => Deps): ViewCommandDescriptor<SchematicViewState, never>[] => schematicCommands(() => schematicViewProbe(deps().sources));

export function useSchematicViewSession(input: SchematicViewSessionInput): SchematicViewSession {
  const session = useViewSession<SchematicViewState, Deps>({
    editor: "schematic",
    projectId: input.projectId,
    branchId: input.branchId,
    actorId: input.actorId,
    role: input.role,
    initialState: INITIAL_STATE,
    deps: { sources: input.sources },
    commands: schematicSessionCommands,
  });
  const { view, command } = session;
  const latest = useRef(input);
  useEffect(() => { latest.current = input; });

  // Camera intents fly once per sequence number.
  const appliedCameraSeq = useRef(0);
  useEffect(() => {
    if (view.camera.seq === appliedCameraSeq.current) return;
    appliedCameraSeq.current = view.camera.seq;
    const { fitToPage, applyCamera, viewportPx, camera } = latest.current;
    if (view.camera.kind === "page") { fitToPage(); return; }
    const size = viewportPx();
    if (!size || !view.camera.centerPx) return;
    const zoom = view.camera.zoom ?? camera.zoom;
    applyCamera({ zoom, pan: { x: size.width / 2 - view.camera.centerPx.x * zoom, y: size.height / 2 - view.camera.centerPx.y * zoom } });
  }, [view.camera]);
  // Selection: apply when the bus selection differs from the page's.
  useEffect(() => {
    const { selectedId, selectedKicadId, applySelection } = latest.current;
    const current = selectedId ?? selectedKicadId ?? null;
    if (current === view.selection.id) return;
    applySelection(view.selection.id, view.selection.family);
  }, [view.selection]);

  // Mirror the human's own changes.
  const observe = (payload: Record<string, unknown>): void => { void command("schematic.observe", payload); };
  const currentId = input.selectedId ?? input.selectedKicadId ?? null;
  useEffect(() => { observe({ selection: { id: currentId } }); }, [currentId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const size = latest.current.viewportPx();
      if (size) observe({ camera: { pan: latest.current.camera.pan, zoom: latest.current.camera.zoom, viewportPx: size } });
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.camera.pan.x, input.camera.pan.y, input.camera.zoom]);

  const fire = (commandId: string, payload: unknown): void => { void command(commandId, payload); };
  return {
    view,
    viewRevision: session.viewRevision,
    command,
    dispatch: session.dispatch,
    sessionId: session.sessionId,
    fitPage: () => fire("schematic.fit-page", null),
    zoomBy: (factor) => fire("schematic.zoom", { factor }),
    focus: (target) => command("schematic.focus", { target }),
    select: (target) => command("schematic.select", { target }),
    clearSelection: () => fire("schematic.clear-selection", null),
    highlightNet: (name) => command("schematic.highlight-net", { name }),
    clearHighlight: () => fire("schematic.clear-highlight", null),
  };
}
