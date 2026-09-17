/**
 * [B19-D I5a] License is enforced at EXPORT, not only at publication (discovery D19-7).
 *
 * A KiCad schematic export copies each pinned part's symbol definition into the downloaded `.kicad_sch` (its lib_symbols).
 * That is redistribution of the symbol asset, so it is allowed only when the symbol's own license says its export disposition
 * is `redistributable`. Publication already refused `unknown` and `prohibited` export dispositions — but the export read the
 * pinned snapshot as the caller sent it and never looked at a license, and `private_review_only` and `metadata_only`
 * revisions can be published.
 */
import { describe, expect, it, vi } from "vitest";
import type { LicenseDisposition, ProjectComponentPin } from "../types";
import type { SchematicState } from "@/lib/schematic-types";
import { exportToKicadSch, SchematicExportLicenseError } from "@/app/lib/kicad-export";
import { makeFixtureCatalog, TEST_NOW } from "./fixtures";

vi.mock("@/app/lib/parts-search", () => ({ getFullPartsByIds: vi.fn(async () => []), getPartsByIds: vi.fn(async () => []), searchParts: vi.fn(async () => []) }));
// [B19-D I5c] reviewed pin move: the export route now loads pinned parts from the server's published snapshots (the body's
// selections are ignored), so the route case below serves its license-restricted snapshot through the server catalog.
const serverSnapshots = new Map<string, unknown>();
vi.mock("@/app/lib/atomic/server-catalog", () => ({ loadPublishedPortableSnapshot: vi.fn(async (id: string) => structuredClone(serverSnapshots.get(id) ?? null)) }));

function pinnedExport(disposition: LicenseDisposition | "missing") {
  const fixture = makeFixtureCatalog();
  const snapshot = structuredClone(fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW));
  const symbolLicenseId = snapshot.symbol.origin.licenseId;
  if (disposition === "missing") snapshot.licenses = snapshot.licenses.filter((license) => license.id !== symbolLicenseId);
  else snapshot.licenses = snapshot.licenses.map((license) => (license.id === symbolLicenseId ? { ...license, exportDisposition: disposition } : license));
  const pin: ProjectComponentPin = {
    selectionRecordId: "selection_fixture",
    atomicRevisionId: fixture.published.id,
    symbolVersionId: fixture.symbol.versionId,
    footprintVersionId: fixture.footprint.versionId,
    mappingCertificateId: fixture.mapping.id,
    modelVersionIds: [],
    embeddedSnapshot: snapshot,
  };
  const state: SchematicState = {
    components: [], wires: [],
    kicadComponents: [{
      id: "U1", partId: "legacy-row", x: 100, y: 100, rotation: 0, refDes: "U1", value: "FX-100-QFN",
      atomicPartRevisionId: fixture.published.id, symbolAssetVersionId: fixture.symbol.versionId, footprintAssetVersionId: fixture.footprint.versionId,
      mappingCertificateId: fixture.mapping.id, selectionRecordId: "selection_fixture",
    }],
  };
  return { fixture, snapshot, pin, state, symbolLicenseId };
}

describe("[B19-D I5a] the KiCad schematic export honours the symbol's license", () => {
  it.each(["prohibited", "private_review_only", "metadata_only", "unknown"] as const)("a symbol whose export disposition is %s is not exported", (disposition) => {
    const { state, pin, symbolLicenseId } = pinnedExport(disposition);
    let thrown: unknown;
    try {
      exportToKicadSch({ state, parts: new Map(), componentSelections: { U1: pin } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SchematicExportLicenseError);
    expect((thrown as SchematicExportLicenseError).violations).toEqual([{ refDes: "U1", licenseId: symbolLicenseId, disposition }]);
  });

  it("a symbol whose license record is absent from the snapshot is not exported", () => {
    const { state, pin, symbolLicenseId } = pinnedExport("missing");
    expect(() => exportToKicadSch({ state, parts: new Map(), componentSelections: { U1: pin } })).toThrow(SchematicExportLicenseError);
    try {
      exportToKicadSch({ state, parts: new Map(), componentSelections: { U1: pin } });
    } catch (error) {
      expect((error as SchematicExportLicenseError).violations).toEqual([{ refDes: "U1", licenseId: symbolLicenseId, disposition: "missing" }]);
    }
  });

  it("a redistributable symbol exports exactly as before — a baseline", () => {
    const { state, pin } = pinnedExport("redistributable");
    expect(exportToKicadSch({ state, parts: new Map(), componentSelections: { U1: pin } })).toContain("Fixture:FX-100-QFN");
  });
});

describe("[B19-D I5a] the export route refuses, names the component, and sends nothing of the symbol", () => {
  it("POST /api/export/kicad → 422 EXPORT_LICENSE_PROHIBITED", async () => {
    const { state, pin, snapshot } = pinnedExport("private_review_only");
    serverSnapshots.set(snapshot.atomicRevision.id, snapshot);
    const { POST } = await import("@/app/api/export/kicad/route");
    const res = await POST(new Request("http://localhost/api/export/kicad", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ state, componentSelections: { U1: pin } }),
    }));
    expect(res.status).toBe(422);
    const text = await res.text();
    const body = JSON.parse(text) as { ok: boolean; code: string; components: string[] };
    expect(body).toMatchObject({ ok: false, code: "EXPORT_LICENSE_PROHIBITED", components: ["U1"] });
    expect(text).not.toContain(snapshot.symbol.rawSymbolSExpression.slice(0, 40));
  });
});
