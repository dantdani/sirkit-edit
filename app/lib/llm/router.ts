import { AnthropicProvider } from "./anthropic-provider";
import { OpenAIProvider } from "./openai-provider";
import { LLMProviderError } from "./errors";
import type { LLMChunk, LLMProvider, LLMProviderId, LLMRequest, LLMResponse } from "./types";

export class LLMRouter {
  private readonly providers: Map<LLMProviderId, LLMProvider>;

  constructor(providers: LLMProvider[] = [new OpenAIProvider(), new AnthropicProvider()]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  private resolve(provider: LLMProviderId): LLMProvider {
    const implementation = this.providers.get(provider);
    if (!implementation) throw new LLMProviderError(provider);
    return implementation;
  }

  generate(request: LLMRequest): Promise<LLMResponse> {
    return this.resolve(request.provider).generate(request);
  }

  stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    return this.resolve(request.provider).stream(request);
  }

  supportsTools(provider: LLMProviderId): boolean {
    return this.resolve(provider).supportsTools();
  }

  supportsVision(provider: LLMProviderId): boolean {
    return this.resolve(provider).supportsVision();
  }
}

export const llmRouter = new LLMRouter();
