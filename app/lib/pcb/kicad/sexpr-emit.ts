// S-expression format helpers for .kicad_pcb emission (Stage 13).
// Style: 2-space indentation, one child per line for structural blocks,
// inline for small leaves — cosmetic divergence from KiCad's own writer is
// acceptable (the parser is the contract; the golden fixture is the target
// for humans).

const INDENT = "  ";

/** [B19-D I5c rows 04, 17] A value that would have become structure in the written file. Nothing is written. */
export class KicadEmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KicadEmitError";
  }
}

/** Quote + escape a string the way KiCad's parser expects. Always quotes —
 * KiCad 8 quotes every user string (layer names, net names, pad numbers).
 * [B19-D I5c row 17] newline, carriage return and tab are escaped as KiCad writes them; any other control, line or paragraph
 * separator becomes a space, so a string never spans a line. */
export function q(s: string): string {
  if (typeof s !== "string") throw new KicadEmitError(`expected a string to quote, received ${typeof s}`);
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, " ");
  return `"${escaped}"`;
}

/** A quoted string produced by q(): starts and ends with an unescaped quote and holds no raw line break. */
function isQuoted(token: string): boolean {
  if (token.length < 2 || !token.startsWith('"') || !token.endsWith('"') || /[\r\n]/.test(token)) return false;
  let escaped = false;
  for (let i = 1; i < token.length - 1; i++) {
    const c = token[i];
    if (escaped) escaped = false;
    else if (c === "\\") escaped = true;
    else if (c === '"') return false;
  }
  return !escaped;
}

/** [B19-D I5c row 04] Every child of a leaf is a finite number, a q()-quoted string, or a bare token. */
export function atom(value: string | number): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new KicadEmitError(`non-finite number in KiCad output: ${String(value)}`);
    return String(value);
  }
  if (typeof value !== "string") throw new KicadEmitError(`unexpected ${typeof value} in KiCad output`);
  if (isQuoted(value) || /^[A-Za-z0-9_.+\-*]+$/.test(value)) return value;
  throw new KicadEmitError(`a value would change the structure of the KiCad file: ${JSON.stringify(value).slice(0, 60)}`);
}

/** Inline leaf: sexpr("at", "1.000000", "2.000000") → `(at 1.000000 2.000000)`. */
export function sexpr(head: string, ...children: (string | number)[]): string {
  const parts = children.map(atom).filter((c) => c.length > 0);
  return parts.length > 0 ? `(${atom(head)} ${parts.join(" ")})` : `(${atom(head)})`;
}

/**
 * Shift every non-empty line of a (possibly multi-line) chunk right.
 * [B19-D I5c row 17] string-aware: a line that begins inside a quoted string is never padded, so indentation can never add
 * characters to a string's value.
 */
export function indent(text: string, levels: number): string {
  if (levels <= 0) return text;
  const pad = INDENT.repeat(levels);
  let inString = false;
  let escaped = false;
  return text
    .split("\n")
    .map((line) => {
      const padded = !inString && line.length > 0 ? pad + line : line;
      for (const c of line) {
        if (inString) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') inString = false;
        } else if (c === '"') inString = true;
      }
      return padded;
    })
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
