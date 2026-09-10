/**
 * B16-C.1 — the routed-board revision lifecycle through the REAL pcb-sync
 * route handler (trusted scope, closed operations, rollout gate, opt-in
 * header) over the durable stack with lineage.
 *
 * Scenario: one component, one net, routed by hand after the first sync; the
 * schematic then connects a second pin to the net (membership change on
 * protected copper). Preflight is refused; preview shows the rework plan;
 * derive creates `board-1@r1` (the net's copper stripped by proof, membership
 * synchronized); the parent is superseded for every later operation; the
 * board load tells a fresh browser where the current revision is.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { mmToNm } from "@/app/lib/pcb/units";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import { DurableBoardLineageStore } from "@/app/lib/pcb-sync/board-lineage";
import { DurablePcbSyncRepository, DurablePcbSyncSnapshotStore } from "@/app/lib/pcb-sync/durable";
import { PcbSynchronizationService } from "@/app/lib/pcb-sync/service";
import { authoritativeSnapshotDigest } from "@/app/lib/pcb-sync/stable";
import { applyRequest, preflightRequest, readyHarness as baseReadyHarness, snapshot } from "@/app/lib/pcb-sync/__tests__/fixtures";
import type { PcbSyncAuthoritativeSnapshot } from "@/app/lib/pcb-sync/types";
import { createPcbSyncBoardGetCore, createPcbSyncPostHandler } from "../handler";

const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main" } as const;
const APPLY_AT = "2026-07-19T12:01:00.000Z";
const HEADERS = { "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": SCOPE.tenantId, "x-sirkit-project-id": SCOPE.projectId, "x-sirkit-branch-id": SCOPE.branchId };

beforeEach(() => { injectAuthorizedPrincipal({ userId: "human-1", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor" }); });
afterEach(() => { resetInjectedIdentity(); });

function post(body: unknown, extra: Record<string, string> = {}): Request { return new Request("http://localhost/api/pcb-sync", { method: "POST", headers: { ...HEADERS, ...extra }, body: JSON.stringify(body) }); }
async function json<T = Record<string, unknown>>(response: Response): Promise<T> { return (await response.clone().json()) as T; }

function resealed(snap: PcbSyncAuthoritativeSnapshot): PcbSyncAuthoritativeSnapshot { const { snapshotDigest: _d, ...base } = snap; void _d; return { ...base, snapshotDigest: authoritativeSnapshotDigest(base) }; }

async function routedHarness() {
  const source = await baseReadyHarness();
  // A committed, then hand-routed, parent board through the in-memory harness first.
  const preflight = await source.service.preflight(preflightRequest());
  const applied = await source.service.apply(applyRequest(preflight.plan!));
  expect(applied.status).toBe("applied");
  const record = (await source.repository.getBoard({ ...SCOPE, boardId: "board-1" }))!;
  const board = structuredClone(record.board);
  board.tracks.push({ id: "track-1", layer: "copperTop", width: mmToNm(0.25), start: { x: 0, y: 0 }, end: { x: mmToNm(10), y: 0 }, netId: 1, source: "human" });
  // The durable stack: repository + snapshot store + lineage, the schematic now connecting pin 2 to net 1.
  const workflow = new InMemoryDurableWorkflowRepository();
  const repository = new DurablePcbSyncRepository(workflow);
  await repository.publishBoard(makeBoardRecord({ ...SCOPE, boardId: "board-1", board, updatedAt: APPLY_AT }), { expectedRevision: 0, idempotencyKey: "seed-routed" });
  const changed = snapshot(["sync-u1"]);
  changed.components[0]!.pins[1]!.disposition = "connected";
  changed.nets[0]!.members.push({ componentInstanceId: "sync-u1", pinInstanceId: "sync-u1:pin:2", pinNumber: "2" });
  changed.netGraphRevision = "net-graph-r2"; changed.netGraphDigest = "net-graph-digest-r2"; changed.schematicRevision = "schematic-r2";
  source.snapshotProvider.set(resealed(changed));
  const service = new PcbSynchronizationService({ snapshotProvider: source.snapshotProvider, resolver: source.resolver, resourceProvider: source.resourceProvider, repository, clock: () => APPLY_AT, lineage: { workflow } });
  const postHandler = createPcbSyncPostHandler(service, () => "opt_in", { snapshotPublisher: new DurablePcbSyncSnapshotStore(workflow), repository, clock: () => APPLY_AT });
  const loadBoard = createPcbSyncBoardGetCore(repository, () => "opt_in", undefined, new DurableBoardLineageStore(workflow));
  const parent = (await repository.getBoard({ ...SCOPE, boardId: "board-1" }))!;
  return { postHandler, loadBoard, repository, workflow, parent };
}

function revisionRequest(parentRevision: string, extra: Record<string, unknown> = {}) {
  return { requestSchemaVersion: "sirkit.pcb-board-revision-request.v1", requestId: "rev-route-1", designId: "design-1", schematicRevision: "schematic-r2", assemblyVariantId: "variant-default", parent: { boardId: "board-1", expectedBoardRevision: parentRevision }, carry: { copper: true, placement: true, constraints: true }, resolutionPolicyId: "sirkit.default-footprint-resolution", resolutionPolicyVersion: "1.0.0", syncPolicyId: "sirkit.safe-pcb-sync", syncPolicyVersion: "1.0.0", requestedAt: APPLY_AT, ...extra };
}

describe("B16-C.1 routed-board revision through the pcb-sync route", () => {
  it("refused preflight → preview → derive (201) → parent superseded everywhere → board load names the current revision", async () => {
    const h = await routedHarness();
    // The guard, through the route.
    const refused = await json<{ result: { status: string; blockers: Array<{ code: string }> } }>(await h.postHandler(post({ operation: "preflight", request: preflightRequest({ schematicRevision: "schematic-r2", target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: h.parent.revision } }) })));
    expect(refused.result.blockers.map((item) => item.code)).toContain("PS_ROUTED_NET_CHANGE_REQUIRES_STAGE8");
    // Preview (no writes).
    const previewResponse = await h.postHandler(post({ operation: "preview_board_revision", request: revisionRequest(h.parent.revision) }));
    const preview = await json<{ ok: boolean; result: { status: string; revisionPlan: { planId: string; planDigest: string; derivedBoardId: string; nets: Array<{ outcome: string; proof: { reason: string } }> }; parentPreflight: { stage8Blocked: boolean }; derivedPreflight: { status: string; planDigest: string | null; operations: Array<{ kind: string }> } } }>(previewResponse);
    expect(previewResponse.status, JSON.stringify(preview).slice(0, 400)).toBe(200);
    expect(preview.result.status).toBe("ready_to_derive");
    expect(preview.result.parentPreflight.stage8Blocked).toBe(true);
    expect(preview.result.revisionPlan.derivedBoardId).toBe("board-1@r1");
    expect(preview.result.revisionPlan.nets[0]).toMatchObject({ outcome: "copper_stripped", proof: { reason: "endpoint set changed" } });
    expect(preview.result.derivedPreflight.operations.map((item) => item.kind)).toContain("update_unrouted_net_membership");
    expect(await h.repository.getBoard({ ...SCOPE, boardId: "board-1@r1" })).toBeNull();
    const derive = { ...revisionRequest(h.parent.revision, { requestId: "rev-route-1:derive" }), planId: preview.result.revisionPlan.planId, planDigest: preview.result.revisionPlan.planDigest, syncPlanDigest: preview.result.derivedPreflight.planDigest, confirmation: "derive_board_revision", idempotencyKey: "derive-route-1" };
    // Deriving needs the explicit opt-in header, like apply.
    expect((await h.postHandler(post({ operation: "derive_board_revision", request: derive }))).status).toBe(403);
    // A viewer cannot preview or derive.
    injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "viewer" });
    expect((await h.postHandler(post({ operation: "preview_board_revision", request: revisionRequest(h.parent.revision) }))).status).toBe(403);
    injectAuthorizedPrincipal({ userId: "human-1", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor" });
    // A drifted plan is refused before anything is written.
    const drifted = await h.postHandler(post({ operation: "derive_board_revision", request: { ...derive, planDigest: "drifted" } }, { "x-sirkit-pcb-sync-opt-in": "true" }));
    expect(drifted.status).toBe(409);
    expect((await json(drifted)).code).toBe("PS_BOARD_DERIVATION_PLAN_MISMATCH");
    // Derive.
    const derived = await h.postHandler(post({ operation: "derive_board_revision", request: derive }, { "x-sirkit-pcb-sync-opt-in": "true" }));
    const derivedBody = await json<{ ok: boolean; boardChanged: boolean; result: { status: string; derivedBoardId: string; boardRevision: string; generation: number; lineage: { state: string; currentBoardId: string } } }>(derived);
    expect(derived.status, JSON.stringify(derivedBody).slice(0, 400)).toBe(201);
    expect(derivedBody.boardChanged).toBe(true);
    expect(derivedBody.result).toMatchObject({ status: "derived", derivedBoardId: "board-1@r1", generation: 1, lineage: { state: "current", currentBoardId: "board-1@r1" } });
    const child = (await h.repository.getBoard({ ...SCOPE, boardId: "board-1@r1" }))!;
    expect(child.board.tracks).toEqual([]); // stripped by proof
    expect(child.board.footprints[0]!.padNets["2"]).toBe(1); // membership synchronized on the new revision
    expect((await h.repository.getBoard({ ...SCOPE, boardId: "board-1" }))!.board.tracks).toHaveLength(1); // the parent's copper is history, untouched
    // Replay is idempotent (200), a second derivation from the superseded parent is refused (409).
    const replay = await h.postHandler(post({ operation: "derive_board_revision", request: derive }, { "x-sirkit-pcb-sync-opt-in": "true" }));
    expect(replay.status).toBe(200);
    expect((await json<{ result: { status: string } }>(replay)).result.status).toBe("idempotent_replay");
    const again = await h.postHandler(post({ operation: "derive_board_revision", request: { ...derive, idempotencyKey: "derive-route-2" } }, { "x-sirkit-pcb-sync-opt-in": "true" }));
    expect(again.status).toBe(409);
    expect((await json(again)).code).toBe("PS_BOARD_SUPERSEDED");
    // Synchronizing the superseded parent is refused with the bounded code.
    const stale = await json<{ result: { blockers: Array<{ code: string }> } }>(await h.postHandler(post({ operation: "preflight", request: preflightRequest({ requestId: "preflight-stale", schematicRevision: "schematic-r2", target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: h.parent.revision } }) })));
    expect(stale.result.blockers.map((item) => item.code)).toContain("PS_BOARD_SUPERSEDED");
    // A fresh browser that only knows the root id is told where the current revision is.
    const load = await json<{ result: { status: string; lineage: { state: string; supersededBy: string | null; currentBoardId: string; generation: number } } }>(await h.loadBoard(SCOPE, { boardId: "board-1" }));
    expect(load.result.status).toBe("found");
    expect(load.result.lineage).toMatchObject({ state: "superseded", supersededBy: "board-1@r1", currentBoardId: "board-1@r1", generation: 0 });
    const loadChild = await json<{ result: { lineage: { state: string; currentBoardId: string; parentBoardId: string | null } } }>(await h.loadBoard(SCOPE, { boardId: "board-1@r1" }));
    expect(loadChild.result.lineage).toMatchObject({ state: "current", currentBoardId: "board-1@r1", parentBoardId: "board-1" });
  });

  it("malformed revision requests are 400s, never writes", async () => {
    const h = await routedHarness();
    expect((await h.postHandler(post({ operation: "preview_board_revision" }))).status).toBe(400);
    const badCarry = await h.postHandler(post({ operation: "preview_board_revision", request: revisionRequest(h.parent.revision, { carry: { copper: "yes" } }) }));
    expect(badCarry.status).toBe(400);
    expect((await json(badCarry)).code).toBe("PS_BOARD_REVISION_CARRY_INVALID");
    const noConfirmation = await h.postHandler(post({ operation: "derive_board_revision", request: { ...revisionRequest(h.parent.revision), planId: "x", planDigest: "y", syncPlanDigest: null, idempotencyKey: "k" } }, { "x-sirkit-pcb-sync-opt-in": "true" }));
    expect(noConfirmation.status).toBe(400);
    expect((await json(noConfirmation)).code).toBe("PS_BOARD_DERIVATION_CONFIRMATION_REQUIRED");
    expect(await h.repository.getBoard({ ...SCOPE, boardId: "board-1@r1" })).toBeNull();
  });
});
