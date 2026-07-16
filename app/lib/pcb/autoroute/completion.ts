import type { PcbBoard } from "../types";
import type { DrcRules } from "../drc/types";
import type { DsnValidationReport } from "../dsn/preflight";
import type { SesLayerUsage, SesResult } from "../dsn/read-ses";
import type { LayerId } from "../layers";
import { verifyAutorouteCandidate, type AutorouteVerification } from "./verification";
import { analyzePlacementRouteability, type PlacementRouteabilityReport } from "../autoplace/routeability";
import { padWorldPosition } from "../geometry-copper";
import { routableCopperLayers } from "../stackup";

export const AUTOROUTE_COMPLETION_DEFAULTS = {
  maxGlobalPasses: 5,
  maxSelectedNetRetries: 3,
  maxNoImprovementPasses: 2,
  baseEnginePasses: 100,
} as const;

export interface AutoroutePassRequest {
  board: PcbBoard;
  targetNetIds?: number[];
  passIndex: number;
  engineMaxPasses: number;
  effort: "high" | "higher" | "maximum";
}

export interface AutoroutePassOutput {
  ok: boolean;
  candidate?: PcbBoard;
  sesText?: string;
  dsnText?: string;
  stderr?: string;
  elapsedMs: number;
  layerUsage?: Partial<Record<LayerId, SesLayerUsage>>;
  validation?: DsnValidationReport;
  parsed?: SesResult;
  error?: string;
}

export type AutoroutePassExecutor = (request: AutoroutePassRequest) => Promise<AutoroutePassOutput>;

export interface AutorouteCompletionOptions {
  maxGlobalPasses?: number;
  maxSelectedNetRetries?: number;
  maxNoImprovementPasses?: number;
  baseEnginePasses?: number;
  selectedNetIds?: number[];
}

export interface AutoroutePassReport {
  pass: number;
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
  newShorts: number;
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
  let lastSesText: string | undefined;
  let lastDsnText: string | undefined;
  let lastStderr: string | undefined;
  let lastValidation: DsnValidationReport | undefined;
  let lastParsed: SesResult | undefined;
  const retryCount = new Map<number, number>();
  const reports: AutoroutePassReport[] = [];

  for (let pass = 1; pass <= maxGlobalPasses && (verification.status !== "complete" || (selected !== undefined && pass === 1)); pass++) {
    const incomplete = incompleteNetIds(verification, selected);
    const requested = selected && pass === 1 ? [...selected].sort((a, b) => a - b) : incomplete;
    if (requested.length === 0) break;
    const targets = requested.filter((netId) => (retryCount.get(netId) ?? 0) < maxSelectedNetRetries);
    if (targets.length === 0) break;
    targets.forEach((netId) => retryCount.set(netId, (retryCount.get(netId) ?? 0) + 1));
    const effort = effortForPass(pass);
    const engineMaxPasses = Math.min(500, Math.round(baseEnginePasses * (1 + (pass - 1) * 0.5)));
    const output = await executor({
      board: candidate,
      targetNetIds: pass === 1 && !selected ? undefined : targets,
      passIndex: pass,
      engineMaxPasses,
      effort,
    });
    totalElapsedMs += output.elapsedMs;
    lastSesText = output.sesText ?? lastSesText;
    lastDsnText = output.dsnText ?? lastDsnText;
    lastStderr = output.stderr ?? lastStderr;
    lastValidation = output.validation ?? lastValidation;
    lastParsed = output.parsed ?? lastParsed;
    if (!output.ok || !output.candidate) {
      engineError = output.error ?? "Autorouter pass failed.";
      reports.push({
        pass,
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
        newShorts: 0,
        newDrcErrors: 0,
        elapsedMs: output.elapsedMs,
      });
      break;
    }

    const nextVerification = verifyAutorouteCandidate(output.candidate, rules, output.layerUsage);
    const beforeComplete = completedNetIds(verification);
    const afterComplete = completedNetIds(nextVerification);
    const lostPreviouslyCompleteNetIds = [...beforeComplete].filter((netId) => !afterComplete.has(netId)).sort((a, b) => a - b);
    const newShorts = Math.max(0, nextVerification.shorts - verification.shorts);
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
    const noRegression = lostPreviouslyCompleteNetIds.length === 0 && newShorts === 0 && newDrcErrors === 0 &&
      nextVerification.routeBlockingDrcErrors <= verification.routeBlockingDrcErrors;
    const accepted = (improvesConnectivity || improvesDrc) && noRegression;
    const reason = accepted
      ? improvesConnectivity
        ? `Completed ${nextVerification.completedConnections - verification.completedConnections} additional connection(s).`
        : `Reduced DRC errors from ${verification.drcErrors} to ${nextVerification.drcErrors} without losing connectivity.`
      : !improvesConnectivity
        ? "No additional schematic connection was completed."
        : lostPreviouslyCompleteNetIds.length > 0
          ? `Would disconnect previously complete net(s): ${lostPreviouslyCompleteNetIds.join(", ")}.`
          : newShorts > 0
            ? `Would introduce ${newShorts} new short circuit(s).`
            : newDrcErrors > 0
              ? `Would introduce ${newDrcErrors} new DRC error(s).`
            : "Would increase route-blocking DRC errors.";
    reports.push({
      pass,
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
      newShorts,
      newDrcErrors,
      elapsedMs: output.elapsedMs,
    });
    if (accepted) {
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
  const failures = verification.status === "complete" ? [] : connectionFailures(candidate, verification, routeability, reports);
  return {
    status: verification.status === "complete" ? "complete" : "blocked",
    candidate,
    verification,
    routeability,
    passes: reports,
    failures,
    totalElapsedMs,
    acceptedPasses,
    lastSesText,
    lastDsnText,
    lastStderr,
    lastValidation,
    lastParsed,
    engineError,
  };
}
