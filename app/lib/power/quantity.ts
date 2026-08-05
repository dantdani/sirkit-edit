import { canonicalUnit, compareQuantities, normalizeQuantity, normalizedDecimalText, validateQuantity } from "../constraints/quantity";
import type { ConstraintQuantity, QuantityDimension } from "../constraints/types";
import type { PowerQuantityRange } from "./types";

function canonicalNumber(quantity: ConstraintQuantity): number {
  const value = normalizeQuantity(quantity); const number = value.sign * Number(value.digits) * 10 ** (-value.scale);
  if (!Number.isFinite(number) || !Number.isSafeInteger(Math.trunc(number)) && Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new Error("POWER_QUANTITY_NUMERIC_RANGE_EXCEEDED");
  return number;
}

function text(value: number): string {
  if (!Number.isFinite(value)) throw new Error("POWER_QUANTITY_NON_FINITE");
  if (Object.is(value, -0) || value === 0) return "0";
  const result = value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(result)) throw new Error("POWER_QUANTITY_SERIALIZATION_FAILED"); return result;
}

function canonicalQuantity(dimension: QuantityDimension, value: number): ConstraintQuantity { return { dimension, value: text(value), unit: canonicalUnit(dimension) }; }

export function validatePowerRange(range: PowerQuantityRange): string[] {
  const errors = [...validateQuantity(range.min), ...validateQuantity(range.max)];
  if (range.dimension !== range.min.dimension || range.dimension !== range.max.dimension) errors.push("POWER_RANGE_DIMENSION_MISMATCH");
  try { if (compareQuantities(range.min, range.max) > 0) errors.push("POWER_RANGE_INVERTED"); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  return [...new Set(errors)].sort();
}

export function makePowerRange(min: ConstraintQuantity, max: ConstraintQuantity, metadata: Pick<PowerQuantityRange, "basis" | "conditionRefs" | "evidenceRefs" | "confidence">): PowerQuantityRange {
  const range = { dimension: min.dimension, min: structuredClone(min), max: structuredClone(max), ...structuredClone(metadata) }; const errors = validatePowerRange(range); if (errors.length) throw new Error(errors.join(",")); return range;
}

export function sumPowerRanges(ranges: readonly PowerQuantityRange[]): PowerQuantityRange | null {
  if (!ranges.length) return null; const dimension = ranges[0].dimension;
  if (ranges.some((item) => item.dimension !== dimension || validatePowerRange(item).length)) throw new Error("POWER_RANGE_SUM_INCOMPATIBLE");
  const min = ranges.reduce((sum, item) => sum + canonicalNumber(item.min), 0); const max = ranges.reduce((sum, item) => sum + canonicalNumber(item.max), 0);
  return makePowerRange(canonicalQuantity(dimension, min), canonicalQuantity(dimension, max), { basis: ranges.every((item) => item.basis.startsWith("guaranteed")) ? "guaranteed_maximum" : "bounded_estimate", conditionRefs: [...new Set(ranges.flatMap((item) => item.conditionRefs))].sort(), evidenceRefs: [...new Set(ranges.flatMap((item) => item.evidenceRefs))].sort(), confidence: ranges.some((item) => item.confidence === "low") ? "low" : ranges.some((item) => item.confidence === "medium") ? "medium" : "high" });
}

export function subtractPowerRanges(capacity: PowerQuantityRange, used: PowerQuantityRange): PowerQuantityRange {
  if (capacity.dimension !== used.dimension) throw new Error("POWER_RANGE_SUBTRACT_INCOMPATIBLE");
  return makePowerRange(canonicalQuantity(capacity.dimension, canonicalNumber(capacity.min) - canonicalNumber(used.max)), canonicalQuantity(capacity.dimension, canonicalNumber(capacity.max) - canonicalNumber(used.min)), { basis: "bounded_estimate", conditionRefs: [...new Set([...capacity.conditionRefs, ...used.conditionRefs])].sort(), evidenceRefs: [...new Set([...capacity.evidenceRefs, ...used.evidenceRefs])].sort(), confidence: capacity.confidence === "low" || used.confidence === "low" ? "low" : "medium" });
}

/** Exact dimension mapping with deterministic decimal output; ranges preserve independent-corner uncertainty. */
export function voltageCurrentPower(voltage: PowerQuantityRange, current: PowerQuantityRange): PowerQuantityRange {
  if (voltage.dimension !== "voltage" || current.dimension !== "current") throw new Error("POWER_VI_DIMENSION_INVALID");
  const values = [canonicalNumber(voltage.min) * canonicalNumber(current.min), canonicalNumber(voltage.min) * canonicalNumber(current.max), canonicalNumber(voltage.max) * canonicalNumber(current.min), canonicalNumber(voltage.max) * canonicalNumber(current.max)].map((item) => item / 1_000_000);
  return makePowerRange(canonicalQuantity("power", Math.min(...values)), canonicalQuantity("power", Math.max(...values)), { basis: "bounded_estimate", conditionRefs: [...new Set([...voltage.conditionRefs, ...current.conditionRefs])].sort(), evidenceRefs: [...new Set([...voltage.evidenceRefs, ...current.evidenceRefs])].sort(), confidence: voltage.confidence === "low" || current.confidence === "low" ? "low" : "medium" });
}

export function powerOverVoltageCurrent(power: PowerQuantityRange, voltage: PowerQuantityRange): PowerQuantityRange {
  if (power.dimension !== "power" || voltage.dimension !== "voltage") throw new Error("POWER_PV_DIMENSION_INVALID");
  const vMin = canonicalNumber(voltage.min); if (vMin <= 0) throw new Error("POWER_DIVISION_BY_NONPOSITIVE_VOLTAGE");
  const values = [canonicalNumber(power.min) / canonicalNumber(voltage.max), canonicalNumber(power.max) / vMin].map((item) => item * 1_000_000);
  return makePowerRange(canonicalQuantity("current", Math.min(...values)), canonicalQuantity("current", Math.max(...values)), { basis: "bounded_estimate", conditionRefs: [...new Set([...power.conditionRefs, ...voltage.conditionRefs])].sort(), evidenceRefs: [...new Set([...power.evidenceRefs, ...voltage.evidenceRefs])].sort(), confidence: "medium" });
}

export function applyEfficiency(outputPower: PowerQuantityRange, efficiency: PowerQuantityRange): { inputPower: PowerQuantityRange; loss: PowerQuantityRange } {
  if (outputPower.dimension !== "power" || efficiency.dimension !== "dimensionless") throw new Error("POWER_EFFICIENCY_DIMENSION_INVALID");
  const eMin = canonicalNumber(efficiency.min); const eMax = canonicalNumber(efficiency.max); if (eMin <= 0 || eMax > 1 || eMin > eMax) throw new Error("POWER_EFFICIENCY_RANGE_INVALID");
  const outMin = canonicalNumber(outputPower.min); const outMax = canonicalNumber(outputPower.max); const inputMin = outMin / eMax; const inputMax = outMax / eMin;
  const inputPower = makePowerRange(canonicalQuantity("power", inputMin), canonicalQuantity("power", inputMax), { basis: "bounded_estimate", conditionRefs: [...outputPower.conditionRefs], evidenceRefs: [...new Set([...outputPower.evidenceRefs, ...efficiency.evidenceRefs])].sort(), confidence: "medium" });
  const loss = makePowerRange(canonicalQuantity("power", Math.max(0, inputMin - outMax)), canonicalQuantity("power", Math.max(0, inputMax - outMin)), { basis: "bounded_estimate", conditionRefs: [...outputPower.conditionRefs], evidenceRefs: [...inputPower.evidenceRefs], confidence: "medium" }); return { inputPower, loss };
}

export function quantityRangeKey(range: PowerQuantityRange): string { return `${range.dimension}:${normalizedDecimalText(normalizeQuantity(range.min))}:${normalizedDecimalText(normalizeQuantity(range.max))}:${range.basis}`; }
