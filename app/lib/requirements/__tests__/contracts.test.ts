import { describe, expect, it } from "vitest";
import { compareQuantities, quantityKey } from "@/app/lib/constraints/quantity";
import { assessRequirementCapability, EMBEDDED_LOW_VOLTAGE_PROFILE_V1 } from "../capability";
import { compileRequirementsPackage } from "../compiler";
import { detectRequirementConflicts } from "../diagnostics";
import { requirementsDigest } from "../stable";
import type { AppliedDefault, Assumption, Hypothesis } from "../types";
import { candidate, compileInput, source } from "./fixtures";

describe("CD-1 contract properties", () => {
  it("normalizes equivalent units exactly", () => {
    const mm = { dimension: "length" as const, value: "0.2", unit: "mm" };
    const um = { dimension: "length" as const, value: "200", unit: "um" };
    expect(compareQuantities(mm, um)).toBe(0);
    expect(quantityKey(mm)).toBe(quantityKey(um));
  });

  it("rejects scientific notation instead of rounding it", () => {
    expect(() => quantityKey({ dimension: "voltage", value: "1e3", unit: "mV" })).toThrow("Invalid deterministic decimal");
  });

  it("keeps unknown, hypothesis, assumption, default, and requirement separate", () => {
    const hypothesis: Hypothesis = { hypothesisId: "h", statement: "Maybe 3.3 V", proposedBy: "model", confidence: 0.4, sourceRefs: [], relatedRequirementIds: [], status: "proposed" };
    const assumption: Assumption = { assumptionId: "a", revision: 1, statement: "Use 3.3 V temporarily", reasonNeeded: "exploration", proposedBy: "owner", proposedByKind: "human", owner: "owner", sourceRefs: [], scope: ["logic"], riskClass: "low", confidence: 0.7, status: "awaiting_confirmation", approvalPolicy: "low-risk", approvals: [], affectedRequirementIds: [], affectedDecisionRefs: [], invalidationDependencies: [] };
    const appliedDefault: AppliedDefault = { defaultId: "d", sourceProfileRevision: "org@1", targetField: "prototype_quantity", value: { kind: "integer", value: "5" }, rationale: "Organization prototype policy", authority: "organizational_policy", overridePolicy: "allowed", status: "applied" };
    const result = compileRequirementsPackage(compileInput(undefined, undefined, { hypotheses: [hypothesis], assumptions: [assumption], defaultsApplied: [appliedDefault] } as never)); if (!result.ok) throw new Error("compile failed");
    expect(result.package.hypotheses[0].status).toBe("proposed");
    expect(result.package.assumptions[0].status).toBe("awaiting_confirmation");
    expect(result.package.defaultsApplied[0].authority).toBe("organizational_policy");
    expect(result.package.requirements[0].status).toBe("proposed");
  });

  it("keeps typical/absolute semantics out of a generic numeric predicate", () => {
    const digestA = requirementsDigest({ semantic: "typical", value: { dimension: "voltage", value: "3.3", unit: "V" } });
    const digestB = requirementsDigest({ semantic: "absolute_maximum", value: { dimension: "voltage", value: "3.3", unit: "V" } });
    expect(digestA).not.toBe(digestB);
  });

  it("reports exact equality contradictions", () => {
    const artifact = source({ content: "Mode is A. Mode is B." });
    const a = candidate(artifact, { candidateId: "a", lineageKey: "a", typedPredicate: { form: "equals", value: "A" }, subjectRefsOrRoles: ["mode"] });
    const b = candidate(artifact, { candidateId: "b", lineageKey: "b", typedPredicate: { form: "equals", value: "B" }, subjectRefsOrRoles: ["mode"] });
    const compiled = compileRequirementsPackage(compileInput(artifact, [a, b])); if (!compiled.ok) throw new Error("compile failed");
    expect(detectRequirementConflicts(compiled.package.requirements).some((item) => item.conflictKind === "direct_predicate_contradiction")).toBe(true);
  });

  it("reports an empty allowed set after forbiddance", () => {
    const artifact = source({ content: "Only A is allowed. A is forbidden." });
    const allowed = candidate(artifact, { candidateId: "allowed", lineageKey: "allowed", typedPredicate: { form: "allowed_set", values: ["A"] }, subjectRefsOrRoles: ["mode"] });
    const forbidden = candidate(artifact, { candidateId: "forbidden", lineageKey: "forbidden", typedPredicate: { form: "forbidden_set", values: ["A"] }, subjectRefsOrRoles: ["mode"] });
    const compiled = compileRequirementsPackage(compileInput(artifact, [allowed, forbidden])); if (!compiled.ok) throw new Error("compile failed");
    expect(compiled.package.conflicts.some((item) => item.conflictKind === "allowed_forbidden_set")).toBe(true);
  });

  it("requires external review rather than internal certification", () => {
    const artifact = source({ content: "Certification to Standard X:2026 is required." });
    const item = candidate(artifact, { proposedDomain: "safety_isolation_compliance", proposedKind: "external_approval_certification", typedPredicate: { form: "external_evidence", authority: "Accredited lab", evidenceType: "certificate", standardRef: "Standard X:2026" }, subjectRefsOrRoles: ["product"], capabilityDemandIds: ["external-compliance"] });
    const compiled = compileRequirementsPackage(compileInput(artifact, [item])); if (!compiled.ok) throw new Error("compile failed");
    expect(compiled.package.requirements[0].capabilityAssessment.state).toBe("external_review_required");
    expect(compiled.package.verificationObligations[0].verificationMethod).toBe("external_laboratory_certification");
    expect(compiled.package.verificationObligations[0].status).toBe("planned");
  });

  it("does not silently deactivate unknown hard applicability", () => {
    const artifact = source(); const item = candidate(artifact, { applicabilityCondition: { kind: "fact_equals", factId: "variant", value: "pro" } });
    const compiled = compileRequirementsPackage(compileInput(artifact, [item])); if (!compiled.ok) throw new Error("compile failed");
    expect(compiled.package.requirements[0].applicabilityCondition).toEqual(item.applicabilityCondition);
    expect(compiled.package.coverageReport.rows[0].currentEvidenceState).toBe("planned");
  });

  it("assesses unknown capability demands explicitly", () => {
    const artifact = source(); const item = candidate(artifact, { capabilityDemandIds: ["future-quantum-interface"] });
    const compiled = compileRequirementsPackage(compileInput(artifact, [item])); if (!compiled.ok) throw new Error("compile failed");
    expect(compiled.package.requirements[0].capabilityAssessment.state).toBe("unknown_not_assessed");
    expect(compiled.package.qualityDiagnostics.some((diagnostic) => diagnostic.code === "CAPABILITY_NOT_ASSESSED")).toBe(true);
  });

  it("does not hide an unknown demand behind one known capability", () => {
    const artifact = source(); const item = candidate(artifact, { capabilityDemandIds: ["pcb-2-4-layer", "future-quantum-interface"] });
    const compiled = compileRequirementsPackage(compileInput(artifact, [item])); if (!compiled.ok) throw new Error("compile failed");
    expect(compiled.package.requirements[0].capabilityAssessment).toMatchObject({ state: "unknown_not_assessed", capabilityId: "future-quantum-interface" });
  });

  it("blocks publication on a global invalid assumption diagnostic", () => {
    const artifact = source(); const item = candidate(artifact, { requestedStatus: "confirmed" });
    const invalid: Assumption = { assumptionId: "a:invalid", revision: 1, statement: "Temporary premise", reasonNeeded: "exploration", proposedBy: "owner", proposedByKind: "human", owner: "", sourceRefs: [], scope: [], riskClass: "low", confidence: 0.5, status: "awaiting_confirmation", approvalPolicy: "low-risk", approvals: [], affectedRequirementIds: [], affectedDecisionRefs: [], invalidationDependencies: [] };
    const pre = compileRequirementsPackage(compileInput(artifact, [item], { assumptions: [invalid] }));
    expect(pre.ok).toBe(true);
    if (pre.ok) expect(pre.package.status).toBe("awaiting_clarification");
  });

  it("rejects a tampered previous package before diffing", () => {
    const first = compileRequirementsPackage(compileInput()); if (!first.ok) throw new Error("compile failed");
    const tampered = structuredClone(first.package); tampered.title = "tampered";
    const second = compileRequirementsPackage(compileInput(undefined, undefined, { previousPackage: tampered } as never));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.diagnostics.some((item) => item.code === "PREVIOUS_PACKAGE_INTEGRITY_FAILED")).toBe(true);
  });

  it("makes profile assessment deterministic", () => {
    const compiled = compileRequirementsPackage(compileInput()); if (!compiled.ok) throw new Error("compile failed");
    const requirement = compiled.package.requirements[0];
    expect(assessRequirementCapability(requirement, [EMBEDDED_LOW_VOLTAGE_PROFILE_V1], ["embedded-low-voltage-v1@1.0.0"])).toEqual(requirement.capabilityAssessment);
  });
});
