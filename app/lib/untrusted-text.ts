/**
 * [B19-D I5e rows 05, 25, 32] Bounding text that came from outside the user's own message before a model sees it.
 *
 * Catalog descriptions (upstream library text), project values and names, and other models' output are data. Before they
 * are put in front of a model they lose control, format and line/paragraph-separator characters (bidirectional overrides,
 * zero-width characters), runs of whitespace collapse, and the text is cut to a stated length by code point — never inside
 * a surrogate pair. A cut is marked with an ellipsis, so a reader never mistakes a prefix for the whole.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;

export function boundUntrustedText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
  const points = Array.from(cleaned);
  return points.length <= maxChars ? cleaned : `${points.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}

/** The same, preserving `null` for an absent value. */
export function boundUntrustedTextOrNull(value: unknown, maxChars: number): string | null {
  return typeof value === "string" ? boundUntrustedText(value, maxChars) : null;
}
