/**
 * Track → 2D capsule shape (PCB Stage 15). A rectangle along the centerline
 * with half-circle end caps, in scene mm (y-flipped). Extruded by copper
 * thickness in build-scene. Zero-length tracks degrade to a circle.
 */

import * as THREE from "three";
import type { Vec2 } from "../../geometry";
import { mmLen, toMm } from "../convert";

export function trackShape(a: Vec2, b: Vec2, widthNm: number): THREE.Shape {
  const A = toMm(a);
  const B = toMm(b);
  const r = mmLen(widthNm) / 2;
  const shape = new THREE.Shape();
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    shape.absarc(A.x, A.y, r, 0, Math.PI * 2, false);
    return shape;
  }
  const theta = Math.atan2(dy, dx);
  const nx = -dy / len; // left normal
  const ny = dx / len;
  shape.moveTo(A.x + nx * r, A.y + ny * r);
  shape.lineTo(B.x + nx * r, B.y + ny * r);
  shape.absarc(B.x, B.y, r, theta + Math.PI / 2, theta - Math.PI / 2, true); // far cap
  shape.lineTo(A.x - nx * r, A.y - ny * r);
  shape.absarc(A.x, A.y, r, theta - Math.PI / 2, theta + Math.PI / 2, true); // near cap
  shape.closePath();
  return shape;
}
