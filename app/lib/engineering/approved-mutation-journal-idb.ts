"use client";

/**
 * B12.5 §A/§B — the PRODUCTION approved-mutation journal store.
 *
 * Replaces the B12.4 localStorage pseudo-CAS after two reproduced
 * production-boundary defects:
 *
 *  R1 — localStorage `saveIf` performed read-check-write with no
 *       cross-context atomicity: two contexts both returned true from the
 *       same expected version and one write was silently lost.
 *  R4 — the delimiter-joined storage key collided distinct valid scopes
 *       (`:` is a legal scope character), so one scope could read and
 *       overwrite another scope's journal.
 *
 * Design:
 *
 *  - ATOMICITY (§A): `saveIf` performs read → version-check → write inside
 *    ONE IndexedDB `readwrite` transaction. The IndexedDB engine
 *    serializes overlapping readwrite transactions across every
 *    participating browser context (tabs, workers) — the browser primitive
 *    itself supplies the serialization; there is no module-global mutex
 *    and no localStorage fallback. A version conflict aborts the
 *    transaction and returns false with NOTHING written; crash/quota/abort
 *    failures leave the last committed document intact (IndexedDB
 *    transactions commit atomically or not at all). Unavailability THROWS
 *    (`JOURNAL_STORAGE_UNAVAILABLE`) — the journal converts it into a
 *    typed `unavailable` disposition and the apply boundary fails closed.
 *
 *  - COLLISION-FREE IDENTITY (§B): records are keyed by the IndexedDB
 *    ARRAY key `[tenantId, projectId, branchId]` — array keys compare
 *    element-wise, so the encoding is injective for every legal scope
 *    tuple; no delimiter ambiguity exists. Scope ids are bounds-validated
 *    (closed `SCOPE_ID` vocabulary, length ≤ 128) BEFORE key derivation;
 *    an invalid scope throws (`JOURNAL_SCOPE_INVALID`) and fails closed.
 *
 *  - MIGRATION: legacy pre-B12.5 localStorage records are recognized under
 *    their old (colliding) key but the key NEVER selects authority — only
 *    the strictly validated content scope of the entries does
 *    (`classifyLegacyJournalDocument`). An `owned` document is imported
 *    exactly once through the atomic boundary (put-if-absent transaction);
 *    the legacy record is removed only AFTER the transactional import is
 *    durably confirmed. `foreign` (a collision victim's journal) and
 *    `absent` records are left untouched; `corrupt` records are returned
 *    raw so the journal's strict validation surfaces `recovery-required`
 *    — never imported, never deleted, never silently reinterpreted.
 */

import {
  APPROVED_MUTATION_JOURNAL_MAX_SERIALIZED,
  classifyLegacyJournalDocument,
  isValidJournalScopeId,
  journalDocumentVersion,
  type ApprovedMutationJournalStore,
} from "./approved-mutation-journal";

const JOURNAL_DATABASE_NAME = "sirkit-approved-mutation-journal-v1";
const JOURNAL_OBJECT_STORE = "journals";

/** The pre-B12.5 localStorage key encoding. COLLIDING (R4) — retained
 *  solely to locate records to migrate; never used to select authority. */
export const LEGACY_LOCAL_STORAGE_JOURNAL_PREFIX = "sirkit.approved-mutation-journal.v1:";
export function legacyLocalStorageJournalKey(tenantId: string, projectId: string, branchId: string): string {
  return `${LEGACY_LOCAL_STORAGE_JOURNAL_PREFIX}${tenantId}:${projectId}:${branchId}`;
}

export interface LegacyJournalStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

export interface IndexedDbJournalStoreOptions {
  /** Isolated database name (tests). Production uses the default. */
  databaseName?: string;
  /** The IDBFactory to open against. Production uses the global
   *  `indexedDB`; tests inject one shared factory across independent
   *  store instances to model independent browser contexts over one
   *  browser profile. */
  factory?: IDBFactory;
  /** Where legacy pre-B12.5 records live. `null` disables migration;
   *  omitted = `window.localStorage` when present. */
  legacyStorage?: LegacyJournalStorage | null;
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

/** §B — bounds BEFORE key derivation; throws on any illegal scope id. */
function assertJournalScope(tenantId: string, projectId: string, branchId: string): void {
  for (const value of [tenantId, projectId, branchId]) {
    if (typeof value !== "string" || !isValidJournalScopeId(value)) {
      throw new Error("JOURNAL_SCOPE_INVALID");
    }
  }
}

export class IndexedDbApprovedMutationJournalStore implements ApprovedMutationJournalStore {
  private database: Promise<IDBDatabase> | null = null;
  /** Scopes whose legacy migration has SETTLED (imported, absent, or
   *  foreign). `corrupt` is deliberately never cached — every load keeps
   *  returning the corrupt legacy record so recovery stays deterministic
   *  until it is repaired or removed. */
  private readonly migrationSettled = new Set<string>();

  constructor(private readonly options: IndexedDbJournalStoreOptions = {}) {}

  private factory(): IDBFactory {
    const factory = this.options.factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    if (!factory) throw new Error("JOURNAL_STORAGE_UNAVAILABLE");
    return factory;
  }

  private open(): Promise<IDBDatabase> {
    if (this.database === null) {
      const name = this.options.databaseName ?? JOURNAL_DATABASE_NAME;
      let factory: IDBFactory;
      try {
        factory = this.factory();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error("JOURNAL_STORAGE_UNAVAILABLE"));
      }
      const opened = new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(name, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(JOURNAL_OBJECT_STORE)) database.createObjectStore(JOURNAL_OBJECT_STORE);
        };
        request.onsuccess = () => {
          const database = request.result;
          // A force-closed connection (storage pressure, site-data clear)
          // or an upgrade elsewhere must not poison the cache: drop it so
          // the next operation reopens instead of failing forever.
          database.onclose = () => { this.database = null; };
          database.onversionchange = () => {
            try { database.close(); } catch { /* already closing */ }
            this.database = null;
          };
          resolve(database);
        };
        request.onerror = () => reject(request.error ?? new Error("JOURNAL_STORAGE_UNAVAILABLE"));
        request.onblocked = () => reject(new Error("JOURNAL_STORAGE_UNAVAILABLE"));
      });
      // A failed open is not cached — a later attempt may succeed, and a
      // cached rejection would otherwise surface as an unhandled rejection.
      this.database = opened.catch((error: unknown) => {
        this.database = null;
        throw error instanceof Error ? error : new Error("JOURNAL_STORAGE_UNAVAILABLE");
      });
    }
    return this.database;
  }

  async load(tenantId: string, projectId: string, branchId: string): Promise<unknown | null> {
    assertJournalScope(tenantId, projectId, branchId);
    const database = await this.open();
    const transaction = database.transaction(JOURNAL_OBJECT_STORE, "readonly");
    const value = await requestValue(transaction.objectStore(JOURNAL_OBJECT_STORE).get([tenantId, projectId, branchId]) as IDBRequest<unknown>);
    await transactionDone(transaction);
    if (value !== undefined) return value;
    return this.migrateLegacy(tenantId, projectId, branchId);
  }

  /** §A — the atomic boundary: read → version-check → write in ONE
   *  readwrite transaction. Two independent contexts can never both
   *  succeed from the same expected version; a conflict writes NOTHING. */
  async saveIf(tenantId: string, projectId: string, branchId: string, document: unknown, expectedVersion: number | null): Promise<boolean> {
    assertJournalScope(tenantId, projectId, branchId);
    const serialized = JSON.stringify(document);
    if (typeof serialized !== "string") throw new Error("JOURNAL_DOCUMENT_INVALID");
    if (serialized.length > APPROVED_MUTATION_JOURNAL_MAX_SERIALIZED) throw new Error("JOURNAL_DOCUMENT_TOO_LARGE");
    // A plain-JSON normalized copy: what commits is exactly what a reload
    // will parse — no prototypes, functions, or non-JSON values.
    const normalized = JSON.parse(serialized) as unknown;
    const database = await this.open();
    let transaction: IDBTransaction | null = null;
    try {
      // Transaction creation stays INSIDE the guard: a connection that
      // died between open() and here surfaces through the same typed
      // fail-closed path, never as an unguarded synchronous throw.
      transaction = database.transaction(JOURNAL_OBJECT_STORE, "readwrite", { durability: "strict" });
      const store = transaction.objectStore(JOURNAL_OBJECT_STORE);
      const current = await requestValue(store.get([tenantId, projectId, branchId]) as IDBRequest<unknown>);
      const currentVersion = current === undefined ? null : journalDocumentVersion(current);
      if (currentVersion !== expectedVersion) {
        try { transaction.abort(); } catch { /* already settled */ }
        return false;
      }
      store.put(normalized, [tenantId, projectId, branchId]);
      await transactionDone(transaction);
      return true;
    } catch (error) {
      try { transaction?.abort(); } catch { /* already settled */ }
      throw error instanceof Error ? error : new Error("JOURNAL_STORAGE_UNAVAILABLE");
    }
  }

  private legacyStorage(): LegacyJournalStorage | null {
    if (this.options.legacyStorage !== undefined) return this.options.legacyStorage;
    try {
      if (typeof window === "undefined" || !window.localStorage) return null;
      return window.localStorage;
    } catch {
      return null;
    }
  }

  /** One-shot legacy import. Returns what `load` should surface for a
   *  scope with no atomic-store record: `null` (absent/foreign/settled),
   *  the imported document, or the CORRUPT legacy raw (which the
   *  journal's strict validation turns into `recovery-required`). */
  private async migrateLegacy(tenantId: string, projectId: string, branchId: string): Promise<unknown | null> {
    const settleKey = JSON.stringify([tenantId, projectId, branchId]);
    if (this.migrationSettled.has(settleKey)) return null;
    const storage = this.legacyStorage();
    if (!storage) {
      this.migrationSettled.add(settleKey);
      return null;
    }
    let raw: string | null;
    try {
      raw = storage.getItem(legacyLocalStorageJournalKey(tenantId, projectId, branchId));
    } catch {
      // The legacy layer is unreadable RIGHT NOW — do not settle; a later
      // load retries so an importable record is never silently skipped.
      return null;
    }
    if (raw === null) {
      this.migrationSettled.add(settleKey);
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Unparseable legacy record: surface it raw — strict validation
      // classifies it corrupt → recovery-required. Never deleted.
      return raw;
    }
    const classification = classifyLegacyJournalDocument(parsed, { tenantId, projectId, branchId });
    // Corrupt (incl. MIXED-scope — ambiguous authority): surface the RAW
    // STRING, which the journal's strict load classifies as a corrupt
    // DOCUMENT — corrupt for EVERY identity and every claimant scope, so
    // lookups refuse `corrupt` and writes refuse `corrupt` (never a
    // misleading `conflict`), uniformly, until the record is repaired.
    if (classification.kind === "corrupt") return raw;
    if (classification.kind === "foreign" || classification.kind === "absent") {
      // Not this scope's journal (or nothing to import): the collision-
      // prone key never selects authority. Left untouched for its owner.
      this.migrationSettled.add(settleKey);
      return null;
    }
    // OWNED — import exactly once through the atomic boundary.
    const database = await this.open();
    let transaction: IDBTransaction | null = null;
    let imported = false;
    try {
      transaction = database.transaction(JOURNAL_OBJECT_STORE, "readwrite", { durability: "strict" });
      const store = transaction.objectStore(JOURNAL_OBJECT_STORE);
      const existing = await requestValue(store.get([tenantId, projectId, branchId]) as IDBRequest<unknown>);
      if (existing === undefined) {
        // put-if-absent: a concurrent context's completed migration wins;
        // ours becomes a no-op inside the serialized transaction.
        store.put(structuredClone(classification.document), [tenantId, projectId, branchId]);
        imported = true;
      }
      await transactionDone(transaction); // ← durable confirmation
    } catch (error) {
      try { transaction?.abort(); } catch { /* already settled */ }
      throw error instanceof Error ? error : new Error("JOURNAL_STORAGE_UNAVAILABLE");
    }
    // The legacy record is removed ONLY by the context that actually
    // imported it, and only after durable confirmation. If another
    // document already occupied the key (a concurrent migrator — which
    // removes it itself — or an out-of-band write), this context deletes
    // nothing: content it did not confirm durable is never destroyed.
    if (imported) {
      try { storage.removeItem(legacyLocalStorageJournalKey(tenantId, projectId, branchId)); } catch { /* non-fatal */ }
    }
    this.migrationSettled.add(settleKey);
    const readback = database.transaction(JOURNAL_OBJECT_STORE, "readonly");
    const value = await requestValue(readback.objectStore(JOURNAL_OBJECT_STORE).get([tenantId, projectId, branchId]) as IDBRequest<unknown>);
    await transactionDone(readback);
    return value === undefined ? null : value;
  }
}
