import { describe, expect, it } from "vitest";
import { buildFixtureBoard30 } from "../../__tests__/autoplace-fixture";
import { activateConstraints, makeBoard, makeDef, makeInstance, makePad, protectedCopperBoard } from "./fixtures";
import type { ConstraintRelationship } from "@/app/lib/constraints/types";
import { runEngineeringPlacement, placementReplayArtifact, EngineeringPlacementCancelledError } from "../engine";
import { applyPlacementCandidate, placementCandidateIntegrityErrors, revertPlacementTransaction } from "../transaction";
import { pcbRevisionId } from "../../revision";
import { EngineeringPlacementService, PlacementAgentTools } from "../service";
import { POST as previewRoute } from "@/app/api/pcb/placement/preview/route";
import { PCB_AI_TOOLS } from "../../ai/pcb-tool-schemas";

const origin = { kind: "project" as const, sourceId: "source:stage7-test", sourceRevision: "1" };

function relationship(id: string, kind: ConstraintRelationship["kind"], members: ConstraintRelationship["members"]): ConstraintRelationship {
  return { id, revision: 1, kind, members, origin, evidenceIds: [`evidence:${id}`], lifecycle: "active" };
}

describe("Stage 7 sourced engineering objectives", () => {
  it("evaluates exact-terminal decoupling and explicit current-loop geometry without claiming signoff", () => {
    const pin = makeDef("PIN", 1, 1, [makePad("1", 0, 0)]);
    const board = makeBoard(30, 20, [
      makeInstance("u1", pin, { x: 10, y: 10 }, { "1": 1 }),
      makeInstance("c1", pin, { x: 12, y: 10 }, { "1": 1 }),
      makeInstance("l1", pin, { x: 15, y: 10 }, { "1": 1 }),
    ], 1);
    const constrained = activateConstraints(board, [], [
      relationship("relation:decoupling", "decoupling", [{ role: "load", targetType: "component", targetId: "component:u1" }, { role: "capacitor", targetType: "component", targetId: "component:c1" }]),
      relationship("relation:loop", "current_loop", [{ role: "switch", targetType: "component", targetId: "component:u1" }, { role: "inductor", targetType: "component", targetId: "component:l1" }, { role: "capacitor", targetType: "component", targetId: "component:c1" }]),
    ]);
    const run = runEngineeringPlacement({ board: constrained, options: { projectId: "stage7-test", candidateCount: 3, localRefinementPasses: 0 } });
    const candidate = run.candidates.find((item) => item.candidateId === run.selectedCandidateId)!;
    const decoupling = candidate.objectiveReport.objectives.find((item) => item.kind === "decoupling");
    const loop = candidate.objectiveReport.objectives.find((item) => item.kind === "critical_loop");
    expect(decoupling).toEqual(expect.objectContaining({ state: "evaluated", rawUnit: "nm_terminal_distance", evidenceIds: ["evidence:relation:decoupling"] }));
    expect(decoupling?.limitations.join(" ")).toMatch(/does not prove/);
    expect(loop).toEqual(expect.objectContaining({ state: "evaluated", rawUnit: "nm_loop_perimeter" }));
    expect(loop?.limitations.join(" ")).toMatch(/Not EMI/);
    expect(candidate.objectiveReport.objectives.find((item) => item.kind === "thermal_intent")?.state).toBe("unknown");
  });
});

describe("Stage 7 revision-bound placement transaction", () => {
  it("applies and reverts an exact hard-legal candidate and rejects tamper/stale state", () => {
    const board = buildFixtureBoard30();
    const run = runEngineeringPlacement({ board, options: { candidateCount: 2, localRefinementPasses: 0 } });
    const candidate = run.candidates.find((item) => item.candidateId === run.selectedCandidateId)!;
    expect(placementCandidateIntegrityErrors(candidate)).toEqual([]);
    const applied = applyPlacementCandidate({ board, problem: run.problem, candidate, actorId: "user:test" });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.transaction.beforeRevision).toBe(pcbRevisionId(board));
    expect(applied.transaction.afterRevision).toBe(pcbRevisionId(applied.board));
    const reverted = revertPlacementTransaction({ board: applied.board, transaction: applied.transaction });
    expect(reverted.ok).toBe(true);
    if (reverted.ok) expect(pcbRevisionId(reverted.board)).toBe(pcbRevisionId(board));

    const tampered = structuredClone(candidate);
    tampered.placements[Object.keys(tampered.placements)[0]].position.x += 1;
    expect(placementCandidateIntegrityErrors(tampered)).toContain("candidate semantic hash mismatch");
    expect(applyPlacementCandidate({ board, problem: run.problem, candidate: tampered, actorId: "user:test" })).toEqual(expect.objectContaining({ ok: false, code: "INVALID_CANDIDATE" }));

    const changed = structuredClone(board);
    changed.texts.push({ id: "note", text: "changed", at: { x: 0, y: 0 }, rotationDeg: 0, layer: "silkTop", sizeX: 1_000_000, sizeY: 1_000_000, thickness: 100_000 });
    expect(applyPlacementCandidate({ board: changed, problem: run.problem, candidate, actorId: "user:test" })).toEqual(expect.objectContaining({ ok: false, code: "STALE_BOARD" }));
  });

  it("keeps manual copper protected and makes generated rip-up explicit", () => {
    const board = protectedCopperBoard();
    const run = runEngineeringPlacement({ board, options: { mode: "generated_copper_ripup", candidateCount: 3, localRefinementPasses: 0 } });
    const moving = run.candidates.find((candidate) => candidate.moves.some((move) => move.instanceId === "b") && candidate.hardReport.legal);
    expect(moving).toBeTruthy();
    expect(moving?.copperPlan.removeTrackIds).toContain("generated-b");
    expect(moving?.copperPlan.removeViaIds).toContain("generated-via-b");
    expect(moving?.copperPlan.protectedObjectIds).not.toContain("manual-a");
    expect(moving?.copperPlan.protectedObjectIds).not.toContain("manual-via-a");
    expect(moving?.copperPlan.resultingConnectivity).toBe("incomplete");
    expect(moving?.placements.a.position).toEqual(board.footprints.find((footprint) => footprint.id === "a")?.at);
  });
});

describe("Stage 7 provider-neutral preview and AI boundary", () => {
  it("offers build/preview/frontier/inspect/compare/explain/replay but no AI apply or coordinate setter", async () => {
    const board = buildFixtureBoard30();
    const service = new EngineeringPlacementService(board);
    const tools = new PlacementAgentTools(service);
    expect("apply" in tools).toBe(false);
    expect("setCoordinates" in tools).toBe(false);
    const run = tools.preview({ candidateCount: 3, localRefinementPasses: 0 });
    expect(tools.frontier(run.runId).length).toBeGreaterThan(0);
    const candidate = tools.inspect(run.runId, run.selectedCandidateId!);
    expect(candidate?.hardReport.legal).toBe(true);
    expect(tools.explain(run.runId, { candidateId: candidate!.candidateId, instanceId: "fp-000" })).toEqual(expect.objectContaining({ candidateHash: candidate!.candidateHash }));
    expect(JSON.stringify(tools.replay(run.runId))).not.toMatch(/sk-|api[_-]?key|Users\\/i);
    expect(PCB_AI_TOOLS.some((tool) => tool.name === "apply_placement")).toBe(false);

    const response = await previewRoute(new Request("http://localhost/api/pcb/placement/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ board, options: { candidateCount: 2, localRefinementPasses: 0 } }) }));
    expect(response.status).toBe(200);
    const body = await response.json() as { ok: boolean; result: { selectedCandidateId?: string } };
    expect(body.ok).toBe(true);
    expect(body.result.selectedCandidateId).toBeTruthy();
  });

  it("replays deterministically and distinguishes cancellation from placement failure", () => {
    const board = buildFixtureBoard30();
    const options = { seeds: [17, 23], candidateCount: 3, localRefinementPasses: 0 };
    const first = runEngineeringPlacement({ board, options });
    const second = runEngineeringPlacement({ board: structuredClone(board), options });
    expect(placementReplayArtifact(first)).toEqual(placementReplayArtifact(second));
    expect(() => runEngineeringPlacement({ board, options, observer: { shouldCancel: () => true } })).toThrow(EngineeringPlacementCancelledError);
  });
});
