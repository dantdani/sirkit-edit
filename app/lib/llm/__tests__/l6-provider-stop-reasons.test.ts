/**
 * [PR-L, 2026-10-17] Runbook L.6, limit-and-stall-map.md section 4 (block Y): a provider turn cut at the output limit.
 *
 * Before: the OpenAI adapter passed `response.status` through and dropped `incomplete_details`, so a response cut by
 * `max_output_tokens` read as a plain "incomplete" with nothing saying why, and its cut function call arrived as `{ _raw }` like any
 * other call. Now the adapter reports `max_tokens` for that stop - the value Anthropic's `stop_reason` already uses for the same
 * stop, which the Anthropic adapter passes through unchanged (pinned here) - and any other `incomplete` stays `incomplete`. The
 * consumer side (the Build loop refusing such a submission) is l6-build-loop-submission. Fake SDK clients only; no network.
 */
import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../anthropic-provider";
import { OpenAIProvider } from "../openai-provider";
import type { LLMRequest } from "../types";

const REQUEST: LLMRequest = {
  provider: "openai",
  messages: [{ role: "user", content: "Block: Motor drivers" }],
  system: "Synthetic stop-reason test; do not contact any service.",
  maxTokens: 8_192,
  temperature: 0,
  tools: [{ name: "submit_schematic", description: "Submit", inputSchema: { type: "object", properties: {} } }],
};
const CUT_ARGUMENTS = '{"components":[{"refDes":"U1","partId":"11111111-1111-4111-8111-111111111111","value":"DRV8833","role":"output"},{"refDes":"U2","partId":"2222';

function openai(response: Record<string, unknown>) {
  const create = vi.fn(async () => ({ id: "resp-l6", model: "gpt-test", output_text: "", usage: { input_tokens: 61_000, output_tokens: 8_192 }, ...response }));
  return { provider: new OpenAIProvider({ responses: { create } } as never, "gpt-test"), create };
}

describe("[PR-L L.6] the OpenAI adapter surfaces why a response is incomplete", () => {
  it("cut by max_output_tokens: stopReason max_tokens, and the cut function call still arrives (as { _raw }) so the loop can answer it", async () => {
    const { provider } = openai({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "function_call", call_id: "call-cut", name: "submit_schematic", arguments: CUT_ARGUMENTS, status: "incomplete" }],
    });
    const response = await provider.generate(REQUEST);
    expect(response.stopReason).toBe("max_tokens");
    expect(response.toolCalls).toEqual([{ id: "call-cut", name: "submit_schematic", input: { _raw: CUT_ARGUMENTS } }]);
    expect(response.usage).toEqual({ inputTokens: 61_000, outputTokens: 8_192 });
  });

  it.each([
    [{ status: "incomplete", incomplete_details: { reason: "content_filter" } }, "incomplete"],
    [{ status: "incomplete", incomplete_details: null }, "incomplete"],
    [{ status: "incomplete" }, "incomplete"],
    [{ status: "completed" }, "completed"],
    [{ status: "failed" }, "failed"],
    [{}, undefined],
  ] as const)("%j -> stopReason %s (every other status passes through unchanged)", async (fields, expected) => {
    const { provider } = openai({ output: [], ...fields });
    expect((await provider.generate(REQUEST)).stopReason).toBe(expected);
  });

  it("a completed function call is parsed exactly as before", async () => {
    const { provider } = openai({ status: "completed", output: [{ type: "function_call", call_id: "call-ok", name: "submit_schematic", arguments: '{"components":[],"connections":[],"explanation":"x"}', status: "completed" }] });
    const response = await provider.generate(REQUEST);
    expect(response.stopReason).toBe("completed");
    expect(response.toolCalls).toEqual([{ id: "call-ok", name: "submit_schematic", input: { components: [], connections: [], explanation: "x" } }]);
  });
});

describe("[PR-L L.6] the Anthropic adapter already surfaces its max_tokens stop (unchanged)", () => {
  it.each(["max_tokens", "tool_use", "end_turn", "model_context_window_exceeded"])("stop_reason %s is the response's stopReason", async (stop) => {
    // a tool_use cut at max_tokens carries whatever input the API could parse - here a netlist without its connections
    const create = vi.fn(async () => ({ id: "msg-l6", model: "claude-test", content: [{ type: "tool_use", id: "toolu-cut", name: "submit_schematic", input: { components: [] } }], stop_reason: stop, usage: { input_tokens: 9, output_tokens: 4_096 } }));
    const provider = new AnthropicProvider({ messages: { create } } as never, "claude-sonnet-4-5");
    const response = await provider.generate({ ...REQUEST, provider: "anthropic" });
    expect(response.stopReason).toBe(stop);
    expect(response.toolCalls).toEqual([{ id: "toolu-cut", name: "submit_schematic", input: { components: [] } }]);
  });
});
