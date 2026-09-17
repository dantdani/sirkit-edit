/**
 * Supply-chain risk scoring (Stage 5).
 *
 * Synthesizes the data already attached to a BOM row — lifecycle, stock,
 * supplier diversity, pricing — into a per-line risk score (0-100) and a
 * design-level summary. Pure arithmetic over the existing response; no DB,
 * no network. Recomputed on each BOM render.
 *
 * Weights live as module-level constants so they're easy to tune later.
 */

import type { BomRow } from "./bom/build";
import type { AggregatedPricing, LifecycleStatus, PartPricing } from "./distributors";

export type RiskGrade = "excellent" | "good" | "caution" | "high_risk";

export type LineRiskBreakdown = {
  total: number; // 0-100
  grade: RiskGrade;
  components: {
    lifecycle: number; // 0-35
    availability: number; // 0-30
    diversity: number; // 0-20
    pricing: number; // 0-15
  };
  notes: string[]; // 1-3 short reasons
};

export type DesignRiskSummary = {
  overallScore: number;
  overallGrade: RiskGrade;
  totalRows: number;
  rowsAtRisk: number; // count of "caution" or "high_risk"
  worstRows: Array<{ refDes: string; mpn: string | null; score: number; grade: RiskGrade }>;
  productionReady: boolean; // overallScore >= 70 AND no high_risk rows
  recommendation: string;
};

// ─── Weights (tweak here) ───────────────────────────────────────────────────--

const LIFECYCLE_POINTS: Record<LifecycleStatus, number> = {
  active: 35,
  unknown: 17, // neutral middle
  nrnd: 20,
  last_time_buy: 10,
  eol: 3,
  obsolete: 0,
};

const PRICING_POINTS = 15; // full credit when a best unit price is known

/** Availability points from total stock summed across all offers. */
function availabilityPoints(totalStock: number): number {
  if (totalStock >= 10000) return 30;
  if (totalStock >= 1000) return 25;
  if (totalStock >= 100) return 18;
  if (totalStock >= 1) return 8;
  return 0;
}

/** Supplier-diversity points from the number of distributors holding stock. */
function diversityPoints(suppliers: number): number {
  if (suppliers >= 3) return 20;
  if (suppliers === 2) return 16;
  if (suppliers === 1) return 10;
  return 0;
}

const GRADE_THRESHOLDS: Array<{ min: number; grade: RiskGrade }> = [
  { min: 80, grade: "excellent" },
  { min: 60, grade: "good" },
  { min: 40, grade: "caution" },
  { min: 0, grade: "high_risk" },
];

const AT_RISK_GRADES: ReadonlySet<RiskGrade> = new Set(["caution", "high_risk"]);

// ─── Public API ─────────────────────────────────────────────────────────────--

export function gradeFromScore(score: number): RiskGrade {
  for (const { min, grade } of GRADE_THRESHOLDS) {
    if (score >= min) return grade;
  }
  return "high_risk";
}

/** Distinct distributors that report non-zero stock. */
function countSuppliers(offers: PartPricing[]): number {
  const withStock = offers.filter((o) => (o.inStock ?? 0) > 0).map((o) => o.distributor);
  return new Set(withStock).size;
}

/**
 * Per-line risk. Reads only `pricing` + `lifecycleStatus`, so it can be called
 * while a BomRow is still being assembled (before its own riskScore exists).
 */
export function computeLineRisk(
  row: Pick<BomRow, "pricing" | "lifecycleStatus">,
): LineRiskBreakdown {
  const pricing: AggregatedPricing | null = row.pricing;
  const offers = pricing?.offers ?? [];

  const lifecycle = LIFECYCLE_POINTS[row.lifecycleStatus] ?? LIFECYCLE_POINTS.unknown;

  const totalStock = offers.reduce((sum, o) => sum + (o.inStock ?? 0), 0);
  const availability = availabilityPoints(totalStock);

  const suppliers = countSuppliers(offers);
  const diversity = diversityPoints(suppliers);

  const hasPrice = (pricing?.bestOverall?.bestUnitPrice ?? null) !== null;
  const pricingPts = hasPrice ? PRICING_POINTS : 0;

  const total = lifecycle + availability + diversity + pricingPts;
  const grade = gradeFromScore(total);

  const notes = buildNotes({
    lifecycleStatus: row.lifecycleStatus,
    hasDistributorData: pricing !== null,
    totalStock,
    suppliers,
    hasPrice,
  });

  return {
    total,
    grade,
    components: { lifecycle, availability, diversity, pricing: pricingPts },
    notes,
  };
}

function buildNotes(ctx: {
  lifecycleStatus: LifecycleStatus;
  hasDistributorData: boolean;
  totalStock: number;
  suppliers: number;
  hasPrice: boolean;
}): string[] {
  const notes: string[] = [];

  // Lifecycle (highest priority).
  if (ctx.lifecycleStatus === "obsolete") notes.push("Obsolete part");
  else if (ctx.lifecycleStatus === "eol") notes.push("End-of-life part");
  else if (ctx.lifecycleStatus === "nrnd" || ctx.lifecycleStatus === "last_time_buy") {
    notes.push("Not recommended for new design");
  }

  // Availability / supply.
  if (!ctx.hasDistributorData) {
    notes.push("No distributor data fetched");
  } else {
    if (ctx.suppliers === 0) notes.push("No stock anywhere");
    else if (ctx.suppliers === 1) notes.push("Single supplier (sole source)");
    if (ctx.totalStock > 0 && ctx.totalStock < 100) notes.push("Low stock (<100 units)");
    if (!ctx.hasPrice) notes.push("No pricing data");
  }

  if (notes.length === 0) notes.push("Healthy availability and lifecycle");
  return notes.slice(0, 3);
}

export function computeDesignRisk(rows: BomRow[]): DesignRiskSummary {
  const totalRows = rows.length;
  if (totalRows === 0) {
    return {
      overallScore: 0,
      overallGrade: gradeFromScore(0),
      totalRows: 0,
      rowsAtRisk: 0,
      worstRows: [],
      productionReady: false,
      recommendation: "No components to assess.",
    };
  }

  const sum = rows.reduce((s, r) => s + r.riskScore.total, 0);
  const overallScore = Math.round(sum / totalRows);
  const overallGrade = gradeFromScore(overallScore);

  const rowsAtRisk = rows.filter((r) => AT_RISK_GRADES.has(r.riskScore.grade)).length;
  const hasHighRisk = rows.some((r) => r.riskScore.grade === "high_risk");
  const eolPresent = rows.some(
    (r) => r.lifecycleStatus === "eol" || r.lifecycleStatus === "obsolete",
  );
  const productionReady = overallScore >= 70 && !hasHighRisk;

  // Deterministic: lowest score first, ties broken by refDes.
  const worstRows = [...rows]
    .sort(
      (a, b) =>
        a.riskScore.total - b.riskScore.total ||
        (a.refDesList[0] ?? a.refDes).localeCompare(b.refDesList[0] ?? b.refDes),
    )
    .slice(0, 5)
    .map((r) => ({
      refDes: r.refDesList[0] ?? r.refDes,
      mpn: r.mpn,
      score: r.riskScore.total,
      grade: r.riskScore.grade,
    }));

  let recommendation: string;
  if (productionReady && rowsAtRisk === 0) {
    recommendation = "Supply signals OK in the observed offers. This is not a production-readiness verdict."; // [B19-E E1] observed offers prove nothing about the design
  } else if (productionReady) {
    recommendation = `Mostly safe. Review ${rowsAtRisk} part${rowsAtRisk === 1 ? "" : "s"} before locking BOM.`;
  } else if (eolPresent) {
    recommendation = "EOL parts in design — find alternates before fab.";
  } else {
    recommendation = "Design has supply-chain risks. Review and substitute high-risk parts.";
  }

  return {
    overallScore,
    overallGrade,
    totalRows,
    rowsAtRisk,
    worstRows,
    productionReady,
    recommendation,
  };
}
