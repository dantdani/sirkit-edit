/**
 * GET /api/pcb/footprints/search?q=<text>&limit=20&padCount=<n?>&smd=<bool?>
 *
 * Hybrid footprint search over the pcb_footprints table. This route owns only
 * transport: canonical `publicRoute({ query: true })` boundary, query bounds,
 * and validation. The substantive search — the exact "Lib:Name" fast path
 * (score 1, no embedding), otherwise one embedding call plus the vector +
 * trigram candidate pools merged by score = 0.6·cosine + 0.4·trigram — lives
 * in the shared Request-free service `@/app/lib/pcb/footprint-search-service`,
 * so this route and `POST /api/pcb/assign/suggest` share ONE implementation.
 *
 * Returns { hits: FootprintSearchHit[] } — the pinned Stage 2 contract that
 * Stage 4 (AI-assisted footprint assignment) consumes.
 */

import { publicRoute } from "@/app/lib/auth/route-handlers";
import { searchFootprints } from "@/app/lib/pcb/footprint-search-service";
import type { FootprintSearchResponse } from "@/app/lib/pcb/footprint-api-types";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 500;

// [B16.0.12] canonical wrapper — policy -> bounded metadata/body run inside
// the wrapper; the callback receives only bounded projections, never the Request.
export const GET = publicRoute({ query: true }, async ({ meta }): Promise<Response> => {
  const qp = meta.query ?? {};

  const q = (qp.q ?? "").trim();
  if (q === "") {
    return Response.json({ ok: false, error: "q is required" }, { status: 400 });
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return Response.json(
      { ok: false, error: `q must be under ${MAX_QUERY_LENGTH} characters` },
      { status: 400 },
    );
  }
  const limit = clampInt(qp.limit ?? null, DEFAULT_LIMIT, 1, MAX_LIMIT);

  const padCountRaw = qp.padCount ?? null;
  const padCount = padCountRaw === null ? null : Number(padCountRaw);
  if (padCount !== null && (!Number.isInteger(padCount) || padCount < 0)) {
    return Response.json(
      { ok: false, error: "padCount must be a non-negative integer" },
      { status: 400 },
    );
  }
  const smdRaw = qp.smd ?? null;
  if (smdRaw !== null && smdRaw !== "true" && smdRaw !== "false") {
    return Response.json({ ok: false, error: "smd must be true or false" }, { status: 400 });
  }
  const smd = smdRaw === null ? null : smdRaw === "true";

  try {
    const hits = await searchFootprints({ q, limit, padCount, smd });
    const body: FootprintSearchResponse = { hits };
    return Response.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
