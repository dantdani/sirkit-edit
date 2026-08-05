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
}

const EMPTY_STATE: SchematicState = { components: [], wires: [], kicadComponents: [], netLabels: [] };

export function currentProjectId(): string | null {
  try { return localStorage.getItem(CURRENT_PROJECT_KEY); } catch { return null; }
}

export function setCurrentProjectId(id: string): boolean {
  try { localStorage.setItem(CURRENT_PROJECT_KEY, id); return true; } catch { return false; }
}

/** Load the current project, salvaging if needed; create one only when none exists. */
export function bootstrapCurrentProject(): ProjectBootstrap {
  const id = currentProjectId();
  if (id) {
    const salvaged = loadProjectSalvaged(id);
    if (salvaged) return { project: salvaged.project, created: false, dropped: salvaged.dropped };
    // Pointer is dangling (record gone). Fall back to the most recent project
    // before creating anything — never silently abandon existing work.
    const existing = listProjects();
    if (existing.length) {
      setCurrentProjectId(existing[0]!.id);
      return { project: existing[0]!, created: false, dropped: [] };
    }
  } else {
    const existing = listProjects();
    if (existing.length) {
      setCurrentProjectId(existing[0]!.id);
      return { project: existing[0]!, created: false, dropped: [] };
    }
  }
  const project = createProject("Untitled project", structuredClone(EMPTY_STATE));
  setCurrentProjectId(project.id);
  return { project, created: true, dropped: [] };
}

/** Switch the workspace to another existing project. */
export function openProject(id: string): ProjectBootstrap | null {
  const salvaged = loadProjectSalvaged(id);
  if (!salvaged) return null;
  setCurrentProjectId(id);
  return { project: salvaged.project, created: false, dropped: salvaged.dropped };
}

/** Create a fresh empty project and make it current. */
export function startNewProject(name = "Untitled project"): SavedProject {
  const project = createProject(name, structuredClone(EMPTY_STATE));
  setCurrentProjectId(project.id);
  return project;
}
