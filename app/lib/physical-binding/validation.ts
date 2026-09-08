import { physicalBindingDigest, scopeKey, withoutBindingDigests } from "./stable";
import {
  PHYSICAL_BINDING_SCHEMA_VERSION,
  type ComponentPhysicalBinding,
  type ComponentPhysicalBindingSet,
  type PackageBinding,
  type PhysicalBindingScope,
} from "./types";
import { compareCodePoints } from "@/app/lib/stable-compare";

export interface PhysicalBindingValidationIssue {
  code: string;
  path: string;
  message: string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/;
const DIGEST = /^(?:pb1-|sha256:|[a-f0-9]{64}$)/i;

function requiredString(value: unknown, path: string, issues: PhysicalBindingValidationIssue[], max = 512): void {
  if (typeof value !== "string" || !value.trim()) issues.push({ code: "PB_REQUIRED_STRING", path, message: `${path} must be a non-empty string.` });
  else if (value.length > max) issues.push({ code: "PB_STRING_TOO_LONG", path, message: `${path} exceeds ${max} characters.` });
  else if (/[\u0000-\u001f\u007f]/.test(value)) issues.push({ code: "PB_CONTROL_CHARACTER", path, message: `${path} contains a control character.` });
}

function id(value: unknown, path: string, issues: PhysicalBindingValidationIssue[]): void {
  requiredString(value, path, issues);
  if (typeof value === "string" && !ID.test(value)) issues.push({ code: "PB_IDENTIFIER_INVALID", path, message: `${path} is not a valid bounded identifier.` });
}

function unique(values: readonly string[], path: string, issues: PhysicalBindingValidationIssue[]): void {
  if (new Set(values).size !== values.length) issues.push({ code: "PB_DUPLICATE_ENTRY", path, message: `${path} contains duplicate entries.` });
}

export function validatePhysicalBindingScope(scope: PhysicalBindingScope): PhysicalBindingValidationIssue[] {
  const issues: PhysicalBindingValidationIssue[] = [];
  id(scope.tenantId, "scope.tenantId", issues);
  id(scope.projectId, "scope.projectId", issues);
  id(scope.branchId, "scope.branchId", issues);
  id(scope.boardInstanceId, "scope.boardInstanceId", issues);
  id(scope.componentInstanceId, "scope.componentInstanceId", issues);
  if (!Array.isArray(scope.hierarchyPath) || scope.hierarchyPath.length > 64) issues.push({ code: "PB_HIERARCHY_INVALID", path: "scope.hierarchyPath", message: "Hierarchy path must have at most 64 entries." });
  else scope.hierarchyPath.forEach((part, index) => id(part, `scope.hierarchyPath.${index}`, issues));
  if (!Array.isArray(scope.assemblyVariantIds) || scope.assemblyVariantIds.length > 128) issues.push({ code: "PB_VARIANT_SCOPE_INVALID", path: "scope.assemblyVariantIds", message: "Variant scope must have at most 128 entries." });
  else {
    scope.assemblyVariantIds.forEach((variant, index) => id(variant, `scope.assemblyVariantIds.${index}`, issues));
    unique(scope.assemblyVariantIds, "scope.assemblyVariantIds", issues);
  }
  return issues;
}

export function normalizePackageBinding(input: Omit<PackageBinding, "packageIdentityId"> & { packageIdentityId?: string }): PackageBinding {
  const token = input.sourceToken.normalize("NFC").trim();
  const name = input.canonicalName.normalize("NFC").trim();
  if (!token || !name) throw new Error("PB_PACKAGE_NAME_REQUIRED");
  if (/^0603$/i.test(token) && input.identitySystem !== "metric_imperial_explicit") throw new Error("PB_PACKAGE_ALIAS_AMBIGUOUS_0603");
  if (/^(?:0402|0805|1206|1210)$/i.test(token) && input.identitySystem !== "metric_imperial_explicit") throw new Error("PB_PACKAGE_ALIAS_AMBIGUOUS_IMPERIAL_METRIC");
  if (input.identitySystem === "metric_imperial_explicit" && !/(metric|imperial)/i.test(name)) throw new Error("PB_PACKAGE_UNIT_SYSTEM_REQUIRED");
  const packageIdentityId = input.packageIdentityId ?? `package:${physicalBindingDigest({ system: input.identitySystem, name, dimensions: { pitchNm: input.pitchNm, bodyWidthNm: input.bodyWidthNm, bodyLengthNm: input.bodyLengthNm }, pinCount: input.pinCount, exposedPad: input.exposedPad }).slice(4, 36)}`;
  return { ...input, packageIdentityId, canonicalName: name, sourceToken: token, evidenceRefs: [...new Set(input.evidenceRefs)].sort() };
}

export function validatePhysicalBinding(binding: ComponentPhysicalBinding): PhysicalBindingValidationIssue[] {
  const issues = validatePhysicalBindingScope(binding.scope);
  if (binding.schemaVersion !== PHYSICAL_BINDING_SCHEMA_VERSION) issues.push({ code: "PB_SCHEMA_UNSUPPORTED", path: "schemaVersion", message: "Unsupported physical binding schema version." });
  for (const [path, value] of [["bindingId", binding.bindingId], ["revisionId", binding.revisionId], ["lineageId", binding.lineageId]] as const) id(value, path, issues);
  if (!Number.isInteger(binding.revision) || binding.revision < 1) issues.push({ code: "PB_REVISION_INVALID", path: "revision", message: "Revision must be a positive integer." });
  if (binding.componentIdentity.componentInstanceId !== binding.scope.componentInstanceId || binding.componentIdentity.projectId !== binding.scope.projectId || binding.componentIdentity.branchId !== binding.scope.branchId || binding.componentIdentity.boardInstanceId !== binding.scope.boardInstanceId) issues.push({ code: "PB_COMPONENT_IDENTITY_SCOPE_MISMATCH", path: "componentIdentity", message: "Stable component identity does not match binding scope." });
  if (binding.exactPart && (!binding.exactPart.manufacturerId.trim() || !binding.exactPart.exactPublishedMpn.trim())) issues.push({ code: "PB_EXACT_PART_INCOMPLETE", path: "exactPart", message: "An exact part requires manufacturer identity and exact published MPN." });
  if (binding.package) {
    try { normalizePackageBinding(binding.package); } catch (error) { issues.push({ code: error instanceof Error ? error.message : "PB_PACKAGE_INVALID", path: "package", message: "Package identity is missing or ambiguous." }); }
  }
  if (binding.footprint) {
    if (binding.footprint.contentDigest && !DIGEST.test(binding.footprint.contentDigest)) issues.push({ code: "PB_FOOTPRINT_DIGEST_INVALID", path: "footprint.contentDigest", message: "Footprint content digest is invalid." });
    if (binding.footprint.sourceNamespace !== "legacy_locator" && (!binding.footprint.assetVersionId.trim() || !binding.footprint.sourceRevision.trim())) issues.push({ code: "PB_FOOTPRINT_REVISION_REQUIRED", path: "footprint.assetVersionId", message: "A non-legacy footprint requires immutable revision identity." });
  }
  if (binding.pinPadMapping.state === "verified") {
    if (!binding.pinPadMapping.mappingCertificateId || !binding.pinPadMapping.verifierVersion || !binding.pinPadMapping.symbolAssetVersionId || !binding.pinPadMapping.footprintAssetVersionId || !binding.pinPadMapping.footprintContentDigest) issues.push({ code: "PB_VERIFIED_MAPPING_INCOMPLETE", path: "pinPadMapping", message: "Verified mapping lacks revision-bound verifier data." });
    if (binding.footprint && (binding.pinPadMapping.footprintAssetVersionId !== binding.footprint.assetVersionId || binding.pinPadMapping.footprintContentDigest !== binding.footprint.contentDigest)) issues.push({ code: "PB_MAPPING_FOOTPRINT_MISMATCH", path: "pinPadMapping", message: "Mapping references a different footprint revision or digest." });
    if (binding.pinPadMapping.verifierVersion === "sirkit.mapping-verifier/4.0.0" && (!binding.pinPadMapping.mappingRevisionId || !binding.pinPadMapping.mappingContentDigest || !binding.pinPadMapping.mappingDependencyDigest || !binding.pinPadMapping.verificationResultDigest || !binding.pinPadMapping.verificationTier || binding.pinPadMapping.mappingApprovalState !== "approved" || binding.pinPadMapping.mappingFreshnessState !== "current" || binding.pinPadMapping.mappingConflictState !== "none" || binding.pinPadMapping.mappingLifecycleState !== "active")) issues.push({ code: "PB_STAGE4_MAPPING_ACCEPTANCE_INCOMPLETE", path: "pinPadMapping", message: "Stage 4 mapping lacks an approved current conflict-free revision/tier/dependency proof." });
  }
  if (binding.approval.state === "approved") {
    if (binding.approval.contentDigest !== binding.technicalDigest) issues.push({ code: "PB_APPROVAL_DIGEST_MISMATCH", path: "approval.contentDigest", message: "Approval is not scoped to this technical digest." });
    const decisionEvidence = binding.approval.decisionEvidenceRefs;
    if (!decisionEvidence?.length) issues.push({ code: "PB_DECISION_EVIDENCE_REQUIRED", path: "approval.decisionEvidenceRefs", message: "Approved bindings require explicit decision evidence." });
    else {
      if (decisionEvidence.length > 64) issues.push({ code: "PB_DECISION_EVIDENCE_LIMIT", path: "approval.decisionEvidenceRefs", message: "Approval decision evidence exceeds 64 references." });
      decisionEvidence.forEach((ref, index) => id(ref, `approval.decisionEvidenceRefs.${index}`, issues));
      unique(decisionEvidence, "approval.decisionEvidenceRefs", issues);
      if (decisionEvidence.some((ref) => !binding.evidenceRefs.includes(ref))) issues.push({ code: "PB_DECISION_EVIDENCE_NOT_FOUND", path: "approval.decisionEvidenceRefs", message: "Approval references evidence outside the binding snapshot." });
      if (decisionEvidence.some((ref, index) => ref !== [...decisionEvidence].sort()[index])) issues.push({ code: "PB_DECISION_EVIDENCE_NOT_CANONICAL", path: "approval.decisionEvidenceRefs", message: "Approval decision evidence is not canonically ordered." });
    }
  }
  if (binding.technicalValidation.state === "valid" && binding.technicalValidation.validatedDigest !== binding.technicalDigest) issues.push({ code: "PB_VALIDATION_DIGEST_MISMATCH", path: "technicalValidation.validatedDigest", message: "Technical validation is stale for this binding digest." });
  if (!DIGEST.test(binding.technicalDigest)) issues.push({ code: "PB_TECHNICAL_DIGEST_INVALID", path: "technicalDigest", message: "Technical digest is invalid." });
  if (!DIGEST.test(binding.recordDigest)) issues.push({ code: "PB_RECORD_DIGEST_INVALID", path: "recordDigest", message: "Record digest is invalid." });
  const base = withoutBindingDigests(binding);
  const expectedTechnical = physicalBindingDigest({ schemaVersion: base.schemaVersion, scope: base.scope, componentIdentity: base.componentIdentity, classification: base.classification, exactPart: base.exactPart, package: base.package, footprint: base.footprint, pinPadMapping: base.pinPadMapping, applicabilityState: base.applicabilityState, evidenceRefs: base.evidenceRefs, dependencies: base.dependencies });
  if (expectedTechnical !== binding.technicalDigest) issues.push({ code: "PB_TECHNICAL_DIGEST_MISMATCH", path: "technicalDigest", message: "Technical digest does not match canonical content." });
  if (physicalBindingDigest({ ...base, technicalDigest: binding.technicalDigest }) !== binding.recordDigest) issues.push({ code: "PB_RECORD_DIGEST_MISMATCH", path: "recordDigest", message: "Record digest does not match canonical record." });
  unique(binding.evidenceRefs, "evidenceRefs", issues);
  if (binding.evidenceRefs.length > 512) issues.push({ code: "PB_EVIDENCE_LIMIT", path: "evidenceRefs", message: "Binding exceeds the evidence reference limit." });
  if (!Number.isFinite(Date.parse(binding.createdAt))) issues.push({ code: "PB_TIMESTAMP_INVALID", path: "createdAt", message: "Creation timestamp is invalid." });
  return issues.sort((a, b) => compareCodePoints(a.path, b.path) || compareCodePoints(a.code, b.code));
}

export function validateBindingSet(set: ComponentPhysicalBindingSet, bindings: readonly ComponentPhysicalBinding[]): PhysicalBindingValidationIssue[] {
  const issues = validatePhysicalBindingScope(set.scope);
  if (set.candidateRevisionIds.length > 256) issues.push({ code: "PB_CANDIDATE_LIMIT", path: "candidateRevisionIds", message: "Candidate count exceeds 256." });
  unique(set.candidateRevisionIds, "candidateRevisionIds", issues);
  const byId = new Map(bindings.map((binding) => [binding.revisionId, binding]));
  for (const revisionId of set.candidateRevisionIds) {
    const binding = byId.get(revisionId);
    if (!binding) issues.push({ code: "PB_CANDIDATE_REVISION_MISSING", path: "candidateRevisionIds", message: `Candidate ${revisionId} is missing.` });
    else if (scopeKey(binding.scope) !== scopeKey(set.scope)) issues.push({ code: "PB_CANDIDATE_SCOPE_MISMATCH", path: "candidateRevisionIds", message: `Candidate ${revisionId} belongs to another scope.` });
  }
  if (set.effectiveSelectedRevisionId) {
    const selected = byId.get(set.effectiveSelectedRevisionId);
    if (!selected || !set.candidateRevisionIds.includes(set.effectiveSelectedRevisionId)) issues.push({ code: "PB_SELECTED_REVISION_MISSING", path: "effectiveSelectedRevisionId", message: "Selected binding is not in the candidate set." });
    else if (selected.lifecycleState !== "selected") issues.push({ code: "PB_SELECTED_STATE_INVALID", path: "effectiveSelectedRevisionId", message: "Effective binding is not in selected lifecycle state." });
  }
  if (physicalBindingDigest({ ...set, recordDigest: undefined }) !== set.recordDigest) issues.push({ code: "PB_SET_DIGEST_MISMATCH", path: "recordDigest", message: "Binding-set digest does not match canonical content." });
  return issues.sort((a, b) => compareCodePoints(a.path, b.path) || compareCodePoints(a.code, b.code));
}
