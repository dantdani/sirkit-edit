# Tidy — respacing regression guard ("don't crowd elsewhere")

Date: 2026-06-30 · Status: done (type-checked, lint-clean, unit-tested)

## Problem
The layout critic (Tidy) gives crowded components extra clearance and re-runs the
WHOLE layout — which reshuffles every component, not just the flagged ones. Open
question: could spreading the crowded parts push a *previously-comfortable* part
into a tight spot (i.e. move the crowding elsewhere)?

## What already protected against it (structural)
- `resolveComponentCollisions` is a GLOBAL pass: it terminates only when no pair
  of (clearance-inflated) boxes overlaps, so a clean region can't gain an overlap.
- The schematic sheet is unbounded + `planPageFit` re-sizes to the result, so
  spreading EXPANDS the canvas rather than compressing other regions.

That covers hard overlap, but NOT a legal-but-tighter reshuffle (a comfortable
150px gap becoming a tight 65px). The critic is also single-shot (no re-screenshot
loop), so it wouldn't re-flag a newly-tight region.

## Fix — deterministic guard (chosen over a re-critique loop; no extra LLM call)
Measure each component's nearest-neighbour spacing before vs after the re-layout
and only apply the result if it strictly helped without a regression.

`lib/build-auto-layout.ts` (new, exported, pure → unit-testable):
- `rectGap(a, b)` — true edge-to-edge distance between two boxes (0 if overlapping).
- `nearestNeighborGaps(instances, parts)` — refDes → distance to closest neighbour.
- `evaluateRespacing(before, after, flagged, comfort?)` → `{ improved, regressed }`:
  - `improved`: flagged (crowded) parts gained room in aggregate.
  - `regressed`: NON-flagged parts that were comfortable (≥ `DEFAULT_COMFORT_GAP`
    = 2× the per-side `SYMBOL_CLEARANCE` = 60px) but dropped below it.
- `DEFAULT_COMFORT_GAP` exported.

`app/api/schematic/layout-critic/route.ts`:
- After `autoLayoutBuildValidated`, compute before/after gaps + `evaluateRespacing`.
- Apply gate is now `validation.ok && sameCount && improved && regressed.length === 0`.
- Response adds `regressedRefDes` and `improved`.

`app/page.tsx` (`handleTidyLayout`):
- Updated the response type, and the "nothing changed" chat note now explains why:
  "Spreading those out would have crowded other parts (…), so the original was
  kept." / "Re-spacing wouldn't have given the crowded parts more room…".

## Behaviour
Tidy now either makes the layout strictly better (crowded parts roomier, nothing
comfortable squeezed) or makes NO change and says why. It deliberately does not
penalise parts that were already tight, nor comfortable→still-comfortable shuffles.
Note: still single-shot — on rejection it keeps the original rather than retrying.
The active loop-until-clean variant (re-screenshot + re-critique) remains the
follow-up if wanted.

## Tests (`pnpm test:netlist`) — 5 new assertions
- nearest-neighbour gap grows with distance
- improvement with no regression → accepted
- a crowded-out comfortable part → flagged as regressed
- a part that was already tight → NOT a regression
- no gain for flagged parts → not improved

## Verification
`npx tsc --noEmit` clean · `npm run test:netlist` ALL PASS · eslint clean on the
three changed files · `app/page.tsx` unchanged at its 19 pre-existing hooks errors.
