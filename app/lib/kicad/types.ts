/**
 * Pure KiCad domain types and value converters.
 *
 * This module is intentionally dependency-free: both the database schema
 * (`app/lib/db/schema.ts`) and the parsing pipeline (`extract.ts`) import from
 * here, so keeping it free of DB/parser imports avoids any import cycles.
 */

/** Electrical pin types as they appear in a `(pin <TYPE> ...)` token. */
export type KicadPinType =
  | "input"
  | "output"
  | "bidirectional"
  | "tri_state"
  | "passive"
  | "free"
  | "unspecified"
  | "power_in"
  | "power_out"
  | "open_collector"
  | "open_emitter"
  | "no_connect";

/** All valid pin-type literals — used to validate raw strings from the parser. */
export const KICAD_PIN_TYPES: readonly KicadPinType[] = [
  "input",
  "output",
  "bidirectional",
  "tri_state",
  "passive",
  "free",
  "unspecified",
  "power_in",
  "power_out",
  "open_collector",
  "open_emitter",
  "no_connect",
];

/** Direction (in degrees) a pin "leaves" the symbol body. */
export type PinOrientation = 0 | 90 | 180 | 270;

/** A single structured pin extracted from a KiCad symbol. */
export type KicadPin = {
  /** Pin number/label, e.g. "1", "PA0". */
  number: string;
  /** Pin name, e.g. "VCC", "GND", "~" (unnamed). */
  name: string;
  type: KicadPinType;
  position: { x: number; y: number };
  orientation: PinOrientation;
  length: number;
  /** KiCad symbol unit/body identity. Additive for legacy cached rows. */
  unit?: number;
  bodyStyle?: number;
  /** Hidden is electrical semantics, not merely a renderer preference. */
  hidden?: boolean;
  /** True when another graphical pin represents the same electrical identity. */
  stacked?: boolean;
};

/**
 * Coerce a raw pin-type string from the `.kicad_sym` source into our union.
 * Unknown values fall back to "unspecified" so a single odd part never breaks
 * ingestion.
 */
export function toKicadPinType(raw: string | null | undefined): KicadPinType {
  if (raw && (KICAD_PIN_TYPES as readonly string[]).includes(raw)) {
    return raw as KicadPinType;
  }
  return "unspecified";
}

/**
 * Normalize an arbitrary pin angle to one of the four cardinal orientations.
 * KiCad angles are always multiples of 90, but we round defensively and wrap
 * negatives/overflows via modulo 360.
 */
export function normalizePinOrientation(degrees: number | null | undefined): PinOrientation {
  const deg = typeof degrees === "number" && Number.isFinite(degrees) ? degrees : 0;
  const snapped = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return snapped as PinOrientation;
}
