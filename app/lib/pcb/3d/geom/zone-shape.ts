/**
 * Zone fill region → 2D shape with holes (PCB Stage 15). Stage 11's
 * `FilledRegion` rings carry no guaranteed winding; three.js triangulation
 * expects outer CCW / holes CW, so both are normalized here (in scene space,
 * i.e. AFTER the y flip — the flip reverses winding, which is exactly why we
 * check post-conversion).
 */

import * as THREE from "three";
import type { Vec2 } from "../../geometry";
import type { FilledRegion } from "../../types";
import { toMm } from "../convert";

function toVector2s(ring: readonly Vec2[]): THREE.Vector2[] {
  return ring.map((p) => {
    const m = toMm(p);
    return new THREE.Vector2(m.x, m.y);
  });
}

export function zoneRegionShape(region: FilledRegion): THREE.Shape {
  const outer = toVector2s(region.outer);
  if (THREE.ShapeUtils.isClockWise(outer)) outer.reverse();
  const shape = new THREE.Shape(outer);
  for (const hole of region.holes) {
    if (hole.length < 3) continue;
    const pts = toVector2s(hole);
    if (!THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    shape.holes.push(new THREE.Path(pts));
  }
  return shape;
}
