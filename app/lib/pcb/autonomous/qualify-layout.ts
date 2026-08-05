import type { DrcRules } from "../drc/types";
import type { AutorouteCompletionResult } from "../autoroute/completion";
import { verifyAutorouteCandidate, type AutorouteVerification } from "../autoroute/verification";
import { runEngineeringPlacement } from "../placement/engine";
import { applyPlacementCandidate } from "../placement/transaction";
import type { PlacementCandidate, PlacementRunResult } from "../placement/types";
import { pcbRevisionId } from "../revision";
import { stableHash } from "../smart-routing/hash";
import type { PcbBoard, Track, Via } from "../types";
import {
  AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1,
  evaluateAutonomousCapability,
  type AutonomousCapabilityBlocker,
  type AutonomousCapabilityEvaluation,
  type AutonomousDesignDeclaration,
} from "./capability-profile";

export interface AutonomousRouteExecution {
  sourceRevision: string;
  completion: AutorouteCompletionResult;
}

export type AutonomousRouteExecutor = (input: {
  board: PcbBoard;
  candidateId: string;
  rules: DrcRules;
  timeoutMs: number;
  signal?: AbortSignal;
}) => Promise<AutonomousRouteExecution>;

export interface AutonomousPlacementAttempt {
  attemptId: string;
  candidateId: string;
  candidateHash: string;
  seed: number;
  initializer: PlacementCandidate["initializer"];
  placement: {
    legal: boolean;
    overlapCount: number;
    outsideCount: number;
    padOutsideCount: number;
    protectedStatePreserved: boolean;
    objectivePenalty: number;
    ratsnestLengthNm: number;
  };
  placedRevision?: string;
  preRouteCapability?: AutonomousCapabilityEvaluation;
  route?: {
    status: AutorouteCompletionResult["status"];
    acceptedPasses: number;
    passIds: string[];
    dsnDigests: string[];
    sesDigests: string[];
    routerVersions: string[];
    candidateRevision: string;
    remainingConnections: number;
    shorts: number;
    routeBlockingDrcErrors: number;
    vias: number;
    routedLengthNm: number;
  };
  finalCapability?: AutonomousCapabilityEvaluation;
  decision: "placement_rejected" | "capability_rejected" | "route_rejected" | "complete";
  rejectionReasons: string[];
}

export interface AutonomousLayoutCommitRequest {
  board: PcbBoard;
  expectedSourceRevision: string;
  selectedRevision: string;
  runId: string;
  candidateId: string;
}

export interface AutonomousLayoutQualificationResult {
  schemaVersion: "sirkit.autonomous-layout-qualification.v1";
  runId: string;
  status: "complete" | "blocked" | "cancelled" | "stale";
  sourceRevision: string;
  capability: AutonomousCapabilityEvaluation;
  placementRun?: PlacementRunResult;
  attempts: AutonomousPlacementAttempt[];
  selectedCandidateId?: string;
  selectedBoard?: PcbBoard;
  selectedRevision?: string;
  selectedVerification?: AutorouteVerification;
  finalCapability?: AutonomousCapabilityEvaluation;
  blockers: AutonomousCapabilityBlocker[];
  totalElapsedMs: number;
  authorityMutated: boolean;
  committedRevision?: string;
}

function protectedCopper(board: PcbBoard): { tracks: Track[]; vias: Via[] } {
  const protectedItem = (item: Track | Via): boolean => item.locked === true || item.source === "human" || item.source === "imported" || item.source === undefined;
  return {
    tracks: board.tracks.filter(protectedItem).map((track) => structuredClone(track)).sort((left, right) => left.id.localeCompare(right.id)),
    vias: board.vias.filter(protectedItem).map((via) => structuredClone(via)).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function protectedCopperMatches(expected: ReturnType<typeof protectedCopper>, board: PcbBoard): boolean {
  return JSON.stringify(expected) === JSON.stringify(protectedCopper(board));
}

function routedLengthNm(board: PcbBoard): number {
  return board.tracks.reduce((sum, track) => sum + Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y), 0);
}

function routeRank(attempt: AutonomousPlacementAttempt): [number, number, number, string] {
  return [
    attempt.route?.vias ?? Number.MAX_SAFE_INTEGER,
    attempt.route?.routedLengthNm ?? Number.MAX_SAFE_INTEGER,
    attempt.placement.objectivePenalty,
    attempt.candidateId,
  ];
}

function compareRank(left: AutonomousPlacementAttempt, right: AutonomousPlacementAttempt): number {
  const a = routeRank(left);
  const b = routeRank(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3].localeCompare(b[3]);
}

function failure(code: string, message: string, objectIds: string[] = []): AutonomousCapabilityBlocker {
  return { code, category: code.includes("STALE") ? "stale" : "invalid", message, objectIds: [...objectIds].sort() };
}

export async function qualifyAutonomousLayout(input: {
  board: PcbBoard;
  rules: DrcRules;
  declaration?: AutonomousDesignDeclaration;
  router: AutonomousRouteExecutor;
  projectId?: string;
  seeds?: number[];
  placementCandidateCount?: number;
  routedCandidateLimit?: number;
  maxRuntimeMs?: number;
  runLabel?: string;
  signal?: AbortSignal;
  commitSelected?: (request: AutonomousLayoutCommitRequest) => Promise<{ ok: boolean; committedRevision?: string; error?: string }>;
}): Promise<AutonomousLayoutQualificationResult> {
  const startedAt = Date.now();
  const sourceRevision = pcbRevisionId(input.board);
  const profile = AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1;
  const candidateCount = Math.max(1, Math.min(profile.limits.maxPlacementCandidates, Math.round(input.placementCandidateCount ?? 3)));
  const routedCandidateLimit = Math.max(1, Math.min(profile.limits.maxRoutedCandidates, Math.round(input.routedCandidateLimit ?? 2)));
  const maxRuntimeMs = Math.max(1_000, Math.min(profile.limits.maxRuntimeMs, Math.round(input.maxRuntimeMs ?? profile.limits.maxRuntimeMs)));
  const seeds = [...new Set(input.seeds ?? [101, 202, 303, 404])].slice(0, candidateCount);
  const runId = `autolayout-${stableHash(JSON.stringify({ sourceRevision, declaration: input.declaration?.revision, seeds, candidateCount, routedCandidateLimit, maxRuntimeMs, runLabel: input.runLabel ?? "default" }))}`;
  const capability = evaluateAutonomousCapability({ board: input.board, rules: input.rules, declaration: input.declaration, phase: "pre_placement", expectedSourceRevision: sourceRevision });
  const base = {
    schemaVersion: "sirkit.autonomous-layout-qualification.v1" as const,
    runId,
    sourceRevision,
    capability,
    attempts: [] as AutonomousPlacementAttempt[],
    totalElapsedMs: 0,
    authorityMutated: false,
  };
  if (capability.status !== "eligible" || !capability.placementMayStart) return { ...base, status: "blocked", blockers: capability.blockers, totalElapsedMs: Date.now() - startedAt };
  if (input.signal?.aborted) return { ...base, status: "cancelled", blockers: [failure("CAP_CANCELLED", "Autonomous layout was cancelled before placement.")], totalElapsedMs: Date.now() - startedAt };

  const placementRun = runEngineeringPlacement({
    board: input.board,
    options: {
      projectId: input.projectId ?? "autonomous-layout-v1",
      mode: input.board.tracks.length || input.board.vias.length ? "preserve_routed" : "initial_unrouted",
      seeds,
      candidateCount,
      localRefinementPasses: 1,
      timeoutMs: Math.min(maxRuntimeMs, 20_000),
    },
    observer: { shouldCancel: () => input.signal?.aborted === true },
  });
  if (input.signal?.aborted || placementRun.termination === "cancelled") return { ...base, placementRun, status: "cancelled", blockers: [failure("CAP_CANCELLED", "Autonomous layout was cancelled during placement.")], totalElapsedMs: Date.now() - startedAt };

  const protectedBefore = protectedCopper(input.board);
  const completedRoutes = new Map<string, { board: PcbBoard; verification: AutorouteVerification; finalCapability: AutonomousCapabilityEvaluation }>();
  const legalCandidates = placementRun.candidates
    .filter((candidate) => candidate.hardReport.legal)
    .sort((left, right) => Number(right.selected) - Number(left.selected) || left.objectiveReport.evaluatedWeightedPenalty - right.objectiveReport.evaluatedWeightedPenalty || left.legacyDiagnostics.ratsnestLengthNm - right.legacyDiagnostics.ratsnestLengthNm || left.candidateId.localeCompare(right.candidateId));
  const attempts: AutonomousPlacementAttempt[] = placementRun.candidates.filter((candidate) => !candidate.hardReport.legal).map((candidate) => ({
    attemptId: `${runId}:${candidate.candidateId}`,
    candidateId: candidate.candidateId,
    candidateHash: candidate.candidateHash,
    seed: candidate.seed,
    initializer: candidate.initializer,
    placement: {
      legal: false,
      overlapCount: candidate.hardReport.overlapCount,
      outsideCount: candidate.hardReport.outsideCount,
      padOutsideCount: candidate.hardReport.padOutsideCount,
      protectedStatePreserved: candidate.hardReport.protectedStatePreserved,
      objectivePenalty: candidate.objectiveReport.evaluatedWeightedPenalty,
      ratsnestLengthNm: candidate.legacyDiagnostics.ratsnestLengthNm,
    },
    decision: "placement_rejected",
    rejectionReasons: candidate.hardReport.violations.map((violation) => `${violation.code}: ${violation.message}`),
  }));

  for (const candidate of legalCandidates.slice(0, routedCandidateLimit)) {
    const attempt: AutonomousPlacementAttempt = {
      attemptId: `${runId}:${candidate.candidateId}`,
      candidateId: candidate.candidateId,
      candidateHash: candidate.candidateHash,
      seed: candidate.seed,
      initializer: candidate.initializer,
      placement: {
        legal: candidate.hardReport.legal,
        overlapCount: candidate.hardReport.overlapCount,
        outsideCount: candidate.hardReport.outsideCount,
        padOutsideCount: candidate.hardReport.padOutsideCount,
        protectedStatePreserved: candidate.hardReport.protectedStatePreserved,
        objectivePenalty: candidate.objectiveReport.evaluatedWeightedPenalty,
        ratsnestLengthNm: candidate.legacyDiagnostics.ratsnestLengthNm,
      },
      decision: "route_rejected",
      rejectionReasons: [],
    };
    attempts.push(attempt);
    if (input.signal?.aborted || Date.now() - startedAt >= maxRuntimeMs) {
      attempt.rejectionReasons.push(input.signal?.aborted ? "Cancelled before routing." : "Bounded autonomous runtime exhausted before routing.");
      break;
    }
    const placed = applyPlacementCandidate({ board: input.board, problem: placementRun.problem, candidate, actorId: "system:autonomous-layout-v1" });
    if (!placed.ok) {
      attempt.decision = "placement_rejected";
      attempt.rejectionReasons.push(`${placed.code}: ${placed.message}`);
      continue;
    }
    const placedBoard = placed.board;
    const placedRevision = pcbRevisionId(placedBoard);
    attempt.placedRevision = placedRevision;
    const placementEvidence = { legal: true, overlapCount: candidate.hardReport.overlapCount, outsideCount: candidate.hardReport.outsideCount, padOutsideCount: candidate.hardReport.padOutsideCount };
    const preRouteCapability = evaluateAutonomousCapability({ board: placedBoard, rules: input.rules, declaration: input.declaration, phase: "pre_autoroute", expectedSourceRevision: placedRevision, evidence: { placement: placementEvidence } });
    attempt.preRouteCapability = preRouteCapability;
    if (preRouteCapability.status !== "eligible" || !preRouteCapability.autoroutingMayStart) {
      attempt.decision = "capability_rejected";
      attempt.rejectionReasons.push(...preRouteCapability.blockers.map((item) => `${item.code}: ${item.message}`));
      continue;
    }
    const remainingMs = Math.max(1, maxRuntimeMs - (Date.now() - startedAt));
    const route = await input.router({ board: placedBoard, candidateId: candidate.candidateId, rules: input.rules, timeoutMs: remainingMs, signal: input.signal });
    const verification = verifyAutorouteCandidate(route.completion.candidate, input.rules);
    attempt.route = {
      status: route.completion.status,
      acceptedPasses: route.completion.acceptedPasses,
      passIds: route.completion.attempts.map((item) => item.routeAttemptId),
      dsnDigests: route.completion.attempts.flatMap((item) => item.evidence.dsnDigest ? [item.evidence.dsnDigest] : []),
      sesDigests: route.completion.attempts.flatMap((item) => item.evidence.sesDigest ? [item.evidence.sesDigest] : []),
      routerVersions: [...new Set(route.completion.attempts.flatMap((item) => item.evidence.router?.version ? [item.evidence.router.version] : []))],
      candidateRevision: verification.designRevision,
      remainingConnections: verification.remainingConnections,
      shorts: verification.shorts,
      routeBlockingDrcErrors: verification.routeBlockingDrcErrors,
      vias: route.completion.candidate.vias.length,
      routedLengthNm: routedLengthNm(route.completion.candidate),
    };
    if (route.sourceRevision !== placedRevision) attempt.rejectionReasons.push("Router result source revision is stale or belongs to another placement candidate.");
    if (route.completion.verification.designRevision !== verification.designRevision) attempt.rejectionReasons.push("RC02 completion evidence does not describe the exact returned routing candidate.");
    if (!protectedCopperMatches(protectedBefore, route.completion.candidate)) attempt.rejectionReasons.push("Protected human/imported/locked copper changed during autonomous layout.");
    const complete = route.completion.status === "complete" && verification.status === "complete" && verification.remainingConnections === 0 && verification.shorts === 0 && verification.routeBlockingDrcErrors === 0;
    if (!complete) attempt.rejectionReasons.push("Actual RC02 routing verification remained incomplete or blocked.");
    const finalCapability = evaluateAutonomousCapability({
      board: route.completion.candidate,
      rules: input.rules,
      declaration: input.declaration,
      phase: "post_layout",
      expectedSourceRevision: verification.designRevision,
      evidence: { placement: placementEvidence, routing: { complete, remainingConnections: verification.remainingConnections, shorts: verification.shorts, routeBlockingDrcErrors: verification.routeBlockingDrcErrors } },
    });
    attempt.finalCapability = finalCapability;
    if (finalCapability.status !== "eligible") attempt.rejectionReasons.push(...finalCapability.blockers.map((item) => `${item.code}: ${item.message}`));
    if (attempt.rejectionReasons.length === 0) {
      attempt.decision = "complete";
      completedRoutes.set(candidate.candidateId, { board: route.completion.candidate, verification, finalCapability });
    }
  }

  if (input.signal?.aborted) return { ...base, placementRun, attempts, status: "cancelled", blockers: [failure("CAP_CANCELLED", "Autonomous layout was cancelled; authority was not changed.")], totalElapsedMs: Date.now() - startedAt };
  if (pcbRevisionId(input.board) !== sourceRevision) return { ...base, placementRun, attempts, status: "stale", blockers: [failure("CAP_SOURCE_REVISION_STALE", "Authoritative board changed while autonomous candidates were evaluated.")], totalElapsedMs: Date.now() - startedAt };

  const successful = attempts.filter((attempt) => attempt.decision === "complete").sort(compareRank);
  const selectedAttempt = successful[0];
  const selectedCandidate = selectedAttempt ? legalCandidates.find((candidate) => candidate.candidateId === selectedAttempt.candidateId) : undefined;
  const selectedRoute = selectedAttempt ? completedRoutes.get(selectedAttempt.candidateId) : undefined;
  if (!selectedAttempt || !selectedCandidate || !selectedRoute) {
    const blockers = legalCandidates.length === 0
      ? [failure("CAP_NO_LEGAL_PLACEMENT", `Placement terminated ${placementRun.termination} without a legal candidate.`)]
      : [failure("CAP_NO_COMPLETE_ROUTE", "No bounded placement candidate produced a complete RC02 route.", attempts.flatMap((attempt) => attempt.rejectionReasons))];
    return { ...base, placementRun, attempts, status: "blocked", blockers, totalElapsedMs: Date.now() - startedAt };
  }
  const selectedBoard = selectedRoute.board;
  const selectedVerification = selectedRoute.verification;
  if (selectedVerification.status !== "complete" || !protectedCopperMatches(protectedBefore, selectedBoard)) return { ...base, placementRun, attempts, status: "stale", blockers: [failure("CAP_SELECTED_RESULT_REVALIDATION_FAILED", "Selected candidate changed or failed exact revalidation before commit.")], totalElapsedMs: Date.now() - startedAt };
  const finalCapability = selectedRoute.finalCapability;
  if (finalCapability.status !== "eligible") return { ...base, placementRun, attempts, status: "blocked", blockers: finalCapability.blockers, totalElapsedMs: Date.now() - startedAt };

  let authorityMutated = false;
  let committedRevision: string | undefined;
  if (input.commitSelected) {
    const committed = await input.commitSelected({ board: selectedBoard, expectedSourceRevision: sourceRevision, selectedRevision: selectedVerification.designRevision, runId, candidateId: selectedCandidate.candidateId });
    if (!committed.ok || committed.committedRevision !== selectedVerification.designRevision) return { ...base, placementRun, attempts, status: "stale", blockers: [failure("CAP_COMMIT_REJECTED", committed.error ?? "Atomic autonomous layout commit did not preserve the selected revision.")], totalElapsedMs: Date.now() - startedAt };
    authorityMutated = true;
    committedRevision = committed.committedRevision;
  }
  return {
    ...base,
    placementRun,
    attempts,
    status: "complete",
    blockers: [],
    selectedCandidateId: selectedCandidate.candidateId,
    selectedBoard,
    selectedRevision: selectedVerification.designRevision,
    selectedVerification,
    finalCapability,
    totalElapsedMs: Date.now() - startedAt,
    authorityMutated,
    ...(committedRevision ? { committedRevision } : {}),
  };
}
