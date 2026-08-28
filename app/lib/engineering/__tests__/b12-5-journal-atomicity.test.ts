/**
 * B12.5 §A — TRUE production journal atomicity.
 *
 * Every atomicity claim here is proven against the PRODUCTION
 * `IndexedDbApprovedMutationJournalStore` running on `fake-indexeddb` — a
 * faithful implementation of the IndexedDB specification, including the
 * spec's serialization of overlapping readwrite transactions across
 * independent connections. Two store instances sharing one `IDBFactory`
 * model two independent browser contexts (tabs) over one browser profile:
 * each opens its own `IDBDatabase` connection; only the engine orders
 * them. No `InMemoryApprovedMutationJournalStore` test in this file is —
 * or is labeled as — proof of cross-context atomicity.
 */

import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { SchematicState } from "@/lib/schematic-types";
import { type AtomicProjectStore } from "../persistence";
import { BrowserIndexedDbProjectStore } from "../browser-indexeddb-store";
import { compileTier1Proposal } from "../schematic-plans";
import { sealTier1Proposal, type SealedTier1Proposal, type Tier1ProposalScope } from "../schematic-proposals";
import { buildAuthorizationBinding, UNVERIFIED_MEMBERSHIP_REVISION } from "../proposal-authorization";
import type { MembershipReauthorizer } from "../../project/membership-reauthorization";
import { SchematicEditorSession } from "../schematic-session";
import { SchematicGestureCoordinator } from "../schematic-gesture-coordinator";
import { SchematicHistory } from "../../project/schematic-history";
import { adoptCanonicalResult } from "../../project/canonical-adoption";
import { ProjectCommitInterlock } from "../project-commit-interlock";
import {
  APPROVED_MUTATION_JOURNAL_SCHEMA,
  ApprovedMutationJournal,
  type ApprovedMutationJournalStore,
} from "../approved-mutation-journal";
import { IndexedDbApprovedMutationJournalStore } from "../approved-mutation-journal-idb";
import type { SchematicEditOp } from "@/lib/schematic-types";
import {
  ApprovedMutationAuditLedger, ApprovedMutationRegistry,
  applyApprovedTier1Proposal, approvedMutationIdentityKey,
  type ApprovedMutationReceipt,
} from "../approved-agent-mutations";

const PROJECT = { tenantId: "local", projectId: "proj-b125a", branchId: "main" } as const;
const SEAL_NOW = 1_700_000_000_000;

// B16.0.1 §E/§F: the test principal the fixtures seal under, and a stub
// reauthorizer returning the MATCHING live snapshot.
const TEST_PRINCIPAL = "local-user";
const ENTRY_AUTHORIZATION = { principalId: TEST_PRINCIPAL, membershipRevision: UNVERIFIED_MEMBERSHIP_REVISION } as const;
const reauthorizeAsSealed: MembershipReauthorizer = async ({ scope }) => ({
  ok: true, principalId: TEST_PRINCIPAL, role: "pcb_editor", membershipRevision: UNVERIFIED_MEMBERSHIP_REVISION, scope: { ...scope },
});
let databaseCounter = 0;
function freshDatabaseName(): string {
  databaseCounter += 1;
  return `b125-atomicity-${databaseCounter}`;
}

/** An independent browser context: its own store instance (own IDB
 *  connection) over the SHARED factory (the browser profile). */
function context(factory: IDBFactory, databaseName: string): IndexedDbApprovedMutationJournalStore {
  return new IndexedDbApprovedMutationJournalStore({ factory: factory as unknown as globalThis.IDBFactory, databaseName, legacyStorage: null });
}

/** Fault-injecting wrapper over a real factory: `failPut` makes the store
 *  put throw (quota); `abortAfterPut` aborts the transaction after a
 *  successful put (crash-shaped: nothing may commit). */
function faultFactory(base: IDBFactory, faults: { failPut?: () => boolean; abortAfterPut?: () => boolean }): IDBFactory {
  const wrapStore = (storeTarget: IDBObjectStore, txn: IDBTransaction): IDBObjectStore => new Proxy(storeTarget, {
    get(target, prop) {
      if (prop === "put" && faults.failPut?.()) {
        return () => { throw new DOMException("quota exceeded", "QuotaExceededError"); };
      }
      if (prop === "put" && faults.abortAfterPut?.()) {
        return (...args: [unknown, IDBValidKey?]) => {
          const request = target.put(...(args as [unknown, IDBValidKey]));
          txn.abort();
          return request;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  const wrapTransaction = (txn: IDBTransaction): IDBTransaction => new Proxy(txn, {
    get(target, prop) {
      if (prop === "objectStore") return (name: string) => wrapStore(target.objectStore(name), target);
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
    set(target, prop, value) { return Reflect.set(target, prop, value); },
  });
  const wrapDatabase = (database: IDBDatabase): IDBDatabase => new Proxy(database, {
    get(target, prop) {
      if (prop === "transaction") {
        return (...args: [string, IDBTransactionMode?]) => wrapTransaction(target.transaction(...args));
      }
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "open") {
        return (name: string, version?: number) => {
          const request = target.open(name, version);
          return new Proxy(request, {
            get(reqTarget, reqProp) {
              if (reqProp === "result") {
                const result = reqTarget.result as IDBDatabase | undefined;
                return result ? wrapDatabase(result) : result;
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
}

function doc(version: number, marker: string): unknown {
  return { schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version, entries: [{ marker }] };
}

function validPrepareInput(identitySeed: string, proposalSeed: string) {
  return {
    identityKey: "eng1-" + identitySeed.repeat(8).slice(0, 16),
    proposalId: "prop-" + proposalSeed.repeat(8).slice(0, 16),
    operationsDigest: "eng1-" + "33".repeat(8),
    tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId,
    lineageId: "lin1-" + "44".repeat(8),
    baseHeadMark: { headSequence: 0, canonicalStateDigest: "eng1-" + "55".repeat(8) },
    baseSchematicDigest: "eng1-" + "66".repeat(8),
    originRunId: null, authorization: { ...ENTRY_AUTHORIZATION }, operationCount: 1, destructive: false, preparedAt: SEAL_NOW,
  };
}

describe("B12.5 §A/R1 — the production store is a real cross-context compare-and-swap", () => {
  it("R1 closure: the exact read/read/write/write interleaving cannot lose a write — exactly one writer succeeds and the loser writes NOTHING", async () => {
    const factory = new IDBFactory();
    const databaseName = freshDatabaseName();
    const contextA = context(factory, databaseName);
    const contextB = context(factory, databaseName);
    const scope = [PROJECT.tenantId, "proj-r1", "main"] as const;
    expect(await contextA.saveIf(...scope, doc(0, "seed"), null)).toBe(true);

    // Both contexts start a saveIf from the SAME expected version. The
    // IndexedDB engine serializes the two readwrite transactions — the
    // second one's read runs only after the first COMMITTED, so its
    // version check fails. Both cannot succeed; nothing interleaves.
    const [a, b] = await Promise.all([
      contextA.saveIf(...scope, doc(1, "A"), 0),
      contextB.saveIf(...scope, doc(1, "B"), 0),
    ]);
    expect([a, b].filter(Boolean).length).toBe(1);
    const final = await contextA.load(...scope) as { entries: Array<{ marker: string }> };
    const winner = a ? "A" : "B";
    expect(final.entries[0]!.marker).toBe(winner); // the winner's write is the state — no writer succeeded and then lost its update
  });

  it("a version conflict returns false with nothing written; retrying from freshly loaded state succeeds", async () => {
    const factory = new IDBFactory();
    const databaseName = freshDatabaseName();
    const contextA = context(factory, databaseName);
    const contextB = context(factory, databaseName);
    const scope = [PROJECT.tenantId, "proj-retry", "main"] as const;
    expect(await contextA.saveIf(...scope, doc(0, "seed"), null)).toBe(true);
    expect(await contextA.saveIf(...scope, doc(1, "A"), 0)).toBe(true);
    // B conflicts from the stale version — and its write left no trace.
    expect(await contextB.saveIf(...scope, doc(1, "B-stale"), 0)).toBe(false);
    expect((await contextB.load(...scope) as { entries: Array<{ marker: string }> }).entries[0]!.marker).toBe("A");
    // Retry ONLY from freshly loaded state: read the current version, then swap.
    const fresh = await contextB.load(...scope) as { version: number };
    expect(await contextB.saveIf(...scope, doc(fresh.version + 1, "B-fresh"), fresh.version)).toBe(true);
    expect((await contextA.load(...scope) as { entries: Array<{ marker: string }> }).entries[0]!.marker).toBe("B-fresh");
  });

  it("different-identity concurrent journal writes from independent contexts cannot erase one another", async () => {
    const factory = new IDBFactory();
    const databaseName = freshDatabaseName();
    const journalA = new ApprovedMutationJournal(context(factory, databaseName), { ...PROJECT });
    const journalB = new ApprovedMutationJournal(context(factory, databaseName), { ...PROJECT });
    const inputA = validPrepareInput("aa", "ab");
    const inputB = validPrepareInput("ba", "bb");
    const [a, b] = await Promise.all([journalA.prepare(inputA), journalB.prepare(inputB)]);
    // One context may hit a CAS conflict and retry against fresh state —
    // both must land, and BOTH entries must exist afterward (the R1 world
    // silently erased one).
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const verifier = new ApprovedMutationJournal(context(factory, databaseName), { ...PROJECT });
    expect((await verifier.lookup(inputA.identityKey)).kind).toBe("entry");
    expect((await verifier.lookup(inputB.identityKey)).kind).toBe("entry");
  });

  it("same-identity concurrent prepare/commit/finalize converge idempotently on ONE entry with the ONE receipt", async () => {
    const factory = new IDBFactory();
    const databaseName = freshDatabaseName();
    const journalA = new ApprovedMutationJournal(context(factory, databaseName), { ...PROJECT });
    const journalB = new ApprovedMutationJournal(context(factory, databaseName), { ...PROJECT });
    const input = validPrepareInput("cc", "cd");
    const commit = {
      committedAt: SEAL_NOW + 5, transactionId: "tx-b125-conv", revisionBefore: null, revisionAfter: null,
      headAfter: { headSequence: 1, canonicalStateDigest: "eng1-" + "77".repeat(8) },
      schematicDigestAfter: "eng1-" + "88".repeat(8),
    };
    const receipt = {
      // B16.0.1: v2 receipt shape with the authorization identity, coherent
      // with the entry's own (validateEntry enforces equality).
      schema: "sirkit.approved-agent-mutation-receipt.v2",
      receiptId: "amr-" + "12".repeat(8),
      proposalId: input.proposalId, operationsDigest: input.operationsDigest, originRunId: null,
      authorization: { ...ENTRY_AUTHORIZATION },
      commandId: "schematic.edit-tier1-apply",
      tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId,
      lineageId: input.lineageId,
      headBefore: { ...input.baseHeadMark }, headAfter: { ...commit.headAfter },
      schematicDigestBefore: input.baseSchematicDigest, schematicDigestAfter: commit.schematicDigestAfter,
      transactionId: commit.transactionId, operationCount: 1, destructive: false,
      postconditions: "verified", undoReference: { kind: "canonical-transaction", transactionId: commit.transactionId },
      completedAt: commit.committedAt,
    } as unknown as ApprovedMutationReceipt;

    const prepares = await Promise.all([journalA.prepare(input), journalB.prepare(input)]);
    expect(prepares.every((outcome) => outcome.ok)).toBe(true);
    const commits = await Promise.all([journalA.markCommitted(input.identityKey, commit), journalB.markCommitted(input.identityKey, commit)]);
    expect(commits.every((outcome) => outcome.ok)).toBe(true);
    const adopts = await Promise.all([journalA.markAdopted(input.identityKey), journalB.markAdopted(input.identityKey)]);
    expect(adopts.every((outcome) => outcome.ok)).toBe(true);
    const finals = await Promise.all([journalA.finalizeReceipt(input.identityKey, receipt), journalB.finalizeReceipt(input.identityKey, receipt)]);
    expect(finals.every((outcome) => outcome.ok)).toBe(true);
    const verifier = new ApprovedMutationJournal(context(factory, databaseName), { ...PROJECT });
    const lookup = await verifier.lookup(input.identityKey);
    expect(lookup.kind === "entry" && lookup.entry.state === "receipt-finalized").toBe(true);
    if (lookup.kind === "entry") expect(JSON.stringify(lookup.entry.receipt)).toBe(JSON.stringify(receipt));
  });
});

describe("B12.5 §A — failure edges of the atomic boundary", () => {
  it("unavailable IndexedDB fails closed as a typed `unavailable` disposition — and there is NO localStorage fallback, even with a valid legacy record present", async () => {
    const legacy = new Map<string, string>();
    legacy.set("sirkit.approved-mutation-journal.v1:local:proj-b125a:main", JSON.stringify({ schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version: 1, entries: [] }));
    // No injected factory and no global indexedDB in this environment.
    const store = new IndexedDbApprovedMutationJournalStore({
      legacyStorage: { getItem: (key) => legacy.get(key) ?? null, removeItem: (key) => { legacy.delete(key); } },
    });
    await expect(store.load(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId)).rejects.toThrow("JOURNAL_STORAGE_UNAVAILABLE");
    await expect(store.saveIf(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId, doc(0, "x"), null)).rejects.toThrow("JOURNAL_STORAGE_UNAVAILABLE");
    // The legacy record was never consulted as a fallback store.
    expect(legacy.size).toBe(1);
    const journal = new ApprovedMutationJournal(store, { ...PROJECT });
    expect((await journal.lookup("eng1-" + "aa".repeat(8))).kind).toBe("unavailable");
    const write = await journal.prepare(validPrepareInput("aa", "ab"));
    expect(!write.ok && write.reason === "unavailable").toBe(true);
  });

  it("a quota failure mid-transaction preserves the last committed document", async () => {
    const base = new IDBFactory();
    let failing = false;
    const factory = faultFactory(base, { failPut: () => failing });
    const databaseName = freshDatabaseName();
    const store = context(factory, databaseName);
    const scope = [PROJECT.tenantId, "proj-quota", "main"] as const;
    expect(await store.saveIf(...scope, doc(0, "committed"), null)).toBe(true);
    failing = true;
    await expect(store.saveIf(...scope, doc(1, "quota-victim"), 0)).rejects.toThrow();
    // The journal converts the thrown quota failure into a typed
    // `unavailable` refusal (its load is read-only and still works).
    const journal = new ApprovedMutationJournal(store, { tenantId: scope[0], projectId: scope[1], branchId: scope[2] });
    const write = await journal.prepare({ ...validPrepareInput("dd", "de"), projectId: scope[1] });
    expect(!write.ok && write.reason === "unavailable").toBe(true);
    failing = false;
    // The last committed document is intact — the failed transaction
    // committed nothing (verified through an independent connection).
    const verifier = context(base, databaseName);
    expect((await verifier.load(...scope) as { version: number; entries: Array<{ marker: string }> }).entries[0]!.marker).toBe("committed");
  });

  it("an aborted transaction commits NOTHING — even after a successful put", async () => {
    const base = new IDBFactory();
    let aborting = false;
    const factory = faultFactory(base, { abortAfterPut: () => aborting });
    const databaseName = freshDatabaseName();
    const store = context(factory, databaseName);
    const scope = [PROJECT.tenantId, "proj-abort", "main"] as const;
    expect(await store.saveIf(...scope, doc(0, "committed"), null)).toBe(true);
    aborting = true;
    await expect(store.saveIf(...scope, doc(1, "aborted"), 0)).rejects.toThrow();
    aborting = false;
    const verifier = context(base, databaseName);
    const final = await verifier.load(...scope) as { version: number; entries: Array<{ marker: string }> };
    expect(final.version).toBe(0);
    expect(final.entries[0]!.marker).toBe("committed");
  });

  it("exhausted CAS retries return a typed `conflict` refusal without modifying durable state", async () => {
    const factory = new IDBFactory();
    const databaseName = freshDatabaseName();
    const store = context(factory, databaseName);
    const journal = new ApprovedMutationJournal(store, { ...PROJECT });
    const input = validPrepareInput("ee", "ef");
    expect((await journal.prepare(input)).ok).toBe(true);
    // A competitor that bumps the version between EVERY load and saveIf —
    // the journal retries from freshly loaded state each time, then fails
    // closed after the bounded retries.
    const competitor = context(factory, databaseName);
    const contended: ApprovedMutationJournalStore = {
      load: (tenantId, projectId, branchId) => store.load(tenantId, projectId, branchId),
      saveIf: async (tenantId, projectId, branchId, document, expectedVersion) => {
        const current = await competitor.load(tenantId, projectId, branchId) as { version: number } | null;
        const currentVersion = current === null ? null : current.version;
        if (currentVersion !== null) {
          await competitor.saveIf(tenantId, projectId, branchId, { ...(current as object), version: currentVersion + 1 }, currentVersion);
        }
        return store.saveIf(tenantId, projectId, branchId, document, expectedVersion);
      },
    };
    const contendedJournal = new ApprovedMutationJournal(contended, { ...PROJECT });
    const write = await contendedJournal.markCommitted(input.identityKey, {
      committedAt: SEAL_NOW + 5, transactionId: "tx-x", revisionBefore: null, revisionAfter: null,
      headAfter: { headSequence: 1, canonicalStateDigest: "eng1-" + "77".repeat(8) }, schematicDigestAfter: "eng1-" + "88".repeat(8),
    });
    expect(!write.ok && write.reason === "conflict").toBe(true);
    // Durable state untouched: still the prepared entry.
    const lookup = await journal.lookup(input.identityKey);
    expect(lookup.kind === "entry" && lookup.entry.state === "prepared").toBe(true);
  });
});

describe("B12.5 §A — exact concurrent proposal application over the PRODUCTION store", () => {
  function baseState(): SchematicState {
    return {
      components: [
        { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" },
        { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" },
      ],
      wires: [],
    };
  }

  async function tab(store: AtomicProjectStore, journalStore: ApprovedMutationJournalStore) {
    const state = baseState();
    const session = new SchematicEditorSession({ ...PROJECT }, { store });
    await session.openForProject(structuredClone(state), null);
    let visible: SchematicState = structuredClone(state);
    const history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "Opened project" });
    const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
      currentState: () => structuredClone(visible),
      applyPreviewFrame: () => {},
      applyCanonicalProjection: (label, next) => {
        const outcome = adoptCanonicalResult<SchematicState>({
          flushPendingRecord: () => {}, history: () => history,
          applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
          snapshot: (authoritative) => structuredClone(authoritative),
          historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {},
        }, label, next);
        if (!outcome.ok) throw new Error(outcome.detail);
      },
      applyRollbackProjection: (next) => { visible = structuredClone(next); },
      execute: (base, request) => session.execute(base, request),
      notify: () => {},
    });
    const registry = new ApprovedMutationRegistry();
    const journal = new ApprovedMutationJournal(journalStore, { ...PROJECT });
    let tick = SEAL_NOW + 1_000;
    return {
      session,
      apply: (proposal: SealedTier1Proposal) => applyApprovedTier1Proposal({
        proposal, session, gateway: coordinator, interlock: new ProjectCommitInterlock(),
        journal, reauthorize: reauthorizeAsSealed, stillCurrent: () => true,
        currentProjectId: PROJECT.projectId, currentBranchId: PROJECT.branchId,
        now: () => { tick += 1_000; return tick; }, registry, audit: new ApprovedMutationAuditLedger(),
      }),
    };
  }

  it("two tabs with BOTH durable layers on production IndexedDB stores: exactly one canonical transaction, one durable authoritative receipt", { timeout: 20_000 }, async () => {
    const factory = new IDBFactory();
    const databaseName = freshDatabaseName();
    // The CANONICAL store is the production BrowserIndexedDbProjectStore
    // too — each tab its own connection over the shared engine (the
    // global `indexedDB` is how that store reaches the factory).
    const globalHolder = globalThis as { indexedDB?: unknown };
    const previousFactory = globalHolder.indexedDB;
    globalHolder.indexedDB = factory;
    try {
    const canonicalDatabase = `b125-canonical-${databaseName}`;
    const store = new BrowserIndexedDbProjectStore(canonicalDatabase);
    const storeB = new BrowserIndexedDbProjectStore(canonicalDatabase);
    const tabA = await tab(store, context(factory, databaseName));
    const tabB = await tab(storeB, context(factory, databaseName));
    const state = baseState();
    const scope: Tier1ProposalScope = { ...PROJECT, headMark: tabA.session.headMark()! };
    const compilation = compileTier1Proposal(state, { ops: [{ op: "set-value", target: "R1", value: "4k7" } as SchematicEditOp], pinsByPartId: new Map() });
    const sealed = sealTier1Proposal({
      state, compilation, provenance: { provider: "openai", note: "n", instruction: "i" }, now: SEAL_NOW, scope,
      authorization: buildAuthorizationBinding({ principalId: TEST_PRINCIPAL, scope: { tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId } }),
    });
    if (sealed.kind !== "sealed") throw new Error("seal failed");
    const proposal = sealed.proposal;

    const [a, b] = await Promise.all([
      tabA.apply(structuredClone(proposal) as SealedTier1Proposal),
      tabB.apply(structuredClone(proposal) as SealedTier1Proposal),
    ]);
    const envelope = await store.load(PROJECT.projectId, PROJECT.branchId);
    expect(envelope!.transactionLog.length).toBe(1); // exactly ONE canonical transaction
    const committedReceipts: string[] = [];
    for (const outcome of [a, b]) {
      if (outcome.ok && outcome.status === "committed") {
        expect(outcome.receipt.transactionId).toBe(envelope!.transactionLog[0]!.transaction.transactionId);
        committedReceipts.push(JSON.stringify(outcome.receipt));
      } else if (outcome.ok) {
        expect(outcome.status).toBe("already-applied");
      } else {
        expect(["already-applied", "recovery-required", "command-rejected", "verification-failed", "already-in-flight"]).toContain(outcome.code);
      }
    }
    if (committedReceipts.length === 2) expect(committedReceipts[0]).toBe(committedReceipts[1]);
    // ONE durable authoritative journal entry — never corrupt, never doubled.
    const verifier = new ApprovedMutationJournal(context(factory, databaseName), { ...PROJECT });
    const identity = approvedMutationIdentityKey(proposal)!;
    const lookup = await verifier.lookup(identity);
    expect(lookup.kind).toBe("entry");
    if (lookup.kind === "entry" && lookup.entry.state === "receipt-finalized" && committedReceipts.length > 0) {
      expect(JSON.stringify(lookup.entry.receipt)).toBe(committedReceipts[0]);
    }
    } finally {
      if (previousFactory === undefined) delete globalHolder.indexedDB;
      else globalHolder.indexedDB = previousFactory;
    }
  });
});
