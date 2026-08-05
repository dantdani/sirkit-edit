import { createCatalogQuery, queryEngineeringCatalog, validateEngineeringCatalogSnapshot } from "@/app/lib/component-selection/catalog";
import { resolveExactIdentity } from "@/app/lib/component-selection/identity";
import type { CatalogQuery, EngineeringCatalogSnapshot } from "@/app/lib/component-selection/types";
import { object, scopedJson } from "../_scope";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  const parsed = await scopedJson(request); if (!parsed.ok) return parsed.response; const { body } = parsed;
  if (!object(body.catalog)) return Response.json({ ok: false, error: "pinned engineering catalog snapshot is required" }, { status: 400 }); const catalog = body.catalog as unknown as EngineeringCatalogSnapshot; const errors = validateEngineeringCatalogSnapshot(catalog); if (errors.length) return Response.json({ ok: false, error: "catalog integrity failed", diagnostics: errors }, { status: 422 });
  if (body.operation === "resolve_identity") { if (typeof body.manufacturerId !== "string" || typeof body.mpn !== "string") return Response.json({ ok: false, error: "manufacturerId and mpn are required" }, { status: 400 }); return Response.json({ ok: true, resolution: resolveExactIdentity({ manufacturerId: body.manufacturerId, mpn: body.mpn, snapshots: catalog.portableSnapshots, now: typeof body.now === "string" ? body.now : undefined }) }, { headers: { "Cache-Control": "no-store" } }); }
  if (!object(body.query)) return Response.json({ ok: false, error: "typed catalog query is required" }, { status: 400 });
  try { const query = createCatalogQuery(body.query as unknown as Omit<CatalogQuery, "queryId" | "deterministicDigest"> & { queryId?: string }); return Response.json({ ok: true, result: queryEngineeringCatalog(catalog, query) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 422 }); }
}
