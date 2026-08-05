import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import {
  atomicCadAssets,
  atomicClaims,
  atomicEvidence,
  atomicExactParts,
  atomicGuidance,
  atomicGenericDevices,
  atomicLicenses,
  atomicMappingCertificates,
  atomicOfferSnapshots,
  atomicPartRevisions,
} from "@/app/lib/db/schema";
import type {
  ApplicationGuidance,
  AtomicPartRevision,
  ComponentQuery,
  EngineeringClaim,
  EvidenceRef,
  ExactManufacturerPart,
  FootprintAssetVersion,
  LicenseRecord,
  MappingCertificate,
  ModelAssetVersion,
  SupplierOfferSnapshot,
  SymbolAssetVersion,
} from "./types";
import { semanticHash } from "./stable";
import { searchAtomicCatalog, type SearchCatalogView } from "./search";

export async function loadAtomicSearchView(): Promise<SearchCatalogView> {
  const db = getDb();
  const revisionRows = await db.select({ revision: atomicPartRevisions.revisionData })
    .from(atomicPartRevisions)
    .where(eq(atomicPartRevisions.publicationState, "published"));
  const revisions = revisionRows.map((row) => row.revision as AtomicPartRevision).sort((a, b) => a.id.localeCompare(b.id));
  const assetIds = [...new Set(revisions.flatMap((revision) => revision.cadBundles.flatMap((bundle) => [bundle.symbolVersionId, ...(bundle.footprintVersionId ? [bundle.footprintVersionId] : []), ...bundle.modelVersionIds])))];
  const mappingIds = [...new Set(revisions.flatMap((revision) => revision.cadBundles.map((bundle) => bundle.mappingCertificateId).filter((id): id is string => Boolean(id))))];
  const claimIds = [...new Set(revisions.flatMap((revision) => revision.claimIds))];
  const guidanceIds = [...new Set(revisions.flatMap((revision) => revision.guidanceIds))];
  const licenseIds = [...new Set(revisions.flatMap((revision) => revision.licenseIds))];
  const exactPartIds = [...new Set(revisions.map((revision) => revision.exactPartId).filter((id): id is string => Boolean(id)))];
  const offerIds = [...new Set(revisions.flatMap((revision) => revision.offerSnapshotIds))];
  const genericIds = [...new Set(revisions.map((revision) => revision.genericDeviceId).filter((id): id is string => Boolean(id)))];

  const [assetRows, mappingRows, claimRows, guidanceRows, licenseRows, exactRows, offerRows, genericRows] = await Promise.all([
    assetIds.length ? db.select({ kind: atomicCadAssets.kind, payload: atomicCadAssets.payload }).from(atomicCadAssets).where(inArray(atomicCadAssets.versionId, assetIds)) : [],
    mappingIds.length ? db.select({ certificate: atomicMappingCertificates.certificate }).from(atomicMappingCertificates).where(inArray(atomicMappingCertificates.id, mappingIds)) : [],
    claimIds.length ? db.select({ claim: atomicClaims.claim }).from(atomicClaims).where(inArray(atomicClaims.id, claimIds)) : [],
    guidanceIds.length ? db.select({ guidance: atomicGuidance.guidance }).from(atomicGuidance).where(inArray(atomicGuidance.id, guidanceIds)) : [],
    licenseIds.length ? db.select({ license: atomicLicenses.record }).from(atomicLicenses).where(inArray(atomicLicenses.id, licenseIds)) : [],
    exactPartIds.length ? db.select().from(atomicExactParts).where(inArray(atomicExactParts.id, exactPartIds)) : [],
    offerIds.length ? db.select({ offer: atomicOfferSnapshots.snapshot }).from(atomicOfferSnapshots).where(inArray(atomicOfferSnapshots.id, offerIds)) : [],
    genericIds.length ? db.select({ id: atomicGenericDevices.id, category: atomicGenericDevices.category }).from(atomicGenericDevices).where(inArray(atomicGenericDevices.id, genericIds)) : [],
  ]);
  const claims = (claimRows as Array<{ claim: EngineeringClaim }>).map((row) => row.claim);
  const guidance = (guidanceRows as Array<{ guidance: ApplicationGuidance }>).map((row) => row.guidance);
  const evidenceIds = [...new Set([...claims.flatMap((claim) => claim.evidenceIds), ...guidance.flatMap((item) => item.evidenceIds), ...(mappingRows as Array<{ certificate: MappingCertificate }>).flatMap((row) => row.certificate.evidenceIds)])];
  const evidenceRows = evidenceIds.length
    ? await db.select({ evidence: atomicEvidence.record }).from(atomicEvidence).where(inArray(atomicEvidence.id, evidenceIds))
    : [];
  const symbols = new Map<string, SymbolAssetVersion>();
  const footprints = new Map<string, FootprintAssetVersion>();
  const models = new Map<string, ModelAssetVersion>();
  for (const row of assetRows as Array<{ kind: string; payload: Record<string, unknown> }>) {
    if (row.kind === "symbol") { const item = row.payload as unknown as SymbolAssetVersion; symbols.set(item.versionId, item); }
    else if (row.kind === "footprint") { const item = row.payload as unknown as FootprintAssetVersion; footprints.set(item.versionId, item); }
    else if (row.kind === "model") { const item = row.payload as unknown as ModelAssetVersion; models.set(item.versionId, item); }
  }
  const exactParts = new Map<string, ExactManufacturerPart>();
  for (const row of exactRows) exactParts.set(row.id, {
    id: row.id,
    manufacturerId: row.manufacturerId,
    exactMpn: row.exactMpn,
    normalizedSearchKey: row.normalizedSearchKey,
    familyId: row.familyId ?? undefined,
    state: row.state,
    aliasEvidenceIds: [],
    ...(row.payload as Partial<ExactManufacturerPart>),
  });
  const ids = revisions.map((revision) => revision.id);
  const exactCategory = new Map(exactRows.map((row) => [row.id, typeof row.payload.category === "string" ? row.payload.category : undefined]));
  const genericCategory = new Map(genericRows.map((row) => [row.id, row.category]));
  const categoryByRevisionId = new Map(revisions.flatMap((revision) => {
    const category = revision.exactPartId ? exactCategory.get(revision.exactPartId) : revision.genericDeviceId ? genericCategory.get(revision.genericDeviceId) : undefined;
    return category ? [[revision.id, category] as const] : [];
  }));
  return {
    snapshotId: `catalog_${semanticHash(ids)}`,
    revisions: new Map(revisions.map((revision) => [revision.id, revision])),
    exactParts,
    publishedRevisionIds: new Set(ids),
    symbols,
    footprints,
    models,
    mappings: new Map((mappingRows as Array<{ certificate: MappingCertificate }>).map((row) => [row.certificate.id, row.certificate])),
    claims: new Map(claims.map((claim) => [claim.id, claim])),
    licenses: new Map((licenseRows as Array<{ license: LicenseRecord }>).map((row) => [row.license.id, row.license])),
    offerSnapshots: new Map((offerRows as Array<{ offer: SupplierOfferSnapshot }>).map((row) => [row.offer.id, row.offer])),
    guidance: new Map(guidance.map((item) => [item.id, item])),
    evidence: new Map((evidenceRows as Array<{ evidence: EvidenceRef }>).map((row) => [row.evidence.id, row.evidence])),
    categoryByRevisionId,
  };
}

export async function searchPublishedAtomicCatalog(query: ComponentQuery) {
  const view = await loadAtomicSearchView();
  return { snapshotId: view.snapshotId, results: searchAtomicCatalog(view, query) };
}
