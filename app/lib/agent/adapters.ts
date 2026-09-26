/**
 * B09 — provider agent adapters (the ONLY modules that touch provider SDK
 * types for the agent loop).
 *
 * Each adapter owns exactly: request/response translation, continuation
 * mechanics, tool-call ID preservation, text/tool-call normalization, and
 * usage/stop-reason normalization. Continuation state is OPAQUE and
 * TRANSIENT: OpenAI's `response.output` items (including reasoning items —
 * requested via `include: ["reasoning.encrypted_content"]` because state is
 * managed manually with `store:false`) and Anthropic's raw assistant
 * content blocks live only inside `ProviderContinuation.state` and never
 * reach Sirkit traces, proposals, persisted chat, or user output.
 *
 * OpenAI uses the Responses API FLAT function-tool shape; every
 * `function_call` keeps its `call_id`, and results return as
 * `function_call_output` items tied to that exact id. Anthropic preserves
 * the assistant's `tool_use` blocks verbatim and immediately follows them
 * with a user message whose `tool_result` blocks (exact `tool_use_id`,
 * `is_error` on failures) precede any other content.
 *
 * [B20 A5] Each adapter reads its response's output list ONCE and judges it
 * before anything of the response is used (OD-91): a well-formed item the
 * adapters did not request — a tool the provider ran on its own, or an
 * unknown type — stops the run with `provider_unrequested_output`, and a
 * malformed one with `provider_unknown`.
 *
 * A malformed LIST fails as it did before A5 (a non-array `output` /
 * `content` already raised a TypeError inside the try below). A malformed
 * ITEM does NOT: before A5 the filters here skipped anything that was not a
 * `function_call` / `text` / `tool_use` and round-tripped it verbatim into
 * the continuation, so an entry with a non-string, inherited-only,
 * over-long or non-token `type` — and a list past the item cap — completed
 * the step. Since A5 each of those stops the run too. That is a deliberate
 * fail-closed change, not parity.
 */

import OpenAI from "openai";
import type {
  Response as OpenAIResponse,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  Tool as OpenAIResponsesTool,
} from "openai/resources/responses/responses";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ContentBlockParam,
  Message as AnthropicMessage,
  MessageCreateParamsNonStreaming,
  MessageParam,
  Tool as AnthropicTool,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { LLMProviderError, toProviderError } from "../llm/errors";
import { configuredOpenAIModel, configuredOpenAIReasoningEffort, type OpenAIReasoningEffort } from "../llm/openai-config";
import type { AgentStep, AgentToolResult, ProviderAgentAdapter, ProviderToolDeclaration } from "./contracts";
import { renderAnthropicAgentTool, renderOpenAiResponsesTool } from "./provider-tools";
import { judgeProviderOutput } from "./provider-output-guard"; // [B20 A5] OD-91
import { fixtureRuntimeEnabled } from "../fixture-runtime/mode"; // [B18-C I10]
import { FIXTURE_AGENT_ENV, FIXTURE_AGENT_SCRIPTED, FixtureAgentAdapter } from "./fixture-agent-adapter"; // [B18-C I10]

export const MAX_OUTPUT_TOKENS = 4096; // [B21 B] exported as data only: the scheduler's per-step token figure is pinned equal to it

// ─── OpenAI (Responses API, manual conversation state) ───────────────────────

type OpenAIClient = Pick<OpenAI, "responses">;

interface OpenAIContinuationState {
  /** The full manually-managed input list: prior items + every prior
   *  response's output items (reasoning items included) in order. */
  input: ResponseInputItem[];
  instructions: string;
}

function normalizeOpenAIStep(response: OpenAIResponse, state: OpenAIContinuationState): AgentStep {
  // [B20 A5] the list is read ONCE and judged before any other field of the
  // response is touched; from here on only this local is used (OD-91).
  const output: unknown = (response as { output?: unknown }).output;
  const judgement = judgeProviderOutput("openai", output);
  if (!judgement.ok) throw new LLMProviderError("openai", judgement.kind === "unrequested" ? "unrequested_output" : "unknown");
  const items = output as OpenAIResponse["output"];
  const toolCalls = items
    .filter((item) => item.type === "function_call")
    .map((item) => ({ callId: item.call_id, providerName: item.name, argumentsText: item.arguments }));
  return {
    text: response.output_text ?? "",
    toolCalls,
    stopReason: response.status ?? null,
    usage: { inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens },
    model: response.model,
    continuation: {
      provider: "openai",
      // Every continuation item required by reasoning models is preserved:
      // the response's output items are appended verbatim to the input list.
      state: { input: [...state.input, ...(items as unknown as ResponseInputItem[])], instructions: state.instructions } satisfies OpenAIContinuationState,
    },
  };
}

export class OpenAIAgentAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  private client?: OpenAIClient;

  constructor(
    client?: OpenAIClient,
    private readonly model = configuredOpenAIModel(),
    private readonly reasoningEffort: OpenAIReasoningEffort | undefined = configuredOpenAIReasoningEffort(model),
  ) {
    this.client = client;
  }

  private getClient(): OpenAIClient {
    this.client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 2, timeout: 120_000 });
    return this.client;
  }

  private params(state: OpenAIContinuationState, tools: readonly ProviderToolDeclaration[]): ResponseCreateParamsNonStreaming {
    return {
      model: this.model,
      instructions: state.instructions,
      input: state.input,
      tools: tools.length > 0 ? (tools.map(renderOpenAiResponsesTool) as unknown as OpenAIResponsesTool[]) : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
      // Sequential, deterministic tool handling — one batch at a time.
      parallel_tool_calls: tools.length > 0 ? false : undefined,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      reasoning: this.reasoningEffort ? { effort: this.reasoningEffort } : undefined,
      // Manual state management: reasoning items must round-trip.
      include: ["reasoning.encrypted_content"],
      store: false,
      stream: false,
    };
  }

  async start(input: Parameters<ProviderAgentAdapter["start"]>[0]): Promise<AgentStep> {
    const items: ResponseInputItem[] = [
      ...input.history.map((turn): ResponseInputItem => ({ role: turn.role, content: turn.text })),
      { role: "user", content: input.userMessage },
    ];
    const state: OpenAIContinuationState = { input: items, instructions: input.system };
    try {
      const response = await this.getClient().responses.create(this.params(state, input.tools), { signal: input.signal });
      return normalizeOpenAIStep(response, state);
    } catch (error) {
      throw toProviderError(this.provider, error);
    }
  }

  async continueWith(input: Parameters<ProviderAgentAdapter["continueWith"]>[0]): Promise<AgentStep> {
    const prior = input.continuation.state as OpenAIContinuationState;
    const outputs: ResponseInputItem[] = input.results.map((result) => ({
      type: "function_call_output",
      call_id: result.callId,
      output: result.outputText,
    }));
    const state: OpenAIContinuationState = { input: [...prior.input, ...outputs], instructions: prior.instructions };
    try {
      const response = await this.getClient().responses.create(this.params(state, input.tools), { signal: input.signal });
      return normalizeOpenAIStep(response, state);
    } catch (error) {
      throw toProviderError(this.provider, error);
    }
  }
}

// ─── Anthropic (Messages API) ────────────────────────────────────────────────

type AnthropicClient = Pick<Anthropic, "messages">;

interface AnthropicContinuationState {
  system: string;
  /** Full message list; assistant turns carry RAW content blocks verbatim. */
  messages: MessageParam[];
}

function normalizeAnthropicStep(message: AnthropicMessage, state: AnthropicContinuationState): AgentStep {
  // [B20 A5] the blocks are read ONCE and judged before any other field of the
  // message is touched; from here on only this local is used (OD-91).
  const content: unknown = (message as { content?: unknown }).content;
  const judgement = judgeProviderOutput("anthropic", content);
  if (!judgement.ok) throw new LLMProviderError("anthropic", judgement.kind === "unrequested" ? "unrequested_output" : "unknown");
  const blocks = content as AnthropicMessage["content"];
  const text = blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
  const toolCalls = blocks
    .filter((block) => block.type === "tool_use")
    .map((block) => ({ callId: block.id, providerName: block.name, argumentsText: JSON.stringify(block.input ?? {}) }));
  return {
    text,
    toolCalls,
    stopReason: message.stop_reason,
    usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    model: message.model,
    continuation: {
      provider: "anthropic",
      state: {
        system: state.system,
        // The assistant's content blocks (tool_use included) are preserved
        // VERBATIM so the follow-up tool_result blocks pair correctly.
        messages: [...state.messages, { role: "assistant", content: blocks as ContentBlock[] as unknown as ContentBlockParam[] }],
      } satisfies AnthropicContinuationState,
    },
  };
}

export class AnthropicAgentAdapter implements ProviderAgentAdapter {
  readonly provider = "anthropic" as const;
  private client?: AnthropicClient;

  constructor(client?: AnthropicClient, private readonly model = process.env.SIRKIT_ANTHROPIC_MODEL ?? "claude-opus-4-7") {
    this.client = client;
  }

  private getClient(): AnthropicClient {
    this.client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return this.client;
  }

  private params(state: AnthropicContinuationState, tools: readonly ProviderToolDeclaration[]): MessageCreateParamsNonStreaming {
    return {
      model: this.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: state.system,
      messages: state.messages,
      tools: tools.length > 0 ? (tools.map(renderAnthropicAgentTool) as unknown as AnthropicTool[]) : undefined,
      tool_choice: tools.length > 0 ? { type: "auto", disable_parallel_tool_use: true } : undefined,
    };
  }

  async start(input: Parameters<ProviderAgentAdapter["start"]>[0]): Promise<AgentStep> {
    const state: AnthropicContinuationState = {
      system: input.system,
      messages: [
        ...input.history.map((turn): MessageParam => ({ role: turn.role, content: turn.text })),
        { role: "user", content: input.userMessage },
      ],
    };
    try {
      const message = await this.getClient().messages.create(this.params(state, input.tools), { signal: input.signal });
      return normalizeAnthropicStep(message, state);
    } catch (error) {
      throw toProviderError(this.provider, error);
    }
  }

  async continueWith(input: Parameters<ProviderAgentAdapter["continueWith"]>[0]): Promise<AgentStep> {
    const prior = input.continuation.state as AnthropicContinuationState;
    // tool_result blocks (exact tool_use_id, is_error on failure) come
    // FIRST in the user turn — before any additional user text (none here).
    const results: ContentBlockParam[] = input.results.map((result: AgentToolResult) => ({
      type: "tool_result",
      tool_use_id: result.callId,
      content: result.outputText,
      ...(result.isError ? { is_error: true } : {}),
    }));
    const state: AnthropicContinuationState = { system: prior.system, messages: [...prior.messages, { role: "user", content: results }] };
    try {
      const message = await this.getClient().messages.create(this.params(state, input.tools), { signal: input.signal });
      return normalizeAnthropicStep(message, state);
    } catch (error) {
      throw toProviderError(this.provider, error);
    }
  }
}

export function agentAdapterFor(provider: "openai" | "anthropic"): ProviderAgentAdapter {
  // [B18-C I10] the browser harness's SCRIPTED agent — only under the fixture runtime (non-production, local_dev identity)
  // AND an explicit opt-in; never a model, never reachable in production.
  if (fixtureRuntimeEnabled() && process.env[FIXTURE_AGENT_ENV]?.trim() === FIXTURE_AGENT_SCRIPTED) return new FixtureAgentAdapter(provider);
  return provider === "openai" ? new OpenAIAgentAdapter() : new AnthropicAgentAdapter();
}
