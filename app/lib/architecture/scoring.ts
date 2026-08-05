import { architectureDigest, architectureId } from "./stable";
import type { ArchitectureComparison, ArchitectureDecisionProfile, ArchitectureObjectiveMetric, SystemArchitectureCandidate } from "./types";
import { ARCHITECTURE_SCORING_VERSION } from "./types";

export function createArchitectureDecisionProfile(input: Omit<ArchitectureDecisionProfile, "deterministicDigest">): ArchitectureDecisionProfile {
  if (!input.profileId.trim() || !input.version.trim()) throw new Error("DECISION_PROFILE_IDENTITY_REQUIRED");
  if (Object.values(input.weights).some((value) => !Number.isFinite(value) || value < 0)) throw new Error("DECISION_PROFILE_WEIGHT_INVALID");
  const base = structuredClone(input); return { ...base, deterministicDigest: architectureDigest(base) };
}

function feasible(candidate: SystemArchitectureCandidate): boolean { return candidate.status === "feasible_for_review" || candidate.status === "feasible_with_unresolved"; }

function metricMap(candidate: SystemArchitectureCandidate): Map<string, ArchitectureObjectiveMetric> { return new Map(candidate.objectives.map((item) => [item.objectiveId, item])); }

function dominates(left: SystemArchitectureCandidate, right: SystemArchitectureCandidate, objectiveIds: string[]): boolean {
  const a = metricMap(left); const b = metricMap(right); let strictlyBetter = false;
  for (const id of objectiveIds) {
    const av = a.get(id); const bv = b.get(id);
    if (!av || !bv || av.rawValue === null || bv.rawValue === null || av.evidenceState === "unknown" || bv.evidenceState === "unknown") continue;
    const sign = av.direction === "minimize" ? 1 : -1; const delta = (av.rawValue - bv.rawValue) * sign;
    if (delta > 0) return false; if (delta < 0) strictlyBetter = true;
  }
  return strictlyBetter;
}

export function compareArchitectureCandidates(candidates: readonly SystemArchitectureCandidate[], profile?: ArchitectureDecisionProfile): ArchitectureComparison {
  if (candidates.length < 2) throw new Error("AT_LEAST_TWO_CANDIDATES_REQUIRED");
  const problemDigests = new Set(candidates.map((item) => item.provenance.problemDigest)); if (problemDigests.size !== 1) throw new Error("CANDIDATE_PROBLEM_REVISION_MISMATCH");
  const signatures = new Set(candidates.map((item) => item.structuralSignature)); if (signatures.size !== candidates.length) throw new Error("ISOMORPHIC_ARCHITECTURE_ALTERNATIVE");
  const feasibleCandidates = candidates.filter(feasible);
  const objectiveIds = [...new Set(candidates.flatMap((item) => item.objectives.map((metric) => metric.objectiveId)))].sort();
  const usableIds = objectiveIds.filter((id) => feasibleCandidates.every((candidate) => metricMap(candidate).get(id)?.rawValue !== null));
  const dominanceEdges: ArchitectureComparison["dominanceEdges"] = [];
  for (const left of feasibleCandidates) for (const right of feasibleCandidates) if (left.candidateId !== right.candidateId && dominates(left, right, usableIds)) dominanceEdges.push({ dominatorCandidateId: left.candidateId, dominatedCandidateId: right.candidateId });
  const ranges = new Map<string, { min: number; max: number }>();
  for (const id of usableIds) { const values = feasibleCandidates.map((item) => metricMap(item).get(id)!.rawValue!); ranges.set(id, { min: Math.min(...values), max: Math.max(...values) }); }
  const rows = candidates.map((candidate) => {
    const normalizedObjectives: Record<string, number | null> = {};
    for (const id of objectiveIds) { const metric = metricMap(candidate).get(id); const range = ranges.get(id); if (!metric || metric.rawValue === null || !range) normalizedObjectives[id] = null; else if (range.max === range.min) normalizedObjectives[id] = 1; else normalizedObjectives[id] = metric.direction === "minimize" ? (range.max - metric.rawValue) / (range.max - range.min) : (metric.rawValue - range.min) / (range.max - range.min); }
    const weights = profile?.weights ?? {}; const weighted = Object.entries(normalizedObjectives).filter((entry): entry is [string, number] => entry[1] !== null && (weights[entry[0]] ?? 0) > 0);
    const denominator = weighted.reduce((sum, [id]) => sum + (weights[id] ?? 0), 0);
    return { candidateId: candidate.candidateId, feasible: feasible(candidate), paretoRank: feasible(candidate) ? dominanceEdges.filter((item) => item.dominatedCandidateId === candidate.candidateId).length + 1 : null, weightedScore: feasible(candidate) && denominator > 0 ? weighted.reduce((sum, [id, value]) => sum + value * weights[id], 0) / denominator : null, normalizedObjectives, uncertaintyCount: candidate.feasibility.filter((item) => ["unknown", "not_evaluated", "stale", "external_review_planned"].includes(item.state)).length + candidate.objectives.filter((item) => item.rawValue === null).length, hardFailureCount: candidate.feasibility.filter((item) => item.hard && item.state === "fail").length };
  }).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const base = { comparisonId: architectureId("architecture-comparison", { problem: [...problemDigests][0], candidates: candidates.map((item) => item.deterministicDigest).sort(), profile: profile?.deterministicDigest ?? null, engine: ARCHITECTURE_SCORING_VERSION }), problemDigest: [...problemDigests][0], candidateDigests: candidates.map((item) => item.deterministicDigest).sort(), decisionProfileRef: profile ? `${profile.profileId}@${profile.version}` : null, rows, dominanceEdges: dominanceEdges.sort((a, b) => `${a.dominatorCandidateId}:${a.dominatedCandidateId}`.localeCompare(`${b.dominatorCandidateId}:${b.dominatedCandidateId}`)), sensitivity: objectiveIds.map((objectiveId) => ({ objectiveId, excluded: !usableIds.includes(objectiveId), explanation: usableIds.includes(objectiveId) ? "Included using raw comparable values." : "Excluded because at least one feasible candidate has unknown data; missing data receives no favorable score." })) };
  return { ...base, deterministicDigest: architectureDigest(base) };
}
