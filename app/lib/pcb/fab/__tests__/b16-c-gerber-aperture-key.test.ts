/**
 * B16-C.4 finding — released copper bytes depended on the PROPERTY ORDER of
 * pad shape objects.
 *
 * Reproduced while re-recording the B16.1C pipeline: the recording run (board
 * built in-process) and the replay run (board round-tripped through the
 * sorted-key route fixture) produced boards with IDENTICAL content digests
 * (`stableJson` sorts keys), identical qualification identities, and yet a
 * different copper-top Gerber: the aperture key was `JSON.stringify(shape)`,
 * so `{kind,width,height}` and `{height,kind,width}` became different
 * apertures — different D-codes, different macro names, different archive
 * sha256. PostgreSQL jsonb does not preserve key order either, so a production
 * release from a stored authority could differ from the in-process one.
 */
import { describe, expect, it } from "vitest";
import { getPreset } from "../../drc/presets";
import { getFabPreset } from "../presets";
import { compileManufacturingIr } from "../native/mir";
import { STRICT_NATIVE_RECIPE } from "../native/recipe";
import { createManufacturingSnapshot } from "../native/snapshot";
import { sha256, stableJson } from "../native/stable";
import { writeGerberLayer } from "../native/gerber-writer";
import type { NativeFabCompileInput } from "../native/types";
import type { PadShape } from "../../geometry";
import type { PcbBoard } from "../../types";
import { mmToNm } from "../../units";
import { autonomousGoldenNetlist, buildAutonomousGoldenBoard } from "../../__tests__/fixtures/autonomous-golden-board";

function withPadShape(board: PcbBoard, shape: PadShape, rotationDeg: number): PcbBoard {
  const clone = structuredClone(board);
  clone.footprints = clone.footprints.map((fp) => ({ ...fp, def: { ...fp.def, pads: fp.def.pads.map((pad) => ({ ...pad, shape, rotationDeg })) } }));
  return clone;
}

function copperTop(board: PcbBoard): string {
  const input: NativeFabCompileInput = {
    board, netlist: autonomousGoldenNetlist(board), fabPreset: getFabPreset("jlcpcb-2l"), drcPreset: getPreset("jlcpcb-2l"), boardName: "aperture-key",
    recipe: { ...STRICT_NATIVE_RECIPE, id: "sirkit-mfg01-bare-board", includeGerberDrill: false, includeComponentLayers: false, includePlacement: false, includeBom: false },
    maskPolicy: { schemaVersion: "sirkit.native-mask-policy.v1", defaultComponentPadsOpen: true, defaultExpansionNm: mmToNm(0.05), defaultViaTenting: "tented", sourceProfileDigest: "test" },
    generatedAt: "2026-07-21T00:00:00.000Z",
  };
  const { snapshot } = createManufacturingSnapshot(input);
  const mir = compileManufacturingIr(snapshot);
  const layer = mir.layers.find((item) => item.id === "copperTop");
  if (!layer) throw new Error("copperTop layer missing");
  return writeGerberLayer(snapshot, mir, layer).text;
}

describe("B16-C.4 §Gerber aperture identity is canonical (property order never changes released bytes)", () => {
  const golden = buildAutonomousGoldenBoard(3);
  const ordered: PadShape = { kind: "roundrect", width: mmToNm(1.6), height: mmToNm(1.2), cornerRadius: mmToNm(0.3) };
  // The same shape as a jsonb / sorted-key round trip would hand back.
  const permuted = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(ordered).sort(([a], [b]) => (a < b ? -1 : 1))))) as PadShape;

  it("two boards that every content digest calls identical emit byte-identical copper", () => {
    const a = withPadShape(golden, ordered, 45);
    const b = withPadShape(golden, permuted, 45);
    expect(Object.keys(a.footprints[0].def.pads[0].shape)).not.toEqual(Object.keys(b.footprints[0].def.pads[0].shape));
    expect(sha256(stableJson(a))).toBe(sha256(stableJson(b)));
    const gtlA = copperTop(a);
    const gtlB = copperTop(b);
    expect(gtlA).toBe(gtlB);
    expect(gtlA).toContain("%AMSRK"); // the rotated roundrect really is a macro aperture
  });

  it("a genuinely different shape still yields a different aperture (the key is canonical, not degenerate)", () => {
    const a = copperTop(withPadShape(golden, ordered, 45));
    const b = copperTop(withPadShape(golden, { ...ordered, width: mmToNm(1.7) }, 45));
    expect(a).not.toBe(b);
  });
});
