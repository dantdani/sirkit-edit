import { AnthropicProvider } from "./anthropic-provider";
import { OpenAIProvider } from "./openai-provider";
import { LLMProviderError } from "./errors";
import type { LLMChunk, LLMProvider, LLMProviderId, LLMRequest, LLMResponse } from "./types";

import { fixtureRuntimeEnabled } from "../fixture-runtime/mode";
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
    // [B16-C §5] fixture runtime: no provider is ever called (zero credits). The build
    // planner answers "no decomposition" so the (fixture) build loop runs; EVERY other
    // provider request (review, tidy, second opinion, edits) is the bounded
    // `provider_unavailable` failure (503, `missing_credentials`) — the browser proof found
    // the review route answering 500 "no review returned" behind an empty fixture answer.
    if (fixtureRuntimeEnabled()) {
      const choice = request.toolChoice;
      if (typeof choice === "object" && choice !== null && choice.name === "submit_plan") {
        return Promise.resolve({ provider: request.provider, model: "fixture-provider", text: "", toolCalls: [], stopReason: "end_turn" });
      }
      return Promise.reject(new LLMProviderError(request.provider, "missing_credentials"));
    }
    return this.resolve(request.provider).generate(request);
  }

  stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    if (fixtureRuntimeEnabled()) throw new LLMProviderError(request.provider);
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
