/**
 * [PR-M, 2026-10-18] Regression (found by the orchestration browser proof, F6, on the combined L.4 + M1 tree): since PR-M the context
 * assembler claims the registry's `catalog-available` project state exactly with the server's catalog inspection fact, and the
 * gateway's integrity check refuses the state without the fact. The orchestration scheduler withdraws the catalog fact from every
 * specialist and from the coordinator's follow-up turn - so it must withdraw the state, and the two component resolution facts that
 * ride the catalog fact, with it. Before the fix, with the fixture runtime's catalog bound, EVERY specialist call failed
 * `context_integrity` ("the catalog-available state is advertised without the server's catalog inspection fact") and the schematic
 * specialist's exact replacement never sealed: F6 presented nothing.
 */
import { describe, expect, it } from "vitest";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { createAgentToolGateway, verifyAgentContextIntegrity } from "@/app/lib/agent/gateway";
import type { AgentRunContext } from "@/app/lib/agent/contracts";
import { deriveSpecialistContext, isWithdrawnProjectState, withdrawAuthority } from "@/app/lib/agent/orchestration/scheduler";
import { fullContext } from "@/app/lib/agent/orchestration/__tests__/_role-fixtures";

const registry = sirkitToolRegistry();
/** The coordinator's context as the chat route assembles it where the catalog, the revision evidence and the search are bound. */
const coordinator = (): AgentRunContext => fullContext({ catalogInspectionAvailable: true, componentResolutionAvailable: true, catalogSearchAvailable: true });

describe("[PR-M] the orchestration withdraws the catalog facts and the state they imply", () => {
  it("1. the coordinator holds the catalog facts and the catalog-available state, and its context is consistent", () => {
    const context = coordinator();
    expect(context.catalogInspectionAvailable).toBe(true);
    expect(context.componentResolutionAvailable).toBe(true);
    expect(context.catalogSearchAvailable).toBe(true);
    expect(context.discovery.projectState).toContain("catalog-available");
    expect(context.discovery.availableAuthority).toContain("catalog");
    expect(verifyAgentContextIntegrity(context)).toEqual([]);
  });

  it("2. a specialist's context and the follow-up turn's context drop the catalog facts, the catalog authority and the catalog-available state together: the gateway's integrity check holds over both", () => {
    const context = coordinator();
    for (const [label, derived] of [["deriveSpecialistContext", deriveSpecialistContext(context)], ["withdrawAuthority", withdrawAuthority(context)]] as const) {
      expect(verifyAgentContextIntegrity(derived), label).toEqual([]);
      expect(derived.discovery.projectState, label).not.toContain("catalog-available");
      expect(derived.discovery.projectState.filter((state) => isWithdrawnProjectState(state)), label).toEqual([]);
      expect(derived.discovery.availableAuthority, label).not.toContain("catalog");
      expect([derived.catalogInspectionAvailable, derived.componentResolutionAvailable, derived.catalogSearchAvailable], label).toEqual([undefined, undefined, undefined]);
    }
    // only the implied state is withdrawn: every other state the coordinator holds (no editor surface here) is kept
    expect(withdrawAuthority(context).discovery.projectState).toEqual(context.discovery.projectState.filter((state) => state !== "catalog-available"));
    expect(deriveSpecialistContext(context).discovery.projectState).toEqual(context.discovery.projectState.filter((state) => state !== "catalog-available" && !state.endsWith("-surface")));
    // the coordinator's context is read, never written
    expect(context.discovery.projectState).toContain("catalog-available");
    expect(context.catalogInspectionAvailable).toBe(true);
  });

  it("3. through the REAL gateway, a specialist's schematic read over the derived context is answered, never refused context_integrity", async () => {
    const derived = deriveSpecialistContext(coordinator());
    const gateway = createAgentToolGateway(registry);
    const outcome = await gateway.invoke({ runId: "run-m1-withdrawal", provider: "openai", callId: "call-inspect", toolId: "sirkit.schematic.inspect", version: registry.get("sirkit.schematic.inspect")!.version, args: {}, context: derived, timeoutMs: 5_000 });
    expect(outcome.ok, JSON.stringify(outcome).slice(0, 400)).toBe(true);
    expect((outcome as { status?: string }).status).not.toBe("context_integrity");
  });
});
