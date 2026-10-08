/**
 * [B23-D] Physical-hardware evidence, defined and never fabricated (runbook B23-D :1000-1013: "Define but do not fabricate evidence for:"
 * eight kinds; "Only physical evidence may advance an assembled-product claim."; D23-13; OD-175).
 *
 * `physical-evidence.ts` defines the eight kinds as closed record types with validators. Every record binds the release (`releaseId`,
 * `archiveSha256`, board revision and digest), the unit or lot, the procedure, equipment and operator references, raw artifact digests
 * and a result. Review is a qualified human's, asked of a server port by the record's digest and never read from the record; no server
 * composition root wires that port. A record without raw artifacts, with a dry-run class, with any result but pass, or without a
 * server-derived human review never satisfies. The eligibility evaluator answers blocked, with the missing kinds, for every input. Nothing
 * creates a record: no route, store, tool or form (an AST check). The page `physical-evidence.md` is checked in case 9.
 * [B23-D review round, 2026-10-05] Cases 1-9 were strengthened and case 10 added for the adversarial review's findings (page section 9).
 * [B23-D low round, 2026-10-05] Cases 11-13 added, and pins in cases 1 and 6 moved in place, for the independent check's three low issues.
 * [B23-D low round 2, 2026-10-05] Cases 14 and 15 added, and case 13 retitled with two of its pins moved in place, for the second check's two.
 *
 * Files are read as text; nothing is written and nothing leaves the process.
 */
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { listRouteFiles } from "@/app/lib/auth/route-tree";
import { ACTION_COVERAGE_REGISTRY } from "@/app/lib/engineering/action-registry";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import {
  ASSEMBLED_BLOCK_REASONS,
  ASSEMBLED_CLAIM_REQUIRED_KINDS,
  ASSEMBLED_RELEASE_UNBLOCK_CONDITION,
  ASSEMBLY_DATA_AUTHORITY,
  assembledProductEligibility,
  judgePhysicalEvidenceRecord,
  PHYSICAL_EVIDENCE_DETAIL_KEYS,
  PHYSICAL_EVIDENCE_EXECUTION_CLASSES,
  PHYSICAL_EVIDENCE_KINDS,
  PHYSICAL_EVIDENCE_LIMITS,
  PHYSICAL_EVIDENCE_RECORD_KEYS,
  PHYSICAL_EVIDENCE_REJECTIONS,
  PHYSICAL_EVIDENCE_RESULTS,
  PHYSICAL_EVIDENCE_RETEST_KINDS,
  PHYSICAL_EVIDENCE_REVIEW_KEYS,
  PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING,
  PHYSICAL_EVIDENCE_REVIEWER_ROLES,
  PHYSICAL_EVIDENCE_RUNBOOK,
  PHYSICAL_EVIDENCE_SCHEMA,
  physicalEvidenceRecordDigest,
  validatePhysicalEvidenceRecord,
  type AssembledProductEligibility,
  type PhysicalEvidenceKind,
  type PhysicalEvidenceRecord,
  type PhysicalEvidenceRejection,
  type PhysicalEvidenceReviewPort,
  type PhysicalEvidenceReviewRequest,
} from "../physical-evidence";
import { completeSet, FAKE_LOT, FAKE_OPERATOR, FAKE_OPERATOR_ACTOR, FAKE_RELEASE, FAKE_REVIEWER, fakeRecord, fakeReviewPort, PERFORMED_AT, REVIEWED_AT } from "./_b23-d-evidence-fixture";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const lines = (path: string): string[] => read(path).split(NEWLINE);
const MODULE = "app/lib/manufacturing-providers/physical-evidence.ts";
const PAGE = "artifacts/ai-control-plane-b23/physical-evidence.md";
const RUNBOOK_ORDER = ["manufacturer_acceptance", "unit_lot_identity", "incoming_inspection", "continuity_power_on", "functional_test", "assembly_result", "deviation_rework", "final_physical_qualification"] as const;
const REQUIRED = RUNBOOK_ORDER.filter((kind) => kind !== "deviation_rework");
/** The six records the fixture's final physical qualification relies on. */
const SIX = ["pe-manufacturer_acceptance-1", "pe-unit_lot_identity-1", "pe-incoming_inspection-1", "pe-continuity_power_on-1", "pe-functional_test-1", "pe-assembly_result-1"];
/** One record judged with exactly the port given (undefined is the production default: no port is wired). */
const judge = (record: unknown, reviewPort: PhysicalEvidenceReviewPort | null | undefined) => judgePhysicalEvidenceRecord({ record, release: FAKE_RELEASE, lotId: FAKE_LOT, reviewPort });
/** One record judged with the fake server port (a server-derived human review of the exact digest). */
const reviewed = (record: unknown) => judge(record, fakeReviewPort());
/** The fixture's claim judged with a fresh fake server port. */
const claimOf = (records: readonly unknown[]): AssembledProductEligibility => assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records, reviewPort: fakeReviewPort() });
const verdictOf = (result: AssembledProductEligibility, recordId: string) => result.verdicts.find((item) => item.recordId === recordId);
/** An instant `minutes` after the fixture's work (negative: before it). */
const at = (minutes: number): string => new Date(Date.parse(PERFORMED_AT) + minutes * 60_000).toISOString();
const unit = (unitSerial: string) => ({ scope: "unit", lotId: FAKE_LOT, unitSerial });
/** [B23-D low round 2, 2026-10-05] The fake server port, answering no review for one record id (the others reviewed as by `fakeReviewPort`). */
const unreviewed = (recordId: string): PhysicalEvidenceReviewPort => {
  const port = fakeReviewPort();
  return (request: PhysicalEvidenceReviewRequest) => (request.recordId === recordId ? null : port(request));
};
const invalid = (record: unknown): readonly string[] => {
  const result = validatePhysicalEvidenceRecord(record);
  return result.ok ? [] : result.problems;
};
const yieldOnce = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));
/** Every production source (the import gates' whole-root walk), less any test or spec file. */
const production = (): FileMap => new Map([...collectProductionFiles(ROOT)].filter(([path]) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)));
/** The files with any AST module reference that resolves to `modulePath` (the import gates' resolution, case-insensitive as they detect),
 *  walked in chunks so the worker answers vitest's onTaskUpdate between them (one synchronous whole-tree parse can outrun it in CI). */
async function importersOf(files: FileMap, modulePath: string): Promise<string[]> {
  const target = modulePath.toLowerCase();
  const found: string[] = [];
  let count = 0;
  for (const [path, source] of files) {
    if (moduleReferences(path, source).some((reference) => { const resolved = resolveSpecifier(path, reference.specifier); return resolved.kind === "module" && resolved.module.toLowerCase() === target; })) found.push(path);
    count += 1;
    if (count % 200 === 0) await yieldOnce();
  }
  return found;
}

/** [B23-D review round, 2026-10-05] The one derived constant case 8 admits inside a freeze, reviewed: a filter of a frozen list of literals. */
const REVIEWED_FROZEN_DERIVATIONS = new Set(['PHYSICAL_EVIDENCE_KINDS.filter((kind) => kind !== "deviation_rework")']);
const WRITER_NAME = /^(?:create|record|store|save|persist|append|insert|commit|upsert|put|write|accept|ingest|submit|register|mint|issue)/i;
const parse = (fileName: string, source: string): ts.SourceFile => ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const strip = (node: ts.Expression): ts.Expression => {
  let current = node;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;
  return current;
};
/**
 * [B23-D review round, 2026-10-05] What a module holds at its top level that is not immutable data or code (tests-1): only imports, types,
 * function declarations and consts whose value is a primitive literal, an arrow function or a frozen literal tree pass - Object.freeze of
 * an array or object literal whose every member is a primitive literal or itself a frozen literal tree. A shallow freeze of a mutable
 * container (`Object.freeze({ held: [] })`), a frozen Map, a call, a `new`, a let, a class or an export list is reported.
 */
function topLevelState(fileName: string, source: string): string[] {
  const file = parse(fileName, source);
  const primitive = (node: ts.Expression): boolean => {
    const value = strip(node);
    return ts.isStringLiteralLike(value) || ts.isNumericLiteral(value) || ts.isRegularExpressionLiteral(value) || value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword || value.kind === ts.SyntaxKind.NullKeyword || (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)) || (ts.isBinaryExpression(value) && ts.isNumericLiteral(strip(value.left)) && ts.isNumericLiteral(strip(value.right)));
  };
  const frozenTree = (node: ts.Expression): boolean => {
    const value = strip(node);
    if (!ts.isCallExpression(value) || value.expression.getText(file) !== "Object.freeze" || value.arguments.length !== 1) return false;
    const argument = strip(value.arguments[0]!);
    if (REVIEWED_FROZEN_DERIVATIONS.has(argument.getText(file))) return true;
    if (ts.isArrayLiteralExpression(argument)) return argument.elements.every((element) => primitive(element) || frozenTree(element));
    if (ts.isObjectLiteralExpression(argument)) return argument.properties.every((property) => ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name) && (primitive(property.initializer) || frozenTree(property.initializer)));
    return false;
  };
  const found: string[] = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isFunctionDeclaration(statement)) continue;
    if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (!(init !== undefined && (primitive(init) || ts.isArrowFunction(strip(init)) || frozenTree(init)))) found.push(`${declaration.name.getText(file)}: ${init?.getText(file).slice(0, 60)}`);
      }
      continue;
    }
    found.push(`${ts.SyntaxKind[statement.kind]}: ${statement.getText(file).slice(0, 60)}`);
  }
  return found;
}
/** Every exported binding a module declares: its functions and its consts (an exported arrow function is a function too). */
function exportedNames(fileName: string, source: string): { functions: string[]; consts: string[] } {
  const file = parse(fileName, source);
  const exported = (statement: ts.Statement): boolean => ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  return {
    functions: file.statements.filter((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && exported(statement)).map((statement) => statement.name?.text ?? ""),
    consts: file.statements.filter((statement): statement is ts.VariableStatement => ts.isVariableStatement(statement) && exported(statement)).flatMap((statement) => statement.declarationList.declarations.map((declaration) => declaration.name.getText(file))),
  };
}

describe("[B23-D] the physical-evidence contract (D23-13; OD-175)", () => {
  it("1. the eight kinds, in the runbook's order and words; seven are required for an assembled-product claim and deviation/rework for each open nonconformance; the vocabularies are closed and frozen", () => {
    expect([...PHYSICAL_EVIDENCE_KINDS]).toEqual([...RUNBOOK_ORDER]);
    expect(Object.entries(PHYSICAL_EVIDENCE_RUNBOOK)).toEqual([
      ["manufacturer_acceptance", "manufacturer acceptance"],
      ["unit_lot_identity", "produced board lot/serial identity"],
      ["incoming_inspection", "incoming inspection"],
      ["continuity_power_on", "continuity/power-on tests"],
      ["functional_test", "functional test"],
      ["assembly_result", "assembly results"],
      ["deviation_rework", "deviations/rework"],
      ["final_physical_qualification", "final physical qualification"],
    ]);
    expect([...ASSEMBLED_CLAIM_REQUIRED_KINDS]).toEqual(REQUIRED);
    expect(PHYSICAL_EVIDENCE_SCHEMA).toBe("sirkit.physical-evidence.v1");
    expect([...PHYSICAL_EVIDENCE_RESULTS]).toEqual(["pass", "fail", "indeterminate", "invalid"]);
    expect([...PHYSICAL_EVIDENCE_EXECUTION_CLASSES]).toEqual(["hardware", "dry_run"]);
    expect([...PHYSICAL_EVIDENCE_RECORD_KEYS]).toEqual(["schema", "kind", "recordId", "release", "subject", "procedure", "equipmentRefs", "operatorRefs", "rawArtifacts", "executionClass", "result", "performedAt", "nonconformanceRefs", "details"]);
    expect(Object.keys(PHYSICAL_EVIDENCE_DETAIL_KEYS)).toEqual([...RUNBOOK_ORDER]);
    // [B23-D review round, 2026-10-05] pin moved: the server's answer names the actor ids the record's operators resolve to (security-1)
    expect([...PHYSICAL_EVIDENCE_REVIEW_KEYS]).toEqual(["derivation", "reviewerActorId", "operatorActorIds", "actorKind", "role", "qualificationRef", "reviewedRecordDigest", "reviewedAt"]);
    expect([...PHYSICAL_EVIDENCE_REVIEWER_ROLES]).toEqual(["project_admin"]);
    // [B23-D review round, 2026-10-05] a rework's retest is one of the physical tests (security-6)
    expect([...PHYSICAL_EVIDENCE_RETEST_KINDS]).toEqual(["incoming_inspection", "continuity_power_on", "functional_test"]);
    // [B23-D low round, 2026-10-05] pin moved: a record of a scrapped unit or lot no longer satisfies (low-3)
    expect([...PHYSICAL_EVIDENCE_REJECTIONS]).toEqual(["record_invalid", "duplicate_record_id", "release_mismatch", "subject_mismatch", "subject_scrapped", "raw_artifacts_absent", "dry_run_class", "result_not_pass", "waiver_disposition", "review_absent", "review_not_server_derived_human", "review_not_bound", "review_by_operator", "relies_on_unsatisfied"]);
    expect([...ASSEMBLED_BLOCK_REASONS]).toEqual(["assembly_data_authority_absent", "claim_invalid", "records_over_limit", "review_port_not_wired", "physical_evidence_missing"]);
    expect(ASSEMBLY_DATA_AUTHORITY).toBe("absent");
    expect(PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING).toBe("none");
    for (const value of [PHYSICAL_EVIDENCE_KINDS, PHYSICAL_EVIDENCE_RUNBOOK, ASSEMBLED_CLAIM_REQUIRED_KINDS, PHYSICAL_EVIDENCE_DETAIL_KEYS, PHYSICAL_EVIDENCE_LIMITS, PHYSICAL_EVIDENCE_REJECTIONS, ASSEMBLED_BLOCK_REASONS, PHYSICAL_EVIDENCE_RETEST_KINDS, PHYSICAL_EVIDENCE_REVIEW_KEYS]) expect(Object.isFrozen(value)).toBe(true);
    for (const kind of RUNBOOK_ORDER) expect(Object.isFrozen(PHYSICAL_EVIDENCE_DETAIL_KEYS[kind]), kind).toBe(true);
  });

  it("2. each kind's record binds the release (releaseId, archiveSha256, board revision and digest), the unit or lot, the procedure, equipment and operator references, raw artifact digests and a result: every key is required, every level is closed, and each binding's format is checked", () => {
    for (const kind of RUNBOOK_ORDER) {
      const valid = validatePhysicalEvidenceRecord(fakeRecord(kind));
      expect(valid.ok, `${kind} ${JSON.stringify(valid)}`).toBe(true);
      if (!valid.ok) continue;
      expect(valid.record.release).toEqual(FAKE_RELEASE);
      expect(valid.digest).toBe(physicalEvidenceRecordDigest(valid.record));
      expect(valid.digest).toMatch(/^physical-evidence-[0-9a-f]{64}$/);
      expect(Object.isFrozen(valid.record) && Object.isFrozen(valid.record.release) && Object.isFrozen(valid.record.details)).toBe(true);
      // every key is required ...
      for (const key of PHYSICAL_EVIDENCE_RECORD_KEYS) {
        const record = fakeRecord(kind);
        delete record[key];
        expect(invalid(record).some((problem) => problem.startsWith(`${key}:`)), `${kind} without ${key}`).toBe(true);
      }
      for (const key of ["releaseId", "archiveSha256", "boardRevision", "boardDigest"]) {
        const record = fakeRecord(kind);
        delete (record.release as Record<string, unknown>)[key];
        expect(invalid(record), `${kind} release without ${key}`).toContain(`release.${key}: required`);
      }
      for (const key of PHYSICAL_EVIDENCE_DETAIL_KEYS[kind]) {
        const record = fakeRecord(kind);
        delete (record.details as Record<string, unknown>)[key];
        expect(invalid(record), `${kind} details without ${key}`).toContain(`details.${key}: required`);
      }
      // ... and every level is closed
      for (const [where, mutate] of [
        ["", (record: Record<string, unknown>) => { record.extra = "x"; }],
        ["release.", (record: Record<string, unknown>) => { (record.release as Record<string, unknown>).extra = "x"; }],
        ["subject.", (record: Record<string, unknown>) => { (record.subject as Record<string, unknown>).extra = "x"; }],
        ["procedure.", (record: Record<string, unknown>) => { (record.procedure as Record<string, unknown>).extra = "x"; }],
        ["rawArtifacts[0].", (record: Record<string, unknown>) => { ((record.rawArtifacts as Array<Record<string, unknown>>)[0]!).extra = "x"; }],
        ["details.", (record: Record<string, unknown>) => { (record.details as Record<string, unknown>).extra = "x"; }],
      ] as const) {
        const record = fakeRecord(kind);
        mutate(record);
        expect(invalid(record), `${kind} ${where}extra`).toContain(`${where}extra: unknown key`);
      }
    }
    // the bindings' formats (one kind is enough: the common fields share one validator)
    const bad: Array<[string, (record: Record<string, unknown>) => void]> = [
      ["schema", (record) => { record.schema = "sirkit.physical-evidence.v0"; }],
      ["kind", (record) => { record.kind = "visual_check"; }],
      ["recordId", (record) => { record.recordId = "has space"; }],
      ["release.releaseId", (record) => { (record.release as Record<string, unknown>).releaseId = "mfg-release-123"; }],
      ["release.archiveSha256", (record) => { (record.release as Record<string, unknown>).archiveSha256 = "E".repeat(64); }],
      ["release.boardRevision", (record) => { (record.release as Record<string, unknown>).boardRevision = "pcb2-local"; }],
      ["release.boardDigest", (record) => { (record.release as Record<string, unknown>).boardDigest = `sha256:${"f".repeat(64)}`; }],
      ["subject.scope", (record) => { (record.subject as Record<string, unknown>).scope = "batch"; }],
      ["subject.lotId", (record) => { (record.subject as Record<string, unknown>).lotId = ""; }],
      ["subject.unitSerial", (record) => { (record.subject as Record<string, unknown>).unitSerial = "sn-1"; }],
      ["procedure.procedureDigest", (record) => { (record.procedure as Record<string, unknown>).procedureDigest = "a digest with spaces"; }],
      // [B23-D review round, 2026-10-05] a digest-named field binds a content digest, never a free reference (coverage-4)
      ["procedure.procedureDigest", (record) => { (record.procedure as Record<string, unknown>).procedureDigest = "TBD"; }],
      ["equipmentRefs", (record) => { record.equipmentRefs = []; }],
      ["operatorRefs", (record) => { record.operatorRefs = []; }],
      ["operatorRefs", (record) => { record.operatorRefs = ["Jane Doe"]; }],
      ["operatorRefs", (record) => { record.operatorRefs = ["person@example.com"]; }],
      // [B23-D review round, 2026-10-05] operators and equipment are typed references: bare words are refused, dotted or underscored too (coverage-6)
      ["operatorRefs", (record) => { record.operatorRefs = ["Jane.Doe"]; }],
      ["operatorRefs", (record) => { record.operatorRefs = ["Jane_Doe"]; }],
      ["equipmentRefs", (record) => { record.equipmentRefs = ["dmm-1"]; }],
      ["equipmentRefs", (record) => { record.equipmentRefs = ["equipment:a", "equipment:a"]; }],
      ["rawArtifacts[0].sha256", (record) => { (record.rawArtifacts as Array<Record<string, unknown>>)[0]!.sha256 = "0".repeat(63); }],
      ["rawArtifacts[0].bytes", (record) => { (record.rawArtifacts as Array<Record<string, unknown>>)[0]!.bytes = -1; }],
      ["executionClass", (record) => { record.executionClass = "simulated"; }],
      ["result", (record) => { record.result = "passed"; }],
      ["performedAt", (record) => { record.performedAt = "2026-10-05 12:00"; }],
      ["nonconformanceRefs", (record) => { record.nonconformanceRefs = "ncr:1"; }],
    ];
    for (const [path, mutate] of bad) {
      const record = fakeRecord("incoming_inspection");
      mutate(record);
      expect(invalid(record).some((problem) => problem.startsWith(`${path}:`)), `${path}: ${JSON.stringify(invalid(record))}`).toBe(true);
    }
    // a unit record names its serial; a lot record names none
    expect(invalid(fakeRecord("functional_test", { subject: { scope: "unit", lotId: FAKE_LOT, unitSerial: null } }))).toContain("subject.unitSerial: a unit record names its serial");
    // per-kind rules
    // [B23-D review round, 2026-10-05] pin moved: an outbound package digest is no longer accepted (nothing here binds it to this release), and an
    // acceptance is the manufacturer's own reference, never one of Sirkit's minted ids (a provider observation, an exchange, a package) (security-3)
    const acceptance = (details: Record<string, unknown>) => fakeRecord("manufacturer_acceptance", { details: { manufacturerRef: "manufacturer:x", acceptanceRef: "acceptance:x", acceptedFilesDigest: FAKE_RELEASE.archiveSha256, ...details } });
    expect(validatePhysicalEvidenceRecord(acceptance({})).ok).toBe(true);
    for (const digest of ["a".repeat(64), `mfg-outbound-${"a".repeat(64)}`]) expect(invalid(acceptance({ acceptedFilesDigest: digest })), digest).toContain("details.acceptedFilesDigest: the release's archiveSha256");
    for (const ref of [`mfg-observation-${"a".repeat(64)}`, `mfg-provider-exchange:${"a".repeat(32)}`, `mfg-outbound-${"a".repeat(64)}`, `mfg-release-${"d".repeat(32)}`]) {
      expect(invalid(acceptance({ acceptanceRef: ref })), ref).toContain("details.acceptanceRef: the manufacturer's own reference, never a Sirkit id (mfg-...)");
      expect(invalid(acceptance({ manufacturerRef: ref })), ref).toContain("details.manufacturerRef: the manufacturer's own reference, never a Sirkit id (mfg-...)");
    }
    expect(invalid(fakeRecord("unit_lot_identity", { details: { lotQuantity: 1, unitSerials: ["sn-1", "sn-2"] } }))).toContain("details.unitSerials: more serials than the lot holds");
    expect(invalid(fakeRecord("incoming_inspection", { details: { inspectedQuantity: 2, nonconformingQuantity: 3, acceptanceCriteriaRef: "criteria:x" } }))).toContain("details.nonconformingQuantity: a whole number from 0 to inspectedQuantity");
    expect(invalid(fakeRecord("incoming_inspection", { details: { inspectedQuantity: 2, nonconformingQuantity: 1, acceptanceCriteriaRef: "criteria:x" } }))).toContain("nonconformanceRefs: a nonconforming quantity names its nonconformances");
    expect(invalid(fakeRecord("continuity_power_on", { details: { checks: ["isolation"] } }))).toContain("details.checks: continuity and power_on are both required");
    // [B23-D review round, 2026-10-05] the digest-named details are content digests (coverage-4)
    expect(invalid(fakeRecord("functional_test", { details: { testDefinitionRef: "test:x", testDefinitionDigest: "pending" } }))).toContain("details.testDefinitionDigest: sha256:<64 hex>");
    expect(invalid(fakeRecord("assembly_result", { details: { assemblyDataDigest: "none", populationVariantRef: "variant:x" } }))).toContain("details.assemblyDataDigest: sha256:<64 hex>");
    expect(invalid(fakeRecord("assembly_result", { procedure: { procedureRef: "procedure:x", procedureRevision: "rev-1", procedureDigest: "TBD" } }))).toContain("procedure.procedureDigest: sha256:<64 hex>");
    expect(invalid(fakeRecord("final_physical_qualification", { details: { qualificationPlanRef: "plan:x", reliesOnRecordIds: [] } }))).toContain("details.reliesOnRecordIds: 1 to 64 distinct record ids");
    expect(invalid(fakeRecord("final_physical_qualification", { details: { qualificationPlanRef: "plan:x", reliesOnRecordIds: ["pe-final_physical_qualification-1"] } }))).toContain("details.reliesOnRecordIds: a record cannot rely on itself");
    for (const value of [null, undefined, "record", 42, [], [fakeRecord("functional_test")]]) expect(validatePhysicalEvidenceRecord(value).ok, String(value)).toBe(false);
    // what is checked is what is returned: the input is read once, as data (a getter answers once; a proxy or a function is no data)
    let reads = 0;
    const shifting = fakeRecord("functional_test");
    Object.defineProperty(shifting, "result", { enumerable: true, get: () => { reads += 1; return reads === 1 ? "pass" : "fail"; } });
    const once = validatePhysicalEvidenceRecord(shifting);
    expect(reads).toBe(1);
    expect(once.ok && once.record.result).toBe("pass");
    expect(once.ok && once.digest).toBe(physicalEvidenceRecordDigest({ ...(once.ok ? once.record : ({} as PhysicalEvidenceRecord)) }));
    expect(invalid(new Proxy(fakeRecord("functional_test"), {}))).toEqual(["record: plain data"]);
    expect(invalid({ ...fakeRecord("functional_test"), details: { testDefinitionRef: "test:x", testDefinitionDigest: () => "sha256:x" } })).toEqual(["record: plain data"]);
    // [B23-D review round, 2026-10-05] the module says what its reference check does, no more (coverage-6)
    expect(read(MODULE)).not.toContain("never prose, names or addresses");
    expect(read(MODULE)).not.toContain("never prose, a person's name or an address");
  });

  it("3. review is derived from the trusted server context, never from the record: a record carrying any review, approval, signature or attestation is invalid; the port is asked only by record id, kind and digest; a review beside the records is just an invalid record", () => {
    for (const key of ["review", "reviewedBy", "approvedBy", "approval", "reviewerActorId", "signature", "signedBy", "attestation", "verifiedBy"]) {
      const record = fakeRecord("functional_test", { [key]: { reviewerActorId: FAKE_REVIEWER, actorKind: "human" } });
      expect(invalid(record), key).toContain(`${key}: a record never carries its own review; review is derived from the server context`);
      const details = fakeRecord("functional_test");
      (details.details as Record<string, unknown>)[key] = "yes";
      expect(invalid(details), `details.${key}`).toContain(`details.${key}: a record never carries its own review; review is derived from the server context`);
    }
    const port = fakeReviewPort();
    const verdict = judge(fakeRecord("functional_test"), port);
    expect(verdict.satisfies).toBe(true);
    expect(port.calls).toHaveLength(1);
    const valid = validatePhysicalEvidenceRecord(fakeRecord("functional_test"));
    expect(valid.ok).toBe(true);
    expect(port.calls[0]).toEqual({ recordId: "pe-functional_test-1", kind: "functional_test", recordDigest: valid.ok ? valid.digest : "" });
    expect(Object.isFrozen(port.calls[0])).toBe(true);
    // an invalid record is never put to the port
    const asked = fakeReviewPort();
    expect(judge({ ...fakeRecord("functional_test"), review: { actorKind: "human" } }, asked).rejections).toEqual(["record_invalid"]);
    expect(asked.calls).toHaveLength(0);
    // a review object handed in with the records is judged as a record (invalid), never as the review of its neighbour
    // [B23-D review round, 2026-10-05] pin moved: the neighbour is a lot record (a unit record alone has no lot identity to name it, case 10)
    const neighbour = validatePhysicalEvidenceRecord(fakeRecord("assembly_result"));
    const review = { derivation: "server_session", reviewerActorId: FAKE_REVIEWER, operatorActorIds: [FAKE_OPERATOR_ACTOR], actorKind: "human", role: "project_admin", qualificationRef: "qualification:x", reviewedRecordDigest: neighbour.ok ? neighbour.digest : "", reviewedAt: PERFORMED_AT };
    const result = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [fakeRecord("assembly_result"), review] });
    expect(result.verdicts.map((item) => item.rejections)).toEqual([["review_absent"], ["record_invalid"]]);
  });

  it("4. none of these ever satisfies, for every kind: a record without raw artifacts, with a dry-run class, with any result but pass, or without a server-derived human review - each named, while the otherwise identical record satisfies", () => {
    for (const kind of RUNBOOK_ORDER) {
      expect(reviewed(fakeRecord(kind)), kind).toMatchObject({ satisfies: true, rejections: [], kind, recordId: `pe-${kind}-1` });
      expect(reviewed(fakeRecord(kind, { rawArtifacts: [] })), `${kind} raw`).toMatchObject({ satisfies: false, rejections: ["raw_artifacts_absent"] });
      expect(reviewed(fakeRecord(kind, { executionClass: "dry_run" })), `${kind} dry run`).toMatchObject({ satisfies: false, rejections: ["dry_run_class"] });
      for (const result of ["fail", "indeterminate", "invalid"]) expect(reviewed(fakeRecord(kind, { result })), `${kind} ${result}`).toMatchObject({ satisfies: false, rejections: ["result_not_pass"] });
      expect(judge(fakeRecord(kind), null), `${kind} no port`).toMatchObject({ satisfies: false, rejections: ["review_absent"] });
      expect(judge(fakeRecord(kind), undefined), `${kind} default port`).toMatchObject({ satisfies: false, rejections: ["review_absent"] });
      const silent = Object.assign(() => null, { calls: [] });
      expect(judge(fakeRecord(kind), silent), `${kind} port answers nothing`).toMatchObject({ satisfies: false, rejections: ["review_absent"] });
      const throwing = Object.assign(() => { throw new Error("port down"); }, { calls: [] });
      expect(judge(fakeRecord(kind), throwing), `${kind} port throws`).toMatchObject({ satisfies: false, rejections: ["review_absent"] });
      // all four at once are each named, in the closed order
      expect(judge(fakeRecord(kind, { rawArtifacts: [], executionClass: "dry_run", result: "fail" }), null).rejections, kind).toEqual(["raw_artifacts_absent", "dry_run_class", "result_not_pass", "review_absent"]);
    }
    // the release and the lot bind: any one of the four release fields, or another lot, and the record does not count
    for (const key of ["releaseId", "archiveSha256", "boardRevision", "boardDigest"] as const) {
      const other = { ...FAKE_RELEASE, [key]: key === "releaseId" ? `mfg-release-${"c".repeat(32)}` : key === "archiveSha256" ? "c".repeat(64) : key === "boardRevision" ? "pcb2-fedcba9876543210" : `pcb-authority-${"c".repeat(64)}` };
      expect(reviewed(fakeRecord("functional_test", { release: other })).rejections, key).toEqual(["release_mismatch"]);
    }
    expect(reviewed(fakeRecord("functional_test", { subject: { scope: "unit", lotId: "lot-other", unitSerial: "sn-0001" } })).rejections).toEqual(["subject_mismatch"]);
  });

  it("5. the review must be a qualified human's, server-derived, bound to the exact record digest, after the work, and never by one of the record's operators as the server resolves them: each failure is named", () => {
    const cases: Array<[string, (answer: Record<string, unknown>) => void, string]> = [
      ["the model", (answer) => { answer.actorKind = "ai"; }, "review_not_server_derived_human"],
      ["automation", (answer) => { answer.actorKind = "automation"; }, "review_not_server_derived_human"],
      ["the migration actor", (answer) => { answer.actorKind = "system_migration"; }, "review_not_server_derived_human"],
      ["an editor", (answer) => { answer.role = "pcb_editor"; }, "review_not_server_derived_human"],
      ["a viewer", (answer) => { answer.role = "viewer"; }, "review_not_server_derived_human"],
      ["a body claim", (answer) => { answer.derivation = "request_body"; }, "review_not_server_derived_human"],
      ["browser state", (answer) => { answer.derivation = "browser_state"; }, "review_not_server_derived_human"],
      ["no qualification", (answer) => { answer.qualificationRef = ""; }, "review_not_server_derived_human"],
      ["no reviewer", (answer) => { answer.reviewerActorId = ""; }, "review_not_server_derived_human"],
      ["an extra key", (answer) => { answer.comment = "looks fine"; }, "review_not_server_derived_human"],
      ["a missing key", (answer) => { delete answer.reviewedAt; }, "review_not_server_derived_human"],
      ["a malformed instant", (answer) => { answer.reviewedAt = "today"; }, "review_not_server_derived_human"],
      ["another record's digest", (answer) => { answer.reviewedRecordDigest = `physical-evidence-${"0".repeat(64)}`; }, "review_not_bound"],
      ["a review before the work", (answer) => { answer.reviewedAt = "2026-10-05T11:59:59.999Z"; }, "review_not_bound"],
      ["the operator reviewing their own work", (answer) => { answer.reviewerActorId = FAKE_OPERATOR; }, "review_by_operator"],
      // [B23-D review round, 2026-10-05] the separation is the server's to prove: its answer names the actor ids the record's operators resolve
      // to, one per operator, and the reviewer is none of them (security-1, coverage-5)
      ["the operators unresolved by the server", (answer) => { delete answer.operatorActorIds; }, "review_not_server_derived_human"],
      ["an operator left unresolved", (answer) => { answer.operatorActorIds = []; }, "review_not_server_derived_human"],
      ["an operator resolved twice", (answer) => { answer.operatorActorIds = [FAKE_OPERATOR_ACTOR, "user-fake-operator-2"]; }, "review_not_server_derived_human"],
      ["an operator resolved to no actor id", (answer) => { answer.operatorActorIds = ["not an id"]; }, "review_not_server_derived_human"],
      ["the operator reviewing their own work, by the actor id the server resolves", (answer) => { answer.reviewerActorId = FAKE_OPERATOR_ACTOR; }, "review_by_operator"],
    ];
    for (const [label, change, rejection] of cases) {
      const base = fakeReviewPort();
      const port = Object.assign((request: Parameters<typeof base>[0]) => { const answer = { ...(base(request) as Record<string, unknown>) }; change(answer); return answer; }, { calls: [] });
      expect(judge(fakeRecord("assembly_result"), port).rejections, label).toEqual([rejection]);
      expect(judge(fakeRecord("assembly_result"), fakeReviewPort()).rejections, `${label}: the unchanged answer satisfies`).toEqual([]);
    }
    // [B23-D review round, 2026-10-05] the same human in two namespaces (security-1): the record names an operator reference, the session a user
    // id, and only the server can say they are one person
    const sameHuman = (operatorActorIds: readonly string[] | undefined) => (request: PhysicalEvidenceReviewRequest): unknown => ({ derivation: "server_session", reviewerActorId: "user-2b1c", ...(operatorActorIds === undefined ? {} : { operatorActorIds }), actorKind: "human", role: "project_admin", qualificationRef: "qualification:fake-workmanship", reviewedRecordDigest: request.recordDigest, reviewedAt: REVIEWED_AT });
    const bench = fakeRecord("assembly_result", { operatorRefs: ["operator:bench-7"] });
    expect(judge(bench, sameHuman(undefined)).satisfies, "an answer that does not resolve the operators proves no separation").toBe(false);
    expect(judge(bench, sameHuman(["user-2b1c"])).rejections).toEqual(["review_by_operator"]);
    expect(judge(bench, sameHuman(["user-9f00"])).rejections).toEqual([]);
    for (const answer of ["approved", true, 1, [], null]) expect(judge(fakeRecord("assembly_result"), Object.assign(() => answer, { calls: [] })).rejections, JSON.stringify(answer)).toEqual([answer === null ? "review_absent" : "review_not_server_derived_human"]);
    // the answer is read once, as data: a getter cannot show a human to the check and the model to anything after it
    let reads = 0;
    const shiftingPort = (request: Parameters<PhysicalEvidenceReviewPort>[0]): unknown => {
      const answer = { ...(fakeReviewPort()(request) as Record<string, unknown>) };
      Object.defineProperty(answer, "actorKind", { enumerable: true, get: () => { reads += 1; return reads === 1 ? "human" : "ai"; } });
      return answer;
    };
    expect(judge(fakeRecord("assembly_result"), shiftingPort).rejections).toEqual([]);
    expect(reads).toBe(1);
    expect(judge(fakeRecord("assembly_result"), () => new Proxy({ ...(fakeReviewPort()({ recordId: "x", kind: "assembly_result", recordDigest: "x" }) as object) }, {})).rejections).toEqual(["review_not_server_derived_human"]);
    // a review binds the exact record: one field changed after review, and the earlier review no longer counts
    const reviewed = validatePhysicalEvidenceRecord(fakeRecord("functional_test"));
    expect(reviewed.ok).toBe(true);
    const stale = fakeReviewPort({ reviewedRecordDigest: reviewed.ok ? reviewed.digest : "" });
    expect(judge(fakeRecord("functional_test"), stale).satisfies).toBe(true);
    for (const changed of [{ result: "pass", performedAt: "2026-10-05T12:00:00.001Z" }, { equipmentRefs: ["equipment:fake-dmm-2"] }, { rawArtifacts: [{ artifactRef: "raw:functional_test:1", sha256: "3".repeat(64), bytes: 1024 }] }]) {
      expect(judge(fakeRecord("functional_test", changed), stale).rejections, JSON.stringify(changed)).toEqual(["review_not_bound"]);
    }
  });

  it("6. a waiver never satisfies; deviation/rework closes a nonconformance only by a reviewed rework, repair or scrap of the subject that raised it, whose retests are physical tests of that subject after the rework; a failure of the claim is never outvoted by a pass; final physical qualification relies only on satisfying records and comes after every failure and rework; duplicate record ids count for nothing", () => {
    const port = fakeReviewPort();
    const withNcr = (): Array<Record<string, unknown>> => completeSet().map((record) => (record.kind === "incoming_inspection" ? { ...record, nonconformanceRefs: ["ncr:fake-1"], details: { inspectedQuantity: 5, nonconformingQuantity: 1, acceptanceCriteriaRef: "criteria:fake-class-2" } } : record));
    // an open nonconformance makes deviation/rework required
    const open = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: withNcr(), reviewPort: port });
    expect(open.missing).toEqual(["deviation_rework"]);
    expect(open.openNonconformances).toEqual(["ncr:fake-1"]);
    // a use-as-is disposition is a waiver: it never satisfies and the nonconformance stays open
    const waived = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [...withNcr(), fakeRecord("deviation_rework", { details: { nonconformanceRef: "ncr:fake-1", disposition: "use_as_is", instructionRef: "instruction:x", retestRecordIds: [] } })], reviewPort: port });
    expect(waived.verdicts.at(-1)).toMatchObject({ satisfies: false, rejections: ["waiver_disposition"] });
    expect(waived.missing).toEqual(["deviation_rework"]);
    // a reviewed rework of the lot whose retest of the lot satisfies closes it
    const reworked = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [...withNcr(), fakeRecord("deviation_rework")], reviewPort: port });
    expect(reworked.verdicts.at(-1)).toMatchObject({ satisfies: true, rejections: [] });
    expect(reworked.missing).toEqual([]);
    expect(reworked.openNonconformances).toEqual([]);
    // a rework whose retest is absent, unknown or does not satisfy closes nothing
    for (const retestRecordIds of [[], ["pe-unknown-1"]]) {
      const result = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [...withNcr(), fakeRecord("deviation_rework", { details: { nonconformanceRef: "ncr:fake-1", disposition: "repair", instructionRef: "instruction:x", retestRecordIds } })], reviewPort: port });
      expect(result.verdicts.at(-1)?.rejections, JSON.stringify(retestRecordIds)).toEqual(["relies_on_unsatisfied"]);
      expect(result.missing).toEqual(["deviation_rework"]);
    }
    // [B23-D review round, 2026-10-05] pins moved: the fixture's rework is retested by the lot's continuity/power-on test (security-6)
    const failedRetest = withNcr().map((record) => (record.kind === "continuity_power_on" ? { ...record, result: "fail" } : record));
    const notRetested = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [...failedRetest, fakeRecord("deviation_rework")], reviewPort: port });
    expect(notRetested.verdicts.at(-1)?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(notRetested.missing).toEqual(["continuity_power_on", "deviation_rework", "final_physical_qualification"] satisfies PhysicalEvidenceKind[]);
    // a retest performed before the rework it checks does not count
    const earlyRetest = withNcr().map((record) => (record.kind === "continuity_power_on" ? { ...record, performedAt: "2026-10-05T11:00:00.000Z" } : record));
    const reworkedLate = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [...earlyRetest, fakeRecord("deviation_rework")], reviewPort: port });
    expect(reworkedLate.verdicts.find((item) => item.kind === "continuity_power_on")?.satisfies).toBe(true);
    expect(reworkedLate.verdicts.at(-1)?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(reworkedLate.missing).toEqual(["deviation_rework"]);
    // scrap closes the nonconformance by removing its subject, here the lot (no retest)
    // [B23-D low round, 2026-10-05] pin moved (low-3): the scrapped lot's other records no longer satisfy, so every required kind is missing
    const scrapped = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [...withNcr(), fakeRecord("deviation_rework", { details: { nonconformanceRef: "ncr:fake-1", disposition: "scrap", instructionRef: "instruction:x", retestRecordIds: [] } })], reviewPort: port });
    expect(scrapped).toMatchObject({ openNonconformances: [], missing: REQUIRED });
    // final qualification relies only on satisfying records of this evaluation
    const reliesOnDryRun = completeSet().map((record) => (record.kind === "continuity_power_on" ? { ...record, executionClass: "dry_run" } : record));
    const final = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: reliesOnDryRun, reviewPort: port });
    expect(final.verdicts.find((item) => item.kind === "final_physical_qualification")?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(final.missing).toEqual(["continuity_power_on", "final_physical_qualification"]);
    // ... and on records performed no later than itself
    const qualifiedEarly = completeSet().map((record) => (record.kind === "final_physical_qualification" ? { ...record, performedAt: "2026-10-05T11:59:59.999Z" } : record));
    const early = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: qualifiedEarly, reviewPort: port });
    expect(early.verdicts.find((item) => item.kind === "final_physical_qualification")?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(early.missing).toEqual(["final_physical_qualification"]);
    // two records with one id are both void
    const twice = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [...completeSet(), fakeRecord("functional_test")], reviewPort: port });
    expect(twice.verdicts.filter((item) => item.recordId === "pe-functional_test-1").map((item) => item.rejections)).toEqual([["duplicate_record_id"], ["duplicate_record_id"]]);
    expect(twice.missing).toEqual(["functional_test", "final_physical_qualification"]);

    // [B23-D review round, 2026-10-05] which nonconformance a rework closes (tests-2): only the one it names, raised by a record of this claim
    const twoOpen = completeSet().map((record) => (record.kind === "incoming_inspection" ? { ...record, nonconformanceRefs: ["ncr:fake-1", "ncr:fake-2"], details: { inspectedQuantity: 5, nonconformingQuantity: 2, acceptanceCriteriaRef: "criteria:fake-class-2" } } : record));
    const oneClosed = claimOf([...twoOpen, fakeRecord("deviation_rework")]);
    expect(oneClosed.verdicts.at(-1)?.satisfies).toBe(true);
    expect(oneClosed).toMatchObject({ openNonconformances: ["ncr:fake-2"], missing: ["deviation_rework"] });
    const unrelated = claimOf([...withNcr(), fakeRecord("deviation_rework", { recordId: "pe-deviation_rework-9", details: { nonconformanceRef: "ncr:other", disposition: "rework", instructionRef: "instruction:x", retestRecordIds: ["pe-continuity_power_on-1"] } })]);
    expect(unrelated.verdicts.at(-1)?.satisfies).toBe(true);
    expect(unrelated).toMatchObject({ openNonconformances: ["ncr:fake-1"], missing: ["deviation_rework"] });
    // records outside the claim raise nothing: another release, another lot
    // [B23-D low round, 2026-10-05] pin moved (low-1): a voided duplicate id no longer puts a record outside the claim, so it raises what it names
    const outsiders = [
      fakeRecord("assembly_result", { recordId: "pe-foreign-release-1", release: { ...FAKE_RELEASE, releaseId: `mfg-release-${"c".repeat(32)}` }, nonconformanceRefs: ["ncr:foreign-release"] }),
      fakeRecord("assembly_result", { recordId: "pe-foreign-lot-1", subject: { scope: "lot", lotId: "lot-other", unitSerial: null }, nonconformanceRefs: ["ncr:foreign-lot"] }),
    ];
    const foreign = claimOf([
      ...completeSet(),
      ...outsiders,
      fakeRecord("assembly_result", { recordId: "pe-duplicate-1", nonconformanceRefs: ["ncr:duplicate"] }),
      fakeRecord("assembly_result", { recordId: "pe-duplicate-1", nonconformanceRefs: ["ncr:duplicate"] }),
    ]);
    expect(foreign.verdicts.slice(-4).map((item) => item.rejections)).toEqual([["release_mismatch"], ["subject_mismatch"], ["duplicate_record_id"], ["duplicate_record_id"]]);
    expect(foreign).toMatchObject({ openNonconformances: ["ncr:duplicate"], missing: ["deviation_rework"] });
    expect(claimOf([...completeSet(), ...outsiders])).toMatchObject({ openNonconformances: [], missing: [] });
    // final physical qualification may rely on a satisfying rework, never on one that does not satisfy
    const finalOnRework = (reworkOverrides: Record<string, unknown>) => [...withNcr().filter((record) => record.kind !== "final_physical_qualification"), fakeRecord("deviation_rework", reworkOverrides), fakeRecord("final_physical_qualification", { details: { qualificationPlanRef: "plan:fake-final", reliesOnRecordIds: [...SIX, "pe-deviation_rework-1"] } })];
    const reliesOnRework = claimOf(finalOnRework({}));
    expect(reliesOnRework.verdicts.at(-1)).toMatchObject({ satisfies: true, rejections: [] });
    expect(reliesOnRework.missing).toEqual([]);
    const reliesOnDryRework = claimOf(finalOnRework({ executionClass: "dry_run" }));
    expect(reliesOnDryRework.verdicts.at(-1)?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(reliesOnDryRework.missing).toEqual(["deviation_rework", "final_physical_qualification"]);

    // [B23-D review round, 2026-10-05] a failure of the claim is never outvoted by a pass (security-2, coverage-1): a hardware record whose
    // result is not pass raises the nonconformances it names, or itself when it names none, in either order, for this unit or another
    const failure = (overrides: Record<string, unknown>) => fakeRecord("functional_test", { recordId: "pe-functional_test-2", result: "fail", performedAt: at(-60), ...overrides });
    const failures: Array<[string, Record<string, unknown>, string[], PhysicalEvidenceKind[]]> = [
      ["the same unit failing before its pass (tested until it passed)", failure({}), ["pe-functional_test-2"], ["deviation_rework"]],
      ["the same unit failing after its pass", failure({ performedAt: at(30) }), ["pe-functional_test-2"], ["deviation_rework", "final_physical_qualification"]],
      ["an indeterminate result after the pass", failure({ result: "indeterminate", performedAt: at(30) }), ["pe-functional_test-2"], ["deviation_rework", "final_physical_qualification"]],
      ["an invalid result after the pass", failure({ result: "invalid", performedAt: at(30) }), ["pe-functional_test-2"], ["deviation_rework", "final_physical_qualification"]],
      ["another unit of the lot failing", failure({ subject: unit("sn-0002") }), ["pe-functional_test-2"], ["deviation_rework"]],
      ["a failure without raw artifacts", failure({ rawArtifacts: [] }), ["pe-functional_test-2"], ["deviation_rework"]],
      ["a failure that names its nonconformance", failure({ nonconformanceRefs: ["ncr:fake-9"] }), ["ncr:fake-9"], ["deviation_rework"]],
      ["the lot failing continuity/power-on", fakeRecord("continuity_power_on", { recordId: "pe-continuity_power_on-2", result: "fail", performedAt: at(-60) }), ["pe-continuity_power_on-2"], ["deviation_rework"]],
    ];
    for (const [label, record, raised, missing] of failures) {
      const result = claimOf([...completeSet(), record]);
      expect(result.verdicts.at(-1)?.satisfies, label).toBe(false);
      expect(result.openNonconformances, label).toEqual(raised);
      expect(result.missing, label).toEqual(missing);
    }
    // a dry run is no physical event: its failure raises nothing
    expect(claimOf([...completeSet(), failure({ executionClass: "dry_run" })])).toMatchObject({ openNonconformances: [], missing: [] });
    // a failure is closed by a reviewed repair of the failed unit, retested after it by a physical test of that unit
    const repair = (overrides: Record<string, unknown>, details: Record<string, unknown> = {}) => fakeRecord("deviation_rework", { recordId: "pe-deviation_rework-2", subject: unit("sn-0001"), performedAt: at(-30), ...overrides, details: { nonconformanceRef: "pe-functional_test-2", disposition: "repair", instructionRef: "instruction:fake-repair-1", retestRecordIds: ["pe-functional_test-1"], ...details } });
    const repaired = claimOf([...completeSet(), failure({}), repair({})]);
    expect(repaired.verdicts.at(-1)).toMatchObject({ satisfies: true, rejections: [] });
    expect(repaired).toMatchObject({ openNonconformances: [], missing: [] });

    // [B23-D review round, 2026-10-05] a retest is a physical test of the reworked subject, and the rework acts on the subject that raised the
    // nonconformance (security-6, coverage-2): never another unit, another kind, or the record that raised it
    const unitClosures: Array<[string, Record<string, unknown>, Record<string, unknown>, Array<Record<string, unknown>>]> = [
      ["a repair of another unit", { subject: unit("sn-0002") }, {}, []],
      ["a scrap of another unit", { subject: unit("sn-0002") }, { disposition: "scrap", retestRecordIds: [] }, []],
      ["a retest of another unit", {}, { retestRecordIds: ["pe-functional_test-4"] }, [fakeRecord("functional_test", { recordId: "pe-functional_test-4", subject: unit("sn-0002") })]],
      ["a lot/serial identity record as the retest", {}, { retestRecordIds: ["pe-unit_lot_identity-1"] }, []],
      ["an assembly result as the retest", {}, { retestRecordIds: ["pe-assembly_result-1"] }, []],
      ["the failure itself as the retest", {}, { retestRecordIds: ["pe-functional_test-2"] }, []],
    ];
    for (const [label, overrides, details, extra] of unitClosures) {
      const result = claimOf([...completeSet(), failure({}), ...extra, repair(overrides, details)]);
      expect(result.verdicts.at(-1)?.rejections, label).toEqual(["relies_on_unsatisfied"]);
      expect(result.openNonconformances, label).toEqual(["pe-functional_test-2"]);
      expect(result.missing, label).toEqual(["deviation_rework"]);
    }
    for (const [label, retestRecordIds] of [["a lot/serial identity record", ["pe-unit_lot_identity-1"]], ["a manufacturer acceptance", ["pe-manufacturer_acceptance-1"]], ["the inspection that raised it", ["pe-incoming_inspection-1"]], ["one unit's functional test for the lot's rework", ["pe-functional_test-1"]]] as const) {
      const result = claimOf([...withNcr(), fakeRecord("deviation_rework", { details: { nonconformanceRef: "ncr:fake-1", disposition: "rework", instructionRef: "instruction:x", retestRecordIds: [...retestRecordIds] } })]);
      expect(result.verdicts.at(-1)?.rejections, label).toEqual(["relies_on_unsatisfied"]);
      expect(result.missing, label).toEqual(["deviation_rework"]);
    }
    // [B23-D review round, 2026-10-05] a failure after the final qualification leaves it stale: a new one, after the repair and its retest, is needed
    const lateRepair = repair({ performedAt: at(40) }, { retestRecordIds: ["pe-functional_test-3"] });
    const retest = fakeRecord("functional_test", { recordId: "pe-functional_test-3", performedAt: at(50) });
    const requalified = fakeRecord("final_physical_qualification", { recordId: "pe-final_physical_qualification-2", performedAt: at(55), details: { qualificationPlanRef: "plan:fake-final", reliesOnRecordIds: [...SIX.filter((id) => id !== "pe-functional_test-1"), "pe-functional_test-3", "pe-deviation_rework-2"] } });
    const stale = claimOf([...completeSet(), failure({ performedAt: at(30) }), lateRepair, retest]);
    expect(verdictOf(stale, "pe-deviation_rework-2")?.satisfies).toBe(true);
    expect(verdictOf(stale, "pe-final_physical_qualification-1")?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(stale).toMatchObject({ openNonconformances: [], missing: ["final_physical_qualification"] });
    expect(claimOf([...completeSet(), failure({ performedAt: at(30) }), lateRepair, retest, requalified])).toMatchObject({ openNonconformances: [], missing: [] });
  });

  it("7. the eligibility evaluator answers blocked, with the missing kinds, for every input today: with no review port wired, with the complete satisfying set and a fake server port, and for every malformed claim or record, each read once as data", () => {
    const blockedTypeOnly: AssembledProductEligibility["eligible"] = false; // the type admits no other answer
    expect(blockedTypeOnly).toBe(false);
    const nothing = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [] });
    expect(nothing).toEqual({ eligible: false, status: "blocked", reasons: ["assembly_data_authority_absent", "review_port_not_wired", "physical_evidence_missing"], missing: REQUIRED, openNonconformances: [], verdicts: [], unblockCondition: ASSEMBLED_RELEASE_UNBLOCK_CONDITION });
    expect(Object.isFrozen(nothing) && Object.isFrozen(nothing.missing) && Object.isFrozen(nothing.reasons)).toBe(true);
    // today (no port): even the complete set satisfies nothing
    const today = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: completeSet() });
    expect(today).toMatchObject({ eligible: false, reasons: ["assembly_data_authority_absent", "review_port_not_wired", "physical_evidence_missing"], missing: REQUIRED });
    expect(today.verdicts.every((item) => item.rejections.includes("review_absent"))).toBe(true);
    // with a fake server port and every kind satisfied, still blocked: the assembly-data authority does not exist
    const port = fakeReviewPort();
    const complete = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: completeSet(), reviewPort: port });
    expect(complete).toMatchObject({ eligible: false, status: "blocked", reasons: ["assembly_data_authority_absent"], missing: [], openNonconformances: [] });
    expect(complete.verdicts.every((item) => item.satisfies)).toBe(true);
    for (const condition of ["MPN", "population variant", "BOM", "placement", "paste", "physical evidence", "qualified human review", "OD-175"]) expect(ASSEMBLED_RELEASE_UNBLOCK_CONDITION, condition).toContain(condition);
    // malformed claims and inputs
    const thrower = (): never => { throw new Error("trap"); };
    const malformed: Array<[string, unknown]> = [
      ["no input", undefined], ["null", null], ["a string", "release"],
      ["a bad release", { release: { ...FAKE_RELEASE, releaseId: "x" }, lotId: FAKE_LOT, records: completeSet(), reviewPort: port }],
      ["a bad lot", { release: FAKE_RELEASE, lotId: "", records: completeSet(), reviewPort: port }],
      ["records that are no array", { release: FAKE_RELEASE, lotId: FAKE_LOT, records: { 0: fakeRecord("functional_test") }, reviewPort: port }],
      ["a port that is no function", { release: FAKE_RELEASE, lotId: FAKE_LOT, records: completeSet(), reviewPort: "trust me" }],
      // [B23-D review round, 2026-10-05] a claim, or a records list, whose every read throws is a malformed claim, never an exception (security-5)
      ["a claim whose every read throws", new Proxy({}, { get: thrower, has: thrower, ownKeys: thrower, getOwnPropertyDescriptor: thrower })],
      ["records whose every read throws", { release: FAKE_RELEASE, lotId: FAKE_LOT, records: new Proxy([], { get: thrower }), reviewPort: port }],
    ];
    for (const [label, input] of malformed) {
      const result = assembledProductEligibility(input as never);
      expect(result.eligible, label).toBe(false);
      expect(result.status, label).toBe("blocked");
      expect(result.reasons[0], label).toBe("assembly_data_authority_absent");
      expect(result.missing.length, label).toBeGreaterThan(0);
    }
    expect(assembledProductEligibility({ release: { ...FAKE_RELEASE, releaseId: "x" }, lotId: FAKE_LOT, records: completeSet(), reviewPort: port })).toMatchObject({ reasons: ["assembly_data_authority_absent", "claim_invalid", "physical_evidence_missing"], missing: REQUIRED, verdicts: [] });
    expect(assembledProductEligibility(malformed.at(-2)![1] as never)).toMatchObject({ reasons: ["assembly_data_authority_absent", "claim_invalid", "review_port_not_wired", "physical_evidence_missing"], missing: REQUIRED, verdicts: [] });
    expect(assembledProductEligibility(malformed.at(-1)![1] as never)).toMatchObject({ reasons: ["assembly_data_authority_absent", "claim_invalid", "physical_evidence_missing"], missing: REQUIRED, verdicts: [] });
    expect(judgePhysicalEvidenceRecord(malformed.at(-2)![1] as never)).toMatchObject({ satisfies: false, rejections: ["record_invalid"], problems: ["claim.input: plain data"] });
    const over = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: Array.from({ length: PHYSICAL_EVIDENCE_LIMITS.records + 1 }, () => fakeRecord("functional_test")), reviewPort: port });
    expect(over).toMatchObject({ reasons: ["assembly_data_authority_absent", "records_over_limit", "physical_evidence_missing"], missing: REQUIRED, verdicts: [] });
    expect(port.calls.length).toBeGreaterThanOrEqual(REQUIRED.length);

    // [B23-D review round, 2026-10-05] one record judged alone refuses a malformed claim without asking the port (tests-3)
    const asked = fakeReviewPort();
    const badClaims: Array<[string, Record<string, unknown>]> = [
      ["a bad release id", { release: { ...FAKE_RELEASE, releaseId: "x" }, lotId: FAKE_LOT }],
      ["an empty lot", { release: FAKE_RELEASE, lotId: "" }],
      ["a release with an extra key", { release: { ...FAKE_RELEASE, extra: "x" }, lotId: FAKE_LOT }],
      ["a proxy release", { release: new Proxy({ ...FAKE_RELEASE }, {}), lotId: FAKE_LOT }],
    ];
    for (const [label, claim] of badClaims) {
      const verdict = judgePhysicalEvidenceRecord({ record: fakeRecord("assembly_result"), reviewPort: asked, ...claim } as never);
      expect(verdict, label).toMatchObject({ satisfies: false, rejections: ["record_invalid"], recordId: null, kind: null });
      expect(verdict.problems.length, label).toBeGreaterThan(0);
      expect(verdict.problems.every((problem) => problem.startsWith("claim.")), label).toBe(true);
    }
    expect(asked.calls).toHaveLength(0);
    // the claim's release is read once, as data: a getter cannot show one release to the check and another to the comparison (tests-3)
    let releaseReads = 0;
    const shiftingRelease = { ...FAKE_RELEASE };
    Object.defineProperty(shiftingRelease, "releaseId", { enumerable: true, get: () => { releaseReads += 1; return releaseReads === 1 ? FAKE_RELEASE.releaseId : `mfg-release-${"c".repeat(32)}`; } });
    expect(judgePhysicalEvidenceRecord({ record: fakeRecord("assembly_result"), release: shiftingRelease, lotId: FAKE_LOT, reviewPort: fakeReviewPort() }).rejections).toEqual([]);
    expect(releaseReads).toBe(1);
    // [B23-D review round, 2026-10-05] a record is read once, as data, by the evaluator too (security-5): a proxy whose traps throw and a
    // getter that throws are refused as no data, never thrown; a refused record's id and kind come from that one copy or are null
    let traps = 0;
    const trap = (): never => { traps += 1; throw new Error("trap"); };
    const trapping = new Proxy(fakeRecord("functional_test"), { get: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, has: trap });
    try { structuredClone(trapping); } catch { /* the one copy attempt, counted */ }
    const perCopy = traps;
    traps = 0;
    const throwing = fakeRecord("assembly_result");
    Object.defineProperty(throwing, "recordId", { enumerable: true, get: () => { throw new Error("getter"); } });
    const refused = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [trapping, throwing], reviewPort: port });
    expect(refused).toMatchObject({ eligible: false, status: "blocked" });
    expect(refused.verdicts.map(({ recordId, kind, rejections, problems }) => ({ recordId, kind, rejections, problems }))).toEqual([0, 1].map(() => ({ recordId: null, kind: null, rejections: ["record_invalid"], problems: ["record: plain data"] })));
    expect(traps).toBe(perCopy);
    let idReads = 0;
    const shiftingId = fakeRecord("assembly_result");
    delete shiftingId.schema; // invalid, so the refused record's id is what the verdict reports
    Object.defineProperty(shiftingId, "recordId", { enumerable: true, get: () => { idReads += 1; return idReads <= 3 ? "pe-shifting-1" : { not: "an id" }; } });
    const shifted = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [shiftingId], reviewPort: port });
    expect(shifted.verdicts[0]).toMatchObject({ recordId: "pe-shifting-1", kind: "assembly_result", rejections: ["record_invalid"] });
    expect(idReads).toBe(1);

    // a sweep: no mutation of the complete set, with or without the port, is ever eligible
    // [B23-D review round, 2026-10-05] and each one is judged (tests-4): with the port, the mutated record satisfies only when its value is unchanged
    // or it was merely renamed (then only what relied on its old id is missing), and otherwise its kind is missing; without the port nothing satisfies
    const original = completeSet();
    let sweeps = 0;
    original.forEach((record, index) => {
      for (const key of [...PHYSICAL_EVIDENCE_RECORD_KEYS, "review"]) {
        for (const value of [null, "", [], {}, "pass", "hardware", FAKE_RELEASE, true]) {
          const records = completeSet().map((item) => (item.recordId === record.recordId ? { ...item, [key]: value } : item));
          const label = `${String(record.kind)}.${key}=${JSON.stringify(value)}`;
          const unchanged = Object.prototype.hasOwnProperty.call(record, key) && isDeepStrictEqual(record[key], value);
          const renamed = key === "recordId" && validatePhysicalEvidenceRecord({ ...record, recordId: value }).ok;
          for (const reviewPort of [port, undefined]) {
            const result = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records, reviewPort });
            expect(result.eligible, label).toBe(false);
            const verdict = result.verdicts[index]!;
            if (reviewPort === undefined) {
              expect(verdict.satisfies, label).toBe(false);
              expect(result.missing, label).toEqual(REQUIRED);
            } else if (unchanged) {
              expect(verdict.satisfies, label).toBe(true);
              expect(result.missing, label).toEqual([]);
            } else if (renamed) {
              expect(verdict.satisfies, label).toBe(true);
              expect(result.missing, label).toEqual(record.kind === "final_physical_qualification" ? [] : ["final_physical_qualification"]);
            } else {
              expect(verdict.satisfies, label).toBe(false);
              expect(result.missing, label).toContain(record.kind);
            }
            sweeps += 1;
          }
        }
      }
    });
    expect(sweeps).toBe(7 * 15 * 8 * 2);
  }, 30_000);

  it("8. nothing creates a record - no route, store, tool or form: the module imports one pure digest helper, holds no state (its top level is imports, types, functions and frozen literal trees), reads no environment, browser or network global, exports no writer, and no production module imports it", { timeout: 120_000 }, async () => {
    const source = read(MODULE);
    expect(moduleReferences(MODULE, source)).toEqual([{ kind: "static-import", specifier: "../durable-workflow/stable" }]);
    const file = parse(MODULE, source);
    expect(topLevelState(MODULE, source), "module-level state or side effects").toEqual([]);
    // [B23-D review round, 2026-10-05] the state check bites on a shallow freeze, a frozen map, a mutable array, a let, a top-level call and a
    // frozen array holding an object; the writer check on an exported arrow function (tests-1)
    const probes = [
      "export const B23D_HELD = Object.freeze({ records: [] as unknown[] });",
      "const HELD = Object.freeze(new Map<string, unknown>());",
      "export const B23D_HELD_RECORDS: unknown[] = [];",
      "let held = 0;",
      "const held = makeStore();",
      "const HELD = Object.freeze([{ records: 1 }]);",
      "export const HELD = Object.freeze({ inner: Object.freeze({ records: [] }) });",
    ];
    for (const probe of probes) expect(topLevelState("probe.ts", probe), probe).toHaveLength(1);
    expect(topLevelState("probe.ts", 'export const OK = Object.freeze({ inner: Object.freeze(["a", 1, null]), limit: 2 ** 40 });')).toEqual([]);
    const writerProbe = exportedNames("probe.ts", "export const storeRecord = (held: unknown): void => { void held; };");
    expect([...writerProbe.functions, ...writerProbe.consts].filter((name) => WRITER_NAME.test(name))).toEqual(["storeRecord"]);
    const forbidden = new Set(["process", "fetch", "localStorage", "sessionStorage", "indexedDB", "globalThis", "window", "document", "XMLHttpRequest", "WebSocket", "require", "WeakMap", "WeakSet", "setTimeout", "setInterval"]);
    const used: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && forbidden.has(node.text) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) && !ts.isPropertySignature(node.parent) && !ts.isPropertyAssignment(node.parent)) used.push(node.text);
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) used.push("class");
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(used).toEqual([]);
    const exported = exportedNames(MODULE, source);
    expect(exported.functions).toEqual(["validatePhysicalEvidenceRecord", "physicalEvidenceRecordDigest", "judgePhysicalEvidenceRecord", "assembledProductEligibility"]);
    expect([...exported.functions, ...exported.consts].filter((name) => WRITER_NAME.test(name))).toEqual([]);
    // no production module imports it (the import gates' AST resolution, every extension, the repository root included)
    await yieldOnce();
    const files = production();
    expect(files.size).toBeGreaterThan(1000);
    expect(files.has(MODULE)).toBe(true);
    await yieldOnce();
    expect(await importersOf(files, MODULE.replace(/\.ts$/, ""))).toEqual([]);
    await yieldOnce();
    // nothing else names its schema or a kind id; no route file, component, tool, action record or route path is about it
    const holders = [...files].filter(([path, text]) => path !== MODULE && (text.includes(PHYSICAL_EVIDENCE_SCHEMA) || text.includes("physical-evidence") || RUNBOOK_ORDER.some((kind) => text.includes(kind)))).map(([path]) => path);
    expect(holders).toEqual(["app/lib/evaluation/golden-catalog.ts"]); expect([...files.get("app/lib/evaluation/golden-catalog.ts")!.matchAll(/physical-evidence(?!\.ts:|-contract)/g)].length + [PHYSICAL_EVIDENCE_SCHEMA, ...RUNBOOK_ORDER].filter((name) => files.get("app/lib/evaluation/golden-catalog.ts")!.includes(name)).length).toBe(0); // [B24-B1, 2026-10-08] reviewed pin move (was []): the golden evaluation catalog (D24-14, OD-203) is the one citation holder, admitted by exact path - it names the B23-D suite path and physical-evidence.ts lines only (every "physical-evidence" is followed by ".ts:" or "-contract"), never the schema and never a kind id; the generator imports the catalog and spells neither
    const routes = listRouteFiles(ROOT).map((path) => relative(ROOT, path).split(sep).join("/"));
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.filter((path) => /physical-evidence|hardware-evidence|evidence-record/i.test(path))).toEqual([]);
    expect(sirkitToolRegistry().list().filter((descriptor) => /physical-evidence|evidence-record|assembled/i.test(descriptor.toolId))).toEqual([]);
    expect(ACTION_COVERAGE_REGISTRY.filter((record) => /physical-evidence|evidence-record/i.test(record.id)).map((record) => record.id)).toEqual([]);
    // the probe bites: an importer added at the root, under an escaped specifier, is found
    const escapedDash = `${String.fromCharCode(92)}u002d`; // the specifier spelled with an escape the parser decodes to "-"
    const probed = new Map(files).set("proxy.ts", `${files.get("proxy.ts") ?? ""}${NEWLINE}import { assembledProductEligibility } from "@/app/lib/manufacturing-providers/physical${escapedDash}evidence";${NEWLINE}`);
    expect(await importersOf(probed, MODULE.replace(/\.ts$/, ""))).toEqual(["proxy.ts"]);
  });

  it("9. the page physical-evidence.md: each kind, what it binds, who reviews it and that none exists (LB-5); the latent paths; the block; every citation of its section 14 on the line it names", () => {
    const page = read(PAGE);
    expect(page.startsWith("# B23-D - ")).toBe(true);
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(`**${label}**`);
    const titles = ["0. What B23-D is", "1. The eight kinds (D23-13, OD-175)", "2. What every record binds, and what never satisfies", "3. Review: a qualified human, derived from the server", "4. The eligibility evaluator: blocked for every input", "5. Nothing creates a record", "6. The latent claim paths (D23-14, OD-176)", "7. The assembled-release block (D23-15, OD-177)", "8. Live: BLOCKED-LIVE-QUALIFICATION (LB-5)", "9. Test-first record", "10. Every pin moved, and why", "11. Gates", "12. OD-187 - B23-D's choices beyond its task text", "13. What stays open", "14. Citations"];
    const positions = titles.map((title) => page.indexOf(`${NEWLINE}## ${title}${NEWLINE}`));
    expect(positions.every((position) => position > 0), JSON.stringify(positions)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(page).toContain("**Verdict: physical evidence is defined and none exists;");
    const kinds = page.slice(positions[1]!, positions[2]!);
    for (const kind of RUNBOOK_ORDER) {
      const row = kinds.split(NEWLINE).find((line) => line.startsWith(`| \`${kind}\` |`));
      expect(row, kind).toBeDefined();
      expect(row, kind).toContain(PHYSICAL_EVIDENCE_RUNBOOK[kind]);
      for (const key of PHYSICAL_EVIDENCE_DETAIL_KEYS[kind]) expect(row, `${kind}.${key}`).toContain(`\`${key}\``);
      expect(row, kind).toContain("project administrator");
      expect(row, kind).toMatch(/\| none \(LB-5\) \|$/);
    }
    for (const binding of ["releaseId", "archiveSha256", "boardRevision", "boardDigest", "subject", "procedure", "equipmentRefs", "operatorRefs", "rawArtifacts", "result"]) expect(page, binding).toContain(`\`${binding}\``);
    for (const suite of ["b23-d-physical-evidence-contract", "b23-d-assembled-release-blocked", "b23-d-latent-claim-paths"]) expect(page, suite).toContain(suite);
    expect(page).toContain(ASSEMBLED_RELEASE_UNBLOCK_CONDITION);
    // [B23-D review round, 2026-10-05] the page claims what is checked: references (coverage-6), the operators' separation (security-1, coverage-5),
    // the accepted files (security-3, coverage-3)
    expect(page).not.toContain("never prose, a person's name or an address");
    expect(page).toContain("a regex cannot tell an id from a name");
    expect(page.slice(positions[3]!, positions[4]!)).toContain("`operatorActorIds`");
    const acceptanceRow = kinds.split(NEWLINE).find((line) => line.startsWith("| `manufacturer_acceptance` |")) ?? "";
    expect(acceptanceRow).not.toContain("mfg-outbound-<sha256>");
    const citations = page.slice(positions[14]!);
    const rows = [...citations.matchAll(/^\| (C\d+) \| `([^`]+)` \| (\d+) \| `(.+)` \|$/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows.map((row) => row[1])).toEqual(rows.map((_, index) => `C${index + 1}`));
    const stale = rows.filter((row) => !(lines(row[2]!)[Number(row[3]) - 1] ?? "").includes(row[4]!.replaceAll("\\|", "|"))).map((row) => `${row[1]} ${row[2]}:${row[3]}`);
    expect(stale).toEqual([]);
  });

  it("10. the lot's identity binds every unit (coverage-2): a unit record names a serial the lot's identity lists, an inspection inspects no more than the lot holds, and the claim's identity is the lot's own record; one record judged alone cannot know the lot", () => {
    const replace = (kind: PhysicalEvidenceKind, overrides: Record<string, unknown>) => completeSet().map((record) => (record.kind === kind ? fakeRecord(kind, overrides) : record));
    const outside = claimOf(replace("functional_test", { subject: unit("sn-9999") }));
    expect(verdictOf(outside, "pe-functional_test-1")?.rejections).toEqual(["subject_mismatch"]);
    expect(outside.missing).toEqual(["functional_test", "final_physical_qualification"]);
    expect(claimOf(replace("functional_test", { subject: unit("sn-0003") })).missing).toEqual([]);
    const overInspected = claimOf(replace("incoming_inspection", { details: { inspectedQuantity: 1_000_000, nonconformingQuantity: 0, acceptanceCriteriaRef: "criteria:fake-class-2" } }));
    expect(verdictOf(overInspected, "pe-incoming_inspection-1")?.rejections).toEqual(["subject_mismatch"]);
    expect(overInspected.missing).toEqual(["incoming_inspection", "final_physical_qualification"]);
    const oneUnitIdentity = claimOf(replace("unit_lot_identity", { subject: unit("sn-0001"), details: { lotQuantity: 5, unitSerials: ["sn-0001"] } }));
    expect(verdictOf(oneUnitIdentity, "pe-unit_lot_identity-1")?.rejections).toEqual(["subject_mismatch"]);
    expect(oneUnitIdentity.missing).toEqual(["unit_lot_identity", "functional_test", "final_physical_qualification"]);
    // a unit's own identity record counts beside the lot's, naming a serial the lot lists; alone (above) it is outside the lot
    const besideLot = claimOf([...completeSet(), fakeRecord("unit_lot_identity", { recordId: "pe-unit_lot_identity-2", subject: unit("sn-0002"), details: { lotQuantity: 5, unitSerials: ["sn-0002"] } })]);
    expect(besideLot.verdicts.at(-1)).toMatchObject({ satisfies: true, rejections: [] });
    expect(besideLot.missing).toEqual([]);
    const disagreeing = claimOf([...completeSet(), fakeRecord("unit_lot_identity", { recordId: "pe-unit_lot_identity-2", details: { lotQuantity: 5, unitSerials: ["sn-0002", "sn-0003", "sn-0004", "sn-0005", "sn-0006"] } })]);
    expect(verdictOf(disagreeing, "pe-functional_test-1")?.rejections).toEqual(["subject_mismatch"]);
    expect(disagreeing.missing).toEqual(["functional_test", "final_physical_qualification"]);
    // one record judged alone cannot know the lot: the lot's identity is applied by the evaluator, over the claim's records
    expect(reviewed(fakeRecord("functional_test", { subject: unit("sn-9999") })).satisfies).toBe(true);
  });

  it("11. a failure of this release and lot raises its nonconformance whatever the lot's identity lists for its unit and whatever record shares its id; only another release or another lot puts a record outside the claim (low-1)", () => {
    // [B23-D low round, 2026-10-05] the independent check's first low issue: an unlisted unit's failure, or one voided by a duplicate id, raised nothing
    const swap = (records: Array<Record<string, unknown>>, kind: PhysicalEvidenceKind, overrides: Record<string, unknown>) => records.map((record) => (record.kind === kind ? fakeRecord(kind, overrides) : record));
    const failure = (overrides: Record<string, unknown>) => fakeRecord("functional_test", { recordId: "pe-functional_test-2", result: "fail", performedAt: at(30), ...overrides });
    // the issue's first scenario: the lot's identity lists four serials of five (valid: it may list fewer than it holds), and the fifth unit fails after the pass
    const fourListed = swap(completeSet(), "unit_lot_identity", { details: { lotQuantity: 5, unitSerials: ["sn-0001", "sn-0002", "sn-0003", "sn-0004"] } });
    expect(claimOf(fourListed)).toMatchObject({ openNonconformances: [], missing: [] });
    const unlisted = claimOf([...fourListed, failure({ subject: unit("sn-0005") })]);
    expect(unlisted).toMatchObject({ openNonconformances: ["pe-functional_test-2"], missing: ["deviation_rework", "final_physical_qualification"] });
    expect(verdictOf(unlisted, "pe-functional_test-2")?.rejections).toEqual(["subject_mismatch", "result_not_pass"]);
    // a lot identity listing no serial, with every test lot-scope: each unit's failure still raises
    const noneListed = swap(swap(completeSet(), "unit_lot_identity", { details: { lotQuantity: 5, unitSerials: [] } }), "functional_test", { subject: { scope: "lot", lotId: FAKE_LOT, unitSerial: null } });
    expect(claimOf(noneListed)).toMatchObject({ openNonconformances: [], missing: [] });
    for (const serial of ["sn-0001", "sn-0005", "sn-9999"]) expect(claimOf([...noneListed, failure({ subject: unit(serial), performedAt: at(-60) })]), serial).toMatchObject({ openNonconformances: ["pe-functional_test-2"], missing: ["deviation_rework"] });
    // a failing inspection of more units than the lot holds raises too
    expect(claimOf([...completeSet(), fakeRecord("incoming_inspection", { recordId: "pe-incoming_inspection-2", result: "fail", performedAt: at(-60), details: { inspectedQuantity: 6, nonconformingQuantity: 0, acceptanceCriteriaRef: "criteria:fake-class-2" } })])).toMatchObject({ openNonconformances: ["pe-incoming_inspection-2"], missing: ["deviation_rework"] });
    // the issue's other scenario: a failure voided by a duplicate id, while another unit's pass satisfies the kind; and one sharing its id with another kind
    const twin = fakeRecord("functional_test", { recordId: "pe-functional_test-2", subject: unit("sn-0003") });
    const duplicated = claimOf([...completeSet(), failure({ subject: unit("sn-0002"), performedAt: at(-60) }), twin]);
    expect(duplicated.verdicts.slice(-2).map((item) => item.rejections)).toEqual([["duplicate_record_id", "result_not_pass"], ["duplicate_record_id"]]);
    expect(duplicated).toMatchObject({ openNonconformances: ["pe-functional_test-2"], missing: ["deviation_rework"] });
    const acrossKinds = claimOf([...completeSet(), failure({ recordId: "pe-shared-1" }), fakeRecord("assembly_result", { recordId: "pe-shared-1" })]);
    expect(acrossKinds).toMatchObject({ openNonconformances: ["pe-shared-1"], missing: ["deviation_rework", "final_physical_qualification"] });
    // a record of this claim raises what it names whatever its serial listing or a duplicate id
    const naming = claimOf([...fourListed, fakeRecord("functional_test", { recordId: "pe-functional_test-2", subject: unit("sn-0005"), nonconformanceRefs: ["ncr:unlisted"] }), fakeRecord("assembly_result", { recordId: "pe-shared-1", nonconformanceRefs: ["ncr:shared"] }), fakeRecord("assembly_result", { recordId: "pe-shared-1" })]);
    expect(naming).toMatchObject({ openNonconformances: ["ncr:shared", "ncr:unlisted"], missing: ["deviation_rework"] });
    // only another release or another lot puts a record outside the claim: their failures raise nothing for it
    const outsiders = claimOf([...completeSet(), failure({ recordId: "pe-foreign-release-2", release: { ...FAKE_RELEASE, archiveSha256: "c".repeat(64) } }), failure({ recordId: "pe-foreign-lot-2", subject: { scope: "unit", lotId: "lot-other", unitSerial: "sn-0001" } })]);
    expect(outsiders.verdicts.slice(-2).map((item) => item.rejections)).toEqual([["release_mismatch", "result_not_pass"], ["subject_mismatch", "result_not_pass"]]);
    expect(outsiders).toMatchObject({ openNonconformances: [], missing: [] });
  });

  it("12. a deviation/rework closes a nonconformance only when it comes no earlier than every record that raised it, so each of its retests, no earlier than the rework, does too (low-2)", () => {
    // [B23-D low round, 2026-10-05] the independent check's second low issue: a repair dated before the failure it names closed it, the earlier pass its retest
    const failure = fakeRecord("functional_test", { recordId: "pe-functional_test-2", result: "fail", performedAt: at(30) });
    const dispose = (performedAt: string, retestRecordIds: string[], disposition = "repair") => fakeRecord("deviation_rework", { recordId: "pe-deviation_rework-2", subject: unit("sn-0001"), performedAt, details: { nonconformanceRef: "pe-functional_test-2", disposition, instructionRef: "instruction:fake-repair-1", retestRecordIds } });
    const requalify = (minutes: number, reliesOnRecordIds: string[]) => fakeRecord("final_physical_qualification", { recordId: "pe-final_physical_qualification-2", performedAt: at(minutes), details: { qualificationPlanRef: "plan:fake-final", reliesOnRecordIds } });
    // the issue's scenario: the 12:30 failure, a repair at 11:30 naming it with the 12:00 pass as its retest, and a final qualification at 12:35
    const early = claimOf([...completeSet(), failure, dispose(at(-30), ["pe-functional_test-1"]), requalify(35, SIX)]);
    expect(verdictOf(early, "pe-deviation_rework-2")?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(early).toMatchObject({ openNonconformances: ["pe-functional_test-2"], missing: ["deviation_rework"] });
    // after the failure, with the same pass as its retest: the retest predates the repair, so it closes nothing either
    const staleRetest = claimOf([...completeSet(), failure, dispose(at(31), ["pe-functional_test-1"]), requalify(35, SIX)]);
    expect(verdictOf(staleRetest, "pe-deviation_rework-2")?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(staleRetest).toMatchObject({ openNonconformances: ["pe-functional_test-2"], missing: ["deviation_rework"] });
    // after the failure, retested after itself: it closes, and a final qualification after both counts
    const retest = fakeRecord("functional_test", { recordId: "pe-functional_test-3", performedAt: at(33) });
    expect(claimOf([...completeSet(), failure, dispose(at(31), ["pe-functional_test-3"]), retest, requalify(35, [...SIX, "pe-functional_test-3", "pe-deviation_rework-2"])])).toMatchObject({ openNonconformances: [], missing: [] });
    // a lot's rework dated before the inspection that raised its nonconformance closes nothing; at that instant or later it closes (case 6)
    const lotNcr = completeSet().map((record) => (record.kind === "incoming_inspection" ? { ...record, nonconformanceRefs: ["ncr:fake-1"], details: { inspectedQuantity: 5, nonconformingQuantity: 1, acceptanceCriteriaRef: "criteria:fake-class-2" } } : record));
    const lotEarly = claimOf([...lotNcr, fakeRecord("deviation_rework", { performedAt: at(-30) })]);
    expect(lotEarly.verdicts.at(-1)?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(lotEarly).toMatchObject({ openNonconformances: ["ncr:fake-1"], missing: ["deviation_rework"] });
    expect(claimOf([...lotNcr, fakeRecord("deviation_rework")])).toMatchObject({ openNonconformances: [], missing: [] });
    // a nonconformance two records raise (the lot's inspection at 12:00, a unit's failure at 12:30): the rework comes no earlier than each
    const unitToo = fakeRecord("functional_test", { recordId: "pe-functional_test-2", result: "fail", performedAt: at(30), nonconformanceRefs: ["ncr:fake-1"] });
    const lotRework = (minutes: number) => fakeRecord("deviation_rework", { recordId: "pe-deviation_rework-2", performedAt: at(minutes), details: { nonconformanceRef: "ncr:fake-1", disposition: "rework", instructionRef: "instruction:fake-rework-1", retestRecordIds: ["pe-continuity_power_on-2"] } });
    const lotRetest = (minutes: number) => fakeRecord("continuity_power_on", { recordId: "pe-continuity_power_on-2", performedAt: at(minutes) });
    const between = claimOf([...lotNcr, unitToo, lotRework(15), lotRetest(20)]);
    expect(between.verdicts.at(-2)?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(between.openNonconformances).toEqual(["ncr:fake-1"]);
    expect(claimOf([...lotNcr, unitToo, lotRework(40), lotRetest(45), requalify(50, [...SIX, "pe-continuity_power_on-2"])])).toMatchObject({ openNonconformances: [], missing: [] });
    // a scrap dated before the failure it names closes nothing; satisfying on its own, it still removes its unit (case 13; [B23-D low round 2, 2026-10-05] low-4)
    const earlyScrap = claimOf([...completeSet(), failure, dispose(at(-30), [], "scrap")]);
    expect(verdictOf(earlyScrap, "pe-deviation_rework-2")?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(earlyScrap).toMatchObject({ openNonconformances: ["pe-functional_test-2"], missing: ["functional_test", "deviation_rework", "final_physical_qualification"] });
  });

  it("13. a scrap that satisfies on its own removes its unit or lot (low-3, low-4): no other record of a scrapped subject, its passes included, satisfies any kind, so a scrapped lot never presents complete evidence (a lot with no unit left is scrapped too: case 15); a scrap that does not satisfy removes nothing; the scrap closes what it names and removes nothing outside its subject or the claim", () => {
    // [B23-D low round, 2026-10-05] the independent check's third low issue: a scrap closed the failure and left the scrapped subject's passes counting
    // [B23-D low round 2, 2026-10-05] retitled in place: only a scrap that satisfies on its own removes (low-4), and a lot with no unit left is scrapped (low-5)
    const LOT = { scope: "lot", lotId: FAKE_LOT, unitSerial: null };
    const scrap = (subject: Record<string, unknown>, nonconformanceRef: string, overrides: Record<string, unknown> = {}) => fakeRecord("deviation_rework", { recordId: "pe-deviation_rework-2", subject, performedAt: at(40), ...overrides, details: { nonconformanceRef, disposition: "scrap", instructionRef: "instruction:fake-scrap-1", retestRecordIds: [] } });
    const requalify = (reliesOnRecordIds: string[]) => fakeRecord("final_physical_qualification", { recordId: "pe-final_physical_qualification-2", performedAt: at(50), details: { qualificationPlanRef: "plan:fake-final", reliesOnRecordIds } });
    // the issue's first scenario: the lot fails continuity/power-on at 12:30, is scrapped at 12:40, and a final qualification at 12:50 relies on the six
    const lotFailure = fakeRecord("continuity_power_on", { recordId: "pe-continuity_power_on-2", result: "fail", performedAt: at(30) });
    const lotScrapped = claimOf([...completeSet(), lotFailure, scrap(LOT, "pe-continuity_power_on-2"), requalify(SIX)]);
    expect(lotScrapped).toMatchObject({ openNonconformances: [], missing: REQUIRED });
    expect(verdictOf(lotScrapped, "pe-deviation_rework-2")).toMatchObject({ satisfies: true, rejections: [] });
    const others = lotScrapped.verdicts.filter((item) => item.recordId !== "pe-deviation_rework-2");
    expect(others).toHaveLength(9);
    expect(others.every((item) => !item.satisfies && item.rejections.includes("subject_scrapped")), JSON.stringify(others.map((item) => item.rejections))).toBe(true);
    // the issue's second scenario: sn-0001, the only unit with a functional test, fails and is scrapped
    const unitFailure = fakeRecord("functional_test", { recordId: "pe-functional_test-2", result: "fail", performedAt: at(30) });
    const unitScrapped = claimOf([...completeSet(), unitFailure, scrap(unit("sn-0001"), "pe-functional_test-2"), requalify(SIX)]);
    expect(unitScrapped).toMatchObject({ openNonconformances: [], missing: ["functional_test", "final_physical_qualification"] });
    expect(verdictOf(unitScrapped, "pe-functional_test-1")?.rejections).toEqual(["subject_scrapped"]);
    expect(verdictOf(unitScrapped, "pe-final_physical_qualification-2")?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(verdictOf(unitScrapped, "pe-continuity_power_on-1")?.satisfies).toBe(true);
    // a unit's scrap removes that unit only: the lot qualifies again on another unit's test, after the scrap
    const another = fakeRecord("functional_test", { recordId: "pe-functional_test-3", subject: unit("sn-0002"), performedAt: at(45) });
    expect(claimOf([...completeSet(), unitFailure, scrap(unit("sn-0001"), "pe-functional_test-2"), another, requalify([...SIX.filter((id) => id !== "pe-functional_test-1"), "pe-functional_test-3"])])).toMatchObject({ openNonconformances: [], missing: [] });
    // what a rework of the scrapped unit closed reopens: its retest was the unit's own record, which no longer satisfies
    const repairThenScrap = claimOf([
      ...completeSet(),
      fakeRecord("functional_test", { recordId: "pe-functional_test-2", result: "fail", performedAt: at(-60) }),
      fakeRecord("deviation_rework", { recordId: "pe-deviation_rework-3", subject: unit("sn-0001"), performedAt: at(-30), details: { nonconformanceRef: "pe-functional_test-2", disposition: "repair", instructionRef: "instruction:fake-repair-1", retestRecordIds: ["pe-functional_test-1"] } }),
      fakeRecord("functional_test", { recordId: "pe-functional_test-4", result: "fail", performedAt: at(30) }),
      scrap(unit("sn-0001"), "pe-functional_test-4"),
    ]);
    expect(verdictOf(repairThenScrap, "pe-deviation_rework-3")?.rejections).toEqual(["subject_scrapped"]);
    expect(repairThenScrap).toMatchObject({ openNonconformances: ["pe-functional_test-2"], missing: ["functional_test", "deviation_rework", "final_physical_qualification"] });
    // [B23-D low round 2, 2026-10-05] pins moved (low-4): only a scrap that satisfies on its own removes its subject - one without raw artifacts,
    // or sharing its id ([B23-D lead, 2026-10-05] which now removes, case 16: below), closes nothing and removes nothing, so the unit's pass counts as before it; a dry run is no physical event and removes nothing
    const noArtifacts = claimOf([...completeSet(), unitFailure, scrap(unit("sn-0001"), "pe-functional_test-2", { rawArtifacts: [] })]);
    expect(verdictOf(noArtifacts, "pe-deviation_rework-2")?.rejections).toEqual(["raw_artifacts_absent"]);
    expect(noArtifacts).toMatchObject({ openNonconformances: ["pe-functional_test-2"], missing: ["deviation_rework", "final_physical_qualification"] });
    // [B23-D lead, 2026-10-05] pin moved (case 16): a scrap sharing its id satisfies its own rules, so it removes its unit - the duplicate voids
    // it as a closure only (the failure stays open), never as a removal
    const shared = claimOf([...completeSet(), unitFailure, scrap(unit("sn-0001"), "pe-functional_test-2", { recordId: "pe-shared-1" }), fakeRecord("assembly_result", { recordId: "pe-shared-1" })]);
    expect(verdictOf(shared, "pe-functional_test-1")?.rejections).toEqual(["subject_scrapped"]);
    expect(shared).toMatchObject({ openNonconformances: ["pe-functional_test-2"], missing: ["functional_test", "deviation_rework", "final_physical_qualification"] });
    const dryRun = claimOf([...completeSet(), unitFailure, scrap(unit("sn-0001"), "pe-functional_test-2", { executionClass: "dry_run" })]);
    expect(verdictOf(dryRun, "pe-functional_test-1")?.satisfies).toBe(true);
    expect(dryRun).toMatchObject({ openNonconformances: ["pe-functional_test-2"], missing: ["deviation_rework", "final_physical_qualification"] });
    // a scrap of another lot or another release removes nothing of this claim
    const foreignLot = scrap({ scope: "lot", lotId: "lot-other", unitSerial: null }, "ncr:other", { recordId: "pe-foreign-scrap-1" });
    const foreignRelease = scrap(LOT, "ncr:other", { recordId: "pe-foreign-scrap-2", release: { ...FAKE_RELEASE, boardRevision: "pcb2-fedcba9876543210" } });
    expect(claimOf([...completeSet(), foreignLot, foreignRelease])).toMatchObject({ openNonconformances: [], missing: [] });
  });

  it("14. a removal never relaxes a rule (low-4): only a scrap that satisfies on its own removes its subject, and every hardware deviation/rework of the claim - satisfying or not, removed or not - comes before a final physical qualification that counts", () => {
    // [B23-D low round 2, 2026-10-05] the second independent check's first low issue: a scrap that did not satisfy still removed its unit, the
    // removed unit's later repair dropped out of the final qualification's ordering, and a stale final qualification counted
    const failure = fakeRecord("functional_test", { recordId: "pe-functional_test-2", subject: unit("sn-0002"), result: "fail", performedAt: at(-60) });
    const lotRework = fakeRecord("deviation_rework", { performedAt: at(-50), details: { nonconformanceRef: "pe-functional_test-2", disposition: "rework", instructionRef: "instruction:fake-rework-1", retestRecordIds: ["pe-continuity_power_on-2"] } });
    const lotRetest = fakeRecord("continuity_power_on", { recordId: "pe-continuity_power_on-2", performedAt: at(-40) });
    const repair = fakeRecord("deviation_rework", { recordId: "pe-deviation_rework-2", subject: unit("sn-0002"), performedAt: at(30), details: { nonconformanceRef: "pe-functional_test-2", disposition: "repair", instructionRef: "instruction:fake-repair-1", retestRecordIds: ["pe-functional_test-3"] } });
    const repairRetest = fakeRecord("functional_test", { recordId: "pe-functional_test-3", subject: unit("sn-0002"), performedAt: at(35) });
    const scrap = (overrides: Record<string, unknown> = {}) => fakeRecord("deviation_rework", { recordId: "pe-deviation_rework-3", subject: unit("sn-0002"), performedAt: at(40), ...overrides, details: { nonconformanceRef: "pe-functional_test-2", disposition: "scrap", instructionRef: "instruction:fake-scrap-1", retestRecordIds: [] } });
    // the issue's scenario: sn-0002 fails at 11:00; a lot rework at 11:10, retested at 11:20, and the unit's repair at 12:30, retested at 12:35,
    // both satisfy; the 12:00 final qualification, which relies on the six, is stale after the repair
    const issue = [...completeSet(), failure, lotRework, lotRetest, repair, repairRetest];
    const settled = claimOf(issue);
    expect(["pe-deviation_rework-1", "pe-deviation_rework-2"].map((id) => verdictOf(settled, id)?.satisfies)).toEqual([true, true]);
    expect(verdictOf(settled, "pe-final_physical_qualification-1")?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(settled).toMatchObject({ openNonconformances: [], missing: ["final_physical_qualification"] });
    // a scrap of sn-0002 at 12:40 that does not satisfy - no raw artifacts, no review ([B23-D lead, 2026-10-05] an id another record shares: below) - is no physical evidence of
    // a removal: the repair and its retest still satisfy, and the final qualification stays stale (the scrap comes after it as well)
    const unsatisfying: Array<[string, AssembledProductEligibility, PhysicalEvidenceRejection[]]> = [
      ["no raw artifacts", claimOf([...issue, scrap({ rawArtifacts: [] })]), ["raw_artifacts_absent"]],
      ["no review", assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [...issue, scrap()], reviewPort: unreviewed("pe-deviation_rework-3") }), ["review_absent"]],
    ];
    for (const [label, result, rejections] of unsatisfying) {
      expect(result.verdicts.find((item) => item.kind === "deviation_rework" && item.index === issue.length)?.rejections, label).toEqual(rejections);
      expect(verdictOf(result, "pe-deviation_rework-2"), label).toMatchObject({ satisfies: true, rejections: [] });
      expect(verdictOf(result, "pe-functional_test-3"), label).toMatchObject({ satisfies: true, rejections: [] });
      expect(result, label).toMatchObject({ openNonconformances: [], missing: ["final_physical_qualification"] });
    }
    // [B23-D lead, 2026-10-05] pin moved (case 16): a scrap sharing its id satisfies its own rules, so it removes sn-0002 (its repair and retest
    // are subject_scrapped), and the final qualification stays stale: the removed repair and the scrap still come after it
    const sharedId = claimOf([...issue, scrap({ recordId: "pe-shared-1" }), fakeRecord("assembly_result", { recordId: "pe-shared-1" })]);
    expect(sharedId.verdicts.find((item) => item.kind === "deviation_rework" && item.index === issue.length)?.rejections).toEqual(["duplicate_record_id"]);
    expect(["pe-deviation_rework-2", "pe-functional_test-3"].map((id) => verdictOf(sharedId, id)?.rejections)).toEqual([["subject_scrapped"], ["subject_scrapped"]]);
    expect(sharedId).toMatchObject({ openNonconformances: [], missing: ["final_physical_qualification"] });
    // a removed rework stays in the ordering: sn-0002 scrapped at 11:40 by a scrap that satisfies (it closes the failure); the unit's repair at
    // 12:30 and its retest no longer satisfy, yet the 12:00 final qualification, before that repair, stays stale
    const removedLater = claimOf([...completeSet(), failure, scrap({ performedAt: at(-20) }), repair, repairRetest]);
    expect(verdictOf(removedLater, "pe-deviation_rework-3")).toMatchObject({ satisfies: true, rejections: [] });
    expect(["pe-deviation_rework-2", "pe-functional_test-3"].map((id) => verdictOf(removedLater, id)?.rejections)).toEqual([["subject_scrapped"], ["subject_scrapped"]]);
    expect(verdictOf(removedLater, "pe-final_physical_qualification-1")?.rejections).toEqual(["relies_on_unsatisfied"]);
    expect(removedLater).toMatchObject({ openNonconformances: [], missing: ["final_physical_qualification"] });
    // ... and the same scrap at 12:40, after both: it removes the repair and its retest, and the final qualification stays stale
    const removedAfter = claimOf([...issue, scrap()]);
    expect(["pe-deviation_rework-3", "pe-deviation_rework-2"].map((id) => verdictOf(removedAfter, id)?.rejections)).toEqual([[], ["subject_scrapped"]]);
    expect(removedAfter).toMatchObject({ openNonconformances: [], missing: ["final_physical_qualification"] });
    // a hardware deviation/rework of the claim after the final qualification leaves it stale whether or not it satisfies (a waiver, a rework
    // without raw artifacts); a dry run, or another lot's or release's rework, is no physical event of the claim and leaves it standing
    const later = (overrides: Record<string, unknown>, disposition = "rework") => fakeRecord("deviation_rework", { recordId: "pe-deviation_rework-4", performedAt: at(30), ...overrides, details: { nonconformanceRef: "ncr:unraised", disposition, instructionRef: "instruction:fake-rework-1", retestRecordIds: disposition === "use_as_is" ? [] : ["pe-continuity_power_on-1"] } });
    const afterFinal: Array<[string, Record<string, unknown>, PhysicalEvidenceRejection[], PhysicalEvidenceKind[]]> = [
      ["a waiver after it", later({}, "use_as_is"), ["waiver_disposition"], ["final_physical_qualification"]],
      ["a rework without raw artifacts after it", later({ rawArtifacts: [] }), ["raw_artifacts_absent"], ["final_physical_qualification"]],
      ["a dry-run rework after it", later({ executionClass: "dry_run" }), ["dry_run_class"], []],
      ["another lot's rework after it", later({ subject: { scope: "lot", lotId: "lot-other", unitSerial: null } }), ["subject_mismatch"], []],
      ["another release's rework after it", later({ release: { ...FAKE_RELEASE, boardDigest: `pcb-authority-${"a".repeat(64)}` } }), ["release_mismatch"], []],
    ];
    for (const [label, record, rejections, missing] of afterFinal) {
      const result = claimOf([...completeSet(), record]);
      expect(result.verdicts.at(-1)?.rejections, label).toEqual(rejections);
      expect(result, label).toMatchObject({ openNonconformances: [], missing });
    }
  });

  it("15. a lot with no unit left is scrapped (low-5): once a scrap that satisfies on its own has removed every serial one of the lot's identities lists, or as many distinct units as the lot holds, no record of the lot satisfies any kind, so it never presents complete evidence", () => {
    // [B23-D low round 2, 2026-10-05] the second independent check's second low issue: each unit was scrapped one by one, and the lot's lot-scope
    // records still presented complete evidence
    const LOT = { scope: "lot", lotId: FAKE_LOT, unitSerial: null };
    const SERIALS = ["sn-0001", "sn-0002", "sn-0003", "sn-0004", "sn-0005"];
    const swap = (records: Array<Record<string, unknown>>, kind: PhysicalEvidenceKind, overrides: Record<string, unknown>) => records.map((record) => (record.kind === kind ? fakeRecord(kind, overrides) : record));
    const lotScoped = swap(completeSet(), "functional_test", { subject: LOT });
    const scrapOf = (serial: string, overrides: Record<string, unknown> = {}, nonconformanceRef = "ncr:x") => fakeRecord("deviation_rework", { recordId: `pe-scrap-${serial}`, subject: unit(serial), performedAt: at(-30), ...overrides, details: { nonconformanceRef, disposition: "scrap", instructionRef: "instruction:fake-scrap-1", retestRecordIds: [] } });
    expect(claimOf(lotScoped)).toMatchObject({ openNonconformances: [], missing: [] });
    // the issue's first scenario: the five listed units scrapped one by one at 11:30, each naming a nonconformance no record raises
    const emptied = claimOf([...lotScoped, ...SERIALS.map((serial) => scrapOf(serial))]);
    expect(emptied).toMatchObject({ openNonconformances: [], missing: REQUIRED });
    expect(emptied.verdicts.slice(0, 7).map((item) => item.rejections)).toEqual(REQUIRED.map(() => ["subject_scrapped"]));
    expect(emptied.verdicts.slice(7).map((item) => item.satisfies)).toEqual(SERIALS.map(() => true));
    // the issue's second scenario: a lot of one unit, sn-0001, which fails at 11:00 and is scrapped at 11:30
    const single = swap(swap(lotScoped, "unit_lot_identity", { details: { lotQuantity: 1, unitSerials: ["sn-0001"] } }), "incoming_inspection", { details: { inspectedQuantity: 1, nonconformingQuantity: 0, acceptanceCriteriaRef: "criteria:fake-class-2" } });
    expect(claimOf(single)).toMatchObject({ openNonconformances: [], missing: [] });
    const unitFailure = fakeRecord("functional_test", { recordId: "pe-functional_test-2", subject: unit("sn-0001"), result: "fail", performedAt: at(-60) });
    const lastUnit = claimOf([...single, unitFailure, scrapOf("sn-0001", {}, "pe-functional_test-2")]);
    expect(verdictOf(lastUnit, "pe-scrap-sn-0001")).toMatchObject({ satisfies: true, rejections: [] });
    expect(lastUnit).toMatchObject({ openNonconformances: [], missing: REQUIRED });
    // every serial an identity lists, when it lists fewer than the lot holds (its other units can bear no unit evidence of the claim); as many
    // distinct units as the lot holds, whatever its identity lists - none, or other serials
    expect(claimOf([...swap(lotScoped, "unit_lot_identity", { details: { lotQuantity: 5, unitSerials: ["sn-0001", "sn-0002"] } }), scrapOf("sn-0001"), scrapOf("sn-0002")])).toMatchObject({ openNonconformances: [], missing: REQUIRED });
    const noneListed = swap(lotScoped, "unit_lot_identity", { details: { lotQuantity: 5, unitSerials: [] } });
    expect(claimOf(noneListed)).toMatchObject({ openNonconformances: [], missing: [] });
    expect(claimOf([...noneListed, ...SERIALS.map((serial) => scrapOf(serial))])).toMatchObject({ openNonconformances: [], missing: REQUIRED });
    expect(claimOf([...lotScoped, ...["sn-0006", "sn-0007", "sn-0008", "sn-0009", "sn-0010"].map((serial) => scrapOf(serial))])).toMatchObject({ openNonconformances: [], missing: REQUIRED });
    // controls - the lot keeps a unit, and its lot-scope records still count: four of the five (one of them twice); a fifth scrap that does not
    // satisfy (no raw artifacts, no review; [B23-D lead, 2026-10-05] an id another record shares removes: below) or is a dry run; the five scrapped in another lot
    const four = SERIALS.slice(0, 4).map((serial) => scrapOf(serial));
    const keeps: Array<[string, Array<Record<string, unknown>>, PhysicalEvidenceReviewPort]> = [
      ["four of the five", four, fakeReviewPort()],
      ["four of the five, one twice", [...four, scrapOf("sn-0001", { recordId: "pe-scrap-again" })], fakeReviewPort()],
      ["a fifth without raw artifacts", [...four, scrapOf("sn-0005", { rawArtifacts: [] })], fakeReviewPort()],
      ["a fifth without review", [...four, scrapOf("sn-0005")], unreviewed("pe-scrap-sn-0005")],
      ["a fifth as a dry run", [...four, scrapOf("sn-0005", { executionClass: "dry_run" })], fakeReviewPort()],
      ["the five in another lot", SERIALS.map((serial) => scrapOf(serial, { subject: { scope: "unit", lotId: "lot-other", unitSerial: serial } })), fakeReviewPort()],
    ];
    for (const [label, extra, reviewPort] of keeps) {
      const result = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [...lotScoped, ...extra], reviewPort });
      expect(result.verdicts.slice(0, 7).every((item) => item.satisfies), label).toBe(true);
      expect(result, label).toMatchObject({ openNonconformances: [], missing: [] });
    }
    // [B23-D lead, 2026-10-05] pin moved (case 16): a fifth scrap sharing its id satisfies its own rules, so it removes sn-0005 and the lot has no
    // unit left
    expect(claimOf([...lotScoped, ...four, scrapOf("sn-0005", { recordId: "pe-shared-1" }), fakeRecord("assembly_result", { recordId: "pe-shared-1" })])).toMatchObject({ openNonconformances: [], missing: REQUIRED });
  });

  it("16. a duplicate id never takes back a removal or a binding (lead round): a scrap removes, and a lot identity binds and counts units, when it satisfies its own rules, whatever record shares its id - so a record that is not physical evidence never moves a claim toward complete", () => {
    // [B23-D lead, 2026-10-05] the second independent check's re-check raised one more low issue: a dry-run record sharing a reviewed scrap's id
    // voided the scrap, its removal with it, and the claim went from incomplete to complete; the same through the identities that bind units
    // and count a lot's units out
    const LOT = { scope: "lot", lotId: FAKE_LOT, unitSerial: null };
    const swap = (records: Array<Record<string, unknown>>, kind: PhysicalEvidenceKind, overrides: Record<string, unknown>) => records.map((record) => (record.kind === kind ? fakeRecord(kind, overrides) : record));
    const scrapOf = (serial: string, recordId = `pe-scrap-${serial}`) => fakeRecord("deviation_rework", { recordId, subject: unit(serial), performedAt: at(-30), details: { nonconformanceRef: "ncr:x", disposition: "scrap", instructionRef: "instruction:fake-scrap-1", retestRecordIds: [] } });
    const dryRunSharing = (recordId: string) => fakeRecord("assembly_result", { recordId, executionClass: "dry_run" });
    // the issue's first scenario: a reviewed scrap of sn-0001 removes it; a dry run sharing the scrap's id takes nothing back
    const scrapped = claimOf([...completeSet(), scrapOf("sn-0001", "pe-deviation_rework-9")]);
    expect(scrapped).toMatchObject({ openNonconformances: [], missing: ["functional_test", "final_physical_qualification"] });
    const shared = claimOf([...completeSet(), scrapOf("sn-0001", "pe-deviation_rework-9"), dryRunSharing("pe-deviation_rework-9")]);
    expect(verdictOf(shared, "pe-functional_test-1")).toMatchObject({ satisfies: false, rejections: ["subject_scrapped"] });
    expect(shared).toMatchObject({ openNonconformances: [], missing: ["functional_test", "final_physical_qualification"] });
    // the issue's second scenario: a second identity of two units, both scrapped, counts the lot out; a dry run sharing that identity's id
    // leaves it counted out
    const twoUnits = fakeRecord("unit_lot_identity", { recordId: "pe-unit_lot_identity-2", details: { lotQuantity: 2, unitSerials: ["sn-0001", "sn-0002"] } });
    const lotOfTwo = [...swap(swap(completeSet(), "functional_test", { subject: LOT }), "incoming_inspection", { details: { inspectedQuantity: 2, nonconformingQuantity: 0, acceptanceCriteriaRef: "criteria:fake-class-2" } }), twoUnits];
    expect(claimOf(lotOfTwo)).toMatchObject({ openNonconformances: [], missing: [] });
    expect(claimOf([...lotOfTwo, scrapOf("sn-0001"), scrapOf("sn-0002")])).toMatchObject({ openNonconformances: [], missing: REQUIRED });
    expect(claimOf([...lotOfTwo, scrapOf("sn-0001"), scrapOf("sn-0002"), dryRunSharing("pe-unit_lot_identity-2")])).toMatchObject({ openNonconformances: [], missing: REQUIRED });
    // the same class through binding: the only functional test is of sn-0003, which the second identity does not list; a dry run sharing that
    // identity's id does not unbind it
    const notListed = [...swap(completeSet(), "functional_test", { subject: unit("sn-0003") }), fakeRecord("unit_lot_identity", { recordId: "pe-unit_lot_identity-2", details: { lotQuantity: 5, unitSerials: ["sn-0001", "sn-0002"] } })];
    expect(verdictOf(claimOf(notListed), "pe-functional_test-1")).toMatchObject({ satisfies: false, rejections: ["subject_mismatch"] });
    const unbound = claimOf([...notListed, dryRunSharing("pe-unit_lot_identity-2")]);
    expect(verdictOf(unbound, "pe-functional_test-1")).toMatchObject({ satisfies: false, rejections: ["subject_mismatch"] });
    expect(unbound).toMatchObject({ openNonconformances: [], missing: ["functional_test", "final_physical_qualification"] });
    // controls: a scrap or identity that fails its own rules (no raw artifacts, no review, a dry run) removes, binds and counts nothing, shared
    // id or not
    const ownRulesFail: Array<[string, Array<Record<string, unknown>>, PhysicalEvidenceReviewPort]> = [
      ["a scrap without raw artifacts", [fakeRecord("deviation_rework", { ...scrapOf("sn-0001", "pe-deviation_rework-9"), rawArtifacts: [] }), dryRunSharing("pe-deviation_rework-9")], fakeReviewPort()],
      ["an unreviewed scrap", [scrapOf("sn-0001", "pe-deviation_rework-9"), dryRunSharing("pe-deviation_rework-9")], unreviewed("pe-deviation_rework-9")],
      ["a dry-run scrap", [fakeRecord("deviation_rework", { ...scrapOf("sn-0001", "pe-deviation_rework-9"), executionClass: "dry_run" })], fakeReviewPort()],
      ["a dry-run identity", [fakeRecord("unit_lot_identity", { recordId: "pe-unit_lot_identity-2", executionClass: "dry_run", details: { lotQuantity: 5, unitSerials: ["sn-0002"] } })], fakeReviewPort()],
    ];
    for (const [label, extra, reviewPort] of ownRulesFail) {
      const result = assembledProductEligibility({ release: FAKE_RELEASE, lotId: FAKE_LOT, records: [...completeSet(), ...extra], reviewPort });
      expect(result.verdicts.slice(0, 7).every((item) => item.satisfies), label).toBe(true);
      expect(result, label).toMatchObject({ openNonconformances: [], missing: [] });
    }
  });
});

// [B23-D] a compile-time pin beside case 7's runtime one: the record union is closed over the eight kinds
type KindsOfRecords = PhysicalEvidenceRecord["kind"];
const everyKind: Record<KindsOfRecords, true> = { manufacturer_acceptance: true, unit_lot_identity: true, incoming_inspection: true, continuity_power_on: true, functional_test: true, assembly_result: true, deviation_rework: true, final_physical_qualification: true };
void everyKind;
