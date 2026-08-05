import { describe, expect, it } from "vitest";
import { DEFAULT_FOOTPRINT_RESOLUTION_POLICY, resolveFootprintPolicy, validateResolutionPolicy } from "../policy";
import { validateResolutionRequest } from "../validation";
import { inspectAssemblyVariantScope, normalizeAssemblyVariantScope } from "../variant-scope";
import { resolverRequest } from "./fixtures";
import { PhysicalBindingMappingProjector } from "../../mapping-verification/stage1-projector";
import type { PhysicalBindingRepository } from "../../physical-binding/repository";
import type { MappingRecord } from "../../mapping-verification/types";
import { DEFAULT_FOOTPRINT_CANDIDATE_SOURCES, PRODUCTION_FOOTPRINT_SOURCE_COMPOSITION_VERSION, productionFootprintCandidateSources } from "../adapters";
import { InMemoryPassivePolicyContextProvider } from "../../passive-policy/providers";

describe("Stage 2 request and immutable policy contracts", () => {
  it("accepts the smallest complete stable-identity request", () => {
    expect(validateResolutionRequest(resolverRequest("component-1"))).toEqual([]);
  });

  it("rejects missing variant, unknown purpose, control characters, bad time, and unauthorized diagnostic trace", () => {
    const request = resolverRequest("component-1", { assemblyVariantId: "", purpose: "unknown" as never, requestedAt: "not-a-time", requestId: "bad\u0000id", traceLevel: "diagnostic", actorContext: { ...resolverRequest("x").actorContext, role: "viewer" } });
    const codes = validateResolutionRequest(request).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(["FR_REQUEST_ID_INVALID", "FR_REQUEST_PURPOSE_UNSUPPORTED", "FR_REQUEST_TIMESTAMP_INVALID", "FR_DIAGNOSTIC_TRACE_UNAUTHORIZED"]));
  });

  it("fails closed on unknown policy IDs or versions", () => {
    expect(() => resolveFootprintPolicy("other", "1.0.0")).toThrow("FR_POLICY_VERSION_UNSUPPORTED");
    expect(() => resolveFootprintPolicy("sirkit.default-footprint-resolution", "2.0.0")).toThrow("FR_POLICY_VERSION_UNSUPPORTED");
  });

  it("does not permit configuration to weaken mandatory layout gates or promote suggestions", () => {
    const weakened = structuredClone(DEFAULT_FOOTPRINT_RESOLUTION_POLICY);
    weakened.purposeRequirements.layout_transfer.requireApproval = false;
    weakened.sourceAuthority.ai_catalog_suggestion = "approved_exact_part";
    expect(validateResolutionPolicy(weakened)).toEqual(expect.arrayContaining(["FR_POLICY_MANDATORY_GATE_WEAKENED:layout_transfer", "FR_POLICY_SUGGESTION_PROMOTION_FORBIDDEN"]));
  });

  it("has deterministic unique precedence ranks and keeps Stage 5/10 disabled", () => {
    expect(validateResolutionPolicy(structuredClone(DEFAULT_FOOTPRINT_RESOLUTION_POLICY))).toEqual([]);
    expect(new Set(DEFAULT_FOOTPRINT_RESOLUTION_POLICY.sourcePrecedence.map((entry) => entry.rank)).size).toBe(DEFAULT_FOOTPRINT_RESOLUTION_POLICY.sourcePrecedence.length);
    expect(DEFAULT_FOOTPRINT_RESOLUTION_POLICY.enabledSources).not.toContain("passive_policy");
    expect(DEFAULT_FOOTPRINT_RESOLUTION_POLICY.enabledSources).not.toContain("generated_overlay");
  });

  it("exposes one explicit production source composition without a disabled passive hook", () => {
    const injected = productionFootprintCandidateSources(new InMemoryPassivePolicyContextProvider());
    expect(PRODUCTION_FOOTPRINT_SOURCE_COMPOSITION_VERSION).toBe("sirkit.footprint-source-composition/2.1.0");
    expect(injected.map((source) => [source.sourceKind, source.sourceVersion])).toEqual(DEFAULT_FOOTPRINT_CANDIDATE_SOURCES.map((source) => [source.sourceKind, source.sourceVersion]));
    expect(injected.find((source) => source.sourceKind === "passive_policy")?.sourceVersion).toBe("sirkit.passive-policy-stage2-adapter/1.1.0");
    expect(injected.some((source) => source.sourceKind === "passive_policy" && source.sourceVersion.includes("disabled"))).toBe(false);
  });

  it("normalizes global, exact, multi, duplicate, and malformed variant scopes deterministically", () => {
    expect(inspectAssemblyVariantScope([], "variant-a")).toMatchObject({ kind: "global", applies: true, normalized: [] });
    expect(inspectAssemblyVariantScope(["variant-a"], "variant-a")).toMatchObject({ kind: "explicit", applies: true });
    expect(inspectAssemblyVariantScope(["variant-a"], "variant-b")).toMatchObject({ kind: "explicit", applies: false });
    expect(inspectAssemblyVariantScope(["variant-b", "variant-a", "variant-b"], "variant-b")).toMatchObject({ applies: true, normalized: ["variant-a", "variant-b"] });
    expect(normalizeAssemblyVariantScope(["variant-b", "variant-a"])).toEqual(normalizeAssemblyVariantScope(["variant-a", "variant-b", "variant-a"]));
    expect(inspectAssemblyVariantScope(undefined, "variant-a")).toMatchObject({ kind: "invalid", applies: false, errors: ["VARIANT_SCOPE_REQUIRED"] });
    expect(inspectAssemblyVariantScope(["bad variant"], "variant-a")).toMatchObject({ kind: "invalid", applies: false, errors: ["VARIANT_SCOPE_ID_INVALID"] });
    expect(inspectAssemblyVariantScope([], "")).toMatchObject({ kind: "invalid", applies: false, errors: ["REQUEST_VARIANT_REQUIRED"] });
  });

  it("makes the B4 projector use the same global/exact applicability contract", async () => {
    const setScope = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardInstanceId: "board-1", componentInstanceId: "component-1", hierarchyPath: ["root"], assemblyVariantIds: [] as string[] };
    const repository = { load: async () => ({ set: { scope: setScope }, bindings: [], auditEvents: [], migrationRecords: [], assessments: [] }) } as unknown as PhysicalBindingRepository;
    const projector = new PhysicalBindingMappingProjector(repository);
    const record = { scope: { tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardInstanceId: "board-1", componentInstanceId: "component-1", bindingSetId: "binding-set-1", bindingRevisionId: "binding-r1", hierarchyPath: ["root"], assemblyVariantId: "variant-a" } } as MappingRecord;
    await expect(projector.project(record, resolverRequest("x").actorContext, "global-projector")).rejects.toThrow("MV_STAGE1_SELECTED_BINDING_MISSING");
    setScope.assemblyVariantIds = ["variant-a", "variant-b"];
    await expect(projector.project(record, resolverRequest("x").actorContext, "exact-projector")).rejects.toThrow("MV_STAGE1_SELECTED_BINDING_MISSING");
    setScope.assemblyVariantIds = ["variant-b"];
    await expect(projector.project(record, resolverRequest("x").actorContext, "mismatch-projector")).rejects.toThrow("MV_STAGE1_BINDING_SCOPE_MISMATCH");
  });
});
