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
import { toProviderError } from "./errors";
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
    private readonly model = process.env.SIRKIT_ANTHROPIC_MODEL ?? "claude-opus-4-7",
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
    const supportsTemperature = /^claude-3-|^claude-(?:sonnet|opus)-4-[0-5]/.test(this.model);
    return {
      model: this.model,
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
      const response = await this.getClient().messages.create(this.params(request));
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
      throw toProviderError(this.id, error);
    }
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    let stream: ReturnType<AnthropicClient["messages"]["stream"]> | undefined;
    try {
      stream = this.getClient().messages.stream(this.params(request));
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
      throw toProviderError(this.id, error);
    } finally {
      stream?.abort();
    }
  }
}
