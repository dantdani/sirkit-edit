/**
 * [B23-D] Physical-hardware evidence, defined and never fabricated (runbook B23-D :1000-1013: "Define but do not fabricate evidence for:"
 * manufacturer acceptance; produced board lot/serial identity; incoming inspection; continuity/power-on tests; functional test; assembly
 * results; deviations/rework; final physical qualification. "Only physical evidence may advance an assembled-product claim. Keep
 * `manufacturing.assembled-release` blocked until the required evidence and qualified human review exist."; D23-13; OD-175, OD-177).
 *
 *  - Eight closed record kinds with validators. Every record binds the release (`releaseId`, `archiveSha256`, board revision and
 *    digest), the unit or lot, the procedure, equipment and operator references (never empty), raw artifact digests, an execution class
 *    and a result; its details are closed per kind. References refuse a space and "@" (no prose, no address); operators and equipment
 *    are typed (`operator:`, `equipment:`); a digest-named field is `sha256:<64 hex>`. A regex cannot tell an id from a name.
 *  - Review is a qualified human's, derived from the trusted server context and NEVER from the record: a record that carries any
 *    review, approval, signature or attestation is invalid, and a review is asked of a server port by the record's id, kind and digest
 *    only. The port answers who reviewed and the actor ids the record's operators resolve to; the reviewer is none of them. No server
 *    composition root wires that port in B23 (`PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING` is "none").
 *  - None of these ever satisfies: a record without raw artifacts, with a dry-run class, with any result but pass, or without a
 *    server-derived human review of its exact digest; nor a deviation disposed "use as is" (a waiver never satisfies a physical gate).
 *  - `assembledProductEligibility()` answers blocked, with the missing kinds, for every input: even with every kind satisfied, the
 *    assembly-data authority (exact approved MPN, population variant, BOM, placement, paste) does not exist (`ASSEMBLY_DATA_AUTHORITY`).
 *
 * Pure: it persists nothing, holds no state and reads neither the environment nor the network. Nothing creates a record: no route, store, tool or form imports this
 * module (b23-d-physical-evidence-contract case 8). Recording physical evidence is B24-E's, under LB-5.
 */
import { durableWorkflowDigest } from "../durable-workflow/stable";

export const PHYSICAL_EVIDENCE_SCHEMA = "sirkit.physical-evidence.v1" as const;
/** The eight kinds, in the runbook's order (:1002-1011). */
export const PHYSICAL_EVIDENCE_KINDS = Object.freeze(["manufacturer_acceptance", "unit_lot_identity", "incoming_inspection", "continuity_power_on", "functional_test", "assembly_result", "deviation_rework", "final_physical_qualification"] as const);
export type PhysicalEvidenceKind = (typeof PHYSICAL_EVIDENCE_KINDS)[number];
/** Each kind in the runbook's own words. */
export const PHYSICAL_EVIDENCE_RUNBOOK: Readonly<Record<PhysicalEvidenceKind, string>> = Object.freeze({
  manufacturer_acceptance: "manufacturer acceptance",
  unit_lot_identity: "produced board lot/serial identity",
  incoming_inspection: "incoming inspection",
  continuity_power_on: "continuity/power-on tests",
  functional_test: "functional test",
  assembly_result: "assembly results",
  deviation_rework: "deviations/rework",
  final_physical_qualification: "final physical qualification",
});
/** Required for an assembled-product claim; deviation/rework is required for each nonconformance a record names (OD-175). */
export const ASSEMBLED_CLAIM_REQUIRED_KINDS = Object.freeze(PHYSICAL_EVIDENCE_KINDS.filter((kind) => kind !== "deviation_rework"));
export const PHYSICAL_EVIDENCE_RESULTS = Object.freeze(["pass", "fail", "indeterminate", "invalid"] as const);
export type PhysicalEvidenceResult = (typeof PHYSICAL_EVIDENCE_RESULTS)[number];
export const PHYSICAL_EVIDENCE_EXECUTION_CLASSES = Object.freeze(["hardware", "dry_run"] as const);
export type PhysicalEvidenceExecutionClass = (typeof PHYSICAL_EVIDENCE_EXECUTION_CLASSES)[number];
export const CONTINUITY_POWER_ON_CHECKS = Object.freeze(["continuity", "isolation", "power_on", "rail_voltage", "current_draw"] as const);
/** `use_as_is` is a waiver: it never satisfies and never closes a nonconformance. */
export const DEVIATION_DISPOSITIONS = Object.freeze(["rework", "repair", "scrap", "use_as_is"] as const);
export const PHYSICAL_EVIDENCE_LIMITS = Object.freeze({ records: 512, equipmentRefs: 64, operatorRefs: 16, rawArtifacts: 256, nonconformanceRefs: 64, unitSerials: 4096, reliesOn: 64, quantity: 1_000_000, artifactBytes: 2 ** 40 });

export interface PhysicalReleaseBinding { readonly releaseId: string; readonly archiveSha256: string; readonly boardRevision: string; readonly boardDigest: string }
export interface PhysicalEvidenceSubject { readonly scope: "unit" | "lot"; readonly lotId: string; readonly unitSerial: string | null }
export interface PhysicalEvidenceProcedure { readonly procedureRef: string; readonly procedureRevision: string; readonly procedureDigest: string }
export interface PhysicalRawArtifact { readonly artifactRef: string; readonly sha256: string; readonly bytes: number }
export interface ManufacturerAcceptanceDetails { readonly manufacturerRef: string; readonly acceptanceRef: string; readonly acceptedFilesDigest: string }
export interface UnitLotIdentityDetails { readonly lotQuantity: number; readonly unitSerials: readonly string[] }
export interface IncomingInspectionDetails { readonly inspectedQuantity: number; readonly nonconformingQuantity: number; readonly acceptanceCriteriaRef: string }
export interface ContinuityPowerOnDetails { readonly checks: ReadonlyArray<(typeof CONTINUITY_POWER_ON_CHECKS)[number]> }
export interface FunctionalTestDetails { readonly testDefinitionRef: string; readonly testDefinitionDigest: string }
export interface AssemblyResultDetails { readonly assemblyDataDigest: string; readonly populationVariantRef: string }
export interface DeviationReworkDetails { readonly nonconformanceRef: string; readonly disposition: (typeof DEVIATION_DISPOSITIONS)[number]; readonly instructionRef: string; readonly retestRecordIds: readonly string[] }
export interface FinalPhysicalQualificationDetails { readonly qualificationPlanRef: string; readonly reliesOnRecordIds: readonly string[] }
interface PhysicalEvidenceDetailsByKind {
  manufacturer_acceptance: ManufacturerAcceptanceDetails;
  unit_lot_identity: UnitLotIdentityDetails;
  incoming_inspection: IncomingInspectionDetails;
  continuity_power_on: ContinuityPowerOnDetails;
  functional_test: FunctionalTestDetails;
  assembly_result: AssemblyResultDetails;
  deviation_rework: DeviationReworkDetails;
  final_physical_qualification: FinalPhysicalQualificationDetails;
}
/** One closed record of kind K. It carries no review field: review is the server's (OD-175). */
export type PhysicalEvidenceRecordOf<K extends PhysicalEvidenceKind> = {
  readonly schema: typeof PHYSICAL_EVIDENCE_SCHEMA;
  readonly kind: K;
  readonly recordId: string;
  readonly release: PhysicalReleaseBinding;
  readonly subject: PhysicalEvidenceSubject;
  readonly procedure: PhysicalEvidenceProcedure;
  readonly equipmentRefs: readonly string[];
  readonly operatorRefs: readonly string[];
  readonly rawArtifacts: readonly PhysicalRawArtifact[];
  readonly executionClass: PhysicalEvidenceExecutionClass;
  readonly result: PhysicalEvidenceResult;
  readonly performedAt: string;
  readonly nonconformanceRefs: readonly string[];
  readonly details: PhysicalEvidenceDetailsByKind[K];
};
export type PhysicalEvidenceRecord = { [K in PhysicalEvidenceKind]: PhysicalEvidenceRecordOf<K> }[PhysicalEvidenceKind];

/** The record's closed keys, every one required. */
export const PHYSICAL_EVIDENCE_RECORD_KEYS = Object.freeze(["schema", "kind", "recordId", "release", "subject", "procedure", "equipmentRefs", "operatorRefs", "rawArtifacts", "executionClass", "result", "performedAt", "nonconformanceRefs", "details"] as const);
/** Each kind's closed detail keys, every one required. */
export const PHYSICAL_EVIDENCE_DETAIL_KEYS: Readonly<Record<PhysicalEvidenceKind, readonly string[]>> = Object.freeze({
  manufacturer_acceptance: Object.freeze(["manufacturerRef", "acceptanceRef", "acceptedFilesDigest"]),
  unit_lot_identity: Object.freeze(["lotQuantity", "unitSerials"]),
  incoming_inspection: Object.freeze(["inspectedQuantity", "nonconformingQuantity", "acceptanceCriteriaRef"]),
  continuity_power_on: Object.freeze(["checks"]),
  functional_test: Object.freeze(["testDefinitionRef", "testDefinitionDigest"]),
  assembly_result: Object.freeze(["assemblyDataDigest", "populationVariantRef"]),
  deviation_rework: Object.freeze(["nonconformanceRef", "disposition", "instructionRef", "retestRecordIds"]),
  final_physical_qualification: Object.freeze(["qualificationPlanRef", "reliesOnRecordIds"]),
});
const RELEASE_KEYS = Object.freeze(["releaseId", "archiveSha256", "boardRevision", "boardDigest"] as const);
const SUBJECT_KEYS = Object.freeze(["scope", "lotId", "unitSerial"] as const);
const PROCEDURE_KEYS = Object.freeze(["procedureRef", "procedureRevision", "procedureDigest"] as const);
const ARTIFACT_KEYS = Object.freeze(["artifactRef", "sha256", "bytes"] as const);

const RELEASE_ID = /^mfg-release-[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const BOARD_REVISION = /^pcb2-[0-9a-f]{16}$/;
const BOARD_DIGEST = /^pcb-authority-[0-9a-f]{64}$/;
/** [B23-D review round] What a digest-named field binds: a content digest, never a free reference such as "TBD" (coverage-4). */
const CONTENT_DIGEST = /^sha256:[0-9a-f]{64}$/;
/** A record, lot, unit or actor identifier. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
/** A reference: an identifier or path-like id. It refuses a space and "@", so no prose and no address; a regex cannot tell an id from a name. */
const REF = /^[A-Za-z0-9][A-Za-z0-9_.:/#+-]{0,199}$/;
/** [B23-D review round] Typed references: an operator or an equipment item is named by a typed id, never by bare words (coverage-6). */
const OPERATOR_REF = /^operator:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const EQUIPMENT_REF = /^equipment:[A-Za-z0-9][A-Za-z0-9_.:/#+-]{0,189}$/;
/** [B23-D review round] Sirkit's own minted manufacturing ids (a release, an outbound package, a provider observation or exchange): never a manufacturer's acceptance (security-3). */
const SIRKIT_MINTED_ID = /^mfg-/;
/** A key that would carry a review inside the record (never read: review is the server's). */
const REVIEW_SHAPED_KEY = /review|approv|sign|attest|verif/i;
const REVIEW_SHAPED_PROBLEM = "a record never carries its own review; review is derived from the server context";

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isInstant = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const isWhole = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
/** A plain-data copy (the structured clone), or not ok when the value cannot be copied as data. */
const plainCopy = (value: unknown): { readonly ok: true; readonly value: unknown } | { readonly ok: false } => {
  try {
    return { ok: true, value: structuredClone(value) };
  } catch {
    return { ok: false };
  }
};
const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Closed keys: every listed key present, nothing else (a review-shaped extra key is named as such). */
function closedKeys(value: Record<string, unknown>, keys: readonly string[], path: string, problems: string[]): void {
  for (const key of Object.keys(value)) {
    if (keys.includes(key)) continue;
    problems.push(`${path}${key}: ${REVIEW_SHAPED_KEY.test(key) ? REVIEW_SHAPED_PROBLEM : "unknown key"}`);
  }
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) problems.push(`${path}${key}: required`);
}
function text(value: unknown, pattern: RegExp, path: string, what: string, problems: string[]): void {
  if (value === undefined) return; // reported once, as required
  if (typeof value !== "string" || !pattern.test(value)) problems.push(`${path}: ${what}`);
}
/** A list of distinct texts matching `pattern`, of length min..max. */
function list(value: unknown, pattern: RegExp, min: number, max: number, path: string, problems: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length < min || value.length > max || value.some((item) => typeof item !== "string" || !pattern.test(item)) || new Set(value).size !== value.length) problems.push(`${path}: ${min} to ${max} distinct references`);
}
/** [B23-D review round] The manufacturer's own reference: never one of Sirkit's minted ids (security-3). */
function manufacturerOwn(value: unknown, path: string, problems: string[]): void {
  if (typeof value === "string" && REF.test(value) && SIRKIT_MINTED_ID.test(value)) problems.push(`${path}: the manufacturer's own reference, never a Sirkit id (mfg-...)`);
}

function validateDetails(kind: PhysicalEvidenceKind, details: Record<string, unknown>, record: Record<string, unknown>, problems: string[]): void {
  const release = isRecord(record.release) ? record.release : {};
  switch (kind) {
    case "manufacturer_acceptance":
      text(details.manufacturerRef, REF, "details.manufacturerRef", "a reference", problems);
      text(details.acceptanceRef, REF, "details.acceptanceRef", "a reference", problems);
      manufacturerOwn(details.manufacturerRef, "details.manufacturerRef", problems);
      manufacturerOwn(details.acceptanceRef, "details.acceptanceRef", problems);
      // [B23-D review round] only the release's own archive: nothing here can tie an outbound package digest to this release (security-3, coverage-3)
      if (details.acceptedFilesDigest !== undefined && !(typeof details.acceptedFilesDigest === "string" && SHA256.test(details.acceptedFilesDigest) && details.acceptedFilesDigest === release.archiveSha256)) problems.push("details.acceptedFilesDigest: the release's archiveSha256");
      return;
    case "unit_lot_identity": {
      if (details.lotQuantity !== undefined && !isWhole(details.lotQuantity, 1, PHYSICAL_EVIDENCE_LIMITS.quantity)) problems.push(`details.lotQuantity: a whole number from 1 to ${PHYSICAL_EVIDENCE_LIMITS.quantity}`);
      list(details.unitSerials, ID, 0, PHYSICAL_EVIDENCE_LIMITS.unitSerials, "details.unitSerials", problems);
      if (Array.isArray(details.unitSerials) && isWhole(details.lotQuantity, 1, PHYSICAL_EVIDENCE_LIMITS.quantity) && details.unitSerials.length > details.lotQuantity) problems.push("details.unitSerials: more serials than the lot holds");
      const subject = isRecord(record.subject) ? record.subject : {};
      if (subject.scope === "unit" && Array.isArray(details.unitSerials) && !details.unitSerials.includes(subject.unitSerial)) problems.push("details.unitSerials: a unit record lists its own serial");
      return;
    }
    case "incoming_inspection":
      if (details.inspectedQuantity !== undefined && !isWhole(details.inspectedQuantity, 1, PHYSICAL_EVIDENCE_LIMITS.quantity)) problems.push(`details.inspectedQuantity: a whole number from 1 to ${PHYSICAL_EVIDENCE_LIMITS.quantity}`);
      if (details.nonconformingQuantity !== undefined && !(isWhole(details.nonconformingQuantity, 0, PHYSICAL_EVIDENCE_LIMITS.quantity) && isWhole(details.inspectedQuantity, 1, PHYSICAL_EVIDENCE_LIMITS.quantity) && details.nonconformingQuantity <= details.inspectedQuantity)) problems.push("details.nonconformingQuantity: a whole number from 0 to inspectedQuantity");
      text(details.acceptanceCriteriaRef, REF, "details.acceptanceCriteriaRef", "a reference", problems);
      if (isWhole(details.nonconformingQuantity, 1, PHYSICAL_EVIDENCE_LIMITS.quantity) && Array.isArray(record.nonconformanceRefs) && record.nonconformanceRefs.length === 0) problems.push("nonconformanceRefs: a nonconforming quantity names its nonconformances");
      return;
    case "continuity_power_on":
      if (details.checks === undefined) return;
      if (!Array.isArray(details.checks) || details.checks.length === 0 || details.checks.some((item) => !(CONTINUITY_POWER_ON_CHECKS as readonly unknown[]).includes(item)) || new Set(details.checks).size !== details.checks.length) problems.push(`details.checks: distinct checks of ${CONTINUITY_POWER_ON_CHECKS.join(", ")}`);
      else if (!details.checks.includes("continuity") || !details.checks.includes("power_on")) problems.push("details.checks: continuity and power_on are both required");
      return;
    case "functional_test":
      text(details.testDefinitionRef, REF, "details.testDefinitionRef", "a reference", problems);
      text(details.testDefinitionDigest, CONTENT_DIGEST, "details.testDefinitionDigest", "sha256:<64 hex>", problems);
      return;
    case "assembly_result":
      text(details.assemblyDataDigest, CONTENT_DIGEST, "details.assemblyDataDigest", "sha256:<64 hex>", problems);
      text(details.populationVariantRef, REF, "details.populationVariantRef", "a reference", problems);
      return;
    case "deviation_rework":
      text(details.nonconformanceRef, REF, "details.nonconformanceRef", "a reference", problems);
      if (details.disposition !== undefined && !(DEVIATION_DISPOSITIONS as readonly unknown[]).includes(details.disposition)) problems.push(`details.disposition: one of ${DEVIATION_DISPOSITIONS.join(", ")}`);
      text(details.instructionRef, REF, "details.instructionRef", "a reference", problems);
      list(details.retestRecordIds, ID, 0, PHYSICAL_EVIDENCE_LIMITS.reliesOn, "details.retestRecordIds", problems);
      if (Array.isArray(details.retestRecordIds) && details.retestRecordIds.includes(record.recordId)) problems.push("details.retestRecordIds: a record cannot rely on itself");
      return;
    case "final_physical_qualification":
      text(details.qualificationPlanRef, REF, "details.qualificationPlanRef", "a reference", problems);
      if (details.reliesOnRecordIds !== undefined && (!Array.isArray(details.reliesOnRecordIds) || details.reliesOnRecordIds.length < 1 || details.reliesOnRecordIds.length > PHYSICAL_EVIDENCE_LIMITS.reliesOn || details.reliesOnRecordIds.some((item) => typeof item !== "string" || !ID.test(item)) || new Set(details.reliesOnRecordIds).size !== details.reliesOnRecordIds.length)) problems.push(`details.reliesOnRecordIds: 1 to ${PHYSICAL_EVIDENCE_LIMITS.reliesOn} distinct record ids`);
      else if (Array.isArray(details.reliesOnRecordIds) && details.reliesOnRecordIds.includes(record.recordId)) problems.push("details.reliesOnRecordIds: a record cannot rely on itself");
      return;
  }
}

export type PhysicalEvidenceValidation = { readonly ok: true; readonly record: PhysicalEvidenceRecord; readonly digest: string } | { readonly ok: false; readonly problems: readonly string[] };

/** The record's closed shape, field by field; a valid record comes back deep-frozen with its digest. */
export function validatePhysicalEvidenceRecord(input: unknown): PhysicalEvidenceValidation {
  // [B23-D] copied once before any read, so what is checked is exactly what is returned and digested (a getter or proxy cannot answer twice)
  const copied = plainCopy(input);
  if (!copied.ok) return Object.freeze({ ok: false as const, problems: Object.freeze(["record: plain data"]) });
  const value = copied.value;
  if (!isRecord(value)) return Object.freeze({ ok: false as const, problems: Object.freeze(["record: an object"]) });
  const problems: string[] = [];
  closedKeys(value, PHYSICAL_EVIDENCE_RECORD_KEYS, "", problems);
  if (value.schema !== undefined && value.schema !== PHYSICAL_EVIDENCE_SCHEMA) problems.push(`schema: ${PHYSICAL_EVIDENCE_SCHEMA}`);
  const kind = (PHYSICAL_EVIDENCE_KINDS as readonly unknown[]).includes(value.kind) ? (value.kind as PhysicalEvidenceKind) : null;
  if (value.kind !== undefined && kind === null) problems.push(`kind: one of ${PHYSICAL_EVIDENCE_KINDS.join(", ")}`);
  text(value.recordId, ID, "recordId", "an identifier", problems);
  if (value.release !== undefined) {
    if (!isRecord(value.release)) problems.push("release: an object");
    else {
      closedKeys(value.release, RELEASE_KEYS, "release.", problems);
      text(value.release.releaseId, RELEASE_ID, "release.releaseId", "mfg-release-<32 hex>", problems);
      text(value.release.archiveSha256, SHA256, "release.archiveSha256", "a lowercase SHA-256", problems);
      text(value.release.boardRevision, BOARD_REVISION, "release.boardRevision", "pcb2-<16 hex>", problems);
      text(value.release.boardDigest, BOARD_DIGEST, "release.boardDigest", "pcb-authority-<sha256>", problems);
    }
  }
  if (value.subject !== undefined) {
    if (!isRecord(value.subject)) problems.push("subject: an object");
    else {
      closedKeys(value.subject, SUBJECT_KEYS, "subject.", problems);
      if (value.subject.scope !== undefined && value.subject.scope !== "unit" && value.subject.scope !== "lot") problems.push("subject.scope: unit or lot");
      text(value.subject.lotId, ID, "subject.lotId", "an identifier", problems);
      if (value.subject.scope === "unit" && !(typeof value.subject.unitSerial === "string" && ID.test(value.subject.unitSerial))) problems.push("subject.unitSerial: a unit record names its serial");
      if (value.subject.scope === "lot" && value.subject.unitSerial !== null) problems.push("subject.unitSerial: a lot record names no serial (null)");
    }
  }
  if (value.procedure !== undefined) {
    if (!isRecord(value.procedure)) problems.push("procedure: an object");
    else {
      closedKeys(value.procedure, PROCEDURE_KEYS, "procedure.", problems);
      text(value.procedure.procedureRef, REF, "procedure.procedureRef", "a reference", problems);
      text(value.procedure.procedureRevision, REF, "procedure.procedureRevision", "a reference", problems);
      text(value.procedure.procedureDigest, CONTENT_DIGEST, "procedure.procedureDigest", "sha256:<64 hex>", problems); // [B23-D review round] coverage-4
    }
  }
  // [B23-D] D23-14's hardening: equipment and operator references are bound and never empty (factory.ts:5 accepts an empty list and has no operator)
  list(value.equipmentRefs, EQUIPMENT_REF, 1, PHYSICAL_EVIDENCE_LIMITS.equipmentRefs, "equipmentRefs", problems);
  list(value.operatorRefs, OPERATOR_REF, 1, PHYSICAL_EVIDENCE_LIMITS.operatorRefs, "operatorRefs", problems);
  if (value.rawArtifacts !== undefined) {
    if (!Array.isArray(value.rawArtifacts) || value.rawArtifacts.length > PHYSICAL_EVIDENCE_LIMITS.rawArtifacts) problems.push(`rawArtifacts: a list of at most ${PHYSICAL_EVIDENCE_LIMITS.rawArtifacts} raw artifact digests`);
    else {
      value.rawArtifacts.forEach((artifact, index) => {
        const path = `rawArtifacts[${index}].`;
        if (!isRecord(artifact)) { problems.push(`rawArtifacts[${index}]: an object`); return; }
        closedKeys(artifact, ARTIFACT_KEYS, path, problems);
        text(artifact.artifactRef, REF, `${path}artifactRef`, "a reference", problems);
        text(artifact.sha256, SHA256, `${path}sha256`, "a lowercase SHA-256", problems);
        if (artifact.bytes !== undefined && !isWhole(artifact.bytes, 0, PHYSICAL_EVIDENCE_LIMITS.artifactBytes)) problems.push(`${path}bytes: a whole byte count`);
      });
      const refs = value.rawArtifacts.map((artifact) => (isRecord(artifact) ? artifact.artifactRef : undefined));
      if (new Set(refs).size !== refs.length) problems.push("rawArtifacts: distinct artifact references");
    }
  }
  if (value.executionClass !== undefined && !(PHYSICAL_EVIDENCE_EXECUTION_CLASSES as readonly unknown[]).includes(value.executionClass)) problems.push(`executionClass: one of ${PHYSICAL_EVIDENCE_EXECUTION_CLASSES.join(", ")}`);
  if (value.result !== undefined && !(PHYSICAL_EVIDENCE_RESULTS as readonly unknown[]).includes(value.result)) problems.push(`result: one of ${PHYSICAL_EVIDENCE_RESULTS.join(", ")}`);
  if (value.performedAt !== undefined && !isInstant(value.performedAt)) problems.push("performedAt: a canonical ISO-8601 instant");
  list(value.nonconformanceRefs, REF, 0, PHYSICAL_EVIDENCE_LIMITS.nonconformanceRefs, "nonconformanceRefs", problems);
  if (value.details !== undefined) {
    if (!isRecord(value.details)) problems.push("details: an object");
    else if (kind !== null) {
      closedKeys(value.details, PHYSICAL_EVIDENCE_DETAIL_KEYS[kind], "details.", problems);
      validateDetails(kind, value.details, value, problems);
    }
  }
  if (problems.length > 0) return Object.freeze({ ok: false as const, problems: Object.freeze(problems) });
  const record = deepFreeze(value) as unknown as PhysicalEvidenceRecord;
  return Object.freeze({ ok: true as const, record, digest: physicalEvidenceRecordDigest(record) });
}

/** The digest a review binds: the canonical JSON of the whole record, domain-separated by the schema. */
export function physicalEvidenceRecordDigest(record: PhysicalEvidenceRecord): string {
  return `physical-evidence-${durableWorkflowDigest({ schema: PHYSICAL_EVIDENCE_SCHEMA, record }).slice("dw1-".length)}`;
}

// ─── review: a qualified human, derived from the server, never from the record ──────────────────────────────────────────────

/** The closed keys of a server-derived review. [B23-D review round] `operatorActorIds`: the actor ids the server resolves the stored record's operators to (security-1). */
export const PHYSICAL_EVIDENCE_REVIEW_KEYS = Object.freeze(["derivation", "reviewerActorId", "operatorActorIds", "actorKind", "role", "qualificationRef", "reviewedRecordDigest", "reviewedAt"] as const);
/** Who may review in B23: a human project administrator with a recorded qualification (no new role until the owner names one, OD-187). */
export const PHYSICAL_EVIDENCE_REVIEWER_ROLES = Object.freeze(["project_admin"] as const);
/** What a server port answers: the reviewing human is the authenticated session's, never a claim in a body, a record or the browser. */
export interface ServerDerivedHumanReview {
  readonly derivation: "server_session";
  readonly reviewerActorId: string;
  /** One actor id per `operatorRefs` entry, in order: who the stored record's operators are, resolved by the server (never the record's word). */
  readonly operatorActorIds: readonly string[];
  readonly actorKind: "human";
  readonly role: (typeof PHYSICAL_EVIDENCE_REVIEWER_ROLES)[number];
  readonly qualificationRef: string;
  readonly reviewedRecordDigest: string;
  readonly reviewedAt: string;
}
/** What the port is asked: the record's id, kind and digest, never the record itself. */
export interface PhysicalEvidenceReviewRequest { readonly recordId: string; readonly kind: PhysicalEvidenceKind; readonly recordDigest: string }
/** A server composition root's port to the stored, reviewed evidence. Its answer is validated here, never trusted as given. */
export type PhysicalEvidenceReviewPort = (request: PhysicalEvidenceReviewRequest) => unknown;
export type PhysicalEvidenceReviewPortWiring = "none" | "wired";
/** [B23-D] No server composition root wires a review port in B23; the reviewed change that wires one changes this constant with it. */
export const PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING: PhysicalEvidenceReviewPortWiring = "none";

/** Why a record does not count, in a closed order. */
export const PHYSICAL_EVIDENCE_REJECTIONS = Object.freeze(["record_invalid", "duplicate_record_id", "release_mismatch", "subject_mismatch", "subject_scrapped", "raw_artifacts_absent", "dry_run_class", "result_not_pass", "waiver_disposition", "review_absent", "review_not_server_derived_human", "review_not_bound", "review_by_operator", "relies_on_unsatisfied"] as const);
export type PhysicalEvidenceRejection = (typeof PHYSICAL_EVIDENCE_REJECTIONS)[number];
export interface PhysicalEvidenceVerdict {
  readonly index: number;
  readonly recordId: string | null;
  readonly kind: PhysicalEvidenceKind | null;
  readonly satisfies: boolean;
  readonly rejections: readonly PhysicalEvidenceRejection[];
  readonly problems: readonly string[];
}

function reviewRejection(given: unknown, record: PhysicalEvidenceRecord, digest: string): PhysicalEvidenceRejection | null {
  if (given === null || given === undefined) return "review_absent";
  const copied = plainCopy(given); // read once, as data: an answer cannot change between the check and the comparison
  if (!copied.ok || !isRecord(copied.value)) return "review_not_server_derived_human";
  const answer = copied.value;
  const problems: string[] = [];
  closedKeys(answer, PHYSICAL_EVIDENCE_REVIEW_KEYS, "", problems);
  if (problems.length > 0 || answer.derivation !== "server_session" || answer.actorKind !== "human" || !(PHYSICAL_EVIDENCE_REVIEWER_ROLES as readonly unknown[]).includes(answer.role) || typeof answer.reviewerActorId !== "string" || !ID.test(answer.reviewerActorId) || typeof answer.qualificationRef !== "string" || !REF.test(answer.qualificationRef) || !isInstant(answer.reviewedAt) || typeof answer.reviewedRecordDigest !== "string") return "review_not_server_derived_human";
  // [B23-D review round] the server resolves every operator to an actor id, one per reference: without that, separation is unproven (security-1)
  const operators = answer.operatorActorIds;
  if (!Array.isArray(operators) || operators.length !== record.operatorRefs.length || operators.some((item) => typeof item !== "string" || !ID.test(item))) return "review_not_server_derived_human";
  if (answer.reviewedRecordDigest !== digest || Date.parse(answer.reviewedAt) < Date.parse(record.performedAt)) return "review_not_bound";
  if (record.operatorRefs.includes(answer.reviewerActorId) || operators.includes(answer.reviewerActorId)) return "review_by_operator";
  return null;
}

function orderRejections(rejections: Iterable<PhysicalEvidenceRejection>): readonly PhysicalEvidenceRejection[] {
  const set = new Set(rejections);
  return Object.freeze(PHYSICAL_EVIDENCE_REJECTIONS.filter((rejection) => set.has(rejection)));
}

/** The claim a record is judged against. */
function claimProblems(release: unknown, lotId: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(release)) problems.push("release: an object");
  else {
    closedKeys(release, RELEASE_KEYS, "release.", problems);
    text(release.releaseId, RELEASE_ID, "release.releaseId", "mfg-release-<32 hex>", problems);
    text(release.archiveSha256, SHA256, "release.archiveSha256", "a lowercase SHA-256", problems);
    text(release.boardRevision, BOARD_REVISION, "release.boardRevision", "pcb2-<16 hex>", problems);
    text(release.boardDigest, BOARD_DIGEST, "release.boardDigest", "pcb-authority-<sha256>", problems);
  }
  if (typeof lotId !== "string" || !ID.test(lotId)) problems.push("lotId: an identifier");
  return problems;
}

/** One record's own rules: validity, the claim's release and lot, raw artifacts, hardware class, pass, no waiver, and the review. */
function judgeOne(index: number, value: unknown, release: PhysicalReleaseBinding, lotId: string, reviewPort: PhysicalEvidenceReviewPort | null): PhysicalEvidenceVerdict & { readonly digest: string | null; readonly record: PhysicalEvidenceRecord | null } {
  // [B23-D review round] read once, as data: a refused record's id and kind come from this one copy, never from the input again (security-5)
  const copied = plainCopy(value);
  const validation = copied.ok ? validatePhysicalEvidenceRecord(copied.value) : null;
  if (validation === null || !validation.ok) {
    const plain = copied.ok && isRecord(copied.value) ? copied.value : {};
    return Object.freeze({ index, recordId: typeof plain.recordId === "string" && ID.test(plain.recordId) ? plain.recordId : null, kind: (PHYSICAL_EVIDENCE_KINDS as readonly unknown[]).includes(plain.kind) ? (plain.kind as PhysicalEvidenceKind) : null, satisfies: false, rejections: Object.freeze(["record_invalid" as const]), problems: validation === null ? Object.freeze(["record: plain data"]) : validation.problems, digest: null, record: null });
  }
  const { record, digest } = validation;
  const rejections: PhysicalEvidenceRejection[] = [];
  if (RELEASE_KEYS.some((key) => record.release[key] !== release[key])) rejections.push("release_mismatch");
  if (record.subject.lotId !== lotId) rejections.push("subject_mismatch");
  if (record.rawArtifacts.length === 0) rejections.push("raw_artifacts_absent");
  if (record.executionClass !== "hardware") rejections.push("dry_run_class");
  if (record.result !== "pass") rejections.push("result_not_pass");
  if (record.kind === "deviation_rework" && record.details.disposition === "use_as_is") rejections.push("waiver_disposition");
  let answer: unknown = null;
  if (reviewPort !== null) {
    try {
      answer = reviewPort(Object.freeze({ recordId: record.recordId, kind: record.kind, recordDigest: digest }));
    } catch {
      answer = null;
    }
  }
  const review = reviewRejection(answer, record, digest);
  if (review !== null) rejections.push(review);
  const ordered = orderRejections(rejections);
  return Object.freeze({ index, recordId: record.recordId, kind: record.kind, satisfies: ordered.length === 0, rejections: ordered, problems: Object.freeze([]), digest, record });
}

const portOrNull = (reviewPort: unknown): PhysicalEvidenceReviewPort | null => (typeof reviewPort === "function" ? (reviewPort as PhysicalEvidenceReviewPort) : null);
const publicVerdict = ({ index, recordId, kind, satisfies, rejections, problems }: PhysicalEvidenceVerdict): PhysicalEvidenceVerdict => Object.freeze({ index, recordId, kind, satisfies, rejections, problems });

/**
 * One record's own rules (the cross-record rules - the lot's identity, the relies-on rule of deviation/rework and final physical
 * qualification, and the nonconformances other records raise - need the other records of an evaluation: `assembledProductEligibility`).
 * `reviewPort` undefined is the production default: none is wired, so no review exists.
 */
export function judgePhysicalEvidenceRecord(input: { readonly record: unknown; readonly release: PhysicalReleaseBinding; readonly lotId: string; readonly reviewPort?: PhysicalEvidenceReviewPort | null }): PhysicalEvidenceVerdict {
  const claim = readClaim(input, "record");
  if (!claim.ok) return Object.freeze({ index: 0, recordId: null, kind: null, satisfies: false, rejections: Object.freeze(["record_invalid" as const]), problems: Object.freeze(claim.problems.map((problem) => `claim.${problem}`)) });
  return publicVerdict(judgeOne(0, claim.given, claim.release, claim.lotId, claim.reviewPort));
}

type ClaimRead = { readonly ok: true; readonly given: unknown; readonly records: readonly unknown[]; readonly overLimit: boolean; readonly release: PhysicalReleaseBinding; readonly lotId: string; readonly reviewPort: PhysicalEvidenceReviewPort | null } | { readonly ok: false; readonly problems: readonly string[]; readonly reviewPort: PhysicalEvidenceReviewPort | null };
/**
 * [B23-D] The claim's fields, each read once; the release copied as data before it is checked, so what is checked is what is compared.
 * [B23-D review round] Every read of the caller's input happens here, inside one guard: a getter or a trap that throws makes the claim
 * invalid, never an exception (security-5). `field` names the one input the caller judges: a record, or the evaluation's records.
 */
function readClaim(input: unknown, field: "record" | "records"): ClaimRead {
  let reviewPort: PhysicalEvidenceReviewPort | null = null;
  try {
    const claim = isRecord(input) ? input : {};
    reviewPort = portOrNull(claim.reviewPort);
    const copied = plainCopy(claim.release);
    const release = copied.ok ? copied.value : null;
    const lotId = claim.lotId;
    const given = claim[field];
    const problems = claimProblems(release, lotId);
    if (problems.length > 0) return { ok: false, problems, reviewPort };
    const length = field === "records" && Array.isArray(given) ? given.length : 0;
    const overLimit = length > PHYSICAL_EVIDENCE_LIMITS.records;
    const records = overLimit ? [] : Array.from({ length }, (_, index) => (given as readonly unknown[])[index]);
    return { ok: true, given, records, overLimit, release: deepFreeze(release) as PhysicalReleaseBinding, lotId: lotId as string, reviewPort };
  } catch {
    return { ok: false, problems: ["input: plain data"], reviewPort };
  }
}

// ─── the assembled-product claim: blocked for every input ──────────────────────────────────────────────────────────────────

/** [B23-D] The assembly-data authority (exact approved MPN, population variant, BOM, placement, paste) does not exist in B23: qualification seals only bare_pcb. */
export const ASSEMBLY_DATA_AUTHORITY = "absent" as const;
export const ASSEMBLED_BLOCK_REASONS = Object.freeze(["assembly_data_authority_absent", "claim_invalid", "records_over_limit", "review_port_not_wired", "physical_evidence_missing"] as const);
export type AssembledBlockReason = (typeof ASSEMBLED_BLOCK_REASONS)[number];
/** OD-177: the two conditions, both needed. */
export const ASSEMBLED_RELEASE_UNBLOCK_CONDITION = "manufacturing.assembled-release stays blocked until both exist: assembly-data authority (exact approved MPN, population variant, BOM, placement and paste) and OD-175's physical evidence, every required kind satisfied, with a qualified human review derived from the server context." as const;
/** The only answer B23 can give: `eligible` is `false` by type. */
export interface AssembledProductEligibility {
  readonly eligible: false;
  readonly status: "blocked";
  readonly reasons: readonly AssembledBlockReason[];
  readonly missing: readonly PhysicalEvidenceKind[];
  readonly openNonconformances: readonly string[];
  readonly verdicts: readonly PhysicalEvidenceVerdict[];
  readonly unblockCondition: typeof ASSEMBLED_RELEASE_UNBLOCK_CONDITION;
}

function blocked(reasons: Iterable<AssembledBlockReason>, missing: readonly PhysicalEvidenceKind[], openNonconformances: readonly string[], verdicts: readonly PhysicalEvidenceVerdict[]): AssembledProductEligibility {
  const set = new Set<AssembledBlockReason>(["assembly_data_authority_absent", ...reasons]);
  if (missing.length > 0) set.add("physical_evidence_missing");
  return Object.freeze({ eligible: false as const, status: "blocked" as const, reasons: Object.freeze(ASSEMBLED_BLOCK_REASONS.filter((reason) => set.has(reason))), missing: Object.freeze([...missing]), openNonconformances: Object.freeze([...openNonconformances]), verdicts: Object.freeze([...verdicts]), unblockCondition: ASSEMBLED_RELEASE_UNBLOCK_CONDITION });
}

/**
 * Whether the assembled-product claim for one release and lot may advance: never in B23. Each record is judged by its own rules; then the
 * lot's identity binds every unit; [B23-D low round, 2026-10-05] every record of this release and lot raises what it names, a hardware failure itself,
 * whatever its serial listing or a duplicate id; a scrap that satisfies on its own removes its unit or lot, and [B23-D low round 2, 2026-10-05] a lot with no unit left is removed, so no other record of it satisfies; a deviation/rework counts only
 * when it acts on the subject that raised its nonconformance, no earlier than each record that raised it, and every retest it names is a later physical test
 * of that subject (scrap names none); and final physical qualification only when every record it relies on satisfies, after every failure and every hardware rework of the
 * claim, satisfying or not and removed or not. A kind is missing when no record of it satisfies; deviation/rework while a nonconformance stays open. Even with nothing missing the answer is blocked: `ASSEMBLY_DATA_AUTHORITY` is absent and no input can supply it.
 */
export function assembledProductEligibility(input: { readonly release: PhysicalReleaseBinding; readonly lotId: string; readonly records: readonly unknown[]; readonly reviewPort?: PhysicalEvidenceReviewPort | null }): AssembledProductEligibility {
  const claim = readClaim(input, "records");
  const reviewPort = claim.reviewPort;
  const portReason: AssembledBlockReason[] = reviewPort === null ? ["review_port_not_wired"] : [];
  if (!claim.ok) return blocked(["claim_invalid", ...portReason], ASSEMBLED_CLAIM_REQUIRED_KINDS, [], []);
  const { release, lotId } = claim;
  if (claim.overLimit) return blocked(["records_over_limit", ...portReason], ASSEMBLED_CLAIM_REQUIRED_KINDS, [], []);
  const judged = claim.records.map((value, index) => judgeOne(index, value, release, lotId, reviewPort));
  // two records with one id are both void: what relies on that id could mean either
  const counts = new Map<string, number>();
  for (const verdict of judged) if (verdict.record) counts.set(verdict.record.recordId, (counts.get(verdict.record.recordId) ?? 0) + 1);
  const withDuplicates = judged.map((verdict) => (verdict.record && (counts.get(verdict.record.recordId) ?? 0) > 1 ? { ...verdict, satisfies: false, rejections: orderRejections([...verdict.rejections, "duplicate_record_id"]) } : verdict));
  // pass 1: the records that rely on nothing; pass 2: deviation/rework on its retests; pass 3: final qualification on everything else
  // a retest comes after the rework it checks; what a final qualification relies on comes before it
  const satisfied = (verdicts: typeof withDuplicates, kinds: (kind: PhysicalEvidenceKind) => boolean): ReadonlyMap<string, PhysicalEvidenceRecord> => new Map(verdicts.filter((verdict) => verdict.satisfies && verdict.record && kinds(verdict.record.kind)).map((verdict) => [verdict.record!.recordId, verdict.record!] as const));
  const plain = (kind: PhysicalEvidenceKind): boolean => kind !== "deviation_rework" && kind !== "final_physical_qualification";
  // [B23-D review round] the lot's identity binds every unit (coverage-2): the claim's identity is its satisfying lot-scope identity records;
  // a unit record (a unit's own identity record included) names a serial every one of them lists, and an inspection inspects no more than the lot holds
  const identities = judged.flatMap((verdict) => (verdict.satisfies && verdict.record?.kind === "unit_lot_identity" && verdict.record.subject.scope === "lot" ? [verdict.record.details] : [])); // [B23-D lead, 2026-10-05] satisfying their own rules, whatever record shares their id: a duplicate never unbinds a unit or takes back a lot counted out (lead round)
  const lotQuantity = Math.min(...identities.map((identity) => identity.lotQuantity)); // Infinity while no identity bounds it
  const listed = (serial: string | null): boolean => identities.length > 0 && identities.every((identity) => serial !== null && identity.unitSerials.includes(serial));
  const outsideLot = (record: PhysicalEvidenceRecord): boolean => (record.subject.scope === "unit" && !listed(record.subject.unitSerial)) || (record.kind === "incoming_inspection" && record.details.inspectedQuantity > lotQuantity);
  const bound = withDuplicates.map((verdict) => (verdict.record && outsideLot(verdict.record) ? withRejection(verdict, "subject_mismatch") : verdict));
  // [B23-D review round] what each nonconformance is raised by (security-2, coverage-1): every valid record of this release and lot raises the nonconformances it names - and a hardware record whose result is not pass raises itself when it names none; [B23-D low round, 2026-10-05] whatever its serial listing or a duplicate id (low-1)
  const raisers = new Map<string, PhysicalEvidenceRecord[]>();
  for (const verdict of bound) {
    const record = verdict.record;
    if (!record || outsideClaim(verdict, record, lotId)) continue;
    const raised = record.nonconformanceRefs.length === 0 && record.executionClass === "hardware" && record.result !== "pass" ? [record.recordId] : record.nonconformanceRefs;
    for (const ref of raised) raisers.set(ref, [...(raisers.get(ref) ?? []), record]);
  }
  const kept = withoutScrapped(bound, removedSubjects(judged, identities, lotId)); // [B23-D low round, 2026-10-05] a scrap removes its unit or lot: no other record of it satisfies any kind (low-3); [B23-D low round 2, 2026-10-05] only one that satisfies on its own, and a lot with no unit left (low-4, low-5); [B23-D lead, 2026-10-05] its own rules, before the duplicate check: a duplicate never takes back a removal (lead round)
  const firstPass = satisfied(kept, plain);
  const afterRework = kept.map((verdict) => {
    if (!verdict.record || verdict.record.kind !== "deviation_rework" || !verdict.satisfies) return verdict;
    const rework = verdict.record;
    const { nonconformanceRef, disposition, retestRecordIds } = rework.details;
    const raisedBy = raisers.get(nonconformanceRef) ?? [];
    const reworkedAt = Date.parse(rework.performedAt);
    // [B23-D review round] it acts on the subject that raised the nonconformance, and each retest is a later physical test of that subject,
    // never the record that raised it (security-6, coverage-2)
    const onSubject = actsOn(rework, raisedBy); // [B23-D low round, 2026-10-05] and no earlier than each record that raised it (low-2)
    const retested = disposition === "scrap" || (retestRecordIds.length > 0 && retestRecordIds.every((id) => { const retest = firstPass.get(id); return retest !== undefined && (PHYSICAL_EVIDENCE_RETEST_KINDS as readonly PhysicalEvidenceKind[]).includes(retest.kind) && !raisedBy.some((raiser) => raiser.recordId === id) && Date.parse(retest.performedAt) >= reworkedAt && covers(retest.subject, rework.subject); }));
    return onSubject && retested ? verdict : withRejection(verdict, "relies_on_unsatisfied");
  });
  const secondPass = satisfied(afterRework, (kind) => kind !== "final_physical_qualification");
  // [B23-D review round] a final qualification comes after every failure or other raiser of a nonconformance and every rework of the claim; [B23-D low round 2, 2026-10-05] every hardware one, satisfying or not and removed or not: a removal never relaxes a rule (low-4)
  const settledAt = Math.max(Number.NEGATIVE_INFINITY, ...[...raisers.values()].flat().map((record) => Date.parse(record.performedAt)), ...reworkInstants(bound, lotId));
  const final = afterRework.map((verdict) => {
    if (!verdict.record || verdict.record.kind !== "final_physical_qualification" || !verdict.satisfies) return verdict;
    const qualifiedAt = Date.parse(verdict.record.performedAt);
    return qualifiedAt >= settledAt && verdict.record.details.reliesOnRecordIds.every((id) => { const relied = secondPass.get(id); return relied !== undefined && Date.parse(relied.performedAt) <= qualifiedAt; }) ? verdict : { ...verdict, satisfies: false, rejections: orderRejections([...verdict.rejections, "relies_on_unsatisfied"]) };
  });
  const satisfiedKinds = new Set(final.filter((verdict) => verdict.satisfies && verdict.kind).map((verdict) => verdict.kind!));
  // the nonconformances raised by records of this claim, less those a satisfying rework, repair or scrap closes
  const named = new Set<string>(raisers.keys());
  for (const verdict of final) if (verdict.satisfies && verdict.record?.kind === "deviation_rework") named.delete(verdict.record.details.nonconformanceRef);
  const openNonconformances = [...named].sort();
  const missing = PHYSICAL_EVIDENCE_KINDS.filter((kind) => (kind === "deviation_rework" ? openNonconformances.length > 0 : !satisfiedKinds.has(kind)));
  return blocked(portReason, missing, openNonconformances, final.map(publicVerdict));
}

// ─── [B23-D review round, 2026-10-05] the cross-record rules' vocabulary ───────────────────────────────────────────────────

/** What a rework's retest may be: a physical test of the reworked unit or lot (security-6). */
export const PHYSICAL_EVIDENCE_RETEST_KINDS = Object.freeze(["incoming_inspection", "continuity_power_on", "functional_test"] as const);
/** [B23-D low round, 2026-10-05] Outside the claim, a record raises and removes nothing for it: only another release or another lot puts it there, never its serial listing or a duplicate id (low-1). */
const outsideClaim = (verdict: PhysicalEvidenceVerdict, record: PhysicalEvidenceRecord, lotId: string): boolean => verdict.rejections.includes("release_mismatch") || record.subject.lotId !== lotId;
/** Whether subject `a` covers subject `b`: the same lot, a lot covering each of its units, and a unit only itself. */
const covers = (a: PhysicalEvidenceSubject, b: PhysicalEvidenceSubject): boolean => a.lotId === b.lotId && (a.scope === "lot" || (b.scope === "unit" && a.unitSerial === b.unitSerial));
/** The verdict with one more rejection: it no longer satisfies. */
const withRejection = <V extends PhysicalEvidenceVerdict>(verdict: V, rejection: PhysicalEvidenceRejection): V => ({ ...verdict, satisfies: false, rejections: orderRejections([...verdict.rejections, rejection]) });

// ─── [B23-D low round, 2026-10-05] the independent check's three low issues ─────────────────────────────────────────────────

/** A verdict as the evaluator holds it: with its validated record, or null when the record is invalid. */
type JudgedVerdict = PhysicalEvidenceVerdict & { readonly record: PhysicalEvidenceRecord | null };
/** Whether a deviation/rework acts on its nonconformance: its subject covers every record that raised it (security-6, coverage-2), and it comes no earlier than each of them (low-2) - so each retest, never earlier than the rework, is never earlier than they are. */
const actsOn = (rework: PhysicalEvidenceRecord, raisedBy: readonly PhysicalEvidenceRecord[]): boolean => raisedBy.every((raiser) => covers(rework.subject, raiser.subject) && Date.parse(raiser.performedAt) <= Date.parse(rework.performedAt));
/** A scrap disposition: the record of a removal, which no scrap removes. */
const isScrap = (record: PhysicalEvidenceRecord): boolean => record.kind === "deviation_rework" && record.details.disposition === "scrap";
/**
 * A scrap removes its unit or lot (low-3): no other record whose subject a removed subject covers, its passes included, satisfies any kind
 * (`subject_scrapped`). [B23-D low round 2, 2026-10-05] What is removed is `removedSubjects`'s: only a scrap that satisfies on its own (low-4), and a
 * lot with no unit left (low-5). A removal only takes evidence away: what a removed record raised, and when a removed rework was done, still count.
 * The scrap itself stays: it closes the nonconformance it names only when it satisfies and acts on it.
 */
const withoutScrapped = <V extends JudgedVerdict>(verdicts: readonly V[], removed: readonly PhysicalEvidenceSubject[]): V[] => {
  // [B23-D low round 2, 2026-10-05] `removed` is passed in: it was computed here from every hardware scrap of the claim, satisfying or not (low-4)
  return verdicts.map((verdict) => {
    const record = verdict.record;
    return record && !isScrap(record) && removed.some((subject) => covers(subject, record.subject)) ? withRejection(verdict, "subject_scrapped") : verdict;
  });
};

// ─── [B23-D low round 2, 2026-10-05] the second independent check's two low issues ─────────────────────────────────────────────

/**
 * What the claim's scraps remove (low-4, low-5). Only a scrap that satisfies on its own - its own rules (this release and lot, raw artifacts, hardware,
 * pass, a server-derived human review of its digest), whatever record shares its id ([B23-D lead, 2026-10-05]: a duplicate never takes a removal back) - is physical evidence of a removal; one that does not satisfy
 * removes nothing. Whether the lot's identity lists its unit does not decide whether a unit of the lot was scrapped, as it does not decide whether a
 * failure raises (low-1). A lot with no unit left is removed as well: once every serial one of its identities lists (one or more) is scrapped, or as
 * many distinct units as its smallest `lotQuantity`.
 */
const removedSubjects = (verdicts: readonly JudgedVerdict[], identities: readonly UnitLotIdentityDetails[], lotId: string): PhysicalEvidenceSubject[] => {
  const scraps = verdicts.flatMap((verdict) => (verdict.satisfies && verdict.record && isScrap(verdict.record) ? [verdict.record.subject] : []));
  const units = new Set(scraps.flatMap((subject) => (subject.scope === "unit" && subject.unitSerial !== null ? [subject.unitSerial] : [])));
  const noUnitLeft = units.size >= Math.min(...identities.map((identity) => identity.lotQuantity)) || identities.some((identity) => identity.unitSerials.length > 0 && identity.unitSerials.every((serial) => units.has(serial)));
  return noUnitLeft ? [...scraps, { scope: "lot", lotId, unitSerial: null }] : scraps;
};
/** The instants a final physical qualification must follow besides each raiser's (low-4): every hardware deviation/rework of this release and lot, satisfying or not and removed or not. */
const reworkInstants = (verdicts: readonly JudgedVerdict[], lotId: string): number[] => verdicts.flatMap((verdict) => (verdict.record?.kind === "deviation_rework" && verdict.record.executionClass === "hardware" && !outsideClaim(verdict, verdict.record, lotId) ? [Date.parse(verdict.record.performedAt)] : []));
