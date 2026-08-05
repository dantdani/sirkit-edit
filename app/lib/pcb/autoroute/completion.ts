import type { PcbBoard } from "../types";
import type { DrcRules } from "../drc/types";
import type { DsnValidationReport } from "../dsn/preflight";
import type { SesLayerUsage, SesResult } from "../dsn/read-ses";
import type { LayerId } from "../layers";
import { verifyAutorouteCandidate, type AutorouteVerification } from "./verification";
import { analyzePlacementRouteability, type PlacementRouteabilityReport } from "../autoplace/routeability";
import { padWorldPosition } from "../geometry-copper";
import { routableCopperLayers } from "../stackup";
import { pcbRevisionId } from "../revision";
import { stableHash } from "../smart-routing/hash";

export const AUTOROUTE_COMPLETION_DEFAULTS = {
  maxGlobalPasses: 5,
  maxSelectedNetRetries: 3,
  maxNoImprovementPasses: 2,
  baseEnginePasses: 100,
} as const;

export interface AutoroutePassRequest {
  board: PcbBoard;
  routeAttemptId: string;
  requestedSourceRevision: string;
  targetNetIds?: number[];
  passIndex: number;
  engineMaxPasses: number;
  effort: "high" | "higher" | "maximum";
}

export interface AutoroutePassOutput {
  ok: boolean;
  routeAttemptId?: string;
  authoritativeSourceRevision?: string;
  sourceRevision?: string;
  candidateRevision?: string;
  phase?: "process" | "file" | "parse" | "candidate" | "acceptance";
  candidate?: PcbBoard;
  sesText?: string;
  dsnText?: string;
  stderr?: string;
  elapsedMs: number;
  layerUsage?: Partial<Record<LayerId, SesLayerUsage>>;
  validation?: DsnValidationReport;
  parsed?: SesResult;
  error?: string;
  evidence?: AutorouteBoundaryEvidence;
}

export interface AutorouteBoundaryEvidence {
  dsnDigest?: string;
  dsnSourceRevision?: string;
  router?: {
    engine: "Freerouting";
    version: string;
    runtime: string;
    commandProfile: "headless-offline-cli";
    maxPasses: number;
    timeoutMs: number;
  };
  processStatus?: "not-started" | "exit-success" | "exit-nonzero" | "timeout" | "cancelled" | "spawn-failed";
  outputFileStatus?: "not-checked" | "missing" | "empty" | "nonempty";
  sesDigest?: string;
  sesByteLength?: number;
  parserStatus?: "not-run" | "rejected" | "success";
  semanticStatus?: "not-run" | "rejected" | "success";
  importedTrackCount?: number;
  importedViaCount?: number;
}

export type AutoroutePassExecutor = (request: AutoroutePassRequest) => Promise<AutoroutePassOutput>;

export interface AutorouteCompletionOptions {
  maxGlobalPasses?: number;
  maxSelectedNetRetries?: number;
  maxNoImprovementPasses?: number;
  baseEnginePasses?: number;
  selectedNetIds?: number[];
  attemptNamespace?: string;
}

export interface AutorouteAttemptArtifact {
  routeAttemptId: string;
  reportedRouteAttemptId?: string;
  pass: number;
  sourceRevision: string;
  reportedSourceRevision?: string;
  candidateRevision?: string;
  phase: "process" | "file" | "parse" | "candidate" | "acceptance";
  accepted: boolean;
  dsnText?: string;
  sesText?: string;
  stderr?: string;
  validation?: DsnValidationReport;
  parsed?: SesResult;
  error?: string;
  elapsedMs: number;
  targetNetIds: number[];
  effort: AutoroutePassRequest["effort"];
  engineMaxPasses: number;
  evidence: AutorouteBoundaryEvidence;
  connectivityBefore: { completed: number; remaining: number };
  connectivityAfter?: { completed: number; remaining: number };
  drcBefore: { errors: number; routeBlockingErrors: number };
  drcAfter?: { errors: number; routeBlockingErrors: number };
  decision: "failed" | "rejected" | "accepted";
  rejectionReasons: string[];
  returnedCandidate: boolean;
}

export interface AutoroutePassReport {
  pass: number;
  routeAttemptId: string;
  sourceRevision: string;
  candidateRevision?: string;
  phase: AutorouteAttemptArtifact["phase"];
  scope: "all_incomplete" | "selected_incomplete";
  targetNetIds: number[];
  effort: AutoroutePassRequest["effort"];
  engineMaxPasses: number;
  accepted: boolean;
  reason: string;
  completedBefore: number;
  completedAfter: number;
  remainingBefore: number;
  remainingAfter: number;
  lostPreviouslyCompleteNetIds: number[];
  lostPreviouslyCompleteStableNetIds: string[];
  lostAssignedEndpointKeys: string[];
  newShorts: number;
  newShortIds: string[];
  newUnresolvedFacts: string[];
  newDrcErrors: number;
  elapsedMs: number;
}

export interface AutorouteConnectionEndpoint {
  footprintId: string;
  reference: string;
  padNumber: string;
}

export interface AutorouteUnresolvedConnection {
  netId: number;
  netName: string;
  from?: AutorouteConnectionEndpoint;
  to?: AutorouteConnectionEndpoint;
  location: { x: number; y: number };
  failure: string;
  primaryBlockers: string[];
  suggestedRepair: string[];
}

export interface AutorouteCompletionResult {
  status: "complete" | "blocked";
  candidate: PcbBoard;
  verification: AutorouteVerification;
  routeability: PlacementRouteabilityReport;
  passes: AutoroutePassReport[];
  failures: AutorouteUnresolvedConnection[];
  totalElapsedMs: number;
  acceptedPasses: number;
  attempts: AutorouteAttemptArtifact[];
  lastAttempt?: AutorouteAttemptArtifact;
  bestAcceptedAttempt?: AutorouteAttemptArtifact;
  /** @deprecated Use lastAttempt. */
  lastSesText?: string;
  lastDsnText?: string;
  lastStderr?: string;
  lastValidation?: DsnValidationReport;
  lastParsed?: SesResult;
  engineError?: string;
}

const clampInteger = (value: number | undefined, fallback: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value ?? fallback)));

function incompleteNetIds(verification: AutorouteVerification, selected?: ReadonlySet<number>): number[] {
  return verification.perNet
    .filter((net) => !net.complete && (!selected || selected.has(net.netId)))
    .map((net) => net.netId)
    .sort((a, b) => a - b);
}

function completedNetIds(verification: AutorouteVerification): Set<number> {
  return new Set(verification.perNet.filter((net) => net.complete).map((net) => net.netId));
}

function completedStableNetIds(verification: AutorouteVerification): Set<string> {
  return new Set(verification.perNet.filter((net) => net.complete).map((net) => net.stableNetId));
}

function effortForPass(pass: number): AutoroutePassRequest["effort"] {
  return pass <= 1 ? "high" : pass <= 3 ? "higher" : "maximum";
}

function endpointPads(board: PcbBoard, netId: number): Array<AutorouteConnectionEndpoint & { x: number; y: number }> {
  return board.footprints.flatMap((footprint) => footprint.def.pads.flatMap((pad) => {
    if ((footprint.padNets[pad.number] ?? 0) !== netId) return [];
    const point = padWorldPosition(footprint, pad);
    return [{ footprintId: footprint.id, reference: footprint.ref, padNumber: pad.number, x: point.x, y: point.y }];
  }));
}

function nearestEndpoint(
  pads: ReturnType<typeof endpointPads>,
  point: { x: number; y: number },
): AutorouteConnectionEndpoint | undefined {
  let best: (typeof pads)[number] | undefined;
  let bestDistance = Infinity;
  for (const pad of pads) {
    const distance = (pad.x - point.x) ** 2 + (pad.y - point.y) ** 2;
    if (distance < bestDistance) {
      best = pad;
      bestDistance = distance;
    }
  }
  return best ? { footprintId: best.footprintId, reference: best.reference, padNumber: best.padNumber } : undefined;
}

function connectionFailures(
  board: PcbBoard,
  verification: AutorouteVerification,
  routeability: PlacementRouteabilityReport,
  passes: AutoroutePassReport[],
): AutorouteUnresolvedConnection[] {
  const netName = new Map(board.nets.map((net) => [net.id, net.name || `net${net.id}`]));
  const routableLayers = routableCopperLayers(board);
  return verification.remainingAirwires.map((airwire) => {
    const pads = endpointPads(board, airwire.netId);
    const from = nearestEndpoint(pads, airwire.from);
    const to = nearestEndpoint(pads, airwire.to);
    const endpointKeys = new Set([from, to].filter(Boolean).map((endpoint) => `${endpoint!.footprintId}:${endpoint!.padNumber}`));
    const accessFailures = routeability.pinAccessFailures.filter((failure) => endpointKeys.has(`${failure.footprintId}:${failure.padNumber}`));
    const blockers: string[] = accessFailures.map((failure) =>
      `${failure.ref}.${failure.padNumber}: ${failure.reason === "outside-board" ? "pad is outside the board" : "no legal 1.25 mm escape corridor"}`,
    );
    if (routeability.courtyardOverlaps > 0) blockers.push(`${routeability.courtyardOverlaps} placement-envelope overlap(s) constrain routing channels.`);
    if (routeability.airwireCrossings > 0) blockers.push(`${routeability.airwireCrossings} unrouted connection crossing(s) indicate congestion.`);
    if (routableLayers.length < 2) blockers.push(`Only ${routableLayers.length} signal-routing layer is eligible; no alternate-layer escape is available.`);
    const relatedViolation = verification.violations.find((violation) => violation.kind !== "incompleteNet");
    if (relatedViolation) blockers.push(relatedViolation.summary);
    if (blockers.length === 0) blockers.push(`FreeRouting found no legal path after ${passes.length} bounded high-effort pass(es).`);
    const suggestedRepair = accessFailures.length > 0 || routeability.courtyardOverlaps > 0
      ? ["Preview local spreading/rotation with the 1.15 placement envelope, then retry this net."]
      : ["Inspect the highlighted airwire corridor, via landing area, keepouts, and protected copper before retrying this net."];
    if (routableLayers.length < 2) suggestedRepair.push("Enable another legal signal layer and a via padstack connecting the eligible layers.");
    return {
      netId: airwire.netId,
      netName: netName.get(airwire.netId) ?? `net${airwire.netId}`,
      from,
      to,
      location: {
        x: Math.round((airwire.from.x + airwire.to.x) / 2),
        y: Math.round((airwire.from.y + airwire.to.y) / 2),
      },
      failure: "No legal path found without regressing existing connectivity or DRC.",
      primaryBlockers: blockers,
      suggestedRepair,
    };
  });
}

export async function completeAutoroute(
  board: PcbBoard,
  rules: DrcRules,
  executor: AutoroutePassExecutor,
  options: AutorouteCompletionOptions = {},
): Promise<AutorouteCompletionResult> {
  const maxGlobalPasses = clampInteger(options.maxGlobalPasses, AUTOROUTE_COMPLETION_DEFAULTS.maxGlobalPasses, 1, 8);
  const maxSelectedNetRetries = clampInteger(options.maxSelectedNetRetries, AUTOROUTE_COMPLETION_DEFAULTS.maxSelectedNetRetries, 1, 5);
  const maxNoImprovementPasses = clampInteger(options.maxNoImprovementPasses, AUTOROUTE_COMPLETION_DEFAULTS.maxNoImprovementPasses, 1, 4);
  const baseEnginePasses = clampInteger(options.baseEnginePasses, AUTOROUTE_COMPLETION_DEFAULTS.baseEnginePasses, 10, 500);
  const selected = options.selectedNetIds ? new Set(options.selectedNetIds) : undefined;
  let candidate = board;
  let verification = verifyAutorouteCandidate(candidate, rules);
  let noImprovement = 0;
  let acceptedPasses = 0;
  let totalElapsedMs = 0;
  let engineError: string | undefined;
  let bestAcceptedAttempt: AutorouteAttemptArtifact | undefined;
  const retryCount = new Map<number, number>();
  const reports: AutoroutePassReport[] = [];
  const attempts: AutorouteAttemptArtifact[] = [];

  for (let pass = 1; pass <= maxGlobalPasses && (verification.status !== "complete" || (selected !== undefined && pass === 1)); pass++) {
    const incomplete = incompleteNetIds(verification, selected);
    const requested = selected && pass === 1 ? [...selected].sort((a, b) => a - b) : incomplete;
    if (requested.length === 0) break;
    const targets = requested.filter((netId) => (retryCount.get(netId) ?? 0) < maxSelectedNetRetries);
    if (targets.length === 0) break;
    targets.forEach((netId) => retryCount.set(netId, (retryCount.get(netId) ?? 0) + 1));
    const effort = effortForPass(pass);
    const engineMaxPasses = Math.min(500, Math.round(baseEnginePasses * (1 + (pass - 1) * 0.5)));
    const requestedSourceRevision = pcbRevisionId(candidate);
    const routeAttemptId = `${options.attemptNamespace ?? "autoroute"}-p${pass}-${stableHash(`${requestedSourceRevision}\0${targets.join(",")}\0${engineMaxPasses}`)}`;
    const output = await executor({
      board: candidate,
      routeAttemptId,
      requestedSourceRevision,
      targetNetIds: pass === 1 && !selected ? undefined : targets,
      passIndex: pass,
      engineMaxPasses,
      effort,
    });
    totalElapsedMs += output.elapsedMs;
    const actualCandidateRevision = output.candidate ? pcbRevisionId(output.candidate) : undefined;
    const boundaryErrors: string[] = [];
    if (output.ok) {
      if (output.evidence?.processStatus !== "exit-success" || output.evidence.outputFileStatus !== "nonempty") {
        boundaryErrors.push("Router process/output evidence does not prove a successful exit with a nonempty SES file.");
      }
      if (output.evidence?.parserStatus !== "success" || output.evidence.semanticStatus !== "success") {
        boundaryErrors.push("Router result lacks successful SES parse and semantic-validation evidence.");
      }
      if (output.routeAttemptId !== routeAttemptId) {
        boundaryErrors.push(`Router result pass identity mismatch (expected ${routeAttemptId}, received ${output.routeAttemptId ?? "missing"}).`);
      }
      if (output.authoritativeSourceRevision !== requestedSourceRevision) {
        boundaryErrors.push(`Router result authoritative source revision mismatch (expected ${requestedSourceRevision}, received ${output.authoritativeSourceRevision ?? "missing"}).`);
      }
      if (!output.candidate || output.candidateRevision !== actualCandidateRevision) {
        boundaryErrors.push(`Router result candidate revision is missing or does not describe the returned candidate.`);
      }
      if (output.parsed && (!output.parsed.wasSuccessful || output.parsed.routeAttemptId !== routeAttemptId || output.parsed.sourceRevision !== output.sourceRevision)) {
        boundaryErrors.push("SES parser evidence is unsuccessful or belongs to a different pass/source revision.");
      }
    }
    const attempt: AutorouteAttemptArtifact = {
      routeAttemptId,
      ...(output.routeAttemptId !== undefined ? { reportedRouteAttemptId: output.routeAttemptId } : {}),
      pass,
      sourceRevision: requestedSourceRevision,
      ...(output.sourceRevision !== undefined ? { reportedSourceRevision: output.sourceRevision } : {}),
      ...(actualCandidateRevision !== undefined ? { candidateRevision: actualCandidateRevision } : {}),
      phase: output.phase ?? (output.ok && output.candidate ? "candidate" : "process"),
      accepted: false,
      ...(output.dsnText !== undefined ? { dsnText: output.dsnText } : {}),
      ...(output.sesText !== undefined ? { sesText: output.sesText } : {}),
      ...(output.stderr !== undefined ? { stderr: output.stderr } : {}),
      ...(output.validation !== undefined ? { validation: output.validation } : {}),
      ...(output.parsed !== undefined ? { parsed: output.parsed } : {}),
      ...(output.error !== undefined || boundaryErrors.length > 0 ? { error: output.error ?? boundaryErrors.join(" ") } : {}),
      elapsedMs: output.elapsedMs,
      targetNetIds: [...targets],
      effort,
      engineMaxPasses,
      evidence: { ...(output.evidence ?? {}) },
      connectivityBefore: { completed: verification.completedConnections, remaining: verification.remainingConnections },
      drcBefore: { errors: verification.drcErrors, routeBlockingErrors: verification.routeBlockingDrcErrors },
      decision: "failed",
      rejectionReasons: [...boundaryErrors],
      returnedCandidate: false,
    };
    attempts.push(attempt);
    if (!output.ok || !output.candidate || boundaryErrors.length > 0) {
      engineError = boundaryErrors[0] ?? output.error ?? "Autorouter pass failed.";
      reports.push({
        pass,
        routeAttemptId: attempt.routeAttemptId,
        sourceRevision: attempt.sourceRevision,
        candidateRevision: attempt.candidateRevision,
        phase: attempt.phase,
        scope: pass === 1 && !selected ? "all_incomplete" : "selected_incomplete",
        targetNetIds: targets,
        effort,
        engineMaxPasses,
        accepted: false,
        reason: engineError,
        completedBefore: verification.completedConnections,
        completedAfter: verification.completedConnections,
        remainingBefore: verification.remainingConnections,
        remainingAfter: verification.remainingConnections,
        lostPreviouslyCompleteNetIds: [],
        lostPreviouslyCompleteStableNetIds: [],
        lostAssignedEndpointKeys: [],
        newShorts: 0,
        newShortIds: [],
        newUnresolvedFacts: [],
        newDrcErrors: 0,
        elapsedMs: output.elapsedMs,
      });
      break;
    }

    const nextVerification = verifyAutorouteCandidate(output.candidate, rules, output.layerUsage);
    const beforeComplete = completedNetIds(verification);
    const afterComplete = completedNetIds(nextVerification);
    const lostPreviouslyCompleteNetIds = [...beforeComplete].filter((netId) => !afterComplete.has(netId)).sort((a, b) => a - b);
    const beforeCompleteStable = completedStableNetIds(verification);
    const afterCompleteStable = completedStableNetIds(nextVerification);
    const lostPreviouslyCompleteStableNetIds = [...beforeCompleteStable].filter((stableId) => !afterCompleteStable.has(stableId)).sort();
    const beforeEndpoints = new Set(verification.perNet.flatMap((net) => net.endpointKeys));
    const afterEndpoints = new Set(nextVerification.perNet.flatMap((net) => net.endpointKeys));
    const lostAssignedEndpointKeys = [...beforeEndpoints].filter((endpoint) => !afterEndpoints.has(endpoint)).sort();
    const priorShorts = new Set(verification.shortIds);
    const newShortIds = nextVerification.shortIds.filter((id) => !priorShorts.has(id)).sort();
    const newShorts = newShortIds.length;
    const priorUnresolved = new Set(verification.unresolvedFacts);
    const newUnresolvedFacts = nextVerification.unresolvedFacts.filter((fact) => !priorUnresolved.has(fact)).sort();
    const previousViolationIds = new Set(verification.violations.map((violation) => violation.id));
    const newDrcErrors = nextVerification.violations.filter((violation) =>
      violation.severity === "error" &&
      violation.kind !== "incompleteNet" &&
      violation.kind !== "unconnected" &&
      !previousViolationIds.has(violation.id),
    ).length;
    const improvesConnectivity = nextVerification.completedConnections > verification.completedConnections;
    const improvesDrc = nextVerification.completedConnections >= verification.completedConnections &&
      nextVerification.drcErrors < verification.drcErrors;
    const noRegression = lostPreviouslyCompleteStableNetIds.length === 0 && lostAssignedEndpointKeys.length === 0 &&
      newUnresolvedFacts.length === 0 && newShorts === 0 && newDrcErrors === 0 &&
      nextVerification.routeBlockingDrcErrors <= verification.routeBlockingDrcErrors;
    const accepted = (improvesConnectivity || improvesDrc) && noRegression;
    const reason = accepted
      ? improvesConnectivity
        ? `Completed ${nextVerification.completedConnections - verification.completedConnections} additional connection(s).`
        : `Reduced DRC errors from ${verification.drcErrors} to ${nextVerification.drcErrors} without losing connectivity.`
      : !improvesConnectivity
        ? "No additional schematic connection was completed."
        : lostPreviouslyCompleteStableNetIds.length > 0
          ? `Would disconnect previously complete stable net(s): ${lostPreviouslyCompleteStableNetIds.join(", ")}.`
          : lostAssignedEndpointKeys.length > 0
            ? `Would lose assigned schematic endpoint(s): ${lostAssignedEndpointKeys.join(", ")}.`
            : newUnresolvedFacts.length > 0
              ? `Would introduce unresolved electrical fact(s): ${newUnresolvedFacts.join(", ")}.`
          : newShorts > 0
            ? `Would introduce ${newShorts} new short circuit(s).`
            : newDrcErrors > 0
              ? `Would introduce ${newDrcErrors} new DRC error(s).`
             : "Would increase route-blocking DRC errors.";
    attempt.connectivityAfter = { completed: nextVerification.completedConnections, remaining: nextVerification.remainingConnections };
    attempt.drcAfter = { errors: nextVerification.drcErrors, routeBlockingErrors: nextVerification.routeBlockingDrcErrors };
    attempt.decision = accepted ? "accepted" : "rejected";
    attempt.rejectionReasons = accepted ? [] : [reason];
    reports.push({
      pass,
      routeAttemptId: attempt.routeAttemptId,
      sourceRevision: attempt.sourceRevision,
      candidateRevision: attempt.candidateRevision,
      phase: "acceptance",
      scope: pass === 1 && !selected ? "all_incomplete" : "selected_incomplete",
      targetNetIds: targets,
      effort,
      engineMaxPasses,
      accepted,
      reason,
      completedBefore: verification.completedConnections,
      completedAfter: nextVerification.completedConnections,
      remainingBefore: verification.remainingConnections,
      remainingAfter: nextVerification.remainingConnections,
      lostPreviouslyCompleteNetIds,
      lostPreviouslyCompleteStableNetIds,
      lostAssignedEndpointKeys,
      newShorts,
      newShortIds,
      newUnresolvedFacts,
      newDrcErrors,
      elapsedMs: output.elapsedMs,
    });
    if (accepted) {
      attempt.accepted = true;
      attempt.phase = "acceptance";
      bestAcceptedAttempt = attempt;
      candidate = output.candidate;
      verification = nextVerification;
      acceptedPasses += 1;
      noImprovement = 0;
    } else {
      noImprovement += 1;
      if (noImprovement >= maxNoImprovementPasses) break;
    }
  }

  const routeability = analyzePlacementRouteability(candidate, { envelopeScale: candidate.placementPreferences?.envelopeScale ?? 1.15 });
  if (bestAcceptedAttempt) bestAcceptedAttempt.returnedCandidate = true;
  const failures = verification.status === "complete" ? [] : connectionFailures(candidate, verification, routeability, reports);
  const lastAttempt = attempts.at(-1);
  return {
    status: verification.status === "complete" ? "complete" : "blocked",
    candidate,
    verification,
    routeability,
    passes: reports,
    failures,
    totalElapsedMs,
    acceptedPasses,
    attempts,
    lastAttempt,
    bestAcceptedAttempt,
    lastSesText: lastAttempt?.sesText,
    lastDsnText: lastAttempt?.dsnText,
    lastStderr: lastAttempt?.stderr,
    lastValidation: lastAttempt?.validation,
    lastParsed: lastAttempt?.parsed,
    engineError,
  };
}
