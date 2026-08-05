import { finalizeSimulation, simulationDigest, simulationId, unique } from "./stable";
import type { ConvergenceState, ProcessState, SimulationAttempt, SimulationConvergenceDiagnostic } from "./types";

const CLASSIFIERS: Array<{ pattern: RegExp; state: ConvergenceState; code: string }> = [
  { pattern: /timestep too small|time step.*too small/i, state: "timestep_failure", code: "TIMESTEP_FAILURE" },
  { pattern: /singular matrix|singular topology/i, state: "singular_topology", code: "SINGULAR_TOPOLOGY" },
  { pattern: /dc.*(failed|not converg)|no convergence in dc/i, state: "dc_nonconverged", code: "DC_NONCONVERGENCE" },
  { pattern: /transient.*(failed|not converg)|no convergence in transient/i, state: "transient_nonconverged", code: "TRANSIENT_NONCONVERGENCE" },
  { pattern: /unknown model|model.*not found|model error/i, state: "model_error", code: "MODEL_ERROR" },
  { pattern: /unsupported|unimplemented/i, state: "unsupported_feature", code: "UNSUPPORTED_FEATURE" },
];
const WARNING = /warning|iteration limit|gmin stepping|source stepping/i;
function redact(value: string): string { return value.replace(/(?:sk|api)[-_][A-Za-z0-9_-]{12,}/gi, "[REDACTED]").replace(/[A-Za-z]:\\[^\s]+/g, "[PATH]"); }

export function classifyConvergence(input: { runId: string; processState: ProcessState; stdout: string; stderr: string; solverMethods?: string[]; tolerances?: Array<{ name: string; value: string }>; rejectedCounts?: Array<{ kind: string; count: number }>; aids?: SimulationConvergenceDiagnostic["convergenceAidRecords"]; retryRelationshipRefs?: string[] }): SimulationConvergenceDiagnostic {
  const combined = redact(`${input.stdout}\n${input.stderr}`); const match = CLASSIFIERS.find((item) => item.pattern.test(combined));
  const convergenceState: ConvergenceState = match?.state ?? (input.processState === "exited_zero" ? WARNING.test(combined) ? "converged_with_warnings" : "credible_converged" : input.processState === "queued" || input.processState === "started" ? "not_run" : "unknown");
  const aids = input.aids ?? []; const credibilityImpact = convergenceState === "credible_converged" && aids.every((item) => item.signoffImpact === "none") ? "credible" as const : convergenceState === "converged_with_warnings" || aids.some((item) => item.signoffImpact === "requires_study") ? "limited" as const : convergenceState === "not_run" ? "diagnostic_only" as const : "invalid" as const;
  const classifications = [...(match ? [{ code: match.code, severity: "error" as const, excerptDigest: simulationDigest(combined.slice(0, 512)) }] : []), ...(WARNING.test(combined) ? [{ code: "SIMULATOR_WARNING_PRESENT", severity: "warning" as const, excerptDigest: simulationDigest(combined.slice(0, 512)) }] : [])];
  const body = { runId: input.runId, convergenceState, solverMethodAndIntegrationMethod: unique(input.solverMethods ?? []), tolerancesAndStepControls: input.tolerances ?? [], residualAndErrorSummaries: match ? [match.code] : [], rejectedStepAndIterationCounts: input.rejectedCounts ?? [], convergenceAidRecords: aids, warningAndLogClassifications: classifications, skippedOrInvalidPointIds: [], retryRelationshipRefs: unique(input.retryRelationshipRefs ?? []), credibilityImpact };
  return finalizeSimulation<SimulationConvergenceDiagnostic>({ ...body, diagnosticId: simulationId("convergence", body), deterministicDigest: "" });
}

export const BOUNDED_CONVERGENCE_RETRY_LADDER = [
  { retryIndex: 0, changes: [] as string[], signoffEligibility: "eligible" as const },
  { retryIndex: 1, changes: ["reduce_max_step", "increase_iteration_budget_within_policy"], signoffEligibility: "eligible" as const },
  { retryIndex: 2, changes: ["alternate_approved_integration_method"], signoffEligibility: "eligible" as const },
  { retryIndex: 3, changes: ["disclosed_gmin_or_source_stepping_study"], signoffEligibility: "diagnostic_only" as const },
] as const;

export function createSimulationAttempt(input: Omit<SimulationAttempt, "attemptId" | "deterministicDigest">): SimulationAttempt { if (input.attemptIndex < 0 || input.attemptIndex >= BOUNDED_CONVERGENCE_RETRY_LADDER.length) throw new Error("CD10_RETRY_POLICY_EXHAUSTED"); const policy = BOUNDED_CONVERGENCE_RETRY_LADDER[input.attemptIndex]; if (input.signoffEligibility !== policy.signoffEligibility || input.deltaFromPrior.some((delta) => /model|terminal|topology/i.test(delta))) throw new Error("CD10_RETRY_SEMANTIC_MUTATION_FORBIDDEN"); return finalizeSimulation<SimulationAttempt>({ ...structuredClone(input), attemptId: simulationId("simulation-attempt", input), deterministicDigest: "" }); }
