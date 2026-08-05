import { markZoneFillDirty } from "../zones/fill-lifecycle";
import { pcbRevisionId } from "../revision";
import type { PcbBoard, Track, Via, Zone } from "../types";
import { validatePlacementCandidate } from "./validator";
import { placementSemanticHash, placementStableId } from "./stable";
import type { PlacementCandidate, PlacementProblem, PlacementTransform } from "./types";

export interface PlacementApplyTransaction {
  schemaVersion: 1;
  id: string;
  candidateId: string;
  candidateHash: string;
  problemHash: string;
  constraintProgramHash: string;
  beforeRevision: string;
  afterRevision: string;
  before: Record<string, PlacementTransform>;
  after: Record<string, PlacementTransform>;
  removedTracks: Track[];
  removedVias: Via[];
  removedZones: Zone[];
  zoneSnapshotsBefore: Zone[];
  actorId: string;
}

export type PlacementApplyResult =
  | { ok: true; board: PcbBoard; transaction: PlacementApplyTransaction }
  | { ok: false; code: "INVALID_CANDIDATE" | "STALE_BOARD" | "STALE_PROGRAM" | "PROTECTED_COPPER" | "POST_VALIDATION_FAILED"; message: string };

function candidateSemantic(candidate: PlacementCandidate): unknown {
  return {
    schemaVersion: candidate.schemaVersion,
    problemHash: candidate.problemHash,
    sourceBoardRevision: candidate.sourceBoardRevision,
    constraintProgramHash: candidate.constraintProgramHash,
    algorithmVersion: candidate.algorithmVersion,
    metricVersion: candidate.metricVersion,
    seed: candidate.seed,
    initializer: candidate.initializer,
    placements: candidate.placements,
    moves: candidate.moves,
    copperPlan: candidate.copperPlan,
    hardReport: candidate.hardReport,
    congestion: candidate.congestion,
    pinEscape: candidate.pinEscape,
    viaPressure: candidate.viaPressure,
    objectiveReport: candidate.objectiveReport,
    legacyDiagnostics: candidate.legacyDiagnostics,
    warnings: candidate.warnings,
  };
}

export function placementCandidateIntegrityErrors(candidate: PlacementCandidate): string[] {
  const errors: string[] = [];
  if (placementSemanticHash(candidateSemantic(candidate)) !== candidate.candidateHash) errors.push("candidate semantic hash mismatch");
  if (candidate.candidateId !== `placement-candidate:${candidate.candidateHash.slice(3)}`) errors.push("candidate ID/hash mismatch");
  if (!candidate.hardReport.legal) errors.push("candidate hard report is not legal");
  return errors;
}

function generated(track: Track | Via): boolean {
  return !track.locked && (track.source === "ai" || track.source === "autorouter");
}

export function mutateBoardWithPlacementCandidate(board: PcbBoard, candidate: PlacementCandidate): void {
  for (const footprint of board.footprints) {
    const placement = candidate.placements[footprint.id];
    if (!placement) continue;
    footprint.at = { ...placement.position };
    footprint.rotationDeg = placement.rotationDeg;
    footprint.side = placement.side;
  }
  const removeTracks = new Set(candidate.copperPlan.removeTrackIds);
  const removeVias = new Set(candidate.copperPlan.removeViaIds);
  const removeZones = new Set(candidate.copperPlan.removeZoneIds);
  board.tracks = board.tracks.filter((track) => !removeTracks.has(track.id));
  board.vias = board.vias.filter((via) => !removeVias.has(via.id));
  board.zones = board.zones.filter((zone) => !removeZones.has(zone.id));
  for (const zone of board.zones) markZoneFillDirty(zone, `placement-candidate:${candidate.candidateHash}`);
  if (board.constraintState) board.constraintState.activeEvaluation = undefined;
}

export function applyPlacementCandidate(input: { board: PcbBoard; problem: PlacementProblem; candidate: PlacementCandidate; actorId: string }): PlacementApplyResult {
  const integrity = placementCandidateIntegrityErrors(input.candidate);
  if (integrity.length > 0 || input.candidate.problemHash !== input.problem.problemHash) return { ok: false, code: "INVALID_CANDIDATE", message: `Placement candidate integrity failed: ${[...integrity, ...(input.candidate.problemHash !== input.problem.problemHash ? ["problem hash mismatch"] : [])].join("; ")}.` };
  const currentRevision = pcbRevisionId(input.board);
  if (currentRevision !== input.problem.sourceBoardRevision || currentRevision !== input.candidate.sourceBoardRevision) return { ok: false, code: "STALE_BOARD", message: "Board changed after placement problem capture; candidate was not applied." };
  if (input.board.constraintState?.activeProgram?.programHash && input.board.constraintState.activeProgram.programHash !== input.candidate.constraintProgramHash) return { ok: false, code: "STALE_PROGRAM", message: "The active constraint program changed after candidate generation." };
  const revalidated = validatePlacementCandidate(input.problem, input.candidate.placements);
  if (!revalidated.legal || placementSemanticHash(revalidated) !== placementSemanticHash(input.candidate.hardReport)) return { ok: false, code: "POST_VALIDATION_FAILED", message: "Fresh hard validation does not match the candidate report." };
  const tracks = input.candidate.copperPlan.removeTrackIds.map((id) => input.board.tracks.find((track) => track.id === id));
  const vias = input.candidate.copperPlan.removeViaIds.map((id) => input.board.vias.find((via) => via.id === id));
  if (tracks.some((track) => !track || !generated(track)) || vias.some((via) => !via || !generated(via))) return { ok: false, code: "PROTECTED_COPPER", message: "Candidate attempted to remove missing, manual, imported, or locked copper." };
  const before = Object.fromEntries(input.candidate.moves.map((move) => [move.instanceId, structuredClone(move.before)]));
  const after = Object.fromEntries(input.candidate.moves.map((move) => [move.instanceId, structuredClone(move.after)]));
  const board = structuredClone(input.board);
  mutateBoardWithPlacementCandidate(board, input.candidate);
  const afterRevision = pcbRevisionId(board);
  const removedZones = input.candidate.copperPlan.removeZoneIds.map((id) => input.board.zones.find((zone) => zone.id === id)).filter((zone): zone is Zone => Boolean(zone));
  const transaction: PlacementApplyTransaction = {
    schemaVersion: 1,
    id: placementStableId("placement-transaction", { candidateHash: input.candidate.candidateHash, beforeRevision: currentRevision, afterRevision, actorId: input.actorId }),
    candidateId: input.candidate.candidateId,
    candidateHash: input.candidate.candidateHash,
    problemHash: input.problem.problemHash,
    constraintProgramHash: input.candidate.constraintProgramHash,
    beforeRevision: currentRevision,
    afterRevision,
    before,
    after,
    removedTracks: tracks.filter((track): track is Track => Boolean(track)).map((track) => structuredClone(track)),
    removedVias: vias.filter((via): via is Via => Boolean(via)).map((via) => structuredClone(via)),
    removedZones: removedZones.map((zone) => structuredClone(zone)),
    zoneSnapshotsBefore: input.board.zones.map((zone) => structuredClone(zone)),
    actorId: input.actorId,
  };
  return { ok: true, board, transaction };
}

export function revertPlacementTransaction(input: { board: PcbBoard; transaction: PlacementApplyTransaction }): PlacementApplyResult {
  if (pcbRevisionId(input.board) !== input.transaction.afterRevision) return { ok: false, code: "STALE_BOARD", message: "Board changed after placement apply; exact transaction revert was rejected." };
  const board = structuredClone(input.board);
  for (const footprint of board.footprints) {
    const before = input.transaction.before[footprint.id];
    if (!before) continue;
    footprint.at = { ...before.position };
    footprint.rotationDeg = before.rotationDeg;
    footprint.side = before.side;
  }
  board.tracks.push(...input.transaction.removedTracks.map((track) => structuredClone(track)));
  board.vias.push(...input.transaction.removedVias.map((via) => structuredClone(via)));
  board.zones = input.transaction.zoneSnapshotsBefore.map((zone) => structuredClone(zone));
  board.tracks.sort((left, right) => left.id.localeCompare(right.id));
  board.vias.sort((left, right) => left.id.localeCompare(right.id));
  board.zones.sort((left, right) => left.id.localeCompare(right.id));
  if (board.constraintState) board.constraintState.activeEvaluation = undefined;
  if (pcbRevisionId(board) !== input.transaction.beforeRevision) return { ok: false, code: "POST_VALIDATION_FAILED", message: "Exact placement revert did not restore the original semantic board revision." };
  return { ok: true, board, transaction: input.transaction };
}
