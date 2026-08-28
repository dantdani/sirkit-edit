/**
 * B07.1 — the shared schematic geometry contract.
 *
 * One source of truth for what canonical schematic coordinates ARE: finite,
 * safe-integer, exactly aligned to the editor's real 10-px grid
 * (`GRID` from app/lib/geometry — no duplicated magic number), and inside
 * the supported coordinate bound. Used by canonical operation application,
 * the validating canonical reader (hydration and every post-transaction
 * check), and tests.
 *
 * Bounds: the sheet/page model (PAGE_SIZES_MM) defines the PRINT/EXPORT
 * area, but the editor deliberately allows placing geometry outside the
 * sheet (pan is unbounded and nothing clamps placement) — so the sheet is
 * NOT the canonical bound. The canonical contract bound is ±1,000,000 px
 * (±100,000 grid cells; orders of magnitude beyond any sheet, far inside
 * the safe-integer range), preserving every valid existing project while
 * rejecting runaway or forged coordinates.
 *
 * Trusted UI paths snap BEFORE constructing commands; the canonical
 * executor independently REJECTS off-grid/out-of-range operations — it
 * never silently snaps a provider, replay, forged, or stale operation.
 * Errors use the truthful INVALID_PX vocabulary (these are schematic pixel
 * coordinates, not board nanometres).
 */

import { GRID } from "../geometry";

export const SCHEMATIC_GRID_PX = GRID;
export const SCHEMATIC_COORDINATE_BOUND_PX = 1_000_000;

export type SchematicGeometryIssue = string;

/** Validate one canonical coordinate value. Returns issues (empty = valid). */
export function validateSchematicCoordinate(value: unknown, path: string): SchematicGeometryIssue[] {
  if (typeof value !== "number" || !Number.isFinite(value)) return [`INVALID_PX:${path}: coordinate must be a finite number`];
  if (!Number.isSafeInteger(value)) return [`INVALID_PX:${path}: coordinate must be a safe integer`];
  if (Math.abs(value) > SCHEMATIC_COORDINATE_BOUND_PX) return [`INVALID_PX:${path}: coordinate exceeds the supported bound (±${SCHEMATIC_COORDINATE_BOUND_PX})`];
  if (value % SCHEMATIC_GRID_PX !== 0) return [`INVALID_PX:${path}: coordinate is off the ${SCHEMATIC_GRID_PX}px schematic grid`];
  return [];
}

export function validateSchematicPoint(value: unknown, path: string): SchematicGeometryIssue[] {
  if (typeof value !== "object" || value === null) return [`INVALID_PX:${path}: point must be an object`];
  const point = value as { x?: unknown; y?: unknown };
  return [...validateSchematicCoordinate(point.x, `${path}.x`), ...validateSchematicCoordinate(point.y, `${path}.y`)];
}

export function validateSchematicRotation(value: unknown, path: string): SchematicGeometryIssue[] {
  return value === 0 || value === 90 || value === 180 || value === 270 ? [] : [`INVALID_PX:${path}: rotation must be 0|90|180|270`];
}

/**
 * Validate a wire vertex array: well-formed, ≥2 vertices, every vertex on
 * the contract, no adjacent duplicate vertices, no zero-length wire (all
 * vertices identical).
 */
export function validateSchematicWireVertices(value: unknown, path: string): SchematicGeometryIssue[] {
  if (!Array.isArray(value)) return [`INVALID_PX:${path}: vertices must be an array`];
  const issues: SchematicGeometryIssue[] = [];
  if (value.length < 2) issues.push(`INVALID_PX:${path}: a wire needs at least two vertices`);
  value.forEach((vertex, index) => issues.push(...validateSchematicPoint(vertex, `${path}[${index}]`)));
  if (issues.length > 0) return issues;
  const vertices = value as Array<{ x: number; y: number }>;
  for (let index = 1; index < vertices.length; index += 1) {
    if (vertices[index].x === vertices[index - 1].x && vertices[index].y === vertices[index - 1].y) {
      issues.push(`INVALID_PX:${path}[${index}]: adjacent duplicate vertex`);
    }
  }
  const first = vertices[0];
  if (vertices.every((vertex) => vertex.x === first.x && vertex.y === first.y)) {
    issues.push(`INVALID_PX:${path}: zero-length wire geometry`);
  }
  return issues;
}
