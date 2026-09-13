/**
 * Alternate-part matching + scoring (Stage 4).
 *
 * Pure-ish query/scoring layer over the normalized spec data (packageNormalized
 * + keySpecs from Stage 1) and cached distributor offers (part_offers from
 * Stage 2/3). `findCandidateAlternates` does the SQL and classifies each
 * candidate as drop-in or form-fit-function; `computeAlternateScore` ranks a
 * candidate 0–100 deterministically. The backfill script (compute-alternates)
 * and the alternates API both build on these.
 *
 * Everything is deterministic — same inputs always yield the same kind/score —
 * so the precomputed `alternates` table is stable across re-runs.
 */

import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "./db/client";
import { parts, type KeySpecs, type PartOffer } from "./db/schema";
import type { PartRow } from "./parts-normalization";
import { cheapestUnitPrice, PRICING_CURRENCY } from "./distributors/types"; // [B19-D I5b review]

export type AlternateKind = "exact" | "drop_in" | "fff" | "substitute";

export type AlternateMatch = {
  partId: string;
  alternatePartId: string;
  kind: AlternateKind;
  score: number; // 0-100, higher = better (0 until computeAlternateScore runs)
  matchReasons: string[];
};

/** A cached distributor offer row (from part_offers). */
export type PartOfferRow = PartOffer;

const MAX_CANDIDATES = 50;

// ─── Candidate discovery ────────────────────────────────────────────────────--

/** The keySpecs discriminant, or "unknown" when specs are absent/empty. */
function specKind(specs: KeySpecs | null | undefined): KeySpecs["kind"] | "unknown" {
  return specs && "kind" in specs ? specs.kind : "unknown";
}

/**
 * Candidate alternates for `partId`, each classified drop_in/fff (unscored).
 * Returns [] when the source lacks the normalized data needed to match.
 */
export async function findCandidateAlternates(partId: string): Promise<AlternateMatch[]> {
  const db = getDb();
  const [source] = await db.select().from(parts).where(eq(parts.id, partId)).limit(1);
  if (!source) return [];

  const kind = specKind(source.keySpecs);
  if (kind === "unknown" || !source.packageNormalized) return [];

  // SQL prefilter: same kind + same package, excluding self. Value/tolerance/
  // rating checks (which vary by kind) run in classifyAlternate below.
  const candidates = await db
    .select()
    .from(parts)
    .where(
      and(
        eq(parts.packageNormalized, source.packageNormalized),
        sql`(${parts.keySpecs} ->> 'kind') = ${kind}`,
        ne(parts.id, partId),
      ),
    )
    .limit(500);

  const matches: AlternateMatch[] = [];
  for (const alt of candidates) {
    const matchKind = classifyAlternate(source, alt);
    if (!matchKind) continue;
    matches.push({ partId, alternatePartId: alt.id, kind: matchKind, score: 0, matchReasons: [] });
    if (matches.length >= MAX_CANDIDATES) break;
  }
  return matches;
}

// ─── Classification ─────────────────────────────────────────────────────────--

/** Same physical part (same manufacturer + same MPN) — a duplicate, not an alt. */
function sameMfrMpn(a: PartRow, b: PartRow): boolean {
  const am = (a.mpn ?? "").trim().toUpperCase();
  const bm = (b.mpn ?? "").trim().toUpperCase();
  if (am === "" || bm === "") return false;
  const amf = (a.manufacturer ?? "").trim().toUpperCase();
  const bmf = (b.manufacturer ?? "").trim().toUpperCase();
  return am === bm && amf === bmf;
}

/**
 * Classify how `alt` substitutes for `source`: "drop_in" (stricter wins),
 * "fff" (form-fit-function), or null if it isn't a viable alternate.
 * Assumes nothing — re-checks kind and package itself.
 */
export function classifyAlternate(source: PartRow, alt: PartRow): AlternateKind | null {
  if (alt.id === source.id) return null;
  const sKind = specKind(source.keySpecs);
  if (sKind === "unknown") return null;
  if (specKind(alt.keySpecs) !== sKind) return null;
  if (source.packageNormalized == null || alt.packageNormalized !== source.packageNormalized) {
    return null;
  }
  if (sameMfrMpn(source, alt)) return null; // identical part — "exact" duplicate, skip

  const s = source.keySpecs;
  const a = alt.keySpecs;
  if (!s || !a || !("kind" in s) || !("kind" in a)) return null;

  switch (s.kind) {
    case "resistor":
      return a.kind === "resistor" ? classifyResistor(s, a) : null;
    case "capacitor":
      return a.kind === "capacitor" ? classifyCapacitor(s, a) : null;
    case "inductor":
      return a.kind === "inductor" ? classifyInductor(s, a) : null;
    case "diode":
      return a.kind === "diode" ? classifyDiode(s, a) : null;
    case "ic":
      return a.kind === "ic" ? classifyIc(source, alt, s, a) : null;
    default:
      return null;
  }
}

type Resistor = Extract<KeySpecs, { kind: "resistor" }>;
type Capacitor = Extract<KeySpecs, { kind: "capacitor" }>;
type Inductor = Extract<KeySpecs, { kind: "inductor" }>;
type Diode = Extract<KeySpecs, { kind: "diode" }>;
type Ic = Extract<KeySpecs, { kind: "ic" }>;

// Standard resistor tolerance ladder (tightest → loosest) for ±1-step checks.
const TOLERANCE_LADDER = ["0.1%", "0.25%", "0.5%", "1%", "2%", "5%", "10%", "20%"];

function toleranceIndex(tol: string | undefined): number {
  if (!tol) return -1;
  const t = tol.replace(/\s+/g, "").replace("±", "").toUpperCase();
  return TOLERANCE_LADDER.findIndex((x) => x.toUpperCase() === t);
}

function classifyResistor(s: Resistor, a: Resistor): AlternateKind | null {
  if (!s.resistance || s.resistance !== a.resistance) return null; // same value required
  const si = toleranceIndex(s.tolerance);
  const ai = toleranceIndex(a.tolerance);
  if (si < 0 || ai < 0) return "drop_in"; // tolerance unknown → assume compatible
  if (ai <= si) return "drop_in"; // alt is equal or tighter → true drop-in
  if (ai - si === 1) return "fff"; // one step looser → form-fit-function
  return "fff"; // same value+package but looser tolerance — still functional
}

/** Class-I (NP0/C0G) and Class-II (X7R/X5R/…) dielectric handling. */
function normDielectric(d: string | undefined): string | null {
  if (!d) return null;
  return d.trim().toUpperCase().replace("NP0", "C0G");
}

function dielectricSame(s: string | undefined, a: string | undefined): boolean {
  const ns = normDielectric(s);
  const na = normDielectric(a);
  if (ns === null && na === null) return true; // both unspecified
  return ns !== null && ns === na;
}

function dielectricCompatible(s: string | undefined, a: string | undefined): boolean {
  const ns = normDielectric(s);
  const na = normDielectric(a);
  if (ns === null || na === null) return false;
  const classII = new Set(["X7R", "X5R"]);
  return classII.has(ns) && classII.has(na);
}

function valueEqualOrBothMissing(s: string | undefined, a: string | undefined): boolean {
  if (!s && !a) return true;
  if (!s || !a) return false;
  return s === a;
}

function classifyCapacitor(s: Capacitor, a: Capacitor): AlternateKind | null {
  if (!s.capacitance || s.capacitance !== a.capacitance) return null; // same value required
  if (!valueEqualOrBothMissing(s.voltageRating, a.voltageRating)) return null; // same V rating
  if (dielectricSame(s.dielectric, a.dielectric)) return "drop_in";
  if (dielectricCompatible(s.dielectric, a.dielectric)) return "fff";
  return null;
}

function classifyInductor(s: Inductor, a: Inductor): AlternateKind | null {
  if (!s.inductance || s.inductance !== a.inductance) return null; // same value required
  if (s.currentRating && a.currentRating && s.currentRating === a.currentRating) return "drop_in";
  const sc = parseSI(s.currentRating);
  const ac = parseSI(a.currentRating);
  if (sc !== null && ac !== null) {
    return Math.abs(ac - sc) <= sc * 0.2 ? "fff" : null; // ±20% current
  }
  return "fff"; // current unknown on a side — same L + package is still functional
}

function classifyDiode(s: Diode, a: Diode): AlternateKind | null {
  const sameRv = !!s.reverseVoltage && s.reverseVoltage === a.reverseVoltage;
  const sameCur = !!s.currentRating && s.currentRating === a.currentRating;
  if (sameRv && sameCur) return "drop_in";

  const srv = parseSI(s.reverseVoltage);
  const arv = parseSI(a.reverseVoltage);
  const scur = parseSI(s.currentRating);
  const acur = parseSI(a.currentRating);
  const rvOk =
    srv !== null && arv !== null
      ? Math.abs(arv - srv) <= srv * 0.1 // ±10% reverse voltage
      : s.reverseVoltage == null && a.reverseVoltage == null;
  const curOk =
    scur !== null && acur !== null
      ? Math.abs(acur - scur) <= scur * 0.2 // ±20% current
      : s.currentRating == null && a.currentRating == null;
  return rvOk && curOk ? "fff" : null;
}

function classifyIc(source: PartRow, alt: PartRow, s: Ic, a: Ic): AlternateKind | null {
  if (s.pinCount == null || a.pinCount == null || s.pinCount !== a.pinCount) return null;
  const sm = (source.mpn ?? "").toUpperCase();
  const am = (alt.mpn ?? "").toUpperCase();
  // Heuristic same-family drop-in: shared 5-char MPN prefix (e.g. NE555 ↔ NE556 no,
  // but TLC555/TLC55x families share prefixes). Proper pinmap compare is future work.
  if (sm.length >= 5 && am.length >= 5 && sm.slice(0, 5) === am.slice(0, 5)) return "drop_in";
  if ((source.manufacturer ?? "") !== (alt.manufacturer ?? "")) return "fff";
  return null;
}

/** Parse an engineering-notation magnitude ("500mA", "25V", "10uH") to base units. */
export function parseSI(value: string | undefined | null): number | null {
  if (!value) return null;
  const m = value.trim().match(/^([0-9]*\.?[0-9]+)\s*([pnuµmkMG])?/);
  if (!m) return null;
  const base = parseFloat(m[1]);
  if (!Number.isFinite(base)) return null;
  const mult: Record<string, number> = {
    p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9,
  };
  return m[2] ? base * (mult[m[2]] ?? 1) : base;
}

// ─── Scoring ────────────────────────────────────────────────────────────────--

const REPUTABLE_MANUFACTURERS = [
  "murata", "texas instruments", "ti", "microchip", "stmicroelectronics", "st",
  "analog devices", "adi", "infineon", "nxp", "vishay", "yageo",
  "samsung electro-mechanics", "kemet",
];

/**
 * Cheapest unit price across a set of offers, with its currency.
 * [B19-D I5b review] per offer, the price at quantity 1 in the pricing currency — never a volume break or another currency.
 */
export function bestOfferPrice(offers: PartOfferRow[]): { value: number; currency: string } | null {
  let best: { value: number; currency: string } | null = null;
  for (const o of offers) {
    const unit = cheapestUnitPrice(o.priceBreaks ?? []);
    if (unit !== null && (best === null || unit < best.value)) best = { value: unit, currency: PRICING_CURRENCY };
  }
  return best;
}

/**
 * Score an alternate 0–100 across six weighted components. `sourceOffers` is an
 * optional extension over the spec's 4-arg signature so the price component can
 * compare against the source part's own cheapest offer.
 */
export function computeAlternateScore(
  sourcePart: PartRow,
  altPart: PartRow,
  matchKind: AlternateKind,
  altOffers: PartOfferRow[],
  sourceOffers: PartOfferRow[] = [],
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Match quality (30).
  const matchPts = matchKind === "drop_in" || matchKind === "exact" ? 30 : matchKind === "fff" ? 20 : 10;
  score += matchPts;
  reasons.push(
    matchKind === "drop_in"
      ? "drop-in (same value, package & rating)"
      : matchKind === "fff"
        ? "form-fit-function compatible"
        : matchKind === "exact"
          ? "identical part"
          : "substitute",
  );

  // Lifecycle (20).
  const lc = altPart.lifecycleStatus ?? "unknown";
  const lifecyclePts =
    lc === "active" ? 20 : lc === "nrnd" ? 10 : lc === "last_time_buy" ? 5 : lc === "unknown" ? 10 : 0;
  score += lifecyclePts;
  if (lc === "active") reasons.push("Active lifecycle");
  else if (lc === "eol" || lc === "obsolete") reasons.push(`${lc} lifecycle`);
  else if (lc === "nrnd" || lc === "last_time_buy") reasons.push(`${lc} lifecycle`);

  // Stock availability (20).
  const totalStock = altOffers.reduce((sum, o) => sum + (o.stock ?? 0), 0);
  const stockPts =
    totalStock >= 10000 ? 20 : totalStock >= 1000 ? 15 : totalStock >= 100 ? 10 : totalStock >= 1 ? 5 : 0;
  score += stockPts;
  if (totalStock > 0) reasons.push(`${totalStock.toLocaleString()} in stock`);

  // Supplier diversity (10).
  const distinct = new Set(altOffers.filter((o) => (o.stock ?? 0) > 0).map((o) => o.distributor)).size;
  const diversityPts = distinct >= 3 ? 10 : distinct === 2 ? 8 : distinct === 1 ? 5 : 0;
  score += diversityPts;
  if (distinct >= 1) reasons.push(`stocked at ${distinct} distributor${distinct > 1 ? "s" : ""}`);

  // Price (15) — relative to the source part's cheapest offer when known.
  const altBest = bestOfferPrice(altOffers);
  const srcBest = bestOfferPrice(sourceOffers);
  let pricePts = 0;
  if (altBest !== null) {
    if (srcBest === null) {
      pricePts = 10; // alt has pricing but no baseline to compare → neutral credit
    } else if (altBest.value < srcBest.value) {
      pricePts = 15;
      const pct = Math.round((1 - altBest.value / srcBest.value) * 100);
      if (pct > 0) reasons.push(`${pct}% cheaper`);
    } else if (altBest.value <= srcBest.value * 1.2) {
      pricePts = 10;
    } else if (altBest.value <= srcBest.value * 1.5) {
      pricePts = 5;
    } else {
      pricePts = 0;
    }
  }
  score += pricePts;

  // Manufacturer reputation (5).
  const mfr = (altPart.manufacturer ?? "").toLowerCase();
  const reputable = mfr !== "" && REPUTABLE_MANUFACTURERS.some((r) => mfr.includes(r));
  score += reputable ? 5 : 2;

  return { score: Math.round(score), reasons };
}
