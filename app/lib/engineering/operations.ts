import type { BBox } from "../pcb/geometry";
import type { LayerId } from "../pcb/layers";
import type { PcbBoard, Track, Via, Zone } from "../pcb/types";
import { ROOT_SHEET_ID, refDesKey } from "@/lib/schematic-types";
import { railJoinKeys } from "@/app/lib/schematic/project-connectivity";
import { sheetOf } from "@/app/lib/schematic/sheets";
import { markZoneFillDirty } from "../pcb/zones/fill-lifecycle";
import { validateBoardDimension, validatePcbBoardStructure } from "./pcb-board-structure";
import { computeProjectRevision, flagsForRevisionDelta, semanticStateDigest } from "./revision";
import { validateSchematicPoint, validateSchematicRotation, validateSchematicWireVertices } from "./schematic-geometry";
import { CANONICAL_SCHEMATIC_SCHEMA, CANONICAL_SCHEMATIC_SCHEMA_V2, fromCanonicalSchematic, parseCanonicalSchematic, validateCanonicalSchematic, type CanonicalSchematic } from "./schematic-model";
import { engineeringDigest, objectVersion } from "./stable";
import type { CanonicalProjectState, EngineeringChangeSet, EngineeringOperation, ProjectRevision } from "./types";

const SCHEMATIC_OPERATION_KINDS = new Set<EngineeringOperation["kind"]>([
  "schematic_delete_component", "schematic_restore_entities", "schematic_replace_component",
  "schematic_set_component_properties", "schematic_transform_component",
  // B07 — canonical graph operations.
  "schematic_add_wire", "schematic_delete_wire", "schematic_update_wire_geometry",
  "schematic_add_net_label", "schematic_delete_net_label", "schematic_update_net_label",
  "schematic_add_component",
  // [PR-J, 2026-10-22] canonical sheet operations (runbook J, OD-255).
  "schematic_create_sheet", "schematic_delete_sheet", "schematic_rename_sheet", "schematic_reorder_sheets",
  "schematic_add_sheet_port", "schematic_remove_sheet_port", "schematic_add_sheet_pin", "schematic_remove_sheet_pin",
  "schematic_set_label_scope", "schematic_assign_sheet",
]);

/** [PR-J, 2026-10-22] The sheet operations: a batch holding one is refused when it would join two different rail / isolation
 *  domains that were not joined before it (OD-255 item 4). */
export const SHEET_OPERATION_KINDS = new Set<EngineeringOperation["kind"]>([
  "schematic_create_sheet", "schematic_delete_sheet", "schematic_rename_sheet", "schematic_reorder_sheets",
  "schematic_add_sheet_port", "schematic_remove_sheet_port", "schematic_add_sheet_pin", "schematic_remove_sheet_pin",
  "schematic_set_label_scope", "schematic_assign_sheet",
]);

/** Schematic ops require the typed canonical model — never guessed from opaque state. */
function requireCanonicalSchematic(project: CanonicalProjectState): CanonicalSchematic {
  const parsed = parseCanonicalSchematic(project.schematic);
  if (!parsed) throw new Error("SCHEMATIC_MODEL_UNAVAILABLE");
  return parsed;
}

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
  // B08 — annotation, padstack, keepout, and dimension collections
  // participate in change-set identity (affected objects, invalidation).
  for (const item of board.texts) entries.set(`text:${item.id}`, { key: `text:${item.id}`, kind: "text", id: item.id, value: item, netIds: [], layers: [item.layer], boundsByLayer: {} });
  for (const item of board.silkItems ?? []) entries.set(`silk:${item.id}`, { key: `silk:${item.id}`, kind: "silk", id: item.id, value: item, netIds: [], layers: [item.layer], boundsByLayer: {} });
  for (const item of board.padstacks ?? []) entries.set(`padstack:${item.id}`, { key: `padstack:${item.id}`, kind: "padstack", id: item.id, value: item, netIds: [], layers: [], boundsByLayer: {} });
  for (const item of board.routingKeepouts ?? []) entries.set(`keepout:${item.id}`, { key: `keepout:${item.id}`, kind: "keepout", id: item.id, value: item, netIds: [], layers: [...item.layers], boundsByLayer: {} });
  for (const item of board.dimensions ?? []) entries.set(`dimension:${item.id}`, { key: `dimension:${item.id}`, kind: "dimension", id: item.id, value: item, netIds: [], layers: [], boundsByLayer: {} });
  for (const asset of project.pinnedAssets) entries.set(`asset:${asset.assetId}`, { key: `asset:${asset.assetId}`, kind: "asset", id: asset.assetId, value: asset, netIds: [], layers: [], boundsByLayer: {} });
  entries.set("board:outline", { key: "board:outline", kind: "outline", id: "outline", value: board.outline, netIds: [], layers: [], boundsByLayer: {} });
  entries.set("board:routing-preferences", { key: "board:routing-preferences", kind: "routing_preferences", id: "routing-preferences", value: board.routingPreferences, netIds: [], layers: [], boundsByLayer: {} });
  // B08 — settings singletons.
  entries.set("board:stackup", { key: "board:stackup", kind: "stackup", id: "stackup", value: { stackup: board.stackup, stackupConfig: board.stackupConfig }, netIds: [], layers: [], boundsByLayer: {} });
  entries.set("board:net-classing", { key: "board:net-classing", kind: "net_classing", id: "net-classing", value: board.netClassing, netIds: [], layers: [], boundsByLayer: {} });
  entries.set("board:constraint-state", { key: "board:constraint-state", kind: "constraint_state", id: "constraint-state", value: board.constraintState, netIds: [], layers: [], boundsByLayer: {} });
  entries.set("board:placement-settings", { key: "board:placement-settings", kind: "placement_settings", id: "placement-settings", value: { placementPreferences: board.placementPreferences, placementPolicy: board.placementPolicy }, netIds: [], layers: [], boundsByLayer: {} });
  entries.set("board:routing-history", { key: "board:routing-history", kind: "routing_history", id: "routing-history", value: board.routingHistory, netIds: [], layers: [], boundsByLayer: {} });
  // B06: schematic entities participate in change-set identity when the
  // canonical model is present (opaque legacy schematics stay domain-level).
  const schematic = parseCanonicalSchematic(project.schematic);
  if (schematic) {
    for (const item of schematic.components) entries.set(`schcomp:${item.id}`, { key: `schcomp:${item.id}`, kind: "schematic-component", id: item.id, value: item, netIds: [], layers: [], boundsByLayer: {} });
    for (const item of schematic.kicadComponents) entries.set(`schcomp:${item.id}`, { key: `schcomp:${item.id}`, kind: "schematic-component", id: item.id, value: item, netIds: [], layers: [], boundsByLayer: {} });
    for (const item of schematic.wires) entries.set(`schwire:${item.id}`, { key: `schwire:${item.id}`, kind: "schematic-wire", id: item.id, value: item, netIds: [], layers: [], boundsByLayer: {} });
    for (const item of schematic.netLabels) entries.set(`schlabel:${item.id}`, { key: `schlabel:${item.id}`, kind: "schematic-label", id: item.id, value: item, netIds: [], layers: [], boundsByLayer: {} });
    // [PR-J, 2026-10-22] each sheet (with its ports) and the sheet order are change-set objects; a single-sheet document has none.
    if (schematic.sheets) {
      for (const item of schematic.sheets.sheets) entries.set(`schsheet:${item.id}`, { key: `schsheet:${item.id}`, kind: "schematic-sheet", id: item.id, value: item, netIds: [], layers: [], boundsByLayer: {} });
      entries.set("schsheets:order", { key: "schsheets:order", kind: "schematic-sheet-order", id: "order", value: schematic.sheets.sheets.map((item) => item.id), netIds: [], layers: [], boundsByLayer: {} });
    }
  }
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

/** B08 — protection state changes are their OWN authorized operations
 *  (manage_protection) and are exempt from the locked-object guard, so a
 *  protection inverse can never self-block. Every other mutation of a
 *  locked object is refused. */
const PROTECTION_OPERATION_KINDS = new Set<EngineeringOperation["kind"]>(["set_footprint_protection", "set_copper_protection"]);
function requireUnlocked(value: { locked?: boolean }, target: string, operation: EngineeringOperation): void { if (value.locked && !PROTECTION_OPERATION_KINDS.has(operation.kind)) throw new Error(`PROTECTED_OBJECT:${target}`); }

/** B08 — settings payload operations carry non-geometry values (floats such
 *  as envelopeScale or boardThicknessMm are legitimate); the integer-nm
 *  geometry walker applies only to geometry-bearing operations. */
const SETTINGS_OPERATION_KINDS = new Set<EngineeringOperation["kind"]>([
  "update_stackup", "update_net_classing", "update_constraint_state", "update_placement_settings", "update_routing_history", "update_routing_preferences",
]);

function markAffectedZones(board: PcbBoard, layers: readonly LayerId[], reason: string): void {
  for (const zone of board.zones) if (!layers.length || layers.includes(zone.layer)) markZoneFillDirty(zone, reason);
}

export interface AppliedOperations { project: CanonicalProjectState; inverseOperations: EngineeringOperation[] }

export function applyEngineeringOperations(source: CanonicalProjectState, operations: readonly EngineeringOperation[]): AppliedOperations {
  const project = structuredClone(source); const board = project.pcb; const inverse: EngineeringOperation[] = []; const seen = new Set<string>();
  // [PR-J, 2026-10-22] OD-255 item 4: the rail / isolation-domain joins present before a batch that holds a sheet operation.
  const railJoinsBefore = operations.some((operation) => SHEET_OPERATION_KINDS.has(operation.kind)) ? schematicRailJoins(source.schematic) : null;
  let schematicTouched = false;
  let boardTouched = false;
  for (const operation of operations) {
    if (seen.has(operation.operationId)) throw new Error(`DUPLICATE_OPERATION_ID:${operation.operationId}`); seen.add(operation.operationId);
    const requiredUnits = SCHEMATIC_OPERATION_KINDS.has(operation.kind) ? "px" : "nm";
    if (operation.units !== requiredUnits || operation.schemaVersion !== 1) throw new Error(`UNSUPPORTED_OPERATION_SCHEMA:${operation.operationId}`);
    if (SCHEMATIC_OPERATION_KINDS.has(operation.kind)) {
      // B07.1: schematic operations validate against the SCHEMATIC geometry
      // contract (finite, safe-integer, 10px-grid-aligned, bounded — with
      // truthful INVALID_PX codes), never the board's nm walker. The
      // executor rejects off-grid untrusted operations; it never snaps.
      const geometryIssues = validateSchematicOperationGeometry(operation);
      if (geometryIssues.length > 0) throw new Error(geometryIssues[0]);
      applySchematicOperation(project, operation, inverse);
      schematicTouched = true;
      continue;
    }
    boardTouched = boardTouched || operation.kind !== "pin_asset" && operation.kind !== "remove_pinned_asset";
    if (!SETTINGS_OPERATION_KINDS.has(operation.kind)) assertIntegerGeometry(operation);
    if (applyB08PcbOperation(board, operation, inverse)) {
      // handled by the B08 collection/settings dispatch
    } else if (operation.kind === "move_footprint") {
      const item = board.footprints.find((candidate) => candidate.id === operation.footprintId); if (!item) throw new Error(`OBJECT_NOT_FOUND:footprint:${operation.footprintId}`);
      checkExpected(item, operation.expectedObjectVersion, `footprint:${item.id}`); requireUnlocked(item, `footprint:${item.id}`, operation);
      inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "move_footprint", footprintId: item.id, at: structuredClone(item.at), rotationDeg: item.rotationDeg, side: item.side });
      item.at = structuredClone(operation.at); if (operation.rotationDeg !== undefined) item.rotationDeg = operation.rotationDeg; if (operation.side !== undefined) item.side = operation.side; markAffectedZones(board, [], operation.operationId);
    } else if (operation.kind === "set_footprint_protection") {
      const item = board.footprints.find((candidate) => candidate.id === operation.footprintId); if (!item) throw new Error(`OBJECT_NOT_FOUND:footprint:${operation.footprintId}`); checkExpected(item, operation.expectedObjectVersion, `footprint:${item.id}`);
      inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "set_footprint_protection", footprintId: item.id, locked: Boolean(item.locked) });
      // B08 — absence = unlocked, digest-exact with legacy boards.
      if (operation.locked) item.locked = true; else delete item.locked;
    } else if (operation.kind === "update_board_outline") {
      inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "update_board_outline", outline: structuredClone(board.outline) }); board.outline = structuredClone(operation.outline); markAffectedZones(board, [], operation.operationId);
    } else if (operation.kind === "update_routing_preferences") {
      // B08 — exact snapshot semantics: null = the field is ABSENT, so the
      // inverse restores presence/absence digest-exactly (the old default-
      // fabricating inverse could not).
      inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "update_routing_preferences", preferences: settingsSnapshot(board, "routingPreferences") });
      applySettingsField(board, "routingPreferences", operation.preferences);
    } else if (operation.kind === "update_net") {
      const item = board.nets.find((net) => net.id === operation.netId); if (!item) throw new Error(`OBJECT_NOT_FOUND:net:${operation.netId}`); checkExpected(item, operation.expectedObjectVersion, `net:${item.id}`); inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "update_net", netId: item.id, patch: { name: item.name, endpointKeys: structuredClone(item.endpointKeys ?? []) } }); Object.assign(item, structuredClone(operation.patch)); if (item.endpointKeys) item.endpointKeys = [...new Set(item.endpointKeys)].sort();
    } else if (operation.kind === "pin_asset") {
      if (project.pinnedAssets.some((asset) => asset.assetId === operation.asset.assetId)) throw new Error(`ID_REUSE:asset:${operation.asset.assetId}`); if (!operation.asset.contentDigest) throw new Error(`ASSET_DIGEST_REQUIRED:${operation.asset.assetId}`); project.pinnedAssets.push(structuredClone(operation.asset)); inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "remove_pinned_asset", assetId: operation.asset.assetId });
    } else if (operation.kind === "remove_pinned_asset") {
      const index = project.pinnedAssets.findIndex((asset) => asset.assetId === operation.assetId); if (index < 0) throw new Error(`OBJECT_NOT_FOUND:asset:${operation.assetId}`); const asset = project.pinnedAssets[index]; if (asset.required) throw new Error(`REQUIRED_ASSET_CANNOT_BE_REMOVED:${asset.assetId}`); project.pinnedAssets.splice(index, 1); inverse.unshift({ operationId: `inverse:${operation.operationId}`, schemaVersion: 1, units: "nm", kind: "pin_asset", asset: structuredClone(asset) });
    }
  }
  // B07.1 — the COMPLETE resulting schematic must satisfy the canonical
  // identity/reference/geometry contract after the batch, not only the
  // directly touched entities. A violating batch throws here and the whole
  // transaction rolls back (the caller applies operations to a clone).
  if (schematicTouched) {
    const integrityIssues = validateCanonicalSchematic(project.schematic);
    if (integrityIssues.length > 0) throw new Error(`SCHEMATIC_INTEGRITY:${integrityIssues[0]}`);
    refuseCreatedRailJoins(railJoinsBefore, project.schematic);
  }
  // B08 — the COMPLETE resulting board must satisfy the structural contract
  // after the batch (global id uniqueness, referential integrity, dimensional
  // sanity, layer validity, geometry well-formedness). A violating batch
  // throws and the whole transaction rolls back.
  if (boardTouched) {
    const boardIssues = validatePcbBoardStructure(project.pcb);
    if (boardIssues.length > 0) throw new Error(`BOARD_INTEGRITY:${boardIssues[0]}`);
  }
  return { project, inverseOperations: inverse };
}

// ─── B08 — exact-inverse PCB collection + settings operations ────────────────

type PcbInverseList = EngineeringOperation[];

const NM_BASE = { schemaVersion: 1 as const, units: "nm" as const };

/** Insert at the exact recorded index (clamped to the current length — the
 *  verified-replay dry-run digest check remains the replayability decision). */
function insertAt<T>(target: T[], item: T, atIndex: number | undefined): void {
  const index = atIndex === undefined ? target.length : Math.min(Math.max(atIndex, 0), target.length);
  target.splice(index, 0, item);
}

interface CollectionAccess<T extends { id: string }> {
  kindLabel: string;
  /** The live array (undefined when the optional collection is absent). */
  peek(board: PcbBoard): T[] | undefined;
  /** The live array, creating an absent optional collection. */
  ensure(board: PcbBoard): T[];
  /** Remove the collection when empty (optional collections only). */
  prune?(board: PcbBoard): void;
  /** Per-entity structural validation (throws with a truthful code). */
  validate(board: PcbBoard, item: T): void;
  /** Layers whose zone fills this entity affects (for dirty marking). */
  layers(item: T): LayerId[];
  /** Post-write hook (e.g. mark a zone's own fill dirty). */
  onWrite?(item: T, reason: string): void;
}

function collectionAdd<T extends { id: string }>(
  board: PcbBoard, access: CollectionAccess<T>, operation: EngineeringOperation & { atIndex?: number },
  item: T, inverse: PcbInverseList, removeInverse: EngineeringOperation,
): void {
  const wasAbsent = access.peek(board) === undefined;
  const items = access.ensure(board);
  if (items.some((existing) => existing.id === item.id)) throw new Error(`ID_REUSE:${access.kindLabel}:${item.id}`);
  access.validate(board, item);
  const clone = structuredClone(item);
  insertAt(items, clone, operation.atIndex);
  access.onWrite?.(clone, operation.operationId);
  // Undo of an add into a previously-ABSENT optional collection must restore
  // absence exactly (digest-exact), not leave an empty array behind.
  if (wasAbsent && access.prune) {
    (removeInverse as { pruneEmptyCollection?: boolean }).pruneEmptyCollection = true;
  }
  inverse.unshift(removeInverse);
  markAffectedZones(board, access.layers(clone), operation.operationId);
}

function collectionRemove<T extends { id: string }>(
  board: PcbBoard, access: CollectionAccess<T>, operation: EngineeringOperation & { pruneEmptyCollection?: boolean },
  id: string, inverse: PcbInverseList, makeAddInverse: (item: T, atIndex: number) => EngineeringOperation,
): void {
  const items = access.peek(board);
  const index = items?.findIndex((item) => item.id === id) ?? -1;
  if (!items || index < 0) throw new Error(`OBJECT_NOT_FOUND:${access.kindLabel}:${id}`);
  const item = items[index];
  checkExpected(item, operation.expectedObjectVersion, `${access.kindLabel}:${id}`);
  requireUnlocked(item as { locked?: boolean }, `${access.kindLabel}:${id}`, operation);
  inverse.unshift(makeAddInverse(structuredClone(item), index));
  items.splice(index, 1);
  if (operation.pruneEmptyCollection && items.length === 0) access.prune?.(board);
  markAffectedZones(board, access.layers(item), operation.operationId);
}

function collectionUpdate<T extends { id: string; locked?: boolean }>(
  board: PcbBoard, access: CollectionAccess<T>, operation: EngineeringOperation,
  id: string, next: { patch?: Partial<T>; replace?: T }, inverse: PcbInverseList,
  makeReplaceInverse: (previous: T) => EngineeringOperation,
): void {
  const items = access.peek(board);
  const index = items?.findIndex((item) => item.id === id) ?? -1;
  if (!items || index < 0) throw new Error(`OBJECT_NOT_FOUND:${access.kindLabel}:${id}`);
  const item = items[index];
  checkExpected(item, operation.expectedObjectVersion, `${access.kindLabel}:${id}`);
  requireUnlocked(item, `${access.kindLabel}:${id}`, operation);
  if ((next.patch === undefined) === (next.replace === undefined)) throw new Error(`INVALID_UPDATE:${access.kindLabel}:${id}: exactly one of patch/replace is required`);
  const beforeLayers = access.layers(item);
  const previous = structuredClone(item);
  let applied: T;
  if (next.replace !== undefined) {
    if (next.replace.id !== id) throw new Error(`REPLACE_ID_MISMATCH:${access.kindLabel}:${id}`);
    // Protection is NOT mutable through generic updates — replace snapshots
    // must preserve the current locked state exactly (set_*_protection is
    // the only lock mutator).
    if (Boolean(next.replace.locked) !== Boolean(item.locked)) throw new Error(`PROTECTION_VIA_UPDATE:${access.kindLabel}:${id}`);
    applied = structuredClone(next.replace);
    items[index] = applied;
  } else {
    Object.assign(item, structuredClone(next.patch));
    applied = item;
  }
  access.validate(board, applied);
  access.onWrite?.(applied, operation.operationId);
  inverse.unshift(makeReplaceInverse(previous));
  markAffectedZones(board, [...new Set([...beforeLayers, ...access.layers(applied)])], operation.operationId);
}

const TRACKS: CollectionAccess<Track> = {
  kindLabel: "track",
  peek: (board) => board.tracks,
  ensure: (board) => board.tracks,
  validate: (board, track) => {
    requireNet(board, track.netId);
    if (track.width <= 0 || (track.start.x === track.end.x && track.start.y === track.end.y)) throw new Error(`INVALID_TRACK:${track.id}`);
  },
  layers: (track) => [track.layer],
};

const VIAS: CollectionAccess<Via> = {
  kindLabel: "via",
  peek: (board) => board.vias,
  ensure: (board) => board.vias,
  validate: (board, via) => {
    requireNet(board, via.netId);
    if (via.size <= 0 || via.drill <= 0 || via.drill >= via.size) throw new Error(`INVALID_VIA:${via.id}`);
    if (via.padstackId !== undefined && !(board.padstacks ?? []).some((padstack) => padstack.id === via.padstackId)) throw new Error(`UNKNOWN_PADSTACK:${via.padstackId}`);
  },
  layers: viaLayers,
};

const ZONES: CollectionAccess<Zone> = {
  kindLabel: "zone",
  peek: (board) => board.zones,
  ensure: (board) => board.zones,
  validate: (board, zone) => {
    requireNet(board, zone.netId);
    if (zone.polygon.length < 3) throw new Error(`INVALID_ZONE:${zone.id}`);
  },
  layers: (zone) => [zone.layer],
  onWrite: (zone, reason) => markZoneFillDirty(zone, reason),
};

const TEXTS: CollectionAccess<PcbBoard["texts"][number]> = {
  kindLabel: "text",
  peek: (board) => board.texts,
  ensure: (board) => board.texts,
  validate: (_board, text) => {
    if (text.sizeX <= 0 || text.sizeY <= 0 || text.thickness <= 0) throw new Error(`INVALID_TEXT:${text.id}`);
  },
  layers: () => [],
};

const SILK: CollectionAccess<NonNullable<PcbBoard["silkItems"]>[number]> = {
  kindLabel: "silk",
  peek: (board) => board.silkItems,
  ensure: (board) => (board.silkItems ??= []),
  prune: (board) => { delete board.silkItems; },
  validate: (_board, item) => {
    if (item.strokeWidthNm <= 0) throw new Error(`INVALID_SILK:${item.id}`);
    if (item.kind === "text" && item.heightNm <= 0) throw new Error(`INVALID_SILK:${item.id}`);
    if (item.kind === "circle" && item.radiusNm <= 0) throw new Error(`INVALID_SILK:${item.id}`);
  },
  layers: () => [],
};

const PADSTACKS: CollectionAccess<NonNullable<PcbBoard["padstacks"]>[number]> = {
  kindLabel: "padstack",
  peek: (board) => board.padstacks,
  ensure: (board) => (board.padstacks ??= []),
  prune: (board) => { delete board.padstacks; },
  validate: (_board, padstack) => {
    if (padstack.name.trim().length === 0 || padstack.kind !== "via" || padstack.outerNm <= 0 || padstack.drillNm <= 0 || padstack.drillNm >= padstack.outerNm) throw new Error(`INVALID_PADSTACK:${padstack.id}`);
  },
  layers: () => [],
};

const KEEPOUTS: CollectionAccess<NonNullable<PcbBoard["routingKeepouts"]>[number]> = {
  kindLabel: "keepout",
  peek: (board) => board.routingKeepouts,
  ensure: (board) => (board.routingKeepouts ??= []),
  prune: (board) => { delete board.routingKeepouts; },
  validate: (_board, keepout) => {
    if (keepout.polygon.length < 3 || keepout.layers.length === 0 || (!keepout.forbidTracks && !keepout.forbidVias)) throw new Error(`INVALID_KEEPOUT:${keepout.id}`);
  },
  layers: (keepout) => [...keepout.layers],
};

const DIMENSIONS: CollectionAccess<NonNullable<PcbBoard["dimensions"]>[number]> = {
  kindLabel: "dimension",
  peek: (board) => board.dimensions,
  ensure: (board) => (board.dimensions ??= []),
  prune: (board) => { delete board.dimensions; },
  validate: (_board, dimension) => {
    const issues = validateBoardDimension(dimension);
    if (issues.length > 0) throw new Error(`INVALID_DIMENSION:${dimension.id}: ${issues[0]}`);
  },
  layers: () => [],
};

/** Exact-snapshot settings write: `value === null` means the optional board
 *  field is ABSENT (deleted) — inverses restore presence/absence exactly. */
function applySettingsField<K extends keyof PcbBoard>(board: PcbBoard, key: K, value: NonNullable<PcbBoard[K]> | null): void {
  if (value === null) delete board[key];
  else board[key] = structuredClone(value);
}

function settingsSnapshot<K extends keyof PcbBoard>(board: PcbBoard, key: K): NonNullable<PcbBoard[K]> | null {
  const value = board[key];
  return value === undefined ? null : (structuredClone(value) as NonNullable<PcbBoard[K]>);
}

/**
 * Apply one B08 PCB operation. Returns false when the operation kind is not
 * part of the B08 dispatch (the caller's legacy chain handles it).
 */
function applyB08PcbOperation(board: PcbBoard, operation: EngineeringOperation, inverse: PcbInverseList): boolean {
  const inverseId = `inverse:${operation.operationId}`;
  switch (operation.kind) {
    case "add_track":
      collectionAdd(board, TRACKS, operation, operation.track, inverse, { ...NM_BASE, operationId: inverseId, kind: "remove_track", trackId: operation.track.id });
      return true;
    case "update_track":
      collectionUpdate(board, TRACKS, operation, operation.trackId, { patch: operation.patch as Partial<Track>, replace: operation.replace }, inverse,
        (previous) => ({ ...NM_BASE, operationId: inverseId, kind: "update_track", trackId: previous.id, replace: previous }));
      return true;
    case "remove_track":
      collectionRemove(board, TRACKS, operation, operation.trackId, inverse, (item, atIndex) => ({ ...NM_BASE, operationId: inverseId, kind: "add_track", track: item, atIndex }));
      return true;
    case "add_via":
      collectionAdd(board, VIAS, operation, operation.via, inverse, { ...NM_BASE, operationId: inverseId, kind: "remove_via", viaId: operation.via.id });
      return true;
    case "update_via":
      collectionUpdate(board, VIAS, operation, operation.viaId, { patch: operation.patch as Partial<Via>, replace: operation.replace }, inverse,
        (previous) => ({ ...NM_BASE, operationId: inverseId, kind: "update_via", viaId: previous.id, replace: previous }));
      return true;
    case "remove_via":
      collectionRemove(board, VIAS, operation, operation.viaId, inverse, (item, atIndex) => ({ ...NM_BASE, operationId: inverseId, kind: "add_via", via: item, atIndex }));
      return true;
    case "add_zone":
      collectionAdd(board, ZONES, operation, operation.zone, inverse, { ...NM_BASE, operationId: inverseId, kind: "remove_zone", zoneId: operation.zone.id });
      return true;
    case "update_zone":
      collectionUpdate(board, ZONES, operation, operation.zoneId, { patch: operation.patch as Partial<Zone>, replace: operation.replace }, inverse,
        (previous) => ({ ...NM_BASE, operationId: inverseId, kind: "update_zone", zoneId: previous.id, replace: previous }));
      return true;
    case "remove_zone":
      collectionRemove(board, ZONES, operation, operation.zoneId, inverse, (item, atIndex) => ({ ...NM_BASE, operationId: inverseId, kind: "add_zone", zone: item, atIndex }));
      return true;
    case "set_copper_protection": {
      const items: Array<{ id: string; locked?: boolean; layer?: LayerId; layers?: readonly LayerId[] }> =
        operation.target === "track" ? board.tracks : operation.target === "via" ? board.vias : board.zones;
      const item = items.find((candidate) => candidate.id === operation.id);
      if (!item) throw new Error(`OBJECT_NOT_FOUND:${operation.target}:${operation.id}`);
      checkExpected(item, operation.expectedObjectVersion, `${operation.target}:${operation.id}`);
      inverse.unshift({ ...NM_BASE, operationId: inverseId, kind: "set_copper_protection", target: operation.target, id: operation.id, locked: Boolean(item.locked) });
      if (operation.locked) item.locked = true; else delete item.locked; // absent = unlocked (digest-exact with legacy boards)
      return true;
    }
    case "add_text":
      collectionAdd(board, TEXTS, operation, operation.text, inverse, { ...NM_BASE, operationId: inverseId, kind: "remove_text", textId: operation.text.id });
      return true;
    case "update_text":
      collectionUpdate(board, TEXTS, operation, operation.textId, { replace: operation.replace }, inverse,
        (previous) => ({ ...NM_BASE, operationId: inverseId, kind: "update_text", textId: previous.id, replace: previous }));
      return true;
    case "remove_text":
      collectionRemove(board, TEXTS, operation, operation.textId, inverse, (item, atIndex) => ({ ...NM_BASE, operationId: inverseId, kind: "add_text", text: item, atIndex }));
      return true;
    case "add_silk":
      collectionAdd(board, SILK, operation, operation.item, inverse, { ...NM_BASE, operationId: inverseId, kind: "remove_silk", silkId: operation.item.id });
      return true;
    case "update_silk":
      collectionUpdate(board, SILK, operation, operation.silkId, { replace: operation.replace }, inverse,
        (previous) => ({ ...NM_BASE, operationId: inverseId, kind: "update_silk", silkId: previous.id, replace: previous }));
      return true;
    case "remove_silk":
      collectionRemove(board, SILK, operation, operation.silkId, inverse, (item, atIndex) => ({ ...NM_BASE, operationId: inverseId, kind: "add_silk", item, atIndex }));
      return true;
    case "add_padstack":
      collectionAdd(board, PADSTACKS, operation, operation.padstack, inverse, { ...NM_BASE, operationId: inverseId, kind: "remove_padstack", padstackId: operation.padstack.id });
      return true;
    case "update_padstack":
      collectionUpdate(board, PADSTACKS, operation, operation.padstackId, { replace: operation.replace }, inverse,
        (previous) => ({ ...NM_BASE, operationId: inverseId, kind: "update_padstack", padstackId: previous.id, replace: previous }));
      return true;
    case "remove_padstack": {
      // Referential integrity BEFORE mutation: deletion cannot leave a
      // dangling via reference; the whole batch fails atomically.
      const referencing = board.vias.filter((via) => via.padstackId === operation.padstackId).map((via) => via.id);
      if (referencing.length > 0) throw new Error(`PADSTACK_IN_USE:${operation.padstackId}:${referencing.slice(0, 5).join(",")}`);
      collectionRemove(board, PADSTACKS, operation, operation.padstackId, inverse, (item, atIndex) => ({ ...NM_BASE, operationId: inverseId, kind: "add_padstack", padstack: item, atIndex }));
      return true;
    }
    case "add_keepout":
      collectionAdd(board, KEEPOUTS, operation, operation.keepout, inverse, { ...NM_BASE, operationId: inverseId, kind: "remove_keepout", keepoutId: operation.keepout.id });
      return true;
    case "update_keepout":
      collectionUpdate(board, KEEPOUTS, operation, operation.keepoutId, { replace: operation.replace }, inverse,
        (previous) => ({ ...NM_BASE, operationId: inverseId, kind: "update_keepout", keepoutId: previous.id, replace: previous }));
      return true;
    case "remove_keepout":
      collectionRemove(board, KEEPOUTS, operation, operation.keepoutId, inverse, (item, atIndex) => ({ ...NM_BASE, operationId: inverseId, kind: "add_keepout", keepout: item, atIndex }));
      return true;
    case "add_dimension":
      collectionAdd(board, DIMENSIONS, operation, operation.dimension, inverse, { ...NM_BASE, operationId: inverseId, kind: "remove_dimension", dimensionId: operation.dimension.id });
      return true;
    case "update_dimension":
      collectionUpdate(board, DIMENSIONS, operation, operation.dimensionId, { replace: operation.replace }, inverse,
        (previous) => ({ ...NM_BASE, operationId: inverseId, kind: "update_dimension", dimensionId: previous.id, replace: previous }));
      return true;
    case "remove_dimension":
      collectionRemove(board, DIMENSIONS, operation, operation.dimensionId, inverse, (item, atIndex) => ({ ...NM_BASE, operationId: inverseId, kind: "add_dimension", dimension: item, atIndex }));
      return true;
    case "update_stackup":
      if (operation.stackup !== 2 && operation.stackup !== 4) throw new Error(`INVALID_STACKUP:${String(operation.stackup)}`);
      inverse.unshift({ ...NM_BASE, operationId: inverseId, kind: "update_stackup", stackup: board.stackup, stackupConfig: settingsSnapshot(board, "stackupConfig") });
      board.stackup = operation.stackup;
      applySettingsField(board, "stackupConfig", operation.stackupConfig);
      markAffectedZones(board, [], operation.operationId);
      return true;
    case "update_net_classing":
      inverse.unshift({ ...NM_BASE, operationId: inverseId, kind: "update_net_classing", netClassing: settingsSnapshot(board, "netClassing") });
      applySettingsField(board, "netClassing", operation.netClassing);
      return true;
    case "update_constraint_state":
      inverse.unshift({ ...NM_BASE, operationId: inverseId, kind: "update_constraint_state", constraintState: settingsSnapshot(board, "constraintState") });
      applySettingsField(board, "constraintState", operation.constraintState);
      return true;
    case "update_placement_settings":
      inverse.unshift({ ...NM_BASE, operationId: inverseId, kind: "update_placement_settings", placementPreferences: settingsSnapshot(board, "placementPreferences"), placementPolicy: settingsSnapshot(board, "placementPolicy") });
      applySettingsField(board, "placementPreferences", operation.placementPreferences);
      applySettingsField(board, "placementPolicy", operation.placementPolicy);
      return true;
    case "update_routing_history": {
      if (operation.events !== null) {
        const ids = new Set(operation.events.map((event) => event.id));
        if (ids.size !== operation.events.length) throw new Error("INVALID_ROUTING_HISTORY:duplicate event ids");
      }
      inverse.unshift({ ...NM_BASE, operationId: inverseId, kind: "update_routing_history", events: settingsSnapshot(board, "routingHistory") });
      applySettingsField(board, "routingHistory", operation.events);
      return true;
    }
    default:
      return false;
  }
}

// ─── B07.1 — per-operation schematic geometry validation ─────────────────────

function validateSchematicOperationGeometry(operation: EngineeringOperation): string[] {
  const at = `operation:${operation.operationId}`;
  switch (operation.kind) {
    case "schematic_transform_component":
      return [...validateSchematicPoint({ x: operation.x, y: operation.y }, at), ...validateSchematicRotation(operation.rotation, `${at}.rotation`)];
    case "schematic_add_wire":
      return validateSchematicWireVertices(operation.wire.vertices, `${at}.wire.vertices`);
    case "schematic_update_wire_geometry":
      return validateSchematicWireVertices(operation.vertices, `${at}.vertices`);
    case "schematic_add_net_label":
      return [...validateSchematicPoint(operation.label.position, `${at}.label.position`), ...validateSchematicRotation(operation.label.orientation, `${at}.label.orientation`)];
    case "schematic_update_net_label":
      return [
        ...(operation.patch.position !== undefined ? validateSchematicPoint(operation.patch.position, `${at}.patch.position`) : []),
        ...(operation.patch.orientation !== undefined ? validateSchematicRotation(operation.patch.orientation, `${at}.patch.orientation`) : []),
      ];
    case "schematic_add_component":
      return [...validateSchematicPoint({ x: operation.component.x, y: operation.component.y }, at), ...validateSchematicRotation(operation.component.rotation, `${at}.rotation`)];
    // [PR-J, 2026-10-22] sheet blocks and sheet pins follow the same grid contract.
    case "schematic_create_sheet":
      return operation.sheet.block ? [...validateSchematicPoint({ x: operation.sheet.block.x, y: operation.sheet.block.y }, `${at}.sheet.block`), ...validateSchematicPoint({ x: operation.sheet.block.width, y: operation.sheet.block.height }, `${at}.sheet.block.size`)] : [];
    case "schematic_add_sheet_pin":
      return [...validateSchematicPoint(operation.pin.position, `${at}.pin.position`), ...validateSchematicRotation(operation.pin.orientation, `${at}.pin.orientation`)];
    case "schematic_replace_component":
      return [
        ...operation.wireEndpointMoves.flatMap((move, index) => validateSchematicPoint(move.to, `${at}.wireEndpointMoves[${index}].to`)),
        ...operation.netLabelMoves.flatMap((move, index) => [
          ...validateSchematicPoint(move.from, `${at}.netLabelMoves[${index}].from`),
          ...validateSchematicPoint(move.to, `${at}.netLabelMoves[${index}].to`),
        ]),
      ];
    case "schematic_restore_entities":
      return [
        ...operation.components.flatMap((entry, index) => [...validateSchematicPoint({ x: entry.entity.x, y: entry.entity.y }, `${at}.components[${index}]`), ...validateSchematicRotation(entry.entity.rotation, `${at}.components[${index}].rotation`)]),
        ...operation.kicadComponents.flatMap((entry, index) => [...validateSchematicPoint({ x: entry.entity.x, y: entry.entity.y }, `${at}.kicadComponents[${index}]`), ...validateSchematicRotation(entry.entity.rotation, `${at}.kicadComponents[${index}].rotation`)]),
        ...operation.wires.flatMap((entry, index) => validateSchematicWireVertices(entry.entity.vertices, `${at}.wires[${index}].vertices`)),
        ...operation.netLabels.flatMap((entry, index) => [...validateSchematicPoint(entry.entity.position, `${at}.netLabels[${index}].position`), ...validateSchematicRotation(entry.entity.orientation, `${at}.netLabels[${index}].orientation`)]),
      ];
    default:
      return [];
  }
}

/** B07.1 — display uniqueness spans the WHOLE exported component namespace
 *  (Theory display values AND KiCad refDes), case-normalized. */
function displayKeyTaken(schematic: CanonicalSchematic, key: string, excludeId: string): boolean {
  return schematic.components.some((item) => item.id !== excludeId && refDesKey(item.refDes ?? item.id) === key)
    || schematic.kicadComponents.some((item) => item.id !== excludeId && refDesKey(item.refDes) === key);
}

// ─── B06 — schematic operation application (deterministic, exact inverses) ───

function applySchematicOperation(project: CanonicalProjectState, operation: EngineeringOperation, inverse: EngineeringOperation[]): void {
  const schematic = requireCanonicalSchematic(project);
  const inverseBase = { schemaVersion: 1 as const, units: "px" as const };

  if (operation.kind === "schematic_delete_component") {
    const array = operation.family === "theory" ? schematic.components : schematic.kicadComponents;
    const index = array.findIndex((item) => item.id === operation.componentId);
    if (index < 0) throw new Error(`OBJECT_NOT_FOUND:schematic-component:${operation.componentId}`);
    const removedComponent = array[index];
    const removedWires = operation.removeWireIds.map((wireId) => {
      const wireIndex = schematic.wires.findIndex((item) => item.id === wireId);
      if (wireIndex < 0) throw new Error(`OBJECT_NOT_FOUND:schematic-wire:${wireId}`);
      return { at: wireIndex, entity: structuredClone(schematic.wires[wireIndex]) };
    });
    const removedLabels = operation.removeNetLabelIds.map((labelId) => {
      const labelIndex = schematic.netLabels.findIndex((item) => item.id === labelId);
      if (labelIndex < 0) throw new Error(`OBJECT_NOT_FOUND:schematic-label:${labelId}`);
      return { at: labelIndex, entity: structuredClone(schematic.netLabels[labelIndex]) };
    });
    // Exact snapshot-based inverse: entities are restored at the EXACT array
    // indices they were removed from, so replaying the inverse reproduces the
    // digest-identical base state (wires/labels reference nothing by id, so
    // indexed insertion is sufficient — justified inverse, recorded in full).
    inverse.unshift({
      ...inverseBase, operationId: `inverse:${operation.operationId}`, kind: "schematic_restore_entities",
      components: operation.family === "theory" ? [{ at: index, entity: structuredClone(removedComponent) as never }] : [],
      kicadComponents: operation.family === "kicad" ? [{ at: index, entity: structuredClone(removedComponent) as never }] : [],
      wires: removedWires,
      netLabels: removedLabels as never,
    });
    array.splice(index, 1);
    const wireIds = new Set(operation.removeWireIds);
    const labelIds = new Set(operation.removeNetLabelIds);
    schematic.wires = schematic.wires.filter((wire) => !wireIds.has(wire.id));
    schematic.netLabels = schematic.netLabels.filter((label) => !labelIds.has(label.id));
  } else if (operation.kind === "schematic_restore_entities") {
    for (const entry of operation.components) if (schematic.components.some((item) => item.id === entry.entity.id) || schematic.kicadComponents.some((item) => item.id === entry.entity.id)) throw new Error(`ID_REUSE:schematic-component:${entry.entity.id}`);
    for (const entry of operation.kicadComponents) if (schematic.kicadComponents.some((item) => item.id === entry.entity.id) || schematic.components.some((item) => item.id === entry.entity.id)) throw new Error(`ID_REUSE:schematic-component:${entry.entity.id}`);
    for (const entry of operation.wires) if (schematic.wires.some((item) => item.id === entry.entity.id)) throw new Error(`ID_REUSE:schematic-wire:${entry.entity.id}`);
    for (const entry of operation.netLabels) if (schematic.netLabels.some((item) => item.id === entry.entity.id)) throw new Error(`ID_REUSE:schematic-label:${entry.entity.id}`);
    inverse.unshift(...operation.components.map((entry, index) => ({
      ...inverseBase, operationId: `inverse:${operation.operationId}:t${index}`, kind: "schematic_delete_component" as const,
      family: "theory" as const, componentId: entry.entity.id, removeWireIds: [], removeNetLabelIds: [],
    })));
    inverse.unshift(...operation.kicadComponents.map((entry, index) => ({
      ...inverseBase, operationId: `inverse:${operation.operationId}:k${index}`, kind: "schematic_delete_component" as const,
      family: "kicad" as const, componentId: entry.entity.id, removeWireIds: [], removeNetLabelIds: [],
    })));
    // Order-exact restore: insert each entity at its recorded index, in
    // ascending index order, so the reconstructed arrays match the base state
    // exactly. Out-of-range indices (state drifted) clamp to the array end —
    // the verified-replay dry-run digest check still decides replayability.
    const restoreInto = <T>(target: T[], entries: ReadonlyArray<{ at: number; entity: T }>): void => {
      for (const entry of [...entries].sort((a, b) => a.at - b.at)) target.splice(Math.min(entry.at, target.length), 0, structuredClone(entry.entity));
    };
    restoreInto(schematic.components, operation.components as never);
    restoreInto(schematic.kicadComponents, operation.kicadComponents as never);
    restoreInto(schematic.wires, operation.wires);
    restoreInto(schematic.netLabels, operation.netLabels as never);
    // NOTE: a restore of wires/labels alone has no single-op inverse today;
    // the paired delete inverse above covers the component-restore case used
    // by undo. Restores are only ever minted BY the kernel as inverses.
  } else if (operation.kind === "schematic_replace_component") {
    const component = schematic.kicadComponents.find((item) => item.id === operation.componentId);
    if (!component) throw new Error(`OBJECT_NOT_FOUND:schematic-component:${operation.componentId}`);
    if (component.partId !== operation.expectedCurrentPartId) throw new Error(`REPLACE_PRECONDITION_FAILED:schematic-component:${operation.componentId}`);
    const moves = operation.wireEndpointMoves.map((move) => {
      const wire = schematic.wires.find((item) => item.id === move.wireId);
      if (!wire || wire.vertices.length === 0) throw new Error(`OBJECT_NOT_FOUND:schematic-wire:${move.wireId}`);
      const index = move.end === "start" ? 0 : wire.vertices.length - 1;
      return { wire, index, from: { ...wire.vertices[index] } };
    });
    // B06.1: net-label moves are position-preconditioned — the label must sit
    // EXACTLY where the plan said it was, and no two moves may target the
    // same label. A drifted label rejects the whole operation atomically.
    const labelMoveIds = new Set<string>();
    const labelMoves = operation.netLabelMoves.map((move) => {
      if (labelMoveIds.has(move.labelId)) throw new Error(`DUPLICATE_LABEL_MOVE:schematic-label:${move.labelId}`);
      labelMoveIds.add(move.labelId);
      const netLabel = schematic.netLabels.find((item) => item.id === move.labelId);
      if (!netLabel) throw new Error(`OBJECT_NOT_FOUND:schematic-label:${move.labelId}`);
      if (netLabel.position.x !== move.from.x || netLabel.position.y !== move.from.y) throw new Error(`LABEL_POSITION_PRECONDITION_FAILED:schematic-label:${move.labelId}`);
      return { netLabel, from: { ...move.from }, to: { ...move.to } };
    });
    // Inverse: replace back with the ORIGINAL identity fields (all authority
    // fields together — stale authority is structurally impossible) and the
    // reversed endpoint and label moves.
    inverse.unshift({
      ...inverseBase, operationId: `inverse:${operation.operationId}`, kind: "schematic_replace_component",
      componentId: component.id,
      expectedCurrentPartId: operation.replacement.partId,
      replacement: {
        partId: component.partId,
        value: component.value,
        atomicPartRevisionId: component.atomicPartRevisionId,
        symbolAssetVersionId: component.symbolAssetVersionId,
        footprintAssetVersionId: component.footprintAssetVersionId,
        mappingCertificateId: component.mappingCertificateId,
        selectionRecordId: component.selectionRecordId,
      },
      pinMapping: operation.pinMapping.map((entry) => ({ fromPin: entry.toPin, toPin: entry.fromPin })),
      wireEndpointMoves: moves.map((move) => ({ wireId: move.wire.id, end: move.index === 0 ? "start" as const : "end" as const, to: move.from })),
      netLabelMoves: labelMoves.map((move) => ({ labelId: move.netLabel.id, from: move.to, to: move.from })),
    });
    // Identity + authority fields are replaced TOGETHER: absent fields are
    // REMOVED, never silently retained from the previous part.
    component.partId = operation.replacement.partId;
    if (operation.replacement.value !== undefined) component.value = operation.replacement.value;
    component.atomicPartRevisionId = operation.replacement.atomicPartRevisionId;
    component.symbolAssetVersionId = operation.replacement.symbolAssetVersionId;
    component.footprintAssetVersionId = operation.replacement.footprintAssetVersionId;
    component.mappingCertificateId = operation.replacement.mappingCertificateId;
    component.selectionRecordId = operation.replacement.selectionRecordId;
    if (component.atomicPartRevisionId === undefined) delete component.atomicPartRevisionId;
    if (component.symbolAssetVersionId === undefined) delete component.symbolAssetVersionId;
    if (component.footprintAssetVersionId === undefined) delete component.footprintAssetVersionId;
    if (component.mappingCertificateId === undefined) delete component.mappingCertificateId;
    if (component.selectionRecordId === undefined) delete component.selectionRecordId;
    for (const move of moves) {
      const target = operation.wireEndpointMoves.find((entry) => entry.wireId === move.wire.id && (entry.end === "start" ? 0 : move.wire.vertices.length - 1) === move.index)!;
      move.wire.vertices[move.index] = { ...target.to };
    }
    for (const move of labelMoves) move.netLabel.position = { ...move.to };
  } else if (operation.kind === "schematic_set_component_properties") {
    if (operation.family === "theory") {
      const component = schematic.components.find((item) => item.id === operation.componentId);
      if (!component) throw new Error(`OBJECT_NOT_FOUND:schematic-component:${operation.componentId}`);
      // B07 — stable identity: rename writes ONLY the display reference; the
      // stable id (the operation target) is never rewritten. Normalization:
      // trimmed, non-empty, unique among theory display values (refDes ?? id).
      // `refDes: null` clears the override (display falls back to the id) —
      // minted by inverses so undo of a first rename is digest-exact.
      if (operation.patch.refDes !== undefined) {
        const nextDisplay = operation.patch.refDes === null ? component.id : operation.patch.refDes.trim();
        if (nextDisplay.length === 0) throw new Error(`INVALID_PROPERTY:display reference must be non-empty`);
        // B07.1: case-normalized uniqueness across Theory AND KiCad.
        if (displayKeyTaken(schematic, refDesKey(nextDisplay), component.id)) throw new Error(`INVALID_PROPERTY:display reference ${nextDisplay} is already in use`);
      }
      inverse.unshift({
        ...inverseBase, operationId: `inverse:${operation.operationId}`, kind: "schematic_set_component_properties", family: "theory", componentId: component.id,
        patch: { value: component.value, ...(operation.patch.refDes !== undefined ? { refDes: component.refDes ?? null } : {}) },
      });
      if (operation.patch.value !== undefined) component.value = operation.patch.value;
      if (operation.patch.refDes !== undefined) {
        if (operation.patch.refDes === null) delete component.refDes;
        else component.refDes = operation.patch.refDes.trim();
      }
    } else {
      const component = schematic.kicadComponents.find((item) => item.id === operation.componentId);
      if (!component) throw new Error(`OBJECT_NOT_FOUND:schematic-component:${operation.componentId}`);
      if (operation.patch.refDes !== undefined) {
        // B07: null (clear-display-override) is a theory-only form.
        if (operation.patch.refDes === null) throw new Error(`INVALID_PROPERTY:kicad refDes cannot be cleared`);
        const trimmed = operation.patch.refDes.trim();
        if (trimmed.length === 0) throw new Error(`INVALID_PROPERTY:refDes must be non-empty`);
        // B07.1: case-normalized uniqueness across KiCad AND Theory displays.
        if (displayKeyTaken(schematic, refDesKey(trimmed), component.id)) throw new Error(`INVALID_PROPERTY:refDes ${trimmed} is already in use`);
      }
      inverse.unshift({ ...inverseBase, operationId: `inverse:${operation.operationId}`, kind: "schematic_set_component_properties", family: "kicad", componentId: component.id, patch: { value: component.value, refDes: component.refDes } });
      if (operation.patch.value !== undefined) component.value = operation.patch.value;
      if (operation.patch.refDes !== undefined && operation.patch.refDes !== null) component.refDes = operation.patch.refDes.trim();
    }
  } else if (operation.kind === "schematic_transform_component") {
    const array = operation.family === "theory" ? schematic.components : schematic.kicadComponents;
    const component = array.find((item) => item.id === operation.componentId);
    if (!component) throw new Error(`OBJECT_NOT_FOUND:schematic-component:${operation.componentId}`);
    if (![0, 90, 180, 270].includes(operation.rotation)) throw new Error(`INVALID_PROPERTY:rotation must be 0|90|180|270`);
    inverse.unshift({ ...inverseBase, operationId: `inverse:${operation.operationId}`, kind: "schematic_transform_component", family: operation.family, componentId: component.id, x: component.x, y: component.y, rotation: component.rotation });
    component.x = operation.x;
    component.y = operation.y;
    component.rotation = operation.rotation;
  } else if (operation.kind === "schematic_add_wire") {
    if (schematic.wires.some((item) => item.id === operation.wire.id)) throw new Error(`ID_REUSE:schematic-wire:${operation.wire.id}`);
    if (operation.wire.vertices.length < 2) throw new Error(`INVALID_WIRE:${operation.wire.id}: a wire needs at least two vertices`);
    if (operation.atIndex < 0 || operation.atIndex > schematic.wires.length) throw new Error(`INVALID_INDEX:schematic-wire:${operation.wire.id}`);
    inverse.unshift({ ...inverseBase, operationId: `inverse:${operation.operationId}`, kind: "schematic_delete_wire", wireId: operation.wire.id });
    schematic.wires.splice(operation.atIndex, 0, structuredClone(operation.wire));
  } else if (operation.kind === "schematic_delete_wire") {
    const index = schematic.wires.findIndex((item) => item.id === operation.wireId);
    if (index < 0) throw new Error(`OBJECT_NOT_FOUND:schematic-wire:${operation.wireId}`);
    inverse.unshift({ ...inverseBase, operationId: `inverse:${operation.operationId}`, kind: "schematic_add_wire", wire: structuredClone(schematic.wires[index]), atIndex: index });
    schematic.wires.splice(index, 1);
  } else if (operation.kind === "schematic_update_wire_geometry") {
    const wire = schematic.wires.find((item) => item.id === operation.wireId);
    if (!wire) throw new Error(`OBJECT_NOT_FOUND:schematic-wire:${operation.wireId}`);
    if (operation.vertices.length < 2) throw new Error(`INVALID_WIRE:${operation.wireId}: a wire needs at least two vertices`);
    inverse.unshift({ ...inverseBase, operationId: `inverse:${operation.operationId}`, kind: "schematic_update_wire_geometry", wireId: wire.id, vertices: structuredClone(wire.vertices) });
    wire.vertices = structuredClone(operation.vertices);
  } else if (operation.kind === "schematic_add_net_label") {
    if (schematic.netLabels.some((item) => item.id === operation.label.id)) throw new Error(`ID_REUSE:schematic-label:${operation.label.id}`);
    if (operation.label.name.trim().length === 0) throw new Error(`INVALID_LABEL:${operation.label.id}: name must be non-empty`);
    if (![0, 90, 180, 270].includes(operation.label.orientation)) throw new Error(`INVALID_LABEL:${operation.label.id}: orientation must be 0|90|180|270`);
    if (operation.atIndex < 0 || operation.atIndex > schematic.netLabels.length) throw new Error(`INVALID_INDEX:schematic-label:${operation.label.id}`);
    inverse.unshift({ ...inverseBase, operationId: `inverse:${operation.operationId}`, kind: "schematic_delete_net_label", labelId: operation.label.id });
    schematic.netLabels.splice(operation.atIndex, 0, structuredClone(operation.label) as never);
  } else if (operation.kind === "schematic_delete_net_label") {
    const index = schematic.netLabels.findIndex((item) => item.id === operation.labelId);
    if (index < 0) throw new Error(`OBJECT_NOT_FOUND:schematic-label:${operation.labelId}`);
    inverse.unshift({ ...inverseBase, operationId: `inverse:${operation.operationId}`, kind: "schematic_add_net_label", label: structuredClone(schematic.netLabels[index]) as never, atIndex: index });
    schematic.netLabels.splice(index, 1);
  } else if (operation.kind === "schematic_update_net_label") {
    const label = schematic.netLabels.find((item) => item.id === operation.labelId);
    if (!label) throw new Error(`OBJECT_NOT_FOUND:schematic-label:${operation.labelId}`);
    if (operation.patch.name !== undefined && operation.patch.name.trim().length === 0) throw new Error(`INVALID_LABEL:${operation.labelId}: name must be non-empty`);
    if (operation.patch.orientation !== undefined && ![0, 90, 180, 270].includes(operation.patch.orientation)) throw new Error(`INVALID_LABEL:${operation.labelId}: orientation must be 0|90|180|270`);
    inverse.unshift({
      ...inverseBase, operationId: `inverse:${operation.operationId}`, kind: "schematic_update_net_label", labelId: label.id,
      patch: {
        ...(operation.patch.position !== undefined ? { position: { ...label.position } } : {}),
        ...(operation.patch.name !== undefined ? { name: label.name } : {}),
        ...(operation.patch.orientation !== undefined ? { orientation: label.orientation } : {}),
      },
    });
    if (operation.patch.position !== undefined) label.position = { ...operation.patch.position };
    if (operation.patch.name !== undefined) label.name = operation.patch.name;
    if (operation.patch.orientation !== undefined) label.orientation = operation.patch.orientation;
  } else if (operation.kind === "schematic_add_component") {
    if (operation.family === "theory") {
      // B07.1: stable-id uniqueness spans BOTH component families.
      if (schematic.components.some((item) => item.id === operation.component.id) || schematic.kicadComponents.some((item) => item.id === operation.component.id)) throw new Error(`ID_REUSE:schematic-component:${operation.component.id}`);
      const display = operation.component.refDes ?? operation.component.id;
      if (display.trim().length === 0) throw new Error(`INVALID_PROPERTY:display reference must be non-empty`);
      // B07.1: case-normalized uniqueness across the WHOLE exported namespace.
      if (displayKeyTaken(schematic, refDesKey(display), operation.component.id)) throw new Error(`INVALID_PROPERTY:display reference ${display} is already in use`);
      if (operation.atIndex < 0 || operation.atIndex > schematic.components.length) throw new Error(`INVALID_INDEX:schematic-component:${operation.component.id}`);
      inverse.unshift({ ...inverseBase, operationId: `inverse:${operation.operationId}`, kind: "schematic_delete_component", family: "theory", componentId: operation.component.id, removeWireIds: [], removeNetLabelIds: [] });
      schematic.components.splice(operation.atIndex, 0, structuredClone(operation.component) as never);
    } else {
      // B07.1: stable-id uniqueness spans BOTH component families.
      if (schematic.kicadComponents.some((item) => item.id === operation.component.id) || schematic.components.some((item) => item.id === operation.component.id)) throw new Error(`ID_REUSE:schematic-component:${operation.component.id}`);
      const refDes = operation.component.refDes.trim();
      if (refDes.length === 0) throw new Error(`INVALID_PROPERTY:refDes must be non-empty`);
      // B07.1: case-normalized uniqueness across the WHOLE exported namespace.
      if (displayKeyTaken(schematic, refDesKey(refDes), operation.component.id)) throw new Error(`INVALID_PROPERTY:refDes ${refDes} is already in use`);
      if (operation.atIndex < 0 || operation.atIndex > schematic.kicadComponents.length) throw new Error(`INVALID_INDEX:schematic-component:${operation.component.id}`);
      inverse.unshift({ ...inverseBase, operationId: `inverse:${operation.operationId}`, kind: "schematic_delete_component", family: "kicad", componentId: operation.component.id, removeWireIds: [], removeNetLabelIds: [] });
      schematic.kicadComponents.splice(operation.atIndex, 0, structuredClone(operation.component) as never);
    }
  } else if (SHEET_OPERATION_KINDS.has(operation.kind)) {
    applySheetOperation(schematic, operation, inverse);
  }
  project.schematic = schematic;
}

/** [PR-J, 2026-10-22] The rail-join keys of an opaque schematic slot (null when it is not a valid canonical schematic). */
function schematicRailJoins(value: unknown): string[] | null {
  const parsed = parseCanonicalSchematic(value);
  return parsed ? railJoinKeys(fromCanonicalSchematic(parsed)) : null;
}

/** [PR-J, 2026-10-22] OD-255 item 4: a batch holding a sheet operation may not CREATE a join of two different rail / isolation
 *  domains (joins that already existed are findings, never a reason to refuse an unrelated edit). */
function refuseCreatedRailJoins(before: string[] | null, after: unknown): void {
  if (!before) return;
  const created = (schematicRailJoins(after) ?? []).filter((join) => !before.includes(join));
  if (created.length > 0) throw new Error(`SHEET_RAIL_JOIN_REFUSED:${created.join(", ")}: this sheet operation would connect different rail / isolation domains (${created.map((join) => join.split("|").join(" + ")).join("; ")}); nothing was changed`);
}

/**
 * [PR-J, 2026-10-22] Runbook J / OD-255: the canonical sheet operations, each with an EXACT inverse (digest-identical replay). The
 * whole-document rules (one root first, parents, cycles, depth, names, ports, label references, one sheet pin per port) are enforced
 * by the canonical validator after every operation; these branches enforce the per-operation preconditions and keep the document in
 * its canonical form (the tree exists only while a child sheet exists; schemaVersion is v2 exactly while it exists).
 */
function applySheetOperation(schematic: CanonicalSchematic, operation: EngineeringOperation, inverse: EngineeringOperation[]): void {
  const inverseBase = { schemaVersion: 1 as const, units: "px" as const, operationId: `inverse:${operation.operationId}` };
  const requireSheets = (): NonNullable<CanonicalSchematic["sheets"]> => {
    if (!schematic.sheets) throw new Error(`OBJECT_NOT_FOUND:schematic-sheet: the document has no sheets (${operation.operationId})`);
    return schematic.sheets;
  };
  const requireSheet = (sheetId: string) => {
    const sheet = requireSheets().sheets.find((item) => item.id === sheetId);
    if (!sheet) throw new Error(`OBJECT_NOT_FOUND:schematic-sheet:${sheetId}`);
    return sheet;
  };
  if (operation.kind === "schematic_create_sheet") {
    const sheet = operation.sheet;
    if (sheet.parentId === null || sheet.id === ROOT_SHEET_ID) throw new Error(`INVALID_SHEET:${sheet.id}: only child sheets are created (the root sheet is the overview)`);
    if (sheet.ports !== undefined) throw new Error(`INVALID_SHEET:${sheet.id}: a new sheet has no ports (add them with schematic_add_sheet_port)`);
    if (!schematic.sheets) {
      const root = operation.root;
      if (!root || root.id !== ROOT_SHEET_ID || root.parentId !== null || root.ports !== undefined || root.block !== undefined) throw new Error(`INVALID_SHEET:${sheet.id}: the first child sheet carries the root record { id: "${ROOT_SHEET_ID}", parentId: null } without ports or block`);
      if (operation.atIndex !== 1) throw new Error(`INVALID_INDEX:schematic-sheet:${sheet.id}`);
      schematic.sheets = { version: 1, sheets: [structuredClone(root), structuredClone(sheet)] };
      schematic.schemaVersion = CANONICAL_SCHEMATIC_SCHEMA_V2;
    } else {
      if (operation.root !== undefined) throw new Error(`INVALID_SHEET:${sheet.id}: the sheet tree exists; the root record is only carried by the first child sheet`);
      if (schematic.sheets.sheets.some((item) => item.id === sheet.id)) throw new Error(`ID_REUSE:schematic-sheet:${sheet.id}`);
      if (operation.atIndex < 1 || operation.atIndex > schematic.sheets.sheets.length) throw new Error(`INVALID_INDEX:schematic-sheet:${sheet.id}`);
      schematic.sheets.sheets.splice(operation.atIndex, 0, structuredClone(sheet));
    }
    inverse.unshift({ ...inverseBase, kind: "schematic_delete_sheet", sheetId: sheet.id });
  } else if (operation.kind === "schematic_delete_sheet") {
    const tree = requireSheets();
    const index = tree.sheets.findIndex((item) => item.id === operation.sheetId);
    if (index < 0) throw new Error(`OBJECT_NOT_FOUND:schematic-sheet:${operation.sheetId}`);
    const sheet = tree.sheets[index]!;
    if (sheet.parentId === null) throw new Error(`SHEET_DELETE_REFUSED:${sheet.id}: the overview (root) sheet cannot be deleted`);
    const held: Array<[number, string]> = [
      [schematic.components.filter((item) => item.sheetId === sheet.id).length + schematic.kicadComponents.filter((item) => item.sheetId === sheet.id).length, "component"],
      [schematic.wires.filter((item) => item.sheetId === sheet.id).length, "wire"],
      [schematic.netLabels.filter((item) => item.sheetId === sheet.id || item.childSheetId === sheet.id).length, "label or sheet pin"],
      [tree.sheets.filter((item) => item.parentId === sheet.id).length, "child sheet"],
      [sheet.ports?.length ?? 0, "port"],
    ];
    const nonEmpty = held.filter(([count]) => count > 0);
    if (nonEmpty.length > 0) throw new Error(`SHEET_NOT_EMPTY:${sheet.id}: sheet "${sheet.name}" still holds ${nonEmpty.map(([count, noun]) => `${count} ${noun}(s)`).join(", ")}; move its contents to another sheet first. Nothing was deleted.`);
    tree.sheets.splice(index, 1);
    const dropTree = !tree.sheets.some((item) => item.parentId !== null);
    const root = tree.sheets[0]!;
    if (dropTree) { delete schematic.sheets; schematic.schemaVersion = CANONICAL_SCHEMATIC_SCHEMA; }
    inverse.unshift({ ...inverseBase, kind: "schematic_create_sheet", sheet: structuredClone(sheet), atIndex: index, ...(dropTree ? { root: structuredClone(root) } : {}) });
  } else if (operation.kind === "schematic_rename_sheet") {
    const sheet = requireSheet(operation.sheetId);
    inverse.unshift({ ...inverseBase, kind: "schematic_rename_sheet", sheetId: sheet.id, name: sheet.name });
    sheet.name = operation.name;
  } else if (operation.kind === "schematic_reorder_sheets") {
    const tree = requireSheets();
    const byId = new Map(tree.sheets.map((item) => [item.id, item]));
    if (operation.order.length !== tree.sheets.length || new Set(operation.order).size !== operation.order.length || operation.order.some((id) => !byId.has(id))) {
      throw new Error(`INVALID_SHEET_ORDER:${operation.operationId}: the order must list every sheet exactly once`);
    }
    inverse.unshift({ ...inverseBase, kind: "schematic_reorder_sheets", order: tree.sheets.map((item) => item.id) });
    tree.sheets = operation.order.map((id) => byId.get(id)!);
  } else if (operation.kind === "schematic_add_sheet_port") {
    const sheet = requireSheet(operation.sheetId);
    if (sheet.parentId === null) throw new Error(`INVALID_SHEET_PORT:${operation.port.id}: ports belong to child sheets, not the overview`);
    if (requireSheets().sheets.some((item) => (item.ports ?? []).some((port) => port.id === operation.port.id))) throw new Error(`ID_REUSE:schematic-sheet-port:${operation.port.id}`);
    const ports = sheet.ports ?? [];
    if (operation.atIndex < 0 || operation.atIndex > ports.length) throw new Error(`INVALID_INDEX:schematic-sheet-port:${operation.port.id}`);
    sheet.ports = [...ports.slice(0, operation.atIndex), structuredClone(operation.port), ...ports.slice(operation.atIndex)];
    inverse.unshift({ ...inverseBase, kind: "schematic_remove_sheet_port", sheetId: sheet.id, portId: operation.port.id });
  } else if (operation.kind === "schematic_remove_sheet_port") {
    const sheet = requireSheet(operation.sheetId);
    const ports = sheet.ports ?? [];
    const index = ports.findIndex((port) => port.id === operation.portId);
    if (index < 0) throw new Error(`OBJECT_NOT_FOUND:schematic-sheet-port:${operation.portId}`);
    const port = ports[index]!;
    const users = schematic.netLabels.filter((label) => label.portId === operation.portId);
    if (users.length > 0) throw new Error(`SHEET_PORT_IN_USE:${operation.portId}: port "${port.name}" still has ${users.length} hierarchical label(s) or sheet pin(s) (${users.map((label) => label.id).join(", ")}); remove them first. Nothing was changed.`);
    inverse.unshift({ ...inverseBase, kind: "schematic_add_sheet_port", sheetId: sheet.id, port: structuredClone(port), atIndex: index });
    const remaining = ports.filter((item) => item.id !== operation.portId);
    if (remaining.length === 0) delete sheet.ports; else sheet.ports = remaining;
  } else if (operation.kind === "schematic_add_sheet_pin") {
    const pin = operation.pin;
    if (pin.scope !== "sheet-pin") throw new Error(`INVALID_SHEET_PIN:${pin.id}: a sheet pin is a label with scope "sheet-pin"`);
    if (schematic.netLabels.some((item) => item.id === pin.id)) throw new Error(`ID_REUSE:schematic-label:${pin.id}`);
    if (pin.name.trim().length === 0) throw new Error(`INVALID_LABEL:${pin.id}: name must be non-empty`);
    if (operation.atIndex < 0 || operation.atIndex > schematic.netLabels.length) throw new Error(`INVALID_INDEX:schematic-label:${pin.id}`);
    schematic.netLabels.splice(operation.atIndex, 0, structuredClone(pin) as never);
    inverse.unshift({ ...inverseBase, kind: "schematic_remove_sheet_pin", labelId: pin.id });
  } else if (operation.kind === "schematic_remove_sheet_pin") {
    const index = schematic.netLabels.findIndex((item) => item.id === operation.labelId);
    if (index < 0) throw new Error(`OBJECT_NOT_FOUND:schematic-label:${operation.labelId}`);
    if (schematic.netLabels[index]!.scope !== "sheet-pin") throw new Error(`INVALID_SHEET_PIN:${operation.labelId}: the label is not a sheet pin`);
    inverse.unshift({ ...inverseBase, kind: "schematic_add_sheet_pin", pin: structuredClone(schematic.netLabels[index]!) as never, atIndex: index });
    schematic.netLabels.splice(index, 1);
  } else if (operation.kind === "schematic_set_label_scope") {
    const label = schematic.netLabels.find((item) => item.id === operation.labelId);
    if (!label) throw new Error(`OBJECT_NOT_FOUND:schematic-label:${operation.labelId}`);
    inverse.unshift({ ...inverseBase, kind: "schematic_set_label_scope", labelId: label.id, scope: label.scope ?? null, portId: label.portId ?? null, childSheetId: label.childSheetId ?? null });
    if (operation.scope === null) delete label.scope; else label.scope = operation.scope;
    if (operation.portId === null) delete label.portId; else label.portId = operation.portId;
    if (operation.childSheetId === null) delete label.childSheetId; else label.childSheetId = operation.childSheetId;
  } else if (operation.kind === "schematic_assign_sheet") {
    if (operation.entries.length === 0) throw new Error(`INVALID_SHEET_ASSIGNMENT:${operation.operationId}: no entries`);
    const seenTargets = new Set<string>();
    for (const entry of operation.entries) {
      const target = `${entry.family}:${entry.id}`;
      if (seenTargets.has(target)) throw new Error(`INVALID_SHEET_ASSIGNMENT:${target}: listed twice`);
      seenTargets.add(target);
      const pool: Array<{ id: string; sheetId?: string }> = entry.family === "theory" ? schematic.components : entry.family === "kicad" ? schematic.kicadComponents : entry.family === "wire" ? schematic.wires : schematic.netLabels;
      const entity = pool.find((item) => item.id === entry.id);
      if (!entity) throw new Error(`OBJECT_NOT_FOUND:${entry.family === "wire" ? "schematic-wire" : entry.family === "label" ? "schematic-label" : "schematic-component"}:${entry.id}`);
      if (sheetOf(entity) !== entry.from) throw new Error(`SHEET_ASSIGN_PRECONDITION_FAILED:${target}: it is on sheet ${sheetOf(entity)}, not ${entry.from}`);
      if (entry.to !== ROOT_SHEET_ID && !(schematic.sheets?.sheets ?? []).some((sheet) => sheet.id === entry.to)) throw new Error(`OBJECT_NOT_FOUND:schematic-sheet:${entry.to}`);
      if (entry.to === ROOT_SHEET_ID) delete entity.sheetId; else entity.sheetId = entry.to;
    }
    inverse.unshift({ ...inverseBase, kind: "schematic_assign_sheet", entries: operation.entries.map((entry) => ({ family: entry.family, id: entry.id, from: entry.to, to: entry.from })) });
  }
}

/**
 * [PR-J, 2026-10-22] Apply schematic operations to a canonical schematic alone - the same code the executor runs, without a board -
 * so a planner can verify a candidate batch before proposing it. Throws exactly what the executor would; returns the result and its
 * exact inverse operations.
 */
export function applySchematicOperationsToCanonical(schematic: CanonicalSchematic, operations: readonly EngineeringOperation[]): { schematic: CanonicalSchematic; inverseOperations: EngineeringOperation[] } {
  const project = { schematic: structuredClone(schematic) } as unknown as CanonicalProjectState;
  const inverse: EngineeringOperation[] = [];
  const railJoinsBefore = operations.some((operation) => SHEET_OPERATION_KINDS.has(operation.kind)) ? schematicRailJoins(schematic) : null;
  const seen = new Set<string>();
  for (const operation of operations) {
    if (!SCHEMATIC_OPERATION_KINDS.has(operation.kind)) throw new Error(`UNSUPPORTED_OPERATION_SCHEMA:${operation.operationId}: not a schematic operation`);
    if (seen.has(operation.operationId)) throw new Error(`DUPLICATE_OPERATION_ID:${operation.operationId}`);
    seen.add(operation.operationId);
    if (operation.units !== "px" || operation.schemaVersion !== 1) throw new Error(`UNSUPPORTED_OPERATION_SCHEMA:${operation.operationId}`);
    const geometryIssues = validateSchematicOperationGeometry(operation);
    if (geometryIssues.length > 0) throw new Error(geometryIssues[0]);
    applySchematicOperation(project, operation, inverse);
  }
  const integrityIssues = validateCanonicalSchematic(project.schematic);
  if (integrityIssues.length > 0) throw new Error(`SCHEMATIC_INTEGRITY:${integrityIssues[0]}`);
  refuseCreatedRailJoins(railJoinsBefore, project.schematic);
  return { schematic: project.schematic as CanonicalSchematic, inverseOperations: inverse };
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
