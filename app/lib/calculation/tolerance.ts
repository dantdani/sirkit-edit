import { addIntervals, multiplyIntervals, pointInterval } from "./interval";
import { calculationDigest, calculationId } from "./stable";
import type { CalculationVariable, CorrelationModel, EngineeringInterval, ToleranceContribution } from "./types";

export function createCalculationVariable(input: Omit<CalculationVariable, "deterministicDigest">): CalculationVariable {
  if (!input.variableId.trim() || !input.semanticRole.trim()) throw new Error("CD7_VARIABLE_IDENTITY_INCOMPLETE");
  const base = structuredClone({ ...input, modeVariantApplicability: [...new Set(input.modeVariantApplicability)].sort(), correlationGroupIds: [...new Set(input.correlationGroupIds)].sort(), provenanceRefs: [...new Set(input.provenanceRefs)].sort() });
  return { ...base, deterministicDigest: calculationDigest(base) };
}

export function createToleranceContribution(input: Omit<ToleranceContribution, "contributionId" | "deterministicDigest"> & { contributionId?: string }): ToleranceContribution {
  if (!("distributionModelRef" in input.limitsOrDistribution) && !input.evidenceRefs.length) throw new Error("CD7_TOLERANCE_EVIDENCE_MISSING");
  const base = structuredClone({ ...input, contributionId: input.contributionId ?? calculationId("tolerance-contribution", input), evidenceRefs: [...new Set(input.evidenceRefs)].sort() });
  return { ...base, deterministicDigest: calculationDigest(base) };
}

export function createCorrelationModel(input: Omit<CorrelationModel, "correlationModelId" | "deterministicDigest"> & { correlationModelId?: string }): CorrelationModel {
  if (input.memberVariableIds.length < 1) throw new Error("CD7_CORRELATION_MEMBERS_EMPTY");
  if (input.relationshipKind === "covariance_matrix" && input.coefficientMatrix?.length !== input.memberVariableIds.length) throw new Error("CD7_CORRELATION_MATRIX_INVALID");
  const base = structuredClone({ ...input, correlationModelId: input.correlationModelId ?? calculationId("correlation-model", input), memberVariableIds: [...new Set(input.memberVariableIds)].sort() });
  return { ...base, deterministicDigest: calculationDigest(base) };
}

export function guaranteedVariableDomain(variable: CalculationVariable): { state: "guaranteed" | "estimate_only" | "blocked"; interval?: EngineeringInterval; diagnostics: string[] } {
  if (variable.freshnessState !== "current") return { state: "blocked", diagnostics: [`CD7_VARIABLE_${variable.freshnessState.toUpperCase()}`] };
  if (variable.supportState === "unknown" || variable.supportState === "unsupported") return { state: "blocked", diagnostics: [`CD7_VARIABLE_${variable.supportState.toUpperCase()}`] };
  if (variable.guaranteedInterval) return { state: "guaranteed", interval: variable.guaranteedInterval, diagnostics: [] };
  if (variable.characterizedInterval) return { state: "estimate_only", interval: variable.characterizedInterval, diagnostics: ["CD7_CHARACTERIZED_DATA_CANNOT_PROVE_GUARANTEED_LIMIT"] };
  if (variable.nominalValue) return { state: "estimate_only", interval: pointInterval(variable.nominalValue), diagnostics: ["CD7_NOMINAL_VALUE_HAS_NO_TOLERANCE_PROOF"] };
  return { state: "blocked", diagnostics: ["CD7_VARIABLE_DOMAIN_MISSING"] };
}

export function composeWorstCaseTolerance(input: { nominal: EngineeringInterval; contributions: ToleranceContribution[] }): { state: "complete" | "blocked"; interval?: EngineeringInterval; diagnostics: string[] } {
  let result = input.nominal; const diagnostics: string[] = [];
  for (const contribution of input.contributions) {
    if ("distributionModelRef" in contribution.limitsOrDistribution) { diagnostics.push(`CD7_DISTRIBUTION_NOT_A_WORST_CASE_BOUND:${contribution.contributionId}`); continue; }
    try {
      result = contribution.relativeOrAbsolute === "absolute"
        ? addIntervals(result, contribution.limitsOrDistribution)
        : addIntervals(result, multiplyIntervals(input.nominal, contribution.limitsOrDistribution));
    } catch (error) { diagnostics.push(error instanceof Error ? error.message : String(error)); }
  }
  return diagnostics.length ? { state: "blocked", diagnostics: [...new Set(diagnostics)].sort() } : { state: "complete", interval: result, diagnostics: [] };
}

export function statisticalCombinationGate(variableIds: string[], correlationModels: CorrelationModel[]): { allowed: boolean; diagnostics: string[] } {
  const requested = [...new Set(variableIds)].sort();
  const relevant = correlationModels.filter((model) => model.memberVariableIds.some((id) => requested.includes(id)));
  const covered = new Set(relevant.flatMap((model) => model.memberVariableIds.filter((id) => requested.includes(id))));
  const diagnostics: string[] = [];
  for (const id of requested) if (!covered.has(id)) diagnostics.push(`CD7_CORRELATION_UNDECLARED:${id}`);
  for (const model of relevant) if (model.validationState !== "approved" || model.relationshipKind === "unknown") diagnostics.push(`CD7_CORRELATION_NOT_APPROVED:${model.correlationModelId}`);
  return { allowed: diagnostics.length === 0, diagnostics: [...new Set(diagnostics)].sort() };
}
