import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "../types";
import { reconcileBoardNets, type LogicalNetCandidate } from "../net-reconciliation";

function candidate(id: number, name: string, endpointKeys: string[]): LogicalNetCandidate {
  return { id, name, endpointKeys };
}

describe("stable net reconciliation", () => {
  it("is independent of candidate array order and numeric reordering", () => {
    const board = createEmptyBoard();
    board.nets.push(
      { id: 1, name: "B", stableId: "stable-b", endpointKeys: ["b::1", "b::2"] },
      { id: 2, name: "C", stableId: "stable-c", endpointKeys: ["c::1", "c::2"] },
    );
    board.tracks.push({ id: "tb", layer: "copperTop", width: 1, start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, netId: 1 });
    const logical = [
      candidate(1, "A", ["a::1"]),
      candidate(2, "B", ["b::1", "b::2"]),
      candidate(3, "C", ["c::1", "c::2"]),
    ];
    for (const ordered of [logical, [...logical].reverse(), [logical[1], logical[2], logical[0]]]) {
      const result = reconcileBoardNets(board, ordered);
      expect(result.ok).toBe(true);
      expect(result.nets.find((net) => net.name === "B")?.stableId).toBe("stable-b");
      expect(result.nets.find((net) => net.name === "C")?.stableId).toBe("stable-c");
      expect(result.oldToNewId.get(1)).toBe(2);
      expect(result.oldToNewId.get(2)).toBe(3);
    }
  });

  it("keeps unnamed-net identity when other unnamed nets are inserted before or after it", () => {
    const board = createEmptyBoard();
    board.nets.push({
      id: 1, name: "N$1", stableId: "stable-unnamed", endpointKeys: ["u1::1", "u2::1"],
    });
    board.tracks.push({
      id: "unnamed-track", layer: "copperTop", width: 1,
      start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, netId: 1,
    });

    const before = reconcileBoardNets(board, [
      candidate(1, "N$1", ["new-before::1"]),
      candidate(2, "N$2", ["u1::1", "u2::1"]),
    ]);
    const after = reconcileBoardNets(board, [
      candidate(1, "N$1", ["u1::1", "u2::1"]),
      candidate(2, "N$2", ["new-after::1"]),
    ]);

    expect(before.ok).toBe(true);
    expect(before.nets.find((net) => net.id === 2)?.stableId).toBe("stable-unnamed");
    expect(before.oldToNewId.get(1)).toBe(2);
    expect(after.ok).toBe(true);
    expect(after.nets.find((net) => net.id === 1)?.stableId).toBe("stable-unnamed");
    expect(after.oldToNewId.get(1)).toBe(1);
  });

  it("retires unrouted deleted nets and resolves unrouted split/merge deterministically", () => {
    const board = createEmptyBoard();
    board.nets.push(
      { id: 1, name: "OLD", stableId: "stable-old", endpointKeys: ["a::1", "b::1"] },
      { id: 2, name: "UNUSED", stableId: "stable-unused", endpointKeys: ["x::1"] },
    );
    const first = reconcileBoardNets(board, [candidate(1, "A", ["a::1"]), candidate(2, "B", ["b::1"])]);
    const second = reconcileBoardNets(board, [candidate(2, "B", ["b::1"]), candidate(1, "A", ["a::1"])]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.nets).toEqual(second.nets);
    expect(first.changes.some((change) => change.kind === "split")).toBe(true);
    expect(first.changes.some((change) => change.kind === "retired" && change.stableId === "stable-unused")).toBe(true);
  });

  it("rejects corrupted stable-net and endpoint identities before reconciliation", () => {
    const board = createEmptyBoard();
    board.nets.push(
      { id: 1, name: "A", stableId: "duplicate", endpointKeys: ["u1::1"] },
      { id: 2, name: "B", stableId: "duplicate", endpointKeys: ["u1::1"] },
    );
    const result = reconcileBoardNets(board, [candidate(1, "A", ["u1::1"])]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "DUPLICATE_STABLE_NET_ID",
      "PCB_ENDPOINT_IDENTITY_COLLISION",
    ]);
    expect(result.nets).toBe(board.nets);
  });
});
