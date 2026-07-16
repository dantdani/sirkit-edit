import type { LLMProviderId } from "./types";

export class LLMProviderError extends Error {
  readonly code = "provider_unavailable";

  constructor(
    readonly provider: LLMProviderId,
    message?: string,
    options?: ErrorOptions,
  ) {
    super(message ?? `${provider} is currently unavailable.`, options);
    this.name = "LLMProviderError";
  }
}

export function toProviderError(provider: LLMProviderId, error: unknown): LLMProviderError {
  if (error instanceof LLMProviderError) return error;
  return new LLMProviderError(provider, undefined, {
    cause: error instanceof Error ? error : undefined,
  });
}

export function providerErrorResponse(error: unknown, provider: LLMProviderId): Response {
  const normalized = toProviderError(provider, error);
  console.error(`[llm:${provider}] request failed`, {
    name: normalized.cause instanceof Error ? normalized.cause.name : "UnknownError",
  });
  return Response.json(
    {
      ok: false,
      code: normalized.code,
      provider,
      error: `${provider === "openai" ? "OpenAI" : "Anthropic"} is currently unavailable.`,
    },
    { status: 503 },
  );
}
