/**
 * [B19-D I5b review] Verified findings on the value rules I5b introduced — each case failed on the I5b code.
 */
import { describe, expect, it } from "vitest";
import { asNumber } from "../types";
import { mapLifecycleString } from "../lifecycle";
import { inertExternalText, safeExternalHref } from "../../net/external-href";
import { assertArchiveBudget, IngestSecurityError } from "../../atomic/security";
import { collectAdapterPages, SourceAdapterError, type SourceAdapter } from "../../atomic/ingestion";
import { buildEvidenceBundle, candidateFromObservation, observationFromPricing } from "../../acquisition/quarantine";
import type { PartPricing } from "../types";

describe("[B19-D I5b review] a three-digit decimal comma is not a thousands group", () => {
  it.each(["0,340", "0,123", "$0,340"])("%s is not a number", (raw) => {
    expect(asNumber(raw)).toBeNull();
  });
  it.each([["1,234", 1234], ["12,345.6", 12345.6], ["0.340", 0.34]] as const)("%s → %s (baselines)", (raw, expected) => {
    expect(asNumber(raw)).toBe(expected);
  });
});

describe("[B19-D I5b review] every negated lifecycle phrase is unknown", () => {
  it.each(["Inactive", "Not Active", "Not  Active", "Non-Active", "No Longer Active", "Not In Production", "No Longer In Production", "Not Preferred", "Non-Preferred", "Deactivated"])("%s → unknown", (term) => {
    expect(mapLifecycleString(term)).toBe("unknown");
  });
  it.each([["Active", "active"], ["In Production", "active"], ["Production", "unknown"], ["Preferred", "active"], ["Obsolete", "obsolete"]] as const)("%s → %s (baselines)", (term, expected) => {
    expect(mapLifecycleString(term)).toBe(expected);
  });
});

describe("[B19-D I5b review] inert text removes every format and control character, without splitting a character", () => {
  it.each([["ALM", "؜"], ["word joiner", "⁠"], ["invisible times", "⁢"], ["tag A", "\u{E0041}"], ["soft hyphen", "­"], ["line separator", " "]])("%s", (_label, char) => {
    expect(inertExternalText(`Acme${char}Parts`)).toBe("Acme Parts");
  });
  it("truncation never leaves half of a surrogate pair", () => {
    const text = inertExternalText(`${"a".repeat(4)}\u{1F600}\u{1F600}`, 5)!;
    expect(text).toBe("aaaa\u{1F600}");
    expect(/[\uD800-\uDFFF]/.test(text.replace(/\u{1F600}/gu, ""))).toBe(false);
  });
});

describe("[B19-D I5b review] links: a page must be HTTPS, and a host allowlist is case-insensitive", () => {
  it("an http product page is dropped; an http document is kept (baseline)", () => {
    expect(safeExternalHref("http://www.digikey.com/x", "page")).toBeNull();
    expect(safeExternalHref("http://www.ti.com/ds.pdf", "document")).toBe("http://www.ti.com/ds.pdf");
  });
  it("allowedHosts accepts subdomains, refuses look-alikes, and ignores the case of its entries", () => {
    expect(safeExternalHref("https://www.digikey.com/x", "page", ["digikey.com"])).toBe("https://www.digikey.com/x");
    expect(safeExternalHref("https://evildigikey.com/x", "page", ["digikey.com"])).toBeNull();
    expect(safeExternalHref("https://www.digikey.com/x", "page", ["DigiKey.com"])).toBe("https://www.digikey.com/x");
  });
});

describe("[B19-D I5b review] an archive budget checks each named count, present or not", () => {
  it.each([[{ entries: 1, compressedBytes: 1 }], [{ compressedBytes: 1, decompressedBytes: 50 }], [Object.create({ entries: 1, compressedBytes: 1, decompressedBytes: Number.NaN })]])("%j", (input) => {
    expect(() => assertArchiveBudget(input as never)).toThrow(IngestSecurityError);
  });
});

describe("[B19-D I5b review] adapter deadlines hold against a hanging page and a hanging retry wait", () => {
  const source = { id: "s", sourceClass: "manufacturer_datasheet" as const, name: "s", officialDomains: [], licenseId: "l" };
  it("a fetchPage that never settles is abandoned at the deadline", async () => {
    const hanging: SourceAdapter = { id: "h", source, allowedHosts: [], fetchPage: () => new Promise(() => undefined) };
    const started = Date.now();
    await expect(collectAdapterPages(hanging, 50)).rejects.toThrow(/deadline/);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
  it("a retry wait that never settles is abandoned at the deadline", async () => {
    const limited: SourceAdapter = { id: "r", source, allowedHosts: [], fetchPage: async () => { throw new SourceAdapterError("rate_limited", "slow down", 5000); } };
    const started = Date.now();
    await expect(collectAdapterPages(limited, 50, { maxRetries: 2, wait: () => new Promise(() => undefined) })).rejects.toThrow(/deadline/);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("[B19-D I5b review] case alone is never an MPN conflict", () => {
  it("two observations spelled NE555DR and ne555dr, and a lower-case request for NE555DR, raise no mpn conflict", () => {
    const T0 = new Date("2026-09-13T12:00:00.000Z");
    const pricing = (mpn: string, distributor: PartPricing["distributor"]): PartPricing => ({ distributor, mpn, manufacturer: null, description: null, datasheet: null, inStock: 1, minOrderQty: 1, priceBreaks: [], bestUnitPrice: null, productUrl: null, package: null, lifecycleStatus: "unknown", lifecycleRaw: null, fetchedAt: T0.getTime() });
    const a = candidateFromObservation(observationFromPricing(pricing("NE555DR", "digikey"), { rawContentHash: null, retrievedAt: T0, requestedMpn: "ne555dr" }));
    const b = candidateFromObservation(observationFromPricing(pricing("ne555dr", "octopart-aggregated"), { rawContentHash: null, retrievedAt: T0 }));
    expect(buildEvidenceBundle([a, b], T0).conflicts.filter((conflict) => conflict.property === "mpn")).toEqual([]);
  });
});
