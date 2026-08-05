import { createInterval } from "./interval";
import { compareRational, multiplyRational, powerRational, rational, subtractRational } from "./rational";
import { calculationDigest, calculationId } from "./stable";
import { quantityFromCanonical } from "./units";
import type { CalculationCapabilityProfile, CalculationEvidenceState, EngineeringQuantity, RationalValue, ValueCandidate } from "./types";

export type PreferredSeries = "E6" | "E12" | "E24";
const SERIES: Record<PreferredSeries, number[]> = {
  E6: [10, 15, 22, 33, 47, 68],
  E12: [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82],
  E24: [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91],
};

export function preferredValuesInRange(input: { series: PreferredSeries; minimum: EngineeringQuantity; maximum: EngineeringQuantity; maximumCandidates: number }): EngineeringQuantity[] {
  if (input.minimum.canonicalUnit !== input.maximum.canonicalUnit || input.minimum.unitKind !== input.maximum.unitKind || compareRational(input.minimum.exactValue, input.maximum.exactValue) > 0) throw new Error("CD7_PREFERRED_VALUE_RANGE_INVALID");
  const values: EngineeringQuantity[] = [];
  for (let decade = -18; decade <= 18; decade++) {
    const scale = powerRational(rational(10), decade - 1);
    for (const mantissa of SERIES[input.series]) {
      const exactValue = multiplyRational(rational(mantissa), scale);
      if (compareRational(exactValue, input.minimum.exactValue) < 0 || compareRational(exactValue, input.maximum.exactValue) > 0) continue;
      values.push(quantityFromCanonical(`${input.series}-preferred`, exactValue, input.minimum.physicalDimension, { canonicalUnit: input.minimum.canonicalUnit, unitKind: input.minimum.unitKind }));
      if (values.length > input.maximumCandidates) throw new Error("CD7_PREFERRED_VALUE_RESOURCE_LIMIT");
    }
  }
  return values.sort((a, b) => compareRational(a.exactValue, b.exactValue));
}

export interface RecalculationOutcome {
  runId: string;
  hardConstraintResults: Array<{ constraintId: string; state: CalculationEvidenceState }>;
  objectiveVector: ValueCandidate["objectiveVector"];
  unresolvedBindings: string[];
}

export function synthesizeJointPreferredValues(input: { synthesisId: string; domains: Array<{ roleId: string; values: EngineeringQuantity[]; series: PreferredSeries }>; capabilityProfile: CalculationCapabilityProfile; recalculate: (assignments: Array<{ roleId: string; value: EngineeringQuantity }>) => RecalculationOutcome }): ValueCandidate[] {
  const count = input.domains.reduce((product, item) => product * item.values.length, 1);
  if (!Number.isSafeInteger(count) || count > input.capabilityProfile.limits.maximumPreferredValueCandidates) throw new Error("CD7_PREFERRED_VALUE_RESOURCE_LIMIT");
  const assignments: Array<Array<{ roleId: string; value: EngineeringQuantity }>> = [[]];
  for (const domain of input.domains) {
    if (!domain.values.length) throw new Error(`CD7_PREFERRED_VALUE_DOMAIN_EMPTY:${domain.roleId}`);
    const prior = assignments.splice(0);
    for (const prefix of prior) for (const value of domain.values) assignments.push([...prefix, { roleId: domain.roleId, value }]);
  }
  const candidates = assignments.map((assignment): ValueCandidate => {
    const evaluation = input.recalculate(structuredClone(assignment));
    const hardPass = evaluation.hardConstraintResults.every((item) => item.state === "pass" || item.state === "not_applicable");
    const quantizationError = assignment.map((item) => {
      const zero = quantityFromCanonical("quantization-error", rational(0), item.value.physicalDimension, { canonicalUnit: item.value.canonicalUnit, unitKind: item.value.unitKind });
      return createInterval({ lower: zero, upper: quantityFromCanonical("quantization-error", subtractRational(item.value.exactValue, item.value.exactValue), item.value.physicalDimension, { canonicalUnit: item.value.canonicalUnit, unitKind: item.value.unitKind }) });
    });
    const base: Omit<ValueCandidate, "valueCandidateId" | "deterministicDigest"> = { synthesisId: input.synthesisId, exactOrProvisionalValueAssignments: assignment, preferredSeriesMetadata: input.domains.map((item) => `${item.roleId}:${item.series}`), exactPartAssignmentRefs: [], quantizationError, fullRecalculationRunId: evaluation.runId, hardConstraintResults: evaluation.hardConstraintResults, objectiveVector: evaluation.objectiveVector, paretoState: hardPass ? "non_dominated" : "dominated", unresolvedBindings: [...new Set(evaluation.unresolvedBindings)].sort(), lifecycleState: hardPass && !evaluation.unresolvedBindings.length ? "calculation_complete_pending_review" : "calculation_failed" };
    const withId = { ...base, valueCandidateId: calculationId("value-candidate", base) };
    return { ...withId, deterministicDigest: calculationDigest(withId) };
  });
  return candidates.sort((a, b) => {
    const aPass = a.hardConstraintResults.every((item) => item.state === "pass" || item.state === "not_applicable");
    const bPass = b.hardConstraintResults.every((item) => item.state === "pass" || item.state === "not_applicable");
    if (aPass !== bPass) return aPass ? -1 : 1;
    return a.valueCandidateId.localeCompare(b.valueCandidateId);
  });
}

export function rationalObjective(value: RationalValue, objectiveId: string, direction: "minimize" | "maximize" = "minimize"): ValueCandidate["objectiveVector"][number] {
  return { objectiveId, direction, rawValue: value, state: "pass" };
}
