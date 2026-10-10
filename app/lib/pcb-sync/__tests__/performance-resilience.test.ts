import { describe, expect, it } from "vitest";
import { FootprintResolutionService } from "../../footprint-resolver/service";
import { InMemoryPhysicalBindingRepository } from "../../physical-binding/repository";
import { InMemoryPcbSyncSnapshotProvider } from "../providers";
import { InMemoryPcbSyncRepository } from "../repository";
import { PcbSynchronizationService } from "../service";
import { authoritativeSnapshotDigest } from "../stable";
import { preflightRequest, readyHarness, snapshot } from "./fixtures";

describe("Stage 3 performance and resilience budgets", () => { // [B24-D1, 2026-10-09] the two performance bounds moved to b24-d1-latency (OD-212); the resilience cases and every correctness assertion stay
  it("preflights and applies the small exact new-board fixture within a generous CI budget", async () => { // [B24-D1, 2026-10-09] its performance bound is the metric moved.pcb-sync-preflight-small-fixture of b24-d1-latency (OD-212)
    const harness = await readyHarness();
    const started = performance.now();
    const result = await harness.service.preflight(preflightRequest());
    const elapsed = performance.now() - started;
    expect(result.status).toBe("ready_to_apply");
    void elapsed; // [B24-D1, 2026-10-09] performance bound moved to b24-d1-latency moved.pcb-sync-preflight-small-fixture (OD-212)
  });

  it("aggregates a 500-component blocked design completely without creating a board", async () => {
    const ids = Array.from({ length: 500 }, (_, index) => `generic-component-${String(index).padStart(4, "0")}`);
    const large = snapshot(ids);
    for (const [index, component] of large.components.entries()) {
      component.referenceDesignator = `C${index + 1}`;
      component.value = "100n";
    }
    const { snapshotDigest: _digest, ...base } = large;
    void _digest;
    large.snapshotDigest = authoritativeSnapshotDigest(base);
    const repository = new InMemoryPcbSyncRepository();
    const rawResolver = new FootprintResolutionService(new InMemoryPhysicalBindingRepository());
    const batchSizes: number[] = [];
    const service = new PcbSynchronizationService({ snapshotProvider: new InMemoryPcbSyncSnapshotProvider([large]), resolver: { async resolveBatch(batch, signal) { batchSizes.push(batch.requests.length); return rawResolver.resolveBatch(batch, signal); } }, resourceProvider: { async materialize() { return null; } }, repository });
    const started = performance.now();
    const result = await service.preflight(preflightRequest({ requestId: "large-blocked" }));
    const elapsed = performance.now() - started;
    expect(result.status).toBe("blocked_component_resolution");
    expect(result.components).toHaveLength(500);
    expect(batchSizes.sort((a, b) => a - b)).toEqual([244, 256]);
    expect(result.components.every((item) => item.status === "blocked_unresolved_footprint")).toBe(true);
    expect(result.components.map((item) => item.componentInstanceId)).toEqual([...ids].sort());
    expect(result.trace.length).toBeLessThanOrEqual(8_192);
    expect(JSON.stringify(result).length).toBeLessThan(8_000_000);
    void elapsed; // [B24-D1, 2026-10-09] performance bound moved to b24-d1-latency moved.pcb-sync-aggregate-500-components (OD-212)
    expect(await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  }, 15_000);

  it("supports bounded concurrent read-only preflights without plan divergence", async () => {
    const harness = await readyHarness();
    const results = await Promise.all(Array.from({ length: 16 }, (_, index) => harness.service.preflight(preflightRequest({ requestId: `concurrent-${index}`, mode: "preview" }))));
    expect(new Set(results.map((item) => item.plan?.planDigest)).size).toBe(1);
    expect(results.every((item) => item.summary.boardChanged === false && item.plan?.lifecycle === "validated")).toBe(true);
    expect(await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it("honors cancellation before snapshot acquisition or resolution", async () => {
    const harness = await readyHarness();
    const controller = new AbortController();
    controller.abort();
    await expect(harness.service.preflight(preflightRequest(), controller.signal)).rejects.toThrow("PS_REQUEST_CANCELLED");
  });
});
