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
/** The editor's checkpoint-restore adoption step (absent before the review fix, so then nothing is remembered). */
const adoptRestore = (persistence: BoardPersistence, projectId: string): void => (persistence as Partial<Pick<BoardPersistence, "rememberStoredWorkingCopy">>).rememberStoredWorkingCopy?.(projectId);

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
    adoptRestore(a, id);
    // an edit of the restored board before its first autosave (the debounce restarts on each change)
    expect(a.saveWorkingCopy(id, board(6), BASE), "the restoring tab's own next edit").toBe(true);
    const after = await stored(id);
    expect(after.pcbWorking?.board.tracks).toHaveLength(6);
    expect(after.pcbWorkingConflict).toBeUndefined();
    // the editor makes that adoption at both checkpoint-restore adoptions (the restore event and the load effect's pending restore)
    const editor = readFileSync("app/components/pcb/PcbEditor.tsx", "utf8").split("\n").filter((line) => line.includes('adoptBoardLifecycle("checkpoint-restore"'));
    expect(editor).toHaveLength(2);
    for (const line of editor) expect(line).toContain("rememberStoredWorkingCopy(");
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
});
