/**
 * B16.1C §G/§H — the deterministic 555 astable LED blinker acceptance catalog.
 * [B16-C] moved out of the test tree so the env-gated FIXTURE RUNTIME
 * (app/lib/fixture-runtime — the page-level browser proof's provider/catalog/
 * router/store seams) can serve the same catalog to a running dev server.
 *
 * Everything the fresh-browser pipeline needs from the "outside world" is
 * built here from committed KiCad sources, with NO database, network, or
 * provider access:
 *
 *  - the symbols and footprints are the official KiCad library files copied
 *    verbatim into `./kicad/` (CC-BY-SA-4.0 with the KiCad libraries
 *    exception — see data/kicad-symbols/LICENSE.md), parsed through the SAME
 *    production parsers the atomic catalog uses (`parseSymbolAssets`,
 *    `parseFootprintAsset`);
 *  - the pin-to-pad mapping certificates are produced by the production
 *    `buildMappingCertificate` from explicit terminal maps (symbol pin number →
 *    physical pad number), so a certificate is "approved" only when the real
 *    validator says every electrical pin and pad is covered;
 *  - the atomic part revisions are created, reviewed, approved and published
 *    through the production `AtomicCatalog` transition rules (a human reviewer
 *    and publisher; agents cannot approve);
 *  - the exact parts are real manufacturer part numbers, but their evidence
 *    records are explicit FIXTURE records (`fixture://…` locators). Nothing
 *    here claims datasheet verification of the parts themselves — the
 *    acceptance test proves the PIPELINE, not the vendor data.
 *
 * The fake provider "designs" the circuit by returning `BLINKER_NETLIST`
 * verbatim: a textbook bipolar-555 astable (R_A=10 kΩ, R_B=56 kΩ, C=10 µF →
 * f = 1.44 / ((R_A + 2·R_B)·C) ≈ 1.18 Hz, duty ≈ 54 %), a 330 Ω LED limiter,
 * 100 nF supply decoupling, 10 nF CONT bypass and a 1×2 2.54 mm power header.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AtomicCatalog, createAtomicRevision } from "@/app/lib/atomic/catalog";
import { parseFootprintAsset, parseSymbolAssets, rawContentObject } from "@/app/lib/atomic/kicad-assets";
import { buildMappingCertificate, provePackage } from "@/app/lib/atomic/mapping";
import { sha256 } from "@/app/lib/atomic/stable";
import { normalizeValueKey } from "@/app/lib/atomic/value-key";
import type { EvidenceRef, ExactManufacturerPart, FootprintAssetVersion, LicenseRecord, Manufacturer, ManufacturerTerminal, MappingCertificate, PortableAtomicSnapshot, SymbolAssetVersion } from "@/app/lib/atomic/types";
import { extractLibrary, type ExtractedSymbol } from "@/app/lib/kicad/extract";
import type { CachedPart } from "@/app/lib/parts-cache";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";

/** The historical acceptance request, verbatim (B16.1C §G). */
export const BLINKER_ACCEPTANCE_PROMPT =
  "Design a hand-solderable 5 V LED blinker using a 555 timer in astable mode at approximately 1 to 1.5 Hz. Use an SOIC-8 timer, 0805 resistors and capacitors, an 0805 LED, and a two-pin 2.54 mm through-hole power header. Include supply decoupling and a control-pin bypass capacitor. Make a compact two-layer PCB suitable for JLCPCB fabrication. Use only parts with exact verified symbols, footprints, pin-to-pad mappings, and physical package authority. Do not use a ground plane, high-speed rules, hidden connections, or unspecified connector footprints.";

export const BLINKER_CATALOG_NOW = new Date("2026-09-01T00:00:00.000Z");

// Resolved from the process working directory (the repository root for `next dev`,
// `next start` and vitest alike): `import.meta.url` inside a Next server bundle
// names the bundle chunk, not this source file.
const KICAD_DIR = join(process.cwd(), "app", "lib", "fixture-runtime", "blinker", "kicad");
// Line endings are normalized so the parsed assets' content hashes (and every
// identity derived from them: asset version ids, bindings, board revisions,
// router-fixture keys) are the same on an LF or a CRLF checkout.
const kicadSource = (file: string): string => readFileSync(join(KICAD_DIR, file), "utf8").replace(/\r\n/g, "\n");

export const KICAD_LIBRARY_LICENSE: LicenseRecord = {
  id: "license_kicad_libraries_cc_by_sa_4",
  spdxId: "CC-BY-SA-4.0",
  name: "KiCad Libraries License (CC-BY-SA 4.0 with the KiCad libraries exception)",
  sourceUrl: "https://www.kicad.org/libraries/license/",
  attribution: "KiCad symbol and footprint libraries, (c) KiCad contributors",
  rawRedistribution: "redistributable",
  derivedRedistribution: "redistributable",
  exportDisposition: "redistributable",
};

/** Catalog part ids the fake provider references (`BuildLogicalComponent.partId`). */
export const BLINKER_PART_IDS = {
  timer: "b16-1c-part-ne555d",
  resistor: "b16-1c-part-r",
  capacitor: "b16-1c-part-c",
  led: "b16-1c-part-led",
  header: "b16-1c-part-conn-1x02",
} as const;

interface PartSource {
  partId: string;
  symbolFile: string;
  symbolName: string;
  symbolLibrary: string;
  footprintFile: string;
  footprintLibrary: string;
  mainCategory: string;
  /** Exact manufacturer parts keyed by normalized schematic value ("" = value-agnostic default). */
  exact: Array<{ valueKey: string; mpn: string; manufacturer: { id: string; name: string; domains: string[] }; packageCode: string; description: string }>;
  terminals: Array<{ number: string; function: string }>;
}

const YAGEO = { id: "manufacturer_yageo", name: "Yageo", domains: ["yageo.com"] };
const SAMSUNG = { id: "manufacturer_samsung_electro_mechanics", name: "Samsung Electro-Mechanics", domains: ["samsungsem.com"] };

const PART_SOURCES: PartSource[] = [
  {
    partId: BLINKER_PART_IDS.timer, symbolFile: "Timer_NE555.kicad_sym", symbolName: "NE555D", symbolLibrary: "Timer",
    footprintFile: "SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod", footprintLibrary: "Package_SO", mainCategory: "Timer",
    exact: [{ valueKey: "", mpn: "NE555DR", manufacturer: { id: "manufacturer_texas_instruments", name: "Texas Instruments", domains: ["ti.com"] }, packageCode: "SOIC-8", description: "NE555 precision timer, SOIC-8 (D), tape and reel" }],
    terminals: [
      { number: "1", function: "GND" }, { number: "2", function: "TRIG" }, { number: "3", function: "OUT" }, { number: "4", function: "RESET" },
      { number: "5", function: "CONT" }, { number: "6", function: "THRES" }, { number: "7", function: "DISCH" }, { number: "8", function: "VCC" },
    ],
  },
  {
    partId: BLINKER_PART_IDS.resistor, symbolFile: "R.kicad_sym", symbolName: "R", symbolLibrary: "Device",
    footprintFile: "R_0805_2012Metric.kicad_mod", footprintLibrary: "Resistor_SMD", mainCategory: "Resistor",
    exact: [
      { valueKey: normalizeValueKey("10k"), mpn: "RC0805FR-0710KL", manufacturer: YAGEO, packageCode: "0805", description: "10 kOhm 1 % 0.125 W thick film, 0805" },
      { valueKey: normalizeValueKey("56k"), mpn: "RC0805FR-0756KL", manufacturer: YAGEO, packageCode: "0805", description: "56 kOhm 1 % 0.125 W thick film, 0805" },
      { valueKey: normalizeValueKey("330"), mpn: "RC0805FR-07330RL", manufacturer: YAGEO, packageCode: "0805", description: "330 Ohm 1 % 0.125 W thick film, 0805" },
    ],
    terminals: [{ number: "1", function: "P1" }, { number: "2", function: "P2" }],
  },
  {
    partId: BLINKER_PART_IDS.capacitor, symbolFile: "C.kicad_sym", symbolName: "C", symbolLibrary: "Device",
    footprintFile: "C_0805_2012Metric.kicad_mod", footprintLibrary: "Capacitor_SMD", mainCategory: "Capacitor",
    exact: [
      { valueKey: normalizeValueKey("10uF"), mpn: "CL21A106KAYNNNE", manufacturer: SAMSUNG, packageCode: "0805", description: "10 uF 10 % 25 V X5R MLCC, 0805" },
      { valueKey: normalizeValueKey("100nF"), mpn: "CL21B104KBCNNNC", manufacturer: SAMSUNG, packageCode: "0805", description: "100 nF 10 % 50 V X7R MLCC, 0805" },
      { valueKey: normalizeValueKey("10nF"), mpn: "CL21B103KBANNNC", manufacturer: SAMSUNG, packageCode: "0805", description: "10 nF 10 % 50 V X7R MLCC, 0805" },
    ],
    terminals: [{ number: "1", function: "P1" }, { number: "2", function: "P2" }],
  },
  {
    partId: BLINKER_PART_IDS.led, symbolFile: "LED.kicad_sym", symbolName: "LED", symbolLibrary: "Device",
    footprintFile: "LED_0805_2012Metric.kicad_mod", footprintLibrary: "LED_SMD", mainCategory: "LED",
    exact: [{ valueKey: "", mpn: "LTST-C170KGKT", manufacturer: { id: "manufacturer_lite_on", name: "Lite-On", domains: ["liteon.com"] }, packageCode: "0805", description: "Green 0805 SMD LED, 2.1 V typical forward voltage at 20 mA" }],
    // KiCad convention: LED pin/pad 1 is the cathode, 2 the anode.
    terminals: [{ number: "1", function: "K" }, { number: "2", function: "A" }],
  },
  {
    partId: BLINKER_PART_IDS.header, symbolFile: "Conn_01x02.kicad_sym", symbolName: "Conn_01x02", symbolLibrary: "Connector_Generic",
    footprintFile: "PinHeader_1x02_P2.54mm_Vertical.kicad_mod", footprintLibrary: "Connector_PinHeader_2.54mm", mainCategory: "Connector",
    exact: [{ valueKey: "", mpn: "61300211121", manufacturer: { id: "manufacturer_wuerth", name: "Wuerth Elektronik", domains: ["we-online.com"] }, packageCode: "PinHeader_1x02_P2.54mm_Vertical", description: "WR-PHD 2.54 mm 1x2 vertical through-hole pin header" }],
    terminals: [{ number: "1", function: "Pin_1" }, { number: "2", function: "Pin_2" }],
  },
];

export interface BlinkerCatalogPart {
  partId: string;
  symbol: SymbolAssetVersion;
  footprint: FootprintAssetVersion;
  extracted: ExtractedSymbol;
  cached: CachedPart;
  /** Published atomic revision per normalized value key. */
  revisions: Record<string, { revisionId: string; mapping: MappingCertificate; exactPart: ExactManufacturerPart; manufacturer: Manufacturer }>;
}

export interface BlinkerCatalog {
  catalog: AtomicCatalog;
  parts: Map<string, BlinkerCatalogPart>;
  /** `CachedPart` by part id — what `/api/parts/[id]` would return to the browser. */
  cachedParts: Map<string, CachedPart>;
  /** Published portable snapshots by atomic revision id — what `loadPublishedPortableSnapshot` returns. */
  snapshots: Map<string, PortableAtomicSnapshot>;
  /** Component instance revision lookup: `partId` + normalized value → revision id. */
  revisionFor(partId: string, value: string): string | null;
}

const MEDIA_SYMBOL = "application/x-kicad-symbol";
const MEDIA_FOOTPRINT = "application/x-kicad-footprint";

function fixtureEvidence(catalog: AtomicCatalog, key: string, mpn: string, locator: string): EvidenceRef {
  const sourceId = "source_b16_1c_fixture_records";
  if (!catalog.sources.has(sourceId)) catalog.addSource({ id: sourceId, sourceClass: "organization_authored", name: "B16.1C acceptance fixture records (NOT manufacturer datasheets)", officialDomains: [], licenseId: KICAD_LIBRARY_LICENSE.id });
  const recordId = `record_fixture_${key}`;
  catalog.addSourceRecord({ id: recordId, sourceId, revision: "fixture-1", contentHash: sha256(`fixture:${key}:${mpn}`), retrievedAt: BLINKER_CATALOG_NOW.toISOString(), locator: `fixture://b16-1c/${key}/${mpn}`, mediaType: "text/plain", confidential: false });
  const evidence: EvidenceRef = { id: `evidence_fixture_${key}`, sourceRecordId: recordId, locator, extractionMethod: "manual", extractorVersion: "b16-1c-fixture/1", extractedAt: BLINKER_CATALOG_NOW.toISOString(), reviewerId: "user:fixture-reviewer", reviewedAt: BLINKER_CATALOG_NOW.toISOString() };
  catalog.addEvidence(evidence);
  return evidence;
}

function assetOrigin(library: string, file: string, catalog: AtomicCatalog): { sourceRecordId: string; libraryNickname: string; sourceUri: string; licenseId: string } {
  const sourceId = "source_kicad_official_libraries";
  if (!catalog.sources.has(sourceId)) catalog.addSource({ id: sourceId, sourceClass: "official_kicad_library", name: "KiCad official symbol/footprint libraries", canonicalUri: "https://gitlab.com/kicad/libraries", officialDomains: ["kicad.org", "gitlab.com"], licenseId: KICAD_LIBRARY_LICENSE.id });
  const recordId = `record_kicad_${library}_${file.replace(/[^A-Za-z0-9]+/g, "_")}`;
  if (!catalog.sourceRecords.has(recordId)) catalog.addSourceRecord({ id: recordId, sourceId, revision: "committed-fixture-copy", contentHash: sha256(kicadSource(file)), retrievedAt: BLINKER_CATALOG_NOW.toISOString(), locator: `kicad-libraries://${library}/${file}`, mediaType: file.endsWith(".kicad_sym") ? MEDIA_SYMBOL : MEDIA_FOOTPRINT, confidential: false });
  return { sourceRecordId: recordId, libraryNickname: library, sourceUri: `kicad-libraries://${library}/${file}`, licenseId: KICAD_LIBRARY_LICENSE.id };
}

function cachedPart(source: PartSource, extracted: ExtractedSymbol, revisions: BlinkerCatalogPart["revisions"], footprintFullName: string): CachedPart {
  const atomicAssignments: NonNullable<CachedPart["atomicAssignments"]> = {};
  for (const [valueKey, entry] of Object.entries(revisions)) {
    atomicAssignments[valueKey] = { revisionId: entry.revisionId, symbolVersionId: entry.mapping.symbolVersionId, footprintVersionId: entry.mapping.footprintVersionId, mappingCertificateId: entry.mapping.id, footprintFullName, approved: true };
  }
  return {
    id: source.partId,
    name: extracted.name,
    description: extracted.description,
    mpn: null,
    manufacturer: null,
    datasheet: extracted.datasheet,
    footprintHint: footprintFullName,
    mainCategory: source.mainCategory,
    libraryName: source.symbolLibrary,
    pins: extracted.pins,
    symbolRaw: extracted.symbolRaw,
    properties: extracted.properties,
    atomicAssignments,
  };
}

let memo: BlinkerCatalog | null = null;

/** Build (once per process) the published acceptance catalog. Pure and deterministic. */
export function blinkerCatalog(): BlinkerCatalog {
  if (memo) return memo;
  const catalog = new AtomicCatalog();
  catalog.addLicense(KICAD_LIBRARY_LICENSE);
  const parts = new Map<string, BlinkerCatalogPart>();
  const snapshots = new Map<string, PortableAtomicSnapshot>();
  const cachedParts = new Map<string, CachedPart>();

  for (const source of PART_SOURCES) {
    const symbolSource = kicadSource(source.symbolFile), footprintSource = kicadSource(source.footprintFile);
    const symbol = parseSymbolAssets({ source: symbolSource, origin: assetOrigin(source.symbolLibrary, source.symbolFile, catalog) }).find((asset) => asset.symbolName === source.symbolName);
    if (!symbol) throw new Error(`fixture symbol ${source.symbolName} not found in ${source.symbolFile}`);
    if (symbol.validationState !== "valid") throw new Error(`fixture symbol ${source.symbolName} is ${symbol.validationState}: ${symbol.diagnostics.map((d) => d.message).join("; ")}`);
    const footprint = parseFootprintAsset({ source: footprintSource, libraryNickname: source.footprintLibrary, origin: assetOrigin(source.footprintLibrary, source.footprintFile, catalog) });
    if (footprint.validationState === "invalid" || footprint.validationState === "unsupported") throw new Error(`fixture footprint ${footprint.footprintName} is ${footprint.validationState}: ${footprint.diagnostics.map((d) => d.message).join("; ")}`);
    const extracted = extractLibrary([symbolSource]).find((item) => item.name === source.symbolName);
    if (!extracted) throw new Error(`extractLibrary did not yield ${source.symbolName}`);
    catalog.addSymbol(symbol);
    catalog.addFootprint(footprint);
    const symbolRaw = rawContentObject({ content: symbolSource, mediaType: MEDIA_SYMBOL, licenseId: KICAD_LIBRARY_LICENSE.id });
    if (!catalog.rawObjects.has(symbolRaw.id)) catalog.addRawObject(symbolRaw);
    const footprintRaw = rawContentObject({ content: footprintSource, mediaType: MEDIA_FOOTPRINT, licenseId: KICAD_LIBRARY_LICENSE.id });
    if (!catalog.rawObjects.has(footprintRaw.id)) catalog.addRawObject(footprintRaw);
    if (symbolRaw.id !== symbol.rawContentObjectId || footprintRaw.id !== footprint.rawContentObjectId) throw new Error("fixture raw content ids diverged from parsed asset ids");

    const revisions: BlinkerCatalogPart["revisions"] = {};
    for (const exact of source.exact) {
      const key = `${source.partId}-${exact.mpn}`.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
      if (!catalog.manufacturers.has(exact.manufacturer.id)) catalog.addManufacturer({ id: exact.manufacturer.id, canonicalName: exact.manufacturer.name, aliases: [], officialDomains: exact.manufacturer.domains });
      const manufacturer = catalog.manufacturers.get(exact.manufacturer.id)!;
      const evidence = fixtureEvidence(catalog, key, exact.mpn, `fixture record for ${exact.mpn}: ${exact.description}`);
      const exactPart: ExactManufacturerPart = { id: `exact_${key}`, manufacturerId: manufacturer.id, exactMpn: exact.mpn, normalizedSearchKey: exact.mpn.replace(/[^A-Za-z0-9]+/g, "").toUpperCase(), state: "active", aliasEvidenceIds: [] };
      catalog.addExactPart(exactPart);
      const terminals: ManufacturerTerminal[] = source.terminals.map((terminal) => ({ id: `terminal_${key}_${terminal.number}`, publishedIdentifier: terminal.number, function: terminal.function, classification: "electrical", evidenceIds: [evidence.id] }));
      const electricalPads = footprint.pads.filter((pad) => !pad.mechanical).length;
      const packageProof = provePackage({ exactPartId: exactPart.id, footprintVersionId: footprint.versionId, packageCode: exact.packageCode, mountingTechnology: footprint.mountingTechnology, pinCount: terminals.length, evidenceIds: [evidence.id], checks: [{ field: "pinCount", expected: terminals.length, actual: electricalPads }] });
      const mapping = buildMappingCertificate({ exactPartId: exactPart.id, symbol, footprint, terminals, mapping: terminals.map((terminal) => ({ manufacturerTerminalId: terminal.id, symbolPinNumbers: [terminal.publishedIdentifier], logicalPadNumbers: [terminal.publishedIdentifier], evidenceIds: [evidence.id] })), packageProof, evidenceIds: [evidence.id] });
      if (mapping.state !== "approved") throw new Error(`fixture mapping for ${exact.mpn} is ${mapping.state}: missing pins ${mapping.missingSymbolPinIds.length}, missing pads ${mapping.missingPadNumbers.join(",")}, extra ${mapping.extraElectricalPadNumbers.join(",")}`);
      catalog.addMapping(mapping);
      const draft = createAtomicRevision({ logicalPartId: `logical_${key}`, revision: 1, exactPartId: exactPart.id, cadBundles: [{ symbolVersionId: symbol.versionId, footprintVersionId: footprint.versionId, modelVersionIds: [], mappingCertificateId: mapping.id, disposition: "primary_approved" }], claimIds: [], guidanceIds: [], offerSnapshotIds: [], licenseIds: [KICAD_LIBRARY_LICENSE.id], publicationState: "draft", policyVersion: "b16-1c-fixture-policy/1", createdAt: BLINKER_CATALOG_NOW.toISOString(), createdBy: "user:fixture-ingest", reviewHistory: [] });
      catalog.addRevision(draft);
      const review = catalog.transition({ revisionId: draft.id, to: "needs_review", actorId: "user:fixture-reviewer", actorRole: "reviewer", reason: "B16.1C fixture submission", now: BLINKER_CATALOG_NOW });
      const approved = catalog.transition({ revisionId: review.id, to: "approved", actorId: "user:fixture-reviewer", actorRole: "reviewer", reason: "B16.1C fixture approval", now: BLINKER_CATALOG_NOW });
      const published = catalog.transition({ revisionId: approved.id, to: "published", actorId: "user:fixture-publisher", actorRole: "publisher", reason: "B16.1C fixture publication", now: BLINKER_CATALOG_NOW });
      revisions[exact.valueKey] = { revisionId: published.id, mapping, exactPart, manufacturer };
      snapshots.set(published.id, catalog.portableSnapshot(published.id, BLINKER_CATALOG_NOW));
    }
    const footprintFullName = `${source.footprintLibrary}:${footprint.footprintName}`;
    const cached = cachedPart(source, extracted, revisions, footprintFullName);
    cachedParts.set(source.partId, cached);
    parts.set(source.partId, { partId: source.partId, symbol, footprint, extracted, cached, revisions });
  }

  memo = {
    catalog, parts, cachedParts, snapshots,
    revisionFor(partId, value) {
      const part = parts.get(partId);
      if (!part) return null;
      return (part.revisions[normalizeValueKey(value)] ?? part.revisions[""])?.revisionId ?? null;
    },
  };
  return memo;
}

/**
 * The fake provider's design for the acceptance prompt — a bipolar-555
 * astable with the timing network R_A (R1) from VCC to DISCH, R_B (R2) from
 * DISCH to the THRES/TRIG node, C_T (C1) from that node to GND.
 */
export const BLINKER_NETLIST: BuildLogicalNetlist = {
  components: [
    { refDes: "U1", partId: BLINKER_PART_IDS.timer, value: "NE555D", role: "processor" },
    { refDes: "R1", partId: BLINKER_PART_IDS.resistor, value: "10k", role: "passive" },
    { refDes: "R2", partId: BLINKER_PART_IDS.resistor, value: "56k", role: "passive" },
    { refDes: "R3", partId: BLINKER_PART_IDS.resistor, value: "330", role: "passive" },
    { refDes: "C1", partId: BLINKER_PART_IDS.capacitor, value: "10uF", role: "passive" },
    { refDes: "C2", partId: BLINKER_PART_IDS.capacitor, value: "100nF", role: "support", parentRefDes: "U1" },
    { refDes: "C3", partId: BLINKER_PART_IDS.capacitor, value: "10nF", role: "support", parentRefDes: "U1" },
    { refDes: "D1", partId: BLINKER_PART_IDS.led, value: "LED", role: "indicator" },
    { refDes: "J1", partId: BLINKER_PART_IDS.header, value: "PWR_5V", role: "connector" },
  ],
  connections: [
    // +5 V rail: timer VCC (8) and RESET (4) held high, R_A top, decoupling, header pin 1.
    { kind: "label", pin: "U1.8", labelName: "VCC" },
    { kind: "label", pin: "U1.4", labelName: "VCC" },
    { kind: "label", pin: "R1.1", labelName: "VCC" },
    { kind: "label", pin: "C2.1", labelName: "VCC" },
    { kind: "label", pin: "J1.1", labelName: "VCC" },
    // Ground: timer GND (1), timing cap, decoupling, CONT bypass, LED cathode, header pin 2.
    { kind: "label", pin: "U1.1", labelName: "GND" },
    { kind: "label", pin: "C1.2", labelName: "GND" },
    { kind: "label", pin: "C2.2", labelName: "GND" },
    { kind: "label", pin: "C3.2", labelName: "GND" },
    { kind: "label", pin: "D1.1", labelName: "GND" },
    { kind: "label", pin: "J1.2", labelName: "GND" },
    // Timing network.
    { kind: "wire", from: "R1.2", to: "U1.7" },
    { kind: "wire", from: "R2.1", to: "U1.7" },
    { kind: "wire", from: "R2.2", to: "U1.6" },
    { kind: "wire", from: "R2.2", to: "U1.2" },
    { kind: "wire", from: "C1.1", to: "U1.6" },
    // CONT bypass.
    { kind: "wire", from: "C3.1", to: "U1.5" },
    // Output -> limiter -> LED anode.
    { kind: "wire", from: "U1.3", to: "R3.1" },
    { kind: "wire", from: "R3.2", to: "D1.2" },
  ],
  explanation: "555 astable LED blinker: R1=10k (R_A), R2=56k (R_B), C1=10uF timing -> f = 1.44/((10k+112k)*10uF) ~ 1.18 Hz, ~54 % duty. R3=330 limits the LED to ~7 mA from the ~3.3 V output high. C2=100nF decouples VCC at the timer; C3=10nF bypasses CONT (pin 5). J1 is the 5 V/GND header (pin 1 = +5 V, pin 2 = GND).",
};
