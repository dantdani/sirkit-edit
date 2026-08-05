import type { Track, Via, PcbBoard } from "../types";
import type { LayerId } from "../layers";
import { pcbRevisionId } from "../revision";
import { stableHash } from "../smart-routing/hash";
import { parseSexpr, child, children, type SList, type SNode } from "../sexpr";
import type { DsnIntegrityManifest, DsnLayerName } from "./types";
import { boardToDsn } from "./write-dsn";

export interface SesLayerUsage {
  segments: number;
  trackLengthNm: number;
  viaAccessCount?: number;
  filledAreaNm2?: number;
  zoneIds?: string[];
  stableNetIds?: string[];
  fillStatuses?: string[];
}

export type SesDiagnosticCode =
  | "SES_FILE_EMPTY"
  | "SES_PARSE_FAILED"
  | "SES_ROUTES_MISSING"
  | "SES_RESOLUTION_MISSING"
  | "SES_UNIT_UNKNOWN"
  | "SES_COORDINATE_INVALID"
  | "SES_NET_UNKNOWN"
  | "SES_LAYER_UNKNOWN"
  | "SES_PADSTACK_UNKNOWN"
  | "SES_DUPLICATE_CONFLICT"
  | "SES_GEOMETRY_UNSUPPORTED"
  | "SES_EXPORT_MANIFEST_INVALID"
  | "STALE_ELECTRICAL_REPORT";

export interface SesDiagnostic {
  code: SesDiagnosticCode;
  message: string;
  netName?: string;
  layerName?: string;
  padstackName?: string;
}

export interface SesResult {
  schemaVersion: "sirkit.ses-import.v2";
  sourceRevision: string;
  routeAttemptId: string;
  phase: "file" | "parse" | "validation" | "candidate";
  coordinateUnit?: string;
  nanometersPerCoordinate?: number;
  tracks: Track[];
  vias: Via[];
  importedObjectIds: string[];
  deduplicatedSegments: number;
  wasSuccessful: boolean;
  passesRun: number;
  layerUsage: Partial<Record<LayerId, SesLayerUsage>>;
  unknownLayers: string[];
  diagnostics: SesDiagnostic[];
  errors: string[];
}

export interface ParseSesOptions {
  manifest?: DsnIntegrityManifest;
  routeAttemptId?: string;
  /** Expected DSN source revision. A mismatch is always rejected. */
  sourceRevision?: string;
}

/** A syntactically valid or malformed SES that is unsafe to apply to this board. */
export class SesImportError extends Error {
  constructor(public readonly result: SesResult) {
    super(result.errors.join(" "));
    this.name = "SesImportError";
  }
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
  for (let index = startIndex; index < list.items.length; index++) {
    const item = list.items[index];
    if (item.kind === "number") out.push(item.value);
  }
  return out;
}

function containsListHead(node: SNode, wanted: string): boolean {
  if (node.kind !== "list") return false;
  const head = node.items[0];
  if (head?.kind === "symbol" && head.value.toLowerCase() === wanted) return true;
  return node.items.some((item) => containsListHead(item, wanted));
}

function emptyResult(
  sourceRevision: string,
  routeAttemptId: string,
  phase: SesResult["phase"],
  diagnostics: SesDiagnostic[],
): SesResult {
  return {
    schemaVersion: "sirkit.ses-import.v2",
    sourceRevision,
    routeAttemptId,
    phase,
    tracks: [],
    vias: [],
    importedObjectIds: [],
    deduplicatedSegments: 0,
    wasSuccessful: false,
    passesRun: -1,
    layerUsage: {},
    unknownLayers: diagnostics.filter((item) => item.code === "SES_LAYER_UNKNOWN").map((item) => item.layerName ?? "<missing>"),
    diagnostics,
    errors: diagnostics.map((item) => item.message),
  };
}

function reject(
  sourceRevision: string,
  routeAttemptId: string,
  phase: SesResult["phase"],
  diagnostics: SesDiagnostic[],
): never {
  throw new SesImportError(emptyResult(sourceRevision, routeAttemptId, phase, diagnostics));
}

function coordinateResolution(
  routes: SList,
  sourceRevision: string,
  routeAttemptId: string,
): { unit: string; scale: number } {
  const resolution = child(routes, "resolution");
  if (!resolution) reject(sourceRevision, routeAttemptId, "validation", [{
    code: "SES_RESOLUTION_MISSING",
    message: "SES routes contain no coordinate resolution; coordinates cannot be interpreted safely.",
  }]);
  const rawUnit = atomText(resolution, 1)?.toLowerCase();
  const unitsPerCoordinate = atomNumber(resolution, 2);
  if (!rawUnit || unitsPerCoordinate == null || !Number.isFinite(unitsPerCoordinate) || unitsPerCoordinate <= 0) {
    reject(sourceRevision, routeAttemptId, "validation", [{
      code: "SES_RESOLUTION_MISSING",
      message: "SES coordinate resolution is missing or invalid.",
    }]);
  }
  const aliases: Record<string, string> = {
    "\u00b5m": "um", // micro sign
    "\u03bcm": "um", // Greek small letter mu
    micrometer: "um",
    micrometers: "um",
    in: "inch",
  };
  const unit = aliases[rawUnit] ?? rawUnit;
  const nanometersPerUnit: Record<string, number> = {
    nm: 1,
    um: 1_000,
    mm: 1_000_000,
    mil: 25_400,
    inch: 25_400_000,
  };
  const nanometers = nanometersPerUnit[unit];
  if (nanometers === undefined) reject(sourceRevision, routeAttemptId, "validation", [{
    code: "SES_UNIT_UNKNOWN",
    message: `SES coordinate unit '${rawUnit}' is unsupported; import was rejected instead of guessing.`,
  }]);
  return { unit, scale: nanometers / unitsPerCoordinate };
}

function scaledInteger(value: number, scale: number): number | undefined {
  const result = Math.round(value * scale);
  return Number.isFinite(value) && Number.isFinite(result) && Number.isSafeInteger(result) ? result : undefined;
}

function orderedEndpoints(start: { x: number; y: number }, end: { x: number; y: number }): string {
  const a = `${start.x},${start.y}`;
  const b = `${end.x},${end.y}`;
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

function deterministicObjectId(prefix: "ar-t" | "ar-v", attemptId: string, semanticKey: string): string {
  return `${prefix}-${stableHash(`${attemptId}\0${semanticKey}`)}`;
}

/**
 * Strict, all-or-nothing SES import. Every provider-specific name is resolved
 * through the exact DSN manifest that produced this route attempt.
 */
export function parseSes(sesText: string, board: PcbBoard, options: ParseSesOptions = {}): SesResult {
  const boardRevision = pcbRevisionId(board);
  const manifest = options.manifest ?? boardToDsn(board).integrity;
  const sourceRevision = options.sourceRevision ?? manifest?.sourceRevision ?? boardRevision;
  const routeAttemptId = options.routeAttemptId ?? `attempt-${stableHash(`${sourceRevision}\0${sesText}`)}`;
  if (!sesText.trim()) reject(sourceRevision, routeAttemptId, "file", [{
    code: "SES_FILE_EMPTY",
    message: "FreeRouting produced an empty or whitespace-only SES file.",
  }]);
  if (!manifest || manifest.schemaVersion !== "sirkit.dsn-integrity.v2") {
    reject(sourceRevision, routeAttemptId, "validation", [{
      code: "SES_EXPORT_MANIFEST_INVALID",
      message: "The matching DSN conservation manifest is absent or unsupported.",
    }]);
  }
  if (manifest.sourceRevision !== sourceRevision || boardRevision !== sourceRevision) {
    reject(sourceRevision, routeAttemptId, "validation", [{
      code: "STALE_ELECTRICAL_REPORT",
      message: `SES source revision ${sourceRevision} does not match the current board/export revision (${boardRevision}/${manifest.sourceRevision}).`,
    }]);
  }

  let root: SList;
  try {
    root = parseSexpr(sesText);
  } catch (error) {
    reject(sourceRevision, routeAttemptId, "parse", [{
      code: "SES_PARSE_FAILED",
      message: `SES is not valid S-expression syntax: ${error instanceof Error ? error.message : String(error)}`,
    }]);
  }
  const routes = child(root, "routes");
  if (!routes) reject(sourceRevision, routeAttemptId, "validation", [{
    code: "SES_ROUTES_MISSING",
    message: "SES contains no routes block.",
  }]);
  if (containsListHead(routes, "arc")) reject(sourceRevision, routeAttemptId, "validation", [{
    code: "SES_GEOMETRY_UNSUPPORTED",
    message: "SES contains arc geometry, which the native PCB track model cannot represent losslessly.",
  }]);
  const resolution = coordinateResolution(routes, sourceRevision, routeAttemptId);

  const diagnostics: SesDiagnostic[] = [];
  const tracks: Track[] = [];
  const vias: Via[] = [];
  const layerUsage: SesResult["layerUsage"] = {};
  let deduplicatedSegments = 0;

  const netIdByName = new Map<string, number>();
  for (const net of manifest.nets) {
    if (netIdByName.has(net.serializedName)) diagnostics.push({
      code: "SES_EXPORT_MANIFEST_INVALID",
      message: `DSN net name '${net.serializedName}' maps to multiple stable net identities.`,
      netName: net.serializedName,
    });
    netIdByName.set(net.serializedName, net.numericNetId);
  }
  const layerByName = new Map<DsnLayerName, LayerId>();
  for (const layer of manifest.layers) layerByName.set(layer.dsnName, layer.layerId as LayerId);
  const padstackByName = new Map(manifest.viaPadstacks.map((padstack) => [padstack.name, padstack]));
  const exactSegments = new Set<string>();
  const segmentContract = new Map<string, { netId: number; width: number }>();
  const exactVias = new Set<string>();
  const viaContract = new Map<string, { netId: number; padstackName: string }>();

  for (const networkOut of children(routes, "network_out")) {
    for (const netList of children(networkOut, "net")) {
      const netName = atomText(netList, 1) ?? "<missing>";
      const netId = netIdByName.get(netName);
      if (!netId) {
        diagnostics.push({ code: "SES_NET_UNKNOWN", message: `SES references unknown or unconnected net ${netName}.`, netName });
        continue;
      }
      for (const wire of children(netList, "wire")) {
        const path = child(wire, "path");
        if (!path) {
          diagnostics.push({ code: "SES_GEOMETRY_UNSUPPORTED", message: `SES wire on ${netName} contains no supported path.`, netName });
          continue;
        }
        const layerName = atomText(path, 1) as DsnLayerName | null;
        const layer = layerName ? layerByName.get(layerName) : undefined;
        if (!layer) {
          diagnostics.push({
            code: "SES_LAYER_UNKNOWN",
            message: `SES references unknown or disabled copper layer ${layerName ?? "<missing>"}.`,
            netName,
            layerName: layerName ?? "<missing>",
          });
          continue;
        }
        const rawWidth = atomNumber(path, 2);
        const width = rawWidth == null ? undefined : scaledInteger(rawWidth, resolution.scale);
        const coords = trailingNumbers(path, 3);
        if (!width || width <= 0 || coords.length < 4 || coords.length % 2 !== 0) {
          diagnostics.push({
            code: "SES_COORDINATE_INVALID",
            message: `SES wire on ${layerName} has an invalid width or coordinate sequence.`,
            netName,
            layerName: layerName ?? undefined,
          });
          continue;
        }
        for (let index = 0; index + 3 < coords.length; index += 2) {
          const values = coords.slice(index, index + 4).map((value) => scaledInteger(value, resolution.scale));
          if (values.some((value) => value === undefined)) {
            diagnostics.push({ code: "SES_COORDINATE_INVALID", message: `SES wire on ${layerName} contains a non-finite or unsafe coordinate.`, netName, layerName: layerName ?? undefined });
            continue;
          }
          const [x1, y1, x2, y2] = values as number[];
          const start = { x: x1, y: y1 };
          const end = { x: x2, y: y2 };
          if (start.x === end.x && start.y === end.y) {
            diagnostics.push({ code: "SES_COORDINATE_INVALID", message: `SES wire on ${layerName} contains a zero-length segment.`, netName, layerName: layerName ?? undefined });
            continue;
          }
          const endpoints = orderedEndpoints(start, end);
          const topologyKey = `${layer}\0${endpoints}`;
          const prior = segmentContract.get(topologyKey);
          if (prior && (prior.netId !== netId || prior.width !== width)) {
            diagnostics.push({ code: "SES_DUPLICATE_CONFLICT", message: `SES repeats segment ${endpoints} on ${layerName} with conflicting net or width.`, netName, layerName: layerName ?? undefined });
            continue;
          }
          const exactKey = `${topologyKey}\0${netId}\0${width}`;
          if (exactSegments.has(exactKey)) {
            deduplicatedSegments += 1;
            continue;
          }
          exactSegments.add(exactKey);
          segmentContract.set(topologyKey, { netId, width });
          tracks.push({
            id: deterministicObjectId("ar-t", routeAttemptId, exactKey),
            layer,
            width,
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
        const padstackName = atomText(viaNode, 1) ?? "<missing>";
        const padstack = padstackByName.get(padstackName);
        const rawX = atomNumber(viaNode, 2);
        const rawY = atomNumber(viaNode, 3);
        const x = rawX == null ? undefined : scaledInteger(rawX, resolution.scale);
        const y = rawY == null ? undefined : scaledInteger(rawY, resolution.scale);
        if (!padstack) {
          diagnostics.push({ code: "SES_PADSTACK_UNKNOWN", message: `SES references unknown via padstack ${padstackName}.`, netName, padstackName });
          continue;
        }
        if (x === undefined || y === undefined) {
          diagnostics.push({ code: "SES_COORDINATE_INVALID", message: `SES via ${padstackName} has invalid coordinates.`, netName, padstackName });
          continue;
        }
        const layers = padstack.onLayers.map((name) => layerByName.get(name)).filter((item): item is LayerId => Boolean(item));
        if (layers.length !== padstack.onLayers.length || layers.length < 2) {
          diagnostics.push({ code: "SES_PADSTACK_UNKNOWN", message: `SES via padstack ${padstackName} has an invalid layer span in the export manifest.`, netName, padstackName });
          continue;
        }
        const positionKey = `${x},${y}`;
        const prior = viaContract.get(positionKey);
        if (prior && (prior.netId !== netId || prior.padstackName !== padstackName)) {
          diagnostics.push({ code: "SES_DUPLICATE_CONFLICT", message: `SES repeats via ${positionKey} with conflicting net or padstack.`, netName, padstackName });
          continue;
        }
        const exactKey = `${positionKey}\0${netId}\0${padstackName}`;
        if (exactVias.has(exactKey)) continue;
        exactVias.add(exactKey);
        viaContract.set(positionKey, { netId, padstackName });
        vias.push({
          id: deterministicObjectId("ar-v", routeAttemptId, exactKey),
          at: { x, y },
          size: padstack.diameterNm,
          drill: padstack.drillNm,
          netId,
          layers: [layers[0], layers[layers.length - 1]],
          source: "autorouter",
        });
      }
    }
  }

  if (diagnostics.length > 0) {
    const failed = emptyResult(sourceRevision, routeAttemptId, "validation", diagnostics);
    failed.coordinateUnit = resolution.unit;
    failed.nanometersPerCoordinate = resolution.scale;
    failed.deduplicatedSegments = deduplicatedSegments;
    throw new SesImportError(failed);
  }
  const importedObjectIds = [...tracks.map((track) => track.id), ...vias.map((via) => via.id)].sort();
  return {
    schemaVersion: "sirkit.ses-import.v2",
    sourceRevision,
    routeAttemptId,
    phase: "candidate",
    coordinateUnit: resolution.unit,
    nanometersPerCoordinate: resolution.scale,
    tracks,
    vias,
    importedObjectIds,
    deduplicatedSegments,
    wasSuccessful: true,
    passesRun: -1,
    layerUsage,
    unknownLayers: [],
    diagnostics: [],
    errors: [],
  };
}
