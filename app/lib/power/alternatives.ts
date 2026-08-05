import { quantityRangeKey } from "./quantity";
import { powerId } from "./stable";
import type { PowerArchitectureProblem, PowerArchitectureProposal } from "./types";
import { POWER_PROPOSAL_SCHEMA_VERSION } from "./types";

export interface PowerAlternativeSearchSettings { candidateCount: number; maximumRailPartitions: number; maximumTopologyDepth: number; maximumPatternCombinations: number; timeBudgetMs: number; }
export const DEFAULT_POWER_ALTERNATIVE_SEARCH: PowerAlternativeSearchSettings = { candidateCount: 3, maximumRailPartitions: 32, maximumTopologyDepth: 4, maximumPatternCombinations: 16, timeBudgetMs: 2_000 };

function partitions(problem: PowerArchitectureProblem): PowerArchitectureProposal["railPartitions"] {
  const groups = new Map<string, typeof problem.demands>();
  for (const demand of problem.demands) { if (!demand.railRequirement) continue; const key = `${quantityRangeKey(demand.railRequirement)}:${demand.returnRequirement}`; groups.set(key, [...(groups.get(key) ?? []), demand]); }
  return [...groups.entries()].map(([key, demands], index) => ({ localId: `rail_partition_${index}`, semanticRole: demands.length === 1 ? `${demands[0].abstractPinGroupRole}:rail` : `shared_rail_${powerId("role", key).slice(-8)}`, sourceId: problem.sources[0].sourceId, demandIds: demands.map((item) => item.demandId).sort(), returnRole: demands[0].returnRequirement, startupClass: "always_on" as const })).sort((a, b) => a.localId.localeCompare(b.localId));
}

export function synthesizePowerArchitectureProposals(problem: PowerArchitectureProblem, settings: PowerAlternativeSearchSettings = DEFAULT_POWER_ALTERNATIVE_SEARCH): PowerArchitectureProposal[] {
  const basePartitions = partitions(problem); if (!basePartitions.length || basePartitions.length > settings.maximumRailPartitions) return [];
  const variants = [
    { lineageId: "centralized", title: "Centralized power architecture", patternIds: ["central-conversion"], sequenceOwnership: "hardware" as const, protectionStrategy: "centralized" as const, mutate: (items: typeof basePartitions) => items },
    { lineageId: "switched-domains", title: "Switched-domain power architecture", patternIds: ["central-conversion", "always-on-switched-domains"], sequenceOwnership: "mixed" as const, protectionStrategy: "centralized" as const, mutate: (items: typeof basePartitions) => items.map((item, index) => ({ ...item, startupClass: index === 0 ? "always_on" as const : "switched" as const })) },
    { lineageId: "distributed-protection", title: "Distributed protection power architecture", patternIds: ["central-conversion"], sequenceOwnership: "hardware" as const, protectionStrategy: "distributed" as const, mutate: (items: typeof basePartitions) => items.map((item) => ({ ...item, startupClass: item.returnRole === "sensitive_reference_return" ? "sequenced" as const : item.startupClass })) },
  ];
  return variants.slice(0, Math.max(2, Math.min(3, settings.candidateCount))).map((variant) => ({ schemaVersion: POWER_PROPOSAL_SCHEMA_VERSION, proposalId: powerId("power-proposal", { problem: problem.deterministicDigest, lineage: variant.lineageId }), problemDigest: problem.deterministicDigest, lineageId: variant.lineageId, title: variant.title, summary: `${variant.title} derived from pinned source, demand, mode, and return contracts.`, patternIds: variant.patternIds, railPartitions: variant.mutate(structuredClone(basePartitions)), sequenceOwnership: variant.sequenceOwnership, protectionStrategy: variant.protectionStrategy, assumptions: [], questions: [] }));
}
