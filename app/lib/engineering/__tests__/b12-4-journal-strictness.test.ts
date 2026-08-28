/**
 * B12.4 §B/§C — strict total journal validation and the monotonic state
 * machine (R2/R3 closure).
 */

import { describe, expect, it } from "vitest";
import {
  ApprovedMutationJournal, InMemoryApprovedMutationJournalStore,
  APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA, APPROVED_MUTATION_JOURNAL_SCHEMA,
} from "../approved-mutation-journal";
import { engineeringDigest } from "../stable";

const SCOPE = { tenantId: "local", projectId: "proj-b124b", branchId: "main" } as const;
const NOW = 1_700_000_000_000;
// B16.0.1 §E: every journal entry (and persisted receipt) carries the sealed
// authorization identity; fixtures share ONE so entry/receipt stay coherent.
const ENTRY_AUTHORIZATION = { principalId: "local-user", membershipRevision: "membership:unverified" } as const;

function reseal(entry: Record<string, unknown>): Record<string, unknown> {
  const body = { ...entry };
  delete body.integrity;
  entry.integrity = engineeringDigest({ schema: APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA, body });
  return entry;
}

function validEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    schema: APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA,
    identityKey: "eng1-" + "ab".repeat(8), proposalId: "prop-" + "cd".repeat(8),
    clientOperationId: "prop-" + "cd".repeat(8), operationsDigest: "eng1-" + "ef".repeat(8),
    tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId,
    lineageId: "lin1-" + "aa".repeat(8),
    baseHeadMark: { headSequence: 0, canonicalStateDigest: "eng1-" + "bb".repeat(8) },
    baseSchematicDigest: "eng1-" + "cc".repeat(8),
    originRunId: null, authorization: { ...ENTRY_AUTHORIZATION }, operationCount: 1, destructive: false, preparedAt: NOW,
    state: "prepared",
    committedAt: null, transactionId: null, revisionBefore: null, revisionAfter: null,
    headAfter: null, schematicDigestAfter: null, receipt: null,
    ...overrides,
  };
  return reseal(entry);
}

function journalWith(entries: Array<Record<string, unknown>>, scope = SCOPE) {
  const store = new InMemoryApprovedMutationJournalStore();
  store.unsafeSetRaw(scope.tenantId, scope.projectId, scope.branchId, { schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version: 1, entries });
  return { store, journal: new ApprovedMutationJournal(store, { ...scope }) };
}

const IDENTITY = "eng1-" + "ab".repeat(8);
const COMMIT_DATA = {
  committedAt: NOW + 5, transactionId: "tx-1", revisionBefore: null, revisionAfter: null,
  headAfter: { headSequence: 1, canonicalStateDigest: "eng1-" + "dd".repeat(8) },
  schematicDigestAfter: "eng1-" + "ee".repeat(8),
};
const PREPARE_INPUT = {
  identityKey: IDENTITY, proposalId: "prop-" + "cd".repeat(8),
  operationsDigest: "eng1-" + "ef".repeat(8),
  tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId,
  lineageId: "lin1-" + "aa".repeat(8),
  baseHeadMark: { headSequence: 0, canonicalStateDigest: "eng1-" + "bb".repeat(8) },
  baseSchematicDigest: "eng1-" + "cc".repeat(8),
  originRunId: null, authorization: { ...ENTRY_AUTHORIZATION }, operationCount: 1, destructive: false, preparedAt: NOW,
};

describe("B12.4 §B/R2 — strict, total, scope-coherent validation", () => {
  it("R2 exactly: a canonical-committed entry with baseHeadMark:null and a valid checksum is CORRUPT, not an entry", async () => {
    const entry = validEntry({ state: "canonical-committed", baseHeadMark: null, ...COMMIT_DATA });
    const { journal } = journalWith([entry]);
    const lookup = await journal.lookup(IDENTITY);
    expect(lookup.kind).toBe("corrupt");
  });

  it("checksum-valid malformed entries fail closed: unknown keys, missing keys, wrong types, bad patterns, unsafe integers", async () => {
    const malformed: Array<[string, Record<string, unknown>]> = [
      ["unknown key", validEntry({ granted: true })],
      ["missing key", (() => { const entry = validEntry(); delete entry.preparedAt; return reseal(entry); })()],
      ["wrong type state", validEntry({ state: 7 })],
      ["out-of-vocab state", validEntry({ state: "half-applied" })],
      ["bad proposalId pattern", validEntry({ proposalId: "prop-XYZ", clientOperationId: "prop-XYZ" })],
      ["clientOperationId != proposalId", validEntry({ clientOperationId: "prop-" + "99".repeat(8) })],
      ["bad lineage pattern", validEntry({ lineageId: "lin2-" + "aa".repeat(8) })],
      ["negative headSequence", validEntry({ baseHeadMark: { headSequence: -1, canonicalStateDigest: "eng1-" + "bb".repeat(8) } })],
      ["unsafe headSequence", validEntry({ baseHeadMark: { headSequence: Number.MAX_SAFE_INTEGER + 2, canonicalStateDigest: "eng1-" + "bb".repeat(8) } })],
      ["extra headMark key", validEntry({ baseHeadMark: { headSequence: 0, canonicalStateDigest: "eng1-" + "bb".repeat(8), extra: 1 } })],
      ["operationCount 0", validEntry({ operationCount: 0 })],
      ["operationCount over bound", validEntry({ operationCount: 257 })],
      ["non-finite preparedAt", validEntry({ preparedAt: Number.POSITIVE_INFINITY })],
      ["oversized originRunId", validEntry({ originRunId: "x".repeat(200) })],
      // B16.0.1 §E — a LEGACY entry lacking the authorization identity, and
      // malformed authorization shapes, never validate (fail closed by design).
      ["authorization missing (legacy entry)", (() => { const entry = validEntry(); delete entry.authorization; return reseal(entry); })()],
      ["authorization extra key", validEntry({ authorization: { ...ENTRY_AUTHORIZATION, role: "project_admin" } })],
      ["authorization empty principal", validEntry({ authorization: { principalId: "", membershipRevision: "membership:unverified" } })],
      ["authorization oversized revision", validEntry({ authorization: { principalId: "local-user", membershipRevision: "x".repeat(200) } })],
    ];
    for (const [label, entry] of malformed) {
      const { journal } = journalWith([entry]);
      const lookup = await journal.lookup((entry.identityKey as string) ?? IDENTITY);
      expect(lookup.kind, label).toBe("corrupt");
    }
  });

  it("state-dependent invariants: prepared-with-commit-fields, committed-without-inputs, finalized-without/incoherent-receipt all refuse", async () => {
    const violations: Array<[string, Record<string, unknown>]> = [
      ["prepared with transactionId", validEntry({ transactionId: "tx-1" })],
      ["prepared with receipt", validEntry({ receipt: {} })],
      ["committed without transactionId", validEntry({ state: "canonical-committed", ...COMMIT_DATA, transactionId: null })],
      ["committed without headAfter", validEntry({ state: "canonical-committed", ...COMMIT_DATA, headAfter: null })],
      ["committed WITH receipt", validEntry({ state: "canonical-committed", ...COMMIT_DATA, receipt: {} })],
      ["finalized without receipt", validEntry({ state: "receipt-finalized", ...COMMIT_DATA })],
      ["finalized with non-receipt object", validEntry({ state: "receipt-finalized", ...COMMIT_DATA, receipt: { forged: true } })],
      ["poisoned with partial commit fields", validEntry({ state: "poisoned", transactionId: "tx-1" })],
    ];
    for (const [label, entry] of violations) {
      const { journal } = journalWith([entry]);
      const lookup = await journal.lookup(IDENTITY);
      expect(lookup.kind, label).toBe("corrupt");
    }
  });

  it("entry scope must match the journal instance: a foreign-project entry with a valid checksum is corrupt", async () => {
    const foreign = validEntry({ projectId: "proj-OTHER" });
    const store = new InMemoryApprovedMutationJournalStore();
    store.unsafeSetRaw(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId, { schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version: 1, entries: [foreign] });
    const journal = new ApprovedMutationJournal(store, { ...SCOPE });
    expect((await journal.lookup(IDENTITY)).kind).toBe("corrupt");
  });

  it("totality: hostile, cyclic, oversized and malformed documents never throw", async () => {
    const cyclic: Record<string, unknown> = { schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version: 1 };
    cyclic.entries = [cyclic];
    const cases: Array<[string, unknown]> = [
      ["cyclic", cyclic],
      ["string document", "junk"],
      ["array document", []],
      ["unknown doc key", { schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version: 1, entries: [], extra: 1 }],
      ["oversized", { schema: APPROVED_MUTATION_JOURNAL_SCHEMA, version: 1, entries: [validEntry({ originRunId: null, baseSchematicDigest: "eng1-" + "cc".repeat(8) })], padding: "x".repeat(300_000) }],
    ];
    for (const [label, document] of cases) {
      const store = new InMemoryApprovedMutationJournalStore();
      store.unsafeSetRaw(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId, document);
      const journal = new ApprovedMutationJournal(store, { ...SCOPE });
      await expect(journal.lookup(IDENTITY), label).resolves.toBeDefined();
      const lookup = await journal.lookup(IDENTITY);
      expect(["corrupt", "absent"], label).toContain(lookup.kind);
    }
  });
});

describe("B12.4 §C/R3 — the monotonic state machine", () => {
  async function freshJournal() {
    const store = new InMemoryApprovedMutationJournalStore();
    const journal = new ApprovedMutationJournal(store, { ...SCOPE });
    return { store, journal };
  }

  it("R3 exactly: prepare() can NEVER downgrade canonical-committed — the committed identity is preserved", async () => {
    const { journal } = await freshJournal();
    expect((await journal.prepare(PREPARE_INPUT)).ok).toBe(true);
    expect((await journal.markCommitted(IDENTITY, COMMIT_DATA)).ok).toBe(true);
    const rePrepare = await journal.prepare({ ...PREPARE_INPUT, preparedAt: NOW + 10 });
    expect(rePrepare.ok).toBe(false);
    if (!rePrepare.ok) expect(rePrepare.reason).toBe("invalid-transition");
    const after = await journal.lookup(IDENTITY);
    expect(after.kind === "entry" && after.entry.state === "canonical-committed" && after.entry.transactionId === "tx-1").toBe(true);
  });

  it("identical repeated prepare is an idempotent no-op; a conflicting prepare fails closed", async () => {
    const { journal } = await freshJournal();
    expect((await journal.prepare(PREPARE_INPUT)).ok).toBe(true);
    const before = await journal.lookup(IDENTITY);
    expect((await journal.prepare({ ...PREPARE_INPUT, preparedAt: NOW + 99 })).ok).toBe(true); // identical immutables → no-op
    const after = await journal.lookup(IDENTITY);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before)); // preparedAt NOT bumped
    const conflicting = await journal.prepare({ ...PREPARE_INPUT, operationsDigest: "eng1-" + "77".repeat(8) });
    expect(!conflicting.ok && conflicting.reason === "conflict").toBe(true);
  });

  it("every illegal transition refuses and preserves state; legal chain succeeds; repeats are idempotent", async () => {
    const { journal } = await freshJournal();
    const receipt = (() => {
      const value: Record<string, unknown> = {
        // B16.0.1: receipts are now v2 and carry the authorization identity
        // (coherent with the entry's own — validateEntry enforces equality).
        schema: "sirkit.approved-agent-mutation-receipt.v2", receiptId: "",
        proposalId: PREPARE_INPUT.proposalId, operationsDigest: PREPARE_INPUT.operationsDigest,
        originRunId: null, authorization: { ...ENTRY_AUTHORIZATION }, commandId: "schematic.edit-tier1-apply",
        tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId,
        lineageId: PREPARE_INPUT.lineageId,
        headBefore: { ...PREPARE_INPUT.baseHeadMark },
        headAfter: { ...COMMIT_DATA.headAfter },
        schematicDigestBefore: PREPARE_INPUT.baseSchematicDigest,
        schematicDigestAfter: COMMIT_DATA.schematicDigestAfter,
        transactionId: COMMIT_DATA.transactionId, operationCount: 1, destructive: false,
        postconditions: "verified", undoReference: { kind: "canonical-transaction", transactionId: COMMIT_DATA.transactionId },
        completedAt: COMMIT_DATA.committedAt,
      };
      const body = { ...value };
      delete body.receiptId;
      value.receiptId = `amr-${engineeringDigest({ schema: "sirkit.approved-mutation-receipt-id.v2", body }).slice(5)}`; // B16.0.1: v2 digest schema
      return value as never;
    })();
    // Illegal before prepare:
    expect((await journal.markCommitted(IDENTITY, COMMIT_DATA)).ok).toBe(false);
    expect((await journal.markAdopted(IDENTITY)).ok).toBe(false);
    // Legal chain:
    expect((await journal.prepare(PREPARE_INPUT)).ok).toBe(true);
    expect((await journal.markAdopted(IDENTITY)).ok).toBe(false);           // prepared → adopted: illegal
    expect((await journal.finalizeReceipt(IDENTITY, receipt)).ok).toBe(false); // prepared → finalized: illegal
    expect((await journal.markCommitted(IDENTITY, COMMIT_DATA)).ok).toBe(true);
    expect((await journal.markCommitted(IDENTITY, COMMIT_DATA)).ok).toBe(true); // idempotent identical
    const conflictingCommit = await journal.markCommitted(IDENTITY, { ...COMMIT_DATA, transactionId: "tx-2" });
    expect(!conflictingCommit.ok && conflictingCommit.reason === "conflict").toBe(true);
    expect((await journal.markAdopted(IDENTITY)).ok).toBe(true);
    expect((await journal.markAdopted(IDENTITY)).ok).toBe(true); // idempotent
    expect((await journal.finalizeReceipt(IDENTITY, receipt)).ok).toBe(true);
    expect((await journal.finalizeReceipt(IDENTITY, receipt)).ok).toBe(true); // identical receipt: idempotent
    const differentReceipt = structuredClone(receipt) as Record<string, unknown>;
    differentReceipt.completedAt = (differentReceipt.completedAt as number) + 1;
    const replaced = await journal.finalizeReceipt(IDENTITY, differentReceipt as never);
    expect(!replaced.ok && replaced.reason === "conflict").toBe(true); // the authoritative receipt can NEVER be replaced
    const poisonFinalized = await journal.poison(IDENTITY);
    expect(!poisonFinalized.ok && poisonFinalized.reason === "invalid-transition").toBe(true); // finalized can never be poisoned
    const final = await journal.lookup(IDENTITY);
    expect(final.kind === "entry" && final.entry.state === "receipt-finalized" && final.entry.transactionId === "tx-1").toBe(true);
  });

  it("poison preserves the known canonical transaction and is idempotent; prepare after poison refuses", async () => {
    const { journal } = await freshJournal();
    await journal.prepare(PREPARE_INPUT);
    await journal.markCommitted(IDENTITY, COMMIT_DATA);
    expect((await journal.poison(IDENTITY)).ok).toBe(true);
    expect((await journal.poison(IDENTITY)).ok).toBe(true); // idempotent
    const after = await journal.lookup(IDENTITY);
    expect(after.kind === "entry" && after.entry.state === "poisoned" && after.entry.transactionId === "tx-1").toBe(true);
    const rePrepare = await journal.prepare(PREPARE_INPUT);
    expect(!rePrepare.ok && rePrepare.reason === "invalid-transition").toBe(true);
  });

  it("a failed write leaves the previous durable state intact", async () => {
    const store = new InMemoryApprovedMutationJournalStore();
    const journal = new ApprovedMutationJournal(store, { ...SCOPE });
    await journal.prepare(PREPARE_INPUT);
    const failing = Object.create(store) as InMemoryApprovedMutationJournalStore;
    (failing as unknown as Record<string, unknown>).saveIf = async () => { throw new Error("write failed"); };
    (failing as unknown as Record<string, unknown>).load = store.load.bind(store);
    const failingJournal = new ApprovedMutationJournal(failing, { ...SCOPE });
    const write = await failingJournal.markCommitted(IDENTITY, COMMIT_DATA);
    expect(!write.ok && write.reason === "unavailable").toBe(true);
    const after = await journal.lookup(IDENTITY);
    expect(after.kind === "entry" && after.entry.state === "prepared").toBe(true);
  });
});
