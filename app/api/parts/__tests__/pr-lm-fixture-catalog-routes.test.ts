/**
 * [PR-L/M integration, 2026-10-18] The Build Library's two catalog reads under the FIXTURE runtime: GET /api/parts/categories and POST
 * /api/parts/search answer from the committed fixture catalog (the container's), with NO database read - whatever DATABASE_URL says - as
 * GET /api/parts/[id] already did. Reproduced on the unchanged routes: both read only the database, so under the fixture runtime (no
 * DATABASE_URL) every Build Library load answered 500 and the panel showed "Could not load categories"; with a database configured beside
 * the fixture runtime they would have listed parts the fixture's part reads do not know. Outside the fixture runtime nothing changes (the
 * database is read; its failure stays the historical 500, b16-0-8-tranche-parity).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probes = vi.hoisted(() => ({ dbReads: 0, embeds: 0 }));
vi.mock("@/app/lib/db/client", () => ({ getDb: () => { probes.dbReads += 1; throw new Error("no database in this suite"); } }));
vi.mock("@/app/lib/embedding-admission", () => ({ admittedEmbedQuery: async () => { probes.embeds += 1; throw new Error("no embedding in this suite"); } }));

import { GET as categoriesGet } from "../categories/route";
import { POST as searchPost } from "../search/route";
import { GET as partGet } from "../[id]/route";
import { fixtureContainer, resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { fixtureCatalogCategories, fixtureCatalogSearch } from "@/app/lib/fixture-runtime/catalog-browse";
import { isGenericPart } from "@/app/lib/parts-normalization";

const search = (body: Record<string, unknown>): Request => new Request("http://localhost/api/parts/search", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });
const json = async (res: Response): Promise<Record<string, any>> => (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeEach(() => {
  probes.dbReads = 0; probes.embeds = 0;
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
  vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
  vi.stubEnv("DATABASE_URL", "");
  resetFixtureContainer();
});
afterEach(() => { vi.unstubAllEnvs(); resetFixtureContainer(); });

describe("[PR-L/M integration] the fixture runtime's Build Library catalog reads", () => {
  it("GET /api/parts/categories answers 200 with the fixture catalog's main categories and their counts, most-populated first, and reads no database", async () => {
    const res = await categoriesGet(new Request("http://localhost/api/parts/categories"));
    const body = await json(res);
    expect(res.status, JSON.stringify(body).slice(0, 300)).toBe(200);
    const parts = [...fixtureContainer().catalog.cachedParts.values()];
    expect(body).toEqual({ ok: true, categories: fixtureCatalogCategories(parts) });
    const names = (body.categories as Array<{ mainCategory: string; partCount: number }>).map((row) => row.mainCategory);
    for (const category of ["Timer", "Resistor", "Capacitor", "LED", "Connector", "Diode"]) expect(names, category).toContain(category);
    expect((body.categories as Array<{ partCount: number }>).reduce((total, row) => total + row.partCount, 0)).toBe(parts.length);
    const counts = (body.categories as Array<{ partCount: number }>).map((row) => row.partCount);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(probes.dbReads).toBe(0);
  });

  it("a database configured beside the fixture runtime is still not read: the fixture catalog answers (the part detail route's rule)", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://configured-but-unused.invalid/sirkit");
    expect((await categoriesGet(new Request("http://localhost/api/parts/categories"))).status).toBe(200);
    expect((await searchPost(search({ category: "Diode" }))).status).toBe(200);
    expect(probes.dbReads).toBe(0);
  });

  it("POST /api/parts/search browses a category alphabetically (generic templates only on request) and every listed part opens through GET /api/parts/[id]", async () => {
    const res = await searchPost(search({ category: "Diode", offset: 0, limit: 30 }));
    const body = await json(res);
    expect(res.status, JSON.stringify(body).slice(0, 300)).toBe(200);
    const diodes = [...fixtureContainer().catalog.cachedParts.values()].filter((part) => part.mainCategory === "Diode" && !isGenericPart({ name: part.name, libraryName: part.libraryName }));
    expect(body.pagination).toEqual({ total: diodes.length, offset: 0, limit: 30 });
    expect((body.results as Array<{ name: string }>).map((row) => row.name)).toEqual(diodes.map((part) => part.name).sort());
    expect(body.results.length).toBeGreaterThan(0);
    for (const row of body.results as Array<{ id: string; mainCategory: string; score: number; pinCount: number }>) {
      expect(row).toMatchObject({ mainCategory: "Diode", score: 0 });
      expect(row.pinCount).toBeGreaterThan(0);
      const detail = await partGet(new Request(`http://localhost/api/parts/${row.id}`), { params: Promise.resolve({ id: row.id }) });
      expect(detail.status, row.id).toBe(200);
    }
    const everything = await json(await searchPost(search({ category: "Resistor", includeGenerics: true })));
    expect(everything.pagination.total).toBe([...fixtureContainer().catalog.cachedParts.values()].filter((part) => part.mainCategory === "Resistor").length);
    expect(probes.dbReads).toBe(0);
  });

  it("a free-text query is ranked lexically over the fixture catalog (name or MPN 2, description 1) and never asks an embedding provider", async () => {
    const body = await json(await searchPost(search({ query: "555 timer", category: "Timer" })));
    expect(body.ok).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].name).toMatch(/555/);
    expect(body.results[0].score).toBeGreaterThan(0);
    expect(fixtureCatalogSearch(fixtureContainer().catalog.cachedParts.values(), { query: "zzzz-no-such-part", category: null, offset: 0, limit: 30, includeGenerics: true }).results).toEqual([]);
    expect(probes.embeds).toBe(0);
    expect(probes.dbReads).toBe(0);
  });

  it("outside the fixture runtime the routes read the database as before (its failure stays the historical 500)", async () => {
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
    expect((await categoriesGet(new Request("http://localhost/api/parts/categories"))).status).toBe(500);
    expect((await searchPost(search({ category: "Diode" }))).status).toBe(500);
    expect(probes.dbReads).toBe(2);
  });
});
