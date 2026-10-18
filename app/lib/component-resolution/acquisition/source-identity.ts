/**
 * [PR-M, 2026-10-18] Section M2 (design M2.4): the atomic SOURCE IDENTITY and revision label an acquired object is published under. The
 * official KiCad libraries keep the ONE identity the bundled authoring uses (`KICAD_OFFICIAL_SOURCE`, so the publication writes the same
 * `atomic_sources` row and the in-memory catalog never sees two records under one id); the revision names the pinned commit. The fixture
 * source has its own identity that says it is fixture evidence; its pin tables are organization-authored, never a manufacturer datasheet.
 */
import { KICAD_OFFICIAL_SOURCE } from "../../atomic/authoring";
import type { SourceIdentity } from "../../atomic/types";
import { KICAD_LIBRARY_PINS } from "../../kicad/pinned-checkout";
import { CAD_KICAD_LIBRARY_LICENSE, FIXTURE_PIN_TABLE_LICENSE, type CadSourceId } from "../../acquisition/cad-source-registry";

export const FIXTURE_CAD_SOURCE: SourceIdentity = Object.freeze({ id: "source_cad_fixture_kicad", sourceClass: "official_kicad_library", name: "Fixture CAD source: verbatim official KiCad library blobs at the pinned commits (FIXTURE evidence)", officialDomains: [], licenseId: CAD_KICAD_LIBRARY_LICENSE.id }) as SourceIdentity;
export const FIXTURE_PIN_TABLE_SOURCE: SourceIdentity = Object.freeze({ id: "source_cad_fixture_pin_tables", sourceClass: "organization_authored", name: "Sirkit fixture pin tables (original test text; NOT manufacturer datasheets)", officialDomains: [], licenseId: FIXTURE_PIN_TABLE_LICENSE.id }) as SourceIdentity;

/** The source identity a CAD source's KiCad objects are published under. */
export function cadSourceIdentity(sourceId: CadSourceId): SourceIdentity {
  return sourceId === "fixture-kicad" ? FIXTURE_CAD_SOURCE : KICAD_OFFICIAL_SOURCE;
}

/** The pin table's source identity (only the fixture source delivers pin tables in M2). */
export function cadPinTableSourceIdentity(sourceId: CadSourceId): SourceIdentity | null {
  return sourceId === "fixture-kicad" ? FIXTURE_PIN_TABLE_SOURCE : null;
}

/** The revision label: the library and its pinned commit (fixture-prefixed for the fixture source). */
export function cadRevisionLabel(sourceId: CadSourceId, kind: "symbol" | "footprint" | "datasheet"): string {
  if (kind === "datasheet") return `${sourceId}:pin-table/1`;
  const label = kind === "symbol" ? `kicad-symbols@${KICAD_LIBRARY_PINS.symbols.commit}` : `kicad-footprints@${KICAD_LIBRARY_PINS.footprints.commit}`;
  return sourceId === "fixture-kicad" ? `fixture:${label}` : label;
}
