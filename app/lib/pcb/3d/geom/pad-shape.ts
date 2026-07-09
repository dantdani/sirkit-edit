/**
 * Pad → 2D shapes (PCB Stage 15). Reuses Stage 6's `padWorldShape` (world
 * placement incl. bottom-side mirror) and Stage 11's Minkowski polygonizers,
 * so every pad kind — circle / rect / roundrect / oval / polygon — comes out
 * as one or more board-space polygons, converted to scene-mm THREE.Shapes.
 */

import * as THREE from "three";
import type { Pad, FootprintInstance } from "../../types";
import { padWorldShape } from "../../geometry-copper";
import { decomposeShape } from "../../zones/geometry";
import { inflatePointSet } from "../../zones/clipper-adapter";
import { toMm } from "../convert";

function polygonToShape(ring: readonly { x: number; y: number }[]): THREE.Shape {
  const pts = ring.map((p) => {
    const m = toMm(p);
    return new THREE.Vector2(m.x, m.y);
  });
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  return new THREE.Shape(pts);
}

/** World-space scene shapes for one pad (usually one; polygon pads may split). */
export function padShapes(inst: FootprintInstance, pad: Pad): THREE.Shape[] {
  const placed = padWorldShape(inst, pad);
  const { pts, r } = decomposeShape(placed);
  if (r <= 0 && pts.length >= 3) return [polygonToShape(pts)];
  return inflatePointSet(pts, r).map(polygonToShape);
}
