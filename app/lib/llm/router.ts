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
    return recordModelCall({ provider: request.provider, model: configuredModelOf(request.provider), kind: "generate", usage: generateUsage }, () => this.resolve(request.provider).generate(request)); // [B24-C1] D24-21, OD-207: one call record per provider call, after the fixture short-circuit
  }

  stream(request: LLMRequest): AsyncIterable<LLMChunk> {
    if (fixtureRuntimeEnabled()) throw new LLMProviderError(request.provider);
    return recordModelStream({ provider: request.provider, model: configuredModelOf(request.provider), kind: "stream" }, () => this.resolve(request.provider).stream(request), streamUsage); // [B24-C1] one record when the iteration ends
  }

  supportsTools(provider: LLMProviderId): boolean {
    return this.resolve(provider).supportsTools();
  }

  supportsVision(provider: LLMProviderId): boolean {
    return this.resolve(provider).supportsVision();
  } /** [PR-L6 spend, 2026-10-19] SPEND-3-A3: the model `provider`'s adapter sends every request to (fixed when it was built); undefined when no adapter names one. The post-apply admission charges an image at it. On this line so no cited line moves */ servingModel(provider: LLMProviderId): string | undefined { return this.providers.get(provider)?.model; }
}

export const llmRouter = new LLMRouter();

// [B24-C1] D24-21, OD-207: the call-record seam and what a record keeps of an answer (its model and token counts, never its content),
// appended after the last line - an import and a function declaration are hoisted, so no line cited in this file moves.
import { recordModelCall, recordModelStream, type ModelCallUsage } from "../observability/llm-call-record";
import { configuredOpenAIModel } from "./openai-config";
import { configuredAnthropicModel } from "./anthropic-config";

/** The model a failed call is recorded under: the configured one (`LLMRequest` carries no model; a success records the answer's). */
function configuredModelOf(provider: LLMProviderId): string {
  return provider === "openai" ? configuredOpenAIModel() : configuredAnthropicModel();
}
function generateUsage(response: LLMResponse): ModelCallUsage {
  return { model: response.model, inputTokens: response.usage?.inputTokens, outputTokens: response.usage?.outputTokens };
}
function streamUsage(chunk: LLMChunk): ModelCallUsage | null {
  return chunk.type === "done" ? generateUsage(chunk.response) : null;
}
