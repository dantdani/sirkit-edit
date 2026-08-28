/**
 * B12.3 §A–§E — durable approved-mutation replay, crash-window semantics,
 * and reload recovery (R1/R2 closure).
 *
 * Every "browser" is a fresh composition (new session over the SAME durable
 * store, fresh in-memory registry, fresh interlock) sharing the SAME
 * durable journal store — a genuine reload. Pre-edit counterexample: exact
 * replay after reload was refused `stale-head` before durable idempotency
 * could run, and no durable record held the receipt.
 */

import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { InMemoryAtomicProjectStore } from "../persistence";
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
  ApprovedMutationJournal, InMemoryApprovedMutationJournalStore,
  APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA, APPROVED_MUTATION_JOURNAL_SCHEMA,
  type ApprovedMutationJournalStore,
} from "../approved-mutation-journal";
import { canonicalJson, engineeringDigest } from "../stable";
import type { SchematicEditOp } from "@/lib/schematic-types";
import {
  ApprovedMutationAuditLedger, ApprovedMutationRegistry,
  applyApprovedTier1Proposal, approvedMutationIdentityKey,
  validateApprovedMutationReceipt,
} from "../approved-agent-mutations";

const PROJECT = { tenantId: "local", projectId: "proj-b123", branchId: "main" } as const;
const SEAL_NOW = 1_700_000_000_000;

function baseState(): SchematicState {
  return {
    components: [
      { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" },
      { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" },
    ],
    wires: [],
  };
}

// B16.0.1 §E/§F: the test principal the fixtures seal under, and a stub
// reauthorizer returning the MATCHING live snapshot.
const TEST_PRINCIPAL = "local-user";
const ENTRY_AUTHORIZATION = { principalId: TEST_PRINCIPAL, membershipRevision: UNVERIFIED_MEMBERSHIP_REVISION } as const;
const reauthorizeAsSealed: MembershipReauthorizer = async ({ scope }) => ({
  ok: true, principalId: TEST_PRINCIPAL, role: "pcb_editor", membershipRevision: UNVERIFIED_MEMBERSHIP_REVISION, scope: { ...scope },
});

function sealFor(session: SchematicEditorSession, state: SchematicState, ids: { tenantId: string; projectId: string; branchId: string } = PROJECT, ops: readonly SchematicEditOp[] = [{ op: "set-value", target: "R1", value: "4k7" }]): SealedTier1Proposal {
  const scope: Tier1ProposalScope = { tenantId: ids.tenantId, projectId: ids.projectId, branchId: ids.branchId, headMark: session.headMark()! };
  const compilation = compileTier1Proposal(state, { ops, pinsByPartId: new Map() });
  const outcome = sealTier1Proposal({
    state, compilation, provenance: { provider: "openai", note: "n", instruction: "i" }, now: SEAL_NOW, scope,
    authorization: buildAuthorizationBinding({ principalId: TEST_PRINCIPAL, scope: { tenantId: ids.tenantId, projectId: ids.projectId, branchId: ids.branchId } }),
  });
  if (outcome.kind !== "sealed") throw new Error("seal failed");
  return outcome.proposal;
}

interface Browser {
  session: SchematicEditorSession;
  registry: ApprovedMutationRegistry;
  journal: ApprovedMutationJournal;
  history: SchematicHistory<SchematicState>;
  visible(): SchematicState;
  apply(proposal: SealedTier1Proposal, journalOverride?: ApprovedMutationJournal): ReturnType<typeof applyApprovedTier1Proposal>;
}

/** One "browser": a fresh composition over the SHARED durable stores. */
async function browser(store: InMemoryAtomicProjectStore, journalStore: ApprovedMutationJournalStore, opened?: { projection: SchematicState; mark: Parameters<SchematicEditorSession["openForProject"]>[1] }, ids: { tenantId: string; projectId: string; branchId: string } = PROJECT, failHistory = false): Promise<Browser> {
  const initial = opened?.projection ?? baseState();
  const session = new SchematicEditorSession({ ...ids }, { store });
  const hydration = await session.openForProject(structuredClone(initial), opened?.mark ? structuredClone(opened.mark) : null);
  let adopted = initial;
  if (hydration.status === "recovered-canonical") {
    // The page's recovery handshake: adopt the durable canonical head, then
    // confirm adoption so the session becomes ready (a reload after a crash
    // that lost the persisted projection lands here).
    adopted = hydration.state;
    session.confirmAdoption(hydration.state);
  }
  let visible: SchematicState = structuredClone(adopted);
  const history = new SchematicHistory<SchematicState>(structuredClone(adopted), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, state) => {
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {},
        history: () => (failHistory ? null : history),
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => structuredClone(authoritative),
        historyRecorded: () => {},
        suppressEffectRecord: () => {},
        scheduleAutosave: () => {},
      }, label, state);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (state) => { visible = structuredClone(state); },
    execute: (base, request) => session.execute(base, request),
    notify: () => {},
  });
  const registry = new ApprovedMutationRegistry();
  const journal = new ApprovedMutationJournal(journalStore, { tenantId: ids.tenantId, projectId: ids.projectId, branchId: ids.branchId });
  let tick = SEAL_NOW + 1_000;
  const clock = (): number => { tick += 1_000; return tick; };
  return {
    session, registry, journal, history,
    visible: () => structuredClone(visible),
    apply: (proposal, journalOverride) => applyApprovedTier1Proposal({
      proposal, session, gateway: coordinator, interlock: new ProjectCommitInterlock(),
      journal: journalOverride ?? journal,
      reauthorize: reauthorizeAsSealed, // B16.0.1 §F
      stillCurrent: () => true,
      currentProjectId: ids.projectId, currentBranchId: ids.branchId,
      now: clock, registry, audit: new ApprovedMutationAuditLedger(),
    }),
  };
}

async function txCount(store: InMemoryAtomicProjectStore, ids = PROJECT): Promise<number> {
  const envelope = await store.load(ids.projectId, ids.branchId);
  return envelope?.transactionLog.length ?? 0;
}

/** A journal whose named operation fails N times (crash injection). */
function failingJournal(journal: ApprovedMutationJournal, method: "markCommitted" | "finalizeReceipt", times = 1): ApprovedMutationJournal {
  const wrapper = Object.create(journal) as ApprovedMutationJournal & Record<string, unknown>;
  let remaining = times;
  const failing = async (...args: unknown[]) => {
    if (remaining > 0) { remaining -= 1; return { ok: false, reason: "unavailable" as const }; }
    return (journal[method] as unknown as (...inner: unknown[]) => Promise<unknown>)(...args);
  };
  (wrapper as Record<string, unknown>)[method] = failing;
  // Object.create keeps prototype methods; bind lookup/prepare etc. to the real journal.
  wrapper.lookup = journal.lookup.bind(journal);
  wrapper.prepare = journal.prepare.bind(journal);
  wrapper.markAdopted = journal.markAdopted.bind(journal);
  wrapper.poison = journal.poison.bind(journal);
  if (method !== "markCommitted") wrapper.markCommitted = journal.markCommitted.bind(journal);
  if (method !== "finalizeReceipt") wrapper.finalizeReceipt = journal.finalizeReceipt.bind(journal);
  return wrapper;
}

describe("B12.3 R1/R2 — exact replay after a genuine reload", () => {
  it("returns already-applied with the BYTE-IDENTICAL original receipt and exactly one transaction; altered and foreign replays stay contained", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const first = await browser(store, journalStore);
    const proposal = sealFor(first.session, baseState());
    const original = await first.apply(proposal);
    expect(original.ok && original.status === "committed").toBe(true);
    if (!original.ok || original.status !== "committed") return;
    const persistedProjection = first.visible();
    const persistedMark = first.session.headMark()!;
    first.session.dispose();

    // ── RELOAD: fresh session over the same durable store at the committed
    // head; fresh registry; the SAME durable journal store.
    const second = await browser(store, journalStore, { projection: persistedProjection, mark: persistedMark });
    expect(second.session.lifecycle).toBe("ready");
    const replay = await second.apply(structuredClone(proposal) as SealedTier1Proposal);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.status).toBe("already-applied");
      if (replay.status === "already-applied") {
        // Byte-identical original receipt.
        expect(replay.receipt.receiptId).toBe(original.receipt.receiptId);
        expect(JSON.stringify(replay.receipt)).toBe(JSON.stringify(original.receipt));
        expect(canonicalJson(replay.receipt)).toBe(canonicalJson(original.receipt));
        expect(validateApprovedMutationReceipt(replay.receipt)).toEqual([]);
      }
    }
    // Exactly ONE canonical transaction, before and after the replay.
    expect(await txCount(store)).toBe(1);
    // A second reload replay is byte-identical again.
    const third = await browser(store, journalStore, { projection: persistedProjection, mark: persistedMark });
    const replayAgain = await third.apply(structuredClone(proposal) as SealedTier1Proposal);
    expect(replayAgain.ok && replayAgain.status === "already-applied" && JSON.stringify(replayAgain.receipt) === JSON.stringify(original.receipt)).toBe(true);
    expect(await txCount(store)).toBe(1);

    // An ALTERED proposal after reload does not inherit the replay.
    const altered = structuredClone(proposal) as unknown as { operations: unknown };
    altered.operations = [{ kind: "set-component-properties", componentId: "R2", properties: { value: "9k9" } }];
    const alteredOutcome = await third.apply(altered as unknown as SealedTier1Proposal);
    expect(!alteredOutcome.ok && alteredOutcome.code === "verification-failed").toBe(true);

    // A FOREIGN live composition (different project) exposes no receipt even
    // with the shared durable journal store.
    const foreignStore = new InMemoryAtomicProjectStore();
    const foreign = await browser(foreignStore, journalStore, undefined, { tenantId: "local", projectId: "proj-other", branchId: "main" });
    const foreignOutcome = await foreign.apply(proposal);
    expect(foreignOutcome.ok).toBe(false);
    if (!foreignOutcome.ok) {
      expect(foreignOutcome.code).toBe("verification-failed");
      expect(JSON.stringify(foreignOutcome)).not.toContain("amr-");
    }
    expect(await txCount(store)).toBe(1);
  });

  it("§E — stillCurrent is required and refuses every path; a retiring interlock refuses even an exact receipt lookup", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const page = await browser(store, journalStore);
    const proposal = sealFor(page.session, baseState());
    const committed = await page.apply(proposal);
    expect(committed.ok && committed.status === "committed").toBe(true);
    // stillCurrent=false → refused BEFORE any lookup, no receipt.
    const stale = await applyApprovedTier1Proposal({
      proposal, session: page.session, gateway: { runCanonicalCommand: async () => ({ status: "failed", error: new Error("unreachable") }) },
      interlock: new ProjectCommitInterlock(), journal: page.journal,
      reauthorize: reauthorizeAsSealed, // B16.0.1 §F
      stillCurrent: () => false,
      currentProjectId: PROJECT.projectId, currentBranchId: PROJECT.branchId,
      now: () => SEAL_NOW + 5_000, registry: page.registry, audit: new ApprovedMutationAuditLedger(),
    });
    expect(!stale.ok && stale.code === "session-superseded").toBe(true);
    expect(JSON.stringify(stale)).not.toContain("amr-");
    // Transition pending (retiring interlock) → exact receipt lookup refuses.
    const retiring = new ProjectCommitInterlock();
    const lease = retiring.acquireCommitLease();
    void retiring.retire();
    const duringTransition = await applyApprovedTier1Proposal({
      proposal, session: page.session, gateway: { runCanonicalCommand: async () => ({ status: "failed", error: new Error("unreachable") }) },
      interlock: retiring, journal: page.journal,
      reauthorize: reauthorizeAsSealed, // B16.0.1 §F
      stillCurrent: () => true,
      currentProjectId: PROJECT.projectId, currentBranchId: PROJECT.branchId,
      now: () => SEAL_NOW + 5_000, registry: new ApprovedMutationRegistry(), audit: new ApprovedMutationAuditLedger(),
    });
    expect(!duringTransition.ok && duringTransition.code === "session-superseded").toBe(true);
    expect(JSON.stringify(duringTransition)).not.toContain("amr-");
    if (lease.ok) lease.lease.release();
    expect(await txCount(store)).toBe(1);
  });
});

describe("B12.3 §C — crash windows are deterministic and fail closed", () => {
  it("window 1: prepared journal record with no canonical commit → a safe retry succeeds while the base is current", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const page = await browser(store, journalStore);
    const proposal = sealFor(page.session, baseState());
    // Crash after prepare, before commit: simulate by preparing directly.
    const prepared = await page.journal.prepare({
      identityKey: approvedMutationIdentityKey(proposal)!,
      proposalId: proposal.proposalId,
      operationsDigest: proposal.operationsDigest,
      tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId,
      lineageId: proposal.scope.headMark.lineageId,
      baseHeadMark: { headSequence: proposal.scope.headMark.headSequence, canonicalStateDigest: proposal.scope.headMark.canonicalStateDigest },
      baseSchematicDigest: proposal.baseSchematicDigest,
      originRunId: null,
      authorization: { ...ENTRY_AUTHORIZATION }, // B16.0.1 §E — matches the sealed binding
      operationCount: 1, destructive: false, preparedAt: SEAL_NOW + 500,
    });
    expect(prepared.ok).toBe(true);
    expect(await txCount(store)).toBe(0);
    // "Reload" and retry: the prepared record is a safe fresh retry.
    const reloaded = await browser(store, journalStore, { projection: baseState(), mark: null as never });
    const retry = await reloaded.apply(proposal);
    expect(retry.ok && retry.status === "committed").toBe(true);
    expect(await txCount(store)).toBe(1);
  });

  it("window 2: canonical commit landed but the journal's committed record was lost → typed recovery-required, never a second transaction", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const page = await browser(store, journalStore);
    const proposal = sealFor(page.session, baseState());
    const outcome = await page.apply(proposal, failingJournal(page.journal, "markCommitted"));
    // In-process: the commit landed but the journal write failed → refused.
    expect(!outcome.ok && outcome.code === "recovery-required").toBe(true);
    expect(await txCount(store)).toBe(1);
    // Reload: prepared journal + exact durable transaction → deterministic
    // recovery-required (the receipt inputs were never recorded) — and
    // NEVER a second transaction.
    const reloaded = await browser(store, journalStore, { projection: baseState(), mark: null as never });
    const replay = await reloaded.apply(proposal);
    expect(!replay.ok && replay.code === "recovery-required").toBe(true);
    expect(JSON.stringify(replay)).not.toContain("amr-");
    expect(await txCount(store)).toBe(1);
    const again = await reloaded.apply(proposal);
    expect(!again.ok && again.code === "recovery-required").toBe(true);
    expect(await txCount(store)).toBe(1);
  });

  it("window 3: commit landed, UI adoption failed → poisoned; reload replay stays identity-poisoned and never re-executes", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const page = await browser(store, journalStore, undefined, PROJECT, true); // history()=null → adoption fails
    const proposal = sealFor(page.session, baseState());
    const outcome = await page.apply(proposal);
    expect(!outcome.ok && outcome.code === "postcondition-failed").toBe(true);
    expect(await txCount(store)).toBe(1);
    const reloaded = await browser(store, journalStore, { projection: baseState(), mark: null as never });
    const replay = await reloaded.apply(proposal);
    expect(!replay.ok && replay.code === "identity-poisoned").toBe(true);
    expect(await txCount(store)).toBe(1);
  });

  it("window 4: adoption completed but receipt persistence was interrupted → the reload deterministically finalizes the ORIGINAL receipt", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const page = await browser(store, journalStore);
    const proposal = sealFor(page.session, baseState());
    const outcome = await page.apply(proposal, failingJournal(page.journal, "finalizeReceipt"));
    expect(!outcome.ok && outcome.code === "recovery-required").toBe(true);
    expect(await txCount(store)).toBe(1);
    // Reload: canonical-committed/adopted journal + exact durable record →
    // deterministic finalization from the durable prepared data.
    const persisted = page.visible();
    const mark = page.session.headMark()!;
    const reloadedA = await browser(store, journalStore, { projection: persisted, mark });
    const replayA = await reloadedA.apply(structuredClone(proposal) as SealedTier1Proposal);
    expect(replayA.ok && replayA.status === "already-applied").toBe(true);
    if (!replayA.ok || replayA.status !== "already-applied") return;
    expect(validateApprovedMutationReceipt(replayA.receipt)).toEqual([]);
    expect(replayA.receipt.transactionId.length).toBeGreaterThan(0);
    // Deterministic: a second reload returns the byte-identical receipt.
    const reloadedB = await browser(store, journalStore, { projection: persisted, mark });
    const replayB = await reloadedB.apply(structuredClone(proposal) as SealedTier1Proposal);
    expect(replayB.ok && replayB.status === "already-applied" && JSON.stringify(replayB.receipt) === JSON.stringify(replayA.receipt)).toBe(true);
    expect(await txCount(store)).toBe(1);
  });

  it("windows 5+6: a finalized receipt replays byte-identically; a LEGACY transaction without a journal answers a truthful receipt-less already-applied", async () => {
    // Window 5 is proven in the R1/R2 reload test above. Window 6:
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const page = await browser(store, journalStore);
    const proposal = sealFor(page.session, baseState());
    const committed = await page.apply(proposal);
    expect(committed.ok).toBe(true);
    // Simulate a LEGACY (pre-journal) world: the durable transaction exists,
    // the journal does not.
    const emptyJournalStore = new InMemoryApprovedMutationJournalStore();
    const reloaded = await browser(store, emptyJournalStore, { projection: page.visible(), mark: page.session.headMark()! });
    const legacy = await reloaded.apply(structuredClone(proposal) as SealedTier1Proposal);
    expect(legacy.ok).toBe(false);
    if (!legacy.ok) {
      expect(legacy.code).toBe("already-applied");
      expect(JSON.stringify(legacy)).not.toContain("amr-"); // no invented receipt
    }
    expect(await txCount(store)).toBe(1); // never re-executed
  });

  it("corrupt/tampered journal entries and journal/canonical disagreement refuse recovery-required; an unavailable store fails closed", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const page = await browser(store, journalStore);
    const proposal = sealFor(page.session, baseState());
    const committed = await page.apply(proposal);
    expect(committed.ok).toBe(true);
    const raw = await journalStore.load(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId) as { schema: string; entries: Array<Record<string, unknown>> };

    // (a) TAMPERED entry (integrity broken) → corrupt → recovery-required.
    const tampered = structuredClone(raw);
    tampered.entries[0]!.transactionId = "txn-forged";
    journalStore.unsafeSetRaw(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId, tampered);
    const reloadedA = await browser(store, journalStore, { projection: page.visible(), mark: page.session.headMark()! });
    const corrupt = await reloadedA.apply(structuredClone(proposal) as SealedTier1Proposal);
    expect(!corrupt.ok && corrupt.code === "recovery-required").toBe(true);
    expect(JSON.stringify(corrupt)).not.toContain("amr-");

    // (b) DISAGREEMENT (valid integrity, wrong transaction id) → recovery-required.
    const disagreeing = structuredClone(raw);
    const entry = disagreeing.entries[0]!;
    entry.transactionId = "txn-someone-else";
    const body = { ...entry };
    delete body.integrity;
    entry.integrity = engineeringDigest({ schema: APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA, body });
    journalStore.unsafeSetRaw(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId, disagreeing);
    const reloadedB = await browser(store, journalStore, { projection: page.visible(), mark: page.session.headMark()! });
    const disagreement = await reloadedB.apply(structuredClone(proposal) as SealedTier1Proposal);
    expect(!disagreement.ok && disagreement.code === "recovery-required").toBe(true);

    // (c) UNAVAILABLE journal store → recovery-required, nothing executes.
    const unavailableStore: ApprovedMutationJournalStore = {
      load: async () => { throw new Error("storage down"); },
      saveIf: async () => { throw new Error("storage down"); },
    };
    const reloadedC = await browser(store, journalStore, { projection: page.visible(), mark: page.session.headMark()! });
    const unavailable = await reloadedC.apply(structuredClone(proposal) as SealedTier1Proposal,
      new ApprovedMutationJournal(unavailableStore, { ...PROJECT }));
    expect(!unavailable.ok && unavailable.code === "recovery-required").toBe(true);
    expect(await txCount(store)).toBe(1);
    // Sanity: the untampered journal still replays fine.
    journalStore.unsafeSetRaw(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId, raw);
    const reloadedD = await browser(store, journalStore, { projection: page.visible(), mark: page.session.headMark()! });
    const healthy = await reloadedD.apply(structuredClone(proposal) as SealedTier1Proposal);
    expect(healthy.ok && healthy.status === "already-applied").toBe(true);
  });

  it("document sanity: the journal schema constants are pinned", () => {
    expect(APPROVED_MUTATION_JOURNAL_SCHEMA).toBe("sirkit.approved-mutation-journal.v1");
    expect(APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA).toBe("sirkit.approved-mutation-journal-entry.v1");
  });
});
