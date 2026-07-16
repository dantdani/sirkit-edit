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

import { produce } from "immer";
import type { PcbBoard, RoutingHistoryEvent, Track, Via } from "./types";

interface RoutingHistoryPayload {
  historyEvents?: RoutingHistoryEvent[];
}

interface RemovedCopper extends RoutingHistoryPayload {
  tracks: Track[];
  vias: Via[];
}

export type RouteCommand =
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
      const after = new Map(cmd.after.map((t) => [t.id, t]));
      board.tracks = board.tracks.map((t) => {
        const next = after.get(t.id);
        return next ? cloneTrack(next) : t;
      });
      return;
    }
    case "RipupNet":
      board.tracks = board.tracks.filter((t) => t.netId !== cmd.netId);
      board.vias = board.vias.filter((v) => v.netId !== cmd.netId);
      if (cmd.removed.historyEvents?.length && board.routingHistory) {
        const removed = new Set(cmd.removed.historyEvents.map((event) => event.id));
        const remaining = board.routingHistory.filter((event) => !removed.has(event.id));
        if (remaining.length) board.routingHistory = remaining;
        else delete board.routingHistory;
      }
      return;
    case "AutorouteImport": {
      const replaced = new Set(cmd.replacedNetIds);
      board.tracks = board.tracks.filter((t) => !replaced.has(t.netId));
      board.vias = board.vias.filter((v) => !replaced.has(v.netId));
      for (const t of cmd.tracks) board.tracks.push(cloneTrack(t));
      for (const v of cmd.vias) board.vias.push(cloneVia(v));
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
      };
  }
}

/** Collect a net's entire copper for a `RipupNet` command (per-net ripup UI). */
export function buildRipupNetCommand(board: PcbBoard, netId: number): RouteCommand {
  return {
    kind: "RipupNet",
    netId,
    removed: {
      tracks: board.tracks.filter((t) => t.netId === netId).map(cloneTrack),
      vias: board.vias.filter((v) => v.netId === netId).map(cloneVia),
      ...((board.routingHistory?.some((event) => event.netId === netId) ?? false)
        ? { historyEvents: board.routingHistory?.filter((event) => event.netId === netId).map(cloneHistoryEvent) }
        : {}),
    },
  };
}

/** Human-readable label for the history entry. */
export function routeCommandLabel(cmd: RouteCommand, board?: PcbBoard): string {
  const netName = (netId: number): string =>
    board?.nets.find((n) => n.id === netId)?.name || `net ${netId}`;
  switch (cmd.kind) {
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
