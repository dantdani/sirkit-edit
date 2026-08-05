import type { Track } from "../types";
import { canMutateCopper } from "./protection";
import { routingStableId } from "./stable";
import { ROUTING_MIN_SEGMENT_NM, ROUTING_TOLERANCE_NM, type RouteAnchor, type RouteRequest } from "./types";

export interface TrackSplitResult {
  ok: boolean;
  removedTracks: Track[];
  createdTracks: Track[];
  splitSourceIds: string[];
  junctionIds: string[];
  failures: Array<{ code: string; objectIds: string[]; message: string }>;
}

/** Candidate-only track splitting. The committed source track is never touched here. */
export function splitTracksAtAnchors(input: { tracks: readonly Track[]; anchors: readonly RouteAnchor[]; request: RouteRequest; candidateKey: string }): TrackSplitResult {
  const byTrack = new Map<string, RouteAnchor[]>();
  for (const anchor of input.anchors.filter((item) => item.contactKind === "interior_track_junction" && item.objectId.startsWith("track:") && item.parameter !== undefined)) {
    const id = anchor.objectId.slice("track:".length);
    byTrack.set(id, [...(byTrack.get(id) ?? []), anchor]);
  }
  const removedTracks: Track[] = [];
  const createdTracks: Track[] = [];
  const failures: TrackSplitResult["failures"] = [];
  const junctionIds: string[] = [];
  for (const [trackId, anchors] of [...byTrack.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const track = input.tracks.find((item) => item.id === trackId);
    if (!track) {
      failures.push({ code: "SPLIT_TRACK_MISSING", objectIds: [`track:${trackId}`], message: "Interior anchor source track is missing." });
      continue;
    }
    const permission = canMutateCopper(track, input.request);
    if (!permission.allowed) {
      failures.push({ code: "SPLIT_TRACK_PROTECTED", objectIds: [`track:${trackId}`], message: permission.reason });
      continue;
    }
    const length = Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y);
    const parameters = [0, ...anchors.map((anchor) => anchor.parameter!).filter((parameter) => parameter > ROUTING_TOLERANCE_NM / Math.max(1, length) && parameter < 1 - ROUTING_TOLERANCE_NM / Math.max(1, length)), 1]
      .sort((a, b) => a - b)
      .filter((parameter, index, values) => index === 0 || (parameter - values[index - 1]) * length > ROUTING_TOLERANCE_NM);
    if (parameters.length <= 2) continue;
    const segments: Track[] = [];
    for (let index = 0; index + 1 < parameters.length; index += 1) {
      const a = parameters[index]; const b = parameters[index + 1];
      if ((b - a) * length < ROUTING_MIN_SEGMENT_NM) {
        failures.push({ code: "SPLIT_SEGMENT_TOO_SHORT", objectIds: [`track:${trackId}`], message: "Track split would create a segment below the minimum representable length." });
        continue;
      }
      const start = { x: Math.round(track.start.x + (track.end.x - track.start.x) * a), y: Math.round(track.start.y + (track.end.y - track.start.y) * a) };
      const end = { x: Math.round(track.start.x + (track.end.x - track.start.x) * b), y: Math.round(track.start.y + (track.end.y - track.start.y) * b) };
      const id = routingStableId("route-split-track", { candidateKey: input.candidateKey, source: track.id, a, b });
      segments.push({ ...structuredClone(track), id, start, end, routingProvenance: { operationId: input.request.requestId, candidateId: `route-candidate:${input.candidateKey.slice(3)}`, eventId: routingStableId("route-event", { candidateKey: input.candidateKey, track: track.id }), actorId: input.request.requestedBy.actorId, createdBy: input.request.requestedBy.kind === "ai" ? "ai-requested" : "interactive", lineageObjectIds: [...new Set([track.id, ...(track.routingProvenance?.lineageObjectIds ?? [])])].sort() } });
    }
    if (failures.some((failure) => failure.objectIds.includes(`track:${trackId}`))) continue;
    removedTracks.push(structuredClone(track));
    createdTracks.push(...segments);
    for (const parameter of parameters.slice(1, -1)) junctionIds.push(routingStableId("route-junction", { source: track.id, parameter }));
  }
  return { ok: failures.length === 0, removedTracks, createdTracks, splitSourceIds: removedTracks.map((track) => track.id).sort(), junctionIds: junctionIds.sort(), failures: failures.sort((a, b) => a.code.localeCompare(b.code) || a.objectIds.join().localeCompare(b.objectIds.join())) };
}
