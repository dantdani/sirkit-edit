/**
 * B08 — whole-board structural validation.
 *
 * Runs INSIDE `applyEngineeringOperations` after every batch that touches
 * PCB state (mirroring the B07.1 schematic integrity gate): the COMPLETE
 * resulting board must satisfy the structural contract, not only the
 * directly touched entities. A violating batch throws and the whole
 * transaction rolls back — no partially-valid board can ever become a
 * canonical head through the executor.
 *
 * The checks are structural (identity, referential integrity, dimensional
 * sanity, layer validity, geometry well-formedness) — NOT DRC. Derived
 * evidence (DRC, connectivity, readiness) is recomputed by its own
 * evaluators after invalidation; nothing here recomputes it.
 */

import { LAYERS, type LayerId } from "../pcb/layers";
import { DIMENSION_LAYERS, type BoardDimension, type PcbBoard } from "../pcb/types";
import type { Vec2 } from "../pcb/geometry";

const VALID_LAYERS = new Set<LayerId>(LAYERS.map((layer) => layer.id));
const COPPER_LAYERS = new Set<LayerId>(LAYERS.filter((layer) => layer.kind === "copper").map((layer) => layer.id));
const SILK_LAYERS = new Set<LayerId>(["silkTop", "silkBottom"]);
const DIMENSION_LAYER_SET = new Set<string>(DIMENSION_LAYERS);

function isSafeVec(point: Vec2): boolean {
  return Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y);
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Structural validity of ONE dimension annotation (also used per-operation). */
export function validateBoardDimension(dimension: BoardDimension): string[] {
  const issues: string[] = [];
  const at = `dimension ${dimension.id}`;
  if (typeof dimension.id !== "string" || dimension.id.length === 0) issues.push(`${at}: id must be a non-empty string`);
  if (!["horizontal", "vertical", "aligned"].includes(dimension.kind)) issues.push(`${at}: unknown kind ${String(dimension.kind)}`);
  if (!isSafeVec(dimension.a) || !isSafeVec(dimension.b)) issues.push(`${at}: endpoints must be safe-integer nanometres`);
  if (!Number.isSafeInteger(dimension.offsetNm)) issues.push(`${at}: offsetNm must be a safe integer`);
  if (dimension.kind === "horizontal" && dimension.a.x === dimension.b.x) issues.push(`${at}: horizontal dimension measures zero span`);
  if (dimension.kind === "vertical" && dimension.a.y === dimension.b.y) issues.push(`${at}: vertical dimension measures zero span`);
  if (dimension.kind === "aligned" && samePoint(dimension.a, dimension.b)) issues.push(`${at}: aligned dimension endpoints coincide`);
  if (!DIMENSION_LAYER_SET.has(dimension.layer)) issues.push(`${at}: unsupported layer ${String(dimension.layer)} (documentation layers only)`);
  if (dimension.unit !== "mm" && dimension.unit !== "in") issues.push(`${at}: unit must be mm or in`);
  if (![0, 1, 2, 3, 4].includes(dimension.precision)) issues.push(`${at}: precision must be 0–4`);
  if (!Number.isSafeInteger(dimension.textHeightNm) || dimension.textHeightNm <= 0) issues.push(`${at}: textHeightNm must be a positive integer`);
  if (!Number.isSafeInteger(dimension.strokeWidthNm) || dimension.strokeWidthNm <= 0) issues.push(`${at}: strokeWidthNm must be a positive integer`);
  return issues;
}

/**
 * Whole-board structural contract. Returns [] for a valid board; every issue
 * is a sanitized, actionable string (no raw object dumps).
 */
export function validatePcbBoardStructure(board: PcbBoard): string[] {
  const issues: string[] = [];
  const push = (issue: string): void => { if (issues.length < 64) issues.push(issue); };

  // ── Global object-id uniqueness across every identified collection ─────────
  const seenIds = new Map<string, string>();
  const claimId = (kind: string, id: string): void => {
    if (typeof id !== "string" || id.length === 0) { push(`${kind}: empty object id`); return; }
    const existing = seenIds.get(id);
    if (existing) push(`duplicate object id "${id}" (${existing} and ${kind})`);
    else seenIds.set(id, kind);
  };
  for (const item of board.footprints) claimId("footprint", item.id);
  for (const item of board.tracks) claimId("track", item.id);
  for (const item of board.vias) claimId("via", item.id);
  for (const item of board.zones) claimId("zone", item.id);
  for (const item of board.texts) claimId("text", item.id);
  for (const item of board.silkItems ?? []) claimId("silk", item.id);
  for (const item of board.padstacks ?? []) claimId("padstack", item.id);
  for (const item of board.routingKeepouts ?? []) claimId("keepout", item.id);
  for (const item of board.dimensions ?? []) claimId("dimension", item.id);

  // ── Referential integrity: nets and padstacks ──────────────────────────────
  const netIds = new Set(board.nets.map((net) => net.id));
  const padstackIds = new Set((board.padstacks ?? []).map((padstack) => padstack.id));
  for (const track of board.tracks) if (!netIds.has(track.netId)) push(`track ${track.id}: unknown net ${track.netId}`);
  for (const via of board.vias) {
    if (!netIds.has(via.netId)) push(`via ${via.id}: unknown net ${via.netId}`);
    if (via.padstackId !== undefined && !padstackIds.has(via.padstackId)) push(`via ${via.id}: dangling padstack reference ${via.padstackId}`);
  }
  for (const zone of board.zones) if (!netIds.has(zone.netId)) push(`zone ${zone.id}: unknown net ${zone.netId}`);

  // ── Dimensional sanity ─────────────────────────────────────────────────────
  for (const track of board.tracks) {
    if (!Number.isSafeInteger(track.width) || track.width <= 0) push(`track ${track.id}: non-positive width`);
    if (!isSafeVec(track.start) || !isSafeVec(track.end)) push(`track ${track.id}: non-safe-integer geometry`);
    if (samePoint(track.start, track.end)) push(`track ${track.id}: degenerate zero-length segment`);
    if (!COPPER_LAYERS.has(track.layer)) push(`track ${track.id}: non-copper layer ${String(track.layer)}`);
  }
  for (const via of board.vias) {
    if (!Number.isSafeInteger(via.size) || via.size <= 0) push(`via ${via.id}: non-positive diameter`);
    if (!Number.isSafeInteger(via.drill) || via.drill <= 0) push(`via ${via.id}: non-positive drill`);
    if (via.drill >= via.size) push(`via ${via.id}: drill ${via.drill} must be smaller than diameter ${via.size} (annular ring)`);
    if (!isSafeVec(via.at)) push(`via ${via.id}: non-safe-integer position`);
    if (!COPPER_LAYERS.has(via.layers[0]) || !COPPER_LAYERS.has(via.layers[1]) || via.layers[0] === via.layers[1]) push(`via ${via.id}: invalid layer span ${String(via.layers[0])}–${String(via.layers[1])}`);
  }
  for (const zone of board.zones) {
    if (zone.polygon.length < 3) push(`zone ${zone.id}: polygon needs at least 3 points`);
    if (zone.polygon.some((point) => !isSafeVec(point))) push(`zone ${zone.id}: non-safe-integer polygon`);
    if (!COPPER_LAYERS.has(zone.layer)) push(`zone ${zone.id}: non-copper layer ${String(zone.layer)}`);
  }
  for (const text of board.texts) {
    if (!VALID_LAYERS.has(text.layer)) push(`text ${text.id}: unknown layer ${String(text.layer)}`);
    if (!isSafeVec(text.at)) push(`text ${text.id}: non-safe-integer position`);
    if (!Number.isSafeInteger(text.sizeX) || text.sizeX <= 0 || !Number.isSafeInteger(text.sizeY) || text.sizeY <= 0 || !Number.isSafeInteger(text.thickness) || text.thickness <= 0) push(`text ${text.id}: non-positive size or stroke`);
  }
  for (const item of board.silkItems ?? []) {
    if (!SILK_LAYERS.has(item.layer)) push(`silk ${item.id}: layer must be silkTop or silkBottom`);
    if (!Number.isSafeInteger(item.strokeWidthNm) || item.strokeWidthNm <= 0) push(`silk ${item.id}: non-positive stroke width`);
    if (item.kind === "text" && (!Number.isSafeInteger(item.heightNm) || item.heightNm <= 0)) push(`silk ${item.id}: non-positive text height`);
    if (item.kind === "line" && samePoint(item.from, item.to)) push(`silk ${item.id}: degenerate zero-length line`);
    if (item.kind === "rect" && (item.corner1.x === item.corner2.x || item.corner1.y === item.corner2.y)) push(`silk ${item.id}: degenerate rectangle`);
    if (item.kind === "circle" && (!Number.isSafeInteger(item.radiusNm) || item.radiusNm <= 0)) push(`silk ${item.id}: non-positive radius`);
  }
  for (const padstack of board.padstacks ?? []) {
    if (padstack.name.trim().length === 0) push(`padstack ${padstack.id}: name must be non-empty`);
    if (padstack.kind !== "via") push(`padstack ${padstack.id}: unsupported kind ${String(padstack.kind)}`);
    if (!Number.isSafeInteger(padstack.outerNm) || padstack.outerNm <= 0 || !Number.isSafeInteger(padstack.drillNm) || padstack.drillNm <= 0) push(`padstack ${padstack.id}: non-positive diameter or drill`);
    if (padstack.drillNm >= padstack.outerNm) push(`padstack ${padstack.id}: drill ${padstack.drillNm} must be smaller than diameter ${padstack.outerNm} (annular ring)`);
  }
  for (const keepout of board.routingKeepouts ?? []) {
    if (keepout.polygon.length < 3) push(`keepout ${keepout.id}: polygon needs at least 3 points`);
    if (keepout.polygon.some((point) => !isSafeVec(point))) push(`keepout ${keepout.id}: non-safe-integer polygon`);
    if (keepout.layers.length === 0 || keepout.layers.some((layer) => !COPPER_LAYERS.has(layer))) push(`keepout ${keepout.id}: layers must be one or more copper layers`);
    if (!keepout.forbidTracks && !keepout.forbidVias) push(`keepout ${keepout.id}: must forbid tracks, vias, or both`);
  }
  for (const dimension of board.dimensions ?? []) for (const issue of validateBoardDimension(dimension)) push(issue);

  // ── Board outline ──────────────────────────────────────────────────────────
  const outline = board.outline;
  if (outline.kind === "rect" || outline.kind === "roundrect") {
    if (!Number.isSafeInteger(outline.width) || outline.width <= 0 || !Number.isSafeInteger(outline.height) || outline.height <= 0) push("outline: non-positive width or height");
    if (!isSafeVec(outline.origin)) push("outline: non-safe-integer origin");
    if (outline.kind === "roundrect" && (!Number.isSafeInteger(outline.cornerRadius) || outline.cornerRadius < 0 || outline.cornerRadius * 2 > Math.min(outline.width, outline.height))) push("outline: invalid corner radius");
  } else {
    if (outline.points.length < 3) push("outline: polygon needs at least 3 points");
    if (outline.points.some((point) => !isSafeVec(point))) push("outline: non-safe-integer polygon");
  }

  // ── Stackup ────────────────────────────────────────────────────────────────
  if (board.stackup !== 2 && board.stackup !== 4) push(`stackup: unsupported layer count ${String(board.stackup)}`);

  return issues;
}
