/**
 * [B16-A F2] Atomic qualification commit: the routed board and the sealed
 * manufacturing authority are written in ONE durable commit.
 *
 * Reproduced defect: qualification published the routed board durably inside
 * the layout's `commitSelected` callback BEFORE the RC01 parity gate, the RC02
 * evidence gate and the authority save. A failure after that point (parity
 * refusal, missing evidence, a durable-store outage on the authority write)
 * returned a bounded refusal whose wording said "Nothing was changed" while
 * the authoritative board had already been replaced by the routed revision
 * and no authority described it.
 *
 * Now every gate runs on the candidate in memory, and the board publication
 * and the authority publication are two operations of one durable commit
 * (transactional in the PostgreSQL repository; all-or-nothing in the
 * in-memory repository), each compare-and-swapped against the revision the
 * qualification read. Either both land or neither does.
 */

import type { DurableWorkflowRepository } from "../../durable-workflow/types";
import { durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../../durable-workflow/stable";
import { boardPublicationOperation } from "../../pcb-sync/durable";
import type { PcbSyncBoardRecord } from "../../pcb-sync/types";
import { authorityPublicationOperation, manufacturingAuthorityRecordDigest } from "./authority-store";
import type { ManufacturingReleaseAuthority } from "./release-gate";

export interface QualificationCommitInput {
  boardRecord: PcbSyncBoardRecord;
  /** The board aggregate revision the qualification READ (compare-and-swap). */
  expectedBoardAggregateRevision: number;
  authority: ManufacturingReleaseAuthority;
  /** The authority aggregate revision the qualification READ (0 when none exists). */
  expectedAuthorityRevision: number;
  idempotencyKey: string;
  committedAt: string;
}

export interface QualificationCommitResult {
  boardRevision: string;
  boardAggregateRevision: number;
  authorityRevision: number;
  authorityRecordDigest: string;
  idempotent: boolean;
}

export class QualificationCommitError extends Error {
  constructor(readonly code: "MFG_QUALIFICATION_COMMIT_UNVERIFIED", message: string) { super(message); this.name = "QualificationCommitError"; }
}

export async function commitQualification(workflow: DurableWorkflowRepository, input: QualificationCommitInput): Promise<QualificationCommitResult> {
  const record = input.boardRecord;
  if (input.authority.boardRevision !== record.revision || input.authority.boardId !== record.boardId || input.authority.tenantId !== record.tenantId || input.authority.projectId !== record.projectId || input.authority.branchId !== record.branchId) {
    throw new Error("MFG_AUTHORITY_SCOPE_INVALID");
  }
  const board = boardPublicationOperation(record, input.expectedBoardAggregateRevision);
  const authority = authorityPublicationOperation(input.authority, input.expectedAuthorityRevision);
  const scope = authority.scope;
  const committed = await workflow.commit({
    scope,
    scopeKey: durableScopeKey(scope, `mfg-qualification:${record.boardId}`),
    idempotencyKey: input.idempotencyKey,
    operations: [board, authority.operation],
    outbox: [authority.effect],
    result: { boardRevision: record.revision, authorityRecordDigest: authority.recordDigest },
    committedAt: input.committedAt,
  });
  // Post-commit verification: both heads must be exactly what was written.
  const boardHead = await workflow.loadHead<PcbSyncBoardRecord>(durableAggregateIdentity(scope, board.aggregateType, board.aggregateKey));
  const authorityHead = await workflow.loadHead<ManufacturingReleaseAuthority>(durableAggregateIdentity(scope, authority.operation.aggregateType, authority.operation.aggregateKey));
  if (!boardHead || boardHead.recordDigest !== record.digest || boardHead.payload.revision !== record.revision) {
    throw new QualificationCommitError("MFG_QUALIFICATION_COMMIT_UNVERIFIED", "board head does not carry the committed routed board");
  }
  if (!authorityHead || authorityHead.recordDigest !== authority.recordDigest || manufacturingAuthorityRecordDigest(authorityHead.payload) !== authority.recordDigest) {
    throw new QualificationCommitError("MFG_QUALIFICATION_COMMIT_UNVERIFIED", "authority head does not carry the committed authority");
  }
  return { boardRevision: record.revision, boardAggregateRevision: boardHead.revision, authorityRevision: authorityHead.revision, authorityRecordDigest: authority.recordDigest, idempotent: committed.idempotent };
}

/** Deterministic idempotency key for one (source board → routed board, component authority) qualification. */
export function qualificationIdempotencyKey(input: { boardId: string; sourceRevision: string; routedRevision: string; componentAuthorityDigest: string }): string {
  return `qualify:${input.boardId}:${input.sourceRevision}->${input.routedRevision}:${durableWorkflowId("mfg-qualification-key", input).slice(-16)}`;
}
