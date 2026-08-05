import type { PcbBoard } from "./types";
import { computeElectricalTruth } from "./electrical-truth";
import { getBoardStackup } from "./stackup";
import { runEngineeringPlacement } from "./placement/engine";
import { boardToDsn, writeDsn } from "./dsn/write-dsn";
import { validateDsn } from "./dsn/preflight";

export type RoutingAiToolName =
  | "getStackup"
  | "analyzeRouteability"
  | "getLayerUsage"
  | "getUnroutedConnections"
  | "prepareAutoroute";

export interface RoutingAiToolRequest {
  name: RoutingAiToolName;
}

/** Deterministic, read-only CAD tools. LLM providers receive these results, never raw mutation access. */
export function runRoutingAiTool(board: PcbBoard, request: RoutingAiToolRequest): unknown {
  switch (request.name) {
    case "getStackup":
      return getBoardStackup(board);
    case "analyzeRouteability":
      {
        const run = runEngineeringPlacement({ board, options: { projectId: "routing-ai", candidateCount: 2, localRefinementPasses: 0 } });
        const candidate = run.candidates.find((item) => item.candidateId === run.selectedCandidateId) ?? run.candidates[0];
        return { problemHash: run.problem.problemHash, constraintProgramHash: run.problem.constraintProgramHash, termination: run.termination, hardReport: candidate?.hardReport, congestion: candidate?.congestion, pinEscape: candidate?.pinEscape, viaPressure: candidate?.viaPressure, objectives: candidate?.objectiveReport, proxyWarning: "Placement evidence is not routing completion or engineering signoff." };
      }
    case "getLayerUsage": {
      const usage = Object.fromEntries(
        getBoardStackup(board).copperLayers.filter((layer) => layer.enabled).map((layer) => [layer.id, {
          tracks: 0,
          trackLengthNm: 0,
          viasTouching: 0,
        }]),
      ) as Record<string, { tracks: number; trackLengthNm: number; viasTouching: number }>;
      for (const track of board.tracks) {
        const layer = usage[track.layer];
        if (!layer) continue;
        layer.tracks += 1;
        layer.trackLengthNm += Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y);
      }
      for (const via of board.vias) {
        if (usage[via.layers[0]]) usage[via.layers[0]].viasTouching += 1;
        if (via.layers[1] !== via.layers[0] && usage[via.layers[1]]) usage[via.layers[1]].viasTouching += 1;
      }
      return usage;
    }
    case "getUnroutedConnections": {
      const electricalTruth = computeElectricalTruth(board);
      return {
        designRevision: electricalTruth.designRevision,
        completion: electricalTruth.realized,
        airwires: electricalTruth.realized.airwires,
        shorts: electricalTruth.shorts,
        orphanCopper: electricalTruth.orphanCopper,
        unresolved: electricalTruth.unresolved,
        incompleteNets: electricalTruth.nets.filter((net) => net.remainingConnections > 0),
      };
    }
    case "prepareAutoroute": {
      const dsn = boardToDsn(board);
      return { validation: validateDsn(board, dsn), dsnText: writeDsn(dsn) };
    }
  }
}

export const ROUTING_AI_TOOL_DESCRIPTIONS: ReadonlyArray<{
  name: RoutingAiToolName;
  description: string;
}> = [
  { name: "getStackup", description: "Read canonical copper layers, roles, directions, plane nets, and autoroute policy." },
  { name: "analyzeRouteability", description: "Inspect Stage 7 physical cutline capacity, pad escape, via pressure, and normalized placement evidence without claiming routing completion." },
  { name: "getLayerUsage", description: "Report existing track length, segment count, and via activity by physical copper layer." },
  { name: "getUnroutedConnections", description: "Return exact pad-level connectivity, remaining airwires, incomplete nets, and shorts." },
  { name: "prepareAutoroute", description: "Generate and preflight the exact multilayer DSN without launching or mutating the board." },
];
