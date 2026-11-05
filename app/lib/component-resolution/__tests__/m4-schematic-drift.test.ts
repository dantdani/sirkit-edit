/**
 * [PR-L6, 2026-10-19] Runbook M.4 / M.5 item 7 (OD-253 item 8): the board behind the schematic, DERIVED FROM FACTS
 * (app/lib/pcb-sync/schematic-drift.ts). Kept beside the other M suites (not under app/lib/pcb-sync/__tests__, which the B24-D0
 * prompt-to-Gerber CI selection measures file by file; the M suites are admitted to CI together in increment 7).
 *
 *  - each category (changed, unresolved, missing-from-board, removed-from-schematic), keyed by the stable component instance id: a
 *    reference rename or a board `ref` that differs never misattributes; board-only footprints and boards with no synchronized
 *    footprint give no drift; Undo / Redo of the schematic and a serialize / reload of both artifacts give the same drift from the same
 *    facts (nothing is remembered);
 *  - the DOMAIN GUARD (mandatory before the in-page gates are switched on): a board synchronized by the REAL PcbSynchronizationService
 *    - through the real routes, the real footprint resolver over human-approved physical bindings, the real atomic resource provider
 *    and the durable repositories - from an atomically bound schematic has ZERO drift right after apply, for the fixture blinker
 *    authority (the prompt-to-Gerber design) and for the LED dimmer with its D1 / D2 resolved to the fixture's eligible revision.
 *    Otherwise the prompt-to-Gerber release step would be falsely gated.
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
import { createEmptyBoard, type FootprintInstance, type PcbBoard } from "@/app/lib/pcb/types";
import { boardBehindSchematicNotice, boardSchematicDrift, manufacturingGateRefusal, syncIdentityDifferences } from "@/app/lib/pcb-sync/schematic-drift";
import { BLINKER_NETLIST, BLINKER_PART_IDS, FIXTURE_RESOLUTION_PART_IDS, fixtureRuntimeCatalog } from "@/app/lib/fixture-runtime/blinker/catalog";
import { DIMMER_INSTANCE_IDS, fixtureDimmerSheet } from "@/app/lib/fixture-runtime/__tests__/_resolution-sheet";
import { layoutProposal, restoreIdentity } from "@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/harness";
import { bindAll, laidOut, preparePcb } from "./_m4-durable";

// ─── pure facts ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ID = (n: number) => ({ symbolAssetVersionId: `sym-${n}`, footprintAssetVersionId: `fp-${n}`, mappingCertificateId: `map-${n}` });

function instance(id: string, refDes: string, identity: ReturnType<typeof ID> | null): NonNullable<SchematicState["kicadComponents"]>[number] {
  return { id, partId: `part-${id}`, x: 0, y: 0, rotation: 0, refDes, value: "", ...(identity ? { atomicPartRevisionId: `rev-${identity.footprintAssetVersionId}`, ...identity } : {}) };
}
function footprint(componentInstanceId: string, ref: string, identity: ReturnType<typeof ID> | null): FootprintInstance {
  return {
    id: componentInstanceId, ref, footprintId: identity?.footprintAssetVersionId ?? "board-only", def: { libName: "T", name: "T", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "" },
    at: { x: 0, y: 0 }, rotationDeg: 0, side: "top", padNets: {},
    ...(identity ? { syncIdentity: { componentInstanceId, bindingRevisionId: `binding-${componentInstanceId}`, footprintContentDigest: `sha256:${identity.footprintAssetVersionId}`, syncPlanId: "plan-1", ...identity } } : {}),
  };
}
const sheet = (instances: ReturnType<typeof instance>[]): SchematicState => ({ components: [], kicadComponents: instances, wires: [], netLabels: [] });
const board = (footprints: FootprintInstance[]): PcbBoard => ({ ...createEmptyBoard(), footprints });

describe("[PR-L6 M.5-7] boardSchematicDrift: one comparator, derived from the two artifacts", () => {
  it("1. a board that carries exactly the schematic's identities has no drift; each category is named by stable id", () => {
    const schematic = sheet([instance("c-u1", "U1", ID(1)), instance("c-d1", "D1", ID(2)), instance("c-d2", "D2", null), instance("c-r9", "R9", ID(9))]);
    expect(boardSchematicDrift(schematic, board([footprint("c-u1", "U1", ID(1)), footprint("c-d1", "D1", ID(2)), footprint("c-d2", "D2", ID(3)), footprint("c-r9", "R9", ID(9))])).items).toEqual([
      { componentInstanceId: "c-d2", kind: "unresolved", boardRef: "D2", schematicRefDes: "D2", fields: [] },
    ]);
    // changed: the footprint, the mapping certificate or the symbol differs from the board's syncIdentity
    const changed = sheet([instance("c-u1", "U1", ID(1)), instance("c-d1", "D1", { ...ID(2), mappingCertificateId: "map-other" })]);
    expect(boardSchematicDrift(changed, board([footprint("c-u1", "U1", ID(1)), footprint("c-d1", "D1", ID(2))])).items).toEqual([{ componentInstanceId: "c-d1", kind: "changed", boardRef: "D1", schematicRefDes: "D1", fields: ["mappingCertificateId"] }]);
    // missing-from-board: a resolved instance absent from a board with synchronized footprints; removed-from-schematic: the reverse
    const drift = boardSchematicDrift(sheet([instance("c-u1", "U1", ID(1)), instance("c-new", "R5", ID(5))]), board([footprint("c-u1", "U1", ID(1)), footprint("c-gone", "Q1", ID(7))]));
    expect(drift.items.map((item) => [item.componentInstanceId, item.kind, item.schematicRefDes, item.boardRef])).toEqual([["c-gone", "removed-from-schematic", null, "Q1"], ["c-new", "missing-from-board", "R5", null]]);
    expect(drift.counts).toEqual({ changed: 0, unresolved: 0, "missing-from-board": 1, "removed-from-schematic": 1 });
    // an UNRESOLVED instance not on the board is not drift (Prepare PCB refuses it by name already)
    expect(boardSchematicDrift(sheet([instance("c-u1", "U1", ID(1)), instance("c-x", "X1", null)]), board([footprint("c-u1", "U1", ID(1))])).items).toEqual([]);
  });

  it("2. keyed by the stable id: a reference rename, or a board ref that differs, never misattributes", () => {
    // the schematic renamed D1 -> D7 and the board still shows D1: same stable id, same identity -> no drift
    expect(boardSchematicDrift(sheet([instance("c-d1", "D7", ID(2))]), board([footprint("c-d1", "D1", ID(2))])).items).toEqual([]);
    // two instances swap references: identities follow the ids, not the labels
    const swapped = sheet([instance("c-a", "R2", ID(1)), instance("c-b", "R1", ID(2))]);
    expect(boardSchematicDrift(swapped, board([footprint("c-a", "R1", ID(1)), footprint("c-b", "R2", ID(2))])).items).toEqual([]);
    const crossed = boardSchematicDrift(sheet([instance("c-a", "R1", ID(2)), instance("c-b", "R2", ID(1))]), board([footprint("c-a", "R1", ID(1)), footprint("c-b", "R2", ID(2))]));
    expect(crossed.items.map((item) => [item.componentInstanceId, item.kind, item.fields])).toEqual([["c-a", "changed", ["footprintAssetVersionId", "mappingCertificateId", "symbolAssetVersionId"]], ["c-b", "changed", ["footprintAssetVersionId", "mappingCertificateId", "symbolAssetVersionId"]]]);
    // a footprint matched by its syncIdentity even when its board id differs
    const relabelled = { ...footprint("c-d1", "D1", ID(2)), id: "board-local-17" };
    expect(boardSchematicDrift(sheet([instance("c-d1", "D1", ID(2))]), board([relabelled])).items).toEqual([]);
  });

  it("3. board-only footprints are never compared; a board with no synchronized footprint, no board and no schematic give no drift", () => {
    expect(boardSchematicDrift(sheet([instance("c-u1", "U1", ID(1))]), board([footprint("mech-1", "H1", null), footprint("c-u1", "U1", ID(1))])).items).toEqual([]);
    expect(boardSchematicDrift(sheet([instance("c-u1", "U1", ID(1))]), board([footprint("mech-1", "H1", null)]))).toMatchObject({ items: [], syncedFootprints: 0 });
    expect(boardSchematicDrift(sheet([instance("c-u1", "U1", ID(1))]), null).items).toEqual([]);
    expect(boardSchematicDrift(null, board([footprint("c-u1", "U1", ID(1))])).items).toEqual([]);
  });

  it("4. Undo / Redo / reload recompute it from the same facts: nothing is remembered between calls", () => {
    const resolved = sheet([instance("c-d1", "D1", ID(2))]);
    const undone = sheet([instance("c-d1", "D1", null)]);
    const synced = board([footprint("c-d1", "D1", ID(2))]);
    expect(boardSchematicDrift(resolved, synced).items).toEqual([]);
    expect(boardSchematicDrift(undone, synced).items.map((item) => item.kind)).toEqual(["unresolved"]); // Undo of the resolution
    expect(boardSchematicDrift(resolved, synced).items).toEqual([]); // Redo
    const reloaded = boardSchematicDrift(JSON.parse(JSON.stringify(undone)) as SchematicState, JSON.parse(JSON.stringify(synced)) as PcbBoard);
    expect(reloaded).toEqual(boardSchematicDrift(undone, synced)); // serialize and reload: identical drift
  });

  it("5. the shared comparator, the notice and the manufacturing gate sentences", () => {
    expect(syncIdentityDifferences(ID(1), footprint("c", "C", ID(1)).syncIdentity!)).toEqual([]);
    expect(syncIdentityDifferences({ ...ID(1), symbolAssetVersionId: undefined }, footprint("c", "C", ID(1)).syncIdentity!)).toEqual(["symbolAssetVersionId"]);
    const none = boardSchematicDrift(sheet([instance("c-d1", "D1", ID(2))]), board([footprint("c-d1", "D1", ID(2))]));
    expect(boardBehindSchematicNotice(none)).toBeNull();
    expect(manufacturingGateRefusal("qualify", none)).toBeNull();
    expect(manufacturingGateRefusal("release", null)).toBeNull();
    const behind = boardSchematicDrift(sheet([instance("c-d1", "D1", ID(3))]), board([footprint("c-d1", "D1", ID(2))]));
    expect(boardBehindSchematicNotice(behind)).toMatch(/^The board is behind the schematic: 1 part\(s\) differ - D1 \(replaced in the schematic\)\..*run Prepare PCB/);
    expect(manufacturingGateRefusal("qualify", behind)).toMatch(/^Qualification refused: the board is behind the schematic \(D1 \(replaced in the schematic\)\)\. Run Prepare PCB first/);
    expect(manufacturingGateRefusal("release", behind)).toMatch(/^Release refused: the board is behind the schematic/);
    const many = boardSchematicDrift(sheet(Array.from({ length: 7 }, (_, index) => instance(`c-${index}`, `R${index}`, ID(index + 20)))), board(Array.from({ length: 7 }, (_, index) => footprint(`c-${index}`, `R${index}`, ID(index)))));
    expect(boardBehindSchematicNotice(many)).toContain(", and 2 more");
  });
});

// ─── the DOMAIN GUARD over the production sync path ──────────────────────────────────────────────────────────────────────────

describe("[PR-L6 M.5-7] DOMAIN GUARD: a board synchronized by the real PcbSynchronizationService has ZERO drift right after apply", { timeout: 180_000 }, () => {
  beforeAll(() => {
    vi.stubEnv("SIRKIT_PCB_SYNC_STAGE3", "opt_in");
    for (const [id, snapshot] of fixtureRuntimeCatalog().snapshots) seams.snapshots.set(id, snapshot);
  });
  afterAll(() => { restoreIdentity(); vi.unstubAllEnvs(); });

  it("6. the fixture blinker authority (the prompt-to-Gerber design): reviewer bindings -> publish -> preflight -> apply -> no drift", async () => {
    const scope = { tenantId: "local", projectId: "m4-drift-blinker", branchId: "main" };
    const schematic = layoutProposal(structuredClone(BLINKER_NETLIST), fixtureRuntimeCatalog().cachedParts);
    expect(schematic.validationOk, schematic.violations.join(" | ")).toBe(true);
    await bindAll(schematic.state, scope);
    const synced = await preparePcb(schematic, scope, { expectedSnapshotRevision: 0 });
    expect(synced.preflight.status, JSON.stringify(synced.preflight.blockers).slice(0, 400)).toBe("ready_to_apply");
    expect(synced.applied).toBe(true);
    const record = synced.record!;
    expect(record.board.footprints).toHaveLength(9);
    expect(record.board.footprints.every((item) => item.syncIdentity)).toBe(true);
    expect(boardSchematicDrift(schematic.state, record.board)).toEqual({ items: [], counts: { changed: 0, unresolved: 0, "missing-from-board": 0, "removed-from-schematic": 0 }, syncedFootprints: 9 });
    expect(manufacturingGateRefusal("release", boardSchematicDrift(schematic.state, record.board))).toBeNull();
    // the identity domains agree field by field (the catalog's CAD bundle on the schematic, the binding on the board)
    for (const item of schematic.state.kicadComponents ?? []) {
      const onBoard = record.board.footprints.find((entry) => entry.syncIdentity?.componentInstanceId === item.id)!;
      expect([onBoard.syncIdentity!.footprintAssetVersionId, onBoard.syncIdentity!.mappingCertificateId, onBoard.syncIdentity!.symbolAssetVersionId], item.refDes).toEqual([item.footprintAssetVersionId, item.mappingCertificateId, item.symbolAssetVersionId]);
    }
  });

  it("7. the LED dimmer with D1 / D2 resolved to the fixture's eligible published revision: no drift; Undo of the resolution then shows D1 / D2 unresolved ON the board", async () => {
    const scope = { tenantId: "local", projectId: "m4-drift-dimmer", branchId: "main" };
    const catalog = fixtureRuntimeCatalog();
    const assignment = catalog.cachedParts.get(FIXTURE_RESOLUTION_PART_IDS.eligibleDiode)!.atomicAssignments![""]!;
    const unresolved = fixtureDimmerSheet();
    const resolved: SchematicState = { ...unresolved, kicadComponents: unresolved.kicadComponents!.map((item) => (item.id === DIMMER_INSTANCE_IDS.D1 || item.id === DIMMER_INSTANCE_IDS.D2 ? { ...item, partId: FIXTURE_RESOLUTION_PART_IDS.eligibleDiode, atomicPartRevisionId: assignment.revisionId, symbolAssetVersionId: assignment.symbolVersionId, footprintAssetVersionId: assignment.footprintVersionId, mappingCertificateId: assignment.mappingCertificateId } : item)) };
    await bindAll(resolved, scope);
    const synced = await preparePcb(laidOut(resolved, catalog.cachedParts), scope, { expectedSnapshotRevision: 0 });
    expect(synced.preflight.status, JSON.stringify(synced.preflight.blockers).slice(0, 400)).toBe("ready_to_apply");
    const record = synced.record!;
    expect(record.board.footprints.map((item) => item.syncIdentity?.componentInstanceId).sort()).toEqual(Object.values(DIMMER_INSTANCE_IDS).sort());
    expect(boardSchematicDrift(resolved, record.board).items).toEqual([]);
    expect(boardSchematicDrift(unresolved, record.board).items.map((item) => [item.schematicRefDes, item.kind])).toEqual([["D1", "unresolved"], ["D2", "unresolved"]]);
    expect(BLINKER_PART_IDS.timer).toBe(resolved.kicadComponents!.find((item) => item.id === DIMMER_INSTANCE_IDS.U1)!.partId);
  });
});
