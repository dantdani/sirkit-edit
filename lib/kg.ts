/**
 * Per-IC knowledge-graph lookup: datasheet-derived pin roles + constraint
 * predicates (Phase 2 of the PCBSchemaGen port, arXiv:2602.00510).
 *
 * Two consumers:
 *  - GENERATION grounding: `kgDesignNotes(partName)` renders an entry as a
 *    compact instruction string attached to search_parts results, so the model
 *    designs the hookup right the first time (the paper's "unified context
 *    assembly" — inject only the 2–6 relevant entries, not the library).
 *  - VERIFICATION: `kgEntryFor(partName)` feeds lib/erc.ts's KG constraint layer
 *    (supply pairs, must-be-connected pins, gate/differential checks).
 *
 * Matching is deliberately conservative: exact name match, else a prefix match
 * requiring ≥6 characters (catalog symbol names carry package/voltage suffixes —
 * "TPS54302DDCR", "AP2112K-3.3" — that datasheet-level entries omit). A false
 * negative just means no extra checks; a false positive would assert another
 * chip's constraints, which is worse.
 */

import { KG_DATA } from "./kg-data";

export type KgConstraint =
  | { type: "supply_pair"; vddPin: string; gndPin: string }
  | { type: "must_be_connected"; pins: string[] }
  | { type: "driving_pair"; gatePin: string; sourcePin: string }
  | { type: "differential_distinct"; pins: string[] };

export type KgEntry = {
  note: string;
  pinRoles: Record<string, string>;
  constraints: KgConstraint[];
};

const MIN_PREFIX = 6;

// Uppercased keys, longest first so the most specific prefix wins
// (e.g. "TPS54302" before a hypothetical "TPS54").
const KG_KEYS = Object.keys(KG_DATA).sort((a, b) => b.length - a.length);

/** Resolve a catalog part name to its KG entry, or null. */
export function kgEntryFor(partName: string | null | undefined): KgEntry | null {
  if (!partName) return null;
  const name = partName.trim().toUpperCase();
  if (name.length < 4) return null;
  const exact = KG_DATA[name];
  if (exact) return exact;
  for (const key of KG_KEYS) {
    if (key.length < MIN_PREFIX) continue;
    if (name.startsWith(key)) return KG_DATA[key];
    // Symbol name is the datasheet family root of a longer KG id
    // (e.g. catalog "W25Q64JV" vs KG "W25Q64JVSS").
    if (name.length >= MIN_PREFIX && key.startsWith(name)) return KG_DATA[key];
  }
  return null;
}

/**
 * Render an entry as compact design guidance for the generation context.
 * ~2 short lines per part; null when the part has no KG entry.
 */
export function kgDesignNotes(partName: string | null | undefined): string | null {
  const entry = kgEntryFor(partName);
  if (!entry) return null;
  const lines: string[] = [];

  const roles = Object.entries(entry.pinRoles);
  if (roles.length > 0) {
    lines.push(`pin roles: ${roles.map(([p, r]) => `${p}=${r}`).join(", ")}`);
  }
  const req: string[] = [];
  for (const c of entry.constraints) {
    if (c.type === "supply_pair") req.push(`power ${c.vddPin} with ${c.gndPin} as its return (both must be connected)`);
    else if (c.type === "must_be_connected") req.push(`${c.pins.join(", ")} must be connected`);
    else if (c.type === "driving_pair") req.push(`gate pin ${c.gatePin} must be driven (source ref: pin ${c.sourcePin})`);
    else if (c.type === "differential_distinct") req.push(`${c.pins.join(" and ")} are a differential pair — keep on separate nets`);
  }
  if (req.length > 0) lines.push(`datasheet requirements: ${req.join("; ")}`);
  return lines.length > 0 ? lines.join(" | ") : null;
}

/** Number of ICs in the KG (for logging/tests). */
export function kgSize(): number {
  return KG_KEYS.length;
}
