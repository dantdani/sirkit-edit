import { describe, expect, it } from "vitest";
import { DEFAULT_FOOTPRINT_CANDIDATE_SOURCES } from "../../footprint-resolver/adapters";
import { STAGE5_PASSIVE_FOOTPRINT_POLICY_VERSION } from "../../footprint-resolver/policy";
import { FootprintResolutionService } from "../../footprint-resolver/service";
import { resolverRequest, readyRepository } from "../../footprint-resolver/__tests__/fixtures";
import { exactCandidate } from "../../physical-binding/__tests__/fixtures";
import { InMemoryPhysicalBindingRepository, PhysicalBindingService } from "../../physical-binding/repository";
import { InMemoryPassivePolicyContextProvider } from "../providers";
import { PassivePolicyCandidateSource } from "../stage2-adapter";
import { componentFixture, contextFixture } from "./fixtures";

function sources(provider: InMemoryPassivePolicyContextProvider) { return [...DEFAULT_FOOTPRINT_CANDIDATE_SOURCES.filter((item) => item.sourceKind !== "passive_policy"), new PassivePolicyCandidateSource(provider)].sort((a, b) => a.sourceKind.localeCompare(b.sourceKind)); }

describe("Stage 5 to Stage 2 adapter", () => {
  it("is rejected unless the resolver caller explicitly opts in", async () => {
    const repository = new InMemoryPhysicalBindingRepository(), candidate = exactCandidate("C1"); await new PhysicalBindingService(repository).createCandidate(candidate, "seed-candidate");
    const provider = new InMemoryPassivePolicyContextProvider([contextFixture({ component: componentFixture({ componentId: "C1", hierarchyPath: ["root", "motor-control"] }), purpose: "stage2_resolution" })]);
    const service = new FootprintResolutionService(repository, { sources: sources(provider) });
    await expect(service.resolve(resolverRequest("C1", { policyVersion: STAGE5_PASSIVE_FOOTPRINT_POLICY_VERSION }))).rejects.toThrow("FR_POLICY_VERSION_UNSUPPORTED");
  });

  it("produces a layout-ready rank-6 result while retaining manufacturing blockers", async () => {
    const repository = new InMemoryPhysicalBindingRepository(), candidate = exactCandidate("C1"); await new PhysicalBindingService(repository).createCandidate(candidate, "seed-candidate");
    const provider = new InMemoryPassivePolicyContextProvider([contextFixture({ component: componentFixture({ componentId: "C1", hierarchyPath: ["root", "motor-control"] }), purpose: "stage2_resolution" })]);
    const service = new FootprintResolutionService(repository, { sources: sources(provider), allowStage5PassivePolicy: true });
    const result = await service.resolve(resolverRequest("C1", { policyVersion: STAGE5_PASSIVE_FOOTPRINT_POLICY_VERSION }));
    expect(result.status).toBe("resolved");
    expect(result.resolvedBinding?.authorityClass).toBe("approved_passive_policy");
    expect(result.resolvedBinding?.readiness).toEqual({ layout: "ready", manufacturing: "not_ready" });
  });

  it("suppresses the policy adapter when an effective Stage 1 selection exists", async () => {
    const stage1 = await readyRepository("C1"), component = componentFixture({ componentId: "C1", hierarchyPath: ["root", "motor-control"], exactBinding: { binding: stage1.binding, effectiveSelected: true, currentApproved: true } }), provider = new InMemoryPassivePolicyContextProvider([contextFixture({ component, purpose: "stage2_resolution" })]);
    const service = new FootprintResolutionService(stage1.repository, { sources: sources(provider), allowStage5PassivePolicy: true });
    const result = await service.resolve(resolverRequest("C1", { policyVersion: STAGE5_PASSIVE_FOOTPRINT_POLICY_VERSION }));
    expect(result.status).toBe("resolved");
    expect(result.resolvedBinding?.authorityClass).toBe("selected_stage1");
    expect(result.trace.steps.some((item) => item.code === "FR_SOURCE_EMPTY" && item.sourceKind === "passive_policy")).toBe(true);
  });
});
