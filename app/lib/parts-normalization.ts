/**
 * Pure, dependency-free normalization helpers for the BOM data model (Stage 1).
 *
 * These derive the new `parts` columns (normalized MPN, canonical package,
 * key specs, internal part number, lifecycle/RoHS) from the KiCad-sourced row
 * data. Everything here is best-effort and deterministic: the same input always
 * yields the same output (the backfill relies on this for idempotency), and
 * parsing failures degrade to partial/empty results rather than throwing.
 */

import type { KeySpecs, Part } from "./db/schema";

/**
 * The shape consumed by these helpers — a selected `parts` row, optionally
 * augmented with the owning library's name (handy for categorization, which the
 * raw `parts` row can't supply on its own).
 */
export type PartRow = Part & { libraryName?: string };

// ─── MPN ────────────────────────────────────────────────────────────────────

/**
 * Uppercase and strip everything but letters and digits.
 *   "ATmega328P-AU" → "ATMEGA328PAU"
 *   "  ABC-123 / X " → "ABC123X"
 */
export function normalizeMpn(mpn: string): string {
  return mpn.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ─── Generic-part detection ─────────────────────────────────────────────────-
//
// KiCad ships generic template symbols (Device.R, Connector_Generic_*, power
// ports, SPICE primitives, …) that have no orderable MPN. The Build-mode AI
// must never pick these — they produce all-"—" BOM rows. The heuristics below
// classify a part as generic by its owning library, exact symbol name, or a
// name pattern. Best-effort and deterministic (the backfill relies on this).

/** Libraries that contain ONLY generic template symbols (no orderable MPNs). */
export const GENERIC_LIBRARIES = new Set([
  "Device",
  "Connector_Generic",
  "Connector_Generic_MountingPin",
  "Connector_Generic_Shielded",
  "Connector_Pin",
  "Mechanical",
  "Jumper",
  "pspice", // SPICE simulation primitives, not buyable
  "Simulation_SPICE",
  "power", // power port symbols (+3V3, GND, etc.) — not parts
  "Symbol", // KiCad's symbol-label library
  "Graphic",
]);

/** Exact symbol names that are generic regardless of library. */
export const GENERIC_EXACT_NAMES = new Set([
  "R", "R_Small", "R_Variable", "R_Adjustable", "R_Pack4", "R_Pack8",
  "C", "C_Small", "C_Polarized", "CP", "CP_Small", "C_Variable",
  "L", "L_Small", "L_Coupled", "L_Core_Ferrite",
  "D", "D_Small", "D_Schottky", "D_Zener", "D_TVS",
  "LED", "LED_Small", "LED_Dual_AAC", "LED_Dual_CAC", "LED_RGB",
  "Crystal", "Crystal_Small", "Crystal_GND2", "Crystal_GND24",
  "Battery", "Battery_Cell",
  "Speaker", "Buzzer",
  "Fuse", "Fuse_Small", "Polyfuse", "Polyfuse_Small",
  "Antenna", "Antenna_Chip", "Antenna_Shield",
  "Transformer", "Transformer_1P_1S",
  "Q_NPN_BCE", "Q_PNP_BCE", "Q_NMOS_GSD", "Q_PMOS_GSD",
  "Resistor", "Capacitor", "Inductor", "Diode",
  "Conn_01x02", "Conn_01x04", "Conn_01x08", "Conn_02x05",
]);

/** Name substring patterns that strongly indicate genericity. */
export const GENERIC_NAME_PATTERNS = [
  /^Conn_\d+x\d+/, // Conn_02x10, Conn_01x40 — generic headers
  /^Mounting/,
  /^Test(Point|Pad)/,
  /Generic/,
  /Placeholder/,
];

/** Is this part a generic KiCad template (no orderable MPN)? */
export function isGenericPart(part: {
  name: string;
  libraryName?: string; // for parts from search responses
  library?: { name: string }; // for parts from joined queries
}): boolean {
  const libName = part.libraryName ?? part.library?.name;
  if (libName && GENERIC_LIBRARIES.has(libName)) return true;
  if (GENERIC_EXACT_NAMES.has(part.name)) return true;
  if (GENERIC_NAME_PATTERNS.some((re) => re.test(part.name))) return true;
  return false;
}

// Footprint/symbol-name fragments that mark a string as a KiCad footprint or
// mechanical descriptor rather than a real, buyable manufacturer part number.
const MPN_DISALLOWED_SUBSTRINGS = [
  "_THT_", "_SMD_", "_Vertical", "_Horizontal", "mm_P", "_TabPin", "_Drilled", "_MountingHoles",
];

/**
 * Heuristic: could `s` plausibly be a buyable manufacturer part number? Returns
 * false for obvious symbol/footprint names. False positives are acceptable — a
 * distributor lookup on a non-MPN simply returns nothing.
 */
export function looksLikeMpn(s: string): boolean {
  if (!s || s.length < 3 || s.length > 40) return false;
  if (!/\d/.test(s)) return false; // must contain at least one digit
  for (const dis of MPN_DISALLOWED_SUBSTRINGS) {
    if (s.includes(dis)) return false;
  }
  return true;
}

// ─── Package ──────────────────────────────────────────────────────────────--

/** Imperial two-terminal chip sizes we canonicalize to a bare 4-digit code. */
const CHIP_SIZES = [
  "01005", "0201", "0402", "0603", "0805", "1206", "1210",
  "1806", "1812", "1825", "2010", "2512", "2920",
];

/** Multi-pin package families, matched as `<FAMILY><pins>`. */
const PKG_FAMILIES = [
  "TQFP", "LQFP", "VQFP", "QFP", "TSSOP", "SSOP", "MSOP", "HTSSOP",
  "SOIC", "SOP", "SOT", "QFN", "DFN", "BGA", "TSOP", "DIP", "SIP",
  "TO", "SOD", "SC", "WLCSP", "LGA",
];

/**
 * Canonicalize a package string drawn from a KiCad footprint hint or property.
 *   "0805 Imperial / 2012 Metric"            → "0805"
 *   "SOIC-8"                                 → "SOIC-8"
 *   "TQFP_32_7x7mm_P0.8mm"                   → "TQFP-32"
 *   "Package_QFP:TQFP-32_7x7mm_P0.8mm"       → "TQFP-32"
 * Returns null when nothing recognizable is found.
 */
export function normalizePackage(raw: string | null): string | null {
  if (!raw) return null;
  // Drop any KiCad library prefix like "Package_QFP:".
  const afterColon = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
  const s = afterColon.trim();
  if (s === "") return null;
  const upper = s.toUpperCase();

  // 1) Two-terminal chip packages — bare imperial code, at a token boundary.
  for (const size of CHIP_SIZES) {
    const re = new RegExp(`(?:^|[^0-9])${size}(?:[^0-9]|$)`);
    if (re.test(upper)) return size;
  }

  // 2) Multi-pin packages — FAMILY + pin count (dash/underscore/space optional).
  const familyAlt = PKG_FAMILIES.join("|");
  const famMatch = upper.match(new RegExp(`\\b(${familyAlt})[-_ ]?(\\d+)\\b`));
  if (famMatch) return `${famMatch[1]}-${famMatch[2]}`;

  return null;
}

// ─── Categorization ─────────────────────────────────────────────────────────

/**
 * Decide which key-spec category a part falls into by mining its library name,
 * description, and keywords. Passive checks run before "ic" so a worded
 * description ("...controller...") doesn't shadow a clear passive.
 */
export function categorizeForKeySpecs(part: {
  description: string | null;
  keywords: string | null;
  libraryName?: string;
}): KeySpecs["kind"] {
  const hay = `${part.libraryName ?? ""} ${part.description ?? ""} ${part.keywords ?? ""}`.toLowerCase();

  if (/\bresistors?\b|\bresistance\b|potentiometer|rheostat|\bres\b/.test(hay)) return "resistor";
  if (/\bcapacitors?\b|capacitance|electrolytic|tantalum|\bceramic cap/.test(hay)) return "capacitor";
  if (/\binductors?\b|inductance|\bchoke\b|ferrite bead/.test(hay)) return "inductor";
  if (/\bdiodes?\b|\bzener\b|rectifier|schottky|\btvs\b/.test(hay)) return "diode";
  if (
    /microcontroller|\bmcu\b|\bmpu\b|\bfpga\b|\bcpld\b|amplifier|op-?amp|regulator|transceiver|\blogic\b|memory|eeprom|\bflash\b|processor|controller|integrated circuit/.test(
      hay,
    )
  ) {
    return "ic";
  }
  return "unknown";
}

// ─── Key-spec extraction ──────────────────────────────────────────────────--

/** Return the first capture group of `re` in `text`, whitespace-collapsed. */
function firstMatch(re: RegExp, text: string): string | undefined {
  const m = text.match(re);
  if (!m) return undefined;
  const value = (m[1] ?? m[0]).replace(/\s+/g, "");
  return value === "" ? undefined : value;
}

/** Drop undefined-valued keys so we never emit `{ resistance: undefined }`. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) {
    if (obj[k] === undefined) delete obj[k];
  }
  return obj;
}

/**
 * Best-effort key-spec extraction over a part's description, keywords, and
 * properties. Never throws — returns whatever fields parsed, or
 * `{ kind: "unknown" }` when the category can't be determined.
 */
export function extractKeySpecs(part: PartRow): KeySpecs {
  const kind = categorizeForKeySpecs(part);
  const text = [
    part.description ?? "",
    part.keywords ?? "",
    Object.values(part.properties ?? {}).join(" "),
  ].join(" ");

  switch (kind) {
    case "resistor":
      return compact({
        kind,
        // "10k", "4.7k", "100R", "1M", "0R", "4k7"
        resistance: firstMatch(/\b(\d+(?:\.\d+)?\s?[kKMG]?\s?(?:Ω|ohms?)|\d+[RkKMG]\d*|\d+(?:\.\d+)?\s?[kKMG])\b/i, text),
        tolerance: firstMatch(/(±?\s?\d+(?:\.\d+)?\s?%)/, text),
        powerRating: firstMatch(/(\d+\s?\/\s?\d+\s?W|\d+(?:\.\d+)?\s?[mµu]?W)\b/i, text),
      });
    case "capacitor":
      return compact({
        kind,
        capacitance: firstMatch(/(\d+(?:\.\d+)?\s?(?:pF|nF|µF|uF|mF|F))\b/i, text),
        tolerance: firstMatch(/(±?\s?\d+(?:\.\d+)?\s?%)/, text),
        voltageRating: firstMatch(/(\d+(?:\.\d+)?\s?V)\b/i, text),
        dielectric: firstMatch(/\b(C0G|NP0|X7R|X5R|X6S|X7S|Y5V|Z5U|X8R)\b/i, text),
      });
    case "inductor":
      return compact({
        kind,
        inductance: firstMatch(/(\d+(?:\.\d+)?\s?(?:pH|nH|µH|uH|mH|H))\b/i, text),
        currentRating: firstMatch(/(\d+(?:\.\d+)?\s?[mµu]?A)\b/i, text),
        tolerance: firstMatch(/(±?\s?\d+(?:\.\d+)?\s?%)/, text),
      });
    case "diode":
      return compact({
        kind,
        forwardVoltage: firstMatch(/V[fF]\s?[:=]?\s?(\d+(?:\.\d+)?\s?V)/, text),
        reverseVoltage: firstMatch(/(\d+(?:\.\d+)?\s?V)\b/i, text),
        currentRating: firstMatch(/(\d+(?:\.\d+)?\s?[mµu]?A)\b/i, text),
      });
    case "ic": {
      const pinCount = Array.isArray(part.pins) ? part.pins.length : 0;
      // "1.8V to 5.5V", "2.7-5.5V", "2.7 ~ 5.5 V"
      const range = text.match(
        /(\d+(?:\.\d+)?)\s?V?\s?(?:to|-|–|~)\s?(\d+(?:\.\d+)?)\s?V/i,
      );
      return compact({
        kind,
        ...(pinCount > 0 ? { pinCount } : {}),
        supplyVoltageMin: range ? `${range[1]}V` : undefined,
        supplyVoltageMax: range ? `${range[2]}V` : undefined,
      });
    }
    default:
      return { kind: "unknown" };
  }
}

// ─── Internal part number ─────────────────────────────────────────────────--

const CAT_CODE: Record<Exclude<KeySpecs["kind"], "ic"> | "ic", string> = {
  resistor: "RES",
  capacitor: "CAP",
  inductor: "IND",
  diode: "DIO",
  ic: "IC",
  unknown: "UNK",
};

/** Strip to uppercase alphanumerics for an IPN segment ("X7R" stays "X7R"). */
function ipnSegment(raw: string | undefined): string {
  if (!raw) return "";
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Finer IC sub-category for the IPN ("MCU"/"REG"/"AMP"), falling back to "IC". */
function icSubCategory(part: PartRow): string {
  const hay = `${part.libraryName ?? ""} ${part.description ?? ""} ${part.keywords ?? ""} ${part.name}`.toLowerCase();
  if (/microcontroller|\bmcu\b|^mcu_|\bmpu\b/.test(hay)) return "MCU";
  if (/regulator|\bldo\b|\bpmic\b/.test(hay)) return "REG";
  if (/amplifier|op-?amp/.test(hay)) return "AMP";
  if (/\bfpga\b|\bcpld\b/.test(hay)) return "FPGA";
  if (/memory|eeprom|\bflash\b|\bsram\b|\bdram\b/.test(hay)) return "MEM";
  return "IC";
}

/**
 * Deterministic grouping id: `SIRKIT-<CAT>-<VAL>-<PKG>-<OPT...>`.
 *   Resistor 10k 0805 1%        → "SIRKIT-RES-10K-0805-1PCT"
 *   Capacitor 100nF 0603 25V X7R → "SIRKIT-CAP-100NF-0603-25V-X7R"
 *   ATmega328P-AU TQFP-32       → "SIRKIT-MCU-ATMEGA328PAU-TQFP32"
 *   Unknown                     → "SIRKIT-UNK-<MPN-or-id>"
 */
export function generateInternalPartNumber(
  part: PartRow,
  specs: KeySpecs,
  normalizedPackage: string | null,
): string {
  const kind: KeySpecs["kind"] = "kind" in specs ? specs.kind : "unknown";
  const cat = kind === "ic" ? icSubCategory(part) : CAT_CODE[kind as keyof typeof CAT_CODE];
  const pkg = ipnSegment(normalizedPackage ?? undefined);
  const mpnVal = ipnSegment(part.mpn ?? "") || ipnSegment(part.name ?? "");
  const idSuffix = part.id.replace(/-/g, "").slice(0, 12).toUpperCase();

  // Category value + optional qualifiers.
  let val = "";
  const opts: string[] = [];
  if ("kind" in specs) {
    switch (specs.kind) {
      case "resistor":
        val = ipnSegment(specs.resistance);
        if (specs.tolerance) opts.push(tolToSegment(specs.tolerance));
        break;
      case "capacitor":
        val = ipnSegment(specs.capacitance);
        if (specs.voltageRating) opts.push(ipnSegment(specs.voltageRating));
        if (specs.dielectric) opts.push(ipnSegment(specs.dielectric));
        break;
      case "inductor":
        val = ipnSegment(specs.inductance);
        if (specs.currentRating) opts.push(ipnSegment(specs.currentRating));
        break;
      case "diode":
      case "ic":
        val = mpnVal;
        break;
    }
  }

  if (kind === "unknown" || cat === "UNK") {
    const v = mpnVal || idSuffix;
    return joinIpn(["SIRKIT", "UNK", v, pkg]);
  }

  if (val === "") val = mpnVal || idSuffix;
  return joinIpn(["SIRKIT", cat, val, pkg, ...opts]);
}

/** "1%" → "1PCT", "0.1%" → "0P1PCT". */
function tolToSegment(tolerance: string): string {
  return tolerance
    .replace(/\s+/g, "")
    .replace(/±/g, "")
    .replace(/\./g, "P")
    .replace(/%/g, "PCT")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function joinIpn(segments: string[]): string {
  return segments.filter((s) => s !== "").join("-").toUpperCase();
}

// ─── Lifecycle / RoHS (KiCad has neither; Stage 3 fills real data) ──────────--

/**
 * KiCad ships no lifecycle metadata. Every part in our table comes from a
 * current, maintained KiCad library, so default to "active". Stage 3 replaces
 * this with distributor-sourced data.
 */
export function deriveLifecycleStatusFromKicad(part: PartRow): "active" | "unknown" {
  return part.name && part.name.trim() !== "" ? "active" : "unknown";
}

/** KiCad carries no RoHS metadata — always "unknown" until Stage 3. */
export function deriveRohsStatusFromKicad(_part: PartRow): "unknown" {
  return "unknown";
}
