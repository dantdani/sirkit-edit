# BOM Stage 2: Multi-source pricing + Mouser

**Date**: 2026-06-24
**Status**: Shipped

## What this changed
Added Mouser distributor client, replaced in-memory cache with persistent
part_offers-backed cache, rewrote aggregator to query all configured
distributors in parallel, and updated BOM view to show all sources with
best-price highlighting.

## New files
- app/lib/distributors/mouser.ts — Mouser Search API client (2s-spaced queue)
- app/lib/distributors/lcsc.ts — stub; throws on instantiation
- scripts/refresh-bom-pricing.ts — background refresh for stale cached offers

## Modified files
- app/lib/distributors/types.ts — PartPricing.distributor union += mouser/lcsc; added optional `sku`
- app/lib/distributors/cache.ts — kept in-memory primitives (used by digikey/octopart); added part_offers DB cache (getCachedOffer/putCachedOffer/getCachedOffersForParts) + 5-min/200-entry request-scope LRU + evictCached
- app/lib/distributors/index.ts — new DistributorChoice ("all"), AggregatedPricing (offers/bestOverall/sourcesQueried/sourcesFromCache/sourcesFromLive); getPricingFor(parts[], choice, {forceRefresh})
- app/lib/bom/build.ts — pricing keyed by partId; forceRefresh param; cache/live counts from aggregator
- app/api/bom/route.ts — accepts forceRefresh; new choices; legacy "both"→"all"
- app/api/bom/export-csv/route.ts — same choice normalization
- app/components/bom/BomView.tsx — None|DigiKey|Mouser|Octopart|All dropdown, Best Source column with ★, expandable per-source detail sub-table, "Refresh prices" button, freshness badge
- package.json — added refresh:bom-pricing script

## New exports
- makeMouserClient({ apiKey }) → DistributorClient
- getCachedOffer / putCachedOffer / getCachedOffersForParts
- type DistributorChoice (now "none"|"digikey"|"mouser"|"octopart"|"all")
- type AggregatedPricing (offers, bestOverall, sourcesQueried, sourcesFromCache, sourcesFromLive)

## Environment variables
- MOUSER_API_KEY (new, optional — Mouser is skipped if unset)

## TODOs / Known limitations
- LCSC stub throws on instantiation — needs partner API access; hidden from UI
- part_offers stores only sku/stock/moq/priceBreaks/url; mpn/manufacturer/datasheet/package
  are NOT persisted, so cache-served offers carry null metadata (BOM rows still get these
  from catalog meta). Lead-time column is a placeholder ("—") — not yet captured in PartPricing.
- sku is captured for Mouser; DigiKey/Octopart don't populate it (SKU shows "—" for those)
- forceRefresh evicts the clients' in-memory MPN caches so it truly re-fetches live
- bestOverall = cheapest authorized source; ignores stock thresholds / supplier risk for now
- Rate limits: Mouser 30 req/min, DigiKey 1000/day — caching helps; ops should monitor

## Verification
- pnpm tsc --noEmit: 0 errors
- pnpm refresh:bom-pricing: runs clean ("No stale offers — nothing to do" on empty cache)
- Stage 1 backfill confirmed complete (22,756 parts) so partId→mpn lookups resolve
- Manual (needs creds): POST /api/bom with pricingChoice "all" → offers from each configured
  source + bestOverall; re-run within 24h → sourcesFromCache > 0; BOM view shows Best Source,
  expandable per-source rows, working Refresh prices; SELECT COUNT(*) FROM part_offers > 0
