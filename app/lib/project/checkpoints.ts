"use client";

/**
 * Durable revision checkpoints (R06-STATE01 Section 7).
 *
 * Checkpoints are full restorable snapshots (schematic + optional board +
 * chat) written at meaningful workflow moments — AI generation applied,
 * footprints placed, board routed, release produced, manual save. They live
 * in IndexedDB, NOT localStorage: a routed 10-part board snapshot is a few
 * hundred KB and a history of them would blow the ~5 MB localStorage quota
 * that the live project record depends on.
 *
 * The store is abstracted behind `CheckpointStore` so unit tests can use the
 * in-memory implementation; the browser E2E exercises the IndexedDB one.
 */

import type { SchematicState } from "@/lib/schematic-types";
import type { StoredChatMessage } from "@/lib/persistence";
import type { PcbBoard } from "@/app/lib/pcb/types";

export const CHECKPOINT_SCHEMA_VERSION = 1;

export interface ProjectCheckpoint {
  /** `${projectId}:${seq}` — unique, ordered per project. */
  id: string;
  schemaVersion: number;
  projectId: string;
  seq: number;
  label: string;
  at: number;
  schematic: SchematicState;
  chat?: StoredChatMessage[];
  board?: PcbBoard;
  /** Authoritative base under the board snapshot, when one existed. */
  boardBase?: { revision: string | null; digest: string | null };
  workflowView?: string;
}

export interface CheckpointStore {
  add(checkpoint: Omit<ProjectCheckpoint, "id" | "seq" | "schemaVersion">): Promise<ProjectCheckpoint>;
  list(projectId: string): Promise<ProjectCheckpoint[]>;
  get(projectId: string, seq: number): Promise<ProjectCheckpoint | null>;
  removeProject(projectId: string): Promise<void>;
  /** Bulk import (project-file restore). Existing ids are preserved verbatim. */
  importAll(checkpoints: ProjectCheckpoint[]): Promise<void>;
}

export function isCheckpointLike(value: unknown): value is ProjectCheckpoint {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && record.schemaVersion === CHECKPOINT_SCHEMA_VERSION
    && typeof record.projectId === "string"
    && typeof record.seq === "number" && Number.isSafeInteger(record.seq) && record.seq >= 0
    && typeof record.label === "string"
    && typeof record.at === "number"
    && typeof record.schematic === "object" && record.schematic !== null;
}

// ─── In-memory implementation (tests, SSR safety) ────────────────────────────

export class MemoryCheckpointStore implements CheckpointStore {
  private readonly rows = new Map<string, ProjectCheckpoint>();
  async add(checkpoint: Omit<ProjectCheckpoint, "id" | "seq" | "schemaVersion">): Promise<ProjectCheckpoint> {
    const seq = Math.max(-1, ...[...this.rows.values()].filter((row) => row.projectId === checkpoint.projectId).map((row) => row.seq)) + 1;
    const full: ProjectCheckpoint = { ...structuredClone(checkpoint), schemaVersion: CHECKPOINT_SCHEMA_VERSION, seq, id: `${checkpoint.projectId}:${seq}` };
    this.rows.set(full.id, full);
    return structuredClone(full);
  }
  async list(projectId: string): Promise<ProjectCheckpoint[]> {
    return [...this.rows.values()].filter((row) => row.projectId === projectId).sort((a, b) => a.seq - b.seq).map((row) => structuredClone(row));
  }
  async get(projectId: string, seq: number): Promise<ProjectCheckpoint | null> {
    const row = this.rows.get(`${projectId}:${seq}`);
    return row ? structuredClone(row) : null;
  }
  async removeProject(projectId: string): Promise<void> {
    for (const key of [...this.rows.keys()]) if (this.rows.get(key)!.projectId === projectId) this.rows.delete(key);
  }
  async importAll(checkpoints: ProjectCheckpoint[]): Promise<void> {
    for (const checkpoint of checkpoints) {
      if (!isCheckpointLike(checkpoint)) throw new Error(`CHECKPOINT_INVALID:${(checkpoint as { id?: string }).id ?? "?"}`);
      this.rows.set(checkpoint.id, structuredClone(checkpoint));
    }
  }
}

// ─── IndexedDB implementation ────────────────────────────────────────────────

const DB_NAME = "sirkit-checkpoints";
const STORE = "checkpoints";

function openDbAt(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // Versionless open attaches to WHATEVER version exists (or creates v1) —
    // never pin a version on plain opens: a pinned open against a database
    // that a heal upgraded past it throws VersionError forever.
    const request = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("byProject", "projectId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("CHECKPOINT_DB_OPEN_FAILED"));
    request.onblocked = () => reject(new Error("CHECKPOINT_DB_BLOCKED"));
  });
}

async function openDb(): Promise<IDBDatabase> {
  const db = await openDbAt();
  if (db.objectStoreNames.contains(STORE)) return db;
  // Self-heal: the database exists (created empty by another tool, or a
  // versionless open on a fresh profile) but lacks our object store — an
  // upgrade is the only way IndexedDB allows creating one.
  const nextVersion = db.version + 1;
  db.close();
  const healed = await openDbAt(nextVersion);
  if (!healed.objectStoreNames.contains(STORE)) {
    healed.close();
    throw new Error("CHECKPOINT_DB_STORE_MISSING");
  }
  return healed;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("CHECKPOINT_DB_REQUEST_FAILED"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, mode);
    const result = await run(tx.objectStore(STORE));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("CHECKPOINT_TX_FAILED"));
      tx.onabort = () => reject(tx.error ?? new Error("CHECKPOINT_TX_ABORTED"));
    });
    return result;
  } finally {
    db.close();
  }
}

export class IdbCheckpointStore implements CheckpointStore {
  async add(checkpoint: Omit<ProjectCheckpoint, "id" | "seq" | "schemaVersion">): Promise<ProjectCheckpoint> {
    return withStore("readwrite", async (store) => {
      const existing = await requestToPromise(store.index("byProject").getAll(checkpoint.projectId)) as ProjectCheckpoint[];
      const seq = Math.max(-1, ...existing.map((row) => row.seq)) + 1;
      const full: ProjectCheckpoint = { ...checkpoint, schemaVersion: CHECKPOINT_SCHEMA_VERSION, seq, id: `${checkpoint.projectId}:${seq}` };
      await requestToPromise(store.add(full));
      return full;
    });
  }
  async list(projectId: string): Promise<ProjectCheckpoint[]> {
    const rows = await withStore("readonly", (store) => requestToPromise(store.index("byProject").getAll(projectId))) as ProjectCheckpoint[];
    return rows.filter(isCheckpointLike).sort((a, b) => a.seq - b.seq);
  }
  async get(projectId: string, seq: number): Promise<ProjectCheckpoint | null> {
    const row = await withStore("readonly", (store) => requestToPromise(store.get(`${projectId}:${seq}`))) as ProjectCheckpoint | undefined;
    return row && isCheckpointLike(row) ? row : null;
  }
  async removeProject(projectId: string): Promise<void> {
    await withStore("readwrite", async (store) => {
      const rows = await requestToPromise(store.index("byProject").getAllKeys(projectId));
      for (const key of rows) await requestToPromise(store.delete(key));
    });
  }
  async importAll(checkpoints: ProjectCheckpoint[]): Promise<void> {
    for (const checkpoint of checkpoints) if (!isCheckpointLike(checkpoint)) throw new Error(`CHECKPOINT_INVALID:${(checkpoint as { id?: string }).id ?? "?"}`);
    await withStore("readwrite", async (store) => {
      for (const checkpoint of checkpoints) await requestToPromise(store.put(checkpoint));
    });
  }
}

let sharedStore: CheckpointStore | null = null;

/** The app-wide store: IndexedDB in the browser, memory when unavailable. */
export function checkpointStore(): CheckpointStore {
  if (!sharedStore) {
    sharedStore = typeof indexedDB === "undefined" ? new MemoryCheckpointStore() : new IdbCheckpointStore();
  }
  return sharedStore;
}
