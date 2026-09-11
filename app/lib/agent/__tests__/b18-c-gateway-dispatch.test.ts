/**
 * [B18-C I2] The gateway's granted-execution dispatch, the loop's toolset rule
 * and its call-id plumbing — proven on a TEST registry whose reviewed list is
 * injected (the production list is still empty on this tree, so nothing is
 * exposed to a real run):
 *
 *  - seal → base → mint through the REAL minter over the in-memory grant
 *    store: a preview grant under proposal_only, an explicit grant for the
 *    exact user request under execute_explicit_tier1, the base derived from
 *    the verified context, the origin pinned to the call id, the registry
 *    digest and the prompt version, and ONE grant per run + call;
 *  - every refusal is exact and mints NOTHING;
 *  - the production registry: every mutation, destructive and release tool
 *    stays not_callable with a minter bound and a grantable context;
 *  - the loop advertises a granted execution only with a minter, a verified
 *    board and a PCB basis, hands the gateway the provider call id, answers
 *    from the durable record, and mirrors the settlement in the trace on the
 *    same call id.
 */
import { describe, expect, it } from "vitest";
import { assembleAgentRunContext } from "../context";
import { createAgentToolGateway } from "../gateway";
import { buildExecutionGrantBase } from "../execution-intents";
import { buildRunToolset, runAgentLoop } from "../loop";
import { AgentTraceRecorder, InMemoryTraceSink } from "../trace-recorder";
import { validateAgentRunTrace } from "../trace";
import { DEFAULT_AGENT_BUDGET, type AgentExecutionGrantMinter, type AgentRunContext, type AgentRunEvent, type AgentStep, type AgentToolResult, type GatewayInvocationOutcome, type ProviderAgentAdapter } from "../contracts";
import { ToolRegistry, type ToolDescriptor } from "../../engineering/tool-registry";
import { SIRKIT_TOOL_CATALOG, sirkitToolRegistry } from "../../engineering/tool-catalog";
import type { GrantedExecutionTool } from "../../engineering/granted-execution-families";
import { executionBoardDigest } from "../../engineering/execution-grant";
import { defaultAutonomySetting, type AgentAutonomySetting } from "../../engineering/permission-tiers";
import type { ProjectRole } from "../../engineering/types";
import { engineeringDigest } from "../../engineering/stable";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { ExecutionGrantStore } from "../../execution-grant/store";
import { createExecutionGrantMinter } from "../../execution-grant/mint";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";
import { mmToNm } from "../../pcb/units";
import { pcbRevisionId } from "../../pcb/revision";
import { DEFAULT_PRESET_ID } from "../../pcb/drc/presets";
import { resolvePcbValidationPolicy } from "../../pcb/proposal/sealed-pcb-edit-proposal";

const SCOPE = { tenantId: "local", projectId: "p18", branchId: "main" };
const T0 = Date.parse("2026-09-11T12:00:00.000Z");
const MOVE = SIRKIT_TOOL_CATALOG.find((d) => d.toolId === "sirkit.pcb.move-footprint")!;
const ROWS: readonly GrantedExecutionTool[] = [{ toolId: MOVE.toolId, family: "pcb.move-footprint", reason: "B18-C I2 test registry: the dispatch is proven before the production row lands (I3)" }];
const GRANTED: ToolDescriptor = { ...MOVE, agentExposed: true, executionMode: "granted", requiredSelectionKinds: [] };
const TEST_REGISTRY = new ToolRegistry(SIRKIT_TOOL_CATALOG.map((d) => (d.toolId === GRANTED.toolId && d.version === GRANTED.version ? GRANTED : d)), undefined, { grantedExecutionTools: ROWS });

const BOARD = makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2);
const R3 = BOARD.footprints.find((f) => f.ref === "R3")!;
const BASIS = { historyHeadSequence: 4, historyHeadLabel: null, lineageId: "lin1-0000000000000001", activeDrcPresetId: DEFAULT_PRESET_ID };
const MOVE_ARGS = { moves: [{ footprintId: R3.id, x: R3.at.x + mmToNm(2), y: R3.at.y }] };
const PROPOSAL_ONLY: AgentAutonomySetting = defaultAutonomySetting(SCOPE);
const EXPLICIT: AgentAutonomySetting = { ...PROPOSAL_ONLY, mode: "execute_explicit_tier1", revision: 1, updatedAt: "2026-09-11T11:00:00.000Z", updatedBy: { principalId: "u-admin", membershipRevision: "mbr1-z", role: "project_admin" } };

function context(over: { role?: ProjectRole; flag?: boolean; basis?: boolean } = {}): AgentRunContext {
  const assembly = assembleAgentRunContext({
    ...SCOPE, board: BOARD, ...(over.basis === false ? {} : { pcbProposalBasis: BASIS }),
    verifiedActor: { principalId: "u-1", actorRole: over.role ?? "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" },
    executionGrantsAvailable: over.flag ?? true,
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}

interface Minting { minter: AgentExecutionGrantMinter; store: ExecutionGrantStore; calls: number }
/** The REAL minter over an in-memory grant store, wrapped only to count mint calls. */
function minting(options: { autonomy?: AgentAutonomySetting; clock?: () => number } = {}): Minting {
  const store = new ExecutionGrantStore(new InMemoryDurableWorkflowRepository());
  let seq = 0;
  const real = createExecutionGrantMinter({
    principalId: "u-1", role: "pcb_editor", membershipRevision: "mbr1-a", authClass: "local_dev", sessionIdentity: "sess-secret-1", correlationId: "corr-1",
    scope: SCOPE, boardInstanceId: null, autonomy: options.autonomy ?? PROPOSAL_ONLY, userMessage: "Move R3 2 mm to the right.",
    runId: "run-1", provider: "openai", store, now: options.clock ?? (() => T0), randomHex: () => (seq += 1).toString(16).padStart(32, "a"),
  });
  const counting: Minting = {
    store, calls: 0,
    minter: {
      mint: (request) => { counting.calls += 1; return real.mint(request); },
      awaitSettlement: (grantId, opts) => real.awaitSettlement(grantId, opts),
      retireIssued: (reason, onlyExplicit) => real.retireIssued(reason, onlyExplicit),
    },
  };
  return counting;
}

type Gateway = ReturnType<typeof createAgentToolGateway>;
function invoke(gateway: Gateway, over: { args?: Record<string, unknown>; ctx?: AgentRunContext; callId?: string | null } = {}): Promise<GatewayInvocationOutcome> {
  return gateway.invoke({
    runId: "run-1", provider: "openai", toolId: GRANTED.toolId, version: GRANTED.version, args: over.args ?? MOVE_ARGS, context: over.ctx ?? context(), timeoutMs: 5_000,
    ...(over.callId === null ? {} : { callId: over.callId ?? "call-1" }),
  });
}
function grantOf(outcome: GatewayInvocationOutcome) {
  if (outcome.kind !== "execution-grant") throw new Error(`expected an execution grant, got ${JSON.stringify(outcome).slice(0, 300)}`);
  return outcome;
}
function tamperedBoard(ctx: AgentRunContext): AgentRunContext {
  const clone = structuredClone(ctx);
  const board = clone.canonicalState?.pcb;
  if (!board) throw new Error("fixture has a board");
  board.footprints[0]!.at.x += 1;
  return clone;
}

describe("B18-C I2 — seal, base and mint through the real minter", () => {
  it("a preview grant under proposal_only: the base derives from the verified context, the origin pins the call id / registry digest / prompt version, the grant is durable, and the agent-facing outcome carries no nonce or session identity", async () => {
    const m = minting();
    const gateway = createAgentToolGateway(TEST_REGISTRY, { executionGrants: m.minter, promptVersion: "1.0.0" });
    const ctx = context();
    const outcome = grantOf(await invoke(gateway, { ctx }));
    expect(outcome.decision).toBe("preview_then_confirm");
    const binding = outcome.grant.binding;
    const derived = buildExecutionGrantBase(ctx);
    if (!derived.ok) throw new Error(derived.diagnostics.join(" "));
    const resolved = resolvePcbValidationPolicy(DEFAULT_PRESET_ID)!;
    expect(binding.base).toEqual(derived.base);
    expect(binding.base).toEqual({
      canonicalRevisionDigest: ctx.canonicalRevisionDigest,
      pcb: { pcbRevisionId: pcbRevisionId(BOARD), boardDigest: engineeringDigest({ schema: "sirkit.pcb-board.v1", board: BOARD }), headSequence: 4, lineageId: BASIS.lineageId, validationPolicy: { presetId: DEFAULT_PRESET_ID, presetVersion: String(resolved.policy.presetVersion), rulesDigest: resolved.policy.rulesDigest } },
      schematic: null,
    });
    expect(executionBoardDigest(BOARD)).toBe(engineeringDigest({ schema: "sirkit.pcb-board.v1", board: BOARD })); // the B18-B fixture's formula, now one function
    expect(binding.origin).toEqual({ provider: "openai", callId: "call-1", toolId: GRANTED.toolId, toolVersion: GRANTED.version, registryDigest: TEST_REGISTRY.digest(), promptVersion: "1.0.0" });
    expect(binding.session).toEqual({ editor: "pcb", lineageId: BASIS.lineageId, runId: "run-1", viewSessionId: null });
    expect(binding.operation).toMatchObject({ family: "pcb.move-footprint", tier: 1, capability: "edit_placement", decision: "preview_then_confirm", requiresHumanApproval: true });
    expect(binding.proposal.operationCount).toBe(1);
    expect(binding.instruction.explicit.proven).toBe(false);
    const loaded = await m.store.load(SCOPE, outcome.grant.grantId, T0);
    expect(loaded?.record.state.status).toBe("issued");
    expect(loaded?.record.binding.origin.callId).toBe("call-1");
    expect(JSON.stringify(outcome)).not.toContain("sess-secret-1");
    expect(JSON.stringify(outcome)).not.toContain(loaded!.record.nonce);
    expect(ctx.actor.grantedCapabilities).toEqual(["read_project"]); // the capability is the grant's, never the actor's
    expect(m.calls).toBe(1);
  });

  it("an explicit grant for the EXACT user request under execute_explicit_tier1 (proof by derivation); the same run + call mints ONE grant; another target is only previewed", async () => {
    const m = minting({ autonomy: EXPLICIT });
    const gateway = createAgentToolGateway(TEST_REGISTRY, { executionGrants: m.minter, promptVersion: "1.0.0" });
    const first = grantOf(await invoke(gateway));
    expect(first.decision).toBe("execute_explicit");
    expect(first.grant.binding.instruction.explicit).toMatchObject({ proven: true, coverage: "whole-message", derivedOperationsDigest: first.grant.binding.proposal.operationsDigest });
    const replay = grantOf(await invoke(gateway));
    expect(replay.grant.grantId).toBe(first.grant.grantId);
    const other = grantOf(await invoke(gateway, { callId: "call-2", args: { moves: [{ footprintId: R3.id, x: R3.at.x + mmToNm(5), y: R3.at.y }] } }));
    expect(other.decision).toBe("preview_then_confirm");
    expect(other.grant.grantId).not.toBe(first.grant.grantId);
  });
});

describe("B18-C I2 — every refusal is exact and mints nothing", () => {
  it("minter / prompt version / call id / discovery / arguments / base / integrity refusals", async () => {
    const m = minting();
    const bound = createAgentToolGateway(TEST_REGISTRY, { executionGrants: m.minter, promptVersion: "1.0.0" });
    const ctx = context();
    const cases: Array<[string, () => Promise<GatewayInvocationOutcome>, string, RegExp]> = [
      ["no minter", () => invoke(createAgentToolGateway(TEST_REGISTRY, { promptVersion: "1.0.0" })), "execution_unavailable", /No execution-grant minter is bound/],
      ["no prompt version", () => invoke(createAgentToolGateway(TEST_REGISTRY, { executionGrants: m.minter })), "execution_unavailable", /No execution-grant minter is bound/],
      ["no call id", () => invoke(bound, { callId: null }), "invalid_input", /provider call id/],
      ["no grant context (no minter bound by the route)", () => invoke(bound, { ctx: context({ flag: false }) }), "not_discoverable", /\(capability_missing\)/],
      ["no PCB basis", () => invoke(bound, { ctx: context({ basis: false }) }), "not_discoverable", /\(capability_missing\)/],
      ["viewer", () => invoke(bound, { ctx: context({ role: "viewer" }) }), "not_discoverable", /\(role_not_permitted\)/],
      ["authority-shaped argument", () => invoke(bound, { args: { ...MOVE_ARGS, approval: true } }), "invalid_input", /authority-shaped/],
      ["unexpected argument", () => invoke(bound, { args: { ...MOVE_ARGS, note: "x" } }), "invalid_input", /Unexpected argument/],
      ["non-integer coordinate", () => invoke(bound, { args: { moves: [{ footprintId: R3.id, x: 1.5, y: 2 }] } }), "invalid_input", /integer nanometres/],
      ["unknown footprint", () => invoke(bound, { args: { moves: [{ footprintId: "fp-no-such", x: 1, y: 2 }] } }), "invalid_input", /./],
      ["unknown DRC preset (post-assembly)", () => invoke(bound, { ctx: { ...ctx, pcbProposalBasis: { ...ctx.pcbProposalBasis!, activeDrcPresetId: "no-such-preset" } } }), "authority_unavailable", /does not resolve in the preset registry/],
      ["post-assembly board mutation", () => invoke(bound, { ctx: tamperedBoard(ctx) }), "context_integrity", /post-assembly/],
    ];
    for (const [label, run, status, diagnostic] of cases) {
      const outcome = await run();
      expect(outcome, label).toMatchObject({ kind: "refused", ok: false, status });
      if (outcome.kind === "refused") expect(outcome.diagnostics.join(" "), label).toMatch(diagnostic);
    }
    expect(m.calls).toBe(0);
  });

  it("the minter's own refusal passes through 1:1; a throwing minter is grant_unavailable with its detail redacted", async () => {
    const refusing: AgentExecutionGrantMinter = { async mint() { return { ok: false, reason: "execution_not_permitted", diagnostics: ["policy says no"] }; }, async awaitSettlement() { return { status: "unsettled", grant: null }; }, async retireIssued() { return []; } };
    expect(await invoke(createAgentToolGateway(TEST_REGISTRY, { executionGrants: refusing, promptVersion: "1.0.0" }))).toMatchObject({ kind: "refused", status: "execution_not_permitted", diagnostics: ["policy says no"] });
    const throwing: AgentExecutionGrantMinter = { async mint() { throw new Error("internal store detail 42"); }, async awaitSettlement() { return { status: "unsettled", grant: null }; }, async retireIssued() { return []; } };
    const failed = await invoke(createAgentToolGateway(TEST_REGISTRY, { executionGrants: throwing, promptVersion: "1.0.0" }));
    expect(failed).toMatchObject({ kind: "refused", status: "grant_unavailable" });
    expect(JSON.stringify(failed)).not.toContain("internal store detail 42");
  });

  it("the production registry: with a minter bound and a grantable context, every mutation / destructive / release tool stays not_callable and nothing is minted", async () => {
    const registry = sirkitToolRegistry();
    expect(registry.grantedExecutionTools()).toEqual([]);
    expect(TEST_REGISTRY.grantedExecutionTools()).toEqual(ROWS);
    const m = minting();
    const gateway = createAgentToolGateway(registry, { executionGrants: m.minter, promptVersion: "1.0.0" });
    const ctx = context();
    const risky = registry.list().filter((d) => ["mutate", "destructive", "release"].includes(d.operationClass));
    expect(risky.map((d) => d.toolId)).toContain("sirkit.pcb.move-footprint");
    for (const descriptor of risky) {
      const outcome = await gateway.invoke({ runId: "run-1", provider: "openai", toolId: descriptor.toolId, version: descriptor.version, args: MOVE_ARGS, context: ctx, timeoutMs: 5_000, callId: "call-1" });
      expect(outcome, descriptor.toolId).toMatchObject({ kind: "refused", status: "not_callable" });
    }
    expect(m.calls).toBe(0);
  });
});

type StepScript = () => Partial<AgentStep>;
class FakeAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly continueInputs: Array<readonly AgentToolResult[]> = [];
  private index = 0;
  constructor(private readonly script: StepScript[]) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "fake", continuation: { provider: "openai", state: null }, ...partial };
  }
  async start(): Promise<AgentStep> { return this.step(this.script[this.index++]!()); }
  async continueWith(input: { results: readonly AgentToolResult[] }): Promise<AgentStep> { this.continueInputs.push(input.results); return this.step(this.script[this.index++]!()); }
}

async function runLoop(m: Minting, budget: Partial<typeof DEFAULT_AGENT_BUDGET> = {}) {
  const ctx = context();
  const declaration = buildRunToolset(TEST_REGISTRY, ctx, () => undefined).declarations.find((d) => d.toolId === GRANTED.toolId)!;
  const adapter = new FakeAdapter([() => ({ toolCalls: [{ callId: "c1", providerName: declaration.providerName, argumentsText: JSON.stringify(MOVE_ARGS) }] }), () => ({ text: "done" })]);
  const events: AgentRunEvent[] = [];
  const trace = new AgentTraceRecorder({ runId: "run-1", traceId: "trace-1", provider: "openai", promptVersion: "1.0.0", promptDigest: "eng1-0000000000000000", registryDigest: TEST_REGISTRY.digest(), scope: SCOPE, contextDigests: { canonicalRevisionDigest: ctx.canonicalRevisionDigest, schematicDigest: ctx.schematicDigest, selectionDigest: ctx.selectionDigest, netlistDigest: ctx.netlistDigest, resourceManifestDigest: null } }, new InMemoryTraceSink());
  const result = await runAgentLoop(
    { runId: "run-1", provider: "openai", history: [], userMessage: "Move R3 2 mm to the right.", budget: { ...DEFAULT_AGENT_BUDGET, ...budget } },
    { adapter, gateway: createAgentToolGateway(TEST_REGISTRY, { executionGrants: m.minter, promptVersion: "1.0.0" }), registry: TEST_REGISTRY, context: ctx, system: "sys", emit: (event) => events.push(event), trace, executionGrants: m.minter },
  );
  const finalized = trace.finalize({ outcome: result.status, failureReason: result.failureReason ?? null });
  const answers = adapter.continueInputs[0]!.map((item) => JSON.parse(item.outputText) as Record<string, unknown>);
  const ready = events.find((event): event is Extract<AgentRunEvent, { type: "execution_grant_ready" }> => event.type === "execution_grant_ready");
  return { result, events, answers, trace: finalized, grantId: ready?.grant.grantId ?? null };
}

describe("B18-C I2 — the loop: toolset rule, call id, durable answers, trace", () => {
  it("the run toolset advertises a granted execution ONLY with a minter, a verified board and a PCB basis; a tampered flag cannot smuggle it in; the production registry never advertises it", () => {
    const names = (registry: ToolRegistry, ctx: AgentRunContext, warnings: string[] = []) => buildRunToolset(registry, ctx, (message) => warnings.push(message)).declarations.map((d) => d.toolId);
    expect(names(TEST_REGISTRY, context())).toContain(GRANTED.toolId);
    expect(names(TEST_REGISTRY, context({ flag: false }))).not.toContain(GRANTED.toolId);
    expect(names(TEST_REGISTRY, context({ basis: false }))).not.toContain(GRANTED.toolId);
    expect(names(TEST_REGISTRY, context({ role: "viewer" }))).not.toContain(GRANTED.toolId);
    expect(names(sirkitToolRegistry(), context())).not.toContain(GRANTED.toolId);
    // Defense in depth: discovery claims grantability but the run carries no minter ⇒ withheld with a truthful warning.
    const warnings: string[] = [];
    expect(names(TEST_REGISTRY, { ...context(), executionGrantsAvailable: false }, warnings)).not.toContain(GRANTED.toolId);
    expect(warnings).toContain(`Tool ${GRANTED.toolId} unavailable: no execution-grant minter, verified canonical board and PCB history basis for this run.`);
  });

  it("over the REAL gateway and minter: the provider call id reaches the durable grant; a preview answers the model without waiting and records one trace entry", async () => {
    const m = minting();
    const { result, answers, trace, grantId } = await runLoop(m);
    expect(result.status).toBe("completed");
    expect(answers[0]).toMatchObject({ ok: true, status: "execution_preview_issued", grantId });
    const loaded = await m.store.load(SCOPE, grantId!, T0);
    expect(loaded?.record.binding.origin.callId).toBe("c1");
    expect(loaded?.record.state.status).toBe("issued"); // the human confirms later; nothing retired
    const tools = trace.events.filter((e) => e.kind === "tool_invocation") as Array<Record<string, unknown>>;
    expect(tools.map((e) => [e.callId, e.outcomeClass, e.status])).toEqual([["c1", "execution_grant", "execution_preview_issued"]]);
    expect(validateAgentRunTrace(trace)).toEqual([]);
    expect(m.calls).toBe(1);
  });

  it("an explicit grant nobody tenders: the loop waits (bounded), answers execution_unsettled, retires the grant run_unsettled in the DURABLE store and mirrors the settlement in the trace on the same call id", async () => {
    let clock = T0;
    const m = minting({ autonomy: EXPLICIT, clock: () => (clock += 1) });
    const { result, answers, trace, grantId } = await runLoop(m, { executionSettlementTimeoutMs: 5 });
    expect(result.status).toBe("completed");
    expect(answers[0]).toMatchObject({ ok: false, status: "execution_unsettled", grantId });
    const loaded = await m.store.load(SCOPE, grantId!, clock);
    expect(loaded?.record.state).toMatchObject({ status: "retired", retirement: { reason: "run_unsettled" } });
    const tools = trace.events.filter((e) => e.kind === "tool_invocation") as Array<Record<string, unknown>>;
    expect(tools.map((e) => [e.callId, e.outcomeClass, e.status])).toEqual([["c1", "execution_grant", "execution_grant_issued"], ["c1", "execution_grant", "execution_settled:unsettled"]]);
    expect(tools[1]).toMatchObject({ proposalId: grantId });
    expect(validateAgentRunTrace(trace)).toEqual([]);
  });
});
