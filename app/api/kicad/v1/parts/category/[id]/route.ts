import { asc, eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { atomicPartRevisions } from "@/app/lib/db/schema";
import { authorizeKicadHttpLibrary } from "@/app/lib/atomic/server-auth";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = authorizeKicadHttpLibrary(request);
  if (denied) return denied;
  const raw = (await context.params).id;
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
}
