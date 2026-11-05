/**
 * [K2, 2026-11-04] Section K, increment K2 (runbook K.2, K.8 item 1; OD-260 item 6): the chat's TYPED acquisition event and the identical-
 * call guard's revision key, over the PRODUCTION chat loop, gateway, registry and acquisition port under the fixture runtime (a scripted
 * provider stands in for the model; the fixture runtime's in-memory durable repository; the committed fixture CAD transport). US$0: no
 * paid call, no provider, no database, and the global `fetch` is a recording stub every case leaves uncalled.
 *
 *  1. a chat start answers `acquisition_task_ready` (the task's reference: identities and public state only) after a tool_finished
 *     `acquisition_task_started`; the model gets the read result it always got; a second start attaches (`acquisition_task_attached`);
 *     the Work log follows the reference, and the reference alone changes nothing in the store;
 *  2. the task's real progress reaches the Work log: a worker's slice over the fixture source, then the task's public view folded -
 *     ordered rows with their phases (dispatched, received, stored, validated, waiting for a person), the source's registry
 *     documentation link, no URL or hash path of the bytes;
 *  3. the guard keeps its strictness for everything else: an identical non-task read is refused on its third call with the old
 *     sentence, the probe answers null for it and for a list read, and a probe that throws or answers garbage is judged on the args-only
 *     count;
 *  4. a gateway without the probe (every test double) keeps the args-only key;
 *  5. [K2 review, 2026-11-04] tests-K2-R4: a probe that never settles is bounded at 5 s inside the loop (fake timers): the call is judged
 *     on the args-only count and the run answers - not at its deadline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { resolveCatalogInspectionPort } from "@/app/api/chat/catalog-inspection-runtime";
import { resetCadAcquisitionPortFactory, resolveCadAcquisitionPort } from "@/app/api/chat/cad-acquisition-runtime";
import { resolveRevisionEvidencePort } from "@/app/api/chat/revision-evidence-runtime";
import { resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { DIMMER_INSTANCE_IDS, fixtureDimmerSheet } from "@/app/lib/fixture-runtime/__tests__/_resolution-sheet";
import { createFixtureCadTransport } from "@/app/lib/fixture-runtime/cad-source/transport";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { CAD_ACQUISITION_START_TOOL_ID, CAD_ACQUISITION_STATUS_TOOL_ID, readCadAcquisitionTaskReference, type CadAcquisitionTaskView } from "@/app/lib/acquisition/cad-acquisition-contract";
import { CAD_SOURCE_REGISTRY } from "@/app/lib/acquisition/cad-source-registry";
import { resetComponentResolutionRuntimeFactory, resolveComponentResolutionRuntime, componentResolutionStoreOf } from "@/app/lib/component-resolution/task/runtime";
import { componentResolutionTaskView } from "@/app/lib/component-resolution/task/contracts";
import { componentResolutionTopicRunner } from "@/app/lib/component-resolution/task/topic-runner";
import { componentResolutionSlicePorts, resetCadSourceInjection, setCadSourceInjection } from "@/app/lib/component-resolution/task/worker-runtime";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { runAgentLoop } from "@/app/lib/agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentStep, type AgentToolInvocationGateway, type AgentToolResult, type ProviderAgentAdapter } from "@/app/lib/agent/contracts";
import { emptyWorkLog, reduceWorkLogAcquisition, reduceWorkLogRunEvent, type WorkLogState } from "@/app/lib/project/work-log";

const SCOPE = { tenantId: "local", projectId: "k2-acquisition-event", branchId: "main" } as const;
const OWNER = { projectId: SCOPE.projectId, branchId: SCOPE.branchId };
const HEAD_MARK = { lineageId: "lin1-4b20000000000001", headSequence: 3, canonicalStateDigest: "eng1-0123456789abcdef" };
const REQUEST = { componentIds: [DIMMER_INSTANCE_IDS.D1, DIMMER_INSTANCE_IDS.D2], requirement: { mounting: "through_hole", packageCode: "DO-35" } };
const INSPECT_TOOL_ID = "sirkit.schematic.instance-inspect";

const fetched: string[] = [];
beforeEach(() => {
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
  vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
  vi.stubEnv("DATABASE_URL", "");
  resetFixtureContainer(); resetComponentResolutionRuntimeFactory(); resetCadAcquisitionPortFactory(); resetCadSourceInjection(); resetAdmissionControl();
  fetched.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => { fetched.push(String(input)); throw new Error("K2 reaches no host: the CAD transport is the committed fixture"); }));
});
afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  resetFixtureContainer(); resetComponentResolutionRuntimeFactory(); resetCadAcquisitionPortFactory(); resetCadSourceInjection(); resetAdmissionControl();
  expect(fetched).toEqual([]);
});

function chatContext(): AgentRunContext {
  const assembly = assembleAgentRunContext({
    ...SCOPE, schematic: fixtureDimmerSheet() as SchematicState, schematicHeadMark: HEAD_MARK,
    verifiedActor: { principalId: "user:k2-editor", actorRole: "pcb_editor", membershipRevision: "mbr1-k2", authMethod: "local_dev" },
    catalogInspectionAvailable: true, cadAcquisitionAvailable: true,
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
function runtimeOf() {
  const runtime = resolveComponentResolutionRuntime();
  if (!runtime?.fixture) throw new Error("the fixture runtime's component-resolution composition did not resolve");
  return runtime;
}
function productionGateway(): AgentToolInvocationGateway {
  const catalog = resolveCatalogInspectionPort();
  const port = resolveCadAcquisitionPort(catalog);
  if (!catalog || !port) throw new Error("the production acquisition port did not resolve under the fixture runtime");
  return createAgentToolGateway(sirkitToolRegistry(), { catalogInspection: catalog, cadAcquisition: port });
}

type Call = { toolId: string; args: Record<string, unknown> | ((last: readonly AgentToolResult[]) => Record<string, unknown>) };
/** One scripted chat run over the production loop: each step calls one tool (args may read the previous results), then answers. */
async function scriptedRun(calls: readonly Call[], gateway: AgentToolInvocationGateway = productionGateway(), runId = "run-k2") {
  const registry = sirkitToolRegistry();
  const events: AgentRunEvent[] = [];
  const results: AgentToolResult[][] = [];
  const names = new Map<string, string>();
  let index = 0;
  const step = (partial: Partial<AgentStep>): AgentStep => ({ text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "k2-scripted", continuation: { provider: "openai", state: null }, ...partial });
  const next = (last: readonly AgentToolResult[]): AgentStep => {
    const call = calls[index];
    index += 1;
    if (!call) return step({ text: "(scripted) done." });
    const args = typeof call.args === "function" ? call.args(last) : call.args;
    return step({ toolCalls: [{ callId: `c${index}`, providerName: names.get(call.toolId) ?? "", argumentsText: JSON.stringify(args) }] });
  };
  const adapter: ProviderAgentAdapter = {
    provider: "openai",
    async start(input) { for (const tool of input.tools) names.set(tool.toolId, tool.providerName); return next([]); },
    async continueWith(input) { results.push([...input.results]); return next(input.results); },
  };
  const result = await runAgentLoop(
    { runId, provider: "openai", history: [], userMessage: "Obtain the assets for D1 and D2.", budget: DEFAULT_AGENT_BUDGET },
    { adapter, gateway, registry, context: chatContext(), system: "k2 scripted run", emit: (event) => events.push(event) },
  );
  return { result, events, results };
}
const taskIdOf = (result: AgentToolResult | undefined): string => {
  const parsed = JSON.parse(result?.outputText ?? "{}") as { output?: { report?: { tasks?: Array<{ taskId: string }> } } };
  const taskId = parsed.output?.report?.tasks?.[0]?.taskId;
  if (!taskId) throw new Error(`no task in ${result?.outputText.slice(0, 200)}`);
  return taskId;
};
const fold = (events: readonly AgentRunEvent[], seed: WorkLogState = emptyWorkLog(OWNER)): WorkLogState => events.reduce((state, event, at) => reduceWorkLogRunEvent(state, { ...event, seq: at + 1 } as Record<string, unknown>), seed);

describe("[K2] the chat's typed acquisition event and the revision-keyed identical-call guard", () => {
  it("1. a chat start answers acquisition_task_ready after tool_finished acquisition_task_started; the model gets the read result it always got; a second start attaches; the Work log follows the reference, which changes nothing", async () => {
    const run = await scriptedRun([{ toolId: CAD_ACQUISITION_START_TOOL_ID, args: REQUEST }, { toolId: CAD_ACQUISITION_START_TOOL_ID, args: REQUEST }]);
    expect(run.result.status).toBe("completed");
    const types = run.events.map((event) => event.type);
    expect(types.filter((type) => type !== "warning")).toEqual(["run_started", "tool_started", "tool_finished", "acquisition_task_ready", "tool_started", "tool_finished", "acquisition_task_ready", "text_delta", "run_completed"]);
    const finished = run.events.filter((event): event is Extract<AgentRunEvent, { type: "tool_finished" }> => event.type === "tool_finished");
    expect(finished.map((event) => event.status)).toEqual(["acquisition_task_started", "acquisition_task_attached"]);
    const ready = run.events.filter((event): event is Extract<AgentRunEvent, { type: "acquisition_task_ready" }> => event.type === "acquisition_task_ready");
    const taskId = taskIdOf(run.results[0]![0]);
    expect(ready.map((event) => [event.callId, event.task.taskId, event.task.disposition])).toEqual([["c1", taskId, "started"], ["c2", taskId, "attached"]]);
    for (const event of ready) expect(readCadAcquisitionTaskReference(JSON.parse(JSON.stringify(event.task)))).toEqual(event.task); // the page's reader accepts exactly it
    expect(JSON.stringify(ready)).not.toMatch(/https?:|sha256|kicad_sym|schematic|principal/i);
    // the model's result is the read's shape (ok, tool, revision, verification, output.report), unchanged by K2
    const modelResult = JSON.parse(run.results[0]![0]!.outputText) as Record<string, unknown>;
    expect(Object.keys(modelResult).sort()).toEqual(["ok", "output", "revision", "tool", "verification"]);
    // the Work log: the dispatch rows, then the follow; the store holds one task, still queued (the reference changed nothing)
    const log = fold(run.events);
    expect(log.follows).toEqual([{ kind: "acquisition", taskId, cursor: 0, terminal: false, state: "queued" }]);
    expect(log.rows.map((row) => row.phase)).toEqual(["dispatched", "dispatched", "waiting", "dispatched", "received", "waiting"]);
    expect(log.rows[1]!.text).toMatch(/acquisition task started — a worker runs it in saved steps; nothing in the design changed$/);
    expect(log.rows[4]!.text).toMatch(/following the acquisition task that already exists for these parts — nothing new was started$/); // [K2 review, 2026-11-04] honesty-K2-PT-2, reviewed pin move: was "already running for these parts" - the store attaches to a task in ANY state (this one is queued), so the run line names none; the Work log's follow row says the real state
    expect(log.rows[5]!.text).toMatch(/\(already queued for a worker; nothing new started\)/); // [K2 review, 2026-11-04] PT-2: the attached task's real state
    const stored = await componentResolutionStoreOf(runtimeOf()).list(SCOPE);
    expect(stored.map((head) => [head.taskId, head.state])).toEqual([[taskId, "queued"]]);
  });

  it("2. the task's real progress reaches the Work log: a worker's slice over the fixture source, then its public view folded - ordered phases, the source's registry documentation link, no URL of the bytes", async () => {
    const run = await scriptedRun([{ toolId: CAD_ACQUISITION_START_TOOL_ID, args: REQUEST }]);
    const taskId = taskIdOf(run.results[0]![0]);
    let log = fold(run.events);
    const runtime = runtimeOf();
    const transport = createFixtureCadTransport();
    setCadSourceInjection({ fixtureEgress: { fetch: transport.fetch, resolve: transport.resolve }, fixtureAllowed: true });
    const catalog = resolveCatalogInspectionPort();
    const evidence = resolveRevisionEvidencePort();
    if (!catalog || !evidence) throw new Error("the fixture runtime's catalog and evidence ports did not resolve");
    const store = componentResolutionStoreOf(runtime);
    const runner = componentResolutionTopicRunner({ store, revalidate: async () => ({ ok: true }), ports: () => componentResolutionSlicePorts(runtime, { catalog, evidence }) });
    const [slice] = await runner.claim({ workerId: "k2-worker", limit: 1 });
    expect(slice).toBeDefined();
    // the page reads the task between the claim and the slice's end, then after it: each event once, in order
    const read = async (): Promise<CadAcquisitionTaskView> => componentResolutionTaskView((await store.get(SCOPE, taskId))!.task);
    log = reduceWorkLogAcquisition(log, await read(), OWNER);
    const afterClaim = log.rows.length;
    await slice!.run({ signal: new AbortController().signal, boundary: async () => "continue" });
    const view = await read();
    log = reduceWorkLogAcquisition(log, view, OWNER);
    log = reduceWorkLogAcquisition(log, view, OWNER); // a repeated read adds nothing
    const acquisitionRows = log.rows.filter((row) => row.origin === "acquisition");
    expect(acquisitionRows.map((row) => row.key)).toEqual(view.events.map((event) => `acquisition:${taskId}:${event.seq}`)); // every stored event, once, in order
    expect(log.rows.length).toBeGreaterThan(afterClaim);
    const phases = acquisitionRows.map((row) => row.phase);
    for (const phase of ["dispatched", "received", "stored", "validated", "waiting"] as const) expect(phases, phase).toContain(phase);
    expect(phases.indexOf("received")).toBeLessThan(phases.indexOf("validated")); // bytes received before they were validated
    expect(acquisitionRows.find((row) => row.attempt !== null)?.attempt).toBe(1);
    expect(acquisitionRows.at(-1)).toMatchObject({ phase: "waiting", next: expect.stringContaining("Send the package for component review") });
    const fixtureDocs = CAD_SOURCE_REGISTRY["fixture-kicad"].provider.documentation[0];
    expect(acquisitionRows.some((row) => row.source?.href === fixtureDocs)).toBe(true);
    const text = JSON.stringify(log);
    expect(text).not.toMatch(/https?:\/\/(?!www\.kicad\.org\/libraries\/license\/)/); // no locator, fixture host or signed URL; only the registry's documentation
    expect(transport.requests.length).toBeGreaterThan(0); // the bytes really came through the fixture transport
    expect(log.follows[0]).toMatchObject({ taskId, state: view.state, terminal: false });
  });

  it("3. the guard keeps its strictness for everything else: an identical non-task read is refused on its third call with the old sentence; the probe answers null for it and for a list read; a probe that throws or answers garbage is judged on the args-only count", async () => { // [K2 review, 2026-11-04] tests-K2-R4: the title said "throws or hangs" but only "throws" and "garbage" ran here; the hang is case 5
    const inspect = { toolId: INSPECT_TOOL_ID, args: { componentIds: ["D1"] } };
    const run = await scriptedRun([inspect, inspect, inspect]);
    const refused = run.events.filter((event): event is Extract<AgentRunEvent, { type: "tool_refused" }> => event.type === "tool_refused");
    expect(refused.map((event) => [event.callId, event.toolId, event.status])).toEqual([["c3", INSPECT_TOOL_ID, "repeated_call"]]);
    expect(JSON.parse(run.results[2]![0]!.outputText)).toEqual({ ok: false, status: "repeated_call", detail: "This exact call already ran in this run; its result has not changed." });
    // the probe: only a status read of ONE task answers a revision
    const gateway = productionGateway();
    const registry = sirkitToolRegistry();
    const version = (toolId: string) => registry.get(toolId)!.version;
    const context = chatContext();
    const probe = (toolId: string, args: Record<string, unknown>) => gateway.observedRevision!({ runId: "run-k2", provider: "openai", toolId, version: version(toolId), args, context });
    expect(await probe(INSPECT_TOOL_ID, { componentIds: ["D1"] })).toBeNull();
    expect(await probe(CAD_ACQUISITION_STATUS_TOOL_ID, {})).toBeNull();
    expect(await probe(CAD_ACQUISITION_START_TOOL_ID, REQUEST)).toBeNull();
    expect(await probe(CAD_ACQUISITION_STATUS_TOOL_ID, { taskId: `cr-task:${"0".repeat(32)}` })).toBeNull(); // unknown task
    const started = await scriptedRun([{ toolId: CAD_ACQUISITION_START_TOOL_ID, args: REQUEST }]);
    const taskId = taskIdOf(started.results[0]![0]);
    expect(await probe(CAD_ACQUISITION_STATUS_TOOL_ID, { taskId })).toMatch(new RegExp(`^${taskId}\\|queued\\|`));
    // a probe that throws or answers garbage on the third read: it is judged on ALL identical calls - refused, never looser
    for (const misbehaving of ["throws", "garbage"] as const) {
      let calls = 0;
      const flaky: AgentToolInvocationGateway = {
        invoke: (input) => gateway.invoke(input),
        observedRevision: async (input) => {
          calls += 1;
          if (calls < 3) return gateway.observedRevision!(input);
          if (misbehaving === "throws") throw new Error("probe failed");
          return "x".repeat(10_000); // past the probe's bound: treated as no revision
        },
      };
      const status = { toolId: CAD_ACQUISITION_STATUS_TOOL_ID, args: { taskId } };
      const flakyRun = await scriptedRun([status, status, status], flaky, `run-k2-${misbehaving}`);
      expect(flakyRun.events.filter((event) => event.type === "tool_refused").map((event) => (event as { callId: string }).callId), misbehaving).toEqual(["c3"]);
      expect(JSON.parse(flakyRun.results[2]![0]!.outputText).detail).toBe("This exact call already ran in this run; its result has not changed.");
    }
  });

  it("4. a gateway without the probe (every test double) keeps the args-only key", async () => {
    const gateway = productionGateway();
    const plain: AgentToolInvocationGateway = { invoke: (input) => gateway.invoke(input) };
    const started = await scriptedRun([{ toolId: CAD_ACQUISITION_START_TOOL_ID, args: REQUEST }], plain);
    const taskId = taskIdOf(started.results[0]![0]);
    const status = { toolId: CAD_ACQUISITION_STATUS_TOOL_ID, args: { taskId } };
    const run = await scriptedRun([status, status, status], plain, "run-k2-plain");
    expect(run.events.filter((event) => event.type === "tool_refused").map((event) => (event as { callId: string }).callId)).toEqual(["c3"]);
  });

  it("5. [K2 review] a probe that never settles is bounded at 5 s inside the loop: the call is judged on the args-only count and the run answers", async () => {
    const gateway = productionGateway();
    const started = await scriptedRun([{ toolId: CAD_ACQUISITION_START_TOOL_ID, args: REQUEST }]);
    const taskId = taskIdOf(started.results[0]![0]);
    let calls = 0;
    let hanging = 0;
    const hung: AgentToolInvocationGateway = {
      invoke: (input) => gateway.invoke(input),
      observedRevision: (input) => {
        calls += 1;
        if (calls < 3) return gateway.observedRevision!(input);
        hanging += 1;
        return new Promise<string | null>(() => undefined); // a stalled store read: it never settles
      },
    };
    const status = { toolId: CAD_ACQUISITION_STATUS_TOOL_ID, args: { taskId } };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let answered = false;
      const pending = scriptedRun([status, status, status], hung, "run-k2-hangs").then((run) => { answered = true; return run; });
      for (let turn = 0; turn < 200 && hanging === 0; turn += 1) await vi.advanceTimersByTimeAsync(0);
      expect(hanging, "the third read reached the probe").toBe(1);
      await vi.advanceTimersByTimeAsync(4_990);
      expect(answered, "nothing answers before the probe's bound").toBe(false);
      for (let turn = 0; turn < 200 && !answered; turn += 1) await vi.advanceTimersByTimeAsync(10);
      expect(answered, "the 5 s bound released the call").toBe(true);
      const run = await pending;
      expect(run.result.status).toBe("completed");
      expect(run.events.filter((event) => event.type === "tool_refused").map((event) => (event as { callId: string }).callId)).toEqual(["c3"]);
      expect(JSON.parse(run.results[2]![0]!.outputText).detail).toBe("This exact call already ran in this run; its result has not changed.");
    } finally {
      vi.useRealTimers();
    }
  });
});
