import { parseKicadMod } from "../pcb/kicad-mod";
import { assertBoundedSExpression } from "../atomic/security";
import { sha256 } from "../atomic/stable";
import { loadPublishedPortableSnapshot } from "../atomic/server-catalog";
import type { MappingCertificate, PortableAtomicSnapshot } from "../atomic/types";
import type { PcbSyncAuthoritativeSnapshot, PcbSyncFootprintMaterialization, PcbSyncResourceProvider, PcbSyncSchematicComponent, PcbSyncSnapshotProvider, VerifiedPinPadMappingArtifact } from "./types";
import type { FootprintResolutionResult } from "../footprint-resolver/types";
import { pcbSyncDigest } from "./stable";
import { compareCodePoints } from "@/app/lib/stable-compare";

export class InMemoryPcbSyncSnapshotProvider implements PcbSyncSnapshotProvider {
  constructor(private readonly snapshots: PcbSyncAuthoritativeSnapshot[] = []) {}
  set(snapshot: PcbSyncAuthoritativeSnapshot): void {
    const key = `${snapshot.tenantId}\0${snapshot.projectId}\0${snapshot.branchId}\0${snapshot.designId}\0${snapshot.assemblyVariantId}`;
    const index = this.snapshots.findIndex((item) => `${item.tenantId}\0${item.projectId}\0${item.branchId}\0${item.designId}\0${item.assemblyVariantId}` === key);
    if (index >= 0) this.snapshots[index] = structuredClone(snapshot); else this.snapshots.push(structuredClone(snapshot));
  }
  async acquire(request: Parameters<PcbSyncSnapshotProvider["acquire"]>[0], signal?: AbortSignal): Promise<PcbSyncAuthoritativeSnapshot> {
    if (signal?.aborted) throw new Error("PS_REQUEST_CANCELLED");
    const found = this.snapshots.find((item) => item.tenantId === request.tenantId && item.projectId === request.projectId && item.branchId === request.branchId && item.designId === request.designId && item.assemblyVariantId === request.assemblyVariantId);
    if (!found) throw new Error("PS_SNAPSHOT_NOT_FOUND");
    return structuredClone(found);
  }
}

function mappingArtifact(snapshot: PortableAtomicSnapshot, certificate: MappingCertificate, component: PcbSyncSchematicComponent, footprintContentDigest: string): VerifiedPinPadMappingArtifact | null {
  if (!snapshot.symbol || !snapshot.footprint || certificate.state !== "approved") return null;
  const pinNumberById = new Map(snapshot.symbol.pins.map((pin) => [pin.id, pin.number]));
  const padNumberById = new Map(snapshot.footprint.pads.map((pad) => [pad.id, pad.number]));
  const entries = certificate.entries.flatMap((entry) => entry.symbolPinIds.map((symbolPinId) => {
    const symbolPinNumber = pinNumberById.get(symbolPinId);
    if (!symbolPinNumber) return null;
    const padNumbers = [...new Set([...entry.physicalPadIds.map((id) => padNumberById.get(id)).filter((value): value is string => Boolean(value)), ...entry.logicalPadNumbers])].sort();
    const mappingKind = entry.classification === "nc" || entry.classification === "dnc" || entry.classification === "nu" ? "intentional-no-connect" as const : entry.classification === "exposed_thermal" ? "exposed-pad" as const : "electrical" as const;
    const pinInstanceId = component.pins.find((pin) => pin.number === symbolPinNumber)?.pinInstanceId;
    return { symbolPinNumber, ...(pinInstanceId ? { pinInstanceId } : {}), padNumbers, mappingKind };
  }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)));
  const base = {
    schemaVersion: "sirkit.verified-pin-pad-mapping.v1" as const,
    mappingCertificateId: certificate.id,
    verifierVersion: certificate.validatorVersion,
    state: "verified" as const,
    symbolAssetVersionId: certificate.symbolVersionId,
    footprintAssetVersionId: certificate.footprintVersionId,
    footprintContentDigest,
    entries: entries.sort((a, b) => compareCodePoints(a.symbolPinNumber, b.symbolPinNumber)),
    mechanicalPadNumbers: snapshot.footprint.pads.filter((pad) => pad.mechanical).map((pad) => pad.number).sort(),
    evidenceRefs: [...certificate.evidenceIds].sort(),
  };
  return { ...base, artifactDigest: pcbSyncDigest(base) };
}

export class AtomicPcbSyncResourceProvider implements PcbSyncResourceProvider {
  async materialize(component: PcbSyncSchematicComponent, result: FootprintResolutionResult, signal?: AbortSignal): Promise<PcbSyncFootprintMaterialization | null> {
    if (signal?.aborted) throw new Error("PS_REQUEST_CANCELLED");
    const resolved = result.resolvedBinding;
    const revisionId = resolved?.exactPartIdentity?.atomicPartRevisionId;
    if (!resolved || !revisionId || !resolved.pinPadMapping.mappingCertificateId) return null;
    const snapshot = await loadPublishedPortableSnapshot(revisionId);
    if (!snapshot?.footprint || !snapshot.mapping) return null;
    if (snapshot.footprint.versionId !== resolved.footprintAsset.assetVersionId || snapshot.footprint.contentHash !== resolved.footprintAsset.contentDigest || snapshot.mapping.id !== resolved.pinPadMapping.mappingCertificateId) return null;
    const raw = snapshot.assetBlobs.find((item) => item.id === snapshot.footprint?.rawContentObjectId);
    if (!raw || raw.encoding !== "utf8" || raw.contentHash !== resolved.footprintAsset.contentDigest) return null;
    // [B19-D I5d row 47] the geometry comes from these bytes: hash them, and bound them before the recursive parser sees them
    if (sha256(raw.content) !== raw.contentHash) return null;
    try {
      assertBoundedSExpression(raw.content);
    } catch {
      return null;
    }
    const mapping = mappingArtifact(snapshot, snapshot.mapping, component, raw.contentHash);
    if (!mapping) return null;
    const footprintDef = parseKicadMod(raw.content, snapshot.footprint.origin.libraryNickname ?? "Atomic");
    const base = {
      componentInstanceId: component.componentInstanceId,
      bindingRevisionId: resolved.bindingRevisionId,
      assetVersionId: resolved.footprintAsset.assetVersionId,
      assetContentDigest: resolved.footprintAsset.contentDigest,
      ...(resolved.footprintAsset.semanticDigest ? { assetSemanticDigest: resolved.footprintAsset.semanticDigest } : {}),
      footprintFullName: `${footprintDef.libName}:${footprintDef.name}`,
      footprintDef,
      mapping,
    };
    return { ...base, materializationDigest: pcbSyncDigest({ ...base, footprintDef: { libName: footprintDef.libName, name: footprintDef.name, pads: footprintDef.pads } }) };
  }
}

export class InMemoryPcbSyncResourceProvider implements PcbSyncResourceProvider {
  constructor(private readonly records: Record<string, PcbSyncFootprintMaterialization>) {}
  async materialize(component: PcbSyncSchematicComponent, result: FootprintResolutionResult, signal?: AbortSignal): Promise<PcbSyncFootprintMaterialization | null> {
    if (signal?.aborted) throw new Error("PS_REQUEST_CANCELLED");
    const record = this.records[component.componentInstanceId];
    if (!record || result.resolvedBinding?.bindingRevisionId !== record.bindingRevisionId || result.resolvedBinding.footprintAsset.assetVersionId !== record.assetVersionId || result.resolvedBinding.footprintAsset.contentDigest !== record.assetContentDigest) return null;
    return structuredClone(record);
  }
}

