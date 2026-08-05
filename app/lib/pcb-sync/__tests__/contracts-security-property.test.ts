import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePcbSyncPolicy, validatePcbSyncPolicy } from "../policy";
import { compareLegacyPcbSync, ForbiddenLegacyResolverGuard, pcbSyncFeatureState } from "../rollout";
import { authoritativeSnapshotDigest, assertPlanDigest } from "../stable";
import { validatePreflightRequest } from "../validation";
import { InMemoryPcbSyncSnapshotProvider } from "../providers";
import { InMemoryPcbSyncRepository } from "../repository";
import { PcbSynchronizationService } from "../service";
import { PcbSyncTelemetry } from "../observability";
import type { PcbSyncFootprintResolver, PcbSyncPolicy } from "../types";
import { preflightRequest, readyHarness, snapshot } from "./fixtures";

describe("Stage 3 request, security, and authority contracts", () => {
  it("rejects client-supplied target fields and filesystem-shaped board names", () => {
    const extraTarget = preflightRequest({
      target: { kind: "new_board", boardId: "board-1", boardName: "Main Board", boardFormatVersion: "sirkit-json-pcb/1", path: "C:\\secret\\board.json" } as never,
    });
    expect(validatePreflightRequest(extraTarget).map((item) => item.code)).toContain("PS_TARGET_FIELD_UNSUPPORTED");

    for (const boardName of ["../escape", "..", "a/b", "a\\b", "a:stream", "a*board"]) {
      const issues = validatePreflightRequest(preflightRequest({ target: { kind: "new_board", boardId: "board-1", boardName, boardFormatVersion: "sirkit-json-pcb/1" } }));
      expect(issues.map((item) => item.code), boardName).toContain("PS_BOARD_NAME_UNSAFE");
    }
  });

  it("keeps prepare/apply human-authorized while allowing read-only preview", async () => {
    const { service } = await readyHarness();
    const viewer = { ...preflightRequest().actorContext, role: "viewer" as const };
    const preview = await service.preflight(preflightRequest({ mode: "preview", actorContext: viewer }));
    expect(preview.plan?.lifecycle).toBe("validated");
    await expect(service.preflight(preflightRequest({ mode: "prepare_apply", actorContext: viewer }))).rejects.toThrow("PS_PLAN_PREPARATION_AUTHORIZATION_DENIED");
  });

  it("does not allow a configurable policy to cross the routed-board Stage 8 boundary", () => {
    const unsafe = structuredClone(resolvePcbSyncPolicy("sirkit.safe-pcb-sync", "1.0.0")) as PcbSyncPolicy;
    unsafe.allowedAutomaticRisks.push("copper_affecting", "destructive");
    unsafe.blockRoutedStructuralChanges = false as true;
    expect(validatePcbSyncPolicy(unsafe)).toEqual(expect.arrayContaining(["PS_POLICY_MANDATORY_GATE_WEAKENED", "PS_POLICY_STAGE8_BOUNDARY_WEAKENED"]));
  });

  it("fails a corrupted authoritative snapshot before invoking the Stage 2 resolver", async () => {
    const bad = snapshot();
    bad.snapshotDigest = "sha256:corrupted";
    let invocations = 0;
    const resolver: PcbSyncFootprintResolver = {
      async resolveBatch() {
        invocations += 1;
        throw new Error("resolver must not be reached");
      },
    };
    const service = new PcbSynchronizationService({
      snapshotProvider: new InMemoryPcbSyncSnapshotProvider([bad]),
      resolver,
      resourceProvider: { async materialize() { throw new Error("materializer must not be reached"); } },
      repository: new InMemoryPcbSyncRepository(),
    });
    const result = await service.preflight(preflightRequest());
    expect(result.status).toBe("blocked_stale_snapshot");
    expect(result.blockers.map((item) => item.code)).toContain("PS_SNAPSHOT_DIGEST_MISMATCH");
    expect(invocations).toBe(0);
  });

  it("detects plan tampering before apply", async () => {
    const { service } = await readyHarness();
    const result = await service.preflight(preflightRequest());
    const tampered = structuredClone(result.plan!);
    tampered.operations[0]!.afterDigest = "sha256:tampered";
    expect(() => assertPlanDigest(tampered)).toThrow("PS_PLAN_DIGEST_MISMATCH");
  });

  it("contains no forbidden legacy resolver imports or calls in Stage 3 production code", () => {
    const root = join(process.cwd(), "app", "lib", "pcb-sync");
    const production = readdirSync(root).filter((name) => name.endsWith(".ts"));
    const source = production.map((name) => readFileSync(join(root, name), "utf8")).join("\n");
    expect(source).not.toMatch(/heuristicFootprint|guessPackageToken|footprint-assign|netlist-bridge/);
    const guard = new ForbiddenLegacyResolverGuard();
    expect(() => guard.invoke()).toThrow("PS_FORBIDDEN_LEGACY_RESOLVER_INVOCATION");
    expect(guard.count()).toBe(1);
  });

  it("emits pseudonymized telemetry without raw tenant or project identities", async () => {
    const telemetry = new PcbSyncTelemetry();
    const harness = await readyHarness();
    const service = new PcbSynchronizationService({
      snapshotProvider: harness.snapshotProvider,
      resolver: harness.resolver,
      resourceProvider: harness.resourceProvider,
      repository: harness.repository,
      telemetry,
    });
    await service.preflight(preflightRequest());
    const events = telemetry.snapshot();
    expect(events.map((item) => item.metric)).toEqual(expect.arrayContaining(["preflight", "preflight_ms", "component", "operation"]));
    expect(JSON.stringify(events)).not.toContain("tenant-1");
    expect(JSON.stringify(events)).not.toContain("project-1");
    expect(events.every((item) => item.projectPseudonym.startsWith("pcb-sync-project:"))).toBe(true);
  });
});

describe("Stage 3 deterministic and rollout properties", () => {
  it("canonicalizes component, pin, net, member, alias, and issue ordering", () => {
    const original = snapshot(["sync-u1", "sync-u2"]);
    const reordered = structuredClone(original);
    reordered.components.reverse();
    for (const component of reordered.components) component.pins.reverse();
    reordered.nets.reverse();
    for (const net of reordered.nets) {
      net.members.reverse();
      net.aliases.reverse();
      net.explicitNoConnectPinIds.reverse();
      net.constraintRefs.reverse();
    }
    const { snapshotDigest: _originalDigest, ...originalBase } = original;
    const { snapshotDigest: _reorderedDigest, ...reorderedBase } = reordered;
    void _originalDigest; void _reorderedDigest;
    expect(authoritativeSnapshotDigest(reorderedBase)).toBe(authoritativeSnapshotDigest(originalBase));
  });

  it("keeps a technical plan stable across request IDs and timestamps", async () => {
    const firstHarness = await readyHarness();
    const secondHarness = await readyHarness();
    const first = await firstHarness.service.preflight(preflightRequest({ requestId: "request-a", requestedAt: "2026-07-19T12:00:00.000Z" }));
    const second = await secondHarness.service.preflight(preflightRequest({ requestId: "request-b", requestedAt: "2026-07-19T12:05:00.000Z" }));
    expect(second.plan?.planDigest).toBe(first.plan?.planDigest);
    expect(second.plan?.planId).toBe(first.plan?.planId);
  });

  it("defaults rollout to off and classifies unsafe legacy behavior without changing production behavior", async () => {
    expect(pcbSyncFeatureState({})).toBe("off");
    expect(pcbSyncFeatureState({ SIRKIT_PCB_SYNC_STAGE3: "observe" })).toBe("observe");
    expect(pcbSyncFeatureState({ SIRKIT_PCB_SYNC_STAGE3: "invalid" })).toBe("off");

    const bad = snapshot(["generic-c1"]);
    bad.components[0]!.referenceDesignator = "C1";
    bad.components[0]!.value = "100n";
    const { snapshotDigest: _digest, ...base } = bad;
    void _digest;
    bad.snapshotDigest = authoritativeSnapshotDigest(base);
    const emptyHarness = await readyHarness();
    const blockedService = new PcbSynchronizationService({
      snapshotProvider: new InMemoryPcbSyncSnapshotProvider([bad]),
      resolver: { async resolveBatch(request, signal) { return emptyHarness.resolver.resolveBatch(request, signal); } },
      resourceProvider: emptyHarness.resourceProvider,
      repository: new InMemoryPcbSyncRepository(),
    });
    const blocked = await blockedService.preflight(preflightRequest());
    const comparison = compareLegacyPcbSync({ status: "ready", guessedOrDefaulted: true, mutationStarted: true, unresolvedCount: 0 }, blocked);
    expect(comparison).toMatchObject({ category: "legacy_would_guess_new_blocks", risk: "high", stage3BoardChanged: false, productionBehaviorChanged: false });
  });
});
