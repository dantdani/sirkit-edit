/**
 * POST /api/bom/procurement-packet
 *
 * Body: { state; pricingChoice; title?; buildQuantity?; notes? }
 * Returns a comprehensive procurement CSV (metadata header, per-line detail,
 * total project cost) for sending to contract manufacturers / procurement.
 */

import { bomStateRefusal, buildBomRows, checkBomState, normalizeChoice } from "@/app/lib/bom-builder";
import { bomFailure } from "../_failure"; // [B19-B I2] a failure is reported, never repeated
import { publicJsonRoute } from "@/app/lib/auth/route-handlers";
import { toProcurementPacketCsv } from "@/app/lib/cart-formats";

export const runtime = "nodejs";

type Body = {
  state?: unknown;
  pricingChoice?: unknown;
  title?: unknown;
  buildQuantity?: unknown;
  notes?: unknown;
};

// [B16.0.11] canonical wrapper — exact route policy -> media -> bounded body
// (8 MB / 30 s) run inside the wrapper; the callback receives the parsed body
// only and cannot reach the raw request.
export const POST = publicJsonRoute({ maxBytes: 8_000_000, deadlineMs: 30_000 }, async ({ body: rawBody }): Promise<Response> => {
  const body = rawBody as unknown as Body;
  const stateCheck = checkBomState(body.state, "Body must include a `state`."); // [B19-D I5e row 19] shape and table bounds before any lookup
  if (!stateCheck.ok) return bomStateRefusal(stateCheck);

  const title = typeof body.title === "string" && body.title.trim() !== "" ? body.title.trim() : "sirkit BOM";
  const buildQtyRaw = typeof body.buildQuantity === "number" ? body.buildQuantity : Number(body.buildQuantity);
  const buildQuantity = Number.isFinite(buildQtyRaw) && buildQtyRaw >= 1 ? Math.floor(buildQtyRaw) : 1;
  const notes = typeof body.notes === "string" ? body.notes : "";

  try {
    const { rows } = await buildBomRows(stateCheck.state, normalizeChoice(body.pricingChoice));
    const csv = toProcurementPacketCsv(rows, { title, buildQuantity, date: new Date(), notes });
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="sirkit-procurement-packet.csv"',
      },
    });
  } catch (err) {
    return bomFailure("api/bom/procurement-packet", err);
  }
});
