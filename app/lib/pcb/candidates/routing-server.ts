/**
 * [B17-F] The server-side ROUTING CANDIDATE producer: the agent's routing
 * proposal runs the same bounded FreeRouting completion the autoroute route
 * runs (`completeAutoroute` over a pass executor) and wraps the result as
 * the shared `sirkit.layout-candidate.v1` routing candidate — the artifact
 * the editor previews as a ghost and the human applies. Nothing here
 * commits copper.
 */
import { completeAutoroute, type AutoroutePassExecutor } from "../autoroute/completion";
import type { DrcRules } from "../drc/types";
import { pcbRevisionId } from "../revision";
import type { PcbBoard } from "../types";
import { produceRoutingCandidate, type LayoutCandidateProducer, type LayoutCandidateRefusal, type RoutingLayoutCandidate } from "./layout-candidate";

export interface RunRoutingCandidateInput {
  board: PcbBoard;
  rules: DrcRules;
  executor: AutoroutePassExecutor;
  producer: LayoutCandidateProducer;
  /** Restrict routing to these nets (a reroute); absent = every incomplete net. */
  netIds?: number[];
  attemptNamespace: string;
  maxCompletionPasses?: number;
  generation?: number;
  clock?: () => string;
}

export async function runRoutingCandidate(input: RunRoutingCandidateInput): Promise<RoutingLayoutCandidate | LayoutCandidateRefusal> {
  const netIds = input.netIds && input.netIds.length > 0 ? [...new Set(input.netIds)].sort((a, b) => a - b) : undefined;
  if (netIds?.some((id) => !input.board.nets.some((net) => net.id === id))) return { ok: false, code: "SCOPE_MISMATCH", message: "netIds contains a net that is not on this board." };
  const completion = await completeAutoroute(input.board, input.rules, input.executor, {
    attemptNamespace: input.attemptNamespace,
    selectedNetIds: netIds,
    maxGlobalPasses: input.maxCompletionPasses,
  });
  const accepted = completion.bestAcceptedAttempt ?? completion.lastAttempt;
  if (completion.acceptedPasses === 0 || completion.engineError) {
    return { ok: false, code: "EMPTY", message: completion.engineError ? `The router did not produce a candidate: ${completion.engineError}` : "The router produced no accepted routing pass." };
  }
  return produceRoutingCandidate({
    board: input.board,
    response: {
      ok: true,
      sourceRevision: pcbRevisionId(input.board),
      candidateRevision: completion.verification.designRevision,
      routeAttemptId: accepted?.routeAttemptId,
      routes: { tracks: completion.candidate.tracks, vias: completion.candidate.vias },
      job: { status: completion.status === "complete" ? "complete" : "partial" },
      completion: { status: completion.status, acceptedPasses: completion.acceptedPasses, passes: completion.passes, failures: completion.failures },
      stats: { elapsedMs: completion.totalElapsedMs },
      engine: { name: "Freerouting" },
    },
    producer: input.producer,
    netIds,
    generation: input.generation,
    clock: input.clock,
  });
}
