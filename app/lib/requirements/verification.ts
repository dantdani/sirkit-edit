import type { Requirement, VerificationMethod, VerificationObligation, RequirementsCoverageReport, AcceptanceMatrixRow, ConstraintPatchProposal } from "./types";
import { requirementsDigest, requirementsId } from "./stable";

function methodFor(requirement: Requirement): { method: VerificationMethod; stage: string; inputs: string[]; tool?: string } {
  if (requirement.typedPredicate.form === "external_evidence" || requirement.kind === "external_approval_certification" || requirement.capabilityAssessment.state === "external_review_required") return { method: "external_laboratory_certification", stage: "External authorized laboratory/certification body", inputs: ["pinned standard/version/scope", "product classification", "external test plan"] };
  if (requirement.typedPredicate.form === "qualitative_rubric") return { method: "human_expert_review", stage: requirement.typedPredicate.authorizedReviewerRole, inputs: [requirement.typedPredicate.rubricId] };
  if (requirement.domain === "pcb_placement_routing_stackup") return { method: "pcb_drc_connectivity", stage: "PCB Stage 3/6/7/8/10", inputs: ["exact PCB revision", "compiled constraint program", "manufacturing profile"], tool: "pcb-readiness-and-constraint-checkers" };
  if (requirement.domain === "manufacturing_assembly") return { method: "supplier_manufacturer_evidence", stage: "CD-12 and manufacturer", inputs: ["released manufacturing package", "manufacturer capability evidence"] };
  if (["electrical_supply_load", "power_energy_battery", "analog_performance", "timing_latency_bandwidth", "environmental"].includes(requirement.domain)) return { method: requirement.domain === "analog_performance" ? "simulation" : "deterministic_analysis", stage: requirement.domain === "power_energy_battery" ? "CD-3/CD-7/CD-10" : "CD-7/CD-10", inputs: ["architecture revision", "component facts", "operating conditions", "corner policy"], tool: requirement.domain === "analog_performance" ? "validated-simulation-model" : "deterministic-corner-analysis" };
  if (requirement.domain === "digital_interface_protocol" || requirement.domain === "clock_reset_boot_debug_firmware") return { method: "erc_application_rule", stage: "CD-4/CD-8/CD-9/CD-11", inputs: ["interface plan", "schematic revision", "firmware/test plan"], tool: "application-rule-checker" };
  if (requirement.domain === "component_sourcing_cost_volume") return { method: "supplier_manufacturer_evidence", stage: "CD-6/CD-12", inputs: ["BOM snapshot", "quantity break", "region/currency", "freshness timestamp"] };
  if (requirement.domain === "security_privacy") return { method: "human_expert_review", stage: "Authorized security reviewer", inputs: ["threat model", "implementation evidence", "review rubric"] };
  return { method: requirement.kind === "process_evidence_obligation" ? "inspection" : "demonstration", stage: requirement.kind === "process_evidence_obligation" ? "Owning release/process stage" : "CD-9/CD-11", inputs: ["implemented design revision", "test procedure", "operating conditions"] };
}

export function planVerificationObligations(requirements: readonly Requirement[]): VerificationObligation[] {
  return requirements.filter((item) => item.status !== "rejected" && item.status !== "superseded" && ["hard", "target", "externally_mandated"].includes(item.strength)).map((requirement) => {
    const plan = methodFor(requirement);
    return {
      obligationId: requirementsId("verification-obligation", { requirement: requirement.requirementId, revision: requirement.revision, method: plan.method, stage: plan.stage }),
      requirementId: requirement.requirementId,
      requirementRevision: requirement.revision,
      verificationMethod: plan.method,
      responsibleStageOrExternalAuthority: plan.stage,
      requiredInputs: plan.inputs,
      expectedMeasurementOrEvidence: requirement.typedPredicate.form === "qualitative_rubric" ? `Completed rubric ${requirement.typedPredicate.rubricId} by ${requirement.typedPredicate.authorizedReviewerRole}` : requirement.typedPredicate.form === "external_evidence" ? `${requirement.typedPredicate.evidenceType} issued by ${requirement.typedPredicate.authority}` : `Evidence that evaluates the exact typed predicate for ${requirement.requirementId}@${requirement.revision}`,
      passPredicateOrRubric: structuredClone(requirement.typedPredicate),
      operatingConditions: structuredClone(requirement.operatingConditions),
      ...(plan.tool ? { requiredToolCapability: plan.tool } : {}),
      status: "planned" as const,
      evidenceRefs: [],
    };
  }).sort((left, right) => left.obligationId.localeCompare(right.obligationId));
}

export function buildAcceptanceMatrix(requirements: readonly Requirement[], obligations: readonly VerificationObligation[], proposal: ConstraintPatchProposal): RequirementsCoverageReport {
  const rows: AcceptanceMatrixRow[] = requirements.filter((item) => item.status !== "rejected" && item.status !== "superseded").map((requirement) => {
    const linkedObligations = obligations.filter((item) => item.requirementId === requirement.requirementId);
    const proposalItems = proposal.items.filter((item) => item.requirementId === requirement.requirementId);
    const state: AcceptanceMatrixRow["currentEvidenceState"] = requirement.capabilityAssessment.state === "unsupported" ? "unsupported" : requirement.capabilityAssessment.state === "external_review_required" ? "external_evidence_required" : linkedObligations.length ? "planned" : "no_verification_plan";
    return { requirementId: requirement.requirementId, requirementRevision: requirement.revision, sourceIds: requirement.originalSourceRefs.map((item) => `${item.sourceId}@${item.sourceVersion}`).sort(), strength: requirement.strength, criticality: requirement.criticality, assumptionDefaultDependencies: [...requirement.assumptionRefs].sort(), capabilityState: requirement.capabilityAssessment.state, proposedConstraintIds: proposalItems.flatMap((item) => item.constraint ? [item.constraint.id] : []).sort(), verificationObligationIds: linkedObligations.map((item) => item.obligationId).sort(), responsibleStagesOrAuthorities: [...new Set(linkedObligations.map((item) => item.responsibleStageOrExternalAuthority))].sort(), currentEvidenceState: state, blockingImpact: state === "unsupported" && ["hard", "externally_mandated"].includes(requirement.strength) ? "Blocks autonomous progression." : state === "no_verification_plan" && ["hard", "target", "externally_mandated"].includes(requirement.strength) ? "Blocks package acceptance until a plan or explicit unsupported diagnostic exists." : "No CD-1 evidence pass is claimed; downstream proof remains required." };
  }).sort((left, right) => left.requirementId.localeCompare(right.requirementId));
  const states = ["no_verification_plan", "planned", "partially_covered", "fully_planned", "not_run", "pass", "fail", "unknown", "unsupported", "external_evidence_required", "stale"] as const;
  const counts = Object.fromEntries(states.map((state) => [state, rows.filter((row) => row.currentEvidenceState === state).length])) as RequirementsCoverageReport["counts"];
  const hardRequirementIds = rows.filter((item) => item.strength === "hard" || item.strength === "externally_mandated").map((item) => item.requirementId);
  const uncoveredHardRequirementIds = rows.filter((item) => (item.strength === "hard" || item.strength === "externally_mandated") && item.currentEvidenceState === "no_verification_plan").map((item) => item.requirementId);
  const base = { rows, counts, hardRequirementIds, uncoveredHardRequirementIds };
  return { ...base, deterministicDigest: requirementsDigest(base) };
}

