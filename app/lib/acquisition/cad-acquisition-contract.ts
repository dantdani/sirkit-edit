/**
 * [PR-M, 2026-10-18] Section M2 (runbook M.3/M.4, design M2.1): the BROWSER-SAFE contract of the schematic-scoped CAD acquisition - what
 * a page or the agent may ask, the durable task's public view, its stages (each with its own completion evidence, M.4), the closed
 * blocker codes (each keeps completed work and names its remedy) and the public progress event kinds (K.2 wording). No server import, no
 * environment read.
 *
 * The task works BEFORE any PCB exists: it needs a verified schematic snapshot, never a board. It mutates no design: it obtains real
 * KiCad bytes from an admitted CAD source, stores, parses and validates them, prepares a review package a HUMAN sends for review, and -
 * once two humans have published a revision - offers the replacement through the existing review dialog. Nothing here approves,
 * publishes, binds or applies anything.
 */

export const CAD_ACQUISITION_ROUTE = "/api/parts/acquisitions" as const;
export const CAD_ACQUISITION_TASK_SCHEMA = "sirkit.component-resolution-task.v1" as const;
export const CAD_ACQUISITION_START_TOOL_ID = "sirkit.parts.acquisition-start" as const;
export const CAD_ACQUISITION_STATUS_TOOL_ID = "sirkit.parts.acquisition-status" as const;
export const CAD_ACQUISITION_MAX_BYTES = 512 * 1024;
export const CAD_ACQUISITION_DEADLINE_MS = 15_000;
export const CAD_ACQUISITION_MAX_COMPONENTS = 8;

/** The task's states: the durable generation task's vocabulary (app/lib/generation-task/vocabulary.ts), reused. */
export const CAD_ACQUISITION_STATES = Object.freeze(["queued", "running", "waiting-for-resource", "awaiting-review", "cancel-requested", "cancelled", "succeeded", "failed", "stale"] as const);
export type CadAcquisitionState = (typeof CAD_ACQUISITION_STATES)[number];
export const CAD_ACQUISITION_TERMINAL_STATES: readonly CadAcquisitionState[] = Object.freeze(["cancelled", "succeeded", "failed", "stale"]);

/** M.4: distinct stages with distinct completion evidence. */
export const CAD_ACQUISITION_STAGES = Object.freeze(["local-search", "source-selection", "retrieve", "validate", "handoff", "awaiting-publication", "proposal", "applied", "preflight"] as const);
export type CadAcquisitionStage = (typeof CAD_ACQUISITION_STAGES)[number];
export type CadAcquisitionStageStatus = "pending" | "running" | "done" | "skipped" | "blocked";

export const CAD_ACQUISITION_BLOCKERS = Object.freeze(["source_credentials", "source_terms", "source_unavailable", "no_matching_asset", "mapping_conflict", "parser_refused", "licence_forbids_retention", "governance_unconfigured", "review_rejected", "review_withdrawn", "authority_revoked", "stale_base", "not_resolvable"] as const);
export type CadAcquisitionBlockerCode = (typeof CAD_ACQUISITION_BLOCKERS)[number];

/** Each blocker's sentence and remedy (completed work is kept; `draftOffered`: the unverified draft request is the next step). */
export const CAD_ACQUISITION_BLOCKER_TEXT: Readonly<Record<CadAcquisitionBlockerCode, { message: string; remedy: string; draftOffered: boolean }>> = Object.freeze({
  source_credentials: { message: "The admitted CAD source needs credentials this server does not have.", remedy: "An operator configures the source's credential (by its environment variable name); nothing is retried until then.", draftOffered: true },
  source_terms: { message: "The only CAD source that could serve this part is blocked pending the owner's terms decision.", remedy: "The owner decides the source's terms (the registry names the decision); until then use a part the pinned KiCad library carries, or file an unverified draft request.", draftOffered: true },
  source_unavailable: { message: "No admitted CAD source can serve this part on this server.", remedy: "An operator makes the pinned KiCad checkout available (pnpm ingest:kicad), or the part is drafted for review from a datasheet.", draftOffered: true },
  no_matching_asset: { message: "No admitted CAD source carries the symbol and footprint this part names.", remedy: "Choose another package or part, or file an unverified draft request with the datasheet's pin table.", draftOffered: true },
  mapping_conflict: { message: "The retrieved assets and the pin table disagree; nothing was guessed.", remedy: "Review the conflicts in the validation report; a person resolves them in an unverified draft request.", draftOffered: true },
  parser_refused: { message: "The retrieved assets were refused by the KiCad parser's limits or are unsupported.", remedy: "Nothing valid was stored; use another source or package, or file an unverified draft request.", draftOffered: true },
  licence_forbids_retention: { message: "The source's licence or retention class does not allow the bytes to be kept in a shared library.", remedy: "Only redistributable, indefinitely retained content is stored (OD-M2-7, OD-M2-11).", draftOffered: true },
  governance_unconfigured: { message: "No catalog governance project is configured, so nothing can be reviewed or published.", remedy: "The owner configures SIRKIT_ATOMIC_CATALOG_TENANT_ID and SIRKIT_ATOMIC_CATALOG_PROJECT_ID (OD-M2-1); the validated candidate is kept.", draftOffered: false },
  review_rejected: { message: "The reviewer rejected the publication request; nothing was published or bound.", remedy: "Read the reviewer's reason; fix the request and send it for review again, or choose another part.", draftOffered: true },
  review_withdrawn: { message: "The publication request was withdrawn or retired; nothing was published.", remedy: "Send the package for review again (a requester with a current membership).", draftOffered: false },
  authority_revoked: { message: "The person who started this task no longer has access to the project.", remedy: "A current member starts the task again; the stored candidate is reused.", draftOffered: false },
  stale_base: { message: "The schematic changed since the task captured it; the offered replacement no longer applies to the same instances.", remedy: "Start the task again on the current schematic; stored objects and published revisions are reused without a download.", draftOffered: false },
  not_resolvable: { message: "The published revision is not an eligible replacement for these instances.", remedy: "Read the candidate search's reasons; the instance may need another part or package.", draftOffered: true },
});

/** Public progress event kinds (K.2): each names a real step that happened, never narration. */
export const CAD_ACQUISITION_EVENT_KINDS = Object.freeze([
  "accepted", "worker_claimed", "local_search", "local_candidate_found", "source_selected", "source_skipped", "retrieved", "stored", "validated",
  "validation_failed", "awaiting_handoff", "handed_off", "awaiting_publication", "publication_checked", "published", "proposal_ready", "applied",
  "preflight", "waiting_resource", "blocked", "cancelled", "failed",
] as const);
export type CadAcquisitionEventKind = (typeof CAD_ACQUISITION_EVENT_KINDS)[number];
export interface CadAcquisitionEvent { seq: number; at: string; kind: CadAcquisitionEventKind; message: string; data?: Record<string, string | number | boolean | null> }

export const CAD_ASSET_REQUEST_KINDS = Object.freeze(["symbol", "footprint", "datasheet", "model"] as const);
export type CadAssetRequestKind = (typeof CAD_ASSET_REQUEST_KINDS)[number];

export interface CadAcquisitionRequirement { exactMpn?: string; manufacturer?: string; packageCode?: string; mounting?: "smd" | "through_hole" }
export interface CadAcquisitionRequest {
  /** stable instance ids (never reference designators) of catalog instances on the verified sheet */
  componentIds: string[];
  requirement: CadAcquisitionRequirement;
  assetKinds: CadAssetRequestKind[];
}

/** The control actions a person (or the agent's status read) may take. */
export const CAD_ACQUISITION_ACTIONS = Object.freeze(["cancel", "resume", "recheck", "handoff", "record-applied"] as const);
export type CadAcquisitionAction = (typeof CAD_ACQUISITION_ACTIONS)[number];

/** The public view of a task (what the status read, the route and the page show). */
export interface CadAcquisitionTaskView {
  schema: typeof CAD_ACQUISITION_TASK_SCHEMA;
  taskId: string;
  state: CadAcquisitionState;
  stage: CadAcquisitionStage;
  stages: Array<{ stage: CadAcquisitionStage; status: CadAcquisitionStageStatus; at: string | null; evidence: string | null }>;
  targets: Array<{ componentId: string; refDes: string; value: string; catalogPartId: string; symbol: string; footprint: string | null; exactMpn: string | null }>;
  requirement: CadAcquisitionRequirement;
  attempts: Array<{ sourceId: string; outcome: "used" | "skipped" | "failed" | "waiting"; code: string | null; detail: string; at: string }>;
  candidate: null | {
    candidateId: string;
    sourceId: string;
    verdict: "validated" | "conflicting" | "unsupported";
    identity: { kind: "exact" | "generic"; exactMpn: string | null; basis: string };
    reportDigest: string;
    objects: Array<{ role: string; sha256: string; byteLength: number; locator: string; ref: string | null; retrievedAt: string }>;
    unresolved: string[];
    conflicts: string[];
    licence: { id: string; spdx: string | null; attribution: string; link: string | null };
    fixtureEvidence: boolean;
  };
  handoff: null | { handoffId: string; at: string; by: string };
  publication: null | { status: "pending" | "approved" | "published" | "rejected" | "withdrawn" | "retired" | "not-submitted"; requestId: string | null; revisionId: string | null; checkedAt: string };
  proposal: null | { componentIds: string[]; candidatePartId: string; atomicPartRevisionId: string; exactMpn: string | null; footprint: string | null; origin: "own-part" | "search"; foundAt: string; reused: boolean };
  applied: null | { receiptId: string; schematicDigestAfter: string; at: string };
  preflight: null | { unresolvedCount: number; unresolvedRefDes: string[]; at: string; verifiedDigest: string };
  blocker: null | { code: CadAcquisitionBlockerCode; message: string; remedy: string; draftOffered: boolean; detail: string | null };
  nextAction: "wait" | "send-for-review" | "await-publication" | "offer-replacement" | "none";
  events: CadAcquisitionEvent[];
  createdAt: string;
  updatedAt: string;
}

// ── closed input ─────────────────────────────────────────────────────────────

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,199}$/;
const MPN = /^[!-~]([ -~]{0,62}[!-~])?$/;
const PACKAGE = /^[A-Za-z0-9][A-Za-z0-9 ._\-]{0,47}$/;
const TEXT = /^[\x20-\x7E]{1,120}$/;
/** Keys that could only ever claim authority or carry bytes; refused by name. */
export const CAD_ACQUISITION_AUTHORITY_KEYS: readonly string[] = Object.freeze(["actor", "actorId", "role", "capability", "authority", "approval", "approve", "publish", "bind", "apply", "commit", "scope", "headMark", "revision", "revisionId", "atomicPartRevisionId", "source", "sourceId", "sourceClass", "url", "path", "bytes", "content", "assets", "facts", "evidence", "verified", "eligible", "schematic", "board", "pins", "mapping", "licence", "license"]);

export type NormalizedCadAcquisitionRequest = { ok: true; request: CadAcquisitionRequest } | { ok: false; field: string; detail: string };

/** The closed request: unknown keys and authority-shaped keys refuse it by name. */
export function normalizeCadAcquisitionRequest(raw: unknown): NormalizedCadAcquisitionRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, field: "request", detail: "the request is an object {componentIds, requirement?, assetKinds?}" };
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (["componentIds", "requirement", "assetKinds"].includes(key)) continue;
    return { ok: false, field: key.slice(0, 40), detail: CAD_ACQUISITION_AUTHORITY_KEYS.includes(key) ? `"${key.slice(0, 40)}" is an authority-shaped claim: the server derives every source, byte, fact and revision` : `unexpected key "${key.slice(0, 40)}"` };
  }
  const ids = record.componentIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > CAD_ACQUISITION_MAX_COMPONENTS || ids.some((id) => typeof id !== "string" || !ID.test(id))) return { ok: false, field: "componentIds", detail: `componentIds lists 1-${CAD_ACQUISITION_MAX_COMPONENTS} stable instance ids` };
  if (new Set(ids).size !== ids.length) return { ok: false, field: "componentIds", detail: "componentIds names an instance twice" };
  const requirement: CadAcquisitionRequirement = {};
  const rawRequirement = record.requirement ?? {};
  if (typeof rawRequirement !== "object" || rawRequirement === null || Array.isArray(rawRequirement)) return { ok: false, field: "requirement", detail: "requirement is an object" };
  for (const [key, value] of Object.entries(rawRequirement as Record<string, unknown>)) {
    if (key === "exactMpn" && typeof value === "string" && MPN.test(value)) requirement.exactMpn = value;
    else if (key === "manufacturer" && typeof value === "string" && TEXT.test(value)) requirement.manufacturer = value;
    else if (key === "packageCode" && typeof value === "string" && PACKAGE.test(value)) requirement.packageCode = value;
    else if (key === "mounting" && (value === "smd" || value === "through_hole")) requirement.mounting = value;
    else return { ok: false, field: `requirement.${key.slice(0, 40)}`, detail: CAD_ACQUISITION_AUTHORITY_KEYS.includes(key) ? `"${key.slice(0, 40)}" is an authority-shaped claim` : `requirement.${key.slice(0, 40)} is not one of exactMpn, manufacturer, packageCode, mounting (or its value is malformed)` };
  }
  const kinds = record.assetKinds ?? ["symbol", "footprint", "datasheet"];
  if (!Array.isArray(kinds) || kinds.length === 0 || kinds.length > 4 || kinds.some((kind) => !(CAD_ASSET_REQUEST_KINDS as readonly unknown[]).includes(kind)) || new Set(kinds).size !== kinds.length) return { ok: false, field: "assetKinds", detail: "assetKinds is a set of symbol, footprint, datasheet, model" };
  if (!kinds.includes("symbol")) return { ok: false, field: "assetKinds", detail: "a part is acquired with its symbol" };
  return { ok: true, request: { componentIds: [...ids].sort() as string[], requirement, assetKinds: [...kinds].sort() as CadAssetRequestKind[] } };
}

/** The run log's sentence for an event (the K.2 public wording). */
export function cadAcquisitionProgressLine(event: CadAcquisitionEvent): string {
  return event.message;
}
