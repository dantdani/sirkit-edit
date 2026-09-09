import type { PcbBoard, Track, Via } from "../types";
import type { CopperItemRef } from "../connectivity-board";
import { runDrc } from "../drc/run-drc";
import type { DrcRules, DrcViolation } from "../drc/types";
import type { SesLayerUsage } from "../dsn/read-ses";
import type { LayerId } from "../layers";
import { computeElectricalTruth, type ElectricalProofState } from "../electrical-truth";
import { getBoardStackup } from "../stackup";
import { viaSpannedLayers } from "../geometry-copper";
import { refillZoneFillsAtomically, zoneFillIsCurrent } from "../zones/fill-lifecycle";

export type AutorouteCompletionStatus = "complete" | "partial" | "unknown";

export interface AutorouteNetVerification {
  netId: number;
  stableNetId: string;
  netName: string;
  electricalState: ElectricalProofState;
  endpointKeys: string[];
  terminalGroupIds: string[];
  padCount: number;
  requiredConnections: number;
  completedConnections: number;
  remainingConnections: number;
  complete: boolean;
  clusters: CopperItemRef[][];
}

export interface AutorouteVerification {
  designRevision: string;
  status: AutorouteCompletionStatus;
  requiredConnections: number;
  completedConnections: number;
  remainingConnections: number;
  routedNets: number;
  totalNets: number;
  shorts: number;
  shortIds: string[];
  drcErrors: number;
  routeBlockingDrcErrors: number;
  perNet: AutorouteNetVerification[];
  remainingAirwires: Array<{ netId: number; from: { x: number; y: number }; to: { x: number; y: number } }>;
  layerUsage: Partial<Record<LayerId, SesLayerUsage>>;
  violations: DrcViolation[];
  unresolvedCodes: string[];
  unresolvedFacts: string[];
}

export function buildAutorouteCandidate(
  board: PcbBoard,
  imported: { tracks: Track[]; vias: Via[] },
): PcbBoard {
  const replacedNetIds = new Set<number>();
  for (const track of imported.tracks) replacedNetIds.add(track.netId);
  for (const via of imported.vias) replacedNetIds.add(via.netId);
  const lockedTrackIds = new Set(board.tracks.filter((track) => track.locked).map((track) => track.id));
  const lockedViaIds = new Set(board.vias.filter((via) => via.locked).map((via) => via.id));
  const candidate: PcbBoard = {
    ...board,
    tracks: [
      ...board.tracks.filter((track) => !replacedNetIds.has(track.netId) || track.locked === true),
      ...imported.tracks.filter((track) => !lockedTrackIds.has(track.id)).map((track) => ({ ...track, start: { ...track.start }, end: { ...track.end } })),
    ],
    vias: [
      ...board.vias.filter((via) => !replacedNetIds.has(via.netId) || via.locked === true),
      ...imported.vias.filter((via) => !lockedViaIds.has(via.id)).map((via) => ({ ...via, at: { ...via.at }, layers: [...via.layers] as [LayerId, LayerId] })),
    ],
  };
  return refillZoneFillsAtomically(candidate);
}

const ROUTE_BLOCKING_DRC = new Set<DrcViolation["kind"]>([
  "short",
  "incompleteNet",
  "unconnected",
  "clearance",
  "minTrackWidth",
  "viaOuterDiameter",
  "viaDrill",
  "annularRing",
  "pthAnnularRing", // [B16-C.4] a plated component hole below the profile ring is unmanufacturable copper, whoever authored it
  "holeToHole",
  "edgeClearance",
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
  const electricalTruth = computeElectricalTruth(candidate);
  const connectivity = electricalTruth.realized.connectivity;
  const drc = runDrc(candidate, rules, { electricalReport: electricalTruth });

  const perNet: AutorouteNetVerification[] = [];
  let requiredConnections = 0;
  let remainingConnections = 0;
  for (const status of electricalTruth.nets) {
    if (status.requiredConnections === 0) continue;
    const connectivityForNet = connectivity.nets.get(status.netId);
    const clusters = connectivityForNet?.clusters ?? [];
    const required = status.requiredConnections;
    const remaining = status.remainingConnections;
    requiredConnections += required;
    remainingConnections += remaining;
    perNet.push({
      netId: status.netId,
      stableNetId: status.stableNetId,
      netName: status.name,
      electricalState: status.state,
      endpointKeys: [...status.endpointKeys],
      terminalGroupIds: [...status.terminalGroupIds],
      padCount: status.physicalPadInstanceIds.length,
      requiredConnections: required,
      completedConnections: status.completedConnections,
      remainingConnections: remaining,
      complete: status.realizationState === "proven" && remaining === 0,
      clusters,
    });
  }

  const violations = drc.violations.filter((violation) => violation.severity === "error");
  const routeBlockingDrcErrors = violations.filter((violation) => ROUTE_BLOCKING_DRC.has(violation.kind)).length;
  const status: AutorouteCompletionStatus = electricalTruth.realized.state === "unknown"
    ? "unknown"
    : remainingConnections === 0 && electricalTruth.shorts.length === 0 && routeBlockingDrcErrors === 0
      ? "complete"
      : "partial";
  const authoritativeLayerUsage: Partial<Record<LayerId, SesLayerUsage>> = { ...layerUsage };
  for (const layer of getBoardStackup(candidate).copperLayers.filter((item) => item.enabled)) {
    const tracks = candidate.tracks.filter((track) => track.layer === layer.id);
    const zones = candidate.zones.filter((zone) => zone.layer === layer.id);
    const currentZones = zones.filter((zone) => zoneFillIsCurrent(candidate, zone));
    authoritativeLayerUsage[layer.id] = {
      segments: tracks.length,
      trackLengthNm: tracks.reduce((sum, track) => sum + Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y), 0),
      viaAccessCount: candidate.vias.filter((via) => viaSpannedLayers(via).includes(layer.id)).length,
      filledAreaNm2: currentZones.flatMap((zone) => zone.fill).reduce((sum, region) => sum + region.areaNm2, 0),
      zoneIds: zones.map((zone) => zone.id).sort(),
      stableNetIds: [...new Set(currentZones.map((zone) => candidate.nets.find((net) => net.id === zone.netId)?.stableId).filter((id): id is string => Boolean(id)))].sort(),
      fillStatuses: zones.map((zone) => zone.fillState?.status ?? "legacy-unproven").sort(),
    };
  }
  return {
    designRevision: electricalTruth.designRevision,
    status,
    requiredConnections,
    completedConnections: Math.max(0, requiredConnections - remainingConnections),
    remainingConnections,
    routedNets: electricalTruth.realized.routedNets,
    totalNets: electricalTruth.realized.totalNets,
    shorts: electricalTruth.shorts.length,
    shortIds: electricalTruth.shorts.map((short) => short.id),
    drcErrors: violations.length,
    routeBlockingDrcErrors,
    perNet,
    remainingAirwires: electricalTruth.realized.airwires,
    layerUsage: authoritativeLayerUsage,
    violations,
    unresolvedCodes: [...new Set(electricalTruth.unresolved.map((item) => item.code))].sort(),
    unresolvedFacts: electricalTruth.unresolved.map((item) =>
      `${item.code}:${item.stableNetId ?? "board"}:${item.objectIds.join(",")}`,
    ).sort(),
  };
}
