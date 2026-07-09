// NetClass → (net_class ...) block (PCB Stage 13). Legacy v5-style syntax —
// KiCad 6+ stores net classes in the .kicad_pro project file, but the board
// parser still accepts these blocks and imports them on open, which is
// exactly what a standalone .kicad_pcb escape hatch needs.

import type { NetClass } from "../netclass";
import type { KicadNetRef } from "./types";
import { block, q, sexpr } from "./sexpr-emit";
import { nmToMm } from "./units";

// KiCad microvia defaults — sirkit has no microvia model (MVP).
const UVIA_DIA_MM = "0.300000";
const UVIA_DRILL_MM = "0.100000";

export function emitNetClass(netClass: NetClass, netsInClass: KicadNetRef[]): string {
  const addNets = [...netsInClass]
    .filter((n) => n.id !== 0 && n.name.length > 0)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((n) => sexpr("add_net", q(n.name)));
  return block(`net_class ${q(netClass.name)} ${q("")}`, [
    sexpr("clearance", nmToMm(netClass.clearance)),
    sexpr("trace_width", nmToMm(netClass.trackWidth)),
    sexpr("via_dia", nmToMm(netClass.viaSize)),
    sexpr("via_drill", nmToMm(netClass.viaDrill)),
    sexpr("uvia_dia", UVIA_DIA_MM),
    sexpr("uvia_drill", UVIA_DRILL_MM),
    ...addNets,
  ]);
}
