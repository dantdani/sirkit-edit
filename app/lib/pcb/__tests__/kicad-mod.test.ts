import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseKicadMod } from "../kicad-mod";
import { COPPER_LAYERS } from "../layers";

function readFixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf-8",
  );
}

describe("R_0805_2012Metric", () => {
  const src = readFixture("R_0805_2012Metric.kicad_mod");
  const def = parseKicadMod(src, "Resistor_SMD");

  it("parses identity and raw source", () => {
    expect(def.libName).toBe("Resistor_SMD");
    expect(def.name).toBe("R_0805_2012Metric");
    expect(def.description).toContain("0805");
    expect(def.rawSexpr).toBe(src);
  });

  it("has exactly 2 smd roundrect pads on top copper", () => {
    expect(def.pads).toHaveLength(2);
    for (const pad of def.pads) {
      expect(pad.type).toBe("smd");
      expect(pad.shape.kind).toBe("roundrect");
      expect(pad.layers).toContain("copperTop");
    }
    expect(def.attributes.smd).toBe(true);
  });

  it("computes courtyard and body bboxes", () => {
    expect(def.courtyardBBox).toBeDefined();
    expect(def.bodyBBox.maxX).toBeGreaterThan(def.bodyBBox.minX);
    expect(def.bodyBBox.maxY).toBeGreaterThan(def.bodyBBox.minY);
  });
});

describe("LQFP-48_7x7mm_P0.5mm", () => {
  const src = readFixture("LQFP-48_7x7mm_P0.5mm.kicad_mod");
  const def = parseKicadMod(src, "Package_QFP");

  it("has 48 smd pads", () => {
    expect(def.pads).toHaveLength(48);
    for (const pad of def.pads) {
      expect(pad.type).toBe("smd");
    }
  });
});

describe("PinHeader_1x02_P2.54mm_Vertical", () => {
  const src = readFixture("PinHeader_1x02_P2.54mm_Vertical.kicad_mod");
  const def = parseKicadMod(src, "Connector_PinHeader_2.54mm");

  it("has 2 thru-hole pads with 1 mm drills on all four copper layers", () => {
    expect(def.pads).toHaveLength(2);
    for (const pad of def.pads) {
      expect(pad.type).toBe("thru_hole");
      expect(pad.drill?.diameter).toBe(1_000_000);
      for (const copper of COPPER_LAYERS) {
        expect(pad.layers).toContain(copper);
      }
    }
    expect(def.attributes.throughHole).toBe(true);
  });

  it("resolves reference/value property nodes to text graphics", () => {
    const texts = def.graphics.filter((g) => g.kind === "text");
    expect(texts.some((t) => t.kind === "text" && t.textKind === "reference")).toBe(true);
    expect(texts.some((t) => t.kind === "text" && t.textKind === "value")).toBe(true);
  });

  it("captures the 3D model reference", () => {
    expect(def.models).toHaveLength(1);
    expect(def.models[0].path).toContain("PinHeader_1x02_P2.54mm_Vertical");
  });
});

describe("inline edge cases", () => {
  const src = `(footprint "Test_FP"
	(layer "F.Cu")
	(descr "synthetic test footprint")
	(attr through_hole exclude_from_bom exclude_from_pos_files)
	(fp_arc
		(start -1 0)
		(mid 0 -1)
		(end 1 0)
		(stroke (width 0.2) (type solid))
		(layer "F.SilkS")
	)
	(fp_circle
		(center 0 0)
		(end 0.5 0)
		(stroke (width 0.1) (type solid))
		(fill yes)
		(layer "F.Fab")
	)
	(fp_line
		(start 0 0)
		(end 1 1)
		(stroke (width 0.1) (type solid))
		(layer "Dwgs.User")
	)
	(mystery_node_from_the_future (nested (deeply yes)) 42)
	(pad "1" thru_hole oval
		(at 1.5 0 90)
		(size 1.6 2.2)
		(drill oval 0.8 1.4
			(offset 0.1 -0.2)
		)
		(layers "*.Cu" "*.Mask")
	)
)
`;
  const warnings: string[] = [];
  const def = parseKicadMod(src, "Synthetic", warnings);

  it("parses attributes", () => {
    expect(def.attributes).toEqual({
      smd: false,
      throughHole: true,
      excludeFromPos: true,
      excludeFromBom: true,
    });
  });

  it("parses arcs", () => {
    const arc = def.graphics.find((g) => g.kind === "arc");
    expect(arc).toBeDefined();
    if (arc?.kind !== "arc") return;
    expect(arc.mid).toEqual({ x: 0, y: -1_000_000 });
    expect(arc.width).toBe(200_000);
    expect(arc.layer).toBe("silkTop");
  });

  it("parses filled circles", () => {
    const circle = def.graphics.find((g) => g.kind === "circle");
    expect(circle).toBeDefined();
    if (circle?.kind !== "circle") return;
    expect(circle.fill).toBe(true);
    expect(circle.end).toEqual({ x: 500_000, y: 0 });
  });

  it("parses oval drills with offset", () => {
    expect(def.pads).toHaveLength(1);
    const pad = def.pads[0];
    expect(pad.shape).toEqual({ kind: "oval", width: 1_600_000, height: 2_200_000 });
    expect(pad.rotationDeg).toBe(90);
    expect(pad.drill).toEqual({
      diameter: 800_000,
      width: 800_000,
      height: 1_400_000,
      offset: { x: 100_000, y: -200_000 },
    });
    for (const copper of COPPER_LAYERS) {
      expect(pad.layers).toContain(copper);
    }
    expect(pad.layers).toContain("maskTop");
    expect(pad.layers).toContain("maskBottom");
  });

  it("drops unmappable-layer items with a warning, ignores unknown nodes", () => {
    // The Dwgs.User line is dropped and counted; the mystery node is ignored
    // without error.
    expect(def.graphics.some((g) => g.kind === "line")).toBe(false);
    expect(warnings.some((w) => w.includes("Dwgs.User"))).toBe(true);
  });
});
