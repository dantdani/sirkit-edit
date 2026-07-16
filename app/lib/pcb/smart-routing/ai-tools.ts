/**
 * Typed AI boundary. An LLM may express intent, rank existing candidate IDs,
 * or inspect facts. It cannot submit coordinates or bypass validation.
 */
import type { SmartRouteCandidate, SmartRouteResult } from "./types";

export interface AiRoutingIntentPatch {
  prefer?: "shorter" | "fewer-bends" | "more-clearance";
  maxCandidates?: number;
  explanation: string;
}
export interface AiCandidateRanking {
  orderedCandidateIds: string[];
  explanation: string;
}

export interface AiRoutingInspection {
  status: SmartRouteResult["status"];
  selectedCandidateId?: string;
  facts: string[];
  limitations: string[];
}

export function applyAiCandidateRanking(
  candidates: readonly SmartRouteCandidate[],
  advice: AiCandidateRanking,
): SmartRouteCandidate[] {
  const legal = candidates.filter((candidate) => candidate.validation.legal);
  const byId = new Map(legal.map((candidate) => [candidate.id, candidate]));
  const ranked: SmartRouteCandidate[] = [];
  for (const id of advice.orderedCandidateIds) {
    const candidate = byId.get(id);
    if (!candidate) continue;
    ranked.push(candidate);
    byId.delete(id);
  }
  ranked.push(...[...byId.values()].sort((a, b) => a.score.total - b.score.total || a.id.localeCompare(b.id)));
  return ranked;
}

export function inspectSmartRoute(result: SmartRouteResult): AiRoutingInspection {
  const selected = result.candidates.find((candidate) => candidate.id === result.selectedCandidateId);
  return {
    status: result.status,
    ...(selected ? { selectedCandidateId: selected.id } : {}),
    facts: [
      `${result.candidates.length} independently validated candidate(s).`,
      selected ? `Selected ${selected.mode} route with ${Math.max(0, selected.points.length - 2)} bend(s).` : "No candidate selected.",
      `${result.diagnostics.consideredObstacleIds.length} nearby obstacle(s) considered.`,
    ],
    limitations: [
      "MVP is single-ended and single-layer.",
      "Existing copper is never shoved in this phase.",
      "AI does not generate or approve geometry.",
    ],
  };
}
