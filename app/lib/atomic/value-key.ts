/**
 * Normalized component-value key for `parts_atomic_links.value_key`.
 *
 * Value-specific exact parts (a 47k and a 1k resistor share one KiCad symbol
 * but are different MPNs) are linked per normalized value; parts whose exact
 * identity does not depend on the schematic value use the '' default link.
 * Normalization is deliberately conservative: lowercase, unicode micro → u,
 * strip unit suffixes (Ω/ohm/F) and whitespace. Unmatched values simply find
 * no link, so an instance without authority fails closed at publication.
 */
export function normalizeValueKey(value: string | undefined | null): string {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[µμ]/g, "u")
    .replace(/\s+/g, "")
    .replace(/[ωΩ]/g, "")
    .replace(/ohms?$/, "")
    .replace(/f$/, "")
    .replace(/(\d)\.0(?=[a-z]|$)/, "$1");
}
