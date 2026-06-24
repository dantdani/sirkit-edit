/**
 * POST /api/bom
 *
 * Body:  { state: SchematicState; pricingChoice: DistributorChoice }
 * Builds a structured BOM from the schematic and attaches live distributor
 * pricing/stock for the user's chosen source. See app/lib/bom/build.ts.
 *
 * Response: BomResult (ok, rows, totals, cached/fetched counts, warnings).
 */

import { buildBom, type BomRow } from "@/app/lib/bom/build";
import type { DistributorChoice } from "@/app/lib/distributors";
import type { SchematicState } from "@/lib/schematic-types";

export const runtime = "nodejs";

// Re-exported here so consumers can import the row shape from the route path
// (per the spec) without reaching into the lib internals.
export type { BomRow };

const VALID_CHOICES: DistributorChoice[] = ["none", "digikey", "mouser", "octopart", "all"];

type BomBody = {
  state?: unknown;
  pricingChoice?: unknown;
  forceRefresh?: unknown;
};

/** Coerce an incoming choice (incl. the legacy "both") to the current union. */
function normalizeChoice(raw: unknown): DistributorChoice {
  if (raw === "both") return "all"; // legacy persisted value
  return VALID_CHOICES.includes(raw as DistributorChoice) ? (raw as DistributorChoice) : "none";
}

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
    const result = await buildBom(state, pricingChoice, forceRefresh);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

function isSchematicState(value: unknown): value is SchematicState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  // `components` is the only required array; kicadComponents/wires are optional.
  return Array.isArray(v.components);
}
