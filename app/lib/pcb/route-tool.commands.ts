/**
 * Interactive-routing commands (PCB Stage 7) — PURE, no Pixi/React/DOM.
 *
 * Every state-mutating routing action is described by a `RouteCommand`. The
 * live editor commits each through Stage 5's immer history stack
 * (`history.execute(label, draft => mutateBoardWithCommand(draft, cmd))`), so
 * undo/redo ride the patch log — one Ctrl+Z per gesture. `applyRouteCommand` /
 * `invertRouteCommand` are the pure reference pair the tests exercise; they are
 * NOT on the live undo path (immer patches are), which is why the inverse of an
 * "add" is a by-net `RipupNet` (see the round-trip note below).
 *
 * Round-trip invariant (commands.test): for a freshly-routed net (no prior
 * tracks/vias of that net), `applyRouteCommand` then `invertRouteCommand`
 * restores the board as a SET of tracks/vias (compare id-sorted — RipupNet →
 * re-add loses original array position, which is immaterial to the board).
 */

import { current, isDraft, produce } from "immer";
import type { PcbBoard, RoutingHistoryEvent, Track, Via } from "./types";
import { commitRouteCandidate } from "./routing/candidate";
import type { RouteCandidate } from "./routing/types";
import { canMutateCopper } from "./routing/protection";

interface RoutingHistoryPayload {
  historyEvents?: RoutingHistoryEvent[];
}

interface RemovedCopper extends RoutingHistoryPayload {
  tracks: Track[];
  vias: Via[];
  protected?: { tracks: Track[]; vias: Via[] };
}

export type RouteCommand =
  | ({ kind: "CommitRouteCandidate"; candidate: RouteCandidate; actorId: string } & RoutingHistoryPayload)
  | ({ kind: "CommitRouteSegment"; segments: Track[]; netId: number } & RoutingHistoryPayload)
  | ({ kind: "PlaceViaAndFlipLayer"; via: Via; segments: Track[] } & RoutingHistoryPayload)
  | { kind: "StretchTrack"; before: Track[]; after: Track[] } // matched by id
  | { kind: "RipupNet"; netId: number; removed: RemovedCopper }
  // Stage 9 — one undo entry for the whole autoroute. Clears all copper on
  // `replacedNetIds`, adds `tracks`+`vias`; `removed` is the pre-existing copper
  // on those nets (self-dual: invert swaps tracks/vias with removed).
  | {
      kind: "AutorouteImport";
      tracks: Track[];
      vias: Via[];
      replacedNetIds: number[];
      removed: { tracks: Track[]; vias: Via[] };
      protected?: { tracks: Track[]; vias: Via[] };
    };

function cloneTrack(t: Track): Track {
  return { ...t, start: { ...t.start }, end: { ...t.end } };
}

function cloneVia(v: Via): Via {
  return { ...v, at: { ...v.at }, layers: [v.layers[0], v.layers[1]] };
}

function cloneHistoryEvent(event: RoutingHistoryEvent): RoutingHistoryEvent {
  return {
    ...event,
    points: event.points.map((point) => ({ ...point })),
    segmentIds: [...event.segmentIds],
    rules: { ...event.rules },
  };
}

function appendHistory(board: PcbBoard, events?: readonly RoutingHistoryEvent[]): void {
  if (!events?.length) return;
  board.routingHistory ??= [];
  for (const event of events) board.routingHistory.push(cloneHistoryEvent(event));
}

/**
 * Apply a command by mutating an immer draft (or any writable board). Deep-
 * copies its inputs so the board never aliases the command's arrays.
 */
export function mutateBoardWithCommand(board: PcbBoard, cmd: RouteCommand): void {
  switch (cmd.kind) {
    case "CommitRouteCandidate": {
      const source = isDraft(board) ? current(board) as PcbBoard : board;
      const committed = commitRouteCandidate({ board: source, candidate: cmd.candidate, actorId: cmd.actorId });
      if (!committed.ok) return;
      board.tracks = committed.board.tracks.map(cloneTrack);
      board.vias = committed.board.vias.map(cloneVia);
      board.zones = structuredClone(committed.board.zones);
      if (committed.board.constraintState) board.constraintState = structuredClone(committed.board.constraintState);
      else delete board.constraintState;
      appendHistory(board, cmd.historyEvents);
      return;
    }
    case "CommitRouteSegment":
      for (const s of cmd.segments) board.tracks.push(cloneTrack(s));
      appendHistory(board, cmd.historyEvents);
      return;
    case "PlaceViaAndFlipLayer":
      board.vias.push(cloneVia(cmd.via));
      for (const s of cmd.segments) board.tracks.push(cloneTrack(s));
      appendHistory(board, cmd.historyEvents);
      return;
    case "StretchTrack": {
      const targetIds = new Set(cmd.after.map((track) => track.id));
      const scope = { mutationScope: { kind: "selected_objects" as const, objectIds: [...targetIds].map((id) => `track:${id}`) }, preservePolicy: "selected_manual_movable" as const };
      if (board.tracks.some((track) => targetIds.has(track.id) && !canMutateCopper(track, scope).allowed)) return;
      const after = new Map(cmd.after.map((t) => [t.id, t]));
      board.tracks = board.tracks.map((t) => {
        const next = after.get(t.id);
        return next ? cloneTrack(next) : t;
      });
      return;
    }
    case "RipupNet":
      {
        const removedTracks = new Set(cmd.removed.tracks.map((track) => track.id));
        const removedVias = new Set(cmd.removed.vias.map((via) => via.id));
        const scope = { mutationScope: { kind: "selected_objects" as const, objectIds: [...removedTracks].map((id) => `track:${id}`).concat([...removedVias].map((id) => `via:${id}`)) }, preservePolicy: "selected_manual_movable" as const };
        board.tracks = board.tracks.filter((track) => !removedTracks.has(track.id) || !canMutateCopper(track, scope).allowed);
        board.vias = board.vias.filter((via) => !removedVias.has(via.id) || !canMutateCopper(via, scope).allowed);
      }
      if (cmd.removed.historyEvents?.length && board.routingHistory) {
        const removed = new Set(cmd.removed.historyEvents.map((event) => event.id));
        const remaining = board.routingHistory.filter((event) => !removed.has(event.id));
        if (remaining.length) board.routingHistory = remaining;
        else delete board.routingHistory;
      }
      return;
    case "AutorouteImport": {
      const replaced = new Set(cmd.replacedNetIds);
      const lockedTrackIds = new Set(board.tracks.filter((track) => track.locked).map((track) => track.id));
      const lockedViaIds = new Set(board.vias.filter((via) => via.locked).map((via) => via.id));
      board.tracks = board.tracks.filter((track) => !replaced.has(track.netId) || track.locked === true);
      board.vias = board.vias.filter((via) => !replaced.has(via.netId) || via.locked === true);
      for (const track of cmd.tracks) if (!lockedTrackIds.has(track.id)) board.tracks.push(cloneTrack(track));
      for (const via of cmd.vias) if (!lockedViaIds.has(via.id)) board.vias.push(cloneVia(via));
      return;
    }
  }
}

/** Pure form — returns a new board. Used by tests and as a redo reference. */
export function applyRouteCommand(board: PcbBoard, cmd: RouteCommand): PcbBoard {
  return produce(board, (draft) => mutateBoardWithCommand(draft, cmd));
}

/**
 * The command that reverses `cmd`. StretchTrack is self-inverse (swap). An
 * "add" inverts to a by-net `RipupNet` (correct when the net had no prior
 * copper — the routing case). RipupNet inverts to re-adding its `removed`
 * payload; expressible as a single command for the ≤1-via case (the live app
 * never needs the multi-via case — immer patches own undo there).
 */
export function invertRouteCommand(cmd: RouteCommand): RouteCommand {
  switch (cmd.kind) {
    case "CommitRouteCandidate":
      throw new Error("invertRouteCommand: immutable route candidates use the history patch stack for exact undo");
    case "CommitRouteSegment":
      return {
        kind: "RipupNet",
        netId: cmd.netId,
        removed: {
          tracks: cmd.segments.map(cloneTrack),
          vias: [],
          ...(cmd.historyEvents?.length ? { historyEvents: cmd.historyEvents.map(cloneHistoryEvent) } : {}),
        },
      };
    case "PlaceViaAndFlipLayer":
      return {
        kind: "RipupNet",
        netId: cmd.via.netId,
        removed: {
          tracks: cmd.segments.map(cloneTrack),
          vias: [cloneVia(cmd.via)],
          ...(cmd.historyEvents?.length ? { historyEvents: cmd.historyEvents.map(cloneHistoryEvent) } : {}),
        },
      };
    case "StretchTrack":
      return { kind: "StretchTrack", before: cmd.after.map(cloneTrack), after: cmd.before.map(cloneTrack) };
    case "RipupNet": {
      if (cmd.removed.vias.length === 0) {
        return {
          kind: "CommitRouteSegment",
          netId: cmd.netId,
          segments: cmd.removed.tracks.map(cloneTrack),
          ...(cmd.removed.historyEvents?.length ? { historyEvents: cmd.removed.historyEvents.map(cloneHistoryEvent) } : {}),
        };
      }
      if (cmd.removed.vias.length === 1) {
        return {
          kind: "PlaceViaAndFlipLayer",
          via: cloneVia(cmd.removed.vias[0]),
          segments: cmd.removed.tracks.map(cloneTrack),
          ...(cmd.removed.historyEvents?.length ? { historyEvents: cmd.removed.historyEvents.map(cloneHistoryEvent) } : {}),
        };
      }
      throw new Error(
        "invertRouteCommand: multi-via ripup is reversible only via the history patch stack",
      );
    }
    case "AutorouteImport":
      // Self-dual: re-import the removed copper and record the imported copper
      // as now-removed. Applying this clears `replacedNetIds` (dropping the
      // imported tracks/vias) then restores the originals.
      return {
        kind: "AutorouteImport",
        tracks: cmd.removed.tracks.map(cloneTrack),
        vias: cmd.removed.vias.map(cloneVia),
        replacedNetIds: [...cmd.replacedNetIds],
        removed: { tracks: cmd.tracks.map(cloneTrack), vias: cmd.vias.map(cloneVia) },
        ...(cmd.protected ? { protected: { tracks: cmd.protected.tracks.map(cloneTrack), vias: cmd.protected.vias.map(cloneVia) } } : {}),
      };
  }
}

/** Collect a net's entire copper for a `RipupNet` command (per-net ripup UI). */
export function buildRipupNetCommand(board: PcbBoard, netId: number): RouteCommand {
  const protectedTracks = board.tracks.filter((track) => track.netId === netId && track.locked === true);
  const protectedVias = board.vias.filter((via) => via.netId === netId && via.locked === true);
  const protectedTrackIds = new Set(protectedTracks.map((track) => track.id));
  return {
    kind: "RipupNet",
    netId,
    removed: {
      tracks: board.tracks.filter((track) => track.netId === netId && track.locked !== true).map(cloneTrack),
      vias: board.vias.filter((via) => via.netId === netId && via.locked !== true).map(cloneVia),
      protected: { tracks: protectedTracks.map(cloneTrack), vias: protectedVias.map(cloneVia) },
      ...((board.routingHistory?.some((event) => event.netId === netId && event.segmentIds.every((id) => !protectedTrackIds.has(id))) ?? false)
        ? { historyEvents: board.routingHistory?.filter((event) => event.netId === netId && event.segmentIds.every((id) => !protectedTrackIds.has(id))).map(cloneHistoryEvent) }
        : {}),
    },
  };
}

/** Default interactive rip-up is deliberately selection-scoped; whole-net rip-up remains an explicit command. */
export function buildRipupSelectionCommand(board: PcbBoard, trackId: string): RouteCommand | null {
  const track = board.tracks.find((candidate) => candidate.id === trackId);
  if (!track || track.netId === 0) return null;
  const scope = { mutationScope: { kind: "selected_objects" as const, objectIds: [`track:${track.id}`] }, preservePolicy: "selected_manual_movable" as const };
  const decision = canMutateCopper(track, scope);
  const historyEvents = board.routingHistory?.filter((event) => event.segmentIds.length === 1 && event.segmentIds[0] === track.id);
  return {
    kind: "RipupNet",
    netId: track.netId,
    removed: {
      tracks: decision.allowed ? [cloneTrack(track)] : [],
      vias: [],
      protected: { tracks: decision.allowed ? [] : [cloneTrack(track)], vias: [] },
      ...(historyEvents?.length ? { historyEvents: historyEvents.map(cloneHistoryEvent) } : {}),
    },
  };
}

/** Human-readable label for the history entry. */
export function routeCommandLabel(cmd: RouteCommand, board?: PcbBoard): string {
  const netName = (netId: number): string =>
    board?.nets.find((n) => n.id === netId)?.name || `net ${netId}`;
  switch (cmd.kind) {
    case "CommitRouteCandidate":
      return `Route ${netName(cmd.candidate.request.startAnchor?.netId ?? cmd.candidate.delta.createdTracks[0]?.netId ?? 0)}`;
    case "CommitRouteSegment":
      return `Route ${netName(cmd.netId)}`;
    case "PlaceViaAndFlipLayer":
      return `Place via (${netName(cmd.via.netId)})`;
    case "StretchTrack":
      return "Stretch track";
    case "RipupNet":
      return `Rip up ${netName(cmd.netId)}`;
    case "AutorouteImport":
      return "Autoroute board";
  }
}
