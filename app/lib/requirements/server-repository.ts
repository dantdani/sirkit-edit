import { and, eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { designCapabilityProfiles, designRequirementPackages, requirementSourceRevisions, requirementTransactionRecords } from "@/app/lib/db/schema";
import { requirementsDigest } from "./stable";
import type { DesignCapabilityProfile, DesignRequirementsPackage, RequirementSourceArtifact, RequirementsTransactionRecord } from "./types";
import { validateDesignRequirementsPackage, validateSourceArtifact } from "./validation";

function profileIntegrity(profile: DesignCapabilityProfile): boolean {
  return requirementsDigest({ ...profile, deterministicDigest: undefined }) === profile.deterministicDigest;
}

export function validateRequirementsPersistence(input: { tenantId: string; projectId: string; package: DesignRequirementsPackage; sources: RequirementSourceArtifact[]; profile: DesignCapabilityProfile; record?: RequirementsTransactionRecord }): void {
  if (!input.tenantId.trim() || !input.projectId.trim() || input.package.projectId !== input.projectId) throw new Error("REQUIREMENTS_PERSISTENCE_SCOPE_MISMATCH");
  if (!validateDesignRequirementsPackage(input.package)) throw new Error("REQUIREMENTS_PACKAGE_INTEGRITY_FAILED");
  if (!profileIntegrity(input.profile) || !input.package.selectedCapabilityProfileRefs.includes(`${input.profile.profileId}@${input.profile.version}`)) throw new Error("REQUIREMENTS_CAPABILITY_PROFILE_INTEGRITY_FAILED");
  for (const source of input.sources) if (source.tenantId !== input.tenantId || source.projectId !== input.projectId || validateSourceArtifact(source).length) throw new Error(`REQUIREMENTS_SOURCE_INTEGRITY_FAILED:${source.sourceId}@${source.sourceVersion}`);
  const sourceSetDigest = requirementsDigest(input.sources.map((item) => ({ sourceId: item.sourceId, version: item.sourceVersion, digest: item.immutableArtifactDigest })).sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.version.localeCompare(right.version)));
  if (sourceSetDigest !== input.package.sourceSetDigest) throw new Error("REQUIREMENTS_SOURCE_SET_DIGEST_MISMATCH");
  if (input.record && input.record.resultPackageDigest !== input.package.deterministicDigest) throw new Error("REQUIREMENTS_TRANSACTION_PACKAGE_MISMATCH");
}

/** Persist source artifacts and one immutable package revision atomically. */
export async function persistRequirementsRevision(input: { tenantId: string; projectId: string; package: DesignRequirementsPackage; sources: RequirementSourceArtifact[]; profile: DesignCapabilityProfile; record?: RequirementsTransactionRecord }): Promise<void> {
  validateRequirementsPersistence(input);
  await getDb().transaction(async (tx) => {
    for (const source of input.sources) {
      const [existing] = await tx.select({ digest: requirementSourceRevisions.artifactDigest }).from(requirementSourceRevisions).where(and(eq(requirementSourceRevisions.tenantId, input.tenantId), eq(requirementSourceRevisions.projectId, input.projectId), eq(requirementSourceRevisions.sourceId, source.sourceId), eq(requirementSourceRevisions.sourceVersion, source.sourceVersion))).limit(1);
      if (existing && existing.digest !== source.immutableArtifactDigest) throw new Error(`IMMUTABLE_SOURCE_REVISION_COLLISION:${source.sourceId}@${source.sourceVersion}`);
      if (!existing) await tx.insert(requirementSourceRevisions).values({ tenantId: input.tenantId, projectId: input.projectId, sourceId: source.sourceId, sourceVersion: source.sourceVersion, artifactDigest: source.immutableArtifactDigest, accessPolicy: source.accessPolicy, privacyClassification: source.privacyClassification, artifact: source });
    }
    const [existingProfile] = await tx.select({ digest: designCapabilityProfiles.deterministicDigest }).from(designCapabilityProfiles).where(and(eq(designCapabilityProfiles.profileId, input.profile.profileId), eq(designCapabilityProfiles.version, input.profile.version))).limit(1);
    if (existingProfile && existingProfile.digest !== input.profile.deterministicDigest) throw new Error(`IMMUTABLE_CAPABILITY_PROFILE_COLLISION:${input.profile.profileId}@${input.profile.version}`);
    if (!existingProfile) await tx.insert(designCapabilityProfiles).values({ profileId: input.profile.profileId, version: input.profile.version, deterministicDigest: input.profile.deterministicDigest, profile: input.profile });
    const [existingPackage] = await tx.select({ digest: designRequirementPackages.packageDigest }).from(designRequirementPackages).where(and(eq(designRequirementPackages.packageId, input.package.packageId), eq(designRequirementPackages.revision, input.package.revision))).limit(1);
    if (existingPackage && existingPackage.digest !== input.package.deterministicDigest) throw new Error(`IMMUTABLE_REQUIREMENTS_PACKAGE_COLLISION:${input.package.packageId}@${input.package.revision}`);
    if (!existingPackage) await tx.insert(designRequirementPackages).values({ packageId: input.package.packageId, projectId: input.projectId, tenantId: input.tenantId, revision: input.package.revision, packageDigest: input.package.deterministicDigest, sourceSetDigest: input.package.sourceSetDigest, status: input.package.status, compilerVersion: input.package.compilerVersion, package: input.package });
    if (input.record) {
      const [existingRecord] = await tx.select({ digest: requirementTransactionRecords.integrityDigest }).from(requirementTransactionRecords).where(eq(requirementTransactionRecords.transactionId, input.record.transaction.transactionId)).limit(1);
      if (existingRecord && existingRecord.digest !== input.record.integrityDigest) throw new Error(`REQUIREMENTS_TRANSACTION_ID_COLLISION:${input.record.transaction.transactionId}`);
      if (!existingRecord) await tx.insert(requirementTransactionRecords).values({ transactionId: input.record.transaction.transactionId, tenantId: input.tenantId, projectId: input.projectId, branchId: input.record.transaction.branchId, packageRevision: input.record.resultPackageRevision, actorId: input.record.transaction.actor.actorId, status: input.record.status, integrityDigest: input.record.integrityDigest, record: input.record });
    }
  });
}
