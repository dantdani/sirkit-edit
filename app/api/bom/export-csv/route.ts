/**
 * POST /api/bom/export-csv
 *
 * Same body as /api/bom. Returns the BOM as a downloadable CSV with live
 * pricing columns. Reuses app/lib/bom/build.ts so the CSV matches the table.
 */

import { buildBom, bomToCsv } from "@/app/lib/bom/build";
import type { DistributorChoice } from "@/app/lib/distributors";
import type { SchematicState } from "@/lib/schematic-types";

export const runtime = "nodejs";

const VALID_CHOICES: DistributorChoice[] = ["none", "digikey", "mouser", "octopart", "all"];

type BomBody = {
  state?: unknown;
  pricingChoice?: unknown;
};

export async function POST(req: Request): Promise<Response> {
  let body: BomBody;
  try {
    body = (await req.json()) as BomBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isSchematicState(body.state)) {
    return Response.json(
      { ok: false, error: "Body must include a `state` with components/kicadComponents." },
      { status: 400 },
    );
  }

  const pricingChoice: DistributorChoice =
    body.pricingChoice === "both"
      ? "all" // legacy persisted value
      : VALID_CHOICES.includes(body.pricingChoice as DistributorChoice)
        ? (body.pricingChoice as DistributorChoice)
        : "none";

  try {
    const result = await buildBom(body.state, pricingChoice);
    const csv = bomToCsv(result);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="sirkit-bom.csv"',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

function isSchematicState(value: unknown): value is SchematicState {
  if (!value || typeof value !== "object") return false;
  return Array.isArray((value as Record<string, unknown>).components);
}
