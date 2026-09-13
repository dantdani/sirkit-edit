/**
 * [B19-E E2] Registry 1.1.0: the bounded candidate search each enabled source offers, and whether a source's observations
 * may be disclosed to an agent — OD-36: "unknown" for every source until a reviewed registry revision says otherwise, and
 * never "permitted" for a source that is blocked or disabled.
 *
 * Regenerate the artifact after a reviewed registry change: npx tsx scripts/generate-b19-source-registry.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  renderSourceRegistryCsv,
  SOURCE_IDS,
  SOURCE_REGISTRY,
  SOURCE_REGISTRY_CSV_COLUMNS,
  SOURCE_REGISTRY_VERSION,
  validateSourceRegistry,
  type SourceRegistryEntry,
} from "../source-registry";

const ARTIFACT = "artifacts/ai-control-plane-b19/source-registry.csv";
const entries = SOURCE_IDS.map((id) => SOURCE_REGISTRY[id]);

type Writable = {
  license: { agentDisclosure?: string };
  candidateSearch: null | { operationUrl: string; modes: string[]; maxResults: number; cost: string; observations: string[] };
  state: { status: string };
};

function revised(id: keyof typeof SOURCE_REGISTRY, change: (entry: Writable) => void): SourceRegistryEntry[] {
  return entries.map((entry) => {
    if (entry.id !== id) return entry;
    const copy = JSON.parse(JSON.stringify(entry)) as Writable;
    change(copy);
    return copy as unknown as SourceRegistryEntry;
  });
}

describe("[B19-E E2] registry 1.1.0 records the bounded candidate search", () => {
  it("is version 1.1.0", () => {
    expect(SOURCE_REGISTRY_VERSION).toBe("1.1.0");
  });

  it("DigiKey and Nexar declare a candidate search over a registered POST operation, at most 5 results; Mouser and LCSC declare none", () => {
    for (const id of ["digikey", "octopart"] as const) {
      const entry = SOURCE_REGISTRY[id];
      const search = entry.candidateSearch;
      expect(search, id).not.toBeNull();
      expect([...search!.modes], id).toEqual(["exact", "keyword"]);
      expect(search!.maxResults, id).toBe(5);
      expect(entry.endpoints.operations.some((operation) => operation.method === "POST" && operation.url === search!.operationUrl && /candidate search/.test(operation.purpose)), id).toBe(true);
      expect(search!.observations.length, id).toBeGreaterThan(0);
      for (const observation of search!.observations) expect(entry.observations, `${id} ${observation}`).toContain(observation);
    }
    expect(SOURCE_REGISTRY.digikey.candidateSearch!.cost).toBe("request");
    expect(SOURCE_REGISTRY.octopart.candidateSearch!.cost, "Nexar counts every part a sup* query can return").toBe("matched-parts-at-limit");
    expect(SOURCE_REGISTRY.mouser.candidateSearch).toBeNull();
    expect(SOURCE_REGISTRY.lcsc.candidateSearch).toBeNull();
  });

  it("every source records agentDisclosure \"unknown\" (OD-36)", () => {
    expect(Object.fromEntries(entries.map((entry) => [entry.id, entry.license.agentDisclosure]))).toEqual({ digikey: "unknown", mouser: "unknown", octopart: "unknown", lcsc: "unknown" });
  });

  it("the documentation date is not re-stamped without a re-read, and the registry says the keyword-search terms were not re-read", () => {
    for (const id of ["digikey", "octopart"] as const) {
      expect(SOURCE_REGISTRY[id].provider.documentationCheckedOn).toBe("2026-09-13");
      expect(SOURCE_REGISTRY[id].provider.notes.join("\n"), id).toMatch(/\[B19-E E2\].*not re-read/);
    }
  });

  it("passes every structural rule, and the CSV renders the version, the candidate search and the disclosure", () => {
    expect(validateSourceRegistry()).toEqual([]);
    expect([...SOURCE_REGISTRY_CSV_COLUMNS]).toEqual(expect.arrayContaining(["candidate_search", "agent_disclosure"]));
    const csv = renderSourceRegistryCsv();
    const [header, ...rows] = csv.trimEnd().split("\n");
    const columns = header!.split(",");
    const digikey = rows.find((row) => row.startsWith("1.1.0,digikey,"));
    expect(digikey, "every row carries the registry version").toBeDefined();
    for (const row of rows) expect(row.startsWith("1.1.0,")).toBe(true);
    expect(columns.indexOf("agent_disclosure")).toBeGreaterThan(0);
    expect(csv).toMatch(/exact\|keyword/);
  });

  it("[B19-E E2 review] Nexar's terms require a followable octopart.com link beside its data: the registry records it, the other sources need none", () => {
    expect(Object.fromEntries(entries.map((entry) => [entry.id, (entry.license as { attributionLink?: unknown }).attributionLink]))).toEqual({ digikey: null, mouser: null, octopart: "https://octopart.com/", lcsc: null });
    expect([...SOURCE_REGISTRY_CSV_COLUMNS]).toContain("attribution_link");
    expect(renderSourceRegistryCsv()).toContain("https://octopart.com/");
  });

  it("[B19-E E2 review] the registry document describes this version: its version, the candidate search, agentDisclosure, the attribution link and the shared clients", () => {
    const doc = readFileSync(resolve(process.cwd(), "artifacts/ai-control-plane-b19/source-registry.md"), "utf8");
    expect(doc).toContain(`(version \`${SOURCE_REGISTRY_VERSION}\`)`);
    for (const term of ["candidateSearch", "agentDisclosure", "OD-36", "OD-40", "attributionLink", "app/lib/distributors/clients.ts", "app/lib/acquisition/external-search.ts"]) expect(doc, term).toContain(term);
    expect(doc, "admission is no longer the pricing orchestrator's alone").not.toMatch(/used by the pricing orchestrator for every client/);
  });

  it(`${ARTIFACT} byte-matches the 1.1.0 render`, () => {
    const path = resolve(process.cwd(), ARTIFACT);
    expect(existsSync(path), "run: npx tsx scripts/generate-b19-source-registry.ts").toBe(true);
    const committed = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
    expect(committed).toBe(renderSourceRegistryCsv());
    expect(committed).toContain("1.1.0,digikey,");
  });
});

describe("[B19-E E2] the validator refuses what a 1.1.0 revision must never contain", () => {
  it.each([
    ["a disabled source marked permitted", revised("mouser", (entry) => { entry.license.agentDisclosure = "permitted"; }), /agentDisclosure may not be "permitted"/],
    ["a blocked source marked permitted", revised("lcsc", (entry) => { entry.license.agentDisclosure = "permitted"; }), /agentDisclosure may not be "permitted"/],
    ["a missing agentDisclosure", revised("digikey", (entry) => { delete entry.license.agentDisclosure; }), /agentDisclosure is missing/],
    ["an unrecognised disclosure word", revised("octopart", (entry) => { entry.license.agentDisclosure = "maybe"; }), /agentDisclosure is missing or not one of/],
    ["a search returning more than 5 results", revised("octopart", (entry) => { entry.candidateSearch!.maxResults = 50; }), /at most 5 results/],
    ["a search over an unregistered operation", revised("digikey", (entry) => { entry.candidateSearch!.operationUrl = "https://api.digikey.com/products/v4/search/bulk"; }), /not a registered operation/],
    ["a search observing what the source does not", revised("octopart", (entry) => { entry.candidateSearch!.observations.push("distributor-sku"); }), /not among the source's observations/],
    ["a search with no or an unknown mode", revised("digikey", (entry) => { entry.candidateSearch!.modes = ["fuzzy"]; }), /modes/],
    ["[review] a missing attributionLink", revised("digikey", (entry) => { delete (entry.license as { attributionLink?: unknown }).attributionLink; }), /attributionLink is missing/],
    ["[review] an attribution link that is not plain https", revised("octopart", (entry) => { (entry.license as { attributionLink?: unknown }).attributionLink = "http://octopart.com/?ref=x"; }), /attributionLink must be/],
    ["[review] terms asking for a followable link with no attributionLink", revised("octopart", (entry) => { (entry.license as { attributionLink?: unknown }).attributionLink = null; }), /followable link/],
    ["a candidate search on a source that is not enabled", revised("mouser", (entry) => { entry.candidateSearch = { operationUrl: "https://api.mouser.com/api/v1/search/partnumber", modes: ["exact"], maxResults: 5, cost: "request", observations: ["stock-quantity"] }; }), /not enabled may not declare a candidate search/],
  ])("%s", (_label, revision, message) => {
    expect(validateSourceRegistry(revision).join("\n")).toMatch(message);
  });

  it("the rule targets only blocked and disabled sources: an enabled source may be marked permitted by a reviewed revision", () => {
    expect(validateSourceRegistry(revised("digikey", (entry) => { entry.license.agentDisclosure = "permitted"; }))).toEqual([]);
  });
});
