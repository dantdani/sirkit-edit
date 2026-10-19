/**
 * [PR-L6, 2026-10-19] L.6 part 2, items 2a-2c (l6-remaining.md): a task's cached catalog lookups.
 *
 *  1. 2a: under the postgres profile the search key reads the RESOLVED category - "MOSFETs", "mosfet" and "Transistors" are one SQL
 *     filter and one key; an unrecognised name (no filter) keys as no category. The fixture profiles filter on their raw names and keep
 *     the raw key. 2b: the catalog epoch is part of the key (absent: the key it always was);
 *  2. the slice core's checkpoint search key IS the facts key (one key space, so blocks phrasing a category differently share answers);
 *  3. 2c: a cache hit is never silent - its tool result carries the cache note beside the same results - and it makes zero catalog,
 *     embedding or reranker calls.
 *
 * The slice core with a scripted model and a fake postgres-profile catalog; no provider, no database, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/erc", () => ({
  runErc: vi.fn(() => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 })),
  formatErcFeedback: vi.fn(() => "ERC: offline fixture feedback."),
}));
vi.mock("@/lib/kg", () => ({ kgDesignNotes: vi.fn(() => null) }));

import { resolveMainCategory } from "../../kicad/categories";
import type { LLMRequest, LLMResponse } from "../../llm/types";
import type { AiPartResult, PartsSearchOutcome, QueryEmbedding } from "../../parts-search";
import { BUILD_CACHE_NOTE, runBlockSlice, type BuildCatalogPort } from "../../schematic/build-loop-slice";
import { applyGenerationFactsDelta, generationSearchKey, generationSliceId, generationTaskId } from "../contracts";
import { FIXTURE_CATALOG_EPOCH, FactsCatalogPort, catalogEpochOf } from "../worker/accounting";
import { PARTS, reply, search, submit } from "./_l3-worker-fixtures";

const MODEL = "text-embedding-3-small";
const key = (query: string, category: string | null, profile: "postgres" | "fixture-scripted" | "fixture-blinker" = "postgres", catalogEpoch?: string) => generationSearchKey({ query, category, catalogProfile: profile, embeddingModel: MODEL, ...(catalogEpoch ? { catalogEpoch } : {}) });

/** A catalog that answers as parts-search does: the category resolved against the vocabulary, one embedding per search it is asked (or
 *  through a caller's embedder), a reranker that refuses - every call counted. */
class PostgresLikeCatalog implements BuildCatalogPort {
  readonly identity = { catalogProfile: "postgres" as const, embeddingModel: MODEL };
  readonly calls = { search: 0, embed: 0, rerank: 0 };
  async searchParts(query: string, category: string | undefined, limit: number, options: { signal?: AbortSignal; onOutcome?: (outcome: PartsSearchOutcome) => void; embedQuery?: (text: string) => Promise<QueryEmbedding> }): Promise<AiPartResult[]> {
    this.calls.search += 1;
    const resolution = resolveMainCategory(category);
    let embedding: PartsSearchOutcome["embedding"] = "called";
    if (options.embedQuery) embedding = (await options.embedQuery(query)).cached ? "cached" : "called"; else this.calls.embed += 1;
    this.calls.rerank += 1;
    options.onOutcome?.({ category: resolution, ranking: "fused", rerank: { state: "refused", reason: "insufficient_quota" }, embedding });
    return Object.values(PARTS).filter((part) => resolution.applied === null || part.mainCategory === resolution.applied).filter((part) => /mosfet|transistor/i.test(query) ? part.partId === "p-fet" : true).slice(0, limit).map((part) => structuredClone(part));
  }
  async findAlternates() { return []; }
  async partsByIds(ids: string[]) { return Object.values(PARTS).filter((part) => ids.includes(part.partId)).map((part) => structuredClone(part)); }
  async embedQuery(): Promise<number[]> { this.calls.embed += 1; return [0.1, 0.2]; }
}

const TASK = generationTaskId({ tenantId: "tenant-l6", projectId: "project-l6-keys", branchId: "main" }, "user-l6", "00000000-0000-4000-8000-0000000006a1");
const identity = { taskId: TASK, blockId: "b1" as const, sliceId: generationSliceId(TASK, 2), attempt: 1, fence: 1, strategy: "S1-baseline" as const };
const FET_NETLIST = { components: [{ refDes: "Q1", partId: "p-fet", value: "N-MOSFET", role: "output" }], connections: [{ kind: "label", pin: "Q1.S", labelName: "GND", labelKind: "ground" }, { kind: "label", pin: "Q1.G", labelName: "PWM1" }, { kind: "label", pin: "Q1.D", labelName: "MOTOR1" }], explanation: "One low-side channel." };

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => undefined); vi.spyOn(console, "log").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe("[PR-L6] a task's cached catalog lookups: one key space, the catalog's identity, never a silent hit (items 2a-2c)", () => {
  it("1. postgres keys the resolved category; the fixture profiles keep the raw name; the epoch is part of the key", async () => {
    for (const [a, b] of [["MOSFETs", "Transistors"], ["mosfet", "Transistors"], [" transistors ", "Transistors"], ["Resistors", "Passive Components"]] as const) expect(key("logic level n-mosfet", a), `${a} = ${b}`).toBe(key("logic level n-mosfet", b));
    expect(key("logic level n-mosfet", "MOSFETs")).not.toBe(key("logic level n-mosfet", "Diodes"));
    expect(key("flight controller", "Flight controller")).toBe(key("flight controller", null)); // unrecognised: searched without a filter
    expect(key("sot-23 logic level n mosfet", "MOSFETs")).toBe(key("N MOSFET logic level, SOT 23", "Transistors")); // any word order or punctuation
    for (const profile of ["fixture-scripted", "fixture-blinker"] as const) {
      expect(key("0805 resistor", "Resistor", profile), profile).not.toBe(key("0805 resistor", "Passive Components", profile)); // the fixture's own raw names
      expect(key("0805 resistor", "Resistor", profile)).toBe(key("0805 resistor", " resistor ", profile));
    }
    expect(key("n mosfet", "Transistors", "postgres", "pg1-1-2-3-4-5")).not.toBe(key("n mosfet", "Transistors", "postgres", "pg1-1-2-3-4-6"));
    expect(key("n mosfet", "Transistors", "postgres", undefined)).toBe(generationSearchKey({ query: "n mosfet", category: "Transistors", catalogProfile: "postgres", embeddingModel: MODEL })); // no epoch: the key as it was
    // the fixture epoch is a constant; a postgres port without an epoch read keys as before; a failed read is no epoch
    expect(await catalogEpochOf({ ...new PostgresLikeCatalog(), identity: { catalogProfile: "fixture-scripted", embeddingModel: MODEL } } as unknown as BuildCatalogPort)).toBe(FIXTURE_CATALOG_EPOCH);
    expect(await catalogEpochOf(new PostgresLikeCatalog())).toBeNull();
    const failing = Object.assign(new PostgresLikeCatalog(), { catalogEpoch: async () => { throw new Error("database unavailable"); } });
    expect(await catalogEpochOf(failing)).toBeNull();
  });

  it("2. the checkpoint search key is the facts key; 3. a hit carries the cache note and makes zero catalog, embedding or reranker calls", async () => {
    const inner = new PostgresLikeCatalog();
    const catalog = new FactsCatalogPort(inner, null, "b1", () => Date.now(), { catalogEpoch: "pg1-7-0-0-0-0" });
    const requests: LLMRequest[] = [];
    const script = (turn: number): LLMResponse => turn === 1 ? reply([search("call_1", "N-channel MOSFET, SOT-23", "MOSFETs")]) : turn === 2 ? reply([search("call_2", "sot 23 n channel mosfet", "Transistors")]) : reply([submit("call_submit", FET_NETLIST)]);
    const llm = { generate: async (request: LLMRequest) => { requests.push(structuredClone({ ...request, signal: undefined })); return script(request.messages.filter((message) => message.role === "assistant").length + 1); } };
    const outcome = await runBlockSlice({ block: { systemPrompt: "Design one channel.", userMessage: "Block: Motor drivers\n\nOne low-side channel.", allowEmpty: false }, checkpoint: null, identity, policy: { maxTurns: 6 }, provider: "openai", llm, catalog });
    expect(outcome.status).toBe("submitted");
    // one search reached the catalog (one embedding, one reranker call); the second - another phrasing, another category name - did not
    expect(inner.calls).toEqual({ search: 1, embed: 1, rerank: 1 });
    expect(catalog.counts).toMatchObject({ searches: 1, cacheHits: 1, embeddingCalls: 1, rerankCalls: 1 });
    // the hit's tool result says so, beside the same results
    const hit = requests[2]!.messages[4]!.content as Array<{ type: string; output: string }>;
    const parsed = JSON.parse(hit[0]!.output) as { cacheNote: string; results: Array<{ partId: string }> };
    expect(parsed.cacheNote).toBe(BUILD_CACHE_NOTE);
    expect(parsed.results.map((entry) => entry.partId)).toEqual(["p-fet"]);
    const first = JSON.parse((requests[1]!.messages[2]!.content as Array<{ output: string }>)[0]!.output) as { categoryNote: string; results: unknown[] };
    expect(first.categoryNote).toMatch(/searched the "Transistors" category/);
    // one key space: the checkpoint's recorded searches are exactly the facts' lookups
    const facts = applyGenerationFactsDelta(null, catalog.takeDelta()!, { taskId: TASK, catalogProfile: "postgres", embeddingModel: MODEL });
    expect(Object.keys(outcome.checkpoint!.searches)).toEqual(Object.keys(facts.lookups));
    expect(Object.keys(facts.lookups)).toEqual([key("N-channel MOSFET, SOT-23", "Transistors", "postgres", "pg1-7-0-0-0-0")]);
    expect(facts.lookups[Object.keys(facts.lookups)[0]!]).toMatchObject({ catalogEpoch: "pg1-7-0-0-0-0", category: "MOSFETs" });
    // a later slice (another block) under the SAME epoch answers it from the facts with no call; under another epoch it asks again
    const sibling = new FactsCatalogPort(inner, facts, "b2", () => Date.now(), { catalogEpoch: "pg1-7-0-0-0-0" });
    await sibling.searchParts("mosfet n-channel sot-23", "mosfet", 5, {});
    expect(inner.calls.search).toBe(1);
    const moved = new FactsCatalogPort(inner, facts, "b2", () => Date.now(), { catalogEpoch: "pg1-8-0-0-0-0" });
    await moved.searchParts("mosfet n-channel sot-23", "mosfet", 5, {});
    expect(inner.calls.search).toBe(2);
  });
});
