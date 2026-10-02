/**
 * [B22-B] The process-backed computations are inert sealed REQUESTS a human approves (runbook B22-B :918-920; OD-139, OD-149):
 * sealing runs nothing and yields plain, digest-pinned data; nothing consumes a request until a HUMAN with an approving role in the
 * request's own scope approves its exact digest; the AI can neither approve nor consume one - an agent approver is refused, the agent
 * gateway, discovery and toolset never reach the two dormant descriptors, and no tool names an approval or a consumption; an approved
 * request is consumed once, by the server's executors only: the pinned SPICE analysis runs on the B22-A3 diagnostic runner (faked
 * here at its module seam: no process starts) from a deck the server writes from numbers alone, and its result is diagnostic
 * evidence, never authority; the placement experiment's engine has no worker entry in this build and is refused closed. The CD-10
 * stub still throws. [B22-B review] Cases 7 and 8 also pin a racing consumption and an approved request's expiry (tests-7), and the
 * circuit executor's screen, its AC and transient readings and its closed refusals (tests-11; SEC-1's screen observed at its module).
 */
import { describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({ requests: [] as Array<Record<string, unknown>>, raw: "" as string, outcome: "exited" as string }));
vi.mock("@/app/lib/computation/diagnostic-runner", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    runDiagnosticNgspice: async (request: Record<string, unknown>) => {
      runner.requests.push(request);
      return Object.freeze({ runId: "diagrun_00000000-0000-4000-8000-000000000000", profileId: "ngspice-local-diagnostic", profileDigest: "x", installDigest: `sirkit-install-tree-sha256/1:${"c".repeat(64)}`, labels: ["diagnostic_only", "environment_dependent"], operation: "run", outcome: runner.outcome, spawned: true, killReason: null, exitCode: 0, stdout: "", stderr: "", raw: { state: "read", text: runner.raw }, wallClockMs: 10_000, hostAddedEnvironment: [] });
    },
  };
});
// [B22-B review] tests-11: SEC-1's final screen, observed (it still screens; `refuse` makes it refuse) - which deck it saw, how often
const screen = vi.hoisted(() => ({ decks: [] as string[], refuse: false }));
vi.mock("@/app/lib/spice/netlist", async (orig) => {
  const actual = (await orig()) as Record<string, unknown> & { assertCompiledDeckSafe: (deck: string, expected: unknown) => string };
  return {
    ...actual,
    assertCompiledDeckSafe: (deck: string, expected: unknown) => {
      screen.decks.push(deck);
      if (screen.refuse) throw new Error("SPICE_DECK_REFUSED: refused by the test");
      return actual.assertCompiledDeckSafe(deck, expected);
    },
  };
});

import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { buildRunToolset } from "@/app/lib/agent/loop";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { discoverTools } from "@/app/lib/engineering/tool-discovery";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { executeAuthoritativeSimulation } from "@/app/lib/model-simulation/safe-execution";
import { COMPUTATION_REQUEST_SCHEMA, COMPUTATION_REQUEST_TTL_MS, ComputationRequestStore, computationEvidence, sealComputationRequest, verifySealedComputationRequest, type ComputationRequestActor, type SealedComputationRequest } from "@/app/lib/computation/requests";
import { buildCircuitAnalysisDeck, createComputationRequestExecutors } from "@/app/lib/computation/request-executors";
import { makeBoard, makeInstance, makeResistorDef } from "@/app/lib/pcb/__tests__/autoplace-fixture";

const SCOPE = { tenantId: "t-b22b", projectId: "p-b22b", branchId: "main" };
const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const NEWLINE = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const AGENT = { actorId: "agent-run-1", actorKind: "agent" as const };
const human = (role: ComputationRequestActor["role"], scope = SCOPE): ComputationRequestActor => ({ actorId: "u-1", actorKind: "human", role, scope });
const DIVIDER = { circuit: "resistor-divider", vin: 5, r1: 1_000, r2: 2_000 };
let nonces = 0;
const seal = (args: unknown = DIVIDER, kindId = "sirkit.computation.circuit-analysis", now = T0): SealedComputationRequest => {
  nonces += 1;
  const sealed = sealComputationRequest({ kindId, args, scope: SCOPE, requestedBy: AGENT, now, nonce: nonces.toString(16).padStart(32, "0") });
  if (!sealed.ok) throw new Error(sealed.errors.join("; "));
  return sealed.request;
};
const OP_RAW = ["Title: * sirkit circuit analysis: resistor-divider", "Date: Thu Oct  1 12:00:00  2026", "Plotname: Operating Point", "Flags: real", "No. Variables: 2", "No. Points: 1", "Variables:", `${TAB}0${TAB}v(out)${TAB}voltage`, `${TAB}1${TAB}i(v1)${TAB}current`, "Values:", ` 0${TAB}3.333333333333333e+00`, `${TAB}-1.666666666666667e-03`, ""].join(NEWLINE);

describe("[B22-B] process-backed computations: inert until a human approves", () => {
  it("1. sealing a process-backed request runs nothing and yields plain, frozen, digest-pinned data naming its profile, validator and budget; a process-free kind, an unknown kind or an input the closed schema does not admit is never sealed", () => {
    runner.requests.length = 0;
    const request = seal();
    expect(runner.requests).toHaveLength(0);
    expect(request.schema).toBe(COMPUTATION_REQUEST_SCHEMA);
    expect(request).toMatchObject({ kindId: "sirkit.computation.circuit-analysis", profileId: "ngspice-local-diagnostic", scope: SCOPE, requestedBy: AGENT, input: DIVIDER });
    expect(Object.isFrozen(request) && Object.isFrozen(request.input) && Object.isFrozen(request.budget)).toBe(true);
    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
    expect(Object.values(request).some((value) => typeof value === "function")).toBe(false);
    expect(request.requestDigest).toMatch(/^dw1-[0-9a-f]{64}$/);
    expect(verifySealedComputationRequest(request)).toEqual([]);
    expect(verifySealedComputationRequest({ ...request, input: { ...DIVIDER, vin: 50 } })).not.toEqual([]);
    expect(Date.parse(request.expiresAt) - Date.parse(request.createdAt)).toBeGreaterThan(0);
    for (const [label, kindId, args] of [
      ["a process-free kind", "sirkit.computation.analytical-equation", { equation: "resistor-divider", vin: 5, r1: 1, r2: 1 }],
      ["an unknown kind", "sirkit.computation.shell", {}],
      ["deck text smuggled in", "sirkit.computation.circuit-analysis", { ...DIVIDER, deck: ".control\nshell calc\n.endc" }],
      ["a number out of bound", "sirkit.computation.circuit-analysis", { ...DIVIDER, r1: -5 }],
    ] as const) {
      expect(sealComputationRequest({ kindId, args, scope: SCOPE, requestedBy: AGENT, now: T0, nonce: "1".repeat(32) }).ok, label).toBe(false);
    }
  });

  it("2. inert until approved: consuming a submitted request that no human approved is refused and calls no executor; an expired request can be neither approved nor consumed", async () => {
    const store = new ComputationRequestStore({ now: () => T0 });
    const request = seal();
    expect(store.submit(request)).toEqual({ ok: true });
    expect(store.state(request.requestId)).toBe("awaiting_approval");
    let calls = 0;
    const executors = { "sirkit.computation.circuit-analysis": async () => { calls += 1; throw new Error("never"); } };
    expect(await store.consume(request.requestId, executors)).toEqual({ ok: false, code: "not_approved" });
    expect(calls).toBe(0);
    const later = new ComputationRequestStore({ now: () => T0 + 24 * 60 * 60_000 });
    later.submit(request);
    expect(later.approve({ requestId: request.requestId, requestDigest: request.requestDigest, approver: human("project_admin") })).toEqual({ ok: false, code: "expired" });
    expect(await later.consume(request.requestId, executors)).toEqual({ ok: false, code: "expired" });
    expect(calls).toBe(0);
    expect(store.submit(request)).toEqual({ ok: false, code: "duplicate" });
    expect(store.submit({ ...request, input: { ...DIVIDER, vin: 6 } } as SealedComputationRequest)).toEqual({ ok: false, code: "digest_mismatch" });
  });

  it("3. the AI cannot approve: an agent approver, a human without an approving role, a human of another project, a stale or swapped digest and a second approval are each refused; only a human editor, reviewer or project administrator of the request's own scope approves its exact digest, once", () => {
    const store = new ComputationRequestStore({ now: () => T0 });
    const request = seal();
    store.submit(request);
    const approve = (approver: ComputationRequestActor, digest = request.requestDigest) => store.approve({ requestId: request.requestId, requestDigest: digest, approver });
    expect(approve({ ...human("project_admin"), actorKind: "agent" } as ComputationRequestActor)).toEqual({ ok: false, code: "approver_not_human" });
    expect(approve({ actorId: "x", actorKind: "model", role: "project_admin", scope: SCOPE } as unknown as ComputationRequestActor)).toEqual({ ok: false, code: "approver_not_human" });
    expect(approve(human("viewer"))).toEqual({ ok: false, code: "role_not_permitted" });
    expect(approve(human("commenter"))).toEqual({ ok: false, code: "role_not_permitted" });
    expect(approve(human("project_admin", { ...SCOPE, projectId: "another" }))).toEqual({ ok: false, code: "scope_mismatch" });
    expect(approve(human("project_admin"), `dw1-${"e".repeat(64)}`)).toEqual({ ok: false, code: "digest_mismatch" });
    expect(store.state(request.requestId)).toBe("awaiting_approval");
    expect(approve(human("reviewer"))).toEqual({ ok: true });
    expect(store.state(request.requestId)).toBe("approved");
    expect(approve(human("project_admin"))).toEqual({ ok: false, code: "not_awaiting_approval" });
    expect(store.approve({ requestId: "nope", requestDigest: request.requestDigest, approver: human("project_admin") })).toEqual({ ok: false, code: "not_found" });
  });

  it("4. the AI cannot consume: the two process-backed descriptors are registered, never agent-exposed and never callable; the agent gateway refuses them with every port bound and calls no executor; discovery and the run toolset never offer them; no tool names an approval or a consumption of a computation", async () => {
    const registry = sirkitToolRegistry();
    for (const toolId of ["sirkit.computation.circuit-analysis", "sirkit.computation.layout-experiment"]) {
      const descriptor = registry.get(toolId)!;
      expect(descriptor, toolId).toMatchObject({ operationClass: "propose", agentExposed: false, callability: "not-callable", binding: { status: "unbound" }, sideEffects: "proposal-artifact" });
      expect(descriptor.binding.notes, toolId).toMatch(/human approval/);
    }
    expect(registry.list().filter((descriptor) => /computation/.test(descriptor.toolId) && /approv|consum|grant|execute/.test(descriptor.toolId))).toEqual([]);
    const board = makeBoard(40, 30, [makeInstance("r1", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2);
    const assembled = assembleAgentRunContext({ ...SCOPE, board, verifiedActor: { principalId: "u-1", actorRole: "project_admin", membershipRevision: "mbr1-a", authMethod: "local_dev" }, computationAvailable: true });
    if (!assembled.ok) throw new Error(assembled.reason);
    const context = assembled.context;
    let portCalls = 0;
    const gateway = createAgentToolGateway(registry, { computation: { evaluate: async () => { portCalls += 1; return { state: "refused", code: "never" }; } } });
    runner.requests.length = 0;
    for (const toolId of ["sirkit.computation.circuit-analysis", "sirkit.computation.layout-experiment"]) {
      const outcome = await gateway.invoke({ runId: "run-b22b", provider: "openai", callId: `call-${toolId}`, toolId, version: "1.0.0", args: toolId.endsWith("analysis") ? DIVIDER : { experiment: "placement", seed: 1, budgetSeconds: 10 }, context, timeoutMs: 5_000 });
      expect(outcome, toolId).toMatchObject({ kind: "refused", ok: false });
      expect(discoverTools(registry, context.discovery).included.some((item) => item.toolId === toolId), toolId).toBe(false);
    }
    expect(portCalls).toBe(0);
    expect(runner.requests).toHaveLength(0);
    const toolset = buildRunToolset(registry, context, () => undefined);
    expect(toolset.declarations.map((declaration) => declaration.toolId).filter((toolId) => toolId.startsWith("sirkit.computation."))).toEqual(["sirkit.computation.analytical-equation", "sirkit.computation.artifact-compare", "sirkit.computation.artifact-parse"]);
  });

  it("5. an approved request is consumed ONCE by the server's executors: the pinned SPICE analysis runs on the diagnostic runner from a deck the server writes from numbers alone (seeded, screened, no caller text); the result is diagnostic evidence, never authority; a second consumption is refused", async () => {
    const store = new ComputationRequestStore({ now: () => T0 });
    const request = seal();
    store.submit(request);
    expect(store.approve({ requestId: request.requestId, requestDigest: request.requestDigest, approver: human("pcb_editor") })).toEqual({ ok: true });
    runner.requests.length = 0;
    runner.raw = OP_RAW;
    runner.outcome = "exited";
    const executors = createComputationRequestExecutors();
    const consumed = await store.consume(request.requestId, executors);
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) return;
    expect(runner.requests).toHaveLength(1);
    const deck = String(runner.requests[0]!.deck);
    expect(runner.requests[0]).toMatchObject({ operation: "run", readRaw: true, holder: SCOPE.tenantId });
    expect(deck).toBe(buildCircuitAnalysisDeck(request.input, "seeded"));
    expect(deck).toContain(".options seed=1");
    expect(deck.split(NEWLINE).filter((line) => /^\s*\.control/i.test(line))).toHaveLength(1);
    expect(deck).not.toMatch(/\.include|\.lib|shell|`/i);
    expect(deck).toContain("R1 in out 1.000000000e+3");
    expect(consumed.evidence).toMatchObject({ schema: "sirkit.computation-evidence.v1", requestId: request.requestId, requestDigest: request.requestDigest, kindId: "sirkit.computation.circuit-analysis", labels: ["diagnostic_only", "environment_dependent"], authoritative: false, outcome: "exited" });
    expect(consumed.evidence.authority).toMatch(/never engineering authority/);
    const vout = (consumed.evidence.result as { quantities: Array<{ name: string; value: number; unit: string }> }).quantities.find((quantity) => quantity.name === "vout");
    expect(vout?.value).toBeCloseTo(10 / 3, 9);
    expect(vout?.unit).toBe("V");
    expect(store.state(request.requestId)).toBe("consumed");
    expect(await store.consume(request.requestId, executors)).toEqual({ ok: false, code: "already_consumed" });
    expect(runner.requests).toHaveLength(1);
    // a malformed or non-finite raw file is refused whole, never half-parsed into evidence
    const second = seal({ ...DIVIDER, vin: 6 });
    store.submit(second);
    store.approve({ requestId: second.requestId, requestDigest: second.requestDigest, approver: human("project_admin") });
    runner.raw = OP_RAW.replace("3.333333333333333e+00", "nan");
    const refused = await store.consume(second.requestId, executors);
    expect(refused.ok).toBe(true);
    if (refused.ok) expect(refused.evidence).toMatchObject({ outcome: "exited", result: null, refusal: "OUTPUT_INVALID" });
  });

  it("6. the placement experiment is refused closed after approval (its engine has no worker entry in this build), no executor exists for a kind the store does not hold, and production simulation authority stays blocked", async () => {
    const store = new ComputationRequestStore({ now: () => T0 });
    const request = seal({ experiment: "placement", seed: 3, budgetSeconds: 20 }, "sirkit.computation.layout-experiment");
    store.submit(request);
    store.approve({ requestId: request.requestId, requestDigest: request.requestDigest, approver: human("project_admin") });
    const consumed = await store.consume(request.requestId, createComputationRequestExecutors());
    expect(consumed.ok).toBe(true);
    if (consumed.ok) expect(consumed.evidence).toMatchObject({ outcome: "refused", refusal: "ENGINE_UNAVAILABLE", result: null, authoritative: false });
    const lone = new ComputationRequestStore({ now: () => T0 });
    const other = seal();
    lone.submit(other);
    lone.approve({ requestId: other.requestId, requestDigest: other.requestDigest, approver: human("project_admin") });
    expect(await lone.consume(other.requestId, {})).toEqual({ ok: false, code: "executor_missing" });
    expect(lone.state(other.requestId)).toBe("approved");
    await expect(executeAuthoritativeSimulation()).rejects.toThrow("CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX");
  });

  it("7. [B22-B review] tests-7: once means once when two consumptions race (one executor call, the other refused already_consumed), and an APPROVED request still expires at its deadline: consumed then, it is refused and no executor runs", async () => {
    let clock = T0;
    const store = new ComputationRequestStore({ now: () => clock });
    const request = seal();
    store.submit(request);
    store.approve({ requestId: request.requestId, requestDigest: request.requestDigest, approver: human("project_admin") });
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const executors = { "sirkit.computation.circuit-analysis": async (sealed: SealedComputationRequest) => { calls += 1; await gate; return computationEvidence(sealed, { outcome: "exited", refusal: null, result: null, provenance: null }); } };
    const racing = Promise.all([store.consume(request.requestId, executors), store.consume(request.requestId, executors)]);
    release();
    const outcomes = await racing;
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([{ ok: false, code: "already_consumed" }]);
    expect(calls).toBe(1);
    const late = seal({ ...DIVIDER, vin: 7 });
    store.submit(late);
    expect(store.approve({ requestId: late.requestId, requestDigest: late.requestDigest, approver: human("reviewer") })).toEqual({ ok: true });
    clock = T0 + COMPUTATION_REQUEST_TTL_MS;
    expect(store.state(late.requestId)).toBe("expired");
    expect(await store.consume(late.requestId, executors)).toEqual({ ok: false, code: "expired" });
    expect(calls).toBe(1);
  });

  it("8. [B22-B review] tests-11: the circuit executor at its seams - SEC-1's final screen sees exactly the seeded deck, once, and the runner runs that deck (a refused screen runs nothing); the AC (complex) and transient raw files summarize; a short raw file, a run that did not exit, a time-zero step and an executor that throws are each closed evidence with no result", async () => {
    const approved = (args: unknown) => {
      const store = new ComputationRequestStore({ now: () => T0 });
      const request = seal(args);
      store.submit(request);
      store.approve({ requestId: request.requestId, requestDigest: request.requestDigest, approver: human("project_admin") });
      return { store, request };
    };
    const executors = createComputationRequestExecutors();
    const consume = async (args: unknown, raw: string, outcome = "exited") => {
      const { store, request } = approved(args);
      runner.requests.length = 0;
      screen.decks.length = 0;
      runner.raw = raw;
      runner.outcome = outcome;
      const consumed = await store.consume(request.requestId, executors);
      if (!consumed.ok) throw new Error(consumed.code);
      return { request, evidence: consumed.evidence };
    };
    // the screen: exactly the seeded deck, once; the runner runs what was screened
    const divider = await consume(DIVIDER, OP_RAW);
    expect(screen.decks).toEqual([buildCircuitAnalysisDeck(divider.request.input, "seeded")]);
    expect(runner.requests.map((request) => request.deck)).toEqual(screen.decks);
    screen.refuse = true;
    try {
      const refused = await consume({ ...DIVIDER, vin: 4 }, OP_RAW);
      expect(refused.evidence).toMatchObject({ outcome: "refused", refusal: "DECK_REFUSED", result: null });
      expect(screen.decks).toHaveLength(1);
      expect(runner.requests).toHaveLength(0);
    } finally {
      screen.refuse = false;
    }
    // AC at one frequency: a complex raw value re,im (here 1 / (1 + j) at the cut-off)
    const AC_RAW = ["Title: * sirkit circuit analysis: one-pole-lowpass", "Date: Thu Oct  1 12:00:00  2026", "Plotname: AC Analysis", "Flags: complex", "No. Variables: 2", "No. Points: 1", "Variables:", `${TAB}0${TAB}frequency${TAB}frequency`, `${TAB}1${TAB}v(out)${TAB}voltage`, "Values:", ` 0${TAB}1.591549430918953e+02,0.000000000000000e+00`, `${TAB}5.000000000000000e-01,-5.000000000000000e-01`, ""].join(NEWLINE);
    const ac = await consume({ circuit: "one-pole-lowpass", r: 1_000, c: 1e-6, frequency: 159.1549430918953 }, AC_RAW);
    expect(ac.evidence).toMatchObject({ outcome: "exited", refusal: null, result: { circuit: "one-pole-lowpass", analysis: "ac", points: 1 } });
    const acQuantities = (ac.evidence.result as { quantities: Array<{ name: string; value: number; unit: string }> }).quantities;
    expect(acQuantities.find((quantity) => quantity.name === "magnitude")?.value).toBeCloseTo(Math.SQRT1_2, 12);
    expect(acQuantities.find((quantity) => quantity.name === "gainDb")?.value).toBeCloseTo(20 * Math.log10(Math.SQRT1_2), 9);
    expect(acQuantities.find((quantity) => quantity.name === "phaseDeg")?.value).toBeCloseTo(-45, 9);
    // a transient: the last point of the step response
    const tranRows = [[0, 0], [1e-3, 0.6321205588285577], [2e-3, 0.8646647167633873]].flatMap(([time, vout], index) => [` ${index}${TAB}${time!.toExponential(15)}`, `${TAB}${vout!.toExponential(15)}`]);
    const TRAN_RAW = ["Title: * sirkit circuit analysis: rc-step", "Date: Thu Oct  1 12:00:00  2026", "Plotname: Transient Analysis", "Flags: real", "No. Variables: 2", "No. Points: 3", "Variables:", `${TAB}0${TAB}time${TAB}time`, `${TAB}1${TAB}v(out)${TAB}voltage`, "Values:", ...tranRows, ""].join(NEWLINE);
    const step = { circuit: "rc-step", vin: 2, r: 1_000, c: 1e-6, time: 0.002 };
    const tran = await consume(step, TRAN_RAW);
    expect(tran.evidence).toMatchObject({ outcome: "exited", refusal: null, result: { circuit: "rc-step", analysis: "tran", points: 3 } });
    const tranQuantities = (tran.evidence.result as { quantities: Array<{ name: string; value: number; unit: string }> }).quantities;
    expect(tranQuantities.find((quantity) => quantity.name === "vout")?.value).toBeCloseTo(0.8646647167633873, 12);
    expect(tranQuantities.find((quantity) => quantity.name === "fraction")?.value).toBeCloseTo(0.8646647167633873 / 2, 12);
    // closed, never half-read: fewer values than `No. Points` declares; a run that did not exit; a step at time zero (nothing runs)
    const short = await consume({ ...step, vin: 3 }, TRAN_RAW.split(NEWLINE).slice(0, -3).join(NEWLINE));
    expect(short.evidence).toMatchObject({ outcome: "exited", refusal: "OUTPUT_INVALID", result: null });
    const timedOut = await consume({ ...DIVIDER, vin: 3 }, OP_RAW, "timeout");
    expect(timedOut.evidence).toMatchObject({ outcome: "timeout", refusal: "NO_OUTPUT", result: null });
    const zero = await consume({ ...step, vin: 4, time: 0 }, TRAN_RAW);
    expect(zero.evidence).toMatchObject({ outcome: "refused", refusal: "CIRCUIT_INPUT_NOT_SIMULABLE", result: null });
    expect(runner.requests).toHaveLength(0);
    expect(screen.decks).toHaveLength(0);
    // an executor that throws is closed evidence, never a thrown consumption
    const { store, request } = approved({ ...DIVIDER, vin: 9 });
    const thrown = await store.consume(request.requestId, { "sirkit.computation.circuit-analysis": async () => { throw new Error("executor broke"); } });
    expect(thrown).toMatchObject({ ok: true, evidence: { outcome: "refused", refusal: "EXECUTOR_FAILED", result: null, authoritative: false } });
    expect(store.state(request.requestId)).toBe("consumed");
  });
});
