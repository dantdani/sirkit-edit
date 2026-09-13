/**
 * [B19-E E2] c — an external candidate search persists nothing — against a real, migrated PostgreSQL (PGlite) — and its
 * in-process memo lives no longer than the source's registered freshness: DigiKey's no-database term is honoured by keeping
 * results in memory only, and a source whose terms prohibit storage (offerTtlMs 0) is never memoized at all.
 *
 * The vendors are fake servers behind the DistributorEgress fetch/resolve/clock injection.
 * [B19-E E2 review] It lives beside the other retention suites: it starts PGlite, so it runs in the database-delivery CI
 * job, never in the no-database prompt-to-gerber job (`app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts`).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../db/schema";
import { loadMigrationManifest } from "../../db/migrations/manifest";
import { migrateDatabase } from "../../db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "../../db/disposable-postgres";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../../db/client", () => ({ getDb: () => orm }));

import { makeDigiKeyClient } from "../digikey";
import { makeOctopartClient } from "../octopart";
import type { DistributorEgress } from "../egress";
import type { DistributorClient } from "../types";
import { clearPricingCache } from "../cache";
import { resetAdmissionControl } from "../../acquisition/admission-control";
import { clearExternalSearchMemo, searchExternalCandidates } from "../../acquisition/external-search";
import type { ExternalSearchResult } from "../../acquisition/external-search-contract";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 8, 13, 12, 0, 0);
let now = T0;
const clock = (): number => now;
const SCOPE = { tenantId: "tenant-a", projectId: "project-1" };
const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];
const ENV = { DIGIKEY_CLIENT_ID: ["fake", "dk", "id"].join("-"), DIGIKEY_CLIENT_SECRET: ["fake", "dk", "secret"].join("-"), OCTOPART_API_KEY: ["fake", "nexar", "token"].join("-") };
const json = (value: unknown): Response => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
const DK_PRODUCT = { ManufacturerProductNumber: "NE555DR", Manufacturer: { Name: "Texas Instruments" }, QuantityAvailable: 10, StandardPricing: [{ BreakQuantity: 1, UnitPrice: 0.5 }], ProductStatus: { Status: "Active" } };
const NX_PART = { mpn: "NE555DR", manufacturer: { name: "Texas Instruments" }, totalAvail: 10, lifecycleStatus: "Production", sellers: [] };

function vendors(makers: { digikey: typeof makeDigiKeyClient; octopart: typeof makeOctopartClient } = { digikey: makeDigiKeyClient, octopart: makeOctopartClient }) {
  const searches: string[] = [];
  const transport: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/oauth2/token")) return json({ access_token: "fake-access", expires_in: 600 });
    searches.push(new URL(url).hostname);
    if (url.includes("api.digikey.com")) return json({ Products: [DK_PRODUCT] });
    return json({ data: { s0: { results: [{ part: NX_PART }] } } });
  };
  const egress: DistributorEgress = { fetch: transport, resolve: PUBLIC, clock };
  const clients = new Map<string, DistributorClient>();
  const connect = (id: string, secrets: Readonly<Record<string, string>>): DistributorClient | null => {
    if (!clients.has(id)) {
      if (id === "digikey") clients.set(id, makers.digikey({ clientId: secrets.DIGIKEY_CLIENT_ID ?? "", clientSecret: secrets.DIGIKEY_CLIENT_SECRET ?? "", egress }));
      else if (id === "octopart") clients.set(id, makers.octopart({ apiKey: secrets.OCTOPART_API_KEY ?? "", egress }));
      else return null;
    }
    return clients.get(id)!;
  };
  return { searches, connect };
}

function ok(result: ExternalSearchResult) {
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result;
}

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  const library = await pg.db.query<{ id: string }>(`INSERT INTO libraries (name, main_category) VALUES ('b19e-e2-lib', 'test') RETURNING id`);
  const part = await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, mpn, properties, pins, symbol_raw) VALUES ($1, 'NE555', 'NE555DR', '{}'::jsonb, '[]'::jsonb, '') RETURNING id`, [library.rows[0]!.id]);
  await pg.db.query(`INSERT INTO part_offers (part_id, distributor, mpn, price_breaks, stock, last_refreshed_at) VALUES ($1, 'digikey', 'NE555DR', '[]'::jsonb, 3, $2)`, [part.rows[0]!.id, new Date().toISOString()]);
}, 120_000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => {
  now = T0;
  vi.stubGlobal("fetch", () => { throw new Error("the external search bypassed the egress boundary"); });
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearExternalSearchMemo();
  clearPricingCache();
  resetAdmissionControl();
});

async function snapshot(): Promise<{ offers: unknown[]; parts: unknown[] }> {
  const offers = await pg.db.query(`SELECT part_id, distributor, mpn, stock, last_refreshed_at FROM part_offers ORDER BY part_id, distributor`);
  const parts = await pg.db.query(`SELECT id, lifecycle_status, last_refreshed_at FROM parts ORDER BY id`);
  return { offers: offers.rows, parts: parts.rows };
}

describe("[B19-E E2] c — nothing is persisted", () => {
  it("exact and keyword searches over both sources write no part_offers row and touch no part", async () => {
    const before = await snapshot();
    expect(before.offers).toHaveLength(1);
    const v = vendors();
    const exact = ok(await searchExternalCandidates({ query: "NE555DR", mode: "exact", limit: 5 }, { live: true, purpose: "interactive", scope: SCOPE, env: ENV, clock, connect: v.connect }));
    const keyword = ok(await searchExternalCandidates({ query: "555 timer", mode: "keyword", limit: 5 }, { live: true, purpose: "interactive", scope: SCOPE, env: ENV, clock, connect: v.connect }));
    expect(exact.hits.length + keyword.hits.length).toBe(4);
    expect(v.searches.length).toBe(4);
    expect(await snapshot()).toEqual(before);
  }, 20_000);

  // [B19-E E2 review] a static read of the orchestrator alone; the connectors never feeding the pricing memo is checked by
  // behaviour in app/lib/acquisition/__tests__/b19-e-external-search.test.ts ("a search never feeds the pricing memo")
  it("the orchestrator itself names no offer-cache, pricing-memo or database write", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/lib/acquisition/external-search.ts", "utf8");
    expect(source).not.toMatch(/putCachedOffer|part_offers|partOffers|db\/client|getDb|setCached|rememberNoExactMatch|from "\.\.\/distributors\/cache"/);
  });
});

describe("[B19-E E2] c — the memo lives exactly the source's freshness", () => {
  it("DigiKey: served from the memo until one hour after the vendor answered, then asked again", async () => {
    const v = vendors();
    const input = { query: "NE555DR", mode: "exact" as const, limit: 5, sources: ["digikey" as const] };
    const first = ok(await searchExternalCandidates(input, { live: true, purpose: "interactive", scope: SCOPE, env: ENV, clock, connect: v.connect }));
    expect(first.hits.map((hit) => hit.servedFrom)).toEqual(["live"]);
    expect(v.searches).toHaveLength(1);

    now = T0 + HOUR - 1;
    const memo = ok(await searchExternalCandidates(input, { live: true, purpose: "interactive", scope: SCOPE, env: ENV, clock, connect: v.connect }));
    expect(v.searches, "served from memory").toHaveLength(1);
    expect(memo.sources.find((source) => source.sourceId === "digikey")).toMatchObject({ servedFrom: "process-memo", hitCount: 1 });
    expect(memo.hits[0]).toMatchObject({ servedFrom: "process-memo", observedAt: T0, expiresAt: T0 + HOUR });

    now = T0 + HOUR;
    const expired = ok(await searchExternalCandidates(input, { live: true, purpose: "interactive", scope: SCOPE, env: ENV, clock, connect: v.connect }));
    expect(v.searches, "the memo expired at the TTL").toHaveLength(2);
    expect(expired.hits[0]).toMatchObject({ servedFrom: "live", observedAt: T0 + HOUR });
  }, 20_000);

  it("a memo of a smaller search never answers a larger one, and a memo hit needs no live grant", async () => {
    const v = vendors();
    const small = { query: "NE555DR", mode: "exact" as const, limit: 2, sources: ["octopart" as const] };
    ok(await searchExternalCandidates(small, { live: true, purpose: "interactive", scope: SCOPE, env: ENV, clock, connect: v.connect }));
    const cacheOnly = ok(await searchExternalCandidates(small, { live: false, purpose: "interactive", scope: SCOPE, env: ENV, clock, connect: v.connect }));
    expect(cacheOnly.hits.map((hit) => hit.servedFrom)).toEqual(["process-memo"]);
    ok(await searchExternalCandidates({ ...small, limit: 5 }, { live: true, purpose: "interactive", scope: SCOPE, env: ENV, clock, connect: v.connect }));
    expect(v.searches).toEqual(["api.nexar.com", "api.nexar.com"]);
  }, 20_000);

  it("a source whose terms prohibit storage (offerTtlMs 0) is never memoized", async () => {
    vi.resetModules();
    vi.doMock("../../acquisition/source-registry", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../../acquisition/source-registry")>();
      const octopart = JSON.parse(JSON.stringify(actual.SOURCE_REGISTRY.octopart)) as { license: { storage: string; retentionMaxMs: number }; freshness: { offerTtlMs: number } };
      octopart.license.storage = "no-storage";
      octopart.license.retentionMaxMs = 0;
      octopart.freshness.offerTtlMs = 0;
      const registry = { ...actual.SOURCE_REGISTRY, octopart } as unknown as typeof actual.SOURCE_REGISTRY;
      return { ...actual, SOURCE_REGISTRY: registry, sourceEntry: (id: keyof typeof registry) => registry[id], sourceForDistributorName: (name: string) => Object.values(registry).find((entry) => entry.distributorName === name) ?? null };
    });
    try {
      const search = await import("../../acquisition/external-search");
      const makers = { digikey: (await import("../digikey")).makeDigiKeyClient, octopart: (await import("../octopart")).makeOctopartClient };
      const v = vendors(makers);
      const input = { query: "NE555DR", mode: "exact" as const, limit: 5, sources: ["octopart" as const] };
      const first = ok(await search.searchExternalCandidates(input, { live: true, purpose: "interactive", scope: SCOPE, env: ENV, clock, connect: v.connect }));
      now = T0 + 1;
      const second = ok(await search.searchExternalCandidates(input, { live: true, purpose: "interactive", scope: SCOPE, env: ENV, clock, connect: v.connect }));
      expect(v.searches, "asked again: nothing was kept").toEqual(["api.nexar.com", "api.nexar.com"]);
      expect(first.hits[0]).toMatchObject({ servedFrom: "live", observedAt: T0, expiresAt: T0 });
      expect(second.hits[0]).toMatchObject({ servedFrom: "live", observedAt: T0 + 1 });
      search.clearExternalSearchMemo();
    } finally {
      vi.doUnmock("../../acquisition/source-registry");
      vi.resetModules();
    }
  }, 20_000);
});
