import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../anthropic-provider";
import { OpenAIProvider } from "../openai-provider";
import type { LLMChunk, LLMProvider, LLMProviderId, LLMRequest } from "../types";

type RequestOptions = { signal?: AbortSignal };

const OPENAI_RESPONSE = {
  id: "response-cancellation-fixture",
  model: "gpt-test",
  output_text: "ready",
  output: [],
  status: "completed",
  usage: { input_tokens: 4, output_tokens: 1 },
};
const ANTHROPIC_RESPONSE = {
  id: "message-cancellation-fixture",
  model: "claude-test",
  content: [{ type: "text", text: "ready" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 4, output_tokens: 1 },
};

function request(provider: LLMProviderId, signal?: AbortSignal): LLMRequest {
  return {
    provider,
    messages: [{ role: "user", content: "inspect a synthetic resistor fixture" }],
    system: "Synthetic cancellation test; do not contact any service.",
    maxTokens: 32,
    temperature: 0,
    tools: [{
      name: "inspect_fixture",
      description: "Inspect the synthetic fixture",
      strict: true,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    }],
    toolChoice: { name: "inspect_fixture" },
    ...(signal ? { signal } : {}),
  };
}

async function consume(stream: AsyncIterable<LLMChunk>): Promise<LLMChunk[]> {
  const chunks: LLMChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function fakeSdk(provider: LLMProviderId) {
  const abort = vi.fn();
  const create = vi.fn(async (params: unknown, options?: RequestOptions) => {
    void params;
    void options;
    return provider === "openai" ? OPENAI_RESPONSE : ANTHROPIC_RESPONSE;
  });
  const stream = vi.fn((params: unknown, options?: RequestOptions) => {
    void params;
    void options;
    return {
      async *[Symbol.asyncIterator]() {
        if (provider === "openai") {
          yield { type: "response.output_text.delta", delta: "ready" };
          yield { type: "response.completed", response: OPENAI_RESPONSE };
        } else {
          yield { type: "content_block_delta", delta: { type: "text_delta", text: "ready" } };
        }
      },
      finalMessage: async () => ANTHROPIC_RESPONSE,
      abort,
    };
  });
  // The Responses SDK uses one create method for both modes; Messages has a
  // distinct stream helper. Both fakes record the real adapter boundary.
  const responsesCreate = vi.fn((params: unknown, options?: RequestOptions) => {
    const streaming = (params as { stream?: boolean }).stream;
    return streaming ? Promise.resolve(stream(params, options)) : create(params, options);
  });
  const adapter: LLMProvider = provider === "openai"
    ? new OpenAIProvider({ responses: { create: responsesCreate } } as never, "gpt-test")
    : new AnthropicProvider({ messages: { create, stream } } as never, "claude-test");
  return {
    adapter,
    generateCall: provider === "openai" ? responsesCreate : create,
    streamCall: provider === "openai" ? responsesCreate : stream,
    abort,
  };
}

function withFakeFetch(provider: LLMProviderId, fetch: typeof globalThis.fetch): LLMProvider {
  // Deliberately synthetic credentials. The fetch implementation is injected,
  // so these tests cannot consult process credentials or reach the network.
  if (provider === "openai") {
    return new OpenAIProvider(new OpenAI({ apiKey: "synthetic-test-key", fetch, maxRetries: 0 }), "gpt-test");
  }
  return new AnthropicProvider(new Anthropic({ apiKey: "synthetic-test-key", fetch, maxRetries: 0 }), "claude-test");
}

describe.each(["openai", "anthropic"] as const)("%s generation cancellation", (provider) => {
  it("forwards generate cancellation only in SDK options and preserves the no-signal call", async () => {
    const { adapter, generateCall } = fakeSdk(provider);
    await adapter.generate(request(provider));
    const controller = new AbortController();
    await adapter.generate(request(provider, controller.signal));

    const [withoutSignal, withSignal] = generateCall.mock.calls;
    expect(withoutSignal).toHaveLength(1);
    expect(withSignal).toHaveLength(2);
    expect(withSignal[0]).toEqual(withoutSignal[0]);
    expect(withSignal[1]).toEqual({ signal: controller.signal });
    expect(withSignal[1]?.signal).toBe(controller.signal);
    expect(withSignal[0]).not.toHaveProperty("signal");
    expect(JSON.stringify(withSignal[0])).not.toContain('"signal"');
  });

  it("forwards stream cancellation only in SDK options without changing events or payload", async () => {
    const { adapter, streamCall, abort } = fakeSdk(provider);
    const original = await consume(adapter.stream(request(provider)));
    const controller = new AbortController();
    const cancellable = await consume(adapter.stream(request(provider, controller.signal)));

    const [withoutSignal, withSignal] = streamCall.mock.calls;
    expect(withoutSignal).toHaveLength(1);
    expect(withSignal).toHaveLength(2);
    expect(withSignal[0]).toEqual(withoutSignal[0]);
    expect(withSignal[1]).toEqual({ signal: controller.signal });
    expect(withSignal[1]?.signal).toBe(controller.signal);
    expect(withSignal[0]).not.toHaveProperty("signal");
    expect(JSON.stringify(withSignal[0])).not.toContain('"signal"');
    expect(cancellable).toEqual(original);
    expect(cancellable.map((chunk) => chunk.type)).toEqual(["text_delta", "done"]);
    if (provider === "anthropic") expect(abort).toHaveBeenCalledTimes(2);
  });

  it.each(["generate", "stream"] as const)("pre-aborted %s never reaches SDK fetch", async (mode) => {
    const fetch = vi.fn(async () => {
      throw new Error("A pre-aborted request must not start transport work.");
    });
    const adapter = withFakeFetch(provider, fetch);
    const controller = new AbortController();
    controller.abort();
    const pending = mode === "generate"
      ? adapter.generate(request(provider, controller.signal))
      : consume(adapter.stream(request(provider, controller.signal)));

    await expect(pending).rejects.toMatchObject({ provider, reason: "cancelled" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["generate", "stream"] as const)("cancels an in-flight %s through SDK fetch", async (mode) => {
    let transportStarted!: () => void;
    const started = new Promise<void>((resolve) => { transportStarted = resolve; });
    let transportSignal: AbortSignal | null | undefined;
    const fetch = vi.fn((_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      transportSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("Synthetic transport aborted", "AbortError"));
        if (transportSignal?.aborted) abort();
        else transportSignal?.addEventListener("abort", abort, { once: true });
        transportStarted();
      });
    });
    const adapter = withFakeFetch(provider, fetch);
    const controller = new AbortController();
    const pending = mode === "generate"
      ? adapter.generate(request(provider, controller.signal))
      : consume(adapter.stream(request(provider, controller.signal)));
    // Attach the rejection assertion before issuing cancellation so no pending
    // SDK rejection can become unhandled while this test waits for transport.
    const refused = expect(pending).rejects.toMatchObject({ provider, reason: "cancelled" });
    await started;
    expect(transportSignal?.aborted).toBe(false);
    controller.abort();
    await refused;
    expect(transportSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
