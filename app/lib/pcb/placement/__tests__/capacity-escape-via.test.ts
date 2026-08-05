import { describe, expect, it } from "vitest";
import { buildPlacementProblem } from "../problem";
import { sourcePlacementRecord } from "../geometry";
import { analyzePlacementCongestion } from "../capacity";
import { analyzePlacementPinEscape, analyzePlacementViaPressure } from "../escape";
import { evaluatePlacementObjectives } from "../objectives";
import { activateConstraints, crossingChannelBoard, makeBoard, makeDef, makeInstance, makePad, placementRule } from "./fixtures";
import { stackupProfile } from "../../stackup";
import type { PlacementPinEscapeReport, PlacementViaPressureReport } from "../types";

describe("Stage 7 physical routing-capacity estimator", () => {
  it("orders a wide channel above a narrow channel and reports exact cutline hotspots", () => {
    const narrowProblem = buildPlacementProblem({ board: crossingChannelBoard({ heightMm: 5, nets: 20 }), options: { capacityColumns: 8, capacityRows: 4 } });
    const wideProblem = buildPlacementProblem({ board: crossingChannelBoard({ heightMm: 20, nets: 20 }), options: { capacityColumns: 8, capacityRows: 4 } });
    const narrow = analyzePlacementCongestion(narrowProblem, sourcePlacementRecord(narrowProblem));
    const wide = analyzePlacementCongestion(wideProblem, sourcePlacementRecord(wideProblem));
    expect(narrow.totalOverflowTracks).toBeGreaterThan(0);
    expect(narrow.maximumOverflowTracks).toBeGreaterThan(0);
    expect(narrow.hotspots[0].contributingNetIds).toHaveLength(20);
    expect(wide.totalOverflowTracks).toBe(0);
    expect(wide.totalCapacityTracks).toBeGreaterThan(narrow.totalCapacityTracks);
  });

  it("distinguishes equal-HPWL placements when a fixed obstacle consumes channel capacity", () => {
    const clearProblem = buildPlacementProblem({ board: crossingChannelBoard({ heightMm: 5, nets: 20, obstacle: false }), options: { capacityColumns: 8, capacityRows: 4 } });
    const blockedProblem = buildPlacementProblem({ board: crossingChannelBoard({ heightMm: 5, nets: 20, obstacle: true }), options: { capacityColumns: 8, capacityRows: 4 } });
    const clearPlacements = sourcePlacementRecord(clearProblem);
    const blockedPlacements = sourcePlacementRecord(blockedProblem);
    const clear = analyzePlacementCongestion(clearProblem, clearPlacements);
    const blocked = analyzePlacementCongestion(blockedProblem, blockedPlacements);
    const emptyEscape: PlacementPinEscapeReport = { version: clearProblem.metricVersion, terminals: [], deficits: 0, unknown: 0, hotspots: [] };
    const emptyVia: PlacementViaPressureReport = { version: clearProblem.metricVersion, totalDemand: 0, maximumPressure: 0, cells: [], hotspots: [] };
    const clearObjectives = evaluatePlacementObjectives({ problem: clearProblem, placements: clearPlacements, congestion: clear, pinEscape: emptyEscape, viaPressure: emptyVia });
    const blockedObjectives = evaluatePlacementObjectives({ problem: blockedProblem, placements: blockedPlacements, congestion: blocked, pinEscape: emptyEscape, viaPressure: emptyVia });
    expect(clearObjectives.objectives.find((item) => item.kind === "wirelength")?.rawValue).toBe(blockedObjectives.objectives.find((item) => item.kind === "wirelength")?.rawValue);
    expect(blocked.totalOverflowTracks).toBeGreaterThan(clear.totalOverflowTracks);
    expect(blocked.hotspots[0]).toEqual(expect.objectContaining({ capacityTracks: 0, demandTracks: 20, overflowTracks: 20 }));
  });

  it("assigns no signal capacity to plane-only layers", () => {
    const board = crossingChannelBoard({ heightMm: 10, nets: 2 });
    board.stackup = 4;
    board.stackupConfig = stackupProfile("signal-plane-4");
    board.stackupConfig.copperLayers.find((layer) => layer.id === "in1")!.planeNetId = 1;
    const problem = buildPlacementProblem({ board });
    expect(problem.capacityPolicy.signalLayerIds).toEqual(["copperTop", "copperBottom"]);
    expect(problem.capacityPolicy.planeLayerIds).toEqual(["in1", "in2"]);
    expect(analyzePlacementCongestion(problem, sourcePlacementRecord(problem)).cutlines.some((cutline) => cutline.layerId === "in1" || cutline.layerId === "in2")).toBe(false);
  });
});

describe("Stage 7 pad escape and via pressure", () => {
  it("uses eight physical directions and reports neighboring-component blockage", () => {
    const pad = makeDef("PIN", 0.5, 0.5, [makePad("1", 0, 0)]);
    const block = makeDef("BLOCK", 1, 1, []);
    const footprints = [makeInstance("target", pad, { x: 5, y: 5 }, { "1": 1 }), makeInstance("receiver", pad, { x: 9, y: 5 }, { "1": 1 }, { locked: true })];
    const offsets = [[-1.2, -1.2], [0, -1.2], [1.2, -1.2], [-1.2, 0], [1.2, 0], [-1.2, 1.2], [0, 1.2], [1.2, 1.2]];
    offsets.forEach(([dx, dy], index) => footprints.push(makeInstance(`block-${index}`, block, { x: 5 + dx, y: 5 + dy }, {}, { locked: true })));
    const problem = buildPlacementProblem({ board: makeBoard(10, 10, footprints, 1) });
    const report = analyzePlacementPinEscape(problem, sourcePlacementRecord(problem));
    const target = report.terminals.find((terminal) => terminal.componentId === "target");
    expect(target?.attemptedDirections).toBe(8);
    expect(target?.state).toBe("deficit");
    expect(target?.reasons).toContain("component_obstacle");
  });

  it("reports a deficit—not an optimistic pass—when a pad has no allowed routing layer", () => {
    const pin = makeDef("TOP_PIN", 1, 1, [makePad("1", 0, 0)]);
    const board = makeBoard(20, 10, [makeInstance("a", pin, { x: 5, y: 5 }, { "1": 1 }), makeInstance("b", pin, { x: 15, y: 5 }, { "1": 1 })], 1);
    const constrained = activateConstraints(board, [placementRule({ id: "c:bottom-only", targetId: "net:fixture-1", objectType: "net", kind: "allowed_layers", domain: "routing", requirement: { form: "allowed_set", values: ["layer:copperBottom"] } })]);
    const problem = buildPlacementProblem({ board: constrained, options: { projectId: "stage7-test" } });
    const report = analyzePlacementPinEscape(problem, sourcePlacementRecord(problem));
    expect(report.deficits).toBe(2);
    expect(report.terminals.every((terminal) => terminal.reasons.includes("pad_has_no_allowed_routing_layer"))).toBe(true);
  });

  it("produces spatial transition pressure and marks unsupported via policy", () => {
    const pin = makeDef("PIN", 1, 1, [makePad("1", 0, 0)]);
    const board = makeBoard(30, 20, [makeInstance("a", pin, { x: 3, y: 3 }, { "1": 1 }), makeInstance("b", pin, { x: 27, y: 17 }, { "1": 1 })], 1);
    board.stackup = 4;
    board.stackupConfig = stackupProfile("all-signal-4");
    const constrained = activateConstraints(board, [placementRule({ id: "c:unsupported-via", targetId: "net:fixture-1", objectType: "net", kind: "via_type", domain: "routing", requirement: { form: "allowed_set", values: ["microvia"] } })]);
    const problem = buildPlacementProblem({ board: constrained, options: { projectId: "stage7-test" } });
    const pressure = analyzePlacementViaPressure(problem, sourcePlacementRecord(problem));
    expect(pressure.totalDemand).toBeGreaterThan(0);
    expect(pressure.hotspots.length).toBeGreaterThan(0);
    expect(pressure.cells.some((cell) => cell.state === "unsupported")).toBe(true);
  });
});
