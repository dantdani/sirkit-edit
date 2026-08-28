/**
 * GET /api/parts/[id]
 *
 * Full detail for one part — the payload the preview panel hits when a row is
 * clicked. Includes `symbolRaw` (so the client can render the symbol) and all
 * metadata. Returns `part: null` for a missing or malformed id.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { parts, libraries, partsAtomicLinks, type KeySpecs } from "@/app/lib/db/schema";
import type { KicadPin } from "@/app/lib/kicad/types";
import { legacyPartToAtomicDraft, type LegacyAtomicDraft } from "@/app/lib/atomic/compatibility";
import { publicRoute } from "@/app/lib/auth/route-handlers";

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
  isGeneric: boolean;
  /** Draft-only bridge; never represents approval or package proof. */
  atomicCompatibility?: LegacyAtomicDraft;
  /**
   * Published atomic authority links keyed by normalized value ('' = value
   * agnostic default). Present only when a published atomic part revision has
   * been linked to this catalog part — carries exact symbol/footprint/mapping
   * identity for footprint-ready schematic instances.
   */
  atomicAssignments?: Record<string, AtomicAssignment>;
};

type AtomicAssignment = {
  revisionId: string;
  symbolVersionId: string;
  footprintVersionId: string;
  mappingCertificateId: string;
  footprintFullName: string;
  approved: true;
};

// [B16.0.12] canonical wrapper — policy -> bounded metadata/body run inside
// the wrapper; the callback receives only bounded projections, never the Request.
export const GET = publicRoute({ routeParams: ["id"] }, async ({ params }): Promise<Response> => {
  const id = params!.id;

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
        isGeneric: parts.isGeneric,
      })
      .from(parts)
      .innerJoin(libraries, eq(parts.libraryId, libraries.id))
      .where(eq(parts.id, id))
      .limit(1);

    const linkRows = rows[0]
      ? await db
          .select({
            valueKey: partsAtomicLinks.valueKey,
            atomicPartRevisionId: partsAtomicLinks.atomicPartRevisionId,
            symbolAssetVersionId: partsAtomicLinks.symbolAssetVersionId,
            footprintAssetVersionId: partsAtomicLinks.footprintAssetVersionId,
            mappingCertificateId: partsAtomicLinks.mappingCertificateId,
            footprintFullName: partsAtomicLinks.footprintFullName,
          })
          .from(partsAtomicLinks)
          .where(eq(partsAtomicLinks.partId, id))
      : [];
    const atomicAssignments: Record<string, AtomicAssignment> = {};
    for (const link of linkRows) {
      atomicAssignments[link.valueKey] = {
        revisionId: link.atomicPartRevisionId,
        symbolVersionId: link.symbolAssetVersionId,
        footprintVersionId: link.footprintAssetVersionId,
        mappingCertificateId: link.mappingCertificateId,
        footprintFullName: link.footprintFullName,
        approved: true,
      };
    }

    const row = rows[0] ?? null;
    const part: PartDetail | null = row
      ? {
          ...row,
          ...(linkRows.length ? { atomicAssignments } : {}),
          atomicCompatibility: legacyPartToAtomicDraft({
            id: row.id,
            name: row.name,
            mpn: row.mpn,
            manufacturer: row.manufacturer,
            libraryName: row.libraryName,
            symbolRaw: row.symbolRaw,
            pins: row.pins,
            properties: row.properties,
            footprintHint: row.footprintHint,
            isGeneric: row.isGeneric,
          }),
        }
      : null;
    return Response.json({ ok: true, part });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
});
