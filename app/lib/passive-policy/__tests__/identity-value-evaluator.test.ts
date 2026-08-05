import { describe, expect, it } from "vitest";
import { DeterministicPassivePolicyEvaluator } from "../evaluator";
import { normalizePassivePackageIdentity } from "../package-profile";
import { parsePassiveValue } from "../value";
import { ASSEMBLY, NOW, componentFixture, contextFixture, policyFixture, profileFixture, ruleFixture } from "./fixtures";
import { exactCandidate } from "../../physical-binding/__tests__/fixtures";
import { passivePolicyDigest, withPolicyDigest } from "../stable";
import { withPassiveExceptionDecisionIntegrity } from "../policy";
import { PASSIVE_EXCEPTION_CONTRACT_VERSION, type PassiveComponentException, type PassiveExceptionAction, type PassivePackageProfile, type ProjectPassivePackagePolicy } from "../types";

function pinnedException(input: { action: PassiveExceptionAction; base?: ProjectPassivePackagePolicy; profile?: PassivePackageProfile; profiles?: PassivePackageProfile[]; component?: ReturnType<typeof componentFixture>; exceptionId?: string }) {
  const base = input.base ?? policyFixture(), component = input.component ?? componentFixture(), profiles = input.profiles ?? [input.profile ?? profileFixture()], approvedContext = contextFixture({ component, policy: base, profiles }), effectivePolicyRevisionId = `${base.policyId}:exception-r${base.revision + 1}`, selected = input.action === "assign_profile" ? input.profile ?? profiles[0]! : undefined;
  const selection = selected ? { kind: "profile" as const, profileId: selected.profileId, profileRevisionId: selected.revisionId, profileDigest: selected.profileDigest, packageIdentityId: selected.exactPackageIdentity.packageIdentityId, packageRevisionId: selected.exactPackageIdentity.packageRevisionId, footprintLogicalAssetId: selected.exactFootprintAssetIdentity.logicalAssetId, footprintAssetVersionId: selected.exactFootprintAssetIdentity.assetVersionId, footprintContentDigest: selected.exactFootprintAssetIdentity.contentDigest!, mappingRevisionId: selected.stage4MappingProfileRef.mappingRevisionId!, mappingContentDigest: selected.stage4MappingProfileRef.mappingContentDigest!, mappingResultDigest: selected.stage4MappingProfileRef.verificationResultDigest! } : { kind: "none" as const };
  const exception = withPassiveExceptionDecisionIntegrity({ exceptionContractVersion: PASSIVE_EXCEPTION_CONTRACT_VERSION, exceptionId: input.exceptionId ?? `exception-${input.action}`, decisionRevision: 1, componentInstanceId: component.scope.componentInstanceId, assemblyVariantIds: [component.scope.assemblyVariantId], action: input.action, ...(selected ? { targetProfileId: selected.profileId } : {}), selection, authority: { tenantId: component.scope.tenantId, projectId: component.scope.projectId, branchId: component.scope.branchId, componentInstanceId: component.scope.componentInstanceId, variants: [{ assemblyVariantId: component.scope.assemblyVariantId, boardInstanceId: component.scope.boardInstanceId, componentSnapshotId: component.snapshotId, componentRevisionId: component.componentRevisionId, componentDigest: component.dependencyDigest, stableComponentIdentityDigest: passivePolicyDigest(component.stableIdentity), contextDependencyDigest: approvedContext.dependencySnapshot.dependencyDigest }], policyId: base.policyId, approvedAgainstPolicyRevisionId: base.revisionId, approvedAgainstPolicyDigest: base.technicalDigest, expectedPolicyRecordRevision: 4, effectivePolicyRevisionId, assemblyProfileId: ASSEMBLY.assemblyProfileId, assemblyProfileRevisionId: ASSEMBLY.revisionId, assemblyProfileDigest: ASSEMBLY.dependencyDigest }, state: "approved" as const, reason: "Approved bounded component exception.", evidenceRefs: ["exception-evidence-r1"], approvedAt: NOW, createdBy: approvedContext.request.actorContext, mutationDigest: passivePolicyDigest({ action: input.action, component: component.dependencyDigest, policy: base.technicalDigest }) } as PassiveComponentException);
  const policy = withPolicyDigest({ ...base, revision: base.revision + 1, revisionId: effectivePolicyRevisionId, supersedesRevisionId: base.revisionId, componentExceptions: [exception], technicalDigest: undefined } as never);
  return { base, component, exception, policy, context: contextFixture({ component, policy, profiles }) };
}

describe("Stage 5 identity and typed values", () => {
  it("rejects the ambiguous bare 0603 token and distinguishes metric from imperial", () => {
    expect(() => normalizePassivePackageIdentity("0603")).toThrow("PP_PACKAGE_ALIAS_AMBIGUOUS");
    expect(normalizePassivePackageIdentity("0603 metric").canonicalId).toBe("chip:0201-imperial:0603-metric");
    expect(normalizePassivePackageIdentity("0603 imperial").canonicalId).toBe("chip:0603-imperial:1608-metric");
  });

  it("normalizes bounded electrical values without guessing the dimension", () => {
    expect(parsePassiveValue("100nF", "capacitance").valueSI).toBeCloseTo(100e-9);
    expect(parsePassiveValue("4K7", "resistance").valueSI).toBe(4_700);
    expect(() => parsePassiveValue("100nF", "resistance")).toThrow();
  });
});

describe("Stage 5 conservative evaluator", () => {
  const evaluator = new DeterministicPassivePolicyEvaluator();

  it("qualifies an ordinary characterized MLCC but never claims manufacturing readiness", () => {
    const result = evaluator.evaluate(contextFixture());
    expect(result.status).toBe("eligible_characterized_generic");
    expect(result.selectedProfile?.normalizedPackageIdentity.imperialCode).toBe("0603");
    expect(result.claims).toMatchObject({ reservesLayoutPackage: true, manufacturingReady: false, mutatesSchematic: false, mutatesPcb: false });
    expect(result.unresolvedManufacturingFacts.map((item) => item.code)).toContain("PP_GAP_EXACT_PART");
  });

  it("allows only explicitly named unknowns in layout-reservation mode", () => {
    const profile = profileFixture(), rules = [ruleFixture(profile, { requiredKnownFacts: ["capacitance", "working_voltage"], permittedUnknownFacts: ["working_voltage"] })], policy = policyFixture({ mode: "layout_reservation", profile, rules });
    const result = evaluator.evaluate(contextFixture({ component: componentFixture({ workingVoltageState: "unknown" }), policy, profiles: [profile] }));
    expect(result.status).toBe("eligible_layout_reservation");
    expect(result.factAssessment.permittedUnknown).toEqual(["working_voltage"]);
    expect(result.warnings.map((item) => item.code)).toContain("PP_LAYOUT_RESERVATION_WARNING");
  });

  it("keeps exact-part-required mode distinct and never invents the exact part", () => {
    const profile = profileFixture(), policy = policyFixture({ mode: "exact_part_required", profile });
    expect(evaluator.evaluate(contextFixture({ policy, profiles: [profile] })).status).toBe("missing_required_facts");
    const binding = exactCandidate("C1"), component = componentFixture({ componentId: "C1", hierarchyPath: ["root", "motor-control"], exactBinding: { binding, effectiveSelected: false, currentApproved: true }, exactPartCompatibleProfileIds: [profile.profileId] });
    const result = evaluator.evaluate(contextFixture({ component, policy, profiles: [profile] }));
    expect(result.status).toBe("eligible_exact_part");
    expect(result.claims.selectsExactPart).toBe(false);
  });

  it("honors revision-complete opt-out and blocks legacy or conflicting active exceptions", () => {
    const complete = pinnedException({ action: "opt_out" });
    expect(evaluator.evaluate(complete.context)).toMatchObject({ status: "not_applicable", appliedException: { decisionId: complete.exception.decisionId } });
    const legacy = { exceptionId: "exception-legacy", componentInstanceId: "C1", assemblyVariantIds: ["variant-default"], action: "opt_out" as const, state: "approved" as const, approvalDigest: "approved-exception", reason: "Legacy incomplete decision.", evidenceRefs: ["exception-evidence"], createdBy: contextFixture().request.actorContext };
    const legacyPolicy = withPolicyDigest({ ...policyFixture(), componentExceptions: [legacy], technicalDigest: undefined } as never), legacyResult = evaluator.evaluate(contextFixture({ policy: legacyPolicy }));
    expect(legacyResult.status).toBe("policy_stale");
    expect(legacyResult.blockers.map((item) => item.code)).toContain("PP_EXCEPTION_AUTHORITY_INCOMPLETE");
    const exact = pinnedException({ action: "require_exact_part", base: complete.base, exceptionId: "exception-exact" }).exception, conflict = withPolicyDigest({ ...complete.policy, componentExceptions: [complete.exception, exact], technicalDigest: undefined } as never), conflictResult = evaluator.evaluate(contextFixture({ policy: conflict }));
    expect(conflictResult.status).toBe("policy_stale");
    expect(conflictResult.blockers.map((item) => item.code)).toContain("PP_EXCEPTION_ACTIVE_SCOPE_CONFLICT");
    const stale = withPassiveExceptionDecisionIntegrity({ ...complete.exception, decisionId: undefined, approvalDigest: undefined, state: "stale" as const } as PassiveComponentException), stalePolicy = withPolicyDigest({ ...complete.policy, componentExceptions: [stale], technicalDigest: undefined } as never), staleResult = evaluator.evaluate(contextFixture({ policy: stalePolicy }));
    expect(staleResult.status).toBe("policy_stale");
    expect(staleResult.blockers.map((item) => item.code)).toContain("PP_EXCEPTION_STALE_OR_EXPIRED");
  });

  it("selects only the exact pinned profile and binds it into deterministic output", () => {
    const selected = profileFixture(), generic = profileFixture({ profileId: "profile-chip-0805", packageName: "0805 imperial / 2012 metric" }), base = policyFixture({ profile: generic, rules: [ruleFixture(generic)] }), pinned = pinnedException({ action: "assign_profile", base, profile: selected, profiles: [generic, selected] });
    const first = evaluator.evaluate(pinned.context), second = evaluator.evaluate(pinned.context);
    expect(first).toMatchObject({ status: "eligible_characterized_generic", selectedProfile: { revisionId: selected.revisionId }, appliedException: { decisionId: pinned.exception.decisionId, profileRevisionId: selected.revisionId } });
    expect(first.selectedProfile?.revisionId).not.toBe(generic.revisionId);
    expect(second.resultDigest).toBe(first.resultDigest);
    expect(first.dependencySnapshot.policyDigest).toBe(pinned.policy.technicalDigest);
  });

  it("blocks missing, stale, mismatched, risky, and unsupported exception authority", () => {
    const selected = profileFixture(), pinned = pinnedException({ action: "assign_profile", profile: selected });
    const missing = contextFixture({ component: pinned.component, policy: pinned.policy, profiles: [] }), missingResult = evaluator.evaluate(missing);
    expect(missingResult.status).toBe("policy_stale");
    expect(missingResult.blockers.map((item) => item.code)).toContain("PP_EXCEPTION_CONTEXT_AUTHORITY_STALE");
    const staleProfile = structuredClone(selected); staleProfile.profileDigest = "pp1-stale-profile-digest";
    expect(evaluator.evaluate(contextFixture({ component: pinned.component, policy: pinned.policy, profiles: [staleProfile] })).blockers.map((item) => item.code)).toContain("PP_EXCEPTION_CONTEXT_AUTHORITY_STALE");
    const changed = structuredClone(pinned.component); changed.componentRevisionId = "C1:r2";
    expect(evaluator.evaluate(contextFixture({ component: changed, policy: pinned.policy, profiles: [selected] })).blockers.map((item) => item.code)).toContain("PP_EXCEPTION_COMPONENT_AUTHORITY_STALE");
    const polarized = structuredClone(pinned.component); polarized.polarity.value = "polarized";
    expect(evaluator.evaluate(contextFixture({ component: polarized, policy: pinned.policy, profiles: [selected] })).status).toBe("excluded_safety");
    const unsupported = withPolicyDigest({ ...policyFixture(), componentExceptions: [{ exceptionId: "exception-unsupported", componentInstanceId: "C1", assemblyVariantIds: ["variant-default"], action: "invent_profile", state: "approved", reason: "Unsupported.", evidenceRefs: ["evidence"], createdBy: contextFixture().request.actorContext }], technicalDigest: undefined } as never), unsupportedResult = evaluator.evaluate(contextFixture({ policy: unsupported }));
    expect(unsupportedResult.status).toBe("policy_stale");
    expect(unsupportedResult.blockers.map((item) => item.code)).toContain("PP_EXCEPTION_ACTION_UNSUPPORTED");
  });

  it.each([
    ["polarized capacitor", componentFixture({ polarity: "polarized" }), "excluded_safety"],
    ["bulk capacitor", componentFixture({ roles: ["bulk_energy_storage"] }), "excluded_specialized_role"],
    ["current-sense resistor", componentFixture({ passiveClass: "resistor", roles: ["current_sense"] }), "excluded_specialized_role"],
  ])("excludes %s", (_name, component, status) => { expect(evaluator.evaluate(contextFixture({ component })).status).toBe(status); });

  it("qualifies an ordinary pull-up resistor with a resistor rule", () => {
    const profile = profileFixture(), policy = policyFixture({ profile, rules: [ruleFixture(profile, { passiveClass: "resistor", roles: ["pull_up", "pull_down", "bias"] })] });
    expect(evaluator.evaluate(contextFixture({ component: componentFixture({ passiveClass: "resistor" }), policy, profiles: [profile] })).status).toBe("eligible_characterized_generic");
  });

  it("does not let rule order break a materially different winning tie", () => {
    const left = profileFixture(), right = profileFixture({ profileId: "profile-chip-0805", packageName: "0805 imperial / 2012 metric" });
    const rules = [ruleFixture(left, { ruleId: "same-a" }), ruleFixture(right, { ruleId: "same-b" })];
    const result = evaluator.evaluate(contextFixture({ policy: policyFixture({ profile: left, rules }), profiles: [right, left] }));
    expect(result.status).toBe("conflicting_rules");
    expect(result.blockers.map((item) => item.code)).toContain("PP_WINNING_RULES_CONFLICT");
  });

  it("rejects stale Stage 4 mapping evidence and unpermitted unknown facts", () => {
    const stale = profileFixture({ staleMapping: true }), stalePolicy = policyFixture({ profile: stale, rules: [ruleFixture(stale)] });
    expect(evaluator.evaluate(contextFixture({ policy: stalePolicy, profiles: [stale] })).status).toBe("mapping_unverified");
    expect(evaluator.evaluate(contextFixture({ component: componentFixture({ workingVoltageState: "unknown" }) })).status).toBe("missing_required_facts");
  });

  it("is deterministic across input order and reports no policy as not applicable", () => {
    const first = evaluator.evaluate(contextFixture()), second = evaluator.evaluate(contextFixture());
    expect(second.resultDigest).toBe(first.resultDigest);
    const noPolicy = contextFixture(); delete noPolicy.policy; noPolicy.overlappingPublishedPolicyIds = [];
    expect(evaluator.evaluate(noPolicy).status).toBe("not_applicable");
  });
});
