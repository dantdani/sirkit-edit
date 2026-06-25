# BOM Stage 4: Alternates engine

**Date**: 2026-06-24
**Status**: Shipped

## What this changed
Pre-computed alternate parts (drop-in and form-fit-function) for every part using
package + key-spec matching. BOM rows show an alternates count; clicking opens a
drawer with ranked candidates and a Swap button (wired to a parent callback).

## New files
- app/lib/alternates.ts — findCandidateAlternates, classifyAlternate, computeAlternateScore, parseSI, bestOfferPrice
- scripts/compute-alternates.ts — one-shot backfill that populates the alternates table
- app/api/parts/[id]/alternates/route.ts — ranked alternates for one part (kind/limit params)

## Modified files
- app/lib/bom/build.ts — BomRow includes alternatesCount; one grouped COUNT query (no N+1)
- app/components/bom/BomView.tsx — Alternates column, slide-out drawer (ranked cards, drop-in/FFF filter, score bar, Swap), onSwapPart prop
- package.json — added compute:alternates script

## New exports
- type AlternateKind ("exact" | "drop_in" | "fff" | "substitute"), type AlternateMatch, type PartOfferRow
- findCandidateAlternates(partId) → Promise<AlternateMatch[]>
- classifyAlternate(source, alt) → AlternateKind | null
- computeAlternateScore(source, alt, kind, altOffers, sourceOffers?) → { score, reasons }
- bestOfferPrice(offers), parseSI(value)

## Design decisions / Known limitations
- computeAlternateScore takes an OPTIONAL 5th arg (sourceOffers) beyond the spec's 4-arg
  signature — required to implement "cheaper than source's bestUnitPrice" price scoring,
  which the 4-arg form can't express. Backward compatible (defaults to []).
- BomRow.alternatesCount is computed in build.ts (where rows + partIds live), not in
  route.ts — keeps the JSON and CSV BOM consistent and the count batched O(1).
- IC drop-in is heuristic (shared 5-char MPN prefix + same pinCount); real pinmap compare is future.
- "exact" and "substitute" tiers aren't generated here — only drop_in and fff (exact duplicates,
  same mfr+MPN, are explicitly excluded as non-alternates).
- Swap is a UI affordance only: disabled with a "Swap wiring pending" tooltip until page.tsx
  wires onSwapPart (deliberately out of scope to stay parallel-safe).
- Backfill skips parts whose alternates were computed within 7 days (resumable / idempotent).
- No new indexes added; candidate sets are small because the KiCad catalog has few concrete-spec
  parts. If the catalog grows, add an index on (package_normalized, (key_specs->>'kind')).

## Verification
- pnpm tsc --noEmit: 0 errors
- pnpm compute:alternates: runs against live DB, prints final summary (scanned/skipped/withAlternates/pairsWritten)
- Idempotent: a second run skips recently-computed parts (7-day window)
- GET /api/parts/<id>/alternates?kind=all returns ranked candidates with score + matchReasons
- BOM view: Alternates column shows count chip; clicking opens the drawer; Swap disabled
  (tooltip) when onSwapPart is undefined
