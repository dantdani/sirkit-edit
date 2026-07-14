/**
 * Round-trip integrity spot-check for ingested pcb_footprints rows (Stage 2).
 *
 * For 3 random DB rows: `raw_sexpr` must re-parse via parseKicadMod, and
 * emitVerbatim over the re-parsed root must equal the stored text byte-for-byte
 * — the property that makes Stage 13's splice-based .kicad_pcb export legal.
 *
 * Runs only when DATABASE_URL is available (loaded from .env.local on dev
 * machines); skips otherwise so `pnpm test` stays green in CI.
 */

import { describe, it, expect, afterAll } from "vitest";
import { loadEnvLocal } from "../../load-env-local";
import { parseKicadMod } from "../kicad-mod";
import { parseSexpr, emitVerbatim } from "../sexpr";

loadEnvLocal();
const hasDb = typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL !== "";

describe.skipIf(!hasDb)("pcb_footprints raw_sexpr round-trip (DB)", () => {
  afterAll(async () => {
    if (!hasDb) return;
    const { getSqlClient } = await import("../../db/client");
    await getSqlClient().end();
  });

  // 30 s timeout: the remote DB round-trip gets starved when the full suite
  // runs in parallel (observed flaking at the 5 s default; passes solo).
  it("3 random rows re-parse and emit verbatim", { timeout: 30_000 }, async () => {
    const { getSqlClient } = await import("../../db/client");
    const rows = await getSqlClient()<
      { lib_name: string; name: string; raw_sexpr: string }[]
    >`select lib_name, name, raw_sexpr from pcb_footprints order by random() limit 3`;
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const def = parseKicadMod(row.raw_sexpr, row.lib_name);
      expect(def.name).toBe(row.name);
      expect(def.rawSexpr).toBe(row.raw_sexpr);

      const root = parseSexpr(row.raw_sexpr);
      expect(emitVerbatim(root, row.raw_sexpr)).toBe(row.raw_sexpr);
    }
  });
});
