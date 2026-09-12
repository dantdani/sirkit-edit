/**
 * [B18-B] The production IndexedDB store for the agent-execution journal —
 * the B15.3 PCB-journal store's atomic boundary (read → version-check → put
 * inside ONE `readwrite` transaction with strict durability, injective array
 * keys `[tenant, project, branch, editor]`, the size cap enforced before the
 * write, unavailability THROWN so the journal fails closed).
 */
import { EXECUTION_JOURNAL_MAX_SERIALIZED, executionJournalDocumentVersion, isValidExecutionJournalScopeId, type AgentExecutionJournalStore } from "./agent-execution-journal";

const JOURNAL_DATABASE_NAME = "sirkit-agent-execution-journal-v1";
const JOURNAL_OBJECT_STORE = "journals";

export interface IndexedDbExecutionJournalStoreOptions {
  databaseName?: string;
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

function assertScope(values: readonly string[]): void {
  for (const value of values) {
    if (typeof value !== "string" || !isValidExecutionJournalScopeId(value)) throw new Error("EXECUTION_JOURNAL_SCOPE_INVALID");
  }
}

export class IndexedDbAgentExecutionJournalStore implements AgentExecutionJournalStore {
  private database: Promise<IDBDatabase> | null = null;

  constructor(private readonly options: IndexedDbExecutionJournalStoreOptions = {}) {}

  private factory(): IDBFactory {
    const factory = this.options.factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    if (!factory) throw new Error("EXECUTION_JOURNAL_STORAGE_UNAVAILABLE");
    return factory;
  }

  private open(): Promise<IDBDatabase> {
    if (this.database === null) {
      const name = this.options.databaseName ?? JOURNAL_DATABASE_NAME;
      let factory: IDBFactory;
      try { factory = this.factory(); } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error("EXECUTION_JOURNAL_STORAGE_UNAVAILABLE"));
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
        request.onerror = () => reject(request.error ?? new Error("EXECUTION_JOURNAL_STORAGE_UNAVAILABLE"));
        request.onblocked = () => reject(new Error("EXECUTION_JOURNAL_STORAGE_UNAVAILABLE"));
      });
      this.database = opened.catch((error: unknown) => {
        this.database = null;
        throw error instanceof Error ? error : new Error("EXECUTION_JOURNAL_STORAGE_UNAVAILABLE");
      });
    }
    return this.database;
  }

  async load(tenantId: string, projectId: string, branchId: string, editor: string): Promise<unknown | null> {
    assertScope([tenantId, projectId, branchId, editor]);
    const database = await this.open();
    const transaction = database.transaction(JOURNAL_OBJECT_STORE, "readonly");
    const value = await requestValue(transaction.objectStore(JOURNAL_OBJECT_STORE).get([tenantId, projectId, branchId, editor]) as IDBRequest<unknown>);
    await transactionDone(transaction);
    return value === undefined ? null : value;
  }

  async saveIf(tenantId: string, projectId: string, branchId: string, editor: string, document: unknown, expectedVersion: number | null): Promise<boolean> {
    assertScope([tenantId, projectId, branchId, editor]);
    const serialized = JSON.stringify(document);
    if (typeof serialized !== "string") throw new Error("EXECUTION_JOURNAL_DOCUMENT_INVALID");
    if (serialized.length > EXECUTION_JOURNAL_MAX_SERIALIZED) throw new Error("EXECUTION_JOURNAL_DOCUMENT_TOO_LARGE");
    const normalized = JSON.parse(serialized) as unknown;
    const database = await this.open();
    let transaction: IDBTransaction | null = null;
    try {
      transaction = database.transaction(JOURNAL_OBJECT_STORE, "readwrite", { durability: "strict" });
      const store = transaction.objectStore(JOURNAL_OBJECT_STORE);
      const current = await requestValue(store.get([tenantId, projectId, branchId, editor]) as IDBRequest<unknown>);
      const currentVersion = current === undefined ? null : executionJournalDocumentVersion(current);
      if (currentVersion !== expectedVersion) {
        try { transaction.abort(); } catch { /* already settled */ }
        return false;
      }
      store.put(normalized, [tenantId, projectId, branchId, editor]);
      await transactionDone(transaction);
      return true;
    } catch (error) {
      try { transaction?.abort(); } catch { /* already settled */ }
      throw error instanceof Error ? error : new Error("EXECUTION_JOURNAL_STORAGE_UNAVAILABLE");
    }
  }
}
