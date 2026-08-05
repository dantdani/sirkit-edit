import { describe, expect, it } from "vitest";
import { buildRoutedDemo } from "../demo/routed-demo";
import { boardToDsn, writeDsn } from "../dsn/write-dsn";
import { validateDsn } from "../dsn/preflight";
import { setBoardStackupProfile } from "../stackup";
import { reconcileStackupPlaneZones } from "../zones/plane";
import { applyZoneFillCandidate, computeZoneFillCandidate } from "../zones/fill-lifecycle";

describe("canonical multilayer DSN", () => {
  it("exports a four-layer signal/plane stack in physical order with legal through vias", () => {
    const board = buildRoutedDemo();
    setBoardStackupProfile(board, "signal-plane-4");
    board.stackupConfig!.copperLayers.find((layer) => layer.id === "in1")!.planeNetId = 1;
    board.stackupConfig!.copperLayers.find((layer) => layer.id === "in2")!.planeNetId = 2;
    reconcileStackupPlaneZones(board);
    const candidates = board.zones.filter((zone) => zone.source === "stackup-plane").map((zone) => computeZoneFillCandidate(board, zone));
    for (const candidate of candidates) expect(applyZoneFillCandidate(board, candidate)).toBe(true);
    const dsn = boardToDsn(board);
    expect(dsn.layers.map((layer) => layer.name)).toEqual(["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]);
    expect(dsn.layers.map((layer) => layer.role)).toEqual(["signal", "plane", "plane", "signal"]);
    expect(dsn.layers.map((layer) => layer.autorouteEnabled)).toEqual([true, false, false, true]);
    expect(dsn.vias.every((via) => via.startLayer === "F.Cu" && via.endLayer === "B.Cu")).toBe(true);
    expect(dsn.vias.every((via) => via.onLayers.join("/") === "F.Cu/In1.Cu/In2.Cu/B.Cu")).toBe(true);
    const report = validateDsn(board, dsn);
    expect(report.ok).toBe(true);
    const text = writeDsn(dsn);
    expect(text).toContain("(layer In1.Cu\n      (type power)");
    expect(text).toContain("(layer_rule In1.Cu\n        (active off)");
    expect(text).toContain("(layer_rule F.Cu\n        (active on)");
  });

  it("blocks execution when an enabled stackup layer is missing from the DSN", () => {
    const board = buildRoutedDemo();
    setBoardStackupProfile(board, "all-signal-4");
    const dsn = boardToDsn(board);
    dsn.layers.splice(1, 1);
    const report = validateDsn(board, dsn);
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("layer-count");
  });
});
