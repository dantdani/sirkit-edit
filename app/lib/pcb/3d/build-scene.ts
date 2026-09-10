/**
 * 3D scene builder (PCB Stage 15) — PINNED entry point. Pure three.js, no
 * React/DOM required (refdes sprite textures degrade gracefully under node),
 * so scene construction is unit-testable.
 *
 * Geometry strategy: everything static is MERGED — all track capsules on a
 * copper layer become ONE ExtrudeGeometry (Shape[] overload), all pads
 * another, all zone regions a third → a handful of draw calls per layer.
 * Vias are the only instanced meshes (buildViasMesh). Built once per board
 * snapshot; the caller (usePcb3d) rebuilds on mutation events throttled
 * 100 ms — nothing here runs per frame.
 *
 * Solder mask is a semi-transparent outline slab per side; pads and via
 * barrels are extruded PAST it in the finish color, which fakes mask
 * cutouts without boolean geometry (higher-fidelity cutouts deferred).
 */

import * as THREE from "three";
import type { PcbBoard, FootprintInstance } from "../types";
import type { LayerId } from "../layers";
import type { Vec2 } from "../geometry";
import { transformPoint } from "../geometry";
import { padCopperLayers } from "../geometry-copper";
import { outlinePolygon } from "../zones/geometry";
import { LAYER_HEIGHTS_MM, zStackup, type StackupKey } from "./layer-heights";
import type { BuiltScene, Palette, SceneParams } from "./types";
import { trackShape } from "./geom/track-shape";
import { zoneRegionShape } from "./geom/zone-shape";
import { padShapes } from "./geom/pad-shape";
import { buildViasMesh } from "./geom/via-mesh";
import {
  buildFootprintPlaceholder,
  buildRefdesSprite,
  isPlaceholderCandidate,
} from "./geom/footprint-mesh";
import { buildBoardSubstrate, outlineShape } from "./geom/board-substrate";
import { toMm } from "./convert";

const CURVE_SEGMENTS = 8;
const MASK_OPACITY = 0.72;
const REFDES_HEIGHT_MM = 1.0;
const MIN_SILK_WIDTH_NM = 100_000; // 0.1 mm floor for hairline silk strokes
const CIRCLE_CHORDS = 24;

type CopperLayerId = Extract<LayerId, "copperTop" | "in1" | "in2" | "copperBottom">;

function copperLayersFor(board: PcbBoard): CopperLayerId[] {
  return board.stackup === 4
    ? ["copperTop", "in1", "in2", "copperBottom"]
    : ["copperTop", "copperBottom"];
}

function extrudedMesh(
  shapes: THREE.Shape[],
  depthMm: number,
  zMm: number,
  material: THREE.Material,
  name: string,
): THREE.Mesh | null {
  if (shapes.length === 0) return null;
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: depthMm,
    bevelEnabled: false,
    curveSegments: CURVE_SEGMENTS,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = zMm;
  mesh.name = name;
  return mesh;
}

// ── Silk graphics → stroked capsule shapes ───────────────────────────────────

const SILK_FLIP: Partial<Record<LayerId, LayerId>> = {
  silkTop: "silkBottom",
  silkBottom: "silkTop",
};

function silkShapesFor(inst: FootprintInstance, target: "silkTop" | "silkBottom"): THREE.Shape[] {
  const mirror = inst.side === "bottom";
  const world = (p: Vec2): Vec2 => transformPoint(p, inst.at, inst.rotationDeg, mirror);
  const shapes: THREE.Shape[] = [];
  const stroke = (a: Vec2, b: Vec2, widthNm: number): void => {
    shapes.push(trackShape(world(a), world(b), Math.max(widthNm, MIN_SILK_WIDTH_NM)));
  };
  for (const g of inst.def.graphics) {
    const layer = mirror ? SILK_FLIP[g.layer] ?? g.layer : g.layer;
    if (layer !== target) continue;
    switch (g.kind) {
      case "line":
        stroke(g.start, g.end, g.width);
        break;
      case "rect": {
        const { start: s, end: e } = g;
        stroke(s, { x: e.x, y: s.y }, g.width);
        stroke({ x: e.x, y: s.y }, e, g.width);
        stroke(e, { x: s.x, y: e.y }, g.width);
        stroke({ x: s.x, y: e.y }, s, g.width);
        break;
      }
      case "poly": {
        for (let i = 0; i < g.points.length; i++) {
          stroke(g.points[i], g.points[(i + 1) % g.points.length], g.width);
        }
        break;
      }
      case "circle": {
        const r = Math.hypot(g.end.x - g.center.x, g.end.y - g.center.y);
        let prev: Vec2 = { x: g.center.x + r, y: g.center.y };
        for (let i = 1; i <= CIRCLE_CHORDS; i++) {
          const a = (2 * Math.PI * i) / CIRCLE_CHORDS;
          const next: Vec2 = {
            x: Math.round(g.center.x + r * Math.cos(a)),
            y: Math.round(g.center.y + r * Math.sin(a)),
          };
          stroke(prev, next, g.width);
          prev = next;
        }
        break;
      }
      case "arc":
      case "text":
        break; // deferred — placeholder fidelity only
    }
  }
  return shapes;
}

// ── The builder ──────────────────────────────────────────────────────────────

export function buildScene(board: PcbBoard, params: SceneParams): BuiltScene {
  const palette: Palette = params.palette;
  const stack = zStackup(board.stackup === 4);

  const copperMaterial = new THREE.MeshStandardMaterial({
    color: palette.copper,
    metalness: 0.6,
    roughness: 0.5,
  });
  const padMaterial = new THREE.MeshStandardMaterial({
    color: palette.pad,
    metalness: 0.8,
    roughness: 0.3,
  });
  const silkMaterial = new THREE.MeshStandardMaterial({
    color: palette.silk,
    roughness: 0.8,
    metalness: 0,
  });
  const maskMaterial = new THREE.MeshStandardMaterial({
    color: palette.mask,
    transparent: true,
    opacity: MASK_OPACITY,
    roughness: 0.55,
    metalness: 0.1,
  });

  // 1 — substrate.
  const substrate = buildBoardSubstrate(board, palette);

  // 2 — copper per layer: merged tracks + zones + pads.
  const copperMeshesByLayer = new Map<LayerId, THREE.Object3D>();
  for (const layer of copperLayersFor(board)) {
    const slab = stack[layer as StackupKey];
    const group = new THREE.Group();
    group.name = `copper:${layer}`;

    const tracks = board.tracks.filter((t) => t.layer === layer);
    const trackMesh = extrudedMesh(
      tracks.map((t) => trackShape(t.start, t.end, t.width)),
      slab.heightMm,
      slab.zMm,
      copperMaterial,
      "tracks",
    );
    if (trackMesh) group.add(trackMesh);

    const zoneShapes: THREE.Shape[] = [];
    for (const zone of board.zones) {
      if (zone.layer !== layer) continue;
      for (const region of zone.fill) zoneShapes.push(zoneRegionShape(region));
    }
    const zoneMesh = extrudedMesh(zoneShapes, slab.heightMm, slab.zMm, copperMaterial, "zones");
    if (zoneMesh) {
      zoneMesh.visible = params.showZones;
      group.add(zoneMesh);
    }

    // Pads only on outer layers; they extrude PAST the mask in finish color.
    if (layer === "copperTop" || layer === "copperBottom") {
      const shapes: THREE.Shape[] = [];
      for (const inst of board.footprints) {
        for (const pad of inst.def.pads) {
          if (pad.type === "np_thru_hole") continue;
          if (!padCopperLayers(inst, pad).includes(layer)) continue;
          shapes.push(...padShapes(inst, pad));
        }
      }
      const depth = slab.heightMm + LAYER_HEIGHTS_MM.mask + 0.002;
      const z = layer === "copperTop" ? slab.zMm : slab.zMm - LAYER_HEIGHTS_MM.mask - 0.002;
      const padMesh = extrudedMesh(shapes, depth, z, padMaterial, "pads");
      if (padMesh) group.add(padMesh);
    }

    group.visible = params.showCopper ?? true;
    copperMeshesByLayer.set(layer, group);
  }

  // 3 — vias.
  const vias = buildViasMesh(board.vias, stack, palette);
  vias.visible = params.showVias ?? true;
  substrate.visible = params.showSubstrate ?? true;

  // 4 — silk (footprint graphics; board texts + arcs deferred).
  const buildSilk = (target: "silkTop" | "silkBottom"): THREE.Object3D => {
    const group = new THREE.Group();
    group.name = target;
    const shapes = board.footprints.flatMap((inst) => silkShapesFor(inst, target));
    const slab = stack[target];
    const mesh = extrudedMesh(shapes, slab.heightMm, slab.zMm, silkMaterial, `${target}-strokes`);
    if (mesh) group.add(mesh);
    group.visible = (target === "silkTop" ? params.showSilkTop : params.showSilkBottom) ?? params.showSilk;
    return group;
  };
  const silkTop = buildSilk("silkTop");
  const silkBottom = buildSilk("silkBottom");

  // 5 — solder mask slabs (the "green plastic feel" layer).
  const mask = new THREE.Group();
  mask.name = "mask";
  const boardShape = outlineShape(board.outline);
  for (const key of ["maskTop", "maskBottom"] as const) {
    const slab = stack[key];
    const mesh = extrudedMesh([boardShape], slab.heightMm, slab.zMm, maskMaterial, key);
    if (mesh) mask.add(mesh);
  }
  mask.visible = params.showMask;

  // 6 — footprint placeholders + refdes billboards (separately toggleable).
  const footprints = new THREE.Group();
  footprints.name = "footprints";
  const refdesLabels = new THREE.Group();
  refdesLabels.name = "refdes-labels";
  for (const inst of board.footprints) {
    if (!isPlaceholderCandidate(inst)) continue;
    footprints.add(
      buildFootprintPlaceholder(inst, palette, { showRefdes: false, heightMm: REFDES_HEIGHT_MM }),
    );
    refdesLabels.add(buildRefdesSprite(inst, palette, REFDES_HEIGHT_MM));
  }
  footprints.visible = params.showFootprints;
  refdesLabels.visible = params.showRefdes;

  // 7 — bounds (scene mm) for camera framing.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outlinePolygon(board.outline, 4)) {
    const m = toMm(p);
    minX = Math.min(minX, m.x);
    minY = Math.min(minY, m.y);
    maxX = Math.max(maxX, m.x);
    maxY = Math.max(maxY, m.y);
  }

  return {
    substrate,
    copperMeshesByLayer,
    vias,
    silkTop,
    silkBottom,
    mask,
    footprints,
    refdesLabels,
    boardBoundingBoxMm: { minX, minY, maxX, maxY },
  };
}

/** Free every geometry/material/texture a built scene owns (rebuild hygiene). */
export function disposeScene(scene: BuiltScene): void {
  const roots: THREE.Object3D[] = [
    scene.substrate,
    ...scene.copperMeshesByLayer.values(),
    scene.vias,
    scene.silkTop,
    scene.silkBottom,
    scene.mask,
    scene.footprints,
    scene.refdesLabels,
  ];
  for (const root of roots) {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of materials) {
          if ("map" in mat && mat.map instanceof THREE.Texture) mat.map.dispose();
          mat.dispose();
        }
        if ("geometry" in obj && obj.geometry instanceof THREE.BufferGeometry) {
          obj.geometry.dispose();
        }
      }
    });
  }
}
