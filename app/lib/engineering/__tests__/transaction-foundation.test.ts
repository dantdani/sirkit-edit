import { describe, expect, it } from "vitest";
import { authorizeOperations } from "../authorization";
import { affectedDerivedKinds, DerivedDependencyGraph, validateEvaluatorRegistry } from "../dependency";
import { applyEngineeringOperations, deriveEngineeringChangeSet } from "../operations";
import { InMemoryAtomicProjectStore, validatePersistenceEnvelope } from "../persistence";
import { changedDomains, computeProjectRevision } from "../revision";
import { objectVersion } from "../stable";
import { EngineeringTransactionService, validateTransactionEnvelope } from "../transaction-service";
import type { EngineeringOperation } from "../types";
import { actor, projectFixture, track, transaction } from "./fixtures";

const addTrack = (id = "t1"): EngineeringOperation => ({ operationId: `op:add:${id}`, schemaVersion: 1, units: "nm", kind: "add_track", track: track(id) });

describe("Stage 10 semantic transaction and revision foundation", () => {
  it("covers semantic domains independently and preserves array-order-independent revision identity", () => {
    const project = projectFixture(); const first = computeProjectRevision(project); const reordered = structuredClone(project); reordered.pcb.footprints.reverse(); reordered.pcb.nets.reverse(); const second = computeProjectRevision(reordered);
    expect(second.canonicalStateDigest).toBe(first.canonicalStateDigest);
    const moved = applyEngineeringOperations(project, [{ operationId: "move", schemaVersion: 1, units: "nm", kind: "move_footprint", footprintId: "u1", at: { x: 3_000_000, y: 2_000_000 } }]).project; const movedRevision = computeProjectRevision(moved);
    expect(changedDomains(first, movedRevision)).toEqual(["boardGeometry"]);
    const preferred = applyEngineeringOperations(project, [{ operationId: "prefs", schemaVersion: 1, units: "nm", kind: "update_routing_preferences", preferences: { version: 1, trackWidthMode: "custom", customTrackWidthNm: 300_000, viaMode: "net-class" } }]).project;
    expect(changedDomains(first, computeProjectRevision(preferred))).toEqual(["copperTopology"]);
  });

  it("canonicalizes and detects tampered transaction envelopes", () => {
    const project = projectFixture(); const tx = transaction(project, [addTrack()]); expect(validateTransactionEnvelope(tx)).toEqual([]); expect(validateTransactionEnvelope({ ...tx, reason: "tampered" })).toContain("TRANSACTION_DIGEST_MISMATCH");
  });

  it("enforces object versions, lock protection, integer nm, and ID non-reuse", () => {
    const project = projectFixture(); project.pcb.tracks.push({ ...track("locked"), locked: true });
    expect(() => applyEngineeringOperations(project, [{ operationId: "remove", schemaVersion: 1, units: "nm", kind: "remove_track", trackId: "locked" }])).toThrow(/PROTECTED_OBJECT/);
    expect(() => applyEngineeringOperations(project, [{ operationId: "move", schemaVersion: 1, units: "nm", kind: "move_footprint", footprintId: "u1", at: { x: 1.5, y: 2 } }])).toThrow(/INVALID_NM/);
    expect(() => applyEngineeringOperations(project, [addTrack("locked")])).toThrow(/ID_REUSE/);
    expect(() => applyEngineeringOperations(project, [{ operationId: "version", schemaVersion: 1, units: "nm", kind: "move_footprint", footprintId: "u1", at: { x: 2, y: 2 }, expectedObjectVersion: objectVersion({ wrong: true }) }])).toThrow(/OBJECT_VERSION_MISMATCH/);
  });

  it("derives exact object, net, layer, bounds, revision and dependency impact", () => {
    const project = projectFixture(); const base = computeProjectRevision(project); const after = applyEngineeringOperations(project, [addTrack()]).project; const change = deriveEngineeringChangeSet(project, after, base, "tx:1");
    expect(change.createdIdsByKind.track).toEqual(["t1"]); expect(change.affectedNetIds).toEqual([1]); expect(change.affectedLayers).toEqual(["copperTop"]); expect(change.beforeAfterObjectVersions).toEqual(expect.arrayContaining([expect.objectContaining({ objectId: "track:t1" })])); expect(change.dependencyKeys).toContain("source:copperTopology"); expect(change.semanticImpactFlags).toContain("physical_contact_geometry_changed");
    expect(affectedDerivedKinds(change)).toEqual(expect.arrayContaining(["electrical_truth", "drc", "readiness", "ai_snapshot"]));
  });

  it("registers an acyclic complete dependency graph and invalidates before publication", async () => {
    expect(validateEvaluatorRegistry()).toEqual([]); const project = projectFixture(); const store = new InMemoryAtomicProjectStore(); const service = await EngineeringTransactionService.open(project, { buildId: "test", store }); let observed = "";
    service.subscribe((outcome) => { observed = service.verificationState(); expect(outcome.revision.headSequence).toBe(1); expect(outcome.derivedArtifacts.every((item) => item.status === "pending")).toBe(true); });
    const result = await service.submit(transaction(project, [addTrack()])); expect(result.state).toBe("accepted"); expect(observed).toBe("pending"); expect(service.currentRevision().headSequence).toBe(1); expect(service.currentProject().pcb.tracks).toHaveLength(1);
    const envelope = service.unsafeTestEnvelope(); expect(validatePersistenceEnvelope(envelope)).toEqual([]);
    const graph = new DerivedDependencyGraph(); const change = (result.state === "accepted" ? result.record.appliedChangeSet : undefined)!; graph.invalidate(change); expect(graph.get("readiness")?.status).toBe("pending");
  });

  it("applies duplicate client operations exactly once across retry", async () => {
    const project = projectFixture(); const service = await EngineeringTransactionService.open(project, { buildId: "test" }); const tx = transaction(project, [addTrack()]); const first = await service.submit(tx); const duplicate = await service.submit(tx);
    expect(first.state).toBe("accepted"); expect(duplicate.state).toBe("duplicate"); expect(service.currentRevision().headSequence).toBe(1); expect(service.currentProject().pcb.tracks.map((item) => item.id)).toEqual(["t1"]);
  });

  it("authorizes before validation/mutation and keeps AI scope non-privileged", async () => {
    const project = projectFixture(); const service = await EngineeringTransactionService.open(project, { buildId: "test" }); const viewer = await service.submit(transaction(project, [addTrack()], { role: "viewer" })); expect(viewer.state).toBe("rejected_unauthorized"); expect(service.currentRevision().headSequence).toBe(0);
    const protect: EngineeringOperation = { operationId: "protect", schemaVersion: 1, units: "nm", kind: "set_footprint_protection", footprintId: "u1", locked: true }; expect(authorizeOperations({ ...actor("project_admin", "ai"), actorKind: "ai" }, [protect]).allowed).toBe(false);
  });

  it("keeps the old head when persistence fails before commit and recovers unknown acknowledgements", async () => {
    const project = projectFixture(); let phase: "none" | "before" | "after" = "before"; const store = new InMemoryAtomicProjectStore((point) => { if ((phase === "before" && point === "before_commit") || (phase === "after" && point === "after_commit_before_ack")) throw new Error(`fault:${phase}`); }); const service = await EngineeringTransactionService.open(project, { buildId: "test", store });
    const failed = await service.submit(transaction(project, [addTrack("a")], { clientOperationId: "client:a" })); expect(failed.state).toBe("persistence_failed"); expect(service.currentRevision().headSequence).toBe(0); expect(service.currentProject().pcb.tracks).toHaveLength(0);
    phase = "after"; const recovered = await service.submit(transaction(project, [addTrack("b")], { clientOperationId: "client:b" })); expect(recovered.state).toBe("duplicate"); expect(service.currentRevision().headSequence).toBe(1); expect(service.currentProject().pcb.tracks[0].id).toBe("b");
    phase = "none";
  });
});
