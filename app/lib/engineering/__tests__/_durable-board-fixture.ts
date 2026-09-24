/**
 * [B20 B3] The durable-board fixture of the B3 suites: a small, structurally valid board with synchronized footprints (a
 * `syncIdentity` naming a schematic component instance) and board-only ones (none), nets, tracks and vias, at stackup 2 or 4;
 * and the two durable writers the suites seed it through — `DurablePcbSyncRepository.publishBoard` (the root board) and
 * `deriveBoardRevision` (a derived generation, the parent superseded in the same commit). No database: every workflow is
 * the in-memory durable repository.
 */
import type { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import type { DurableWorkflowRepository } from "../../durable-workflow/types";
import { pcbBoardInstanceId, pcbBoardLineageOf, pcbDerivedBoardInstanceId } from "../../pcb/board-identity";
import { createEmptyBoard, type FootprintInstance, type PcbBoard } from "../../pcb/types";
import { makeBoardRecord } from "../../pcb-sync/board";
import { deriveBoardRevision } from "../../pcb-sync/board-lineage";
import type { BoardRevisionPlan } from "../../pcb-sync/board-revision";
import { DurablePcbSyncRepository } from "../../pcb-sync/durable";
import type { PcbSyncBoardRecord } from "../../pcb-sync/types";
import type { AuthorityBindingAggregate, ComponentAuthoritySourceDeps } from "../component-authority-source";
import type { EngineeringActor } from "../types";
import { matchingAtomicConfirmer, validApprovedAggregate } from "./_authority-fixtures";

export const FIXTURE_SCOPE = Object.freeze({ tenantId: "local", projectId: "proj-mcp", branchId: "main" });
export type FixtureScope = { tenantId: string; projectId: string; branchId: string };
export const FIXTURE_UPDATED_AT = "2026-09-21T12:00:00.000Z";
const ACTOR: EngineeringActor = { actorId: "user-fixture", actorKind: "human", sessionId: "session-fixture", role: "project_admin" };

export function syncIdentityFor(componentInstanceId: string): NonNullable<FootprintInstance["syncIdentity"]> {
  return {
    componentInstanceId,
    bindingRevisionId: `binding-rev:${componentInstanceId}`,
    footprintAssetVersionId: "asset-version:fixture",
    footprintContentDigest: "fixture-content-digest",
    mappingCertificateId: `mapping:${componentInstanceId}`,
    symbolAssetVersionId: "symbol-version:fixture",
    syncPlanId: "sync-plan:fixture",
  };
}

export function fixtureFootprint(id: string, x: number, componentInstanceId?: string): FootprintInstance {
  return {
    id, ref: id.toUpperCase(), footprintId: "fixture:empty",
    def: {
      libName: "fixture", name: "empty",
      attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
      pads: [], graphics: [], bodyBBox: { minX: -500_000, minY: -500_000, maxX: 500_000, maxY: 500_000 },
      models: [], rawSexpr: "(footprint fixture)",
    },
    at: { x, y: 2_000_000 }, rotationDeg: 0, side: "top", padNets: {},
    ...(componentInstanceId ? { syncIdentity: syncIdentityFor(componentInstanceId) } : {}),
  };
}

export interface FixtureBoardOptions {
  stackup?: 2 | 4;
  /** component instance ids of the synchronized footprints (default sync-u1, sync-u2) */
  synced?: readonly string[];
  /** board-only footprints without a syncIdentity (default 1) */
  unsynced?: number;
  /** a label that changes the board's content (a different track end) */
  variant?: number;
  netNames?: readonly string[];
}

/** The fixture board: nets 0 (unconnected), SIG, /root/VCC and +3V3; one track on SIG; one via on /root/VCC. */
export function durableBoardFixture(options: FixtureBoardOptions = {}): PcbBoard {
  const board = createEmptyBoard();
  board.stackup = options.stackup ?? 2;
  const names = options.netNames ?? ["SIG", "/root/VCC", "+3V3"];
  names.forEach((name, index) => board.nets.push({ id: index + 1, name, stableId: `net:${index + 1}`, endpointKeys: [] }));
  const synced = options.synced ?? ["sync-u1", "sync-u2"];
  synced.forEach((componentInstanceId, index) => board.footprints.push(fixtureFootprint(`u${index + 1}`, 2_000_000 + index * 1_000_000, componentInstanceId)));
  for (let index = 0; index < (options.unsynced ?? 1); index += 1) board.footprints.push(fixtureFootprint(`h${index + 1}`, 60_000_000 + index * 100_000));
  board.tracks.push({ id: "t1", layer: "copperTop", width: 250_000, start: { x: 1_000_000, y: 3_000_000 }, end: { x: 5_000_000 + (options.variant ?? 0) * 100_000, y: 3_000_000 }, netId: 1, source: "human" });
  board.vias.push({ id: "v1", at: { x: 3_000_000, y: 3_000_000 }, size: 600_000, drill: 300_000, netId: Math.min(2, names.length), layers: ["copperTop", "copperBottom"] });
  return board;
}

/** Publish `board` as the root board `board:<projectId>` (or `boardId`) through the production durable repository. */
export async function publishDurableBoard(workflow: DurableWorkflowRepository, scope: FixtureScope, board: PcbBoard, options: { boardId?: string; expectedRevision?: number; key?: string; updatedAt?: string } = {}): Promise<PcbSyncBoardRecord> {
  const record = makeBoardRecord({ ...scope, boardId: options.boardId ?? pcbBoardInstanceId(scope.projectId), board, updatedAt: options.updatedAt ?? FIXTURE_UPDATED_AT });
  await new DurablePcbSyncRepository(workflow).publishBoard(record, { expectedRevision: options.expectedRevision ?? 0, idempotencyKey: options.key ?? `seed:${record.boardId}:${record.digest.slice(4, 20)}:${options.expectedRevision ?? 0}` });
  return record;
}

/**
 * Derive the next generation of `parent` holding `next` through the production `deriveBoardRevision` commit (the child
 * current, the parent superseded), as the B16-C.1 service does; `derivedBoardId` defaults to `<root>@r<generation>`.
 */
export async function deriveDurableGeneration(workflow: InMemoryDurableWorkflowRepository | DurableWorkflowRepository, parent: PcbSyncBoardRecord, next: PcbBoard, options: { derivedBoardId?: string } = {}): Promise<PcbSyncBoardRecord> {
  const lineage = pcbBoardLineageOf(parent.boardId);
  const generation = lineage.generation + 1;
  const derivedBoardId = options.derivedBoardId ?? pcbDerivedBoardInstanceId(lineage.rootBoardId, generation);
  const scope = { tenantId: parent.tenantId, projectId: parent.projectId, branchId: parent.branchId };
  const derived = makeBoardRecord({ ...scope, boardId: derivedBoardId, board: next, updatedAt: FIXTURE_UPDATED_AT });
  const plan = {
    planId: `plan-${generation}-${derived.digest.slice(4, 16)}`,
    planDigest: `plan-digest-${generation}`,
    parent: { boardId: parent.boardId, revision: parent.revision, digest: parent.digest, generation: lineage.generation, rootBoardId: lineage.rootBoardId },
    derivedBoardId,
    derived: { revision: derived.revision, digest: derived.digest },
    generation,
    carry: {},
    snapshot: { snapshotDigest: "snapshot-fixture" },
  } as unknown as BoardRevisionPlan;
  await deriveBoardRevision(workflow, { plan, strippedBoard: next, finalBoard: next, parent, actor: ACTOR, at: FIXTURE_UPDATED_AT, idempotencyKey: `derive:${derivedBoardId}`, syncPlan: null });
  return derived;
}

/** The ten methods of the durable repository contract (the suites spy on each). */
export const DURABLE_WORKFLOW_METHODS = ["loadHead", "listHeads", "loadRecord", "history", "getReplay", "commit", "claimOutbox", "completeOutbox", "failOutbox", "listOutbox"] as const;

/**
 * A server-owned component-authority source for `componentIds` under the durable board's scope (`board:<projectId>`, the
 * shared hierarchy and variant): genuinely valid approved aggregates produced through the real physical-binding service,
 * and an atomic confirmer that agrees with them. Every other component answers no aggregate.
 */
export async function durableAuthoritySource(componentIds: readonly string[], scope: FixtureScope = FIXTURE_SCOPE): Promise<ComponentAuthoritySourceDeps & { requested: string[] }> {
  const aggregates = new Map<string, AuthorityBindingAggregate>();
  for (const id of componentIds) {
    aggregates.set(id, await validApprovedAggregate(id, { scopeOverrides: { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, boardInstanceId: pcbBoardInstanceId(scope.projectId), hierarchyPath: ["root"] } }));
  }
  const requested: string[] = [];
  return {
    requested,
    bindings: { loadForComponent: async (componentScope) => { requested.push(componentScope.componentInstanceId); const found = aggregates.get(componentScope.componentInstanceId); return found ? [structuredClone(found)] : []; } },
    atomic: matchingAtomicConfirmer(),
  };
}
