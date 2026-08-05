import { describe, expect, it } from "vitest";
import { compileRequirementsPackage } from "../compiler";
import { validateDesignRequirementsPackage } from "../validation";
import { candidate, compileInput, packageApproval, requirementApproval, source } from "./fixtures";

describe("CD-1 deterministic requirements compiler", () => {
  it("keeps proposed extraction non-authoritative and awaits approval", () => {
    const result = compileRequirementsPackage(compileInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.package.requirements[0].status).toBe("proposed");
    expect(result.package.status).toBe("awaiting_approval");
  });

  it("accepts a clean package only with independent requirement and package approvals", () => {
    const artifact = source(); const item = candidate(artifact, { requestedStatus: "confirmed" });
    const approvals = [requirementApproval(artifact.projectId, item.lineageKey), packageApproval(artifact.projectId)];
    const result = compileRequirementsPackage(compileInput(artifact, [item], { approvals }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.package.requirements[0].status).toBe("confirmed");
    expect(result.package.status).toBe("accepted_for_architecture_exploration");
    expect(validateDesignRequirementsPackage(result.package)).toBe(true);
  });

  it("honors approval revocation instead of any historical approval", () => {
    const artifact = source(); const item = candidate(artifact, { requestedStatus: "confirmed" });
    const approved = requirementApproval(artifact.projectId, item.lineageKey);
    const revoked = { ...approved, approvalId: `${approved.approvalId}:revoked`, decision: "revoked" as const, createdAt: "2026-07-17T12:01:00.000Z" };
    const result = compileRequirementsPackage(compileInput(artifact, [item], { approvals: [approved, revoked, packageApproval(artifact.projectId)] }));
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.package.requirements[0].status).toBe("awaiting_confirmation"); expect(result.package.status).not.toBe("accepted_for_architecture_exploration"); }
  });

  it("is deterministic under candidate and envelope reordering", () => {
    const artifact = source({ content: "Trace width is at least 0.20 mm. Clearance is at least 0.15 mm." });
    const first = candidate(artifact, { candidateId: "c1", lineageKey: "trace", sourceSpan: { spanStartEnd: { start: 0, end: 34 } }, sourceRef: candidate(artifact).sourceRef });
    const second = candidate(artifact, { candidateId: "c2", lineageKey: "clearance", title: "Clearance", candidateStatement: "Clearance is at least 0.15 mm.", sourceSpan: { spanStartEnd: { start: 35, end: artifact.normalizedContent.length } }, typedPredicate: { form: "minimum", value: { dimension: "length", value: "0.15", unit: "mm" } }, subjectRefsOrRoles: ["pcb.clearance:net-class:default"] });
    const a = compileRequirementsPackage(compileInput(artifact, [first, second])); const b = compileRequirementsPackage(compileInput(artifact, [second, first]));
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.package.deterministicDigest).toBe(b.package.deterministicDigest);
  });

  it("creates draft Stage 6 constraints and never activates them", () => {
    const result = compileRequirementsPackage(compileInput()); if (!result.ok) throw new Error("compile failed");
    expect(result.package.constraintProposal?.activationState).toBe("not_active");
    expect(result.package.constraintProposal?.stage6Document.constraints).toHaveLength(1);
    expect(result.package.constraintProposal?.stage6Document.constraints[0].lifecycle.state).toBe("draft");
    expect(result.package.constraintProposal?.stage6Document.constraints[0].origin.reviewState).toBe("proposed");
  });

  it("keeps unresolved roles deferred without inventing design objects", () => {
    const artifact = source({ content: "Input voltage shall be 9 to 16 V." });
    const item = candidate(artifact, { proposedDomain: "electrical_supply_load", proposedKind: "range", typedPredicate: { form: "range", min: { dimension: "voltage", value: "9", unit: "V" }, max: { dimension: "voltage", value: "16", unit: "V" }, minInclusive: true, maxInclusive: true }, subjectRefsOrRoles: ["power_source"], capabilityDemandIds: ["regulated-dc-power"], conditions: [{ conditionId: "mode", label: "Normal operation", value: "normal", sourceRefs: [candidate(artifact).sourceRef] }] });
    const result = compileRequirementsPackage(compileInput(artifact, [item])); if (!result.ok) throw new Error("compile failed");
    expect(result.package.constraintProposal?.items[0].state).toBe("deferred");
    expect(result.package.constraintProposal?.items[0].deferredScope?.selectorMustNotInventObjects).toBe(true);
    expect(result.package.constraintProposal?.stage6Document.constraints).toHaveLength(0);
  });

  it("plans verification but never calls the plan passing evidence", () => {
    const result = compileRequirementsPackage(compileInput()); if (!result.ok) throw new Error("compile failed");
    expect(result.package.verificationObligations).toHaveLength(1);
    expect(result.package.verificationObligations[0].status).toBe("planned");
    expect(result.package.verificationObligations[0].evidenceRefs).toEqual([]);
    expect(result.package.coverageReport.rows[0].currentEvidenceState).toBe("planned");
  });

  it("does not lose a hard requirement from the acceptance matrix", () => {
    const result = compileRequirementsPackage(compileInput()); if (!result.ok) throw new Error("compile failed");
    expect(result.package.coverageReport.hardRequirementIds).toEqual(result.package.requirements.map((item) => item.requirementId));
    expect(result.package.coverageReport.rows.map((item) => item.requirementId)).toEqual(result.package.requirements.map((item) => item.requirementId));
  });

  it("blocks confirmed incompatible numeric ranges while preserving both sources", () => {
    const artifact = source({ content: "Width shall be at least 30 mm. Width shall be at most 20 mm." });
    const min = candidate(artifact, { candidateId: "min", lineageKey: "min-width", title: "Minimum width", candidateStatement: "Width shall be at least 30 mm.", typedPredicate: { form: "minimum", value: { dimension: "length", value: "30", unit: "mm" } }, subjectRefsOrRoles: ["board_outline:width"], capabilityDemandIds: ["pcb-2-4-layer"], requestedStatus: "confirmed" });
    const max = candidate(artifact, { candidateId: "max", lineageKey: "max-width", title: "Maximum width", candidateStatement: "Width shall be at most 20 mm.", typedPredicate: { form: "maximum", value: { dimension: "length", value: "20", unit: "mm" } }, subjectRefsOrRoles: ["board_outline:width"], capabilityDemandIds: ["pcb-2-4-layer"], requestedStatus: "confirmed" });
    const approvals = [requirementApproval(artifact.projectId, min.lineageKey), requirementApproval(artifact.projectId, max.lineageKey), packageApproval(artifact.projectId)];
    const result = compileRequirementsPackage(compileInput(artifact, [min, max], { approvals })); if (!result.ok) throw new Error("compile failed");
    expect(result.package.status).toBe("blocked_by_contradiction");
    expect(result.package.conflicts[0].conflictKind).toBe("empty_numeric_range");
    expect(result.package.conflicts[0].minimalConflictSet).toHaveLength(2);
    expect(result.package.requirements).toHaveLength(2);
  });

  it("blocks a confirmed unsupported hard capability", () => {
    const artifact = source({ content: "The board shall use an unsupported 400 V DC input stage." });
    const item = candidate(artifact, { lineageKey: "400v", requestedStatus: "confirmed", proposedDomain: "electrical_supply_load", proposedKind: "maximum", typedPredicate: { form: "maximum", value: { dimension: "voltage", value: "400", unit: "V" } }, subjectRefsOrRoles: ["power_source"], capabilityDemandIds: ["embedded-low-voltage"], conditions: [{ conditionId: "normal", label: "Normal operation", value: "normal", sourceRefs: [candidate(artifact).sourceRef] }] });
    const result = compileRequirementsPackage(compileInput(artifact, [item], { approvals: [requirementApproval(artifact.projectId, item.lineageKey), packageApproval(artifact.projectId)] })); if (!result.ok) throw new Error("compile failed");
    expect(result.package.requirements[0].capabilityAssessment.state).toBe("unsupported");
    expect(result.package.status).toBe("blocked_by_unsupported_capability");
  });

  it("asks risk-ranked questions instead of mapping vague words to numbers", () => {
    const artifact = source({ content: "Make the product small, cheap, industrial, low power, fast, and robust." });
    const item = candidate(artifact, { candidateStatement: artifact.normalizedContent, typedPredicate: { form: "qualitative_rubric", rubricId: "owner-defined-quality", reviewMethod: "Owner defines measurable terms", authorizedReviewerRole: "project_admin" }, proposedKind: "quality_attribute", subjectRefsOrRoles: ["product"], capabilityDemandIds: [], ambiguityNotes: ["Every adjective lacks an operational definition."], missingFields: ["size", "cost basis", "temperature", "power mode", "latency", "robustness rubric"] });
    const result = compileRequirementsPackage(compileInput(artifact, [item])); if (!result.ok) throw new Error("compile failed");
    expect(result.package.openQuestions.length).toBeGreaterThan(0);
    expect(result.package.openQuestions[0].priorityScoreBreakdown.total).toBeTypeOf("number");
    expect(JSON.stringify(result.package)).not.toContain('"value":"25"');
  });

  it("tracks source-to-requirement-to-constraint-and-obligation traceability", () => {
    const result = compileRequirementsPackage(compileInput()); if (!result.ok) throw new Error("compile failed");
    const relations = new Set(result.package.traceabilityGraph.edges.map((item) => item.relation));
    expect(relations.has("derived_from")).toBe(true);
    expect(relations.has("lowers_to")).toBe(true);
    expect(relations.has("verified_by")).toBe(true);
  });

  it("emits exact revision diffs and downstream invalidation", () => {
    const first = compileRequirementsPackage(compileInput()); if (!first.ok) throw new Error("compile failed");
    const artifact = source({ sourceVersion: "2", content: "Trace width shall be at least 0.25 mm." });
    const changed = candidate(artifact, { typedPredicate: { form: "minimum", value: { dimension: "length", value: "0.25", unit: "mm" } } });
    const dependency = { artifactId: "pcb:candidate:1", dependencyKeys: [`requirement:${first.package.requirements[0].requirementId}`] };
    const second = compileRequirementsPackage(compileInput(artifact, [changed], { previousPackage: first.package, downstreamArtifactRefs: [dependency] })); if (!second.ok) throw new Error("compile failed");
    expect(second.package.requirements[0].revision).toBe(2);
    expect(second.semanticDiff.requirementChanges[0].fields).toContain("typedPredicate");
    expect(second.semanticDiff.invalidatedDownstreamArtifactIds).toEqual(["pcb:candidate:1"]);
  });

  it("rejects a selected capability profile that is not pinned", () => {
    const result = compileRequirementsPackage(compileInput(undefined, undefined, { selectedCapabilityProfileRefs: ["fictional@1"] } as never));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.some((item) => item.code === "SELECTED_CAPABILITY_PROFILE_NOT_PINNED")).toBe(true);
  });

  it("uses stable requirement identity independent of current wording", () => {
    const artifact = source(); const first = compileRequirementsPackage(compileInput(artifact)); if (!first.ok) throw new Error("compile failed");
    const revised = source({ sourceVersion: "2", content: "The default class needs traces no narrower than 0.20 mm." });
    const second = compileRequirementsPackage(compileInput(revised, [candidate(revised)], { previousPackage: first.package })); if (!second.ok) throw new Error("compile failed");
    expect(second.package.requirements[0].requirementId).toBe(first.package.requirements[0].requirementId);
    expect(second.package.requirements[0].lineage.previousRevisionId).toBe(`${first.package.requirements[0].requirementId}@1`);
  });
});
