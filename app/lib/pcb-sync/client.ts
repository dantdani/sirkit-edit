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
} from "./types";
import type { PcbBoard } from "../pcb/types";

// B16.0: the client no longer supplies an actor — identity/role are derived
// server-side from the authenticated session + project membership. The scope
// carries only the project/branch SELECTOR. `actor` is retained as an
// OPTIONAL, IGNORED field for source compatibility during the migration.
export interface PcbSyncClientScope { tenantId: string; projectId: string; branchId: string; actor?: EngineeringActor }
export type PcbSyncClientFailureKind = "not_found" | "blocked" | "stale" | "conflict" | "retryable" | "terminal";
export type PcbSyncClientResult<T> = { ok: true; value: T } | { ok: false; kind: PcbSyncClientFailureKind; code: string; status: number; detail?: string };
export type PcbSyncFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/** [B16.1C] the reload-time manufacturing truth returned beside a board load (`include=manufacturing`). */
export interface PcbSyncManufacturingTruth {
  snapshot: null | { revision: number; snapshotDigest: string; schematicRevision: string; schematicDigest: string };
  authority: null | { revision: number; recordDigest: string; boardRevision: string; boardDigest: string; schematicRevision: string; schematicDigest: string; componentAuthorityDigest: string; fabricationProfileId: string; qualifiedAt: string; actor: string; current: boolean };
  latestRelease: null | { releaseId: string; archiveSha256: string; manifestContentDigest: string; filename: string; authorityRecordDigest: string; authorityRevision: number; boardRevision: string; actor: string; releasedAt: string; current: boolean };
}

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
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
  private async post<T>(operation: string, request: object, guard: (value: unknown) => value is T, extraHeaders: Record<string, string> = {}, options?: { signal?: AbortSignal }): Promise<PcbSyncClientResult<T>> { let response: Response; try { response = await this.request(this.endpoint, { method: "POST", headers: this.headers(extraHeaders), body: JSON.stringify({ operation, request }), ...(options?.signal ? { signal: options.signal } : {}) }); } catch (error) { return fetchFailure(error); } let body: unknown; try { body = await response.json(); } catch { return failure("PS_API_INVALID_RESPONSE", 502); } if (!object(body)) return failure("PS_API_INVALID_RESPONSE", 502); if (body.ok !== true || !guard(body.result)) return failure(typeof body.code === "string" ? body.code : "PS_API_INVALID_RESPONSE", response.status); return { ok: true, value: body.result }; }
  // B08.3 — publish/apply take NO AbortSignal deliberately: both commit
  // durable server state, and the response is the caller's only evidence of
  // commitment (a stale caller settles truthfully instead of canceling).
  publish(request: PcbSyncDemoSnapshotPublicationRequest): Promise<PcbSyncClientResult<PcbSyncSnapshotPublicationResult>> { return this.post("publish_demo_snapshot", request, publication); }
  /** Preflight is cancelable — its plan is inert until an explicit apply. */
  preflight(request: Omit<PcbSyncPreflightRequest, "tenantId" | "projectId" | "branchId" | "actorContext">, options?: { signal?: AbortSignal }): Promise<PcbSyncClientResult<PcbSyncPreflightResult>> { return this.post("preflight", request, preflight, {}, options); }
  apply(request: Omit<PcbSyncApplyRequest, "tenantId" | "projectId" | "branchId" | "actorContext">): Promise<PcbSyncClientResult<PcbSyncApplyResult>> { return this.post("apply", request, applyResult, { "x-sirkit-pcb-sync-opt-in": "true" }); }
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
    const manufacturing = object(body.manufacturing) && "authority" in body.manufacturing && "latestRelease" in body.manufacturing ? body.manufacturing as unknown as PcbSyncManufacturingTruth : null;
    return { ok: true, value: { load: body.result, manufacturing } };
  }
  async loadBoard(boardId: string, known?: Pick<PcbSyncBoardRecord, "revision" | "digest">): Promise<PcbSyncClientResult<PcbSyncBoardLoadResult>> { const query = new URLSearchParams({ boardId, ...(known ? { knownRevision: known.revision, knownDigest: known.digest } : {}) }); let response: Response; try { response = await this.request(`${this.endpoint}?${query}`, { method: "GET", headers: this.headers() }); } catch (error) { return fetchFailure(error); } let body: unknown; try { body = await response.json(); } catch { return failure("PS_API_INVALID_RESPONSE", 502); } if (!object(body) || body.ok !== true || !boardLoad(body.result)) return failure(object(body) && typeof body.code === "string" ? body.code : "PS_API_INVALID_RESPONSE", response.status); return { ok: true, value: body.result }; }
}
