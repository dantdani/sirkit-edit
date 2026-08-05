"use client";

import { createPersistenceEnvelope, validatePersistenceEnvelope, type AtomicProjectStore } from "./persistence";
import type { CanonicalProjectState, DurableTransactionRecord, ProjectPersistenceEnvelope, ProjectRevision } from "./types";

const STORE_NAME = "projects";
function key(projectId: string, branchId: string): string { return `${projectId}\0${branchId}`; }
function requestValue<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error("INDEXEDDB_REQUEST_FAILED")); }); }
function transactionDone(transaction: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error("INDEXEDDB_TRANSACTION_ABORTED")); transaction.onerror = () => reject(transaction.error ?? new Error("INDEXEDDB_TRANSACTION_FAILED")); }); }

/** Browser durable adapter. Canonical snapshot, log and head are one IndexedDB read-write transaction. */
export class BrowserIndexedDbProjectStore implements AtomicProjectStore {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly databaseName = "sirkit-engineering-v1") {}
  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("INDEXEDDB_UNAVAILABLE"));
    this.database ??= new Promise((resolve, reject) => { const request = indexedDB.open(this.databaseName, 1); request.onupgradeneeded = () => { const database = request.result; if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error("INDEXEDDB_OPEN_FAILED")); request.onblocked = () => reject(new Error("INDEXEDDB_UPGRADE_BLOCKED")); }); return this.database;
  }
  async load(projectId: string, branchId: string): Promise<ProjectPersistenceEnvelope | null> { const database = await this.open(); const transaction = database.transaction(STORE_NAME, "readonly"); const value = await requestValue(transaction.objectStore(STORE_NAME).get(key(projectId, branchId)) as IDBRequest<ProjectPersistenceEnvelope | undefined>); await transactionDone(transaction); if (!value) return null; const errors = validatePersistenceEnvelope(value); if (errors.length) throw new Error(`ENVELOPE_INTEGRITY_FAILED:${errors.join(",")}`); return structuredClone(value); }
  async initialize(project: CanonicalProjectState, revision: ProjectRevision, buildId: string): Promise<ProjectPersistenceEnvelope> { const database = await this.open(); const transaction = database.transaction(STORE_NAME, "readwrite", { durability: "strict" }); const store = transaction.objectStore(STORE_NAME); const storageKey = key(project.projectId, project.branchId); const existing = await requestValue(store.get(storageKey) as IDBRequest<ProjectPersistenceEnvelope | undefined>); const envelope = existing ?? createPersistenceEnvelope({ project, revision, transactionLog: [], buildId }); if (!existing) store.add(envelope, storageKey); await transactionDone(transaction); return structuredClone(envelope); }
  async commit(input: { expectedHeadSequence: number; project: CanonicalProjectState; revision: ProjectRevision; record: DurableTransactionRecord; buildId: string }): Promise<ProjectPersistenceEnvelope> {
    const database = await this.open(); const transaction = database.transaction(STORE_NAME, "readwrite", { durability: "strict" }); const store = transaction.objectStore(STORE_NAME); const storageKey = key(input.project.projectId, input.project.branchId);
    try {
      const current = await requestValue(store.get(storageKey) as IDBRequest<ProjectPersistenceEnvelope | undefined>); if (!current) throw new Error("PROJECT_NOT_INITIALIZED"); if (current.transactionLog.some((record) => record.transaction.clientOperationId === input.record.transaction.clientOperationId)) { await transactionDone(transaction); return structuredClone(current); } if (current.snapshotRevision.headSequence !== input.expectedHeadSequence) throw new Error(`STORE_HEAD_MISMATCH:${current.snapshotRevision.headSequence}`);
      const envelope = createPersistenceEnvelope({ project: input.project, revision: input.revision, transactionLog: [...current.transactionLog, input.record], buildId: input.buildId, migrationHistory: current.migrationHistory }); store.put(envelope, storageKey); await transactionDone(transaction); return structuredClone(envelope);
    } catch (error) { try { transaction.abort(); } catch { /* already completed/aborted */ } throw error; }
  }
  async backup(projectId: string, branchId: string): Promise<ProjectPersistenceEnvelope> { const value = await this.load(projectId, branchId); if (!value) throw new Error("PROJECT_NOT_FOUND"); return value; }
  async restore(envelope: ProjectPersistenceEnvelope): Promise<ProjectPersistenceEnvelope> { const errors = validatePersistenceEnvelope(envelope); if (errors.length) throw new Error(`RESTORE_INTEGRITY_FAILED:${errors.join(",")}`); const database = await this.open(); const transaction = database.transaction(STORE_NAME, "readwrite", { durability: "strict" }); transaction.objectStore(STORE_NAME).put(structuredClone(envelope), key(envelope.projectId, envelope.branchId)); await transactionDone(transaction); return structuredClone(envelope); }
}
