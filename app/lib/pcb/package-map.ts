/**
 * Heuristic package → footprint mapping (PCB Stage 4, resolution tier 2).
 *
 * A small deterministic table from normalized package tokens (plus the
 * component kind for chip passives) to a KiCad footprint fullName. Every
 * result is verified downstream by an exact `resolve` lookup AND a
 * pad-count == pin-count check, so a near-miss here degrades to the
 * assignment queue instead of a wrong footprint.
 */

// ─── Token normalization ─────────────────────────────────────────────────────

/**
 * Canonicalize a raw package string: "soic8" / "SOIC-8 (D)" → "SOIC-8",
 * "0603 (1608 metric)" → "0603", "DO-214AC" → "SMA", "1x4 header" → "1X04".
 * Returns null when nothing recognizable is found.
 */
export function normalizePackage(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (s === "") return null;

  // Chip passive sizes (imperial). Guard against metric aliases (1608 = 0603
  // imperial) by only matching the four supported imperial codes.
  const chip = s.match(/\b(0402|0603|0805|1206)\b/);
  if (chip) return chip[1];

  const named = s.match(
    /\b(SOT-?23|SOT-?223|SOIC-?8|SOIC-?14|SOIC-?16|TSSOP-?14|TSSOP-?20|LQFP-?32|LQFP-?48|LQFP-?64|TO-?220|TO-?92|DO-?214AC|SMA)\b/,
  );
  if (named) {
    const t = named[1].replace(/(\D)(\d)/, "$1-$2").replace("SOT23", "SOT-23");
    return t === "DO-214AC" ? "SMA" : t;
  }

  // Pin headers: "1x4", "2X10", "1×04" — assume 2.54 mm pitch (the only pitch
  // in the table; anything else fails the resolve/pad-count verification).
  const header = s.match(/\b([12])\s?[X×]\s?0?(\d{1,2})\b/);
  if (header) return `${header[1]}X${header[2].padStart(2, "0")}`;

  return null;
}

/** Scan free-text fields (value, MPN, part description) for a package token. */
export function guessPackageToken(
  texts: (string | null | undefined)[],
): string | null {
  for (const t of texts) {
    if (!t) continue;
    const token = normalizePackage(t);
    if (token) return token;
  }
  return null;
}

// ─── The table ───────────────────────────────────────────────────────────────

/** Chip passives need the component kind to pick the library. */
const CHIP_PASSIVES: Record<string, Record<"R" | "C" | "L", string>> = {
  "0402": {
    R: "Resistor_SMD:R_0402_1005Metric",
    C: "Capacitor_SMD:C_0402_1005Metric",
    L: "Inductor_SMD:L_0402_1005Metric",
  },
  "0603": {
    R: "Resistor_SMD:R_0603_1608Metric",
    C: "Capacitor_SMD:C_0603_1608Metric",
    L: "Inductor_SMD:L_0603_1608Metric",
  },
  "0805": {
    R: "Resistor_SMD:R_0805_2012Metric",
    C: "Capacitor_SMD:C_0805_2012Metric",
    L: "Inductor_SMD:L_0805_2012Metric",
  },
  "1206": {
    R: "Resistor_SMD:R_1206_3216Metric",
    C: "Capacitor_SMD:C_1206_3216Metric",
    L: "Inductor_SMD:L_1206_3216Metric",
  },
};

/** Kind-independent named packages. */
const NAMED_PACKAGES: Record<string, string> = {
  "SOT-23": "Package_TO_SOT_SMD:SOT-23",
  "SOT-223": "Package_TO_SOT_SMD:SOT-223",
  "SOIC-8": "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm",
  "SOIC-14": "Package_SO:SOIC-14_3.9x8.7mm_P1.27mm",
  "SOIC-16": "Package_SO:SOIC-16_3.9x9.9mm_P1.27mm",
  "TSSOP-14": "Package_SO:TSSOP-14_4.4x5mm_P0.65mm",
  "TSSOP-20": "Package_SO:TSSOP-20_4.4x6.5mm_P0.65mm",
  SMA: "Diode_SMD:D_SMA", // DO-214AC
  "LQFP-32": "Package_QFP:LQFP-32_7x7mm_P0.8mm",
  "LQFP-48": "Package_QFP:LQFP-48_7x7mm_P0.5mm",
  "LQFP-64": "Package_QFP:LQFP-64_10x10mm_P0.5mm",
  "TO-220": "Package_TO_SOT_THT:TO-220-3_Vertical",
  "TO-92": "Package_TO_SOT_THT:TO-92_Inline",
};

/**
 * Tier-2 heuristic: normalized package token (+ ref-prefix kind for chip
 * passives, + pin count for headers) → footprint fullName, or null when the
 * table has no verified answer.
 */
export function heuristicFootprint(c: {
  ref: string;
  pkg: string | null;
  pinCount: number;
}): string | null {
  if (!c.pkg) return null;
  const prefix = (c.ref.match(/^[A-Za-z]+/)?.[0] ?? "").toUpperCase();

  const chip = CHIP_PASSIVES[c.pkg];
  if (chip) {
    if (prefix === "R" || prefix === "C" || prefix === "L") return chip[prefix];
    if (prefix === "FB") return chip.L; // ferrite beads use inductor lands
    return null;
  }

  const named = NAMED_PACKAGES[c.pkg];
  if (named) return named;

  // Pin headers "1X04" / "2X10" — only when rows × positions matches the pin
  // count, so a mislabeled part falls through to the queue.
  const header = c.pkg.match(/^([12])X(\d{2})$/);
  if (header) {
    const rows = Number(header[1]);
    const positions = Number(header[2]);
    if (rows * positions !== c.pinCount || positions === 0) return null;
    return `Connector_PinHeader_2.54mm:PinHeader_${rows}x${header[2]}_P2.54mm_Vertical`;
  }

  return null;
}
