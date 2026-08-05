import type { BBox } from "../pcb/geometry";
import type { LayerId } from "../pcb/layers";
import type { PcbBoard, Track, Via, Zone } from "../pcb/types";
import { markZoneFillDirty } from "../pcb/zones/fill-lifecycle";
import { computeProjectRevision, flagsForRevisionDelta, semanticStateDigest } from "./revision";
import { engineeringDigest, objectVersion } from "./stable";
import type { CanonicalProjectState, EngineeringChangeSet, EngineeringOperation, ProjectRevision } from "./types";

interface ObjectEntry { key: string; kind: string; id: string; value: unknown; netIds: number[]; layers: LayerId[]; boundsByLayer: Partial<Record<LayerId, BBox[]>> }

function pointBounds(x: number, y: number, radius = 0): BBox { return { minX: x - radius, minY: y - radius, maxX: x + radius, maxY: y + radius }; }
function trackBounds(track: Track): BBox { const r = Math.ceil(track.width / 2); return { minX: Math.min(track.start.x, track.end.x) - r, minY: Math.min(track.start.y, track.end.y) - r, maxX: Math.max(track.start.x, track.end.x) + r, maxY: Math.max(track.start.y, track.end.y) + r }; }
function zoneBounds(zone: Zone): BBox { return { minX: Math.min(...zone.polygon.map((p) => p.x)), minY: Math.min(...zone.polygon.map((p) => p.y)), maxX: Math.max(...zone.polygon.map((p) => p.x)), maxY: Math.max(...zone.polygon.map((p) => p.y)) }; }
function viaLayers(via: Via): LayerId[] { return [...new Set(via.layers)]; }

function objectEntries(project: CanonicalProjectState): Map<string, ObjectEntry> {
  const board = project.pcb; const entries = new Map<string, ObjectEntry>();
  for (const item of board.footprints) { const layer: LayerId = item.side === "bottom" ? "copperBottom" : "copperTop"; entries.set(`footprint:${item.id}`, { key: `footprint:${item.id}`, kind: "footprint", id: item.id, value: item, netIds: [...new Set(Object.values(item.padNets))], layers: [layer], boundsByLayer: { [layer]: [pointBounds(item.at.x, item.at.y)] } }); }
  for (const item of board.tracks) entries.set(`track:${item.id}`, { key: `track:${item.id}`, kind: "track", id: item.id, value: item, netIds: [item.netId], layers: [item.layer], boundsByLayer: { [item.layer]: [trackBounds(item)] } });
  for (const item of board.vias) entries.set(`via:${item.id}`, { key: `via:${item.id}`, kind: "via", id: item.id, value: item, netIds: [item.netId], layers: viaLayers(item), boundsByLayer: Object.fromEntries(viaLayers(item).map((layer) => [layer, [pointBounds(item.at.x, item.at.y, Math.ceil(item.size / 2))]])) });
  for (const item of board.zones) entries.set(`zone:${item.id}`, { key: `zone:${item.id}`, kind: "zone", id: item.id, value: item, netIds: [item.netId], layers: [item.layer], boundsByLayer: { [item.layer]: [zoneBounds(item)] } });
  for (const item of board.nets) entries.set(`net:${item.id}`, { key: `net:${item.id}`, kind: "net", id: String(item.id), value: item, netIds: [item.id], layers: [], boundsByLayer: {} });
  for (const asset of project.pinnedAssets) entries.set(`asset:${asset.assetId}`, { key: `asset:${asset.assetId}`, kind: "asset", id: asset.assetId, value: asset, netIds: [], layers: [], boundsByLayer: {} });
  entries.set("board:outline", { key: "board:outline", kind: "outline", id: "outline", value: board.outline, netIds: [], layers: [], boundsByLayer: {} });
  entries.set("board:routing-preferences", { key: "board:routing-preferences", kind: "routing_preferences", id: "routing-preferences", value: board.routingPreferences, netIds: [], layers: [], boundsByLayer: {} });
  return entries;
}

function assertIntegerGeometry(value: unknown, path = "operation"): void {
  if (typeof value === "number" && (!Number.isFinite(value) || !Number.isInteger(value))) throw new Error(`INVALID_NM:${path}`);
  if (Array.isArray(value)) value.forEach((item, index) => assertIntegerGeometry(item, `${path}[${index}]`));
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value as Record<string, unknown>)) if (!key.toLowerCase().includes("rotation") && !key.toLowerCase().includes("ratio")) assertIntegerGeometry(child, `${path}.${key}`);
}

function checkExpected(value: unknown, expected: string | undefined, target: string): void {
  if (expected && objectVersion(value) !== expected) throw new Error(`OBJECT_VERSION_MISMATCH:${target}`);
}

function requireNet(board: PcbBoard, netId: number): void { if (!board.nets.some((net) => net.id === netId)) throw new Error(`UNKNOWN_NET:${netId}`); }
function requireUnlocked(value: { locked?: boolean }, target: string, operation: EngineeringOperation): void { if (value.locked && operation.kind !== "set_footprint_protection") throw new Error(`PROTECTED_OBJECT:${target}`); }

function markAffectedZones(board: PcbBoard, layers: readonly LayerId[], reason: string): void {
  for (const zone of board.zones) if (!layers.length || layers.includes(zone.layer)) markZoneFillDirty(zone, reason);
}

export interface AppliedOperations { project: CanonicalProjectState; inverseOperations: EngineeringOperation[] }

export function applyEngineeringOperations(source: CanonicalProjectState, operations: readonly EngineeringOperation[]): AppliedOperations {
  const project = structuredClone(source); const board = project.pcb; const inverse: EngineeringOperation[] = []; const seen = new Set<string>();
  for (const operation of operations) {
    if (seen.has(operation.operationId)) throw new Error(`DUPLICATE_OPERATION_ID:${operation.operationId}`); seen.add(operation.operationId);
    assertIntegerGeometry(operation);
    if (operation.units !== "nm" || operation.schemaVersion !== 1) throw new Error(`UNSUPPORTED_OPERATION_SCHEMA:${operation.operationId}`);
    if (operation.kind === "move_footprint") {
      const item = board.footprints.find((candidate) => candidate.id === operation.footprintId); if (!item) throw new Error(`OBJECT_NOT_FOUND:footprint:${operation.footprintId}`);
      checkExpected(item, operation.expectedObjectVersion, `footprint:${item.id}`); requireUnlocked(item, `footprint:${item.id}`, operation);
      inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "move_footprint", footprintId: item.id, at: structuredClone(item.at), rotationDeg: item.rotationDeg, side: item.side });
      item.at = structuredClone(operation.at); if (operation.rotationDeg !== undefined) item.rotationDeg = operation.rotationDeg; if (operation.side !== undefined) item.side = operation.side; markAffectedZones(board, [], operation.operationId);
    } else if (operation.kind === "set_footprint_protection") {
      const item = board.footprints.find((candidate) => candidate.id === operation.footprintId); if (!item) throw new Error(`OBJECT_NOT_FOUND:footprint:${operation.footprintId}`); checkExpected(item, operation.expectedObjectVersion, `footprint:${item.id}`);
      inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "set_footprint_protection", footprintId: item.id, locked: Boolean(item.locked) }); item.locked = operation.locked;
    } else if (operation.kind === "add_track") {
      if (board.tracks.some((item) => item.id === operation.track.id)) throw new Error(`ID_REUSE:track:${operation.track.id}`); requireNet(board, operation.track.netId); if (operation.track.width <= 0 || (operation.track.start.x === operation.track.end.x && operation.track.start.y === operation.track.end.y)) throw new Error(`INVALID_TRACK:${operation.track.id}`);
      board.tracks.push(structuredClone(operation.track)); inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "remove_track", trackId: operation.track.id }); markAffectedZones(board, [operation.track.layer], operation.operationId);
    } else if (operation.kind === "update_track" || operation.kind === "remove_track") {
      const index = board.tracks.findIndex((item) => item.id === operation.trackId); if (index < 0) throw new Error(`OBJECT_NOT_FOUND:track:${operation.trackId}`); const item = board.tracks[index]; checkExpected(item, operation.expectedObjectVersion, `track:${item.id}`); requireUnlocked(item, `track:${item.id}`, operation);
      inverse.unshift(operation.kind === "remove_track" ? { operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "add_track", track: structuredClone(item) } : { operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "update_track", trackId: item.id, patch: structuredClone(item) });
      if (operation.kind === "remove_track") board.tracks.splice(index, 1); else { if (operation.patch.netId !== undefined) requireNet(board, operation.patch.netId); Object.assign(item, structuredClone(operation.patch)); if (item.width <= 0 || (item.start.x === item.end.x && item.start.y === item.end.y)) throw new Error(`INVALID_TRACK:${item.id}`); }
      markAffectedZones(board, [...new Set([item.layer, ...(operation.kind === "update_track" && operation.patch.layer ? [operation.patch.layer] : [])])], operation.operationId);
    } else if (operation.kind === "add_via") {
      if (board.vias.some((item) => item.id === operation.via.id)) throw new Error(`ID_REUSE:via:${operation.via.id}`); requireNet(board, operation.via.netId); if (operation.via.size <= 0 || operation.via.drill <= 0 || operation.via.drill >= operation.via.size) throw new Error(`INVALID_VIA:${operation.via.id}`);
      board.vias.push(structuredClone(operation.via)); inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "remove_via", viaId: operation.via.id }); markAffectedZones(board, viaLayers(operation.via), operation.operationId);
    } else if (operation.kind === "update_via" || operation.kind === "remove_via") {
      const index = board.vias.findIndex((item) => item.id === operation.viaId); if (index < 0) throw new Error(`OBJECT_NOT_FOUND:via:${operation.viaId}`); const item = board.vias[index]; checkExpected(item, operation.expectedObjectVersion, `via:${item.id}`); requireUnlocked(item, `via:${item.id}`, operation); const oldLayers = viaLayers(item);
      inverse.unshift(operation.kind === "remove_via" ? { operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "add_via", via: structuredClone(item) } : { operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "update_via", viaId: item.id, patch: structuredClone(item) });
      if (operation.kind === "remove_via") board.vias.splice(index, 1); else { if (operation.patch.netId !== undefined) requireNet(board, operation.patch.netId); Object.assign(item, structuredClone(operation.patch)); if (item.size <= 0 || item.drill <= 0 || item.drill >= item.size) throw new Error(`INVALID_VIA:${item.id}`); }
      markAffectedZones(board, [...new Set([...oldLayers, ...(operation.kind === "update_via" && operation.patch.layers ? operation.patch.layers : [])])], operation.operationId);
    } else if (operation.kind === "add_zone") {
      if (board.zones.some((item) => item.id === operation.zone.id)) throw new Error(`ID_REUSE:zone:${operation.zone.id}`); requireNet(board, operation.zone.netId); if (operation.zone.polygon.length < 3) throw new Error(`INVALID_ZONE:${operation.zone.id}`); const zone = structuredClone(operation.zone); markZoneFillDirty(zone, operation.operationId); board.zones.push(zone); inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "remove_zone", zoneId: zone.id });
    } else if (operation.kind === "update_zone" || operation.kind === "remove_zone") {
      const index = board.zones.findIndex((item) => item.id === operation.zoneId); if (index < 0) throw new Error(`OBJECT_NOT_FOUND:zone:${operation.zoneId}`); const item = board.zones[index]; checkExpected(item, operation.expectedObjectVersion, `zone:${item.id}`); requireUnlocked(item, `zone:${item.id}`, operation);
      inverse.unshift(operation.kind === "remove_zone" ? { operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "add_zone", zone: structuredClone(item) } : { operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "update_zone", zoneId: item.id, patch: structuredClone(item) });
      if (operation.kind === "remove_zone") board.zones.splice(index, 1); else { if (operation.patch.netId !== undefined) requireNet(board, operation.patch.netId); Object.assign(item, structuredClone(operation.patch)); if (item.polygon.length < 3) throw new Error(`INVALID_ZONE:${item.id}`); markZoneFillDirty(item, operation.operationId); }
    } else if (operation.kind === "update_board_outline") {
      inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "update_board_outline", outline: structuredClone(board.outline) }); board.outline = structuredClone(operation.outline); markAffectedZones(board, [], operation.operationId);
    } else if (operation.kind === "update_routing_preferences") {
      inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "update_routing_preferences", preferences: structuredClone(board.routingPreferences ?? { version: 1, trackWidthMode: "net-class", viaMode: "net-class" }) }); board.routingPreferences = structuredClone(operation.preferences);
    } else if (operation.kind === "update_net") {
      const item = board.nets.find((net) => net.id === operation.netId); if (!item) throw new Error(`OBJECT_NOT_FOUND:net:${operation.netId}`); checkExpected(item, operation.expectedObjectVersion, `net:${item.id}`); inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "update_net", netId: item.id, patch: { name: item.name, endpointKeys: structuredClone(item.endpointKeys ?? []) } }); Object.assign(item, structuredClone(operation.patch)); if (item.endpointKeys) item.endpointKeys = [...new Set(item.endpointKeys)].sort();
    } else if (operation.kind === "pin_asset") {
      if (project.pinnedAssets.some((asset) => asset.assetId === operation.asset.assetId)) throw new Error(`ID_REUSE:asset:${operation.asset.assetId}`); if (!operation.asset.contentDigest) throw new Error(`ASSET_DIGEST_REQUIRED:${operation.asset.assetId}`); project.pinnedAssets.push(structuredClone(operation.asset)); inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "remove_pinned_asset", assetId: operation.asset.assetId });
    } else if (operation.kind === "remove_pinned_asset") {
      const index = project.pinnedAssets.findIndex((asset) => asset.assetId === operation.assetId); if (index < 0) throw new Error(`OBJECT_NOT_FOUND:asset:${operation.assetId}`); const asset = project.pinnedAssets[index]; if (asset.required) throw new Error(`REQUIRED_ASSET_CANNOT_BE_REMOVED:${asset.assetId}`); project.pinnedAssets.splice(index, 1); inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "pin_asset", asset: structuredClone(asset) });
    }
  }
  return { project, inverseOperations: inverse };
}

function addBounds(target: Partial<Record<LayerId, BBox[]>>, source: Partial<Record<LayerId, BBox[]>>): void { for (const [layer, bounds] of Object.entries(source) as Array<[LayerId, BBox[]]>) (target[layer] ??= []).push(...bounds); }

export function deriveEngineeringChangeSet(beforeProject: CanonicalProjectState, afterProject: CanonicalProjectState, baseRevision: ProjectRevision, transactionId: string): EngineeringChangeSet {
  const resultRevision = computeProjectRevision(afterProject, baseRevision.headSequence + 1, transactionId); const before = objectEntries(beforeProject); const after = objectEntries(afterProject);
  const createdIdsByKind: Record<string, string[]> = {}; const updatedIdsByKind: Record<string, string[]> = {}; const deletedIdsByKind: Record<string, string[]> = {}; const versions: EngineeringChangeSet["beforeAfterObjectVersions"] = [];
  const netIds = new Set<number>(); const layers = new Set<LayerId>(); const zones = new Set<string>(); const beforeBounds: EngineeringChangeSet["beforeBoundsByLayer"] = {}; const afterBounds: EngineeringChangeSet["afterBoundsByLayer"] = {};
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const left = before.get(key); const right = after.get(key); const leftVersion = left ? objectVersion(left.value) : undefined; const rightVersion = right ? objectVersion(right.value) : undefined; if (leftVersion === rightVersion) continue;
    const entry = right ?? left!; const collection = right && !left ? createdIdsByKind : left && !right ? deletedIdsByKind : updatedIdsByKind; (collection[entry.kind] ??= []).push(entry.id); versions.push({ objectId: key, ...(leftVersion ? { before: leftVersion } : {}), ...(rightVersion ? { after: rightVersion } : {}) });
    for (const id of [...(left?.netIds ?? []), ...(right?.netIds ?? [])]) netIds.add(id); for (const layer of [...(left?.layers ?? []), ...(right?.layers ?? [])]) layers.add(layer); if (entry.kind === "zone") zones.add(entry.id); if (left) addBounds(beforeBounds, left.boundsByLayer); if (right) addBounds(afterBounds, right.boundsByLayer);
  }
  const dependencyKeys = new Set<string>();
  for (const domain of Object.keys(baseRevision.domainRevisions) as Array<keyof ProjectRevision["domainRevisions"]>) if (baseRevision.domainRevisions[domain] !== resultRevision.domainRevisions[domain]) dependencyKeys.add(`source:${domain}`);
  for (const id of netIds) dependencyKeys.add(`net:${id}`); for (const layer of layers) dependencyKeys.add(`layer:${layer}`); for (const version of versions) dependencyKeys.add(`object:${version.objectId}`);
  const flags = flagsForRevisionDelta(baseRevision, resultRevision);
  return { schemaVersion: "sirkit.engineering-changeset.v1", transactionId, baseRevision, resultRevision, baseSemanticStateDigest: semanticStateDigest(beforeProject), resultSemanticStateDigest: semanticStateDigest(afterProject), createdIdsByKind, updatedIdsByKind, deletedIdsByKind, beforeAfterObjectVersions: versions, affectedNetIds: [...netIds].sort((a, b) => a - b), affectedTerminalIds: [], affectedTopologyIds: versions.filter((item) => /track|via|zone/.test(item.objectId)).map((item) => item.objectId).sort(), affectedConstraintIds: [], affectedComponentRevisionIds: versions.filter((item) => item.objectId.startsWith("asset:") || item.objectId.startsWith("footprint:")).map((item) => item.objectId).sort(), affectedLayers: [...layers].sort(), beforeBoundsByLayer: beforeBounds, afterBoundsByLayer: afterBounds, affectedZones: [...zones].sort(), affectedStackupRanges: [], affectedEvidenceKinds: flags.includes("readiness_dependency_changed") ? ["pcb_fabrication_readiness"] : [], semanticImpactFlags: flags, dependencyKeys: [...dependencyKeys].sort() };
}

export function structuralChangeDigest(changeSet: EngineeringChangeSet): string { return engineeringDigest({ created: changeSet.createdIdsByKind, updated: changeSet.updatedIdsByKind, deleted: changeSet.deletedIdsByKind, versions: changeSet.beforeAfterObjectVersions, domains: changeSet.semanticImpactFlags }); }
