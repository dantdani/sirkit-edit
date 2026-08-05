import { finalizeVerification, uniqueSorted, verificationDigest } from "./stable";
import type { CircuitFinding, VerificationContext, VerificationRuleDefinition, VerificationRuleResult } from "./types";

export function stableFindingIdentity(input: { rule: VerificationRuleDefinition; result: VerificationRuleResult; context: VerificationContext }): string {
  return `finding-${verificationDigest({
    ruleId: input.rule.ruleId,
    ruleRevisionDigest: input.rule.deterministicDigest,
    variantId: input.result.variantId,
    contextKind: input.context.contextKind,
    semanticAnchorIds: uniqueSorted(input.result.targetIds),
    reasonCode: input.result.reasonCode,
  }).slice(4, 52)}`;
}

export function findingFromResult(input: { rule: VerificationRuleDefinition; result: VerificationRuleResult; context: VerificationContext; runId: string; previous?: CircuitFinding }): CircuitFinding | undefined {
  if (input.result.engineeringResult === "pass" || input.result.engineeringResult === "not_applicable") return undefined;
  const stableIdentity = stableFindingIdentity(input);
  const previous = input.previous?.stableIdentity === stableIdentity ? input.previous : undefined;
  return finalizeVerification<CircuitFinding>({
    findingId: `finding:${stableIdentity}`,
    stableIdentity,
    resultId: input.result.resultId,
    ruleId: input.rule.ruleId,
    ruleDigest: input.rule.deterministicDigest,
    contextId: input.context.contextId,
    variantId: input.result.variantId,
    semanticAnchorIds: uniqueSorted(input.result.targetIds),
    engineeringResult: input.result.engineeringResult,
    severity: input.result.severity,
    workflowState: previous?.workflowState === "waived" ? "reopened" : previous?.workflowState === "acknowledged" ? "acknowledged" : input.result.engineeringResult === "unsupported" ? "pending_external_review" : "open",
    physicalResultPreserved: true,
    summary: input.result.message,
    evidenceRefs: uniqueSorted(input.result.evidenceRefs),
    remediation: uniqueSorted(input.result.remediation),
    firstSeenRunId: previous?.firstSeenRunId ?? input.runId,
    currentRunId: input.runId,
    deterministicDigest: "",
  });
}
