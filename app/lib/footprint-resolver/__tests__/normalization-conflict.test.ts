import { describe, expect, it } from "vitest";
import { DeterministicFootprintResolutionEngine } from "../engine";
import { normalizeAndDeduplicateCandidates } from "../normalize";
import { DEFAULT_FOOTPRINT_RESOLUTION_POLICY } from "../policy";
import { contextTechnicalDigest, resolverId } from "../stable";
import type { CandidateSourceResult, ImmutableResolutionContext, RawFootprintCandidate } from "../types";
import { addReadyCandidate, AI_ACTOR, aiSuggestion, exactCandidate, resolverRequest } from "./fixtures";
import { InMemoryPhysicalBindingRepository } from "../../physical-binding/repository";
import { withBindingDigests, withoutBindingDigests } from "../../physical-binding/stable";

function raw(binding: ReturnType<typeof exactCandidate>, sourceKind: RawFootprintCandidate["sourceKind"], suffix: string): RawFootprintCandidate { return { schemaVersion: "sirkit.raw-footprint-candidate.v1", rawCandidateId: `raw-${suffix}`, sourceKind, sourceVersion: `source-${suffix}/1`, binding }; }
function source(candidates: RawFootprintCandidate[], kind: CandidateSourceResult["sourceKind"]): CandidateSourceResult { return { sourceKind: kind, sourceVersion: `source-${kind}/1`, status: candidates.length ? "success" : "empty", candidates, diagnostics: [], dependencyDigests: candidates.map((item) => item.binding.recordDigest), durationMs: 0 }; }

async function conflictContext(): Promise<ImmutableResolutionContext> {
  const componentId = "conflicting-u1";
  const repoA = new InMemoryPhysicalBindingRepository(), repoB = new InMemoryPhysicalBindingRepository();
  const first = await addReadyCandidate(repoA, exactCandidate(componentId, { candidateKeySuffix: "first" }));
  const alternativeBase = exactCandidate(componentId, { candidateKeySuffix: "second" });
  const differentDigest = `sha256:${"9".repeat(64)}`;
  const alternative = withBindingDigests({ ...withoutBindingDigests(alternativeBase), footprint: { ...alternativeBase.footprint!, assetVersionId: "alternative-footprint:r1", contentDigest: differentDigest }, pinPadMapping: { ...alternativeBase.pinPadMapping, mappingCertificateId: "mapping-alternative", footprintAssetVersionId: "alternative-footprint:r1", footprintContentDigest: differentDigest }, dependencies: { ...alternativeBase.dependencies, footprintAssetVersionId: "alternative-footprint:r1", footprintContentDigest: differentDigest, mappingCertificateId: "mapping-alternative" } });
  const second = await addReadyCandidate(repoB, alternative);
  const statesA = await repoA.findForComponentVariant({ ...first.scope, assemblyVariantId: "variant-default" });
  const statesB = await repoB.findForComponentVariant({ ...second.scope, assemblyVariantId: "variant-default" });
  const request = resolverRequest(componentId);
  const base: Omit<ImmutableResolutionContext, "dependencyDigest"> = { schemaVersion: "sirkit.footprint-resolution-context.v1", request, componentIdentity: first.componentIdentity, componentRevisionDigest: first.technicalDigest, variantRevisionDigest: "variant-revision", bindingSets: [...statesA, ...statesB].map((state) => state.set), effectiveSelectedRevisionIds: [first.revisionId, second.revisionId].sort(), sourceResults: [source([raw(first, "selected_stage1_binding", "first"), raw(second, "selected_stage1_binding", "second")], "selected_stage1_binding")], policy: structuredClone(DEFAULT_FOOTPRINT_RESOLUTION_POLICY), libraryAvailability: "available", dependencyDigests: [first.recordDigest, second.recordDigest].sort(), collectionDiagnostics: [] };
  const provisional = { ...base, dependencyDigest: "" };
  return { ...base, dependencyDigest: contextTechnicalDigest(provisional) };
}

describe("candidate normalization, deduplication, precedence, and conflicts", () => {
  it("merges only technical equivalence and preserves all origins/evidence", () => {
    const binding = exactCandidate("merge-candidate");
    const second = withBindingDigests({ ...withoutBindingDigests(binding), bindingId: "binding-second", revisionId: "binding-second:r1", lineageId: "lineage-second", origin: { ...binding.origin, sourceRef: "second-source" } });
    const result = normalizeAndDeduplicateCandidates([source([raw(binding, "approved_exact_part_binding", "a")], "approved_exact_part_binding"), source([raw(second, "symbol_attached_fact", "b")], "symbol_attached_fact")], structuredClone(DEFAULT_FOOTPRINT_RESOLUTION_POLICY));
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.originRecords).toHaveLength(2);
    expect(result.groups[0]?.rawCandidateIds).toEqual(["raw-a", "raw-b"]);
  });

  it("does not merge same footprint display name with different content digests", () => {
    const first = exactCandidate("digest-collision", { candidateKeySuffix: "a" });
    const secondBase = exactCandidate("digest-collision", { candidateKeySuffix: "b" });
    const second = withBindingDigests({ ...withoutBindingDigests(secondBase), footprint: { ...secondBase.footprint!, contentDigest: `sha256:${"8".repeat(64)}` } });
    const result = normalizeAndDeduplicateCandidates([source([raw(first, "approved_exact_part_binding", "a"), raw(second, "approved_exact_part_binding", "b")], "approved_exact_part_binding")], structuredClone(DEFAULT_FOOTPRINT_RESOLUTION_POLICY));
    expect(result.candidates).toHaveLength(2);
  });

  it("is invariant to adapter and candidate insertion order", () => {
    const a = exactCandidate("order-invariant", { candidateKeySuffix: "a" }), b = aiSuggestion("order-invariant");
    const left = normalizeAndDeduplicateCandidates([source([raw(a, "approved_exact_part_binding", "a")], "approved_exact_part_binding"), source([raw(b, "ai_catalog_suggestion", "b")], "ai_catalog_suggestion")], structuredClone(DEFAULT_FOOTPRINT_RESOLUTION_POLICY));
    const right = normalizeAndDeduplicateCandidates([source([raw(b, "ai_catalog_suggestion", "b")], "ai_catalog_suggestion"), source([raw(a, "approved_exact_part_binding", "a")], "approved_exact_part_binding")], structuredClone(DEFAULT_FOOTPRINT_RESOLUTION_POLICY));
    expect(right).toEqual(left);
  });

  it("blocks two incompatible current approved selected assets instead of taking first", async () => {
    const result = new DeterministicFootprintResolutionEngine().evaluate(await conflictContext());
    expect(result.status).toBe("blocked_conflict");
    expect(result.resolvedBinding).toBeUndefined();
    expect(result.conflicts.map((item) => item.conflictClass)).toEqual(expect.arrayContaining(["multiple_active_selections", "incompatible_approved_assets"]));
  });

  it("does not let confidence promote an AI suggestion", () => {
    const suggestion = aiSuggestion("confidence-is-not-authority");
    expect(suggestion.origin.actor).toBe(AI_ACTOR);
    expect(suggestion.origin.confidence).toBe(1);
    expect(DEFAULT_FOOTPRINT_RESOLUTION_POLICY.sourceAuthority.ai_catalog_suggestion).toBe("suggestion_only");
    expect(resolverId("confidence", suggestion.origin.confidence)).toBe(resolverId("confidence", 1));
  });
});
