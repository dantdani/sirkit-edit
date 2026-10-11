/**
 * [B24-A3] The embedding meter (D24-8, OD-197): the two public routes that embed a caller's text with OpenAI go through the LLM
 * admission machinery under an `embedding` key (`embedding:openai/model:<model>`, appended to the key union as B23-B2 appended the
 * manufacturing-provider key): 240 a minute, process-wide; three consecutive failures open the breaker for 60 s, a provider 429 at
 * once for 60 s, `insufficient_quota` for an hour. Outcomes are classed by the error's provider status and code, never by its text;
 * an error thrown before any provider request (a missing OPENAI_API_KEY) is neutral and opens nothing. A refusal makes no provider
 * call: the parts search takes its lexical fallback (shape unchanged), the footprint search answers 429 EMBEDDING_ADMISSION_PAUSED.
 * The meter counts `embedQuery` calls, not provider HTTP requests (the SDK's own retries sit below it).
 *
 * Failing first on b3b6b05: every request reaches the provider fake - N+1 requests in a window make N+1 provider calls, and a fourth
 * call after three failures is still sent (page section 10). The database and the provider are in-process fakes; the clock is faked
 * (Date only); errors are shaped like the SDK's (an own `status`, a `code`) without importing it. Nothing leaves the process.
 * [B24-A3 review, 2026-10-08] Case 3 pins the Retry-After values (tests-03), case 8 the late outcome of a call admitted before an
 * opening (tests-01) and case 9 the meter's clock under the fixture runtime's frozen clock (regressions-1); each failed first on the
 * reviewed tree (page section 21).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  const state = { results: [] as unknown[][], calls: 0, behaviour: null as null | (() => Promise<number[]>) };
  const makeChain = (): unknown => {
    const target = (): void => {};
    const proxy: unknown = new Proxy(target, {
      get(_t, prop) {
        if (prop === "then") {
          const rows = state.results.length ? state.results.shift()! : [];
          return (resolve: (v: unknown) => void) => resolve(rows);
        }
        return (...args: unknown[]) => { void args; return proxy; };
      },
      apply: () => proxy,
    });
    return proxy;
  };
  return { state, makeChain };
});
vi.mock("@/app/lib/db/client", () => ({ getDb: () => fakes.makeChain() }));
vi.mock("@/app/lib/embeddings", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, embedQuery: async () => { fakes.state.calls += 1; return fakes.state.behaviour ? fakes.state.behaviour() : new Array(1536).fill(0.1); } };
});

import { POST as partsSearch } from "@/app/api/parts/search/route";
import { GET as footprintSearch } from "@/app/api/pcb/footprints/search/route";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);

/** The reviewed meter (OD-197 as A3 applies it; the page states the same). */
const PER_MINUTE = 240;
const BASE = Date.UTC(2026, 9, 6, 13, 0, 0);
const startCase = (index: number): void => { vi.setSystemTime(BASE + index * 3 * 3_600_000); };
const advance = (ms: number): void => { vi.setSystemTime(Date.now() + ms); };

const parts = (query = "res"): Promise<Response> =>
  partsSearch(new Request("http://localhost/api/parts/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) }));
const footprint = (q = "small resistor"): Promise<Response> =>
  footprintSearch(new Request(`http://localhost/api/pcb/footprints/search?q=${encodeURIComponent(q)}`, { method: "GET" }));

/** An error shaped like the SDK's APIError (an own `status`, a `code`) - the only shape the meter reads. */
const providerError = (status: number | undefined, code?: string): Error => Object.assign(new Error("provider fake"), { status, code, headers: undefined, error: undefined });
const failWith = (error: Error): void => { fakes.state.behaviour = async () => { throw error; }; };
const succeed = (): void => { fakes.state.behaviour = null; };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("SIRKIT_TRUSTED_CLIENT_IP_HEADER", undefined);
  resetAdmissionControl();
  fakes.state.results = [];
  fakes.state.calls = 0;
  succeed();
  vi.spyOn(console, "warn").mockImplementation(() => undefined); // the parts search's lexical-fallback line
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetAdmissionControl();
});

describe("[B24-A3] the embedding meter (D24-8, OD-197)", () => {
  it("1. counterexample (red on b3b6b05): N+1 embedding requests in a window reach the provider fake N times - the parts search keeps answering through its lexical fallback, shape unchanged; the footprint search answers 429 EMBEDDING_ADMISSION_PAUSED with Retry-After and sends nothing; the exact Lib:Name path still answers without the meter", { timeout: 60_000 }, async () => {
    startCase(1);
    for (let index = 0; index <= PER_MINUTE; index += 1) {
      const response = await parts();
      expect(response.status).toBe(200);
      const body = await response.json() as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["ok", "pagination", "results"]);
    }
    expect(fakes.state.calls).toBe(PER_MINUTE);
    const paused = await footprint();
    expect(paused.status).toBe(429);
    expect(await paused.json()).toMatchObject({ ok: false, code: "EMBEDDING_ADMISSION_PAUSED" });
    expect(Number(paused.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(paused.headers.get("Cache-Control")).toBe("no-store");
    expect(fakes.state.calls).toBe(PER_MINUTE);
    fakes.state.results = [[{ id: "fp-1", libName: "Resistor_SMD", name: "R_0805_2012Metric", description: null, padCount: 2, attrSmd: true, attrTht: false, bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }]];
    const exact = await footprint("Resistor_SMD:R_0805_2012Metric");
    expect(exact.status).toBe(200);
    expect(((await exact.json()) as { hits: unknown[] }).hits).toHaveLength(1);
    expect(fakes.state.calls).toBe(PER_MINUTE);
    advance(60_000);
    expect((await footprint()).status).toBe(200);
    expect(fakes.state.calls).toBe(PER_MINUTE + 1);
  });

  it("2. three consecutive failures - a 5xx, a timeout and a network error (no status) - open the breaker for 60 s: the fourth call reaches no provider; after 60 s one trial goes and its success closes it", { timeout: 30_000 }, async () => {
    startCase(2);
    failWith(providerError(503));
    expect((await footprint()).status).toBe(500);
    failWith(providerError(408));
    expect((await footprint()).status).toBe(500);
    failWith(providerError(undefined));
    expect((await footprint()).status).toBe(500);
    expect(fakes.state.calls).toBe(3);
    succeed();
    expect((await footprint()).status).toBe(429);
    expect((await parts()).status).toBe(200);
    expect(fakes.state.calls).toBe(3);
    advance(60_000);
    expect((await footprint()).status).toBe(200);
    expect((await footprint()).status).toBe(200);
    expect(fakes.state.calls).toBe(5);
  });

  it("3. a provider 429 opens the breaker at once for 60 s; `insufficient_quota` opens it for an hour (still paused at 61 s and at 59 min, a trial at 60 min)", { timeout: 30_000 }, async () => {
    startCase(3);
    failWith(providerError(429, "rate_limit_exceeded"));
    expect((await footprint()).status).toBe(500);
    succeed();
    expect((await footprint()).status).toBe(429);
    expect(fakes.state.calls).toBe(1);
    advance(60_000);
    failWith(providerError(429, "insufficient_quota"));
    expect((await footprint()).status).toBe(500);
    expect(fakes.state.calls).toBe(2);
    succeed();
    advance(61_000);
    const early = await footprint(); // [B24-A3 review, 2026-10-08] tests-03: Retry-After is the hour's remainder, whole seconds, never capped at a minute
    expect([early.status, early.headers.get("Retry-After")]).toEqual([429, String(3_600 - 61)]);
    advance(59 * 60_000 - 61_000);
    const late = await footprint();
    expect([late.status, late.headers.get("Retry-After")]).toEqual([429, "60"]);
    expect(fakes.state.calls).toBe(2);
    advance(60_000);
    expect((await footprint()).status).toBe(200);
    expect(fakes.state.calls).toBe(3);
  });

  it("4. four calls that fail before any provider request (a missing OPENAI_API_KEY, no status) are neutral: the breaker stays closed, the footprint search keeps its 500 (never a 429 EMBEDDING_ADMISSION_PAUSED) and the fifth call reaches the provider", { timeout: 30_000 }, async () => {
    startCase(4);
    failWith(new Error("OPENAI_API_KEY is not set. Add it to .env.local."));
    for (let index = 0; index < 4; index += 1) {
      const response = await footprint();
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ ok: false, error: "OPENAI_API_KEY is not set. Add it to .env.local." });
    }
    succeed();
    expect((await footprint()).status).toBe(200);
    expect(fakes.state.calls).toBe(5);
    const { EMBEDDING_ADMISSION_KEY } = await import("@/app/lib/embedding-admission");
    const { currentEmbeddingPause } = await import("@/app/lib/acquisition/admission-control");
    expect(currentEmbeddingPause(EMBEDDING_ADMISSION_KEY)).toBeNull();
  });

  it("5. resetAdmissionControl() clears the embedding meter - the hour-long insufficient_quota opening and the minute window included", { timeout: 60_000 }, async () => {
    startCase(5);
    failWith(providerError(429, "insufficient_quota"));
    expect((await footprint()).status).toBe(500);
    succeed();
    expect((await footprint()).status).toBe(429);
    resetAdmissionControl();
    expect((await footprint()).status).toBe(200);
    for (let index = 1; index < PER_MINUTE; index += 1) await parts();
    expect((await footprint()).status).toBe(429);
    resetAdmissionControl();
    expect((await footprint()).status).toBe(200);
    expect(fakes.state.calls).toBe(PER_MINUTE + 2);
  });

  it("6. the outcome classes, by status and code only: 429 -> rate_limited, 429 insufficient_quota -> insufficient_quota, 5xx, 408 or no status on an SDK error -> failure, another provider status -> neutral, an error with no status at all -> neutral (whatever its text says)", async () => {
    const { classifyEmbeddingError } = await import("@/app/lib/embedding-admission");
    expect(classifyEmbeddingError(providerError(429))).toBe("rate_limited");
    expect(classifyEmbeddingError(providerError(429, "rate_limit_exceeded"))).toBe("rate_limited");
    expect(classifyEmbeddingError(providerError(429, "insufficient_quota"))).toBe("insufficient_quota");
    for (const status of [500, 502, 503, 504, 408, undefined]) expect(classifyEmbeddingError(providerError(status)), String(status)).toBe("failure");
    for (const status of [400, 401, 403, 404, 409, 422]) expect(classifyEmbeddingError(providerError(status)), String(status)).toBe("neutral");
    for (const text of ["429 insufficient_quota", "503 overloaded", "Connection error.", "Request timed out."]) expect(classifyEmbeddingError(new Error(text)), text).toBe("neutral");
    for (const value of [null, undefined, "429", 429, { code: "insufficient_quota" }]) expect(classifyEmbeddingError(value), String(value)).toBe("neutral");
  });

  it("7. the meter as declared: key embedding:openai/model:text-embedding-3-small; 240 a minute, 3 failures, 60 s, 1 h; a refusal throws EmbeddingAdmissionRefused (code, reason, retryAtMs) before any provider call; admission-control.ts gains no runtime import; embeddings.ts is unchanged (one client, no maxRetries: the SDK's own retries sit below the meter)", async () => { // [B24-closeout, 2026-10-10] superseded: B24-C1's record, artifacts/ai-control-plane-b24/observability-and-replay.md:338.
    startCase(7);
    const control = await import("@/app/lib/acquisition/admission-control");
    const admission = await import("@/app/lib/embedding-admission");
    expect(control.admissionKeyString(admission.EMBEDDING_ADMISSION_KEY)).toBe("embedding:openai/model:text-embedding-3-small");
    expect(control.EMBEDDING_ADMISSION).toEqual({ requestsPerMinute: 240, consecutiveFailuresToOpen: 3, rateLimitOpenMs: 60_000, quotaOpenMs: 3_600_000 });
    expect(Object.isFrozen(control.EMBEDDING_ADMISSION)).toBe(true);
    failWith(providerError(429));
    await expect(admission.admittedEmbedQuery("res", { purpose: "interactive" })).rejects.toMatchObject({ status: 429 });
    const before = fakes.state.calls;
    const refusal = await admission.admittedEmbedQuery("res", { purpose: "interactive" }).then(() => null, (error: unknown) => error);
    expect(refusal).toBeInstanceOf(admission.EmbeddingAdmissionRefused);
    expect(refusal).toMatchObject({ code: "EMBEDDING_ADMISSION_PAUSED", reason: "breaker_open", retryAtMs: Date.now() + 60_000 });
    expect(fakes.state.calls).toBe(before);
    const source = read("app/lib/acquisition/admission-control.ts");
    expect([...source.matchAll(/^import (?!type )[^;]* from "([^"]+)";/gm)].map((match) => match[1])).toEqual(["./source-registry"]);
    const embeddings = read("app/lib/embeddings.ts");
    expect(embeddings).toContain("  client = new OpenAI({ apiKey });");
    expect(embeddings).not.toMatch(/maxRetries|admission/);
    expect(read("app/lib/embedding-admission.ts")).not.toMatch(/from "openai"|@anthropic-ai/);
  });

  it("8. [B24-A3 review, 2026-10-08] tests-01: an outcome recorded while the breaker is open belongs to a call admitted before the opening and neither closes nor re-opens it - two calls admitted together, A's provider 429 opens the breaker, B's later success leaves it open, and the next call is refused with no provider call", { timeout: 30_000 }, async () => {
    startCase(8);
    const { EMBEDDING_ADMISSION_KEY, EmbeddingAdmissionRefused, admittedEmbedQuery } = await import("@/app/lib/embedding-admission");
    const { currentEmbeddingPause } = await import("@/app/lib/acquisition/admission-control");
    const held: Array<{ resolve: (vector: number[]) => void; reject: (error: unknown) => void }> = [];
    fakes.state.behaviour = () => new Promise<number[]>((resolve, reject) => { held.push({ resolve, reject }); });
    const a = admittedEmbedQuery("a", { purpose: "interactive" }).then(() => "resolved", (error: unknown) => error);
    const b = admittedEmbedQuery("b", { purpose: "interactive" }).then(() => "resolved", (error: unknown) => error);
    await vi.waitFor(() => expect(held.length).toBeGreaterThanOrEqual(2));
    expect(fakes.state.calls).toBe(2);
    held[0]!.reject(providerError(429, "rate_limit_exceeded"));
    expect(await a).toMatchObject({ status: 429 });
    expect(currentEmbeddingPause(EMBEDDING_ADMISSION_KEY)).not.toBeNull();
    held[1]!.resolve(new Array(1536).fill(0.1));
    expect(await b).toBe("resolved");
    expect(currentEmbeddingPause(EMBEDDING_ADMISSION_KEY), "B's late success must not close the breaker A opened").not.toBeNull();
    succeed();
    const refused = await admittedEmbedQuery("c", { purpose: "interactive" }).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(EmbeddingAdmissionRefused);
    expect((await footprint()).status).toBe(429);
    expect(fakes.state.calls).toBe(2);
  });

  it("9. [B24-A3 review, 2026-10-08] regressions-1: the meter reads a clock the fixture runtime does not freeze - with the browser job's frozen clock installed, a minute's 240 calls pause the meter and, once the real clock has moved 61 s (the frozen one has not), the next call reaches the provider again", { timeout: 60_000 }, async () => {
    startCase(9);
    const start = Date.now();
    const clock = await import("@/app/lib/fixture-runtime/clock");
    expect(clock.installFixtureClock({ SIRKIT_FIXTURE_RUNTIME: "blinker", SIRKIT_AUTH_MODE: "local_dev", NODE_ENV: "development", SIRKIT_FIXTURE_CLOCK: new Date(start).toISOString() })).not.toBeNull(); // frozen at this case's start, so no earlier window is in its future
    try {
      const frozen = Date.now();
      expect(frozen).toBe(start);
      for (let index = 0; index < PER_MINUTE; index += 1) await parts();
      expect(fakes.state.calls).toBe(PER_MINUTE);
      const paused = await footprint();
      expect(paused.status).toBe(429);
      expect(Number(paused.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
      expect(Number(paused.headers.get("Retry-After"))).toBeLessThanOrEqual(60);
      vi.setSystemTime(start + 61_000); // the faked real clock moves; the fixture runtime's frozen Date.now() does not
      expect(Date.now()).toBe(frozen);
      expect((await footprint()).status).toBe(200);
      expect(fakes.state.calls).toBe(PER_MINUTE + 1);
    } finally {
      clock.uninstallFixtureClock();
    }
  });
});
