/**
 * B12.2 §C — synchronous production history adoption (R3 closure).
 *
 * The SHARED production primitive (`adoptCanonicalResult` — the exact
 * function page.tsx's `applyCanonicalSchematicProjection` calls) is driven
 * through the real coordinator + session + service. The pre-edit
 * counterexample: receipts were consumed and leases released while the real
 * `SchematicHistory` entry was still 350 ms away in the page's debounce
 * watcher.
 *
 * The watcher below is simulated FAITHFULLY (the page's suppression flag +
 * 350 ms debounce, fake timers) to prove no duplicate entry is ever
 * recorded.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicEditOp, SchematicState } from "@/lib/schematic-types";
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
import { ProjectTransitionCoordinator } from "../project-transition-coordinator";
import type { EngineeringOperation } from "../types";
import {
  APPROVED_TIER1_APPLY_LABEL,
  ApprovedMutationAuditLedger, ApprovedMutationRegistry,
  applyApprovedTier1Proposal, approvedMutationIdentityKey,
} from "../approved-agent-mutations";

const PROJECT = { tenantId: "local", projectId: "proj-sync", branchId: "main" } as const;
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
const reauthorizeAsSealed: MembershipReauthorizer = async ({ scope }) => ({
  ok: true, principalId: TEST_PRINCIPAL, role: "pcb_editor", membershipRevision: UNVERIFIED_MEMBERSHIP_REVISION, scope: { ...scope },
});

function sealFor(session: SchematicEditorSession, state: SchematicState, ops: readonly SchematicEditOp[] = [{ op: "set-value", target: "R1", value: "4k7" }]): SealedTier1Proposal {
  const scope: Tier1ProposalScope = { ...PROJECT, headMark: session.headMark()! };
  const compilation = compileTier1Proposal(state, { ops, pinsByPartId: new Map() });
  const outcome = sealTier1Proposal({
    state, compilation, provenance: { provider: "openai", note: "n", instruction: "i" }, now: SEAL_NOW, scope,
    authorization: buildAuthorizationBinding({ principalId: TEST_PRINCIPAL, scope: { tenantId: PROJECT.tenantId, projectId: PROJECT.projectId, branchId: PROJECT.branchId } }),
  });
  if (outcome.kind !== "sealed") throw new Error("seal failed");
  return outcome.proposal;
}

/** The page composition with a FAITHFUL watcher model: the primitive's
 *  suppressEffectRecord sets the page's applying-history flag; the watcher
 *  (simulated after every projection change) honors it exactly as
 *  page.tsx's design-state effect does — clear the flag, schedule autosave,
 *  record NOTHING; otherwise it debounces a record by 350 ms. */
async function pageComposition(failHistory = false) {
  const state = baseState();
  const store = new InMemoryAtomicProjectStore();
  const session = new SchematicEditorSession({ ...PROJECT }, { store });
  await session.openForProject(structuredClone(state), null);
  const events: string[] = [];
  let visible: SchematicState = structuredClone(state);
  const history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "Opened project" });
  const applyingHistoryRef = { current: false };
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  const simulateWatcherPass = (label: string | null): void => {
    if (applyingHistoryRef.current) { applyingHistoryRef.current = false; return; } // the page's guard: no record
    const snap = structuredClone(visible);
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { history.record(label ?? "Edited schematic", snap); events.push("debounce-record"); }, 350);
  };
  const realRecord = history.record.bind(history);
  history.record = (label, next) => { events.push(`history-record:${label}`); realRecord(label, next); };
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: (frame) => { visible = { ...visible, ...frame } as SchematicState; },
    applyCanonicalProjection: (label, next) => {
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => { if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; } },
        history: () => (failHistory ? null : history),
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => structuredClone(authoritative),
        historyRecorded: () => {},
        suppressEffectRecord: () => { applyingHistoryRef.current = true; },
        scheduleAutosave: () => { events.push("autosave-scheduled"); },
      }, label, next);
      if (!outcome.ok) throw new Error(outcome.detail);
      simulateWatcherPass(label); // the React effect fires after the commit
    },
    applyRollbackProjection: (next) => { visible = structuredClone(next); },
    execute: (base, request) => session.execute(base, request),
    notify: () => {},
  });
  const interlock = new ProjectCommitInterlock();
  const registry = new ApprovedMutationRegistry();
  const audit = new ApprovedMutationAuditLedger();
  const realAuditRecord = audit.record.bind(audit);
  audit.record = (entry) => { events.push(`audit:${entry.event}`); realAuditRecord(entry); };
  const runHistoryStep = (direction: "undo" | "redo") => coordinator.runHistoryStep({
    direction,
    peek: () => (direction === "undo" ? history.peekUndo() : history.peekRedo()),
    reconcile: (target) => session.reconcileHistoryStep(direction, target),
    commitCursor: () => { if (direction === "undo") history.undo(); else history.redo(); },
    applyUi: () => { applyingHistoryRef.current = true; visible = structuredClone(history.present); },
  });
  return {
    state, store, session, history, coordinator, interlock, registry, audit, events, runHistoryStep,
    visibleDigest: () => schematicStateDigest(visible),
    apply: (proposal: SealedTier1Proposal) => applyApprovedTier1Proposal({
      proposal, session, gateway: coordinator, interlock,
      journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), { ...PROJECT }),
      reauthorize: reauthorizeAsSealed, // B16.0.1 §F
      stillCurrent: () => true,
      currentProjectId: PROJECT.projectId, currentBranchId: PROJECT.branchId,
      now: () => SEAL_NOW + 1_000, registry, audit,
    }),
  };
}

describe("B12.2 §C — committed success includes the real history entry synchronously", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("1: the history entry exists BEFORE the committed promise settles, and BEFORE receipt consumption/audit finalization", async () => {
    const page = await pageComposition();
    const proposal = sealFor(page.session, page.state);
    const applying = page.apply(proposal);
    const entriesAtSettlement = applying.then(() => page.history.view().entries.length);
    const outcome = await applying;
    expect(outcome.ok && outcome.status === "committed").toBe(true);
    expect(await entriesAtSettlement).toBe(2); // recorded no later than settlement
    // Ordering: the real history record happened BEFORE committed-verified.
    const recordIndex = page.events.indexOf(`history-record:${APPROVED_TIER1_APPLY_LABEL}`);
    const committedIndex = page.events.indexOf("audit:committed-verified");
    expect(recordIndex).toBeGreaterThanOrEqual(0);
    expect(committedIndex).toBeGreaterThan(recordIndex);
    expect(page.history.view().canUndo).toBe(true);
    expect(page.history.view().undoLabel).toBe(APPROVED_TIER1_APPLY_LABEL);
  });

  it("2: IMMEDIATE undo (no timer advance) restores the exact pre-apply state and reconciles the durable lineage", async () => {
    const page = await pageComposition();
    const preDigest = page.visibleDigest();
    const proposal = sealFor(page.session, page.state);
    const outcome = await page.apply(proposal);
    expect(outcome.ok && outcome.status === "committed").toBe(true);
    const undo = await page.runHistoryStep("undo"); // immediately — no vi.advanceTimersByTime
    expect(undo.status).toBe("applied");
    expect(page.visibleDigest()).toBe(preDigest);
    expect(page.session.headMark()!.canonicalStateDigest).toBe(proposal.scope.headMark.canonicalStateDigest);
    expect(page.session.headMark()!.lineageId).toBe(proposal.scope.headMark.lineageId);
  });

  it("3: React effects/timers produce NO duplicate history entry", async () => {
    const page = await pageComposition();
    const proposal = sealFor(page.session, page.state);
    await page.apply(proposal);
    expect(page.history.view().entries.length).toBe(2);
    vi.advanceTimersByTime(2_000); // flush the watcher debounce window
    expect(page.history.view().entries.length).toBe(2); // no duplicate
    expect(page.events.filter((event) => event === "debounce-record")).toEqual([]);
    expect(page.events.filter((event) => event.startsWith("history-record:")).length).toBe(1);
  });

  it("4: an IMMEDIATE project transition preserves the retired project's committed projection (history/persistence complete)", async () => {
    const persisted = new Map<string, string>();
    let scheduledDigest: (() => string) | null = null;
    const transition = new ProjectTransitionCoordinator({
      beforeInstall: () => { if (scheduledDigest) persisted.set(PROJECT.projectId, scheduledDigest()); },
    });
    // Adopt the transition coordinator's interlock as the page does.
    let installed = false;
    transition.request(() => { installed = true; });
    expect(installed).toBe(true);
    const page = await pageComposition();
    const pageInterlock = transition.currentInterlock()!;
    const proposal = sealFor(page.session, page.state);
    scheduledDigest = () => page.visibleDigest();
    const outcome = await applyApprovedTier1Proposal({
      proposal, session: page.session, gateway: page.coordinator, interlock: pageInterlock,
      journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), { ...PROJECT }),
      reauthorize: reauthorizeAsSealed, // B16.0.1 §F
      stillCurrent: () => true,
      currentProjectId: PROJECT.projectId, currentBranchId: PROJECT.branchId,
      now: () => SEAL_NOW + 1_000, registry: page.registry, audit: page.audit,
    });
    expect(outcome.ok && outcome.status === "committed").toBe(true);
    // Transition IMMEDIATELY after committed success — no timers advanced.
    let next = false;
    transition.request(() => { next = true; });
    expect(next).toBe(true); // no lease held → synchronous install
    // The retiring project's persisted projection is the COMMITTED state,
    // and its history was already complete when the transition began.
    if (outcome.ok && outcome.status === "committed" && outcome.commandResult.ok) {
      expect(persisted.get(PROJECT.projectId)).toBe(schematicStateDigest(outcome.commandResult.state));
    }
    expect(page.history.view().entries.length).toBe(2);
  });

  it("5: synchronous adoption failure after durable commit POISONS the identity and prevents retry", async () => {
    const page = await pageComposition(true); // history() yields null at adoption time
    const proposal = sealFor(page.session, page.state);
    const outcome = await page.apply(proposal);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("postcondition-failed");
    expect(page.registry.peek(approvedMutationIdentityKey(proposal)!)?.state).toBe("poisoned");
    expect(page.audit.read().some((entry) => entry.event === "committed-verified")).toBe(false);
    expect(page.history.view().entries.length).toBe(1); // nothing recorded
    const retry = await page.apply(proposal);
    expect(!retry.ok && retry.code === "identity-poisoned").toBe(true);
    // The durable commit landed exactly once and is truthfully unclaimed.
    const envelope = await page.store.load(PROJECT.projectId, PROJECT.branchId);
    expect(envelope!.snapshotRevision.headSequence).toBe(1);
  });

  it("6: ordinary hand commands and gestures retain their established behavior", async () => {
    const page = await pageComposition();
    // An ordinary canonical command through the SAME adoption path: one entry.
    const gate = await page.coordinator.runCanonicalCommand({
      label: "Edited R2",
      execute: (base) => page.session.execute(base, {
        commandId: "schematic.edit-tier1-apply", label: "Edited R2",
        buildOperations: () => structuredClone(sealFor(page.session, page.state, [{ op: "set-value", target: "R2", value: "3k3" }]).operations) as EngineeringOperation[],
      }),
    });
    expect(gate.status).toBe("applied");
    expect(page.history.view().entries.length).toBe(2);
    expect(page.history.view().undoLabel).toBe("Edited R2");
    vi.advanceTimersByTime(2_000);
    expect(page.history.view().entries.length).toBe(2); // no debounce duplicate
    // A gesture preview records nothing (non-authoritative), and its CANCEL
    // restores the base without touching history.
    expect(page.coordinator.begin()).toBe(true);
    page.coordinator.preview({ components: [] });
    page.coordinator.cancel();
    vi.advanceTimersByTime(2_000);
    expect(page.history.view().entries.length).toBe(2);
  });
});
