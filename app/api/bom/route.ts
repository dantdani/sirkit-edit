/**
 * POST /api/bom
 *
 * Body:  { state: SchematicState; pricingChoice: DistributorChoice }
 * Builds a structured BOM from the schematic and attaches live distributor
 * pricing/stock for the user's chosen source. See app/lib/bom/build.ts.
 *
 * Response: BomResult (ok, rows, totals, cached/fetched counts, warnings).
 */

import type { BomRow, BomLifecycleSummary } from "@/app/lib/bom/build";
import { bomStateRefusal, buildBomRows, checkBomState, normalizeChoice } from "@/app/lib/bom-builder";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { BOM_FORBIDDEN_BODY_KEYS } from "./_scope";
import { bomFailure } from "./_failure";
import type { LineRiskBreakdown, DesignRiskSummary } from "@/app/lib/risk-scoring";

export const runtime = "nodejs";

// Re-exported here so consumers can import the row shape from the route path
// (per the spec) without reaching into the lib internals.
export type { BomRow, BomLifecycleSummary };
export type { LineRiskBreakdown, DesignRiskSummary };

type BomBody = {
  state?: unknown;
  pricingChoice?: unknown;
  forceRefresh?: unknown;
};

// [B16.0.11] canonical wrapper — authorization -> CSRF -> media -> bounded body (8 MB / 30 s) run inside the wrapper.
// [B19-B I2] This route prices LIVE, which spends a metered distributor quota, so it is an AUTHENTICATED project read
// (it was public, and an anonymous caller could spend that quota — repeatedly, with `forceRefresh`). The public export
// and cart routes price from the cache only.
export const POST = authenticatedJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as BomBody & Record<string, unknown>;
  for (const key of BOM_FORBIDDEN_BODY_KEYS) {
    if (key in body) return Response.json({ ok: false, code: "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN", error: `\`${key}\` is server-derived and may not be supplied.` }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const state = body.state;
  const stateCheck = checkBomState(state); // [B19-D I5e row 19] shape and table bounds before any lookup
  if (!stateCheck.ok) return bomStateRefusal(stateCheck);

  const pricingChoice = normalizeChoice(body.pricingChoice);
  const forceRefresh = body.forceRefresh === true;

  try {
    const result = await buildBomRows(stateCheck.state, pricingChoice, { live: true, forceRefresh });
    return Response.json(result);
  } catch (err) {
    return bomFailure("api/bom", err);
  }
});
