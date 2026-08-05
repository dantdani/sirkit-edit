import { physicalBindingDigest, physicalBindingId } from "./stable";
import {
  PHYSICAL_BINDING_POLICY_VERSION,
  PHYSICAL_READINESS_SCHEMA_VERSION,
  type ComponentPhysicalBinding,
  type PhysicalReadinessAssessment,
  type PhysicalReadinessGateResult,
  type PhysicalReadinessPolicy,
  type PhysicalReadinessState,
  type ReadinessGateStatus,
  type ReadinessRemediationCategory,
} from "./types";

export const DEFAULT_PHYSICAL_READINESS_POLICY: PhysicalReadinessPolicy = {
  policyVersion: PHYSICAL_BINDING_POLICY_VERSION,
  requireExactPartForLayout: false,
  requireSupplyEvidenceForManufacturing: false,
  requireExternalStageRefsForManufacturing: true,
};

export const PHYSICAL_READINESS_GATE_CODES = [
  "PB_COMPONENT_IDENTITY", "PB_APPLICABILITY", "PB_PACKAGE_IDENTITY", "PB_FOOTPRINT_ASSET", "PB_FOOTPRINT_DIGEST",
  "PB_ASSET_AVAILABILITY", "PB_PACKAGE_COMPATIBILITY", "PB_PIN_PAD_MAPPING", "PB_EFFECTIVE_SELECTION", "PB_APPROVAL",
  "PB_TECHNICAL_VALIDATION", "PB_FRESHNESS", "PB_CONFLICT", "PB_LIFECYCLE", "PB_VARIANT_SCOPE", "PB_EVIDENCE",
  "PB_EXACT_PART", "PB_MANUFACTURER_IDENTITY", "PB_EXACT_PART_PACKAGE", "PB_ELECTRICAL_CONSTRAINTS", "PB_ASSEMBLY_DATA",
  "PB_MANUFACTURING_GEOMETRY", "PB_EXACT_PART_FOOTPRINT", "PB_MANUFACTURING_EVIDENCE", "PB_SUPPLY_EVIDENCE", "PB_EXTERNAL_PREREQUISITES",
] as const;

function gate(code: typeof PHYSICAL_READINESS_GATE_CODES[number], status: ReadinessGateStatus, message: string, recordPath: string, category: ReadinessRemediationCategory, blocking: boolean, evidenceRefs: string[] = []): PhysicalReadinessGateResult {
  return { code, status, message, recordPath, remediationCategory: category, severity: blocking ? "blocking" : status === "pass" || status === "not_applicable" ? "info" : "warning", blocking, evidenceRefs: [...new Set(evidenceRefs)].sort() };
}

const pass = (code: typeof PHYSICAL_READINESS_GATE_CODES[number], message: string, path: string, category: ReadinessRemediationCategory, evidence: string[] = []) => gate(code, "pass", message, path, category, false, evidence);
const fail = (code: typeof PHYSICAL_READINESS_GATE_CODES[number], message: string, path: string, category: ReadinessRemediationCategory, status: ReadinessGateStatus = "fail", evidence: string[] = []) => gate(code, status, message, path, category, true, evidence);

export function evaluatePhysicalReadiness(binding: ComponentPhysicalBinding, input: { policy?: PhysicalReadinessPolicy; assessedAt: string; effectiveSelectedRevisionId?: string; brokenEvidenceRefs?: string[] } ): PhysicalReadinessAssessment {
  const policy = input.policy ?? DEFAULT_PHYSICAL_READINESS_POLICY;
  const gates: PhysicalReadinessGateResult[] = [];
  const identityOk = binding.componentIdentity.componentInstanceId === binding.scope.componentInstanceId && binding.componentIdentity.projectId === binding.scope.projectId && binding.componentIdentity.branchId === binding.scope.branchId;
  gates.push(identityOk ? pass("PB_COMPONENT_IDENTITY", "Stable component identity matches project scope.", "componentIdentity", "identity") : fail("PB_COMPONENT_IDENTITY", "Stable component identity is missing or does not match scope.", "componentIdentity", "identity"));

  if (binding.applicabilityState === "not_applicable") {
    gates.push(gate("PB_APPLICABILITY", "not_applicable", "Component is explicitly not populated/applicable in this variant.", "applicabilityState", "classification", false));
  } else gates.push(binding.applicabilityState === "applicable" ? pass("PB_APPLICABILITY", "Component is applicable in this variant.", "applicabilityState", "classification") : fail("PB_APPLICABILITY", "Physical applicability is unknown.", "applicabilityState", "classification", "unknown"));

  const packageOk = Boolean(binding.package?.packageIdentityId && binding.package.packageRevisionId && binding.package.identitySystem);
  gates.push(packageOk ? pass("PB_PACKAGE_IDENTITY", "Package has an explicit revisioned identity.", "package", "package", binding.package!.evidenceRefs) : fail("PB_PACKAGE_IDENTITY", "Package identity is missing or ambiguous.", "package", "package", binding.package ? "fail" : "unknown"));
  gates.push(binding.footprint ? pass("PB_FOOTPRINT_ASSET", "Exact footprint asset locator is present.", "footprint", "asset", binding.footprint.evidenceRefs) : fail("PB_FOOTPRINT_ASSET", "Exact footprint asset is missing.", "footprint", "asset"));
  gates.push(binding.footprint?.contentDigest ? pass("PB_FOOTPRINT_DIGEST", "Footprint content digest is pinned.", "footprint.contentDigest", "asset") : fail("PB_FOOTPRINT_DIGEST", "Footprint content digest is missing.", "footprint.contentDigest", "asset", "unknown"));
  gates.push(binding.footprint?.availability === "available" ? pass("PB_ASSET_AVAILABILITY", "Footprint source asset is available.", "footprint.availability", "asset") : fail("PB_ASSET_AVAILABILITY", `Footprint asset is ${binding.footprint?.availability ?? "missing"}.`, "footprint.availability", "asset", binding.footprint?.availability === "unresolved" ? "unknown" : "fail"));
  gates.push(binding.footprint?.packageCompatibility === "compatible" ? pass("PB_PACKAGE_COMPATIBILITY", "Package and footprint are explicitly compatible.", "footprint.packageCompatibility", "package") : fail("PB_PACKAGE_COMPATIBILITY", `Package/footprint compatibility is ${binding.footprint?.packageCompatibility ?? "unknown"}.`, "footprint.packageCompatibility", "package", binding.footprint?.packageCompatibility === "pending" ? "pending" : "fail"));

  const mapping = binding.pinPadMapping;
  const richStage4Current = mapping.verifierVersion !== "sirkit.mapping-verifier/4.0.0" || (Boolean(mapping.mappingRevisionId && mapping.mappingContentDigest && mapping.mappingDependencyDigest && mapping.verificationResultDigest) && mapping.mappingApprovalState === "approved" && mapping.mappingFreshnessState === "current" && mapping.mappingConflictState === "none" && mapping.mappingLifecycleState === "active" && mapping.verificationTier !== "limited_direct_pair");
  const mappingCurrent = mapping.state === "verified" && mapping.footprintAssetVersionId === binding.footprint?.assetVersionId && mapping.footprintContentDigest === binding.footprint?.contentDigest && Boolean(mapping.symbolAssetVersionId && mapping.verifierVersion && mapping.mappingCertificateId) && richStage4Current;
  gates.push(mappingCurrent ? pass("PB_PIN_PAD_MAPPING", "Version-bound pin-to-pad mapping is verified.", "pinPadMapping", "mapping", mapping.evidenceRefs) : fail("PB_PIN_PAD_MAPPING", `Pin-to-pad mapping is ${mapping.state}; Stage 4 verification is required.`, "pinPadMapping", "mapping", mapping.state === "pending" || mapping.state === "legacy_unverified" ? "pending" : mapping.state === "missing" ? "unknown" : "fail", mapping.evidenceRefs));
  gates.push(input.effectiveSelectedRevisionId === binding.revisionId && binding.lifecycleState === "selected" ? pass("PB_EFFECTIVE_SELECTION", "Binding is the effective selected candidate for this scope.", "lifecycleState", "lifecycle") : fail("PB_EFFECTIVE_SELECTION", "Binding is not the effective selected candidate.", "lifecycleState", "lifecycle"));
  const approvalCurrent = binding.approval.state === "approved" && binding.approval.contentDigest === binding.technicalDigest && (!binding.approval.expiresAt || Date.parse(binding.approval.expiresAt) > Date.parse(input.assessedAt));
  gates.push(approvalCurrent ? pass("PB_APPROVAL", "Approval is current and scoped to this technical digest.", "approval", "approval") : fail("PB_APPROVAL", `Approval is ${binding.approval.state} or stale for this digest.`, "approval", "approval", binding.approval.state === "pending" || binding.approval.state === "unreviewed" ? "pending" : "fail"));
  const validationCurrent = binding.technicalValidation.state === "valid" && binding.technicalValidation.validatedDigest === binding.technicalDigest;
  gates.push(validationCurrent ? pass("PB_TECHNICAL_VALIDATION", "Technical validation is current for this digest.", "technicalValidation", "validation", binding.technicalValidation.evidenceRefs) : fail("PB_TECHNICAL_VALIDATION", `Technical validation is ${binding.technicalValidation.state} or stale.`, "technicalValidation", "validation", binding.technicalValidation.state === "pending" ? "pending" : "fail", binding.technicalValidation.evidenceRefs));
  gates.push(binding.freshness.state === "current" ? pass("PB_FRESHNESS", "All material dependencies are current.", "freshness", "freshness") : fail("PB_FRESHNESS", `Dependency freshness is ${binding.freshness.state}.`, "freshness", "freshness", binding.freshness.state === "unknown" ? "unknown" : "fail"));
  gates.push(binding.conflict.state === "none" ? pass("PB_CONFLICT", "No binding conflict is present.", "conflict", "conflict") : fail("PB_CONFLICT", "Binding has unresolved conflicts.", "conflict", "conflict"));
  gates.push(binding.lifecycleState === "selected" ? pass("PB_LIFECYCLE", "Lifecycle state permits use.", "lifecycleState", "lifecycle") : fail("PB_LIFECYCLE", `Lifecycle state ${binding.lifecycleState} is not usable.`, "lifecycleState", "lifecycle"));
  const scopeUnique = new Set(binding.scope.assemblyVariantIds).size === binding.scope.assemblyVariantIds.length;
  gates.push(scopeUnique ? pass("PB_VARIANT_SCOPE", "Assembly-variant scope is explicit and non-overlapping within the record.", "scope.assemblyVariantIds", "variant") : fail("PB_VARIANT_SCOPE", "Assembly-variant scope is invalid.", "scope.assemblyVariantIds", "variant"));
  const broken = input.brokenEvidenceRefs ?? [];
  gates.push(binding.evidenceRefs.length > 0 && broken.length === 0 ? pass("PB_EVIDENCE", "Binding evidence references are present and resolvable.", "evidenceRefs", "evidence", binding.evidenceRefs) : fail("PB_EVIDENCE", broken.length ? "Binding contains broken evidence references." : "Binding has no supporting evidence reference.", "evidenceRefs", "evidence", binding.evidenceRefs.length ? "fail" : "unknown", binding.evidenceRefs));

  gates.push(binding.exactPart ? pass("PB_EXACT_PART", "Exact manufacturer part is bound.", "exactPart", "part", binding.exactPart.evidenceRefs) : fail("PB_EXACT_PART", "Exact manufacturer part is absent.", "exactPart", "part", "unknown"));
  gates.push(binding.exactPart?.manufacturerId ? pass("PB_MANUFACTURER_IDENTITY", "Manufacturer identity is resolved.", "exactPart.manufacturerId", "part") : fail("PB_MANUFACTURER_IDENTITY", "Manufacturer identity is absent or unresolved.", "exactPart.manufacturerId", "part", "unknown"));
  gates.push(binding.exactPart && binding.package?.exactPartId === binding.exactPart.exactPartId ? pass("PB_EXACT_PART_PACKAGE", "Package revision is tied to the exact part.", "package.exactPartId", "manufacturing") : fail("PB_EXACT_PART_PACKAGE", "Package revision is not tied to the exact part.", "package.exactPartId", "manufacturing", "unknown"));
  gates.push(binding.dependencies.electricalConstraintValidationRef ? pass("PB_ELECTRICAL_CONSTRAINTS", "Electrical constraints have a validation reference.", "dependencies.electricalConstraintValidationRef", "manufacturing") : fail("PB_ELECTRICAL_CONSTRAINTS", "Electrical constraints are not validated for manufacturing.", "dependencies.electricalConstraintValidationRef", "manufacturing", "unknown"));
  gates.push(binding.dependencies.assemblyDataRef ? pass("PB_ASSEMBLY_DATA", "Assembly data is linked.", "dependencies.assemblyDataRef", "manufacturing") : fail("PB_ASSEMBLY_DATA", "Assembly data is incomplete.", "dependencies.assemblyDataRef", "manufacturing", "unknown"));
  gates.push(binding.footprint?.geometry.manufacturingValidated ? pass("PB_MANUFACTURING_GEOMETRY", "Manufacturing-critical footprint geometry is validated.", "footprint.geometry", "manufacturing") : fail("PB_MANUFACTURING_GEOMETRY", "Manufacturing-critical footprint geometry is not validated.", "footprint.geometry", "manufacturing", "pending"));
  gates.push(binding.dependencies.exactPartFootprintCompatibility === "compatible" ? pass("PB_EXACT_PART_FOOTPRINT", "Exact part and footprint compatibility is proven.", "dependencies.exactPartFootprintCompatibility", "manufacturing") : fail("PB_EXACT_PART_FOOTPRINT", `Exact-part/footprint compatibility is ${binding.dependencies.exactPartFootprintCompatibility}.`, "dependencies.exactPartFootprintCompatibility", "manufacturing", binding.dependencies.exactPartFootprintCompatibility === "pending" ? "pending" : "fail"));
  gates.push(binding.dependencies.manufacturingEvidenceRefs.length ? pass("PB_MANUFACTURING_EVIDENCE", "Manufacturing evidence is linked.", "dependencies.manufacturingEvidenceRefs", "manufacturing", binding.dependencies.manufacturingEvidenceRefs) : fail("PB_MANUFACTURING_EVIDENCE", "Manufacturing evidence is absent.", "dependencies.manufacturingEvidenceRefs", "manufacturing", "unknown"));
  gates.push(!policy.requireSupplyEvidenceForManufacturing || binding.dependencies.supplyEvidenceRefs.length ? pass("PB_SUPPLY_EVIDENCE", policy.requireSupplyEvidenceForManufacturing ? "Required supply evidence is linked." : "Supply evidence is not required by this profile.", "dependencies.supplyEvidenceRefs", "manufacturing", binding.dependencies.supplyEvidenceRefs) : fail("PB_SUPPLY_EVIDENCE", "Supply evidence required by the profile is absent.", "dependencies.supplyEvidenceRefs", "manufacturing", "unknown"));
  gates.push(!policy.requireExternalStageRefsForManufacturing || binding.dependencies.externalValidationRefs.length ? pass("PB_EXTERNAL_PREREQUISITES", policy.requireExternalStageRefsForManufacturing ? "External prerequisite results are linked." : "External prerequisite results are not required by this profile.", "dependencies.externalValidationRefs", "manufacturing", binding.dependencies.externalValidationRefs) : fail("PB_EXTERNAL_PREREQUISITES", "Required external prerequisite stage results are unavailable.", "dependencies.externalValidationRefs", "manufacturing", "unknown"));

  const layoutCodes = new Set(PHYSICAL_READINESS_GATE_CODES.slice(0, 16));
  if (policy.requireExactPartForLayout) layoutCodes.add("PB_EXACT_PART");
  const applicabilityNotApplicable = binding.applicabilityState === "not_applicable";
  const layout: PhysicalReadinessState = applicabilityNotApplicable ? "not_applicable" : gates.some((result) => layoutCodes.has(result.code as typeof PHYSICAL_READINESS_GATE_CODES[number]) && result.blocking) ? "not_ready" : "ready";
  const manufacturing: PhysicalReadinessState = applicabilityNotApplicable ? "not_applicable" : layout !== "ready" || gates.some((result) => result.blocking) ? "not_ready" : "ready";
  const base = {
    schemaVersion: PHYSICAL_READINESS_SCHEMA_VERSION,
    assessmentId: physicalBindingId("physical-readiness", { binding: binding.recordDigest, policy: policy.policyVersion, assessedAt: input.assessedAt }),
    bindingRevisionId: binding.revisionId,
    bindingRecordDigest: binding.recordDigest,
    policyVersion: policy.policyVersion,
    layout,
    manufacturing,
    gates,
    assessedAt: input.assessedAt,
    claims: { certifiesManufacturability: false as const, certifiesAvailability: false as const, authorizesProductionRelease: false as const, predictsFirstPassHardware: false as const },
  };
  return { ...base, assessmentDigest: physicalBindingDigest(base) };
}
