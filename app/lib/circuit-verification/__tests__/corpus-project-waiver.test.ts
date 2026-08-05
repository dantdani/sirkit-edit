import { describe, expect, it } from "vitest";
import { appendCircuitVerificationArtifact, createCircuitVerificationProjectState, validateCircuitVerificationProjectState } from "../project";
import { CD9_CORPUS_MANIFEST, CD9_CORPUS_MANIFEST_DIGEST } from "../corpus";
import { verificationDigest } from "../stable";
import { createCircuitWaiver } from "../waiver";
import { normalizeVerificationRemediationProposal } from "../agent-tools";
import { runFullCircuitOracle } from "../oracle";
import { evaluateCircuitReadiness } from "../readiness";
import { HUMAN } from "../../schematic-compiler/__tests__/fixtures";
import { NOW, verificationFixture } from "./fixtures";

describe("CD-9 corpus, project integrity, and waiver policy", () => {
  it("registers all 94 required classes without pretending metadata is evidence", () => {
    expect(CD9_CORPUS_MANIFEST).toHaveLength(94);
    expect(CD9_CORPUS_MANIFEST.every((item) => item.implementationState === "manifest_only")).toBe(true);
    expect(CD9_CORPUS_MANIFEST.every((item) => item.immutableManifestHash === verificationDigest({ ...item, immutableManifestHash: undefined }))).toBe(true);
    expect(CD9_CORPUS_MANIFEST_DIGEST).toBe(verificationDigest(CD9_CORPUS_MANIFEST));
  });

  it("creates an integrity checked project pinned to graph, profile, and registry", () => {
    const fixture = verificationFixture(), state = createCircuitVerificationProjectState({ projectId: fixture.problem.projectId, branchId: fixture.problem.branchId, problem: fixture.problem, capabilityProfile: fixture.capabilityProfile, registry: fixture.registry });
    expect(validateCircuitVerificationProjectState(state)).toEqual([]);
  });

  it("persists a complete append-only verification evidence sequence", () => {
    const fixture = verificationFixture(), run = runFullCircuitOracle({ ...fixture, startedAt: NOW }), readiness = evaluateCircuitReadiness({ problem: fixture.problem, graphDigest: fixture.graph.deterministicDigest, registry: fixture.registry, capabilityProfile: fixture.capabilityProfile, denominator: fixture.denominator, fullRun: run, now: NOW });
    let state = createCircuitVerificationProjectState({ projectId: fixture.problem.projectId, branchId: fixture.problem.branchId, problem: fixture.problem, capabilityProfile: fixture.capabilityProfile, registry: fixture.registry });
    state = appendCircuitVerificationArtifact({ state, operation: "set_contexts", artifact: fixture.contexts, actor: HUMAN, createdAt: NOW });
    state = appendCircuitVerificationArtifact({ state, operation: "add_denominator", artifact: fixture.denominator, actor: HUMAN, createdAt: NOW });
    state = appendCircuitVerificationArtifact({ state, operation: "add_full_run", artifact: run, actor: HUMAN, createdAt: NOW });
    state = appendCircuitVerificationArtifact({ state, operation: "add_readiness", artifact: readiness, actor: HUMAN, createdAt: NOW });
    expect(state.transactionRecords).toHaveLength(4);
    expect(validateCircuitVerificationProjectState(state)).toEqual([]);
  });

  it("requires independent human authorization for waivers", () => {
    const fixture = verificationFixture([{ requirementId: "requirement:waiver", revisionDigest: "req:waiver", safetyCritical: false }]);
    const run = runFullCircuitOracle({ ...fixture, startedAt: NOW });
    const finding = run.findings.find((item) => item.engineeringResult === "unknown");
    expect(finding).toBeDefined();
    expect(() => createCircuitWaiver({ findings: finding ? [finding] : [], run, registry: fixture.registry, justification: "This is a sufficiently detailed justification.", riskStatement: "This is a sufficiently detailed risk statement.", requestedBy: HUMAN, approvedBy: HUMAN, createdAt: NOW, expiresAt: "2026-08-18T16:00:00.000Z" })).toThrow("CD9_WAIVER_INDEPENDENT_HUMAN_APPROVAL_REQUIRED");
  });

  it("never waives unknown evidence", () => {
    const fixture = verificationFixture([{ requirementId: "requirement:unknown", revisionDigest: "req:unknown", safetyCritical: false }]), run = runFullCircuitOracle({ ...fixture, startedAt: NOW }), finding = run.findings.find((item) => item.engineeringResult === "unknown");
    const approver = { ...HUMAN, actorId: "user:independent-reviewer", sessionId: "session:independent" };
    expect(() => createCircuitWaiver({ findings: finding ? [finding] : [], run, registry: fixture.registry, justification: "This is a sufficiently detailed justification.", riskStatement: "This is a sufficiently detailed risk statement.", requestedBy: HUMAN, approvedBy: approver, createdAt: NOW, expiresAt: "2026-08-18T16:00:00.000Z" })).toThrow(/CD9_FINDING_NON_WAIVABLE/);
  });

  it("keeps AI remediation proposal-only and constrained to known semantic anchors", () => {
    const fixture = verificationFixture([{ requirementId: "requirement:ai", revisionDigest: "req:ai", safetyCritical: false }]), run = runFullCircuitOracle({ ...fixture, startedAt: NOW }), finding = run.findings[0];
    const proposal = normalizeVerificationRemediationProposal({ raw: { findingStableIdentities: [finding.stableIdentity], summary: "Inspect the missing requirement evidence.", proposedActions: [{ actionId: "inspect:1", kind: "inspect_evidence", targetIds: finding.semanticAnchorIds, rationale: "The deterministic result is unknown until evidence is attached." }] }, run, actor: { actorId: "ai:test", actorKind: "ai", sessionId: "ai:test", role: "automation" } });
    expect(proposal.authority).toBe("proposal_only_no_design_or_verdict_mutation");
    expect(proposal.status).toBe("draft");
  });
});
