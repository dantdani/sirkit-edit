/**
 * [B19-C I4b] Stage 4 of the quarantine-to-authority pipeline: what evidence a reviewed atomic revision may rest on.
 *
 * `evaluateApproval` decides PCB assignability at publication (`validatePortableSnapshotForPublication`), in catalog search
 * and in component selection's CAD gate. Before I4b it checked that a trusted claim HAD evidence and that a PCB bundle had an
 * approved mapping certificate — but never what kind of source that evidence came from, or whether a model extracted it.
 * The runbook's rules: distributor inventory must not alone prove electrical pin mapping or CAD correctness; AI-extracted
 * datasheet facts stay quarantined until deterministic validation and review.
 */
import { describe, expect, it } from "vitest";
import type { EngineeringClaim, EvidenceRef, SourceClass } from "../types";
import { createAtomicRevision, type AtomicCatalog } from "../catalog";
import { buildMappingCertificate } from "../mapping";
import { evaluateApproval, type ValidationContext } from "../validation";
import { validatePortableSnapshotForPublication } from "../server-repository";
import { sha256 } from "../stable";
import { makeFixtureCatalog, OPEN_LICENSE, packageProof, TEST_NOW, terminals } from "./fixtures";

type Fixture = ReturnType<typeof makeFixtureCatalog>;

/** Add a source of the given class with one evidence record; returns the evidence id. */
function addEvidenceFrom(catalog: AtomicCatalog, key: string, sourceClass: SourceClass, extraction: Partial<EvidenceRef> = {}): string {
  catalog.addSource({ id: `source_${key}`, sourceClass, name: `${key} source`, officialDomains: ["example.net"], licenseId: OPEN_LICENSE.id });
  catalog.addSourceRecord({ id: `record_${key}`, sourceId: `source_${key}`, revision: "1", contentHash: sha256(key), retrievedAt: TEST_NOW.toISOString(), locator: `test://${key}`, mediaType: "application/json", confidential: false });
  const evidence: EvidenceRef = { id: `evidence_${key}`, sourceRecordId: `record_${key}`, locator: "row 1", extractionMethod: "structured_api", extractorVersion: "test/1", extractedAt: TEST_NOW.toISOString(), ...extraction };
  catalog.addEvidence(evidence);
  return evidence.id;
}

/** A PCB-assignable revision of the fixture part whose mapping certificate rests on exactly `evidenceIds`. */
function revisionWithMappingEvidence(fixture: Fixture, evidenceIds: string[]) {
  const { catalog, symbol, footprint, published } = fixture;
  const list = terminals();
  const mapping = buildMappingCertificate({
    exactPartId: "exact_fixture",
    symbol,
    footprint,
    terminals: list.map((terminal) => ({ ...terminal, evidenceIds })),
    mapping: list.map((terminal) => ({ manufacturerTerminalId: terminal.id, symbolPinNumbers: [terminal.publishedIdentifier], logicalPadNumbers: [terminal.publishedIdentifier], evidenceIds })),
    packageProof: packageProof(footprint.versionId, evidenceIds),
    evidenceIds,
  });
  expect(mapping.state, "the certificate itself is complete and approved").toBe("approved");
  catalog.addMapping(mapping);
  const revision = createAtomicRevision({
    ...published,
    revision: published.revision + 1,
    cadBundles: published.cadBundles.map((bundle) => ({ ...bundle, mappingCertificateId: mapping.id })),
    publicationState: "draft",
    createdBy: "test",
    createdAt: TEST_NOW.toISOString(),
    reviewHistory: [],
  });
  return { mapping, revision };
}

function revisionWithClaims(fixture: Fixture, claims: EngineeringClaim[]) {
  const { catalog, published } = fixture;
  for (const claim of claims) catalog.addClaim(claim);
  return createAtomicRevision({ ...published, revision: published.revision + 1, claimIds: [...published.claimIds, ...claims.map((claim) => claim.id)], publicationState: "draft", createdBy: "test", createdAt: TEST_NOW.toISOString(), reviewHistory: [] });
}

const claim = (id: string, facet: EngineeringClaim["facet"], evidenceIds: string[], state: EngineeringClaim["state"] = "source_backed"): EngineeringClaim => ({
  id, property: facet === "terminal" ? "pin_function" : facet === "package" ? "package_code" : facet === "identity" ? "exact_mpn" : "stock",
  facet, value: "x", limit: "nominal", conditions: {}, scope: { kind: "part" }, state, evidenceIds, conflictsWith: [], safetyCritical: false,
});

describe("[B19-C I4b] sourcing and unverified CAD never alone prove a pin-to-pad mapping", () => {
  it.each([
    ["a distributor catalog", "distributor_catalog"],
    ["downloaded third-party CAD", "third_party_cad"],
    ["CAD geometry inference", "cad_geometry_inference"],
    ["an LLM suggestion", "llm_suggestion"],
  ] as const)("PCB assignment is refused when the mapping certificate rests only on %s", (_label, sourceClass) => {
    const fixture = makeFixtureCatalog();
    const evidenceId = addEvidenceFrom(fixture.catalog, "weak", sourceClass);
    const { mapping, revision } = revisionWithMappingEvidence(fixture, [evidenceId]);
    const decision = evaluateApproval(revision, "pcb_assignable", fixture.catalog.validationContext(), TEST_NOW);
    expect(decision.eligible).toBe(false);
    expect(decision.blockers).toContain(`mapping certificate ${mapping.id} rests on no engineering-authoritative evidence (${sourceClass} cannot establish a pin-to-pad mapping)`);
  });

  it("the same certificate is assignable once manufacturer evidence stands beside the distributor's", () => {
    const fixture = makeFixtureCatalog();
    const distributor = addEvidenceFrom(fixture.catalog, "distributor", "distributor_catalog");
    const { revision } = revisionWithMappingEvidence(fixture, [distributor, "evidence_fixture"]);
    expect(evaluateApproval(revision, "pcb_assignable", fixture.catalog.validationContext(), TEST_NOW)).toMatchObject({ eligible: true, blockers: [] });
  });

  it("the publication transaction refuses a published snapshot whose mapping rests only on a distributor", () => {
    const fixture = makeFixtureCatalog();
    const evidenceId = addEvidenceFrom(fixture.catalog, "distributor", "distributor_catalog");
    const { revision } = revisionWithMappingEvidence(fixture, [evidenceId]);
    fixture.catalog.addRevision(revision);
    const review = fixture.catalog.transition({ revisionId: revision.id, to: "needs_review", actorId: "user:reviewer", actorRole: "reviewer", reason: "b19", now: TEST_NOW });
    const approved = fixture.catalog.transition({ revisionId: review.id, to: "approved", actorId: "user:reviewer", actorRole: "reviewer", reason: "b19", now: TEST_NOW });
    const published = fixture.catalog.transition({ revisionId: approved.id, to: "published", actorId: "user:publisher", actorRole: "publisher", reason: "b19", now: TEST_NOW });
    const snapshot = fixture.catalog.portableSnapshot(published.id, TEST_NOW);
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable")).toThrow(/rests on no engineering-authoritative evidence/);
  });

  it("a context that cannot say where mapping evidence came from is refused, not trusted", () => {
    const fixture = makeFixtureCatalog();
    const withoutSources: ValidationContext = { ...fixture.catalog.validationContext(), sourceRecords: undefined, sources: undefined };
    const decision = evaluateApproval(fixture.published, "pcb_assignable", withoutSources, TEST_NOW);
    expect(decision.eligible).toBe(false);
    expect(decision.blockers.join("\n")).toMatch(/source of its evidence cannot be resolved/);
  });

  it("the unchanged fixture part (manufacturer datasheet, reviewed) stays PCB-assignable — a baseline", () => {
    const fixture = makeFixtureCatalog();
    expect(evaluateApproval(fixture.published, "pcb_assignable", fixture.catalog.validationContext(), TEST_NOW).eligible).toBe(true);
  });
});

describe("[B19-C I4b] engineering claims need an engineering-authoritative source; sourcing claims do not", () => {
  it.each(["terminal", "package", "identity"] as const)("a trusted %s claim resting only on a distributor is refused", (facet) => {
    const fixture = makeFixtureCatalog();
    const evidenceId = addEvidenceFrom(fixture.catalog, "distributor", "distributor_catalog");
    const revision = revisionWithClaims(fixture, [claim(`claim_${facet}_distributor`, facet, [evidenceId])]);
    const decision = evaluateApproval(revision, "schematic_only", fixture.catalog.validationContext(), TEST_NOW);
    expect(decision.blockers).toContain(`claim claim_${facet}_distributor (${facet}) rests on no engineering-authoritative evidence`);
  });

  it("a sourcing claim from a distributor is fine — a baseline", () => {
    const fixture = makeFixtureCatalog();
    const evidenceId = addEvidenceFrom(fixture.catalog, "distributor", "distributor_catalog");
    const revision = revisionWithClaims(fixture, [claim("claim_stock_distributor", "sourcing", [evidenceId])]);
    expect(evaluateApproval(revision, "schematic_only", fixture.catalog.validationContext(), TEST_NOW).eligible).toBe(true);
  });

  it("an INFERRED engineering claim from a distributor is not trusted, so it is not refused — it simply proves nothing", () => {
    const fixture = makeFixtureCatalog();
    const evidenceId = addEvidenceFrom(fixture.catalog, "distributor", "distributor_catalog");
    const revision = revisionWithClaims(fixture, [claim("claim_terminal_inferred", "terminal", [evidenceId], "inferred")]);
    expect(evaluateApproval(revision, "schematic_only", fixture.catalog.validationContext(), TEST_NOW).blockers.join("\n")).not.toMatch(/claim_terminal_inferred/);
  });
});

describe("[B19-C I4b] model- or OCR-extracted facts stay quarantined until reviewed", () => {
  it.each(["llm", "ocr"] as const)("a trusted claim resting only on unreviewed %s extraction from a manufacturer datasheet is refused", (method) => {
    const fixture = makeFixtureCatalog();
    const evidenceId = addEvidenceFrom(fixture.catalog, `datasheet_${method}`, "manufacturer_datasheet", { extractionMethod: method });
    const revision = revisionWithClaims(fixture, [claim(`claim_${method}`, "supply", [evidenceId], "verified")]);
    const decision = evaluateApproval(revision, "schematic_only", fixture.catalog.validationContext(), TEST_NOW);
    expect(decision.blockers).toContain(`claim claim_${method} rests only on unreviewed model or OCR extraction (quarantined until review)`);
  });

  it("the same extraction, once a reviewer has recorded their review, is accepted", () => {
    const fixture = makeFixtureCatalog();
    const evidenceId = addEvidenceFrom(fixture.catalog, "datasheet_llm_reviewed", "manufacturer_datasheet", { extractionMethod: "llm", reviewerId: "user:engineer", reviewedAt: TEST_NOW.toISOString() });
    const revision = revisionWithClaims(fixture, [claim("claim_llm_reviewed", "terminal", [evidenceId], "verified")]);
    expect(evaluateApproval(revision, "schematic_only", fixture.catalog.validationContext(), TEST_NOW)).toMatchObject({ eligible: true });
  });

  it("an unreviewed model extraction does not count as engineering-authoritative mapping evidence either", () => {
    const fixture = makeFixtureCatalog();
    const evidenceId = addEvidenceFrom(fixture.catalog, "datasheet_llm_mapping", "manufacturer_datasheet", { extractionMethod: "llm" });
    const { mapping, revision } = revisionWithMappingEvidence(fixture, [evidenceId]);
    expect(evaluateApproval(revision, "pcb_assignable", fixture.catalog.validationContext(), TEST_NOW).blockers).toContain(`mapping certificate ${mapping.id} rests on no engineering-authoritative evidence (only unreviewed model or OCR extraction)`);
  });
});
