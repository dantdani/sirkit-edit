import { finalizeVerification, uniqueSorted, verificationId } from "./stable";
import type { CircuitVerificationProblem, FullOracleRun, RequirementCoverageRecord, VerificationCurrencyReport } from "./types";

export function compileRequirementCoverage(input: {
  problem: CircuitVerificationProblem;
  records?: Array<Omit<RequirementCoverageRecord, "deterministicDigest">>;
}): RequirementCoverageRecord[] {
  const supplied = new Map((input.records ?? []).map((item) => [item.requirementId, item]));
  return input.problem.requirementRevisionRefs.map((requirement) => {
    const record = supplied.get(requirement.requirementId);
    return finalizeVerification<RequirementCoverageRecord>({
      requirementId: requirement.requirementId,
      implementationState: record?.implementationState ?? "unknown",
      verificationState: record?.verificationState ?? "not_evaluated",
      satisfactionState: record?.satisfactionState ?? "unknown",
      implementationRefs: uniqueSorted(record?.implementationRefs ?? []),
      ruleResultIds: uniqueSorted(record?.ruleResultIds ?? []),
      evidenceRefs: uniqueSorted([requirement.revisionDigest, ...(record?.evidenceRefs ?? [])]),
      deterministicDigest: "",
    });
  }).sort((a, b) => a.requirementId.localeCompare(b.requirementId));
}

export function evaluateVerificationCurrency(input: {
  problem: CircuitVerificationProblem;
  graphDigest?: string;
  registryDigest?: string;
  denominatorDigest?: string;
  fullRun?: FullOracleRun;
}): VerificationCurrencyReport {
  const checkedDigests: VerificationCurrencyReport["checkedDigests"] = [
    { kind: "semantic_graph", expected: input.problem.semanticGraphDigest, actual: input.graphDigest, state: !input.graphDigest ? "missing" : input.graphDigest === input.problem.semanticGraphDigest ? "current" : "stale" },
    { kind: "rule_registry", expected: input.problem.ruleRegistryDigest, actual: input.registryDigest, state: !input.registryDigest ? "missing" : input.registryDigest === input.problem.ruleRegistryDigest ? "current" : "stale" },
    { kind: "full_oracle_graph", expected: input.problem.semanticGraphDigest, actual: input.fullRun?.graphDigest, state: !input.fullRun ? "missing" : input.fullRun.graphDigest === input.problem.semanticGraphDigest ? "current" : "stale" },
    { kind: "full_oracle_registry", expected: input.problem.ruleRegistryDigest, actual: input.fullRun?.registryDigest, state: !input.fullRun ? "missing" : input.fullRun.registryDigest === input.problem.ruleRegistryDigest ? "current" : "stale" },
    { kind: "full_oracle_denominator", expected: input.denominatorDigest ?? "missing", actual: input.fullRun?.denominatorDigest, state: !input.denominatorDigest || !input.fullRun ? "missing" : input.fullRun.denominatorDigest === input.denominatorDigest ? "current" : "stale" },
  ];
  const state = checkedDigests.some((item) => item.state === "stale") ? "stale" as const : checkedDigests.some((item) => item.state === "missing") ? "unknown" as const : "current" as const;
  return finalizeVerification<VerificationCurrencyReport>({ currencyId: verificationId("verification-currency", { state, checkedDigests }), state, checkedDigests, deterministicDigest: "" });
}
