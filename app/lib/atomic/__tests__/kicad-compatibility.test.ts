import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFootprintAsset, parseSymbolAssets } from "../kicad-assets";
import { parseLibraryTable, resolveLibraryTables } from "../library-resolver";
import { legacyPartToAtomicDraft } from "../compatibility";
import { resolveFootprint } from "@/lib/footprint-assign";

const ORIGIN = {
  sourceRecordId: "record_fixture",
  libraryNickname: "Fixture",
  sourceUri: "fixture://kicad",
  licenseId: "license_fixture_mit",
};

const SYMBOL_LIBRARY = `(kicad_symbol_lib
  (version 20231120)
  (generator "kicad_symbol_editor")
  (symbol "FixtureOpAmp"
    (property "Reference" "U")
    (property "Value" "FixtureOpAmp")
    (property "ki_fp_filters" "Package_SO:SOIC* Package_DFN:DFN*")
    (symbol "FixtureOpAmp_1_1"
      (pin input line (at 0 0 0) (length 2.54) (name "IN+") (number "1"))
      (pin output line (at 5.08 0 180) (length 2.54) (name "OUT") (number "2")))
    (symbol "FixtureOpAmp_2_1"
      (pin power_in line hide (at 0 0 0) (length 2.54) (name "VCC") (number "8")))
    (symbol "FixtureOpAmp_1_2"
      (pin input inverted (at 0 0 0) (length 2.54) (name "IN+") (number "1"))))
)`;

const FOOTPRINT = `(footprint "FixtureQFN"
  (version 20240108)
  (generator "pcbnew")
  (descr "Original Sirkit test fixture")
  (attr smd)
  (fp_rect (start -2 -2) (end 2 2) (stroke (width 0.1)) (fill none) (layer "F.Fab"))
  (fp_rect (start -2.2 -2.2) (end 2.2 2.2) (stroke (width 0.05)) (fill none) (layer "F.CrtYd"))
  (fp_line (start -2 -2) (end 2 -2) (stroke (width 0.12)) (layer "F.SilkS"))
  (pad "1" smd roundrect (at -1 0) (size 0.6 1.2) (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.25) (solder_mask_margin 0.05) (solder_paste_margin -0.02) (solder_paste_margin_ratio -0.1))
  (pad "2" smd oval (at 1 0) (size 0.6 1.2) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "" np_thru_hole circle (at 0 3) (size 1 1) (drill 1) (layers "*.Cu" "*.Mask"))
  (model "\${KICAD9_3DMODEL_DIR}/Package_QFN.3dshapes/Fixture.step"
    (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))
)`;

describe("Stage 5 version-aware KiCad asset parsing", () => {
  it("preserves multi-unit/body, hidden, stacked pins and filters", () => {
    const [asset] = parseSymbolAssets({ source: SYMBOL_LIBRARY, origin: ORIGIN });
    expect(asset.validationState).toBe("valid");
    expect(asset.unitCount).toBe(2);
    expect(asset.bodyStyles).toEqual([1, 2]);
    expect(asset.pins.find((pin) => pin.number === "8")?.hidden).toBe(true);
    expect(asset.pins.filter((pin) => pin.number === "1")).toHaveLength(2);
    expect(asset.pins.filter((pin) => pin.number === "1").every((pin) => pin.stacked)).toBe(true);
    expect(asset.footprintFilters).toEqual(["Package_SO:SOIC*", "Package_DFN:DFN*"]);
  });

  it("resolves symbol inheritance while retaining the explicit parent identity", () => {
    const inherited = SYMBOL_LIBRARY.replace(/\n\)$/, `
  (symbol "FixtureChild"
    (extends "FixtureOpAmp")
    (property "Value" "FixtureChild"))
)`);
    const assets = parseSymbolAssets({ source: inherited, origin: ORIGIN });
    const parent = assets.find((asset) => asset.symbolName === "FixtureOpAmp")!;
    const child = assets.find((asset) => asset.symbolName === "FixtureChild")!;
    expect(child.extends).toBe("FixtureOpAmp");
    expect(child.pins).toHaveLength(parent.pins.length);
    expect(child.logicalAssetId).not.toBe(parent.logicalAssetId);
  });

  it("preserves pad identity, geometry, layers, drill, courtyard/fab/silk, and 3D transforms", () => {
    const asset = parseFootprintAsset({ source: FOOTPRINT, libraryNickname: "Fixture", origin: ORIGIN });
    expect(asset.validationState).toBe("valid");
    expect(asset.pads.map((pad) => [pad.number, pad.shape])).toEqual([["1", "roundrect"], ["2", "oval"], ["", "circle"]]);
    expect(asset.pads[2].mechanical).toBe(true);
    expect(asset.pads[2].drillNm).toBe(1_000_000);
    expect(asset.pads[2].plated).toBe(false);
    expect(asset.pads[0]).toMatchObject({ solderMaskMarginNm: 50_000, solderPasteMarginNm: -20_000, solderPasteMarginRatio: -0.1 });
    expect(asset.geometrySummary).toMatchObject({ hasFab: true, hasSilk: true, unsupportedGeometry: [] });
    expect(asset.modelReferences[0]).toMatchObject({ state: "missing", offset: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0] });
  });

  it("quarantines unsupported future versions and approximated custom pads", () => {
    const future = SYMBOL_LIBRARY.replace("20231120", "20990101");
    expect(parseSymbolAssets({ source: future, origin: ORIGIN })[0].validationState).toBe("unsupported");
    const custom = FOOTPRINT.replace("roundrect", "custom");
    const footprint = parseFootprintAsset({ source: custom, libraryNickname: "Fixture", origin: ORIGIN });
    expect(footprint.validationState).toBe("unsupported");
    expect(footprint.geometrySummary.unsupportedGeometry[0]).toMatch(/approximated/);
  });

  it("is content addressed and idempotent across repeated import", () => {
    const first = parseFootprintAsset({ source: FOOTPRINT, libraryNickname: "Fixture", origin: ORIGIN });
    const second = parseFootprintAsset({ source: FOOTPRINT, libraryNickname: "Fixture", origin: ORIGIN });
    expect(second).toEqual(first);
    expect(first.versionId).toMatch(/^footprintv_[0-9a-f]{64}$/);
  });

  it("deduplicates identical bytes without erasing independent source/license identity", () => {
    const first = parseFootprintAsset({ source: FOOTPRINT, libraryNickname: "Fixture", origin: ORIGIN });
    const second = parseFootprintAsset({
      source: FOOTPRINT,
      libraryNickname: "Mirror",
      origin: { ...ORIGIN, sourceRecordId: "record_independent_mirror", libraryNickname: "Mirror", licenseId: "license_other" },
    });
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.versionId).not.toBe(first.versionId);
    expect(second.logicalAssetId).not.toBe(first.logicalAssetId);
    expect(second.origin.licenseId).not.toBe(first.origin.licenseId);
  });
});

describe("Stage 5 deterministic KiCad library tables", () => {
  // [B19-D I5d row 49] reviewed pin move: library paths must now be absolute (a relative path used to resolve against the
  // process working directory). "C:\\workspace\\project" is absolute only on Windows, so these fixtures use the platform's own
  // absolute paths; every assertion is unchanged.
  const projectDirectory = path.resolve("workspace", "project");
  const kicadSymbols = path.resolve("kicad", "symbols");
  const globalTable = `(sym_lib_table (lib (name "Device") (type "KiCad") (uri "\${KICAD_SYMBOL_DIR}/Device.kicad_sym") (options "") (descr "global")))`;
  const projectTable = `(sym_lib_table (lib (name "Device") (type "KiCad") (uri "\${KIPRJMOD}/Device.kicad_sym") (options "") (descr "project")))`;

  it("gives project scope deterministic precedence and reports the shadowed source", () => {
    const resolved = resolveLibraryTables({
      global: parseLibraryTable(globalTable, "symbol", "global"),
      project: parseLibraryTable(projectTable, "symbol", "project"),
      projectDirectory,
      pathPolicy: { roots: [projectDirectory, kicadSymbols], variables: { KICAD_SYMBOL_DIR: kicadSymbols }, extensions: [".kicad_sym"] },
    });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].scope).toBe("project");
    expect(resolved[0].shadowed).toHaveLength(1);
    expect(resolved[0].resolvedPath).toMatch(/project[\\/]Device\.kicad_sym$/);
  });

  it("reports same-scope nickname collision instead of silently selecting it", () => {
    const entries = parseLibraryTable(globalTable, "symbol", "global");
    const resolved = resolveLibraryTables({
      global: [...entries, { ...entries[0], uri: "\${KICAD_SYMBOL_DIR}/Other.kicad_sym", order: 1 }],
      project: [],
      projectDirectory,
      pathPolicy: { roots: [kicadSymbols], variables: { KICAD_SYMBOL_DIR: kicadSymbols }, extensions: [".kicad_sym"] },
    });
    expect(resolved[0].diagnostics).toContain('duplicate nickname "Device" in global table');
  });
});

describe("Stage 5 legacy compatibility without fabricated enrichment", () => {
  it("preserves a legacy row as draft and leaves mapping/license unresolved", () => {
    const draft = legacyPartToAtomicDraft({
      id: "legacy-1",
      name: "R",
      symbolRaw: "(symbol \"R\")",
      pins: [
        { number: "1", name: "~", type: "passive", position: { x: 0, y: 0 }, orientation: 0, length: 2.54 },
        { number: "2", name: "~", type: "passive", position: { x: 5.08, y: 0 }, orientation: 180, length: 2.54 },
      ],
      footprintHint: "Resistor_SMD:R_0603_1608Metric",
      isGeneric: true,
    });
    expect(draft.revision.publicationState).toBe("draft");
    expect(draft.revision.cadBundles[0].footprintVersionId).toBeUndefined();
    expect(draft.unresolved).toContain("footprint hint is a candidate, not package proof");
    expect(draft.license.exportDisposition).toBe("unknown");
  });

  it("labels symbol hints/defaults as candidates and only exact atomic bundles as approved", () => {
    expect(resolveFootprint({ refDes: "R1", footprintHint: "Resistor_SMD:R_0603_1608Metric" })).toMatchObject({ source: "hint", proofState: "candidate" });
    expect(resolveFootprint({ refDes: "C1" })).toMatchObject({ source: "default", proofState: "candidate" });
    expect(resolveFootprint({
      refDes: "U1",
      approvedAtomic: {
        footprint: "Package_QFN:QFN-32",
        footprintAssetVersionId: "footprintv_exact",
        mappingCertificateId: "map_exact",
      },
    })).toMatchObject({ source: "atomic-approved", proofState: "approved", mappingCertificateId: "map_exact" });
  });
});
