/**
 * [B19-E E2] b — which sources an external candidate search may construct: only admitted, enabled sources with a registered
 * candidate search. Mouser (disabled, OD-32) and LCSC (blocked) are never constructed or asked, even with keys set; an
 * operator switch-off and missing credentials hold too. Fake clients, no vendor, no database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const constructed: string[] = [];
const searched: string[] = [];
const fakeClient = (name: string) => {
  constructed.push(name);
  return {
    name,
    lookupByMpn: vi.fn(async () => null),
    lookupBatch: vi.fn(async () => new Map()),
    searchCandidates: vi.fn(async () => {
      searched.push(name);
      return { ok: true as const, hits: [], rawContentHash: "0".repeat(64), retrievedAt: Date.UTC(2026, 8, 13, 12) };
    }),
  };
};
vi.mock("../../distributors/digikey", () => ({ makeDigiKeyClient: () => fakeClient("digikey") }));
vi.mock("../../distributors/mouser", () => ({ makeMouserClient: () => fakeClient("mouser") }));
vi.mock("../../distributors/octopart", () => ({ makeOctopartClient: () => fakeClient("octopart") }));
vi.mock("../../distributors/lcsc", () => ({ makeLcscClient: () => fakeClient("lcsc") }));
vi.mock("../../db/client", () => ({ getDb: () => { throw new Error("the external search touched the database"); } }));

// Obvious fakes, assembled at runtime.
const KEYS: Record<string, string> = {
  DIGIKEY_CLIENT_ID: ["fake", "dk", "id"].join("-"),
  DIGIKEY_CLIENT_SECRET: ["fake", "dk", "secret"].join("-"),
  MOUSER_API_KEY: ["fake", "mouser", "key"].join("-"),
  OCTOPART_API_KEY: ["fake", "nexar", "token"].join("-"),
  LCSC_API_KEY: ["fake", "lcsc", "key"].join("-"),
  LCSC_API_SECRET: ["fake", "lcsc", "secret"].join("-"),
};
const ALL = ["digikey", "mouser", "octopart", "lcsc"] as const;
const SCOPE = { tenantId: "tenant-a", projectId: "project-1" };

async function fresh() {
  vi.resetModules(); // the pricing layer builds its process-wide clients once
  return import("../external-search");
}

beforeEach(() => {
  constructed.length = 0;
  searched.length = 0;
  for (const [name, value] of Object.entries(KEYS)) vi.stubEnv(name, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("[B19-E E2] b — Mouser and LCSC are never constructed", () => {
  it("with every key set, only DigiKey and Nexar are constructed and searched through the process-wide clients", async () => {
    const { searchExternalCandidates } = await fresh();
    const result = await searchExternalCandidates({ query: "NE555DR", mode: "exact", limit: 5, sources: [...ALL] }, { live: true, purpose: "interactive", scope: SCOPE });
    if (!result.ok) throw new Error(result.code);
    expect([...constructed].sort()).toEqual(["digikey", "octopart"]);
    expect([...searched].sort()).toEqual(["digikey", "octopart"]);
    expect(Object.fromEntries(result.sources.map((source) => [source.sourceId, source.status]))).toEqual({ digikey: "available", mouser: "disabled", octopart: "available", lcsc: "blocked" });
    expect(result.sources.find((source) => source.sourceId === "mouser")!.ownerDecision).toBe("OD-32");
    const text = JSON.stringify(result);
    for (const [name, value] of Object.entries(KEYS)) {
      expect(text).not.toContain(name);
      expect(text).not.toContain(value);
    }
  });

  it("an injected connector is never asked to build Mouser or LCSC either", async () => {
    const { searchExternalCandidates } = await fresh();
    const connect = vi.fn(() => null);
    await searchExternalCandidates({ query: "NE555DR", mode: "exact", limit: 5, sources: [...ALL] }, { live: true, purpose: "interactive", scope: SCOPE, connect });
    expect(connect.mock.calls.map((call) => (call as unknown[])[0]).sort()).toEqual(["digikey", "octopart"]);
  });

  it("an operator switch-off holds for search: DigiKey off is never constructed", async () => {
    vi.stubEnv("SIRKIT_ACQUISITION_DISABLED_SOURCES", "digikey");
    const { searchExternalCandidates } = await fresh();
    const result = await searchExternalCandidates({ query: "NE555DR", mode: "exact", limit: 5 }, { live: true, purpose: "interactive", scope: SCOPE });
    if (!result.ok) throw new Error(result.code);
    expect(constructed).toEqual(["octopart"]);
    expect(result.sources.find((source) => source.sourceId === "digikey")!.status).toBe("operator_disabled");
  });

  it("missing credentials: not constructed, and the result names no environment variable", async () => {
    vi.stubEnv("OCTOPART_API_KEY", "");
    vi.stubEnv("NEXAR_API_KEY", "");
    const { searchExternalCandidates } = await fresh();
    const result = await searchExternalCandidates({ query: "NE555DR", mode: "exact", limit: 5 }, { live: true, purpose: "interactive", scope: SCOPE });
    if (!result.ok) throw new Error(result.code);
    expect(constructed).toEqual(["digikey"]);
    expect(result.sources.find((source) => source.sourceId === "octopart")!.status).toBe("credentials_missing");
    expect(JSON.stringify(result)).not.toMatch(/OCTOPART_API_KEY|NEXAR_API_KEY|DIGIKEY_CLIENT/);
  });
});
