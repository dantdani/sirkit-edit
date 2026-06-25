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
import { buildBomRows, isSchematicState, normalizeChoice } from "@/app/lib/bom-builder";
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

export async function POST(req: Request): Promise<Response> {
  let body: BomBody;
  try {
    body = (await req.json()) as BomBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const state = body.state;
  if (!isSchematicState(state)) {
    return Response.json(
      { ok: false, error: "Body must include a `state` with components/kicadComponents." },
      { status: 400 },
    );
  }

  const pricingChoice = normalizeChoice(body.pricingChoice);
  const forceRefresh = body.forceRefresh === true;

  try {
    const result = await buildBomRows(state, pricingChoice, forceRefresh);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
