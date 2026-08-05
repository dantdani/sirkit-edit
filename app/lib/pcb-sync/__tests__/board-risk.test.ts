import { describe, expect, it } from "vitest";
import { authoritativeSnapshotDigest } from "../stable";
import { applyRequest, preflightRequest, readyHarness, snapshot } from "./fixtures";
import { mmToNm } from "../../pcb/units";
import type { PcbBoard } from "../../pcb/types";

async function committedBoard() {
  const harness = await readyHarness();
  const preflight = await harness.service.preflight(preflightRequest());
  const applied = await harness.service.apply(applyRequest(preflight.plan!));
  const record = await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" });
  return { ...harness, applied, record: record! };
}

describe("Stage 3 board inspection and Stage 8 boundary", () => {
  it("previews but blocks footprint replacement on a routed board", async () => {
    const committed = await committedBoard();
    const board = structuredClone(committed.record.board);
    board.footprints[0]!.syncIdentity!.footprintContentDigest = `sha256:${"0".repeat(64)}`;
    board.tracks.push({ id: "track-1", layer: "copperTop", width: mmToNm(0.25), start: { x: 0, y: 0 }, end: { x: mmToNm(10), y: 0 }, netId: 1, source: "human" });
    const harness = await readyHarness("sync-u1", { board });
    const record = await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" });
    const before = structuredClone(record);
    const result = await harness.service.preflight(preflightRequest({ target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: record!.revision } }));
    expect(result.status).toBe("blocked_board_risk");
    expect(result.board.boardClass).toBe("routed");
    expect(result.components[0]).toMatchObject({ status: "blocked_routed_footprint_change", proposedOperation: "blocked" });
    expect(result.plan?.blockedOperations.some((item) => item.reasonCodes.includes("PS_FOOTPRINT_REPLACEMENT_REQUIRES_STAGE8"))).toBe(true);
    expect(await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toEqual(before);
  });

  it("treats zones without tracks as copper-affecting, never as safely unrouted", async () => {
    const committed = await committedBoard();
    const board = structuredClone(committed.record.board);
    board.footprints[0]!.syncIdentity!.footprintAssetVersionId = "old-visible-same-name:r1";
    board.zones.push({ id: "zone-1", layer: "copperTop", netId: 1, polygon: [{ x: 0, y: 0 }, { x: mmToNm(10), y: 0 }, { x: 0, y: mmToNm(10) }], appearance: "solid", connection: "thermal", fill: [], dirty: true });
    const harness = await readyHarness("sync-u1", { board });
    const record = await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" });
    const result = await harness.service.preflight(preflightRequest({ target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: record!.revision } }));
    expect(result.board.boardClass).toBe("zoned");
    expect(result.status).toBe("blocked_board_risk");
  });

  it("allows only metadata refdes rename on a routed board and preserves copper byte-equivalent in the JSON model", async () => {
    const committed = await committedBoard();
    const board = structuredClone(committed.record.board);
    board.tracks.push({ id: "track-1", layer: "copperTop", width: mmToNm(0.25), start: { x: 0, y: 0 }, end: { x: mmToNm(10), y: 0 }, netId: 1, source: "human", locked: true });
    const renamed = snapshot(["sync-u1"]);
    renamed.components[0]!.referenceDesignator = "U42";
    const { snapshotDigest: _digest, ...base } = renamed;
    void _digest;
    renamed.snapshotDigest = authoritativeSnapshotDigest(base);
    const harness = await readyHarness("sync-u1", { snapshot: renamed, board });
    const record = await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" });
    const preflight = await harness.service.preflight(preflightRequest({ target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: record!.revision } }));
    expect(preflight.status).toBe("ready_to_apply");
    expect(preflight.plan?.operations.filter((item) => item.kind === "update_reference_designator")).toHaveLength(1);
    const applied = await harness.service.apply(applyRequest(preflight.plan!, { requestId: "rename-apply" }));
    expect(applied.status).toBe("applied");
    const after = await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" });
    expect(after?.board.footprints[0]?.ref).toBe("U42");
    expect(after?.board.tracks).toEqual(board.tracks);
  });

  it("blocks routed net membership changes without deleting copper", async () => {
    const committed = await committedBoard();
    const board = structuredClone(committed.record.board);
    board.tracks.push({ id: "track-1", layer: "copperTop", width: mmToNm(0.25), start: { x: 0, y: 0 }, end: { x: mmToNm(10), y: 0 }, netId: 1, source: "human" });
    const changed = snapshot(["sync-u1"]);
    changed.components[0]!.pins[1]!.disposition = "connected";
    changed.nets[0]!.members.push({ componentInstanceId: "sync-u1", pinInstanceId: "sync-u1:pin:2", pinNumber: "2" });
    changed.netGraphRevision = "net-graph-r2";
    changed.netGraphDigest = "net-graph-digest-r2";
    const { snapshotDigest: _digest, ...base } = changed;
    void _digest;
    changed.snapshotDigest = authoritativeSnapshotDigest(base);
    const harness = await readyHarness("sync-u1", { snapshot: changed, board });
    const record = await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" });
    const before = structuredClone(record);
    const result = await harness.service.preflight(preflightRequest({ target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: record!.revision } }));
    expect(result.nets[0]).toMatchObject({ status: "blocked_routed_change", routedCopperAffected: true, proposedOperation: "blocked" });
    expect(result.blockers.map((item) => item.code)).toContain("PS_ROUTED_NET_CHANGE_REQUIRES_STAGE8");
    expect(await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toEqual(before);
  });

  it("reports stale board revisions before plan applicability", async () => {
    const committed = await committedBoard();
    const result = await committed.service.preflight(preflightRequest({ target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: "pcb2-stale" } }));
    expect(result.status).toBe("blocked_stale_snapshot");
    expect(result.blockers.map((item) => item.code)).toContain("PS_BOARD_REVISION_MISMATCH");
    expect(result.plan?.lifecycle).toBe("validated");
  });

  it("blocks unknown board constructs instead of dropping them", async () => {
    const board = structuredClone((await committedBoard()).record.board) as PcbBoard & { futureVendorConstruct?: unknown };
    board.futureVendorConstruct = { opaque: true };
    const harness = await readyHarness("sync-u1", { board });
    const record = await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" });
    const result = await harness.service.preflight(preflightRequest({ target: { kind: "existing_board", boardId: "board-1", expectedBoardRevision: record!.revision } }));
    expect(result.board.unknownConstructs).toContain("futureVendorConstruct");
    expect(result.status).toBe("blocked_board_risk");
  });
});
