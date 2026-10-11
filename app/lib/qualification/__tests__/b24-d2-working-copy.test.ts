// @vitest-environment jsdom
/**
 * [B24-D2] D24-30, OD-214 - two tabs, one project: the PCB working copy is compare-before-write. A person's PCB edits are kept in the
 * project's local working copy (`saveWorkingCopy`, board-persistence.ts), which every tab of one browser profile shares
 * (localStorage). Each tab remembers the copy it last loaded or saved; a save over a copy another tab wrote since is refused, its
 * board kept as the project's conflict record (`stashWorkingConflict`, which keeps the other tab's copy in place), and the caller
 * says so (PcbEditor's toast, `WORKING_COPY_CONFLICT_TOAST`). This is the unit proof of e2e/multi-tab.spec.ts case 2's mechanism;
 * each "tab" is a fresh import of the module over the one storage (jsdom), as two pages are two module instances over one profile.
 *
 *  1. tab A and tab B load the same copy; A saves, then B saves: B's save is refused (`conflict`), A's copy stays the working copy,
 *     B's board is the conflict record with its reason; a reload (a third instance) loads A's board and finds the record;
 *  2. one tab saving again and again never conflicts with itself, and the next tab to load then save sees no conflict either; a tab
 *     that writes the very board another tab wrote since loses nothing, so that is no conflict (two idle tabs autosaving);
 *  3. a tab that loaded when no copy existed is refused when another tab created one since; one that never loaded saves as before;
 *  4. the load-time stash (the server moved past the copy) moves the copy and clears the slot, and the stashing tab's next save,
 *     straight after the stash with no reload, is not refused (the stash's own memory is what it relies on);
 *  5. a storage failure is still `false`, never `conflict`;
 *  6. [B24-D2 review] an idle tab's rewrite of an unchanged board (its hydration autosave) keeps the copy's token, so the tab that
 *     loaded first is never locked out: A loads, B loads and writes the same board back (the stored board, the board it loaded, or
 *     a legacy copy's board), then A saves an edit - not refused; and B, now behind A, is refused as before;
 *  7. [B24-D2 review] a same-tab checkpoint restore: page.tsx persists the restored board with no write token, and the editor's
 *     restore adoption (`rememberStoredWorkingCopy`, called at both checkpoint-restore adoptions in PcbEditor) makes that copy the
 *     tab's own, so its next edit - even before the first autosave of the restored board - is not refused as another tab's;
 *  8. [B24-D2 review] RECORDED LIMIT (OD-214): the conflict record is one slot. A refused save's record is replaced by a later
 *     load-time stash of another tab's copy (two tabs suffice); what this case pins is that limit, stated on the page, never a claim
 *     that every record survives.
 *  9. [B24-D4, 2026-10-10] D24-30's CI red (run 38061798204, e2e/multi-tab.spec.ts case 2): a tab whose own edit happens to
 *     produce the very board another tab wrote since (B's first nudge equals A's) writes nothing and keeps the copy its board derives
 *     from as its base, so its next edit is refused; the stored copy's token was adopted as the tab's own before the fix;
 * 10. [B24-D4, 2026-10-10] a checkpoint restore adopted after another tab wrote (the load effect's pending restore): the adoption
 *     takes only the copy page.tsx persisted (no write token) as the tab's own, never another tab's newer copy.
 * Cases 9 and 10 failed first on 1fe719e (`d4r2-02-red-working-copy`): the second save of B, and A's save after the restore,
 * returned true and replaced the other tab's copy with no conflict record.
 * [B24-D4 review, 2026-10-10] Case 9 now compares A's whole stored copy (token, base, claim, time) before and after B's save, B
 * writing with its own base and a canonical claim (correctness-4: the token alone was equal under an overwrite too); the restore
 * adoption takes the stored copy when it holds the restored board the editor hands it (`rememberStoredWorkingCopy(projectId,
 * restoredBoard)`, both call sites in PcbEditor; case 7 reads them), whoever wrote it:
 * 11. two tabs that loaded no copy hydrate the same board: the second's autosave of that board takes the stored copy for its own,
 *     so its first edit is not refused (correctness-3; at 1fe719e it was not refused either);
 * 12. a restore whose copy another tab rewrote unchanged (its hydration autosave, under the "legacy:" token of page.tsx's copy) is
 *     still the restoring tab's own, so its edits are not refused (correctness-2; at 1fe719e they were not);
 * 13. two token-less restore writes race (A restores while its editor waits on a board load; B restores another checkpoint): A's
 *     adoption never takes B's restored copy for its own, so A's restored board is refused, kept as the conflict record, and B keeps
 *     saving (security-2).
 * Cases 11-13 failed first on the D4 tree before this review fix (`d4fix-01-red-working-copy`); case 9's comparison failed under a
 * planted write of the skip (`d4fix-02-mutation-skip-writes`, the source restored by sha256).
 *
 * Failing first on 3d5f225 (performance-and-reliability.md part 2): B's save returns true and silently replaces A's copy - no
 * conflict record, nothing said (INFERRED in the task from board-persistence.ts:188-192; reproduced here). Cases 6 and 7 failed
 * first on the D2 tree before its review fix: A's edit was refused `conflict` (section 18). Every case resets the module graph
 * (a cold import per tab), so each carries an explicit budget (lead lesson 14). Nothing is written to disk; jsdom's storage is in
 * memory.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import type { SchematicState } from "@/lib/schematic-types";
import type { PcbCanonicalHead } from "@/lib/persistence";

type BoardPersistence = typeof import("@/app/lib/pcb/board-persistence");
const EMPTY: SchematicState = { components: [], wires: [], kicadComponents: [], netLabels: [] };
const BASE = { revision: "pcb2-b24d2base", digest: "digest-b24d2" };

/** A fresh module instance: one browser tab. */
async function tab(): Promise<BoardPersistence> {
  vi.resetModules();
  return import("@/app/lib/pcb/board-persistence");
}
/** A board told apart by its track count (each tab's edit). */
function board(tracks: number): PcbBoard {
  const value = createEmptyBoard();
  for (let index = 0; index < tracks; index += 1) value.tracks.push({ id: `t${index + 1}`, layer: "copperTop", width: 250_000, start: { x: 1_000_000, y: 1_000_000 + index * 1_000_000 }, end: { x: 5_000_000, y: 1_000_000 + index * 1_000_000 }, netId: 0, source: "human" });
  return value;
}
async function project(): Promise<string> {
  const { createProject } = await import("@/lib/persistence");
  return createProject("B24-D2 two tabs", EMPTY).id;
}
async function stored(projectId: string) {
  const { loadProject } = await import("@/lib/persistence");
  return loadProject(projectId)!;
}
/** A write that is not `saveWorkingCopy`'s: pcbWorking with no write token, as page.tsx's checkpoint restore and older builds write it. */
async function writeWithoutToken(projectId: string, value: PcbBoard, updatedAt: number): Promise<void> {
  const { saveProjectFields } = await import("@/lib/persistence");
  expect(saveProjectFields(projectId, { pcbWorking: { board: value, baseRevision: BASE.revision, baseDigest: BASE.digest, updatedAt } })).toBe(true);
}
/** The editor's checkpoint-restore adoption step (absent before the review fix, so then nothing is remembered), handed the restored
 *  board as PcbEditor hands it ([B24-D4 review, 2026-10-10]). */
const adoptRestore = (persistence: BoardPersistence, projectId: string, restoredBoard: PcbBoard): void => (persistence as Partial<Pick<BoardPersistence, "rememberStoredWorkingCopy">>).rememberStoredWorkingCopy?.(projectId, restoredBoard);
/** [B24-D4 review, 2026-10-10] Another tab's base and canonical claim, so a write over A's copy is visible even under A's token. */
const BASE_B = { revision: "pcb2-b24d4tabb", digest: "digest-b24d4-tab-b" };
const HEAD_B: PcbCanonicalHead = { schemaVersion: 1, lineageDigest: "lineage-b24d4-tab-b", boardSemanticRevision: "pcb2-b24d4tabb", headSequence: 3, headTransactionId: "tx-b24d4-tab-b", canonicalStateDigest: "state-b24d4-tab-b" };

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("[B24-D2] the PCB working copy across two tabs: compare-before-write (D24-30, OD-214)", () => {
  it("1. A and B load the same copy; A saves, then B saves: B is refused, A's copy stays, B's board is the conflict record; a reload loads A's board and finds the record", { timeout: 30_000 }, async () => {
    const id = await project();
    const seed = await tab();
    expect(seed.saveWorkingCopy(id, board(1), BASE)).toBe(true);
    const a = await tab();
    const b = await tab();
    expect(a.loadWorkingCopy(id)!.board.tracks).toHaveLength(1);
    expect(b.loadWorkingCopy(id)!.board.tracks).toHaveLength(1);
    expect(a.saveWorkingCopy(id, board(2), BASE)).toBe(true);
    const refused = b.saveWorkingCopy(id, board(3), BASE);
    expect(refused, "the second save over a copy another tab wrote is refused").toBe(a.WORKING_COPY_CONFLICT);
    const record = await stored(id);
    expect(record.pcbWorking?.board.tracks, "A's copy is not replaced").toHaveLength(2);
    expect(record.pcbWorkingConflict?.board.tracks, "B's board is preserved as the conflict record").toHaveLength(3);
    expect(record.pcbWorkingConflict?.reason).toMatch(/another tab/i);
    expect(a.WORKING_COPY_CONFLICT_TOAST).toMatch(/preserved as a recoverable conflict record/);
    // A keeps saving; B keeps being refused (its newest board replaces its own conflict record), A's copy is never replaced
    expect(a.saveWorkingCopy(id, board(4), BASE)).toBe(true);
    expect(b.saveWorkingCopy(id, board(5), BASE)).toBe(a.WORKING_COPY_CONFLICT);
    expect((await stored(id)).pcbWorking?.board.tracks).toHaveLength(4);
    expect((await stored(id)).pcbWorkingConflict?.board.tracks).toHaveLength(5);
    // the reload of both
    const reloaded = await tab();
    expect(reloaded.loadWorkingCopy(id)!.board.tracks).toHaveLength(4);
    expect((await stored(id)).pcbWorkingConflict?.board.tracks).toHaveLength(5);
  });

  it("2. one tab saving again and again never conflicts with itself, and the next tab to load then save sees no conflict", { timeout: 30_000 }, async () => {
    const id = await project();
    const a = await tab();
    a.loadWorkingCopy(id);
    for (let tracks = 1; tracks <= 4; tracks += 1) expect(a.saveWorkingCopy(id, board(tracks), BASE)).toBe(true);
    const b = await tab();
    expect(b.loadWorkingCopy(id)!.board.tracks).toHaveLength(4);
    expect(b.saveWorkingCopy(id, board(6), BASE)).toBe(true);
    expect((await stored(id)).pcbWorkingConflict).toBeUndefined();
    // two idle tabs: A writes the same board again after B loaded; B writing that very board loses nothing
    const c = await tab();
    expect(c.loadWorkingCopy(id)!.board.tracks).toHaveLength(6);
    expect(b.saveWorkingCopy(id, board(6), BASE)).toBe(true);
    expect(c.saveWorkingCopy(id, board(6), BASE), "the stored board is this very board: no conflict").toBe(true);
    expect((await stored(id)).pcbWorkingConflict).toBeUndefined();
    expect(c.saveWorkingCopy(id, board(7), BASE), "and the tab now remembers that copy").toBe(true);
  });

  it("3. a tab that loaded when no copy existed is refused when another tab created one since; a tab that never loaded saves as before", { timeout: 30_000 }, async () => {
    const id = await project();
    const a = await tab();
    const b = await tab();
    expect(a.loadWorkingCopy(id)).toBeNull();
    expect(b.loadWorkingCopy(id)).toBeNull();
    expect(a.saveWorkingCopy(id, board(1), BASE)).toBe(true);
    expect(b.saveWorkingCopy(id, board(2), BASE)).toBe(b.WORKING_COPY_CONFLICT);
    expect((await stored(id)).pcbWorking?.board.tracks).toHaveLength(1);
    const unloaded = await tab();
    expect(unloaded.saveWorkingCopy(id, board(7), BASE), "no load, no remembered copy: the save is as it was").toBe(true);
  });

  it("4. the load-time stash (the server moved past the copy) moves the copy and clears the slot, and the stashing tab saves straight afterwards, with no reload", { timeout: 30_000 }, async () => {
    const id = await project();
    const seed = await tab();
    expect(seed.saveWorkingCopy(id, board(1), BASE)).toBe(true);
    const a = await tab();
    const working = a.loadWorkingCopy(id)!;
    expect(a.stashWorkingConflict(id, working, "server advanced")).toBe(true);
    // [B24-D2 review, 2026-10-09] the slot is read from storage, never through loadWorkingCopy (which would re-remember the empty slot
    // itself): PcbEditor stashes and adopts the server board with no reload, so the save below relies on the stash's own memory
    const afterStash = await stored(id);
    expect(afterStash.pcbWorking).toBeUndefined();
    expect(afterStash.pcbWorkingConflict?.reason).toBe("server advanced");
    expect(a.saveWorkingCopy(id, board(2), BASE), "the stashing tab's own next save is not refused").toBe(true);
    expect((await stored(id)).pcbWorking?.board.tracks).toHaveLength(2);
    expect((await stored(id)).pcbWorkingConflict?.reason).toBe("server advanced");
  });

  it("5. a storage failure is still false, never conflict", { timeout: 30_000 }, async () => {
    const id = await project();
    const a = await tab();
    a.loadWorkingCopy(id);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    expect(a.saveWorkingCopy(id, board(1), BASE)).toBe(false);
    spy.mockRestore();
  });

  it("6. an idle tab writing an unchanged board back (its hydration autosave) keeps the copy's token: the tab that loaded first saves its edit, and the idle tab, now behind, is refused as before", { timeout: 30_000 }, async () => {
    const variants: Array<[string, (b: BoardPersistence, id: string, loaded: PcbBoard) => PcbBoard]> = [
      ["the stored board", () => board(1)],
      ["the board it loaded (normalized)", (_b, _id, loaded) => loaded],
    ];
    for (const [label, unchanged] of variants) {
      const id = await project();
      const seed = await tab();
      expect(seed.saveWorkingCopy(id, board(1), BASE), label).toBe(true);
      const a = await tab();
      const b = await tab();
      a.loadWorkingCopy(id);
      const loaded = b.loadWorkingCopy(id)!.board;
      expect(b.saveWorkingCopy(id, unchanged(b, id, loaded), BASE), `${label}: the idle tab's rewrite`).toBe(true);
      expect(a.saveWorkingCopy(id, board(2), BASE), `${label}: A's edit after B's unchanged rewrite is not refused`).toBe(true);
      const after = await stored(id);
      expect(after.pcbWorking?.board.tracks, label).toHaveLength(2);
      expect(after.pcbWorkingConflict, `${label}: no conflict record`).toBeUndefined();
      expect(b.saveWorkingCopy(id, board(3), BASE), `${label}: B, behind A's edit, is refused`).toBe(b.WORKING_COPY_CONFLICT);
      expect((await stored(id)).pcbWorking?.board.tracks, label).toHaveLength(2);
    }
    // a legacy copy (no write token): A and B load it, B writes it back unchanged, A's edit is not refused
    const id = await project();
    await writeWithoutToken(id, board(1), 1_000);
    const a = await tab();
    const b = await tab();
    a.loadWorkingCopy(id);
    b.loadWorkingCopy(id);
    expect(b.saveWorkingCopy(id, board(1), BASE)).toBe(true);
    expect(a.saveWorkingCopy(id, board(2), BASE), "legacy copy: A's edit after B's unchanged rewrite").toBe(true);
    expect((await stored(id)).pcbWorkingConflict).toBeUndefined();
  });

  it("7. a same-tab checkpoint restore: the restored copy (written with no token, as page.tsx writes it) becomes the tab's own at the editor's restore adoption, so its next edit is not refused as another tab's", { timeout: 30_000 }, async () => {
    const id = await project();
    const a = await tab();
    a.loadWorkingCopy(id);
    expect(a.saveWorkingCopy(id, board(1), BASE)).toBe(true);
    await writeWithoutToken(id, board(5), Date.now() + 1);
    adoptRestore(a, id, board(5));
    // an edit of the restored board before its first autosave (the debounce restarts on each change)
    expect(a.saveWorkingCopy(id, board(6), BASE), "the restoring tab's own next edit").toBe(true);
    const after = await stored(id);
    expect(after.pcbWorking?.board.tracks).toHaveLength(6);
    expect(after.pcbWorkingConflict).toBeUndefined();
    // the editor makes that adoption at both checkpoint-restore adoptions (the restore event and the load effect's pending restore)
    const editor = readFileSync("app/components/pcb/PcbEditor.tsx", "utf8").split("\n").filter((line) => line.includes('adoptBoardLifecycle("checkpoint-restore"'));
    expect(editor).toHaveLength(2);
    for (const line of editor) expect(line).toContain("rememberStoredWorkingCopy(");
    // [B24-D4 review, 2026-10-10] security-2: each adoption hands over the very board it adopts, which the stored copy must hold
    for (const line of editor) {
      const adopted = /adoptBoardLifecycle\("checkpoint-restore", (\w+)\)/.exec(line)?.[1];
      expect(adopted, line).toBeTruthy();
      expect(line, "the restored board is passed to the adoption").toMatch(new RegExp(`rememberStoredWorkingCopy\\([\\w.]+, ${adopted}\\)`));
    }
  });

  it("8. RECORDED LIMIT (OD-214): the conflict record is one slot - a refused save's record is replaced by a later load-time stash of another tab's copy", { timeout: 30_000 }, async () => {
    const id = await project();
    const seed = await tab();
    expect(seed.saveWorkingCopy(id, board(1), BASE)).toBe(true);
    const a = await tab();
    const b = await tab();
    a.loadWorkingCopy(id);
    b.loadWorkingCopy(id);
    expect(a.saveWorkingCopy(id, board(2), BASE)).toBe(true);
    expect(b.saveWorkingCopy(id, board(3), BASE)).toBe(b.WORKING_COPY_CONFLICT);
    expect((await stored(id)).pcbWorkingConflict?.board.tracks, "B's refused board is the record").toHaveLength(3);
    // A reloads after the server moved past its copy's base: PcbEditor's load-time stash writes the same slot
    const reloaded = await tab();
    const working = reloaded.loadWorkingCopy(id)!;
    expect(reloaded.stashWorkingConflict(id, working, "Server board advanced")).toBe(true);
    const after = await stored(id);
    expect(after.pcbWorkingConflict?.board.tracks, "the one slot now holds A's copy; B's refused board is no longer stored").toHaveLength(2);
    expect(after.pcbWorkingConflict?.reason).toBe("Server board advanced");
  });

  it("9. [B24-D4] a tab whose own edit happens to produce the very board another tab wrote since never takes that copy for its own: the save of that board writes nothing, and the tab's next edit is refused (the CI path of e2e/multi-tab.spec.ts case 2)", { timeout: 30_000 }, async () => {
    const id = await project();
    const seed = await tab();
    expect(seed.saveWorkingCopy(id, board(1), BASE)).toBe(true);
    const a = await tab();
    const b = await tab();
    a.loadWorkingCopy(id);
    b.loadWorkingCopy(id);
    expect(a.saveWorkingCopy(id, board(2), BASE), "A's edit (one nudge)").toBe(true);
    const copyOfA = structuredClone((await stored(id)).pcbWorking);
    const tokenOfA = copyOfA?.writeId;
    // B, loaded before A's edit, makes the same first edit and its autosave fires before its second (CI's slower runner): its board
    // is the stored board, so nothing is lost - but B's board derives from the copy B loaded, not from A's. [B24-D4 review,
    // 2026-10-10] correctness-4: B saves with its own base and a canonical claim, so any write over A's copy shows even under A's token
    expect(b.saveWorkingCopy(id, board(2), BASE_B, HEAD_B), "B's board is the stored board: no conflict").toBe(true);
    expect((await stored(id)).pcbWorking?.writeId, "nothing is written over A's copy").toBe(tokenOfA);
    expect((await stored(id)).pcbWorking, "A's copy is untouched: its token, base, claim and time are A's").toEqual(copyOfA);
    expect((await stored(id)).pcbWorkingConflict).toBeUndefined();
    // B's second edit: another tab wrote after the copy B's board derives from, so it is refused
    expect(b.saveWorkingCopy(id, board(3), BASE), "B's next edit is refused").toBe(b.WORKING_COPY_CONFLICT);
    const after = await stored(id);
    expect(after.pcbWorking?.board.tracks, "A's copy is not replaced").toHaveLength(2);
    expect(after.pcbWorking?.writeId).toBe(tokenOfA);
    expect(after.pcbWorkingConflict?.board.tracks, "B's board is the conflict record").toHaveLength(3);
    expect(after.pcbWorkingConflict?.reason).toMatch(/another tab/i);
    // A, whose copy it is, keeps saving
    expect(a.saveWorkingCopy(id, board(4), BASE)).toBe(true);
    expect((await stored(id)).pcbWorking?.board.tracks).toHaveLength(4);
  });

  it("10. [B24-D4] a checkpoint restore adopted after another tab wrote over the restored copy: the adoption never takes the other tab's copy for its own, and the restoring tab's next edit is refused", { timeout: 30_000 }, async () => {
    const id = await project();
    const a = await tab();
    a.loadWorkingCopy(id);
    expect(a.saveWorkingCopy(id, board(1), BASE)).toBe(true);
    // A restores a checkpoint while its editor is not mounted: page.tsx persists the restored board with no write token, and the
    // editor adopts it only when its board load answers (PcbEditor's load effect, the pending restore)
    await writeWithoutToken(id, board(5), Date.now() + 1);
    // meanwhile B loads that copy and saves an edit of it
    const b = await tab();
    expect(b.loadWorkingCopy(id)!.board.tracks).toHaveLength(5);
    expect(b.saveWorkingCopy(id, board(6), BASE)).toBe(true);
    // A's editor adopts the restored board: the stored copy is B's, not the one page.tsx persisted for A
    adoptRestore(a, id, board(5));
    expect(a.saveWorkingCopy(id, board(7), BASE), "A's edit of the restored board over B's newer copy is refused").toBe(a.WORKING_COPY_CONFLICT);
    const after = await stored(id);
    expect(after.pcbWorking?.board.tracks, "B's copy is not replaced").toHaveLength(6);
    expect(after.pcbWorkingConflict?.board.tracks, "A's board is the conflict record").toHaveLength(7);
  });

  it("11. [B24-D4 review] two tabs that loaded no copy hydrate the same board: the second tab's autosave of that board takes the stored copy for its own, so its first edit is not refused, and the first tab, now behind, is", { timeout: 30_000 }, async () => {
    const id = await project();
    const x = await tab();
    const y = await tab();
    expect(x.loadWorkingCopy(id)).toBeNull();
    expect(y.loadWorkingCopy(id)).toBeNull();
    // both adopt the same server board; Y's hydration autosave lands first, then X's of the very same board
    expect(y.saveWorkingCopy(id, board(1), BASE), "Y's hydration autosave").toBe(true);
    expect(x.saveWorkingCopy(id, board(1), BASE), "X's hydration autosave of the same board").toBe(true);
    expect(x.saveWorkingCopy(id, board(2), BASE), "X's first edit is not refused").toBe(true);
    const after = await stored(id);
    expect(after.pcbWorking?.board.tracks).toHaveLength(2);
    expect(after.pcbWorkingConflict, "no conflict record").toBeUndefined();
    expect(y.saveWorkingCopy(id, board(3), BASE), "Y, behind X's edit, is refused").toBe(y.WORKING_COPY_CONFLICT);
    expect((await stored(id)).pcbWorking?.board.tracks).toHaveLength(2);
  });

  it("12. [B24-D4 review] a restore whose copy another tab rewrote unchanged before the restoring tab adopted it is still that tab's own: its autosave and its edits are not refused, and the other tab, now behind, is", { timeout: 30_000 }, async () => {
    const id = await project();
    const a = await tab();
    a.loadWorkingCopy(id);
    expect(a.saveWorkingCopy(id, board(1), BASE)).toBe(true);
    // A restores a checkpoint while its editor waits on a board load: page.tsx persists the restored board with no write token
    await writeWithoutToken(id, board(5), Date.now() + 1);
    // B loads that copy and its hydration autosave writes it back unchanged (under the copy's own "legacy:" token)
    const b = await tab();
    expect(b.loadWorkingCopy(id)!.board.tracks).toHaveLength(5);
    expect(b.saveWorkingCopy(id, board(5), BASE), "B's unchanged rewrite").toBe(true);
    expect((await stored(id)).pcbWorking?.writeId, "the rewrite carries a token now").toMatch(/^legacy:/);
    // A's editor adopts its restored board: the stored copy holds that very board
    adoptRestore(a, id, board(5));
    expect(a.saveWorkingCopy(id, board(5), BASE), "A's autosave of its restored board").toBe(true);
    expect(a.saveWorkingCopy(id, board(6), BASE), "A's edit of its restored board is not refused").toBe(true);
    const after = await stored(id);
    expect(after.pcbWorking?.board.tracks).toHaveLength(6);
    expect(after.pcbWorkingConflict, "no conflict record").toBeUndefined();
    expect(b.saveWorkingCopy(id, board(7), BASE), "B, behind A's edit, is refused").toBe(b.WORKING_COPY_CONFLICT);
  });

  it("13. [B24-D4 review] two token-less restore writes race: A's adoption never takes B's restored copy for its own - A's restored board is refused and kept as the conflict record, B's copy stays and B keeps saving", { timeout: 30_000 }, async () => {
    const id = await project();
    const a = await tab();
    a.loadWorkingCopy(id);
    expect(a.saveWorkingCopy(id, board(1), BASE)).toBe(true);
    const b = await tab();
    expect(b.loadWorkingCopy(id)!.board.tracks).toHaveLength(1);
    // A restores a checkpoint while its editor waits on a board load (page.tsx's copy, no token) ...
    await writeWithoutToken(id, board(5), Date.now() + 1);
    // ... then B restores another checkpoint (page.tsx's copy in B, no token) and B's mounted editor adopts it at once
    await writeWithoutToken(id, board(8), Date.now() + 2);
    adoptRestore(b, id, board(8));
    // A's load answers and A's editor adopts ITS restored board: the stored copy is B's, a different board
    adoptRestore(a, id, board(5));
    expect(a.saveWorkingCopy(id, board(5), BASE), "A's autosave of its restored board over B's restored copy is refused").toBe(a.WORKING_COPY_CONFLICT);
    const after = await stored(id);
    expect(after.pcbWorking?.board.tracks, "B's restored copy is not replaced").toHaveLength(8);
    expect(after.pcbWorkingConflict?.board.tracks, "A's restored board is the conflict record").toHaveLength(5);
    expect(after.pcbWorkingConflict?.reason).toMatch(/another tab/i);
    expect(b.saveWorkingCopy(id, board(9), BASE), "B's own next edit goes through").toBe(true);
    expect((await stored(id)).pcbWorking?.board.tracks).toHaveLength(9);
  });
});
