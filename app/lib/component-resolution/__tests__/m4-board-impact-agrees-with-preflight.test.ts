/**
 * [PR-L6, 2026-10-19] Runbook M.4 / M.5 item 7: the impact shown BEFORE approval agrees with what Prepare PCB then does - measured on
 * the durable stack (the REAL routes over DurablePcbSyncRepository + DurableBoardLineageStore + InMemoryDurableWorkflowRepository, the
 * real footprint resolver over human-approved physical bindings, the real atomic resource provider; see _m4-durable.ts):
 *
 *  - the realistic chain: the LED dimmer with D1 / D2 resolved to the fixture's eligible revision is synchronized; Undo leaves D1 / D2
 *    unresolved ON the board (drift `unresolved`); D1 / D2 are re-resolved to ANOTHER published revision (the drift is now `changed`);
 *    the impact is assessed against the durable board read through the production basis loader (GET /api/pcb-sync include=manufacturing);
 *  - the new revision needs a reviewer's bind: while the board's earlier binding is in effect the bind is refused
 *    (PB_ACTIVE_SELECTION_CONFLICT, the B19-E rule) - the impact discloses it (`rebind`); a reviewer supersedes the earlier binding through
 *    the existing transition operation (API only) and binds the new one; then the real publish and preflight run;
 *  - UNROUTED board: the predicted operation is the plan's (replace_unrouted_footprint), no blocker; after apply the drift is gone;
 *  - ROUTED board: the predicted codes equal the real preflight's Stage 8 blocker codes; the predicted component outcomes and stripped
 *    copper equal previewBoardRevision's plan; the derived board starts with no authority (requalificationRequired), and the basis
 *    loader follows the superseded root to `<root>@r1`;
 *  - a proved pin PERMUTATION: the predicted net codes (a re-identified net: protected with copper, a reconciliation without) equal the
 *    real preflight's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({ snapshots: new Map<string, unknown>() }));
vi.mock("@/app/lib/durable-workflow/runtime", async () => {
  const { InMemoryDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/repository");
  const repo = new InMemoryDurableWorkflowRepository();
  return { getDurableWorkflowRepository: () => repo };
});
vi.mock("@/app/lib/physical-binding/server-repository", async (orig) => {
  const actual = await orig() as object;
  const { InMemoryPhysicalBindingRepository } = await import("@/app/lib/physical-binding/repository");
  const shared = new InMemoryPhysicalBindingRepository();
  class SharedInMemoryPhysicalBindingRepository { constructor() { return shared; } }
  return { ...actual, PostgresPhysicalBindingRepository: SharedInMemoryPhysicalBindingRepository };
});
vi.mock("@/app/lib/atomic/server-catalog", async () => {
  const load = async (revisionId: string) => structuredClone(seams.snapshots.get(revisionId) ?? null);
  const loadAtomicRevisionStatus = async (ids: readonly string[]) => new Map(ids.flatMap((id) => { const snapshot = seams.snapshots.get(id) as { atomicRevision: { logicalPartId: string } } | undefined; return snapshot ? [[id, { revisionId: id, logicalPartId: snapshot.atomicRevision.logicalPartId, state: "published", selectable: true, pinnable: true }] as const] : []; }));
  return { loadPublishedPortableSnapshot: load, loadSelectablePortableSnapshot: load, loadAtomicRevisionStatus };
});

import type { SchematicState } from "@/lib/schematic-types";
import type { CachedPart } from "@/app/lib/parts-cache";
import type { PortableAtomicSnapshot } from "@/app/lib/atomic/types";
import { POST as pcbSyncPost, stage3Repository } from "@/app/api/pcb-sync/route";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import { STAGE8_BLOCKER_CODES, BOARD_REVISION_CONFIRMATION } from "@/app/lib/pcb-sync/board-revision";
import { boardSchematicDrift } from "@/app/lib/pcb-sync/schematic-drift";
import type { PcbSyncBoardRevisionPreviewResult, PcbSyncBoardRevisionDeriveResult } from "@/app/lib/pcb-sync/types";
import { pcbBoardInstanceId, pcbDesignInstanceId } from "@/app/lib/pcb/board-identity";
import { mmToNm } from "@/app/lib/pcb/units";
import { FIXTURE_RESOLUTION_PART_IDS, fixtureRuntimeCatalog } from "@/app/lib/fixture-runtime/blinker/catalog";
import { DIMMER_INSTANCE_IDS, fixtureDimmerSheet } from "@/app/lib/fixture-runtime/__tests__/_resolution-sheet";
import { jsonRequest, readJson, restoreIdentity, signInAs } from "@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/harness";
import { loadResolutionBoardBasis } from "@/app/lib/project/resolution-board-basis";
import { assessResolutionBoardImpact, type BoardImpactItemInput } from "../board-impact";
import { D_AK_SYMBOL_SOURCE, D_SYMBOL_SOURCE, extractedPins, swappedSymbolDiodeRevision, switchingDiodeRevision, type FixtureRevision } from "./_m1-fixtures";
import { bindAll, bindOne, laidOut, preparePcb, readBoard, routedBoardFetch, supersedeBinding, type M4Scope } from "./_m4-durable";

const DIODES = [DIMMER_INSTANCE_IDS.D1, DIMMER_INSTANCE_IDS.D2] as const;
const parts = new Map<string, CachedPart>(fixtureRuntimeCatalog().cachedParts);
let other: FixtureRevision;
let permuted: FixtureRevision;
const OTHER_PART = "m4-part-1n4148w-other";
const PERMUTED_PART = "m4-part-d-ak";

/** The sheet with D1 / D2 placed from `partId` and bound to `revision` (exactly what an applied resolution installs). */
function resolvedTo(partId: string, revision: { revisionId: string; snapshot: PortableAtomicSnapshot }): SchematicState {
  const sheet = fixtureDimmerSheet();
  return { ...sheet, kicadComponents: sheet.kicadComponents!.map((item) => (DIODES.includes(item.id as typeof DIODES[number]) ? { ...item, partId, atomicPartRevisionId: revision.revisionId, symbolAssetVersionId: revision.snapshot.symbol.versionId, footprintAssetVersionId: revision.snapshot.footprint!.versionId, mappingCertificateId: revision.snapshot.mapping!.id } : item)) };
}
function eligible(): { revisionId: string; snapshot: PortableAtomicSnapshot } {
  const revisionId = fixtureRuntimeCatalog().cachedParts.get(FIXTURE_RESOLUTION_PART_IDS.eligibleDiode)!.atomicAssignments![""]!.revisionId;
  return { revisionId, snapshot: fixtureRuntimeCatalog().snapshots.get(revisionId)! };
}
/** The batch's items as the sealed proposal carries them: the target identity and the proved mapping (current pin -> target pin, pads). */
function items(revision: FixtureRevision, mapping: BoardImpactItemInput["mapping"]): BoardImpactItemInput[] {
  return DIODES.map((componentInstanceId, index) => ({ componentInstanceId, refDes: `D${index + 1}`, target: { symbolAssetVersionId: revision.snapshot.symbol.versionId, footprintAssetVersionId: revision.snapshot.footprint!.versionId, mappingCertificateId: revision.snapshot.mapping!.id, footprintFullName: "Diode_SMD:D_SOD-123" }, mapping }));
}
const SAME_NUMBERS = [{ fromPin: "1", toPin: "1", pads: ["1"] }, { fromPin: "2", toPin: "2", pads: ["2"] }];
/** The preflight's own SUMMARY gates (engine.ts: a failed "all components / all nets pass" gate re-states that some item is blocked);
 *  the impact predicts the CAUSES, so the comparison reads the real blockers without these two restatements. */
const SUMMARY_GATES = new Set(["PS_ALL_COMPONENTS_TRANSFER_READY", "PS_ALL_NETS_TRANSFER_READY"]);
const causes = (blockers: ReadonlyArray<{ code: string }>): string[] => [...new Set(blockers.map((item) => item.code).filter((code) => !SUMMARY_GATES.has(code)))].sort();
const PERMUTATION = [{ fromPin: "1", toPin: "2", pads: ["1"] }, { fromPin: "2", toPin: "1", pads: ["2"] }];

/** Sync the dimmer resolved to the eligible revision; optionally route it (one track per net and a via, as B16-C's routed parent). */
async function syncedBoard(scope: M4Scope, routed: boolean) {
  const first = resolvedTo(FIXTURE_RESOLUTION_PART_IDS.eligibleDiode, eligible());
  const bindings = await bindAll(first, scope);
  const synced = await preparePcb(laidOut(first, parts), scope, { expectedSnapshotRevision: 0 });
  expect(synced.preflight.status, JSON.stringify(synced.preflight.blockers).slice(0, 300)).toBe("ready_to_apply");
  if (routed) {
    const head = (await stage3Repository.getBoardHead({ ...scope, boardId: pcbBoardInstanceId(scope.projectId) }))!;
    const board = structuredClone(head.record.board);
    for (const net of board.nets.filter((item) => item.id !== 0)) board.tracks.push({ id: `track-${net.id}`, layer: "copperTop", width: mmToNm(0.25), start: { x: 0, y: mmToNm(net.id) }, end: { x: mmToNm(10), y: mmToNm(net.id) }, netId: net.id, source: "human" });
    board.vias.push({ id: "via-1", at: { x: mmToNm(5), y: mmToNm(1) }, size: mmToNm(0.6), drill: mmToNm(0.3), netId: board.nets.find((item) => item.id !== 0)!.id, layers: ["copperTop", "copperBottom"] });
    await stage3Repository.publishBoard(makeBoardRecord({ ...scope, boardId: head.record.boardId, board, updatedAt: head.record.updatedAt }), { expectedRevision: head.aggregateRevision, idempotencyKey: `m4-route:${scope.projectId}` });
  }
  const record = (await readBoard(scope))!;
  return { first, bindings, record };
}

/** Re-resolution to `revision`: a reviewer's bind is refused while the earlier binding is in effect; supersede it, then bind. */
async function rebind(scope: M4Scope, bindings: Awaited<ReturnType<typeof bindAll>>, next: SchematicState, revisionId: string): Promise<void> {
  expect(await bindOne(scope, DIMMER_INSTANCE_IDS.D1, revisionId)).toEqual({ status: 409, code: "PB_ACTIVE_SELECTION_CONFLICT" });
  for (const id of DIODES) await supersedeBinding(scope, bindings.get(id)!);
  await bindAll(next, scope);
}

function revisionRequest(scope: M4Scope, schematicRevision: string, parentRevision: string) {
  return { requestSchemaVersion: "sirkit.pcb-board-revision-request.v1", requestId: `m4-rev-${scope.projectId}`, designId: pcbDesignInstanceId(scope.projectId), schematicRevision, assemblyVariantId: "variant-default", parent: { boardId: pcbBoardInstanceId(scope.projectId), expectedBoardRevision: parentRevision }, carry: { copper: true, placement: true, constraints: true }, resolutionPolicyId: "sirkit.default-footprint-resolution", resolutionPolicyVersion: "1.0.0", syncPolicyId: "sirkit.safe-pcb-sync", syncPolicyVersion: "1.0.0", requestedAt: new Date().toISOString() };
}

beforeAll(() => {
  vi.stubEnv("SIRKIT_PCB_SYNC_STAGE3", "opt_in");
  for (const [id, snapshot] of fixtureRuntimeCatalog().snapshots) seams.snapshots.set(id, snapshot);
  other = switchingDiodeRevision("m4-agree-other", "1N4148W-7-F");
  permuted = swappedSymbolDiodeRevision("m4-agree-ak", "1N4148WAK-7-F");
  for (const revision of [other, permuted]) seams.snapshots.set(revision.revisionId, revision.snapshot);
  const base = parts.get(FIXTURE_RESOLUTION_PART_IDS.eligibleDiode)!;
  parts.set(OTHER_PART, { ...base, id: OTHER_PART, pins: extractedPins(D_SYMBOL_SOURCE, "D").pins });
  parts.set(PERMUTED_PART, { ...base, id: PERMUTED_PART, name: "D_AK", pins: extractedPins(D_AK_SYMBOL_SOURCE, "D_AK").pins });
});
afterAll(() => { restoreIdentity(); vi.unstubAllEnvs(); });

describe("[PR-L6 M.5-7] the impact before approval agrees with the real Prepare PCB (durable stack)", { timeout: 180_000 }, () => {
  it("1. UNROUTED: resolve -> sync -> Undo (unresolved ON the board) -> re-resolve to another revision: impact = replace_unrouted_footprint; the plan agrees; after apply the drift is gone", async () => {
    const scope = { tenantId: "local", projectId: "m4-agree-unrouted", branchId: "main" };
    const { first, bindings, record } = await syncedBoard(scope, false);
    expect(boardSchematicDrift(first, record.board).items).toEqual([]);
    // Undo of the resolution: D1 / D2 lose their identity while their footprints stay on the board
    expect(boardSchematicDrift(fixtureDimmerSheet(), record.board).items.map((item) => [item.schematicRefDes, item.kind])).toEqual([["D1", "unresolved"], ["D2", "unresolved"]]);
    // re-resolution to another published revision: the impact against the DURABLE board, read by the production loader
    const basis = await loadResolutionBoardBasis(scope, routedBoardFetch(scope));
    expect(basis).toMatchObject({ state: "board", boardId: pcbBoardInstanceId(scope.projectId), authority: null, latestRelease: null });
    if (basis.state !== "board") return;
    expect(basis.record.revision).toBe(record.revision);
    const impact = assessResolutionBoardImpact({ items: items(other, SAME_NUMBERS), basis });
    expect(impact.items.map((item) => [item.schematicRefDes, item.outcome, item.predicted.operation, item.rebind])).toEqual([["D1", "footprint_changed", "replace_unrouted_footprint", true], ["D2", "footprint_changed", "replace_unrouted_footprint", true]]);
    expect(impact).toMatchObject({ predictedCodes: [], requiresBoardRevision: false, invalidates: { placementLegality: true, drc: true, routing: false } });
    const next = resolvedTo(OTHER_PART, other);
    expect(boardSchematicDrift(next, record.board).items.map((item) => [item.schematicRefDes, item.kind])).toEqual([["D1", "changed"], ["D2", "changed"]]);
    // the bind the impact disclosed, then the real publish + preflight: the plan's operations are the predicted ones
    await rebind(scope, bindings, next, other.revisionId);
    const synced = await preparePcb(laidOut(next, parts), scope, { expectedSnapshotRevision: 1, apply: false });
    expect(synced.preflight.status, JSON.stringify(synced.preflight.blockers).slice(0, 400)).toBe("ready_to_apply");
    expect(causes(synced.preflight.blockers)).toEqual(impact.predictedCodes);
    const componentOps = new Map(synced.preflight.plan!.operations.filter((operation) => DIODES.includes(operation.targetStableId as typeof DIODES[number])).map((operation) => [operation.targetStableId, operation.kind]));
    expect(Object.fromEntries(componentOps)).toEqual(Object.fromEntries(impact.items.map((item) => [item.componentInstanceId, item.predicted.operation])));
    // apply: the board now carries the schematic's exact parts - nothing is behind any more (derived again from facts)
    const applied = await preparePcb(laidOut(next, parts), scope, { expectedSnapshotRevision: 1 });
    expect(applied.applied).toBe(true);
    expect(boardSchematicDrift(next, applied.record!.board).items).toEqual([]);
    expect(boardSchematicDrift(first, applied.record!.board).items.map((item) => item.kind)).toEqual(["changed", "changed"]); // a later Undo would show it again
  });

  it("2. ROUTED: the predicted codes equal the real Stage 8 blockers; outcomes and stripped copper equal previewBoardRevision's plan; the derived board has no authority and the loader follows the root to <root>@r1", async () => {
    const scope = { tenantId: "local", projectId: "m4-agree-routed", branchId: "main" };
    const { bindings, record } = await syncedBoard(scope, true);
    expect(record.board.tracks.length).toBeGreaterThan(0);
    const basis = await loadResolutionBoardBasis(scope, routedBoardFetch(scope));
    if (basis.state !== "board") throw new Error(JSON.stringify(basis));
    const impact = assessResolutionBoardImpact({ items: items(other, SAME_NUMBERS), basis });
    expect(impact).toMatchObject({ requiresBoardRevision: true, predictedCodes: ["PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8"], invalidates: { routing: true } });
    const next = resolvedTo(OTHER_PART, other);
    await rebind(scope, bindings, next, other.revisionId);
    const synced = await preparePcb(laidOut(next, parts), scope, { expectedSnapshotRevision: 1, apply: false });
    const actualStage8 = [...new Set(synced.preflight.blockers.map((item) => item.code).filter((code) => STAGE8_BLOCKER_CODES.has(code)))].sort();
    expect(actualStage8).toEqual(impact.predictedCodes);
    expect(causes(synced.preflight.blockers)).toEqual(impact.predictedCodes);
    expect(synced.preflight.blockers.map((item) => item.code)).toContain("PS_ALL_COMPONENTS_TRANSFER_READY"); // the summary gate the comparison sets aside
    // the rework plan the editor's BoardRevisionDialog would show
    signInAs("editor", scope);
    const previewResponse = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "preview_board_revision", request: revisionRequest(scope, synced.schematicRevision, record.revision) }, { scope }));
    const preview = (await readJson<{ result: PcbSyncBoardRevisionPreviewResult }>(previewResponse)).result;
    expect(previewResponse.status).toBe(200);
    expect(preview.parentPreflight.stage8Blocked).toBe(true);
    const planned = new Map(preview.revisionPlan.components.map((item) => [item.componentInstanceId, item.outcome]));
    for (const item of impact.items) expect(planned.get(item.componentInstanceId), item.schematicRefDes).toBe(item.outcome);
    const stripped = preview.revisionPlan.nets.filter((net) => (net.outcome === "copper_stripped" || net.outcome === "removed") && net.copper.tracks + net.copper.vias + net.copper.zones > 0).map((net) => net.stableNetId).sort();
    expect(stripped).toEqual([...impact.copperStripped.nets].sort());
    expect({ tracks: preview.revisionPlan.summary.tracksStripped, vias: preview.revisionPlan.summary.viasStripped }).toEqual({ tracks: impact.copperStripped.tracks, vias: impact.copperStripped.vias });
    expect(preview.revisionPlan.requalificationRequired).toBe(true);
    expect(preview.status, JSON.stringify(preview.derivedPreflight.blockers).slice(0, 300)).toBe("ready_to_derive");
    // derive: the old board is history; the basis loader follows the root to the derived revision, which carries no authority
    const deriveResponse = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "derive_board_revision", request: { ...revisionRequest(scope, synced.schematicRevision, record.revision), requestId: "m4-derive", planId: preview.revisionPlan.planId, planDigest: preview.revisionPlan.planDigest, syncPlanDigest: preview.derivedPreflight.planDigest, confirmation: BOARD_REVISION_CONFIRMATION, idempotencyKey: "m4-derive-1" } }, { scope, headers: { "x-sirkit-pcb-sync-opt-in": "true" } }));
    const derived = (await readJson<{ result: PcbSyncBoardRevisionDeriveResult }>(deriveResponse)).result;
    expect(deriveResponse.status, JSON.stringify(derived).slice(0, 300)).toBe(201);
    expect(derived.derivedBoardId).toBe(`${pcbBoardInstanceId(scope.projectId)}@r1`);
    const followed = await loadResolutionBoardBasis(scope, routedBoardFetch(scope));
    expect(followed).toMatchObject({ state: "board", boardId: `${pcbBoardInstanceId(scope.projectId)}@r1`, authority: null, latestRelease: null });
    if (followed.state !== "board") return;
    expect(boardSchematicDrift(next, followed.record.board).items).toEqual([]); // the derived revision carries the new parts
    expect(assessResolutionBoardImpact({ items: items(other, SAME_NUMBERS), basis: followed })).toMatchObject({ basis: { generation: 1 }, predictedCodes: [] });
  });

  it("3. a proved pin PERMUTATION re-identifies the nets it touches: the predicted net codes equal the real preflight's, routed and unrouted", async () => {
    for (const routed of [false, true]) {
      const scope = { tenantId: "local", projectId: `m4-agree-permutation-${routed ? "routed" : "unrouted"}`, branchId: "main" };
      const { bindings } = await syncedBoard(scope, routed);
      const basis = await loadResolutionBoardBasis(scope, routedBoardFetch(scope));
      if (basis.state !== "board") throw new Error(JSON.stringify(basis));
      const impact = assessResolutionBoardImpact({ items: items(permuted, PERMUTATION), basis });
      expect(impact.nets.filter((net) => net.membershipChanges).length, `routed=${routed}`).toBeGreaterThan(0);
      const next = resolvedTo(PERMUTED_PART, permuted);
      await rebind(scope, bindings, next, permuted.revisionId);
      const synced = await preparePcb(laidOut(next, parts), scope, { expectedSnapshotRevision: 1, apply: false });
      expect(causes(synced.preflight.blockers), `routed=${routed}`).toEqual(impact.predictedCodes);
      expect(impact.predictedCodes, `routed=${routed}`).toEqual(routed ? ["PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8", "PS_REMOVED_NET_PROTECTED"] : ["PS_REMOVED_NET_RECONCILIATION_REQUIRED"]);
    }
  });
});
