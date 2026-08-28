/**
 * B16.0.19 §D/§F — provider-adapter schema parity for BOTH circuit tools:
 * the exact strict schemas (including the newly added item bounds) must reach
 * both SDK payloads without weakening. Fake SDK clients; zero credits.
 */
import { describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "../openai-provider";
import { AnthropicProvider } from "../anthropic-provider";
import type { LLMRequest, LLMTool } from "../types";
import { CIRCUIT_RECIPE_CLAIM_TOOL } from "../../circuit-knowledge/agent-tools";
import { CIRCUIT_VERIFICATION_PROPOSAL_TOOL } from "../../circuit-verification/agent-tools";

const TOOLS: Array<{ label: string; tool: { name: string; description: string; schema: object } }> = [
  { label: "circuit-knowledge claim", tool: CIRCUIT_RECIPE_CLAIM_TOOL },
  { label: "circuit-verification remediation", tool: CIRCUIT_VERIFICATION_PROPOSAL_TOOL },
];

function request(tool: { name: string; description: string; schema: object }): LLMRequest {
  const llmTool: LLMTool = { name: tool.name, description: tool.description, inputSchema: tool.schema as Record<string, unknown>, strict: true };
  return { provider: "openai", maxTokens: 4096, temperature: 0, system: "s", messages: [{ role: "user", content: "propose" }], tools: [llmTool], toolChoice: { name: tool.name }, userRequest: "propose" };
}

describe("B16.0.19 — adapter schema parity for both circuit tools", () => {
  it.each(TOOLS)("OpenAI: $label — reference-identical schema, strict, forced choice", async ({ tool }) => {
    const create = vi.fn(async (...args: unknown[]) => { void args; return { id: "r1", output: [], status: "completed", usage: { input_tokens: 1, output_tokens: 1 } }; });
    const provider = new OpenAIProvider({ responses: { create } } as never, "gpt-test");
    await provider.generate(request(tool));
    const params = create.mock.calls[0]![0] as unknown as { tools: Array<{ name: string; parameters: unknown; strict: boolean }>; tool_choice: unknown };
    expect(params.tools[0]!.name).toBe(tool.name);
    expect(params.tools[0]!.strict).toBe(true);
    expect(params.tools[0]!.parameters).toBe(tool.schema);
    expect(params.tool_choice).toEqual({ type: "function", name: tool.name });
  });
  it.each(TOOLS)("Anthropic: $label — reference-identical schema via input_schema, forced choice", async ({ tool }) => {
    const create = vi.fn(async (...args: unknown[]) => { void args; return { id: "m1", content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }; });
    const provider = new AnthropicProvider({ messages: { create } } as never, "claude-test");
    await provider.generate({ ...request(tool), provider: "anthropic" });
    const params = create.mock.calls[0]![0] as unknown as { tools: Array<{ name: string; input_schema: unknown; strict?: boolean }>; tool_choice: unknown };
    expect(params.tools[0]!.name).toBe(tool.name);
    expect(params.tools[0]!.strict).toBe(true);
    expect(params.tools[0]!.input_schema).toBe(tool.schema);
    expect(params.tool_choice).toEqual({ type: "tool", name: tool.name });
  });
  it("both schemas declare the newly added security bounds", () => {
    const ck = CIRCUIT_RECIPE_CLAIM_TOOL.schema.properties;
    expect(ck.sourceEvidenceRefs.items.maxLength).toBe(300);
    expect(ck.sourceLocationRefs.items.maxLength).toBe(300);
    expect(ck.reviewerQueueIds.items.maxLength).toBe(300);
    const cv = CIRCUIT_VERIFICATION_PROPOSAL_TOOL.schema.properties;
    expect(cv.findingStableIdentities.items.maxLength).toBe(4096);
    expect(cv.proposedActions.items.properties.actionId.maxLength).toBe(4096);
    expect(cv.proposedActions.items.properties.targetIds.items.maxLength).toBe(4096);
  });
});
