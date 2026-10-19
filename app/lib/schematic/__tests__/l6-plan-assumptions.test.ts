/**
 * [PR-L6, 2026-10-19] OD-253 items 2-3 (l6-remaining.md item 9; runbook L.6 "explicitly record material assumptions"): the planner's
 * optional `assumptions` and `coverage` lists, end to end.
 *
 *  1. `planGeneration` reads both lists from submit_plan (at most 8 each, one line, at most 200 characters); an older answer without
 *     them still plans (no assumption, no coverage key);
 *  2. through the real worker: the head stores them bounded and redacted; each planned block's brief carries the assumptions (folded AT
 *     PLAN TIME, so every request of a block - a resumed slice's included - sends the same first message); the public snapshot, the chat
 *     inspection's projection and the merged explanation (the review dialog's text) show them;
 *  3. the single design (block main) designs under them too, its message fixed by the stored plan;
 *  4. the status card renders the assumptions as a list (data-testid generation-task-assumptions, one item each) and the requested coverage.
 *
 * Scripted provider, fake catalog, the in-memory durable repository, a simulated clock. No provider, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationTaskStatus } from "@/app/components/chat/GenerationTaskStatus";
import { publicTaskProjection } from "@/app/lib/agent/generation-proposals";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { generationTaskHeadIssue } from "@/app/lib/generation-task/contracts";
import { buildGenerationTaskSnapshot } from "@/app/lib/generation-task/snapshot";
import type { LLMRequest, LLMResponse } from "@/app/lib/llm/types";
import { readGenerationTaskSnapshot, reduceGenerationTaskView } from "@/app/lib/project/generation-task-client";
import { DRONE_BLOCKS, NETLISTS, ScriptedModel, drive, droneCatalog, droneScripts, firstText, l3Env, reply, search, startTask, submit } from "@/app/lib/generation-task/__tests__/_l3-worker-fixtures";
import { planGeneration } from "../build-multi-generation";

const ASSUMPTIONS = [
  "Brushed 1S coreless DC motors, about 1 A each, driven low-side by N-MOSFETs with flyback diodes.",
  "A 1S LiPo supply (3.0-4.2 V) without charger or protection.",
  "An 8-bit MCU on its internal oscillator; an IMU on I2C; a UART header for a receiver; no radio.",
  "No firmware and no flight or safety qualification is supplied.",
];
const COVERAGE = ["4 motor drive channels", "IMU on I2C", "3.3 V logic rail"];
const planWith = (extra: Record<string, unknown>, blocks: readonly unknown[] = DRONE_BLOCKS): LLMResponse => reply([{ id: "call_plan", name: "submit_plan", input: { rationale: "A flight controller, its power stage and four motor channels.", blocks: blocks.map((block) => structuredClone(block)), ...extra } }], { usage: { inputTokens: 900, outputTokens: 300 } });
const portOf = (answer: (request: LLMRequest) => LLMResponse) => ({ generate: async (request: LLMRequest) => answer(request) });

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

describe("[PR-L6] the planner's assumptions and requested coverage (OD-253 items 2-3)", () => {
  it("1. planGeneration reads both optional lists, bounded to 8 one-line entries of 200 characters; an older answer without them still plans", async () => {
    const many = [...ASSUMPTIONS, "x".repeat(300), "line one\nline two", 42, "", ...Array.from({ length: 5 }, (_, index) => `extra assumption ${index}`)];
    const planned = await planGeneration({ prompt: "four motors", provider: "openai", llm: portOf(() => planWith({ assumptions: many, coverage: [...COVERAGE, ...Array.from({ length: 9 }, (_, index) => `function ${index}`)] })), maxBlocks: 8 });
    if (planned.kind !== "planned") throw new Error("planned expected");
    expect(planned.plan.assumptions).toHaveLength(8);
    expect(planned.plan.assumptions.slice(0, 4)).toEqual(ASSUMPTIONS);
    expect(planned.plan.assumptions[4]).toBe("x".repeat(200));
    expect(planned.plan.assumptions[5]).toBe("line one line two");
    expect(planned.plan.assumptions.every((entry) => entry.length <= 200 && !entry.includes("\n"))).toBe(true);
    expect(planned.plan.coverage).toHaveLength(8);
    expect(planned.plan.coverage!.slice(0, 3)).toEqual(COVERAGE);
    const older = await planGeneration({ prompt: "four motors", provider: "openai", llm: portOf(() => planWith({})), maxBlocks: 8 });
    if (older.kind !== "planned") throw new Error("planned expected");
    expect(older.plan.assumptions).toEqual([]);
    expect(older.plan).not.toHaveProperty("coverage");
    expect(older.plan.planner).toEqual({ state: "planned", blocks: 3 });
  });

  it("2. through the worker: stored bounded and redacted, folded into every block brief at plan time (a resumed block sends the same first message), shown in the snapshot, the chat inspection and the merged explanation", { timeout: 60_000 }, async () => {
    const secret = "sk-proj-AbCdEf0123456789AbCdEf0123456789AbCdEf";
    const env = l3Env({ name: "l6-assumptions", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog(), storeOptions: { blockTurnsPerSlice: 2 } });
    const model = new ScriptedModel({ ...droneScripts(), plan: () => planWith({ assumptions: [...ASSUMPTIONS, `Use the key ${secret} for nothing.`], coverage: COVERAGE }) }, env.time, () => 1_000);
    const task = await startTask(env);
    const { task: done } = await drive(env, env.worker({ llm: model }), task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 40 });

    expect(generationTaskHeadIssue(done)).toBeNull();
    expect(done.plan!.assumptions.slice(0, 4)).toEqual(ASSUMPTIONS);
    expect(done.plan!.assumptions).toHaveLength(5);
    expect(JSON.stringify(done.plan)).not.toContain(secret); // redacted as stored
    expect(done.plan!.coverage).toEqual(COVERAGE);
    for (const block of done.plan!.blocks) expect(block.brief, block.name).toContain(`Assumptions: ${ASSUMPTIONS[0]}`);
    // every request of a block - across its two slices - begins with the same stored brief
    for (const name of DRONE_BLOCKS.map((block) => block.name)) {
      const firsts = new Set(model.requests.filter((request) => firstText(request.messages).startsWith(`Block: ${name}\n`)).map((request) => firstText(request.messages)));
      expect(firsts.size, name).toBe(1);
      expect([...firsts][0], name).toContain(`Assumptions: ${ASSUMPTIONS[0]}`);
    }
    expect(model.callsOf("Flight controller")).toBe(4); // two slices of two turns

    const snapshot = buildGenerationTaskSnapshot(done, { nowMs: env.time.now(), processing: [] });
    expect(snapshot.plan).toMatchObject({ assumptions: done.plan!.assumptions, coverage: COVERAGE });
    const inspected = publicTaskProjection(snapshot as unknown as Record<string, unknown>) as { plan: { assumptions: string[]; coverage: string[] } };
    expect(inspected.plan.assumptions).toEqual(done.plan!.assumptions);
    expect(inspected.plan.coverage).toEqual(COVERAGE);
    const result = await env.store.readResult(env.scope, done);
    expect(result!.explanation).toContain(`Assumptions:\n- ${ASSUMPTIONS[0]}`);
    expect(result!.explanation).toContain(`Requested coverage:\n- ${COVERAGE[0]}\n- ${COVERAGE[1]}`);
    expect(result!.explanation.indexOf("Assumptions:")).toBeLessThan(result!.explanation.indexOf("MCU and IMU on I2C")); // ahead of anything a bound could cut
  });

  it("3. the single design (block main) designs under the plan's assumptions; its message is fixed by the stored plan across slices", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "l6-assumptions-main", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog(), storeOptions: { blockTurnsPerSlice: 2 } });
    const queries = ["flight controller mcu", "imu gyro", "decoupling capacitor"];
    const model = new ScriptedModel({ plan: () => planWith({ assumptions: ASSUMPTIONS.slice(0, 2) }, []), blocks: { "": ({ turn }) => (turn <= 3 ? reply([search(`call_main_${turn}`, queries[turn - 1]!)]) : reply([submit("call_main_submit", NETLISTS["Flight controller"])])) } }, env.time, () => 1_000);
    const task = await startTask(env);
    const { task: done } = await drive(env, env.worker({ llm: model }), task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 20 });
    expect(done.plan).toMatchObject({ planner: { state: "single", reason: "simple_request" }, assumptions: ASSUMPTIONS.slice(0, 2) });
    const firsts = new Set(model.requests.filter((request) => !request.toolChoice).map((request) => firstText(request.messages)));
    expect(firsts.size).toBe(1);
    expect([...firsts][0]).toBe(`${task.request.prompt}\n\nDesign assumptions (decided at planning; design under them, do not contradict them):\n- ${ASSUMPTIONS[0]}\n- ${ASSUMPTIONS[1]}`);
    const result = await env.store.readResult(env.scope, done);
    expect(result!.explanation.startsWith(`Assumptions:\n- ${ASSUMPTIONS[0]}`)).toBe(true);
  });

  it("4. the status card lists the assumptions (one item each) and the requested coverage", async () => {
    const env = l3Env({ name: "l6-assumptions-card", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog() });
    const model = new ScriptedModel({ ...droneScripts(), plan: () => planWith({ assumptions: ASSUMPTIONS, coverage: COVERAGE }) }, env.time, () => 1_000);
    const task = await startTask(env);
    const { task: planned } = await drive(env, env.worker({ llm: model }), task.taskId, { until: (current) => current.plan !== null, maxTicks: 3 });
    const snapshot = readGenerationTaskSnapshot(JSON.parse(JSON.stringify(buildGenerationTaskSnapshot(planned, { nowMs: env.time.now(), processing: [] }))));
    expect(snapshot).not.toBeNull();
    const { view } = reduceGenerationTaskView(null, { task: snapshot!, events: [], gap: false });
    const html = renderToStaticMarkup(createElement(GenerationTaskStatus, { view, onAction: () => undefined, onStartAgain: () => undefined }));
    const list = /<ul[^>]*data-testid="generation-task-assumptions"[^>]*>(.*?)<\/ul>/.exec(html);
    expect(list).not.toBeNull();
    expect(list![1]!.match(/<li>/g)).toHaveLength(ASSUMPTIONS.length);
    for (const assumption of ASSUMPTIONS) expect(list![1]).toContain(assumption);
    expect(html).toContain('data-testid="generation-task-coverage"');
    expect(html).toContain(COVERAGE[0]);
    // a plan without assumptions renders no list
    const bare = { ...view, plan: { ...view.plan!, assumptions: [] } };
    expect(renderToStaticMarkup(createElement(GenerationTaskStatus, { view: bare, onAction: () => undefined, onStartAgain: () => undefined }))).not.toContain("generation-task-assumptions");
  });
});
