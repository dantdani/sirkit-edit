/**
 * B12/B12.1 — the shared APPROVED agent-mutation execution service.
 *
 * The one production path by which an agent-originated, sealed Tier-1
 * schematic proposal crosses the explicit human-approval boundary into
 * exactly one verified canonical transaction that the editor VISIBLY adopts.
 *
 * AUTHORITY MODEL (unchanged from B06.1/B09.1/B12, enforced in one place):
 *
 *  - The MODEL's boundary is the sealed proposal. Receiving one mutates
 *    nothing; the provider-facing gateway executes only read/propose classes
 *    and cannot call `schematic.edit-tier1-apply`.
 *  - The MUTATION AUTHORITY is the independent human action: only the
 *    interactive composition root holds a live trusted
 *    `SchematicEditorSession` and the page's `SchematicGestureCoordinator`,
 *    and only it may call this service. This module deliberately imports
 *    neither the interactive channel nor its factory, and never mints trust.
 *  - This service NEVER approves anything itself: it authenticates the exact
 *    sealed artifact the human approved, executes it once through the SAME
 *    serialized canonical interaction path ordinary editor commands use, and
 *    proves the result.
 *
 * B12.1 corrections over B12:
 *
 *  §A ONE CANONICAL APPLY PATH — execution flows through an injected
 *    `ApprovedApplyExecutionGateway` (structurally, the production
 *    `SchematicGestureCoordinator.runCanonicalCommand`): verification runs
 *    against the authoritative base and live head AT THE SERIALIZED
 *    EXECUTION POSITION (never a pre-queue React snapshot), a committed
 *    result is adopted through exactly one canonical projection update and
 *    exactly one real SchematicHistory entry (the coordinator host's
 *    applier), and receipt consumption / committed-verified audit happen
 *    ONLY after that production adoption path succeeds. A durable commit
 *    whose adoption cannot be verified POISONS the identity.
 *
 *  §B PROJECT-LIFECYCLE INTERLOCK — the apply acquires a commit/adoption
 *    lease (`ProjectCommitInterlock`) at the execution position: if
 *    retirement began first the apply cancels with ZERO durable
 *    transaction; if the lease is held first, retirement waits for the
 *    critical section to settle.
 *
 *  §C SEALED ARTIFACT IDENTITY — bounded capture → structural validation →
 *    independent sealed-body integrity verification → identity derived from
 *    the COMPLETE verified sealed body → only then the atomic one-shot
 *    claim/consumed lookup. An altered/malformed/foreign body can never
 *    inherit another artifact's consumed status or receipt; exact replay of
 *    the same intact consumed artifact returns the original receipt.
 *
 *  §D RECEIPT VALIDATION — capture-first (own-property plain JSON, bounded
 *    traversal), exact closed key set, and `receiptId` RECOMPUTED from the
 *    captured receipt body with the exact production digest schema. The
 *    digest provides CONTENT INTEGRITY, not authentication: receipt
 *    authority comes from the trusted execution/adoption service and the
 *    durable canonical transaction it references.
 */

import type { SchematicState } from "@/lib/schematic-types";
import { capturePlainJson } from "../agent/plain-capture";
import { schematicStateDigest, validateSchematicStateIntegrity } from "./schematic-model";
import type { CanonicalCommandGateOutcome } from "./schematic-gesture-coordinator";
import {
  isWellFormedProposalScope,
  verifySealedTier1Proposal,
  verifySealedTier1ProposalIntegrity,
  TIER1_PROPOSAL_SCHEMA,
  TIER1_PROPOSAL_SCHEMA_V1,
  TIER1_PROPOSAL_SCHEMA_V2,
  type SealedTier1Proposal,
  type Tier1ProposalHeadMark,
} from "./schematic-proposals";
import { SCHEMATIC_APPLY_ROLES } from "./proposal-authorization";
import {
  evaluateMembershipReauthorization,
  type MembershipReauthorization,
  type MembershipReauthorizer,
} from "../project/membership-reauthorization";
import type { SchematicCommandResult, SchematicEditorSession } from "./schematic-session";
import { ProjectCommitInterlock, type CommitLease } from "./project-commit-interlock";
import { ApprovedMutationJournal, type ApprovedMutationJournalEntry } from "./approved-mutation-journal";
import { engineeringDigest } from "./stable";
import type { EngineeringOperation } from "./types";

/** The ONE canonical command this service may ever submit. */
export const APPROVED_TIER1_COMMAND_ID = "schematic.edit-tier1-apply" as const;

/** The label of the single SchematicHistory entry an adopted apply records. */
export const APPROVED_TIER1_APPLY_LABEL = "Applied AI edit proposal" as const;

// ─── §B: the versioned execution receipt ─────────────────────────────────────

/** [B16.0.1 §E] V2 adds the sealed authorization identity (verified principal
 *  + membership revision) to the receipt body, its content-integrity digest,
 *  and the chain-protected receipt commitment. A LEGACY V1 receipt never
 *  validates and is never adopted — recovery cannot adopt a receipt under
 *  another (or an unproven) principal/membership revision. */
export const APPROVED_MUTATION_RECEIPT_SCHEMA = "sirkit.approved-agent-mutation-receipt.v2" as const;
const RECEIPT_ID_DIGEST_SCHEMA = "sirkit.approved-mutation-receipt-id.v2" as const;

/** Bounded plain-JSON proof of one verified, ADOPTED canonical commit.
 *  Contains ONLY safe metadata — never schematics, boards, prompts, provider
 *  bodies, tool arguments, credentials, or unrestricted error strings. */
export interface ApprovedMutationReceipt {
  schema: typeof APPROVED_MUTATION_RECEIPT_SCHEMA;
  receiptId: string;
  proposalId: string;
  operationsDigest: string;
  /** Originating agent run/trace identity when available — stored OUTSIDE the
   *  sealed proposal and OUTSIDE the finalized run trace (B12 §E). */
  originRunId: string | null;
  /** [B16.0.1 §E] the sealed authorization identity the apply was authorized
   *  under — populated from the durable journal entry, which recorded the
   *  proposal's sealed binding BEFORE the canonical commit. Bound into the
   *  receipt's content-integrity digest AND the chain-protected receipt
   *  commitment, so recovery can never adopt a receipt under another
   *  principal or membership revision. */
  authorization: { principalId: string; membershipRevision: string };
  commandId: typeof APPROVED_TIER1_COMMAND_ID;
  tenantId: string;
  projectId: string;
  branchId: string;
  lineageId: string;
  headBefore: { headSequence: number; canonicalStateDigest: string };
  headAfter: { headSequence: number; canonicalStateDigest: string };
  schematicDigestBefore: string;
  schematicDigestAfter: string;
  transactionId: string;
  operationCount: number;
  destructive: boolean;
  postconditions: "verified";
  /** Undo/replay reference: the canonical transaction the session's history
   *  reconciles against. */
  undoReference: { kind: "canonical-transaction"; transactionId: string };
  /** Deterministic, test-injectable completion time. */
  completedAt: number;
}

const RECEIPT_ID_PATTERN = /^amr-[0-9a-f]{16,64}$/;
const DIGEST_PATTERN = /^eng1-[0-9a-f]{8,64}$/;
const PROPOSAL_ID_PATTERN = /^prop-[0-9a-f]{8,64}$/;
const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RECEIPT_KEYS = [
  "schema", "receiptId", "proposalId", "operationsDigest", "originRunId", "authorization", "commandId",
  "tenantId", "projectId", "branchId", "lineageId", "headBefore", "headAfter",
  "schematicDigestBefore", "schematicDigestAfter", "transactionId", "operationCount",
  "destructive", "postconditions", "undoReference", "completedAt",
] as const;

/** [B16.0.1 §E] exact-keys, bounded authorization identity {principalId,
 *  membershipRevision} — shared by receipt validation and linkage checks. */
function isAuthorizationIdentityShaped(value: unknown): value is { principalId: string; membershipRevision: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !("principalId" in record) || !("membershipRevision" in record)) return false;
  for (const key of ["principalId", "membershipRevision"] as const) {
    const field = record[key];
    if (typeof field !== "string" || field.length === 0 || field.length > 128) return false;
  }
  return true;
}

function safeKeyEcho(key: string): string {
  return key.replace(/[^\x20-\x7e]/g, "?").slice(0, 40);
}

/** Compute the receipt's content-integrity id from a receipt BODY (every
 *  receipt field except receiptId itself). The exact production digest
 *  schema — the validator recomputes with this same function. */
function receiptIdFor(body: Record<string, unknown>): string {
  return `amr-${engineeringDigest({ schema: RECEIPT_ID_DIGEST_SCHEMA, body }).slice(5)}`;
}

/**
 * B12.1 §D — capture-first, total, bounded receipt validation.
 *
 * Order: bounded plain-JSON capture (own enumerable data properties only —
 * inherited properties, accessors, symbols, cycles, non-JSON values,
 * non-finite numbers, hostile/revoked proxies, depth > 32, node/string
 * bounds all refuse DURING traversal, before any field logic) → exact
 * closed key set → per-field structural checks on the CAPTURED values →
 * `receiptId` recomputed from the captured body and compared exactly.
 *
 * The recomputed digest is CONTENT INTEGRITY, not authentication: a receipt
 * is authoritative only because the trusted execution/adoption service
 * minted it against a durable canonical transaction.
 *
 * Never throws; returns at most 12 bounded typed diagnostics.
 */
export function validateApprovedMutationReceipt(raw: unknown): string[] {
  try {
    const capturedResult = capturePlainJson(raw, "receipt", 32_768);
    if (!capturedResult.ok) return capturedResult.issues.slice(0, 12);
    const captured = capturedResult.value;
    if (typeof captured !== "object" || captured === null || Array.isArray(captured)) {
      return ["receipt: must be a plain object"];
    }
    const receipt = captured as Record<string, unknown>;
    const issues: string[] = [];
    const push = (issue: string): void => { if (issues.length < 12) issues.push(issue); };
    const ownKeys = new Set(Object.keys(receipt));
    for (const key of ownKeys) {
      if (!(RECEIPT_KEYS as readonly string[]).includes(key)) push(`receipt.${safeKeyEcho(key)}: unknown key`);
    }
    for (const key of RECEIPT_KEYS) if (!ownKeys.has(key)) push(`receipt.${key}: missing`);
    if (issues.length > 0) return issues;
    if (receipt.schema !== APPROVED_MUTATION_RECEIPT_SCHEMA) push(`receipt.schema: expected ${APPROVED_MUTATION_RECEIPT_SCHEMA}`);
    if (typeof receipt.receiptId !== "string" || !RECEIPT_ID_PATTERN.test(receipt.receiptId)) push("receipt.receiptId: malformed");
    if (typeof receipt.proposalId !== "string" || !PROPOSAL_ID_PATTERN.test(receipt.proposalId)) push("receipt.proposalId: malformed");
    if (typeof receipt.operationsDigest !== "string" || !DIGEST_PATTERN.test(receipt.operationsDigest)) push("receipt.operationsDigest: malformed");
    if (receipt.originRunId !== null && (typeof receipt.originRunId !== "string" || receipt.originRunId.length === 0 || receipt.originRunId.length > 128)) push("receipt.originRunId: malformed");
    // [B16.0.1 §E] the sealed authorization identity: exact keys, bounded strings.
    if (!isAuthorizationIdentityShaped(receipt.authorization)) push("receipt.authorization: malformed");
    if (receipt.commandId !== APPROVED_TIER1_COMMAND_ID) push("receipt.commandId: outside the closed vocabulary");
    for (const key of ["tenantId", "projectId", "branchId"] as const) {
      if (typeof receipt[key] !== "string" || !SCOPE_ID_PATTERN.test(receipt[key] as string)) push(`receipt.${key}: malformed`);
    }
    if (typeof receipt.lineageId !== "string" || !/^lin1-[0-9a-f]{8,64}$/.test(receipt.lineageId)) push("receipt.lineageId: malformed");
    for (const key of ["headBefore", "headAfter"] as const) {
      // Captured plain objects carry own enumerable data keys only.
      const mark = receipt[key];
      if (typeof mark !== "object" || mark === null || Array.isArray(mark)) { push(`receipt.${key}: malformed head mark`); continue; }
      const markRecord = mark as Record<string, unknown>;
      if (typeof markRecord.headSequence !== "number" || !Number.isSafeInteger(markRecord.headSequence) || markRecord.headSequence < 0
        || typeof markRecord.canonicalStateDigest !== "string" || !DIGEST_PATTERN.test(markRecord.canonicalStateDigest)
        || Object.keys(markRecord).length !== 2) push(`receipt.${key}: malformed head mark`);
    }
    if (issues.length === 0) {
      const before = receipt.headBefore as { headSequence: number };
      const after = receipt.headAfter as { headSequence: number };
      if (after.headSequence !== before.headSequence + 1) push("receipt: headAfter must advance headBefore by exactly one");
    }
    for (const key of ["schematicDigestBefore", "schematicDigestAfter"] as const) {
      if (typeof receipt[key] !== "string" || !DIGEST_PATTERN.test(receipt[key] as string)) push(`receipt.${key}: malformed`);
    }
    if (typeof receipt.transactionId !== "string" || receipt.transactionId.length === 0 || receipt.transactionId.length > 128) push("receipt.transactionId: malformed");
    if (typeof receipt.operationCount !== "number" || !Number.isSafeInteger(receipt.operationCount) || receipt.operationCount < 1 || receipt.operationCount > 256) push("receipt.operationCount: out of bounds");
    if (typeof receipt.destructive !== "boolean") push("receipt.destructive: must be a boolean");
    if (receipt.postconditions !== "verified") push("receipt.postconditions: a receipt exists only for a VERIFIED commit");
    const undo = receipt.undoReference;
    if (typeof undo !== "object" || undo === null || Array.isArray(undo)
      || (undo as Record<string, unknown>).kind !== "canonical-transaction"
      || typeof (undo as Record<string, unknown>).transactionId !== "string"
      || (undo as Record<string, unknown>).transactionId !== receipt.transactionId
      || Object.keys(undo).length !== 2) push("receipt.undoReference: malformed");
    if (typeof receipt.completedAt !== "number" || !Number.isFinite(receipt.completedAt)) push("receipt.completedAt: must be a finite number");
    if (issues.length > 0) return issues;
    // §D — content integrity: receiptId must equal the digest of the exact
    // captured body. EVERY other receipt field participates in that digest
    // (no field is outside it), so any single-field mutation fails here.
    const body: Record<string, unknown> = { ...receipt };
    delete body.receiptId;
    if (receiptIdFor(body) !== receipt.receiptId) {
      push("receipt.receiptId: does not match the receipt content (content-integrity mismatch)");
    }
    return issues;
  } catch {
    // Unreachable in principle (capture is total; post-capture data is owned
    // plain JSON) — retained as a final never-throw belt.
    return ["receipt validation failed unexpectedly"];
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

// ─── §E: the separate execution audit ledger ─────────────────────────────────

export const APPROVED_MUTATION_AUDIT_SCHEMA = "sirkit.approved-mutation-audit.v1" as const;

export type ApprovedMutationAuditEvent =
  | "approval-displayed"
  | "canceled"
  | "apply-started"
  | "refused"
  | "committed-verified"
  | "undo-observed";

/** Controlled refusal vocabulary — never raw exception or provider text.
 *  [B12.1] adds `editor-busy` (a gesture owns the preview at execution
 *  position) and `session-superseded` (project transition/retirement or a
 *  stale project scope won — zero durable transaction). [B12.3] adds
 *  `recovery-required` (durable replay evidence is unavailable, corrupt,
 *  disagreeing, or incomplete — the apply fails closed without executing
 *  and without inventing a receipt). [B16.0.1 §F] adds the closed
 *  `reauthorization-*` family: the live membership reload before the
 *  one-shot claim refused (unreachable/throwing endpoint, or a divergence
 *  from the proposal's sealed authorization binding) — always with ZERO
 *  mutation and ZERO journal entries. */
export type ApprovedMutationRefusalCode =
  | "session-not-ready"
  | "verification-failed"
  | "already-in-flight"
  | "already-applied"
  | "identity-poisoned"
  | "command-rejected"
  | "command-failed"
  | "postcondition-failed"
  | "editor-busy"
  | "session-superseded"
  | "recovery-required"
  | "reauthorization-unavailable"
  | "reauthorization-membership-unavailable"
  | "reauthorization-principal-changed"
  | "reauthorization-scope-changed"
  | "reauthorization-role-insufficient"
  | "reauthorization-required-role-unknown"
  | "reauthorization-membership-changed";

export interface ApprovedMutationAuditEntry {
  schema: typeof APPROVED_MUTATION_AUDIT_SCHEMA;
  at: number;
  proposalId: string;
  originRunId: string | null;
  event: ApprovedMutationAuditEvent;
  /** [B14] the replacement service shares this ledger and adds ONE code. */
  code: ApprovedMutationRefusalCode | "authority-unavailable" | "approval-required" | null;
}

const AUDIT_CAPACITY = 256;

/** Bounded append-only in-memory execution ledger. Approval happens AFTER the
 *  provider run finalizes, so this ledger — not the frozen run trace — is
 *  where post-run execution outcomes live (B12 §E). */
export class ApprovedMutationAuditLedger {
  private readonly entries: ApprovedMutationAuditEntry[] = [];
  record(entry: Omit<ApprovedMutationAuditEntry, "schema">): void {
    if (this.entries.length >= AUDIT_CAPACITY) this.entries.shift();
    this.entries.push(deepFreeze({ schema: APPROVED_MUTATION_AUDIT_SCHEMA, ...entry }));
  }
  read(): readonly ApprovedMutationAuditEntry[] {
    return [...this.entries];
  }
}

/** The production ledger instance the interactive composition root records to. */
export const approvedMutationAudit = new ApprovedMutationAuditLedger();

// ─── §C: sealed-artifact capture, authentication, and identity ───────────────

const PROPOSAL_KEYS = [
  "schema", "proposalId", "scope", "authorization", "baseSchematicDigest", "operations",
  "operationsDigest", "impacts", "provenance", "createdAt", "expiresAt",
] as const;

/** Identity of one exact sealed artifact: a digest over the COMPLETE
 *  verified sealed body — proposalId, operations and operationsDigest, base
 *  schematic digest, tenant/project/branch/lineage/head mark, impacts
 *  (approval tier), provenance, and creation/expiry data. A proposal id (or
 *  id + scope) alone is never identity. Supersedes B12's
 *  `sirkit.approved-mutation-identity.v1` (proposalId + scope fields only). */
const IDENTITY_SCHEMA = "sirkit.approved-mutation-identity.v2" as const;

interface AuthenticatedProposal {
  /** The CAPTURED (owned, deep-frozen) sealed artifact — everything after
   *  authentication reads this, never the caller's object. */
  proposal: SealedTier1Proposal;
  identityKey: string;
}

type ProposalAuthentication =
  | { ok: true; value: AuthenticatedProposal }
  | { ok: false; auditProposalId: string; message: string };

/**
 * §C steps 1–3: bounded capture → structural validation → independent
 * sealed-body integrity verification → exact artifact identity. Total —
 * hostile, cyclic, oversized, and non-JSON artifacts refuse during capture.
 */
function captureAndAuthenticateProposal(raw: unknown): ProposalAuthentication {
  const captured = capturePlainJson(raw, "proposal", 524_288);
  if (!captured.ok) {
    return { ok: false, auditProposalId: "unknown-proposal", message: `The proposal artifact is not capturable plain data (${captured.issues[0] ?? "unspecified"}). Nothing was changed.` };
  }
  const value = captured.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, auditProposalId: "unknown-proposal", message: "The proposal artifact is not an object. Nothing was changed." };
  }
  const record = value as Record<string, unknown>;
  const auditProposalId = typeof record.proposalId === "string" && PROPOSAL_ID_PATTERN.test(record.proposalId) ? record.proposalId : "unknown-proposal";
  const fail = (message: string): ProposalAuthentication => ({ ok: false, auditProposalId, message });
  if (record.schema === TIER1_PROPOSAL_SCHEMA_V1) {
    return fail("This is a V1 proposal artifact; V1 proposals are no longer applicable. Regenerate the proposal.");
  }
  // [B16.0.1 §E] a V2 artifact predates the authorization binding: membership
  // authority is never guessed or backfilled — precise legacy refusal.
  if (record.schema === TIER1_PROPOSAL_SCHEMA_V2) {
    return fail("Proposal rejected (legacy-authorization-missing): This V2 proposal predates the membership authorization binding and can no longer be applied. Regenerate the proposal. Nothing was changed.");
  }
  const ownKeys = new Set(Object.keys(record));
  for (const key of ownKeys) {
    if (!(PROPOSAL_KEYS as readonly string[]).includes(key)) return fail(`The proposal artifact carries an unknown field (${safeKeyEcho(key)}). Nothing was changed.`);
  }
  for (const key of PROPOSAL_KEYS) {
    if (!ownKeys.has(key)) return fail(`The proposal artifact is missing its sealed ${key} field. Nothing was changed.`);
  }
  if (record.schema !== TIER1_PROPOSAL_SCHEMA
    || typeof record.proposalId !== "string" || !PROPOSAL_ID_PATTERN.test(record.proposalId)
    || !Array.isArray(record.operations) || record.operations.length === 0 || record.operations.length > 256
    || typeof record.baseSchematicDigest !== "string" || !DIGEST_PATTERN.test(record.baseSchematicDigest)
    || typeof record.operationsDigest !== "string" || !DIGEST_PATTERN.test(record.operationsDigest)
    || !isWellFormedProposalScope(record.scope)
    // [B16.0.1 §E] the binding must at least be an object here; the full
    // well-formedness + scope-agreement check runs in the sealed-body
    // integrity verification immediately below.
    || typeof record.authorization !== "object" || record.authorization === null || Array.isArray(record.authorization)
    || typeof record.impacts !== "object" || record.impacts === null || Array.isArray(record.impacts)
    || typeof record.provenance !== "object" || record.provenance === null || Array.isArray(record.provenance)
    || typeof record.createdAt !== "number" || typeof record.expiresAt !== "number") {
    return fail("The proposal is structurally invalid. Nothing was changed.");
  }
  const candidate = record as unknown as SealedTier1Proposal;
  // §C step 2 — INDEPENDENT sealed-body integrity: both sealed digests
  // recomputed from the captured body (single source of truth in
  // schematic-proposals). An altered body refuses HERE, before any
  // registry/consumed lookup can be reached.
  const integrity = verifySealedTier1ProposalIntegrity(candidate);
  if (!integrity.ok) {
    return fail(`Proposal rejected (${integrity.code}): ${integrity.detail} Nothing was changed.`);
  }
  // §C step 3 — identity from the COMPLETE verified sealed body.
  const identityKey = engineeringDigest({ schema: IDENTITY_SCHEMA, proposal: record });
  return { ok: true, value: { proposal: candidate, identityKey } };
}

/** Derive the exact sealed-artifact identity key for an intact proposal —
 *  or null when the artifact fails capture/structural/integrity
 *  authentication. Exposed for registries, audits, and tests; carries no
 *  authority (identity is derivation, not approval). */
export function approvedMutationIdentityKey(proposal: unknown): string | null {
  const authenticated = captureAndAuthenticateProposal(proposal);
  return authenticated.ok ? authenticated.value.identityKey : null;
}

// ─── §C: the one-shot registry (keyed by exact sealed-artifact identity) ─────

type RegistryState =
  | { state: "in-flight" }
  | { state: "consumed"; receipt: ApprovedMutationReceipt }
  | { state: "poisoned" };

export class ApprovedMutationRegistry {
  private readonly states = new Map<string, RegistryState>();

  peek(identityKey: string): RegistryState | null {
    return this.states.get(identityKey) ?? null;
  }
  /** Claim for execution. Refuses when in-flight, consumed, or poisoned.
   *  Callers MUST authenticate the sealed artifact first — only an exact
   *  verified body may derive the identity used here. */
  claim(identityKey: string):
    | { ok: true }
    | { ok: false; code: "already-in-flight" | "identity-poisoned" }
    | { ok: false; code: "already-applied"; receipt: ApprovedMutationReceipt } {
    const existing = this.states.get(identityKey);
    if (existing?.state === "in-flight") return { ok: false, code: "already-in-flight" };
    if (existing?.state === "consumed") return { ok: false, code: "already-applied", receipt: existing.receipt };
    if (existing?.state === "poisoned") return { ok: false, code: "identity-poisoned" };
    this.states.set(identityKey, { state: "in-flight" });
    return { ok: true };
  }
  /** A failed preflight or rejected command releases the claim — it must not
   *  consume the proposal (a regenerated retry may legitimately succeed). */
  release(identityKey: string): void {
    if (this.states.get(identityKey)?.state === "in-flight") this.states.delete(identityKey);
  }
  consume(identityKey: string, receipt: ApprovedMutationReceipt): void {
    this.states.set(identityKey, { state: "consumed", receipt });
  }
  /** A commit whose result or adoption cannot be verified fails closed
   *  FOREVER for this identity: releasing it could allow a second commit of
   *  a proposal whose first commit may have landed. */
  poison(identityKey: string): void {
    this.states.set(identityKey, { state: "poisoned" });
  }
}

/** The production registry instance. */
export const approvedMutationRegistry = new ApprovedMutationRegistry();

// ─── §A: the injected canonical execution/adoption gateway ───────────────────

/** Structurally satisfied by the production
 *  `SchematicGestureCoordinator.runCanonicalCommand` — the SAME FIFO
 *  serialization and projection-adoption mechanism ordinary editor commands
 *  use. This service never imports React or page code; the interactive root
 *  injects its live coordinator. */
export interface ApprovedApplyExecutionGateway {
  runCanonicalCommand(input: {
    label: string;
    execute(authoritativeBase: SchematicState): Promise<SchematicCommandResult | null>;
    stillCurrent?(): boolean;
  }): Promise<CanonicalCommandGateOutcome>;
}

// ─── §A/§B/§D: the approved execution workflow ───────────────────────────────

export interface ApprovedTier1ApplyInput {
  /** The sealed proposal the human reviewed — treated as UNTRUSTED data:
   *  captured and digest-authenticated before anything else reads it. */
  proposal: SealedTier1Proposal;
  /** The live trusted session, supplied ONLY by the interactive composition
   *  root. This service never creates, imports, or serializes trust. */
  session: SchematicEditorSession;
  /** §A — the serialized canonical interaction path (the production
   *  SchematicGestureCoordinator). Verification and execution happen inside
   *  its queue; adoption happens through its host applier. */
  gateway: ApprovedApplyExecutionGateway;
  /** §B — the project-lifecycle commit interlock shared with project
   *  transition. REQUIRED: an approved apply must never proceed without one
   *  (during a pending transition the caller supplies the RETIRING
   *  interlock, which refuses both leases and replay lookups). */
  interlock: ProjectCommitInterlock;
  /** [B12.3 §A] The DURABLE approved-mutation replay journal. REQUIRED —
   *  the in-memory registry is only a concurrency cache; completed
   *  execution identity and finalized receipts live here. */
  journal: ApprovedMutationJournal;
  /** [B16.0.1 §F] The apply-time membership reauthorization step. REQUIRED —
   *  the live membership is reloaded through the ONE narrow same-origin
   *  endpoint and compared against the proposal's sealed §E authorization
   *  binding BEFORE the one-shot claim, any journal write, and canonical
   *  execution. Any divergence (or a throwing reauthorizer) refuses with
   *  ZERO mutation and ZERO journal entries. */
  reauthorize: MembershipReauthorizer;
  /** [B12.3 §E] Project-currency token captured by the caller (B07.4
   *  scope). REQUIRED — a stale scope refuses every path, including
   *  consumed and durable replay lookups. */
  stillCurrent(): boolean;
  /** Current identity captured by the caller BEFORE queueing (verified
   *  again against the sealed scope at execution position). */
  currentProjectId: string;
  currentBranchId: string;
  tenantId?: string;
  /** Originating agent run identity, when known. Metadata only. */
  originRunId?: string | null;
  /** Deterministic/test-injectable clock. */
  now?: () => number;
  registry?: ApprovedMutationRegistry;
  audit?: ApprovedMutationAuditLedger;
}

export type ApprovedTier1ApplyOutcome =
  | { ok: true; status: "committed"; receipt: ApprovedMutationReceipt; commandResult: SchematicCommandResult }
  | { ok: true; status: "already-applied"; receipt: ApprovedMutationReceipt }
  | { ok: false; status: "refused"; code: ApprovedMutationRefusalCode; message: string };

const EVIDENCE_OPERATIONS_SCHEMA = "sirkit.approved-mutation-evidence-operations.v1" as const;
/** [B12.4 §A] The receipt commitment carried INSIDE the chain-protected
 *  canonical transaction (provenance.candidateId): binds the receipt's
 *  non-canonical scalars (originRunId, completedAt) to durable evidence.
 *  The journal's digests are only consistency checksums — THIS is the
 *  authoritative binding. [B16.0.1 §E] V2 additionally binds the sealed
 *  authorization identity (principalId + membershipRevision), so a receipt
 *  under another principal or membership revision can never satisfy the
 *  commitment. */
const RECEIPT_COMMITMENT_SCHEMA = "sirkit.approved-mutation-receipt-commitment.v2" as const;

function receiptCommitmentFor(identityKey: string, originRunId: string | null, completedAt: number, authorization: { principalId: string; membershipRevision: string }): string {
  return engineeringDigest({
    schema: RECEIPT_COMMITMENT_SCHEMA,
    identityKey,
    originRunId,
    completedAt,
    authorization: { principalId: authorization.principalId, membershipRevision: authorization.membershipRevision },
  });
}

/**
 * [B12.4 §A] Authoritative receipt linkage. A persisted (or reconstructed)
 * receipt may be returned ONLY when every field is authoritatively linked:
 *
 *  - proposal-derived fields ⇐ the captured AUTHENTICATED proposal;
 *  - transaction/head fields ⇐ the canonical durable record;
 *  - originRunId + completedAt ⇐ the chain-protected receipt commitment
 *    (transaction provenance.candidateId);
 *  - schematicDigestAfter ⇐ re-derived from the live canonical head, which
 *    must still sit at the receipt's transaction (after later edits the
 *    field is UNPROVABLE and the receipt fails closed).
 *
 * `validateApprovedMutationReceipt` + transactionId equality is NOT
 * sufficient — both digests are publicly recomputable checksums.
 */
function verifyReceiptLinkage(
  receipt: ApprovedMutationReceipt,
  proposal: SealedTier1Proposal,
  identityKey: string,
  record: { transactionId: string; resultHeadSequence: number | null; resultCanonicalStateDigest: string | null; provenanceCandidateId: string | null },
  live: { headMark: Tier1ProposalHeadMark | null; headProjectionDigest: string | null },
): boolean {
  if (validateApprovedMutationReceipt(receipt).length > 0) return false;
  // Proposal-derived fields.
  if (receipt.schema !== APPROVED_MUTATION_RECEIPT_SCHEMA || receipt.commandId !== APPROVED_TIER1_COMMAND_ID) return false;
  if (receipt.proposalId !== proposal.proposalId || receipt.operationsDigest !== proposal.operationsDigest) return false;
  if (receipt.tenantId !== proposal.scope.tenantId || receipt.projectId !== proposal.scope.projectId || receipt.branchId !== proposal.scope.branchId) return false;
  if (receipt.lineageId !== proposal.scope.headMark.lineageId) return false;
  if (receipt.headBefore.headSequence !== proposal.scope.headMark.headSequence
    || receipt.headBefore.canonicalStateDigest !== proposal.scope.headMark.canonicalStateDigest) return false;
  if (receipt.schematicDigestBefore !== proposal.baseSchematicDigest) return false;
  if (receipt.operationCount !== proposal.operations.length || receipt.destructive !== proposal.impacts.destructive) return false;
  // [B16.0.1 §E] the receipt's authorization identity must match the
  // proposal's SEALED binding exactly — recovery cannot adopt a receipt
  // under another principal or membership revision.
  if (!isAuthorizationIdentityShaped(receipt.authorization)
    || receipt.authorization.principalId !== proposal.authorization.principalId
    || receipt.authorization.membershipRevision !== proposal.authorization.membershipRevision) return false;
  // Canonical-record-derived fields.
  if (receipt.transactionId !== record.transactionId || receipt.undoReference.transactionId !== record.transactionId) return false;
  if (record.resultHeadSequence === null || receipt.headAfter.headSequence !== record.resultHeadSequence) return false;
  if (record.resultCanonicalStateDigest === null || receipt.headAfter.canonicalStateDigest !== record.resultCanonicalStateDigest) return false;
  // Chain-protected commitment for the non-canonical scalars AND the
  // authorization identity ([B16.0.1 §E]).
  if (record.provenanceCandidateId === null) return false; // legacy — unprovable
  if (record.provenanceCandidateId !== receiptCommitmentFor(identityKey, receipt.originRunId, receipt.completedAt, receipt.authorization)) return false;
  // After-digest: provable only while the durable head still sits at this
  // transaction's result — then it must equal the live head projection.
  if (!live.headMark || live.headMark.headSequence !== record.resultHeadSequence
    || live.headMark.canonicalStateDigest !== record.resultCanonicalStateDigest) return false;
  if (live.headProjectionDigest === null || receipt.schematicDigestAfter !== live.headProjectionDigest) return false;
  return true;
}

/** Exact-identity comparison between the durable canonical record and the
 *  AUTHENTICATED sealed artifact — the ONLY grounds on which stale-head
 *  enforcement may be bypassed (§B step 4). */
function evidenceMatchesProposal(record: {
  status: string; clientOperationId: string; operationsDigest: string;
  projectId: string; branchId: string; lineageId: string | null;
  baseHeadSequence: number; baseCanonicalStateDigest: string;
}, proposal: SealedTier1Proposal): boolean {
  return record.status === "accepted"
    && record.clientOperationId === proposal.proposalId
    && record.operationsDigest === engineeringDigest({ schema: EVIDENCE_OPERATIONS_SCHEMA, operations: proposal.operations })
    && record.projectId === proposal.scope.projectId
    && record.branchId === proposal.scope.branchId
    && record.lineageId === proposal.scope.headMark.lineageId
    && record.baseHeadSequence === proposal.scope.headMark.headSequence
    && record.baseCanonicalStateDigest === proposal.scope.headMark.canonicalStateDigest;
}

/** §C windows 2–4 / [B12.4 §A] — deterministically finalize the ORIGINAL
 *  receipt from durable prepared data + the canonical record. The
 *  non-canonical scalars (originRunId, committedAt) must match the
 *  chain-protected commitment, and the after-digest is RE-DERIVED from the
 *  live canonical head (which must sit at this transaction). Returns null
 *  whenever any input is missing, disagreeing, or unprovable — the caller
 *  then refuses `recovery-required` instead of inventing a receipt. */
function reconstructReceiptFromJournal(
  entry: ApprovedMutationJournalEntry,
  record: { transactionId: string; resultHeadSequence: number | null; resultCanonicalStateDigest: string | null; provenanceCandidateId: string | null },
  identityKey: string,
  live: { headMark: Tier1ProposalHeadMark | null; headProjectionDigest: string | null },
): ApprovedMutationReceipt | null {
  if (entry.transactionId === null || entry.committedAt === null || entry.headAfter === null || entry.schematicDigestAfter === null) return null;
  if (entry.transactionId !== record.transactionId) return null;
  if (record.resultHeadSequence !== null && record.resultHeadSequence !== entry.headAfter.headSequence) return null;
  // Chain-protected commitment over the non-canonical scalars and the
  // [B16.0.1 §E] authorization identity the entry was PREPARED under: a
  // journal entry recorded under another principal/membership revision can
  // never reconstruct this transaction's receipt.
  if (record.provenanceCandidateId === null) return null; // legacy — unprovable
  if (record.provenanceCandidateId !== receiptCommitmentFor(identityKey, entry.originRunId, entry.committedAt, entry.authorization)) return null;
  // After-digest is provable only at the transaction's own head.
  if (!live.headMark || record.resultHeadSequence === null || record.resultCanonicalStateDigest === null) return null;
  if (live.headMark.headSequence !== record.resultHeadSequence || live.headMark.canonicalStateDigest !== record.resultCanonicalStateDigest) return null;
  if (live.headProjectionDigest === null || entry.schematicDigestAfter !== live.headProjectionDigest) return null;
  const body = {
    schema: APPROVED_MUTATION_RECEIPT_SCHEMA,
    proposalId: entry.proposalId,
    operationsDigest: entry.operationsDigest,
    originRunId: entry.originRunId,
    // [B16.0.1 §E] from the durable entry — the identity the apply was
    // PREPARED under, never re-derived or guessed at recovery time.
    authorization: { principalId: entry.authorization.principalId, membershipRevision: entry.authorization.membershipRevision },
    commandId: APPROVED_TIER1_COMMAND_ID,
    tenantId: entry.tenantId,
    projectId: entry.projectId,
    branchId: entry.branchId,
    lineageId: entry.lineageId,
    headBefore: { headSequence: entry.baseHeadMark.headSequence, canonicalStateDigest: entry.baseHeadMark.canonicalStateDigest },
    headAfter: { headSequence: entry.headAfter.headSequence, canonicalStateDigest: entry.headAfter.canonicalStateDigest },
    schematicDigestBefore: entry.baseSchematicDigest,
    schematicDigestAfter: entry.schematicDigestAfter,
    transactionId: entry.transactionId,
    operationCount: entry.operationCount,
    destructive: entry.destructive,
    postconditions: "verified" as const,
    undoReference: { kind: "canonical-transaction" as const, transactionId: entry.transactionId },
    completedAt: entry.committedAt,
  };
  const receipt: ApprovedMutationReceipt = deepFreeze({ ...body, receiptId: receiptIdFor(body) });
  return validateApprovedMutationReceipt(receipt).length === 0 ? receipt : null;
}

/**
 * Authenticate and execute one approved sealed proposal — the entire
 * workflow behind the human's "Apply exact proposal" click.
 *
 * [B12.3 §B] ordering: (1) bounded capture + full sealed-body integrity →
 * (2) trusted LIVE tenant/project/branch/lineage/current-scope verification
 * (required for every path) → (3) durable replay-journal + canonical-
 * transaction lookup → (4) exact identity/operation/base/transaction
 * comparison → (5) already-durable replay/recovery disposition → (6) only
 * when no matching durable transaction exists, current sealed
 * base/head/expiry enforcement at the SERIALIZED execution position and a
 * new transaction. Stale-head enforcement is bypassed ONLY when durable
 * evidence proves this exact authenticated artifact already produced the
 * exact recorded transaction.
 *
 * The finalized receipt is persisted in the durable journal BEFORE normal
 * committed success is returned; exact reload replay returns the
 * byte-identical original receipt. Every failure path releases or poisons
 * the claim and returns a typed refusal; nothing throws across the UI
 * boundary.
 */
export async function applyApprovedTier1Proposal(input: ApprovedTier1ApplyInput): Promise<ApprovedTier1ApplyOutcome> {
  const now = input.now ?? Date.now;
  const registry = input.registry ?? approvedMutationRegistry;
  const audit = input.audit ?? approvedMutationAudit;
  const originRunId = input.originRunId ?? null;
  const refuse = (proposalIdForAudit: string, code: ApprovedMutationRefusalCode, message: string): ApprovedTier1ApplyOutcome => {
    audit.record({ at: now(), proposalId: proposalIdForAudit, originRunId, event: "refused", code });
    return { ok: false, status: "refused", code, message };
  };

  // §B 1: capture, structural validation, sealed-body integrity, identity.
  const authenticated = captureAndAuthenticateProposal(input.proposal);
  if (!authenticated.ok) {
    return refuse(authenticated.auditProposalId, "verification-failed", authenticated.message);
  }
  const { proposal, identityKey } = authenticated.value;
  const proposalId = proposal.proposalId;

  // §B 2 / §E — trusted LIVE authority verification for EVERY path:
  // consumed lookups, durable replay dispositions, and fresh execution
  // alike. During a project transition even an exact receipt lookup
  // refuses (retiring interlock / stale scope) and publishes nothing.
  const live = input.session.scopeIdentity();
  if (live.lifecycle !== "ready") {
    return refuse(proposalId, "session-not-ready", "The schematic session is not ready to verify the proposal's scope. Nothing was changed.");
  }
  if (input.stillCurrent() === false) {
    return refuse(proposalId, "session-superseded", "The project scope this proposal belongs to is no longer current. Nothing was changed.");
  }
  if (input.interlock.retired) {
    return refuse(proposalId, "session-superseded", "The project is being switched or closed; the proposal was not applied. Nothing was changed.");
  }
  const sealed = proposal.scope;
  const liveScopeMatches = live.tenantId === sealed.tenantId
    && live.projectId === sealed.projectId
    && live.branchId === sealed.branchId
    && live.lineageId === sealed.headMark.lineageId
    && (input.tenantId ?? "local") === sealed.tenantId
    && input.currentProjectId === sealed.projectId
    && input.currentBranchId === sealed.branchId;
  if (!liveScopeMatches) {
    return refuse(proposalId, "verification-failed", "The proposal belongs to a different project/branch/lineage scope than the live session. Nothing was changed.");
  }

  // [B16.0.1 §F] apply-time membership reauthorization — AFTER sealed-artifact
  // authentication and live-scope verification, BEFORE the one-shot claim, any
  // journal write, and canonical execution. Seal integrity is not authority to
  // apply: the live membership is reloaded and compared against the proposal's
  // sealed §E authorization binding; any divergence (logged out, replaced,
  // downgraded below an apply role, membership revision moved, foreign scope)
  // refuses with ZERO mutation and ZERO journal entries. A throwing
  // reauthorizer fails closed the same way.
  let liveMembership: MembershipReauthorization;
  try {
    liveMembership = await input.reauthorize({
      scope: { tenantId: sealed.tenantId, projectId: sealed.projectId, branchId: sealed.branchId },
      proposalId,
    });
  } catch {
    return refuse(proposalId, "reauthorization-unavailable", "The live project membership could not be reauthorized; the proposal was not applied. Nothing was changed.");
  }
  const denial = evaluateMembershipReauthorization(proposal.authorization, liveMembership, SCHEMATIC_APPLY_ROLES);
  if (denial) {
    return refuse(proposalId, `reauthorization-${denial.code}`, `${denial.detail} Nothing was changed.`);
  }

  // §B (cache): atomic one-shot claim on the in-memory CONCURRENCY CACHE —
  // reachable only by an authenticated exact artifact in the verified live
  // scope, so consumed status can never be inherited or leak across scopes.
  const claim = registry.claim(identityKey);
  if (!claim.ok) {
    if (claim.code === "already-applied") {
      audit.record({ at: now(), proposalId, originRunId, event: "refused", code: "already-applied" });
      return { ok: true, status: "already-applied", receipt: claim.receipt };
    }
    return refuse(proposalId, claim.code, claim.code === "already-in-flight"
      ? "This proposal is already being applied. Nothing further was changed."
      : "A previous apply of this proposal could not be verified; it is permanently refused. Regenerate a new proposal.");
  }

  // §B 3–5: DURABLE replay-journal + canonical-transaction lookup — BEFORE
  // current-head enforcement can reject an already-applied artifact as
  // stale (pre-edit counterexample R1).
  const journalLookup = await input.journal.lookup(identityKey);
  const evidence = await input.session.durableIdempotencyEvidence(proposalId);
  if (journalLookup.kind === "unavailable" || evidence.kind === "unavailable") {
    registry.release(identityKey);
    return refuse(proposalId, "recovery-required", "Durable replay evidence is unavailable; the apply was not attempted. Retry when storage is available.");
  }
  if (journalLookup.kind === "corrupt" || evidence.kind === "corrupt") {
    registry.release(identityKey);
    return refuse(proposalId, "recovery-required", "The durable replay records for this proposal are corrupt; the apply was refused. Inspect the canonical history.");
  }
  const journalEntry = journalLookup.kind === "entry" ? journalLookup.entry : null;
  if (journalEntry?.state === "poisoned") {
    registry.poison(identityKey);
    return refuse(proposalId, "identity-poisoned", "A previous apply of this proposal could not be verified; it is permanently refused. Regenerate a new proposal.");
  }
  if (journalEntry !== null) {
    // [B12.4 §B] Journal/service coherence: the entry found by identityKey
    // must be coherent with the AUTHENTICATED proposal in every identity
    // dimension — anything else is corrupt durable state.
    if (journalEntry.proposalId !== proposalId
      || journalEntry.clientOperationId !== proposalId
      || journalEntry.operationsDigest !== proposal.operationsDigest
      || journalEntry.tenantId !== proposal.scope.tenantId
      || journalEntry.projectId !== proposal.scope.projectId
      || journalEntry.branchId !== proposal.scope.branchId
      || journalEntry.lineageId !== proposal.scope.headMark.lineageId
      || journalEntry.baseHeadMark.headSequence !== proposal.scope.headMark.headSequence
      || journalEntry.baseHeadMark.canonicalStateDigest !== proposal.scope.headMark.canonicalStateDigest
      || journalEntry.baseSchematicDigest !== proposal.baseSchematicDigest
      // [B16.0.1 §E] the entry must have been PREPARED under the proposal's
      // sealed authorization identity — recovery cannot adopt a receipt (or
      // any durable disposition) under another principal/membership revision.
      || journalEntry.authorization.principalId !== proposal.authorization.principalId
      || journalEntry.authorization.membershipRevision !== proposal.authorization.membershipRevision) {
      registry.release(identityKey);
      return refuse(proposalId, "recovery-required", "The durable replay journal entry for this proposal is not coherent with the artifact; the apply was refused. Inspect the canonical history.");
    }
  }
  if (evidence.kind === "found") {
    const record = evidence.record;
    if (!evidenceMatchesProposal(record, proposal)) {
      // §B — a reused operation id with a different operation set, digest,
      // scope, lineage, or base fails closed without a receipt.
      registry.release(identityKey);
      return refuse(proposalId, "verification-failed", "The durable canonical record for this operation id does not match this artifact. Nothing was changed and no receipt is available.");
    }
    if (journalEntry === null) {
      // §C window 6 — LEGACY transaction (pre-journal): truthful
      // already-applied; never re-execute; never invent a receipt.
      registry.release(identityKey);
      return refuse(proposalId, "already-applied", "This proposal was already applied in a previous session, before durable receipts existed; the canonical history is unchanged and no original receipt is available.");
    }
    if (journalEntry.transactionId !== null && journalEntry.transactionId !== record.transactionId) {
      registry.release(identityKey);
      return refuse(proposalId, "recovery-required", "The durable replay journal disagrees with the canonical record for this proposal; the apply was refused. Inspect the canonical history.");
    }
    const live = { headMark: input.session.headMark(), headProjectionDigest: input.session.headProjectionDigest() };
    if (journalEntry.state === "receipt-finalized" && journalEntry.receipt !== null) {
      // §C window 5 / [B12.4 §A] — the persisted receipt is returned ONLY
      // under FULL authoritative linkage (proposal + canonical record +
      // chain-protected commitment + re-derived after-digest). A modified,
      // substituted, cross-scope, legacy, or otherwise unprovable receipt
      // refuses recovery-required WITHOUT exposing receipt data.
      const persisted = journalEntry.receipt;
      // [B14] a replacement receipt can never satisfy a Tier-1 identity —
      // the union narrows here and any other shape refuses recovery-required.
      // [B16.0.1] a LEGACY V1 receipt (pre-authorization) refuses the same
      // way: membership authority is never backfilled into an old receipt.
      if (persisted !== null && persisted.schema !== APPROVED_MUTATION_RECEIPT_SCHEMA) {
        registry.release(identityKey);
        return refuse(proposalId, "recovery-required", "The persisted receipt is not a Tier-1 receipt; the apply was refused. Inspect the canonical history.");
      }
      if (!verifyReceiptLinkage(persisted, proposal, identityKey, record, live)) {
        registry.release(identityKey);
        return refuse(proposalId, "recovery-required", "The persisted receipt for this proposal could not be authoritatively verified against the canonical record; the apply was refused. Inspect the canonical history.");
      }
      const frozen = deepFreeze(structuredClone(persisted)) as ApprovedMutationReceipt;
      registry.consume(identityKey, frozen);
      audit.record({ at: now(), proposalId, originRunId, event: "refused", code: "already-applied" });
      return { ok: true, status: "already-applied", receipt: frozen };
    }
    // §C windows 2–4 — the commit is durable; the acknowledgement,
    // adoption confirmation, or receipt persistence was lost. [B12.4 §A]
    // reconstruction requires the chain-protected commitment and derives
    // the after-digest from the canonical head — never from journal data.
    const reconstructed = reconstructReceiptFromJournal(journalEntry, record, identityKey, live);
    if (reconstructed === null) {
      registry.release(identityKey);
      return refuse(proposalId, "recovery-required", "This proposal's canonical transaction is durable, but its receipt could not be authoritatively recovered; the apply was refused and will never re-execute. Inspect the canonical history.");
    }
    if (!verifyReceiptLinkage(reconstructed, proposal, identityKey, record, live)) {
      registry.release(identityKey);
      return refuse(proposalId, "recovery-required", "The recovered receipt failed authoritative verification; the apply was refused. Inspect the canonical history.");
    }
    const finalizedWrite = await input.journal.finalizeReceipt(identityKey, reconstructed);
    if (!finalizedWrite.ok) {
      registry.release(identityKey);
      return refuse(proposalId, "recovery-required", "The recovered receipt could not be durably persisted; the apply was refused. Retry when storage is available.");
    }
    registry.consume(identityKey, reconstructed);
    audit.record({ at: now(), proposalId, originRunId, event: "refused", code: "already-applied" });
    return { ok: true, status: "already-applied", receipt: reconstructed };
  }
  // Evidence absent:
  if (journalEntry !== null && journalEntry.state !== "prepared") {
    // The journal claims a commit the canonical history does not contain.
    registry.release(identityKey);
    return refuse(proposalId, "recovery-required", "The durable replay journal records a commit the canonical history does not contain; the apply was refused. Inspect the canonical history.");
  }
  // §C window 1 — prepared-only (or no journal entry): a safe fresh retry.
  // The normal path below enforces the CURRENT sealed base/head/expiry.
  audit.record({ at: now(), proposalId, originRunId, event: "apply-started", code: null });

  // Closure state shared with the serialized execution job. (An object
  // container, not `let` locals: TypeScript's flow analysis cannot see
  // assignments made inside the gateway callback.)
  const shared: {
    refusal: { code: ApprovedMutationRefusalCode; message: string } | null;
    lease: CommitLease | null;
    committed: SchematicCommandResult | null;
    headAfter: Tier1ProposalHeadMark | null;
    digestAfter: string | null;
    committedAt: number | null;
  } = { refusal: null, lease: null, committed: null, headAfter: null, digestAfter: null, committedAt: null };

  try {
    const gate = await input.gateway.runCanonicalCommand({
      label: APPROVED_TIER1_APPLY_LABEL,
      stillCurrent: input.stillCurrent,
      execute: async (authoritativeBase) => {
        // §B 6 — verification against the authoritative state and live head
        // at the ACTUAL serialized execution position (never a pre-queue
        // snapshot).
        const headBefore = input.session.headMark();
        if (!headBefore) {
          shared.refusal = { code: "session-not-ready", message: "The schematic session is not ready to verify the proposal's scope. Nothing was changed." };
          return null;
        }
        const verification = verifySealedTier1Proposal(proposal, {
          currentSchematicDigest: schematicStateDigest(authoritativeBase),
          now: now(),
          expectedScope: {
            tenantId: input.tenantId ?? "local",
            projectId: input.currentProjectId,
            branchId: input.currentBranchId,
            headMark: headBefore,
          },
        });
        if (!verification.ok) {
          shared.refusal = { code: "verification-failed", message: `Proposal rejected (${verification.code}): ${verification.detail} Nothing was changed.` };
          return null;
        }
        // §B — the commit/adoption lease. If retirement began first, cancel
        // with ZERO durable transaction; once acquired, retirement waits
        // for this critical section (commit + adoption + receipt
        // finalization) to settle.
        const acquisition = input.interlock.acquireCommitLease();
        if (!acquisition.ok) {
          shared.refusal = { code: "session-superseded", message: "The project is being switched or closed; the proposal was not applied. Nothing was changed." };
          return null;
        }
        shared.lease = acquisition.lease;
        // [B12.4 §A] — choose the receipt's completion scalar NOW and bind
        // it (with originRunId) into the transaction's chain-protected
        // provenance as the receipt commitment. From this point the
        // journal's copies are mere checksums; the canonical record is the
        // authority.
        shared.committedAt = now();
        // [B16.0.1 §E] the commitment binds the sealed authorization identity
        // alongside the non-canonical scalars.
        const commitment = receiptCommitmentFor(identityKey, originRunId, shared.committedAt, proposal.authorization);
        // §A/§C — the PREPARED journal record is durable BEFORE the
        // canonical commit begins (crash window 1 is then a safe retry).
        const preparedWrite = await input.journal.prepare({
          identityKey,
          proposalId,
          operationsDigest: proposal.operationsDigest,
          tenantId: proposal.scope.tenantId,
          projectId: proposal.scope.projectId,
          branchId: proposal.scope.branchId,
          lineageId: proposal.scope.headMark.lineageId,
          baseHeadMark: { headSequence: proposal.scope.headMark.headSequence, canonicalStateDigest: proposal.scope.headMark.canonicalStateDigest },
          baseSchematicDigest: proposal.baseSchematicDigest,
          originRunId,
          // [B16.0.1 §E] the sealed authorization identity — durable BEFORE
          // the canonical commit, so recovery can never adopt this apply
          // under a different principal or membership revision.
          authorization: { principalId: proposal.authorization.principalId, membershipRevision: proposal.authorization.membershipRevision },
          operationCount: proposal.operations.length,
          destructive: proposal.impacts.destructive,
          preparedAt: now(),
        });
        if (!preparedWrite.ok) {
          shared.refusal = { code: "recovery-required", message: "The durable replay journal could not be prepared; the proposal was not applied. Nothing was changed." };
          shared.lease?.release(); shared.lease = null;
          return null;
        }
        // §A — submit EXACTLY the authenticated sealed operations. The
        // session re-checks base digest and head mark inside its own queue.
        let result: SchematicCommandResult;
        try {
          result = await input.session.execute(authoritativeBase, {
            commandId: APPROVED_TIER1_COMMAND_ID,
            label: APPROVED_TIER1_APPLY_LABEL,
            buildOperations: () => structuredClone(proposal.operations) as EngineeringOperation[],
            expectedBaseDigest: proposal.baseSchematicDigest,
            expectedHeadMark: proposal.scope.headMark,
            idempotencyKey: proposal.proposalId,
            provenanceCandidateId: commitment,
          });
        } catch {
          shared.refusal = { code: "command-failed", message: "The canonical command failed before committing. Nothing was changed." };
          shared.lease?.release(); shared.lease = null;
          return null;
        }
        if (!result.ok) {
          shared.refusal = { code: "command-rejected", message: result.message };
          shared.lease?.release(); shared.lease = null;
          return result; // no adoption: the gateway classifies `rejected`.
        }
        if (result.status === "idempotent_replay") {
          // The durable executor replayed a PRIOR commit that the pre-flight
          // evidence did not surface. Never a second commit — and never a
          // NEW adoption/history entry for an old transaction.
          shared.refusal = { code: "already-applied", message: "This proposal was already applied in a previous session; the canonical history is unchanged." };
          shared.lease?.release(); shared.lease = null;
          return null;
        }
        if (result.status === "noop") {
          shared.refusal = { code: "command-rejected", message: `"${APPROVED_TIER1_APPLY_LABEL}" produced no semantic change; nothing was recorded.` };
          shared.lease?.release(); shared.lease = null;
          return result; // no adoption, no history entry.
        }
        // §D postconditions — from the authoritative result and session,
        // INSIDE the serialized job (no other job can interleave), BEFORE
        // any adoption. An unverified commit is never displayed as success.
        shared.committed = result;
        const headAfter = input.session.headMark();
        shared.headAfter = headAfter;
        shared.digestAfter = schematicStateDigest(result.state);
        const failures: string[] = [];
        if (typeof result.transactionId !== "string" || result.transactionId.length === 0) failures.push("missing transaction id");
        if (result.revisionBefore !== proposal.scope.headMark.canonicalStateDigest) failures.push("before-revision mismatch");
        if (!headAfter) failures.push("session head unavailable after commit");
        if (headAfter && headAfter.lineageId !== proposal.scope.headMark.lineageId) failures.push("lineage changed");
        if (headAfter && headAfter.headSequence !== proposal.scope.headMark.headSequence + 1) failures.push("more than one transaction advanced the head");
        if (headAfter && result.headMark && (result.headMark.canonicalStateDigest !== headAfter.canonicalStateDigest || result.headMark.headSequence !== headAfter.headSequence)) {
          failures.push("result head disagrees with the session head");
        }
        if (validateSchematicStateIntegrity(result.state).length > 0) failures.push("post-apply schematic fails validation");
        if (failures.length > 0) {
          shared.refusal = { code: "postcondition-failed", message: `The commit could not be verified (${failures.length} postcondition failure(s)). The proposal is permanently refused; inspect history and regenerate if needed.` };
          shared.lease?.release(); shared.lease = null;
          return null;
        }
        // §A/§C — the CANONICAL-COMMITTED record (the deterministic receipt
        // inputs) is durable before adoption; `committedAt` is the
        // commitment-bound completedAt chosen BEFORE the commit, so a
        // post-crash reconstruction is byte-identical AND chain-verified.
        const committedWrite = await input.journal.markCommitted(identityKey, {
          committedAt: shared.committedAt!,
          transactionId: result.transactionId!,
          revisionBefore: result.revisionBefore ?? null,
          revisionAfter: result.revisionAfter ?? null,
          headAfter: { headSequence: headAfter!.headSequence, canonicalStateDigest: headAfter!.canonicalStateDigest },
          schematicDigestAfter: shared.digestAfter,
        });
        if (!committedWrite.ok) {
          shared.refusal = { code: "recovery-required", message: "The commit landed but its durable journal record could not be written; success is not claimed. Retry to recover." };
          shared.lease?.release(); shared.lease = null;
          return null;
        }
        // Adoption happens in the gateway job immediately after this
        // returns: ONE canonical projection update + ONE SchematicHistory
        // entry via the coordinator host's applier. The lease stays held
        // until the gate settles (§B).
        return result;
      },
    });

    // ── Post-gate finalization (§A: consume/finalize only after adoption) ──
    if (shared.refusal !== null) {
      const pending: { code: ApprovedMutationRefusalCode; message: string } = shared.refusal;
      if (pending.code === "postcondition-failed") {
        registry.poison(identityKey);
        await input.journal.poison(identityKey);
      } else {
        registry.release(identityKey);
      }
      return refuse(proposalId, pending.code, pending.message);
    }
    if (gate.status === "applied" && shared.committed !== null) {
      const commandResult: SchematicCommandResult = shared.committed;
      const headAfterMark: Tier1ProposalHeadMark | null = shared.headAfter;
      const schematicDigestAfter: string | null = shared.digestAfter;
      const committedAt: number | null = shared.committedAt;
      if (!commandResult.ok || commandResult.status !== "executed" || !headAfterMark || !schematicDigestAfter || committedAt === null || typeof commandResult.transactionId !== "string") {
        registry.poison(identityKey);
        await input.journal.poison(identityKey);
        return refuse(proposalId, "postcondition-failed", "The commit could not be verified after adoption. The proposal is permanently refused; inspect history.");
      }
      // §A — the production adoption path succeeded.
      await input.journal.markAdopted(identityKey); // tolerated: same recovery class as canonical-committed
      const body = {
        schema: APPROVED_MUTATION_RECEIPT_SCHEMA,
        proposalId,
        operationsDigest: proposal.operationsDigest,
        originRunId,
        // [B16.0.1 §E] the identity the durable journal entry was PREPARED
        // under. `journal.prepare` wrote exactly these fields from the sealed
        // binding (and refuses `conflict` against a differing prepared entry,
        // since `authorization` is journal-immutable), so this equals the
        // entry's durable authorization.
        authorization: { principalId: proposal.authorization.principalId, membershipRevision: proposal.authorization.membershipRevision },
        commandId: APPROVED_TIER1_COMMAND_ID,
        tenantId: proposal.scope.tenantId,
        projectId: proposal.scope.projectId,
        branchId: proposal.scope.branchId,
        lineageId: proposal.scope.headMark.lineageId,
        headBefore: { headSequence: proposal.scope.headMark.headSequence, canonicalStateDigest: proposal.scope.headMark.canonicalStateDigest },
        headAfter: { headSequence: headAfterMark.headSequence, canonicalStateDigest: headAfterMark.canonicalStateDigest },
        schematicDigestBefore: proposal.baseSchematicDigest,
        schematicDigestAfter,
        transactionId: commandResult.transactionId,
        operationCount: proposal.operations.length,
        destructive: proposal.impacts.destructive,
        postconditions: "verified" as const,
        undoReference: { kind: "canonical-transaction" as const, transactionId: commandResult.transactionId },
        completedAt: committedAt,
      };
      const receipt: ApprovedMutationReceipt = deepFreeze({ ...body, receiptId: receiptIdFor(body) });
      const receiptIssues = validateApprovedMutationReceipt(receipt);
      if (receiptIssues.length > 0) {
        registry.poison(identityKey);
        await input.journal.poison(identityKey);
        return refuse(proposalId, "postcondition-failed", "The execution receipt failed validation; the commit is not claimed as verified.");
      }
      // §A/§C — the FINAL receipt is durably persisted BEFORE committed
      // success is returned. On failure the truth stays recoverable: the
      // journal holds the deterministic receipt inputs, and the next
      // attempt finalizes the byte-identical receipt.
      const finalizedWrite = await input.journal.finalizeReceipt(identityKey, receipt);
      if (!finalizedWrite.ok) {
        registry.release(identityKey);
        return refuse(proposalId, "recovery-required", "The commit and adoption succeeded, but the receipt could not be durably persisted; success is not claimed. Retry to recover the receipt.");
      }
      registry.consume(identityKey, receipt);
      audit.record({ at: now(), proposalId, originRunId, event: "committed-verified", code: null });
      return { ok: true, status: "committed", receipt, commandResult };
    }
    if (shared.committed !== null) {
      // The durable commit landed but the production adoption path did not
      // verifiably complete (project/session invalidated between commit and
      // adoption). Fail closed into the explicit recovery path — never
      // retry this identity as a fresh commit.
      registry.poison(identityKey);
      await input.journal.poison(identityKey);
      return refuse(proposalId, "postcondition-failed", "The commit landed but could not be adopted into the editor (the project or session changed). The proposal is permanently refused; inspect history.");
    }
    // No commit, no service refusal: classify the gateway outcome.
    registry.release(identityKey);
    switch (gate.status) {
      case "refused-gesture-active":
        return refuse(proposalId, "editor-busy", "A move is in progress — finish or cancel it, then Apply again. Nothing was changed.");
      case "canceled-stale":
        return refuse(proposalId, "session-superseded", "The project changed before the proposal could execute. Nothing was changed.");
      case "rejected":
        return refuse(proposalId, "command-rejected", gate.result.ok ? "The canonical command was rejected. Nothing was changed." : gate.result.message);
      case "noop":
        return refuse(proposalId, "command-rejected", `"${APPROVED_TIER1_APPLY_LABEL}" produced no semantic change; nothing was recorded.`);
      default:
        return refuse(proposalId, "command-failed", "The apply workflow failed before committing. Nothing was changed.");
    }
  } catch {
    // Total. BEFORE a commit an unexpected failure releases the claim; AFTER
    // a commit it poisons the identity — releasing then could double-commit.
    if (shared.committed !== null) {
      registry.poison(identityKey);
      await input.journal.poison(identityKey).catch(() => undefined);
      return refuse(proposalId, "postcondition-failed", "The commit could not be verified after an unexpected failure. The proposal is permanently refused; inspect history.");
    }
    registry.release(identityKey);
    return refuse(proposalId, "command-failed", "The apply workflow failed unexpectedly. Nothing was verified as changed.");
  } finally {
    // §B — the commit/adoption critical section is settled on every path.
    shared.lease?.release();
  }
}
