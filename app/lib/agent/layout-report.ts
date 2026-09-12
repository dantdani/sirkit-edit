/**
 * [B18-E E17] What a layout candidate is allowed to SAY — to the model, and to the person who asked.
 *
 * Scenario 5 is "Place the board compactly, keep decoupling close to U1, route it, and show me anything that failed."
 * The candidate the tools produce is the richest artifact in the system: every placement objective carries its own state
 * (evaluated / unknown / unsupported / not applicable) with a measured value and its limitations, and every unresolved
 * routing connection carries its net, why it failed, what blocked it and what to try. None of it reached anyone. The
 * model was handed five fields and a COUNT — "unresolved: 7" — and the person was told only that a candidate was ready,
 * so the last clause of the sentence went unanswered by everything except the editor panel.
 *
 * These are the bounded projections that close that, and the two honesty rules they carry:
 *
 *  - the tools take no compactness, spacing or objective-weight argument (OD-24: the agent's surface is not widened), so
 *    the note says so — a run may not imply it made the board compact or prioritized decoupling;
 *  - an objective the engine could not evaluate is reported as unknown, never as a pass. "We don't know" is a result.
 */
import type { LayoutCandidate, PlacementLayoutCandidate, RoutingLayoutCandidate } from "../pcb/candidates/layout-candidate";

/** Bounds: enough to answer "what failed", never enough to blow the model's result budget. Counts are always exact. */
export const MAX_REPORTED_FAILURES = 8;
export const MAX_REPORTED_BLOCKERS = 2;
export const MAX_REPORTED_OBJECTIVES = 12;
const MAX_TEXT = 240;

const text = (value: unknown): string => (typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "");

export interface ObjectiveFact {
  kind: string;
  state: "evaluated" | "unknown" | "unsupported" | "not_applicable";
  value: number | null;
  unit: string;
  /** Only for an evaluated objective: what the number means and what it does NOT prove. */
  limitations?: string[];
}

export interface PlacementReport {
  legal: boolean;
  hardViolations: number;
  objectives: ObjectiveFact[];
  objectiveCount: number;
  /** The objectives the engine could not evaluate — stated, because silence reads as success. */
  unknownObjectives: string[];
  unsupportedObjectives: string[];
}

export interface RoutingFailureFact {
  netId: number;
  netName: string;
  failure: string;
  blockers: string[];
  suggestedRepair: string[];
}

export interface RoutingReport {
  completion: "complete" | "partial";
  tracks: number;
  vias: number;
  unresolved: number;
  /** The first few unresolved connections IN FULL — which net, why, what blocked it, what to try. */
  failures: RoutingFailureFact[];
  failuresReported: number;
}

/** What the placement candidate actually measured — including the objectives it could not measure. */
export function placementReport(candidate: PlacementLayoutCandidate): PlacementReport {
  const report = candidate.candidate.objectiveReport;
  const objectives = (report?.objectives ?? []).slice(0, MAX_REPORTED_OBJECTIVES).map((objective): ObjectiveFact => ({
    kind: objective.kind,
    state: objective.state,
    value: typeof objective.rawValue === "number" ? objective.rawValue : null,
    unit: text(objective.rawUnit),
    ...(objective.state === "evaluated" && objective.limitations.length > 0 ? { limitations: objective.limitations.slice(0, 2).map(text) } : {}),
  }));
  return {
    legal: candidate.legal,
    hardViolations: candidate.candidate.hardReport?.violations.length ?? 0,
    objectives,
    objectiveCount: report?.objectives.length ?? 0,
    unknownObjectives: [...(report?.unknownObjectiveIds ?? [])].slice(0, MAX_REPORTED_OBJECTIVES).map(text),
    unsupportedObjectives: [...(report?.unsupportedObjectiveIds ?? [])].slice(0, MAX_REPORTED_OBJECTIVES).map(text),
  };
}

/** What the routing candidate failed to do, in the router's own words. */
export function routingReport(candidate: RoutingLayoutCandidate): RoutingReport {
  const failures = candidate.completion.failures ?? [];
  return {
    completion: candidate.completion.status,
    tracks: candidate.stats.tracks,
    vias: candidate.stats.vias,
    unresolved: failures.length,
    failures: failures.slice(0, MAX_REPORTED_FAILURES).map((failure): RoutingFailureFact => ({
      netId: failure.netId,
      netName: text(failure.netName),
      failure: text(failure.failure),
      blockers: (failure.primaryBlockers ?? []).slice(0, MAX_REPORTED_BLOCKERS).map(text),
      suggestedRepair: (failure.suggestedRepair ?? []).slice(0, MAX_REPORTED_BLOCKERS).map(text),
    })),
    failuresReported: Math.min(failures.length, MAX_REPORTED_FAILURES),
  };
}

/**
 * [OD-24] The tools take no compactness, spacing or objective-weight argument, and nothing in a run can change one. The
 * model is told so in the same breath as the result, so a candidate can never be reported as having been made "compact"
 * or as having prioritized decoupling: what was optimized is the board's own settings and the objective report below.
 */
export const LAYOUT_CANDIDATE_NOTE =
  "The candidate is awaiting the user's explicit review in the PCB editor's placement/routing panel — NOTHING on the board has changed. "
  + "Tell the user to preview and apply or discard it; never claim it was applied, and never call it manufacturing-ready. "
  + "This tool takes no compactness, spacing or objective-weight argument: the layout was produced with the board's own settings, so never say it was made compact, denser, or that any objective was prioritized. "
  + "Report an objective the engine could not evaluate as unknown — never as met — and when the user asks what failed, name the unresolved connections below rather than only their count.";

/** The page's own sentence for a candidate: what it is, and — when something failed — what. */
export function layoutCandidateChatLine(candidate: LayoutCandidate): string {
  const opening = `${candidate.kind === "placement" ? "Placement" : "Routing"} candidate ready — review it in the PCB editor's ${candidate.kind} panel; the board is unchanged until you apply it.`;
  if (candidate.kind === "placement") {
    const report = placementReport(candidate);
    const unknown = report.unknownObjectives.length + report.unsupportedObjectives.length;
    const legality = report.legal ? "It is hard-legal" : `It is NOT hard-legal (${report.hardViolations} violation${report.hardViolations === 1 ? "" : "s"})`;
    return `${opening} ${legality}; ${report.objectiveCount - unknown} of ${report.objectiveCount} objectives were evaluated${unknown > 0 ? `, ${unknown} could not be` : ""}.`;
  }
  const report = routingReport(candidate);
  if (report.unresolved === 0) return `${opening} Every connection in scope was routed (${report.tracks} track${report.tracks === 1 ? "" : "s"}, ${report.vias} via${report.vias === 1 ? "" : "s"}).`;
  const named = report.failures.map((failure) => failure.netName || `net ${failure.netId}`).join(", ");
  return `${opening} ${report.unresolved} connection${report.unresolved === 1 ? "" : "s"} could NOT be routed${named ? ` (${named}${report.unresolved > report.failuresReported ? ", …" : ""})` : ""} — the panel lists why and what to try.`;
}
