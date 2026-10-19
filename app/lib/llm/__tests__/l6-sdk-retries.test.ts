/**
 * [PR-L6 integration, 2026-10-19] SPEND-1 (the spend-bound review of increment 6): a metered generation call is ONE billed attempt.
 *
 * The router's OpenAI client is built with `maxRetries: 5` (openai-provider.ts `getClient`), and the SDKs resend connection failures,
 * timeouts, 408, 409, 429 and 5xx inside one `generate()`. `MeteredLlmPort` admits and charges one input bound and one output bound per
 * `generate()`, so an SDK resend of an attempt the provider may already have billed was invisible to the allowance. Every metered slice
 * call now carries `maxProviderRetries: 0`, which both providers pass to the SDK as the per-call `maxRetries`; the slice's own provider
 * wait re-admits and re-charges any retry. A caller that does not ask keeps the client's default (the chat and other routes unchanged).
 *
 * Real SDK clients over an injected fetch (synthetic key, no network): every attempt answers 500 with `retry-after-ms: 1`, so the SDK's
 * own retry loop runs at full count without sleeping.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../anthropic-provider";
import { OpenAIProvider } from "../openai-provider";
import { LLMRouter } from "../router";
import type { LLMProvider, LLMProviderId, LLMRequest } from "../types";
import { MeteredLlmPort, SliceInputAllowance } from "../../generation-task/worker/accounting";

const CLIENT_RETRIES = 5; // the router client's own setting (openai-provider.ts getClient)

function failingFetch() {
  return vi.fn(async () => new Response(JSON.stringify({ error: { message: "synthetic server error", type: "server_error" } }), {
    status: 500,
    headers: { "content-type": "application/json", "retry-after-ms": "1" },
  }));
}

function providerOver(id: LLMProviderId, fetch: typeof globalThis.fetch): LLMProvider {
  // Deliberately synthetic credentials; the fetch is injected, so nothing can reach a service.
  if (id === "openai") return new OpenAIProvider(new OpenAI({ apiKey: "synthetic-test-key", fetch, maxRetries: CLIENT_RETRIES }), "gpt-test");
  return new AnthropicProvider(new Anthropic({ apiKey: "synthetic-test-key", fetch, maxRetries: CLIENT_RETRIES }), "claude-test");
}

function request(provider: LLMProviderId): LLMRequest {
  return {
    provider,
    messages: [{ role: "user", content: "plan a synthetic resistor divider" }],
    system: "Synthetic retry test; do not contact any service.",
    maxTokens: 64,
    tools: [{ name: "submit_plan", description: "Submit the plan", inputSchema: { type: "object", properties: {}, additionalProperties: false } }],
    toolChoice: { name: "submit_plan" },
  };
}

describe.each(["openai", "anthropic"] as const)("[PR-L6 integration] SPEND-1: %s metered calls are one attempt", (id) => {
  it("an unmetered call keeps the client's own retries (the default is unchanged for every other caller)", async () => {
    const fetch = failingFetch();
    const provider = providerOver(id, fetch);
    await expect(provider.generate(request(id))).rejects.toMatchObject({ provider: id });
    expect(fetch).toHaveBeenCalledTimes(1 + CLIENT_RETRIES);
  });

  it("MeteredLlmPort over the router sends the call once: the SDK never resends an attempt the meter charged once", async () => {
    const fetch = failingFetch();
    const router = new LLMRouter([providerOver(id, fetch)]);
    const metered = new MeteredLlmPort({ generate: (sent) => router.generate(sent) });
    await expect(metered.generate(request(id))).rejects.toMatchObject({ provider: id });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(metered.started).toBe(1);
  });

  it("with an input allowance the one admitted bound covers the one attempt the provider saw", async () => {
    const fetch = failingFetch();
    const router = new LLMRouter([providerOver(id, fetch)]);
    const input = new SliceInputAllowance(1_000_000);
    const metered = new MeteredLlmPort({ generate: (sent) => router.generate(sent) }, undefined, undefined, { input });
    await expect(metered.generate(request(id))).rejects.toMatchObject({ provider: id });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("the per-call option is transport only: never in the provider-visible body, and absent from a plain call's options", async () => {
    const seen: Array<{ body: string }> = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen.push({ body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ error: { message: "synthetic server error" } }), { status: 500, headers: { "content-type": "application/json", "retry-after-ms": "1" } });
    });
    const provider = providerOver(id, fetch);
    await expect(provider.generate({ ...request(id), maxProviderRetries: 0 })).rejects.toMatchObject({ provider: id });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(seen[0]!.body).not.toContain("maxProviderRetries");
    expect(seen[0]!.body).not.toContain("maxRetries");
  });
});

describe("[PR-L6 integration] SPEND-1: the SDK request options", () => {
  it.each(["openai", "anthropic"] as const)("%s: the per-call retries reach the SDK call as maxRetries, beside the signal", async (id) => {
    const create = vi.fn(async () => (id === "openai"
      ? { id: "r", model: "gpt-test", output: [], output_text: "", status: "completed", usage: { input_tokens: 1, output_tokens: 1 } }
      : { id: "m", model: "claude-test", content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
    const provider = id === "openai"
      ? new OpenAIProvider({ responses: { create } } as never, "gpt-test")
      : new AnthropicProvider({ messages: { create } } as never, "claude-test");
    const controller = new AbortController();
    await provider.generate(request(id));
    await provider.generate({ ...request(id), maxProviderRetries: 0 });
    await provider.generate({ ...request(id), maxProviderRetries: 0, signal: controller.signal });
    const calls = create.mock.calls as unknown as unknown[][];
    expect(calls[0]).toHaveLength(1);
    expect(calls[1]![1]).toEqual({ maxRetries: 0 });
    expect(calls[2]![1]).toEqual({ signal: controller.signal, maxRetries: 0 });
    for (const call of calls) expect(JSON.stringify(call[0])).not.toContain("maxProviderRetries");
  });
});
