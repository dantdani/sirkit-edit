// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PcbSyncReadinessPanel } from "../PcbSyncReadinessPanel";
import { preflightRequest, readyHarness, snapshot } from "@/app/lib/pcb-sync/__tests__/fixtures";
import { authoritativeSnapshotDigest } from "@/app/lib/pcb-sync/stable";
import { InMemoryPcbSyncSnapshotProvider } from "@/app/lib/pcb-sync/providers";
import { InMemoryPcbSyncRepository } from "@/app/lib/pcb-sync/repository";
import { PcbSynchronizationService } from "@/app/lib/pcb-sync/service";
import { FootprintResolutionService } from "@/app/lib/footprint-resolver/service";
import { InMemoryPhysicalBindingRepository } from "@/app/lib/physical-binding/repository";

describe("PCB synchronization readiness panel", () => {
  it("labels preview as board-unchanged and requires explicit confirmation before apply", async () => {
    const harness = await readyHarness();
    const result = await harness.service.preflight(preflightRequest());
    const onApply = vi.fn();
    render(<PcbSyncReadinessPanel result={result} onApply={onApply} />);
    expect(screen.getByText(/Preview only · Board unchanged/)).toBeTruthy();
    expect(screen.getByText(/Stage 3 does not place or route/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Apply exact plan" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalledWith(result.plan?.planId, result.plan?.planDigest);
  });

  it("shows every exact blocker and keeps apply disabled", async () => {
    const blockedSnapshot = snapshot(["generic-100n"]);
    blockedSnapshot.components[0]!.referenceDesignator = "C1";
    blockedSnapshot.components[0]!.value = "100n";
    const { snapshotDigest: _digest, ...base } = blockedSnapshot;
    void _digest;
    blockedSnapshot.snapshotDigest = authoritativeSnapshotDigest(base);
    const service = new PcbSynchronizationService({ snapshotProvider: new InMemoryPcbSyncSnapshotProvider([blockedSnapshot]), resolver: new FootprintResolutionService(new InMemoryPhysicalBindingRepository()), resourceProvider: { async materialize() { return null; } }, repository: new InMemoryPcbSyncRepository() });
    const result = await service.preflight(preflightRequest());
    render(<PcbSyncReadinessPanel result={result} onApply={vi.fn()} />);
    expect(screen.getByText("PS_COMPONENT_UNRESOLVED")).toBeTruthy();
    expect(screen.getByText(/C1/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply disabled — resolve blockers" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
