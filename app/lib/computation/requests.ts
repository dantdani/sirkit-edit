/**
 * [B22-B] The process-backed computations as inert sealed REQUESTS a human approves (runbook B22-B :918-920; OD-139, OD-149). A
 * request is plain, frozen, digest-pinned data: the kind, the closed input (validated against the catalog), the profile, the output
 * validator and the budget, the server-derived scope and the requester. Sealing runs nothing. The store holds it as
 * `awaiting_approval` until a HUMAN with an approving role in the request's own scope approves its exact digest; the AI cannot
 * approve (an agent approver is refused) and cannot consume (consumption takes the server's executors, which no agent path holds,
 * and an approved record only). A request is consumed once and expires unapproved. Its result is diagnostic EVIDENCE, never
 * engineering authority.
 *
 * B22-B builds the contract and its executors; it adds no route, so no production surface approves a request yet and the two
 * process-backed descriptors stay dormant (catalog.ts). The store is in memory (a later increment persists it with the evidence
 * aggregate, OD-141).
 */
import { durableWorkflowDigest } from "../durable-workflow/stable";
import type { ProjectRole } from "../engineering/types";
import { computationKind, validateComputationInput, type ComputationBudget } from "./catalog";

export const COMPUTATION_REQUEST_SCHEMA = "sirkit.computation-request.v1" as const;
export const COMPUTATION_EVIDENCE_SCHEMA = "sirkit.computation-evidence.v1" as const;
/** An unapproved request expires after this long; an approved one must be consumed before the same deadline. */
export const COMPUTATION_REQUEST_TTL_MS = 15 * 60_000;
/** The roles that may approve a process-backed computation request (a human editor, reviewer or project administrator). */
export const COMPUTATION_APPROVER_ROLES: readonly ProjectRole[] = Object.freeze(["pcb_editor", "reviewer", "project_admin"]);
export const COMPUTATION_EVIDENCE_LABELS = Object.freeze(["diagnostic_only", "environment_dependent"] as const);
export const COMPUTATION_EVIDENCE_AUTHORITY = "diagnostic evidence - never engineering authority" as const;

export interface ComputationScope { readonly tenantId: string; readonly projectId: string; readonly branchId: string }
export interface ComputationRequester { readonly actorId: string; readonly actorKind: "human" | "agent" }
/** Who approves: the SERVER-verified principal of the approving request (never a body claim). */
export interface ComputationRequestActor { readonly actorId: string; readonly actorKind: "human" | "agent"; readonly role: ProjectRole; readonly scope: ComputationScope }

export interface SealedComputationRequest {
  readonly schema: typeof COMPUTATION_REQUEST_SCHEMA;
  readonly requestId: string;
  readonly kindId: string;
  readonly kindVersion: string;
  readonly input: Readonly<Record<string, string | number>>;
  readonly profileId: string;
  readonly outputValidatorId: string;
  readonly budget: ComputationBudget;
  readonly scope: ComputationScope;
  /** The server-held state the request was sealed against (the canonical revision digest for a layout experiment; null otherwise). */
  readonly basis: { readonly canonicalRevisionDigest: string | null };
  readonly requestedBy: ComputationRequester;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly requestDigest: string;
}

export interface ComputationEvidence {
  readonly schema: typeof COMPUTATION_EVIDENCE_SCHEMA;
  readonly requestId: string;
  readonly requestDigest: string;
  readonly kindId: string;
  readonly profileId: string;
  readonly labels: typeof COMPUTATION_EVIDENCE_LABELS;
  readonly authoritative: false;
  readonly authority: typeof COMPUTATION_EVIDENCE_AUTHORITY;
  /** The diagnostic runner's outcome (`exited`, `timeout`, ...), or `refused` when nothing ran. */
  readonly outcome: string;
  readonly refusal: string | null;
  /** The parsed result, validated by the kind's output validator; null when there is none. */
  readonly result: Record<string, unknown> | null;
  readonly provenance: Record<string, unknown> | null;
  readonly evidenceDigest: string;
}

export type ComputationRequestExecutor = (request: SealedComputationRequest, signal?: AbortSignal) => Promise<ComputationEvidence>;
/** The server's executors, one per process-backed kind (request-executors.ts). Only the server composition holds them. */
export type ComputationRequestExecutors = Readonly<Partial<Record<string, ComputationRequestExecutor>>>;

const ID_TEXT = /^[A-Za-z0-9._:@-]{1,200}$/;
const NONCE = /^[0-9a-f]{32}$/;
const REQUEST_KEYS = ["schema", "requestId", "kindId", "kindVersion", "input", "profileId", "outputValidatorId", "budget", "scope", "basis", "requestedBy", "createdAt", "expiresAt", "requestDigest"] as const;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
const scopeIssues = (scope: unknown): string[] => {
  const value = scope as Partial<ComputationScope> | null;
  return value && typeof value === "object" && ["tenantId", "projectId", "branchId"].every((key) => typeof (value as Record<string, unknown>)[key] === "string" && ID_TEXT.test((value as Record<string, string>)[key]!)) && Object.keys(value).length === 3 ? [] : ["the scope is three server-derived ids"];
};
const sameScope = (a: ComputationScope, b: ComputationScope): boolean => a.tenantId === b.tenantId && a.projectId === b.projectId && a.branchId === b.branchId;
const digestOf = (request: Omit<SealedComputationRequest, "requestDigest">): string => durableWorkflowDigest(request);

/** Seal a process-backed computation request. Runs nothing; refuses a process-free or unknown kind and any input the catalog refuses. */
export function sealComputationRequest(input: { kindId: string; args: unknown; scope: ComputationScope; requestedBy: ComputationRequester; now: number; nonce: string; basis?: { canonicalRevisionDigest: string | null } }): { ok: true; request: SealedComputationRequest } | { ok: false; errors: string[] } {
  const kind = computationKind(input.kindId);
  if (!kind) return { ok: false, errors: ["unknown computation kind"] };
  if (kind.backing !== "process-backed" || kind.profileId === null) return { ok: false, errors: ["only a process-backed computation is sealed as a request; a process-free one is a read"] };
  const checked = validateComputationInput(kind.id, input.args);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const errors = [...scopeIssues(input.scope)];
  if (!input.requestedBy || typeof input.requestedBy.actorId !== "string" || !ID_TEXT.test(input.requestedBy.actorId) || (input.requestedBy.actorKind !== "human" && input.requestedBy.actorKind !== "agent")) errors.push("the requester is a server-derived actor");
  if (typeof input.nonce !== "string" || !NONCE.test(input.nonce)) errors.push("the nonce is 32 hex characters");
  if (!Number.isSafeInteger(input.now) || input.now <= 0) errors.push("the time is a server clock reading");
  const revision = input.basis?.canonicalRevisionDigest ?? null;
  if (revision !== null && (typeof revision !== "string" || !/^eng1-[0-9a-f]{16}$/.test(revision))) errors.push("the basis is a canonical revision digest");
  if (errors.length > 0) return { ok: false, errors };
  const scope = { tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId };
  const createdAt = new Date(input.now).toISOString();
  const body: Omit<SealedComputationRequest, "requestDigest"> = {
    schema: COMPUTATION_REQUEST_SCHEMA,
    requestId: `computation-request:${durableWorkflowDigest({ kindId: kind.id, nonce: input.nonce, scope, createdAt }).slice(4, 36)}`,
    kindId: kind.id,
    kindVersion: kind.version,
    input: { ...checked.input },
    profileId: kind.profileId,
    outputValidatorId: kind.outputValidatorId,
    budget: { ...kind.budget },
    scope,
    basis: { canonicalRevisionDigest: revision },
    requestedBy: { actorId: input.requestedBy.actorId, actorKind: input.requestedBy.actorKind },
    createdAt,
    expiresAt: new Date(input.now + COMPUTATION_REQUEST_TTL_MS).toISOString(),
  };
  return { ok: true, request: deepFreeze({ ...body, requestDigest: digestOf(body) }) };
}

/** Why a value is not an intact sealed request of the catalog (empty: it is). Recomputes the digest; never throws. */
export function verifySealedComputationRequest(value: unknown): string[] {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return ["not a request"];
    const request = value as SealedComputationRequest;
    const keys = Object.keys(request);
    if (keys.length !== REQUEST_KEYS.length || !REQUEST_KEYS.every((key) => keys.includes(key))) return ["the request's keys are not the closed set"];
    const kind = computationKind(request.kindId);
    if (request.schema !== COMPUTATION_REQUEST_SCHEMA || !kind || kind.backing !== "process-backed") return ["not a process-backed computation request"];
    const issues: string[] = [];
    if (request.kindVersion !== kind.version || request.profileId !== kind.profileId || request.outputValidatorId !== kind.outputValidatorId || durableWorkflowDigest(request.budget) !== durableWorkflowDigest(kind.budget)) issues.push("the request disagrees with its kind's profile, validator or budget");
    const checked = validateComputationInput(kind.id, request.input);
    if (!checked.ok || durableWorkflowDigest(checked.input) !== durableWorkflowDigest(request.input)) issues.push("the input is not the catalog's closed input");
    issues.push(...scopeIssues(request.scope));
    const { requestDigest, ...body } = request;
    if (typeof requestDigest !== "string" || digestOf(body) !== requestDigest) issues.push("the request digest does not match its content");
    return issues;
  } catch {
    return ["the request cannot be read"];
  }
}

export type ComputationRequestState = "awaiting_approval" | "approved" | "consumed" | "expired";
type Refusal<C extends string> = { ok: false; code: C };

/** The in-memory request store: submit, approve (a human, once), consume (the server's executors, once). */
export class ComputationRequestStore {
  private readonly records = new Map<string, { request: SealedComputationRequest; state: "awaiting_approval" | "approved" | "consumed"; approvedBy: { actorId: string; role: ProjectRole } | null }>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  private expired(request: SealedComputationRequest): boolean {
    return this.now() >= Date.parse(request.expiresAt);
  }

  submit(request: SealedComputationRequest): { ok: true } | Refusal<"digest_mismatch" | "duplicate"> {
    if (verifySealedComputationRequest(request).length > 0) return { ok: false, code: "digest_mismatch" };
    if (this.records.has(request.requestId)) return { ok: false, code: "duplicate" };
    this.records.set(request.requestId, { request, state: "awaiting_approval", approvedBy: null });
    return { ok: true };
  }

  state(requestId: string): ComputationRequestState | null {
    const record = this.records.get(requestId);
    if (!record) return null;
    return record.state !== "consumed" && this.expired(record.request) ? "expired" : record.state;
  }

  /** A HUMAN with an approving role in the request's own scope approves its exact digest, once. */
  approve(input: { requestId: string; requestDigest: string; approver: ComputationRequestActor }): { ok: true } | Refusal<"not_found" | "expired" | "not_awaiting_approval" | "approver_not_human" | "role_not_permitted" | "scope_mismatch" | "digest_mismatch"> {
    const record = this.records.get(input.requestId);
    if (!record) return { ok: false, code: "not_found" };
    if (record.state !== "consumed" && this.expired(record.request)) return { ok: false, code: "expired" };
    if (record.state !== "awaiting_approval") return { ok: false, code: "not_awaiting_approval" };
    const approver = input.approver;
    if (!approver || approver.actorKind !== "human") return { ok: false, code: "approver_not_human" };
    if (!COMPUTATION_APPROVER_ROLES.includes(approver.role)) return { ok: false, code: "role_not_permitted" };
    if (scopeIssues(approver.scope).length > 0 || !sameScope(approver.scope, record.request.scope)) return { ok: false, code: "scope_mismatch" };
    if (input.requestDigest !== record.request.requestDigest) return { ok: false, code: "digest_mismatch" };
    record.state = "approved";
    record.approvedBy = { actorId: approver.actorId, role: approver.role };
    return { ok: true };
  }

  /** The server consumes an approved request ONCE with its executors; the record is consumed before the executor runs. */
  async consume(requestId: string, executors: ComputationRequestExecutors, signal?: AbortSignal): Promise<{ ok: true; evidence: ComputationEvidence } | Refusal<"not_found" | "expired" | "already_consumed" | "not_approved" | "executor_missing">> {
    const record = this.records.get(requestId);
    if (!record) return { ok: false, code: "not_found" };
    if (record.state === "consumed") return { ok: false, code: "already_consumed" };
    if (this.expired(record.request)) return { ok: false, code: "expired" };
    if (record.state !== "approved") return { ok: false, code: "not_approved" };
    const executor = Object.hasOwn(executors, record.request.kindId) ? executors[record.request.kindId] : undefined;
    if (typeof executor !== "function") return { ok: false, code: "executor_missing" };
    record.state = "consumed";
    try {
      return { ok: true, evidence: await executor(record.request, signal) };
    } catch {
      return { ok: true, evidence: computationEvidence(record.request, { outcome: "refused", refusal: "EXECUTOR_FAILED", result: null, provenance: null }) };
    }
  }
}

/** The labelled, digest-pinned evidence record for a consumed request. */
export function computationEvidence(request: SealedComputationRequest, fields: { outcome: string; refusal: string | null; result: Record<string, unknown> | null; provenance: Record<string, unknown> | null }): ComputationEvidence {
  const body = {
    schema: COMPUTATION_EVIDENCE_SCHEMA,
    requestId: request.requestId,
    requestDigest: request.requestDigest,
    kindId: request.kindId,
    profileId: request.profileId,
    labels: COMPUTATION_EVIDENCE_LABELS,
    authoritative: false as const,
    authority: COMPUTATION_EVIDENCE_AUTHORITY,
    outcome: fields.outcome,
    refusal: fields.refusal,
    result: fields.result,
    provenance: fields.provenance,
  };
  return deepFreeze({ ...body, evidenceDigest: durableWorkflowDigest(body) });
}
