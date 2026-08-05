export const BENCHMARK_SCHEMA_VERSION = "sirkit.benchmark.v1" as const;
export const CORPUS_SCHEMA_VERSION = "sirkit.benchmark-corpus.v1" as const;
export const PACKAGE_SCHEMA_VERSION = "sirkit.benchmark-package.v1" as const;
export const RUN_SCHEMA_VERSION = "sirkit.benchmark-run.v1" as const;
export const RESULT_SCHEMA_VERSION = "sirkit.benchmark-result.v1" as const;
export const ORACLE_SCHEMA_VERSION = "sirkit.benchmark-oracle.v1" as const;
export const METRIC_SCHEMA_VERSION = "sirkit.benchmark-metric.v1" as const;
export const EXPERIMENT_SCHEMA_VERSION = "sirkit.benchmark-experiment.v1" as const;
export const CLAIM_SCHEMA_VERSION = "sirkit.competitive-claim.v1" as const;

export type BenchmarkPartition = "publicDevelopment" | "tuning" | "validation" | "hiddenHoldout" | "stress";
export type BenchmarkTier = "tier0_analytical" | "tier1_subsystem" | "tier2_synthetic" | "tier3_open_real" | "tier4_private_replay" | "tier5_competitive" | "tier6_stress";
export type BenchmarkTaskKind =
  | "data_integrity" | "electrical_truth" | "readiness" | "plane_geometry" | "component_selection"
  | "constraint_resolution" | "placement" | "routing" | "autorouting" | "high_speed_routing"
  | "interoperability" | "ai_safety" | "requirements_compilation" | "architecture_synthesis" | "power_architecture" | "interface_planning" | "circuit_knowledge" | "electrical_calculation" | "schematic_compilation" | "circuit_verification" | "model_simulation" | "firmware_bringup" | "release_engineering" | "full_flow" | "scale";
export type BenchmarkRunStatus = "passed" | "failed_correctness" | "completed_with_unknowns" | "unsupported" | "blocked_by_prerequisite" | "not_comparable" | "timeout" | "crash" | "cancelled" | "environment_failure" | "license_unavailable" | "oracle_disagreement" | "invalid_fixture";
export type CapabilityState = "supported" | "partial" | "unsupported" | "unknown" | "blocked_by_prerequisite" | "license_unavailable" | "not_comparable";
export type PrivacyClassification = "public" | "internal" | "confidential" | "restricted";
export type RedistributionPolicy = "public" | "internal_only" | "aggregate_only" | "no_redistribution";

export interface SourceProvenance {
  sourceKind: "generated" | "open" | "internal" | "user_opt_in" | "proprietary";
  sourceUri?: string;
  sourceRevision: string;
  owner: string;
  canonicalizationNotes: string[];
  sourceDigest: string;
}

export interface LicenseDeclaration {
  spdxId: string;
  licenseTextRef?: string;
  redistributionPolicy: RedistributionPolicy;
  modificationAllowed: boolean;
  attributionRequired: string[];
  thirdPartyAssets: Array<{ assetId: string; license: string; resolved: boolean }>;
  allowedScopes: Array<"local" | "ci" | "internal_report" | "public_report">;
  retentionPolicy: string;
  reviewedAt: string;
}

export interface DifficultyProfile {
  componentCount: number;
  padCount: number;
  netCount: number;
  layerCount: number;
  placementDensity: number;
  finePitchNm?: number;
  constraintCount: number;
  obstacleComplexity: number;
  differentialPairCount: number;
  existingProtectedCopper: number;
  hierarchyDepth: number;
  expectedHumanDifficulty: "micro" | "easy" | "moderate" | "hard" | "expert";
}

export interface CanonicalInputRef {
  inputId: string;
  kind: "inline_json" | "project_bundle" | "kicad" | "dsn" | "ses" | "text_brief" | "generated_family";
  digest: string;
  mediaType: string;
  relativePath?: string;
  inlineValue?: unknown;
  hidden: boolean;
}

export interface OracleSpec {
  schemaVersion: typeof ORACLE_SCHEMA_VERSION;
  oracleId: string;
  version: number;
  oracleKind: "exact_golden" | "analytical" | "property" | "independent_checker" | "metamorphic" | "expert_rubric" | "hardware_evidence" | "cross_tool_supporting";
  scope: string;
  implementationRef?: string;
  analyticalExpectedValues?: Record<string, number | string | boolean>;
  propertyPredicates: string[];
  tolerancePolicy: { kind: "exact" | "absolute" | "relative" | "categorical"; value?: number; unit?: MetricUnit };
  independenceClass: "independent_implementation" | "analytical_closed_form" | "property_only" | "production_cross_check" | "human_independent" | "supporting_only";
  reviewerProtocol?: string;
  conflictPolicy: "block_claim" | "invalidate_fixture" | "require_adjudication";
  evidenceRequirements: string[];
}

export type MetricUnit = "boolean" | "count" | "ratio" | "percent" | "nm" | "nm2" | "ms" | "bytes" | "MiB" | "tokens" | "usd" | "categorical" | "digest_rate";
export type MetricDirection = "higher_is_better" | "lower_is_better" | "target_range" | "categorical_pass" | "descriptive_only";

export interface MetricDefinition {
  schemaVersion: typeof METRIC_SCHEMA_VERSION;
  metricId: string;
  version: number;
  displayName: string;
  domain: "correctness" | "placement" | "routing" | "component" | "constraint" | "readiness" | "productivity" | "robustness" | "interoperability" | "explainability" | "ai_safety" | "performance";
  valueType: "boolean" | "integer" | "number" | "categorical";
  unit: MetricUnit;
  direction: MetricDirection;
  eligibilityGate?: { operator: "eq" | "lte" | "gte" | "in_range"; value: number | boolean; maximum?: number; critical: boolean };
  measurementScope: "run" | "trial" | "package" | "domain" | "corpus";
  computationRef: string;
  oracleRef?: string;
  aggregationPolicy: "none" | "macro_mean" | "micro_sum" | "median" | "quantiles" | "failure_rate";
  missingDataPolicy: "fail_gate" | "retain_missing" | "not_comparable" | "unsupported";
  uncertaintyPolicy: "none" | "paired_bootstrap" | "bootstrap" | "exact_binomial" | "quantiles";
  outlierPolicy: "retain" | "winsorize_declared" | "investigate_only";
  comparabilityRequirements: string[];
  explanation: string;
}

export interface BenchmarkPackage {
  schemaVersion: typeof PACKAGE_SCHEMA_VERSION;
  packageId: string;
  version: number;
  familyId: string;
  title: string;
  description: string;
  tier: BenchmarkTier;
  partition: BenchmarkPartition;
  taskKinds: BenchmarkTaskKind[];
  domainTags: string[];
  difficultyProfile: DifficultyProfile;
  sourceProvenance: SourceProvenance;
  license: LicenseDeclaration;
  privacyClassification: PrivacyClassification;
  canonicalInputs: CanonicalInputRef[];
  permittedConversions: Array<{ conversionId: string; target: string; lossPolicy: "lossless_required" | "loss_report_required" }>;
  constraintBundle: { programDigest?: string; refs: string[] };
  oracleBundle: OracleSpec[];
  metricProfile: { metricIds: string[]; decisionProfileId?: string };
  runBudgetProfile: { timeoutMs: number; memoryMiB: number; outputMiB: number; trials: number; concurrency: number; network: "deny" | "allowlisted" | "allowed" };
  expectedCapabilityStates: Array<{ capabilityId: string; state: CapabilityState; reason?: string }>;
  hiddenAssets?: Array<{ assetId: string; digest: string; accessClass: "oracle_only" | "holdout_admin" }>;
  packageDigest: string;
}

export interface CorpusManifest {
  schemaVersion: typeof CORPUS_SCHEMA_VERSION;
  corpusId: string;
  version: number;
  createdAt: string;
  licensePolicyVersion: string;
  benchmarkPackages: Array<{ packageId: string; version: number; packageDigest: string }>;
  partitions: Record<BenchmarkPartition, string[]>;
  stratificationSummary: { tiers: Record<string, number>; domains: Record<string, number>; difficulties: Record<string, number> };
  sourceDigests: string[];
  changelog: string[];
  signerOrApproval?: { actorId: string; approvalRef: string };
  manifestDigest: string;
}

export interface EnvironmentProfile {
  profileId: string;
  os: string;
  architecture: string;
  cpuModel: string;
  logicalCores: number;
  memoryLimitMiB: number;
  runtimeVersions: Record<string, string>;
  locale: string;
  timezone: string;
  envAllowlistDigest: string;
  networkPolicy: "deny" | "allowlisted" | "allowed";
  cacheState: "cold" | "warm" | "incremental";
  buildProfile: string;
  concurrency: number;
  externalTools: Array<{ tool: string; version: string; licenseState: "open" | "licensed" | "license_unavailable" }>;
}

export interface AssistanceProtocol {
  level: "deterministic_engine" | "ai_plan_human_approve" | "ai_typed_reversible" | "ai_bounded_task" | "expert_manual";
  protocolVersion: string;
  allowedMutations: string[];
  humanInterventionPolicy: string;
}

export interface BenchmarkRun {
  schemaVersion: typeof RUN_SCHEMA_VERSION;
  runId: string;
  suiteId: string;
  corpusVersion: number;
  packageId: string;
  packageDigest: string;
  partition: BenchmarkPartition;
  productUnderTest: string;
  productVersion: string;
  codeRevision: string;
  buildProfile: string;
  environmentProfile: EnvironmentProfile;
  dependencyLockDigest: string;
  modelProviderAndVersion?: string;
  promptAndToolSchemaDigests?: string[];
  randomSeeds: number[];
  configuration: Record<string, unknown>;
  assistanceProtocol: AssistanceProtocol;
  startTime: string;
  endTime?: string;
  status: BenchmarkRunStatus;
  inputDigests: string[];
  artifactRefs: Array<{ artifactId: string; kind: string; digest: string; relativePath: string; bytes: number; access: "public" | "internal" | "restricted" }>;
  resultDigest?: string;
}

export interface OracleResult {
  oracleId: string;
  state: "passed" | "failed" | "unknown" | "unsupported" | "disagreement";
  measured?: unknown;
  expected?: unknown;
  explanation: string;
  evidenceRefs: string[];
}

export interface CorrectnessGateResult {
  gateId: string;
  metricId: string;
  state: "passed" | "failed" | "unknown" | "unsupported" | "not_applicable";
  critical: boolean;
  measured?: number | boolean | string;
  threshold?: number | boolean | string;
  evidenceRefs: string[];
  explanation: string;
}

export interface MetricValue {
  metricId: string;
  value?: number | boolean | string;
  state: "measured" | "missing" | "unsupported" | "not_comparable" | "censored";
  unit: MetricUnit;
  evidenceRefs: string[];
  explanation?: string;
}

export interface BenchmarkResult {
  schemaVersion: typeof RESULT_SCHEMA_VERSION;
  resultId: string;
  runId: string;
  correctnessGates: CorrectnessGateResult[];
  metricValues: MetricValue[];
  objectiveVector: string[];
  capabilityStates: Array<{ capabilityId: string; state: CapabilityState; evidenceRefs: string[]; explanation: string }>;
  oracleResults: OracleResult[];
  unsupportedEvidence: string[];
  warnings: string[];
  exclusions: Array<{ state: BenchmarkRunStatus; reason: string; evidenceRefs: string[] }>;
  performanceSamples: Array<{ operation: string; elapsedMs: number; memoryMiB?: number; cacheState: EnvironmentProfile["cacheState"]; trial: number; seed?: number }>;
  humanEffort?: { activeMs: number; actions: number; retries: number; undos: number; corrections: Array<{ severity: "minor" | "major" | "critical"; description: string }> };
  artifactDigests: string[];
  failureSignature?: string;
  resultDigest: string;
}

export interface ExperimentSpec {
  schemaVersion: typeof EXPERIMENT_SCHEMA_VERSION;
  experimentId: string;
  hypothesis: string;
  owner: string;
  preRegisteredAt: string;
  baselineRevision: string;
  candidateRevision?: string;
  tunableParameters: Array<{ parameterId: string; valueType: "integer" | "number" | "categorical" | "boolean"; unit: MetricUnit; allowedValues?: Array<number | string | boolean>; minimum?: number; maximum?: number; defaultValue: number | string | boolean; safetyBounds: string; algorithmVersion: string }>;
  fixedParameters: Record<string, unknown>;
  corpusPartitions: BenchmarkPartition[];
  primaryMetrics: string[];
  guardrailMetrics: string[];
  statisticalPlan: string;
  stoppingRule: string;
  multipleComparisonPolicy: string;
  successCriteria: string[];
  rollbackCriteria: string[];
  specDigest: string;
}

export interface CompetitiveClaim {
  schemaVersion: typeof CLAIM_SCHEMA_VERSION;
  claimId: string;
  claimText: string;
  scope: string;
  comparedProductsAndVersions: string[];
  taskEquivalence: "equivalent" | "reduced_common_denominator" | "not_comparable";
  assistanceEquivalence: string;
  corpusVersion: number;
  resultQuery: string;
  metricDefinitions: string[];
  statisticalSummary: string;
  conversionLimitations: string[];
  exclusions: string[];
  confidence: "low" | "moderate" | "high";
  expirationOrReviewDate: string;
  approver?: string;
  capabilitySourceRefs: string[];
  claimDigest: string;
}
