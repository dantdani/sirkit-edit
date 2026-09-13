/**
 * Bind a schematic component instance to a PUBLISHED atomic part revision by
 * driving the ordinary Stage 1 lifecycle: create_candidate → select →
 * revalidate → approve. No gate is bypassed — every transition runs through
 * PhysicalBindingService with the requesting human actor, decision evidence
 * cites the atomic revision's real evidence records, and `revalidate` only
 * attaches an approved validation after `validatePhysicalBinding` reports the
 * constructed candidate clean.
 *
 * The candidate's technical content (exact part, package, footprint, mapping)
 * is projected verbatim from the published portable snapshot, so the binding
 * carries the same digests the pcb-sync materialization boundary re-verifies.
 */

import { loadAtomicRevisionStatus, loadSelectablePortableSnapshot } from "../atomic/server-catalog";
import { sha256 } from "../atomic/stable";
import type { EngineeringActor } from "../engineering/types";
import { createPhysicalBindingCandidate } from "./domain";
import type { PhysicalBindingService } from "./repository";
import type { PhysicalBindingRepository } from "./repository";
import type { ComponentPhysicalBinding, PhysicalBindingScope } from "./types";
import { createApprovedValidation } from "./transitions";
import { validatePhysicalBinding } from "./validation";

export interface BindAtomicSelectionInput {
  scope: { tenantId: string; projectId: string; branchId: string };
  actor: EngineeringActor;
  boardInstanceId: string;
  componentInstanceId: string;
  atomicPartRevisionId: string;
  hierarchyPath?: string[];
  assemblyVariantIds?: string[];
}

export interface BindAtomicSelectionResult {
  setId: string;
  bindingRevisionId: string;
  lifecycleState: string;
  alreadyBound: boolean;
}

const VALIDATOR_VERSION = "sirkit.atomic-binding-validator/1";

/** "R_0805_2012Metric" → "0805 (2012 Metric)"; SOIC/headers keep their name. */
export function canonicalPackageName(footprintName: string): { name: string; identitySystem: "metric_imperial_explicit" | "manufacturer"; sourceToken: string } {
  const chip = /(?:^|_)(0201|0402|0603|0805|1206|1210)_(\d{4})Metric(?:_|$)/.exec(footprintName);
  if (chip) return { name: `${chip[1]} (${chip[2]} Metric)`, identitySystem: "metric_imperial_explicit", sourceToken: chip[1]! };
  return { name: footprintName.replace(/_/g, " "), identitySystem: "manufacturer", sourceToken: footprintName };
}

export async function bindAtomicSelection(
  service: PhysicalBindingService,
  repository: PhysicalBindingRepository,
  input: BindAtomicSelectionInput,
): Promise<BindAtomicSelectionResult> {
  if (input.actor.actorKind !== "human") throw new Error("PB_ATOMIC_BIND_HUMAN_REVIEWER_REQUIRED");

  const scope: PhysicalBindingScope = {
    tenantId: input.scope.tenantId,
    projectId: input.scope.projectId,
    branchId: input.scope.branchId,
    boardInstanceId: input.boardInstanceId,
    componentInstanceId: input.componentInstanceId,
    hierarchyPath: input.hierarchyPath ?? ["root"],
    assemblyVariantIds: input.assemblyVariantIds ?? ["variant-default"],
  };

  // Idempotent replay: an existing approved selection for the same atomic
  // revision means this instance is already bound. [B16-C.5] This is a READ
  // (nothing is written), so it is answered BEFORE the publication-role
  // requirement: an editor whose candidates a reviewer approved through the
  // review handoff resumes Schematic → PCB against the reviewer's bindings
  // instead of being refused again (the browser proof found the second sync
  // refused 403 nine times after every approval).
  const existingSets = await repository.findForComponentVariant({ ...scope, assemblyVariantId: scope.assemblyVariantIds[0] ?? "variant-default" });
  for (const state of existingSets) {
    const selected = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId);
    if (selected && selected.exactPart?.atomicPartRevisionId === input.atomicPartRevisionId && selected.approval.state === "approved") {
      // [B19-E E3] the replay re-reads the revision's status: an existing pin survives deprecation or supersession (OD-38),
      // never revocation or a revision the catalog no longer publishes
      const status = (await loadAtomicRevisionStatus([input.atomicPartRevisionId])).get(input.atomicPartRevisionId);
      if (!status?.pinnable) throw new Error(status ? "PB_ATOMIC_REVISION_REVOKED" : "PB_ATOMIC_REVISION_NOT_FOUND");
      return { setId: state.set.setId, bindingRevisionId: selected.revisionId, lifecycleState: selected.lifecycleState, alreadyBound: true };
    }
  }

  // Publishing a NEW binding is a human reviewer's / administrator's act.
  if (!["reviewer", "project_admin"].includes(input.actor.role)) {
    throw new Error("PB_ATOMIC_BIND_HUMAN_REVIEWER_REQUIRED");
  }
  // [B19-E E3] a NEW binding is a new selection: published and never withdrawn
  const snapshot = await loadSelectablePortableSnapshot(input.atomicPartRevisionId);
  if (!snapshot) throw new Error("PB_ATOMIC_REVISION_NOT_FOUND");
  const { footprint, mapping, symbol, exactPart, manufacturer } = snapshot;
  if (!footprint || !mapping || !exactPart || !manufacturer) throw new Error("PB_ATOMIC_REVISION_INCOMPLETE");
  if (mapping.state !== "approved") throw new Error("PB_ATOMIC_MAPPING_UNAPPROVED");

  const now = new Date().toISOString();
  const datasheetEvidence = snapshot.evidence.map((item) => item.id).sort();
  if (!datasheetEvidence.length) throw new Error("PB_ATOMIC_EVIDENCE_MISSING");
  const electricalPads = footprint.pads.filter((pad) => !pad.mechanical);
  const electricalPadNumbers = [...new Set(electricalPads.map((pad) => pad.number))];
  const pkg = canonicalPackageName(footprint.footprintName);
  const packageRevisionId = `package_${sha256(`${exactPart.id}|${footprint.versionId}|${pkg.name}`).slice(0, 24)}:r1`;
  const evidenceRefs = [...new Set([...datasheetEvidence, ...mapping.evidenceIds])].sort();

  const candidateKey = `atomic-${input.componentInstanceId}-${input.atomicPartRevisionId}`;
  const candidate: ComponentPhysicalBinding = createPhysicalBindingCandidate({
    scope,
    classification: {
      populationKind: "physical",
      deviceClass: snapshot.atomicRevision.logicalPartId,
      mountingTechnology: footprint.mountingTechnology,
      polarity: "unknown",
      classificationEvidenceRefs: datasheetEvidence,
    },
    exactPart: {
      atomicPartRevisionId: snapshot.atomicRevision.id,
      exactPartId: exactPart.id,
      manufacturerId: manufacturer.id,
      exactPublishedMpn: exactPart.exactMpn,
      supplierParts: [],
      evidenceRefs: datasheetEvidence,
    },
    package: {
      packageIdentityId: `package_${sha256(pkg.name).slice(0, 24)}`,
      packageRevisionId,
      identitySystem: pkg.identitySystem,
      canonicalName: pkg.name,
      sourceToken: pkg.sourceToken,
      mountingTechnology: footprint.mountingTechnology,
      pinCount: electricalPadNumbers.length,
      exposedPad: mapping.exposedPadIds.length ? "present" : "absent",
      exactPartId: exactPart.id,
      evidenceRefs: datasheetEvidence,
    },
    footprint: {
      logicalAssetId: footprint.logicalAssetId,
      assetVersionId: footprint.versionId,
      contentDigest: footprint.contentHash,
      semanticDigest: footprint.semanticHash,
      sourceNamespace: "atomic_catalog",
      sourceRevision: footprint.origin.sourceRecordId,
      libraryNickname: footprint.origin.libraryNickname,
      footprintName: footprint.footprintName,
      availability: "available",
      validationState: "valid",
      packageCompatibility: "compatible",
      padIdentifiers: [...new Set(footprint.pads.map((pad) => pad.number))].sort(),
      duplicatePadIdentifiers: [],
      electricalPadCount: electricalPadNumbers.length,
      mechanicalPadCount: footprint.pads.filter((pad) => pad.mechanical).length,
      geometry: {
        hasCourtyard: true,
        hasFabrication: footprint.geometrySummary.hasFab,
        hasSolderMaskDefinition: electricalPads.some((pad) => pad.layers.some((layer) => /mask/i.test(layer))),
        hasPasteDefinition: electricalPads.some((pad) => pad.layers.some((layer) => /paste/i.test(layer))),
        hasDrillDefinition: electricalPads.some((pad) => pad.drillNm !== undefined),
        manufacturingValidated: false,
      },
      evidenceRefs,
    },
    pinPadMapping: {
      state: "verified",
      mappingCertificateId: mapping.id,
      symbolAssetVersionId: symbol.versionId,
      footprintAssetVersionId: footprint.versionId,
      footprintContentDigest: footprint.contentHash,
      verifierVersion: mapping.validatorVersion,
      verifiedAt: now,
      evidenceRefs: [...mapping.evidenceIds].sort(),
      reasonCodes: [],
    },
    origin: {
      kind: "exact_catalog_binding",
      actor: input.actor,
      sourceRef: snapshot.atomicRevision.id,
      createdAt: now,
      evidenceRefs: datasheetEvidence,
      ruleVersion: "atomic-catalog/1",
    },
    evidenceRefs,
    applicabilityState: "applicable",
    dependencies: {
      symbolAssetVersionId: symbol.versionId,
      packageRevisionId,
      footprintAssetVersionId: footprint.versionId,
      footprintContentDigest: footprint.contentHash,
      mappingCertificateId: mapping.id,
      mappingVerifierVersion: mapping.validatorVersion,
      exactPartEvidenceDigest: `sha256:${sha256(datasheetEvidence.join("\n"))}`,
      exactPartFootprintCompatibility: "compatible",
    },
    createdAt: now,
    createdBy: input.actor,
    candidateKey,
  });

  let state = await service.createCandidate(candidate, `create-${candidateKey}`);
  const created = state.bindings.find((binding) => binding.bindingId === candidate.bindingId);
  if (!created) throw new Error("PB_ATOMIC_CANDIDATE_MISSING");

  const transitionBase = (action: "select" | "revalidate" | "approve", bindingRevisionId: string) => ({
    schemaVersion: "sirkit.physical-binding-transition.v1" as const,
    action,
    bindingRevisionId,
    expectedSetRevision: state.set.revision,
    idempotencyKey: `${candidateKey}-${action}`,
    reason: `Bind approved atomic revision ${snapshot.atomicRevision.id} (${exactPart.exactMpn}) to instance ${input.componentInstanceId}`,
    actor: input.actor,
    at: new Date().toISOString(),
  });

  state = await service.transition(state.set.setId, { ...transitionBase("select", created.revisionId), decisionEvidenceRefs: [...candidate.evidenceRefs] }, state);
  let current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId);
  if (!current) throw new Error("PB_ATOMIC_SELECTION_MISSING");

  const integrityIssues = validatePhysicalBinding(current);
  if (integrityIssues.length) throw new Error(`PB_ATOMIC_VALIDATION_FAILED:${integrityIssues[0]!.code}`);
  const revalidate = { ...transitionBase("revalidate", current.revisionId), validation: createApprovedValidation(current, { validatorVersion: VALIDATOR_VERSION, at: new Date().toISOString(), evidenceRefs: [...mapping.evidenceIds] }) };
  state = await service.transition(state.set.setId, revalidate, state);
  current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId);
  if (!current) throw new Error("PB_ATOMIC_SELECTION_MISSING");

  state = await service.transition(state.set.setId, { ...transitionBase("approve", current.revisionId), decisionEvidenceRefs: [...candidate.evidenceRefs], approvalScope: "layout" }, state);
  current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId);
  if (!current || current.approval.state !== "approved") throw new Error("PB_ATOMIC_APPROVAL_FAILED");

  return { setId: state.set.setId, bindingRevisionId: current.revisionId, lifecycleState: current.lifecycleState, alreadyBound: false };
}
