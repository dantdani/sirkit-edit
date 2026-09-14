import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
  atomicRevisionStatusEvents,
  atomicSourceRecords,
  atomicRawObjects,
  atomicSources,
  atomicSupplierParts,
  libraries,
  parts,
  partsAtomicLinks,
} from "@/app/lib/db/schema";
import { canonicalExactMpn } from "./identity";
import { readModeSql } from "./revision-status-sql";
import { revisionStatusFromEvents, type AtomicRevisionReadMode, type AtomicRevisionStatus } from "./revision-status";
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

const STATUS_BATCH = 500;

/** [B19-E E4 review] A catalog part a publication link names: its MPN, its KiCad symbol and the value keys already linked. */
export interface AtomicLinkTargetRow {
  partId: string;
  mpn: string | null;
  library: string;
  name: string;
  linkedValueKeys: string[];
}

const PART_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_TARGET_BATCH = 64;

/**
 * [B19-E E4 review] The catalog parts publication links name, read for the review (a link must name the exact part and its KiCad
 * symbol, and never repoint a value that already has a link — whatever revision it points at). Ids that name no part are absent.
 */
export async function loadAtomicLinkTargets(partIds: readonly string[]): Promise<Map<string, AtomicLinkTargetRow>> {
  const ids = [...new Set(partIds.filter((id) => typeof id === "string" && PART_ID.test(id)).map((id) => id.toLowerCase()))].slice(0, LINK_TARGET_BATCH);
  const out = new Map<string, AtomicLinkTargetRow>();
  if (ids.length === 0) return out;
  const db = getDb();
  const rows = await db.select({ partId: parts.id, mpn: parts.mpn, name: parts.name, library: libraries.name }).from(parts).innerJoin(libraries, eq(parts.libraryId, libraries.id)).where(inArray(parts.id, ids));
  const links = await db.select({ partId: partsAtomicLinks.partId, valueKey: partsAtomicLinks.valueKey }).from(partsAtomicLinks).where(inArray(partsAtomicLinks.partId, ids));
  for (const row of rows) out.set(row.partId, { partId: row.partId, mpn: row.mpn, library: row.library, name: row.name, linkedValueKeys: links.filter((link) => link.partId === row.partId).map((link) => link.valueKey).sort() });
  return out;
}

/** [B19-E E4] The catalog identities a new revision of an exact part must reuse, and the revision number to start after. */
export interface AtomicAuthoringIdentityRow {
  manufacturerId: string | null;
  exactPartId: string | null;
  logicalPartId: string | null;
  latestRevision: number;
}

/**
 * [B19-E E4] The manufacturer (by normalized name), the exact part (by manufacturer and exact MPN, case-folded as OD-34 does) and
 * the logical part with its latest revision number, so a publication reuses the identities the unique indexes already hold —
 * a new id beside an existing row would be dropped by the publication's conflict-ignore inserts and fail its foreign keys.
 */
export async function loadAtomicAuthoringIdentity(input: { exactMpn: string; manufacturerName: string | null }): Promise<AtomicAuthoringIdentityRow> {
  const none: AtomicAuthoringIdentityRow = { manufacturerId: null, exactPartId: null, logicalPartId: null, latestRevision: 0 };
  const normalizedName = input.manufacturerName?.normalize("NFKC").trim().toUpperCase();
  if (!normalizedName) return none;
  const db = getDb();
  const [manufacturer] = await db.select({ id: atomicManufacturers.id }).from(atomicManufacturers).where(eq(atomicManufacturers.normalizedName, normalizedName)).limit(1);
  if (!manufacturer) return none;
  let exactMpn: string;
  try {
    exactMpn = canonicalExactMpn(input.exactMpn);
  } catch {
    return { ...none, manufacturerId: manufacturer.id };
  }
  const [exactPart] = await db.select({ id: atomicExactParts.id }).from(atomicExactParts)
    .where(and(eq(atomicExactParts.manufacturerId, manufacturer.id), sql`upper(${atomicExactParts.exactMpn}) = ${exactMpn}`)).limit(1);
  if (!exactPart) return { ...none, manufacturerId: manufacturer.id };
  const [latest] = await db.select({ logicalPartId: atomicPartRevisions.logicalPartId, revision: atomicPartRevisions.revision }).from(atomicPartRevisions)
    .where(eq(atomicPartRevisions.exactPartId, exactPart.id)).orderBy(desc(atomicPartRevisions.revision)).limit(1);
  if (!latest) return { manufacturerId: manufacturer.id, exactPartId: exactPart.id, logicalPartId: null, latestRevision: 0 };
  const [top] = await db.select({ revision: sql<number>`max(${atomicPartRevisions.revision})` }).from(atomicPartRevisions).where(eq(atomicPartRevisions.logicalPartId, latest.logicalPartId));
  return { manufacturerId: manufacturer.id, exactPartId: exactPart.id, logicalPartId: latest.logicalPartId, latestRevision: Number(top?.revision ?? latest.revision) };
}

/**
 * [B19-E E3] The catalog status of each published revision named (published, deprecated, superseded or revoked, with its
 * successor and whether it is selectable or pinnable). Ids that name no published revision are absent from the map.
 */
export async function loadAtomicRevisionStatus(revisionIds: readonly string[]): Promise<Map<string, AtomicRevisionStatus>> {
  const unique = [...new Set(revisionIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  const statuses = new Map<string, AtomicRevisionStatus>();
  if (unique.length === 0) return statuses;
  // the fixture runtime's committed catalog is published and never withdrawn
  if (fixtureRuntimeEnabled()) {
    const snapshots = fixtureContainer().catalog.snapshots;
    for (const id of unique) {
      const snapshot = snapshots.get(id);
      if (snapshot) statuses.set(id, revisionStatusFromEvents(id, snapshot.atomicRevision.logicalPartId, []));
    }
    return statuses;
  }
  const db = getDb();
  for (let index = 0; index < unique.length; index += STATUS_BATCH) {
    const batch = unique.slice(index, index + STATUS_BATCH);
    const rows = await db.select({ id: atomicPartRevisions.id, logicalPartId: atomicPartRevisions.logicalPartId })
      .from(atomicPartRevisions)
      .where(and(inArray(atomicPartRevisions.id, batch), eq(atomicPartRevisions.publicationState, "published")));
    if (rows.length === 0) continue;
    const events = await db.select({ revisionId: atomicRevisionStatusEvents.revisionId, toState: atomicRevisionStatusEvents.toState, successorRevisionId: atomicRevisionStatusEvents.successorRevisionId, at: atomicRevisionStatusEvents.at, reason: atomicRevisionStatusEvents.reason })
      .from(atomicRevisionStatusEvents)
      .where(inArray(atomicRevisionStatusEvents.revisionId, rows.map((row) => row.id)));
    for (const row of rows) statuses.set(row.id, revisionStatusFromEvents(row.id, row.logicalPartId, events.filter((event) => event.revisionId === row.id)));
  }
  return statuses;
}

/**
 * Server-only reconstruction of the immutable portable snapshot from Stage 5 tables, for a revision an EXISTING pin names:
 * [B19-E E3] published and not revoked — deprecated and superseded revisions keep materializing, syncing and exporting (OD-38).
 */
export async function loadPublishedPortableSnapshot(revisionId: string): Promise<PortableAtomicSnapshot | null> {
  return loadPortableSnapshot(revisionId, "pinned");
}

/** [B19-E E3] The portable snapshot for a NEW selection, binding or link: published and never withdrawn. */
export async function loadSelectablePortableSnapshot(revisionId: string): Promise<PortableAtomicSnapshot | null> {
  return loadPortableSnapshot(revisionId, "selectable");
}

/**
 * [B19-E E5] The portable snapshot of a revision an existing pin is being moved OFF (a successor diff's from side): published,
 * whatever was withdrawn since, revoked included. It grants nothing — callers read its assets only to describe the move.
 */
export async function loadHistoricalPortableSnapshot(revisionId: string): Promise<PortableAtomicSnapshot | null> {
  return loadPortableSnapshot(revisionId, "historical");
}

async function loadPortableSnapshot(revisionId: string, mode: AtomicRevisionReadMode): Promise<PortableAtomicSnapshot | null> {
  // [B16-C §5] fixture runtime: the committed blinker catalog's published revisions (no database, never withdrawn).
  if (fixtureRuntimeEnabled()) return structuredClone(fixtureContainer().catalog.snapshots.get(revisionId) ?? null);
  const db = getDb();
  const [revisionRow] = await db.select({ revision: atomicPartRevisions.revisionData })
    .from(atomicPartRevisions)
    .where(and(eq(atomicPartRevisions.id, revisionId), eq(atomicPartRevisions.publicationState, "published"), readModeSql(atomicPartRevisions.id, mode)))
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
