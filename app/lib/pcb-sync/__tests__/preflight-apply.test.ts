import { describe, expect, it, vi } from "vitest";

vi.mock("../../footprint-resolver/__tests__/fixtures", async () => {
  const { InMemoryPhysicalBindingRepository, PhysicalBindingService } = await import("../../physical-binding/repository");
  const { createApprovedValidation } = await import("../../physical-binding/transitions");
  const { ACTOR, exactCandidate, transition } = await import("../../physical-binding/__tests__/fixtures");
  return { readyRepository: async (componentId = "resolver-ready") => {
    const repository = new InMemoryPhysicalBindingRepository(), service = new PhysicalBindingService(repository), candidate = exactCandidate(componentId);
    let state = await service.createCandidate(candidate, `create-${candidate.bindingId}`), request = transition(candidate, state.set.revision, "select", ACTOR);
    request.decisionEvidenceRefs = ["evidence-datasheet"];
    state = await service.transition(state.set.setId, request);
    let current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
    request = transition(current, state.set.revision, "revalidate", ACTOR);
    request.validation = createApprovedValidation(current, { validatorVersion: "physical-binding-validator/1", at: request.at, evidenceRefs: ["evidence-mapping"] });
    state = await service.transition(state.set.setId, request);
    current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
    request = transition(current, state.set.revision, "approve", ACTOR);
    request.decisionEvidenceRefs = ["evidence-datasheet"];
    if (componentId === "expiring-u1") request.expiresAt = "2026-07-19T12:00:30.000Z";
    if (componentId === "expiry-boundary-u1") request.expiresAt = "2026-07-19T12:01:00.000Z";
    state = await service.transition(state.set.setId, request);
    return { repository, binding: state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)! };
  } };
});
import { FootprintResolutionService } from "../../footprint-resolver/service";
import { InMemoryPhysicalBindingRepository } from "../../physical-binding/repository";
import { InMemoryPcbSyncResourceProvider, InMemoryPcbSyncSnapshotProvider } from "../providers";
import { InMemoryPcbSyncRepository } from "../repository";
import { PcbSynchronizationService } from "../service";
import { applyRequest, preflightRequest, readyHarness as baseReadyHarness, snapshot } from "./fixtures";
import { authoritativeSnapshotDigest, pcbSyncDigest } from "../stable";
import { makeBoardRecord } from "../board";
import type { PcbSyncAuthoritativeSnapshot, PcbSyncFootprintMaterialization, PcbSyncFootprintResolver } from "../types";

const APPLY_AT = "2026-07-19T12:01:00.000Z";

async function readyHarness(...args: Parameters<typeof baseReadyHarness>) {
  const harness = await baseReadyHarness(...args);
  const service = new PcbSynchronizationService({ snapshotProvider: harness.snapshotProvider, resolver: harness.resolver, resourceProvider: harness.resourceProvider, repository: harness.repository, clock: () => APPLY_AT });
  return { ...harness, service };
}

function serviceAt(harness: Awaited<ReturnType<typeof baseReadyHarness>>, applyAt: string, input: { snapshotProvider?: { acquire(): Promise<PcbSyncAuthoritativeSnapshot> }; resolver?: PcbSyncFootprintResolver; faultInjector?: { hit(point: "after_lock" | "after_revalidation" | "after_stage" | "after_mutation" | "after_serialize" | "after_reparse" | "after_validation" | "before_commit" | "during_commit" | "after_commit"): void } } = {}) {
  return new PcbSynchronizationService({ snapshotProvider: input.snapshotProvider ?? harness.snapshotProvider, resolver: input.resolver ?? harness.resolver, resourceProvider: harness.resourceProvider, repository: harness.repository, faultInjector: input.faultInjector, clock: () => applyAt });
}

function rehashMaterialization(materialization: PcbSyncFootprintMaterialization): void {
  const { artifactDigest: _artifactDigest, ...mappingBase } = materialization.mapping;
  void _artifactDigest;
  materialization.mapping.artifactDigest = pcbSyncDigest(mappingBase);
  const { materializationDigest: _materializationDigest, ...materializationBase } = materialization;
  void _materializationDigest;
  materialization.materializationDigest = pcbSyncDigest({
    ...materializationBase,
    footprintDef: {
      libName: materialization.footprintDef.libName,
      name: materialization.footprintDef.name,
      pads: materialization.footprintDef.pads,
    },
  });
}

describe("Stage 3 complete preflight and atomic apply", () => {
  it("preflights a fully resolved new board without mutation, then applies atomically and emits router handoff", async () => {
    const { service, repository } = await readyHarness();
    expect(await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
    const preflight = await service.preflight(preflightRequest());
    expect(preflight.status).toBe("ready_to_apply");
    expect(preflight.summary).toMatchObject({ totalSchematicComponents: 1, applicableComponents: 1, resolvedComponents: 1, layoutReadyComponents: 1, unresolvedComponents: 0, blockedOperations: 0, boardChanged: false });
    expect(preflight.plan?.lifecycle).toBe("applicable");
    expect(preflight.plan?.operations.map((item) => item.kind)).toEqual(["create_board", "add_net", "add_component_instance", "assign_pad_to_net"]);
    expect(await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();

    const applied = await service.apply(applyRequest(preflight.plan!));
    expect(applied.status).toBe("applied");
    expect(applied.boardChanged).toBe(true);
    expect(applied.routerHandoff).toMatchObject({ boardId: "board-1", unresolvedComponentCount: 0, structuralValidationStatus: "passed", routingState: "unrouted" });
    const committed = await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" });
    expect(committed?.board.footprints[0]?.syncIdentity).toMatchObject({ componentInstanceId: "sync-u1", footprintAssetVersionId: "footprint-stm32-ufqfpn48:r3", mappingCertificateId: "mapping-certificate-1" });
    expect(committed?.board.footprints[0]?.padNets).toEqual({ "1": 1 });
    expect(committed?.board.nets.find((item) => item.stableId === "stable-net-1")?.endpointKeys).toEqual(["sync-u1::1"]);
    expect(await repository.listAudits({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toHaveLength(1);
  });

  it("returns ready_no_changes after a committed sync and creates no applicable churn plan", async () => {
    const { service, repository } = await readyHarness();
    const first = await service.preflight(preflightRequest());
    const applied = await service.apply(applyRequest(first.plan!));
    const before = await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" });
    const second = await service.preflight(preflightRequest({ requestId: "preflight-2", target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: applied.committedBoardRevision! }, mode: "prepare_apply" }));
    expect(second.status).toBe("ready_no_changes");
    expect(second.plan?.lifecycle).toBe("validated");
    expect(second.plan?.operations.every((item) => item.kind === "preserve_component_instance" || item.kind === "preserve_net")).toBe(true);
    expect(await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toEqual(before);
  });

  it("blocks generic J1 early and never creates a board", async () => {
    const snap = snapshot(["generic-j1"]);
    snap.components[0]!.referenceDesignator = "J1";
    const { snapshotDigest: _j1Digest, ...j1Base } = snap;
    void _j1Digest;
    snap.snapshotDigest = authoritativeSnapshotDigest(j1Base);
    const snapshotProvider = new InMemoryPcbSyncSnapshotProvider([snap]);
    const repository = new InMemoryPcbSyncRepository();
    const service = new PcbSynchronizationService({ snapshotProvider, resolver: new FootprintResolutionService(new InMemoryPhysicalBindingRepository()), resourceProvider: new InMemoryPcbSyncResourceProvider({}), repository });
    const result = await service.preflight(preflightRequest());
    expect(result.status).toBe("blocked_component_resolution");
    expect(result.components[0]).toMatchObject({ referenceDesignator: "J1", status: "blocked_unresolved_footprint", proposedOperation: "blocked" });
    expect(result.blockers.map((item) => item.code)).toContain("PS_COMPONENT_UNRESOLVED");
    expect(result.summary.boardChanged).toBe(false);
    expect(await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it("blocks value-only 100n without inventing 0603", async () => {
    const snap = snapshot(["generic-100n"]);
    snap.components[0]!.referenceDesignator = "C1";
    snap.components[0]!.value = "100n";
    const { snapshotDigest: _capDigest, ...capBase } = snap;
    void _capDigest;
    snap.snapshotDigest = authoritativeSnapshotDigest(capBase);
    const repository = new InMemoryPcbSyncRepository();
    const service = new PcbSynchronizationService({ snapshotProvider: new InMemoryPcbSyncSnapshotProvider([snap]), resolver: new FootprintResolutionService(new InMemoryPhysicalBindingRepository()), resourceProvider: new InMemoryPcbSyncResourceProvider({}), repository });
    const result = await service.preflight(preflightRequest());
    expect(result.status).toBe("blocked_component_resolution");
    expect(JSON.stringify(result)).not.toContain("0603");
    expect(result.components[0]?.status).toBe("blocked_unresolved_footprint");
  });

  it("returns a precise mapping blocker and does not partially apply ready components", async () => {
    const harness = await readyHarness();
    const bad = structuredClone(harness.materialization);
    bad.mapping.entries = bad.mapping.entries.filter((entry) => entry.symbolPinNumber !== "1");
    rehashMaterialization(bad);
    const repository = new InMemoryPcbSyncRepository();
    const service = new PcbSynchronizationService({ snapshotProvider: harness.snapshotProvider, resolver: harness.resolver, resourceProvider: new InMemoryPcbSyncResourceProvider({ "sync-u1": bad }), repository });
    const result = await service.preflight(preflightRequest());
    expect(result.status).toBe("blocked_mapping");
    expect(result.components[0]?.status).toBe("blocked_mapping");
    expect(result.blockers.map((item) => item.code)).toContain("PS_MAPPING_PIN_MISSING");
    expect(result.plan?.lifecycle).toBe("validated");
    expect(await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it("blocks an unauthorized duplicate physical-pad claim before board mutation", async () => {
    const harness = await readyHarness();
    const bad = structuredClone(harness.materialization);
    bad.mapping.entries[1]!.padNumbers = ["1"];
    rehashMaterialization(bad);
    const repository = new InMemoryPcbSyncRepository();
    const service = new PcbSynchronizationService({
      snapshotProvider: harness.snapshotProvider,
      resolver: harness.resolver,
      resourceProvider: new InMemoryPcbSyncResourceProvider({ "sync-u1": bad }),
      repository,
    });

    const result = await service.preflight(preflightRequest({ requestId: "duplicate-pad-owner" }));

    expect(result.status).toBe("blocked_conflict");
    expect(result.blockers.map((item) => item.code)).toContain("PS_MAPPING_PAD_OWNERSHIP_CONFLICT");
    expect(await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it("accepts authorized many-pad mapping and an explicit mechanical hole", async () => {
    const harness = await readyHarness();
    const valid = structuredClone(harness.materialization);
    valid.mapping.entries[0]!.padNumbers = ["1", "2"];
    valid.mapping.entries[0]!.mappingKind = "internally-common";
    valid.mapping.entries[1]!.padNumbers = [];
    valid.mapping.entries[1]!.mappingKind = "intentional-no-connect";
    valid.footprintDef.pads.push({
      number: "MH",
      type: "np_thru_hole",
      shape: { kind: "circle", radius: 500_000 },
      at: { x: 0, y: 2_000_000 },
      rotationDeg: 0,
      layers: [],
      drill: { diameter: 800_000 },
    });
    valid.mapping.mechanicalPadNumbers = ["MH"];
    rehashMaterialization(valid);
    const service = new PcbSynchronizationService({
      snapshotProvider: harness.snapshotProvider,
      resolver: harness.resolver,
      resourceProvider: new InMemoryPcbSyncResourceProvider({ "sync-u1": valid }),
      repository: harness.repository,
    });

    const result = await service.preflight(preflightRequest({ requestId: "authorized-multiplicity" }));

    expect(result.status).toBe("ready_to_apply");
    expect(result.blockers).toEqual([]);
  });

  it("blocks an unaccounted exposed electrical pad before board mutation", async () => {
    const harness = await readyHarness();
    const bad = structuredClone(harness.materialization);
    bad.footprintDef.pads.push({ ...structuredClone(bad.footprintDef.pads[0]!), number: "EP" });
    rehashMaterialization(bad);
    const repository = new InMemoryPcbSyncRepository();
    const service = new PcbSynchronizationService({
      snapshotProvider: harness.snapshotProvider,
      resolver: harness.resolver,
      resourceProvider: new InMemoryPcbSyncResourceProvider({ "sync-u1": bad }),
      repository,
    });

    const result = await service.preflight(preflightRequest({ requestId: "missing-exposed-pad" }));

    expect(result.status).toBe("blocked_mapping");
    expect(result.blockers.map((item) => item.code)).toContain("PS_MAPPING_UNCLASSIFIED_FOOTPRINT_PAD");
    expect(await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it("blocks canonical reference collisions before resolution or board mutation", async () => {
    const conflicting = snapshot(["sync-u1", "sync-u2"]);
    conflicting.components[1]!.referenceDesignator = "u1";
    const { snapshotDigest: _digest, ...base } = conflicting;
    void _digest;
    conflicting.snapshotDigest = authoritativeSnapshotDigest(base);
    const harness = await readyHarness();
    const repository = new InMemoryPcbSyncRepository();
    const service = new PcbSynchronizationService({
      snapshotProvider: new InMemoryPcbSyncSnapshotProvider([conflicting]),
      resolver: harness.resolver,
      resourceProvider: harness.resourceProvider,
      repository,
    });

    const result = await service.preflight(preflightRequest({ requestId: "canonical-ref-collision" }));

    expect(result.status).toBe("blocked_conflict");
    expect(result.blockers.map((item) => item.code)).toContain("PS_REFERENCE_DESIGNATOR_DUPLICATE");
    expect(await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it("fails closed on schematic net deletion and preserves unrelated copper exactly", async () => {
    const harness = await readyHarness();
    const initial = await harness.service.preflight(preflightRequest({ requestId: "deletion-base" }));
    await harness.service.apply(applyRequest(initial.plan!, { requestId: "deletion-base-apply", idempotencyKey: "deletion-base-apply" }));
    const committed = await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" });
    const board = structuredClone(committed!.board);
    board.nets.push({ id: 2, stableId: "removed-stable-net", name: "OLD", endpointKeys: [] });
    board.tracks.push({ id: "preserved-track", layer: "copperTop", width: 250_000, start: { x: 0, y: 0 }, end: { x: 1_000_000, y: 0 }, netId: 1 });
    board.vias.push({ id: "preserved-via", at: { x: 1_000_000, y: 0 }, size: 800_000, drill: 400_000, netId: 1, layers: ["copperTop", "copperBottom"] });
    board.zones.push({ id: "preserved-zone", layer: "copperTop", netId: 1, polygon: [{ x: 0, y: 0 }, { x: 2_000_000, y: 0 }, { x: 0, y: 2_000_000 }], appearance: "solid", connection: "thermal", fill: [], dirty: true });
    const routed = makeBoardRecord({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1", board, updatedAt: APPLY_AT });
    harness.repository.seedBoard(routed);

    const result = await harness.service.preflight(preflightRequest({ requestId: "deletion-attempt", target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: routed.revision } }));

    expect(result.status).toBe("blocked_net_integrity");
    expect(result.blockers.map((item) => item.code)).toContain("PS_REMOVED_NET_RECONCILIATION_REQUIRED");
    expect((await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" }))?.board).toEqual(board);
  });

  it("never guesses the identity of a legacy numbered net", async () => {
    const harness = await readyHarness();
    const initial = await harness.service.preflight(preflightRequest({ requestId: "legacy-base" }));
    await harness.service.apply(applyRequest(initial.plan!, { requestId: "legacy-base-apply", idempotencyKey: "legacy-base-apply" }));
    const committed = await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" });
    const board = structuredClone(committed!.board);
    delete board.nets[1]!.stableId;
    const legacy = makeBoardRecord({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1", board, updatedAt: APPLY_AT });
    harness.repository.seedBoard(legacy);

    const result = await harness.service.preflight(preflightRequest({ requestId: "legacy-attempt", target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: legacy.revision } }));

    expect(result.status).toBe("blocked_net_integrity");
    expect(result.blockers.map((item) => item.code)).toContain("PS_BOARD_NET_IDENTITY_UNKNOWN");
    expect((await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" }))?.board).toEqual(board);
  });

  it("replays one committed plan idempotently without a second audit", async () => {
    const { service, repository } = await readyHarness();
    const preflight = await service.preflight(preflightRequest());
    const request = applyRequest(preflight.plan!);
    const first = await service.apply(request);
    const second = await service.apply({ ...request, requestId: "apply-retry", requestedAt: "2026-07-19T12:02:00.000Z" });
    expect(first.status).toBe("applied");
    expect(second.status).toBe("idempotent_replay");
    expect(second.committedBoardRevision).toBe(first.committedBoardRevision);
    expect(await repository.listAudits({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toHaveLength(1);
  });

  it("keeps preview read-only and unable to create apply authority", async () => {
    const { service, repository } = await readyHarness();
    const preview = await service.preflight(preflightRequest({ mode: "preview" }));
    expect(preview.status).toBe("ready_to_apply");
    expect(preview.plan?.lifecycle).toBe("validated");
    await expect(service.apply(applyRequest(preview.plan!))).rejects.toThrow("PS_PLAN_DIGEST_OR_LIFECYCLE_MISMATCH");
    expect(await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it("rejects an AI apply even when it knows the exact plan", async () => {
    const { service } = await readyHarness();
    const preflight = await service.preflight(preflightRequest());
    await expect(service.apply(applyRequest(preflight.plan!, { actorContext: { actorId: "agent", actorKind: "ai", sessionId: "agent-session", role: "pcb_editor" } }))).rejects.toThrow("PS_APPLY_AUTHORIZATION_DENIED");
  });

  it("binds plan retrieval to exact tenant/project/branch/board scope", async () => {
    const { service } = await readyHarness();
    const preflight = await service.preflight(preflightRequest());
    expect(await service.getPlan(preflight.plan!.planId, { tenantId: "tenant-other", projectId: "project-1", branchId: "main", boardId: "board-1" }, preflightRequest().actorContext)).toBeNull();
    expect(await service.getPlan(preflight.plan!.planId, { tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" }, preflightRequest().actorContext)).toMatchObject({ planDigest: preflight.plan!.planDigest });
  });

  it("uses stable identity rather than reference designator for reconciliation", async () => {
    const { service, repository } = await readyHarness();
    const first = await service.preflight(preflightRequest());
    const applied = await service.apply(applyRequest(first.plan!));
    const renamed = snapshot(["sync-u1"]);
    renamed.components[0]!.referenceDesignator = "U99";
    const { snapshotDigest: _digest, ...base } = renamed;
    void _digest;
    renamed.snapshotDigest = authoritativeSnapshotDigest(base);
    const renamedService = new PcbSynchronizationService({ snapshotProvider: new InMemoryPcbSyncSnapshotProvider([renamed]), resolver: (await readyHarness()).resolver, resourceProvider: (await readyHarness()).resourceProvider, repository });
    const result = await renamedService.preflight(preflightRequest({ requestId: "rename", target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: applied.committedBoardRevision! } }));
    expect(result.status).toBe("ready_to_apply");
    expect(result.components[0]).toMatchObject({ componentInstanceId: "sync-u1", proposedOperation: "update_reference_designator", risk: "metadata_only" });
  });

  it("uses one trusted apply instant, rejects expiry at equality, and ignores caller time for authority", async () => {
    const harness = await readyHarness(), preflight = await harness.service.preflight(preflightRequest());
    const applied = await harness.service.apply(applyRequest(preflight.plan!, { requestedAt: "2099-01-01T00:00:00.000Z" }));
    expect(applied).toMatchObject({ status: "applied", completedAt: APPLY_AT, audit: { occurredAt: APPLY_AT }, routerHandoff: { generatedAt: APPLY_AT } });

    const boundaryHarness = await readyHarness(), boundaryPlan = await boundaryHarness.service.preflight(preflightRequest({ requestId: "expiry-boundary" }));
    await expect(serviceAt(boundaryHarness, boundaryPlan.plan!.expiresAt).apply(applyRequest(boundaryPlan.plan!, { requestId: "expiry-boundary-apply", requestedAt: boundaryPlan.plan!.createdAt }))).rejects.toThrow("PS_PLAN_EXPIRED");
    expect(await boundaryHarness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();

    const regressionHarness = await readyHarness(), regressionPlan = await regressionHarness.service.preflight(preflightRequest({ requestId: "clock-regression" }));
    const beforeCreation = new Date(Date.parse(regressionPlan.plan!.createdAt) - 1).toISOString();
    await expect(serviceAt(regressionHarness, beforeCreation).apply(applyRequest(regressionPlan.plan!, { requestId: "clock-regression-apply", requestedAt: APPLY_AT }))).rejects.toThrow("PS_APPLY_CLOCK_REGRESSION");
    await expect(serviceAt(regressionHarness, "not-a-time").apply(applyRequest(regressionPlan.plan!, { requestId: "invalid-clock" }))).rejects.toThrow("PS_TRUSTED_CLOCK_INVALID");
  });

  it.each(["expiring-u1", "expiry-boundary-u1"])("rejects approval expiry at trusted apply time for %s", async (componentId) => {
    const harness = await readyHarness(componentId), preflight = await harness.service.preflight(preflightRequest({ requestId: `approval-${componentId}` }));
    expect(preflight.status).toBe("ready_to_apply");
    const result = await harness.service.apply(applyRequest(preflight.plan!, { requestId: `apply-approval-${componentId}`, requestedAt: preflight.plan!.createdAt }));
    expect(result).toMatchObject({ status: "blocked_stale", boardChanged: false });
    expect(await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it.each(["schematic", "library"] as const)("blocks a current %s snapshot revision change without board publication", async (kind) => {
    const harness = await readyHarness();
    let current = structuredClone(harness.snapshot);
    const snapshotProvider = { async acquire() { return structuredClone(current); } };
    const service = serviceAt(harness, APPLY_AT, { snapshotProvider });
    const preflight = await service.preflight(preflightRequest({ requestId: `current-${kind}` }));
    current = { ...current, ...(kind === "schematic" ? { schematicDigest: "schematic-digest-r2" } : { librarySnapshotRevision: "library-r2" }) };
    const { snapshotDigest: _digest, ...base } = current;
    current.snapshotDigest = authoritativeSnapshotDigest(base);
    const result = await service.apply(applyRequest(preflight.plan!, { requestId: `apply-current-${kind}` }));
    expect(result).toMatchObject({ status: "blocked_stale", boardChanged: false });
    expect(await harness.repository.getBoard({ ...preflight.plan!.scope, boardId: "board-1" })).toBeNull();
  });

  it.each(["binding", "mapping", "policy"] as const)("blocks a current %s authority dependency change", async (kind) => {
    const harness = await readyHarness();
    let changed = false;
    const resolver: PcbSyncFootprintResolver = { async resolveBatch(request, signal) {
      const batch = structuredClone(await harness.resolver.resolveBatch(request, signal));
      if (!changed) return batch;
      const result = batch.results[0]!;
      if (kind === "binding") {
        result.inputSnapshot.effectiveSelectedRevisionIds = ["binding-revision-r99"];
        if (result.resolvedBinding) result.resolvedBinding.bindingRevisionId = "binding-revision-r99";
      } else if (kind === "mapping") {
        if (result.resolvedBinding) result.resolvedBinding.pinPadMapping.mappingCertificateId = "mapping-certificate-r99";
        result.decisionDigest = pcbSyncDigest({ previous: result.decisionDigest, mapping: "r99" });
      } else result.inputSnapshot.dependencyDigest = pcbSyncDigest({ previous: result.inputSnapshot.dependencyDigest, policy: "r99" });
      batch.dependencyDigest = pcbSyncDigest(batch.results.map((item) => item.inputSnapshot.dependencyDigest));
      return batch;
    } };
    const service = serviceAt(harness, APPLY_AT, { resolver }), preflight = await service.preflight(preflightRequest({ requestId: `current-${kind}` }));
    changed = true;
    const result = await service.apply(applyRequest(preflight.plan!, { requestId: `apply-current-${kind}` }));
    expect(result).toMatchObject({ status: "blocked_stale", boardChanged: false });
    expect(await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it("blocks a changed board revision and preserves the externally changed board", async () => {
    const harness = await readyHarness(), preflight = await harness.service.preflight(preflightRequest({ requestId: "board-race" }));
    const external = makeBoardRecord({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1", board: harness.snapshot.newBoardTemplate!, updatedAt: APPLY_AT });
    harness.repository.seedBoard(external);
    const result = await harness.service.apply(applyRequest(preflight.plan!, { requestId: "board-race-apply" }));
    expect(result).toMatchObject({ status: "blocked_stale", boardChanged: false });
    expect(await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toEqual(external);
  });

  it("revalidates again after staging so a dependency change before final commit cannot publish", async () => {
    const harness = await readyHarness();
    let current = structuredClone(harness.snapshot), changed = false;
    const snapshotProvider = { async acquire() { return structuredClone(current); } };
    const service = serviceAt(harness, APPLY_AT, { snapshotProvider, faultInjector: { hit(point) {
      if (point !== "before_commit" || changed) return;
      changed = true;
      current = { ...current, librarySnapshotRevision: "library-after-staging" };
      const { snapshotDigest: _digest, ...base } = current;
      current.snapshotDigest = authoritativeSnapshotDigest(base);
    } } });
    const preflight = await service.preflight(preflightRequest({ requestId: "toctou" }));
    const result = await service.apply(applyRequest(preflight.plan!, { requestId: "toctou-apply" }));
    expect(result).toMatchObject({ status: "blocked_stale", boardChanged: false });
    expect(await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });
});
