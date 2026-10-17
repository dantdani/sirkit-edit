import OpenAI from "openai";
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
  ResponseInput,
  ResponseInputItem,
  ToolChoiceFunction,
  ToolChoiceOptions,
} from "openai/resources/responses/responses";
import { composeInstructions } from "./context";
import { LLMProviderError, toProviderError } from "./errors";
import {
  configuredOpenAIModel,
  configuredOpenAIReasoningEffort, OPENAI_NO_TEMPERATURE_MODEL_FAMILY, // [B21 E1] the rule, named once in openai-config
  type OpenAIReasoningEffort,
} from "./openai-config";
import type {
  LLMChunk,
  LLMContentPart,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolChoice,
} from "./types";

type OpenAIClient = Pick<OpenAI, "responses">;

function messageItems(request: LLMRequest): ResponseInput {
  const input: ResponseInputItem[] = [];
  for (const message of request.messages) {
    if (typeof message.content === "string") {
      input.push({ role: message.role, content: message.content });
      continue;
    }

    const messageParts = message.content.filter(
      (part): part is Extract<LLMContentPart, { type: "text" | "image" }> =>
        part.type === "text" || part.type === "image",
    );
    if (messageParts.length > 0) {
      if (message.role === "assistant") {
        const text = messageParts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("");
        if (text) input.push({ role: "assistant", content: text });
      } else {
        input.push({
          role: "user",
          content: messageParts.map((part) =>
            part.type === "text"
              ? { type: "input_text" as const, text: part.text }
              : {
                  type: "input_image" as const,
                  image_url: part.dataUrl,
                  detail: part.detail ?? "auto",
                },
          ),
        });
      }
    }

    for (const part of message.content) {
      if (part.type === "tool_call") {
        input.push({
          type: "function_call",
          call_id: part.id,
          name: part.name,
          arguments: JSON.stringify(part.input),
        });
      } else if (part.type === "tool_result") {
        input.push({
          type: "function_call_output",
          call_id: part.toolCallId,
          output: part.output,
        });
      }
    }
  }
  return input;
}

function mapTools(request: LLMRequest): FunctionTool[] | undefined {
  return request.tools?.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: tool.strict ?? false,
  }));
}

function mapToolChoice(
  choice: LLMToolChoice | undefined,
): ToolChoiceOptions | ToolChoiceFunction | undefined {
  if (!choice) return "auto";
  if (typeof choice === "string") return choice;
  return { type: "function", name: choice.name };
}

function normalizeResponse(response: Response): LLMResponse {
  const toolCalls = response.output
    .filter((item) => item.type === "function_call")
    .map((item) => {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(item.arguments) as Record<string, unknown>;
      } catch {
        input = { _raw: item.arguments };
      }
      return { id: item.call_id, name: item.name, input };
    });
  return {
    provider: "openai",
    model: response.model,
    text: response.output_text,
    toolCalls,
    stopReason: openAIStopReason(response), // [PR-L, 2026-10-17] an `incomplete` response reports why (openAIStopReason, after the last line)
    usage: response.usage
      ? {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        }
      : undefined,
  };
}

export class OpenAIProvider implements LLMProvider {
  readonly id = "openai" as const;
  private client?: OpenAIClient;

  constructor(
    client?: OpenAIClient,
    private readonly model = configuredOpenAIModel(),
    private readonly reasoningEffort: OpenAIReasoningEffort | undefined =
      configuredOpenAIReasoningEffort(model),
  ) {
    this.client = client;
  }

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }

  private getClient(): OpenAIClient {
    this.client ??= new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 5,
      timeout: 10 * 60 * 1000,
    });
    return this.client;
  }

  private baseParams(request: LLMRequest) {
    const supportsTemperature = !OPENAI_NO_TEMPERATURE_MODEL_FAMILY.test(this.model);
    return {
      model: this.model,
      instructions: composeInstructions(request),
      input: messageItems(request),
      tools: mapTools(request),
      tool_choice: request.tools?.length ? mapToolChoice(request.toolChoice) : undefined,
      max_output_tokens: request.maxTokens,
      reasoning: this.reasoningEffort ? { effort: this.reasoningEffort } : undefined,
      temperature: supportsTemperature ? request.temperature : undefined,
      store: false,
    };
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    try {
      const params: ResponseCreateParamsNonStreaming = {
        ...this.baseParams(request),
        stream: false,
      };
      const response = await (request.signal
        ? this.getClient().responses.create(params, { signal: request.signal })
        : this.getClient().responses.create(params));
      return normalizeResponse(response);
    } catch (error) {
      if (request.signal?.aborted) throw new LLMProviderError(this.id, "cancelled");
      throw toProviderError(this.id, error);
    }
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    try {
      const params: ResponseCreateParamsStreaming = {
        ...this.baseParams(request),
        stream: true,
      };
      const stream = await (request.signal
        ? this.getClient().responses.create(params, { signal: request.signal })
        : this.getClient().responses.create(params));
      let completed: Response | undefined;
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield { type: "text_delta", text: event.delta };
        } else if (event.type === "response.output_item.done" && event.item.type === "function_call") {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(event.item.arguments) as Record<string, unknown>;
          } catch {
            input = { _raw: event.item.arguments };
          }
          yield {
            type: "tool_call",
            toolCall: { id: event.item.call_id, name: event.item.name, input },
          };
        } else if (event.type === "response.completed") {
          completed = event.response;
        }
      }
      if (!completed) throw new Error("OpenAI stream ended before a completed response.");
      yield { type: "done", response: normalizeResponse(completed) };
    } catch (error) {
      if (request.signal?.aborted) throw new LLMProviderError(this.id, "cancelled");
      throw toProviderError(this.id, error);
    }
  }
}

// [PR-L, 2026-10-17] Runbook L.6; limit-and-stall-map.md section 4 (block Y: one turn stopped at the 8,192-token output cap). Appended
// after the last line on purpose (a function declaration is hoisted), so no cited line moves (configuration.ts cites :152-156).
/**
 * The response's stop as the router reports it. Every status passes through unchanged except `incomplete`: cut by
 * `max_output_tokens` it reports `max_tokens` - the value Anthropic's `stop_reason` uses for the same stop (and STEP_STOPS' name for
 * it, app/lib/agent/contracts.ts), so one consumer check covers both providers - and any other `incomplete` (e.g. `content_filter`)
 * stays `incomplete`. A function call cut off inside such a response still arrives as `{ _raw }` (its arguments do not parse); the
 * Build loop refuses a submission from a turn that stopped this way (build-loop.ts `unreadableSubmission`).
 */
function openAIStopReason(response: Response): LLMResponse["stopReason"] {
  if (response.status !== "incomplete") return response.status;
  return response.incomplete_details?.reason === "max_output_tokens" ? "max_tokens" : "incomplete";
}
