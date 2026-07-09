// Track → (segment ...) emission (PCB Stage 13).

import type { Track, PcbBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import { q, sexpr } from "./sexpr-emit";
import { toKicadLayer } from "./layer-map";
import { nmToMm } from "./units";
import { newUuid } from "./types";

export function emitTrack(track: Track, board: PcbBoard, netlist: PcbNetlist): string {
  void board;
  void netlist; // pinned signature; segments reference nets by id only
  return (
    `(segment (start ${nmToMm(track.start.x)} ${nmToMm(track.start.y)})` +
    ` (end ${nmToMm(track.end.x)} ${nmToMm(track.end.y)})` +
    ` (width ${nmToMm(track.width)})` +
    ` (layer ${q(toKicadLayer(track.layer))})` +
    ` ${sexpr("net", track.netId)}` +
    ` ${sexpr("uuid", q(newUuid()))})`
  );
}
