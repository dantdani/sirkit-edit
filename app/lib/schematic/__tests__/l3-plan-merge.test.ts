/**
 * [PR-L, 2026-10-17] Increment 3 part 1 (runbook L.3; task-worker-contract.md section 3.1): the generation split into
 * `planGeneration`, `designBlockSlice` and `mergeAndValidate` (app/lib/schematic/build-multi-generation.ts), through the real code
 * with the provider, catalog and ERC seams faked.
 *
 *  1. the planner's truncation defect: a submit_plan cut at the output limit (or whose arguments cannot be read) is a REFUSED plan
 *     with one correction attempt - never "zero blocks", which used to send a decomposed request to a single loop as a
 *     judged-simple one; the request-lifetime generation reports the refusal as a visible fallback;
 *  2. the merge refuses an empty block (and no block at all) for a durable task, while the request-lifetime contract stands;
 *  3. three blocks designed by the durable slices (each over two slices, the second resumed from the first's checkpoint) and
 *     merged give the SAME build result the request-lifetime generation gives for the same scripted provider and catalog.
 *
 * No provider, no database, no network: the router, the part search, the ERC and the KG are mocked (the generation-recovery seams).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMRequest, LLMResponse, LLMToolCall } from "@/app/lib/llm/types";
import type { AiPartResult } from "@/app/lib/parts-search";
import { generationSliceId, generationTaskId } from "@/app/lib/generation-task/contracts";
import type { GenerationBlockId } from "@/app/lib/generation-task/vocabulary";
import type { BuildCatalogPort, BuildLlmPort, BlockSliceOutcome } from "../build-loop-slice";
import { designBlockSlice, generationPlanInput, mergeAndValidate, planGeneration, runBuildMultiGeneration, PLAN_ATTEMPTS } from "../build-multi-generation";
import { BUILD_BUDGET, type BuildBudgetReport } from "../build-result";

const harness = vi.hoisted(() => ({ generate: vi.fn(), search: vi.fn(), readParts: vi.fn(), erc: vi.fn() }));
vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: (...args: unknown[]) => harness.generate(...args) } }));
vi.mock("@/app/lib/parts-search", () => ({
  searchPartsForAI: (...args: unknown[]) => harness.search(...args),
  getPartsByIds: (...args: unknown[]) => harness.readParts(...args),
  fetchAlternatesForAI: vi.fn(async () => []),
}));
vi.mock("@/lib/erc", () => ({ runErc: (...args: unknown[]) => harness.erc(...args), formatErcFeedback: vi.fn(() => "No electrical findings in the offline fixture.") }));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

const PROMPT = "build me a simple drone controlling circuit with 4 motors just a simple one";
const BLOCKS = [
  { name: "Power", brief: "1S LiPo input and a 3.3 V rail.", sharedNets: ["VBAT", "+3V3", "GND"] },
  { name: "Motor drivers", brief: "Four low-side motor channels.", sharedNets: ["VBAT", "GND", "PWM1"] },
  { name: "Flight controller", brief: "An MCU with PWM outputs.", sharedNets: ["+3V3", "GND", "PWM1"] },
] as const;
const PART_ID = "44444444-4444-4444-8444-444444444401";
const PART: AiPartResult = {
  partId: PART_ID, name: "Offline four-pin header", mpn: null, description: "Pin-valid test fixture, not a component recommendation.", mainCategory: "Connectors",
  pins: [{ number: "1", name: "P1", type: "passive" }, { number: "2", name: "P2", type: "passive" }, { number: "3", name: "P3", type: "passive" }, { number: "4", name: "P4", type: "passive" }],
  lifecycleStatus: "unknown", similarity: 1,
};
const SCOPE = { tenantId: "tenant-l3", projectId: "project-l3", branchId: "main" };
const TASK = generationTaskId(SCOPE, "user-l3-editor", "00000000-0000-4000-8000-000000000302");

const reply = (request: LLMRequest, toolCalls: LLMToolCall[], extra: Partial<LLMResponse> = {}): LLMResponse => ({ provider: request.provider, model: "offline-l3", text: "", toolCalls, stopReason: "tool_use", usage: { inputTokens: 50, outputTokens: 10 }, ...extra });
const isPlanner = (request: LLMRequest): boolean => request.tools?.some((tool) => tool.name === "submit_plan") === true;
const plan = (request: LLMRequest, blocks: readonly unknown[] = BLOCKS): LLMResponse => reply(request, [{ id: "call_plan", name: "submit_plan", input: { blocks: blocks as unknown[], rationale: "Power, four motor channels and a controller." } }]);
const cutPlan = (request: LLMRequest): LLMResponse => reply(request, [{ id: "call_plan_cut", name: "submit_plan", input: { _raw: '{"blocks":[{"name":"Power","brief":"1S Li' } }], { stopReason: "max_tokens", usage: { inputTokens: 50, outputTokens: 4_096 } });
const blockOf = (request: LLMRequest): string => {
  const first = request.messages[0]!.content;
  const text = typeof first === "string" ? first : first[0]?.type === "text" ? first[0].text : "";
  const name = /^Block: ([^\n]+)/.exec(text)?.[1];
  if (!name) throw new Error("Unexpected offline request.");
  return name;
};
/** A block's script: search the header, then submit it with a label on each of the block's shared nets. */
function blockTurn(request: LLMRequest): LLMResponse {
  const name = blockOf(request);
  const block = BLOCKS.find((entry) => entry.name === name)!;
  const turn = request.messages.filter((message) => message.role === "assistant").length + 1;
  if (turn === 1) return reply(request, [{ id: `call_search_${turn}`, name: "search_parts", input: { query: `four pin header for ${name.toLowerCase()}` } }]);
  return reply(request, [{
    id: `call_submit_${turn}`,
    name: "submit_schematic",
    input: {
      components: [{ refDes: "J1", partId: PART_ID, value: "header", role: "connector" }],
      connections: block.sharedNets.map((net, index) => ({ kind: "label", pin: `J1.${index + 1}`, labelName: net, labelKind: net === "GND" ? "ground" : net.startsWith("PWM") ? "label" : "power" })),
      explanation: `Offline ${name} fixture.`,
    },
  }]);
}
const portOf = (generate: (request: LLMRequest) => Promise<LLMResponse>): BuildLlmPort => ({ generate });
const CATALOG: BuildCatalogPort = {
  identity: { catalogProfile: "fixture-scripted", embeddingModel: "text-embedding-3-small" },
  searchParts: (...args) => harness.search(...args) as Promise<AiPartResult[]>,
  findAlternates: async () => [],
  partsByIds: (ids) => harness.readParts(ids) as Promise<AiPartResult[]>,
};

beforeEach(() => {
  harness.generate.mockReset();
  harness.search.mockReset().mockImplementation(async () => [structuredClone(PART)]);
  harness.readParts.mockReset().mockImplementation(async (ids: string[]) => (ids.includes(PART_ID) ? [structuredClone(PART)] : []));
  harness.erc.mockReset().mockReturnValue({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("[PR-L L.3] the planner's truncation is a refused plan with a correction, never zero blocks", () => {
  it("a submit_plan cut at the output limit is refused, the planner is asked again with the reason, and the complete plan is used", async () => {
    harness.generate.mockImplementationOnce(async (request: LLMRequest) => cutPlan(request)).mockImplementationOnce(async (request: LLMRequest) => plan(request));
    const outcome = await planGeneration({ prompt: PROMPT, provider: "openai" });
    expect(outcome).toMatchObject({ kind: "planned", attempts: 2, usage: { modelCalls: 2, inputTokens: 100, outputTokens: 4_106 } });
    if (outcome.kind !== "planned") throw new Error("planned expected");
    expect(outcome.plan.planner).toEqual({ state: "planned", blocks: 3 });
    expect(outcome.plan.blocks.map((block) => block.name)).toEqual(BLOCKS.map((block) => block.name));
    const second = harness.generate.mock.calls[1]![0] as LLMRequest;
    expect(second.toolChoice).toEqual({ name: "submit_plan" });
    expect(second.messages).toHaveLength(1); // the cut call is never replayed; the prompt again, with the reason it was not used
    expect(second.messages[0]!.content).toEqual([{ type: "text", text: PROMPT }, { type: "text", text: expect.stringMatching(/stopped at the output limit before its submit_plan call was complete/) }]);
  });

  it("cut on both attempts: refused PLAN_TRUNCATED after exactly two calls - no plan, and certainly not a zero-block plan", async () => {
    harness.generate.mockImplementation(async (request: LLMRequest) => cutPlan(request));
    const outcome = await planGeneration({ prompt: PROMPT, provider: "openai" });
    expect(outcome).toMatchObject({ kind: "refused", code: "PLAN_TRUNCATED", attempts: PLAN_ATTEMPTS });
    expect(harness.generate).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["unparseable arguments from a completed turn", { _raw: "{blocks: not json" }],
    ["blocks that are not a list", { blocks: "Power; Motor drivers", rationale: "x" }],
    ["a block without its brief", { blocks: [{ name: "Power", sharedNets: [] }, { name: "Motor drivers", brief: "x", sharedNets: [] }], rationale: "x" }],
  ])("%s is refused (PLAN_UNREADABLE) and corrected", async (_label, input) => {
    harness.generate.mockImplementationOnce(async (request: LLMRequest) => reply(request, [{ id: "call_plan_bad", name: "submit_plan", input: input as Record<string, unknown> }])).mockImplementationOnce(async (request: LLMRequest) => plan(request));
    const outcome = await planGeneration({ prompt: PROMPT, provider: "openai" });
    expect(outcome).toMatchObject({ kind: "planned", attempts: 2, plan: { planner: { state: "planned", blocks: 3 } } });
    const correction = (harness.generate.mock.calls[1]![0] as LLMRequest).messages[0]!.content;
    expect(JSON.stringify(correction)).toMatch(/could not be read/);
  });

  it("a durable plan holds at most 8 blocks: a larger plan is corrected (PLAN_TOO_MANY_BLOCKS); unbounded for the request-lifetime route as before", async () => {
    const nine = Array.from({ length: 9 }, (_, index) => ({ name: `Block ${index + 1}`, brief: "x", sharedNets: ["GND"] }));
    harness.generate.mockImplementation(async (request: LLMRequest) => plan(request, nine));
    expect(await planGeneration({ prompt: PROMPT, provider: "openai", maxBlocks: 8 })).toMatchObject({ kind: "refused", code: "PLAN_TOO_MANY_BLOCKS", attempts: 2 });
    expect(JSON.stringify((harness.generate.mock.calls[1]![0] as LLMRequest).messages)).toMatch(/at most 8 blocks/);
    harness.generate.mockClear();
    expect(await planGeneration({ prompt: PROMPT, provider: "openai" })).toMatchObject({ kind: "planned", attempts: 1, plan: { planner: { state: "planned", blocks: 9 } } });
  });

  it("unchanged: an empty plan from a complete turn is a judged-simple request; no submit_plan at all is 'no_plan'; one call each", async () => {
    harness.generate.mockImplementationOnce(async (request: LLMRequest) => plan(request, []));
    expect(await planGeneration({ prompt: "a 1k pull-up", provider: "openai" })).toMatchObject({ kind: "planned", attempts: 1, plan: { planner: { state: "single", reason: "simple_request" }, blocks: [] } });
    harness.generate.mockImplementationOnce(async (request: LLMRequest) => reply(request, [], { text: "I cannot plan this.", stopReason: "end_turn" }));
    expect(await planGeneration({ prompt: "a 1k pull-up", provider: "openai" })).toMatchObject({ kind: "planned", attempts: 1, plan: { planner: { state: "single", reason: "no_plan" } } });
    expect(harness.generate).toHaveBeenCalledTimes(2);
  });

  it("the request-lifetime generation: a cut plan then a complete one designs three blocks; cut twice is a VISIBLE fallback to one loop", async () => {
    let plannerCalls = 0;
    harness.generate.mockImplementation(async (request: LLMRequest) => (isPlanner(request) ? ((plannerCalls += 1) === 1 ? cutPlan(request) : plan(request)) : blockTurn(request)));
    const recovered = await runBuildMultiGeneration({ prompt: PROMPT, provider: "openai", environment: {} });
    expect(recovered).toMatchObject({ kind: "success", body: { status: "complete", planner: { state: "planned", blocks: 3 } } });

    harness.generate.mockReset();
    harness.generate.mockImplementation(async (request: LLMRequest) => {
      if (isPlanner(request)) return cutPlan(request);
      if (!request.messages.some((message) => message.role === "assistant")) return reply(request, [{ id: "call_search_single", name: "search_parts", input: { query: "four pin header" } }]);
      return reply(request, [{ id: "call_submit_single", name: "submit_schematic", input: { components: [{ refDes: "J1", partId: PART_ID, value: "header", role: "connector" }], connections: [], explanation: "One loop." } }]);
    });
    harness.search.mockClear();
    const fallback = await runBuildMultiGeneration({ prompt: PROMPT, provider: "openai", environment: {} });
    expect(fallback.kind).toBe("success");
    if (fallback.kind !== "success") return;
    // before: "single" / "simple_request" - the cut plan read as zero blocks. Now the refusal is the reported planner state.
    expect(fallback.body.planner).toEqual({ state: "failed_fallback", reason: "the planner's submit_plan was cut off at the output limit on both attempts; no plan was used" });
    const loopRequest = harness.generate.mock.calls.map((call) => call[0] as LLMRequest).find((request) => !isPlanner(request))!;
    expect(loopRequest.messages[0]!.content).toBe(PROMPT);
  });
});

describe("[PR-L L.3] mergeAndValidate refuses an empty block", () => {
  const budget = (): BuildBudgetReport => ({ iterationCap: BUILD_BUDGET.iterationCap, iterationsUsed: 4, deadlineMs: BUILD_BUDGET.deadlineMs, elapsedMs: 1, concurrencyCap: BUILD_BUDGET.concurrencyCap });
  const designed = (name: string, components: number) => ({
    name,
    netlist: { components: Array.from({ length: components }, (_, index) => ({ refDes: `J${index + 1}`, partId: PART_ID, value: "header", role: "connector" as const })), connections: [], explanation: `${name}.` },
    sharedNets: ["GND"],
  });

  it("a block with no component is refused by name for a durable task, before any catalog read or electrical check", async () => {
    const outcome = await mergeAndValidate({ designed: [designed("Power", 1), designed("Motor drivers", 0)], omittedBlocks: [], rationale: "", planner: { state: "planned", blocks: 2 }, budget, emptyBlocks: "refuse" });
    expect(outcome).toEqual({ kind: "refused", code: "MERGE_EMPTY_BLOCK", blocks: ["Motor drivers"], error: "A designed block has no component and cannot be merged: Motor drivers." });
    expect(harness.readParts).not.toHaveBeenCalled();
    expect(harness.erc).not.toHaveBeenCalled();
  });

  it("no designed block at all is refused (MERGE_NO_BLOCKS), never an empty success", async () => {
    expect(await mergeAndValidate({ designed: [], omittedBlocks: ["Power"], rationale: "", planner: { state: "planned", blocks: 1 }, budget, emptyBlocks: "accept" })).toMatchObject({ kind: "refused", code: "MERGE_NO_BLOCKS" });
  });

  it("the request-lifetime contract stands: 'accept' merges what its loops returned; the shared-net obligations are reported", async () => {
    const outcome = await mergeAndValidate({ designed: [designed("Power", 1), designed("Motor drivers", 0)], omittedBlocks: [], rationale: "", planner: { state: "planned", blocks: 2 }, budget, emptyBlocks: "accept" });
    expect(outcome.kind).toBe("merged");
    if (outcome.kind !== "merged") return;
    expect(outcome.body.netlist.components).toHaveLength(1);
    expect(outcome.sharedNets).toEqual({ checked: 1, findings: ["Shared net GND is labelled in 0 block(s); a shared net must join at least two blocks."] });
  });
});

describe("[PR-L L.3] three saved blocks merge to the build result the request-lifetime generation gives", () => {
  it("plan, then each block over two slices (the second resumed from the first's checkpoint), then mergeAndValidate == runBuildMultiGeneration", async () => {
    harness.generate.mockImplementation(async (request: LLMRequest) => (isPlanner(request) ? plan(request) : blockTurn(request)));
    const legacy = await runBuildMultiGeneration({ prompt: PROMPT, provider: "openai", environment: {} });
    expect(legacy.kind).toBe("success");
    if (legacy.kind !== "success") return;
    expect(legacy.body).toMatchObject({ status: "complete", omittedBlocks: [], planner: { state: "planned", blocks: 3 }, electricalCheck: { state: "passed" } });
    const legacyErcCalls = harness.erc.mock.calls.length;

    const llm = portOf(async (request) => (isPlanner(request) ? plan(request) : blockTurn(request)));
    const planned = await planGeneration({ prompt: PROMPT, provider: "openai", llm, maxBlocks: 8 });
    if (planned.kind !== "planned") throw new Error("planned expected");
    expect(generationPlanInput(planned.plan, PROMPT).blocks).toHaveLength(3);
    const saved: BlockSliceOutcome[] = [];
    for (const [index, block] of planned.plan.blocks.entries()) {
      const blockId = `b${index + 1}` as GenerationBlockId;
      const identity = (seq: number) => ({ taskId: TASK, blockId, sliceId: generationSliceId(TASK, 10 * (index + 1) + seq), attempt: 1, fence: 10 * (index + 1) + seq, strategy: "S1-baseline" as const });
      const first = await designBlockSlice({ prompt: PROMPT, block, checkpoint: null, identity: identity(1), policy: { maxTurns: 1, windowDeadlineAt: Date.now() + 300_000 }, provider: "openai", llm, catalog: CATALOG });
      expect(first).toMatchObject({ status: "yielded", reason: "turn_allowance" });
      const second = await designBlockSlice({ prompt: PROMPT, block, checkpoint: first.checkpoint, identity: identity(2), policy: { maxTurns: 1, windowDeadlineAt: Date.now() + 300_000 }, provider: "openai", llm, catalog: CATALOG });
      expect(second.status).toBe("submitted");
      saved.push(second);
    }
    const merged = await mergeAndValidate({
      designed: saved.map((outcome, index) => ({ name: planned.plan.blocks[index]!.name, netlist: outcome.checkpoint!.result!.netlist, sharedNets: planned.plan.blocks[index]!.sharedNets })),
      omittedBlocks: [],
      rationale: planned.plan.rationale,
      planner: planned.plan.planner,
      budget: () => legacy.body.budget,
      emptyBlocks: "refuse",
    });
    expect(merged.kind).toBe("merged");
    if (merged.kind !== "merged") return;
    expect(merged.body).toEqual(legacy.body);
    expect(merged.sharedNets).toEqual({ checked: 4, findings: [] }); // VBAT, +3V3, GND, PWM1: each labelled by two or three blocks
    expect(merged.parts?.map((part) => part.partId)).toEqual([PART_ID]);
    expect(harness.erc.mock.calls.length).toBe(legacyErcCalls * 2); // one gate per block and one merged check, on each path
  });

  it("the single design is block main with the whole request; a planned block needs a b1..b8 identity", async () => {
    harness.generate.mockImplementation(async (request: LLMRequest) => reply(request, [{ id: "call_submit", name: "submit_schematic", input: { components: [{ refDes: "J1", partId: PART_ID, value: "header", role: "connector" }], connections: [], explanation: "Whole." } }]));
    const identity = { taskId: TASK, blockId: "main" as const, sliceId: generationSliceId(TASK, 1), attempt: 1, fence: 1, strategy: "S1-baseline" as const };
    // the whole request asks for a part the slice never surfaced: refused, so the slice yields at its allowance (no catalog read)
    const outcome = await designBlockSlice({ prompt: PROMPT, block: null, checkpoint: null, identity, policy: { maxTurns: 1 }, provider: "openai", llm: portOf(async (request) => harness.generate(request) as Promise<LLMResponse>), catalog: CATALOG });
    expect(outcome).toMatchObject({ status: "yielded", reason: "turn_allowance" });
    expect((harness.generate.mock.calls[0]![0] as LLMRequest).messages[0]!.content).toBe(PROMPT);
    await expect(designBlockSlice({ prompt: PROMPT, block: BLOCKS[0] as unknown as { name: string; brief: string; sharedNets: string[] }, checkpoint: null, identity, policy: { maxTurns: 1 }, provider: "openai", llm: portOf(async (request) => harness.generate(request) as Promise<LLMResponse>), catalog: CATALOG })).rejects.toThrow(/DESIGN_BLOCK_IDENTITY_MISMATCH/);
  });
});
