/**
 * [PR-J3, 2026-10-22] Runbook J.3 item 5, J.8.4; OD-257 item 5: the per-project presentation store of the Sheets navigator
 * (app/lib/project/sheet-navigation-store.ts).
 *
 *  1. the key is "sirkit:sheet-view:<projectId>"; a record round-trips through a storage; clear removes exactly that key;
 *  2. a malformed, foreign-version or partial record reads as null (bad cameras are dropped, the rest kept); the history is bounded;
 *  3. a throwing or absent storage is tolerated: reads answer null, writes and clears answer false, nothing throws;
 *  4. J.8.4: a stored active sheet that no longer exists resolves to the root WITH a notice on a multi-sheet document and silently on a
 *     single-sheet one; an existing one resolves to itself;
 *  5. the record helpers: withActiveSheet (history, no duplicate tail), withSheetCamera, pruneSheetView;
 *  6. the module registers no `storage` event listener and touches no document field (source pins).
 * Pure: a fake storage; nothing on disk.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT_SHEET_ID } from "@/lib/schematic-types";
import {
  SHEET_VIEW_HISTORY_LIMIT,
  SHEET_VIEW_STORAGE_PREFIX,
  clearSheetView,
  emptySheetView,
  parseSheetViewRecord,
  pruneSheetView,
  readSheetView,
  resolveStoredActiveSheet,
  sheetViewStorageKey,
  withActiveSheet,
  withSheetCamera,
  writeSheetView,
  type SheetViewRecord,
  type StorageLike,
} from "../sheet-navigation-store";

class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
}

const throwing: StorageLike = {
  getItem: () => { throw new Error("SecurityError: storage is blocked"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => { throw new Error("SecurityError"); },
};

const record = (): SheetViewRecord => ({ version: 1, activeSheetId: "sheet-imu", cameras: { "sheet-imu": { pan: { x: 12, y: -4 }, zoom: 1.5 }, root: { pan: { x: 0, y: 0 }, zoom: 0.5 } }, history: [ROOT_SHEET_ID, "sheet-imu"] });
const SHEETS = [{ id: ROOT_SHEET_ID, name: "Overview" }, { id: "sheet-imu", name: "IMU" }, { id: "sheet-power", name: "Power" }];

describe("[PR-J3] the sheet-view presentation store", () => {
  it("1. key, round trip, clear", () => {
    const storage = new FakeStorage();
    expect(sheetViewStorageKey("p-1")).toBe("sirkit:sheet-view:p-1");
    expect(SHEET_VIEW_STORAGE_PREFIX).toBe("sirkit:sheet-view:");
    expect(readSheetView("p-1", storage)).toBeNull();
    expect(writeSheetView("p-1", record(), storage)).toBe(true);
    expect([...storage.map.keys()]).toEqual(["sirkit:sheet-view:p-1"]);
    expect(readSheetView("p-1", storage)).toEqual(record());
    storage.setItem("sirkit:project:p-1", "{}"); // another key of the same project is never touched
    expect(clearSheetView("p-1", storage)).toBe(true);
    expect([...storage.map.keys()]).toEqual(["sirkit:project:p-1"]);
    expect(readSheetView("p-1", storage)).toBeNull();
  });

  it("2. strict parsing: malformed, foreign version and partial records; bad cameras dropped; the history bounded", () => {
    expect(parseSheetViewRecord(null)).toBeNull();
    expect(parseSheetViewRecord("not json")).toBeNull();
    expect(parseSheetViewRecord("[]")).toBeNull();
    expect(parseSheetViewRecord(JSON.stringify({ version: 2, activeSheetId: "x", cameras: {}, history: [] }))).toBeNull();
    expect(parseSheetViewRecord(JSON.stringify({ version: 1, activeSheetId: "", cameras: {}, history: [] }))).toBeNull();
    const partial = parseSheetViewRecord(JSON.stringify({ version: 1, activeSheetId: "a", cameras: { a: { pan: { x: 1, y: 2 }, zoom: 2 }, b: { pan: { x: "1", y: 2 }, zoom: 1 }, c: { pan: { x: 0, y: 0 }, zoom: 0 }, d: null }, history: ["a", 3, "b"] }));
    expect(partial).toEqual({ version: 1, activeSheetId: "a", cameras: { a: { pan: { x: 1, y: 2 }, zoom: 2 } }, history: ["a", "b"] });
    const long = parseSheetViewRecord(JSON.stringify({ version: 1, activeSheetId: "a", cameras: {}, history: Array.from({ length: 100 }, (_, index) => `s${index}`) }))!;
    expect(long.history).toHaveLength(SHEET_VIEW_HISTORY_LIMIT);
    expect(long.history[0]).toBe(`s${100 - SHEET_VIEW_HISTORY_LIMIT}`);
    const storage = new FakeStorage();
    expect(writeSheetView("p", { ...record(), history: Array.from({ length: 100 }, (_, index) => `s${index}`) }, storage)).toBe(true);
    expect(readSheetView("p", storage)!.history).toHaveLength(SHEET_VIEW_HISTORY_LIMIT);
  });

  it("3. a throwing or absent storage is tolerated", () => {
    expect(readSheetView("p", throwing)).toBeNull();
    expect(writeSheetView("p", record(), throwing)).toBe(false);
    expect(clearSheetView("p", throwing)).toBe(false);
    expect(readSheetView("p", null)).toBeNull();
    expect(writeSheetView("p", record(), null)).toBe(false);
    expect(clearSheetView("p", null)).toBe(false);
  });

  it("4. J.8.4: an unknown stored sheet falls back to the root - with a notice on a multi-sheet document, silently on a single-sheet one", () => {
    expect(resolveStoredActiveSheet(record(), SHEETS)).toEqual({ sheetId: "sheet-imu", notice: null });
    expect(resolveStoredActiveSheet(null, SHEETS)).toEqual({ sheetId: ROOT_SHEET_ID, notice: null });
    const ghost = resolveStoredActiveSheet({ ...record(), activeSheetId: "sheet-ghost" }, SHEETS);
    expect(ghost.sheetId).toBe(ROOT_SHEET_ID);
    expect(ghost.notice).toMatch(/sheet-ghost.*no longer exists.*overview.*Nothing was changed/);
    expect(resolveStoredActiveSheet({ ...record(), activeSheetId: "sheet-ghost" }, [{ id: ROOT_SHEET_ID, name: "Overview" }])).toEqual({ sheetId: ROOT_SHEET_ID, notice: null });
  });

  it("5. the record helpers", () => {
    const base = emptySheetView();
    expect(base).toEqual({ version: 1, activeSheetId: ROOT_SHEET_ID, cameras: {}, history: [] });
    const opened = withActiveSheet(withActiveSheet(withActiveSheet(base, "a"), "a"), "b");
    expect(opened.activeSheetId).toBe("b");
    expect(opened.history).toEqual(["a", "b"]); // no duplicate tail
    const camera = withSheetCamera(opened, "b", { pan: { x: 3, y: 4 }, zoom: 2 });
    expect(camera.cameras).toEqual({ b: { pan: { x: 3, y: 4 }, zoom: 2 } });
    expect(opened.cameras).toEqual({}); // immutable
    const pruned = pruneSheetView(withSheetCamera(camera, "a", { pan: { x: 0, y: 0 }, zoom: 1 }), new Set(["b"]));
    expect(pruned.cameras).toEqual({ b: { pan: { x: 3, y: 4 }, zoom: 2 } });
    expect(pruned.history).toEqual(["b"]);
    let bounded = base;
    for (let index = 0; index < 50; index += 1) bounded = withActiveSheet(bounded, `s${index}`);
    expect(bounded.history).toHaveLength(SHEET_VIEW_HISTORY_LIMIT);
  });

  it("6. source pins: no storage event listener, no document field, every storage access in try/catch", () => {
    const source = readFileSync(resolve(process.cwd(), "app/lib/project/sheet-navigation-store.ts"), "utf8");
    expect(source).not.toMatch(/addEventListener/);
    expect(source).not.toMatch(/components|wires|netLabels|kicadComponents/);
    expect(source.match(/try \{/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(source).toContain('"sirkit:sheet-view:"');
  });
});
