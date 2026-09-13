/**
 * [B19-D I5d review] Findings a skeptic verified against commit cf3993e, each reproduced here before its fix.
 *
 *  - (medium) `extends` still multiplied PROPERTIES: a parent with 8 000 properties inherited by 2 000 children passed every
 *    pin budget and cost tens of seconds and a gigabyte of heap (the expanded-pin budget counted pins only).
 *  - (medium) the row 06 value key separated mega from milli only for bare values: `1M 1%` and `1m 1%` were one key again.
 *  - a symbol deriving from a DUPLICATED name was still valid, silently taking the last definition's pins.
 *  - publication's invisible-character refusal was bypassed by surrounding Unicode whitespace (the check trimmed first).
 *  - the unit/source-text ambiguity guard missed `mOhm`, `mOHM`, the Ohm sign and a lowercase `k` with a space.
 *  - an unqualified search criterion still read test-condition, characterization-only, configurable and derating ratings.
 *  - supersession was followed only inside the bound set: with the middle claim of a chain unbound, the oldest claim won; and
 *    the component-selection gates ignored supersession.
 *  - (low, two lenses) publication hashed the blob but never re-derived the asset from it: edited pads, an edited raw symbol
 *    or a forged `valid` state over unsupported bytes all published.
 */
import { describe, expect, it } from "vitest";
import { parseSymbolAssets } from "../kicad-assets";
import { IngestSecurityError } from "../security";
import { normalizeValueKey, valueKeyLink } from "../value-key";
import { quantity, QuantityError } from "../quantity";
import { effectiveClaim, supersededClaimIds } from "../claims";
import { evaluateApproval } from "../validation";
import { searchAtomicCatalog } from "../search";
import { validatePortableSnapshotForPublication } from "../server-repository";
import { canonicalExactMpn } from "../identity";
import { sha256 } from "../stable";
import type { ComponentQuery, EngineeringClaim, LimitSemantics } from "../types";
import { makeFixtureCatalog, TEST_NOW } from "./fixtures";

const ORIGIN = { sourceRecordId: "record_fixture", libraryNickname: "Fixture", sourceUri: "fixture://kicad", licenseId: "license_fixture_mit" };
const lib = (body: string) => `(kicad_symbol_lib (version 20241209) (generator "kicad_symbol_editor") ${body})`;

describe("[B19-D I5d review] inheritance cannot multiply properties", () => {
  it("a parent with 8 000 properties and 2 000 children is refused as expanded_property_budget, quickly", () => {
    const props = Array.from({ length: 8_000 }, (_, index) => `(property "k${index}" "v")`).join(" ");
    const children = Array.from({ length: 2_000 }, (_, index) => `(symbol "C${index}" (extends "P"))`).join(" ");
    const started = Date.now();
    let thrown: unknown;
    try {
      parseSymbolAssets({ source: lib(`(symbol "P" ${props} (pin passive line (at 0 0 0) (length 2.54) (name "A") (number "1"))) ${children}`), origin: ORIGIN });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IngestSecurityError);
    expect((thrown as IngestSecurityError).code).toBe("expanded_property_budget");
    expect(Date.now() - started).toBeLessThan(5_000); // generous: the unbounded run took 17-31 s
  });
});

describe("[B19-D I5d review] a derived symbol of a duplicated name is not valid", () => {
  it("C extends P, and P is defined twice: C is unsupported too", () => {
    const pin = (number: string, name: string) => `(pin power_in line (at 0 0 0) (length 2.54) (name "${name}") (number "${number}"))`;
    const assets = parseSymbolAssets({ source: lib(`(symbol "P" ${pin("1", "VCC")} ${pin("2", "GND")}) (symbol "C" (extends "P")) (symbol "P" ${pin("1", "GND")} ${pin("2", "VCC")})`), origin: ORIGIN });
    const child = assets.find((asset) => asset.symbolName === "C")!;
    expect(child.validationState).not.toBe("valid");
  });
});

describe("[B19-D I5d review] mega and milli stay distinct in a value with a suffix", () => {
  it.each([["1M 1%", "1m 1%"], ["1M\u2126 1%", "1m\u2126 1%"], ["2.2M/0.25W", "2.2m/0.25W"], ["10M_0603", "10m_0603"], ["4M7 5%", "4m7 5%"], ["10MR 1%", "10mR 1%"]])("%s ≠ %s", (a, b) => {
    expect(normalizeValueKey(a)).not.toBe(normalizeValueKey(b));
  });

  it("a milliohm link is never found for a megohm value", () => {
    expect(valueKeyLink({ [normalizeValueKey("1m 1%")]: "shunt" }, "1M 1%")).toBeUndefined();
  });
});

describe("[B19-D I5d review] surrounding Unicode whitespace is not trimmed into a clean MPN", () => {
  it.each(["\uFEFFBAT54S", "BAT54S\u00A0", "\u3000BAT54S"])("canonicalExactMpn refuses %j", (mpn) => {
    expect(() => canonicalExactMpn(mpn)).toThrow(/confusable/);
  });

  it("publication refuses an exact MPN with surrounding whitespace of any kind", () => {
    for (const exactMpn of ["\uFEFFFX-100-QFN", " FX-100-QFN", "FX-100-QFN "]) {
      const fixture = makeFixtureCatalog();
      const snapshot = structuredClone(fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW));
      snapshot.exactPart!.exactMpn = exactMpn;
      expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable"), JSON.stringify(exactMpn)).toThrow(/whitespace|confusable/);
    }
    expect(canonicalExactMpn("  BAT54S	")).toBe("BAT54S"); // ASCII space and tab around a query still trim (baseline)
  });
});

describe("[B19-D I5d review] the unit ambiguity guard covers the usual spellings", () => {
  it.each([
    ["MΩ", "10 mOhm"], ["MΩ", "10mOhm"], ["Mohm", "4.5 mOHM"], ["MΩ", "10 m\u2126"], ["K", "10 k"],
  ])("unit %s with source text %j is refused as ambiguous", (unit, sourceText) => {
    expect(() => quantity({ value: 10, unit, sourceText })).toThrow(QuantityError);
  });

  it("an unambiguous megohm and kelvin are accepted (baselines)", () => {
    expect(quantity({ value: 10, unit: "MΩ", sourceText: "10 MΩ" }).value).toBe(10_000_000);
    expect(quantity({ value: 300, unit: "K", sourceText: "300 K" }).value).toBe(300);
  });
});

const voltage = (id: string, max: number, extra: Partial<EngineeringClaim> = {}): EngineeringClaim => ({
  id, property: "vin_max", facet: "supply", value: quantity({ max, unit: "V", sourceText: `${max} V` }), limit: "recommended_operating",
  conditions: {}, scope: { kind: "part" }, state: "source_backed", evidenceIds: ["evidence_fixture"], conflictsWith: [], safetyCritical: true, ...extra,
});
const query = (snapshotId: string, limit?: LimitSemantics, value = 24): ComponentQuery => ({ queryId: "q", requiredProfile: "schematic_only", hard: [{ property: "vin_max", operator: "gte", value: quantity({ value, unit: "V", sourceText: `${value} V` }), ...(limit ? { limit } : {}) }], soft: [], unknownPolicy: "block", policyVersion: "p", catalogSnapshotId: snapshotId, limit: 5 });

describe("[B19-D I5d review] an unqualified criterion reads only operating ratings", () => {
  it.each(["test_condition", "characterization_only", "configurable", "derating", "typical"] as const)("a %s rating does not pass an unqualified criterion", (limit) => {
    const fixture = makeFixtureCatalog({ claims: [voltage("claim_rating", 30, { limit })] });
    expect(searchAtomicCatalog(fixture.view, query(fixture.snapshot.id), TEST_NOW)[0]!.hardResults[0]!.outcome).not.toBe("pass");
  });

  it.each(["recommended_operating", "guaranteed"] as const)("a %s rating still passes (baseline)", (limit) => {
    const fixture = makeFixtureCatalog({ claims: [voltage("claim_rating", 30, { limit })] });
    expect(searchAtomicCatalog(fixture.view, query(fixture.snapshot.id), TEST_NOW)[0]!.hardResults[0]!.outcome).toBe("pass");
  });
});

describe("[B19-D I5d review] supersession is followed across the whole claim map", () => {
  const a = voltage("claim_a_rev_a", 6);
  const b = voltage("claim_b_rev_b", 5.8, { supersedesClaimId: "claim_a_rev_a" });
  const c = voltage("claim_c_rev_c", 5.5, { supersedesClaimId: "claim_b_rev_b" });

  it("with the middle claim unbound, the oldest claim is still superseded: approval blocks, search does not pass, effectiveClaim picks the newest", () => {
    const fixture = makeFixtureCatalog({ claims: [a, c] });
    const claims = new Map([...fixture.view.claims, [b.id, b]]);
    const context = { ...fixture.catalog.validationContext(), claims };
    expect(evaluateApproval(fixture.published, "schematic_only", context, TEST_NOW).blockers.join("\n")).toMatch(/superseded/);
    const view = { ...fixture.view, claims };
    expect(searchAtomicCatalog(view, query(fixture.snapshot.id, "recommended_operating", 6), TEST_NOW)[0]!.hardResults[0]!.outcome).not.toBe("pass");
    const classes = new Map([...fixture.catalog.sources.values()].map((source) => [source.id, source.sourceClass]));
    expect(effectiveClaim([a, c], context.evidence!, context.sourceRecords!, classes, claims).claim?.id).toBe("claim_c_rev_c");
    expect(supersededClaimIds([a, c], claims).has("claim_a_rev_a")).toBe(true);
  });

  it("the component-selection gates ignore a superseded claim bound beside its superseder", async () => {
    const { trustedClaims } = await import("@/app/lib/component-selection/gates");
    const fixture = makeFixtureCatalog({ claims: [a] });
    const snapshot = structuredClone(fixture.catalog.portableSnapshot(fixture.published.id, TEST_NOW));
    snapshot.claims = [a, b];
    expect(trustedClaims(snapshot, "vin_max").map((claim) => claim.id)).toEqual(["claim_b_rev_b"]);
  });
});

describe("[B19-D I5d review] publication re-derives each KiCad asset from its bytes", () => {
  async function blinkerSnapshot() {
    const { blinkerCatalog, BLINKER_PART_IDS } = await import("@/app/lib/fixture-runtime/blinker/catalog");
    const catalog = blinkerCatalog();
    return structuredClone(catalog.snapshots.get(catalog.revisionFor(BLINKER_PART_IDS.timer, "NE555")!)!);
  }

  it("a real blinker snapshot publishes (baseline)", async () => {
    const snapshot = await blinkerSnapshot();
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable")).not.toThrow();
  });

  it("edited pad geometry over unchanged bytes is refused", async () => {
    const snapshot = await blinkerSnapshot();
    snapshot.footprint!.pads[0]!.widthNm = 9_000_000;
    snapshot.footprint!.pads[0]!.xNm += 5_000_000;
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable")).toThrow(/raw content/);
  });

  it("an edited raw symbol block over unchanged bytes is refused", async () => {
    const snapshot = await blinkerSnapshot();
    snapshot.symbol.rawSymbolSExpression = snapshot.symbol.rawSymbolSExpression.replace(/\(number "1"/, '(number "EDITED"');
    expect(snapshot.symbol.rawSymbolSExpression).toContain("EDITED");
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable")).toThrow(/raw content/);
  });

  it("a footprint declared valid over bytes that parse as unsupported is refused, even with every hash updated", async () => {
    const snapshot = await blinkerSnapshot();
    const blob = snapshot.assetBlobs.find((item) => item.id === snapshot.footprint!.rawContentObjectId)!;
    blob.content = blob.content.replace(/\n\)\s*$/, '\n\t(embedded_files (file (name "x.ttf") (type font) (data "AAAA")))\n)\n');
    expect(blob.content).toContain("embedded_files");
    blob.contentHash = sha256(blob.content);
    blob.bytes = Buffer.byteLength(blob.content, "utf8");
    snapshot.footprint!.contentHash = blob.contentHash;
    expect(() => validatePortableSnapshotForPublication(snapshot, "pcb_assignable")).toThrow();
  });
});
