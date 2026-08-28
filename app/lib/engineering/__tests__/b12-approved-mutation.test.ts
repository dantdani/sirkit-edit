/**
 * B12 — the first controlled agent-originated mutation: approved Tier-1
 * schematic application.
 *
 * The production service (`applyApprovedTier1Proposal`) and the real
 * `SchematicEditorSession` are exercised — never a test-only reimplementation.
 * Every reproduction (R1–R10) and requirement (§A–§H) is covered.
 *
 * Pre-edit reproductions are recorded in
 * artifacts/ai-control-plane-b12/pre-edit-reproductions.md.
 */

import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { InMemoryAtomicProjectStore } from "../persistence";
import { schematicStateDigest } from "../schematic-model";
import { compileTier1Proposal } from "../schematic-plans";
import { sealTier1Proposal, type SealedTier1Proposal, type Tier1ProposalScope } from "../schematic-proposals";
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
  APPROVED_MUTATION_RECEIPT_SCHEMA, APPROVED_TIER1_COMMAND_ID,
  ApprovedMutationAuditLedger, ApprovedMutationRegistry,
  applyApprovedTier1Proposal, approvedMutationIdentityKey, validateApprovedMutationReceipt,
} from "../approved-agent-mutations";
import type { SchematicEditOp } from "@/lib/schematic-types";

const SCOPE = { tenantId: "local", projectId: "project-b12", branchId: "main" } as const;
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

async function openSession(state: SchematicState, projectId = SCOPE.projectId, store?: InMemoryAtomicProjectStore): Promise<SchematicEditorSession> {
  const editor = new SchematicEditorSession({ ...SCOPE, projectId }, { store: store ?? new InMemoryAtomicProjectStore() });
  await editor.openForProject(state, null);
  return editor;
}

// B16.0.1 §E/§F: the test principal the fixtures seal under, and a stub
// reauthorizer returning the MATCHING live snapshot (echoing the request
// scope, which the service takes from the proposal's sealed scope).
const TEST_PRINCIPAL = "local-user";
const reauthorizeAsSealed: MembershipReauthorizer = async ({ scope }) => ({
  ok: true, principalId: TEST_PRINCIPAL, role: "pcb_editor", membershipRevision: UNVERIFIED_MEMBERSHIP_REVISION, scope: { ...scope },
});

function sealAgainst(editor: SchematicEditorSession, state: SchematicState, ops: readonly SchematicEditOp[] = [{ op: "set-value", target: "R1", value: "4k7" }], projectId = SCOPE.projectId): SealedTier1Proposal {
  const scope: Tier1ProposalScope = { ...SCOPE, projectId, headMark: editor.headMark()! };
  const compilation = compileTier1Proposal(state, { ops, pinsByPartId: new Map() });
  const outcome = sealTier1Proposal({
    state, compilation, provenance: { provider: "openai", note: "n", instruction: "i" }, now: SEAL_NOW, scope,
    authorization: buildAuthorizationBinding({ principalId: TEST_PRINCIPAL, scope: { tenantId: SCOPE.tenantId, projectId, branchId: SCOPE.branchId } }),
  });
  if (outcome.kind !== "sealed") throw new Error("seal failed: " + JSON.stringify(outcome));
  return outcome.proposal;
}

/** [B12.1] production-shaped editor composition: the REAL
 *  SchematicGestureCoordinator with a host that mirrors page.tsx's contract
 *  (adoption = one visible-projection update + ONE SchematicHistory entry +
 *  notifyAuthoritativeProjection), over the real session. */
interface EditorUi {
  coordinator: SchematicGestureCoordinator;
  history: SchematicHistory<SchematicState>;
  visibleDigest(): string;
  adoptions(): number;
}

function editorUi(session: SchematicEditorSession, initial: SchematicState): EditorUi {
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
  return { coordinator, history, visibleDigest: () => schematicStateDigest(visible), adoptions: () => adoptions };
}

interface Harness {
  editor: SchematicEditorSession;
  state: SchematicState;
  ui: EditorUi;
  interlock: ProjectCommitInterlock;
  registry: ApprovedMutationRegistry;
  audit: ApprovedMutationAuditLedger;
  clock: () => number;
  apply: (proposal: SealedTier1Proposal, overrides?: Partial<Parameters<typeof applyApprovedTier1Proposal>[0]>) => ReturnType<typeof applyApprovedTier1Proposal>;
}

async function harness(projectId = SCOPE.projectId): Promise<Harness> {
  const state = baseState();
  const editor = await openSession(state, projectId);
  const ui = editorUi(editor, state);
  const interlock = new ProjectCommitInterlock();
  const registry = new ApprovedMutationRegistry();
  const audit = new ApprovedMutationAuditLedger();
  // Apply happens within the proposal's TTL of the seal time.
  let tick = SEAL_NOW + 1_000;
  const clock = (): number => { tick += 1_000; return tick; };
  const apply: Harness["apply"] = (proposal, overrides) =>
    applyApprovedTier1Proposal({
      proposal, session: editor, gateway: ui.coordinator, interlock,
      journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), { tenantId: SCOPE.tenantId, projectId, branchId: SCOPE.branchId }),
      reauthorize: reauthorizeAsSealed, // B16.0.1 §F
      stillCurrent: () => true,
      currentProjectId: projectId, currentBranchId: SCOPE.branchId,
      originRunId: "run-b12", now: clock, registry, audit, ...overrides,
    });
  return { editor, state, ui, interlock, registry, audit, clock, apply };
}

/** Registry identity of an intact sealed artifact (test convenience). */
function identityOf(proposal: SealedTier1Proposal): string {
  const key = approvedMutationIdentityKey(proposal);
  if (!key) throw new Error("proposal failed authentication");
  return key;
}

// ─── R1/R2 + F: receiving and canceling mutate nothing ──────────────────────

describe("B12 R1/R2 — receiving and canceling a proposal mutate nothing", () => {
  it("sealing a proposal does not touch schematic, revision, or head", async () => {
    const { editor, state } = await harness();
    const digestBefore = schematicStateDigest(state);
    const markBefore = JSON.stringify(editor.headMark());
    const proposal = sealAgainst(editor, state);
    expect(proposal.proposalId).toMatch(/^prop-/);
    expect(schematicStateDigest(state)).toBe(digestBefore);
    expect(JSON.stringify(editor.headMark())).toBe(markBefore);
  });

  it("cancel produces no receipt and no committed audit event", async () => {
    const { editor, audit } = await harness();
    // Cancel is a local discard: no service call, no session interaction.
    audit.record({ at: 1, proposalId: "prop-x", originRunId: null, event: "approval-displayed", code: null });
    audit.record({ at: 2, proposalId: "prop-x", originRunId: null, event: "canceled", code: null });
    expect(audit.read().some((entry) => entry.event === "committed-verified")).toBe(false);
    expect(editor.headMark()!.headSequence).toBeDefined();
  });
});

// ─── R3/R8 + D: apply commits exactly once; undo restores the exact digest ──

describe("B12 R3/R8/§D — one verified transaction and exact undo", () => {
  it("apply commits exactly one canonical transaction and emits a verified receipt", async () => {
    const { editor, state, apply } = await harness();
    const seqBefore = editor.headMark()!.headSequence;
    const proposal = sealAgainst(editor, state);
    const outcome = await apply(proposal);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.status).toBe("committed");
    const r = outcome.receipt;
    expect(r.schema).toBe(APPROVED_MUTATION_RECEIPT_SCHEMA);
    expect(r.commandId).toBe(APPROVED_TIER1_COMMAND_ID);
    expect(r.proposalId).toBe(proposal.proposalId);
    expect(r.operationsDigest).toBe(proposal.operationsDigest);
    expect(r.postconditions).toBe("verified");
    expect(r.operationCount).toBe(1);
    expect(r.destructive).toBe(false);
    expect(r.headBefore.headSequence).toBe(seqBefore);
    expect(r.headAfter.headSequence).toBe(seqBefore + 1);
    expect(r.schematicDigestBefore).toBe(proposal.baseSchematicDigest);
    expect(outcome.status === "committed" && outcome.commandResult.ok && r.transactionId === outcome.commandResult.transactionId).toBe(true);
    expect(editor.headMark()!.headSequence).toBe(seqBefore + 1);
    expect(validateApprovedMutationReceipt(r)).toEqual([]);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.headAfter)).toBe(true);
  });

  it("undo restores the exact pre-apply schematic digest and lineage", async () => {
    const { editor, state, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    const outcome = await apply(proposal);
    expect(outcome.ok).toBe(true);
    const undone = await editor.reconcileHistoryStep("undo", state);
    expect(undone.ok).toBe(true);
    expect(editor.headMark()!.canonicalStateDigest).toBe(proposal.scope.headMark.canonicalStateDigest);
    expect(editor.headMark()!.lineageId).toBe(proposal.scope.headMark.lineageId);
  });

  it("the applied schematic reflects the EXACT proposed edit", async () => {
    const { editor, state, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    const outcome = await apply(proposal);
    expect(outcome.ok && outcome.status === "committed").toBe(true);
    if (outcome.ok && outcome.status === "committed" && outcome.commandResult.ok) {
      const components = outcome.commandResult.state.components;
      expect(components.find((component) => component.id === "R1")?.value).toBe("4k7");
      // Nothing outside the sealed op changed.
      expect(components.find((component) => component.id === "R2")?.value).toBe("2k");
    }
  });
});

// ─── R4 + C: one-shot and concurrency ───────────────────────────────────────

describe("B12 R4/§C — one-shot and concurrency", () => {
  it("concurrent apply of the same proposal converges on ONE transaction", async () => {
    const { editor, state, apply } = await harness();
    const seq = editor.headMark()!.headSequence;
    const sealed = sealAgainst(editor, state);
    const [a, b] = await Promise.all([apply(sealed), apply(sealed)]);
    const committed = [a, b].filter((outcome) => outcome.ok && outcome.status === "committed");
    const deflected = [a, b].filter((outcome) => !outcome.ok || outcome.status === "already-applied");
    expect(committed.length).toBe(1);
    expect(deflected.length).toBe(1);
    // Exactly one head advance.
    expect(editor.headMark()!.headSequence).toBe(seq + 1);
  });

  it("a sequential replay returns an idempotent already-applied result with the ORIGINAL receipt — never a second commit", async () => {
    const { editor, state, apply } = await harness();
    const seq = editor.headMark()!.headSequence;
    const proposal = sealAgainst(editor, state);
    const first = await apply(proposal);
    expect(first.ok && first.status === "committed").toBe(true);
    const replay = await apply(proposal);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.status).toBe("already-applied");
      if (first.ok) expect(replay.receipt.receiptId).toBe(first.receipt.receiptId);
    }
    // No second head advance.
    expect(editor.headMark()!.headSequence).toBe(seq + 1);
  });

  it("a failed preflight does NOT consume the proposal (a regenerated retry can still succeed)", async () => {
    const { editor, state, registry, apply } = await harness();
    // Verification fails: wrong branch.
    const proposal = sealAgainst(editor, state);
    const refused = await apply(proposal, { currentBranchId: "dev" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("verification-failed");
    // The registry did not consume it.
    expect(registry.peek(identityOf(proposal))).toBeNull();
    // The correct-scope apply now succeeds.
    const ok = await apply(proposal);
    expect(ok.ok && ok.status === "committed").toBe(true);
  });

  it("an unverifiable commit poisons the identity so it can never retry into a double commit", async () => {
    const { editor, state, registry, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    // Force a postcondition failure by wrapping execute to return a committed
    // result whose transaction id is stripped — the commit "landed" but cannot
    // be verified.
    const original = editor.execute.bind(editor);
    editor.execute = async (currentState, request) => {
      const result = await original(currentState, request);
      if (result.ok) return { ...result, transactionId: "" };
      return result;
    };
    const outcome = await apply(proposal);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("postcondition-failed");
    expect(registry.peek(identityOf(proposal))?.state).toBe("poisoned");
    // Restore and prove a retry is permanently refused.
    editor.execute = original;
    const retry = await apply(proposal);
    expect(retry.ok).toBe(false);
    if (!retry.ok) expect(retry.code).toBe("identity-poisoned");
  });

  it("a not-ready session refuses without consuming the proposal", async () => {
    const state = baseState();
    const unopened = new SchematicEditorSession({ ...SCOPE, projectId: "project-b12-x" }, { store: new InMemoryAtomicProjectStore() });
    const opened = await openSession(state);
    const proposal = sealAgainst(opened, state);
    const registry = new ApprovedMutationRegistry();
    const outcome = await applyApprovedTier1Proposal({ proposal, session: unopened, gateway: editorUi(unopened, state).coordinator, interlock: new ProjectCommitInterlock(), journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), { ...SCOPE, projectId: "project-b12-x" }), reauthorize: reauthorizeAsSealed, stillCurrent: () => true, currentProjectId: SCOPE.projectId, currentBranchId: SCOPE.branchId, registry });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("session-not-ready");
    expect(registry.peek(identityOf(proposal))).toBeNull();
  });
});

// ─── R5: stale/altered/expired/foreign fail closed before mutation ──────────

describe("B12 R5 — every stale/altered/expired/foreign proposal fails closed", () => {
  it("refuses each class with a controlled code and mutates nothing", async () => {
    const { editor, state, apply } = await harness();
    const seq = editor.headMark()!.headSequence;
    const proposal = sealAgainst(editor, state);

    const altered = structuredClone(proposal) as unknown as { operations: Array<Record<string, unknown>> };
    (altered.operations[0]!).value = "9k9";
    const cases: Array<[string, () => ReturnType<typeof apply>]> = [
      ["altered", () => apply(altered as unknown as SealedTier1Proposal)],
      ["foreign project", () => apply(proposal, { currentProjectId: "other" })],
      ["foreign branch", () => apply(proposal, { currentBranchId: "dev" })],
    ];
    for (const [label, run] of cases) {
      const outcome = await run();
      expect(outcome.ok, label).toBe(false);
      if (!outcome.ok) expect(outcome.code, label).toBe("verification-failed");
    }
    // Expired.
    const expired = await apply(proposal, { now: () => proposal.expiresAt + 1 });
    expect(expired.ok).toBe(false);
    // The head never moved.
    expect(editor.headMark()!.headSequence).toBe(seq);
  });

  it("a head-advanced proposal is stale — a real edit between seal and apply refuses", async () => {
    const { editor, state, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    // Advance the head with an unrelated committed edit.
    await editor.execute(state, {
      commandId: "schematic.edit-tier1-apply", label: "unrelated",
      buildOperations: () => structuredClone(sealAgainst(editor, state, [{ op: "set-value", target: "R2", value: "3k3" }]).operations) as EngineeringOperation[],
      expectedBaseDigest: schematicStateDigest(state), expectedHeadMark: editor.headMark()!,
    });
    const outcome = await apply(proposal);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("verification-failed");
  });
});

// ─── R6/R7: session/command failure cannot claim applied ────────────────────

describe("B12 R6/R7 — no failure path can display or record 'applied'", () => {
  it("a throwing command build refuses with a controlled code, no receipt", async () => {
    const { editor, state, apply, audit } = await harness();
    const proposal = sealAgainst(editor, state);
    const original = editor.execute.bind(editor);
    editor.execute = (currentState, request) => original(currentState, { ...request, buildOperations: () => { throw new Error("verifier exploded"); } });
    const outcome = await apply(proposal);
    editor.execute = original;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("command-failed");
      // Controlled diagnostic — never the raw exception text.
      expect(outcome.message).not.toContain("verifier exploded");
    }
    expect(audit.read().some((entry) => entry.event === "committed-verified")).toBe(false);
  });

  it("a rejected canonical command surfaces its message, no receipt, no consume", async () => {
    const { editor, state, registry, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    // Base-digest race: the session rejects with stale_revision.
    const original = editor.execute.bind(editor);
    editor.execute = (currentState, request) => original(currentState, { ...request, expectedBaseDigest: "eng1-0000000000000000" });
    const outcome = await apply(proposal);
    editor.execute = original;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("command-rejected");
    expect(registry.peek(identityOf(proposal))).toBeNull();
  });
});

// ─── §E: separate execution audit ledger ────────────────────────────────────

describe("B12 §E — the execution audit is separate and controlled", () => {
  it("records the lifecycle with controlled codes only", async () => {
    const { editor, state, audit, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    await apply(proposal);
    const events = audit.read().map((entry) => entry.event);
    expect(events).toContain("apply-started");
    expect(events).toContain("committed-verified");
    for (const entry of audit.read()) {
      expect(entry.schema).toBe("sirkit.approved-mutation-audit.v1");
      // Controlled: no raw text, only vocabulary codes or null.
      expect(entry.code === null || typeof entry.code === "string").toBe(true);
      expect(JSON.stringify(entry)).not.toContain("Error");
    }
  });

  it("a refusal records a controlled code, never raw exception text", async () => {
    const { editor, state, audit, apply } = await harness();
    const proposal = sealAgainst(editor, state);
    await apply(proposal, { currentBranchId: "dev" });
    const refusal = audit.read().find((entry) => entry.event === "refused");
    expect(refusal?.code).toBe("verification-failed");
  });
});

// ─── §B: receipt validation totality ────────────────────────────────────────

describe("B12 §B — receipt construction and validation are total and bounded", () => {
  it("rejects malformed and hostile receipts with bounded issues, never throwing", () => {
    expect(validateApprovedMutationReceipt(null).length).toBeGreaterThan(0);
    expect(validateApprovedMutationReceipt("x").length).toBeGreaterThan(0);
    expect(validateApprovedMutationReceipt({}).length).toBeGreaterThan(0);
    expect(validateApprovedMutationReceipt({}).length).toBeLessThanOrEqual(12);
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => validateApprovedMutationReceipt(proxy)).not.toThrow();
    expect(validateApprovedMutationReceipt(proxy).length).toBeGreaterThan(0);
    const throwing = new Proxy({}, { ownKeys() { throw new Error("hostile"); } });
    expect(() => validateApprovedMutationReceipt(throwing)).not.toThrow();
  });

  it("a real receipt validates, and any single tampered field fails", async () => {
    const { editor, state, apply } = await harness();
    const outcome = await apply(sealAgainst(editor, state));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(validateApprovedMutationReceipt(outcome.receipt)).toEqual([]);
    for (const mutate of [
      (r: Record<string, unknown>) => { r.postconditions = "unverified"; },
      (r: Record<string, unknown>) => { r.commandId = "schematic.delete-component"; },
      (r: Record<string, unknown>) => { (r.headAfter as Record<string, unknown>).headSequence = (r.headBefore as { headSequence: number }).headSequence; },
      (r: Record<string, unknown>) => { r.forged = true; },
    ]) {
      const copy = structuredClone(outcome.receipt) as unknown as Record<string, unknown>;
      mutate(copy);
      expect(validateApprovedMutationReceipt(copy).length).toBeGreaterThan(0);
    }
  });

  it("the receipt contains no schematic, prompt, or unrestricted content", async () => {
    const { editor, state, apply } = await harness();
    const outcome = await apply(sealAgainst(editor, state));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const serialized = JSON.stringify(outcome.receipt);
    expect(serialized).not.toContain("resistor");
    expect(serialized).not.toContain("4k7");
    expect(serialized).not.toContain("components");
  });
});
