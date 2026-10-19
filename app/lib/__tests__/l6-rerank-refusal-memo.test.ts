/**
 * [PR-L, 2026-10-17] Runbook L.6, limit-and-stall-map.md section 4 (root cause 3): the optional reranker's refusal is remembered.
 *
 * Before: `rerankParts` called the reranker on every search with two or more candidates; it was refused `insufficient_quota` on all
 * 322 calls of 2026-10-17 (119-628 ms each) and nothing remembered it. Now a non-transient refusal (quota or credit, authentication,
 * model access) arms a `RerankRefusalMemo`: later searches skip the call for a bounded cooldown and return the relevance-banded
 * fused order flagged `ranking: "fused"`; after the cooldown ONE search probes, so a genuine recovery is found. Transient failures
 * are never remembered. The REAL `searchPartsForAI` runs over a fake catalog (the cancellation suite's query proxy), a fake
 * embedding and a fake Anthropic SDK; nothing reaches a network or a database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processRerankRefusalMemo, RERANK_REFUSAL_COOLDOWN_MS, RerankRefusalMemo, searchPartsForAI, type PartsSearchOutcome } from "../parts-search";

const harness = vi.hoisted(() => ({ select: vi.fn(), embed: vi.fn(), rerank: vi.fn() }));

vi.mock("@/app/lib/db/client", () => ({ getDb: () => ({ select: (...args: unknown[]) => harness.select(...args) }) }));
vi.mock("@/app/lib/embeddings", () => ({ EMBEDDING_DIMENSIONS: 1_536, embedQuery: (...args: unknown[]) => harness.embed(...args) }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class OfflineAnthropic { messages = { create: (...args: unknown[]) => harness.rerank(...args) }; } }));
vi.mock("@/app/lib/observability/llm-call-record", () => ({ recordModelCall: <T>(_options: unknown, call: () => Promise<T>) => call() }));

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
const ROWS = ids.map((id, index) => ({
  id, name: `Offline motor driver ${index}`, mpn: `OFFLINE-${index}`, description: "Synthetic catalog row, never a component authority claim.",
  mainCategory: "Drivers", pins: [{ number: "1", name: "P1", type: "passive" }], lifecycleStatus: "active", similarity: 0.9 - index * 0.1,
}));
const RANKING = { model: "offline-rerank", content: [{ type: "tool_use", id: "rank-1", name: "rank_parts", input: { ranking: [2, 1, 0] } }], usage: { input_tokens: 10, output_tokens: 2 } };

/** An Anthropic-shaped HTTP failure, as the SDK throws it (llm/errors.ts reads `status` and the nested `error.error`). */
function anthropicError(status: number, type: string, message: string): Error {
  return Object.assign(new Error(`${status} ${message}`), { status, error: { type: "error", error: { type, message } } });
}
const CREDIT = () => anthropicError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.");

function queryChain(answer: unknown[] | Promise<unknown[]>): unknown {
  const chain: unknown = new Proxy({}, {
    get: (_target, property) => property === "then"
      ? (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(answer).then(resolve, reject)
      : () => chain,
  });
  return chain;
}
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 100 && !predicate(); turn++) await Promise.resolve();
  expect(predicate(), "the scripted async stage must actually have started").toBe(true);
}

let clock = Date.UTC(2026, 9, 17, 12);
/** Every search reads four catalog queries in order: vector, lexical, authority recall, authority annotation. */
beforeEach(() => {
  clock = Date.UTC(2026, 9, 17, 12);
  vi.stubEnv("ANTHROPIC_API_KEY", "offline-test-placeholder");
  harness.embed.mockReset().mockResolvedValue([0.1, 0.2]);
  harness.rerank.mockReset();
  let queries = 0;
  harness.select.mockReset().mockImplementation(() => queryChain([ROWS, ROWS, [], []][queries++ % 4]!));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  processRerankRefusalMemo().recordAnswer(); // the process memo is module state: each case starts with nothing remembered
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function search(memo?: RerankRefusalMemo, signal?: AbortSignal): Promise<{ ids: string[]; outcome: PartsSearchOutcome }> {
  let outcome: PartsSearchOutcome | null = null;
  const results = await searchPartsForAI("motor driver", undefined, 5, { ...(memo ? { rerankMemo: memo } : {}), ...(signal ? { signal } : {}), onOutcome: (seen) => { outcome = seen; } });
  expect(outcome, "every completed search reports its outcome").not.toBeNull();
  return { ids: results.map((part) => part.partId), outcome: outcome! };
}

describe("[PR-L L.6] RerankRefusalMemo on its own", () => {
  it("call -> refusal remembered (skip) -> after the cooldown ONE probe while others skip -> an answer clears it; release frees a probe", () => {
    const memo = new RerankRefusalMemo({ cooldownMs: 1_000, now: () => clock });
    expect(memo.cooldownMs).toBe(1_000);
    expect(new RerankRefusalMemo().cooldownMs).toBe(RERANK_REFUSAL_COOLDOWN_MS);
    expect(RERANK_REFUSAL_COOLDOWN_MS).toBe(600_000);
    expect(memo.admit()).toEqual({ decision: "call" });
    memo.recordRefusal("insufficient_quota");
    expect(memo.remembered()).toEqual({ reason: "insufficient_quota", probeAfterMs: clock + 1_000 });
    expect(memo.admit()).toEqual({ decision: "skip", reason: "insufficient_quota", probeAfterMs: clock + 1_000 });
    clock += 999;
    expect(memo.admit().decision).toBe("skip");
    clock += 1;
    expect(memo.admit()).toEqual({ decision: "probe" });
    expect(memo.admit().decision, "a second search while the probe runs").toBe("skip");
    memo.release(false);
    expect(memo.admit().decision, "only the probe itself releases the probe").toBe("skip");
    memo.release(true);
    expect(memo.admit()).toEqual({ decision: "probe" });
    memo.recordRefusal("authentication");
    expect(memo.remembered()).toEqual({ reason: "authentication", probeAfterMs: clock + 1_000 });
    clock += 1_000;
    expect(memo.admit().decision).toBe("probe");
    memo.recordAnswer();
    expect(memo.remembered()).toBeNull();
    expect(memo.admit()).toEqual({ decision: "call" });
  });
});

describe("[PR-L L.6] searchPartsForAI remembers a non-transient rerank refusal", () => {
  it("a credit refusal: the reranker is called ONCE, then skipped for the cooldown; every result keeps the fused order and says so", async () => {
    harness.rerank.mockRejectedValue(CREDIT());
    const memo = new RerankRefusalMemo({ now: () => clock });
    const first = await search(memo);
    expect(harness.rerank).toHaveBeenCalledTimes(1);
    expect(harness.rerank.mock.calls[0]?.[0]).toMatchObject({ model: "claude-haiku-4-5", max_tokens: 256 }); // the provider and model are unchanged
    expect(first.outcome).toEqual({ category: { status: "none", requested: null, applied: null, candidates: [], note: null }, ranking: "fused", rerank: { state: "refused", reason: "insufficient_quota" }, embedding: "called" }); // [PR-L6, 2026-10-19] pin move: + embedding "called" - the outcome now says how the query embedding was obtained (L.6 part 2 item 1; l6-embedding-cache)
    expect(first.ids).toEqual(ids);
    for (let index = 0; index < 5; index++) {
      clock += 60_000;
      const next = await search(memo);
      expect(next.ids).toEqual(first.ids);
      expect(next.outcome.ranking).toBe("fused");
      expect(next.outcome.rerank).toEqual({ state: "skipped", reason: "insufficient_quota", probeAfterMs: Date.UTC(2026, 9, 17, 12) + RERANK_REFUSAL_COOLDOWN_MS });
    }
    expect(harness.rerank, "five more searches, no further call").toHaveBeenCalledTimes(1);
    expect(harness.select, "the catalog is still searched every time").toHaveBeenCalledTimes(24);
    const warnings = vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));
    expect(warnings.filter((line) => line.includes("[parts-search] the optional reranker was refused (insufficient_quota)"))).toHaveLength(1);
    expect(warnings.join("\n")).not.toMatch(/offline-test-placeholder|credit balance/);
  });

  it("after the cooldown ONE search probes while a concurrent one skips; a renewed refusal re-arms; a later answer is a genuine recovery", async () => {
    harness.rerank.mockRejectedValue(CREDIT());
    const memo = new RerankRefusalMemo({ cooldownMs: 1_000, now: () => clock });
    await search(memo);
    clock += 1_000;
    const probe = deferred<typeof RANKING>();
    harness.rerank.mockReturnValueOnce(probe.promise);
    const probing = search(memo);
    await until(() => harness.rerank.mock.calls.length === 2);
    const concurrent = await search(memo);
    expect(concurrent.outcome.rerank.state, "a search while the probe is in flight skips").toBe("skipped");
    expect(harness.rerank).toHaveBeenCalledTimes(2);
    probe.reject(CREDIT());
    expect((await probing).outcome.rerank).toEqual({ state: "refused", reason: "insufficient_quota" });
    expect(memo.remembered()).toEqual({ reason: "insufficient_quota", probeAfterMs: clock + 1_000 });
    expect((await search(memo)).outcome.rerank.state).toBe("skipped");
    expect(harness.rerank).toHaveBeenCalledTimes(2);
    // the owner adds credits: the next probe is answered, the memo clears, and every later search reranks again
    harness.rerank.mockResolvedValue(RANKING);
    clock += 1_000;
    const recovered = await search(memo);
    expect(recovered.outcome).toMatchObject({ ranking: "reranked", rerank: { state: "used" } });
    expect(recovered.ids).toEqual([ids[2], ids[1], ids[0]]);
    expect(memo.remembered()).toBeNull();
    const after = await search(memo);
    expect(after.outcome.rerank.state).toBe("used");
    expect(harness.rerank).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["authentication", () => anthropicError(401, "authentication_error", "invalid x-api-key")],
    ["model_access", () => anthropicError(404, "not_found_error", "model: claude-haiku-4-5")],
  ] as const)("a %s refusal is remembered too", async (reason, error) => {
    harness.rerank.mockRejectedValue(error());
    const memo = new RerankRefusalMemo({ now: () => clock });
    expect((await search(memo)).outcome.rerank).toEqual({ state: "refused", reason });
    expect((await search(memo)).outcome.rerank).toMatchObject({ state: "skipped", reason });
    expect(harness.rerank).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a rate limit", () => anthropicError(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit")],
    ["an overload", () => anthropicError(529, "overloaded_error", "Overloaded")],
    ["an unknown failure", () => new Error("Offline rerank failure.")],
  ] as const)("%s is transient: never remembered, the reranker is called on every search (the existing best-effort fallback)", async (_label, error) => {
    harness.rerank.mockRejectedValue(error());
    const memo = new RerankRefusalMemo({ now: () => clock });
    for (let index = 0; index < 3; index++) expect((await search(memo)).outcome).toMatchObject({ ranking: "fused", rerank: { state: "failed" } });
    expect(harness.rerank).toHaveBeenCalledTimes(3);
    expect(memo.remembered()).toBeNull();
  });

  it("an abort during a probe releases it (the next search probes) and is never remembered as a refusal", async () => {
    harness.rerank.mockRejectedValue(CREDIT());
    const memo = new RerankRefusalMemo({ cooldownMs: 1_000, now: () => clock });
    await search(memo);
    clock += 1_000;
    const pending = deferred<typeof RANKING>();
    harness.rerank.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const aborted = search(memo, controller.signal);
    const refusal = expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    await until(() => harness.rerank.mock.calls.length === 2);
    controller.abort();
    pending.reject(new DOMException("aborted", "AbortError") as unknown as Error);
    await refusal;
    expect(memo.remembered()?.probeAfterMs, "the refusal stays remembered, unchanged").toBe(clock);
    harness.rerank.mockResolvedValue(RANKING);
    expect((await search(memo)).outcome.rerank.state, "the next search probes and is answered").toBe("used");
    expect(harness.rerank).toHaveBeenCalledTimes(3);
  });

  it("without an injected memo the process-wide one remembers the refusal across searches", async () => {
    harness.rerank.mockRejectedValue(CREDIT());
    expect(processRerankRefusalMemo().remembered()).toBeNull();
    expect((await search()).outcome.rerank.state).toBe("refused");
    expect(processRerankRefusalMemo().remembered()?.reason).toBe("insufficient_quota");
    expect((await search()).outcome.rerank.state).toBe("skipped");
    expect(harness.rerank).toHaveBeenCalledTimes(1);
  });
});
