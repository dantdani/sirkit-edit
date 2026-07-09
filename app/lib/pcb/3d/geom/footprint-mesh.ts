/**
 * Footprint placeholders (PCB Stage 15). No VRML/STEP — each footprint is a
 * dark plastic box sized to its courtyard (body bbox fallback), sitting on
 * the silk surface of its side, plus an optional refdes billboard sprite.
 *
 * The sprite texture is drawn on a 2D canvas, so it only materializes in a
 * browser; under node (unit tests) the sprite is created untextured — scene
 * structure stays identical.
 */

import * as THREE from "three";
import type { BBox, Vec2 } from "../../geometry";
import { transformPoint } from "../../geometry";
import type { FootprintInstance } from "../../types";
import { LAYER_HEIGHTS_MM } from "../layer-heights";
import type { Palette } from "../types";
import { toMm } from "../convert";

const MIN_BODY_MM = 0.6; // degenerate bboxes still render a visible nub
const LABEL_LIFT_MM = 1.5;

/** Should this instance get a placeholder at all? (fiducials/logos: no) */
export function isPlaceholderCandidate(inst: FootprintInstance): boolean {
  return inst.def.pads.length > 0 && !inst.def.attributes.excludeFromPos;
}

/** World-space (scene mm) bbox of the instance's courtyard/body. */
function worldBBoxMm(inst: FootprintInstance): { cx: number; cy: number; w: number; h: number } {
  const b: BBox = inst.def.courtyardBBox ?? inst.def.bodyBBox;
  const corners: Vec2[] = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    const p = toMm(transformPoint(c, inst.at, inst.rotationDeg, inst.side === "bottom"));
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: Math.max(maxX - minX, MIN_BODY_MM),
    h: Math.max(maxY - minY, MIN_BODY_MM),
  };
}

/** Top face of the silk stack per side — the surface parts sit on. */
function mountZ(side: "top" | "bottom"): number {
  const surface = LAYER_HEIGHTS_MM.copper + LAYER_HEIGHTS_MM.mask + LAYER_HEIGHTS_MM.silk;
  return side === "top" ? LAYER_HEIGHTS_MM.substrate + surface : -surface;
}

/** Billboard sprite with the refdes text (untextured under node). */
export function buildRefdesSprite(
  inst: FootprintInstance,
  palette: Palette,
  heightMm: number,
): THREE.Sprite {
  let material: THREE.SpriteMaterial;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.font = "bold 64px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = `#${palette.refdesText.toString(16).padStart(6, "0")}`;
      ctx.fillText(inst.ref, canvas.width / 2, canvas.height / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  } else {
    material = new THREE.SpriteMaterial({ transparent: true });
  }
  const sprite = new THREE.Sprite(material);
  sprite.name = `refdes:${inst.ref}`;
  const { cx, cy } = worldBBoxMm(inst);
  const dir = inst.side === "top" ? 1 : -1;
  const z = mountZ(inst.side) + dir * (LAYER_HEIGHTS_MM.footprintPlastic + LABEL_LIFT_MM);
  sprite.position.set(cx, cy, z);
  sprite.scale.set(heightMm * (256 / 96), heightMm, 1);
  return sprite;
}

/**
 * PINNED entry: dark box on the courtyard footprint + (optionally) the refdes
 * sprite as a child. build-scene keeps labels in their own toggleable group,
 * so it calls this with `showRefdes: false` and builds sprites separately.
 */
export function buildFootprintPlaceholder(
  footprint: FootprintInstance,
  palette: Palette,
  labelStyle: { showRefdes: boolean; heightMm: number },
): THREE.Group {
  const group = new THREE.Group();
  group.name = `footprint:${footprint.ref}`;
  const { cx, cy, w, h } = worldBBoxMm(footprint);
  const dir = footprint.side === "top" ? 1 : -1;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, LAYER_HEIGHTS_MM.footprintPlastic),
    new THREE.MeshStandardMaterial({ color: palette.footprintPlastic, roughness: 0.85, metalness: 0.05 }),
  );
  box.position.set(cx, cy, mountZ(footprint.side) + (dir * LAYER_HEIGHTS_MM.footprintPlastic) / 2);
  group.add(box);
  if (labelStyle.showRefdes) {
    group.add(buildRefdesSprite(footprint, palette, labelStyle.heightMm));
  }
  return group;
}
