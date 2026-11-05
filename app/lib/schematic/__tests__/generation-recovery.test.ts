/**
 * Real generation service + real Build loop, with only provider/catalog/ERC
 * seams faked. These tiny pin-valid blocks prove orchestration and recovery,
 * not the electrical adequacy of a real drone or any published part authority.
 * No provider credentials, network, database, or live simulator are used.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMRequest, LLMResponse, LLMToolCall } from "@/app/lib/llm/types";
import type { AiPartResult } from "@/app/lib/parts-search";
import { LLMProviderError } from "@/app/lib/llm/errors";
import { runBuildMultiGeneration } from "../build-multi-generation";
import { BUILD_BUDGET } from "../build-result";

const harness = vi.hoisted(() => ({
  generate: vi.fn(),
  search: vi.fn(),
  readParts: vi.fn(),
  erc: vi.fn(),
}));

vi.mock("@/app/lib/llm/router", () => ({
  llmRouter: { generate: (...args: unknown[]) => harness.generate(...args) },
}));
vi.mock("@/app/lib/parts-search", () => ({
  searchPartsForAI: (...args: unknown[]) => harness.search(...args),
  getPartsByIds: (...args: unknown[]) => harness.readParts(...args),
  fetchAlternatesForAI: vi.fn(async () => []),
}));
vi.mock("@/lib/erc", () => ({
  runErc: (...args: unknown[]) => harness.erc(...args),
  formatErcFeedback: vi.fn(() => "No electrical findings in the offline fixture."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

const START = Date.UTC(2026, 9, 17, 12);
const PROMPT = "Design a four-motor drone controller with power, motor drivers, and control.";
const BLOCKS = ["Power supply", "Motor drivers", "Controller"] as const;
const PART_ID = "11111111-1111-4111-8111-111111111111";
const PART: AiPartResult = {
  partId: PART_ID,
  name: "Offline two-pin connector",
  mpn: null,
  description: "Pin-valid test fixture, not a real component recommendation.",
  mainCategory: "Connector",
  pins: [
    { number: "1", name: "VCC", type: "passive" },
    { number: "2", name: "GND", type: "passive" },
  ],
  lifecycleStatus: "unknown",
  similarity: 1,
};

function response(request: LLMRequest, toolCalls: LLMToolCall[]): LLMResponse {
  return {
    provider: request.provider,
    model: "offline-generation-recovery",
    text: "",
    toolCalls,
    stopReason: "tool_use",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

function isPlanner(request: LLMRequest): boolean {
  return request.tools?.some((tool) => tool.name === "submit_plan") === true;
}

function planned(request: LLMRequest): LLMResponse {
  return response(request, [{
    id: "plan-offline",
    name: "submit_plan",
    input: {
      blocks: BLOCKS.map((name) => ({
        name,
        brief: "Design only the " + name + " fixture, with its two named rail pins.",
        sharedNets: ["VCC", "GND"],
      })),
      rationale: "Three independent offline blocks sharing explicitly named rails.",
    },
  }]);
}

function blockOf(request: LLMRequest): string {
  const first = request.messages[0]?.content;
  const name = typeof first === "string" ? /^Block: ([^\n]+)/.exec(first)?.[1] : undefined;
  if (!name || !(BLOCKS as readonly string[]).includes(name)) {
    throw new Error("Unexpected offline subsystem request.");
  }
  return name;
}

function submitted(request: LLMRequest, name: string): LLMResponse {
  return response(request, [{
    id: "submit-" + name,
    name: "submit_schematic",
    input: {
      components: [{ refDes: "J1", partId: PART_ID, value: "fixture", role: "primary" }],
      connections: [
        { kind: "label", pin: "J1.1", labelName: "VCC", labelKind: "power" },
        { kind: "label", pin: "J1.2", labelName: "GND", labelKind: "ground" },
      ],
      explanation: "Offline " + name + " fixture.",
    },
  }]);
}

function installThreeTurnScript(options: {
  plannerElapsedMs?: number;
  turnElapsedMs?: number;
  failBlock?: (name: string) => Error | null;
} = {}): Map<string, number> {
  const turns = new Map<string, number>();
  harness.generate.mockImplementation(async (request: LLMRequest) => {
    if (isPlanner(request)) {
      vi.setSystemTime(Date.now() + (options.plannerElapsedMs ?? 0));
      return planned(request);
    }
    const name = blockOf(request);
    const failure = options.failBlock?.(name);
    if (failure) throw failure;
    const turn = (turns.get(name) ?? 0) + 1;
    turns.set(name, turn);
    vi.setSystemTime(Date.now() + (options.turnElapsedMs ?? 0));
    if (turn <= 2) {
      return response(request, [{
        id: "search-" + name + "-" + turn,
        name: "search_parts",
        input: { query: turn === 1 ? "two pin motor connector" : "two pin power connector" },
      }]);
    }
    if (turn === 3) return submitted(request, name);
    throw new Error("The fixture should submit after exactly two searches.");
  });
  return turns;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function generate(deadlineMs?: number) {
  return runBuildMultiGeneration({
    prompt: PROMPT,
    provider: "openai",
    environment: {},
    ...(deadlineMs === undefined ? {} : { deadlineMs }),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
  harness.generate.mockReset();
  harness.search.mockReset().mockResolvedValue([PART]);
  harness.readParts.mockReset().mockImplementation(async (ids: string[]) => ids.includes(PART_ID) ? [PART] : []);
  harness.erc.mockReset().mockReturnValue({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("generation recovery over the real service and real Build loops", () => {
  it("an already-cancelled generation starts no provider, catalog or electrical-check work", async () => {
    const controller = new AbortController();
    controller.abort(new Error("private caller diagnostic must not be echoed"));
    const outcome = await runBuildMultiGeneration({ prompt: PROMPT, provider: "openai", environment: {}, signal: controller.signal });
    expect(outcome).toMatchObject({ kind: "failure", status: 408, body: { ok: false, code: "build_cancelled", retryable: false, stage: "planning" } });
    expect(JSON.stringify(outcome)).not.toContain("private caller diagnostic");
    expect(harness.generate).not.toHaveBeenCalled();
    expect(harness.search).not.toHaveBeenCalled();
    expect(harness.readParts).not.toHaveBeenCalled();
    expect(harness.erc).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a 13-second planner plus nine slower model turns completes all three blocks beyond the old 40-second ceiling", async () => {
    const turns = installThreeTurnScript({ plannerElapsedMs: 13_000, turnElapsedMs: 10_000 });
    const outcome = await generate();
    expect(BUILD_BUDGET.deadlineMs).toBe(180_000);
    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") throw new Error("The bounded offline three-block generation must complete.");
    expect(outcome.body).toMatchObject({
      ok: true,
      status: "complete",
      omittedBlocks: [],
      planner: { state: "planned", blocks: 3 },
      electricalCheck: { state: "passed" },
      budget: { iterationCap: 20, iterationsUsed: 9, deadlineMs: 180_000, concurrencyCap: 3 },
    });
    expect(outcome.body.budget.elapsedMs).toBeGreaterThan(40_000);
    expect(outcome.body.budget.elapsedMs).toBeLessThan(180_000);
    expect([...turns.entries()].sort()).toEqual(BLOCKS.map((name) => [name, 3]).sort());
    expect(harness.generate).toHaveBeenCalledTimes(10);
    expect(harness.search).toHaveBeenCalledTimes(6);
    expect(harness.erc).toHaveBeenCalledTimes(4); // one per real loop, then the real service's merged check
    expect(outcome.body.netlist.components.map((component) => component.refDes)).toEqual(["J1", "J2", "J3"]);
    expect(outcome.body.netlist.connections).toHaveLength(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the caller's 1-second deadline wins: a late planner result cannot start subsystem work or hide its budget cause", async () => {
    installThreeTurnScript({ plannerElapsedMs: 1_001 });
    const outcome = await generate(1_000);
    expect(outcome).toMatchObject({ kind: "failure", status: 503, body: { ok: false, code: "build_budget_exhausted", retryable: true } });
    if (outcome.kind !== "failure") throw new Error("The expired planner must fail locally.");
    expect(outcome.body.error).toMatch(/planner|planning/i);
    expect(outcome.body.error).toMatch(/deadline|budget/i);
    expect(outcome.body.error).not.toMatch(/^All \d+ subsystem blocks failed to design\.$/);
    expect(harness.generate).toHaveBeenCalledTimes(1);
    expect(harness.search).not.toHaveBeenCalled();
    expect(harness.erc).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("all three local failures retain block names and their core cause in bounded, redacted diagnostics", async () => {
    installThreeTurnScript({
      failBlock: (name) => new Error("catalog adapter crashed for " + name + " postgres://u:SENTINELPW@db.internal:5432/x " + "x".repeat(3_000)),
    });
    const outcome = await generate();
    expect(outcome).toMatchObject({ kind: "failure", status: 500, body: { ok: false, code: "build_loop_failed", retryable: true } });
    if (outcome.kind !== "failure") throw new Error("No subsystem succeeded.");
    for (const name of BLOCKS) expect(outcome.body.error).toContain(name);
    expect(outcome.body.error).toContain("catalog adapter crashed");
    expect(outcome.body.error.length).toBeLessThanOrEqual(2_000);
    expect(JSON.stringify(outcome)).not.toContain("SENTINELPW");
    expect(JSON.stringify(outcome)).not.toMatch(/\n\s+at |node_modules/);
    expect(harness.search).not.toHaveBeenCalled();
    expect(harness.readParts).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a never-settling planner is aborted at the deadline; a later valid plan cannot start new work or settle twice", async () => {
    const pending = deferred<LLMResponse>();
    let plannerRequest: LLMRequest | undefined;
    harness.generate.mockImplementation((request: LLMRequest) => {
      plannerRequest = request;
      return pending.promise;
    });
    const settled = vi.fn();
    const job = generate(1_000).then((outcome) => { settled(outcome); return outcome; });
    await vi.advanceTimersByTimeAsync(1_001);
    const outcome = await job;
    expect(outcome).toMatchObject({ kind: "failure", status: 503, body: { code: "build_budget_exhausted" } });
    expect(plannerRequest?.signal?.aborted).toBe(true);
    if (!plannerRequest) throw new Error("The planner was never called.");
    pending.resolve(planned(plannerRequest));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(harness.generate).toHaveBeenCalledTimes(1);
    expect(harness.search).not.toHaveBeenCalled();
    expect(harness.erc).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hanging subsystem calls are aborted; late submissions and a late rejection cannot produce a merged success", async () => {
    const pending = new Map<string, { request: LLMRequest; answer: ReturnType<typeof deferred<LLMResponse>> }>();
    const turns = new Map<string, number>();
    harness.generate.mockImplementation((request: LLMRequest) => {
      if (isPlanner(request)) return Promise.resolve(planned(request));
      const name = blockOf(request);
      const turn = (turns.get(name) ?? 0) + 1;
      turns.set(name, turn);
      if (turn <= 2) {
        return Promise.resolve(response(request, [{
          id: "search-" + name + "-" + turn,
          name: "search_parts",
          input: { query: "two pin connector" },
        }]));
      }
      const answer = deferred<LLMResponse>();
      pending.set(name, { request, answer });
      return answer.promise;
    });
    const settled = vi.fn();
    const job = generate(1_000).then((outcome) => { settled(outcome); return outcome; });
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.size).toBe(3);
    expect(harness.search).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1_001);
    const outcome = await job;
    expect(outcome).toMatchObject({ kind: "failure", status: 503, body: { code: "build_budget_exhausted" } });
    for (const { request } of pending.values()) expect(request.signal?.aborted).toBe(true);
    for (const [name, { request, answer }] of pending) {
      if (name === "Controller") answer.reject(new Error("late offline provider rejection"));
      else answer.resolve(submitted(request, name));
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(harness.generate).toHaveBeenCalledTimes(10);
    expect(harness.erc).not.toHaveBeenCalled();
    expect(harness.readParts).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a block's provider quota failure keeps precedence over the other two successfully designed blocks", async () => {
    installThreeTurnScript({
      failBlock: (name) => name === "Motor drivers" ? new LLMProviderError("openai", "insufficient_quota", 429, "no credits (offline)") : null,
    });
    const outcome = await generate();
    expect(outcome).toMatchObject({
      kind: "failure",
      status: 503,
      body: { ok: false, code: "provider_unavailable", provider: "openai", reason: "insufficient_quota", retryable: false },
    });
    expect(harness.search).toHaveBeenCalledTimes(4);
    expect(harness.erc).toHaveBeenCalledTimes(2);
    expect(harness.readParts).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
