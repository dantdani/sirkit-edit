/**
 * [B19-A I3] The versioned source registry: complete, internally consistent, secret-free, admitting only what it may,
 * and rendered to a committed artifact that cannot drift.
 *
 * Regenerate the artifact after a reviewed registry change: npx tsx scripts/generate-b19-source-registry.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  admitSource,
  ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING,
  OPERATOR_DISABLE_ENV,
  renderSourceRegistryCsv,
  SOURCE_IDS,
  SOURCE_REGISTRY,
  SOURCE_REGISTRY_VERSION,
  sourceForDistributorName,
  validateSourceRegistry,
  type SourceRegistryEntry,
} from "../source-registry";

const ARTIFACT = "artifacts/ai-control-plane-b19/source-registry.csv";
const entries = SOURCE_IDS.map((id) => SOURCE_REGISTRY[id]);

/** A writable copy of one entry, shaped only as far as the crafted revisions below need. */
type WritableEntry = {
  endpoints: { hosts: string[]; operations: Array<{ url: string }> };
  auth: { secrets: Array<{ env: string }>; secretQueryParams: string[] };
  provider: { notes: string[] };
  resilience: { minRequestSpacingMs: number; maxRedirects: number };
  freshness: { offerTtlMs: number };
};

function mutated(id: keyof typeof SOURCE_REGISTRY, change: (entry: WritableEntry) => void): SourceRegistryEntry[] {
  return entries.map((entry) => {
    if (entry.id !== id) return entry;
    const copy = JSON.parse(JSON.stringify(entry)) as WritableEntry;
    change(copy);
    return copy as unknown as SourceRegistryEntry;
  });
}

describe("[B19-A I3] the registry is complete and valid", () => {
  it("is versioned, and registers DigiKey, Mouser, Octopart/Nexar and LCSC", () => {
    expect(SOURCE_REGISTRY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect([...SOURCE_IDS]).toEqual(["digikey", "mouser", "octopart", "lcsc"]);
  });

  it("every entry carries every field the runbook names", () => {
    for (const entry of entries) {
      expect(entry.provider.organization && entry.provider.api && entry.provider.apiVersion, `${entry.id} identity and API version`).toBeTruthy();
      expect(entry.endpoints.hosts, `${entry.id} permitted domains`).toBeDefined();
      expect(entry.auth.method, `${entry.id} authentication method`).toBeTruthy();
      expect(entry.auth.secrets, `${entry.id} secret references`).toBeDefined();
      expect(entry.observations, `${entry.id} supported observations`).toBeDefined();
      expect(entry.quota.limits.length, `${entry.id} rate/quota policy`).toBeGreaterThan(0);
      expect(entry.resilience.breaker.consecutiveFailuresToOpen, `${entry.id} timeout/retry/breaker`).toBeGreaterThan(0);
      expect(entry.freshness.label, `${entry.id} caching/freshness`).toBeTruthy();
      expect(entry.license.terms.length && entry.license.attribution, `${entry.id} license/retention/redistribution`).toBeTruthy();
      expect(entry.scope.region && entry.scope.account, `${entry.id} regional/account scope`).toBeTruthy();
      expect(entry.authorityClass, `${entry.id} authority class`).toBe("sourcing_observation");
      expect(["enabled", "disabled", "blocked"], `${entry.id} state`).toContain(entry.state.status);
      expect(entry.provider.documentationCheckedOn, `${entry.id} was checked against current documentation`).toBe("2026-09-13");
    }
  });

  it("passes every structural rule", () => {
    expect(validateSourceRegistry()).toEqual([]);
  });

  it("the states are the ones the documentation supports: DigiKey and Nexar enabled, Mouser disabled (OD-32), LCSC blocked", () => {
    expect(Object.fromEntries(entries.map((entry) => [entry.id, entry.state.status]))).toEqual({ digikey: "enabled", mouser: "disabled", octopart: "enabled", lcsc: "blocked" });
    expect(SOURCE_REGISTRY.mouser.state.ownerDecision).toBe("OD-32");
    expect(SOURCE_REGISTRY.lcsc.endpoints.hosts, "a blocked source declares nothing callable").toEqual([]);
  });

  it("no source's data may prove an engineering fact", () => {
    expect([...ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING]).toEqual(expect.arrayContaining(["electrical-pin-mapping", "footprint", "cad-correctness"]));
    for (const entry of entries) expect(entry.sourceClass).toBe("distributor_catalog");
  });

  it("maps each stored-offer key back to exactly one source", () => {
    expect(sourceForDistributorName("octopart-aggregated")?.id).toBe("octopart");
    expect(sourceForDistributorName("digikey")?.id).toBe("digikey");
    expect(sourceForDistributorName("unknown-vendor")).toBeNull();
  });
});

describe("[B19-A I3] the validator refuses what a registry revision must never contain", () => {
  it.each([
    ["a wildcard host", mutated("digikey", (entry) => { entry.endpoints.hosts.push("*.digikey.com"); }), /exact lowercase hostname/],
    ["an operation off its hosts", mutated("digikey", (entry) => { entry.endpoints.operations[0]!.url = "https://evil.example.com/token"; }), /not in hosts/],
    ["a plain-HTTP operation", mutated("octopart", (entry) => { entry.endpoints.operations[0]!.url = "http://api.nexar.com/graphql"; }), /not HTTPS/],
    ["a secret VALUE where a reference belongs", mutated("mouser", (entry) => { entry.auth.secrets[0]!.env = "abcd-1234-real-key"; }), /environment variable name/],
    ["something shaped like a real secret anywhere", mutated("digikey", (entry) => { entry.provider.notes.push(`token ghp_${"a".repeat(36)}`); }), /shaped like a secret/],
    ["spacing faster than the documented rate", mutated("digikey", (entry) => { entry.resilience.minRequestSpacingMs = 200; }), /exceeds the documented 120\/minute/],
    ["a redirect allowance", mutated("digikey", (entry) => { entry.resilience.maxRedirects = 3; }), /redirects must be refused/],
    ["a no-storage source that is cached", mutated("mouser", (entry) => { entry.freshness.offerTtlMs = 60_000; }), /no-storage source/],
    ["serving longer than keeping", mutated("octopart", (entry) => { entry.freshness.offerTtlMs = 48 * 3_600_000; }), /served longer than it may be kept/],
    ["a blocked source with callable hosts", mutated("lcsc", (entry) => { entry.endpoints.hosts.push("ips.lcsc.com"); }), /blocked source may not declare/],
    ["a query-parameter key not declared secret", mutated("mouser", (entry) => { entry.auth.secretQueryParams = []; }), /secretQueryParams/],
  ])("%s", (_label, revision, message) => {
    expect(validateSourceRegistry(revision).join("\n")).toMatch(message);
  });
});

describe("[B19-A I3] admission: by reference, fail closed, and only ever narrowed by the operator", () => {
  const KEYS = { DIGIKEY_CLIENT_ID: "id-value", DIGIKEY_CLIENT_SECRET: "secret-value", MOUSER_API_KEY: "mouser-value", OCTOPART_API_KEY: "nexar-value" };

  it("an enabled source with its credentials is admitted, and receives exactly the referenced values", () => {
    const admission = admitSource("digikey", KEYS);
    expect(admission).toEqual({ admitted: true, id: "digikey", secrets: { DIGIKEY_CLIENT_ID: "id-value", DIGIKEY_CLIENT_SECRET: "secret-value" } });
  });

  it("a fallback variable is honoured (NEXAR_API_KEY when OCTOPART_API_KEY is unset)", () => {
    expect(admitSource("octopart", { NEXAR_API_KEY: "n" })).toMatchObject({ admitted: true, secrets: { OCTOPART_API_KEY: "n" } });
  });

  it("a blocked source is refused whatever the environment holds", () => {
    expect(admitSource("lcsc", { ...KEYS, LCSC_API_KEY: "x", LCSC_API_SECRET: "y" })).toMatchObject({ admitted: false, refusal: "blocked" });
  });

  it("a disabled source is refused with its key configured, and names its owner decision", () => {
    const admission = admitSource("mouser", KEYS);
    expect(admission).toMatchObject({ admitted: false, refusal: "disabled" });
    expect(admission.admitted ? "" : admission.message).toContain("OD-32");
  });

  it("the operator can switch an enabled source off (case- and space-tolerant)", () => {
    expect(admitSource("octopart", { ...KEYS, [OPERATOR_DISABLE_ENV]: " DigiKey , OCTOPART " })).toMatchObject({ admitted: false, refusal: "operator_disabled" });
  });

  it("missing or blank credentials refuse, naming the variables and never any value", () => {
    const admission = admitSource("digikey", { DIGIKEY_CLIENT_ID: "id-value", DIGIKEY_CLIENT_SECRET: "  " });
    expect(admission).toMatchObject({ admitted: false, refusal: "credentials_missing" });
    const message = admission.admitted ? "" : admission.message;
    expect(message).toContain("DIGIKEY_CLIENT_SECRET");
    expect(message).not.toContain("id-value");
  });
});

describe("[B19-A I3] the committed artifact is the registry", () => {
  it(`${ARTIFACT} byte-matches the render`, () => {
    const path = resolve(process.cwd(), ARTIFACT);
    expect(existsSync(path), "run: npx tsx scripts/generate-b19-source-registry.ts").toBe(true);
    expect(readFileSync(path, "utf8").replaceAll("\r\n", "\n")).toBe(renderSourceRegistryCsv());
  });
});
