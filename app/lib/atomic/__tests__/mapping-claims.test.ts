import { describe, expect, it } from "vitest";
import { buildMappingCertificate, mappingIsCurrent, provePackage } from "../mapping";
import { QuantityError, compareQuantities, quantity, rangeContains } from "../quantity";
import { effectiveClaim } from "../claims";
import { exactManufacturerPartId, normalizeMpnSearchKey, supplierPartId } from "../identity";
import type { EngineeringClaim } from "../types";
import { footprintAsset, mappingFor, packageProof, symbolAsset, terminals, VOLTAGE_RECOMMENDED } from "./fixtures";

describe("Stage 5 exact terminal/pin/pad mapping", () => {
  it("approves an exact one-to-one revision-bound mapping", () => {
    const symbol = symbolAsset();
    const footprint = footprintAsset();
    const certificate = mappingFor(symbol, footprint);
    expect(certificate.state).toBe("approved");
    expect(certificate.entries.map((entry) => entry.logicalPadNumbers)).toEqual([["1"], ["2"]]);
    expect(mappingIsCurrent(certificate, symbol.versionId, footprint.versionId)).toBe(true);
    expect(mappingIsCurrent(certificate, "new-symbol", footprint.versionId)).toBe(false);
  });

  it("rejects the historic equal-count {1,3} symbol versus {1,2} pad defect", () => {
    const symbol = symbolAsset("symbolv_mismatch", [{ number: "1" }, { number: "3" }]);
    const footprint = footprintAsset("footprintv_mismatch", [{ number: "1" }, { number: "2" }]);
    const certificate = buildMappingCertificate({
      exactPartId: "exact_fixture",
      symbol,
      footprint,
      terminals: terminals(["1", "3"]),
      mapping: [
        { manufacturerTerminalId: "terminal_1", symbolPinNumbers: ["1"], logicalPadNumbers: ["1"], evidenceIds: ["evidence_fixture"] },
        { manufacturerTerminalId: "terminal_3", symbolPinNumbers: ["3"], logicalPadNumbers: ["3"], evidenceIds: ["evidence_fixture"] },
      ],
      packageProof: packageProof(footprint.versionId),
    });
    expect(certificate.state).not.toBe("approved");
    expect(certificate.missingPadNumbers).toEqual(["3"]);
    expect(certificate.extraElectricalPadNumbers).toEqual(["2"]);
  });

  it("preserves repeated physical pads sharing one logical number", () => {
    const symbol = symbolAsset("symbolv_common", [{ number: "1" }, { number: "2" }]);
    const footprint = footprintAsset("footprintv_common", [{ number: "1" }, { number: "2", id: "pad_2a" }, { number: "2", id: "pad_2b" }]);
    const certificate = mappingFor(symbol, footprint);
    expect(certificate.state).toBe("approved");
    expect(certificate.entries.find((entry) => entry.logicalPadNumbers[0] === "2")?.physicalPadIds).toEqual(["pad_2a", "pad_2b"]);
  });

  it("does not multiply physical identity for multi-unit/alternate graphical pins", () => {
    const symbol = symbolAsset("symbolv_multiunit", [
      { number: "1", unit: 1, bodyStyle: 1 },
      { number: "2", unit: 2, bodyStyle: 1, hidden: true },
      { number: "1", unit: 1, bodyStyle: 2 },
    ]);
    const footprint = footprintAsset("footprintv_multiunit");
    const certificate = mappingFor(symbol, footprint);
    expect(certificate.state).toBe("approved");
    expect(certificate.logicalPadNumbers).toEqual(["1", "2"]);
    expect(certificate.symbolPinIds).toHaveLength(3);
  });

  it("classifies unnumbered/NPTH pads as mechanical without creating extra electrical pads", () => {
    const symbol = symbolAsset("symbolv_mechanical");
    const footprint = footprintAsset("footprintv_mechanical", [{ number: "1" }, { number: "2" }, { number: "", mechanical: true }]);
    const certificate = mappingFor(symbol, footprint);
    expect(certificate.state).toBe("approved");
    expect(certificate.mechanicalPadIds).toHaveLength(1);
    expect(certificate.extraElectricalPadNumbers).toEqual([]);
  });

  it("keeps exposed-pad classification and physical pad instances explicit", () => {
    const symbol = symbolAsset("symbolv_exposed", [{ number: "1" }, { number: "EP" }]);
    const footprint = footprintAsset("footprintv_exposed", [{ number: "1" }, { number: "EP", id: "pad_ep" }]);
    const terminalList = [
      ...terminals(["1"]),
      { id: "terminal_EP", publishedIdentifier: "EP", function: "thermal ground", classification: "exposed_thermal" as const, evidenceIds: ["evidence_fixture"] },
    ];
    const certificate = buildMappingCertificate({
      exactPartId: "exact_fixture",
      symbol,
      footprint,
      terminals: terminalList,
      mapping: [
        { manufacturerTerminalId: "terminal_1", symbolPinNumbers: ["1"], logicalPadNumbers: ["1"], evidenceIds: ["evidence_fixture"] },
        { manufacturerTerminalId: "terminal_EP", symbolPinNumbers: ["EP"], logicalPadNumbers: ["EP"], classification: "exposed_thermal", evidenceIds: ["evidence_fixture"] },
      ],
      packageProof: provePackage({ exactPartId: "exact_fixture", footprintVersionId: footprint.versionId, evidenceIds: ["evidence_fixture"], checks: [{ field: "ep", expected: "EP", actual: "EP" }] }),
    });
    expect(certificate.state).toBe("approved");
    expect(certificate.exposedPadIds).toEqual(["pad_ep"]);
  });

  it("treats package name/filter similarity as a candidate, never proof", () => {
    const proof = provePackage({
      exactPartId: "exact_fixture",
      footprintVersionId: "footprintv_similar_name",
      packageCode: "QFN-32",
      evidenceIds: [],
      checks: [{ field: "name", expected: "QFN-32", actual: "QFN-32" }],
    });
    expect(proof.state).toBe("candidate");
  });

  it("keeps NC, DNC, and NU classifications distinct", () => {
    const symbol = symbolAsset("symbolv_nc", [{ number: "1" }, { number: "2" }, { number: "3" }]);
    const footprint = footprintAsset("footprintv_nc", [{ number: "1" }, { number: "2" }, { number: "3" }]);
    const terminalList = [
      { id: "terminal_1", publishedIdentifier: "1", function: "signal", classification: "electrical" as const, evidenceIds: ["evidence_fixture"] },
      { id: "terminal_2", publishedIdentifier: "2", function: "NC", classification: "nc" as const, evidenceIds: ["evidence_fixture"] },
      { id: "terminal_3", publishedIdentifier: "3", function: "DNC", classification: "dnc" as const, evidenceIds: ["evidence_fixture"] },
    ];
    const certificate = buildMappingCertificate({
      exactPartId: "exact_fixture",
      symbol,
      footprint,
      terminals: terminalList,
      mapping: terminalList.map((terminal) => ({ manufacturerTerminalId: terminal.id, symbolPinNumbers: [terminal.publishedIdentifier], logicalPadNumbers: [terminal.publishedIdentifier], classification: terminal.classification, evidenceIds: terminal.evidenceIds })),
      packageProof: packageProof(footprint.versionId, ["evidence_fixture"], 3),
    });
    expect(certificate.state).toBe("approved");
    expect(certificate.entries.map((entry) => entry.classification)).toEqual(["electrical", "nc", "dnc"]);
  });
});

describe("Stage 5 exact identity boundaries", () => {
  it("normalizes only a search key and never merges published suffix variants", () => {
    expect(normalizeMpnSearchKey("STM32F401-CCT6")).toBe("STM32F401CCT6");
    expect(exactManufacturerPartId("st", "STM32F401CCT6")).not.toBe(exactManufacturerPartId("st", "STM32F401RCT6"));
    expect(exactManufacturerPartId("manufacturer-a", "ABC-1")).not.toBe(exactManufacturerPartId("manufacturer-b", "ABC-1"));
  });

  it("keeps supplier SKU identity separate from exact manufacturer identity", () => {
    expect(supplierPartId("digikey", "296-123-ND")).not.toBe(exactManufacturerPartId("ti", "TPS123"));
  });
});

describe("Stage 5 typed quantities and claims", () => {
  it("normalizes SI prefixes and retains source text", () => {
    const value = quantity({ value: 10, unit: "uF", sourceText: "10 µF ±20%" });
    expect(value.value).toBeCloseTo(10e-6);
    expect(value.dimension).toBe("capacitance");
    expect(value.sourceText).toBe("10 µF ±20%");
  });

  it("normalizes Celsius ranges to kelvin without losing representation", () => {
    const value = quantity({ min: -40, max: 85, unit: "°C", sourceText: "-40 °C to +85 °C" });
    expect(value.min).toBeCloseTo(233.15);
    expect(value.max).toBeCloseTo(358.15);
    expect(value.sourceUnit).toBe("°C");
  });

  it("rejects invalid ranges and dimensional comparisons", () => {
    expect(() => quantity({ min: 5, max: 2, unit: "V", sourceText: "bad" })).toThrow(QuantityError);
    expect(() => compareQuantities(
      quantity({ value: 1, unit: "V", sourceText: "1 V" }),
      quantity({ value: 1, unit: "A", sourceText: "1 A" }),
    )).toThrow(/Dimension mismatch/);
  });

  it("requires full interval coverage for range containment", () => {
    const candidate = quantity({ min: 2.7, max: 3.6, unit: "V", sourceText: "2.7-3.6 V" });
    expect(rangeContains(candidate, quantity({ min: 3, max: 3.3, unit: "V", sourceText: "3-3.3 V" }))).toBe(true);
    expect(rangeContains(candidate, quantity({ min: 3, max: 5, unit: "V", sourceText: "3-5 V" }))).toBe(false);
  });

  it("blocks unresolved safety-critical conflicts instead of latest-wins", () => {
    const conflict: EngineeringClaim = { ...VOLTAGE_RECOMMENDED, id: "claim_conflict", state: "conflicting", conflictsWith: [VOLTAGE_RECOMMENDED.id] };
    const result = effectiveClaim([VOLTAGE_RECOMMENDED, conflict], new Map(), new Map(), new Map());
    expect(result.claim).toBeNull();
    expect(result.reason).toContain("safety-critical conflict");
  });
});
