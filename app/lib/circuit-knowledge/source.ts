import type { LicenseDisposition, LicenseRecord } from "../atomic/types";
import type { EngineeringActor } from "../engineering/types";
import { EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1 } from "./capability";
import { circuitDigest, circuitId } from "./stable";
import type { ProposedRecipeClaim, RecipeSourceBundle } from "./types";

export type RecipePublicationScope = "private_review" | "public_library" | "portable_export";

function withoutDigest<T extends { deterministicDigest: string }>(value: T): Omit<T, "deterministicDigest"> {
  const rest: Partial<T> = { ...value };
  delete rest.deterministicDigest;
  return rest as Omit<T, "deterministicDigest">;
}

function uniqueIds(values: Array<{ id: string }>, code: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value.id || seen.has(value.id)) errors.push(code);
    seen.add(value.id);
  }
}

export function licensePermitsRecipeUse(license: LicenseRecord, scope: RecipePublicationScope): boolean {
  const dispositions: LicenseDisposition[] = scope === "private_review"
    ? [license.derivedRedistribution]
    : scope === "public_library"
      ? [license.derivedRedistribution]
      : [license.derivedRedistribution, license.exportDisposition];
  return dispositions.every((value) => scope === "private_review"
    ? !["prohibited", "unknown"].includes(value)
    : value === "redistributable" || value === "metadata_only");
}

export function validateRecipeSourceBundle(
  bundle: RecipeSourceBundle,
  options: { now?: string; publicationScope?: RecipePublicationScope } = {},
): string[] {
  const errors: string[] = [];
  uniqueIds(bundle.sources, "RECIPE_SOURCE_ID_REUSE", errors);
  uniqueIds(bundle.sourceRecords, "RECIPE_SOURCE_RECORD_ID_REUSE", errors);
  uniqueIds(bundle.evidence, "RECIPE_EVIDENCE_ID_REUSE", errors);
  uniqueIds(bundle.licenses, "RECIPE_LICENSE_ID_REUSE", errors);
  const licenses = new Map(bundle.licenses.map((item) => [item.id, item]));
  const sources = new Map(bundle.sources.map((item) => [item.id, item]));
  const records = new Map(bundle.sourceRecords.map((item) => [item.id, item]));
  const evidence = new Map(bundle.evidence.map((item) => [item.id, item]));
  const locations = new Map<string, number>();
  const now = Date.parse(options.now ?? new Date().toISOString());

  for (const source of bundle.sources) {
    const license = licenses.get(source.licenseId);
    if (!license) errors.push("RECIPE_SOURCE_LICENSE_MISSING");
    else if (!licensePermitsRecipeUse(license, options.publicationScope ?? "private_review")) errors.push("RECIPE_SOURCE_LICENSE_BLOCKS_SCOPE");
    if (source.canonicalUri && !/^https:\/\//i.test(source.canonicalUri)) errors.push("RECIPE_SOURCE_URI_NOT_HTTPS");
  }
  for (const record of bundle.sourceRecords) {
    if (!sources.has(record.sourceId)) errors.push("RECIPE_SOURCE_RECORD_ORPHAN");
    if (!/^[a-f0-9]{64}$/i.test(record.contentHash)) errors.push("RECIPE_SOURCE_CONTENT_HASH_INVALID");
    if (!Number.isFinite(Date.parse(record.retrievedAt))) errors.push("RECIPE_SOURCE_RETRIEVED_AT_INVALID");
    if (record.expiresAt && Number.isFinite(now) && Date.parse(record.expiresAt) <= now) errors.push("RECIPE_SOURCE_RECORD_STALE");
  }
  for (const item of bundle.evidence) {
    if (!records.has(item.sourceRecordId)) errors.push("RECIPE_EVIDENCE_SOURCE_RECORD_ORPHAN");
    if (!item.locator.trim()) errors.push("RECIPE_EVIDENCE_LOCATOR_MISSING");
    if (["ocr", "llm"].includes(item.extractionMethod) && (!item.reviewerId || !item.reviewedAt)) errors.push("RECIPE_MACHINE_EVIDENCE_REVIEW_MISSING");
  }
  for (const location of bundle.sourceLocations) {
    locations.set(location.evidenceId, (locations.get(location.evidenceId) ?? 0) + 1);
    const item = evidence.get(location.evidenceId);
    if (!item || item.sourceRecordId !== location.sourceRecordId) errors.push("RECIPE_SOURCE_LOCATION_REFERENCE_INVALID");
    if (!location.page && !location.section && !location.figureOrTable) errors.push("RECIPE_SOURCE_LOCATION_NOT_EXACT");
    // [B19-D I5e row 29] a locator names where the evidence is; it is not a place to carry text to the model
    for (const locator of [location.page, location.section, location.figureOrTable]) {
      if (locator !== undefined && locator !== null && String(locator).length > 200) errors.push("RECIPE_SOURCE_LOCATOR_TOO_LONG");
    }
    if (location.excerpt && location.excerpt.length > EMBEDDED_CIRCUIT_KNOWLEDGE_PROFILE_V1.limits.maximumSourceExcerptCharacters) errors.push("RECIPE_SOURCE_EXCERPT_TOO_LONG");
    if (location.excerpt && location.excerptHash !== circuitDigest(location.excerpt)) errors.push("RECIPE_SOURCE_EXCERPT_HASH_MISMATCH");
    if (!location.excerpt && !location.excerptHash.trim()) errors.push("RECIPE_SOURCE_EXCERPT_HASH_MISSING");
    if (location.excerpt) {
      const record = records.get(location.sourceRecordId); const source = record ? sources.get(record.sourceId) : undefined; const license = source ? licenses.get(source.licenseId) : undefined;
      if (!license || license.rawRedistribution !== "redistributable") errors.push("RECIPE_SOURCE_EXCERPT_LICENSE_BLOCKED");
    }
  }
  for (const item of bundle.evidence) if ((locations.get(item.id) ?? 0) !== 1) errors.push("RECIPE_EVIDENCE_REQUIRES_ONE_LOCATION");
  for (const authority of bundle.sourceAuthority) {
    if (!evidence.has(authority.evidenceId) || authority.claimKinds.length === 0) errors.push("RECIPE_SOURCE_AUTHORITY_INVALID");
  }
  for (const conflict of bundle.conflicts) {
    if (conflict.evidenceIds.length < 2 || conflict.evidenceIds.some((id) => !evidence.has(id))) errors.push("RECIPE_SOURCE_CONFLICT_INVALID");
    if (conflict.state === "resolved" && !conflict.resolutionReviewId) errors.push("RECIPE_SOURCE_CONFLICT_RESOLUTION_MISSING");
  }
  const expectedHashes = [...new Set(bundle.sourceRecords.map((item) => item.contentHash))].sort();
  if (JSON.stringify([...bundle.immutableSourceHashes].sort()) !== JSON.stringify(expectedHashes)) errors.push("RECIPE_SOURCE_HASH_MANIFEST_MISMATCH");
  if (!bundle.freshnessPolicy.trim() || !bundle.retentionRedistributionPolicy.trim()) errors.push("RECIPE_SOURCE_POLICY_MISSING");
  if (bundle.deterministicDigest !== circuitDigest(withoutDigest(bundle))) errors.push("RECIPE_SOURCE_BUNDLE_DIGEST_MISMATCH");
  return [...new Set(errors)].sort();
}

export function createRecipeSourceBundle(input: Omit<RecipeSourceBundle, "sourceBundleId" | "deterministicDigest"> & { sourceBundleId?: string }): RecipeSourceBundle {
  const base = structuredClone({ ...input, sourceBundleId: input.sourceBundleId ?? circuitId("recipe-sources", input) });
  const bundle = { ...base, deterministicDigest: circuitDigest(base) };
  const errors = validateRecipeSourceBundle(bundle, { publicationScope: "private_review" }).filter((code) => code !== "RECIPE_SOURCE_RECORD_STALE");
  if (errors.length) throw new Error(errors.join(", "));
  return bundle;
}

export function createProposedRecipeClaim(input: Omit<ProposedRecipeClaim, "claimId" | "workflowState" | "deterministicDigest"> & { claimId?: string }): ProposedRecipeClaim {
  const machineGenerated = ["ocr", "llm"].includes(input.extractionMethod);
  const workflowState = "quarantined" as const;
  const base = structuredClone({ ...input, claimId: input.claimId ?? circuitId("recipe-claim", input), workflowState });
  if (!base.sourceEvidenceRefs.length || !base.sourceLocationRefs.length) throw new Error("RECIPE_CLAIM_TRACEABILITY_MISSING");
  if (machineGenerated && base.authorityAssessment === "suitable") base.authorityAssessment = "unknown";
  return { ...base, deterministicDigest: circuitDigest(base) };
}

export function validateClaimPromotion(claim: ProposedRecipeClaim, actor: EngineeringActor, sourceBundle: RecipeSourceBundle): string[] {
  const errors: string[] = [];
  if (claim.deterministicDigest !== circuitDigest(withoutDigest(claim))) errors.push("RECIPE_CLAIM_DIGEST_MISMATCH");
  if (claim.sourceBundleId !== sourceBundle.sourceBundleId) errors.push("RECIPE_CLAIM_SOURCE_BUNDLE_MISMATCH");
  if (claim.sourceEvidenceRefs.some((id) => !sourceBundle.evidence.some((item) => item.id === id))) errors.push("RECIPE_CLAIM_EVIDENCE_ORPHAN");
  if (claim.sourceLocationRefs.some((id) => !sourceBundle.sourceLocations.some((item) => item.evidenceId === id))) errors.push("RECIPE_CLAIM_LOCATION_ORPHAN");
  if (["approved", "validated", "in_review"].includes(claim.workflowState) && (actor.actorKind !== "human" || !["reviewer", "project_admin"].includes(actor.role))) errors.push("RECIPE_CLAIM_HUMAN_REVIEW_REQUIRED");
  if (["ocr", "llm"].includes(claim.extractionMethod) && claim.workflowState === "approved" && claim.authorityAssessment !== "suitable") errors.push("RECIPE_CLAIM_AUTHORITY_INSUFFICIENT");
  return errors.sort();
}
