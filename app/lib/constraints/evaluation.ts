import type {
  ConstraintEvaluationReport,
  ConstraintEvaluationState,
  ConstraintProgram,
  ConstraintViolation,
  ConstraintWaiver,
} from "./types";
import { constraintSemanticHash, deepFreezeConstraint } from "./stable";

const STATE_RANK: Record<ConstraintEvaluationState, number> = {
  fail: 0,
  stale: 1,
  unknown: 2,
  unsupported: 3,
  not_run: 4,
  pass: 5,
  not_applicable: 6,
};

function validWaiver(waiver: ConstraintWaiver, program: ConstraintProgram, designRevision: string): boolean {
  return waiver.programHash === program.programHash && waiver.designRevision === designRevision && waiver.reason.trim().length >= 8 && waiver.actorId.length > 0 && waiver.authorizedBy.length > 0;
}

export function evaluateConstraintProgram(input: {
  program: ConstraintProgram;
  designRevision: string;
  results: ConstraintViolation[];
  waivers?: ConstraintWaiver[];
}): ConstraintEvaluationReport {
  const stale = input.designRevision !== input.program.designRevision;
  const resultsByConstraint = new Map<string, ConstraintViolation[]>();
  for (const result of input.results) resultsByConstraint.set(result.constraintId, [...(resultsByConstraint.get(result.constraintId) ?? []), result]);
  const states = input.program.coverage.map((coverage) => {
    const results = (resultsByConstraint.get(coverage.constraintId) ?? []).sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.id.localeCompare(b.id));
    const state: ConstraintEvaluationState = stale
      ? "stale"
      : results[0]?.state ?? (coverage.support === "not_applicable" ? "not_applicable" : coverage.support === "unsupported" || coverage.support === "declarative_only" ? "unsupported" : coverage.support === "unknown" ? "unknown" : "not_run");
    return { constraintId: coverage.constraintId, targetIds: coverage.targetIds, state, consumerId: coverage.consumerId, violationIds: results.filter((item) => item.state === "fail").map((item) => item.id).sort() };
  }).sort((a, b) => a.constraintId.localeCompare(b.constraintId) || a.consumerId.localeCompare(b.consumerId));
  const waivers = [...(input.waivers ?? [])].filter((waiver) => validWaiver(waiver, input.program, input.designRevision)).sort((a, b) => a.id.localeCompare(b.id));
  const requiredIds = new Set(input.program.coverage.filter((item) => item.readinessImpact !== "advisory" && item.readinessImpact !== "none").map((item) => item.constraintId));
  const requiredStates = states.filter((item) => requiredIds.has(item.constraintId));
  const readinessState: ConstraintEvaluationReport["readinessState"] = stale
    ? "stale"
    : requiredStates.some((item) => item.state === "fail")
      ? "blocked"
      : requiredStates.some((item) => ["unknown", "unsupported", "not_run"].includes(item.state))
        ? "verification_incomplete"
        : "satisfied";
  const semantic = {
    schemaVersion: 1 as const,
    programHash: input.program.programHash,
    designRevision: input.designRevision,
    states,
    violations: [...input.results].sort((a, b) => a.id.localeCompare(b.id)),
    waivers,
    readinessState,
  };
  const report: ConstraintEvaluationReport = { ...semantic, evaluationHash: constraintSemanticHash(semantic) };
  return deepFreezeConstraint(report) as ConstraintEvaluationReport;
}

