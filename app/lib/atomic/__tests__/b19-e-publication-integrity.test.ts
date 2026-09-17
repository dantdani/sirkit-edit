/**
 * [B19-E E3] Exact-revision integrity at the publication boundary and in the catalog's state machine — no database.
 *
 * Reproduced before the fix (recorded in the E3 report):
 *  - `validatePortableSnapshotForPublication` checked only `publicationState`: a revision with an empty review history, one
 *    person approving and publishing, an LLM or agent approver or publisher, or a forged id / semanticHash all published;
 *  - `publishPortableAtomicSnapshot` typed `actorRole` but never checked it, and never compared its `actorId` with the
 *    publish event's actor (both reached the database);
 *  - `AtomicCatalog.transition` let an `agent:` / `llm:` / `ocr:` actor deprecate, revoke or supersede, missed a padded
 *    ` llm:` id for approval, and let one person approve and then publish (admin included, OD-37).
 *
 * The durable collision, withdrawal and loader behaviour is proven against PGlite in the two sibling suites.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db/client", () => ({ getDb: vi.fn(() => { throw new Error("B19E_DB_TOUCHED"); }) }));

import { getDb } from "@/app/lib/db/client";
import { AtomicCatalog, createAtomicRevision, roleMayTransition, TRANSITIONS } from "../catalog";
import { makeEvidence, makeSourceRecord } from "../ingestion";
import { parseFootprintAsset, parseSymbolAssets, rawContentObject } from "../kicad-assets";
import { buildMappingCertificate, provePackage } from "../mapping";
import { publishPortableAtomicSnapshot, validatePortableSnapshotForPublication } from "../server-repository";
import { catalogStatusOf, revisionStatusFromEvents } from "../revision-status";
import type { AtomicPartRevision, LicenseRecord, ManufacturerTerminal, PortableAtomicSnapshot, ReviewEvent, SourceIdentity } from "../types";
import { makeFixtureCatalog, TEST_NOW } from "./fixtures";

const PUBLISHER = { actorId: "user:fixture-publisher", actorRole: "publisher" as const };

async function blinkerTimerSnapshot(): Promise<PortableAtomicSnapshot> {
  const { blinkerCatalog, BLINKER_PART_IDS } = await import("@/app/lib/fixture-runtime/blinker/catalog");
  const catalog = blinkerCatalog();
  return structuredClone(catalog.snapshots.get(catalog.revisionFor(BLINKER_PART_IDS.timer, "NE555")!)!);
}

/** The same revision re-issued through `createAtomicRevision`, so its id and semanticHash are consistent with the patch. */
function reissue(revision: AtomicPartRevision, patch: Partial<AtomicPartRevision>): AtomicPartRevision {
  const { id: _id, semanticHash: _hash, validatorVersion: _validator, schemaVersion: _schema, ...rest } = structuredClone(revision);
  void _id; void _hash; void _validator; void _schema;
  return structuredClone(createAtomicRevision({ ...rest, ...patch }));
}

function withHistory(snapshot: PortableAtomicSnapshot, edit: (history: ReviewEvent[]) => ReviewEvent[]): PortableAtomicSnapshot {
  const next = structuredClone(snapshot);
  next.atomicRevision = reissue(snapshot.atomicRevision, { reviewHistory: edit(structuredClone(snapshot.atomicRevision.reviewHistory)) });
  return next;
}

const setActor = (history: ReviewEvent[], action: ReviewEvent["action"], actorId: string): ReviewEvent[] =>
  history.map((event) => (event.action === action ? { ...event, actorId } : event));

describe("[B19-E E3 a] publication validation re-derives the revision and requires two different humans", () => {
  it("a real blinker snapshot published by its publisher passes, as publisher or admin (baseline)", async () => {
    const snapshot = await blinkerTimerSnapshot();
    expect(snapshot.atomicRevision.reviewHistory.map((event) => [event.action, event.actorId])).toEqual([
      ["submit", "user:fixture-reviewer"], ["approve", "user:fixture-reviewer"], ["publish", "user:fixture-publisher"],
    ]);
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable", PUBLISHER)).not.toThrow();
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable", { ...PUBLISHER, actorRole: "admin" })).not.toThrow();
  });

  it("every published revision of the blinker fixture catalog still publishes", async () => {
    const { blinkerCatalog } = await import("@/app/lib/fixture-runtime/blinker/catalog");
    const snapshots = [...blinkerCatalog().snapshots.values()];
    expect(snapshots.length).toBe(9);
    for (const snapshot of snapshots) expect(() => validatePortableSnapshotForPublication(structuredClone(snapshot), "pcb_assignable", PUBLISHER), snapshot.atomicRevision.id).not.toThrow();
  });

  it("an empty review history is refused", async () => {
    const snapshot = withHistory(await blinkerTimerSnapshot(), () => []);
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable")).toThrow(/review history/);
  });

  it("a history with a publish event but no approval is refused", async () => {
    const snapshot = withHistory(await blinkerTimerSnapshot(), (history) => history.filter((event) => event.action !== "approve"));
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable", PUBLISHER)).toThrow(/approv/);
  });

  it("a history whose last event is not the publication is refused", async () => {
    const snapshot = withHistory(await blinkerTimerSnapshot(), (history) => history.filter((event) => event.action !== "publish"));
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable")).toThrow(/publish/);
  });

  it("the same person approving and publishing is refused (admin included, OD-37)", async () => {
    const snapshot = withHistory(await blinkerTimerSnapshot(), (history) => setActor(history, "publish", "user:fixture-reviewer"));
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable", { actorId: "user:fixture-reviewer", actorRole: "admin" })).toThrow(/different/);
    const padded = withHistory(await blinkerTimerSnapshot(), (history) => setActor(history, "publish", " user:fixture-reviewer"));
    expect(() => validatePortableSnapshotForPublication(padded, "pcb_assignable")).toThrow(/different|human/);
  });

  it("[review] an earlier approval by someone else does not stand in for the approval being published (approve, send back, approve again)", async () => {
    const base = await blinkerTimerSnapshot();
    const [submit, approve, publishEvent] = base.atomicRevision.reviewHistory;
    // R approves, sends the revision back to draft, it is resubmitted, the final approver approves, and the publisher publishes
    const cycle = (finalApprover: string): ReviewEvent[] => [
      { ...submit!, id: "review_b19e_submit_1" },
      { ...approve!, id: "review_b19e_approve_1", actorId: "user:fixture-reviewer" },
      { ...approve!, id: "review_b19e_reject_1", action: "reject", fromState: "approved", toState: "draft", reason: "sent back" },
      { ...submit!, id: "review_b19e_submit_2", actorId: finalApprover },
      { ...approve!, id: "review_b19e_approve_2", actorId: finalApprover },
      { ...publishEvent! },
    ];
    const selfPublished = withHistory(base, () => cycle(PUBLISHER.actorId));
    expect(selfPublished.atomicRevision.reviewHistory.filter((event) => event.action === "approve").map((event) => event.actorId)).toEqual(["user:fixture-reviewer", PUBLISHER.actorId]);
    expect(() => validatePortableSnapshotForPublication(selfPublished, "pcb_assignable", PUBLISHER)).toThrow(/different/);
    // control: the same cycle with a second human as the final approver publishes
    expect(() => validatePortableSnapshotForPublication(withHistory(base, () => cycle("user:second-reviewer")), "pcb_assignable", PUBLISHER)).not.toThrow();
  });

  it.each([
    ["an LLM approver", "approve", "llm:extractor"],
    ["an agent approver", "approve", "agent:designer"],
    ["an OCR approver", "approve", "ocr:worker"],
    ["an agent publisher", "publish", "agent:designer"],
    ["an LLM publisher in upper case", "publish", "LLM:extractor"],
    ["an agent publisher behind whitespace", "publish", "  agent:designer"],
    ["a blank publisher", "publish", "   "],
  ] as const)("%s is refused", async (_label, action, actorId) => {
    const snapshot = withHistory(await blinkerTimerSnapshot(), (history) => setActor(history, action, actorId));
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable")).toThrow(/human/);
  });

  it("a tampered revision id is refused", async () => {
    const snapshot = await blinkerTimerSnapshot();
    snapshot.atomicRevision = { ...snapshot.atomicRevision, id: `atomic_${"0".repeat(64)}` };
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable", PUBLISHER)).toThrow(/revision id/);
  });

  it("a tampered semanticHash is refused", async () => {
    const snapshot = await blinkerTimerSnapshot();
    snapshot.atomicRevision = { ...snapshot.atomicRevision, semanticHash: "f".repeat(64) };
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable", PUBLISHER)).toThrow(/semanticHash/);
  });

  it("content edited under the original id and semanticHash is refused (the edit is in the hashed body)", async () => {
    const snapshot = await blinkerTimerSnapshot();
    snapshot.atomicRevision = { ...snapshot.atomicRevision, policyVersion: "b19-e-edited-policy/1" };
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable", PUBLISHER)).toThrow(/semanticHash|revision id/);
    const history = await blinkerTimerSnapshot();
    history.atomicRevision = { ...history.atomicRevision, reviewHistory: setActor(history.atomicRevision.reviewHistory, "approve", "user:someone-else") };
    expect(() => validatePortableSnapshotForPublication(history, "pcb_assignable", PUBLISHER)).toThrow(/revision id/);
  });

  it("a publishing actor other than the publish event's actor is refused", async () => {
    const snapshot = await blinkerTimerSnapshot();
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable", { actorId: "user:someone-else", actorRole: "publisher" })).toThrow(/publish event/);
  });

  it.each(["reviewer", "agent", "ingestion_worker", "", "PUBLISHER"])("an actorRole of %j is refused", async (actorRole) => {
    const snapshot = await blinkerTimerSnapshot();
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable", { actorId: PUBLISHER.actorId, actorRole: actorRole as never })).toThrow(/role/);
  });

  it("publishPortableAtomicSnapshot refuses a mismatched actor or a non-publishing role before touching the database", async () => {
    const snapshot = await blinkerTimerSnapshot();
    vi.mocked(getDb).mockClear();
    const base = { snapshot, requiredProfile: "pcb_assignable" as const, reason: "b19-e" };
    await expect(publishPortableAtomicSnapshot({ ...base, actorId: "user:someone-else", actorRole: "publisher" })).rejects.toThrow(/publish event/);
    await expect(publishPortableAtomicSnapshot({ ...base, actorId: PUBLISHER.actorId, actorRole: "reviewer" as never })).rejects.toThrow(/role/);
    await expect(publishPortableAtomicSnapshot({ ...base, actorId: "agent:designer", actorRole: "admin" })).rejects.toThrow(/publish event|human/);
    await expect(publishPortableAtomicSnapshot({ ...base, snapshot: withHistory(snapshot, () => []), actorId: PUBLISHER.actorId, actorRole: "publisher" })).rejects.toThrow(/review history/);
    expect(vi.mocked(getDb)).not.toHaveBeenCalled();
  });
});

describe("[B19-E E3 a] the seed script's snapshots still pass", () => {
  // `scripts/seed-atomic-demo-parts.ts` cannot be imported here: it loads `.env.local` and opens the database at import.
  // Its assembly (lines ~273-393) is replicated over the committed KiCad bytes (its own `data/` library is not committed),
  // and a static tripwire keeps the replica honest about the seed's actors and publication call.
  const SEED = readFileSync(join(process.cwd(), "scripts", "seed-atomic-demo-parts.ts"), "utf8");

  it("the seed approves as its reviewer and publishes as a different publisher, passing that publisher to the transaction", () => {
    const reviewer = /const REVIEWER = "([^"]+)";/.exec(SEED)?.[1];
    const publisher = /const PUBLISHER = "([^"]+)";/.exec(SEED)?.[1];
    expect(reviewer).toBeTruthy();
    expect(publisher).toBeTruthy();
    expect(reviewer).not.toBe(publisher);
    expect(SEED).toMatch(/to: "approved", actorId: REVIEWER, actorRole: "reviewer"/);
    expect(SEED).toMatch(/to: "published", actorId: PUBLISHER, actorRole: "publisher"/);
    expect(SEED).toMatch(/publishPortableAtomicSnapshot\(\{ snapshot, actorId: PUBLISHER, actorRole: "publisher", requiredProfile: "pcb_assignable"/);
  });

  it("a seed-shaped NE555DR revision (manufacturer datasheet evidence, KiCad assets, two-person review) publishes", () => {
    const REVIEWER = "user:sirkit-owner-reviewer", PUBLISHER_ID = "user:sirkit-owner-publisher";
    const KICAD_DIR = join(process.cwd(), "app", "lib", "fixture-runtime", "blinker", "kicad");
    const read = (file: string) => readFileSync(join(KICAD_DIR, file), "utf8").replace(/\r\n/g, "\n");
    const kicadLicense: LicenseRecord = { id: "license_kicad_cc_by_sa_4", spdxId: "CC-BY-SA-4.0", name: "KiCad", rawRedistribution: "redistributable", derivedRedistribution: "redistributable", exportDisposition: "redistributable" };
    const referenceLicense: LicenseRecord = { id: "license_sirkit_datasheet_reference", spdxId: null, name: "Sirkit reference notes", rawRedistribution: "redistributable", derivedRedistribution: "redistributable", exportDisposition: "redistributable" };
    const catalog = new AtomicCatalog();
    catalog.addLicense(kicadLicense);
    catalog.addLicense(referenceLicense);
    catalog.addManufacturer({ id: "manufacturer_ti", canonicalName: "Texas Instruments", aliases: [], officialDomains: ["ti.com"] });
    const kicadSource: SourceIdentity = { id: "source_kicad_official_libraries", sourceClass: "official_kicad_library", name: "KiCad", officialDomains: ["kicad.org"], licenseId: kicadLicense.id };
    const datasheetSource: SourceIdentity = { id: "source_datasheet_manufacturer_ti_ne555dr", sourceClass: "manufacturer_datasheet", name: "TI datasheet: NE555DR", officialDomains: ["ti.com"], licenseId: referenceLicense.id };
    catalog.addSource(kicadSource);
    catalog.addSource(datasheetSource);
    const symbolSource = read("Timer_NE555.kicad_sym"), footprintSource = read("SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod");
    const note = "Manufacturer datasheet reference for NE555DR: https://www.ti.com/lit/ds/symlink/ne555.pdf";
    const symbolRecord = makeSourceRecord({ source: kicadSource, content: symbolSource, revision: "kicad-symbols@bundled", locator: "Timer", mediaType: "application/x-kicad-symbol", retrievedAt: TEST_NOW });
    const footprintRecord = makeSourceRecord({ source: kicadSource, content: footprintSource, revision: "kicad-footprints@bundled", locator: "Package_SO", mediaType: "application/x-kicad-footprint", retrievedAt: TEST_NOW });
    const datasheetRecord = makeSourceRecord({ source: datasheetSource, content: note, revision: "reference-1", locator: "https://www.ti.com/lit/ds/symlink/ne555.pdf", mediaType: "text/plain", retrievedAt: TEST_NOW });
    for (const [record, content, mediaType, licenseId] of [[symbolRecord, symbolSource, "application/x-kicad-symbol", kicadLicense.id], [footprintRecord, footprintSource, "application/x-kicad-footprint", kicadLicense.id], [datasheetRecord, note, "text/plain", referenceLicense.id]] as const) {
      catalog.addSourceRecord(record);
      catalog.addRawObject(rawContentObject({ content, mediaType, licenseId }));
    }
    const datasheetEvidence = makeEvidence({ sourceRecord: datasheetRecord, locator: "NE555 pin configuration, Table 1", method: "manual", extractorVersion: "sirkit-owner-manual/1", extractedAt: TEST_NOW });
    const symbolEvidence = makeEvidence({ sourceRecord: symbolRecord, locator: "verbatim KiCad symbol library file", method: "manual", extractorVersion: "sirkit-owner-manual/1", extractedAt: TEST_NOW });
    const footprintEvidence = makeEvidence({ sourceRecord: footprintRecord, locator: "verbatim KiCad footprint file", method: "manual", extractorVersion: "sirkit-owner-manual/1", extractedAt: TEST_NOW });
    [datasheetEvidence, symbolEvidence, footprintEvidence].forEach((item) => catalog.addEvidence(item));
    const symbol = parseSymbolAssets({ source: symbolSource, origin: { sourceRecordId: symbolRecord.id, libraryNickname: "Timer", sourceUri: "kicad://symbols/Timer/NE555D", licenseId: kicadLicense.id } }).find((asset) => asset.symbolName === "NE555D")!;
    const footprint = parseFootprintAsset({ source: footprintSource, libraryNickname: "Package_SO", origin: { sourceRecordId: footprintRecord.id, libraryNickname: "Package_SO", sourceUri: "kicad://footprints/Package_SO/SOIC-8_3.9x4.9mm_P1.27mm", licenseId: kicadLicense.id } });
    catalog.addSymbol(symbol);
    catalog.addFootprint(footprint);
    const exactPartId = "exact_manufacturer_ti_ne555dr";
    catalog.addExactPart({ id: exactPartId, manufacturerId: "manufacturer_ti", exactMpn: "NE555DR", normalizedSearchKey: "NE555DR", state: "active", aliasEvidenceIds: [] });
    const functions = ["GND", "TRIG", "OUT", "RESET", "CONT", "THRES", "DISCH", "VCC"];
    const terminals: ManufacturerTerminal[] = functions.map((fn, index) => ({ id: `terminal_${exactPartId}_${index + 1}`, publishedIdentifier: String(index + 1), function: fn, classification: "electrical", evidenceIds: [datasheetEvidence.id] }));
    const pads = new Set(footprint.pads.filter((pad) => !pad.mechanical).map((pad) => pad.number)).size;
    const packageProof = provePackage({ exactPartId, footprintVersionId: footprint.versionId, packageCode: "SOIC-8", mountingTechnology: "smd", pinCount: pads, evidenceIds: [datasheetEvidence.id, footprintEvidence.id], checks: [{ field: "package", expected: "SOIC-8", actual: "SOIC-8" }, { field: "pinCount", expected: pads, actual: pads }, { field: "mountingTechnology", expected: "smd", actual: footprint.mountingTechnology }] });
    const mapping = buildMappingCertificate({ exactPartId, symbol, footprint, terminals, mapping: terminals.map((terminal) => ({ manufacturerTerminalId: terminal.id, symbolPinNumbers: [terminal.publishedIdentifier], logicalPadNumbers: [terminal.publishedIdentifier], evidenceIds: [datasheetEvidence.id] })), packageProof, evidenceIds: [datasheetEvidence.id, symbolEvidence.id, footprintEvidence.id] });
    expect(mapping.state).toBe("approved");
    catalog.addMapping(mapping);
    const draft = createAtomicRevision({ logicalPartId: "logical_manufacturer_ti_ne555dr", revision: 1, exactPartId, cadBundles: [{ symbolVersionId: symbol.versionId, footprintVersionId: footprint.versionId, modelVersionIds: [], mappingCertificateId: mapping.id, disposition: "primary_approved" }], claimIds: [], guidanceIds: [], offerSnapshotIds: [], licenseIds: [kicadLicense.id, referenceLicense.id], publicationState: "draft", policyVersion: "sirkit-demo-authority/1", createdAt: TEST_NOW.toISOString(), createdBy: REVIEWER, reviewHistory: [] });
    catalog.addRevision(draft);
    const review = catalog.transition({ revisionId: draft.id, to: "needs_review", actorId: REVIEWER, actorRole: "reviewer", reason: "Demo authority submission for NE555DR", now: TEST_NOW });
    const approved = catalog.transition({ revisionId: review.id, to: "approved", actorId: REVIEWER, actorRole: "reviewer", reason: "verified", now: TEST_NOW });
    const published = catalog.transition({ revisionId: approved.id, to: "published", actorId: PUBLISHER_ID, actorRole: "publisher", reason: "R05-E2E01 demo part authority: NE555DR", now: TEST_NOW });
    const snapshot = catalog.portableSnapshot(published.id, TEST_NOW);
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable", { actorId: PUBLISHER_ID, actorRole: "publisher" })).not.toThrow();
  });
});

describe("[B19-E E3 c] catalog transitions: humans only for authority states, and two different people", () => {
  it("exports the transition table and the role rule", () => {
    expect(TRANSITIONS.published).toEqual(["deprecated", "revoked", "superseded"]);
    expect(TRANSITIONS.revoked).toEqual([]);
    expect(roleMayTransition("publisher", "deprecated")).toBe(true);
    expect(roleMayTransition("reviewer", "published")).toBe(false);
    expect(roleMayTransition("agent", "approved")).toBe(false);
    expect(roleMayTransition("admin", "revoked")).toBe(true);
  });

  it.each(["deprecated", "revoked", "superseded"] as const)("an agent, LLM or OCR actor cannot move a published revision to %s, whatever role it claims", (to) => {
    for (const actorId of ["agent:librarian", "llm:extractor", "ocr:worker", "AGENT:librarian", " llm:extractor"]) {
      for (const actorRole of ["publisher", "admin"] as const) {
        const { catalog, published } = makeFixtureCatalog();
        const before = catalog.revisions.size;
        expect(() => catalog.transition({ revisionId: published.id, to, actorId, actorRole, reason: "withdraw", now: TEST_NOW }), `${actorId} ${actorRole}`).toThrow(/Agents, LLMs, and OCR workers/);
        expect(catalog.revisions.size).toBe(before);
        expect(catalog.isPublished(published.id)).toBe(true);
      }
    }
  });

  it("an automated actor claiming admin cannot approve or publish, including a padded id", () => {
    const { catalog, draft } = makeFixtureCatalog();
    const review = catalog.transition({ revisionId: draft.id, to: "needs_review", actorId: "user:r", actorRole: "reviewer", reason: "review", now: TEST_NOW });
    expect(() => catalog.transition({ revisionId: review.id, to: "approved", actorId: " llm:extractor", actorRole: "admin", reason: "self approve", now: TEST_NOW })).toThrow(/Agents, LLMs, and OCR workers/);
    const approved = catalog.transition({ revisionId: review.id, to: "approved", actorId: "user:r", actorRole: "reviewer", reason: "approved", now: TEST_NOW });
    expect(() => catalog.transition({ revisionId: approved.id, to: "published", actorId: "agent:designer", actorRole: "admin", reason: "self publish", now: TEST_NOW })).toThrow(/Agents, LLMs, and OCR workers/);
  });

  it("the approver cannot publish their own approval, as publisher or as admin (OD-37)", () => {
    for (const [approveRole, publishRole] of [["reviewer", "publisher"], ["admin", "admin"], ["reviewer", "admin"]] as const) {
      const { catalog, draft } = makeFixtureCatalog();
      const review = catalog.transition({ revisionId: draft.id, to: "needs_review", actorId: "user:r", actorRole: "reviewer", reason: "review", now: TEST_NOW });
      const approved = catalog.transition({ revisionId: review.id, to: "approved", actorId: "user:same", actorRole: approveRole, reason: "approved", now: TEST_NOW });
      const before = catalog.revisions.size;
      expect(() => catalog.transition({ revisionId: approved.id, to: "published", actorId: "user:same", actorRole: publishRole, reason: "publish", now: TEST_NOW }), `${approveRole} -> ${publishRole}`).toThrow(/different/);
      expect(catalog.revisions.size).toBe(before);
      expect(catalog.transition({ revisionId: approved.id, to: "published", actorId: "user:other", actorRole: publishRole, reason: "publish", now: TEST_NOW }).publicationState).toBe("published");
    }
  });

  it("[review] the approval published is the latest one: an earlier approval by someone else does not let the final approver publish", () => {
    const { catalog, draft } = makeFixtureCatalog();
    const review = catalog.transition({ revisionId: draft.id, to: "needs_review", actorId: "user:r", actorRole: "reviewer", reason: "review", now: TEST_NOW });
    const firstApproval = catalog.transition({ revisionId: review.id, to: "approved", actorId: "user:other", actorRole: "reviewer", reason: "approved", now: TEST_NOW });
    const sentBack = catalog.transition({ revisionId: firstApproval.id, to: "draft", actorId: "user:other", actorRole: "reviewer", reason: "sent back", now: TEST_NOW });
    const resubmitted = catalog.transition({ revisionId: sentBack.id, to: "needs_review", actorId: "user:same", actorRole: "reviewer", reason: "resubmitted", now: TEST_NOW });
    const finalApproval = catalog.transition({ revisionId: resubmitted.id, to: "approved", actorId: "user:same", actorRole: "admin", reason: "approved again", now: TEST_NOW });
    expect(finalApproval.reviewHistory.filter((event) => event.action === "approve").map((event) => event.actorId)).toEqual(["user:other", "user:same"]);
    const before = catalog.revisions.size;
    expect(() => catalog.transition({ revisionId: finalApproval.id, to: "published", actorId: "user:same", actorRole: "admin", reason: "publish", now: TEST_NOW })).toThrow(/different/);
    expect(catalog.revisions.size).toBe(before);
    expect(catalog.transition({ revisionId: finalApproval.id, to: "published", actorId: "user:third", actorRole: "publisher", reason: "publish", now: TEST_NOW }).publicationState).toBe("published");
  });

  it("[review] a publisher id that differs from the approver's only by case, surrounding whitespace or compatibility form is the same person", () => {
    const { catalog, draft } = makeFixtureCatalog();
    const review = catalog.transition({ revisionId: draft.id, to: "needs_review", actorId: "user:r", actorRole: "reviewer", reason: "review", now: TEST_NOW });
    const approved = catalog.transition({ revisionId: review.id, to: "approved", actorId: "user:same", actorRole: "reviewer", reason: "approved", now: TEST_NOW });
    const fullwidthU = String.fromCharCode(0xff55);
    for (const actorId of ["USER:Same", " user:same", "user:same\t", `${fullwidthU}ser:same`]) {
      expect(() => catalog.transition({ revisionId: approved.id, to: "published", actorId, actorRole: "publisher", reason: "publish", now: TEST_NOW }), JSON.stringify(actorId)).toThrow(/different/);
    }
    expect(catalog.transition({ revisionId: approved.id, to: "published", actorId: "user:someone-else", actorRole: "publisher", reason: "publish", now: TEST_NOW }).publicationState).toBe("published");
  });

  it("an approved revision with no recorded approval cannot be published", () => {
    const { catalog, published } = makeFixtureCatalog();
    const orphan = createAtomicRevision({ ...published, revision: published.revision + 1, publicationState: "approved", createdBy: "user:r", createdAt: TEST_NOW.toISOString(), reviewHistory: [] });
    catalog.addRevision(orphan);
    expect(() => catalog.transition({ revisionId: orphan.id, to: "published", actorId: "user:p", actorRole: "publisher", reason: "publish", now: TEST_NOW })).toThrow(/approv/);
  });

  it("every legal withdrawal edge moves forward, so the furthest recorded state is the latest (the status derivation's premise)", () => {
    const withdrawal = ["published", "deprecated", "superseded", "revoked"] as const;
    for (const from of withdrawal) {
      for (const to of TRANSITIONS[from]) {
        expect(withdrawal).toContain(to);
        const history = from === "published" ? [{ toState: to }] : [{ toState: to }, { toState: from }];
        expect(catalogStatusOf(history), `${from} -> ${to}`).toBe(to);
      }
    }
    expect(revisionStatusFromEvents("r", "l", [{ toState: "revoked" }, { toState: "superseded", successorRevisionId: "s" }])).toMatchObject({ state: "revoked", selectable: false, pinnable: false, successorRevisionId: "s" });
    expect(revisionStatusFromEvents("r", "l", [{ toState: "published" }, { toState: "draft" }])).toMatchObject({ state: "published", selectable: true, pinnable: true });
  });

  it("a human publisher may still deprecate, and a human admin may revoke (baselines)", () => {
    const { catalog, published } = makeFixtureCatalog();
    const deprecated = catalog.transition({ revisionId: published.id, to: "deprecated", actorId: "user:librarian", actorRole: "publisher", reason: "replaced", now: TEST_NOW });
    expect(catalog.transition({ revisionId: deprecated.id, to: "revoked", actorId: "user:admin", actorRole: "admin", reason: "recalled", now: TEST_NOW }).publicationState).toBe("revoked");
  });
});
