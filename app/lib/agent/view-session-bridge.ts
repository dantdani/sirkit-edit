/**
 * [B17-F] The page-owned VIEW-SESSION BRIDGE — the browser half of the
 * agent's view tools.
 *
 *  - Every editor view session (pcb3d, pcb, schematic, workspace) REGISTERS
 *    itself here while it is live: its identity, a pull of its current view
 *    revision and state, and its bus dispatch.
 *  - `capture()` builds ONE bounded `sirkit.view-context.v1` snapshot for a
 *    chat request: the surfaces that exist, each editor's session id /
 *    revision / bounded state, and the project operation timeline. The
 *    server validates it exactly and never treats it as authority.
 *  - `execute()` runs a server-validated `sirkit.view-command-request.v1`
 *    on the named editor's OWN bus as the agent actor: the request must
 *    parse exactly, be unexpired, name a live surface and the SAME session
 *    id, and the bus's own stale-revision rule, role gate and single
 *    settlement (the request id is the invocation id, so a replayed event
 *    returns the settled result instead of running twice) decide the rest.
 *
 * Nothing here touches engineering state.
 */
import type { ProjectOperationTimeline } from "../project/operation-timeline";
import { createViewCommand } from "../view-session/bus";
import type { ViewCommandEnvelope, ViewCommandResult, ViewEditor, ViewSessionIdentity } from "../view-session/types";
import { parseViewCommandRequest, VIEW_CONTEXT_SCHEMA, type CapturedEditorView, type CapturedTimeline, type CapturedViewContext } from "./view-context";

export interface ViewSessionRegistration {
  identity: ViewSessionIdentity;
  /** True while the registering editor's lifecycle is current (false after unmount or retirement). */
  isCurrent(): boolean;
  viewRevision(): number;
  /** The bus state (bounded by the bridge before capture). */
  state(): unknown;
  dispatch(envelope: ViewCommandEnvelope): Promise<ViewCommandResult<unknown>>;
}

export type ViewCommandExecution =
  | { ok: true; status: "settled"; editor: ViewEditor; commandId: string; viewRevision: number; changed: boolean; rebased: boolean }
  | { ok: false; status: "refused" | "cancelled" | "expired" | "surface_unavailable" | "session_mismatch" | "malformed"; editor: ViewEditor | null; commandId: string | null; code: string | null; message: string };

const MAX_ARRAY = 32;
const MAX_STRING = 200;
const MAX_DEPTH = 6;
const MAX_TIMELINE = 50;

/** A JSON-safe, bounded copy of a bus state: long arrays become counts, long strings are cut, deep trees are pruned. */
export function boundedViewState(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (depth >= MAX_DEPTH) return "[pruned]";
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) return { truncated: true, count: value.length, first: value.slice(0, 4).map((item) => boundedViewState(item, depth + 1)) };
    return value.map((item) => boundedViewState(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "function" || item === undefined) continue;
      out[key] = boundedViewState(item, depth + 1);
    }
    return out;
  }
  return null;
}

function captureTimeline(timeline: ProjectOperationTimeline | null | undefined): CapturedTimeline | null {
  if (!timeline) return null;
  const entries = timeline.entries().slice(-MAX_TIMELINE).map((entry) => JSON.parse(JSON.stringify(entry)) as CapturedTimeline["entries"][number]);
  const decision = timeline.latestEligibleUndo(timeline.currentHeads());
  const operation = decision.operation ? { store: decision.operation.store, kind: decision.operation.kind, label: decision.operation.label.slice(0, MAX_STRING), seq: decision.operation.seq } : null;
  return { entries, eligibleUndo: decision.ok ? { ok: true, code: null, operation } : { ok: false, code: decision.code, operation } };
}

export class ViewSessionBridge {
  private readonly registrations = new Map<ViewEditor, ViewSessionRegistration>();

  /** Register a live editor session; the returned function retires it (a later registration for the same editor replaces it). */
  register(registration: ViewSessionRegistration): () => void {
    const editor = registration.identity.editor;
    this.registrations.set(editor, registration);
    return () => {
      if (this.registrations.get(editor) === registration) this.registrations.delete(editor);
    };
  }

  /** The editors currently registered and live. */
  surfaces(): ViewEditor[] {
    return [...this.registrations.entries()].filter(([, registration]) => registration.isCurrent()).map(([editor]) => editor).sort();
  }

  /** ONE bounded view-context snapshot, or null when no live surface exists. */
  capture(timeline?: ProjectOperationTimeline | null): CapturedViewContext | null {
    const editors: Partial<Record<ViewEditor, CapturedEditorView>> = {};
    const surfaces: ViewEditor[] = [];
    for (const [editor, registration] of this.registrations) {
      if (!registration.isCurrent()) continue;
      let state: unknown;
      try { state = boundedViewState(registration.state()); } catch { continue; }
      if (!state || typeof state !== "object" || Array.isArray(state)) state = {};
      surfaces.push(editor);
      editors[editor] = { editor, sessionId: registration.identity.sessionId, viewRevision: registration.viewRevision(), state: state as Record<string, unknown> };
    }
    if (surfaces.length === 0) return null;
    return { schema: VIEW_CONTEXT_SCHEMA, surfaces: surfaces.sort(), editors, timeline: captureTimeline(timeline) };
  }

  /** Execute a server-validated request on the named editor's own bus (exact parse, expiry, live surface, same session). */
  async execute(raw: unknown, now: number = Date.now()): Promise<ViewCommandExecution> {
    const request = parseViewCommandRequest(raw);
    if (!request) return { ok: false, status: "malformed", editor: null, commandId: null, code: null, message: "The view command request is malformed and was dropped." };
    const expiresAt = Date.parse(request.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt < now) return { ok: false, status: "expired", editor: request.editor, commandId: request.commandId, code: null, message: "The view command request expired before it reached the editor." };
    const registration = this.registrations.get(request.editor);
    if (!registration || !registration.isCurrent()) return { ok: false, status: "surface_unavailable", editor: request.editor, commandId: request.commandId, code: null, message: `The ${request.editor} editor is no longer open.` };
    if (registration.identity.sessionId !== request.sessionId) return { ok: false, status: "session_mismatch", editor: request.editor, commandId: request.commandId, code: null, message: `The ${request.editor} view session changed since the request was prepared.` };
    const envelope = createViewCommand({
      identity: registration.identity,
      commandId: request.commandId,
      payload: request.payload,
      actor: request.actor,
      expectedViewRevision: request.expectedViewRevision,
      invocationId: request.requestId,
      issuedAt: request.issuedAt,
      ttlMs: Math.max(1_000, expiresAt - Date.parse(request.issuedAt)),
    });
    const result = await registration.dispatch(envelope);
    if (result.status === "settled") return { ok: true, status: "settled", editor: request.editor, commandId: request.commandId, viewRevision: result.viewRevision, changed: result.changed, rebased: result.rebased };
    if (result.status === "refused") return { ok: false, status: "refused", editor: request.editor, commandId: request.commandId, code: result.refusal.code, message: result.refusal.message };
    return { ok: false, status: "cancelled", editor: request.editor, commandId: request.commandId, code: null, message: "The view command was cancelled." };
  }
}
