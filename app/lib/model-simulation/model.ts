import type { EngineeringActor } from "../engineering/types";
import { finalizeSimulation, simulationId, unique } from "./stable";
import type { ModelApplicabilityResult, ModelRegistrySnapshot, ModelTerminalMappingCertificate, SimulationModelAsset, SimulationModelBinding, SimulatorProviderDefinition } from "./types";

const HUMAN_REVIEW_ROLES = new Set(["reviewer", "project_admin"]);
function isHumanReviewer(actor: EngineeringActor | undefined): boolean { return Boolean(actor?.actorKind === "human" && HUMAN_REVIEW_ROLES.has(actor.role)); }
function exactAssetRevision(asset: SimulationModelAsset): string { return `${asset.modelAssetId}@${asset.revision}:${asset.deterministicDigest}`; }

export function inspectModelAsset(asset: SimulationModelAsset): string[] {
  const errors: string[] = [];
  if (!asset.modelAssetId || asset.revision < 1 || !asset.immutableContentDigest || !asset.contentAddressedStorageRef.startsWith("artifact://sha256/")) errors.push("CD10_MODEL_IDENTITY_INCOMPLETE");
  if (!asset.sourceAndProvenanceRefs.length) errors.push("CD10_MODEL_PROVENANCE_MISSING");
  if (!asset.terminalDefinitions.length || new Set(asset.terminalDefinitions.map((item) => item.terminalId)).size !== asset.terminalDefinitions.length || new Set(asset.terminalDefinitions.map((item) => item.ordinal)).size !== asset.terminalDefinitions.length) errors.push("CD10_MODEL_TERMINALS_INVALID");
  if ([asset.licenseMetadata.execution, asset.licenseMetadata.caching, asset.licenseMetadata.retention].some((state) => state === "unknown" || state === "forbidden")) errors.push("CD10_MODEL_LICENSE_NOT_ELIGIBLE");
  if (asset.reviewState === "approved" && !isHumanReviewer(asset.reviewer)) errors.push("CD10_MODEL_APPROVAL_UNAUTHORIZED");
  if (asset.reviewState !== "approved" || asset.lifecycleState !== "active") errors.push("CD10_MODEL_NOT_APPROVED");
  if (asset.deterministicDigest !== finalizeSimulation(asset).deterministicDigest) errors.push("CD10_MODEL_DIGEST_MISMATCH");
  return unique(errors);
}

export function createModelRegistry(input: { assets: SimulationModelAsset[]; revision?: number; reviewer?: EngineeringActor; approvedAt?: string }): ModelRegistrySnapshot {
  const approved = isHumanReviewer(input.reviewer) && input.assets.length > 0 && input.assets.every((asset) => inspectModelAsset(asset).length === 0);
  const body = { revision: input.revision ?? 1, assets: [...input.assets].sort((a, b) => exactAssetRevision(a).localeCompare(exactAssetRevision(b))), lifecycleState: approved ? "approved" as const : "draft" as const, ...(approved ? { approvedBy: structuredClone(input.reviewer), approvedAt: input.approvedAt } : {}) };
  return finalizeSimulation<ModelRegistrySnapshot>({ ...body, registryId: simulationId("model-registry", body), deterministicDigest: "" });
}

export function validateModelRegistry(registry: ModelRegistrySnapshot): string[] {
  const errors = registry.assets.flatMap(inspectModelAsset);
  if (!registry.registryId || registry.revision < 1 || registry.assets.length === 0) errors.push("CD10_MODEL_REGISTRY_EMPTY");
  if (new Set(registry.assets.map(exactAssetRevision)).size !== registry.assets.length) errors.push("CD10_MODEL_REGISTRY_DUPLICATE_ASSET");
  if (registry.lifecycleState === "approved" && (!isHumanReviewer(registry.approvedBy) || !registry.approvedAt)) errors.push("CD10_MODEL_REGISTRY_APPROVAL_INVALID");
  if (registry.lifecycleState !== "approved") errors.push("CD10_MODEL_REGISTRY_NOT_APPROVED");
  if (registry.deterministicDigest !== finalizeSimulation(registry).deterministicDigest) errors.push("CD10_MODEL_REGISTRY_DIGEST_MISMATCH");
  return unique(errors);
}

export function createTerminalMappingCertificate(input: Omit<ModelTerminalMappingCertificate, "certificateId" | "certificateState" | "reviewerApproval" | "deterministicDigest"> & { reviewer?: EngineeringActor; approvedAt?: string; rationale?: string }): ModelTerminalMappingCertificate {
  const mappings = [...input.schematicPinToModelTerminalMappings].sort((a, b) => a.pinInstanceId.localeCompare(b.pinInstanceId));
  const complete = mappings.length > 0 && new Set(mappings.map((item) => item.pinInstanceId)).size === mappings.length && new Set(mappings.map((item) => item.modelTerminalId)).size === mappings.length;
  const approved = complete && isHumanReviewer(input.reviewer);
  const body = { modelAssetRevisionId: input.modelAssetRevisionId, exactAtomicPartRevisionId: input.exactAtomicPartRevisionId, schematicPinToModelTerminalMappings: mappings, groundReferenceAndGlobalNodeMappings: [...input.groundReferenceAndGlobalNodeMappings], duplicateHiddenThermalPinTreatment: [...input.duplicateHiddenThermalPinTreatment], unusedModelTerminalTreatment: [...input.unusedModelTerminalTreatment], parameterMappingRefs: unique(input.parameterMappingRefs), evidenceAndValidationRefs: unique(input.evidenceAndValidationRefs), certificateState: approved ? "approved" as const : complete ? "draft" as const : "invalid" as const, ...(approved ? { reviewerApproval: { reviewer: structuredClone(input.reviewer!), approvedAt: input.approvedAt ?? "", rationale: input.rationale ?? "Exact semantic pin-to-terminal mapping reviewed." } } : {}) };
  return finalizeSimulation<ModelTerminalMappingCertificate>({ ...body, certificateId: simulationId("terminal-map", body), deterministicDigest: "" });
}

export function validateModelBinding(input: { binding: SimulationModelBinding; asset?: SimulationModelAsset; certificate?: ModelTerminalMappingCertificate; component: { componentInstanceId: string; exactAtomicPartRevisionId: string; exactPackageRevisionId: string; pinInstanceIds: string[] } }): string[] {
  const { binding, asset, certificate, component } = input; const errors: string[] = [];
  if (!asset || `${asset.modelAssetId}@${asset.revision}:${asset.deterministicDigest}` !== binding.modelAssetRevisionId) errors.push("CD10_BINDING_MODEL_REVISION_MISSING");
  if (!certificate || certificate.certificateId !== binding.terminalMappingCertificateId || certificate.certificateState !== "approved") errors.push("CD10_BINDING_TERMINAL_CERTIFICATE_INVALID");
  if (binding.componentInstanceId !== component.componentInstanceId || binding.exactAtomicPartRevisionId !== component.exactAtomicPartRevisionId || binding.exactPackageRevisionId !== component.exactPackageRevisionId) errors.push("CD10_BINDING_EXACT_IDENTITY_MISMATCH");
  if (certificate) {
    const mappedPins = new Set(certificate.schematicPinToModelTerminalMappings.map((item) => item.pinInstanceId));
    if (component.pinInstanceIds.some((pin) => !mappedPins.has(pin))) errors.push("CD10_BINDING_POSITIONAL_OR_MISSING_PIN_MAPPING");
    const terminalIds = new Set(asset?.terminalDefinitions.map((item) => item.terminalId) ?? []);
    if (certificate.schematicPinToModelTerminalMappings.some((item) => !terminalIds.has(item.modelTerminalId))) errors.push("CD10_BINDING_UNKNOWN_MODEL_TERMINAL");
  }
  const parameters = new Map(binding.parameterBindings.map((item) => [item.parameterId, item]));
  if (asset?.parameterDefinitions.some((item) => item.required && item.defaultAuthority === "none" && !parameters.has(item.parameterId))) errors.push("CD10_BINDING_REQUIRED_PARAMETER_MISSING");
  if (binding.bindingState !== "approved" || binding.deterministicDigest !== finalizeSimulation(binding).deterministicDigest) errors.push("CD10_BINDING_NOT_APPROVED_OR_TAMPERED");
  return unique(errors);
}

export function evaluateModelApplicability(input: { asset: SimulationModelAsset; binding: SimulationModelBinding; provider: SimulatorProviderDefinition; exactPartRevisionId: string; exactPackageRevisionId: string; componentInstanceId: string; targetClaims: string[]; scope: string[]; requestedDomain: Array<{ dimension: string; value?: number; unit: string }>; presentExternalElements: string[]; evidenceRefs?: string[] }): ModelApplicabilityResult {
  const exactScope = input.asset.exactFamilyPartPackageScopes.some((scope) => scope.scope === "exact" && scope.exactPartRevisionId === input.exactPartRevisionId && (!scope.packageRevisionId || scope.packageRevisionId === input.exactPackageRevisionId));
  const compatibility = input.asset.dialectAndProviderCompatibility.some((item) => item.state === "supported" && item.providerRevisionIds.includes(input.provider.deterministicDigest));
  const license = input.asset.licenseMetadata.execution === "allowed" && input.asset.licenseMetadata.retention === "allowed";
  const operatingDomainComparison = input.requestedDomain.map((requested) => { const declared = input.asset.operatingDomain.find((item) => item.dimension === requested.dimension && item.unit === requested.unit); const state = requested.value === undefined || !declared ? "unknown" : (declared.minimum === undefined || requested.value >= declared.minimum) && (declared.maximum === undefined || requested.value <= declared.maximum) ? "inside" : "outside"; return { dimension: requested.dimension, requested: requested.value, unit: requested.unit, state } as const; });
  const requiredExternalElementResults = input.asset.requiredExternalElements.map((element) => ({ element, state: input.presentExternalElements.includes(element) ? "present" as const : "missing" as const }));
  const missing: string[] = [];
  if (!exactScope) missing.push("exact_part_package_scope");
  if (!compatibility) missing.push("provider_compatibility");
  if (!license) missing.push("license_eligibility");
  if (operatingDomainComparison.some((item) => item.state !== "inside")) missing.push("operating_domain");
  if (requiredExternalElementResults.some((item) => item.state !== "present")) missing.push("required_external_elements");
  if (!input.targetClaims.every((claim) => input.binding.claimScope.includes(claim))) missing.push("claim_scope");
  let applicabilityState: ModelApplicabilityResult["applicabilityState"] = "applicable_validated";
  if (!license) applicabilityState = "license_unavailable"; else if (!compatibility) applicabilityState = "provider_incompatible"; else if (!exactScope) applicabilityState = "inapplicable_exact_part_or_package"; else if (operatingDomainComparison.some((item) => item.state === "outside")) applicabilityState = "inapplicable_operating_domain"; else if (missing.length) applicabilityState = "unvalidated"; else if (input.asset.modelKind === "idealized_test_double") applicabilityState = "idealized_test_double_for_surrounding_network_only"; else if (["black_box", "encrypted"].includes(input.asset.modelKind)) applicabilityState = "black_box_narrowly_validated";
  const body = { modelAssetRevisionId: input.binding.modelAssetRevisionId, exactComponentInstanceId: input.componentInstanceId, exactPartPackageRevisionId: `${input.exactPartRevisionId}:${input.exactPackageRevisionId}`, targetClaimAndAnalysisKinds: unique(input.targetClaims), variantScenarioCornerScope: unique(input.scope), operatingDomainComparison, requiredExternalElementResults, providerCompatibilityResult: compatibility ? "pass" as const : "fail" as const, licenseEligibilityResult: license ? "pass" as const : "fail" as const, applicabilityState, missingOrConflictingInputs: unique(missing), evidenceRefs: unique(input.evidenceRefs ?? []), evaluatorVersion: "cd10-model-applicability/1" };
  return finalizeSimulation<ModelApplicabilityResult>({ ...body, applicabilityResultId: simulationId("model-applicability", body), deterministicDigest: "" });
}
