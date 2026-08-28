/**
 * B08 — dimension-annotation geometry (pure, no Pixi/React/DOM).
 *
 * One deterministic function turns a `BoardDimension` into world-space
 * polylines (extension lines, dimension line, arrowheads) plus stroke-font
 * label polylines — shared by the 2D renderer, the pick index, and the
 * selection overlay, so what you see is exactly what you can select.
 *
 * The measured value is DERIVED from the endpoints (never stored): the
 * geometry is the single source of truth and the label can never go stale.
 */

import type { Vec2 } from "../geometry";
import type { BBox } from "../geometry";
import { NM_PER_MM } from "../units";
import type { BoardDimension } from "../types";
import { textToPolylines } from "../silk/text-to-polylines";

const NM_PER_INCH = 25_400_000;

export interface DimensionGeometry {
  /** Extension lines, dimension line, and arrowhead strokes (world nm). */
  polylines: Vec2[][];
  /** Stroke-font glyph polylines for the value label (world nm). */
  labelPolylines: Vec2[][];
  labelText: string;
  /** Loose bbox over every stroke (pick index + selection overlay). */
  bbox: BBox;
}

/** The derived measured value in display units, formatted per precision. */
export function formatDimensionValue(dimension: BoardDimension): string {
  const spanNm = dimension.kind === "horizontal"
    ? Math.abs(dimension.b.x - dimension.a.x)
    : dimension.kind === "vertical"
      ? Math.abs(dimension.b.y - dimension.a.y)
      : Math.hypot(dimension.b.x - dimension.a.x, dimension.b.y - dimension.a.y);
  const value = dimension.unit === "mm" ? spanNm / NM_PER_MM : spanNm / NM_PER_INCH;
  return `${value.toFixed(dimension.precision)} ${dimension.unit}`;
}

function arrowhead(tip: Vec2, direction: Vec2, sizeNm: number): Vec2[][] {
  const len = Math.hypot(direction.x, direction.y) || 1;
  const ux = direction.x / len;
  const uy = direction.y / len;
  const spread = 0.35;
  const back = (sign: number): Vec2 => ({
    x: Math.round(tip.x - ux * sizeNm + -uy * sizeNm * spread * sign),
    y: Math.round(tip.y - uy * sizeNm + ux * sizeNm * spread * sign),
  });
  return [[back(1), tip], [back(-1), tip]];
}

export function dimensionGeometry(dimension: BoardDimension): DimensionGeometry {
  const { a, b, offsetNm, kind } = dimension;
  let lineA: Vec2;
  let lineB: Vec2;
  let angleDeg = 0;
  if (kind === "horizontal") {
    const y = a.y + offsetNm;
    lineA = { x: a.x, y };
    lineB = { x: b.x, y };
  } else if (kind === "vertical") {
    const x = a.x + offsetNm;
    lineA = { x, y: a.y };
    lineB = { x, y: b.y };
    angleDeg = -90;
  } else {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    lineA = { x: Math.round(a.x + nx * offsetNm), y: Math.round(a.y + ny * offsetNm) };
    lineB = { x: Math.round(b.x + nx * offsetNm), y: Math.round(b.y + ny * offsetNm) };
    // KiCad convention: CCW-positive with +y down (negate screen atan2).
    angleDeg = (-Math.atan2(dy, dx) * 180) / Math.PI;
    if (angleDeg > 90 || angleDeg <= -90) angleDeg = (angleDeg + 180) % 360; // keep the label readable
  }

  const arrowSize = Math.max(dimension.strokeWidthNm * 6, 300_000);
  const along = { x: lineB.x - lineA.x, y: lineB.y - lineA.y };
  const polylines: Vec2[][] = [
    [a, lineA],
    [b, lineB],
    [lineA, lineB],
    ...arrowhead(lineA, { x: -along.x, y: -along.y }, arrowSize),
    ...arrowhead(lineB, along, arrowSize),
  ];

  const labelText = formatDimensionValue(dimension);
  const mid = { x: Math.round((lineA.x + lineB.x) / 2), y: Math.round((lineA.y + lineB.y) / 2) };
  const lift = dimension.textHeightNm * 0.8;
  const rad = (-angleDeg * Math.PI) / 180;
  // Lift the label perpendicular to the dimension line (screen "above").
  const labelAt = { x: Math.round(mid.x + Math.sin(rad) * lift), y: Math.round(mid.y - Math.cos(rad) * lift) };
  const labelPolylines = textToPolylines({
    kind: "text",
    id: `${dimension.id}:label`,
    layer: dimension.layer === "silkBottom" || dimension.layer === "fabBottom" ? "silkBottom" : "silkTop",
    position: labelAt,
    text: labelText,
    heightNm: dimension.textHeightNm,
    strokeWidthNm: dimension.strokeWidthNm,
    rotationDeg: angleDeg,
    mirror: false,
    anchor: "center",
  });

  let minX = Number.POSITIVE_INFINITY; let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY; let maxY = Number.NEGATIVE_INFINITY;
  for (const line of [...polylines, ...labelPolylines]) {
    for (const point of line) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }
  const pad = dimension.strokeWidthNm;
  return {
    polylines,
    labelPolylines,
    labelText,
    bbox: { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad },
  };
}

/** Distance from a point to the nearest dimension stroke (hit testing). */
export function dimensionHitDistanceNm(dimension: BoardDimension, point: Vec2): number {
  const geometry = dimensionGeometry(dimension);
  let best = Number.POSITIVE_INFINITY;
  for (const line of [...geometry.polylines, ...geometry.labelPolylines]) {
    for (let i = 1; i < line.length; i++) {
      const d = segmentDistance(point, line[i - 1], line[i]);
      if (d < best) best = d;
    }
  }
  return best;
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
