/**
 * POST /api/bom/procurement-packet
 *
 * Body: { state; pricingChoice; title?; buildQuantity?; notes? }
 * Returns a comprehensive procurement CSV (metadata header, per-line detail,
 * total project cost) for sending to contract manufacturers / procurement.
 */

import { buildBomRows, isSchematicState, normalizeChoice } from "@/app/lib/bom-builder";
import { toProcurementPacketCsv } from "@/app/lib/cart-formats";

export const runtime = "nodejs";

type Body = {
  state?: unknown;
  pricingChoice?: unknown;
  title?: unknown;
  buildQuantity?: unknown;
  notes?: unknown;
};

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

  const title = typeof body.title === "string" && body.title.trim() !== "" ? body.title.trim() : "sirkit BOM";
  const buildQtyRaw = typeof body.buildQuantity === "number" ? body.buildQuantity : Number(body.buildQuantity);
  const buildQuantity = Number.isFinite(buildQtyRaw) && buildQtyRaw >= 1 ? Math.floor(buildQtyRaw) : 1;
  const notes = typeof body.notes === "string" ? body.notes : "";

  try {
    const { rows } = await buildBomRows(body.state, normalizeChoice(body.pricingChoice));
    const csv = toProcurementPacketCsv(rows, { title, buildQuantity, date: new Date(), notes });
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="sirkit-procurement-packet.csv"',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
