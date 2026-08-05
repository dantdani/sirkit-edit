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
import { createProject, loadProject, loadProjectSalvaged, saveProjectFields, saveProjectPcb, saveProjectPcbRelease, type PcbCanonicalHead, type PcbStageEvidence, type PcbWorkingCopy } from "@/lib/persistence";
import type { PcbBoard } from "./types";
import { ensureBoardPadstacks } from "./padstack/migrate"; // Stage 17
import { loadAiBrainPreference, saveAiBrainPreference } from "@/app/lib/ai-preferences";
import { migrateBoardElectricalIdentities, type EngineeringDiagnostic } from "./integrity";
import type { ManufacturingReleaseManifest } from "./readiness/types";
import { migrateBoardConstraintState } from "@/app/lib/constraints/legacy";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import type { PcbSyncBoardRecord } from "@/app/lib/pcb-sync/types";

const CURRENT_PROJECT_KEY = "sirkit:currentProjectId";
const SYNC_HASH_PREFIX = "sirkit:pcbSyncHash:";
const AUTHORITY_CACHE_PREFIX = "sirkit:pcbAuthorityCache:";
const SNAPSHOT_REVISION_PREFIX = "sirkit:pcbSnapshotRevision:";

function currentProjectId(): string | null {
  try {
    return localStorage.getItem(CURRENT_PROJECT_KEY);
  } catch {
    return null;
  }
}

/** Local product scope used by feature-gated server workbenches. */
export function loadCurrentProjectScope(): { tenantId: "local"; projectId: string; branchId: "main" } | null {
  const projectId = currentProjectId();
  return projectId ? { tenantId: "local", projectId, branchId: "main" } : null;
}

export function ensureCurrentProjectScope(schematic: SchematicState): { tenantId: "local"; projectId: string; branchId: "main" } {
  const current = loadCurrentProjectScope(); if (current && loadProject(current.projectId)) return current;
  const project = createProject("Untitled project", schematic); localStorage.setItem(CURRENT_PROJECT_KEY, project.id); saveAiBrainPreference(loadAiBrainPreference());
  return { tenantId: "local", projectId: project.id, branchId: "main" };
}

function cacheKey(scope: { tenantId: string; projectId: string; branchId: string; boardId: string }): string { return `${AUTHORITY_CACHE_PREFIX}${scope.tenantId}:${scope.projectId}:${scope.branchId}:${scope.boardId}`; }
function boardLike(value: unknown): value is PcbBoard { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const board = value as Record<string, unknown>; return board.formatVersion === 1 && (board.stackup === 2 || board.stackup === 4) && ["nets", "footprints", "tracks", "vias", "zones", "texts"].every((key) => Array.isArray(board[key])); }
function cachedRecord(value: unknown): value is PcbSyncBoardRecord { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const record = value as Record<string, unknown>; return ["tenantId", "projectId", "branchId", "boardId", "revision", "digest", "updatedAt"].every((key) => typeof record[key] === "string") && boardLike(record.board); }

export function saveAuthoritativeBoardCache(record: PcbSyncBoardRecord): boolean { const rebuilt = makeBoardRecord({ tenantId: record.tenantId, projectId: record.projectId, branchId: record.branchId, boardId: record.boardId, board: record.board, updatedAt: record.updatedAt }); if (rebuilt.revision !== record.revision || rebuilt.digest !== record.digest) return false; try { localStorage.setItem(cacheKey(record), JSON.stringify(record)); return true; } catch { return false; } }
export function loadAuthoritativeBoardCache(scope: { tenantId: string; projectId: string; branchId: string; boardId: string }, authority: { revision: string; digest: string }): PcbSyncBoardRecord | null { try { const raw = localStorage.getItem(cacheKey(scope)); if (!raw) return null; const parsed: unknown = JSON.parse(raw); if (!cachedRecord(parsed) || parsed.tenantId !== scope.tenantId || parsed.projectId !== scope.projectId || parsed.branchId !== scope.branchId || parsed.boardId !== scope.boardId || parsed.revision !== authority.revision || parsed.digest !== authority.digest) return null; const rebuilt = makeBoardRecord({ ...scope, board: parsed.board, updatedAt: parsed.updatedAt }); return rebuilt.revision === parsed.revision && rebuilt.digest === parsed.digest ? parsed : null; } catch { return null; } }
export function loadPcbSnapshotRevision(projectId: string): number { try { const value = Number(localStorage.getItem(SNAPSHOT_REVISION_PREFIX + projectId)); return Number.isSafeInteger(value) && value >= 0 ? value : 0; } catch { return 0; } }
export function savePcbSnapshotRevision(projectId: string, revision: number): void { if (!Number.isSafeInteger(revision) || revision < 0) return; try { localStorage.setItem(SNAPSHOT_REVISION_PREFIX + projectId, String(revision)); } catch { /* server remains authoritative */ } }

/** A pre-durable local PCB is import material only; callers must never adopt it as server authority. */
export function loadLegacyBoardImport(): PcbBoard | null { const id = currentProjectId(), project = id ? loadProject(id) : null; if (!id || !project?.pcb) return null; const normalized = normalizePadstacks(normalizeZones(project.pcb)); return migrateBoardConstraintState(migrateBoardElectricalIdentities(normalized, id).board, id).board; }

/** Stage 11 migration: boards saved before zone fill lack the new Zone fields. */
function normalizeZones(board: PcbBoard): PcbBoard {
  for (const zone of board.zones) {
    zone.appearance ??= "solid";
    zone.connection ??= "thermal";
    zone.fill ??= [];
    zone.dirty ??= true;
    zone.source ??= "user";
    zone.priority ??= 0;
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
export function loadCurrentBoard(): {
  board: PcbBoard | null;
  lastSyncHash: string | null;
  diagnostics: EngineeringDiagnostic[];
} {
  const id = currentProjectId();
  if (!id) return { board: null, lastSyncHash: null, diagnostics: [] };
  const project = loadProject(id);
  let lastSyncHash: string | null = null;
  try {
    lastSyncHash = localStorage.getItem(SYNC_HASH_PREFIX + id);
  } catch {
    /* unavailable — treat as never synced */
  }
  if (!project?.pcb) return { board: null, lastSyncHash, diagnostics: [] };
  const normalized = normalizePadstacks(normalizeZones(project.pcb));
  const identityMigration = migrateBoardElectricalIdentities(normalized, id);
  const constraintMigration = migrateBoardConstraintState(identityMigration.board, id);
  return { board: constraintMigration.board, lastSyncHash, diagnostics: [...identityMigration.diagnostics, ...constraintMigration.diagnostics] };
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
      // Attach the already-active global brain to the newly materialized project.
      saveAiBrainPreference(loadAiBrainPreference());
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

/** Store immutable historical release evidence; it never changes live readiness. */
export function saveCurrentManufacturingRelease(release: ManufacturingReleaseManifest): boolean {
  const id = currentProjectId();
  return id !== null && saveProjectPcbRelease(id, release);
}

// ─── R06: local working-board copy ───────────────────────────────────────────
// The durable server board remains the authority for everything ever APPLIED.
// The working copy persists the user's editor work (moves, routing, zones)
// layered on an exact authoritative base named by baseRevision/baseDigest.
// It is a recovery/persistence surface, never a substitute authority: when
// the server has moved past the working copy's base, the copy is stashed as
// a conflict record instead of silently winning (or silently dying).

/**
 * Normalize a board entering the editor (server adoption, working-copy load,
 * checkpoint restore). Every entry path MUST use this so the board's semantic
 * revision (pcbRevisionId) is migration-invariant: routing/release evidence
 * recorded against a board must still match it after a reload re-runs the
 * zone/padstack/constraint migrations.
 */
export function normalizeBoardForEditor(board: PcbBoard, projectId: string): PcbBoard {
  const normalized = normalizePadstacks(normalizeZones(structuredClone(board)));
  const identity = migrateBoardElectricalIdentities(normalized, projectId);
  return migrateBoardConstraintState(identity.board, projectId).board;
}

/** Load and migrate the project's working board copy, if any. */
export function loadWorkingCopy(projectId: string): PcbWorkingCopy | null {
  const salvaged = loadProjectSalvaged(projectId);
  const working = salvaged?.project.pcbWorking;
  if (!working || !working.board) return null;
  const normalized = normalizePadstacks(normalizeZones(working.board));
  const identity = migrateBoardElectricalIdentities(normalized, projectId);
  const constraints = migrateBoardConstraintState(identity.board, projectId);
  return { ...working, board: constraints.board };
}

/** Persist the current editor board. Returns false on quota/storage failure.
 *  `canonicalHead` (B03) is stored only when the caller verified the board is
 *  at that canonical head; passing null/undefined clears any previous claim so
 *  a legacy-path edit can never inherit a stale canonical identity. */
export function saveWorkingCopy(projectId: string, board: PcbBoard, base: { revision: string; digest: string } | null, canonicalHead?: PcbCanonicalHead | null): boolean {
  return saveProjectFields(projectId, {
    pcbWorking: { board, baseRevision: base?.revision ?? null, baseDigest: base?.digest ?? null, updatedAt: Date.now(), ...(canonicalHead ? { canonicalHead } : {}) },
  });
}

/** Preserve a diverged working copy instead of overwriting it. */
export function stashWorkingConflict(projectId: string, copy: PcbWorkingCopy, reason: string): boolean {
  return saveProjectFields(projectId, { pcbWorkingConflict: { ...copy, reason }, pcbWorking: undefined });
}

export function loadStageEvidence(projectId: string): PcbStageEvidence {
  return loadProjectSalvaged(projectId)?.project.pcbStages ?? {};
}

/** Merge-patch downstream-stage evidence identity (routing/release digests). */
export function saveStageEvidence(projectId: string, patch: Partial<PcbStageEvidence>): boolean {
  const current = loadStageEvidence(projectId);
  return saveProjectFields(projectId, { pcbStages: { ...current, ...patch } });
}
