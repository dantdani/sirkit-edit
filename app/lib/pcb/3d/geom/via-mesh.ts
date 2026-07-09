/**
 * Vias → instanced cylinders (PCB Stage 15). One InstancedMesh for the plated
 * barrels (finish color) + one for the drill voids (near-black, slightly
 * taller so it reads as a hole from both sides). No CSG — the dark inner
 * cylinder is the pinned visual approximation. Through-hole only (blind /
 * buried vias render full-stack; acceptable for MVP).
 */

import * as THREE from "three";
import type { Via } from "../../types";
import type { LayerSlab, StackupKey } from "../layer-heights";
import type { Palette } from "../types";
import { mmLen, toMm } from "../convert";

const DRILL_COLOR = 0x0a0a0a;
const RADIAL_SEGMENTS = 20;

/** Unit cylinder: diameter 1, height 1, axis along +Z. */
function unitCylinder(): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, RADIAL_SEGMENTS);
  g.rotateX(Math.PI / 2); // axis Y → Z
  return g;
}

export function buildViasMesh(
  vias: Via[],
  stack: Record<StackupKey, LayerSlab>,
  palette: Palette,
): THREE.Group {
  const zBottom = stack.copperBottom.zMm;
  const zTop = stack.copperTop.zMm + stack.copperTop.heightMm;
  const stackHeight = zTop - zBottom;
  const zCenter = (zTop + zBottom) / 2;

  const barrels = new THREE.InstancedMesh(
    unitCylinder(),
    new THREE.MeshStandardMaterial({ color: palette.pad, metalness: 0.7, roughness: 0.35 }),
    vias.length,
  );
  barrels.name = "via-barrels";
  const drills = new THREE.InstancedMesh(
    unitCylinder(),
    new THREE.MeshStandardMaterial({ color: DRILL_COLOR, roughness: 1 }),
    vias.length,
  );
  drills.name = "via-drills";

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  vias.forEach((via, i) => {
    const p = toMm(via.at);
    pos.set(p.x, p.y, zCenter);
    scl.set(mmLen(via.size), mmLen(via.size), stackHeight);
    barrels.setMatrixAt(i, m.compose(pos, q, scl));
    scl.set(mmLen(via.drill), mmLen(via.drill), stackHeight + 0.004);
    drills.setMatrixAt(i, m.compose(pos, q, scl));
  });
  barrels.instanceMatrix.needsUpdate = true;
  drills.instanceMatrix.needsUpdate = true;

  const group = new THREE.Group();
  group.name = "vias";
  group.add(barrels, drills);
  return group;
}
