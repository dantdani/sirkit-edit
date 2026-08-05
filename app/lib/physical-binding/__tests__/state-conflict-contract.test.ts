import { describe, expect, it } from "vitest";
import { detectSelectedVariantConflicts, variantScopesOverlap } from "../conflicts";
import { evaluatePhysicalReadiness } from "../readiness";
import { physicalBindingDigest, withBindingDigests, withoutBindingDigests } from "../stable";
import { applyPhysicalBindingTransition } from "../transitions";
import { validatePhysicalBinding } from "../validation";
import { ACTOR, AI_ACTOR, exactCandidate, NOW, scope, transition } from "./fixtures";

describe("state-axis, variant-conflict, and Stage 2 contracts", () => {
  it("keeps approval and technical validity independent", () => {
    const base = exactCandidate("independent-states");
    const approvedInvalid = withBindingDigests({ ...withoutBindingDigests(base), approval: { state: "approved", contentDigest: base.technicalDigest }, technicalValidation: { state: "invalid", validatedDigest: base.technicalDigest, validatorVersion: "v1", evidenceRefs: [], reasonCodes: ["FAILED"] } });
    const reportA = evaluatePhysicalReadiness(approvedInvalid, { assessedAt: NOW, effectiveSelectedRevisionId: approvedInvalid.revisionId });
    expect(reportA.gates.find((gate) => gate.code === "PB_APPROVAL")?.status).toBe("pass");
    expect(reportA.gates.find((gate) => gate.code === "PB_TECHNICAL_VALIDATION")?.status).toBe("fail");
    const validUnapproved = withBindingDigests({ ...withoutBindingDigests(base), technicalValidation: { state: "valid", validatedDigest: base.technicalDigest, validatorVersion: "v1", evidenceRefs: ["evidence-mapping"], reasonCodes: [] }, approval: { state: "unreviewed" } });
    const reportB = evaluatePhysicalReadiness(validUnapproved, { assessedAt: NOW, effectiveSelectedRevisionId: validUnapproved.revisionId });
    expect(reportB.gates.find((gate) => gate.code === "PB_TECHNICAL_VALIDATION")?.status).toBe("pass");
    expect(reportB.gates.find((gate) => gate.code === "PB_APPROVAL")?.status).toBe("pending");
  });

  it("reports not-applicable separately instead of calling DNP footprint-ready", () => {
    const base = exactCandidate("dnp-component");
    const dnp = withBindingDigests({ ...withoutBindingDigests(base), applicabilityState: "not_applicable", classification: { ...base.classification, populationKind: "dnp" } });
    const report = evaluatePhysicalReadiness(dnp, { assessedAt: NOW });
    expect(report.layout).toBe("not_applicable");
    expect(report.manufacturing).toBe("not_applicable");
  });

  it("detects overlapping selected assembly-variant scopes without conflating separate components", () => {
    const left = exactCandidate("variant-component");
    const rightBase = exactCandidate("variant-component", { candidateKeySuffix: "alternate" });
    const right = withBindingDigests({ ...withoutBindingDigests(rightBase), scope: scope("variant-component", ["variant-default", "variant-industrial"]), componentIdentity: { ...rightBase.componentIdentity } });
    const selectedLeft = withBindingDigests({ ...withoutBindingDigests(left), lifecycleState: "selected" });
    const selectedRight = withBindingDigests({ ...withoutBindingDigests(right), lifecycleState: "selected" });
    expect(variantScopesOverlap(selectedLeft.scope, selectedRight.scope)).toBe(true);
    expect(detectSelectedVariantConflicts(selectedLeft, [selectedRight])).toEqual({ state: "present", conflictIds: [selectedRight.revisionId], reasonCodes: ["PB_OVERLAPPING_VARIANT_SELECTION"] });
    expect(variantScopesOverlap(selectedLeft.scope, scope("another-component"))).toBe(false);
  });

  it("rejects illegal lifecycle transitions and AI approval without partial mutation", () => {
    const base = exactCandidate("illegal-transition");
    const before = physicalBindingDigest(base);
    expect(() => applyPhysicalBindingTransition(base, transition(base, 1, "approve", AI_ACTOR))).toThrow("PB_TRANSITION_HUMAN_REQUIRED");
    expect(() => applyPhysicalBindingTransition(base, transition(base, 1, "submit_candidate", ACTOR))).toThrow("PB_TRANSITION_ILLEGAL");
    expect(physicalBindingDigest(base)).toBe(before);
  });

  it("makes display/origin changes irrelevant to technical identity while material footprint changes perturb it", () => {
    const base = exactCandidate("digest-contract");
    const changedOrigin = withBindingDigests({ ...withoutBindingDigests(base), origin: { ...base.origin, sourceRef: "different-display-source" } });
    expect(changedOrigin.technicalDigest).toBe(base.technicalDigest);
    const changedFootprint = withBindingDigests({ ...withoutBindingDigests(base), footprint: { ...base.footprint!, contentDigest: `sha256:${"9".repeat(64)}` } });
    expect(changedFootprint.technicalDigest).not.toBe(base.technicalDigest);
  });

  it("detects missing or tampered approval evidence when persisted bindings are validated", () => {
    const base = exactCandidate("approval-evidence-validation");
    const selected = withBindingDigests({ ...withoutBindingDigests(base), lifecycleState: "selected" });
    const approve = transition(selected, 1, "approve");
    approve.decisionEvidenceRefs = ["evidence-datasheet"];
    const approved = applyPhysicalBindingTransition(selected, approve);
    expect(validatePhysicalBinding(approved).filter((issue) => issue.code.startsWith("PB_DECISION_EVIDENCE"))).toEqual([]);
    const missing = withBindingDigests({ ...withoutBindingDigests(approved), approval: { ...approved.approval, decisionEvidenceRefs: undefined } });
    expect(validatePhysicalBinding(missing).map((issue) => issue.code)).toContain("PB_DECISION_EVIDENCE_REQUIRED");
    const tampered = withBindingDigests({ ...withoutBindingDigests(approved), approval: { ...approved.approval, decisionEvidenceRefs: ["evidence-not-in-snapshot"] } });
    expect(validatePhysicalBinding(tampered).map((issue) => issue.code)).toContain("PB_DECISION_EVIDENCE_NOT_FOUND");
  });
});
