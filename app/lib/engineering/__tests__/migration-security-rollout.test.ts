import { describe, expect, it } from "vitest";
import { actorCapabilities, authorizeOperations } from "../authorization";
import { migrateLegacyProject } from "../migration";
import { ALL_DRC_CHECK_KINDS, DRC_CHECKER_DESCRIPTORS, validateDrcDescriptors } from "../drc-descriptors";
import { Stage10Telemetry } from "../observability";
import { openCircuitBreaker, SAFE_STAGE10_ROLLOUT, canUseIncrementalRead } from "../rollout";
import { STAGE10_CORPUS_MANIFEST, STAGE10_SCENARIOS } from "../stage10-corpus";
import { engineeringStatusLabels } from "../status";
import { createEngineeringTransaction, EngineeringTransactionService } from "../transaction-service";
import { validatePersistenceEnvelope } from "../persistence";
import { actor, projectFixture, track, transaction } from "./fixtures";

describe("Stage 10 migration, authorization, telemetry, and rollout", () => {
  it("migrates a legacy board through deterministic identity/constraint backfill with physical equivalence", () => {
    const project = projectFixture(); project.pcb.identityVersion = undefined; for (const net of project.pcb.nets) { net.stableId = undefined; net.endpointKeys = undefined; } const result = migrateLegacyProject({ schemaVersion: 1, id: project.projectId, state: project.schematic, pcb: project.pcb }, { tenantId: project.tenantId, actorId: "migration", buildId: "test" });
    expect(result.equivalent).toBe(true); expect(result.envelope.canonicalSnapshot.pcb.identityVersion).toBe(1); expect(result.envelope.migrationHistory).toHaveLength(1); expect(validatePersistenceEnvelope(result.envelope)).toEqual([]); expect(() => migrateLegacyProject({ schemaVersion: 99, id: "future", pcb: project.pcb }, { tenantId: "t", actorId: "m", buildId: "test" })).toThrow(/FUTURE_PROJECT_SCHEMA/);
  });

  it("bounds delegated AI authority by capability and expiry", () => {
    const operation = { operationId: "add", schemaVersion: 1 as const, units: "nm" as const, kind: "add_track" as const, track: track("t") }; const ai = { ...actor("automation", "ai"), actorKind: "ai" as const, delegatedByActorId: "human", delegatedCapabilities: ["edit_copper" as const], delegationExpiresAt: "2027-01-01T00:00:00.000Z" };
    expect(authorizeOperations(ai, [operation], new Date("2026-07-17")).allowed).toBe(true); expect(actorCapabilities(ai, new Date("2028-01-01"))).toEqual(new Set(["read_project"])); const protect = { operationId: "protect", schemaVersion: 1 as const, units: "nm" as const, kind: "set_footprint_protection" as const, footprintId: "u1", locked: true }; expect(authorizeOperations({ ...ai, delegatedCapabilities: ["manage_protection"] }, [protect], new Date("2026-07-17")).allowed).toBe(false);
  });

  it("rejects cross-project and tampered submissions without changing either head", async () => {
    const project = projectFixture(); const service = await EngineeringTransactionService.open(project, { buildId: "test", serverMode: true }); const valid = transaction(project, [{ operationId: "add", schemaVersion: 1, units: "nm", kind: "add_track", track: track("t") }]); const cross = createEngineeringTransaction({ ...valid, projectId: "project-other", clientOperationId: "cross", transactionId: "cross" }); const crossResult = await service.submit(cross); expect(crossResult.state).toBe("rejected_invalid"); const tampered = await service.submit({ ...valid, reason: "tampered" }); expect(tampered.state).toBe("rejected_invalid"); expect(service.currentRevision().headSequence).toBe(0);
  });

  it("records privacy-minimized operational telemetry without geometry or project IDs", () => {
    const telemetry = new Stage10Telemetry(); const event = telemetry.record({ metric: "transaction_conflicted", tenantId: "tenant-secret", projectId: "project-secret", transactionId: "tx:1", reasonCode: "same_field" }); expect(event.projectPseudonym).not.toContain("project-secret"); expect(JSON.stringify(event)).not.toContain("tenant-secret"); expect(telemetry.counts()).toEqual({ transaction_conflicted: 1 });
  });

  it("keeps selective reads disabled in shadow phase and opens a full-fallback circuit breaker", () => {
    expect(canUseIncrementalRead(SAFE_STAGE10_ROLLOUT, "drc")).toEqual({ allowed: false, reason: "INCREMENTAL_READ_NOT_CUT_OVER" }); const opened = openCircuitBreaker({ ...SAFE_STAGE10_ROLLOUT, selectiveIncrementalReads: { drc: true } }, "drc", "divergence"); expect(canUseIncrementalRead(opened, "drc")).toEqual({ allowed: false, reason: "CIRCUIT_BREAKER:divergence" }); expect(opened.fullOracleFallback).toBe(true);
  });

  it("registers every current DRC kind while keeping untrusted incremental paths on full fallback", () => {
    expect(validateDrcDescriptors()).toEqual([]); expect(new Set(DRC_CHECKER_DESCRIPTORS.flatMap((item) => item.kinds)).size).toBe(ALL_DRC_CHECK_KINDS.length); expect(DRC_CHECKER_DESCRIPTORS.every((item) => item.incrementalEvaluator === "not_trusted" && item.fallbackThreshold.fallback === "full")).toBe(true);
  });

  it("keeps saved, synchronized, and verified status meanings distinct", () => {
    const labels = engineeringStatusLabels({ preview: false, acceptedLocally: true, durableLocal: true, acceptedServer: true, durableServer: true, synchronizedToHead: true, verifiedAtHead: false, online: true, unsynchronizedTransactions: 0, verification: "pending", conflictCount: 1 }); expect(labels).toEqual(["Durably stored locally", "Synchronized to current project head", "Verification pending", "1 engineering conflict(s) require review"]); expect(labels).not.toContain("Verified at current head");
  });

  it("governs Stage 10 scenarios without modifying the immutable Stage 9 corpus", () => {
    expect(STAGE10_SCENARIOS.length).toBeGreaterThanOrEqual(35); expect(new Set(STAGE10_SCENARIOS.map((item) => item.scenarioId)).size).toBe(STAGE10_SCENARIOS.length); expect(STAGE10_SCENARIOS.every((item) => item.digest.startsWith("eng1-") && item.requiredAssertions.length > 0)).toBe(true); expect(STAGE10_CORPUS_MANIFEST.immutableStage9Corpus).toBe(true); expect(STAGE10_SCENARIOS.some((item) => item.partition === "hiddenHoldout")).toBe(true);
  });
});
