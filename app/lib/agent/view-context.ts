/**
 * [B17-F] The captured VIEW CONTEXT and the view-command channel.
 *
 * The view-session buses live in the browser (one per editor mount). The
 * agent runs on the server, so:
 *  - what the editors SHOW reaches the run as a captured, bounded, digest-
 *    pinned snapshot (`sirkit.view-context.v1`: which editor surfaces exist,
 *    each editor's view state and revision, the project operation timeline)
 *    — read tools answer from it, and discovery gates tools by surface;
 *  - a view-session TOOL call is validated here (registry-backed command,
 *    surface present, role, exact payload against the SAME command
 *    descriptors the browser bus runs, expected revision from the snapshot)
 *    and becomes a `sirkit.view-command-request.v1` the browser executes on
 *    its bus as the trusted `agent` actor. The server never applies a view
 *    command itself; the bus's stale-revision rules, role gates and human-
 *    only `observe` stay in force. Nothing here is engineering state.
 */
import { engineeringDigest } from "../engineering/stable";
import type { ToolDescriptor, ToolProjectState } from "../engineering/tool-registry";
import type { CanonicalProjectState } from "../engineering/types";
import type { ProjectOperation } from "../project/operation-timeline";
import { boardGeometryProbe, pcb3dCommands, PCB3D_CAMERA_PRESETS, PCB3D_LAYERS } from "../view-session/pcb3d";
import { pcbCommands, pcbViewProbe, PCB_LAYER_IDS } from "../view-session/pcb";
import { schematicCommands, schematicViewProbe } from "../view-session/schematic";
import { workspaceCommands, WORKSPACE_TABS, type WorkspaceTab } from "../view-session/workspace";
import { VIEW_EDITORS, type TrustedViewActor, type ViewCommandDescriptor, type ViewEditor } from "../view-session/types";
import { pageSizePx } from "@/lib/page-sizes";
import type { PageSize, SchematicState } from "@/lib/schematic-types";

export const VIEW_CONTEXT_SCHEMA = "sirkit.view-context.v1" as const;
export const VIEW_COMMAND_REQUEST_SCHEMA = "sirkit.view-command-request.v1" as const;

const MAX_STATE_BYTES = 32_000;
const MAX_TIMELINE_ENTRIES = 50;
const MAX_STRING = 200;

/** One editor's captured view: its session, revision and a bounded state summary (the bus state). */
export interface CapturedEditorView {
  editor: ViewEditor;
  sessionId: string;
  viewRevision: number;
  state: Record<string, unknown>;
}

export interface CapturedTimeline {
  entries: ProjectOperation[];
  eligibleUndo: { ok: boolean; code: string | null; operation: { store: string; kind: string; label: string; seq: number } | null } | null;
}

export interface CapturedViewContext {
  schema: typeof VIEW_CONTEXT_SCHEMA;
  /** The editor surfaces that exist in this browser session (a bus is live for each). */
  surfaces: ViewEditor[];
  editors: Partial<Record<ViewEditor, CapturedEditorView>>;
  timeline: CapturedTimeline | null;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isEditor = (value: unknown): value is ViewEditor => typeof value === "string" && (VIEW_EDITORS as readonly string[]).includes(value);
const shortString = (value: unknown): value is string => typeof value === "string" && value.length <= MAX_STRING;

/** Exact, bounded validation of a client-captured view context; anything else withholds the view resources (never widens). */
export function validateCapturedViewContext(raw: unknown): { ok: true; view: CapturedViewContext } | { ok: false; reason: string } {
  if (!isObject(raw)) return { ok: false, reason: "view context is not an object" };
  if (raw.schema !== VIEW_CONTEXT_SCHEMA) return { ok: false, reason: `unsupported view context schema ${String(raw.schema)}` };
  const keys = Object.keys(raw).sort();
  if (keys.join(",") !== "editors,schema,surfaces,timeline") return { ok: false, reason: `unexpected view context keys ${keys.join(",")}` };
  if (!Array.isArray(raw.surfaces) || raw.surfaces.length > VIEW_EDITORS.length || !raw.surfaces.every(isEditor)) return { ok: false, reason: "surfaces must list editor surfaces" };
  const surfaces = [...new Set(raw.surfaces as ViewEditor[])].sort();
  if (!isObject(raw.editors)) return { ok: false, reason: "editors must be an object" };
  const editors: Partial<Record<ViewEditor, CapturedEditorView>> = {};
  for (const [key, value] of Object.entries(raw.editors)) {
    if (!isEditor(key) || !surfaces.includes(key)) return { ok: false, reason: `editor ${key} is not a listed surface` };
    if (!isObject(value) || value.editor !== key || !shortString(value.sessionId) || typeof value.viewRevision !== "number" || !Number.isInteger(value.viewRevision) || value.viewRevision < 0 || !isObject(value.state)) return { ok: false, reason: `editor ${key} view is malformed` };
    const stateJson = JSON.stringify(value.state);
    if (stateJson.length > MAX_STATE_BYTES) return { ok: false, reason: `editor ${key} view state exceeds ${MAX_STATE_BYTES} bytes` };
    editors[key] = { editor: key, sessionId: value.sessionId, viewRevision: value.viewRevision, state: JSON.parse(stateJson) as Record<string, unknown> };
  }
  let timeline: CapturedTimeline | null = null;
  if (raw.timeline !== null) {
    if (!isObject(raw.timeline) || !Array.isArray(raw.timeline.entries) || raw.timeline.entries.length > MAX_TIMELINE_ENTRIES) return { ok: false, reason: "timeline must carry a bounded entry list" };
    const entries: ProjectOperation[] = [];
    for (const entry of raw.timeline.entries) {
      if (!isObject(entry) || typeof entry.seq !== "number" || typeof entry.at !== "number" || (entry.store !== "schematic" && entry.store !== "pcb") || !shortString(entry.kind) || !shortString(entry.label) || !shortString(entry.actor) || !isObject(entry.head)) return { ok: false, reason: "timeline entry is malformed" };
      entries.push({ seq: entry.seq, at: entry.at, store: entry.store, kind: entry.kind as ProjectOperation["kind"], label: entry.label, actor: entry.actor as ProjectOperation["actor"], head: entry.head as ProjectOperation["head"], ...(isObject(entry.ref) ? { ref: entry.ref as ProjectOperation["ref"] } : {}) });
    }
    let eligibleUndo: CapturedTimeline["eligibleUndo"] = null;
    if (raw.timeline.eligibleUndo !== null && raw.timeline.eligibleUndo !== undefined) {
      const e = raw.timeline.eligibleUndo;
      if (!isObject(e) || typeof e.ok !== "boolean" || !(e.code === null || shortString(e.code))) return { ok: false, reason: "timeline eligibility is malformed" };
      const op = isObject(e.operation) && shortString(e.operation.store) && shortString(e.operation.kind) && shortString(e.operation.label) && typeof e.operation.seq === "number" ? { store: e.operation.store, kind: e.operation.kind, label: e.operation.label, seq: e.operation.seq } : null;
      eligibleUndo = { ok: e.ok, code: (e.code as string | null) ?? null, operation: op };
    }
    timeline = { entries, eligibleUndo };
  }
  return { ok: true, view: { schema: VIEW_CONTEXT_SCHEMA, surfaces, editors, timeline } };
}

export function viewContextDigest(view: CapturedViewContext): string { return engineeringDigest(view); }

/** The project states the captured surfaces prove (discovery gates tools by them). */
export function viewProjectStates(view: CapturedViewContext | null): ToolProjectState[] {
  if (!view) return [];
  const states: ToolProjectState[] = [];
  for (const surface of view.surfaces) states.push(`${surface}-surface` as ToolProjectState);
  return states;
}

// ── Read projections (the two read tools answer from the snapshot) ──────────

export function inspectViewState(view: CapturedViewContext, args: { editor?: unknown } = {}): Record<string, unknown> {
  const editor = isEditor(args.editor) ? args.editor : null;
  const editors = Object.values(view.editors).filter((item): item is CapturedEditorView => Boolean(item) && (editor === null || item!.editor === editor));
  return { schema: VIEW_CONTEXT_SCHEMA, surfaces: view.surfaces, editors: editors.map((item) => ({ editor: item.editor, viewRevision: item.viewRevision, state: item.state })), note: "View state is what the editors show; it is never engineering state. A view command's expectedViewRevision must equal the editor's viewRevision above." };
}

export function inspectProjectTimeline(view: CapturedViewContext, args: { limit?: unknown } = {}): Record<string, unknown> {
  const limit = typeof args.limit === "number" && Number.isInteger(args.limit) && args.limit > 0 ? Math.min(args.limit, MAX_TIMELINE_ENTRIES) : MAX_TIMELINE_ENTRIES;
  const entries = view.timeline?.entries ?? [];
  return { schema: VIEW_CONTEXT_SCHEMA, entries: entries.slice(-limit).map((op) => ({ seq: op.seq, at: op.at, store: op.store, kind: op.kind, label: op.label, actor: op.actor, transactionId: op.ref?.transactionId ?? null })), eligibleUndo: view.timeline?.eligibleUndo ?? null, note: "The timeline references the schematic and PCB histories; project undo delegates to the owning editor's own undo and refuses when that history moved on. No cross-store atomicity exists." };
}

// ── The view-command request (server-validated, browser-executed) ───────────

export interface ViewCommandRequest {
  schema: typeof VIEW_COMMAND_REQUEST_SCHEMA;
  requestId: string;
  toolId: string;
  editor: ViewEditor;
  sessionId: string;
  commandId: string;
  payload: unknown;
  expectedViewRevision: number;
  actor: TrustedViewActor;
  issuedAt: string;
  expiresAt: string;
}

export interface ViewCommandPreparationContext {
  canonicalState: CanonicalProjectState | null;
  view: CapturedViewContext | null;
  actor: TrustedViewActor;
  runId: string;
  now?: () => number;
}

export type ViewCommandPreparation =
  | { ok: true; request: ViewCommandRequest }
  | { ok: false; status: "invalid_input" | "view_surface_unavailable" | "view_command_unknown" | "authority_unavailable"; diagnostics: string[] };

/** The canonical state pins the schematic as opaque JSON; only a structurally sound one feeds the probe. */
function schematicShape(value: unknown): SchematicState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SchematicState>;
  return Array.isArray(candidate.components) ? (candidate as SchematicState) : null;
}

/** The SAME command descriptors the browser bus runs, instantiated over server-side probes for validation only. */
export function serverViewCommands(editor: ViewEditor, canonicalState: CanonicalProjectState | null, view: CapturedViewContext | null): ViewCommandDescriptor<unknown, never>[] {
  const board = canonicalState?.pcb ?? null;
  switch (editor) {
    case "pcb3d": return pcb3dCommands(() => (board ? boardGeometryProbe(board) : null)) as unknown as ViewCommandDescriptor<unknown, never>[];
    case "pcb": return pcbCommands(() => pcbViewProbe({ board })) as unknown as ViewCommandDescriptor<unknown, never>[];
    case "schematic": {
      const schematic = schematicShape(canonicalState?.schematic);
      const size = pageSizePx((schematic?.pageSize ?? "A4") as PageSize);
      return schematicCommands(() => schematicViewProbe(schematic ? { components: schematic.components, kicadComponents: schematic.kicadComponents ?? [], netLabels: schematic.netLabels ?? [], pagePx: { width: size.widthPx, height: size.heightPx } } : null)) as unknown as ViewCommandDescriptor<unknown, never>[];
    }
    case "workspace": {
      const tabs = (view?.editors.workspace?.state.available as unknown) ;
      const available = Array.isArray(tabs) && tabs.every((tab) => (WORKSPACE_TABS as readonly string[]).includes(String(tab))) ? (tabs as WorkspaceTab[]) : [...WORKSPACE_TABS];
      return workspaceCommands(() => available) as unknown as ViewCommandDescriptor<unknown, never>[];
    }
  }
}

const OBJECT_KINDS = ["footprint", "track", "via", "zone", "text", "dimension"] as const;

/** The catalog's FLAT strict-schema target (nullable optional fields) → the bus's semantic `ViewTarget`; malformed input
 *  is passed through unchanged so the bus command's own validation names the defect. */
export function toolTarget(raw: unknown): unknown {
  if (!isObject(raw) || typeof raw.kind !== "string") return raw;
  const s = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);
  switch (raw.kind) {
    case "component": return { kind: "component", ref: s(raw.ref) };
    case "object": {
      const objectKind = s(raw.objectKind);
      if (objectKind === "pad") return { kind: "object", ref: { kind: "pad", footprintId: s(raw.footprintId), padNumber: s(raw.padNumber) } };
      return { kind: "object", ref: { kind: objectKind, id: s(raw.objectId) } };
    }
    case "net": return { kind: "net", ...(typeof raw.netId === "number" ? { netId: raw.netId } : {}), ...(s(raw.name) ? { name: s(raw.name) } : {}) };
    case "point": return { kind: "point", x: raw.x, y: raw.y };
    case "selection": return { kind: "selection" };
    case "primary": return { kind: "primary" };
    default: return raw;
  }
}

/** The catalog's flat selection references → `SelectionRef`s (pad refs carry footprintId + padNumber). */
export function toolRefs(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((item) => {
    if (!isObject(item) || typeof item.kind !== "string") return item;
    if (item.kind === "pad") return { kind: "pad", footprintId: item.footprintId, padNumber: item.padNumber };
    return (OBJECT_KINDS as readonly string[]).includes(item.kind) ? { kind: item.kind, id: item.id } : item;
  });
}

const target = (value: Record<string, unknown>): unknown => toolTarget(value.target);
const isSelectionRelative = (value: unknown): boolean => isObject(value) && (value.kind === "selection" || value.kind === "primary");

/** Map a tool's flat, strict-schema arguments onto ONE bus command; null when the arguments name no command. */
export function viewCommandFor(toolId: string, args: Record<string, unknown>): { editor: ViewEditor; commandId: string; payload: unknown } | null {
  const editor = isEditor(args.editor) ? args.editor : null;
  const action = typeof args.action === "string" ? args.action : null;
  switch (toolId) {
    case "sirkit.view.pcb3d": {
      if (!action) return null;
      const map: Record<string, { commandId: string; payload: unknown }> = {
        open: { commandId: "pcb3d.open", payload: null },
        close: { commandId: "pcb3d.close", payload: null },
        "camera-preset": { commandId: "pcb3d.camera-preset", payload: { preset: args.preset } },
        "fit-board": { commandId: "pcb3d.fit-board", payload: null },
        "reset-camera": { commandId: "pcb3d.reset-camera", payload: null },
        "focus-component": { commandId: "pcb3d.focus-component", payload: { ref: args.ref } },
        "focus-selection": { commandId: "pcb3d.focus-selection", payload: { refs: [] } }, // filled from the captured PCB selection by the preparer
        "focus-net": { commandId: "pcb3d.focus-net", payload: { ...(typeof args.netId === "number" ? { netId: args.netId } : {}), ...(typeof args.name === "string" ? { name: args.name } : {}) } },
        "set-layer-visible": { commandId: "pcb3d.set-layer-visible", payload: { layer: args.layer, visible: args.visible } },
        "toggle-layer": { commandId: "pcb3d.toggle-layer", payload: { layer: args.layer } },
        "set-finish": { commandId: "pcb3d.set-finish", payload: { finish: args.finish } },
        "read-state": { commandId: "pcb3d.read-state", payload: null },
      };
      const hit = map[action];
      return hit ? { editor: "pcb3d", ...hit } : null;
    }
    case "sirkit.view.canvas-navigation": {
      if (!editor || !action) return null;
      if (editor === "workspace") return action === "open-editor" ? { editor, commandId: "workspace.open-editor", payload: { editor: args.tab } } : null;
      if (editor === "pcb3d") return null;
      const prefix = editor;
      const map: Record<string, { commandId: string; payload: unknown } | null> = {
        fit: { commandId: prefix === "pcb" ? "pcb.fit-board" : "schematic.fit-page", payload: null },
        "fit-selection": prefix === "pcb" ? { commandId: "pcb.fit-selection", payload: {} } : null,
        zoom: { commandId: `${prefix}.zoom`, payload: { factor: args.factor } },
        "zoom-to": { commandId: `${prefix}.zoom-to`, payload: prefix === "pcb" ? { pxPerMm: args.scale } : { zoom: args.scale } },
        "pan-to": { commandId: `${prefix}.pan-to`, payload: { target: target(args) } },
        focus: { commandId: `${prefix}.focus`, payload: { target: target(args) } },
      };
      const hit = map[action];
      return hit ? { editor, ...hit } : null;
    }
    case "sirkit.selection.control": {
      if (!editor || !action || editor === "pcb3d" || editor === "workspace") return null;
      if (editor === "schematic") {
        const map: Record<string, { commandId: string; payload: unknown } | null> = {
          select: { commandId: "schematic.select", payload: { target: target(args) } },
          clear: { commandId: "schematic.clear-selection", payload: null },
          "highlight-net": { commandId: "schematic.highlight-net", payload: { name: args.name } },
          "clear-highlight": { commandId: "schematic.clear-highlight", payload: null },
        };
        const hit = map[action];
        return hit ? { editor, ...hit } : null;
      }
      const net = { ...(typeof args.netId === "number" ? { netId: args.netId } : {}), ...(typeof args.name === "string" ? { name: args.name } : {}) };
      const refsOrTarget = Array.isArray(args.refs) ? { refs: toolRefs(args.refs) } : { target: target(args) };
      const map: Record<string, { commandId: string; payload: unknown }> = {
        select: { commandId: "pcb.select", payload: refsOrTarget },
        add: { commandId: "pcb.select-add", payload: refsOrTarget },
        remove: { commandId: "pcb.select-remove", payload: refsOrTarget },
        clear: { commandId: "pcb.clear-selection", payload: null },
        "select-net": { commandId: "pcb.select-net", payload: net },
        "highlight-net": { commandId: "pcb.highlight-net", payload: net },
        "clear-highlight": { commandId: "pcb.clear-highlight", payload: null },
      };
      const hit = map[action];
      return hit ? { editor: "pcb", ...hit } : null;
    }
    case "sirkit.view.layers": {
      if (!action) return null;
      const map: Record<string, { commandId: string; payload: unknown }> = {
        "set-visible": { commandId: "pcb.set-layer-visible", payload: { layer: args.layer, visible: args.visible } },
        toggle: { commandId: "pcb.toggle-layer", payload: { layer: args.layer } },
        "set-active": { commandId: "pcb.set-active-layer", payload: { layer: args.layer } },
        isolate: { commandId: "pcb.isolate-layer", payload: { layer: args.layer } },
        "show-copper": { commandId: "pcb.show-copper", payload: null },
        "set-grid": { commandId: "pcb.set-grid", payload: { visible: args.visible } },
        "toggle-grid": { commandId: "pcb.toggle-grid", payload: null },
      };
      const hit = map[action];
      return hit ? { editor: "pcb", ...hit } : null;
    }
    case "sirkit.view.reveal-finding": {
      if (!editor || editor === "pcb3d" || editor === "workspace") return null;
      return { editor, commandId: `${editor}.reveal-finding`, payload: { findingId: args.findingId } };
    }
    case "sirkit.view.measure": {
      if (!action) return null;
      if (action === "clear") return { editor: "pcb", commandId: "pcb.clear-measurement", payload: null };
      if (action === "measure") return { editor: "pcb", commandId: "pcb.measure", payload: { a: toolTarget(args.a), b: toolTarget(args.b) } };
      return null;
    }
    default:
      return null;
  }
}

/** Validate a view-session tool call against the registry-backed command set and the captured view; produce the request the browser executes. */
export function prepareViewCommandRequest(input: { descriptor: ToolDescriptor; args: Record<string, unknown>; context: ViewCommandPreparationContext; ttlMs?: number }): ViewCommandPreparation {
  const { descriptor, args, context } = input;
  const mapped = viewCommandFor(descriptor.toolId, args);
  if (!mapped) return { ok: false, status: "invalid_input", diagnostics: ["The arguments name no command of this tool (check editor/action)."] };
  const allowed = descriptor.viewCommands ?? [];
  if (!allowed.includes(mapped.commandId)) return { ok: false, status: "view_command_unknown", diagnostics: [`${mapped.commandId} is not a command this tool is registered for.`] };
  if (!context.view) return { ok: false, status: "view_surface_unavailable", diagnostics: ["No view context was captured for this run; view commands are unavailable."] };
  const surface = context.view.editors[mapped.editor];
  if (!context.view.surfaces.includes(mapped.editor) || !surface) return { ok: false, status: "view_surface_unavailable", diagnostics: [`The ${mapped.editor} editor surface is not open in the user's session.`] };
  if ((mapped.editor === "pcb" || mapped.editor === "pcb3d") && !context.canonicalState?.pcb) return { ok: false, status: "authority_unavailable", diagnostics: ["No validated board exists for this run; PCB view commands are unavailable."] };
  const command = serverViewCommands(mapped.editor, context.canonicalState, context.view).find((item) => item.commandId === mapped.commandId);
  if (!command) return { ok: false, status: "view_command_unknown", diagnostics: [`${mapped.commandId} is not a command of the ${mapped.editor} view session.`] };
  if (command.roles && !command.roles.includes(context.actor.role)) return { ok: false, status: "invalid_input", diagnostics: [`Role ${context.actor.role} may not issue ${mapped.commandId}.`] };
  // Selection-relative targets are VERSIONED: the request pins the selection digest the captured view reported, so a
  // selection the user changed since the capture refuses (the bus's own rule) instead of acting on the wrong thing.
  let payload = mapped.payload;
  const selection = isObject(surface.state.selection) ? surface.state.selection : null;
  const selectionDigest = selection && typeof selection.digest === "string" ? selection.digest : null;
  if (selectionDigest && isObject(payload)) {
    const relative = isSelectionRelative(payload.target) || isSelectionRelative(payload.a) || isSelectionRelative(payload.b) || mapped.commandId === "pcb.fit-selection" || mapped.commandId === "pcb3d.focus-selection";
    if (relative) payload = { ...payload, selectionDigest };
  }
  // "Focus the selection" in 3D takes the PCB editor's CURRENT selection refs (the model never holds refs).
  if (mapped.commandId === "pcb3d.focus-selection") {
    const pcbSelection = isObject(context.view.editors.pcb?.state.selection) ? (context.view.editors.pcb!.state.selection as Record<string, unknown>) : null;
    const refs = pcbSelection && Array.isArray(pcbSelection.refs) ? pcbSelection.refs : null;
    if (!refs || refs.length === 0) return { ok: false, status: "invalid_input", diagnostics: ["The PCB selection is empty or unavailable in the captured view; select something first or focus a component by reference."] };
    payload = { refs };
  }
  const validated = command.validate(payload);
  if (!validated.ok) return { ok: false, status: "invalid_input", diagnostics: [validated.message] };
  const now = context.now ? context.now() : Date.now();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + (input.ttlMs ?? 60_000)).toISOString();
  const requestId = `vcr-${engineeringDigest({ runId: context.runId, editor: mapped.editor, commandId: mapped.commandId, payload: validated.value ?? null, issuedAt, actor: context.actor.actorId }).slice(5)}`;
  return {
    ok: true,
    request: {
      schema: VIEW_COMMAND_REQUEST_SCHEMA,
      requestId,
      toolId: descriptor.toolId,
      editor: mapped.editor,
      sessionId: surface.sessionId,
      commandId: mapped.commandId,
      payload: validated.value,
      expectedViewRevision: surface.viewRevision,
      actor: { actorId: context.actor.actorId, role: context.actor.role, actorKind: "agent" },
      issuedAt,
      expiresAt,
    },
  };
}

/** Exact validation of a request the browser receives (a fabricated or malformed event is dropped, never executed). */
export function parseViewCommandRequest(raw: unknown): ViewCommandRequest | null {
  if (!isObject(raw) || raw.schema !== VIEW_COMMAND_REQUEST_SCHEMA) return null;
  if (!shortString(raw.requestId) || !shortString(raw.toolId) || !isEditor(raw.editor) || !shortString(raw.sessionId) || !shortString(raw.commandId) || !shortString(raw.issuedAt) || !shortString(raw.expiresAt)) return null;
  if (typeof raw.expectedViewRevision !== "number" || !Number.isInteger(raw.expectedViewRevision) || raw.expectedViewRevision < 0) return null;
  if (!isObject(raw.actor) || !shortString(raw.actor.actorId) || !shortString(raw.actor.role) || raw.actor.actorKind !== "agent") return null;
  if (!raw.commandId.startsWith(`${raw.editor}.`) || raw.commandId.endsWith(".observe")) return null;
  return { schema: VIEW_COMMAND_REQUEST_SCHEMA, requestId: raw.requestId, toolId: raw.toolId, editor: raw.editor, sessionId: raw.sessionId, commandId: raw.commandId, payload: raw.payload, expectedViewRevision: raw.expectedViewRevision, actor: { actorId: raw.actor.actorId, role: raw.actor.role as TrustedViewActor["role"], actorKind: "agent" }, issuedAt: raw.issuedAt, expiresAt: raw.expiresAt };
}

/** The enumerations the catalog's strict schemas expose (derived from the bus modules, never hand-copied). */
export const VIEW_TOOL_ENUMS = Object.freeze({
  editors: [...VIEW_EDITORS],
  pcb3dPresets: [...PCB3D_CAMERA_PRESETS],
  pcb3dLayers: [...PCB3D_LAYERS],
  pcbLayers: [...PCB_LAYER_IDS],
  workspaceTabs: [...WORKSPACE_TABS],
});
