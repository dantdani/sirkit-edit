/**
 * [B19-E E6 review] The exact-MPN offer-cache read serves the NEWEST servable row of each MPN and source whatever else is
 * stored under that MPN — against a real, migrated PostgreSQL (PGlite).
 *
 * `part_offers` is unique per (catalog part, distributor), so one MPN filed under many catalog parts has many rows per source.
 * The read took an arbitrary 64 rows before choosing the newest per source in code, so a fresh Nexar row could be left behind
 * 64 stale DigiKey rows of the same MPN, and the agent would report not_cached (or spend a live lookup) despite a servable
 * cached offer. It now takes one row per (MPN, source) — the newest — in the database.
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

import { getCachedOffersForExactMpns } from "../cache";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** the registry's stored distributor name for Nexar */
const NEXAR = "octopart-aggregated";
const PARTS = 65;
const partIds: string[] = [];

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  const library = await pg.db.query<{ id: string }>(`INSERT INTO libraries (name, main_category) VALUES ('b19e-e6-lib', 'test') RETURNING id`);
  for (let index = 0; index < PARTS; index += 1) {
    const part = await pg.db.query<{ id: string }>(`INSERT INTO parts (library_id, name, properties, pins, symbol_raw) VALUES ($1, $2, '{}'::jsonb, '[]'::jsonb, '') RETURNING id`, [library.rows[0]!.id, `NE555P-${index}`]);
    partIds.push(part.rows[0]!.id);
  }
}, 120_000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => { await pg.db.query(`DELETE FROM part_offers`); });

async function storeOffer(partId: string, distributor: string, mpn: string, refreshedAt: number): Promise<void> {
  await pg.db.query(`INSERT INTO part_offers (part_id, distributor, mpn, price_breaks, last_refreshed_at) VALUES ($1, $2, $3, '[]'::jsonb, $4)`, [partId, distributor, mpn, new Date(refreshedAt).toISOString()]);
}

describe("[B19-E E6 review] the newest servable offer of an exact MPN is served whatever else is stored under it", () => {
  it("a fresh Nexar row behind 64 stale DigiKey rows of the same MPN is still served", async () => {
    const now = Date.now();
    // past DigiKey's hour: still stored (retention), never servable
    for (let index = 0; index < 64; index += 1) await storeOffer(partIds[index]!, "digikey", "NE555P", now - 70 * MINUTE);
    await storeOffer(partIds[64]!, NEXAR, "ne555p", now - 10 * MINUTE);
    const served = await getCachedOffersForExactMpns(["NE555P"], now);
    expect(served.get("NE555P")?.get(NEXAR)?.provenance).toEqual({ servedFrom: "offer-cache", retrievedAt: now - 10 * MINUTE });
    expect(served.get("NE555P")?.has("digikey")).toBe(false);
  });

  it("per MPN and source the newest row wins, and only the asked MPNs come back", async () => {
    const now = Date.now();
    await storeOffer(partIds[0]!, NEXAR, "NE555P", now - 5 * HOUR);
    await storeOffer(partIds[1]!, NEXAR, "NE555P", now - HOUR);
    await storeOffer(partIds[2]!, NEXAR, "NE555P", now - 3 * HOUR);
    await storeOffer(partIds[3]!, "digikey", "NE555P", now - 20 * MINUTE);
    await storeOffer(partIds[4]!, NEXAR, "LM358N", now - 2 * HOUR);
    const served = await getCachedOffersForExactMpns(["NE555P", "LM358N", "TL072CP"], now);
    expect(served.get("NE555P")?.get(NEXAR)?.provenance?.retrievedAt).toBe(now - HOUR);
    expect(served.get("NE555P")?.get("digikey")?.provenance?.retrievedAt).toBe(now - 20 * MINUTE);
    expect(served.get("LM358N")?.get(NEXAR)?.provenance?.retrievedAt).toBe(now - 2 * HOUR);
    expect(served.has("TL072CP")).toBe(false);
    expect([...served.keys()].sort()).toEqual(["LM358N", "NE555P"]);
  });
});
