import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../anthropic-provider";
import { OpenAIProvider } from "../openai-provider";
import type { LLMRequest } from "../types";

const tool = {
  name: "inspect_board",
  description: "Inspect the board",
  inputSchema: {
    type: "object",
    properties: { net: { type: "string" } },
    required: ["net"],
  },
};

const request: LLMRequest = {
  provider: "openai",
  system: "same system",
  messages: [
    { role: "user", content: [{ type: "text", text: "inspect" }, { type: "image", dataUrl: "data:image/png;base64,YQ==" }] },
    { role: "assistant", content: [{ type: "tool_call", id: "call-1", name: "inspect_board", input: { net: "GND" } }] },
    { role: "user", content: [{ type: "tool_result", toolCallId: "call-1", output: "clear" }] },
  ],
  tools: [tool],
  toolChoice: { name: "inspect_board" },
  boardState: { tracks: 3 },
};

describe("OpenAIProvider", () => {
  it("maps normalized tools, images, calls, and results to Responses API input", async () => {
    const create = vi.fn(async (params: unknown) => {
      void params;
      return {
        id: "resp-1",
        model: "gpt-test",
        output_text: "done",
        output: [{ type: "function_call", call_id: "call-2", name: "inspect_board", arguments: '{"net":"VCC"}' }],
        status: "completed",
        usage: { input_tokens: 10, output_tokens: 4 },
      };
    });
    const provider = new OpenAIProvider({ responses: { create } } as never, "gpt-test");

    const response = await provider.generate(request);
    const params = create.mock.calls[0][0] as Record<string, unknown>;

    expect(params.instructions).toContain("<board_state>");
    expect(params.tools).toEqual([
      expect.objectContaining({ type: "function", name: "inspect_board", parameters: tool.inputSchema }),
    ]);
    expect(params.tool_choice).toEqual({ type: "function", name: "inspect_board" });
    expect(JSON.stringify(params.input)).toContain("input_image");
    expect(JSON.stringify(params.input)).toContain("function_call_output");
    expect(response.toolCalls).toEqual([{ id: "call-2", name: "inspect_board", input: { net: "VCC" } }]);
  });

  it("uses GPT-5.6 reasoning without imposing an output cap when none is requested", async () => {
    let capturedParams: unknown;
    const create = vi.fn(async (params: unknown) => {
      capturedParams = params;
      return {
        id: "resp-2",
        model: "gpt-5.6-sol",
        output_text: "ready",
        output: [],
        status: "completed",
        usage: { input_tokens: 8, output_tokens: 2 },
      };
    });
    const provider = new OpenAIProvider(
      { responses: { create } } as never,
      "gpt-5.6-sol",
      "high",
    );

    await provider.generate({ ...request, maxTokens: undefined });
    const params = capturedParams as Record<string, unknown>;

    expect(params.model).toBe("gpt-5.6-sol");
    expect(params.reasoning).toEqual({ effort: "high" });
    expect(params.max_output_tokens).toBeUndefined();
  });
});

describe("AnthropicProvider", () => {
  it("maps the same normalized contract to Messages API blocks", async () => {
    const create = vi.fn(async (params: unknown) => {
      void params;
      return {
        id: "msg-1",
        model: "claude-test",
        role: "assistant",
        type: "message",
        content: [
          { type: "text", text: "done" },
          { type: "tool_use", id: "call-2", name: "inspect_board", input: { net: "VCC" } },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        stop_details: null,
        container: null,
        usage: { input_tokens: 10, output_tokens: 4 },
      };
    });
    const provider = new AnthropicProvider({ messages: { create } } as never, "claude-test");

    const response = await provider.generate({ ...request, provider: "anthropic" });
    const params = create.mock.calls[0][0] as Record<string, unknown>;

    expect(params.system).toContain("<board_state>");
    expect(params.tools).toEqual([
      expect.objectContaining({ name: "inspect_board", input_schema: tool.inputSchema }),
    ]);
    expect(params.tool_choice).toEqual({ type: "tool", name: "inspect_board" });
    expect(JSON.stringify(params.messages)).toContain("tool_result");
    expect(JSON.stringify(params.messages)).toContain('"type":"image"');
    expect(response.toolCalls).toEqual([{ id: "call-2", name: "inspect_board", input: { net: "VCC" } }]);
  });
});
