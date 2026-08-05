import { describe, expect, it, vi } from "vitest";

vi.mock("../../footprint-resolver/__tests__/fixtures", async () => {
  const { InMemoryPhysicalBindingRepository, PhysicalBindingService } = await import("../../physical-binding/repository");
  const { createApprovedValidation } = await import("../../physical-binding/transitions");
  const { ACTOR, exactCandidate, transition } = await import("../../physical-binding/__tests__/fixtures");
  return { readyRepository: async (componentId = "resolver-ready") => {
    const repository = new InMemoryPhysicalBindingRepository(), service = new PhysicalBindingService(repository), candidate = exactCandidate(componentId);
    let state = await service.createCandidate(candidate, `create-${candidate.bindingId}`), request = transition(candidate, state.set.revision, "select", ACTOR);
    request.decisionEvidenceRefs = ["evidence-datasheet"];
    state = await service.transition(state.set.setId, request);
    let current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
    request = transition(current, state.set.revision, "revalidate", ACTOR);
    request.validation = createApprovedValidation(current, { validatorVersion: "physical-binding-validator/1", at: request.at, evidenceRefs: ["evidence-mapping"] });
    state = await service.transition(state.set.setId, request);
    current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
    request = transition(current, state.set.revision, "approve", ACTOR);
    request.decisionEvidenceRefs = ["evidence-datasheet"];
    state = await service.transition(state.set.setId, request);
    return { repository, binding: state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)! };
  } };
});

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import type { DurableWorkflowRepository } from "../../durable-workflow/types";
import { makeBoardRecord } from "../../pcb-sync/board";
import { DurablePcbSyncRepository, DurablePcbSyncSnapshotStore } from "../../pcb-sync/durable";
import { PcbSynchronizationService } from "../../pcb-sync/service";
import { authoritativeSnapshotDigest, canonicalAuthoritativeSnapshot } from "../../pcb-sync/stable";
import type { PcbSyncAuthoritativeSnapshot } from "../../pcb-sync/types";
import { applyRequest, preflightRequest, readyHarness } from "../../pcb-sync/__tests__/fixtures";

const scope = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" };

function snapshotRevision(source: PcbSyncAuthoritativeSnapshot, revision: number): PcbSyncAuthoritativeSnapshot {
  const clone = structuredClone(source);
  clone.designId = "r05-design";
  clone.projectRevision = `r05-project-r${revision}`;
  clone.designRevision = `r05-design-r${revision}`;
  clone.schematicRevision = `r05-schematic-r${revision}`;
  clone.schematicDigest = `r05-schematic-digest-r${revision}`;
  clone.componentSetRevision = `r05-components-r${revision}`;
  clone.netGraphRevision = `r05-net-graph-r${revision}`;
  clone.netGraphDigest = `r05-net-graph-digest-r${revision}`;
  const { snapshotDigest: _digest, ...base } = clone;
  void _digest;
  const canonical = canonicalAuthoritativeSnapshot(base);
  return { ...canonical, snapshotDigest: authoritativeSnapshotDigest(canonical) };
}

async function exerciseDurableIdentity(
  workflow: DurableWorkflowRepository,
  recreateWorkflow: () => DurableWorkflowRepository,
): Promise<{ boardRevision: string; boardDigest: string; originalStableNetId: string }> {
  const source = await readyHarness();
  const snapshots = new DurablePcbSyncSnapshotStore(workflow), repository = new DurablePcbSyncRepository(workflow);
  let now = "2026-07-19T12:01:00.000Z";
  const service = new PcbSynchronizationService({ snapshotProvider: snapshots, resolver: source.resolver, resourceProvider: source.resourceProvider, repository, clock: () => now });
  const base = snapshotRevision(source.snapshot, 1);
  await snapshots.publish(base, { expectedRevision: 0, idempotencyKey: "r05-publish-1", requestId: "r05-publish-1", boardId: scope.boardId, actorId: "r05-human", publishedAt: "2026-07-19T12:00:00.000Z" });
  const firstPreflight = await service.preflight(preflightRequest({
    requestId: "r05-preflight-1",
    designId: base.designId,
    schematicRevision: base.schematicRevision,
    target: { kind: "new_board", boardId: scope.boardId, boardName: "R05 Board", boardFormatVersion: "sirkit-json-pcb/1" },
    requestedAt: "2026-07-19T12:00:30.000Z",
  }));
  expect(firstPreflight.status, JSON.stringify({ blockers: firstPreflight.blockers, resolver: firstPreflight.resolverBatchSummary })).toBe("ready_to_apply");
  const firstApply = await service.apply(applyRequest(firstPreflight.plan!, { requestId: "r05-apply-1", designId: base.designId, boardId: scope.boardId, idempotencyKey: "r05-apply-1", requestedAt: now }));
  expect(firstApply.status).toBe("applied");

  const committed = (await repository.getBoard(scope))!;
  const originalNet = committed.board.nets.find((net) => net.stableId === "stable-net-1")!;
  const routedBoard = structuredClone(committed.board);
  routedBoard.tracks.push({ id: "r05-track", layer: "copperTop", width: 250_000, start: { x: 1_000_000, y: 1_000_000 }, end: { x: 4_000_000, y: 1_000_000 }, netId: originalNet.id, source: "human" });
  routedBoard.vias.push({ id: "r05-via", at: { x: 4_000_000, y: 1_000_000 }, size: 800_000, drill: 400_000, netId: originalNet.id, layers: ["copperTop", "copperBottom"], source: "human" });
  routedBoard.zones.push({ id: "r05-zone", layer: "copperTop", netId: originalNet.id, source: "user", polygon: [{ x: 0, y: 0 }, { x: 6_000_000, y: 0 }, { x: 0, y: 6_000_000 }], appearance: "solid", connection: "thermal", fill: [], dirty: true });
  const routedRecord = makeBoardRecord({ ...scope, board: routedBoard, updatedAt: "2026-07-19T12:02:00.000Z" });
  await repository.publishBoard(routedRecord, { expectedRevision: 1, idempotencyKey: "r05-route-copper" });

  const inserted = snapshotRevision(base, 2);
  inserted.nets.push({ stableNetId: "aaa-stable-net", connectivityRevision: "r05-net-a-r1", canonicalScope: [], displayName: "AAA", aliases: [], classification: "signal", members: [], explicitNoConnectPinIds: [], constraintRefs: [] });
  const canonicalInserted = snapshotRevision(inserted, 2);
  await snapshots.publish(canonicalInserted, { expectedRevision: 1, idempotencyKey: "r05-publish-2", requestId: "r05-publish-2", boardId: scope.boardId, actorId: "r05-human", publishedAt: "2026-07-19T12:03:00.000Z" });
  now = "2026-07-19T12:04:00.000Z";
  const insertPreflight = await service.preflight(preflightRequest({ requestId: "r05-preflight-2", designId: canonicalInserted.designId, schematicRevision: canonicalInserted.schematicRevision, target: { kind: "existing_board", boardId: scope.boardId, expectedBoardRevision: routedRecord.revision }, requestedAt: "2026-07-19T12:03:30.000Z" }));
  expect(insertPreflight.status).toBe("ready_to_apply");
  const insertApply = await service.apply(applyRequest(insertPreflight.plan!, { requestId: "r05-apply-2", designId: canonicalInserted.designId, boardId: scope.boardId, idempotencyKey: "r05-apply-2", requestedAt: now }));
  expect(insertApply.status).toBe("applied");
  const afterInsertion = (await repository.getBoard(scope))!;
  const stableIdByNumeric = new Map(afterInsertion.board.nets.map((net) => [net.id, net.stableId]));
  for (const object of [...afterInsertion.board.tracks, ...afterInsertion.board.vias, ...afterInsertion.board.zones]) expect(stableIdByNumeric.get(object.netId)).toBe("stable-net-1");
  expect(afterInsertion.board.tracks).toEqual(routedBoard.tracks);
  expect(afterInsertion.board.vias).toEqual(routedBoard.vias);
  expect(afterInsertion.board.zones).toEqual(routedBoard.zones);

  const deleted = snapshotRevision(canonicalInserted, 3);
  deleted.nets = deleted.nets.filter((net) => net.stableNetId !== "aaa-stable-net");
  const canonicalDeleted = snapshotRevision(deleted, 3);
  await snapshots.publish(canonicalDeleted, { expectedRevision: 2, idempotencyKey: "r05-publish-3", requestId: "r05-publish-3", boardId: scope.boardId, actorId: "r05-human", publishedAt: "2026-07-19T12:05:00.000Z" });
  const deletePreflight = await service.preflight(preflightRequest({ requestId: "r05-preflight-3", designId: canonicalDeleted.designId, schematicRevision: canonicalDeleted.schematicRevision, target: { kind: "existing_board", boardId: scope.boardId, expectedBoardRevision: afterInsertion.revision }, requestedAt: "2026-07-19T12:05:30.000Z" }));
  expect(deletePreflight.status).toBe("blocked_net_integrity");
  expect(deletePreflight.blockers.map((item) => item.code)).toContain("PS_REMOVED_NET_RECONCILIATION_REQUIRED");
  expect(await repository.getBoard(scope)).toEqual(afterInsertion);

  const mismatched = snapshotRevision(canonicalDeleted, 4);
  mismatched.components[0]!.pins[1]!.number = "3";
  const canonicalMismatched = snapshotRevision(mismatched, 4);
  await snapshots.publish(canonicalMismatched, { expectedRevision: 3, idempotencyKey: "r05-publish-4", requestId: "r05-publish-4", boardId: scope.boardId, actorId: "r05-human", publishedAt: "2026-07-19T12:06:00.000Z" });
  const mismatchPreflight = await service.preflight(preflightRequest({ requestId: "r05-preflight-4", designId: canonicalMismatched.designId, schematicRevision: canonicalMismatched.schematicRevision, target: { kind: "existing_board", boardId: scope.boardId, expectedBoardRevision: afterInsertion.revision }, requestedAt: "2026-07-19T12:06:30.000Z" }));
  expect(mismatchPreflight.status).toBe("blocked_mapping");
  expect(mismatchPreflight.blockers.map((item) => item.code)).toContain("PS_MAPPING_PIN_MISSING");
  expect(await repository.getBoard(scope)).toEqual(afterInsertion);

  const duplicate = snapshotRevision(canonicalMismatched, 5);
  const second = structuredClone(duplicate.components[0]!);
  second.componentInstanceId = "sync-u2";
  second.referenceDesignator = duplicate.components[0]!.referenceDesignator.toLowerCase();
  second.pins = second.pins.map((pin) => ({ ...pin, pinInstanceId: pin.pinInstanceId.replace("sync-u1", "sync-u2") }));
  duplicate.components.push(second);
  const canonicalDuplicate = snapshotRevision(duplicate, 5);
  await snapshots.publish(canonicalDuplicate, { expectedRevision: 4, idempotencyKey: "r05-publish-5", requestId: "r05-publish-5", boardId: scope.boardId, actorId: "r05-human", publishedAt: "2026-07-19T12:07:00.000Z" });
  const duplicatePreflight = await service.preflight(preflightRequest({ requestId: "r05-preflight-5", designId: canonicalDuplicate.designId, schematicRevision: canonicalDuplicate.schematicRevision, target: { kind: "existing_board", boardId: scope.boardId, expectedBoardRevision: afterInsertion.revision }, requestedAt: "2026-07-19T12:07:30.000Z" }));
  expect(duplicatePreflight.status).toBe("blocked_conflict");
  expect(duplicatePreflight.blockers.map((item) => item.code)).toContain("PS_REFERENCE_DESIGNATOR_DUPLICATE");
  expect(await repository.getBoard(scope)).toEqual(afterInsertion);

  const reloaded = await new DurablePcbSyncRepository(recreateWorkflow()).getBoard(scope);
  expect(reloaded).toEqual(afterInsertion);
  return { boardRevision: reloaded!.revision, boardDigest: reloaded!.digest, originalStableNetId: stableIdByNumeric.get(reloaded!.board.tracks[0]!.netId)! };
}

describe("R05 electrical identity durable boundary", () => {
  it("preserves copper identity and fails closed on deletion, pin mismatch, and duplicate references", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    expect(await exerciseDurableIdentity(workflow, () => workflow)).toMatchObject({ originalStableNetId: "stable-net-1" });
  });

  it.runIf(Boolean(process.env.R05_RC01_DATABASE_URL))("qualifies the same identity flow against isolated PostgreSQL", async () => {
    process.env.DATABASE_URL = process.env.R05_RC01_DATABASE_URL;
    const { PostgresDurableWorkflowRepository } = await import("../../durable-workflow/server-repository");
    const result = await exerciseDurableIdentity(new PostgresDurableWorkflowRepository(), () => new PostgresDurableWorkflowRepository());
    expect(result.originalStableNetId).toBe("stable-net-1");
    process.stdout.write(`R05_RC01_POSTGRES_EVIDENCE ${JSON.stringify(result)}\n`);
  });
});
