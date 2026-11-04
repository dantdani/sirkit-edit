/**
 * [PR-J, 2026-11-04] Runbook J.7, item J7-9 (multi-sheet/workload-limits.md): a block's end beside a sibling's provider wait - proved over
 * the PRODUCTION store, worker and slice runner (`GenerationTaskStore`, `GenerationWorker`, `runGenerationSlice`) with a scripted provider,
 * on the four-motor drone (three blocks) against a worker of THREE slots, tick by tick.
 *
 * One block meets a provider `rate_limit` (Retry-After 30 s) on its first call while its siblings run: its end schedules it again 30 s later
 * with the waiting reason, and the task stays `running`. When the LAST running sibling then saves, the only pending slice is that delayed
 * block, so the task's state is `waiting-for-provider` - which the transition table allows a worker only with a waiting reason. The saving
 * end had none (the reason was the sibling's, recorded nowhere), so its commit was refused (GENERATION_TASK_TRANSITION_REFUSED): the saved
 * block was released and redone on another attempt, its reservation charged as uncertain. Now the delayed slice carries the provider's
 * reason (`providerWait`) and the saving end attests it.
 *
 *  1. every block is saved exactly once (one save milestone each, never re-opened), no slice is released or claimed twice, nothing is
 *     charged uncertain, the task waits for the provider with the sibling's reason and reaches its result;
 *  2. the transition rule is unchanged: `waiting-for-provider` is still refused to a worker end that attests no reason.
 *
 * Fixture proof only: the scripted provider, the in-memory durable repository and a simulated clock - no paid call, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import { durableAggregateIdentity } from "../../durable-workflow/stable";
import { GENERATION_SLICE_TOPIC, GENERATION_TASK_AGGREGATES, generationTaskTransitionIssue, type GenerationTaskHead } from "../contracts";
import { DRONE_BLOCKS, ScriptedModel, drive, droneCatalog, droneScripts, l3Env, providerError, settledOrWaiting, standardBlock, startTask, type BlockScript } from "./_l3-worker-fixtures";

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

const SLOTS = 3;
const RETRY_AFTER_MS = 30_000;
/** The drone's model calls when nothing goes wrong: the plan, then per block its searches and one submission (3 + 3 + 2, + 3 submissions). */
const DRONE_CALLS = 1 + 4 + 4 + 3;

describe("[PR-J J7-9] a block's end beside a sibling's provider wait", () => {
  it("1. the last running block's save beside a block the provider delayed commits once: no slice redone, nothing uncertain, the result is reached", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "j7-9-provider-wait", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    let limited = false;
    const power = standardBlock("Power");
    const rateLimitedOnce: BlockScript = (context) => {
      if (!limited && context.turn === 1) { limited = true; throw providerError("rate_limit", RETRY_AFTER_MS); }
      return power(context);
    };
    const model = new ScriptedModel(droneScripts({ Power: rateLimitedOnce }), env.time, () => 1_000);
    const task = await startTask(env);
    const { task: done } = await drive(env, env.worker({ llm: model, policy: { concurrency: SLOTS } }), task.taskId, { until: settledOrWaiting, maxTicks: 30 });
    const history = (await env.repository.history<GenerationTaskHead>(durableAggregateIdentity(env.scope, GENERATION_TASK_AGGREGATES.head, task.taskId))).map((record) => record.payload);
    const evidence = JSON.stringify({ state: done.state, blocker: done.blocker, logs: env.logs.filter((line) => /released|refused|failed/.test(line)) });

    // the result is reached, every block saved
    expect(done.state, evidence).toBe("awaiting-review");
    expect(done.result).toMatchObject({ status: "complete", omittedBlocks: [] });
    expect(Object.values(done.blocks).map((block) => block!.status)).toEqual(["saved", "saved", "saved"]);
    expect(limited).toBe(true);
    // the scenario: the saving end that left only Power's delayed slice pending moved the task to waiting-for-provider, with Power's reason
    const powerId = done.plan!.blocks.find((block) => block.name === "Power")!.blockId;
    const delayedAt = history.findIndex((revision) => Object.values(revision.pending).some((entry) => entry.blockId === powerId && entry.providerWait === "rate_limit"));
    expect(delayedAt, "Power's slice was delayed with the provider's reason").toBeGreaterThan(0);
    expect(history[delayedAt]!.state).toBe("running"); // its siblings were still running
    const waitingAt = history.findIndex((revision) => revision.state === "waiting-for-provider");
    expect(waitingAt, evidence).toBeGreaterThan(delayedAt);
    const waiting = history[waitingAt]!, before = history[waitingAt - 1]!;
    expect(before.state).toBe("running");
    expect(Object.values(waiting.pending).map((entry) => [entry.blockId, entry.owner, entry.providerWait])).toEqual([[powerId, null, "rate_limit"]]);
    expect(Object.values(waiting.blocks).filter((block) => block!.status === "saved")).toHaveLength(2); // the end that moved it saved the last sibling
    expect(waiting.milestones.at(-1)).toMatchObject({ type: "waiting_provider", data: { reason: "rate_limit" } });
    // each block saved exactly once: one save milestone each, and a saved block never re-opened
    const saves = done.milestones.filter((event) => event.type === "block_saved").map((event) => event.blockId).sort();
    expect(saves).toEqual(DRONE_BLOCKS.map((_, index) => `b${index + 1}`));
    for (let index = 1; index < history.length; index += 1) for (const [id, block] of Object.entries(history[index - 1]!.blocks)) if (block!.status === "saved") expect(history[index]!.blocks[id as "b1"]!.status, `block ${id} re-opened at ${history[index]!.updatedAt}`).toBe("saved");
    // no slice redone: nothing released, every slice claimed once, every outbox event leased at most once, no turn asked twice but Power's
    expect(env.logs.filter((line) => /: released/.test(line)), evidence).toEqual([]);
    const fences = new Map<string, Set<number>>();
    for (const revision of history) for (const [id, entry] of Object.entries(revision.pending)) if (entry.owner) fences.set(id, new Set([...(fences.get(id) ?? []), entry.owner.fence]));
    for (const [id, set] of fences) expect(set.size, id).toBe(1);
    expect(done.usage.attempts).toBe(fences.size);
    const events = await env.repository.listOutbox({ topic: GENERATION_SLICE_TOPIC });
    expect(events.every((event) => event.attempts <= 1)).toBe(true);
    const turns = model.calls.filter((call) => call.kind === "block").map((call) => `${call.block}#${call.turn}`);
    expect(turns.filter((turn, index) => turns.indexOf(turn) !== index)).toEqual(["Power#1"]); // the rate-limited turn, asked again after its wait
    expect(model.calls).toHaveLength(DRONE_CALLS + 1);
    // nothing charged uncertain
    expect(done.usage).toMatchObject({ uncertainModelCalls: 0, uncertainOutputTokens: 0 });
    expect(history.some((revision) => revision.reservations.some((entry) => entry.state === "uncertain"))).toBe(false);
    expect(done.reservations).toEqual([]);
    console.info(`[j7-9 measured] saved ${saves.length}/3 once each; slices claimed ${fences.size} (each once), outbox events ${events.length} (each leased once); model calls ${model.calls.length}; waiting-for-provider (rate_limit) from head revision ${waitingAt + 1} of ${history.length}; uncertain 0`);
  });

  it("2. the transition rule is unchanged: a worker's move to waiting-for-provider still needs a waiting reason", async () => {
    const at = "2026-10-17T12:00:30.000Z";
    const prev = { state: "running", pending: {} } as unknown as GenerationTaskHead;
    const next = { state: "waiting-for-provider", updatedAt: "2026-10-17T12:00:00.000Z", pending: { "generation-task:x:s2": { kind: "block", blockId: "b2", notBefore: at, state: "queued", owner: null } } } as unknown as GenerationTaskHead;
    expect(generationTaskTransitionIssue(prev, next, "worker", {})).toBe("wait-provider: a retryable provider reason or an admission pause is required");
    expect(generationTaskTransitionIssue(prev, next, "worker", { waitingReason: "rate_limit" })).toBeNull();
    expect(generationTaskTransitionIssue({ ...prev, state: "queued" } as GenerationTaskHead, next, "worker", { waitingReason: "rate_limit" })).toBe("transition queued -> waiting-for-provider: not permitted for worker");
  });
});
