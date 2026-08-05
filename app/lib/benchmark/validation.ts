import { benchmarkDigest, withoutDigest } from "./stable";
import type { BenchmarkPackage, BenchmarkRun, CompetitiveClaim, CorpusManifest, ExperimentSpec, MetricDefinition } from "./types";

export interface BenchmarkDiagnostic {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
}

const date = (value: string): boolean => Number.isFinite(Date.parse(value));
const digest = (value: string): boolean => /^sha256:[0-9a-f]{64}$/.test(value);
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

export function finalizeBenchmarkPackage(input: Omit<BenchmarkPackage, "packageDigest">): BenchmarkPackage {
  return { ...structuredClone(input), packageDigest: benchmarkDigest(input) };
}

export function validateBenchmarkPackage(value: BenchmarkPackage): BenchmarkDiagnostic[] {
  const out: BenchmarkDiagnostic[] = [];
  const error = (code: string, path: string, message: string): void => { out.push({ code, severity: "error", path, message }); };
  if (!value.packageId.trim() || !value.familyId.trim()) error("PACKAGE_ID_REQUIRED", "packageId", "Package and family identities are required.");
  if (value.version < 1 || !Number.isInteger(value.version)) error("PACKAGE_VERSION_INVALID", "version", "Package version must be a positive integer.");
  if (!value.taskKinds.length || !value.domainTags.length) error("PACKAGE_SCOPE_EMPTY", "taskKinds", "Task kinds and domain tags cannot be empty.");
  if (!value.canonicalInputs.length) error("PACKAGE_INPUTS_EMPTY", "canonicalInputs", "At least one content-addressed canonical input is required.");
  if (value.canonicalInputs.some((input) => !digest(input.digest))) error("INPUT_DIGEST_INVALID", "canonicalInputs", "Every input needs a SHA-256 digest.");
  if (!digest(value.sourceProvenance.sourceDigest)) error("SOURCE_DIGEST_INVALID", "sourceProvenance.sourceDigest", "Source provenance requires a SHA-256 digest.");
  if (!value.license.spdxId.trim() || !date(value.license.reviewedAt)) error("LICENSE_UNRESOLVED", "license", "A reviewed SPDX license declaration is required.");
  if (value.license.thirdPartyAssets.some((asset) => !asset.resolved)) error("THIRD_PARTY_LICENSE_UNRESOLVED", "license.thirdPartyAssets", "Unresolved third-party assets cannot enter a governed package.");
  if (value.license.redistributionPolicy === "public" && !value.license.allowedScopes.includes("public_report")) error("PUBLIC_SCOPE_MISMATCH", "license.allowedScopes", "Public redistribution requires explicit public-report scope.");
  if (value.partition === "hiddenHoldout" && value.canonicalInputs.some((input) => input.hidden === false && input.kind === "inline_json" && String(input.inputId).includes("oracle"))) error("HOLDOUT_ORACLE_PUBLIC", "canonicalInputs", "Hidden holdout oracle assets cannot be public candidate inputs.");
  if (value.runBudgetProfile.timeoutMs <= 0 || value.runBudgetProfile.memoryMiB <= 0 || value.runBudgetProfile.outputMiB <= 0 || value.runBudgetProfile.trials < 1) error("RUN_BUDGET_INVALID", "runBudgetProfile", "All resource budgets must be positive.");
  if (!unique(value.metricProfile.metricIds)) error("DUPLICATE_METRIC", "metricProfile.metricIds", "Metric IDs must be unique.");
  const expected = benchmarkDigest(withoutDigest(value as unknown as Record<string, unknown>, "packageDigest"));
  if (value.packageDigest !== expected) error("PACKAGE_DIGEST_MISMATCH", "packageDigest", "Package digest does not match canonical content.");
  return out;
}

export function finalizeCorpusManifest(input: Omit<CorpusManifest, "manifestDigest">): CorpusManifest {
  return { ...structuredClone(input), manifestDigest: benchmarkDigest(input) };
}

export function validateCorpusManifest(manifest: CorpusManifest, packages: readonly BenchmarkPackage[]): BenchmarkDiagnostic[] {
  const out: BenchmarkDiagnostic[] = [];
  const error = (code: string, path: string, message: string): void => { out.push({ code, severity: "error", path, message }); };
  const map = new Map(packages.map((pkg) => [pkg.packageId, pkg]));
  if (!date(manifest.createdAt)) error("CORPUS_DATE_INVALID", "createdAt", "Corpus date must be ISO-compatible.");
  if (!unique(manifest.benchmarkPackages.map((item) => item.packageId))) error("DUPLICATE_PACKAGE", "benchmarkPackages", "Corpus package IDs must be unique.");
  for (const ref of manifest.benchmarkPackages) {
    const pkg = map.get(ref.packageId);
    if (!pkg || pkg.version !== ref.version || pkg.packageDigest !== ref.packageDigest) error("PACKAGE_REF_INVALID", `benchmarkPackages.${ref.packageId}`, "Manifest package reference does not resolve exactly.");
  }
  const partitionEntries = Object.entries(manifest.partitions).flatMap(([partition, ids]) => ids.map((id) => ({ partition, id })));
  if (!unique(partitionEntries.map((item) => item.id))) error("PACKAGE_MULTI_PARTITION", "partitions", "A package cannot occur in multiple partitions.");
  const familyPartition = new Map<string, string>();
  for (const item of partitionEntries) {
    const pkg = map.get(item.id);
    if (!pkg) { error("PARTITION_PACKAGE_UNKNOWN", `partitions.${item.partition}`, `Unknown package ${item.id}.`); continue; }
    if (pkg.partition !== item.partition) error("PARTITION_DECLARATION_MISMATCH", `partitions.${item.partition}`, `${pkg.packageId} declares ${pkg.partition}.`);
    const existing = familyPartition.get(pkg.familyId);
    if (existing && existing !== item.partition) error("FAMILY_PARTITION_LEAKAGE", `partitions.${item.partition}`, `Family ${pkg.familyId} straddles ${existing} and ${item.partition}.`);
    familyPartition.set(pkg.familyId, item.partition);
  }
  const expected = benchmarkDigest(withoutDigest(manifest as unknown as Record<string, unknown>, "manifestDigest"));
  if (manifest.manifestDigest !== expected) error("CORPUS_DIGEST_MISMATCH", "manifestDigest", "Corpus digest does not match canonical content.");
  return [...out, ...packages.flatMap((pkg) => validateBenchmarkPackage(pkg).map((item) => ({ ...item, path: `${pkg.packageId}.${item.path}` })))];
}

export function validateMetricDefinition(metric: MetricDefinition): BenchmarkDiagnostic[] {
  const out: BenchmarkDiagnostic[] = [];
  const error = (code: string, path: string, message: string): void => { out.push({ code, severity: "error", path, message }); };
  if (!metric.metricId.trim() || metric.version < 1) error("METRIC_ID_INVALID", "metricId", "Metric identity/version is required.");
  if (!metric.computationRef.trim() || !metric.explanation.trim()) error("METRIC_SEMANTICS_AMBIGUOUS", "computationRef", "Metric computation and explanation are mandatory.");
  if (metric.domain === "correctness" && metric.direction !== "categorical_pass" && !metric.eligibilityGate) error("CORRECTNESS_GATE_REQUIRED", "eligibilityGate", "Correctness metrics require an explicit gate.");
  if (metric.valueType === "boolean" && metric.unit !== "boolean") error("METRIC_UNIT_TYPE_MISMATCH", "unit", "Boolean metrics must use boolean units.");
  if (metric.direction === "target_range" && metric.eligibilityGate?.operator !== "in_range") error("TARGET_RANGE_MISSING", "eligibilityGate", "Target-range metrics require an in-range gate.");
  return out;
}

export function validateRunManifest(run: BenchmarkRun): BenchmarkDiagnostic[] {
  const out: BenchmarkDiagnostic[] = [];
  const requiredStrings: Array<[string, string]> = [["runId", run.runId], ["suiteId", run.suiteId], ["packageId", run.packageId], ["packageDigest", run.packageDigest], ["codeRevision", run.codeRevision], ["dependencyLockDigest", run.dependencyLockDigest], ["productVersion", run.productVersion]];
  for (const [path, value] of requiredStrings) if (!value.trim()) out.push({ code: "RUN_MANIFEST_INCOMPLETE", severity: "error", path, message: `${path} is required.` });
  if (!run.randomSeeds.length || !run.inputDigests.length) out.push({ code: "RUN_MANIFEST_INCOMPLETE", severity: "error", path: "randomSeeds", message: "Seeds and input digests are required." });
  if (!date(run.startTime) || run.endTime && !date(run.endTime)) out.push({ code: "RUN_TIME_INVALID", severity: "error", path: "startTime", message: "Run timestamps must be valid." });
  if (!digest(run.packageDigest) || !digest(run.dependencyLockDigest) || run.inputDigests.some((item) => !digest(item))) out.push({ code: "RUN_DIGEST_INVALID", severity: "error", path: "inputDigests", message: "Run digests must use SHA-256." });
  return out;
}

export function finalizeExperiment(input: Omit<ExperimentSpec, "specDigest">): ExperimentSpec {
  return { ...structuredClone(input), specDigest: benchmarkDigest(input) };
}

export function validateExperiment(spec: ExperimentSpec): BenchmarkDiagnostic[] {
  const out: BenchmarkDiagnostic[] = [];
  if (!date(spec.preRegisteredAt) || !spec.baselineRevision || !spec.primaryMetrics.length || !spec.guardrailMetrics.length) out.push({ code: "EXPERIMENT_NOT_PREREGISTERED", severity: "error", path: "experiment", message: "Experiment requires date, baseline, primary metrics, and guardrails before execution." });
  if (spec.corpusPartitions.includes("hiddenHoldout") && spec.corpusPartitions.includes("tuning")) out.push({ code: "EXPERIMENT_HOLDOUT_LEAKAGE", severity: "error", path: "corpusPartitions", message: "One search experiment cannot query tuning and hidden holdout together." });
  if (benchmarkDigest(withoutDigest(spec as unknown as Record<string, unknown>, "specDigest")) !== spec.specDigest) out.push({ code: "EXPERIMENT_DIGEST_MISMATCH", severity: "error", path: "specDigest", message: "Experiment spec digest mismatch." });
  return out;
}

export function finalizeCompetitiveClaim(input: Omit<CompetitiveClaim, "claimDigest">): CompetitiveClaim {
  return { ...structuredClone(input), claimDigest: benchmarkDigest(input) };
}

export function validateCompetitiveClaim(claim: CompetitiveClaim): BenchmarkDiagnostic[] {
  const out: BenchmarkDiagnostic[] = [];
  const missing = !claim.capabilitySourceRefs.length || !claim.resultQuery || !claim.metricDefinitions.length || !claim.statisticalSummary || !date(claim.expirationOrReviewDate);
  if (missing) out.push({ code: "CLAIM_EVIDENCE_INCOMPLETE", severity: "error", path: "claim", message: "Competitive claim lacks source, measured query, metrics, statistics, or review date." });
  if (claim.taskEquivalence === "not_comparable" && /\b(better|faster|wins?|superior|beats?)\b/i.test(claim.claimText)) out.push({ code: "INCOMPARABLE_WIN_CLAIM", severity: "error", path: "claimText", message: "A non-comparable task cannot support a win/superiority claim." });
  if (!claim.approver) out.push({ code: "CLAIM_APPROVAL_MISSING", severity: "error", path: "approver", message: "Product-facing competitive claims require approval." });
  if (benchmarkDigest(withoutDigest(claim as unknown as Record<string, unknown>, "claimDigest")) !== claim.claimDigest) out.push({ code: "CLAIM_DIGEST_MISMATCH", severity: "error", path: "claimDigest", message: "Competitive claim digest mismatch." });
  return out;
}
