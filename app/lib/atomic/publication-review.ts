/**
 * [B19-E E4] Import candidate review and two-person human publication: the durable request aggregate
 * `atomic.publication-request.v1` (cloned from the component-binding review handoff: CAS on the aggregate revision,
 * idempotent commits, humans only, retirement when the requester loses authority).
 *
 * In the catalog governance project (OD-37, `SIRKIT_ATOMIC_CATALOG_TENANT_ID` / `SIRKIT_ATOMIC_CATALOG_PROJECT_ID`, its
 * default branch):
 *  1. an editor, reviewer or administrator REQUESTS publication of an exact MPN; the server assembles the evidence itself from
 *     the offer cache (labels only, no vendor call), the bundled KiCad library and the person-entered terminal table, package and
 *     citation (organization_authored under that person), reads every catalog part a link names, and records the review
 *     projection and its digest;
 *  2. a reviewer or administrator APPROVES only when the digest is unchanged, the manufacturer and every identity or engineering
 *     conflict are resolved to a non-quarantined value from an engineering-authority source, nothing the profile needs is
 *     missing, every link still names the exact part, every quarantined fact is rejected or reviewed (stamped from the trusted
 *     reviewer), and the assembled draft is eligible under `evaluateApproval` — otherwise 409; or REJECTS;
 *  3. a DIFFERENT administrator PUBLISHES while the requester and the approver still hold their authority: the draft is
 *     re-assembled, the catalog transitions are replayed through `AtomicCatalog.transition`, and the E3-hardened
 *     `publishPortableAtomicSnapshot` writes the revision, its links and its audit row in one transaction;
 *  4. the requester may WITHDRAW an unpublished request (never while its publication may be in flight).
 * The history is append-only (every transition is a new aggregate record). No AI actor can take any step.
 */
import { membershipRevisionOf, projectRoleFromMembership, type ProjectMembershipRepository } from "../auth/project-membership";
import { DEFAULT_BRANCH_ID } from "../auth/trusted-request-context";
import { durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import type { EngineeringActor, ProjectRole } from "../engineering/types";
import { inertExternalText } from "../net/external-href";
import { buildEvidenceBundle, candidateFromObservation, type ExternalObservation, type NormalizedCandidate } from "../acquisition/quarantine";
import { buildImportReviewEvidence } from "../acquisition/import-review";
import { assembleAtomicDraft, AtomicAuthoringError, authoringCandidates, normalizeAtomicPublicationLinks, normalizeAtomicPublicationSpec, terminalTableText, type AssembledAtomicDraft, type AtomicAuthoringIdentity, type BundledKicadLibrary } from "./authoring";
import { catalogActorKey, isHumanCatalogActorId, type CatalogActorRole } from "./catalog";
import { canonicalExactMpn } from "./identity";
import { canonicalJson, sha256 } from "./stable";
import { evaluateApproval } from "./validation";
import type { ApprovalProfile, AtomicPartRevision, PortableAtomicSnapshot } from "./types";
import {
  ATOMIC_PUBLICATION_REQUEST_SCHEMA,
  DRAFT_BOUND_PROPERTIES,
  requiredResolutionProperties,
  resolvableFact,
  type AtomicFactDisposition,
  type AtomicPublicationLink,
  type AtomicPublicationRequest,
  type AtomicPublicationResolution,
  type AtomicPublicationSpec,
  type AtomicPublicationStatus,
  type AtomicPublicationViewer,
  type ImportReviewEvidence,
  type ImportReviewLink,
} from "./publication-review-contract";

export const ATOMIC_PUBLICATION_AGGREGATE = "atomic.publication-request.v1" as const;
export const ATOMIC_CATALOG_PROJECT_ENV = "SIRKIT_ATOMIC_CATALOG_PROJECT_ID" as const;
/** [B19-E E4 review] gates-1: the atomic tables are shared by every tenant, so the governance scope names its tenant too. */
export const ATOMIC_CATALOG_TENANT_ENV = "SIRKIT_ATOMIC_CATALOG_TENANT_ID" as const;
/**
 * [B19-E E4 review] A publication marker younger than this may name a transaction still in flight (its rows are invisible until
 * it commits), so neither a withdrawal nor another publication may start; a failed attempt clears its own marker at once.
 * [B19-E E4 review follow-up] ...only when the failure is a known rollback that a successful status read confirms: a failure whose
 * outcome cannot be known keeps its marker, and this lease governs.
 */
export const PUBLISH_MARKER_LEASE_MS = 120_000;

export const PUBLICATION_REQUESTER_ROLES: ReadonlySet<ProjectRole> = new Set<ProjectRole>(["pcb_editor", "reviewer", "project_admin"]);
export const PUBLICATION_RESOLVER_ROLES: ReadonlySet<ProjectRole> = new Set<ProjectRole>(["reviewer", "project_admin"]);
export const PUBLICATION_PUBLISHER_ROLES: ReadonlySet<ProjectRole> = new Set<ProjectRole>(["project_admin"]);

const MAX_REASON = 2_000;
const MAX_RESOLUTIONS = 32;
const MAX_DISPOSITIONS = 512;

const STATUS = Object.freeze({
  ATOMIC_PUBLICATION_INPUT_INVALID: 400,
  ATOMIC_PUBLICATION_GOVERNANCE_UNCONFIGURED: 403,
  ATOMIC_PUBLICATION_GOVERNANCE_FORBIDDEN: 403,
  ATOMIC_PUBLICATION_HUMAN_REQUIRED: 403,
  ATOMIC_PUBLICATION_FORBIDDEN: 403,
  ATOMIC_PUBLICATION_SAME_PERSON: 403,
  ATOMIC_PUBLICATION_NOT_FOUND: 404,
  ATOMIC_PUBLICATION_STATE_CONFLICT: 409,
  ATOMIC_PUBLICATION_NOT_APPROVED: 409,
  ATOMIC_PUBLICATION_RETIRED: 409,
  ATOMIC_PUBLICATION_REQUEST_OPEN: 409,
  ATOMIC_PUBLICATION_EVIDENCE_CHANGED: 409,
  ATOMIC_PUBLICATION_EVIDENCE_MISSING: 409,
  ATOMIC_PUBLICATION_MANUFACTURER_UNRESOLVED: 409,
  ATOMIC_PUBLICATION_RESOLUTION_REQUIRED: 409,
  ATOMIC_PUBLICATION_RESOLUTION_REFUSED: 409,
  ATOMIC_PUBLICATION_FACT_UNDISPOSITIONED: 409,
  ATOMIC_PUBLICATION_LINK_REFUSED: 409,
  ATOMIC_PUBLICATION_APPROVAL_BLOCKED: 409,
  ATOMIC_PUBLICATION_PUBLISH_IN_PROGRESS: 409,
  ATOMIC_PUBLICATION_PUBLISH_REFUSED: 409,
  ATOMIC_PUBLICATION_CONCURRENT_CHANGE: 409,
  /** [B19-E E4 review follow-up] a publication committed, but its request was withdrawn and replaced under the same key first */
  ATOMIC_PUBLICATION_REQUEST_REPLACED: 409,
  /** [B19-E E4 review follow-up] a publication failed and whether it committed cannot be known yet: the request is held */
  ATOMIC_PUBLICATION_PUBLISH_OUTCOME_UNKNOWN: 409,
} as const);
export type AtomicPublicationErrorCode = keyof typeof STATUS;
/** [B19-E E4 review follow-up] every refusal code and its HTTP status (the route keeps a message for each) */
export const ATOMIC_PUBLICATION_ERROR_STATUS: Readonly<Record<AtomicPublicationErrorCode, number>> = STATUS;

/** A refusal with a closed code, its HTTP status and server-authored detail (never a vendor value or a raw exception text). */
export class AtomicPublicationError extends Error {
  readonly status: number;
  constructor(readonly code: AtomicPublicationErrorCode, readonly detail: string[] = []) {
    super(code);
    this.name = "AtomicPublicationError";
    this.status = STATUS[code];
  }
}

export interface AtomicPublicationScope { tenantId: string; projectId: string; branchId: string }
export interface StoredAtomicPublication { request: AtomicPublicationRequest; revision: number; key: string }

/** [B19-E E4 review] Why a link cannot be written: closed codes the person can act on. */
export type AtomicLinkRefusalCode = "LINK_PART_NOT_FOUND" | "LINK_MPN_MISMATCH" | "LINK_SYMBOL_MISMATCH" | "LINK_ALREADY_LINKED";

/** [B19-E E4 review] A catalog part a link names, as the server reads it: its MPN, its KiCad symbol and the value keys linked. */
export interface AtomicLinkTarget {
  partId: string;
  mpn: string | null;
  library: string;
  name: string;
  linkedValueKeys: readonly string[];
}

export function atomicCatalogGovernanceProjectId(env: Readonly<Record<string, string | undefined>>): string | null {
  const value = env[ATOMIC_CATALOG_PROJECT_ENV]?.trim();
  return value ? value : null;
}

/** [B19-E E4 review] The governance project's tenant; unset refuses every operation (a project id alone names no scope). */
export function atomicCatalogGovernanceTenantId(env: Readonly<Record<string, string | undefined>>): string | null {
  const value = env[ATOMIC_CATALOG_TENANT_ENV]?.trim();
  return value ? value : null;
}

export function atomicPublicationKey(scope: AtomicPublicationScope, identityKey: string, profile: string): string {
  return durableWorkflowId("atomic-publication", { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, identityKey, profile });
}

function workflowScope(scope: AtomicPublicationScope): DurableWorkflowScope {
  return { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId };
}

function seal(content: Omit<AtomicPublicationRequest, "requestDigest">): AtomicPublicationRequest {
  return { ...content, requestDigest: `sha256:${sha256(canonicalJson(content))}` };
}

/**
 * [B19-E E4 review] A caller's idempotency key in its own namespace: never equal to a server-derived key (which all start
 * `atomic-publication-`), nor to the key of another person, operation or request.
 */
function callerKey(actor: EngineeringActor, operation: string, subject: string, key: string | undefined): string | undefined {
  return key === undefined ? undefined : `client:${sha256(canonicalJson({ actor: catalogActorKey(actor.actorId), operation, subject, key }))}`;
}

/** Durable, per-(exact MPN, profile) publication request aggregate; CAS on the aggregate revision; history is append-only. */
export class DurableAtomicPublicationStore {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  async get(scope: AtomicPublicationScope, key: string): Promise<StoredAtomicPublication | null> {
    const head = await this.workflow.loadHead<AtomicPublicationRequest>(durableAggregateIdentity(workflowScope(scope), ATOMIC_PUBLICATION_AGGREGATE, key));
    return head ? { request: structuredClone(head.payload), revision: head.revision, key } : null;
  }

  async list(scope: AtomicPublicationScope): Promise<StoredAtomicPublication[]> {
    const heads = await this.workflow.listHeads<AtomicPublicationRequest>({ aggregateType: ATOMIC_PUBLICATION_AGGREGATE, scope: workflowScope(scope), limit: 5_000 });
    return heads
      .filter((head) => head.payload.tenantId === scope.tenantId && head.payload.projectId === scope.projectId && head.payload.branchId === scope.branchId)
      .map((head) => ({ request: structuredClone(head.payload), revision: head.revision, key: head.aggregateKey }))
      .sort((a, b) => a.request.requestedAt.localeCompare(b.request.requestedAt) || a.request.requestId.localeCompare(b.request.requestId));
  }

  async put(request: AtomicPublicationRequest, input: { expectedRevision: number; idempotencyKey: string; committedAt: string }): Promise<StoredAtomicPublication> {
    const scope = workflowScope(request);
    const key = atomicPublicationKey(request, request.identityKey, request.profile);
    let result;
    try {
      result = await this.workflow.commit<{ requestId: string; status: AtomicPublicationStatus }>({
        scope, scopeKey: durableScopeKey(scope, "atomic-publication"), idempotencyKey: input.idempotencyKey,
        operations: [{ aggregateType: ATOMIC_PUBLICATION_AGGREGATE, aggregateKey: key, expectedRevision: input.expectedRevision, payload: structuredClone(request), recordDigest: request.requestDigest }],
        outbox: [], result: { requestId: request.requestId, status: request.status }, committedAt: input.committedAt,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT") throw new AtomicPublicationError("ATOMIC_PUBLICATION_CONCURRENT_CHANGE");
      throw error;
    }
    const record = result.records.find((item) => item.aggregateKey === key);
    // [B19-E E4 review] a replayed key answers only with the very record this write would have made: a replay of another
    // aggregate's or another record's commit is a concurrent change, never the unsaved request reported as written
    if (!record || (result.idempotent && record.recordDigest !== request.requestDigest)) throw new AtomicPublicationError("ATOMIC_PUBLICATION_CONCURRENT_CHANGE");
    return { request: structuredClone(record.payload as AtomicPublicationRequest), revision: record.revision, key };
  }
}

export interface AtomicPublicationDeps {
  store: DurableAtomicPublicationStore;
  /** Null when the runtime cannot verify memberships (then no retirement is inferred, and that is reported). */
  membership: ProjectMembershipRepository | null;
  /** The catalog governance project (OD-37); null refuses every operation. */
  governanceProjectId: string | null;
  /** [B19-E E4 review] The governance project's tenant (gates-1); null refuses every operation. */
  governanceTenantId: string | null;
  library: BundledKicadLibrary;
  /** The offer cache's observations for one exact MPN: a read, never a vendor call. */
  loadObservations(exactMpn: string, now: Date): Promise<readonly ExternalObservation[]>;
  /** Registered engineering sources beyond the request's own references (none in production today). */
  registeredCandidates?(exactMpn: string): Promise<readonly NormalizedCandidate[]>;
  loadIdentity(input: { exactMpn: string; manufacturerName: string | null }): Promise<AtomicAuthoringIdentity>;
  /** [B19-E E4 review] The catalog parts links name (MPN, KiCad symbol, value keys already linked): a read. */
  loadLinkTargets(partIds: readonly string[]): Promise<ReadonlyMap<string, AtomicLinkTarget>>;
  loadRevisionStatus(revisionIds: readonly string[]): Promise<ReadonlyMap<string, { state: string }>>;
  /**
   * The publication transaction. [B19-E E4 review follow-up] A rejection raised at or after its COMMIT carries
   * `commitOutcomeUnknown: true` (see `publicationCommitOutcomeUnknown`): the revision may commit after the answer was lost.
   */
  publish(input: { snapshot: PortableAtomicSnapshot; actorId: string; actorRole: "publisher" | "admin"; requiredProfile: ApprovalProfile; reason: string; links: readonly AtomicPublicationLink[] }): Promise<{ revisionId: string; auditId: string }>;
  clock?(): Date;
}

const NO_IDENTITY: AtomicAuthoringIdentity = Object.freeze({ manufacturerId: null, exactPartId: null, logicalPartId: null, latestRevision: 0 });
const now = (deps: Pick<AtomicPublicationDeps, "clock">): Date => deps.clock?.() ?? new Date();

function assertGovernance(deps: Pick<AtomicPublicationDeps, "governanceProjectId" | "governanceTenantId">, scope: AtomicPublicationScope): void {
  if (!deps.governanceProjectId || !deps.governanceTenantId) throw new AtomicPublicationError("ATOMIC_PUBLICATION_GOVERNANCE_UNCONFIGURED");
  // [B19-E E4 review] gates-1: another tenant's project that happens to carry the governance project's id is not the governance scope
  if (scope.tenantId !== deps.governanceTenantId || scope.projectId !== deps.governanceProjectId || scope.branchId !== DEFAULT_BRANCH_ID) throw new AtomicPublicationError("ATOMIC_PUBLICATION_GOVERNANCE_FORBIDDEN");
}

/** A human (never an `ai` actor kind, never an llm:, ocr: or agent: id) holding one of the operation's roles. */
export function isHumanPublicationActor(actor: EngineeringActor): boolean {
  return actor.actorKind === "human" && isHumanCatalogActorId(actor.actorId);
}

function assertActor(actor: EngineeringActor, roles: ReadonlySet<ProjectRole>): void {
  if (!isHumanPublicationActor(actor)) throw new AtomicPublicationError("ATOMIC_PUBLICATION_HUMAN_REQUIRED");
  if (!roles.has(actor.role)) throw new AtomicPublicationError("ATOMIC_PUBLICATION_FORBIDDEN");
}

export function atomicPublicationViewer(actor: EngineeringActor): AtomicPublicationViewer {
  const human = isHumanPublicationActor(actor);
  return { actorId: actor.actorId, role: actor.role, actorKind: actor.actorKind, canSubmit: human && PUBLICATION_REQUESTER_ROLES.has(actor.role), canResolve: human && PUBLICATION_RESOLVER_ROLES.has(actor.role), canPublish: human && PUBLICATION_PUBLISHER_ROLES.has(actor.role) };
}

function reasonText(value: unknown, fallback?: string): string {
  const text = typeof value === "string" && value.length <= MAX_REASON * 4 ? inertExternalText(value, MAX_REASON) : null;
  if (text !== null) return text;
  if (fallback !== undefined) return fallback;
  throw new AtomicPublicationError("ATOMIC_PUBLICATION_INPUT_INVALID", ["reason"]);
}

function catalogRoleOf(actor: EngineeringActor): CatalogActorRole {
  return actor.role === "project_admin" ? "admin" : "reviewer";
}

function namesExactPart(mpn: string, identityKey: string): boolean {
  try {
    return canonicalExactMpn(mpn) === identityKey;
  } catch {
    return false;
  }
}

/**
 * [B19-E E4 review] Each link read against the catalog part it names: the part exists; when it names an MPN, that MPN is the
 * request's exact part (OD-34 identity); it is the KiCad symbol the draft uses (a generic part with no MPN included); and its
 * value has no link yet (a publication never repoints one). The first failing rule per link is its refusal.
 */
async function reviewLinks(deps: Pick<AtomicPublicationDeps, "loadLinkTargets">, spec: AtomicPublicationSpec, links: readonly AtomicPublicationLink[]): Promise<{ links: ImportReviewLink[]; refusals: AtomicLinkRefusalCode[] }> {
  if (links.length === 0) return { links: [], refusals: [] };
  const targets = await deps.loadLinkTargets([...new Set(links.map((link) => link.partId))]);
  const identityKey = canonicalExactMpn(spec.exactMpn);
  const symbol = spec.symbol ? `${spec.symbol.library}:${spec.symbol.name}` : null;
  const refusals: AtomicLinkRefusalCode[] = [];
  const reviewed = links.map((link): ImportReviewLink => {
    const target = targets.get(link.partId);
    const namesMpn = Boolean(target?.mpn && target.mpn.trim() !== "");
    const refusal: AtomicLinkRefusalCode | null = !target ? "LINK_PART_NOT_FOUND"
      : namesMpn && !namesExactPart(target.mpn!, identityKey) ? "LINK_MPN_MISMATCH"
      : `${target.library}:${target.name}` !== symbol ? "LINK_SYMBOL_MISMATCH"
      : target.linkedValueKeys.includes(link.valueKey) ? "LINK_ALREADY_LINKED"
      : null;
    if (refusal && !refusals.includes(refusal)) refusals.push(refusal);
    return {
      partId: link.partId,
      valueKey: link.valueKey,
      partMpn: namesMpn ? inertExternalText(target!.mpn, 128) : null,
      partSymbol: target ? `${inertExternalText(target.library, 128) ?? ""}:${inertExternalText(target.name, 192) ?? ""}` : "",
    };
  });
  return { links: reviewed, refusals };
}

/** The evidence for a request, assembled by the server from the cache, the registered sources, the request's own spec and the
 *  catalog parts its links name. */
async function assembleEvidence(deps: AtomicPublicationDeps, spec: AtomicPublicationSpec, links: readonly AtomicPublicationLink[], requestedBy: string, requestedAt: string, at: Date): Promise<{ evidence: ImportReviewEvidence; linkRefusals: AtomicLinkRefusalCode[] }> {
  const identityKey = canonicalExactMpn(spec.exactMpn);
  const observations = (await deps.loadObservations(spec.exactMpn, at)).filter((observation) => candidateFromObservation(observation).identityKey === identityKey);
  const registered = deps.registeredCandidates ? (await deps.registeredCandidates(spec.exactMpn)).filter((candidate) => candidate.identityKey === identityKey) : [];
  const authored = authoringCandidates(spec, { authoredBy: requestedBy, authoredAt: requestedAt, identity: NO_IDENTITY, library: deps.library });
  const bundle = buildEvidenceBundle([...observations.map(candidateFromObservation), ...registered, ...authored.candidates], at);
  const linked = await reviewLinks(deps, spec, links);
  return { evidence: buildImportReviewEvidence(bundle, observations, spec.profile, authored.diagnostics, linked.links), linkRefusals: linked.refusals };
}

async function findRequest(deps: Pick<AtomicPublicationDeps, "store">, scope: AtomicPublicationScope, requestId: unknown): Promise<StoredAtomicPublication> {
  if (typeof requestId !== "string" || !requestId || requestId.length > 128) throw new AtomicPublicationError("ATOMIC_PUBLICATION_INPUT_INVALID", ["requestId"]);
  const found = (await deps.store.list(scope)).find((item) => item.request.requestId === requestId);
  if (!found) throw new AtomicPublicationError("ATOMIC_PUBLICATION_NOT_FOUND");
  return found;
}

type Retirement = NonNullable<AtomicPublicationRequest["retirement"]>;

/**
 * Whether an open request lost the authority it rests on: its requester's (pending or approved) and, for an approval waiting to
 * be published, its approver's ([B19-E E4 review]: revoked, a role that may no longer approve, or any membership change since
 * the decision). A request with a publication marker is settled by the publish and withdraw paths first, unless they ask.
 */
async function lostAuthority(deps: Pick<AtomicPublicationDeps, "membership">, request: AtomicPublicationRequest, at: string, options: { evenWithMarker?: boolean } = {}): Promise<Retirement | null> {
  if ((request.status !== "pending" && request.status !== "approved") || !deps.membership) return null;
  if (request.publishing && !options.evenWithMarker) return null;
  const record = await deps.membership.loadActiveMembership({ tenantId: request.tenantId, projectId: request.projectId, userId: request.requestedBy.actorId });
  if (!record) return { retiredAt: at, reasonCode: "REQUESTER_MEMBERSHIP_REVOKED", detail: "The requester no longer holds an active membership in the catalog governance project." };
  const role = projectRoleFromMembership(record.role);
  if (!role || !PUBLICATION_REQUESTER_ROLES.has(role)) return { retiredAt: at, reasonCode: "REQUESTER_ROLE_CHANGED", detail: `The requester's role is now ${record.role}; only editors, reviewers and administrators may hold an open publication request.` };
  if (request.requesterMembershipRevision && membershipRevisionOf(record) !== request.requesterMembershipRevision) return { retiredAt: at, reasonCode: "REQUESTER_ROLE_CHANGED", detail: "The requester's membership changed since the request was made; ask again under the current role." };
  const decision = request.decision;
  if (request.status === "approved" && decision?.decision === "approve") {
    const approver = await deps.membership.loadActiveMembership({ tenantId: request.tenantId, projectId: request.projectId, userId: decision.decidedBy.actorId });
    if (!approver) return { retiredAt: at, reasonCode: "APPROVER_MEMBERSHIP_REVOKED", detail: "The approver no longer holds an active membership in the catalog governance project; the part must be reviewed again." };
    const approverRole = projectRoleFromMembership(approver.role);
    if (!approverRole || !PUBLICATION_RESOLVER_ROLES.has(approverRole)) return { retiredAt: at, reasonCode: "APPROVER_ROLE_CHANGED", detail: `The approver's role is now ${approver.role}; only reviewers and administrators may hold an approval.` };
    if (decision.deciderMembershipRevision && membershipRevisionOf(approver) !== decision.deciderMembershipRevision) return { retiredAt: at, reasonCode: "APPROVER_ROLE_CHANGED", detail: "The approver's membership changed since the approval; the part must be reviewed again." };
  }
  return null;
}

/** Retire an open request whose requester or approver lost authority (persisted); returns the stored state, possibly unchanged. */
export async function retireIfAuthorityLost(deps: Pick<AtomicPublicationDeps, "store" | "membership">, stored: StoredAtomicPublication, at: string, options: { evenWithMarker?: boolean } = {}): Promise<StoredAtomicPublication> {
  const retirement = await lostAuthority(deps, stored.request, at, options);
  if (!retirement) return stored;
  const { publishing: _attempt, ...request } = stored.request;
  void _attempt;
  return deps.store.put(seal({ ...request, status: "retired", retirement }), { expectedRevision: stored.revision, idempotencyKey: `atomic-publication-retire:${stored.request.requestId}:${stored.revision}`, committedAt: at });
}

/**
 * [B19-E E4 review follow-up] A publication failure the publication transaction reports as raised at or after its COMMIT: the
 * revision may have committed (or may still commit) although the answer was lost, so no status read taken now can rule it out.
 */
export function publicationCommitOutcomeUnknown(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { commitOutcomeUnknown?: unknown }).commitOutcomeUnknown === true;
}

/**
 * [B19-E E4 review follow-up] What the catalog says of an attempt's revision: "committed", "absent" (the status read succeeded and
 * does not hold it), or "unknown" when the read fails or answers with anything but a status map — never guessed as absent.
 */
async function publicationOutcome(deps: Pick<AtomicPublicationDeps, "loadRevisionStatus">, revisionId: string): Promise<"committed" | "absent" | "unknown"> {
  let statuses: unknown;
  try {
    statuses = await deps.loadRevisionStatus([revisionId]);
  } catch {
    return "unknown";
  }
  // [B19-E E4 review follow-up] the dependency is typed ReadonlyMap: any answer with has() is read (a Map from another realm or
  // a wrapper included); only a missing or malformed answer is unknown
  const has = (statuses as { has?: unknown } | null)?.has;
  if (typeof has !== "function") return "unknown";
  return has.call(statuses, revisionId) === true ? "committed" : "absent";
}

/** Test hook for the three-way outcome read. */
export const publicationOutcomeFor = publicationOutcome;

/** [B19-E E4 review follow-up] The request is held: an attempt's outcome cannot be read, so it may still name a publication. */
function outcomeUnknown(cause?: unknown): AtomicPublicationError {
  const error = new AtomicPublicationError("ATOMIC_PUBLICATION_PUBLISH_OUTCOME_UNKNOWN");
  return cause === undefined ? error : Object.assign(error, { cause });
}

/** [B19-E E4 review] A marker inside its lease may name a publication transaction that has not committed yet. */
function markerInFlight(marker: { at: string }, at: Date): boolean {
  const age = at.getTime() - Date.parse(marker.at);
  return !Number.isFinite(age) || age < PUBLISH_MARKER_LEASE_MS;
}

/**
 * [B19-E E4 review] Record a publication that committed. When a change raced the final write (a withdrawal or retirement that
 * slipped past the lease), the head is read again and the committed revision recorded over it: the catalog holds the revision,
 * so the request says so; the raced change stays in the append-only history.
 * [B19-E E4 review follow-up] ...but only onto the SAME request: when the head under the aggregate key now belongs to another
 * request (the published one was withdrawn and a new one made for the same exact MPN and profile), nothing is written to it — that
 * request was never reviewed for this revision — and the refusal names both request ids. The committed revision stays in the
 * catalog, where the status reads show it.
 */
async function recordPublication(deps: Pick<AtomicPublicationDeps, "store">, stored: StoredAtomicPublication, publication: { publishedBy: EngineeringActor; publishedAt: string; revisionId: string; auditId: string | null }, committedAt: string, idempotencyKey?: string): Promise<StoredAtomicPublication> {
  let head = stored;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (head.request.requestId !== stored.request.requestId) throw new AtomicPublicationError("ATOMIC_PUBLICATION_REQUEST_REPLACED", [stored.request.requestId, head.request.requestId]);
    if (head.request.status === "published") {
      if (head.request.publication?.revisionId === publication.revisionId) return head;
      throw new AtomicPublicationError("ATOMIC_PUBLICATION_CONCURRENT_CHANGE", ["ANOTHER_PUBLICATION_RECORDED"]);
    }
    const { publishing: _attempt, ...request } = head.request;
    void _attempt;
    try {
      return await deps.store.put(seal({ ...request, status: "published", publication: { ...publication, publishedBy: structuredClone(publication.publishedBy), links: [...head.request.links] } }), {
        expectedRevision: head.revision,
        idempotencyKey: (attempt === 0 ? idempotencyKey : undefined) ?? `atomic-publication-published:${head.request.requestId}:${head.revision}:${sha256(publication.revisionId).slice(0, 16)}`,
        committedAt,
      });
    } catch (error) {
      if (!(error instanceof AtomicPublicationError) || error.code !== "ATOMIC_PUBLICATION_CONCURRENT_CHANGE") throw error;
      const current = await deps.store.get(head.request, head.key);
      if (!current) throw error;
      head = current;
    }
  }
  throw new AtomicPublicationError("ATOMIC_PUBLICATION_CONCURRENT_CHANGE");
}

/** [B19-E E4 review] The publication transaction's refusals a person can act on, as closed codes (never the exception text). */
function publishRefusalDetail(error: unknown): string[] {
  const message = error instanceof Error ? error.message : "";
  if (/a publication never repoints a link/.test(message)) return ["LINK_ALREADY_LINKED"];
  if (/a link must name the exact part/.test(message)) return ["LINK_MPN_MISMATCH"];
  return [];
}

// ── submit ───────────────────────────────────────────────────────────────────

export interface SubmitAtomicPublicationInput {
  scope: AtomicPublicationScope;
  actor: EngineeringActor;
  membershipRevision: string | null;
  spec: unknown;
  links: unknown;
  reason: unknown;
  idempotencyKey?: string;
}

export async function submitAtomicPublicationRequest(deps: AtomicPublicationDeps, input: SubmitAtomicPublicationInput): Promise<{ stored: StoredAtomicPublication; created: boolean }> {
  assertGovernance(deps, input.scope);
  assertActor(input.actor, PUBLICATION_REQUESTER_ROLES);
  const normalized = normalizeAtomicPublicationSpec(input.spec);
  if (!normalized.ok) throw new AtomicPublicationError("ATOMIC_PUBLICATION_INPUT_INVALID", [normalized.field]);
  const links = normalizeAtomicPublicationLinks(input.links);
  if (!links.ok) throw new AtomicPublicationError("ATOMIC_PUBLICATION_INPUT_INVALID", [links.field]);
  const { spec } = normalized;
  // a link needs a footprint and a pin-to-pad mapping (parts_atomic_links carries both)
  if (links.value.length > 0 && spec.profile !== "pcb_assignable") throw new AtomicPublicationError("ATOMIC_PUBLICATION_INPUT_INVALID", ["links"]);
  const reason = reasonText(input.reason);
  const at = now(deps);
  const requestedAt = at.toISOString();
  const identityKey = canonicalExactMpn(spec.exactMpn);
  const key = atomicPublicationKey(input.scope, identityKey, spec.profile);
  const existing = await deps.store.get(input.scope, key);
  const current = existing ? await retireIfAuthorityLost(deps, existing, requestedAt) : null;
  if (current && (current.request.status === "pending" || current.request.status === "approved")) {
    // [B19-E E4 review] the same request again is idempotent; different evidence is refused, naming the open request
    if (canonicalJson({ spec: current.request.spec, links: current.request.links }) === canonicalJson({ spec, links: links.value })) return { stored: current, created: false };
    throw new AtomicPublicationError("ATOMIC_PUBLICATION_REQUEST_OPEN", [current.request.requestId]);
  }

  const { evidence, linkRefusals } = await assembleEvidence(deps, spec, links.value, input.actor.actorId, requestedAt, at);
  if (linkRefusals.length > 0) throw new AtomicPublicationError("ATOMIC_PUBLICATION_LINK_REFUSED", linkRefusals);
  const request = seal({
    schemaVersion: ATOMIC_PUBLICATION_REQUEST_SCHEMA,
    // the aggregate revision it replaces is part of the request's identity: a new request after a published one is a new id
    requestId: `atomic-publication:${sha256(canonicalJson({ key, replaces: current?.revision ?? 0, requestedAt, by: input.actor.actorId })).slice(0, 32)}`,
    tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId,
    identityKey, exactMpn: spec.exactMpn, profile: spec.profile,
    status: "pending", requestedBy: structuredClone(input.actor), requestedAt, requestReason: reason,
    requesterMembershipRevision: input.membershipRevision,
    spec, links: links.value, evidence,
  });
  const stored = await deps.store.put(request, { expectedRevision: current?.revision ?? 0, idempotencyKey: callerKey(input.actor, "submit_request", key, input.idempotencyKey) ?? `atomic-publication-submit:${key}:${current?.revision ?? 0}`, committedAt: requestedAt });
  return { stored, created: stored.request.requestId === request.requestId };
}

// ── list ─────────────────────────────────────────────────────────────────────

export async function listAtomicPublicationRequests(deps: AtomicPublicationDeps, input: { scope: AtomicPublicationScope; status?: AtomicPublicationStatus }): Promise<{ requests: Array<StoredAtomicPublication & { effectiveStatus: AtomicPublicationStatus }>; membershipVerified: boolean }> {
  assertGovernance(deps, input.scope);
  const at = now(deps).toISOString();
  const requests: Array<StoredAtomicPublication & { effectiveStatus: AtomicPublicationStatus }> = [];
  for (const stored of await deps.store.list(input.scope)) {
    // a read never writes: a request whose requester or approver lost authority is SHOWN as retired, and the next mutation records it
    const effectiveStatus: AtomicPublicationStatus = (await lostAuthority(deps, stored.request, at)) ? "retired" : stored.request.status;
    if (input.status && effectiveStatus !== input.status) continue;
    requests.push({ ...stored, effectiveStatus });
  }
  return { requests, membershipVerified: deps.membership !== null };
}

// ── resolve ──────────────────────────────────────────────────────────────────

export interface ResolveAtomicPublicationInput {
  scope: AtomicPublicationScope;
  actor: EngineeringActor;
  /** [B19-E E4 review] the resolver's membership revision from the trusted context, recorded with the decision */
  membershipRevision?: string | null;
  requestId: unknown;
  decision: "approve" | "reject";
  reason: unknown;
  reviewEvidenceDigest?: unknown;
  resolutions?: unknown;
  factDispositions?: unknown;
  idempotencyKey?: string;
}

function closedRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).every((key) => keys.includes(key));
}

function normalizeResolutions(raw: unknown): AtomicPublicationResolution[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_RESOLUTIONS) throw new AtomicPublicationError("ATOMIC_PUBLICATION_INPUT_INVALID", ["resolutions"]);
  const seen = new Set<string>();
  return raw.map((item) => {
    if (!closedRecord(item, ["property", "factId", "reason"]) || typeof item.property !== "string" || item.property.length > 64 || typeof item.factId !== "string" || item.factId.length > 128 || seen.has(item.property)) throw new AtomicPublicationError("ATOMIC_PUBLICATION_INPUT_INVALID", ["resolutions"]);
    seen.add(item.property);
    // every resolution carries its own reason
    return { property: item.property, factId: item.factId, reason: reasonText(item.reason) };
  });
}

function normalizeDispositions(raw: unknown): Array<{ factId: string; disposition: "rejected" | "reviewed"; note: string }> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_DISPOSITIONS) throw new AtomicPublicationError("ATOMIC_PUBLICATION_INPUT_INVALID", ["factDispositions"]);
  const seen = new Set<string>();
  return raw.map((item) => {
    if (!closedRecord(item, ["factId", "disposition", "note"]) || typeof item.factId !== "string" || item.factId.length > 128 || (item.disposition !== "rejected" && item.disposition !== "reviewed") || seen.has(item.factId)) throw new AtomicPublicationError("ATOMIC_PUBLICATION_INPUT_INVALID", ["factDispositions"]);
    seen.add(item.factId);
    return { factId: item.factId, disposition: item.disposition, note: reasonText(item.note, "") };
  });
}

/** The value the published draft is assembled from, for a property the draft is built from. */
function draftValue(spec: AtomicPublicationSpec, property: string): string | null {
  if (property === "symbol") return spec.symbol ? `${spec.symbol.library}:${spec.symbol.name}` : null;
  if (property === "footprint") return spec.footprint ? `${spec.footprint.library}:${spec.footprint.name}` : null;
  if (property === "pin_mapping") return spec.terminals.length > 0 ? terminalTableText(spec.terminals) : null;
  if (property === "package") return spec.package ? `${spec.package.code} (${spec.package.mounting})` : null;
  return null;
}

function manufacturerFor(request: AtomicPublicationRequest, resolutions: readonly AtomicPublicationResolution[]): { canonicalName: string; officialDomains: string[] } {
  const chosen = resolutions.find((item) => item.property === "manufacturer");
  const fact = request.evidence.facts.find((item) => item.factId === chosen?.factId);
  if (!chosen || !fact || fact.value === null) throw new AtomicPublicationError("ATOMIC_PUBLICATION_MANUFACTURER_UNRESOLVED");
  const entered = request.spec.manufacturer;
  return { canonicalName: fact.value, officialDomains: entered && entered.canonicalName === fact.value ? [...entered.officialDomains] : [] };
}

async function assembleDraft(deps: AtomicPublicationDeps, request: AtomicPublicationRequest, resolutions: readonly AtomicPublicationResolution[]): Promise<AssembledAtomicDraft> {
  const manufacturer = manufacturerFor(request, resolutions);
  const identity = await deps.loadIdentity({ exactMpn: request.spec.exactMpn, manufacturerName: manufacturer.canonicalName });
  try {
    return assembleAtomicDraft(request.spec, { authoredBy: request.requestedBy.actorId, authoredAt: request.requestedAt, identity, library: deps.library, manufacturer });
  } catch (error) {
    if (error instanceof AtomicAuthoringError) throw new AtomicPublicationError("ATOMIC_PUBLICATION_APPROVAL_BLOCKED", error.detail);
    throw error;
  }
}

function submitted(assembled: AssembledAtomicDraft, request: AtomicPublicationRequest): AtomicPartRevision {
  return assembled.catalog.transition({ revisionId: assembled.draft.id, to: "needs_review", actorId: request.requestedBy.actorId, actorRole: "ingestion_worker", reason: request.requestReason, now: new Date(request.requestedAt) });
}

export async function resolveAtomicPublicationRequest(deps: AtomicPublicationDeps, input: ResolveAtomicPublicationInput): Promise<StoredAtomicPublication> {
  assertGovernance(deps, input.scope);
  assertActor(input.actor, PUBLICATION_RESOLVER_ROLES);
  if (input.decision !== "approve" && input.decision !== "reject") throw new AtomicPublicationError("ATOMIC_PUBLICATION_INPUT_INVALID", ["decision"]);
  const reason = reasonText(input.reason);
  // closed shapes first: a malformed resolution or disposition (a reviewer stamp, an extra key) is refused before any read
  const resolutions = input.decision === "approve" ? normalizeResolutions(input.resolutions) : [];
  const dispositions = input.decision === "approve" ? normalizeDispositions(input.factDispositions) : [];
  const at = now(deps);
  const decidedAt = at.toISOString();
  const stored = await retireIfAuthorityLost(deps, await findRequest(deps, input.scope, input.requestId), decidedAt);
  const { request } = stored;
  if (request.status === "retired") throw new AtomicPublicationError("ATOMIC_PUBLICATION_RETIRED", [request.retirement?.reasonCode ?? "RETIRED"]);
  if (request.status !== "pending") throw new AtomicPublicationError("ATOMIC_PUBLICATION_STATE_CONFLICT", [request.status]);
  const idempotencyKey = callerKey(input.actor, "resolve_request", request.requestId, input.idempotencyKey) ?? `atomic-publication-resolve:${request.requestId}:${stored.revision}`;
  const deciderMembershipRevision = input.membershipRevision ?? null;

  if (input.decision === "reject") {
    const rejected = seal({ ...request, status: "rejected", decision: { decision: "reject", decidedBy: structuredClone(input.actor), decidedAt, reason, deciderMembershipRevision, resolutions: [], factDispositions: [] } });
    return deps.store.put(rejected, { expectedRevision: stored.revision, idempotencyKey, committedAt: decidedAt });
  }

  // the evidence the reviewer approves must be the evidence the request recorded, and still what the server assembles
  if (input.reviewEvidenceDigest !== request.evidence.reviewEvidenceDigest) throw new AtomicPublicationError("ATOMIC_PUBLICATION_EVIDENCE_CHANGED");
  const fresh = await assembleEvidence(deps, request.spec, request.links, request.requestedBy.actorId, request.requestedAt, at);
  if (fresh.evidence.reviewEvidenceDigest !== request.evidence.reviewEvidenceDigest) throw new AtomicPublicationError("ATOMIC_PUBLICATION_EVIDENCE_CHANGED");
  // [B19-E E4 review] a link that can no longer be written (its value was linked since the request) is refused now, not at publish
  if (fresh.linkRefusals.length > 0) throw new AtomicPublicationError("ATOMIC_PUBLICATION_LINK_REFUSED", fresh.linkRefusals);
  const { evidence } = request;
  if (evidence.missing.length > 0) throw new AtomicPublicationError("ATOMIC_PUBLICATION_EVIDENCE_MISSING", [...evidence.missing]);

  if (!resolutions.some((item) => item.property === "manufacturer")) throw new AtomicPublicationError("ATOMIC_PUBLICATION_MANUFACTURER_UNRESOLVED");
  const facts = new Map(evidence.facts.map((fact) => [fact.factId, fact]));
  const required = requiredResolutionProperties(evidence);
  for (const resolution of resolutions) {
    const fact = facts.get(resolution.factId);
    // a non-quarantined engineering candidate from an authority class, never a distributor value or an identity hint
    if (!required.includes(resolution.property) || !resolvableFact(fact, resolution.property)) throw new AtomicPublicationError("ATOMIC_PUBLICATION_RESOLUTION_REFUSED", [resolution.property]);
    // the draft is assembled from the request: publishing another value for a property it is built from needs a new request
    if (DRAFT_BOUND_PROPERTIES[resolution.property] && fact!.value !== draftValue(request.spec, resolution.property)) throw new AtomicPublicationError("ATOMIC_PUBLICATION_RESOLUTION_REFUSED", [resolution.property]);
  }
  const unresolved = required.filter((property) => !resolutions.some((item) => item.property === property));
  if (unresolved.length > 0) throw new AtomicPublicationError("ATOMIC_PUBLICATION_RESOLUTION_REQUIRED", unresolved);

  const quarantined = evidence.facts.filter((fact) => fact.establishes === "quarantined");
  if (dispositions.some((item) => !quarantined.some((fact) => fact.factId === item.factId))) throw new AtomicPublicationError("ATOMIC_PUBLICATION_INPUT_INVALID", ["factDispositions"]);
  const undecided = quarantined.filter((fact) => !dispositions.some((item) => item.factId === fact.factId));
  if (undecided.length > 0) throw new AtomicPublicationError("ATOMIC_PUBLICATION_FACT_UNDISPOSITIONED", undecided.map((fact) => fact.factId));
  // reviewerId and reviewedAt come from the trusted reviewer and the server clock (validation.ts), never from a body
  const factDispositions: AtomicFactDisposition[] = dispositions.map((item) => ({ ...item, reviewerId: input.actor.actorId, reviewedAt: decidedAt }));

  const assembled = await assembleDraft(deps, request, resolutions);
  let approval;
  try {
    const review = submitted(assembled, request);
    approval = evaluateApproval(review, request.profile, assembled.catalog.validationContext(), at);
    if (approval.eligible) assembled.catalog.transition({ revisionId: review.id, to: "approved", actorId: input.actor.actorId, actorRole: catalogRoleOf(input.actor), reason, now: at });
  } catch (error) {
    throw new AtomicPublicationError("ATOMIC_PUBLICATION_APPROVAL_BLOCKED", [error instanceof Error ? error.message.slice(0, 500) : "the draft could not be approved"]);
  }
  if (!approval.eligible) throw new AtomicPublicationError("ATOMIC_PUBLICATION_APPROVAL_BLOCKED", approval.blockers);

  const approved = seal({
    ...request,
    status: "approved",
    decision: {
      decision: "approve", decidedBy: structuredClone(input.actor), decidedAt, reason, deciderMembershipRevision, reviewEvidenceDigest: request.evidence.reviewEvidenceDigest,
      resolutions, factDispositions,
      approval: { profile: request.profile, eligible: true, blockers: [], warnings: approval.warnings, validatorVersion: approval.validatorVersion },
    },
  });
  return deps.store.put(approved, { expectedRevision: stored.revision, idempotencyKey, committedAt: decidedAt });
}

// ── publish ──────────────────────────────────────────────────────────────────

export async function publishAtomicPublicationRequest(deps: AtomicPublicationDeps, input: { scope: AtomicPublicationScope; actor: EngineeringActor; requestId: unknown; reason: unknown; idempotencyKey?: string }): Promise<StoredAtomicPublication> {
  assertGovernance(deps, input.scope);
  assertActor(input.actor, PUBLICATION_PUBLISHER_ROLES);
  const reason = reasonText(input.reason);
  const at = now(deps);
  const publishedAt = at.toISOString();
  let found = await findRequest(deps, input.scope, input.requestId);
  if (found.request.status === "published") return found;

  // [B19-E E4 review] a publication attempt settles first: one that committed is recorded (never re-published, never retired);
  // one inside its lease may still be in flight, so no other publication starts
  const marker = found.request.status === "approved" ? found.request.publishing : undefined;
  if (marker) {
    const outcome = await publicationOutcome(deps, marker.revisionId);
    if (outcome === "committed") return recordPublication(deps, found, { publishedBy: marker.by, publishedAt: marker.at, revisionId: marker.revisionId, auditId: null }, publishedAt);
    // [B19-E E4 review follow-up] an attempt whose outcome cannot be read may have committed: never publish a second revision over it
    if (outcome === "unknown") throw outcomeUnknown();
    if (markerInFlight(marker, at)) throw new AtomicPublicationError("ATOMIC_PUBLICATION_PUBLISH_IN_PROGRESS");
  }
  // [B19-E E4 review] the approval is published only while its requester and its approver still hold their authority
  found = await retireIfAuthorityLost(deps, found, publishedAt, { evenWithMarker: true });
  const { request } = found;
  if (request.status === "retired") throw new AtomicPublicationError("ATOMIC_PUBLICATION_RETIRED", [request.retirement?.reasonCode ?? "RETIRED"]);
  if (request.status === "pending") throw new AtomicPublicationError("ATOMIC_PUBLICATION_NOT_APPROVED");
  if (request.status !== "approved" || !request.decision || request.decision.decision !== "approve") throw new AtomicPublicationError("ATOMIC_PUBLICATION_STATE_CONFLICT", [request.status]);
  const decision = request.decision;
  // OD-37: the publisher is never the approver, an administrator included
  if (catalogActorKey(decision.decidedBy.actorId) === catalogActorKey(input.actor.actorId)) throw new AtomicPublicationError("ATOMIC_PUBLICATION_SAME_PERSON");

  const fresh = await assembleEvidence(deps, request.spec, request.links, request.requestedBy.actorId, request.requestedAt, at);
  if (fresh.evidence.reviewEvidenceDigest !== request.evidence.reviewEvidenceDigest) throw new AtomicPublicationError("ATOMIC_PUBLICATION_EVIDENCE_CHANGED");
  if (fresh.linkRefusals.length > 0) throw new AtomicPublicationError("ATOMIC_PUBLICATION_LINK_REFUSED", fresh.linkRefusals);
  const assembled = await assembleDraft(deps, request, decision.resolutions);
  let snapshot: PortableAtomicSnapshot;
  try {
    const review = submitted(assembled, request);
    const approved = assembled.catalog.transition({ revisionId: review.id, to: "approved", actorId: decision.decidedBy.actorId, actorRole: catalogRoleOf(decision.decidedBy), reason: decision.reason, now: new Date(decision.decidedAt) });
    const published = assembled.catalog.transition({ revisionId: approved.id, to: "published", actorId: input.actor.actorId, actorRole: "publisher", reason, now: at });
    snapshot = assembled.catalog.portableSnapshot(published.id, at);
  } catch (error) {
    throw new AtomicPublicationError("ATOMIC_PUBLICATION_PUBLISH_REFUSED", [error instanceof Error ? error.message.slice(0, 500) : "the revision could not be published"]);
  }

  const revisionId = snapshot.atomicRevision.id;
  // [B19-E E4 review] the marker's key names this attempt's revision: a concurrent publisher who read the same head conflicts
  const marked = await deps.store.put(seal({ ...request, publishing: { by: structuredClone(input.actor), at: publishedAt, revisionId } }), { expectedRevision: found.revision, idempotencyKey: `atomic-publication-publishing:${request.requestId}:${found.revision}:${sha256(revisionId).slice(0, 16)}`, committedAt: publishedAt });
  if (marked.request.publishing?.revisionId !== revisionId) throw new AtomicPublicationError("ATOMIC_PUBLICATION_CONCURRENT_CHANGE");
  let result: { revisionId: string; auditId: string };
  try {
    result = await deps.publish({ snapshot, actorId: input.actor.actorId, actorRole: "publisher", requiredProfile: request.profile, reason, links: request.links });
  } catch (error) {
    // [B19-E E4 review] the answer can be lost after the commit: what the catalog holds decides
    const outcome = await publicationOutcome(deps, revisionId);
    if (outcome === "committed") return recordPublication(deps, marked, { publishedBy: structuredClone(input.actor), publishedAt, revisionId, auditId: null }, publishedAt);
    // [B19-E E4 review follow-up] a status read that failed, or a failure at COMMIT (whose revision may become visible only after
    // this read), cannot rule the publication out: the marker stays, the lease governs, and a later publish or withdrawal re-checks
    if (outcome === "unknown" || publicationCommitOutcomeUnknown(error)) throw outcomeUnknown(error);
    // the transaction rolled back: nothing was written; the marker is cleared so the request is withdrawable at once (a clear
    // that fails leaves the lease to expire), and the cause stays in the server log
    const { publishing: _attempt, ...unmarked } = marked.request;
    void _attempt;
    await deps.store.put(seal(unmarked), { expectedRevision: marked.revision, idempotencyKey: `atomic-publication-publish-failed:${request.requestId}:${marked.revision}`, committedAt: publishedAt }).catch(() => undefined);
    throw Object.assign(new AtomicPublicationError("ATOMIC_PUBLICATION_PUBLISH_REFUSED", publishRefusalDetail(error)), { cause: error });
  }
  return recordPublication(deps, marked, { publishedBy: structuredClone(input.actor), publishedAt, revisionId: result.revisionId, auditId: result.auditId }, publishedAt, callerKey(input.actor, "publish_request", request.requestId, input.idempotencyKey));
}

// ── withdraw ─────────────────────────────────────────────────────────────────

export async function withdrawAtomicPublicationRequest(deps: AtomicPublicationDeps, input: { scope: AtomicPublicationScope; actor: EngineeringActor; requestId: unknown; reason: unknown; idempotencyKey?: string }): Promise<StoredAtomicPublication> {
  assertGovernance(deps, input.scope);
  assertActor(input.actor, PUBLICATION_REQUESTER_ROLES);
  const reason = reasonText(input.reason, "withdrawn by the requester");
  const at = now(deps);
  const withdrawnAt = at.toISOString();
  const stored = await findRequest(deps, input.scope, input.requestId);
  // only the person who asked may withdraw the request (an administrator is not exempt)
  if (catalogActorKey(stored.request.requestedBy.actorId) !== catalogActorKey(input.actor.actorId)) throw new AtomicPublicationError("ATOMIC_PUBLICATION_FORBIDDEN");
  if (stored.request.status !== "pending" && stored.request.status !== "approved") throw new AtomicPublicationError("ATOMIC_PUBLICATION_STATE_CONFLICT", [stored.request.status]);
  const { publishing } = stored.request;
  if (publishing) {
    // a publication attempt that committed is recorded, and the request can no longer be withdrawn
    const outcome = await publicationOutcome(deps, publishing.revisionId);
    if (outcome === "committed") {
      await recordPublication(deps, stored, { publishedBy: publishing.by, publishedAt: publishing.at, revisionId: publishing.revisionId, auditId: null }, withdrawnAt);
      throw new AtomicPublicationError("ATOMIC_PUBLICATION_STATE_CONFLICT", ["published"]);
    }
    // [B19-E E4 review follow-up] an attempt whose outcome cannot be read may have committed: withdrawing now could orphan it
    if (outcome === "unknown") throw outcomeUnknown();
    // [B19-E E4 review] an attempt inside its lease may still be in flight (its uncommitted rows are invisible): never withdrawn
    // under it; a failed attempt clears its own marker
    if (markerInFlight(publishing, at)) throw new AtomicPublicationError("ATOMIC_PUBLICATION_PUBLISH_IN_PROGRESS");
  }
  const withdrawn = seal({ ...stored.request, status: "withdrawn", withdrawal: { withdrawnBy: structuredClone(input.actor), withdrawnAt, reason } });
  return deps.store.put(withdrawn, { expectedRevision: stored.revision, idempotencyKey: callerKey(input.actor, "withdraw_request", stored.request.requestId, input.idempotencyKey) ?? `atomic-publication-withdraw:${stored.request.requestId}:${stored.revision}`, committedAt: withdrawnAt });
}
