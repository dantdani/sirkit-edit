import type { AssumptionRiskClass, Criticality, QuestionPriorityScore, Requirement, RequirementConflict, RequirementDiagnostic, RequirementQuestion } from "./types";
import { requirementsId } from "./stable";

const CRITICALITY_SCORE: Record<Criticality, number> = { safety_critical: 100, mission_critical: 70, high: 50, normal: 25, low: 10 };
const RISK: Record<AssumptionRiskClass, number> = { forbidden: 100, high: 80, medium: 45, low: 15 };

export function scoreClarificationQuestion(input: { criticality: Criticality; risk: AssumptionRiskClass; downstreamCount: number; architectureSensitive: boolean; capabilityImpact: boolean; verificationImpact: boolean; defaultAvailable: boolean; userEffort: number }): QuestionPriorityScore {
  const score: Omit<QuestionPriorityScore, "total"> = {
    safety: input.criticality === "safety_critical" ? 100 : 0,
    feasibility: Math.round(CRITICALITY_SCORE[input.criticality] * 0.8),
    downstreamImpact: Math.min(100, input.downstreamCount * 12),
    architectureSensitivity: input.architectureSensitive ? 75 : 15,
    wrongAssumptionCost: RISK[input.risk],
    capabilityImpact: input.capabilityImpact ? 65 : 0,
    verificationImpact: input.verificationImpact ? 45 : 10,
    defaultAvailability: input.defaultAvailable ? -20 : 20,
    userEffort: -Math.max(0, Math.min(20, input.userEffort)),
  };
  return { ...score, total: Object.values(score).reduce((sum, value) => sum + value, 0) };
}

function riskFor(requirement: Requirement): AssumptionRiskClass {
  if (requirement.criticality === "safety_critical" || requirement.domain === "safety_isolation_compliance") return "forbidden";
  if (["electrical_supply_load", "power_energy_battery", "environmental"].includes(requirement.domain) || requirement.criticality === "mission_critical") return "high";
  return requirement.strength === "hard" || requirement.strength === "externally_mandated" ? "medium" : "low";
}

function questionForDiagnostic(diagnostic: RequirementDiagnostic, requirement: Requirement): RequirementQuestion {
  const risk = riskFor(requirement);
  const missing = diagnostic.missingFields[0] ?? diagnostic.code.toLowerCase().replaceAll("_", " ");
  const answerType = /voltage|current|temperature|time|frequency|size|dimension|tolerance|range|condition/i.test(missing) ? "quantity" as const : "string" as const;
  const score = scoreClarificationQuestion({ criticality: requirement.criticality, risk, downstreamCount: requirement.strength === "hard" ? 6 : 2, architectureSensitive: ["electrical_supply_load", "power_energy_battery", "digital_interface_protocol", "mechanical_enclosure_connector", "safety_isolation_compliance"].includes(requirement.domain), capabilityImpact: diagnostic.code.includes("CAPABILITY") || diagnostic.code.includes("STANDARD"), verificationImpact: requirement.strength !== "informational", defaultAvailable: false, userEffort: 5 });
  return {
    questionId: requirementsId("reqquestion", { requirement: requirement.requirementId, revision: requirement.revision, code: diagnostic.code, missing }),
    text: `Please clarify ${missing} for “${requirement.title}”.`,
    answerSchema: { type: answerType, required: true },
    relatedRequirementIds: [requirement.requirementId], missingFieldOrConflict: diagnostic.code,
    whyItMatters: diagnostic.message,
    downstreamDecisionsAffected: ["CD-2 architecture", "CD-6 component selection", "CD-7 calculation", "verification plan"],
    riskIfUnanswered: risk,
    blockingLevel: risk === "forbidden" || diagnostic.severity === "blocking" ? "before_package_acceptance" : risk === "high" || diagnostic.severity === "error" ? "before_architecture" : requirement.strength === "hard" ? "approved_assumption_allowed" : "open_optimization",
    suggestedOptions: [], priorityScoreBreakdown: score, status: "open",
  };
}

export function generateClarificationQuestions(requirements: readonly Requirement[], diagnostics: readonly RequirementDiagnostic[], conflicts: readonly RequirementConflict[]): RequirementQuestion[] {
  const byId = new Map(requirements.map((item) => [item.requirementId, item]));
  const questions: RequirementQuestion[] = [];
  for (const diagnostic of diagnostics) {
    if (!diagnostic.requirementIds.length || !["warning", "error", "blocking"].includes(diagnostic.severity) || ["SEMANTIC_DUPLICATE", "UNTRUSTED_INSTRUCTION_TEXT"].includes(diagnostic.code)) continue;
    const requirement = byId.get(diagnostic.requirementIds[0]); if (!requirement) continue;
    questions.push(questionForDiagnostic(diagnostic, requirement));
  }
  for (const conflict of conflicts.filter((item) => item.status === "open")) {
    const requirement = byId.get(conflict.involvedRequirementIds[0]); if (!requirement) continue;
    const risk = riskFor(requirement);
    questions.push({ questionId: requirementsId("reqquestion", { conflict: conflict.conflictId }), text: `Which authorized requirement should govern the conflict involving ${conflict.involvedRequirementIds.join(" and ")}, or do their conditions differ?`, answerSchema: { type: "string", required: true }, relatedRequirementIds: conflict.involvedRequirementIds, missingFieldOrConflict: conflict.conflictId, whyItMatters: conflict.explanation, downstreamDecisionsAffected: ["package acceptance", "constraint lowering", "verification planning"], riskIfUnanswered: risk, blockingLevel: conflict.severity === "blocking" ? "before_package_acceptance" : "before_architecture", suggestedOptions: conflict.allowedResolutionActions, priorityScoreBreakdown: scoreClarificationQuestion({ criticality: requirement.criticality, risk, downstreamCount: 8, architectureSensitive: true, capabilityImpact: conflict.conflictKind === "capability_limit", verificationImpact: true, defaultAvailable: false, userEffort: 10 }), status: "open" });
  }
  const unique = new Map(questions.map((item) => [item.questionId, item]));
  return [...unique.values()].sort((left, right) => right.priorityScoreBreakdown.total - left.priorityScoreBreakdown.total || left.questionId.localeCompare(right.questionId));
}
