import { ingestRequirementSource, sourceRefForLocation } from "./source";
import { requirementsId } from "./stable";
import type { LegacyIntentInput, LegacyMigrationResult } from "./types";

export function migrateLegacyIntent(input: LegacyIntentInput): LegacyMigrationResult {
  const sourceArtifacts: LegacyMigrationResult["sourceArtifacts"] = [];
  const extractionEnvelopes: LegacyMigrationResult["extractionEnvelopes"] = [];
  const diagnostics: LegacyMigrationResult["diagnostics"] = [];
  if (input.description?.trim()) {
    const source = ingestRequirementSource({ tenantId: "legacy-local", projectId: input.projectId, sourceId: `legacy-project-description:${input.projectId}`, sourceKind: "existing_project_metadata", sourceVersion: "1", title: `${input.projectName} legacy project description`, authorOrPublisher: input.actorId, authorityClass: "imported_legacy_data", mediaType: "text/plain", content: input.description, capturedAt: input.sourceCapturedAt, accessPolicy: "project_private", privacyClassification: "confidential", benchmarkUse: "forbidden" });
    sourceArtifacts.push(source);
    const sourceSpan = { spanStartEnd: { start: 0, end: source.normalizedContent.length } };
    const candidateId = requirementsId("legacy-candidate", { source: source.immutableArtifactDigest });
    extractionEnvelopes.push({ schemaVersion: 1, sourceId: source.sourceId, sourceVersion: source.sourceVersion, candidates: [{ candidateId, lineageKey: `legacy-description:${input.projectId}`, sourceRef: sourceRefForLocation(source, sourceSpan), sourceSpan, candidateStatement: source.normalizedContent, title: "Legacy project intent (review required)", proposedDomain: "product_functional", proposedKind: "informational_context", proposedStrength: "informational", proposedAuthority: "imported_legacy_data", priority: 0, criticality: "normal", typedPredicate: { form: "qualitative_rubric", rubricId: "legacy-intent-review-v1", reviewMethod: "Authorized owner reviews and splits the description into typed requirement candidates.", authorizedReviewerRole: "project_admin" }, conditions: [], subjectRefsOrRoles: ["product"], capabilityDemandIds: [], ambiguityNotes: ["Legacy free-form description is preserved but not treated as confirmed intent."], missingFields: ["typed atomic requirements"], confidence: 1, rationaleForClassification: "Legacy prose has provenance but no evidence of prior requirements confirmation.", owner: input.actorId, requestedStatus: "proposed", extractionActor: { actorId: input.actorId, actorKind: "system_migration", toolSchemaDigest: "sirkit.legacy-intent-migration.v1" }, createdAt: input.sourceCapturedAt }] });
  }
  const orphanConstraintIds = input.existingConstraintDocuments.flatMap((document) => document.constraints.map((constraint) => constraint.id)).sort();
  if (orphanConstraintIds.length) diagnostics.push({ diagnosticId: requirementsId("reqdiag", { code: "LEGACY_ORPHAN_CONSTRAINTS", ids: orphanConstraintIds }), code: "LEGACY_ORPHAN_CONSTRAINTS", severity: "warning", requirementIds: [], sourceRefs: [], message: `${orphanConstraintIds.length} active or historical Stage 6 constraints have no justified requirement parent. They remain constraints and were not duplicated or given fabricated provenance.`, missingFields: ["authorized parent requirement"], nextActions: ["Review each constraint and link it only when an authorized source supports the relationship"] });
  return { sourceArtifacts, extractionEnvelopes, orphanConstraintIds, diagnostics };
}

