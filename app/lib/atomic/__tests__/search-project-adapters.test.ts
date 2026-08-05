import { describe, expect, it } from "vitest";
import { createAtomicRevision } from "../catalog";
import { AtomicAgentTools, confirmAgentSelection } from "../agent-tools";
import { atomicSnapshotToCachedPart, buildAtomicProjectExportManifest, kicadDatabaseLibraryConfig, paginateKicadAtomicParts, toKicadAtomicPart, toKicadHttpPart } from "../kicad-adapters";
import { applyUpgrade, diffAtomicUpgrade, pinFromSelection } from "../project";
import { quantity } from "../quantity";
import { qualifyingResults, searchAtomicCatalog } from "../search";
import type { ComponentQuery, EngineeringClaim, PortableAtomicSnapshot } from "../types";
import { semanticHash } from "../stable";
import { TEST_NOW, VOLTAGE_RECOMMENDED, footprintAsset, makeFixtureCatalog } from "./fixtures";

function query(snapshotId: string, overrides: Partial<ComponentQuery> = {}): ComponentQuery {
  return {
    queryId: "query_fixture",
    category: undefined,
    requiredProfile: "pcb_assignable",
    hard: [{
      property: "supply_voltage",
      operator: "range_contains",
      value: quantity({ min: 3, max: 3.3, unit: "V", sourceText: "3.0-3.3 V requirement" }),
      limit: "recommended_operating",
    }],
    soft: [],
    unknownPolicy: "block",
    policyVersion: "fixture-policy/1",
    catalogSnapshotId: snapshotId,
    limit: 20,
    ...overrides,
  };
}

describe("Stage 5 deterministic component selection", () => {
  it("satisfies hard requirements only from trusted claims with matching limit semantics", () => {
    const fixture = makeFixtureCatalog();
    const results = searchAtomicCatalog(fixture.view, query(fixture.snapshot.id), TEST_NOW);
    expect(qualifyingResults(results).map((item) => item.revisionId)).toEqual([fixture.published.id]);

    const tooHigh = query(fixture.snapshot.id, {
      hard: [{ property: "supply_voltage", operator: "range_contains", value: quantity({ min: 5, max: 5.5, unit: "V", sourceText: "5-5.5 V" }), limit: "recommended_operating" }],
    });
    const failed = searchAtomicCatalog(fixture.view, tooHigh, TEST_NOW)[0];
    expect(failed.qualified).toBe(false);
    // The attached 6 V absolute maximum is deliberately ineligible to satisfy
    // a recommended operating requirement.
    expect(failed.hardResults[0].claimIds).toEqual([VOLTAGE_RECOMMENDED.id]);
  });

  it("blocks unknown hard facts unless the explicit policy permits a warning", () => {
    const fixture = makeFixtureCatalog();
    const hard = [{ property: "adc_resolution", operator: "gte" as const, value: 12 }];
    expect(searchAtomicCatalog(fixture.view, query(fixture.snapshot.id, { hard }), TEST_NOW)[0].qualified).toBe(false);
    const tolerant = searchAtomicCatalog(fixture.view, query(fixture.snapshot.id, { hard, unknownPolicy: "allow_with_warning" }), TEST_NOW)[0];
    expect(tolerant.qualified).toBe(true);
    expect(tolerant.unknowns).toContain("adc_resolution");
  });

  it("returns no confirmed match rather than relaxing failed criteria", () => {
    const fixture = makeFixtureCatalog();
    const results = searchAtomicCatalog(fixture.view, query(fixture.snapshot.id, {
      hard: [{ property: "package_code", operator: "eq", value: "BGA-900" }],
    }), TEST_NOW);
    expect(results).toHaveLength(1);
    expect(qualifyingResults(results)).toEqual([]);
  });

  it("reports conflicts and stale availability explicitly", () => {
    const conflict: EngineeringClaim = {
      id: "claim_feature_conflict",
      property: "has_usb",
      facet: "capability",
      value: true,
      limit: "guaranteed",
      conditions: {},
      scope: { kind: "part" },
      state: "conflicting",
      evidenceIds: ["evidence_fixture"],
      conflictsWith: ["claim_feature_other"],
      safetyCritical: false,
    };
    const fixture = makeFixtureCatalog({ claims: [VOLTAGE_RECOMMENDED, conflict] });
    const result = searchAtomicCatalog(fixture.view, query(fixture.snapshot.id, { hard: [{ property: "has_usb", operator: "eq", value: true }] }), TEST_NOW)[0];
    expect(result.hardResults[0].outcome).toBe("conflict");
    expect(result.qualified).toBe(false);
  });

  it("rejects a query bound to another catalog snapshot", () => {
    const fixture = makeFixtureCatalog();
    expect(() => searchAtomicCatalog(fixture.view, query("catalog_wrong"), TEST_NOW)).toThrow(/different catalog snapshot/);
  });

  it("uses stable revision IDs to break equal-score ties independent of map insertion order", () => {
    const fixture = makeFixtureCatalog();
    const clone = createAtomicRevision({
      ...fixture.published,
      logicalPartId: "logical_fixture_clone",
      revision: 1,
      publicationState: "published",
      createdAt: "2026-07-17T12:01:00.000Z",
      createdBy: "fixture",
      reviewHistory: [],
      supersedesRevisionId: undefined,
    });
    const ids = [fixture.published.id, clone.id];
    const makeView = (order: string[]) => ({
      ...fixture.view,
      revisions: new Map(order.map((id) => [id, id === clone.id ? clone : fixture.published])),
      publishedRevisionIds: new Set(order),
    });
    const first = searchAtomicCatalog(makeView(ids), query(fixture.snapshot.id), TEST_NOW).map((item) => item.revisionId);
    const second = searchAtomicCatalog(makeView([...ids].reverse()), query(fixture.snapshot.id), TEST_NOW).map((item) => item.revisionId);
    expect(first).toEqual(second);
    expect(first).toEqual([...ids].sort());
  });
});

describe("Stage 5 agent-safe selection and project pinning", () => {
  it("creates only an agent proposal until the user explicitly confirms", () => {
    const fixture = makeFixtureCatalog();
    const tools = new AtomicAgentTools(fixture.view, fixture.catalog.evidence, (revision) => fixture.catalog.portableSnapshot(revision.id, TEST_NOW));
    const proposal = tools.proposeComponentSelection({ projectId: "project", componentInstanceId: "U1", query: query(fixture.snapshot.id), revisionId: fixture.published.id, rationale: "Meets the stated voltage range" });
    expect(proposal.actor).toBe("agent_proposal_user_confirmation_required");
    expect(() => confirmAgentSelection(proposal, false)).toThrow(/explicit user confirmation/);
    const confirmed = confirmAgentSelection(proposal, true);
    expect(confirmed.actor).toBe("agent_proposal_user_confirmed");
    expect(pinFromSelection(confirmed).atomicRevisionId).toBe(fixture.published.id);
  });

  it("pins an offline snapshot so catalog changes do not mutate the design", () => {
    const fixture = makeFixtureCatalog();
    const snapshot = fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW);
    const serialized = JSON.stringify(snapshot);
    fixture.catalog.addClaim({ ...VOLTAGE_RECOMMENDED, id: "claim_new_catalog_data", property: "new_fact" });
    expect(JSON.stringify(snapshot)).toBe(serialized);
    expect(snapshot.symbol.versionId).toBe(fixture.symbol.versionId);
    expect(snapshot.mapping?.id).toBe(fixture.mapping.id);
  });

  it("classifies footprint/mapping changes and invalidates prior-stage evidence", () => {
    const fixture = makeFixtureCatalog();
    const newFootprint = footprintAsset("footprintv_changed_geometry");
    const target = createAtomicRevision({
      ...fixture.published,
      revision: fixture.published.revision + 1,
      cadBundles: fixture.published.cadBundles.map((bundle) => ({ ...bundle, footprintVersionId: newFootprint.versionId, mappingCertificateId: "map_changed" })),
      publicationState: "published",
      createdAt: "2026-07-18T00:00:00.000Z",
      createdBy: "fixture",
      reviewHistory: [],
      supersedesRevisionId: fixture.published.id,
    });
    const diff = diffAtomicUpgrade({
      from: fixture.published,
      to: target,
      symbolSemanticHashes: new Map([[fixture.symbol.versionId, fixture.symbol.semanticHash]]),
      footprintSemanticHashes: new Map([[fixture.footprint.versionId, fixture.footprint.semanticHash], [newFootprint.versionId, newFootprint.semanticHash]]),
      mappingSemanticHashes: new Map([[fixture.mapping.id, fixture.mapping.semanticHash], ["map_changed", "changed"]]),
      claimSemanticHashes: new Map(fixture.published.claimIds.map((id) => [id, semanticHash(fixture.catalog.claims.get(id))])),
      guidanceSemanticHashes: new Map([["guidance_decoupling_fixture", "same"]]),
    });
    expect(diff.impacts).toContain("footprint_geometry_change");
    expect(diff.impacts).toContain("pin_mapping_change");
    expect(diff.invalidates).toEqual(expect.arrayContaining(["pin_pad_mapping", "placement", "routing", "drc", "readiness", "manufacturing_release"]));
    expect(diff.safeForAutomaticMetadataRefresh).toBe(false);
  });

  it("rejects unconfirmed or mismatched upgrade snapshots atomically", () => {
    const fixture = makeFixtureCatalog();
    const snapshot = fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW);
    const selection = {
      selectionRecordId: "selection",
      atomicRevisionId: fixture.published.id,
      symbolVersionId: fixture.symbol.versionId,
      footprintVersionId: fixture.footprint.versionId,
      mappingCertificateId: fixture.mapping.id,
      modelVersionIds: [],
      embeddedSnapshot: snapshot,
    };
    const diff = { fromRevisionId: fixture.published.id, toRevisionId: fixture.published.id, impacts: ["metadata_only" as const], invalidates: [], safeForAutomaticMetadataRefresh: true, blockers: [] };
    expect(() => applyUpgrade({ current: selection, target: fixture.published, targetSnapshot: snapshot, diff, userConfirmed: false })).toThrow(/explicit user confirmation/);
    const bad = structuredClone(snapshot) as PortableAtomicSnapshot;
    bad.symbol.versionId = "wrong";
    expect(() => applyUpgrade({ current: selection, target: fixture.published, targetSnapshot: bad, diff, userConfirmed: true })).toThrow(/snapshot symbol/);
  });
});

describe("Stage 5 read-only KiCad adapters", () => {
  it("maps exact approved symbol/footprint IDs and hashes without flattening assets", () => {
    const fixture = makeFixtureCatalog();
    const snapshot = fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW);
    const view = toKicadAtomicPart(snapshot);
    expect(view.fields.SirkitAtomicRevision).toBe(fixture.published.id);
    expect(view.fields.SirkitSymbolVersion).toBe(fixture.symbol.versionId);
    expect(view.fields.SirkitFootprintVersion).toBe(fixture.footprint.versionId);
    expect(view.assetHashes.symbol).toBe(fixture.symbol.contentHash);
    expect(view.assetHashes.footprint).toBe(fixture.footprint.contentHash);
    const legacyConsumerView = atomicSnapshotToCachedPart(snapshot);
    expect(legacyConsumerView.atomicAssignment?.mappingCertificateId).toBe(fixture.mapping.id);
    expect(legacyConsumerView.pinPadMapping?.mappings).toHaveLength(2);
  });

  it("paginates by stable ID and exports a deduplicated exact asset manifest", () => {
    const fixture = makeFixtureCatalog();
    const snapshot = fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW);
    expect(paginateKicadAtomicParts([snapshot], { limit: 1 })).toMatchObject({ nextCursor: null, items: [{ id: fixture.published.id }] });
    const manifest = buildAtomicProjectExportManifest([snapshot, structuredClone(snapshot)]);
    expect(manifest.generator).toBe("sirkit");
    expect(manifest.revisionIds).toEqual([fixture.published.id]);
    expect(manifest.assets.map((asset) => asset.kind).sort()).toEqual(["footprint", "symbol"]);
  });

  it("exposes a read-only database-library contract", () => {
    expect(kicadDatabaseLibraryConfig()).toMatchObject({ readonly: true, table: "atomic_part_revisions", visibilityPredicate: "publication_state = 'published'" });
  });

  it("emits the official read-only KiCad HTTP-library detail shape using strings", () => {
    const fixture = makeFixtureCatalog();
    const part = toKicadHttpPart(fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW));
    expect(part.symbolIdStr).toBe("Fixture:FixturePart");
    expect(part.fields.footprint.value).toBe("Fixture:FixtureFootprint");
    expect(part.exclude_from_board).toBe("False");
    expect(Object.values(part.fields).every((field) => typeof field.value === "string")).toBe(true);
  });
});
