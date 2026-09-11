/**
 * [B18-B] The loop's handling of a server-minted execution grant, driven by a
 * gateway double (the gateway dispatch branch itself lands with the exposure
 * lift in B18-C) and a minter double: the grant event is emitted, the trace
 * records the closed class `execution_grant` with the grant identity and the
 * operations digest, a preview grant answers the model without waiting, an
 * explicit grant waits for the DURABLE settlement (bounded by the budget and
 * the remaining deadline) and answers executed / not committed / retired /
 * unsettled truthfully, an untendered grant is retired `run_unsettled`, a
 * cancelled run retires its explicit grant `run_cancelled`, and the grant is
 * the run's ONE side-effecting artifact (proposal_exists afterwards).
 */
import { describe, expect, it } from "vitest";
import { assembleAgentRunContext } from "../context";
import { DEFAULT_AGENT_BUDGET, type AgentExecutionGrantMinter, type AgentExecutionSettlement, type AgentRunEvent, type AgentStep, type AgentToolInvocationGateway, type AgentToolResult, type GatewayInvocationOutcome, type ProviderAgentAdapter } from "../contracts";
import { buildRunToolset, runAgentLoop } from "../loop";
import { AgentTraceRecorder, InMemoryTraceSink } from "../trace-recorder";
import { TRACE_OUTCOME_CLASSES } from "../trace";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { GRANT_EXPLICIT_TTL_MS, GRANT_PREVIEW_TTL_MS, grantDigestFor, grantIdentityKey, publicExecutionGrant, userInstructionDigest, type ExecutionGrantBinding, type ExecutionGrantRecord, type PublicExecutionGrant } from "../../engineering/execution-grant";
import { buildExecutionOperations } from "../../engineering/execution-operations";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";
import { mmToNm } from "../../pcb/units";
import { createEmptyBoard } from "../../pcb/types";
import type { SchematicState } from "@/lib/schematic-types";

const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const T0 = "2026-09-10T12:00:00.000Z";
const registry = sirkitToolRegistry();

function context() {
  const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "p18", branchId: "main", schematic: SCHEMATIC, board: createEmptyBoard(), schematicHeadMark: { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef" } });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
const CONTEXT = context();
const toolset = buildRunToolset(registry, CONTEXT, () => undefined);
const READ = toolset.declarations.find((d) => d.toolId === "sirkit.schematic.inspect")!;
const PROPOSE = toolset.declarations.find((d) => registry.get(d.toolId, d.version)?.operationClass === "propose")!;

const board = makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2);
const R3 = board.footprints.find((f) => f.ref === "R3")!;
const builtResult = buildExecutionOperations(board, { family: "pcb.move-footprint", moves: [{ footprintId: R3.id, x: R3.at.x + mmToNm(2), y: R3.at.y }] });
if (!builtResult.ok) throw new Error(builtResult.message);
const built = builtResult;

function grantOf(decision: "execute_explicit" | "preview_then_confirm"): PublicExecutionGrant {
  const ttlMs = decision === "execute_explicit" ? GRANT_EXPLICIT_TTL_MS : GRANT_PREVIEW_TTL_MS;
  const binding: ExecutionGrantBinding = {
    authorization: { principalId: "u-1", membershipRevision: "mbr1-a", role: "pcb_editor", authClass: "local_dev", sessionIdentity: "sess-1", requiredApplyRole: "pcb_editor" },
    scope: { tenantId: "local", projectId: "p18", branchId: "main", boardInstanceId: null },
    session: { editor: "pcb", lineageId: "lin1-0000000000000001", runId: "run-t", viewSessionId: null },
    origin: { provider: "openai", callId: "c1", toolId: "sirkit.pcb.move-footprint", toolVersion: "1.0.0", registryDigest: "eng1-registry", promptVersion: "1.0.0" },
    operation: { family: "pcb.move-footprint", tier: 1, capability: "edit_placement", decision, requiresHumanApproval: decision === "preview_then_confirm", autonomy: { mode: "execute_explicit_tier1", revision: 1 } },
    targets: built.targets,
    base: { canonicalRevisionDigest: "eng1-canon", pcb: { pcbRevisionId: "pcb2-abc", boardDigest: "eng1-board", headSequence: 4, lineageId: "lin1-0000000000000001", validationPolicy: { presetId: "jlcpcb-2l", presetVersion: "2", rulesDigest: "eng1-rules" } }, schematic: null },
    proposal: { operations: built.operations, operationsDigest: built.operationsDigest, operationCount: 1, preview: built.preview, previewDigest: built.previewDigest, expectedPcbRevisionAfter: built.resultRevision },
    instruction: { userMessageDigest: userInstructionDigest("Move R3 2 mm to the right."), excerpt: "Move R3 2 mm to the right.", explicit: decision === "execute_explicit" ? { proven: true, grammarId: "pcb.move-footprint", grammarVersion: "1.0.0", coverage: "whole-message", derivedOperationsDigest: built.operationsDigest } : { proven: false, grammarId: "pcb.move-footprint", grammarVersion: "1.0.0", coverage: "unproven", derivedOperationsDigest: null } },
    issuedAt: T0, expiresAt: new Date(Date.parse(T0) + ttlMs).toISOString(), ttlMs,
  };
  const nonce = "0".repeat(32);
  const record: ExecutionGrantRecord = { schema: "sirkit.agent-execution-grant.v1", grantId: `xg-${"1".repeat(32)}`, nonce, binding, identityKey: grantIdentityKey(binding), grantDigest: grantDigestFor(nonce, binding), state: { status: "issued", consumption: null, settlement: null, retirement: null } };
  return publicExecutionGrant(record);
}
const settledGrant = (grant: PublicExecutionGrant, outcome: "committed" | "not-committed" | "poisoned"): PublicExecutionGrant => ({ ...grant, state: { status: "settled", consumption: { attemptId: "eng1-0000000000000001", consumedAt: T0, commitDeadline: T0, commitment: "eng1-0000000000000002", live: { principalId: "u-1", role: "pcb_editor", membershipRevision: "mbr1-a" } }, settlement: { outcome, attestation: "browser-attested", transactionId: outcome === "committed" ? "tx:7" : null, revisionBefore: "pcb2-abc", revisionAfter: outcome === "committed" ? "pcb2-def" : null, headSequenceAfter: 5, changeSetDigest: null, receiptDigest: null, validations: { drc: { ran: true, violations: 0 } }, undoEligible: outcome === "committed", late: false, at: T0 }, retirement: null } });
const retiredGrant = (grant: PublicExecutionGrant): PublicExecutionGrant => ({ ...grant, state: { status: "retired", consumption: null, settlement: null, retirement: { reason: "session_changed", detail: "x", at: T0, observedBy: "server" } } });
const consumedGrant = (grant: PublicExecutionGrant): PublicExecutionGrant => ({ ...grant, state: { status: "consumed", consumption: { attemptId: "eng1-0000000000000001", consumedAt: T0, commitDeadline: T0, commitment: "eng1-0000000000000002", live: { principalId: "u-1", role: "pcb_editor", membershipRevision: "mbr1-a" } }, settlement: null, retirement: null } });

type StepScript = (input: { results?: readonly AgentToolResult[] }) => Partial<AgentStep> | Promise<Partial<AgentStep>>;
class FakeAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly continueInputs: Array<readonly AgentToolResult[]> = [];
  private index = 0;
  constructor(private readonly script: StepScript[]) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "fake", continuation: { provider: "openai", state: null }, ...partial };
  }
  async start(): Promise<AgentStep> { return this.step(await this.script[this.index++]!({})); }
  async continueWith(input: { results: readonly AgentToolResult[] }): Promise<AgentStep> { this.continueInputs.push(input.results); return this.step(await this.script[this.index++]!({ results: input.results })); }
}
const call = (callId: string, providerName: string, args = "{}"): AgentStep["toolCalls"][number] => ({ callId, providerName, argumentsText: args });
const resultsOf = (adapter: FakeAdapter, index = 0) => adapter.continueInputs[index]!.map((item) => JSON.parse(item.outputText) as Record<string, unknown>);

interface MinterDouble extends AgentExecutionGrantMinter { retired: Array<[string, boolean]>; waits: Array<{ grantId: string; timeoutMs: number }> }
function minterDouble(settle: (grantId: string, signal?: AbortSignal) => Promise<AgentExecutionSettlement>): MinterDouble {
  const double: MinterDouble = {
    retired: [], waits: [],
    async mint() { throw new Error("the loop never mints"); },
    async awaitSettlement(grantId, options) { double.waits.push({ grantId, timeoutMs: options.timeoutMs }); return settle(grantId, options.signal); },
    async retireIssued(reason, onlyExplicit) { double.retired.push([reason, onlyExplicit]); return []; },
  };
  return double;
}
function gatewayDouble(outcomes: GatewayInvocationOutcome[]): AgentToolInvocationGateway & { invoked: string[] } {
  const invoked: string[] = [];
  return { invoked, async invoke(input) { invoked.push(input.toolId); return outcomes.shift() ?? { kind: "refused", ok: false, toolId: input.toolId, status: "not_callable", diagnostics: ["exhausted"] }; } };
}
const grantOutcome = (grant: PublicExecutionGrant, decision: "execute_explicit" | "preview_then_confirm", note: string | null = null): GatewayInvocationOutcome => ({ kind: "execution-grant", ok: true, toolId: READ.toolId, version: READ.version, grant, decision, note });

async function run(script: StepScript[], gateway: AgentToolInvocationGateway, options: { minter?: AgentExecutionGrantMinter; budget?: Partial<typeof DEFAULT_AGENT_BUDGET>; signal?: AbortSignal } = {}) {
  const events: AgentRunEvent[] = [];
  const adapter = new FakeAdapter(script);
  const sink = new InMemoryTraceSink();
  const trace = new AgentTraceRecorder({ runId: "run-t", traceId: "trace-t", provider: "openai", promptVersion: "1.0.0", promptDigest: "eng1-0000000000000000", registryDigest: registry.digest(), scope: { tenantId: "local", projectId: "p18", branchId: "main" }, contextDigests: { canonicalRevisionDigest: CONTEXT.canonicalRevisionDigest, schematicDigest: CONTEXT.schematicDigest, selectionDigest: CONTEXT.selectionDigest, netlistDigest: CONTEXT.netlistDigest, resourceManifestDigest: null } }, sink);
  const result = await runAgentLoop(
    { runId: "run-t", provider: "openai", history: [], userMessage: "Move R3 2 mm to the right.", budget: { ...DEFAULT_AGENT_BUDGET, ...options.budget }, signal: options.signal },
    { adapter, gateway, registry, context: CONTEXT, system: "sys", emit: (event) => events.push(event), trace, ...(options.minter ? { executionGrants: options.minter } : {}) },
  );
  const finalized = trace.finalize({ outcome: result.status, failureReason: result.failureReason ?? null });
  return { result, events, adapter, trace: finalized };
}
const toolTrace = (trace: Awaited<ReturnType<typeof run>>["trace"]) => trace.events.filter((e) => e.kind === "tool_invocation") as Array<Record<string, unknown>>;
/** The protocol sequence without the toolset-availability warnings that follow run_started. */
const sequence = (events: AgentRunEvent[]): string[] => events.filter((e) => e.type !== "warning").map((e) => e.type);

describe("B18-B — the loop and a server-minted execution grant", () => {
  it("the closed trace vocabulary gained exactly execution_grant", () => {
    expect([...TRACE_OUTCOME_CLASSES]).toEqual(["read", "proposal", "proposal_blocked", "refused", "view_command", "layout_candidate", "execution_grant"]);
  });

  it("an execute_explicit grant: the grant event is emitted, the run awaits the DURABLE settlement (bounded by the budget) and answers the model `executed` from the settled record; the trace records execution_grant with the grant identity and the operations digest", async () => {
    const grant = grantOf("execute_explicit");
    const minter = minterDouble(async () => ({ status: "settled", grant: settledGrant(grant, "committed") }));
    const { result, events: all, adapter, trace } = await run([() => ({ toolCalls: [call("c1", READ.providerName)] }), () => ({ text: "done" })], gatewayDouble([grantOutcome(grant, "execute_explicit")]), { minter, budget: { executionSettlementTimeoutMs: 5 } });
    expect(result.status).toBe("completed");
    expect(sequence(all)).toEqual(["run_started", "tool_started", "tool_finished", "execution_grant_ready", "execution_settled", "text_delta", "run_completed"]);
    const events = all.filter((e) => e.type !== "warning");
    expect(events[2]).toMatchObject({ type: "tool_finished", ok: true, status: "execution_grant_issued" });
    expect(events[3]).toMatchObject({ type: "execution_grant_ready", grant: { grantId: grant.grantId }, decision: "execute_explicit", note: null });
    expect(events[4]).toMatchObject({ type: "execution_settled", grantId: grant.grantId, status: "settled", outcome: "committed", reason: null });
    expect(JSON.stringify(events)).not.toContain("nonce");
    expect(minter.waits).toEqual([{ grantId: grant.grantId, timeoutMs: 5 }]);
    expect(minter.retired).toEqual([]);
    expect(resultsOf(adapter)[0]).toMatchObject({ ok: true, status: "executed", grantId: grant.grantId, transactionId: "tx:7", revisionAfter: "pcb2-def", revisionBefore: "pcb2-abc", headSequenceAfter: 5, validations: { drc: { ran: true, violations: 0 } }, undo: { eligible: true } }); // [B18-C I4] the result contract
    const invocation = toolTrace(trace)[0]!;
    expect(invocation).toMatchObject({ outcomeClass: "execution_grant", status: "execution_grant_issued", proposalId: grant.grantId, proposalDigest: grant.binding.proposal.operationsDigest });
    expect(JSON.stringify(trace)).not.toContain("move_footprint"); // digests and identities only
  });

  it("a preview_then_confirm grant answers the model with the exact preview and the minter's note, waits for nothing and retires nothing (the human confirms later)", async () => {
    const grant = grantOf("preview_then_confirm");
    const minter = minterDouble(async () => { throw new Error("never awaited"); });
    const { result, events: all, adapter } = await run([() => ({ toolCalls: [call("c1", READ.providerName)] }), () => ({ text: "done" })], gatewayDouble([grantOutcome(grant, "preview_then_confirm", "An identical instruction already executed; confirm to run it again.")]), { minter });
    expect(result.status).toBe("completed");
    expect(sequence(all)).toEqual(["run_started", "tool_started", "tool_finished", "execution_grant_ready", "text_delta", "run_completed"]);
    const events = all.filter((e) => e.type !== "warning");
    expect(events[2]).toMatchObject({ status: "execution_preview_issued" });
    expect(resultsOf(adapter)[0]).toMatchObject({ ok: true, status: "execution_preview_issued", grantId: grant.grantId, preview: { before: "R3 at (5.000, 5.000) mm", after: "R3 at (7.000, 5.000) mm" }, note: "An identical instruction already executed; confirm to run it again." });
    expect(minter.waits).toEqual([]);
    expect(minter.retired).toEqual([]);
  });

  it("settlement outcomes are answered truthfully: not committed, retired with its reason, in flight (consumed, unsettled: nothing retired), unsettled (never tendered: retired run_unsettled)", async () => {
    const grant = grantOf("execute_explicit");
    const cases: Array<[AgentExecutionSettlement, Record<string, unknown>, Array<[string, boolean]>]> = [
      [{ status: "settled", grant: settledGrant(grant, "not-committed") }, { ok: false, status: "execution_not_committed", outcome: "not-committed" }, []],
      // A LANDED but unverifiable commit is never "nothing changed".
      [{ status: "settled", grant: settledGrant(grant, "poisoned") }, { ok: false, status: "execution_poisoned", outcome: "poisoned" }, []],
      [{ status: "retired", grant: retiredGrant(grant) }, { ok: false, status: "execution_retired", reason: "session_changed" }, []],
      [{ status: "in_flight", grant: consumedGrant(grant) }, { ok: false, status: "execution_unsettled" }, []],
      [{ status: "unsettled", grant }, { ok: false, status: "execution_unsettled" }, [["run_unsettled", true]]],
    ];
    for (const [settlement, expected, retired] of cases) {
      const minter = minterDouble(async () => settlement);
      const { result, events, adapter } = await run([() => ({ toolCalls: [call("c1", READ.providerName)] }), () => ({ text: "done" })], gatewayDouble([grantOutcome(grant, "execute_explicit")]), { minter });
      expect(result.status, settlement.status).toBe("completed");
      expect(events.find((e) => e.type === "execution_settled"), settlement.status).toMatchObject({ status: settlement.status });
      expect(resultsOf(adapter)[0], settlement.status).toMatchObject(expected);
      expect(minter.retired, settlement.status).toEqual(retired);
      const note = String(resultsOf(adapter)[0]!.note ?? "");
      if (expected.status === "execution_poisoned") { expect(note).not.toContain("Nothing changed"); expect(note).toMatch(/LANDED|may have changed/); }
      if (expected.status === "execution_not_committed") expect(note).toContain("Nothing changed");
    }
    // No minter at all (execution unavailable for the run): the loop still answers unsettled and never claims execution.
    const { result, adapter } = await run([() => ({ toolCalls: [call("c1", READ.providerName)] }), () => ({ text: "done" })], gatewayDouble([grantOutcome(grant, "execute_explicit")]));
    expect(result.status).toBe("completed");
    expect(resultsOf(adapter)[0]).toMatchObject({ ok: false, status: "execution_unsettled" });
  });

  it("the settlement wait is bounded by the REMAINING run deadline and a cancelled run retires its explicit grant run_cancelled through the finally path", async () => {
    const grant = grantOf("execute_explicit");
    const controller = new AbortController();
    const minter = minterDouble((_grantId, signal) => new Promise((resolve) => { signal?.addEventListener("abort", () => resolve({ status: "in_flight", grant: consumedGrant(grant) }), { once: true }); }));
    setTimeout(() => controller.abort(), 20);
    const { result, events } = await run([() => ({ toolCalls: [call("c1", READ.providerName)] }), () => ({ text: "never" })], gatewayDouble([grantOutcome(grant, "execute_explicit")]), { minter, signal: controller.signal, budget: { runDeadlineMs: 50_000, executionSettlementTimeoutMs: 60_000 } });
    expect(result).toMatchObject({ status: "cancelled", failureReason: "cancelled" });
    expect(events.at(-1)).toMatchObject({ type: "run_failed", reason: "cancelled" });
    expect(events.some((e) => e.type === "execution_settled")).toBe(false); // the boundary won: nothing was answered from a stale wait
    expect(minter.waits[0]!.timeoutMs).toBeLessThanOrEqual(50_000); // min(budget, remaining deadline)
    expect(minter.retired).toEqual([["run_cancelled", true]]);
    // A normally completed run never retires (the preview stays for the human; the explicit grant settled or was retired inline).
    const quiet = minterDouble(async () => ({ status: "settled", grant: settledGrant(grant, "committed") }));
    await run([() => ({ toolCalls: [call("c1", READ.providerName)] }), () => ({ text: "done" })], gatewayDouble([grantOutcome(grant, "execute_explicit")]), { minter: quiet });
    expect(quiet.retired).toEqual([]);
    // A gateway answer DISCARDED by the run boundary (the mint may still have landed durably): the finally path retires anyway.
    const hanging: AgentToolInvocationGateway = { invoke: (input) => new Promise((resolve) => input.signal?.addEventListener("abort", () => resolve({ kind: "refused", ok: false, toolId: input.toolId, status: "aborted", diagnostics: [] }), { once: true })) };
    const orphan = minterDouble(async () => ({ status: "unsettled", grant: null }));
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 20);
    const discarded = await run([() => ({ toolCalls: [call("c1", READ.providerName)] }), () => ({ text: "never" })], hanging, { minter: orphan, signal: ctl.signal });
    expect(discarded.result.status).toBe("cancelled");
    expect(orphan.retired).toEqual([["run_cancelled", true]]);
  });

  it("the grant is the run's ONE side-effecting artifact: a proposal requested after it is refused proposal_exists without reaching the gateway", async () => {
    const grant = grantOf("preview_then_confirm");
    const gateway = gatewayDouble([grantOutcome(grant, "preview_then_confirm")]);
    const { result, adapter } = await run([
      () => ({ toolCalls: [call("c1", READ.providerName)] }),
      () => ({ toolCalls: [call("c2", PROPOSE.providerName, JSON.stringify({}))] }),
      () => ({ text: "done" }),
    ], gateway, { minter: minterDouble(async () => { throw new Error("never"); }) });
    expect(result.status).toBe("completed");
    expect(gateway.invoked).toEqual([READ.toolId]); // the proposal never reached the gateway
    expect(resultsOf(adapter, 1)[0]).toMatchObject({ ok: false, status: "proposal_exists" });
  });
});
