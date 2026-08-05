import { performance } from "node:perf_hooks";
import { InMemoryPhysicalBindingRepository, PhysicalBindingService } from "../app/lib/physical-binding/repository";
import { transition } from "../app/lib/physical-binding/__tests__/fixtures";
import { FootprintResolutionService } from "../app/lib/footprint-resolver/service";
import { compareLegacyResolution, withFootprintResolverShadow } from "../app/lib/footprint-resolver/shadow";
import { normalizeAndDeduplicateCandidates } from "../app/lib/footprint-resolver/normalize";
import { DEFAULT_FOOTPRINT_RESOLUTION_POLICY } from "../app/lib/footprint-resolver/policy";
import type { CandidateSourceResult, RawFootprintCandidate } from "../app/lib/footprint-resolver/types";
import { dnpRepository, exactCandidate, legacyRepository, readyRepository, resolverRequest } from "../app/lib/footprint-resolver/__tests__/fixtures";

function percentile(values: number[], ratio: number): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * ratio) - 1))] ?? 0;
}

function summary(values: number[]) {
  return {
    samples: values.length,
    meanMs: Number((values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)).toFixed(3)),
    p50Ms: Number(percentile(values, 0.5).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...values, 0).toFixed(3)),
  };
}

async function measure(iterations: number, operation: () => Promise<unknown>): Promise<ReturnType<typeof summary>> {
  const values: number[] = [];
  for (let index = 0; index < iterations; index++) {
    const started = performance.now();
    await operation();
    values.push(performance.now() - started);
  }
  return summary(values);
}

async function main(): Promise<void> {
  const exact = await readyRepository("evidence-exact");
  const exactService = new FootprintResolutionService(exact.repository, { clock: () => "2026-07-18T16:00:00.000Z" });
  const emptyService = new FootprintResolutionService(new InMemoryPhysicalBindingRepository(), { clock: () => "2026-07-18T16:00:00.000Z" });
  await exactService.resolve(resolverRequest("evidence-exact"));
  await emptyService.resolve(resolverRequest("evidence-empty"));

  const exactSingle = await measure(50, () => exactService.resolve(resolverRequest("evidence-exact")));
  const missingSingle = await measure(50, () => emptyService.resolve(resolverRequest("evidence-empty")));
  const batchRequests = Array.from({ length: 100 }, (_, index) => resolverRequest(`batch-evidence-${String(index).padStart(3, "0")}`));
  const batch100 = await measure(5, () => emptyService.resolveBatch({ schemaVersion: "sirkit.footprint-resolution-batch-request.v1", batchId: "evidence-batch", requests: batchRequests }));

  const rawCandidates: RawFootprintCandidate[] = Array.from({ length: 256 }, (_, index) => {
    const binding = exactCandidate("normalization-evidence", { candidateKeySuffix: String(index) });
    return { schemaVersion: "sirkit.raw-footprint-candidate.v1", rawCandidateId: `raw-${String(index).padStart(3, "0")}`, sourceKind: "approved_exact_part_binding", sourceVersion: "evidence-source/1", binding };
  });
  const source: CandidateSourceResult = { sourceKind: "approved_exact_part_binding", sourceVersion: "evidence-source/1", status: "success", candidates: rawCandidates, diagnostics: [], dependencyDigests: [], durationMs: 0 };
  const normalization256 = await measure(20, async () => { normalizeAndDeduplicateCandidates([source], structuredClone(DEFAULT_FOOTPRINT_RESOLUTION_POLICY)); });

  const production = async () => ({ boardRevision: "unchanged", components: 1 });
  const disabledShadow = await measure(30, () => withFootprintResolverShadow({ production, observeLegacy: () => ({ status: "unresolved", footprint: null, source: "none", guessedOrDefaulted: false }), resolve: (signal) => emptyService.resolve(resolverRequest("shadow-evidence", { purpose: "shadow_comparison" }), signal), enabled: false, timeoutMs: 500 }));
  const enabledShadow = await measure(30, () => withFootprintResolverShadow({ production, observeLegacy: () => ({ status: "unresolved", footprint: null, source: "none", guessedOrDefaulted: false }), resolve: (signal) => emptyService.resolve(resolverRequest("shadow-evidence", { purpose: "shadow_comparison" }), signal), enabled: true, timeoutMs: 500 }));

  const exactResult = await exactService.resolve(resolverRequest("evidence-exact"));
  const manufacturingResult = await exactService.resolve(resolverRequest("evidence-exact", { requestId: "evidence-manufacturing", purpose: "manufacturing_assessment" }));
  const genericJ1 = await emptyService.resolve(resolverRequest("generic-j1-evidence"));
  const valueOnly = await legacyRepository("generic-100n-evidence", { refDes: "C1", value: "100n", footprintHint: "Capacitor_SMD:C_0603_1608Metric" });
  const generic100n = await new FootprintResolutionService(valueOnly.repository).resolve(resolverRequest("generic-100n-evidence"));
  const capacitor = await legacyRepository("ambiguous-0603-evidence", { refDes: "C1", value: "100n", package: "0603", footprintHint: "Capacitor_SMD:C_0603_1608Metric" });
  const ambiguous0603 = await new FootprintResolutionService(capacitor.repository).resolve(resolverRequest("ambiguous-0603-evidence"));
  const dnp = await dnpRepository("dnp-evidence");
  const dnpResult = await new FootprintResolutionService(dnp.repository).resolve(resolverRequest("dnp-evidence"));
  const stale = await readyRepository("stale-evidence");
  const staleState = (await stale.repository.findForComponentVariant({ ...stale.binding.scope, assemblyVariantId: "variant-default" }))[0]!;
  const staleRequest = transition(stale.binding, staleState.set.revision, "mark_stale", { actorId: "catalog-monitor", actorKind: "automated_engine", sessionId: "evidence", role: "automation" });
  staleRequest.staleDependencyIds = ["footprint"];
  await new PhysicalBindingService(stale.repository).transition(staleState.set.setId, staleRequest);
  const staleResult = await new FootprintResolutionService(stale.repository).resolve(resolverRequest("stale-evidence"));
  const capacitorComparison = compareLegacyResolution({ status: "resolved", footprint: "Capacitor_SMD:C_0603_1608Metric", source: "default", guessedOrDefaulted: true }, genericJ1);

  process.stdout.write(`${JSON.stringify({
    schemaVersion: "sirkit.footprint-resolver-stage2-evidence.v1",
    measuredAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    policy: { maxCandidates: 256, maxBatchSize: 256, adapterTimeoutMs: 1500, cacheMode: "disabled" },
    performance: { exactSingle, missingSingle, batch100, normalization256, disabledShadow, enabledShadow, shadowMeanOverheadMs: Number((enabledShadow.meanMs - disabledShadow.meanMs).toFixed(3)) },
    representative: {
      genericJ1: { status: genericJ1.status, blockerCodes: genericJ1.blockers.map((item) => item.code) },
      generic100n: { status: generic100n.status, blockerCodes: generic100n.blockers.map((item) => item.code) },
      ambiguous0603: { status: ambiguous0603.status, blockerCodes: ambiguous0603.blockers.map((item) => item.code) },
      exactApproved: { status: exactResult.status, assetVersionId: exactResult.resolvedBinding?.footprintAsset.assetVersionId, layout: exactResult.readinessAssessment?.layout },
      layoutResolvedManufacturingIncomplete: { layoutStatus: exactResult.status, manufacturingStatus: manufacturingResult.status, manufacturing: manufacturingResult.readinessAssessment?.manufacturing },
      staleFootprint: { status: staleResult.status, blockerCodes: staleResult.blockers.map((item) => item.code) },
      dnp: { status: dnpResult.status },
      capacitorShadow: capacitorComparison,
    },
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
