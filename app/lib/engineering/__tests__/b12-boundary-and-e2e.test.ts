/**
 * B12 §G / §H — the agent/authority boundary and the provider-neutral
 * end-to-end proof.
 *
 * §G proves the provider surface stays exactly eleven read/propose tools, the
 * model cannot call apply, caller-supplied approval fields are refused, the
 * gateway refuses mutate/destructive/release/view classes, and no supported
 * surface can import or construct the trusted interactive channel.
 *
 * §H drives a scripted (paid-provider-free) adapter through the PRODUCTION
 * agent loop to a real sealed `proposal_ready` event, then the PRODUCTION
 * apply service to a verified transaction and exact undo — across both
 * normalized OpenAI and Anthropic tool-call shapes.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import { assembleAgentRunContext } from "../../agent/context";
import { createAgentToolGateway } from "../../agent/gateway";
import { buildRunToolset, runAgentLoop } from "../../agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "../../agent/contracts";
import { agentProviderName } from "../../agent/provider-tools";
import { AGENT_SYSTEM_PROMPT } from "../../prompts";
import { sirkitToolRegistry } from "../tool-catalog";
import { InMemoryAtomicProjectStore } from "../persistence";
import { schematicStateDigest } from "../schematic-model";
import { SchematicEditorSession } from "../schematic-session";
import { SchematicGestureCoordinator } from "../schematic-gesture-coordinator";
import { ProjectCommitInterlock } from "../project-commit-interlock";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "../approved-mutation-journal";
import { SchematicHistory } from "../../project/schematic-history";
import { adoptCanonicalResult } from "../../project/canonical-adoption";
import { TIER1_PROPOSAL_SCHEMA, type SealedTier1Proposal, type Tier1ProposalScope } from "../schematic-proposals";
import { UNVERIFIED_MEMBERSHIP_REVISION } from "../proposal-authorization";
import type { MembershipReauthorizer } from "../../project/membership-reauthorization";
import { applyApprovedTier1Proposal, ApprovedMutationAuditLedger, ApprovedMutationRegistry } from "../approved-agent-mutations";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { AgentTraceRecorder, InMemoryTraceSink } from "../../agent/trace-recorder";
import { POST as CHAT_POST } from "@/app/api/chat/route";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, isAgentExposableDescriptor } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();

// ─── §G: static exposure and the model boundary ─────────────────────────────

describe("B12 §G — the provider surface stays eleven read/propose tools", () => {
  it("static agent exposure is exactly ELEVEN read/propose tools, and apply is not among them", () => {
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    const ids = exposed.map((descriptor) => descriptor.toolId).sort();
    expect(new Set(ids).size).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length); // B15.3: + sirkit.pcb.propose-bounded-edit
    for (const descriptor of exposed) expect(isAgentExposableDescriptor(descriptor), descriptor.toolId).toBe(true);
    expect(ids).not.toContain("schematic.edit-tier1-apply");
    expect(ids).toContain("sirkit.schematic.propose-tier1-edit");
  });

  it("the apply command has NO tool exposure and a destructive tier — never read/propose", () => {
    const applyRecord = ACTION_COVERAGE_REGISTRY.find((record) => record.id === "schematic.edit-tier1-apply");
    expect(applyRecord).toBeDefined();
    expect(applyRecord!.toolExposure).toBe("none");
    expect(applyRecord!.approvalTier).toBe("destructive");
    expect(applyRecord!.kind).toBe("destructive");
  });

  it("no apply/approval descriptor appears in a fresh provider tool declaration set", () => {
    const schematic: SchematicState = {
      components: [{ id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" }],
      wires: [],
    };
    const assembly = assembleAgentRunContext({
      tenantId: "local", projectId: "p", branchId: "main", schematic,
      schematicHeadMark: { lineageId: "lin1-a9e2470c11bd8833", headSequence: 1, canonicalStateDigest: "eng1-77aa66bb55cc44dd" },
    });
    if (!assembly.ok) throw new Error(assembly.reason);
    const { declarations } = buildRunToolset(sirkitToolRegistry(), assembly.context, () => undefined);
    const names = declarations.map((declaration) => declaration.providerName);
    expect(names).toContain(agentProviderName("sirkit.schematic.propose-tier1-edit"));
    for (const declaration of declarations) {
      expect(declaration.toolId).not.toBe("schematic.edit-tier1-apply");
      expect(declaration.toolId).not.toContain("apply");
      expect(declaration.toolId).not.toContain("approv");
    }
    expect(declarations.length).toBeLessThanOrEqual(10);
  });

  it("the agent gateway executes ONLY read/propose classes — a mutate/destructive tool id is refused", async () => {
    const schematic: SchematicState = { components: [{ id: "R1", type: "resistor", x: 0, y: 0, rotation: 0, value: "1k" }], wires: [] };
    const assembly = assembleAgentRunContext({
      tenantId: "local", projectId: "p", branchId: "main", schematic,
      schematicHeadMark: { lineageId: "lin1-a9e2470c11bd8833", headSequence: 1, canonicalStateDigest: "eng1-77aa66bb55cc44dd" },
    });
    if (!assembly.ok) throw new Error(assembly.reason);
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const outcome = await gateway.invoke({
      runId: "r", provider: "openai",
      toolId: "schematic.edit-tier1-apply", version: "1.0.0",
      args: {}, context: assembly.context, timeoutMs: 5_000,
    });
    expect(outcome.kind).toBe("refused");
  });
});

describe("B12 §G — no supported surface can construct the trusted interactive channel", () => {
  it("no API route, agent runtime, tool registry, provider adapter, or approved-mutations service imports the internal channel", () => {
    // The ONLY approved importers are the editor-session composition roots
    // (identical to the B03.2 boundary). B12 adds no importer — the
    // approved-mutations service receives a LIVE session, it never mints one.
    const approvedImporters = new Set([
      "app/lib/engineering/executor.ts",
      "app/lib/engineering/editor-adapter.ts",
      "app/lib/engineering/schematic-session.ts",
      "app/lib/engineering/interactive-channel.internal.ts",
    ]);
    const offenders: string[] = [];
    const scan = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        if (name === "node_modules" || name === ".next" || name === ".git") continue;
        const path = join(directory, name);
        if (statSync(path).isDirectory()) { scan(path); continue; }
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        const rel = relative(ROOT, path).split("\\").join("/");
        const source = readFileSync(path, "utf8");
        const touchesChannel = source.includes("interactive-channel.internal") || source.includes("createEditorSessionChannel");
        if (touchesChannel && !approvedImporters.has(rel)) offenders.push(rel);
      }
    };
    scan(join(ROOT, "app"));
    scan(join(ROOT, "lib"));
    // The agent surface, the chat route, and the approved-mutations service
    // are specifically NOT in the approved set.
    for (const forbidden of ["app/lib/engineering/approved-agent-mutations.ts", "app/api/chat/route.ts", "app/lib/agent/gateway.ts", "app/lib/agent/loop.ts"]) {
      expect(approvedImporters.has(forbidden)).toBe(false);
    }
    expect(offenders).toEqual([]);
  });

  it("the approved-mutations service itself never imports the channel or its factory", () => {
    const source = readFileSync(join(ROOT, "app", "lib", "engineering", "approved-agent-mutations.ts"), "utf8");
    expect(source).not.toContain("interactive-channel");
    expect(source).not.toContain("createEditorSessionChannel");
    expect(source).not.toContain("InteractiveUiChannel");
  });

  it("the engineering barrel does not export the internal channel", () => {
    const barrel = readFileSync(join(ROOT, "app", "lib", "engineering", "index.ts"), "utf8");
    expect(barrel).not.toContain("interactive-channel.internal");
    expect(barrel).not.toContain("InteractiveUiChannel");
  });
});

// ─── R9: caller-supplied approval/authority claims cannot authorize ─────────

describe("B12 R9 — serialized client approval/authority claims are refused by /api/chat", () => {
  const post = (body: unknown): Promise<Response> =>
    CHAT_POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const BASE = { provider: "openai", messages: [{ role: "user", content: "apply the edit" }], scope: { tenantId: "local", projectId: "p", branchId: "main" } };

  it("top-level approval/approved/authority/interactiveChannel claims refuse", async () => {
    for (const claim of [
      { approval: { granted: true } },
      { approved: true },
      { authority: "durable-server-board" },
      { interactiveChannel: "interactive-editor-session" },
      { role: "project_admin" },
      { capabilities: ["mutate"] },
      { idempotencyKey: "k" },
    ]) {
      const response = await post({ ...BASE, ...claim });
      expect(response.status, JSON.stringify(claim)).toBe(400);
    }
  });

  it("nested scope-level approval/interactiveChannel lookalikes refuse", async () => {
    for (const scope of [
      { tenantId: "local", projectId: "p", branchId: "main", approval: { granted: true } },
      { tenantId: "local", projectId: "p", branchId: "main", interactiveChannel: "x" },
      { tenantId: "local", projectId: "p", branchId: "main", approved: true },
    ]) {
      const response = await post({ ...BASE, scope });
      expect(response.status, JSON.stringify(scope)).toBe(400);
    }
  });
});

// ─── R10: the finalized run trace cannot be reopened by later approval ───────

describe("B12 R10 — approval never mutates the finalized run trace", () => {
  it("the trace is deeply frozen and re-finalization returns the same document", () => {
    let tick = 0;
    const recorder = new AgentTraceRecorder(
      { runId: "run-b12", traceId: "trace-b12", provider: "openai", promptVersion: "v", promptDigest: "eng1-p", registryDigest: "eng1-r", scope: { tenantId: "local", projectId: "p", branchId: "main" }, contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null } },
      new InMemoryTraceSink(),
      () => { tick += 1; return tick; },
    );
    recorder.recordRunStarted();
    recorder.recordTerminal("completed", null);
    const trace = recorder.finalize({ outcome: "completed", failureReason: null });
    const eventsBefore = trace.events.length;
    expect(Object.isFrozen(trace)).toBe(true);
    expect(Object.isFrozen(trace.events)).toBe(true);
    expect(() => (trace.events as unknown as unknown[]).push({ forged: true })).toThrow();
    // A post-finalize recorder call (simulating late approval activity) cannot
    // reopen or grow the finalized document.
    recorder.recordWarning("late approval note");
    const again = recorder.finalize({ outcome: "completed", failureReason: null });
    expect(again).toBe(trace);
    expect(trace.events.length).toBe(eventsBefore);
  });
});

// ─── §H: end-to-end, provider-neutral, no paid providers ────────────────────

const SCHEMATIC: SchematicState = {
  components: [
    { id: "R1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k" },
    { id: "R2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k" },
  ],
  wires: [],
};

/**
 * A scripted adapter — no paid provider — that issues one propose tool call
 * on its first turn, then stops. `providerShape` chooses the argument
 * encoding so both normalized OpenAI and Anthropic shapes are exercised.
 */
class ScriptedProposeAdapter implements ProviderAgentAdapter {
  private turn = 0;
  constructor(readonly provider: "openai" | "anthropic", private readonly argumentsText: string) {}
  private step(text: string, toolCalls: AgentStep["toolCalls"]): AgentStep {
    return { text, toolCalls, stopReason: toolCalls.length > 0 ? "tool_use" : "completed", usage: { inputTokens: 5, outputTokens: 5 }, model: "scripted", continuation: { provider: this.provider, state: null } };
  }
  async start(): Promise<AgentStep> {
    this.turn += 1;
    return this.step("", [{ callId: "call-1", providerName: agentProviderName("sirkit.schematic.propose-tier1-edit"), argumentsText: this.argumentsText }]);
  }
  async continueWith(): Promise<AgentStep> {
    return this.step("Proposal is awaiting your review.", []);
  }
}

async function openSession(state: SchematicState): Promise<SchematicEditorSession> {
  const editor = new SchematicEditorSession({ tenantId: "local", projectId: "p-e2e", branchId: "main" }, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(state, null);
  return editor;
}

/** [B12.1] the production-shaped editor composition: the REAL coordinator
 *  with a page-contract host (adoption = one visible update + ONE
 *  SchematicHistory entry) so "the displayed schematic" below is the
 *  coordinator-adopted editor state, not a relabeled command result. */
function editorUi(session: SchematicEditorSession, initial: SchematicState) {
  let visible: SchematicState = structuredClone(initial);
  const history = new SchematicHistory<SchematicState>(structuredClone(initial), { label: "Opened project" });
  const coordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, state) => {
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
  return { coordinator, history, visible: () => structuredClone(visible) };
}

/** Drive the PRODUCTION loop with a live session's head mark; capture the
 *  sealed proposal from the production `proposal_ready` event. */
async function runToProposal(provider: "openai" | "anthropic", editor: SchematicEditorSession, state: SchematicState): Promise<{ proposal: SealedTier1Proposal; runId: string; events: AgentRunEvent[] }> {
  const registry = sirkitToolRegistry();
  const assembly = assembleAgentRunContext({
    tenantId: "local", projectId: "p-e2e", branchId: "main",
    schematic: state, schematicHeadMark: editor.headMark()!,
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  const events: AgentRunEvent[] = [];
  const argumentsText = JSON.stringify({ ops: [{ op: "set-value", target: "R1", value: "4k7" }] });
  await runAgentLoop(
    { runId: "run-e2e", provider, history: [], userMessage: "set R1 to 4k7", budget: DEFAULT_AGENT_BUDGET },
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
  return { proposal: ready.proposal, runId: ready.runId, events };
}

// B16.0.1 §F: the gateway seals under the verified run actor ("local-user",
// unverified revision in this local composition); the stub reauthorizer
// returns the MATCHING live snapshot.
const reauthorizeAsSealed: MembershipReauthorizer = async ({ scope }) => ({
  ok: true, principalId: "local-user", role: "pcb_editor", membershipRevision: UNVERIFIED_MEMBERSHIP_REVISION, scope: { ...scope },
});

describe("B12 §H — proposal → approval → transaction → undo, provider-neutral, no paid providers", () => {
  for (const provider of ["openai", "anthropic"] as const) {
    it(`(${provider}) a scripted run seals a proposal; approval commits once; the exact edit lands; undo restores; nothing mutates before apply`, async () => {
      const state = structuredClone(SCHEMATIC);
      const editor = await openSession(state);
      const digestBeforeAll = schematicStateDigest(state);
      const seqBefore = editor.headMark()!.headSequence;

      // 1. A user prompt produces a valid sealed proposal event.
      const { proposal, runId } = await runToProposal(provider, editor, state);
      expect(proposal.schema).toBe(TIER1_PROPOSAL_SCHEMA); // B16.0.1: the imported CURRENT schema constant
      expect(proposal.operations.length).toBe(1);
      expect(runId).toBe("run-e2e");

      // 2. Before approval, schematic digest and head are unchanged.
      expect(schematicStateDigest(state)).toBe(digestBeforeAll);
      expect(editor.headMark()!.headSequence).toBe(seqBefore);

      // 3. Cancel would leave them unchanged — modeled by simply not applying.
      const registry = new ApprovedMutationRegistry();
      const audit = new ApprovedMutationAuditLedger();
      const scope: Tier1ProposalScope = proposal.scope;
      expect(scope.projectId).toBe("p-e2e");

      // 4. Explicit Apply commits once through the PRODUCTION service AND
      //    the PRODUCTION coordinator adoption path (B12.1 §A).
      const ui = editorUi(editor, state);
      const interlock = new ProjectCommitInterlock();
      const journal = new ApprovedMutationJournal(new InMemoryApprovedMutationJournalStore(), { tenantId: "local", projectId: "p-e2e", branchId: "main" });
      const outcome = await applyApprovedTier1Proposal({
        proposal, session: editor, gateway: ui.coordinator, interlock, journal,
        reauthorize: reauthorizeAsSealed, // B16.0.1 §F
        stillCurrent: () => true,
        currentProjectId: "p-e2e", currentBranchId: "main",
        originRunId: runId, registry, audit,
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.status).toBe("committed");

      // 5. The DISPLAYED (coordinator-adopted) schematic reflects the exact
      //    proposed edit, and exactly one history entry was recorded.
      expect(ui.visible().components.find((component) => component.id === "R1")?.value).toBe("4k7");
      expect(ui.history.view().canUndo).toBe(true);
      expect(ui.history.view().entries.length).toBe(2); // Opened project + the apply
      // 6. A structured receipt identifies the committed transaction, linked to the run.
      expect(outcome.receipt.originRunId).toBe("run-e2e");
      expect(outcome.receipt.transactionId.length).toBeGreaterThan(0);
      expect(outcome.receipt.headAfter.headSequence).toBe(seqBefore + 1);

      // 7. Undo restores the exact original digest.
      const undone = await editor.reconcileHistoryStep("undo", state);
      expect(undone.ok).toBe(true);
      expect(editor.headMark()!.canonicalStateDigest).toBe(proposal.scope.headMark.canonicalStateDigest);

      // A replay of the same proposal never commits twice.
      const replay = await applyApprovedTier1Proposal({
        proposal, session: editor, gateway: ui.coordinator, interlock, journal,
        reauthorize: reauthorizeAsSealed, // B16.0.1 §F
        stillCurrent: () => true,
        currentProjectId: "p-e2e", currentBranchId: "main", registry, audit,
      });
      expect(replay.ok && replay.status === "already-applied").toBe(true);
    });
  }

  it("8/9: normalized OpenAI and Anthropic runs produce equivalent sealed operations, no live provider used", async () => {
    const openaiEditor = await openSession(structuredClone(SCHEMATIC));
    const anthropicEditor = await openSession(structuredClone(SCHEMATIC));
    const a = await runToProposal("openai", openaiEditor, structuredClone(SCHEMATIC));
    const b = await runToProposal("anthropic", anthropicEditor, structuredClone(SCHEMATIC));
    // Provider-neutral: identical scope/base yields identical operations digest.
    expect(a.proposal.operationsDigest).toBe(b.proposal.operationsDigest);
    expect(JSON.stringify(a.proposal.operations)).toBe(JSON.stringify(b.proposal.operations));
  });
});
