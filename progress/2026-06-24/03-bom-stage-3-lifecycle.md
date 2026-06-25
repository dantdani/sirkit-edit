# BOM Stage 3: Lifecycle status

**Date**: 2026-06-24
**Status**: Shipped

## What this changed
Distributor responses now include lifecycle status (active/NRND/LTB/EOL/obsolete).
BOM rows show colored badges per part; summary at top shows aggregate counts and
a risk recommendation. Consolidated lifecycle is persisted to parts.lifecycleStatus
using a "worst-wins" rule across distributors.

## New files
- app/lib/distributors/lifecycle.ts — LIFECYCLE_SEVERITY, consolidateLifecycle, mapLifecycleString

## Modified files
- app/lib/distributors/types.ts — added LifecycleStatus type; PartPricing += lifecycleStatus, lifecycleRaw
- app/lib/distributors/digikey.ts — ProductStatus.Status / ProductStatus / MarketStatus → lifecycleRaw
- app/lib/distributors/mouser.ts — part.LifecycleStatus → lifecycleRaw
- app/lib/distributors/octopart.ts — added lifecycleStatus to the GraphQL part query
- app/lib/distributors/index.ts — AggregatedPricing += lifecycleStatus; consolidate + persist to parts.lifecycleStatus (+lastRefreshedAt); re-exports lifecycle helpers
- app/lib/distributors/cache.ts — part_offers read/write carries lifecycleStatus + lifecycleRaw
- app/lib/db/schema.ts — part_offers += lifecycle_status, lifecycle_raw (migration 0002)
- app/lib/bom/build.ts — BomRow += lifecycleStatus; BomResult += lifecycleSummary; summarizeLifecycle()
- app/api/bom/route.ts — re-exports BomLifecycleSummary (response carries summary via buildBom)
- app/components/bom/BomView.tsx — summary card, badge column, sort by severity, "at-risk only" filter
- scripts/refresh-bom-pricing.ts — added --lifecycle flag (7d / unknown cadence over parts table)

## New exports
- type LifecycleStatus (6-state union), type BomLifecycleSummary
- LIFECYCLE_SEVERITY, consolidateLifecycle(statuses), mapLifecycleString(raw)

## Design decisions / Known limitations
- BOM-row lifecycle is sourced from the aggregator's consolidated verdict (live + cached
  offers), NOT from the persisted parts.lifecycleStatus. Stage 1's backfill seeded that column
  to "active" for every part, so falling back to it would violate the "no distributor data →
  unknown" contract. The aggregator still persists real (non-unknown) verdicts to the column
  for durability / future /api/parts + alternates use.
- "Worst-wins": one distributor misreport could flip a part to EOL; manual override is a later stage.
- "At-risk only" filter = severity ≥ NRND (excludes unknown, which the summary card breaks out).
- Mouser sometimes returns blank lifecycle → falls through to "unknown" gracefully.
- No lifecycle-change notifications yet — Stage 7.

## Verification
- pnpm db:generate + db:push: migration 0002 applied ("Changes applied")
- pnpm tsc --noEmit: 0 errors
- pnpm refresh:bom-pricing: "nothing stale" (empty part_offers); --lifecycle: refreshed the
  1 part with an MPN, completed clean (0 offers with no creds configured)
- With no distributor creds: lifecycleSummary tallies all rows as unknown; BOM still renders
- Manual (needs creds): POST /api/bom → each row has lifecycleStatus + response has lifecycleSummary;
  badges render; sort by Lifecycle orders worst→best; parts.lifecycleStatus gets non-"unknown" rows
