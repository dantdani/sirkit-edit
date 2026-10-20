import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  ImageBlockParam,
  Message,
  MessageParam,
  Tool,
  ToolChoice,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { composeInstructions } from "./context";
import { LLMProviderError, toProviderError } from "./errors";
import type {
  LLMContentPart,
  LLMChunk,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMToolChoice,
} from "./types";

type AnthropicClient = Pick<Anthropic, "messages">;

function parseImage(part: Extract<LLMContentPart, { type: "image" }>): ImageBlockParam {
  const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([\s\S]+)$/.exec(part.dataUrl);
  if (!match) throw new Error("Anthropic image input must be a supported base64 data URL.");
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      data: match[2],
    },
  };
}

function mapContent(part: LLMContentPart): ContentBlockParam {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "image":
      return parseImage(part);
    case "tool_call":
      return { type: "tool_use", id: part.id, name: part.name, input: part.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: part.toolCallId,
        content: part.output,
        is_error: part.isError,
      };
  }
}

function mapMessages(request: LLMRequest): MessageParam[] {
  return request.messages.map((message) => ({
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content.map(mapContent),
  }));
}

function mapTools(request: LLMRequest): Tool[] | undefined {
  return request.tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Tool.InputSchema,
    strict: tool.strict,
  }));
}

function mapToolChoice(choice: LLMToolChoice | undefined): ToolChoice | undefined {
  if (!choice || choice === "auto") return { type: "auto" };
  if (choice === "required") return { type: "any" };
  if (choice === "none") return { type: "none" };
  return { type: "tool", name: choice.name };
}

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic" as const;
  private client?: AnthropicClient;

  constructor(
    client?: AnthropicClient,
    readonly model = configuredAnthropicModel(), // [PR-L6 spend, 2026-10-19] SPEND-3-A3: readable (LLMProvider.model), so the router names the model it serves; still fixed at construction
  ) {
    this.client = client;
  }

  supportsTools(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }

  private getClient(): AnthropicClient {
    this.client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return this.client;
  }

  private params(request: LLMRequest) {
    const supportsTemperature = ANTHROPIC_TEMPERATURE_MODEL_FAMILY.test(this.model);
    return {
      model: sendableAnthropicModel(this.model), // [B24-A1] OD-199: an empty or padded model is refused (bad_request) before the request call, never sent
      max_tokens: request.maxTokens ?? 4096,
      system: composeInstructions(request),
      messages: mapMessages(request),
      tools: mapTools(request),
      tool_choice: request.tools?.length ? mapToolChoice(request.toolChoice) : undefined,
      temperature: supportsTemperature ? request.temperature : undefined,
    };
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    try {
      const response = await (sdkRequestOptions(request) // [PR-L6 integration, 2026-10-19] SPEND-1: the signal and the per-call retries
        ? this.getClient().messages.create(this.params(request), sdkRequestOptions(request))
        : this.getClient().messages.create(this.params(request)));
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      const toolCalls = response.content
        .filter((block) => block.type === "tool_use")
        .map((block) => ({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        }));
      return {
        provider: this.id,
        model: response.model,
        text,
        toolCalls,
        stopReason: response.stop_reason,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      if (request.signal?.aborted) throw new LLMProviderError(this.id, "cancelled");
      throw toProviderError(this.id, error);
    }
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    let stream: ReturnType<AnthropicClient["messages"]["stream"]> | undefined;
    try {
      stream = sdkRequestOptions(request) // [PR-L6 integration, 2026-10-19] SPEND-1: as generate
        ? this.getClient().messages.stream(this.params(request), sdkRequestOptions(request))
        : this.getClient().messages.stream(this.params(request));
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text_delta", text: event.delta.text };
        }
      }
      const message: Message = await stream.finalMessage();
      const response: LLMResponse = {
        provider: this.id,
        model: message.model,
        text: message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join(""),
        toolCalls: message.content
          .filter((block) => block.type === "tool_use")
          .map((block) => ({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          })),
        stopReason: message.stop_reason,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      };
      for (const toolCall of response.toolCalls) yield { type: "tool_call", toolCall };
      yield { type: "done", response };
    } catch (error) {
      if (request.signal?.aborted) throw new LLMProviderError(this.id, "cancelled");
      throw toProviderError(this.id, error);
    } finally {
      stream?.abort();
    }
  }
}

// [B21 E1] the default model and the temperature family, named once (anthropic-config.ts), on their own line at the end (an import is
// hoisted): no line cited in this file moves
import { ANTHROPIC_TEMPERATURE_MODEL_FAMILY, configuredAnthropicModel } from "./anthropic-config";
import { sendableAnthropicModel } from "./anthropic-model-guard"; // [B24-A1] on its own line at the end (an import is hoisted): no cited line moves

// [PR-L6 integration, 2026-10-19] SPEND-1: appended after the last line (a function declaration is hoisted), so no cited line moves.
/** The SDK's per-call request options: the transport signal and the caller's `maxProviderRetries` (0 for every metered generation slice
 *  call, so the SDK never resends an attempt the provider may already have billed - the client keeps the SDK default for every other
 *  caller). Undefined when the request carries neither, so a plain call stays a one-argument call. */
function sdkRequestOptions(request: LLMRequest): { signal?: AbortSignal; maxRetries?: number } | undefined {
  const retries = request.maxProviderRetries;
  const maxRetries = typeof retries === "number" && Number.isSafeInteger(retries) && retries >= 0 ? retries : undefined;
  if (!request.signal && maxRetries === undefined) return undefined;
  return { ...(request.signal ? { signal: request.signal } : {}), ...(maxRetries !== undefined ? { maxRetries } : {}) };
}
