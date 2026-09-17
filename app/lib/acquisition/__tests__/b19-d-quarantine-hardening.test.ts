/**
 * [B19-D I5b rows 27a, 39, 40, 41] The quarantine pipeline's identity, conflict, staleness and content hygiene.
 *
 *  - row 27a: a bundle's identity was the SEARCH key (letters and digits only), so `MAX3232CSE+` and `MAX3232CSE`, or a
 *    homoglyph or invisible-character spelling, landed in one part's evidence.
 *  - row 39: terminal function, electrical rating and package geometry disagreements were never reported as conflicts.
 *  - row 40: the observation recorded the vendor's MPN as the "queried" MPN, losing what was asked; a document revision
 *    superseded by a newer one never went stale.
 *  - row 41: a `javascript:` product link, a `data:` datasheet link and control characters in vendor text were accepted as
 *    sourcing facts.
 */
import { describe, expect, it } from "vitest";
import { buildEvidenceBundle, candidateFromExtraction, candidateFromObservation, observationFromPricing } from "../quarantine";
import type { PartPricing } from "../../distributors/types";

const T0 = new Date("2026-09-13T12:00:00.000Z");
const pricing = (overrides: Partial<PartPricing> = {}): PartPricing => ({
  distributor: "digikey", mpn: "NE555DR", manufacturer: "Texas Instruments", description: "Timer", datasheet: "https://www.ti.com/lit/ds/ne555.pdf",
  inStock: 5, minOrderQty: 1, priceBreaks: [], bestUnitPrice: null, productUrl: "https://www.digikey.com/p/ne555dr", package: null,
  lifecycleStatus: "active", lifecycleRaw: "Active", fetchedAt: T0.getTime(), ...overrides,
});
type ExtractedFact = { property: string; facet: "terminal" | "package" | "supply"; value: string; locator: string };
const extraction = (exactMpn: string, hash: string, facts: ExtractedFact[] = [{ property: "pin_mapping", facet: "terminal", value: "1=A", locator: "p1" }], extra: Record<string, unknown> = {}) =>
  candidateFromExtraction({ exactMpn, sourceId: "src_ds", sourceClass: "manufacturer_datasheet", method: "kicad_parser", parserVersion: "p/1", documentHash: hash.repeat(64), facts, ...extra } as never);

describe("[B19-D I5b row 27a] a bundle's identity is the exact published MPN", () => {
  it.each([
    ["MAX3232CSE+", "MAX3232CSE"],
    ["LT1086CM#PBF", "LT1086CMPBF"],
    ["BAT54", "BAT54С"],
    ["BAT54S", "BAT54ſ"],
    ["BAT54C", "BAT54​C"],
  ])("%s and %s are never one part", (a, b) => {
    expect(() => buildEvidenceBundle([extraction(a, "a"), extraction(b, "b")], T0)).toThrow(/different parts|confusable|printable ASCII/);
  });

  it("case alone does not make a different part (baseline)", () => {
    expect(buildEvidenceBundle([extraction("ne555dr", "a"), extraction("NE555DR", "b")], T0).exactMpns).toEqual(["NE555DR", "ne555dr"]);
  });
});

describe("[B19-D I5b row 39] every engineering disagreement is a conflict", () => {
  it("terminal function, electrical rating and package geometry", () => {
    const a = extraction("NE555DR", "a", [
      { property: "terminal_function", facet: "terminal", value: "1=GND", locator: "t1" },
      { property: "electrical_rating", facet: "supply", value: "18V", locator: "t2" },
      { property: "package_geometry", facet: "package", value: "3.9x4.9mm", locator: "t3" },
    ]);
    const b = extraction("NE555DR", "b", [
      { property: "terminal_function", facet: "terminal", value: "1=VCC", locator: "t1" },
      { property: "electrical_rating", facet: "supply", value: "16V", locator: "t2" },
      { property: "package_geometry", facet: "package", value: "3.0x3.0mm", locator: "t3" },
    ]);
    expect(buildEvidenceBundle([a, b], T0).conflicts.map((conflict) => conflict.property).sort()).toEqual(["electrical_rating", "package_geometry", "terminal_function"]);
  });
});

describe("[B19-D I5b row 40] what was asked, and what a newer revision replaced", () => {
  it("the observation keeps the requested MPN beside the vendor's, and the bundle reports the mismatch", () => {
    const observation = observationFromPricing(pricing({ mpn: "NE555DRG4" }), { rawContentHash: null, retrievedAt: T0, requestedMpn: "NE555DR" } as never);
    expect(observation.queriedMpn).toBe("NE555DR");
    expect(observation.values.mpn).toBe("NE555DRG4");
    const bundle = buildEvidenceBundle([candidateFromObservation(observation)], T0);
    expect(bundle.conflicts.find((conflict) => conflict.property === "mpn")?.values.map((value) => value.value).sort()).toEqual(["NE555DR", "NE555DRG4"]);
  });

  it("an extraction from a superseded document revision is stale", () => {
    const old = extraction("NE555DR", "c", undefined, { sourceRevision: "A", supersededBy: "B" });
    const bundle = buildEvidenceBundle([old], T0);
    expect(bundle.staleObservationIds).toEqual(old.observationIds);
  });
});

describe("[B19-D I5b row 41] vendor links and text are cleaned before they become facts", () => {
  it("a javascript: product link and a data: datasheet link are dropped; control characters are removed", () => {
    const observation = observationFromPricing(pricing({ productUrl: "javascript:alert(1)", datasheet: "data:text/html,x", description: "Acme\r=HYPERLINK(1)‮" }), { rawContentHash: null, retrievedAt: T0 });
    const facts = candidateFromObservation(observation).facts;
    expect(facts.some((fact) => fact.property === "product_url")).toBe(false);
    expect(facts.some((fact) => fact.property === "datasheet_url")).toBe(false);
    const description = String(facts.find((fact) => fact.property === "description")?.value);
    expect(description).not.toMatch(/[\r\n‮]/);
    expect(description).toContain("Acme");
  });

  it.each(["https://user:pw@www.digikey.com/x", "//evil.example/x", "https://127.0.0.1/x", "https://www.digikey.com/a b"])("product link %s is dropped", (url) => {
    const facts = candidateFromObservation(observationFromPricing(pricing({ productUrl: url }), { rawContentHash: null, retrievedAt: T0 })).facts;
    expect(facts.some((fact) => fact.property === "product_url")).toBe(false);
  });

  it("surrounding whitespace is trimmed, not a reason to drop a link (baseline)", () => {
    const facts = candidateFromObservation(observationFromPricing(pricing({ productUrl: " https://www.digikey.com/x " }), { rawContentHash: null, retrievedAt: T0 })).facts;
    expect(facts.find((fact) => fact.property === "product_url")?.value).toBe("https://www.digikey.com/x");
  });

  it("an https product link and an http datasheet link survive (baselines)", () => {
    const facts = candidateFromObservation(observationFromPricing(pricing({ datasheet: "http://www.ti.com/lit/ds/ne555.pdf" }), { rawContentHash: null, retrievedAt: T0 })).facts;
    expect(facts.find((fact) => fact.property === "product_url")).toMatchObject({ establishes: "sourcing", value: "https://www.digikey.com/p/ne555dr" });
    expect(facts.find((fact) => fact.property === "datasheet_url")?.value).toBe("http://www.ti.com/lit/ds/ne555.pdf");
  });
});
