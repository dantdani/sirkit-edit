import type { ConstraintQuantity, QuantityDimension } from "./types";

interface UnitDefinition {
  dimension: QuantityDimension;
  /** Power of ten from source unit into the dimension's canonical integer unit. */
  canonicalPower: number;
}

const UNITS: Record<string, UnitDefinition> = {
  "1": { dimension: "dimensionless", canonicalPower: 0 },
  "%": { dimension: "dimensionless", canonicalPower: -2 },
  V: { dimension: "voltage", canonicalPower: 6 },
  mV: { dimension: "voltage", canonicalPower: 3 },
  uV: { dimension: "voltage", canonicalPower: 0 },
  A: { dimension: "current", canonicalPower: 6 },
  mA: { dimension: "current", canonicalPower: 3 },
  uA: { dimension: "current", canonicalPower: 0 },
  ohm: { dimension: "resistance", canonicalPower: 6 },
  kohm: { dimension: "resistance", canonicalPower: 9 },
  mohm: { dimension: "resistance", canonicalPower: 3 },
  uohm: { dimension: "resistance", canonicalPower: 0 },
  Ohm: { dimension: "impedance", canonicalPower: 6 },
  kOhm: { dimension: "impedance", canonicalPower: 9 },
  uOhm: { dimension: "impedance", canonicalPower: 0 },
  F: { dimension: "capacitance", canonicalPower: 15 },
  uF: { dimension: "capacitance", canonicalPower: 9 },
  nF: { dimension: "capacitance", canonicalPower: 6 },
  pF: { dimension: "capacitance", canonicalPower: 3 },
  fF: { dimension: "capacitance", canonicalPower: 0 },
  H: { dimension: "inductance", canonicalPower: 12 },
  mH: { dimension: "inductance", canonicalPower: 9 },
  uH: { dimension: "inductance", canonicalPower: 6 },
  nH: { dimension: "inductance", canonicalPower: 3 },
  pH: { dimension: "inductance", canonicalPower: 0 },
  W: { dimension: "power", canonicalPower: 6 },
  mW: { dimension: "power", canonicalPower: 3 },
  uW: { dimension: "power", canonicalPower: 0 },
  J: { dimension: "energy", canonicalPower: 6 },
  mJ: { dimension: "energy", canonicalPower: 3 },
  uJ: { dimension: "energy", canonicalPower: 0 },
  C: { dimension: "charge", canonicalPower: 6 },
  mC: { dimension: "charge", canonicalPower: 3 },
  uC: { dimension: "charge", canonicalPower: 0 },
  Hz: { dimension: "frequency", canonicalPower: 3 },
  kHz: { dimension: "frequency", canonicalPower: 6 },
  MHz: { dimension: "frequency", canonicalPower: 9 },
  mHz: { dimension: "frequency", canonicalPower: 0 },
  s: { dimension: "time", canonicalPower: 9 },
  ms: { dimension: "time", canonicalPower: 6 },
  us: { dimension: "time", canonicalPower: 3 },
  ns: { dimension: "time", canonicalPower: 0 },
  K: { dimension: "temperature", canonicalPower: 3 },
  mK: { dimension: "temperature", canonicalPower: 0 },
  m: { dimension: "length", canonicalPower: 9 },
  mm: { dimension: "length", canonicalPower: 6 },
  um: { dimension: "length", canonicalPower: 3 },
  nm: { dimension: "length", canonicalPower: 0 },
  kg: { dimension: "mass", canonicalPower: 9 },
  g: { dimension: "mass", canonicalPower: 6 },
  mg: { dimension: "mass", canonicalPower: 3 },
  ug: { dimension: "mass", canonicalPower: 0 },
};

/** `sign * digits * 10^-scale`, with no leading/trailing zero ambiguity. */
export interface NormalizedDecimal {
  sign: -1 | 0 | 1;
  digits: string;
  scale: number;
}

const DECIMAL = /^[-+]?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function normalize(value: NormalizedDecimal): NormalizedDecimal {
  let digits = value.digits.replace(/^0+/, "") || "0";
  let scale = value.scale;
  while (digits.length > 1 && digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    scale -= 1;
  }
  return digits === "0" ? { sign: 0, digits: "0", scale: 0 } : { sign: value.sign, digits, scale };
}

export function parseDecimal(value: string): NormalizedDecimal {
  if (!DECIMAL.test(value) || value.length > 80) throw new Error(`Invalid deterministic decimal '${value}'.`);
  const sign: -1 | 1 = value.startsWith("-") ? -1 : 1;
  const unsigned = value.replace(/^[-+]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  return normalize({ sign, digits: `${whole}${fraction}`, scale: fraction.length });
}

export function normalizeQuantity(quantity: ConstraintQuantity): NormalizedDecimal {
  const unit = UNITS[quantity.unit];
  if (!unit) throw new Error(`Unsupported unit '${quantity.unit}'.`);
  if (unit.dimension !== quantity.dimension) throw new Error(`Unit '${quantity.unit}' is ${unit.dimension}, not ${quantity.dimension}.`);
  const decimal = parseDecimal(quantity.value);
  return normalize({ ...decimal, scale: decimal.scale - unit.canonicalPower });
}

function compareMagnitude(left: NormalizedDecimal, right: NormalizedDecimal): number {
  const leftWholeDigits = left.digits.length - left.scale;
  const rightWholeDigits = right.digits.length - right.scale;
  if (leftWholeDigits !== rightWholeDigits) return leftWholeDigits < rightWholeDigits ? -1 : 1;
  const commonScale = Math.max(left.scale, right.scale, 0);
  const a = left.digits + "0".repeat(commonScale - left.scale);
  const b = right.digits + "0".repeat(commonScale - right.scale);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareQuantities(left: ConstraintQuantity, right: ConstraintQuantity): number {
  if (left.dimension !== right.dimension) throw new Error(`Cannot compare ${left.dimension} with ${right.dimension}.`);
  const a = normalizeQuantity(left);
  const b = normalizeQuantity(right);
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1;
  if (a.sign === 0) return 0;
  return compareMagnitude(a, b) * a.sign;
}

export function quantityKey(quantity: ConstraintQuantity): string {
  const value = normalizeQuantity(quantity);
  return `${quantity.dimension}:${value.sign}:${value.digits}:${value.scale}`;
}

export function quantityToInteger(quantity: ConstraintQuantity, expectedDimension: QuantityDimension): number {
  if (quantity.dimension !== expectedDimension) throw new Error(`Expected ${expectedDimension}, received ${quantity.dimension}.`);
  const normalized = normalizeQuantity(quantity);
  if (normalized.scale > 0) throw new Error(`${quantity.value} ${quantity.unit} is not exactly representable in canonical units.`);
  const text = `${normalized.sign < 0 ? "-" : ""}${normalized.digits}${"0".repeat(-normalized.scale)}`;
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new Error("Quantity exceeds the safe consumer integer range.");
  return value;
}

export function validateQuantity(quantity: ConstraintQuantity): string[] {
  try {
    normalizeQuantity(quantity);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "Invalid quantity."];
  }
}

export function canonicalUnit(dimension: QuantityDimension): string {
  return {
    dimensionless: "1",
    voltage: "uV",
    current: "uA",
    resistance: "uohm",
    impedance: "uOhm",
    capacitance: "fF",
    inductance: "pH",
    power: "uW",
    energy: "uJ",
    charge: "uC",
    frequency: "mHz",
    time: "ns",
    temperature: "mK",
    length: "nm",
    mass: "ug",
  }[dimension];
}

export function normalizedDecimalText(value: NormalizedDecimal): string {
  if (value.sign === 0) return "0";
  if (value.scale <= 0) return `${value.sign < 0 ? "-" : ""}${value.digits}${"0".repeat(-value.scale)}`;
  const padded = value.digits.padStart(value.scale + 1, "0");
  return `${value.sign < 0 ? "-" : ""}${padded.slice(0, -value.scale)}.${padded.slice(-value.scale)}`;
}
