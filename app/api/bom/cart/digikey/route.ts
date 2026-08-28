/**
 * POST /api/bom/cart/digikey
 *
 * Body: { state: SchematicState; pricingChoice: DistributorChoice }
 * Returns a DigiKey BOM Manager CSV as a file download.
 */

import { buildBomRows, isSchematicState, normalizeChoice } from "@/app/lib/bom-builder";
import { publicJsonRoute } from "@/app/lib/auth/route-handlers";
import { toDigiKeyCsv } from "@/app/lib/cart-formats";

export const runtime = "nodejs";

type Body = { state?: unknown; pricingChoice?: unknown };

// [B16.0.11] canonical wrapper — exact route policy -> media -> bounded body
// (8 MB / 30 s) run inside the wrapper; the callback receives the parsed body
// only and cannot reach the raw request.
export const POST = publicJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as Body;
  if (!isSchematicState(body.state)) {
    return Response.json({ ok: false, error: "Body must include a `state`." }, { status: 400 });
  }
  try {
    const { rows } = await buildBomRows(body.state, normalizeChoice(body.pricingChoice));
    const csv = toDigiKeyCsv(rows);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="sirkit-bom-digikey.csv"',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
