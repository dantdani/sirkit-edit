// Fab presets (Stage 14): all four parse, DRC soft-links resolve, lookup by
// DRC id works, layer bundles cover the stackup's copper, and every filename
// is data (template) — never code.

import { describe, it, expect } from "vitest";
import { FAB_PRESETS, getFabPreset, getFabPresetForDrc } from "../fab/presets";
import { getPreset } from "../drc/presets";
import { LAYERS } from "../layers";

const KICAD_BY_ID = new Map(LAYERS.map((l) => [l.id, l.kicadName]));

describe("fab presets", () => {
  it("(a) all four presets parse with unique ids", () => {
    expect(FAB_PRESETS.length).toBe(4);
    const ids = FAB_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual(
      expect.arrayContaining(["jlcpcb-2l", "jlcpcb-4l", "pcbway-standard", "oshpark-4l"]),
    );
  });

  it("(b) every drcPresetId resolves to a real DRC preset", () => {
    for (const preset of FAB_PRESETS) {
      const drc = getPreset(preset.drcPresetId);
      expect(drc.id).toBe(preset.drcPresetId);
    }
  });

  it("(c) getFabPresetForDrc('jlcpcb-2l') returns the jlcpcb-2l fab preset", () => {
    expect(getFabPresetForDrc("jlcpcb-2l")?.id).toBe("jlcpcb-2l");
    expect(getFabPresetForDrc("oshpark-4l")?.id).toBe("oshpark-4l");
  });

  it("(d) layerBundle covers every copper layer of the fab's stackup", () => {
    const enabledCopper = (id: string): string[] =>
      getFabPreset(id)
        .layerBundle.filter((e) => e.enabled && e.kicadName.endsWith(".Cu"))
        .map((e) => e.kicadName)
        .sort();
    expect(enabledCopper("jlcpcb-2l")).toEqual(["B.Cu", "F.Cu"]);
    expect(enabledCopper("pcbway-standard")).toEqual(["B.Cu", "F.Cu"]);
    expect(enabledCopper("jlcpcb-4l")).toEqual(["B.Cu", "F.Cu", "In1.Cu", "In2.Cu"]);
    expect(enabledCopper("oshpark-4l")).toEqual(["B.Cu", "F.Cu", "In1.Cu", "In2.Cu"]);
  });

  it("layer entries agree with Stage 1's layer table and Edge.Cuts is always enabled", () => {
    for (const preset of FAB_PRESETS) {
      for (const entry of preset.layerBundle) {
        expect(entry.kicadName, `${preset.id}/${entry.layerId}`).toBe(KICAD_BY_ID.get(entry.layerId));
      }
      const edge = preset.layerBundle.find((e) => e.layerId === "edge");
      expect(edge?.enabled, preset.id).toBe(true);
    }
  });

  it("filenames are templates, not hard-coded (pinned constraint)", () => {
    for (const preset of FAB_PRESETS) {
      expect(preset.pos.filename).toContain("{boardName}");
      expect(preset.bom.filename).toContain("{boardName}");
      for (const entry of preset.layerBundle) expect(entry.fileSuffix.length).toBeGreaterThan(0);
    }
    expect(() => getFabPreset("nope")).toThrow();
  });
});
