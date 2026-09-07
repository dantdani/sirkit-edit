/**
 * B16.1C §C — the ONE explicit prompt-to-Gerber workflow state machine.
 *
 * The machine COORDINATES the existing authorities — the canonical schematic
 * session (proposal review + apply), the physical-binding route (component
 * authority), the durable PCB synchronization plan (preflight/apply), the
 * server-owned qualification authority, and the ledgered release — it never
 * replaces them. Every transition carries the project/branch/revision/
 * authority identity it acted on, so a reload can reconstruct truthful
 * progress from durable records and a retry can never repeat a committed
 * mutation (each step keys its durable operation idempotently).
 *
 * There is NO hidden auto-approval: `awaiting_schematic_review` and
 * `awaiting_pcb_review` only leave through an explicit human approval event,
 * and `awaiting_release_authorization` only through a separate administrator
 * confirmation. There is no silent legacy fallback: an event that is not
 * legal in the current state is refused (`transition` returns the same state
 * with a `refused` reason) instead of being coerced.
 */

export const PROMPT_TO_GERBER_STATES = [
  "idle",
  "hydrating_project",
  "proposing_schematic",
  "awaiting_schematic_review",
  "applying_schematic",
  "resolving_component_authority",
  "syncing_pcb",
  "proposing_pcb",
  "awaiting_pcb_review",
  "applying_pcb",
  "awaiting_qualification",
  "qualifying",
  "qualification_failed",
  "qualified",
  "awaiting_release_authorization",
  "releasing",
  "release_failed",
  "released",
] as const;
export type PromptToGerberState = (typeof PROMPT_TO_GERBER_STATES)[number];

/** Identity every transition and every durable record is scoped by. */
export interface WorkflowScope {
  tenantId: string;
  projectId: string;
  branchId: string;
  designId: string;
  boardId: string;
}

/** The durable facts the machine has verified so far (all server-derived). */
export interface WorkflowIdentity {
  /** Local canonical schematic digest the proposal/apply was pinned to. */
  schematicBaseDigest: string | null;
  /** Durable snapshot head the browser must publish against (server-owned integer revision). */
  snapshotRevision: number | null;
  /** Durable schematic identity (`schematic:<token>`) the PCB plan targets / the board was applied from. */
  schematicRevision: string | null;
  /** Prepared durable PCB plan (inert until an explicit apply). */
  planId: string | null;
  planDigest: string | null;
  /** Authoritative board revision/digest (the durable head). */
  boardRevision: string | null;
  boardDigest: string | null;
  /** Sealed qualification authority head (durable aggregate revision + record digest). */
  authorityRevision: number | null;
  authorityDigest: string | null;
  componentAuthorityDigest: string | null;
  /** Ledgered release identity. */
  releaseId: string | null;
  archiveSha256: string | null;
  releaseFilename: string | null;
}

export interface WorkflowError { code: string; message: string; correlationId?: string; retryable: boolean }

export interface PromptToGerberSnapshot {
  state: PromptToGerberState;
  scope: WorkflowScope;
  identity: WorkflowIdentity;
  /** Idempotency key of the in-flight durable operation (retry reuses it; a second click is refused). */
  pendingOperationKey: string | null;
  /** The pending human decision the UI must render (what will change). */
  pendingReview: null | { kind: "schematic"; summary: string; digest: string } | { kind: "pcb"; summary: string; planId: string; planDigest: string } | { kind: "release"; summary: string; authorityRevision: number; authorityDigest: string };
  lastError: WorkflowError | null;
  /** Human-readable audit of every accepted transition (event, from, to, identity facts). */
  history: Array<{ at: string; event: PromptToGerberEvent["type"]; from: PromptToGerberState; to: PromptToGerberState; note: string }>;
}

export type PromptToGerberEvent =
  | { type: "HYDRATE_STARTED" }
  | { type: "HYDRATED"; facts: Partial<WorkflowIdentity> & { hasSchematic: boolean; boardFound: boolean; authorityCurrent: boolean; releaseCurrent: boolean } }
  | { type: "PROPOSE_SCHEMATIC"; operationKey: string; baseDigest: string }
  | { type: "SCHEMATIC_PROPOSAL_READY"; summary: string; digest: string }
  | { type: "SCHEMATIC_PROPOSAL_FAILED"; error: WorkflowError }
  | { type: "APPROVE_SCHEMATIC"; operationKey: string }
  | { type: "REJECT_SCHEMATIC" }
  | { type: "SCHEMATIC_APPLIED"; schematicBaseDigest: string }
  | { type: "SCHEMATIC_APPLY_FAILED"; error: WorkflowError }
  | { type: "RESOLVE_COMPONENT_AUTHORITY"; operationKey: string }
  | { type: "COMPONENT_AUTHORITY_RESOLVED"; boundInstances: number }
  | { type: "COMPONENT_AUTHORITY_FAILED"; error: WorkflowError }
  | { type: "SYNC_STARTED"; operationKey: string; snapshotRevision: number }
  | { type: "SNAPSHOT_PUBLISHED"; snapshotRevision: number; schematicRevision: string }
  | { type: "PCB_PLAN_READY"; planId: string; planDigest: string; summary: string }
  | { type: "PCB_PROPOSAL_FAILED"; error: WorkflowError }
  | { type: "APPROVE_PCB"; operationKey: string; planId: string; planDigest: string }
  | { type: "REJECT_PCB" }
  | { type: "PCB_APPLIED"; boardRevision: string; boardDigest: string }
  | { type: "PCB_APPLY_FAILED"; error: WorkflowError }
  | { type: "QUALIFY"; operationKey: string; boardRevision: string }
  | { type: "QUALIFIED"; boardRevision: string; boardDigest: string; authorityRevision: number; authorityDigest: string; componentAuthorityDigest: string }
  | { type: "QUALIFICATION_FAILED"; error: WorkflowError }
  | { type: "REQUEST_RELEASE"; summary: string }
  | { type: "AUTHORIZE_RELEASE"; operationKey: string; authorityRevision: number; authorityDigest: string }
  | { type: "CANCEL_RELEASE" }
  | { type: "RELEASED"; releaseId: string; archiveSha256: string; filename: string; authorityRevision: number; authorityDigest: string }
  | { type: "RELEASE_FAILED"; error: WorkflowError }
  | { type: "AUTHORITY_INVALIDATED"; reason: string; boardRevision: string | null }
  | { type: "RETRY" }
  | { type: "RESET" };

export interface TransitionResult {
  snapshot: PromptToGerberSnapshot;
  accepted: boolean;
  /** Present when the event was refused in the current state (no silent coercion). */
  refused?: { event: PromptToGerberEvent["type"]; state: PromptToGerberState; reason: string };
}
