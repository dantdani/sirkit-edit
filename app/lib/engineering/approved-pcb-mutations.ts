/**
 * B15.3 §J — the approved-PCB-mutation apply service.
 *
 * The ONE path from a sealed bounded PCB edit proposal to canonical board
 * state, mirroring the proven B12/B14 ritual:
 *
 *   capture + authenticate the seal
 *   → consume the ONE-SHOT human approval (before any journal/canonical work)
 *   → live authority checks (lifecycle currency, interlock, scope)
 *   → live currency (revision, board digest, history head, lineage,
 *     validation policy)
 *   → in-memory identity claim (double-click / concurrency)
 *   → durable journal lookup + canonical durable evidence (replay/recovery)
 *   → commit lease
 *   → RECOMPILE the sealed operations through the canonical B15 compiler
 *     and BYTE-MATCH every pinned digest
 *   → durable journal.prepare BEFORE the canonical commit
 *   → exactly ONE `commitPcbCandidate` transaction (idempotencyKey =
 *     proposalId; the receipt commitment rides the chain-protected
 *     `provenance.candidateId`; the serialized `buildCandidate` re-pins the
 *     exact base revision)
 *   → postconditions → journal committed/adopted → receipt → finalized
 *   → registry consume → autosave settlement.
 *
 * Failure classification is TRUTHFUL: pre-commit failures release the claim
 * and report that nothing changed; post-commit failures poison the identity
 * and report recovery-required — never "nothing changed". Recovery adopts a
 * transaction ONLY when the hash-chained canonical durable history proves it
 * landed.
 */

import type { PcbHistory } from "../pcb/history";
import { pcbRevisionId } from "../pcb/revision";
import { pcbBoardInstanceId } from "../pcb/board-identity";
import { compileBoundedPcbEdit } from "../pcb/proposal/bounded-edit-compiler";
import {
  PCB_EDIT_PROPOSAL_KEYS,
  isPcbEditProposalExpired,
  resolvePcbValidationPolicy,
  verifySealedPcbEditProposalIntegrity,
  type SealedPcbEditProposal,
} from "../pcb/proposal/sealed-pcb-edit-proposal";
import {
  ApprovedPcbMutationJournal,
  PCB_APPROVAL_ACTOR,
  buildPcbMutationReceipt,
  type ApprovedPcbMutationJournalEntry,
  type PcbMutationReceipt,
} from "./approved-pcb-mutation-journal";
import { canonicalSessionFor } from "./editor-adapter";
import { commitPcbCandidate } from "./pcb-commit-gateway";
import { consumePcbEditApprovalIntent } from "./pcb-edit-approval.internal";
import type { ProjectCommitInterlock } from "./project-commit-interlock";
import { engineeringDigest } from "./stable";

export const APPROVED_PCB_COMMAND_ID = "pcb.bounded-edit-apply";
const MAX_CAPTURE_BYTES = 524_288;
const IDENTITY_SCHEMA = "sirkit.approved-pcb-mutation-identity.v1";
/** [B16.0.1 §E] .v1 → .v2: the commitment digest now COVERS the authorization
 *  identity, so a commitment (and therefore a receipt/recovery adoption)
 *  minted under another principal/membership revision can never match. */
const COMMITMENT_SCHEMA = "sirkit.approved-pcb-mutation-receipt-commitment.v2";

export function pcbProposalIdentityKey(proposal: SealedPcbEditProposal): string {
  return engineeringDigest({ schema: IDENTITY_SCHEMA, proposal });
}

export function pcbReceiptCommitmentFor(
  identityKey: string,
  originRunId: string | null,
  committedAt: number,
  // [B16.0.1 §E] the sealed authorization identity is part of the commitment.
  authorization: { principalId: string; membershipRevision: string },
): string {
  return engineeringDigest({
    schema: COMMITMENT_SCHEMA, identityKey, originRunId, committedAt,
    authorization: { principalId: authorization.principalId, membershipRevision: authorization.membershipRevision },
  });
}

/** In-memory one-shot identity claim (double-click / concurrency guard).
 *  A PCB-typed sibling of the B12 `ApprovedMutationRegistry` — the shared
 *  schematic registry's receipt type is deliberately NOT overloaded. */
type PcbRegistryState =
  | { state: "in-flight" }
  | { state: "consumed"; receipt: PcbMutationReceipt }
  | { state: "poisoned" };

export class ApprovedPcbMutationRegistry {
  private readonly states = new Map<string, PcbRegistryState>();
  claim(identityKey: string):
    | { ok: true }
    | { ok: false; code: "already-in-flight" | "identity-poisoned" }
    | { ok: false; code: "already-applied"; receipt: PcbMutationReceipt } {
    const existing = this.states.get(identityKey);
    if (existing?.state === "in-flight") return { ok: false, code: "already-in-flight" };
    if (existing?.state === "consumed") return { ok: false, code: "already-applied", receipt: existing.receipt };
    if (existing?.state === "poisoned") return { ok: false, code: "identity-poisoned" };
    this.states.set(identityKey, { state: "in-flight" });
    return { ok: true };
  }
  release(identityKey: string): void {
    if (this.states.get(identityKey)?.state === "in-flight") this.states.delete(identityKey);
  }
  consume(identityKey: string, receipt: PcbMutationReceipt): void {
    this.states.set(identityKey, { state: "consumed", receipt });
  }
  poison(identityKey: string): void {
    this.states.set(identityKey, { state: "poisoned" });
  }
}

/** The production registry instance. */
export const approvedPcbMutationRegistry = new ApprovedPcbMutationRegistry();

export interface ApprovedPcbApplyInput {
  /** The candidate proposal — captured and seal-verified here. */
  proposal: unknown;
  /** The LIVE PcbEditor history (canonical-session-bound). */
  history: PcbHistory;
  interlock: ProjectCommitInterlock;
  journal: ApprovedPcbMutationJournal;
  /** Lifecycle currency — false the moment the board/project was replaced. */
  stillCurrent(): boolean;
  currentProjectId: string;
  currentBranchId: string;
  tenantId?: string;
  /** The editor's ACTIVE DRC preset at approval time. */
  activeDrcPresetId: string;
  originRunId?: string | null;
  /** The one-shot human approval capability — consumed exactly once. */
  approval: unknown;
  /** Flush the working-copy autosave; reported truthfully in the outcome. */
  settleAutosave?: () => boolean;
  now?: () => number;
  registry?: ApprovedPcbMutationRegistry;
}

export type ApprovedPcbApplyOutcome =
  | { ok: true; status: "committed"; receipt: PcbMutationReceipt; autosaveSettled: boolean }
  | { ok: true; status: "already-applied"; receipt: PcbMutationReceipt | null }
  | { ok: false; status: "refused"; code: string; message: string };

function refuse(code: string, message: string): ApprovedPcbApplyOutcome {
  return { ok: false, status: "refused", code, message };
}

/** Bounded JSON round-trip capture: what is verified is what is applied —
 *  later caller mutations of the argument cannot alter the captured body.
 *  [B16.0.1] returns the verification refusal code so a LEGACY v1 artifact
 *  refuses with its PRECISE code instead of a generic invalid. */
function captureProposal(candidate: unknown):
  | { ok: true; proposal: SealedPcbEditProposal }
  | { ok: false; code: "proposal-invalid" | "legacy-authorization-missing" } {
  const invalid = { ok: false as const, code: "proposal-invalid" as const };
  let serialized: string;
  try {
    serialized = JSON.stringify(candidate) ?? "";
  } catch {
    return invalid;
  }
  if (serialized.length === 0 || serialized.length > MAX_CAPTURE_BYTES) return invalid;
  let captured: unknown;
  try {
    captured = JSON.parse(serialized);
  } catch {
    return invalid;
  }
  if (typeof captured !== "object" || captured === null) return invalid;
  const verification = verifySealedPcbEditProposalIntegrity(captured);
  if (!verification.ok) {
    // [B16.0.1] the schema gate runs FIRST in the verifier, so the legacy
    // code is reported before any key-set concern.
    if (verification.code === "legacy-authorization-missing") return { ok: false, code: "legacy-authorization-missing" };
    return invalid;
  }
  const keys = Object.keys(captured);
  if (keys.length !== PCB_EDIT_PROPOSAL_KEYS.length || !(PCB_EDIT_PROPOSAL_KEYS as readonly string[]).every((key) => keys.includes(key))) return invalid;
  return { ok: true, proposal: captured as SealedPcbEditProposal };
}

export async function applyApprovedPcbProposal(input: ApprovedPcbApplyInput): Promise<ApprovedPcbApplyOutcome> {
  const now = input.now ?? (() => Date.now());
  const registry = input.registry ?? approvedPcbMutationRegistry;
  const tenantId = input.tenantId ?? "local";

  // 1. Capture + authenticate the seal.
  const capture = captureProposal(input.proposal);
  if (!capture.ok) {
    // [B16.0.1] a legacy v1 artifact refuses with its precise code — never
    // applied, never backfilled with membership authority.
    if (capture.code === "legacy-authorization-missing") {
      return refuse("legacy-authorization-missing", "This is a v1 bounded PCB-edit proposal; v1 predates the membership authorization binding and can no longer be applied. Regenerate the proposal. Nothing was changed.");
    }
    return refuse("proposal-invalid", "The PCB proposal failed integrity verification. Nothing was changed.");
  }
  const proposal = capture.proposal;
  const proposalId = proposal.proposalId;
  const identityKey = pcbProposalIdentityKey(proposal);
  // [B16.0.1 §E] the sealed authorization identity — verified above as part
  // of the seal (schema, scope agreement, principal === effectiveActor).
  const sealedAuthorization = {
    principalId: proposal.authorizationBinding.principalId,
    membershipRevision: proposal.authorizationBinding.membershipRevision,
  };

  // 2. Expiry.
  if (isPcbEditProposalExpired(proposal, now())) {
    return refuse("proposal-expired", "The PCB proposal has expired. Ask for a fresh proposal. Nothing was changed.");
  }

  // 3. Consume the ONE-SHOT human approval BEFORE any journal or canonical
  //    work — a forged, replayed, mismatched, or absent approval refuses
  //    with zero journal entries and zero transactions.
  const consumed = consumePcbEditApprovalIntent(input.approval, {
    proposalBodyDigest: identityKey,
    proposalId,
    scope: { ...proposal.scope },
    canonicalResource: { ...proposal.base.canonicalResource },
    basePcbRevisionId: proposal.base.pcbRevisionId,
    baseBoardDigest: proposal.base.boardDigest,
    baseHeadSequence: proposal.base.historyHead.sequence,
    lineageId: proposal.base.lineageId,
    validationPolicy: {
      presetId: proposal.validationPolicy.presetId,
      presetVersion: proposal.validationPolicy.presetVersion,
      rulesDigest: proposal.validationPolicy.rulesDigest,
    },
    // [B16.0.1 §E] the approval must carry the SAME authorization identity
    // the proposal was sealed under (approval-wrong-authorization otherwise).
    authorization: sealedAuthorization,
    now: now(),
  });
  if (!consumed.ok) {
    return refuse("approval-required", `A live one-shot human approval is required (${consumed.code}). Nothing was changed.`);
  }

  // 4. Live authority checks.
  if (!input.stillCurrent()) return refuse("session-superseded", "The board or project changed while approval was pending. Nothing was changed.");
  if (input.interlock.retired) return refuse("session-superseded", "The project is retiring; the apply was refused. Nothing was changed.");
  if (proposal.scope.tenantId !== tenantId || proposal.scope.projectId !== input.currentProjectId
    || proposal.scope.branchId !== input.currentBranchId
    || proposal.scope.boardInstanceId !== pcbBoardInstanceId(input.currentProjectId)) {
    return refuse("foreign-scope", "The proposal belongs to a different project, branch, or board instance. Nothing was changed.");
  }

  // 5. The canonical session must exist (evidence + commit both need it).
  //    Fine-grained CURRENCY (revision/head/lineage/policy) is deliberately
  //    checked AFTER the replay/recovery disposition below — a proposal that
  //    already committed must answer `already-applied` even though the live
  //    board has (correctly) moved past its base.
  const session = canonicalSessionFor(input.history);
  if (!session) return refuse("session-superseded", "The board has no active canonical editing session. Nothing was changed.");

  // 6. In-memory identity claim (double-click / concurrency).
  const claim = registry.claim(identityKey);
  if (!claim.ok) {
    if (claim.code === "already-applied") return { ok: true, status: "already-applied", receipt: claim.receipt };
    if (claim.code === "already-in-flight") return refuse("already-in-flight", "This proposal is already being applied. Nothing further was changed.");
    return refuse("identity-poisoned", "A previous apply of this proposal could not be verified; it is permanently refused. Regenerate a new proposal.");
  }

  let leaseRelease: (() => void) | null = null;
  let committedButUnfinalized = false;
  try {
    // 8. Durable journal + canonical durable evidence (replay/recovery).
    const journalLookup = await input.journal.lookup(identityKey);
    const evidence = await session.durableIdempotencyEvidence(proposalId);
    if (journalLookup.kind === "unavailable" || evidence.kind === "unavailable") {
      registry.release(identityKey);
      return refuse("recovery-required", "Durable replay evidence is unavailable; the apply was not attempted. Retry when storage is available.");
    }
    if (journalLookup.kind === "corrupt" || evidence.kind === "corrupt") {
      registry.release(identityKey);
      return refuse("recovery-required", "The durable replay records for this proposal are corrupt; the apply was refused. Inspect the canonical history.");
    }
    const journalEntry: ApprovedPcbMutationJournalEntry | null = journalLookup.kind === "entry" ? journalLookup.entry : null;
    if (journalEntry?.state === "poisoned") {
      registry.poison(identityKey);
      return refuse("identity-poisoned", "A previous apply of this proposal could not be verified; it is permanently refused. Regenerate a new proposal.");
    }
    if (journalEntry !== null) {
      // Journal/service coherence: the entry must agree with the
      // AUTHENTICATED proposal on every identity dimension.
      if (journalEntry.proposalId !== proposalId
        || journalEntry.operationsDigest !== proposal.operationsDigest
        || journalEntry.tenantId !== proposal.scope.tenantId
        || journalEntry.projectId !== proposal.scope.projectId
        || journalEntry.branchId !== proposal.scope.branchId
        || journalEntry.boardInstanceId !== proposal.scope.boardInstanceId
        || journalEntry.lineageId !== proposal.base.lineageId
        || journalEntry.basePcbRevisionId !== proposal.base.pcbRevisionId
        || journalEntry.baseBoardDigest !== proposal.base.boardDigest
        || journalEntry.baseHeadSequence !== proposal.base.historyHead.sequence
        // [B16.0.1 §E] a journal entry (and so any receipt it finalizes)
        // recorded under ANOTHER principal or membership revision can never
        // be replayed/adopted for this proposal.
        || journalEntry.authorization.principalId !== sealedAuthorization.principalId
        || journalEntry.authorization.membershipRevision !== sealedAuthorization.membershipRevision) {
        registry.release(identityKey);
        return refuse("recovery-required", "The durable journal entry for this proposal is not coherent with the artifact; the apply was refused. Inspect the canonical history.");
      }
      if (journalEntry.state !== "prepared") {
        // committed/adopted/finalized: the journal claims a commit — the
        // CANONICAL durable history must prove it (never the journal alone).
        if (evidence.kind !== "found" || journalEntry.transactionId === null || evidence.record.transactionId !== journalEntry.transactionId) {
          registry.poison(identityKey);
          return refuse("recovery-required", "The durable journal claims a commit the canonical history cannot prove; the apply is permanently refused for this proposal. Inspect the canonical history.");
        }
        // Authentic recovery: complete the record and return the receipt.
        // [B16.0.1 §E] the commitment covers the authorization identity, so a
        // commit recorded under another principal/revision never matches.
        const commitment = evidence.record.provenanceCandidateId;
        if (commitment === null || commitment !== pcbReceiptCommitmentFor(identityKey, journalEntry.originRunId, journalEntry.committedAt ?? 0, sealedAuthorization)) {
          registry.poison(identityKey);
          return refuse("recovery-required", "The canonical record's chain-protected commitment does not match this proposal's journal entry; recovery is refused. Inspect the canonical history.");
        }
        // Defense in depth: the CANONICAL record must independently prove the
        // landed transaction advanced the head by exactly one — the receipt's
        // result fields are then sourced from the canonical record, never the
        // proposal alone (a landed candidate necessarily advances +1).
        if (evidence.record.resultHeadSequence !== null
          && evidence.record.resultHeadSequence !== proposal.base.historyHead.sequence + 1) {
          registry.poison(identityKey);
          return refuse("recovery-required", "The canonical record's result head does not match the sealed candidate's expected advance; recovery is refused. Inspect the canonical history.");
        }
        if (journalEntry.state === "canonical-committed") await input.journal.markAdopted(identityKey);
        let receipt = journalEntry.receipt;
        if (!receipt) {
          receipt = buildPcbMutationReceipt({
            proposalId, identityKey,
            transactionId: journalEntry.transactionId,
            committedAt: journalEntry.committedAt ?? 0,
            pcbRevisionBefore: journalEntry.pcbRevisionBefore ?? proposal.base.pcbRevisionId,
            pcbRevisionAfter: journalEntry.pcbRevisionAfter ?? proposal.candidateDigest,
            headSequenceAfter: journalEntry.headSequenceAfter ?? proposal.base.historyHead.sequence + 1,
            approvalActor: PCB_APPROVAL_ACTOR,
            authorization: sealedAuthorization,
            commitment,
          });
          await input.journal.finalizeReceipt(identityKey, receipt);
        }
        registry.consume(identityKey, receipt);
        return { ok: true, status: "already-applied", receipt };
      }
      // state === "prepared" with NO canonical evidence: the previous attempt
      // died BEFORE the commit — truthful pre-commit crash; continue below
      // reusing the prepared entry. Prepared WITH evidence: the commit landed
      // but markCommitted never ran — adopt it below.
      if (evidence.kind === "found") {
        const commitment = evidence.record.provenanceCandidateId;
        const resultRevision = evidence.record.resultCanonicalStateDigest;
        if (commitment === null || resultRevision === null) {
          registry.poison(identityKey);
          return refuse("recovery-required", "The canonical record for this proposal is missing its commitment or result; recovery is refused. Inspect the canonical history.");
        }
        // committedAt is unknown (the crash lost it) — recovery derives a
        // deterministic replacement from the durable record identity, and
        // the commitment check pins it.
        const recoveredAt = journalEntry.preparedAt;
        const recoveredCommitment = pcbReceiptCommitmentFor(identityKey, journalEntry.originRunId, recoveredAt, sealedAuthorization);
        if (commitment !== recoveredCommitment) {
          registry.poison(identityKey);
          return refuse("recovery-required", "The canonical record's commitment does not match this prepared journal entry; recovery is refused. Inspect the canonical history.");
        }
        // Defense in depth: the CANONICAL record must prove the landed
        // transaction advanced the head by exactly one before we adopt it.
        if (evidence.record.resultHeadSequence !== null
          && evidence.record.resultHeadSequence !== journalEntry.baseHeadSequence + 1) {
          registry.poison(identityKey);
          return refuse("recovery-required", "The canonical record's result head does not match the sealed candidate's expected advance; recovery is refused. Inspect the canonical history.");
        }
        const marked = await input.journal.markCommitted(identityKey, {
          committedAt: recoveredAt,
          transactionId: evidence.record.transactionId,
          pcbRevisionBefore: journalEntry.basePcbRevisionId,
          pcbRevisionAfter: proposal.candidateDigest,
          headSequenceAfter: journalEntry.baseHeadSequence + 1,
        });
        if (!marked.ok) {
          registry.poison(identityKey);
          return refuse("recovery-required", "The journal could not adopt the proven canonical commit; recovery is refused. Inspect the canonical history.");
        }
        await input.journal.markAdopted(identityKey);
        const receipt = buildPcbMutationReceipt({
          proposalId, identityKey,
          transactionId: evidence.record.transactionId,
          committedAt: recoveredAt,
          pcbRevisionBefore: journalEntry.basePcbRevisionId,
          pcbRevisionAfter: proposal.candidateDigest,
          headSequenceAfter: journalEntry.baseHeadSequence + 1,
          approvalActor: PCB_APPROVAL_ACTOR,
          authorization: sealedAuthorization,
          commitment,
        });
        await input.journal.finalizeReceipt(identityKey, receipt);
        registry.consume(identityKey, receipt);
        return { ok: true, status: "already-applied", receipt };
      }
    }

    // 9. LIVE currency — revision, board digest, history head, lineage, and
    //    validation policy — verified now that replay/recovery has answered.
    const liveBoard = input.history.committedPresent;
    const liveRevision = pcbRevisionId(liveBoard);
    if (liveRevision !== proposal.base.pcbRevisionId || liveRevision !== proposal.base.boardDigest) {
      registry.release(identityKey);
      return refuse("stale-revision", "The board changed since the proposal was created. Ask for a fresh proposal. Nothing was changed.");
    }
    const head = session.headMetadataFor(liveBoard);
    if (!head) {
      registry.release(identityKey);
      return refuse("stale-revision", "The live board is not the canonical session head. Nothing was changed.");
    }
    if (head.headSequence !== proposal.base.historyHead.sequence) {
      registry.release(identityKey);
      return refuse("stale-history", "The board history advanced since the proposal was created. Ask for a fresh proposal. Nothing was changed.");
    }
    if (typeof head.lineageId !== "string" || head.lineageId !== proposal.base.lineageId) {
      registry.release(identityKey);
      return refuse("stale-lineage", "The editing session lineage changed since the proposal was created. Nothing was changed.");
    }
    if (input.activeDrcPresetId !== proposal.validationPolicy.presetId) {
      registry.release(identityKey);
      return refuse("policy-mismatch", `The active DRC preset (${input.activeDrcPresetId}) differs from the proposal's sealed validation policy (${proposal.validationPolicy.presetId}). Ask for a fresh proposal. Nothing was changed.`);
    }
    const resolvedPolicy = resolvePcbValidationPolicy(proposal.validationPolicy.presetId);
    if (!resolvedPolicy
      || resolvedPolicy.policy.presetVersion !== proposal.validationPolicy.presetVersion
      || resolvedPolicy.policy.rulesDigest !== proposal.validationPolicy.rulesDigest) {
      registry.release(identityKey);
      return refuse("policy-mismatch", "The sealed validation policy no longer matches the canonical preset registry. Ask for a fresh proposal. Nothing was changed.");
    }

    // 9b. Commit lease at the execution position.
    const lease = input.interlock.acquireCommitLease();
    if (!lease.ok) {
      registry.release(identityKey);
      return refuse("session-superseded", "The project is retiring; the apply was refused. Nothing was changed.");
    }
    leaseRelease = () => lease.lease.release();

    // 10. RECOMPILE the sealed operations through the canonical compiler
    //     against the LIVE board and BYTE-MATCH every pinned digest.
    const recompiled = compileBoundedPcbEdit({
      board: liveBoard,
      rules: resolvedPolicy.rules,
      baseIdentity: proposal.base.pcbRevisionId,
      payload: { intent: proposal.intent, operations: proposal.operations },
    });
    if (!recompiled.ok) {
      registry.release(identityKey);
      return refuse("recompile-refused", `The sealed operations no longer compile against the live board (${recompiled.code}). Ask for a fresh proposal. Nothing was changed.`);
    }
    if (recompiled.normalizedOperationsDigest !== proposal.operationsDigest
      || recompiled.candidateDigest !== proposal.candidateDigest
      || recompiled.impactDigest !== proposal.impactDigest
      || JSON.stringify(recompiled.mintedObjectIds) !== JSON.stringify(proposal.mintedObjectIds)) {
      registry.release(identityKey);
      return refuse("recompile-mismatch", "The recompiled candidate does not byte-match the sealed proposal. Ask for a fresh proposal. Nothing was changed.");
    }

    // 11. Durable prepare BEFORE the canonical commit. The commitment is
    //     derived from the PREPARED timestamp (reused across a retry of the
    //     same prepared entry), so crash recovery can re-derive and verify
    //     it deterministically from the journal + canonical record alone.
    const committedAt = journalEntry?.preparedAt ?? now();
    const commitment = pcbReceiptCommitmentFor(identityKey, journalEntry?.originRunId ?? input.originRunId ?? null, committedAt, sealedAuthorization);
    if (journalEntry === null) {
      const prepared = await input.journal.prepare({
        identityKey, proposalId,
        operationsDigest: proposal.operationsDigest,
        tenantId: proposal.scope.tenantId,
        projectId: proposal.scope.projectId,
        branchId: proposal.scope.branchId,
        boardInstanceId: proposal.scope.boardInstanceId,
        lineageId: proposal.base.lineageId,
        basePcbRevisionId: proposal.base.pcbRevisionId,
        baseBoardDigest: proposal.base.boardDigest,
        baseHeadSequence: proposal.base.historyHead.sequence,
        validationPolicy: {
          presetId: proposal.validationPolicy.presetId,
          presetVersion: proposal.validationPolicy.presetVersion,
          rulesDigest: proposal.validationPolicy.rulesDigest,
        },
        // [B16.0.1 §E] the sealed authorization identity travels with the
        // durable entry — replay/recovery refuses any divergence.
        authorization: sealedAuthorization,
        originRunId: input.originRunId ?? null,
        operationCount: proposal.operations.length,
        preparedAt: committedAt,
      });
      if (!prepared.ok) {
        registry.release(identityKey);
        return refuse("recovery-required", `The durable journal could not record the prepare (${prepared.reason}); the apply was not attempted. Nothing was changed.`);
      }
    }

    // 12. Exactly ONE canonical transaction. The serialized buildCandidate
    //     re-pins the EXACT base revision — an interleaved commit refuses
    //     with zero mutation.
    const commit = await commitPcbCandidate(input.history, {
      commandId: APPROVED_PCB_COMMAND_ID,
      label: `AI PCB proposal: ${proposal.intent}`.slice(0, 120),
      idempotencyKey: proposalId,
      provenanceCandidateId: commitment,
      metadata: { actor: "ai", reason: `Human-approved bounded PCB edit proposal ${proposalId}` },
      buildCandidate: (board) => {
        if (pcbRevisionId(board) !== proposal.base.pcbRevisionId) {
          throw new Error("The board changed at the serialized commit position; the proposal base is stale.");
        }
        return recompiled.candidate;
      },
    });
    if (!commit.ok) {
      // PRE-COMMIT refusal: the canonical executor rejected with zero
      // mutation. The prepared journal entry stays truthful (a prepared
      // entry with no canonical evidence = nothing changed).
      registry.release(identityKey);
      return refuse("commit-rejected", commit.message);
    }
    if (commit.status === "noop") {
      registry.release(identityKey);
      return refuse("commit-rejected", "The canonical executor reported no effective change; the proposal was not applied.");
    }
    committedButUnfinalized = true;
    const transactionId = commit.transactionId ?? "";
    if (transactionId.length === 0) {
      registry.poison(identityKey);
      await input.journal.poison(identityKey);
      return refuse("recovery-required", "The commit reported success without a transaction identity; the edit may have been applied — recovery required. The board may have changed.");
    }

    // 13. Postconditions on the LIVE result.
    const afterBoard = input.history.committedPresent;
    const afterRevision = pcbRevisionId(afterBoard);
    const afterHead = session.headMetadataFor(afterBoard);
    const postconditionsHold = afterRevision === proposal.candidateDigest
      && afterHead !== null
      && afterHead.headSequence === proposal.base.historyHead.sequence + 1
      && afterHead.lineageId === proposal.base.lineageId;
    if (!postconditionsHold) {
      registry.poison(identityKey);
      await input.journal.poison(identityKey);
      return refuse("recovery-required", "The commit landed but its result does not match the sealed candidate; recovery required. The board HAS changed — inspect the canonical history.");
    }

    // 14–16. Durable committed → adopted → receipt → finalized.
    const marked = await input.journal.markCommitted(identityKey, {
      committedAt, transactionId,
      pcbRevisionBefore: proposal.base.pcbRevisionId,
      pcbRevisionAfter: afterRevision,
      headSequenceAfter: afterHead.headSequence,
    });
    if (!marked.ok) {
      registry.poison(identityKey);
      return refuse("recovery-required", "The edit was committed but its durable record could not be updated; recovery required. The board HAS changed.");
    }
    const adopted = await input.journal.markAdopted(identityKey);
    if (!adopted.ok) {
      registry.poison(identityKey);
      return refuse("recovery-required", "The edit was committed but its durable adoption could not be recorded; recovery required. The board HAS changed.");
    }
    const receipt = buildPcbMutationReceipt({
      proposalId, identityKey, transactionId, committedAt,
      pcbRevisionBefore: proposal.base.pcbRevisionId,
      pcbRevisionAfter: afterRevision,
      headSequenceAfter: afterHead.headSequence,
      approvalActor: PCB_APPROVAL_ACTOR,
      authorization: sealedAuthorization,
      commitment,
    });
    const finalized = await input.journal.finalizeReceipt(identityKey, receipt);
    if (!finalized.ok) {
      registry.poison(identityKey);
      return refuse("recovery-required", "The edit was committed but its receipt could not be finalized; recovery required. The board HAS changed.");
    }
    registry.consume(identityKey, receipt);

    // 17. Autosave settlement BEFORE reporting final success.
    let autosaveSettled = true;
    if (input.settleAutosave) {
      try {
        autosaveSettled = input.settleAutosave() === true;
      } catch {
        autosaveSettled = false;
      }
    }
    return { ok: true, status: "committed", receipt, autosaveSettled };
  } catch (error) {
    // An unexpected throw after the canonical commit may have landed —
    // poison, never claim nothing changed.
    if (committedButUnfinalized) {
      registry.poison(identityKey);
      try { await input.journal.poison(identityKey); } catch { /* fail-closed already */ }
      return refuse("recovery-required", `The apply failed after the commit phase (${error instanceof Error ? error.message : String(error)}); recovery required. The board may have changed.`);
    }
    registry.release(identityKey);
    return refuse("apply-failed", `The apply failed before any commit (${error instanceof Error ? error.message : String(error)}). Nothing was changed.`);
  } finally {
    leaseRelease?.();
  }
}
