/**
 * [PR-L6, 2026-10-19] L.6 part 2, item 5 (limit-and-stall-map.md section 7): the production catalog's CATALOG SLOTS - an abort-aware
 * process semaphore that keeps concurrent catalog reads from taking the database pool the worker's durable store (claims, lease renewals
 * every 15 s, checkpoint commits) shares.
 *
 *  1. the size is `min(4, max(1, SIRKIT_DB_POOL_MAX - 3))`, read as db/client.ts reads the pool (8 by default); SIRKIT_CATALOG_SEARCH_
 *     CONCURRENCY may only LOWER it (a larger value, zero or text is ignored); the production port is built with it;
 *  2. three slices of eight parallel searches never have more than the slot count in flight, and every search completes;
 *  3. a waiter whose signal aborts leaves the queue at once and never takes a slot; the next waiter gets the freed one;
 *  4. a slice whose search waits for a slot past the slice window YIELDS at its window - never a failed block - and leaves no waiter.
 *
 * Pure seams and the slice core with a fake catalog; no provider, no database, no network.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({ runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })), formatErcFeedback: vi.fn(() => "") }));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { CATALOG_SEARCH_CONCURRENCY_ENV, CatalogSlots, resolveCatalogSearchConcurrency } from "@/app/lib/schematic/catalog-slots";
import { runBlockSlice, type BuildCatalogPort } from "@/app/lib/schematic/build-loop-slice";
import { productionCatalogSlots } from "@/app/lib/build-loop";
import { generationSliceId, generationTaskId } from "@/app/lib/generation-task/contracts";
import type { AiPartResult } from "@/app/lib/parts-search";
import type { LLMRequest, LLMResponse } from "@/app/lib/llm/types";

const tick = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

describe("[PR-L6] the production catalog's slots (item 5)", () => {
  it("1. min(4, max(1, pool - 3)), lowered - never raised - by SIRKIT_CATALOG_SEARCH_CONCURRENCY; the production port uses it", () => {
    expect(CATALOG_SEARCH_CONCURRENCY_ENV).toBe("SIRKIT_CATALOG_SEARCH_CONCURRENCY");
    expect(resolveCatalogSearchConcurrency({})).toBe(4); // pool 8 by default: min(4, 5)
    expect(resolveCatalogSearchConcurrency({ SIRKIT_DB_POOL_MAX: "5" })).toBe(2);
    expect(resolveCatalogSearchConcurrency({ SIRKIT_DB_POOL_MAX: "3" })).toBe(1);
    expect(resolveCatalogSearchConcurrency({ SIRKIT_DB_POOL_MAX: "1" })).toBe(1);
    expect(resolveCatalogSearchConcurrency({ SIRKIT_DB_POOL_MAX: "40" })).toBe(4);
    expect(resolveCatalogSearchConcurrency({ SIRKIT_DB_POOL_MAX: "lots" })).toBe(4);
    expect(resolveCatalogSearchConcurrency({ [CATALOG_SEARCH_CONCURRENCY_ENV]: "2" })).toBe(2);
    expect(resolveCatalogSearchConcurrency({ [CATALOG_SEARCH_CONCURRENCY_ENV]: " 1 " })).toBe(1);
    for (const ignored of ["9", "4", "0", "-1", "two", ""]) expect(resolveCatalogSearchConcurrency({ [CATALOG_SEARCH_CONCURRENCY_ENV]: ignored }), ignored).toBe(4);
    expect(resolveCatalogSearchConcurrency({ SIRKIT_DB_POOL_MAX: "5", [CATALOG_SEARCH_CONCURRENCY_ENV]: "3" })).toBe(2); // never above the pool's share
    expect(() => new CatalogSlots(0)).toThrow(/CATALOG_SLOTS_SIZE_INVALID/);
    expect(productionCatalogSlots().size).toBe(resolveCatalogSearchConcurrency());
  });

  it("2. three slices of eight parallel searches never exceed the slot count, and every search completes", async () => {
    const slots = new CatalogSlots(4);
    let inFlight = 0, peak = 0;
    const search = async (n: number): Promise<number> => slots.run(undefined, async () => { inFlight += 1; peak = Math.max(peak, inFlight); await tick(2 + (n % 3)); inFlight -= 1; return n; });
    const slices = [0, 1, 2].map((slice) => Promise.all(Array.from({ length: 8 }, (_, index) => search(slice * 8 + index))));
    const results = (await Promise.all(slices)).flat();
    expect(results.sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, index) => index));
    expect(peak).toBe(4);
    expect(slots.peak).toBe(4);
    expect([slots.inUse, slots.waiting]).toEqual([0, 0]);
  });

  it("3. an aborted waiter leaves the queue and never takes a slot; the next waiter gets the freed slot", async () => {
    const slots = new CatalogSlots(1);
    let release!: () => void;
    const holder = slots.run(undefined, () => new Promise<string>((resolve) => { release = () => resolve("held"); }));
    const aborted = new AbortController();
    const waiter = slots.run(aborted.signal, async () => "never");
    const next = slots.run(undefined, async () => "next");
    expect([slots.inUse, slots.waiting]).toEqual([1, 2]);
    aborted.abort(new Error("the slice window ended"));
    await expect(waiter).rejects.toThrow("the slice window ended");
    expect(slots.waiting).toBe(1);
    release();
    expect(await holder).toBe("held");
    expect(await next).toBe("next");
    expect([slots.inUse, slots.waiting]).toEqual([0, 0]);
    await expect(slots.run(aborted.signal, async () => "late")).rejects.toThrow("the slice window ended"); // an aborted signal never queues
  });

  it("4. a slice waiting for a slot past its window yields at the window (never a failure) and leaves no waiter", async () => {
    const slots = new CatalogSlots(1);
    let release!: () => void;
    const occupied = slots.run(undefined, () => new Promise<void>((resolve) => { release = resolve; })); // another slice's long search
    const part: AiPartResult = { partId: "p-1", name: "Offline part", mpn: null, description: null, mainCategory: "Other", pins: [{ number: "1", name: "A", type: "passive" }], lifecycleStatus: "active", similarity: 1 };
    const catalog: BuildCatalogPort = {
      identity: { catalogProfile: "fixture-scripted", embeddingModel: "text-embedding-3-small" },
      searchParts: (_query, _category, _limit, options) => slots.run(options.signal, async () => [part]),
      findAlternates: async () => [],
      partsByIds: async () => [part],
    };
    const llm = { generate: async (request: LLMRequest): Promise<LLMResponse> => ({ provider: request.provider, model: "offline", text: "", toolCalls: [{ id: "call_search", name: "search_parts", input: { query: "anything" } }], stopReason: "tool_use", usage: { inputTokens: 10, outputTokens: 5 } }) };
    const task = generationTaskId({ tenantId: "tenant-l6", projectId: "project-l6-slots", branchId: "main" }, "user-l6", "00000000-0000-4000-8000-0000000006c4");
    const outcome = await runBlockSlice({
      block: { systemPrompt: "Design.", userMessage: "Block: Any\n\nA part.", allowEmpty: false }, checkpoint: null,
      identity: { taskId: task, blockId: "b1", sliceId: generationSliceId(task, 2), attempt: 1, fence: 1, strategy: "S1-baseline" },
      policy: { maxTurns: 6, windowDeadlineAt: Date.now() + 150 }, provider: "openai", llm, catalog,
    });
    expect(outcome).toMatchObject({ status: "yielded", reason: "window", stage: "search", turns: 0 });
    expect(slots.waiting).toBe(0); // the window's abort took the waiter out of the queue
    release();
    await occupied;
    expect(slots.inUse).toBe(0);
  });
});
