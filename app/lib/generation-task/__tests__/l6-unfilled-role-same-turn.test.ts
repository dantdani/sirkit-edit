/**
 * [PR-L6 integration, 2026-10-19] F1 (the engine review of increment 6): `report_unfilled_role` counts only searches whose results the
 * model has READ - searches recorded before the report's turn. The tool's contract (prompts.ts: "after at least two DIFFERENT
 * search_parts searches for it found no suitable part") was not enforced for a parallel turn: the turn's own searches were recorded
 * before its report was judged, so [search Q1, search Q2, report [Q1, Q2]] in ONE turn was accepted on results the model had not seen,
 * and a block the catalog could fill could be routed toward S6 missing_part.
 *
 *  1. a report sent in the same turn as the two searches it names is refused with the correction (the conversation goes on at S1); the
 *     same report one turn later, after the results were read, is accepted and routes the block S1 -> S3.
 *
 * The real worker, store and slice code; a scripted model, a fake catalog, the in-memory durable repository, a simulated clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { InMemoryDurableWorkflowRepository } from "../../durable-workflow/repository";
import type { LLMToolResultPart } from "../../llm/types";
import { ScriptedModel, drive, droneCatalog, droneScripts, l3Env, reply, search, startTask, type BlockScript } from "./_l3-worker-fixtures";

const Q1 = { query: "30A brushless ESC", category: "Drivers" };
const Q2 = { query: "brushless motor speed controller" };
const report = (id: string) => ({ id, name: "report_unfilled_role", input: { role: "brushless ESC", function: "Drive one brushless motor from a PWM signal", keySpecs: ["30 A continuous"], queriesTried: [Q1, Q2.query] } });
/** S1: both searches AND the report in one parallel turn; then the same report again. S3: search both, then report (S6). */
const motorScript: BlockScript = ({ turn, strategy }) => {
  if (strategy === "S1-baseline") {
    if (turn === 1) return reply([search("call_m_q1", Q1.query, Q1.category), search("call_m_q2", Q2.query), report("call_m_same_turn")]);
    return reply([report("call_m_after_read")]);
  }
  if (turn === 1) return reply([search("call_s3_1", Q1.query, Q1.category), search("call_s3_2", Q2.query)]);
  return reply([report("call_s3_report")]);
};

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

describe("[PR-L6 integration] F1: an unfilled-role report counts only searches whose results were read", () => {
  it("1. a report in the same turn as its searches is refused; the same report a turn later is accepted and routes S1 -> S3", { timeout: 60_000 }, async () => {
    const catalog = droneCatalog();
    const env = l3Env({ name: "unfilled-same-turn", repository: new InMemoryDurableWorkflowRepository(), catalog });
    const model = new ScriptedModel(droneScripts({ "Motor drivers": motorScript }), env.time, () => 1_000);
    const task = await startTask(env);
    await drive(env, env.worker({ llm: model }), task.taskId, { until: (current) => current.state === "waiting-for-resource", maxTicks: 40 });

    const motor = model.calls.filter((call) => call.kind === "block" && call.block === "Motor drivers").map((call) => `${call.strategy}#${call.turn}`);
    expect(motor.slice(0, 3)).toEqual(["S1-baseline#1", "S1-baseline#2", "S3-catalog-guided#1"]); // the same-turn report did not end S1
    // the second S1 request carries turn 1's answers: both searches answered, the same-turn report refused with the correction
    const s1Second = model.requests.find((request) => typeof request.messages[0]!.content === "string" && request.messages[0]!.content.startsWith("Block: Motor drivers") && request.messages.length === 3)!;
    const answers = s1Second.messages[2]!.content as LLMToolResultPart[];
    const refusal = answers.find((part) => part.toolCallId === "call_m_same_turn")!;
    expect(refusal.isError).toBe(true);
    expect(refusal.output).toMatch(/\(0 of the searches named match a recorded search\)\. A search sent in the same turn as the report does not count/);
    expect(answers.filter((part) => part.toolCallId.startsWith("call_m_q")).every((part) => part.isError !== true)).toBe(true);
    // the report after the results were read was accepted (the block went on to S3)
    const s1Third = model.requests.find((request) => typeof request.messages[0]!.content === "string" && request.messages[0]!.content.startsWith("Block: Motor drivers") && request.messages.length === 5);
    expect(s1Third).toBeUndefined(); // no third S1 turn: the accepted report ended the slice
  });
});
