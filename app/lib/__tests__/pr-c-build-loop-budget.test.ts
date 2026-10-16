/**
 * [PR-C] The Build loop's budget and failure classes (app/lib/build-loop.ts).
 *
 *  - the shared deadline is checked before every model turn (a faked clock proves the loop stops at it, with exactly the
 *    turns the deadline allowed) and the iteration cap is honoured and clamped to the historical 20;
 *  - every failure is a named class with `retryable`: a provider failure keeps the provider's `reason` (credits out and an
 *    open breaker withhold Retry), budget exhaustion is `build_budget_exhausted` (503), any other throw is
 *    `build_loop_failed` (500) with a bounded, redacted sentence and no stack;
 *  - a success reports `iterationsUsed` and keeps the ERC report the loop accepted on.
 *
 * No provider, no database: the router, the part search, the KG and the ERC are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLMProviderError } from "@/app/lib/llm/errors";

type Turn = { text: string; toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>; stopReason: string };

const harness = vi.hoisted(() => ({
  turns: [] as Array<{ text: string; toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>; stopReason: string }>,
  /** a turn the script no longer covers: the model answers without a tool call, so the loop nudges and goes on */
  idle: { text: "thinking", toolCalls: [], stopReason: "end_turn" } as { text: string; toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>; stopReason: string },
  failure: null as Error | null,
  calls: 0,
  onTurn: null as null | (() => void),
  part: { partId: "p-good", name: "NE555", mpn: "NE555DR", description: "Timer", mainCategory: "Timer", pins: [{ number: "1", name: "GND", type: "power_in" }, { number: "8", name: "VCC", type: "power_in" }], lifecycleStatus: "active", similarity: 1 },
  erc: { ok: true, errors: [] as unknown[], criticalCount: 0, warningCount: 1, reward: 1 },
}));

vi.mock("@/app/lib/parts-search", () => ({
  searchPartsForAI: vi.fn(async () => [harness.part]),
  getPartsByIds: vi.fn(async () => []),
  fetchAlternatesForAI: vi.fn(async () => []),
}));
vi.mock("@/lib/erc", () => ({ runErc: vi.fn(() => harness.erc), formatErcFeedback: vi.fn(() => "") }));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));
vi.mock("@/app/lib/llm/router", () => ({
  llmRouter: {
    generate: vi.fn(async () => {
      harness.calls += 1;
      harness.onTurn?.();
      if (harness.failure) throw harness.failure;
      const turn = harness.turns.shift() ?? harness.idle;
      return { provider: "openai", model: "fake", usage: {}, ...turn };
    }),
  },
}));

const search: Turn = { text: "", toolCalls: [{ id: "search-1", name: "search_parts", input: { query: "555 timer" } }], stopReason: "tool_use" };
const submit: Turn = { text: "", toolCalls: [{ id: "submit-1", name: "submit_schematic", input: { components: [{ refDes: "U1", partId: "p-good", value: "NE555", role: "primary" }], connections: [{ from: "U1.VCC", to: "U1.GND" }], explanation: "A timer." } }], stopReason: "tool_use" };

async function run(budget?: { maxIterations?: number; deadlineAt?: number }) {
  const { runBuildToolLoop } = await import("@/app/lib/build-loop");
  return runBuildToolLoop({ provider: "openai", systemPrompt: "S", userMessage: "Build a 555 blinker", ...(budget ? { budget } : {}) });
}

const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

beforeEach(() => {
  harness.turns = [];
  harness.failure = null;
  harness.calls = 0;
  harness.onTurn = null;
  warn.mockClear();
  error.mockClear();
});
afterEach(() => { warn.mockClear(); error.mockClear(); });

describe("[PR-C] a success reports the turns it used and the ERC it was accepted on", () => {
  it("search then submit: ok after 2 turns, with the ERC report", async () => {
    harness.turns = [search, submit];
    const result = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.iterationsUsed).toBe(2);
    expect(result.erc).toMatchObject({ ok: true, warningCount: 1 });
    expect(result.netlist.components.map((c) => c.partId)).toEqual(["p-good"]);
  });
});

describe("[PR-C] the budget: deadline and iteration cap", () => {
  it("a shared deadline stops the loop before the next model turn, with exactly the turns the deadline allowed", async () => {
    // a faked clock: each model turn costs 1 000 ms; the deadline is 2 500 ms out, so the fourth turn is never started
    let now = 1_700_000_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      harness.onTurn = () => { now += 1_000; };
      const result = await run({ deadlineAt: 1_700_000_000_000 + 2_500 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result).toMatchObject({ code: "build_budget_exhausted", status: 503, retryable: true, iterationsUsed: 3 });
      expect(result.error).toMatch(/deadline/i);
      expect(harness.calls).toBe(3);
    } finally {
      clock.mockRestore();
    }
  });

  it("a deadline already past refuses before any model turn", async () => {
    const result = await run({ deadlineAt: Date.now() - 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result).toMatchObject({ code: "build_budget_exhausted", status: 503, iterationsUsed: 0 });
    expect(harness.calls).toBe(0);
  });

  it("the iteration cap is honoured and 'Max iterations reached' is budget exhaustion (503), not a server fault", async () => {
    const result = await run({ maxIterations: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result).toMatchObject({ code: "build_budget_exhausted", status: 503, retryable: true, iterationsUsed: 2 });
    expect(result.error).toMatch(/Max iterations reached/);
    expect(harness.calls).toBe(2);
  });

  it("the cap is clamped to the historical 20 (a larger request and no request both run 20 turns at most)", async () => {
    const larger = await run({ maxIterations: 50 });
    expect(larger.ok).toBe(false);
    expect(harness.calls).toBe(20);
    harness.calls = 0;
    const none = await run();
    expect(none.ok).toBe(false);
    expect(harness.calls).toBe(20);
  });
});

describe("[PR-C] failure classes", () => {
  it.each([
    ["insufficient_quota", false],
    ["breaker_open", false],
    ["rate_limit", true],
    ["overloaded", true],
  ] as const)("a provider failure with reason %s keeps the reason; retryable=%s", async (reason, retryable) => {
    harness.failure = new LLMProviderError("openai", reason as never, 429, reason);
    const result = await run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result).toMatchObject({ code: "provider_unavailable", status: 503, provider: "openai", reason, retryable, iterationsUsed: 1 });
    expect(JSON.stringify(result)).not.toMatch(/stack|node_modules/);
  });

  it("any other throw is build_loop_failed (500, retryable): a bounded, redacted sentence with no stack; the log is redacted too", async () => {
    harness.failure = new Error(`connect failed postgres://u:SENTINELPW@db.internal:5432/x ${"x".repeat(2_000)}`);
    const result = await run();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result).toMatchObject({ code: "build_loop_failed", status: 500, retryable: true, iterationsUsed: 1 });
    expect(result.error.length).toBeLessThanOrEqual(300);
    expect(result.error).not.toContain("SENTINELPW");
    expect(result.error).not.toMatch(/\n\s+at /);
    expect(JSON.stringify(result)).not.toMatch(/stack|node_modules/);
    expect(JSON.stringify(error.mock.calls)).not.toContain("SENTINELPW");
  });
});
