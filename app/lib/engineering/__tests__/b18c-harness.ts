/**
 * [B18-C] A shared in-process harness for granted-execution scenarios — no
 * provider and no HTTP. A REAL canonical editor session over a durable
 * in-memory store; the REAL grant store / minter / consume / settle services;
 * the page's SAFE receiver; the REAL granted-execution ritual; all driven by a
 * scripted adapter through the REAL loop and gateway over the production
 * registry. The run context is assembled from the LIVE board as the page sends
 * it (a JSON round trip) with the basis from the session's head metadata.
 * (`b18-c-loop-real-gateway` keeps the I3 copy of the same composition.)
 */
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
import { tenderExplicitExecution } from "../../project/granted-execution-controller.internal";
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

export const PROJECT = "p18r";
export const BRANCH = "main";
export const SCOPE = { tenantId: "local", projectId: PROJECT, branchId: BRANCH };
export const T0 = Date.parse("2026-09-11T12:00:00.000Z");
export const MESSAGE = "Move R3 2 mm to the right.";
export const PRINCIPAL: ConsumePrincipal = { principalId: "u-1", role: "pcb_editor", membershipRevision: "mbr1-a", sessionIdentity: "sess-1", actorKind: "human" };
export const setting = (mode: AgentAutonomySetting["mode"]): AgentAutonomySetting => ({ schema: AGENT_AUTONOMY_SCHEMA, tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, mode, revision: 1, updatedAt: null, updatedBy: null });

export interface BoardOptions {
  /** A copper pour covering the board, with a derived fill present (as the editor's zone-fill hook leaves it). */
  zone?: boolean;
}

export function fixtureBoard(options: BoardOptions = {}): PcbBoard {
  const def = makeResistorDef();
  const board = makeBoard(40, 30, [makeInstance("r3", def, { x: 5, y: 5 }, { "1": 1, "2": 2 }), makeInstance("r4", def, { x: 30, y: 22 }, { "1": 1, "2": 0 })], 2);
  if (options.zone) {
    const polygon = [{ x: 0, y: 0 }, { x: mmToNm(40), y: 0 }, { x: mmToNm(40), y: mmToNm(30) }, { x: 0, y: mmToNm(30) }];
    board.zones.push({
      id: "zone-gnd", layer: "copperTop", netId: board.nets[0]?.id ?? 1, source: "user", polygon, appearance: "solid", connection: "thermal",
      fill: [{ outer: polygon, holes: [], areaNm2: mmToNm(40) * mmToNm(30), boundingBox: { minX: 0, minY: 0, maxX: mmToNm(40), maxY: mmToNm(30) } }], dirty: false,
    });
  }
  return board;
}

/** What the editor's zone-fill hook does after a change: recompute DERIVED fill state (here, the full pour) and mark it clean. */
export function refillZones(draft: PcbBoard): void {
  for (const zone of draft.zones) {
    zone.fill = [{ outer: zone.polygon, holes: [], areaNm2: mmToNm(40) * mmToNm(30), boundingBox: { minX: 0, minY: 0, maxX: mmToNm(40), maxY: mmToNm(30) } }];
    zone.dirty = false;
  }
}

export interface Core {
  history: ReturnType<typeof bindCanonicalEditorSession>["history"];
  session: NonNullable<ReturnType<typeof canonicalSessionFor>>;
  store: ExecutionGrantStore;
  now: () => number;
  autonomy: AgentAutonomySetting;
  interlock: ProjectCommitInterlock;
  registry: GrantedExecutionRegistry;
  journal: AgentExecutionJournal;
}
export type Composed = Core & { transport: ExecutionGrantTransport };

/** The transport double: the REAL consume/settle services over the same store, answering as the routes do. */
export function transportOver(c: Core, options: { failSettle?: number } = {}): ExecutionGrantTransport {
  const autonomy = async () => c.autonomy;
  let settleFailures = options.failSettle ?? 0;
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
      if (settleFailures > 0) { settleFailures -= 1; return { ok: false, status: null, code: "unreachable", message: "The execution-grant endpoint could not be reached.", reason: null, grant: null }; }
      const outcome = await settleExecutionGrant({ store: c.store, scope, principalId: PRINCIPAL.principalId, now: c.now(), request: body });
      if (outcome.ok) return { ok: true, status: 200, body: { grant: outcome.grant, idempotent: outcome.idempotent, late: outcome.late } };
      return { ok: false, status: outcome.status === "forged" ? 404 : 409, code: `EXECUTION_GRANT_${outcome.status.toUpperCase()}`, message: outcome.message, reason: null, grant: outcome.grant };
    },
  };
}

export async function composition(mode: AgentAutonomySetting["mode"], options: BoardOptions & { failSettle?: number } = {}): Promise<Composed> {
  const raw = createHistory(fixtureBoard(options));
  const bound = bindCanonicalEditorSession(raw, SCOPE, { durableStore: new InMemoryAtomicProjectStore() });
  const history = bound.history;
  const session = canonicalSessionFor(history)!;
  const r3 = history.committedPresent.footprints.find((f) => f.ref === "R3")!;
  const setupBuilt = buildExecutionOperations(history.committedPresent, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: mmToNm(6), y: mmToNm(5) }] });
  if (!setupBuilt.ok) throw new Error(setupBuilt.message);
  const setup = await session.commit({ commandId: "pcb.move-footprint", label: "setup", buildOperations: () => setupBuilt.operations });
  if (!setup.ok || setup.status !== "executed") throw new Error("setup commit must execute");
  // The editor's zone-fill hook refills DERIVED fill state after every change (a history `applyDerived`, never the canonical
  // head): the editor board the chat captures carries CURRENT fills while the canonical head keeps the kernel's dirty marks.
  if (options.zone) history.applyDerived("zone refill", refillZones);
  // One clock for every party: the frozen fixture epoch advanced by real elapsed time (bounded waits stay bounded).
  const started = Date.now();
  const core: Core = {
    history, session, now: () => T0 + (Date.now() - started), autonomy: setting(mode),
    store: new ExecutionGrantStore(new InMemoryDurableWorkflowRepository()), interlock: new ProjectCommitInterlock(), registry: new GrantedExecutionRegistry(),
    journal: new AgentExecutionJournal(new InMemoryAgentExecutionJournalStore(), { ...SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), editor: "pcb" }),
  };
  return { ...core, transport: transportOver(core, { failSettle: options.failSettle }) };
}

export const headOf = (c: Composed) => c.session.headMetadataFor(c.history.committedPresent)!;
export const r3Of = (c: Composed) => c.history.committedPresent.footprints.find((f) => f.ref === "R3")!;
/** What a model reading board-inspect would send: R3's stable id and an absolute target `dxMm` to the right. */
export const movesBy = (c: Composed, dxMm: number) => JSON.stringify({ moves: [{ footprintId: r3Of(c).id, x: r3Of(c).at.x + mmToNm(dxMm), y: r3Of(c).at.y }] });

/** The page's ritual inputs for a received grant (as PcbEditor supplies them). */
export function ritual(c: Composed, grant: PublicExecutionGrant, originRunId = "run-1") {
  return {
    grant, history: c.history, interlock: c.interlock, journal: c.journal, transport: c.transport,
    stillCurrent: () => true, currentProjectId: PROJECT, currentBranchId: BRANCH, tenantId: "local", activeDrcPresetId: DEFAULT_PRESET_ID,
    originRunId, registry: c.registry, now: c.now, attemptNonce: () => "a".repeat(32),
  };
}

/** The run context from the LIVE board exactly as the page sends it, with the basis from the session's head metadata. */
export function runContext(c: Composed) {
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

export class FakeAdapter implements ProviderAgentAdapter {
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
export const call = (callId: string, providerName: string, args: string): AgentStep["toolCalls"][number] => ({ callId, providerName, argumentsText: args });

let runSeq = 0;
/** One chat run: the page auto-runs the ritual for an execute_explicit grant exactly as PcbEditor does. */
export async function runScenario(c: Composed, script: (moveTool: string, tool: (toolId: string) => string) => Array<() => Partial<AgentStep>>, options: { message?: string; settlementTimeoutMs?: number } = {}) {
  const runId = `run-${(runSeq += 1)}`;
  const message = options.message ?? MESSAGE;
  const registry = sirkitToolRegistry();
  const context = runContext(c);
  const declarations = buildRunToolset(registry, context, () => undefined).declarations;
  const move = declarations.find((d) => d.toolId === "sirkit.pcb.move-footprint");
  if (!move) throw new Error("the lifted move tool must be advertised to a grantable run");
  const tool = (toolId: string): string => {
    const declaration = declarations.find((d) => d.toolId === toolId);
    if (!declaration) throw new Error(`${toolId} is not advertised to this run`);
    return declaration.providerName;
  };
  const minter = createExecutionGrantMinter({
    principalId: PRINCIPAL.principalId, role: "pcb_editor", membershipRevision: PRINCIPAL.membershipRevision, authClass: "local_dev", sessionIdentity: PRINCIPAL.sessionIdentity, correlationId: "corr-1",
    scope: SCOPE, boardInstanceId: pcbBoardInstanceId(PROJECT), autonomy: c.autonomy, userMessage: message, runId, provider: "openai", store: c.store, now: c.now,
  });
  const events: AgentRunEvent[] = [];
  const rituals: Array<Promise<GrantedExecutionOutcome>> = [];
  const grants: PublicExecutionGrant[] = [];
  const adapter = new FakeAdapter(script(move.providerName, tool));
  const result = await runAgentLoop(
    { runId, provider: "openai", history: [], userMessage: message, budget: { ...DEFAULT_AGENT_BUDGET, executionSettlementTimeoutMs: options.settlementTimeoutMs ?? 10_000 } },
    {
      adapter, registry, context, system: AGENT_SYSTEM_PROMPT, executionGrants: minter,
      gateway: createAgentToolGateway(registry, { executionGrants: minter, promptVersion: AGENT_SYSTEM_PROMPT_VERSION }),
      emit: (event) => {
        events.push(event);
        if (event.type !== "execution_grant_ready") return;
        const received = receiveExecutionGrantReadyEvent(JSON.parse(JSON.stringify(event)));
        if (!received) throw new Error("the minted grant must be receivable");
        grants.push(received.grant);
        if (event.decision === "execute_explicit") rituals.push(tenderExplicitExecution(ritual(c, received.grant, runId)));
      },
    },
  );
  return { result, events, adapter, grants, rituals: await Promise.all(rituals) };
}
