import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseKicadMod } from "../../kicad-mod";
import { transformPoint } from "../../geometry";
import { mmToNm } from "../../units";
import { planFootprint, pixiRotation, rotateLocalMm } from "../footprint";

function readFixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../__tests__/fixtures/${name}`, import.meta.url)),
    "utf-8",
  );
}

describe("planFootprint — R_0805_2012Metric", () => {
  const def = parseKicadMod(readFixture("R_0805_2012Metric.kicad_mod"), "Resistor_SMD");
  const plan = planFootprint(def);

  it("counts 9 primitives total (2 pads + 4 graphics + 3 texts)", () => {
    expect(plan.primitives).toBe(9);
    expect(plan.texts).toHaveLength(3);
  });

  it("produces the expected per-layer primitive counts", () => {
    const counts = Object.fromEntries(plan.perLayerPrimitives);
    expect(counts).toEqual({
      copperTop: 2, // both SMD pads
      maskTop: 2, // pad shapes repeat on mask…
      pasteTop: 2, // …and paste
      silkTop: 3, // 2 silk lines + reference text
      courtyardTop: 1,
      fabTop: 3, // fab outline + value text + user text
    });
  });

  it("emits no drill holes for an SMD-only footprint", () => {
    expect(plan.ops.has("holes")).toBe(false);
  });
});

describe("planFootprint — PinHeader (THT)", () => {
  const def = parseKicadMod(
    readFixture("PinHeader_1x02_P2.54mm_Vertical.kicad_mod"),
    "Connector_PinHeader_2.54mm",
  );
  const plan = planFootprint(def);

  it("draws THT pads on every copper layer and their drills in holes", () => {
    const counts = Object.fromEntries(plan.perLayerPrimitives);
    expect(counts.copperTop).toBe(2);
    expect(counts.in1).toBe(2);
    expect(counts.in2).toBe(2);
    expect(counts.copperBottom).toBe(2);
    expect(counts.holes).toBe(2);
  });
});

describe("rotation mapping (KiCad CCW +y-down → Pixi CW radians)", () => {
  it("pixiRotation(90°) = -π/2", () => {
    expect(pixiRotation(90)).toBeCloseTo(-Math.PI / 2, 12);
    expect(pixiRotation(0)).toBe(-0);
    expect(pixiRotation(-180)).toBeCloseTo(Math.PI, 12);
  });

  it("a pad at local (1, 0) mm on a 90°-rotated instance lands at (0, -1) mm (screen up)", () => {
    // Render-side math (mm floats)…
    const p = rotateLocalMm(1, 0, 90);
    expect(p.x).toBeCloseTo(0, 12);
    expect(p.y).toBeCloseTo(-1, 12);
    // …must agree with Stage 1's model-space transform (integer nm).
    const world = transformPoint(
      { x: mmToNm(1), y: 0 },
      { x: mmToNm(10), y: mmToNm(20) },
      90,
    );
    expect(world).toEqual({ x: mmToNm(10), y: mmToNm(19) });
  });

  it("world-space pad position = instance at + rotated local offset", () => {
    // Instance at (30, 40) mm rotated 270° CCW: local (2, 1) → (-1, 2).
    const local = rotateLocalMm(2, 1, 270);
    expect(local.x).toBeCloseTo(-1, 12);
    expect(local.y).toBeCloseTo(2, 12);
    const world = transformPoint(
      { x: mmToNm(2), y: mmToNm(1) },
      { x: mmToNm(30), y: mmToNm(40) },
      270,
    );
    expect(world).toEqual({ x: mmToNm(29), y: mmToNm(42) });
  });
});
