/**
 * Specctra SES reader (PCB Stage 9) — parses Freerouting's routed session back
 * into fresh Track[] + Via[] in our board's coordinate space (integer nm, +y
 * down; DSN/SES were emitted in the same axis so no flip is needed).
 *
 * Robust by construction: it reuses the lossless S-expression parser (sexpr.ts)
 * and only reads the nodes it recognizes (`routes` → `network_out` → `net` →
 * `wire`/`via`). Any other top-level or sibling block Freerouting emits
 * (`parser`, `resolution`, `library`, `base_design`, …) is simply ignored.
 */

import type { Track, Via, PcbBoard } from "../types";
import type { LayerId } from "../layers";
import { layerFromKicadName } from "../layers";
import { parseSexpr, child, children, type SList } from "../sexpr";
import { dsnNetName, VIA_DIMENSIONS } from "./write-dsn";

export interface SesResult {
  tracks: Track[]; // fresh ids
  vias: Via[]; // fresh ids
  wasSuccessful: boolean; // a routes/network_out block was present and parsed
  passesRun: number; // Freerouting pass count if parseable, else -1
}

// ── Fresh id generation (route-tool.ts's freshId is private; mirror the pattern
//    with an autoroute-specific prefix so ids stay distinguishable) ────────────
let idSeq = 0;
const idSalt = Math.random().toString(36).slice(2, 8);
function freshId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSalt}-${idSeq}`;
}

const VIA_LAYERS: [LayerId, LayerId] = ["copperTop", "copperBottom"];

function atomText(list: SList, index: number): string | null {
  const item = list.items[index];
  if (!item) return null;
  if (item.kind === "string" || item.kind === "symbol") return item.value;
  if (item.kind === "number") return item.raw;
  return null;
}

function atomNumber(list: SList, index: number): number | null {
  const item = list.items[index];
  return item && item.kind === "number" ? item.value : null;
}

/** All number atoms from `startIndex` onward (path vertices live inline). */
function trailingNumbers(list: SList, startIndex: number): number[] {
  const out: number[] = [];
  for (let i = startIndex; i < list.items.length; i++) {
    const it = list.items[i];
    if (it.kind === "number") out.push(it.value);
  }
  return out;
}

export function parseSes(sesText: string, board: PcbBoard): SesResult {
  const tracks: Track[] = [];
  const vias: Via[] = [];

  // net name -> id (net 0 is the reserved unconnected net; never routed)
  const netIdByName = new Map<string, number>();
  for (const net of board.nets) {
    if (net.id === 0) continue;
    netIdByName.set(dsnNetName(net), net.id);
  }

  let root: SList;
  try {
    root = parseSexpr(sesText);
  } catch {
    return { tracks, vias, wasSuccessful: false, passesRun: -1 };
  }

  const routes = child(root, "routes");
  if (!routes) return { tracks, vias, wasSuccessful: false, passesRun: -1 };

  for (const networkOut of children(routes, "network_out")) {
    for (const netList of children(networkOut, "net")) {
      const netName = atomText(netList, 1);
      const netId = netName != null ? netIdByName.get(netName) ?? 0 : 0;
      // Net 0 is the reserved unconnected net; a name we can't resolve maps to 0.
      // Freerouting never routes net 0, so drop these rather than plant floating
      // copper on it (which would also leak into AutorouteImport.replacedNetIds).
      if (netId === 0) continue;

      for (const wire of children(netList, "wire")) {
        const path = child(wire, "path");
        if (!path) continue;
        const layerName = atomText(path, 1);
        const layer = layerName ? layerFromKicadName(layerName) : undefined;
        if (!layer) continue; // unknown / non-copper layer — skip
        const width = atomNumber(path, 2);
        if (width == null) continue;
        const coords = trailingNumbers(path, 3); // x1 y1 x2 y2 ... (polyline)
        for (let i = 0; i + 3 < coords.length; i += 2) {
          tracks.push({
            id: freshId("ar-t"),
            layer,
            width,
            start: { x: coords[i], y: coords[i + 1] },
            end: { x: coords[i + 2], y: coords[i + 3] },
            netId,
          });
        }
      }

      for (const viaNode of children(netList, "via")) {
        const padstackName = atomText(viaNode, 1);
        const x = atomNumber(viaNode, 2);
        const y = atomNumber(viaNode, 3);
        if (x == null || y == null) continue;
        const dims = (padstackName && VIA_DIMENSIONS[padstackName]) || VIA_DIMENSIONS.via_default;
        vias.push({
          id: freshId("ar-v"),
          at: { x, y },
          size: dims.sizeNm,
          drill: dims.drillNm,
          netId,
          layers: [VIA_LAYERS[0], VIA_LAYERS[1]],
        });
      }
    }
  }

  return { tracks, vias, wasSuccessful: true, passesRun: -1 };
}
