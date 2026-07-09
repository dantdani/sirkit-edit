// Silk item geometry (PCB Stage 16): stroke primitives → shapes/polygons for
// DRC clearance math and anything that needs polygonized silk. Reuses Stage
// 6's capsule idea (a stroked segment is an oval PlacedShape) and Stage 11's
// capsulePolygon/circlePolygon for explicit outlines — no new geometry math.

import type { Vec2, PlacedShape } from "../geometry";
import { capsulePolygon, circlePolygon } from "../zones/geometry";
import type { SilkItem, SilkRectItem } from "./types";
import { textToPolylines } from "./text-to-polylines";

/** Segment swept by strokeWidth/2 → oval PlacedShape (Stage 6's trackShape trick). */
function segmentShape(a: Vec2, b: Vec2, strokeWidthNm: number): PlacedShape {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    return { shape: { kind: "circle", radius: strokeWidthNm / 2 }, at: a, rotationDeg: 0 };
  }
  return {
    shape: { kind: "oval", width: len + strokeWidthNm, height: strokeWidthNm },
    at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    rotationDeg: (-Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

function rectCorners(item: SilkRectItem): Vec2[] {
  const x0 = Math.min(item.corner1.x, item.corner2.x);
  const y0 = Math.min(item.corner1.y, item.corner2.y);
  const x1 = Math.max(item.corner1.x, item.corner2.x);
  const y1 = Math.max(item.corner1.y, item.corner2.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

/** Every stroke of the item as world polylines (text glyphs, outline edges…). */
export function silkItemPolylines(item: SilkItem): Vec2[][] {
  switch (item.kind) {
    case "text":
      return textToPolylines(item);
    case "line":
      return [[item.from, item.to]];
    case "rect": {
      const c = rectCorners(item);
      return [[...c, c[0]]];
    }
    case "circle":
      if (item.radiusNm <= 0) return [];
      return [
        (() => {
          const ring = circlePolygon(item.center, item.radiusNm, 32);
          return [...ring, ring[0]];
        })(),
      ];
  }
}

/**
 * Placed shapes for clearance math (DRC's silk-over-pad loop). Filled rect /
 * circle become one solid shape; everything else is a capsule per stroke
 * segment — exact under Stage 1's shapeDistance.
 */
export function silkItemShapes(item: SilkItem): PlacedShape[] {
  if (item.kind === "rect" && item.filled) {
    const c = rectCorners(item);
    const w = c[1].x - c[0].x + item.strokeWidthNm;
    const h = c[3].y - c[0].y + item.strokeWidthNm;
    return [
      {
        shape: { kind: "rect", width: w, height: h },
        at: { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 },
        rotationDeg: 0,
      },
    ];
  }
  if (item.kind === "circle" && item.filled) {
    return [
      {
        shape: { kind: "circle", radius: item.radiusNm + item.strokeWidthNm / 2 },
        at: item.center,
        rotationDeg: 0,
      },
    ];
  }
  const shapes: PlacedShape[] = [];
  for (const polyline of silkItemPolylines(item)) {
    for (let i = 0; i + 1 < polyline.length; i++) {
      shapes.push(segmentShape(polyline[i], polyline[i + 1], item.strokeWidthNm));
    }
  }
  return shapes;
}

/** Outline polygons of the inked area (pinned API — polygonized silk). */
export function silkItemPolygons(item: SilkItem): Vec2[][] {
  if (item.kind === "rect" && item.filled) {
    const c = rectCorners(item);
    const half = Math.round(item.strokeWidthNm / 2);
    return [
      [
        { x: c[0].x - half, y: c[0].y - half },
        { x: c[1].x + half, y: c[1].y - half },
        { x: c[2].x + half, y: c[2].y + half },
        { x: c[3].x - half, y: c[3].y + half },
      ],
    ];
  }
  if (item.kind === "circle" && item.filled) {
    return [circlePolygon(item.center, item.radiusNm + item.strokeWidthNm / 2, 32)];
  }
  const out: Vec2[][] = [];
  for (const polyline of silkItemPolylines(item)) {
    for (let i = 0; i + 1 < polyline.length; i++) {
      out.push(capsulePolygon(polyline[i], polyline[i + 1], item.strokeWidthNm / 2));
    }
  }
  return out;
}
