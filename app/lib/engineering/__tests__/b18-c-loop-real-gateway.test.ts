/**
 * [B18-C I3] Scenario 1 END TO END in-process, no provider and no HTTP: a
 * scripted adapter drives the REAL agent loop → the REAL gateway dispatch over
 * the production registry → the REAL minter over an in-memory grant store; the
 * page's handler receives the `execution_grant_ready` event through the SAFE
 * receiver and runs the REAL granted-execution ritual over a REAL canonical
 * editor session (durable in-memory canonical store), whose transport answers
 * through the real consume/settle services on the same store. The loop answers
 * the model from the SETTLED durable record only.
 *
 *  - execute_explicit: exactly one transaction, one history entry (actor ai),
 *    the model is told `executed` with the ritual's own transaction/revision;
 *  - the grant is the run's ONE side-effecting artifact: a second move call in
 *    the same run answers execution_exists and nothing else lands;
 *  - proposal_only: the loop answers a preview and changes NOTHING; the human's
 *    Confirm click commits exactly the previewed move through the same session.
 *
 * The agent context is assembled from the LIVE board exactly as the page sends
 * it (a JSON round trip) plus the basis from the session's head metadata, so a
 * divergence between the verified board and the live board would surface here
 * as a stale-revision refusal.
 */
import { describe, expect, it } from "vitest";
import { createHistory } from "../../pcb/history";
import { pcbBoardInstanceId } from "../../pcb/board-identity";
import { DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";
import { mmToNm } from "../../pcb/units";
import type { PcbBoard } from "../../pcb/types";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { ExecutionGrantStore } from "../../execution-grant/store";
import { createExecutionGrantMinter } from "../../execution-grant/mint";
import { consumeExecutionGrant, loadOwnGrant, type ConsumePrincipal } from "../../execution-grant/consume";
import { settleExecutionGrant } from "../../execution-grant/settle";
import type { ExecutionGrantTransport } from "../../project/execution-grant-client";
import { tenderConfirmedExecution, tenderExplicitExecution } from "../../project/granted-execution-controller.internal";
import { receiveExecutionGrantReadyEvent } from "../../project/execution-grant-events";
import { AGENT_AUTONOMY_SCHEMA, type AgentAutonomySetting } from "../permission-tiers";
import type { PublicExecutionGrant } from "../execution-grant";
import { buildExecutionOperations } from "../execution-operations";
import { bindCanonicalEditorSession, canonicalSessionFor } from "../editor-adapter";
import { InMemoryAtomicProjectStore } from "../persistence";
import { ProjectCommitInterlock } from "../project-commit-interlock";
import { AgentExecutionJournal, InMemoryAgentExecutionJournalStore } from "../agent-execution-journal";
import { GrantedExecutionRegistry, type GrantedExecutionOutcome } from "../granted-executions";
import { sirkitToolRegistry } from "../tool-catalog";
import { assembleAgentRunContext } from "../../agent/context";
import { createAgentToolGateway } from "../../agent/gateway";
import { buildRunToolset, runAgentLoop } from "../../agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent, type AgentStep, type AgentToolResult, type ProviderAgentAdapter } from "../../agent/contracts";
import { AGENT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT_VERSION } from "../../prompts";

const PROJECT = "p18l";
const BRANCH = "main";
const SCOPE = { tenantId: "local", projectId: PROJECT, branchId: BRANCH };
const T0 = Date.parse("2026-09-11T12:00:00.000Z");
const MESSAGE = "Move R3 2 mm to the right.";
const PRINCIPAL: ConsumePrincipal = { principalId: "u-1", role: "pcb_editor", membershipRevision: "mbr1-a", sessionIdentity: "sess-1", actorKind: "human" };
const setting = (mode: AgentAutonomySetting["mode"]): AgentAutonomySetting => ({ schema: AGENT_AUTONOMY_SCHEMA, tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, mode, revision: 1, updatedAt: null, updatedBy: null });

function board(): PcbBoard {
  const def = makeResistorDef();
  return makeBoard(40, 30, [makeInstance("r3", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }), makeInstance("r4", def, { x: 30, y: 22 }, { "1": 1, "2": 0 })], 2);
}

interface Core {
  history: ReturnType<typeof bindCanonicalEditorSession>["history"];
  session: NonNullable<ReturnType<typeof canonicalSessionFor>>;
  store: ExecutionGrantStore;
  now: () => number;
  autonomy: AgentAutonomySetting;
  interlock: ProjectCommitInterlock;
  registry: GrantedExecutionRegistry;
  journal: AgentExecutionJournal;
}
type Composed = Core & { transport: ExecutionGrantTransport };

/** The transport double: the REAL consume/settle services over the same store, answering as the routes do. */
function transportOver(c: Core): ExecutionGrantTransport {
  const autonomy = async () => c.autonomy;
  return {
    async get(scope, grantId) {
      const grant = await loadOwnGrant(c.store, scope, PRINCIPAL.principalId, grantId, c.now());
      return grant ? { ok: true, status: 200, body: { grant } } : { ok: false, status: 404, code: "EXECUTION_GRANT_UNKNOWN", message: "Unknown grant.", reason: null, grant: null };
    },
    async tender(scope, body) {
      const outcome = await consumeExecutionGrant({ store: c.store, scope, principal: PRINCIPAL, autonomy, now: c.now(), request: { kind: "tender", ...body } });
      if (outcome.ok && !("cancelled" in outcome)) return { ok: true, status: 200, body: { grant: outcome.grant, consumption: outcome.consumption, idempotent: outcome.idempotent } };
      if (!outcome.ok) return { ok: false, status: outcome.status === "forged" ? 404 : 409, code: `EXECUTION_GRANT_${outcome.status.toUpperCase()}`, message: outcome.message, reason: outcome.reason, grant: outcome.grant };
      throw new Error("unexpected cancel outcome");
    },
    async cancel(scope, body) {
      const outcome = await consumeExecutionGrant({ store: c.store, scope, principal: PRINCIPAL, autonomy, now: c.now(), request: { kind: "cancel", ...body } });
      if (outcome.ok) return { ok: true, status: 200, body: { grant: outcome.grant } };
      return { ok: false, status: outcome.status === "forged" ? 404 : 409, code: `EXECUTION_GRANT_${outcome.status.toUpperCase()}`, message: outcome.message, reason: outcome.reason, grant: outcome.grant };
    },
    async settle(scope, body) {
      const outcome = await settleExecutionGrant({ store: c.store, scope, principalId: PRINCIPAL.principalId, now: c.now(), request: body });
      if (outcome.ok) return { ok: true, status: 200, body: { grant: outcome.grant, idempotent: outcome.idempotent, late: outcome.late } };
      return { ok: false, status: outcome.status === "forged" ? 404 : 409, code: `EXECUTION_GRANT_${outcome.status.toUpperCase()}`, message: outcome.message, reason: null, grant: outcome.grant };
    },
  };
}

async function composition(mode: AgentAutonomySetting["mode"]): Promise<Composed> {
  const raw = createHistory(board());
  const bound = bindCanonicalEditorSession(raw, SCOPE, { durableStore: new InMemoryAtomicProjectStore() });
  const history = bound.history;
  const session = canonicalSessionFor(history)!;
  const r3 = history.committedPresent.footprints.find((f) => f.ref === "R3")!;
  const setupBuilt = buildExecutionOperations(history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: mmToNm(6), y: mmToNm(5) }] });
  if (!setupBuilt.ok) throw new Error(setupBuilt.message);
  const setup = await session.commit({ commandId: "pcb.move-footprint", label: "setup", buildOperations: () => setupBuilt.operations });
  if (!setup.ok || setup.status !== "executed") throw new Error("setup commit must execute");
  // One clock for every party: the frozen fixture epoch advanced by real elapsed time (bounded waits stay bounded).
  const started = Date.now();
  const core: Core = {
    history, session, now: () => T0 + (Date.now() - started), autonomy: setting(mode),
    store: new ExecutionGrantStore(new InMemoryDurableWorkflowRepository()), interlock: new ProjectCommitInterlock(), registry: new GrantedExecutionRegistry(),
    journal: new AgentExecutionJournal(new InMemoryAgentExecutionJournalStore(), { ...SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), editor: "pcb" }),
  };
  return { ...core, transport: transportOver(core) };
}

const headOf = (c: Composed) => c.session.headMetadataFor(c.history.committedPresent)!;
const r3Of = (c: Composed) => c.history.committedPresent.footprints.find((f) => f.ref === "R3")!;
/** What a model reading board-inspect would send: R3's stable id and an absolute target 2 mm to the right. */
const movesBy = (c: Composed, dxMm: number) => JSON.stringify({ moves: [{ footprintId: r3Of(c).id, x: r3Of(c).at.x + mmToNm(dxMm), y: r3Of(c).at.y }] });

/** The page's ritual inputs for a received grant (as PcbEditor supplies them). */
function ritual(c: Composed, grant: PublicExecutionGrant) {
  return {
    grant, history: c.history, interlock: c.interlock, journal: c.journal, transport: c.transport,
    stillCurrent: () => true, currentProjectId: PROJECT, currentBranchId: BRANCH, tenantId: "local", activeDrcPresetId: DEFAULT_PRESET_ID,
    originRunId: "run-1", registry: c.registry, now: c.now, attemptNonce: () => "a".repeat(32),
  };
}

/** The run context from the LIVE board exactly as the page sends it, with the basis from the session's head metadata. */
function runContext(c: Composed) {
  const head = headOf(c);
  const assembly = assembleAgentRunContext({
    ...SCOPE, board: JSON.parse(JSON.stringify(c.history.committedPresent)),
    pcbProposalBasis: { historyHeadSequence: head.headSequence, historyHeadLabel: null, lineageId: head.lineageId, activeDrcPresetId: DEFAULT_PRESET_ID },
    verifiedActor: { principalId: PRINCIPAL.principalId, actorRole: "pcb_editor", membershipRevision: PRINCIPAL.membershipRevision, authMethod: "local_dev" },
    executionGrantsAvailable: true, autonomy: c.autonomy,
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

class FakeAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly continueInputs: Array<readonly AgentToolResult[]> = [];
  private index = 0;
  constructor(private readonly script: Array<() => Partial<AgentStep>>) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "fake", continuation: { provider: "openai", state: null }, ...partial };
  }
  async start(): Promise<AgentStep> { return this.step(this.script[this.index++]!()); }
  async continueWith(input: { results: readonly AgentToolResult[] }): Promise<AgentStep> { this.continueInputs.push(input.results); return this.step(this.script[this.index++]!()); }
}
const call = (callId: string, providerName: string, args: string): AgentStep["toolCalls"][number] => ({ callId, providerName, argumentsText: args });

async function runScenario(c: Composed, script: (moveTool: string) => Array<() => Partial<AgentStep>>) {
  const registry = sirkitToolRegistry();
  const context = runContext(c);
  const move = buildRunToolset(registry, context, () => undefined).declarations.find((d) => d.toolId === "sirkit.pcb.move-footprint");
  if (!move) throw new Error("the lifted move tool must be advertised to a grantable run");
  const minter = createExecutionGrantMinter({
    principalId: PRINCIPAL.principalId, role: "pcb_editor", membershipRevision: PRINCIPAL.membershipRevision, authClass: "local_dev", sessionIdentity: PRINCIPAL.sessionIdentity, correlationId: "corr-1",
    scope: SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), autonomy: c.autonomy, userMessage: MESSAGE, runId: "run-1", provider: "openai", store: c.store, now: c.now,
  });
  const events: AgentRunEvent[] = [];
  const rituals: Array<Promise<GrantedExecutionOutcome>> = [];
  const grants: PublicExecutionGrant[] = [];
  const adapter = new FakeAdapter(script(move.providerName));
  const result = await runAgentLoop(
    { runId: "run-1", provider: "openai", history: [], userMessage: MESSAGE, budget: { ...DEFAULT_AGENT_BUDGET, executionSettlementTimeoutMs: 10_000 } },
    {
      adapter, registry, context, system: AGENT_SYSTEM_PROMPT, executionGrants: minter,
      gateway: createAgentToolGateway(registry, { executionGrants: minter, promptVersion: AGENT_SYSTEM_PROMPT_VERSION }),
      emit: (event) => {
        events.push(event);
        if (event.type !== "execution_grant_ready") return;
        // The page receives the event through the SAFE receiver exactly as the chat stream delivers it.
        const received = receiveExecutionGrantReadyEvent(JSON.parse(JSON.stringify(event)));
        if (!received) throw new Error("the minted grant must be receivable");
        grants.push(received.grant);
        if (event.decision === "execute_explicit") rituals.push(tenderExplicitExecution(ritual(c, received.grant)));
      },
    },
  );
  return { result, events, adapter, grants, rituals: await Promise.all(rituals) };
}

describe("B18-C I3 — scenario 1 end to end: loop → real gateway → real minter → the page ritual over the real canonical session", () => {
  it("execute_explicit: exactly one transaction and one history entry (actor ai); the loop answers `executed` from the SETTLED durable record with the ritual's own transaction and revision", async () => {
    const c = await composition("execute_explicit_tier1");
    const before = headOf(c).headSequence;
    const x0 = r3Of(c).at.x;
    const entries0 = c.history.entries.length;
    const { result, events, adapter, grants, rituals } = await runScenario(c, (move) => [() => ({ toolCalls: [call("c1", move, movesBy(c, 2))] }), () => ({ text: "Moved R3 2 mm to the right." })]);
    expect(result.status).toBe("completed");
    expect(grants).toHaveLength(1);
    expect(rituals).toHaveLength(1);
    const outcome = rituals[0]!;
    expect(outcome).toMatchObject({ ok: true, status: "committed", settled: "settled" });
    if (!outcome.ok) throw new Error("unreachable");
    const answer = JSON.parse(adapter.continueInputs[0]![0]!.outputText) as Record<string, unknown>;
    expect(answer).toMatchObject({ ok: true, status: "executed", grantId: grants[0]!.grantId, transactionId: outcome.receipt.transactionId, revisionAfter: outcome.receipt.pcbRevisionAfter, undoEligible: true });
    expect(headOf(c).headSequence).toBe(before + 1);
    expect(r3Of(c).at.x).toBe(x0 + mmToNm(2));
    expect(c.history.entries.length).toBe(entries0 + 1);
    expect(c.history.entries.at(-1)?.metadata).toMatchObject({ actor: "ai" });
    expect(events.find((event) => event.type === "execution_settled")).toMatchObject({ status: "settled", outcome: "committed" });
    expect((await c.store.load(SCOPE, grants[0]!.grantId, c.now()))!.record.state).toMatchObject({ status: "settled", settlement: { outcome: "committed", transactionId: outcome.receipt.transactionId } });
  }, 30_000);

  it("the grant is the run's ONE side-effecting artifact: a second move call in the same run answers execution_exists; exactly one transaction lands", async () => {
    const c = await composition("execute_explicit_tier1");
    const before = headOf(c).headSequence;
    const first = movesBy(c, 2);
    const second = movesBy(c, 3);
    const { adapter, rituals, grants } = await runScenario(c, (move) => [() => ({ toolCalls: [call("c1", move, first), call("c2", move, second)] }), () => ({ text: "done" })]);
    const answers = adapter.continueInputs[0]!.map((item) => JSON.parse(item.outputText) as Record<string, unknown>);
    expect(answers[0]).toMatchObject({ ok: true, status: "executed" });
    expect(answers[1]).toMatchObject({ ok: false, status: "execution_exists" });
    expect(grants).toHaveLength(1);
    expect(rituals).toHaveLength(1);
    expect(headOf(c).headSequence).toBe(before + 1);
  }, 30_000);

  it("proposal_only: the loop answers a preview and changes NOTHING; the human's Confirm click commits exactly the previewed move through the same session", async () => {
    const c = await composition("proposal_only");
    const before = headOf(c).headSequence;
    const x0 = r3Of(c).at.x;
    const { adapter, rituals, grants, events } = await runScenario(c, (move) => [() => ({ toolCalls: [call("c1", move, movesBy(c, 2))] }), () => ({ text: "Please confirm the move in the editor." })]);
    expect(JSON.parse(adapter.continueInputs[0]![0]!.outputText)).toMatchObject({ ok: true, status: "execution_preview_issued", preview: { before: "R3 at (6.000, 5.000) mm", after: "R3 at (8.000, 5.000) mm" } });
    expect(rituals).toEqual([]);
    expect(events.some((event) => event.type === "execution_settled")).toBe(false);
    expect(headOf(c).headSequence).toBe(before);
    expect(r3Of(c).at.x).toBe(x0);
    const confirmed = await tenderConfirmedExecution(ritual(c, grants[0]!));
    expect(confirmed).toMatchObject({ ok: true, status: "committed", receipt: { approvalActor: "human:confirmed-preview" } });
    expect(headOf(c).headSequence).toBe(before + 1);
    expect(r3Of(c).at.x).toBe(x0 + mmToNm(2));
  }, 30_000);
});
