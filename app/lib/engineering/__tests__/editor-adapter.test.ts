/**
 * B03 — canonical editor adapter tests.
 *
 * Deterministic coverage for the migrated PCB slice: footprint move through
 * the adapter, rotation/side semantics, track update, non-footprint deletion,
 * arrange as one transaction/one undo step, stale-claim refusal, duplicate
 * idempotency replay, atomic rollback on persistence failure, derived
 * invalidation, undo/redo revision integrity, legacy hydration, reload after
 * a canonical mutation, late-hydration/autosave guards, command/operation
 * mismatch refusal, and unchanged behavior for unmigrated handlers.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHistory, type PcbHistory } from "../../pcb/history";
import type { PcbBoard, Via, Zone } from "../../pcb/types";
import {
  applyEditsCanonical,
  bindCanonicalEditorSession,
  canonicalLineageDigest,
  canonicalSessionFor,
  planCanonicalEdits,
  type BoundCanonicalEditor,
} from "../editor-adapter";
import { InMemoryAtomicProjectStore } from "../persistence";
import { applyEdits } from "../../pcb/edit/apply";
import { projectFixture, track } from "./fixtures";

const IDENTITY = { tenantId: "tenant-a", projectId: "project-a", branchId: "main" };

function via(id: string): Via {
  return { id, at: { x: 3_000_000, y: 3_000_000 }, size: 600_000, drill: 300_000, netId: 1, layers: ["copperTop", "copperBottom"] };
}

function zone(id: string): Zone {
  return {
    id, layer: "copperTop", netId: 1, appearance: "solid", connection: "thermal",
    polygon: [{ x: 0, y: 0 }, { x: 4_000_000, y: 0 }, { x: 4_000_000, y: 4_000_000 }],
    fill: [], dirty: false,
  };
}

/** Fixture board: two footprints (u1, u2), one track, one via, one zone. */
function boardFixture(): PcbBoard {
  const board = projectFixture().pcb;
  board.tracks.push(track("t1"));
  board.vias.push(via("v1"));
  board.zones.push(zone("z1"));
  return board;
}

async function openBound(board?: PcbBoard, options?: Parameters<typeof bindCanonicalEditorSession>[2]): Promise<BoundCanonicalEditor & { raw: PcbHistory }> {
  const raw = createHistory(board ?? boardFixture());
  const bound = bindCanonicalEditorSession(raw, IDENTITY, options);
  await bound.session.whenIdle();
  return { ...bound, raw };
}

function moveCommit(history: PcbHistory, footprintId: string, x: number, idempotencyKey?: string) {
  return canonicalSessionFor(history)!.commit({
    commandId: "pcb.move-footprint",
    label: `Move ${footprintId}`,
    buildOperations: () => [{ operationId: "op:move:0", schemaVersion: 1, units: "nm", kind: "move_footprint", footprintId, at: { x, y: 2_000_000 } }],
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

describe("B03 migrated slice execution", () => {
  it("1. footprint move: canonical executor is the authority; one entry, transaction-bound", async () => {
    const { history, session } = await openBound();
    const result = await moveCommit(history, "u1", 4_000_000);
    expect(result.ok).toBe(true);
    if (!result.ok || result.status === "noop") throw new Error("expected execution");
    expect(result.status).toBe("executed");
    expect(history.present.footprints.find((f) => f.id === "u1")!.at).toEqual({ x: 4_000_000, y: 2_000_000 });
    // One UI action → one canonical transaction → one undo entry.
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].metadata.transactionId).toBe(result.transactionId);
    const details = history.entries[0].metadata.details?.b03 as Record<string, unknown>;
    expect(details.commandId).toBe("pcb.move-footprint");
    expect(details.revisionBefore).toBe(result.revisionBefore!.canonicalStateDigest);
    expect(details.revisionAfter).toBe(result.revisionAfter!.canonicalStateDigest);
    // The board IS the canonical head (lineage rule).
    expect(session.headMetadataFor(history.present)).not.toBeNull();
  });

  it("2. rotation and side update: exact move_footprint semantics via the inspector path", async () => {
    const { history } = await openBound();
    const result = await applyEditsCanonical(history, [
      { op: "set-footprint-props", id: "u1", patch: { rotationDeg: 90 } },
      { op: "set-footprint-props", id: "u2", patch: { side: "bottom" } },
    ]);
    expect(result.ok).toBe(true);
    const u1 = history.present.footprints.find((f) => f.id === "u1")!;
    const u2 = history.present.footprints.find((f) => f.id === "u2")!;
    expect(u1.rotationDeg).toBe(90);
    expect(u1.side).toBe("top");
    expect(u1.at).toEqual({ x: 2_000_000, y: 2_000_000 }); // position untouched
    expect(u2.side).toBe("bottom");
    expect(history.entries).toHaveLength(1); // one batch = one undo step
    expect(history.entries[0].metadata.transactionId).toMatch(/^tx:pcb\.rotate-side-footprint:/);
  });

  it("3. track update: width and layer through the canonical executor", async () => {
    const { history, session } = await openBound();
    const widthResult = await applyEditsCanonical(history, [{ op: "set-track-width", ids: ["t1"], widthNm: 400_000 }]);
    const layerResult = await applyEditsCanonical(history, [{ op: "set-item-layer", refs: [{ kind: "track", id: "t1" }], layer: "copperBottom" }]);
    expect(widthResult.ok).toBe(true);
    expect(layerResult.ok).toBe(true);
    const t1 = history.present.tracks.find((t) => t.id === "t1")!;
    expect(t1.width).toBe(400_000);
    expect(t1.layer).toBe("copperBottom");
    expect(history.entries).toHaveLength(2);
    expect(session.events.filter((e) => e.kind === "executed")).toHaveLength(2);
    expect(session.currentHeadRevision()!.headSequence).toBe(2);
  });

  it("4. non-footprint deletion: track+via+zone in ONE destructive transaction, no approval prompt for the interactive human", async () => {
    const { history } = await openBound();
    const result = await applyEditsCanonical(history, [{
      op: "delete-items",
      refs: [{ kind: "track", id: "t1" }, { kind: "via", id: "v1" }, { kind: "zone", id: "z1" }],
    }]);
    expect(result.ok).toBe(true);
    expect(history.present.tracks).toHaveLength(0);
    expect(history.present.vias).toHaveLength(0);
    expect(history.present.zones).toHaveLength(0);
    expect(history.entries).toHaveLength(1);
    // Undo restores all three — the durable record's inverse re-adds them.
    history.undo();
    await canonicalSessionFor(history)!.whenIdle();
    expect(history.present.tracks).toHaveLength(1);
    expect(history.present.vias).toHaveLength(1);
    expect(history.present.zones).toHaveLength(1);
  });

  it("5. arrange batch: one transaction, one undo step across many footprints", async () => {
    const { history, session } = await openBound();
    const result = await applyEditsCanonical(history, [{
      op: "align",
      refs: [{ kind: "footprint", id: "u1" }, { kind: "footprint", id: "u2" }],
      mode: "left",
    }]);
    expect(result.ok).toBe(true);
    const [u1, u2] = ["u1", "u2"].map((id) => history.present.footprints.find((f) => f.id === id)!);
    expect(u1.at.x).toBe(u2.at.x); // aligned
    expect(history.entries).toHaveLength(1);
    expect(session.events.filter((e) => e.kind === "executed")).toHaveLength(1);
    history.undo();
    await session.whenIdle();
    expect(history.present.footprints.find((f) => f.id === "u2")!.at.x).toBe(8_000_000);
    expect(history.entries.filter((e) => e.state === "applied")).toHaveLength(0);
  });
});

describe("B03 revision, idempotency, atomicity", () => {
  it("6. serialized concurrent actions never overwrite each other (no lost update, no stale apply)", async () => {
    const { history, session } = await openBound();
    const [a, b] = await Promise.all([
      moveCommit(history, "u1", 3_000_000, "gesture-a"),
      moveCommit(history, "u2", 9_000_000, "gesture-b"),
    ]);
    expect(a.ok && a.status === "executed").toBe(true);
    expect(b.ok && b.status === "executed").toBe(true);
    expect(session.currentHeadRevision()!.headSequence).toBe(2);
    expect(history.present.footprints.find((f) => f.id === "u1")!.at.x).toBe(3_000_000);
    expect(history.present.footprints.find((f) => f.id === "u2")!.at.x).toBe(9_000_000);
    expect(history.entries).toHaveLength(2);
  });

  it("7. duplicate idempotency key: replay, no second mutation, no second undo entry", async () => {
    const { history, session } = await openBound();
    const first = await moveCommit(history, "u1", 4_000_000, "pinned-gesture-1");
    const replay = await moveCommit(history, "u1", 4_000_000, "pinned-gesture-1");
    expect(first.ok && first.status === "executed").toBe(true);
    expect(replay.ok && replay.status === "idempotent_replay").toBe(true);
    if (!first.ok || !replay.ok || first.status === "noop" || replay.status === "noop") throw new Error("unexpected");
    expect(replay.transactionId).toBe(first.transactionId);
    expect(history.entries).toHaveLength(1);
    expect(session.currentHeadRevision()!.headSequence).toBe(1);
  });

  it("8. atomic rollback: failed persistence leaves board, history, revision, and artifacts unchanged; retry succeeds", async () => {
    let arm = false;
    const store = new InMemoryAtomicProjectStore((phase) => { if (arm && phase === "before_commit") throw new Error("SIMULATED_COMMIT_FAILURE"); });
    const { history, session } = await openBound(undefined, { store });
    const headBefore = session.currentHeadRevision()!;
    const boardBefore = history.present;
    arm = true;
    const failed = await moveCommit(history, "u1", 5_000_000, "rollback-key");
    arm = false;
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error("expected rejection");
    expect(failed.reasonCode).toBe("persistence_failed");
    expect(failed.message).toContain("rolled back");
    expect(history.present).toBe(boardBefore); // board untouched
    expect(history.entries).toHaveLength(0); // no undo entry
    expect(session.currentHeadRevision()).toEqual(headBefore);
    const retry = await moveCommit(history, "u1", 5_000_000, "rollback-key");
    expect(retry.ok && retry.status === "executed").toBe(true);
    expect(history.entries).toHaveLength(1);
  });

  it("9. derived-artifact invalidation is recorded deterministically per transaction", async () => {
    const { history, session } = await openBound();
    const result = await moveCommit(history, "u1", 4_000_000);
    if (!result.ok || result.status === "noop") throw new Error("expected execution");
    const kinds = result.invalidatedArtifactKinds!;
    expect(kinds).toEqual([...kinds].sort());
    expect(kinds).toContain("drc");
    expect(kinds).toContain("electrical_truth");
    const entryDetails = history.entries[0].metadata.details?.b03 as { invalidatedArtifacts: string[] };
    expect(entryDetails.invalidatedArtifacts).toEqual(kinds);
    // Second identical run on a fresh session invalidates identically.
    const second = await openBound();
    const again = await moveCommit(second.history, "u1", 4_000_000);
    if (!again.ok || again.status === "noop") throw new Error("expected execution");
    expect(again.invalidatedArtifactKinds).toEqual(kinds);
    expect(again.changeSetDigest).toBe(result.changeSetDigest);
    void session;
  });

  it("10. command/operation mismatch stays refused through the adapter", async () => {
    const { history, session } = await openBound();
    const result = await session.commit({
      commandId: "pcb.edit-track",
      label: "forged",
      buildOperations: () => [{ operationId: "op:x", schemaVersion: 1, units: "nm", kind: "move_footprint", footprintId: "u1", at: { x: 0, y: 0 } }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reasonCode).toBe("operation_mismatch");
    expect(history.entries).toHaveLength(0);
    expect(session.currentHeadRevision()!.headSequence).toBe(0);
  });
});

describe("B03 undo/redo revision integrity", () => {
  it("11. undo applies an audited canonical inverse; redo restores the exact result", async () => {
    const { history, session } = await openBound();
    const original = history.present;
    const result = await moveCommit(history, "u1", 4_000_000);
    if (!result.ok || result.status === "noop") throw new Error("expected execution");

    history.undo(); // synchronous for the UI
    expect(history.present.footprints.find((f) => f.id === "u1")!.at.x).toBe(2_000_000);
    expect(canonicalLineageDigest(history.present)).toBe(canonicalLineageDigest(original));
    await session.whenIdle();
    // The lineage advanced by an inverse transaction — no rewind, no rebase.
    expect(session.events.filter((e) => e.kind === "undo-reconciled")).toHaveLength(1);
    expect(session.events.filter((e) => e.kind === "reconcile-rebased")).toHaveLength(0);
    expect(session.currentHeadRevision()!.headSequence).toBe(2);
    expect(session.headMetadataFor(history.present)).not.toBeNull();

    history.redo();
    expect(history.present.footprints.find((f) => f.id === "u1")!.at.x).toBe(4_000_000);
    await session.whenIdle();
    expect(session.events.filter((e) => e.kind === "redo-reconciled")).toHaveLength(1);
    expect(session.currentHeadRevision()!.headSequence).toBe(3);
    expect(session.headMetadataFor(history.present)).not.toBeNull();

    // Undo → redo → undo again: each occurrence is its own audited transaction.
    history.undo();
    await session.whenIdle();
    expect(session.events.filter((e) => e.kind === "undo-reconciled")).toHaveLength(2);
    expect(canonicalLineageDigest(history.present)).toBe(canonicalLineageDigest(original));
  });

  it("12. undo of a legacy (non-canonical) entry realigns or rebases deterministically — never guesses", async () => {
    const { history, session } = await openBound();
    await moveCommit(history, "u1", 4_000_000);
    // One legacy mutation on top of the canonical entry: undoing it returns
    // the board TO the canonical head — coherent again, no rebase needed.
    history.execute("Legacy zone tweak", (draft) => { draft.zones[0].priority = 7; });
    history.undo(); // undoes the LEGACY entry
    await session.whenIdle();
    expect(session.events.some((e) => e.kind === "reconcile-rebased")).toBe(false);
    expect(session.headMetadataFor(history.present)).not.toBeNull();

    // Two stacked legacy mutations: undoing only the top one lands OFF the
    // canonical head — the lineage rebases onto the restored board.
    history.execute("Legacy tweak 1", (draft) => { draft.zones[0].priority = 8; });
    history.execute("Legacy tweak 2", (draft) => { draft.zones[0].keepUnconnectedIslands = true; });
    history.undo(); // board = after tweak 1 ≠ canonical head
    await session.whenIdle();
    expect(session.events.some((e) => e.kind === "reconcile-rebased")).toBe(true);
    // After the rebase the board and lineage agree; canonical work continues.
    const next = await moveCommit(history, "u2", 7_000_000);
    expect(next.ok).toBe(true);
    expect(session.headMetadataFor(history.present)).not.toBeNull();
  });
});

describe("B03 hydration + persistence compatibility", () => {
  it("13. legacy project without canonical metadata opens unchanged (no rewrite on open)", async () => {
    const board = boardFixture();
    const raw = createHistory(board);
    const bound = bindCanonicalEditorSession(raw, IDENTITY, { claim: null });
    expect(bound.history.present).toBe(board); // binding never mutates the board
    await bound.session.whenIdle();
    expect(bound.session.events.map((e) => e.kind)).toEqual(["opened"]);
    const result = await moveCommit(bound.history, "u1", 4_000_000);
    expect(result.ok).toBe(true);
  });

  it("14. reload after a canonical mutation: persisted head claim verifies against the saved board", async () => {
    const { history, session } = await openBound();
    await moveCommit(history, "u1", 4_000_000);
    const saved = session.headMetadataFor(history.present);
    expect(saved).not.toBeNull();
    expect(saved!.headSequence).toBe(1);
    // Reload: a fresh session over the persisted board with the saved claim.
    const reloaded = await openBound(structuredClone(history.present), { claim: saved });
    expect(reloaded.session.events.some((e) => e.kind === "claim-verified")).toBe(true);
    expect(reloaded.session.events.some((e) => e.kind === "claim-stale")).toBe(false);
    // And the reloaded lineage is immediately usable at the same board state.
    expect(reloaded.session.headMetadataFor(reloaded.history.present)!.lineageDigest).toBe(saved!.lineageDigest);
  });

  it("15. a STALE persisted claim is refused — the newer board is never overwritten", async () => {
    const { history, session } = await openBound();
    await moveCommit(history, "u1", 4_000_000);
    const stale = session.headMetadataFor(history.present)!;
    // The board moved on after that save (e.g. edits that never autosaved metadata).
    const newer = structuredClone(history.present);
    newer.footprints.find((f) => f.id === "u1")!.at.x = 6_000_000;
    const reloaded = await openBound(newer, { claim: stale });
    expect(reloaded.session.events.some((e) => e.kind === "claim-stale")).toBe(true);
    // Fresh lineage derives from the board AS LOADED — content untouched.
    expect(reloaded.history.present.footprints.find((f) => f.id === "u1")!.at.x).toBe(6_000_000);
    expect(reloaded.session.headMetadataFor(reloaded.history.present)!.headSequence).toBe(0);
  });

  it("16. head metadata is withheld while hydration is pending and after legacy divergence (autosave guard)", async () => {
    const board = boardFixture();
    const raw = createHistory(board);
    const bound = bindCanonicalEditorSession(raw, IDENTITY, {});
    // Before the lineage finished opening, no claim may be persisted.
    expect(bound.session.headMetadataFor(board)).toBeNull();
    await bound.session.whenIdle();
    expect(bound.session.headMetadataFor(board)).not.toBeNull();
    // A legacy-path edit moves the board off the canonical head → withheld again.
    bound.history.execute("Legacy tweak", (draft) => { draft.zones[0].priority = 3; });
    expect(bound.session.headMetadataFor(bound.history.present)).toBeNull();
    // R06 editor guards this metadata rides on are still present at the source level.
    const editorSource = readFileSync(join(process.cwd(), "app/components/pcb/PcbEditor.tsx"), "utf8");
    expect(editorSource).toContain("if (cancelled) return;"); // late hydration never overwrites newer in-memory state
    expect(editorSource).toContain("if (init.demo || !syncIdentity || !state.board) return;"); // autosave never runs before hydration
    expect(editorSource).toContain("headMetadataFor(board)"); // metadata saved only via the guarded autosave
  });
});

describe("B03 unmigrated paths stay byte-identical", () => {
  it("17. non-slice batches fall back to the legacy path with NO canonical transaction", async () => {
    const bound = await openBound();
    const legacyBoard = structuredClone(bound.history.present);
    const legacyHistory = createHistory(legacyBoard); // unbound control
    const cmds = [{ op: "set-zone-props" as const, id: "z1", patch: { clearanceNm: 250_000 } }];
    const viaAdapter = await applyEditsCanonical(bound.history, structuredClone(cmds));
    const viaLegacy = applyEdits(legacyHistory, structuredClone(cmds));
    expect(viaAdapter.ok).toBe(true);
    expect(viaLegacy.ok).toBe(true);
    expect(bound.history.present.zones[0].clearanceOverrideNm).toBe(250_000);
    expect(bound.history.present.zones[0]).toEqual(legacyHistory.present.zones[0]);
    // No canonical transaction was created for the unmigrated shape.
    await bound.session.whenIdle();
    expect(bound.session.events.filter((e) => e.kind === "executed")).toHaveLength(0);
    expect(bound.history.entries[0].metadata.details?.b03).toBeUndefined();
    // Silk-text delete (no operation contract) also stays legacy.
    expect(planCanonicalEdits([{ op: "delete-items", refs: [{ kind: "text", id: "s1" }] }])).toBeNull();
    // Mixed-kind arrange stays legacy.
    expect(planCanonicalEdits([{ op: "align", refs: [{ kind: "footprint", id: "u1" }, { kind: "via", id: "v1" }], mode: "left" }])).toBeNull();
    // Locked-flag patches stay legacy (protection capability).
    expect(planCanonicalEdits([{ op: "set-footprint-props", id: "u1", patch: { locked: true } }])).toBeNull();
  });

  it("18. legacy-path mutations under a bound session rebase the lineage on the next canonical action", async () => {
    const { history, session } = await openBound();
    await moveCommit(history, "u1", 4_000_000);
    history.execute("Legacy tweak", (draft) => { draft.zones[0].priority = 9; });
    const next = await moveCommit(history, "u2", 9_000_000);
    expect(next.ok).toBe(true);
    expect(session.events.some((e) => e.kind === "rebased")).toBe(true);
    // The rebase preserved the legacy change AND applied the canonical move.
    expect(history.present.zones[0].priority).toBe(9);
    expect(history.present.footprints.find((f) => f.id === "u2")!.at.x).toBe(9_000_000);
  });
});
