/**
 * Round-trip integrity spot-check for ingested pcb_footprints rows (Stage 2).
 *
 * For 3 random DB rows: `raw_sexpr` must re-parse via parseKicadMod, and
 * emitVerbatim over the re-parsed root must equal the stored text byte-for-byte
 * — the property that makes Stage 13's splice-based .kicad_pcb export legal.
 *
 * OPT-IN (B16-B item 5 / LB-4): runs ONLY when the explicit database
 * qualification marker is present in the real process environment —
 *
 *   SIRKIT_DB_QUALIFICATION=1 SIRKIT_DB_QUALIFICATION_URL=postgres://…
 *
 * This test never reads .env.local and never gates on DATABASE_URL. It used
 * to (loadEnvLocal + DATABASE_URL), and the owner's .env.local points at a
 * Supabase project that no longer resolves, so the DEFAULT deterministic suite
 * failed with "PostgresError: (ENOTFOUND) …" — an environment failure dressed
 * up as a functional one. Without the marker every case here is SKIPPED.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { databaseQualification, withQualifiedDatabase } from "../../db/test-qualification";
import { parseKicadMod } from "../kicad-mod";
import { parseSexpr, emitVerbatim } from "../sexpr";

const q = databaseQualification();

describe.runIf(q.enabled)("pcb_footprints raw_sexpr round-trip (DB)", () => {
  // The shared client reads DATABASE_URL lazily: publish the QUALIFICATION url
  // for the duration of this suite only, and put back whatever was there.
  let priorDatabaseUrl: string | undefined;
  beforeAll(() => {
    priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = withQualifiedDatabase();
  });
  afterAll(async () => {
    const { getSqlClient } = await import("../../db/client");
    await getSqlClient().end();
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
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
