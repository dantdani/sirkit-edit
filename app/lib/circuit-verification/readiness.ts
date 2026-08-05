import { evaluateVerificationCurrency } from "./coverage";
import { validateRequiredRuleDenominator } from "./contexts";
import { validateRuleRegistry } from "./registry";
import { finalizeVerification, uniqueSorted, verificationId } from "./stable";
import { activeCircuitWaivers } from "./waiver";
import type { CircuitReadinessReport, CircuitVerificationProblem, CircuitVerificationCapabilityProfile, CircuitWaiver, FullOracleRun, OracleParityReport, RequiredRuleDenominator, RequirementCoverageRecord, RuleRegistrySnapshot } from "./types";

export function evaluateCircuitReadiness(input: {
  problem: CircuitVerificationProblem;
  graphDigest: string;
  registry: RuleRegistrySnapshot;
  capabilityProfile: CircuitVerificationCapabilityProfile;
  denominator: RequiredRuleDenominator;
  fullRun?: FullOracleRun;
  parity?: OracleParityReport;
  waivers?: CircuitWaiver[];
  requirementCoverage?: RequirementCoverageRecord[];
  now: string;
}): CircuitReadinessReport {
  const currency = evaluateVerificationCurrency({ problem: input.problem, graphDigest: input.graphDigest, registryDigest: input.registry.deterministicDigest, denominatorDigest: input.denominator.deterministicDigest, fullRun: input.fullRun });
  const denominatorErrors = validateRequiredRuleDenominator({ denominator: input.denominator, problem: input.problem, registry: input.registry, capabilityProfile: input.capabilityProfile });
  const registryErrors = validateRuleRegistry(input.registry);
  const expectedInstanceIds = input.denominator.instances.map((item) => item.instanceId).sort();
  const actualInstanceIds = input.fullRun?.results.map((item) => item.ruleInstanceId).sort() ?? [];
  const fullRunIntegrityErrors = input.fullRun ? [
    ...(input.fullRun.deterministicDigest !== finalizeVerification(input.fullRun).deterministicDigest ? ["FULL_ORACLE_DIGEST_INVALID"] : []),
    ...(input.fullRun.problemDigest !== input.problem.deterministicDigest ? ["FULL_ORACLE_PROBLEM_PIN_MISMATCH"] : []),
    ...(input.fullRun.denominatorDigest !== input.denominator.deterministicDigest ? ["FULL_ORACLE_DENOMINATOR_PIN_MISMATCH"] : []),
    ...(expectedInstanceIds.join("\0") !== actualInstanceIds.join("\0") ? ["FULL_ORACLE_INSTANCE_SET_INCOMPLETE"] : []),
  ] : [];
  const requirements = [...(input.requirementCoverage ?? [])].sort((a, b) => a.requirementId.localeCompare(b.requirementId));
  const coverageGapCodes = uniqueSorted([
    ...input.denominator.categoryCoverage.filter((item) => item.state !== "covered").map((item) => `CATEGORY_${item.category}_${item.state}`.toUpperCase()),
    ...input.denominator.variantCoverage.filter((item) => item.state !== "covered").map((item) => `VARIANT_${item.variantId}_MISSING`),
    ...input.denominator.diagnostics.map((item) => item.code),
    ...denominatorErrors,
    ...registryErrors,
    ...fullRunIntegrityErrors,
    ...(!input.denominator.nonVacuous ? ["DENOMINATOR_VACUOUS"] : []),
    ...(input.registry.lifecycleState !== "approved" ? ["RULE_REGISTRY_NOT_APPROVED"] : []),
    ...(!input.fullRun ? ["FULL_ORACLE_NOT_RUN"] : []),
    ...(input.fullRun?.runKind !== "full" ? ["FULL_ORACLE_REQUIRED"] : []),
    ...(input.fullRun && input.fullRun.results.length !== input.denominator.instances.length ? ["FULL_ORACLE_DENOMINATOR_INCOMPLETE"] : []),
    ...(requirements.length !== input.problem.requirementRevisionRefs.length ? ["REQUIREMENT_DENOMINATOR_INCOMPLETE"] : []),
    ...requirements.filter((item) => item.implementationState !== "implemented" || item.verificationState !== "verified" || item.satisfactionState !== "satisfied").map((item) => `REQUIREMENT_${item.requirementId}_INCOMPLETE`),
  ]);
  const activeWaivers = input.fullRun ? activeCircuitWaivers({ waivers: input.waivers ?? [], run: input.fullRun, registry: input.registry, now: input.now }) : [];
  const findings = input.fullRun?.findings ?? [];
  const provenBlockers = findings.filter((item) => item.engineeringResult === "violation" && ["blocking", "error"].includes(item.severity));
  const unwaived = provenBlockers.filter((finding) => !activeWaivers.some((waiver) => waiver.findingStableIdentities.includes(finding.stableIdentity)));
  const incomplete = findings.filter((item) => ["unknown", "unsupported", "not_evaluated", "stale", "internal_error"].includes(item.engineeringResult));
  const parityState = input.parity?.state ?? "not_compared";
  const parityMismatch = parityState === "mismatch";
  const stale = currency.state === "stale";
  const blocked = unwaived.length > 0 || parityMismatch;
  const verificationIncomplete = currency.state !== "current" || coverageGapCodes.length > 0 || incomplete.length > 0 || input.fullRun?.executionState !== "completed";
  const verdict = stale ? "STALE" as const : blocked ? "BLOCKED" as const : verificationIncomplete ? "VERIFICATION_INCOMPLETE" as const : "READY" as const;
  const body = {
    claim: "CIRCUIT_VERIFICATION_READINESS" as const,
    verdict,
    graphDigest: input.graphDigest,
    registryDigest: input.registry.deterministicDigest,
    denominatorDigest: input.denominator.deterministicDigest,
    ...(input.fullRun ? { fullOracleRunId: input.fullRun.runId } : {}),
    currency,
    requirementCoverage: requirements,
    blockingFindingIds: provenBlockers.map((item) => item.findingId).sort(),
    unwaivedFindingIds: unwaived.map((item) => item.findingId).sort(),
    coverageGapCodes,
    parityState,
    activeWaiverIds: activeWaivers.map((item) => item.waiverId),
    limitations: [
      "This report covers only the named deterministic rules and exact current semantic inputs.",
      "Native KiCad ERC and AI review are corroborating evidence only and cannot change this verdict.",
      "Mains/high-energy, regulatory, functional-safety, medical, automotive-safety, intrinsic-safety, RF, SerDes, SI/PI, EMC, thermal, and reliability claims require named external evidence.",
      "An engineering waiver changes workflow disposition only; it never changes the underlying physical rule result.",
    ],
    permittedActions: verdict === "READY" ? ["edit_design", "rerun_full_verification", "request_external_review", "approve_for_CD10"] as CircuitReadinessReport["permittedActions"] : ["edit_design", "rerun_full_verification", "request_external_review"] as CircuitReadinessReport["permittedActions"],
  };
  return finalizeVerification<CircuitReadinessReport>({ ...body, reportId: verificationId("circuit-readiness", body), deterministicDigest: "" });
}
