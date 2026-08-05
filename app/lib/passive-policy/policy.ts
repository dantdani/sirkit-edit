import { assertPolicyDigest, passivePolicyDigest, passivePolicyId } from "./stable";
import { PASSIVE_EXCEPTION_CONTRACT_VERSION, PASSIVE_POLICY_EVALUATOR_VERSION, PASSIVE_POLICY_RULE_LANGUAGE_VERSION, PASSIVE_POLICY_SCHEMA_VERSION, type PassiveComponentException, type PassiveFactKey, type PassivePackageRule, type PassivePolicyDependencySnapshot, type ProjectPassivePackagePolicy, type RevisionCompletePassiveComponentException } from "./types";

export const PASSIVE_POLICY_LIMITS = Object.freeze({ maxRules: 256, maxExclusions: 128, maxExceptions: 2_048, maxProfiles: 128, maxMatcherTerms: 64, maxPreviewComponents: 4_096, maxTraceSteps: 4_096, maxResultBytes: 8_000_000, timeoutMs: 5_000, lockTimeoutMs: 2_000 });
export const MANDATORY_EXCLUSION_VERSION = "sirkit.passive-mandatory-exclusions/1.0.0" as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/;
const ISSUE = /^PP_[A-Z0-9_]{2,96}$/;
const SUPPORTED_FACTS = new Set<PassiveFactKey>(["value", "resistance", "capacitance", "inductance", "impedance", "tolerance", "working_voltage", "transient_voltage", "power", "current", "temperature", "temperature_coefficient", "dielectric", "technology", "polarity", "esr", "dcr", "frequency", "pulse", "surge", "safety_rating", "dc_bias", "ripple_current", "role", "class", "subclass"]);

export function passiveExceptionDecisionPayload(exception: PassiveComponentException): unknown {
  const { decisionId: _decisionId, approvalDigest: _approvalDigest, ...technical } = exception;
  void _decisionId; void _approvalDigest;
  return technical;
}

export function withPassiveExceptionDecisionIntegrity<T extends PassiveComponentException>(exception: T): T & { decisionId: string; approvalDigest: string } {
  const approvalDigest = passivePolicyDigest(passiveExceptionDecisionPayload(exception));
  return { ...exception, approvalDigest, decisionId: passivePolicyId("passive-exception-decision", approvalDigest) };
}

export function passiveExceptionContextDigest(snapshot: PassivePolicyDependencySnapshot, approvedPolicyDigest: string): string {
  const { dependencyDigest: _dependencyDigest, ...base } = snapshot;
  void _dependencyDigest;
  return passivePolicyDigest({ ...base, policyDigest: approvedPolicyDigest });
}

function exceptionErrors(exception: PassiveComponentException): string[] {
  const errors: string[] = [], action = exception.action as string;
  if (!["opt_out", "require_exact_part", "assign_profile"].includes(action)) errors.push("PP_EXCEPTION_ACTION_UNSUPPORTED");
  if (!ID.test(exception.exceptionId) || !ID.test(exception.componentInstanceId) || !exception.reason.trim() || /[\u0000-\u001f\u007f<>]/.test(exception.reason) || !exception.assemblyVariantIds.length || new Set(exception.assemblyVariantIds).size !== exception.assemblyVariantIds.length || exception.assemblyVariantIds.some((item) => !ID.test(item))) errors.push("PP_EXCEPTION_INVALID");
  const mustBeComplete = exception.state === "approved" || exception.exceptionContractVersion === PASSIVE_EXCEPTION_CONTRACT_VERSION;
  if (!mustBeComplete) return errors;
  const authority = exception.authority;
  if (exception.exceptionContractVersion !== PASSIVE_EXCEPTION_CONTRACT_VERSION || !exception.decisionId || !Number.isInteger(exception.decisionRevision) || Number(exception.decisionRevision) < 1 || !exception.approvalDigest || !exception.mutationDigest || !exception.approvedAt || !Number.isFinite(Date.parse(exception.approvedAt)) || !exception.evidenceRefs.length || exception.evidenceRefs.some((item) => !ID.test(item)) || !authority) return [...errors, "PP_EXCEPTION_AUTHORITY_INCOMPLETE"];
  if (![authority.tenantId, authority.projectId, authority.branchId, authority.componentInstanceId, authority.policyId, authority.approvedAgainstPolicyRevisionId, authority.approvedAgainstPolicyDigest, authority.effectivePolicyRevisionId, authority.assemblyProfileId, authority.assemblyProfileRevisionId, authority.assemblyProfileDigest].every((item) => typeof item === "string" && ID.test(item)) || !Number.isInteger(authority.expectedPolicyRecordRevision) || authority.expectedPolicyRecordRevision < 1 || authority.componentInstanceId !== exception.componentInstanceId || authority.variants.length !== exception.assemblyVariantIds.length) errors.push("PP_EXCEPTION_AUTHORITY_INVALID");
  const variantIds = new Set(authority.variants.map((item) => item.assemblyVariantId));
  if (variantIds.size !== authority.variants.length || exception.assemblyVariantIds.some((item) => !variantIds.has(item)) || authority.variants.some((item) => ![item.assemblyVariantId, item.boardInstanceId, item.componentSnapshotId, item.componentRevisionId, item.componentDigest, item.stableComponentIdentityDigest, item.contextDependencyDigest].every((value) => ID.test(value)))) errors.push("PP_EXCEPTION_VARIANT_AUTHORITY_INVALID");
  if (action === "assign_profile") {
    const selection = exception.selection;
    if (selection?.kind !== "profile" || exception.targetProfileId !== selection.profileId || ![selection.profileId, selection.profileRevisionId, selection.profileDigest, selection.packageIdentityId, selection.packageRevisionId, selection.footprintLogicalAssetId, selection.footprintAssetVersionId, selection.footprintContentDigest, selection.mappingRevisionId, selection.mappingContentDigest, selection.mappingResultDigest].every((item) => ID.test(item))) errors.push("PP_EXCEPTION_PROFILE_AUTHORITY_INVALID");
  } else if (exception.selection?.kind !== "none" || exception.targetProfileId) errors.push("PP_EXCEPTION_SELECTION_FORBIDDEN");
  if (exception.approvalDigest !== passivePolicyDigest(passiveExceptionDecisionPayload(exception)) || exception.decisionId !== passivePolicyId("passive-exception-decision", exception.approvalDigest)) errors.push("PP_EXCEPTION_DECISION_DIGEST_MISMATCH");
  return errors;
}

export function isRevisionCompletePassiveException(exception: PassiveComponentException): exception is RevisionCompletePassiveComponentException { return exceptionErrors(exception).length === 0 && exception.exceptionContractVersion === PASSIVE_EXCEPTION_CONTRACT_VERSION; }

function ruleErrors(rule: PassivePackageRule, mode: ProjectPassivePackagePolicy["evaluationMode"]): string[] {
  const errors: string[] = [];
  if (!ID.test(rule.ruleId) || !Number.isInteger(rule.revision) || rule.revision < 1) errors.push("PP_RULE_ID_OR_REVISION_INVALID");
  if (!rule.title.trim() || rule.title.length > 160 || !rule.description.trim() || rule.description.length > 2_000 || /[\u0000-\u001f\u007f<>]/.test(`${rule.title}${rule.description}`)) errors.push("PP_RULE_TEXT_INVALID");
  if (!Number.isInteger(rule.priority) || rule.priority < 0 || rule.priority > 10_000 || ![1, 2, 3, 4, 5].includes(rule.specificity)) errors.push("PP_RULE_PRECEDENCE_INVALID");
  const terms = rule.matcher.passiveClasses.length + rule.matcher.subclasses.length + rule.matcher.roles.length + rule.matcher.assemblyVariantIds.length + rule.matcher.voltageDomainIds.length + rule.matcher.approvedTags.length + rule.matcher.numericConstraints.length + rule.matcher.requiredKnownFacts.length + rule.matcher.factEquals.length;
  if (rule.matcher.maximumTerms !== terms || terms < 1 || terms > PASSIVE_POLICY_LIMITS.maxMatcherTerms) errors.push("PP_RULE_MATCHER_COMPLEXITY_INVALID");
  if (rule.matcher.passiveClasses.length === 0 || rule.matcher.roles.length === 0) errors.push("PP_RULE_CLASS_ROLE_REQUIRED");
  if ([...rule.matcher.requiredKnownFacts, ...rule.permittedUnknownFacts].some((item) => !SUPPORTED_FACTS.has(item))) errors.push("PP_RULE_FACT_UNSUPPORTED");
  if (mode !== "layout_reservation" && rule.permittedUnknownFacts.length) errors.push("PP_RULE_PERMITTED_UNKNOWN_MODE_INVALID");
  if (rule.action === "assign_package_profile" && (!rule.targetProfileId || !rule.targetProfileRevisionId)) errors.push("PP_RULE_PROFILE_REQUIRED");
  if (rule.action !== "assign_package_profile" && (rule.targetProfileId || rule.targetProfileRevisionId)) errors.push("PP_RULE_PROFILE_FORBIDDEN");
  if (!ISSUE.test(rule.issueCode)) errors.push("PP_RULE_ISSUE_CODE_INVALID");
  for (const constraint of rule.matcher.numericConstraints) {
    if (!SUPPORTED_FACTS.has(constraint.fact) || [constraint.valueSI, constraint.minSI, constraint.maxSI].some((item) => item !== undefined && !Number.isFinite(item))) errors.push("PP_RULE_NUMERIC_CONSTRAINT_INVALID");
    if (constraint.operator === "between" && (constraint.minSI === undefined || constraint.maxSI === undefined || constraint.minSI > constraint.maxSI)) errors.push("PP_RULE_NUMERIC_RANGE_INVALID");
  }
  return errors;
}

export function validateProjectPassivePolicy(policy: ProjectPassivePackagePolicy): string[] {
  const errors: string[] = [];
  try { assertPolicyDigest(policy); } catch (error) { errors.push(error instanceof Error ? error.message : "PP_POLICY_DIGEST_INVALID"); }
  if (policy.policySchemaVersion !== PASSIVE_POLICY_SCHEMA_VERSION || policy.ruleLanguageVersion !== PASSIVE_POLICY_RULE_LANGUAGE_VERSION || policy.evaluatorVersion !== PASSIVE_POLICY_EVALUATOR_VERSION) errors.push("PP_POLICY_VERSION_UNSUPPORTED");
  if (![policy.policyId, policy.revisionId, policy.tenantId, policy.projectId, policy.branchId, policy.assemblyProfileRef.assemblyProfileId, policy.assemblyProfileRef.revisionId].every((item) => ID.test(item))) errors.push("PP_POLICY_ID_OR_SCOPE_INVALID");
  if (!Number.isInteger(policy.revision) || policy.revision < 1 || new Set(policy.assemblyVariantIds).size !== policy.assemblyVariantIds.length || policy.assemblyVariantIds.length === 0) errors.push("PP_POLICY_REVISION_OR_VARIANT_INVALID");
  if (policy.rules.length === 0 || policy.rules.length > PASSIVE_POLICY_LIMITS.maxRules || policy.globalExclusions.length > PASSIVE_POLICY_LIMITS.maxExclusions || policy.componentExceptions.length > PASSIVE_POLICY_LIMITS.maxExceptions) errors.push("PP_POLICY_COLLECTION_LIMIT_INVALID");
  if (new Set(policy.rules.map((item) => item.ruleId)).size !== policy.rules.length || new Set(policy.globalExclusions.map((item) => item.exclusionId)).size !== policy.globalExclusions.length || new Set(policy.componentExceptions.map((item) => item.exceptionId)).size !== policy.componentExceptions.length) errors.push("PP_POLICY_DUPLICATE_ID");
  if (policy.systemExclusionPolicyVersion !== MANDATORY_EXCLUSION_VERSION) errors.push("PP_POLICY_MANDATORY_EXCLUSION_VERSION_MISSING");
  if (policy.evaluationMode === "layout_reservation" && !policy.layoutReservationEnabled) errors.push("PP_POLICY_LAYOUT_RESERVATION_NOT_EXPLICITLY_ENABLED");
  if (policy.evaluationMode !== "layout_reservation" && policy.layoutReservationEnabled) errors.push("PP_POLICY_LAYOUT_RESERVATION_MODE_MISMATCH");
  for (const rule of policy.rules) errors.push(...ruleErrors(rule, policy.evaluationMode));
  for (const exclusion of policy.globalExclusions) {
    if (!ID.test(exclusion.exclusionId) || !ISSUE.test(exclusion.issueCode) || exclusion.matcher.maximumTerms > PASSIVE_POLICY_LIMITS.maxMatcherTerms) errors.push("PP_EXCLUSION_INVALID");
  }
  for (const exception of policy.componentExceptions) {
    errors.push(...exceptionErrors(exception));
  }
  const activeScopes = new Set<string>();
  for (const exception of policy.componentExceptions.filter((item) => item.state === "approved")) for (const variant of exception.assemblyVariantIds) { const key = `${exception.componentInstanceId}\0${variant}`; if (activeScopes.has(key)) errors.push("PP_EXCEPTION_ACTIVE_SCOPE_CONFLICT"); else activeScopes.add(key); }
  if (!Number.isFinite(Date.parse(policy.createdAt)) || (policy.publishedAt && !Number.isFinite(Date.parse(policy.publishedAt)))) errors.push("PP_POLICY_TIMESTAMP_INVALID");
  if (policy.approvalState === "approved" && !["approved", "published", "stale", "revoked", "superseded", "archived"].includes(policy.lifecycleState)) errors.push("PP_POLICY_APPROVAL_LIFECYCLE_INVALID");
  if (policy.lifecycleState === "published" && (policy.approvalState !== "approved" || !policy.publishedAt)) errors.push("PP_POLICY_PUBLISHED_STATE_INVALID");
  return [...new Set(errors)].sort();
}
