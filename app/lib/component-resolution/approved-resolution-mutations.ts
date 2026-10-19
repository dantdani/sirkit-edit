/**
 * [PR-M, 2026-10-17] Section M.2.5: the APPROVED component-RESOLUTION application service - the client-side function the page's
 * review dialog calls when the human activates Apply on a sealed resolution (the page intake is the next round).
 *
 * It is the batch sibling of the B14 replacement service (app/lib/engineering/approved-replacement-mutations.ts) and shares the
 * SAME synchronization and recovery machinery - the identity-keyed one-shot `ApprovedMutationRegistry`, the durable CAS
 * `ApprovedMutationJournal` (same store and document; the journal admits this third receipt family), the `ProjectCommitInterlock`
 * lease, the serialized `ApprovedApplyExecutionGateway`, the audit ledger and the refusal vocabulary - while its own ritual is:
 *
 *   capture + authenticate the artifact -> consume the ONE-SHOT human approval intent -> live session / scope / lineage ->
 *   one-shot claim -> durable journal lookup + idempotency evidence (an uncertain earlier commit is RECONCILED from the canonical
 *   history and its chain-protected commitment, never resubmitted) -> inside the serialized gateway: currency at the head ->
 *   FRESH server facts through the authentic one-shot channel -> the WHOLE batch recompiled by the same assembler -> operations and
 *   impact BYTE-MATCH the reviewed artifact (this is where a withdrawn candidate, a changed catalog link, changed evidence or a
 *   changed sheet refuse) -> journal.prepare -> ONE canonical `schematic.resolve-components` transaction (N replace operations, the
 *   executor's B06.2 grant gate on each) -> postconditions (identities, kept references / values / positions, moved wire ends and
 *   labels, the connectivity digest recomputed from the RESULT state) -> markCommitted -> adoption -> receipt -> committed.
 *
 * Undo / redo is the canonical transaction's exact inverse (one transaction restores every instance), replayed by the session's
 * verified durable undo path. Nothing here is provider-callable.
 */
import type { SchematicState } from "@/lib/schematic-types";
import { approvedMutationRegistry, approvedMutationAudit, type ApprovedApplyExecutionGateway, type ApprovedMutationAuditLedger, type ApprovedMutationRefusalCode, type ApprovedMutationRegistry } from "../engineering/approved-agent-mutations";
import type { ApprovedMutationJournal } from "../engineering/approved-mutation-journal";
import type { ProjectCommitInterlock } from "../engineering/project-commit-interlock";
import type { SchematicCommandResult, SchematicEditorSession } from "../engineering/schematic-session";
import { schematicStateDigest, validateSchematicStateIntegrity } from "../engineering/schematic-model";
import { retireReplacementGrant } from "../engineering/replacement-proposal-assembler";
import { engineeringDigest } from "../engineering/stable";
import type { EngineeringOperation } from "../engineering/types";
import { buildNetlist } from "../pcb/netlist-bridge";
import { assembleResolutionProposal, connectivityDigestOf, connectivityPartition, resolutionPartIdsFor, type ResolutionFacts } from "./resolution-assembler";
import { netlistLookupOf, type CatalogPartLoad } from "./instance-facts";
import { RESOLUTION_COMMAND_ID, RESOLUTION_PROPOSAL_KEYS, RESOLUTION_PROPOSAL_SCHEMA, verifySealedResolutionProposal, verifySealedResolutionProposalIntegrity, type ResolutionTargetIdentity, type SealedResolutionProposal } from "./resolution-proposal";
import { consumeResolutionApprovalIntent } from "./resolution-approval.internal";
import { consumeResolutionReauthorization } from "./resolution-reauthorization";
import type { FreshResolutionFacts } from "./evidence"; import type { ResolutionReceiptBoardImpact } from "./board-impact"; // [PR-L6, 2026-10-19] M.4 / M.5-7: the receipt discloses the reviewed board impact (v2)

export const APPROVED_RESOLUTION_APPLY_LABEL = "Applied component resolution";
export const RESOLUTION_RECEIPT_SCHEMA = "sirkit.approved-resolution-receipt.v2" as const; /** [PR-L6, 2026-10-19] v2 adds `boardImpact`; a finalized v1 receipt stays valid (the journal accepts both) */ export const RESOLUTION_RECEIPT_SCHEMA_V1 = "sirkit.approved-resolution-receipt.v1" as const;
export const RESOLUTION_APPROVAL_ACTOR = "human:interactive" as const;
const IDENTITY_SCHEMA = "sirkit.approved-resolution-identity.v1";
const COMMITMENT_SCHEMA = "sirkit.approved-resolution-receipt-commitment.v1";
const RECEIPT_ID_SCHEMA = "sirkit.approved-resolution-receipt-id.v1";
const EVIDENCE_OPERATIONS_SCHEMA = "sirkit.approved-mutation-evidence-operations.v1";
const MAX_CAPTURE_BYTES = 1_048_576;

export interface ResolutionMutationReceipt {
  schema: typeof RESOLUTION_RECEIPT_SCHEMA | typeof RESOLUTION_RECEIPT_SCHEMA_V1;
  receiptId: string;
  proposalId: string;
  operationsDigest: string;
  originRunId: string | null;
  authorization: { principalId: string; membershipRevision: string };
  commandId: typeof RESOLUTION_COMMAND_ID;
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
  destructive: true;
  postconditions: "verified";
  undoReference: { kind: "canonical-transaction"; transactionId: string };
  completedAt: number;
  items: Array<{ componentInstanceId: string; refDes: string; sourcePartId: string; target: ResolutionTargetIdentity }>;
  authorityLinkage: { operationsDigest: string; impactDigest: string; connectivityDigest: string; authorityResourceId: string; authorityResourceDigest: string; canonicalResourceId: string; canonicalResourceDigest: string; consumedAuthorityDigest: string };
  approvalActor: typeof RESOLUTION_APPROVAL_ACTOR; /** [PR-L6, 2026-10-19] v2: the reviewed board impact (disclosure, never authority); absent on a legacy v1 receipt */ boardImpact?: ResolutionReceiptBoardImpact;
}

export function resolutionReceiptIdFor(body: Omit<ResolutionMutationReceipt, "receiptId">): string {
  return `acr-${engineeringDigest({ schema: RECEIPT_ID_SCHEMA, body }).slice(5)}`;
}

export function resolutionReceiptCommitmentFor(identityKey: string, originRunId: string | null, completedAt: number, authorization: { principalId: string; membershipRevision: string }): string {
  return engineeringDigest({ schema: COMMITMENT_SCHEMA, identityKey, originRunId, completedAt, authorization: { principalId: authorization.principalId, membershipRevision: authorization.membershipRevision } });
}

export function approvedResolutionIdentityKey(proposal: SealedResolutionProposal): string {
  return engineeringDigest({ schema: IDENTITY_SCHEMA, proposal });
}

function evidenceOperationsDigest(operations: readonly EngineeringOperation[]): string {
  return engineeringDigest({ schema: EVIDENCE_OPERATIONS_SCHEMA, operations });
}

/** The fresh facts as the assembler reads them (keyed maps; a part the server could not read is `unavailable`). */
export function resolutionFactsOf(fresh: FreshResolutionFacts): ResolutionFacts {
  const parts = new Map<string, CatalogPartLoad>();
  for (const entry of fresh.parts) parts.set(entry.partId, entry.detail ? { state: "found", detail: entry.detail, revisionStatus: entry.revisionStatus } : { state: "not_found" });
  return { parts, evidence: fresh.evidence, status: fresh.status };
}

export type ResolutionRefusalCode = ApprovedMutationRefusalCode | "authority-unavailable" | "approval-required";

export interface ApprovedResolutionApplyInput {
  proposal: SealedResolutionProposal;
  session: SchematicEditorSession;
  gateway: ApprovedApplyExecutionGateway;
  interlock: ProjectCommitInterlock;
  journal: ApprovedMutationJournal;
  stillCurrent(): boolean;
  currentProjectId: string;
  currentBranchId: string;
  tenantId?: string;
  originRunId?: string | null;
  /** The ONE-SHOT human approval intent (resolution-approval.internal.ts) - booleans, strings and copies grant nothing. */
  approval: unknown;
  /** The ONE-SHOT branded fresh-facts channel (resolution-reauthorization.ts) - structural objects grant nothing. */
  reauthorization: unknown;
  now?: () => number;
  registry?: ApprovedMutationRegistry;
  audit?: ApprovedMutationAuditLedger; /** [PR-L6, 2026-10-19] the bounded summary of the board impact the human reviewed (the receipt records it; absent = `not-assessed`) */ boardImpact?: ResolutionReceiptBoardImpact;
}

export type ApprovedResolutionApplyOutcome =
  | { ok: true; status: "committed"; receipt: ResolutionMutationReceipt; commandResult: SchematicCommandResult }
  | { ok: true; status: "already-applied"; receipt: ResolutionMutationReceipt }
  | { ok: false; status: "refused"; code: ResolutionRefusalCode; message: string };

function captureAndAuthenticate(raw: unknown): { ok: true; proposal: SealedResolutionProposal; identityKey: string } | { ok: false; message: string } {
  let serialized: string;
  try { serialized = JSON.stringify(raw); } catch { return { ok: false, message: "The resolution proposal artifact is not serializable. Nothing was changed." }; }
  if (typeof serialized !== "string" || serialized.length > MAX_CAPTURE_BYTES) return { ok: false, message: "The resolution proposal artifact is missing or exceeds the capture bound. Nothing was changed." };
  let captured: unknown;
  try { captured = JSON.parse(serialized); } catch { return { ok: false, message: "The resolution proposal artifact could not be captured. Nothing was changed." }; }
  if (typeof captured !== "object" || captured === null || Array.isArray(captured)) return { ok: false, message: "The resolution proposal artifact is structurally invalid. Nothing was changed." };
  for (const key of Object.keys(captured)) if (!(RESOLUTION_PROPOSAL_KEYS as readonly string[]).includes(key)) return { ok: false, message: `The resolution proposal artifact carries an unknown field (${key.slice(0, 40)}). Nothing was changed.` };
  if ((captured as { schema?: unknown }).schema !== RESOLUTION_PROPOSAL_SCHEMA) return { ok: false, message: "The artifact is not a current sealed resolution proposal. Nothing was changed." };
  const proposal = captured as SealedResolutionProposal;
  const integrity = verifySealedResolutionProposalIntegrity(proposal);
  if (!integrity.ok) return { ok: false, message: `${integrity.detail} Nothing was changed.` };
  return { ok: true, proposal, identityKey: approvedResolutionIdentityKey(proposal) };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function buildReceiptBody(input: { proposal: SealedResolutionProposal; originRunId: string | null; tenantId: string; authorization: { principalId: string; membershipRevision: string }; headAfter: { headSequence: number; canonicalStateDigest: string }; schematicDigestAfter: string; transactionId: string; committedAt: number; boardImpact: ResolutionReceiptBoardImpact }): Omit<ResolutionMutationReceipt, "receiptId"> {
  const proposal = input.proposal;
  return {
    schema: RESOLUTION_RECEIPT_SCHEMA,
    proposalId: proposal.proposalId,
    operationsDigest: evidenceOperationsDigest(proposal.operations),
    originRunId: input.originRunId,
    authorization: { principalId: input.authorization.principalId, membershipRevision: input.authorization.membershipRevision },
    commandId: RESOLUTION_COMMAND_ID,
    tenantId: input.tenantId,
    projectId: proposal.scope.projectId,
    branchId: proposal.scope.branchId,
    lineageId: proposal.scope.headMark.lineageId,
    headBefore: { headSequence: proposal.scope.headMark.headSequence, canonicalStateDigest: proposal.scope.headMark.canonicalStateDigest },
    headAfter: input.headAfter,
    schematicDigestBefore: proposal.baseSchematicDigest,
    schematicDigestAfter: input.schematicDigestAfter,
    transactionId: input.transactionId,
    operationCount: proposal.operations.length,
    destructive: true,
    postconditions: "verified",
    undoReference: { kind: "canonical-transaction", transactionId: input.transactionId },
    completedAt: input.committedAt,
    items: proposal.impact.items.map((item) => ({ componentInstanceId: item.componentInstanceId, refDes: item.refDes, sourcePartId: item.current.partId, target: structuredClone(item.target) as ResolutionTargetIdentity })),
    authorityLinkage: {
      operationsDigest: proposal.operationsDigest,
      impactDigest: proposal.impactDigest,
      connectivityDigest: proposal.impact.connectivityDigest,
      authorityResourceId: proposal.authorityResource.resourceId,
      authorityResourceDigest: proposal.authorityResource.contentDigest,
      canonicalResourceId: proposal.canonicalResource.resourceId,
      canonicalResourceDigest: proposal.canonicalResource.contentDigest,
      consumedAuthorityDigest: proposal.consumedAuthorityDigest,
    },
    approvalActor: RESOLUTION_APPROVAL_ACTOR, boardImpact: structuredClone(input.boardImpact), // [PR-L6, 2026-10-19] v2
  };
}

/** The reviewed postconditions over the RESULT state: identities, kept references / values / positions, moves, connectivity. */
export function resolutionPostconditions(proposal: SealedResolutionProposal, before: SchematicState, after: SchematicState, facts: ResolutionFacts): string[] {
  const failures: string[] = [];
  const kicadBefore = before.kicadComponents ?? [];
  const kicadAfter = after.kicadComponents ?? [];
  for (const item of proposal.impact.items) {
    const was = kicadBefore.find((candidate) => candidate.id === item.componentInstanceId);
    const instance = kicadAfter.find((candidate) => candidate.id === item.componentInstanceId);
    if (!was || !instance) { failures.push(`instance ${item.componentInstanceId} no longer exists under its stable id`); continue; }
    const target = item.target;
    if (instance.partId !== target.catalogPartId) failures.push(`${item.refDes}: installed part does not match the reviewed target`);
    if (instance.atomicPartRevisionId !== target.atomicPartRevisionId || instance.symbolAssetVersionId !== target.symbolAssetVersionId || instance.footprintAssetVersionId !== target.footprintAssetVersionId || instance.mappingCertificateId !== target.mappingCertificateId) failures.push(`${item.refDes}: installed exact identity does not match the reviewed revision`);
    if (instance.refDes !== was.refDes) failures.push(`${item.refDes}: the reference designator changed`);
    if (instance.value !== was.value) failures.push(`${item.refDes}: the value changed`);
    if (instance.x !== was.x || instance.y !== was.y || instance.rotation !== was.rotation) failures.push(`${item.refDes}: the placement changed`);
    for (const move of item.wireEndpointMoves) {
      const wire = after.wires.find((candidate) => candidate.id === move.wireId);
      const vertex = wire ? (move.end === "start" ? wire.vertices[0] : wire.vertices[wire.vertices.length - 1]) : undefined;
      if (!vertex || vertex.x !== move.to.x || vertex.y !== move.to.y) failures.push(`wire ${move.wireId} endpoint did not land on the reviewed position`);
    }
    for (const move of item.netLabelMoves) {
      const label = (after.netLabels ?? []).find((candidate) => candidate.id === move.labelId);
      if (!label || label.position.x !== move.to.x || label.position.y !== move.to.y) failures.push(`net label ${move.labelId} did not land on the reviewed position`);
    }
  }
  const resolved = new Set(proposal.impact.items.map((item) => item.componentInstanceId));
  for (const instance of kicadAfter) {
    if (resolved.has(instance.id)) continue;
    const was = kicadBefore.find((candidate) => candidate.id === instance.id);
    if (!was || JSON.stringify(was) !== JSON.stringify(instance)) failures.push(`unaffected instance ${instance.refDes} changed`);
  }
  if (kicadAfter.length !== kicadBefore.length || after.components.length !== before.components.length) failures.push("the component set changed");
  const partIds = resolutionPartIdsFor(before, proposal.impact.items.map((item) => ({ componentId: item.componentInstanceId, candidatePartId: item.target.catalogPartId, atomicPartRevisionId: item.target.atomicPartRevisionId })));
  const parts = new Map<string, CatalogPartLoad>(partIds.flatMap((partId) => (facts.parts.has(partId) ? [[partId, facts.parts.get(partId)!] as const] : [])));
  const connectivity = connectivityDigestOf(connectivityPartition(buildNetlist(after, netlistLookupOf(parts)), new Map()));
  if (connectivity !== proposal.impact.connectivityDigest) failures.push("the resolved sheet's nets differ from the reviewed connectivity");
  if (validateSchematicStateIntegrity(after).length > 0) failures.push("the post-apply schematic fails validation");
  return failures;
}

/**
 * Apply ONE approved sealed resolution batch. The trusted interactive review boundary is the only invoker; every guarantee of the
 * replacement service holds, for N instances in one transaction.
 */
export async function applyApprovedResolutionProposal(input: ApprovedResolutionApplyInput): Promise<ApprovedResolutionApplyOutcome> {
  const now = input.now ?? (() => Date.now());
  const registry = input.registry ?? approvedMutationRegistry;
  const audit = input.audit ?? approvedMutationAudit;
  const tenantId = input.tenantId ?? "local";
  const originRunId = input.originRunId ?? null;
  const refuse = (code: ResolutionRefusalCode, message: string, proposalId?: string): ApprovedResolutionApplyOutcome => {
    try { audit.record({ at: now(), proposalId: proposalId ?? "(unauthenticated)", originRunId, event: "refused", code }); } catch { /* audit is passive */ }
    return { ok: false, status: "refused", code, message };
  };

  // 1. Capture + authenticate exactly once.
  const capture = captureAndAuthenticate(input.proposal);
  if (!capture.ok) return refuse("verification-failed", capture.message);
  const { proposal, identityKey } = capture;

  // 1b. The ONE-SHOT human approval intent for exactly this artifact, scope, head and authorization identity.
  const approval = consumeResolutionApprovalIntent(input.approval, {
    proposalId: proposal.proposalId,
    scope: { tenantId, projectId: input.currentProjectId, branchId: input.currentBranchId },
    headMark: proposal.scope.headMark,
    authorization: { principalId: proposal.authorization.principalId, membershipRevision: proposal.authorization.membershipRevision },
    now: now(),
  });
  if (!approval.ok) return refuse("approval-required", `No valid one-shot human approval accompanies this apply (${approval.code}); activate Apply in the review dialog. Nothing was changed.`, proposal.proposalId);

  // 2. Live session / scope / lineage.
  const scopeIdentity = input.session.scopeIdentity();
  if (!scopeIdentity || scopeIdentity.lifecycle !== "ready") return refuse("session-not-ready", "The schematic session is not ready to verify the resolution. Nothing was changed.", proposal.proposalId);
  if (!input.stillCurrent()) return refuse("session-superseded", "The project changed while the resolution was pending. Nothing was changed.", proposal.proposalId);
  if (input.interlock.retired) return refuse("session-superseded", "The project is retiring; the commit interlock is closed. Nothing was changed.", proposal.proposalId);
  if (scopeIdentity.tenantId !== proposal.scope.tenantId || scopeIdentity.projectId !== proposal.scope.projectId || scopeIdentity.branchId !== proposal.scope.branchId
    || input.currentProjectId !== proposal.scope.projectId || input.currentBranchId !== proposal.scope.branchId || tenantId !== proposal.scope.tenantId
    || scopeIdentity.lineageId !== proposal.scope.headMark.lineageId) {
    return refuse("verification-failed", "The resolution proposal was sealed for a different project/branch/lineage. Nothing was changed.", proposal.proposalId);
  }

  // 3. One-shot claim in the SHARED registry.
  const claim = registry.claim(identityKey);
  if (!claim.ok) {
    if (claim.code === "already-applied") {
      const receipt = claim.receipt as unknown as ResolutionMutationReceipt | undefined;
      if (receipt && (receipt.schema === RESOLUTION_RECEIPT_SCHEMA || receipt.schema === RESOLUTION_RECEIPT_SCHEMA_V1)) return { ok: true, status: "already-applied", receipt }; // [PR-L6, 2026-10-19] a legacy v1 receipt stays a receipt
      return refuse("recovery-required", "This resolution was already consumed but its receipt is unavailable in this session. Nothing was changed.", proposal.proposalId);
    }
    return refuse(claim.code, claim.code === "already-in-flight" ? "This resolution is already being applied. Nothing was changed." : "This resolution identity is poisoned; regenerate a fresh proposal. Nothing was changed.", proposal.proposalId);
  }

  let committed = false;
  let freshGrantIds: string[] = [];
  try {
    // 4. Durable journal + idempotency evidence BEFORE anything else: an uncertain earlier commit is reconciled, never resubmitted.
    const lookup = await input.journal.lookup(identityKey);
    if (lookup.kind === "unavailable" || lookup.kind === "corrupt") { registry.release(identityKey); return refuse("recovery-required", "The durable journal is unavailable or corrupt; manual recovery is required. Nothing was changed.", proposal.proposalId); }
    const entry = lookup.kind === "entry" ? lookup.entry : null;
    if (entry) {
      if (entry.state === "poisoned") { registry.poison(identityKey); return refuse("identity-poisoned", "This resolution identity was poisoned by an earlier unverifiable attempt. Nothing was changed.", proposal.proposalId); }
      const coherent = entry.proposalId === proposal.proposalId && entry.operationsDigest === evidenceOperationsDigest(proposal.operations)
        && entry.tenantId === proposal.scope.tenantId && entry.projectId === proposal.scope.projectId && entry.branchId === proposal.scope.branchId
        && entry.lineageId === proposal.scope.headMark.lineageId && entry.baseHeadMark.headSequence === proposal.scope.headMark.headSequence
        && entry.baseHeadMark.canonicalStateDigest === proposal.scope.headMark.canonicalStateDigest && entry.baseSchematicDigest === proposal.baseSchematicDigest
        && entry.authorization.principalId === proposal.authorization.principalId && entry.authorization.membershipRevision === proposal.authorization.membershipRevision
        && entry.operationCount === proposal.operations.length;
      if (!coherent) { registry.release(identityKey); return refuse("recovery-required", "The durable journal entry does not cohere with this resolution artifact. Nothing was changed.", proposal.proposalId); }
    }
    const evidence = await input.session.durableIdempotencyEvidence(proposal.proposalId);
    if (evidence.kind === "unavailable" || evidence.kind === "corrupt") { registry.release(identityKey); return refuse("recovery-required", "Durable idempotency evidence is unavailable or corrupt; manual recovery is required. Nothing was changed.", proposal.proposalId); }
    if (evidence.kind === "found") {
      const record = evidence.record;
      const matches = record.clientOperationId === proposal.proposalId && record.operationsDigest === evidenceOperationsDigest(proposal.operations)
        && record.projectId === proposal.scope.projectId && record.branchId === proposal.scope.branchId && record.lineageId === proposal.scope.headMark.lineageId
        && record.baseHeadSequence === proposal.scope.headMark.headSequence && record.baseCanonicalStateDigest === proposal.scope.headMark.canonicalStateDigest;
      if (!matches) { registry.release(identityKey); return refuse("verification-failed", "A durable transaction reused this resolution identity with different content. Nothing was changed.", proposal.proposalId); }
      if (!entry) { registry.release(identityKey); return refuse("already-applied", "This resolution already committed durably without a journal record; no receipt can be invented for it.", proposal.proposalId); }
      if (entry.transactionId !== null && entry.transactionId !== record.transactionId) { registry.release(identityKey); return refuse("recovery-required", "The journal and canonical history disagree about this resolution's transaction. Nothing was changed.", proposal.proposalId); }
      if (record.provenanceCandidateId !== resolutionReceiptCommitmentFor(identityKey, entry.originRunId, entry.committedAt ?? 0, entry.authorization)) { registry.release(identityKey); return refuse("recovery-required", "The durable transaction does not carry this resolution's chain-protected receipt commitment. Nothing was changed.", proposal.proposalId); }
      const liveHead = input.session.headMark();
      if (!liveHead || liveHead.headSequence !== record.resultHeadSequence || liveHead.canonicalStateDigest !== record.resultCanonicalStateDigest) { registry.release(identityKey); return refuse("recovery-required", "The canonical head moved past this resolution's transaction; the receipt can no longer be proven live. Nothing was changed.", proposal.proposalId); }
      if (entry.state === "receipt-finalized" && entry.receipt && [RESOLUTION_RECEIPT_SCHEMA, RESOLUTION_RECEIPT_SCHEMA_V1].includes((entry.receipt as unknown as ResolutionMutationReceipt).schema)) { // [PR-L6, 2026-10-19] + a finalized legacy v1 receipt
        const receipt = entry.receipt as unknown as ResolutionMutationReceipt;
        registry.consume(identityKey, receipt as never);
        return { ok: true, status: "already-applied", receipt };
      }
      if (entry.committedAt === null || entry.headAfter === null || entry.schematicDigestAfter === null || entry.transactionId === null) { registry.release(identityKey); return refuse("recovery-required", "The journal records a commit without complete receipt inputs. Nothing was changed.", proposal.proposalId); }
      const body = buildReceiptBody({ proposal, originRunId: entry.originRunId, tenantId, authorization: entry.authorization, headAfter: entry.headAfter, schematicDigestAfter: entry.schematicDigestAfter, transactionId: entry.transactionId, committedAt: entry.committedAt, boardImpact: { state: "not-recorded" } }); // [PR-L6, 2026-10-19] the reviewed impact is not journaled: the reconstructed receipt says so (enforcement is derived from the board)
      const receipt = deepFreeze({ ...body, receiptId: resolutionReceiptIdFor(body) });
      const finalized = await input.journal.finalizeReceipt(identityKey, receipt as never);
      if (!finalized.ok) { registry.release(identityKey); return refuse("recovery-required", "The reconstructed receipt could not be durably finalized. Nothing was changed.", proposal.proposalId); }
      registry.consume(identityKey, receipt as never);
      return { ok: true, status: "already-applied", receipt };
    }
    if (entry && entry.state !== "prepared") { registry.release(identityKey); return refuse("recovery-required", "The journal records a commit the canonical history does not contain. Nothing was changed.", proposal.proposalId); }

    // 5. Fresh execution inside the serialized gateway.
    const shared: { refusal: { code: ResolutionRefusalCode; message: string } | null; committedAt: number | null; result: (SchematicCommandResult & { ok: true }) | null } = { refusal: null, committedAt: null, result: null };
    const gate = await input.gateway.runCanonicalCommand({
      label: APPROVED_RESOLUTION_APPLY_LABEL,
      stillCurrent: input.stillCurrent,
      execute: async (authoritativeBase: SchematicState): Promise<SchematicCommandResult | null> => {
        const headBefore = input.session.headMark();
        if (!headBefore) { shared.refusal = { code: "session-not-ready", message: "The schematic session lost its head mark. Nothing was changed." }; return null; }
        const currency = verifySealedResolutionProposal(proposal, { currentSchematicDigest: schematicStateDigest(authoritativeBase), now: now(), expectedScope: { tenantId, projectId: input.currentProjectId, branchId: input.currentBranchId, headMark: headBefore } });
        if (!currency.ok) { shared.refusal = { code: "verification-failed", message: currency.detail }; return null; }
        const acquisition = input.interlock.acquireCommitLease();
        if (!acquisition.ok) { shared.refusal = { code: "session-superseded", message: "The project is transitioning; the commit lease was refused. Nothing was changed." }; return null; }
        try {
          let fresh: FreshResolutionFacts | null = null;
          try {
            const authentic = await consumeResolutionReauthorization(input.reauthorization, {
              proposalId: proposal.proposalId,
              items: proposal.impact.items.map((item) => ({ componentInstanceId: item.componentInstanceId, currentPartId: item.current.partId, candidatePartId: item.target.catalogPartId, atomicPartRevisionId: item.target.atomicPartRevisionId })),
              partIds: resolutionPartIdsFor(authoritativeBase, proposal.impact.items.map((item) => ({ componentId: item.componentInstanceId, candidatePartId: item.target.catalogPartId, atomicPartRevisionId: item.target.atomicPartRevisionId }))),
              scope: { tenantId, projectId: input.currentProjectId, branchId: input.currentBranchId },
              now: now(),
            });
            fresh = authentic !== null && now() <= authentic.provenance.expiresAt ? authentic.facts : null;
          } catch {
            fresh = null;
          }
          if (!fresh) { shared.refusal = { code: "authority-unavailable", message: "Fresh server catalog facts could not be authentically resolved; the resolution was not applied. Nothing was changed." }; return null; }
          const facts = resolutionFactsOf(fresh);
          const recompiled = assembleResolutionProposal({
            state: authoritativeBase,
            scope: { tenantId, projectId: input.currentProjectId, branchId: input.currentBranchId, headMark: headBefore },
            authorization: proposal.authorization,
            items: proposal.impact.items.map((item) => ({ componentId: item.componentInstanceId, candidatePartId: item.target.catalogPartId, atomicPartRevisionId: item.target.atomicPartRevisionId })),
            requirement: proposal.requirement,
            facts,
            provenance: proposal.provenance,
            now: now(),
            retainGrants: (grantIds) => { freshGrantIds = grantIds; },
          });
          if (recompiled.kind === "blocked") { shared.refusal = { code: "verification-failed", message: `Fresh revalidation blocked the resolution (${recompiled.blockers[0]?.code}): ${recompiled.blockers[0]?.detail}` }; return null; }
          if (recompiled.proposal.operationsDigest !== proposal.operationsDigest || recompiled.proposal.impactDigest !== proposal.impactDigest) {
            shared.refusal = { code: "verification-failed", message: "Fresh server facts or the recompiled batch no longer match the reviewed resolution; regenerate it. Nothing was changed." };
            return null;
          }
          const committedAt = now();
          shared.committedAt = committedAt;
          const prepared = await input.journal.prepare({
            identityKey, proposalId: proposal.proposalId, operationsDigest: evidenceOperationsDigest(proposal.operations),
            tenantId, projectId: input.currentProjectId, branchId: input.currentBranchId, lineageId: headBefore.lineageId,
            baseHeadMark: { headSequence: headBefore.headSequence, canonicalStateDigest: headBefore.canonicalStateDigest }, baseSchematicDigest: proposal.baseSchematicDigest,
            originRunId, authorization: { principalId: proposal.authorization.principalId, membershipRevision: proposal.authorization.membershipRevision },
            operationCount: proposal.operations.length, destructive: true, preparedAt: committedAt,
          });
          if (!prepared.ok) { shared.refusal = { code: "recovery-required", message: "The durable journal could not record the prepared resolution. Nothing was changed." }; return null; }
          const commitment = resolutionReceiptCommitmentFor(identityKey, originRunId, committedAt, proposal.authorization);
          const result = await input.session.execute(authoritativeBase, {
            commandId: RESOLUTION_COMMAND_ID,
            label: APPROVED_RESOLUTION_APPLY_LABEL,
            buildOperations: () => structuredClone(recompiled.proposal.operations) as EngineeringOperation[],
            idempotencyKey: proposal.proposalId,
            provenanceCandidateId: commitment,
            expectedBaseDigest: proposal.baseSchematicDigest,
            expectedHeadMark: { lineageId: headBefore.lineageId, headSequence: headBefore.headSequence, canonicalStateDigest: headBefore.canonicalStateDigest },
          });
          if (!result.ok) { shared.refusal = { code: "command-rejected", message: `The canonical session rejected the resolution (${result.reasonCode}). Nothing was changed.` }; return null; }
          if (result.status === "idempotent_replay") { shared.refusal = { code: "already-applied", message: "The canonical history already contains this resolution transaction." }; return null; }
          if (result.status === "noop") { shared.refusal = { code: "command-rejected", message: "The resolution compiled to a no-op; nothing was committed." }; return null; }
          const failures: string[] = [];
          if (!result.transactionId) failures.push("no canonical transaction id");
          if (result.revisionBefore !== proposal.scope.headMark.canonicalStateDigest) failures.push("commit base does not match the sealed head");
          const headAfter = result.headMark;
          if (!headAfter) failures.push("no post-commit head mark");
          else {
            if (headAfter.lineageId !== proposal.scope.headMark.lineageId) failures.push("lineage changed across the resolution");
            if (headAfter.headSequence !== proposal.scope.headMark.headSequence + 1) failures.push("head sequence did not advance by exactly one");
          }
          failures.push(...resolutionPostconditions(proposal, authoritativeBase, result.state, facts));
          if (failures.length > 0) { shared.refusal = { code: "postcondition-failed", message: `Resolution postconditions failed: ${failures.slice(0, 3).join("; ")}.` }; return null; }
          committed = true;
          shared.result = result;
          const marked = await input.journal.markCommitted(identityKey, {
            committedAt, transactionId: result.transactionId!, revisionBefore: result.revisionBefore ?? null, revisionAfter: result.revisionAfter ?? null,
            headAfter: { headSequence: headAfter!.headSequence, canonicalStateDigest: headAfter!.canonicalStateDigest }, schematicDigestAfter: schematicStateDigest(result.state),
          });
          if (!marked.ok) { shared.refusal = { code: "recovery-required", message: "The resolution committed but its durable journal record could not be written; manual recovery is required." }; return result; }
          return result;
        } finally {
          acquisition.lease.release();
        }
      },
    });

    // 6. Post-gate finalization.
    if (shared.refusal && shared.refusal.code === "postcondition-failed") { registry.poison(identityKey); await input.journal.poison(identityKey); return refuse("postcondition-failed", shared.refusal.message, proposal.proposalId); }
    if (shared.refusal) {
      if (committed) { registry.poison(identityKey); await input.journal.poison(identityKey); return refuse("recovery-required", shared.refusal.message, proposal.proposalId); }
      registry.release(identityKey);
      return refuse(shared.refusal.code, shared.refusal.message, proposal.proposalId);
    }
    if (gate.status === "applied" && committed && shared.result && shared.committedAt !== null) {
      const adopted = await input.journal.markAdopted(identityKey);
      if (!adopted.ok) { registry.poison(identityKey); await input.journal.poison(identityKey); return refuse("recovery-required", "The resolution adoption could not be durably recorded. Manual recovery is required.", proposal.proposalId); }
      const result = shared.result;
      const body = buildReceiptBody({ proposal, originRunId, tenantId, authorization: proposal.authorization, headAfter: { headSequence: result.headMark!.headSequence, canonicalStateDigest: result.headMark!.canonicalStateDigest }, schematicDigestAfter: schematicStateDigest(result.state), transactionId: result.transactionId!, committedAt: shared.committedAt, boardImpact: input.boardImpact ?? { state: "not-assessed" } }); // [PR-L6, 2026-10-19] v2: the reviewed impact
      const receipt = deepFreeze({ ...body, receiptId: resolutionReceiptIdFor(body) });
      const finalized = await input.journal.finalizeReceipt(identityKey, receipt as never);
      if (!finalized.ok) { registry.release(identityKey); return refuse("recovery-required", "The resolution committed and adopted, but its receipt could not be durably finalized. Nothing further was changed.", proposal.proposalId); }
      registry.consume(identityKey, receipt as never);
      try { audit.record({ at: now(), proposalId: proposal.proposalId, originRunId, event: "committed-verified", code: null }); } catch { /* audit is passive */ }
      return { ok: true, status: "committed", receipt, commandResult: result };
    }
    if (committed) { registry.poison(identityKey); await input.journal.poison(identityKey); return refuse("recovery-required", "The resolution committed but was not adopted; manual recovery is required.", proposal.proposalId); }
    registry.release(identityKey);
    if (gate.status === "refused-gesture-active") return refuse("editor-busy", "An interactive gesture owns the editor; try again. Nothing was changed.", proposal.proposalId);
    if (gate.status === "canceled-stale") return refuse("session-superseded", "The project changed while the resolution was queued. Nothing was changed.", proposal.proposalId);
    return refuse("command-failed", "The resolution could not be executed. Nothing was changed.", proposal.proposalId);
  } catch {
    if (committed) {
      registry.poison(identityKey);
      try { await input.journal.poison(identityKey); } catch { /* best effort after commit */ }
      return refuse("recovery-required", "The resolution failed after its canonical commit; manual recovery is required.", proposal.proposalId);
    }
    registry.release(identityKey);
    return refuse("command-failed", "The resolution failed before any canonical commit. Nothing was changed.", proposal.proposalId);
  } finally {
    for (const grantId of freshGrantIds) retireReplacementGrant(grantId);
  }
}
