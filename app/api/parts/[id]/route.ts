/**
 * GET /api/parts/[id]
 *
 * Full detail for one part — the payload the preview panel hits when a row is
 * clicked. Includes `symbolRaw` (so the client can render the symbol) and all
 * metadata. Returns `part: null` for a missing or malformed id.
 *
 * [PR-D d2] The read itself is the shared `loadCatalogPartDetail` (app/lib/atomic/catalog-part-detail.ts), extracted from this
 * route unchanged (the fixture branch, the UUID check before any database read, the expiring lifecycle expression, the link rules)
 * so the agent's `sirkit.parts.catalog-inspect` reads the SAME function through the chat route's injected port: one reader. This
 * route is its only HTTP surface and keeps its exact response contract.
 */

import { loadCatalogPartDetail } from "@/app/lib/atomic/catalog-part-detail";
import { publicRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.12] canonical wrapper — policy -> bounded metadata/body run inside
// the wrapper; the callback receives only bounded projections, never the Request.
export const GET = publicRoute({ routeParams: ["id"] }, async ({ params }): Promise<Response> => {
  const id = params!.id;
  try {
    const part = await loadCatalogPartDetail(id);
    return Response.json({ ok: true, part });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
