/**
 * [B19-E E1] Where a person sees a source or an offer, its label comes from the source registry: who the source is, whether
 * it is enabled, the owner decision behind that, its attribution, and — for an offer — whether it is live or cached, when the
 * vendor answered, and when the source's served-for window ends. Mouser and LCSC (no storage) never get a servable label.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { offerFreshness, sourceLabel } from "../source-labels";
import { SOURCE_REGISTRY } from "../source-registry";

const MINUTE = 60_000;
const AT = Date.UTC(2026, 8, 13, 12, 0);

describe("[B19-E E1] source labels come from the registry", () => {
  it("carries the display name, status, owner decision, attribution and freshness label, by source id or distributor name", () => {
    expect(sourceLabel("digikey")).toEqual({
      sourceId: "digikey",
      displayName: "DigiKey",
      registryStatus: "enabled",
      ownerDecision: "OD-33",
      attribution: SOURCE_REGISTRY.digikey.license.attribution,
      freshnessLabel: SOURCE_REGISTRY.digikey.freshness.label,
      servedForMs: SOURCE_REGISTRY.digikey.freshness.offerTtlMs,
    });
    expect(sourceLabel("octopart-aggregated")?.sourceId).toBe("octopart");
    expect(sourceLabel("mouser")).toMatchObject({ registryStatus: "disabled", ownerDecision: "OD-32", servedForMs: 0 });
    expect(sourceLabel("lcsc")).toMatchObject({ registryStatus: "blocked" });
    expect(sourceLabel("an-unregistered-source")).toBeNull();
  });
});

describe("[B19-E E1] an offer's freshness is measured from when the vendor answered", () => {
  it("a cached DigiKey offer is fresh inside its hour and stale after, with the vendor's time and the expiry", () => {
    const offer = { distributor: "digikey", fetchedAt: AT + 5 * MINUTE, provenance: { servedFrom: "offer-cache" as const, retrievedAt: AT } };
    const fresh = offerFreshness(offer, AT + 30 * MINUTE)!;
    expect(fresh).toMatchObject({ sourceId: "digikey", servedFrom: "offer-cache", basis: "cached", retrievedAt: AT, expiresAt: AT + SOURCE_REGISTRY.digikey.freshness.offerTtlMs, state: "fresh", servable: true });
    expect(fresh.label).toContain("DigiKey");
    expect(fresh.label).toContain("cached");
    expect(fresh.label).toContain("2026-09-13 12:00 UTC");
    expect(offerFreshness(offer, AT + 61 * MINUTE)).toMatchObject({ state: "stale", servable: false });
  });

  it("a live Nexar answer is labelled live and expires a day after it was retrieved", () => {
    expect(offerFreshness({ distributor: "octopart-aggregated", fetchedAt: AT, provenance: { servedFrom: "live", retrievedAt: AT } }, AT)).toMatchObject({ basis: "live", servedFrom: "live", expiresAt: AT + SOURCE_REGISTRY.octopart.freshness.offerTtlMs, state: "fresh" });
  });

  it.each(["mouser", "lcsc"])("%s never produces a servable label, at any time", (distributor) => {
    for (const now of [AT, AT + 1, AT + 7 * 24 * 60 * MINUTE]) {
      const label = offerFreshness({ distributor, fetchedAt: AT, provenance: { servedFrom: "live", retrievedAt: AT } }, now)!;
      expect(label.servable).toBe(false);
      expect(label.expiresAt).toBe(AT);
      expect(label.label).toMatch(/not kept/);
    }
  });

  it("an offer without provenance is labelled from its evidence, and an unregistered source has no label", () => {
    expect(offerFreshness({ distributor: "digikey", fetchedAt: AT + MINUTE, evidence: { rawContentHash: "e".repeat(64), retrievedAt: AT } }, AT + MINUTE)).toMatchObject({ basis: "live", retrievedAt: AT });
    expect(offerFreshness({ distributor: "digikey", fetchedAt: AT }, AT + MINUTE)).toMatchObject({ basis: "cached", retrievedAt: AT });
    expect(offerFreshness({ distributor: "somewhere-else", fetchedAt: AT }, AT)).toBeNull();
  });

  it("a retrieval time in the future is never shown as later than now", () => {
    expect(offerFreshness({ distributor: "digikey", fetchedAt: AT, provenance: { servedFrom: "offer-cache", retrievedAt: AT + 60 * MINUTE } }, AT)!.retrievedAt).toBe(AT);
  });

  it("the labels module is browser-safe: no server-only imports and no environment reads", () => {
    const source = readFileSync("app/lib/acquisition/source-labels.ts", "utf8");
    expect(source).not.toMatch(/db\/client|process\.env|from "node:|server-only|distributors\/index|from "\.\.\/distributors"/);
  });
});
