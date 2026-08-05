import type { Requirement, RequirementApproval, Assumption, AssumptionRiskClass, RequirementDiagnostic } from "./types";
import { requirementsId } from "./stable";

const RISK_ORDER: Record<AssumptionRiskClass, number> = { low: 0, medium: 1, high: 2, forbidden: 3 };
const HIGH_RISK_DOMAINS = new Set([
  "safety_isolation_compliance",
  "electrical_supply_load",
  "power_energy_battery",
  "environmental",
]);
const FORBIDDEN_CAPABILITY_DEMANDS = new Set(["mains-high-voltage", "life-safety", "implantable", "flight-critical", "intrinsic-safety"]);

export function requiredAssumptionRisk(assumption: Assumption, requirements: readonly Requirement[]): AssumptionRiskClass {
  const affected = requirements.filter((item) => assumption.affectedRequirementIds.includes(item.requirementId));
  if (affected.some((item) => item.capabilityDemandIds.some((id) => FORBIDDEN_CAPABILITY_DEMANDS.has(id)))) return "forbidden";
  if (affected.some((item) => item.criticality === "safety_critical" || HIGH_RISK_DOMAINS.has(item.domain))) return "high";
  if (affected.some((item) => item.criticality === "mission_critical" || item.criticality === "high" || item.strength === "hard" || item.strength === "externally_mandated")) return "medium";
  return "low";
}

export function validateAssumption(assumption: Assumption, requirements: readonly Requirement[], asOf?: string): RequirementDiagnostic[] {
  const diagnostics: RequirementDiagnostic[] = [];
  const add = (code: string, severity: RequirementDiagnostic["severity"], message: string, fields: string[]) => diagnostics.push({
    diagnosticId: requirementsId("reqdiag", { assumption: assumption.assumptionId, revision: assumption.revision, code, fields }),
    code, severity, requirementIds: [...assumption.affectedRequirementIds].sort(), sourceRefs: assumption.sourceRefs,
    message, missingFields: fields, nextActions: ["Review the assumption ledger entry and approval policy"],
  });
  if (!assumption.assumptionId || !Number.isInteger(assumption.revision) || assumption.revision < 1 || !assumption.statement.trim() || !assumption.owner.trim() || !assumption.reasonNeeded.trim()) add("ASSUMPTION_SCHEMA_INVALID", "error", "Assumption identity, revision, exact statement, owner, and reason are required.", ["identity", "statement", "owner", "reasonNeeded"]);
  if (!Number.isFinite(assumption.confidence) || assumption.confidence < 0 || assumption.confidence > 1) add("ASSUMPTION_CONFIDENCE_INVALID", "error", "Assumption confidence must be between 0 and 1.", ["confidence"]);
  const required = requiredAssumptionRisk(assumption, requirements);
  if (RISK_ORDER[assumption.riskClass] < RISK_ORDER[required]) add("ASSUMPTION_RISK_UNDERCLASSIFIED", "blocking", `Assumption is ${assumption.riskClass}, but its affected requirements require at least ${required} risk.`, ["riskClass"]);
  if (required === "forbidden" && assumption.status === "accepted_for_exploration") add("ASSUMPTION_FORBIDDEN", "blocking", "This capability profile forbids using the premise as an assumption.", ["status"]);
  if (assumption.proposedByKind === "ai" && assumption.status === "accepted_for_exploration" && !hasAuthorizedAssumptionApproval(assumption, assumption.approvals, false, asOf)) add("AI_ASSUMPTION_SELF_APPROVAL", "blocking", "AI may propose a hypothesis but cannot accept its own assumption.", ["approvals"]);
  if ((assumption.riskClass === "high" || required === "high") && assumption.status === "accepted_for_exploration" && !hasAuthorizedAssumptionApproval(assumption, assumption.approvals, true, asOf)) add("HIGH_RISK_ASSUMPTION_APPROVAL_REQUIRED", "blocking", "High-risk assumptions need explicit authorized human confirmation.", ["approvals"]);
  if (assumption.status === "accepted_for_exploration" && !assumption.expiryConditionOrDate) add("ASSUMPTION_EXPIRY_REQUIRED", "error", "An active assumption needs an expiry date or invalidation condition.", ["expiryConditionOrDate"]);
  if (assumption.status === "accepted_for_exploration" && asOf && assumption.expiryConditionOrDate && Number.isFinite(Date.parse(assumption.expiryConditionOrDate)) && Date.parse(assumption.expiryConditionOrDate) <= Date.parse(asOf)) add("ASSUMPTION_EXPIRED", "blocking", "The accepted assumption has reached its explicit expiry date and cannot support current design work.", ["expiryConditionOrDate"]);
  return diagnostics;
}

export function hasAuthorizedAssumptionApproval(assumption: Assumption, approvals: readonly RequirementApproval[], highRisk = false, asOf?: string): boolean {
  const relevant = approvals.filter((approval) => approval.scope === "assumption" && approval.targetId === assumption.assumptionId && approval.targetRevision === assumption.revision).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.approvalId.localeCompare(right.approvalId));
  const latest = relevant.at(-1);
  return Boolean(latest && latest.decision === "approved" && latest.actorKind === "human" && (!highRisk || ["project_admin", "authorized_stakeholder", "safety_reviewer"].includes(latest.reviewerRole)) && (!latest.expiresAt || Date.parse(latest.expiresAt) > Date.parse(asOf ?? latest.createdAt)));
}

export function transitionAssumption(input: { assumption: Assumption; action: "accept" | "reject" | "expire" | "invalidate" | "confirm"; approval?: RequirementApproval; reason?: string }): Assumption {
  const next = structuredClone(input.assumption);
  if (input.approval) next.approvals.push(structuredClone(input.approval));
  if (input.action === "accept") {
    if (next.riskClass === "forbidden") throw new Error("ASSUMPTION_FORBIDDEN");
    if (!hasAuthorizedAssumptionApproval(next, next.approvals, next.riskClass === "high", input.approval?.createdAt)) throw new Error("ASSUMPTION_APPROVAL_REQUIRED");
    if (!next.expiryConditionOrDate) throw new Error("ASSUMPTION_EXPIRY_REQUIRED");
    next.status = "accepted_for_exploration";
  } else if (input.action === "reject") next.status = "rejected";
  else if (input.action === "expire") next.status = "expired";
  else if (input.action === "invalidate") next.status = "invalidated";
  else next.status = "confirmed_as_fact_or_requirement";
  next.revision += 1;
  return next;
}

export function invalidationKeysForAssumption(assumption: Assumption): string[] {
  return [...new Set([
    ...assumption.invalidationDependencies,
    ...assumption.affectedRequirementIds.map((id) => `requirement:${id}`),
    ...assumption.affectedDecisionRefs.map((id) => `decision:${id}`),
  ])].sort();
}
