import { createCatalogQuery, queryEngineeringCatalog, validateEngineeringCatalogSnapshot } from "@/app/lib/component-selection/catalog";
import { resolveExactIdentity } from "@/app/lib/component-selection/identity";
import type { CatalogQuery, EngineeringCatalogSnapshot } from "@/app/lib/component-selection/types";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";
import { object, COMPONENT_SELECTION_API_MAX_BYTES, COMPONENT_SELECTION_API_DEADLINE_MS } from "../_scope";
export const runtime = "nodejs";
export const POST = authenticatedJsonRoute({ maxBytes: COMPONENT_SELECTION_API_MAX_BYTES, deadlineMs: COMPONENT_SELECTION_API_DEADLINE_MS }, async ({ body }): Promise<Response> => {
  if (!object(body.catalog)) return Response.json({ ok: false, error: "pinned engineering catalog snapshot is required" }, { status: 400 }); const catalog = body.catalog as unknown as EngineeringCatalogSnapshot; const errors = validateEngineeringCatalogSnapshot(catalog); if (errors.length) return Response.json({ ok: false, error: "catalog integrity failed", diagnostics: errors }, { status: 422 });
  if (body.operation === "resolve_identity") { if (typeof body.manufacturerId !== "string" || typeof body.mpn !== "string") return Response.json({ ok: false, error: "manufacturerId and mpn are required" }, { status: 400 }); return Response.json({ ok: true, resolution: resolveExactIdentity({ manufacturerId: body.manufacturerId, mpn: body.mpn, snapshots: catalog.portableSnapshots, now: typeof body.now === "string" ? body.now : undefined }) }, { headers: { "Cache-Control": "no-store" } }); }
  if (!object(body.query)) return Response.json({ ok: false, error: "typed catalog query is required" }, { status: 400 });
  try { const query = createCatalogQuery(body.query as unknown as Omit<CatalogQuery, "queryId" | "deterministicDigest"> & { queryId?: string }); return Response.json({ ok: true, result: queryEngineeringCatalog(catalog, query) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 }); }
});
