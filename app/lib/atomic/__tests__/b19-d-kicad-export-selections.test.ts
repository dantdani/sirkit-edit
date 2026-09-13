/**
 * [B19-D I5c rows 15, 16] The KiCad schematic export takes pinned parts from the server, never from the request body.
 *
 *  - row 16: the route trusted `componentSelections` from the body: a crafted `embeddedSnapshot` could inject its own
 *    s-expressions through `rawSymbolSExpression`, claim any license, or crash the route with a 500 (`embeddedSnapshot: {}`).
 *  - row 15: the license gate ran only for instances with a body selection; an instance that declares an atomic revision but
 *    arrives without a selection — which is how the app itself exports — skipped it.
 *
 * Now: every instance that declares an atomic revision is exported from the PUBLISHED snapshot the server loads for that
 * revision (its symbol and its licenses), the declared symbol version must match, and body selections are ignored.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortableAtomicSnapshot } from "../types";
import { makeFixtureCatalog, TEST_NOW } from "./fixtures";

vi.mock("@/app/lib/parts-search", () => ({ getFullPartsByIds: vi.fn(async () => []), getPartsByIds: vi.fn(async () => []), searchParts: vi.fn(async () => []) }));
const published = new Map<string, PortableAtomicSnapshot>();
vi.mock("@/app/lib/atomic/server-catalog", () => ({ loadPublishedPortableSnapshot: vi.fn(async (id: string) => structuredClone(published.get(id) ?? null)) }));

afterEach(() => published.clear());

function setup(mutate?: (snapshot: PortableAtomicSnapshot) => void) {
  const fixture = makeFixtureCatalog();
  const snapshot = structuredClone(fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW));
  mutate?.(snapshot);
  published.set(fixture.published.id, snapshot);
  const instance = {
    id: "U1", partId: "legacy-row", x: 100, y: 100, rotation: 0, refDes: "U1", value: "FX-100-QFN",
    atomicPartRevisionId: fixture.published.id, symbolAssetVersionId: fixture.symbol.versionId, footprintAssetVersionId: fixture.footprint.versionId,
    mappingCertificateId: fixture.mapping.id, selectionRecordId: "selection_fixture",
  };
  return { fixture, snapshot, state: { components: [], wires: [], kicadComponents: [instance] } };
}

async function post(body: unknown): Promise<{ status: number; text: string }> {
  const { POST } = await import("@/app/api/export/kicad/route");
  const res = await POST(new Request("http://localhost/api/export/kicad", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) }));
  return { status: res.status, text: await res.text() };
}

describe("[B19-D I5c row 15] a declared atomic revision is exported from the server's published snapshot", () => {
  it("with no selection in the body, the server snapshot's symbol is exported (the app's own export)", async () => {
    const { state } = setup();
    const { status, text } = await post({ state });
    expect(status).toBe(200);
    expect(text).toContain("Fixture:FX-100-QFN");
  });

  it("and its license is enforced even though the body sent no selection", async () => {
    const { state, snapshot } = setup((s) => { s.licenses = s.licenses.map((license) => (license.id === s.symbol.origin.licenseId ? { ...license, exportDisposition: "private_review_only" } : license)); });
    const { status, text } = await post({ state });
    expect(status).toBe(422);
    expect(JSON.parse(text)).toMatchObject({ code: "EXPORT_LICENSE_PROHIBITED", components: ["U1"] });
    expect(text).not.toContain(snapshot.symbol.rawSymbolSExpression.slice(0, 40));
  });

  it("an unpublished or unknown revision is refused, not silently exported from a catalog row", async () => {
    const { state } = setup();
    published.clear();
    const { status, text } = await post({ state });
    expect(status).toBe(422);
    expect(JSON.parse(text)).toMatchObject({ code: "EXPORT_PINNED_PART_UNAVAILABLE", components: ["U1"] });
  });

  it("a declared symbol version that does not match the published revision is refused", async () => {
    const { state } = setup();
    state.kicadComponents[0]!.symbolAssetVersionId = "symbolv_someone_else";
    const { status, text } = await post({ state });
    expect(status).toBe(422);
    expect(JSON.parse(text)).toMatchObject({ code: "EXPORT_PINNED_PART_UNAVAILABLE" });
  });
});

describe("[B19-D I5c row 16] a crafted body selection changes nothing", () => {
  it("an injected raw symbol and a claimed license in the body are ignored", async () => {
    const { state, snapshot } = setup((s) => { s.licenses = s.licenses.map((license) => ({ ...license, exportDisposition: "prohibited" })); });
    const forged = structuredClone(snapshot);
    forged.licenses = forged.licenses.map((license) => ({ ...license, exportDisposition: "redistributable" }));
    forged.symbol.rawSymbolSExpression = '(symbol "FX-100-QFN")\n)\n(sirkit_injected "x")\n(lib_symbols';
    const selection = { selectionRecordId: "s", atomicRevisionId: snapshot.atomicRevision.id, symbolVersionId: snapshot.symbol.versionId, modelVersionIds: [], embeddedSnapshot: forged };
    const { status, text } = await post({ state, componentSelections: { U1: selection } });
    expect(status).toBe(422);
    expect(text).not.toContain("sirkit_injected");
  });

  it("a malformed selection is not a 500", async () => {
    const { state, snapshot } = setup();
    const { status } = await post({ state, componentSelections: { U1: { atomicRevisionId: snapshot.atomicRevision.id, symbolVersionId: snapshot.symbol.versionId, embeddedSnapshot: {} } } });
    expect(status).toBeLessThan(500);
  });

  it("a published symbol that is not exactly one symbol definition is refused", async () => {
    const { state } = setup((s) => { s.symbol.rawSymbolSExpression = '(symbol "A") (symbol "B")'; });
    const { status } = await post({ state });
    expect(status).toBe(422);
  });
});
