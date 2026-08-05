import type { PcbBoard } from "../types";
import { comparePlacementCandidates, placementReplayArtifact, runEngineeringPlacement, type EngineeringPlacementObserver } from "./engine";
import { buildPlacementProblem } from "./problem";
import { applyPlacementCandidate } from "./transaction";
import type { EngineeringPlacementOptions, PlacementCandidate, PlacementProblem, PlacementRunResult } from "./types";

export class EngineeringPlacementService {
  private readonly runs = new Map<string, PlacementRunResult>();

  constructor(private readonly board: PcbBoard) {}

  buildProblem(options?: EngineeringPlacementOptions): PlacementProblem {
    return buildPlacementProblem({ board: this.board, options });
  }

  runPreview(options?: EngineeringPlacementOptions, observer?: EngineeringPlacementObserver): PlacementRunResult {
    const result = runEngineeringPlacement({ board: this.board, options, observer });
    this.runs.set(result.runId, result);
    return result;
  }

  getRun(runId: string): PlacementRunResult | undefined {
    return this.runs.get(runId);
  }

  listFrontier(runId: string): PlacementCandidate[] {
    const run = this.runs.get(runId);
    if (!run) return [];
    const frontier = new Set(run.frontierCandidateIds);
    return run.candidates.filter((candidate) => frontier.has(candidate.candidateId));
  }

  inspectCandidate(runId: string, candidateId: string): PlacementCandidate | undefined {
    return this.runs.get(runId)?.candidates.find((candidate) => candidate.candidateId === candidateId);
  }

  compare(runId: string, leftCandidateId: string, rightCandidateId: string): unknown {
    const left = this.inspectCandidate(runId, leftCandidateId);
    const right = this.inspectCandidate(runId, rightCandidateId);
    if (!left || !right) throw new Error("Both candidate IDs must belong to the same placement run.");
    return comparePlacementCandidates(left, right);
  }

  explain(runId: string, input: { candidateId: string; instanceId?: string; objectiveId?: string; constraintId?: string }): unknown {
    const run = this.runs.get(runId);
    const candidate = run?.candidates.find((item) => item.candidateId === input.candidateId);
    if (!run || !candidate) throw new Error("Placement run/candidate is unavailable.");
    return {
      runId,
      candidateId: candidate.candidateId,
      candidateHash: candidate.candidateHash,
      problemHash: candidate.problemHash,
      constraintProgramHash: candidate.constraintProgramHash,
      instance: input.instanceId ? {
        variable: run.problem.instances.find((instance) => instance.id === input.instanceId),
        move: candidate.moves.find((move) => move.instanceId === input.instanceId),
        hardViolations: candidate.hardReport.violations.filter((violation) => violation.objectIds.includes(input.instanceId!)),
        pinEscape: candidate.pinEscape.terminals.filter((terminal) => terminal.componentId === input.instanceId),
      } : undefined,
      objective: input.objectiveId ? candidate.objectiveReport.objectives.find((objective) => objective.id === input.objectiveId) : undefined,
      constraint: input.constraintId ? {
        rule: run.problem.program.effectiveRules.find((rule) => rule.contributingConstraintIds.includes(input.constraintId!)),
        coverage: run.problem.program.coverage.find((coverage) => coverage.constraintId === input.constraintId),
        hardViolations: candidate.hardReport.violations.filter((violation) => violation.constraintIds.includes(input.constraintId!)),
      } : undefined,
    };
  }

  applyApproved(runId: string, candidateId: string, actorId: string) {
    const run = this.runs.get(runId);
    const candidate = run?.candidates.find((item) => item.candidateId === candidateId);
    if (!run || !candidate) return { ok: false as const, code: "INVALID_CANDIDATE" as const, message: "Placement run/candidate is unavailable." };
    return applyPlacementCandidate({ board: this.board, problem: run.problem, candidate, actorId });
  }

  replay(runId: string): unknown {
    const run = this.runs.get(runId);
    if (!run) throw new Error("Placement run is unavailable.");
    return placementReplayArtifact(run);
  }
}

/** Read/preview-only AI boundary. There is intentionally no apply or coordinate setter. */
export class PlacementAgentTools {
  constructor(private readonly service: EngineeringPlacementService) {}

  build(options?: EngineeringPlacementOptions) { return this.service.buildProblem(options); }
  preview(options?: EngineeringPlacementOptions) { return this.service.runPreview(options); }
  frontier(runId: string) { return this.service.listFrontier(runId); }
  inspect(runId: string, candidateId: string) { return this.service.inspectCandidate(runId, candidateId); }
  compare(runId: string, leftCandidateId: string, rightCandidateId: string) { return this.service.compare(runId, leftCandidateId, rightCandidateId); }
  explain(runId: string, input: Parameters<EngineeringPlacementService["explain"]>[1]) { return this.service.explain(runId, input); }
  replay(runId: string) { return this.service.replay(runId); }
}
