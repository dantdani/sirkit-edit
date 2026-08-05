import type {
  AtomicPartRevision,
  AtomicUpgradeDiff,
  PortableAtomicSnapshot,
  ProjectComponentPin,
  SelectionRecord,
  UpgradeImpact,
} from "./types";
import { semanticHash } from "./stable";

function bundle(revision: AtomicPartRevision) {
  return revision.cadBundles.find((item) => item.disposition === "primary_approved") ?? revision.cadBundles[0];
}

export function diffAtomicUpgrade(input: {
  from: AtomicPartRevision;
  to: AtomicPartRevision;
  symbolSemanticHashes: ReadonlyMap<string, string>;
  footprintSemanticHashes: ReadonlyMap<string, string>;
  mappingSemanticHashes: ReadonlyMap<string, string>;
  claimSemanticHashes: ReadonlyMap<string, string>;
  guidanceSemanticHashes: ReadonlyMap<string, string>;
}): AtomicUpgradeDiff {
  const impacts = new Set<UpgradeImpact>();
  const invalidates = new Set<AtomicUpgradeDiff["invalidates"][number]>();
  const blockers: string[] = [];
  if (input.from.logicalPartId !== input.to.logicalPartId) blockers.push("target is a different logical part");
  if (input.to.publicationState === "revoked") {
    impacts.add("revoked_target");
    blockers.push("target revision is revoked");
  }
  const fromBundle = bundle(input.from);
  const toBundle = bundle(input.to);
  if (!fromBundle || !toBundle) blockers.push("missing CAD bundle");
  if (fromBundle && toBundle) {
    if (input.symbolSemanticHashes.get(fromBundle.symbolVersionId) !== input.symbolSemanticHashes.get(toBundle.symbolVersionId)) {
      impacts.add("symbol_pin_change");
      invalidates.add("electrical_parity"); invalidates.add("pin_pad_mapping"); invalidates.add("readiness"); invalidates.add("manufacturing_release");
    }
    if (fromBundle.footprintVersionId !== toBundle.footprintVersionId ||
      input.footprintSemanticHashes.get(fromBundle.footprintVersionId ?? "") !== input.footprintSemanticHashes.get(toBundle.footprintVersionId ?? "")) {
      impacts.add("footprint_geometry_change");
      invalidates.add("pin_pad_mapping"); invalidates.add("placement"); invalidates.add("routing"); invalidates.add("drc"); invalidates.add("readiness"); invalidates.add("manufacturing_release");
    }
    if (input.mappingSemanticHashes.get(fromBundle.mappingCertificateId ?? "") !== input.mappingSemanticHashes.get(toBundle.mappingCertificateId ?? "")) {
      impacts.add("pin_mapping_change");
      invalidates.add("electrical_parity"); invalidates.add("pin_pad_mapping"); invalidates.add("routing"); invalidates.add("readiness"); invalidates.add("manufacturing_release");
    }
  }
  const claimsChanged = semanticHash(input.from.claimIds.map((id) => input.claimSemanticHashes.get(id)).sort()) !== semanticHash(input.to.claimIds.map((id) => input.claimSemanticHashes.get(id)).sort());
  const guidanceChanged = semanticHash(input.from.guidanceIds.map((id) => input.guidanceSemanticHashes.get(id)).sort()) !== semanticHash(input.to.guidanceIds.map((id) => input.guidanceSemanticHashes.get(id)).sort());
  if (claimsChanged || guidanceChanged) {
    impacts.add("rating_or_guidance_change"); invalidates.add("readiness"); invalidates.add("manufacturing_release");
  }
  if (semanticHash(input.from.licenseIds) !== semanticHash(input.to.licenseIds)) {
    impacts.add("license_change"); invalidates.add("manufacturing_release");
  }
  if (semanticHash(input.from.offerSnapshotIds) !== semanticHash(input.to.offerSnapshotIds)) impacts.add("supplier_only");
  if (impacts.size === 0) impacts.add("metadata_only");
  const safeForAutomaticMetadataRefresh = [...impacts].every((impact) => impact === "metadata_only" || impact === "supplier_only") && blockers.length === 0;
  return {
    fromRevisionId: input.from.id,
    toRevisionId: input.to.id,
    impacts: [...impacts].sort(),
    invalidates: [...invalidates].sort(),
    safeForAutomaticMetadataRefresh,
    blockers,
  };
}

export function pinFromSelection(selection: SelectionRecord): ProjectComponentPin {
  return structuredClone({
    selectionRecordId: selection.id,
    atomicRevisionId: selection.atomicRevisionId,
    symbolVersionId: selection.symbolVersionId,
    footprintVersionId: selection.footprintVersionId,
    modelVersionIds: selection.modelVersionIds,
    mappingCertificateId: selection.mappingCertificateId,
    embeddedSnapshot: selection.embeddedSnapshot,
  });
}

export function applyUpgrade(input: {
  current: ProjectComponentPin;
  target: AtomicPartRevision;
  targetSnapshot: PortableAtomicSnapshot;
  diff: AtomicUpgradeDiff;
  userConfirmed: boolean;
}): ProjectComponentPin {
  if (input.diff.fromRevisionId !== input.current.atomicRevisionId || input.diff.toRevisionId !== input.target.id) throw new Error("Upgrade diff is not bound to the requested revisions");
  if (input.diff.blockers.length) throw new Error(`Upgrade blocked: ${input.diff.blockers.join("; ")}`);
  if (!input.userConfirmed) throw new Error("Atomic revision upgrades require explicit user confirmation");
  if (input.targetSnapshot.atomicRevision.id !== input.target.id) throw new Error("Target offline snapshot is not bound to the target revision");
  const targetBundle = bundle(input.target);
  if (!targetBundle) throw new Error("Target revision has no CAD bundle");
  if (input.targetSnapshot.symbol.versionId !== targetBundle.symbolVersionId) throw new Error("Target snapshot symbol is not bound to the target CAD bundle");
  if (input.targetSnapshot.footprint?.versionId !== targetBundle.footprintVersionId) throw new Error("Target snapshot footprint is not bound to the target CAD bundle");
  if (input.targetSnapshot.mapping?.id !== targetBundle.mappingCertificateId) throw new Error("Target snapshot mapping is not bound to the target CAD bundle");
  return {
    selectionRecordId: `upgrade_${semanticHash({ prior: input.current.selectionRecordId, target: input.target.id })}`,
    atomicRevisionId: input.target.id,
    symbolVersionId: targetBundle.symbolVersionId,
    footprintVersionId: targetBundle.footprintVersionId,
    modelVersionIds: [...targetBundle.modelVersionIds],
    mappingCertificateId: targetBundle.mappingCertificateId,
    embeddedSnapshot: structuredClone(input.targetSnapshot),
  };
}
