/**
 * [B19-C I4] The front half of the quarantine-to-authority pipeline: external observation → normalized candidate →
 * verified evidence bundle. The back half (reviewed atomic revision → published project binding) already exists in
 * `app/lib/atomic`; nothing here can reach it.
 *
 * The rules under test, from the runbook: distributor inventory may support sourcing but never alone proves electrical
 * pin mapping or CAD correctness; AI-extracted datasheet facts stay quarantined until deterministic validation and review.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as pipeline from "../quarantine";
import { buildEvidenceBundle, candidateFromObservation, candidateFromExtraction, observationFromPricing } from "../quarantine";
import { SOURCE_REGISTRY, SOURCE_REGISTRY_VERSION } from "../source-registry";
import { sha256 } from "../../atomic/stable";
import type { PartPricing } from "../../distributors/types";

const T0 = new Date("2026-09-13T12:00:00.000Z");

function pricing(overrides: Partial<PartPricing> = {}): PartPricing {
  return {
    distributor: "digikey",
    mpn: "NE555DR",
    manufacturer: "Texas Instruments",
    description: "IC OSC SINGLE TIMER 100KHZ 8SOIC",
    datasheet: "https://www.ti.com/lit/ds/symlink/ne555.pdf",
    inStock: 12000,
    minOrderQty: 1,
    priceBreaks: [{ qty: 1, price: 0.45, currency: "USD" }, { qty: 100, price: 0.21, currency: "USD" }],
    bestUnitPrice: 0.21,
    productUrl: "https://www.digikey.com/en/products/detail/NE555DR",
    package: "Cut Tape (CT)",
    lifecycleStatus: "active",
    lifecycleRaw: "Active",
    fetchedAt: T0.getTime(),
    ...overrides,
  };
}

describe("[B19-C I4] 1 — an external observation is deterministic, source-pinned and never authoritative", () => {
  it("the same response always yields the same observation; any changed value yields a different one", () => {
    const a = observationFromPricing(pricing(), { rawContentHash: "a".repeat(64), retrievedAt: T0 });
    const b = observationFromPricing(pricing(), { rawContentHash: "a".repeat(64), retrievedAt: T0 });
    const c = observationFromPricing(pricing({ inStock: 11999 }), { rawContentHash: "a".repeat(64), retrievedAt: T0 });
    expect(a).toEqual(b);
    expect(a.id).not.toBe(c.id);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("carries the source, the registry revision, the raw-content hash and a normalizer version — and retains no raw content", () => {
    const observation = observationFromPricing(pricing(), { rawContentHash: "b".repeat(64), retrievedAt: T0 });
    expect(observation).toMatchObject({
      sourceId: "digikey",
      registryVersion: SOURCE_REGISTRY_VERSION,
      sourceClass: "distributor_catalog",
      authorityClass: "sourcing_observation",
      rawContentHash: "b".repeat(64),
      rawRetained: false,
      retrievedAt: T0.toISOString(),
      expiresAt: new Date(T0.getTime() + SOURCE_REGISTRY.digikey.freshness.offerTtlMs).toISOString(),
    });
    expect(observation.normalizerVersion).toMatch(/^sirkit\.distributor-normalizer\/\d+$/);
    expect(JSON.stringify(observation)).not.toContain("raw\":\"");
  });

  it("an observation from a source the registry does not enable is refused", () => {
    expect(() => observationFromPricing(pricing({ distributor: "lcsc" }), { rawContentHash: null, retrievedAt: T0 })).toThrow(/blocked/);
    expect(() => observationFromPricing(pricing({ distributor: "mouser" }), { rawContentHash: null, retrievedAt: T0 })).toThrow(/disabled/);
  });
});

describe("[B19-C I4] 2 — a normalized candidate classifies every fact by what its source may establish", () => {
  it("a distributor observation yields only sourcing facts and identity HINTS", () => {
    const candidate = candidateFromObservation(observationFromPricing(pricing(), { rawContentHash: null, retrievedAt: T0 }));
    expect(candidate.identityKey).toBe("NE555DR");
    const kinds = new Set(candidate.facts.map((fact) => fact.establishes));
    expect([...kinds].sort()).toEqual(["identity_hint", "sourcing"]);
    expect(candidate.facts.find((fact) => fact.property === "manufacturer")).toMatchObject({ establishes: "identity_hint", sourceClass: "distributor_catalog", method: "structured_api" });
    expect(candidate.facts.find((fact) => fact.property === "stock")).toMatchObject({ establishes: "sourcing", value: 12000 });
    expect(candidate.facts.some((fact) => ["symbol", "footprint", "pin_mapping", "package_geometry"].includes(fact.property))).toBe(false);
  });

  it("DigiKey's packaging (cut tape, reel) is a sourcing fact, never a package claim", () => {
    const candidate = candidateFromObservation(observationFromPricing(pricing(), { rawContentHash: null, retrievedAt: T0 }));
    expect(candidate.facts.find((fact) => fact.property === "packaging")).toMatchObject({ establishes: "sourcing", value: "Cut Tape (CT)" });
  });

  it.each([
    ["an LLM extraction from a manufacturer datasheet", { sourceClass: "manufacturer_datasheet", method: "llm" }, "quarantined"],
    ["an OCR extraction from a manufacturer datasheet", { sourceClass: "manufacturer_datasheet", method: "ocr" }, "quarantined"],
    ["pin mapping claimed by a distributor catalog", { sourceClass: "distributor_catalog", method: "structured_api" }, "quarantined"],
    ["a footprint from downloaded third-party CAD", { sourceClass: "third_party_cad", method: "kicad_parser" }, "quarantined"],
    ["a deterministic parse of the manufacturer's own CAD", { sourceClass: "manufacturer_cad", method: "kicad_parser" }, "engineering_candidate"],
    ["a deterministic parse of the official KiCad library", { sourceClass: "official_kicad_library", method: "kicad_parser" }, "engineering_candidate"],
  ] as const)("%s → %s", (_label, input, expected) => {
    const candidate = candidateFromExtraction({
      exactMpn: "NE555DR",
      sourceId: "source_example",
      sourceClass: input.sourceClass,
      method: input.method,
      parserVersion: "test-parser/1",
      documentHash: sha256(`${input.sourceClass}:${input.method}`),
      facts: [{ property: "pin_mapping", facet: "terminal", value: "1=GND,8=VCC", locator: "table 4.1" }],
    });
    expect(candidate.facts[0]!.establishes).toBe(expected);
    if (expected === "quarantined") expect(candidate.facts[0]!.reason).toBeTruthy();
  });
});

describe("[B19-C I4] 3 — a verified evidence bundle pins facts to sources, names conflicts and what is missing, and proves nothing on its own", () => {
  const digikey = () => candidateFromObservation(observationFromPricing(pricing(), { rawContentHash: "1".repeat(64), retrievedAt: T0 }));
  const nexar = (overrides: Partial<PartPricing> = {}) => candidateFromObservation(observationFromPricing(pricing({ distributor: "octopart-aggregated", manufacturer: "Texas Instruments", lifecycleStatus: "nrnd", lifecycleRaw: "NRND", productUrl: "https://octopart.com/ne555dr", ...overrides }), { rawContentHash: "2".repeat(64), retrievedAt: T0 }));

  it("disagreeing lifecycle claims are a conflict; per-source price and stock are not", () => {
    const bundle = buildEvidenceBundle([digikey(), nexar()], T0);
    expect(bundle.conflicts.map((conflict) => conflict.property)).toEqual(["lifecycle"]);
    expect(bundle.conflicts[0]!.values.map((value) => [value.value, value.sourceIds])).toEqual([["active", ["digikey"]], ["nrnd", ["octopart"]]]);
  });

  it("the bundle never proves an engineering fact, and says what evidence is missing", () => {
    const bundle = buildEvidenceBundle([digikey(), nexar()], T0);
    expect(bundle.engineering.proven).toBe(false);
    expect(bundle.engineering.provenBy).toBe("a reviewed atomic revision (app/lib/atomic), never a bundle");
    expect(bundle.engineering.missing).toEqual(["manufacturer datasheet or CAD evidence", "symbol", "footprint", "pin-to-pad mapping"]);
  });

  it("an AI-extracted pin mapping sits in quarantine and does not satisfy 'pin-to-pad mapping'", () => {
    const ai = candidateFromExtraction({ exactMpn: "NE555DR", sourceId: "source_ds", sourceClass: "manufacturer_datasheet", method: "llm", parserVersion: "model-extractor/3", documentHash: "3".repeat(64), facts: [{ property: "pin_mapping", facet: "terminal", value: "1=GND", locator: "p.3" }] });
    const bundle = buildEvidenceBundle([digikey(), ai], T0);
    expect(bundle.quarantined.map((fact) => fact.property)).toEqual(["pin_mapping"]);
    expect(bundle.engineering.missing).toContain("pin-to-pad mapping");
    expect(bundle.engineering.candidates).toEqual([]);
  });

  it("deterministic manufacturer CAD fills the gaps as CANDIDATES — still requiring review", () => {
    const cad = candidateFromExtraction({ exactMpn: "NE555DR", sourceId: "source_mfr_cad", sourceClass: "manufacturer_cad", method: "kicad_parser", parserVersion: "sirkit.kicad-parser/2", documentHash: "4".repeat(64), facts: [
      { property: "symbol", facet: "terminal", value: "NE555", locator: "NE555.kicad_sym" },
      { property: "footprint", facet: "package", value: "SOIC-8_3.9x4.9mm_P1.27mm", locator: "SOIC-8.kicad_mod" },
      { property: "pin_mapping", facet: "terminal", value: "1=GND,8=VCC", locator: "NE555.kicad_sym" },
    ] });
    const bundle = buildEvidenceBundle([digikey(), cad], T0);
    expect(bundle.engineering.missing).toEqual([]);
    expect(bundle.engineering.candidates.map((fact) => fact.property).sort()).toEqual(["footprint", "pin_mapping", "symbol"]);
    expect(bundle.engineering.proven).toBe(false);
    expect(bundle.parserVersions).toEqual(["sirkit.distributor-normalizer/1", "sirkit.kicad-parser/2"]);
  });

  it("an expired observation is flagged stale", () => {
    const bundle = buildEvidenceBundle([digikey()], new Date(T0.getTime() + SOURCE_REGISTRY.digikey.freshness.offerTtlMs));
    expect(bundle.staleObservationIds).toHaveLength(1);
  });

  it("candidates for different parts are never bundled together", () => {
    const other = candidateFromObservation(observationFromPricing(pricing({ mpn: "LM555CMX" }), { rawContentHash: null, retrievedAt: T0 }));
    expect(() => buildEvidenceBundle([digikey(), other], T0)).toThrow(/different parts/);
  });

  it("the bundle is deterministic: input order does not change it", () => {
    expect(buildEvidenceBundle([digikey(), nexar()], T0)).toEqual(buildEvidenceBundle([nexar(), digikey()], T0));
  });
});

describe("[B19-C I4] 4 — the front half has no path to authority", () => {
  it("the module exports no way to approve, publish, create a revision or bind a design (tripwire)", () => {
    expect(Object.keys(pipeline).filter((name) => /approve|publish|revision|bind|authori[sz]e/i.test(name))).toEqual([]);
  });
});

describe("[B19-C I4] 5 — the connectors pin each live answer to the exact bytes the vendor sent", () => {
  const PUBLIC = async (): Promise<string[]> => ["93.184.216.34"];
  beforeEach(() => {
    vi.stubGlobal("fetch", () => { throw new Error("a connector bypassed the egress boundary"); });
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    (await import("../admission-control")).resetAdmissionControl();
    (await import("../../distributors/cache")).clearPricingCache();
  });

  it("DigiKey and Nexar lookups carry the sha256 of the response body and when it was retrieved", async () => {
    const digikeyBody = JSON.stringify({ Products: [{ ManufacturerProductNumber: "NE555DR", Manufacturer: { Name: "TI" }, QuantityAvailable: 5, StandardPricing: [] }] });
    const nexarBody = JSON.stringify({ data: { s0: { results: [{ part: { mpn: "NE555DR", manufacturer: { name: "TI" }, sellers: [] } }] } } });
    const respond = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    const { makeDigiKeyClient } = await import("../../distributors/digikey");
    const { makeOctopartClient } = await import("../../distributors/octopart");
    const before = Date.now();
    const fromDigikey = await makeDigiKeyClient({ clientId: "id", clientSecret: "secret", egress: { fetch: async (input) => (String(input).includes("oauth2") ? respond(JSON.stringify({ access_token: "t", expires_in: 600 })) : respond(digikeyBody)), resolve: PUBLIC } }).lookupByMpn("NE555DR");
    const fromNexar = await makeOctopartClient({ apiKey: "nexar-test-token", egress: { fetch: async () => respond(nexarBody), resolve: PUBLIC } }).lookupByMpn("NE555DR");
    expect(fromDigikey?.evidence).toMatchObject({ rawContentHash: sha256(digikeyBody) });
    expect(fromNexar?.evidence).toMatchObject({ rawContentHash: sha256(nexarBody) });
    expect(fromDigikey!.evidence!.retrievedAt).toBeGreaterThanOrEqual(before);
    const observation = observationFromPricing(fromDigikey!, { rawContentHash: fromDigikey!.evidence!.rawContentHash, retrievedAt: new Date(fromDigikey!.evidence!.retrievedAt) });
    expect(observation.rawContentHash).toBe(sha256(digikeyBody));
  }, 10_000);
});
