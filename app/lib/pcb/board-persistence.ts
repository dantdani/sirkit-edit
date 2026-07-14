"use client";

/**
 * Board ⇄ project-record persistence (PCB Stage 4).
 *
 * The board lives on the SavedProject's `pcb` field (lib/persistence.ts).
 * The projects UI isn't wired to that module yet, so this keeps a
 * "current project" pointer in localStorage: the first board save creates a
 * project record seeded with the current schematic; later saves update only
 * the `pcb` field. When the projects panel gets wired up, it takes over the
 * pointer and this keeps working unchanged.
 *
 * The demo board (?pcbdemo=) must never pass through here.
 */

import type { SchematicState } from "@/lib/schematic-types";
import { createProject, loadProject, saveProjectPcb } from "@/lib/persistence";
import type { PcbBoard } from "./types";
import { ensureBoardPadstacks } from "./padstack/migrate"; // Stage 17

const CURRENT_PROJECT_KEY = "sirkit:currentProjectId";
const SYNC_HASH_PREFIX = "sirkit:pcbSyncHash:";

function currentProjectId(): string | null {
  try {
    return localStorage.getItem(CURRENT_PROJECT_KEY);
  } catch {
    return null;
  }
}

/** Stage 11 migration: boards saved before zone fill lack the new Zone fields. */
function normalizeZones(board: PcbBoard): PcbBoard {
  for (const zone of board.zones) {
    zone.appearance ??= "solid";
    zone.connection ??= "thermal";
    zone.fill ??= [];
    zone.dirty ??= true;
  }
  return board;
}

/** Stage 17 migration: seed the padstack library + link legacy vias. Runs
 *  outside history (not undoable), idempotent — see padstack/migrate.ts. */
function normalizePadstacks(board: PcbBoard): PcbBoard {
  ensureBoardPadstacks(board);
  return board;
}

/** Board + last-synced netlist hash for the current project, if any. */
export function loadCurrentBoard(): { board: PcbBoard | null; lastSyncHash: string | null } {
  const id = currentProjectId();
  if (!id) return { board: null, lastSyncHash: null };
  const project = loadProject(id);
  let lastSyncHash: string | null = null;
  try {
    lastSyncHash = localStorage.getItem(SYNC_HASH_PREFIX + id);
  } catch {
    /* unavailable — treat as never synced */
  }
  return { board: project?.pcb ? normalizePadstacks(normalizeZones(project.pcb)) : null, lastSyncHash };
}

/**
 * Persist the board (creating the project record on first save). Returns
 * false on quota/storage failure — the caller must surface that visibly.
 */
export function saveCurrentBoard(
  board: PcbBoard,
  schematic: SchematicState,
  lastSyncHash: string | null,
): boolean {
  let id = currentProjectId();
  if (!id || !loadProject(id)) {
    const project = createProject("Untitled project", schematic);
    id = project.id;
    try {
      localStorage.setItem(CURRENT_PROJECT_KEY, id);
    } catch {
      return false;
    }
  }
  const ok = saveProjectPcb(id, board);
  if (ok && lastSyncHash !== null) {
    try {
      localStorage.setItem(SYNC_HASH_PREFIX + id, lastSyncHash);
    } catch {
      /* hash is a nicety; the board itself saved */
    }
  }
  return ok;
}
