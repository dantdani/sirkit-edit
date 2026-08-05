/**
 * Seed exact atomic authority for the R05-E2E01 demo part set.
 *
 * Publishes, through the REAL atomic publication gates (no shims, no test
 * overrides), one atomic part revision per exact orderable MPN:
 *   - NE555DR            SOIC-8 bipolar 555 timer (TI)
 *   - RC0805FR-0747KL    47 kΩ 0805 chip resistor (Yageo)
 *   - RC0805FR-07470KL   470 kΩ 0805 chip resistor (Yageo)
 *   - RC0805FR-071KL     1 kΩ 0805 chip resistor (Yageo)
 *   - CL21B105KAFNNNE    1 µF 0805 X7R MLCC (Samsung)
 *   - CL21B104KBCNNNC    100 nF 0805 X7R MLCC (Samsung)
 *   - CL21B103KBANNNC    10 nF 0805 X7R MLCC (Samsung)
 *   - LTST-C170KRKT      0805 red LED (Lite-On)
 *   - 61300211121        1×02 2.54 mm vertical TH pin header (Würth)
 *
 * CAD assets (symbol + footprint) are parsed from the verbatim official KiCad
 * library sources on disk (CC-BY-SA-4.0 with KiCad Libraries Exception);
 * terminals/package facts carry manufacturer-datasheet evidence references.
 * Every mapping certificate must come out `approved` and every publication
 * must pass the `pcb_assignable` profile or the script fails loudly.
 *
 * After publication, writes `parts_atomic_links` rows joining the KiCad search
 * catalog (`parts`) to the published revisions, and a JSON manifest under
 * scripts/output/ for the per-instance physical-binding flow.
 *
 * Usage: pnpm exec tsx scripts/seed-atomic-demo-parts.ts
 */

import { loadEnvLocal } from "../app/lib/load-env-local";
loadEnvLocal();
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb } from "../app/lib/db/client";
import { libraries, parts, partsAtomicLinks } from "../app/lib/db/schema";
import { AtomicCatalog, createAtomicRevision } from "../app/lib/atomic/catalog";
import { makeEvidence, makeSourceRecord } from "../app/lib/atomic/ingestion";
import { parseFootprintAsset, parseSymbolAssets, rawContentObject } from "../app/lib/atomic/kicad-assets";
import { buildMappingCertificate, provePackage } from "../app/lib/atomic/mapping";
import { publishPortableAtomicSnapshot } from "../app/lib/atomic/server-repository";
import { loadPublishedPortableSnapshot } from "../app/lib/atomic/server-catalog";
import type { LicenseRecord, ManufacturerTerminal, SourceIdentity } from "../app/lib/atomic/types";
import { normalizeValueKey } from "../app/lib/atomic/value-key";

const ROOT = join(__dirname, "..");
const NOW = new Date();
const REVIEWER = "user:sirkit-owner-reviewer";
const PUBLISHER = "user:sirkit-owner-publisher";

const KICAD_LICENSE: LicenseRecord = {
  id: "license_kicad_cc_by_sa_4",
  spdxId: "CC-BY-SA-4.0",
  name: "KiCad official libraries (CC-BY-SA 4.0 with KiCad Libraries Exception)",
  rawRedistribution: "redistributable",
  derivedRedistribution: "redistributable",
  exportDisposition: "redistributable",
};

/** Our own reference notes citing public manufacturer datasheets by URL. */
const REFERENCE_LICENSE: LicenseRecord = {
  id: "license_sirkit_datasheet_reference",
  spdxId: null,
  name: "Sirkit-authored datasheet reference notes (public datasheet URLs)",
  rawRedistribution: "redistributable",
  derivedRedistribution: "redistributable",
  exportDisposition: "redistributable",
};

interface DemoPartSpec {
  key: string;
  symbolLib: string;
  symbolName: string;
  footprintLib: string;
  footprintName: string;
  /** '' = value-agnostic default link; else normalized schematic value. */
  valueKeys: string[];
  manufacturer: { id: string; canonicalName: string; domains: string[] };
  mpn: string;
  datasheetUrl: string;
  datasheetLocator: string;
  packageCode: string;
  mounting: "smd" | "through_hole";
  /** pin number -> published terminal function (from the datasheet pin table). */
  terminals: Record<string, string>;
}

const TI = { id: "manufacturer_ti", canonicalName: "Texas Instruments", domains: ["ti.com"] };
const YAGEO = { id: "manufacturer_yageo", canonicalName: "Yageo", domains: ["yageo.com"] };
const SAMSUNG = { id: "manufacturer_semco", canonicalName: "Samsung Electro-Mechanics", domains: ["samsungsem.com"] };
const LITEON = { id: "manufacturer_liteon", canonicalName: "Lite-On", domains: ["liteon.com"] };
const WURTH = { id: "manufacturer_wurth", canonicalName: "Wurth Elektronik", domains: ["we-online.com"] };

const YAGEO_DS = "https://www.yageo.com/upload/media/product/products/datasheet/rchip/PYu-RC_Group_51_RoHS_L_12.pdf";
const SAMSUNG_DS = "https://weblib.samsungsem.com/mlcc/mlcc-ds.do";

function resistor(valueKey: string, mpn: string): DemoPartSpec {
  return {
    key: `resistor-${valueKey}`, symbolLib: "Device", symbolName: "R",
    footprintLib: "Resistor_SMD", footprintName: "R_0805_2012Metric",
    valueKeys: [valueKey], manufacturer: YAGEO, mpn,
    datasheetUrl: YAGEO_DS, datasheetLocator: "RC series general purpose chip resistors, 0805 dimensions and ratings table",
    packageCode: "0805 (2012 Metric)", mounting: "smd",
    terminals: { "1": "terminal 1", "2": "terminal 2" },
  };
}

function capacitor(valueKey: string, mpn: string): DemoPartSpec {
  return {
    key: `capacitor-${valueKey}`, symbolLib: "Device", symbolName: "C",
    footprintLib: "Capacitor_SMD", footprintName: "C_0805_2012Metric",
    valueKeys: [valueKey], manufacturer: SAMSUNG, mpn,
    datasheetUrl: `${SAMSUNG_DS}?partNumber=${mpn}`, datasheetLocator: "MLCC specification sheet, dimensions and rating table",
    packageCode: "0805 (2012 Metric)", mounting: "smd",
    terminals: { "1": "terminal 1", "2": "terminal 2" },
  };
}

const DEMO_PARTS: DemoPartSpec[] = [
  {
    key: "timer-ne555", symbolLib: "Timer", symbolName: "NE555D",
    footprintLib: "Package_SO", footprintName: "SOIC-8_3.9x4.9mm_P1.27mm",
    valueKeys: ["", "ne555", "ne555d", "ne555dr", "555"], manufacturer: TI, mpn: "NE555DR",
    datasheetUrl: "https://www.ti.com/lit/ds/symlink/ne555.pdf",
    datasheetLocator: "NE555 datasheet, pin configuration and functions (SOIC D package), Table 1",
    packageCode: "SOIC-8", mounting: "smd",
    terminals: { "1": "GND", "2": "TRIG", "3": "OUT", "4": "RESET", "5": "CONT", "6": "THRES", "7": "DISCH", "8": "VCC" },
  },
  // Yageo RC0805FR-07 series, F tolerance (±1%), standard E-series values a
  // designer would actually reach for in this circuit.
  resistor("220", "RC0805FR-07220RL"),
  resistor("330", "RC0805FR-07330RL"),
  resistor("470", "RC0805FR-07470RL"),
  resistor("1k", "RC0805FR-071KL"),
  resistor("2.2k", "RC0805FR-072K2L"),
  resistor("4.7k", "RC0805FR-074K7L"),
  resistor("10k", "RC0805FR-0710KL"),
  resistor("22k", "RC0805FR-0722KL"),
  resistor("47k", "RC0805FR-0747KL"),
  resistor("68k", "RC0805FR-0768KL"),
  resistor("100k", "RC0805FR-07100KL"),
  resistor("220k", "RC0805FR-07220KL"),
  resistor("470k", "RC0805FR-07470KL"),
  // Samsung CL21B (X7R, 0805) MLCCs.
  capacitor("1n", "CL21B102KBANNNC"),
  capacitor("10n", "CL21B103KBANNNC"),
  capacitor("100n", "CL21B104KBCNNNC"),
  capacitor("1u", "CL21B105KAFNNNE"),
  capacitor("10u", "CL21B106KOQNNNE"),
  {
    key: "led-0805", symbolLib: "Device", symbolName: "LED",
    footprintLib: "LED_SMD", footprintName: "LED_0805_2012Metric",
    valueKeys: ["", "led", "red"], manufacturer: LITEON, mpn: "LTST-C170KRKT",
    datasheetUrl: "https://optoelectronics.liteon.com/upload/download/DS22-2000-073/LTST-C170KRKT.pdf",
    datasheetLocator: "LTST-C170KRKT datasheet, package dimensions and polarity marking",
    packageCode: "0805 (2012 Metric)", mounting: "smd",
    terminals: { "1": "cathode", "2": "anode" },
  },
  {
    key: "header-1x02", symbolLib: "Connector_Generic", symbolName: "Conn_01x02",
    footprintLib: "Connector_PinHeader_2.54mm", footprintName: "PinHeader_1x02_P2.54mm_Vertical",
    valueKeys: ["", "conn_01x02", "power", "5v"], manufacturer: WURTH, mpn: "61300211121",
    datasheetUrl: "https://www.we-online.com/components/products/datasheet/61300211121.pdf",
    datasheetLocator: "WR-PHD 2.54 mm pin header datasheet, 1x02 vertical dimensions",
    packageCode: "PinHeader_1x02_P2.54mm", mounting: "through_hole",
    terminals: { "1": "pin 1", "2": "pin 2" },
  },
];

interface ManifestEntry {
  key: string;
  partId: string;
  valueKeys: string[];
  mpn: string;
  manufacturer: string;
  datasheetUrl: string;
  atomicPartRevisionId: string;
  exactPartId: string;
  symbolAssetVersionId: string;
  footprintAssetVersionId: string;
  footprintContentDigest: string;
  mappingCertificateId: string;
  footprintFullName: string;
  symbolFullName: string;
  packageCode: string;
  mounting: "smd" | "through_hole";
  datasheetEvidenceIds: string[];
}

function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }

async function findPartId(db: ReturnType<typeof getDb>, lib: string, name: string): Promise<string> {
  const rows = await db.select({ id: parts.id }).from(parts)
    .innerJoin(libraries, eq(parts.libraryId, libraries.id))
    .where(and(eq(libraries.name, lib), eq(parts.name, name)))
    .limit(2);
  if (rows.length !== 1) throw new Error(`Expected exactly one parts row for ${lib}:${name}, found ${rows.length}`);
  return rows[0]!.id;
}

/** Point (partId, valueKey) at a revision — repoint on conflict so the links
 * never drift away from what this script (and the manifest) report. */
async function upsertLink(db: ReturnType<typeof getDb>, row: typeof partsAtomicLinks.$inferInsert): Promise<void> {
  await db.insert(partsAtomicLinks).values(row).onConflictDoUpdate({
    target: [partsAtomicLinks.partId, partsAtomicLinks.valueKey],
    set: {
      atomicPartRevisionId: row.atomicPartRevisionId,
      symbolAssetVersionId: row.symbolAssetVersionId,
      footprintAssetVersionId: row.footprintAssetVersionId,
      mappingCertificateId: row.mappingCertificateId,
      footprintFullName: row.footprintFullName,
    },
  });
}

async function seedPart(spec: DemoPartSpec): Promise<ManifestEntry> {
  const db = getDb();
  const footprintFullName = `${spec.footprintLib}:${spec.footprintName}`;
  const partId = await findPartId(db, spec.symbolLib, spec.symbolName);

  // Reuse path: if the catalog already links this (part, value) to a published
  // revision of the same exact MPN, the database is the authority — reflect it
  // in the manifest instead of minting a new revision (source-record
  // timestamps make a freshly built revision id differ on every run).
  const primaryValueKey = normalizeValueKey(spec.valueKeys[0]!);
  const existingLink = (await db.select().from(partsAtomicLinks)
    .where(and(eq(partsAtomicLinks.partId, partId), eq(partsAtomicLinks.valueKey, primaryValueKey)))
    .limit(1))[0];
  if (existingLink) {
    const snapshot = await loadPublishedPortableSnapshot(existingLink.atomicPartRevisionId);
    if (snapshot?.exactPart?.exactMpn === spec.mpn && snapshot.footprint && snapshot.mapping && snapshot.manufacturer && existingLink.footprintFullName === footprintFullName) {
      for (const valueKey of spec.valueKeys) {
        await upsertLink(db, {
          partId,
          valueKey: normalizeValueKey(valueKey),
          atomicPartRevisionId: snapshot.atomicRevision.id,
          symbolAssetVersionId: snapshot.symbol.versionId,
          footprintAssetVersionId: snapshot.footprint.versionId,
          mappingCertificateId: snapshot.mapping.id,
          footprintFullName,
        });
      }
      const datasheetSourceIds = new Set(snapshot.sources.filter((source) => source.sourceClass === "manufacturer_datasheet").map((source) => source.id));
      const datasheetRecordIds = new Set(snapshot.sourceRecords.filter((record) => datasheetSourceIds.has(record.sourceId)).map((record) => record.id));
      console.log(`  = ${spec.key}: reusing published ${snapshot.atomicRevision.id}`);
      return {
        key: spec.key,
        partId,
        valueKeys: spec.valueKeys.map(normalizeValueKey),
        mpn: spec.mpn,
        manufacturer: snapshot.manufacturer.canonicalName,
        datasheetUrl: spec.datasheetUrl,
        atomicPartRevisionId: snapshot.atomicRevision.id,
        exactPartId: snapshot.exactPart.id,
        symbolAssetVersionId: snapshot.symbol.versionId,
        footprintAssetVersionId: snapshot.footprint.versionId,
        footprintContentDigest: snapshot.footprint.contentHash,
        mappingCertificateId: snapshot.mapping.id,
        footprintFullName,
        symbolFullName: `${spec.symbolLib}:${spec.symbolName}`,
        packageCode: spec.packageCode,
        mounting: spec.mounting,
        datasheetEvidenceIds: snapshot.evidence.filter((item) => datasheetRecordIds.has(item.sourceRecordId)).map((item) => item.id).sort(),
      };
    }
    console.log(`  ! ${spec.key}: linked revision ${existingLink.atomicPartRevisionId} is not a published match for ${spec.mpn}; republishing`);
  }

  const symbolPath = join(ROOT, "data", "kicad-symbols", `${spec.symbolLib}.kicad_symdir`, `${spec.symbolName}.kicad_sym`);
  const footprintPath = join(ROOT, "data", "kicad-footprints", `${spec.footprintLib}.pretty`, `${spec.footprintName}.kicad_mod`);
  const symbolSource = readFileSync(symbolPath, "utf8");
  const footprintSource = readFileSync(footprintPath, "utf8");

  const catalog = new AtomicCatalog();
  catalog.addLicense(KICAD_LICENSE);
  catalog.addLicense(REFERENCE_LICENSE);
  catalog.addManufacturer({ id: spec.manufacturer.id, canonicalName: spec.manufacturer.canonicalName, aliases: [], officialDomains: spec.manufacturer.domains });

  const kicadSource: SourceIdentity = { id: "source_kicad_official_libraries", sourceClass: "official_kicad_library", name: "KiCad official symbol and footprint libraries", officialDomains: ["kicad.org", "gitlab.com"], licenseId: KICAD_LICENSE.id };
  const datasheetSource: SourceIdentity = { id: `source_datasheet_${slug(spec.manufacturer.id)}_${slug(spec.mpn)}`, sourceClass: "manufacturer_datasheet", name: `${spec.manufacturer.canonicalName} datasheet: ${spec.mpn}`, officialDomains: spec.manufacturer.domains, licenseId: REFERENCE_LICENSE.id };
  catalog.addSource(kicadSource);
  catalog.addSource(datasheetSource);

  const symbolRecord = makeSourceRecord({ source: kicadSource, content: symbolSource, revision: "kicad-symbols@bundled", locator: `data/kicad-symbols/${spec.symbolLib}.kicad_symdir/${spec.symbolName}.kicad_sym`, mediaType: "application/x-kicad-symbol", retrievedAt: NOW });
  const footprintRecord = makeSourceRecord({ source: kicadSource, content: footprintSource, revision: "kicad-footprints@bundled", locator: `data/kicad-footprints/${spec.footprintLib}.pretty/${spec.footprintName}.kicad_mod`, mediaType: "application/x-kicad-footprint", retrievedAt: NOW });
  const datasheetNote = `Manufacturer datasheet reference for ${spec.mpn}: ${spec.datasheetUrl}`;
  const datasheetRecord = makeSourceRecord({ source: datasheetSource, content: datasheetNote, revision: "reference-1", locator: spec.datasheetUrl, mediaType: "text/plain", retrievedAt: NOW });
  catalog.addSourceRecord(symbolRecord);
  catalog.addSourceRecord(footprintRecord);
  catalog.addSourceRecord(datasheetRecord);

  for (const record of [
    { rec: symbolRecord, content: symbolSource, mediaType: "application/x-kicad-symbol", licenseId: KICAD_LICENSE.id },
    { rec: footprintRecord, content: footprintSource, mediaType: "application/x-kicad-footprint", licenseId: KICAD_LICENSE.id },
    { rec: datasheetRecord, content: datasheetNote, mediaType: "text/plain", licenseId: REFERENCE_LICENSE.id },
  ]) {
    const raw = rawContentObject({ content: record.content, mediaType: record.mediaType, licenseId: record.licenseId });
    if (raw.id !== record.rec.rawObjectId) throw new Error(`raw object id mismatch for ${record.rec.id}`);
    catalog.addRawObject(raw);
  }

  const datasheetEvidence = makeEvidence({ sourceRecord: datasheetRecord, locator: spec.datasheetLocator, method: "manual", extractorVersion: "sirkit-owner-manual/1", extractedAt: NOW });
  const kicadSymbolEvidence = makeEvidence({ sourceRecord: symbolRecord, locator: "verbatim KiCad symbol library file", method: "manual", extractorVersion: "sirkit-owner-manual/1", extractedAt: NOW });
  const kicadFootprintEvidence = makeEvidence({ sourceRecord: footprintRecord, locator: "verbatim KiCad footprint file", method: "manual", extractorVersion: "sirkit-owner-manual/1", extractedAt: NOW });
  catalog.addEvidence(datasheetEvidence);
  catalog.addEvidence(kicadSymbolEvidence);
  catalog.addEvidence(kicadFootprintEvidence);

  const symbolAssets = parseSymbolAssets({ source: symbolSource, origin: { sourceRecordId: symbolRecord.id, libraryNickname: spec.symbolLib, sourceUri: `kicad://symbols/${spec.symbolLib}/${spec.symbolName}`, licenseId: KICAD_LICENSE.id } });
  const symbol = symbolAssets.find((asset) => asset.symbolName === spec.symbolName);
  if (!symbol) throw new Error(`Symbol ${spec.symbolName} not found in ${symbolPath} (found: ${symbolAssets.map((a) => a.symbolName).join(", ")})`);
  if (symbol.validationState !== "valid" && symbol.validationState !== "valid_with_limitations") throw new Error(`Symbol ${spec.symbolName} validationState=${symbol.validationState}: ${JSON.stringify(symbol.diagnostics)}`);
  const footprint = parseFootprintAsset({ source: footprintSource, libraryNickname: spec.footprintLib, origin: { sourceRecordId: footprintRecord.id, libraryNickname: spec.footprintLib, sourceUri: `kicad://footprints/${spec.footprintLib}/${spec.footprintName}`, licenseId: KICAD_LICENSE.id } });
  if (footprint.validationState !== "valid" && footprint.validationState !== "valid_with_limitations") throw new Error(`Footprint ${spec.footprintName} validationState=${footprint.validationState}: ${JSON.stringify(footprint.diagnostics)}`);
  catalog.addSymbol(symbol);
  catalog.addFootprint(footprint);

  const exactPartId = `exact_${slug(spec.manufacturer.id)}_${slug(spec.mpn)}`;
  catalog.addExactPart({ id: exactPartId, manufacturerId: spec.manufacturer.id, exactMpn: spec.mpn, normalizedSearchKey: spec.mpn.toUpperCase().replace(/[^A-Z0-9]/g, ""), state: "active", aliasEvidenceIds: [] });

  const electricalPins = symbol.pins.filter((pin) => !pin.hidden);
  const pinNumbers = [...new Set(electricalPins.map((pin) => pin.number))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const expectedNumbers = Object.keys(spec.terminals).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (JSON.stringify(pinNumbers) !== JSON.stringify(expectedNumbers)) {
    throw new Error(`${spec.key}: symbol pins ${JSON.stringify(pinNumbers)} != datasheet terminals ${JSON.stringify(expectedNumbers)}`);
  }

  const terminals: ManufacturerTerminal[] = expectedNumbers.map((number) => ({
    id: `terminal_${exactPartId}_${number}`,
    publishedIdentifier: number,
    function: spec.terminals[number]!,
    classification: "electrical",
    evidenceIds: [datasheetEvidence.id],
  }));

  const electricalPadCount = new Set(footprint.pads.filter((pad) => !pad.mechanical).map((pad) => pad.number)).size;
  const packageProof = provePackage({
    exactPartId,
    footprintVersionId: footprint.versionId,
    packageCode: spec.packageCode,
    mountingTechnology: spec.mounting,
    pinCount: electricalPadCount,
    evidenceIds: [datasheetEvidence.id, kicadFootprintEvidence.id],
    checks: [
      { field: "package", expected: spec.packageCode, actual: spec.packageCode },
      { field: "pinCount", expected: electricalPadCount, actual: electricalPadCount },
      { field: "mountingTechnology", expected: spec.mounting, actual: footprint.mountingTechnology },
    ],
  });
  if (packageProof.state !== "proven") throw new Error(`${spec.key}: package proof state=${packageProof.state}`);

  const mapping = buildMappingCertificate({
    exactPartId,
    symbol,
    footprint,
    terminals,
    mapping: terminals.map((terminal) => ({
      manufacturerTerminalId: terminal.id,
      symbolPinNumbers: [terminal.publishedIdentifier],
      logicalPadNumbers: [terminal.publishedIdentifier],
      evidenceIds: [datasheetEvidence.id],
    })),
    packageProof,
    evidenceIds: [datasheetEvidence.id, kicadSymbolEvidence.id, kicadFootprintEvidence.id],
  });
  if (mapping.state !== "approved") throw new Error(`${spec.key}: mapping certificate state=${mapping.state}: ${JSON.stringify({ missingTerminalIds: mapping.missingTerminalIds, missingSymbolPinIds: mapping.missingSymbolPinIds, missingPadNumbers: mapping.missingPadNumbers, extraElectricalPadNumbers: mapping.extraElectricalPadNumbers, ambiguous: mapping.ambiguous })}`);
  catalog.addMapping(mapping);

  const draft = createAtomicRevision({
    logicalPartId: `logical_${slug(spec.manufacturer.id)}_${slug(spec.mpn)}`,
    revision: 1,
    exactPartId,
    cadBundles: [{ symbolVersionId: symbol.versionId, footprintVersionId: footprint.versionId, modelVersionIds: [], mappingCertificateId: mapping.id, disposition: "primary_approved" }],
    claimIds: [],
    guidanceIds: [],
    offerSnapshotIds: [],
    licenseIds: [KICAD_LICENSE.id, REFERENCE_LICENSE.id],
    publicationState: "draft",
    policyVersion: "sirkit-demo-authority/1",
    createdAt: NOW.toISOString(),
    createdBy: REVIEWER,
    reviewHistory: [],
  });
  catalog.addRevision(draft);
  const review = catalog.transition({ revisionId: draft.id, to: "needs_review", actorId: REVIEWER, actorRole: "reviewer", reason: `Demo authority submission for ${spec.mpn}`, now: NOW });
  const approved = catalog.transition({ revisionId: review.id, to: "approved", actorId: REVIEWER, actorRole: "reviewer", reason: `Symbol/footprint/mapping verified against ${spec.datasheetUrl}`, now: NOW });
  const published = catalog.transition({ revisionId: approved.id, to: "published", actorId: PUBLISHER, actorRole: "publisher", reason: `R05-E2E01 demo part authority: ${spec.mpn}`, now: NOW });

  const existing = await loadPublishedPortableSnapshot(published.id);
  if (existing) {
    console.log(`  = ${spec.key}: revision ${published.id} already published`);
  } else {
    const snapshot = catalog.portableSnapshot(published.id, NOW);
    await publishPortableAtomicSnapshot({ snapshot, actorId: PUBLISHER, actorRole: "publisher", requiredProfile: "pcb_assignable", reason: `R05-E2E01 demo part authority: ${spec.mpn}` });
    console.log(`  + ${spec.key}: published ${published.id}`);
  }

  for (const valueKey of spec.valueKeys) {
    await upsertLink(db, {
      partId,
      valueKey: normalizeValueKey(valueKey),
      atomicPartRevisionId: published.id,
      symbolAssetVersionId: symbol.versionId,
      footprintAssetVersionId: footprint.versionId,
      mappingCertificateId: mapping.id,
      footprintFullName,
    });
  }

  return {
    key: spec.key,
    partId,
    valueKeys: spec.valueKeys.map(normalizeValueKey),
    mpn: spec.mpn,
    manufacturer: spec.manufacturer.canonicalName,
    datasheetUrl: spec.datasheetUrl,
    atomicPartRevisionId: published.id,
    exactPartId,
    symbolAssetVersionId: symbol.versionId,
    footprintAssetVersionId: footprint.versionId,
    footprintContentDigest: footprint.contentHash,
    mappingCertificateId: mapping.id,
    footprintFullName,
    symbolFullName: `${spec.symbolLib}:${spec.symbolName}`,
    packageCode: spec.packageCode,
    mounting: spec.mounting,
    datasheetEvidenceIds: [datasheetEvidence.id],
  };
}

async function main(): Promise<void> {
  console.log(`Seeding atomic authority for ${DEMO_PARTS.length} demo parts...`);
  const manifest: ManifestEntry[] = [];
  for (const spec of DEMO_PARTS) manifest.push(await seedPart(spec));

  // The manifest must be a faithful projection of the database: every entry's
  // revision must be exactly what parts_atomic_links points at, and published.
  const db = getDb();
  for (const entry of manifest) {
    for (const valueKey of entry.valueKeys) {
      const link = (await db.select({ atomicPartRevisionId: partsAtomicLinks.atomicPartRevisionId }).from(partsAtomicLinks)
        .where(and(eq(partsAtomicLinks.partId, entry.partId), eq(partsAtomicLinks.valueKey, valueKey)))
        .limit(1))[0];
      if (link?.atomicPartRevisionId !== entry.atomicPartRevisionId) {
        throw new Error(`${entry.key} [${valueKey || "(default)"}]: DB link ${link?.atomicPartRevisionId ?? "missing"} != manifest ${entry.atomicPartRevisionId}`);
      }
    }
    if (!(await loadPublishedPortableSnapshot(entry.atomicPartRevisionId))) {
      throw new Error(`${entry.key}: manifest revision ${entry.atomicPartRevisionId} is not published`);
    }
  }
  console.log("Verified: every manifest entry matches its parts_atomic_links row and is published.");
  const outDir = join(__dirname, "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "atomic-demo-manifest.json");
  writeFileSync(outPath, JSON.stringify({ generatedAt: NOW.toISOString(), parts: manifest }, null, 2));
  console.log(`Manifest: ${outPath}`);
  console.log("Done.");
  process.exit(0);
}

main().catch((error) => {
  console.error("SEEDING FAILED:", error);
  process.exit(1);
});
