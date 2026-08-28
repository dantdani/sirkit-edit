import { and, asc, eq, gt } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { atomicPartRevisions } from "@/app/lib/db/schema";
import { semanticHash } from "@/app/lib/atomic/stable";
import { publicRoute } from "@/app/lib/auth/route-handlers";

export const runtime = "nodejs";

/** Read-only, stable-id paginated catalog view for approved clients/KiCad glue. */
// [B16.0.12] canonical wrapper — policy -> bounded metadata/body run inside
// the wrapper; the callback receives only bounded projections, never the Request.
export const GET = publicRoute({ query: true }, async ({ meta }): Promise<Response> => {
  const requested = Number(meta.query?.limit ?? "50");
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.floor(requested))) : 50;
  const after = meta.query?.after ?? null;
  try {
    const rows = await getDb()
      .select({ id: atomicPartRevisions.id, semanticHash: atomicPartRevisions.semanticHash, revision: atomicPartRevisions.revisionData })
      .from(atomicPartRevisions)
      .where(and(eq(atomicPartRevisions.publicationState, "published"), after ? gt(atomicPartRevisions.id, after) : undefined))
      .orderBy(asc(atomicPartRevisions.id))
      .limit(limit + 1);
    const snapshotRows = await getDb()
      .select({ id: atomicPartRevisions.id })
      .from(atomicPartRevisions)
      .where(eq(atomicPartRevisions.publicationState, "published"))
      .orderBy(asc(atomicPartRevisions.id));
    const items = rows.slice(0, limit).map((row) => ({
      id: row.id,
      semanticHash: row.semanticHash,
      exactPartId: row.revision.exactPartId ?? null,
      genericDeviceId: row.revision.genericDeviceId ?? null,
      cadBundles: row.revision.cadBundles,
      publicationState: row.revision.publicationState,
    }));
    return Response.json({
      ok: true,
      readonly: true,
      catalogSnapshotId: `catalog_${semanticHash(snapshotRows.map((row) => row.id))}`,
      items,
      nextCursor: rows.length > limit ? items[items.length - 1]?.id ?? null : null,
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Atomic catalog unavailable" }, { status: 500 });
  }
});
