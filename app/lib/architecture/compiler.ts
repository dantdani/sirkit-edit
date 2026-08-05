import { getArchitecturePattern } from "./patterns";
import { architectureDigest, architectureId } from "./stable";
import type {
  ArchitectureBlock,
  ArchitectureCandidateProposal,
  ArchitectureCompileInput,
  ArchitectureCompileResult,
  ArchitectureCoverageRow,
  ArchitectureDownstreamObligation,
  ArchitectureFeasibilityCheck,
  ArchitectureObjectiveMetric,
  ArchitectureProblem,
  SystemArchitectureCandidate,
} from "./types";
import { ARCHITECTURE_COMPILER_VERSION, ARCHITECTURE_PATTERN_REGISTRY_VERSION, ARCHITECTURE_SCHEMA_VERSION } from "./types";
import { validateArchitectureProposal } from "./validation";
import { validateArchitectureProblem } from "./problem";

function idMap(problem: ArchitectureProblem, proposal: ArchitectureCandidateProposal, kind: string, items: Array<{ localId: string; role?: string }>): Map<string, string> {
  return new Map(items.map((item) => [item.localId, architectureId(kind, { problem: problem.deterministicDigest, lineage: proposal.lineageId, localId: item.localId, role: item.role ?? "" })]));
}

function coverage(problem: ArchitectureProblem, rootBlockId: string, candidate: {
  blocks: SystemArchitectureCandidate["blocks"]; ports: SystemArchitectureCandidate["ports"]; flows: SystemArchitectureCandidate["flows"];
  modes: SystemArchitectureCandidate["modes"]; transitions: SystemArchitectureCandidate["transitions"]; domains: SystemArchitectureCandidate["domains"];
  boundaries: SystemArchitectureCandidate["boundaries"]; responsibilities: SystemArchitectureCandidate["responsibilities"];
  resources: SystemArchitectureCandidate["resources"]; downstreamObligations: ArchitectureDownstreamObligation[];
}): ArchitectureCoverageRow[] {
  const artifacts: Array<{ id: string; refs: string[]; direct: boolean }> = [
    ...candidate.blocks.map((item) => ({ id: item.blockId, refs: item.requirementRefs, direct: item.blockId !== rootBlockId })),
    ...candidate.ports.map((item) => ({ id: item.portId, refs: item.requirementRefs, direct: true })),
    ...candidate.flows.map((item) => ({ id: item.flowId, refs: item.requirementRefs, direct: true })),
    ...candidate.modes.map((item) => ({ id: item.modeId, refs: item.requirementRefs, direct: true })),
    ...candidate.transitions.map((item) => ({ id: item.transitionId, refs: item.requirementRefs, direct: true })),
    ...candidate.domains.map((item) => ({ id: item.domainId, refs: item.requirementRefs, direct: true })),
    ...candidate.boundaries.map((item) => ({ id: item.boundaryId, refs: item.requirementRefs, direct: true })),
    ...candidate.responsibilities.map((item) => ({ id: item.responsibilityId, refs: item.requirementRefs, direct: true })),
    ...candidate.resources.map((item) => ({ id: item.resourceId, refs: item.requirementRefs, direct: true })),
  ];
  return problem.requirements.map((requirement) => {
    const direct = artifacts.filter((item) => item.direct && item.refs.includes(requirement.requirementId)).map((item) => item.id).sort();
    const rootOnly = artifacts.filter((item) => !item.direct && item.refs.includes(requirement.requirementId)).map((item) => item.id).sort();
    const delegated = candidate.downstreamObligations.filter((item) => item.requirementRefs.includes(requirement.requirementId)).map((item) => item.obligationId).sort();
    const external = requirement.capabilityAssessment.state === "external_review_required";
    let state: ArchitectureCoverageRow["state"] = "uncovered"; let explanation = "No non-root architecture artifact allocates this requirement.";
    if (requirement.capabilityAssessment.state === "unsupported") { state = "unsupported"; explanation = "The pinned CD-1 capability assessment marks this requirement unsupported."; }
    else if (direct.length && delegated.length) { state = "decomposed"; explanation = "The requirement is allocated to architecture artifacts and explicit downstream obligations."; }
    else if (direct.length) { state = "direct"; explanation = "The requirement is allocated to one or more non-root architecture artifacts."; }
    else if (external) { state = "external"; explanation = "The requirement is explicitly owned by an external review authority."; }
    else if (delegated.length) { state = "delegated"; explanation = "The architecture records an explicit downstream obligation."; }
    else if (rootOnly.length) explanation = "A root-only reference is not accepted as architecture decomposition coverage.";
    return { requirementId: requirement.requirementId, requirementRevision: requirement.revision, strength: requirement.strength, state, artifactRefs: [...direct, ...delegated], explanation, verificationObligationRefs: [...requirement.verificationObligationRefs] };
  }).sort((left, right) => left.requirementId.localeCompare(right.requirementId));
}

function downstream(problem: ArchitectureProblem, proposal: ArchitectureCandidateProposal, maps: { block: Map<string, string>; port: Map<string, string>; flow: Map<string, string>; boundary: Map<string, string> }): ArchitectureDownstreamObligation[] {
  const output: ArchitectureDownstreamObligation[] = [];
  for (const flow of proposal.flows) {
    const targetStage = ["power", "energy", "thermal"].includes(flow.flowKind) ? "CD-3" as const : ["data", "control", "clock", "reset", "debug", "analog"].includes(flow.flowKind) ? "CD-4" as const : null;
    if (!targetStage) continue;
    const refs = [maps.flow.get(flow.localId)!, maps.port.get(flow.producerPortLocalId)!, ...flow.consumerPortLocalIds.map((id) => maps.port.get(id)!)].sort();
    output.push({ obligationId: architectureId("downstream-obligation", { problem: problem.deterministicDigest, candidate: proposal.lineageId, stage: targetStage, flow: flow.localId }), targetStage, kind: `${flow.flowKind}_contract`, roleRefs: refs, sourceArtifactRefs: [maps.flow.get(flow.localId)!], requirementRefs: [...flow.requirementRefs].sort(), state: "proposed_not_active", description: `${targetStage} must resolve and verify the abstract ${flow.flowKind} contract without changing its requirement allocation.` });
  }
  for (const boundary of proposal.boundaries) output.push({ obligationId: architectureId("downstream-obligation", { problem: problem.deterministicDigest, candidate: proposal.lineageId, stage: "Stage-6", boundary: boundary.localId }), targetStage: "Stage-6", kind: `${boundary.kind}_relationship_constraint`, roleRefs: boundary.domainLocalIds, sourceArtifactRefs: [maps.boundary.get(boundary.localId)!], requirementRefs: [...boundary.requirementRefs].sort(), state: "proposed_not_active", description: "Deferred role/relationship proposal only. Stage-6 must bind it to existing objects and obtain approval before activation." });
  return output.sort((left, right) => left.obligationId.localeCompare(right.obligationId));
}

function feasibility(problem: ArchitectureProblem, candidate: { coverage: ArchitectureCoverageRow[]; resources: SystemArchitectureCandidate["resources"]; architectureQuestions: SystemArchitectureCandidate["architectureQuestions"]; modes: SystemArchitectureCandidate["modes"]; blocks: SystemArchitectureCandidate["blocks"]; ports: SystemArchitectureCandidate["ports"] }): ArchitectureFeasibilityCheck[] {
  const checks: ArchitectureFeasibilityCheck[] = [{ checkId: architectureId("architecture-check", { problem: problem.deterministicDigest, kind: "structure" }), category: "structure", state: "pass", hard: true, explanation: "Strict schema and graph validation passed.", objectRefs: [], requirementRefs: [] }];
  for (const row of candidate.coverage) {
    const hard = row.strength === "hard" || row.strength === "externally_mandated";
    const state = ["uncovered", "contradicted", "unsupported"].includes(row.state) ? "fail" as const : row.state === "unknown" || row.state === "partial" ? "unknown" as const : row.state === "external" ? "external_review_planned" as const : "pass" as const;
    checks.push({ checkId: architectureId("architecture-check", { problem: problem.deterministicDigest, requirement: row.requirementId }), category: "requirements", state, hard, explanation: row.explanation, objectRefs: row.artifactRefs, requirementRefs: [row.requirementId] });
  }
  for (const requirement of problem.requirements) if (["unknown_not_assessed", "exploration_only", "external_review_required"].includes(requirement.capabilityAssessment.state)) checks.push({
    checkId: architectureId("architecture-check", { problem: problem.deterministicDigest, capability: requirement.requirementId }), category: "capability",
    state: requirement.capabilityAssessment.state === "external_review_required" ? "external_review_planned" : "unknown", hard: false,
    explanation: requirement.capabilityAssessment.explanation, objectRefs: [], requirementRefs: [requirement.requirementId],
  });
  for (const budget of problem.budgets) {
    const allocations = candidate.resources.filter((item) => item.requirementRefs.some((ref) => budget.requirementRefs.includes(ref)) && item.allocation !== null);
    checks.push({ checkId: architectureId("architecture-check", { problem: problem.deterministicDigest, budget: budget.budgetId }), category: "resource", state: allocations.length ? "not_evaluated" : "unknown", hard: budget.requirementRefs.some((ref) => ["hard", "externally_mandated"].includes(problem.requirements.find((item) => item.requirementId === ref)?.strength ?? "")), explanation: allocations.length ? "Resource allocation exists, but quantitative roll-up is deferred until a compatible quantity evaluator is selected." : "No allocation exists for the accepted architecture budget.", objectRefs: allocations.map((item) => item.resourceId), requirementRefs: budget.requirementRefs });
  }
  if (problem.requiredModeVocabulary.length) checks.push({ checkId: architectureId("architecture-check", { problem: problem.deterministicDigest, kind: "safe-state" }), category: "state_machine", state: candidate.modes.some((item) => item.safeState) ? "pass" : "fail", hard: true, explanation: "Required operating modes need an explicit safe state.", objectRefs: candidate.modes.map((item) => item.modeId), requirementRefs: [] });
  for (const interaction of problem.externalInteractions) {
    const normalized = interaction.externalRole.toLowerCase().replace(/[^a-z0-9]+/g, "_"); const objects = [...candidate.blocks.filter((item) => item.role.toLowerCase().replace(/[^a-z0-9]+/g, "_") === normalized).map((item) => item.blockId), ...candidate.ports.filter((item) => item.role.toLowerCase().includes(normalized)).map((item) => item.portId)];
    checks.push({ checkId: architectureId("architecture-check", { problem: problem.deterministicDigest, interaction: interaction.interactionId }), category: "external", state: objects.length ? "pass" : "fail", hard: interaction.requirementRefs.some((ref) => ["hard", "externally_mandated"].includes(problem.requirements.find((item) => item.requirementId === ref)?.strength ?? "")), explanation: objects.length ? "The external interaction has an explicit architecture boundary role and contract port." : "The accepted external interaction is absent from the candidate.", objectRefs: objects, requirementRefs: interaction.requirementRefs });
  }
  for (const question of candidate.architectureQuestions) if (question.blocking) checks.push({ checkId: architectureId("architecture-check", { problem: problem.deterministicDigest, question: question.questionId }), category: "requirements", state: "unknown", hard: true, explanation: question.question, objectRefs: [question.questionId], requirementRefs: question.requirementRefs });
  return checks.sort((left, right) => left.checkId.localeCompare(right.checkId));
}

function objectives(candidate: { blocks: ArchitectureBlock[]; flows: SystemArchitectureCandidate["flows"]; boundaries: SystemArchitectureCandidate["boundaries"]; risks: SystemArchitectureCandidate["risks"]; coverage: ArchitectureCoverageRow[]; resources: SystemArchitectureCandidate["resources"] }): ArchitectureObjectiveMetric[] {
  const riskWeights = { low: 1, medium: 3, high: 7, critical: 12 } as const;
  const knownResourceDimensions = new Set(candidate.resources.filter((item) => item.allocation && item.evidenceState !== "unknown").map((item) => item.dimension));
  const metrics: ArchitectureObjectiveMetric[] = [
    { objectiveId: "structural_complexity", label: "Structural complexity", direction: "minimize", rawValue: candidate.blocks.length + candidate.flows.length, range: null, unit: "objects", evidenceState: "pass", method: "block_count + flow_count", confidence: "high", assumptions: [] },
    { objectiveId: "boundary_crossings", label: "Declared boundary crossings", direction: "minimize", rawValue: candidate.boundaries.reduce((sum, item) => sum + item.crossingFlowIds.length, 0), range: null, unit: "crossings", evidenceState: "pass", method: "sum(declared crossing flows)", confidence: "high", assumptions: [] },
    { objectiveId: "risk_burden", label: "Architecture risk burden", direction: "minimize", rawValue: candidate.risks.reduce((sum, item) => sum + riskWeights[item.impact], 0), range: null, unit: "risk-points", evidenceState: "not_evaluated", method: "coarse declared-risk rubric; not probability", confidence: "low", assumptions: ["Declared risks are complete"] },
    { objectiveId: "coverage_gaps", label: "Requirement coverage gaps", direction: "minimize", rawValue: candidate.coverage.filter((item) => ["uncovered", "partial", "unknown", "unsupported", "contradicted"].includes(item.state)).length, range: null, unit: "requirements", evidenceState: "pass", method: "count(non-covered acceptance rows)", confidence: "high", assumptions: [] },
  ];
  for (const dimension of ["power", "energy", "cost", "area"] as const) metrics.push({ objectiveId: `${dimension}_estimate`, label: `${dimension[0].toUpperCase()}${dimension.slice(1)} estimate`, direction: "minimize", rawValue: null, range: null, unit: dimension, evidenceState: knownResourceDimensions.has(dimension) ? "not_evaluated" : "unknown", method: "No hidden numerical proxy; requires typed resource roll-up.", confidence: "low", assumptions: [] });
  return metrics;
}

function structuralSignature(proposal: ArchitectureCandidateProposal): string {
  const blockRole = new Map(proposal.blocks.map((item) => [item.localId, item.role]));
  const port = new Map(proposal.ports.map((item) => [item.localId, item]));
  return architectureDigest({
    blocks: proposal.blocks.map((item) => ({ role: item.role, parentRole: item.parentLocalId ? blockRole.get(item.parentLocalId) : null, owner: item.ownerKind })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    flows: proposal.flows.map((item) => ({ kind: item.flowKind, from: blockRole.get(port.get(item.producerPortLocalId)?.blockLocalId ?? ""), to: item.consumerPortLocalIds.map((id) => blockRole.get(port.get(id)?.blockLocalId ?? "")).sort(), dependency: item.dependencyClass })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    patterns: [...proposal.patternRefs].sort(), domains: proposal.domains.map((item) => item.kind).sort(), boundaries: proposal.boundaries.map((item) => item.kind).sort(), responsibilities: proposal.responsibilities.map((item) => `${item.role}:${item.ownerKind}`).sort(),
  });
}

export function compileArchitectureCandidate(input: ArchitectureCompileInput): ArchitectureCompileResult {
  const diagnostics = validateArchitectureProposal(input.proposal, input.problem);
  for (const code of validateArchitectureProblem(input.problem)) diagnostics.push({ diagnosticId: architectureId("architecture-diagnostic", { code }), code, severity: "blocking", message: "The authoritative architecture problem failed integrity validation.", objectRefs: [input.problem.problemId], requirementRefs: [], nextActions: ["Recompile from the accepted CD-1 package"] });
  for (const ref of input.proposal.patternRefs) if (!getArchitecturePattern(ref)) diagnostics.push({ diagnosticId: architectureId("architecture-diagnostic", { code: "PATTERN_NOT_PINNED", ref }), code: "PATTERN_NOT_PINNED", severity: "error", message: `Pattern '${ref}' is not in the pinned registry.`, objectRefs: [ref], requirementRefs: [], nextActions: ["Use a versioned pattern from the Sirkit architecture registry"] });
  if (diagnostics.some((item) => item.severity === "error" || item.severity === "blocking")) return { ok: false, diagnostics: diagnostics.sort((left, right) => left.code.localeCompare(right.code)) };
  const p = input.proposal; const problem = input.problem;
  const maps = {
    block: idMap(problem, p, "architecture-block", p.blocks), port: idMap(problem, p, "architecture-port", p.ports), flow: idMap(problem, p, "architecture-flow", p.flows),
    mode: idMap(problem, p, "architecture-mode", p.modes), transition: idMap(problem, p, "architecture-transition", p.transitions), domain: idMap(problem, p, "architecture-domain", p.domains),
    boundary: idMap(problem, p, "architecture-boundary", p.boundaries), responsibility: idMap(problem, p, "architecture-responsibility", p.responsibilities), resource: idMap(problem, p, "architecture-resource", p.resources), risk: idMap(problem, p, "architecture-risk", p.risks), question: idMap(problem, p, "architecture-question", p.architectureQuestions),
  };
  const blocks = p.blocks.map((item) => ({ blockId: maps.block.get(item.localId)!, parentBlockId: item.parentLocalId ? maps.block.get(item.parentLocalId)! : null, role: item.role, label: item.label, description: item.description, requirementRefs: [...item.requirementRefs].sort(), patternRuleRefs: [...item.patternRuleRefs].sort(), ownerKind: item.ownerKind })).sort((a, b) => a.blockId.localeCompare(b.blockId));
  const ports = p.ports.map((item) => ({ portId: maps.port.get(item.localId)!, blockId: maps.block.get(item.blockLocalId)!, role: item.role, label: item.label, direction: item.direction, flowKind: item.flowKind, required: item.required, requirementRefs: [...item.requirementRefs].sort() })).sort((a, b) => a.portId.localeCompare(b.portId));
  const flows = p.flows.map((item) => ({ flowId: maps.flow.get(item.localId)!, role: item.role, label: item.label, flowKind: item.flowKind, producerPortId: maps.port.get(item.producerPortLocalId)!, consumerPortIds: item.consumerPortLocalIds.map((id) => maps.port.get(id)!).sort(), requirementRefs: [...item.requirementRefs].sort(), modeIds: item.modeLocalIds.map((id) => maps.mode.get(id)!).sort(), dependencyClass: item.dependencyClass })).sort((a, b) => a.flowId.localeCompare(b.flowId));
  const modes = p.modes.map((item) => ({ modeId: maps.mode.get(item.localId)!, label: item.label, description: item.description, initial: item.initial, safeState: item.safeState, terminal: item.terminal, requirementRefs: [...item.requirementRefs].sort() })).sort((a, b) => a.modeId.localeCompare(b.modeId));
  const transitions = p.transitions.map((item) => ({ transitionId: maps.transition.get(item.localId)!, fromModeId: maps.mode.get(item.fromModeLocalId)!, toModeId: maps.mode.get(item.toModeLocalId)!, trigger: item.trigger, guard: item.guard, response: item.response, requirementRefs: [...item.requirementRefs].sort() })).sort((a, b) => a.transitionId.localeCompare(b.transitionId));
  const domains = p.domains.map((item) => ({ domainId: maps.domain.get(item.localId)!, kind: item.kind, label: item.label, blockIds: item.blockLocalIds.map((id) => maps.block.get(id)!).sort(), requirementRefs: [...item.requirementRefs].sort() })).sort((a, b) => a.domainId.localeCompare(b.domainId));
  const boundaries = p.boundaries.map((item) => ({ boundaryId: maps.boundary.get(item.localId)!, kind: item.kind, label: item.label, domainIds: item.domainLocalIds.map((id) => maps.domain.get(id)!).sort(), crossingFlowIds: item.crossingFlowLocalIds.map((id) => maps.flow.get(id)!).sort(), requirementRefs: [...item.requirementRefs].sort() })).sort((a, b) => a.boundaryId.localeCompare(b.boundaryId));
  const responsibilities = p.responsibilities.map((item) => ({ responsibilityId: maps.responsibility.get(item.localId)!, role: item.role, ownerKind: item.ownerKind, blockIds: item.blockLocalIds.map((id) => maps.block.get(id)!).sort(), requirementRefs: [...item.requirementRefs].sort(), verificationObligationRefs: [...item.verificationObligationRefs].sort() })).sort((a, b) => a.responsibilityId.localeCompare(b.responsibilityId));
  const resources = p.resources.map((item) => ({ resourceId: maps.resource.get(item.localId)!, blockId: maps.block.get(item.blockLocalId)!, dimension: item.dimension, allocation: structuredClone(item.allocation), evidenceState: item.evidenceState, rationale: item.rationale, requirementRefs: [...item.requirementRefs].sort() })).sort((a, b) => a.resourceId.localeCompare(b.resourceId));
  const risks = p.risks.map((item) => ({ riskId: maps.risk.get(item.localId)!, category: item.category, description: item.description, likelihood: item.likelihood, impact: item.impact, mitigation: item.mitigation, requirementRefs: [...item.requirementRefs].sort() })).sort((a, b) => a.riskId.localeCompare(b.riskId));
  const architectureQuestions = p.architectureQuestions.map((item) => ({ questionId: maps.question.get(item.localId)!, question: item.question, blocking: item.blocking, requirementRefs: [...item.requirementRefs].sort(), status: "open" as const })).sort((a, b) => a.questionId.localeCompare(b.questionId));
  const downstreamObligations = downstream(problem, p, maps);
  const rootBlockId = blocks.find((item) => item.parentBlockId === null)!.blockId;
  const coverageRows = coverage(problem, rootBlockId, { blocks, ports, flows, modes, transitions, domains, boundaries, responsibilities, resources, downstreamObligations });
  const feasibilityChecks = feasibility(problem, { coverage: coverageRows, resources, architectureQuestions, modes, blocks, ports });
  const objectiveRows = objectives({ blocks, flows, boundaries, risks, coverage: coverageRows, resources });
  const hardFailure = feasibilityChecks.some((item) => item.hard && item.state === "fail");
  const hardUnknown = feasibilityChecks.some((item) => item.hard && ["unknown", "not_evaluated", "unsupported"].includes(item.state));
  const status: SystemArchitectureCandidate["status"] = hardFailure ? "infeasible" : hardUnknown || problem.unresolvedNonBlockingItems.length || feasibilityChecks.some((item) => ["unknown", "not_evaluated", "external_review_planned"].includes(item.state)) ? "feasible_with_unresolved" : "feasible_for_review";
  const proposalDigest = architectureDigest(p);
  const base: Omit<SystemArchitectureCandidate, "deterministicDigest"> = {
    schemaVersion: ARCHITECTURE_SCHEMA_VERSION, candidateId: architectureId("architecture-candidate", { problem: problem.deterministicDigest, lineage: p.lineageId }), projectId: problem.projectId, branchId: problem.branchId, lineageId: p.lineageId, revision: 1,
    title: p.title, summary: p.summary, status, patternRefs: [...p.patternRefs].sort(), blocks, ports, flows, modes, transitions, domains, boundaries, responsibilities, resources, risks, architectureQuestions,
    coverage: coverageRows, feasibility: feasibilityChecks, objectives: objectiveRows, downstreamObligations, assumptions: [...p.assumptions].sort(), diagnostics,
    structuralSignature: structuralSignature(p), provenance: { problemDigest: problem.deterministicDigest, requirementsPackageDigest: problem.requirementsPackageRef.digest, patternRegistryVersion: ARCHITECTURE_PATTERN_REGISTRY_VERSION, compilerVersion: ARCHITECTURE_COMPILER_VERSION, proposalDigest, ...(input.provider ? { provider: input.provider } : {}), ...(input.model ? { model: input.model } : {}), ...(input.promptDigest ? { promptDigest: input.promptDigest } : {}), ...(input.toolSchemaDigest ? { toolSchemaDigest: input.toolSchemaDigest } : {}), createdBy: structuredClone(input.actor), createdAt: input.createdAt },
  };
  return { ok: true, candidate: { ...base, deterministicDigest: architectureDigest({ ...base, deterministicDigest: undefined }) } };
}
