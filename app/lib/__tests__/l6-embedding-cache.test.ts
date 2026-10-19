/**
 * [PR-L6, 2026-10-19] L.6 part 2, item 1 (limit-and-stall-map.md section 7): a generation task's PROCESS-LOCAL query-embedding cache,
 * keyed by the exact (normalized) query text and the embedding model, over the REAL `searchPartsForAI` and the real production catalog
 * port, on a migrated PostgreSQL (PGlite, pgvector) - the embedding provider faked (a counting, hashed bag-of-words vector).
 *
 *  1. S3's category-then-unfiltered re-search (the cache bypassed) reaches the catalog twice and embeds the text ONCE; the outcomes say
 *     "called" then "cached";
 *  2. word order changes the embedding key (embeddings depend on it) but not the search key;
 *  3. the task's `embeddingCalls` is what happened - the provider calls the fake counted - never one assumed per search;
 *  4. an embed aborted by the slice's signal leaves no cache entry (the next search embeds again);
 *  5. the seam is in place in `searchPartsForAI`: a caller's embedder answers instead of the module's, and the outcome says how.
 *
 * Nothing reaches a network: the database is in process and the embedder and the reranker are fakes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/app/lib/db/schema";
import { loadMigrationManifest } from "@/app/lib/db/migrations/manifest";
import { migrateDatabase } from "@/app/lib/db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "@/app/lib/db/disposable-postgres";
import { categorizeLib } from "@/app/lib/kicad/categories";

const harness = vi.hoisted(() => {
  function hashed(text: string): number[] {
    const vector = new Array<number>(1_536).fill(0);
    vector[0] = 0.05;
    for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let hash = 2_166_136_261;
      for (let index = 0; index < token.length; index++) hash = Math.imul(hash ^ token.charCodeAt(index), 16_777_619) >>> 0;
      vector[1 + (hash % 1_535)]! += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return vector.map((value) => value / norm);
  }
  return { hashed, embedded: [] as string[], hold: false };
});

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("@/app/lib/db/client", () => ({ getDb: () => orm }));
vi.mock("@/app/lib/embeddings", async (original) => ({
  ...(await original() as object),
  embedQuery: vi.fn(async (text: string, options?: { signal?: AbortSignal }) => {
    harness.embedded.push(text);
    if (harness.hold) await new Promise<never>((_resolve, reject) => { options?.signal?.addEventListener("abort", () => reject(new Error("embedding aborted")), { once: true }); });
    return harness.hashed(text);
  }),
}));

import { productionBuildCatalogPort } from "@/app/lib/build-loop";
import { generationSearchKey } from "@/app/lib/generation-task/contracts";
import { FactsCatalogPort, TaskEmbeddingCache, taskEmbeddingCache } from "@/app/lib/generation-task/worker/accounting";
import { searchPartsForAI, type PartsSearchOutcome } from "@/app/lib/parts-search";

const MODEL = "text-embedding-3-small";
const SEED: Array<[string, string, string]> = [
  ["Transistor_FET", "AO3400A", "30V Vds, 5.7A Id, logic-level N-Channel MOSFET, SOT-23"],
  ["Transistor_FET", "2N7002", "0.115A Id, 60V Vds, N-Channel MOSFET, SOT-23"],
  ["Regulator_Linear", "AMS1117-3.3", "1A Low Dropout regulator, positive, 3.3V fixed output, SOT-223"],
  ["Sensor_Motion", "MPU-6050", "6-Axis Motion Sensor, Gyroscope, Accelerometer, I2C"],
];

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  const libraries = new Map<string, string>();
  for (const [library, name, description] of SEED) {
    if (!libraries.has(library)) libraries.set(library, (await pg.db.query<{ id: string }>("INSERT INTO libraries (name, main_category) VALUES ($1, $2) RETURNING id", [library, categorizeLib(library)])).rows[0]!.id);
    await pg.db.query("INSERT INTO parts (library_id, name, description, keywords, mpn, properties, pins, symbol_raw, is_generic, embedding, lifecycle_status) VALUES ($1, $2, $3, '', $2, '{}'::jsonb, '[{\"number\":\"1\",\"name\":\"A\",\"type\":\"passive\"}]'::jsonb, '', false, $4::vector, 'active')", [libraries.get(library)!, name, description, `[${harness.hashed(`${name} ${description}`).join(",")}]`]);
  }
}, 240_000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", ""); // no reranker
  vi.stubEnv("OPENAI_API_KEY", "");
  harness.embedded.length = 0;
  harness.hold = false;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const portWith = (cache: TaskEmbeddingCache) => new FactsCatalogPort(productionBuildCatalogPort(), null, "b1", () => Date.now(), { catalogEpoch: null, embeddings: cache });

describe("[PR-L6] the per-task query-embedding cache over the real catalog search (item 1)", { timeout: 60_000 }, () => {
  it("1. S3's category-then-unfiltered re-search reaches the catalog twice and embeds the text once", async () => {
    const catalog = portWith(new TaskEmbeddingCache(MODEL));
    const outcomes: PartsSearchOutcome[] = [];
    catalog.bypassCache = true; // S3's deliberate re-search (slices.ts seedConversation)
    const inCategory = await catalog.searchParts("logic level n-channel mosfet", "Memory", 5, { onOutcome: (outcome) => outcomes.push(outcome) });
    expect(inCategory).toEqual([]); // no part in that category
    const unfiltered = await catalog.searchParts("logic level n-channel mosfet", undefined, 5, { onOutcome: (outcome) => outcomes.push(outcome) });
    expect(unfiltered.map((part) => part.name)).toContain("AO3400A");
    expect(harness.embedded).toEqual(["logic level n-channel mosfet"]);
    expect(outcomes.map((outcome) => outcome.embedding)).toEqual(["called", "cached"]);
    expect(catalog.counts).toMatchObject({ searches: 2, embeddingCalls: 1, cacheHits: 0 });
  });

  it("2. word order changes the embedding key but not the search key", async () => {
    const cache = new TaskEmbeddingCache(MODEL);
    expect(cache.keyOf("logic level mosfet")).not.toBe(cache.keyOf("mosfet logic level"));
    expect(cache.keyOf("logic  level\tmosfet ")).toBe(cache.keyOf("logic level mosfet")); // whitespace is not meaning
    expect(new TaskEmbeddingCache("another-model").keyOf("logic level mosfet")).not.toBe(cache.keyOf("logic level mosfet"));
    expect(generationSearchKey({ query: "logic level mosfet", category: null, catalogProfile: "postgres", embeddingModel: MODEL })).toBe(generationSearchKey({ query: "mosfet logic level", category: null, catalogProfile: "postgres", embeddingModel: MODEL }));
    const catalog = portWith(cache);
    catalog.bypassCache = true;
    await catalog.searchParts("logic level mosfet", undefined, 5, {});
    await catalog.searchParts("mosfet logic level", undefined, 5, {});
    expect(harness.embedded).toEqual(["logic level mosfet", "mosfet logic level"]);
  });

  it("3. the task's embeddingCalls is what the provider was asked, never one assumed per search", async () => {
    const catalog = portWith(new TaskEmbeddingCache(MODEL));
    await catalog.searchParts("3.3V LDO regulator", undefined, 5, {});
    await catalog.searchParts("regulator ldo 3.3V", undefined, 5, {}); // the same search (any word order): the facts answer, nothing embedded
    catalog.bypassCache = true;
    await catalog.searchParts("3.3V LDO regulator", "Voltage Regulators", 5, {}); // a catalog search of a text embedded before
    await catalog.searchParts("6-axis IMU gyroscope", undefined, 5, {});
    await catalog.searchParts("6-axis IMU gyroscope", "Sensors", 5, {});
    expect(catalog.counts).toMatchObject({ searches: 4, cacheHits: 1 });
    expect(catalog.counts.embeddingCalls).toBe(harness.embedded.length);
    expect(harness.embedded).toEqual(["3.3V LDO regulator", "6-axis IMU gyroscope"]);
    expect(catalog.spend().embeddingCalls).toBe(2);
  });

  it("4. an embed aborted by the slice's signal leaves no cache entry; the next search embeds again", async () => {
    const cache = new TaskEmbeddingCache(MODEL);
    const catalog = portWith(cache);
    harness.hold = true;
    const controller = new AbortController();
    const searching = catalog.searchParts("dual N-channel mosfet", undefined, 5, { signal: controller.signal });
    await vi.waitFor(() => expect(harness.embedded).toEqual(["dual N-channel mosfet"]));
    controller.abort(new Error("the slice window ended"));
    await expect(searching).rejects.toThrow();
    expect(cache.has("dual N-channel mosfet")).toBe(false);
    expect(cache.size).toBe(0);
    harness.hold = false;
    await catalog.searchParts("dual N-channel mosfet", undefined, 5, {});
    expect(harness.embedded).toEqual(["dual N-channel mosfet", "dual N-channel mosfet"]);
    expect(cache.has("dual N-channel mosfet")).toBe(true);
    expect(catalog.counts.embeddingCalls).toBe(2); // the aborted call counts: it may have reached the provider
  });

  it("5. the seam in searchPartsForAI: a caller's embedder answers instead of the module's, and the outcome says how; the task caches are per task and bounded", async () => {
    let outcome: PartsSearchOutcome | null = null;
    await searchPartsForAI("N-channel MOSFET SOT-23", undefined, 5, { embedQuery: async (text) => ({ vector: harness.hashed(text), cached: true }), onOutcome: (seen) => { outcome = seen; } });
    expect(harness.embedded).toEqual([]);
    expect(outcome!.embedding).toBe("cached");
    await searchPartsForAI("N-channel MOSFET SOT-23", undefined, 5, { onOutcome: (seen) => { outcome = seen; } });
    expect(harness.embedded).toEqual(["N-channel MOSFET SOT-23"]);
    expect(outcome!.embedding).toBe("called");
    const first = taskEmbeddingCache("generation-task:00000000000000000000000000000001", MODEL);
    expect(taskEmbeddingCache("generation-task:00000000000000000000000000000001", MODEL)).toBe(first);
    for (let n = 2; n <= 9; n += 1) taskEmbeddingCache(`generation-task:${String(n).padStart(32, "0")}`, MODEL);
    expect(taskEmbeddingCache("generation-task:00000000000000000000000000000001", MODEL)).not.toBe(first); // at most 8 tasks are kept
  });
});
