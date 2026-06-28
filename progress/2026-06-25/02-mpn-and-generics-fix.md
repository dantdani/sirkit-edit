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

## Notes / deviations (Supabase pooler saga)
- `pnpm db:push` failed mid-introspection because the Supabase **session** pooler (hard cap
  15 clients) was saturated by the running dev server's connection pool. Applied the generated
  migration (drizzle/0004_sticky_kabuki.sql) directly via the project's postgres client with
  idempotent `IF NOT EXISTS` DDL instead.
- The backfill then kept hitting `EMAXCONNSESSION` (session pooler full) and, once switched to
  the **transaction** pooler (port 6543, swap `:5432`→`:6543` in DATABASE_URL — far higher
  client limit), hit Postgres `statement_timeout` on large set-statements. Final, robust shape:
  keyset pagination (no growing OFFSET), small 200-row batches, set-based bulk UPDATEs via
  `unnest`, normalized_mpn conflicts pre-filtered, transient-timeout retry, and a `finally` that
  always closes the pool (a crashed run leaking idle session-pool clients is what starves the cap).
- The route uses its own browse/semantic queries (not searchPartsForAI), so the generic
  filter was added to its WHERE clause directly — same default-exclude behavior as specified.

## Verification (all passed)
- `pnpm tsc --noEmit` → 0 errors
- `drizzle-kit generate` → drizzle/0004_sticky_kabuki.sql (ADD COLUMN is_generic + parts_is_generic_idx); applied to live DB (22,756 parts)
- `pnpm backfill:mpn-generics` → Done: 22,756 processed, **1,877 marked generic**, 1,638 mpn backfilled (this pass; earlier passes committed more), 340 skipped on normalized_mpn conflict
- SQL spot check (live DB):
    SELECT COUNT(*) FROM parts WHERE is_generic = true  → 1,877
    SELECT COUNT(*) FROM parts WHERE mpn IS NOT NULL     → 20,541 / 22,756
  generics by library: Device 537, Connector_Generic* ~1,000, Connector 127, power 101, Simulation_SPICE 42, Graphic 30
  key parts: ESP32-WROOM-32U, AMS1117-3.3, AMS1117CD-3.3 → mpn set, is_generic=false
- Note: 1,877 generics (vs the rough 200–500 estimate) is expected — the `^Conn_\d+x\d+` pattern
  correctly flags the long tail of generic headers in Connector_Generic* and Connector.
- Still to eyeball in-app (needs running dev server): GET /api/parts/search {query:"resistor"}
  returns specific Yageo/Vishay parts not Device.R; `includeGenerics:true` lets Device.R back in;
  a regenerated Build-mode circuit shows real MPNs + distributor pricing in the BOM.
