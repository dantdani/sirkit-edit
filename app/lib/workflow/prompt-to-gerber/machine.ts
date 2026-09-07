/**
 * B16.1C §C — pure transition function and durable-truth reconstruction for
 * the prompt-to-Gerber workflow. No I/O; the orchestrator and the UI hold
 * the snapshot and feed events. See `types.ts` for the contract.
 */

import { PROMPT_TO_GERBER_STATES, type PromptToGerberEvent, type PromptToGerberSnapshot, type PromptToGerberState, type TransitionResult, type WorkflowIdentity, type WorkflowScope } from "./types";

export const EMPTY_IDENTITY: WorkflowIdentity = Object.freeze({
  schematicBaseDigest: null, snapshotRevision: null, schematicRevision: null, planId: null, planDigest: null,
  boardRevision: null, boardDigest: null, authorityRevision: null, authorityDigest: null, componentAuthorityDigest: null,
  releaseId: null, archiveSha256: null, releaseFilename: null,
});

export function initialSnapshot(scope: WorkflowScope): PromptToGerberSnapshot {
  return { state: "idle", scope: { ...scope }, identity: { ...EMPTY_IDENTITY }, pendingOperationKey: null, pendingReview: null, lastError: null, history: [] };
}

/** States in which a durable/irreversible operation is in flight — every button for the same operation is disabled here. */
export const PENDING_STATES: ReadonlySet<PromptToGerberState> = new Set(["hydrating_project", "proposing_schematic", "applying_schematic", "resolving_component_authority", "syncing_pcb", "proposing_pcb", "applying_pcb", "qualifying", "releasing"]);
/** States that wait for an explicit human decision. */
export const REVIEW_STATES: ReadonlySet<PromptToGerberState> = new Set(["awaiting_schematic_review", "awaiting_pcb_review", "awaiting_release_authorization"]);
/** States from which RETRY is legal (explicit, idempotent). */
export const RETRYABLE_STATES: ReadonlySet<PromptToGerberState> = new Set(["qualification_failed", "release_failed"]);

/** The legal (state, event) table. Anything absent is refused — never coerced. */
const LEGAL: Record<PromptToGerberState, ReadonlyArray<PromptToGerberEvent["type"]>> = {
  idle: ["HYDRATE_STARTED", "PROPOSE_SCHEMATIC", "RESOLVE_COMPONENT_AUTHORITY", "RESET"],
  hydrating_project: ["HYDRATED", "RESET"],
  proposing_schematic: ["SCHEMATIC_PROPOSAL_READY", "SCHEMATIC_PROPOSAL_FAILED", "RESET"],
  awaiting_schematic_review: ["APPROVE_SCHEMATIC", "REJECT_SCHEMATIC", "RESET"],
  applying_schematic: ["SCHEMATIC_APPLIED", "SCHEMATIC_APPLY_FAILED", "RESET"],
  resolving_component_authority: ["COMPONENT_AUTHORITY_RESOLVED", "COMPONENT_AUTHORITY_FAILED", "RESET"],
  syncing_pcb: ["SNAPSHOT_PUBLISHED", "PCB_PROPOSAL_FAILED", "RESET"],
  proposing_pcb: ["PCB_PLAN_READY", "PCB_PROPOSAL_FAILED", "RESET"],
  awaiting_pcb_review: ["APPROVE_PCB", "REJECT_PCB", "RESET"],
  applying_pcb: ["PCB_APPLIED", "PCB_APPLY_FAILED", "RESET"],
  awaiting_qualification: ["QUALIFY", "PROPOSE_SCHEMATIC", "RESOLVE_COMPONENT_AUTHORITY", "AUTHORITY_INVALIDATED", "RESET"],
  qualifying: ["QUALIFIED", "QUALIFICATION_FAILED", "RESET"],
  qualification_failed: ["RETRY", "QUALIFY", "PROPOSE_SCHEMATIC", "RESOLVE_COMPONENT_AUTHORITY", "RESET"],
  qualified: ["REQUEST_RELEASE", "QUALIFY", "PROPOSE_SCHEMATIC", "RESOLVE_COMPONENT_AUTHORITY", "AUTHORITY_INVALIDATED", "RESET"],
  awaiting_release_authorization: ["AUTHORIZE_RELEASE", "CANCEL_RELEASE", "AUTHORITY_INVALIDATED", "RESET"],
  releasing: ["RELEASED", "RELEASE_FAILED", "RESET"],
  release_failed: ["RETRY", "REQUEST_RELEASE", "QUALIFY", "AUTHORITY_INVALIDATED", "RESET"],
  released: ["REQUEST_RELEASE", "QUALIFY", "PROPOSE_SCHEMATIC", "RESOLVE_COMPONENT_AUTHORITY", "AUTHORITY_INVALIDATED", "RESET"],
};

function refuse(snapshot: PromptToGerberSnapshot, event: PromptToGerberEvent, reason: string): TransitionResult {
  return { snapshot, accepted: false, refused: { event: event.type, state: snapshot.state, reason } };
}

interface SnapshotPatch {
  identity?: Partial<WorkflowIdentity>;
  pendingOperationKey?: PromptToGerberSnapshot["pendingOperationKey"];
  pendingReview?: PromptToGerberSnapshot["pendingReview"];
  lastError?: PromptToGerberSnapshot["lastError"];
}

function move(snapshot: PromptToGerberSnapshot, event: PromptToGerberEvent, to: PromptToGerberState, patch: SnapshotPatch, note: string, at: string): TransitionResult {
  const next: PromptToGerberSnapshot = {
    ...snapshot,
    ...patch,
    identity: { ...snapshot.identity, ...(patch.identity ?? {}) },
    state: to,
    history: [...snapshot.history, { at, event: event.type, from: snapshot.state, to, note }].slice(-200),
  };
  return { snapshot: next, accepted: true };
}

/**
 * Pure transition. `at` is the caller's clock (kept out of the function so
 * replays are byte-stable). Refused events return the unchanged snapshot.
 */
export function transition(snapshot: PromptToGerberSnapshot, event: PromptToGerberEvent, at: string): TransitionResult {
  if (!PROMPT_TO_GERBER_STATES.includes(snapshot.state)) return refuse(snapshot, event, `unknown state ${String(snapshot.state)}`);
  if (!LEGAL[snapshot.state].includes(event.type)) return refuse(snapshot, event, `${event.type} is not legal in ${snapshot.state}`);
  const s = snapshot;
  switch (event.type) {
    case "RESET": return move(s, event, "idle", { identity: { ...EMPTY_IDENTITY }, pendingOperationKey: null, pendingReview: null, lastError: null }, "workflow reset", at);
    case "HYDRATE_STARTED": return move(s, event, "hydrating_project", { pendingOperationKey: null, pendingReview: null, lastError: null }, "reading durable truth", at);
    case "HYDRATED": {
      const f = event.facts;
      const identity: Partial<WorkflowIdentity> = { schematicBaseDigest: f.schematicBaseDigest ?? null, snapshotRevision: f.snapshotRevision ?? null, schematicRevision: f.schematicRevision ?? null, boardRevision: f.boardRevision ?? null, boardDigest: f.boardDigest ?? null, authorityRevision: f.authorityCurrent ? f.authorityRevision ?? null : null, authorityDigest: f.authorityCurrent ? f.authorityDigest ?? null : null, componentAuthorityDigest: f.authorityCurrent ? f.componentAuthorityDigest ?? null : null, releaseId: f.releaseCurrent ? f.releaseId ?? null : null, archiveSha256: f.releaseCurrent ? f.archiveSha256 ?? null : null, releaseFilename: f.releaseCurrent ? f.releaseFilename ?? null : null, planId: null, planDigest: null };
      const to: PromptToGerberState = f.releaseCurrent && f.authorityCurrent ? "released" : f.authorityCurrent ? "qualified" : f.boardFound ? "awaiting_qualification" : "idle";
      const note = to === "released" ? `release ${f.releaseId ?? "?"} current for board ${f.boardRevision ?? "?"}` : to === "qualified" ? `authority r${f.authorityRevision ?? "?"} current for board ${f.boardRevision ?? "?"}` : to === "awaiting_qualification" ? `durable board ${f.boardRevision ?? "?"} without current authority` : f.hasSchematic ? "schematic present, no durable board" : "empty project";
      return move(s, event, to, { identity, pendingOperationKey: null, pendingReview: null }, note, at);
    }
    case "PROPOSE_SCHEMATIC": return move(s, event, "proposing_schematic", { pendingOperationKey: event.operationKey, pendingReview: null, lastError: null, identity: { schematicBaseDigest: event.baseDigest } }, `proposal pinned to schematic base ${event.baseDigest.slice(0, 16)}`, at);
    case "SCHEMATIC_PROPOSAL_READY": return move(s, event, "awaiting_schematic_review", { pendingOperationKey: null, pendingReview: { kind: "schematic", summary: event.summary, digest: event.digest } }, `proposal ${event.digest.slice(0, 16)} awaits human review`, at);
    case "SCHEMATIC_PROPOSAL_FAILED": return move(s, event, "idle", { pendingOperationKey: null, pendingReview: null, lastError: event.error }, `proposal failed: ${event.error.code}`, at);
    case "APPROVE_SCHEMATIC": {
      if (!s.pendingReview || s.pendingReview.kind !== "schematic") return refuse(s, event, "no schematic proposal is awaiting review");
      return move(s, event, "applying_schematic", { pendingOperationKey: event.operationKey }, `human approved schematic proposal ${s.pendingReview.digest.slice(0, 16)}`, at);
    }
    case "REJECT_SCHEMATIC": return move(s, event, "idle", { pendingOperationKey: null, pendingReview: null }, "human rejected the schematic proposal (nothing changed)", at);
    case "SCHEMATIC_APPLIED": return move(s, event, "idle", { pendingOperationKey: null, pendingReview: null, identity: { schematicBaseDigest: event.schematicBaseDigest, planId: null, planDigest: null } }, `canonical schematic mutated → ${event.schematicBaseDigest.slice(0, 16)}`, at);
    case "SCHEMATIC_APPLY_FAILED": return move(s, event, "awaiting_schematic_review", { pendingOperationKey: null, lastError: event.error }, `apply refused: ${event.error.code} (proposal kept for review)`, at);
    case "RESOLVE_COMPONENT_AUTHORITY": return move(s, event, "resolving_component_authority", { pendingOperationKey: event.operationKey, lastError: null }, "binding instances to published atomic revisions", at);
    case "COMPONENT_AUTHORITY_RESOLVED": return move(s, event, "syncing_pcb", { pendingOperationKey: null }, `${event.boundInstances} instance(s) bound (server-owned records)`, at);
    case "COMPONENT_AUTHORITY_FAILED": return move(s, event, "idle", { pendingOperationKey: null, lastError: event.error }, `component authority refused: ${event.error.code}`, at);
    case "SYNC_STARTED": return refuse(s, event, "SYNC_STARTED is implied by COMPONENT_AUTHORITY_RESOLVED");
    case "SNAPSHOT_PUBLISHED": return move(s, event, "proposing_pcb", { identity: { snapshotRevision: event.snapshotRevision, schematicRevision: event.schematicRevision } }, `snapshot r${event.snapshotRevision} (${event.schematicRevision}) published; preparing durable plan`, at);
    case "PCB_PLAN_READY": return move(s, event, "awaiting_pcb_review", { pendingOperationKey: null, pendingReview: { kind: "pcb", summary: event.summary, planId: event.planId, planDigest: event.planDigest }, identity: { planId: event.planId, planDigest: event.planDigest } }, `plan ${event.planId.slice(0, 16)} awaits human review`, at);
    case "PCB_PROPOSAL_FAILED": return move(s, event, s.identity.boardRevision ? "awaiting_qualification" : "idle", { pendingOperationKey: null, pendingReview: null, lastError: event.error, identity: { planId: null, planDigest: null } }, `PCB proposal refused: ${event.error.code}`, at);
    case "APPROVE_PCB": {
      if (!s.pendingReview || s.pendingReview.kind !== "pcb") return refuse(s, event, "no PCB plan is awaiting review");
      if (s.pendingReview.planId !== event.planId || s.pendingReview.planDigest !== event.planDigest) return refuse(s, event, "approval names a different plan than the one under review");
      return move(s, event, "applying_pcb", { pendingOperationKey: event.operationKey }, `human approved exact plan ${event.planId.slice(0, 16)}/${event.planDigest.slice(0, 12)}`, at);
    }
    case "REJECT_PCB": return move(s, event, s.identity.boardRevision ? "awaiting_qualification" : "idle", { pendingOperationKey: null, pendingReview: null, identity: { planId: null, planDigest: null } }, "human rejected the PCB plan (nothing changed)", at);
    case "PCB_APPLIED": return move(s, event, "awaiting_qualification", { pendingOperationKey: null, pendingReview: null, identity: { boardRevision: event.boardRevision, boardDigest: event.boardDigest, planId: null, planDigest: null, authorityRevision: null, authorityDigest: null, componentAuthorityDigest: null, releaseId: null, archiveSha256: null, releaseFilename: null } }, `durable board → ${event.boardRevision.slice(0, 18)} (authority/release no longer current)`, at);
    case "PCB_APPLY_FAILED": return move(s, event, "awaiting_pcb_review", { pendingOperationKey: null, lastError: event.error }, `apply refused: ${event.error.code} (plan kept for review)`, at);
    case "QUALIFY": {
      if (s.identity.boardRevision && s.identity.boardRevision !== event.boardRevision) return refuse(s, event, "qualification names a board revision other than the current durable board");
      return move(s, event, "qualifying", { pendingOperationKey: event.operationKey, lastError: null, pendingReview: null }, `qualifying durable board ${event.boardRevision.slice(0, 18)}`, at);
    }
    case "QUALIFIED": return move(s, event, "qualified", { pendingOperationKey: null, identity: { boardRevision: event.boardRevision, boardDigest: event.boardDigest, authorityRevision: event.authorityRevision, authorityDigest: event.authorityDigest, componentAuthorityDigest: event.componentAuthorityDigest, releaseId: null, archiveSha256: null, releaseFilename: null } }, `authority r${event.authorityRevision} sealed for board ${event.boardRevision.slice(0, 18)}`, at);
    case "QUALIFICATION_FAILED": return move(s, event, "qualification_failed", { pendingOperationKey: null, lastError: event.error }, `qualification failed: ${event.error.code}`, at);
    case "REQUEST_RELEASE": {
      if (!s.identity.authorityRevision || !s.identity.authorityDigest) return refuse(s, event, "no current qualification authority");
      return move(s, event, "awaiting_release_authorization", { pendingReview: { kind: "release", summary: event.summary, authorityRevision: s.identity.authorityRevision, authorityDigest: s.identity.authorityDigest }, lastError: null }, `administrator confirmation requested for authority r${s.identity.authorityRevision}`, at);
    }
    case "AUTHORIZE_RELEASE": {
      if (!s.pendingReview || s.pendingReview.kind !== "release") return refuse(s, event, "no release is awaiting authorization");
      if (s.pendingReview.authorityRevision !== event.authorityRevision || s.pendingReview.authorityDigest !== event.authorityDigest) return refuse(s, event, "authorization names a different authority than the one presented");
      return move(s, event, "releasing", { pendingOperationKey: event.operationKey }, `administrator authorized release of authority r${event.authorityRevision}`, at);
    }
    case "CANCEL_RELEASE": return move(s, event, "qualified", { pendingReview: null }, "administrator cancelled the release (nothing changed)", at);
    case "RELEASED": return move(s, event, "released", { pendingOperationKey: null, pendingReview: null, identity: { releaseId: event.releaseId, archiveSha256: event.archiveSha256, releaseFilename: event.filename, authorityRevision: event.authorityRevision, authorityDigest: event.authorityDigest } }, `release ${event.releaseId.slice(-12)} (${event.archiveSha256.slice(0, 12)}) from authority r${event.authorityRevision}`, at);
    case "RELEASE_FAILED": return move(s, event, "release_failed", { pendingOperationKey: null, lastError: event.error }, `release failed: ${event.error.code}`, at);
    case "AUTHORITY_INVALIDATED": return move(s, event, "awaiting_qualification", { pendingOperationKey: null, pendingReview: null, identity: { boardRevision: event.boardRevision ?? s.identity.boardRevision, authorityRevision: null, authorityDigest: null, componentAuthorityDigest: null, releaseId: null, archiveSha256: null, releaseFilename: null } }, `authority invalidated: ${event.reason}`, at);
    case "RETRY": {
      if (s.state === "qualification_failed") return move(s, event, "awaiting_qualification", { lastError: null }, "explicit retry: re-qualification allowed with the same idempotent step key", at);
      if (s.state === "release_failed") return move(s, event, "qualified", { lastError: null }, "explicit retry: release may be re-requested (authorization is asked again)", at);
      return refuse(s, event, "nothing to retry");
    }
    default: return refuse(s, event, "unhandled event");
  }
}

/** What the server told a fresh browser (GET /api/pcb-sync?boardId=…&include=manufacturing). */
export interface DurableWorkflowTruth {
  boardFound: boolean;
  boardRevision: string | null;
  boardDigest: string | null;
  snapshot: null | { revision: number; schematicRevision: string };
  authority: null | { revision: number; recordDigest: string; boardRevision: string; componentAuthorityDigest: string; current: boolean };
  latestRelease: null | { releaseId: string; archiveSha256: string; filename: string; authorityRevision: number; current: boolean };
}

/** Reconstruct truthful progress from durable records + the local canonical schematic presence. */
export function reconstruct(scope: WorkflowScope, truth: DurableWorkflowTruth, local: { hasSchematic: boolean; schematicBaseDigest: string | null }, at: string): PromptToGerberSnapshot {
  const started = transition(initialSnapshot(scope), { type: "HYDRATE_STARTED" }, at).snapshot;
  const authorityCurrent = Boolean(truth.authority?.current && truth.boardFound && truth.authority.boardRevision === truth.boardRevision);
  const releaseCurrent = Boolean(authorityCurrent && truth.latestRelease?.current && truth.latestRelease.authorityRevision === truth.authority?.revision);
  return transition(started, { type: "HYDRATED", facts: {
    hasSchematic: local.hasSchematic, boardFound: truth.boardFound, authorityCurrent, releaseCurrent,
    schematicBaseDigest: local.schematicBaseDigest, snapshotRevision: truth.snapshot?.revision ?? null, schematicRevision: truth.snapshot?.schematicRevision ?? null,
    boardRevision: truth.boardRevision, boardDigest: truth.boardDigest,
    authorityRevision: truth.authority?.revision ?? null, authorityDigest: truth.authority?.recordDigest ?? null, componentAuthorityDigest: truth.authority?.componentAuthorityDigest ?? null,
    releaseId: truth.latestRelease?.releaseId ?? null, archiveSha256: truth.latestRelease?.archiveSha256 ?? null, releaseFilename: truth.latestRelease?.filename ?? null,
  } }, at).snapshot;
}

/** Deterministic idempotent step keys: the same durable input always yields the same key, so a retry replays instead of repeating. */
export function stepKey(step: "propose" | "apply-schematic" | "bind" | "publish" | "preflight" | "apply-pcb" | "qualify" | "release", scope: WorkflowScope, facts: Record<string, string | number | null>): string {
  const facet = Object.entries(facts).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v ?? ""}`).join("&");
  return `p2g:${step}:${scope.tenantId}/${scope.projectId}/${scope.branchId}/${scope.boardId}:${facet}`;
}

/** Which UI action is enabled in a state (everything else is disabled — including the same operation while pending). */
export function enabledActions(snapshot: PromptToGerberSnapshot): { propose: boolean; approveSchematic: boolean; resolveAuthorityAndSync: boolean; approvePcb: boolean; qualify: boolean; requestRelease: boolean; authorizeRelease: boolean; retry: boolean } {
  const s = snapshot.state;
  return {
    propose: s === "idle" || s === "awaiting_qualification" || s === "qualified" || s === "released" || s === "qualification_failed",
    approveSchematic: s === "awaiting_schematic_review",
    resolveAuthorityAndSync: (s === "idle" || s === "awaiting_qualification" || s === "qualified" || s === "released" || s === "qualification_failed") && Boolean(snapshot.identity.schematicBaseDigest),
    approvePcb: s === "awaiting_pcb_review",
    qualify: (s === "awaiting_qualification" || s === "qualification_failed" || s === "qualified" || s === "released") && Boolean(snapshot.identity.boardRevision),
    requestRelease: (s === "qualified" || s === "released" || s === "release_failed") && Boolean(snapshot.identity.authorityRevision),
    authorizeRelease: s === "awaiting_release_authorization",
    retry: RETRYABLE_STATES.has(s),
  };
}
