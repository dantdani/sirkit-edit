import type { PcbBoard, Track, Via } from "../types";
import { computeConnectivity, type CopperItemRef } from "../connectivity-board";
import { runDrc } from "../drc/run-drc";
import type { DrcRules, DrcViolation } from "../drc/types";
import type { SesLayerUsage } from "../dsn/read-ses";
import type { LayerId } from "../layers";

export type AutorouteCompletionStatus = "complete" | "partial";

export interface AutorouteNetVerification {
  netId: number;
  netName: string;
  padCount: number;
  requiredConnections: number;
  completedConnections: number;
  remainingConnections: number;
  complete: boolean;
  clusters: CopperItemRef[][];
}

export interface AutorouteVerification {
  status: AutorouteCompletionStatus;
  requiredConnections: number;
  completedConnections: number;
  remainingConnections: number;
  routedNets: number;
  totalNets: number;
  shorts: number;
  drcErrors: number;
  routeBlockingDrcErrors: number;
  perNet: AutorouteNetVerification[];
  remainingAirwires: Array<{ netId: number; from: { x: number; y: number }; to: { x: number; y: number } }>;
  layerUsage: Partial<Record<LayerId, SesLayerUsage>>;
  violations: DrcViolation[];
}

export function buildAutorouteCandidate(
  board: PcbBoard,
  imported: { tracks: Track[]; vias: Via[] },
): PcbBoard {
  const replacedNetIds = new Set<number>();
  for (const track of imported.tracks) replacedNetIds.add(track.netId);
  for (const via of imported.vias) replacedNetIds.add(via.netId);
  return {
    ...board,
    tracks: [
      ...board.tracks.filter((track) => !replacedNetIds.has(track.netId)),
      ...imported.tracks.map((track) => ({ ...track, start: { ...track.start }, end: { ...track.end } })),
    ],
    vias: [
      ...board.vias.filter((via) => !replacedNetIds.has(via.netId)),
      ...imported.vias.map((via) => ({ ...via, at: { ...via.at }, layers: [...via.layers] as [LayerId, LayerId] })),
    ],
  };
}

const ROUTE_BLOCKING_DRC = new Set<DrcViolation["kind"]>([
  "short",
  "incompleteNet",
  "unconnected",
  "disabledLayer",
  "unsupportedViaSpan",
  "trackOutsideBoard",
  "viaOutsideBoard",
]);

export function verifyAutorouteCandidate(
  candidate: PcbBoard,
  rules: DrcRules,
  layerUsage: Partial<Record<LayerId, SesLayerUsage>> = {},
): AutorouteVerification {
  const connectivity = computeConnectivity(candidate);
  const drc = runDrc(candidate, rules);
  const netName = new Map(candidate.nets.map((net) => [net.id, net.name || `net${net.id}`]));
  const padCount = new Map<number, number>();
  for (const footprint of candidate.footprints) {
    for (const id of Object.values(footprint.padNets)) {
      if (id !== 0) padCount.set(id, (padCount.get(id) ?? 0) + 1);
    }
  }

  const perNet: AutorouteNetVerification[] = [];
  let requiredConnections = 0;
  let remainingConnections = 0;
  for (const [netId, count] of [...padCount].sort(([a], [b]) => a - b)) {
    if (count < 2) continue;
    const connectivityForNet = connectivity.nets.get(netId);
    const clusters = connectivityForNet?.clusters ?? [];
    const padClusters = clusters.filter((cluster) => cluster.some((item) => item.kind === "pad"));
    const required = count - 1;
    const remaining = Math.max(0, padClusters.length - 1);
    requiredConnections += required;
    remainingConnections += remaining;
    perNet.push({
      netId,
      netName: netName.get(netId) ?? `net${netId}`,
      padCount: count,
      requiredConnections: required,
      completedConnections: Math.max(0, required - remaining),
      remainingConnections: remaining,
      complete: remaining === 0,
      clusters,
    });
  }

  const violations = drc.violations.filter((violation) => violation.severity === "error");
  const routeBlockingDrcErrors = violations.filter((violation) => ROUTE_BLOCKING_DRC.has(violation.kind)).length;
  const status: AutorouteCompletionStatus =
    remainingConnections === 0 && connectivity.shorts.length === 0 && routeBlockingDrcErrors === 0
      ? "complete"
      : "partial";
  return {
    status,
    requiredConnections,
    completedConnections: Math.max(0, requiredConnections - remainingConnections),
    remainingConnections,
    routedNets: connectivity.completion.routedNets,
    totalNets: connectivity.completion.totalNets,
    shorts: connectivity.shorts.length,
    drcErrors: violations.length,
    routeBlockingDrcErrors,
    perNet,
    remainingAirwires: connectivity.airwires,
    layerUsage,
    violations,
  };
}
