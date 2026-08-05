import { describe, expect, it } from "vitest";
import { pcbRevisionId } from "../../revision";
import { buildPlacementProblem } from "../problem";
import { STAGE7_PLACEMENT_CORPUS } from "../corpus";
import { runEngineeringPlacement } from "../engine";

describe("Stage 7 original placement corpus", () => {
  it("contains 15 named, reproducible fixtures with explicit expectations", () => {
    expect(STAGE7_PLACEMENT_CORPUS).toHaveLength(15);
    expect(new Set(STAGE7_PLACEMENT_CORPUS.map((fixture) => fixture.id)).size).toBe(15);
    expect(STAGE7_PLACEMENT_CORPUS.every((fixture) => fixture.description.length > 0 && fixture.expected.notes !== undefined)).toBe(true);
  });

  it.each(STAGE7_PLACEMENT_CORPUS.map((fixture) => [fixture.id, fixture] as const))(
    "%s builds an immutable problem with the declared precheck state",
    (_id, fixture) => {
      const built = fixture.build();
      const before = pcbRevisionId(built.board);
      const problem = buildPlacementProblem({ board: built.board, options: built.options });
      expect(problem.feasible).toBe(fixture.expected.feasible);
      expect(problem.projectId).toBe(built.board.constraintState?.projectId);
      expect(problem.program.programHash).toBe(built.board.constraintState?.activeProgram?.programHash);
      expect(Object.isFrozen(problem)).toBe(true);
      expect(pcbRevisionId(built.board)).toBe(before);
    },
  );

  it("reduces physical overflow on the legal forced-crossing regression", () => {
    const fixture = STAGE7_PLACEMENT_CORPUS.find((item) => item.id === "forced-crossing-two-layer")!;
    const built = fixture.build();
    const run = runEngineeringPlacement({ board: built.board, options: { ...built.options, candidateCount: 3, maxIterations: 100, localRefinementPasses: 0 } });
    const current = run.candidates.find((candidate) => candidate.initializer === "current")!;
    const selected = run.candidates.find((candidate) => candidate.candidateId === run.selectedCandidateId)!;
    expect(current.hardReport.legal).toBe(true);
    expect(selected.hardReport.legal).toBe(true);
    expect(selected.congestion.totalOverflowTracks).toBeLessThan(current.congestion.totalOverflowTracks);
    expect(selected.objectiveReport.objectives.find((objective) => objective.kind === "routing_congestion")?.limitations.join(" ")).toMatch(/not routing completion/i);
  });

  it("evaluates explicit high-speed structure while retaining the Stage 8 limitation", () => {
    const fixture = STAGE7_PLACEMENT_CORPUS.find((item) => item.id === "usb-differential")!;
    const built = fixture.build();
    const run = runEngineeringPlacement({ board: built.board, options: { ...built.options, candidateCount: 2, maxIterations: 50, localRefinementPasses: 0 } });
    const selected = run.candidates.find((candidate) => candidate.candidateId === run.selectedCandidateId)!;
    const objective = selected.objectiveReport.objectives.find((item) => item.kind === "high_speed_ordering");
    expect(objective).toEqual(expect.objectContaining({ state: "evaluated", rawUnit: "nm_pair_span_mismatch_or_chain" }));
    expect(objective?.limitations.join(" ")).toMatch(/Stage 8/);
  });
});
