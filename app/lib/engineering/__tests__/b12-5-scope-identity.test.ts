/**
 * B12.5 §B — collision-free storage identity and safe legacy migration.
 *
 * The production store keys journals by the IndexedDB ARRAY key
 * [tenantId, projectId, branchId] (element-wise comparison — injective),
 * validates scope bounds BEFORE key derivation, and migrates legacy
 * (pre-B12.5, colliding-key) localStorage records by validated CONTENT
 * scope only — the old key never selects authority.
 */

import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  APPROVED_MUTATION_JOURNAL_SCHEMA,
  ApprovedMutationJournal,
  InMemoryApprovedMutationJournalStore,
  classifyLegacyJournalDocument,
} from "../approved-mutation-journal";
import {
  IndexedDbApprovedMutationJournalStore,
  legacyLocalStorageJournalKey,
  type LegacyJournalStorage,
} from "../approved-mutation-journal-idb";

const SEAL_NOW = 1_700_000_000_000;
// B16.0.1 §E: every journal entry carries the sealed authorization identity.
const ENTRY_AUTHORIZATION = { principalId: "local-user", membershipRevision: "membership:unverified" } as const;
let databaseCounter = 0;
function freshDatabaseName(): string {
  databaseCounter += 1;
  return `b125-scope-${databaseCounter}`;
}

function store(factory: IDBFactory, databaseName: string, legacyStorage: LegacyJournalStorage | null = null): IndexedDbApprovedMutationJournalStore {
  return new IndexedDbApprovedMutationJournalStore({ factory: factory as unknown as globalThis.IDBFactory, databaseName, legacyStorage });
}

function doc(version: number, marker: string): unknown {
  return { schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version, entries: [{ marker }] };
}

function legacyStub(initial: Record<string, string> = {}): LegacyJournalStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    removeItem: (key: string) => { map.delete(key); },
  };
}

/** A strictly VALID legacy journal document owned by `scope`, produced by
 *  the production journal itself (real integrity checksums). */
async function validLegacyDocumentFor(scope: { tenantId: string; projectId: string; branchId: string }, seed: string): Promise<string> {
  const memory = new InMemoryApprovedMutationJournalStore();
  const journal = new ApprovedMutationJournal(memory, scope);
  const write = await journal.prepare({
    identityKey: "eng1-" + seed.repeat(16).slice(0, 16),
    proposalId: "prop-" + seed.repeat(16).slice(0, 16),
    operationsDigest: "eng1-" + "33".repeat(8),
    tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId,
    lineageId: "lin1-" + "44".repeat(8),
    baseHeadMark: { headSequence: 0, canonicalStateDigest: "eng1-" + "55".repeat(8) },
    baseSchematicDigest: "eng1-" + "66".repeat(8),
    originRunId: null, authorization: { ...ENTRY_AUTHORIZATION }, operationCount: 1, destructive: false, preparedAt: SEAL_NOW,
  });
  if (!write.ok) throw new Error("legacy fixture prepare failed");
  const raw = await memory.load(scope.tenantId, scope.projectId, scope.branchId);
  return JSON.stringify(raw);
}

describe("B12.5 §B/R4 — valid scopes can no longer collide in storage", () => {
  it("R4 closure: {a:b, c} and {a, b:c} are DISTINCT storage identities — neither reads nor overwrites the other", async () => {
    const factory = new IDBFactory();
    const databaseName = freshDatabaseName();
    const journalStore = store(factory, databaseName);
    expect(await journalStore.saveIf("local", "a:b", "c", doc(0, "scope-one"), null)).toBe(true);
    // The colliding scope of the pre-edit counterexample now reads NOTHING.
    expect(await journalStore.load("local", "a", "b:c")).toBeNull();
    // And writing it cannot overwrite the first scope's journal.
    expect(await journalStore.saveIf("local", "a", "b:c", doc(0, "scope-two"), null)).toBe(true);
    expect((await journalStore.load("local", "a:b", "c") as { entries: Array<{ marker: string }> }).entries[0]!.marker).toBe("scope-one");
    expect((await journalStore.load("local", "a", "b:c") as { entries: Array<{ marker: string }> }).entries[0]!.marker).toBe("scope-two");
  });

  it("adversarial delimiter sweeps: every legal punctuation split maps to its own key", async () => {
    const factory = new IDBFactory();
    const databaseName = freshDatabaseName();
    const journalStore = store(factory, databaseName);
    const scopes: Array<[string, string, string]> = [
      ["local", "a:b", "c"], ["local", "a", "b:c"], ["local:a", "b", "c"],
      ["local", "a.b", "c"], ["local", "a", "b.c"],
      ["local", "a-b", "c"], ["local", "a", "b-c"],
      ["local", "a_b", "c"], ["local", "a", "b_c"],
      ["local", "a:b:c", "d"], ["local", "a:b", "c:d"], ["local", "a", "b:c:d"],
      ["x", "y", "z"], ["x", "y:z", "w"],
    ];
    for (let index = 0; index < scopes.length; index += 1) {
      expect(await journalStore.saveIf(...scopes[index]!, doc(0, `owner-${index}`), null)).toBe(true);
    }
    // Every scope reads back exactly its own document.
    for (let index = 0; index < scopes.length; index += 1) {
      const loaded = await journalStore.load(...scopes[index]!) as { entries: Array<{ marker: string }> };
      expect(loaded.entries[0]!.marker).toBe(`owner-${index}`);
    }
  });

  it("bounds are validated BEFORE key derivation: illegal ids (Unicode, empty, oversized) throw and never touch storage", async () => {
    const base = new IDBFactory();
    let opens = 0;
    const counting = new Proxy(base, {
      get(target, prop) {
        if (prop === "open") { return (name: string, version?: number) => { opens += 1; return target.open(name, version); }; }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    }) as IDBFactory;
    const journalStore = store(counting, freshDatabaseName());
    const longest = "a".repeat(128); // the longest LEGAL id
    const illegal: Array<[string, string, string]> = [
      ["local", "π-project", "main"],      // Unicode — not in the closed vocabulary
      ["local", "", "main"],               // empty
      ["local", "a".repeat(129), "main"],  // oversized
      ["local", ":starts-bad", "main"],    // illegal first character
      ["", "p", "b"],
    ];
    for (const scope of illegal) {
      await expect(journalStore.load(...scope)).rejects.toThrow("JOURNAL_SCOPE_INVALID");
      await expect(journalStore.saveIf(...scope, doc(0, "x"), null)).rejects.toThrow("JOURNAL_SCOPE_INVALID");
    }
    expect(opens).toBe(0); // storage was never touched
    // The journal converts the refusal into a fail-closed disposition.
    const journal = new ApprovedMutationJournal(journalStore, { tenantId: "local", projectId: "π-project", branchId: "main" });
    expect((await journal.lookup("eng1-" + "aa".repeat(8))).kind).toBe("unavailable");
    // The longest legal id still works and stays distinct from a shorter one.
    expect(await journalStore.saveIf("local", longest, "main", doc(0, "long"), null)).toBe(true);
    expect(await journalStore.load("local", "a".repeat(127), "main")).toBeNull();
  });
});

describe("B12.5 §B — safe legacy migration (content scope selects authority, never the key)", () => {
  const OWNER = { tenantId: "local", projectId: "a:b", branchId: "c" } as const;
  const VICTIM = { tenantId: "local", projectId: "a", branchId: "b:c" } as const; // same LEGACY key as OWNER

  it("an owned legacy journal is imported exactly once through the atomic boundary and only then removed", async () => {
    const serialized = await validLegacyDocumentFor(OWNER, "ab");
    const legacy = legacyStub({ [legacyLocalStorageJournalKey(OWNER.tenantId, OWNER.projectId, OWNER.branchId)]: serialized });
    const factory = new IDBFactory();
    const databaseName = freshDatabaseName();
    const journalStore = store(factory, databaseName, legacy);
    const migrated = await journalStore.load(OWNER.tenantId, OWNER.projectId, OWNER.branchId);
    expect(JSON.stringify(migrated)).toBe(serialized);         // imported intact
    expect(legacy.map.size).toBe(0);                            // removed AFTER durable confirmation
    // Later loads read the atomic record — mutating (or restoring) the
    // legacy layer changes nothing.
    legacy.map.set(legacyLocalStorageJournalKey(OWNER.tenantId, OWNER.projectId, OWNER.branchId), JSON.stringify(doc(9, "attacker")));
    const again = await journalStore.load(OWNER.tenantId, OWNER.projectId, OWNER.branchId);
    expect(JSON.stringify(again)).toBe(serialized);
    // A fresh context (no settled-cache) also prefers the atomic record.
    const fresh = store(factory, databaseName, legacy);
    expect(JSON.stringify(await fresh.load(OWNER.tenantId, OWNER.projectId, OWNER.branchId))).toBe(serialized);
  });

  it("R4-under-migration: the collision VICTIM scope neither reads, imports, nor deletes the owner's legacy journal", async () => {
    const serialized = await validLegacyDocumentFor(OWNER, "ab");
    const legacyKey = legacyLocalStorageJournalKey(OWNER.tenantId, OWNER.projectId, OWNER.branchId);
    expect(legacyKey).toBe(legacyLocalStorageJournalKey(VICTIM.tenantId, VICTIM.projectId, VICTIM.branchId)); // the keys DO collide
    const legacy = legacyStub({ [legacyKey]: serialized });
    const factory = new IDBFactory();
    const databaseName = freshDatabaseName();
    const journalStore = store(factory, databaseName, legacy);
    // The victim scope resolves the SAME legacy key — but the entries'
    // validated content scope says the journal is not theirs.
    expect(await journalStore.load(VICTIM.tenantId, VICTIM.projectId, VICTIM.branchId)).toBeNull();
    expect(legacy.map.size).toBe(1); // untouched — left for its true owner
    // The true owner still migrates it afterward.
    expect(JSON.stringify(await journalStore.load(OWNER.tenantId, OWNER.projectId, OWNER.branchId))).toBe(serialized);
    expect(legacy.map.size).toBe(0);
  });

  it("corrupt legacy records fail closed as `corrupt` → recovery-required: never imported, never deleted, deterministic across loads", async () => {
    const serialized = await validLegacyDocumentFor(OWNER, "ab");
    const tampered = serialized.replace('"destructive":false', '"destructive":true'); // breaks the integrity checksum
    const unparseable = "{not json";
    const factory = new IDBFactory();
    for (const corrupt of [tampered, unparseable]) {
      const legacy = legacyStub({ [legacyLocalStorageJournalKey(OWNER.tenantId, OWNER.projectId, OWNER.branchId)]: corrupt });
      const journalStore = store(factory, freshDatabaseName(), legacy);
      const journal = new ApprovedMutationJournal(journalStore, { ...OWNER });
      expect((await journal.lookup("eng1-" + "ab".repeat(8))).kind).toBe("corrupt");
      expect((await journal.lookup("eng1-" + "ab".repeat(8))).kind).toBe("corrupt"); // deterministic
      expect(legacy.map.size).toBe(1); // never deleted
      const write = await journal.prepare({
        identityKey: "eng1-" + "ab".repeat(8), proposalId: "prop-" + "ab".repeat(8),
        operationsDigest: "eng1-" + "33".repeat(8), ...OWNER,
        lineageId: "lin1-" + "44".repeat(8),
        baseHeadMark: { headSequence: 0, canonicalStateDigest: "eng1-" + "55".repeat(8) },
        baseSchematicDigest: "eng1-" + "66".repeat(8),
        originRunId: null, authorization: { ...ENTRY_AUTHORIZATION }, operationCount: 1, destructive: false, preparedAt: SEAL_NOW,
      });
      expect(!write.ok && write.reason === "corrupt").toBe(true); // nothing was imported or written over it
    }
  });

  it("a MIXED-scope legacy document is ambiguous authority — corrupt for every claimant; an EMPTY one is absent and untouched", async () => {
    const ownerDocument = JSON.parse(await validLegacyDocumentFor(OWNER, "ab")) as { entries: unknown[]; schema: string; version: number };
    const victimDocument = JSON.parse(await validLegacyDocumentFor(VICTIM, "cd")) as { entries: unknown[] };
    const mixed = JSON.stringify({ schema: ownerDocument.schema, version: 1, entries: [...ownerDocument.entries, ...victimDocument.entries] });
    expect(classifyLegacyJournalDocument(JSON.parse(mixed), OWNER).kind).toBe("corrupt");
    expect(classifyLegacyJournalDocument(JSON.parse(mixed), VICTIM).kind).toBe("corrupt");
    const empty = JSON.stringify({ schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version: 0, entries: [] });
    expect(classifyLegacyJournalDocument(JSON.parse(empty), OWNER).kind).toBe("absent");
    const legacy = legacyStub({ [legacyLocalStorageJournalKey(OWNER.tenantId, OWNER.projectId, OWNER.branchId)]: empty });
    const journalStore = store(new IDBFactory(), freshDatabaseName(), legacy);
    expect(await journalStore.load(OWNER.tenantId, OWNER.projectId, OWNER.branchId)).toBeNull();
    expect(legacy.map.size).toBe(1); // nothing to import; record left in place
  });

  it("a MIXED-scope legacy document is corrupt AT THE JOURNAL SURFACE for every claimant: lookups refuse `corrupt` and writes refuse `corrupt` — never a misleading `conflict`", async () => {
    const ownerSerialized = await validLegacyDocumentFor(OWNER, "ab");
    const ownerDocument = JSON.parse(ownerSerialized) as { entries: Array<{ identityKey: string }>; schema: string };
    const victimDocument = JSON.parse(await validLegacyDocumentFor(VICTIM, "cd")) as { entries: Array<{ identityKey: string }> };
    const mixed = JSON.stringify({ schema: ownerDocument.schema, version: 1, entries: [...ownerDocument.entries, ...victimDocument.entries] });
    const legacyKey = legacyLocalStorageJournalKey(OWNER.tenantId, OWNER.projectId, OWNER.branchId);
    const factory = new IDBFactory();
    for (const scope of [OWNER, VICTIM]) {
      const legacy = legacyStub({ [legacyKey]: mixed });
      const journal = new ApprovedMutationJournal(store(factory, freshDatabaseName(), legacy), { ...scope });
      // Even the claimant's OWN entry must NOT surface as a live entry —
      // ambiguous authority is corrupt for everyone, not reinterpreted.
      const ownIdentity = (scope === OWNER ? ownerDocument : victimDocument).entries[0]!.identityKey;
      expect((await journal.lookup(ownIdentity)).kind).toBe("corrupt");
      // And a write for an UNRELATED identity in that scope refuses
      // `corrupt` (recovery-required), never the retry-suggesting
      // `conflict` a version-baseline seam would produce.
      const write = await journal.prepare({
        identityKey: "eng1-" + "ee".repeat(8), proposalId: "prop-" + "ee".repeat(8),
        operationsDigest: "eng1-" + "33".repeat(8), ...scope,
        lineageId: "lin1-" + "44".repeat(8),
        baseHeadMark: { headSequence: 0, canonicalStateDigest: "eng1-" + "55".repeat(8) },
        baseSchematicDigest: "eng1-" + "66".repeat(8),
        originRunId: null, authorization: { ...ENTRY_AUTHORIZATION }, operationCount: 1, destructive: false, preparedAt: SEAL_NOW,
      });
      expect(!write.ok && write.reason === "corrupt").toBe(true);
      expect(legacy.map.size).toBe(1); // never imported, never deleted
    }
  });

  it("a duplicate-identity legacy document is corrupt for the classifier AND at the journal surface", async () => {
    const serialized = await validLegacyDocumentFor(OWNER, "ab");
    const parsed = JSON.parse(serialized) as { entries: unknown[]; schema: string };
    const duplicated = JSON.stringify({ schema: parsed.schema, version: 1, entries: [...parsed.entries, ...parsed.entries] });
    expect(classifyLegacyJournalDocument(JSON.parse(duplicated), OWNER).kind).toBe("corrupt");
    const legacy = legacyStub({ [legacyLocalStorageJournalKey(OWNER.tenantId, OWNER.projectId, OWNER.branchId)]: duplicated });
    const journal = new ApprovedMutationJournal(store(new IDBFactory(), freshDatabaseName(), legacy), { ...OWNER });
    const identity = (parsed.entries[0] as { identityKey: string }).identityKey;
    expect((await journal.lookup(identity)).kind).toBe("corrupt");
    expect(legacy.map.size).toBe(1);
  });

  it("the legacy record survives a failed transactional import and migrates on the next attempt (never deleted before durable confirmation)", async () => {
    const serialized = await validLegacyDocumentFor(OWNER, "ab");
    const legacyKey = legacyLocalStorageJournalKey(OWNER.tenantId, OWNER.projectId, OWNER.branchId);
    const legacy = legacyStub({ [legacyKey]: serialized });
    const base = new IDBFactory();
    let failing = true;
    const factory = new Proxy(base, {
      get(target, prop) {
        if (prop === "open") {
          return (name: string, version?: number) => {
            const request = target.open(name, version);
            return new Proxy(request, {
              get(reqTarget, reqProp) {
                if (reqProp === "result") {
                  const database = reqTarget.result as IDBDatabase | undefined;
                  if (!database) return database;
                  return new Proxy(database, {
                    get(dbTarget, dbProp) {
                      if (dbProp === "transaction") {
                        return (...args: [string, IDBTransactionMode?]) => {
                          const transaction = dbTarget.transaction(...args);
                          return new Proxy(transaction, {
                            get(txnTarget, txnProp) {
                              if (txnProp === "objectStore") {
                                return (storeName: string) => {
                                  const objectStore = txnTarget.objectStore(storeName);
                                  return new Proxy(objectStore, {
                                    get(storeTarget, storeProp) {
                                      if (storeProp === "put" && failing) {
                                        return () => { throw new DOMException("quota exceeded", "QuotaExceededError"); };
                                      }
                                      const value = Reflect.get(storeTarget, storeProp);
                                      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(storeTarget) : value;
                                    },
                                  });
                                };
                              }
                              const value = Reflect.get(txnTarget, txnProp);
                              return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(txnTarget) : value;
                            },
                            set(txnTarget, txnProp, value) { return Reflect.set(txnTarget, txnProp, value); },
                          });
                        };
                      }
                      const value = Reflect.get(dbTarget, dbProp);
                      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(dbTarget) : value;
                    },
                  });
                }
                const value = Reflect.get(reqTarget, reqProp);
                return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(reqTarget) : value;
              },
              set(reqTarget, reqProp, value) { return Reflect.set(reqTarget, reqProp, value); },
            });
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    }) as IDBFactory;
    const databaseName = freshDatabaseName();
    const journalStore = store(factory, databaseName, legacy);
    await expect(journalStore.load(OWNER.tenantId, OWNER.projectId, OWNER.branchId)).rejects.toThrow();
    expect(legacy.map.size).toBe(1); // NOT deleted — the import never confirmed
    failing = false;
    const migrated = await journalStore.load(OWNER.tenantId, OWNER.projectId, OWNER.branchId);
    expect(JSON.stringify(migrated)).toBe(serialized);
    expect(legacy.map.size).toBe(0);
  });

  it("two contexts migrating concurrently import exactly one record and converge", async () => {
    const serialized = await validLegacyDocumentFor(OWNER, "ab");
    const legacyKey = legacyLocalStorageJournalKey(OWNER.tenantId, OWNER.projectId, OWNER.branchId);
    const legacy = legacyStub({ [legacyKey]: serialized });
    const factory = new IDBFactory();
    const databaseName = freshDatabaseName();
    const contextA = store(factory, databaseName, legacy);
    const contextB = store(factory, databaseName, legacy);
    const [a, b] = await Promise.all([
      contextA.load(OWNER.tenantId, OWNER.projectId, OWNER.branchId),
      contextB.load(OWNER.tenantId, OWNER.projectId, OWNER.branchId),
    ]);
    expect(JSON.stringify(a)).toBe(serialized);
    expect(JSON.stringify(b)).toBe(serialized);
    expect(legacy.map.size).toBe(0);
    // Exactly one atomic record; a journal over it sees exactly one entry.
    const journal = new ApprovedMutationJournal(store(factory, databaseName, null), { ...OWNER });
    const parsed = JSON.parse(serialized) as { entries: Array<{ identityKey: string }> };
    const lookup = await journal.lookup(parsed.entries[0]!.identityKey);
    expect(lookup.kind).toBe("entry");
  });
});
