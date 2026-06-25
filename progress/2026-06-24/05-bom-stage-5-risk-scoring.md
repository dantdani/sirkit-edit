# BOM Stage 5: Risk scoring

**Date**: 2026-06-24
**Status**: Shipped

## What this changed
Synthesized lifecycle + stock + supplier diversity + pricing into per-row risk
scores (0-100). BOM rows now show a Risk column with colored badges; hovering
shows the breakdown. Design-level risk summary card appears at top with a
production-readiness recommendation. CSV export includes risk columns.

## New files
- app/lib/risk-scoring.ts — computeLineRisk, computeDesignRisk, gradeFromScore

## Modified files
- app/lib/bom/build.ts — BomRow.riskScore + BomResult.riskSummary; CSV gains Risk Score/Grade/Notes
- app/api/bom/route.ts — re-exports LineRiskBreakdown + DesignRiskSummary (response already carries riskSummary via buildBom)
- app/components/bom/BomView.tsx — Risk column + sortable header, RiskBadge with hover breakdown, design-risk summary card (score badge, recommendation, View-at-risk toggle, production-ready stamp, top-concerns callout), at-risk filter now grade-driven

## New exports
- type LineRiskBreakdown, type DesignRiskSummary, type RiskGrade
- computeLineRisk(row) → LineRiskBreakdown
- computeDesignRisk(rows) → DesignRiskSummary
- gradeFromScore(score) → RiskGrade

## Design decisions / Known limitations
- computeLineRisk accepts `Pick<BomRow, "pricing" | "lifecycleStatus">` (a structural subset of
  the spec's `BomRow`) so it can be called while a row is still being assembled, before its own
  riskScore exists. A full BomRow is assignable, so the spec usage `computeLineRisk(row)` works.
- Weights are module-level constants (LIFECYCLE_POINTS, availabilityPoints, diversityPoints,
  PRICING_POINTS, GRADE_THRESHOLDS) — easy to tune; not user-configurable yet.
- Theory rows / pricingChoice "none" → pricing is null → availability/diversity/pricing all 0 and
  note "No distributor data fetched"; row scores ~17 (lifecycle unknown) and grades high_risk.
- Risk breakdown is a CSS hover popover (monospace, aligned); no shadcn HoverCard dependency added.
- No price-volatility component; all parts weighted uniformly (no "critical component" weighting).
- Production-ready = overallScore ≥ 70 AND no high_risk rows (hard-coded threshold).

## Verification
- pnpm tsc --noEmit: 0 errors
- Unit sanity (throwaway script): healthy part → 100/excellent; pricing-null → 17/high_risk
  ("No distributor data fetched"); EOL+no-stock → 3/high_risk; design avg of {100,17,3} → 40/caution,
  rowsAtRisk 2, productionReady false, recommendation "EOL parts in design — find alternates before fab."
- gradeFromScore thresholds (85/65/45/20 → excellent/good/caution/high_risk) correct
- BOM view (manual): Risk column + badge breakdown, summary card with toggle/stamp/top-concerns,
  sort-by-risk worst-first, at-risk filter, CSV with Risk Score/Grade/Notes
