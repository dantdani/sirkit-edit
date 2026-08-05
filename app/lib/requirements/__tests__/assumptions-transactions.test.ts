import { describe, expect, it } from "vitest";
import { invalidationKeysForAssumption, transitionAssumption, validateAssumption } from "../assumptions";
import { compileRequirementsPackage } from "../compiler";
import { migrateLegacyIntent } from "../migration";
import { createRequirementsTransaction, RequirementsTransactionService, validateRequirementsTransaction } from "../transactions";
import type { Assumption } from "../types";
import { candidate, compileInput, NOW, packageApproval, source } from "./fixtures";

function assumption(requirementId: string, overrides: Partial<Assumption> = {}): Assumption {
  return { assumptionId: "assumption:input-max", revision: 1, statement: "Input never exceeds 16 V.", reasonNeeded: "Protection selection needs a maximum.", proposedBy: "model", proposedByKind: "ai", owner: "owner", sourceRefs: [], scope: ["power input"], riskClass: "high", confidence: 0.6, status: "awaiting_confirmation", approvalPolicy: "authorized-human-high-risk-v1", approvals: [], affectedRequirementIds: [requirementId], affectedDecisionRefs: ["cd3:power-tree"], expiryConditionOrDate: "Expires when an authorized input specification is attached.", invalidationDependencies: ["cd6:parts", "cd7:corners"], ...overrides };
}

const PROJECT_REVISION = { schemaVersion: "sirkit.project-revision.v1" as const, projectId: "project:test", branchId: "main", headSequence: 0, headTransactionId: "genesis", canonicalStateDigest: "eng1-test", domainRevisions: { schematic: "1", electricalIntent: "1", componentBindings: "1", boardGeometry: "1", copperTopology: "1", zonesAndFill: "1", stackup: "1", constraints: "1", protectedState: "1", waivers: "1", assets: "1" } };

describe("CD-1 assumption ledger and Stage-10-compatible transactions", () => {
  it("requires high risk for supply assumptions", () => {
    const artifact = source({ content: "Input voltage maximum is not specified." });
    const item = candidate(artifact, { proposedDomain: "electrical_supply_load", subjectRefsOrRoles: ["power_source"], capabilityDemandIds: ["regulated-dc-power"] });
    const compiled = compileRequirementsPackage(compileInput(artifact, [item])); if (!compiled.ok) throw new Error("compile failed");
    const entry = assumption(compiled.package.requirements[0].requirementId, { riskClass: "low" });
    expect(validateAssumption(entry, compiled.package.requirements).some((diagnostic) => diagnostic.code === "ASSUMPTION_RISK_UNDERCLASSIFIED")).toBe(true);
  });

  it("forbids AI self-approval and accepts authorized human confirmation", () => {
    const entry = assumption("requirement:x", { status: "accepted_for_exploration" });
    expect(validateAssumption(entry, []).some((diagnostic) => diagnostic.code === "AI_ASSUMPTION_SELF_APPROVAL")).toBe(true);
    const approval = { approvalId: "approval:a", actorId: "owner", actorKind: "human" as const, reviewerRole: "project_admin", scope: "assumption" as const, targetId: entry.assumptionId, targetRevision: 1, decision: "approved" as const, createdAt: NOW };
    const accepted = transitionAssumption({ assumption: { ...entry, status: "awaiting_confirmation" }, action: "accept", approval });
    expect(accepted.status).toBe("accepted_for_exploration");
    expect(accepted.revision).toBe(2);
  });

  it("preserves exact downstream invalidation dependencies", () => {
    const keys = invalidationKeysForAssumption(assumption("requirement:x"));
    expect(keys).toEqual(["cd6:parts", "cd7:corners", "decision:cd3:power-tree", "requirement:requirement:x"]);
  });

  it("blocks an accepted assumption after its dated expiry", () => {
    const approval = { approvalId: "approval:expired", actorId: "owner", actorKind: "human" as const, reviewerRole: "project_admin", scope: "assumption" as const, targetId: "assumption:input-max", targetRevision: 1, decision: "approved" as const, createdAt: "2026-07-16T00:00:00.000Z" };
    const expired = assumption("requirement:x", { status: "accepted_for_exploration", approvals: [approval], expiryConditionOrDate: "2026-07-17T00:00:00.000Z" });
    expect(validateAssumption(expired, [], NOW).some((item) => item.code === "ASSUMPTION_EXPIRED")).toBe(true);
  });

  it("rejects AI approval operations at the transaction boundary", () => {
    const artifact = source(); const item = candidate(artifact); const compiled = compileRequirementsPackage(compileInput(artifact, [item])); if (!compiled.ok) throw new Error("compile failed");
    const transaction = createRequirementsTransaction({ transactionId: "tx:ai-approve", projectId: artifact.projectId, branchId: "main", basePackageRevision: compiled.package.revision, basePackageDigest: compiled.package.deterministicDigest, baseProjectRevision: PROJECT_REVISION, actor: { actorId: "model", actorKind: "ai", sessionId: "s", role: "automation" }, reason: "Attempt approval", operations: [{ kind: "approve_package", approval: { ...packageApproval(), actorId: "model", actorKind: "ai" } }], approvals: [], provenance: { source: "ai", sourceRefIds: [] }, createdAt: NOW });
    expect(validateRequirementsTransaction(transaction)).toEqual(expect.arrayContaining(["AI_REQUIREMENTS_OPERATION_FORBIDDEN", "AI_APPROVAL_FORBIDDEN"]));
  });

  it("atomically adds a proposed candidate and recompiles a new revision", () => {
    const artifact = source({ content: "Trace width shall be at least 0.20 mm. Clearance shall be at least 0.15 mm." });
    const firstCandidate = candidate(artifact, { sourceSpan: { spanStartEnd: { start: 0, end: 39 } } });
    const input = compileInput(artifact, [firstCandidate]); const compiled = compileRequirementsPackage(input); if (!compiled.ok) throw new Error("compile failed");
    const added = candidate(artifact, { candidateId: "candidate:clearance", lineageKey: "clearance-main", title: "Minimum clearance", candidateStatement: "Clearance shall be at least 0.15 mm.", sourceSpan: { spanStartEnd: { start: 40, end: artifact.normalizedContent.length } }, subjectRefsOrRoles: ["pcb.clearance:net-class:default"], typedPredicate: { form: "minimum", value: { dimension: "length", value: "0.15", unit: "mm" } } });
    const service = new RequirementsTransactionService(input, compiled.package);
    const transaction = createRequirementsTransaction({ transactionId: "tx:add", projectId: artifact.projectId, branchId: "main", basePackageRevision: compiled.package.revision, basePackageDigest: compiled.package.deterministicDigest, baseProjectRevision: PROJECT_REVISION, actor: { actorId: "owner", actorKind: "human", sessionId: "s", role: "project_admin" }, reason: "Add clearance requirement", operations: [{ kind: "add_requirement_candidate", candidate: added }], approvals: [], provenance: { source: "ui", sourceRefIds: [`${artifact.sourceId}@${artifact.sourceVersion}`] }, createdAt: NOW });
    const outcome = service.submit(transaction);
    expect(outcome.state).toBe("accepted");
    if (outcome.state === "accepted") { expect(outcome.package.revision).toBe(2); expect(outcome.package.requirements).toHaveLength(2); expect(outcome.record.invalidatedDependencyKeys).toContain(`requirements-package:${compiled.package.packageId}`); }
  });

  it("produces semantic conflicts instead of last-writer-wins", () => {
    const artifact = source(); const input = compileInput(artifact); const compiled = compileRequirementsPackage(input); if (!compiled.ok) throw new Error("compile failed");
    const service = new RequirementsTransactionService(input, compiled.package);
    const common = { projectId: artifact.projectId, branchId: "main", basePackageRevision: compiled.package.revision, basePackageDigest: compiled.package.deterministicDigest, baseProjectRevision: PROJECT_REVISION, actor: { actorId: "owner", actorKind: "human" as const, sessionId: "s", role: "project_admin" as const }, approvals: [], provenance: { source: "ui" as const, sourceRefIds: [] }, createdAt: NOW };
    const first = createRequirementsTransaction({ ...common, transactionId: "tx:first", reason: "Select profile", operations: [{ kind: "select_capability_profile", profileRef: "embedded-low-voltage-v1@1.0.0" }] });
    // The first operation is semantically a no-op selection but still creates a package revision.
    expect(service.submit(first).state).toBe("accepted");
    const second = createRequirementsTransaction({ ...common, transactionId: "tx:second", reason: "Concurrent profile change", operations: [{ kind: "select_capability_profile", profileRef: "another-pack@1" }] });
    const outcome = service.submit(second);
    expect(outcome.state).toBe("conflict");
    if (outcome.state === "conflict") expect(outcome.conflict.involvedIds).toContain("capability-profile-selection");
  });

  it("rejects unsafe high-level resolutions without a structured requirement patch", () => {
    const artifact = source(); const input = compileInput(artifact); const compiled = compileRequirementsPackage(input); if (!compiled.ok) throw new Error("compile failed");
    const service = new RequirementsTransactionService(input, compiled.package);
    const transaction = createRequirementsTransaction({ transactionId: "tx:resolve", projectId: artifact.projectId, branchId: "main", basePackageRevision: compiled.package.revision, basePackageDigest: compiled.package.deterministicDigest, baseProjectRevision: PROJECT_REVISION, actor: { actorId: "owner", actorKind: "human", sessionId: "s", role: "project_admin" }, reason: "Resolve without patch", operations: [{ kind: "resolve_conflict", conflictId: "conflict:x", reason: "choose one" }], approvals: [], provenance: { source: "ui", sourceRefIds: [] }, createdAt: NOW });
    const outcome = service.submit(transaction);
    expect(outcome.state).toBe("rejected");
    if (outcome.state === "rejected") expect(outcome.diagnostics).toContain("OPERATION_REQUIRES_STRUCTURED_REQUIREMENT_PATCH");
  });

  it("migrates legacy prose as proposed and reports orphan constraints", () => {
    const result = migrateLegacyIntent({ projectId: "legacy", projectName: "Old board", description: "A low power controller", existingConstraintDocuments: [{ schemaVersion: 1, id: "constraints", revision: 1, name: "Legacy", extendsSetIds: [], relationships: [], constraints: [{ id: "c1", revision: 1, name: "Width", domain: "routing", kind: "trace_width", scope: { type: "project", id: "legacy" }, selector: { objectType: "net", predicate: { kind: "all" }, cardinality: { kind: "zero_or_more" } }, requirement: { form: "minimum", value: { dimension: "length", value: "0.2", unit: "mm" } }, strength: "hard", severityPolicyId: "default", origin: { kind: "legacy_import", sourceId: "legacy", sourceRevision: "1" }, evidenceIds: [], lifecycle: { state: "active" }, waiverPolicy: { eligible: false } }] }], sourceCapturedAt: NOW, actorId: "migration" });
    expect(result.extractionEnvelopes[0].candidates[0].requestedStatus).toBe("proposed");
    expect(result.orphanConstraintIds).toEqual(["c1"]);
    expect(result.diagnostics[0].code).toBe("LEGACY_ORPHAN_CONSTRAINTS");
  });
});
