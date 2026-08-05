import { describe, expect, it } from "vitest";
import { buildPlacementProblem } from "../problem";
import { runEngineeringPlacement } from "../engine";
import { validatePlacementCandidate } from "../validator";
import { sourcePlacementRecord } from "../geometry";
import { activateConstraints, makeBoard, makeDef, makeInstance, makePad, placementRule, protectedCopperBoard } from "./fixtures";
import { mmToNm } from "../../units";

describe("Stage 7 feasibility precheck", () => {
  it("rejects obvious board-area and fixed-overlap impossibility with stable object diagnostics", () => {
    const large = makeDef("TOO_LARGE", 20, 20, []);
    const area = makeBoard(10, 10, [makeInstance("large", large, { x: 5, y: 5 })], 0);
    expect(buildPlacementProblem({ board: area }).diagnostics.map((item) => item.code)).toContain("BOARD_AREA_INFEASIBLE");
    const tooLong = makeBoard(20, 20, [makeInstance("long", makeDef("TOO_LONG", 30, 1, []), { x: 10, y: 10 })], 0);
    expect(buildPlacementProblem({ board: tooLong }).diagnostics.map((item) => item.code)).toContain("INSTANCE_ENVELOPE_EXCEEDS_OUTLINE_BOUNDS");

    const chip = makeDef("LOCKED", 2, 2, []);
    const overlap = makeBoard(20, 20, [makeInstance("a", chip, { x: 10, y: 10 }, {}, { locked: true }), makeInstance("b", chip, { x: 10, y: 10 }, {}, { locked: true })], 0);
    const problem = buildPlacementProblem({ board: overlap });
    expect(problem.feasible).toBe(false);
    expect(problem.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: "FIXED_OBJECTS_OVERLAP", objectIds: ["a", "b"] })]));
    expect(runEngineeringPlacement({ board: overlap }).termination).toBe("infeasible");
  });

  it("rejects empty rotation intersections and missing exact region geometry", () => {
    const chip = makeDef("RULED", 2, 2, [makePad("1", 0, 0)]);
    const board = makeBoard(20, 20, [makeInstance("a", chip, { x: 10, y: 10 }, { "1": 1 }, { rotationDeg: 0 })], 1);
    board.footprints[0].placementConstraints = { allowedRotations: [0] };
    const constrained = activateConstraints(board, [
      placementRule({ id: "c:rotation", targetId: "component:a", kind: "placement_orientation", requirement: { form: "allowed_set", values: ["90"] } }),
      placementRule({ id: "c:region", targetId: "component:a", kind: "placement_region", requirement: { form: "containment", regionIds: ["region:missing"], mode: "inside" } }),
    ]);
    const problem = buildPlacementProblem({ board: constrained, options: { projectId: "stage7-test" } });
    expect(problem.feasible).toBe(false);
    expect(problem.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["NO_ALLOWED_ROTATION", "PLACEMENT_REGION_GEOMETRY_MISSING"]));
  });
});

describe("Stage 7 movement and hard validation", () => {
  it("rejects envelopes spanning a concave outline notch and forbidden regions enclosed by an envelope", () => {
    const wide = makeDef("NOTCH_SPAN", 10, 5, []);
    const notched = makeBoard(20, 20, [makeInstance("span", wide, { x: 10, y: 12.5 })], 0);
    notched.outline = { kind: "polygon", points: [[0, 0], [20, 0], [20, 20], [12, 20], [12, 8], [8, 8], [8, 20], [0, 20]].map(([x, y]) => ({ x: mmToNm(x), y: mmToNm(y) })) };
    const notchProblem = buildPlacementProblem({ board: notched });
    expect(validatePlacementCandidate(notchProblem, sourcePlacementRecord(notchProblem)).violations.map((item) => item.code)).toContain("FOOTPRINT_OUTSIDE_BOARD");

    const chip = makeDef("REGION_SPAN", 4, 4, []);
    const regionBoard = makeBoard(20, 20, [makeInstance("u1", chip, { x: 10, y: 10 })], 0);
    const constrained = activateConstraints(regionBoard, [placementRule({ id: "c:forbidden", targetId: "component:u1", kind: "placement_region", requirement: { form: "containment", regionIds: ["region:inside-envelope"], mode: "outside" } })]);
    const regionProblem = buildPlacementProblem({ board: constrained, options: { projectId: "stage7-test", regions: [{ id: "region:inside-envelope", name: "Inner keepout", kind: "keepout", polygon: [[9, 9], [11, 9], [11, 11], [9, 11]].map(([x, y]) => ({ x: mmToNm(x), y: mmToNm(y) })), sourceConstraintIds: ["c:forbidden"] }] } });
    expect(validatePlacementCandidate(regionProblem, sourcePlacementRecord(regionProblem)).violations.map((item) => item.code)).toContain("PLACEMENT_REGION_EXCLUSION");
  });

  it("classifies protected/generated copper by explicit mode and never moves protected attachments", () => {
    const board = protectedCopperBoard();
    const preserve = buildPlacementProblem({ board, options: { mode: "preserve_routed" } });
    expect(preserve.instances.find((instance) => instance.id === "a")).toEqual(expect.objectContaining({ movable: false, fixedReasons: expect.arrayContaining(["attached_protected_copper"]) }));
    expect(preserve.instances.find((instance) => instance.id === "b")).toEqual(expect.objectContaining({ movable: false, fixedReasons: expect.arrayContaining(["preserve_routed_copper"]) }));

    const ripup = buildPlacementProblem({ board, options: { mode: "generated_copper_ripup" } });
    expect(ripup.instances.find((instance) => instance.id === "a")?.movable).toBe(false);
    expect(ripup.instances.find((instance) => instance.id === "b")?.movable).toBe(true);
  });

  it("treats edge intent as an exact edge relationship rather than immovability", () => {
    const chip = makeDef("EDGE", 2, 2, [makePad("1", 0, 0)]);
    const board = makeBoard(30, 20, [makeInstance("j1", chip, { x: 15, y: 10 })], 0);
    board.footprints[0].placementConstraints = { edgeConnector: "left", allowedRotations: [0, 180] };
    const run = runEngineeringPlacement({ board, options: { candidateCount: 3, localRefinementPasses: 0 } });
    const selected = run.candidates.find((candidate) => candidate.candidateId === run.selectedCandidateId);
    expect(selected?.hardReport.legal).toBe(true);
    expect(run.problem.instances[0].movable).toBe(true);
    expect(selected?.placements.j1.position.x).toBeGreaterThan(0);
    expect(selected?.placements.j1.position.x).toBeLessThan(mmToNm(3));
  });

  it("never selects a hard-invalid transform regardless of soft metrics", () => {
    const chip = makeDef("ONE", 2, 2, []);
    const board = makeBoard(20, 20, [makeInstance("a", chip, { x: 10, y: 10 })], 0);
    board.footprints[0].placementConstraints = { allowedRotations: [0] };
    const problem = buildPlacementProblem({ board });
    const illegal = sourcePlacementRecord(problem);
    illegal.a.rotationDeg = 90;
    const report = validatePlacementCandidate(problem, illegal);
    expect(report.legal).toBe(false);
    expect(report.violations.map((item) => item.code)).toContain("PLACEMENT_ROTATION_NOT_ALLOWED");
    const run = runEngineeringPlacement({ board, options: { candidateCount: 2 } });
    expect(run.candidates.find((candidate) => candidate.candidateId === run.selectedCandidateId)?.hardReport.legal).toBe(true);
    expect(run.candidates.every((candidate) => candidate.selected ? candidate.hardReport.legal : true)).toBe(true);
  });
});
