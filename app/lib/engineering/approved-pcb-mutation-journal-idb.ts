/**
 * B15.3 §J — the production IndexedDB store for the approved-PCB-mutation
 * journal. A PCB-specific sibling of the B12.5 store with the SAME atomic
 * boundary: read → version-check → put inside ONE `readwrite` transaction
 * with strict durability, injective array keys, size cap enforced before
 * write, unavailability THROWN (the journal converts it to a fail-closed
 * `unavailable`). There is NO legacy migration — this journal never had a
 * pre-IndexedDB format.
 */

import {
  PCB_JOURNAL_MAX_SERIALIZED,
  isValidPcbJournalScopeId,
  pcbJournalDocumentVersion,
  type ApprovedPcbMutationJournalStore,
} from "./approved-pcb-mutation-journal";

const JOURNAL_DATABASE_NAME = "sirkit-approved-pcb-mutation-journal-v1";
const JOURNAL_OBJECT_STORE = "journals";

export interface IndexedDbPcbJournalStoreOptions {
  /** Isolated database name (tests). Production uses the default. */
  databaseName?: string;
  /** The IDBFactory to open against; tests inject one shared factory to
   *  model independent browser contexts over one profile. */
  factory?: IDBFactory;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("INDEXEDDB_REQUEST_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("INDEXEDDB_TRANSACTION_ABORTED"));
    transaction.onerror = () => reject(transaction.error ?? new Error("INDEXEDDB_TRANSACTION_FAILED"));
  });
}

function assertScope(tenantId: string, projectId: string, branchId: string): void {
  for (const value of [tenantId, projectId, branchId]) {
    if (typeof value !== "string" || !isValidPcbJournalScopeId(value)) throw new Error("PCB_JOURNAL_SCOPE_INVALID");
  }
}

export class IndexedDbApprovedPcbMutationJournalStore implements ApprovedPcbMutationJournalStore {
  private database: Promise<IDBDatabase> | null = null;

  constructor(private readonly options: IndexedDbPcbJournalStoreOptions = {}) {}

  private factory(): IDBFactory {
    const factory = this.options.factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    if (!factory) throw new Error("PCB_JOURNAL_STORAGE_UNAVAILABLE");
    return factory;
  }

  private open(): Promise<IDBDatabase> {
    if (this.database === null) {
      const name = this.options.databaseName ?? JOURNAL_DATABASE_NAME;
      let factory: IDBFactory;
      try {
        factory = this.factory();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error("PCB_JOURNAL_STORAGE_UNAVAILABLE"));
      }
      const opened = new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(name, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(JOURNAL_OBJECT_STORE)) database.createObjectStore(JOURNAL_OBJECT_STORE);
        };
        request.onsuccess = () => {
          const database = request.result;
          database.onclose = () => { this.database = null; };
          database.onversionchange = () => {
            try { database.close(); } catch { /* already closing */ }
            this.database = null;
          };
          resolve(database);
        };
        request.onerror = () => reject(request.error ?? new Error("PCB_JOURNAL_STORAGE_UNAVAILABLE"));
        request.onblocked = () => reject(new Error("PCB_JOURNAL_STORAGE_UNAVAILABLE"));
      });
      this.database = opened.catch((error: unknown) => {
        this.database = null;
        throw error instanceof Error ? error : new Error("PCB_JOURNAL_STORAGE_UNAVAILABLE");
      });
    }
    return this.database;
  }

  async load(tenantId: string, projectId: string, branchId: string): Promise<unknown | null> {
    assertScope(tenantId, projectId, branchId);
    const database = await this.open();
    const transaction = database.transaction(JOURNAL_OBJECT_STORE, "readonly");
    const value = await requestValue(transaction.objectStore(JOURNAL_OBJECT_STORE).get([tenantId, projectId, branchId]) as IDBRequest<unknown>);
    await transactionDone(transaction);
    return value === undefined ? null : value;
  }

  async saveIf(tenantId: string, projectId: string, branchId: string, document: unknown, expectedVersion: number | null): Promise<boolean> {
    assertScope(tenantId, projectId, branchId);
    const serialized = JSON.stringify(document);
    if (typeof serialized !== "string") throw new Error("PCB_JOURNAL_DOCUMENT_INVALID");
    if (serialized.length > PCB_JOURNAL_MAX_SERIALIZED) throw new Error("PCB_JOURNAL_DOCUMENT_TOO_LARGE");
    const normalized = JSON.parse(serialized) as unknown;
    const database = await this.open();
    let transaction: IDBTransaction | null = null;
    try {
      transaction = database.transaction(JOURNAL_OBJECT_STORE, "readwrite", { durability: "strict" });
      const store = transaction.objectStore(JOURNAL_OBJECT_STORE);
      const current = await requestValue(store.get([tenantId, projectId, branchId]) as IDBRequest<unknown>);
      const currentVersion = current === undefined ? null : pcbJournalDocumentVersion(current);
      if (currentVersion !== expectedVersion) {
        try { transaction.abort(); } catch { /* already settled */ }
        return false;
      }
      store.put(normalized, [tenantId, projectId, branchId]);
      await transactionDone(transaction);
      return true;
    } catch (error) {
      try { transaction?.abort(); } catch { /* already settled */ }
      throw error instanceof Error ? error : new Error("PCB_JOURNAL_STORAGE_UNAVAILABLE");
    }
  }
}
