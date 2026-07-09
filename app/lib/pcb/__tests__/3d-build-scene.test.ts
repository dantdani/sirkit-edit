// 3D scene construction (PCB Stage 15) — unit tests on the built scene graph,
// NOT on rendering (no headless GL; visual checks are manual for MVP).

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createEmptyBoard } from "../types";
import { buildRoutedDemo } from "../demo/routed-demo";
import { computeFill } from "../zones/compute-fill";
import { makeEffectiveClearance } from "../zones/types";
import { makePlaneZone } from "../zones/plane";
import { buildScene, disposeScene } from "../3d/build-scene";
import { zStackup, LAYER_HEIGHTS_MM } from "../3d/layer-heights";
import { PALETTES, DEFAULT_PALETTE_ID } from "../3d/palette";
import type { SceneParams } from "../3d/types";

function params(overrides?: Partial<SceneParams>): SceneParams {
  return {
    palette: PALETTES[DEFAULT_PALETTE_ID],
    showMask: true,
    showSilk: true,
    showZones: true,
    showFootprints: true,
    showRefdes: true,
    ...overrides,
  };
}

function childNames(obj: THREE.Object3D): string[] {
  return obj.children.map((c) => c.name);
}

function viaInstanceCount(vias: THREE.Object3D): number {
  const barrels = vias.children.find((c) => c.name === "via-barrels");
  return barrels instanceof THREE.InstancedMesh ? barrels.count : -1;
}

describe("buildScene", () => {
  it("(a) empty board → substrate + empty copper groups + zero via instances", () => {
    const scene = buildScene(createEmptyBoard(), params());
    expect(scene.substrate).toBeInstanceOf(THREE.Mesh);
    expect([...scene.copperMeshesByLayer.keys()]).toEqual(["copperTop", "copperBottom"]);
    for (const group of scene.copperMeshesByLayer.values()) {
      expect(group.children).toHaveLength(0);
    }
    expect(viaInstanceCount(scene.vias)).toBe(0);
    expect(scene.footprints.children).toHaveLength(0);
    // 100×80 board at origin; y flipped in scene space.
    expect(scene.boardBoundingBoxMm).toEqual({ minX: 0, minY: -80, maxX: 100, maxY: 0 });
    disposeScene(scene);
  });

  it("(b) routed demo with poured zone → tracks/zones/pads per side, 2 vias, 8 footprints", () => {
    const board = buildRoutedDemo();
    // Full-board GND plane (the fixture's own zone overlaps no GND copper).
    const zone = makePlaneZone(board, "copperTop", 1);
    board.zones = [zone];
    zone.fill = computeFill({
      board,
      zone,
      effectiveClearance: makeEffectiveClearance(board, zone),
    }).regions;

    const scene = buildScene(board, params());
    const top = scene.copperMeshesByLayer.get("copperTop");
    const bottom = scene.copperMeshesByLayer.get("copperBottom");
    expect(top && childNames(top).sort()).toEqual(["pads", "tracks", "zones"]);
    expect(bottom && childNames(bottom).sort()).toEqual(["pads", "tracks"]); // no bottom zone
    expect(viaInstanceCount(scene.vias)).toBe(2);
    expect(scene.footprints.children).toHaveLength(8);
    expect(scene.refdesLabels.children).toHaveLength(8);
    // Silk strokes exist for the demo footprints.
    expect(scene.silkTop.children.length).toBeGreaterThanOrEqual(1);
    disposeScene(scene);
  });

  it("(c) 4-layer board → four copper groups at correctly-spaced Z heights", () => {
    const board = createEmptyBoard();
    board.stackup = 4;
    const scene = buildScene(board, params());
    expect([...scene.copperMeshesByLayer.keys()]).toEqual([
      "copperTop",
      "in1",
      "in2",
      "copperBottom",
    ]);
    const stack = zStackup(true);
    expect(stack.copperTop.zMm).toBeCloseTo(LAYER_HEIGHTS_MM.substrate, 6);
    expect(stack.copperBottom.zMm).toBeCloseTo(-LAYER_HEIGHTS_MM.copper, 6);
    // Inner layers strictly ordered inside the core, evenly spaced thirds.
    expect(stack.in1.zMm).toBeGreaterThan(stack.in2.zMm);
    expect(stack.in2.zMm).toBeGreaterThan(stack.copperBottom.zMm);
    expect(stack.copperTop.zMm).toBeGreaterThan(stack.in1.zMm);
    expect(stack.in1.zMm).toBeCloseTo((LAYER_HEIGHTS_MM.substrate * 2) / 3 - LAYER_HEIGHTS_MM.copper / 2, 6);
    expect(stack.in2.zMm).toBeCloseTo(LAYER_HEIGHTS_MM.substrate / 3 - LAYER_HEIGHTS_MM.copper / 2, 6);
    disposeScene(scene);
  });

  it("(d) showSilk/showMask/showZones/showFootprints params drive visibility flags", () => {
    const board = buildRoutedDemo();
    const scene = buildScene(
      board,
      params({ showSilk: false, showMask: false, showFootprints: false, showRefdes: false }),
    );
    expect(scene.silkTop.visible).toBe(false);
    expect(scene.silkBottom.visible).toBe(false);
    expect(scene.mask.visible).toBe(false);
    expect(scene.footprints.visible).toBe(false);
    expect(scene.refdesLabels.visible).toBe(false);
    disposeScene(scene);
  });
});
