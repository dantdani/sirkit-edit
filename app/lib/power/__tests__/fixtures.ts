import { compileArchitectureCandidate } from "../../architecture/compiler";
import { synthesizeArchitectureProposals } from "../../architecture/alternatives";
import { compileArchitectureProblem } from "../../architecture/problem";
import { createArchitectureProjectState } from "../../architecture/project";
import { createArchitectureSelectionDecision } from "../../architecture/selection";
import { compileRequirementsPackage } from "../../requirements/compiler";
import { candidate, compileInput, packageApproval, requirementApproval, source } from "../../requirements/__tests__/fixtures";
import type { DesignRequirementsPackage, ExtractionCandidate } from "../../requirements/types";
import { EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1, createUpstreamCompletionSignoff } from "../capability";
import { compilePowerArchitectureCandidate } from "../compiler";
import { synthesizePowerArchitectureProposals } from "../alternatives";
import { compilePowerArchitectureProblem } from "../problem";
import type { PowerArchitectureCandidate, PowerArchitectureProblem, PowerProblemCompileInput } from "../types";

export const ACTOR = { actorId: "owner", actorKind: "human" as const, sessionId: "power-test", role: "project_admin" as const };
export const CREATED_AT = "2026-07-17T12:00:00.000Z";

export function powerRequirementsPackage(): DesignRequirementsPackage {
  const artifact = source({ content: "The regulated power source operates from 5 V and supplies at most 1 A. The control load operates from 5 V and consumes at most 100 mA. Modes are off, active, and fault." });
  const base = (overrides: Partial<ExtractionCandidate>): ExtractionCandidate => candidate(artifact, {
    requestedStatus: "confirmed",
    conditions: [{
      conditionId: "owner-declared-operating-envelope",
      label: "Owner-declared operating envelope",
      value: "The stated source and load limits apply in all declared operating modes.",
      sourceRefs: [candidate(artifact).sourceRef],
    }],
    capabilityDemandIds: ["embedded-low-voltage"],
    ...overrides,
  });
  const candidates = [
    base({ candidateId: "power-source-voltage", lineageKey: "power-source-voltage", title: "Source voltage", candidateStatement: "The regulated power source operates from 5 V.", proposedDomain: "electrical_supply_load", proposedKind: "range", typedPredicate: { form: "range", min: { dimension: "voltage", value: "5", unit: "V" }, max: { dimension: "voltage", value: "5", unit: "V" }, minInclusive: true, maxInclusive: true }, subjectRefsOrRoles: ["regulated_power_source"] }),
    base({ candidateId: "power-source-current", lineageKey: "power-source-current", title: "Source current capacity", candidateStatement: "The source supplies at most 1 A.", proposedDomain: "electrical_supply_load", proposedKind: "maximum", typedPredicate: { form: "maximum", value: { dimension: "current", value: "1", unit: "A" } }, subjectRefsOrRoles: ["regulated_power_source"] }),
    base({ candidateId: "control-load-voltage", lineageKey: "control-load-voltage", title: "Control load voltage", candidateStatement: "The control load operates from 5 V.", proposedDomain: "electrical_supply_load", proposedKind: "range", typedPredicate: { form: "range", min: { dimension: "voltage", value: "5", unit: "V" }, max: { dimension: "voltage", value: "5", unit: "V" }, minInclusive: true, maxInclusive: true }, subjectRefsOrRoles: ["control_role"] }),
    base({ candidateId: "control-load-current", lineageKey: "control-load-current", title: "Control load current", candidateStatement: "The control load consumes at most 100 mA.", proposedDomain: "electrical_supply_load", proposedKind: "maximum", typedPredicate: { form: "maximum", value: { dimension: "current", value: "100", unit: "mA" } }, subjectRefsOrRoles: ["control_role"] }),
    base({ candidateId: "operating-modes", lineageKey: "operating-modes", title: "Operating modes", candidateStatement: "Modes are off, active, and fault.", proposedDomain: "use_case_operating_mode", proposedKind: "sequence_state_transition", typedPredicate: { form: "temporal_sequence", states: ["off", "active", "fault"], relation: "before" }, subjectRefsOrRoles: ["operating_modes"] }),
  ];
  const approvals = [...candidates.map((item) => requirementApproval(artifact.projectId, item.lineageKey)), packageApproval(artifact.projectId)]; const result = compileRequirementsPackage(compileInput(artifact, candidates, { approvals, title: "Power architecture requirements", purpose: "CD-3 fixture" }));
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.code).join(",")); if (result.package.status !== "accepted_for_architecture_exploration") throw new Error(`power package not accepted: ${result.package.status}`); return result.package;
}

export function powerProblemInput(): PowerProblemCompileInput {
  const requirementsPackage = powerRequirementsPackage(); const architectureResult = compileArchitectureProblem({ tenantId: "tenant:test", branchId: "main", requirementsPackage }); if (!architectureResult.ok) throw new Error(architectureResult.diagnostics.map((item) => item.code).join(","));
  const proposal = synthesizeArchitectureProposals(architectureResult.problem)[0]; const compiled = compileArchitectureCandidate({ problem: architectureResult.problem, proposal, actor: ACTOR, createdAt: CREATED_AT }); if (!compiled.ok) throw new Error(compiled.diagnostics.map((item) => item.code).join(","));
  const decision = createArchitectureSelectionDecision({ candidate: compiled.candidate, approver: ACTOR, rationale: "Pinned CD-2 power test architecture.", consideredCandidateIds: [compiled.candidate.candidateId], acceptedRiskIds: compiled.candidate.risks.filter((item) => item.impact === "high" || item.impact === "critical").map((item) => item.riskId), unresolvedQuestionIds: compiled.candidate.architectureQuestions.filter((item) => item.blocking).map((item) => item.questionId), createdAt: CREATED_AT });
  const architectureState = createArchitectureProjectState({ projectId: requirementsPackage.projectId, branchId: "main", problem: architectureResult.problem, candidates: [compiled.candidate], comparisons: [], selection: decision });
  const upstreamSignoff = createUpstreamCompletionSignoff({ cd1Verdict: "CD-1 COMPLETE", cd2Verdict: "CD-2 COMPLETE", requirementsDigest: requirementsPackage.deterministicDigest, architectureProblemDigest: architectureResult.problem.deterministicDigest, architectureCandidateDigest: compiled.candidate.deterministicDigest, architectureDecisionDigest: decision.deterministicDigest, approver: ACTOR, approvedAt: CREATED_AT });
  return { tenantId: "tenant:test", branchId: "main", requirementsPackage, architectureState, upstreamSignoff, capabilityProfile: EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1, policyProfileRevision: "sirkit-power-policy/1", ruleModelRegistryRevision: "sirkit-power-rules/1", actor: ACTOR, createdAt: CREATED_AT };
}

export function powerProblem(): PowerArchitectureProblem { const result = compilePowerArchitectureProblem(powerProblemInput()); if (!result.ok) throw new Error(`${result.verdict}:${result.diagnostics.map((item) => item.code).join(",")}`); return result.problem; }
export function powerCandidate(index = 0, problem = powerProblem()): PowerArchitectureCandidate { const proposal = synthesizePowerArchitectureProposals(problem)[index]; const result = compilePowerArchitectureCandidate({ problem, proposal, profile: EMBEDDED_LOW_VOLTAGE_POWER_PROFILE_V1, actor: ACTOR, createdAt: CREATED_AT }); if (!result.ok) throw new Error(result.diagnostics.map((item) => item.code).join(",")); return result.candidate; }
