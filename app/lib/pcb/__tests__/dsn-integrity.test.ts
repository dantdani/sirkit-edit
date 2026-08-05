import { describe, expect, it } from "vitest";
import { createEmptyBoard, type FootprintInstance, type PcbBoard } from "../types";
import { mmToNm } from "../units";
import { schematicEndpointKey, BoardIntegrityError } from "../integrity";
import { boardToDsn, writeDsn } from "../dsn/write-dsn";
import { validateDsn } from "../dsn/preflight";
import { stackupProfile } from "../stackup";

function instance(id: string, ref: string, x: number): FootprintInstance {
  const endpointKey = schematicEndpointKey(id, "1");
  return {
    id, ref, footprintId: "Audit:OnePad",
    def: {
      libName: "Audit", name: "OnePad",
      attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
      pads: [{
        number: "1", type: "smd", shape: { kind: "circle", radius: mmToNm(0.5) },
        at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop", "maskTop", "pasteTop"],
      }],
      graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: mmToNm(1), maxY: mmToNm(1) }, models: [], rawSexpr: "",
    },
    at: { x: mmToNm(x), y: mmToNm(10) }, rotationDeg: 0, side: "top", padNets: { "1": 1 },
    pinPadMappings: [{
      componentInstanceId: id, endpointKey, symbolPinNumber: "1", padNumbers: ["1"],
      mappingKind: "electrical", provenance: "exact-number",
    }],
  };
}

function board(): PcbBoard {
  const board = createEmptyBoard();
  const a = instance("a", "J1", 10);
  const b = instance("b", "J2", 20);
  board.footprints = [a, b];
  board.nets.push({
    id: 1, name: "SIG", stableId: "net:sig",
    endpointKeys: [a.pinPadMappings![0].endpointKey, b.pinPadMappings![0].endpointKey].sort(),
  });
  return board;
}

describe("DSN electrical-identity preflight", () => {
  it("accepts a complete endpoint manifest", () => {
    const source = board();
    const report = validateDsn(source, boardToDsn(source));
    expect(report.ok).toBe(true);
    expect(report.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("independently catches a lost persisted endpoint mapping", () => {
    const source = board();
    source.footprints[1].pinPadMappings = [];
    const report = validateDsn(source, boardToDsn(source));
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === "LOST_SCHEMATIC_ENDPOINT")).toBe(true);
  });

  it("catches a required physical node removed after structural export", () => {
    const source = board();
    const dsn = boardToDsn(source);
    dsn.networks[0].nodes = dsn.networks[0].nodes.filter((node) => node.componentRef !== "J2");
    const report = validateDsn(source, dsn);
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === "LOST_SCHEMATIC_ENDPOINT" && issue.message.includes("J2.1"))).toBe(true);
  });

  it("exports duplicate physical pad numbers as unique lossless DSN nodes", () => {
    const source = board();
    const firstPad = source.footprints[0].def.pads[0];
    source.footprints[0].def.pads.push({
      ...structuredClone(firstPad), at: { x: mmToNm(2), y: 0 },
    });
    const dsn = boardToDsn(source);
    const component = dsn.components.find((item) => item.ref === "J1")!;
    expect(component.pins.map((pin) => pin.padNumber)).toEqual(["1@1", "1@2"]);
    expect(component.pins.map((pin) => pin.sourcePadNumber)).toEqual(["1", "1"]);
    expect(dsn.networks[0].nodes.filter((node) => node.componentRef === "J1").map((node) => node.padNumber))
      .toEqual(["1@1", "1@2"]);
    expect(validateDsn(source, dsn).ok).toBe(true);
  });

  it("C-04 blocks duplicate canonical references before DSN generation and in preflight", () => {
    const valid = board();
    const dsn = boardToDsn(valid);
    const corrupted = structuredClone(valid);
    corrupted.footprints[1].ref = "j1";
    expect(() => boardToDsn(corrupted)).toThrow(BoardIntegrityError);
    const report = validateDsn(corrupted, dsn);
    expect(report.ok).toBe(false);
    expect(report.issues.some((issue) => issue.code === "DUPLICATE_REFERENCE_DESIGNATOR")).toBe(true);
  });

  it("rejects a stale source revision and altered conservation ledger", () => {
    const source = board();
    const stale = boardToDsn(source);
    stale.integrity!.sourceRevision = "pcb2-stale";
    expect(validateDsn(source, stale).issues.some((issue) => issue.code === "STALE_ELECTRICAL_REPORT")).toBe(true);

    const altered = boardToDsn(source);
    altered.integrity!.nets[0].terminalGroupIds = [];
    expect(validateDsn(source, altered).issues.some((issue) => issue.code === "INTERCHANGE_CONSERVATION_FAILURE")).toBe(true);
  });

  it("does not synthesize a full-board plane from stackup intent", () => {
    const source = board();
    source.stackup = 4;
    source.stackupConfig = stackupProfile("signal-plane-4");
    const plane = source.stackupConfig.copperLayers.find((layer) => layer.id === "in1")!;
    plane.planeNetId = 1;
    const dsn = boardToDsn(source);
    expect(dsn.layers.find((layer) => layer.name === "In1.Cu")?.planeNetName).toBeUndefined();
    expect(writeDsn(dsn)).not.toContain('(plane "SIG"');
  });
});
