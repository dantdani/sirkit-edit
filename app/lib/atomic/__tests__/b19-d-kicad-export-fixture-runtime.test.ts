/**
 * [B19-D I5c review] The KiCad export route through the REAL published-snapshot loader (fixture runtime: the committed blinker
 * catalog, no database, no mocks of the catalog). The route tests beside this one mock the loader; this one proves that what
 * the app itself posts — instances pinned by revision and symbol version, no selections — exports with each part's library
 * symbol, its datasheet, and nothing refused.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

// [PR-J5 integration, 2026-10-23] the cold import of the export route (and the catalog) moved from the test body to module top level: inside
// the body it paid the whole route graph's load against the 5 s default and timed out under load (5.0-5.4 s measured in J5). Collection
// has no timeout, so the case times only the export itself; the timeout is NOT raised (the repository's cold-import rule). The environment
// is stubbed BEFORE the import, as the beforeAll did before the body's import.
vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
vi.stubEnv("DATABASE_URL", "");
const { blinkerCatalog, BLINKER_PART_IDS } = await import("@/app/lib/fixture-runtime/blinker/catalog");
const { POST } = await import("@/app/api/export/kicad/route");
afterAll(() => vi.unstubAllEnvs());

describe("[B19-D I5c review] the app's own export of pinned blinker parts", () => {
  it("exports the NE555 from its published snapshot with its datasheet", async () => {
    const catalog = blinkerCatalog();
    const timer = catalog.parts.get(BLINKER_PART_IDS.timer)!;
    const revisionId = catalog.revisionFor(BLINKER_PART_IDS.timer, "NE555")!;
    expect(revisionId).toBeTruthy();
    const state = {
      components: [], wires: [],
      kicadComponents: [{ id: "u1", partId: BLINKER_PART_IDS.timer, x: 100, y: 100, rotation: 0, refDes: "U1", value: "NE555", atomicPartRevisionId: revisionId, symbolAssetVersionId: timer.symbol.versionId }],
    };
    const res = await POST(new Request("http://localhost/api/export/kicad", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ state }) }));
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(200);
    const datasheet = timer.symbol.properties.Datasheet!;
    expect(datasheet).toMatch(/^https?:\/\//);
    // once in lib_symbols (the library block) and once on the placed instance, the field KiCad shows and opens
    expect(text.split(`(property "Datasheet" "${datasheet}"`).length - 1).toBe(2);
    expect(text).toMatch(/\(lib_id "Timer:/);
  });
});
