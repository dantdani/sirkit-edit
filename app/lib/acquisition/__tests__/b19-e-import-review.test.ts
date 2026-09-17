/**
 * [B19-E E4] b — the import review projection and its digest (the quarantine fixes it relies on: b19-e-quarantine-review-fixes).
 *
 * Reproduced on the unchanged code: there was no review projection. Nothing joined a fact to its registry label and freshness,
 * and no digest pinned what a reviewer approved without being voided by DigiKey's 1 h offer freshness.
 */
import { describe, expect, it } from "vitest";
import { buildEvidenceBundle, candidateFromExtraction, candidateFromObservation, observationFromPricing, type NormalizedCandidate } from "../quarantine";
import { SOURCE_REGISTRY, SOURCE_REGISTRY_VERSION } from "../source-registry";
import { buildImportReviewEvidence } from "../import-review";
import type { PartPricing } from "../../distributors/types";
import type { ExtractionMethod, SourceClass } from "../../atomic/types";

const T0 = new Date("2026-09-13T12:00:00.000Z");
const HOUR = 3_600_000;

const pricing = (overrides: Partial<PartPricing> = {}): PartPricing => ({
  distributor: "digikey", mpn: "NE555DR", manufacturer: "Texas Instruments", description: "SENTINEL-DESCRIPTION timer", datasheet: "https://www.ti.com/lit/ds/ne555.pdf",
  inStock: 98_765, minOrderQty: 1, priceBreaks: [{ qty: 1, price: 123.456, currency: "USD" }], bestUnitPrice: 123.456, productUrl: "https://www.digikey.com/sentinel-product-page",
  package: "Cut Tape (CT)", sku: "SENTINEL-SKU-296", lifecycleStatus: "active", lifecycleRaw: "Active", fetchedAt: T0.getTime(), ...overrides,
});

const digikeyObservation = (overrides: Partial<PartPricing> = {}, rawContentHash: string | null = null) => observationFromPricing(pricing(overrides), { rawContentHash, retrievedAt: T0 });

type Fact = { property: string; facet: "terminal" | "package" | "identity"; value: string; locator: string };
const extraction = (sourceClass: SourceClass, method: ExtractionMethod, hash: string, facts: Fact[], extra: { supersededBy?: string; sourceId?: string } = {}): NormalizedCandidate =>
  candidateFromExtraction({ exactMpn: "NE555DR", sourceId: extra.sourceId ?? `src_${sourceClass}`, sourceClass, method, parserVersion: "p/1", documentHash: hash.repeat(64), facts, ...(extra.supersededBy ? { sourceRevision: "A", supersededBy: extra.supersededBy } : {}) });

const SYMBOL: Fact = { property: "symbol", facet: "terminal", value: "Timer:NE555D", locator: "NE555.kicad_sym" };
const FOOTPRINT: Fact = { property: "footprint", facet: "package", value: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", locator: "SOIC-8.kicad_mod" };
const PIN_MAP: Fact = { property: "pin_mapping", facet: "terminal", value: "1=GND@1,8=VCC@8", locator: "NE555.kicad_sym" };

describe("[B19-E E4 b] the review projection and its digest", () => {
  const cad = () => extraction("manufacturer_cad", "kicad_parser", "4", [SYMBOL, FOOTPRINT, PIN_MAP]);
  const evidenceAt = (now: Date, candidates: NormalizedCandidate[], observations = [digikeyObservation()]) =>
    buildImportReviewEvidence(buildEvidenceBundle([...observations.map(candidateFromObservation), ...candidates], now), observations, "pcb_assignable");

  it("is unchanged when a DigiKey observation passes its 1 h offer freshness; the fact is then flagged stale", () => {
    const fresh = evidenceAt(T0, [cad()]);
    const later = evidenceAt(new Date(T0.getTime() + SOURCE_REGISTRY.digikey.freshness.offerTtlMs + HOUR), [cad()]);
    expect(later.reviewEvidenceDigest).toBe(fresh.reviewEvidenceDigest);
    expect(fresh.facts.filter((fact) => fact.sourceId === "digikey").every((fact) => fact.stale === false)).toBe(true);
    expect(later.facts.filter((fact) => fact.sourceId === "digikey").every((fact) => fact.stale === true)).toBe(true);
  });

  it("[B19-E E4 review] tests-b-ttl-state-unreachable: is unchanged when the cached DigiKey row is DROPPED at its retention, with a request MPN spelled in another case", () => {
    // the production loader drops a DigiKey row at the moment it would turn stale (offer TTL = retention = 1 h), so the observation
    // disappears rather than ages; the request's own spelling ("ne555dr") differs from the vendor's ("NE555DR") only in case
    expect(SOURCE_REGISTRY.digikey.license.retentionMaxMs).toBe(SOURCE_REGISTRY.digikey.freshness.offerTtlMs);
    const lower = () => [
      candidateFromExtraction({ exactMpn: "ne555dr", sourceId: "src_manufacturer_cad", sourceClass: "manufacturer_cad", method: "kicad_parser", parserVersion: "p/1", documentHash: "4".repeat(64), facts: [SYMBOL, FOOTPRINT, PIN_MAP] }),
      candidateFromExtraction({ exactMpn: "ne555dr", sourceId: "src_org", sourceClass: "organization_authored", method: "manual", parserVersion: "p/1", documentHash: "5".repeat(64), facts: [{ property: "mpn", facet: "identity", value: "ne555dr", locator: "entered" }] }),
    ];
    const withRow = evidenceAt(T0, lower());
    const afterRetention = evidenceAt(new Date(T0.getTime() + SOURCE_REGISTRY.digikey.license.retentionMaxMs), lower(), []);
    expect(withRow.facts.some((fact) => fact.sourceId === "digikey")).toBe(true);
    expect(afterRetention.facts.some((fact) => fact.sourceId === "digikey")).toBe(false);
    expect(afterRetention.reviewEvidenceDigest).toBe(withRow.reviewEvidenceDigest);
    // ... and a row that APPEARS after the request (a BOM price lookup) does not void it either
    expect(evidenceAt(T0, lower(), [digikeyObservation({ mpn: "Ne555Dr" })]).reviewEvidenceDigest).toBe(afterRetention.reviewEvidenceDigest);
  });

  it("is unchanged when only sourcing facts change (a re-answered offer with another price and stock)", () => {
    const first = evidenceAt(T0, [cad()]);
    const repriced = evidenceAt(T0, [cad()], [observationFromPricing(pricing({ inStock: 1, priceBreaks: [{ qty: 1, price: 0.01, currency: "USD" }] }), { rawContentHash: "e".repeat(64), retrievedAt: new Date(T0.getTime() + 60_000) })]);
    expect(repriced.reviewEvidenceDigest).toBe(first.reviewEvidenceDigest);
  });

  it("changes when a document revision is superseded", () => {
    const current = evidenceAt(T0, [cad()]);
    const superseded = evidenceAt(T0, [extraction("manufacturer_cad", "kicad_parser", "4", [SYMBOL, FOOTPRINT, PIN_MAP], { supersededBy: "B" })]);
    expect(superseded.reviewEvidenceDigest).not.toBe(current.reviewEvidenceDigest);
  });

  it("changes when a new engineering candidate appears, and when a quarantined fact appears", () => {
    const base = evidenceAt(T0, [cad()]);
    const withCandidate = evidenceAt(T0, [cad(), extraction("official_kicad_library", "kicad_parser", "d", [{ ...FOOTPRINT, value: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", locator: "other.kicad_mod" }])]);
    const withQuarantined = evidenceAt(T0, [cad(), extraction("manufacturer_datasheet", "llm", "9", [{ ...PIN_MAP, locator: "p.3" }])]);
    expect(withCandidate.reviewEvidenceDigest).not.toBe(base.reviewEvidenceDigest);
    expect(withQuarantined.reviewEvidenceDigest).not.toBe(base.reviewEvidenceDigest);
    expect(withQuarantined.reviewEvidenceDigest).not.toBe(withCandidate.reviewEvidenceDigest);
  });

  it("changes when an identity conflict appears", () => {
    const base = evidenceAt(T0, [cad()]);
    const conflicting = evidenceAt(T0, [cad()], [digikeyObservation(), observationFromPricing(pricing({ distributor: "octopart-aggregated", manufacturer: "Acme Semiconductor", productUrl: "https://octopart.com/ne555dr" }), { rawContentHash: null, retrievedAt: T0 })]);
    expect(conflicting.conflicts.map((conflict) => [conflict.property, conflict.kind])).toEqual([["manufacturer", "identity"]]);
    expect(conflicting.reviewEvidenceDigest).not.toBe(base.reviewEvidenceDigest);
  });

  it("joins every distributor fact to its registry label, freshness, basis and registry version", () => {
    const cached = evidenceAt(T0, [cad()]);
    const live = evidenceAt(T0, [cad()], [digikeyObservation({}, "f".repeat(64))]);
    const fact = cached.facts.find((item) => item.sourceId === "digikey" && item.property === "mpn")!;
    expect(fact.distributor).toEqual({
      displayName: SOURCE_REGISTRY.digikey.displayName,
      freshnessLabel: SOURCE_REGISTRY.digikey.freshness.label,
      retrievedAt: T0.toISOString(),
      expiresAt: new Date(T0.getTime() + SOURCE_REGISTRY.digikey.freshness.offerTtlMs).toISOString(),
      basis: "cached",
      rawContentHash: null,
      registryVersion: SOURCE_REGISTRY_VERSION,
    });
    expect(live.facts.find((item) => item.sourceId === "digikey")!.distributor).toMatchObject({ basis: "live", rawContentHash: "f".repeat(64) });
    expect(cached.facts.find((item) => item.sourceId === "src_manufacturer_cad")!.distributor).toBeNull();
    expect(cached.registryVersion).toBe(SOURCE_REGISTRY_VERSION);
  });

  it("the projection carries no distributor price, stock, description, SKU or URL — only ids, value hashes, source ids, times and the registry version", () => {
    const evidence = evidenceAt(T0, [cad()]);
    const text = JSON.stringify(evidence);
    for (const sentinel of ["123.456", "98765", "SENTINEL-DESCRIPTION", "SENTINEL-SKU-296", "sentinel-product-page", "Cut Tape", "Texas Instruments", "digikey.com"]) expect(text, sentinel).not.toContain(sentinel);
    for (const fact of evidence.facts.filter((item) => item.sourceId === "digikey")) {
      expect(fact.value).toBeNull();
      expect(fact.locator).toBeNull();
      expect(fact.valueHash).toMatch(/^[0-9a-f]{64}$/);
    }
    // a document fact keeps its value for the reviewer
    expect(evidence.facts.find((item) => item.property === "symbol")!.value).toBe("Timer:NE555D");
  });

  it("the missing list follows the profile: schematic_only needs a symbol; pcb_assignable needs symbol, footprint and pin-to-pad mapping", () => {
    const symbolOnly = extraction("official_kicad_library", "kicad_parser", "d", [SYMBOL]);
    const bundle = buildEvidenceBundle([symbolOnly], T0);
    expect(buildImportReviewEvidence(bundle, [], "schematic_only").missing).toEqual([]);
    expect(buildImportReviewEvidence(bundle, [], "pcb_assignable").missing).toEqual(["footprint", "pin-to-pad mapping"]);
    expect(buildImportReviewEvidence(buildEvidenceBundle([candidateFromObservation(digikeyObservation())], T0), [digikeyObservation()], "schematic_only").missing).toEqual(["symbol"]);
    const superseded = extraction("official_kicad_library", "kicad_parser", "d", [SYMBOL], { supersededBy: "B" });
    expect(buildImportReviewEvidence(buildEvidenceBundle([superseded], T0), [], "schematic_only").missing).toEqual(["symbol"]);
  });

  it("proves nothing, and is deterministic", () => {
    const a = evidenceAt(T0, [cad()]);
    expect(a.proven).toBe(false);
    expect(evidenceAt(T0, [cad()])).toEqual(a);
    expect(a.reviewEvidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
