/**
 * [B17-E] The project operation timeline references the two authoritative
 * histories, orders their operations, identifies the latest ELIGIBLE undo
 * and refuses when a store's head diverged — never a cross-store atomicity
 * claim.
 */
import { describe, expect, it } from "vitest";
import { ProjectOperationTimeline, sameHead, type ProjectStoreHead } from "../operation-timeline";

const sch = (entryCount: number, digest: string): Extract<ProjectStoreHead, { store: "schematic" }> => ({ store: "schematic", entryCount, digest });
const pcb = (headSequence: number, entryCount: number, historyId = "h-1"): Extract<ProjectStoreHead, { store: "pcb" }> => ({ store: "pcb", historyId, headSequence, entryCount });

describe("B17-E — project operation timeline", () => {
  it("orders operations from both stores, is bounded and observable", () => {
    let t = 1000;
    const timeline = new ProjectOperationTimeline(3, () => (t += 1));
    let notified = 0;
    timeline.subscribe(() => { notified += 1; });
    timeline.record({ store: "schematic", kind: "commit", label: "Add R1", actor: "human", head: sch(2, "d1") });
    timeline.record({ store: "pcb", kind: "commit", label: "Move R1", actor: "human", head: pcb(1, 1), ref: { transactionId: "tx-1" } });
    timeline.record({ store: "schematic", kind: "commit", label: "Wire R1", actor: "ai", head: sch(3, "d2") });
    timeline.record({ store: "pcb", kind: "commit", label: "Autoroute", actor: "autorouter", head: pcb(2, 2) });
    expect(timeline.entries().map((op) => `${op.seq}:${op.store}:${op.label}`)).toEqual(["2:pcb:Move R1", "3:schematic:Wire R1", "4:pcb:Autoroute"]); // bounded to 3
    expect(timeline.entries().map((op) => op.at)).toEqual([1002, 1003, 1004]);
    expect(notified).toBe(4);
    expect(sameHead(sch(3, "d2"), sch(3, "d2"))).toBe(true);
    expect(sameHead(sch(3, "d2"), sch(3, "d3"))).toBe(false);
    expect(sameHead(pcb(2, 2), pcb(2, 2, "h-2"))).toBe(false);
  });

  it("identifies the latest eligible undo and refuses on divergence, absence or a non-undoable latest operation", () => {
    const timeline = new ProjectOperationTimeline();
    expect(timeline.latestEligibleUndo({ schematic: sch(1, "d0"), pcb: null })).toMatchObject({ ok: false, code: "NOTHING_TO_UNDO" });
    timeline.record({ store: "schematic", kind: "commit", label: "Add R1", actor: "human", head: sch(2, "d1") });
    timeline.record({ store: "pcb", kind: "commit", label: "Autoroute", actor: "autorouter", head: pcb(2, 2) });
    // Latest is the PCB commit and its head still matches: eligible.
    expect(timeline.latestEligibleUndo({ schematic: sch(2, "d1"), pcb: pcb(2, 2) })).toMatchObject({ ok: true, operation: { store: "pcb", label: "Autoroute" } });
    // The PCB history moved on without the timeline seeing it (a restore): refuse, naming the store.
    expect(timeline.latestEligibleUndo({ schematic: sch(2, "d1"), pcb: pcb(3, 3) })).toMatchObject({ ok: false, code: "DIVERGED_PCB", operation: { label: "Autoroute" } });
    // The PCB editor is closed: refuse (the schematic's own undo is not the latest project operation).
    expect(timeline.latestEligibleUndo({ schematic: sch(2, "d1"), pcb: null })).toMatchObject({ ok: false, code: "DIVERGED_PCB" });
    // After the store's own undo is recorded, the latest is an undo: nothing newer to undo.
    timeline.record({ store: "pcb", kind: "undo", label: "Autoroute", actor: "human", head: pcb(1, 2) });
    expect(timeline.latestEligibleUndo({ schematic: sch(2, "d1"), pcb: pcb(1, 2) })).toMatchObject({ ok: false, code: "NOT_UNDOABLE" });
    // A schematic commit follows; the schematic digest then diverges (hydration): refuse.
    timeline.record({ store: "schematic", kind: "commit", label: "Wire R1", actor: "human", head: sch(3, "d2") });
    expect(timeline.latestEligibleUndo({ schematic: sch(3, "d2"), pcb: pcb(1, 2) })).toMatchObject({ ok: true, operation: { store: "schematic", label: "Wire R1" } });
    expect(timeline.latestEligibleUndo({ schematic: sch(1, "hydrated"), pcb: pcb(1, 2) })).toMatchObject({ ok: false, code: "DIVERGED_SCHEMATIC" });
    // A hydration/restore entry is never undoable.
    timeline.record({ store: "schematic", kind: "hydrate", label: "Opened project", actor: "system", head: sch(1, "hydrated") });
    expect(timeline.latestEligibleUndo({ schematic: sch(1, "hydrated"), pcb: pcb(1, 2) })).toMatchObject({ ok: false, code: "NOT_UNDOABLE" });
  });

  it("undoLatest delegates to the bound store's own undo only when eligible; an unbound or diverged store refuses without touching anything", async () => {
    const timeline = new ProjectOperationTimeline();
    let schematicUndos = 0, pcbUndos = 0;
    let schHead = sch(2, "d1");
    const unbindSch = timeline.bindStore("schematic", { undo: () => { schematicUndos += 1; schHead = sch(1, "d0"); }, head: () => schHead });
    timeline.record({ store: "schematic", kind: "commit", label: "Add R1", actor: "human", head: sch(2, "d1") });
    timeline.record({ store: "pcb", kind: "commit", label: "Move R1", actor: "human", head: pcb(1, 1) });
    // The PCB store is not bound: the latest (PCB) operation cannot be undone from here, and the schematic's undo is NOT run instead.
    expect(await timeline.undoLatest()).toMatchObject({ ok: false, code: "DIVERGED_PCB" });
    expect(pcbUndos + schematicUndos).toBe(0);
    let pcbHead = pcb(1, 1);
    timeline.bindStore("pcb", { undo: () => { pcbUndos += 1; pcbHead = pcb(0, 1); }, head: () => pcbHead });
    expect(await timeline.undoLatest()).toMatchObject({ ok: true, operation: { store: "pcb", label: "Move R1" } });
    expect(pcbUndos).toBe(1);
    // The store's undo is recorded by the store's own subscriber (as the editor does); until then the latest entry is stale → diverged.
    expect(await timeline.undoLatest()).toMatchObject({ ok: false, code: "DIVERGED_PCB" });
    timeline.record({ store: "pcb", kind: "undo", label: "Move R1", actor: "human", head: pcb(0, 1) });
    expect(await timeline.undoLatest()).toMatchObject({ ok: false, code: "NOT_UNDOABLE" });
    unbindSch();
    timeline.record({ store: "schematic", kind: "commit", label: "Wire", actor: "human", head: sch(3, "d2") });
    expect(await timeline.undoLatest()).toMatchObject({ ok: false, code: "DIVERGED_SCHEMATIC" });
    expect(schematicUndos).toBe(0);
  });
});
