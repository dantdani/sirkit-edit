import type { PcbBoard, RoutingHistoryEvent, Track } from "../types";
import { stableHash } from "./hash";
import { normalizePath } from "./geometry";
import { adaptBoardToRoutingWorld } from "./world";
import { validateSmartRoute } from "./validator";
import { SMART_ROUTING_SCHEMA_VERSION, type EffectiveRoutingRules, type PreviewTransaction, type RoutingWorld, type SmartRouteCandidate, type SmartRouteIntent } from "./types";

export function beginPreviewTransaction(world: RoutingWorld, intent: SmartRouteIntent): PreviewTransaction {
  return Object.freeze({
    schemaVersion: SMART_ROUTING_SCHEMA_VERSION,
    id: `srtx-${stableHash(`${world.revision}|${intent.netId}|${intent.layer}|${intent.start.x},${intent.start.y}`)}`,
    baseWorldRevision: world.revision,
    intent,
    state: "preview" as const,
    candidates: Object.freeze([]),
  });
}
export function stagePreviewCandidates(
  transaction: PreviewTransaction,
  candidates: readonly SmartRouteCandidate[],
  selectedCandidateId?: string,
): PreviewTransaction {
  if (transaction.state !== "preview") throw new Error("Cannot stage a closed Smart Route transaction.");
  const selected = selectedCandidateId && candidates.some((candidate) => candidate.id === selectedCandidateId)
    ? selectedCandidateId
    : candidates[0]?.id;
  return Object.freeze({
    ...transaction,
    candidates: Object.freeze([...candidates]),
    ...(selected ? { selectedCandidateId: selected } : {}),
  });
}

export function selectPreviewCandidate(transaction: PreviewTransaction, candidateId: string): PreviewTransaction {
  if (!transaction.candidates.some((candidate) => candidate.id === candidateId)) {
    throw new Error(`Unknown Smart Route candidate ${candidateId}.`);
  }
  return Object.freeze({ ...transaction, selectedCandidateId: candidateId });
}

export function cancelPreviewTransaction(
  transaction: PreviewTransaction,
  currentBoard: PcbBoard,
): { transaction: PreviewTransaction; baseUnchanged: boolean } {
  return {
    transaction: Object.freeze({ ...transaction, state: "cancelled" as const }),
    baseUnchanged: adaptBoardToRoutingWorld(currentBoard).revision === transaction.baseWorldRevision,
  };
}

export function createRoutingHistoryEvent(
  transaction: PreviewTransaction,
  candidate: SmartRouteCandidate,
  rules: EffectiveRoutingRules,
  segmentIds: readonly string[],
): RoutingHistoryEvent {
  return {
    schemaVersion: 1,
    id: `srh-${stableHash(`${transaction.id}|${candidate.id}|${segmentIds.join(",")}`)}`,
    tool: "smart-route",
    baseWorldRevision: transaction.baseWorldRevision,
    netId: transaction.intent.netId,
    layer: transaction.intent.layer,
    candidateId: candidate.id,
    mode: candidate.mode,
    ...(candidate.direction ? { direction: candidate.direction } : {}),
    points: normalizePath(candidate.points),
    segmentIds: [...segmentIds],
    rules: {
      trackWidthNm: rules.trackWidthNm,
      clearanceNm: rules.clearanceNm,
      edgeClearanceNm: rules.edgeClearanceNm,
      gridNm: rules.gridNm,
    },
    score: candidate.score.total,
    explanation: candidate.explanation,
  };
}

export function replayRoutingHistoryEvent(
  board: PcbBoard,
  event: RoutingHistoryEvent,
): { ok: true; tracks: Track[] } | { ok: false; reason: string } {
  const world = adaptBoardToRoutingWorld(board);
  if (world.revision !== event.baseWorldRevision) {
    return { ok: false, reason: "Board revision differs from the event's base snapshot." };
  }
  const intent: SmartRouteIntent = {
    schemaVersion: 1,
    netId: event.netId,
    layer: event.layer,
    start: event.points[0],
    end: event.points[event.points.length - 1],
    movementPolicy: "keep-existing-copper-fixed",
    maxCandidates: 1,
  };
  const rules: EffectiveRoutingRules = {
    schemaVersion: 1,
    trackWidthNm: event.rules.trackWidthNm,
    clearanceNm: event.rules.clearanceNm,
    viaSizeNm: 0,
    viaDrillNm: 0,
    edgeClearanceNm: event.rules.edgeClearanceNm,
    gridNm: event.rules.gridNm,
    sources: [],
    explanation: "Replayed from structured Smart Route history.",
  };
  const validation = validateSmartRoute(world, intent, rules, event.points);
  if (!validation.legal) return { ok: false, reason: validation.violations[0]?.message ?? "Replay validation failed." };
  const tracks: Track[] = [];
  for (let index = 0; index + 1 < event.points.length; index++) {
    tracks.push({
      id: event.segmentIds[index] ?? `${event.id}-${index}`,
      layer: event.layer,
      width: event.rules.trackWidthNm,
      start: { ...event.points[index] },
      end: { ...event.points[index + 1] },
      netId: event.netId,
    });
  }
  return { ok: true, tracks };
}
