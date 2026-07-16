import { describe, expect, it, vi } from "vitest";
import { composeInstructions } from "../context";
import { LLMRouter } from "../router";
import type { LLMChunk, LLMProvider, LLMRequest, LLMResponse } from "../types";

function fakeProvider(id: "openai" | "anthropic"): LLMProvider {
  return {
    id,
    generate: vi.fn(async (): Promise<LLMResponse> => ({
      provider: id,
      model: `${id}-test`,
      text: id,
      toolCalls: [],
    })),
    async *stream(): AsyncIterable<LLMChunk> {
      yield { type: "text_delta", text: id };
      yield {
        type: "done",
        response: { provider: id, model: `${id}-test`, text: id, toolCalls: [] },
      };
    },
    supportsTools: () => true,
    supportsVision: () => true,
  };
}

const request = (provider: "openai" | "anthropic"): LLMRequest => ({
  provider,
  system: "system",
  messages: [{ role: "user", content: "hello" }],
});

describe("LLMRouter", () => {
  it("calls only the explicitly selected provider and never falls back", async () => {
    const openai = fakeProvider("openai");
    const anthropic = fakeProvider("anthropic");
    const router = new LLMRouter([openai, anthropic]);

    const response = await router.generate(request("anthropic"));

    expect(response.provider).toBe("anthropic");
    expect(anthropic.generate).toHaveBeenCalledOnce();
    expect(openai.generate).not.toHaveBeenCalled();
  });

  it("does not invoke another provider when the selected one fails", async () => {
    const openai = fakeProvider("openai");
    const anthropic = fakeProvider("anthropic");
    vi.mocked(anthropic.generate).mockRejectedValueOnce(new Error("offline"));
    const router = new LLMRouter([openai, anthropic]);

    await expect(router.generate(request("anthropic"))).rejects.toThrow("offline");
    expect(openai.generate).not.toHaveBeenCalled();
  });
});

describe("composeInstructions", () => {
  it("builds one deterministic context envelope shared by both providers", () => {
    const instructions = composeInstructions({
      ...request("openai"),
      boardState: { tracks: 2 },
      schematicState: { components: ["R1"] },
      retrievedContext: ["catalog match"],
      designConstraints: { maxCurrentA: 2 },
      userRequest: "widen power traces",
    });

    expect(instructions).toContain("system");
    expect(instructions).toContain("<retrieved_context>");
    expect(instructions).toContain("<schematic_state>");
    expect(instructions).toContain("<board_state>");
    expect(instructions).toContain("<design_constraints>");
    expect(instructions).toContain("<user_request>");
  });
});
