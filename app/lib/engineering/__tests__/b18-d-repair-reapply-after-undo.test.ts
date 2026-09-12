/**
 * [B18-D review] Applying the SAME repair again after its own Undo, on a bound canonical session.
 *
 * A repair commits under `pcb.board-repair` with the idempotency key `repair:<preview id>`. Its Undo puts the board back at
 * `preview.baseRevisionId`, so every one of `applyRepairTransaction`'s pins passes again and the apply is submitted with the
 * SAME key — which the executor already holds durably. The executor answers `idempotent_replay`, the session returns ok
 * WITHOUT mutating anything or adding a history entry, and the repair read that ok as "applied": the panel toasted
 * "PCB repair: X -> Y errors" and the AI tool `apply_drc_repairs` answered `{ ok: true }`, while the thin track was still
 * 0.05 mm and the repair's entry still sat in "redo".
 *
 * The preview id is content-derived (`plan.id | fix ids | candidate revision`) and the plan id is derived from the base
 * revision and its violations, so re-planning the same board after the undo lands on the SAME key with a FRESH preview
 * object: an in-memory "already committed" flag would not see it. What the repair owes the caller is EVIDENCE — after an ok
 * commit the board must no longer be the board the preview was built on. Redo is the path that restores an undone repair,
 * and the refusal says so.
 */
import { describe, expect, it } from "vitest";
import { canonicalLineageDigest } from "../editor-adapter";
import { appliedLabels, repairedScenario, THIN_TRACK_ID, THIN_WIDTH, thinTrackOf } from "./b18-d-repair-fixture";

const headOf = (c: Parameters<typeof appliedLabels>[0]) => c.session.headMetadataFor(c.history.committedPresent)!;

/** `repairedScenario()` with the repair undone through the service, exactly as the panel's "Undo repair" does. */
async function undoneScenario() {
  const scenario = await repairedScenario();
  const { c, service, preview } = scenario;
  expect(await service.undoTransaction({ transactionId: preview.id })).toEqual({ ok: true, transactionId: preview.id });
  await c.session.whenIdle();
  expect(thinTrackOf(c).width, "the undo really put the thin track back").toBe(THIN_WIDTH);
  return scenario;
}

describe("B18-D review — re-applying a repair after its own Undo, on a bound canonical session", () => {
  it("never reports success for the duplicate submission: it is refused, and the board, the history and the canonical head are untouched", async () => {
    const { c, service, preview } = await undoneScenario();
    const digestBefore = canonicalLineageDigest(c.history.committedPresent);
    const headBefore = headOf(c).headSequence;
    const entriesBefore = c.history.entries.length;

    const reapplied = await service.applyTransaction({ previewId: preview.id, approvedFixIds: [] });
    await c.session.whenIdle();

    expect(reapplied.ok, `re-applying an undone repair must not claim success: ${JSON.stringify(reapplied)}`).toBe(false);
    expect(reapplied.error).toMatch(/nothing was applied/i);
    expect(reapplied.error, "the refusal points at the step that does restore it").toMatch(/redo/i);
    // Nothing moved: not the board, not the editor's history, not the canonical head.
    expect(thinTrackOf(c).width).toBe(THIN_WIDTH);
    expect(canonicalLineageDigest(c.history.committedPresent)).toBe(digestBefore);
    expect(appliedLabels(c)).toEqual(["setup", "Import routes"]);
    expect(c.history.entries).toHaveLength(entriesBefore);
    expect(c.history.entries.at(-1), "the repair is still the redo step it was").toMatchObject({ state: "redo", label: "AI PCB repair" });
    expect(headOf(c).headSequence).toBe(headBefore);
    expect(c.session.events.filter((event) => event.kind === "executed" && event.detail.startsWith("pcb.board-repair:"))).toHaveLength(1);
  });

  it("refuses a FRESH preview of the same repair too — re-planning the undone board lands on the same durable key", async () => {
    const { c, service, preview } = await undoneScenario();
    const plan = await service.planRepairs("safe_fixes_automatically");
    const widen = plan.fixes.filter((fix) => fix.action.kind === "edit" && fix.action.command.op === "set-track-width" && fix.affectedObjectIds.includes(`track:${THIN_TRACK_ID}`));
    expect(widen).toHaveLength(1);
    const replanned = (await service.previewChanges({ planId: plan.id, fixIds: widen.map((fix) => fix.id) })).preview;
    expect(replanned.id, "the same board and the same fix rebuild the same preview id").toBe(preview.id);
    expect(replanned.status, "a freshly built preview carries no memory of the earlier apply").toBe("preview");

    const reapplied = await service.applyTransaction({ previewId: replanned.id, approvedFixIds: [] });
    await c.session.whenIdle();
    expect(reapplied.ok, `a re-planned duplicate must not claim success either: ${JSON.stringify(reapplied)}`).toBe(false);
    expect(thinTrackOf(c).width).toBe(THIN_WIDTH);
    expect(appliedLabels(c)).toEqual(["setup", "Import routes"]);
  });

  it("Redo — the step the refusal names — really does put the repair back, and the canonical head follows it", async () => {
    const { c, service, preview } = await undoneScenario();
    expect((await service.applyTransaction({ previewId: preview.id, approvedFixIds: [] })).ok).toBe(false);
    await c.session.whenIdle();

    expect(c.history.canRedo).toBe(true);
    c.history.redo();
    await c.session.whenIdle();
    expect(thinTrackOf(c).width).toBeGreaterThan(THIN_WIDTH);
    expect(appliedLabels(c)).toEqual(["setup", "Import routes", "AI PCB repair"]);
    expect(c.session.events.some((event) => event.kind === "redo-reconciled")).toBe(true);
    expect(c.session.events.filter((event) => event.kind === "reconcile-rebased")).toHaveLength(0);
  });

  it("still reports success for an apply that DID land: the guard reads the board, not the result's status", async () => {
    const { c, preview } = await repairedScenario();
    // The first apply of this very preview reported ok and the board carries it — the durable key existing is not, by
    // itself, a refusal.
    expect(preview.status).toBe("committed");
    expect(thinTrackOf(c).width).toBeGreaterThan(THIN_WIDTH);
    expect(appliedLabels(c)).toEqual(["setup", "Import routes", "AI PCB repair"]);
  });
});
