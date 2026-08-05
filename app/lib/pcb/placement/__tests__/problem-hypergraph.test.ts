import { describe, expect, it } from "vitest";
import { buildFixtureBoard30 } from "../../__tests__/autoplace-fixture";
import { buildPlacementProblem } from "../problem";
import { runEngineeringPlacement } from "../engine";
import { runForceDirected } from "../../autoplace/force-directed";
import { resolveParams, type FootprintPlacement } from "../../autoplace/types";
import { buildPlacementEnvelope } from "../../autoplace/envelope";
import { makeBoard, makeInstance, makePad, makeDef } from "./fixtures";
import { mmToNm } from "../../units";

describe("Stage 7 immutable placement problem", () => {
  it("binds exact revisions/program, uses stable identity under input permutation, and never mutates input", () => {
    const board = buildFixtureBoard30();
    const before = structuredClone(board);
    const first = buildPlacementProblem({ board, options: { projectId: "stage7-permutation", seeds: [7, 11] } });
    const permuted = { ...structuredClone(board), footprints: [...board.footprints].reverse(), nets: [...board.nets].reverse() };
    const second = buildPlacementProblem({ board: permuted, options: { projectId: "stage7-permutation", seeds: [7, 11] } });
    expect(first.problemHash).toBe(second.problemHash);
    expect(first.sourceBoardRevision).toBe(second.sourceBoardRevision);
    expect(first.program.programHash).toBe(first.constraintProgramHash);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.instances[0])).toBe(true);
    expect(board).toEqual(before);

    const runA = runEngineeringPlacement({ board, options: { projectId: "stage7-permutation", seeds: [7, 11], candidateCount: 3, localRefinementPasses: 0 } });
    const runB = runEngineeringPlacement({ board: permuted, options: { projectId: "stage7-permutation", seeds: [7, 11], candidateCount: 3, localRefinementPasses: 0 } });
    expect(runA.candidates.map((candidate) => candidate.candidateHash)).toEqual(runB.candidates.map((candidate) => candidate.candidateHash));
  });

  it("collapses multiple physical pads of one mapped logical terminal into one anchor", () => {
    const pad = makePad("1", -0.2, 0);
    const duplicate = { ...makePad("1", 0.2, 0) };
    const definition = makeDef("MULTIPAD", 2, 2, [pad, duplicate]);
    const footprint = makeInstance("u1", definition, { x: 5, y: 5 }, { "1": 1 });
    footprint.pinPadMappings = [{ componentInstanceId: "u1", endpointKey: "u1::1", symbolPinNumber: "1", padNumbers: ["1"], mappingKind: "internally-common", provenance: "library-explicit" }];
    const board = makeBoard(20, 10, [footprint, makeInstance("r1", makeDef("ONEPAD", 1, 1, [makePad("1", 0, 0)]), { x: 15, y: 5 }, { "1": 1 })], 1);
    const problem = buildPlacementProblem({ board });
    expect(problem.terminals.filter((terminal) => terminal.componentId === "u1")).toEqual([
      expect.objectContaining({ id: "terminal:u1::1", padNumbers: ["1"], localPosition: { x: 0, y: 0 } }),
    ]);
    expect(problem.hyperedges[0].memberTerminalIds.filter((id) => id === "terminal:u1::1")).toHaveLength(1);
  });
});

describe("Stage 7 high-fanout attraction", () => {
  it("stores one hyperedge with O(k) incidences instead of a complete pair clique", () => {
    const onePad = makeDef("ONEPAD", 1, 1, [makePad("1", 0, 0)]);
    const footprints = Array.from({ length: 80 }, (_, index) => makeInstance(`c-${index.toString().padStart(3, "0")}`, onePad, { x: 5 + index % 10 * 5, y: 5 + Math.floor(index / 10) * 5 }, { "1": 1 }));
    const board = makeBoard(60, 50, footprints, 1);
    const placements: FootprintPlacement[] = board.footprints.map((footprint) => ({ id: footprint.id, position: { ...footprint.at }, rotationDeg: 0, side: "top", courtyardLocal: buildPlacementEnvelope(board, footprint).effectiveBounds, locked: false }));
    const result = runForceDirected({ board, footprints: placements, params: resolveParams({ maxIterations: 1 }, 42) });
    expect(result.hyperedgeCount).toBe(1);
    expect(result.springIncidences).toBe(80);
    expect(result.springIncidences).toBeLessThan(80 * 79 / 2);
  });

  it("does not create ordinary attraction for an explicitly plane-connected net", () => {
    const onePad = makeDef("ONEPAD", 1, 1, [makePad("1", 0, 0)]);
    const board = makeBoard(40, 30, [makeInstance("a", onePad, { x: 5, y: 5 }, { "1": 1 }), makeInstance("b", onePad, { x: 35, y: 25 }, { "1": 1 })], 1);
    board.stackup = 4;
    board.stackupConfig = {
      profileId: "signal-plane-4", boardThicknessMm: 1.6,
      routing: { viasAllowed: true, fanout: false, postroute: true, viaCost: 50, planeViaCost: 5, startRipupCost: 100 },
      copperLayers: [
        { id: "copperTop", name: "F.Cu", order: 0, enabled: true, role: "signal", autorouteEnabled: true, preferredDirection: "horizontal" },
        { id: "in1", name: "In1.Cu", order: 1, enabled: true, role: "plane", autorouteEnabled: false, preferredDirection: "any", planeNetId: 1 },
        { id: "in2", name: "In2.Cu", order: 2, enabled: true, role: "plane", autorouteEnabled: false, preferredDirection: "any", planeNetId: 1 },
        { id: "copperBottom", name: "B.Cu", order: 3, enabled: true, role: "signal", autorouteEnabled: true, preferredDirection: "vertical" },
      ],
    };
    const beforeFill: FootprintPlacement[] = board.footprints.map((footprint) => ({ id: footprint.id, position: { ...footprint.at }, rotationDeg: 0, side: "top", courtyardLocal: buildPlacementEnvelope(board, footprint).effectiveBounds, locked: false }));
    expect(runForceDirected({ board, footprints: beforeFill, params: resolveParams({ maxIterations: 1 }, 1) }).hyperedgeCount).toBe(1);
    const outer = [{ x: 0, y: 0 }, { x: mmToNm(40), y: 0 }, { x: mmToNm(40), y: mmToNm(30) }, { x: 0, y: mmToNm(30) }];
    board.zones.push({ id: "plane-gnd", layer: "in1", netId: 1, source: "stackup-plane", sourceLayerId: "in1", polygon: outer, appearance: "solid", connection: "solid", fill: [{ outer, holes: [], boundingBox: { minX: 0, minY: 0, maxX: mmToNm(40), maxY: mmToNm(30) }, areaNm2: mmToNm(40) * mmToNm(30) }], dirty: false, fillState: { status: "current", algorithmVersion: "test", sourceRevision: "test", fillHash: "test", diagnostics: [] } });
    const placements: FootprintPlacement[] = board.footprints.map((footprint) => ({ id: footprint.id, position: { ...footprint.at }, rotationDeg: 0, side: "top", courtyardLocal: buildPlacementEnvelope(board, footprint).effectiveBounds, locked: false }));
    const result = runForceDirected({ board, footprints: placements, params: resolveParams({ maxIterations: 1 }, 1) });
    expect(result.hyperedgeCount).toBe(0);
    expect(buildPlacementProblem({ board }).hyperedges[0]).toEqual(expect.objectContaining({ kind: "plane_access", decomposition: "plane_access" }));
  });
});
