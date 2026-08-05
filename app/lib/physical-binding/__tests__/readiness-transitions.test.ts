import { describe, expect, it } from "vitest";
import { createPhysicalBindingCandidate } from "../domain";
import { evaluatePhysicalReadiness, PHYSICAL_READINESS_GATE_CODES } from "../readiness";
import { InMemoryPhysicalBindingRepository, PhysicalBindingService } from "../repository";
import { physicalBindingDigest, withBindingDigests, withoutBindingDigests } from "../stable";
import { createApprovedValidation, physicalBindingTransitionRequestDigest } from "../transitions";
import { ACTOR, AI_ACTOR, exactCandidate, NOW, scope, transition } from "./fixtures";

function decision<T extends ReturnType<typeof transition>>(request: T, refs = ["evidence-datasheet"]): T {
  request.decisionEvidenceRefs = refs;
  return request;
}

async function makeReady(options: { manufacturingComplete?: boolean } = {}) {
  const repository = new InMemoryPhysicalBindingRepository();
  const service = new PhysicalBindingService(repository);
  const candidate = exactCandidate("component-ready", options);
  let state = await service.createCandidate(candidate, "create-ready");
  state = await service.transition(state.set.setId, decision(transition(candidate, state.set.revision, "select")));
  let current = state.bindings.find((item) => item.revisionId === state.set.effectiveSelectedRevisionId)!;
  const validate = transition(current, state.set.revision, "revalidate");
  validate.validation = createApprovedValidation(current, { validatorVersion: "physical-binding-validator/1", at: validate.at, evidenceRefs: ["evidence-mapping"] });
  state = await service.transition(state.set.setId, validate);
  current = state.bindings.find((item) => item.revisionId === state.set.effectiveSelectedRevisionId)!;
  state = await service.transition(state.set.setId, decision(transition(current, state.set.revision, "approve")));
  return { repository, service, state, binding: state.bindings.find((item) => item.revisionId === state.set.effectiveSelectedRevisionId)! };
}

describe("orthogonal state transitions and deterministic readiness", () => {
  it("reports every blocker for generic J1 without inventing pitch, orientation, package, or footprint", () => {
    const candidate = createPhysicalBindingCandidate({ scope: scope("connector-j1"), classification: { populationKind: "physical", deviceClass: "connector", mountingTechnology: "unknown", polarity: "unknown", classificationEvidenceRefs: [] }, origin: { kind: "human_selection", actor: ACTOR, sourceRef: "user:J1", createdAt: NOW, evidenceRefs: [] }, createdAt: NOW, createdBy: ACTOR, candidateKey: "j1-generic" });
    const report = evaluatePhysicalReadiness(candidate, { assessedAt: NOW });
    expect(report.layout).toBe("not_ready");
    expect(report.gates.filter((gate) => gate.blocking).map((gate) => gate.code)).toEqual(expect.arrayContaining(["PB_PACKAGE_IDENTITY", "PB_FOOTPRINT_ASSET", "PB_PIN_PAD_MAPPING", "PB_APPROVAL"]));
    expect(candidate.package).toBeUndefined();
    expect(candidate.footprint).toBeUndefined();
  });

  it("does not infer a capacitor package from 100n or accept matching counts as mapping proof", () => {
    const candidate = createPhysicalBindingCandidate({ scope: scope("capacitor-c1"), classification: { populationKind: "physical", deviceClass: "capacitor", mountingTechnology: "unknown", polarity: "unknown", classificationEvidenceRefs: [] }, origin: { kind: "ai_suggestion", actor: AI_ACTOR, sourceRef: "chat-1", createdAt: NOW, evidenceRefs: [] }, createdAt: NOW, createdBy: AI_ACTOR, candidateKey: "100n-generic" });
    expect(candidate.package).toBeUndefined();
    expect(candidate.pinPadMapping.state).toBe("missing");
    expect(evaluatePhysicalReadiness(candidate, { assessedAt: NOW }).gates.find((gate) => gate.code === "PB_PIN_PAD_MAPPING")?.status).toBe("unknown");
  });

  it("becomes layout-ready only after selection, technical validation, freshness, and digest-scoped approval", async () => {
    const { state, binding } = await makeReady();
    const report = evaluatePhysicalReadiness(binding, { assessedAt: "2026-07-18T13:00:00.000Z", effectiveSelectedRevisionId: state.set.effectiveSelectedRevisionId });
    expect(report.layout).toBe("ready");
    expect(report.manufacturing).toBe("not_ready");
    expect(report.gates.map((gate) => gate.code)).toEqual(PHYSICAL_READINESS_GATE_CODES);
    expect(report.gates.filter((gate) => gate.code === "PB_APPROVAL" || gate.code === "PB_TECHNICAL_VALIDATION").every((gate) => gate.status === "pass")).toBe(true);
    expect(report.claims.authorizesProductionRelease).toBe(false);
  });

  it("can report manufacturing-ready only with the stricter external and manufacturing evidence hooks", async () => {
    const { state, binding } = await makeReady({ manufacturingComplete: true });
    const report = evaluatePhysicalReadiness(binding, { assessedAt: "2026-07-18T13:00:00.000Z", effectiveSelectedRevisionId: state.set.effectiveSelectedRevisionId });
    expect(report.layout).toBe("ready");
    expect(report.manufacturing).toBe("ready");
    expect(report.claims).toEqual({ certifiesManufacturability: false, certifiesAvailability: false, authorizesProductionRelease: false, predictsFirstPassHardware: false });
  });

  it("enforces human approval, immutable successors, idempotency, and optimistic concurrency", async () => {
    const repository = new InMemoryPhysicalBindingRepository();
    const service = new PhysicalBindingService(repository);
    const candidate = exactCandidate("component-transition");
    let state = await service.createCandidate(candidate, "create-transition");
    await expect(service.transition(state.set.setId, decision(transition(candidate, state.set.revision, "select", AI_ACTOR)))).rejects.toThrow("PB_TRANSITION_HUMAN_REQUIRED");
    const request = decision(transition(candidate, state.set.revision, "select"));
    state = await service.transition(state.set.setId, request);
    expect(candidate.lifecycleState).toBe("candidate");
    expect(state.bindings[0]?.lifecycleState).toBe("selected");
    const duplicate = await service.transition(state.set.setId, request);
    expect(duplicate.set.recordDigest).toBe(state.set.recordDigest);
    const staleRequest = transition(state.bindings[0]!, 1, "request_approval");
    await expect(service.transition(state.set.setId, staleRequest)).rejects.toThrow("PB_OPTIMISTIC_LOCK_CONFLICT");
  });

  it("blocks a second effective selection and stales mapping plus prior approval after footprint dependency change", async () => {
    const ready = await makeReady();
    let state = await ready.service.createCandidate(exactCandidate("component-ready", { manufacturingComplete: true, candidateKeySuffix: "alternate" }), "second-candidate");
    const second = state.bindings.find((item) => item.bindingId !== ready.binding.bindingId)!;
    await expect(ready.service.transition(state.set.setId, decision(transition(second, state.set.revision, "select")))).rejects.toThrow("PB_ACTIVE_SELECTION_CONFLICT");
    const selected = state.bindings.find((item) => item.revisionId === state.set.effectiveSelectedRevisionId)!;
    const stale = transition(selected, state.set.revision, "mark_stale", { actorId: "catalog-monitor", actorKind: "automated_engine", sessionId: "monitor", role: "automation" });
    stale.staleDependencyIds = ["footprint"];
    state = await ready.service.transition(state.set.setId, stale);
    const successor = state.bindings.find((item) => item.revisionId === state.set.effectiveSelectedRevisionId)!;
    expect(successor.freshness.state).toBe("stale");
    expect(successor.pinPadMapping.state).toBe("stale");
    const report = evaluatePhysicalReadiness(successor, { assessedAt: stale.at, effectiveSelectedRevisionId: state.set.effectiveSelectedRevisionId });
    expect(report.layout).toBe("not_ready");
    expect(report.gates.find((gate) => gate.code === "PB_APPROVAL")?.status).toBe("fail");
  });

  it("blocks selected candidates stored in separately keyed but overlapping variant scopes", async () => {
    const repository = new InMemoryPhysicalBindingRepository();
    const service = new PhysicalBindingService(repository);
    const base = exactCandidate("variant-scope-service", { variants: ["base"], candidateKeySuffix: "base" });
    const baseState = await service.createCandidate(base, "create-base-scope");
    await service.transition(baseState.set.setId, decision(transition(base, baseState.set.revision, "select")));
    const overlap = exactCandidate("variant-scope-service", { variants: ["base", "industrial"], candidateKeySuffix: "overlap" });
    const overlapState = await service.createCandidate(overlap, "create-overlap-scope");
    await expect(service.transition(overlapState.set.setId, decision(transition(overlap, overlapState.set.revision, "select")))).rejects.toThrow("PB_OVERLAPPING_VARIANT_SELECTION");
  });

  it("requires real decision evidence and persists its normalized identity in approval and audit output", async () => {
    const repository = new InMemoryPhysicalBindingRepository();
    const service = new PhysicalBindingService(repository);
    const candidate = exactCandidate("decision-evidence");
    let state = await service.createCandidate(candidate, "create-decision-evidence");
    await expect(service.transition(state.set.setId, transition(candidate, state.set.revision, "select"))).rejects.toThrow("PB_DECISION_EVIDENCE_REQUIRED");
    await expect(service.transition(state.set.setId, decision(transition(candidate, state.set.revision, "select"), ["bad evidence ref"]))).rejects.toThrow("PB_DECISION_EVIDENCE_INVALID");
    await expect(service.transition(state.set.setId, decision(transition(candidate, state.set.revision, "select"), ["missing-evidence"]))).rejects.toThrow("PB_DECISION_EVIDENCE_NOT_FOUND");
    const select = decision(transition(candidate, state.set.revision, "select"), ["evidence-package", "evidence-datasheet", "evidence-package"]);
    state = await service.transition(state.set.setId, select);
    expect(state.auditEvents.at(-1)?.decisionEvidenceRefs).toEqual(["evidence-datasheet", "evidence-package"]);
    let selected = state.bindings.find((item) => item.revisionId === state.set.effectiveSelectedRevisionId)!;
    const validate = transition(selected, state.set.revision, "revalidate");
    validate.validation = createApprovedValidation(selected, { validatorVersion: "physical-binding-validator/1", at: validate.at, evidenceRefs: ["evidence-mapping"] });
    state = await service.transition(state.set.setId, validate);
    selected = state.bindings.find((item) => item.revisionId === state.set.effectiveSelectedRevisionId)!;
    await expect(service.transition(state.set.setId, transition(selected, state.set.revision, "approve"))).rejects.toThrow("PB_DECISION_EVIDENCE_REQUIRED");
    state = await service.transition(state.set.setId, decision(transition(selected, state.set.revision, "approve"), ["evidence-footprint"]));
    const approved = state.bindings.find((item) => item.revisionId === state.set.effectiveSelectedRevisionId)!;
    expect(approved.approval.decisionEvidenceRefs).toEqual(["evidence-footprint"]);
    const approvalAudit = state.auditEvents.at(-1)!;
    expect(approvalAudit.decisionEvidenceRefs).toEqual(["evidence-footprint"]);
    const { eventDigest, ...auditBase } = approvalAudit;
    expect(eventDigest).toBe(physicalBindingDigest(auditBase));
    expect(physicalBindingDigest({ ...auditBase, decisionEvidenceRefs: ["evidence-package"] })).not.toBe(eventDigest);
    const changedResult = withBindingDigests({ ...withoutBindingDigests(approved), approval: { ...approved.approval, decisionEvidenceRefs: ["evidence-package"] } });
    expect(changedResult.recordDigest).not.toBe(approved.recordDigest);
  });

  it("binds idempotency to the aggregate owner and complete logical request", async () => {
    const repository = new InMemoryPhysicalBindingRepository();
    const service = new PhysicalBindingService(repository);
    const candidate = exactCandidate("request-bound-idempotency");
    let state = await service.createCandidate(candidate, "create-request-bound");
    const request = decision(transition(candidate, state.set.revision, "select"), ["evidence-package", "evidence-datasheet"]);
    const canonicalReplay = { ...request, decisionEvidenceRefs: ["evidence-datasheet", "evidence-package", "evidence-datasheet"] };
    expect(physicalBindingTransitionRequestDigest(canonicalReplay)).toBe(physicalBindingTransitionRequestDigest(request));
    expect(physicalBindingTransitionRequestDigest({ ...request, decisionEvidenceRefs: ["evidence-package"] })).not.toBe(physicalBindingTransitionRequestDigest(request));
    const [first, replay] = await Promise.all([service.transition(state.set.setId, request), service.transition(state.set.setId, canonicalReplay)]);
    expect(first.set.recordDigest).toBe(replay.set.recordDigest);
    expect(first.auditEvents.filter((event) => event.idempotencyKey === request.idempotencyKey)).toHaveLength(1);
    state = first;
    await expect(service.transition(state.set.setId, { ...request, reason: "Changed logical request" })).rejects.toThrow("PB_IDEMPOTENCY_REQUEST_CONFLICT");
    await expect(service.transition(state.set.setId, { ...request, decisionEvidenceRefs: ["evidence-package"] })).rejects.toThrow("PB_IDEMPOTENCY_REQUEST_CONFLICT");
    await expect(service.transition(state.set.setId, { ...request, bindingRevisionId: "different-target:r1" })).rejects.toThrow("PB_IDEMPOTENCY_REQUEST_CONFLICT");
    await expect(service.transition(state.set.setId, { ...request, action: "approve" })).rejects.toThrow("PB_IDEMPOTENCY_REQUEST_CONFLICT");
    await expect(service.transition(state.set.setId, { ...request, expectedSetRevision: request.expectedSetRevision + 1 })).rejects.toThrow("PB_IDEMPOTENCY_REQUEST_CONFLICT");
    await expect(service.transition(state.set.setId, { ...request, actor: { ...request.actor, role: "reviewer" } })).rejects.toThrow("PB_IDEMPOTENCY_REQUEST_CONFLICT");
    const other = exactCandidate("different-owner");
    await expect(service.createCandidate(other, "create-request-bound")).rejects.toThrow("PB_IDEMPOTENCY_SCOPE_CONFLICT");
    const isolatedBase = exactCandidate("isolated-project");
    const isolated = withBindingDigests({ ...withoutBindingDigests(isolatedBase), scope: { ...isolatedBase.scope, projectId: "project-2" }, componentIdentity: { ...isolatedBase.componentIdentity, projectId: "project-2" } });
    await expect(service.createCandidate(isolated, "create-request-bound")).resolves.toMatchObject({ set: { scope: { projectId: "project-2" } } });
  });
});
