/** Real catalog retrieval/rerank code with fake DB, embedding and SDK seams.
 * Cancellation stops follow-up work; already-running SQL/embedding work is
 * deliberately not claimed to have been cancelled. No live services are used. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAlternatesForAI, searchPartsForAI } from "../parts-search";

const harness = vi.hoisted(() => ({
  dbAccess: vi.fn(),
  select: vi.fn(),
  embed: vi.fn(),
  rerank: vi.fn(),
}));

vi.mock("@/app/lib/db/client", () => ({
  getDb: () => {
    harness.dbAccess();
    return { select: (...args: unknown[]) => harness.select(...args) };
  },
}));
vi.mock("@/app/lib/embeddings", () => ({
  EMBEDDING_DIMENSIONS: 1_536,
  embedQuery: (...args: unknown[]) => harness.embed(...args),
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class OfflineAnthropic {
    messages = { create: (...args: unknown[]) => harness.rerank(...args) };
  },
}));
vi.mock("@/app/lib/observability/llm-call-record", () => ({
  recordModelCall: <T>(_options: unknown, call: () => Promise<T>) => call(),
}));

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ROWS = [A, B].map((id, index) => ({
  id,
  name: "Offline connector " + index,
  mpn: "OFFLINE-" + index,
  description: "Synthetic catalog row, never a component authority claim.",
  mainCategory: "Connector",
  pins: [{ number: "1", name: "P1", type: "passive" }],
  lifecycleStatus: "active",
  similarity: 0.9 - index * 0.1,
}));
// A row returned by the already-filtered authority query: production still
// owns its selectable-revision SQL and this test never pretends to publish it.
const LINKS = [{ partId: A, valueKey: "fixture", footprintFullName: "Test:Connector" }];
const RANKING = {
  model: "offline-rerank",
  content: [{ type: "tool_use", id: "rank-1", name: "rank_parts", input: { ranking: [1, 0] } }],
  usage: { input_tokens: 10, output_tokens: 2 },
};
let queryResults: Array<unknown[] | Promise<unknown[]>>;

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
  for (let turn = 0; turn < 60 && !predicate(); turn++) await Promise.resolve();
  expect(predicate(), "The scripted async stage must actually have started.").toBe(true);
}

const search = (signal?: AbortSignal) => searchPartsForAI("motor connector", undefined, 5, signal ? { signal } : undefined);

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "offline-test-placeholder");
  harness.dbAccess.mockReset();
  harness.embed.mockReset().mockResolvedValue([0.1, 0.2]);
  harness.rerank.mockReset().mockResolvedValue(RANKING);
  queryResults = [ROWS, ROWS, [], LINKS]; // vector, lexical, authority, authority annotation
  harness.select.mockReset().mockImplementation(() => {
    const next = queryResults.shift();
    if (next === undefined) throw new Error("Unexpected extra catalog query.");
    return queryChain(next);
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("catalog follow-up cancellation", () => {
  it("a pre-aborted search performs zero embedding, DB or rerank work and never echoes the abort reason", async () => {
    const controller = new AbortController();
    controller.abort(new Error("PRIVATE_ABORT_REASON"));
    const result = search(controller.signal);
    await expect(result).rejects.toMatchObject({ name: "AbortError", message: "The catalog lookup was cancelled." });
    expect(harness.dbAccess).not.toHaveBeenCalled();
    expect(harness.embed).not.toHaveBeenCalled();
    expect(harness.select).not.toHaveBeenCalled();
    expect(harness.rerank).not.toHaveBeenCalled();
  });

  it.each(["resolved", "rejected"] as const)("a late %s embedding cannot start any recall query or fallback", async (settlement) => {
    const pending = deferred<number[]>();
    harness.embed.mockReturnValue(pending.promise);
    const controller = new AbortController();
    const result = search(controller.signal);
    const refusal = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await until(() => harness.embed.mock.calls.length === 1);
    controller.abort();
    if (settlement === "resolved") pending.resolve([0.1, 0.2]);
    else pending.reject(new Error("Embedding was unavailable."));
    await refusal;
    expect(harness.select).not.toHaveBeenCalled();
    expect(harness.rerank).not.toHaveBeenCalled();
  });

  it.each([
    [1, "vector recall"],
    [2, "lexical recall"],
    [3, "authority recall"],
    [4, "authority annotation"],
  ] as const)("a late DB stage %i (%s) cannot start the next query or paid rerank", async (stage, label) => { // [PR-L step 0, 2026-10-17] tsc: the case takes both tuple members (the label names the assertion)
    const pending = deferred<unknown[]>();
    const rows = queryResults[stage - 1] as unknown[];
    queryResults[stage - 1] = pending.promise;
    const controller = new AbortController();
    const result = search(controller.signal);
    const refusal = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await until(() => harness.select.mock.calls.length === stage);
    controller.abort();
    pending.resolve(rows);
    await refusal;
    expect(harness.select, label).toHaveBeenCalledTimes(stage);
    expect(harness.rerank).not.toHaveBeenCalled();
  });

  it.each(["resolved", "rejected"] as const)("a late %s rerank is refused instead of being accepted or falling back", async (settlement) => {
    const pending = deferred<typeof RANKING>();
    harness.rerank.mockReturnValue(pending.promise);
    const controller = new AbortController();
    const result = search(controller.signal);
    const refusal = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await until(() => harness.rerank.mock.calls.length === 1);
    expect(harness.rerank.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
    controller.abort();
    if (settlement === "resolved") pending.resolve(RANKING);
    else pending.reject(new Error("Rerank was unavailable."));
    await refusal;
    expect(harness.select).toHaveBeenCalledTimes(4);
    expect(harness.rerank).toHaveBeenCalledTimes(1);
  });

  it("keeps no-signal SDK call arity, payload, ranking and authority annotations unchanged", async () => {
    const baseline = await search();
    expect(harness.rerank.mock.calls[0]).toHaveLength(1);
    const body = harness.rerank.mock.calls[0]?.[0];
    expect(body).toMatchObject({ model: "claude-haiku-4-5", max_tokens: 256, tool_choice: { type: "tool", name: "rank_parts" } });
    expect(baseline.map((part) => part.partId)).toEqual([B, A]);
    expect(baseline.find((part) => part.partId === A)).toMatchObject({ physicalAuthority: "verified", orderableValues: ["fixture"], verifiedFootprint: "Test:Connector" });
    queryResults = [ROWS, ROWS, [], LINKS];
    const controller = new AbortController();
    const withSignal = await search(controller.signal);
    expect(withSignal).toEqual(baseline);
    expect(harness.rerank.mock.calls[1]).toHaveLength(2);
    expect(harness.rerank.mock.calls[1]?.[0]).toEqual(body);
    expect(harness.rerank.mock.calls[1]?.[1]).toEqual({ signal: controller.signal });
  });

  it.each(["embedding", "rerank"] as const)("a non-abort %s failure preserves the existing best-effort fallback", async (failedStage) => {
    if (failedStage === "embedding") {
      harness.embed.mockRejectedValue(new Error("Offline embedding failure."));
      queryResults = [ROWS, [], LINKS]; // vector recall is unavailable, but lexical and authority still run
    } else harness.rerank.mockRejectedValue(new Error("Offline rerank failure."));
    const result = await search(new AbortController().signal);
    expect(result).toHaveLength(2);
    expect(new Set(result.map((part) => part.partId))).toEqual(new Set([A, B]));
    expect(result.find((part) => part.partId === A)).toMatchObject({ physicalAuthority: "verified", orderableValues: ["fixture"] });
    expect(harness.select).toHaveBeenCalledTimes(failedStage === "embedding" ? 3 : 4);
    expect(harness.rerank).toHaveBeenCalledTimes(1);
  });

  it("a pre-aborted alternates lookup performs no DB work", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchAlternatesForAI(A, "all", 5, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(harness.dbAccess).not.toHaveBeenCalled();
    expect(harness.select).not.toHaveBeenCalled();
  });

  it("an alternates query completing after abort does not return results for follow-up loading", async () => {
    const pending = deferred<unknown[]>();
    queryResults = [pending.promise];
    const controller = new AbortController();
    const result = fetchAlternatesForAI(A, "all", 5, { signal: controller.signal });
    const refusal = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await until(() => harness.select.mock.calls.length === 1);
    controller.abort();
    pending.resolve([]);
    await refusal;
    expect(harness.select).toHaveBeenCalledTimes(1);
  });
});
