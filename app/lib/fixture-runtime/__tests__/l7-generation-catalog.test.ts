/**
 * [PR-L6, 2026-10-19] Runbook L.7 items 9 and 10 (OD-253 (1), (4)): the generation proofs' PUBLISHED fixture parts
 * (`generationFixtureParts()` in app/lib/fixture-runtime/blinker/catalog.ts) and their committed KiCad sources.
 *
 *  1. each part's symbol parses `valid` and its footprint is neither invalid nor unsupported (the production parsers); the mapping
 *     certificate is approved, the package is proven, the revision was submitted and approved by a reviewer and published by a DIFFERENT
 *     publisher, its portable snapshot passes the publication transaction's own validation for `pcb_assignable`, and the catalog part's
 *     link resolves to that published identity (`publishedAtomicIdentity`, what the page stamps on an instance);
 *  2. every committed KiCad file is byte-for-byte the upstream git blob its LICENSES.md row names (the blob sha1 is recomputed);
 *  3. the one pre-composed library is exactly what the production composer makes of its two upstream blobs (a test-only import:
 *     the catalog module may not import the composer);
 *  4. `blinkerCatalog()` - the deterministic acceptance catalog - keeps its pinned revision and snapshot ids;
 *  5. the M1 / M2 premises: the published "diode"-class parts of the fixture runtime's catalog are exactly the 1N4148W, and the new SS14
 *     classifies as a Schottky diode.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLINKER_PART_IDS, FIXTURE_RESOLUTION_PART_IDS, GENERATION_FIXTURE_PART_IDS, GENERATION_PART_SOURCES, blinkerCatalog, fixtureRuntimeCatalog, generationFixtureParts } from "@/app/lib/fixture-runtime/blinker/catalog";
import { parseFootprintAsset, parseSymbolAssets } from "@/app/lib/atomic/kicad-assets";
import { validatePortableSnapshotForPublication } from "@/app/lib/atomic/server-repository";
import { composeSymbolLibrary, topLevelSymbolBlocks } from "@/app/lib/acquisition/kicad-library-compose";
import { functionalClassOf } from "@/app/lib/component-resolution/pin-functions";
import { publishedAtomicIdentity } from "@/lib/build-auto-layout";

const DIR = join(process.cwd(), "app", "lib", "fixture-runtime", "generation-kicad");
const bytesOf = (file: string): Buffer => Buffer.from(readFileSync(join(DIR, file), "utf8").replace(/\r\n/g, "\n"), "utf8");
const blobId = (bytes: Buffer): string => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, "utf8"), bytes])).digest("hex");
const ORIGIN = { sourceRecordId: "record_test", libraryNickname: "Test", sourceUri: "kicad-libraries://test", licenseId: "license_test" };

/** The LICENSES.md table rows: `| \`file\` | \`upstream path\` | \`blob\` |` (the composed library's inputs: `| parent | ... |`). */
function licenseRows(): Array<{ file: string; upstream: string; blob: string }> {
  const text = readFileSync(join(DIR, "LICENSES.md"), "utf8").replace(/\r\n/g, "\n");
  return [...text.matchAll(/^\| `?([^`|]+?)`? \| `([^`]+)` \| `([0-9a-f]{40})` \|$/gm)].map((match) => ({ file: match[1]!, upstream: match[2]!, blob: match[3]! }));
}

describe("[PR-L6 L.7] 1. every generation fixture part is a published exact part built by the production machinery", () => {
  it("valid symbol, accepted footprint, approved mapping, proven package, reviewer then a different publisher, a snapshot the publication transaction accepts, and a link the page resolves", () => {
    const built = generationFixtureParts();
    expect([...built.cachedParts.keys()].sort()).toEqual(Object.values(GENERATION_FIXTURE_PART_IDS).sort());
    for (const source of GENERATION_PART_SOURCES) {
      const symbolSource = readFileSync(join(DIR, source.symbolFile), "utf8").replace(/\r\n/g, "\n");
      const symbol = parseSymbolAssets({ source: symbolSource, origin: ORIGIN }).find((asset) => asset.symbolName === source.symbolName);
      expect(symbol?.validationState, source.mpn).toBe("valid");
      const footprint = parseFootprintAsset({ source: readFileSync(join(DIR, source.footprintFile), "utf8").replace(/\r\n/g, "\n"), libraryNickname: source.footprintLibrary, origin: ORIGIN });
      expect(["invalid", "unsupported"], source.mpn).not.toContain(footprint.validationState);
      const entry = built.revisions.get(source.partId)!;
      expect(entry.mapping.state, source.mpn).toBe("approved");
      expect(entry.packageProof.state, source.mpn).toBe("proven");
      expect(entry.mapping.packageProofId, source.mpn).toBe(entry.packageProof.id);
      expect(entry.packageProof.pinCount, source.mpn).toBe(footprint.pads.filter((pad) => !pad.mechanical).length);
      expect(entry.symbol.pins.length, source.mpn).toBe(entry.packageProof.pinCount); // every symbol pin a terminal, NC included
      const snapshot = built.snapshots.get(entry.revisionId)!;
      expect(snapshot.atomicRevision.publicationState).toBe("published");
      expect(snapshot.atomicRevision.reviewHistory.map((event) => [event.action, event.actorId])).toEqual([["submit", "user:fixture-reviewer"], ["approve", "user:fixture-reviewer"], ["publish", "user:fixture-publisher"]]);
      expect(snapshot.exactPart?.exactMpn).toBe(source.mpn);
      expect(snapshot.evidence.every((evidence) => evidence.locator.includes("NOT manufacturer datasheets"))).toBe(true);
      expect(snapshot.sourceRecords.filter((record) => record.locator.startsWith("fixture://")).map((record) => record.locator)).toEqual([expect.stringMatching(/^fixture:\/\/l7\//)]);
      expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable"), source.mpn).not.toThrow();
      // the catalog part: its one link is the published revision, resolved for the value the designs use
      const part = fixtureRuntimeCatalog().cachedParts.get(source.partId)!;
      const value = source.valueKey === "" ? source.name : "10k";
      expect(publishedAtomicIdentity(part, value), `${source.mpn} at ${value}`).toEqual({ atomicPartRevisionId: entry.revisionId, symbolAssetVersionId: entry.mapping.symbolVersionId, footprintAssetVersionId: entry.mapping.footprintVersionId, mappingCertificateId: entry.mapping.id });
      expect(fixtureRuntimeCatalog().snapshots.get(entry.revisionId)).toBe(snapshot);
      expect(part.pins.map((pin) => pin.number)).toEqual(entry.symbol.pins.map((pin) => pin.number));
    }
    // the potentiometer is value-specific: only its 10k value is orderable
    expect(publishedAtomicIdentity(fixtureRuntimeCatalog().cachedParts.get(GENERATION_FIXTURE_PART_IDS.potentiometer), "100k")).toBeNull();
  });
});

describe("[PR-L6 L.7] 2. the committed KiCad files are the upstream blobs LICENSES.md names", () => {
  it("each file's git blob sha1 equals its row; every committed KiCad file has a row", () => {
    const rows = licenseRows();
    const committed = readdirSync(DIR).filter((file) => file.endsWith(".kicad_sym") || file.endsWith(".kicad_mod")).sort();
    const composed = "MCU_Microchip_ATmega_ATmega328P-A.kicad_sym";
    expect(rows.filter((row) => committed.includes(row.file)).map((row) => row.file).sort()).toEqual(committed.filter((file) => file !== composed));
    for (const row of rows.filter((entry) => committed.includes(entry.file))) expect(blobId(bytesOf(row.file)), row.file).toBe(row.blob);
    expect(rows.filter((row) => !committed.includes(row.file)).map((row) => row.upstream)).toEqual([
      "kicad-symbols/MCU_Microchip_ATmega.kicad_symdir/ATmega48PV-10A.kicad_sym",
      "kicad-symbols/MCU_Microchip_ATmega.kicad_symdir/ATmega328P-A.kicad_sym",
    ]);
    for (const source of GENERATION_PART_SOURCES) for (const file of [source.symbolFile, source.footprintFile]) expect(committed, file).toContain(file);
  });
});

describe("[PR-L6 L.7] 3. the pre-composed ATmega library is the production composer's output over its two upstream blobs", () => {
  it("splitting it gives back the two upstream files (their blob ids), and composing those gives back the committed bytes", () => {
    const composedText = bytesOf("MCU_Microchip_ATmega_ATmega328P-A.kicad_sym").toString("utf8");
    const library = topLevelSymbolBlocks(composedText)!;
    expect(library.blocks.map((block) => [block.name, block.extendsName])).toEqual([["ATmega48PV-10A", null], ["ATmega328P-A", "ATmega48PV-10A"]]);
    const parentFile = `${library.header}${library.blocks[0]!.raw}${library.footer}`;
    const childFile = `${library.header}${library.blocks[1]!.raw}${library.footer}`;
    const rows = new Map(licenseRows().map((row) => [row.upstream, row.blob] as const));
    expect(blobId(Buffer.from(parentFile, "utf8"))).toBe(rows.get("kicad-symbols/MCU_Microchip_ATmega.kicad_symdir/ATmega48PV-10A.kicad_sym"));
    expect(blobId(Buffer.from(childFile, "utf8"))).toBe(rows.get("kicad-symbols/MCU_Microchip_ATmega.kicad_symdir/ATmega328P-A.kicad_sym"));
    expect(composeSymbolLibrary(childFile, "ATmega328P-A", new Map([["ATmega48PV-10A", parentFile]]))).toEqual({ ok: true, text: composedText, composed: true });
  });
});

describe("[PR-L6 L.7] 4. the blinker acceptance catalog is unchanged", () => {
  it("its revision ids and snapshot ids are the pinned ones (the prompt-to-Gerber replay and the acceptance suites read them)", () => {
    const blinker = blinkerCatalog();
    expect([...blinker.parts.values()].map((part) => [part.partId, Object.fromEntries(Object.entries(part.revisions).map(([key, entry]) => [key, entry.revisionId]))])).toEqual([
      [BLINKER_PART_IDS.timer, { "": "atomic_7d6e4accfa2d91705e24da2ef5a46724e6ebaf8453aa85fd1415de15ad0e78da" }],
      [BLINKER_PART_IDS.resistor, { "330": "atomic_570435764b9de4169d7519ef3d4ae820750eaaa693dda8f626471ea912cf556a", "10k": "atomic_39f34356ac49aaf5942f05bbb4a2d396dfad878fb33e1d45cb3209efcafc962f", "56k": "atomic_8c9039902f87281f33b2db250a3d1b5a5633aa5d468326707d06a9b6d4722b04" }],
      [BLINKER_PART_IDS.capacitor, { "10u": "atomic_38660f72f1eda8c93b325323cbd38079573aff66f8a8c1df677cb562f0509582", "100n": "atomic_d466057118f1a7dd01eccce7f216586fd37b78c2b51bbc34fc1f746334d056dc", "10n": "atomic_948e666999b221cf30946679cafd526083cdeaa265e75469867c28ae6b17f65d" }],
      [BLINKER_PART_IDS.led, { "": "atomic_e7bf2d52fd37ee5be68b2d90f1e8ecd352bd357cc6a4af42e0c4a308a00f10b4" }],
      [BLINKER_PART_IDS.header, { "": "atomic_b9cf71b5db2f9fe7534d7e7e3fed0403febf7432ac60102a76f6eee465815307" }],
    ]);
    expect([...blinker.snapshots.keys()]).toEqual([
      "atomic_7d6e4accfa2d91705e24da2ef5a46724e6ebaf8453aa85fd1415de15ad0e78da", "atomic_39f34356ac49aaf5942f05bbb4a2d396dfad878fb33e1d45cb3209efcafc962f",
      "atomic_8c9039902f87281f33b2db250a3d1b5a5633aa5d468326707d06a9b6d4722b04", "atomic_570435764b9de4169d7519ef3d4ae820750eaaa693dda8f626471ea912cf556a",
      "atomic_38660f72f1eda8c93b325323cbd38079573aff66f8a8c1df677cb562f0509582", "atomic_d466057118f1a7dd01eccce7f216586fd37b78c2b51bbc34fc1f746334d056dc",
      "atomic_948e666999b221cf30946679cafd526083cdeaa265e75469867c28ae6b17f65d", "atomic_e7bf2d52fd37ee5be68b2d90f1e8ecd352bd357cc6a4af42e0c4a308a00f10b4",
      "atomic_b9cf71b5db2f9fe7534d7e7e3fed0403febf7432ac60102a76f6eee465815307",
    ]);
    expect(blinker.cachedParts.size).toBe(5); // the generation parts live only in the runtime container's catalog
    for (const id of Object.values(GENERATION_FIXTURE_PART_IDS)) expect(blinker.cachedParts.has(id)).toBe(false);
  });
});

describe("[PR-L6 L.7] 5. the M1 / M2 premises hold with the new parts", () => {
  it("the only PUBLISHED diode-class part is the 1N4148W; the SS14 is a Schottky diode", () => {
    const published = [...fixtureRuntimeCatalog().cachedParts.values()].filter((part) => Object.keys(part.atomicAssignments ?? {}).length > 0);
    const diodes = published.filter((part) => functionalClassOf({ libraryName: part.libraryName, name: part.name, description: part.description, properties: part.properties }).functionalClass === "diode");
    expect(diodes.map((part) => part.id)).toEqual([FIXTURE_RESOLUTION_PART_IDS.eligibleDiode]);
    const ss14 = fixtureRuntimeCatalog().cachedParts.get(GENERATION_FIXTURE_PART_IDS.schottky)!;
    expect(functionalClassOf({ libraryName: ss14.libraryName, name: ss14.name, description: ss14.description, properties: ss14.properties }).functionalClass).toBe("schottky-diode");
    expect(ss14.description).toMatch(/Schottky/);
  });
});
