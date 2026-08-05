import { describe, expect, it } from "vitest";
import { DEFAULT_MAPPING_POLICY } from "../policy";
import { createNumberEqualityCandidate, createMappingCandidate } from "../adapters";
import { DeterministicMappingVerifier } from "../verifier";
import { candidateTechnicalPayload, mappingDigest, mappingId } from "../stable";
import { contextFixture, exactCandidate, request } from "./fixtures";

const verifier = new DeterministicMappingVerifier();

describe("Stage 4 representative electrical mapping verification", () => {
  it("verifies an exact nonpolar resistor and retains its explicit equivalence class", () => {
    const context = contextFixture(), candidate = exactCandidate(context, { equivalence: true });
    const result = verifier.verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(result).toMatchObject({ status: "verified", tier: "exact_part", symbolCoverage: { coveragePercent: 100 }, packageTerminalCoverage: { coveragePercent: 100 }, footprintPadCoverage: { coveragePercent: 100 }, claims: { approvesMapping: false, mutatesPcb: false } });
    expect(result.normalizedMapping?.equivalenceClasses[0]?.allowedPermutations).toHaveLength(2);
  });

  it("never verifies generic J1 from equal numeric pin, terminal, and pad counts", () => {
    const context = contextFixture({ risk: "simple_connector" }), candidate = createNumberEqualityCandidate(context);
    const result = verifier.verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(result.status).toBe("ambiguous");
    expect(result.tier).toBeUndefined();
    expect(result.findings.map((item) => item.code)).toEqual(expect.arrayContaining(["MV_UNSAFE_HEURISTIC_ORIGIN", "MV_EVIDENCE_MISSING"]));
    expect(result.ambiguities.map((item) => item.code)).toContain("MV_MAPPING_AUTHORITY_AMBIGUOUS");
  });

  it("rejects a reversed polarized capacitor despite perfect counts", () => {
    const context = contextFixture({ functions: ["positive", "negative"], risk: "polarized_two_terminal" });
    const candidate = exactCandidate(context, { pinToTerminal: [[0, 1], [1, 0]] });
    const result = verifier.verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(result.status).toBe("electrically_inconsistent");
    expect(result.findings.filter((item) => item.code === "MV_POLARITY_ORIENTATION_REVERSED")).toHaveLength(2);
  });

  it("rejects a wrong SOT-23 transistor function variant", () => {
    const context = contextFixture({ numbers: ["1", "2", "3"], functions: ["gate", "source", "drain"], risk: "transistor_fet" });
    const candidate = exactCandidate(context, { pinToTerminal: [[0, 2], [1, 1], [2, 0]] });
    const result = verifier.verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(result.status).toBe("electrically_inconsistent");
    expect(result.findings.map((item) => item.code)).toContain("MV_FUNCTION_CONTRADICTION");
  });

  it("reports an omitted QFN exposed pad, then verifies the exact mapped EP", () => {
    const context = contextFixture({ numbers: ["1", "2", "EP"], functions: ["input", "ground", "thermal"], thermalPads: ["EP"], risk: "thermal_exposed_pad" });
    const omitted = exactCandidate(context, { pinToTerminal: [[0, 0], [1, 1]], terminalToPad: [[0, 0], [1, 1]] });
    const blocked = verifier.verify(request(context, omitted), context, omitted, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(blocked.status).toBe("incomplete");
    expect(blocked.findings.map((item) => item.code)).toEqual(expect.arrayContaining(["MV_TERMINAL_COVERAGE_INCOMPLETE", "MV_PAD_COVERAGE_INCOMPLETE"]));
    const complete = exactCandidate(context);
    expect(verifier.verify(request(context, complete), context, complete, structuredClone(DEFAULT_MAPPING_POLICY))).toMatchObject({ status: "verified", tier: "exact_part" });
  });

  it("aggregates multi-unit representations and keeps hidden power pins required", () => {
    const context = contextFixture({ numbers: ["1", "2", "8", "4"], functions: ["input", "output", "power", "ground"], risk: "multi_unit_logic_amplifier", hidden: ["8", "4"], units: { "1": 1, "2": 1, "8": 3, "4": 3 } });
    const candidate = exactCandidate(context);
    const result = verifier.verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(result).toMatchObject({ status: "verified", symbolCoverage: { required: 4, accounted: 4 } });
    const missingPower = exactCandidate(context, { pinToTerminal: [[0, 0], [1, 1], [2, 2]] });
    expect(verifier.verify(request(context, missingPower), context, missingPower, structuredClone(DEFAULT_MAPPING_POLICY)).findings.map((item) => item.code)).toContain("MV_SYMBOL_COVERAGE_INCOMPLETE");
  });

  it("distinguishes USB signal, shield, and mechanical mounting pads", () => {
    const context = contextFixture({ numbers: ["A1", "A2", "SH", ""], functions: ["power", "differential_negative", "shield", "unknown"], risk: "keyed_or_power_connector", mechanicalPads: [""], shieldPads: ["SH"] });
    const candidate = exactCandidate(context);
    const result = verifier.verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(result.status).toBe("verified");
    expect(result.footprintPadCoverage.missing).toBe(0);
    expect(candidate.explicitUnmappedItems).toHaveLength(1);
  });

  it("blocks missing mechanical disposition even though electrical coverage is complete", () => {
    const context = contextFixture({ numbers: ["1", "2", ""], mechanicalPads: [""] });
    const candidate = exactCandidate(context, { omitMechanicalDispositions: true });
    const result = verifier.verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(result.status).toBe("incomplete");
    expect(result.findings.map((item) => item.code)).toContain("MV_MECHANICAL_PAD_DISPOSITION_MISSING");
  });

  it("keeps an AI-extracted high-confidence graph unverified", () => {
    const context = contextFixture(), raw = exactCandidate(context, { origin: "ai_extracted" });
    const candidate = createMappingCandidate({ ...raw, symbolToTerminalEdges: raw.symbolToTerminalEdges.map((edge) => ({ ...edge, confidence: 1 })), terminalToPadEdges: raw.terminalToPadEdges.map((edge) => ({ ...edge, confidence: 1 })), mappingCandidateId: undefined, candidateDigest: undefined } as never);
    const result = verifier.verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(result.status).toBe("evidence_insufficient");
    expect(result.findings.map((item) => item.code)).toContain("MV_MACHINE_SUGGESTION_UNVERIFIED");
  });

  it("reports the narrow symmetric-passive direct fallback as verified-limited and never layout-ready", () => {
    const context = contextFixture();
    const base = exactCandidate(context);
    context.packageTerminals = [];
    const directSymbolToPadEdges = context.symbolPins.map((pin, index) => {
      const technical = { relationship: "exact_one_to_one" as const, assertedFunction: "passive" as const, orientationSignificant: false, evidenceRefs: ["evidence_fixture"], origin: "manufacturer_datasheet" as const, ruleVersion: "fixture/direct-1", conditions: ["package terminal truth unavailable"], assemblyVariantIds: ["variant-default"], lifecycle: "current" as const, symbolPinId: pin.stablePinId, footprintPadId: context.footprintPads[index]!.stablePadId };
      return { ...technical, edgeId: mappingId("mapping-edge", technical) };
    });
    const candidate = createMappingCandidate({ ...base, compatibilityMode: "limited_direct_pair", symbolToTerminalEdges: [], terminalToPadEdges: [], directSymbolToPadEdges, mappingCandidateId: undefined, candidateDigest: undefined } as never);
    const result = verifier.verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(result).toMatchObject({ status: "verified_limited", tier: "limited_direct_pair", claims: { approvesMapping: false, mutatesPcb: false } });
    expect(DEFAULT_MAPPING_POLICY.acceptedLayoutTiers).not.toContain("limited_direct_pair");
  });

  it("invalidates verification when the footprint digest dependency changes", () => {
    const context = contextFixture(), original = exactCandidate(context);
    const changed = structuredClone(original);
    changed.footprintIdentity.contentDigest = `sha256:${"9".repeat(64)}`;
    const technical = candidateTechnicalPayload(changed);
    changed.candidateDigest = mappingDigest(technical);
    changed.mappingCandidateId = mappingId("mapping-candidate", changed.candidateDigest);
    const result = verifier.verify(request(context, changed), context, changed, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(result.status).toBe("structurally_invalid");
    expect(result.findings.map((item) => item.code)).toContain("MV_FOOTPRINT_IDENTITY_MISMATCH");
  });

  it("canonicalizes graph and equivalence member order deterministically", () => {
    const context = contextFixture(), first = exactCandidate(context, { equivalence: true });
    const input = structuredClone(first);
    input.symbolToTerminalEdges.reverse(); input.terminalToPadEdges.reverse(); input.equivalenceClasses[0]!.memberIds.reverse(); input.evidenceRefs.reverse();
    const reordered = createMappingCandidate({ ...input, mappingCandidateId: undefined, candidateDigest: undefined } as never);
    expect(reordered.candidateDigest).toBe(first.candidateDigest);
    const a = verifier.verify(request(context, first), context, first, structuredClone(DEFAULT_MAPPING_POLICY));
    const b = verifier.verify(request(context, reordered, { requestId: "verify-2", requestedAt: "2026-07-19T14:10:00.000Z" }), context, reordered, structuredClone(DEFAULT_MAPPING_POLICY));
    expect(b.resultDigest).toBe(a.resultDigest);
  });
});
