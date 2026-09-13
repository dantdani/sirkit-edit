/**
 * [B19-E E1] The BOM result says how it was priced and what each source's state is, as data.
 *
 * Before E1 a source that was blocked, disabled by an owner decision, switched off, missing credentials or paused appeared
 * only as a sentence in `warnings` (and a paused source only in a live build), so the workbench could not label a source or
 * say when it may be tried again, and nothing said whether the prices were cached or live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db/client", () => ({ getDb: () => { throw new Error("no database in this test"); } }));

import { buildBom } from "../build";
import { SOURCE_REGISTRY_VERSION } from "@/app/lib/acquisition/source-registry";
import { recordOutcome, resetAdmissionControl } from "@/app/lib/acquisition/admission-control";

// a theory-only schematic: no catalog part is priced, so no database or vendor is touched
const STATE = { components: [{ id: "r1", type: "resistor", value: "10k", x: 0, y: 0, rotation: 0, refDes: "R1" }], wires: [], kicadComponents: [], netLabels: [] } as never;
const SECRET = ["client", "secret", "SENTINEL", "0123456789"].join("-");

beforeEach(() => {
  resetAdmissionControl();
  vi.stubEnv("DIGIKEY_CLIENT_ID", "id-SENTINEL");
  vi.stubEnv("DIGIKEY_CLIENT_SECRET", SECRET);
  vi.stubEnv("MOUSER_API_KEY", "mouser-key-SENTINEL");
  vi.stubEnv("OCTOPART_API_KEY", "");
  vi.stubEnv("SIRKIT_ACQUISITION_DISABLED_SOURCES", "");
});
afterEach(() => { vi.unstubAllEnvs(); resetAdmissionControl(); });

describe("[B19-E E1] every registry source the choice names has a structured status", () => {
  it("available, disabled with its owner decision, credentials missing and blocked — with no credential value anywhere", async () => {
    const result = await buildBom(STATE, "all");
    expect(result.pricingMode).toBe("cache-only");
    expect(result.registryVersion).toBe(SOURCE_REGISTRY_VERSION);
    const byId = Object.fromEntries(result.sources.map((source) => [source.sourceId, source]));
    expect(byId.digikey).toMatchObject({ displayName: "DigiKey", status: "available", ownerDecision: "OD-33", retryAt: null });
    expect(byId.mouser).toMatchObject({ status: "disabled", ownerDecision: "OD-32" });
    expect(byId.octopart).toMatchObject({ status: "credentials_missing" });
    expect(byId.lcsc).toMatchObject({ status: "blocked" });
    for (const source of result.sources) {
      expect(source.freshnessLabel.length).toBeGreaterThan(0);
      expect(source.attribution.length).toBeGreaterThan(0);
    }
    const json = JSON.stringify(result);
    for (const value of [SECRET, "id-SENTINEL", "mouser-key-SENTINEL"]) expect(json).not.toContain(value);
  });

  it("a source switched off by the operator says so", async () => {
    vi.stubEnv("SIRKIT_ACQUISITION_DISABLED_SOURCES", "digikey");
    const result = await buildBom(STATE, "digikey");
    expect(result.sources).toEqual([expect.objectContaining({ sourceId: "digikey", status: "operator_disabled" })]);
  });

  it.each([false, true])("a paused source says when it may be tried again (live build: %s)", async (live) => {
    vi.stubEnv("OCTOPART_API_KEY", "token-SENTINEL");
    recordOutcome("octopart", "rate_limited");
    const result = await buildBom(STATE, "octopart", { live });
    expect(result.pricingMode).toBe(live ? "live" : "cache-only");
    const [octopart] = result.sources;
    expect(octopart).toMatchObject({ sourceId: "octopart", status: "paused" });
    expect(typeof octopart!.retryAt).toBe("number");
    expect(JSON.stringify(result)).not.toContain("token-SENTINEL");
  });

  it("[B19-E E1-C review] the result carries the server's clock, so a client judges expiry in server time", async () => {
    const before = Date.now();
    const result = await buildBom(STATE, "all");
    expect(typeof result.generatedAt).toBe("number");
    expect(result.generatedAt).toBeGreaterThanOrEqual(before);
    expect(result.generatedAt).toBeLessThanOrEqual(Date.now());
  });

  it("no pricing choice has no sources and says so (baseline)", async () => {
    const result = await buildBom(STATE, "none");
    expect(result.pricingMode).toBe("none");
    expect(result.sources).toEqual([]);
  });
});
