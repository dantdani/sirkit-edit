/**
 * POST /api/bom/cart/mouser
 *
 * Body: { state: SchematicState; pricingChoice: DistributorChoice }
 * Returns a Mouser Project Cart CSV as a file download.
 */

import { buildBomRows, isSchematicState, normalizeChoice } from "@/app/lib/bom-builder";
import { bomFailure } from "../../_failure"; // [B19-B I2] a failure is reported, never repeated
import { publicJsonRoute } from "@/app/lib/auth/route-handlers";
import { toMouserCsv } from "@/app/lib/cart-formats";

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
    const csv = toMouserCsv(rows);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="sirkit-bom-mouser.csv"',
      },
    });
  } catch (err) {
    return bomFailure("api/bom/cart/mouser", err);
  }
});
