/**
 * B12.1 §E — production integration: scripted OpenAI-origin and
 * Anthropic-origin proposal flows through the REAL agent loop, the REAL
 * SchematicGestureCoordinator + SchematicHistory composition (the page-host
 * contract), the REAL SchematicEditorSession + durable store, the REAL
 * ProjectCommitInterlock, and the REAL approved-mutation service.
 *
 * No provider credits; deterministic barriers only (no wall-clock sleeps).
 */

import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { assembleAgentRunContext } from "../../agent/context";
import { createAgentToolGateway } from "../../agent/gateway";
import { runAgentLoop } from "../../agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "../../agent/contracts";
import { agentProviderName } from "../../agent/provider-tools";
import { AGENT_SYSTEM_PROMPT } from "../../prompts";
import { sirkitToolRegistry } from "../tool-catalog";
import { InMemoryAtomicProjectStore } from "../persistence";
import { schematicStateDigest } from "../schematic-model";
import { SchematicEditorSession } from "../schematic-session";
import { SchematicGestureCoordinator } from "../schematic-gesture-coordinator";
import { SchematicHistory } from "../../project/schematic-history";
import { adoptCanonicalResult } from "../../project/canonical-adoption";
import { ProjectCommitInterlock } from "../project-commit-interlock";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "../approved-mutation-journal";
import { TIER1_PROPOSAL_SCHEMA, type SealedTier1Proposal } from "../schematic-proposals";
import { UNVERIFIED_MEMBERSHIP_REVISION } from "../proposal-authorization";
import type { MembershipReauthorizer } from "../../project/membership-reauthorization";
import {
  APPROVED_TIER1_APPLY_LABEL,
  ApprovedMutationAuditLedger, ApprovedMutationRegistry,
  applyApprovedTier1Proposal,
} from "../approved-agent-mutations";

const PROJECT_ID = "p-e2e-b121";

// B16.0.1 §E/§F: the production gateway seals under the verified run actor
// ("local-user", unverified revision in this local composition); the stub
// reauthorizer returns the MATCHING live snapshot.
const reauthorizeAsSealed: MembershipReauthorizer = async ({ scope }) => ({
  ok: true, principalId: "local-user", role: "pcb_editor", membershipRevision: UNVERIFIED_MEMBERSHIP_REVISION, scope: { ...scope },
});

const SCHEMATIC: SchematicState = {
  components: [
    { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" },
    { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" },
  ],
  wires: [],
};

class ScriptedProposeAdapter implements ProviderAgentAdapter {
  constructor(readonly provider: "openai" | "anthropic", private readonly argumentsText: string) {}
  private step(text: string, toolCalls: AgentStep["toolCalls"]): AgentStep {
    return { text, toolCalls, stopReason: toolCalls.length > 0 ? "tool_use" : "completed", usage: { inputTokens: 5, outputTokens: 5 }, model: "scripted", continuation: { provider: this.provider, state: null } };
  }
  async start(): Promise<AgentStep> {
    return this.step("", [{ callId: "call-1", providerName: agentProviderName("sirkit.schematic.propose-tier1-edit"), argumentsText: this.argumentsText }]);
  }
  async continueWith(): Promise<AgentStep> {
    return this.step("Proposal is awaiting your review.", []);
  }
}

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
    if (this.armed) { this.signalEntered(); await this.gate; }
    return super.commit(input);
  }
}

/** The production editor composition (page-host contract). */
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
    runHistoryStep: (direction: "undo" | "redo") => coordinator.runHistoryStep({
      direction,
      peek: () => (direction === "undo" ? history.peekUndo() : history.peekRedo()),
      reconcile: (target) => session.reconcileHistoryStep(direction, target),
      commitCursor: () => { if (direction === "undo") history.undo(); else history.redo(); },
      applyUi: () => { visible = structuredClone(history.present); },
    }),
  };
}

interface Production {
  state: SchematicState;
  store: InMemoryAtomicProjectStore;
  editor: SchematicEditorSession;
  ui: ReturnType<typeof editorUi>;
  interlock: ProjectCommitInterlock;
  registry: ApprovedMutationRegistry;
  audit: ApprovedMutationAuditLedger;
  apply(proposal: SealedTier1Proposal, originRunId: string | null): ReturnType<typeof applyApprovedTier1Proposal>;
  retireScope(): void;
}

async function production(store?: InMemoryAtomicProjectStore, projectId: string = PROJECT_ID): Promise<Production> {
  const state = structuredClone(SCHEMATIC);
  const backing = store ?? new InMemoryAtomicProjectStore();
  const editor = new SchematicEditorSession({ tenantId: "local", projectId, branchId: "main" }, { store: backing });
  await editor.openForProject(state, null);
  const ui = editorUi(editor, state);
  const interlock = new ProjectCommitInterlock();
  const registry = new ApprovedMutationRegistry();
  const audit = new ApprovedMutationAuditLedger();
  let current = true;
  return {
    state, store: backing, editor, ui, interlock, registry, audit,
    apply: (proposal, originRunId) => applyApprovedTier1Proposal({
      proposal, session: editor, gateway: ui.coordinator, interlock,
      journal: new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), { tenantId: "local", projectId, branchId: "main" }),
      reauthorize: reauthorizeAsSealed, // B16.0.1 §F
      stillCurrent: () => current,
      currentProjectId: projectId, currentBranchId: "main",
      originRunId, registry, audit,
    }),
    retireScope: () => { current = false; },
  };
}

/** Drive the PRODUCTION loop; capture the sealed proposal from the
 *  production `proposal_ready` event. */
async function runToProposal(provider: "openai" | "anthropic", production: Production): Promise<{ proposal: SealedTier1Proposal; runId: string }> {
  const registry = sirkitToolRegistry();
  const assembly = assembleAgentRunContext({
    tenantId: "local", projectId: PROJECT_ID, branchId: "main",
    schematic: production.ui.visible(), schematicHeadMark: production.editor.headMark()!,
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  const events: AgentRunEvent[] = [];
  const argumentsText = JSON.stringify({ ops: [{ op: "set-value", target: "R1", value: "4k7" }] });
  await runAgentLoop(
    { runId: `run-${provider}-b121`, provider, history: [], userMessage: "set R1 to 4k7", budget: DEFAULT_AGENT_BUDGET },
    {
      adapter: new ScriptedProposeAdapter(provider, argumentsText),
      gateway: createAgentToolGateway(registry),
      registry, context: assembly.context, system: AGENT_SYSTEM_PROMPT,
      emit: (event) => events.push(event),
    },
  );
  const ready = events.find((event): event is Extract<AgentRunEvent, { type: "proposal_ready" }> => event.type === "proposal_ready");
  if (!ready) throw new Error("no proposal_ready event: " + JSON.stringify(events.map((event) => event.type)));
  // B16.0.1: compare against the imported CURRENT schema constant, never a literal.
  if (ready.proposal.schema !== TIER1_PROPOSAL_SCHEMA) throw new Error("expected a Tier-1 proposal");
  return { proposal: ready.proposal, runId: ready.runId };
}

async function storeHead(store: InMemoryAtomicProjectStore): Promise<number> {
  const envelope = await store.load(PROJECT_ID, "main");
  return envelope?.snapshotRevision.headSequence ?? -1;
}

async function settledYet(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  return settled;
}

describe("B12.1 §E — production proposal → approval → adoption → undo, per provider origin", () => {
  for (const provider of ["openai", "anthropic"] as const) {
    it(`(${provider}) full flow: no mutation before Apply; one visible apply; one transaction; one history entry; UI undo; duplicate and altered replays contained`, async () => {
      const p = await production();
      const preDigest = p.ui.visibleDigest();

      // The PRODUCTION loop seals the proposal.
      const { proposal, runId } = await runToProposal(provider, p);
      expect(proposal.scope.projectId).toBe(PROJECT_ID);

      // 1. No mutation before Apply.
      expect(p.ui.visibleDigest()).toBe(preDigest);
      expect(p.editor.headMark()!.headSequence).toBe(0);
      expect(await storeHead(p.store)).toBe(0);
      expect(p.ui.history.view().entries.length).toBe(1);

      // 2. One explicit Apply VISIBLY changes the editor state.
      const outcome = await p.apply(proposal, runId);
      expect(outcome.ok && outcome.status === "committed").toBe(true);
      if (!outcome.ok || outcome.status !== "committed") return;
      expect(p.ui.visible().components.find((component) => component.id === "R1")?.value).toBe("4k7");
      expect(p.ui.visibleDigest()).not.toBe(preDigest);

      // 3. Exactly one durable transaction; 4. exactly one history entry.
      expect(await storeHead(p.store)).toBe(1);
      expect(p.editor.headMark()!.headSequence).toBe(1);
      expect(p.ui.adoptions()).toBe(1);
      expect(p.ui.history.view().entries.length).toBe(2);
      expect(p.ui.history.view().undoLabel).toBe(APPROVED_TIER1_APPLY_LABEL);
      expect(outcome.receipt.originRunId).toBe(runId);

      // 6. Duplicate Apply: no second transaction, no second history entry.
      const duplicate = await p.apply(proposal, runId);
      expect(duplicate.ok && duplicate.status === "already-applied").toBe(true);
      if (duplicate.ok && duplicate.status === "already-applied") {
        // 7. Exact replay returns the ORIGINAL receipt.
        expect(duplicate.receipt.receiptId).toBe(outcome.receipt.receiptId);
      }
      expect(await storeHead(p.store)).toBe(1);
      expect(p.ui.history.view().entries.length).toBe(2);

      // 8. Altered replay is rejected and receives NO receipt.
      const altered = structuredClone(proposal) as unknown as { operations: unknown };
      altered.operations = [{ kind: "set-component-properties", componentId: "R2", properties: { value: "9k9" } }];
      const alteredOutcome = await p.apply(altered as unknown as SealedTier1Proposal, runId);
      expect(alteredOutcome.ok).toBe(false);
      if (!alteredOutcome.ok) expect(alteredOutcome.code).toBe("verification-failed");
      expect(await storeHead(p.store)).toBe(1);

      // 5. The NORMAL UI undo path restores the exact pre-apply digest and
      //    reconciles the durable lineage.
      const undo = await p.ui.runHistoryStep("undo");
      expect(undo.status).toBe("applied");
      expect(p.ui.visibleDigest()).toBe(preDigest);
      expect(p.editor.headMark()!.canonicalStateDigest).toBe(proposal.scope.headMark.canonicalStateDigest);
      expect(p.editor.headMark()!.lineageId).toBe(proposal.scope.headMark.lineageId);
    });
  }

  it("(openai origin) a gesture and an approved Apply cannot interleave", async () => {
    const p = await production();
    const { proposal, runId } = await runToProposal("openai", p);
    expect(p.ui.coordinator.begin()).toBe(true); // the user starts dragging
    const refused = await p.apply(proposal, runId);
    expect(!refused.ok && refused.code === "editor-busy").toBe(true);
    expect(await storeHead(p.store)).toBe(0);
    // And in the other direction: while an apply runs, a gesture cannot begin.
    p.ui.coordinator.cancel();
    const store = p.store; void store;
    const applying = p.apply(proposal, runId);
    // [B12.3] flush the apply's pre-queue durable lookups so it holds the queue.
    for (let index = 0; index < 24; index += 1) await Promise.resolve();
    expect(p.ui.coordinator.begin()).toBe(false); // queue busy — no preview ownership
    const outcome = await applying;
    expect(outcome.ok && outcome.status === "committed").toBe(true);
    expect(await storeHead(p.store)).toBe(1);
    expect(p.ui.history.view().entries.length).toBe(2);
  });

  it("(anthropic origin) transition-before-commit cancels with ZERO transaction; stale proposals die with session replacement", async () => {
    const p = await production();
    const { proposal, runId } = await runToProposal("anthropic", p);
    // The project transition wins first (page order: retire → invalidate →
    // generation advance → session replacement).
    await p.interlock.retire();
    p.ui.coordinator.invalidate();
    p.retireScope();
    const outcome = await p.apply(proposal, runId);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("session-superseded");
    expect(await storeHead(p.store)).toBe(0);
    expect(p.ui.adoptions()).toBe(0);
    // The REPLACEMENT project (a different project id, as a real switch
    // produces) is never touched by the stale proposal: foreign scope.
    const replacement = await production(undefined, `${PROJECT_ID}-next`);
    const replayOnReplacement = await replacement.apply(proposal, runId);
    expect(replayOnReplacement.ok).toBe(false);
    if (!replayOnReplacement.ok) expect(replayOnReplacement.code).toBe("verification-failed");
    const replacementEnvelope = await replacement.store.load(`${PROJECT_ID}-next`, "main");
    expect(replacementEnvelope?.snapshotRevision.headSequence).toBe(0);
    expect(replacement.ui.history.view().entries.length).toBe(1);
  });

  it("(openai origin) apply-lease-before-transition: retirement WAITS for the critical section; the caller is told the truth; the replacement is untouched", async () => {
    const store = new DelayedStore();
    const p = await production(store);
    const { proposal, runId } = await runToProposal("openai", p);
    store.arm();
    const applying = p.apply(proposal, runId);
    await store.entered; // durable commit blocked mid-critical-section
    const retirement = p.interlock.retire();
    expect(await settledYet(retirement)).toBe(false); // the transition WAITS
    store.release();
    const outcome = await applying;
    expect(outcome.ok && outcome.status === "committed").toBe(true);
    expect(await settledYet(retirement)).toBe(true);
    // Retirement proceeds only now; the old project committed AND adopted.
    expect(await storeHead(p.store)).toBe(1);
    expect(p.ui.adoptions()).toBe(1);
    p.ui.coordinator.invalidate();
    p.editor.dispose();
    // The replacement project is never mutated by the (fully settled) apply.
    const replacement = await production();
    expect(await storeHead(replacement.store)).toBe(0);
    expect(replacement.ui.history.view().entries.length).toBe(1);
    expect(replacement.editor.headMark()!.headSequence).toBe(0);
  });
});
