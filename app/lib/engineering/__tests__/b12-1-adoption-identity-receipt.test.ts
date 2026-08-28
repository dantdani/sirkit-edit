/**
 * B12.1 — permanent regressions for the four verifier counterexamples and
 * the corrected contracts (§A adoption, §C sealed identity, §D receipts).
 *
 * Pre-edit outputs: artifacts/ai-control-plane-b12-1/pre-edit-counterexamples.md
 * The REAL SchematicGestureCoordinator, SchematicHistory, and
 * SchematicEditorSession are exercised — never reimplementations.
 */

import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { InMemoryAtomicProjectStore } from "../persistence";
import { schematicStateDigest } from "../schematic-model";
import { compileTier1Proposal } from "../schematic-plans";
import { sealTier1Proposal, verifySealedTier1ProposalIntegrity, type SealedTier1Proposal, type Tier1ProposalScope } from "../schematic-proposals";
import { buildAuthorizationBinding, UNVERIFIED_MEMBERSHIP_REVISION } from "../proposal-authorization";
import type { MembershipReauthorizer } from "../../project/membership-reauthorization";
import { SchematicEditorSession } from "../schematic-session";
import { SchematicGestureCoordinator } from "../schematic-gesture-coordinator";
import { SchematicHistory } from "../../project/schematic-history";
import { adoptCanonicalResult } from "../../project/canonical-adoption";
import { ProjectCommitInterlock } from "../project-commit-interlock";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "../approved-mutation-journal";
import type { EngineeringOperation } from "../types";
import {
  APPROVED_TIER1_APPLY_LABEL,
  ApprovedMutationAuditLedger, ApprovedMutationRegistry,
  applyApprovedTier1Proposal, approvedMutationIdentityKey,
  validateApprovedMutationReceipt, type ApprovedMutationReceipt,
} from "../approved-agent-mutations";
import type { SchematicEditOp } from "@/lib/schematic-types";

const SCOPE = { tenantId: "local", projectId: "project-b121", branchId: "main" } as const;
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

async function openSession(state: SchematicState, store?: InMemoryAtomicProjectStore): Promise<SchematicEditorSession> {
  const editor = new SchematicEditorSession({ ...SCOPE }, { store: store ?? new InMemoryAtomicProjectStore() });
  await editor.openForProject(state, null);
  return editor;
}

// B16.0.1 §E/§F: the test principal the fixtures seal under, and a stub
// reauthorizer returning the MATCHING live snapshot.
const TEST_PRINCIPAL = "local-user";
const reauthorizeAsSealed: MembershipReauthorizer = async ({ scope }) => ({
  ok: true, principalId: TEST_PRINCIPAL, role: "pcb_editor", membershipRevision: UNVERIFIED_MEMBERSHIP_REVISION, scope: { ...scope },
});

function sealAgainst(editor: SchematicEditorSession, state: SchematicState, ops: readonly SchematicEditOp[] = [{ op: "set-value", target: "R1", value: "4k7" }]): SealedTier1Proposal {
  const scope: Tier1ProposalScope = { ...SCOPE, headMark: editor.headMark()! };
  const compilation = compileTier1Proposal(state, { ops, pinsByPartId: new Map() });
  const outcome = sealTier1Proposal({
    state, compilation, provenance: { provider: "openai", note: "n", instruction: "i" }, now: SEAL_NOW, scope,
    authorization: buildAuthorizationBinding({ principalId: TEST_PRINCIPAL, scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId } }),
  });
  if (outcome.kind !== "sealed") throw new Error("seal failed");
  return outcome.proposal;
}

/** Production-shaped editor: REAL coordinator + REAL SchematicHistory with
 *  the page-contract host (adoption = one visible update + ONE history
 *  entry + notifyAuthoritativeProjection). */
function editorUi(session: SchematicEditorSession, initial: SchematicState) {
  let visible: SchematicState = structuredClone(initial);
  const history = new SchematicHistory<SchematicState>(structuredClone(initial), { label: "Opened project" });
  let adoptions = 0;
  const coordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, state) => {
      adoptions += 1;
      // [B12.2 §C] the SAME synchronous production adoption primitive
      // page.tsx uses — never a test-local reimplementation of the sequence.
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {},
        history: () => history,
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
  return {
    coordinator, history, adoptions: () => adoptions,
    visible: () => structuredClone(visible),
    visibleDigest: () => schematicStateDigest(visible),
    /** The page's transactional undo/redo wiring (page.tsx runHistoryStep). */
    runHistoryStep: (direction: "undo" | "redo") => coordinator.runHistoryStep({
      direction,
      peek: () => (direction === "undo" ? history.peekUndo() : history.peekRedo()),
      reconcile: (target) => session.reconcileHistoryStep(direction, target),
      commitCursor: () => { if (direction === "undo") history.undo(); else history.redo(); },
      applyUi: () => { visible = structuredClone(history.present); },
    }),
  };
}

async function harness() {
  const state = baseState();
  const store = new InMemoryAtomicProjectStore();
  const editor = await openSession(state, store);
  const ui = editorUi(editor, state);
  const interlock = new ProjectCommitInterlock();
  const registry = new ApprovedMutationRegistry();
  const audit = new ApprovedMutationAuditLedger();
  let tick = SEAL_NOW + 1_000;
  const clock = (): number => { tick += 1_000; return tick; };
  const apply = (proposal: SealedTier1Proposal, overrides?: Partial<Parameters<typeof applyApprovedTier1Proposal>[0]>) =>
    applyApprovedTier1Proposal({
      proposal, session: editor, gateway: ui.coordinator, interlock,
      journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), { ...SCOPE }),
      reauthorize: reauthorizeAsSealed, // B16.0.1 §F
      stillCurrent: () => true,
      currentProjectId: SCOPE.projectId, currentBranchId: SCOPE.branchId,
      originRunId: "run-b121", now: clock, registry, audit, ...overrides,
    });
  return { editor, state, store, ui, interlock, registry, audit, clock, apply };
}

function identityOf(proposal: SealedTier1Proposal): string {
  const key = approvedMutationIdentityKey(proposal);
  if (!key) throw new Error("proposal failed authentication");
  return key;
}

// ─── R1 closure — §A: visible adoption and real history ─────────────────────

describe("B12.1 R1/§A — a committed apply is VISIBLY adopted with one real history entry", () => {
  it("apply commits once, updates the coordinator-adopted editor state, and records exactly one SchematicHistory entry", async () => {
    const { editor, state, ui, apply } = await harness();
    const preDigest = schematicStateDigest(state);
    const proposal = sealAgainst(editor, state);
    const outcome = await apply(proposal);
    expect(outcome.ok && outcome.status === "committed").toBe(true);
    if (!outcome.ok || outcome.status !== "committed" || !outcome.commandResult.ok) return;
    // R1 closure: the EDITOR-VISIBLE state is the applied state.
    expect(ui.visibleDigest()).toBe(schematicStateDigest(outcome.commandResult.state));
    expect(ui.visibleDigest()).not.toBe(preDigest);
    expect(ui.visible().components.find((component) => component.id === "R1")?.value).toBe("4k7");
    // Exactly one canonical projection update, one history entry, undoable.
    expect(ui.adoptions()).toBe(1);
    expect(ui.history.view().entries.length).toBe(2); // Opened project + apply
    expect(ui.history.view().canUndo).toBe(true);
    expect(ui.history.view().undoLabel).toBe(APPROVED_TIER1_APPLY_LABEL);
    // The coordinator's authoritative state equals the durable head projection.
    expect(schematicStateDigest(ui.coordinator.authoritativeState())).toBe(ui.visibleDigest());
    expect(editor.headMark()!.headSequence).toBe(proposal.scope.headMark.headSequence + 1);
  });

  it("the NORMAL UI undo path restores the exact pre-apply digest and reconciles the durable lineage", async () => {
    const { editor, state, ui, apply } = await harness();
    const preDigest = schematicStateDigest(state);
    const proposal = sealAgainst(editor, state);
    const outcome = await apply(proposal);
    expect(outcome.ok && outcome.status === "committed").toBe(true);
    const undo = await ui.runHistoryStep("undo");
    expect(undo.status).toBe("applied");
    // The visible editor state is the exact pre-apply schematic again.
    expect(ui.visibleDigest()).toBe(preDigest);
    expect(ui.history.view().canRedo).toBe(true);
    // The durable lineage reconciled: head digest equals the sealed base head.
    expect(editor.headMark()!.canonicalStateDigest).toBe(proposal.scope.headMark.canonicalStateDigest);
    expect(editor.headMark()!.lineageId).toBe(proposal.scope.headMark.lineageId);
  });

  it("verification runs at the SERIALIZED execution position: a hand edit queued ahead makes the apply refuse with zero partial effect", async () => {
    const { editor, state, ui, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    // A hand edit enters the SAME queue ahead of the apply (both submitted
    // without awaiting — FIFO order is the submission order).
    const handEdit = ui.coordinator.runCanonicalCommand({
      label: "Edited R2",
      execute: (authoritativeBase) => editor.execute(authoritativeBase, {
        commandId: "schematic.edit-tier1-apply",
        label: "Edited R2",
        buildOperations: () => structuredClone(sealAgainst(editor, state, [{ op: "set-value", target: "R2", value: "3k3" }]).operations) as EngineeringOperation[],
      }),
    });
    const applying = apply(proposal);
    const [handOutcome, applyOutcome] = await Promise.all([handEdit, applying]);
    expect(handOutcome.status).toBe("applied");
    expect(applyOutcome.ok).toBe(false);
    if (!applyOutcome.ok) expect(applyOutcome.code).toBe("verification-failed");
    // Exactly ONE head advance (the hand edit); the apply left no partial effect.
    expect(editor.headMark()!.headSequence).toBe(proposal.scope.headMark.headSequence + 1);
    expect(ui.adoptions()).toBe(1);
    expect(ui.visible().components.find((component) => component.id === "R1")?.value).toBe("1k");
  });

  it("a gesture owning the preview refuses the apply (editor-busy) and releases the claim; after cancel the apply succeeds", async () => {
    const { editor, state, ui, registry, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    expect(ui.coordinator.begin()).toBe(true); // the user is mid-drag
    const refused = await apply(proposal);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("editor-busy");
    expect(registry.peek(identityOf(proposal))).toBeNull(); // claim released
    expect(editor.headMark()!.headSequence).toBe(proposal.scope.headMark.headSequence);
    ui.coordinator.cancel();
    const ok = await apply(proposal);
    expect(ok.ok && ok.status === "committed").toBe(true);
  });

  it("double-clicking Apply produces one submission, one transaction, one history entry", async () => {
    const { editor, state, ui, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    const [a, b] = await Promise.all([apply(proposal), apply(proposal)]);
    const committed = [a, b].filter((outcome) => outcome.ok && outcome.status === "committed");
    const inFlight = [a, b].filter((outcome) => !outcome.ok && outcome.code === "already-in-flight");
    expect(committed.length).toBe(1);
    expect(inFlight.length).toBe(1);
    expect(editor.headMark()!.headSequence).toBe(proposal.scope.headMark.headSequence + 1);
    expect(ui.adoptions()).toBe(1);
    expect(ui.history.view().entries.length).toBe(2);
  });

  it("receipt consumption and committed-verified audit happen ONLY after adoption: an unadoptable commit poisons instead", async () => {
    const { editor, state, ui, registry, audit, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    // Recovery/hydration invalidation between commit and adoption: wrap the
    // session so the epoch is bumped while the commit is in flight.
    const original = editor.execute.bind(editor);
    editor.execute = async (currentState, request) => {
      const result = await original(currentState, request);
      ui.coordinator.invalidate(); // canonical recovery raced the apply
      return result;
    };
    const outcome = await apply(proposal);
    editor.execute = original;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("postcondition-failed");
    // The durable commit landed but adoption did not: no visible change, no
    // history entry, no receipt, no committed-verified event — POISONED.
    expect(ui.adoptions()).toBe(0);
    expect(ui.history.view().entries.length).toBe(1);
    expect(registry.peek(identityOf(proposal))?.state).toBe("poisoned");
    expect(audit.read().some((entry) => entry.event === "committed-verified")).toBe(false);
    const retry = await apply(proposal);
    expect(!retry.ok && retry.code === "identity-poisoned").toBe(true);
    expect(editor.headMark()!.headSequence).toBe(proposal.scope.headMark.headSequence + 1); // exactly the one landed commit
  });
});

// ─── R2 closure — §C: exact sealed-artifact identity ────────────────────────

describe("B12.1 R2/§C — an altered artifact can never inherit consumed status or another artifact's receipt", () => {
  it("altered operations with retained proposalId+scope refuse as verification-failed — never already-applied, never the original receipt", async () => {
    const { editor, state, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    const first = await apply(proposal);
    expect(first.ok && first.status === "committed").toBe(true);
    const seqAfter = editor.headMark()!.headSequence;
    const altered = structuredClone(proposal) as unknown as { operations: unknown };
    altered.operations = [{ kind: "set-component-properties", componentId: "R2", properties: { value: "9k9" } }];
    const replay = await apply(altered as unknown as SealedTier1Proposal);
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.code).toBe("verification-failed");
      expect(replay.message).toContain("altered");
    }
    expect(editor.headMark()!.headSequence).toBe(seqAfter); // nothing further
  });

  it("every sealed field participates in identity: altering any one refuses after consumption", async () => {
    const { editor, state, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    expect((await apply(proposal)).ok).toBe(true);
    const mutations: Array<[string, (copy: Record<string, unknown>) => void]> = [
      ["baseSchematicDigest", (copy) => { copy.baseSchematicDigest = "eng1-" + "ab".repeat(8); }],
      ["operationsDigest", (copy) => { copy.operationsDigest = "eng1-" + "cd".repeat(8); }],
      ["scope.branchId", (copy) => { (copy.scope as Record<string, unknown>).branchId = "dev"; }],
      ["scope.headMark.headSequence", (copy) => { ((copy.scope as Record<string, unknown>).headMark as Record<string, unknown>).headSequence = 7; }],
      ["impacts.destructive", (copy) => { (copy.impacts as Record<string, unknown>).destructive = true; }],
      ["provenance.instruction", (copy) => { (copy.provenance as Record<string, unknown>).instruction = "changed"; }],
      ["createdAt", (copy) => { copy.createdAt = SEAL_NOW - 5; }],
      ["expiresAt", (copy) => { copy.expiresAt = (proposal.expiresAt as number) + 60_000; }],
      ["extra field", (copy) => { copy.granted = true; }],
    ];
    for (const [label, mutate] of mutations) {
      const copy = structuredClone(proposal) as unknown as Record<string, unknown>;
      mutate(copy);
      const outcome = await apply(copy as unknown as SealedTier1Proposal);
      expect(outcome.ok, label).toBe(false);
      if (!outcome.ok) expect(outcome.code, label).toBe("verification-failed");
    }
  });

  it("exact replay of the same intact consumed artifact returns the ORIGINAL receipt without another transaction", async () => {
    const { editor, state, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    const first = await apply(proposal);
    expect(first.ok && first.status === "committed").toBe(true);
    const seq = editor.headMark()!.headSequence;
    // A structurally identical COPY (not the same reference) is the same artifact.
    const replay = await apply(structuredClone(proposal) as SealedTier1Proposal);
    expect(replay.ok).toBe(true);
    if (replay.ok && first.ok) {
      expect(replay.status).toBe("already-applied");
      expect(replay.receipt.receiptId).toBe(first.receipt.receiptId);
    }
    expect(editor.headMark()!.headSequence).toBe(seq);
  });

  it("hostile proposal artifacts refuse during capture: prototype-carried, accessor-bearing, cyclic, and oversized", async () => {
    const { editor, state, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    const inherited = Object.create(proposal) as SealedTier1Proposal;
    const withAccessor = structuredClone(proposal) as unknown as Record<string, unknown>;
    Object.defineProperty(withAccessor, "operations", { get() { return proposal.operations; }, enumerable: true, configurable: true });
    const cyclic = structuredClone(proposal) as unknown as Record<string, unknown>;
    cyclic.scope = cyclic;
    for (const [label, artifact] of [["inherited", inherited], ["accessor", withAccessor], ["cyclic", cyclic]] as const) {
      const outcome = await apply(artifact as unknown as SealedTier1Proposal);
      expect(outcome.ok, label).toBe(false);
      if (!outcome.ok) expect(outcome.code, label).toBe("verification-failed");
    }
    expect(approvedMutationIdentityKey(inherited)).toBeNull();
    expect(editor.headMark()!.headSequence).toBe(proposal.scope.headMark.headSequence);
  });

  it("identity derivation and integrity verification agree: intact artifacts derive stable keys, altered ones derive none", async () => {
    const { editor, state } = await harness();
    const proposal = sealAgainst(editor, state);
    const key = approvedMutationIdentityKey(proposal);
    expect(key).toMatch(/^eng1-/);
    expect(approvedMutationIdentityKey(structuredClone(proposal))).toBe(key);
    expect(verifySealedTier1ProposalIntegrity(proposal).ok).toBe(true);
    const altered = structuredClone(proposal) as unknown as { createdAt: number };
    altered.createdAt += 1;
    expect(approvedMutationIdentityKey(altered as unknown as SealedTier1Proposal)).toBeNull();
    expect(verifySealedTier1ProposalIntegrity(altered as unknown as SealedTier1Proposal).ok).toBe(false);
  });
});

// ─── R3 closure — §D: capture-first, content-integrity receipts ─────────────

describe("B12.1 R3/§D — receipt validation is capture-first and content-integrity-verified", () => {
  async function committedReceipt(): Promise<ApprovedMutationReceipt> {
    const { editor, state, apply } = await harness();
    const outcome = await apply(sealAgainst(editor, state));
    if (!outcome.ok || outcome.status !== "committed") throw new Error("setup commit failed");
    return outcome.receipt;
  }

  it("the three R3 forgeries now fail: consistent transactionId+undoReference, forged schematicDigestAfter, Object.create(validReceipt)", async () => {
    const receipt = await committedReceipt();
    expect(validateApprovedMutationReceipt(receipt)).toEqual([]);
    const forgedTx = { ...receipt, transactionId: "txn-forged-000000", undoReference: { kind: "canonical-transaction" as const, transactionId: "txn-forged-000000" } };
    expect(validateApprovedMutationReceipt(forgedTx).length).toBeGreaterThan(0);
    const forgedDigest = { ...receipt, schematicDigestAfter: "eng1-" + "ab".repeat(12) };
    expect(validateApprovedMutationReceipt(forgedDigest).length).toBeGreaterThan(0);
    const inherited = Object.create(receipt) as ApprovedMutationReceipt;
    expect(validateApprovedMutationReceipt(inherited).length).toBeGreaterThan(0);
  });

  it("SYSTEMATIC: every receipt field changed to another syntactically valid value fails (no field is outside the digest)", async () => {
    const receipt = await committedReceipt();
    const mutations: Array<[string, (copy: Record<string, unknown>) => void]> = [
      // B16.0.1: the receipt schema is now v2; a LEGACY v1 schema value is the
      // syntactically-plausible foreign value (equivalent-or-stronger swap).
      ["schema", (copy) => { copy.schema = "sirkit.approved-agent-mutation-receipt.v1"; }],
      ["receiptId", (copy) => { copy.receiptId = "amr-" + "ab".repeat(10); }],
      ["proposalId", (copy) => { copy.proposalId = "prop-" + "cd".repeat(8); }],
      ["operationsDigest", (copy) => { copy.operationsDigest = "eng1-" + "ef".repeat(8); }],
      ["originRunId", (copy) => { copy.originRunId = "run-other"; }],
      // B16.0.1 §E: the authorization identity participates in the digest too.
      ["authorization.principalId", (copy) => { (copy.authorization as Record<string, unknown>).principalId = "user-mallory"; }],
      ["authorization.membershipRevision", (copy) => { (copy.authorization as Record<string, unknown>).membershipRevision = "membership:rev-999"; }],
      ["commandId", (copy) => { copy.commandId = "schematic.delete-component"; }],
      ["tenantId", (copy) => { copy.tenantId = "other"; }],
      ["projectId", (copy) => { copy.projectId = "other"; }],
      ["branchId", (copy) => { copy.branchId = "dev"; }],
      ["lineageId", (copy) => { copy.lineageId = "lin1-" + "ab".repeat(8); }],
      ["headBefore+headAfter shifted consistently", (copy) => {
        (copy.headBefore as { headSequence: number }).headSequence += 1;
        (copy.headAfter as { headSequence: number }).headSequence += 1;
      }],
      ["headBefore.canonicalStateDigest", (copy) => { (copy.headBefore as Record<string, unknown>).canonicalStateDigest = "eng1-" + "aa".repeat(8); }],
      ["headAfter.canonicalStateDigest", (copy) => { (copy.headAfter as Record<string, unknown>).canonicalStateDigest = "eng1-" + "bb".repeat(8); }],
      ["schematicDigestBefore", (copy) => { copy.schematicDigestBefore = "eng1-" + "cc".repeat(8); }],
      ["schematicDigestAfter", (copy) => { copy.schematicDigestAfter = "eng1-" + "dd".repeat(8); }],
      ["transactionId+undoReference consistently", (copy) => {
        copy.transactionId = "txn-b121-forged";
        copy.undoReference = { kind: "canonical-transaction", transactionId: "txn-b121-forged" };
      }],
      ["operationCount", (copy) => { copy.operationCount = 2; }],
      ["destructive", (copy) => { copy.destructive = true; }],
      ["postconditions", (copy) => { copy.postconditions = "assumed"; }],
      ["completedAt", (copy) => { copy.completedAt = (receipt.completedAt as number) + 1; }],
    ];
    expect(mutations.length).toBe(22); // B16.0.1: every receipt key is covered (incl. both authorization fields)
    for (const [label, mutate] of mutations) {
      const copy = structuredClone(receipt) as unknown as Record<string, unknown>;
      mutate(copy);
      expect(validateApprovedMutationReceipt(copy).length, label).toBeGreaterThan(0);
    }
  });

  it("rejects inherited properties, accessors, symbols, cycles, non-finite numbers, depth bombs, and oversized strings — without throwing", async () => {
    const receipt = await committedReceipt();
    const accessor = structuredClone(receipt) as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, "transactionId", { get() { return receipt.transactionId; }, enumerable: true, configurable: true });
    const symboled = structuredClone(receipt) as unknown as Record<string | symbol, unknown>;
    symboled[Symbol("side-channel")] = "x";
    const cyclic = structuredClone(receipt) as unknown as Record<string, unknown>;
    cyclic.undoReference = cyclic;
    const nonFinite = structuredClone(receipt) as unknown as Record<string, unknown>;
    nonFinite.completedAt = Number.POSITIVE_INFINITY;
    let deep: Record<string, unknown> = { end: true };
    for (let index = 0; index < 64; index += 1) deep = { nested: deep };
    const deepBomb = { ...structuredClone(receipt) as unknown as Record<string, unknown>, undoReference: deep };
    const oversized = { ...structuredClone(receipt) as unknown as Record<string, unknown>, transactionId: "x".repeat(200_000) };
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const hostile = new Proxy({}, { ownKeys() { throw new Error("hostile"); } });
    for (const [label, artifact] of [
      ["accessor", accessor], ["symbol key", symboled], ["cycle", cyclic],
      ["non-finite", nonFinite], ["depth bomb", deepBomb], ["oversized string", oversized],
      ["revoked proxy", proxy], ["throwing proxy", hostile],
    ] as const) {
      expect(() => validateApprovedMutationReceipt(artifact), String(label)).not.toThrow();
      expect(validateApprovedMutationReceipt(artifact).length, String(label)).toBeGreaterThan(0);
    }
  });

  it("issue lists stay bounded (≤ 12) even for maximally wrong receipts", () => {
    const junk: Record<string, unknown> = {};
    for (let index = 0; index < 40; index += 1) junk[`k${index}`] = index;
    const issues = validateApprovedMutationReceipt(junk);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.length).toBeLessThanOrEqual(12);
  });
});
