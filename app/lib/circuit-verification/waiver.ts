import { humanReviewer } from "./capability";
import { finalizeVerification, uniqueSorted, verificationId } from "./stable";
import type { CircuitFinding, CircuitWaiver, FullOracleRun, RuleRegistrySnapshot } from "./types";

export function createCircuitWaiver(input: {
  findings: CircuitFinding[];
  run: FullOracleRun;
  registry: RuleRegistrySnapshot;
  justification: string;
  riskStatement: string;
  requestedBy: CircuitWaiver["requestedBy"];
  approvedBy: CircuitWaiver["approvedBy"];
  createdAt: string;
  expiresAt: string;
}): CircuitWaiver {
  if (!input.findings.length) throw new Error("CD9_WAIVER_FINDING_REQUIRED");
  if (input.justification.trim().length < 16 || input.riskStatement.trim().length < 16) throw new Error("CD9_WAIVER_RATIONALE_INCOMPLETE");
  if (input.requestedBy.actorId === input.approvedBy.actorId || !humanReviewer(input.approvedBy)) throw new Error("CD9_WAIVER_INDEPENDENT_HUMAN_APPROVAL_REQUIRED");
  if (!Number.isFinite(Date.parse(input.createdAt)) || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.parse(input.createdAt)) throw new Error("CD9_WAIVER_EXPIRY_INVALID");
  if (input.run.runKind !== "full" || input.run.graphDigest === "" || input.run.registryDigest !== input.registry.deterministicDigest) throw new Error("CD9_WAIVER_CURRENT_FULL_ORACLE_REQUIRED");
  for (const finding of input.findings) {
    const rule = input.registry.rules.find((item) => item.ruleId === finding.ruleId && item.deterministicDigest === finding.ruleDigest);
    if (!rule || rule.waiverPolicy !== "independent_approval" || finding.engineeringResult !== "violation" || finding.workflowState === "obsolete") throw new Error(`CD9_FINDING_NON_WAIVABLE:${finding.findingId}`);
  }
  const body = {
    findingStableIdentities: uniqueSorted(input.findings.map((item) => item.stableIdentity)),
    ruleIds: uniqueSorted(input.findings.map((item) => item.ruleId)),
    semanticAnchorIds: uniqueSorted(input.findings.flatMap((item) => item.semanticAnchorIds)),
    variantIds: uniqueSorted(input.findings.map((item) => item.variantId)),
    contextIds: uniqueSorted(input.findings.map((item) => item.contextId)),
    graphDigest: input.run.graphDigest,
    registryDigest: input.registry.deterministicDigest,
    justification: input.justification.trim(),
    riskStatement: input.riskStatement.trim(),
    requestedBy: structuredClone(input.requestedBy),
    approvedBy: structuredClone(input.approvedBy),
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    state: "active" as const,
    physicalResultPreserved: true as const,
  };
  return finalizeVerification<CircuitWaiver>({ ...body, waiverId: verificationId("circuit-waiver", body), deterministicDigest: "" });
}

export function activeCircuitWaivers(input: { waivers: CircuitWaiver[]; run: FullOracleRun; registry: RuleRegistrySnapshot; now: string }): CircuitWaiver[] {
  const now = Date.parse(input.now);
  return input.waivers.filter((waiver) => waiver.state === "active" && waiver.graphDigest === input.run.graphDigest && waiver.registryDigest === input.registry.deterministicDigest && Number.isFinite(now) && Date.parse(waiver.expiresAt) > now && waiver.requestedBy.actorId !== waiver.approvedBy.actorId && humanReviewer(waiver.approvedBy)).sort((a, b) => a.waiverId.localeCompare(b.waiverId));
}
