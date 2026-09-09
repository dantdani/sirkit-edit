/**
 * [B16-C.1] Durable BOARD LINEAGE — which board revision is current for a
 * lineage root, and which ones are superseded.
 *
 *  - one aggregate per board id (`pcb-sync.board-lineage.v1`), written in the
 *    SAME durable commit as the derived board's first record, so a derived
 *    board can never exist without its parent being marked superseded (and
 *    vice versa);
 *  - a superseded board keeps its record, its qualification authority and its
 *    release ledger immutably; but qualification, release and synchronization
 *    against it are refused (`MFG_BOARD_SUPERSEDED` / `PS_BOARD_SUPERSEDED`),
 *    so an old release or authority can never become current again;
 *  - `resolveCurrent` follows `supersededBy` from any board id to the current
 *    revision of its lineage (bounded), which is how a fresh browser that only
 *    knows the root id finds the board it should work on.
 */

import { durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableAppendOperation, DurableOutboxEffect, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";
import { pcbBoardLineageOf } from "../pcb/board-identity";
import type { PcbBoard } from "../pcb/types";
import { makeBoardRecord } from "./board";
import type { BoardRevisionCarry, BoardRevisionPlan } from "./board-revision";
import { boardPublicationOperation, synchronizationRecordOperations } from "./durable";
import type { EngineeringActor } from "../engineering/types";
import { pcbSyncDigest } from "./stable";
import type { PcbSyncBoardRecord, PcbSyncPlan } from "./types";

export const BOARD_LINEAGE_AGGREGATE = "pcb-sync.board-lineage.v1" as const;
export const BOARD_LINEAGE_SCHEMA = "sirkit.pcb-board-lineage.v1" as const;
/** Longest chain `resolveCurrent` will follow (a lineage this deep is a defect, not a product state). */
export const BOARD_LINEAGE_MAX_DEPTH = 64;

export interface PcbBoardLineageRecord {
  schemaVersion: typeof BOARD_LINEAGE_SCHEMA;
  tenantId: string;
  projectId: string;
  branchId: string;
  boardId: string;
  rootBoardId: string;
  generation: number;
  state: "current" | "superseded";
  parent: { boardId: string; revision: string; digest: string } | null;
  supersededBy: { boardId: string; revision: string; digest: string; at: string; by: string; planId: string; planDigest: string } | null;
  derivedAt: string | null;
  derivedBy: string | null;
  derivation: { planId: string; planDigest: string; carry: BoardRevisionCarry; snapshotDigest: string; strippedRevision: string; syncPlan: { planId: string; planDigest: string } | null } | null;
  recordDigest: string;
}

export interface PcbBoardLineageScope { tenantId: string; projectId: string; branchId: string }

/** The projection a board load / manufacturing summary carries to the browser. */
export interface PcbBoardLineageSummary { boardId: string; rootBoardId: string; generation: number; state: "current" | "superseded"; supersededBy: string | null; parentBoardId: string | null; currentBoardId: string }

function workflowScope(scope: PcbBoardLineageScope): DurableWorkflowScope { return { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId }; }
function lineageKey(scope: PcbBoardLineageScope, boardId: string): string { return durableWorkflowId("pcb-board-lineage", { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, boardId }); }
function seal(input: Omit<PcbBoardLineageRecord, "recordDigest"> & { recordDigest?: string }): PcbBoardLineageRecord {
  // A record re-sealed from an earlier one must not digest the earlier digest.
  const { recordDigest: _previous, ...content } = input; void _previous;
  return { ...content, recordDigest: pcbSyncDigest(content) };
}

/** The implicit lineage record of a board that was never derived from or superseded (generation from its id). */
export function implicitLineage(scope: PcbBoardLineageScope, boardId: string): PcbBoardLineageRecord {
  const { rootBoardId, generation } = pcbBoardLineageOf(boardId);
  return seal({ schemaVersion: BOARD_LINEAGE_SCHEMA, ...workflowScope(scope), boardId, rootBoardId, generation, state: "current", parent: null, supersededBy: null, derivedAt: null, derivedBy: null, derivation: null });
}

export class DurableBoardLineageStore {
  constructor(private readonly workflow: DurableWorkflowRepository) {}

  async get(scope: PcbBoardLineageScope, boardId: string): Promise<{ record: PcbBoardLineageRecord; revision: number } | null> {
    const head = await this.workflow.loadHead<PcbBoardLineageRecord>(durableAggregateIdentity(workflowScope(scope), BOARD_LINEAGE_AGGREGATE, lineageKey(scope, boardId)));
    if (!head) return null;
    const record = head.payload;
    const { recordDigest, ...content } = record;
    if (pcbSyncDigest(content) !== recordDigest || head.recordDigest !== recordDigest) throw new Error("PS_BOARD_LINEAGE_DIGEST_MISMATCH");
    return { record: structuredClone(record), revision: head.revision };
  }

  /** The record, or the implicit "current, generation from id" record when none was ever written. */
  async describe(scope: PcbBoardLineageScope, boardId: string): Promise<PcbBoardLineageRecord> {
    return (await this.get(scope, boardId))?.record ?? implicitLineage(scope, boardId);
  }

  /** Follow `supersededBy` to the CURRENT board of this lineage. */
  async resolveCurrent(scope: PcbBoardLineageScope, boardId: string): Promise<PcbBoardLineageSummary> {
    let record = await this.describe(scope, boardId);
    const start = record;
    for (let depth = 0; record.state === "superseded" && record.supersededBy; depth++) {
      if (depth >= BOARD_LINEAGE_MAX_DEPTH) throw new Error("PS_BOARD_LINEAGE_TOO_DEEP");
      record = await this.describe(scope, record.supersededBy.boardId);
    }
    return { boardId: start.boardId, rootBoardId: start.rootBoardId, generation: start.generation, state: start.state, supersededBy: start.supersededBy?.boardId ?? null, parentBoardId: start.parent?.boardId ?? null, currentBoardId: record.boardId };
  }
}

function derivationScopeKey(scope: PcbBoardLineageScope, rootBoardId: string): string { return durableScopeKey(workflowScope(scope), `pcb-board-derivation:${rootBoardId}`); }

/** A derivation already committed under this idempotency key (checked BEFORE recomputing anything — the parent is superseded by then). */
export async function replayBoardDerivation(workflow: DurableWorkflowRepository, scope: PcbBoardLineageScope, parentBoardId: string, idempotencyKey: string): Promise<{ boardId: string; revision: string } | null> {
  const replay = await workflow.getReplay<{ boardId: string; revision: string }>(workflowScope(scope), derivationScopeKey(scope, pcbBoardLineageOf(parentBoardId).rootBoardId), idempotencyKey);
  return replay ? { boardId: replay.result.boardId, revision: replay.result.revision } : null;
}

export interface DeriveBoardRevisionInput {
  plan: BoardRevisionPlan;
  /** The board the plan describes (parent minus everything that failed the proof) — must match `plan.derived`. */
  strippedBoard: PcbBoard;
  /** The board actually persisted: the stripped board with the reviewed structural sync applied. */
  finalBoard: PcbBoard;
  parent: PcbSyncBoardRecord;
  actor: EngineeringActor;
  at: string;
  idempotencyKey: string;
  /** The structural sync applied to the stripped board in this same commit (null when the derived board needed no operations). */
  syncPlan: PcbSyncPlan | null;
}

export interface DeriveBoardRevisionResult {
  derived: PcbSyncBoardRecord;
  lineage: { child: PcbBoardLineageRecord; parent: PcbBoardLineageRecord };
  idempotent: boolean;
}

/**
 * ONE durable commit: the derived board's first record (expected revision 0 —
 * a board with that id must not exist), the child lineage (current) and the
 * parent lineage (superseded). Refused when the parent is already superseded,
 * when the parent's record is not what the plan was computed from, or when
 * the plan's derived digest does not match the board being written.
 */
export async function deriveBoardRevision(workflow: DurableWorkflowRepository, input: DeriveBoardRevisionInput): Promise<DeriveBoardRevisionResult> {
  const { plan, parent } = input;
  const scope: PcbBoardLineageScope = { tenantId: parent.tenantId, projectId: parent.projectId, branchId: parent.branchId };
  if (plan.parent.boardId !== parent.boardId || plan.parent.revision !== parent.revision || plan.parent.digest !== parent.digest) throw new Error("PS_BOARD_REVISION_PARENT_STALE");
  const stripped = makeBoardRecord({ ...scope, boardId: plan.derivedBoardId, board: input.strippedBoard, updatedAt: input.at });
  if (stripped.revision !== plan.derived.revision || stripped.digest !== plan.derived.digest) throw new Error("PS_BOARD_REVISION_PLAN_MISMATCH");
  const derived = makeBoardRecord({ ...scope, boardId: plan.derivedBoardId, board: input.finalBoard, updatedAt: input.at });
  const store = new DurableBoardLineageStore(workflow);
  const parentHead = await store.get(scope, parent.boardId);
  const parentLineage = parentHead?.record ?? implicitLineage(scope, parent.boardId);
  if (parentLineage.state === "superseded") throw new Error(`PS_BOARD_SUPERSEDED:${parentLineage.supersededBy?.boardId ?? "unknown"}`);
  if (parentLineage.generation !== plan.parent.generation || parentLineage.rootBoardId !== plan.parent.rootBoardId) throw new Error("PS_BOARD_REVISION_LINEAGE_MISMATCH");
  const child = seal({
    schemaVersion: BOARD_LINEAGE_SCHEMA, ...workflowScope(scope), boardId: derived.boardId, rootBoardId: plan.parent.rootBoardId, generation: plan.generation, state: "current",
    parent: { boardId: parent.boardId, revision: parent.revision, digest: parent.digest }, supersededBy: null, derivedAt: input.at, derivedBy: input.actor.actorId,
    derivation: { planId: plan.planId, planDigest: plan.planDigest, carry: { ...plan.carry }, snapshotDigest: plan.snapshot.snapshotDigest, strippedRevision: stripped.revision, syncPlan: input.syncPlan ? { planId: input.syncPlan.planId, planDigest: input.syncPlan.planDigest } : null },
  });
  const superseded = seal({ ...parentLineage, state: "superseded", supersededBy: { boardId: derived.boardId, revision: derived.revision, digest: derived.digest, at: input.at, by: input.actor.actorId, planId: plan.planId, planDigest: plan.planDigest } });
  const { recordDigest: _c, ...childContent } = child; void _c;
  const { recordDigest: _p, ...parentContent } = superseded; void _p;
  const synchronization = input.syncPlan ? synchronizationRecordOperations({ scope: { ...scope, boardId: derived.boardId }, plan: input.syncPlan, actor: input.actor, record: derived, originalBoardRevision: stripped.revision, completedAt: input.at, idempotencyKey: input.idempotencyKey }) : null;
  const operations: Array<DurableAppendOperation<object>> = [
    boardPublicationOperation(derived, 0),
    ...(synchronization?.operations ?? []),
    { aggregateType: BOARD_LINEAGE_AGGREGATE, aggregateKey: lineageKey(scope, derived.boardId), expectedRevision: 0, payload: structuredClone(child), recordDigest: child.recordDigest },
    { aggregateType: BOARD_LINEAGE_AGGREGATE, aggregateKey: lineageKey(scope, parent.boardId), expectedRevision: parentHead?.revision ?? 0, payload: structuredClone(superseded), recordDigest: superseded.recordDigest },
  ];
  void childContent; void parentContent;
  const effect: DurableOutboxEffect = { owner: { aggregateType: BOARD_LINEAGE_AGGREGATE, aggregateKey: lineageKey(scope, derived.boardId) }, eventType: "pcb-sync.board-derived", eventVersion: 1, topic: "pcb-sync.board-derived", payload: { boardId: derived.boardId, parentBoardId: parent.boardId, generation: plan.generation, planId: plan.planId } };
  try {
    const committed = await workflow.commit<{ boardId: string; revision: string }>({
      scope: workflowScope(scope), scopeKey: derivationScopeKey(scope, plan.parent.rootBoardId), idempotencyKey: input.idempotencyKey,
      operations, outbox: [effect], result: { boardId: derived.boardId, revision: derived.revision }, committedAt: input.at,
    });
    if (committed.result.boardId !== derived.boardId || committed.result.revision !== derived.revision) throw new Error("PS_BOARD_REVISION_IDEMPOTENCY_CONFLICT");
    return { derived, lineage: { child, parent: superseded }, idempotent: committed.idempotent };
  } catch (error) {
    if (error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT") throw new Error("PS_BOARD_REVISION_CONFLICT");
    throw error;
  }
}
