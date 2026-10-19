/**
 * [PR-L6, 2026-10-19] L.6 part 2, item 2b (l6-remaining.md; runbook L.6 "avoid repeated embeddings/reranking for an identical request and
 * catalog identity"): a task's cached catalog lookups are keyed by the catalog's IDENTITY now - its epoch, one cheap read of the published
 * links, the revision status events and the newest library ingestion (memoized 30 s per process).
 *
 *  1. the epoch is one identifier and moves with the catalog: a library ingested, a link published, a revision withdrawn;
 *  2. under an unchanged epoch a later slice's identical search is answered from the facts with zero catalog calls;
 *  3. a part published between slices changes the epoch: the cached lookup misses and the next search surfaces the VERIFIED part;
 *  4. its revision withdrawn: the epoch moves again and the stale "verified" is not reused;
 *  5. the production port memoizes the read for 30 s; a fixture catalog's epoch is the constant "fixture".
 *
 * The REAL `searchPartsForAI`, `readCatalogEpoch` and production catalog port on a migrated PostgreSQL (PGlite); the embedding provider is
 * a counting fake and there is no reranker. Nothing reaches a network.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../db/schema";
import { loadMigrationManifest } from "../../db/migrations/manifest";
import { migrateDatabase } from "../../db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "../../db/disposable-postgres";
import { categorizeLib } from "../../kicad/categories";

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
  return { hashed, embedded: [] as string[] };
});

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../../db/client", () => ({ getDb: () => orm }));
vi.mock("../../embeddings", async (original) => ({ ...(await original() as object), embedQuery: vi.fn(async (text: string) => { harness.embedded.push(text); return harness.hashed(text); }) }));

import { productionBuildCatalogPort } from "../../build-loop";
import { readCatalogEpoch } from "../../parts-search";
import { applyGenerationFactsDelta, type GenerationTaskFacts } from "../contracts";
import { FIXTURE_CATALOG_EPOCH, FactsCatalogPort, catalogEpochOf } from "../worker/accounting";

const TASK = "generation-task:0123456789abcdef0123456789abcdef";
const QUERY = "555 timer SOIC-8", CATEGORY = "Timers & Oscillators";
let ne555 = "";
let revisionId = "";

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  const library = (await pg.db.query<{ id: string }>("INSERT INTO libraries (name, main_category) VALUES ('Timer', $1) RETURNING id", [categorizeLib("Timer")])).rows[0]!.id;
  const pins = JSON.stringify([["GND", "power_in"], ["TR", "input"], ["Q", "output"], ["R", "input"], ["CV", "input"], ["THR", "input"], ["DIS", "open_collector"], ["VCC", "power_in"]].map(([name, type], index) => ({ number: String(index + 1), name, type })));
  for (const [name, description] of [["NE555D", "Precision Timers, 555 compatible, SOIC-8"], ["LM555xM", "Timer, 555 compatible, SOIC-8"]] as const) {
    const id = (await pg.db.query<{ id: string }>("INSERT INTO parts (library_id, name, description, keywords, mpn, properties, pins, symbol_raw, is_generic, embedding, lifecycle_status) VALUES ($1, $2, $3, 'single timer 555', $2, '{}'::jsonb, $4::jsonb, '', false, $5::vector, 'active') RETURNING id", [library, name, description, pins, `[${harness.hashed(`${name} ${description} single timer 555`).join(",")}]`])).rows[0]!.id;
    if (name === "NE555D") ne555 = id;
  }
}, 240_000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

/** One block slice's catalog under the production port's epoch now; its facts delta merged into the task's facts. */
async function slice(facts: GenerationTaskFacts | null): Promise<{ port: FactsCatalogPort; epoch: string | null; facts: GenerationTaskFacts; verified: boolean }> {
  const production = productionBuildCatalogPort();
  const epoch = await catalogEpochOf(production);
  const port = new FactsCatalogPort(production, facts, "b1", () => Date.now(), { catalogEpoch: epoch });
  const found = await port.searchParts(QUERY, CATEGORY, 5, {});
  const delta = port.takeDelta();
  return { port, epoch, facts: delta ? applyGenerationFactsDelta(facts, delta, { taskId: TASK, catalogProfile: "postgres", embeddingModel: "text-embedding-3-small" }) : facts!, verified: found.find((part) => part.partId === ne555)?.physicalAuthority === "verified" };
}
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe("[PR-L6] lookups keyed by the catalog's identity (item 2b)", { timeout: 120_000 }, () => {
  it("1-4. unchanged epoch: zero catalog calls; a link published between slices surfaces the verified part; a withdrawn revision's verified is not reused", async () => {
    const before = await readCatalogEpoch();
    expect(before).toMatch(/^pg1-\d+-\d+-\d+-\d+-\d+$/);
    const first = await slice(null);
    expect(first.epoch).toBe(before);
    expect(first.port.counts).toMatchObject({ searches: 1, cacheHits: 0 });
    expect(first.verified).toBe(false);
    expect(Object.values(first.facts.lookups)[0]).toMatchObject({ catalogEpoch: before });
    // the same epoch: a later slice's identical search is answered from the facts - no catalog, embedding or reranker call
    const embeddedBefore = harness.embedded.length;
    const second = await slice(first.facts);
    expect(second.port.counts).toMatchObject({ searches: 0, cacheHits: 1, embeddingCalls: 0 });
    expect(harness.embedded.length).toBe(embeddedBefore);

    // NE555D's exact revision is published and linked (M2 publication writes links): the epoch moves
    const { blinkerCatalog, BLINKER_PART_IDS } = await import("../../fixture-runtime/blinker/catalog");
    const { publishPortableAtomicSnapshot, withdrawPublishedAtomicRevision } = await import("../../atomic/server-repository");
    const { normalizeValueKey } = await import("../../atomic/value-key");
    const blinker = blinkerCatalog();
    revisionId = blinker.revisionFor(BLINKER_PART_IDS.timer, "")!;
    await publishPortableAtomicSnapshot({ snapshot: structuredClone(blinker.snapshots.get(revisionId)!), actorId: "user:fixture-publisher", actorRole: "publisher", requiredProfile: "pcb_assignable", reason: "L6 catalog epoch" });
    later(1_000);
    await pg.db.query("INSERT INTO parts_atomic_links (part_id, value_key, atomic_part_revision_id, symbol_asset_version_id, footprint_asset_version_id, mapping_certificate_id, footprint_full_name) VALUES ($1, $2, $3, 'sym', 'fp', 'map', 'Fixture:NE555D')", [ne555, normalizeValueKey(""), revisionId]);
    const published = await readCatalogEpoch();
    expect(published).not.toBe(before);
    later(31_000); // past the production port's 30 s memo
    const third = await slice(second.facts);
    expect(third.epoch).toBe(published);
    expect(third.port.counts).toMatchObject({ searches: 1, cacheHits: 0 }); // the cached lookup of the old identity missed
    expect(third.verified).toBe(true); // the part published since is found, verified

    // the revision is withdrawn: the epoch moves again; the stale "verified" of the cached lookup is not reused
    await withdrawPublishedAtomicRevision({ revisionId, to: "revoked", actorId: "user:fixture-publisher", actorRole: "publisher", reason: "L6 catalog epoch: withdrawn" });
    const withdrawn = await readCatalogEpoch();
    expect(withdrawn).not.toBe(published);
    later(31_000);
    const fourth = await slice(third.facts);
    expect(fourth.epoch).toBe(withdrawn);
    expect(fourth.port.counts).toMatchObject({ searches: 1, cacheHits: 0 });
    expect(fourth.verified).toBe(false);
  });

  it("5. the production port reads the epoch at most once per 30 s; a library ingested moves it; a fixture catalog's epoch is the constant", async () => {
    const production = productionBuildCatalogPort();
    later(60_000); // a fresh memo window
    const now = await production.catalogEpoch!();
    await pg.db.query("INSERT INTO libraries (name, main_category) VALUES ('Memory_Flash', $1)", [categorizeLib("Memory_Flash")]);
    expect(await readCatalogEpoch()).not.toBe(now); // the catalog moved
    expect(await production.catalogEpoch!()).toBe(now); // within 30 s: the memoized read
    later(31_000);
    expect(await production.catalogEpoch!()).toBe(await readCatalogEpoch());
    expect(await catalogEpochOf({ ...production, identity: { catalogProfile: "fixture-blinker", embeddingModel: "text-embedding-3-small" } })).toBe(FIXTURE_CATALOG_EPOCH);
  });
});
