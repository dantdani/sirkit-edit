/**
 * [B19-E E4] The atomic publication review route's handlers, callable with a trusted context (the route composes them).
 *
 * Nothing is read before the caller is authorized for the operation: the canonical wrapper has already checked identity,
 * membership, the policy row's roles, exact-origin CSRF, the bounded body and the forbidden authority keys; here the catalog
 * governance scope (OD-37: `SIRKIT_ATOMIC_CATALOG_TENANT_ID` and `SIRKIT_ATOMIC_CATALOG_PROJECT_ID`, either unset refuses
 * everything), a human actor, the operation, its
 * own roles and the body's closed top-level keys are checked before the review's stores are composed. Nested shapes are closed
 * by the review's normalizers before any store is read.
 */
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import { DEFAULT_BRANCH_ID } from "@/app/lib/auth/trusted-request-context";
import type { EngineeringActor, ProjectRole } from "@/app/lib/engineering/types";
import {
  AtomicPublicationError,
  atomicCatalogGovernanceProjectId,
  atomicCatalogGovernanceTenantId,
  atomicPublicationViewer,
  isHumanPublicationActor,
  listAtomicPublicationRequests,
  publishAtomicPublicationRequest,
  PUBLICATION_PUBLISHER_ROLES,
  PUBLICATION_REQUESTER_ROLES,
  PUBLISH_MARKER_LEASE_MS,
  PUBLICATION_RESOLVER_ROLES,
  resolveAtomicPublicationRequest,
  submitAtomicPublicationRequest,
  withdrawAtomicPublicationRequest,
  type AtomicPublicationDeps,
  type AtomicPublicationErrorCode,
  type StoredAtomicPublication,
} from "@/app/lib/atomic/publication-review";
import { ATOMIC_PUBLICATION_OPERATIONS, type AtomicPublicationOperation, type AtomicPublicationStatus } from "@/app/lib/atomic/publication-review-contract";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const FAILURE_MESSAGE = "The publication review could not be completed. Try again; if it persists, the server log has the details.";
const IDEMPOTENCY_KEY = /^[A-Za-z0-9:._-]{1,128}$/;
const STATUSES: ReadonlySet<string> = new Set(["pending", "approved", "published", "rejected", "withdrawn", "retired"]);

const OPERATION_ROLES: Readonly<Record<AtomicPublicationOperation, ReadonlySet<ProjectRole>>> = Object.freeze({
  submit_request: PUBLICATION_REQUESTER_ROLES,
  withdraw_request: PUBLICATION_REQUESTER_ROLES,
  resolve_request: PUBLICATION_RESOLVER_ROLES,
  publish_request: PUBLICATION_PUBLISHER_ROLES,
});

const OPERATION_KEYS: Readonly<Record<AtomicPublicationOperation, readonly string[]>> = Object.freeze({
  submit_request: ["operation", "exactMpn", "profile", "symbol", "footprint", "terminals", "package", "datasheet", "manufacturer", "links", "reason", "idempotencyKey"],
  resolve_request: ["operation", "requestId", "decision", "reason", "reviewEvidenceDigest", "resolutions", "factDispositions", "idempotencyKey"],
  publish_request: ["operation", "requestId", "reason", "idempotencyKey"],
  withdraw_request: ["operation", "requestId", "reason", "idempotencyKey"],
});

const MESSAGE_TABLE = Object.freeze({
  ATOMIC_PUBLICATION_GOVERNANCE_UNCONFIGURED: "Atomic catalog publication is not configured on this server; every publication operation is refused.",
  ATOMIC_PUBLICATION_GOVERNANCE_FORBIDDEN: "Atomic catalog publication happens only in the catalog governance project, on its default branch.",
  ATOMIC_PUBLICATION_HUMAN_REQUIRED: "Only a person can request, review, publish or withdraw an atomic revision.",
  ATOMIC_PUBLICATION_FORBIDDEN: "Your role does not permit this publication operation.",
  ATOMIC_PUBLICATION_SAME_PERSON: "The person who approved a request cannot publish it.",
  ATOMIC_PUBLICATION_OPERATION_UNSUPPORTED: "Unsupported publication operation.",
  ATOMIC_PUBLICATION_INPUT_INVALID: "The request body is malformed.",
  ATOMIC_PUBLICATION_NOT_FOUND: "The publication request was not found.",
  ATOMIC_PUBLICATION_STATE_CONFLICT: "The publication request is not in a state that allows this.",
  ATOMIC_PUBLICATION_NOT_APPROVED: "The publication request has not been approved.",
  ATOMIC_PUBLICATION_RETIRED: "The publication request was retired: its requester or its approver lost authority.",
  ATOMIC_PUBLICATION_REQUEST_OPEN: "A publication request for this exact part and profile is already open with different evidence; withdraw it before asking again.",
  ATOMIC_PUBLICATION_LINK_REFUSED: "A catalog part link cannot be written: the part must exist, name this exact MPN, use the draft's KiCad symbol, and have no link for that value yet.",
  ATOMIC_PUBLICATION_PUBLISH_IN_PROGRESS: "A publication of this request may still be in progress; try again in a few minutes.",
  ATOMIC_PUBLICATION_EVIDENCE_CHANGED: "The evidence changed since the request was made; review it again.",
  ATOMIC_PUBLICATION_EVIDENCE_MISSING: "Evidence the approval profile needs is missing.",
  ATOMIC_PUBLICATION_MANUFACTURER_UNRESOLVED: "The manufacturer must be resolved from an engineering-authority source.",
  ATOMIC_PUBLICATION_RESOLUTION_REQUIRED: "Every identity and engineering conflict must be resolved.",
  ATOMIC_PUBLICATION_RESOLUTION_REFUSED: "A resolution must pick the draft's value from an engineering-authority source; quarantined, distributor and hint values cannot be chosen.",
  ATOMIC_PUBLICATION_FACT_UNDISPOSITIONED: "Every quarantined fact must be rejected or marked reviewed.",
  ATOMIC_PUBLICATION_APPROVAL_BLOCKED: "The assembled revision is not eligible for approval.",
  ATOMIC_PUBLICATION_PUBLISH_REFUSED: "The revision could not be published; nothing was written.",
  ATOMIC_PUBLICATION_CONCURRENT_CHANGE: "The publication request changed at the same time; refresh and try again.",
  // [B19-E E4 review follow-up]
  ATOMIC_PUBLICATION_REQUEST_REPLACED: "The revision was published to the catalog, but its request had been withdrawn and replaced by a new request for the same part; the new request was not changed. The detail names the published request, then the new one.",
  ATOMIC_PUBLICATION_PUBLISH_OUTCOME_UNKNOWN: `Whether the publication committed could not be confirmed, so the request is held until its revision status can be read. Try again after ${PUBLISH_MARKER_LEASE_MS / 60_000} minutes: once the status can be read, a revision that committed is recorded, and none is published twice.`,
});

// [B19-E E4 review follow-up] every refusal code the aggregate can raise has a message: a missing one fails the type check
const EVERY_CODE_HAS_A_MESSAGE: [Exclude<AtomicPublicationErrorCode, keyof typeof MESSAGE_TABLE>] extends [never] ? true : false = true;
void EVERY_CODE_HAS_A_MESSAGE;
export const ATOMIC_PUBLICATION_MESSAGES: Readonly<Record<AtomicPublicationErrorCode, string>> & Readonly<Record<string, string>> = MESSAGE_TABLE;
const MESSAGES: Readonly<Record<string, string>> = MESSAGE_TABLE;

export interface AtomicPublicationRouteDeps {
  env: Readonly<Record<string, string | undefined>>;
  /** Composed only after authorization. */
  review(): AtomicPublicationDeps;
}

function refusal(code: string, status: number, detail: readonly string[] = []): Response {
  return Response.json({ ok: false, code, error: MESSAGES[code] ?? code, ...(detail.length > 0 ? { detail: detail.slice(0, 50) } : {}) }, { status, headers: NO_STORE });
}

function failure(error: unknown): Response {
  if (error instanceof AtomicPublicationError) return refusal(error.code, error.status, error.detail);
  console.error(`[api/components/atomic/publication] failed: ${error instanceof Error ? error.name : "non-error rejection"}`);
  return Response.json({ ok: false, error: FAILURE_MESSAGE }, { status: 500, headers: NO_STORE });
}

function view(stored: StoredAtomicPublication) {
  return { ...stored.request, revision: stored.revision };
}

function scopeOf(context: TrustedRequestContext) {
  return { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId };
}

/** The governance project and a human actor, before anything else (nothing is composed or read). */
function gate(context: TrustedRequestContext, env: AtomicPublicationRouteDeps["env"], requireHuman: boolean): Response | null {
  const governance = atomicCatalogGovernanceProjectId(env);
  // [B19-E E4 review] gates-1: the governance scope is a tenant AND a project (the catalog is shared by every tenant)
  const tenant = atomicCatalogGovernanceTenantId(env);
  if (!governance || !tenant) return refusal("ATOMIC_PUBLICATION_GOVERNANCE_UNCONFIGURED", 403);
  if (context.tenantId !== tenant || context.projectId !== governance || context.branchId !== DEFAULT_BRANCH_ID) return refusal("ATOMIC_PUBLICATION_GOVERNANCE_FORBIDDEN", 403);
  if (requireHuman && !isHumanPublicationActor(context.actor)) return refusal("ATOMIC_PUBLICATION_HUMAN_REQUIRED", 403);
  return null;
}

export async function handleAtomicPublicationGet(input: { context: TrustedRequestContext; query: Readonly<Record<string, string>> }, deps: AtomicPublicationRouteDeps): Promise<Response> {
  const refused = gate(input.context, deps.env, false);
  if (refused) return refused;
  const status = input.query.status;
  if (status !== undefined && !STATUSES.has(status)) return refusal("ATOMIC_PUBLICATION_INPUT_INVALID", 400, ["status"]);
  try {
    const { requests, membershipVerified } = await listAtomicPublicationRequests(deps.review(), { scope: scopeOf(input.context), ...(status ? { status: status as AtomicPublicationStatus } : {}) });
    return Response.json({ ok: true, viewer: atomicPublicationViewer(input.context.actor), membershipVerified, requests: requests.map((item) => ({ ...view(item), effectiveStatus: item.effectiveStatus })) }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function handleAtomicPublicationPost(input: { context: TrustedRequestContext; body: Record<string, unknown> }, deps: AtomicPublicationRouteDeps): Promise<Response> {
  const { context, body } = input;
  const refused = gate(context, deps.env, true);
  if (refused) return refused;
  const operation = body.operation;
  if (typeof operation !== "string" || !(ATOMIC_PUBLICATION_OPERATIONS as readonly string[]).includes(operation)) return refusal("ATOMIC_PUBLICATION_OPERATION_UNSUPPORTED", 400);
  const op = operation as AtomicPublicationOperation;
  const actor: EngineeringActor = context.actor;
  if (!OPERATION_ROLES[op].has(actor.role)) return refusal("ATOMIC_PUBLICATION_FORBIDDEN", 403);
  const undeclared = Object.keys(body).filter((key) => !OPERATION_KEYS[op].includes(key));
  if (undeclared.length > 0) return refusal("ATOMIC_PUBLICATION_INPUT_INVALID", 400, ["undeclared field"]);
  if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(body.idempotencyKey))) return refusal("ATOMIC_PUBLICATION_INPUT_INVALID", 400, ["idempotencyKey"]);
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined;
  const scope = scopeOf(context);

  try {
    // a reviewer stamp, a source class or asset bytes anywhere in a nested shape refuse the request with 400
    if (op === "submit_request") {
      const spec = { exactMpn: body.exactMpn, profile: body.profile, symbol: body.symbol, footprint: body.footprint, terminals: body.terminals, package: body.package, datasheet: body.datasheet, manufacturer: body.manufacturer };
      const { stored, created } = await submitAtomicPublicationRequest(deps.review(), { scope, actor, membershipRevision: context.membershipRevision ?? null, spec: Object.fromEntries(Object.entries(spec).filter(([, value]) => value !== undefined)), links: body.links, reason: body.reason, ...(idempotencyKey ? { idempotencyKey } : {}) });
      return Response.json({ ok: true, created, request: view(stored) }, { status: created ? 201 : 200, headers: NO_STORE });
    }
    if (op === "resolve_request") {
      if (body.decision !== "approve" && body.decision !== "reject") return refusal("ATOMIC_PUBLICATION_INPUT_INVALID", 400, ["decision"]);
      const stored = await resolveAtomicPublicationRequest(deps.review(), { scope, actor, membershipRevision: context.membershipRevision ?? null, requestId: body.requestId, decision: body.decision, reason: body.reason, reviewEvidenceDigest: body.reviewEvidenceDigest, resolutions: body.resolutions, factDispositions: body.factDispositions, ...(idempotencyKey ? { idempotencyKey } : {}) });
      return Response.json({ ok: true, request: view(stored) }, { headers: NO_STORE });
    }
    if (op === "publish_request") {
      const stored = await publishAtomicPublicationRequest(deps.review(), { scope, actor, requestId: body.requestId, reason: body.reason, ...(idempotencyKey ? { idempotencyKey } : {}) });
      return Response.json({ ok: true, request: view(stored) }, { headers: NO_STORE });
    }
    const stored = await withdrawAtomicPublicationRequest(deps.review(), { scope, actor, requestId: body.requestId, reason: body.reason, ...(idempotencyKey ? { idempotencyKey } : {}) });
    return Response.json({ ok: true, request: view(stored) }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}
