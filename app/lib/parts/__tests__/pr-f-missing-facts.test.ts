/**
 * [PR-F fA] The missing-facts checklist (app/lib/parts/missing-facts.ts): each missing class, the Theory case, stock/pricing never
 * flipping identity or evidence to known, F's action order over the EXISTING routes, and the honest unavailable states.
 */
import { describe, expect, it } from "vitest";
import { importReviewProfileNeeds } from "@/app/lib/acquisition/import-review";
import { ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING } from "@/app/lib/acquisition/source-registry";
import type { ExternalSearchSourceStatus } from "@/app/lib/acquisition/external-search-contract";
import { UNRESOLVED_REVIEW_PATH, type UnresolvedInstance } from "@/app/lib/pcb-sync/unresolved-instances";
import {
  boundedExternalQuery,
  deriveMissingFacts,
  EVIDENCE_NEEDS,
  externalSourceAnsweredNothingLive,
  externalSourceStateWords,
  footprintReferenceOf,
  MISSING_PART_ACTION_ROUTES,
  missingPartsWords,
  publishedAssignmentFor,
  SOURCING_NEVER_PROVES,
  THEORY_NOT_PHYSICAL,
  type CatalogPartFacts,
  type MissingFactsChecklist,
  type SourcingObservationFacts,
} from "../missing-facts";

const kicad = (refDes: string, missing: UnresolvedInstance["missing"]): UnresolvedInstance => ({ refDes, family: "kicad", missing, reviewPath: UNRESOLVED_REVIEW_PATH[missing] });
const theory = (refDes: string): UnresolvedInstance => ({ refDes, family: "theory", missing: "theory_symbol_only", reviewPath: UNRESOLVED_REVIEW_PATH.theory_symbol_only });

const RECORD: CatalogPartFacts = {
  id: "part_ne555", name: "NE555D", mpn: "NE555DR", manufacturer: "Texas Instruments", libraryName: "Timer", footprintHint: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm",
  pinCount: 8, hasSymbol: true,
};
const ASSIGNMENT = { revisionId: "rev_ne555_1", symbolVersionId: "sym_1", footprintVersionId: "fp_1", mappingCertificateId: "map_1", footprintFullName: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm" };

const byId = (list: MissingFactsChecklist) => Object.fromEntries(list.facts.map((fact) => [fact.id, fact]));
const states = (list: MissingFactsChecklist, cls: "identity" | "evidence" | "stock_pricing") => list.facts.filter((fact) => fact.cls === cls).map((fact) => fact.state);

describe("[PR-F fA] the four fact classes and the three missing classes", () => {
  it("published_exact_revision with no catalog record: identity and evidence unknown, each naming why; stock and pricing unknown with the sourcing rule", () => {
    const list = deriveMissingFacts({ instance: kicad("U1", "published_exact_revision"), schematic: { value: "NE555", partId: "part_x", atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: null }, catalog: { state: "unavailable", reason: "GET /api/parts/part_x answered 404" }, projectOpen: true });
    expect(list.physical).toBe(true);
    expect(list.facts.map((fact) => fact.id)).toEqual(["manufacturer", "exact_mpn", "package_variant", "symbol", "footprint", "pin_to_pad_mapping", "stock", "pricing"]);
    expect(states(list, "identity")).toEqual(["unknown", "unknown", "unknown"]);
    expect(states(list, "evidence")).toEqual(["unknown", "unknown", "unknown"]);
    expect(states(list, "stock_pricing")).toEqual(["unknown", "unknown"]);
    for (const fact of list.facts.filter((item) => item.cls !== "stock_pricing")) expect(fact.source).toContain("catalog part unavailable");
    for (const fact of list.facts.filter((item) => item.cls === "stock_pricing")) expect(fact.note).toBe(SOURCING_NEVER_PROVES);
    expect(list.headline).toBe("U1: no published exact revision - 6 of 6 identity and evidence facts unknown or conflicting");
  });

  it("a loaded record makes identity known (the record is the source) and leaves evidence unknown: a footprint hint and a pin count are hints, never evidence", () => {
    const list = deriveMissingFacts({ instance: kicad("U1", "published_exact_revision"), schematic: { value: "NE555DR", partId: RECORD.id, atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: null }, catalog: { state: "loaded", part: RECORD }, projectOpen: true });
    const facts = byId(list);
    expect(facts.manufacturer).toMatchObject({ state: "known", value: "Texas Instruments", source: "catalog part record part_ne555 (Timer)" });
    expect(facts.exact_mpn).toMatchObject({ state: "known", value: "NE555DR" });
    expect(facts.package_variant).toMatchObject({ state: "unknown", value: null });
    expect(facts.package_variant.note).toContain("never package proof");
    expect(states(list, "evidence")).toEqual(["unknown", "unknown", "unknown"]);
    expect(facts.footprint.note).toContain("never footprint evidence");
    expect(facts.pin_to_pad_mapping.note).toBe("8 symbol pins is a pin count, never a pin-to-pad mapping");
    expect(facts.symbol.source).toBe("no published atomic revision links this catalog part");
  });

  it("a published, never withdrawn revision linked to the value makes the evidence known from THAT revision, and the headline says to place it", () => {
    const part: CatalogPartFacts = { ...RECORD, atomicAssignments: { "": ASSIGNMENT } };
    const list = deriveMissingFacts({ instance: kicad("U1", "published_exact_revision"), schematic: { value: "NE555DR", partId: part.id, atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: null }, catalog: { state: "loaded", part }, projectOpen: true });
    expect(states(list, "evidence")).toEqual(["known", "known", "known"]);
    expect(byId(list).footprint).toMatchObject({ value: ASSIGNMENT.footprintFullName, source: "published atomic revision rev_ne555_1 (the part's default link)" });
    expect(byId(list).pin_to_pad_mapping.value).toBe("map_1");
    expect(list.headline).toContain("a published exact revision exists for this part");
    // the review and the draft are not the fix: the published revision is
    expect(list.actions.find((action) => action.id === "request_review")?.availability).toMatchObject({ state: "not_available", reason: expect.stringContaining("rev_ne555_1") });
    expect(list.actions.find((action) => action.id === "create_draft")?.availability.state).toBe("not_available");
  });

  it("a value whose own link was withdrawn has no evidence (no '' fallback for it), and says so", () => {
    const part: CatalogPartFacts = { ...RECORD, atomicAssignments: { "": ASSIGNMENT }, withdrawnValueKeys: ["10k"] };
    expect(publishedAssignmentFor(part, "10k")).toEqual({ key: "10k", withdrawn: true });
    expect(publishedAssignmentFor(part, "56k")).toEqual({ key: "", assignment: ASSIGNMENT });
    expect(publishedAssignmentFor({ ...RECORD }, "10k")).toBeNull();
    const list = deriveMissingFacts({ instance: kicad("R1", "published_exact_revision"), schematic: { value: "10k", partId: part.id, atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: null }, catalog: { state: "loaded", part }, projectOpen: true });
    expect(states(list, "evidence")).toEqual(["unknown", "unknown", "unknown"]);
    expect(byId(list).symbol.source).toContain("withdrawn or missing revision");
  });

  it("symbol_asset: the revision exists on the instance, the symbol asset is not installed - a re-place, not a review", () => {
    const list = deriveMissingFacts({ instance: kicad("U1", "symbol_asset"), schematic: { value: "NE555DR", partId: RECORD.id, atomicPartRevisionId: "rev_ne555_1", symbolAssetVersionId: null, theoryType: null }, catalog: { state: "loaded", part: RECORD }, projectOpen: true });
    expect(byId(list).symbol).toMatchObject({ state: "unknown", source: "published revision rev_ne555_1 without its installed symbol asset on this instance", note: "re-place the part from its published revision" });
    expect(list.headline).toContain("re-place the part from its published revision");
    expect(list.actions.find((action) => action.id === "request_review")?.availability).toEqual({ state: "not_available", reason: "a published revision exists for this instance: re-place the part from it (no review is needed)" });
    expect(list.actions.find((action) => action.id === "search_catalog")?.availability.state).toBe("available");
  });

  it("the Theory case (F.5): not a physical part - every identity and evidence fact unknown by construction, no draft", () => {
    const list = deriveMissingFacts({ instance: theory("R1"), schematic: { value: "10k", partId: null, atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: "resistor" }, catalog: { state: "none" }, projectOpen: true });
    expect(list.physical).toBe(false);
    expect(list.headline).toBe(`R1: ${THEORY_NOT_PHYSICAL}`);
    expect(list.headline).toContain("not a physical part");
    for (const fact of list.facts.filter((item) => item.cls !== "stock_pricing")) expect(fact).toMatchObject({ state: "unknown", value: null, source: THEORY_NOT_PHYSICAL });
    const actions = Object.fromEntries(list.actions.map((action) => [action.id, action.availability]));
    expect(actions.search_catalog).toEqual({ state: "available", query: "resistor 10k", mode: null });
    expect(actions.search_distributors).toEqual({ state: "available", query: "resistor 10k", mode: "keyword" });
    expect(actions.request_review.state).toBe("available"); // the handoff is reachable; the form needs the exact MPN the person identifies
    expect(actions.create_draft).toMatchObject({ state: "not_available", reason: expect.stringContaining("no documented dimensions or pins") });
    expect(list.publicationPrefill).toEqual({ exactMpn: null, manufacturer: null, partId: null, symbol: null, footprint: null });
  });
});

describe("[PR-F fA] stock and pricing never flip identity or evidence to known", () => {
  const HITS: SourcingObservationFacts[] = [
    { sourceDisplayName: "DigiKey", mpn: "NE555DR", exactMatch: true, manufacturer: "Texas Instruments", stock: 12000, priceBreaks: 4, servedFrom: "live" },
    { sourceDisplayName: "Nexar", mpn: "NE555DR", exactMatch: true, manufacturer: "TI", stock: null, priceBreaks: 2, servedFrom: "process-memo" },
  ];

  it("without a record, two sourcing observations make stock and pricing known and leave identity and evidence unknown (the spelling is a hint)", () => {
    const list = deriveMissingFacts({ instance: kicad("U1", "published_exact_revision"), schematic: { value: "NE555", partId: "part_x", atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: null }, catalog: { state: "unavailable", reason: "404" }, sourcing: HITS, projectOpen: true });
    expect(states(list, "identity")).toEqual(["unknown", "unknown", "unknown"]);
    expect(states(list, "evidence")).toEqual(["unknown", "unknown", "unknown"]);
    expect(byId(list).manufacturer.note).toBe('distributor spelling "Texas Instruments", "TI": an identity hint, not proof');
    expect(byId(list).exact_mpn.note).toBe('distributor MPN "NE555DR": an identity hint, not proof');
    expect(byId(list).stock).toMatchObject({ state: "known", value: "DigiKey: 12000 (NE555DR, live)" });
    expect(byId(list).stock.source).toBe(`DigiKey · ${SOURCING_NEVER_PROVES}`);
    expect(byId(list).pricing).toMatchObject({ state: "known", value: "DigiKey: 4 price breaks (NE555DR); Nexar: 2 price breaks (NE555DR)", source: `DigiKey, Nexar · ${SOURCING_NEVER_PROVES}` });
    expect(SOURCING_NEVER_PROVES).toContain(ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING.join(", "));
  });

  it("with a record, a distributor's different manufacturer spelling makes the identity fact CONFLICTING (never known from the distributor) and leaves the evidence as it was", () => {
    const list = deriveMissingFacts({ instance: kicad("U1", "published_exact_revision"), schematic: { value: "NE555DR", partId: RECORD.id, atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: null }, catalog: { state: "loaded", part: RECORD }, sourcing: HITS, projectOpen: true });
    expect(byId(list).manufacturer).toMatchObject({ state: "conflicting", value: "Texas Instruments" });
    expect(byId(list).manufacturer.note).toContain('"TI"');
    expect(byId(list).exact_mpn.state).toBe("known"); // both distributors spell the record's MPN
    expect(states(list, "evidence")).toEqual(["unknown", "unknown", "unknown"]);
    // the Theory symbol stays non-physical whatever a distributor says
    const theoryList = deriveMissingFacts({ instance: theory("R1"), schematic: { value: "10k", partId: null, atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: "resistor" }, catalog: { state: "none" }, sourcing: HITS, projectOpen: true });
    expect(states(theoryList, "identity")).toEqual(["unknown", "unknown", "unknown"]);
    expect(states(theoryList, "evidence")).toEqual(["unknown", "unknown", "unknown"]);
    expect(theoryList.physical).toBe(false);
  });

  it("the evidence labels are import-review's pcb_assignable needs, verbatim", () => {
    expect([...EVIDENCE_NEEDS]).toEqual(importReviewProfileNeeds("pcb_assignable"));
  });
});

describe("[PR-F fA] the next actions: F's order over the existing routes, and the honest unavailable states", () => {
  it("the four actions come in F's order and name the existing routes and components they reuse", () => {
    const list = deriveMissingFacts({ instance: kicad("U1", "published_exact_revision"), schematic: { value: "NE555DR", partId: RECORD.id, atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: null }, catalog: { state: "loaded", part: RECORD }, projectOpen: true });
    expect(list.actions.map((action) => [action.id, action.order])).toEqual([["search_catalog", 1], ["search_distributors", 2], ["request_review", 3], ["create_draft", 4]]);
    expect(list.actions.map((action) => action.route)).toEqual([MISSING_PART_ACTION_ROUTES.search_catalog, MISSING_PART_ACTION_ROUTES.search_distributors, MISSING_PART_ACTION_ROUTES.request_review, MISSING_PART_ACTION_ROUTES.create_draft]);
    expect(MISSING_PART_ACTION_ROUTES.search_catalog).toContain("POST /api/parts/search");
    expect(MISSING_PART_ACTION_ROUTES.search_distributors).toContain("POST /api/parts/external-search");
    expect(MISSING_PART_ACTION_ROUTES.request_review).toContain("POST /api/components/atomic/publication submit_request");
    expect(MISSING_PART_ACTION_ROUTES.create_draft).toContain("UNVERIFIED");
    const actions = Object.fromEntries(list.actions.map((action) => [action.id, action.availability]));
    expect(actions.search_catalog).toEqual({ state: "available", query: "NE555DR", mode: null });
    expect(actions.search_distributors).toEqual({ state: "available", query: "NE555DR", mode: "exact" });
    expect(actions.request_review).toEqual({ state: "available", query: "NE555DR", mode: null });
    expect(actions.create_draft).toEqual({ state: "available", query: "NE555DR", mode: null });
    expect(list.publicationPrefill).toEqual({ exactMpn: "NE555DR", manufacturer: "Texas Instruments", partId: "part_ne555", symbol: { library: "Timer", name: "NE555D" }, footprint: { library: "Package_SO", name: "SOIC-8_3.9x4.9mm_P1.27mm" } });
    expect(list.actions.find((action) => action.id === "create_draft")?.note).toContain("NOT PCB-assignable until the deterministic mapping checks and the human approval and publication pass");
  });

  it("no open project: the distributor search, the review and the draft are not available with the reason; the catalog search stays", () => {
    const list = deriveMissingFacts({ instance: kicad("U1", "published_exact_revision"), schematic: { value: "NE555DR", partId: RECORD.id, atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: null }, catalog: { state: "loaded", part: RECORD }, projectOpen: false });
    const actions = Object.fromEntries(list.actions.map((action) => [action.id, action.availability]));
    expect(actions.search_catalog.state).toBe("available");
    expect(actions.search_distributors).toEqual({ state: "not_available", reason: "open a project: the distributor search is a member's read of that project" });
    expect(actions.request_review).toMatchObject({ state: "not_available", reason: expect.stringContaining("open a project") });
    expect(actions.create_draft).toMatchObject({ state: "not_available", reason: expect.stringContaining("open a project") });
    expect(list.publicationPrefill).toBeNull();
  });

  it("the draft needs an exact MPN, a symbol drawing and documented pins - each absence is its own reason, never a fake draft", () => {
    const input = (part: CatalogPartFacts) => deriveMissingFacts({ instance: kicad("U1", "published_exact_revision"), schematic: { value: "x", partId: part.id, atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: null }, catalog: { state: "loaded", part }, projectOpen: true });
    const draft = (part: CatalogPartFacts) => input(part).actions.find((action) => action.id === "create_draft")!.availability;
    expect(draft({ ...RECORD, mpn: null })).toEqual({ state: "not_available", reason: "no exact MPN: a draft is of one exact manufacturer part" });
    expect(draft({ ...RECORD, hasSymbol: false })).toEqual({ state: "not_available", reason: "the catalog part has no symbol drawing to reference" });
    expect(draft({ ...RECORD, pinCount: 0 })).toEqual({ state: "not_available", reason: "the catalog part documents no pins: a draft without a pin table cannot be mapped" });
    // a record without an MPN still searches by its name; the distributor search falls back to a keyword search of the name
    const actions = Object.fromEntries(input({ ...RECORD, mpn: null }).actions.map((action) => [action.id, action.availability]));
    expect(actions.search_catalog).toEqual({ state: "available", query: "NE555D", mode: null });
    expect(actions.search_distributors).toEqual({ state: "available", query: "NE555D", mode: "keyword" });
    // a loading record: nothing is known yet, nothing is faked
    const loading = deriveMissingFacts({ instance: kicad("U1", "published_exact_revision"), schematic: { value: "", partId: "p", atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: null }, catalog: { state: "loading" }, projectOpen: true });
    expect(loading.facts.filter((fact) => fact.cls !== "stock_pricing").every((fact) => fact.state === "unknown" && fact.source === "catalog part not loaded yet")).toBe(true);
    expect(Object.fromEntries(loading.actions.map((action) => [action.id, action.availability.state]))).toEqual({ search_catalog: "not_available", search_distributors: "not_available", request_review: "available", create_draft: "not_available" });
  });

  it("the external query is bounded to the contract (1..64 printable ASCII) and a footprint hint parses only as Library:Name", () => {
    expect(boundedExternalQuery("  NE555DR ")).toBe("NE555DR");
    expect(boundedExternalQuery("a".repeat(70))).toHaveLength(64);
    expect(boundedExternalQuery("10 kΩ résistor")).toBe("10 kohm r sistor");
    expect(boundedExternalQuery("4.7µH")).toBe("4.7uH");
    expect(boundedExternalQuery("é")).toBeNull();
    expect(boundedExternalQuery(null)).toBeNull();
    expect(footprintReferenceOf("Package_SO:SOIC-8")).toEqual({ library: "Package_SO", name: "SOIC-8" });
    expect(footprintReferenceOf("SOIC-8")).toBeNull();
    expect(footprintReferenceOf("Lib:")).toBeNull();
    expect(footprintReferenceOf(null)).toBeNull();
  });

  it("a source's state is said in the Build Library's words, and only a live answer counts as a vendor call", () => {
    const base: ExternalSearchSourceStatus = { sourceId: "digikey", displayName: "DigiKey", status: "available", ownerDecision: null, retryAt: null, freshnessLabel: "", attribution: "", attributionLink: null, servedFrom: null, hitCount: 0, withheldHits: 0 };
    expect(externalSourceStateWords(base)).toBe("not searched");
    expect(externalSourceStateWords({ ...base, servedFrom: "live", hitCount: 3, withheldHits: 1 })).toBe("live · 3 found · 1 withheld");
    expect(externalSourceStateWords({ ...base, status: "paused", retryAt: Date.UTC(2026, 9, 17, 12, 30) })).toBe("paused until 2026-10-17 12:30 UTC");
    expect(externalSourceStateWords({ ...base, status: "paused" })).toBe("paused");
    expect(externalSourceStateWords({ ...base, status: "failed" })).toBe("search failed");
    expect(externalSourceStateWords({ ...base, status: "not_searchable" })).toBe("no candidate search");
    expect(externalSourceStateWords({ ...base, status: "disabled", ownerDecision: "OD-33" })).toBe("disabled (OD-33)");
    expect(externalSourceStateWords({ ...base, status: "blocked" })).toBe("blocked");
    expect(externalSourceStateWords({ ...base, status: "operator_disabled" })).toBe("switched off by the operator");
    expect(externalSourceStateWords({ ...base, status: "credentials_missing" })).toBe("not configured");
    expect(externalSourceAnsweredNothingLive(base)).toBe(true);
    expect(externalSourceAnsweredNothingLive({ ...base, status: "credentials_missing" })).toBe(true);
    expect(externalSourceAnsweredNothingLive({ ...base, servedFrom: "process-memo", hitCount: 1 })).toBe(true);
    expect(externalSourceAnsweredNothingLive({ ...base, servedFrom: "live", hitCount: 1 })).toBe(false);
  });

  it("the journey strip's and the sidebar's sentence", () => {
    expect(missingPartsWords(1)).toBe("1 missing part");
    expect(missingPartsWords(3)).toBe("3 missing parts");
  });
});
