import type { Track, Via, PcbBoard } from "../types";
import type { LayerId } from "../layers";
import { getBoardStackup, layerIdFromSesName } from "../stackup";
import { parseSexpr, child, children, type SList } from "../sexpr";
import { dsnNetName, viaDimensionsForName } from "./write-dsn";

export interface SesLayerUsage {
  segments: number;
  trackLengthNm: number;
}

export interface SesResult {
  tracks: Track[];
  vias: Via[];
  wasSuccessful: boolean;
  passesRun: number;
  layerUsage: Partial<Record<LayerId, SesLayerUsage>>;
  unknownLayers: string[];
  errors: string[];
}

/** A syntactically valid SES that is unsafe to apply to this board. */
export class SesImportError extends Error {
  constructor(public readonly result: SesResult) {
    super(result.errors.join(" "));
    this.name = "SesImportError";
  }
}

let idSeq = 0;
const idSalt = Math.random().toString(36).slice(2, 8);
function freshId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSalt}-${idSeq}`;
}

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

function trailingNumbers(list: SList, startIndex: number): number[] {
  const out: number[] = [];
  for (let i = startIndex; i < list.items.length; i++) {
    const item = list.items[i];
    if (item.kind === "number") out.push(item.value);
  }
  return out;
}

function sesNanometersPerCoordinate(routes: SList): number {
  const resolution = child(routes, "resolution");
  if (!resolution) return 1;
  const unit = atomText(resolution, 1)?.toLowerCase();
  const unitsPerCoordinate = atomNumber(resolution, 2) ?? 1;
  if (!(unitsPerCoordinate > 0)) return 1;
  const nanometersPerUnit: Record<string, number> = {
    nm: 1,
    um: 1_000,
    mm: 1_000_000,
    mil: 25_400,
    inch: 25_400_000,
  };
  const perUnit = unit ? nanometersPerUnit[unit] : undefined;
  return perUnit === undefined ? 1 : perUnit / unitsPerCoordinate;
}

function unsuccessful(message: string): SesResult {
  return {
    tracks: [],
    vias: [],
    wasSuccessful: false,
    passesRun: -1,
    layerUsage: {},
    unknownLayers: [],
    errors: [message],
  };
}

export function parseSes(sesText: string, board: PcbBoard): SesResult {
  const tracks: Track[] = [];
  const vias: Via[] = [];
  const layerUsage: SesResult["layerUsage"] = {};
  const unknownLayers = new Set<string>();
  const errors: string[] = [];

  const netIdByName = new Map<string, number>();
  for (const net of board.nets) {
    if (net.id !== 0) netIdByName.set(dsnNetName(net), net.id);
  }

  let root: SList;
  try {
    root = parseSexpr(sesText);
  } catch {
    return unsuccessful("SES is not valid S-expression syntax.");
  }
  const routes = child(root, "routes");
  if (!routes) return unsuccessful("SES contains no routes block.");
  const coordinateScale = sesNanometersPerCoordinate(routes);
  const enabledCopper = getBoardStackup(board).copperLayers
    .filter((layer) => layer.enabled)
    .sort((a, b) => a.order - b.order);
  if (enabledCopper.length < 2) return unsuccessful("The board stackup has fewer than two enabled copper layers.");
  const viaLayers: [LayerId, LayerId] = [enabledCopper[0].id, enabledCopper[enabledCopper.length - 1].id];

  for (const networkOut of children(routes, "network_out")) {
    for (const netList of children(networkOut, "net")) {
      const netName = atomText(netList, 1);
      const netId = netName != null ? netIdByName.get(netName) ?? 0 : 0;
      if (netId === 0) {
        errors.push(`SES references unknown or unconnected net ${netName ?? "<missing>"}.`);
        continue;
      }

      for (const wire of children(netList, "wire")) {
        const path = child(wire, "path");
        if (!path) continue;
        const layerName = atomText(path, 1);
        const layer = layerName ? layerIdFromSesName(board, layerName) : undefined;
        if (!layer) {
          unknownLayers.add(layerName ?? "<missing>");
          continue;
        }
        const width = atomNumber(path, 2);
        if (width == null || !(width > 0)) {
          errors.push(`SES wire on ${layerName} has an invalid width.`);
          continue;
        }
        const coords = trailingNumbers(path, 3);
        for (let i = 0; i + 3 < coords.length; i += 2) {
          const start = {
            x: Math.round(coords[i] * coordinateScale),
            y: Math.round(coords[i + 1] * coordinateScale),
          };
          const end = {
            x: Math.round(coords[i + 2] * coordinateScale),
            y: Math.round(coords[i + 3] * coordinateScale),
          };
          tracks.push({
            id: freshId("ar-t"),
            layer,
            width: Math.round(width * coordinateScale),
            start,
            end,
            netId,
            source: "autorouter",
          });
          const usage = layerUsage[layer] ?? { segments: 0, trackLengthNm: 0 };
          usage.segments += 1;
          usage.trackLengthNm += Math.hypot(end.x - start.x, end.y - start.y);
          layerUsage[layer] = usage;
        }
      }

      for (const viaNode of children(netList, "via")) {
        const padstackName = atomText(viaNode, 1);
        const x = atomNumber(viaNode, 2);
        const y = atomNumber(viaNode, 3);
        if (x == null || y == null) {
          errors.push(`SES via ${padstackName ?? "<missing>"} has invalid coordinates.`);
          continue;
        }
        const dims = padstackName ? viaDimensionsForName(padstackName) : undefined;
        if (!dims) {
          errors.push(`SES references unknown via padstack ${padstackName ?? "<missing>"}.`);
          continue;
        }
        vias.push({
          id: freshId("ar-v"),
          at: { x: Math.round(x * coordinateScale), y: Math.round(y * coordinateScale) },
          size: dims.sizeNm,
          drill: dims.drillNm,
          netId,
          layers: viaLayers,
          source: "autorouter",
        });
      }
    }
  }

  if (unknownLayers.size > 0) {
    errors.push(`SES references unknown or disabled copper layer(s): ${[...unknownLayers].join(", ")}.`);
  }
  const result: SesResult = {
    tracks,
    vias,
    wasSuccessful: errors.length === 0,
    passesRun: -1,
    layerUsage,
    unknownLayers: [...unknownLayers],
    errors,
  };
  if (errors.length > 0) throw new SesImportError(result);
  return result;
}
