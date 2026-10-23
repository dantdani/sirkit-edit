/**
 * [PR-J3, 2026-10-22] Runbook J.2 / J.3 item 5 / J.8.4; OD-257 item 5: the per-project PRESENTATION store of the Sheets navigator -
 * the active sheet, each sheet's camera (pan and zoom) and the navigation history - in localStorage under
 * "sirkit:sheet-view:<projectId>". It is presentation / session state, never the document: nothing here is circuit connectivity,
 * nothing here is read by any consumer, and deleting the project clears it (lib/persistence.ts deleteProject calls
 * `clearSheetView`). Every read and write is in try/catch (a private window, a full or blocked store, a corrupt record read as
 * absent); no `storage` event listener is registered (multi-tab conflicts stay the document's affair, multi-tab.spec.ts:242).
 * A stored active sheet that no longer exists falls back to the root VISIBLY (`resolveStoredActiveSheet` returns the notice) and
 * writes nothing to the document (J.8.4).
 *
 * Pure apart from the storage it is handed (defaults to `window.localStorage` when one exists).
 */

import { ROOT_SHEET_ID, type Point } from "@/lib/schematic-types";

export const SHEET_VIEW_STORAGE_PREFIX = "sirkit:sheet-view:";
export const SHEET_VIEW_RECORD_VERSION = 1 as const;
/** At most this many sheet ids are kept in the navigation history. */
export const SHEET_VIEW_HISTORY_LIMIT = 32;

export interface SheetCamera {
  pan: Point;
  zoom: number;
}

export interface SheetViewRecord {
  version: typeof SHEET_VIEW_RECORD_VERSION;
  activeSheetId: string;
  /** Per-sheet camera, keyed by sheet id. */
  cameras: Record<string, SheetCamera>;
  /** The sheets opened, oldest first (bounded). */
  history: string[];
}

/** The subset of the Web Storage interface the store uses (tests pass a fake; a throwing one is tolerated). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function sheetViewStorageKey(projectId: string): string {
  return `${SHEET_VIEW_STORAGE_PREFIX}${projectId}`;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

const isFinitePoint = (value: unknown): value is Point => typeof value === "object" && value !== null && Number.isFinite((value as Point).x) && Number.isFinite((value as Point).y);

function readCamera(value: unknown): SheetCamera | null {
  if (typeof value !== "object" || value === null) return null;
  const camera = value as { pan?: unknown; zoom?: unknown };
  if (!isFinitePoint(camera.pan) || typeof camera.zoom !== "number" || !Number.isFinite(camera.zoom) || camera.zoom <= 0) return null;
  return { pan: { x: camera.pan.x, y: camera.pan.y }, zoom: camera.zoom };
}

/** A record read strictly: anything malformed reads as null (the navigator then starts at the root). */
export function parseSheetViewRecord(raw: string | null): SheetViewRecord | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const record = value as { version?: unknown; activeSheetId?: unknown; cameras?: unknown; history?: unknown };
    if (record.version !== SHEET_VIEW_RECORD_VERSION || typeof record.activeSheetId !== "string" || record.activeSheetId.length === 0) return null;
    const cameras: Record<string, SheetCamera> = {};
    if (typeof record.cameras === "object" && record.cameras !== null) {
      for (const [sheetId, camera] of Object.entries(record.cameras as Record<string, unknown>)) {
        const parsed = readCamera(camera);
        if (parsed) cameras[sheetId] = parsed;
      }
    }
    const history = Array.isArray(record.history) ? record.history.filter((item): item is string => typeof item === "string").slice(-SHEET_VIEW_HISTORY_LIMIT) : [];
    return { version: SHEET_VIEW_RECORD_VERSION, activeSheetId: record.activeSheetId, cameras, history };
  } catch {
    return null;
  }
}

export function readSheetView(projectId: string, storage: StorageLike | null = defaultStorage()): SheetViewRecord | null {
  if (!storage) return null;
  try {
    return parseSheetViewRecord(storage.getItem(sheetViewStorageKey(projectId)));
  } catch {
    return null;
  }
}

/** Writes the record; returns whether the write happened (a throwing or absent store is tolerated). */
export function writeSheetView(projectId: string, record: SheetViewRecord, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    const bounded: SheetViewRecord = { ...record, version: SHEET_VIEW_RECORD_VERSION, history: record.history.slice(-SHEET_VIEW_HISTORY_LIMIT) };
    storage.setItem(sheetViewStorageKey(projectId), JSON.stringify(bounded));
    return true;
  } catch {
    return false;
  }
}

/** Removes the project's record (deleteProject). */
export function clearSheetView(projectId: string, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(sheetViewStorageKey(projectId));
    return true;
  } catch {
    return false;
  }
}

/** A fresh record at the root. */
export function emptySheetView(): SheetViewRecord {
  return { version: SHEET_VIEW_RECORD_VERSION, activeSheetId: ROOT_SHEET_ID, cameras: {}, history: [] };
}

/** The record after opening `sheetId`: the active sheet and the bounded history. */
export function withActiveSheet(record: SheetViewRecord, sheetId: string): SheetViewRecord {
  const history = record.history[record.history.length - 1] === sheetId ? record.history : [...record.history, sheetId].slice(-SHEET_VIEW_HISTORY_LIMIT);
  return { ...record, activeSheetId: sheetId, history };
}

/** The record with `sheetId`'s camera replaced. */
export function withSheetCamera(record: SheetViewRecord, sheetId: string, camera: SheetCamera): SheetViewRecord {
  return { ...record, cameras: { ...record.cameras, [sheetId]: { pan: { x: camera.pan.x, y: camera.pan.y }, zoom: camera.zoom } } };
}

/** The record without the sheets that no longer exist (their cameras go with them). */
export function pruneSheetView(record: SheetViewRecord, existingSheetIds: ReadonlySet<string>): SheetViewRecord {
  const cameras = Object.fromEntries(Object.entries(record.cameras).filter(([sheetId]) => existingSheetIds.has(sheetId)));
  return { ...record, cameras, history: record.history.filter((sheetId) => existingSheetIds.has(sheetId)) };
}

export interface ResolvedActiveSheet {
  sheetId: string;
  /** Set when the stored sheet does not exist: the user is told, and the document is not touched (J.8.4). */
  notice: string | null;
}

/**
 * J.8.4: the stored active sheet when it exists, else the root with a visible notice. A single-sheet document (no tree) is always at
 * the root without a notice (a stale record from before its last child sheet was deleted is not an error worth a message).
 */
export function resolveStoredActiveSheet(record: SheetViewRecord | null, sheets: ReadonlyArray<{ id: string; name: string }>): ResolvedActiveSheet {
  const stored = record?.activeSheetId ?? ROOT_SHEET_ID;
  if (stored === ROOT_SHEET_ID || sheets.some((sheet) => sheet.id === stored)) return { sheetId: stored, notice: null };
  const multiSheet = sheets.some((sheet) => sheet.id !== ROOT_SHEET_ID);
  return { sheetId: ROOT_SHEET_ID, notice: multiSheet ? `The sheet last open here (${stored}) no longer exists; showing the overview. Nothing was changed.` : null };
}
