import { describe, expect, it } from "vitest";
import { createSchematicProjectState } from "../../schematic-compiler/project";
import { HUMAN, validProblem, validSignoff } from "../../schematic-compiler/__tests__/fixtures";
import { createCd9UpstreamCompletionSignoff, defaultCircuitVerificationCapabilityProfile } from "../capability";
import { compileCircuitVerificationProblem } from "../problem";
import { createFoundationalRuleRegistry, validateRuleRegistry } from "../registry";
import { NOW, approvedSchematicState, verificationFixture } from "./fixtures";

describe("CD-9 prerequisite gate and rule denominator", () => {
  it("blocks an unapproved CD-8 project", () => {
    const schematicProject = createSchematicProjectState({ projectId: "project:test", branchId: "branch:test", upstreamSignoff: validSignoff(), problem: validProblem() });
    const registry = createFoundationalRuleRegistry({ reviewer: HUMAN, reviewedAt: NOW });
    const signoff = createCd9UpstreamCompletionSignoff({ cd1Verdict: "CD-1 COMPLETE", cd2Verdict: "CD-2 COMPLETE", cd3Verdict: "CD-3 COMPLETE", cd4Verdict: "CD-4 COMPLETE", cd5Verdict: "CD-5 COMPLETE", cd6Verdict: "CD-6 COMPLETE", cd7Verdict: "CD-7 COMPLETE", cd8Verdict: "CD-8 COMPLETE", stageDigests: ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => ({ stage: `CD-${n}` as `CD-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`, stateDigest: `state:${n}`, decisionDigest: `decision:${n}` })), approvedSchematicCandidateId: "missing", approvedSchematicCandidateDigest: "missing", semanticGraphDigest: "missing", roundTripCertificateDigest: "missing", approver: HUMAN, approvedAt: NOW });
    const result = compileCircuitVerificationProblem({ tenantId: "tenant:test", branchId: "branch:test", schematicProject, upstreamSignoff: signoff, capabilityProfile: defaultCircuitVerificationCapabilityProfile(), registry, requirementRevisionRefs: [], requiredContextKinds: ["static_unpowered"], actor: HUMAN, createdAt: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((item) => item.code)).toContain("CD9_CD8_APPROVED_HANDOFF_MISSING");
  });

  it("keeps the foundational registry draft until a human reviewer approves it", () => {
    expect(createFoundationalRuleRegistry().lifecycleState).toBe("draft");
    const registry = createFoundationalRuleRegistry({ reviewer: HUMAN, reviewedAt: NOW });
    expect(registry.lifecycleState).toBe("approved");
    expect(validateRuleRegistry(registry)).toEqual([]);
  });

  it("accepts an exact approved CD-8 handoff", () => {
    const fixture = verificationFixture();
    expect(fixture.problem.lifecycleState).toBe("ready_for_verification");
    expect(fixture.problem.semanticGraphDigest).toBe(fixture.graph.deterministicDigest);
  });

  it("counts every approved rule in every required context without vacuous success", () => {
    const fixture = verificationFixture();
    expect(fixture.denominator.nonVacuous).toBe(true);
    expect(fixture.denominator.instances.length).toBeGreaterThanOrEqual(fixture.registry.rules.length * fixture.contexts.length);
    expect(fixture.denominator.applicability.some((item) => item.state === "not_applicable")).toBe(true);
    expect(fixture.denominator.categoryCoverage.some((item) => item.state !== "covered")).toBe(true);
  });

  it("rejects a tampered approved registry", () => {
    const registry = createFoundationalRuleRegistry({ reviewer: HUMAN, reviewedAt: NOW });
    registry.rules[0].title = "tampered";
    expect(validateRuleRegistry(registry).some((item) => item.includes("DIGEST_MISMATCH"))).toBe(true);
  });

  it("preserves the protected approved CD-8 state as input only", () => {
    const state = approvedSchematicState(), before = state.deterministicDigest;
    verificationFixture();
    expect(state.deterministicDigest).toBe(before);
  });
});
