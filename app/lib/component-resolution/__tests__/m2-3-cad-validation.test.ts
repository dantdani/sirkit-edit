/**
 * [PR-M, 2026-10-18] Section M2 (runbook M.3 item 4, design M2.3): the pure validation over the PRODUCTION parsers' assets of real
 * KiCad files - pins vs pads, pin 1 / pad 1, package and mounting, the pin table, an extra electrical pad, unsupported geometry, the
 * pin-swapped symbol, a symbol read without its parent, the identity rule - and the s-expression composition of a derived symbol.
 */
import { describe, expect, it } from "vitest";
import { validateAcquiredAssets, footprintCarriesPackage, type CadValidationInput } from "@/app/lib/acquisition/cad-validation";
import { composeSymbolLibrary, symbolParent } from "@/app/lib/acquisition/kicad-library-compose";
import { parsePinTable, pinTableTerminals } from "@/app/lib/acquisition/datasheet-pin-table";
import { D_AK_SYMBOL_SOURCE, D_SYMBOL_SOURCE } from "./_m1-fixtures";
import { composed1N4148, footprintAsset, FOOTPRINT_DO35, PIN_TABLE_1N4148, SYMBOL_1N4148, SYMBOL_1N4001, symbolAsset } from "./_m2-fixtures";

const table = (text = PIN_TABLE_1N4148) => {
  const parsed = parsePinTable(text);
  if (!parsed.ok) throw new Error(parsed.detail);
  return { origin: "datasheet" as const, part: parsed.table.part, sourceClass: "organization_authored", fixture: parsed.table.fixture, packageCode: parsed.table.packageCode, mounting: parsed.table.mounting, rows: pinTableTerminals(parsed.table) };
};
function input(over: Partial<CadValidationInput> = {}): CadValidationInput {
  return {
    target: { exactMpn: "1N4148", packageCode: "DO-35", mounting: "through_hole", symbol: "Diode:1N4148", footprint: "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal" },
    symbol: symbolAsset(composed1N4148(), "1N4148"), footprint: footprintAsset(FOOTPRINT_DO35), parseFailures: [], table: table(), identityEvidence: { distributorExactMpn: false, manufacturerDatasheet: false },
    ...over,
  };
}

describe("[PR-M M2.3] the derived symbol is composed with its parent byte for byte", () => {
  it("1N4148 extends 1N4001: alone it is unsupported, composed it parses valid with the parent's K / A pins", () => {
    expect(symbolParent(SYMBOL_1N4148, "1N4148")).toBe("1N4001");
    expect(symbolAsset(SYMBOL_1N4148, "1N4148")?.validationState).toBe("unsupported"); // extends_missing_parent
    const text = composed1N4148();
    expect(text).toContain(SYMBOL_1N4001.slice(SYMBOL_1N4001.indexOf("(symbol \"1N4001\""), SYMBOL_1N4001.lastIndexOf(")")).trim().slice(0, 200));
    const asset = symbolAsset(text, "1N4148")!;
    expect(asset.validationState).toBe("valid");
    expect(asset.pins.map((pin) => [pin.number, pin.name])).toEqual([["1", "K"], ["2", "A"]]);
    expect(composeSymbolLibrary(SYMBOL_1N4148, "1N4148", new Map())).toMatchObject({ ok: false, code: "missing_parent" });
    expect(composeSymbolLibrary(SYMBOL_1N4001, "1N4001", new Map())).toMatchObject({ ok: true, composed: false, text: SYMBOL_1N4001 });
  });
});

describe("[PR-M M2.3] validation", () => {
  it("the official 1N4148 + DO-35 + the pin table: validated; pins 1/2 to pads 1/2, K / A from the table; a GENERIC candidate", () => {
    const report = validateAcquiredAssets(input());
    expect(report.verdict).toBe("validated");
    expect(report.conflicts).toEqual([]);
    expect(report.checks.filter((check) => check.status === "fail")).toEqual([]);
    expect(report.mapping.map((row) => [row.number, row.function, row.pinName, row.pads.join("+")])).toEqual([["1", "K", "K", "1"], ["2", "A", "A", "2"]]);
    expect(report.dryRunCertificate.state).toBe("approved");
    expect(report.identity.kind).toBe("generic");
    expect(report.identity.basis).toContain("fixture pin table names a part but is not manufacturer evidence");
    expect(report.unresolved.join(" ")).toContain("exact manufacturer and MPN");
    expect(report.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(validateAcquiredAssets(input()).digest).toBe(report.digest); // deterministic
    expect(validateAcquiredAssets(input({ identityEvidence: { distributorExactMpn: true, manufacturerDatasheet: false } })).identity).toMatchObject({ kind: "exact", exactMpn: "1N4148" });
  });

  it("without a pin table the KiCad convention is OFFERED for confirmation, never presented as proof", () => {
    const report = validateAcquiredAssets(input({ table: null }));
    expect(report.verdict).toBe("validated");
    expect(report.checks.find((check) => check.id === "terminal-table")).toMatchObject({ status: "unresolved" });
    expect(report.mapping.every((row) => row.origin === "symbol-convention")).toBe(true);
  });

  it("a wrong package or mounting is a conflict", () => {
    expect(validateAcquiredAssets(input({ target: { ...input().target, packageCode: "SOD-123" } }))).toMatchObject({ verdict: "conflicting" });
    expect(validateAcquiredAssets(input({ target: { ...input().target, mounting: "smd" } }))).toMatchObject({ verdict: "conflicting" });
    expect(footprintCarriesPackage("D_DO-35_SOD27_P7.62mm_Horizontal", "DO-35")).toBe(true);
    expect(footprintCarriesPackage("D_DO-35_SOD27_P7.62mm_Horizontal", "SOD-123")).toBe(false);
  });

  it("a pin table that contradicts the symbol is a conflict (nothing guessed)", () => {
    const swapped = PIN_TABLE_1N4148.replace("pin 1 K 1", "pin 1 A 1").replace("pin 2 A 2", "pin 2 K 2");
    const report = validateAcquiredAssets(input({ table: table(swapped) }));
    expect(report.verdict).toBe("conflicting");
    expect(report.conflicts.join(" ")).toContain("pin 1: the table says A, the symbol says K");
  });

  it("the pin-swapped D_AK symbol under a K = pin 1 table is a conflict; the same table over Device:D passes", () => {
    const dTable = table(PIN_TABLE_1N4148.replace("part: 1N4148", "part: D"));
    const base = { target: { ...input().target, exactMpn: null, symbol: "Device:D" } };
    expect(validateAcquiredAssets(input({ ...base, symbol: symbolAsset(D_AK_SYMBOL_SOURCE, "D_AK"), table: dTable })).verdict).toBe("conflicting");
    expect(validateAcquiredAssets(input({ ...base, symbol: symbolAsset(D_SYMBOL_SOURCE, "D"), table: dTable })).verdict).toBe("validated");
  });

  it("an electrical pad no pin names (an exposed / thermal pad) stays UNRESOLVED; unsupported geometry is unsupported", () => {
    const extraPad = FOOTPRINT_DO35.replace(/\(pad "2"/, '(pad "3" smd rect (at 0 0) (size 1 1) (layers "F.Cu")) (pad "2"');
    const report = validateAcquiredAssets(input({ footprint: footprintAsset(extraPad) }));
    expect(report.checks.find((check) => check.id === "pads-have-pins")).toMatchObject({ status: "unresolved" });
    expect(report.unresolved.join(" ")).toContain("pad(s) 3 are not symbol pins");
    expect(report.dryRunCertificate.state).not.toBe("approved");
    const zoned = FOOTPRINT_DO35.replace(/\(pad "1"/, '(zone (net 0) (polygon (pts (xy 0 0) (xy 1 0) (xy 1 1)))) (pad "1"');
    expect(validateAcquiredAssets(input({ footprint: footprintAsset(zoned) })).verdict).toBe("unsupported");
  });

  it("a symbol read without its parent, or a parse refusal, is unsupported", () => {
    expect(validateAcquiredAssets(input({ symbol: symbolAsset(SYMBOL_1N4148, "1N4148") })).verdict).toBe("unsupported");
    expect(validateAcquiredAssets(input({ symbol: null, parseFailures: ["symbol was refused at the preflight (depth)"] })).verdict).toBe("unsupported");
  });
});

describe("[PR-M M2.3] the closed pin-table format", () => {
  it("parses the fixture table and refuses any deviation whole", () => {
    expect(parsePinTable(PIN_TABLE_1N4148)).toMatchObject({ ok: true, table: { fixture: true, part: "1N4148", packageCode: "DO-35", mounting: "through_hole", pins: [{ number: "1", function: "K", pads: ["1"] }, { number: "2", function: "A", pads: ["2"] }] } });
    for (const bad of ["not a table", PIN_TABLE_1N4148.replace("pin 2 A 2", "pin 1 A 2"), PIN_TABLE_1N4148.replace("fixture: yes", "fixture: maybe"), `${PIN_TABLE_1N4148}\nsourceClass: manufacturer_datasheet`, PIN_TABLE_1N4148.replace("pin 2 A 2", "pin 2 A ../2"), "x".repeat(300 * 1024)]) {
      expect(parsePinTable(bad).ok, bad.slice(0, 60)).toBe(false);
    }
  });
});
