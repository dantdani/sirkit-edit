# Generic-part filter + MPN backfill

**Date**: 2026-06-25
**Status**: Shipped

## What this changed
The Build-mode AI was picking KiCad generic template symbols (Device.R, Device.C_Small,
Connector_Generic_*) as if orderable. Added an `is_generic` flag on parts, backfilled it
for all parts in the catalog, and updated the search to exclude generics by default.
Also backfilled `mpn` from `name` for parts whose symbol name is clearly an MPN.

## New files
- scripts/backfill-mpn-and-generics.ts — one-shot, idempotent script to mark generics and fill MPNs

## Modified files
- app/lib/db/schema.ts — added `is_generic` boolean column to parts (default false, NOT NULL) + `parts_is_generic_idx`
- app/lib/parts-normalization.ts — added GENERIC_LIBRARIES, GENERIC_EXACT_NAMES, GENERIC_NAME_PATTERNS, isGenericPart(), looksLikeMpn()
- app/lib/parts-search.ts — searchPartsForAI accepts `options.excludeGenerics` (default true); applies `is_generic = false` to both the vector and lexical recall queries
- app/api/parts/search/route.ts — accepts `includeGenerics` (query param or body field); default excludes generics
- package.json — added `backfill:mpn-generics` script

## New exports
- GENERIC_LIBRARIES, GENERIC_EXACT_NAMES, GENERIC_NAME_PATTERNS constants
- isGenericPart(part) → boolean
- looksLikeMpn(s) → boolean

## TODOs / Known limitations
- is_generic detection is heuristic; rare edge cases may be miscategorized either way.
- MPN-from-name backfill is heuristic; some non-MPN symbol names may be copied to mpn — harmless (distributor lookups just return null).
- MPN backfill skips rows whose normalized_mpn collides with an existing part (partial unique index), counted in the summary.
- Future polish: a "Show templates" toggle in the Build library panel (passes includeGenerics=true).
- Future polish: system-prompt nudge in /api/schematic/build to prefer specific parts if a generic ever slips through (deliberately NOT done — fixed at the data layer instead).

## Notes / deviations
- `pnpm db:push` failed mid-introspection because the Supabase session pooler (cap 15)
  was saturated by the running dev server's connection pool. Resolved by stopping the dev
  server and applying the generated migration (drizzle/0004_sticky_kabuki.sql) directly via
  the project's postgres client with idempotent `IF NOT EXISTS` DDL. Restart `pnpm dev` after.
- The route uses its own browse/semantic queries (not searchPartsForAI), so the generic
  filter was added to its WHERE clause directly — same default-exclude behavior as specified.

## Verification
- `pnpm tsc --noEmit` → 0 errors
- `drizzle-kit generate` → drizzle/0004_sticky_kabuki.sql (ADD COLUMN is_generic + index); applied to DB (22,756 parts)
- `pnpm backfill:mpn-generics` → completes and prints final summary (see below)
- SQL spot check:
    SELECT COUNT(*) FROM parts WHERE is_generic = true   -- expect ~200-500
    SELECT COUNT(*) FROM parts WHERE mpn IS NOT NULL      -- jumps significantly post-backfill
- GET /api/parts/search {query:"resistor"} → specific Yageo/Vishay/Panasonic parts, not Device.R
- GET /api/parts/search {query:"resistor", includeGenerics:true} → Device.R may appear
- Regenerate a Build-mode circuit → BOM shows real MPNs + distributor pricing
