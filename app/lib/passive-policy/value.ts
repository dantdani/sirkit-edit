import type { NormalizedPassiveValue, PassiveDimension } from "./types";

const PARSER_VERSION = "sirkit.passive-value-parser/1" as const;
const CANONICAL_UNIT: Record<PassiveDimension, string> = { dimensionless: "1", resistance: "Ω", capacitance: "F", inductance: "H", impedance: "Ω", voltage: "V", power: "W", current: "A", temperature: "K", temperature_coefficient: "1/K", frequency: "Hz" };
const PREFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3, "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };

function bounded(source: string): string { const text = source.normalize("NFC").trim(); if (!text || text.length > 64 || /[\u0000-\u001f\u007f]/.test(text) || text.includes(",")) throw new Error("PP_VALUE_SYNTAX_INVALID"); return text; }
function finite(value: number): number { if (!Number.isFinite(value) || Math.abs(value) > 1e100 || (value !== 0 && Math.abs(value) < 1e-100)) throw new Error("PP_VALUE_RANGE_INVALID"); return value; }

export function parsePassiveValue(source: string, dimension: PassiveDimension): NormalizedPassiveValue {
  const text = bounded(source), compact = text.replace(/\s+/g, "").replace(/ohms?/i, "Ω");
  if (dimension === "resistance") {
    const embedded = /^([+-]?\d+)([RrKkMmG])(\d+)$/.exec(compact);
    if (embedded) {
      const marker = embedded[2]!, multiplier = marker.toUpperCase() === "R" ? 1 : marker.toUpperCase() === "K" ? 1e3 : marker === "M" ? 1e6 : marker.toUpperCase() === "G" ? 1e9 : 1e-3;
      return { dimension, valueSI: finite(Number(`${embedded[1]}.${embedded[3]}`) * multiplier), canonicalUnit: "Ω", sourceText: text, parserVersion: PARSER_VERSION };
    }
  }
  const suffixes: Record<PassiveDimension, RegExp> = {
    dimensionless: /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(%|1)?$/,
    resistance: /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([pnuµμmkKMG]?)(?:Ω|R)?$/,
    capacitance: /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([pnuµμmkKMG]?)(?:F)?$/,
    inductance: /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([pnuµμmkKMG]?)(?:H)?$/,
    impedance: /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([pnuµμmkKMG]?)(?:Ω)?$/,
    voltage: /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([pnuµμmkKMG]?)(?:V)$/,
    power: /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([pnuµμmkKMG]?)(?:W)$/,
    current: /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([pnuµμmkKMG]?)(?:A)$/,
    temperature: /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:°?C|K)$/,
    temperature_coefficient: /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:ppm\/K)$/i,
    frequency: /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([pnuµμmkKMG]?)(?:Hz)$/,
  };
  const match = suffixes[dimension].exec(compact); if (!match) throw new Error("PP_VALUE_UNIT_OR_DIMENSION_INVALID");
  let value = Number(match[1]);
  if (dimension === "dimensionless" && match[2] === "%") value *= 0.01;
  else if (dimension === "temperature") { if (/C$/i.test(compact)) value += 273.15; }
  else if (dimension === "temperature_coefficient") value *= 1e-6;
  else value *= PREFIX[match[2] ?? ""] ?? 1;
  return { dimension, valueSI: finite(value), canonicalUnit: CANONICAL_UNIT[dimension], sourceText: text, parserVersion: PARSER_VERSION };
}
