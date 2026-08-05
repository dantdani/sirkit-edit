import type { EngineeringActor } from "../engineering/types";
import type { Cd9UpstreamCompletionSignoff, CircuitVerificationCapabilityProfile } from "./types";
import { finalizeVerification, verificationDigest } from "./stable";

const REQUIRED_CATEGORIES: CircuitVerificationCapabilityProfile["requiredCategories"] = [
  "graph_integrity",
  "atomic_binding",
  "pin_compatibility",
  "power_ground_domain",
  "application_support",
  "interface_connector_test",
  "variant_population",
  "requirement_coverage",
  "currency_lineage",
  "external_specialist_review",
];

export function defaultCircuitVerificationCapabilityProfile(): CircuitVerificationCapabilityProfile {
  return finalizeVerification<CircuitVerificationCapabilityProfile>({
    profileId: "low-voltage-embedded-circuit-verification-v1",
    version: "1.0.0",
    supportedCategories: [
      "graph_integrity",
      "atomic_binding",
      "pin_compatibility",
      "power_ground_domain",
      "variant_population",
      "requirement_coverage",
      "currency_lineage",
    ],
    requiredCategories: REQUIRED_CATEGORIES,
    externalReviewDomains: [
      "mains_and_high_energy",
      "functional_safety",
      "medical",
      "automotive_safety",
      "intrinsic_safety",
      "rf_and_antenna",
      "serdes_signal_integrity",
      "power_integrity",
      "emc_compliance",
    ],
    unsupportedDomains: [
      "autonomous_safety_certification",
      "regulatory_approval",
      "field_reliability_guarantee",
    ],
    limits: {
      maximumComponents: 2_000,
      maximumPins: 40_000,
      maximumNets: 10_000,
      maximumVariants: 64,
      maximumContextsPerVariant: 16,
      maximumRuleInstances: 500_000,
      maximumSelectorResults: 50_000,
    },
    policies: {
      registry: "cd9-reviewed-rule-registry/1",
      applicability: "cd9-explicit-non-vacuous-applicability/1",
      fullOracle: "cd9-independent-full-oracle/1",
      stableIdentity: "cd9-semantic-finding-identity/1",
      waiver: "cd9-narrow-expiring-independent-waiver/1",
      parity: "cd9-full-incremental-equivalence/1",
      readiness: "cd9-no-unknown-no-gap-readiness/1",
    },
    approvalState: "approved",
    deterministicDigest: "",
  });
}

export function createCd9UpstreamCompletionSignoff(input: Omit<Cd9UpstreamCompletionSignoff, "schemaVersion" | "deterministicDigest">): Cd9UpstreamCompletionSignoff {
  return finalizeVerification<Cd9UpstreamCompletionSignoff>({ schemaVersion: "sirkit.cd9-upstream-signoff.v1", ...structuredClone(input), deterministicDigest: "" });
}

export function validateCd9UpstreamCompletionSignoff(value: Cd9UpstreamCompletionSignoff): string[] {
  const errors: string[] = [];
  if (!value || value.schemaVersion !== "sirkit.cd9-upstream-signoff.v1" || value.cd1Verdict !== "CD-1 COMPLETE" || value.cd2Verdict !== "CD-2 COMPLETE" || value.cd3Verdict !== "CD-3 COMPLETE" || value.cd4Verdict !== "CD-4 COMPLETE" || value.cd5Verdict !== "CD-5 COMPLETE" || value.cd6Verdict !== "CD-6 COMPLETE" || value.cd7Verdict !== "CD-7 COMPLETE" || value.cd8Verdict !== "CD-8 COMPLETE") errors.push("CD9_UPSTREAM_COMPLETION_VERDICT_MISSING");
  const expectedStages = ["CD-1", "CD-2", "CD-3", "CD-4", "CD-5", "CD-6", "CD-7", "CD-8"];
  if (value?.stageDigests?.length !== 8 || expectedStages.some((stage) => !value.stageDigests.some((item) => item.stage === stage)) || value.stageDigests.some((item) => !item.stateDigest || !item.decisionDigest)) errors.push("CD9_UPSTREAM_DIGEST_CHAIN_INCOMPLETE");
  if (!value?.approvedSchematicCandidateId || !value.approvedSchematicCandidateDigest || !value.semanticGraphDigest || !value.roundTripCertificateDigest) errors.push("CD9_CD8_HANDOFF_DIGESTS_INCOMPLETE");
  if (!value?.approver || value.approver.actorKind !== "human" || !["reviewer", "project_admin"].includes(value.approver.role)) errors.push("CD9_UPSTREAM_SIGNOFF_UNAUTHORIZED");
  if (!Number.isFinite(Date.parse(value?.approvedAt ?? ""))) errors.push("CD9_UPSTREAM_SIGNOFF_DATE_INVALID");
  if (value && value.deterministicDigest !== verificationDigest({ ...value, deterministicDigest: undefined })) errors.push("CD9_UPSTREAM_SIGNOFF_DIGEST_MISMATCH");
  return [...new Set(errors)].sort();
}

export function humanReviewer(actor: EngineeringActor | undefined): boolean {
  return Boolean(actor?.actorKind === "human" && ["reviewer", "project_admin"].includes(actor.role));
}
