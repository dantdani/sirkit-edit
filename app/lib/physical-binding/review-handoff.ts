/**
 * [B16-C.2] Component-binding REVIEW HANDOFF.
 *
 * Publishing an exact component binding (`bind_atomic_selection`) is a human
 * reviewer / project-admin act and stays one. Before this module an editor who
 * tried was refused with a 422 that looked like malformed engineering input,
 * and nothing carried the request to a reviewer. Now:
 *
 *  - an editor REQUESTS review of one component's exact candidate; the server
 *    projects the reviewer's evidence from the published atomic snapshot
 *    (candidate, symbol, footprint, package, pin-to-pad certificate, source
 *    revisions) into a durable request record;
 *  - a reviewer LISTS pending requests and APPROVES (which performs the
 *    ordinary binding lifecycle under the reviewer's identity) or REJECTS;
 *  - the editor resumes: an approved request is idempotent authority, a
 *    rejected one names the reason, and nothing unrelated was rebuilt;
 *  - a pending request is RETIRED when the requester's membership is revoked
 *    or their role changed since the request (checked on every list/resolve).
 *
 * Status codes are truthful: insufficient permission is 403, a request in the
 * wrong state is 409, malformed input is 400 (mapped by the route).
 */

import type { PortableAtomicSnapshot } from "../atomic/types";
import { sha256 } from "../atomic/stable";
import { membershipRevisionOf, projectRoleFromMembership, type ProjectMembershipRepository } from "../auth/project-membership";
import { durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import type { EngineeringActor, ProjectRole } from "../engineering/types";
import { canonicalPackageName, type BindAtomicSelectionResult } from "./atomic-binding";
import { compareCodePoints } from "@/app/lib/stable-compare";

export const COMPONENT_REVIEW_REQUEST_SCHEMA = "sirkit.component-review-request.v1" as const;
export const COMPONENT_REVIEW_AGGREGATE = "pb.component-review-request.v1" as const;

export type ComponentReviewStatus = "pending" | "approved" | "rejected" | "withdrawn" | "retired";

/** Who may ASK for review (editors included) and who may DECIDE (reviewers only). */
export const REVIEW_REQUESTER_ROLES: ReadonlySet<ProjectRole> = new Set<ProjectRole>(["pcb_editor", "reviewer", "project_admin"]);
export const REVIEW_RESOLVER_ROLES: ReadonlySet<ProjectRole> = new Set<ProjectRole>(["reviewer", "project_admin"]);

export interface ComponentReviewEvidence {
  candidate: { atomicPartRevisionId: string; logicalPartId: string; exactPartId: string; exactMpn: string; manufacturerId: string; manufacturerName: string };
  symbol: { logicalAssetId: string; versionId: string; contentHash: string; semanticHash: string; symbolName: string; pinCount: number };
  footprint: { logicalAssetId: string; versionId: string; contentHash: string; semanticHash: string; footprintName: string; libraryNickname: string | null; mountingTechnology: string; padCount: number; electricalPadCount: number; mechanicalPadCount: number } | null;
  package: { canonicalName: string; identitySystem: string; pinCount: number; mountingTechnology: string } | null;
  pinToPad: {
    mappingId: string; state: string; semanticHash: string;
    entries: Array<{ terminalId: string; symbolPinIds: string[]; padNumbers: string[]; classification: string }>;
    missingTerminalIds: string[]; missingSymbolPinIds: string[]; missingPadNumbers: string[]; ambiguous: string[];
  } | null;
  sourceRevisions: { atomicPartRevisionId: string; symbolVersionId: string; footprintVersionId: string | null; mappingId: string | null; capturedAt: string };
  evidenceRefs: string[];
  /** Digest of everything above — the reviewer approves THIS evidence, not a later edit of it. */
  evidenceDigest: string;
}

export interface ComponentReviewRequest {
  schemaVersion: typeof COMPONENT_REVIEW_REQUEST_SCHEMA;
  requestId: string;
  tenantId: string;
  projectId: string;
  branchId: string;
  boardInstanceId: string;
  componentInstanceId: string;
  atomicPartRevisionId: string;
  status: ComponentReviewStatus;
  requestedBy: EngineeringActor;
  requestedAt: string;
  requestReason: string;
  /** The requester's membership version at request time; a change retires the request. */
  requesterMembershipRevision: string | null;
  evidence: ComponentReviewEvidence;
  decision?: { decidedBy: EngineeringActor; decidedAt: string; reason: string; bindingSetId?: string; bindingRevisionId?: string; lifecycleState?: string };
  retirement?: { retiredAt: string; reasonCode: "REQUESTER_MEMBERSHIP_REVOKED" | "REQUESTER_ROLE_CHANGED"; detail: string };
  withdrawal?: { withdrawnBy: EngineeringActor; withdrawnAt: string; reason: string };
  requestDigest: string;
}

export interface ComponentReviewScope { tenantId: string; projectId: string; branchId: string }

function stable(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => compareCodePoints(a, b)).map(([k, v]) => [k, normalize(v)])) : item;
  return JSON.stringify(normalize(value));
}

export function componentReviewRequestDigest(request: Omit<ComponentReviewRequest, "requestDigest">): string {
  return `sha256:${sha256(stable(request))}`;
}

export function componentReviewKey(scope: ComponentReviewScope, target: { boardInstanceId: string; componentInstanceId: string; atomicPartRevisionId: string }): string {
  return durableWorkflowId("component-review", { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, boardInstanceId: target.boardInstanceId, componentInstanceId: target.componentInstanceId, atomicPartRevisionId: target.atomicPartRevisionId });
}

/** The reviewer's evidence, projected verbatim from the PUBLISHED snapshot the binding would use. */
export function buildComponentReviewEvidence(snapshot: PortableAtomicSnapshot): ComponentReviewEvidence {
  const footprint = snapshot.footprint ?? null;
  const mapping = snapshot.mapping ?? null;
  const electrical = footprint ? footprint.pads.filter((pad) => !pad.mechanical) : [];
  const pkg = footprint ? canonicalPackageName(footprint.footprintName) : null;
  const content: Omit<ComponentReviewEvidence, "evidenceDigest"> = {
    candidate: {
      atomicPartRevisionId: snapshot.atomicRevision.id,
      logicalPartId: snapshot.atomicRevision.logicalPartId,
      exactPartId: snapshot.exactPart?.id ?? "",
      exactMpn: snapshot.exactPart?.exactMpn ?? "",
      manufacturerId: snapshot.manufacturer?.id ?? "",
      manufacturerName: snapshot.manufacturer?.canonicalName ?? "",
    },
    symbol: { logicalAssetId: snapshot.symbol.logicalAssetId, versionId: snapshot.symbol.versionId, contentHash: snapshot.symbol.contentHash, semanticHash: snapshot.symbol.semanticHash, symbolName: snapshot.symbol.symbolName, pinCount: snapshot.symbol.pins.length },
    footprint: footprint ? {
      logicalAssetId: footprint.logicalAssetId, versionId: footprint.versionId, contentHash: footprint.contentHash, semanticHash: footprint.semanticHash, footprintName: footprint.footprintName,
      libraryNickname: footprint.origin.libraryNickname ?? null, mountingTechnology: footprint.mountingTechnology, padCount: footprint.pads.length, electricalPadCount: new Set(electrical.map((pad) => pad.number)).size, mechanicalPadCount: footprint.pads.length - electrical.length,
    } : null,
    package: footprint && pkg ? { canonicalName: pkg.name, identitySystem: pkg.identitySystem, pinCount: new Set(electrical.map((pad) => pad.number)).size, mountingTechnology: footprint.mountingTechnology } : null,
    pinToPad: mapping ? {
      mappingId: mapping.id, state: mapping.state, semanticHash: mapping.semanticHash,
      entries: [...mapping.entries].map((entry) => ({ terminalId: entry.manufacturerTerminalId, symbolPinIds: [...entry.symbolPinIds].sort(compareCodePoints), padNumbers: [...entry.logicalPadNumbers].sort(compareCodePoints), classification: String(entry.classification) })).sort((a, b) => compareCodePoints(a.terminalId, b.terminalId)),
      missingTerminalIds: [...mapping.missingTerminalIds].sort(compareCodePoints), missingSymbolPinIds: [...mapping.missingSymbolPinIds].sort(compareCodePoints), missingPadNumbers: [...mapping.missingPadNumbers].sort(compareCodePoints), ambiguous: [...mapping.ambiguous].sort(compareCodePoints),
    } : null,
    sourceRevisions: { atomicPartRevisionId: snapshot.atomicRevision.id, symbolVersionId: snapshot.symbol.versionId, footprintVersionId: footprint?.versionId ?? null, mappingId: mapping?.id ?? null, capturedAt: snapshot.capturedAt },
    evidenceRefs: [...new Set([...snapshot.evidence.map((item) => item.id), ...(mapping?.evidenceIds ?? [])])].sort(compareCodePoints),
  };
  return { ...content, evidenceDigest: `sha256:${sha256(stable(content))}` };
}

function workflowScope(scope: ComponentReviewScope): DurableWorkflowScope {
  return { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId };
}

export interface StoredComponentReview { request: ComponentReviewRequest; revision: number }

/** Durable, per-(board, component, candidate) review request aggregate; CAS on the aggregate revision. */
export class DurableComponentReviewStore {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  async get(scope: ComponentReviewScope, key: string): Promise<StoredComponentReview | null> {
    const head = await this.workflow.loadHead<ComponentReviewRequest>(durableAggregateIdentity(workflowScope(scope), COMPONENT_REVIEW_AGGREGATE, key));
    return head ? { request: structuredClone(head.payload), revision: head.revision } : null;
  }

  async list(scope: ComponentReviewScope): Promise<StoredComponentReview[]> {
    const heads = await this.workflow.listHeads<ComponentReviewRequest>({ aggregateType: COMPONENT_REVIEW_AGGREGATE, scope: workflowScope(scope), limit: 5_000 });
    return heads
      .filter((head) => head.payload.tenantId === scope.tenantId && head.payload.projectId === scope.projectId && head.payload.branchId === scope.branchId)
      .map((head) => ({ request: structuredClone(head.payload), revision: head.revision }))
      .sort((a, b) => compareCodePoints(a.request.requestedAt, b.request.requestedAt) || compareCodePoints(a.request.requestId, b.request.requestId));
  }

  async put(request: ComponentReviewRequest, input: { expectedRevision: number; idempotencyKey: string; committedAt: string }): Promise<StoredComponentReview> {
    const scope = workflowScope(request);
    const key = componentReviewKey(request, request);
    const result = await this.workflow.commit<{ requestId: string; status: ComponentReviewStatus }>({
      scope, scopeKey: durableScopeKey(scope, "component-review"), idempotencyKey: input.idempotencyKey,
      operations: [{ aggregateType: COMPONENT_REVIEW_AGGREGATE, aggregateKey: key, expectedRevision: input.expectedRevision, payload: structuredClone(request), recordDigest: request.requestDigest }],
      outbox: [], result: { requestId: request.requestId, status: request.status }, committedAt: input.committedAt,
    });
    const record = result.records.find((item) => item.aggregateKey === key);
    return { request: structuredClone(request), revision: record?.revision ?? input.expectedRevision + 1 };
  }
}

function seal(content: Omit<ComponentReviewRequest, "requestDigest">): ComponentReviewRequest {
  return { ...content, requestDigest: componentReviewRequestDigest(content) };
}

function assertHuman(actor: EngineeringActor, roles: ReadonlySet<ProjectRole>, code: string): void {
  if (actor.actorKind !== "human" || !roles.has(actor.role)) throw new Error(code);
}

export interface ComponentReviewDeps {
  store: DurableComponentReviewStore;
  loadSnapshot: (atomicPartRevisionId: string) => Promise<PortableAtomicSnapshot | null>;
  /** Null when the runtime cannot verify memberships (then no retirement is inferred, and that is REPORTED). */
  membership: ProjectMembershipRepository | null;
  bind: (input: { scope: ComponentReviewScope; actor: EngineeringActor; boardInstanceId: string; componentInstanceId: string; atomicPartRevisionId: string }) => Promise<BindAtomicSelectionResult>;
}

export interface RequestComponentReviewInput {
  scope: ComponentReviewScope;
  actor: EngineeringActor;
  boardInstanceId: string;
  componentInstanceId: string;
  atomicPartRevisionId: string;
  reason: string;
  requestedAt: string;
  requesterMembershipRevision: string | null;
  idempotencyKey: string;
}

/** Editor (or reviewer/admin) asks for review. Idempotent on the (board, component, candidate) key while pending/approved. */
export async function requestComponentReview(deps: ComponentReviewDeps, input: RequestComponentReviewInput): Promise<{ stored: StoredComponentReview; created: boolean }> {
  assertHuman(input.actor, REVIEW_REQUESTER_ROLES, "PB_REVIEW_REQUEST_FORBIDDEN");
  if (!input.reason.trim() || input.reason.length > 2_000) throw new Error("PB_REVIEW_REASON_INVALID");
  const key = componentReviewKey(input.scope, input);
  const existing = await deps.store.get(input.scope, key);
  if (existing && (existing.request.status === "pending" || existing.request.status === "approved")) return { stored: existing, created: false };
  const snapshot = await deps.loadSnapshot(input.atomicPartRevisionId);
  if (!snapshot) throw new Error("PB_ATOMIC_REVISION_NOT_FOUND");
  const evidence = buildComponentReviewEvidence(snapshot);
  const request = seal({
    schemaVersion: COMPONENT_REVIEW_REQUEST_SCHEMA,
    requestId: `review:${sha256(stable({ key, requestedAt: input.requestedAt, by: input.actor.actorId })).slice(0, 32)}`,
    tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId,
    boardInstanceId: input.boardInstanceId, componentInstanceId: input.componentInstanceId, atomicPartRevisionId: input.atomicPartRevisionId,
    status: "pending", requestedBy: structuredClone(input.actor), requestedAt: input.requestedAt, requestReason: input.reason.trim(),
    requesterMembershipRevision: input.requesterMembershipRevision, evidence,
  });
  const stored = await deps.store.put(request, { expectedRevision: existing?.revision ?? 0, idempotencyKey: input.idempotencyKey, committedAt: input.requestedAt });
  return { stored, created: true };
}

/** Retire a PENDING request whose requester lost authority (revoked membership or changed role). Returns the stored state (possibly unchanged). */
export async function retireIfRequesterLostAuthority(deps: Pick<ComponentReviewDeps, "store" | "membership">, stored: StoredComponentReview, at: string): Promise<StoredComponentReview> {
  const { request } = stored;
  if (request.status !== "pending" || !deps.membership) return stored;
  const record = await deps.membership.loadActiveMembership({ tenantId: request.tenantId, projectId: request.projectId, userId: request.requestedBy.actorId });
  let retirement: ComponentReviewRequest["retirement"] | undefined;
  if (!record) retirement = { retiredAt: at, reasonCode: "REQUESTER_MEMBERSHIP_REVOKED", detail: "The requester no longer holds an active membership in this project." };
  else {
    const role = projectRoleFromMembership(record.role);
    if (!role || !REVIEW_REQUESTER_ROLES.has(role)) retirement = { retiredAt: at, reasonCode: "REQUESTER_ROLE_CHANGED", detail: `The requester's role is now ${record.role}; only editors, reviewers and administrators may hold a pending review request.` };
    else if (request.requesterMembershipRevision && membershipRevisionOf(record) !== request.requesterMembershipRevision) retirement = { retiredAt: at, reasonCode: "REQUESTER_ROLE_CHANGED", detail: "The requester's membership changed since the request was made; ask again under the current role." };
  }
  if (!retirement) return stored;
  const retired = seal({ ...request, status: "retired", retirement });
  return deps.store.put(retired, { expectedRevision: stored.revision, idempotencyKey: `retire:${request.requestId}:${stored.revision}`, committedAt: at });
}

export interface ListComponentReviewsInput { scope: ComponentReviewScope; boardInstanceId?: string; status?: ComponentReviewStatus; at: string }

/** Every request in scope (retirement applied lazily to pending ones). All members may read. */
export async function listComponentReviews(deps: Pick<ComponentReviewDeps, "store" | "membership">, input: ListComponentReviewsInput): Promise<{ requests: StoredComponentReview[]; membershipVerified: boolean }> {
  const all = await deps.store.list(input.scope);
  const out: StoredComponentReview[] = [];
  for (const stored of all) {
    if (input.boardInstanceId && stored.request.boardInstanceId !== input.boardInstanceId) continue;
    const current = await retireIfRequesterLostAuthority(deps, stored, input.at);
    if (input.status && current.request.status !== input.status) continue;
    out.push(current);
  }
  return { requests: out, membershipVerified: deps.membership !== null };
}

export interface ResolveComponentReviewInput {
  scope: ComponentReviewScope;
  actor: EngineeringActor;
  requestId: string;
  decision: "approve" | "reject";
  reason: string;
  at: string;
  idempotencyKey: string;
}

/** Reviewer decides. Approval performs the ordinary binding lifecycle under the REVIEWER's identity. */
export async function resolveComponentReview(deps: ComponentReviewDeps, input: ResolveComponentReviewInput): Promise<StoredComponentReview> {
  assertHuman(input.actor, REVIEW_RESOLVER_ROLES, "PB_REVIEW_RESOLVE_FORBIDDEN");
  if (!input.reason.trim() || input.reason.length > 2_000) throw new Error("PB_REVIEW_REASON_INVALID");
  const found = (await deps.store.list(input.scope)).find((item) => item.request.requestId === input.requestId);
  if (!found) throw new Error("PB_REVIEW_REQUEST_NOT_FOUND");
  const stored = await retireIfRequesterLostAuthority(deps, found, input.at);
  if (stored.request.status === "retired") throw new Error(`PB_REVIEW_REQUEST_RETIRED_CONFLICT:${stored.request.retirement?.reasonCode ?? "RETIRED"}`);
  if (stored.request.status !== "pending") throw new Error(`PB_REVIEW_REQUEST_STATE_CONFLICT:${stored.request.status}`);
  const { request } = stored;
  if (input.decision === "reject") {
    const rejected = seal({ ...request, status: "rejected", decision: { decidedBy: structuredClone(input.actor), decidedAt: input.at, reason: input.reason.trim() } });
    return deps.store.put(rejected, { expectedRevision: stored.revision, idempotencyKey: input.idempotencyKey, committedAt: input.at });
  }
  // The evidence the reviewer saw must still be what the binding would use.
  const snapshot = await deps.loadSnapshot(request.atomicPartRevisionId);
  if (!snapshot) throw new Error("PB_ATOMIC_REVISION_NOT_FOUND");
  const fresh = buildComponentReviewEvidence(snapshot);
  if (fresh.evidenceDigest !== request.evidence.evidenceDigest) throw new Error("PB_REVIEW_EVIDENCE_CHANGED_CONFLICT");
  const bound = await deps.bind({ scope: input.scope, actor: input.actor, boardInstanceId: request.boardInstanceId, componentInstanceId: request.componentInstanceId, atomicPartRevisionId: request.atomicPartRevisionId });
  const approved = seal({ ...request, status: "approved", decision: { decidedBy: structuredClone(input.actor), decidedAt: input.at, reason: input.reason.trim(), bindingSetId: bound.setId, bindingRevisionId: bound.bindingRevisionId, lifecycleState: bound.lifecycleState } });
  return deps.store.put(approved, { expectedRevision: stored.revision, idempotencyKey: input.idempotencyKey, committedAt: input.at });
}

/** The requester (or an admin) withdraws a pending request. */
export async function withdrawComponentReview(deps: Pick<ComponentReviewDeps, "store">, input: { scope: ComponentReviewScope; actor: EngineeringActor; requestId: string; reason: string; at: string; idempotencyKey: string }): Promise<StoredComponentReview> {
  if (input.actor.actorKind !== "human") throw new Error("PB_REVIEW_WITHDRAW_FORBIDDEN");
  const stored = (await deps.store.list(input.scope)).find((item) => item.request.requestId === input.requestId);
  if (!stored) throw new Error("PB_REVIEW_REQUEST_NOT_FOUND");
  if (stored.request.requestedBy.actorId !== input.actor.actorId && input.actor.role !== "project_admin") throw new Error("PB_REVIEW_WITHDRAW_FORBIDDEN");
  if (stored.request.status !== "pending") throw new Error(`PB_REVIEW_REQUEST_STATE_CONFLICT:${stored.request.status}`);
  const withdrawn = seal({ ...stored.request, status: "withdrawn", withdrawal: { withdrawnBy: structuredClone(input.actor), withdrawnAt: input.at, reason: input.reason.trim() || "withdrawn" } });
  return deps.store.put(withdrawn, { expectedRevision: stored.revision, idempotencyKey: input.idempotencyKey, committedAt: input.at });
}
