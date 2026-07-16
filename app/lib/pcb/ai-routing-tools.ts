import type { PcbBoard } from "./types";
import { computeConnectivity } from "./connectivity-board";
import { getBoardStackup } from "./stackup";
import { analyzePlacementRouteability } from "./autoplace/routeability";
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
      return analyzePlacementRouteability(board);
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
      const connectivity = computeConnectivity(board);
      return {
        completion: connectivity.completion,
        airwires: connectivity.airwires,
        shorts: connectivity.shorts,
        incompleteNets: [...connectivity.nets.values()].filter((net) => !net.complete),
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
  { name: "analyzeRouteability", description: "Score placement congestion, pad access, outline fit, airwire crossings, and estimated via demand." },
  { name: "getLayerUsage", description: "Report existing track length, segment count, and via activity by physical copper layer." },
  { name: "getUnroutedConnections", description: "Return exact pad-level connectivity, remaining airwires, incomplete nets, and shorts." },
  { name: "prepareAutoroute", description: "Generate and preflight the exact multilayer DSN without launching or mutating the board." },
];
