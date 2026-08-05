import { describe, expect, it } from "vitest";
import type { CandidateCollectionContext, CandidateSourceResult, FootprintCandidateSource } from "../types";
import { collectCandidateSources, Stage1BindingCandidateSource } from "../adapters";
import { FootprintResolutionService } from "../service";
import { compareLegacyResolution, footprintResolverShadowEnabled, withFootprintResolverShadow } from "../shadow";
import { DEFAULT_FOOTPRINT_RESOLUTION_POLICY } from "../policy";
import { InMemoryPhysicalBindingRepository, PhysicalBindingService } from "../../physical-binding/repository";
import { withBindingDigests, withoutBindingDigests } from "../../physical-binding/stable";
import { aiSuggestion, exactCandidate, readyRepository, resolverRequest } from "./fixtures";
import { resolveFootprint as legacyResolveFootprint } from "@/lib/footprint-assign";
import { syncFromSchematic, type FootprintResolver } from "../../pcb/netlist-bridge";
import type { SchematicState } from "@/lib/schematic-types";
import { GET, POST } from "../../../api/footprint-resolution/route";
import { FootprintResolverTelemetry } from "../observability";

const headers = { "content-type": "application/json", "x-sirkit-tenant-id": "tenant-1", "x-sirkit-project-id": "project-1", "x-sirkit-branch-id": "main", "x-sirkit-actor-id": "reviewer-1", "x-sirkit-role": "project_admin" };

class FailingSuggestionSource implements FootprintCandidateSource {
  readonly sourceKind = "ai_catalog_suggestion" as const;
  readonly sourceVersion = "test-failure/1";
  async collect(): Promise<CandidateSourceResult> { throw new Error("hostile stack and secret must not escape"); }
}
class HangingSuggestionSource implements FootprintCandidateSource {
  readonly sourceKind = "ai_catalog_suggestion" as const;
  readonly sourceVersion = "test-timeout/1";
  async collect(_context: CandidateCollectionContext, signal: AbortSignal): Promise<CandidateSourceResult> { return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ sourceKind: this.sourceKind, sourceVersion: this.sourceVersion, status: "cancelled", candidates: [], diagnostics: [], dependencyDigests: [], durationMs: 0 }), { once: true })); }
}

describe("bounded service, shadow compatibility, API, and hostile adapters", () => {
  it("keeps a valid selected winner resolved when a lower AI suggestion differs", async () => {
    const { repository, binding } = await readyRepository("winner-plus-ai");
    const suggestionBase = aiSuggestion("winner-plus-ai");
    const suggestion = withBindingDigests({ ...withoutBindingDigests(suggestionBase), footprint: { ...suggestionBase.footprint!, assetVersionId: "ai-alternative:r1", contentDigest: `sha256:${"7".repeat(64)}` }, pinPadMapping: { ...suggestionBase.pinPadMapping, state: "pending", mappingCertificateId: undefined, footprintAssetVersionId: "ai-alternative:r1", footprintContentDigest: `sha256:${"7".repeat(64)}` }, dependencies: { ...suggestionBase.dependencies, footprintAssetVersionId: "ai-alternative:r1", footprintContentDigest: `sha256:${"7".repeat(64)}` } });
    await new PhysicalBindingService(repository).createCandidate(suggestion, "add-ai-alternative");
    const result = await new FootprintResolutionService(repository).resolve(resolverRequest("winner-plus-ai"));
    expect(result.status).toBe("resolved");
    expect(result.resolvedBinding?.bindingRevisionId).toBe(binding.revisionId);
    expect(result.suggestedCandidates.some((candidate) => candidate.sourceKinds.includes("ai_catalog_suggestion"))).toBe(true);
  });

  it("isolates a failing lower suggestion adapter without corrupting a valid authoritative result", async () => {
    const { repository } = await readyRepository("adapter-failure-winner");
    const service = new FootprintResolutionService(repository, { sources: [new Stage1BindingCandidateSource("selected_stage1_binding"), new FailingSuggestionSource()] });
    const result = await service.resolve(resolverRequest("adapter-failure-winner"));
    expect(result.status).toBe("resolved");
    expect(result.warnings.map((issue) => issue.code)).toContain("FR_SOURCE_FAILED");
    expect(JSON.stringify(result)).not.toContain("hostile stack");
  });

  it("distinguishes adapter timeout from empty and obeys a bounded time budget", async () => {
    const context = { request: resolverRequest("timeout"), componentIdentity: exactCandidate("timeout").componentIdentity, bindingSets: [], bindings: [], policy: { ...structuredClone(DEFAULT_FOOTPRINT_RESOLUTION_POLICY), adapterTimeoutMs: 50 }, dependencyDigests: [] };
    const started = performance.now();
    const results = await collectCandidateSources([new HangingSuggestionSource()], context);
    expect(results[0]?.status).toBe("timeout");
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("returns deterministic mixed batch outcomes without partial mutation", async () => {
    const { repository } = await readyRepository("batch-ready");
    const before = await repository.findForComponentVariant({ ...exactCandidate("batch-ready").scope, assemblyVariantId: "variant-default" });
    const result = await new FootprintResolutionService(repository).resolveBatch({ schemaVersion: "sirkit.footprint-resolution-batch-request.v1", batchId: "batch-1", requests: [resolverRequest("batch-missing"), resolverRequest("batch-ready")] });
    expect(result.results.map((item) => item.inputSnapshot.componentId)).toEqual(["batch-missing", "batch-ready"]);
    expect(result.summary.resolved).toBe(1);
    expect(result.summary.unresolved_missing_data).toBe(1);
    expect(await repository.findForComponentVariant({ ...exactCandidate("batch-ready").scope, assemblyVariantId: "variant-default" })).toEqual(before);
  });

  it("rejects duplicate and over-limit batches before resolution", async () => {
    const service = new FootprintResolutionService(new InMemoryPhysicalBindingRepository());
    await expect(service.resolveBatch({ schemaVersion: "sirkit.footprint-resolution-batch-request.v1", batchId: "duplicate", requests: [resolverRequest("same"), resolverRequest("same", { requestId: "another" })] })).rejects.toThrow("FR_BATCH_DUPLICATE_COMPONENT");
    const requests = Array.from({ length: 257 }, (_, index) => resolverRequest(`component-${index}`));
    await expect(service.resolveBatch({ schemaVersion: "sirkit.footprint-resolution-batch-request.v1", batchId: "over-limit", requests })).rejects.toThrow("FR_BATCH_LIMIT_EXCEEDED");
  });

  it("reproduces and classifies the known capacitor default-versus-bridge inconsistency", async () => {
    const legacy = legacyResolveFootprint({ refDes: "C1", value: "100n" });
    expect(legacy).toMatchObject({ source: "default", proofState: "candidate", footprint: "Capacitor_SMD:C_0603_1608Metric" });
    const newResult = await new FootprintResolutionService(new InMemoryPhysicalBindingRepository()).resolve(resolverRequest("generic-capacitor"));
    const comparison = compareLegacyResolution({ status: "resolved", footprint: legacy.footprint, source: "default", guessedOrDefaulted: true }, newResult);
    expect(comparison).toMatchObject({ category: "legacy_default_new_requires_policy", risk: "high", productionBehaviorChanged: false });
  });

  it("returns the actual PCB bridge output unchanged when Stage 2 shadow is enabled", async () => {
    const schematic: SchematicState = { components: [{ id: "c1", type: "capacitor", x: 100, y: 100, rotation: 0, value: "100n" }], wires: [] };
    const before = structuredClone(schematic);
    const resolver: FootprintResolver = { resolve: async () => null, detail: async () => null };
    let comparisonCalled = false;
    const production = async () => syncFromSchematic(schematic, undefined, { resolver });
    const disabled = await withFootprintResolverShadow({ production, observeLegacy: () => ({ status: "unresolved", footprint: null, source: "none", guessedOrDefaulted: false }), resolve: (signal) => new FootprintResolutionService(new InMemoryPhysicalBindingRepository()).resolve(resolverRequest("c1", { purpose: "shadow_comparison" }), signal), enabled: false, timeoutMs: 500 });
    const enabled = await withFootprintResolverShadow({ production, observeLegacy: () => ({ status: "unresolved", footprint: null, source: "none", guessedOrDefaulted: false }), resolve: (signal) => new FootprintResolutionService(new InMemoryPhysicalBindingRepository()).resolve(resolverRequest("c1", { purpose: "shadow_comparison" }), signal), enabled: true, timeoutMs: 500, observe: () => { comparisonCalled = true; } });
    expect(enabled).toEqual(disabled);
    expect(schematic).toEqual(before);
    expect(comparisonCalled).toBe(true);
  });

  it("classifies the complete reachable legacy/new shadow matrix deterministically", async () => {
    const { repository } = await readyRepository("shadow-matrix");
    const resolved = await new FootprintResolutionService(repository).resolve(resolverRequest("shadow-matrix"));
    const unresolved = await new FootprintResolutionService(new InMemoryPhysicalBindingRepository()).resolve(resolverRequest("shadow-missing"));
    const exactName = `${resolved.resolvedBinding!.footprintAsset.libraryNickname}:${resolved.resolvedBinding!.footprintAsset.footprintName}`;
    const cases = [
      compareLegacyResolution({ status: "resolved", footprint: exactName, source: "atomic-approved", guessedOrDefaulted: false }, resolved),
      compareLegacyResolution({ status: "resolved", footprint: "Other:Asset", source: "atomic-approved", guessedOrDefaulted: false }, resolved),
      compareLegacyResolution({ status: "resolved", footprint: "Manual:Asset", source: "manual", guessedOrDefaulted: false }, unresolved),
      compareLegacyResolution({ status: "resolved", footprint: "Default:Asset", source: "default", guessedOrDefaulted: true }, unresolved),
      compareLegacyResolution({ status: "resolved", footprint: "Hint:Asset", source: "hint", guessedOrDefaulted: true }, unresolved),
      compareLegacyResolution({ status: "unresolved", footprint: null, source: "none", guessedOrDefaulted: false }, resolved),
      compareLegacyResolution({ status: "unresolved", footprint: null, source: "none", guessedOrDefaulted: false, reasonCode: "FR_STAGE1_BINDING_SET_MISSING" }, unresolved),
      compareLegacyResolution({ status: "unresolved", footprint: null, source: "none", guessedOrDefaulted: false, reasonCode: "LEGACY_OTHER" }, unresolved),
      compareLegacyResolution({ status: "error", footprint: null, source: "error", guessedOrDefaulted: false }, unresolved),
      compareLegacyResolution({ status: "unresolved", footprint: null, source: "none", guessedOrDefaulted: false }, null),
    ];
    expect(cases.map((item) => item.category)).toEqual([
      "equivalent_resolution", "legacy_asset_new_asset_mismatch", "legacy_resolved_new_unresolved_missing_data",
      "legacy_default_new_requires_policy", "legacy_hint_new_unapproved", "legacy_unresolved_new_resolved",
      "both_unresolved_equivalent_reason", "both_unresolved_different_reason", "legacy_error", "new_error",
    ]);
    expect(cases.every((item) => item.productionBehaviorChanged === false)).toBe(true);
    expect(compareLegacyResolution(cases[0]!.legacy, resolved)).toEqual(cases[0]);
  });

  it("contains resolver timeout/failure inside shadow and leaves production exact", async () => {
    const expected = { boardRevision: "production-r1", footprints: ["unchanged"] };
    const comparisons: string[] = [];
    const result = await withFootprintResolverShadow({
      production: async () => structuredClone(expected),
      observeLegacy: () => ({ status: "resolved", footprint: "Legacy:Footprint", source: "manual", guessedOrDefaulted: false }),
      resolve: () => new Promise(() => undefined),
      enabled: true,
      timeoutMs: 10,
      observe: (comparison) => comparisons.push(comparison.category),
    });
    expect(result).toEqual(expected);
    expect(comparisons).toEqual(["new_error"]);
    expect(footprintResolverShadowEnabled({ SIRKIT_FOOTPRINT_RESOLVER_SHADOW: "true" })).toBe(true);
    expect(footprintResolverShadowEnabled({ SIRKIT_FOOTPRINT_RESOLVER_SHADOW: "false" })).toBe(false);
  });

  it("does not leak cross-tenant bindings", async () => {
    const { repository } = await readyRepository("tenant-private");
    const result = await new FootprintResolutionService(repository).resolve(resolverRequest("tenant-private", { tenantId: "tenant-other", requestId: "cross-tenant" }));
    expect(result.status).toBe("unresolved_missing_data");
    expect(result.resolvedBinding).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("STM32F411CEU6");
  });

  it("requires API authentication and exposes exact read-only versions", async () => {
    expect((await GET(new Request("http://localhost/api/footprint-resolution"))).status).toBe(401);
    const response = await GET(new Request("http://localhost/api/footprint-resolution", { headers }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, readOnly: true, resolverVersion: "sirkit.footprint-resolver/2.0.0", productionPcbSyncAuthority: "legacy_until_stage3", cache: { mode: "disabled" } });
  });

  it("emits bounded pseudonymized metrics without component or raw project identifiers", async () => {
    const telemetry = new FootprintResolverTelemetry();
    const { repository } = await readyRepository("telemetry-component");
    await new FootprintResolutionService(repository, { telemetry, clock: () => "2026-07-18T15:00:00.000Z" }).resolve(resolverRequest("telemetry-component"));
    const serialized = JSON.stringify(telemetry.snapshot());
    expect(telemetry.counts()).toMatchObject({ request: 1, status: 1, candidate: 1 });
    expect(serialized).not.toContain("telemetry-component");
    expect(serialized).not.toContain("project-1");
    expect(serialized).not.toContain("tenant-1");
  });

  it("rejects non-JSON media types before parsing", async () => {
    const response = await POST(new Request("http://localhost/api/footprint-resolution", { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" }));
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ code: "FR_API_MEDIA_TYPE_UNSUPPORTED" });
  });

  it("rejects malformed API bodies before touching persistence", async () => {
    const response = await POST(new Request("http://localhost/api/footprint-resolution", { method: "POST", headers, body: "{" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "FR_API_INVALID_JSON" });
  });
});
