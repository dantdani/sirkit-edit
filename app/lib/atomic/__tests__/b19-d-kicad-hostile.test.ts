/**
 * [B19-D I5d rows 08, 37, 44, 45, 48] Hostile KiCad symbol and footprint libraries.
 *
 *  - row 08: the raw `(symbol …)` block was found by re-scanning the text with its own escape handling, so two differently
 *    escaped names could swap blocks (the exported symbol was not the one whose pins were validated) and a symbol could get an
 *    empty raw block while still validating. Trailing content after the root was ignored.
 *  - row 37: `Math.max(...pins)` threw a RangeError on a large pin list instead of a policy refusal; nothing capped pins or pads.
 *  - row 44: one large parent inherited by many `extends` children multiplied the pins that were hashed.
 *  - row 45: `extends` was resolved recursively (a long chain overflowed the stack), a cycle or a missing parent resolved
 *    silently to an empty symbol, and a duplicate name silently kept the last definition.
 *  - row 48: embedded payloads (`embedded_files`, a symbol's `embedded_fonts yes`), a versionless `footprint`, an impossible
 *    date version and a model path escaping the model roots all parsed as valid.
 */
import { describe, expect, it } from "vitest";
import { parseFootprintAsset, parseSymbolAssets } from "../kicad-assets";
import { extractLibrary } from "@/app/lib/kicad/extract";
import { legacyPartToAtomicDraft } from "../compatibility";
import { IngestSecurityError, modelReferencePathIssue } from "../security";
import { parseSafeSExpression } from "@/app/lib/schematic-compiler/safe-sexpression";

const ORIGIN = { sourceRecordId: "record_fixture", libraryNickname: "Fixture", sourceUri: "fixture://kicad", licenseId: "license_fixture_mit" };
const B = String.fromCharCode(92);
const lib = (body: string) => `(kicad_symbol_lib (version 20241209) (generator "kicad_symbol_editor") ${body})`;
const pin = (number: string, name = "P") => `(pin passive line (at 0 0 0) (length 2.54) (name "${name}") (number "${number}"))`;

function refusal(run: () => unknown): { error: unknown; code?: string } {
  try {
    run();
  } catch (error) {
    return { error, code: error instanceof IngestSecurityError ? error.code : undefined };
  }
  return { error: undefined };
}

describe("[B19-D I5d row 08] the raw symbol block is the block whose pins were validated", () => {
  it("names that differ only by escaping keep their own blocks, and every valid asset has a non-empty raw block", () => {
    const source = lib(`(symbol "X${B}n" (pin output line (at 0 0 0) (length 2.54) (name "OUT") (number "7"))) (symbol "X${B}${B}n" ${pin("1", "VCC")} ${pin("2", "GND")})`);
    const assets = parseSymbolAssets({ source, origin: ORIGIN });
    expect(assets).toHaveLength(2);
    for (const asset of assets) {
      expect(asset.validationState).toBe("valid");
      expect(asset.rawSymbolSExpression.length).toBeGreaterThan(0);
      const reparsed = extractLibrary([lib(asset.rawSymbolSExpression)]);
      expect(reparsed.map((symbol) => symbol.pins.map((item) => item.number))).toEqual([asset.pins.map((item) => item.number)]);
    }
  });

  it("content after the library root is refused, not ignored", () => {
    const source = `${lib(`(symbol "A" ${pin("1")})`)} (junk (symbol "B" ${pin("2")}))`;
    expect(extractLibrary([source])).toEqual([]);
    expect(() => parseSymbolAssets({ source, origin: ORIGIN })).toThrow();
  });

  it("a baseline library still parses with its verbatim block", () => {
    const [asset] = parseSymbolAssets({ source: lib(`(symbol "R" (property "Reference" "R") (symbol "R_1_1" ${pin("1")} ${pin("2")}))`), origin: ORIGIN });
    expect(asset.validationState).toBe("valid");
    expect(asset.rawSymbolSExpression.startsWith(`(symbol "R"`)).toBe(true);
    expect(asset.pins.map((item) => item.number)).toEqual(["1", "2"]);
  });
});

describe("[B19-D I5d row 37] pin and pad counts are policy, not a RangeError", () => {
  it("a symbol with 150 000 pins is refused as too_many_pins", () => {
    const source = lib(`(symbol "BIG" ${'(pin (number "1"))'.repeat(150_000)})`);
    const { error, code } = refusal(() => parseSymbolAssets({ source, origin: ORIGIN }));
    expect(error).toBeInstanceOf(IngestSecurityError);
    expect(code).toBe("too_many_pins");
  });

  it("a footprint with 190 000 pads is refused as too_many_pads", () => {
    const source = `(footprint "BIG" (version 20240108) (attr smd) ${'(pad "1" smd rect)'.repeat(190_000)})`;
    const { error, code } = refusal(() => parseFootprintAsset({ source, libraryNickname: "Fixture", origin: ORIGIN }));
    expect(error).toBeInstanceOf(IngestSecurityError);
    expect(code).toBe("too_many_pads");
  });

  it("a legacy row with 200 000 pins converts without a RangeError", () => {
    const pins = Array.from({ length: 200_000 }, (_, index) => ({ number: String(index + 1), name: "~", type: "passive" as const, position: { x: 0, y: 0 }, orientation: 0 as const, length: 2.54, unit: 1 + (index % 3) }));
    const draft = legacyPartToAtomicDraft({ id: "legacy-big", name: "BIG", symbolRaw: '(symbol "BIG")', pins, isGeneric: true });
    expect(draft.symbol.unitCount).toBe(3);
  });
});

describe("[B19-D I5d row 44] inheritance cannot amplify the pins that are hashed", () => {
  it("a 2 000-pin parent inherited by 200 children is refused as expanded_pin_budget", () => {
    const parent = `(symbol "PARENT" ${Array.from({ length: 2_000 }, (_, index) => `(pin (number "${index + 1}"))`).join(" ")})`;
    const children = Array.from({ length: 200 }, (_, index) => `(symbol "CHILD${index}" (extends "PARENT"))`).join(" ");
    const { error, code } = refusal(() => parseSymbolAssets({ source: lib(`${parent} ${children}`), origin: ORIGIN }));
    expect(error).toBeInstanceOf(IngestSecurityError);
    expect(code).toBe("expanded_pin_budget");
  });
});

describe("[B19-D I5d row 45] extends resolution is bounded, and cycles, missing parents and duplicates are not valid", () => {
  it("a 12 000-link chain is refused as extends_depth", () => {
    const chain = [`(symbol "S0" ${pin("1")})`, ...Array.from({ length: 12_000 }, (_, index) => `(symbol "S${index + 1}" (extends "S${index}"))`)].join(" ");
    const { error, code } = refusal(() => parseSymbolAssets({ source: lib(chain), origin: ORIGIN }));
    expect(error).toBeInstanceOf(IngestSecurityError);
    expect(code).toBe("extends_depth");
  });

  it("an A↔B cycle is not valid and names the cycle", () => {
    const assets = parseSymbolAssets({ source: lib(`(symbol "A" (extends "B")) (symbol "B" (extends "A"))`), origin: ORIGIN });
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(asset.validationState).not.toBe("valid");
      expect(asset.diagnostics.map((item) => item.code)).toContain("extends_cycle");
    }
  });

  it("a missing parent is not valid", () => {
    const [asset] = parseSymbolAssets({ source: lib(`(symbol "ORPHAN" (extends "MISSING"))`), origin: ORIGIN });
    expect(asset.validationState).not.toBe("valid");
    expect(asset.diagnostics.map((item) => item.code)).toContain("extends_missing_parent");
  });

  it("a duplicated symbol name is not valid", () => {
    const assets = parseSymbolAssets({ source: lib(`(symbol "DUP" ${pin("1")}) (symbol "DUP" ${pin("1")} ${pin("2")})`), origin: ORIGIN });
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      expect(asset.validationState).not.toBe("valid");
      expect(asset.diagnostics.map((item) => item.code)).toContain("duplicate_symbol_name");
    }
  });

  it("a one-level child still inherits its parent's pins (baseline)", () => {
    const assets = parseSymbolAssets({ source: lib(`(symbol "P" ${pin("1")} ${pin("2")}) (symbol "C" (extends "P") (property "Value" "C"))`), origin: ORIGIN });
    const child = assets.find((asset) => asset.symbolName === "C")!;
    expect(child.validationState).toBe("valid");
    expect(child.pins.map((item) => item.number)).toEqual(["1", "2"]);
  });
});

describe("[B19-D I5d row 48] embedded payloads, missing or impossible versions and escaping model paths are not valid", () => {
  const footprint = (extra: string, version = "(version 20240108)", root = "footprint") =>
    `(${root} "F" ${version} (generator "pcbnew") (attr smd) (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask")) ${extra})`;
  const parse = (source: string) => parseFootprintAsset({ source, libraryNickname: "Fixture", origin: ORIGIN });

  it("a footprint with embedded files is unsupported", () => {
    expect(parse(footprint(`(embedded_files (file (name "x.ttf") (type font) (data "AAAA")))`)).validationState).toBe("unsupported");
  });

  it("a footprint root without a version is unsupported; a legacy module root is not", () => {
    expect(parse(footprint("", "")).validationState).toBe("unsupported");
    expect(parse(footprint("", "", "module")).validationState).not.toBe("unsupported");
  });

  it("an impossible date version is unsupported", () => {
    expect(parse(footprint("", "(version 20261399)")).validationState).toBe("unsupported");
  });

  it("a model path outside the model roots is rejected", () => {
    const asset = parse(footprint(`(model "\${EVIL}/../../../../Windows/win.ini" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))`));
    expect(asset.diagnostics.map((item) => item.code)).toContain("model_path_rejected");
    expect(asset.validationState).toBe("unsupported");
    expect(asset.modelReferences[0]!.state).toBe("blocked");
  });

  it("a model under a KiCad model variable is accepted (baseline)", () => {
    const asset = parse(footprint(`(model "\${KICAD9_3DMODEL_DIR}/Package_QFN.3dshapes/Fixture.step" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0)))`));
    expect(asset.validationState).toBe("valid");
    expect(asset.diagnostics).toEqual([]);
  });

  it("the model path policy: one model variable, no traversal or backslashes, a model file type", () => {
    expect(modelReferencePathIssue("${KICAD10_3DMODEL_DIR}/Package_SO.3dshapes/SOIC-8_3.9x4.9mm_P1.27mm.step")).toBeNull();
    // an upstream KiCad footprint (TerminalBlock_Degson DG246-3.81-03P) doubles a separator: harmless, accepted (corpus check)
    expect(modelReferencePathIssue("${KICAD10_3DMODEL_DIR}//TerminalBlock_Degson.3dshapes/Degson_DG246-3.81-03P.step")).toBeNull();
    expect(modelReferencePathIssue("Package_SO.3dshapes/x.step")).toBe("model_path_variable_required");
    expect(modelReferencePathIssue("C:/models/x.step")).toBe("model_path_variable_required");
    expect(modelReferencePathIssue("${KICAD9_3DMODEL_DIR}/a/../../x.step")).toBe("model_path_traversal");
    expect(modelReferencePathIssue("${KICAD9_3DMODEL_DIR}/a\\..\\x.step")).toBe("model_path_characters");
    expect(modelReferencePathIssue("${EVIL}/x.step")).toBe("unknown_path_variable");
    expect(modelReferencePathIssue("${constructor}/x.step")).toBe("unknown_path_variable");
    expect(modelReferencePathIssue("${KICAD9_3DMODEL_DIR}/x.exe")).toBe("file_type");
  });

  it("a symbol library with embedded files, or with embedded font data, is unsupported", () => {
    const files = parseSymbolAssets({ source: lib(`(symbol "E" ${pin("1")}) (embedded_files (file (name "x.ttf") (type font) (data "AAAA")))`), origin: ORIGIN });
    expect(files.every((asset) => asset.validationState === "unsupported")).toBe(true);
    const fonts = parseSymbolAssets({ source: lib(`(symbol "E" ${pin("1")} (embedded_fonts yes))`), origin: ORIGIN });
    expect(fonts.every((asset) => asset.validationState === "unsupported")).toBe(true);
    const flag = parseSymbolAssets({ source: lib(`(symbol "E" ${pin("1")} (embedded_fonts no))`), origin: ORIGIN });
    expect(flag.every((asset) => asset.validationState === "valid")).toBe(true); // KiCad 9 writes this flag on every symbol
  });
});

describe("[B19-D I5d §3 verified controls] nesting depth is bounded before any recursive parser", () => {
  it("a footprint nested 161 deep is refused before parsing", () => {
    const source = `(footprint "D" (version 20240108) ${"(a ".repeat(160)}${")".repeat(160)})`;
    expect(refusal(() => parseFootprintAsset({ source, libraryNickname: "Fixture", origin: ORIGIN })).error).toBeInstanceOf(IngestSecurityError);
  });

  it("the schematic compiler's safe parser refuses depth 300", () => {
    expect(() => parseSafeSExpression(`${"(a ".repeat(300)}${")".repeat(300)}`, { maximumBytes: 1_000_000, maximumDepth: 160, maximumTokens: 100_000 })).toThrow(/DEPTH_LIMIT/);
  });
});
