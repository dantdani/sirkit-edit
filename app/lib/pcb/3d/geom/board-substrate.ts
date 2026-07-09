/**
 * FR4 substrate slab (PCB Stage 15). The board outline (rect / roundrect /
 * polygon — reusing Stage 11's outline polygonizer) extruded to 1.6 mm from
 * z = 0. Mounting-hole subtraction: deferred (no holes in the model yet).
 */

import * as THREE from "three";
import type { PcbBoard, BoardOutline } from "../../types";
import { outlinePolygon } from "../../zones/geometry";
import { LAYER_HEIGHTS_MM } from "../layer-heights";
import type { Palette } from "../types";
import { toMm } from "../convert";

/** Board outline as a scene-space shape (shared with the mask slabs). */
export function outlineShape(outline: BoardOutline): THREE.Shape {
  const pts = outlinePolygon(outline, 8).map((p) => {
    const m = toMm(p);
    return new THREE.Vector2(m.x, m.y);
  });
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  return new THREE.Shape(pts);
}

export function buildBoardSubstrate(board: PcbBoard, palette: Palette): THREE.Mesh {
  const geometry = new THREE.ExtrudeGeometry(outlineShape(board.outline), {
    depth: LAYER_HEIGHTS_MM.substrate,
    bevelEnabled: false,
  });
  const material = new THREE.MeshStandardMaterial({
    color: palette.fr4,
    roughness: 0.9,
    metalness: 0.0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "substrate";
  return mesh;
}
