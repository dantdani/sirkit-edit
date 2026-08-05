import type { EngineeringActor } from "../engineering/types";
import { createPhysicalBindingCandidate } from "./domain";
import { nativeComponentIdentity } from "./identity";
import { physicalBindingDigest, physicalBindingId } from "./stable";
import {
  PHYSICAL_BINDING_MIGRATION_SCHEMA_VERSION,
  type ComponentPhysicalBinding,
  type LegacyFootprintAssignmentView,
  type PackageBinding,
  type PhysicalBindingMigrationRecord,
  type PhysicalBindingScope,
} from "./types";
import { normalizePackageBinding } from "./validation";

export interface LegacyPhysicalBindingInput {
  sourceSchemaVersion: string;
  scope: PhysicalBindingScope;
  rawComponent: Record<string, unknown>;
  actor: EngineeringActor;
  migratedAt: string;
}

export interface LegacyMigrationResult {
  migrationKey: string;
  candidate: ComponentPhysicalBinding;
  record: PhysicalBindingMigrationRecord;
  diagnostics: string[];
}

const RECOGNIZED = new Set(["footprint", "footprintHint", "package", "packageNormalized", "mpn", "manufacturer", "supplier", "supplierSku", "partId", "id", "refDes", "value"]);
const FULL_FOOTPRINT = /^([A-Za-z0-9_.+\-]+):([A-Za-z0-9_.+()\[\]\-]+)$/;

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.normalize("NFC").trim();
  if (!text || text.length > 1024 || /[\u0000-\u001f\u007f]/.test(text)) return undefined;
  return text;
}

function safeRaw(value: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).byteLength > 256_000) throw new Error("PB_LEGACY_PAYLOAD_TOO_LARGE");
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const visit = (child: unknown, depth: number): void => {
    if (depth > 20) throw new Error("PB_LEGACY_PAYLOAD_TOO_DEEP");
    if (typeof child === "string" && /\u0000/.test(child)) throw new Error("PB_LEGACY_NULL_BYTE");
    if (Array.isArray(child)) child.forEach((item) => visit(item, depth + 1));
    else if (child && typeof child === "object") Object.values(child as Record<string, unknown>).forEach((item) => visit(item, depth + 1));
  };
  visit(parsed, 0);
  return parsed;
}

function legacyPackage(raw: Record<string, unknown>, diagnostics: string[]): PackageBinding | undefined {
  const token = clean(raw.packageNormalized) ?? clean(raw.package);
  if (!token) return undefined;
  const explicit = /\b(metric|imperial)\b/i.exec(token)?.[1]?.toLowerCase();
  if (!explicit && /^(?:0402|0603|0805|1206|1210)$/i.test(token)) {
    diagnostics.push("PB_LEGACY_PACKAGE_AMBIGUOUS");
    return undefined;
  }
  try {
    return normalizePackageBinding({
      packageRevisionId: `legacy-package-revision:${physicalBindingDigest(token).slice(4, 36)}`,
      identitySystem: explicit ? "metric_imperial_explicit" : "project_defined",
      canonicalName: token,
      sourceToken: token,
      mountingTechnology: "unknown",
      exposedPad: "unknown",
      evidenceRefs: [],
    });
  } catch {
    diagnostics.push("PB_LEGACY_PACKAGE_UNPARSEABLE");
    return undefined;
  }
}

/** Non-destructive classifier. It never approves, verifies, or selects its result. */
export function migrateLegacyPhysicalBinding(input: LegacyPhysicalBindingInput, options: { dryRun?: boolean } = {}): LegacyMigrationResult {
  const rawFields = safeRaw(input.rawComponent);
  const diagnostics: string[] = [];
  const rawFootprint = clean(rawFields.footprint) ?? clean(rawFields.footprintHint);
  const footprintMatch = rawFootprint?.match(FULL_FOOTPRINT);
  if (rawFootprint && !footprintMatch) diagnostics.push("PB_LEGACY_FOOTPRINT_LOCATOR_UNPARSEABLE");
  const packageBinding = legacyPackage(rawFields, diagnostics);
  const manufacturer = clean(rawFields.manufacturer);
  const mpn = clean(rawFields.mpn);
  if (mpn && !manufacturer) diagnostics.push("PB_LEGACY_MPN_WITHOUT_MANUFACTURER");
  const migrationKey = physicalBindingId("physical-binding-migration", { sourceSchemaVersion: input.sourceSchemaVersion, scope: input.scope, rawFields });
  const evidenceRefs: string[] = [];
  const candidate = createPhysicalBindingCandidate({
    scope: input.scope,
    componentIdentity: nativeComponentIdentity(input.scope),
    classification: { populationKind: "unknown", deviceClass: "legacy_unclassified", mountingTechnology: "unknown", polarity: "unknown", classificationEvidenceRefs: [] },
    ...(manufacturer && mpn ? { exactPart: { exactPartId: physicalBindingId("legacy-exact-part", { manufacturer, mpn }), manufacturerId: physicalBindingId("legacy-manufacturer", manufacturer), exactPublishedMpn: mpn, supplierParts: clean(rawFields.supplierSku) && clean(rawFields.supplier) ? [{ supplierId: physicalBindingId("legacy-supplier", clean(rawFields.supplier)), supplierSku: clean(rawFields.supplierSku)! }] : [], evidenceRefs: [] } } : {}),
    ...(packageBinding ? { package: packageBinding } : {}),
    ...(footprintMatch ? { footprint: {
      logicalAssetId: `legacy-footprint:${physicalBindingDigest(rawFootprint).slice(4, 36)}`,
      assetVersionId: `legacy-unresolved:${physicalBindingDigest({ rawFootprint, source: input.sourceSchemaVersion }).slice(4, 36)}`,
      sourceNamespace: "legacy_locator" as const,
      sourceRevision: input.sourceSchemaVersion,
      libraryNickname: footprintMatch[1]!,
      footprintName: footprintMatch[2]!,
      availability: "unresolved" as const,
      validationState: "pending" as const,
      packageCompatibility: "unknown" as const,
      padIdentifiers: [], duplicatePadIdentifiers: [],
      geometry: { hasCourtyard: false, hasFabrication: false, hasSolderMaskDefinition: false, hasPasteDefinition: false, hasDrillDefinition: false, manufacturingValidated: false },
      evidenceRefs: [],
    } } : {}),
    pinPadMapping: { state: "legacy_unverified", evidenceRefs: [], reasonCodes: ["PB_LEGACY_MAPPING_NOT_VERIFIED"] },
    origin: { kind: "legacy_migration", actor: input.actor, sourceRef: migrationKey, createdAt: input.migratedAt, evidenceRefs: [], ruleVersion: "sirkit.physical-binding-migration/1" },
    evidenceRefs,
    applicabilityState: "unknown",
    legacySource: {
      migrationKey,
      sourceSchemaVersion: input.sourceSchemaVersion,
      rawFields,
      recognizedFields: Object.keys(rawFields).filter((key) => RECOGNIZED.has(key)).sort(),
      unrecognizedFields: Object.keys(rawFields).filter((key) => !RECOGNIZED.has(key)).sort(),
      diagnostics: [...new Set(diagnostics)].sort(),
    },
    createdAt: input.migratedAt,
    createdBy: input.actor,
    candidateKey: migrationKey,
  });
  const recordBase = {
    schemaVersion: PHYSICAL_BINDING_MIGRATION_SCHEMA_VERSION,
    migrationKey,
    tenantId: input.scope.tenantId,
    projectId: input.scope.projectId,
    branchId: input.scope.branchId,
    componentInstanceId: input.scope.componentInstanceId,
    sourceSchemaVersion: input.sourceSchemaVersion,
    candidateRevisionId: candidate.revisionId,
    status: (diagnostics.length ? "ambiguous" : "migrated") as "ambiguous" | "migrated",
    dryRun: options.dryRun === true,
    diagnosticCodes: [...new Set(diagnostics)].sort(),
    createdAt: input.migratedAt,
  };
  return { migrationKey, candidate, record: { ...recordBase, recordDigest: physicalBindingDigest(recordBase) }, diagnostics: recordBase.diagnosticCodes };
}

export function legacyFootprintAssignmentView(binding: ComponentPhysicalBinding): LegacyFootprintAssignmentView {
  const footprint = binding.footprint ? `${binding.footprint.libraryNickname}:${binding.footprint.footprintName}` : null;
  const approved = binding.lifecycleState === "selected" && binding.approval.state === "approved" && binding.approval.contentDigest === binding.technicalDigest && binding.pinPadMapping.state === "verified";
  return {
    schemaVersion: "sirkit.legacy-footprint-assignment-view.v1",
    authoritative: false,
    sourceBindingRevisionId: binding.revisionId,
    componentInstanceId: binding.scope.componentInstanceId,
    footprint,
    package: binding.package?.canonicalName ?? null,
    manufacturerPartNumber: binding.exactPart?.exactPublishedMpn ?? null,
    proofState: approved ? "approved" : footprint ? "candidate" : "unresolved",
    warnings: ["Compatibility projection only; mutations must target the authoritative physical-binding service.", ...(binding.origin.kind === "legacy_migration" ? ["Migrated legacy data is unapproved and unverified."] : [])],
  };
}
