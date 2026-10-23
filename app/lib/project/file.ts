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
  trySaveProject,
  type PcbStageEvidence,
  type PcbWorkingCopy,
  type SavedProject,
  type StoredChatMessage,
} from "@/lib/persistence";
import { isPageSize, DEFAULT_PAGE_SIZE, type SchematicState } from "@/lib/schematic-types";
import { canonicalJson } from "@/app/lib/pcb/revision";
import { sheetErrors, validateSheetHierarchy } from "@/app/lib/schematic/sheets";
import { checkpointStore, isCheckpointLike, type ProjectCheckpoint } from "./checkpoints";

export const PROJECT_FILE_FORMAT = "sirkit-project";
export const PROJECT_FILE_VERSION = 1;
/** [PR-J, 2026-10-22] OD-255 item 1 (forward-only): a project whose schematic (or any checkpoint's) has sheets is written as file
 *  version 2, so a Sirkit without sheet support refuses it ("newer than this app supports") instead of opening it flat; every other
 *  project is still written as version 1, byte-identical to before. */
export const PROJECT_FILE_VERSION_SHEETS = 2;
/** The newest project-file version this build reads. */
export const PROJECT_FILE_MAX_VERSION = PROJECT_FILE_VERSION_SHEETS;
/** [PR-J, 2026-10-22] The editor cannot open a multi-sheet project until the Sheets navigator lands (section J increment 3): until
 *  then a multi-sheet file is validated completely and then refused recoverably, never loaded into the single-sheet editor.
 *  [PR-J3, 2026-10-22] That increment landed (OD-257 item 8): the page carries the tree through hydration, history, autosave and
 *  checkpoints and the Sheets navigator opens it, so a valid multi-sheet file now imports; the refusal below stays as the record of
 *  the recoverable path (unreachable while this is true). */
export const MULTI_SHEET_EDITOR_AVAILABLE = true;
export const SHEETS_EDITOR_PENDING = "SHEETS_EDITOR_PENDING";
export const PROJECT_FILE_EXTENSION = ".sirkit.json";

/**
 * [B19-D I5e rows 12, 13] What a project file may be. A file is refused before it is read when it is larger than
 * `MAX_PROJECT_FILE_BYTES`; its JSON nesting is bounded before any recursive walk (the canonical hash recursed, and 10 000
 * levels threw a RangeError); and every table has a count bound far above a real project (a routed 200-part board with a
 * long history is a few thousand rows). Catalog parts are looked up a few at a time, each distinct part once.
 */
export const MAX_PROJECT_FILE_BYTES = 50 * 1024 * 1024;
export const PROJECT_IMPORT_LIMITS = Object.freeze({
  jsonDepth: 128,
  components: 20_000,
  kicadComponents: 20_000,
  wires: 50_000,
  netLabels: 20_000,
  chatMessages: 10_000,
  checkpoints: 1_000,
  distinctParts: 1_000,
  partLookupConcurrency: 8,
});

/** [B19-D I5e row 12] Read a picked file only when it is within the size bound. */
export async function readProjectFile(file: Blob): Promise<{ ok: true; content: string } | { ok: false; reason: string }> {
  if (file.size > MAX_PROJECT_FILE_BYTES) {
    return { ok: false, reason: `The file is too large to open (${Math.ceil(file.size / (1024 * 1024))} MB; the limit is ${MAX_PROJECT_FILE_BYTES / (1024 * 1024)} MB). Nothing was imported.` };
  }
  try {
    return { ok: true, content: await file.text() };
  } catch {
    return { ok: false, reason: "The file could not be read. Nothing was imported." };
  }
}

/** True when the JSON text never nests arrays/objects deeper than `limit` (a linear scan; strings are skipped). */
function jsonNestingWithin(text: string, limit: number): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "[" || char === "{") {
      depth++;
      if (depth > limit) return false;
    } else if (char === "]" || char === "}") depth--;
  }
  return true;
}

type SchematicCounts = Pick<SchematicState, "components" | "wires" | "kicadComponents" | "netLabels">;

function tableOverLimit(state: SchematicCounts): string | null {
  const limits = PROJECT_IMPORT_LIMITS;
  if (state.components.length > limits.components) return `too many schematic components (${state.components.length}; the limit is ${limits.components})`;
  if ((state.kicadComponents ?? []).length > limits.kicadComponents) return `too many placed parts (${(state.kicadComponents ?? []).length}; the limit is ${limits.kicadComponents})`;
  if (state.wires.length > limits.wires) return `too many wires (${state.wires.length}; the limit is ${limits.wires})`;
  if ((state.netLabels ?? []).length > limits.netLabels) return `too many net labels (${(state.netLabels ?? []).length}; the limit is ${limits.netLabels})`;
  return null;
}

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

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/**
 * [B19-D I5e review] A project file is written so the importer can open it again. The envelope is pretty-printed when that fits
 * the import bound and compact otherwise; when even the compact file is over the bound, the oldest checkpoints are left out (the
 * newest are kept) and the result says how many. A project too large without any checkpoint is refused, not written.
 */
export async function exportProjectFile(projectId: string): Promise<{ ok: true; fileName: string; content: string; omittedCheckpoints: number } | { ok: false; reason: string }> {
  const salvaged = loadProjectSalvaged(projectId);
  if (!salvaged) return { ok: false, reason: "Project not found in local storage." };
  const checkpoints = [...await checkpointStore().list(projectId).catch(() => [] as ProjectCheckpoint[])].sort((a, b) => a.seq - b.seq);
  const project = exportableProject(salvaged.project);
  const fileName = `${salvaged.project.name.replace(/[^A-Za-z0-9._ -]+/g, "_").trim() || "project"}${PROJECT_FILE_EXTENSION}`;
  let omitted = 0;
  for (;;) {
    const payload: ProjectFilePayload = { project, checkpoints: checkpoints.slice(omitted) };
    const canonical = canonicalJson(payload);
    const envelope: ProjectFileEnvelope = {
      format: PROJECT_FILE_FORMAT,
      formatVersion: project.state.sheets !== undefined || payload.checkpoints.some((checkpoint) => (checkpoint.schematic as SchematicState | undefined)?.sheets !== undefined) ? PROJECT_FILE_VERSION_SHEETS : PROJECT_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      integrity: `sha256:${await sha256Hex(canonical)}`,
      payload: JSON.parse(canonical) as ProjectFilePayload,
    };
    const pretty = JSON.stringify(envelope, null, 2);
    if (utf8Bytes(pretty) <= MAX_PROJECT_FILE_BYTES) return { ok: true, fileName, content: pretty, omittedCheckpoints: omitted };
    const compact = JSON.stringify(envelope);
    const compactBytes = utf8Bytes(compact);
    if (compactBytes <= MAX_PROJECT_FILE_BYTES) return { ok: true, fileName, content: compact, omittedCheckpoints: omitted };
    if (omitted >= checkpoints.length) {
      return { ok: false, reason: `The project is too large to save as a file Sirkit can open again (${Math.ceil(compactBytes / (1024 * 1024))} MB without checkpoints; the limit is ${MAX_PROJECT_FILE_BYTES / (1024 * 1024)} MB).` };
    }
    // leave out the oldest checkpoints whose size covers the excess (at least one), then measure again
    let excess = compactBytes - MAX_PROJECT_FILE_BYTES;
    do {
      excess -= utf8Bytes(JSON.stringify(checkpoints[omitted]));
      omitted++;
    } while (excess > 0 && omitted < checkpoints.length);
  }
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

/** `sheetContract`: the state is well-formed but fails the sheet contract (sheets.ts) - the one failure a checkpoint may be left out for. */
function validateSchematicState(value: unknown): { ok: true; state: SchematicState } | { ok: false; reason: string; sheetContract?: true } {
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
  const rebuilt = {
    components: state["components"],
    wires: state["wires"],
    kicadComponents: Array.isArray(kicad) ? kicad : [],
    netLabels: Array.isArray(labels) ? labels : [],
    pageSize: isPageSize(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    // [PR-J, 2026-10-22] the sheet tree travels with the state (never dropped, which would leave dangling sheet references) and is
    // validated against the sheet contract (sheets.ts); a single-sheet state keeps exactly its five fields.
    ...(state["sheets"] !== undefined ? { sheets: state["sheets"] } : {}),
  } as SchematicState;
  const sheetProblems = sheetErrors(validateSheetHierarchy(rebuilt));
  if (sheetProblems.length > 0) return { ok: false, reason: `Invalid schematic sheets (${sheetProblems[0]!.code}): ${sheetProblems[0]!.message}`, sheetContract: true };
  return { ok: true, state: rebuilt };
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

/**
 * Check that instance part references still resolve in the live catalog.
 *
 * [B19-D I5e rows 13, 14] Distinct parts only, a few lookups at a time. The route answers a part it does not have with
 * `200 { ok: true, part: null }`, so a part is resolved only when the answer carries the part — a 200 alone is not.
 */
async function findMissingParts(partIds: readonly string[]): Promise<string[]> {
  const missing = new Set<string>();
  for (let index = 0; index < partIds.length; index += PROJECT_IMPORT_LIMITS.partLookupConcurrency) {
    const batch = partIds.slice(index, index + PROJECT_IMPORT_LIMITS.partLookupConcurrency);
    await Promise.all(batch.map(async (partId) => {
      try {
        const res = await fetch(`/api/parts/${encodeURIComponent(partId)}`);
        const body = (await res.json().catch(() => null)) as { ok?: unknown; part?: unknown } | null;
        if (!res.ok || !body || body.ok !== true || !body.part || typeof body.part !== "object") missing.add(partId);
      } catch {
        missing.add(partId);
      }
    }));
  }
  return partIds.filter((partId) => missing.has(partId));
}

/**
 * [B19-D I5e review] Chat history that arrives in a file was written by whoever made the file. It is shown, and marked advisory
 * so it is never replayed to the chat model as the person's or the assistant's own earlier words.
 */
function advisoryChat(chat: readonly StoredChatMessage[]): StoredChatMessage[] {
  return chat.map((message) => (message.role === "user" || message.role === "assistant" ? { ...message, advisory: true } : message));
}

export async function importProjectFile(content: string): Promise<ProjectImportResult | { ok: false; reason: string }> {
  // [B19-D I5e row 12] never a rejected promise: every failure below is a refusal that imports nothing
  try {
    return await importProjectFileChecked(content);
  } catch {
    return { ok: false, reason: "The file could not be imported. Nothing was imported." };
  }
}

async function importProjectFileChecked(content: string): Promise<ProjectImportResult | { ok: false; reason: string }> {
  if (content.length > MAX_PROJECT_FILE_BYTES) return { ok: false, reason: `The file is too large to open (the limit is ${MAX_PROJECT_FILE_BYTES / (1024 * 1024)} MB). Nothing was imported.` };
  if (!jsonNestingWithin(content, PROJECT_IMPORT_LIMITS.jsonDepth)) return { ok: false, reason: `The file nests data more than ${PROJECT_IMPORT_LIMITS.jsonDepth} levels deep; it is not a Sirkit project. Nothing was imported.` };
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return { ok: false, reason: "The file is not valid JSON." }; }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, reason: "The file is not a Sirkit project." };
  const envelope = parsed as Record<string, unknown>;
  if (envelope["format"] !== PROJECT_FILE_FORMAT) return { ok: false, reason: "The file is not a Sirkit project (missing sirkit-project format marker)." };
  if (typeof envelope["formatVersion"] !== "number") return { ok: false, reason: "The file has no format version." };
  if (envelope["formatVersion"] > PROJECT_FILE_MAX_VERSION) return { ok: false, reason: `This file uses project-file version ${envelope["formatVersion"]}, newer than this app supports (${PROJECT_FILE_MAX_VERSION}). Update Sirkit to open it.` };
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
  const overLimit = tableOverLimit(stateResult.state);
  if (overLimit) return { ok: false, reason: `The project has ${overLimit}. Nothing was imported.` };
  if (project["pcb"] !== undefined && !isPcbBoardLike(project["pcb"])) return { ok: false, reason: "Invalid PCB board in file." };
  const working = validateWorkingCopy(project["pcbWorking"]);
  if (working && "error" in working) return { ok: false, reason: working.error };
  const chat = project["chat"];
  if (chat !== undefined && (!Array.isArray(chat) || !chat.every(isStoredChatMessage))) return { ok: false, reason: "Invalid chat history in file." };
  if (Array.isArray(chat) && chat.length > PROJECT_IMPORT_LIMITS.chatMessages) return { ok: false, reason: `The chat history has too many messages (the limit is ${PROJECT_IMPORT_LIMITS.chatMessages}). Nothing was imported.` };

  const rawCheckpoints = (payload as Record<string, unknown>)["checkpoints"];
  const checkpoints: ProjectCheckpoint[] = [];
  /** [PR-J3 integration, 2026-10-23] review J3-PAGE-1: checkpoints left out because their schematic fails the sheet contract (named in a warning). */
  const unrestorableCheckpoints: string[] = [];
  if (rawCheckpoints !== undefined) {
    if (!Array.isArray(rawCheckpoints)) return { ok: false, reason: "Invalid checkpoints in file." };
    if (rawCheckpoints.length > PROJECT_IMPORT_LIMITS.checkpoints) return { ok: false, reason: `The file has too many checkpoints (${rawCheckpoints.length}; the limit is ${PROJECT_IMPORT_LIMITS.checkpoints}). Nothing was imported.` };
    for (const checkpoint of rawCheckpoints) {
      if (!isCheckpointLike(checkpoint)) return { ok: false, reason: "A checkpoint in the file is invalid. Nothing was imported." };
      // [B19-D I5e row 11] a checkpoint is restored into the page like a project: its schematic, chat and board get the
      // same validation (the header check alone let a checkpoint crash the restore or carry any chat markup)
      const checkpointState = validateSchematicState(checkpoint.schematic);
      // [PR-J3 integration, 2026-10-23] review J3-PAGE-1: a checkpoint whose schematic is well-formed but fails the SHEET contract (the
      // previous build's board checkpoint stored an organised project's entities without their tree) can never be restored - the
      // session refuses it - but it is no reason to refuse the person's project: it is left out and named in a warning. Every other
      // checkpoint refusal (malformed tables, over the limits, chat, board) still refuses the whole file, as B19-D I5e decided.
      if (!checkpointState.ok && checkpointState.sheetContract) { unrestorableCheckpoints.push(`"${checkpoint.label}" (${checkpointState.reason})`); continue; }
      if (!checkpointState.ok || tableOverLimit(checkpointState.state)) return { ok: false, reason: "A checkpoint's schematic in the file is invalid. Nothing was imported." };
      const checkpointChat: unknown = checkpoint.chat;
      if (checkpointChat !== undefined && (!Array.isArray(checkpointChat) || checkpointChat.length > PROJECT_IMPORT_LIMITS.chatMessages || !checkpointChat.every(isStoredChatMessage))) {
        return { ok: false, reason: "A checkpoint's chat history in the file is invalid. Nothing was imported." };
      }
      if (checkpoint.board !== undefined && !isPcbBoardLike(checkpoint.board)) return { ok: false, reason: "A checkpoint's PCB board in the file is invalid. Nothing was imported." };
      // [B19-D I5e review] a checkpoint written without a page size keeps none (restoring it then keeps the live sheet), and its
      // chat is shown but never replayed to the chat model
      const { pageSize: _defaultedPageSize, ...withoutPageSize } = checkpointState.state;
      void _defaultedPageSize;
      const schematic = (checkpoint.schematic as { pageSize?: unknown }).pageSize === undefined ? (withoutPageSize as SchematicState) : checkpointState.state;
      checkpoints.push({ ...checkpoint, schematic, ...(Array.isArray(checkpointChat) ? { chat: advisoryChat(checkpointChat as StoredChatMessage[]) } : {}) });
    }
  }

  // [PR-J, 2026-10-22] OD-255 item 1: schematic sheets only in a version-2 file; a valid multi-sheet project is refused recoverably
  // (nothing imported, the file untouched) until the editor can open one (MULTI_SHEET_EDITOR_AVAILABLE).
  const sheetCounts = [stateResult.state, ...checkpoints.map((checkpoint) => checkpoint.schematic as SchematicState)].map((state) => state.sheets?.sheets.length ?? 0);
  if (sheetCounts.some((count) => count > 0) && (envelope["formatVersion"] as number) < PROJECT_FILE_VERSION_SHEETS) return { ok: false, reason: `A project-file version ${String(envelope["formatVersion"])} cannot carry schematic sheets; the file is inconsistent. Nothing was imported.` };
  if (sheetCounts.some((count) => count > 0) && !MULTI_SHEET_EDITOR_AVAILABLE) return { ok: false, reason: `${SHEETS_EDITOR_PENDING}: this project has ${Math.max(...sheetCounts)} schematic sheets, and this version of the editor cannot open a multi-sheet project yet. Nothing was imported; keep the file and open it again after the Sheets update.` };

  const warnings: string[] = [];
  if (unrestorableCheckpoints.length > 0) warnings.push(`${unrestorableCheckpoints.length} checkpoint(s) in the file were left out because their schematic fails the sheet contract and could not be restored: ${unrestorableCheckpoints.slice(0, 3).join("; ")}${unrestorableCheckpoints.length > 3 ? "; …" : ""}. The project and its other checkpoints imported.`); // [PR-J3 integration, 2026-10-23] review J3-PAGE-1
  const distinctParts = [...new Set((stateResult.state.kicadComponents ?? []).map((instance) => instance.partId))];
  if (distinctParts.length > PROJECT_IMPORT_LIMITS.distinctParts) {
    return { ok: false, reason: `The project references too many distinct catalog parts (${distinctParts.length}; the limit is ${PROJECT_IMPORT_LIMITS.distinctParts}). Nothing was imported.` };
  }
  const missingParts = await findMissingParts(distinctParts);
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
    ...(chat ? { chat: advisoryChat(chat as StoredChatMessage[]) } : {}),
    ...(typeof project["designPrompt"] === "string" ? { designPrompt: project["designPrompt"] } : {}),
    ...(typeof project["workflowView"] === "string" ? { workflowView: project["workflowView"] } : {}),
    ...(project["pcb"] !== undefined ? { pcb: project["pcb"] as SavedProject["pcb"] } : {}),
    ...(working ? { pcbWorking: working } : {}),
    ...(project["pcbStages"] && typeof project["pcbStages"] === "object" ? { pcbStages: project["pcbStages"] as PcbStageEvidence } : {}),
    ...(Array.isArray(project["pcbReleases"]) ? { pcbReleases: project["pcbReleases"] as SavedProject["pcbReleases"] } : {}),
    ...(project["componentSelections"] && typeof project["componentSelections"] === "object" ? { componentSelections: project["componentSelections"] as SavedProject["componentSelections"] } : {}),
    ...(project["ai"] && typeof project["ai"] === "object" ? { ai: project["ai"] as SavedProject["ai"] } : {}),
  };
  // [B19-D I5e row 13] a project browser storage refused is not an imported project
  const saved = trySaveProject(imported);
  if (!saved) return { ok: false, reason: "Browser storage refused the project (it may be full). Nothing was imported; free space and try again." };

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
