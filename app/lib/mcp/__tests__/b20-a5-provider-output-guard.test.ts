/**
 * [B20 A5] The provider output guard (OD-91): the agent adapters accept only the output items they handle, judge the list
 * ONCE before anything of the response is used, and stop the run closed on anything else — an item the adapters did not
 * request fails `provider_unrequested_output`, and a malformed list or item `provider_unknown`. [B20 A5 lead] NOT "as
 * before A5" for an ITEM: a malformed item used to complete the step (the adapter skipped what it did not recognise),
 * and now fails the run closed - the case at the end of this suite is the one that proves it.
 *
 * No network: every provider client is an in-process fake and the global fetch is poisoned. Fixture credentials are
 * assembled at run time and are obvious fakes (S8).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_HANDLED_BLOCK_TYPES,
  OPENAI_HANDLED_OUTPUT_TYPES,
  PROVIDER_OUTPUT_ITEMS_MAX,
  PROVIDER_OUTPUT_TYPE_MAX_CHARS,
  judgeProviderOutput,
} from "../../agent/provider-output-guard";
import { AnthropicAgentAdapter, OpenAIAgentAdapter } from "../../agent/adapters";
import { LLMProviderError, isRetryableReason } from "../../llm/errors";
import { assembleAgentRunContext } from "../../agent/context";
import { DEFAULT_AGENT_BUDGET, type AgentRunEvent } from "../../agent/contracts";
import { createAgentToolGateway } from "../../agent/gateway";
import { runAgentLoop } from "../../agent/loop";
import { isRecoverableProviderFailure } from "../../agent/run-consumer";
import { isValidFailureReason } from "../../agent/trace";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { createEmptyBoard } from "../../pcb/types";
import type { SchematicState } from "@/lib/schematic-types";

/** obvious fakes, assembled at run time so no file carries a key-shaped literal (S8) */
const TOKEN = ["fxA5", "7c2e", "91bd", "44f0"].join("-");
const SENTINEL = ["A5", "SENTINEL", "q7"].join("_");
const NUL = String.fromCharCode(0);

vi.stubGlobal("fetch", () => { throw new Error("no network"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.stubGlobal("fetch", () => { throw new Error("no network"); }); });

const openAIResponse = (output: unknown, text = ""): never =>
  ({ output, output_text: text, status: "completed", model: "gpt-test", usage: { input_tokens: 10, output_tokens: 5 } }) as never;
const anthropicMessage = (content: unknown): never =>
  ({ content, stop_reason: "end_turn", model: "claude-test", usage: { input_tokens: 10, output_tokens: 5 } }) as never;
const openAIAdapter = (create: unknown): OpenAIAgentAdapter => new OpenAIAgentAdapter({ responses: { create } } as never, "gpt-test", undefined);
const anthropicAdapter = (create: unknown): AnthropicAgentAdapter => new AnthropicAgentAdapter({ messages: { create } } as never, "claude-test");
const START = { system: "sys", history: [] as never[], userMessage: "hi", tools: [] };

/**
 * The fixed sentences, written out here VERBATIM so the suite never reads its expectation from the module under test.
 * [B20 A5 review] they were derived from `new LLMProviderError(provider, reason).message`, i.e. from the same
 * `friendlyMessage` under test, which made every wording assertion tautological: rewording the `unrequested_output`
 * sentence to the `default` branch's sentence left all thirty cases green. The policy suite already writes its thirteen
 * sentences out for exactly this reason.
 */
const SENTENCES: Readonly<Record<"openai" | "anthropic", Readonly<Record<"unrequested_output" | "unknown", string>>>> = {
  openai: {
    unrequested_output: "OpenAI returned output Sirkit did not request, such as a tool the provider ran on its own; the run was stopped and nothing from that response was used.",
    unknown: "OpenAI is currently unavailable.",
  },
  anthropic: {
    unrequested_output: "Anthropic returned output Sirkit did not request, such as a tool the provider ran on its own; the run was stopped and nothing from that response was used.",
    unknown: "Anthropic is currently unavailable.",
  },
};
const sentenceOf = (provider: "openai" | "anthropic", reason: "unrequested_output" | "unknown"): string => SENTENCES[provider][reason];

async function rejection(work: Promise<unknown>): Promise<LLMProviderError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof LLMProviderError) return error;
    throw error;
  }
  throw new Error("the call resolved; it had to reject");
}

function expectClosed(error: LLMProviderError, provider: "openai" | "anthropic", reason: "unrequested_output" | "unknown"): void {
  expect(error.reason).toBe(reason);
  expect(error.provider).toBe(provider);
  expect(error.message).toBe(sentenceOf(provider, reason));
  expect(error.providerStatus).toBeUndefined();
  expect(error.providerCode).toBeUndefined();
  expect(error.providerMessage).toBeUndefined();
  expect(error.cause).toBeUndefined();
  for (const text of [String(error), JSON.stringify(error), JSON.stringify({ ...error, message: error.message })]) {
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain(TOKEN);
  }
}

const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };

/**
 * The REAL loop over the REAL OpenAI adapter and a fake client that answers `output` once. Every gateway invocation is
 * counted, so "no tool call is returned" is asserted where the guarantee lives rather than in an error's serialisation.
 */
async function runLoopWith(runId: string, output: unknown): Promise<{
  result: Awaited<ReturnType<typeof runAgentLoop>>;
  events: AgentRunEvent[];
  invocations: number;
  create: ReturnType<typeof vi.fn>;
}> {
  const assembly = assembleAgentRunContext({
    tenantId: "local",
    projectId: "p1",
    branchId: "main",
    schematic: SCHEMATIC,
    board: createEmptyBoard(),
    schematicHeadMark: { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef" },
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  const create = vi.fn(async () => openAIResponse(output));
  const events: AgentRunEvent[] = [];
  const registry = sirkitToolRegistry();
  const base = createAgentToolGateway(registry);
  let invocations = 0;
  const gateway: typeof base = { ...base, invoke: async (input) => { invocations += 1; return base.invoke(input); } };
  const result = await runAgentLoop(
    { runId, provider: "openai", history: [], userMessage: "go", budget: { ...DEFAULT_AGENT_BUDGET } },
    { adapter: openAIAdapter(create), gateway, registry, context: assembly.context, system: "sys", emit: (event) => events.push(event) },
  );
  return { result, events, invocations, create };
}

describe("[B20 A5] judgeProviderOutput — what the adapters requested (OD-91)", () => {
  it("accepts exactly the handled OpenAI output items and Anthropic content blocks, alone, together and empty, and every B09 response shape", () => {
    expect(Object.isFrozen(OPENAI_HANDLED_OUTPUT_TYPES)).toBe(true);
    expect(Object.isFrozen(ANTHROPIC_HANDLED_BLOCK_TYPES)).toBe(true);
    expect([...OPENAI_HANDLED_OUTPUT_TYPES]).toEqual(["function_call", "message", "reasoning"]);
    expect([...ANTHROPIC_HANDLED_BLOCK_TYPES]).toEqual(["redacted_thinking", "text", "thinking", "tool_use"]);
    expect(PROVIDER_OUTPUT_TYPE_MAX_CHARS).toBe(64);
    expect(PROVIDER_OUTPUT_ITEMS_MAX).toBe(1024);

    for (const [provider, types] of [["openai", OPENAI_HANDLED_OUTPUT_TYPES], ["anthropic", ANTHROPIC_HANDLED_BLOCK_TYPES]] as const) {
      expect(judgeProviderOutput(provider, [])).toEqual({ ok: true });
      for (const type of types) expect(judgeProviderOutput(provider, [{ type }]), type).toEqual({ ok: true });
      expect(judgeProviderOutput(provider, types.map((type) => ({ type })))).toEqual({ ok: true });
    }
    // every response shape B09's provider-contract suite drives the real adapters with
    const b09OpenAI: unknown[][] = [
      [{ type: "message", role: "assistant", content: [] }],
      [{ type: "reasoning", id: "rs_1", encrypted_content: "OPAQUE-REASONING", summary: [] }, { type: "function_call", call_id: "call_abc", name: "sirkit_schematic_inspect", arguments: "{}" }],
      [],
      [{ type: "function_call", call_id: "call_x", name: "sirkit_schematic_inspect", arguments: "{not json" }],
    ];
    const b09Anthropic: unknown[][] = [
      [{ type: "text", text: "Hello." }],
      [{ type: "text", text: "Checking." }, { type: "tool_use", id: "toolu_9", name: "sirkit_schematic_inspect", input: {} }],
      [{ type: "tool_use", id: "toolu_1", name: "a", input: { n: 1 } }, { type: "tool_use", id: "toolu_2", name: "b", input: { n: 2 } }],
    ];
    for (const output of b09OpenAI) expect(judgeProviderOutput("openai", output), JSON.stringify(output)).toEqual({ ok: true });
    for (const content of b09Anthropic) expect(judgeProviderOutput("anthropic", content), JSON.stringify(content)).toEqual({ ok: true });
  });

  it("refuses every well-formed item type outside the handled set as unrequested, at the first, middle and last position, and the FIRST unhandled item decides", () => {
    const openAiUnhandled = ["mcp_list_tools", "mcp_call", "mcp_approval_request", "mcp_approval_response", "web_search_call", "file_search_call", "code_interpreter_call", "computer_call", "image_generation_call", "function_call_output", "mcp_future"];
    const anthropicUnhandled = ["mcp_tool_use", "mcp_tool_result", "server_tool_use", "web_search_tool_result", "tool_result", "image"];
    const cases: Array<["openai" | "anthropic", readonly string[], Record<string, unknown>]> = [
      ["openai", openAiUnhandled, { type: "message", role: "assistant", content: [] }],
      ["anthropic", anthropicUnhandled, { type: "text", text: "ok" }],
    ];
    for (const [provider, unhandled, valid] of cases) {
      for (const type of unhandled) {
        const item = { type, server_label: SENTINEL, output: SENTINEL + TOKEN };
        for (const list of [[item], [item, valid, valid], [valid, item, valid], [valid, valid, item]]) {
          expect(judgeProviderOutput(provider, list), `${provider} ${type}`).toEqual({ ok: false, kind: "unrequested" });
        }
      }
    }
    // first-decides: a well-formed unhandled item before a malformed one is `unrequested`
    expect(judgeProviderOutput("openai", [{ type: "mcp_call" }, { type: 5 }])).toEqual({ ok: false, kind: "unrequested" });
    expect(judgeProviderOutput("anthropic", [{ type: "mcp_tool_use" }, { type: 5 }])).toEqual({ ok: false, kind: "unrequested" });
  });

  it("malformed input is malformed, never a throw and never an echo: a bad provider, a bad list, a bad item, a type that is not a plain token, and the FIRST item decides", () => {
    const malformed: Array<[unknown, unknown, string]> = [];
    for (const provider of ["x", null, undefined, 1, {}, "OpenAI", "openai ", ["openai"]]) malformed.push([provider, [{ type: "message" }], `provider ${String(provider)}`]);
    for (const items of [null, undefined, {}, "message", 3, true, new Set()]) malformed.push(["openai", items, `items ${String(items)}`]);
    for (const entry of [null, undefined, "message", 3, [], [[]], true]) malformed.push(["openai", [entry], `entry ${String(entry)}`]);
    malformed.push(["openai", [Object.create({ type: "message" }) as object], "inherited-only type"]);
    for (const type of [1, {}, ["message"], null, undefined, true, "", "Message", "message ", `function_call${NUL}`, " message", "message-block", "_message", "1message", "a".repeat(PROVIDER_OUTPUT_TYPE_MAX_CHARS + 1), "a".repeat(1_000_000)]) {
      malformed.push(["openai", [{ type }], `type ${String(type).slice(0, 24)}`]);
    }
    malformed.push(["openai", [{ get type(): string { throw new Error(SENTINEL); } }], "throwing type getter"]);
    const hostile = new Proxy({}, new Proxy({}, { get: () => () => { throw new Error(SENTINEL); } }));
    malformed.push(["openai", [hostile], "hostile item proxy"]);
    for (const length of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, 2 ** 53]) {
      malformed.push(["openai", new Proxy([{ type: "message" }], { get: (target, key, receiver) => (key === "length" ? length : Reflect.get(target, key, receiver)) }), `length ${String(length)}`]);
    }
    malformed.push(["openai", new Proxy([{ type: "message" }], { get: (target, key, receiver) => { if (key === "length") throw new Error(SENTINEL); return Reflect.get(target, key, receiver); } }), "throwing length"]);
    malformed.push(["openai", new Array(4_294_967_295) as unknown[], "sparse array of the maximum length"]);
    // first-decides: a malformed item before a well-formed unhandled one is `malformed`
    malformed.push(["openai", [{ type: 5 }, { type: "mcp_call" }], "first-decides"]);
    malformed.push(["anthropic", [{ type: 5 }, { type: "mcp_tool_use" }], "first-decides (anthropic)"]);

    const judgements = new Set<unknown>();
    for (const [provider, items, label] of malformed) {
      const judgement = judgeProviderOutput(provider as "openai", items);
      expect(judgement, label).toEqual({ ok: false, kind: "malformed" });
      expect(JSON.stringify(judgement), label).not.toContain(SENTINEL);
      judgements.add(judgement);
    }
    // every judgement is one of the three frozen constants: identity, not a fresh object
    judgements.add(judgeProviderOutput("openai", [{ type: "message" }]));
    judgements.add(judgeProviderOutput("openai", [{ type: "mcp_call" }]));
    expect(judgements.size).toBe(3);
    for (const judgement of judgements) expect(Object.isFrozen(judgement)).toBe(true);
  });

  it("bounds: 1 024 items are judged and 1 025 are malformed; a type at the bound is unrequested and one past it malformed; and every REAL provider-run block type the installed SDKs declare fits under the bound", () => {
    const item = { type: "message", role: "assistant", content: [] };
    expect(judgeProviderOutput("openai", Array.from({ length: PROVIDER_OUTPUT_ITEMS_MAX }, () => item))).toEqual({ ok: true });
    expect(judgeProviderOutput("openai", Array.from({ length: PROVIDER_OUTPUT_ITEMS_MAX + 1 }, () => item))).toEqual({ ok: false, kind: "malformed" });
    expect(judgeProviderOutput("openai", [{ type: "a".repeat(PROVIDER_OUTPUT_TYPE_MAX_CHARS) }])).toEqual({ ok: false, kind: "unrequested" });
    expect(judgeProviderOutput("openai", [{ type: "a".repeat(PROVIDER_OUTPUT_TYPE_MAX_CHARS + 1) }])).toEqual({ ok: false, kind: "malformed" });

    // [B20 A5 review] the bound is applied BEFORE the well-formed pattern, so a bound that is too tight turns a real
    // provider-run block into a shape fault and loses exactly the OD-91 signal the guard exists for: the run would fail
    // `provider_unknown` ("… is currently unavailable.") instead of `provider_unrequested_output`. The installed
    // Anthropic SDK's `ContentBlock` union declares two text-editor code-execution results of 38 and 44 characters, so a
    // 32-character bound misclassified them. These are the longest provider-run types either SDK declares today.
    const realProviderRunTypes = [
      "text_editor_code_execution_tool_result",
      "text_editor_code_execution_tool_result_error",
      "bash_code_execution_tool_result",
      "code_execution_tool_result",
      "web_search_tool_result",
      "server_tool_use",
      "mcp_tool_use",
      "mcp_tool_result",
    ];
    for (const type of realProviderRunTypes) {
      expect(type.length, `${type} is ${type.length} characters`).toBeLessThanOrEqual(PROVIDER_OUTPUT_TYPE_MAX_CHARS);
      expect(judgeProviderOutput("anthropic", [{ type }]), type).toEqual({ ok: false, kind: "unrequested" });
    }
    expect(Math.max(...realProviderRunTypes.map((type) => type.length))).toBe(44);
  });
});

describe("[B20 A5] the agent adapters stop the run before anything of the response is used (OD-91)", () => {
  it("OpenAI start: a provider-run tool item beside a reasoning item rejects with provider_unrequested_output and one fixed sentence", async () => {
    const create = vi.fn(async () => openAIResponse([
      { type: "reasoning", id: "rs_1", encrypted_content: "OPAQUE", summary: [] },
      { type: "mcp_call", server_label: SENTINEL, arguments: SENTINEL, output: SENTINEL + TOKEN },
    ]));
    const error = await rejection(openAIAdapter(create).start(START));
    expectClosed(error, "openai", "unrequested_output");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("OpenAI continueWith: the first step is a valid function_call, the second carries a provider-run listing; the first step's continuation is untouched", async () => {
    const first = [{ type: "function_call", call_id: "call_abc", name: "sirkit_schematic_inspect", arguments: "{}" }];
    const create = vi.fn()
      .mockResolvedValueOnce(openAIResponse(first))
      .mockResolvedValueOnce(openAIResponse([{ type: "mcp_list_tools", tools: [{ name: SENTINEL }] }]));
    const adapter = openAIAdapter(create);
    const step = await adapter.start(START);
    const snapshot = structuredClone(step.continuation) as unknown;
    const error = await rejection(adapter.continueWith({ continuation: step.continuation, results: [{ callId: "call_abc", outputText: "{}", isError: false }], tools: [] }));
    expectClosed(error, "openai", "unrequested_output");
    expect(create).toHaveBeenCalledTimes(2);
    expect(step.continuation).toEqual(snapshot);
  });

  it("Anthropic start and continueWith: provider-run tool blocks carrying the sentinel reject with provider_unrequested_output", async () => {
    const use = { type: "mcp_tool_use", id: "mcptoolu_1", name: SENTINEL, server_name: SENTINEL, input: { q: TOKEN } };
    const result = { type: "mcp_tool_result", tool_use_id: "mcptoolu_1", is_error: false, content: [{ type: "text", text: SENTINEL + TOKEN }] };
    const startCreate = vi.fn(async () => anthropicMessage([use]));
    expectClosed(await rejection(anthropicAdapter(startCreate).start(START)), "anthropic", "unrequested_output");
    expect(startCreate).toHaveBeenCalledTimes(1);

    const create = vi.fn()
      .mockResolvedValueOnce(anthropicMessage([{ type: "tool_use", id: "toolu_1", name: "sirkit_schematic_inspect", input: {} }]))
      .mockResolvedValueOnce(anthropicMessage([{ type: "text", text: "ok" }, result]));
    const adapter = anthropicAdapter(create);
    const step = await adapter.start(START);
    const error = await rejection(adapter.continueWith({ continuation: step.continuation, results: [{ callId: "toolu_1", outputText: "{}", isError: false }], tools: [] }));
    expectClosed(error, "anthropic", "unrequested_output");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("a valid function_call beside a provider-run call is refused WHOLE: the step rejects, and in the REAL loop no tool is invoked and no tool event is emitted", async () => {
    const output = [
      { type: "function_call", call_id: "call_ok", name: "sirkit_schematic_inspect", arguments: "{}" },
      { type: "mcp_call", server_label: SENTINEL, output: SENTINEL },
    ];
    const create = vi.fn(async () => openAIResponse(output));
    const error = await rejection(openAIAdapter(create).start(START));
    expectClosed(error, "openai", "unrequested_output");
    // [B20 A5 review] `JSON.stringify(error)` alone proves nothing here: an LLMProviderError serialises four fixed own
    // properties (`code`, `provider`, `reason`, `name`) and can never carry a call id whatever the adapter does. The
    // message is spread back in, and the guarantee itself is asserted on the REAL loop below.
    for (const text of [String(error), JSON.stringify(error), JSON.stringify({ ...error, message: error.message })]) {
      expect(text).not.toContain("call_ok");
    }
    const run = await runLoopWith("run-a5-whole", output);
    expect(run.result.status).toBe("failed");
    expect(run.result.failureReason).toBe("provider_unrequested_output");
    expect(run.invocations, "the gateway was asked to invoke a tool").toBe(0);
    expect(run.events.filter((event) => event.type.startsWith("tool_")).map((event) => event.type)).toEqual([]);
    for (const text of [JSON.stringify(run.result), JSON.stringify(run.events)]) expect(text).not.toContain("call_ok");
  });

  it("a malformed LIST fails as it did before A5: provider_unknown with its own fixed sentence, no cause and no provider fields", async () => {
    // only a NON-ARRAY or absent list threw before A5 (`response.output.filter(...)` / `message.content.filter(...)`
    // raised a TypeError inside the adapter's try, which `toProviderError` turned into `unknown`)
    for (const output of [undefined, 3, "x"]) {
      const create = vi.fn(async () => openAIResponse(output, SENTINEL));
      expectClosed(await rejection(openAIAdapter(create).start(START)), "openai", "unknown");
    }
    for (const content of [undefined, "x"]) {
      const create = vi.fn(async () => anthropicMessage(content));
      expectClosed(await rejection(anthropicAdapter(create).start(START)), "anthropic", "unknown");
    }
  });

  it("a malformed ITEM inside a well-formed list now fails the run too — a DELIBERATE change, not parity: before A5 the adapters' filter skipped it and the step completed", async () => {
    const valid = { type: "message", role: "assistant", content: [] };
    const lists: Array<[string, unknown[]]> = [
      ["a non-string type", [{ type: 5 }]],
      ["an inherited-only type", [Object.create({ type: "message" }) as object]],
      ["a hyphenated type", [{ type: "message-block" }]],
      ["a type past the bound", [{ type: "a".repeat(PROVIDER_OUTPUT_TYPE_MAX_CHARS + 1) }]],
      ["a list past the item cap", Array.from({ length: PROVIDER_OUTPUT_ITEMS_MAX + 1 }, () => valid)],
    ];
    for (const [label, output] of lists) {
      // what pre-A5 normalisation did with it: a well-formed ARRAY whose entries simply did not match `function_call`,
      // so the filter yielded no tool call and every entry was round-tripped verbatim into the continuation
      expect(Array.isArray(output), label).toBe(true);
      expect((output as Array<{ type?: unknown }>).filter((item) => item.type === "function_call"), label).toHaveLength(0);
      // what A5 does with it: the run stops, `provider_unknown`, and nothing of the response is used
      const create = vi.fn(async () => openAIResponse(output, SENTINEL));
      expectClosed(await rejection(openAIAdapter(create).start(START)), "openai", "unknown");
      expect(create, label).toHaveBeenCalledTimes(1);
    }
    const anthropic = vi.fn(async () => anthropicMessage([{ type: "text", text: "ok" }, { type: 5 }]));
    expectClosed(await rejection(anthropicAdapter(anthropic).start(START)), "anthropic", "unknown");
  });

  it("provider_unrequested_output is a recoverable provider failure that is never retried automatically", () => {
    // [B20 A5 review] the page states both, and neither was pinned: `isRetryableReason` is an explicit list, so adding
    // this reason to it would advertise `retryable: true` for a response Sirkit refused, with no test going red.
    expect(isRetryableReason("unrequested_output")).toBe(false);
    expect(isRetryableReason("unknown")).toBe(false);
    for (const reason of ["rate_limit", "overloaded", "timeout", "network"] as const) expect(isRetryableReason(reason), reason).toBe(true);
    expect(isRecoverableProviderFailure("provider_unrequested_output")).toBe(true);
    expect(isRecoverableProviderFailure("provider_cancelled")).toBe(false);
    expect(isValidFailureReason("provider_unrequested_output")).toBe(true);
  });

  it("the list is read exactly ONCE by each adapter: the guard and the normalisation share one reference", async () => {
    let openAiReads = 0;
    const response = { output_text: "", status: "completed", model: "gpt-test", usage: { input_tokens: 1, output_tokens: 1 }, get output(): unknown[] { openAiReads += 1; return [{ type: "message", role: "assistant", content: [] }]; } };
    await openAIAdapter(vi.fn(async () => response as never)).start(START);
    expect(openAiReads).toBe(1);

    let anthropicReads = 0;
    const message = { stop_reason: "end_turn", model: "claude-test", usage: { input_tokens: 1, output_tokens: 1 }, get content(): unknown[] { anthropicReads += 1; return [{ type: "text", text: "ok" }]; } };
    await anthropicAdapter(vi.fn(async () => message as never)).start(START);
    expect(anthropicReads).toBe(1);
  });

  it("the REAL loop stops the run: status failed, provider_unrequested_output, run_started first, one run_failed last and no tool or text event", async () => {
    const { result, events, create } = await runLoopWith("run-a5", [{ type: "mcp_approval_request", arguments: SENTINEL, server_label: SENTINEL }]);
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("provider_unrequested_output");
    expect(isValidFailureReason(result.failureReason!)).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(events[0]!.type).toBe("run_started");
    const terminal = events.at(-1)!;
    expect(terminal.type).toBe("run_failed");
    expect((terminal as { reason: string }).reason).toBe("provider_unrequested_output");
    expect((terminal as { message: string }).message).toBe(sentenceOf("openai", "unrequested_output"));
    expect(events.filter((event) => event.type === "run_failed")).toHaveLength(1);
    expect(events.slice(1, -1).map((event) => event.type).filter((type) => type !== "warning")).toEqual([]);
    for (const text of [JSON.stringify(result), JSON.stringify(events)]) {
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toContain(TOKEN);
    }
  });
});
