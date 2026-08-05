/**
 * B04 — pure provider schema adapters.
 *
 * These functions transform B04 tool descriptors into provider-compatible
 * SHAPES. They are plain-object renderers with NO provider SDK imports, no
 * network calls, no execution, no conversation state, no routing, and no
 * fallback logic. Nothing here is wired to /api/chat.
 *
 * Documented representational differences (also rendered into
 * provider-schema-parity.json):
 *  - Tool NAME: both providers restrict names to [a-zA-Z0-9_-]{1,64}; dots in
 *    Sirkit tool ids map to underscores identically for both, so the mapping
 *    is lossless across providers (but not identical to the registry id).
 *  - OUTPUT schema: neither provider tool declaration carries an output
 *    schema; it remains registry-only metadata for both.
 *  - STRICT mode: OpenAI supports `strict: true` function schemas; Anthropic
 *    has no equivalent field. The adapters omit strictness entirely so the
 *    declared contract stays semantically identical on both providers.
 *  - Everything else (description, input JSON Schema) renders byte-equal.
 */

import { canonicalJson } from "./stable";
import type { JsonSchema, ToolDescriptor } from "./tool-registry";

export interface OpenAiToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
}

export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

/** Provider-safe tool name: [a-zA-Z0-9_-]{1,64}, identical for both providers. */
export function providerToolName(toolId: string): string {
  const name = toolId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  if (name.length === 0 || name.length > 64) throw new Error(`TOOL_NAME_UNREPRESENTABLE:${toolId}`);
  return name;
}

export function renderOpenAiTool(descriptor: ToolDescriptor): OpenAiToolSchema {
  return {
    type: "function",
    function: {
      name: providerToolName(descriptor.toolId),
      description: descriptor.description,
      parameters: structuredClone(descriptor.inputSchema) as JsonSchema,
    },
  };
}

export function renderAnthropicTool(descriptor: ToolDescriptor): AnthropicToolSchema {
  return {
    name: providerToolName(descriptor.toolId),
    description: descriptor.description,
    input_schema: structuredClone(descriptor.inputSchema) as JsonSchema,
  };
}

/** The provider-independent semantic core of a rendered tool declaration. */
export interface ProviderSemanticCore {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export function openAiSemanticCore(schema: OpenAiToolSchema): ProviderSemanticCore {
  return { name: schema.function.name, description: schema.function.description, inputSchema: schema.function.parameters };
}

export function anthropicSemanticCore(schema: AnthropicToolSchema): ProviderSemanticCore {
  return { name: schema.name, description: schema.description, inputSchema: schema.input_schema };
}

export interface ProviderParityEntry {
  toolId: string;
  version: string;
  providerName: string;
  semanticallyEquivalent: boolean;
  differences: string[];
}

export interface ProviderParityReport {
  schema: "sirkit.provider-schema-parity.v1";
  notes: string[];
  tools: ProviderParityEntry[];
}

/** Deterministic parity report across both renderers (artifact source). */
export function renderProviderParityReport(descriptors: readonly ToolDescriptor[]): ProviderParityReport {
  const tools = [...descriptors]
    .sort((a, b) => a.toolId.localeCompare(b.toolId) || a.version.localeCompare(b.version))
    .map((descriptor): ProviderParityEntry => {
      const openAi = openAiSemanticCore(renderOpenAiTool(descriptor));
      const anthropic = anthropicSemanticCore(renderAnthropicTool(descriptor));
      const equivalent = canonicalJson(openAi) === canonicalJson(anthropic);
      const differences: string[] = [];
      if (openAi.name !== descriptor.toolId) differences.push("provider name maps '.' to '_' (both providers identically)");
      differences.push("output schema is registry-only metadata (neither provider declares it)");
      differences.push("OpenAI strict mode is omitted (no Anthropic equivalent)");
      return {
        toolId: descriptor.toolId,
        version: descriptor.version,
        providerName: openAi.name,
        semanticallyEquivalent: equivalent,
        differences,
      };
    });
  return {
    schema: "sirkit.provider-schema-parity.v1",
    notes: [
      "Adapters are pure schema transforms: no provider calls, no execution, no conversation state, no routing, no chat wiring.",
      "Semantic equivalence compares {name, description, inputSchema} across both renderers via canonical JSON.",
    ],
    tools,
  };
}
