/**
 * B14 §E/§F — the approved COMPONENT-REPLACEMENT application service.
 *
 * The replacement sibling of the B12 Tier-1 service. It is NOT an
 * unsynchronized copy: it shares the SAME synchronization and recovery
 * primitives — the identity-keyed one-shot `ApprovedMutationRegistry`, the
 * durable CAS `ApprovedMutationJournal` (same store, same document), the
 * `ProjectCommitInterlock` lease, the serialized
 * `ApprovedApplyExecutionGateway`, the audit ledger, and the same refusal
 * vocabulary and monotonic journal states — while its per-kind orchestration
 * implements the B14 §E ritual that Tier-1 does not need:
 *
 *   capture+authenticate artifact → live authority → one-shot claim →
 *   durable lookup/idempotency evidence → inside the serialized gateway:
 *   currency verification at the head → FRESH server authority
 *   (reauthorization adapter) → deterministic plan RECOMPILATION →
 *   operation/impact digest BYTE-MATCH against the reviewed artifact →
 *   fresh runtime grant (retired on every terminal path) → journal.prepare →
 *   ONE canonical `schematic.replace-component` transaction →
 *   replacement-specific postconditions → journal.markCommitted → adoption →
 *   markAdopted → receipt → finalizeReceipt → committed.
 *
 * Nothing here is provider-callable: the ONLY invoker is the trusted
 * interactive composition root (the review UI's Apply button).
 */

import type { SchematicState } from "@/lib/schematic-types";
import {
  ApprovedMutationRegistry,
  approvedMutationRegistry,
  ApprovedMutationAuditLedger,
  approvedMutationAudit,
  type ApprovedApplyExecutionGateway,
  type ApprovedMutationRefusalCode,
} from "./approved-agent-mutations";
import { ApprovedMutationJournal } from "./approved-mutation-journal";
import type { ProjectCommitInterlock } from "./project-commit-interlock";
import type { SchematicEditorSession, SchematicCommandResult } from "./schematic-session";
import { schematicStateDigest, validateSchematicStateIntegrity } from "./schematic-model";
import { engineeringDigest } from "./stable";
import {
  REPLACEMENT_PROPOSAL_KEYS,
  REPLACEMENT_PROPOSAL_SCHEMA,
  verifySealedReplacementProposal,
  verifySealedReplacementProposalIntegrity,
  type ReplacementTargetIdentity,
  type SealedReplacementProposal,
} from "./replacement-proposals";
import { assembleReplacementProposal, retireReplacementGrant } from "./replacement-proposal-assembler";
import { consumeReplacementApprovalIntent } from "./replacement-approval.internal";
import { consumeReplacementReauthorization } from "../project/replacement-reauthorization";
import type { ComponentAuthorityRecord, ComponentCatalogCandidate } from "./component-authority";
import type { PublishedSymbolPinFacts } from "./replacement-pin-facts";
import type { EngineeringOperation } from "./types";

export const APPROVED_REPLACEMENT_COMMAND_ID = "schematic.replace-component" as const;
export const APPROVED_REPLACEMENT_APPLY_LABEL = "Applied exact component replacement";
/** [B16.0.1 §E] V2 adds the sealed authorization identity (verified principal
 *  + membership revision) to the receipt body, the receipt-id digest, and the
 *  chain-protected receipt commitment. A LEGACY V1 receipt never validates in
 *  the shared journal (membership authority is never backfilled). */
export const REPLACEMENT_RECEIPT_SCHEMA = "sirkit.approved-replacement-receipt.v2" as const;
export const REPLACEMENT_APPROVAL_ACTOR = "human:interactive" as const;

const IDENTITY_SCHEMA = "sirkit.approved-replacement-identity.v1";
/** [B16.0.1 §E] v2: the commitment binds the authorization identity too. */
const COMMITMENT_SCHEMA = "sirkit.approved-replacement-receipt-commitment.v2";
const RECEIPT_ID_SCHEMA = "sirkit.approved-replacement-receipt-id.v2";
const EVIDENCE_OPERATIONS_SCHEMA = "sirkit.approved-mutation-evidence-operations.v1";
const MAX_CAPTURE_BYTES = 524_288;

/** [B14 §F] the replacement receipt: the B12 core linkage plus the
 *  replacement identity/authority linkage. Reconstructible byte-identically
 *  from (sealed proposal, journal entry) alone — no field depends on
 *  transient execution state. */
export interface ReplacementMutationReceipt {
  schema: typeof REPLACEMENT_RECEIPT_SCHEMA;
  receiptId: string;
  proposalId: string;
  /** Evidence-domain digest over the ONE submitted operation. */
  operationsDigest: string;
  originRunId: string | null;
  /** [B16.0.1 §E] the sealed authorization identity the apply was authorized
   *  under (from the proposal's §E binding, durable in the journal entry
   *  BEFORE the canonical commit). Participates in the receipt-id digest and
   *  the chain-protected receipt commitment, so recovery can never adopt a
   *  receipt under another principal or membership revision. */
  authorization: { principalId: string; membershipRevision: string };
  commandId: typeof APPROVED_REPLACEMENT_COMMAND_ID;
  tenantId: string;
  projectId: string;
  branchId: string;
  lineageId: string;
  headBefore: { headSequence: number; canonicalStateDigest: string };
  headAfter: { headSequence: number; canonicalStateDigest: string };
  schematicDigestBefore: string;
  schematicDigestAfter: string;
  transactionId: string;
  operationCount: 1;
  destructive: true;
  postconditions: "verified";
  undoReference: { kind: "canonical-transaction"; transactionId: string };
  completedAt: number;
  componentInstanceId: string;
  sourcePartId: string;
  target: ReplacementTargetIdentity;
  authorityLinkage: {
    operationDigest: string;
    impactDigest: string;
    authorityResourceId: string;
    authorityResourceDigest: string;
    canonicalResourceId: string;
    canonicalResourceDigest: string;
    consumedAuthorityDigest: string;
    mappingCertificateId: string;
  };
  approvalActor: typeof REPLACEMENT_APPROVAL_ACTOR;
}

export function replacementReceiptIdFor(body: Omit<ReplacementMutationReceipt, "receiptId">): string {
  return `arr-${engineeringDigest({ schema: RECEIPT_ID_SCHEMA, body }).slice(5)}`;
}

export function replacementReceiptCommitmentFor(identityKey: string, originRunId: string | null, completedAt: number, authorization: { principalId: string; membershipRevision: string }): string {
  return engineeringDigest({
    schema: COMMITMENT_SCHEMA,
    identityKey,
    originRunId,
    completedAt,
    // [B16.0.1 §E] the authorization identity is chain-protected: a durable
    // transaction committed under one principal/membership revision can never
    // corroborate a receipt claiming another.
    authorization: { principalId: authorization.principalId, membershipRevision: authorization.membershipRevision },
  });
}

export function approvedReplacementIdentityKey(proposal: SealedReplacementProposal): string {
  return engineeringDigest({ schema: IDENTITY_SCHEMA, proposal });
}

/** [B14.1 §B] the fresh-facts DATA shape returned through the AUTHENTIC
 *  reauthorization channel. The shape itself is never authority: only the
 *  branded one-shot `ReplacementReauthorizationChannel` (consumed inside the
 *  serialized gateway, real same-origin transport) authenticates provenance,
 *  and the deterministic recompile + digest byte-match validate CONTENT. */
export interface FreshReplacementFacts {
  records: ComponentAuthorityRecord[];
  candidates: ComponentCatalogCandidate[];
  currentPinFacts: PublishedSymbolPinFacts | null;
  targetPinFacts: PublishedSymbolPinFacts | null;
}

export type ReplacementRefusalCode = ApprovedMutationRefusalCode | "authority-unavailable" | "approval-required";

export interface ApprovedReplacementApplyInput {
  proposal: SealedReplacementProposal;
  session: SchematicEditorSession;
  gateway: ApprovedApplyExecutionGateway;
  interlock: ProjectCommitInterlock;
  journal: ApprovedMutationJournal;
  stillCurrent(): boolean;
  currentProjectId: string;
  currentBranchId: string;
  tenantId?: string;
  originRunId?: string | null;
  /** [B14.1 §A] the ONE-SHOT interactive approval intent issued by the
   *  trusted approval controller when the human clicked Apply. Validated by
   *  registry + class identity — booleans/strings/copies grant nothing. */
  approval: unknown;
  /** [B14.1 §B] the ONE-SHOT branded reauthorization channel (production
   *  factory = real same-origin transport). Structural objects grant nothing. */
  reauthorization: unknown;
  now?: () => number;
  registry?: ApprovedMutationRegistry;
  audit?: ApprovedMutationAuditLedger;
}

export type ApprovedReplacementApplyOutcome =
  | { ok: true; status: "committed"; receipt: ReplacementMutationReceipt; commandResult: SchematicCommandResult }
  | { ok: true; status: "already-applied"; receipt: ReplacementMutationReceipt }
  | { ok: false; status: "refused"; code: ReplacementRefusalCode; message: string };

interface AuthenticatedReplacement {
  proposal: SealedReplacementProposal;
  identityKey: string;
}

/** Bounded capture + closed-key structural authentication (B12 §1). */
function captureAndAuthenticate(raw: unknown): { ok: true; captured: AuthenticatedReplacement } | { ok: false; message: string } {
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return { ok: false, message: "The replacement proposal artifact is not serializable. Nothing was changed." };
  }
  if (typeof serialized !== "string" || serialized.length > MAX_CAPTURE_BYTES) {
    return { ok: false, message: "The replacement proposal artifact is missing or exceeds the capture bound. Nothing was changed." };
  }
  let captured: unknown;
  try {
    captured = JSON.parse(serialized);
  } catch {
    return { ok: false, message: "The replacement proposal artifact could not be captured. Nothing was changed." };
  }
  if (typeof captured !== "object" || captured === null || Array.isArray(captured)) {
    return { ok: false, message: "The replacement proposal artifact is structurally invalid. Nothing was changed." };
  }
  const record = captured as Record<string, unknown>;
  const allowed = [...REPLACEMENT_PROPOSAL_KEYS, "proposalId"];
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) return { ok: false, message: `The replacement proposal artifact carries an unknown field (${key.slice(0, 40)}). Nothing was changed.` };
  }
  if (record.schema !== REPLACEMENT_PROPOSAL_SCHEMA) {
    return { ok: false, message: "The artifact is not a current sealed replacement proposal. Nothing was changed." };
  }
  const proposal = record as unknown as SealedReplacementProposal;
  const integrity = verifySealedReplacementProposalIntegrity(proposal);
  if (!integrity.ok) return { ok: false, message: `${integrity.detail} Nothing was changed.` };
  return { ok: true, captured: { proposal, identityKey: approvedReplacementIdentityKey(proposal) } };
}

function evidenceOperationsDigest(operation: EngineeringOperation): string {
  return engineeringDigest({ schema: EVIDENCE_OPERATIONS_SCHEMA, operations: [operation] });
}

function buildReceiptBody(input: {
  proposal: SealedReplacementProposal;
  identityKey: string;
  originRunId: string | null;
  tenantId: string;
  /** [B16.0.1 §E] the durable authorization identity from the journal entry
   *  this receipt finalizes (identical to the proposal's sealed binding —
   *  the step-4 coherence check refuses any divergence before this runs). */
  authorization: { principalId: string; membershipRevision: string };
  headAfter: { headSequence: number; canonicalStateDigest: string };
  schematicDigestAfter: string;
  transactionId: string;
  committedAt: number;
}): Omit<ReplacementMutationReceipt, "receiptId"> {
  const proposal = input.proposal;
  return {
    schema: REPLACEMENT_RECEIPT_SCHEMA,
    proposalId: proposal.proposalId,
    operationsDigest: evidenceOperationsDigest(proposal.operation),
    originRunId: input.originRunId,
    authorization: { principalId: input.authorization.principalId, membershipRevision: input.authorization.membershipRevision },
    commandId: APPROVED_REPLACEMENT_COMMAND_ID,
    tenantId: input.tenantId,
    projectId: proposal.scope.projectId,
    branchId: proposal.scope.branchId,
    lineageId: proposal.scope.headMark.lineageId,
    headBefore: { headSequence: proposal.scope.headMark.headSequence, canonicalStateDigest: proposal.scope.headMark.canonicalStateDigest },
    headAfter: input.headAfter,
    schematicDigestBefore: proposal.baseSchematicDigest,
    schematicDigestAfter: input.schematicDigestAfter,
    transactionId: input.transactionId,
    operationCount: 1,
    destructive: true,
    postconditions: "verified",
    undoReference: { kind: "canonical-transaction", transactionId: input.transactionId },
    completedAt: input.committedAt,
    componentInstanceId: proposal.componentInstanceId,
    sourcePartId: proposal.expectedCurrentPartId,
    target: structuredClone(proposal.target) as ReplacementTargetIdentity,
    authorityLinkage: {
      operationDigest: proposal.operationDigest,
      impactDigest: proposal.impactDigest,
      authorityResourceId: proposal.authorityResource.resourceId,
      authorityResourceDigest: proposal.authorityResource.contentDigest,
      canonicalResourceId: proposal.canonicalResource.resourceId,
      canonicalResourceDigest: proposal.canonicalResource.contentDigest,
      consumedAuthorityDigest: proposal.consumedAuthorityDigest,
      mappingCertificateId: proposal.target.mappingCertificateId,
    },
    // [B14.1 §A] written ONLY on paths that consumed a valid one-shot
    // interactive approval intent (the service refuses before any journal or
    // canonical work without one) — never an unconditional assertion.
    approvalActor: REPLACEMENT_APPROVAL_ACTOR,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** [B14 I] replacement-specific postconditions over the RESULT state. */
function replacementPostconditions(proposal: SealedReplacementProposal, result: SchematicCommandResult & { ok: true }): string[] {
  const failures: string[] = [];
  const state = result.state;
  const instance = (state.kicadComponents ?? []).find((candidate) => candidate.id === proposal.componentInstanceId);
  if (!instance) {
    failures.push("the replaced component no longer exists under its stable id");
    return failures;
  }
  const target = proposal.target;
  if (instance.partId !== target.partId) failures.push("installed partId does not match the verified target");
  if (instance.atomicPartRevisionId !== target.atomicPartRevisionId) failures.push("installed atomic revision does not match the verified target");
  if (instance.symbolAssetVersionId !== target.symbolAssetVersionId) failures.push("installed symbol version does not match the verified target");
  if (instance.footprintAssetVersionId !== target.footprintAssetVersionId) failures.push("installed footprint version does not match the verified target");
  if (instance.mappingCertificateId !== target.mappingCertificateId) failures.push("installed mapping certificate does not match the verified target");
  if (instance.selectionRecordId !== target.selectionRecordId) failures.push("installed selection record does not match the verified target");
  for (const move of proposal.impact.wireEndpointMoves) {
    const wire = state.wires.find((candidate) => candidate.id === move.wireId);
    const vertex = wire ? (move.end === "start" ? wire.vertices[0] : wire.vertices[wire.vertices.length - 1]) : undefined;
    if (!vertex || vertex.x !== move.to.x || vertex.y !== move.to.y) failures.push(`wire ${move.wireId} endpoint did not land on the reviewed position`);
  }
  for (const move of proposal.impact.netLabelMoves) {
    const label = (state.netLabels ?? []).find((candidate) => candidate.id === move.labelId);
    if (!label || label.position.x !== move.to.x || label.position.y !== move.to.y) failures.push(`net label ${move.labelId} did not land on the reviewed position`);
  }
  if (validateSchematicStateIntegrity(state).length > 0) failures.push("post-apply schematic fails validation");
  return failures;
}

/**
 * Apply ONE approved sealed replacement proposal. Explicit trusted human
 * approval is the ONLY invoker; every guarantee of the B12 service
 * (immutable captured identity, one-shot claim, durable prepared journal,
 * optimistic head precondition, one canonical transaction, exact
 * idempotency, receipt recovery, poison-on-unverifiable, provider-neutral
 * provenance) holds, plus the B14 §E fresh-authority revalidation.
 */
export async function applyApprovedReplacementProposal(input: ApprovedReplacementApplyInput): Promise<ApprovedReplacementApplyOutcome> {
  const now = input.now ?? (() => Date.now());
  const registry = input.registry ?? approvedMutationRegistry;
  const audit = input.audit ?? approvedMutationAudit;
  const tenantId = input.tenantId ?? "local";
  const originRunId = input.originRunId ?? null;

  const refuse = (code: ReplacementRefusalCode, message: string, proposalId?: string): ApprovedReplacementApplyOutcome => {
    try {
      audit.record({ at: now(), proposalId: proposalId ?? "(unauthenticated)", originRunId, event: "refused", code });
    } catch { /* audit is passive */ }
    return { ok: false, status: "refused", code, message };
  };

  // ── 1. Capture + authenticate the artifact exactly once. ───────────────────
  const capture = captureAndAuthenticate(input.proposal);
  if (!capture.ok) return refuse("verification-failed", capture.message);
  const { proposal, identityKey } = capture.captured;

  // ── 1b. [B14.1 §A] Consume the ONE-SHOT interactive approval intent. ───────
  // The intent is issued only by the trusted approval controller behind the
  // review UI's explicit Apply click, bound to this exact proposal, scope,
  // lineage, head mark, and a bounded expiry, and burned on ANY tender. A
  // direct service call, a forged/serialized/structural object, a replayed
  // intent, or an intent for another proposal/scope/head grants nothing.
  const approval = consumeReplacementApprovalIntent(input.approval, {
    proposalId: proposal.proposalId,
    scope: { tenantId, projectId: input.currentProjectId, branchId: input.currentBranchId },
    headMark: proposal.scope.headMark,
    // [B16.0.1 §E] the intent must have been minted for EXACTLY the sealed
    // authorization identity this artifact carries.
    authorization: { principalId: proposal.authorization.principalId, membershipRevision: proposal.authorization.membershipRevision },
    now: now(),
  });
  if (!approval.ok) {
    return refuse("approval-required", `No valid one-shot human approval intent accompanies this apply (${approval.code}); activate Apply in the review dialog. Nothing was changed.`, proposal.proposalId);
  }

  // ── 2. Live authority for EVERY path. ──────────────────────────────────────
  const scopeIdentity = input.session.scopeIdentity();
  if (!scopeIdentity || scopeIdentity.lifecycle !== "ready") {
    return refuse("session-not-ready", "The schematic session is not ready to verify the proposal. Nothing was changed.", proposal.proposalId);
  }
  if (!input.stillCurrent()) {
    return refuse("session-superseded", "The project changed while the proposal was pending. Nothing was changed.", proposal.proposalId);
  }
  if (input.interlock.retired) {
    return refuse("session-superseded", "The project is retiring; the commit interlock is closed. Nothing was changed.", proposal.proposalId);
  }
  if (scopeIdentity.tenantId !== proposal.scope.tenantId || scopeIdentity.projectId !== proposal.scope.projectId || scopeIdentity.branchId !== proposal.scope.branchId
    || input.currentProjectId !== proposal.scope.projectId || input.currentBranchId !== proposal.scope.branchId || tenantId !== proposal.scope.tenantId
    || scopeIdentity.lineageId !== proposal.scope.headMark.lineageId) {
    return refuse("verification-failed", "The replacement proposal was sealed for a different project/branch/lineage. Nothing was changed.", proposal.proposalId);
  }

  // ── 3. One-shot claim (SHARED registry — kind-disambiguated identity). ─────
  const claim = registry.claim(identityKey);
  if (!claim.ok) {
    if (claim.code === "already-applied") {
      const receipt = claim.receipt as unknown as ReplacementMutationReceipt | undefined;
      if (receipt && receipt.schema === REPLACEMENT_RECEIPT_SCHEMA) return { ok: true, status: "already-applied", receipt };
      return refuse("recovery-required", "This replacement was already consumed but its receipt is unavailable in this session. Nothing was changed.", proposal.proposalId);
    }
    return refuse(claim.code, claim.code === "already-in-flight"
      ? "This replacement proposal is already being applied. Nothing was changed."
      : "This replacement proposal identity is poisoned; regenerate a fresh proposal. Nothing was changed.", proposal.proposalId);
  }

  let committed = false;
  let freshGrantId: string | null = null;
  try {
    // ── 4. Durable journal + idempotency evidence BEFORE stale-head. ────────
    const lookup = await input.journal.lookup(identityKey);
    if (lookup.kind === "unavailable" || lookup.kind === "corrupt") {
      registry.release(identityKey);
      return refuse("recovery-required", "The durable replacement journal is unavailable or corrupt; manual recovery is required. Nothing was changed.", proposal.proposalId);
    }
    const entry = lookup.kind === "entry" ? lookup.entry : null;
    if (entry) {
      if (entry.state === "poisoned") {
        registry.poison(identityKey);
        return refuse("identity-poisoned", "This replacement proposal identity was poisoned by an earlier unverifiable attempt. Nothing was changed.", proposal.proposalId);
      }
      const coherent = entry.proposalId === proposal.proposalId
        && entry.operationsDigest === evidenceOperationsDigest(proposal.operation)
        && entry.tenantId === proposal.scope.tenantId && entry.projectId === proposal.scope.projectId && entry.branchId === proposal.scope.branchId
        && entry.lineageId === proposal.scope.headMark.lineageId
        && entry.baseHeadMark.headSequence === proposal.scope.headMark.headSequence
        && entry.baseHeadMark.canonicalStateDigest === proposal.scope.headMark.canonicalStateDigest
        && entry.baseSchematicDigest === proposal.baseSchematicDigest
        // [B16.0.1 §E] the durable entry must carry EXACTLY this proposal's
        // sealed authorization identity — recovery/adoption can never proceed
        // under another principal or membership revision (fail closed).
        && entry.authorization.principalId === proposal.authorization.principalId
        && entry.authorization.membershipRevision === proposal.authorization.membershipRevision;
      if (!coherent) {
        registry.release(identityKey);
        return refuse("recovery-required", "The durable journal entry does not cohere with this replacement artifact. Nothing was changed.", proposal.proposalId);
      }
    }
    const evidence = await input.session.durableIdempotencyEvidence(proposal.proposalId);
    if (evidence.kind === "unavailable" || evidence.kind === "corrupt") {
      registry.release(identityKey);
      return refuse("recovery-required", "Durable idempotency evidence is unavailable or corrupt; manual recovery is required. Nothing was changed.", proposal.proposalId);
    }
    if (evidence.kind === "found") {
      const record = evidence.record;
      const matches = record.clientOperationId === proposal.proposalId
        && record.operationsDigest === evidenceOperationsDigest(proposal.operation)
        && record.projectId === proposal.scope.projectId && record.branchId === proposal.scope.branchId
        && record.lineageId === proposal.scope.headMark.lineageId
        && record.baseHeadSequence === proposal.scope.headMark.headSequence
        && record.baseCanonicalStateDigest === proposal.scope.headMark.canonicalStateDigest;
      if (!matches) {
        registry.release(identityKey);
        return refuse("verification-failed", "A durable transaction reused this proposal identity with different content. Nothing was changed.", proposal.proposalId);
      }
      if (!entry) {
        registry.release(identityKey);
        return refuse("already-applied", "This replacement already committed durably (pre-journal legacy evidence); no receipt can be invented for it.", proposal.proposalId);
      }
      if (entry.transactionId !== null && entry.transactionId !== record.transactionId) {
        registry.release(identityKey);
        return refuse("recovery-required", "The journal and canonical history disagree about this replacement's transaction. Nothing was changed.", proposal.proposalId);
      }
      const expectedCommitment = replacementReceiptCommitmentFor(identityKey, entry.originRunId, entry.committedAt ?? 0, entry.authorization);
      if (record.provenanceCandidateId !== expectedCommitment) {
        registry.release(identityKey);
        return refuse("recovery-required", "The durable transaction does not carry this replacement's chain-protected receipt commitment. Nothing was changed.", proposal.proposalId);
      }
      // Head must still sit AT the committed transaction for a receipt claim.
      const liveHead = input.session.headMark();
      if (!liveHead || liveHead.headSequence !== record.resultHeadSequence || liveHead.canonicalStateDigest !== record.resultCanonicalStateDigest) {
        registry.release(identityKey);
        return refuse("recovery-required", "The canonical head moved past this replacement's transaction; the receipt can no longer be proven live. Nothing was changed.", proposal.proposalId);
      }
      if (entry.state === "receipt-finalized" && entry.receipt && (entry.receipt as ReplacementMutationReceipt).schema === REPLACEMENT_RECEIPT_SCHEMA) {
        const receipt = entry.receipt as ReplacementMutationReceipt;
        registry.consume(identityKey, receipt as never);
        return { ok: true, status: "already-applied", receipt };
      }
      if (entry.committedAt === null || entry.headAfter === null || entry.schematicDigestAfter === null || entry.transactionId === null) {
        registry.release(identityKey);
        return refuse("recovery-required", "The journal records a commit without complete receipt inputs. Nothing was changed.", proposal.proposalId);
      }
      const body = buildReceiptBody({
        proposal, identityKey, originRunId: entry.originRunId, tenantId,
        // [B16.0.1 §E] the finalized receipt is populated from the JOURNAL
        // ENTRY's durable authorization (proven identical to the proposal's
        // sealed binding by the coherence check above).
        authorization: entry.authorization,
        headAfter: entry.headAfter, schematicDigestAfter: entry.schematicDigestAfter,
        transactionId: entry.transactionId, committedAt: entry.committedAt,
      });
      const receipt = deepFreeze({ ...body, receiptId: replacementReceiptIdFor(body) });
      const finalized = await input.journal.finalizeReceipt(identityKey, receipt as never);
      if (!finalized.ok) {
        registry.release(identityKey);
        return refuse("recovery-required", "The reconstructed receipt could not be durably finalized. Nothing was changed.", proposal.proposalId);
      }
      registry.consume(identityKey, receipt as never);
      return { ok: true, status: "already-applied", receipt };
    }
    if (entry && entry.state !== "prepared") {
      registry.release(identityKey);
      return refuse("recovery-required", "The journal records a commit the canonical history does not contain. Nothing was changed.", proposal.proposalId);
    }

    // ── 5. Fresh execution inside the serialized gateway. ───────────────────
    const shared: {
      refusal: { code: ReplacementRefusalCode; message: string } | null;
      committedAt: number | null;
      result: (SchematicCommandResult & { ok: true }) | null;
    } = { refusal: null, committedAt: null, result: null };

    const gate = await input.gateway.runCanonicalCommand({
      label: APPROVED_REPLACEMENT_APPLY_LABEL,
      stillCurrent: input.stillCurrent,
      execute: async (authoritativeBase: SchematicState): Promise<SchematicCommandResult | null> => {
        // §E-4: currency verification at the serialized execution position.
        const headBefore = input.session.headMark();
        if (!headBefore) {
          shared.refusal = { code: "session-not-ready", message: "The schematic session lost its head mark. Nothing was changed." };
          return null;
        }
        const currency = verifySealedReplacementProposal(proposal, {
          currentSchematicDigest: schematicStateDigest(authoritativeBase),
          now: now(),
          expectedScope: { tenantId, projectId: input.currentProjectId, branchId: input.currentBranchId, headMark: headBefore },
        });
        if (!currency.ok) {
          shared.refusal = { code: "verification-failed", message: `${currency.detail}` };
          return null;
        }
        const acquisition = input.interlock.acquireCommitLease();
        if (!acquisition.ok) {
          shared.refusal = { code: "session-superseded", message: "The project is transitioning; the commit lease was refused. Nothing was changed." };
          return null;
        }
        try {
          // §E-5/6/7 [B14.1 §B]: FRESH server authority + pin facts through
          // the AUTHENTIC one-shot reauthorization channel — consumed HERE,
          // inside the serialized gateway, before journal.prepare and before
          // any canonical execution. The channel performs the REAL
          // same-origin request now; a structural adapter, a fake fetcher,
          // or an exact stale byte copy of previously valid facts is not a
          // channel and authenticates nothing. The digest byte-match below
          // remains CONTENT validation only — provenance comes from the
          // channel, never from response bytes.
          let fresh: FreshReplacementFacts | null = null;
          try {
            const instance = (authoritativeBase.kicadComponents ?? []).find((candidate) => candidate.id === proposal.componentInstanceId);
            const authentic = await consumeReplacementReauthorization(input.reauthorization, {
              proposalId: proposal.proposalId,
              componentInstanceId: proposal.componentInstanceId,
              currentAtomicPartRevisionId: instance?.atomicPartRevisionId ?? null,
              scope: { tenantId, projectId: input.currentProjectId, branchId: input.currentBranchId },
              headMark: { lineageId: headBefore.lineageId, headSequence: headBefore.headSequence, canonicalStateDigest: headBefore.canonicalStateDigest },
              now: now(),
            });
            fresh = authentic !== null && now() <= authentic.provenance.expiresAt ? authentic.facts : null;
          } catch {
            fresh = null;
          }
          if (!fresh) {
            shared.refusal = { code: "authority-unavailable", message: "Fresh server-owned component authority could not be authentically resolved; the replacement was not applied. Nothing was changed." };
            return null;
          }
          const recompiled = assembleReplacementProposal({
            state: authoritativeBase,
            componentId: proposal.componentInstanceId,
            authority: { records: fresh.records, candidates: fresh.candidates },
            scope: { tenantId, projectId: input.currentProjectId, branchId: input.currentBranchId, headMark: headBefore },
            // [B16.0.1 §E] the recompiled artifact must BYTE-MATCH the reviewed
            // one, so it seals under the SAME sealed authorization binding.
            // Whether that binding still authorizes the apply is decided by the
            // §F membership reauthorization, not here.
            authorization: proposal.authorization,
            currentPinFacts: fresh.currentPinFacts,
            targetPinFacts: fresh.targetPinFacts,
            provenance: proposal.provenance,
            now: now(),
            retainGrant: (grantId) => { freshGrantId = grantId; },
          });
          if (recompiled.kind === "blocked") {
            shared.refusal = { code: "verification-failed", message: `Fresh revalidation blocked the replacement (${recompiled.blockers[0]?.code}): ${recompiled.blockers[0]?.detail}` };
            return null;
          }
          // §E-8: the recompiled operation and impact must BYTE-MATCH the
          // reviewed artifact (this also proves §E-9: unchanged authority
          // resource, unchanged exact target, unchanged consumed evidence —
          // the deterministic grant id participates in the operation).
          if (recompiled.proposal.operationDigest !== proposal.operationDigest || recompiled.proposal.impactDigest !== proposal.impactDigest) {
            shared.refusal = { code: "verification-failed", message: "Fresh server authority or the recompiled plan no longer matches the reviewed proposal; regenerate it. Nothing was changed." };
            return null;
          }
          // §E-11: journal.prepare BEFORE the canonical commit.
          const committedAt = now();
          shared.committedAt = committedAt;
          const prepared = await input.journal.prepare({
            identityKey,
            proposalId: proposal.proposalId,
            operationsDigest: evidenceOperationsDigest(proposal.operation),
            tenantId, projectId: input.currentProjectId, branchId: input.currentBranchId,
            lineageId: headBefore.lineageId,
            baseHeadMark: { headSequence: headBefore.headSequence, canonicalStateDigest: headBefore.canonicalStateDigest },
            baseSchematicDigest: proposal.baseSchematicDigest,
            originRunId,
            // [B16.0.1 §E] the sealed authorization identity — durable BEFORE
            // the canonical commit.
            authorization: { principalId: proposal.authorization.principalId, membershipRevision: proposal.authorization.membershipRevision },
            operationCount: 1,
            destructive: true,
            preparedAt: committedAt,
          });
          if (!prepared.ok) {
            shared.refusal = { code: "recovery-required", message: "The durable journal could not record the prepared replacement. Nothing was changed." };
            return null;
          }
          // [B16.0.1 §E] the commitment binds the sealed authorization identity
          // the entry was PREPARED under (identical to proposal.authorization).
          const commitment = replacementReceiptCommitmentFor(identityKey, originRunId, committedAt, proposal.authorization);
          const result = await input.session.execute(authoritativeBase, {
            commandId: APPROVED_REPLACEMENT_COMMAND_ID,
            label: APPROVED_REPLACEMENT_APPLY_LABEL,
            buildOperations: () => [structuredClone(recompiled.proposal.operation) as EngineeringOperation],
            idempotencyKey: proposal.proposalId,
            provenanceCandidateId: commitment,
            expectedBaseDigest: proposal.baseSchematicDigest,
            expectedHeadMark: { lineageId: headBefore.lineageId, headSequence: headBefore.headSequence, canonicalStateDigest: headBefore.canonicalStateDigest },
          });
          if (!result.ok) {
            shared.refusal = { code: "command-rejected", message: `The canonical session rejected the replacement (${result.reasonCode}). Nothing was changed.` };
            return null;
          }
          if (result.status === "idempotent_replay") {
            shared.refusal = { code: "already-applied", message: "The canonical history already contains this replacement transaction." };
            return null;
          }
          if (result.status === "noop") {
            shared.refusal = { code: "command-rejected", message: "The replacement compiled to a no-op; nothing was committed." };
            return null;
          }
          // §I postconditions INSIDE the serialized job.
          const failures: string[] = [];
          if (!result.transactionId) failures.push("no canonical transaction id");
          if (result.revisionBefore !== proposal.scope.headMark.canonicalStateDigest) failures.push("commit base does not match the sealed head");
          const headAfter = result.headMark;
          if (!headAfter) failures.push("no post-commit head mark");
          else {
            if (headAfter.lineageId !== proposal.scope.headMark.lineageId) failures.push("lineage changed across the replacement");
            if (headAfter.headSequence !== proposal.scope.headMark.headSequence + 1) failures.push("head sequence did not advance by exactly one");
          }
          failures.push(...replacementPostconditions(proposal, result));
          if (failures.length > 0) {
            shared.refusal = { code: "postcondition-failed", message: `Replacement postconditions failed: ${failures.slice(0, 3).join("; ")}.` };
            return null;
          }
          committed = true;
          shared.result = result;
          const marked = await input.journal.markCommitted(identityKey, {
            committedAt,
            transactionId: result.transactionId!,
            revisionBefore: result.revisionBefore ?? null,
            revisionAfter: result.revisionAfter ?? null,
            headAfter: { headSequence: headAfter!.headSequence, canonicalStateDigest: headAfter!.canonicalStateDigest },
            schematicDigestAfter: schematicStateDigest(result.state),
          });
          if (!marked.ok) {
            shared.refusal = { code: "recovery-required", message: "The replacement committed but its durable journal record could not be written; manual recovery is required." };
            return result; // adoption still proceeds — the commit is real.
          }
          return result;
        } finally {
          acquisition.lease.release();
        }
      },
    });

    // ── 6. Post-gate finalization. ──────────────────────────────────────────
    if (shared.refusal && shared.refusal.code === "postcondition-failed") {
      registry.poison(identityKey);
      await input.journal.poison(identityKey);
      return refuse("postcondition-failed", shared.refusal.message, proposal.proposalId);
    }
    if (shared.refusal) {
      if (committed) {
        registry.poison(identityKey);
        await input.journal.poison(identityKey);
        return refuse("recovery-required", shared.refusal.message, proposal.proposalId);
      }
      registry.release(identityKey);
      return refuse(shared.refusal.code, shared.refusal.message, proposal.proposalId);
    }
    if (gate.status === "applied" && committed && shared.result && shared.committedAt !== null) {
      const adopted = await input.journal.markAdopted(identityKey);
      if (!adopted.ok) {
        registry.poison(identityKey);
        await input.journal.poison(identityKey);
        return refuse("recovery-required", "The replacement adoption could not be durably recorded. Manual recovery is required.", proposal.proposalId);
      }
      const result = shared.result;
      const body = buildReceiptBody({
        proposal, identityKey, originRunId, tenantId,
        // [B16.0.1 §E] the values journal.prepare durably recorded above (and
        // `authorization` is journal-immutable), so this equals the entry's
        // durable authorization.
        authorization: { principalId: proposal.authorization.principalId, membershipRevision: proposal.authorization.membershipRevision },
        headAfter: { headSequence: result.headMark!.headSequence, canonicalStateDigest: result.headMark!.canonicalStateDigest },
        schematicDigestAfter: schematicStateDigest(result.state),
        transactionId: result.transactionId!,
        committedAt: shared.committedAt,
      });
      const receipt = deepFreeze({ ...body, receiptId: replacementReceiptIdFor(body) });
      const finalized = await input.journal.finalizeReceipt(identityKey, receipt as never);
      if (!finalized.ok) {
        registry.release(identityKey);
        return refuse("recovery-required", "The replacement committed and adopted, but its receipt could not be durably finalized. Nothing further was changed.", proposal.proposalId);
      }
      registry.consume(identityKey, receipt as never);
      try {
        audit.record({ at: now(), proposalId: proposal.proposalId, originRunId, event: "committed-verified", code: null });
      } catch { /* audit is passive */ }
      return { ok: true, status: "committed", receipt, commandResult: result };
    }
    if (committed) {
      registry.poison(identityKey);
      await input.journal.poison(identityKey);
      return refuse("recovery-required", "The replacement committed but was not adopted; manual recovery is required.", proposal.proposalId);
    }
    registry.release(identityKey);
    if (gate.status === "refused-gesture-active") return refuse("editor-busy", "An interactive gesture owns the editor; try again. Nothing was changed.", proposal.proposalId);
    if (gate.status === "canceled-stale") return refuse("session-superseded", "The project changed while the replacement was queued. Nothing was changed.", proposal.proposalId);
    return refuse("command-failed", "The replacement could not be executed. Nothing was changed.", proposal.proposalId);
  } catch {
    if (committed) {
      registry.poison(identityKey);
      try { await input.journal.poison(identityKey); } catch { /* poisoning is best-effort after commit */ }
      return refuse("recovery-required", "The replacement failed after its canonical commit; manual recovery is required.", proposal.proposalId);
    }
    registry.release(identityKey);
    return refuse("command-failed", "The replacement failed before any canonical commit. Nothing was changed.", proposal.proposalId);
  } finally {
    // §E-12: the fresh runtime grant is retired on EVERY terminal path (the
    // executor already retires it on acceptance; retiring twice is a no-op).
    if (freshGrantId !== null) retireReplacementGrant(freshGrantId);
  }
}
