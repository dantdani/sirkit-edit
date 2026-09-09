/**
 * B16-C.1 — routed-board REVISION lifecycle on the durable stack.
 *
 * The Stage 8 guard (no structural sync once protected copper exists) is
 * untouched: every change kind below is FIRST shown to be refused on the
 * routed parent, THEN carried out by deriving a new board revision whose
 * copper survives only where the semantic-equivalence proof holds.
 *
 * Change kinds (runbook B16-C.1): component add, remove, replace (footprint),
 * net rename, footprint change, pin-map change, board outline change, rules
 * (constraints) change — each on a previously routed board; plus the lineage
 * invariants: old board immutable and superseded, derived board starts with
 * no authority, an old revision can never be synchronized or derived again.
 */
import { describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { FootprintResolutionService } from "../../footprint-resolver/service";
import { addReadyCandidate } from "../../footprint-resolver/__tests__/fixtures";
import { InMemoryPhysicalBindingRepository } from "../../physical-binding/repository";
import { exactCandidate } from "../../physical-binding/__tests__/fixtures";
import { pcbBoardLineageOf, pcbDerivedBoardInstanceId } from "../../pcb/board-identity";
import type { PcbBoard } from "../../pcb/types";
import { mmToNm } from "../../pcb/units";
import { makeBoardRecord } from "../board";
import { DurableBoardLineageStore, deriveBoardRevision as commitBoardRevision } from "../board-lineage";
import { BOARD_REVISION_CONFIRMATION, previewBoardRevision } from "../board-revision";
import { DurablePcbSyncRepository } from "../durable";
import { InMemoryPcbSyncResourceProvider, InMemoryPcbSyncSnapshotProvider } from "../providers";
import { PcbSynchronizationService } from "../service";
import { authoritativeSnapshotDigest, pcbSyncDigest } from "../stable";
import type { PcbSyncAuthoritativeSnapshot, PcbSyncBoardRevisionDeriveRequest, PcbSyncBoardRevisionRequest, PcbSyncFootprintMaterialization } from "../types";
import { applyRequest, footprintDef, NOW, preflightRequest, snapshot } from "./fixtures";
import { ACTOR } from "../../physical-binding/__tests__/fixtures";

const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" } as const;
const CLOCK = "2026-07-19T12:01:00.000Z";
const ALL = { copper: true, placement: true, constraints: true } as const;

function materializationFor(componentId: string, binding: Awaited<ReturnType<typeof addReadyCandidate>>): PcbSyncFootprintMaterialization {
  const def = footprintDef();
  const mappingBase = { schemaVersion: "sirkit.verified-pin-pad-mapping.v1" as const, mappingCertificateId: binding.pinPadMapping.mappingCertificateId!, verifierVersion: "stage3-test-mapper/1", state: "verified" as const, symbolAssetVersionId: binding.pinPadMapping.symbolAssetVersionId!, footprintAssetVersionId: binding.footprint!.assetVersionId, footprintContentDigest: binding.footprint!.contentDigest!, entries: [
    { symbolPinNumber: "1", pinInstanceId: `${componentId}:pin:1`, padNumbers: ["1"], mappingKind: "electrical" as const },
    { symbolPinNumber: "2", pinInstanceId: `${componentId}:pin:2`, padNumbers: ["2"], mappingKind: "electrical" as const },
  ], mechanicalPadNumbers: [], evidenceRefs: ["mapping-evidence"] };
  const mapping = { ...mappingBase, artifactDigest: pcbSyncDigest(mappingBase) };
  const base = { componentInstanceId: componentId, bindingRevisionId: binding.revisionId, assetVersionId: binding.footprint!.assetVersionId, assetContentDigest: binding.footprint!.contentDigest!, assetSemanticDigest: binding.footprint!.semanticDigest, footprintFullName: `${def.libName}:${def.name}`, footprintDef: def, mapping };
  return { ...base, materializationDigest: pcbSyncDigest({ ...base, footprintDef: { libName: def.libName, name: def.name, pads: def.pads } }) };
}

/** The production composition (durable repository + lineage) over in-memory durable storage, with N resolvable components. */
async function durableHarness(componentIds: string[], options: { snapshot?: PcbSyncAuthoritativeSnapshot; board?: PcbBoard; boardId?: string; workflow?: InMemoryDurableWorkflowRepository } = {}) {
  const bindings = new InMemoryPhysicalBindingRepository();
  const materializations: Record<string, PcbSyncFootprintMaterialization> = {};
  for (const id of componentIds) materializations[id] = materializationFor(id, await addReadyCandidate(bindings, exactCandidate(id)));
  const workflow = options.workflow ?? new InMemoryDurableWorkflowRepository();
  const repository = new DurablePcbSyncRepository(workflow);
  if (options.board) await repository.publishBoard(makeBoardRecord({ ...SCOPE, boardId: options.boardId ?? "board-1", board: options.board, updatedAt: NOW }), { expectedRevision: 0, idempotencyKey: `seed:${options.boardId ?? "board-1"}:${pcbSyncDigest(options.board).slice(0, 12)}` });
  const snapshotProvider = new InMemoryPcbSyncSnapshotProvider([options.snapshot ?? snapshot(componentIds)]);
  const resolver = new FootprintResolutionService(bindings, { clock: () => NOW });
  const service = new PcbSynchronizationService({ snapshotProvider, resolver, resourceProvider: new InMemoryPcbSyncResourceProvider(materializations), repository, clock: () => CLOCK, lineage: { workflow } });
  return { service, repository, workflow, snapshotProvider, lineage: new DurableBoardLineageStore(workflow) };
}

function resealed(snap: PcbSyncAuthoritativeSnapshot): PcbSyncAuthoritativeSnapshot {
  const { snapshotDigest: _d, ...base } = snap; void _d;
  return { ...base, snapshotDigest: authoritativeSnapshotDigest(base) };
}

/** A routed, committed parent board for `componentIds`: every net carries one track and (for the first) a via. */
async function routedParent(componentIds: string[]) {
  const seed = await durableHarness(componentIds);
  const preflight = await seed.service.preflight(preflightRequest());
  expect(preflight.status, JSON.stringify(preflight.blockers)).toBe("ready_to_apply");
  const applied = await seed.service.apply(applyRequest(preflight.plan!));
  expect(applied.status).toBe("applied");
  const record = (await seed.repository.getBoard({ ...SCOPE, boardId: "board-1" }))!;
  const board = structuredClone(record.board);
  for (const net of board.nets.filter((item) => item.id !== 0)) {
    board.tracks.push({ id: `track-${net.id}`, layer: "copperTop", width: mmToNm(0.25), start: { x: 0, y: mmToNm(net.id) }, end: { x: mmToNm(10), y: mmToNm(net.id) }, netId: net.id, source: "human" });
  }
  board.vias.push({ id: "via-1", at: { x: mmToNm(5), y: mmToNm(1) }, size: mmToNm(0.6), drill: mmToNm(0.3), netId: board.nets.find((item) => item.id !== 0)!.id, layers: ["copperTop", "copperBottom"] });
  return board;
}

function revisionRequest(parentRevision: string, extra: Partial<PcbSyncBoardRevisionRequest> = {}): PcbSyncBoardRevisionRequest {
  return { requestSchemaVersion: "sirkit.pcb-board-revision-request.v1", requestId: "rev-1", ...SCOPE, designId: "design-1", schematicRevision: "schematic-r1", assemblyVariantId: "variant-default", parent: { boardId: "board-1", expectedBoardRevision: parentRevision }, carry: { ...ALL }, resolutionPolicyId: "sirkit.default-footprint-resolution", resolutionPolicyVersion: "1.0.0", syncPolicyId: "sirkit.safe-pcb-sync", syncPolicyVersion: "1.0.0", actorContext: ACTOR, requestedAt: NOW, ...extra };
}

function deriveRequest(preview: { revisionPlan: { planId: string; planDigest: string }; derivedPreflight: { planDigest: string | null } }, base: PcbSyncBoardRevisionRequest, idempotencyKey = "derive-1"): PcbSyncBoardRevisionDeriveRequest {
  return { ...base, requestId: `${base.requestId}:derive`, planId: preview.revisionPlan.planId, planDigest: preview.revisionPlan.planDigest, syncPlanDigest: preview.derivedPreflight.planDigest, confirmation: BOARD_REVISION_CONFIRMATION, idempotencyKey };
}

describe("B16-C.1 routed-board revision — the Stage 8 guard stays, the product path goes around it", () => {
  it("component ADD on a routed board: refused on the parent; the derived revision keeps the proven copper and adds the component", async () => {
    const parent = await routedParent(["sync-u1"]);
    const harness = await durableHarness(["sync-u1", "sync-u2"], { snapshot: snapshot(["sync-u1", "sync-u2"]), board: parent });
    const record = (await harness.repository.getBoard({ ...SCOPE, boardId: "board-1" }))!;
    // 1. the guard: adding to a routed board is refused, copper untouched.
    const blocked = await harness.service.preflight(preflightRequest({ target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: record.revision } }));
    expect(blocked.status).toBe("blocked_board_risk");
    expect(blocked.blockers.map((item) => item.code)).toContain("PS_STRUCTURAL_ADD_REQUIRES_UNROUTED_BOARD");
    // 2. the rework plan.
    const base = revisionRequest(record.revision);
    const preview = await harness.service.previewBoardRevision(base);
    expect(preview.status, JSON.stringify(preview.derivedPreflight.blockers)).toBe("ready_to_derive");
    expect(preview.parentPreflight.stage8Blocked).toBe(true);
    expect(preview.revisionPlan.derivedBoardId).toBe(pcbDerivedBoardInstanceId("board-1", 1));
    expect(preview.revisionPlan.components.map((item) => [item.componentInstanceId, item.outcome])).toEqual([["sync-u1", "kept"], ["sync-u2", "added"]]);
    const net1 = preview.revisionPlan.nets.find((item) => item.stableNetId === "stable-net-1")!;
    expect(net1.outcome).toBe("copper_retained");
    expect(net1.proof.equivalent).toBe(true);
    expect(net1.proof.parentEndpoints).toEqual(net1.proof.nextEndpoints);
    expect(net1.copper).toEqual({ tracks: 1, vias: 1, zones: 0 });
    expect(preview.revisionPlan.nets.find((item) => item.stableNetId === "stable-net-2")!.outcome).toBe("added");
    expect(preview.revisionPlan.summary).toMatchObject({ componentsKept: 1, componentsAdded: 1, netsRetained: 1, netsAdded: 1, tracksRetained: 1, tracksStripped: 0, viasRetained: 1 });
    expect(preview.revisionPlan.humanReviewRequired).toBe(true);
    expect(preview.revisionPlan.requalificationRequired).toBe(true);
    expect(preview.derivedPreflight.operations.map((item) => item.kind)).toEqual(expect.arrayContaining(["add_component_instance", "add_net"]));
    // Deterministic: the same inputs seal the same plan.
    const again = await harness.service.previewBoardRevision(base);
    expect(again.revisionPlan.planDigest).toBe(preview.revisionPlan.planDigest);
    expect(again.derivedPreflight.planDigest).toBe(preview.derivedPreflight.planDigest);
    // 3. derive (human, confirmed, pinned).
    const derived = await harness.service.deriveBoardRevision(deriveRequest(preview, base));
    expect(derived.status).toBe("derived");
    expect(derived.derivedBoardId).toBe("board-1@r1");
    expect(derived.generation).toBe(1);
    expect(derived.lineage).toMatchObject({ boardId: "board-1@r1", state: "current", currentBoardId: "board-1@r1", parentBoardId: "board-1" });
    const child = (await harness.repository.getBoard({ ...SCOPE, boardId: "board-1@r1" }))!;
    expect(child.revision).toBe(derived.boardRevision);
    expect(child.board.footprints.map((item) => item.syncIdentity?.componentInstanceId).sort()).toEqual(["sync-u1", "sync-u2"]);
    expect(child.board.tracks).toEqual(parent.tracks); // proven copper carried byte-for-byte
    expect(child.board.vias).toEqual(parent.vias);
    expect(child.board.nets.filter((item) => item.id !== 0).map((item) => item.stableId).sort()).toEqual(["stable-net-1", "stable-net-2"]);
    const u1 = child.board.footprints.find((item) => item.syncIdentity?.componentInstanceId === "sync-u1")!;
    expect(u1.at).toEqual(parent.footprints[0]!.at); // placement carried
    // 4. the parent is immutable and superseded; the derived board is current; nothing on the parent changed.
    const parentAfter = (await harness.repository.getBoard({ ...SCOPE, boardId: "board-1" }))!;
    expect(parentAfter).toEqual(record);
    expect(await harness.lineage.resolveCurrent(SCOPE, "board-1")).toMatchObject({ state: "superseded", supersededBy: "board-1@r1", currentBoardId: "board-1@r1" });
    // 5. an old revision can never be synchronized or derived again.
    const stale = await harness.service.preflight(preflightRequest({ requestId: "preflight-stale", target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: record.revision } }));
    expect(stale.blockers.map((item) => item.code)).toContain("PS_BOARD_SUPERSEDED");
    await expect(harness.service.deriveBoardRevision(deriveRequest(preview, base, "derive-2"))).rejects.toThrow("PS_BOARD_SUPERSEDED");
    // 6. the same idempotency key replays without a second derivation.
    const replay = await harness.service.deriveBoardRevision(deriveRequest(preview, base));
    expect(replay.status).toBe("idempotent_replay");
    expect(replay.derivedBoardId).toBe("board-1@r1");
    // 7. the derived board synchronizes ordinarily from here (nothing left to do).
    const next = await harness.service.preflight(preflightRequest({ requestId: "preflight-derived", target: { kind: "existing_board", boardId: "board-1@r1", expectedBoardRevision: child.revision } }));
    expect(next.status, JSON.stringify(next.blockers)).toBe("ready_no_changes");
  });

  it("component REMOVE: the removed component's copper is stripped, the other net's copper is proven and retained", async () => {
    const parent = await routedParent(["sync-u1", "sync-u2"]);
    const harness = await durableHarness(["sync-u1"], { snapshot: snapshot(["sync-u1"]), board: parent });
    const record = (await harness.repository.getBoard({ ...SCOPE, boardId: "board-1" }))!;
    const blocked = await harness.service.preflight(preflightRequest({ target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: record.revision } }));
    expect(blocked.blockers.map((item) => item.code)).toContain("PS_REMOVED_NET_PROTECTED");
    const base = revisionRequest(record.revision);
    const preview = await harness.service.previewBoardRevision(base);
    expect(preview.status, JSON.stringify(preview.derivedPreflight.blockers)).toBe("ready_to_derive");
    expect(preview.revisionPlan.components.find((item) => item.componentInstanceId === "sync-u2")).toMatchObject({ outcome: "removed", carried: false });
    expect(preview.revisionPlan.nets.find((item) => item.stableNetId === "stable-net-2")).toMatchObject({ outcome: "removed", copper: { tracks: 1, vias: 0, zones: 0 } });
    expect(preview.revisionPlan.nets.find((item) => item.stableNetId === "stable-net-1")!.outcome).toBe("copper_retained");
    expect(preview.revisionPlan.summary).toMatchObject({ componentsRemoved: 1, netsRemoved: 1, tracksRetained: 1, tracksStripped: 1, viasRetained: 1 });
    const derived = await harness.service.deriveBoardRevision(deriveRequest(preview, base));
    const child = (await harness.repository.getBoard({ ...SCOPE, boardId: derived.derivedBoardId }))!;
    expect(child.board.footprints).toHaveLength(1);
    expect(child.board.tracks.map((item) => item.id)).toEqual(["track-1"]);
    expect(child.board.nets.filter((item) => item.id !== 0).map((item) => item.stableId)).toEqual(["stable-net-1"]);
  });

  it("net MEMBERSHIP change strips only that net's copper; net RENAME (same identity, same endpoints) keeps it", async () => {
    const parent = await routedParent(["sync-u1", "sync-u2"]);
    const changed = snapshot(["sync-u1", "sync-u2"]);
    changed.components[0]!.pins[1]!.disposition = "connected";
    changed.nets[0]!.members.push({ componentInstanceId: "sync-u1", pinInstanceId: "sync-u1:pin:2", pinNumber: "2" }); // membership change on net 1
    changed.nets[1]!.displayName = "SIG2_RENAMED"; // rename only on net 2
    changed.netGraphRevision = "net-graph-r2"; changed.netGraphDigest = "net-graph-digest-r2";
    const harness = await durableHarness(["sync-u1", "sync-u2"], { snapshot: resealed(changed), board: parent });
    const record = (await harness.repository.getBoard({ ...SCOPE, boardId: "board-1" }))!;
    const blocked = await harness.service.preflight(preflightRequest({ target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: record.revision } }));
    expect(blocked.blockers.map((item) => item.code)).toContain("PS_ROUTED_NET_CHANGE_REQUIRES_STAGE8");
    const base = revisionRequest(record.revision);
    const preview = await harness.service.previewBoardRevision(base);
    expect(preview.status, JSON.stringify(preview.derivedPreflight.blockers)).toBe("ready_to_derive");
    const net1 = preview.revisionPlan.nets.find((item) => item.stableNetId === "stable-net-1")!;
    expect(net1.outcome).toBe("copper_stripped");
    expect(net1.proof.equivalent).toBe(false);
    expect(net1.proof.reason).toBe("endpoint set changed");
    expect(net1.proof.nextEndpoints.length).toBe(net1.proof.parentEndpoints.length + 1);
    const net2 = preview.revisionPlan.nets.find((item) => item.stableNetId === "stable-net-2")!;
    expect(net2.outcome).toBe("copper_retained");
    expect(net2.displayName).toBe("SIG2_RENAMED");
    const derived = await harness.service.deriveBoardRevision(deriveRequest(preview, base));
    const child = (await harness.repository.getBoard({ ...SCOPE, boardId: derived.derivedBoardId }))!;
    expect(child.board.tracks.map((item) => item.id)).toEqual(["track-2"]);
    expect(child.board.vias).toEqual([]); // the via sat on net 1
    expect(child.board.nets.find((item) => item.stableId === "stable-net-2")?.name).toContain("SIG2_RENAMED");
    const u1 = child.board.footprints.find((item) => item.syncIdentity?.componentInstanceId === "sync-u1")!;
    expect(u1.padNets["2"]).toBe(child.board.nets.find((item) => item.stableId === "stable-net-1")!.id); // the new membership was synchronized on the derived board
  });

  it("FOOTPRINT change and PIN-MAP change drop the component (re-added by the sync) and strip its copper", async () => {
    for (const field of ["footprintAssetVersionId", "mappingCertificateId"] as const) {
      const parent = await routedParent(["sync-u1", "sync-u2"]);
      parent.footprints[0]!.syncIdentity![field] = `${field}:previous-revision`;
      const harness = await durableHarness(["sync-u1", "sync-u2"], { snapshot: snapshot(["sync-u1", "sync-u2"]), board: parent });
      const record = (await harness.repository.getBoard({ ...SCOPE, boardId: "board-1" }))!;
      const blocked = await harness.service.preflight(preflightRequest({ target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: record.revision } }));
      expect(blocked.blockers.map((item) => item.code), field).toContain("PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8");
      const base = revisionRequest(record.revision);
      const preview = await harness.service.previewBoardRevision(base);
      expect(preview.status, `${field}: ${JSON.stringify(preview.derivedPreflight.blockers)}`).toBe("ready_to_derive");
      expect(preview.revisionPlan.components.find((item) => item.componentInstanceId === "sync-u1")).toMatchObject({ outcome: field === "footprintAssetVersionId" ? "footprint_changed" : "pin_map_changed", carried: false });
      expect(preview.revisionPlan.nets.find((item) => item.stableNetId === "stable-net-1")).toMatchObject({ outcome: "copper_stripped" });
      expect(preview.revisionPlan.nets.find((item) => item.stableNetId === "stable-net-2")).toMatchObject({ outcome: "copper_retained" });
      const derived = await harness.service.deriveBoardRevision(deriveRequest(preview, base));
      const child = (await harness.repository.getBoard({ ...SCOPE, boardId: derived.derivedBoardId }))!;
      const u1 = child.board.footprints.find((item) => item.syncIdentity?.componentInstanceId === "sync-u1")!;
      expect(u1.syncIdentity![field]).not.toBe(`${field}:previous-revision`); // re-added with the CURRENT exact authority
      expect(child.board.tracks.map((item) => item.id)).toEqual(["track-2"]);
    }
  });

  it("board OUTLINE change is carried explicitly with copper retained; constraints are carried only on request", async () => {
    const parent = await routedParent(["sync-u1"]);
    parent.constraintState = { schemaVersion: 1, documents: [], waivers: [], legacyMigration: { version: 1, sourceHash: "test" }, history: [] } as unknown as PcbBoard["constraintState"];
    const harness = await durableHarness(["sync-u1"], { board: parent });
    const record = (await harness.repository.getBoard({ ...SCOPE, boardId: "board-1" }))!;
    const outline = { kind: "rect" as const, width: mmToNm(60), height: mmToNm(40), origin: { x: 0, y: 0 } };
    const withOutline = await harness.service.previewBoardRevision(revisionRequest(record.revision, { outline, carry: { copper: true, placement: true, constraints: false } }));
    expect(withOutline.revisionPlan.outline).toEqual({ changed: true, kind: "rect" });
    expect(withOutline.revisionPlan.nets[0]!.outcome).toBe("copper_retained");
    expect(withOutline.revisionPlan.constraints).toMatchObject({ carried: false, parentProgramHash: null });
    expect(withOutline.revisionPlan.derived.boardClass).toBe("routed");
    const kept = await harness.service.previewBoardRevision(revisionRequest(record.revision, { carry: { copper: true, placement: true, constraints: true } }));
    expect(kept.revisionPlan.outline.changed).toBe(false);
    expect(kept.revisionPlan.constraints.carried).toBe(true);
    expect(kept.revisionPlan.planDigest).not.toBe(withOutline.revisionPlan.planDigest);
    // Without copper (or without placement) nothing is retained, by the operator's explicit choice — and the derived board says why per net.
    const noCopper = await harness.service.previewBoardRevision(revisionRequest(record.revision, { carry: { copper: false, placement: true, constraints: false } }));
    expect(noCopper.revisionPlan.nets[0]).toMatchObject({ outcome: "copper_stripped", proof: { equivalent: true, reason: "copper not carried forward by the operator's choice" } });
    expect(noCopper.revisionPlan.derived).toMatchObject({ tracks: 0, vias: 0, boardClass: "placed_unrouted" });
    const noPlacement = await harness.service.previewBoardRevision(revisionRequest(record.revision, { carry: { copper: true, placement: false, constraints: true } }));
    expect(noPlacement.revisionPlan.components[0]).toMatchObject({ outcome: "placement_reset", carried: false });
    expect(noPlacement.revisionPlan.nets[0]!.outcome).toBe("copper_stripped");
    expect(noPlacement.status).toBe("ready_to_derive"); // the sync re-places the component on the derived board
  });

  it("refusals: unconfirmed, non-human, drifted plan, stale parent, wrong role — and the plan's derived digest must match the board being written", async () => {
    const parent = await routedParent(["sync-u1"]);
    const harness = await durableHarness(["sync-u1", "sync-u2"], { snapshot: snapshot(["sync-u1", "sync-u2"]), board: parent });
    const record = (await harness.repository.getBoard({ ...SCOPE, boardId: "board-1" }))!;
    const base = revisionRequest(record.revision);
    const preview = await harness.service.previewBoardRevision(base);
    await expect(harness.service.deriveBoardRevision({ ...deriveRequest(preview, base), confirmation: "apply_exact_plan" as never })).rejects.toThrow("PS_BOARD_DERIVATION_CONFIRMATION_REQUIRED");
    await expect(harness.service.deriveBoardRevision({ ...deriveRequest(preview, base), actorContext: { ...ACTOR, actorKind: "ai" } })).rejects.toThrow("PS_BOARD_DERIVATION_HUMAN_REQUIRED");
    await expect(harness.service.deriveBoardRevision({ ...deriveRequest(preview, base), planDigest: "drifted" })).rejects.toThrow("PS_BOARD_DERIVATION_PLAN_MISMATCH");
    await expect(harness.service.deriveBoardRevision({ ...deriveRequest(preview, base), syncPlanDigest: null })).rejects.toThrow("PS_BOARD_DERIVATION_PLAN_MISMATCH");
    await expect(harness.service.deriveBoardRevision({ ...deriveRequest(preview, base), parent: { boardId: "board-1", expectedBoardRevision: "pcb2-stale" } })).rejects.toThrow("PS_BOARD_REVISION_MISMATCH");
    await expect(harness.service.previewBoardRevision({ ...base, actorContext: { ...ACTOR, role: "viewer" } })).rejects.toThrow("PS_BOARD_DERIVATION_AUTHORIZATION_DENIED");
    await expect(harness.service.previewBoardRevision({ ...base, carry: { copper: "yes" } as never })).rejects.toThrow("PS_BOARD_REVISION_CARRY_INVALID");
    // The lineage commit itself refuses a board that is not the plan's stripped board.
    const pure = previewBoardRevision({ parent: record, snapshot: snapshot(["sync-u1", "sync-u2"]), assessments: [], carry: { ...ALL } });
    const tampered = structuredClone(pure.derivedBoard); tampered.outline = { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(123), height: mmToNm(45) };
    await expect(commitBoardRevision(harness.workflow, { plan: pure.plan, strippedBoard: tampered, finalBoard: tampered, parent: record, actor: ACTOR, at: NOW, idempotencyKey: "tamper", syncPlan: null })).rejects.toThrow("PS_BOARD_REVISION_PLAN_MISMATCH");
    expect(await harness.repository.getBoard({ ...SCOPE, boardId: "board-1@r1" })).toBeNull();
    expect((await harness.lineage.describe(SCOPE, "board-1")).state).toBe("current");
  });

  it("lineage chains: a derived revision can itself be derived; the root resolves to the newest current board; ids parse", async () => {
    const parent = await routedParent(["sync-u1"]);
    const workflow = new InMemoryDurableWorkflowRepository();
    const first = await durableHarness(["sync-u1", "sync-u2"], { snapshot: snapshot(["sync-u1", "sync-u2"]), board: parent, workflow });
    const r0 = (await first.repository.getBoard({ ...SCOPE, boardId: "board-1" }))!;
    const p1 = await first.service.previewBoardRevision(revisionRequest(r0.revision));
    const d1 = await first.service.deriveBoardRevision(deriveRequest(p1, revisionRequest(r0.revision)));
    const r1 = (await first.repository.getBoard({ ...SCOPE, boardId: d1.derivedBoardId }))!;
    // Route the derived board (copper on the new net too), then change the schematic again: remove U2.
    const routed = structuredClone(r1.board);
    const net2 = routed.nets.find((item) => item.stableId === "stable-net-2")!;
    routed.tracks.push({ id: "track-r1-2", layer: "copperTop", width: mmToNm(0.25), start: { x: 0, y: mmToNm(20) }, end: { x: mmToNm(10), y: mmToNm(20) }, netId: net2.id, source: "human" });
    const second = await durableHarness(["sync-u1"], { snapshot: snapshot(["sync-u1"]), board: routed, boardId: d1.derivedBoardId, workflow: new InMemoryDurableWorkflowRepository() });
    // (fresh durable store seeded with the routed @r1 as a generation-1 board so the chain continues from it)
    const r1Routed = (await second.repository.getBoard({ ...SCOPE, boardId: "board-1@r1" }))!;
    expect(pcbBoardLineageOf("board-1@r1")).toEqual({ rootBoardId: "board-1", generation: 1 });
    const p2 = await second.service.previewBoardRevision(revisionRequest(r1Routed.revision, { parent: { boardId: "board-1@r1", expectedBoardRevision: r1Routed.revision } }));
    expect(p2.revisionPlan.derivedBoardId).toBe("board-1@r2");
    expect(p2.revisionPlan.parent).toMatchObject({ generation: 1, rootBoardId: "board-1" });
    const d2 = await second.service.deriveBoardRevision(deriveRequest(p2, revisionRequest(r1Routed.revision, { parent: { boardId: "board-1@r1", expectedBoardRevision: r1Routed.revision } })));
    expect(d2.derivedBoardId).toBe("board-1@r2");
    expect(await second.lineage.resolveCurrent(SCOPE, "board-1@r1")).toMatchObject({ state: "superseded", supersededBy: "board-1@r2", currentBoardId: "board-1@r2" });
    expect(await second.lineage.resolveCurrent(SCOPE, "board-1@r2")).toMatchObject({ state: "current", currentBoardId: "board-1@r2", parentBoardId: "board-1@r1" });
  });
});
