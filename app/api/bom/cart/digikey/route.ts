/**
 * POST /api/bom/cart/digikey
 *
 * Body: { state: SchematicState; pricingChoice: DistributorChoice }
 * Returns a DigiKey BOM Manager CSV as a file download.
 */

import { buildBomRows, isSchematicState, normalizeChoice } from "@/app/lib/bom-builder";
import { toDigiKeyCsv } from "@/app/lib/cart-formats";

export const runtime = "nodejs";

type Body = { state?: unknown; pricingChoice?: unknown };

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
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
}
