/**
 * 3D preview scene model (PCB Stage 15) — PINNED.
 *
 * Coordinate convention: the scene works in MILLIMETERS with the board lying
 * in the XY plane and +Z as the board's top normal. Board-space +y points
 * DOWN (KiCad), so the nm→mm conversion NEGATES y — the board reads correctly
 * when viewed from +Z. All conversions happen at geometry-build time; nothing
 * downstream sees nanometers.
 */

import type * as THREE from "three";
import type { LayerId } from "../layers";

export interface Palette {
  fr4: number; // substrate edge color
  copper: number; // bare copper (tracks/zones under mask)
  pad: number; // finish color (HASL silver / ENIG gold)
  silk: number;
  mask: number;
  footprintPlastic: number;
  refdesText: number;
  background: number;
}

export interface SceneParams {
  palette: Palette;
  showMask: boolean;
  /** Both silkscreens; `showSilkTop` / `showSilkBottom` override it per side ([B17-C] independent silkscreens). */
  showSilk: boolean;
  showSilkTop?: boolean;
  showSilkBottom?: boolean;
  showZones: boolean;
  showFootprints: boolean;
  showRefdes: boolean;
  /** [B17-C] default true: copper (tracks + pads), vias, board substrate. */
  showCopper?: boolean;
  showVias?: boolean;
  showSubstrate?: boolean;
  cameraPreset?: "top" | "bottom" | "iso";
}

export interface BuiltScene {
  substrate: THREE.Mesh;
  /** One group per copper layer: tracks + zones (child named "zones") + pads. */
  copperMeshesByLayer: Map<LayerId, THREE.Object3D>;
  /** Group of two InstancedMeshes: plated barrels + dark drill voids. */
  vias: THREE.Object3D;
  silkTop: THREE.Object3D;
  silkBottom: THREE.Object3D;
  /** Semi-transparent solder-mask slabs (child names "maskTop"/"maskBottom"). */
  mask: THREE.Object3D;
  footprints: THREE.Object3D;
  /** Billboard sprites, one per refdes (canvas-textured; empty in node tests). */
  refdesLabels: THREE.Object3D;
  /** Scene-space (mm, y-flipped) bounds of the board outline. */
  boardBoundingBoxMm: { minX: number; minY: number; maxX: number; maxY: number };
}
