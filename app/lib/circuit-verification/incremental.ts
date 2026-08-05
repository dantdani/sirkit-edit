import { runFullCircuitOracle } from "./oracle";
import { finalizeVerification, uniqueSorted, verificationId } from "./stable";
import type { FullOracleRun, IncrementalImpactReport, IncrementalVerificationInput, OracleParityReport } from "./types";

export function analyzeIncrementalImpact(input: IncrementalVerificationInput): IncrementalImpactReport {
  const changedKinds = new Set(input.diff.addedRemovedChangedObjects.map((item) => item.objectKind));
  const affectedTargetIds = uniqueSorted([
    ...input.diff.addedRemovedChangedObjects.map((item) => item.objectId),
    ...input.diff.connectivityChanges,
    ...input.diff.hierarchyChanges,
    ...input.diff.variantPopulationChanges,
    ...input.diff.valuePartFootprintChanges,
  ]);
  const global = input.diff.conflictIds.length > 0 || input.diff.downstreamInvalidationImpact.length > 0 || changedKinds.has("graph") || changedKinds.has("rail_ground_registry") || input.diff.variantPopulationChanges.length > 0;
  const affectedRuleIds = input.registry.rules.filter((rule) => global || rule.selector.target === "graph" || affectedTargetIds.some((id) => input.denominator.instances.some((instance) => instance.ruleId === rule.ruleId && instance.targetIds.includes(id)))).map((item) => item.ruleId).sort();
  const affectedContextIds = global ? input.contexts.map((item) => item.contextId).sort() : input.denominator.instances.filter((item) => affectedRuleIds.includes(item.ruleId)).map((item) => item.contextId).filter((item, index, all) => all.indexOf(item) === index).sort();
  const reasonCodes = uniqueSorted([...(global ? ["GLOBAL_SEMANTIC_IMPACT"] : []), ...(input.diff.conflictIds.length ? ["UNRESOLVED_DIFF_CONFLICT"] : []), ...(affectedRuleIds.length === 0 ? ["IMPACT_NOT_PROVEN"] : [])]);
  const body = { diffId: input.diff.diffId, affectedRuleIds, affectedContextIds, affectedTargetIds, fullOracleRequired: global || affectedRuleIds.length === 0, reasonCodes };
  return finalizeVerification<IncrementalImpactReport>({ ...body, impactId: verificationId("incremental-impact", body), deterministicDigest: "" });
}

export function runIncrementalCircuitVerification(input: IncrementalVerificationInput): { impact: IncrementalImpactReport; run: FullOracleRun } {
  const impact = analyzeIncrementalImpact(input);
  const instanceIds = input.denominator.instances.filter((item) => impact.affectedRuleIds.includes(item.ruleId) && (impact.affectedContextIds.length === 0 || impact.affectedContextIds.includes(item.contextId))).map((item) => item.instanceId);
  return { impact, run: runFullCircuitOracle(input, { runKind: "incremental_provisional", instanceIds }) };
}

function comparable(run: FullOracleRun): Map<string, string> {
  return new Map(run.results.map((result) => [result.ruleInstanceId, JSON.stringify({ applicability: result.applicability, engineeringResult: result.engineeringResult, severity: result.severity, reasonCode: result.reasonCode, targetIds: result.targetIds })]));
}

export function compareFullAndIncrementalOracle(input: { full: FullOracleRun; incremental: FullOracleRun; expectedInstanceIds?: string[] }): OracleParityReport {
  const full = comparable(input.full), incremental = comparable(input.incremental);
  const scope = new Set(input.expectedInstanceIds ?? [...incremental.keys()]);
  const missingResultIds = [...scope].filter((id) => !incremental.has(id)).sort();
  const extraResultIds = [...incremental.keys()].filter((id) => !scope.has(id) || !full.has(id)).sort();
  const changedResultIds = [...scope].filter((id) => full.has(id) && incremental.has(id) && full.get(id) !== incremental.get(id)).sort();
  const state = input.full.runKind !== "full" || input.incremental.runKind !== "incremental_provisional" ? "not_compared" as const : missingResultIds.length || extraResultIds.length || changedResultIds.length ? "mismatch" as const : "equivalent" as const;
  const body = { fullRunId: input.full.runId, incrementalRunId: input.incremental.runId, state, missingResultIds, extraResultIds, changedResultIds };
  return finalizeVerification<OracleParityReport>({ ...body, parityId: verificationId("oracle-parity", body), deterministicDigest: "" });
}
