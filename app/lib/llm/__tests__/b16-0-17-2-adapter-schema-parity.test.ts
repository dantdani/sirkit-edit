/**
 * B16.0.17.2 §D — provider-adapter schema parity: the EXACT updated
 * SCHEMATIC_PROPOSAL_TOOL schema (with the nested semantic-ID maxLength
 * constraints) must reach BOTH provider SDK payloads without weakening. Fake
 * SDK clients (the established providers.test pattern); zero credits.
 */
import { describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "../openai-provider";
import { AnthropicProvider } from "../anthropic-provider";
import type { LLMRequest, LLMTool } from "../types";
import { SCHEMATIC_PROPOSAL_TOOL } from "../../schematic-compiler/agent-tools";

/** The tool EXACTLY as the propose route constructs it. */
const TOOL: LLMTool = {
  name: SCHEMATIC_PROPOSAL_TOOL.name,
  description: SCHEMATIC_PROPOSAL_TOOL.description,
  inputSchema: SCHEMATIC_PROPOSAL_TOOL.schema as unknown as Record<string, unknown>,
  strict: true,
};
const REQUEST: LLMRequest = {
  provider: "openai", maxTokens: 4096, temperature: 0, system: "s",
  messages: [{ role: "user", content: "propose" }],
  tools: [TOOL], toolChoice: { name: SCHEMATIC_PROPOSAL_TOOL.name }, userRequest: "propose",
};
const REF_MAX = SCHEMATIC_PROPOSAL_TOOL.schema.properties.referencedSemanticObjectIds.items.maxLength;
const TARGET_MAX = SCHEMATIC_PROPOSAL_TOOL.schema.properties.proposedActions.items.properties.targetObjectIds.items.maxLength;

interface SchemaShape {
  properties: {
    referencedSemanticObjectIds: { items: { minLength?: number; maxLength?: number } };
    proposedActions: { items: { properties: { targetObjectIds: { items: { minLength?: number; maxLength?: number } } } } };
  };
}
function assertNestedLimits(schema: SchemaShape, label: string): void {
  expect(schema.properties.referencedSemanticObjectIds.items.maxLength, `${label}: referenced maxLength`).toBe(REF_MAX);
  expect(schema.properties.referencedSemanticObjectIds.items.minLength, `${label}: referenced minLength`).toBe(1);
  expect(schema.properties.proposedActions.items.properties.targetObjectIds.items.maxLength, `${label}: target maxLength`).toBe(TARGET_MAX);
  expect(schema.properties.proposedActions.items.properties.targetObjectIds.items.minLength, `${label}: target minLength`).toBe(1);
}

describe("B16.0.17.2 §D — OpenAI adapter", () => {
  it("sends the exact schema (nested maxLength intact), strict: true, and the forced tool choice", async () => {
    const create = vi.fn(async (_params: unknown) => ({ id: "r1", output: [], status: "completed", usage: { input_tokens: 1, output_tokens: 1 } }));
    const provider = new OpenAIProvider({ responses: { create } } as never, "gpt-test");
    await provider.generate(REQUEST);
    const params = create.mock.calls[0]![0] as unknown as { tools: Array<{ type: string; name: string; parameters: SchemaShape; strict: boolean }>; tool_choice: unknown };
    expect(params.tools).toHaveLength(1);
    expect(params.tools[0]!.name).toBe("propose_schematic_semantic_changes");
    expect(params.tools[0]!.strict).toBe(true);
    // the schema object is passed through UNWEAKENED — reference-identical
    expect(params.tools[0]!.parameters).toBe(SCHEMATIC_PROPOSAL_TOOL.schema);
    assertNestedLimits(params.tools[0]!.parameters, "openai");
    expect(params.tool_choice).toEqual({ type: "function", name: "propose_schematic_semantic_changes" });
  });
});

describe("B16.0.17.2 §D — Anthropic adapter", () => {
  it("sends the exact schema (nested maxLength intact) through input_schema and the forced tool choice", async () => {
    const create = vi.fn(async (_params: unknown) => ({ id: "m1", content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
    const provider = new AnthropicProvider({ messages: { create } } as never, "claude-test");
    await provider.generate({ ...REQUEST, provider: "anthropic" });
    const params = create.mock.calls[0]![0] as unknown as { tools: Array<{ name: string; input_schema: SchemaShape; strict?: boolean }>; tool_choice: unknown };
    expect(params.tools).toHaveLength(1);
    expect(params.tools[0]!.name).toBe("propose_schematic_semantic_changes");
    expect(params.tools[0]!.strict).toBe(true);
    expect(params.tools[0]!.input_schema).toBe(SCHEMATIC_PROPOSAL_TOOL.schema);
    assertNestedLimits(params.tools[0]!.input_schema, "anthropic");
    expect(params.tool_choice).toEqual({ type: "tool", name: "propose_schematic_semantic_changes" });
  });
});

describe("B16.0.17.2 §D — the schema itself declares the tightened limits", () => {
  it("both semantic-ID nodes carry maxLength 4096 in the ONE declared schema", () => {
    expect(REF_MAX).toBe(4096);
    expect(TARGET_MAX).toBe(4096);
  });
});
