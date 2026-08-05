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
} from "./types";

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
}

const TRUSTED_CLAIM_STATES = new Set<ClaimState>(["source_backed", "verified"]);

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
