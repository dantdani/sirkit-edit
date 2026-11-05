/**
 * [PR-L6 integration, 2026-10-19] F5 (the engine review of increment 6): every planned block designs under EVERY plan assumption.
 *
 * The plan-time fold (`briefWithAssumptions`) keeps only as many whole assumptions as fit a block's 600-character brief, and a planned
 * block's message held only its name, brief and shared nets - so with long assumptions some blocks never saw some of them, while the
 * task card and the review explanation list all of them as the design basis (L.6: "do not silently design a different circuit"). The
 * block message now carries, after the shared nets, every assumption its stored brief does not already hold.
 *
 *  1. the message carries each assumption exactly once (folded in the brief, or in the section after the shared nets); without
 *     assumptions it is byte-identical to the request-lifetime message;
 *  2. through the real worker with six long assumptions: every block's first message carries all six, and every request of a block -
 *     a later slice's included - sends the same first message.
 *
 * Scripted provider, fake catalog, the in-memory durable repository, a simulated clock. No provider, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import type { LLMResponse } from "@/app/lib/llm/types";
import { DRONE_BLOCKS, ScriptedModel, drive, droneCatalog, droneScripts, firstText, l3Env, reply, startTask } from "@/app/lib/generation-task/__tests__/_l3-worker-fixtures";
import { blockDesignRequest, briefWithAssumptions } from "../build-multi-generation";

/** Six assumptions of about 110 characters: a short brief folds four of them, a long one fewer. */
const ASSUMPTIONS = [
  "Brushed 1S coreless DC motors of about 1 A each, driven low-side by logic-level N-MOSFETs with flyback diodes.",
  "A single-cell 1S LiPo supply between 3.0 V and 4.2 V, with no charger, fuel gauge or protection circuit on board.",
  "An 8-bit MCU running from its internal 8 MHz oscillator; no crystal is fitted anywhere on this flight controller.",
  "A 6-axis IMU on the shared I2C bus at 400 kHz, with pull-ups on the controller side and no magnetometer fitted.",
  "No radio receiver is fitted; a 3-pin UART header is the only link to an external receiver or telemetry module.",
  "No firmware, no flight-control tuning and no electrical safety or flight qualification is supplied by this design.",
];
const LONG_BRIEF = `${"An MCU with an IMU on I2C, four PWM outputs to the motor channels and a UART header for an external receiver. ".repeat(3)}`.trim();

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

const occurrences = (text: string, part: string) => text.split(part).length - 1;

describe("[PR-L6 integration] F5: a planned block designs under every plan assumption", () => {
  it("1. each assumption appears exactly once in the block message; without assumptions the message is unchanged", () => {
    const folded = briefWithAssumptions(LONG_BRIEF, ASSUMPTIONS);
    expect(ASSUMPTIONS.filter((assumption) => folded.includes(assumption)).length).toBeLessThan(ASSUMPTIONS.length); // the fold drops some
    const block = { name: "Flight controller", brief: folded, sharedNets: ["+3V3", "GND"] };
    const message = blockDesignRequest("four motors", block, ASSUMPTIONS).userMessage;
    for (const assumption of ASSUMPTIONS) expect(occurrences(message, assumption), assumption).toBe(1);
    expect(message.indexOf("SHARED BOARD NETS")).toBeLessThan(message.indexOf("Design assumptions (decided at planning"));
    expect(blockDesignRequest("four motors", block).userMessage).toBe(blockDesignRequest("four motors", block, []).userMessage);
    expect(blockDesignRequest("four motors", block).userMessage).not.toContain("Design assumptions (decided at planning");
    // a brief that already holds every assumption gets no section (a task planned before this change keeps its first message)
    const all = { ...block, brief: `Short. Assumptions: ${ASSUMPTIONS.slice(0, 2).join("; ")}.` };
    expect(blockDesignRequest("four motors", all, ASSUMPTIONS.slice(0, 2)).userMessage).toBe(blockDesignRequest("four motors", all).userMessage);
  });

  it("2. through the worker: every block's first message carries all six assumptions, the same first message in every request of the block", { timeout: 60_000 }, async () => {
    const env = l3Env({ name: "l6-block-assumptions", repository: new InMemoryDurableWorkflowRepository(), catalog: droneCatalog(), storeOptions: { blockTurnsPerSlice: 2 } });
    const blocks = DRONE_BLOCKS.map((block, index) => ({ ...block, sharedNets: [...block.sharedNets], brief: index === 0 ? LONG_BRIEF : block.brief }));
    const plan = (): LLMResponse => reply([{ id: "call_plan", name: "submit_plan", input: { rationale: "A flight controller, its power stage and four motor channels.", blocks, assumptions: ASSUMPTIONS } }], { usage: { inputTokens: 900, outputTokens: 300 } });
    const model = new ScriptedModel({ ...droneScripts(), plan }, env.time, () => 1_000);
    const task = await startTask(env);
    const { task: done } = await drive(env, env.worker({ llm: model }), task.taskId, { until: (current) => current.state === "awaiting-review", maxTicks: 40 });
    expect(done.plan!.assumptions).toEqual(ASSUMPTIONS);
    for (const block of DRONE_BLOCKS) {
      const firsts = new Set(model.requests.filter((request) => firstText(request.messages).startsWith(`Block: ${block.name}\n`)).map((request) => firstText(request.messages)));
      expect(firsts.size, block.name).toBe(1); // a later slice resumes the same conversation
      const [first] = [...firsts];
      for (const assumption of ASSUMPTIONS) expect(occurrences(first!, assumption), `${block.name}: ${assumption}`).toBe(1);
    }
  });
});
