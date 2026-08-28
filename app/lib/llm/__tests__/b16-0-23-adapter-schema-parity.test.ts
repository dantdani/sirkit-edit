/**
 * B16.0.23 §G — provider-adapter schema parity for the SPICE studio's 20
 * typed tools: EVERY tool's exact inputSchema object (the same node the
 * schema-derived validator walks) must reach BOTH provider SDK payloads by
 * REFERENCE IDENTITY — no clone, no weakening, no re-render. Fake SDK
 * clients; zero credits. `toolChoice: "required"` (the route's setting) must
 * survive both adapters as the correct SDK form.
 */
import { describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "../openai-provider";
import { AnthropicProvider } from "../anthropic-provider";
import type { LLMRequest } from "../types";
import { SPICE_TOOL_SCHEMAS, validateSpiceToolInput } from "../../../api/spice/ai/_tools";

const REQUEST: LLMRequest = {
  provider: "openai", maxTokens: 4096, temperature: 0, system: "s",
  messages: [{ role: "user", content: "set up a test" }],
  tools: SPICE_TOOL_SCHEMAS, toolChoice: "required", userRequest: "set up a test",
};

describe("B16.0.23 §G — adapter parity for all 20 SPICE studio tools", () => {
  it("OpenAI: every tool's schema is reference-identical in the SDK payload; toolChoice 'required' is honored", async () => {
    const create = vi.fn(async (...args: unknown[]) => { void args; return { id: "r1", output: [], status: "completed", usage: { input_tokens: 1, output_tokens: 1 } }; });
    const provider = new OpenAIProvider({ responses: { create } } as never, "gpt-test");
    await provider.generate(REQUEST);
    const params = create.mock.calls[0]![0] as unknown as { tools: Array<{ name: string; parameters: unknown }>; tool_choice: unknown };
    expect(params.tools.length).toBe(SPICE_TOOL_SCHEMAS.length);
    for (let index = 0; index < SPICE_TOOL_SCHEMAS.length; index++) {
      expect(params.tools[index]!.name, SPICE_TOOL_SCHEMAS[index]!.name).toBe(SPICE_TOOL_SCHEMAS[index]!.name);
      expect(params.tools[index]!.parameters, SPICE_TOOL_SCHEMAS[index]!.name).toBe(SPICE_TOOL_SCHEMAS[index]!.inputSchema);
    }
    expect(params.tool_choice).toBe("required");
  });
  it("Anthropic: every tool's schema is reference-identical via input_schema; toolChoice 'required' maps to {type:'any'}", async () => {
    const create = vi.fn(async (...args: unknown[]) => { void args; return { id: "m1", content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }; });
    const provider = new AnthropicProvider({ messages: { create } } as never, "claude-test");
    await provider.generate({ ...REQUEST, provider: "anthropic" });
    const params = create.mock.calls[0]![0] as unknown as { tools: Array<{ name: string; input_schema: unknown }>; tool_choice: unknown };
    expect(params.tools.length).toBe(SPICE_TOOL_SCHEMAS.length);
    for (let index = 0; index < SPICE_TOOL_SCHEMAS.length; index++) {
      expect(params.tools[index]!.input_schema, SPICE_TOOL_SCHEMAS[index]!.name).toBe(SPICE_TOOL_SCHEMAS[index]!.inputSchema);
    }
    expect(params.tool_choice).toEqual({ type: "any" });
  });
  it("the validator derives from the SAME schema nodes the adapters ship (no drift possible)", () => {
    // required keys enforced from the node the provider saw
    expect(validateSpiceToolInput("search_models", {})).toEqual({ ok: false, error: "search_models.query is required" });
    // enum enforced
    const badEnum = validateSpiceToolInput("configure_analysis", { test_id: "t", name: "n", type: "magic", rationale: "r" });
    expect(badEnum.ok).toBe(false);
    // numeric bounds enforced (confidence 0..1)
    const badRange = validateSpiceToolInput("submit_proposal", { summary: "s", rationale: "r", confidence: 2, assumptions: [] });
    expect(badRange.ok).toBe(false);
    // nested array item shape enforced (corner entries need name + values)
    const badCorner = validateSpiceToolInput("configure_corner_set", { test_id: "t", name: "n", corners: [{ values: {} }] });
    expect(badCorner.ok).toBe(false);
    // a valid call passes
    expect(validateSpiceToolInput("search_models", { query: "diode", trusted_only: true })).toEqual({ ok: true });
    // the tool list is frozen — a live mutation would throw in strict mode and
    // can never silently widen what providers are shown
    expect(Object.isFrozen(SPICE_TOOL_SCHEMAS)).toBe(true);
    expect(SPICE_TOOL_SCHEMAS.length).toBe(20);
  });
});
