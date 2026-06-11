// Pure-functional formatting library. No DOM, no React, no side effects.
// Every formatter that previously lived inline in app/page.tsx (or other modules)
// now lives here. Existing chart code routes its tick labels through these.

const SI_PREFIXES: { factor: number; symbol: string }[] = [
  { factor: 1e9,   symbol: "G" },
  { factor: 1e6,   symbol: "M" },
  { factor: 1e3,   symbol: "k" },
  { factor: 1,     symbol: ""  },
  { factor: 1e-3,  symbol: "m" },
  { factor: 1e-6,  symbol: "µ" },
  { factor: 1e-9,  symbol: "n" },
  { factor: 1e-12, symbol: "p" },
];

// Format a number with an SI prefix.
//   formatSI(0.0015)              === "1.50m"
//   formatSI(1500)                === "1.50k"
//   formatSI(12, { decimals: 4 }) === "12.0000"
export function formatSI(value: number, options?: { decimals?: number }): string {
  const decimals = options?.decimals ?? 2;
  if (value === 0) return (0).toFixed(decimals);
  const abs = Math.abs(value);
  for (const { factor, symbol } of SI_PREFIXES) {
    if (abs >= factor) {
      return `${(value / factor).toFixed(decimals)}${symbol}`;
    }
  }
  return value.toExponential(Math.min(decimals, 6));
}

// formatWithUnit(0.001, "s") === "1.00ms"
export function formatWithUnit(
  value: number,
  unit: string,
  options?: { decimals?: number },
): string {
  return `${formatSI(value, options)}${unit}`;
}

export const formatTime      = (v: number): string => formatWithUnit(v, "s");
export const formatVoltage   = (v: number): string => formatWithUnit(v, "V");
export const formatCurrent   = (v: number): string => formatWithUnit(v, "A");
export const formatFrequency = (v: number): string => formatWithUnit(v, "Hz");

// Range-aware tick formatter.
//
// Given a domain [min, max], returns a formatter that produces visually
// distinct labels for ticks separated by ~range/5. This is the fix for the
// "12.0, 12.0, 12.0" bug — values like 12.0001 and 12.0009 collapse to the
// same string with 1 decimal, so the chart's axis becomes useless.
//
// Rules:
//   - decimals := ceil(-log10(range / 5)), clamped to ≥ 0
//   - if the range is small relative to the median (range < |median| / 100),
//     skip the SI prefix and emit raw decimals — the user is looking at
//     a tiny variation around a large baseline, and "12m" hides the signal.
export function rangeAwareTickFormatter(
  domain: [number, number],
  unit?: string,
): (value: number) => string {
  const [min, max] = domain;
  const range = Math.abs(max - min);
  const decimals = range === 0 ? 2 : Math.max(0, Math.ceil(-Math.log10(range / 5)));
  const median = (min + max) / 2;
  const subPrefix = Math.abs(median) > 0 && range < Math.abs(median) / 100;
  const suffix = unit ?? "";

  return (value: number): string => {
    if (subPrefix) return `${value.toFixed(decimals)}${suffix}`;
    return formatWithUnit(value, suffix, { decimals });
  };
}
