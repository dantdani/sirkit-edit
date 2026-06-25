/**
 * POST /api/bom/cart/lcsc
 *
 * Body: { state: SchematicState; pricingChoice: DistributorChoice }
 * Returns a generic LCSC BOM Tool CSV as a file download.
 */

import { buildBomRows, isSchematicState, normalizeChoice } from "@/app/lib/bom-builder";
import { toLcscCsv } from "@/app/lib/cart-formats";

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
    const csv = toLcscCsv(rows);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="sirkit-bom-lcsc.csv"',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
