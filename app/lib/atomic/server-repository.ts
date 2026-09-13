import { and, asc, eq } from "drizzle-orm";
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
  atomicRevisionStatusEvents,
  atomicSourceRecords,
  atomicRawObjects,
  atomicSources,
  atomicSupplierParts,
  partsAtomicLinks,
} from "@/app/lib/db/schema";
import type { ApprovalProfile, AtomicPartRevision, AuditEvent, PortableAtomicSnapshot } from "./types";
import { semanticHash, sha256 } from "./stable";
import { evaluateApproval } from "./validation";
import { canonicalExactMpn, MpnIdentityError, normalizeMpnSearchKey } from "./identity";
import { mappingCertificateIntegrityErrors } from "./mapping";
import { parseFootprintAsset, parseSymbolAssets } from "./kicad-assets";
import type { FootprintAssetVersion, RawContentObject, SymbolAssetVersion } from "./types";
import { catalogActorKey, createAtomicRevision, isHumanCatalogActorId, roleMayTransition, TRANSITIONS } from "./catalog";
import { catalogStatusOf, isWithdrawalState, type AtomicCatalogStatus, type AtomicWithdrawalState } from "./revision-status";
import { normalizeValueKey } from "./value-key";

/** [B19-E E3] Only a publisher or an administrator publishes or withdraws a revision (checked at runtime, not only typed). */
const PUBLISHING_ROLES: ReadonlySet<string> = new Set(["publisher", "admin"]);
const MAX_REASON_LENGTH = 2_000;
const MAX_LINKS = 64;
const PART_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AtomicPublicationActor {
  actorId: string;
  actorRole: "publisher" | "admin";
}

/**
 * [B19-E E3] The revision is re-derived through the one constructor that mints revision ids: its semanticHash must be the
 * hash of its content and its id the hash of that content, its number, state, review history and creation. A snapshot can
 * therefore not carry an edited review history or content under an id it did not earn.
 */
function assertRevisionIdentity(revision: AtomicPartRevision): void {
  if (revision.schemaVersion !== 1) throw new Error("Atomic revision schemaVersion is not 1");
  let derived: AtomicPartRevision;
  try {
    const { id: _id, semanticHash: _hash, validatorVersion: _validator, schemaVersion: _schema, ...content } = revision;
    void _id; void _hash; void _validator; void _schema;
    derived = createAtomicRevision(content);
  } catch {
    throw new Error("Atomic revision content cannot be re-derived");
  }
  if (derived.semanticHash !== revision.semanticHash) throw new Error("Atomic revision semanticHash is not the hash of its content");
  if (derived.id !== revision.id) throw new Error("Atomic revision id is not the id its content and review history produce");
}

/**
 * [B19-E E3] Two different humans: the history ends with the publish event, immediately preceded by the approval it publishes;
 * neither actor is an `llm:`, `ocr:` or `agent:` id; the approver is not the publisher (admin included, OD-37). When the
 * publishing actor is given, its role is publisher or admin and it IS the publish event's actor.
 */
function assertTwoPersonReview(revision: AtomicPartRevision, actor?: AtomicPublicationActor): void {
  const history = Array.isArray(revision.reviewHistory) ? revision.reviewHistory : [];
  if (history.length === 0) throw new Error("Atomic publication requires a review history with an approval and a publication");
  const publish = history.at(-1)!;
  if (publish.action !== "publish" || publish.fromState !== "approved" || publish.toState !== "published") throw new Error("Atomic publication requires a review history that ends with its publish event");
  const approve = history.at(-2);
  if (!approve || approve.action !== "approve" || approve.toState !== "approved") throw new Error("Atomic publication requires the approval immediately before its publish event");
  if (!isHumanCatalogActorId(approve.actorId)) throw new Error("Atomic publication requires a human approver (never an llm:, ocr: or agent: actor)");
  if (!isHumanCatalogActorId(publish.actorId)) throw new Error("Atomic publication requires a human publisher (never an llm:, ocr: or agent: actor)");
  if (catalogActorKey(approve.actorId) === catalogActorKey(publish.actorId)) throw new Error("Atomic publication requires a publisher different from the approver (OD-37)");
  if (!actor) return;
  if (!PUBLISHING_ROLES.has(actor.actorRole)) throw new Error(`Atomic publication role ${JSON.stringify(actor.actorRole)} is not publisher or admin`);
  if (actor.actorId !== publish.actorId) throw new Error("The publishing actor is not the actor of the revision's publish event");
}

/**
 * [B19-D I5d review] The asset a snapshot declares must be exactly what its verified bytes parse to — pins, pads, raw symbol
 * block, validation state and diagnostics included (compared by semantic hash of the whole record). A matching blob hash
 * binds only the bytes; without this, edited pads, an edited raw block or a forged `valid` state published over true bytes.
 */
function kicadAssetMatchesBytes(asset: SymbolAssetVersion | FootprintAssetVersion, blob: RawContentObject): boolean {
  if (blob.encoding !== "utf8") return false;
  const { logicalName: _logicalName, ...origin } = asset.origin;
  void _logicalName;
  try {
    const derived = asset.kind === "symbol"
      ? parseSymbolAssets({ source: blob.content, origin }).find((candidate) => candidate.symbolName === asset.symbolName)
      : parseFootprintAsset({ source: blob.content, libraryNickname: origin.libraryNickname, origin });
    return Boolean(derived) && semanticHash(derived) === semanticHash(asset);
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function validDate(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${field} timestamp`);
  return date;
}

export function validatePortableSnapshotForPublication(snapshot: PortableAtomicSnapshot, profile: ApprovalProfile, actor?: AtomicPublicationActor): void {
  const revision = snapshot.atomicRevision;
  if (revision.publicationState !== "published") throw new Error("Only a reviewed published revision may enter the publication transaction");
  assertRevisionIdentity(revision);
  assertTwoPersonReview(revision, actor);
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
    // [B19-C I4b] where each evidence record came from, so engineering evidence can be judged
    sourceRecords: new Map(snapshot.sourceRecords.map((item) => [item.id, item])),
    sources: new Map(snapshot.sources.map((item) => [item.id, item])),
  };
  const approval = evaluateApproval(revision, profile, context);
  if (!approval.eligible) throw new Error(`Atomic publication rejected: ${approval.blockers.join("; ")}`);
  if (snapshot.exactPart && snapshot.exactPart.manufacturerId !== snapshot.manufacturer?.id) throw new Error("Exact part manufacturer is missing or mismatched");
  if (snapshot.exactPart) {
    // [B19-D I5d row 27c] identity is recomputed, never taken from the snapshot: the exact MPN must be a canonical spelling
    // (no invisible or confusable characters) and its search key must be the one that MPN produces
    if (snapshot.exactPart.exactMpn !== snapshot.exactPart.exactMpn.trim() || /^[ \t]|[ \t]$/.test(snapshot.exactPart.exactMpn)) {
      throw new Error("Exact part MPN is refused: a published MPN has no surrounding whitespace");
    }
    try {
      canonicalExactMpn(snapshot.exactPart.exactMpn);
    } catch (error) {
      throw new Error(`Exact part MPN is refused: ${error instanceof MpnIdentityError ? error.message : "not a valid exact MPN"}`);
    }
    if (snapshot.exactPart.normalizedSearchKey !== normalizeMpnSearchKey(snapshot.exactPart.exactMpn)) {
      throw new Error("Exact part normalizedSearchKey is not the key its exact MPN produces");
    }
  }
  if (snapshot.mapping && snapshot.footprint) {
    // [B19-D I5d row 38] the certificate is re-verified from its own content and the exact assets, not trusted by `state`
    const mappingErrors = mappingCertificateIntegrityErrors(snapshot.mapping, snapshot.symbol, snapshot.footprint);
    if (mappingErrors.length > 0) throw new Error(`Atomic mapping certificate failed re-verification: ${mappingErrors.slice(0, 10).join("; ")}`);
  }
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
    // [B19-D I5d row 47] the bytes are hashed here: a declared hash that matches the asset proves nothing about the content
    const bytes = blob.encoding === "base64" ? Buffer.from(blob.content, "base64") : Buffer.from(blob.content, "utf8");
    if (sha256(bytes) !== blob.contentHash || bytes.byteLength !== blob.bytes) throw new Error(`Asset ${asset.versionId} raw content does not match its declared hash or size`);
    if (asset.kind !== "model" && !kicadAssetMatchesBytes(asset, blob)) throw new Error(`Asset ${asset.versionId} does not match what its raw content parses to`);
    if (blob.confidential) throw new Error(`Confidential asset ${asset.versionId} cannot be published`);
  }
  for (const part of snapshot.supplierParts) {
    if (part.exactPartId !== snapshot.exactPart?.id) throw new Error(`Supplier part ${part.id} is bound to another exact part`);
  }
}

/** [B19-E E3] A catalog part and schematic value to link to the published revision; every other column comes from the snapshot. */
export interface AtomicPartLinkInput {
  partId: string;
  valueKey: string;
}

type AtomicPartLinkRow = Required<Omit<typeof partsAtomicLinks.$inferInsert, "createdAt">>;

function linkRowsFor(snapshot: PortableAtomicSnapshot, links: readonly AtomicPartLinkInput[]): AtomicPartLinkRow[] {
  if (links.length === 0) return [];
  if (links.length > MAX_LINKS) throw new Error(`Atomic part links are limited to ${MAX_LINKS} per publication`);
  const { footprint, mapping } = snapshot;
  if (!footprint || !mapping) throw new Error("Atomic part links require a published footprint and mapping certificate");
  const seen = new Set<string>();
  return links.map((link) => {
    if (typeof link.partId !== "string" || !PART_ID.test(link.partId)) throw new Error("Atomic part link partId is not a catalog part id");
    if (typeof link.valueKey !== "string" || link.valueKey !== normalizeValueKey(link.valueKey)) throw new Error(`Atomic part link value key ${JSON.stringify(link.valueKey)} is not a normalized value key`);
    const key = `${link.partId.toLowerCase()}\0${link.valueKey}`;
    if (seen.has(key)) throw new Error("Atomic part links name the same part and value twice");
    seen.add(key);
    return {
      partId: link.partId,
      valueKey: link.valueKey,
      atomicPartRevisionId: snapshot.atomicRevision.id,
      symbolAssetVersionId: snapshot.symbol.versionId,
      footprintAssetVersionId: footprint.versionId,
      mappingCertificateId: mapping.id,
      footprintFullName: `${footprint.origin.libraryNickname}:${footprint.footprintName}`,
    };
  });
}

/**
 * Production database publication boundary. Every dependent identity, source,
 * asset, claim, certificate, revision, link, and audit record commits together.
 * PostgreSQL rolls the transaction back on any validation/index/FK failure.
 */
export async function publishPortableAtomicSnapshot(input: {
  snapshot: PortableAtomicSnapshot;
  actorId: string;
  actorRole: "publisher" | "admin";
  requiredProfile: ApprovalProfile;
  reason: string;
  /**
   * [B19-E E3] `parts_atomic_links` rows written in the same transaction (E4) and named in its audit row. An existing link is
   * never repointed, and an identical re-publish only replays the links its publication wrote: it never adds one.
   */
  links?: readonly AtomicPartLinkInput[];
}): Promise<{ revisionId: string; auditId: string }> {
  validatePortableSnapshotForPublication(input.snapshot, input.requiredProfile, { actorId: input.actorId, actorRole: input.actorRole });
  if (typeof input.reason !== "string" || !input.reason.trim()) throw new Error("Publication reason is required");
  const { snapshot } = input;
  const revision = snapshot.atomicRevision;
  const links = linkRowsFor(snapshot, input.links ?? []);
  const at = new Date();
  const audit: AuditEvent = {
    id: `audit_${semanticHash({ revisionId: revision.id, actorId: input.actorId, at: at.toISOString(), reason: input.reason })}`,
    at: at.toISOString(),
    actorId: input.actorId,
    action: "publish",
    objectType: "atomic_part_revision",
    objectId: revision.id,
    // [B19-E E3 review] the two people and every link this publication writes are on the record
    detail: {
      profile: input.requiredProfile,
      reason: input.reason,
      semanticHash: revision.semanticHash,
      approverId: revision.reviewHistory.at(-2)?.actorId,
      actorRole: input.actorRole,
      links: links.map((link) => ({ partId: link.partId, valueKey: link.valueKey })),
    },
  };

  return getDb().transaction(async (tx) => {
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

    // [B19-E E3] conflict-ignore on the content-addressed id ONLY: the identical revision is a no-op, while a different
    // revision colliding on (logical_part_id, revision) raises the unique violation and rolls the whole transaction back
    const inserted = await tx.insert(atomicPartRevisions).values({
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
    }).onConflictDoNothing({ target: atomicPartRevisions.id }).returning({ id: atomicPartRevisions.id });
    // [B19-E E3] re-select before commit: the row under this id must be this revision. [B19-E E3 review] FOR SHARE: a
    // withdrawal (FOR UPDATE on this row) either commits before the status read below sees it, or waits for this commit
    const [stored] = await tx.select({ semanticHash: atomicPartRevisions.semanticHash, logicalPartId: atomicPartRevisions.logicalPartId, revision: atomicPartRevisions.revision, publicationState: atomicPartRevisions.publicationState })
      .from(atomicPartRevisions).where(eq(atomicPartRevisions.id, revision.id)).limit(1).for("share");
    if (!stored || stored.semanticHash !== revision.semanticHash || stored.logicalPartId !== revision.logicalPartId || stored.revision !== revision.revision || stored.publicationState !== "published") {
      throw new Error("Atomic revision row does not match the revision being published");
    }
    // [B19-E E3 review] withdrawal is append-only (the row stays 'published'), so the events decide: a deprecated, superseded
    // or revoked revision is never reported published again and never gains a link
    const withdrawals = await tx.select({ toState: atomicRevisionStatusEvents.toState }).from(atomicRevisionStatusEvents).where(eq(atomicRevisionStatusEvents.revisionId, revision.id));
    if (withdrawals.length > 0) throw new Error(`Atomic revision ${revision.id} was withdrawn (${catalogStatusOf(withdrawals)}); it cannot be re-published or linked`);
    const replay = inserted.length === 0;

    for (const link of links) {
      const [existing] = await tx.select({ partId: partsAtomicLinks.partId }).from(partsAtomicLinks).where(and(eq(partsAtomicLinks.partId, link.partId), eq(partsAtomicLinks.valueKey, link.valueKey))).limit(1);
      // [B19-E E3 review] a replay writes no audit row, so it may not write a link either
      if (!existing && replay) throw new Error(`An identical re-publish cannot add the link for value ${JSON.stringify(link.valueKey)}; links are written only by the publication that publishes the revision`);
      await tx.insert(partsAtomicLinks).values(link).onConflictDoNothing();
      const [row] = await tx.select().from(partsAtomicLinks).where(and(eq(partsAtomicLinks.partId, link.partId), eq(partsAtomicLinks.valueKey, link.valueKey))).limit(1);
      if (!row || row.atomicPartRevisionId !== link.atomicPartRevisionId || row.symbolAssetVersionId !== link.symbolAssetVersionId || row.footprintAssetVersionId !== link.footprintAssetVersionId || row.mappingCertificateId !== link.mappingCertificateId || row.footprintFullName !== link.footprintFullName) {
        throw new Error(`Atomic part link for value ${JSON.stringify(link.valueKey)} already points at another revision; a publication never repoints a link`);
      }
    }

    if (replay) {
      // [B19-E E3] identical re-publish: the original publication stands, with its own audit row
      const [original] = await tx.select({ id: atomicAuditEvents.id }).from(atomicAuditEvents)
        .where(and(eq(atomicAuditEvents.objectType, "atomic_part_revision"), eq(atomicAuditEvents.objectId, revision.id), eq(atomicAuditEvents.action, "publish")))
        .orderBy(asc(atomicAuditEvents.at), asc(atomicAuditEvents.id)).limit(1);
      if (original) return { revisionId: revision.id, auditId: original.id };
    }
    await tx.insert(atomicAuditEvents).values({
      id: audit.id,
      objectType: audit.objectType,
      objectId: audit.objectId,
      action: audit.action,
      actorId: audit.actorId,
      at,
      event: audit,
    });
    return { revisionId: revision.id, auditId: audit.id };
  });
}

/**
 * [B19-E E3] Withdraw a published revision: one append-only status event and its audit row, in one transaction. The revision
 * row is never edited (its publication state is in its record hash). Only the legal edges from its latest state; a successor
 * must be a selectable revision of the same logical part (required to supersede); a reason is required; a human publisher
 * or administrator only. Actors reach this layer only from trusted request contexts (E4/E5 callers).
 */
export async function withdrawPublishedAtomicRevision(input: {
  revisionId: string;
  to: AtomicWithdrawalState;
  successorRevisionId?: string;
  actorId: string;
  actorRole: "publisher" | "admin";
  reason: string;
}): Promise<{ revisionId: string; from: AtomicCatalogStatus; to: AtomicWithdrawalState; eventId: string; auditId: string }> {
  if (!isWithdrawalState(input.to)) throw new Error(`${JSON.stringify(input.to)} is not a withdrawal state`);
  if (!PUBLISHING_ROLES.has(input.actorRole) || !roleMayTransition(input.actorRole, input.to)) throw new Error(`Atomic withdrawal role ${JSON.stringify(input.actorRole)} is not publisher or admin`);
  if (!isHumanCatalogActorId(input.actorId)) throw new Error("Atomic withdrawal requires a human actor (never an llm:, ocr: or agent: actor)");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) throw new Error("Atomic withdrawal reason is required");
  if (reason.length > MAX_REASON_LENGTH) throw new Error(`Atomic withdrawal reason is limited to ${MAX_REASON_LENGTH} characters`);
  if (typeof input.revisionId !== "string" || !input.revisionId) throw new Error("Atomic withdrawal requires a revision id");
  const successorId = input.successorRevisionId;
  if (successorId !== undefined && (typeof successorId !== "string" || !successorId)) throw new Error("Atomic withdrawal successor must be a revision id");
  if (input.to === "superseded" && !successorId) throw new Error("A superseded revision requires a successor revision");
  if (successorId === input.revisionId) throw new Error("A revision cannot be its own successor");

  const at = new Date();
  return getDb().transaction(async (tx) => {
    // the row lock serializes withdrawals of one revision; the (revision_id, to_state) unique index is the backstop
    const [row] = await tx.select({ logicalPartId: atomicPartRevisions.logicalPartId, publicationState: atomicPartRevisions.publicationState })
      .from(atomicPartRevisions).where(eq(atomicPartRevisions.id, input.revisionId)).limit(1).for("update");
    if (!row || row.publicationState !== "published") throw new Error(`${input.revisionId} is not a published atomic revision`);
    const events = await tx.select({ toState: atomicRevisionStatusEvents.toState }).from(atomicRevisionStatusEvents).where(eq(atomicRevisionStatusEvents.revisionId, input.revisionId));
    const from = catalogStatusOf(events);
    if (!TRANSITIONS[from].includes(input.to)) throw new Error(`Illegal withdrawal ${from} -> ${input.to}`);

    if (successorId) {
      const [successor] = await tx.select({ logicalPartId: atomicPartRevisions.logicalPartId, publicationState: atomicPartRevisions.publicationState })
        .from(atomicPartRevisions).where(eq(atomicPartRevisions.id, successorId)).limit(1);
      const withdrawn = successor ? await tx.select({ id: atomicRevisionStatusEvents.id }).from(atomicRevisionStatusEvents).where(eq(atomicRevisionStatusEvents.revisionId, successorId)).limit(1) : [];
      if (!successor || successor.publicationState !== "published" || withdrawn.length > 0) throw new Error(`Successor ${successorId} is not a selectable published revision`);
      if (successor.logicalPartId !== row.logicalPartId) throw new Error("A successor must be a revision of the same logical part");
    }

    const iso = at.toISOString();
    const audit: AuditEvent = {
      id: `audit_${semanticHash({ revisionId: input.revisionId, to: input.to, actorId: input.actorId, at: iso, reason })}`,
      at: iso,
      actorId: input.actorId,
      action: input.to,
      objectType: "atomic_part_revision",
      objectId: input.revisionId,
      detail: { fromState: from, toState: input.to, actorRole: input.actorRole, reason, ...(successorId ? { successorRevisionId: successorId } : {}) },
    };
    await tx.insert(atomicAuditEvents).values({ id: audit.id, objectType: audit.objectType, objectId: audit.objectId, action: audit.action, actorId: audit.actorId, at, event: audit });
    const eventId = `status_${semanticHash({ revisionId: input.revisionId, to: input.to, auditId: audit.id })}`;
    await tx.insert(atomicRevisionStatusEvents).values({
      id: eventId,
      revisionId: input.revisionId,
      toState: input.to,
      successorRevisionId: successorId ?? null,
      actorId: input.actorId,
      actorRole: input.actorRole,
      reason,
      at,
      auditEventId: audit.id,
    });
    return { revisionId: input.revisionId, from, to: input.to, eventId, auditId: audit.id };
  });
}
