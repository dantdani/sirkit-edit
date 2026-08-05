import { getDb } from "@/app/lib/db/client";
import {
  atomicAuditEvents,
  atomicCadAssets,
  atomicClaims,
  atomicEvidence,
  atomicExactParts,
  atomicFamilies,
  atomicGenericDevices,
  atomicGuidance,
  atomicLicenses,
  atomicManufacturers,
  atomicMappingCertificates,
  atomicOfferSnapshots,
  atomicPartRevisions,
  atomicSourceRecords,
  atomicRawObjects,
  atomicSources,
  atomicSupplierParts,
} from "@/app/lib/db/schema";
import type { ApprovalProfile, AuditEvent, PortableAtomicSnapshot } from "./types";
import { semanticHash } from "./stable";
import { evaluateApproval } from "./validation";

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function validDate(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${field} timestamp`);
  return date;
}

export function validatePortableSnapshotForPublication(snapshot: PortableAtomicSnapshot, profile: ApprovalProfile): void {
  const revision = snapshot.atomicRevision;
  if (revision.publicationState !== "published") throw new Error("Only a reviewed published revision may enter the publication transaction");
  const context = {
    symbols: new Map([[snapshot.symbol.versionId, snapshot.symbol]]),
    footprints: new Map(snapshot.footprint ? [[snapshot.footprint.versionId, snapshot.footprint]] : []),
    models: new Map(snapshot.models.map((model) => [model.versionId, model])),
    mappings: new Map(snapshot.mapping ? [[snapshot.mapping.id, snapshot.mapping]] : []),
    claims: new Map(snapshot.claims.map((claim) => [claim.id, claim])),
    licenses: new Map(snapshot.licenses.map((license) => [license.id, license])),
    offerSnapshots: new Map(snapshot.offerSnapshots.map((offer) => [offer.id, offer])),
    evidence: new Map(snapshot.evidence.map((item) => [item.id, item])),
    guidance: new Map(snapshot.guidance.map((item) => [item.id, item])),
  };
  const approval = evaluateApproval(revision, profile, context);
  if (!approval.eligible) throw new Error(`Atomic publication rejected: ${approval.blockers.join("; ")}`);
  if (snapshot.exactPart && snapshot.exactPart.manufacturerId !== snapshot.manufacturer?.id) throw new Error("Exact part manufacturer is missing or mismatched");
  if (snapshot.exactPart?.familyId && snapshot.exactPart.familyId !== snapshot.family?.id) throw new Error("Exact part family is missing or mismatched");
  if (snapshot.family && snapshot.family.manufacturerId !== snapshot.manufacturer?.id) throw new Error("Part family manufacturer is mismatched");
  for (const record of snapshot.sourceRecords) {
    if (!snapshot.sources.some((source) => source.id === record.sourceId)) throw new Error(`Source identity ${record.sourceId} is missing from portable snapshot`);
  }
  const sourceRecordIds = new Set(snapshot.sourceRecords.map((record) => record.id));
  const licenseIds = new Set(snapshot.licenses.map((license) => license.id));
  for (const asset of [snapshot.symbol, ...(snapshot.footprint ? [snapshot.footprint] : []), ...snapshot.models]) {
    if (!sourceRecordIds.has(asset.origin.sourceRecordId)) throw new Error(`Asset ${asset.versionId} source record is missing`);
    if (!licenseIds.has(asset.origin.licenseId)) throw new Error(`Asset ${asset.versionId} license is missing`);
    const blob = snapshot.assetBlobs.find((item) => item.id === asset.rawContentObjectId);
    if (!blob || blob.contentHash !== asset.contentHash) throw new Error(`Asset ${asset.versionId} raw content is missing or hash-mismatched`);
    if (blob.confidential) throw new Error(`Confidential asset ${asset.versionId} cannot be published`);
  }
  for (const part of snapshot.supplierParts) {
    if (part.exactPartId !== snapshot.exactPart?.id) throw new Error(`Supplier part ${part.id} is bound to another exact part`);
  }
}

/**
 * Production database publication boundary. Every dependent identity, source,
 * asset, claim, certificate, revision, and audit record commits together.
 * PostgreSQL rolls the transaction back on any validation/index/FK failure.
 */
export async function publishPortableAtomicSnapshot(input: {
  snapshot: PortableAtomicSnapshot;
  actorId: string;
  actorRole: "publisher" | "admin";
  requiredProfile: ApprovalProfile;
  reason: string;
}): Promise<{ revisionId: string; auditId: string }> {
  validatePortableSnapshotForPublication(input.snapshot, input.requiredProfile);
  if (!input.reason.trim()) throw new Error("Publication reason is required");
  const { snapshot } = input;
  const revision = snapshot.atomicRevision;
  const at = new Date();
  const audit: AuditEvent = {
    id: `audit_${semanticHash({ revisionId: revision.id, actorId: input.actorId, at: at.toISOString(), reason: input.reason })}`,
    at: at.toISOString(),
    actorId: input.actorId,
    action: "publish",
    objectType: "atomic_part_revision",
    objectId: revision.id,
    detail: { profile: input.requiredProfile, reason: input.reason, semanticHash: revision.semanticHash },
  };

  await getDb().transaction(async (tx) => {
    if (snapshot.licenses.length) await tx.insert(atomicLicenses).values(snapshot.licenses.map((license) => ({
      id: license.id,
      spdxId: license.spdxId,
      disposition: license.exportDisposition,
      record: license,
    }))).onConflictDoNothing();

    if (snapshot.manufacturer) await tx.insert(atomicManufacturers).values({
      id: snapshot.manufacturer.id,
      canonicalName: snapshot.manufacturer.canonicalName,
      normalizedName: snapshot.manufacturer.canonicalName.normalize("NFKC").trim().toUpperCase(),
      aliases: snapshot.manufacturer.aliases,
      officialDomains: snapshot.manufacturer.officialDomains,
    }).onConflictDoNothing();
    if (snapshot.family) await tx.insert(atomicFamilies).values({
      id: snapshot.family.id,
      manufacturerId: snapshot.family.manufacturerId,
      publishedName: snapshot.family.publishedName,
      evidenceIds: snapshot.family.sourceEvidenceIds,
    }).onConflictDoNothing();
    if (snapshot.exactPart) await tx.insert(atomicExactParts).values({
      id: snapshot.exactPart.id,
      manufacturerId: snapshot.exactPart.manufacturerId,
      exactMpn: snapshot.exactPart.exactMpn,
      normalizedSearchKey: snapshot.exactPart.normalizedSearchKey,
      familyId: snapshot.exactPart.familyId,
      state: snapshot.exactPart.state,
      payload: asRecord(snapshot.exactPart),
    }).onConflictDoNothing();
    if (snapshot.genericDevice) await tx.insert(atomicGenericDevices).values({
      id: snapshot.genericDevice.id,
      name: snapshot.genericDevice.name,
      category: snapshot.genericDevice.category,
      payload: asRecord(snapshot.genericDevice),
    }).onConflictDoNothing();

    if (snapshot.sources.length) await tx.insert(atomicSources).values(snapshot.sources.map((source) => ({
      id: source.id,
      sourceClass: source.sourceClass,
      name: source.name,
      officialDomains: source.officialDomains,
      licenseId: source.licenseId,
    }))).onConflictDoNothing();
    if (snapshot.sourceRecords.length) await tx.insert(atomicSourceRecords).values(snapshot.sourceRecords.map((record) => ({
      id: record.id,
      sourceId: record.sourceId,
      revision: record.revision,
      contentHash: record.contentHash,
      retrievedAt: validDate(record.retrievedAt, "source retrieval"),
      expiresAt: record.expiresAt ? validDate(record.expiresAt, "source expiration") : undefined,
      record,
    }))).onConflictDoNothing();
    if (snapshot.assetBlobs.length) await tx.insert(atomicRawObjects).values(snapshot.assetBlobs.map((blob) => ({
      id: blob.id,
      contentHash: blob.contentHash,
      mediaType: blob.mediaType,
      encoding: blob.encoding,
      content: blob.content,
      bytes: blob.bytes,
      licenseId: blob.licenseId,
      confidential: blob.confidential,
      record: blob,
    }))).onConflictDoNothing();
    if (snapshot.evidence.length) await tx.insert(atomicEvidence).values(snapshot.evidence.map((item) => ({
      id: item.id,
      sourceRecordId: item.sourceRecordId,
      locator: item.locator,
      record: item,
    }))).onConflictDoNothing();

    const assets = [snapshot.symbol, ...(snapshot.footprint ? [snapshot.footprint] : []), ...snapshot.models];
    await tx.insert(atomicCadAssets).values(assets.map((asset) => ({
      versionId: asset.versionId,
      logicalAssetId: asset.logicalAssetId,
      kind: asset.kind,
      contentHash: asset.contentHash,
      semanticHash: "semanticHash" in asset ? asset.semanticHash : asset.contentHash,
      sourceRecordId: asset.origin.sourceRecordId,
      licenseId: asset.origin.licenseId,
      validationState: asset.kind === "model" ? asset.inspectionState : asset.validationState,
      rawObjectId: asset.rawContentObjectId,
      payload: asRecord(asset),
    }))).onConflictDoNothing();

    if (snapshot.claims.length) await tx.insert(atomicClaims).values(snapshot.claims.map((claim) => ({ id: claim.id, property: claim.property, facet: claim.facet, state: claim.state, claim }))).onConflictDoNothing();
    if (snapshot.guidance.length) await tx.insert(atomicGuidance).values(snapshot.guidance.map((item) => ({ id: item.id, category: item.category, status: item.status, guidance: item }))).onConflictDoNothing();
    if (snapshot.mapping) await tx.insert(atomicMappingCertificates).values({
      id: snapshot.mapping.id,
      symbolVersionId: snapshot.mapping.symbolVersionId,
      footprintVersionId: snapshot.mapping.footprintVersionId,
      state: snapshot.mapping.state,
      semanticHash: snapshot.mapping.semanticHash,
      certificate: snapshot.mapping,
    }).onConflictDoNothing();

    if (snapshot.supplierParts.length) await tx.insert(atomicSupplierParts).values(snapshot.supplierParts.map((part) => ({
      id: part.id,
      supplierId: part.supplierId,
      supplierSku: part.supplierSku,
      exactPartId: part.exactPartId,
      packaging: part.packaging,
      region: part.region,
      payload: asRecord(part),
    }))).onConflictDoNothing();
    if (snapshot.offerSnapshots.length) await tx.insert(atomicOfferSnapshots).values(snapshot.offerSnapshots.map((offer) => ({
      id: offer.id,
      supplierPartId: offer.supplierPartId,
      observedAt: validDate(offer.observedAt, "offer observation"),
      expiresAt: validDate(offer.expiresAt, "offer expiration"),
      snapshot: asRecord(offer),
    }))).onConflictDoNothing();

    await tx.insert(atomicPartRevisions).values({
      id: revision.id,
      logicalPartId: revision.logicalPartId,
      revision: revision.revision,
      exactPartId: revision.exactPartId,
      genericDeviceId: revision.genericDeviceId,
      publicationState: revision.publicationState,
      semanticHash: revision.semanticHash,
      revisionData: revision,
      createdAt: validDate(revision.createdAt, "revision creation"),
      createdBy: revision.createdBy,
    }).onConflictDoNothing();
    await tx.insert(atomicAuditEvents).values({
      id: audit.id,
      objectType: audit.objectType,
      objectId: audit.objectId,
      action: audit.action,
      actorId: audit.actorId,
      at,
      event: audit,
    });
  });
  return { revisionId: revision.id, auditId: audit.id };
}
