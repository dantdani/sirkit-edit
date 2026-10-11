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

/** [B12.5 §C] This function must NEVER write the current-project pointer:
 *  activation — and the pointer — belong exclusively to the page's
 *  transactional install. Existence is checked with the SALVAGE loader
 *  (the page's own bootstrap semantics): a record whose optional staged
 *  sub-states fail strict validation is still an EXISTING project, and
 *  repointing away from it minted a phantom "Untitled project" that
 *  desynchronized the persisted pointer from the visibly installed
 *  project (adversarial finding on R2's closure). The degenerate
 *  no-project fallback materializes a RECORD (persisted, inactive) so
 *  PCB persistence has a stable home, but leaves the pointer untouched. */
export function ensureCurrentProjectScope(schematic: SchematicState): { tenantId: "local"; projectId: string; branchId: "main" } {
  const current = loadCurrentProjectScope(); if (current && loadProjectSalvaged(current.projectId)) return current;
  const project = createProject("Untitled project", schematic); saveAiBrainPreference(loadAiBrainPreference());
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
  if (!id || !loadProjectSalvaged(id)) {
    // [B12.5 §C] Materialize a record WITHOUT activating it — the
    // current-project pointer is written only by the page's winning
    // transactional install, never from PCB persistence.
    const project = createProject("Untitled project", schematic);
    id = project.id;
    // Attach the already-active global brain to the newly materialized project.
    saveAiBrainPreference(loadAiBrainPreference());
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
  rememberWorkingCopy(projectId, working && working.board ? working : null); if (!working || !working.board) return null; // [B24-D2, 2026-10-09] this tab's copy, compared before its next write
  const normalized = normalizePadstacks(normalizeZones(working.board));
  const identity = migrateBoardElectricalIdentities(normalized, projectId);
  const constraints = migrateBoardConstraintState(identity.board, projectId);
  return rememberLoadedBoard(projectId, { ...working, board: constraints.board }); // [B24-D2 review, 2026-10-09] and the board this tab adopts from it
}

/** Persist the current editor board. Returns false on quota/storage failure.
 *  `canonicalHead` (B03) is stored only when the caller verified the board is
 *  at that canonical head; passing null/undefined clears any previous claim so
 *  a legacy-path edit can never inherit a stale canonical identity. */
export function saveWorkingCopy(projectId: string, board: PcbBoard, base: { revision: string; digest: string } | null, canonicalHead?: PcbCanonicalHead | null): boolean | typeof WORKING_COPY_CONFLICT { // [B24-D2, 2026-10-09] D24-30, OD-214: compare-before-write - a copy another tab wrote since this tab last loaded or saved is never replaced: this tab's board becomes the conflict record (the other copy stays) and the answer is WORKING_COPY_CONFLICT
  const write = prepareWorkingCopyWrite(projectId, board), copy: PcbWorkingCopy = { board, baseRevision: base?.revision ?? null, baseDigest: base?.digest ?? null, updatedAt: Date.now(), writeId: write.writeId, ...(canonicalHead ? { canonicalHead } : {}) }; if (write.conflict) return stashWorkingConflict(projectId, copy, WORKING_COPY_CONFLICT_REASON, { keepWorking: true }) ? WORKING_COPY_CONFLICT : false; if (write.skip) return true; /* [B24-D4, 2026-10-10] D24-30: another tab's copy already holds this very board - nothing to write, and this tab's base stays the copy its board derives from */ const saved = saveProjectFields(projectId, { // [B24-D2 review, 2026-10-09] an unchanged board keeps the copy's token (prepareWorkingCopyWrite)
    pcbWorking: copy,
  }); if (saved) rememberWorkingCopy(projectId, copy, write.boardJson); return saved;
}

/** Preserve a diverged working copy instead of overwriting it. */
export function stashWorkingConflict(projectId: string, copy: PcbWorkingCopy, reason: string, options: { keepWorking?: boolean } = {}): boolean { // [B24-D2, 2026-10-09] keepWorking: a refused save keeps the other tab's copy in the slot
  const stashed = saveProjectFields(projectId, { pcbWorkingConflict: { ...copy, reason }, ...(options.keepWorking ? {} : { pcbWorking: undefined }) }); if (stashed && !options.keepWorking) rememberWorkingCopy(projectId, null); return stashed;
}

export function loadStageEvidence(projectId: string): PcbStageEvidence {
  return loadProjectSalvaged(projectId)?.project.pcbStages ?? {};
}

/** Merge-patch downstream-stage evidence identity (routing/release digests). */
export function saveStageEvidence(projectId: string, patch: Partial<PcbStageEvidence>): boolean {
  const current = loadStageEvidence(projectId);
  return saveProjectFields(projectId, { pcbStages: { ...current, ...patch } });
}

// ─── [B24-D2, 2026-10-09] D24-30, OD-214: two tabs, one working copy ─────────────────────────────────────────────────────────
// Every tab of one browser profile shares the project's working copy (localStorage). Each tab (each instance of this module)
// remembers the copy it last loaded or saved, by its write token, and compares the stored copy to it before it writes: a copy
// another tab wrote since is never silently replaced. No cross-tab channel (no BroadcastChannel, storage event or lock): the
// compare happens at the write. A tab that never loaded a copy writes as before.

/** The answer of a save refused because another tab wrote the copy since this tab last loaded or saved it. */
export const WORKING_COPY_CONFLICT = "conflict" as const;
/** The conflict record's reason. */
export const WORKING_COPY_CONFLICT_REASON = "Another tab saved this project's working copy after this tab loaded it; this tab's board was not saved over it.";
/** What the tab says (the load-time stash's wording: "preserved as a recoverable conflict record"). */
export const WORKING_COPY_CONFLICT_TOAST = "Another tab saved this project's board after this tab loaded it. This tab's changes were not saved over it; they were preserved as a recoverable conflict record.";

/** projectId -> the copy this tab last loaded or saved: its write token (null: there was none) and the JSON of the board the tab
 *  holds from it (null: none yet); absent: this tab never loaded one. */
const knownWorkingCopies = new Map<string, { token: string | null; boardJson: string | null }>();
const tokenOf = (copy: Pick<PcbWorkingCopy, "updatedAt" | "writeId"> | null | undefined): string | null => (copy ? copy.writeId ?? `legacy:${copy.updatedAt}` : null);
function rememberWorkingCopy(projectId: string, copy: Pick<PcbWorkingCopy, "updatedAt" | "writeId"> | null, boardJson: string | null = null): void {
  knownWorkingCopies.set(projectId, { token: tokenOf(copy), boardJson: copy ? boardJson : null });
}
/** [B24-D2 review, 2026-10-09] The board a load hands the editor (normalized), remembered beside the copy's token. */
function rememberLoadedBoard(projectId: string, copy: PcbWorkingCopy): PcbWorkingCopy {
  const known = knownWorkingCopies.get(projectId);
  if (known) known.boardJson = JSON.stringify(copy.board);
  return copy;
}
function storedWorkingCopy(projectId: string): PcbWorkingCopy | null {
  const stored = loadProjectSalvaged(projectId)?.project.pcbWorking;
  return stored && stored.board ? stored : null;
}
/**
 * [B24-D2 review, 2026-10-09] This tab's next write of `board`, decided against the stored copy (compare-before-write):
 *  - a CONFLICT when another tab wrote since this tab last loaded or saved (the token moved) and the stored board is neither this
 *    board nor the board this tab held - another tab's different board, never silently replaced (never, for a tab that never loaded);
 *  - otherwise the write's token: the stored copy's OWN token when the write changes no board (the stored board, or the very board
 *    this tab holds with nobody writing since; a normalized reload of it included), so an idle tab's autosave of an unchanged
 *    board never makes the copy another tab remembers look rewritten; a fresh token for a changed board. [B24-D4, 2026-10-10] A SKIP when another tab wrote since and its board is this board but not the board this tab held: nothing is written and the tab keeps its base (CI run 38061798204); [B24-D4 review, 2026-10-10] a tab that holds no copy's board writes it under the copy's token, as before.
 */
function prepareWorkingCopyWrite(projectId: string, board: PcbBoard): { conflict: boolean; skip?: boolean; writeId: string; boardJson: string } {
  const boardJson = JSON.stringify(board);
  const stored = storedWorkingCopy(projectId);
  const known = knownWorkingCopies.get(projectId);
  const storedToken = tokenOf(stored);
  const storedJson = stored ? JSON.stringify(stored.board) : null;
  const untouched = known !== undefined && storedToken === known.token;
  if (known !== undefined && !untouched && storedJson !== boardJson && (storedJson === null || storedJson !== known.boardJson)) return { conflict: true, writeId: nextWriteId(), boardJson };
  const unchanged = stored !== null && (storedJson === boardJson || (untouched && known.boardJson === boardJson)), notOurs = known !== undefined && !untouched && known.boardJson !== null && storedJson !== known.boardJson; // [B24-D4, 2026-10-10] D24-30: a copy another tab wrote over a board this tab did not hold is never adopted as this tab's own, even when this tab's edit reproduces it; [B24-D4 review, 2026-10-10] correctness-3: a tab that holds no copy's board (it loaded none, or its restore adoption was refused) takes a stored copy of its very board for its own, as before
  return { conflict: false, skip: unchanged && notOurs, writeId: unchanged ? storedToken! : nextWriteId(), boardJson };
}
/** [B24-D2 review, 2026-10-09] The stored copy becomes the one this tab holds: the editor's checkpoint-restore adoption calls it, as
 *  page.tsx persists the restored board (with no write token) before handing it over, so the tab's next edit - even one made before
 *  the restored board's first autosave - is never refused as another tab's. */
export function rememberStoredWorkingCopy(projectId: string, restoredBoard: PcbBoard): void {
  const stored = storedWorkingCopy(projectId), restored = stored && JSON.stringify(stored.board) === JSON.stringify(restoredBoard) ? stored : null; // [B24-D4, 2026-10-10] D24-30: a copy another tab wrote since (the load effect's pending restore adopts after a board load) is never this tab's own; [B24-D4 review, 2026-10-10] security-2, correctness-2: told by its board, not by its token - the copy is this tab's when it holds the very board restored (page.tsx's copy, or another tab's unchanged rewrite of it), never another board (another tab's edit or its own restore)
  rememberWorkingCopy(projectId, restored, restored ? JSON.stringify(restored.board) : null);
}
function nextWriteId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}
