/**
 * B09 — provider contract tests (areas 1–10): the REAL agent adapters driven
 * by FAKE SDK clients. No live credentials, no network.
 */

import { describe, expect, it, vi } from "vitest";
import { AnthropicAgentAdapter, OpenAIAgentAdapter } from "../adapters";
import { buildAgentToolDeclarations, renderAnthropicAgentTool, renderOpenAiResponsesTool, toStrictSchema } from "../provider-tools";
import type { ProviderToolDeclaration } from "../contracts";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";

const DECLS: ProviderToolDeclaration[] = buildAgentToolDeclarations([sirkitToolRegistry().get("sirkit.schematic.inspect")!]).declarations;

function openAIResponse(output: unknown[], text = ""): never {
  return { output, output_text: text, status: "completed", model: "gpt-test", usage: { input_tokens: 10, output_tokens: 5 } } as never;
}
function anthropicMessage(content: unknown[]): never {
  return { content, stop_reason: "end_turn", model: "claude-test", usage: { input_tokens: 10, output_tokens: 5 } } as never;
}

describe("B09 §1 — OpenAI (Responses API, manual state)", () => {
  it("1. text-only completion normalizes text/usage/stop and issues NO tool calls", async () => {
    const create = vi.fn(async () => openAIResponse([{ type: "message", role: "assistant", content: [] }], "Hello from the board."));
    const adapter = new OpenAIAgentAdapter({ responses: { create } } as never, "gpt-test", undefined);
    const step = await adapter.start({ system: "sys", history: [], userMessage: "hi", tools: DECLS });
    expect(step.text).toBe("Hello from the board.");
    expect(step.toolCalls).toEqual([]);
    expect(step.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    const params = (create.mock.calls[0] as unknown as unknown[])[0] as Record<string, unknown>;
    expect(params.store).toBe(false);
    expect(params.instructions).toBe("sys");
  });

  it("2+5. function_call → EXACT function_call_output continuation, preserving the reasoning item and call_id linkage", async () => {
    const reasoningItem = { type: "reasoning", id: "rs_1", encrypted_content: "OPAQUE-REASONING", summary: [] };
    const callItem = { type: "function_call", call_id: "call_abc", name: "sirkit_schematic_inspect", arguments: "{}" };
    const create = vi.fn()
      .mockResolvedValueOnce(openAIResponse([reasoningItem, callItem]))
      .mockResolvedValueOnce(openAIResponse([], "Final answer."));
    const adapter = new OpenAIAgentAdapter({ responses: { create } } as never, "gpt-test", undefined);
    const first = await adapter.start({ system: "sys", history: [{ role: "user", text: "earlier" }], userMessage: "inspect", tools: DECLS });
    expect(first.toolCalls).toEqual([{ callId: "call_abc", providerName: "sirkit_schematic_inspect", argumentsText: "{}" }]);
    const second = await adapter.continueWith({
      continuation: first.continuation,
      results: [{ callId: "call_abc", outputText: '{"ok":true}', isError: false }],
      tools: DECLS,
    });
    expect(second.text).toBe("Final answer.");
    const params = create.mock.calls[1]![0] as unknown as { input: Array<Record<string, unknown>>; include: string[] };
    // Manual state: prior items + response output items (REASONING preserved)
    // + function_call_output tied to the exact call_id, in order.
    const kinds = params.input.map((item) => item.type ?? item.role);
    expect(kinds).toEqual(["user", "user", "reasoning", "function_call", "function_call_output"]);
    expect(params.input.at(-1)).toEqual({ type: "function_call_output", call_id: "call_abc", output: '{"ok":true}' });
    expect(params.input[2]).toEqual(reasoningItem); // verbatim, opaque
    expect(params.include).toEqual(["reasoning.encrypted_content"]);
  });

  it("3. strict tool generation: FLAT Responses shape, additionalProperties:false, full required lists, nullable optionals", () => {
    const strict = toStrictSchema({
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
      required: ["query"],
    });
    expect(strict).toEqual({
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string" }, limit: { type: ["number", "null"] } },
      required: ["query", "limit"],
    });
    const rendered = renderOpenAiResponsesTool(DECLS[0]!);
    expect(rendered.type).toBe("function");
    expect(rendered.strict).toBe(true);
    expect(rendered.name).toBe("sirkit_schematic_inspect");
    expect((rendered as unknown as Record<string, unknown>).function).toBeUndefined(); // NEVER the nested Chat shape
    expect((rendered.parameters as Record<string, unknown>).additionalProperties).toBe(false);
  });

  it("4. malformed provider arguments surface verbatim for the loop to refuse (never parsed leniently in the adapter)", async () => {
    const create = vi.fn(async () => openAIResponse([{ type: "function_call", call_id: "call_x", name: "sirkit_schematic_inspect", arguments: "{not json" }]));
    const adapter = new OpenAIAgentAdapter({ responses: { create } } as never, "gpt-test", undefined);
    const step = await adapter.start({ system: "s", history: [], userMessage: "m", tools: DECLS });
    expect(step.toolCalls[0]!.argumentsText).toBe("{not json");
  });
});

describe("B09 §2 — Anthropic (Messages API)", () => {
  it("6. text-only completion", async () => {
    const create = vi.fn(async () => anthropicMessage([{ type: "text", text: "Hello." }]));
    const adapter = new AnthropicAgentAdapter({ messages: { create } } as never, "claude-test");
    const step = await adapter.start({ system: "sys", history: [], userMessage: "hi", tools: DECLS });
    expect(step.text).toBe("Hello.");
    expect(step.toolCalls).toEqual([]);
    const params = (create.mock.calls[0] as unknown as unknown[])[0] as Record<string, unknown>;
    expect(params.system).toBe("sys");
    expect((params.tool_choice as Record<string, unknown>).disable_parallel_tool_use).toBe(true);
  });

  it("7+8. tool_use blocks preserved VERBATIM; tool_result (exact tool_use_id, is_error) immediately follows, before any other user content", async () => {
    const assistantBlocks = [
      { type: "text", text: "Checking." },
      { type: "tool_use", id: "toolu_9", name: "sirkit_schematic_inspect", input: {} },
    ];
    const create = vi.fn()
      .mockResolvedValueOnce(anthropicMessage(assistantBlocks))
      .mockResolvedValueOnce(anthropicMessage([{ type: "text", text: "Done." }]));
    const adapter = new AnthropicAgentAdapter({ messages: { create } } as never, "claude-test");
    const first = await adapter.start({ system: "sys", history: [], userMessage: "inspect", tools: DECLS });
    expect(first.toolCalls).toEqual([{ callId: "toolu_9", providerName: "sirkit_schematic_inspect", argumentsText: "{}" }]);
    await adapter.continueWith({
      continuation: first.continuation,
      results: [{ callId: "toolu_9", outputText: '{"ok":false,"status":"stale_revision"}', isError: true }],
      tools: DECLS,
    });
    const params = create.mock.calls[1]![0] as unknown as { messages: Array<{ role: string; content: unknown }> };
    expect(params.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(params.messages[1]!.content).toEqual(assistantBlocks); // verbatim tool_use preserved
    const resultBlocks = params.messages[2]!.content as Array<Record<string, unknown>>;
    expect(resultBlocks[0]).toEqual({ type: "tool_result", tool_use_id: "toolu_9", content: '{"ok":false,"status":"stale_revision"}', is_error: true });
    expect(resultBlocks.every((block) => block.type === "tool_result")).toBe(true); // results precede/replace any extra text
  });

  it("9. multiple tool calls in one turn resolve deterministically, every call answered in order", async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(anthropicMessage([
        { type: "tool_use", id: "toolu_1", name: "a", input: { n: 1 } },
        { type: "tool_use", id: "toolu_2", name: "b", input: { n: 2 } },
      ]))
      .mockResolvedValueOnce(anthropicMessage([{ type: "text", text: "ok" }]));
    const adapter = new AnthropicAgentAdapter({ messages: { create } } as never, "claude-test");
    const first = await adapter.start({ system: "s", history: [], userMessage: "m", tools: DECLS });
    expect(first.toolCalls.map((call) => call.callId)).toEqual(["toolu_1", "toolu_2"]);
    await adapter.continueWith({
      continuation: first.continuation,
      results: [
        { callId: "toolu_1", outputText: "r1", isError: false },
        { callId: "toolu_2", outputText: "r2", isError: false },
      ],
      tools: DECLS,
    });
    const params = create.mock.calls[1]![0] as unknown as { messages: Array<{ role: string; content: Array<Record<string, unknown>> }> };
    expect(params.messages[2]!.content.map((block) => block.tool_use_id)).toEqual(["toolu_1", "toolu_2"]);
  });

  it("10. both renderers declare the SAME semantic tool contract (no provider-specific semantic drift)", () => {
    for (const declaration of DECLS) {
      const openAi = renderOpenAiResponsesTool(declaration);
      const anthropic = renderAnthropicAgentTool(declaration);
      expect(openAi.name).toBe(anthropic.name);
      expect(openAi.description).toBe(anthropic.description);
      expect(openAi.parameters).toEqual(anthropic.input_schema);
      expect(openAi.strict).toBe(true);
      expect(anthropic.strict).toBe(true);
    }
  });
});
