// Stage 9 end-to-end (minus the JAR): prove the coordinate contract holds all
// the way around the loop. The DSN pin position we hand Freerouting must be the
// exact pad point connectivity checks, so an SES wire between two pins closes
// the net. Pipeline: boardToDsn (baked absolute pins) → craft an SES routing
// those pin coords → parseSes → AutorouteImport → computeConnectivity == 100%.

import { describe, it, expect } from "vitest";
import { boardToDsn, dsnNetName } from "../dsn/write-dsn";
import { parseSes } from "../dsn/read-ses";
import { buildAutorouteImportCommand } from "../autoroute/command";
import { applyRouteCommand } from "../route-tool.commands";
import { computeConnectivity } from "../connectivity-board";
import { createEmptyBoard } from "../types";
import type { PcbBoard, FootprintDef, FootprintInstance, Pad } from "../types";
import { mmToNm } from "../units";

function smdPad(number: string, xMm: number, yMm: number): Pad {
  return {
    number,
    type: "smd",
    shape: { kind: "rect", width: mmToNm(0.9), height: mmToNm(0.9) },
    at: { x: mmToNm(xMm), y: mmToNm(yMm) },
    rotationDeg: 0,
    layers: ["copperTop", "maskTop"],
  };
}

function def(pads: Pad[]): FootprintDef {
  return {
    libName: "T",
    name: "R",
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads,
    graphics: [],
    bodyBBox: { minX: 0, minY: 0, maxX: mmToNm(6), maxY: mmToNm(1) },
    models: [],
    rawSexpr: "",
  };
}

describe("autoroute integration (coordinate contract, no JAR)", () => {
  it("an SES wire between the two emitted pin coords closes a 2-pad net to 100%", () => {
    // Two pads on net 1, 5 mm apart, ROTATED 90° so we also exercise the
    // world-transform path — and NO tracks (one airwire to start).
    const fp: FootprintInstance = {
      id: "u1",
      ref: "U1",
      footprintId: "T:R",
      def: def([smdPad("1", 0, 0), smdPad("2", 5, 0)]),
      at: { x: mmToNm(30), y: mmToNm(25) },
      rotationDeg: 90,
      side: "top",
      padNets: { "1": 1, "2": 1 },
    };
    const board: PcbBoard = {
      ...createEmptyBoard(),
      nets: [
        { id: 0, name: "" },
        { id: 1, name: "SIG" },
      ],
      footprints: [fp],
    };

    // Baseline: net 1 has 2 pads, no copper → incomplete, exactly one airwire.
    const before = computeConnectivity(board);
    expect(before.nets.get(1)?.complete).toBe(false);
    expect(before.completion).toEqual({ routedNets: 0, totalNets: 1, percent: 0 });
    expect(before.airwires).toHaveLength(1);

    // Emit DSN and read back the two baked (absolute) pin positions.
    const dsn = boardToDsn(board);
    expect(dsn.components).toHaveLength(1);
    const [pinA, pinB] = dsn.components[0].pins;
    expect(pinA).toBeDefined();
    expect(pinB).toBeDefined();

    // Craft the SES Freerouting *would* return: one F.Cu wire joining the pins.
    const netName = dsnNetName({ id: 1, name: "SIG" });
    const ses = `(session x (routes (network_out (net "${netName}"
      (wire (path F.Cu 250000 ${pinA.atNm.x} ${pinA.atNm.y} ${pinB.atNm.x} ${pinB.atNm.y}) (net "${netName}"))
    ))))`;

    const parsed = parseSes(ses, board);
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0].netId).toBe(1);

    // Import as the single-undo command and re-check connectivity.
    const cmd = buildAutorouteImportCommand(board, { tracks: parsed.tracks, vias: parsed.vias });
    const routed = applyRouteCommand(board, cmd);

    const after = computeConnectivity(routed);
    expect(after.nets.get(1)?.complete).toBe(true);
    expect(after.airwires).toHaveLength(0);
    expect(after.completion).toEqual({ routedNets: 1, totalNets: 1, percent: 100 });
  });
});
