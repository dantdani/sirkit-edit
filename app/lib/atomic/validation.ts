import type {
  ApprovalDecision,
  ApprovalProfile,
  AtomicPartRevision,
  ClaimState,
  EngineeringClaim,
  FootprintAssetVersion,
  LicenseRecord,
  MappingCertificate,
  ModelAssetVersion,
  SymbolAssetVersion,
  SupplierOfferSnapshot,
  EvidenceRef,
  ApplicationGuidance,
  EngineeringFacet,
  SourceClass,
  SourceIdentity,
  SourceRecord,
} from "./types";

import { isClaimFresh } from "./claims";

export const ATOMIC_VALIDATOR_VERSION = "sirkit.atomic-validator/1";

export interface ValidationContext {
  symbols: ReadonlyMap<string, SymbolAssetVersion>;
  footprints: ReadonlyMap<string, FootprintAssetVersion>;
  models: ReadonlyMap<string, ModelAssetVersion>;
  mappings: ReadonlyMap<string, MappingCertificate>;
  claims: ReadonlyMap<string, EngineeringClaim>;
  licenses: ReadonlyMap<string, LicenseRecord>;
  offerSnapshots?: ReadonlyMap<string, SupplierOfferSnapshot>;
  evidence?: ReadonlyMap<string, EvidenceRef>;
  guidance?: ReadonlyMap<string, ApplicationGuidance>;
  /** [B19-C I4b] Where each evidence record came from. Without them, engineering evidence cannot be judged and is refused. */
  sourceRecords?: ReadonlyMap<string, SourceRecord>;
  sources?: ReadonlyMap<string, SourceIdentity>;
}

const TRUSTED_CLAIM_STATES = new Set<ClaimState>(["source_backed", "verified"]);

/**
 * [B19-C I4b] Source classes whose evidence may establish an ENGINEERING fact (identity, terminals, package, mechanics, and
 * pin-to-pad mapping). A distributor catalog, downloaded third-party CAD, geometry inference, OCR and model suggestions may
 * accompany such evidence but never stand alone — the runbook's B19-C rule. Mirrors the mapping verifier's accepted classes.
 */
export const ENGINEERING_AUTHORITY_SOURCE_CLASSES: ReadonlySet<SourceClass> = new Set<SourceClass>([
  "manufacturer_datasheet",
  "manufacturer_cad",
  "manufacturer_application_note",
  "official_kicad_library",
  "organization_authored",
  "human_reviewed",
]);

const ENGINEERING_FACETS: ReadonlySet<EngineeringFacet> = new Set<EngineeringFacet>(["identity", "terminal", "package", "mechanical"]);

type EvidenceJudgement = {
  /** every referenced evidence record, its source record and its source were found */
  resolved: boolean;
  /** why not, precisely: the context carries no provenance at all, or a record or identity is missing */
  unresolvedBecause: string | null;
  /** at least one record is from an engineering-authoritative class and is not an unreviewed model/OCR extraction */
  authoritative: boolean;
  /** every found record is a model/OCR extraction nobody has reviewed */
  unreviewedExtractionOnly: boolean;
  weakestClasses: SourceClass[];
};

function unreviewedExtraction(evidence: EvidenceRef): boolean {
  return (evidence.extractionMethod === "llm" || evidence.extractionMethod === "ocr") && !(evidence.reviewerId && evidence.reviewedAt);
}

function judgeEvidence(evidenceIds: readonly string[], context: ValidationContext): EvidenceJudgement {
  const found = evidenceIds.map((id) => context.evidence?.get(id)).filter((item): item is EvidenceRef => Boolean(item));
  const classes: SourceClass[] = [];
  let unresolvedBecause: string | null = null;
  if (!context.evidence || !context.sourceRecords || !context.sources) unresolvedBecause = "the source of its evidence cannot be resolved (no provenance in this context)";
  else if (evidenceIds.length === 0) unresolvedBecause = "it cites no evidence";
  else if (found.length !== evidenceIds.length) unresolvedBecause = "an evidence record is missing";
  let authoritative = false;
  for (const evidence of found) {
    const record = context.sourceRecords?.get(evidence.sourceRecordId);
    const source = record ? context.sources?.get(record.sourceId) : undefined;
    if (!record) {
      unresolvedBecause ??= "an evidence source record is missing";
      continue;
    }
    if (!source) {
      unresolvedBecause ??= "an evidence source identity is missing";
      continue;
    }
    classes.push(source.sourceClass);
    if (ENGINEERING_AUTHORITY_SOURCE_CLASSES.has(source.sourceClass) && !unreviewedExtraction(evidence)) authoritative = true;
  }
  return {
    resolved: unresolvedBecause === null,
    unresolvedBecause,
    authoritative,
    unreviewedExtractionOnly: found.length > 0 && found.every(unreviewedExtraction),
    weakestClasses: [...new Set(classes.filter((item) => !ENGINEERING_AUTHORITY_SOURCE_CLASSES.has(item)))].sort(),
  };
}

export function evaluateApproval(revision: AtomicPartRevision, profile: ApprovalProfile, context: ValidationContext, now = new Date()): ApprovalDecision {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (Boolean(revision.exactPartId) === Boolean(revision.genericDeviceId)) blockers.push("revision must bind exactly one exact part or generic device");
  if (revision.validatorVersion !== ATOMIC_VALIDATOR_VERSION) warnings.push("revision was created by a different validator version");
  if (revision.cadBundles.length === 0) blockers.push("no CAD bundle");

  const approvedBundles = revision.cadBundles.filter((bundle) =>
    bundle.disposition === "primary_approved" || bundle.disposition === "alternate_approved",
  );
  if (!approvedBundles.some((bundle) => bundle.disposition === "primary_approved")) blockers.push("no primary approved CAD bundle");
  for (const bundle of approvedBundles) {
    const symbol = context.symbols.get(bundle.symbolVersionId);
    if (!symbol || symbol.validationState === "invalid" || symbol.validationState === "unsupported") blockers.push(`invalid or missing symbol ${bundle.symbolVersionId}`);
    if (profile === "schematic_only") continue;
    if (!bundle.footprintVersionId) {
      blockers.push("PCB profile requires an exact footprint version");
      continue;
    }
    const footprint = context.footprints.get(bundle.footprintVersionId);
    if (!footprint || footprint.validationState === "invalid" || footprint.validationState === "unsupported") blockers.push(`invalid or missing footprint ${bundle.footprintVersionId}`);
    const mapping = bundle.mappingCertificateId ? context.mappings.get(bundle.mappingCertificateId) : undefined;
    if (!mapping || mapping.state !== "approved") blockers.push("PCB profile requires an approved exact mapping certificate");
    else if (mapping.symbolVersionId !== bundle.symbolVersionId || mapping.footprintVersionId !== bundle.footprintVersionId) blockers.push("mapping certificate is stale for this CAD bundle");
    else {
      // [B19-C I4b] a pin-to-pad mapping rests on engineering-authoritative evidence, never on sourcing or unverified CAD alone
      const mappingEvidence = [...new Set([...mapping.evidenceIds, ...mapping.entries.flatMap((entry) => entry.evidenceIds)])];
      const judgement = judgeEvidence(mappingEvidence, context);
      if (!judgement.resolved) blockers.push(`mapping certificate ${mapping.id}: ${judgement.unresolvedBecause}`);
      else if (!judgement.authoritative) {
        const why = judgement.unreviewedExtractionOnly ? "only unreviewed model or OCR extraction" : `${judgement.weakestClasses.join(", ")} cannot establish a pin-to-pad mapping`;
        blockers.push(`mapping certificate ${mapping.id} rests on no engineering-authoritative evidence (${why})`);
      }
    }
    if (profile === "mechanically_complete") {
      if (bundle.modelVersionIds.length === 0) blockers.push("mechanical profile requires a resolved 3D model");
      for (const modelId of bundle.modelVersionIds) {
        const model = context.models.get(modelId);
        if (!model || model.inspectionState !== "safe") blockers.push(`3D model ${modelId} is not safely resolved`);
      }
    } else if (bundle.modelVersionIds.length === 0) {
      warnings.push("3D model absent (permitted by this profile)");
    }
  }

  const assetLicenseIds = new Set<string>();
  for (const bundle of approvedBundles) {
    const symbol = context.symbols.get(bundle.symbolVersionId);
    if (symbol) assetLicenseIds.add(symbol.origin.licenseId);
    const footprint = bundle.footprintVersionId ? context.footprints.get(bundle.footprintVersionId) : undefined;
    if (footprint) assetLicenseIds.add(footprint.origin.licenseId);
    for (const modelId of bundle.modelVersionIds) {
      const model = context.models.get(modelId);
      if (model) assetLicenseIds.add(model.origin.licenseId);
    }
  }
  for (const licenseId of assetLicenseIds) {
    if (!revision.licenseIds.includes(licenseId)) blockers.push(`asset license ${licenseId} is not bound by the atomic revision`);
  }

  for (const claimId of revision.claimIds) {
    const claim = context.claims.get(claimId);
    if (!claim) {
      blockers.push(`claim ${claimId} is missing`);
      continue;
    }
    if (claim.safetyCritical && !TRUSTED_CLAIM_STATES.has(claim.state)) blockers.push(`safety-critical claim ${claim.id} is ${claim.state}`);
    if (claim.state === "conflicting" && claim.safetyCritical) blockers.push(`safety-critical claim ${claim.id} conflicts`);
    if ((claim.state === "source_backed" || claim.state === "verified") && claim.evidenceIds.length === 0) blockers.push(`trusted claim ${claim.id} has no evidence`);
    if (context.evidence && claim.evidenceIds.some((id) => !context.evidence!.has(id))) blockers.push(`claim ${claim.id} references missing evidence`);
    if (TRUSTED_CLAIM_STATES.has(claim.state) && claim.evidenceIds.length > 0) {
      // [B19-C I4b] a trusted fact never rests only on an unreviewed model/OCR extraction, and an engineering fact never on
      // sourcing or unverified CAD alone
      const judgement = judgeEvidence(claim.evidenceIds, context);
      if (judgement.unreviewedExtractionOnly) blockers.push(`claim ${claim.id} rests only on unreviewed model or OCR extraction (quarantined until review)`);
      else if (ENGINEERING_FACETS.has(claim.facet) || claim.scope.kind === "terminal" || claim.scope.kind === "package") {
        if (!judgement.resolved) blockers.push(`claim ${claim.id} (${claim.facet}): ${judgement.unresolvedBecause}`);
        else if (!judgement.authoritative) blockers.push(`claim ${claim.id} (${claim.facet}) rests on no engineering-authoritative evidence`);
      }
    }
  }


  // [B19-D I5d row 07] a revision never binds a claim together with the claim that supersedes it
  for (const claimId of revision.claimIds) {
    const claim = context.claims.get(claimId);
    const target = claim?.supersedesClaimId;
    if (claim && target && target !== claim.id && revision.claimIds.includes(target)) blockers.push(`claim ${target} is superseded by ${claim.id}, and the revision binds both`);
  }

  for (const guidanceId of revision.guidanceIds) {
    const guidance = context.guidance?.get(guidanceId);
    if (!guidance) {
      if (context.guidance) blockers.push(`guidance ${guidanceId} is missing`);
      continue;
    }
    if (guidance.executable !== false) blockers.push(`Stage 5 guidance ${guidanceId} falsely claims executable enforcement`);
    if (guidance.evidenceIds.length === 0) blockers.push(`guidance ${guidanceId} has no source evidence`);
  }

  for (const licenseId of revision.licenseIds) {
    const license = context.licenses.get(licenseId);
    if (!license || license.exportDisposition === "unknown" || license.exportDisposition === "prohibited") blockers.push(`license ${licenseId} does not permit publication/export`);
  }

  if (profile === "sourcing_current") {
    if (revision.offerSnapshotIds.length === 0) blockers.push("sourcing profile requires an offer snapshot");
    const volatileClaims = revision.claimIds.map((id) => context.claims.get(id)).filter((claim) => claim?.scope.kind === "supplier_offer");
    if (volatileClaims.some((claim) => claim?.state === "stale")) blockers.push("supplier data is stale");
    // [B19-D I5d row 22] every supplier claim must be provably fresh from its evidence records
    else if (volatileClaims.some((claim) => claim && (!context.evidence || !context.sourceRecords || isClaimFresh(claim, context.sourceRecords, context.evidence, now) === false))) {
      blockers.push("supplier data is expired, or its freshness cannot be established from its evidence");
    }
    if (volatileClaims.length === 0) warnings.push("no supplier-scoped claim is attached");
    const snapshots = revision.offerSnapshotIds.map((id) => context.offerSnapshots?.get(id));
    if (snapshots.some((snapshot) => !snapshot || Date.parse(snapshot.expiresAt) <= now.getTime())) blockers.push("supplier offer snapshot is missing or expired");
  }

  return {
    profile,
    eligible: blockers.length === 0,
    blockers: [...new Set(blockers)].sort(),
    warnings: [...new Set(warnings)].sort(),
    evaluatedAt: now.toISOString(),
    validatorVersion: ATOMIC_VALIDATOR_VERSION,
  };
}
