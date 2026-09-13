/**
 * [B19-A I3] Which sources the pricing layer may call, decided by the source registry — fake clients, no vendor.
 *
 *  - A DISABLED source (Mouser, OD-32) is never constructed or called, even with its key configured.
 *  - An operator may switch a source OFF with `SIRKIT_ACQUISITION_DISABLED_SOURCES`; nothing can switch one on.
 *  - A bulk refresh (the operator's `refresh-bom-pricing` job) touches only sources whose terms permit it — none today:
 *    DigiKey's agreement prohibits bulk download and Nexar's terms are unclear, so both refuse (OD-33).
 *  - A BOM names why a source is unavailable: blocked, disabled, switched off, or missing credentials.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const constructed: string[] = [];
const lookups: Record<string, number> = {};
const fakeClient = (name: string) => {
  constructed.push(name);
  return {
    name,
    lookupByMpn: vi.fn(async () => null),
    lookupBatch: vi.fn(async (mpns: string[]) => {
      lookups[name] = (lookups[name] ?? 0) + mpns.length;
      return new Map();
    }),
  };
};
vi.mock("../digikey", () => ({ makeDigiKeyClient: () => fakeClient("digikey") }));
vi.mock("../mouser", () => ({ makeMouserClient: () => fakeClient("mouser") }));
vi.mock("../octopart", () => ({ makeOctopartClient: () => fakeClient("octopart") }));
vi.mock("../cache", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, getCachedOffersForParts: vi.fn(async () => new Map()), putCachedOffer: vi.fn(async () => undefined), evictCached: vi.fn() };
});
vi.mock("../../db/client", () => ({ getDb: () => ({ update: () => ({ set: () => ({ where: async () => undefined }) }) }) }));

const PARTS = [{ partId: "p-555", mpn: "NE555DR" }];
const ALL_KEYS = { DIGIKEY_CLIENT_ID: "id", DIGIKEY_CLIENT_SECRET: "secret", MOUSER_API_KEY: "mouser-key", OCTOPART_API_KEY: "nexar-token" };

async function freshPricing() {
  vi.resetModules(); // the orchestrator builds its clients once per process
  return import("..");
}

beforeEach(() => {
  constructed.length = 0;
  for (const key of Object.keys(lookups)) delete lookups[key];
  for (const [name, value] of Object.entries(ALL_KEYS)) vi.stubEnv(name, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("[B19-A I3] a disabled source is never called", () => {
  it("Mouser, with MOUSER_API_KEY configured: never constructed, never asked", async () => {
    const { getPricingFor } = await freshPricing();
    await getPricingFor(PARTS, "all", { live: true });
    expect(constructed).not.toContain("mouser");
    expect(lookups.mouser ?? 0).toBe(0);
    expect(lookups, "the enabled sources are still asked").toMatchObject({ digikey: 1, octopart: 1 });
  });

  it("choosing Mouser alone prices nothing", async () => {
    const { getPricingFor } = await freshPricing();
    const result = await getPricingFor(PARTS, "mouser", { live: true });
    expect(result.size).toBe(0);
    expect(constructed).toEqual([]);
  });
});

describe("[B19-A I3] an operator can switch a source off, and never on", () => {
  it("SIRKIT_ACQUISITION_DISABLED_SOURCES=digikey switches DigiKey off", async () => {
    vi.stubEnv("SIRKIT_ACQUISITION_DISABLED_SOURCES", "digikey");
    const { getPricingFor } = await freshPricing();
    await getPricingFor(PARTS, "all", { live: true });
    expect(constructed).toEqual(["octopart"]);
  });

  it("there is no switch that enables a disabled or blocked source", async () => {
    vi.stubEnv("SIRKIT_ACQUISITION_ENABLED_SOURCES", "mouser,lcsc");
    vi.stubEnv("SIRKIT_ACQUISITION_DISABLED_SOURCES", "");
    const { getPricingFor } = await freshPricing();
    await getPricingFor(PARTS, "all", { live: true });
    expect(constructed.sort()).toEqual(["digikey", "octopart"]);
  });
});

describe("[B19-A I3] a bulk refresh touches only sources whose terms permit it", () => {
  it("neither DigiKey (bulk download prohibited) nor Nexar (unclear) is asked by a bulk refresh", async () => {
    const { getPricingFor } = await freshPricing();
    await getPricingFor(PARTS, "all", { live: true, forceRefresh: true, purpose: "bulk-refresh" });
    expect(lookups).toEqual({});
  });

  it("the operator refresh job asks for live pricing AS a bulk refresh (tripwire on the script's one pricing call)", () => {
    const script = readFileSync(resolve(process.cwd(), "scripts/refresh-bom-pricing.ts"), "utf8");
    const calls = [...script.matchAll(/getPricingFor\(([^)]*)\)/g)].map((match) => match[1]!);
    expect(calls).toHaveLength(1);
    // [B19-A I3] after I2 made live pricing a grant, this call still passed only `forceRefresh` — so the job silently
    // refreshed nothing. It is an operator job: it is granted live pricing, and it declares itself a bulk refresh.
    expect(calls[0]).toMatch(/live:\s*true/);
    expect(calls[0]).toMatch(/purpose:\s*"bulk-refresh"/);
  });
});

describe("[B19-A I3] a BOM says why a source is unavailable", () => {
  it("disabled, switched off, and missing credentials each carry their own sentence, naming variables and never values", async () => {
    vi.stubEnv("SIRKIT_ACQUISITION_DISABLED_SOURCES", "octopart");
    vi.stubEnv("DIGIKEY_CLIENT_SECRET", "");
    const { unavailableSources } = await freshPricing();
    const reasons = unavailableSources("all");
    expect(reasons.map((reason) => [reason.name, reason.refusal])).toEqual([
      ["digikey", "credentials_missing"],
      ["mouser", "disabled"],
      ["octopart-aggregated", "operator_disabled"],
    ]);
    const text = reasons.map((reason) => reason.message).join("\n");
    expect(text).toContain("DIGIKEY_CLIENT_SECRET");
    expect(text).toContain("OD-32");
    for (const value of Object.values(ALL_KEYS)) expect(text).not.toContain(value);
  });
});
