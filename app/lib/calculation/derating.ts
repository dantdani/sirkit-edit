import { compareRational, multiplyRational, rational, validateRational } from "./rational";
import { calculationDigest, calculationId } from "./stable";
import { quantityFromCanonical } from "./units";
import type { EngineeringActor } from "../engineering/types";
import type { DeratedLimitResult, DeratingRule, EngineeringQuantity } from "./types";

export function createDeratingRule(input: Omit<DeratingRule, "ruleId" | "deterministicDigest" | "reviewState" | "reviewerApproval"> & { ruleId?: string; reviewState?: DeratingRule["reviewState"] }): DeratingRule {
  if (validateRational(input.factor).length || compareRational(input.factor, rational(0)) <= 0 || compareRational(input.factor, rational(1)) > 0) throw new Error("CD7_DERATING_FACTOR_INVALID");
  if (!input.evidenceRefs.length || !input.applicabilityConditions.length) throw new Error("CD7_DERATING_SCOPE_OR_EVIDENCE_MISSING");
  const base = structuredClone({ ...input, ruleId: input.ruleId ?? calculationId("derating-rule", input), reviewState: input.reviewState ?? "draft", applicabilityConditions: [...new Set(input.applicabilityConditions)].sort(), environmentEnvelopeIds: [...new Set(input.environmentEnvelopeIds)].sort(), evidenceRefs: [...new Set(input.evidenceRefs)].sort() });
  return { ...base, deterministicDigest: calculationDigest(base) };
}

export function approveDeratingRule(ruleInput: DeratingRule, actor: EngineeringActor, qualification: string, scope: string, approvedAt: string): DeratingRule {
  if (actor.actorKind !== "human" || !["reviewer", "project_admin"].includes(actor.role) || !qualification.trim() || !scope.trim() || !Number.isFinite(Date.parse(approvedAt))) throw new Error("CD7_DERATING_APPROVAL_UNAUTHORIZED");
  const rule = structuredClone(ruleInput); rule.reviewState = "approved"; rule.reviewerApproval = { reviewer: structuredClone(actor), qualification: qualification.trim(), approvedAt, scope: scope.trim() }; rule.deterministicDigest = calculationDigest({ ...rule, deterministicDigest: undefined }); return rule;
}

export function applyDeratingRule(input: { rule: DeratingRule; originalLimit: EngineeringQuantity; componentCategory: string; stressKind: DeratingRule["stressKind"]; activeConditions: string[]; environmentEnvelopeId: string }): DeratedLimitResult {
  const diagnostics: string[] = [];
  if (input.rule.reviewState !== "approved" || !input.rule.reviewerApproval) diagnostics.push("CD7_DERATING_RULE_NOT_APPROVED");
  if (input.rule.componentCategory !== input.componentCategory || input.rule.stressKind !== input.stressKind) diagnostics.push("CD7_DERATING_SCOPE_MISMATCH");
  if (!input.rule.environmentEnvelopeIds.includes(input.environmentEnvelopeId)) diagnostics.push("CD7_DERATING_ENVIRONMENT_NOT_APPLICABLE");
  if (input.rule.applicabilityConditions.some((condition) => !input.activeConditions.includes(condition))) diagnostics.push("CD7_DERATING_CONDITION_NOT_PROVEN");
  const deratedLimit = diagnostics.length ? input.originalLimit : quantityFromCanonical(`derated-${input.originalLimit.semanticKind}`, multiplyRational(input.originalLimit.exactValue, input.rule.factor), input.originalLimit.physicalDimension, { canonicalUnit: input.originalLimit.canonicalUnit, unitKind: input.originalLimit.unitKind, evidenceRef: input.rule.evidenceRefs.join(",") });
  const base: Omit<DeratedLimitResult, "resultId" | "deterministicDigest"> = { ruleRevisionId: `${input.rule.ruleId}:${input.rule.revision}`, originalLimit: structuredClone(input.originalLimit), deratedLimit, applicabilityConditions: [...new Set(input.activeConditions)].sort(), state: diagnostics.length ? "unknown" : "pass", diagnostics };
  const withId = { ...base, resultId: calculationId("derated-limit", base) }; return { ...withId, deterministicDigest: calculationDigest(withId) };
}
