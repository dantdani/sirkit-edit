/**
 * [B17-B] The VIEW-SESSION command contract — `sirkit.view-command.v1`.
 *
 * A view command changes what a browser/editor session SHOWS (camera,
 * visibility, selection, focus, zoom, tabs, layer visibility, 3D toggles).
 * It is never engineering authority: no view command can change a
 * schematic, a board, a binding, a plan or a release, and none creates an
 * engineering undo entry. The bus is provider-neutral (the UI, keyboard
 * shortcuts and agent tools all issue the same envelope) and
 * non-authoritative (the resulting view state is reported, never persisted
 * beyond explicit workspace preferences).
 */
import type { ProjectRole } from "../engineering/types";

export const VIEW_COMMAND_SCHEMA = "sirkit.view-command.v1" as const;
export const VIEW_TRACE_SCHEMA = "sirkit.view-command-trace.v1" as const;

/** [B17-D] `workspace` is the tab-level session (open editor/tab); the three editors own their canvases. */
export const VIEW_EDITORS = ["schematic", "pcb", "pcb3d", "workspace"] as const;
export type ViewEditor = (typeof VIEW_EDITORS)[number];

/** The actor as the trusted boundary knows it — a LABEL for tracing and role gates, never an authority claim. */
export interface TrustedViewActor {
  actorId: string;
  role: ProjectRole;
  actorKind: "human" | "agent";
}

export interface ViewSessionIdentity {
  sessionId: string;
  projectId: string;
  branchId: string;
  editor: ViewEditor;
}

export interface ViewCommandEnvelope {
  schemaVersion: typeof VIEW_COMMAND_SCHEMA;
  commandId: string;
  invocationId: string;
  sessionId: string;
  projectId: string;
  branchId: string;
  editor: ViewEditor;
  /** The view revision the issuer observed; stale revisions REFUSE or REBASE per the command's rule. */
  expectedViewRevision: number;
  actor: TrustedViewActor;
  payload: unknown;
  issuedAt: string;
  expiresAt: string;
}

export const VIEW_REFUSAL_CODES = [
  "VS_SCHEMA_UNSUPPORTED",
  "VS_ENVELOPE_INVALID",
  "VS_SESSION_MISMATCH",
  "VS_PROJECT_MISMATCH",
  "VS_EDITOR_MISMATCH",
  "VS_SESSION_RETIRED",
  "VS_COMMAND_UNKNOWN",
  "VS_EXPIRED",
  "VS_STALE_REVISION",
  "VS_PAYLOAD_INVALID",
  "VS_ROLE_FORBIDDEN",
  "VS_UNAVAILABLE",
  "VS_HANDLER_FAILED",
] as const;
export type ViewRefusalCode = (typeof VIEW_REFUSAL_CODES)[number];

export interface ViewRefusal {
  code: ViewRefusalCode;
  message: string;
}

/**
 * Deterministic stale-revision rule (documented, per command):
 *  - `rebase`  — the command is idempotent with respect to the view it did not observe
 *                (fit, zoom-to, focus, toggle-to-a-value, camera preset, open/close):
 *                it is applied on the CURRENT revision and the result says `rebased: true`;
 *  - `refuse`  — the command's meaning depends on what the issuer saw (relative zoom/pan,
 *                "add to selection", "toggle" without a target value): a stale revision is
 *                refused with VS_STALE_REVISION and the current revision, so the issuer re-reads.
 */
export type ViewStalenessRule = "rebase" | "refuse";

export type ViewCommandOutcome<State> =
  | { ok: true; state: State }
  | { ok: false; refusal: ViewRefusal };

export interface ViewCommandContext<State> {
  /** Aborted when the invocation is cancelled or the session retires. */
  signal: AbortSignal;
  /** The state the command is applied to (current, after any rebase). */
  state: State;
  actor: TrustedViewActor;
  identity: ViewSessionIdentity;
  /** The revision the issuer observed and the current one. */
  expectedViewRevision: number;
  viewRevision: number;
  /** [B17-D] true when a `rebase` command is being applied on a revision the issuer did not observe — a
   *  selection-relative target ("this component", "the selection") must then REFUSE instead of guessing. */
  rebased: boolean;
}

export interface ViewCommandDescriptor<State, Payload = unknown> {
  commandId: string;
  editor: ViewEditor;
  title: string;
  staleness: ViewStalenessRule;
  /** Roles allowed to issue it (view commands are readable-by-all by default). */
  roles?: readonly ProjectRole[];
  /** ONLY commands that edit an explicit workspace preference persist anything; the projection names the preference keys. */
  persist?: { scope: "workspace-preference"; keys: readonly string[]; project(state: State): Record<string, unknown> };
  /** Exact payload validation; anything else is VS_PAYLOAD_INVALID. */
  validate(payload: unknown): { ok: true; value: Payload } | { ok: false; message: string };
  /** Pure state transition (may be async for geometry look-ups); never touches engineering state. */
  apply(payload: Payload, context: ViewCommandContext<State>): ViewCommandOutcome<State> | Promise<ViewCommandOutcome<State>>;
}

export type ViewCommandResult<State> =
  | { status: "settled"; invocationId: string; commandId: string; viewRevision: number; rebased: boolean; changed: boolean; state: State }
  | { status: "refused"; invocationId: string; commandId: string; viewRevision: number; refusal: ViewRefusal }
  | { status: "cancelled"; invocationId: string; commandId: string; viewRevision: number };

export type ViewSessionRetirementReason = "project-switch" | "logout" | "tab-disposed" | "editor-closed";

/** A trace record: command evidence WITHOUT private project content (ids and digests only). */
export interface ViewCommandTrace {
  schemaVersion: typeof VIEW_TRACE_SCHEMA;
  invocationId: string;
  commandId: string;
  sessionId: string;
  projectId: string;
  branchId: string;
  editor: ViewEditor;
  actorKind: TrustedViewActor["actorKind"];
  role: ProjectRole;
  expectedViewRevision: number;
  resultingViewRevision: number;
  status: ViewCommandResult<unknown>["status"];
  refusalCode: ViewRefusalCode | null;
  rebased: boolean;
  /** sha256 of the canonical payload — evidence of WHAT was asked without the content. */
  payloadDigest: string;
  /** top-level payload keys (structure only). */
  payloadKeys: string[];
  issuedAt: string;
  settledAt: string;
}
