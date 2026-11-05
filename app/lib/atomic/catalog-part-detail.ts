/**
 * [PR-D d2] The ONE catalog part detail read: what `GET /api/parts/[id]` answers the browser's part cache with (app/lib/parts-cache.ts
 * `CachedPart`), extracted from the route body unchanged so the agent's `sirkit.parts.catalog-inspect` reads the SAME function through
 * the chat route's injected port (app/api/chat/catalog-inspection-runtime.ts) - one reader, no second query.
 *
 *  - the fixture runtime serves the committed blinker catalog part by its stable (non-UUID) id, consulted BEFORE the UUID shape check
 *    (B16-C §5); an unknown id is `null`, as in production;
 *  - a malformed id is `null` with ZERO database reads (the historical in-bound behavior, B16.0.12);
 *  - the lifecycle status is read through the expiring expression (`partLifecycleStatus`, B19-D I5b review);
 *  - a link to a withdrawn or missing revision is no assignment for a new selection and names its value key in `withdrawnValueKeys`
 *    (B19-E E3 review, E4 review follow-up); `approved` is derived from selectability, never stored.
 *
 * Server-only (database client); the route stays the only HTTP surface.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/app/lib/db/client";
import { parts, libraries, partsAtomicLinks, type KeySpecs } from "@/app/lib/db/schema";
import type { KicadPin } from "@/app/lib/kicad/types";
import { legacyPartToAtomicDraft, type LegacyAtomicDraft } from "@/app/lib/atomic/compatibility";
import { selectableRevisionIdSql } from "@/app/lib/atomic/revision-status-sql";
import { fixtureContainer } from "@/app/lib/fixture-runtime/container";
import { fixtureRuntimeEnabled } from "@/app/lib/fixture-runtime/mode";
import { partLifecycleStatus } from "@/app/lib/distributors/lifecycle-sql"; // [B19-D I5b review] vendor lifecycle expires at read time

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CatalogPartLifecycleStatus =
  | "active" | "nrnd" | "last_time_buy" | "eol" | "obsolete" | "unknown";
export type CatalogPartRohsStatus = "compliant" | "non_compliant" | "unknown";

/** The route's `PartDetail`: the browser's `CachedPart` plus the BOM data-model fields (Stage 1). */
export type CatalogPartDetail = {
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
  lifecycleStatus: CatalogPartLifecycleStatus | null;
  rohsStatus: CatalogPartRohsStatus | null;
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
  atomicAssignments?: Record<string, CatalogPartAtomicAssignment>;
  /**
   * [B19-E E3 review] value keys whose own link points at a withdrawn or missing revision: no '' default fallback for them.
   * [B19-E E4 review follow-up] '' is included when the default link itself points at one.
   */
  withdrawnValueKeys?: string[];
};

export type CatalogPartAtomicAssignment = {
  revisionId: string;
  symbolVersionId: string;
  footprintVersionId: string;
  mappingCertificateId: string;
  footprintFullName: string;
  approved: true;
};

/** Whether `id` has the UUID shape a production catalog part id has (the fixture catalog's ids are stable names, checked first). */
export function isCatalogPartUuid(id: string): boolean {
  return UUID_RE.test(id);
}

/**
 * The full detail of one catalog part, or `null` for a missing or malformed id (never a throw for those; a database failure throws,
 * and the route answers it as its 500).
 */
export async function loadCatalogPartDetail(id: string): Promise<CatalogPartDetail | null> {
  // [B16-C §5] fixture runtime: serve the committed blinker catalog part exactly as the
  // browser cache expects it (no database). Catalog ids are stable names, not database
  // UUIDs, so the catalog is consulted BEFORE the UUID shape check (the browser proof
  // found every part reported "not found" behind it). Unknown ids are `null`, as in production.
  if (fixtureRuntimeEnabled()) {
    const cached = fixtureContainer().catalog.cachedParts.get(id);
    if (!cached) return null;
    return {
      id: cached.id, name: cached.name, description: cached.description ?? null, keywords: null, mpn: cached.mpn ?? null, manufacturer: cached.manufacturer ?? null, datasheet: cached.datasheet ?? null,
      footprintHint: cached.footprintHint ?? null, mainCategory: cached.mainCategory, libraryName: cached.libraryName, pins: cached.pins, symbolRaw: cached.symbolRaw, properties: cached.properties ?? {},
      internalPartNumber: null, lifecycleStatus: null, rohsStatus: null, packageNormalized: null, keySpecs: null, isGeneric: false,
      ...(cached.atomicAssignments ? { atomicAssignments: cached.atomicAssignments as CatalogPartDetail["atomicAssignments"] } : {}),
      ...(cached.withdrawnValueKeys ? { withdrawnValueKeys: cached.withdrawnValueKeys } : {}),
    };
  }

  if (!UUID_RE.test(id)) return null;

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
  const atomicAssignments: Record<string, CatalogPartAtomicAssignment> = {};
  const withdrawnValueKeys: string[] = [];
  for (const link of linkRows) {
    // [B19-E E3] a link to a withdrawn or missing revision is no assignment for a new selection; approved is derived
    if (link.selectable !== true) {
      // [B19-E E3 review] ...and no '' default fallback. [B19-E E4 review follow-up] the '' default is reported too: the part still
      // HAS that link (a publication never repoints it); valueKeyLink's fallback check reads only a value's own key, so no
      // value's link changes
      withdrawnValueKeys.push(link.valueKey);
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
  return row
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
}
