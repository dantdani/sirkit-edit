import type { PortableAtomicSnapshot } from "./types";

/** Structural/revision checks safe to run synchronously in browser persistence. */
export function portableSnapshotIntegrityErrors(snapshot: PortableAtomicSnapshot): string[] {
  const errors: string[] = [];
  const revision = snapshot.atomicRevision;
  const primary = revision.cadBundles.find((bundle) => bundle.disposition === "primary_approved") ?? revision.cadBundles[0];
  if (!primary) return ["no CAD bundle"];
  if (snapshot.symbol.versionId !== primary.symbolVersionId) errors.push("symbol version mismatch");
  if (snapshot.footprint?.versionId !== primary.footprintVersionId) errors.push("footprint version mismatch");
  if (snapshot.mapping?.id !== primary.mappingCertificateId) errors.push("mapping certificate mismatch");
  for (const asset of [snapshot.symbol, ...(snapshot.footprint ? [snapshot.footprint] : []), ...snapshot.models]) {
    const blob = snapshot.assetBlobs.find((item) => item.id === asset.rawContentObjectId);
    if (!blob) errors.push(`missing raw object ${asset.rawContentObjectId}`);
    else if (blob.contentHash !== asset.contentHash) errors.push(`raw object hash binding mismatch for ${asset.versionId}`);
  }
  if (snapshot.exactPart && snapshot.exactPart.id !== revision.exactPartId) errors.push("exact part identity mismatch");
  if (snapshot.genericDevice && snapshot.genericDevice.id !== revision.genericDeviceId) errors.push("generic device identity mismatch");
  return errors.sort();
}

