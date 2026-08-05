import { describe, expect, it } from "vitest";
import { assertProposalOnlyToolPayload, normalizeCalculationAgentProposal } from "../agent-tools";
import { idealAdcLsbBounds, loadedDividerBounds, rcTimeConstantBounds, simpleSteadyStateJunctionEstimate } from "../calculators";
import { LOW_VOLTAGE_CALCULATION_PROFILE_V1 } from "../capability";
import { createCornerDimension, enumerateCornerCases, exhaustiveCoverage, sampledCoverageCannotProve } from "../corners";
import { evaluateExpression } from "../expression";
import { solveCd6Cd7FixedPoint } from "../fixed-point";
import { createInterval, divideIntervals, pointInterval } from "../interval";
import { decideBoundedConstraint } from "../margins";
import { addRational, parseExactDecimal, rational } from "../rational";
import { preferredValuesInRange, synthesizeJointPreferredValues } from "../synthesis";
import { createCorrelationModel, guaranteedVariableDomain, statisticalCombinationGate } from "../tolerance";
import { CD7_CORPUS_MANIFEST } from "../corpus";
import { calculationDigest } from "../stable";
import { applyCalculationTransaction, createCalculationTransaction } from "../transactions";
import type { CalculationProjectState } from "../types";
import { applyDeratingRule, approveDeratingRule, createDeratingRule } from "../derating";
import { addQuantities, compareQuantitiesExact, createEngineeringQuantity, divideQuantities, multiplyQuantities, subtractQuantities } from "../units";
import type { EngineeringQuantity } from "../types";

const q = (value: string, unit: string, semanticKind = unit) => createEngineeringQuantity({ value, unit, semanticKind });
const interval = (lower: string, upper: string, unit: string) => createInterval({ lower: q(lower, unit), upper: q(upper, unit) });

describe("CD-7 exact numeric and unit kernel", () => {
  it("parses decimal and exponent forms exactly", () => {
    expect(parseExactDecimal("0.1")).toEqual(rational(1, 10));
    expect(parseExactDecimal("1.25e-3")).toEqual(rational(1, 800));
    expect(addRational(parseExactDecimal("0.1"), parseExactDecimal("0.2"))).toEqual(rational(3, 10));
  });

  it("rejects locale-dependent and non-canonical inputs", () => {
    expect(() => parseExactDecimal("1,2")).toThrow("CD7_DECIMAL_FORMAT_INVALID");
    expect(() => parseExactDecimal(" 1.2")).toThrow("CD7_DECIMAL_FORMAT_INVALID");
  });

  it("keeps milli and mega prefixes case-sensitive", () => {
    expect(q("1", "mV").exactValue).toEqual(rational(1, 1000));
    expect(q("1", "Mohm").exactValue).toEqual(rational(1_000_000));
    expect(() => q("1", "MOhm")).toThrow("CD7_UNIT_UNSUPPORTED");
    expect(q("1", "µV").exactValue).toEqual(q("1", "uV").exactValue);
  });

  it("rejects mismatched dimensions and preserves derived canonical units", () => {
    expect(() => addQuantities(q("1", "V"), q("1", "A"))).toThrow("CD7_QUANTITY_DIMENSION_OR_CONVENTION_MISMATCH");
    expect(multiplyQuantities(q("2", "V"), q("3", "A")).canonicalUnit).toBe("W");
    expect(multiplyQuantities(q("2", "kohm"), q("3", "uF")).canonicalUnit).toBe("s");
  });

  it("enforces affine temperature rules", () => {
    expect(() => addQuantities(q("25", "degC"), q("30", "degC"))).toThrow("CD7_AFFINE_ABSOLUTE_ADDITION_ILLEGAL");
    expect(subtractQuantities(q("30", "degC"), q("25", "degC")).unitKind).toBe("affine_delta");
    expect(() => multiplyQuantities(q("25", "degC"), q("2", "1"))).toThrow("CD7_AFFINE_OR_LOG_MULTIPLICATION_ILLEGAL");
    expect(() => subtractQuantities(q("5", "deltaC"), q("25", "degC"))).toThrow("CD7_QUANTITY_DIMENSION_OR_CONVENTION_MISMATCH");
  });

  it("does not silently equate Hz with rad/s or degrees with radians", () => {
    expect(() => compareQuantitiesExact(q("1", "Hz"), q("1", "rad/s"))).toThrow("CD7_QUANTITY_DIMENSION_OR_CONVENTION_MISMATCH");
    expect(() => compareQuantitiesExact(q("1", "deg"), q("1", "rad"))).toThrow("CD7_QUANTITY_DIMENSION_OR_CONVENTION_MISMATCH");
  });

  it("requires explicit waveform semantics for semantically distinct values", () => {
    const rms = createEngineeringQuantity({ value: "1", unit: "V", semanticKind: "signal", waveformSemantics: "rms" });
    const peak = createEngineeringQuantity({ value: "1", unit: "V", semanticKind: "signal", waveformSemantics: "peak" });
    expect(rms.waveformSemantics).not.toBe(peak.waveformSemantics);
  });

  it("blocks interval division through zero", () => {
    expect(() => divideIntervals(interval("1", "2", "V"), interval("-1", "1", "A"))).toThrow("CD7_INTERVAL_DIVISOR_CONTAINS_ZERO");
  });

  it("evaluates only the allowlisted AST with exact enclosure", () => {
    const result = evaluateExpression({ kind: "divide", left: { kind: "variable", variableId: "v" }, right: { kind: "variable", variableId: "r" } }, new Map([["v", interval("4", "5", "V")], ["r", interval("2", "4", "ohm")]]));
    expect(result.state).toBe("evaluated");
    expect(result.interval?.lowerBound.exactValue).toEqual(rational(1));
    expect(result.interval?.upperBound.exactValue).toEqual(rational(5, 2));
  });
});

describe("CD-7 bounded models and decisions", () => {
  it("computes loaded-divider bounds instead of ignoring the load", () => {
    const unloaded = loadedDividerBounds({ inputVoltage: pointInterval(q("10", "V")), topResistance: pointInterval(q("10", "kohm")), bottomResistance: pointInterval(q("10", "kohm")), evidenceClass: "guaranteed" });
    const loaded = loadedDividerBounds({ inputVoltage: pointInterval(q("10", "V")), topResistance: pointInterval(q("10", "kohm")), bottomResistance: pointInterval(q("10", "kohm")), loadResistance: pointInterval(q("10", "kohm")), evidenceClass: "guaranteed" });
    expect(unloaded.interval?.lowerBound.exactValue).toEqual(rational(5));
    expect(loaded.interval?.lowerBound.exactValue).toEqual(rational(10, 3));
  });

  it("computes an exact RC time constant", () => {
    const result = rcTimeConstantBounds({ resistance: pointInterval(q("10", "kohm")), capacitance: pointInterval(q("1", "uF")), evidenceClass: "guaranteed" });
    expect(result.interval?.lowerBound.exactValue).toEqual(rational(1, 100));
    expect(result.interval?.lowerBound.canonicalUnit).toBe("s");
  });

  it("keeps ideal ADC quantization explicitly bounded in scope", () => {
    const result = idealAdcLsbBounds({ referenceVoltage: pointInterval(q("4.096", "V")), resolutionBits: 12, evidenceClass: "guaranteed" });
    expect(result.interval?.lowerBound.exactValue).toEqual(rational(1, 1000));
    expect(result.diagnostics[0]).toContain("Ideal quantization only");
  });

  it("never upgrades simple theta-JA analysis into guaranteed thermal proof", () => {
    const result = simpleSteadyStateJunctionEstimate({ ambient: interval("25", "30", "degC"), dissipation: interval("1", "2", "W"), thetaJa: interval("40", "50", "K/W"), evidenceClass: "guaranteed" });
    expect(result.state).toBe("external_review_required");
    expect(result.interval?.lowerBound.unitKind).toBe("affine_absolute");
  });

  it("uses proof-aware pass, fail, and indeterminate boundary logic", () => {
    expect(decideBoundedConstraint({ constraintId: "c", resultId: "r", result: interval("4", "5", "V"), comparator: "lte", limit: q("5", "V"), governingCornerId: "corner" }).status).toBe("pass");
    expect(decideBoundedConstraint({ constraintId: "c", resultId: "r", result: interval("6", "7", "V"), comparator: "lte", limit: q("5", "V"), governingCornerId: "corner" }).status).toBe("fail");
    expect(decideBoundedConstraint({ constraintId: "c", resultId: "r", result: interval("4", "6", "V"), comparator: "lte", limit: q("5", "V"), governingCornerId: "corner" }).status).toBe("indeterminate_numeric");
    expect(decideBoundedConstraint({ constraintId: "c", resultId: "r", result: interval("4", "5", "V"), comparator: "gte", limit: q("5", "V"), governingCornerId: "corner" }).status).toBe("indeterminate_numeric");
  });
});

describe("CD-7 proof coverage, correlation, and synthesis", () => {
  it("enumerates all reachable discrete corners deterministically", () => {
    const dimension = createCornerDimension({ semanticName: "state", dimensionKind: "state", valueDomain: "discrete", discreteValues: [{ valueId: "a", value: "a" }, { valueId: "b", value: "b" }], correlationAndCouplingRefs: [], applicabilityRuleId: "always", evidenceRefs: ["test"] });
    const result = enumerateCornerCases({ dimensions: [dimension], variantIds: ["v1", "v2"], modeIds: ["m"], maximumCorners: 10 });
    expect(result.state).toBe("complete"); expect(result.corners).toHaveLength(4);
  });

  it("selects extrema numerically, not lexicographically", () => {
    const dimension = createCornerDimension({ semanticName: "state", dimensionKind: "state", valueDomain: "discrete", discreteValues: [{ valueId: "two", value: "two" }, { valueId: "ten", value: "ten" }], correlationAndCouplingRefs: [], applicabilityRuleId: "always", evidenceRefs: ["test"] });
    const enumeration = enumerateCornerCases({ dimensions: [dimension], variantIds: ["v"], modeIds: ["m"], maximumCorners: 10 });
    const coverage = exhaustiveCoverage({ obligationOrConstraintId: "o", corners: enumeration.corners, relevantDimensionIds: [dimension.dimensionId], evaluate: (corner) => pointInterval(q(corner.discreteAssignments[0].valueId === "two" ? "2" : "10", "V")), policyRevision: "p", capabilityProfile: LOW_VOLTAGE_CALCULATION_PROFILE_V1 });
    expect(coverage.coverageState).toBe("proven_complete");
    expect(coverage.extremaResults.find((item) => item.extremum === "maximum")?.resultInterval.upperBound.exactValue).toEqual(rational(10));
  });

  it("never calls sampling a coverage proof", () => {
    expect(sampledCoverageCannotProve({ id: "o", cornerIds: ["c"], dimensions: ["d"], policy: "p", seed: 7 }).coverageState).toBe("sampled_not_proven");
  });

  it("blocks statistical combination when correlation is undeclared or unapproved", () => {
    expect(statisticalCombinationGate(["a", "b"], []).allowed).toBe(false);
    const approved = createCorrelationModel({ memberVariableIds: ["a", "b"], relationshipKind: "independent", conditions: [], evidenceOrAssumptionRefs: ["e"], validationState: "approved" });
    expect(statisticalCombinationGate(["a", "b"], [approved]).allowed).toBe(true);
  });

  it("does not treat nominal or characterized data as guaranteed proof", () => {
    const value: EngineeringQuantity = q("1", "V");
    expect(guaranteedVariableDomain({ variableId: "v", semanticRole: "rail", nominalValue: value, modeVariantApplicability: [], correlationGroupIds: [], provenanceRefs: [], freshnessState: "current", supportState: "supported", deterministicDigest: "fixture" }).state).toBe("estimate_only");
  });

  it("applies only a human-approved, scoped derating rule", () => {
    const draft = createDeratingRule({ revision: 1, semanticName: "resistor voltage derating", componentCategory: "resistor", stressKind: "voltage", sourceLimitKind: "absolute_maximum", factor: rational(4, 5), applicabilityConditions: ["continuous"], environmentEnvelopeIds: ["lab"], evidenceRefs: ["policy:test"] });
    expect(applyDeratingRule({ rule: draft, originalLimit: q("100", "V"), componentCategory: "resistor", stressKind: "voltage", activeConditions: ["continuous"], environmentEnvelopeId: "lab" }).state).toBe("unknown");
    const approved = approveDeratingRule(draft, { actorId: "reviewer", actorKind: "human", sessionId: "s", role: "reviewer" }, "component derating", "low-voltage lab", "2026-07-18T00:00:00.000Z");
    expect(applyDeratingRule({ rule: approved, originalLimit: q("100", "V"), componentCategory: "resistor", stressKind: "voltage", activeConditions: ["continuous"], environmentEnvelopeId: "lab" }).deratedLimit.exactValue).toEqual(rational(80));
  });

  it("recalculates every joint preferred-value candidate", () => {
    const first = preferredValuesInRange({ series: "E6", minimum: q("10", "kohm"), maximum: q("22", "kohm"), maximumCandidates: 10 });
    const second = preferredValuesInRange({ series: "E6", minimum: q("10", "kohm"), maximum: q("15", "kohm"), maximumCandidates: 10 });
    let calls = 0;
    const candidates = synthesizeJointPreferredValues({ synthesisId: "s", domains: [{ roleId: "r1", values: first, series: "E6" }, { roleId: "r2", values: second, series: "E6" }], capabilityProfile: LOW_VOLTAGE_CALCULATION_PROFILE_V1, recalculate: () => ({ runId: `run:${++calls}`, hardConstraintResults: [{ constraintId: "c", state: "pass" }], objectiveVector: [], unresolvedBindings: [] }) });
    expect(calls).toBe(first.length * second.length); expect(candidates).toHaveLength(calls);
  });

  it("detects semantic fixed-point oscillation", () => {
    const result = solveCd6Cd7FixedPoint({ initial: { selected: "a" }, maximumIterations: 5, step: (value) => ({ value: { selected: value.selected === "a" ? "b" : "a" } }) });
    expect(result.state).toBe("oscillation");
  });

  it("keeps AI payloads proposal-only", () => {
    const proposal = normalizeCalculationAgentProposal({ kind: "analysis_plan", obligationIds: ["o"], proposedModelRevisionIds: ["m:1"], explanation: "Use the approved bounded model.", warnings: [] });
    expect(proposal.mayApproveEngineeringState).toBe(false);
    expect(() => assertProposalOnlyToolPayload({ approvalState: "approved" })).toThrow("CD7_AGENT_PROPOSAL_AUTHORITY_VIOLATION");
  });

  it("retains exact dimensionless division", () => {
    expect(divideQuantities(q("5", "V"), q("2", "V")).exactValue).toEqual(rational(5, 2));
  });

  it("registers every normative verification class without pretending metadata is evidence", () => {
    expect(CD7_CORPUS_MANIFEST).toHaveLength(93);
    expect(CD7_CORPUS_MANIFEST.every((item) => item.implementationState === "manifest_only")).toBe(true);
    expect(CD7_CORPUS_MANIFEST.every((item) => item.immutableManifestHash === calculationDigest({ fixtureId: item.fixtureId, family: item.family, title: item.title, expectedOutcome: item.expectedOutcome, sourceLicenseId: item.sourceLicenseId, provenance: item.provenance, implementationState: item.implementationState }))).toBe(true);
  });

  it("denies AI transactions and rejects stale optimistic bases before mutation", () => {
    const state = { projectId: "p", branchId: "b", deterministicDigest: "current", transactionRecords: [] } as unknown as CalculationProjectState;
    const operation = { operationId: "op", kind: "add_feedback" as const, feedback: { feedbackId: "f" } as never };
    const ai = createCalculationTransaction({ projectId: "p", branchId: "b", actor: { actorId: "ai", actorKind: "ai", sessionId: "s", role: "automation" }, reason: "proposal cannot commit", baseStateDigest: "current", idempotencyKey: "ai", operations: [operation], createdAt: "2026-07-18T00:00:00.000Z" });
    expect(applyCalculationTransaction(state, ai).record.state).toBe("rejected");
    const stale = createCalculationTransaction({ projectId: "p", branchId: "b", actor: { actorId: "human", actorKind: "human", sessionId: "s", role: "project_admin" }, reason: "stale write", baseStateDigest: "old", idempotencyKey: "stale", operations: [operation], createdAt: "2026-07-18T00:00:00.000Z" });
    expect(applyCalculationTransaction(state, stale).record.state).toBe("conflict");
  });
});
