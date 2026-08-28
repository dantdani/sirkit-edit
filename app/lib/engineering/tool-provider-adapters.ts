/**
 * B04 provider schema adapters — **DEPRECATED COMPATIBILITY WRAPPER**
 * (superseded by B09/B09.1).
 *
 * The ONE provider-rendering truth is `app/lib/agent/provider-tools.ts`:
 * the FLAT OpenAI Responses-API function-tool shape and the Anthropic tool
 * shape, both `strict: true`, over the validated common wire subset. This
 * module no longer contains its own conversion or name-mapping logic — it
 * delegates, so the obsolete nested Chat-Completions shape and the
 * "no Anthropic strict support" claim cannot be presented as current
 * anywhere.
 *
 * Rendering a descriptor whose schema is outside the proven wire subset
 * FAILS CLOSED (`STRICT_SCHEMA_UNSUPPORTED`); the parity report records
 * such descriptors as wire-incompatible instead of rendering them.
 */

import { canonicalJson } from "./stable";
import type { JsonSchema, ToolDescriptor } from "./tool-registry";
import {
  agentProviderName,
  renderAnthropicAgentTool,
  renderOpenAiResponsesTool,
  strictCompatibility,
  type AnthropicAgentTool,
  type OpenAiResponsesFunctionTool,
} from "../agent/provider-tools";

/** @deprecated superseded by `OpenAiResponsesFunctionTool` (B09.1): the
 *  current OpenAI shape is the FLAT Responses function tool. */
export type OpenAiToolSchema = OpenAiResponsesFunctionTool;

/** @deprecated superseded by `AnthropicAgentTool` (B09.1). */
export type AnthropicToolSchema = AnthropicAgentTool;

/** Provider-safe tool name — delegates to the B09 mapping (identical for
 *  both providers, collision-checked at declaration time by the agent). */
export function providerToolName(toolId: string): string {
  return agentProviderName(toolId);
}

function declarationFor(descriptor: ToolDescriptor) {
  const strict = strictCompatibility(descriptor);
  if (!strict.ok) throw new Error(`STRICT_SCHEMA_UNSUPPORTED:${descriptor.toolId}: ${strict.reason}`);
  return {
    providerName: providerToolName(descriptor.toolId),
    toolId: descriptor.toolId,
    version: descriptor.version,
    description: descriptor.description,
    inputSchema: strict.schema,
  };
}

/** @deprecated delegates to the B09 renderer (flat Responses shape). */
export function renderOpenAiTool(descriptor: ToolDescriptor): OpenAiToolSchema {
  return renderOpenAiResponsesTool(declarationFor(descriptor));
}

/** @deprecated delegates to the B09 renderer (strict Anthropic shape). */
export function renderAnthropicTool(descriptor: ToolDescriptor): AnthropicToolSchema {
  return renderAnthropicAgentTool(declarationFor(descriptor));
}

/** The provider-independent semantic core of a rendered tool declaration. */
export interface ProviderSemanticCore {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export function openAiSemanticCore(schema: OpenAiToolSchema): ProviderSemanticCore {
  return { name: schema.name, description: schema.description, inputSchema: schema.parameters };
}

export function anthropicSemanticCore(schema: AnthropicToolSchema): ProviderSemanticCore {
  return { name: schema.name, description: schema.description, inputSchema: schema.input_schema };
}

export interface ProviderParityEntry {
  toolId: string;
  version: string;
  providerName: string;
  /** False ⇒ the schema is outside the proven wire subset and is NEVER
   *  rendered to any provider (fail closed). */
  wireCompatible: boolean;
  semanticallyEquivalent: boolean;
  differences: string[];
}

export interface ProviderParityReport {
  schema: "sirkit.provider-schema-parity.v2";
  notes: string[];
  tools: ProviderParityEntry[];
}

/** Deterministic parity report across both renderers (artifact source). */
export function renderProviderParityReport(descriptors: readonly ToolDescriptor[]): ProviderParityReport {
  const tools = [...descriptors]
    .sort((a, b) => a.toolId.localeCompare(b.toolId) || a.version.localeCompare(b.version))
    .map((descriptor): ProviderParityEntry => {
      const strict = strictCompatibility(descriptor);
      if (!strict.ok) {
        return {
          toolId: descriptor.toolId,
          version: descriptor.version,
          providerName: providerToolName(descriptor.toolId),
          wireCompatible: false,
          semanticallyEquivalent: false,
          differences: [`not rendered: ${strict.reason.slice(0, 200)}`],
        };
      }
      const openAi = openAiSemanticCore(renderOpenAiTool(descriptor));
      const anthropic = anthropicSemanticCore(renderAnthropicTool(descriptor));
      const equivalent = canonicalJson(openAi) === canonicalJson(anthropic);
      const differences: string[] = [];
      if (openAi.name !== descriptor.toolId) differences.push("provider name maps '.' to '_' (both providers identically)");
      differences.push("output schema is registry-only metadata (neither provider declares it)");
      return {
        toolId: descriptor.toolId,
        version: descriptor.version,
        providerName: openAi.name,
        wireCompatible: true,
        semanticallyEquivalent: equivalent,
        differences,
      };
    });
  return {
    schema: "sirkit.provider-schema-parity.v2",
    notes: [
      "[B09.1 SUPERSESSION] v2 replaces the B04 v1 report: OpenAI renders the FLAT Responses-API function-tool shape (never the nested Chat Completions shape) and BOTH providers receive strict:true declarations over the validated common wire subset (app/lib/agent/provider-tools.ts is the single rendering truth).",
      "Descriptors whose schemas fall outside the wire subset are recorded wireCompatible:false and are never rendered to any provider.",
      "Semantic equivalence compares {name, description, inputSchema} across both renderers via canonical JSON.",
    ],
    tools,
  };
}
