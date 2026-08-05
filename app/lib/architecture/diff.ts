import type { SystemArchitectureCandidate } from "./types";

export interface ArchitectureSemanticDiff {
  fromCandidateId: string;
  toCandidateId: string;
  addedRoles: string[];
  removedRoles: string[];
  changedResponsibilityOwners: Array<{ role: string; from: string; to: string }>;
  addedFlowContracts: string[];
  removedFlowContracts: string[];
  coverageChanges: Array<{ requirementId: string; from: string; to: string }>;
  riskChanges: { added: string[]; removed: string[] };
  objectiveChanges: Array<{ objectiveId: string; from: number | null; to: number | null }>;
}

function difference(left: string[], right: string[]): string[] { const set = new Set(right); return [...new Set(left.filter((item) => !set.has(item)))].sort(); }

export function diffArchitectureCandidates(from: SystemArchitectureCandidate, to: SystemArchitectureCandidate): ArchitectureSemanticDiff {
  if (from.provenance.problemDigest !== to.provenance.problemDigest) throw new Error("ARCHITECTURE_DIFF_PROBLEM_MISMATCH");
  const fromOwners = new Map(from.responsibilities.map((item) => [item.role, item.ownerKind])); const toOwners = new Map(to.responsibilities.map((item) => [item.role, item.ownerKind]));
  const fromCoverage = new Map(from.coverage.map((item) => [item.requirementId, item.state])); const toCoverage = new Map(to.coverage.map((item) => [item.requirementId, item.state]));
  const fromObjectives = new Map(from.objectives.map((item) => [item.objectiveId, item.rawValue])); const toObjectives = new Map(to.objectives.map((item) => [item.objectiveId, item.rawValue]));
  const flowKey = (item: SystemArchitectureCandidate["flows"][number]) => `${item.role}:${item.flowKind}`;
  return {
    fromCandidateId: from.candidateId, toCandidateId: to.candidateId,
    addedRoles: difference(to.blocks.map((item) => item.role), from.blocks.map((item) => item.role)), removedRoles: difference(from.blocks.map((item) => item.role), to.blocks.map((item) => item.role)),
    changedResponsibilityOwners: [...new Set([...fromOwners.keys(), ...toOwners.keys()])].filter((role) => fromOwners.has(role) && toOwners.has(role) && fromOwners.get(role) !== toOwners.get(role)).map((role) => ({ role, from: fromOwners.get(role)!, to: toOwners.get(role)! })).sort((a, b) => a.role.localeCompare(b.role)),
    addedFlowContracts: difference(to.flows.map(flowKey), from.flows.map(flowKey)), removedFlowContracts: difference(from.flows.map(flowKey), to.flows.map(flowKey)),
    coverageChanges: [...toCoverage.entries()].filter(([id, state]) => fromCoverage.get(id) !== state).map(([requirementId, state]) => ({ requirementId, from: fromCoverage.get(requirementId) ?? "absent", to: state })).sort((a, b) => a.requirementId.localeCompare(b.requirementId)),
    riskChanges: { added: difference(to.risks.map((item) => item.description), from.risks.map((item) => item.description)), removed: difference(from.risks.map((item) => item.description), to.risks.map((item) => item.description)) },
    objectiveChanges: [...toObjectives.entries()].filter(([id, value]) => fromObjectives.get(id) !== value).map(([objectiveId, value]) => ({ objectiveId, from: fromObjectives.get(objectiveId) ?? null, to: value })).sort((a, b) => a.objectiveId.localeCompare(b.objectiveId)),
  };
}
