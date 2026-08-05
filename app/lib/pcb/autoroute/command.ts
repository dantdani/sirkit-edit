/**
 * Autoroute history command (PCB Stage 9).
 *
 * The entire batch of tracks + vias returned by Freerouting is imported as ONE
 * `RouteCommand` of kind `AutorouteImport` (defined in route-tool.commands.ts),
 * so a single Ctrl+Z reverses the whole autoroute. This module builds that
 * command from a board + the freshly-parsed tracks/vias; the apply / invert
 * semantics live next to the other route commands.
 *
 * DEVIATION FROM THE PINNED SHAPE (documented in the progress note): the plan
 * pinned `{ tracks, vias, replacedNetIds }`, but `invertRouteCommand(cmd)` takes
 * no board, so it cannot restore the copper that a partial re-route replaced.
 * We therefore also carry `removed` (exactly like the existing `RipupNet`
 * command), which makes the variant cleanly self-dual: invert swaps
 * (tracks/vias) with `removed`. This is what lets the pure apply→invert
 * round-trip restore a partially-routed net.
 */

import type { PcbBoard, Track, Via } from "../types";
import type { RouteCommand } from "../route-tool.commands";

/** The `AutorouteImport` member of the `RouteCommand` union (single source of truth in route-tool.commands.ts). */
export type AutorouteImportCommand = Extract<RouteCommand, { kind: "AutorouteImport" }>;

function cloneTrack(t: Track): Track {
  return { ...t, start: { ...t.start }, end: { ...t.end } };
}

function cloneVia(v: Via): Via {
  return { ...v, at: { ...v.at }, layers: [v.layers[0], v.layers[1]] };
}

/**
 * Build the single-undo import command.
 *
 * `replacedNetIds` = the set of nets Freerouting produced routes for (derived
 * from the imported tracks + vias). Applying the command first clears ALL
 * existing copper on those nets, then adds the fresh copper — so a partial
 * route replaces only the nets it touched and leaves every other net's copper
 * intact. `removed` captures the pre-existing copper on those nets from `board`
 * so the command is reversible on its own (immer patches own live undo; this
 * keeps the pure reference pair correct too).
 */
export function buildAutorouteImportCommand(
  board: PcbBoard,
  imported: { tracks: Track[]; vias: Via[] },
): AutorouteImportCommand {
  const replaced = new Set<number>();
  for (const t of imported.tracks) replaced.add(t.netId);
  for (const v of imported.vias) replaced.add(v.netId);
  const replacedNetIds = [...replaced].sort((a, b) => a - b);

  return {
    kind: "AutorouteImport",
    tracks: imported.tracks.map(cloneTrack),
    vias: imported.vias.map(cloneVia),
    replacedNetIds,
    removed: {
      tracks: board.tracks.filter((track) => replaced.has(track.netId) && track.locked !== true).map(cloneTrack),
      vias: board.vias.filter((via) => replaced.has(via.netId) && via.locked !== true).map(cloneVia),
    },
    protected: {
      tracks: board.tracks.filter((track) => replaced.has(track.netId) && track.locked === true).map(cloneTrack),
      vias: board.vias.filter((via) => replaced.has(via.netId) && via.locked === true).map(cloneVia),
    },
  };
}
