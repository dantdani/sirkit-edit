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
import { selectableRevisionIdSql } from "@/app/lib/atomic/revision-status-sql";
import { publicRoute } from "@/app/lib/auth/route-handlers";

import { fixtureContainer } from "@/app/lib/fixture-runtime/container";
import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode";
import { partLifecycleStatus } from "@/app/lib/distributors/lifecycle-sql"; // [B19-D I5b review] vendor lifecycle expires at read time
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
   * agnostic default). Present only when a published, never-withdrawn atomic
   * part revision has been linked to this catalog part — carries exact symbol/footprint/mapping
   * identity for footprint-ready schematic instances.
   */
  atomicAssignments?: Record<string, AtomicAssignment>;
  /** [B19-E E3 review] value keys whose own link points at a withdrawn or missing revision: no '' default fallback for them */
  withdrawnValueKeys?: string[];
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

  // [B16-C §5] fixture runtime: serve the committed blinker catalog part exactly as the
  // browser cache expects it (no database). Catalog ids are stable names, not database
  // UUIDs, so the catalog is consulted BEFORE the UUID shape check (the browser proof
  // found every part reported "not found" behind it). Unknown ids are `null`, as in production.
  if (fixtureRuntimeEnabled()) {
    const cached = fixtureContainer().catalog.cachedParts.get(id);
    if (!cached) return Response.json({ ok: true, part: null });
    const part: PartDetail = {
      id: cached.id, name: cached.name, description: cached.description ?? null, keywords: null, mpn: cached.mpn ?? null, manufacturer: cached.manufacturer ?? null, datasheet: cached.datasheet ?? null,
      footprintHint: cached.footprintHint ?? null, mainCategory: cached.mainCategory, libraryName: cached.libraryName, pins: cached.pins, symbolRaw: cached.symbolRaw, properties: cached.properties ?? {},
      internalPartNumber: null, lifecycleStatus: null, rohsStatus: null, packageNormalized: null, keySpecs: null, isGeneric: false,
      ...(cached.atomicAssignments ? { atomicAssignments: cached.atomicAssignments as PartDetail["atomicAssignments"] } : {}),
      ...(cached.withdrawnValueKeys ? { withdrawnValueKeys: cached.withdrawnValueKeys } : {}),
    };
    return Response.json({ ok: true, part });
  }

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
        lifecycleStatus: partLifecycleStatus,
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
            selectable: selectableRevisionIdSql(partsAtomicLinks.atomicPartRevisionId),
          })
          .from(partsAtomicLinks)
          .where(eq(partsAtomicLinks.partId, id))
      : [];
    const atomicAssignments: Record<string, AtomicAssignment> = {};
    const withdrawnValueKeys: string[] = [];
    for (const link of linkRows) {
      // [B19-E E3] a link to a withdrawn or missing revision is no assignment for a new selection; approved is derived
      if (link.selectable !== true) {
        if (link.valueKey !== "") withdrawnValueKeys.push(link.valueKey); // [B19-E E3 review] ...and no '' default fallback
        continue;
      }
      atomicAssignments[link.valueKey] = {
        revisionId: link.atomicPartRevisionId,
        symbolVersionId: link.symbolAssetVersionId,
        footprintVersionId: link.footprintAssetVersionId,
        mappingCertificateId: link.mappingCertificateId,
        footprintFullName: link.footprintFullName,
        approved: link.selectable,
      };
    }

    const row = rows[0] ?? null;
    const part: PartDetail | null = row
      ? {
          ...row,
          ...(Object.keys(atomicAssignments).length ? { atomicAssignments } : {}),
          ...(withdrawnValueKeys.length ? { withdrawnValueKeys } : {}),
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
