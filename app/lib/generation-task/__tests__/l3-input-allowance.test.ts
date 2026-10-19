/**
 * [PR-L6, 2026-10-19] OD-253 item 6 (live-run.md H, D2 and D3): the per-task allowance's INPUT dimension and the pre-call input admission,
 * through the real `GenerationWorker`, `GenerationTaskStore` and slice code.
 *
 *  1. across a block that spans several slices, the SUM of the input the provider reported never exceeds the unit's input times its units:
 *     the call whose bound does not fit what remains is NEVER sent (the provider sees no request), the task parks waiting-for-resource /
 *     allowance_exhausted with the block's last turn-boundary checkpoint kept and "Continue with another allowance" listed; every admitted
 *     call's bound was recorded on its reservation BEFORE it was sent; extending adds one input unit and the block resumes from its
 *     checkpoint with no search repeated;
 *  2. the plan slice is gated the same way (a plan call that does not fit is never sent);
 *  3. a reported input above its call's bound (the estimator's self-check) stops the slice before any further call, and the worker log says so;
 *  4. a call whose completion is unknown (abandoned at its per-call bound) stays charged at its bound as `uncertainInputTokens`; the next
 *     claim sees it, and with settled + uncertain input at the limit the claim itself refuses (no model call).
 *
 * The scripted provider reports 40 % of each request's bound as its input (a fake, offline); the in-memory durable repository; a simulated
 * clock. No provider, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { durableAggregateIdentity } from "../../durable-workflow/stable";
import type { LLMRequest, LLMResponse } from "../../llm/types";
import type { BuildLlmPort } from "../../schematic/build-loop-slice";
import { GENERATION_TASK_AGGREGATES, GENERATION_TASK_ALLOWANCE_UNIT, generationInputRemaining, type GenerationAllowanceUnit, type GenerationTaskHead } from "../contracts";
import { buildGenerationTaskSnapshot } from "../snapshot";
import { generationRequestInputBound } from "../worker/accounting";
import { NETLISTS, ScriptedModel, drive, droneCatalog, l3Env, reply, search, startTask, submit, type L3Env } from "./_l3-worker-fixtures";

const NEVER = new Promise<LLMResponse>(() => undefined);
const editor = { principalId: "user-l3-editor", role: "pcb_editor" as const };
/** One block (the planner answers no submit_plan): three searches, then the submission. */
const QUERIES = ["flight controller mcu", "imu gyro", "decoupling capacitor"];
const singleScripts = () => ({
  plan: () => reply([]),
  blocks: { "": ({ turn }: { turn: number }) => (turn <= QUERIES.length ? reply([search(`call_main_${turn}`, QUERIES[turn - 1]!)]) : reply([submit("call_main_submit", NETLISTS["Flight controller"])])) },
});

/** The provider seam: every call's bound (computed as the admission computes it) and the input it reports (40 % of the bound, or an override). */
class ReportingPort implements BuildLlmPort {
  readonly bounds: number[] = [];
  readonly reported: number[] = [];
  constructor(readonly inner: ScriptedModel, private readonly reportOf: (bound: number, index: number) => number = (bound) => Math.floor(bound * 0.4)) {}
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const index = this.bounds.length;
    const bound = generationRequestInputBound(request);
    this.bounds.push(bound);
    const response = await this.inner.generate(request);
    const input = this.reportOf(bound, index);
    this.reported.push(input);
    return { ...response, usage: { inputTokens: input, outputTokens: 60 } };
  }
}
const unitWith = (inputTokens: number): GenerationAllowanceUnit => ({ ...GENERATION_TASK_ALLOWANCE_UNIT, inputTokens });
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/** A full run with an input limit that never binds: the deterministic bounds and reported inputs of the five calls (plan, four turns). */
async function calibrate(): Promise<{ bounds: number[]; reported: number[] }> {
  const env = l3Env({ name: `input-calibration-${Math.random().toString(36).slice(2, 8)}`, repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
  const port = new ReportingPort(new ScriptedModel(singleScripts(), env.time, () => 1_000));
  const task = await startTask(env, { allowanceUnit: unitWith(50_000_000) });
  await drive(env, env.worker({ llm: port }), task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 20 });
  expect(port.bounds).toHaveLength(5);
  for (let index = 1; index < 4; index += 1) expect(port.bounds[index + 1]!).toBeGreaterThan(port.bounds[index]!); // a turn grows the conversation
  return { bounds: port.bounds, reported: port.reported };
}
const snapshotOf = (env: L3Env, task: GenerationTaskHead) => buildGenerationTaskSnapshot(task, { nowMs: env.time.now(), processing: [] });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("[PR-L6] the input dimension of the task allowance and the pre-call input admission (OD-253 item 6)", () => {
  it("1. a block over several slices never sends a call whose bound does not fit; the task parks with its checkpoint; another allowance adds one input unit and the block resumes", { timeout: 60_000 }, async () => {
    const { bounds, reported } = await calibrate();
    // the limit admits the plan and the first turn, and refuses the second turn by one token
    const limit = reported[0]! + reported[1]! + bounds[2]! - 1;
    expect(bounds[0]!).toBeLessThanOrEqual(limit);
    expect(reported[0]! + bounds[1]!).toBeLessThanOrEqual(limit);
    const catalog = droneCatalog();
    const env = l3Env({ name: "input-park", repository: new InMemoryDurableWorkflowRepository(), catalog, storeOptions: { blockTurnsPerSlice: 2 } });
    const port = new ReportingPort(new ScriptedModel(singleScripts(), env.time, () => 1_000));
    const task = await startTask(env, { allowanceUnit: unitWith(limit) });
    const worker = env.worker({ llm: port });
    const parked = await drive(env, worker, task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 20 });

    // the refused call was never sent: the provider saw the plan and the first turn only
    expect(port.inner.requests).toHaveLength(2);
    expect(parked.task.usage.inputTokens).toBe(reported[0]! + reported[1]!);
    expect(parked.task.usage.inputTokens).toBeLessThanOrEqual(limit);
    expect(parked.task.usage.modelCalls).toBe(2); // the refusal is never a model call
    expect(parked.task.usage).not.toHaveProperty("uncertainInputTokens");
    expect(parked.task.blocker).toMatchObject({ code: "allowance_exhausted" });
    expect(parked.task.blocks.main).toMatchObject({ status: "blocked", blocker: "allowance_exhausted", turnsUsed: 1, strategy: "S1-baseline" });
    expect(parked.task.reservations).toEqual([]);
    const checkpoint = await env.store.readBlock(env.scope, parked.task, "main");
    expect(checkpoint).toMatchObject({ turnsUsed: 1, result: null }); // the last turn boundary's checkpoint is kept
    const snapshot = snapshotOf(env, parked.task);
    expect(snapshot.actions).toContain("extend-allowance");
    expect(snapshot.allowance.remaining.inputTokens).toBe(limit - reported[0]! - reported[1]!);
    expect(env.logs.some((line) => /sirkit_input_allowance_exhausted/.test(line))).toBe(true);
    // every admitted call's bound was recorded on its reservation BEFORE the call was sent (a crash inside it stays charged)
    const heads = (await env.repository.history<GenerationTaskHead>(durableAggregateIdentity(env.scope, GENERATION_TASK_AGGREGATES.head, task.taskId))).map((record) => record.payload);
    for (const bound of bounds.slice(0, 2)) expect(heads.some((revision) => revision.reservations.some((entry) => entry.inputTokens === bound)), `bound ${bound} recorded`).toBe(true);
    expect(heads.some((revision) => revision.reservations.some((entry) => entry.inputTokens === bounds[2]))).toBe(false); // the refused call's bound never was

    // another allowance: one more input unit; the block resumes from its checkpoint, no search repeated, and completes
    expect(await env.store.control({ scope: env.scope, taskId: task.taskId, principal: editor, action: "resume", clientActionId: "extend-input-1", extendAllowance: true })).toMatchObject({ ok: true, task: { allowance: { units: 2 } } });
    const { task: done } = await drive(env, worker, task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 20 });
    const turns = port.inner.calls.filter((call) => call.kind === "block").map((call) => call.turn);
    expect(turns).toEqual([1, 2, 3, 4]); // the second turn continued the committed conversation; nothing was asked twice
    const resumed = port.inner.requests[2]!;
    expect(resumed.messages).toEqual(checkpoint!.messages);
    expect(catalog.searches.map((entry) => entry.query)).toEqual(QUERIES); // each search once, across the park and the resume
    expect(sum(port.reported)).toBe(done.usage.inputTokens);
    expect(done.usage.inputTokens).toBeLessThanOrEqual(limit * 2);
    expect(done.result).toMatchObject({ status: "complete" });
  });

  it("2. the plan slice is gated too: a plan call whose bound does not fit is never sent", { timeout: 60_000 }, async () => {
    const { bounds } = await calibrate();
    const env = l3Env({ name: "input-plan", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const port = new ReportingPort(new ScriptedModel(singleScripts(), env.time, () => 1_000));
    const task = await startTask(env, { allowanceUnit: unitWith(bounds[0]! - 1) });
    const { task: parked } = await drive(env, env.worker({ llm: port }), task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 5 });
    expect(port.inner.requests).toHaveLength(0);
    expect(parked).toMatchObject({ plan: null, blocker: { code: "allowance_exhausted" }, usage: { modelCalls: 0, inputTokens: 0 } });
    // another unit fits the plan
    await env.store.control({ scope: env.scope, taskId: task.taskId, principal: editor, action: "resume", clientActionId: "extend-plan-1", extendAllowance: true });
    await drive(env, env.worker({ llm: port }), task.taskId, { until: (current) => current.plan !== null, maxTicks: 5 });
    expect(port.inner.planCalls).toBe(1);
  });

  it("3. a reported input above its bound stops the slice before any further call (the estimator's self-check), and the worker log says so", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "input-violation", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const port = new ReportingPort(new ScriptedModel(singleScripts(), env.time, () => 1_000), (bound, index) => (index === 1 ? bound + 5 : Math.floor(bound * 0.4)));
    const task = await startTask(env, { allowanceUnit: unitWith(50_000_000) });
    const { task: stopped } = await drive(env, env.worker({ llm: port }), task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 10 });
    expect(port.inner.requests).toHaveLength(2); // the plan and the turn that over-reported; nothing after it
    expect(stopped.usage.inputTokens).toBe(port.reported[0]! + port.bounds[1]! + 5); // what was reported is charged exactly
    expect(stopped.blocks.main).toMatchObject({ status: "blocked", blocker: "platform_failure", turnsUsed: 1 });
    expect(env.logs.some((line) => line.includes(`reported ${port.bounds[1]! + 5} input tokens, above its admitted bound ${port.bounds[1]!}`))).toBe(true);
  });

  it("4. a call abandoned at its per-call bound stays charged at its bound as uncertain input; at the limit the next claim refuses with no model call", { timeout: 60_000 }, async () => {
    const { bounds, reported } = await calibrate();
    const limit = reported[0]! + reported[1]! + bounds[2]!; // the second turn fits exactly
    const env = l3Env({ name: "input-uncertain", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel(singleScripts(), env.time, () => 100); // well inside the per-call bound below (simulated time)
    let hang = true;
    model.intercept = (request, kind) => {
      const turn = request.messages.filter((message) => message.role === "assistant").length + 1;
      if (kind === "block" && turn === 2 && hang) { hang = false; return NEVER; }
      return undefined;
    };
    const port = new ReportingPort(model);
    const task = await startTask(env, { allowanceUnit: unitWith(limit) });
    // the per-call bound fires on a real timer (a short real wait in this test)
    const worker = env.worker({ llm: port, policy: { perCallMs: 300 } });
    const waiting = await drive(env, worker, task.taskId, { until: (current) => current.state === "waiting-for-provider", maxTicks: 10 });
    expect(waiting.task.usage).toMatchObject({ inputTokens: reported[0]! + reported[1]!, uncertainInputTokens: bounds[2]!, uncertainModelCalls: 1 });
    expect(generationInputRemaining(waiting.task)).toBe(0); // the next admission sees the uncertain bound
    const { task: parked } = await drive(env, worker, task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 10 });
    expect(port.inner.requests).toHaveLength(3); // the plan, the first turn and the abandoned one: the claim refused before any call
    expect(parked.blocker).toMatchObject({ code: "allowance_exhausted" });
    expect(parked.blocks.main).toMatchObject({ status: "blocked", blocker: "allowance_exhausted", turnsUsed: 1 });
    expect(parked.milestones.filter((event) => event.type === "worker_claimed" && event.blockId === "main")).toHaveLength(1); // the refused claim never ran the slice
  });

  it("5. a turn abandoned at its per-call bound whose answer still arrives is charged - exactly, or at its bound - never dropped from the input usage", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "input-late", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    // every block call takes longer than the per-call bound on the slice's (simulated) clock: the turn is abandoned, the answer arrives
    const port = new ReportingPort(new ScriptedModel(singleScripts(), env.time, (kind) => (kind === "block" ? 1_000 : 10)));
    const task = await startTask(env, { allowanceUnit: unitWith(50_000_000) });
    const { task: waiting } = await drive(env, env.worker({ llm: port, policy: { perCallMs: 300 } }), task.taskId, { until: (current) => current.state === "waiting-for-provider", maxTicks: 10 });
    expect(port.inner.requests).toHaveLength(2);
    expect(waiting.blocks.main).toMatchObject({ turnsUsed: 0 }); // the turn was discarded
    // the provider did the work for the abandoned call: its input is in the usage (reported, or charged at its bound while unknown)
    expect(waiting.usage.inputTokens + (waiting.usage.uncertainInputTokens ?? 0)).toBeGreaterThanOrEqual(port.reported[0]! + Math.floor(port.bounds[1]! * 0.4));
  });

  it("6. the pre-call record is everything the attempt has not committed: a planner correction's record carries the first answer's input and its own bound", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "input-record", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    let plans = 0;
    const scripts = { ...singleScripts(), plan: () => ((plans += 1) === 1 ? reply([{ id: "call_plan_cut", name: "submit_plan", input: { _raw: "{\"blocks\":[" } }], { stopReason: "max_tokens" }) : reply([])) };
    const port = new ReportingPort(new ScriptedModel(scripts, env.time, () => 1_000));
    const task = await startTask(env, { allowanceUnit: unitWith(50_000_000) });
    await drive(env, env.worker({ llm: port }), task.taskId, { until: (current) => current.plan !== null, maxTicks: 3 });
    expect(port.bounds).toHaveLength(2); // the cut plan, then its one correction
    const heads = (await env.repository.history<GenerationTaskHead>(durableAggregateIdentity(env.scope, GENERATION_TASK_AGGREGATES.head, task.taskId))).map((record) => record.payload);
    const records = heads.flatMap((revision) => revision.reservations.map((entry) => entry.inputTokens)).filter((value): value is number => typeof value === "number");
    expect(records).toEqual([port.bounds[0]!, port.reported[0]! + port.bounds[1]!]); // a crash inside the correction leaves both charged
  });
});
