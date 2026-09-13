/**
 * [B19-D I5b row 36] A BOM line is priced for its own exact MPN.
 *
 * Pricing was requested once per catalog partId (the first group's MPN) and looked up by partId, so two lines pinned to
 * different exact parts under one catalog row — e.g. two resistor values — were both shown the first line's price.
 */
import { describe, expect, it, vi } from "vitest";
import type { ProjectComponentPin } from "@/app/lib/atomic/types";
import { makeFixtureCatalog, TEST_NOW } from "@/app/lib/atomic/__tests__/fixtures";

const requested: string[] = [];
vi.mock("@/app/lib/distributors", async (orig) => {
  const actual = (await orig()) as Record<string, unknown> & { pricingKey?: (partId: string, mpn: string) => string };
  return {
    ...actual,
    unavailableSources: () => [],
    pausedSources: () => [],
    getPricingFor: vi.fn(async (items: Array<{ partId: string; mpn: string }>) => {
      const result = new Map<string, unknown>();
      for (const item of items) {
        requested.push(item.mpn);
        const key = typeof actual.pricingKey === "function" ? actual.pricingKey(item.partId, item.mpn) : item.partId;
        const offer = { distributor: "digikey", mpn: item.mpn, manufacturer: null, description: null, datasheet: null, inStock: 1, minOrderQty: 1, priceBreaks: [{ qty: 1, price: 0.1, currency: "USD" }], bestUnitPrice: 0.1, productUrl: null, package: null, lifecycleStatus: "active", lifecycleRaw: null, fetchedAt: 0 };
        result.set(key, { partId: item.partId, mpn: item.mpn, offers: [offer], bestOverall: offer, lifecycleStatus: "active", sourcesQueried: ["digikey"], sourcesFromCache: 0, sourcesFromLive: 1 });
      }
      return result;
    }),
  };
});

import { buildBom } from "@/app/lib/bom/build";

function pinFor(mpn: string, revisionSuffix: string): ProjectComponentPin {
  const fixture = makeFixtureCatalog();
  const snapshot = structuredClone(fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW));
  snapshot.atomicRevision = { ...snapshot.atomicRevision, id: `${snapshot.atomicRevision.id}-${revisionSuffix}` };
  snapshot.exactPart = { ...snapshot.exactPart!, exactMpn: mpn };
  return { selectionRecordId: `sel-${revisionSuffix}`, atomicRevisionId: snapshot.atomicRevision.id, symbolVersionId: fixture.symbol.versionId, modelVersionIds: [], embeddedSnapshot: snapshot };
}

describe("[B19-D I5b row 36] each line is priced for its own exact MPN", () => {
  it("two lines pinned to different exact parts under one catalog partId", async () => {
    const p10k = pinFor("RC0805FR-0710KL", "10k");
    const p56k = pinFor("RC0805FR-0756KL", "56k");
    const state = {
      components: [], wires: [],
      kicadComponents: [
        { id: "R1", partId: "P", x: 0, y: 0, rotation: 0, refDes: "R1", value: "10k", atomicPartRevisionId: p10k.atomicRevisionId },
        { id: "R2", partId: "P", x: 0, y: 0, rotation: 0, refDes: "R2", value: "56k", atomicPartRevisionId: p56k.atomicRevisionId },
      ],
    };
    const result = await buildBom(state as never, "digikey", { live: true }, { R1: p10k, R2: p56k });
    expect(requested.sort()).toEqual(["RC0805FR-0710KL", "RC0805FR-0756KL"]);
    for (const row of result.rows) expect(row.pricing?.bestOverall?.mpn, row.refDes).toBe(row.mpn);
  });
});
