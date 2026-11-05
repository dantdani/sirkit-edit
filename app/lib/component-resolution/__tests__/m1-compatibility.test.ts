/**
 * [PR-M, 2026-10-17] Section M increment 1 - the pure judgements, over REAL published revisions (production parsers, mapping
 * certificates and catalog transitions; _m1-fixtures.ts): the schematic-instance inspection without a PCB (M.2.1) and the
 * compatibility / evidence evaluation (M.2.3). No database, no provider, no network.
 *
 * Asserted: pins and functions come from the catalog symbol and nets / polarity from the sheet; compatible needs function, type,
 * an approved-certificate pad, the same class and every stated requirement - pin count or names alone never suffice; a mapping
 * proved by function may permute numbers; unknown / incompatible pins, ratings and packages and withdrawn revisions refuse
 * precisely; a compatible result is never labelled electrical equivalence.
 */
import { describe, expect, it } from "vitest";
import type { CatalogPartDetail } from "@/app/lib/atomic/catalog-part-detail";
import type { AtomicRevisionStatus } from "@/app/lib/atomic/revision-status";
import type { KicadPin } from "@/app/lib/kicad/types";
import { blinkerCatalog, BLINKER_PART_IDS } from "@/app/lib/fixture-runtime/blinker/catalog";
import { publishedRevisionEvidenceOf, revisionEvidenceDigestMatches, type PublishedRevisionEvidence } from "../evidence";
import { inspectSchematicInstances, type CatalogPartLoad } from "../instance-facts";
import { COMPATIBILITY_EQUIVALENCE_NOTE, evaluateCompatibility, type ResolutionRequirement } from "../compatibility";
import { candidateRevisionFactsOf, currentInstanceFactsOf } from "../candidate-search";
import { functionalClassOf, pinFunctionOf } from "../pin-functions";
import { D_AK_SYMBOL_SOURCE, D_SYMBOL_SOURCE, DIODE_1N4148_PINS, extractedPins, ledDimmerSheet, swappedSymbolDiodeRevision, switchingDiodeRevision, type DimmerResolvedIdentity } from "./_m1-fixtures";

const blinker = blinkerCatalog();
const published = (id: string): AtomicRevisionStatus => ({ revisionId: id, logicalPartId: `logical-${id}`, state: "published", selectable: true, pinnable: true });
const revoked = (id: string): AtomicRevisionStatus => ({ revisionId: id, logicalPartId: `logical-${id}`, state: "revoked", selectable: false, pinnable: false });

function detail(id: string, input: { name: string; library: string; pins: KicadPin[]; mpn?: string | null; description?: string; keywords?: string; footprintHint?: string | null; link?: { revisionId: string; evidence: PublishedRevisionEvidence } }): CatalogPartDetail {
  return {
    id, name: input.name, description: input.description ?? null, keywords: input.keywords ?? null, mpn: input.mpn ?? null, manufacturer: null, datasheet: null, footprintHint: input.footprintHint ?? null,
    mainCategory: input.library === "Device" ? "Passive Components" : "Diodes", libraryName: input.library, pins: input.pins, symbolRaw: "", properties: {},
    internalPartNumber: null, lifecycleStatus: null, rohsStatus: null, packageNormalized: null, keySpecs: null, isGeneric: input.mpn === undefined || input.mpn === null,
    ...(input.link ? { atomicAssignments: { "": { revisionId: input.link.revisionId, symbolVersionId: input.link.evidence.symbol.versionId, footprintVersionId: input.link.evidence.footprint!.versionId, mappingCertificateId: input.link.evidence.mapping!.id, footprintFullName: `${input.link.evidence.footprint!.libraryNickname}:${input.link.evidence.footprint!.footprintName}`, approved: true as const } } } : {}),
  };
}

const W = switchingDiodeRevision("m1-w", "1N4148W-7-F");
const W_EVIDENCE = publishedRevisionEvidenceOf(W.snapshot)!;
const AK = swappedSymbolDiodeRevision("m1-ak", "1N4148WAK-7-F");
const AK_EVIDENCE = publishedRevisionEvidenceOf(AK.snapshot)!;
const LED_REVISION = blinker.revisionFor(BLINKER_PART_IDS.led, "")!;
const LED_EVIDENCE = publishedRevisionEvidenceOf(blinker.snapshots.get(LED_REVISION)!)!;

const PARTS = {
  timer: { id: BLINKER_PART_IDS.timer, pins: blinker.cachedParts.get(BLINKER_PART_IDS.timer)!.pins },
  resistor: { id: BLINKER_PART_IDS.resistor, pins: blinker.cachedParts.get(BLINKER_PART_IDS.resistor)!.pins },
  capacitor: { id: BLINKER_PART_IDS.capacitor, pins: blinker.cachedParts.get(BLINKER_PART_IDS.capacitor)!.pins },
  diode1n4148: { id: "part-1n4148", pins: DIODE_1N4148_PINS },
};
const identityOf = (partId: string, value: string): DimmerResolvedIdentity => {
  const assignment = blinker.cachedParts.get(partId)!.atomicAssignments![value === "NE555D" ? "" : value === "10k" ? "10k" : "10n"]!;
  return { atomicPartRevisionId: assignment.revisionId, symbolAssetVersionId: assignment.symbolVersionId, footprintAssetVersionId: assignment.footprintVersionId, mappingCertificateId: assignment.mappingCertificateId };
};
const SHEET = ledDimmerSheet(PARTS, { timer: identityOf(BLINKER_PART_IDS.timer, "NE555D"), resistor: identityOf(BLINKER_PART_IDS.resistor, "10k"), capacitor: identityOf(BLINKER_PART_IDS.capacitor, "10nF") });

const CURRENT_1N4148 = detail("part-1n4148", { name: "1N4148", library: "Diode", pins: DIODE_1N4148_PINS, mpn: "1N4148", description: "100V 0.15A standard switching diode, DO-35", keywords: "diode", footprintHint: "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal" });
const CANDIDATE_W = detail("part-1n4148w", { name: "1N4148W", library: "Diode", pins: extractedPins(D_SYMBOL_SOURCE, "D").pins, mpn: "1N4148W-7-F", description: "75V 0.15A Fast Switching Diode, SOD-123", keywords: "diode", link: { revisionId: W.revisionId, evidence: W_EVIDENCE } });
const CANDIDATE_AK = detail("part-1n4148w-ak", { name: "D_AK", library: "Diode", pins: extractedPins(D_AK_SYMBOL_SOURCE, "D_AK").pins, mpn: "1N4148WAK-7-F", description: "Fast switching diode, SOD-123, anode on pin 1", keywords: "diode", link: { revisionId: AK.revisionId, evidence: AK_EVIDENCE } });
const CANDIDATE_LED = detail(BLINKER_PART_IDS.led, { name: "LED", library: "Device", pins: blinker.cachedParts.get(BLINKER_PART_IDS.led)!.pins, description: "Light emitting diode", keywords: "LED diode", link: { revisionId: LED_REVISION, evidence: LED_EVIDENCE } });

function loads(entries: CatalogPartDetail[]): Map<string, CatalogPartLoad> {
  const map = new Map<string, CatalogPartLoad>();
  for (const cached of [BLINKER_PART_IDS.timer, BLINKER_PART_IDS.resistor, BLINKER_PART_IDS.capacitor]) map.set(cached, { state: "found", detail: { ...(blinker.cachedParts.get(cached)! as unknown as CatalogPartDetail), keywords: null, internalPartNumber: null, lifecycleStatus: null, rohsStatus: null, packageNormalized: null, keySpecs: null, isGeneric: true }, revisionStatus: {} });
  for (const entry of entries) map.set(entry.id, { state: "found", detail: entry, revisionStatus: {} });
  return map;
}
const PARTS_LOADED = loads([CURRENT_1N4148, CANDIDATE_W, CANDIDATE_AK, CANDIDATE_LED]);

function d1(): NonNullable<ReturnType<typeof currentInstanceFactsOf>> {
  const facts = inspectSchematicInstances({ state: SHEET, targets: ["kc-d1"], parts: PARTS_LOADED }).instances[0]!;
  return currentInstanceFactsOf(facts)!;
}
function evaluate(candidate: CatalogPartDetail, evidence: PublishedRevisionEvidence | null, status: AtomicRevisionStatus | null, requirement?: ResolutionRequirement) {
  const link = candidate.atomicAssignments![""]!;
  return evaluateCompatibility({ current: d1(), candidate: candidateRevisionFactsOf({ detail: candidate, valueKey: "", link, status, evidence }), ...(requirement ? { requirement } : {}) });
}

describe("[PR-M] M.2.1 - schematic-instance inspection without a PCB", () => {
  it("1. every unresolved instance is listed with its stable id, catalog-symbol pins and functions, nets with their members, and polarity; resolved parts are not", () => {
    const inspection = inspectSchematicInstances({ state: SHEET, targets: "unresolved", parts: PARTS_LOADED });
    expect(inspection.instances.map((instance) => [instance.componentId, instance.refDes, instance.resolution.missing])).toEqual([["kc-d1", "D1", "published_exact_revision"], ["kc-d2", "D2", "published_exact_revision"]]);
    const [D1, D2] = inspection.instances;
    expect(D1!.pins.source).toBe("catalog-symbol");
    expect(D1!.functionalClass).toBe("diode");
    expect(D1!.pins.items.map((pin) => [pin.number, pin.name, pin.function.key, pin.net?.name ?? null])).toEqual([["1", "K", "cathode", "TIMING"], ["2", "A", "anode", "RA"]]);
    expect(D1!.polarity).toEqual({ anodeNet: "RA", cathodeNet: "TIMING" });
    expect(D2!.polarity).toEqual({ anodeNet: "TIMING", cathodeNet: "RB" }); // turned the other way: both orientations are facts
    const timing = D1!.pins.items[0]!.net!;
    expect(timing.members).toEqual(expect.arrayContaining(["C1.1", "D1.1", "D2.2", "U1.2", "U1.6"])); // the wire to C1 and the labels
    expect(D1!.catalog.part?.footprintHint).toContain("DO-35"); // a hint, reported as such - never package authority
    expect(D1!.resolution.ownPublishedLink).toBeNull(); // its own part publishes nothing: a part change is needed
    expect(inspection.netlistBasis.withoutCatalogPins).toBe(0);
  });

  it("2. without the catalog, pins are unavailable - never a browser pin list - and a reference names its stable id", () => {
    const inspection = inspectSchematicInstances({ state: SHEET, targets: ["D2", "nope"], parts: new Map() });
    expect(inspection.instances[0]!.componentId).toBe("kc-d2");
    expect(inspection.instances[0]!.pins).toMatchObject({ source: "unavailable", count: 0, items: [] });
    expect(inspection.notFound).toEqual(["nope"]);
    expect(inspection.netlistBasis.withoutCatalogPins).toBe(5);
  });

  it("3. the closed vocabularies: an LED diode is an LED, a Schottky is not a plain diode, K / A are cathode / anode only for polar classes", () => {
    expect(functionalClassOf({ libraryName: "Device", name: "LED", keywords: "LED diode" }).functionalClass).toBe("led");
    expect(functionalClassOf({ libraryName: "Diode", name: "1N5819", keywords: "diode Schottky" }).functionalClass).toBe("schottky-diode");
    expect(functionalClassOf({ libraryName: "Device", name: "D" }).functionalClass).toBe("diode");
    expect(functionalClassOf({ libraryName: "Misc", name: "XYZ" }).functionalClass).toBe("unknown");
    expect(pinFunctionOf({ number: "1", name: "K" }, "diode").key).toBe("cathode");
    expect(pinFunctionOf({ number: "1", name: "K" }, "resistor").key).toBe("name:K");
    expect(pinFunctionOf({ number: "2", name: "~" }, "resistor").key).toBe("number:2");
  });
});

describe("[PR-M] M.2.3 - compatibility over server-owned evidence", () => {
  it("4. the published SOD-123 switching diode is COMPATIBLE: identity mapping by function over the approved certificate's pads; never electrical equivalence", () => {
    expect(revisionEvidenceDigestMatches(W_EVIDENCE)).toBe(true);
    const result = evaluate(CANDIDATE_W, W_EVIDENCE, published(W.revisionId));
    expect(result.verdict).toBe("compatible");
    expect(result.bucket).toBe("eligible");
    expect(result.mapping).toEqual([{ fromPin: "1", toPin: "1", function: "cathode", pads: ["1"], connected: true }, { fromPin: "2", toPin: "2", function: "anode", pads: ["2"], connected: true }]);
    expect(result.permutation).toBe(false);
    expect(result.equivalence).toBe("pin-function-and-package");
    const mentions = [...JSON.stringify(result).matchAll(/(\S+ \S+ )electrical(ly)? equivalen/gi)].map((match) => match[1]!.toLowerCase());
    expect(mentions.length).toBeGreaterThan(0);
    expect(mentions.every((words) => words === "not an " || words === "a complete ")).toBe(true); // only ever negated: "not an electrical equivalence proof"
    expect(result.warnings.some((warning) => warning.includes("not an electrical equivalence proof"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("D_SOD-123") && warning.includes("DO-35"))).toBe(true); // the package change is a material warning
    expect(COMPATIBILITY_EQUIVALENCE_NOTE).toContain("not a complete electrical equivalence proof");
  });

  it("5. a symbol numbered the other way needs and gets a PROVED permutation (by function, over the certificate)", () => {
    const result = evaluate(CANDIDATE_AK, AK_EVIDENCE, published(AK.revisionId));
    expect(result.verdict).toBe("compatible");
    expect(result.permutation).toBe(true);
    expect(result.mapping).toEqual([{ fromPin: "1", toPin: "2", function: "cathode", pads: ["1"], connected: true }, { fromPin: "2", toPin: "1", function: "anode", pads: ["2"], connected: true }]);
  });

  it("6. an LED with the same two pins named K and A is INCOMPATIBLE: pin count and names are never enough", () => {
    const result = evaluate(CANDIDATE_LED, LED_EVIDENCE, published(LED_REVISION));
    expect(result.verdict).toBe("incompatible");
    expect(result.reasons[0]!.code).toBe("functional-class-mismatch");
    expect(result.mapping).toBeNull();
  });

  it("7. withdrawn, draft, missing evidence, missing mapping and a catalog symbol that is not the published one refuse precisely", () => {
    expect(evaluate(CANDIDATE_W, W_EVIDENCE, revoked(W.revisionId))).toMatchObject({ verdict: "incompatible", bucket: "withdrawn", reasons: [{ code: "revision-withdrawn" }] });
    expect(evaluate(CANDIDATE_W, W_EVIDENCE, null)).toMatchObject({ verdict: "unresolved", bucket: "draft", reasons: [{ code: "revision-unpublished" }] });
    expect(evaluate(CANDIDATE_W, null, published(W.revisionId))).toMatchObject({ bucket: "missing-asset", reasons: [{ code: "evidence-unavailable" }] });
    expect(evaluate(CANDIDATE_W, { ...W_EVIDENCE, mapping: null }, published(W.revisionId))).toMatchObject({ bucket: "missing-asset", reasons: [{ code: "asset-missing" }] });
    expect(evaluate(CANDIDATE_W, { ...W_EVIDENCE, mapping: { ...W_EVIDENCE.mapping!, complete: false } }, published(W.revisionId))).toMatchObject({ bucket: "missing-asset", reasons: [{ code: "mapping-incomplete" }] });
    const drawnElsewhere = { ...CANDIDATE_W, pins: CANDIDATE_W.pins.map((pin) => (pin.number === "1" ? { ...pin, position: { x: pin.position.x - 2.54, y: pin.position.y } } : pin)) };
    expect(evaluate(drawnElsewhere, W_EVIDENCE, published(W.revisionId))).toMatchObject({ verdict: "incompatible", reasons: [{ code: "catalog-symbol-differs" }] });
  });

  it("8. a certificate that leaves a connected pin without a pad, or two pins of one function, never maps", () => {
    const noPad = { ...W_EVIDENCE, mapping: { ...W_EVIDENCE.mapping!, entries: W_EVIDENCE.mapping!.entries.filter((entry) => !entry.symbolPinNumbers.includes("1")) } };
    expect(evaluate(CANDIDATE_W, noPad, published(W.revisionId))).toMatchObject({ verdict: "incompatible", reasons: [{ code: "pin-not-mapped-to-pad" }] });
    const twoCathodes = { ...W_EVIDENCE, symbol: { ...W_EVIDENCE.symbol, pins: W_EVIDENCE.symbol.pins.map((pin) => ({ ...pin, name: "K" })) } };
    expect(evaluate(CANDIDATE_W, twoCathodes, published(W.revisionId))).toMatchObject({ verdict: "unresolved", reasons: [{ code: "ambiguous-pin-function" }] });
  });

  it("9. STATED requirements decide: ratings proven by a published claim, unproven or violated; mounting and package", () => {
    const proven = evaluate(CANDIDATE_W, W_EVIDENCE, published(W.revisionId), { ratings: [{ property: "reverse_voltage", dimension: "voltage", min: 50 }] });
    expect(proven).toMatchObject({ verdict: "compatible", equivalence: "pin-function-package-and-stated-ratings", ratings: [{ property: "reverse_voltage", state: "satisfied" }] });
    expect(evaluate(CANDIDATE_W, W_EVIDENCE, published(W.revisionId), { ratings: [{ property: "reverse_voltage", dimension: "voltage", min: 100 }] })).toMatchObject({ verdict: "incompatible", reasons: [{ code: "rating-violated" }] });
    expect(evaluate(CANDIDATE_W, W_EVIDENCE, published(W.revisionId), { ratings: [{ property: "reverse_recovery_time", dimension: "time", max: 4e-9 }] })).toMatchObject({ verdict: "unresolved", reasons: [{ code: "rating-unproven" }] });
    expect(evaluate(CANDIDATE_W, W_EVIDENCE, published(W.revisionId), { mounting: "through_hole" })).toMatchObject({ verdict: "incompatible", reasons: [{ code: "mounting-mismatch" }] });
    expect(evaluate(CANDIDATE_W, W_EVIDENCE, published(W.revisionId), { packageCode: "SOD-323" })).toMatchObject({ verdict: "incompatible", reasons: [{ code: "package-mismatch" }] });
    expect(evaluate(CANDIDATE_W, W_EVIDENCE, published(W.revisionId), { mounting: "smd", packageCode: "SOD-123" })).toMatchObject({ verdict: "compatible" });
    expect(evaluate(CANDIDATE_W, W_EVIDENCE, published(W.revisionId), { functionalClass: "schottky-diode" })).toMatchObject({ verdict: "incompatible", reasons: [{ code: "functional-class-mismatch" }] });
  });

  it("10. a stated bound is judged on the WORST case of every accepted claim; a typical figure never proves one", () => {
    const claim = (over: Partial<PublishedRevisionEvidence["claims"][number]> & { quantity: NonNullable<PublishedRevisionEvidence["claims"][number]["quantity"]> }): PublishedRevisionEvidence["claims"][number] => ({ property: "forward_voltage", facet: "diode_led_tvs", limit: "guaranteed", state: "source_backed", text: null, evidenceCount: 1, ...over });
    const withClaims = (...claims: PublishedRevisionEvidence["claims"]): PublishedRevisionEvidence => ({ ...W_EVIDENCE, claims: [...W_EVIDENCE.claims, ...claims] });
    const vf = withClaims(claim({ quantity: { dimension: "voltage", min: 0.6, max: 1.0, unit: "V" } }));
    const judge = (evidence: PublishedRevisionEvidence, rating: { property: string; dimension: "voltage" | "time"; min?: number; max?: number }) => evaluate(CANDIDATE_W, evidence, published(W.revisionId), { ratings: [rating] });
    // a ceiling on a characteristic is met by its guaranteed maximum, never by its minimum
    expect(judge(vf, { property: "forward_voltage", dimension: "voltage", max: 1.1 })).toMatchObject({ verdict: "compatible", ratings: [{ state: "satisfied" }] });
    expect(judge(vf, { property: "forward_voltage", dimension: "voltage", max: 0.9 })).toMatchObject({ verdict: "incompatible", reasons: [{ code: "rating-violated" }] });
    // a floor on a characteristic is met by its guaranteed minimum, never by its maximum (0.6 < 0.7 though the range reaches 1.0)
    expect(judge(vf, { property: "forward_voltage", dimension: "voltage", min: 0.7 })).toMatchObject({ verdict: "incompatible", reasons: [{ code: "rating-violated" }] });
    // both bounds: the whole guaranteed range must sit inside the window
    expect(judge(vf, { property: "forward_voltage", dimension: "voltage", min: 0.5, max: 1.05 })).toMatchObject({ verdict: "compatible" });
    // two claims for one property (another condition): the worse one decides
    const twoConditions = withClaims(claim({ quantity: { dimension: "voltage", max: 0.85, unit: "V" } }), claim({ quantity: { dimension: "voltage", max: 1.25, unit: "V" } }));
    expect(judge(twoConditions, { property: "forward_voltage", dimension: "voltage", max: 1.0 })).toMatchObject({ verdict: "incompatible", reasons: [{ code: "rating-violated" }] });
    // a typical-only figure proves nothing, and a claim with no figure for the stated bound leaves it unproven
    const typical = withClaims(claim({ property: "reverse_recovery_time", limit: "typical", quantity: { dimension: "time", typical: 4e-9, unit: "s" } }));
    expect(judge(typical, { property: "reverse_recovery_time", dimension: "time", max: 5e-9 })).toMatchObject({ verdict: "unresolved", reasons: [{ code: "rating-unproven" }] });
    const floorOnly = withClaims(claim({ quantity: { dimension: "voltage", min: 0.6, unit: "V" } }));
    expect(judge(floorOnly, { property: "forward_voltage", dimension: "voltage", max: 1.0 })).toMatchObject({ verdict: "unresolved", reasons: [{ code: "rating-unproven" }] });
  });
});

describe("[PR-M] M.2.1 - a reference designator is a label, never the target", () => {
  it("11. two unresolved instances sharing a reference are both listed, each under its own stable id", () => {
    const state = structuredClone(SHEET);
    state.kicadComponents!.find((instance) => instance.id === "kc-d2")!.refDes = "D1";
    const inspection = inspectSchematicInstances({ state, targets: "unresolved", parts: PARTS_LOADED });
    expect(inspection.instances.map((instance) => [instance.componentId, instance.refDes])).toEqual([["kc-d1", "D1"], ["kc-d2", "D1"]]);
    expect(inspection.instances.map((instance) => instance.polarity)).toEqual([{ anodeNet: "RA", cathodeNet: "TIMING" }, { anodeNet: "TIMING", cathodeNet: "RB" }]);
  });
});
