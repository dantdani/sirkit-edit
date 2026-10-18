/**
 * [PR-M, 2026-10-17] Test-only fixtures for section M increment 1: REAL published atomic revisions built from committed KiCad
 * library files through the SAME production parsers, mapping-certificate builder, package proof and catalog transition rules the
 * blinker acceptance catalog uses (app/lib/fixture-runtime/blinker/catalog.ts). Nothing here claims datasheet verification of the
 * parts: the evidence records are explicit FIXTURE records (`fixture://` locators); the tests prove the resolution PIPELINE.
 *
 * The KiCad files under ./fixtures/kicad are the official KiCad library files copied verbatim (line endings normalised to LF):
 * Device.kicad_symdir/D.kicad_sym and Diode_SMD.pretty/D_SOD-123.kicad_mod (CC-BY-SA-4.0 with the KiCad libraries exception, the
 * same licence record the blinker fixtures carry). `D_AK` is the Device:D symbol with its two pin NUMBERS swapped (K is pin 2, A
 * pin 1) - a real symbol whose replacement needs a mapping proved by pin function, not by number.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { KicadPin } from "@/app/lib/kicad/types";
import type { KicadComponentInstance, NetLabel, SchematicState, Wire } from "@/lib/schematic-types";
import { kicadPinWorldPos } from "@/app/lib/geometry";
import { AtomicCatalog, createAtomicRevision } from "@/app/lib/atomic/catalog";
import { parseFootprintAsset, parseSymbolAssets, rawContentObject } from "@/app/lib/atomic/kicad-assets";
import { buildMappingCertificate, provePackage } from "@/app/lib/atomic/mapping";
import { sha256 } from "@/app/lib/atomic/stable";
import type { EngineeringClaim, EvidenceRef, ExactManufacturerPart, ManufacturerTerminal, PortableAtomicSnapshot, QuantityDimension } from "@/app/lib/atomic/types";
import { extractLibrary } from "@/app/lib/kicad/extract";
import { KICAD_LIBRARY_LICENSE } from "@/app/lib/fixture-runtime/blinker/catalog";

const FIXTURE_DIR = join(process.cwd(), "app", "lib", "component-resolution", "__tests__", "fixtures", "kicad");
const read = (file: string): string => readFileSync(join(FIXTURE_DIR, file), "utf8").replace(/\r\n/g, "\n");
export const D_SYMBOL_SOURCE = read("D.kicad_sym");
export const SOD123_SOURCE = read("D_SOD-123.kicad_mod");
/** Device:D with the pin numbers swapped and the symbol renamed (D_AK): K is pin "2", A is pin "1". */
export const D_AK_SYMBOL_SOURCE = D_SYMBOL_SOURCE
  .replace('(symbol "D"', '(symbol "D_AK"').replace('(symbol "D_0_1"', '(symbol "D_AK_0_1"').replace('(symbol "D_1_1"', '(symbol "D_AK_1_1"')
  .replace('(property "Value" "D"', '(property "Value" "D_AK"')
  .replace('(number "1"', '(number "@ONE@"').replace('(number "2"', '(number "1"').replace('(number "@ONE@"', '(number "2"');

export const FIXTURE_NOW = new Date("2026-10-17T00:00:00.000Z");

export function extractedPins(symbolSource: string, symbolName: string): { pins: KicadPin[]; symbolRaw: string } {
  const extracted = extractLibrary([symbolSource]).find((item) => item.name === symbolName);
  if (!extracted) throw new Error(`extractLibrary did not yield ${symbolName}`);
  return { pins: extracted.pins, symbolRaw: extracted.symbolRaw };
}

export interface FixtureClaim { property: string; dimension: QuantityDimension; max?: number; min?: number; unit: string; limit: EngineeringClaim["limit"] }
export interface FixtureRevision { revisionId: string; snapshot: PortableAtomicSnapshot; mpn: string }

/** One published exact revision (a fresh catalog per revision: the portable snapshot is self-contained). */
export function buildPublishedRevision(input: {
  key: string;
  mpn: string;
  manufacturer: { id: string; name: string; domains: string[] };
  symbolSource: string;
  symbolName: string;
  symbolLibrary: string;
  footprintSource: string;
  footprintLibrary: string;
  /** published terminal identifier (= pad number) -> function and the symbol pin it maps to */
  terminals: Array<{ identifier: string; function: string; symbolPin: string }>;
  packageCode: string;
  claims?: FixtureClaim[];
}): FixtureRevision {
  const catalog = new AtomicCatalog();
  catalog.addLicense(KICAD_LIBRARY_LICENSE);
  const kicadSourceId = "source_kicad_official_libraries";
  catalog.addSource({ id: kicadSourceId, sourceClass: "official_kicad_library", name: "KiCad official symbol/footprint libraries", canonicalUri: "https://gitlab.com/kicad/libraries", officialDomains: ["kicad.org", "gitlab.com"], licenseId: KICAD_LIBRARY_LICENSE.id });
  const origin = (library: string, file: string, content: string, mediaType: string) => {
    const recordId = `record_m1_${library}_${file}`.replace(/[^A-Za-z0-9_]+/g, "_");
    if (!catalog.sourceRecords.has(recordId)) catalog.addSourceRecord({ id: recordId, sourceId: kicadSourceId, revision: "committed-fixture-copy", contentHash: sha256(content), retrievedAt: FIXTURE_NOW.toISOString(), locator: `kicad-libraries://${library}/${file}`, mediaType, confidential: false });
    return { sourceRecordId: recordId, libraryNickname: library, sourceUri: `kicad-libraries://${library}/${file}`, licenseId: KICAD_LIBRARY_LICENSE.id };
  };
  const symbol = parseSymbolAssets({ source: input.symbolSource, origin: origin(input.symbolLibrary, `${input.symbolName}.kicad_sym`, input.symbolSource, "application/x-kicad-symbol") }).find((asset) => asset.symbolName === input.symbolName);
  if (!symbol || symbol.validationState !== "valid") throw new Error(`fixture symbol ${input.symbolName} did not parse valid`);
  const footprint = parseFootprintAsset({ source: input.footprintSource, libraryNickname: input.footprintLibrary, origin: origin(input.footprintLibrary, "footprint.kicad_mod", input.footprintSource, "application/x-kicad-footprint") });
  if (footprint.validationState === "invalid" || footprint.validationState === "unsupported") throw new Error(`fixture footprint is ${footprint.validationState}`);
  catalog.addSymbol(symbol);
  catalog.addFootprint(footprint);
  const symbolRaw = rawContentObject({ content: input.symbolSource, mediaType: "application/x-kicad-symbol", licenseId: KICAD_LIBRARY_LICENSE.id });
  catalog.addRawObject(symbolRaw);
  const footprintRaw = rawContentObject({ content: input.footprintSource, mediaType: "application/x-kicad-footprint", licenseId: KICAD_LIBRARY_LICENSE.id });
  if (!catalog.rawObjects.has(footprintRaw.id)) catalog.addRawObject(footprintRaw);
  catalog.addManufacturer({ id: input.manufacturer.id, canonicalName: input.manufacturer.name, aliases: [], officialDomains: input.manufacturer.domains });
  const sourceId = "source_m1_fixture_records";
  catalog.addSource({ id: sourceId, sourceClass: "organization_authored", name: "PR-M fixture records (NOT manufacturer datasheets)", officialDomains: [], licenseId: KICAD_LIBRARY_LICENSE.id });
  const recordId = `record_fixture_${input.key}`;
  catalog.addSourceRecord({ id: recordId, sourceId, revision: "fixture-1", contentHash: sha256(`fixture:${input.key}:${input.mpn}`), retrievedAt: FIXTURE_NOW.toISOString(), locator: `fixture://pr-m/${input.key}/${input.mpn}`, mediaType: "text/plain", confidential: false });
  const evidence: EvidenceRef = { id: `evidence_fixture_${input.key}`, sourceRecordId: recordId, locator: `fixture record for ${input.mpn}`, extractionMethod: "manual", extractorVersion: "pr-m-fixture/1", extractedAt: FIXTURE_NOW.toISOString(), reviewerId: "user:fixture-reviewer", reviewedAt: FIXTURE_NOW.toISOString() };
  catalog.addEvidence(evidence);
  const exactPart: ExactManufacturerPart = { id: `exact_${input.key}`, manufacturerId: input.manufacturer.id, exactMpn: input.mpn, normalizedSearchKey: input.mpn.replace(/[^A-Za-z0-9]+/g, "").toUpperCase(), state: "active", aliasEvidenceIds: [] };
  catalog.addExactPart(exactPart);
  const terminals: ManufacturerTerminal[] = input.terminals.map((terminal) => ({ id: `terminal_${input.key}_${terminal.identifier}`, publishedIdentifier: terminal.identifier, function: terminal.function, classification: "electrical", evidenceIds: [evidence.id] }));
  const electricalPads = footprint.pads.filter((pad) => !pad.mechanical).length;
  const packageProof = provePackage({ exactPartId: exactPart.id, footprintVersionId: footprint.versionId, packageCode: input.packageCode, mountingTechnology: footprint.mountingTechnology, pinCount: terminals.length, evidenceIds: [evidence.id], checks: [{ field: "pinCount", expected: terminals.length, actual: electricalPads }] });
  const mapping = buildMappingCertificate({ exactPartId: exactPart.id, symbol, footprint, terminals, mapping: input.terminals.map((terminal, index) => ({ manufacturerTerminalId: terminals[index]!.id, symbolPinNumbers: [terminal.symbolPin], logicalPadNumbers: [terminal.identifier], evidenceIds: [evidence.id] })), packageProof, evidenceIds: [evidence.id] });
  if (mapping.state !== "approved") throw new Error(`fixture mapping for ${input.mpn} is ${mapping.state}`);
  catalog.addMapping(mapping);
  const claimIds: string[] = [];
  for (const [index, claim] of (input.claims ?? []).entries()) {
    const id = `claim_${input.key}_${index}`;
    catalog.addClaim({ id, property: claim.property, facet: "diode_led_tvs", value: { dimension: claim.dimension, ...(claim.max !== undefined ? { max: claim.max } : {}), ...(claim.min !== undefined ? { min: claim.min } : {}), sourceText: `${claim.max ?? claim.min} ${claim.unit}`, sourceUnit: claim.unit }, limit: claim.limit, conditions: {}, scope: { kind: "part" }, state: "source_backed", evidenceIds: [evidence.id], conflictsWith: [], safetyCritical: false });
    claimIds.push(id);
  }
  const draft = createAtomicRevision({ logicalPartId: `logical_${input.key}`, revision: 1, exactPartId: exactPart.id, cadBundles: [{ symbolVersionId: symbol.versionId, footprintVersionId: footprint.versionId, modelVersionIds: [], mappingCertificateId: mapping.id, disposition: "primary_approved" }], claimIds, guidanceIds: [], offerSnapshotIds: [], licenseIds: [KICAD_LIBRARY_LICENSE.id], publicationState: "draft", policyVersion: "pr-m-fixture-policy/1", createdAt: FIXTURE_NOW.toISOString(), createdBy: "user:fixture-ingest", reviewHistory: [] });
  catalog.addRevision(draft);
  const review = catalog.transition({ revisionId: draft.id, to: "needs_review", actorId: "user:fixture-reviewer", actorRole: "reviewer", reason: "PR-M fixture submission", now: FIXTURE_NOW });
  const approved = catalog.transition({ revisionId: review.id, to: "approved", actorId: "user:fixture-reviewer", actorRole: "reviewer", reason: "PR-M fixture approval", now: FIXTURE_NOW });
  const published = catalog.transition({ revisionId: approved.id, to: "published", actorId: "user:fixture-publisher", actorRole: "publisher", reason: "PR-M fixture publication", now: FIXTURE_NOW });
  return { revisionId: published.id, snapshot: catalog.portableSnapshot(published.id, FIXTURE_NOW), mpn: input.mpn };
}

const DIODES_INC = { id: "manufacturer_diodes_inc", name: "Diodes Incorporated", domains: ["diodes.com"] };
/** A 1N4148W-class SOD-123 switching diode on the Device:D symbol (K = pin 1 = pad 1), with published ratings. */
export function switchingDiodeRevision(key: string, mpn: string, claims: FixtureClaim[] = [{ property: "reverse_voltage", dimension: "voltage", max: 75, unit: "V", limit: "absolute_maximum" }, { property: "forward_current", dimension: "current", max: 0.3, unit: "A", limit: "absolute_maximum" }]): FixtureRevision {
  return buildPublishedRevision({ key, mpn, manufacturer: DIODES_INC, symbolSource: D_SYMBOL_SOURCE, symbolName: "D", symbolLibrary: "Device", footprintSource: SOD123_SOURCE, footprintLibrary: "Diode_SMD", terminals: [{ identifier: "1", function: "K", symbolPin: "1" }, { identifier: "2", function: "A", symbolPin: "2" }], packageCode: "SOD-123", claims });
}
/** The same diode on the swapped-number symbol D_AK: K is symbol pin 2 (pad 1), A symbol pin 1 (pad 2). */
export function swappedSymbolDiodeRevision(key: string, mpn: string): FixtureRevision {
  return buildPublishedRevision({ key, mpn, manufacturer: DIODES_INC, symbolSource: D_AK_SYMBOL_SOURCE, symbolName: "D_AK", symbolLibrary: "Device", footprintSource: SOD123_SOURCE, footprintLibrary: "Diode_SMD", terminals: [{ identifier: "1", function: "K", symbolPin: "2" }, { identifier: "2", function: "A", symbolPin: "1" }], packageCode: "SOD-123" });
}

// ─── The isolated LED-dimmer sheet ────────────────────────────────────────────────────────────────────────────────────────────

/** Pins of the KiCad Diode library's 1N4148 symbol (the Device:D geometry it extends: K at -3.81 mm, A at +3.81 mm). */
export const DIODE_1N4148_PINS: KicadPin[] = extractedPins(D_SYMBOL_SOURCE, "D").pins;

export interface SheetPart { id: string; pins: readonly KicadPin[] }
export interface DimmerSheetParts { timer: SheetPart; resistor: SheetPart; capacitor: SheetPart; diode1n4148: SheetPart }
export interface DimmerResolvedIdentity { atomicPartRevisionId: string; symbolAssetVersionId: string; footprintAssetVersionId: string; mappingCertificateId: string }

const pinOf = (part: SheetPart, number: string): KicadPin => {
  const pin = part.pins.find((entry) => entry.number === number);
  if (!pin) throw new Error(`fixture part ${part.id} has no pin ${number}`);
  return pin;
};

/**
 * A faithful, isolated equivalent of the owner's LED-dimmer: a 555 (U1, published) whose discharge / threshold network steers the
 * charge and discharge currents through two 1N4148 steering diodes (D1, D2: placed from the catalog's 1N4148 symbol, NO published
 * exact revision), a timing resistor (R1) and capacitor (C1) - every other part resolved. D1's anode is on RA and its cathode on
 * TIMING; D2 is turned the other way (anode on TIMING, cathode on RB): the polarity proof must keep both orientations. D1's cathode
 * reaches C1 through a WIRE; every other connection is a net label sitting on a pin.
 */
export function ledDimmerSheet(parts: DimmerSheetParts, resolved: { timer: DimmerResolvedIdentity; resistor: DimmerResolvedIdentity; capacitor: DimmerResolvedIdentity }): SchematicState {
  const instance = (id: string, part: SheetPart, refDes: string, value: string, x: number, y: number, identity: DimmerResolvedIdentity | null): KicadComponentInstance => ({ id, partId: part.id, x, y, rotation: 0, refDes, value, ...(identity ? identity : {}) });
  const u1 = instance("kc-u1", parts.timer, "U1", "NE555D", 400, 300, resolved.timer);
  const r1 = instance("kc-r1", parts.resistor, "R1", "10k", 200, 160, resolved.resistor);
  const c1 = instance("kc-c1", parts.capacitor, "C1", "10nF", 600, 480, resolved.capacitor);
  const d1 = instance("kc-d1", parts.diode1n4148, "D1", "1N4148", 200, 300, null);
  const d2 = instance("kc-d2", parts.diode1n4148, "D2", "1N4148", 200, 420, null);
  let next = 0;
  const label = (component: KicadComponentInstance, part: SheetPart, pin: string, name: string, kind: NetLabel["kind"] = "label"): NetLabel => ({ id: `nl-${++next}`, position: kicadPinWorldPos(component, pinOf(part, pin)), name, kind, orientation: 0 });
  const d1Cathode = kicadPinWorldPos(d1, pinOf(parts.diode1n4148, "1"));
  const c1Top = kicadPinWorldPos(c1, pinOf(parts.capacitor, "1"));
  // routed above the timer and around to C1's top pin so no segment crosses another pin (U1's OUT sits at y = 300)
  const wire: Wire = { id: "w-d1k-c1", vertices: [d1Cathode, { x: d1Cathode.x, y: 240 }, { x: 700, y: 240 }, { x: 700, y: c1Top.y }, c1Top] };
  return {
    components: [],
    kicadComponents: [u1, r1, c1, d1, d2],
    wires: [wire],
    netLabels: [
      label(u1, parts.timer, "8", "VCC", "power"), label(u1, parts.timer, "4", "VCC", "power"), label(u1, parts.timer, "1", "GND", "ground"),
      label(u1, parts.timer, "7", "RA"), label(u1, parts.timer, "6", "TIMING"), label(u1, parts.timer, "2", "TIMING"), label(u1, parts.timer, "3", "PWM"),
      label(r1, parts.resistor, "1", "VCC", "power"), label(r1, parts.resistor, "2", "RA"),
      label(d1, parts.diode1n4148, "2", "RA"), label(d1, parts.diode1n4148, "1", "TIMING"),
      label(d2, parts.diode1n4148, "2", "TIMING"), label(d2, parts.diode1n4148, "1", "RB"),
      label(c1, parts.capacitor, "2", "GND", "ground"),
    ],
  };
}
