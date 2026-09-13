import type {
  ApplicationGuidance,
  AtomicPartRevision,
  AuditEvent,
  ClaimState,
  EngineeringClaim,
  FootprintAssetVersion,
  ExactManufacturerPart,
  GenericDevice,
  Manufacturer,
  ManufacturerFamily,
  LicenseRecord,
  MappingCertificate,
  ModelAssetVersion,
  RecordState,
  ReviewEvent,
  SymbolAssetVersion,
  SourceIdentity,
  SourceRecord,
  EvidenceRef,
  SupplierPart,
  SupplierOfferSnapshot,
  PortableAtomicSnapshot,
  RawContentObject,
} from "./types";
import { deepFreeze, semanticHash } from "./stable";
import { ATOMIC_VALIDATOR_VERSION, evaluateApproval, type ValidationContext } from "./validation";
import { validateGuidance } from "./guidance";

export interface CatalogSnapshot {
  id: string;
  createdAt: string;
  revisionIds: string[];
}

export type CatalogActorRole = "ingestion_worker" | "reviewer" | "publisher" | "admin" | "agent";

export function roleMayTransition(role: CatalogActorRole, to: RecordState): boolean {
  if (role === "admin") return true;
  if (to === "needs_review") return role === "ingestion_worker" || role === "reviewer" || role === "agent";
  if (to === "approved" || to === "draft") return role === "reviewer";
  if (to === "published" || to === "deprecated" || to === "revoked" || to === "superseded") return role === "publisher";
  return false;
}

/** [B19-E E3] States that carry catalog authority: only a human may move a revision into one. */
export const HUMAN_AUTHORITY_STATES: ReadonlySet<RecordState> = new Set<RecordState>(["approved", "published", "deprecated", "revoked", "superseded"]);

/** [B19-E E3] The comparable form of an actor id: NFKC, trimmed, case-folded (so ` LLM:x` and `llm:x` are one actor). */
export function catalogActorKey(actorId: string): string {
  return typeof actorId === "string" ? actorId.normalize("NFKC").trim().toLowerCase() : "";
}

/** [B19-E E3] An `llm:`, `ocr:` or `agent:` id (in any case, behind any whitespace) or a blank id is never a human actor. */
export function isHumanCatalogActorId(actorId: string): boolean {
  const key = catalogActorKey(actorId);
  return key.length > 0 && !/^(llm|ocr|agent):/.test(key);
}

export function createAtomicRevision(input: Omit<AtomicPartRevision, "id" | "semanticHash" | "validatorVersion" | "schemaVersion">): AtomicPartRevision {
  if (Boolean(input.exactPartId) === Boolean(input.genericDeviceId)) throw new Error("Atomic revision requires exactly one exact part or generic device");
  const hashBody = {
    logicalPartId: input.logicalPartId,
    exactPartId: input.exactPartId,
    genericDeviceId: input.genericDeviceId,
    cadBundles: input.cadBundles,
    claimIds: [...input.claimIds].sort(),
    guidanceIds: [...input.guidanceIds].sort(),
    offerSnapshotIds: [...input.offerSnapshotIds].sort(),
    licenseIds: [...input.licenseIds].sort(),
    policyVersion: input.policyVersion,
    supersedesRevisionId: input.supersedesRevisionId,
  };
  const hash = semanticHash(hashBody);
  const recordHash = semanticHash({
    semanticHash: hash,
    revision: input.revision,
    publicationState: input.publicationState,
    reviewHistory: input.reviewHistory,
    createdAt: input.createdAt,
    createdBy: input.createdBy,
  });
  return deepFreeze({
    ...input,
    schemaVersion: 1,
    id: `atomic_${recordHash}`,
    semanticHash: hash,
    validatorVersion: ATOMIC_VALIDATOR_VERSION,
    claimIds: [...input.claimIds].sort(),
    guidanceIds: [...input.guidanceIds].sort(),
    offerSnapshotIds: [...input.offerSnapshotIds].sort(),
    licenseIds: [...input.licenseIds].sort(),
  }) as AtomicPartRevision;
}

export const TRANSITIONS: Readonly<Record<RecordState, readonly RecordState[]>> = {
  quarantined: ["draft"],
  draft: ["needs_review"],
  needs_review: ["approved", "draft"],
  approved: ["published", "draft"],
  published: ["deprecated", "revoked", "superseded"],
  deprecated: ["revoked", "superseded"],
  revoked: [],
  superseded: ["revoked"],
};

function reviewActionForState(state: RecordState): ReviewEvent["action"] {
  switch (state) {
    case "needs_review": return "submit";
    case "approved": return "approve";
    case "published": return "publish";
    case "deprecated": return "deprecate";
    case "revoked": return "revoke";
    case "superseded": return "supersede";
    case "draft": return "reject";
    case "quarantined": return "reject";
  }
}

export class AtomicCatalog {
  readonly manufacturers = new Map<string, Manufacturer>();
  readonly families = new Map<string, ManufacturerFamily>();
  readonly exactParts = new Map<string, ExactManufacturerPart>();
  readonly genericDevices = new Map<string, GenericDevice>();
  readonly supplierParts = new Map<string, SupplierPart>();
  readonly offerSnapshots = new Map<string, SupplierOfferSnapshot>();
  readonly sources = new Map<string, SourceIdentity>();
  readonly sourceRecords = new Map<string, SourceRecord>();
  readonly evidence = new Map<string, EvidenceRef>();
  readonly rawObjects = new Map<string, RawContentObject>();
  readonly symbols = new Map<string, SymbolAssetVersion>();
  readonly footprints = new Map<string, FootprintAssetVersion>();
  readonly models = new Map<string, ModelAssetVersion>();
  readonly mappings = new Map<string, MappingCertificate>();
  readonly claims = new Map<string, EngineeringClaim>();
  readonly guidance = new Map<string, ApplicationGuidance>();
  readonly licenses = new Map<string, LicenseRecord>();
  readonly revisions = new Map<string, AtomicPartRevision>();
  readonly audits: AuditEvent[] = [];
  private publishedIndex = new Set<string>();

  addManufacturer(item: Manufacturer): void { this.insertImmutable(this.manufacturers, item.id, item); }
  addFamily(item: ManufacturerFamily): void { this.insertImmutable(this.families, item.id, item); }
  addExactPart(item: ExactManufacturerPart): void { this.insertImmutable(this.exactParts, item.id, item); }
  addGenericDevice(item: GenericDevice): void { this.insertImmutable(this.genericDevices, item.id, item); }
  addSupplierPart(item: SupplierPart): void { this.insertImmutable(this.supplierParts, item.id, item); }
  addOfferSnapshot(item: SupplierOfferSnapshot): void { this.insertImmutable(this.offerSnapshots, item.id, item); }
  addSource(item: SourceIdentity): void { this.insertImmutable(this.sources, item.id, item); }
  addSourceRecord(item: SourceRecord): void { this.insertImmutable(this.sourceRecords, item.id, item); }
  addEvidence(item: EvidenceRef): void { this.insertImmutable(this.evidence, item.id, item); }
  addRawObject(item: RawContentObject): void { this.insertImmutable(this.rawObjects, item.id, item); }
  addSymbol(asset: SymbolAssetVersion): void { this.insertImmutable(this.symbols, asset.versionId, asset); }
  addFootprint(asset: FootprintAssetVersion): void { this.insertImmutable(this.footprints, asset.versionId, asset); }
  addModel(asset: ModelAssetVersion): void { this.insertImmutable(this.models, asset.versionId, asset); }
  addMapping(mapping: MappingCertificate): void { this.insertImmutable(this.mappings, mapping.id, mapping); }
  addClaim(claim: EngineeringClaim): void { this.insertImmutable(this.claims, claim.id, claim); }
  addGuidance(item: ApplicationGuidance): void {
    const errors = validateGuidance(item);
    if (errors.length) throw new Error(errors.join("; "));
    this.insertImmutable(this.guidance, item.id, item);
  }
  addLicense(license: LicenseRecord): void { this.insertImmutable(this.licenses, license.id, license); }
  addRevision(revision: AtomicPartRevision): void { this.insertImmutable(this.revisions, revision.id, revision); }

  private insertImmutable<T>(map: Map<string, T>, key: string, value: T): void {
    const existing = map.get(key);
    if (existing && semanticHash(existing) !== semanticHash(value)) throw new Error(`Immutable object collision: ${key}`);
    if (!existing) map.set(key, deepFreeze(structuredClone(value)) as T);
  }

  validationContext(): ValidationContext {
    return { symbols: this.symbols, footprints: this.footprints, models: this.models, mappings: this.mappings, claims: this.claims, licenses: this.licenses, offerSnapshots: this.offerSnapshots, evidence: this.evidence, guidance: this.guidance, sourceRecords: this.sourceRecords, sources: this.sources };
  }

  /**
   * State changes create a new immutable revision. Publishing stages the row,
   * index, and audit together; any failure leaves the catalog unchanged.
   */
  transition(input: {
    revisionId: string;
    to: RecordState;
    actorId: string;
    actorRole: CatalogActorRole;
    reason: string;
    now?: Date;
    simulateIndexFailure?: boolean;
  }): AtomicPartRevision {
    const current = this.revisions.get(input.revisionId);
    if (!current) throw new Error(`Unknown atomic revision ${input.revisionId}`);
    if (!TRANSITIONS[current.publicationState].includes(input.to)) throw new Error(`Illegal publication transition ${current.publicationState} -> ${input.to}`);
    if (!roleMayTransition(input.actorRole, input.to)) throw new Error(`${input.actorRole} role cannot transition a revision to ${input.to}`);
    // [B19-E E3] withdrawal states carry authority too; a padded or upper-case automated id is still automated
    if (HUMAN_AUTHORITY_STATES.has(input.to) && !isHumanCatalogActorId(input.actorId)) throw new Error("Agents, LLMs, and OCR workers cannot approve, publish, deprecate, revoke or supersede");
    if (input.to === "published") {
      // [B19-E E3] OD-37: the approval being published names its approver, and the publisher is a different person (admin included)
      const approval = current.reviewHistory.at(-1);
      if (!approval || approval.action !== "approve" || approval.toState !== "approved") throw new Error("Publication requires the recorded approval it publishes");
      if (catalogActorKey(approval.actorId) === catalogActorKey(input.actorId)) throw new Error("The publisher must be a different person from the approver");
    }
    if (input.to === "approved" || input.to === "published") {
      const decision = evaluateApproval(current, "schematic_only", this.validationContext(), input.now);
      if (!decision.eligible) throw new Error(`Approval blocked: ${decision.blockers.join("; ")}`);
    }
    if (input.to === "published") {
      const claims = current.claimIds.map((id) => this.claims.get(id)).filter((claim): claim is EngineeringClaim => Boolean(claim));
      const invalid = claims.filter((claim) => claim.safetyCritical && !(["source_backed", "verified"] as ClaimState[]).includes(claim.state));
      if (invalid.length) throw new Error("Publication blocked by untrusted safety-critical claims");
    }

    const at = (input.now ?? new Date()).toISOString();
    const event: ReviewEvent = {
      id: `review_${semanticHash({ revision: current.id, to: input.to, actor: input.actorId, at })}`,
      at,
      actorId: input.actorId,
      action: reviewActionForState(input.to),
      reason: input.reason,
      fromState: current.publicationState,
      toState: input.to,
    };
    const nextRevision = Math.max(
      ...[...this.revisions.values()]
        .filter((revision) => revision.logicalPartId === current.logicalPartId)
        .map((revision) => revision.revision),
    ) + 1;
    const next = createAtomicRevision({
      ...current,
      revision: nextRevision,
      publicationState: input.to,
      createdAt: at,
      createdBy: input.actorId,
      reviewHistory: [...current.reviewHistory, event],
      // Preserve semantic lineage through draft/review/approval workflow
      // records. A new content revision may already point at the published
      // revision it replaces.
      supersedesRevisionId: current.supersedesRevisionId ?? current.id,
    });
    const nextRevisions = new Map(this.revisions);
    const nextIndex = new Set(this.publishedIndex);
    const nextAudits = [...this.audits];
    nextRevisions.set(next.id, next);
    if (input.to === "published") {
      if (next.supersedesRevisionId) nextIndex.delete(next.supersedesRevisionId);
      nextIndex.add(next.id);
    }
    if (input.to === "deprecated" || input.to === "revoked" || input.to === "superseded") {
      nextIndex.delete(current.id);
    }
    nextAudits.push({ id: `audit_${semanticHash(event)}`, at, actorId: input.actorId, action: input.to, objectType: "atomic_part_revision", objectId: next.id, detail: { priorRevisionId: current.id, reason: input.reason } });
    if (input.simulateIndexFailure) throw new Error("Publication index update failed");
    this.revisions.clear();
    nextRevisions.forEach((value, key) => this.revisions.set(key, value));
    this.publishedIndex = nextIndex;
    this.audits.splice(0, this.audits.length, ...nextAudits);
    return next;
  }

  isPublished(revisionId: string): boolean { return this.publishedIndex.has(revisionId); }

  snapshot(now = new Date()): CatalogSnapshot {
    const revisionIds = [...this.publishedIndex].sort();
    return { id: `catalog_${semanticHash(revisionIds)}`, createdAt: now.toISOString(), revisionIds };
  }

  portableSnapshot(revisionId: string, now = new Date()): PortableAtomicSnapshot {
    const revision = this.revisions.get(revisionId);
    if (!revision) throw new Error(`Unknown atomic revision ${revisionId}`);
    const primary = revision.cadBundles.find((item) => item.disposition === "primary_approved") ?? revision.cadBundles[0];
    if (!primary) throw new Error("Atomic revision has no CAD bundle");
    const symbol = this.symbols.get(primary.symbolVersionId);
    if (!symbol) throw new Error(`Missing symbol ${primary.symbolVersionId}`);
    const footprint = primary.footprintVersionId ? this.footprints.get(primary.footprintVersionId) : undefined;
    const models = primary.modelVersionIds.map((id) => this.models.get(id)).filter((item): item is ModelAssetVersion => Boolean(item));
    const mapping = primary.mappingCertificateId ? this.mappings.get(primary.mappingCertificateId) : undefined;
    const claims = revision.claimIds.map((id) => this.claims.get(id)).filter((item): item is EngineeringClaim => Boolean(item));
    const guidance = revision.guidanceIds.map((id) => this.guidance.get(id)).filter((item): item is ApplicationGuidance => Boolean(item));
    const evidenceIds = new Set([...claims.flatMap((claim) => claim.evidenceIds), ...guidance.flatMap((item) => item.evidenceIds), ...(mapping?.evidenceIds ?? [])]);
    const evidence = [...evidenceIds].map((id) => this.evidence.get(id)).filter((item): item is EvidenceRef => Boolean(item));
    const sourceRecordIds = new Set([...evidence.map((item) => item.sourceRecordId), symbol.origin.sourceRecordId, footprint?.origin.sourceRecordId, ...models.map((model) => model.origin.sourceRecordId)].filter((item): item is string => Boolean(item)));
    const exactPart = revision.exactPartId ? this.exactParts.get(revision.exactPartId) : undefined;
    const sourceRecords = [...sourceRecordIds].map((id) => this.sourceRecords.get(id)).filter((item): item is SourceRecord => Boolean(item));
    const offerSnapshots = revision.offerSnapshotIds.map((id) => this.offerSnapshots.get(id)).filter((item): item is SupplierOfferSnapshot => Boolean(item));
    const supplierPartIds = new Set(offerSnapshots.map((item) => item.supplierPartId));
    const rawObjectIds = [symbol.rawContentObjectId, ...(footprint ? [footprint.rawContentObjectId] : []), ...models.map((model) => model.rawContentObjectId)];
    const assetBlobs = rawObjectIds.map((id) => this.rawObjects.get(id));
    if (assetBlobs.some((item) => !item)) throw new Error("Portable snapshot is missing content-addressed CAD bytes");
    return structuredClone({
      schemaVersion: 1,
      atomicRevision: revision,
      manufacturer: exactPart ? this.manufacturers.get(exactPart.manufacturerId) : undefined,
      family: exactPart?.familyId ? this.families.get(exactPart.familyId) : undefined,
      exactPart,
      genericDevice: revision.genericDeviceId ? this.genericDevices.get(revision.genericDeviceId) : undefined,
      symbol,
      footprint,
      models,
      mapping,
      claims,
      guidance,
      licenses: revision.licenseIds.map((id) => this.licenses.get(id)).filter((item): item is LicenseRecord => Boolean(item)),
      evidence,
      sourceRecords,
      sources: [...new Set(sourceRecords.map((item) => item.sourceId))].map((id) => this.sources.get(id)).filter((item): item is SourceIdentity => Boolean(item)),
      supplierParts: [...supplierPartIds].map((id) => this.supplierParts.get(id)).filter((item): item is SupplierPart => Boolean(item)),
      offerSnapshots,
      assetBlobs: assetBlobs as RawContentObject[],
      capturedAt: now.toISOString(),
    });
  }
}
