import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import {
  atomicCadAssets,
  atomicClaims,
  atomicEvidence,
  atomicExactParts,
  atomicGenericDevices,
  atomicFamilies,
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
import type {
  ApplicationGuidance,
  AtomicPartRevision,
  EngineeringClaim,
  EvidenceRef,
  ExactManufacturerPart,
  FootprintAssetVersion,
  GenericDevice,
  LicenseRecord,
  Manufacturer,
  ManufacturerFamily,
  MappingCertificate,
  ModelAssetVersion,
  PortableAtomicSnapshot,
  SourceRecord,
  SourceIdentity,
  SupplierPart,
  SupplierOfferSnapshot,
  SymbolAssetVersion,
} from "./types";

import { fixtureContainer } from "@/app/lib/fixture-runtime/container";
import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode";
function oneOfKind<T extends { kind: string }>(rows: Array<{ kind: string; payload: Record<string, unknown> }>, kind: T["kind"]): T | undefined {
  return rows.find((row) => row.kind === kind)?.payload as T | undefined;
}

/** Server-only reconstruction of the immutable portable snapshot from Stage 5 tables. */
export async function loadPublishedPortableSnapshot(revisionId: string): Promise<PortableAtomicSnapshot | null> {
  // [B16-C §5] fixture runtime: the committed blinker catalog's published revisions (no database).
  if (fixtureRuntimeEnabled()) return structuredClone(fixtureContainer().catalog.snapshots.get(revisionId) ?? null);
  const db = getDb();
  const [revisionRow] = await db.select({ revision: atomicPartRevisions.revisionData })
    .from(atomicPartRevisions)
    .where(and(eq(atomicPartRevisions.id, revisionId), eq(atomicPartRevisions.publicationState, "published")))
    .limit(1);
  if (!revisionRow) return null;
  const revision = revisionRow.revision as AtomicPartRevision;
  const primary = revision.cadBundles.find((bundle) => bundle.disposition === "primary_approved") ?? revision.cadBundles[0];
  if (!primary) return null;
  const assetIds = [primary.symbolVersionId, ...(primary.footprintVersionId ? [primary.footprintVersionId] : []), ...primary.modelVersionIds];
  const assetRows = assetIds.length
    ? await db.select({ kind: atomicCadAssets.kind, payload: atomicCadAssets.payload }).from(atomicCadAssets).where(inArray(atomicCadAssets.versionId, assetIds))
    : [];
  const symbol = oneOfKind<SymbolAssetVersion>(assetRows, "symbol");
  if (!symbol || symbol.versionId !== primary.symbolVersionId) return null;
  const footprint = primary.footprintVersionId ? oneOfKind<FootprintAssetVersion>(assetRows, "footprint") : undefined;
  const models = assetRows.filter((row) => row.kind === "model").map((row) => row.payload as unknown as ModelAssetVersion);

  let mapping: MappingCertificate | undefined;
  if (primary.mappingCertificateId) {
    const [row] = await db.select({ certificate: atomicMappingCertificates.certificate })
      .from(atomicMappingCertificates)
      .where(and(eq(atomicMappingCertificates.id, primary.mappingCertificateId), eq(atomicMappingCertificates.state, "approved")))
      .limit(1);
    mapping = row?.certificate;
  }

  let exactPart: ExactManufacturerPart | undefined;
  let manufacturer: Manufacturer | undefined;
  let family: ManufacturerFamily | undefined;
  if (revision.exactPartId) {
    const [partRow] = await db.select().from(atomicExactParts).where(eq(atomicExactParts.id, revision.exactPartId)).limit(1);
    if (partRow) {
      exactPart = {
        id: partRow.id,
        manufacturerId: partRow.manufacturerId,
        exactMpn: partRow.exactMpn,
        normalizedSearchKey: partRow.normalizedSearchKey,
        familyId: partRow.familyId ?? undefined,
        state: partRow.state,
        aliasEvidenceIds: [],
        ...(partRow.payload as Partial<ExactManufacturerPart>),
      };
      const [manufacturerRow] = await db.select().from(atomicManufacturers).where(eq(atomicManufacturers.id, partRow.manufacturerId)).limit(1);
      if (manufacturerRow) manufacturer = { id: manufacturerRow.id, canonicalName: manufacturerRow.canonicalName, aliases: manufacturerRow.aliases, officialDomains: manufacturerRow.officialDomains };
      if (partRow.familyId) {
        const [familyRow] = await db.select().from(atomicFamilies).where(eq(atomicFamilies.id, partRow.familyId)).limit(1);
        if (familyRow) family = { id: familyRow.id, manufacturerId: familyRow.manufacturerId, publishedName: familyRow.publishedName, sourceEvidenceIds: familyRow.evidenceIds };
      }
    }
  }
  let genericDevice: GenericDevice | undefined;
  if (revision.genericDeviceId) {
    const [row] = await db.select().from(atomicGenericDevices).where(eq(atomicGenericDevices.id, revision.genericDeviceId)).limit(1);
    if (row) genericDevice = { id: row.id, name: row.name, category: row.category, ...(row.payload as Partial<GenericDevice>) };
  }

  const claims = revision.claimIds.length
    ? (await db.select({ claim: atomicClaims.claim }).from(atomicClaims).where(inArray(atomicClaims.id, revision.claimIds))).map((row) => row.claim as EngineeringClaim)
    : [];
  const guidance = revision.guidanceIds.length
    ? (await db.select({ guidance: atomicGuidance.guidance }).from(atomicGuidance).where(inArray(atomicGuidance.id, revision.guidanceIds))).map((row) => row.guidance as ApplicationGuidance)
    : [];
  const licenses = revision.licenseIds.length
    ? (await db.select({ record: atomicLicenses.record }).from(atomicLicenses).where(inArray(atomicLicenses.id, revision.licenseIds))).map((row) => row.record as LicenseRecord)
    : [];
  const offerSnapshots = revision.offerSnapshotIds.length
    ? (await db.select({ snapshot: atomicOfferSnapshots.snapshot }).from(atomicOfferSnapshots).where(inArray(atomicOfferSnapshots.id, revision.offerSnapshotIds))).map((row) => row.snapshot as unknown as SupplierOfferSnapshot)
    : [];
  const evidenceIds = [...new Set([...claims.flatMap((claim) => claim.evidenceIds), ...guidance.flatMap((item) => item.evidenceIds), ...(mapping?.evidenceIds ?? [])])];
  const evidence = evidenceIds.length
    ? (await db.select({ record: atomicEvidence.record }).from(atomicEvidence).where(inArray(atomicEvidence.id, evidenceIds))).map((row) => row.record as EvidenceRef)
    : [];
  const sourceRecordIds = [...new Set([...evidence.map((item) => item.sourceRecordId), ...assetRows.map((row) => (row.payload as unknown as { origin?: { sourceRecordId?: string } }).origin?.sourceRecordId).filter((id): id is string => Boolean(id))])];
  const sourceRecords = sourceRecordIds.length
    ? (await db.select({ record: atomicSourceRecords.record }).from(atomicSourceRecords).where(inArray(atomicSourceRecords.id, sourceRecordIds))).map((row) => row.record as SourceRecord)
    : [];
  const rawObjectIds = [symbol.rawContentObjectId, ...(footprint ? [footprint.rawContentObjectId] : []), ...models.map((model) => model.rawContentObjectId)];
  const assetBlobs = rawObjectIds.length
    ? (await db.select({ record: atomicRawObjects.record }).from(atomicRawObjects).where(inArray(atomicRawObjects.id, rawObjectIds))).map((row) => row.record)
    : [];
  if (assetBlobs.length !== new Set(rawObjectIds).size) return null;
  const sourceIds = [...new Set(sourceRecords.map((record) => record.sourceId))];
  const sources = sourceIds.length
    ? (await db.select().from(atomicSources).where(inArray(atomicSources.id, sourceIds))).map((row): SourceIdentity => ({ id: row.id, sourceClass: row.sourceClass as SourceIdentity["sourceClass"], name: row.name, officialDomains: row.officialDomains, licenseId: row.licenseId }))
    : [];
  const supplierPartIds = [...new Set(offerSnapshots.map((offer) => offer.supplierPartId))];
  const supplierParts = supplierPartIds.length
    ? (await db.select().from(atomicSupplierParts).where(inArray(atomicSupplierParts.id, supplierPartIds))).map((row) => row.payload as unknown as SupplierPart)
    : [];
  return {
    schemaVersion: 1,
    atomicRevision: revision,
    manufacturer,
    family,
    exactPart,
    genericDevice,
    symbol,
    footprint,
    models,
    mapping,
    claims,
    guidance,
    licenses,
    evidence,
    sourceRecords,
    sources,
    supplierParts,
    assetBlobs,
    offerSnapshots,
    capturedAt: new Date().toISOString(),
  };
}
