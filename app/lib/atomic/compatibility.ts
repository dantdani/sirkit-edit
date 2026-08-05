import type { KicadPin } from "@/app/lib/kicad/types";
import type { AtomicPartRevision, LicenseRecord, SymbolAssetVersion } from "./types";
import { createAtomicRevision } from "./catalog";
import { contentId, semanticHash, sha256 } from "./stable";

export interface LegacyPartRow {
  id: string;
  name: string;
  mpn?: string | null;
  manufacturer?: string | null;
  libraryName?: string | null;
  symbolRaw: string;
  pins: KicadPin[];
  properties?: Record<string, string>;
  footprintHint?: string | null;
  isGeneric?: boolean;
}

export interface LegacyAtomicDraft {
  revision: AtomicPartRevision;
  symbol: SymbolAssetVersion;
  license: LicenseRecord;
  unresolved: string[];
  legacyPartId: string;
  footprintCandidate?: string;
}

/**
 * Read-only bridge for old DB rows/projects. It creates a quarantined/draft
 * identity snapshot, never fabricates a footprint proof, claim, MPN evidence,
 * or publication status.
 */
export function legacyPartToAtomicDraft(part: LegacyPartRow, now = new Date(0)): LegacyAtomicDraft {
  const contentHash = sha256(part.symbolRaw);
  const versionId = contentId("symbolv", contentHash);
  const license: LicenseRecord = {
    id: `license_legacy_unknown_${part.id}`,
    spdxId: null,
    name: "Legacy catalog license not yet reviewed",
    rawRedistribution: "unknown",
    derivedRedistribution: "unknown",
    exportDisposition: "unknown",
  };
  const pins = part.pins.map((pin, index) => ({
    id: `spin_${semanticHash({ legacyPartId: part.id, number: pin.number, unit: pin.unit ?? 1, body: pin.bodyStyle ?? 1, index }).slice(0, 32)}`,
    number: pin.number,
    name: pin.name,
    electricalType: pin.type,
    unit: pin.unit ?? 1,
    bodyStyle: pin.bodyStyle ?? 1,
    hidden: pin.hidden ?? false,
    stacked: pin.stacked ?? false,
    position: pin.position,
    orientation: pin.orientation,
    length: pin.length,
  }));
  const symbol: SymbolAssetVersion = {
    kind: "symbol",
    logicalAssetId: `legacy_symbol_${part.id}`,
    versionId,
    contentHash,
    semanticHash: semanticHash({ name: part.name, pins, properties: part.properties ?? {} }),
    origin: {
      sourceRecordId: `legacy_part_row_${part.id}`,
      libraryNickname: part.libraryName ?? "legacy",
      logicalName: part.name,
      sourceUri: `legacy-db:parts/${part.id}`,
      licenseId: license.id,
    },
    formatVersion: "legacy-unverified",
    symbolName: part.name,
    aliases: [],
    unitCount: Math.max(1, ...pins.map((pin) => pin.unit)),
    bodyStyles: [...new Set(pins.map((pin) => pin.bodyStyle))].sort(),
    pins,
    properties: part.properties ?? {},
    footprintFilters: [],
    rawContentObjectId: contentId("raw", contentHash),
    validationState: "valid_with_limitations",
    diagnostics: [{ severity: "warning", code: "legacy_unverified", message: "Legacy symbol preserved without fabricated enrichment" }],
    rawSymbolSExpression: part.symbolRaw,
  };
  const identityId = part.isGeneric || !part.mpn || !part.manufacturer
    ? { genericDeviceId: `legacy_generic_${part.id}` }
    : { exactPartId: `legacy_exact_candidate_${part.id}` };
  const revision = createAtomicRevision({
    logicalPartId: `legacy_part_${part.id}`,
    revision: 1,
    ...identityId,
    cadBundles: [{ symbolVersionId: symbol.versionId, modelVersionIds: [], disposition: "candidate_unverified" }],
    claimIds: [],
    guidanceIds: [],
    offerSnapshotIds: [],
    licenseIds: [license.id],
    publicationState: "draft",
    policyVersion: "legacy-compatibility/1",
    createdAt: now.toISOString(),
    createdBy: "migration:legacy-part-adapter",
    reviewHistory: [],
  });
  return {
    revision,
    symbol,
    license,
    legacyPartId: part.id,
    footprintCandidate: part.footprintHint ?? undefined,
    unresolved: [
      "manufacturer identity/evidence not migrated",
      "engineering claims not migrated",
      "license requires review",
      ...(part.footprintHint ? ["footprint hint is a candidate, not package proof"] : ["footprint is unresolved"]),
      "pin-to-pad mapping certificate is absent",
    ],
  };
}
