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
import { normalizeValueKey, valueKeyLink } from "@/app/lib/atomic/value-key";
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
      return valueKeyLink(part.revisions, value)?.revisionId ?? null; // [B19-D I5d row 06] own links only
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

// ─── [PR-M, 2026-10-18] The resolution proof's two catalog records (appended: no line above moves; blinkerCatalog() is unchanged) ──────
/**
 * Runbook section M.5 item 8 (fixture evidence): the two catalog records the FIXTURE runtime adds beside the committed
 * blinker catalog so a fresh browser can prove the unresolved-component resolution with no database, provider or embedding:
 *
 *  - `pr-m-part-1n4148` - a catalog part "1N4148" (the KiCad Diode library's standard switching diode, drawn with the Device:D symbol it
 *    extends: K is pin 1, A is pin 2) with NO published exact revision. An instance placed from it is exactly what the owner's LED
 *    dimmer left on the sheet: Prepare PCB refuses it ("no published exact revision"), and nothing here publishes it;
 *  - `pr-m-part-1n4148w` - a catalog part "1N4148W" whose exact revision (Diodes Incorporated 1N4148W-7-F, SOD-123) is built,
 *    reviewed, approved and published through the SAME production machinery the blinker catalog uses: the official KiCad Device:D
 *    symbol and Diode_SMD:D_SOD-123 footprint copied verbatim into ./kicad (CC-BY-SA-4.0 with the KiCad libraries exception), parsed
 *    by the production parsers, a mapping certificate from `buildMappingCertificate` over an explicit terminal map (K = pin 1 = pad 1,
 *    A = pin 2 = pad 2) that is approved only because the real validator says every pin and pad is covered, and the production
 *    `AtomicCatalog` transitions with a human reviewer and a different publisher.
 *
 * Truth boundary, as the blinker catalog's: the manufacturer part number is real, but its evidence record is an explicit FIXTURE record
 * (`fixture://pr-m/...`, "NOT manufacturer datasheets"); no rating claim is published, so a resolution over it checks pin functions, the
 * pin-to-pad mapping and the package - never ratings, never electrical equivalence. These records live ONLY in the fixture runtime's
 * container catalog (`fixtureRuntimeCatalog`, read by app/lib/fixture-runtime/container.ts); the blinker catalog itself
 * (`blinkerCatalog()`, which the deterministic acceptance suites read) is unchanged. They are declared in this module, not a new one, so
 * every import closure that reaches the fixture container stays the same set of files.
 */
/** The two records' catalog part ids (stable names, as the blinker catalog's). */
export const FIXTURE_RESOLUTION_PART_IDS = Object.freeze({
  /** the unresolved 1N4148: a catalog part with no published exact revision */
  unresolvedDiode: "pr-m-part-1n4148",
  /** the eligible 1N4148W: published exact revision 1N4148W-7-F, SOD-123 */
  eligibleDiode: "pr-m-part-1n4148w",
} as const);
export const FIXTURE_ELIGIBLE_DIODE_MPN = "1N4148W-7-F" as const;

const RESOLUTION_NOW = new Date("2026-10-17T00:00:00.000Z");
const DIODES_INC = { id: "manufacturer_diodes_inc", name: "Diodes Incorporated", domains: ["diodes.com"] };

export interface ResolutionFixtureParts {
  cachedParts: Map<string, CachedPart>;
  snapshots: Map<string, PortableAtomicSnapshot>;
  /** the eligible part's published revision id ('' value key: value-agnostic) */
  eligibleRevisionId: string;
}

let resolutionMemo: ResolutionFixtureParts | null = null;

/** Build (once per process) the two records. Pure and deterministic. */
export function resolutionFixtureParts(): ResolutionFixtureParts {
  if (resolutionMemo) return resolutionMemo;
  const symbolSource = kicadSource("D.kicad_sym");
  const footprintSource = kicadSource("D_SOD-123.kicad_mod");
  const extracted = extractLibrary([symbolSource]).find((item) => item.name === "D");
  if (!extracted) throw new Error("extractLibrary did not yield Device:D");

  // ── the eligible part: one published exact revision through the production machinery ──
  const catalog = new AtomicCatalog();
  catalog.addLicense(KICAD_LIBRARY_LICENSE);
  const kicadSourceId = "source_kicad_official_libraries";
  catalog.addSource({ id: kicadSourceId, sourceClass: "official_kicad_library", name: "KiCad official symbol/footprint libraries", canonicalUri: "https://gitlab.com/kicad/libraries", officialDomains: ["kicad.org", "gitlab.com"], licenseId: KICAD_LIBRARY_LICENSE.id });
  const origin = (library: string, file: string, content: string, mediaType: string) => {
    const recordId = `record_kicad_${library}_${file.replace(/[^A-Za-z0-9]+/g, "_")}`;
    catalog.addSourceRecord({ id: recordId, sourceId: kicadSourceId, revision: "committed-fixture-copy", contentHash: sha256(content), retrievedAt: RESOLUTION_NOW.toISOString(), locator: `kicad-libraries://${library}/${file}`, mediaType, confidential: false });
    return { sourceRecordId: recordId, libraryNickname: library, sourceUri: `kicad-libraries://${library}/${file}`, licenseId: KICAD_LIBRARY_LICENSE.id };
  };
  const symbol = parseSymbolAssets({ source: symbolSource, origin: origin("Device", "D.kicad_sym", symbolSource, MEDIA_SYMBOL) }).find((asset) => asset.symbolName === "D");
  if (!symbol || symbol.validationState !== "valid") throw new Error("fixture symbol Device:D did not parse valid");
  const footprint = parseFootprintAsset({ source: footprintSource, libraryNickname: "Diode_SMD", origin: origin("Diode_SMD", "D_SOD-123.kicad_mod", footprintSource, MEDIA_FOOTPRINT) });
  if (footprint.validationState === "invalid" || footprint.validationState === "unsupported") throw new Error(`fixture footprint D_SOD-123 is ${footprint.validationState}`);
  catalog.addSymbol(symbol);
  catalog.addFootprint(footprint);
  catalog.addRawObject(rawContentObject({ content: symbolSource, mediaType: MEDIA_SYMBOL, licenseId: KICAD_LIBRARY_LICENSE.id }));
  catalog.addRawObject(rawContentObject({ content: footprintSource, mediaType: MEDIA_FOOTPRINT, licenseId: KICAD_LIBRARY_LICENSE.id }));
  catalog.addManufacturer({ id: DIODES_INC.id, canonicalName: DIODES_INC.name, aliases: [], officialDomains: DIODES_INC.domains });
  const recordsSourceId = "source_pr_m_fixture_records";
  catalog.addSource({ id: recordsSourceId, sourceClass: "organization_authored", name: "PR-M fixture records (NOT manufacturer datasheets)", officialDomains: [], licenseId: KICAD_LIBRARY_LICENSE.id });
  const key = "pr_m_part_1n4148w_1n4148w_7_f";
  catalog.addSourceRecord({ id: `record_fixture_${key}`, sourceId: recordsSourceId, revision: "fixture-1", contentHash: sha256(`fixture:${key}:${FIXTURE_ELIGIBLE_DIODE_MPN}`), retrievedAt: RESOLUTION_NOW.toISOString(), locator: `fixture://pr-m/${key}/${FIXTURE_ELIGIBLE_DIODE_MPN}`, mediaType: "text/plain", confidential: false });
  const evidence: EvidenceRef = { id: `evidence_fixture_${key}`, sourceRecordId: `record_fixture_${key}`, locator: `fixture record for ${FIXTURE_ELIGIBLE_DIODE_MPN}: 75 V fast switching diode, SOD-123`, extractionMethod: "manual", extractorVersion: "pr-m-fixture/1", extractedAt: RESOLUTION_NOW.toISOString(), reviewerId: "user:fixture-reviewer", reviewedAt: RESOLUTION_NOW.toISOString() };
  catalog.addEvidence(evidence);
  const exactPart: ExactManufacturerPart = { id: `exact_${key}`, manufacturerId: DIODES_INC.id, exactMpn: FIXTURE_ELIGIBLE_DIODE_MPN, normalizedSearchKey: FIXTURE_ELIGIBLE_DIODE_MPN.replace(/[^A-Za-z0-9]+/g, "").toUpperCase(), state: "active", aliasEvidenceIds: [] };
  catalog.addExactPart(exactPart);
  // KiCad convention for Device:D: pin / pad 1 is the cathode, 2 the anode.
  const terminalMap = [{ number: "1", function: "K" }, { number: "2", function: "A" }];
  const terminals: ManufacturerTerminal[] = terminalMap.map((terminal) => ({ id: `terminal_${key}_${terminal.number}`, publishedIdentifier: terminal.number, function: terminal.function, classification: "electrical", evidenceIds: [evidence.id] }));
  const electricalPads = footprint.pads.filter((pad) => !pad.mechanical).length;
  const packageProof = provePackage({ exactPartId: exactPart.id, footprintVersionId: footprint.versionId, packageCode: "SOD-123", mountingTechnology: footprint.mountingTechnology, pinCount: terminals.length, evidenceIds: [evidence.id], checks: [{ field: "pinCount", expected: terminals.length, actual: electricalPads }] });
  const mapping = buildMappingCertificate({ exactPartId: exactPart.id, symbol, footprint, terminals, mapping: terminals.map((terminal) => ({ manufacturerTerminalId: terminal.id, symbolPinNumbers: [terminal.publishedIdentifier], logicalPadNumbers: [terminal.publishedIdentifier], evidenceIds: [evidence.id] })), packageProof, evidenceIds: [evidence.id] });
  if (mapping.state !== "approved") throw new Error(`fixture mapping for ${FIXTURE_ELIGIBLE_DIODE_MPN} is ${mapping.state}`);
  catalog.addMapping(mapping);
  const draft = createAtomicRevision({ logicalPartId: `logical_${key}`, revision: 1, exactPartId: exactPart.id, cadBundles: [{ symbolVersionId: symbol.versionId, footprintVersionId: footprint.versionId, modelVersionIds: [], mappingCertificateId: mapping.id, disposition: "primary_approved" }], claimIds: [], guidanceIds: [], offerSnapshotIds: [], licenseIds: [KICAD_LIBRARY_LICENSE.id], publicationState: "draft", policyVersion: "pr-m-fixture-policy/1", createdAt: RESOLUTION_NOW.toISOString(), createdBy: "user:fixture-ingest", reviewHistory: [] });
  catalog.addRevision(draft);
  const review = catalog.transition({ revisionId: draft.id, to: "needs_review", actorId: "user:fixture-reviewer", actorRole: "reviewer", reason: "PR-M fixture submission", now: RESOLUTION_NOW });
  const approved = catalog.transition({ revisionId: review.id, to: "approved", actorId: "user:fixture-reviewer", actorRole: "reviewer", reason: "PR-M fixture approval", now: RESOLUTION_NOW });
  const published = catalog.transition({ revisionId: approved.id, to: "published", actorId: "user:fixture-publisher", actorRole: "publisher", reason: "PR-M fixture publication", now: RESOLUTION_NOW });
  const snapshots = new Map<string, PortableAtomicSnapshot>([[published.id, catalog.portableSnapshot(published.id, RESOLUTION_NOW)]]);
  const footprintFullName = `Diode_SMD:${footprint.footprintName}`;

  const record = (partId: string, name: string, description: string, mpn: string | null, manufacturer: string | null, footprintHint: string, atomicAssignments: CachedPart["atomicAssignments"] | undefined): CachedPart => ({
    id: partId, name, description, mpn, manufacturer, datasheet: extracted.datasheet, footprintHint, mainCategory: "Diode", libraryName: "Diode",
    pins: extracted.pins, symbolRaw: extracted.symbolRaw, properties: extracted.properties, ...(atomicAssignments ? { atomicAssignments } : {}),
  });
  const cachedParts = new Map<string, CachedPart>([
    [FIXTURE_RESOLUTION_PART_IDS.unresolvedDiode, record(FIXTURE_RESOLUTION_PART_IDS.unresolvedDiode, "1N4148", "100 V 150 mA standard switching diode, DO-35", "1N4148", null, "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal", undefined)],
    [FIXTURE_RESOLUTION_PART_IDS.eligibleDiode, record(FIXTURE_RESOLUTION_PART_IDS.eligibleDiode, "1N4148W", "75 V 150 mA fast switching diode, SOD-123", FIXTURE_ELIGIBLE_DIODE_MPN, DIODES_INC.name, footprintFullName, {
      "": { revisionId: published.id, symbolVersionId: mapping.symbolVersionId, footprintVersionId: mapping.footprintVersionId, mappingCertificateId: mapping.id, footprintFullName, approved: true },
    })],
  ]);
  resolutionMemo = { cachedParts, snapshots, eligibleRevisionId: published.id };
  return resolutionMemo;
}

/**
 * The fixture runtime container's catalog: the committed blinker catalog plus the two resolution records (catalog parts and the one
 * published snapshot). The blinker's own `parts`, AtomicCatalog and `revisionFor` are unchanged; the merged maps are new objects, so
 * `blinkerCatalog()` itself never gains these records.
 */
export function fixtureRuntimeCatalog(): BlinkerCatalog {
  const blinker = blinkerCatalog();
  const extra = resolutionFixtureParts();
  return {
    ...blinker,
    cachedParts: new Map([...blinker.cachedParts, ...extra.cachedParts, ...acquisitionFixtureParts(), ...generationFixtureParts().cachedParts]), /* [PR-M, 2026-10-18] M2: + the acquisition proof's one part (in place: no line moves) */ /* [PR-L6, 2026-10-19] L.7 items 9-10: + the generation proofs' published parts (in place: no line moves) */
    snapshots: new Map([...blinker.snapshots, ...extra.snapshots, ...generationFixtureParts().snapshots]), // [PR-L6, 2026-10-19] + their published snapshots (in place)
  };
}

// ─── [PR-M, 2026-10-18] Section M2: the acquisition proof's catalog part (appended: no line above moves) ──────────────────────────────────
/**
 * Runbook section M2 (M.5 item 4, fixture evidence): ONE catalog part the fixture runtime adds so a fresh browser can prove the missing-part
 * ACQUISITION - a part with NO published exact revision and NO published revision of the same exact part anywhere in the library, whose
 * KiCad assets the fixture CAD source (app/lib/fixture-runtime/cad-source, the official KiCad Diode:1N4001 symbol and
 * Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal footprint copied verbatim, plus an ORIGINAL fixture pin table) can serve:
 *
 *  - `M2_ACQUISITION_PART_ID` - a catalog part "1N4001" (the KiCad Diode library's general-purpose rectifier: K is pin 1, A is pin 2), its
 *    pins read from the committed symbol by the production extractor. Its id is UUID-shaped like a database part's, so the acquisition's
 *    handoff may propose linking THIS part to the revision two humans publish (the link rule of app/lib/atomic/publication-review.ts);
 *  - nothing here publishes anything: the revision exists only after the browser proof's review and publication (and only in the
 *    fixture container's process memory).
 *
 * Truth boundary: fixture evidence end to end - the pin table is not a manufacturer datasheet, and no rating is ever claimed.
 */
export const M2_ACQUISITION_PART_ID = "f1d40010-0000-4000-8000-000000004001" as const;
let acquisitionMemo: Array<[string, CachedPart]> | null = null;
/** The acquisition proof's catalog part (built once per process from the committed 1N4001 symbol). */
export function acquisitionFixtureParts(): Array<[string, CachedPart]> {
  if (acquisitionMemo) return acquisitionMemo;
  const source = readFileSync(join(process.cwd(), "app", "lib", "fixture-runtime", "cad-source", "kicad-symbols", "Diode.kicad_symdir", "1N4001.kicad_sym"), "utf8").replace(/\r\n/g, "\n");
  const extracted = extractLibrary([source]).find((item) => item.name === "1N4001");
  if (!extracted) throw new Error("extractLibrary did not yield Diode:1N4001");
  acquisitionMemo = [[M2_ACQUISITION_PART_ID, {
    id: M2_ACQUISITION_PART_ID, name: "1N4001", description: "50 V 1 A general-purpose rectifier, DO-41", mpn: "1N4001", manufacturer: null, datasheet: extracted.datasheet,
    footprintHint: "Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal", mainCategory: "Diode", libraryName: "Diode", pins: extracted.pins, symbolRaw: extracted.symbolRaw, properties: extracted.properties,
  }]];
  return acquisitionMemo;
}

// ─── [PR-L6, 2026-10-19] Runbook L.7 items 9-10: the generation proofs' published parts (appended: no line above moves) ─────────────────
/**
 * The catalog parts the FIXTURE runtime adds so the scripted generation provider (app/lib/fixture-runtime/generation-policy.ts) can design
 * the owner's four-motor request and a second ordinary circuit (a 555 PWM LED dimmer) from PUBLISHED exact parts only (OD-253 (1), (4)):
 * AO3400A (N-MOSFET, SOT-23), SS14 (Schottky, SMA), MIC5504-3.3 (3.3 V LDO, SOT-23-5), ATmega328P-AU (TQFP-32), LSM6DS3TR-C (IMU,
 * LGA-14), Wuerth 1x04 and 2x03 pin headers and a Bourns 3386P 10 k potentiometer. Each is built, reviewed, approved and published through
 * the SAME production machinery as the blinker catalog: the official KiCad symbol and footprint copied verbatim (LF) into
 * app/lib/fixture-runtime/generation-kicad (CC-BY-SA-4.0 with the KiCad libraries exception; its LICENSES.md names every upstream git
 * blob), parsed by the production parsers. The ATmega328P-A symbol extends ATmega48PV-10A in KiCad's split library, so it is committed as
 * ONE pre-composed library (the parent block, then the child block, as `Timer_NE555.kicad_sym` already is): this module may import only
 * what its closure already holds (b24-c1 pins it; the acquisition composer is forbidden there). The terminals are derived 1:1 from the
 * parsed symbol pins (number -> the pad of the same number, NC pins included), the mapping certificate comes from
 * `buildMappingCertificate` and must be approved, the package proof's pin count must equal the footprint's electrical pads, and the
 * transitions use a human reviewer and a different publisher.
 *
 * Truth boundary, as the two catalogs above: the manufacturer part numbers are real, but every pin and pad fact comes from the KiCad
 * files and every evidence record is a FIXTURE record (`fixture://l7/...`, "NOT manufacturer datasheets"); no rating is published. The
 * records live only in the fixture runtime's container catalog (`fixtureRuntimeCatalog`); `blinkerCatalog()` and its snapshots are
 * unchanged. Passives reuse the blinker catalog's published values (10k, 56k, 330; 10uF, 100nF, 10nF).
 */
export const GENERATION_FIXTURE_PART_IDS = Object.freeze({
  nmos: "l7-part-ao3400a",
  schottky: "l7-part-ss14",
  ldo: "l7-part-mic5504-3v3",
  mcu: "l7-part-atmega328p-au",
  imu: "l7-part-lsm6ds3tr-c",
  header1x04: "l7-part-conn-1x04",
  header2x03: "l7-part-conn-2x03",
  potentiometer: "l7-part-pot-3386p-10k",
} as const);

const GENERATION_NOW = new Date("2026-10-19T00:00:00.000Z");
const GENERATION_KICAD_DIR = join(process.cwd(), "app", "lib", "fixture-runtime", "generation-kicad");
const generationKicadSource = (file: string): string => readFileSync(join(GENERATION_KICAD_DIR, file), "utf8").replace(/\r\n/g, "\n");

/** One published exact part: its KiCad sources, its catalog record and its one value link ('' = value-agnostic). */
export interface GenerationPartSource {
  partId: string;
  symbolFile: string;
  symbolName: string;
  symbolLibrary: string;
  footprintFile: string;
  footprintLibrary: string;
  mainCategory: string;
  name: string;
  description: string;
  mpn: string;
  manufacturer: { id: string; name: string; domains: string[] };
  packageCode: string;
  valueKey: string;
}

const MICROCHIP = { id: "manufacturer_microchip", name: "Microchip Technology", domains: ["microchip.com"] };
const WUERTH = { id: "manufacturer_wuerth", name: "Wuerth Elektronik", domains: ["we-online.com"] };

export const GENERATION_PART_SOURCES: readonly GenerationPartSource[] = Object.freeze([
  { partId: GENERATION_FIXTURE_PART_IDS.nmos, symbolFile: "Q_NMOS_GSD.kicad_sym", symbolName: "Q_NMOS_GSD", symbolLibrary: "Transistor_FET", footprintFile: "SOT-23.kicad_mod", footprintLibrary: "Package_TO_SOT_SMD", mainCategory: "Transistor",
    name: "AO3400A", description: "30 V 5.7 A logic-level N-channel MOSFET, SOT-23", mpn: "AO3400A", manufacturer: { id: "manufacturer_alpha_omega", name: "Alpha & Omega Semiconductor", domains: ["aosmd.com"] }, packageCode: "SOT-23", valueKey: "" },
  { partId: GENERATION_FIXTURE_PART_IDS.schottky, symbolFile: "D_Schottky.kicad_sym", symbolName: "D_Schottky", symbolLibrary: "Device", footprintFile: "D_SMA.kicad_mod", footprintLibrary: "Diode_SMD", mainCategory: "Diode",
    name: "SS14", description: "40 V 1 A Schottky barrier rectifier diode, SMA (DO-214AC)", mpn: "SS14-E3/61T", manufacturer: { id: "manufacturer_vishay", name: "Vishay General Semiconductor", domains: ["vishay.com"] }, packageCode: "SMA", valueKey: "" },
  { partId: GENERATION_FIXTURE_PART_IDS.ldo, symbolFile: "MIC5504-3.3YM5.kicad_sym", symbolName: "MIC5504-3.3YM5", symbolLibrary: "Regulator_Linear", footprintFile: "SOT-23-5.kicad_mod", footprintLibrary: "Package_TO_SOT_SMD", mainCategory: "Regulator",
    name: "MIC5504-3.3YM5", description: "300 mA 3.3 V low-dropout linear regulator with enable, SOT-23-5", mpn: "MIC5504-3.3YM5-TR", manufacturer: MICROCHIP, packageCode: "SOT-23-5", valueKey: "" },
  { partId: GENERATION_FIXTURE_PART_IDS.mcu, symbolFile: "MCU_Microchip_ATmega_ATmega328P-A.kicad_sym", symbolName: "ATmega328P-A", symbolLibrary: "MCU_Microchip_ATmega", footprintFile: "TQFP-32_7x7mm_P0.8mm.kicad_mod", footprintLibrary: "Package_QFP", mainCategory: "MCU",
    name: "ATmega328P-AU", description: "8-bit AVR microcontroller, 32 KB flash, 2 KB SRAM, TQFP-32", mpn: "ATMEGA328P-AU", manufacturer: MICROCHIP, packageCode: "TQFP-32", valueKey: "" },
  { partId: GENERATION_FIXTURE_PART_IDS.imu, symbolFile: "LSM6DS3.kicad_sym", symbolName: "LSM6DS3", symbolLibrary: "Sensor_Motion", footprintFile: "LGA-14_3x2.5mm_P0.5mm_LayoutBorder3x4y.kicad_mod", footprintLibrary: "Package_LGA", mainCategory: "Sensor",
    name: "LSM6DS3TR-C", description: "6-axis IMU (3D accelerometer and 3D gyroscope), I2C/SPI, LGA-14", mpn: "LSM6DS3TR-C", manufacturer: { id: "manufacturer_stmicroelectronics", name: "STMicroelectronics", domains: ["st.com"] }, packageCode: "LGA-14", valueKey: "" },
  { partId: GENERATION_FIXTURE_PART_IDS.header1x04, symbolFile: "Conn_01x04.kicad_sym", symbolName: "Conn_01x04", symbolLibrary: "Connector_Generic", footprintFile: "PinHeader_1x04_P2.54mm_Vertical.kicad_mod", footprintLibrary: "Connector_PinHeader_2.54mm", mainCategory: "Connector",
    name: "Conn_01x04", description: "WR-PHD 2.54 mm 1x4 vertical through-hole pin header", mpn: "61300411121", manufacturer: WUERTH, packageCode: "PinHeader_1x04_P2.54mm_Vertical", valueKey: "" },
  { partId: GENERATION_FIXTURE_PART_IDS.header2x03, symbolFile: "Conn_02x03_Odd_Even.kicad_sym", symbolName: "Conn_02x03_Odd_Even", symbolLibrary: "Connector_Generic", footprintFile: "PinHeader_2x03_P2.54mm_Vertical.kicad_mod", footprintLibrary: "Connector_PinHeader_2.54mm", mainCategory: "Connector",
    name: "Conn_02x03_Odd_Even", description: "WR-PHD 2.54 mm 2x3 dual-row vertical through-hole pin header", mpn: "61300621121", manufacturer: WUERTH, packageCode: "PinHeader_2x03_P2.54mm_Vertical", valueKey: "" },
  { partId: GENERATION_FIXTURE_PART_IDS.potentiometer, symbolFile: "R_Potentiometer.kicad_sym", symbolName: "R_Potentiometer", symbolLibrary: "Device", footprintFile: "Potentiometer_Bourns_3386P_Vertical.kicad_mod", footprintLibrary: "Potentiometer_THT", mainCategory: "Potentiometer",
    name: "3386P-1-103LF", description: "10 kOhm single-turn trimming potentiometer, Bourns 3386P, vertical", mpn: "3386P-1-103LF", manufacturer: { id: "manufacturer_bourns", name: "Bourns", domains: ["bourns.com"] }, packageCode: "3386P", valueKey: normalizeValueKey("10k") },
] satisfies GenerationPartSource[]);

export interface GenerationFixtureParts {
  cachedParts: Map<string, CachedPart>;
  snapshots: Map<string, PortableAtomicSnapshot>;
  /** per part: the published revision of its one value link, its approved mapping and its exact part */
  revisions: Map<string, { valueKey: string; revisionId: string; mapping: MappingCertificate; packageProof: ReturnType<typeof provePackage>; exactPart: ExactManufacturerPart; symbol: SymbolAssetVersion; footprint: FootprintAssetVersion }>;
}

let generationMemo: GenerationFixtureParts | null = null;

/** Build (once per process) the generation proofs' published parts. Pure and deterministic; throws on any asset the parsers refuse. */
export function generationFixtureParts(): GenerationFixtureParts {
  if (generationMemo) return generationMemo;
  const catalog = new AtomicCatalog();
  catalog.addLicense(KICAD_LIBRARY_LICENSE);
  const kicadSourceId = "source_kicad_official_libraries";
  catalog.addSource({ id: kicadSourceId, sourceClass: "official_kicad_library", name: "KiCad official symbol/footprint libraries", canonicalUri: "https://gitlab.com/kicad/libraries", officialDomains: ["kicad.org", "gitlab.com"], licenseId: KICAD_LIBRARY_LICENSE.id });
  const recordsSourceId = "source_l7_fixture_records";
  catalog.addSource({ id: recordsSourceId, sourceClass: "organization_authored", name: "L.7 generation fixture records (NOT manufacturer datasheets)", officialDomains: [], licenseId: KICAD_LIBRARY_LICENSE.id });
  const origin = (library: string, file: string, content: string, mediaType: string) => {
    const recordId = `record_kicad_${library}_${file.replace(/[^A-Za-z0-9]+/g, "_")}`;
    if (!catalog.sourceRecords.has(recordId)) catalog.addSourceRecord({ id: recordId, sourceId: kicadSourceId, revision: "committed-fixture-copy", contentHash: sha256(content), retrievedAt: GENERATION_NOW.toISOString(), locator: `kicad-libraries://${library}/${file}`, mediaType, confidential: false });
    return { sourceRecordId: recordId, libraryNickname: library, sourceUri: `kicad-libraries://${library}/${file}`, licenseId: KICAD_LIBRARY_LICENSE.id };
  };
  const cachedParts = new Map<string, CachedPart>();
  const snapshots = new Map<string, PortableAtomicSnapshot>();
  const revisions: GenerationFixtureParts["revisions"] = new Map();

  for (const source of GENERATION_PART_SOURCES) {
    const symbolSource = generationKicadSource(source.symbolFile), footprintSource = generationKicadSource(source.footprintFile);
    const symbol = parseSymbolAssets({ source: symbolSource, origin: origin(source.symbolLibrary, source.symbolFile, symbolSource, MEDIA_SYMBOL) }).find((asset) => asset.symbolName === source.symbolName);
    if (!symbol) throw new Error(`fixture symbol ${source.symbolName} not found in ${source.symbolFile}`);
    if (symbol.validationState !== "valid") throw new Error(`fixture symbol ${source.symbolName} is ${symbol.validationState}: ${symbol.diagnostics.map((d) => d.message).join("; ")}`);
    const footprint = parseFootprintAsset({ source: footprintSource, libraryNickname: source.footprintLibrary, origin: origin(source.footprintLibrary, source.footprintFile, footprintSource, MEDIA_FOOTPRINT) });
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

    const key = `${source.partId}-${source.mpn}`.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
    if (!catalog.manufacturers.has(source.manufacturer.id)) catalog.addManufacturer({ id: source.manufacturer.id, canonicalName: source.manufacturer.name, aliases: [], officialDomains: source.manufacturer.domains });
    catalog.addSourceRecord({ id: `record_fixture_${key}`, sourceId: recordsSourceId, revision: "fixture-1", contentHash: sha256(`fixture:${key}:${source.mpn}`), retrievedAt: GENERATION_NOW.toISOString(), locator: `fixture://l7/${key}/${source.mpn}`, mediaType: "text/plain", confidential: false });
    const evidence: EvidenceRef = { id: `evidence_fixture_${key}`, sourceRecordId: `record_fixture_${key}`, locator: `fixture record for ${source.mpn} (NOT manufacturer datasheets): ${source.description}; pins and pads from the KiCad files`, extractionMethod: "manual", extractorVersion: "l7-fixture/1", extractedAt: GENERATION_NOW.toISOString(), reviewerId: "user:fixture-reviewer", reviewedAt: GENERATION_NOW.toISOString() };
    catalog.addEvidence(evidence);
    const exactPart: ExactManufacturerPart = { id: `exact_${key}`, manufacturerId: source.manufacturer.id, exactMpn: source.mpn, normalizedSearchKey: source.mpn.replace(/[^A-Za-z0-9]+/g, "").toUpperCase(), state: "active", aliasEvidenceIds: [] };
    catalog.addExactPart(exactPart);
    // the terminals 1:1 from the parsed symbol's pins (number -> the pad of the same number); a no-connect pin is a terminal too
    const terminals: ManufacturerTerminal[] = extracted.pins.map((pin) => ({ id: `terminal_${key}_${pin.number}`, publishedIdentifier: pin.number, function: pin.name && pin.name !== "~" ? pin.name : pin.number, classification: "electrical", evidenceIds: [evidence.id] }));
    const electricalPads = footprint.pads.filter((pad) => !pad.mechanical).length;
    const packageProof = provePackage({ exactPartId: exactPart.id, footprintVersionId: footprint.versionId, packageCode: source.packageCode, mountingTechnology: footprint.mountingTechnology, pinCount: terminals.length, evidenceIds: [evidence.id], checks: [{ field: "pinCount", expected: terminals.length, actual: electricalPads }] });
    if (packageProof.state !== "proven") throw new Error(`fixture package proof for ${source.mpn} is ${packageProof.state}: ${packageProof.conflicts.join(", ")}`);
    const mapping = buildMappingCertificate({ exactPartId: exactPart.id, symbol, footprint, terminals, mapping: terminals.map((terminal) => ({ manufacturerTerminalId: terminal.id, symbolPinNumbers: [terminal.publishedIdentifier], logicalPadNumbers: [terminal.publishedIdentifier], evidenceIds: [evidence.id] })), packageProof, evidenceIds: [evidence.id] });
    if (mapping.state !== "approved") throw new Error(`fixture mapping for ${source.mpn} is ${mapping.state}: missing pins ${mapping.missingSymbolPinIds.length}, missing pads ${mapping.missingPadNumbers.join(",")}, extra ${mapping.extraElectricalPadNumbers.join(",")}`);
    catalog.addMapping(mapping);
    const draft = createAtomicRevision({ logicalPartId: `logical_${key}`, revision: 1, exactPartId: exactPart.id, cadBundles: [{ symbolVersionId: symbol.versionId, footprintVersionId: footprint.versionId, modelVersionIds: [], mappingCertificateId: mapping.id, disposition: "primary_approved" }], claimIds: [], guidanceIds: [], offerSnapshotIds: [], licenseIds: [KICAD_LIBRARY_LICENSE.id], publicationState: "draft", policyVersion: "l7-fixture-policy/1", createdAt: GENERATION_NOW.toISOString(), createdBy: "user:fixture-ingest", reviewHistory: [] });
    catalog.addRevision(draft);
    const review = catalog.transition({ revisionId: draft.id, to: "needs_review", actorId: "user:fixture-reviewer", actorRole: "reviewer", reason: "L.7 fixture submission", now: GENERATION_NOW });
    const approved = catalog.transition({ revisionId: review.id, to: "approved", actorId: "user:fixture-reviewer", actorRole: "reviewer", reason: "L.7 fixture approval", now: GENERATION_NOW });
    const published = catalog.transition({ revisionId: approved.id, to: "published", actorId: "user:fixture-publisher", actorRole: "publisher", reason: "L.7 fixture publication", now: GENERATION_NOW });
    snapshots.set(published.id, catalog.portableSnapshot(published.id, GENERATION_NOW));
    const footprintFullName = `${source.footprintLibrary}:${footprint.footprintName}`;
    revisions.set(source.partId, { valueKey: source.valueKey, revisionId: published.id, mapping, packageProof, exactPart, symbol, footprint });
    cachedParts.set(source.partId, {
      id: source.partId, name: source.name, description: source.description, mpn: source.mpn, manufacturer: source.manufacturer.name, datasheet: extracted.datasheet,
      footprintHint: footprintFullName, mainCategory: source.mainCategory, libraryName: source.symbolLibrary, pins: extracted.pins, symbolRaw: extracted.symbolRaw, properties: extracted.properties,
      atomicAssignments: { [source.valueKey]: { revisionId: published.id, symbolVersionId: mapping.symbolVersionId, footprintVersionId: mapping.footprintVersionId, mappingCertificateId: mapping.id, footprintFullName, approved: true } },
    });
  }
  generationMemo = { cachedParts, snapshots, revisions };
  return generationMemo;
}
