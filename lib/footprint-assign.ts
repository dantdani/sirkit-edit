/**
 * Deterministic footprint assignment (the seam toward PCB / .kicad_pcb export).
 *
 * A schematic symbol is not enough to lay out a board — every component also
 * needs a PCB *footprint* (land pattern). This module maps each placed component
 * to a KiCad footprint id ("Library:Name"), deterministically:
 *
 *   1. If the part's KiCad symbol carries a footprint id, expose it as a
 *      candidate. A name/hint is never package proof.
 *   2. Otherwise expose a category default candidate keyed off the refDes prefix
 *      (R/C/L/D/Q…), mirroring SchGen's `DEFAULT_MAP_RCL` approach.
 *   3. Otherwise leave it unresolved (`null`) — surfaced, never guessed, so the
 *      caller can flag "these parts still need a footprint" rather than shipping
 *      a wrong land pattern.
 *
 * Deliberately deterministic (no LLM, no fuzzy library scan): footprint choice is
 * electrically/mechanically load-bearing, so it follows the project's
 * "agents propose, deterministic code disposes" spine. Defaults are SMD 0603
 * (1608 metric) — a common, hand-solderable general-purpose size; tune the map
 * below for a different house default.
 */

export type FootprintSource = "atomic-approved" | "hint" | "default" | "none";
export type FootprintProofState = "approved" | "candidate" | "unresolved";

export type FootprintAssignment = {
  refDes: string;
  partId: string;
  /** KiCad footprint id "Library:Name", or null when unresolved. */
  footprint: string | null;
  source: FootprintSource;
  proofState: FootprintProofState;
  mappingCertificateId?: string;
};

/** Minimal part shape the resolver reads (satisfied by CachedPart). */
export type FootprintPart = {
  footprintHint?: string | null;
  name?: string | null;
  mainCategory?: string | null;
};

export type FootprintInput = {
  refDes: string;
  footprintHint?: string | null;
  value?: string | null;
  name?: string | null;
  category?: string | null;
  approvedAtomic?: {
    footprint: string;
    footprintAssetVersionId: string;
    mappingCertificateId: string;
  };
};

// Category defaults by refDes prefix. SMD 0603 (1608 metric) for two-terminal
// passives; a small SOT/SOD default for transistors/diodes. Everything else is
// too package-variable to guess and falls through to `null`.
const CATEGORY_DEFAULTS: Record<string, string> = {
  R: "Resistor_SMD:R_0603_1608Metric",
  C: "Capacitor_SMD:C_0603_1608Metric",
  L: "Inductor_SMD:L_0603_1608Metric",
  FB: "Inductor_SMD:L_0603_1608Metric",
  D: "Diode_SMD:D_SOD-123",
  Q: "Package_TO_SOT_SMD:SOT-23",
};

const LED_FOOTPRINT = "LED_SMD:LED_0603_1608Metric";

/** Leading alphabetic run of a refDes, upper-cased ("C12" → "C", "FB3" → "FB"). */
function refDesPrefix(refDes: string): string {
  const m = /^([A-Za-z]+)/.exec(refDes.trim());
  return m ? m[1].toUpperCase() : "";
}

/**
 * Does `s` look like a fully-qualified KiCad footprint id "Library:Name"?
 * Rejects empty strings, wildcard footprint *filters* ("R_*", "C_????_*"),
 * multi-colon junk, and anything with whitespace.
 */
export function isFootprintId(s: string | null | undefined): s is string {
  if (!s) return false;
  const t = s.trim();
  if (t === "" || /\s/.test(t) || /[*?]/.test(t)) return false;
  const parts = t.split(":");
  if (parts.length !== 2) return false;
  return parts[0].length > 0 && parts[1].length > 0;
}

function looksLikeLed(input: FootprintInput): boolean {
  const blob = `${input.name ?? ""} ${input.value ?? ""} ${input.category ?? ""}`.toLowerCase();
  return /\bled\b/.test(blob) || blob.includes("light-emit") || blob.includes("light emit");
}

/** Resolve one component to a footprint id (or null) + how it was chosen. */
export function resolveFootprint(input: FootprintInput): { footprint: string | null; source: FootprintSource; proofState: FootprintProofState; mappingCertificateId?: string } {
  if (input.approvedAtomic && isFootprintId(input.approvedAtomic.footprint) && input.approvedAtomic.footprintAssetVersionId && input.approvedAtomic.mappingCertificateId) {
    return { footprint: input.approvedAtomic.footprint, source: "atomic-approved", proofState: "approved", mappingCertificateId: input.approvedAtomic.mappingCertificateId };
  }
  // A symbol hint is candidate generation only, never package proof.
  if (isFootprintId(input.footprintHint)) {
    return { footprint: input.footprintHint.trim(), source: "hint", proofState: "candidate" };
  }

  // 2) Category default by refDes prefix.
  const prefix = refDesPrefix(input.refDes);
  if (prefix === "LED" || (prefix === "D" && looksLikeLed(input))) {
    return { footprint: LED_FOOTPRINT, source: "default", proofState: "candidate" };
  }
  const def = CATEGORY_DEFAULTS[prefix];
  if (def) return { footprint: def, source: "default", proofState: "candidate" };

  // 3) Unresolved — surface it, don't guess.
  return { footprint: null, source: "none", proofState: "unresolved" };
}

/**
 * Assign footprints across a whole schematic. `components` are the placed KiCad
 * instances (refDes + partId, value optional); `parts` maps partId → part meta.
 * Returns one entry per component, ready to feed a `.kicad_pcb` exporter or a
 * "needs footprint" UI summary.
 */
export function assignFootprints(
  components: ReadonlyArray<{ refDes: string; partId: string; value?: string | null }>,
  parts: Map<string, FootprintPart>,
): FootprintAssignment[] {
  return components.map((c) => {
    const part = parts.get(c.partId);
    const { footprint, source, proofState, mappingCertificateId } = resolveFootprint({
      refDes: c.refDes,
      value: c.value,
      footprintHint: part?.footprintHint,
      name: part?.name,
      category: part?.mainCategory,
    });
    return { refDes: c.refDes, partId: c.partId, footprint, source, proofState, mappingCertificateId };
  });
}
