/**
 * [B19-D I5d rows 06, 07, 22, 23, 50] Atomic data integrity: value keys, claim revisions, freshness, limit semantics, units.
 *
 *  - row 06: `normalizeValueKey` lower-cased first, so `1M` (megohm) and `1m` (milliohm) became the same link key.
 *  - row 07: a claim superseded by a newer revision of the same source still won `effectiveClaim` (ties broke by id), passed
 *    approval beside its superseder, and satisfied a search criterion.
 *  - row 22: supplier-offer freshness ignored evidence with no expiry or a missing source record, and search never used it.
 *  - row 23: a search criterion without limit semantics matched an ABSOLUTE MAXIMUM rating as if it were an operating value.
 *  - row 50: an empty unit meant "dimensionless", and `10K` / `10 MFD` were accepted as kelvin / millifarads.
 */
import { describe, expect, it } from "vitest";
import { normalizeValueKey, valueKeyLink } from "../value-key";
import { quantity, QuantityError } from "../quantity";
import { effectiveClaim, isClaimFresh } from "../claims";
import { evaluateApproval } from "../validation";
import { searchAtomicCatalog } from "../search";
import type { ComponentQuery, EngineeringClaim, EvidenceRef, SourceRecord } from "../types";
import { makeFixtureCatalog, TEST_NOW } from "./fixtures";

describe("[B19-D I5d row 06] mega and milli are different value keys", () => {
  it.each([["1M", "1m"], ["1MΩ", "1mΩ"], ["10 Mohm", "10 mohm"], ["1MF", "1mF"], ["4M7", "4m7"]])("%s ≠ %s", (a, b) => {
    expect(normalizeValueKey(a)).not.toBe(normalizeValueKey(b));
  });
  it.each([["10k", "10K"], ["4.7µF", "4.7uF"], ["10 kΩ", "10k"], ["1.0M", "1M"]])("%s = %s (baselines)", (a, b) => {
    expect(normalizeValueKey(a)).toBe(normalizeValueKey(b));
  });

  it("every key the catalog seeds is unchanged, so no stored link needs re-keying (pins)", () => {
    const seeded: Array<[string, string]> = [["10k", "10k"], ["56k", "56k"], ["330", "330"], ["10uF", "10u"], ["100nF", "100n"], ["10nF", "10n"], ["", ""], ["ne555", "ne555"], ["NE555D", "ne555d"], ["led", "led"], ["red", "red"], ["conn_01x02", "conn_01x02"], ["power", "power"], ["5v", "5v"], ["4R7", "4r7"], ["470 ohm", "470"], ["47kΩ", "47k"]];
    for (const [value, key] of seeded) expect(normalizeValueKey(value), value).toBe(key);
  });

  it("the legacy MF / MFD spellings get no key rather than a guess", () => {
    expect(normalizeValueKey("10MFD")).toBe("");
    expect(normalizeValueKey("1MF")).toBe("");
    expect(normalizeValueKey("1mF")).toBe("1m");
  });

  it("a value link is read from the object's own keys only, with the '' default", () => {
    expect(valueKeyLink({ "": "default" }, "constructor")).toBe("default");
    expect(valueKeyLink({}, "constructor")).toBeUndefined();
    expect(valueKeyLink({}, "__proto__")).toBeUndefined();
    expect(valueKeyLink({ "10k": "ten", "": "default" }, "10 K")).toBe("ten");
    expect(valueKeyLink({ "1meg": "mega", "1m": "milli" }, "1M")).toBe("mega");
    expect(valueKeyLink(undefined, "10k")).toBeUndefined();
  });
});

describe("[B19-D I5d row 50] a unit is explicit and agrees with its source text", () => {
  it("an empty unit is not a unit", () => {
    expect(() => quantity({ value: 90, unit: "", sourceText: "90" })).toThrow(QuantityError);
    expect(quantity({ value: 90, unit: "1", sourceText: "90" }).dimension).toBe("dimensionless"); // baseline
  });
  it.each([
    [{ value: 10, unit: "mF", sourceText: "10 MFD" }],
    [{ value: 10, unit: "K", sourceText: "10K" }],
  ])("%j is ambiguous", (input) => {
    expect(() => quantity(input)).toThrow(/ambiguous/);
  });
  it("an unambiguous kelvin and a percentage tolerance are accepted (baselines + new API)", () => {
    expect(quantity({ value: 300, unit: "K", sourceText: "300 K" }).value).toBe(300);
    const resistor = quantity({ value: 10, unit: "kΩ", sourceText: "10k 1%", tolerancePercent: 1 } as never);
    expect(resistor.toleranceMinus).toBeCloseTo(100);
    expect(resistor.tolerancePlus).toBeCloseTo(100);
  });
  it.each(["k", "M", "mil", "Ω", "℃"])("unit %s still refuses (pins: the Ohm sign and the degree-Celsius sign are not the units)", (unit) => {
    expect(() => quantity({ value: 1, unit, sourceText: `1 ${unit}` })).toThrow(QuantityError);
  });
});

const voltage = (id: string, max: number, extra: Partial<EngineeringClaim> = {}): EngineeringClaim => ({
  id, property: "vin_max", facet: "supply", value: quantity({ max, unit: "V", sourceText: `${max} V` }), limit: "recommended_operating",
  conditions: {}, scope: { kind: "part" }, state: "source_backed", evidenceIds: ["evidence_fixture"], conflictsWith: [], safetyCritical: true, ...extra,
});

describe("[B19-D I5d row 07] a superseded claim never wins", () => {
  const old = voltage("claim_a_old_rev", 6);
  const current = voltage("claim_b_new_rev", 5.5, { supersedesClaimId: "claim_a_old_rev" });
  // The catalog now refuses to publish a revision binding both claims, so each case builds the both-bound state directly —
  // the state a row written before this rule (or forged outside the catalog) would be in.
  const bothBound = () => {
    const fixture = makeFixtureCatalog({ claims: [current] });
    const claims = new Map([...fixture.view.claims, [old.id, old]]);
    const revision = { ...fixture.published, claimIds: [...fixture.published.claimIds, old.id] };
    const context = { ...fixture.catalog.validationContext(), claims };
    const view = { ...fixture.view, claims, revisions: new Map([...fixture.view.revisions, [revision.id, revision]]) };
    return { fixture, revision, context, view };
  };

  it("effectiveClaim picks the superseding claim even when the superseded id sorts first", () => {
    const { fixture, context } = bothBound();
    const classes = new Map([...fixture.catalog.sources.values()].map((source) => [source.id, source.sourceClass]));
    expect(effectiveClaim([current, old], context.evidence!, context.sourceRecords!, classes).claim?.id).toBe("claim_b_new_rev");
    expect(effectiveClaim([current], context.evidence!, context.sourceRecords!, classes).claim?.id).toBe("claim_b_new_rev"); // baseline
  });

  it("approval refuses a revision that binds both a claim and its superseder", () => {
    const { revision, context } = bothBound();
    expect(evaluateApproval(revision, "schematic_only", context, TEST_NOW).blockers.join("\n")).toMatch(/superseded/);
    expect(() => makeFixtureCatalog({ claims: [old, current] })).toThrow(/superseded/); // the catalog refuses to publish it
  });

  it("search never lets the superseded rating satisfy a criterion", () => {
    const { fixture, view } = bothBound();
    const q: ComponentQuery = { queryId: "q", requiredProfile: "schematic_only", hard: [{ property: "vin_max", operator: "gte", value: quantity({ value: 6, unit: "V", sourceText: "6 V" }), limit: "recommended_operating" }], soft: [], unknownPolicy: "block", policyVersion: "p", catalogSnapshotId: fixture.snapshot.id, limit: 5 };
    expect(searchAtomicCatalog(view, q, TEST_NOW)[0]!.hardResults[0]!.outcome).not.toBe("pass");
    const lower: ComponentQuery = { ...q, hard: [{ ...q.hard[0]!, value: quantity({ value: 5, unit: "V", sourceText: "5 V" }) }] };
    expect(searchAtomicCatalog(view, lower, TEST_NOW)[0]!.hardResults[0]!.outcome).toBe("pass"); // the current rating still answers
  });
});

describe("[B19-D I5d row 23] an unqualified search criterion never reads an absolute-maximum rating", () => {
  it("vin_max 30 V (absolute maximum) does not pass 'vin_max ≥ 24 V' asked without limit semantics", () => {
    const fixture = makeFixtureCatalog({ claims: [voltage("claim_absmax", 30, { limit: "absolute_maximum" })] });
    const q: ComponentQuery = { queryId: "q", requiredProfile: "schematic_only", hard: [{ property: "vin_max", operator: "gte", value: quantity({ value: 24, unit: "V", sourceText: "24 V" }) }], soft: [], unknownPolicy: "block", policyVersion: "p", catalogSnapshotId: fixture.snapshot.id, limit: 5 };
    expect(searchAtomicCatalog(fixture.view, q, TEST_NOW)[0]!.hardResults[0]!.outcome).not.toBe("pass");
  });
});

describe("[B19-D I5d row 22] supplier-offer freshness is strict", () => {
  const offerClaim = (evidenceIds: string[]): EngineeringClaim => ({ id: "claim_stock", property: "stock", facet: "sourcing", value: 10, limit: "nominal", conditions: {}, scope: { kind: "supplier_offer" }, state: "source_backed", evidenceIds, conflictsWith: [], safetyCritical: false });
  const records = new Map<string, SourceRecord>([
    ["rec_fresh", { id: "rec_fresh", sourceId: "s", revision: "1", contentHash: "a".repeat(64), retrievedAt: TEST_NOW.toISOString(), expiresAt: new Date(TEST_NOW.getTime() + 3_600_000).toISOString(), locator: "x", mediaType: "application/json", confidential: false }],
    ["rec_noexp", { id: "rec_noexp", sourceId: "s", revision: "1", contentHash: "b".repeat(64), retrievedAt: TEST_NOW.toISOString(), locator: "x", mediaType: "application/json", confidential: false }],
  ]);
  const ev = (id: string, recordId: string): EvidenceRef => ({ id, sourceRecordId: recordId, locator: "x", extractionMethod: "structured_api", extractorVersion: "1", extractedAt: TEST_NOW.toISOString() });
  const evidence = new Map<string, EvidenceRef>([["ev_fresh", ev("ev_fresh", "rec_fresh")], ["ev_noexp", ev("ev_noexp", "rec_noexp")], ["ev_missing", ev("ev_missing", "rec_gone")]]);

  it("evidence without an expiry, or with a missing record, is not fresh", () => {
    expect(isClaimFresh(offerClaim(["ev_noexp", "ev_fresh"]), records, evidence, TEST_NOW)).not.toBe(true);
    expect(isClaimFresh(offerClaim(["ev_missing", "ev_fresh"]), records, evidence, TEST_NOW)).toBe(false);
    expect(isClaimFresh(offerClaim(["ev_fresh"]), records, evidence, TEST_NOW)).toBe(true); // baseline
  });

  it("search reports a supplier-offer claim backed only by an expired record as stale", () => {
    const fixture = makeFixtureCatalog({ claims: [{ ...offerClaim(["evidence_fixture"]), id: "claim_offer_expired" }] });
    const record = fixture.catalog.sourceRecords.get("record_fixture")!;
    (fixture.catalog.sourceRecords as Map<string, SourceRecord>).set("record_fixture", { ...record, expiresAt: new Date(TEST_NOW.getTime() - 1000).toISOString() });
    const q: ComponentQuery = { queryId: "q", requiredProfile: "schematic_only", hard: [], soft: [], unknownPolicy: "allow_with_warning", policyVersion: "p", catalogSnapshotId: fixture.snapshot.id, limit: 5 };
    expect(searchAtomicCatalog(fixture.view, q, TEST_NOW)[0]!.freshness).toBe("stale");
  });
});
