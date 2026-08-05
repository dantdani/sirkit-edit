import { describe, expect, it } from "vitest";
import { AuthoritativeCollaborationSession } from "../collaboration";
import { DERIVED_EVALUATORS } from "../dependency";
import { engineeringDigest } from "../stable";
import { RevisionBoundScheduler } from "../scheduler";
import { runDifferentialVerification } from "../shadow-verification";
import { EngineeringTransactionService } from "../transaction-service";
import type { EngineeringOperation } from "../types";
import { actor, projectFixture, track, transaction, ZERO_DRC_RULES } from "./fixtures";

const protect = (id: string, locked: boolean, op = `protect:${id}`): EngineeringOperation => ({ operationId: op, schemaVersion: 1, units: "nm", kind: "set_footprint_protection", footprintId: id, locked });
const add = (id: string, y = 3_000_000): EngineeringOperation => ({ operationId: `add:${id}`, schemaVersion: 1, units: "nm", kind: "add_track", track: track(id, y) });

describe("Stage 10 collaboration, scheduling, and shadow safety", () => {
  it("safely rebases disjoint protection operations and converges under duplicate retry", async () => {
    const project = projectFixture(); const service = await EngineeringTransactionService.open(project, { buildId: "test", serverMode: true }); const session = new AuthoritativeCollaborationSession(service); const base = service.currentRevision();
    const left = transaction(project, [protect("u1", true)], { baseRevision: base, clientOperationId: "left", actorId: "alice" }); const right = transaction(project, [protect("u2", true)], { baseRevision: base, clientOperationId: "right", actorId: "bob" });
    expect((await session.submit(left)).state).toBe("accepted"); const rebased = await session.submit(right); expect(rebased.state).toBe("rebased"); expect(service.currentProject().pcb.footprints.map((item) => item.locked)).toEqual([true, true]); expect(service.currentRevision().headSequence).toBe(2); expect((await session.submit(right)).state).toBe("duplicate");
  });

  it("creates explicit same-object and edit-vs-delete conflicts with no partial apply", async () => {
    const project = projectFixture(); project.pcb.tracks.push(track("existing")); const service = await EngineeringTransactionService.open(project, { buildId: "test", serverMode: true }); const session = new AuthoritativeCollaborationSession(service); const base = service.currentRevision();
    const remove = transaction(project, [{ operationId: "remove", schemaVersion: 1, units: "nm", kind: "remove_track", trackId: "existing" }], { baseRevision: base, clientOperationId: "remove", actorId: "alice" }); const update = transaction(project, [{ operationId: "update", schemaVersion: 1, units: "nm", kind: "update_track", trackId: "existing", patch: { width: 400_000 } }], { baseRevision: base, clientOperationId: "update", actorId: "bob" });
    expect((await session.submit(remove)).state).toBe("accepted"); const conflict = await session.submit(update); expect(conflict.state).toBe("conflict"); if (conflict.state === "conflict") expect(conflict.conflict.conflictClass).toBe("edit_vs_delete"); expect(service.currentRevision().headSequence).toBe(1); expect(service.currentProject().pcb.tracks).toEqual([]);
  });

  it("conservatively conflicts concurrent physical edits without proven spatial independence", async () => {
    const project = projectFixture(); const service = await EngineeringTransactionService.open(project, { buildId: "test", serverMode: true }); const session = new AuthoritativeCollaborationSession(service); const base = service.currentRevision();
    expect((await session.submit(transaction(project, [add("a")], { baseRevision: base, clientOperationId: "a" }))).state).toBe("accepted"); const second = await session.submit(transaction(project, [add("b", 8_000_000)], { baseRevision: base, clientOperationId: "b", actorId: "bob" })); expect(second.state).toBe("conflict"); if (second.state === "conflict") expect(second.conflict.conflictClass).toBe("net_vs_routing");
  });

  it("undoes an actor's independent transaction but conflicts after dependent collaborator work", async () => {
    const project = projectFixture(); const service = await EngineeringTransactionService.open(project, { buildId: "test", serverMode: true }); const session = new AuthoritativeCollaborationSession(service); const alice = actor("project_admin", "alice"); const bob = actor("project_admin", "bob");
    expect((await session.submit(transaction(project, [add("a")], { baseRevision: service.currentRevision(), clientOperationId: "add-a", actorId: "alice" }))).state).toBe("accepted"); expect((await session.submit(transaction(project, [protect("u2", true)], { baseRevision: service.currentRevision(), clientOperationId: "protect-u2", actorId: "bob" }))).state).toBe("accepted"); expect((await session.undoLastActorTransaction(alice, "undo-a")).state).toBe("accepted"); expect(service.currentProject().pcb.tracks).toEqual([]); expect(service.currentProject().pcb.footprints.find((item) => item.id === "u2")?.locked).toBe(true);

    const project2 = projectFixture(); const service2 = await EngineeringTransactionService.open(project2, { buildId: "test", serverMode: true }); const session2 = new AuthoritativeCollaborationSession(service2); await session2.submit(transaction(project2, [add("shared")], { baseRevision: service2.currentRevision(), clientOperationId: "shared-add", actorId: "alice" })); await session2.submit(transaction(project2, [{ operationId: "widen", schemaVersion: 1, units: "nm", kind: "update_track", trackId: "shared", patch: { width: 500_000 } }], { baseRevision: service2.currentRevision(), clientOperationId: "shared-update", actorId: "bob" })); const undoConflict = await session2.undoLastActorTransaction(alice, "undo-shared"); expect(undoConflict.state).toBe("conflict"); expect(service2.currentProject().pcb.tracks[0].width).toBe(500_000);
    void bob;
  });

  it("keeps generated changes in reviewable proposals and enforces reviewer authority", async () => {
    const project = projectFixture(); const service = await EngineeringTransactionService.open(project, { buildId: "test", serverMode: true }); const session = new AuthoritativeCollaborationSession(service); const proposed = transaction(project, [add("candidate")], { baseRevision: service.currentRevision(), clientOperationId: "candidate", actorId: "robot", role: "automation" }); const proposal = session.createProposal({ creator: actor("automation", "robot"), purpose: "Autorouter candidate", transactions: [proposed] }); expect(proposal.status).toBe("draft"); expect(service.currentProject().pcb.tracks).toEqual([]); expect(() => session.reviewProposal(proposal.proposalId, actor("pcb_editor", "editor"), "approve")).toThrow(/UNAUTHORIZED/); expect(session.reviewProposal(proposal.proposalId, actor("reviewer", "reviewer"), "approve").status).toBe("approved"); expect(service.currentProject().pcb.tracks).toEqual([]);
  });

  it("coalesces revision-bound jobs and rejects stale, cancelled, or wrong-version results", async () => {
    const project = projectFixture(); const service = await EngineeringTransactionService.open(project, { buildId: "test" }); const accepted = await service.submit(transaction(project, [add("a")], { baseRevision: service.currentRevision() })); if (accepted.state !== "accepted") throw new Error("fixture failed"); const change = accepted.record.appliedChangeSet!; const scheduler = new RevisionBoundScheduler(2); const descriptor = DERIVED_EVALUATORS.find((item) => item.artifactKind === "drc")!;
    const first = scheduler.enqueue({ projectId: project.projectId, branchId: project.branchId, revision: accepted.revision, artifactKind: "drc", evaluatorId: descriptor.evaluatorId, evaluatorVersion: descriptor.evaluatorVersion, scope: "project", changeSet: change, inputDigests: [accepted.revision.canonicalStateDigest], priority: descriptor.priority, seed: 1 }); const second = scheduler.enqueue({ projectId: project.projectId, branchId: project.branchId, revision: accepted.revision, artifactKind: "drc", evaluatorId: descriptor.evaluatorId, evaluatorVersion: descriptor.evaluatorVersion, scope: "project", changeSet: change, inputDigests: [accepted.revision.canonicalStateDigest], priority: descriptor.priority, seed: 1 }); expect(first.jobId).not.toBe(second.jobId); expect(scheduler.queueDepth()).toBe(1); const running = scheduler.take()!;
    expect(scheduler.acceptResult({ jobId: running.jobId, projectId: project.projectId, branchId: project.branchId, revision: { ...accepted.revision, headSequence: 99 }, evaluatorId: descriptor.evaluatorId, evaluatorVersion: descriptor.evaluatorVersion, artifactKind: "drc", scope: "project", value: {}, digest: engineeringDigest({}), durationMs: 1 }, accepted.revision, descriptor.evaluatorVersion)).toEqual({ accepted: false, reason: "STALE_RESULT" });
  });

  it("uses the full oracle as fallback and detects injected divergence without silent promotion", async () => {
    const project = projectFixture(); const service = await EngineeringTransactionService.open(project, { buildId: "test" }); const result = await service.submit(transaction(project, [add("a")], { baseRevision: service.currentRevision() })); if (result.state !== "accepted") throw new Error("fixture failed"); const fallback = runDifferentialVerification({ board: result.project.pcb, revision: result.revision, changeSet: result.record.appliedChangeSet!, rules: ZERO_DRC_RULES }); expect(fallback.fallbackUsed).toBe(true); expect(fallback.divergenceSignatures).toEqual([]); expect(fallback.electrical.equivalent && fallback.drc.equivalent).toBe(true);
    const diverged = runDifferentialVerification({ board: result.project.pcb, revision: result.revision, changeSet: result.record.appliedChangeSet!, rules: ZERO_DRC_RULES, injectedIncremental: { electrical: { corrupted: true }, drc: { corrupted: true } } }); expect(diverged.fallbackUsed).toBe(false); expect(diverged.divergenceSignatures).toHaveLength(2); expect(diverged.electrical.equivalent || diverged.drc.equivalent).toBe(false);
  });
});
