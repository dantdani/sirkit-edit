/**
 * B16.0.18 §E — provider-adapter schema parity for
 * COMPONENT_SEARCH_PROPOSAL_TOOL: the exact strict schema (including nested
 * min/max lengths and item caps) must reach BOTH provider SDK payloads
 * without weakening. Fake SDK clients; zero credits.
 */
import { describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "../openai-provider";
import { AnthropicProvider } from "../anthropic-provider";
import type { LLMRequest, LLMTool } from "../types";
import { COMPONENT_SEARCH_PROPOSAL_TOOL } from "../../component-selection/agent-tools";

const TOOL: LLMTool = {
  name: COMPONENT_SEARCH_PROPOSAL_TOOL.name,
  description: COMPONENT_SEARCH_PROPOSAL_TOOL.description,
  inputSchema: COMPONENT_SEARCH_PROPOSAL_TOOL.schema as unknown as Record<string, unknown>,
  strict: true,
};
const REQUEST: LLMRequest = {
  provider: "openai", maxTokens: 4096, temperature: 0, system: "s",
  messages: [{ role: "user", content: "propose" }],
  tools: [TOOL], toolChoice: { name: COMPONENT_SEARCH_PROPOSAL_TOOL.name }, userRequest: "propose",
};
const P = COMPONENT_SEARCH_PROPOSAL_TOOL.schema.properties;

describe("B16.0.18 §E — adapter parity for the component-search tool", () => {
  it("OpenAI: reference-identical schema, strict true, forced function choice", async () => {
    const create = vi.fn(async (...args: unknown[]) => { void args; return { id: "r1", output: [], status: "completed", usage: { input_tokens: 1, output_tokens: 1 } }; });
    const provider = new OpenAIProvider({ responses: { create } } as never, "gpt-test");
    await provider.generate(REQUEST);
    const params = create.mock.calls[0]![0] as unknown as { tools: Array<{ name: string; parameters: unknown; strict: boolean }>; tool_choice: unknown };
    expect(params.tools[0]!.name).toBe("propose_component_catalog_search");
    expect(params.tools[0]!.strict).toBe(true);
    expect(params.tools[0]!.parameters).toBe(COMPONENT_SEARCH_PROPOSAL_TOOL.schema);
    expect(params.tool_choice).toEqual({ type: "function", name: "propose_component_catalog_search" });
  });
  it("Anthropic: reference-identical schema via input_schema, forced tool choice", async () => {
    const create = vi.fn(async (...args: unknown[]) => { void args; return { id: "m1", content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }; });
    const provider = new AnthropicProvider({ messages: { create } } as never, "claude-test");
    await provider.generate({ ...REQUEST, provider: "anthropic" });
    const params = create.mock.calls[0]![0] as unknown as { tools: Array<{ name: string; input_schema: unknown; strict?: boolean }>; tool_choice: unknown };
    expect(params.tools[0]!.name).toBe("propose_component_catalog_search");
    expect(params.tools[0]!.strict).toBe(true);
    expect(params.tools[0]!.input_schema).toBe(COMPONENT_SEARCH_PROPOSAL_TOOL.schema);
    expect(params.tool_choice).toEqual({ type: "tool", name: "propose_component_catalog_search" });
  });
  it("the declared schema itself carries the nested limits the validator derives from", () => {
    expect(P.roleRequirementId.maxLength).toBe(300);
    for (const field of ["categories", "exactAtomicRevisionIds", "manufacturerIds", "rationale", "missingEvidenceRequests"] as const) {
      expect(typeof P[field].maxItems, field).toBe("number");
      expect(typeof P[field].items.maxLength, field).toBe("number");
      expect(P[field].items.minLength, field).toBe(1);
    }
  });
});
