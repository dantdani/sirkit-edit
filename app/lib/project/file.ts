"use client";

/**
 * Sirkit local project file (R06-STATE01 Section 6).
 *
 * Extension: `.sirkit.json` — explicitly a Sirkit project, never confusable
 * with Gerbers or KiCad libraries. Envelope:
 *
 *   {
 *     "format": "sirkit-project",
 *     "formatVersion": 1,
 *     "exportedAt": "<ISO>",
 *     "integrity": "sha256:<hex over canonical payload JSON>",
 *     "payload": { "project": <SavedProject subset>, "checkpoints": [...] }
 *   }
 *
 * Determinism: the payload is serialized with sorted keys (canonicalJson),
 * so identical state exports byte-identical payloads (exportedAt differs).
 * Secrets never enter the file: SavedProject holds no keys by construction,
 * and the exporter allowlists fields rather than spreading unknown ones.
 *
 * Import identity rules ("never overwrite another project"):
 *  - file's project id unused locally → import under the SAME id (a true
 *    continuation with stable identity);
 *  - id exists locally → import as a CONFLICT COPY under a fresh id with a
 *    "(imported copy)" name suffix; the existing project is untouched.
 *
 * Missing-authority truthfulness: instance authority ids (atomic revision,
 * symbol/footprint versions) are carried verbatim; the importer verifies the
 * referenced catalog parts still resolve and reports the ones that don't —
 * it never fabricates authority.
 */

import {
  PROJECT_SCHEMA_VERSION,
  isComponent,
  isKicadInstance,
  isNetLabel,
  isPcbBoardLike,
  isStoredChatMessage,
  isWire,
  loadProject,
  loadProjectSalvaged,
  saveProject,
  type PcbStageEvidence,
  type PcbWorkingCopy,
  type SavedProject,
  type StoredChatMessage,
} from "@/lib/persistence";
import { isPageSize, DEFAULT_PAGE_SIZE, type SchematicState } from "@/lib/schematic-types";
import { canonicalJson } from "@/app/lib/pcb/revision";
import { checkpointStore, isCheckpointLike, type ProjectCheckpoint } from "./checkpoints";

export const PROJECT_FILE_FORMAT = "sirkit-project";
export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXTENSION = ".sirkit.json";

export interface ProjectFilePayload {
  project: SavedProject;
  checkpoints: ProjectCheckpoint[];
}

export interface ProjectFileEnvelope {
  format: typeof PROJECT_FILE_FORMAT;
  formatVersion: number;
  exportedAt: string;
  integrity: string;
  payload: ProjectFilePayload;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Allowlisted projection — unknown fields never leak into the file. */
function exportableProject(project: SavedProject): SavedProject {
  return {
    id: project.id,
    name: project.name,
    state: project.state,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    ...(project.chat ? { chat: project.chat } : {}),
    ...(project.designPrompt ? { designPrompt: project.designPrompt } : {}),
    ...(project.workflowView ? { workflowView: project.workflowView } : {}),
    ...(project.pcb ? { pcb: project.pcb } : {}),
    ...(project.pcbWorking ? { pcbWorking: project.pcbWorking } : {}),
    ...(project.pcbStages ? { pcbStages: project.pcbStages } : {}),
    ...(project.pcbReleases ? { pcbReleases: project.pcbReleases } : {}),
    ...(project.componentSelections ? { componentSelections: project.componentSelections } : {}),
    ...(project.ai ? { ai: { brain: project.ai.brain, embeddings: project.ai.embeddings, providerHistory: project.ai.providerHistory } } : {}),
  };
}

export async function exportProjectFile(projectId: string): Promise<{ ok: true; fileName: string; content: string } | { ok: false; reason: string }> {
  const salvaged = loadProjectSalvaged(projectId);
  if (!salvaged) return { ok: false, reason: "Project not found in local storage." };
  const checkpoints = await checkpointStore().list(projectId).catch(() => [] as ProjectCheckpoint[]);
  const payload: ProjectFilePayload = { project: exportableProject(salvaged.project), checkpoints };
  const canonical = canonicalJson(payload);
  const envelope: ProjectFileEnvelope = {
    format: PROJECT_FILE_FORMAT,
    formatVersion: PROJECT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    integrity: `sha256:${await sha256Hex(canonical)}`,
    payload: JSON.parse(canonical) as ProjectFilePayload,
  };
  const safeName = salvaged.project.name.replace(/[^A-Za-z0-9._ -]+/g, "_").trim() || "project";
  return { ok: true, fileName: `${safeName}${PROJECT_FILE_EXTENSION}`, content: JSON.stringify(envelope, null, 2) };
}

export interface ProjectImportResult {
  ok: true;
  project: SavedProject;
  /** True when the file's id already existed locally and a copy was created. */
  importedAsCopy: boolean;
  checkpointsImported: number;
  /** Part ids referenced by instances that no longer resolve in the catalog. */
  missingParts: string[];
  warnings: string[];
}

function validateSchematicState(value: unknown): { ok: true; state: SchematicState } | { ok: false; reason: string } {
  if (typeof value !== "object" || value === null) return { ok: false, reason: "Missing schematic state" };
  const state = value as Record<string, unknown>;
  if (!Array.isArray(state["components"]) || !(state["components"] as unknown[]).every(isComponent)) return { ok: false, reason: "Invalid components array" };
  if (!Array.isArray(state["wires"]) || !(state["wires"] as unknown[]).every(isWire)) return { ok: false, reason: "Invalid wires array" };
  const kicad = state["kicadComponents"];
  if (kicad !== undefined && (!Array.isArray(kicad) || !kicad.every(isKicadInstance))) return { ok: false, reason: "Invalid kicadComponents array" };
  const labels = state["netLabels"];
  if (labels !== undefined && (!Array.isArray(labels) || !labels.every(isNetLabel))) return { ok: false, reason: "Invalid netLabels array" };
  const pageSize = state["pageSize"];
  if (pageSize !== undefined && !isPageSize(pageSize)) return { ok: false, reason: "Invalid pageSize" };
  return {
    ok: true,
    state: {
      components: state["components"],
      wires: state["wires"],
      kicadComponents: Array.isArray(kicad) ? kicad : [],
      netLabels: Array.isArray(labels) ? labels : [],
      pageSize: isPageSize(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    } as SchematicState,
  };
}

function validateWorkingCopy(value: unknown): PcbWorkingCopy | { error: string } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) return { error: "Invalid pcbWorking" };
  const copy = value as Record<string, unknown>;
  if (!isPcbBoardLike(copy["board"])) return { error: "Invalid pcbWorking.board" };
  if (copy["baseRevision"] !== null && typeof copy["baseRevision"] !== "string") return { error: "Invalid pcbWorking.baseRevision" };
  if (copy["baseDigest"] !== null && typeof copy["baseDigest"] !== "string") return { error: "Invalid pcbWorking.baseDigest" };
  if (typeof copy["updatedAt"] !== "number") return { error: "Invalid pcbWorking.updatedAt" };
  return copy as unknown as PcbWorkingCopy;
}

/** Check that instance part references still resolve in the live catalog. */
async function findMissingParts(state: SchematicState): Promise<string[]> {
  const partIds = [...new Set((state.kicadComponents ?? []).map((instance) => instance.partId))];
  const missing: string[] = [];
  for (const partId of partIds) {
    try {
      const res = await fetch(`/api/parts/${encodeURIComponent(partId)}`);
      if (!res.ok) missing.push(partId);
    } catch {
      missing.push(partId);
    }
  }
  return missing;
}

export async function importProjectFile(content: string): Promise<ProjectImportResult | { ok: false; reason: string }> {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return { ok: false, reason: "The file is not valid JSON." }; }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, reason: "The file is not a Sirkit project." };
  const envelope = parsed as Record<string, unknown>;
  if (envelope["format"] !== PROJECT_FILE_FORMAT) return { ok: false, reason: "The file is not a Sirkit project (missing sirkit-project format marker)." };
  if (typeof envelope["formatVersion"] !== "number") return { ok: false, reason: "The file has no format version." };
  if (envelope["formatVersion"] > PROJECT_FILE_VERSION) return { ok: false, reason: `This file uses project-file version ${envelope["formatVersion"]}, newer than this app supports (${PROJECT_FILE_VERSION}). Update Sirkit to open it.` };
  const payload = envelope["payload"];
  if (typeof payload !== "object" || payload === null) return { ok: false, reason: "The file has no payload." };

  // Integrity: refuse silently corrupted files.
  if (typeof envelope["integrity"] === "string" && envelope["integrity"].startsWith("sha256:")) {
    const actual = `sha256:${await sha256Hex(canonicalJson(payload))}`;
    if (actual !== envelope["integrity"]) return { ok: false, reason: "Integrity check failed — the file is corrupted or was modified. Nothing was imported." };
  } else {
    return { ok: false, reason: "The file has no integrity digest. Nothing was imported." };
  }

  const record = (payload as Record<string, unknown>)["project"];
  if (typeof record !== "object" || record === null) return { ok: false, reason: "The file has no project record." };
  const project = record as Record<string, unknown>;
  if (typeof project["id"] !== "string" || typeof project["name"] !== "string") return { ok: false, reason: "The project record is missing id or name." };
  const stateResult = validateSchematicState(project["state"]);
  if (!stateResult.ok) return { ok: false, reason: stateResult.reason };
  if (project["pcb"] !== undefined && !isPcbBoardLike(project["pcb"])) return { ok: false, reason: "Invalid PCB board in file." };
  const working = validateWorkingCopy(project["pcbWorking"]);
  if (working && "error" in working) return { ok: false, reason: working.error };
  const chat = project["chat"];
  if (chat !== undefined && (!Array.isArray(chat) || !chat.every(isStoredChatMessage))) return { ok: false, reason: "Invalid chat history in file." };

  const rawCheckpoints = (payload as Record<string, unknown>)["checkpoints"];
  const checkpoints: ProjectCheckpoint[] = [];
  if (rawCheckpoints !== undefined) {
    if (!Array.isArray(rawCheckpoints)) return { ok: false, reason: "Invalid checkpoints in file." };
    for (const checkpoint of rawCheckpoints) {
      if (!isCheckpointLike(checkpoint)) return { ok: false, reason: "A checkpoint in the file is invalid. Nothing was imported." };
      checkpoints.push(checkpoint);
    }
  }

  const warnings: string[] = [];
  const missingParts = await findMissingParts(stateResult.state);
  if (missingParts.length) warnings.push(`${missingParts.length} referenced catalog part(s) no longer resolve: ${missingParts.join(", ")}. Their instances load, but synchronization will fail closed until the parts are restored.`);

  // Identity: never overwrite an existing project.
  const fileId = project["id"];
  const existing = loadProject(fileId) ?? loadProjectSalvaged(fileId)?.project;
  const importedAsCopy = Boolean(existing);
  const targetId = importedAsCopy ? crypto.randomUUID() : fileId;
  const targetName = importedAsCopy ? `${project["name"]} (imported copy)` : project["name"];
  if (importedAsCopy) warnings.push(`A project with this file's id already exists locally ("${existing!.name}"). The file was imported as a separate copy; the existing project is untouched.`);

  const now = Date.now();
  const imported: SavedProject = {
    id: targetId,
    name: targetName,
    state: stateResult.state,
    createdAt: typeof project["createdAt"] === "number" ? project["createdAt"] : now,
    updatedAt: now,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    ...(chat ? { chat: chat as StoredChatMessage[] } : {}),
    ...(typeof project["designPrompt"] === "string" ? { designPrompt: project["designPrompt"] } : {}),
    ...(typeof project["workflowView"] === "string" ? { workflowView: project["workflowView"] } : {}),
    ...(project["pcb"] !== undefined ? { pcb: project["pcb"] as SavedProject["pcb"] } : {}),
    ...(working ? { pcbWorking: working } : {}),
    ...(project["pcbStages"] && typeof project["pcbStages"] === "object" ? { pcbStages: project["pcbStages"] as PcbStageEvidence } : {}),
    ...(Array.isArray(project["pcbReleases"]) ? { pcbReleases: project["pcbReleases"] as SavedProject["pcbReleases"] } : {}),
    ...(project["componentSelections"] && typeof project["componentSelections"] === "object" ? { componentSelections: project["componentSelections"] as SavedProject["componentSelections"] } : {}),
    ...(project["ai"] && typeof project["ai"] === "object" ? { ai: project["ai"] as SavedProject["ai"] } : {}),
  };
  const saved = saveProject(imported);

  // Checkpoints follow the target identity (re-keyed on conflict copies).
  const rekeyed = checkpoints.map((checkpoint) => ({ ...checkpoint, projectId: targetId, id: `${targetId}:${checkpoint.seq}` }));
  let checkpointsImported = 0;
  try {
    await checkpointStore().importAll(rekeyed);
    checkpointsImported = rekeyed.length;
  } catch (error) {
    warnings.push(`Checkpoint history could not be written to browser storage (${error instanceof Error ? error.message : String(error)}). The project itself imported fully.`);
  }

  return { ok: true, project: saved, importedAsCopy, checkpointsImported, missingParts, warnings };
}
