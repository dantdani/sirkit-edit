/**
 * POST /api/bom/export-csv
 *
 * Same body as /api/bom. Returns the BOM as a downloadable CSV with live
 * pricing columns. Reuses app/lib/bom/build.ts so the CSV matches the table.
 */

import { buildBom, bomToCsv } from "@/app/lib/bom/build";
import { bomFailure } from "../_failure"; // [B19-B I2] a failure is reported, never repeated
import { publicJsonRoute } from "@/app/lib/auth/route-handlers";
import type { DistributorChoice } from "@/app/lib/distributors";
import type { SchematicState } from "@/lib/schematic-types";

export const runtime = "nodejs";

const VALID_CHOICES: DistributorChoice[] = ["none", "digikey", "mouser", "octopart", "all"];

type BomBody = {
  state?: unknown;
  pricingChoice?: unknown;
};

// [B16.0.11] canonical wrapper — exact route policy -> media -> bounded body
// (8 MB / 30 s) run inside the wrapper; the callback receives the parsed body
// only and cannot reach the raw request.
export const POST = publicJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as BomBody;

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
    return bomFailure("api/bom/export-csv", err);
  }
});

function isSchematicState(value: unknown): value is SchematicState {
  if (!value || typeof value !== "object") return false;
  return Array.isArray((value as Record<string, unknown>).components);
}
