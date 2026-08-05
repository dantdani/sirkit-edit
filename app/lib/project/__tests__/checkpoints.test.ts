import { describe, expect, it } from "vitest";
import { CHECKPOINT_SCHEMA_VERSION, MemoryCheckpointStore, isCheckpointLike, type ProjectCheckpoint } from "../checkpoints";
import type { SchematicState } from "@/lib/schematic-types";

const schematic: SchematicState = { components: [], wires: [], kicadComponents: [], netLabels: [] };

describe("checkpoint store (R06 Section 7)", () => {
  it("assigns monotonic per-project sequence numbers and stable ids", async () => {
    const store = new MemoryCheckpointStore();
    const a = await store.add({ projectId: "p1", label: "Generated 555 schematic", at: 1, schematic });
    const b = await store.add({ projectId: "p1", label: "Placed footprints", at: 2, schematic });
    const other = await store.add({ projectId: "p2", label: "Generated", at: 3, schematic });
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(1);
    expect(other.seq).toBe(0);
    expect(b.id).toBe("p1:1");
    const list = await store.list("p1");
    expect(list.map((row) => row.label)).toEqual(["Generated 555 schematic", "Placed footprints"]);
  });

  it("returns deep copies — mutating a listed checkpoint cannot corrupt the store", async () => {
    const store = new MemoryCheckpointStore();
    await store.add({ projectId: "p1", label: "x", at: 1, schematic });
    const [row] = await store.list("p1");
    row!.label = "tampered";
    const [again] = await store.list("p1");
    expect(again!.label).toBe("x");
  });

  it("importAll validates every record and fails atomically on the first invalid one", async () => {
    const store = new MemoryCheckpointStore();
    const good: ProjectCheckpoint = { id: "p1:0", schemaVersion: CHECKPOINT_SCHEMA_VERSION, projectId: "p1", seq: 0, label: "ok", at: 1, schematic };
    const bad = { id: "p1:1", schemaVersion: 999, projectId: "p1", seq: 1, label: "bad", at: 2, schematic } as unknown as ProjectCheckpoint;
    await expect(store.importAll([good, bad])).rejects.toThrow("CHECKPOINT_INVALID");
  });

  it("removeProject deletes only that project's checkpoints", async () => {
    const store = new MemoryCheckpointStore();
    await store.add({ projectId: "p1", label: "a", at: 1, schematic });
    await store.add({ projectId: "p2", label: "b", at: 2, schematic });
    await store.removeProject("p1");
    expect(await store.list("p1")).toHaveLength(0);
    expect(await store.list("p2")).toHaveLength(1);
  });

  it("isCheckpointLike rejects malformed records (corrupted storage)", () => {
    expect(isCheckpointLike(null)).toBe(false);
    expect(isCheckpointLike({ id: "x" })).toBe(false);
    expect(isCheckpointLike({ id: "p:0", schemaVersion: CHECKPOINT_SCHEMA_VERSION, projectId: "p", seq: 0, label: "l", at: 1, schematic })).toBe(true);
    expect(isCheckpointLike({ id: "p:0", schemaVersion: CHECKPOINT_SCHEMA_VERSION, projectId: "p", seq: -1, label: "l", at: 1, schematic })).toBe(false);
  });
});
