import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createEmptyBoard } from "../types";
import { buildRoutedDemo } from "../demo/routed-demo";
import { netlistFromBoard } from "../kicad/write-pcb";
import { getFabPreset } from "../fab/presets";
import { getPreset } from "../drc/presets";
import { compileNativeFabPackage } from "../fab/native/compiler";
import { NativeFabBlockedError } from "../fab/native/types";
import { createManufacturingSnapshot } from "../fab/native/snapshot";
import { compileManufacturingIr } from "../fab/native/mir";
import { writeGerberLayer } from "../fab/native/gerber-writer";
import { parseGerber } from "../fab/native/gerber-parser";
import { verifyGerberLayer } from "../fab/native/gerber-verify";

const fabPreset = getFabPreset("jlcpcb-2l");
const drcPreset = getPreset("jlcpcb-2l");

function input(board = createEmptyBoard(), boardName = "native-test") {
  return { board, netlist: netlistFromBoard(board), fabPreset, drcPreset, boardName };
}

function cleanRotatedSmdBoard() {
  const source = buildRoutedDemo();
  const footprint = structuredClone(source.footprints.find((item) => item.ref === "R1")!);
  footprint.rotationDeg = 45;
  footprint.padNets = {};
  return {
    ...createEmptyBoard(),
    outline: source.outline,
    footprints: [footprint],
  };
}

describe("Sirkit native manufacturing compiler", () => {
  it("produces byte-identical deterministic ZIPs with a provenance manifest", async () => {
    const board = createEmptyBoard();
    const first = await compileNativeFabPackage(input(board, "deterministic"));
    const second = await compileNativeFabPackage(input(structuredClone(board), "deterministic"));

    expect(first.packageSha256).toBe(second.packageSha256);
    expect(first.manifest.packageId).toBe(second.manifest.packageId);
    expect(first.zipBytes).toEqual(second.zipBytes);
    expect(first.manifest.signoff).toBe("native-beta-verified");
    expect(first.filename).not.toMatch(/\d{4}-\d{2}-\d{2}/);

    const zip = await JSZip.loadAsync(first.zipBytes);
    const paths = Object.values(zip.files).filter((entry) => !entry.dir);
    expect(paths.some((entry) => entry.name.endsWith("manifest.json"))).toBe(true);
    expect(paths.some((entry) => entry.name.endsWith(".gbrjob"))).toBe(true);
    expect(paths.every((entry) => entry.date.toISOString().startsWith("1980-01-01"))).toBe(true);
  });

  it("emits and independently verifies rotated flashed pads plus X3 component data", async () => {
    const result = await compileNativeFabPackage(input(cleanRotatedSmdBoard(), "rotated-pad"));
    const gerbers = result.files.filter((item) => item.kind === "gerber");
    const topCopper = gerbers.find((item) => item.path.endsWith(".GTL"));
    const component = gerbers.find((item) => item.path.includes("Component-Top"));
    expect(topCopper).toBeTruthy();
    expect(component).toBeTruthy();
    const copperText = new TextDecoder().decode(topCopper!.bytes);
    const componentText = new TextDecoder().decode(component!.bytes);
    expect(copperText).toContain("%AMSRK");
    expect(copperText).toContain("%TO.P,R1,");
    expect(componentText).toContain("%TA.AperFunction,ComponentMain*%");
    expect(componentText).toContain("%TO.CRot,45*%");
    expect(result.stages.find((item) => item.stage === "independent-parse-back")?.status).toBe("passed");
  });

  it("is invariant to source-array order", async () => {
    const board = cleanRotatedSmdBoard();
    const duplicate = structuredClone(board.footprints[0]);
    duplicate.id = "second";
    duplicate.ref = "R2";
    duplicate.at.x += 5_000_000;
    board.footprints.push(duplicate);
    const shuffled = structuredClone(board);
    shuffled.footprints.reverse();
    shuffled.nets.reverse();
    const a = await compileNativeFabPackage(input(board, "order-test"));
    const b = await compileNativeFabPackage(input(shuffled, "order-test"));
    expect(a.packageSha256).toBe(b.packageSha256);
  });

  it("blocks stale copper pours and never silently refills them", async () => {
    const board = createEmptyBoard();
    board.zones.push({
      id: "stale-zone",
      layer: "copperTop",
      netId: 0,
      polygon: [
        { x: 1_000_000, y: 1_000_000 },
        { x: 9_000_000, y: 1_000_000 },
        { x: 9_000_000, y: 9_000_000 },
        { x: 1_000_000, y: 9_000_000 },
      ],
      appearance: "solid",
      connection: "solid",
      fill: [],
      dirty: true,
    });
    await expect(compileNativeFabPackage(input(board))).rejects.toMatchObject({
      name: "NativeFabBlockedError",
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "SNAPSHOT_STALE_ZONE_FILL" })]),
    });
  });

  it("blocks DRC errors without accepting a generic override", async () => {
    await expect(compileNativeFabPackage(input(buildRoutedDemo()))).rejects.toBeInstanceOf(NativeFabBlockedError);
    try {
      await compileNativeFabPackage(input(buildRoutedDemo()));
    } catch (error) {
      const blocked = error as NativeFabBlockedError;
      expect(blocked.diagnostics.some((item) => item.code === "DRC_SHORT")).toBe(true);
    }
  });

  it("detects post-write coordinate corruption through the independent parser", () => {
    const compileInput = input(cleanRotatedSmdBoard(), "tamper-test");
    const { snapshot, diagnostics } = createManufacturingSnapshot(compileInput);
    expect(diagnostics.some((item) => item.severity === "error")).toBe(false);
    const mir = compileManufacturingIr(snapshot);
    const layer = mir.layers.find((item) => item.id === "copperTop")!;
    const emitted = writeGerberLayer(snapshot, mir, layer).text;
    const corrupted = emitted.replace(/X[+-]?\d+Y[+-]?\d+D03\*/, "X999999999Y999999999D03*");
    const verification = verifyGerberLayer(layer, parseGerber(corrupted), "tampered.gbr");
    expect(verification).toEqual(expect.arrayContaining([expect.objectContaining({ code: "GERBER_GEOMETRY_MISMATCH" })]));
  });
});
