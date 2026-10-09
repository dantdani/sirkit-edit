"use client";

import { assertProjectShape, loadAiAuditLog } from "./project"; // [B24-C2] D24-25: the audit log's redaction, caps and bound, applied again on load
import type { RunRecord, SimulationProject } from "./types";

const PROJECT_KEY = "sirkit:spice-studio:project:v1";
const RUNS_KEY = "sirkit:spice-studio:runs:v1";
const LAYOUT_KEY = "sirkit:spice-studio:layout:v1";

export interface StudioLayout {
  activeWorkspace: "setup" | "runs" | "results" | "models" | "reports";
  leftWidth: number;
  rightWidth: number;
  consoleHeight: number;
  theme: "dark" | "light";
}

export const DEFAULT_STUDIO_LAYOUT: StudioLayout = {
  activeWorkspace: "setup",
  leftWidth: 268,
  rightWidth: 320,
  consoleHeight: 180,
  theme: "dark",
};

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadStudioProject(): SimulationProject | null {
  const raw = storage()?.getItem(PROJECT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    assertProjectShape(parsed);
    parsed.aiAuditLog = loadAiAuditLog(parsed.aiAuditLog); // [B24-C2] D24-25: a stored log is redacted, capped and bounded on load, as on every write (a pre-redaction entry included)
    return parsed;
  } catch (error) {
    console.warn("[spice-studio] Ignoring invalid saved project", error);
    return null;
  }
}

export function saveStudioProject(project: SimulationProject): void {
  storage()?.setItem(PROJECT_KEY, JSON.stringify(project));
}

export function loadStudioRuns(): RunRecord[] {
  const raw = storage()?.getItem(RUNS_KEY);
  if (!raw) return [];
  try {
    const runs = JSON.parse(raw) as RunRecord[];
    return Array.isArray(runs) ? runs.slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function saveStudioRuns(runs: RunRecord[]): void {
  // Raw waveforms can exceed localStorage quickly. Retain complete recent runs
  // while bounding the cache; exported run bundles remain the durable format.
  const bounded = runs.slice(0, 12).map((run, index) => index < 3 ? run : { ...run, waveforms: run.waveforms.map((waveform) => ({ ...waveform, x: waveform.x.slice(0, 2000), y: waveform.y.slice(0, 2000) })) });
  try {
    storage()?.setItem(RUNS_KEY, JSON.stringify(bounded));
  } catch {
    const metadataOnly = bounded.map((run) => ({ ...run, waveforms: [] }));
    storage()?.setItem(RUNS_KEY, JSON.stringify(metadataOnly));
  }
}

export function loadStudioLayout(): StudioLayout {
  const raw = storage()?.getItem(LAYOUT_KEY);
  if (!raw) return DEFAULT_STUDIO_LAYOUT;
  try {
    return { ...DEFAULT_STUDIO_LAYOUT, ...(JSON.parse(raw) as Partial<StudioLayout>) };
  } catch {
    return DEFAULT_STUDIO_LAYOUT;
  }
}

export function saveStudioLayout(layout: StudioLayout): void {
  storage()?.setItem(LAYOUT_KEY, JSON.stringify(layout));
}

export function exportSimulationProject(project: SimulationProject): string {
  return JSON.stringify(project, null, 2);
}

export function importSimulationProject(raw: string): SimulationProject {
  const parsed = JSON.parse(raw) as unknown;
  assertProjectShape(parsed);
  return parsed;
}
