/**
 * [B18-D review] The repair panel's "Undo repair" works on a bound canonical session. A repair commits under
 * `pcb.board-repair` with the idempotency key `repair:<preview id>` and `transactionId: <preview id>`, but a bound session
 * records the EXECUTOR's transaction id on the history entry (B03) — so `undoRepairTransaction`, which matched the entry's
 * `transactionId` against the preview id, always answered "Only the most recent repair transaction can be undone directly."
 * Proven on the REAL canonical session through the service path the panel takes (`PCBToolService.undoTransaction`); the
 * match still accepts only the most recent repair, by its own id, and nothing else.
 */
import { describe, expect, it } from "vitest";
import { mmToNm } from "../../pcb/units";
import { canonicalLineageDigest } from "../editor-adapter";
import { buildExecutionOperations } from "../execution-operations";
import { appliedLabels, repairedScenario, repairScenario, THIN_WIDTH, thinTrackOf } from "./b18-d-repair-fixture";

const NOT_MOST_RECENT = { ok: false, error: "Only the most recent repair transaction can be undone directly." };

describe("B18-D review — a repair's own Undo on a bound canonical session", () => {
  it("undoes exactly that repair: the board returns to before it, earlier changes stay, the canonical head follows by verified replay", async () => {
    const { c, service, preview } = await repairScenario();
    const beforeRepair = canonicalLineageDigest(c.history.committedPresent);
    expect(await service.applyTransaction({ previewId: preview.id, approvedFixIds: [] })).toEqual({ ok: true, transactionId: preview.id });
    await c.session.whenIdle();
    expect(thinTrackOf(c).width).toBeGreaterThan(THIN_WIDTH);
    const repairEntry = c.history.entries.at(-1)!;
    expect(repairEntry).toMatchObject({ state: "applied", label: "AI PCB repair" });
    // The session records the executor's transaction id on the entry — why matching it against the preview id never held.
    expect(repairEntry.metadata.transactionId).not.toBe(preview.id);

    expect(await service.undoTransaction({ transactionId: preview.id })).toEqual({ ok: true, transactionId: preview.id });
    await c.session.whenIdle();
    expect(thinTrackOf(c).width).toBe(THIN_WIDTH);
    expect(canonicalLineageDigest(c.history.committedPresent)).toBe(beforeRepair);
    expect(appliedLabels(c)).toEqual(["setup", "Import routes"]);
    expect(c.history.entries.at(-1)).toMatchObject({ state: "redo", label: "AI PCB repair" });
    // The canonical head undid THAT transaction by verified replay — never a rebase onto the editor board.
    expect(c.session.events.some((event) => event.kind === "undo-reconciled" && event.detail.startsWith(`undo of ${repairEntry.metadata.transactionId} `))).toBe(true);
    expect(c.session.events.filter((event) => event.kind === "reconcile-rebased")).toHaveLength(0);

    // Undoing it again is refused and undoes nothing else (the import below it stays).
    expect(await service.undoTransaction({ transactionId: preview.id })).toEqual(NOT_MOST_RECENT);
    await c.session.whenIdle();
    expect(appliedLabels(c)).toEqual(["setup", "Import routes"]);
    expect(thinTrackOf(c).width).toBe(THIN_WIDTH);
  });

  it("refuses once the repair is no longer the most recent change, and never undoes the newer non-repair change; nothing is undone", async () => {
    const { c, service, preview } = await repairedScenario();
    const r4Of = () => c.history.committedPresent.footprints.find((footprint) => footprint.ref === "R4")!;
    const r4 = r4Of();
    const built = buildExecutionOperations(c.history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r4.id, x: r4.at.x + mmToNm(1), y: r4.at.y }] });
    if (!built.ok) throw new Error(built.message);
    expect((await c.session.commit({ commandId: "pcb.move-footprint", label: "move R4", buildOperations: () => built.operations })).ok).toBe(true);
    const moveEntry = c.history.entries.at(-1)!;
    const repaired = thinTrackOf(c).width;

    // Neither the repair's id (no longer the most recent change) nor the move's own id (not a repair) undoes anything.
    for (const transactionId of [preview.id, moveEntry.metadata.transactionId!]) {
      expect(await service.undoTransaction({ transactionId }), transactionId).toEqual(NOT_MOST_RECENT);
    }
    await c.session.whenIdle();
    expect(appliedLabels(c)).toEqual(["setup", "Import routes", "AI PCB repair", "move R4"]);
    expect(r4Of().at.x).toBe(r4.at.x + mmToNm(1));
    expect(thinTrackOf(c).width).toBe(repaired);
  });

  it("matches only the repair's own id: the session's transaction id, another entry's id and an unknown id are refused", async () => {
    const { c, service } = await repairedScenario();
    const [importEntry, repairEntry] = c.history.entries.slice(-2);
    const repaired = thinTrackOf(c).width;
    for (const transactionId of [repairEntry.metadata.transactionId!, importEntry.metadata.transactionId!, "repair-tx-unknown", ""]) {
      expect(await service.undoTransaction({ transactionId }), transactionId).toEqual(NOT_MOST_RECENT);
    }
    await c.session.whenIdle();
    expect(appliedLabels(c)).toEqual(["setup", "Import routes", "AI PCB repair"]);
    expect(thinTrackOf(c).width).toBe(repaired);
  });
});
