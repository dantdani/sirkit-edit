// PCB unit convention (non-negotiable, module-wide):
//
//   All model coordinates are INTEGER NANOMETERS (`Nm`), +x right, +y DOWN
//   (the KiCad file convention). No millimeter values exist inside the model —
//   conversion to/from mm happens only at file and render boundaries.
//
// Doubles are fine for intermediate math; compare with a 1 nm epsilon.

export type Nm = number; // integer nanometers

export const NM_PER_MM = 1_000_000;

export function mmToNm(mm: number): Nm {
  return Math.round(mm * NM_PER_MM);
}

export function nmToMm(nm: Nm): number {
  return nm / NM_PER_MM;
}

/**
 * Format a nanometer value as a millimeter string: "1.25", "0.0001", "0".
 * At most 6 decimals (1 nm resolution), no trailing zeros, never "-0".
 */
export function formatMm(nm: Nm): string {
  // toFixed(6) recovers the exact decimal value for any integer nm well
  // within Number.MAX_SAFE_INTEGER; the '.' terminates the trailing-zero run.
  let s = (nm / NM_PER_MM).toFixed(6);
  s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0" || s === "") s = "0";
  return s;
}
