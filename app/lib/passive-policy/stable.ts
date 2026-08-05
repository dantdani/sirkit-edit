import { createHash } from "node:crypto";
import { PASSIVE_POLICY_CANONICAL_VERSION, type PassivePackageProfile, type PassivePolicyEvaluationResult, type PassivePolicyRecord, type ProjectPassivePackagePolicy } from "./types";

const SET_KEYS = new Set(["assemblyVariantIds", "passiveClasses", "subclasses", "roles", "voltageDomainIds", "approvedTags", "requiredKnownFacts", "permittedUnknownFacts", "forbiddenRiskFlags", "evidenceRefs", "sourceEvidenceRefs", "dependencyDigests", "supportedPassiveClasses", "assemblyProfileIds", "allowedTechnologies", "acceptedAliases", "selectedRuleIds", "known", "unknown", "conflicting", "stale", "permittedUnknown", "factRefs", "profileRefs", "ruleIds", "affectedComponentIds", "stage2DependencyKeys"]);

function canonical(value: unknown, key?: string): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("PP_NON_FINITE_NUMBER"); return Object.is(value, -0) ? 0 : value; }
  if (Array.isArray(value)) {
    const items = value.map((item) => canonical(item));
    return key && SET_KEYS.has(key) ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items;
  }
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([childKey, child]) => [childKey, canonical(child, childKey)]));
  return value;
}

export function passivePolicyCanonicalJson(value: unknown): string { return JSON.stringify(canonical({ canonicalVersion: PASSIVE_POLICY_CANONICAL_VERSION, value })); }
export function passivePolicyDigest(value: unknown): string { return `pp1-${createHash("sha256").update(passivePolicyCanonicalJson(value)).digest("hex")}`; }
export function passivePolicyId(kind: string, value: unknown): string { return `${kind}:${passivePolicyDigest(value).slice(4, 36)}`; }

export function profileTechnicalPayload(profile: Omit<PassivePackageProfile, "profileDigest"> | PassivePackageProfile): unknown {
  const { profileDigest: _digest, displayName: _display, ...technical } = profile as PassivePackageProfile; void _digest; void _display;
  return technical;
}
export function withProfileDigest(profile: Omit<PassivePackageProfile, "profileDigest">): PassivePackageProfile { return { ...profile, profileDigest: passivePolicyDigest(profileTechnicalPayload(profile as PassivePackageProfile)) }; }

export function policyTechnicalPayload(policy: Omit<ProjectPassivePackagePolicy, "technicalDigest"> | ProjectPassivePackagePolicy): unknown {
  const { technicalDigest: _digest, createdAt: _created, publishedAt: _published, policyOwner: _owner, lifecycleState: _lifecycle, approvalState: _approval, ...technical } = policy as ProjectPassivePackagePolicy; void _digest; void _created; void _published; void _owner; void _lifecycle; void _approval;
  return { ...technical, rules: [...technical.rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId)), globalExclusions: [...technical.globalExclusions].sort((a, b) => a.exclusionId.localeCompare(b.exclusionId)), componentExceptions: [...technical.componentExceptions].sort((a, b) => a.exceptionId.localeCompare(b.exceptionId)) };
}
export function withPolicyDigest(policy: Omit<ProjectPassivePackagePolicy, "technicalDigest">): ProjectPassivePackagePolicy { return { ...policy, technicalDigest: passivePolicyDigest(policyTechnicalPayload(policy as ProjectPassivePackagePolicy)) }; }
export function assertPolicyDigest(policy: ProjectPassivePackagePolicy): void { if (passivePolicyDigest(policyTechnicalPayload(policy)) !== policy.technicalDigest) throw new Error("PP_POLICY_DIGEST_MISMATCH"); }
export function assertProfileDigest(profile: PassivePackageProfile): void { if (passivePolicyDigest(profileTechnicalPayload(profile)) !== profile.profileDigest) throw new Error("PP_PROFILE_DIGEST_MISMATCH"); }

export function evaluationTechnicalPayload(result: Omit<PassivePolicyEvaluationResult, "evaluationId" | "resultDigest" | "evaluatedAt">): unknown {
  return { ...result, trace: result.trace.map((item) => { const step = { ...item } as Partial<typeof item>; delete step.ordinal; return step; }) };
}

export function withRecordDigest(record: Omit<PassivePolicyRecord, "recordDigest">): PassivePolicyRecord { return { ...record, recordDigest: passivePolicyDigest(record) }; }
export function deepFreezePassive<T>(value: T): Readonly<T> { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreezePassive(child); } return value; }
