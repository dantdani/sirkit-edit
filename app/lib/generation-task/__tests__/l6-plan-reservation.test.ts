/**
 * [PR-L6 integration, 2026-10-19] SPEND-2 (the spend-bound review of increment 6): the plan slice reserves BOTH planner calls.
 *
 * `planGeneration` makes up to PLAN_ATTEMPTS = 2 calls of 4,096 output tokens each (one correction after a cut or unreadable plan). The
 * plan slice never checkpoints, so the reservation is what stays charged whenever its measured usage is dropped: a release on shutdown
 * or lease loss, an unexpected failure, a lapsed owner, a cancel settled from release. With a one-call reservation a correction call in
 * flight left up to 4,096 billed output tokens uncounted, once per such attempt. The reservation is now 2 calls x 4,096.
 *
 *  1. the policy's planAttempts equals the planner's PLAN_ATTEMPTS, and the plan reservation is 2 calls / 8,192 output tokens;
 *  2. a worker shutdown while the correction call is in flight releases the plan slice with BOTH calls' output still charged.
 *
 * Fake model and catalog ports, the in-memory durable repository, a simulated clock. No provider, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import type { LLMResponse } from "../../llm/types";
import { PLAN_ATTEMPTS } from "../../schematic/build-multi-generation";
import { GENERATION_SLICE_POLICY, generationCommitted, generationReservationFor } from "../contracts";
import type { WorkerTimers } from "../worker/worker";
import { DRONE_BLOCKS, ScriptedModel, droneCatalog, droneScripts, head, l3Env, reply, startTask } from "./_l3-worker-fixtures";

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

/** Timers that never fire an interval (the shutdown, not a renewal, ends the slice). */
const DEAF: WorkerTimers = { setInterval: () => null, clearInterval: () => undefined, setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
const NEVER = new Promise<LLMResponse>(() => undefined);

describe("[PR-L6 integration] SPEND-2: the plan slice reserves both planner calls", () => {
  it("1. planAttempts equals PLAN_ATTEMPTS; the plan reservation is 2 calls x 4,096 output tokens", () => {
    expect(GENERATION_SLICE_POLICY.planAttempts).toBe(PLAN_ATTEMPTS);
    expect(generationReservationFor("plan", 6)).toEqual({ modelCalls: PLAN_ATTEMPTS, outputTokens: PLAN_ATTEMPTS * GENERATION_SLICE_POLICY.planOutputTokens });
    expect(generationReservationFor("plan", 6)).toEqual({ modelCalls: 2, outputTokens: 8_192 });
  });

  it("2. a shutdown during the correction call releases the plan slice with both calls' output still charged", async () => {
    const env = l3Env({ name: "plan-reservation", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    let correctionSent!: () => void;
    const correction = new Promise<void>((resolve) => { correctionSent = resolve; });
    const model = new ScriptedModel({
      ...droneScripts(),
      plan: (_request, call) => {
        if (call === 1) {
          // the first planner turn is cut at the output limit (PLAN_TRUNCATED): billed in full, never used
          return reply([{ id: "call_plan_cut", name: "submit_plan", input: { rationale: "cut", blocks: DRONE_BLOCKS.map((block) => ({ ...block, sharedNets: [...block.sharedNets] })) } }], { stopReason: "max_tokens", usage: { inputTokens: 900, outputTokens: GENERATION_SLICE_POLICY.planOutputTokens } });
        }
        correctionSent();
        return NEVER; // the correction call is in flight when the worker stops
      },
    });
    const task = await startTask(env);
    const leaving = env.worker({ llm: model, workerId: "worker-leaving", timers: DEAF });
    const tick = await leaving.tick();
    expect(tick.started).toHaveLength(1);
    await correction;
    const [report] = await leaving.stop({ graceMs: 50 });
    expect(report).toMatchObject({ sliceId: tick.started[0], outcome: "released" });
    expect(model.planCalls).toBe(2);
    const released = await head(env, task.taskId);
    const reservation = released.reservations.find((entry) => entry.sliceId === tick.started[0]);
    expect(reservation).toMatchObject({ state: "uncertain", modelCalls: 2, outputTokens: 8_192 });
    // the provider may have billed both calls' output: the task's committed output covers both, never only the first
    expect(generationCommitted(released).outputTokens).toBeGreaterThanOrEqual(2 * GENERATION_SLICE_POLICY.planOutputTokens);
    expect(generationCommitted(released).modelCalls).toBeGreaterThanOrEqual(2);
  });
});
