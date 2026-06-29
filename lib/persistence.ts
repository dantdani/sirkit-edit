import type { SchematicState } from "./schematic-types";
import { isPageSize, DEFAULT_PAGE_SIZE } from "./schematic-types";

export type SavedProject = {
  id: string;
  name: string;
  state: SchematicState;
  createdAt: number;
  updatedAt: number;
};

const STORAGE_PREFIX    = "sirkit:project:";
const STORAGE_INDEX_KEY = "sirkit:projectIndex";

// ─── Index helpers ────────────────────────────────────────────────────────────

function getIndex(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function setIndex(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(ids));
  } catch {
    // quota exceeded or unavailable
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function listProjects(): SavedProject[] {
  const ids = getIndex();
  const projects: SavedProject[] = [];
  for (const id of ids) {
    const p = loadProject(id);
    if (p) projects.push(p);
  }
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadProject(id: string): SavedProject | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw) as SavedProject;
  } catch {
    return null;
  }
}

export function saveProject(project: SavedProject): SavedProject {
  const updated: SavedProject = { ...project, updatedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_PREFIX + updated.id, JSON.stringify(updated));
    const index = getIndex();
    if (!index.includes(updated.id)) {
      setIndex([...index, updated.id]);
    }
  } catch {
    // quota exceeded or unavailable
  }
  return updated;
}

export function createProject(name: string, state: SchematicState): SavedProject {
  const now = Date.now();
  return saveProject({
    id: crypto.randomUUID(),
    name,
    state,
    createdAt: now,
    updatedAt: now,
  });
}

export function duplicateProject(id: string, newName: string): SavedProject | null {
  const original = loadProject(id);
  if (!original) return null;
  return createProject(newName, original.state);
}

export function renameProject(id: string, newName: string): SavedProject | null {
  const project = loadProject(id);
  if (!project) return null;
  return saveProject({ ...project, name: newName });
}

export function deleteProject(id: string): boolean {
  try {
    const index = getIndex();
    if (!index.includes(id)) return false;
    localStorage.removeItem(STORAGE_PREFIX + id);
    setIndex(index.filter((i) => i !== id));
    return true;
  } catch {
    return false;
  }
}

export function clearAllProjects(): void {
  const ids = getIndex();
  for (const id of ids) {
    try { localStorage.removeItem(STORAGE_PREFIX + id); } catch { /* ignore */ }
  }
  setIndex([]);
}

export function exportProjectJSON(project: SavedProject): string {
  return JSON.stringify(project, null, 2);
}

// ─── Import / validation ──────────────────────────────────────────────────────

function isPoint(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p["x"] === "number" && typeof p["y"] === "number";
}

function isComponent(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c["id"] === "string" &&
    typeof c["type"] === "string" &&
    typeof c["x"] === "number" &&
    typeof c["y"] === "number" &&
    (c["rotation"] === 0 || c["rotation"] === 90 || c["rotation"] === 180 || c["rotation"] === 270) &&
    typeof c["value"] === "string"
  );
}

function isWire(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const w = v as Record<string, unknown>;
  return (
    typeof w["id"] === "string" &&
    Array.isArray(w["vertices"]) &&
    (w["vertices"] as unknown[]).every(isPoint)
  );
}

function isNetLabel(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  return (
    typeof l["id"] === "string" &&
    isPoint(l["position"]) &&
    typeof l["name"] === "string" &&
    (l["kind"] === "label" || l["kind"] === "power" || l["kind"] === "ground") &&
    (l["orientation"] === 0 || l["orientation"] === 90 || l["orientation"] === 180 || l["orientation"] === 270)
  );
}

function isKicadInstance(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const k = v as Record<string, unknown>;
  return (
    typeof k["id"] === "string" &&
    typeof k["partId"] === "string" &&
    typeof k["x"] === "number" &&
    typeof k["y"] === "number" &&
    (k["rotation"] === 0 || k["rotation"] === 90 || k["rotation"] === 180 || k["rotation"] === 270) &&
    typeof k["refDes"] === "string" &&
    typeof k["value"] === "string"
  );
}

export function importProjectJSON(json: string): SavedProject | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { error: "Invalid JSON" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { error: "Invalid project format" };
  }
  const p = parsed as Record<string, unknown>;

  if (typeof p["name"] !== "string") return { error: "Missing or invalid name" };
  if (typeof p["state"] !== "object" || p["state"] === null) return { error: "Missing state" };

  const state = p["state"] as Record<string, unknown>;
  if (!Array.isArray(state["components"])) return { error: "Missing components array" };
  if (!Array.isArray(state["wires"]))      return { error: "Missing wires array" };
  if (!(state["components"] as unknown[]).every(isComponent)) {
    return { error: "Invalid component in components array" };
  }
  if (!(state["wires"] as unknown[]).every(isWire)) {
    return { error: "Invalid wire in wires array" };
  }
  // kicadComponents is optional; migrate older saves to [] and validate when present.
  const kicad = state["kicadComponents"];
  if (kicad !== undefined && (!Array.isArray(kicad) || !kicad.every(isKicadInstance))) {
    return { error: "Invalid kicadComponents array" };
  }
  state["kicadComponents"] = Array.isArray(kicad) ? kicad : [];

  // netLabels is optional; migrate older saves to [] and validate when present.
  const labels = state["netLabels"];
  if (labels !== undefined && (!Array.isArray(labels) || !labels.every(isNetLabel))) {
    return { error: "Invalid netLabels array" };
  }
  state["netLabels"] = Array.isArray(labels) ? labels : [];

  // pageSize is optional; reject a present-but-invalid value, migrate older
  // saves that lack it to the default.
  const ps = state["pageSize"];
  if (ps !== undefined && !isPageSize(ps)) {
    return { error: "Invalid pageSize" };
  }
  state["pageSize"] = isPageSize(ps) ? ps : DEFAULT_PAGE_SIZE;

  const now = Date.now();
  return saveProject({
    id: crypto.randomUUID(),
    name: p["name"] as string,
    state: state as unknown as SchematicState,
    createdAt: typeof p["createdAt"] === "number" ? p["createdAt"] : now,
    updatedAt: now,
  });
}
