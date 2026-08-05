import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { previewPassivePolicy } from "../preview";
import { passivePolicyFeatureState } from "../rollout";
import { DeterministicPassivePolicyEvaluator } from "../evaluator";
import { componentFixture, contextFixture, policyFixture, profileFixture, ruleFixture } from "./fixtures";

describe("Stage 5 boundedness and properties", () => {
  it("keeps rollout off for missing and invalid flag values", () => {
    expect(passivePolicyFeatureState({})).toBe("off");
    expect(passivePolicyFeatureState({ SIRKIT_PASSIVE_POLICY_STAGE5: "yes" })).toBe("off");
  });

  it("is invariant to equivalent rule and profile ordering", () => {
    const profile = profileFixture(), a = ruleFixture(profile, { ruleId: "equivalent-a" }), b = ruleFixture(profile, { ruleId: "equivalent-b" }), evaluator = new DeterministicPassivePolicyEvaluator();
    const leftPolicy = policyFixture({ profile, rules: [a, b] }), rightPolicy = policyFixture({ profile, rules: [b, a] });
    const left = evaluator.evaluate(contextFixture({ policy: leftPolicy, profiles: [profile] })), right = evaluator.evaluate(contextFixture({ policy: rightPolicy, profiles: [profile] }));
    expect(right.resultDigest).toBe(left.resultDigest);
    expect(right.selectedRuleIds).toEqual(["equivalent-a", "equivalent-b"]);
  });

  it("previews 1,000 components within the bounded budget and output limit", async () => {
    const policy = policyFixture(), contexts = Array.from({ length: 1_000 }, (_, index) => contextFixture({ component: componentFixture({ componentId: `C${index + 1}` }), policy }));
    const started = performance.now(), preview = await previewPassivePolicy({ policy, contexts, assemblyVariantId: "variant-default" }), elapsedMs = performance.now() - started;
    expect(preview.results).toHaveLength(1_000);
    expect(elapsedMs).toBeLessThan(5_000);
    expect(new TextEncoder().encode(JSON.stringify(preview)).byteLength).toBeLessThan(8_000_000);
    expect(preview.boardChanged).toBe(false);
  }, 10_000);
});
