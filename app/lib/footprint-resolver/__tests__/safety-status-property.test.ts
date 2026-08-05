import { describe, expect, it } from "vitest";
import { FootprintResolutionService } from "../service";
import { deriveFootprintResolutionStatus } from "../engine";
import { normalizeAndDeduplicateCandidates } from "../normalize";
import { DEFAULT_FOOTPRINT_RESOLUTION_POLICY } from "../policy";
import type { CandidateSourceResult, RawFootprintCandidate } from "../types";
import { InMemoryPhysicalBindingRepository, PhysicalBindingService } from "../../physical-binding/repository";
import { withBindingDigests, withoutBindingDigests } from "../../physical-binding/stable";
import { ACTOR, addReadyCandidate, exactCandidate, readyRepository, resolverRequest } from "./fixtures";
import { transition } from "../../physical-binding/__tests__/fixtures";
import { resolutionIssue } from "../validation";

function raw(binding: ReturnType<typeof exactCandidate>, id: string): RawFootprintCandidate { return { schemaVersion: "sirkit.raw-footprint-candidate.v1", rawCandidateId: id, sourceKind: "approved_exact_part_binding", sourceVersion: "test/1", binding }; }
function result(candidates: RawFootprintCandidate[]): CandidateSourceResult { return { sourceKind: "approved_exact_part_binding", sourceVersion: "test/1", status: "success", candidates, diagnostics: [], dependencyDigests: [], durationMs: 0 }; }

describe("status priority, freshness, aliases, and metamorphic safety", () => {
  it("uses a closed deterministic status priority while retaining all issue inputs", () => {
    const issue = (code: string) => resolutionIssue({ code, componentId: "status", message: code, category: "validation" });
    const conflict = { conflictId: "conflict-1", conflictClass: "incompatible_approved_assets" as const, candidateIds: ["a", "b"], blocking: true, message: "conflict", evidenceRefs: [] };
    expect(deriveFootprintResolutionStatus([issue("FR_DEPENDENCY_STALE")], [conflict], [])).toBe("blocked_conflict");
    expect(deriveFootprintResolutionStatus([issue("FR_STAGE1_BINDING_INVALID"), issue("FR_SOURCE_UNAVAILABLE")], [], [])).toBe("blocked_invalid");
    expect(deriveFootprintResolutionStatus([issue("FR_MAPPING_UNSUPPORTED"), issue("FR_PACKAGE_AMBIGUOUS")], [], [])).toBe("blocked_unsupported");
    expect(deriveFootprintResolutionStatus([issue("FR_PACKAGE_MISSING"), issue("FR_APPROVAL_REQUIRED")], [], [])).toBe("unresolved_missing_data");
    expect(deriveFootprintResolutionStatus([], [], [{ eligible: false, primary: "suggestion_only" }])).toBe("deferred_to_user_decision");
    expect(deriveFootprintResolutionStatus([], [], [])).toBe("unresolved_missing_data");
  });

  it("blocks a footprint/mapping after a material dependency becomes stale", async () => {
    const { repository, binding } = await readyRepository("stale-footprint");
    const physical = new PhysicalBindingService(repository);
    const states = await repository.findForComponentVariant({ ...binding.scope, assemblyVariantId: "variant-default" });
    const stale = transition(binding, states[0]!.set.revision, "mark_stale", { actorId: "catalog-monitor", actorKind: "automated_engine", role: "automation", sessionId: "monitor" });
    stale.staleDependencyIds = ["footprint"];
    await physical.transition(states[0]!.set.setId, stale);
    const resolved = await new FootprintResolutionService(repository).resolve(resolverRequest("stale-footprint"));
    expect(resolved.status).toBe("blocked_stale");
    expect(resolved.blockers.map((issue) => issue.code)).toEqual(expect.arrayContaining(["FR_DEPENDENCY_STALE", "FR_MAPPING_STALE"]));
  });

  it("does not recover revoked approval from source confidence or precedence", async () => {
    const { repository, binding } = await readyRepository("revoked-binding");
    const physical = new PhysicalBindingService(repository);
    const state = (await repository.findForComponentVariant({ ...binding.scope, assemblyVariantId: "variant-default" }))[0]!;
    await physical.transition(state.set.setId, transition(binding, state.set.revision, "revoke", ACTOR));
    const resolved = await new FootprintResolutionService(repository).resolve(resolverRequest("revoked-binding"));
    expect(resolved.status).toBe("blocked_unapproved");
    expect(resolved.blockers.map((issue) => issue.code)).toContain("FR_APPROVAL_REVOKED");
  });

  it("preserves explicit package ambiguity instead of selecting the only footprint", async () => {
    const repository = new InMemoryPhysicalBindingRepository();
    const base = exactCandidate("ambiguous-package");
    const ambiguous = withBindingDigests({ ...withoutBindingDigests(base), footprint: { ...base.footprint!, packageCompatibility: "ambiguous" } });
    await addReadyCandidate(repository, ambiguous);
    const resolved = await new FootprintResolutionService(repository).resolve(resolverRequest("ambiguous-package"));
    expect(resolved.status).toBe("unresolved_ambiguous");
    expect(resolved.resolvedBinding).toBeUndefined();
    expect(resolved.blockers.map((issue) => issue.code)).toContain("FR_PACKAGE_AMBIGUOUS");
  });

  it("merges a verified asset across library nickname rename when immutable identity is unchanged", () => {
    const first = exactCandidate("renamed-library", { candidateKeySuffix: "old" });
    const secondBase = exactCandidate("renamed-library", { candidateKeySuffix: "new" });
    const second = withBindingDigests({ ...withoutBindingDigests(secondBase), footprint: { ...secondBase.footprint!, libraryNickname: "Renamed_Project_Library", footprintName: "RenamedDisplayOnly" } });
    const normalized = normalizeAndDeduplicateCandidates([result([raw(first, "old"), raw(second, "new")])], structuredClone(DEFAULT_FOOTPRINT_RESOLUTION_POLICY));
    expect(normalized.candidates).toHaveLength(1);
    expect(normalized.candidates[0]?.contributingBindings).toHaveLength(2);
  });

  it("does not merge the same asset when mapping certificate identity differs", () => {
    const first = exactCandidate("mapping-disagreement", { candidateKeySuffix: "a" });
    const secondBase = exactCandidate("mapping-disagreement", { candidateKeySuffix: "b" });
    const second = withBindingDigests({ ...withoutBindingDigests(secondBase), pinPadMapping: { ...secondBase.pinPadMapping, mappingCertificateId: "mapping-other" }, dependencies: { ...secondBase.dependencies, mappingCertificateId: "mapping-other" } });
    expect(normalizeAndDeduplicateCandidates([result([raw(first, "a"), raw(second, "b")])], structuredClone(DEFAULT_FOOTPRINT_RESOLUTION_POLICY)).candidates).toHaveLength(2);
  });

  it("keeps the technical decision invariant under request ID and requested-time changes that do not cross expiry", async () => {
    const { repository } = await readyRepository("decision-invariance");
    const service = new FootprintResolutionService(repository);
    const first = await service.resolve(resolverRequest("decision-invariance", { requestId: "request-a", requestedAt: "2026-07-18T14:00:00.000Z" }));
    const second = await service.resolve(resolverRequest("decision-invariance", { requestId: "request-b", requestedAt: "2026-07-18T14:00:01.000Z" }));
    expect(second.status).toBe(first.status);
    expect(second.resolvedBinding).toEqual(first.resolvedBinding);
    expect(second.decisionDigest).toBe(first.decisionDigest);
  });
});
