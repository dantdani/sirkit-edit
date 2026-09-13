// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { syncFromSchematic } from "@/app/lib/pcb/netlist-bridge";
import { exportToKicadSch } from "@/app/lib/kicad-export";
import { buildBom, bomToCsv } from "@/app/lib/bom/build";
import {
  createProject,
  exportProjectJSON,
  importProjectJSON,
  loadProject,
  saveProjectComponentSelection,
} from "@/lib/persistence";
import type { ProjectComponentPin } from "../types";
import { TEST_NOW, makeFixtureCatalog } from "./fixtures";

describe("Stage 5 project persistence and cross-consumer integrity", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips exact atomic/CAD pins and an offline snapshot", () => {
    const fixture = makeFixtureCatalog();
    const snapshot = fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW);
    const project = createProject("Atomic fixture", {
      components: [], wires: [],
      kicadComponents: [{ id: "U1", partId: "legacy-row", x: 0, y: 0, rotation: 0, refDes: "U1", value: "FX-100-QFN" }],
    });
    const pin: ProjectComponentPin = {
      selectionRecordId: "selection_fixture",
      atomicRevisionId: fixture.published.id,
      symbolVersionId: fixture.symbol.versionId,
      footprintVersionId: fixture.footprint.versionId,
      mappingCertificateId: fixture.mapping.id,
      modelVersionIds: [],
      embeddedSnapshot: snapshot,
    };
    expect(saveProjectComponentSelection(project.id, "U1", pin)).toBe(true);
    const loaded = loadProject(project.id)!;
    expect(loaded.componentSelections?.U1.atomicRevisionId).toBe(fixture.published.id);
    expect(loaded.componentSelections?.U1.embeddedSnapshot.exactPart?.exactMpn).toBe("FX-100-QFN");
    expect(loaded.state.kicadComponents?.[0].mappingCertificateId).toBe(fixture.mapping.id);

    const imported = importProjectJSON(exportProjectJSON(loaded));
    expect("error" in imported).toBe(false);
    if (!("error" in imported)) {
      expect(imported.componentSelections?.U1.symbolVersionId).toBe(fixture.symbol.versionId);
      expect(imported.componentSelections?.U1.mappingCertificateId).toBe(fixture.mapping.id);
    }
  });

  it("refuses a project pin whose embedded revision or symbol does not match", () => {
    const fixture = makeFixtureCatalog();
    const project = createProject("Atomic fixture", { components: [], wires: [] });
    const snapshot = fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW);
    const bad: ProjectComponentPin = {
      selectionRecordId: "selection_bad",
      atomicRevisionId: "atomic_wrong",
      symbolVersionId: fixture.symbol.versionId,
      footprintVersionId: fixture.footprint.versionId,
      mappingCertificateId: fixture.mapping.id,
      modelVersionIds: [],
      embeddedSnapshot: snapshot,
    };
    expect(saveProjectComponentSelection(project.id, "U1", bad)).toBe(false);
    expect(loadProject(project.id)?.componentSelections).toBeUndefined();
  });

  it("atomically rejects PCB sync when an exact instance lacks its approved bundle", async () => {
    const fixture = makeFixtureCatalog();
    const result = await syncFromSchematic({
      components: [],
      wires: [],
      kicadComponents: [{
        id: "component-u1",
        partId: "legacy-row",
        x: 100,
        y: 100,
        rotation: 0,
        refDes: "U1",
        value: "FX-100-QFN",
        atomicPartRevisionId: fixture.published.id,
        symbolAssetVersionId: fixture.symbol.versionId,
        footprintAssetVersionId: fixture.footprint.versionId,
        mappingCertificateId: fixture.mapping.id,
        selectionRecordId: "selection_fixture",
      }],
    }, undefined, {
      getPart: () => ({
        pins: [
          { number: "1", name: "P1", type: "passive", position: { x: -2.54, y: 0 }, orientation: 0, length: 2.54 },
          { number: "2", name: "P2", type: "passive", position: { x: 2.54, y: 0 }, orientation: 180, length: 2.54 },
        ],
        footprintHint: "Fixture:FixtureFootprint",
      }),
      resolver: { resolve: async () => null, detail: async () => null },
    });
    expect(result.ok).toBe(false);
    expect(result.report.unresolved[0].reason).toContain("approved revision-bound footprint/mapping certificate");
    expect(result.board.footprints).toEqual([]);
  });

  it("KiCad schematic export consumes the pinned symbol and approved footprint, not a mutable legacy row", () => {
    const fixture = makeFixtureCatalog();
    const snapshot = fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW);
    const pin: ProjectComponentPin = {
      selectionRecordId: "selection_fixture",
      atomicRevisionId: fixture.published.id,
      symbolVersionId: fixture.symbol.versionId,
      footprintVersionId: fixture.footprint.versionId,
      mappingCertificateId: fixture.mapping.id,
      modelVersionIds: [],
      embeddedSnapshot: snapshot,
    };
    const output = exportToKicadSch({
      state: {
        components: [], wires: [],
        kicadComponents: [{
          id: "U1", partId: "deleted-legacy-row", x: 100, y: 100, rotation: 0, refDes: "U1", value: "FX-100-QFN",
          atomicPartRevisionId: pin.atomicRevisionId,
          symbolAssetVersionId: pin.symbolVersionId,
          footprintAssetVersionId: pin.footprintVersionId,
          mappingCertificateId: pin.mappingCertificateId,
          selectionRecordId: pin.selectionRecordId,
        }],
      },
      parts: new Map(),
      componentSelections: { U1: pin },
    });
    expect(output).toContain('Fixture:FX-100-QFN');
    expect(output).toContain('Fixture:FixtureFootprint');
    expect(output).not.toContain("deleted-legacy-row");
  });

  it("BOM/export resolves immutable identity metadata without a live legacy row", async () => {
    const fixture = makeFixtureCatalog();
    const snapshot = fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW);
    const pin: ProjectComponentPin = {
      selectionRecordId: "selection_fixture",
      atomicRevisionId: fixture.published.id,
      symbolVersionId: fixture.symbol.versionId,
      footprintVersionId: fixture.footprint.versionId,
      mappingCertificateId: fixture.mapping.id,
      modelVersionIds: [],
      embeddedSnapshot: snapshot,
    };
    const state = {
      components: [], wires: [],
      kicadComponents: [{
        id: "U1", partId: "deleted-legacy-row", x: 0, y: 0, rotation: 0 as const, refDes: "U1", value: "FX-100-QFN",
        atomicPartRevisionId: pin.atomicRevisionId,
      }],
    };
    const result = await buildBom(state, "none", {}, { U1: pin });
    expect(result.rows[0]).toMatchObject({
      atomicRevisionId: fixture.published.id,
      mpn: "FX-100-QFN",
      manufacturer: "Fixture Semiconductor",
      package: "Fixture:FixtureFootprint",
    });
    expect(bomToCsv(result)).toContain(fixture.published.id);
  });

  it("legacy projects load without fabricated atomic selections", () => {
    const imported = importProjectJSON(JSON.stringify({
      name: "Legacy",
      state: {
        components: [],
        wires: [],
        kicadComponents: [{ id: "legacy-u1", partId: "legacy-part", x: 0, y: 0, rotation: 0, refDes: "U1", value: "Legacy" }],
      },
    }));
    expect("error" in imported).toBe(false);
    if (!("error" in imported)) {
      expect(imported.componentSelections).toBeUndefined();
      expect(imported.state.kicadComponents?.[0].atomicPartRevisionId).toBeUndefined();
    }
  });
});
