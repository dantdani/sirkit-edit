import { mkdir, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { FootprintResolutionService } from "../app/lib/footprint-resolver/service";
import { InMemoryPhysicalBindingRepository } from "../app/lib/physical-binding/repository";
import { InMemoryPcbSyncSnapshotProvider } from "../app/lib/pcb-sync/providers";
import { InMemoryPcbSyncRepository } from "../app/lib/pcb-sync/repository";
import { PcbSynchronizationService } from "../app/lib/pcb-sync/service";
import { authoritativeSnapshotDigest } from "../app/lib/pcb-sync/stable";
import { preflightRequest, readyHarness, snapshot } from "../app/lib/pcb-sync/__tests__/fixtures";

function stats(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b);
  return { samples: values.length, meanMs: values.reduce((sum, value) => sum + value, 0) / values.length, p95Ms: ordered[Math.max(0, Math.ceil(values.length * 0.95) - 1)]!, maxMs: ordered.at(-1)! };
}

async function main() {
  const small: number[] = [];
  for (let index = 0; index < 20; index++) {
    const harness = await readyHarness();
    const started = performance.now();
    const result = await harness.service.preflight(preflightRequest({ requestId: `evidence-small-${index}`, mode: "preview" }));
    if (result.status !== "ready_to_apply" || result.summary.boardChanged) throw new Error("PS_EVIDENCE_SMALL_FAILED");
    small.push(performance.now() - started);
  }

  const ids = Array.from({ length: 500 }, (_, index) => `generic-component-${String(index).padStart(4, "0")}`);
  const largeSnapshot = snapshot(ids);
  largeSnapshot.components.forEach((component, index) => { component.referenceDesignator = `C${index + 1}`; component.value = "100n"; });
  const { snapshotDigest: _digest, ...base } = largeSnapshot;
  void _digest;
  largeSnapshot.snapshotDigest = authoritativeSnapshotDigest(base);
  const resolver = new FootprintResolutionService(new InMemoryPhysicalBindingRepository());
  const batchSizes: number[] = [];
  const repository = new InMemoryPcbSyncRepository();
  const largeService = new PcbSynchronizationService({ snapshotProvider: new InMemoryPcbSyncSnapshotProvider([largeSnapshot]), resolver: { async resolveBatch(batch, signal) { batchSizes.push(batch.requests.length); return resolver.resolveBatch(batch, signal); } }, resourceProvider: { async materialize() { return null; } }, repository });
  const largeStarted = performance.now();
  const largeResult = await largeService.preflight(preflightRequest({ requestId: "evidence-large", mode: "preview" }));
  const largeMs = performance.now() - largeStarted;
  if (largeResult.components.length !== 500 || largeResult.status !== "blocked_component_resolution" || largeResult.blockers.length < 500) throw new Error("PS_EVIDENCE_LARGE_FAILED");

  const concurrentHarness = await readyHarness();
  const concurrentStarted = performance.now();
  const concurrent = await Promise.all(Array.from({ length: 16 }, (_, index) => concurrentHarness.service.preflight(preflightRequest({ requestId: `evidence-concurrent-${index}`, mode: "preview" }))));
  const concurrentMs = performance.now() - concurrentStarted;
  if (new Set(concurrent.map((item) => item.plan?.planDigest)).size !== 1) throw new Error("PS_EVIDENCE_CONCURRENCY_FAILED");

  const evidence = {
    schemaVersion: "sirkit.pcb-sync-stage3-qualification-evidence.v1",
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: platform(), release: release(), arch: arch() },
    budgets: { smallPreviewMs: 2_000, blocked500Ms: 10_000, maxApiBytes: 8_000_000, maxTraceSteps: 8_192, resolverBatchMax: 256, resolverBatchConcurrency: 4 },
    measurements: { smallPreview: stats(small), blocked500: { samples: 1, elapsedMs: largeMs, componentAssessments: largeResult.components.length, blockers: largeResult.blockers.length, resultBytes: JSON.stringify(largeResult).length, traceSteps: largeResult.trace.length, batchSizes: batchSizes.sort((a, b) => a - b) }, concurrentPreview16: { elapsedMs: concurrentMs, stablePlanDigestCount: 1 } },
    assertions: { smallBoardUnchanged: true, completeBlockedDiagnostics: true, noLargeBoardCreated: (await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })) === null, concurrentPlanStable: true },
  };
  const directory = join(process.cwd(), "artifacts", "footprint-binding-stage-03");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "qualification-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(evidence, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
