// Zone → (zone ...) emission (PCB Stage 13; completed in Stage 14 once
// Stage 11's fill engine landed).
//
// Emits the user outline as (polygon ...) and every computed FilledRegion as
// (filled_polygon ...) blocks. KiCad's filled_polygon is a SINGLE outline —
// holes don't exist in the format — so hole-carrying regions are FRACTURED
// first: a hair-width slit (0.1 µm — far below any fab's minimum feature and
// exactly representable at gerber precision) is subtracted from each hole's
// rightmost vertex out past the region boundary, converting the hole into a
// boundary notch. Same concept KiCad uses internally for its fill storage.
//
// `(filled_areas_thickness no)` marks the fills as v6-style "final copper":
// KiCad plots the polygons as-is with no extra min_thickness stroke, so the
// gerber copper matches Stage 11's computed clearances exactly.

import type { Zone, PcbBoard, FilledRegion } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import type { Vec2 } from "../geometry";
import { differenceWithHoles, type PolyWithHoles } from "../zones/clipper-adapter";
import { thermalParamsFor, zoneClearanceNm } from "../zones/types";
import { block, q, sexpr } from "./sexpr-emit";
import { toKicadLayer } from "./layer-map";
import { nmToMm } from "./units";
import { newUuid } from "./types";
import { netTable, netNameOf } from "./emit-board";

const SLIT_HALF_NM = 50; // slit height 100 nm
const SLIT_OVERSHOOT_NM = 1_000_000; // extend 1 mm past the region's right edge
const MAX_FRACTURE_PASSES = 8;

function pts(points: readonly Vec2[]): string {
  return `(pts ${points.map((p) => `(xy ${nmToMm(p.x)} ${nmToMm(p.y)})`).join(" ")})`;
}

/** Hole-free outlines for one fill region (see module header). A hole that
 * somehow survives every pass is dropped from its ring list — the outer
 * outline still emits, trading a sliver of overfill for a valid file. */
function fracture(region: FilledRegion): Vec2[][] {
  const holes = region.holes.filter((h) => h.length >= 3);
  if (region.outer.length < 3) return [];
  if (holes.length === 0) return [region.outer];

  let polys: PolyWithHoles[] = [[region.outer, ...holes]];
  for (let pass = 0; pass < MAX_FRACTURE_PASSES; pass++) {
    let maxX = -Infinity;
    for (const poly of polys) for (const v of poly[0]) if (v.x > maxX) maxX = v.x;

    const slits: Vec2[][] = [];
    for (const poly of polys) {
      for (const hole of poly.slice(1)) {
        let vx = hole[0];
        for (const v of hole) if (v.x > vx.x) vx = v;
        slits.push([
          { x: vx.x - 2 * SLIT_HALF_NM, y: vx.y - SLIT_HALF_NM },
          { x: maxX + SLIT_OVERSHOOT_NM, y: vx.y - SLIT_HALF_NM },
          { x: maxX + SLIT_OVERSHOOT_NM, y: vx.y + SLIT_HALF_NM },
          { x: vx.x - 2 * SLIT_HALF_NM, y: vx.y + SLIT_HALF_NM },
        ]);
      }
    }
    if (slits.length === 0) break;
    polys = differenceWithHoles(polys, slits);
  }
  return polys.map((rings) => rings[0]).filter((r) => r.length >= 3);
}

export function emitZone(zone: Zone, board: PcbBoard, netlist: PcbNetlist): string {
  if (zone.polygon.length < 3) return "";
  const nets = netTable(board, netlist);
  const layer = q(toKicadLayer(zone.layer));
  const thermal = thermalParamsFor(board, zone);
  const clearance = nmToMm(zoneClearanceNm(board, zone));
  // No token = thermal relief (KiCad default); `yes` = solid connection.
  const connectPads =
    zone.connection === "solid"
      ? `(connect_pads yes (clearance ${clearance}))`
      : `(connect_pads (clearance ${clearance}))`;
  const outlines = zone.fill.flatMap(fracture);

  return block("zone", [
    sexpr("net", zone.netId),
    sexpr("net_name", q(netNameOf(nets, zone.netId))),
    `(layer ${layer})`,
    sexpr("uuid", q(newUuid())),
    `(hatch edge 0.508000)`,
    connectPads,
    sexpr("min_thickness", "0.100000"),
    `(filled_areas_thickness no)`,
    `(fill yes (thermal_gap ${nmToMm(thermal.gapNm)}) (thermal_bridge_width ${nmToMm(thermal.spokeWidthNm)}))`,
    block("polygon", [pts(zone.polygon)]),
    ...outlines.map((outline) => block("filled_polygon", [`(layer ${layer})`, pts(outline)])),
  ]);
}
