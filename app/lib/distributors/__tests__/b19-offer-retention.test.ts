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
  return { distributor, mpn: "NE555DR", manufacturer: "TI", description: null, datasheet: null, inStock: 10, minOrderQty: 1, priceBreaks: [{ qty: 1, price: 0.5, currency: "USD" }], bestUnitPrice: 0.5, productUrl: null, package: null, lifecycleStatus: "active", lifecycleRaw: "Active", fetchedAt: Date.now() };
  // [B19-E E1; fixture correction] a stored offer is stamped with when it was fetched, so the fixture carries a real fetch time
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

describe("[B19-D I5b rows 01, 36] a stored offer carries the exact MPN it answers for", () => {
  it("putCachedOffer stores the offer's MPN and getCachedOffersForParts returns it", async () => {
    await putCachedOffer(partId, "digikey", offer("digikey"));
    const served = await getCachedOffersForParts([partId]);
    expect(served.get(partId)?.get("digikey")?.mpn).toBe("NE555DR");
    const stored = await pg.db.query<{ mpn: string | null }>(`SELECT mpn FROM part_offers WHERE part_id = $1`, [partId]);
    expect(stored.rows.map((row) => row.mpn)).toEqual(["NE555DR"]);
  });
});

describe("[B19-D I5b row 03] a vendor-derived lifecycle on a part expires with its sources", () => {
  it("purgeExpiredOffers clears a vendor-stamped lifecycle older than the strictest retention, and leaves KiCad-derived and recent ones", async () => {
    const library = await pg.db.query<{ id: string }>(`SELECT library_id AS id FROM parts WHERE id = $1`, [partId]);
    const make = async (name: string, status: string, refreshedAgoMs: number | null) => {
      const row = await pg.db.query<{ id: string }>(
        `INSERT INTO parts (library_id, name, properties, pins, symbol_raw, lifecycle_status, last_refreshed_at) VALUES ($1, $2, '{}'::jsonb, '[]'::jsonb, '', $3, $4) RETURNING id`,
        [library.rows[0]!.id, name, status, refreshedAgoMs === null ? null : new Date(Date.now() - refreshedAgoMs).toISOString()],
      );
      return row.rows[0]!.id;
    };
    const stale = await make("stale-vendor", "obsolete", 2 * HOUR);
    const recent = await make("recent-vendor", "nrnd", 10 * 60_000);
    const kicad = await make("kicad-derived", "active", null);
    await purgeExpiredOffers();
    const read = async (id: string) => (await pg.db.query<{ status: string; refreshed: string | null }>(`SELECT lifecycle_status AS status, last_refreshed_at AS refreshed FROM parts WHERE id = $1`, [id])).rows[0]!;
    expect(await read(stale)).toMatchObject({ status: "unknown", refreshed: null });
    expect((await read(recent)).status).toBe("nrnd");
    expect(await read(kicad)).toMatchObject({ status: "active", refreshed: null });
  });
});

describe("[B19-D I5b review] a vendor-stamped lifecycle expires at READ time too", () => {
  it("partLifecycleStatus reads a stamped status older than the strictest retention as unknown, before any purge runs", async () => {
    const { partLifecycleStatus } = await import("../lifecycle-sql");
    const { eq } = await import("drizzle-orm");
    const library = await pg.db.query<{ id: string }>(`SELECT library_id AS id FROM parts WHERE id = $1`, [partId]);
    const make = async (name: string, status: string, refreshedAgoMs: number | null) => (await pg.db.query<{ id: string }>(
      `INSERT INTO parts (library_id, name, properties, pins, symbol_raw, lifecycle_status, last_refreshed_at) VALUES ($1, $2, '{}'::jsonb, '[]'::jsonb, '', $3, $4) RETURNING id`,
      [library.rows[0]!.id, name, status, refreshedAgoMs === null ? null : new Date(Date.now() - refreshedAgoMs).toISOString()],
    )).rows[0]!.id;
    const stale = await make("read-stale", "obsolete", 2 * HOUR);
    const fresh = await make("read-fresh", "nrnd", 10 * 60_000);
    const kicad = await make("read-kicad", "active", null);
    const read = async (id: string) => (await orm.select({ status: partLifecycleStatus }).from(schema.parts).where(eq(schema.parts.id, id)))[0]!.status;
    expect(await read(stale)).toBe("unknown");
    expect(await read(fresh)).toBe("nrnd");
    expect(await read(kicad)).toBe("active");
  });
});
