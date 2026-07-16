export type UnitDimension =
  | "dimensionless"
  | "time"
  | "frequency"
  | "voltage"
  | "current"
  | "resistance"
  | "capacitance"
  | "inductance"
  | "power"
  | "energy"
  | "temperature"
  | "angle";

export interface ParsedEngineeringValue {
  raw: string;
  value: number;
  unit: string;
  dimension: UnitDimension;
  normalized: string;
}

const PREFIXES: Record<string, number> = {
  t: 1e12,
  g: 1e9,
  meg: 1e6,
  k: 1e3,
  "": 1,
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
};

const UNITS: Array<{ aliases: string[]; canonical: string; dimension: UnitDimension; scale?: number }> = [
  { aliases: ["", "1"], canonical: "", dimension: "dimensionless" },
  { aliases: ["s", "sec", "second", "seconds"], canonical: "s", dimension: "time" },
  { aliases: ["hz", "hertz"], canonical: "Hz", dimension: "frequency" },
  { aliases: ["v", "volt", "volts"], canonical: "V", dimension: "voltage" },
  { aliases: ["a", "amp", "amps", "ampere", "amperes"], canonical: "A", dimension: "current" },
  { aliases: ["ohm", "ohms", "Ω", "ω"], canonical: "Ω", dimension: "resistance" },
  { aliases: ["f", "farad", "farads"], canonical: "F", dimension: "capacitance" },
  { aliases: ["h", "henry", "henries"], canonical: "H", dimension: "inductance" },
  { aliases: ["w", "watt", "watts"], canonical: "W", dimension: "power" },
  { aliases: ["j", "joule", "joules"], canonical: "J", dimension: "energy" },
  { aliases: ["c", "°c", "degc", "celsius"], canonical: "°C", dimension: "temperature" },
  { aliases: ["deg", "degree", "degrees", "°"], canonical: "°", dimension: "angle" },
  { aliases: ["%", "percent"], canonical: "%", dimension: "dimensionless", scale: 0.01 },
];

const SPICE_SUFFIX_BY_FACTOR = new Map<number, string>([
  [1e12, "T"],
  [1e9, "G"],
  [1e6, "Meg"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "u"],
  [1e-9, "n"],
  [1e-12, "p"],
  [1e-15, "f"],
]);

function resolveUnit(rawUnit: string): { canonical: string; dimension: UnitDimension; scale: number } | null {
  const normalized = rawUnit.trim().toLowerCase();
  for (const definition of UNITS) {
    if (definition.aliases.some((alias) => alias.toLowerCase() === normalized)) {
      return { canonical: definition.canonical, dimension: definition.dimension, scale: definition.scale ?? 1 };
    }
  }
  return null;
}

export function parseEngineeringValue(raw: string, expectedDimension?: UnitDimension): ParsedEngineeringValue | null {
  const input = raw.trim().replace(/µ/g, "u").replace(/−/g, "-");
  if (input === "") return null;
  const match = input.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(meg|[tgkmunpf])?\s*([a-zA-ZΩω°%]*)$/i);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return null;
  let prefixToken = (match[2] ?? "").toLowerCase();
  const rawUnit = match[3] ?? "";

  // In engineering prose an uppercase M means mega. ngspice itself uses Meg.
  if (match[2] === "M") prefixToken = "meg";
  const prefix = PREFIXES[prefixToken];
  if (prefix === undefined) return null;

  let unit = resolveUnit(rawUnit);
  if (!unit && rawUnit !== "") {
    // Compact forms such as 10mV can be parsed ambiguously by the regex when
    // the suffix letter is consumed as a prefix. Reinterpret a lone suffix as
    // the unit when it matches the expected dimension.
    unit = resolveUnit(`${match[2] ?? ""}${rawUnit}`);
    if (unit) prefixToken = "";
  }
  unit ??= resolveUnit("")!;
  if (expectedDimension && unit.dimension !== "dimensionless" && unit.dimension !== expectedDimension) return null;

  const value = numeric * (PREFIXES[prefixToken] ?? 1) * unit.scale;
  return {
    raw,
    value,
    unit: unit.canonical,
    dimension: unit.dimension === "dimensionless" && expectedDimension ? expectedDimension : unit.dimension,
    normalized: `${formatNumber(value)}${unit.canonical}`,
  };
}

export function parseRequiredEngineeringValue(raw: string, expectedDimension?: UnitDimension): ParsedEngineeringValue {
  const parsed = parseEngineeringValue(raw, expectedDimension);
  if (!parsed) throw new Error(`Invalid engineering value: ${raw}`);
  return parsed;
}

export function formatNumber(value: number, significantDigits = 8): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || magnitude < 1e-4) return value.toExponential(Math.max(1, significantDigits - 1)).replace(/\.0+e/, "e");
  return Number(value.toPrecision(significantDigits)).toString();
}

export function formatEngineering(value: number, unit = "", significantDigits = 4): string {
  if (!Number.isFinite(value)) return `${String(value)} ${unit}`.trim();
  if (value === 0) return `0${unit}`;
  const magnitude = Math.abs(value);
  const factors = [...SPICE_SUFFIX_BY_FACTOR.keys()].sort((a, b) => b - a);
  const factor = factors.find((candidate) => magnitude >= candidate) ?? 1e-15;
  const suffix = SPICE_SUFFIX_BY_FACTOR.get(factor) ?? "";
  const scaled = value / factor;
  return `${Number(scaled.toPrecision(significantDigits))}${suffix}${unit}`;
}

/** Normalize user-entered values into an ngspice-safe scalar suffix. */
export function toSpiceValue(raw: string, expectedDimension?: UnitDimension): string {
  const input = raw.trim().replace(/µ/g, "u").replace(/Ω|ω/g, "").replace(/−/g, "-");
  if (/^\{[^{}]+\}$/.test(input) || /^[A-Za-z_][A-Za-z0-9_]*(?:\s*[+*/-].+)?$/.test(input)) return input;
  const parsed = parseEngineeringValue(raw, expectedDimension);
  if (!parsed) {
    // Preserve legitimate ngspice expressions and source waveforms. Validation
    // decides whether they are acceptable in the context where they are used.
    return input.replace(/M(?!eg)/g, "Meg");
  }
  const magnitude = Math.abs(parsed.value);
  const factors = [...SPICE_SUFFIX_BY_FACTOR.keys()].sort((a, b) => b - a);
  const factor = factors.find((candidate) => magnitude === 0 || magnitude >= candidate) ?? 1e-15;
  const suffix = SPICE_SUFFIX_BY_FACTOR.get(factor) ?? "";
  return `${formatNumber(parsed.value / factor)}${suffix}`;
}

export function seconds(raw: string): number {
  return parseRequiredEngineeringValue(raw, "time").value;
}

export function hertz(raw: string): number {
  return parseRequiredEngineeringValue(raw, "frequency").value;
}

export function unitForVector(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "time") return "s";
  if (lower === "frequency") return "Hz";
  if (lower.startsWith("v(")) return "V";
  if (lower.startsWith("i(")) return "A";
  if (lower.includes("power") || lower.startsWith("p(")) return "W";
  if (lower.endsWith(".phase")) return "°";
  if (lower.endsWith(".mag")) return "dB";
  return "";
}
