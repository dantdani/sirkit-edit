// S-expression format helpers for .kicad_pcb emission (Stage 13).
// Style: 2-space indentation, one child per line for structural blocks,
// inline for small leaves — cosmetic divergence from KiCad's own writer is
// acceptable (the parser is the contract; the golden fixture is the target
// for humans).

const INDENT = "  ";

/** Quote + escape a string the way KiCad's parser expects. Always quotes —
 * KiCad 8 quotes every user string (layer names, net names, pad numbers). */
export function q(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Inline leaf: sexpr("at", "1.000000", "2.000000") → `(at 1.000000 2.000000)`. */
export function sexpr(head: string, ...children: (string | number)[]): string {
  const parts = children.map(String).filter((c) => c.length > 0);
  return parts.length > 0 ? `(${head} ${parts.join(" ")})` : `(${head})`;
}

/** Shift every non-empty line of a (possibly multi-line) chunk right. */
export function indent(text: string, levels: number): string {
  if (levels <= 0) return text;
  const pad = INDENT.repeat(levels);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

/**
 * Multi-line block: children (skipping empty/false/null entries) each on
 * their own line, one level deeper than the head. `indentLevels` shifts the
 * whole block for direct embedding.
 */
export function block(
  head: string,
  children: readonly (string | false | null | undefined)[],
  indentLevels = 0,
): string {
  const kids = children.filter((c): c is string => typeof c === "string" && c.length > 0);
  const body = kids.length > 0 ? `(${head}\n${kids.map((k) => indent(k, 1)).join("\n")}\n)` : `(${head})`;
  return indent(body, indentLevels);
}
