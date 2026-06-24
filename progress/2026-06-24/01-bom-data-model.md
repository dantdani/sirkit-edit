# BOM Stage 1: Component data model extension

**Date**: 2026-06-24
**Status**: Shipped

## What this changed
Extended the parts table with normalized MPN, internal part number, lifecycle status,
RoHS status, package, and per-category key specs. Added part_offers cache table and
alternates table for future Stages 2 and 4. Backfilled all existing parts.

## New files
- app/lib/parts-normalization.ts — MPN/package normalization, key-spec extraction, IPN generation
- scripts/backfill-parts.ts — one-shot script to populate new columns for existing parts

## Modified files
- app/lib/db/schema.ts — added 7 columns to parts (incl. last_refreshed_at); added partOffers and alternates tables; partial UNIQUE index on normalized_mpn
- app/api/parts/search/route.ts — include lifecycleStatus, rohsStatus, packageNormalized, internalPartNumber (no keySpecs, no shape break)
- app/api/parts/[id]/route.ts — include the above plus keySpecs
- package.json — added "backfill:parts" script

## New exports
- normalizeMpn(mpn) → string
- normalizePackage(raw) → string | null
- categorizeForKeySpecs(part) → KeySpecs["kind"]
- extractKeySpecs(part) → KeySpecs
- generateInternalPartNumber(part, specs, pkg) → string
- deriveLifecycleStatusFromKicad(part) → "active" | "unknown"
- deriveRohsStatusFromKicad(part) → "unknown"
- type KeySpecs (discriminated union), type PartRow
- Drizzle tables: partOffers, alternates (+ inferred row types)

## TODOs / Known limitations
- normalized_mpn is populated ONLY for parts that actually carry an MPN, and is deduped
  (first id wins) so the partial UNIQUE index can't be violated. KiCad generics (no MPN)
  keep normalized_mpn = NULL — so COUNT(normalized_mpn) < row count by design. The original
  spec's `normalizeMpn(mpn ?? name)` fallback would mass-collide names across libraries and
  break the UNIQUE index, so it was intentionally not used.
- lifecycleStatus is "active" or "unknown" for everything — Stage 3 pulls real distributor data
- rohsStatus is "unknown" everywhere — Stage 3 fills it
- alternates table is empty — Stage 4 computes and populates it
- part_offers cache is empty — Stage 2 populates it as the BOM endpoint refreshes pricing
- key-spec extraction is best-effort regex; most KiCad catalog parts carry no concrete value
  (resistance/capacitance live on the schematic instance), so many specs are partial/empty

## Verification
- pnpm db:generate → drizzle/0001_smooth_vengeance.sql; pnpm db:push → "Changes applied"
- pnpm backfill:parts completes, printing "Processed N / N parts" and a summary line
- pnpm tsc --noEmit: 0 errors
- Supabase: SELECT COUNT(*) FROM parts WHERE internal_part_number IS NOT NULL = row count;
  normalized_mpn IS NOT NULL = subset with real MPNs (see limitation above)
- GET /api/parts/<id> returns internalPartNumber, lifecycleStatus, rohsStatus,
  packageNormalized, keySpecs
