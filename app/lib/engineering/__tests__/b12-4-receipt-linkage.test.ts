/**
 * B12.4 §A — authoritative receipt linkage (R1 closure).
 *
 * The journal's digests are consistency checksums, not authentication. A
 * persisted receipt is returned only under FULL linkage: proposal-derived
 * fields to the authenticated artifact, transaction/head fields to the
 * canonical durable record, originRunId/completedAt to the chain-protected
 * receipt commitment (transaction provenance.candidateId), and the
 * after-digest re-derived from the live canonical head.
 *
 * Pre-edit counterexample: a checksum-valid modified receipt (completedAt
 * changed, both public digests recomputed) was returned as the
 * "byte-identical original".
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
  APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA,
} from "../approved-mutation-journal";
import { engineeringDigest } from "../stable";
import type { EngineeringOperation } from "../types";
import type { SchematicEditOp } from "@/lib/schematic-types";
import {
  ApprovedMutationAuditLedger, ApprovedMutationRegistry,
  applyApprovedTier1Proposal,
} from "../approved-agent-mutations";

const PROJECT = { tenantId: "local", projectId: "proj-b124a", branchId: "main" } as const;
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

function sealFor(session: SchematicEditorSession, state: SchematicState, ids: { tenantId: string; projectId: string; branchId: string } = PROJECT): SealedTier1Proposal {
  const scope: Tier1ProposalScope = { ...ids, headMark: session.headMark()! };
  const compilation = compileTier1Proposal(state, { ops: [{ op: "set-value", target: "R1", value: "4k7" } as SchematicEditOp], pinsByPartId: new Map() });
  const outcome = sealTier1Proposal({
    state, compilation, provenance: { provider: "openai", note: "n", instruction: "i" }, now: SEAL_NOW, scope,
    authorization: buildAuthorizationBinding({ principalId: TEST_PRINCIPAL, scope: { tenantId: ids.tenantId, projectId: ids.projectId, branchId: ids.branchId } }),
  });
  if (outcome.kind !== "sealed") throw new Error("seal failed");
  return outcome.proposal;
}

async function browser(store: InMemoryAtomicProjectStore, journalStore: InMemoryApprovedMutationJournalStore, opened?: { projection: SchematicState; mark: ReturnType<SchematicEditorSession["headMark"]> }, ids: { tenantId: string; projectId: string; branchId: string } = PROJECT) {
  const initial = opened?.projection ?? baseState();
  const session = new SchematicEditorSession({ ...ids }, { store });
  const hydration = await session.openForProject(structuredClone(initial), opened?.mark ? structuredClone(opened.mark) : null);
  let adopted = initial;
  if (hydration.status === "recovered-canonical") { adopted = hydration.state; session.confirmAdoption(hydration.state); }
  let visible: SchematicState = structuredClone(adopted);
  const history = new SchematicHistory<SchematicState>(structuredClone(adopted), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, state) => {
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {}, history: () => history,
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => structuredClone(authoritative),
        historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {},
      }, label, state);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (state) => { visible = structuredClone(state); },
    execute: (base, request) => session.execute(base, request),
    notify: () => {},
  });
  const registry = new ApprovedMutationRegistry();
  const journal = new ApprovedMutationJournal(journalStore, { ...ids });
  let tick = SEAL_NOW + 1_000;
  return {
    session, registry, journal, visible: () => structuredClone(visible),
    apply: (proposal: SealedTier1Proposal) => applyApprovedTier1Proposal({
      proposal, session, gateway: coordinator, interlock: new ProjectCommitInterlock(),
      journal, reauthorize: reauthorizeAsSealed, stillCurrent: () => true,
      currentProjectId: ids.projectId, currentBranchId: ids.branchId,
      now: () => { tick += 1_000; return tick; }, registry, audit: new ApprovedMutationAuditLedger(),
    }),
  };
}

interface RawJournal { schema: string; version?: number; entries: Array<Record<string, unknown>> }

function resealEntry(entry: Record<string, unknown>): void {
  const body = { ...entry };
  delete body.integrity;
  entry.integrity = engineeringDigest({ schema: APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA, body });
}

function resealReceipt(receipt: Record<string, unknown>): void {
  const body = { ...receipt };
  delete body.receiptId;
  receipt.receiptId = `amr-${engineeringDigest({ schema: "sirkit.approved-mutation-receipt-id.v2", body }).slice(5)}`; // B16.0.1: v2 digest schema
  if (typeof receipt.transactionId === "string") receipt.undoReference = { kind: "canonical-transaction", transactionId: receipt.transactionId };
}

async function committedFixture() {
  const store = new InMemoryAtomicProjectStore();
  const journalStore = new InMemoryApprovedMutationJournalStore();
  const page = await browser(store, journalStore);
  const proposal = sealFor(page.session, baseState());
  const original = await page.apply(proposal);
  if (!original.ok || original.status !== "committed") throw new Error("setup failed");
  const persisted = { projection: page.visible(), mark: page.session.headMark()! };
  page.session.dispose();
  return { store, journalStore, proposal, original, persisted };
}

async function txCount(store: InMemoryAtomicProjectStore): Promise<number> {
  const envelope = await store.load(PROJECT.projectId, PROJECT.branchId);
  return envelope?.transactionLog.length ?? 0;
}

describe("B12.4 §A/R1 — a checksum-valid modified receipt can never be returned as authoritative", () => {
  it("R1 exactly: forged completedAt with recomputed receiptId + entry integrity → recovery-required, no receipt data exposed, one transaction", async () => {
    const { store, journalStore, proposal, persisted } = await committedFixture();
    const raw = await journalStore.load(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId) as RawJournal;
    const entry = raw.entries[0]!;
    const receipt = structuredClone(entry.receipt) as Record<string, unknown>;
    receipt.completedAt = (receipt.completedAt as number) + 999_983;
    resealReceipt(receipt);
    entry.receipt = receipt;
    // Keep the entry COHERENT with the forged receipt (the strongest forgery):
    entry.committedAt = receipt.completedAt;
    resealEntry(entry);
    journalStore.unsafeSetRaw(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId, raw);
    const reloaded = await browser(store, journalStore, persisted);
    const replay = await reloaded.apply(structuredClone(proposal) as SealedTier1Proposal);
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.code).toBe("recovery-required");
      expect(JSON.stringify(replay)).not.toContain("amr-");
    }
    expect(await txCount(store)).toBe(1);
  });

  it("systematic: every material receipt-field forgery (with coherent entry + recomputed checksums) fails closed without a receipt", async () => {
    const mutations: Array<[string, (receipt: Record<string, unknown>, entry: Record<string, unknown>) => void]> = [
      ["originRunId", (receipt, entry) => { receipt.originRunId = "run-forged"; entry.originRunId = "run-forged"; }],
      ["completedAt", (receipt, entry) => { receipt.completedAt = (receipt.completedAt as number) + 7; entry.committedAt = receipt.completedAt; }],
      ["schematicDigestAfter", (receipt, entry) => { receipt.schematicDigestAfter = "eng1-" + "ab".repeat(12); entry.schematicDigestAfter = receipt.schematicDigestAfter; }],
      ["headAfter.canonicalStateDigest", (receipt, entry) => {
        (receipt.headAfter as Record<string, unknown>).canonicalStateDigest = "eng1-" + "cd".repeat(12);
        (entry.headAfter as Record<string, unknown>).canonicalStateDigest = "eng1-" + "cd".repeat(12);
      }],
      ["headAfter.headSequence (+1 both marks)", (receipt, entry) => {
        (receipt.headAfter as Record<string, unknown>).headSequence = 2;
        (entry.headAfter as Record<string, unknown>).headSequence = 2;
      }],
      ["transactionId", (receipt, entry) => { receipt.transactionId = "txn-forged"; entry.transactionId = "txn-forged"; }],
      ["destructive", (receipt, entry) => { receipt.destructive = true; entry.destructive = true; }],
      ["operationCount", (receipt, entry) => { receipt.operationCount = 2; entry.operationCount = 2; }],
      ["schematicDigestBefore", (receipt, entry) => { receipt.schematicDigestBefore = "eng1-" + "ef".repeat(12); entry.baseSchematicDigest = receipt.schematicDigestBefore; }],
      ["headBefore", (receipt, entry) => {
        (receipt.headBefore as Record<string, unknown>).canonicalStateDigest = "eng1-" + "aa".repeat(12);
        (entry.baseHeadMark as Record<string, unknown>).canonicalStateDigest = "eng1-" + "aa".repeat(12);
      }],
      ["lineageId", (receipt, entry) => { receipt.lineageId = "lin1-" + "bb".repeat(12); entry.lineageId = receipt.lineageId; }],
      ["operationsDigest", (receipt, entry) => { receipt.operationsDigest = "eng1-" + "cc".repeat(12); entry.operationsDigest = receipt.operationsDigest; }],
      // B16.0.1 §E — an authorization-identity forgery (receipt AND entry kept
      // coherent) can never surface a receipt: the sealed binding disagrees.
      ["authorization.principalId", (receipt, entry) => {
        (receipt.authorization as Record<string, unknown>).principalId = "user-mallory";
        (entry.authorization as Record<string, unknown>).principalId = "user-mallory";
      }],
      ["authorization.membershipRevision", (receipt, entry) => {
        (receipt.authorization as Record<string, unknown>).membershipRevision = "membership:rev-999";
        (entry.authorization as Record<string, unknown>).membershipRevision = "membership:rev-999";
      }],
    ];
    for (const [label, mutate] of mutations) {
      const { store, journalStore, proposal, persisted } = await committedFixture();
      const raw = await journalStore.load(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId) as RawJournal;
      const entry = raw.entries[0]!;
      const receipt = structuredClone(entry.receipt) as Record<string, unknown>;
      mutate(receipt, entry);
      resealReceipt(receipt);
      entry.receipt = receipt;
      resealEntry(entry);
      journalStore.unsafeSetRaw(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId, raw);
      const reloaded = await browser(store, journalStore, persisted);
      const replay = await reloaded.apply(structuredClone(proposal) as SealedTier1Proposal);
      expect(replay.ok, label).toBe(false);
      if (!replay.ok) {
        expect(["recovery-required", "verification-failed"], label).toContain(replay.code);
        expect(JSON.stringify(replay), label).not.toContain("amr-");
      }
      expect(await txCount(store), label).toBe(1);
    }
  });

  it("an INCOHERENT receipt-only forgery (entry untouched) is caught by strict validation as corrupt durable state", async () => {
    const { store, journalStore, proposal, persisted } = await committedFixture();
    const raw = await journalStore.load(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId) as RawJournal;
    const entry = raw.entries[0]!;
    const receipt = structuredClone(entry.receipt) as Record<string, unknown>;
    receipt.completedAt = (receipt.completedAt as number) + 7; // entry.committedAt NOT updated
    resealReceipt(receipt);
    entry.receipt = receipt;
    resealEntry(entry);
    journalStore.unsafeSetRaw(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId, raw);
    const reloaded = await browser(store, journalStore, persisted);
    const replay = await reloaded.apply(structuredClone(proposal) as SealedTier1Proposal);
    expect(!replay.ok && replay.code === "recovery-required").toBe(true);
  });

  it("HEALTHY exact reload replay still returns the byte-identical authoritative receipt with exactly one transaction", async () => {
    const { store, journalStore, proposal, original, persisted } = await committedFixture();
    if (!original.ok || original.status !== "committed") return;
    const reloaded = await browser(store, journalStore, persisted);
    const replay = await reloaded.apply(structuredClone(proposal) as SealedTier1Proposal);
    expect(replay.ok && replay.status === "already-applied").toBe(true);
    if (replay.ok && replay.status === "already-applied") {
      expect(JSON.stringify(replay.receipt)).toBe(JSON.stringify(original.receipt));
    }
    expect(await txCount(store)).toBe(1);
  });

  it("a LEGACY transaction (no chain-protected commitment) can never surface a journal receipt — recovery-required", async () => {
    const store = new InMemoryAtomicProjectStore();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const page = await browser(store, journalStore);
    const proposal = sealFor(page.session, baseState());
    // A pre-B12.4-style commit: exact sealed ops, idempotencyKey=proposalId,
    // NO provenance commitment.
    const result = await page.session.execute(baseState(), {
      commandId: "schematic.edit-tier1-apply", label: "Applied AI edit proposal",
      buildOperations: () => structuredClone(proposal.operations) as unknown as EngineeringOperation[],
      expectedBaseDigest: proposal.baseSchematicDigest,
      expectedHeadMark: proposal.scope.headMark,
      idempotencyKey: proposal.proposalId,
    });
    if (!result.ok || result.status !== "executed") throw new Error("legacy setup failed");
    // A B12.3-era journal entry claiming a finalized receipt for it.
    const identityKey = (await import("../approved-agent-mutations")).approvedMutationIdentityKey(proposal)!;
    const headAfter = page.session.headMark()!;
    const schematicDigestAfter = page.session.headProjectionDigest()!;
    const receipt: Record<string, unknown> = {
      // B16.0.1: shaped as a CURRENT v2 receipt (with authorization) so the
      // refusal below is proven to come from the MISSING chain-protected
      // commitment on the legacy transaction, not from shape validation.
      schema: "sirkit.approved-agent-mutation-receipt.v2", receiptId: "",
      proposalId: proposal.proposalId, operationsDigest: proposal.operationsDigest,
      originRunId: null, authorization: { ...ENTRY_AUTHORIZATION }, commandId: "schematic.edit-tier1-apply",
      tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId,
      lineageId: proposal.scope.headMark.lineageId,
      headBefore: { headSequence: proposal.scope.headMark.headSequence, canonicalStateDigest: proposal.scope.headMark.canonicalStateDigest },
      headAfter: { headSequence: headAfter.headSequence, canonicalStateDigest: headAfter.canonicalStateDigest },
      schematicDigestBefore: proposal.baseSchematicDigest, schematicDigestAfter,
      transactionId: result.transactionId!, operationCount: 1, destructive: false,
      postconditions: "verified", undoReference: { kind: "canonical-transaction", transactionId: result.transactionId! },
      completedAt: SEAL_NOW + 500,
    };
    resealReceipt(receipt);
    const entry: Record<string, unknown> = {
      schema: APPROVED_MUTATION_JOURNAL_ENTRY_SCHEMA, identityKey,
      proposalId: proposal.proposalId, clientOperationId: proposal.proposalId,
      operationsDigest: proposal.operationsDigest,
      tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId,
      lineageId: proposal.scope.headMark.lineageId,
      baseHeadMark: { headSequence: proposal.scope.headMark.headSequence, canonicalStateDigest: proposal.scope.headMark.canonicalStateDigest },
      baseSchematicDigest: proposal.baseSchematicDigest,
      originRunId: null, authorization: { ...ENTRY_AUTHORIZATION }, operationCount: 1, destructive: false, preparedAt: SEAL_NOW + 400,
      state: "receipt-finalized",
      committedAt: SEAL_NOW + 500, transactionId: result.transactionId!,
      revisionBefore: null, revisionAfter: null,
      headAfter: { headSequence: headAfter.headSequence, canonicalStateDigest: headAfter.canonicalStateDigest },
      schematicDigestAfter, receipt,
    };
    resealEntry(entry);
    journalStore.unsafeSetRaw(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId, { schema: "sirkit.approved-mutation-journal.v1", version: 1, entries: [entry] });
    // Persist the POST-COMMIT projection (as production autosave would).
    const persisted = { projection: structuredClone(result.state), mark: page.session.headMark()! };
    page.session.dispose();
    const reloaded = await browser(store, journalStore, persisted);
    const replay = await reloaded.apply(structuredClone(proposal) as SealedTier1Proposal);
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.code).toBe("recovery-required");
      expect(JSON.stringify(replay)).not.toContain("amr-");
    }
    expect(await txCount(store)).toBe(1);
  });

  it("a CROSS-SCOPE substituted receipt (planted into another project's journal) fails closed as corrupt", async () => {
    const { journalStore } = await committedFixture();
    // Plant project A's (valid) journal document under project B's key.
    const rawA = await journalStore.load(PROJECT.tenantId, PROJECT.projectId, PROJECT.branchId) as RawJournal;
    const idsB = { tenantId: "local", projectId: "proj-b124a-other", branchId: "main" };
    journalStore.unsafeSetRaw(idsB.tenantId, idsB.projectId, idsB.branchId, rawA);
    const journalB = new ApprovedMutationJournal(journalStore, idsB);
    const lookup = await journalB.lookup((rawA.entries[0]!).identityKey as string);
    expect(lookup.kind).toBe("corrupt"); // scope-vs-instance mismatch
  });
});
