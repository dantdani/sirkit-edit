/**
 * [PR-L6 integration, 2026-10-19] F2 (the engine review of increment 6; also the test-integrity review's F1): concurrent slices of one
 * task SHARE the task's input limit (L.6 "ensure concurrent slices share the same accounting"; OD-253 item 6's pre-call admission).
 *
 * Each slice builds its `SliceInputAllowance` from the head it claimed, so slices claimed in one tick each saw almost the whole remainder;
 * the durable pre-call record (`store.admitCall`) recorded the bound but never compared the TASK's total with its limit. A worker at the
 * default `--concurrency 3` (or two worker processes) could therefore send about three times the input allowance. `admitCall` now
 * refuses (`GENERATION_INPUT_ALLOWANCE_EXHAUSTED`) when settled + uncertain + every slice's in-flight input bound would exceed the limit;
 * the fenced compare-and-set head commit serializes the admissions, and the refused call is never sent (`allowance_exhausted`, never
 * `platform_failure`).
 *
 *  1. three block slices of one task at concurrency 3, with a limit that fits one first turn in flight but not three: on EVERY head
 *     revision settled + uncertain + in-flight input stays within the limit, the provider's reported input stays within it, a refused
 *     block parks `allowance_exhausted` with no call sent for it, and nothing becomes `platform_failure`.
 *
 * The scripted provider reports 40 % of each request's bound (offline); the in-memory durable repository; a simulated clock.
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
import { GENERATION_TASK_AGGREGATES, GENERATION_TASK_ALLOWANCE_UNIT, generationAllowanceLimits, generationCommitted, type GenerationAllowanceUnit, type GenerationTaskHead } from "../contracts";
import { generationRequestInputBound } from "../worker/accounting";
import { ScriptedModel, drive, droneCatalog, droneScripts, l3Env, settledOrWaiting, startTask } from "./_l3-worker-fixtures";

/** Every call's bound (as the admission computes it) and a reported input of 40 % of it, in call order. */
class ReportingPort implements BuildLlmPort {
  readonly bounds: number[] = [];
  readonly reported: number[] = [];
  constructor(readonly inner: ScriptedModel) {}
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const bound = generationRequestInputBound(request);
    this.bounds.push(bound);
    const response = await this.inner.generate(request);
    const input = Math.floor(bound * 0.4);
    this.reported.push(input);
    return { ...response, usage: { inputTokens: input, outputTokens: 60 } };
  }
}
const unitWith = (inputTokens: number): GenerationAllowanceUnit => ({ ...GENERATION_TASK_ALLOWANCE_UNIT, inputTokens });
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

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

/** The plan's reported input and each block's first-turn bound, from a run whose limit never binds (one slice at a time). */
async function calibrate(): Promise<{ planReported: number; firstTurn: number[] }> {
  const env = l3Env({ name: "input-concurrency-calibration", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
  const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
  const port = new ReportingPort(model);
  const task = await startTask(env, { allowanceUnit: unitWith(50_000_000) });
  await drive(env, env.worker({ llm: port }), task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 30 });
  expect(model.calls[0]!.kind).toBe("plan");
  const firstTurn = model.calls.flatMap((call, index) => (call.kind === "block" && call.turn === 1 ? [port.bounds[index]!] : []));
  expect(firstTurn).toHaveLength(3);
  return { planReported: port.reported[0]!, firstTurn };
}

describe("[PR-L6 integration] F2: concurrent slices share the task's input limit", () => {
  it("1. at concurrency 3, settled + uncertain + in-flight input never exceeds the limit on any head revision; a refused block parks allowance_exhausted", { timeout: 60_000 }, async () => {
    const { planReported, firstTurn } = await calibrate();
    // one first turn in flight fits; any two at once do not
    const limit = planReported + Math.max(...firstTurn) + Math.floor(Math.min(...firstTurn) / 2);
    const env = l3Env({ name: "input-concurrency", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    const port = new ReportingPort(model);
    const task = await startTask(env, { allowanceUnit: unitWith(limit) });
    const worker = env.worker({ llm: port, policy: { concurrency: 3 } });
    const { task: parked } = await drive(env, worker, task.taskId, { until: settledOrWaiting, maxTicks: 30 });

    expect(generationAllowanceLimits(parked.allowance).inputTokens).toBe(limit);
    const heads = (await env.repository.history<GenerationTaskHead>(durableAggregateIdentity(env.scope, GENERATION_TASK_AGGREGATES.head, task.taskId))).map((record) => record.payload);
    for (const revision of heads) expect(generationCommitted(revision).inputTokens, `head revision at ${revision.updatedAt}`).toBeLessThanOrEqual(limit);
    expect(sum(port.reported)).toBeLessThanOrEqual(limit);
    // the three block slices were claimed together, and at least one was refused before sending anything
    const firstTurnsSent = model.calls.filter((call) => call.kind === "block" && call.turn === 1).length;
    expect(firstTurnsSent).toBeLessThan(3);
    const blocks = Object.values(parked.blocks);
    expect(blocks.some((block) => block.status === "blocked" && block.blocker === "allowance_exhausted" && block.turnsUsed === 0)).toBe(true);
    expect(blocks.some((block) => block.blocker === "platform_failure")).toBe(false); // the task limit is the allowance, never a recording failure
    expect(env.logs.some((line) => /sirkit_input_allowance_exhausted/.test(line))).toBe(true);
  });
});
