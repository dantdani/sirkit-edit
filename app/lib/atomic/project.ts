import type {
  AtomicPartRevision,
  AtomicUpgradeDiff,
  PortableAtomicSnapshot,
  ProjectComponentPin,
  SelectionRecord,
  UpgradeImpact,
} from "./types";
import { semanticHash } from "./stable";
import type { AtomicCatalogStatus } from "./revision-status";

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
  /** [B19-E E5] the target's durable catalog status (withdrawal is append-only: the row itself stays `published`) */
  toStatus?: AtomicCatalogStatus;
}): AtomicUpgradeDiff {
  const impacts = new Set<UpgradeImpact>();
  const invalidates = new Set<AtomicUpgradeDiff["invalidates"][number]>();
  const blockers: string[] = [];
  if (input.from.logicalPartId !== input.to.logicalPartId) blockers.push("target is a different logical part");
  // [B19-E E5] a target must be published and never withdrawn (OD-38): an in-memory record's own state, or the durable status
  const withdrawnStates = new Set<string>(["deprecated", "superseded", "revoked"]);
  const targetStates = [input.to.publicationState, input.toStatus].filter((state): state is NonNullable<typeof state> => state !== undefined && state !== "published");
  for (const state of new Set(targetStates.map((state) => (withdrawnStates.has(state) ? state : "unpublished")))) {
    if (state === "revoked") impacts.add("revoked_target");
    blockers.push(state === "unpublished" ? "target revision is not published" : `target revision is ${state}`);
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

/**
 * [B19-E E5] The upgrade diff between two portable snapshots (a pin's current revision and its successor), with the asset,
 * mapping, claim and guidance hashes taken from the snapshots themselves and the target's durable catalog status.
 */
export function diffAtomicSnapshots(from: PortableAtomicSnapshot, to: PortableAtomicSnapshot, toStatus: AtomicCatalogStatus): AtomicUpgradeDiff {
  const pairs = <T>(items: ReadonlyArray<T | undefined>, key: (item: T) => [string, string]) => new Map(items.filter((item): item is T => item !== undefined).map(key));
  return diffAtomicUpgrade({
    from: from.atomicRevision,
    to: to.atomicRevision,
    symbolSemanticHashes: pairs([from.symbol, to.symbol], (asset) => [asset.versionId, asset.semanticHash]),
    footprintSemanticHashes: pairs([from.footprint, to.footprint], (asset) => [asset.versionId, asset.semanticHash]),
    mappingSemanticHashes: pairs([from.mapping, to.mapping], (mapping) => [mapping.id, mapping.semanticHash]),
    claimSemanticHashes: pairs([...from.claims, ...to.claims], (claim) => [claim.id, semanticHash(claim)]),
    guidanceSemanticHashes: pairs([...from.guidance, ...to.guidance], (item) => [item.id, semanticHash(item)]),
    toStatus,
  });
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
