/**
 * B02 — canonical executor kernel tests.
 *
 * Deterministic coverage for: successful execution, stale revisions,
 * duplicate idempotency keys, authorization rejection, validation failure,
 * atomic rollback, change-set persistence, derived-artifact invalidation,
 * B01 contract resolution (unknown/missing/non-mutating/release/destructive
 * tiers), and the current-product revision compatibility bridge.
 */
import { describe, expect, it } from "vitest";
import { pcbRevisionId } from "../../pcb/revision";
import {
  bridgeCurrentProjectRevision,
  CanonicalExecutor,
  resolveExecutorContract,
  type ExecutorRequest,
} from "../executor";
import { InMemoryAtomicProjectStore, validatePersistenceEnvelope } from "../persistence";
import { EngineeringTransactionService } from "../transaction-service";
import type { EngineeringActor, EngineeringOperation } from "../types";
import { actor, projectFixture, track } from "./fixtures";

const BUILD = "b02-test-build";

async function openExecutor(options?: { store?: InMemoryAtomicProjectStore }): Promise<{ executor: CanonicalExecutor; service: EngineeringTransactionService; store: InMemoryAtomicProjectStore }> {
  const store = options?.store ?? new InMemoryAtomicProjectStore();
  const service = await EngineeringTransactionService.open(projectFixture(), { buildId: BUILD, store });
  return { executor: new CanonicalExecutor(service), service, store };
}

function addTrackOperation(id = "t-b02"): EngineeringOperation {
  return { operationId: `op:${id}`, schemaVersion: 1, units: "nm", kind: "add_track", track: track(id) };
}

function request(executor: CanonicalExecutor, overrides?: Partial<ExecutorRequest>): ExecutorRequest {
  return {
    commandId: "pcb.edit-track",
    actor: actor("pcb_editor", "editor-1"),
    expectedRevision: executor.currentRevision(),
    idempotencyKey: "idem-1",
    reason: "B02 kernel test",
    operations: [addTrackOperation()],
    ...overrides,
  };
}

describe("B01 contract resolution", () => {
  it("resolves registry metadata to executor contracts", () => {
    const contract = resolveExecutorContract("pcb.edit-track")!;
    expect(contract).toMatchObject({
      kind: "mutate",
      mutating: true,
      executable: true,
      allowedOperationKinds: ["add_track", "update_track"],
    });
    expect(resolveExecutorContract("manufacturing.release")).toMatchObject({ approvalTier: "release" });
    expect(resolveExecutorContract("pcb.dimension")).toMatchObject({ executable: false });
    expect(resolveExecutorContract("schematic.add-component")).toMatchObject({
      status: "ui-only",
      executable: false,
      allowedOperationKinds: [],
    });
    expect(resolveExecutorContract("pcb.create-via")).toMatchObject({
      status: "partial",
      executable: false,
      allowedOperationKinds: ["add_via"],
    });
    expect(resolveExecutorContract("does.not-exist")).toBeNull();
  });

  it("rejects unknown, missing, and non-mutating commands without touching state", async () => {
    const { executor } = await openExecutor();
    const before = executor.currentRevision();
    const unknown = await executor.execute(request(executor, { commandId: "does.not-exist" }));
    const missing = await executor.execute(request(executor, { commandId: "pcb.dimension" }));
    const readOnly = await executor.execute(request(executor, { commandId: "validation.erc-drc" }));
    expect(unknown).toMatchObject({ status: "rejected", reasonCode: "unknown_command" });
    expect(missing).toMatchObject({ status: "rejected", reasonCode: "not_executable" });
    expect(readOnly).toMatchObject({ status: "rejected", reasonCode: "non_mutating_command" });
    expect(executor.currentRevision()).toEqual(before);
  });

  it("categorically refuses release-tier commands — MFG01 keeps release authority", async () => {
    const { executor } = await openExecutor();
    const result = await executor.execute(request(executor, { commandId: "manufacturing.release" }));
    expect(result).toMatchObject({ status: "rejected", reasonCode: "release_tier_blocked" });
  });

  it("rejects a command/operation mismatch before transaction creation", async () => {
    const { executor } = await openExecutor();
    const before = executor.currentRevision();
    const result = await executor.execute(request(executor, {
      commandId: "pcb.move-footprint",
      operations: [addTrackOperation("confused-deputy-track")],
      idempotencyKey: "idem-confused-deputy",
    }));
    expect(result).toMatchObject({
      status: "rejected",
      reasonCode: "operation_mismatch",
    });
    expect(executor.currentRevision()).toEqual(before);
    expect(executor.currentProject().pcb.tracks).toHaveLength(0);
  });

  it("rejects UI-only and unbound implemented commands", async () => {
    const { executor } = await openExecutor();
    const uiOnly = await executor.execute(request(executor, {
      commandId: "view.pcb-3d-control",
      idempotencyKey: "idem-ui-only",
    }));
    const unbound = await executor.execute(request(executor, {
      commandId: "project.autosave",
      idempotencyKey: "idem-unbound",
    }));
    expect(uiOnly).toMatchObject({ status: "rejected", reasonCode: "not_executable" });
    expect(unbound).toMatchObject({ status: "rejected", reasonCode: "not_executable" });
    expect(executor.currentRevision().headSequence).toBe(0);
  });

  it("destructive-tier commands demand an independent approve_proposal approval", async () => {
    const { executor } = await openExecutor();
    const removeOp: EngineeringOperation = { operationId: "op:del", schemaVersion: 1, units: "nm", kind: "remove_track", trackId: "seed-track" };
    const withoutApproval = await executor.execute(request(executor, { commandId: "pcb.delete-item", operations: [removeOp] }));
    expect(withoutApproval).toMatchObject({ status: "rejected", reasonCode: "approval_required" });
    const selfApproved = await executor.execute(request(executor, {
      commandId: "pcb.delete-item", operations: [removeOp],
      approvals: [{ approvalId: "ap-1", actorId: "editor-1", capability: "approve_proposal" }],
    }));
    expect(selfApproved).toMatchObject({ status: "rejected", reasonCode: "approval_required" });
  });
});

describe("kernel execution semantics", () => {
  it("executes a mutating command with structured results and scope", async () => {
    const { executor } = await openExecutor();
    const before = executor.currentRevision();
    const result = await executor.execute(request(executor));
    expect(result.status).toBe("executed");
    if (result.status !== "executed") return;
    expect(result.recordSequence).toBe(1);
    expect(result.revisionBefore.canonicalStateDigest).toBe(before.canonicalStateDigest);
    expect(result.revisionAfter.headSequence).toBe(1);
    expect(result.revisionAfter.canonicalStateDigest).not.toBe(before.canonicalStateDigest);
    expect(result.affectedScope.objectIds).toEqual(["track:t-b02"]);
    expect(result.affectedScope.netIds).toEqual([1]);
    expect(result.changeSetDigest).toMatch(/^[0-9a-f]/i);
    expect(executor.currentRevision().headSequence).toBe(1);
  });

  it("is deterministic: identical inputs on fresh stores yield identical digests", async () => {
    const first = await openExecutor();
    const second = await openExecutor();
    const a = await first.executor.execute(request(first.executor));
    const b = await second.executor.execute(request(second.executor));
    if (a.status !== "executed" || b.status !== "executed") throw new Error("expected execution");
    expect(a.changeSetDigest).toBe(b.changeSetDigest);
    expect(a.revisionAfter.canonicalStateDigest).toBe(b.revisionAfter.canonicalStateDigest);
    expect(a.invalidatedArtifacts).toEqual(b.invalidatedArtifacts);
  });

  it("rejects stale expected revisions without applying anything", async () => {
    const { executor } = await openExecutor();
    const staleRevision = executor.currentRevision();
    const ok = await executor.execute(request(executor, { idempotencyKey: "idem-head" }));
    expect(ok.status).toBe("executed");
    const stale = await executor.execute(request(executor, {
      idempotencyKey: "idem-stale",
      expectedRevision: staleRevision,
      operations: [addTrackOperation("t-other")],
    }));
    expect(stale).toMatchObject({ status: "rejected", reasonCode: "stale_revision" });
    expect(executor.currentRevision().headSequence).toBe(1);
  });

  it("replays duplicate idempotency keys instead of double-applying", async () => {
    const { executor } = await openExecutor();
    const first = await executor.execute(request(executor));
    const replay = await executor.execute(request(executor)); // same idempotencyKey, stale base — replay wins
    expect(first.status).toBe("executed");
    expect(replay.status).toBe("idempotent_replay");
    if (first.status !== "executed" || replay.status !== "idempotent_replay") return;
    expect(replay.transactionId).toBe(first.transactionId);
    expect(replay.changeSetDigest).toBe(first.changeSetDigest);
    expect(executor.currentRevision().headSequence).toBe(1);
  });

  it("rejects unauthorized actors via the capability model", async () => {
    const { executor } = await openExecutor();
    const viewer: EngineeringActor = actor("viewer", "viewer-1");
    const result = await executor.execute(request(executor, { actor: viewer, idempotencyKey: "idem-viewer" }));
    expect(result).toMatchObject({ status: "rejected", reasonCode: "unauthorized" });
    expect(executor.currentRevision().headSequence).toBe(0);
  });

  it("rejects validation failures (unknown target object) with diagnostics", async () => {
    const { executor } = await openExecutor();
    const bad: EngineeringOperation = { operationId: "op:bad", schemaVersion: 1, units: "nm", kind: "update_track", trackId: "missing-track", patch: { width: 300_000 } };
    const result = await executor.execute(request(executor, { operations: [bad], idempotencyKey: "idem-bad" }));
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.reasonCode).toBe("invalid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(executor.currentRevision().headSequence).toBe(0);
  });

  it("atomic rollback: a failed persistence commit leaves state and artifacts untouched", async () => {
    let arm = false;
    const store = new InMemoryAtomicProjectStore((phase) => { if (arm && phase === "before_commit") throw new Error("SIMULATED_COMMIT_FAILURE"); });
    const { executor } = await openExecutor({ store });
    const before = executor.currentRevision();
    const artifactsBefore = executor.derivedArtifacts();
    arm = true;
    const result = await executor.execute(request(executor, { idempotencyKey: "idem-rollback" }));
    arm = false;
    expect(result).toMatchObject({ status: "rejected", reasonCode: "persistence_failed" });
    expect(executor.currentRevision()).toEqual(before);
    expect(executor.currentProject().pcb.tracks).toHaveLength(0);
    expect(executor.derivedArtifacts()).toEqual(artifactsBefore);
    // The same idempotency key succeeds once persistence recovers.
    const retry = await executor.execute(request(executor, { idempotencyKey: "idem-rollback" }));
    expect(retry.status).toBe("executed");
  });

  it("persists the change-set durably: a fresh service on the same store replays it", async () => {
    const store = new InMemoryAtomicProjectStore();
    const { executor } = await openExecutor({ store });
    const result = await executor.execute(request(executor, { idempotencyKey: "idem-durable" }));
    expect(result.status).toBe("executed");
    const reopened = await EngineeringTransactionService.open(projectFixture(), { buildId: BUILD, store });
    const records = reopened.durableRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.appliedChangeSet).toBeDefined();
    expect(records[0]!.appliedChangeSet!.createdIdsByKind["track"]).toEqual(["t-b02"]);
    expect(validatePersistenceEnvelope(reopened.unsafeTestEnvelope())).toEqual([]);
    expect(reopened.currentRevision().headSequence).toBe(1);
    // The reopened head equals the executed result revision — same lineage.
    if (result.status === "executed") expect(reopened.currentRevision().canonicalStateDigest).toBe(result.revisionAfter.canonicalStateDigest);
  });

  it("records derived-artifact invalidation deterministically in the result", async () => {
    const { executor } = await openExecutor();
    const result = await executor.execute(request(executor));
    if (result.status !== "executed") throw new Error("expected execution");
    const kinds = result.invalidatedArtifacts.map((item) => item.artifactKind);
    expect(kinds).toEqual([...kinds].sort());
    expect(kinds).toContain("electrical_truth");
    expect(kinds).toContain("drc");
    for (const artifact of result.invalidatedArtifacts) {
      expect(artifact.status).toBe("pending");
      expect(artifact.invalidatedByTransactionIds).toContain(result.transactionId);
    }
    // Kernel view agrees with the service's dependency graph.
    const pending = executor.derivedArtifacts().filter((item) => item.status === "pending").map((item) => item.artifactKind);
    expect(pending.sort()).toEqual(kinds);
  });
});

describe("current-product revision compatibility bridge", () => {
  it("binds a current board + claimed pcb2 revision to an executor revision", () => {
    const project = projectFixture();
    const claimed = pcbRevisionId(project.pcb);
    const bridged = bridgeCurrentProjectRevision({
      tenantId: "tenant-a", projectId: "project-a", branchId: "main",
      board: project.pcb, schematic: project.schematic, claimedBoardRevision: claimed,
    });
    expect(bridged.claimVerified).toBe(true);
    expect(bridged.boardSemanticRevision).toBe(claimed);
    expect(bridged.revision.headSequence).toBe(0);
    expect(bridged.revision.canonicalStateDigest).toMatch(/./);
  });

  it("detects a stale claimed revision instead of silently accepting it", () => {
    const project = projectFixture();
    const claimed = pcbRevisionId(project.pcb);
    project.pcb.tracks.push(track("drifted"));
    const bridged = bridgeCurrentProjectRevision({
      tenantId: "tenant-a", projectId: "project-a", branchId: "main",
      board: project.pcb, claimedBoardRevision: claimed,
    });
    expect(bridged.claimVerified).toBe(false);
    const unclaimed = bridgeCurrentProjectRevision({ tenantId: "tenant-a", projectId: "project-a", branchId: "main", board: project.pcb });
    expect(unclaimed.claimVerified).toBeNull();
  });

  it("a bridged revision is executable head state for the kernel", async () => {
    const project = projectFixture();
    const bridged = bridgeCurrentProjectRevision({
      tenantId: project.tenantId, projectId: project.projectId, branchId: project.branchId,
      board: project.pcb, schematic: project.schematic,
    });
    const service = await EngineeringTransactionService.open(bridged.state, { buildId: BUILD });
    const executor = new CanonicalExecutor(service);
    expect(executor.currentRevision().canonicalStateDigest).toBe(bridged.revision.canonicalStateDigest);
    const result = await executor.execute({
      commandId: "pcb.edit-track", actor: actor("pcb_editor", "editor-1"),
      expectedRevision: bridged.revision, idempotencyKey: "idem-bridge",
      reason: "bridge execution", operations: [addTrackOperation("t-bridge")],
    });
    expect(result.status).toBe("executed");
  });
});
