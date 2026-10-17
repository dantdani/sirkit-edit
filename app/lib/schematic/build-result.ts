/**
 * [PR-C] The structured result contract of Build-mode generation (`POST /api/schematic/build-multi`, and the single build
 * loop it delegates to). An HTTP 200 and an explanation string never mean the requested circuit is complete or
 * electrically valid: completeness, the omitted subsystem blocks, the electrical check's state and the budget spent are
 * reported here as data, and the page renders them beside the proposal the human reviews.
 *
 * Browser-safe (types and pure helpers only): the page and the route import it.
 */
import type { BuildLogicalNetlist } from "@/lib/schematic-types";

/** Whether every requested subsystem block reached the merged result. */
export type BuildCompleteness = "complete" | "partial";

/** The post-merge (or single-loop) electrical check, as data. `not_run` and `skipped` are never a pass. */
export type ElectricalCheckStatus =
  | { state: "passed"; criticalCount: 0; warningCount: number }
  | { state: "findings"; criticalCount: number; warningCount: number; findings: string[] }
  | { state: "skipped"; reason: string }
  | { state: "not_run"; reason: string };

/** How the request was planned. A planner failure is visible, never a silent fallback. */
export type BuildPlannerStatus =
  | { state: "planned"; blocks: number }
  | { state: "single"; reason: "simple_request" | "no_plan" }
  | { state: "failed_fallback"; reason: string };

/** The bounds the server applied and what the run used of them. */
export interface BuildBudgetReport {
  iterationCap: number;
  iterationsUsed: number;
  deadlineMs: number;
  elapsedMs: number;
  concurrencyCap: number;
}

export interface BuildMultiSuccess {
  ok: true;
  netlist: BuildLogicalNetlist;
  explanation: string;
  status: BuildCompleteness;
  /** Names of the planned blocks that failed and are absent from `netlist` (empty when `status` is "complete"). */
  omittedBlocks: string[];
  electricalCheck: ElectricalCheckStatus;
  planner: BuildPlannerStatus;
  budget: BuildBudgetReport;
}

/** Failure classes the page distinguishes. `provider_unavailable` keeps the provider vocabulary (`reason`) so the shared
 *  card withholds Retry for `insufficient_quota` and `breaker_open`; the others are local and say whether a retry can help. */
export type BuildFailureCode = "provider_unavailable" | "build_budget_exhausted" | "build_cancelled" | "build_loop_failed" | "build_invalid_output";

export interface BuildMultiFailure {
  ok: false;
  code: BuildFailureCode | string;
  error: string;
  provider?: string;
  reason?: string;
  retryable?: boolean;
  /** Bounded diagnostics, never raw provider payloads or catalog credentials. */
  stage?: "planning" | "design";
  blockFailures?: Array<{ block: string; code: string; error: string; retryable: boolean; iterationsUsed: number }>;
  budget?: BuildBudgetReport;
}

export type BuildMultiResponse = BuildMultiSuccess | BuildMultiFailure;

/** The bounds the route applies (a request's worst case is derivable from these: iterations × the per-turn output ceiling). */
export const BUILD_BUDGET = Object.freeze({
  /** per build loop; the historical cap */
  iterationCap: 20,
  /** parallel subsystem loops at once */
  concurrencyCap: 3,
  /** Finite generation wall clock. The route's 45 s limit bounds BODY READING,
   * not model execution; 40 s starved normal planner/search/submit workflows. */
  deadlineMs: 180_000,
});

/** [PR-C] An operator may lower the per-loop iteration cap for a deployment or a qualification run (never raise it above
 *  `BUILD_BUDGET.iterationCap`): a provable worst case for a bounded live test is `cap × the per-turn output ceiling`. */
export const BUILD_ITERATION_CAP_ENV = "SIRKIT_BUILD_ITERATION_CAP" as const;

/** The effective iteration cap: the environment's integer clamped to 1..BUILD_BUDGET.iterationCap, else the default. */
export function resolveBuildIterationCap(environment: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env): number {
  const raw = environment[BUILD_ITERATION_CAP_ENV]?.trim();
  if (!raw || !/^\d{1,3}$/.test(raw)) return BUILD_BUDGET.iterationCap;
  return Math.min(BUILD_BUDGET.iterationCap, Math.max(1, Number(raw)));
}

/** Bounded, human-readable findings for the proposal dialog and the activity log. */
export function electricalCheckNote(check: ElectricalCheckStatus): string | null {
  switch (check.state) {
    case "passed": return null;
    case "findings": return `Electrical check: ${check.criticalCount} critical finding(s)${check.warningCount ? `, ${check.warningCount} warning(s)` : ""} — ${check.findings.slice(0, 3).join("  |  ")}${check.findings.length > 3 ? " …" : ""}`;
    case "skipped": return `Electrical check skipped: ${check.reason}. Not checked is not a pass.`;
    case "not_run": return `Electrical check not run: ${check.reason}. Not checked is not a pass.`;
  }
}

/** The one-line completeness note shown with a partial result. */
export function completenessNote(result: Pick<BuildMultiSuccess, "status" | "omittedBlocks">): string | null {
  if (result.status === "complete") return null;
  return `Partial result: ${result.omittedBlocks.length} subsystem block(s) failed and are missing — ${result.omittedBlocks.join(", ")}.`;
}
