/**
 * [B19-B I2b] The SchGen endpoint client on its own: bounded retries, bounded time, closed failures — a fake transport and
 * resolver, no endpoint, no token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callSchGenEndpoint,
  extractSchGenCode,
  schgenEndpointFromEnv,
  schgenPolicy,
  SCHGEN_MAX_ATTEMPTS,
  SCHGEN_MAX_RESPONSE_BYTES,
} from "../endpoint-client";

const URL_OK = "https://schgen.example.com/generate";
const TOKEN = "hf_DUMMY-TOKEN-DO-NOT-LEAK-0123456789";
const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubGlobal("fetch", () => { throw new Error("the SchGen client bypassed its injected transport"); });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function scripted(answers: Array<() => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    return next();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("[B19-B I2b] configuration", () => {
  it("reads the endpoint at call time; an unset or blank URL is 'not configured'", () => {
    expect(schgenEndpointFromEnv({})).toBeNull();
    expect(schgenEndpointFromEnv({ SCHGEN_ENDPOINT_URL: "   " })).toBeNull();
    expect(schgenEndpointFromEnv({ SCHGEN_ENDPOINT_URL: URL_OK })).toEqual({ url: URL_OK });
    expect(schgenEndpointFromEnv({ SCHGEN_ENDPOINT_URL: URL_OK, HF_TOKEN: TOKEN })).toEqual({ url: URL_OK, token: TOKEN });
    expect(schgenEndpointFromEnv({ SCHGEN_ENDPOINT_URL: URL_OK, SCHGEN_ENDPOINT_TOKEN: "a", HF_TOKEN: "b" })).toEqual({ url: URL_OK, token: "a" });
  });

  it("the policy allows exactly the configured host, no redirects, and a bounded body", () => {
    const policy = schgenPolicy({ url: URL_OK });
    expect(policy.allowedHosts).toEqual(["schgen.example.com"]);
    expect(policy.maxRedirects).toBe(0);
    expect(policy.maxResponseBytes).toBe(SCHGEN_MAX_RESPONSE_BYTES);
    expect(schgenPolicy({ url: "not a url" }).allowedHosts).toEqual([]);
  });
});

describe("[B19-B I2b] the endpoint is refused before any byte leaves", () => {
  it.each([
    ["an invalid URL", "not a url"],
    ["URL credentials", "https://user:pass@schgen.example.com/generate"],
    ["cloud metadata", "https://169.254.169.254/latest"],
    ["a private address", "https://10.0.0.8/generate"],
  ])("%s → endpoint_not_permitted", async (_label, url) => {
    const { calls, fetchImpl } = scripted([() => json({ code: "never" })]);
    const outcome = await callSchGenEndpoint("p", { url, token: TOKEN }, { fetch: fetchImpl, resolve: PUBLIC });
    expect(calls).toHaveLength(0);
    expect(outcome).toMatchObject({ ok: false, failure: "endpoint_not_permitted" });
  });
});

describe("[B19-B I2b] retries are bounded", () => {
  it("a 503 while the endpoint wakes is retried with back-off, then answered", async () => {
    const sleeps: number[] = [];
    const { calls, fetchImpl } = scripted([() => new Response("loading", { status: 503, headers: { "content-type": "text/html" } }), () => new Response("loading", { status: 503 }), () => json({ code: "add_label()" })]);
    const outcome = await callSchGenEndpoint("p", { url: URL_OK, token: TOKEN }, { fetch: fetchImpl, resolve: PUBLIC, sleep: async (ms) => { sleeps.push(ms); } });
    expect(outcome).toEqual({ ok: true, code: "add_label()" });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([5000, 10000]);
  });

  it(`a 503 on every attempt stops after ${SCHGEN_MAX_ATTEMPTS} and says the endpoint is still starting`, async () => {
    const { calls, fetchImpl } = scripted([() => new Response("loading", { status: 503 })]);
    const outcome = await callSchGenEndpoint("p", { url: URL_OK }, { fetch: fetchImpl, resolve: PUBLIC, sleep: async () => undefined });
    expect(calls).toHaveLength(SCHGEN_MAX_ATTEMPTS);
    expect(outcome).toMatchObject({ ok: false, failure: "still_starting", status: 503 });
  });

  it("any other error status is not retried, and its body is not carried", async () => {
    const { calls, fetchImpl } = scripted([() => new Response("INTERNAL-ONLY page", { status: 500 })]);
    const outcome = await callSchGenEndpoint("p", { url: URL_OK }, { fetch: fetchImpl, resolve: PUBLIC, sleep: async () => undefined });
    expect(calls).toHaveLength(1);
    expect(outcome).toMatchObject({ ok: false, failure: "http_error", status: 500 });
    expect(JSON.stringify(outcome)).not.toContain("INTERNAL-ONLY");
  });
});

describe("[B19-B I2b] time is bounded", () => {
  it("an endpoint that never answers is abandoned at the attempt deadline", async () => {
    const hang = (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
    const started = Date.now();
    const outcome = await callSchGenEndpoint("p", { url: URL_OK }, { fetch: hang, resolve: PUBLIC, attemptDeadlineMs: 60 });
    expect(outcome).toMatchObject({ ok: false, failure: "timeout" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("the total budget ends a run of retries", async () => {
    const { calls, fetchImpl } = scripted([() => new Response("loading", { status: 503 })]);
    const outcome = await callSchGenEndpoint("p", { url: URL_OK }, {
      fetch: fetchImpl,
      resolve: PUBLIC,
      totalBudgetMs: 30,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 80))),
    });
    expect(outcome).toMatchObject({ ok: false, failure: "timeout" });
    expect(calls.length).toBeLessThan(SCHGEN_MAX_ATTEMPTS);
  });
});

describe("[B19-B I2b] the answer", () => {
  it("accepts { code }, { generated_text } and [{ generated_text }]", () => {
    expect(extractSchGenCode({ code: "a" })).toBe("a");
    expect(extractSchGenCode({ generated_text: "b" })).toBe("b");
    expect(extractSchGenCode([{ generated_text: "c" }])).toBe("c");
    expect(extractSchGenCode([{}])).toBe("");
    expect(extractSchGenCode("text")).toBe("");
  });

  it("a non-JSON answer, invalid JSON, or an answer with no code is not usable", async () => {
    for (const [answer, failure] of [
      [() => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }), "unusable_answer"],
      [() => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }), "unusable_answer"],
      [() => json({ code: "   " }), "no_code"],
    ] as const) {
      const { fetchImpl } = scripted([answer]);
      expect(await callSchGenEndpoint("p", { url: URL_OK }, { fetch: fetchImpl, resolve: PUBLIC })).toMatchObject({ ok: false, failure });
    }
  });

  it("the bearer is sent as a header, and no failure's log line carries it", async () => {
    const { calls, fetchImpl } = scripted([() => { throw new Error(`reset; Authorization: Bearer ${TOKEN}`); }]);
    const outcome = await callSchGenEndpoint("p", { url: URL_OK, token: TOKEN }, { fetch: fetchImpl, resolve: PUBLIC });
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.init?.redirect).toBe("manual");
    expect(outcome).toMatchObject({ ok: false, failure: "unreachable" });
    expect(JSON.stringify(outcome)).not.toContain(TOKEN);
  });
});
