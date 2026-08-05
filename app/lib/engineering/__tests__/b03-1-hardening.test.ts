/**
 * B03.1 — security + persistence hardening tests.
 *
 * Negative coverage for the verified undo/redo replay contract, the trusted
 * interactive-UI channel, and exact-head persistence/reload: forged replay
 * operations, missing/cross-project/cross-lineage references, wrong
 * direction/position, digest mismatches, duplicate replay, forged human/ui
 * fields, provenance gating, release-tier blocking, replay rollback, exact
 * head restoration, stale/corrupt/foreign envelopes, and legacy projects.
 */
import { describe, expect, it } from "vitest";
import { createHistory } from "../../pcb/history";
import type { PcbBoard } from "../../pcb/types";
import {
  applyEditsCanonical,
  bindCanonicalEditorSession,
  type BoundCanonicalEditor,
} from "../editor-adapter";
import {
  CanonicalExecutor,
  REPLAY_COMMAND_ID,
  type ExecutionResult,
  type UndoRedoReplayRequest,
} from "../executor";
import { createEditorSessionChannel, InteractiveUiChannel } from "../interactive-channel.internal";
import { InMemoryAtomicProjectStore, type AtomicProjectStore } from "../persistence";
import { semanticStateDigest } from "../revision";
import { EngineeringTransactionService } from "../transaction-service";
import type { EngineeringActor, EngineeringOperation, ProjectPersistenceEnvelope } from "../types";
import { actor, projectFixture, track } from "./fixtures";

const BUILD = "b03-1-test-build";
const IDENTITY = { tenantId: "tenant-a", projectId: "project-a", branchId: "main" };

interface Kernel {
  service: EngineeringTransactionService;
  executor: CanonicalExecutor;
  ui: EngineeringActor;
}

async function openKernel(options?: { channel?: boolean; store?: InMemoryAtomicProjectStore }): Promise<Kernel> {
  const project = projectFixture();
  project.pcb.tracks.push(track("t-seed"));
  const service = await EngineeringTransactionService.open(project, { buildId: BUILD, store: options?.store ?? new InMemoryAtomicProjectStore() });
  const executor = new CanonicalExecutor(service, undefined, options?.channel ? { interactiveChannel: createEditorSessionChannel("test interactive session") } : undefined);
  return { service, executor, ui: actor("pcb_editor", "editor-1") };
}

function removeSeedTrack(kernel: Kernel, overrides?: Record<string, unknown>): Promise<ExecutionResult> {
  return kernel.executor.execute({
    commandId: "pcb.delete-item",
    actor: kernel.ui,
    expectedRevision: kernel.service.currentRevision(),
    idempotencyKey: "delete-seed",
    reason: "delete seed track",
    operations: [{ operationId: "op:del", schemaVersion: 1, units: "nm", kind: "remove_track", trackId: "t-seed" }],
    provenance: { source: "ui", toolVersion: "test" },
    ...overrides,
  });
}

async function appliedDelete(kernel: Kernel): Promise<Extract<ExecutionResult, { status: "executed" | "idempotent_replay" }>> {
  const result = await removeSeedTrack(kernel);
  if (result.status !== "executed") throw new Error(`expected executed, got ${result.status}`);
  return result;
}

function replayRequest(kernel: Kernel, executed: Extract<ExecutionResult, { status: "executed" | "idempotent_replay" }>, overrides?: Partial<UndoRedoReplayRequest>): UndoRedoReplayRequest {
  return {
    referencedTransactionId: executed.transactionId,
    direction: "undo",
    actor: kernel.ui,
    expectedLineage: { ...IDENTITY, lineageId: kernel.executor.lineageId },
    expectedHeadRevision: kernel.service.currentRevision(),
    expectedSourceStateDigest: executed.semanticDigestAfter!,
    expectedResultStateDigest: executed.semanticDigestBefore!,
    idempotencyKey: "undo-1",
    ...overrides,
  };
}

describe("verified undo/redo replay (executor-owned)", () => {
  it("1. generic execution of pcb.undo-redo-canonical with arbitrary operations is rejected", async () => {
    const kernel = await openKernel({ channel: true });
    const before = kernel.service.currentRevision();
    const forged = await kernel.executor.execute({
      commandId: REPLAY_COMMAND_ID,
      actor: kernel.ui,
      expectedRevision: before,
      idempotencyKey: "forged-undo",
      reason: "forged",
      operations: [{ operationId: "op:x", schemaVersion: 1, units: "nm", kind: "remove_track", trackId: "t-seed" }],
      provenance: { source: "ui", toolVersion: "test" },
    });
    expect(forged).toMatchObject({ status: "rejected", reasonCode: "unverified_replay" });
    expect(kernel.service.currentRevision()).toEqual(before);
    expect(kernel.service.currentProject().pcb.tracks).toHaveLength(1);
  });

  it("2. missing referenced transaction is rejected", async () => {
    const kernel = await openKernel({ channel: true });
    const executed = await appliedDelete(kernel);
    const result = await kernel.executor.executeUndoRedo(replayRequest(kernel, executed, { referencedTransactionId: "tx:does-not-exist" }));
    expect(result).toMatchObject({ status: "rejected", reasonCode: "unknown_reference" });
    expect(kernel.service.currentRevision().headSequence).toBe(1);
  });

  it("3. cross-project and cross-lineage references are rejected before any lookup", async () => {
    const kernel = await openKernel({ channel: true });
    const executed = await appliedDelete(kernel);
    const wrongProject = await kernel.executor.executeUndoRedo(replayRequest(kernel, executed, { expectedLineage: { ...IDENTITY, projectId: "project-b", lineageId: kernel.executor.lineageId } }));
    const wrongTenant = await kernel.executor.executeUndoRedo(replayRequest(kernel, executed, { expectedLineage: { ...IDENTITY, tenantId: "tenant-x", lineageId: kernel.executor.lineageId } }));
    expect(wrongProject).toMatchObject({ status: "rejected", reasonCode: "reference_mismatch" });
    expect(wrongTenant).toMatchObject({ status: "rejected", reasonCode: "reference_mismatch" });
    expect(kernel.service.currentRevision().headSequence).toBe(1);
  });

  it("4. wrong direction / lineage position is rejected", async () => {
    const kernel = await openKernel({ channel: true });
    const executed = await appliedDelete(kernel);
    // Redo of a transaction whose effect is ALREADY at head: not redo-eligible.
    const redoAtHead = await kernel.executor.executeUndoRedo(replayRequest(kernel, executed, {
      direction: "redo",
      expectedSourceStateDigest: executed.semanticDigestBefore!,
      expectedResultStateDigest: executed.semanticDigestAfter!,
      idempotencyKey: "redo-at-head",
    }));
    expect(redoAtHead).toMatchObject({ status: "rejected", reasonCode: "replay_position" });
    // A second, newer transaction makes the first no longer undo-eligible.
    const second = await kernel.executor.execute({
      commandId: "pcb.edit-track", actor: kernel.ui, expectedRevision: kernel.service.currentRevision(),
      idempotencyKey: "add-track-2", reason: "add", provenance: { source: "ui", toolVersion: "test" },
      operations: [{ operationId: "op:add", schemaVersion: 1, units: "nm", kind: "add_track", track: track("t-new") }],
    });
    expect(second.status).toBe("executed");
    const undoStale = await kernel.executor.executeUndoRedo(replayRequest(kernel, executed, {
      expectedHeadRevision: kernel.service.currentRevision(),
      idempotencyKey: "undo-stale-position",
    }));
    expect(undoStale).toMatchObject({ status: "rejected", reasonCode: "replay_position" });
    expect(kernel.service.currentRevision().headSequence).toBe(2);
  });

  it("5. caller-supplied operations cannot affect the replay — the durable record is the only source", async () => {
    const kernel = await openKernel({ channel: true });
    const executed = await appliedDelete(kernel);
    const forgedOperations: EngineeringOperation[] = [
      { operationId: "op:evil", schemaVersion: 1, units: "nm", kind: "remove_track", trackId: "t-should-not-exist" },
    ];
    // Even smuggled past the type system, extra fields are inert: the request
    // contract has no operations input.
    const smuggled = { ...replayRequest(kernel, executed), operations: forgedOperations } as UndoRedoReplayRequest;
    const result = await kernel.executor.executeUndoRedo(smuggled);
    expect(result.status).toBe("executed");
    // The replay applied the RECORD's inverse (re-adding t-seed), not the forgery.
    expect(kernel.service.currentProject().pcb.tracks.map((t) => t.id)).toEqual(["t-seed"]);
    if (result.status !== "executed") throw new Error("unreachable");
    const replayRecord = kernel.service.durableRecords().find((r) => r.transaction.transactionId === result.transactionId)!;
    expect(replayRecord.transaction.operations.every((op) => op.kind === "add_track")).toBe(true);
    expect(replayRecord.transaction.provenance.candidateId).toBe(`undo:${executed.transactionId}`);
  });

  it("6. digest mismatches are rejected before mutation", async () => {
    const kernel = await openKernel({ channel: true });
    const executed = await appliedDelete(kernel);
    const head = kernel.service.currentRevision();
    const badSource = await kernel.executor.executeUndoRedo(replayRequest(kernel, executed, { expectedSourceStateDigest: "eng1-forged", idempotencyKey: "u-bad-src" }));
    const badResult = await kernel.executor.executeUndoRedo(replayRequest(kernel, executed, { expectedResultStateDigest: "eng1-forged", idempotencyKey: "u-bad-res" }));
    expect(badSource).toMatchObject({ status: "rejected", reasonCode: "digest_mismatch" });
    expect(badResult).toMatchObject({ status: "rejected", reasonCode: "digest_mismatch" });
    expect(kernel.service.currentRevision()).toEqual(head);
    expect(kernel.service.currentProject().pcb.tracks).toHaveLength(0);
  });

  it("7. duplicate undo requests replay idempotently — no duplicate mutation", async () => {
    const kernel = await openKernel({ channel: true });
    const executed = await appliedDelete(kernel);
    const first = await kernel.executor.executeUndoRedo(replayRequest(kernel, executed));
    expect(first.status).toBe("executed");
    const duplicate = await kernel.executor.executeUndoRedo(replayRequest(kernel, executed));
    expect(duplicate.status).toBe("idempotent_replay");
    if (first.status !== "executed" || duplicate.status !== "idempotent_replay") throw new Error("unreachable");
    expect(duplicate.transactionId).toBe(first.transactionId);
    expect(kernel.service.currentRevision().headSequence).toBe(2);
    // Reusing the key for a DIFFERENT replay is refused.
    const keyReuse = await kernel.executor.executeUndoRedo(replayRequest(kernel, executed, { direction: "redo", expectedSourceStateDigest: executed.semanticDigestBefore!, expectedResultStateDigest: executed.semanticDigestAfter! }));
    expect(keyReuse).toMatchObject({ status: "rejected", reasonCode: "reference_mismatch" });
  });

  it("12. failed persistence during a replay leaves canonical state and artifacts unchanged", async () => {
    let arm = false;
    const store = new InMemoryAtomicProjectStore((phase) => { if (arm && phase === "before_commit") throw new Error("SIMULATED_COMMIT_FAILURE"); });
    const kernel = await openKernel({ channel: true, store });
    const executed = await appliedDelete(kernel);
    const head = kernel.service.currentRevision();
    const artifacts = kernel.service.derivedArtifacts();
    arm = true;
    const failed = await kernel.executor.executeUndoRedo(replayRequest(kernel, executed));
    arm = false;
    expect(failed).toMatchObject({ status: "rejected", reasonCode: "persistence_failed" });
    expect(kernel.service.currentRevision()).toEqual(head);
    expect(kernel.service.currentProject().pcb.tracks).toHaveLength(0);
    expect(kernel.service.derivedArtifacts()).toEqual(artifacts);
    const retry = await kernel.executor.executeUndoRedo(replayRequest(kernel, executed));
    expect(retry.status).toBe("executed");
  });
});

describe("trusted interactive-UI channel", () => {
  it("8. forged actorKind=human + provenance=ui cannot bypass destructive approval without the channel", async () => {
    const kernel = await openKernel({ channel: false });
    const forged = await removeSeedTrack(kernel); // claims human + ui — worthless without the channel
    expect(forged).toMatchObject({ status: "rejected", reasonCode: "approval_required" });
    expect(kernel.service.currentProject().pcb.tracks).toHaveLength(1);
  });

  it("9. api, ai, and worker provenance still require independent approval even WITH the channel", async () => {
    const kernel = await openKernel({ channel: true });
    for (const source of ["api", "ai", "worker"] as const) {
      const result = await removeSeedTrack(kernel, { provenance: { source, toolVersion: "test" }, idempotencyKey: `del-${source}` });
      expect(result, source).toMatchObject({ status: "rejected", reasonCode: "approval_required" });
    }
    // Non-human actor kinds gain nothing from the channel either.
    const automation = await removeSeedTrack(kernel, { actor: actor("automation", "bot-1"), idempotencyKey: "del-bot" });
    expect(automation).toMatchObject({ status: "rejected", reasonCode: "approval_required" });
    expect(kernel.service.currentProject().pcb.tracks).toHaveLength(1);
  });

  it("10. the trusted interactive channel still performs the shipped reversible delete", async () => {
    const kernel = await openKernel({ channel: true });
    const result = await appliedDelete(kernel);
    expect(kernel.service.currentProject().pcb.tracks).toHaveLength(0);
    // …and it stays undoable through the verified replay contract.
    const undo = await kernel.executor.executeUndoRedo(replayRequest(kernel, result));
    expect(undo.status).toBe("executed");
    expect(kernel.service.currentProject().pcb.tracks).toHaveLength(1);
  });

  it("11. release-tier commands remain categorically blocked, channel or not", async () => {
    const kernel = await openKernel({ channel: true });
    const result = await kernel.executor.execute({
      commandId: "manufacturing.release", actor: kernel.ui,
      expectedRevision: kernel.service.currentRevision(), idempotencyKey: "rel-1", reason: "release",
      operations: [], provenance: { source: "ui", toolVersion: "test" },
    });
    expect(result).toMatchObject({ status: "rejected", reasonCode: "release_tier_blocked" });
  });

  it("the channel never serializes into a reusable secret", () => {
    const channel = createEditorSessionChannel("test");
    expect(JSON.stringify({ channel })).toBe('{"channel":"[interactive-ui-channel]"}');
    // A structurally forged 'channel' object is not an InteractiveUiChannel.
    const forged = { description: "fake", approvesDestructive: () => true, toJSON: () => "x" };
    expect(forged instanceof InteractiveUiChannel).toBe(false);
  });
});

// ─── Exact-head persistence + reload ─────────────────────────────────────────

function boardFixture(): PcbBoard {
  const board = projectFixture().pcb;
  board.tracks.push(track("t1"));
  return board;
}

async function openSession(board: PcbBoard, options?: Parameters<typeof bindCanonicalEditorSession>[2]): Promise<BoundCanonicalEditor> {
  const bound = bindCanonicalEditorSession(createHistory(board), IDENTITY, options);
  await bound.session.whenIdle();
  return bound;
}

function moveU1(bound: BoundCanonicalEditor, x: number) {
  return bound.session.commit({
    commandId: "pcb.move-footprint",
    label: "Move u1",
    buildOperations: () => [{ operationId: "op:move:0", schemaVersion: 1, units: "nm", kind: "move_footprint", footprintId: "u1", at: { x, y: 2_000_000 } }],
  });
}

describe("exact-head persistence and reload", () => {
  it("13. reload restores the exact head: sequence, head transaction, state digest, and integrity-chained log", async () => {
    const durable = new InMemoryAtomicProjectStore();
    const first = await openSession(boardFixture(), { durableStore: durable });
    await moveU1(first, 4_000_000);
    await moveU1(first, 6_000_000);
    const claim = first.session.headMetadataFor(first.history.present);
    expect(claim).not.toBeNull();
    expect(claim!.schemaVersion).toBe(2);
    expect(claim!.headSequence).toBe(2);
    const headBefore = first.session.currentHeadRevision()!;

    const reloaded = await openSession(structuredClone(first.history.present), { durableStore: durable, claim });
    expect(reloaded.session.events.some((e) => e.kind === "head-restored")).toBe(true);
    const restoredHead = reloaded.session.currentHeadRevision()!;
    expect(restoredHead.headSequence).toBe(2);
    expect(restoredHead.headTransactionId).toBe(headBefore.headTransactionId);
    expect(restoredHead.canonicalStateDigest).toBe(headBefore.canonicalStateDigest);
    expect(reloaded.session.lineageId).toBe(claim!.lineageId);
    // The restored lineage CONTINUES: next mutation lands at sequence 3.
    const next = await moveU1(reloaded, 8_000_000);
    expect(next.ok && next.status === "executed").toBe(true);
    expect(reloaded.session.currentHeadRevision()!.headSequence).toBe(3);
  });

  it("14a. a corrupt persisted envelope fails closed to a fresh lineage without touching the board", async () => {
    const durable = new InMemoryAtomicProjectStore();
    const first = await openSession(boardFixture(), { durableStore: durable });
    await moveU1(first, 4_000_000);
    const claim = first.session.headMetadataFor(first.history.present)!;
    const savedBoard = structuredClone(first.history.present);
    // Tamper with the durable envelope.
    const tampering: AtomicProjectStore = {
      ...durable,
      load: async (projectId, branchId) => {
        const envelope = (await durable.load(projectId, branchId))!;
        envelope.transactionLog[0].transaction.reason = "tampered";
        return envelope;
      },
      initialize: durable.initialize.bind(durable),
      commit: durable.commit.bind(durable),
      backup: durable.backup.bind(durable),
      restore: durable.restore.bind(durable),
    };
    const reloaded = await openSession(savedBoard, { durableStore: tampering, claim });
    expect(reloaded.session.events.some((e) => e.kind === "envelope-rejected")).toBe(true);
    expect(reloaded.session.events.some((e) => e.kind === "head-restored")).toBe(false);
    expect(reloaded.history.present).toBe(savedBoard); // board untouched
    expect(reloaded.session.currentHeadRevision()!.headSequence).toBe(0); // fresh lineage, truthfully
  });

  it("14b. a foreign-project envelope and a claim/envelope head mismatch both fail closed", async () => {
    const durable = new InMemoryAtomicProjectStore();
    const first = await openSession(boardFixture(), { durableStore: durable });
    await moveU1(first, 4_000_000);
    const staleClaim = first.session.headMetadataFor(first.history.present)!;
    const boardAtSeq1 = structuredClone(first.history.present);
    await moveU1(first, 6_000_000); // envelope advances to sequence 2; staleClaim still names sequence 1
    const mismatch = await openSession(boardAtSeq1, { durableStore: durable, claim: staleClaim });
    expect(mismatch.session.events.some((e) => e.kind === "envelope-rejected")).toBe(true);
    expect(mismatch.session.currentHeadRevision()!.headSequence).toBe(0);

    // Foreign envelope: same store queried by a different project identity.
    const foreignBound = bindCanonicalEditorSession(createHistory(boardAtSeq1), { ...IDENTITY, projectId: "project-z" }, { durableStore: durable, claim: staleClaim });
    await foreignBound.session.whenIdle();
    expect(foreignBound.session.events.some((e) => e.kind === "head-restored")).toBe(false);
    expect(foreignBound.session.currentHeadRevision()!.headSequence).toBe(0);
  });

  it("15. legacy projects (no claim / v1 claim) open unchanged with no persistence writes", async () => {
    const board = boardFixture();
    const durable = new InMemoryAtomicProjectStore();
    const noClaim = await openSession(board, { durableStore: durable });
    expect(noClaim.history.present).toBe(board);
    expect(noClaim.session.events.map((e) => e.kind)).toEqual(["opened"]);
    // Merely opening wrote nothing durable.
    expect(await durable.load(IDENTITY.projectId, IDENTITY.branchId)).toBeNull();
    // A v1 (B03 content-equivalence) claim verifies WITHOUT exact-head restore.
    const v1 = await openSession(structuredClone(board), {
      durableStore: durable,
      claim: {
        schemaVersion: 1,
        lineageDigest: noClaim.session.headMetadataFor(board)!.lineageDigest,
        boardSemanticRevision: noClaim.session.headMetadataFor(board)!.boardSemanticRevision,
        headSequence: 0, headTransactionId: "genesis",
        canonicalStateDigest: noClaim.session.currentHeadRevision()!.canonicalStateDigest,
      },
    });
    expect(v1.session.events.some((e) => e.kind === "claim-verified")).toBe(true);
    expect(v1.session.events.some((e) => e.kind === "head-restored")).toBe(false);
  });

  it("semantic digests: undo replay is exact over semantic state even when derived zone fills re-mark dirty", async () => {
    const kernel = await openKernel({ channel: true });
    const moved = await kernel.executor.execute({
      commandId: "pcb.move-footprint", actor: kernel.ui, expectedRevision: kernel.service.currentRevision(),
      idempotencyKey: "mv-1", reason: "move", provenance: { source: "ui", toolVersion: "test" },
      operations: [{ operationId: "op:mv", schemaVersion: 1, units: "nm", kind: "move_footprint", footprintId: "u1", at: { x: 4_000_000, y: 2_000_000 } }],
    });
    if (moved.status !== "executed") throw new Error("expected executed");
    const genesisSemantic = moved.semanticDigestBefore!;
    const undo = await kernel.executor.executeUndoRedo(replayRequest(kernel, moved, { expectedSourceStateDigest: moved.semanticDigestAfter!, expectedResultStateDigest: genesisSemantic }));
    expect(undo.status).toBe("executed");
    expect(semanticStateDigest(kernel.service.currentProject())).toBe(genesisSemantic);
  });
});

describe("unmigrated behavior stays intact under the hardened kernel", () => {
  it("interactive delete through the adapter still works and is undoable (channel is session-internal)", async () => {
    const bound = await openSession(boardFixture());
    const result = await applyEditsCanonical(bound.history, [{ op: "delete-items", refs: [{ kind: "track", id: "t1" }] }]);
    expect(result.ok).toBe(true);
    expect(bound.history.present.tracks).toHaveLength(0);
    bound.history.undo();
    await bound.session.whenIdle();
    expect(bound.history.present.tracks).toHaveLength(1);
    expect(bound.session.events.some((e) => e.kind === "undo-reconciled")).toBe(true);
    // The channel never leaked into events or serialized session surfaces.
    expect(JSON.stringify(bound.session.events)).not.toContain("interactive-ui-channel");
  });

  it("envelope round-trip: a session-persisted envelope validates and lists every transaction", async () => {
    const durable = new InMemoryAtomicProjectStore();
    const bound = await openSession(boardFixture(), { durableStore: durable });
    await moveU1(bound, 4_000_000);
    bound.history.undo();
    await bound.session.whenIdle();
    const envelope: ProjectPersistenceEnvelope | null = await durable.load(IDENTITY.projectId, IDENTITY.branchId);
    expect(envelope).not.toBeNull();
    expect(envelope!.transactionLog).toHaveLength(2); // move + verified undo replay
    expect(envelope!.transactionLog[1].transaction.provenance.candidateId).toMatch(/^undo:tx:/);
  });
});
