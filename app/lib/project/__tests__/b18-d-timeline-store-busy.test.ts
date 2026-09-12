/**
 * [B18-D I7] The project timeline never reports an undo it did not run (chat-execution-ux.md §4): while the PCB store
 * is busy (an AI change in flight — the editor's history hold), "Undo latest" is refused as STORE_BUSY with the reason
 * and the store's own undo is never called; once the store is free the same undo runs.
 */
import { describe, expect, it } from "vitest";
import { ProjectOperationTimeline } from "../operation-timeline";

const head = { store: "pcb", historyId: "pcb-history-1", headSequence: 1, entryCount: 1 } as const;

describe("B18-D I7 — the timeline refuses a busy store", () => {
  it("refuses STORE_BUSY with the reason and never calls the store's undo; runs it once the store is free", async () => {
    const timeline = new ProjectOperationTimeline();
    let undos = 0;
    let busy: string | null = "an AI change is being made";
    timeline.bindStore("pcb", { undo: () => { undos += 1; }, head: () => head, busy: () => busy });
    timeline.record({ store: "pcb", kind: "commit", label: "AI: R3 at (52.000, 47.480) mm", actor: "ai", head });
    expect(await timeline.undoLatest()).toMatchObject({ ok: false, code: "STORE_BUSY", message: "The pcb editor is busy: an AI change is being made. Nothing was undone." });
    expect(undos).toBe(0);
    busy = null;
    expect(await timeline.undoLatest()).toMatchObject({ ok: true, operation: { label: "AI: R3 at (52.000, 47.480) mm" } });
    expect(undos).toBe(1);
  });

  it("a store that lends no busy() is never considered busy (the schematic store, earlier bindings)", async () => {
    const timeline = new ProjectOperationTimeline();
    let undos = 0;
    timeline.bindStore("pcb", { undo: () => { undos += 1; }, head: () => head });
    timeline.record({ store: "pcb", kind: "commit", label: "human move", actor: "human", head });
    expect(await timeline.undoLatest()).toMatchObject({ ok: true });
    expect(undos).toBe(1);
  });
});
