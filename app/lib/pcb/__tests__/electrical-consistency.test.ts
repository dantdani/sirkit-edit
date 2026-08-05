import { describe, expect, it } from "vitest";
import { buildRoutedDemo } from "../demo/routed-demo";
import { computeElectricalTruth } from "../electrical-truth";
import { runDrc } from "../drc/run-drc";
import { getPreset } from "../drc/presets";
import { verifyAutorouteCandidate } from "../autoroute/verification";
import { buildAIPcbSnapshot } from "../ai/snapshot";
import { runRoutingAiTool } from "../ai-routing-tools";
import { boardToDsn } from "../dsn/write-dsn";
import { validateDsn } from "../dsn/preflight";
import { createManufacturingSnapshot } from "../fab/native/snapshot";
import { getFabPreset } from "../fab/presets";
import { netlistFromBoard } from "../kicad/write-pcb";

describe("electrical truth consumer consistency", () => {
  it("binds DRC, autoroute, AI, DSN, and manufacturing to one revision and completion result", () => {
    const board = buildRoutedDemo();
    const truth = computeElectricalTruth(board);
    const preset = getPreset(board.stackup === 4 ? "jlcpcb-4l" : "jlcpcb-2l");
    const drc = runDrc(board, preset.rules, { presetId: preset.id, electricalReport: truth });
    const autoroute = verifyAutorouteCandidate(board, preset.rules);
    const ai = buildAIPcbSnapshot(board) as unknown as {
      boardRevisionId: string;
      electricalTruth: { designRevision: string; realized: { remainingConnections: number }; shorts: Array<{ id: string }> };
    };
    const routingTool = runRoutingAiTool(board, { name: "getUnroutedConnections" }) as {
      designRevision: string;
      completion: { remainingConnections: number };
      shorts: Array<{ id: string }>;
    };
    const dsn = boardToDsn(board);
    const dsnValidation = validateDsn(board, dsn);
    const manufacturing = createManufacturingSnapshot({
      board,
      netlist: netlistFromBoard(board),
      fabPreset: getFabPreset(board.stackup === 4 ? "jlcpcb-4l" : "jlcpcb-2l"),
      drcPreset: preset,
      boardName: "consistency-fixture",
    }).snapshot;

    expect([
      drc.designRevision,
      autoroute.designRevision,
      ai.boardRevisionId,
      ai.electricalTruth.designRevision,
      routingTool.designRevision,
      dsn.integrity?.sourceRevision,
      dsnValidation.sourceRevision,
      manufacturing.electricalTruth.designRevision,
    ]).toEqual(Array(8).fill(truth.designRevision));
    expect([
      drc.electrical.remainingConnections,
      autoroute.remainingConnections,
      ai.electricalTruth.realized.remainingConnections,
      routingTool.completion.remainingConnections,
      manufacturing.electricalTruth.realized.remainingConnections,
    ]).toEqual(Array(5).fill(truth.realized.remainingConnections));
    expect(drc.electrical.shortIds).toEqual(truth.shorts.map((short) => short.id));
    expect(autoroute.shortIds).toEqual(drc.electrical.shortIds);
    expect(ai.electricalTruth.shorts.map((short) => short.id)).toEqual(drc.electrical.shortIds);
    expect(routingTool.shorts.map((short) => short.id)).toEqual(drc.electrical.shortIds);
  });
});
