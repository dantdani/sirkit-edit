import type { Quantity, QuantityDimension } from "./types";

export class QuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuantityError";
  }
}

type UnitDefinition = { dimension: QuantityDimension; factor: number; offset?: number; canonical: string };

// [B19-D I5d row 50] no empty unit: "no unit" and "forgot the unit" were the same key. Dimensionless is written "1".
const UNITS: Record<string, UnitDefinition> = {
  "1": { dimension: "dimensionless", factor: 1, canonical: "1" },
  "%": { dimension: "dimensionless", factor: 0.01, canonical: "1" },
  V: { dimension: "voltage", factor: 1, canonical: "V" },
  mV: { dimension: "voltage", factor: 1e-3, canonical: "V" },
  uV: { dimension: "voltage", factor: 1e-6, canonical: "V" },
  µV: { dimension: "voltage", factor: 1e-6, canonical: "V" },
  kV: { dimension: "voltage", factor: 1e3, canonical: "V" },
  A: { dimension: "current", factor: 1, canonical: "A" },
  mA: { dimension: "current", factor: 1e-3, canonical: "A" },
  uA: { dimension: "current", factor: 1e-6, canonical: "A" },
  µA: { dimension: "current", factor: 1e-6, canonical: "A" },
  nA: { dimension: "current", factor: 1e-9, canonical: "A" },
  ohm: { dimension: "resistance", factor: 1, canonical: "Ω" },
  Ω: { dimension: "resistance", factor: 1, canonical: "Ω" },
  R: { dimension: "resistance", factor: 1, canonical: "Ω" },
  kohm: { dimension: "resistance", factor: 1e3, canonical: "Ω" },
  kΩ: { dimension: "resistance", factor: 1e3, canonical: "Ω" },
  kR: { dimension: "resistance", factor: 1e3, canonical: "Ω" },
  Mohm: { dimension: "resistance", factor: 1e6, canonical: "Ω" },
  MΩ: { dimension: "resistance", factor: 1e6, canonical: "Ω" },
  F: { dimension: "capacitance", factor: 1, canonical: "F" },
  mF: { dimension: "capacitance", factor: 1e-3, canonical: "F" },
  uF: { dimension: "capacitance", factor: 1e-6, canonical: "F" },
  µF: { dimension: "capacitance", factor: 1e-6, canonical: "F" },
  nF: { dimension: "capacitance", factor: 1e-9, canonical: "F" },
  pF: { dimension: "capacitance", factor: 1e-12, canonical: "F" },
  H: { dimension: "inductance", factor: 1, canonical: "H" },
  mH: { dimension: "inductance", factor: 1e-3, canonical: "H" },
  uH: { dimension: "inductance", factor: 1e-6, canonical: "H" },
  µH: { dimension: "inductance", factor: 1e-6, canonical: "H" },
  nH: { dimension: "inductance", factor: 1e-9, canonical: "H" },
  W: { dimension: "power", factor: 1, canonical: "W" },
  mW: { dimension: "power", factor: 1e-3, canonical: "W" },
  kW: { dimension: "power", factor: 1e3, canonical: "W" },
  Hz: { dimension: "frequency", factor: 1, canonical: "Hz" },
  kHz: { dimension: "frequency", factor: 1e3, canonical: "Hz" },
  MHz: { dimension: "frequency", factor: 1e6, canonical: "Hz" },
  GHz: { dimension: "frequency", factor: 1e9, canonical: "Hz" },
  s: { dimension: "time", factor: 1, canonical: "s" },
  ms: { dimension: "time", factor: 1e-3, canonical: "s" },
  us: { dimension: "time", factor: 1e-6, canonical: "s" },
  µs: { dimension: "time", factor: 1e-6, canonical: "s" },
  ns: { dimension: "time", factor: 1e-9, canonical: "s" },
  K: { dimension: "temperature", factor: 1, canonical: "K" },
  C: { dimension: "temperature", factor: 1, offset: 273.15, canonical: "K" },
  "°C": { dimension: "temperature", factor: 1, offset: 273.15, canonical: "K" },
  m: { dimension: "length", factor: 1, canonical: "m" },
  mm: { dimension: "length", factor: 1e-3, canonical: "m" },
  um: { dimension: "length", factor: 1e-6, canonical: "m" },
  µm: { dimension: "length", factor: 1e-6, canonical: "m" },
  in: { dimension: "length", factor: 0.0254, canonical: "m" },
  g: { dimension: "mass", factor: 1e-3, canonical: "kg" },
  kg: { dimension: "mass", factor: 1, canonical: "kg" },
};

function unitDefinition(unit: string): UnitDefinition {
  const normalized = unit.trim().replace(/^μ/, "µ");
  if (normalized === "") throw new QuantityError('A unit is required (write "1" for a dimensionless value)');
  // own entries only; compatibility forms (the Ohm sign, the degree-Celsius sign) are not silently folded into units
  const definition = Object.hasOwn(UNITS, normalized) ? UNITS[normalized] : undefined;
  if (!definition) throw new QuantityError(`Unsupported engineering unit: ${unit}`);
  return definition;
}

/**
 * [B19-D I5d row 50] Spellings whose source text reads as a different magnitude than the unit claims: `10K` is ten kilo-ohms
 * on a schematic, not ten kelvin; `MF`/`MFD` is the legacy microfarad, not a millifarad; `1M` after a digit is mega. The
 * extractor must say which it meant — with a unit whose source text agrees — rather than have the quantity guess.
 */
const AMBIGUOUS_SOURCE_TEXT: ReadonlyArray<{ units: ReadonlySet<string>; pattern: RegExp; reason: string }> = [
  { units: new Set(["K"]), pattern: /\d[Kk](?![A-Za-z])|\d\s+k(?![A-Za-z])/, reason: "a digit followed by K, or by a lower-case k, reads as kilo, not kelvin" },
  { units: new Set(["mF"]), pattern: /[Mm][Ff][Dd]|(?:^|[\d\s])MF(?![A-Za-z])/, reason: "MF and MFD are the legacy microfarad spellings" },
  { units: new Set(["m"]), pattern: /\dM(?![A-Za-z])/, reason: "M after a digit reads as mega" },
  { units: new Set(["MΩ", "Mohm"]), pattern: /\d\s*m(?:[Ω\u2126]|[Oo][Hh][Mm])/, reason: "a lower-case m before the ohm is milli" },
];

function finite(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) throw new QuantityError(`${field} must be finite`);
  return value;
}

function convert(value: number | undefined, definition: UnitDefinition): number | undefined {
  const checked = finite(value, "quantity value");
  return checked === undefined ? undefined : checked * definition.factor + (definition.offset ?? 0);
}

/** Normalize a quantity to SI while retaining the source representation. */
export function quantity(input: {
  value?: number;
  min?: number;
  typical?: number;
  max?: number;
  toleranceMinus?: number;
  tolerancePlus?: number;
  /** [B19-D I5d row 50] a symmetric tolerance as a percentage of the nominal value (e.g. 1 for "1 %") */
  tolerancePercent?: number;
  unit: string;
  sourceText: string;
}): Quantity {
  const definition = unitDefinition(input.unit);
  const normalizedUnit = input.unit.trim().replace(/^μ/, "µ");
  for (const rule of AMBIGUOUS_SOURCE_TEXT) {
    if (rule.units.has(normalizedUnit) && rule.pattern.test(input.sourceText)) throw new QuantityError(`The unit ${normalizedUnit} is ambiguous with its source text: ${rule.reason}`);
  }
  const normalized: Quantity = {
    dimension: definition.dimension,
    sourceText: input.sourceText,
    sourceUnit: input.unit,
  };
  normalized.value = convert(input.value, definition);
  normalized.min = convert(input.min, definition);
  normalized.typical = convert(input.typical, definition);
  normalized.max = convert(input.max, definition);
  // A temperature tolerance is a delta, so it must not receive the Celsius offset.
  normalized.toleranceMinus = finite(input.toleranceMinus, "toleranceMinus") === undefined
    ? undefined
    : Math.abs(input.toleranceMinus!) * definition.factor;
  normalized.tolerancePlus = finite(input.tolerancePlus, "tolerancePlus") === undefined
    ? undefined
    : Math.abs(input.tolerancePlus!) * definition.factor;
  const percent = finite(input.tolerancePercent, "tolerancePercent");
  if (percent !== undefined) {
    if (percent < 0) throw new QuantityError("tolerancePercent must not be negative");
    if (input.toleranceMinus !== undefined || input.tolerancePlus !== undefined) throw new QuantityError("Give tolerancePercent or absolute tolerances, not both");
    if (input.value === undefined) throw new QuantityError("tolerancePercent needs a nominal value");
    if (definition.offset) throw new QuantityError("tolerancePercent is not defined for an offset unit; give an absolute tolerance");
    const delta = (Math.abs(input.value) * definition.factor * percent) / 100;
    normalized.toleranceMinus = delta;
    normalized.tolerancePlus = delta;
  }

  const ordered = [normalized.min, normalized.typical, normalized.max]
    .filter((item): item is number => item !== undefined);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index] < ordered[index - 1]) {
      throw new QuantityError("Quantity range must satisfy min <= typical <= max");
    }
  }
  if (
    normalized.value === undefined && normalized.min === undefined &&
    normalized.typical === undefined && normalized.max === undefined
  ) {
    throw new QuantityError("Quantity must include a value or range");
  }
  return normalized;
}

export function scalarValue(value: Quantity): number | undefined {
  return value.value ?? value.typical ?? value.min ?? value.max;
}

export function assertSameDimension(a: Quantity, b: Quantity): void {
  if (a.dimension !== b.dimension) {
    throw new QuantityError(`Dimension mismatch: ${a.dimension} versus ${b.dimension}`);
  }
}

/** True only when the candidate's known interval completely covers required. */
export function rangeContains(candidate: Quantity, required: Quantity): boolean | null {
  assertSameDimension(candidate, required);
  const candidateMin = candidate.min ?? candidate.value ?? candidate.typical;
  const candidateMax = candidate.max ?? candidate.value ?? candidate.typical;
  const requiredMin = required.min ?? required.value ?? required.typical;
  const requiredMax = required.max ?? required.value ?? required.typical;
  if (
    candidateMin === undefined || candidateMax === undefined ||
    requiredMin === undefined || requiredMax === undefined
  ) return null;
  return candidateMin <= requiredMin && candidateMax >= requiredMax;
}

export function compareQuantities(a: Quantity, b: Quantity): number | null {
  assertSameDimension(a, b);
  const av = scalarValue(a);
  const bv = scalarValue(b);
  return av === undefined || bv === undefined ? null : av - bv;
}

