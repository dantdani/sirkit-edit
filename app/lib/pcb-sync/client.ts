import type { EngineeringActor } from "../engineering/types";
import { makeBoardRecord } from "./board";
import {
  PCB_SYNC_APPLY_RESULT_VERSION,
  PCB_SYNC_BOARD_LOAD_RESULT_VERSION,
  PCB_SYNC_DEMO_PUBLICATION_RESULT_VERSION,
  PCB_SYNC_RESULT_VERSION,
  type PcbSyncApplyRequest,
  type PcbSyncApplyResult,
  type PcbSyncBoardLoadResult,
  type PcbSyncBoardRecord,
  type PcbSyncDemoSnapshotPublicationRequest,
  type PcbSyncPreflightRequest,
  type PcbSyncPreflightResult,
  type PcbSyncSnapshotPublicationResult,
  type PcbSyncSnapshotRevisionConflictDetails,
  PCB_SYNC_BOARD_REVISION_DERIVE_VERSION,
  PCB_SYNC_BOARD_REVISION_PREVIEW_VERSION,
  type PcbSyncBoardRevisionDeriveRequest,
  type PcbSyncBoardRevisionDeriveResult,
  type PcbSyncBoardRevisionPreviewResult,
  type PcbSyncBoardRevisionRequest,
} from "./types";
import type { PcbBoard } from "../pcb/types";

// B16.0: the client no longer supplies an actor — identity/role are derived
// server-side from the authenticated session + project membership. The scope
// carries only the project/branch SELECTOR. `actor` is retained as an
// OPTIONAL, IGNORED field for source compatibility during the migration.
export interface PcbSyncClientScope { tenantId: string; projectId: string; branchId: string; actor?: EngineeringActor }
export type PcbSyncClientFailureKind = "not_found" | "blocked" | "stale" | "conflict" | "retryable" | "terminal";
/** [B16-C.3] a `stale`/`conflict` failure may carry the server's conflict details (currently only the snapshot-revision conflict). */
export type PcbSyncClientResult<T> = { ok: true; value: T } | { ok: false; kind: PcbSyncClientFailureKind; code: string; status: number; detail?: string; conflict?: PcbSyncSnapshotRevisionConflictDetails };
export type PcbSyncFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/** [B16.1C] the reload-time manufacturing truth returned beside a board load (`include=manufacturing`). */
export type PcbSyncManufacturingIntegrityState = "ok" | "absent" | "corrupt";
export interface PcbSyncManufacturingTruth {
  snapshot: null | { revision: number; snapshotDigest: string; schematicRevision: string; schematicDigest: string };
  authority: null | { revision: number; recordDigest: string; boardRevision: string; boardDigest: string; schematicRevision: string; schematicDigest: string; componentAuthorityDigest: string; fabricationProfileId: string; qualifiedAt: string; actor: string; current: boolean };
  latestRelease: null | { releaseId: string; archiveSha256: string; manifestContentDigest: string; filename: string; authorityRecordDigest: string; authorityRevision: number; boardRevision: string; actor: string; releasedAt: string; current: boolean };
  /** [B16-A F12] per-subject verification state from the server; a `corrupt` subject is null with `current` false and its bounded code is listed. */
  integrity: { authority: PcbSyncManufacturingIntegrityState; snapshot: PcbSyncManufacturingIntegrityState; latestRelease: PcbSyncManufacturingIntegrityState; codes: string[] };
  /** [B16-A F14] the server-derived viewer and whether it may authorize a release (informational; the release route enforces). */
  viewer: { role: string; actorKind: string; canRelease: boolean }; /** [B23-B3] the provider observations: external, never Sirkit proof; absent unless the server composes them */ observations?: PcbSyncManufacturingObservations;
}

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function boardRevisionPreview(value: unknown): value is PcbSyncBoardRevisionPreviewResult { return object(value) && value.resultSchemaVersion === PCB_SYNC_BOARD_REVISION_PREVIEW_VERSION && (value.status === "ready_to_derive" || value.status === "blocked") && object(value.revisionPlan) && typeof (value.revisionPlan as { planDigest?: unknown }).planDigest === "string" && object(value.derivedPreflight) && object(value.parentPreflight); }
function boardRevisionDerive(value: unknown): value is PcbSyncBoardRevisionDeriveResult { return object(value) && value.resultSchemaVersion === PCB_SYNC_BOARD_REVISION_DERIVE_VERSION && (value.status === "derived" || value.status === "idempotent_replay") && typeof value.derivedBoardId === "string" && typeof value.boardRevision === "string" && object(value.lineage); }
/** [B16-C.3] the server's snapshot-revision conflict details, accepted only in their exact shape. */
function snapshotConflict(value: unknown): value is PcbSyncSnapshotRevisionConflictDetails {
  return object(value) && value.kind === "snapshot_revision" && Number.isSafeInteger(value.expectedRevision) && Number.isSafeInteger(value.currentRevision)
    && typeof value.currentSnapshotDigest === "string" && typeof value.currentSchematicRevision === "string" && typeof value.currentSchematicDigest === "string"
    && typeof value.attemptedSchematicRevision === "string" && typeof value.attemptedSnapshotDigest === "string";
}
const INTEGRITY_STATES = new Set<string>(["ok", "absent", "corrupt"]);
function integrityState(value: unknown): value is PcbSyncManufacturingIntegrityState { return typeof value === "string" && INTEGRITY_STATES.has(value); }
/** [B16-A F12/F14] exactly the shape the server sends: the three subjects (null or the
 *  identity fields the workflow consumes), the integrity verdicts, and the viewer. Anything
 *  else is an invalid response — never silently "no truth". */
function manufacturingTruth(value: unknown): value is PcbSyncManufacturingTruth {
  if (!object(value)) return false;
  const { snapshot, authority, latestRelease, integrity, viewer } = value;
  if (snapshot !== null && !(object(snapshot) && Number.isSafeInteger(snapshot.revision) && typeof snapshot.snapshotDigest === "string" && typeof snapshot.schematicRevision === "string")) return false;
  if (authority !== null && !(object(authority) && Number.isSafeInteger(authority.revision) && typeof authority.recordDigest === "string" && typeof authority.boardRevision === "string" && typeof authority.componentAuthorityDigest === "string" && typeof authority.current === "boolean")) return false;
  if (latestRelease !== null && !(object(latestRelease) && typeof latestRelease.releaseId === "string" && typeof latestRelease.filename === "string" && typeof latestRelease.authorityRecordDigest === "string" && Number.isSafeInteger(latestRelease.authorityRevision) && typeof latestRelease.current === "boolean")) return false;
  if (!object(integrity) || !integrityState(integrity.authority) || !integrityState(integrity.snapshot) || !integrityState(integrity.latestRelease) || !Array.isArray(integrity.codes) || !integrity.codes.every((code) => typeof code === "string")) return false;
  return object(viewer) && typeof viewer.role === "string" && typeof viewer.actorKind === "string" && typeof viewer.canRelease === "boolean" && (value.observations === undefined || manufacturingObservations(value.observations)); // [B23-B3] + the observation block, in its exact shape when present
}
/** A thrown fetch is not always a network outage: aborts (page navigation/reload,
 * AbortController) and serialization failures land here too. Keep the real cause. */
function fetchFailure(error: unknown): PcbSyncClientResult<never> {
  const name = error instanceof Error ? error.name : "";
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 200);
  const interrupted = name === "AbortError" || name === "TimeoutError";
  const result = failure(interrupted ? "PS_REQUEST_INTERRUPTED" : "PS_NETWORK_UNAVAILABLE", 503) as { ok: false; kind: PcbSyncClientFailureKind; code: string; status: number; detail?: string };
  result.detail = name && !message.startsWith(name) ? `${name}: ${message}` : message || name || "fetch failed";
  return result;
}
function isBoard(value: unknown): value is PcbBoard { if (!object(value)) return false; return value.formatVersion === 1 && (value.stackup === 2 || value.stackup === 4) && object(value.outline) && ["nets", "footprints", "tracks", "vias", "zones", "texts"].every((key) => Array.isArray(value[key])); }
function failure(code: string, status: number): PcbSyncClientResult<never> { const kind: PcbSyncClientFailureKind = status === 404 ? "not_found" : status >= 500 || status === 408 || status === 429 ? "retryable" : code.includes("STALE") || code.includes("REVISION") ? "stale" : status === 409 || code.includes("CONFLICT") || code.includes("IDEMPOTENCY") ? "conflict" : code.includes("BLOCKED") || code.includes("UNRESOLVED") ? "blocked" : "terminal"; return { ok: false, kind, code, status }; }
function publication(value: unknown): value is PcbSyncSnapshotPublicationResult { return object(value) && value.resultSchemaVersion === PCB_SYNC_DEMO_PUBLICATION_RESULT_VERSION && typeof value.snapshotId === "string" && Number.isSafeInteger(value.snapshotRevision) && typeof value.snapshotDigest === "string" && object(value.snapshot) && value.snapshot.snapshotDigest === value.snapshotDigest && typeof value.snapshot.schematicRevision === "string" && object(value.scope); }
function preflight(value: unknown): value is PcbSyncPreflightResult { if (!object(value) || value.resultSchemaVersion !== PCB_SYNC_RESULT_VERSION || typeof value.preflightId !== "string" || typeof value.status !== "string" || !object(value.snapshot) || !Array.isArray(value.blockers)) return false; return value.status !== "ready_to_apply" || (object(value.plan) && typeof value.plan.planId === "string" && typeof value.plan.planDigest === "string" && value.plan.lifecycle === "applicable" && object(value.plan.snapshot)); }
function applyResult(value: unknown): value is PcbSyncApplyResult { if (!object(value) || value.resultSchemaVersion !== PCB_SYNC_APPLY_RESULT_VERSION || typeof value.status !== "string" || typeof value.planId !== "string" || typeof value.planDigest !== "string" || typeof value.boardChanged !== "boolean" || !Array.isArray(value.blockers)) return false; return !["applied", "idempotent_replay"].includes(value.status) || (typeof value.committedBoardRevision === "string" && typeof value.committedBoardDigest === "string"); }
function boardLoad(value: unknown): value is PcbSyncBoardLoadResult {
  if (!object(value) || value.resultSchemaVersion !== PCB_SYNC_BOARD_LOAD_RESULT_VERSION || !["found", "not_found", "not_modified"].includes(String(value.status)) || !object(value.scope)) return false;
  if (value.status !== "found") return value.record === undefined;
  const record = value.record; if (!object(record) || !isBoard(record.board) || typeof record.tenantId !== "string" || typeof record.projectId !== "string" || typeof record.branchId !== "string" || typeof record.boardId !== "string" || typeof record.revision !== "string" || typeof record.digest !== "string" || typeof record.updatedAt !== "string") return false;
  const rebuilt = makeBoardRecord({ tenantId: record.tenantId, projectId: record.projectId, branchId: record.branchId, boardId: record.boardId, board: record.board, updatedAt: record.updatedAt });
  return rebuilt.revision === record.revision && rebuilt.digest === record.digest;
}

export class PcbSyncClient {
  // Default must not be a bare `fetch` reference: calling it as `this.request(...)`
  // rebinds `this` to the client and browsers throw "Illegal invocation"
  // (Node's fetch ignores `this`, so only browser callers broke).
  constructor(private readonly scope: PcbSyncClientScope, private readonly request: PcbSyncFetch = (input, init) => fetch(input, init), private readonly endpoint = "/api/pcb-sync") {}
  // B16.0: only the project/branch SELECTOR is sent — never an actor id,
  // actor kind, or role. Identity is established by the authenticated session
  // cookie and the server-owned project membership. The authenticated cookie
  // rides along automatically (same-origin fetch).
  private headers(extra: Record<string, string> = {}): HeadersInit { return { "content-type": "application/json", "x-sirkit-tenant-id": this.scope.tenantId, "x-sirkit-project-id": this.scope.projectId, "x-sirkit-branch-id": this.scope.branchId, ...extra }; }
  private async post<T>(operation: string, request: object, guard: (value: unknown) => value is T, extraHeaders: Record<string, string> = {}, options?: { signal?: AbortSignal }): Promise<PcbSyncClientResult<T>> { let response: Response; try { response = await this.request(this.endpoint, { method: "POST", headers: this.headers(extraHeaders), body: JSON.stringify({ operation, request }), ...(options?.signal ? { signal: options.signal } : {}) }); } catch (error) { return fetchFailure(error); } let body: unknown; try { body = await response.json(); } catch { return failure("PS_API_INVALID_RESPONSE", 502); } if (!object(body)) return failure("PS_API_INVALID_RESPONSE", 502); if (body.ok !== true || !guard(body.result)) { const failed = failure(typeof body.code === "string" ? body.code : "PS_API_INVALID_RESPONSE", response.status); return failed.ok ? failed : { ...failed, ...(snapshotConflict(body.conflict) ? { conflict: body.conflict } : {}) }; } return { ok: true, value: body.result }; }
  // B08.3 — publish/apply take NO AbortSignal deliberately: both commit
  // durable server state, and the response is the caller's only evidence of
  // commitment (a stale caller settles truthfully instead of canceling).
  publish(request: PcbSyncDemoSnapshotPublicationRequest): Promise<PcbSyncClientResult<PcbSyncSnapshotPublicationResult>> { return this.post("publish_demo_snapshot", request, publication); }
  /** Preflight is cancelable — its plan is inert until an explicit apply. */
  preflight(request: Omit<PcbSyncPreflightRequest, "tenantId" | "projectId" | "branchId" | "actorContext">, options?: { signal?: AbortSignal }): Promise<PcbSyncClientResult<PcbSyncPreflightResult>> { return this.post("preflight", request, preflight, {}, options); }
  apply(request: Omit<PcbSyncApplyRequest, "tenantId" | "projectId" | "branchId" | "actorContext">): Promise<PcbSyncClientResult<PcbSyncApplyResult>> { return this.post("apply", request, applyResult, { "x-sirkit-pcb-sync-opt-in": "true" }); }
  /** [B16-C.1] the reviewable rework plan for a NEW board revision; writes nothing, cancelable. */
  previewBoardRevision(request: Omit<PcbSyncBoardRevisionRequest, "tenantId" | "projectId" | "branchId" | "actorContext">, options?: { signal?: AbortSignal }): Promise<PcbSyncClientResult<PcbSyncBoardRevisionPreviewResult>> { return this.post("preview_board_revision", request, boardRevisionPreview, {}, options); }
  /** [B16-C.1] derive the reviewed revision — commits durable state, so no AbortSignal (same posture as apply). */
  deriveBoardRevision(request: Omit<PcbSyncBoardRevisionDeriveRequest, "tenantId" | "projectId" | "branchId" | "actorContext">): Promise<PcbSyncClientResult<PcbSyncBoardRevisionDeriveResult>> { return this.post("derive_board_revision", request, boardRevisionDerive, { "x-sirkit-pcb-sync-opt-in": "true" }); }
  /**
   * [B16.1C §C/§F] fresh-browser hydration: the authoritative board (or
   * `not_found`) PLUS the server-owned manufacturing truth — the durable
   * snapshot head to publish against, the qualification authority head and
   * whether it is current for this board, and the latest ledgered release.
   * A 404 `not_found` is a truthful answer (ok), not a failure.
   */
  async loadBoardWithManufacturing(boardId: string): Promise<PcbSyncClientResult<{ load: PcbSyncBoardLoadResult; manufacturing: PcbSyncManufacturingTruth | null }>> {
    const query = new URLSearchParams({ boardId, include: "manufacturing" });
    let response: Response;
    try { response = await this.request(`${this.endpoint}?${query}`, { method: "GET", headers: this.headers() }); } catch (error) { return fetchFailure(error); }
    let body: unknown;
    try { body = await response.json(); } catch { return failure("PS_API_INVALID_RESPONSE", 502); }
    if (!object(body) || body.ok !== true || !boardLoad(body.result)) return failure(object(body) && typeof body.code === "string" ? body.code : "PS_API_INVALID_RESPONSE", response.status);
    // Absent → the server sent no truth (null). Present but malformed → an invalid response, never degraded to "no truth".
    if (body.manufacturing !== undefined && !manufacturingTruth(body.manufacturing)) return failure("PS_API_INVALID_RESPONSE", 502);
    const manufacturing = body.manufacturing === undefined ? null : body.manufacturing;
    return { ok: true, value: { load: body.result, manufacturing } };
  }
  async loadBoard(boardId: string, known?: Pick<PcbSyncBoardRecord, "revision" | "digest">): Promise<PcbSyncClientResult<PcbSyncBoardLoadResult>> { const query = new URLSearchParams({ boardId, ...(known ? { knownRevision: known.revision, knownDigest: known.digest } : {}) }); let response: Response; try { response = await this.request(`${this.endpoint}?${query}`, { method: "GET", headers: this.headers() }); } catch (error) { return fetchFailure(error); } let body: unknown; try { body = await response.json(); } catch { return failure("PS_API_INVALID_RESPONSE", 502); } if (!object(body) || body.ok !== true || !boardLoad(body.result)) return failure(object(body) && typeof body.code === "string" ? body.code : "PS_API_INVALID_RESPONSE", response.status); return { ok: true, value: body.result }; }
}

// -- [B23-B3] the provider observations beside the board read (runbook B23-B steps 6-8; OD-168, OD-169) --

/** [B23-B3] A provider's suggestion: shown, never applied. */
export interface PcbSyncObservationSuggestion { schema: "sirkit.provider-suggestion.v1"; kind: "substitution" | "design_change"; field: string; text: string | number | boolean | null; withheld: string | null; disposition: "shown_never_applied" }
/** [B23-B3] One observation as the server judged it at the read: an external observation, never Sirkit proof. [B23-B3 review, 2026-10-04] coverage-3: every closed value typed as the server sends it; the receipt id null when the screen withheld it (security-1); the answer's licence (coverage-6). */
export interface PcbSyncManufacturingObservation {
  schema: "sirkit.manufacturing-observation.v1";
  observationClass: "manufacturing_observation";
  label: "external observation, not Sirkit proof";
  sirkitVerdict: "none";
  observationId: string;
  purpose: "dfm" | "quote";
  source: { providerId: string; displayName: string; operationId: string; providerReceiptId: string | null; registryVersion: string; registryDigest: string; transferVersion: string };
  retrievedAt: string;
  terms: { kept: "normalized" | "ids_digests_timestamps_only"; providerRetention: string; providerConfidentiality: string; answerLicense: string };
  freshness: { basis: "provider_stated" | "default_24h"; providerValidUntil: string | null; staleAt: string };
  digests: { releaseId: string; archiveSha256: string; outboundPackageDigest: string; requestSha256: string; responseSha256: string };
  capabilityProfile: { profileId: string; version: number };
  fields: Array<{ name: string; value: string | number | boolean }>;
  withheld: Array<{ name: string; reason: string }>;
  suggestions: PcbSyncObservationSuggestion[];
  stale: boolean;
  staleReasons: string[];
}
export interface PcbSyncManufacturingObservations { state: PcbSyncManufacturingIntegrityState; codes: string[]; items: PcbSyncManufacturingObservation[]; omitted: number }

const OBSERVATION_LIST_MAX = 32;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((entry) => typeof entry === "string");
const scalar = (value: unknown): boolean => typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
/** [B23-B3] The observation block in exactly the shape the server sends, at most 32 observations, each labelled, verdict-free and judged. [B23-B3 review, 2026-10-04] coverage-3, tests-2: exactly - every object's own keys, the fixed label, the closed values, a stale flag equal to its reasons, the server's bound (`OBSERVATION_LIST_MAX`, round-tripped by `b23-b-observation` case 9); was: the label's type only, and unknown keys admitted. */
function manufacturingObservations(value: unknown): value is PcbSyncManufacturingObservations {
  if (!keysExactly(value, ["state", "codes", "items", "omitted"]) || !integrityState(value.state) || !strings(value.codes) || !Number.isSafeInteger(value.omitted) || (value.omitted as number) < 0 || !Array.isArray(value.items) || value.items.length > OBSERVATION_LIST_MAX) return false;
  return value.items.every(observationItem);
}

// -- [B23-B3 review, 2026-10-04] coverage-3, tests-2: the exact shape of one observation --

const OBSERVATION_LABEL = "external observation, not Sirkit proof";
const ITEM_KEYS = ["schema", "observationClass", "label", "sirkitVerdict", "observationId", "purpose", "source", "retrievedAt", "terms", "freshness", "digests", "capabilityProfile", "fields", "withheld", "suggestions", "stale", "staleReasons"] as const;
const SOURCE_KEYS = ["providerId", "displayName", "operationId", "providerReceiptId", "registryVersion", "registryDigest", "transferVersion"] as const;
const DIGEST_KEYS = ["releaseId", "archiveSha256", "outboundPackageDigest", "requestSha256", "responseSha256"] as const;
const SUGGESTION_KEYS = ["schema", "kind", "field", "text", "withheld", "disposition"] as const;
const text = (value: unknown): value is string => typeof value === "string";
/** An object whose own keys are exactly `keys` (no key missing, none added). */
function keysExactly(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!object(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}
function observationItem(item: unknown): boolean {
  if (!keysExactly(item, ITEM_KEYS)) return false;
  const { source, terms, freshness, digests, capabilityProfile, fields, withheld, suggestions, staleReasons } = item;
  return item.schema === "sirkit.manufacturing-observation.v1" && item.observationClass === "manufacturing_observation" && item.label === OBSERVATION_LABEL && item.sirkitVerdict === "none"
    && text(item.observationId) && (item.purpose === "dfm" || item.purpose === "quote") && text(item.retrievedAt)
    && keysExactly(source, SOURCE_KEYS) && SOURCE_KEYS.every((key) => text(source[key]) || (key === "providerReceiptId" && source[key] === null))
    && keysExactly(terms, ["kept", "providerRetention", "providerConfidentiality", "answerLicense"]) && (terms.kept === "normalized" || terms.kept === "ids_digests_timestamps_only") && text(terms.providerRetention) && text(terms.providerConfidentiality) && text(terms.answerLicense)
    && keysExactly(freshness, ["basis", "providerValidUntil", "staleAt"]) && (freshness.basis === "provider_stated" || freshness.basis === "default_24h") && (freshness.providerValidUntil === null || text(freshness.providerValidUntil)) && text(freshness.staleAt)
    && keysExactly(digests, DIGEST_KEYS) && DIGEST_KEYS.every((key) => text(digests[key]))
    && keysExactly(capabilityProfile, ["profileId", "version"]) && text(capabilityProfile.profileId) && Number.isSafeInteger(capabilityProfile.version)
    && Array.isArray(fields) && fields.every((field) => keysExactly(field, ["name", "value"]) && text(field.name) && scalar(field.value))
    && Array.isArray(withheld) && withheld.every((entry) => keysExactly(entry, ["name", "reason"]) && text(entry.name) && text(entry.reason))
    && Array.isArray(suggestions) && suggestions.every((suggestion) => keysExactly(suggestion, SUGGESTION_KEYS) && suggestion.schema === "sirkit.provider-suggestion.v1" && suggestion.disposition === "shown_never_applied" && (suggestion.kind === "substitution" || suggestion.kind === "design_change") && text(suggestion.field) && (suggestion.text === null || scalar(suggestion.text)) && (suggestion.withheld === null || text(suggestion.withheld)))
    && typeof item.stale === "boolean" && strings(staleReasons) && item.stale === (staleReasons.length > 0);
}
