/**
 * [B19-A I3] How long a source's observations may be SERVED and KEPT — against a real, migrated PostgreSQL (PGlite).
 *
 * Before B19 the offer cache (`part_offers`) served every source's rows for 24 hours and kept them forever, and it stored
 * whatever it was given. The vendors' current terms (recorded in `source-registry.md`):
 *  - Mouser: no caching or storing of its content — never persisted;
 *  - Nexar (Octopart): nothing stored for more than 24 hours;
 *  - DigiKey: no database built from its data; retention unstated, so the registry keeps it no longer than it is served
 *    (1 hour, OD-33).
 * And the alternates route read `part_offers` directly, showing stock and a best price from rows of any age.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../db/schema";
import { loadMigrationManifest } from "../../db/migrations/manifest";
import { migrateDatabase } from "../../db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "../../db/disposable-postgres";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("../../db/client", () => ({ getDb: () => orm }));

import { getCachedOffersForParts, isOfferServable, purgeExpiredOffers, putCachedOffer } from "../cache";
import type { PartPricing } from "../types";

const HOUR = 3_600_000;
let partId = "";

function offer(distributor: PartPricing["distributor"]): PartPricing {
  return { distributor, mpn: "NE555DR", manufacturer: "TI", description: null, datasheet: null, inStock: 10, minOrderQty: 1, priceBreaks: [{ qty: 1, price: 0.5, currency: "USD" }], bestUnitPrice: 0.5, productUrl: null, package: null, lifecycleStatus: "active", lifecycleRaw: "Active", fetchedAt: 0 };
}

async function rowsFor(id: string): Promise<Array<{ distributor: string; age: number }>> {
  const result = await pg.db.query<{ distributor: string; refreshed: string }>(`SELECT distributor, last_refreshed_at AS refreshed FROM part_offers WHERE part_id = $1 ORDER BY distributor`, [id]);
  return result.rows.map((row) => ({ distributor: row.distributor, age: Date.now() - new Date(row.refreshed).getTime() }));
}

async function insertAged(distributor: string, ageMs: number): Promise<void> {
  await pg.db.query(
    `INSERT INTO part_offers (part_id, distributor, price_breaks, stock, last_refreshed_at) VALUES ($1, $2, '[]'::jsonb, 5, $3)
     ON CONFLICT (part_id, distributor) DO UPDATE SET last_refreshed_at = EXCLUDED.last_refreshed_at`,
    [partId, distributor, new Date(Date.now() - ageMs).toISOString()],
  );
}

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  const library = await pg.db.query<{ id: string }>(`INSERT INTO libraries (name, main_category) VALUES ('b19-lib', 'test') RETURNING id`);
  const part = await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, properties, pins, symbol_raw) VALUES ($1, 'NE555', '{}'::jsonb, '[]'::jsonb, '') RETURNING id`, [library.rows[0]!.id]);
  partId = part.rows[0]!.id;
}, 120_000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => { await pg.db.query(`DELETE FROM part_offers`); });

describe("[B19-A I3] a source whose terms prohibit storage is never persisted", () => {
  it("Mouser: putCachedOffer writes nothing", async () => {
    await putCachedOffer(partId, "mouser", offer("mouser"));
    expect(await rowsFor(partId)).toEqual([]);
  });

  it("DigiKey and Nexar are persisted (bounded storage)", async () => {
    await putCachedOffer(partId, "digikey", offer("digikey"));
    await putCachedOffer(partId, "octopart-aggregated", offer("octopart-aggregated"));
    expect((await rowsFor(partId)).map((row) => row.distributor)).toEqual(["digikey", "octopart-aggregated"]);
  });
});

describe("[B19-A I3] an observation is served only within its source's registered freshness", () => {
  it("DigiKey at 2 h is not served (1 h); Nexar at 2 h is (24 h); Nexar at 25 h is not; a stored Mouser row never is", async () => {
    await insertAged("digikey", 2 * HOUR);
    await insertAged("octopart-aggregated", 2 * HOUR);
    await insertAged("mouser", 60_000); // e.g. stored before B19
    const served = await getCachedOffersForParts([partId]);
    expect([...(served.get(partId)?.keys() ?? [])]).toEqual(["octopart-aggregated"]);

    await insertAged("octopart-aggregated", 25 * HOUR);
    expect((await getCachedOffersForParts([partId])).get(partId)).toBeUndefined();
  });

  it("isOfferServable is the one rule every reader applies (the alternates route included)", () => {
    const now = Date.now();
    expect(isOfferServable("digikey", new Date(now - 30 * 60_000), now)).toBe(true);
    expect(isOfferServable("digikey", new Date(now - 2 * HOUR), now)).toBe(false);
    expect(isOfferServable("octopart-aggregated", new Date(now - 23 * HOUR), now)).toBe(true);
    expect(isOfferServable("mouser", new Date(now), now)).toBe(false);
    expect(isOfferServable("an-unregistered-source", new Date(now), now), "an unknown source is never served").toBe(false);
    expect(isOfferServable("digikey", null, now)).toBe(false);
  });
});

describe("[B19-A I3] nothing is kept longer than its source's retention", () => {
  it("purgeExpiredOffers deletes DigiKey beyond 1 h, Nexar beyond 24 h, every no-storage and unregistered row — and keeps the rest", async () => {
    await insertAged("digikey", 2 * HOUR);
    await insertAged("octopart-aggregated", 2 * HOUR);
    await insertAged("mouser", 60_000);
    await insertAged("some-retired-source", 60_000);
    const deleted = await purgeExpiredOffers();
    expect(deleted).toBe(3);
    expect((await rowsFor(partId)).map((row) => row.distributor)).toEqual(["octopart-aggregated"]);
  });
});
