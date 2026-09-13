/**
 * [B19-E E1] An offer says where it was served from and when the vendor answered — against a real, migrated PostgreSQL (PGlite).
 *
 * Before E1 an answer served from a connector's in-process memo was indistinguishable from a live answer, and persisting any
 * offer stamped `last_refreshed_at = now`: a DigiKey memo answer from 50 minutes ago, persisted for a second part, was served
 * for another full hour — past the one hour DigiKey's registered freshness allows from when it actually answered.
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

import { getCached, getCachedOffersForParts, putCachedOffer, setCached } from "../cache";
import type { PartPricing } from "../types";

const MINUTE = 60_000;
const partIds: string[] = [];

function liveAnswer(retrievedAt: number): PartPricing {
  return {
    distributor: "digikey", mpn: "NE555DR", manufacturer: "TI", description: null, datasheet: null, inStock: 10, minOrderQty: 1,
    priceBreaks: [{ qty: 1, price: 0.5, currency: "USD" }], bestUnitPrice: 0.5, productUrl: null, package: null,
    lifecycleStatus: "active", lifecycleRaw: "Active", fetchedAt: retrievedAt,
    evidence: { rawContentHash: "c".repeat(64), retrievedAt },
    provenance: { servedFrom: "live", retrievedAt },
  };
}

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  const library = await pg.db.query<{ id: string }>(`INSERT INTO libraries (name, main_category) VALUES ('b19e-lib', 'test') RETURNING id`);
  for (const name of ["NE555-a", "NE555-b"]) {
    const part = await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, properties, pins, symbol_raw) VALUES ($1, $2, '{}'::jsonb, '[]'::jsonb, '') RETURNING id`, [library.rows[0]!.id, name]);
    partIds.push(part.rows[0]!.id);
  }
}, 120_000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => { await pg.db.query(`DELETE FROM part_offers`); });

describe("[B19-E E1] served-from and retrieved-at travel with every offer", () => {
  it("a memo answer says it came from the process memo and keeps the vendor's retrieval time", () => {
    const answeredAt = Date.now() - 50 * MINUTE;
    setCached("digikey", "NE555DR", liveAnswer(answeredAt));
    const memo = getCached("digikey", "NE555DR");
    expect(memo?.provenance).toEqual({ servedFrom: "process-memo", retrievedAt: answeredAt });
  });

  it("a memo answer persisted for another part is stamped with when the vendor answered, and expires from then", async () => {
    const answeredAt = Date.now() - 50 * MINUTE;
    setCached("digikey", "NE555DR", liveAnswer(answeredAt));
    await putCachedOffer(partIds[1]!, "digikey", getCached("digikey", "NE555DR")!);
    const stored = await pg.db.query<{ refreshed: string }>(`SELECT last_refreshed_at AS refreshed FROM part_offers WHERE part_id = $1`, [partIds[1]!]);
    expect(new Date(stored.rows[0]!.refreshed).getTime()).toBe(answeredAt);
    // served now (50 min into DigiKey's hour), labelled as the offer cache with the vendor's time
    const served = (await getCachedOffersForParts([partIds[1]!])).get(partIds[1]!)?.get("digikey");
    expect(served?.provenance).toEqual({ servedFrom: "offer-cache", retrievedAt: answeredAt });
  });

  it("an answer retrieved more than DigiKey's hour ago is never served after being persisted", async () => {
    const answeredAt = Date.now() - 70 * MINUTE;
    await putCachedOffer(partIds[0]!, "digikey", { ...liveAnswer(answeredAt), provenance: { servedFrom: "process-memo", retrievedAt: answeredAt } });
    expect((await getCachedOffersForParts([partIds[0]!])).get(partIds[0]!)).toBeUndefined();
  });

  it("a retrieval time in the future is never stamped (it would extend how long an offer is served)", async () => {
    await putCachedOffer(partIds[0]!, "digikey", liveAnswer(Date.now() + 10 * 24 * 60 * MINUTE));
    const stored = await pg.db.query<{ refreshed: string }>(`SELECT last_refreshed_at AS refreshed FROM part_offers WHERE part_id = $1`, [partIds[0]!]);
    expect(new Date(stored.rows[0]!.refreshed).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("a live answer persisted right away is served (baseline)", async () => {
    await putCachedOffer(partIds[0]!, "digikey", liveAnswer(Date.now()));
    expect((await getCachedOffersForParts([partIds[0]!])).get(partIds[0]!)?.get("digikey")?.mpn).toBe("NE555DR");
  });
});
