import type { ConstraintPatchProposal, DesignRequirementsPackage, Requirement, RequirementsSemanticDiff, TraceabilityEdge, TraceabilityGraph, TraceabilityNode, VerificationObligation } from "./types";
import { requirementsDigest } from "./stable";

export function buildTraceabilityGraph(input: { requirements: readonly Requirement[]; assumptions: DesignRequirementsPackage["assumptions"]; defaults: DesignRequirementsPackage["defaultsApplied"]; questions: DesignRequirementsPackage["openQuestions"]; conflicts: DesignRequirementsPackage["conflicts"]; proposal: ConstraintPatchProposal; obligations: readonly VerificationObligation[] }): TraceabilityGraph {
  const nodes: TraceabilityNode[] = [];
  const edges: TraceabilityEdge[] = [];
  const addNode = (node: TraceabilityNode) => { if (!nodes.some((item) => item.id === node.id)) nodes.push(node); };
  for (const requirement of input.requirements) {
    addNode({ id: requirement.requirementId, kind: "requirement", revision: String(requirement.revision), label: requirement.title });
    for (const source of requirement.originalSourceRefs) { const id = `source:${source.sourceId}@${source.sourceVersion}`; addNode({ id, kind: "source", revision: source.sourceVersion, label: source.title }); edges.push({ from: id, to: requirement.requirementId, relation: "derived_from" }); }
    for (const assumptionId of requirement.assumptionRefs) edges.push({ from: requirement.requirementId, to: assumptionId, relation: "depends_on" });
  }
  for (const assumption of input.assumptions) { addNode({ id: assumption.assumptionId, kind: "assumption", revision: String(assumption.revision), label: assumption.statement }); for (const requirementId of assumption.affectedRequirementIds) edges.push({ from: requirementId, to: assumption.assumptionId, relation: "depends_on" }); }
  for (const item of input.defaults) addNode({ id: item.defaultId, kind: "default", label: item.targetField });
  for (const question of input.questions) { addNode({ id: question.questionId, kind: "question", label: question.text }); for (const requirementId of question.relatedRequirementIds) edges.push({ from: question.questionId, to: requirementId, relation: "clarifies" }); }
  for (const conflict of input.conflicts) { addNode({ id: conflict.conflictId, kind: "conflict", label: conflict.explanation }); for (const requirementId of conflict.involvedRequirementIds) edges.push({ from: conflict.conflictId, to: requirementId, relation: "conflicts_with" }); }
  for (const item of input.proposal.items) { addNode({ id: item.proposalItemId, kind: "constraint_proposal", label: item.constraint?.name ?? item.deferredScope?.role ?? "unsupported lowering" }); edges.push({ from: item.requirementId, to: item.proposalItemId, relation: "lowers_to" }); }
  for (const obligation of input.obligations) { addNode({ id: obligation.obligationId, kind: "verification_obligation", revision: String(obligation.requirementRevision), label: `${obligation.verificationMethod}: ${obligation.responsibleStageOrExternalAuthority}` }); edges.push({ from: obligation.requirementId, to: obligation.obligationId, relation: "verified_by" }); }
  nodes.sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  edges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.relation.localeCompare(right.relation));
  return { nodes, edges, deterministicDigest: requirementsDigest({ nodes, edges }) };
}

function changes<T extends { [key: string]: unknown }>(before: T | undefined, after: T | undefined, ignored: string[] = []): string[] {
  if (!before || !after) return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !ignored.includes(key)).sort();
  return keys.filter((key) => requirementsDigest(before[key]) !== requirementsDigest(after[key]));
}

export function diffRequirementsPackages(previous: DesignRequirementsPackage | undefined, next: Omit<DesignRequirementsPackage, "deterministicDigest">, downstream: readonly { artifactId: string; dependencyKeys: string[] }[] = []): RequirementsSemanticDiff {
  const prevSources = new Map((previous?.sourceDocumentRefs ?? []).map((item) => [item.sourceId, item]));
  const nextSources = new Map(next.sourceDocumentRefs.map((item) => [item.sourceId, item]));
  const sourceIds = [...new Set([...prevSources.keys(), ...nextSources.keys()])].sort();
  const sourceChanges = sourceIds.map((sourceId) => ({ sourceId, change: !prevSources.has(sourceId) ? "added" as const : !nextSources.has(sourceId) ? "removed" as const : requirementsDigest(prevSources.get(sourceId)) === requirementsDigest(nextSources.get(sourceId)) ? "unchanged" as const : "updated" as const }));
  const prevReq = new Map((previous?.requirements ?? []).map((item) => [item.requirementId, item])); const nextReq = new Map(next.requirements.map((item) => [item.requirementId, item]));
  const requirementIds = [...new Set([...prevReq.keys(), ...nextReq.keys()])].sort();
  const requirementChanges = requirementIds.map((requirementId) => { const before = prevReq.get(requirementId); const after = nextReq.get(requirementId); const fields = changes(before as unknown as Record<string, unknown> | undefined, after as unknown as Record<string, unknown> | undefined, ["revision", "createdAt", "approvals", "verificationPlanRefs", "derivedConstraintRefs"]); return { requirementId, change: !before ? "added" as const : !after ? "removed" as const : fields.length ? "changed" as const : "unchanged" as const, fields }; });
  const prevAssumptions = new Map((previous?.assumptions ?? []).map((item) => [item.assumptionId, item])); const nextAssumptions = new Map(next.assumptions.map((item) => [item.assumptionId, item]));
  const assumptionChanges = [...new Set([...prevAssumptions.keys(), ...nextAssumptions.keys()])].sort().map((assumptionId) => ({ assumptionId, change: !prevAssumptions.has(assumptionId) ? "added" as const : !nextAssumptions.has(assumptionId) ? "removed" as const : requirementsDigest(prevAssumptions.get(assumptionId)) === requirementsDigest(nextAssumptions.get(assumptionId)) ? "unchanged" as const : "changed" as const }));
  const capabilityChanges = next.requirements.filter((item) => prevReq.get(item.requirementId)?.capabilityAssessment.state !== item.capabilityAssessment.state).map((item) => ({ requirementId: item.requirementId, from: prevReq.get(item.requirementId)?.capabilityAssessment.state, to: item.capabilityAssessment.state }));
  const prevObligations = new Map((previous?.verificationObligations ?? []).map((item) => [item.obligationId, item])); const nextObligations = new Map(next.verificationObligations.map((item) => [item.obligationId, item]));
  const obligationChanges = [...new Set([...prevObligations.keys(), ...nextObligations.keys()])].sort().map((obligationId) => ({ obligationId, change: !prevObligations.has(obligationId) ? "added" as const : !nextObligations.has(obligationId) ? "removed" as const : requirementsDigest(prevObligations.get(obligationId)) === requirementsDigest(nextObligations.get(obligationId)) ? "unchanged" as const : "changed" as const }));
  const changedKeys = new Set([...requirementChanges.filter((item) => item.change !== "unchanged").map((item) => `requirement:${item.requirementId}`), ...assumptionChanges.filter((item) => item.change !== "unchanged").map((item) => `assumption:${item.assumptionId}`)]);
  const invalidatedDownstreamArtifactIds = downstream.filter((artifact) => artifact.dependencyKeys.some((key) => changedKeys.has(key) || key === `requirements-package:${next.packageId}`)).map((item) => item.artifactId).sort();
  const base = { ...(previous ? { fromRevision: previous.revision } : {}), toRevision: next.revision, sourceChanges, requirementChanges, assumptionChanges, capabilityChanges, obligationChanges, invalidatedDownstreamArtifactIds };
  return { ...base, deterministicDigest: requirementsDigest(base) };
}
