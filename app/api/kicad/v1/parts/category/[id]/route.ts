import { asc, eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { atomicPartRevisions } from "@/app/lib/db/schema";
import { kicadLibraryRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

// [B16.0.12] canonical narrow variant — the constant-time KiCad token boundary
// runs inside the wrapper BEFORE parameter processing; the callback receives a
// bounded plain param record, never the Authorization header or the Request.
export const GET = kicadLibraryRoute({ routeParams: ["id"] }, async ({ params }): Promise<Response> => {
  const raw = params!.id;
  const id = raw.endsWith(".json") ? raw.slice(0, -5) : raw;
  if (id !== "published") return Response.json([], { status: 200 });
  try {
    const rows = await getDb().select({ id: atomicPartRevisions.id, revision: atomicPartRevisions.revisionData })
      .from(atomicPartRevisions)
      .where(eq(atomicPartRevisions.publicationState, "published"))
      .orderBy(asc(atomicPartRevisions.id))
      .limit(5_000);
    return Response.json(rows.map((row) => ({
      id: row.id,
      name: row.revision.exactPartId ?? row.revision.genericDeviceId ?? row.id,
      description: "Sirkit evidence-backed atomic component revision",
      keywords: "sirkit atomic component",
    })));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Catalog unavailable" }, { status: 500 });
  }
});
