/**
 * B12.1 §B — the project-lifecycle commit interlock (R4 closure).
 *
 * Both race orderings are proven with deterministic barriers (a controllably
 * delayed AtomicProjectStore commit) — no wall-clock sleeps:
 *
 *  1. transition BEFORE the commit critical section → the apply cancels with
 *     ZERO durable transaction;
 *  2. commit/adoption lease BEFORE the transition → `retire()` waits for the
 *     critical section to settle, the caller is told the TRUTH (committed),
 *     and only then does retirement proceed.
 *
 * Plus: a queued apply targeting an obsolete session never runs against the
 * retired project or its replacement, and the replacement is never mutated
 * by late old-project completions.
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
import {
  ApprovedMutationAuditLedger, ApprovedMutationRegistry,
  applyApprovedTier1Proposal, approvedMutationIdentityKey,
} from "../approved-agent-mutations";
import type { SchematicEditOp } from "@/lib/schematic-types";

const SCOPE = { tenantId: "local", projectId: "project-b121-il", branchId: "main" } as const;
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

/** A store whose commit blocks on an explicit gate — the deterministic
 *  barrier for exercising mid-critical-section races. */
class DelayedStore extends InMemoryAtomicProjectStore {
  public entered: Promise<void>;
  public release!: () => void;
  private signalEntered!: () => void;
  private readonly gate: Promise<void>;
  private armed = false;
  constructor() {
    super();
    this.entered = new Promise((resolve) => { this.signalEntered = resolve; });
    this.gate = new Promise((resolve) => { this.release = resolve; });
  }
  arm(): void { this.armed = true; }
  override async commit(input: Parameters<InMemoryAtomicProjectStore["commit"]>[0]): ReturnType<InMemoryAtomicProjectStore["commit"]> {
    if (this.armed) {
      this.signalEntered();
      await this.gate;
    }
    return super.commit(input);
  }
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
    state, compilation, provenance: { provider: "anthropic", note: "n", instruction: "i" }, now: SEAL_NOW, scope,
    authorization: buildAuthorizationBinding({ principalId: TEST_PRINCIPAL, scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId } }),
  });
  if (outcome.kind !== "sealed") throw new Error("seal failed");
  return outcome.proposal;
}

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
  return { coordinator, history, adoptions: () => adoptions, visibleDigest: () => schematicStateDigest(visible) };
}

async function project(store?: InMemoryAtomicProjectStore) {
  const state = baseState();
  const backing = store ?? new InMemoryAtomicProjectStore();
  const editor = new SchematicEditorSession({ ...SCOPE }, { store: backing });
  await editor.openForProject(state, null);
  const ui = editorUi(editor, state);
  const interlock = new ProjectCommitInterlock();
  const journal = new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), { ...SCOPE });
  const registry = new ApprovedMutationRegistry();
  const audit = new ApprovedMutationAuditLedger();
  let tick = SEAL_NOW + 1_000;
  const clock = (): number => { tick += 1_000; return tick; };
  let current = true;
  const apply = (proposal: SealedTier1Proposal) =>
    applyApprovedTier1Proposal({
      proposal, session: editor, gateway: ui.coordinator, interlock,
      journal,
      reauthorize: reauthorizeAsSealed, // B16.0.1 §F
      stillCurrent: () => current,
      currentProjectId: SCOPE.projectId, currentBranchId: SCOPE.branchId,
      now: clock, registry, audit,
    });
  return { state, store: backing, editor, ui, interlock, journal, registry, audit, apply, retireScope: () => { current = false; } };
}

async function storeHead(store: InMemoryAtomicProjectStore): Promise<number> {
  const envelope = await store.load(SCOPE.projectId, SCOPE.branchId);
  return envelope?.snapshotRevision.headSequence ?? -1;
}

/** Deterministic "is this promise settled yet" probe (microtask flushes only). */
async function settledYet(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  return settled;
}

describe("B12.1 §B — ordering 1: transition wins BEFORE the commit critical section", () => {
  it("retirement before submission: the apply refuses with session-superseded and ZERO durable transaction", async () => {
    const p = await project();
    const proposal = sealAgainst(p.editor, p.state);
    await p.interlock.retire();
    const outcome = await p.apply(proposal);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("session-superseded");
    expect(await storeHead(p.store)).toBe(0);
    expect(p.ui.adoptions()).toBe(0);
    // Not consumed and not poisoned — nothing durable happened.
    expect(p.registry.peek(approvedMutationIdentityKey(proposal)!)).toBeNull();
  });

  it("retirement while the apply is QUEUED (page order: retire → invalidate): the apply cancels before execution, zero durable transaction, and never runs against the replacement", async () => {
    const p = await project();
    const proposal = sealAgainst(p.editor, p.state);
    // Occupy the coordinator queue so the apply is pending, not executing.
    let releaseBlocker!: () => void;
    let signalEntered!: () => void;
    const blockerEntered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const blocker = p.ui.coordinator.runCanonicalCommand({
      label: "slow job",
      execute: () => { signalEntered(); return new Promise((resolve) => { releaseBlocker = () => resolve(null); }); },
    });
    const applying = p.apply(proposal);
    await blockerEntered; // the slow job is RUNNING; the apply is queued behind it
    // The page's transition sequence for a lease-free interlock: retire()
    // completes synchronously, THEN the coordinator invalidates and the
    // scope generation advances.
    const retirement = p.interlock.retire();
    expect(await settledYet(retirement)).toBe(true); // no lease held → immediate
    p.ui.coordinator.invalidate();
    p.retireScope();
    releaseBlocker();
    await blocker;
    const outcome = await applying;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("session-superseded");
    // ZERO durable transaction on the retired project; nothing adopted.
    expect(await storeHead(p.store)).toBe(0);
    expect(p.ui.adoptions()).toBe(0);
    expect(p.editor.headMark()!.headSequence).toBe(0);
    // The REPLACEMENT project is untouched by the canceled apply.
    const replacement = await project();
    expect(await storeHead(replacement.store)).toBe(0);
    expect(replacement.ui.history.view().entries.length).toBe(1);
    expect(replacement.editor.headMark()!.headSequence).toBe(0);
  });

  it("hydration/recovery invalidation (no retirement) also cancels a queued apply before execution with zero durable transaction", async () => {
    const p = await project();
    const proposal = sealAgainst(p.editor, p.state);
    let releaseBlocker!: () => void;
    let signalEntered!: () => void;
    const blockerEntered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const blocker = p.ui.coordinator.runCanonicalCommand({
      label: "slow job",
      execute: () => { signalEntered(); return new Promise((resolve) => { releaseBlocker = () => resolve(null); }); },
    });
    const applying = p.apply(proposal);
    await blockerEntered; // the slow job is RUNNING; the apply is queued behind it
    // [B12.3] the apply performs durable journal/evidence lookups BEFORE
    // enqueueing — flush them so the apply is genuinely IN the queue.
    for (let index = 0; index < 24; index += 1) await Promise.resolve();
    p.ui.coordinator.invalidate(); // canonical recovery / session replacement
    releaseBlocker();
    await blocker;
    const outcome = await applying;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("session-superseded");
    expect(await storeHead(p.store)).toBe(0);
    expect(p.registry.peek(approvedMutationIdentityKey(proposal)!)).toBeNull();
  });
});

describe("B12.1 §B/R4 — ordering 2: the commit/adoption lease wins BEFORE the transition", () => {
  it("retire() does NOT settle while the critical section runs; the caller is told the TRUTH (committed + adopted); retirement completes after", async () => {
    const store = new DelayedStore();
    const p = await project(store);
    const proposal = sealAgainst(p.editor, p.state);
    store.arm();
    const applying = p.apply(proposal);
    await store.entered; // the durable commit is blocked mid-critical-section
    expect(p.interlock.busy).toBe(true);
    // The transition begins NOW — it must WAIT.
    const retirement = p.interlock.retire();
    expect(await settledYet(retirement)).toBe(false);
    // New leases are already refused (retirement has begun).
    expect(p.interlock.acquireCommitLease().ok).toBe(false);
    // Release the blocked commit: the critical section completes fully.
    store.release();
    const outcome = await applying;
    // R4 closure: the caller sees the TRUTH — a committed, verified,
    // ADOPTED apply (never "refused" with a durable mutation behind it).
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.status).toBe("committed");
    expect(await storeHead(p.store)).toBe(1);
    expect(p.ui.adoptions()).toBe(1);
    expect(p.ui.history.view().canUndo).toBe(true);
    // Only NOW does retirement settle; the transition may proceed to
    // invalidate/dispose (as hydrateProject does after awaiting).
    expect(await settledYet(retirement)).toBe(true);
    p.ui.coordinator.invalidate();
    p.editor.dispose();
    expect(p.editor.headMark()).toBeNull();
  });

  it("after an awaited retirement, a NEW apply attempt on the retired project refuses with zero further durable effect", async () => {
    const store = new DelayedStore();
    const p = await project(store);
    const first = sealAgainst(p.editor, p.state);
    store.arm();
    const applying = p.apply(first);
    await store.entered;
    const retirement = p.interlock.retire();
    store.release();
    await applying;
    await retirement;
    // The transition disposed the old project (page order).
    p.ui.coordinator.invalidate();
    p.editor.dispose();
    const headAfterRetirement = await storeHead(p.store);
    // A late/straggler apply of a NEW proposal against the retired project:
    const stale = structuredClone(first) as SealedTier1Proposal; // consumed identity
    const replayOutcome = await applyApprovedTier1Proposal({
      proposal: stale, session: p.editor, gateway: p.ui.coordinator, interlock: p.interlock,
      journal: p.journal, reauthorize: reauthorizeAsSealed, stillCurrent: () => true,
      currentProjectId: SCOPE.projectId, currentBranchId: SCOPE.branchId,
      now: () => SEAL_NOW + 10_000, registry: p.registry, audit: p.audit,
    });
    // [B12.2 §B] a RETIRED session can no longer expose the consumed
    // receipt: the replay refuses (no receipt) and creates no new durable
    // transaction on the retired store.
    expect(replayOutcome.ok).toBe(false);
    if (!replayOutcome.ok) expect(replayOutcome.code).toBe("session-not-ready");
    expect(await storeHead(p.store)).toBe(headAfterRetirement);
    // A FRESH artifact (different identity) is refused outright.
    const fresh = { ...structuredClone(first), createdAt: SEAL_NOW + 1 } as Record<string, unknown>;
    const freshOutcome = await applyApprovedTier1Proposal({
      proposal: fresh as unknown as SealedTier1Proposal, session: p.editor, gateway: p.ui.coordinator, interlock: p.interlock,
      journal: p.journal, reauthorize: reauthorizeAsSealed, stillCurrent: () => true,
      currentProjectId: SCOPE.projectId, currentBranchId: SCOPE.branchId,
      now: () => SEAL_NOW + 10_000, registry: p.registry, audit: p.audit,
    });
    expect(freshOutcome.ok).toBe(false);
    expect(await storeHead(p.store)).toBe(headAfterRetirement);
  });
});

describe("B12.1 §B — non-retirement invalidation DURING the commit fails closed into recovery (poison), never a silent durable effect", () => {
  it("recovery invalidation between commit and adoption: caller refused postcondition-failed, identity poisoned, no adoption, no receipt", async () => {
    const store = new DelayedStore();
    const p = await project(store);
    const proposal = sealAgainst(p.editor, p.state);
    store.arm();
    const applying = p.apply(proposal);
    await store.entered;
    // Canonical recovery invalidates the coordinator mid-commit (this path
    // does not retire the interlock — it is not a project transition).
    p.ui.coordinator.invalidate();
    store.release();
    const outcome = await applying;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("postcondition-failed");
    // The durable commit landed (truthfully reported as unverified-adoption,
    // never as success and never as "nothing happened" silently) …
    expect(await storeHead(p.store)).toBe(1);
    // … the editor adopted nothing, and the identity is POISONED so no
    // retry can double-commit.
    expect(p.ui.adoptions()).toBe(0);
    expect(p.registry.peek(approvedMutationIdentityKey(proposal)!)?.state).toBe("poisoned");
    expect(p.audit.read().some((entry) => entry.event === "committed-verified")).toBe(false);
    const retry = await p.apply(proposal);
    expect(!retry.ok && retry.code === "identity-poisoned").toBe(true);
    expect(await storeHead(p.store)).toBe(1);
  });
});

describe("B12.1 §B — the interlock itself", () => {
  it("leases are idempotent to release, retire() is idempotent, and acquisition refuses in retiring AND retired states", async () => {
    const interlock = new ProjectCommitInterlock();
    const a = interlock.acquireCommitLease();
    expect(a.ok).toBe(true);
    const retirement = interlock.retire();
    expect(interlock.retired).toBe(true); // retirement has BEGUN (synchronously)
    const b = interlock.acquireCommitLease();
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe("retiring");
    expect(await settledYet(retirement)).toBe(false);
    if (a.ok) { a.lease.release(); a.lease.release(); }
    expect(await settledYet(retirement)).toBe(true);
    const c = interlock.acquireCommitLease();
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.code).toBe("retired");
    await interlock.retire(); // idempotent
  });
});
