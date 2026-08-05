import { describe, expect, it } from "vitest";
import { createMappingCandidate } from "../adapters";
import { ScopedMappingInvalidationTarget } from "../invalidation";
import { MappingTelemetry } from "../observability";
import { DEFAULT_MAPPING_POLICY, validateMappingPolicy } from "../policy";
import { InMemoryMappingContextProvider } from "../providers";
import { InMemoryMappingRepository } from "../repository";
import { MappingVerificationService } from "../service";
import { InMemoryStage1MappingProjector } from "../stage1-projector";
import { DeterministicMappingVerifier } from "../verifier";
import type { MappingVerificationPolicy } from "../types";
import { contextFixture, exactCandidate, request } from "./fixtures";

function serviceForContext(context = contextFixture()) {
  const candidate = exactCandidate(context), telemetry = new MappingTelemetry();
  const service = new MappingVerificationService({ provider: new InMemoryMappingContextProvider({ contexts: [context], candidates: [candidate] }), repository: new InMemoryMappingRepository(), stage1Projector: new InMemoryStage1MappingProjector(), invalidation: new ScopedMappingInvalidationTarget(), telemetry });
  return { context, candidate, service, telemetry };
}

describe("Stage 4 fail-closed security and bounded execution", () => {
  it("does not permit policy weakening", () => {
    const weakened = structuredClone(DEFAULT_MAPPING_POLICY) as MappingVerificationPolicy;
    weakened.requireReviewedEvidence = false as true;
    weakened.acceptedLayoutTiers.push("limited_direct_pair");
    weakened.minimumTierByRisk.unsupported_unknown = "curated_pair";
    expect(validateMappingPolicy(weakened)).toEqual(expect.arrayContaining(["MV_POLICY_MANDATORY_GATE_WEAKENED", "MV_POLICY_LIMITED_DIRECT_LAYOUT_FORBIDDEN", "MV_POLICY_UNKNOWN_RISK_WEAKENED"]));
  });

  it("turns conflicting source evidence into an explicit conflict object", () => {
    const context = contextFixture(), candidate = exactCandidate(context);
    context.evidence[0]!.freshness = "conflicting";
    const result = new DeterministicMappingVerifier().verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(result.status).toBe("conflicting");
    expect(result.conflicts).toMatchObject([{ code: "MV_EVIDENCE_CONFLICT" }]);
  });

  it("does not let explicit-unmapped metadata waive a required electrical terminal", () => {
    const context = contextFixture(), original = exactCandidate(context);
    const candidate = createMappingCandidate({ ...original, symbolToTerminalEdges: original.symbolToTerminalEdges.slice(1), terminalToPadEdges: original.terminalToPadEdges.slice(1), explicitUnmappedItems: [{ itemId: context.packageTerminals[0]!.stableTerminalId, layer: "package_terminal", disposition: "optional_omitted", evidenceRefs: ["evidence_fixture"], reason: "attempted waiver" }], mappingCandidateId: undefined, candidateDigest: undefined } as never);
    const result = new DeterministicMappingVerifier().verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(result.status).not.toBe("verified");
    expect(result.findings.map((item) => item.code)).toEqual(expect.arrayContaining(["MV_UNMAPPED_DISPOSITION_CONTRADICTS_IDENTITY", "MV_TERMINAL_COVERAGE_INCOMPLETE"]));
  });

  it("honors cancellation and the fixed batch ceiling", async () => {
    const { context, candidate, service } = serviceForContext();
    const controller = new AbortController(); controller.abort();
    await expect(service.verify(request(context, candidate), controller.signal)).rejects.toThrow("MV_REQUEST_CANCELLED");
    await expect(service.verifyBatch(Array.from({ length: 65 }, (_, index) => request(context, candidate, { requestId: `batch-${index}` })))).rejects.toThrow("MV_BATCH_LIMIT_EXCEEDED");
  });

  it("keeps telemetry pseudonymous and free of raw tenant/project identifiers", async () => {
    const { context, candidate, service, telemetry } = serviceForContext();
    await service.verify(request(context, candidate));
    const serialized = JSON.stringify(telemetry.snapshot());
    expect(serialized).not.toContain("tenant-1");
    expect(serialized).not.toContain("project-1");
    expect(telemetry.snapshot().some((item) => item.metric === "verify_ms")).toBe(true);
  });

  it("redacts confidential evidence during read-only inspection", async () => {
    const context = contextFixture();
    context.evidence[0] = { ...context.evidence[0]!, confidential: true, locator: "secret-source-page-9", reviewerId: "private-reviewer" };
    const { candidate, service } = serviceForContext(context);
    const inspected = await service.inspect(request(context, candidate));
    expect(inspected.context.evidence[0]).toMatchObject({ confidential: true, locator: "[restricted]" });
    expect(inspected.context.evidence[0]?.reviewerId).toBeUndefined();
  });

  it("verifies a 512-terminal exact mapping within the bounded policy profile", () => {
    const numbers = Array.from({ length: 512 }, (_, index) => String(index + 1));
    const context = contextFixture({ numbers, functions: numbers.map(() => "bidirectional"), risk: "complex_ic" });
    const candidate = exactCandidate(context);
    const started = performance.now();
    const result = new DeterministicMappingVerifier().verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    const elapsedMs = performance.now() - started;
    expect(result).toMatchObject({ status: "verified", symbolCoverage: { required: 512, missing: 0 }, packageTerminalCoverage: { required: 512, missing: 0 }, footprintPadCoverage: { required: 512, missing: 0 } });
    expect(elapsedMs).toBeLessThan(5_000);
  }, 15_000);
});
