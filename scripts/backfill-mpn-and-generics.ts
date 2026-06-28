/**
 * One-shot backfill that (a) marks generic KiCad template symbols and (b) fills
 * the `mpn` column from a part's symbol name when that name is clearly an MPN.
 * Run with:
 *   pnpm backfill:mpn-generics
 *
 * Why: the Build-mode AI was picking generic templates (Device.R, Device.C_Small,
 * Connector_Generic_*) as if orderable — they have no MPN, so every BOM row came
 * back "—". And several real parts (AMS1117-3.3, ESP32-WROOM-32) carry their MPN
 * as the symbol *name* but were ingested with a null `mpn`. This script fixes
 * both at the data layer.
 *
 * Idempotent + deterministic: classification is pure (see isGenericPart /
 * looksLikeMpn), is_generic is only written when it actually changes, and MPN
 * backfill is guarded on `mpn IS NULL` — so a second run is a no-op and an
 * interrupted run resumes cleanly.
 *
 * Connection discipline: this talks to the Supabase *session* pooler (hard cap
 * 15 clients), so it uses its own small pool (max 2), prefers few set-based
 * queries over many per-row round-trips, and ALWAYS closes the pool in a
 * finally — a crashed run that leaks idle pooler sessions is what exhausts the
 * cap and makes the next run fail.
 */

import { loadEnvLocal } from "../app/lib/load-env-local";

loadEnvLocal();

import postgres from "postgres";
import { isGenericPart, looksLikeMpn, normalizeMpn } from "../app/lib/parts-normalization";

// Small batches keep every UPDATE/SELECT well under the transaction pooler's
// statement_timeout — large (~900-row) set statements sat right at the limit.
const SELECT_BATCH = 200;

const summary = {
  processed: 0,
  generic: 0,
  mpnBackfilled: 0,
  mpnSkippedConflict: 0,
};

type Row = {
  id: string;
  name: string;
  mpn: string | null;
  is_generic: boolean;
  library_name: string | null;
};

/**
 * Retry a query a few times on transient failures (the pooler's statement
 * timeout, dropped connections). All writes here are idempotent, so retrying is
 * always safe.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const transient = /statement timeout|timeout|ECONNRESET|connection|terminat/i.test(msg);
      if (!transient || attempt >= 4) throw err;
      console.warn(`[backfill] ${label} attempt ${attempt} failed (${msg}); retrying…`);
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local).");

  // Dedicated, deliberately small pool so we never crowd the 15-client pooler.
  const sql = postgres(url, {
    prepare: false,
    ssl: url.includes("supabase.") ? "require" : undefined,
    connect_timeout: 15,
    max: 2,
    onnotice: () => {},
  });

  try {
    const totalRow = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM parts`;
    const total = totalRow[0]?.n ?? 0;
    console.log(`[backfill] ${total} parts to process (select batch ${SELECT_BATCH}).`);

    // Keyset pagination on the uuid PK (WHERE id > last) — constant-time per
    // batch, unlike OFFSET which scans further each step and trips the pooler's
    // statement_timeout on a 22k-row table.
    let lastId: string | null = null;
    let scanned = 0;
    for (;;) {
      const after = lastId === null ? sql`` : sql`WHERE p.id > ${lastId}`;
      const rows: Row[] = await sql<Row[]>`
        SELECT p.id, p.name, p.mpn, p.is_generic, l.name AS library_name
        FROM parts p
        LEFT JOIN libraries l ON p.library_id = l.id
        ${after}
        ORDER BY p.id
        LIMIT ${SELECT_BATCH}
      `;
      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].id;

      const toTrue: string[] = []; // is_generic false → true
      const toFalse: string[] = []; // is_generic true → false (re-classification)
      const candidates: Array<{ id: string; mpn: string; nmpn: string }> = [];

      for (const row of rows) {
        const generic = isGenericPart({
          name: row.name,
          libraryName: row.library_name ?? undefined,
        });
        if (generic) summary.generic += 1;
        if (generic !== row.is_generic) (generic ? toTrue : toFalse).push(row.id);

        if (!generic && (row.mpn === null || row.mpn === "") && looksLikeMpn(row.name)) {
          candidates.push({ id: row.id, mpn: row.name, nmpn: normalizeMpn(row.name) });
        }
      }

      // is_generic: one bulk UPDATE per direction, only where it actually changed.
      if (toTrue.length > 0) {
        await withRetry("set-generic-true", () =>
          sql`UPDATE parts SET is_generic = true, updated_at = now() WHERE id IN ${sql(toTrue)}`,
        );
      }
      if (toFalse.length > 0) {
        await withRetry("set-generic-false", () =>
          sql`UPDATE parts SET is_generic = false, updated_at = now() WHERE id IN ${sql(toFalse)}`,
        );
      }

      await backfillMpns(sql, candidates);

      summary.processed += rows.length;
      scanned += rows.length;
      console.log(
        `[backfill] ${Math.min(scanned, total)} / ${total} ` +
          `(batch: +${toTrue.length} generic, ${candidates.length} mpn candidates)`,
      );
      if (rows.length < SELECT_BATCH) break;
    }

    console.log(
      "[backfill] Done.\n" +
        `  ${summary.processed} total parts processed\n` +
        `  ${summary.generic} marked as generic\n` +
        `  ${summary.mpnBackfilled} mpn fields backfilled from name` +
        (summary.mpnSkippedConflict > 0
          ? `\n  ${summary.mpnSkippedConflict} mpn backfills skipped (normalized_mpn already taken)`
          : ""),
    );
  } finally {
    // Always release pooler sessions, even on failure — leaked idle sessions are
    // what exhaust the pooler's client cap for the next run.
    await sql.end({ timeout: 5 });
  }
}

/**
 * Backfill mpn/normalized_mpn for a batch of candidates with a single set-based
 * UPDATE (via unnest). The `normalized_mpn` partial-unique index means colliding
 * values would abort the whole statement, so we first drop intra-batch duplicates
 * and any value already taken by another row — no per-row retry needed.
 */
async function backfillMpns(
  sql: postgres.Sql,
  candidates: Array<{ id: string; mpn: string; nmpn: string }>,
): Promise<void> {
  if (candidates.length === 0) return;

  // 1) Intra-batch dedupe by normalized_mpn (first occurrence wins).
  const byNmpn = new Map<string, { id: string; mpn: string; nmpn: string }>();
  for (const c of candidates) {
    if (!byNmpn.has(c.nmpn)) byNmpn.set(c.nmpn, c);
    else summary.mpnSkippedConflict += 1;
  }

  // 2) Drop values already owned by an existing row (would violate the index).
  const nmpns = [...byNmpn.keys()];
  const taken = await withRetry(
    "conflict-check",
    () => sql<{ normalized_mpn: string }[]>`
      SELECT normalized_mpn FROM parts WHERE normalized_mpn IN ${sql(nmpns)}
    `,
  );
  for (const t of taken) {
    if (byNmpn.delete(t.normalized_mpn)) summary.mpnSkippedConflict += 1;
  }

  const survivors = [...byNmpn.values()];
  if (survivors.length === 0) return;

  // 3) One bulk UPDATE for the whole batch via parallel arrays + unnest.
  const ids = survivors.map((s) => s.id);
  const mpns = survivors.map((s) => s.mpn);
  const norms = survivors.map((s) => s.nmpn);
  await withRetry(
    "mpn-update",
    () => sql`
      UPDATE parts AS p
      SET mpn = u.mpn, normalized_mpn = u.nmpn, updated_at = now()
      FROM unnest(${ids}::uuid[], ${mpns}::text[], ${norms}::text[]) AS u(id, mpn, nmpn)
      WHERE p.id = u.id
    `,
  );
  summary.mpnBackfilled += survivors.length;
}

main().catch((err) => {
  console.error("[backfill] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
