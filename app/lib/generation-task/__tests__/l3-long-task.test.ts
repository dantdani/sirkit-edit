/**
 * [PR-L, 2026-10-17] Runbook L.7 item 2 (increment 3; task-worker-contract.md sections 4, 5 and 9): a LOGICAL task that lives longer than
 * a day stays valid across many finite slices, a worker restart and no browser at all - lifecycle behaviour, not live engineering:
 *
 *  1. the model provider is overloaded for 26 simulated hours and asks for one hour each time (Retry-After): the block waits as
 *     `waiting-for-provider` with a durable, delayed slice (S1) - never earlier than the provider asked, never as a failure - while the
 *     other blocks are saved; the first worker is stopped half-way and a NEW worker over a NEW store instance continues from the durable
 *     state; the design completes after more than 24 hours, and a reader that reconnects with its event cursor replays the milestones
 *     in order (or is told it fell behind the ring);
 *  2. without a Retry-After, consecutive transient failures back off with full jitter from 5 s, doubling, capped at 300 s;
 *  3. both provider adapters carry the SDK error's Retry-After (`retry-after-ms`, `retry-after` seconds or an HTTP date) on
 *     `LLMProviderError.retryAfterMs`; an absent, unreadable or excessive value is undefined;
 *  4. the per-task allowance (OD-252) parks the task as `waiting-for-resource` / `allowance_exhausted`; a `resume` with
 *     `extendAllowance` (recorded with its principal) continues it, and a second extension completes it.
 *
 * Fake model and catalog ports, the in-memory durable repository, a simulated clock. No provider, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { AnthropicProvider } from "../../llm/anthropic-provider";
import { OpenAIProvider } from "../../llm/openai-provider";
import { LLMProviderError, RETRY_AFTER_MAX_MS, retryAfterMsOf, toProviderError } from "../../llm/errors";
import { generationTaskEventsPage } from "../events";
import { GenerationTaskStore } from "../store";
import { GENERATION_BACKOFF, backoffDelayMs } from "../worker/accounting";
import { ScriptedModel, T0, droneCatalog, droneScripts, drive, head, l3Env, providerError, startTask } from "./_l3-worker-fixtures";

const HOUR = 3_600_000;
const editor = { principalId: "user-l3-editor", role: "pcb_editor" as const };

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

describe("[PR-L L.7-2] a task longer than a day, across slices, a worker restart and no browser", () => {
  it("1. 26 simulated hours of an overloaded provider asking for one hour each time: the block waits durably, a new worker continues after a restart, and the design completes", { timeout: 120_000 }, async () => {
    const env = l3Env({ name: "long", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const outageEnds = T0 + 26 * HOUR;
    const model = new ScriptedModel(droneScripts(), env.time, () => 10_000);
    model.intercept = (_request, kind, block) => {
      if (kind === "block" && block === "Motor drivers" && env.time.now() < outageEnds) throw providerError("overloaded", HOUR);
      return undefined;
    };
    const task = await startTask(env);
    const first = env.worker({ llm: model, workerId: "worker-long-first" });
    // the first worker runs the plan and the blocks, then sees Motor drivers wait; time passes while nobody watches
    const half = await drive(env, first, task.taskId, { until: (current) => current.usage.modelCalls >= 9 + 10, maxTicks: 60 });
    expect(half.task.state).toBe("waiting-for-provider");
    expect(half.task.blocks.b1?.status).toBe("saved");
    expect(half.task.blocks.b2?.status).toBe("saved");
    expect(half.task.blocks.b3?.status).toBe("queued");
    const delayed = Object.values(half.task.pending);
    expect(delayed).toHaveLength(1);
    expect(Date.parse(delayed[0]!.notBefore) - env.time.now()).toBeGreaterThan(HOUR - 60_000); // the provider's Retry-After, honoured durably (simulated time)
    const cursor = generationTaskEventsPage(half.task, { after: 0, limit: 50 });
    await first.stop({ graceMs: 1_000 });

    // a RESTART: a new store instance and a new worker over the same durable repository (no in-process state survives)
    const restartedStore = new GenerationTaskStore({ repository: env.repository, clock: env.time.clock });
    const second = env.worker({ llm: model, workerId: "worker-long-second", store: restartedStore });
    const { task: done } = await drive({ ...env, store: restartedStore }, second, task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 200 });

    expect(env.time.now() - T0).toBeGreaterThan(24 * HOUR); // simulated time (the suite's clock), never a wall-clock bound
    const motorCalls = model.calls.filter((call) => call.kind === "block" && call.block === "Motor drivers");
    const outage = motorCalls.filter((call) => call.at < outageEnds);
    expect(outage.length).toBeGreaterThanOrEqual(24);
    for (let index = 1; index < outage.length; index += 1) expect(outage[index]!.at - outage[index - 1]!.at).toBeGreaterThanOrEqual(HOUR); // never earlier than asked
    expect(done.blocks.b3).toMatchObject({ status: "saved", turnsUsed: 3 });
    expect(done.milestones.filter((event) => event.type === "waiting_provider").length).toBeGreaterThan(0);
    expect(done.milestones.some((event) => event.type === "failed")).toBe(false);
    // every refused call is counted (the provider refused it: no work, no uncertainty); the allowance (60 calls) was never reached
    expect(done.usage.modelCalls).toBe(1 + 4 + 4 + outage.length + 3);
    expect(done.usage.uncertainModelCalls).toBe(0);
    const result = await restartedStore.readResult(env.scope, done);
    expect(result).toMatchObject({ status: "complete", omittedBlocks: [] });
    // the reader that went away comes back with its cursor: ordered replay, or an honest gap when the ring moved past it
    const replay = generationTaskEventsPage(done, { after: cursor.cursor, limit: 50 });
    if (replay.gap) expect(replay.events[0]!.seq).toBeGreaterThan(cursor.cursor + 1);
    else expect(replay.events[0]!.seq).toBe(cursor.cursor + 1);
    for (let index = 1; index < replay.events.length; index += 1) expect(replay.events[index]!.seq).toBe(replay.events[index - 1]!.seq + 1);
    expect(done.eventSeq).toBeGreaterThan(48); // more milestones than the ring holds: the cursor, not the ring, is the contract
  });

  it("2. without a Retry-After, consecutive transient failures back off with full jitter from 5 s, doubling, capped at 300 s", { timeout: 60_000 }, async () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((consecutive) => backoffDelayMs({ consecutive, retryAfterMs: null, random: () => 0.5 }))).toEqual([2_500, 5_000, 10_000, 20_000, 40_000, 80_000, 150_000, 150_000, 150_000]);
    expect(backoffDelayMs({ consecutive: 12, retryAfterMs: null, random: () => 1 })).toBe(GENERATION_BACKOFF.capMs);
    expect(backoffDelayMs({ consecutive: 1, retryAfterMs: null, random: () => 0 })).toBe(GENERATION_BACKOFF.floorMs); // a zero draw is no hot loop
    expect(backoffDelayMs({ consecutive: 1, retryAfterMs: 42_000, random: () => 0.5 })).toBe(42_000); // never earlier than the provider asked
    const env = l3Env({ name: "backoff", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    let failures = 8;
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    model.intercept = (_request, kind, block) => {
      if (kind === "block" && block === "Power" && failures > 0) { failures -= 1; throw providerError("rate_limit"); }
      return undefined;
    };
    const task = await startTask(env);
    const { task: done } = await drive(env, env.worker({ llm: model }), task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 80 });
    const attempts = model.calls.filter((call) => call.kind === "block" && call.block === "Power" && call.turn === 1).map((call) => call.at);
    expect(attempts).toHaveLength(9);
    const gaps = attempts.slice(1).map((at, index) => at - attempts[index]!);
    const expected = [2_500, 5_000, 10_000, 20_000, 40_000, 80_000, 150_000, 150_000];
    gaps.forEach((gap, index) => { expect(gap).toBeGreaterThanOrEqual(expected[index]!); expect(gap).toBeLessThan(expected[index]! + 60_000); });
    expect(done.blocks.b2).toMatchObject({ status: "saved" });
    expect(done.milestones.filter((event) => event.type === "waiting_provider" && event.blockId === "b2").length).toBeGreaterThan(0);
  });

  it("3. both adapters carry the SDK error's Retry-After on LLMProviderError.retryAfterMs; absent, unreadable or excessive values are undefined", async () => {
    const openaiError = OpenAI.APIError.generate(429, { error: { message: "Rate limit reached", type: "requests", code: "rate_limit_exceeded" } }, "Rate limit reached", new Headers({ "retry-after-ms": "1500", "retry-after": "9" }));
    const openai = new OpenAIProvider({ responses: { create: async () => { throw openaiError; } } } as never, "gpt-offline-l3");
    const fromOpenAI = await openai.generate({ provider: "openai", messages: [{ role: "user", content: "x" }] }).catch((error: unknown) => error);
    expect(fromOpenAI).toBeInstanceOf(LLMProviderError);
    expect(fromOpenAI).toMatchObject({ reason: "rate_limit", retryAfterMs: 1_500 });
    const anthropicError = Anthropic.APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, "Overloaded", new Headers({ "retry-after": "7" }));
    const anthropic = new AnthropicProvider({ messages: { create: async () => { throw anthropicError; } } } as never, "claude-offline-l3");
    const fromAnthropic = await anthropic.generate({ provider: "anthropic", messages: [{ role: "user", content: "x" }] }).catch((error: unknown) => error);
    expect(fromAnthropic).toMatchObject({ reason: "overloaded", retryAfterMs: 7_000 });
    // the header forms and the refusals
    const now = Date.parse("2026-10-17T12:00:00.000Z");
    expect(retryAfterMsOf({ headers: new Headers({ "retry-after": "Sat, 17 Oct 2026 12:02:00 GMT" }) }, now)).toBe(120_000);
    expect(retryAfterMsOf({ headers: { "retry-after": "2.5" } }, now)).toBe(2_500);
    for (const value of ["soon", "-3", String(RETRY_AFTER_MAX_MS / 1_000 + 1), ""]) expect(retryAfterMsOf({ headers: new Headers({ "retry-after": value }) }, now)).toBeUndefined();
    expect(retryAfterMsOf(new Error("no headers"), now)).toBeUndefined();
    expect(toProviderError("openai", new Error("plain")).retryAfterMs).toBeUndefined();
  });

  it("4. the per-task allowance parks the task as waiting-for-resource / allowance_exhausted; resume with extendAllowance continues it to a complete result", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "allowance", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel(droneScripts(), env.time, () => 1_000);
    const task = await startTask(env, { allowanceUnit: { modelCalls: 6, outputTokens: 480_000, catalogSearches: 300, wallClockMs: 72 * HOUR } });
    const worker = env.worker({ llm: model });
    const parked = await drive(env, worker, task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 20 });
    // the plan ran (1 call); no block slice fits 1 + 6 reserved calls into 6: nothing ran that the allowance could not pay for
    expect(parked.task.blocker).toMatchObject({ code: "allowance_exhausted" });
    expect(parked.task.usage.modelCalls).toBe(1);
    expect(model.calls.filter((call) => call.kind === "block")).toHaveLength(0);
    const first = await env.store.control({ scope: env.scope, taskId: task.taskId, principal: editor, action: "resume", clientActionId: "extend-1", extendAllowance: true });
    expect(first).toMatchObject({ ok: true, task: { state: "queued", allowance: { units: 2, extensions: [{ principalId: editor.principalId, clientActionId: "extend-1" }] } } });
    // two blocks fit the extended allowance (12 calls); the third parks the task again, now with two saved blocks (partial available)
    const again = await drive(env, worker, task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 20 });
    expect(Object.values(again.task.blocks).filter((block) => block?.status === "saved")).toHaveLength(2);
    expect(again.task.blocker).toMatchObject({ code: "partial_available", evidence: { cause: "allowance_exhausted" } });
    expect(await env.store.control({ scope: env.scope, taskId: task.taskId, principal: editor, action: "resume", clientActionId: "extend-2", extendAllowance: true })).toMatchObject({ ok: true });
    const { task: done } = await drive(env, worker, task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 20 });
    expect(done.allowance.units).toBe(3);
    expect(done.usage.modelCalls).toBe(1 + 4 + 4 + 3);
    expect((await head(env, task.taskId)).result).toMatchObject({ status: "complete" });
  });
});
