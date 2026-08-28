"use client";

/**
 * Current-project lifecycle (R06-STATE01 Section 4).
 *
 * One stable project identity per browser workspace, kept under the same
 * `sirkit:currentProjectId` pointer that the PCB stack already uses — the
 * schematic editor, chat, and PCB now agree on ONE project record.
 *
 * Identity is deliberately sticky: a record that exists but fails strict
 * validation is salvaged (core design fields kept, corrupt optional stages
 * dropped AND REPORTED) instead of being abandoned for a fresh id — the
 * pre-R06 behavior that silently minted new projects and orphaned durable
 * server boards.
 */

import {
  createProject,
  listProjects,
  loadProjectSalvaged,
  type SavedProject,
} from "@/lib/persistence";
import type { SchematicState } from "@/lib/schematic-types";

const CURRENT_PROJECT_KEY = "sirkit:currentProjectId";

export interface ProjectBootstrap {
  project: SavedProject;
  /** True when no usable project existed and a fresh one was created. */
  created: boolean;
  /** Names of corrupt optional sub-states dropped by the salvage loader. */
  dropped: string[];
  /** [B12.5 §C] True when the persisted current-project pointer agrees
   *  with `project` (already did, or the write succeeded). False means
   *  current-project storage refused the write — the caller must surface
   *  it truthfully (a reload may resolve a different project). */
  pointerPersisted: boolean;
}

const EMPTY_STATE: SchematicState = { components: [], wires: [], kicadComponents: [], netLabels: [] };

export function currentProjectId(): string | null {
  try { return localStorage.getItem(CURRENT_PROJECT_KEY); } catch { return null; }
}

export function setCurrentProjectId(id: string): boolean {
  try { localStorage.setItem(CURRENT_PROJECT_KEY, id); return true; } catch { return false; }
}

/** Load the current project, salvaging if needed; create one only when none
 *  exists. [B12.5 §C] Pointer-write failures are REPORTED, never ignored:
 *  `pointerPersisted: false` tells the page the persisted pointer does not
 *  agree with the resolved project (unavailable current-project storage).
 *  Note the fallback/create paths re-resolve DETERMINISTICALLY on reload
 *  (dangling pointers fall back to the most recent project), so an
 *  unpersisted pointer here is surfaced truthfully rather than fatal. */
export function bootstrapCurrentProject(): ProjectBootstrap {
  const id = currentProjectId();
  if (id) {
    const salvaged = loadProjectSalvaged(id);
    // The persisted pointer already names this project — nothing to write.
    if (salvaged) return { project: salvaged.project, created: false, dropped: salvaged.dropped, pointerPersisted: true };
    // Pointer is dangling (record gone). Fall back to the most recent project
    // before creating anything — never silently abandon existing work.
    const existing = listProjects();
    if (existing.length) {
      const pointerPersisted = setCurrentProjectId(existing[0]!.id);
      return { project: existing[0]!, created: false, dropped: [], pointerPersisted };
    }
  } else {
    const existing = listProjects();
    if (existing.length) {
      const pointerPersisted = setCurrentProjectId(existing[0]!.id);
      return { project: existing[0]!, created: false, dropped: [], pointerPersisted };
    }
  }
  const project = createProject("Untitled project", structuredClone(EMPTY_STATE));
  const pointerPersisted = setCurrentProjectId(project.id);
  return { project, created: true, dropped: [], pointerPersisted };
}

/** [B12.4 §E] Load a switch target WITHOUT activating it. The persisted
 *  current-project pointer moves only when the winning transition installs
 *  (`markProjectCurrent`, from the install body's pointer-commit phase).
 *  `pointerPersisted` is vacuously true: loading writes nothing. */
export function loadProjectRecord(id: string): ProjectBootstrap | null {
  const salvaged = loadProjectSalvaged(id);
  if (!salvaged) return null;
  return { project: salvaged.project, created: false, dropped: salvaged.dropped, pointerPersisted: true };
}

/** [B12.4 §E] Create and persist a fresh project RECORD without making it
 *  current — activation belongs to the winning install. */
export function createProjectRecord(name = "Untitled project"): SavedProject {
  return createProject(name, structuredClone(EMPTY_STATE));
}

/** [B12.5 §C] The typed persistent pointer commit. */
export type MarkProjectCurrentResult =
  | { ok: true; /** False when the pointer already named `id` (no write). */ wrote: boolean }
  | { ok: false; detail: string };

/** [B12.4 §E / B12.5 §C] Commit the persisted current-project pointer —
 *  called exactly once per successful activation, by the winning install
 *  body's POINTER-COMMIT phase (before any visible editor change). A
 *  failed or superseded transition never reaches this. Failure is a
 *  MANDATORY typed result: callers must treat `{ ok: false }` as a
 *  pre-commit activation failure — never report the target installed. */
export function markProjectCurrent(id: string): MarkProjectCurrentResult {
  try {
    if (localStorage.getItem(CURRENT_PROJECT_KEY) === id) return { ok: true, wrote: false };
    localStorage.setItem(CURRENT_PROJECT_KEY, id);
    // Read-back verification: a storage layer that ACCEPTS the write but
    // drops it (quota edge, private-mode shims) must surface as a typed
    // failure, not as a silent split-brain discovered on the next reload.
    if (localStorage.getItem(CURRENT_PROJECT_KEY) !== id) {
      return { ok: false, detail: "current-project pointer write was not persisted (read-back mismatch)" };
    }
    return { ok: true, wrote: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/** Switch the workspace to another existing project.
 *  [B12.4 §E] DEPRECATED for transition flows: sets the pointer at LOAD
 *  time, which desynchronizes it from the installed project when the
 *  transition fails or is superseded. Retained only for the bootstrap
 *  dangling-pointer fallback semantics above; page transitions use
 *  `loadProjectRecord` + `markProjectCurrent`. */
export function openProject(id: string): ProjectBootstrap | null {
  const salvaged = loadProjectSalvaged(id);
  if (!salvaged) return null;
  const pointerPersisted = setCurrentProjectId(id);
  return { project: salvaged.project, created: false, dropped: salvaged.dropped, pointerPersisted };
}

/** Create a fresh empty project and make it current.
 *  [B12.4 §E] DEPRECATED for transition flows — see `openProject`. */
export function startNewProject(name = "Untitled project"): SavedProject {
  const project = createProject(name, structuredClone(EMPTY_STATE));
  setCurrentProjectId(project.id);
  return project;
}
