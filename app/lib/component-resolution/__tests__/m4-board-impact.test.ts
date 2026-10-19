/**
 * [PR-L6, 2026-10-19] Runbook M.4 / M.5 item 7 (OD-253 item 8): the impact of a reviewed replacement on the project's DURABLE board,
 * BEFORE approval (app/lib/component-resolution/board-impact.ts) - pure cases over a small synchronized board (two diodes on three
 * nets, the endpoint-derived stable net identities the publisher uses):
 *
 *  - no board: every item is added at Prepare PCB, nothing on a board is invalidated;
 *  - an unrouted placed board: a footprint change, and a mapping change that keeps the pin numbers, are replaced in place
 *    (replace_unrouted_footprint, no Stage 8); placement legality, DRC and stage evidence go stale, routing does not;
 *  - a routed board: a footprint change is Stage 8 (PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8) with the copper per affected net, the
 *    copper a derived revision strips, and the authority and the release named as invalidated;
 *  - an instance missing from a routed board cannot be added (PS_STRUCTURAL_ADD_REQUIRES_UNROUTED_BOARD);
 *  - a proved pin PERMUTATION re-identifies the nets it touches (the stable id is derived from the endpoint set): the board's old net is
 *    a removed net - PS_REMOVED_NET_PROTECTED where it owns copper, PS_REMOVED_NET_RECONCILIATION_REQUIRED where it does not (the
 *    service's rule; the scout map's PS_ROUTED_NET_CHANGE_REQUIRES_STAGE8 never arises from endpoint-derived ids - the preflight
 *    agreement suite measures it against the real preflight);
 *  - a locked or fixed footprint on an otherwise unrouted board is Stage 8;
 *  - identical identities are `unchanged` with nothing invalidated; the same input gives the same digest; a moved board revision a new
 *    one; the receipt summary is bounded (20 items, 6 codes, 128-character strings) and the journal's validator accepts it.
 */
import { describe, expect, it } from "vitest";
import { createEmptyBoard, type FootprintInstance, type PcbBoard } from "@/app/lib/pcb/types";
import { schematicEndpointKey, stableNetIdForEndpoints } from "@/app/lib/pcb/integrity";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import { mmToNm } from "@/app/lib/pcb/units";
import { assessResolutionBoardImpact, boardImpactSentences, BOARD_IMPACT_SUMMARY_MAX_ITEMS, resolutionBoardImpactSummary, type BoardImpactItemInput, type ResolutionBoardBasis } from "../board-impact";
import { componentResolutionBoardImpactView } from "@/app/lib/project/component-resolution-events";

const SCOPE = { tenantId: "local", projectId: "m4-impact", branchId: "main" } as const;
const BOARD_ID = "board:m4-impact";
const W = { symbolAssetVersionId: "symbolv-d", footprintAssetVersionId: "footprintv-sod123", mappingCertificateId: "map-w" };

/** D1 (K on TIMING, A on RA) and D2 (K on RB, A on TIMING), both 2-pad parts, synchronized with identity W. */
function syncedBoard(options: { routed?: boolean; locked?: string; fixed?: string } = {}): PcbBoard {
  const nets = [
    { name: "/root/TIMING", keys: [schematicEndpointKey("kc-d1", "1"), schematicEndpointKey("kc-d2", "2"), schematicEndpointKey("kc-u1", "6")] },
    { name: "/root/RA", keys: [schematicEndpointKey("kc-d1", "2"), schematicEndpointKey("kc-r1", "2")] },
    { name: "/root/RB", keys: [schematicEndpointKey("kc-d2", "1"), schematicEndpointKey("kc-r2", "1")] },
  ].map((net, index) => ({ id: index + 1, name: net.name, stableId: stableNetIdForEndpoints(net.keys, net.name), endpointKeys: [...net.keys].sort() }));
  const footprint = (id: string, ref: string, padNets: Record<string, number>, at: number): FootprintInstance => ({
    id, ref, footprintId: W.footprintAssetVersionId,
    def: { libName: "Diode_SMD", name: "D_SOD-123", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "" },
    at: { x: mmToNm(at), y: mmToNm(10) }, rotationDeg: 90, side: "top", padNets,
    pinPadMappings: [{ componentInstanceId: id, endpointKey: schematicEndpointKey(id, "1"), symbolPinNumber: "1", padNumbers: ["1"], mappingKind: "electrical", provenance: "library-explicit" }, { componentInstanceId: id, endpointKey: schematicEndpointKey(id, "2"), symbolPinNumber: "2", padNumbers: ["2"], mappingKind: "electrical", provenance: "library-explicit" }],
    syncIdentity: { componentInstanceId: id, bindingRevisionId: `binding-${id}`, footprintContentDigest: "sha256:sod123", syncPlanId: "plan-1", ...W },
    ...(options.locked === id ? { locked: true } : {}),
    ...(options.fixed === id ? { placementConstraints: { fixedPosition: true } } : {}),
  });
  const board: PcbBoard = { ...createEmptyBoard(), nets: [createEmptyBoard().nets[0]!, ...nets], footprints: [footprint("kc-d1", "D1", { "1": 1, "2": 2 }, 20), footprint("kc-d2", "D2", { "1": 3, "2": 1 }, 30)] };
  if (options.routed) {
    board.tracks.push({ id: "t-timing-1", layer: "copperTop", width: mmToNm(0.25), start: { x: 0, y: 0 }, end: { x: mmToNm(5), y: 0 }, netId: 1, source: "human" });
    board.tracks.push({ id: "t-timing-2", layer: "copperTop", width: mmToNm(0.25), start: { x: 0, y: mmToNm(1) }, end: { x: mmToNm(5), y: mmToNm(1) }, netId: 1, source: "human" });
    board.tracks.push({ id: "t-ra", layer: "copperTop", width: mmToNm(0.25), start: { x: 0, y: mmToNm(2) }, end: { x: mmToNm(5), y: mmToNm(2) }, netId: 2, source: "human" });
    board.vias.push({ id: "v-timing", at: { x: mmToNm(5), y: 0 }, size: mmToNm(0.6), drill: mmToNm(0.3), netId: 1, layers: ["copperTop", "copperBottom"] });
  }
  return board;
}

function basis(board: PcbBoard, manufacturing: { authority?: boolean; release?: boolean } = {}): ResolutionBoardBasis & { state: "board" } {
  return { state: "board", boardId: BOARD_ID, record: makeBoardRecord({ ...SCOPE, boardId: BOARD_ID, board, updatedAt: "2026-10-19T00:00:00.000Z" }), authority: manufacturing.authority ? { revision: 3, recordDigest: "sha256:authority-3", current: true } : null, latestRelease: manufacturing.release ? { releaseId: "release-0001", current: true } : null };
}

const SAME_NUMBERS = [{ fromPin: "1", toPin: "1", pads: ["1"] }, { fromPin: "2", toPin: "2", pads: ["2"] }];
const PERMUTED = [{ fromPin: "1", toPin: "2", pads: ["1"] }, { fromPin: "2", toPin: "1", pads: ["2"] }];
const item = (componentInstanceId: string, refDes: string, target: BoardImpactItemInput["target"], mapping = SAME_NUMBERS): BoardImpactItemInput => ({ componentInstanceId, refDes, target: { footprintFullName: "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal", ...target }, mapping });
const THT = { symbolAssetVersionId: "symbolv-d", footprintAssetVersionId: "footprintv-do35", mappingCertificateId: "map-t" };

describe("[PR-L6 M.5-7] assessResolutionBoardImpact", () => {
  it("1. no board: every item is added by Prepare PCB; nothing on a board is invalidated; the view says so", () => {
    const impact = assessResolutionBoardImpact({ items: [item("kc-d1", "D1", THT), item("kc-d2", "D2", THT)], basis: { state: "no-board", boardId: BOARD_ID } });
    expect(impact.items.map((entry) => [entry.schematicRefDes, entry.outcome, entry.predicted.operation, entry.rebind])).toEqual([["D1", "not-on-board", "add_component_instance", false], ["D2", "not-on-board", "add_component_instance", false]]);
    expect(impact).toMatchObject({ requiresBoardRevision: false, predictedCodes: [], invalidates: { placementLegality: false, drc: false, routing: false, authority: null, release: null, stageEvidence: false } });
    expect(componentResolutionBoardImpactView({ state: "assessed", impact })).toMatchObject({ state: "assessed", approveBlockedReason: null, rows: [] });
    expect(boardImpactSentences(resolutionBoardImpactSummary(impact))[0]).toContain("no PCB exists for this project yet");
  });

  it("2. an unrouted placed board: a footprint change and a same-numbers mapping change are replaced in place, no Stage 8; placement, DRC and stage evidence go stale", () => {
    const impact = assessResolutionBoardImpact({ items: [item("kc-d1", "D1", THT), item("kc-d2", "D2", { ...W, mappingCertificateId: "map-recertified" })], basis: basis(syncedBoard(), { authority: true }) });
    expect(impact.basis).toMatchObject({ state: "board", boardId: BOARD_ID, boardClass: "placed_unrouted", generation: 0 });
    expect(impact.items.map((entry) => [entry.schematicRefDes, entry.boardRef, entry.outcome, entry.fields, entry.predicted, entry.rebind])).toEqual([
      ["D1", "D1", "footprint_changed", ["footprintAssetVersionId", "mappingCertificateId"], { operation: "replace_unrouted_footprint", codes: [] }, true],
      ["D2", "D2", "pin_map_changed", ["mappingCertificateId"], { operation: "replace_unrouted_footprint", codes: [] }, true],
    ]);
    const d1 = impact.items[0]!;
    expect(d1.pins).toEqual([
      { pin: "1", toPin: "1", net: "/root/TIMING", stableNetId: impact.nets.find((net) => net.name === "/root/TIMING")!.stableNetId, boardPads: ["1"], targetPads: ["1"], copper: { tracks: 0, vias: 0, zones: 0 } },
      { pin: "2", toPin: "2", net: "/root/RA", stableNetId: impact.nets.find((net) => net.name === "/root/RA")!.stableNetId, boardPads: ["2"], targetPads: ["2"], copper: { tracks: 0, vias: 0, zones: 0 } },
    ]);
    expect(d1.placement).toEqual({ x: mmToNm(20), y: mmToNm(10), rotationDeg: 90, side: "top", locked: false, fixed: false });
    expect(impact.nets.every((net) => !net.membershipChanges && net.predictedCode === null)).toBe(true);
    expect(impact).toMatchObject({ requiresBoardRevision: false, predictedCodes: [], copperStripped: { nets: [], tracks: 0, vias: 0, zones: 0 }, invalidates: { placementLegality: true, drc: true, routing: false, authority: { revision: 3, recordDigest: "sha256:authority-3" }, release: null, stageEvidence: true } });
    const view = componentResolutionBoardImpactView({ state: "assessed", impact });
    expect(view.rows.map((row) => row.refDes)).toEqual(["D1", "D2"]);
    expect(view.rows[0]!.text).toMatch(/^D1 \(board D1\): footprint changes \[footprintAssetVersionId, mappingCertificateId\]; pin 1 on \/root\/TIMING \(pads 1 -> 1\), pin 2 on \/root\/RA \(pads 2 -> 2\); placed at 20\.00 mm, 10\.00 mm, 90°, top; Prepare PCB: replace unrouted footprint; re-binding needed/);
    expect(view.invalidates).toEqual(["placement legality", "DRC", "qualification authority r3", "local stage evidence"]);
    expect(view.headline).toContain("unsaved PCB edits are not part of it");
  });

  it("3. a routed board: a footprint change is Stage 8 with the copper per affected net, the stripped copper, and the authority and release named", () => {
    const impact = assessResolutionBoardImpact({ items: [item("kc-d1", "D1", THT)], basis: basis(syncedBoard({ routed: true }), { authority: true, release: true }) });
    expect(impact.basis).toMatchObject({ boardClass: "routed" });
    expect(impact.items[0]!.predicted).toEqual({ operation: "blocked", codes: ["PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8"] });
    expect(impact.items[0]!.pins.map((row) => [row.net, row.copper])).toEqual([["/root/TIMING", { tracks: 2, vias: 1, zones: 0 }], ["/root/RA", { tracks: 1, vias: 0, zones: 0 }]]);
    expect(impact).toMatchObject({ requiresBoardRevision: true, predictedCodes: ["PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8"], copperStripped: { tracks: 3, vias: 1, zones: 0 }, invalidates: { routing: true, authority: { revision: 3 }, release: { releaseId: "release-0001" } } });
    expect(impact.copperStripped.nets.sort()).toEqual(impact.nets.filter((net) => net.name !== "/root/RB").map((net) => net.stableNetId).sort());
    const summary = resolutionBoardImpactSummary(impact);
    expect(summary).toMatchObject({ state: "assessed", requiresBoardRevision: true, items: [{ schematicRefDes: "D1", outcome: "footprint_changed", operation: "blocked", affectedNets: 2, copper: { tracks: 3, vias: 1, zones: 0 }, rebind: true }], invalidates: { authorityRevision: 3, releaseId: "release-0001", routing: true } });
    expect(boardImpactSentences(summary).join(" ")).toMatch(/A new derived board revision is required \(copper stripped: 3 track\(s\), 1 via\(s\), 0 zone\(s\)\)\..*qualification authority r3, release release-0001/);
  });

  it("4. an instance missing from a routed board cannot be added; on an unrouted board it is added", () => {
    const routed = assessResolutionBoardImpact({ items: [item("kc-d9", "D9", THT)], basis: basis(syncedBoard({ routed: true })) });
    expect(routed.items[0]).toMatchObject({ outcome: "not-on-board", predicted: { operation: "blocked", codes: ["PS_STRUCTURAL_ADD_REQUIRES_UNROUTED_BOARD"] }, netEffects: "unassessed", rebind: false });
    expect(routed.requiresBoardRevision).toBe(true);
    expect(routed.invalidates.routing).toBe(true); // the nets it joins are not named, so the routing on a board with copper is never claimed valid
    const unrouted = assessResolutionBoardImpact({ items: [item("kc-d9", "D9", THT)], basis: basis(syncedBoard()) });
    expect(unrouted.items[0]).toMatchObject({ outcome: "not-on-board", predicted: { operation: "add_component_instance", codes: [] } });
    expect(unrouted.invalidates).toMatchObject({ placementLegality: true, drc: true, routing: false });
  });

  it("5. a proved pin permutation re-identifies the nets it touches: protected where copper exists, a reconciliation where it does not", () => {
    const permuted = (board: PcbBoard) => assessResolutionBoardImpact({ items: [item("kc-d1", "D1", { symbolAssetVersionId: "symbolv-d-ak", footprintAssetVersionId: W.footprintAssetVersionId, mappingCertificateId: "map-ak" }, PERMUTED)], basis: basis(board) });
    const unrouted = permuted(syncedBoard());
    expect(unrouted.items[0]).toMatchObject({ outcome: "pin_map_changed", predicted: { operation: "blocked", codes: ["PS_REMOVED_NET_RECONCILIATION_REQUIRED"] } });
    expect(unrouted.nets.filter((net) => net.membershipChanges).map((net) => [net.name, net.predictedCode])).toEqual(expect.arrayContaining([["/root/TIMING", "PS_REMOVED_NET_RECONCILIATION_REQUIRED"], ["/root/RA", "PS_REMOVED_NET_RECONCILIATION_REQUIRED"]]));
    expect(unrouted.requiresBoardRevision).toBe(false); // not a Stage 8 situation: the reconciliation blocks Prepare PCB outright
    const routed = permuted(syncedBoard({ routed: true }));
    expect(routed.predictedCodes).toEqual(["PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8", "PS_REMOVED_NET_PROTECTED"]);
    expect(routed.nets.find((net) => net.name === "/root/TIMING")).toMatchObject({ membershipChanges: true, predictedCode: "PS_REMOVED_NET_PROTECTED", copper: { tracks: 2, vias: 1, zones: 0 } });
    expect(routed.requiresBoardRevision).toBe(true);
  });

  it("6. a locked or a fixed footprint on an otherwise unrouted board is Stage 8", () => {
    for (const option of [{ locked: "kc-d1" }, { fixed: "kc-d1" }]) {
      const impact = assessResolutionBoardImpact({ items: [item("kc-d1", "D1", THT)], basis: basis(syncedBoard(option)) });
      expect(impact.basis, JSON.stringify(option)).toMatchObject({ boardClass: "locked_unrouted" });
      expect(impact.items[0]!.predicted).toEqual({ operation: "blocked", codes: ["PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8"] });
      expect(impact.items[0]!.placement).toMatchObject("locked" in option ? { locked: true, fixed: false } : { locked: false, fixed: true });
      expect(impact.requiresBoardRevision).toBe(true);
    }
  });

  it("7. identical identities are unchanged with nothing invalidated; the digest is deterministic and follows the board", () => {
    const board = syncedBoard({ routed: true });
    const same = assessResolutionBoardImpact({ items: [item("kc-d1", "D1", W), item("kc-d2", "D2", W)], basis: basis(board, { authority: true, release: true }) });
    expect(same.items.map((entry) => [entry.outcome, entry.predicted.operation, entry.rebind])).toEqual([["unchanged", "preserve_component_instance", false], ["unchanged", "preserve_component_instance", false]]);
    expect(same).toMatchObject({ predictedCodes: [], requiresBoardRevision: false, invalidates: { placementLegality: false, drc: false, routing: false, authority: null, release: null, stageEvidence: false } });
    expect(boardImpactSentences(resolutionBoardImpactSummary(same))[0]).toMatch(/already carries these exact parts; nothing on it goes stale/);
    // a reference rename only is a metadata update, never a footprint change
    expect(assessResolutionBoardImpact({ items: [item("kc-d1", "D7", W)], basis: basis(board) }).items[0]!.predicted.operation).toBe("update_reference_designator");
    // determinism: the same input -> the same digest, in any item order; a moved board, authority or release -> another digest
    const again = assessResolutionBoardImpact({ items: [item("kc-d2", "D2", W), item("kc-d1", "D1", W)], basis: basis(structuredClone(board), { authority: true, release: true }) });
    expect(again.digest).toBe(same.digest);
    expect(assessResolutionBoardImpact({ items: [item("kc-d1", "D1", W), item("kc-d2", "D2", W)], basis: basis(board, { authority: true }) }).digest).not.toBe(same.digest);
    const moved = structuredClone(board);
    moved.footprints[0]!.at.x += 1;
    expect(assessResolutionBoardImpact({ items: [item("kc-d1", "D1", W), item("kc-d2", "D2", W)], basis: basis(moved, { authority: true, release: true }) }).digest).not.toBe(same.digest);
  });

  it("8. the receipt summary is bounded: at most 20 items, 6 codes each, capped strings", () => {
    const many = Array.from({ length: 25 }, (_, index) => item(`kc-x${index}-${"y".repeat(200)}`, `X${index}`, THT));
    const summary = resolutionBoardImpactSummary(assessResolutionBoardImpact({ items: many, basis: basis(syncedBoard({ routed: true })) }));
    if (summary.state !== "assessed") throw new Error("not assessed");
    expect(summary.items).toHaveLength(BOARD_IMPACT_SUMMARY_MAX_ITEMS);
    expect(summary.truncatedItems).toBe(5);
    expect(summary.items.every((entry) => entry.componentInstanceId.length <= 128 && entry.codes.length <= 6)).toBe(true);
    expect(JSON.stringify(summary).length).toBeLessThan(16_384);
  });

  it("9. the view fails closed: loading and unavailable keep Approve disabled with a visible reason", () => {
    expect(componentResolutionBoardImpactView({ state: "loading" })).toMatchObject({ state: "loading", approveBlockedReason: expect.stringMatching(/^Approve is disabled while the project's PCB is read/) });
    expect(componentResolutionBoardImpactView({ state: "unavailable", detail: "PS_NETWORK_UNAVAILABLE: fetch failed" })).toMatchObject({ state: "unavailable", approveBlockedReason: expect.stringContaining("PS_NETWORK_UNAVAILABLE"), rows: [] });
  });
});
