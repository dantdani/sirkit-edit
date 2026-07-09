// Via → (via ...) emission (PCB Stage 13). MVP: through-hole vias only —
// blind/buried spans are emitted as their actual layer pair, but sirkit's
// Stage 9 router only produces copperTop↔copperBottom vias today.

import type { Via, PcbBoard } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import { q, sexpr } from "./sexpr-emit";
import { toKicadLayer } from "./layer-map";
import { nmToMm } from "./units";
import { newUuid } from "./types";

export function emitVia(via: Via, board: PcbBoard, netlist: PcbNetlist): string {
  void board;
  void netlist; // pinned signature; vias reference nets by id only
  const layers = via.layers.map((l) => q(toKicadLayer(l))).join(" ");
  return (
    `(via (at ${nmToMm(via.at.x)} ${nmToMm(via.at.y)})` +
    ` (size ${nmToMm(via.size)})` +
    ` (drill ${nmToMm(via.drill)})` +
    ` (layers ${layers})` +
    ` ${sexpr("net", via.netId)}` +
    ` ${sexpr("uuid", q(newUuid()))})`
  );
}
