import type {
  ApplicationGuidance,
  EngineeringClaim,
  FootprintAssetVersion,
  LicenseRecord,
  ManufacturerTerminal,
  PackageProof,
  SymbolAssetVersion,
} from "../types";
import { AtomicCatalog, createAtomicRevision } from "../catalog";
import { buildMappingCertificate, provePackage } from "../mapping";
import { quantity } from "../quantity";
import { semanticHash, sha256 } from "../stable";

export const TEST_NOW = new Date("2026-07-17T12:00:00.000Z");

export const OPEN_LICENSE: LicenseRecord = {
  id: "license_fixture_mit",
  spdxId: "MIT",
  name: "Original Sirkit test fixture",
  rawRedistribution: "redistributable",
  derivedRedistribution: "redistributable",
  exportDisposition: "redistributable",
};

export const RESTRICTED_LICENSE: LicenseRecord = {
  id: "license_fixture_restricted",
  spdxId: null,
  name: "Restricted third-party fixture metadata",
  rawRedistribution: "private_review_only",
  derivedRedistribution: "prohibited",
  exportDisposition: "prohibited",
};

export function symbolAsset(
  id = "symbolv_fixture_exact",
  pins: Array<{ number: string; unit?: number; bodyStyle?: number; hidden?: boolean; name?: string }> = [{ number: "1" }, { number: "2" }],
): SymbolAssetVersion {
  const normalized = pins.map((pin, index) => ({
    id: `spin_${id}_${index}`,
    number: pin.number,
    name: pin.name ?? `P${pin.number}`,
    electricalType: "passive",
    unit: pin.unit ?? 1,
    bodyStyle: pin.bodyStyle ?? 1,
    hidden: pin.hidden ?? false,
    stacked: pins.filter((item) => item.number === pin.number).length > 1,
    position: { x: index * 2.54, y: 0 },
    orientation: (index % 2 === 0 ? 0 : 180) as 0 | 180,
    length: 2.54,
  }));
  return {
    kind: "symbol",
    logicalAssetId: "symbol_fixture",
    versionId: id,
    contentHash: sha256(id),
    semanticHash: semanticHash(normalized),
    origin: { sourceRecordId: "record_fixture", libraryNickname: "Fixture", logicalName: "FixturePart", sourceUri: "fixture://symbol", licenseId: OPEN_LICENSE.id },
    formatVersion: "20231120",
    generator: "sirkit-test",
    symbolName: "FixturePart",
    aliases: [],
    unitCount: Math.max(...normalized.map((pin) => pin.unit)),
    bodyStyles: [...new Set(normalized.map((pin) => pin.bodyStyle))],
    pins: normalized,
    properties: {},
    footprintFilters: ["Fixture:*"] ,
    rawContentObjectId: `raw_${sha256(id)}`,
    validationState: "valid",
    diagnostics: [],
    rawSymbolSExpression: `(symbol "FixturePart")`,
  };
}

export function footprintAsset(
  id = "footprintv_fixture_exact",
  pads: Array<{ number: string; mechanical?: boolean; id?: string }> = [{ number: "1" }, { number: "2" }],
): FootprintAssetVersion {
  const normalized = pads.map((pad, index) => ({
    id: pad.id ?? `pad_${id}_${index}`,
    number: pad.number,
    padType: pad.mechanical ? "np_thru_hole" as const : "smd" as const,
    shape: "rect",
    xNm: index * 1_000_000,
    yNm: 0,
    rotationDeg: 0,
    widthNm: 500_000,
    heightNm: 500_000,
    layers: pad.mechanical ? [] : ["copperTop", "maskTop", "pasteTop"],
    mechanical: pad.mechanical ?? false,
  }));
  return {
    kind: "footprint",
    logicalAssetId: "footprint_fixture",
    versionId: id,
    contentHash: sha256(id),
    semanticHash: semanticHash(normalized),
    origin: { sourceRecordId: "record_fixture", libraryNickname: "Fixture", logicalName: "FixtureFootprint", sourceUri: "fixture://footprint", licenseId: OPEN_LICENSE.id },
    formatVersion: "20240108",
    generator: "sirkit-test",
    footprintName: "FixtureFootprint",
    mountingTechnology: "smd",
    pads: normalized,
    modelReferences: [],
    geometrySummary: { hasFab: true, hasSilk: true, unsupportedGeometry: [] },
    rawContentObjectId: `raw_${sha256(id)}`,
    validationState: "valid",
    diagnostics: [],
  };
}

export function packageProof(footprintVersionId: string, evidenceIds = ["evidence_fixture"], pinCount = 2): PackageProof {
  return provePackage({
    exactPartId: "exact_fixture",
    footprintVersionId,
    packageCode: "QFN-2",
    mountingTechnology: "smd",
    pinCount,
    evidenceIds,
    checks: [
      { field: "package", expected: "QFN-2", actual: "QFN-2" },
      { field: "pinCount", expected: pinCount, actual: pinCount },
    ],
  });
}

export function terminals(numbers = ["1", "2"]): ManufacturerTerminal[] {
  return numbers.map((number) => ({ id: `terminal_${number}`, publishedIdentifier: number, function: `P${number}`, classification: "electrical", evidenceIds: ["evidence_fixture"] }));
}

export function mappingFor(symbol: SymbolAssetVersion, footprint: FootprintAssetVersion, terminalList = terminals() ) {
  return buildMappingCertificate({
    exactPartId: "exact_fixture",
    symbol,
    footprint,
    terminals: terminalList,
    mapping: terminalList.map((terminal) => ({
      manufacturerTerminalId: terminal.id,
      symbolPinNumbers: [terminal.publishedIdentifier],
      logicalPadNumbers: [terminal.publishedIdentifier],
      evidenceIds: ["evidence_fixture"],
    })),
    packageProof: packageProof(footprint.versionId),
    evidenceIds: ["evidence_fixture"],
  });
}

export const VOLTAGE_RECOMMENDED: EngineeringClaim = {
  id: "claim_vdd_recommended",
  property: "supply_voltage",
  facet: "supply",
  value: quantity({ min: 2.7, max: 3.6, unit: "V", sourceText: "2.7 V to 3.6 V" }),
  limit: "recommended_operating",
  conditions: { temperature: "operating range" },
  scope: { kind: "rail", id: "VDD" },
  state: "source_backed",
  evidenceIds: ["evidence_fixture"],
  conflictsWith: [],
  safetyCritical: true,
};

export const VOLTAGE_ABS_MAX: EngineeringClaim = {
  ...VOLTAGE_RECOMMENDED,
  id: "claim_vdd_absmax",
  value: quantity({ max: 6, unit: "V", sourceText: "6 V absolute maximum" }),
  limit: "absolute_maximum",
};

export const STALE_STOCK: EngineeringClaim = {
  id: "claim_stock_stale",
  property: "stock",
  facet: "sourcing",
  value: 100,
  limit: "nominal",
  conditions: { region: "US" },
  scope: { kind: "supplier_offer", id: "offer_fixture" },
  state: "stale",
  evidenceIds: ["evidence_fixture"],
  conflictsWith: [],
  safetyCritical: false,
};

export const DECOUPLING_GUIDANCE: ApplicationGuidance = {
  id: "guidance_decoupling_fixture",
  category: "decoupling",
  status: "structured_rule_template",
  scope: { kind: "rail", id: "VDD" },
  conditions: { mode: "normal operation" },
  normalizedTemplate: { action: "place_decoupling", perSupplyPin: true, capacitance: "source-defined" },
  sourceText: "Place a bypass capacitor at each supply pin.",
  evidenceIds: ["evidence_fixture"],
  executable: false,
};

export function makeFixtureCatalog(options: { claims?: EngineeringClaim[]; footprint?: FootprintAssetVersion; symbol?: SymbolAssetVersion } = {}) {
  const catalog = new AtomicCatalog();
  const symbol = options.symbol ?? symbolAsset();
  const footprint = options.footprint ?? footprintAsset();
  const mapping = mappingFor(symbol, footprint);
  const claims = options.claims ?? [VOLTAGE_RECOMMENDED, VOLTAGE_ABS_MAX, STALE_STOCK];
  catalog.addLicense(OPEN_LICENSE);
  catalog.addManufacturer({ id: "manufacturer_fixture", canonicalName: "Fixture Semiconductor", aliases: ["Fixture Semi"], officialDomains: ["example.com"] });
  catalog.addFamily({ id: "family_fixture", manufacturerId: "manufacturer_fixture", publishedName: "FX-100", sourceEvidenceIds: ["evidence_fixture"] });
  catalog.addExactPart({ id: "exact_fixture", manufacturerId: "manufacturer_fixture", exactMpn: "FX-100-QFN", normalizedSearchKey: "FX100QFN", familyId: "family_fixture", state: "active", aliasEvidenceIds: [] });
  catalog.addSource({ id: "source_fixture", sourceClass: "manufacturer_datasheet", name: "Fixture datasheet", officialDomains: ["example.com"], licenseId: OPEN_LICENSE.id });
  catalog.addSourceRecord({ id: "record_fixture", sourceId: "source_fixture", revision: "A", contentHash: sha256("fixture datasheet"), retrievedAt: TEST_NOW.toISOString(), locator: "fixture://datasheet", mediaType: "application/pdf", rawObjectId: "raw_datasheet_fixture", confidential: false });
  catalog.addEvidence({ id: "evidence_fixture", sourceRecordId: "record_fixture", locator: "page 3, table 2", extractionMethod: "manual", extractorVersion: "fixture/1", extractedAt: TEST_NOW.toISOString(), reviewerId: "reviewer_fixture", reviewedAt: TEST_NOW.toISOString() });
  catalog.addSymbol(symbol);
  catalog.addFootprint(footprint);
  catalog.addRawObject({ id: symbol.rawContentObjectId, contentHash: symbol.contentHash, mediaType: "application/x-kicad-symbol", encoding: "utf8", content: symbol.versionId, bytes: Buffer.byteLength(symbol.versionId), licenseId: OPEN_LICENSE.id, confidential: false });
  catalog.addRawObject({ id: footprint.rawContentObjectId, contentHash: footprint.contentHash, mediaType: "application/x-kicad-footprint", encoding: "utf8", content: footprint.versionId, bytes: Buffer.byteLength(footprint.versionId), licenseId: OPEN_LICENSE.id, confidential: false });
  catalog.addMapping(mapping);
  claims.forEach((claim) => catalog.addClaim(claim));
  catalog.addGuidance(DECOUPLING_GUIDANCE);
  const draft = createAtomicRevision({
    logicalPartId: "logical_fixture",
    revision: 1,
    exactPartId: "exact_fixture",
    cadBundles: [{ symbolVersionId: symbol.versionId, footprintVersionId: footprint.versionId, modelVersionIds: [], mappingCertificateId: mapping.id, disposition: "primary_approved" }],
    claimIds: claims.map((claim) => claim.id),
    guidanceIds: [DECOUPLING_GUIDANCE.id],
    offerSnapshotIds: [],
    licenseIds: [OPEN_LICENSE.id],
    publicationState: "draft",
    policyVersion: "fixture-policy/1",
    createdAt: TEST_NOW.toISOString(),
    createdBy: "fixture",
    reviewHistory: [],
  });
  catalog.addRevision(draft);
  const review = catalog.transition({ revisionId: draft.id, to: "needs_review", actorId: "user:reviewer", actorRole: "reviewer", reason: "fixture submission", now: TEST_NOW });
  const approved = catalog.transition({ revisionId: review.id, to: "approved", actorId: "user:reviewer", actorRole: "reviewer", reason: "fixture approved", now: TEST_NOW });
  const published = catalog.transition({ revisionId: approved.id, to: "published", actorId: "user:publisher", actorRole: "publisher", reason: "fixture published", now: TEST_NOW });
  const snapshot = catalog.snapshot(TEST_NOW);
  return {
    catalog,
    symbol,
    footprint,
    mapping,
    draft,
    published,
    snapshot,
    view: {
      ...catalog.validationContext(),
      snapshotId: snapshot.id,
      revisions: catalog.revisions,
      exactParts: catalog.exactParts,
      publishedRevisionIds: new Set([published.id]),
    },
  };
}
