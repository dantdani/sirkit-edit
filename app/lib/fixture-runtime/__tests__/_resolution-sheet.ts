/**
 * [PR-M, 2026-10-18] Test-and-browser support (never production): the owner's LED-dimmer reproduction over the FIXTURE runtime's catalog
 * (app/lib/fixture-runtime/blinker/catalog.ts `fixtureRuntimeCatalog`) - the isolated sheet of the M1 server suite (`ledDimmerSheet`,
 * app/lib/component-resolution/__tests__/_m1-fixtures.ts) placed from the fixture catalog's own part ids: U1 (the blinker's published
 * NE555D), R1 (10k) and C1 (10nF) resolved to their published exact revisions, D1 and D2 placed from the catalog's 1N4148 with NO
 * published exact revision. Used by the M1 page-intake suite and by e2e/m1-resolve-missing-parts.spec.ts (which opens it as a project
 * file); nothing here names a revision the catalog does not publish.
 */
import type { SchematicState } from "@/lib/schematic-types";
import { normalizeValueKey } from "@/app/lib/atomic/value-key";
import { ledDimmerSheet, type DimmerResolvedIdentity } from "@/app/lib/component-resolution/__tests__/_m1-fixtures";
import { BLINKER_PART_IDS, FIXTURE_RESOLUTION_PART_IDS, fixtureRuntimeCatalog } from "../blinker/catalog";

/** The sheet's stable instance ids (the M1 server suite's). */
export const DIMMER_INSTANCE_IDS = Object.freeze({ U1: "kc-u1", R1: "kc-r1", C1: "kc-c1", D1: "kc-d1", D2: "kc-d2" } as const);

export function fixtureDimmerSheet(): SchematicState {
  const catalog = fixtureRuntimeCatalog();
  const part = (id: string) => {
    const cached = catalog.cachedParts.get(id);
    if (!cached) throw new Error(`the fixture catalog has no part ${id}`);
    return cached;
  };
  const identity = (id: string, value: string): DimmerResolvedIdentity => {
    const assignment = part(id).atomicAssignments?.[normalizeValueKey(value)];
    if (!assignment) throw new Error(`the fixture catalog links no published revision for ${id} at "${value}"`);
    return { atomicPartRevisionId: assignment.revisionId, symbolAssetVersionId: assignment.symbolVersionId, footprintAssetVersionId: assignment.footprintVersionId, mappingCertificateId: assignment.mappingCertificateId };
  };
  return {
    ...ledDimmerSheet(
      { timer: { id: BLINKER_PART_IDS.timer, pins: part(BLINKER_PART_IDS.timer).pins }, resistor: { id: BLINKER_PART_IDS.resistor, pins: part(BLINKER_PART_IDS.resistor).pins }, capacitor: { id: BLINKER_PART_IDS.capacitor, pins: part(BLINKER_PART_IDS.capacitor).pins }, diode1n4148: { id: FIXTURE_RESOLUTION_PART_IDS.unresolvedDiode, pins: part(FIXTURE_RESOLUTION_PART_IDS.unresolvedDiode).pins } },
      { timer: identity(BLINKER_PART_IDS.timer, ""), resistor: identity(BLINKER_PART_IDS.resistor, "10k"), capacitor: identity(BLINKER_PART_IDS.capacitor, "10nF") },
    ),
    pageSize: "A4",
  };
}
