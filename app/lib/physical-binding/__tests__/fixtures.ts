import type { EngineeringActor } from "../../engineering/types";
import { createPhysicalBindingCandidate } from "../domain";
import type { ComponentPhysicalBinding, PhysicalBindingScope, PhysicalBindingTransitionRequest } from "../types";

export const NOW = "2026-07-18T12:00:00.000Z";
export const LATER = "2026-07-18T12:01:00.000Z";
export const DIGEST = `sha256:${"a".repeat(64)}`;
export const ACTOR: EngineeringActor = { actorId: "reviewer-1", actorKind: "human", sessionId: "test-session", role: "project_admin" };
export const AI_ACTOR: EngineeringActor = { actorId: "agent-1", actorKind: "ai", sessionId: "test-agent", role: "automation" };

export function scope(componentInstanceId = "component-uuid-1", variants = ["variant-default"]): PhysicalBindingScope {
  return { tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardInstanceId: "board-1", componentInstanceId, hierarchyPath: ["root", "motor-control"], assemblyVariantIds: variants };
}

export function exactCandidate(componentInstanceId = "component-uuid-1", options: { manufacturingComplete?: boolean; candidateKeySuffix?: string; variants?: string[]; scopeOverrides?: Partial<PhysicalBindingScope> } = {}): ComponentPhysicalBinding {
  const physicalScope = { ...scope(componentInstanceId, options.variants), ...options.scopeOverrides };
  return createPhysicalBindingCandidate({
    scope: physicalScope,
    classification: { populationKind: "physical", deviceClass: "microcontroller", mountingTechnology: "smd", polarity: "unknown", classificationEvidenceRefs: ["evidence-class"] },
    exactPart: { atomicPartRevisionId: "atomic-revision-1", exactPartId: "exact-part-1", manufacturerId: "manufacturer-st", exactPublishedMpn: "STM32F411CEU6", supplierParts: [{ supplierId: "supplier-digikey", supplierSku: "497-STM32F411CEU6CT-ND" }], evidenceRefs: ["evidence-datasheet"] },
    package: { packageIdentityId: "package-ufqfpn48", packageRevisionId: "package-ufqfpn48:r1", identitySystem: "manufacturer", canonicalName: "UFQFPN-48 7x7 mm 0.5 mm pitch EP", sourceToken: "UFQFPN48", mountingTechnology: "smd", pinCount: 48, pitchNm: 500_000, bodyWidthNm: 7_000_000, bodyLengthNm: 7_000_000, exposedPad: "present", exactPartId: "exact-part-1", evidenceRefs: ["evidence-package"] },
    footprint: { logicalAssetId: "footprint-stm32-ufqfpn48", assetVersionId: "footprint-stm32-ufqfpn48:r3", contentDigest: DIGEST, semanticDigest: `sha256:${"b".repeat(64)}`, sourceNamespace: "atomic_catalog", sourceRevision: "kicad-9@abc123", libraryNickname: "Package_DFN_QFN", footprintName: "QFN-48-1EP_7x7mm_P0.5mm_EP5.7x5.7mm", availability: "available", validationState: "valid", packageCompatibility: "compatible", padIdentifiers: Array.from({ length: 49 }, (_, index) => String(index + 1)), duplicatePadIdentifiers: [], electricalPadCount: 49, mechanicalPadCount: 0, geometry: { hasCourtyard: true, hasFabrication: true, hasSolderMaskDefinition: true, hasPasteDefinition: true, hasDrillDefinition: false, manufacturingValidated: options.manufacturingComplete === true }, evidenceRefs: ["evidence-footprint"] },
    pinPadMapping: { state: "verified", mappingCertificateId: "mapping-certificate-1", symbolAssetVersionId: "symbol-stm32:r2", footprintAssetVersionId: "footprint-stm32-ufqfpn48:r3", footprintContentDigest: DIGEST, verifierVersion: "sirkit.atomic-mapping/1", verifiedAt: NOW, evidenceRefs: ["evidence-mapping"], reasonCodes: [] },
    origin: { kind: "exact_catalog_binding", actor: ACTOR, sourceRef: "atomic-revision-1", createdAt: NOW, evidenceRefs: ["evidence-datasheet"], ruleVersion: "atomic-catalog/1" },
    evidenceRefs: ["evidence-datasheet", "evidence-package", "evidence-footprint", "evidence-mapping"],
    applicabilityState: "applicable",
    dependencies: {
      symbolAssetVersionId: "symbol-stm32:r2", packageRevisionId: "package-ufqfpn48:r1", footprintAssetVersionId: "footprint-stm32-ufqfpn48:r3", footprintContentDigest: DIGEST, mappingCertificateId: "mapping-certificate-1", mappingVerifierVersion: "sirkit.atomic-mapping/1", exactPartEvidenceDigest: `sha256:${"c".repeat(64)}`,
      exactPartFootprintCompatibility: options.manufacturingComplete ? "compatible" : "pending",
      ...(options.manufacturingComplete ? { electricalConstraintValidationRef: "cd7-report-1", assemblyDataRef: "cd12-assembly-1", manufacturingEvidenceRefs: ["evidence-manufacturing"], externalValidationRefs: ["cd7-report-1", "cd12-release-1"] } : {}),
    },
    createdAt: NOW,
    createdBy: ACTOR,
    candidateKey: `exact-${componentInstanceId}-${options.candidateKeySuffix ?? "primary"}`,
  });
}

export function transition(binding: ComponentPhysicalBinding, setRevision: number, action: PhysicalBindingTransitionRequest["action"], actor: EngineeringActor = ACTOR, suffix = action): PhysicalBindingTransitionRequest {
  return { schemaVersion: "sirkit.physical-binding-transition.v1", action, bindingRevisionId: binding.revisionId, expectedSetRevision: setRevision, idempotencyKey: `${binding.bindingId}-${suffix}`, reason: `Test ${action}`, actor, at: new Date(Date.parse(NOW) + setRevision * 60_000).toISOString() };
}
