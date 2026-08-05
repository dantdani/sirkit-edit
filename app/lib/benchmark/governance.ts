import { benchmarkDigest } from "./stable";
import type { BenchmarkPackage, BenchmarkPartition, LicenseDeclaration } from "./types";

export function candidateVisiblePackage(pkg: BenchmarkPackage): BenchmarkPackage {
  const visible = structuredClone(pkg);
  visible.canonicalInputs = visible.canonicalInputs.filter((input) => !input.hidden);
  visible.oracleBundle = [];
  delete visible.hiddenAssets;
  return visible;
}

export function assertPartitionAccess(input: { partition: BenchmarkPartition; role: "candidate" | "oracle" | "holdout_admin"; purpose: "debug" | "tune" | "validate" | "release" }): void {
  if (input.partition === "hiddenHoldout" && input.role === "candidate") throw new Error("HOLDOUT_ACCESS_DENIED: candidate generation cannot access hidden holdout assets.");
  if (input.partition === "hiddenHoldout" && input.purpose !== "release" && input.role !== "holdout_admin") throw new Error("HOLDOUT_ACCESS_DENIED: holdout is release-only.");
  if (input.partition === "validation" && input.purpose === "tune") throw new Error("VALIDATION_LEAKAGE_DENIED: validation outcomes cannot drive tuning search.");
}

export function structuralFingerprint(pkg: BenchmarkPackage): string {
  return benchmarkDigest({
    familyId: pkg.familyId,
    tasks: [...pkg.taskKinds].sort(),
    domains: [...pkg.domainTags].sort(),
    difficulty: pkg.difficultyProfile,
    inputKinds: pkg.canonicalInputs.map((input) => input.kind).sort(),
    constraintRefs: [...pkg.constraintBundle.refs].sort(),
  });
}

export function detectSimilarityLeakage(packages: readonly BenchmarkPackage[]): Array<{ left: string; right: string; reason: string }> {
  const failures: Array<{ left: string; right: string; reason: string }> = [];
  for (let left = 0; left < packages.length; left += 1) for (let right = left + 1; right < packages.length; right += 1) {
    const a = packages[left]; const b = packages[right];
    if (a.partition === b.partition) continue;
    if (a.familyId === b.familyId) failures.push({ left: a.packageId, right: b.packageId, reason: "same family across partitions" });
    else if (a.sourceProvenance.sourceDigest === b.sourceProvenance.sourceDigest) failures.push({ left: a.packageId, right: b.packageId, reason: "identical source digest across partitions" });
    else if (structuralFingerprint(a) === structuralFingerprint(b)) failures.push({ left: a.packageId, right: b.packageId, reason: "identical structural fingerprint across partitions" });
  }
  return failures.sort((a, b) => a.left.localeCompare(b.left) || a.right.localeCompare(b.right));
}

export function licenseAllows(license: LicenseDeclaration, scope: "local" | "ci" | "internal_report" | "public_report"): { allowed: boolean; reason: string } {
  if (!license.allowedScopes.includes(scope)) return { allowed: false, reason: `License does not permit ${scope}.` };
  if (license.thirdPartyAssets.some((asset) => !asset.resolved)) return { allowed: false, reason: "Third-party asset rights are unresolved." };
  if (scope === "public_report" && license.redistributionPolicy !== "public" && license.redistributionPolicy !== "aggregate_only") return { allowed: false, reason: "Public reporting is disallowed by redistribution policy." };
  return { allowed: true, reason: "Declared license policy permits this scope." };
}

export interface HoldoutAccessEvent { eventId: string; actorId: string; partition: "hiddenHoldout"; purpose: string; at: string; packageIds: string[]; outcome: "allowed" | "denied" }

export function holdoutAccessEvent(input: Omit<HoldoutAccessEvent, "eventId">): HoldoutAccessEvent {
  return { ...input, eventId: `holdout-access:${benchmarkDigest(input).slice(7, 39)}` };
}
