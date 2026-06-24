/**
 * GET /api/parts/[id]
 *
 * Full detail for one part — the payload the preview panel hits when a row is
 * clicked. Includes `symbolRaw` (so the client can render the symbol) and all
 * metadata. Returns `part: null` for a missing or malformed id.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { parts, libraries, type KeySpecs } from "@/app/lib/db/schema";
import type { KicadPin } from "@/app/lib/kicad/types";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LifecycleStatus =
  | "active" | "nrnd" | "last_time_buy" | "eol" | "obsolete" | "unknown";
type RohsStatus = "compliant" | "non_compliant" | "unknown";

type PartDetail = {
  id: string;
  name: string;
  description: string | null;
  keywords: string | null;
  mpn: string | null;
  manufacturer: string | null;
  datasheet: string | null;
  footprintHint: string | null;
  mainCategory: string;
  libraryName: string;
  pins: KicadPin[];
  symbolRaw: string;
  properties: Record<string, string>;
  // BOM data-model fields (Stage 1).
  internalPartNumber: string | null;
  lifecycleStatus: LifecycleStatus | null;
  rohsStatus: RohsStatus | null;
  packageNormalized: string | null;
  keySpecs: KeySpecs | null;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  if (!UUID_RE.test(id)) {
    return Response.json({ ok: true, part: null });
  }

  try {
    const db = getDb();
    const rows = await db
      .select({
        id: parts.id,
        name: parts.name,
        description: parts.description,
        keywords: parts.keywords,
        mpn: parts.mpn,
        manufacturer: parts.manufacturer,
        datasheet: parts.datasheet,
        footprintHint: parts.footprintHint,
        mainCategory: libraries.mainCategory,
        libraryName: libraries.name,
        pins: parts.pins,
        symbolRaw: parts.symbolRaw,
        properties: parts.properties,
        internalPartNumber: parts.internalPartNumber,
        lifecycleStatus: parts.lifecycleStatus,
        rohsStatus: parts.rohsStatus,
        packageNormalized: parts.packageNormalized,
        keySpecs: parts.keySpecs,
      })
      .from(parts)
      .innerJoin(libraries, eq(parts.libraryId, libraries.id))
      .where(eq(parts.id, id))
      .limit(1);

    const part: PartDetail | null = rows[0] ?? null;
    return Response.json({ ok: true, part });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
