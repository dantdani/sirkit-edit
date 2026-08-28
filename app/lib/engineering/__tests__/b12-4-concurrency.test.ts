/**
 * B12.4 §C — concurrency across independent compositions and CAS-versioned
 * journal writes.
 *
 * Two independent store/journal/service compositions (separate tabs or
 * reload contexts) share the SAME durable canonical store and the SAME
 * durable journal store. Concurrent exact application must yield exactly
 * one canonical transaction and must never erase or replace the
 * authoritative finalized receipt.
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
  type ApprovedMutationJournalStore,
} from "../approved-mutation-journal";
import type { SchematicEditOp } from "@/lib/schematic-types";
import {
  ApprovedMutationAuditLedger, ApprovedMutationRegistry,
  applyApprovedTier1Proposal, approvedMutationIdentityKey,
} from "../approved-agent-mutations";

const PROJECT = { tenantId: "local", projectId: "proj-b124c", branchId: "main" } as const;
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

function sealFor(session: SchematicEditorSession, state: SchematicState): SealedTier1Proposal {
  const scope: Tier1ProposalScope = { ...PROJECT, headMark: session.headMark()! };
  const compilation = compileTier1Proposal(state, { ops: [{ op: "set-value", target: "R1", value: "4k7" } as SchematicEditOp], pinsByPartId: new Map() });
  const outcome = sealTier1Proposal({
    state, compilation, provenance: { provider: "openai", note: "n", instruction: "i" }, now: SEAL_NOW, scope,
    authorization: buildAuthorizationBinding({ principalId: TEST_PRINCIPAL, scope: { tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId } }),
  });
  if (outcome.kind !== "sealed") throw new Error("seal failed");
  return outcome.proposal;
}

/** One independent composition (a "tab") over shared durable stores. */
async function tab(store: InMemoryAtomicProjectStore, journalStore: ApprovedMutationJournalStore) {
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
    session, history,
    apply: (proposal: SealedTier1Proposal) => applyApprovedTier1Proposal({
      proposal, session, gateway: coordinator, interlock: new ProjectCommitInterlock(),
      journal, reauthorize: reauthorizeAsSealed, stillCurrent: () => true,
      currentProjectId: PROJECT.projectId, currentBranchId: PROJECT.branchId,
      now: () => { tick += 1_000; return tick; }, registry, audit: new ApprovedMutationAuditLedger(),
    }),
  };
}

describe("B12.4 §C — concurrent independent compositions", () => {
  it("two tabs applying the SAME proposal concurrently: exactly one canonical transaction; the finalized receipt is never erased or replaced", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const tabA = await tab(store, journalStore);
    const tabB = await tab(store, journalStore);
    const proposal = sealFor(tabA.session, baseState());

    const [a, b] = await Promise.all([
      tabA.apply(structuredClone(proposal) as SealedTier1Proposal),
      tabB.apply(structuredClone(proposal) as SealedTier1Proposal),
    ]);
    // Exactly ONE canonical transaction, no matter the interleaving. (The
    // durable store's clientOperationId dedup means a racing tab WITNESSES
    // the same single commit rather than creating a second one.)
    const envelope = await store.load(PROJECT.projectId, PROJECT.branchId);
    expect(envelope!.transactionLog.length).toBe(1);
    // Every outcome is truthful: committed (witnessing THE one transaction),
    // idempotent already-applied, or a typed refusal — never a fabricated
    // receipt and never a receipt disagreement.
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
    // If both tabs witnessed the commit, their receipts are IDENTICAL —
    // the authoritative finalized receipt was never erased or replaced.
    if (committedReceipts.length === 2) expect(committedReceipts[0]).toBe(committedReceipts[1]);
    const identity = approvedMutationIdentityKey(proposal)!;
    const journal = new ApprovedMutationJournal(journalStore, { ...PROJECT });
    const lookup = await journal.lookup(identity);
    expect(lookup.kind).toBe("entry"); // never corrupt, never duplicated
    if (lookup.kind === "entry" && lookup.entry.state === "receipt-finalized" && committedReceipts.length > 0) {
      expect(JSON.stringify(lookup.entry.receipt)).toBe(committedReceipts[0]);
    }
    // A follow-up replay from a THIRD composition converges deterministically
    // on the same single transaction (and the same receipt when finalized).
    const tabC = await tab(store, journalStore);
    const replay = await tabC.apply(structuredClone(proposal) as SealedTier1Proposal);
    const envelopeAfter = await store.load(PROJECT.projectId, PROJECT.branchId);
    expect(envelopeAfter!.transactionLog.length).toBe(1);
    if (replay.ok && replay.status === "already-applied" && committedReceipts.length > 0) {
      expect(JSON.stringify(replay.receipt)).toBe(committedReceipts[0]);
    }
  });

  it("CAS version conflicts are retried; exhausted retries fail closed without corrupting durable state", async () => {
    const journalStore = new InMemoryApprovedMutationJournalStore();
    // A store whose saveIf fails with a version conflict N times.
    let conflicts = 2;
    const conflicted: ApprovedMutationJournalStore = {
      load: journalStore.load.bind(journalStore),
      saveIf: async (tenantId, projectId, branchId, document, expectedVersion) => {
        if (conflicts > 0) { conflicts -= 1; return false; }
        return journalStore.saveIf(tenantId, projectId, branchId, document, expectedVersion);
      },
    };
    const journal = new ApprovedMutationJournal(conflicted, { ...PROJECT });
    const prepared = await journal.prepare({
      identityKey: "eng1-" + "11".repeat(8), proposalId: "prop-" + "22".repeat(8),
      operationsDigest: "eng1-" + "33".repeat(8),
      tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId,
      lineageId: "lin1-" + "44".repeat(8),
      baseHeadMark: { headSequence: 0, canonicalStateDigest: "eng1-" + "55".repeat(8) },
      baseSchematicDigest: "eng1-" + "66".repeat(8),
      originRunId: null, authorization: { ...ENTRY_AUTHORIZATION }, operationCount: 1, destructive: false, preparedAt: SEAL_NOW,
    });
    expect(prepared.ok).toBe(true); // retried past the two conflicts
    // Exhausted retries fail closed:
    let always = true;
    const exhausted: ApprovedMutationJournalStore = {
      load: journalStore.load.bind(journalStore),
      saveIf: async () => { void always; return false; },
    };
    const exhaustedJournal = new ApprovedMutationJournal(exhausted, { ...PROJECT });
    const write = await exhaustedJournal.markCommitted("eng1-" + "11".repeat(8), {
      committedAt: SEAL_NOW + 5, transactionId: "tx-1", revisionBefore: null, revisionAfter: null,
      headAfter: { headSequence: 1, canonicalStateDigest: "eng1-" + "77".repeat(8) }, schematicDigestAfter: "eng1-" + "88".repeat(8),
    });
    expect(!write.ok && write.reason === "conflict").toBe(true);
    // The durable state is untouched (still prepared).
    const after = await journal.lookup("eng1-" + "11".repeat(8));
    expect(after.kind === "entry" && after.entry.state === "prepared").toBe(true);
    always = false;
  });

  it("document versions increase monotonically across writes", async () => {
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const journal = new ApprovedMutationJournal(journalStore, { ...PROJECT });
    await journal.prepare({
      identityKey: "eng1-" + "aa".repeat(8), proposalId: "prop-" + "bb".repeat(8),
      operationsDigest: "eng1-" + "cc".repeat(8),
      tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId,
      lineageId: "lin1-" + "dd".repeat(8),
      baseHeadMark: { headSequence: 0, canonicalStateDigest: "eng1-" + "ee".repeat(8) },
      baseSchematicDigest: "eng1-" + "ff".repeat(8),
      originRunId: null, authorization: { ...ENTRY_AUTHORIZATION }, operationCount: 1, destructive: false, preparedAt: SEAL_NOW,
    });
    const v1 = ((await journalStore.load(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId)) as { version: number }).version;
    await journal.markCommitted("eng1-" + "aa".repeat(8), {
      committedAt: SEAL_NOW + 5, transactionId: "tx-9", revisionBefore: null, revisionAfter: null,
      headAfter: { headSequence: 1, canonicalStateDigest: "eng1-" + "99".repeat(8) }, schematicDigestAfter: "eng1-" + "88".repeat(8),
    });
    const v2 = ((await journalStore.load(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId)) as { version: number }).version;
    expect(v2).toBeGreaterThan(v1);
  });
});
