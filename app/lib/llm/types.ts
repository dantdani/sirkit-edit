export const LLM_PROVIDER_IDS = ["openai", "anthropic"] as const;

export type LLMProviderId = (typeof LLM_PROVIDER_IDS)[number];

export type LLMTextPart = { type: "text"; text: string };
export type LLMImagePart = {
  type: "image";
  dataUrl: string;
  detail?: "auto" | "low" | "high";
};
export type LLMToolCallPart = {
  type: "tool_call";
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type LLMToolResultPart = {
  type: "tool_result";
  toolCallId: string;
  output: string;
  isError?: boolean;
};

export type LLMContentPart =
  | LLMTextPart
  | LLMImagePart
  | LLMToolCallPart
  | LLMToolResultPart;

export interface LLMMessage {
  role: "user" | "assistant";
  content: string | LLMContentPart[];
}

export interface LLMTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  strict?: boolean;
}

export type LLMToolChoice = "auto" | "required" | "none" | { name: string };

export interface LLMRequest {
  provider: LLMProviderId;
  messages: LLMMessage[];
  /** Transport cancellation only; never serialized into provider input. */
  signal?: AbortSignal;
  system?: string;
  tools?: LLMTool[];
  toolChoice?: LLMToolChoice;
  maxTokens?: number;
  temperature?: number;
  boardState?: unknown;
  schematicState?: unknown;
  retrievedContext?: unknown;
  designConstraints?: unknown;
  userRequest?: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMResponse {
  provider: LLMProviderId;
  model: string;
  text: string;
  toolCalls: LLMToolCall[];
  stopReason?: string | null;
  usage?: LLMUsage;
}

export type LLMChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; toolCall: LLMToolCall }
  | { type: "done"; response: LLMResponse };

export interface LLMProvider {
  readonly id: LLMProviderId;
  generate(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<LLMChunk>;
  supportsTools(): boolean;
  supportsVision(): boolean;
}

export interface AiProviderHistoryEntry {
  id: string;
  at: number;
  from: LLMProviderId;
  to: LLMProviderId;
  kind: "ai-provider-switch";
}

export interface AiProjectSettings {
  brain: LLMProviderId;
  embeddings: "openai";
  providerHistory: AiProviderHistoryEntry[];
}

export function isLLMProviderId(value: unknown): value is LLMProviderId {
  return typeof value === "string" && LLM_PROVIDER_IDS.includes(value as LLMProviderId);
}

export function textMessage(role: LLMMessage["role"], text: string): LLMMessage {
  return { role, content: text };
}

export function assistantResponseMessage(response: LLMResponse): LLMMessage {
  const content: LLMContentPart[] = [];
  if (response.text) content.push({ type: "text", text: response.text });
  content.push(
    ...response.toolCalls.map(
      (toolCall): LLMToolCallPart => ({ type: "tool_call", ...toolCall }),
    ),
  );
  return { role: "assistant", content };
}

export function toolResultsMessage(results: LLMToolResultPart[]): LLMMessage {
  return { role: "user", content: results };
}
