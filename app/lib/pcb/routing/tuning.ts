import { segmentDistance } from "../geometry-copper";
import type { BBox, Vec2 } from "../geometry";
import type { Track } from "../types";
import { routingStableId } from "./stable";
import { ROUTING_MIN_SEGMENT_NM } from "./types";

export interface TuningResult {
  status: "feasible" | "insufficient_capacity" | "unsupported";
  replacementTracks: Track[];
  removedTrackIds: string[];
  requestedDeltaNm: number;
  achievedDeltaNm: number;
  residualNm: number;
  maximumAchievableDeltaNm: number;
  explanation: string;
}

const inside = (point: Vec2, box: BBox): boolean => point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;

/** Native straight-segment serpentine replacement for one explicit unbranched segment. */
export function tuneStraightTrack(input: { track: Track; deltaNm: number; corridor: BBox; pitchNm: number; maximumAmplitudeNm: number; selfSpacingNm: number; candidateKey: string }): TuningResult {
  const directLength = Math.hypot(input.track.end.x - input.track.start.x, input.track.end.y - input.track.start.y);
  if (!(input.deltaNm > 0) || !(input.pitchNm >= ROUTING_MIN_SEGMENT_NM) || directLength < input.pitchNm) return { status: "unsupported", replacementTracks: [], removedTrackIds: [], requestedDeltaNm: input.deltaNm, achievedDeltaNm: 0, residualNm: input.deltaNm, maximumAchievableDeltaNm: 0, explanation: "Tuning requires a positive delta and a straight segment long enough for at least one pattern element." };
  const elements = Math.max(1, Math.floor(directLength / input.pitchNm));
  const usedPitch = directLength / elements;
  const maxAddedPerElement = 2 * Math.hypot(usedPitch / 2, input.maximumAmplitudeNm) - usedPitch;
  const maximumAchievableDeltaNm = elements * maxAddedPerElement;
  const target = Math.min(input.deltaNm, maximumAchievableDeltaNm);
  const addedPerElement = target / elements;
  const amplitude = Math.sqrt(Math.max(0, ((addedPerElement + usedPitch) / 2) ** 2 - (usedPitch / 2) ** 2));
  const ux = (input.track.end.x - input.track.start.x) / directLength;
  const uy = (input.track.end.y - input.track.start.y) / directLength;
  const px = -uy; const py = ux;
  const points: Vec2[] = [{ ...input.track.start }];
  for (let index = 0; index < elements; index += 1) {
    const direction = index % 2 === 0 ? 1 : -1;
    const midpointDistance = index * usedPitch + usedPitch / 2;
    points.push({ x: Math.round(input.track.start.x + ux * midpointDistance + px * amplitude * direction), y: Math.round(input.track.start.y + uy * midpointDistance + py * amplitude * direction) });
    const endDistance = (index + 1) * usedPitch;
    points.push(index === elements - 1 ? { ...input.track.end } : { x: Math.round(input.track.start.x + ux * endDistance), y: Math.round(input.track.start.y + uy * endDistance) });
  }
  if (points.some((point) => !inside(point, input.corridor))) return { status: "insufficient_capacity", replacementTracks: [], removedTrackIds: [], requestedDeltaNm: input.deltaNm, achievedDeltaNm: 0, residualNm: input.deltaNm, maximumAchievableDeltaNm: 0, explanation: "The selected corridor cannot contain the required serpentine amplitude." };
  for (let left = 0; left + 1 < points.length; left += 1) for (let right = left + 2; right + 1 < points.length; right += 1) {
    if (right === left + 1) continue;
    const spacing = segmentDistance(points[left], points[left + 1], points[right], points[right + 1]);
    if (spacing < input.track.width + input.selfSpacingNm) return { status: "insufficient_capacity", replacementTracks: [], removedTrackIds: [], requestedDeltaNm: input.deltaNm, achievedDeltaNm: 0, residualNm: input.deltaNm, maximumAchievableDeltaNm, explanation: "The pattern would violate minimum same-net self-spacing." };
  }
  const replacementTracks: Track[] = points.slice(0, -1).map((start, index) => ({ ...structuredClone(input.track), id: routingStableId("tuning-track", { candidateKey: input.candidateKey, source: input.track.id, index, start, end: points[index + 1] }), start, end: points[index + 1], routingProvenance: { operationId: input.candidateKey, candidateId: input.candidateKey, eventId: routingStableId("tuning-event", { candidateKey: input.candidateKey, index }), actorId: "routing:tuner", createdBy: "deterministic-router", lineageObjectIds: [...new Set([input.track.id, ...(input.track.routingProvenance?.lineageObjectIds ?? [])])].sort() } }));
  const tunedLength = replacementTracks.reduce((sum, track) => sum + Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y), 0);
  const achievedDeltaNm = tunedLength - directLength;
  const residualNm = input.deltaNm - achievedDeltaNm;
  return { status: input.deltaNm <= maximumAchievableDeltaNm ? "feasible" : "insufficient_capacity", replacementTracks, removedTrackIds: [input.track.id], requestedDeltaNm: input.deltaNm, achievedDeltaNm, residualNm, maximumAchievableDeltaNm, explanation: input.deltaNm <= maximumAchievableDeltaNm ? `Added ${Math.round(achievedDeltaNm)} nm as native editable straight segments.` : `Corridor capacity is ${Math.round(maximumAchievableDeltaNm)} nm; residual is ${Math.round(residualNm)} nm.` };
}
