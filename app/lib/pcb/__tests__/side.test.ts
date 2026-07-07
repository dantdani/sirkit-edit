// Side helpers (Stage 5): oppositeLayer involution, effectivePadLayers on the
// real PinHeader THT fixture, and the mirrored render plan.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { oppositeLayer, effectivePadLayers } from "../side";
import { LAYERS, COPPER_LAYERS, type LayerId } from "../layers";
import { parseKicadMod } from "../kicad-mod";
import { planFootprint, mirrorPlan } from "../render/footprint";

function pinHeaderDef() {
  const source = readFileSync(
    fileURLToPath(
      new URL("./fixtures/PinHeader_1x02_P2.54mm_Vertical.kicad_mod", import.meta.url),
    ),
    "utf-8",
  );
  return parseKicadMod(source, "Connector_PinHeader_2.54mm");
}

describe("oppositeLayer", () => {
  it("is an involution over every layer", () => {
    for (const l of LAYERS) {
      expect(oppositeLayer(oppositeLayer(l.id))).toBe(l.id);
    }
  });

  it("swaps top/bottom pairs and fixes side-less layers", () => {
    expect(oppositeLayer("copperTop")).toBe("copperBottom");
    expect(oppositeLayer("silkTop")).toBe("silkBottom");
    expect(oppositeLayer("maskBottom")).toBe("maskTop");
    expect(oppositeLayer("pasteTop")).toBe("pasteBottom");
    expect(oppositeLayer("courtyardBottom")).toBe("courtyardTop");
    expect(oppositeLayer("fabTop")).toBe("fabBottom");
    expect(oppositeLayer("edge")).toBe("edge");
    expect(oppositeLayer("in1")).toBe("in1");
    expect(oppositeLayer("in2")).toBe("in2");
  });
});

describe("effectivePadLayers", () => {
  it("keeps THT pads on all four copper layers on either side (PinHeader fixture)", () => {
    const def = pinHeaderDef();
    const thtPads = def.pads.filter((p) => p.type === "thru_hole");
    expect(thtPads.length).toBeGreaterThan(0);
    for (const pad of thtPads) {
      for (const side of ["top", "bottom"] as const) {
        const layers = effectivePadLayers(pad, side);
        for (const cu of COPPER_LAYERS) {
          expect(layers).toContain(cu);
        }
      }
    }
  });

  it("swaps single-sided layers (mask facing) across sides", () => {
    const def = pinHeaderDef();
    const pad = def.pads.find((p) => p.layers.includes("maskTop"));
    expect(pad).toBeDefined();
    const bottom = effectivePadLayers(pad!, "bottom");
    expect(bottom).toContain("maskBottom");
    // The layer COUNT is invariant — flipping never adds or drops layers.
    expect(bottom).toHaveLength(pad!.layers.length);
  });

  it("is side-stable: top equals the authored layers", () => {
    const def = pinHeaderDef();
    for (const pad of def.pads) {
      expect(effectivePadLayers(pad, "top")).toEqual(pad.layers);
    }
  });
});

describe("mirrorPlan", () => {
  it("maps silk to the other side and mirrors X (PinHeader fixture)", () => {
    const plan = planFootprint(pinHeaderDef());
    const mirrored = mirrorPlan(plan);

    expect(plan.ops.has("silkTop")).toBe(true);
    expect(mirrored.ops.has("silkTop")).toBe(false);
    expect(mirrored.ops.has("silkBottom")).toBe(true);
    expect(mirrored.primitives).toBe(plan.primitives);

    // Every mirrored poly x equals the negated original; y is untouched.
    const orig = plan.ops.get("silkTop")!;
    const mir = mirrored.ops.get("silkBottom")!;
    expect(mir).toHaveLength(orig.length);
    orig.forEach((op, i) => {
      const m = mir[i];
      if (op.op === "poly" && m.op === "poly") {
        for (let p = 0; p < op.points.length; p += 2) {
          expect(m.points[p]).toBeCloseTo(-op.points[p], 9);
          expect(m.points[p + 1]).toBeCloseTo(op.points[p + 1], 9);
        }
      }
    });
  });

  it("keeps drill holes on the synthetic holes layer", () => {
    const plan = planFootprint(pinHeaderDef());
    const mirrored = mirrorPlan(plan);
    expect(mirrored.ops.get("holes")).toHaveLength(plan.ops.get("holes")!.length);
  });

  it("mirrors text anchors and swaps their layers", () => {
    const plan = planFootprint(pinHeaderDef());
    const mirrored = mirrorPlan(plan);
    expect(mirrored.texts).toHaveLength(plan.texts.length);
    plan.texts.forEach((t, i) => {
      const m = mirrored.texts[i];
      expect(m.xMm).toBeCloseTo(-t.xMm, 9);
      expect(m.yMm).toBeCloseTo(t.yMm, 9);
      expect(m.layer).toBe(oppositeLayer(t.layer));
    });
  });
});

// Type-level sanity: oppositeLayer accepts every LayerId (compile-time check).
const _allLayers: LayerId[] = LAYERS.map((l) => l.id);
void _allLayers;
