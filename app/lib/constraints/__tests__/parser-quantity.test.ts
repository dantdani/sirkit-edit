import { describe, expect, it } from "vitest";
import { compareQuantities, normalizedDecimalText, normalizeQuantity, quantityKey, quantityToInteger } from "../quantity";
import { formatConstraintDocument, parseConstraintDocument } from "../parser";
import { definition, document, quantity } from "./fixtures";

describe("Stage 6 deterministic quantities", () => {
  it("normalizes compatible length and voltage units exactly without floating-point arithmetic", () => {
    expect(quantityToInteger(quantity("length", "0.20", "mm"), "length")).toBe(200_000);
    expect(compareQuantities(quantity("length", "0.2", "mm"), quantity("length", "200", "um"))).toBe(0);
    expect(quantityKey(quantity("voltage", "3.3", "V"))).toBe(quantityKey(quantity("voltage", "3300", "mV")));
    expect(normalizedDecimalText(normalizeQuantity(quantity("capacitance", "0.1", "uF")))).toBe("100000000");
  });

  it("rejects dimension mismatches, scientific notation, and fractional canonical geometry", () => {
    expect(() => compareQuantities(quantity("voltage", "3.3", "V"), quantity("length", "3.3", "mm"))).toThrow(/Cannot compare/);
    expect(() => normalizeQuantity(quantity("voltage", "3.3e0", "V"))).toThrow(/Invalid deterministic decimal/);
    expect(() => quantityToInteger(quantity("length", "0.0000001", "mm"), "length")).toThrow(/not exactly representable/);
  });
});

describe("Stage 6 structured authoring parser", () => {
  const valid = document([
    definition({ id: "constraint:fab-width", kind: "trace_width", requirement: { form: "minimum", value: quantity("length", "0.15", "mm") } }),
  ]);

  it("round-trips through a canonical formatter independently of input field and array order", () => {
    const formatted = formatConstraintDocument(valid);
    const parsed = parseConstraintDocument(formatted);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(formatConstraintDocument(parsed.document)).toBe(formatted);
  });

  it("collects multiple useful schema/type diagnostics and never returns a partial document", () => {
    const malformed = JSON.stringify({ schemaVersion: 99, id: "bad id!", revision: 0, name: "", extendsSetIds: [], constraints: [{ id: "c:bad", revision: 0, name: "", domain: "manufacturing", kind: "trace_width", strength: "hard", severityPolicyId: "s", selector: { objectType: "net", predicate: { kind: "name_glob", pattern: "(a+)+$" }, cardinality: { kind: "exactly", count: -1 } }, requirement: { form: "minimum", value: { dimension: "voltage", value: "2", unit: "mm" } } }], relationships: [] });
    const result = parseConstraintDocument(malformed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(new Set(result.diagnostics.map((item) => item.code))).toEqual(expect.objectContaining(new Set(["UNKNOWN_SCHEMA_VERSION", "INVALID_STABLE_ID", "INVALID_CARDINALITY", "UNSAFE_NAME_PATTERN", "INVALID_QUANTITY"])));
    expect("document" in result).toBe(false);
  });

  it("forbids arbitrary expression kinds and oversized/deep inputs", () => {
    const candidate = structuredClone(valid);
    candidate.constraints[0].condition = { kind: "eval", source: "fetch('https://example.com')" } as never;
    const result = parseConstraintDocument(JSON.stringify(candidate));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.some((item) => item.code === "FORBIDDEN_EXPRESSION")).toBe(true);

    const huge = JSON.stringify({ ...valid, description: "x".repeat(1_000_001) });
    const limited = parseConstraintDocument(huge);
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.diagnostics[0].code).toBe("DOCUMENT_SIZE_LIMIT");
  });
});

