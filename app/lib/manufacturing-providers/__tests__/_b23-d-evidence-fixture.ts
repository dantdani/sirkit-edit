/**
 * [B23-D] Test-only fixtures for the physical-evidence contract (D23-13, OD-175): a synthetic release binding, one valid record of each
 * kind, and a fake review port that stands in for the server composition root none wires (`PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING` is
 * "none"). Every value is an obvious fake: no real board, lot, unit, instrument or person is described, and nothing is written anywhere.
 */
import { PHYSICAL_EVIDENCE_SCHEMA, type PhysicalEvidenceKind, type PhysicalEvidenceReviewPort, type PhysicalEvidenceReviewRequest, type PhysicalReleaseBinding } from "../physical-evidence";

export const FAKE_RELEASE: PhysicalReleaseBinding = Object.freeze({
  releaseId: `mfg-release-${"d".repeat(32)}`,
  archiveSha256: "e".repeat(64),
  boardRevision: "pcb2-0123456789abcdef",
  boardDigest: `pcb-authority-${"f".repeat(64)}`,
});
export const FAKE_LOT = "lot-b23d-001";
export const FAKE_OPERATOR = "operator:fake-1";
/** [B23-D review round] The server actor id the fake port resolves `FAKE_OPERATOR` to: another namespace than the record's reference. */
export const FAKE_OPERATOR_ACTOR = "user-fake-operator-1";
export const FAKE_REVIEWER = "reviewer:fake-admin";
export const PERFORMED_AT = "2026-10-05T12:00:00.000Z";
export const REVIEWED_AT = "2026-10-05T13:00:00.000Z";
const hex = (seed: number): string => seed.toString(16).padStart(64, "0");

/** The kind-specific details of a valid record. */
function details(kind: PhysicalEvidenceKind): Record<string, unknown> {
  switch (kind) {
    case "manufacturer_acceptance": return { manufacturerRef: "manufacturer:fake-fab", acceptanceRef: "acceptance:fake-job-1", acceptedFilesDigest: FAKE_RELEASE.archiveSha256 };
    case "unit_lot_identity": return { lotQuantity: 5, unitSerials: ["sn-0001", "sn-0002", "sn-0003", "sn-0004", "sn-0005"] };
    case "incoming_inspection": return { inspectedQuantity: 5, nonconformingQuantity: 0, acceptanceCriteriaRef: "criteria:fake-class-2" };
    case "continuity_power_on": return { checks: ["continuity", "isolation", "power_on"] };
    case "functional_test": return { testDefinitionRef: "test:fake-blink", testDefinitionDigest: `sha256:${hex(7)}` };
    case "assembly_result": return { assemblyDataDigest: `sha256:${hex(8)}`, populationVariantRef: "variant:fake-base" };
    // [B23-D review round] a lot's rework is retested by a physical test of the lot (a unit's functional test covers one unit only)
    case "deviation_rework": return { nonconformanceRef: "ncr:fake-1", disposition: "rework", instructionRef: "instruction:fake-rework-1", retestRecordIds: ["pe-continuity_power_on-1"] };
    case "final_physical_qualification": return { qualificationPlanRef: "plan:fake-final", reliesOnRecordIds: ["pe-manufacturer_acceptance-1", "pe-unit_lot_identity-1", "pe-incoming_inspection-1", "pe-continuity_power_on-1", "pe-functional_test-1", "pe-assembly_result-1"] };
  }
}

/** A fresh, valid, mutable record of `kind` (one unit for the functional test, the lot otherwise). */
export function fakeRecord(kind: PhysicalEvidenceKind, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: PHYSICAL_EVIDENCE_SCHEMA,
    kind,
    recordId: `pe-${kind}-1`,
    release: { ...FAKE_RELEASE },
    subject: kind === "functional_test" ? { scope: "unit", lotId: FAKE_LOT, unitSerial: "sn-0001" } : { scope: "lot", lotId: FAKE_LOT, unitSerial: null },
    procedure: { procedureRef: `procedure:${kind}`, procedureRevision: "rev-1", procedureDigest: `sha256:${hex(1)}` },
    equipmentRefs: ["equipment:fake-dmm-1"],
    operatorRefs: [FAKE_OPERATOR],
    rawArtifacts: [{ artifactRef: `raw:${kind}:1`, sha256: hex(2), bytes: 1024 }],
    executionClass: "hardware",
    result: "pass",
    performedAt: PERFORMED_AT,
    nonconformanceRefs: [],
    details: details(kind),
    ...overrides,
  };
}

/** One satisfying record of every kind an assembled-product claim requires (no deviation is open, so no deviation record). */
export function completeSet(): Array<Record<string, unknown>> {
  return (["manufacturer_acceptance", "unit_lot_identity", "incoming_inspection", "continuity_power_on", "functional_test", "assembly_result", "final_physical_qualification"] as const).map((kind) => fakeRecord(kind));
}

/** A fake of the review port no server composition root wires: it answers a server-derived human review of the exact digest asked, and,
 *  as the server would from the stored record, the actor id of its one operator ([B23-D review round] `operatorActorIds`, security-1). */
export function fakeReviewPort(overrides: Record<string, unknown> = {}): PhysicalEvidenceReviewPort & { readonly calls: PhysicalEvidenceReviewRequest[] } {
  const calls: PhysicalEvidenceReviewRequest[] = [];
  const port = (request: PhysicalEvidenceReviewRequest): unknown => {
    calls.push(request);
    return { derivation: "server_session", reviewerActorId: FAKE_REVIEWER, operatorActorIds: [FAKE_OPERATOR_ACTOR], actorKind: "human", role: "project_admin", qualificationRef: "qualification:fake-workmanship", reviewedRecordDigest: request.recordDigest, reviewedAt: REVIEWED_AT, ...overrides };
  };
  return Object.assign(port, { calls });
}
