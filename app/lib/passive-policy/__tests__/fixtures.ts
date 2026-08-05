import { buildPassiveComponentSnapshot, buildPassiveDependencySnapshot, passiveFact } from "../adapters";
import { normalizePassivePackageIdentity } from "../package-profile";
import { withPolicyDigest, withProfileDigest } from "../stable";
import { parsePassiveValue } from "../value";
import { MANDATORY_EXCLUSION_VERSION } from "../policy";
import { PASSIVE_EVALUATION_REQUEST_VERSION, PASSIVE_POLICY_EVALUATOR_VERSION, PASSIVE_POLICY_RULE_LANGUAGE_VERSION, PASSIVE_POLICY_SCHEMA_VERSION, PASSIVE_PROFILE_SCHEMA_VERSION, type AssemblyProfileSnapshot, type PassiveClass, type PassiveComponentSnapshot, type PassivePackageProfile, type PassivePackageRule, type PassivePolicyContext, type PassivePolicyMode, type PassiveRole, type ProjectPassivePackagePolicy } from "../types";

export const NOW = "2026-07-19T16:00:00.000Z";
export const ADMIN = { actorId: "admin-1", actorKind: "human" as const, sessionId: "passive-session", role: "project_admin" as const };
export const REVIEWER = { actorId: "reviewer-1", actorKind: "human" as const, sessionId: "review-session", role: "reviewer" as const };
export const AI = { actorId: "ai-1", actorKind: "ai" as const, sessionId: "ai-session", role: "automation" as const };

export const ASSEMBLY: AssemblyProfileSnapshot = { assemblyProfileId: "assembly-standard", revisionId: "assembly-standard:r1", state: "approved", allowedMountingTechnologies: ["smd"], minimumChipLengthUm: 1_000, process: "reflow", dependencyDigest: "assembly-digest-r1" };

export function profileFixture(input: { profileId?: string; revisionId?: string; packageName?: string; classes?: PassiveClass[]; staleMapping?: boolean } = {}): PassivePackageProfile {
  const profileId = input.profileId ?? "profile-chip-0603", revisionId = input.revisionId ?? `${profileId}:r1`, normalized = normalizePassivePackageIdentity(input.packageName ?? "0603 imperial / 1608 metric"), contentDigest = `sha256:${"a".repeat(64)}`;
  return withProfileDigest({
    profileSchemaVersion: PASSIVE_PROFILE_SCHEMA_VERSION,
    profileId,
    revisionId,
    revision: 1,
    displayName: `${normalized.imperialCode} imperial / ${normalized.metricCode} metric chip`,
    normalizedPackageIdentity: normalized,
    mountingTechnology: "smd",
    exactPackageIdentity: { packageIdentityId: normalized.canonicalId, packageRevisionId: `${normalized.canonicalId}:r1`, identitySystem: "metric_imperial_explicit", canonicalName: `${normalized.imperialCode} imperial / ${normalized.metricCode} metric`, sourceToken: `${normalized.imperialCode} imperial`, mountingTechnology: "smd", pinCount: 2, bodyWidthNm: normalized.widthUm * 1_000, bodyLengthNm: normalized.lengthUm * 1_000, exposedPad: "absent", evidenceRefs: ["profile-package-evidence"] },
    exactFootprintAssetIdentity: { logicalAssetId: `${profileId}:footprint`, assetVersionId: `${profileId}:footprint:r1`, contentDigest, semanticDigest: `sha256:${"b".repeat(64)}`, sourceNamespace: "atomic_catalog", sourceRevision: "atomic-r1", libraryNickname: "Sirkit_Qualified_Passives", footprintName: `Chip_${normalized.imperialCode}_${normalized.metricCode}`, availability: "available", validationState: "valid", packageCompatibility: "compatible", padIdentifiers: ["1", "2"], duplicatePadIdentifiers: [], electricalPadCount: 2, mechanicalPadCount: 0, geometry: { hasCourtyard: true, hasFabrication: true, hasSolderMaskDefinition: true, hasPasteDefinition: true, hasDrillDefinition: false, manufacturingValidated: false }, evidenceRefs: ["profile-footprint-evidence"] },
    stage4MappingProfileRef: { state: "verified", mappingCertificateId: `${profileId}:mapping-certificate`, symbolAssetVersionId: "generic-passive-symbol:r1", footprintAssetVersionId: `${profileId}:footprint:r1`, footprintContentDigest: contentDigest, verifierVersion: "sirkit.mapping-verifier/4.0.0", verificationTier: "package_family", mappingRevisionId: `${profileId}:mapping:r1`, mappingContentDigest: `${profileId}:mapping-content`, mappingDependencyDigest: `${profileId}:mapping-dependency`, verificationResultDigest: `${profileId}:mapping-result`, mappingApprovalState: "approved", mappingFreshnessState: input.staleMapping ? "stale" : "current", mappingConflictState: "none", mappingLifecycleState: "active", approvalDecisionId: `${profileId}:mapping-approval`, verifiedAt: NOW, evidenceRefs: ["profile-mapping-evidence"], reasonCodes: [] },
    supportedPassiveClasses: input.classes ?? ["capacitor", "resistor"],
    feasibilityEnvelope: { numericRanges: [], allowedTechnologies: ["mlcc", "thick_film"], forbiddenRiskFlags: ["high_voltage", "high_power", "pulse", "surge", "current_sense", "rf", "timing_critical"], notes: ["Conservative ordinary passive qualification fixture."] },
    assemblyProfileIds: [ASSEMBLY.assemblyProfileId],
    sourceEvidenceRefs: ["profile-source-evidence"],
    approvalState: "approved",
    technicalState: "valid",
    freshnessState: "current",
    lifecycleState: "active",
    dependencyDigests: ["profile-dependency-r1"],
  });
}

export function ruleFixture(profile: PassivePackageProfile, input: { ruleId?: string; passiveClass?: PassiveClass; roles?: PassiveRole[]; priority?: number; specificity?: 1 | 2 | 3 | 4 | 5; requiredKnownFacts?: PassivePackageRule["matcher"]["requiredKnownFacts"]; permittedUnknownFacts?: PassivePackageRule["permittedUnknownFacts"] } = {}): PassivePackageRule {
  const passiveClass = input.passiveClass ?? "capacitor", roles = input.roles ?? ["decoupling", "bypass", "generic"], requiredKnownFacts = input.requiredKnownFacts ?? (passiveClass === "capacitor" ? ["capacitance", "working_voltage"] : ["resistance", "power"]);
  const matcher = { passiveClasses: [passiveClass], subclasses: [], roles, assemblyVariantIds: ["variant-default"], voltageDomainIds: [], approvedTags: [], numericConstraints: [], requiredKnownFacts, factEquals: [], maximumTerms: 1 + roles.length + 1 + requiredKnownFacts.length };
  return { ruleId: input.ruleId ?? `ordinary-${passiveClass}`, revision: 1, enabled: true, title: `Ordinary ${passiveClass} package rule`, description: "Assign the approved conservative passive package profile after every typed fact and exclusion gate passes.", action: "assign_package_profile", matcher, permittedUnknownFacts: input.permittedUnknownFacts ?? [], forbiddenRiskFlags: ["high_voltage", "high_power", "pulse", "surge", "current_sense", "precision", "rf", "timing_critical"], targetProfileId: profile.profileId, targetProfileRevisionId: profile.revisionId, specificity: input.specificity ?? 3, priority: input.priority ?? 100, issueCode: "PP_RULE_ORDINARY_PASSIVE", evidenceRefs: ["rule-evidence"], dependencyDigests: [profile.profileDigest], authoredBy: ADMIN };
}

export function policyFixture(input: { mode?: PassivePolicyMode; profile?: PassivePackageProfile; rules?: PassivePackageRule[]; lifecycle?: ProjectPassivePackagePolicy["lifecycleState"]; approval?: ProjectPassivePackagePolicy["approvalState"]; revision?: number } = {}): ProjectPassivePackagePolicy {
  const profile = input.profile ?? profileFixture(), mode = input.mode ?? "characterized_generic", lifecycle = input.lifecycle ?? "published", approval = input.approval ?? (lifecycle === "published" || lifecycle === "approved" ? "approved" : "unreviewed"), revision = input.revision ?? 1;
  return withPolicyDigest({ policySchemaVersion: PASSIVE_POLICY_SCHEMA_VERSION, ruleLanguageVersion: PASSIVE_POLICY_RULE_LANGUAGE_VERSION, evaluatorVersion: PASSIVE_POLICY_EVALUATOR_VERSION, policyId: "project-passive-policy", revisionId: `project-passive-policy:r${revision}`, revision, tenantId: "tenant-1", projectId: "project-1", branchId: "main", assemblyVariantIds: ["variant-default"], lifecycleState: lifecycle, approvalState: approval, evaluationMode: mode, layoutReservationEnabled: mode === "layout_reservation", rules: input.rules ?? [ruleFixture(profile)], globalExclusions: [], componentExceptions: [], assemblyProfileRef: { assemblyProfileId: ASSEMBLY.assemblyProfileId, revisionId: ASSEMBLY.revisionId, dependencyDigest: ASSEMBLY.dependencyDigest }, systemExclusionPolicyVersion: MANDATORY_EXCLUSION_VERSION, policyOwner: ADMIN, evidenceRefs: ["policy-evidence"], createdAt: NOW, ...(lifecycle === "published" ? { publishedAt: NOW } : {}), dependencyDigests: [profile.profileDigest] });
}

export function componentFixture(input: { componentId?: string; hierarchyPath?: string[]; passiveClass?: PassiveClass; roles?: PassiveRole[]; polarity?: "polarized" | "nonpolar" | "unknown"; workingVoltageState?: "exact" | "unknown" | "conflicting" | "stale"; riskFlags?: PassiveComponentSnapshot["riskFlags"]; exactBinding?: PassiveComponentSnapshot["exactBinding"]; exactPartCompatibleProfileIds?: string[] } = {}): PassiveComponentSnapshot {
  const componentId = input.componentId ?? "C1", passiveClass = input.passiveClass ?? "capacitor", roles = input.roles ?? (passiveClass === "resistor" ? ["pull_up"] : ["decoupling"]), polarity = input.polarity ?? "nonpolar", workingState = input.workingVoltageState ?? "exact";
  const factInput = { sourceRefs: ["authoritative-electrical-model"], evidenceRefs: ["approved-design-intent"], observedAt: NOW };
  const facts = passiveClass === "resistor" ? { resistance: passiveFact("resistance", "exact", parsePassiveValue("10k", "resistance"), factInput), power: passiveFact("power", "exact", parsePassiveValue("0.1W", "power"), factInput) } : { capacitance: passiveFact("capacitance", "exact", parsePassiveValue("100nF", "capacitance"), factInput), working_voltage: passiveFact("working_voltage", workingState, workingState === "exact" || workingState === "stale" ? parsePassiveValue("16V", "voltage") : undefined, factInput) };
  return buildPassiveComponentSnapshot({ scope: { tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardInstanceId: "board-1", componentInstanceId: componentId, hierarchyPath: input.hierarchyPath ?? ["root"], assemblyVariantId: "variant-default" }, componentRevisionId: `${componentId}:r1`, populationState: "populated", passiveClass: passiveFact("class", "exact", passiveClass, factInput), subclass: passiveFact("subclass", "exact", passiveClass === "capacitor" ? "mlcc" : "chip_resistor", factInput), applicationRoles: passiveFact("role", "exact", roles, factInput), technology: passiveFact("technology", "exact", passiveClass === "capacitor" ? "mlcc" : "thick_film", factInput), polarity: passiveFact("polarity", "exact", polarity, factInput), facts, riskFlags: input.riskFlags ?? {}, approvedTags: [], voltageDomainIds: ["logic-3v3"], ...(input.exactBinding ? { exactBinding: input.exactBinding } : {}), exactPartCompatibleProfileIds: input.exactPartCompatibleProfileIds ?? [], evidenceRefs: ["component-evidence"] });
}

export function contextFixture(input: { component?: PassiveComponentSnapshot; policy?: ProjectPassivePackagePolicy; profiles?: PassivePackageProfile[]; overlap?: string[]; purpose?: "preview" | "stage2_resolution" | "migration_analysis" } = {}): PassivePolicyContext {
  const component = input.component ?? componentFixture(), policy = input.policy === undefined ? policyFixture() : input.policy, profiles = input.profiles ?? [profileFixture()];
  const request = { requestSchemaVersion: PASSIVE_EVALUATION_REQUEST_VERSION, requestId: `evaluate-${component.scope.componentInstanceId}`, tenantId: component.scope.tenantId, projectId: component.scope.projectId, branchId: component.scope.branchId, componentInstanceId: component.scope.componentInstanceId, assemblyVariantId: component.scope.assemblyVariantId, ...(policy ? { policyRevisionId: policy.revisionId } : {}), purpose: input.purpose ?? "preview", actorContext: ADMIN, requestedAt: NOW };
  const dependencySnapshot = buildPassiveDependencySnapshot({ component, ...(policy ? { policy } : {}), profiles, assemblyProfile: ASSEMBLY });
  return { request, component, ...(policy ? { policy } : {}), profiles, assemblyProfile: ASSEMBLY, overlappingPublishedPolicyIds: input.overlap ?? (policy ? [policy.policyId] : []), dependencySnapshot };
}
