import type { ComponentQuery } from "@/app/lib/atomic/types";
import { searchPublishedAtomicCatalog } from "@/app/lib/atomic/server-search";

export const runtime = "nodejs";

function isQuery(value: unknown): value is ComponentQuery {
  if (!value || typeof value !== "object") return false;
  const query = value as Record<string, unknown>;
  return typeof query.queryId === "string"
    && typeof query.catalogSnapshotId === "string"
    && typeof query.policyVersion === "string"
    && (query.unknownPolicy === "block" || query.unknownPolicy === "allow_with_warning")
    && Array.isArray(query.hard)
    && Array.isArray(query.soft)
    && typeof query.limit === "number";
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    if (!isQuery(body)) return Response.json({ ok: false, error: "Invalid structured component query" }, { status: 400 });
    const result = await searchPublishedAtomicCatalog({ ...body, limit: Math.max(0, Math.min(100, Math.floor(body.limit))) });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Atomic search failed";
    return Response.json({ ok: false, error: message }, { status: /different catalog snapshot/.test(message) ? 409 : 500 });
  }
}

