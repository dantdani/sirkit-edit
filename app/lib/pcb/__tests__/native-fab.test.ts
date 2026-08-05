import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createEmptyBoard } from "../types";
import { buildRoutedDemo } from "../demo/routed-demo";
import { getFabPreset } from "../fab/presets";
import { getPreset } from "../drc/presets";
import { compileNativeFabPackage } from "../fab/native/compiler";
import { createManufacturingSnapshot } from "../fab/native/snapshot";
import { compileManufacturingIr } from "../fab/native/mir";
import { writeGerberLayer } from "../fab/native/gerber-writer";
import { parseGerber } from "../fab/native/gerber-parser";
import { verifyGerberLayer } from "../fab/native/gerber-verify";
import { ManufacturingReleaseBlockedError } from "../readiness/release";
import type { PcbBoard } from "../types";

const fabPreset = getFabPreset("jlcpcb-2l");
const drcPreset = getPreset("jlcpcb-2l");

function authoritativeNetlist(board: PcbBoard) {
  return {
    components: board.footprints.map((footprint) => ({
      id: footprint.id,
      ref: footprint.ref,
      pins: (footprint.pinPadMappings ?? []).map((mapping) => ({ number: mapping.symbolPinNumber })),
    })),
    nets: board.nets.filter((net) => net.id !== 0).map((net) => ({
      id: net.id,
      name: net.name,
      endpointKeys: [...(net.endpointKeys ?? [])],
      nodes: (net.endpointKeys ?? []).map((key) => {
        const [componentId, pinNumber] = key.split("::");
        return { componentId: decodeURIComponent(componentId), pinNumber: decodeURIComponent(pinNumber) };
      }),
    })),
  };
}

function input(board = createEmptyBoard(), boardName = "native-test") {
  return { board, netlist: authoritativeNetlist(board), fabPreset, drcPreset, boardName, generatedAt: "2026-07-17T00:00:00.000Z" };
}

function cleanRotatedSmdBoard() {
  const source = buildRoutedDemo();
  const footprint = structuredClone(source.footprints.find((item) => item.ref === "R1")!);
  footprint.rotationDeg = 45;
  footprint.padNets = {};
  footprint.pinPadMappings = footprint.def.pads.map((pad) => ({
    componentInstanceId: footprint.id,
    endpointKey: `${encodeURIComponent(footprint.id)}::${encodeURIComponent(pad.number)}`,
    symbolPinNumber: pad.number,
    padNumbers: [pad.number],
    mappingKind: "intentional-no-connect" as const,
    provenance: "user-explicit" as const,
  }));
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
    expect(first.manifest.signoff).toBe("pcb-fabrication-checks-passed");
    expect(first.releaseManifest.verified).toBe(true);
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
    duplicate.pinPadMappings = (duplicate.pinPadMappings ?? []).map((mapping) => ({
      ...mapping,
      componentInstanceId: duplicate.id,
      endpointKey: `${encodeURIComponent(duplicate.id)}::${encodeURIComponent(mapping.symbolPinNumber)}`,
    }));
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
    await expect(compileNativeFabPackage(input(board))).rejects.toBeInstanceOf(ManufacturingReleaseBlockedError);
  });

  it("blocks DRC errors without accepting a generic override", async () => {
    await expect(compileNativeFabPackage(input(buildRoutedDemo()))).rejects.toBeInstanceOf(ManufacturingReleaseBlockedError);
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
