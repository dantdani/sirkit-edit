// Lossless S-expression kit — the interop spine for .kicad_mod parsing
// (Stage 2), .kicad_pcb export (Stage 13) and byte-exact re-emission.
//
// Invariants:
//   (a) emitVerbatim(parseSexpr(src), src) === src for any well-formed input.
//       The ROOT list's span deliberately covers the ENTIRE source (including
//       leading/trailing trivia such as the final newline); child spans cover
//       exactly their own text.
//   (b) parseSexpr(writeSexpr(parseSexpr(src))) is deeply equal to
//       parseSexpr(src) ignoring spans/raw.
//   (c) numbers round-trip through `raw` (exact source text), never through
//       float re-formatting — "0.50" stays "0.50".
//
// Handles quoted strings with \" and \\ escapes, and both \n and \r\n
// sources. Unknown node types are just data here — nothing crashes.

export interface SList {
  kind: "list";
  items: SNode[];
  start: number;
  end: number;
}

export type SAtom =
  | { kind: "symbol"; value: string; start: number; end: number }
  | { kind: "string"; value: string; raw: string; start: number; end: number } // raw = with quotes/escapes
  | { kind: "number"; value: number; raw: string; start: number; end: number }; // raw = exact source text

export type SNode = SList | SAtom;

export class SexprError extends Error {
  readonly line: number;
  readonly col: number;

  constructor(message: string, line: number, col: number) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = "SexprError";
    this.line = line;
    this.col = col;
  }
}

function lineColAt(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart + 1 };
}

function errorAt(source: string, offset: number, message: string): SexprError {
  const { line, col } = lineColAt(source, offset);
  return new SexprError(message, line, col);
}

function isWhitespace(ch: string): boolean {
  // A stray U+FEFF BOM is treated as trivia; the root span still preserves it.
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\uFEFF";
}

function isTokenEnd(ch: string): boolean {
  return isWhitespace(ch) || ch === "(" || ch === ")" || ch === '"';
}

// Bare tokens that look like numbers become number atoms; everything else is
// a symbol. (Pad numbers etc. are quoted strings in KiCad ≥ 7, so a bare
// numeric token really is a number.)
const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function unescapeString(raw: string): string {
  // raw includes the surrounding quotes.
  let out = "";
  for (let i = 1; i < raw.length - 1; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    i++;
    const esc = raw[i];
    switch (esc) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case '"': out += '"'; break;
      case "\\": out += "\\"; break;
      default: out += esc ?? ""; break; // unknown escape: keep the char
    }
  }
  return out;
}

/**
 * Parse a single top-level S-expression document. Throws SexprError with
 * line/col on malformed input. The returned root list spans the whole
 * source (see invariant (a) above).
 */
export function parseSexpr(source: string): SList {
  let pos = 0;
  const len = source.length;

  function skipTrivia(): void {
    while (pos < len && isWhitespace(source[pos])) pos++;
  }

  function parseAtom(): SAtom {
    const start = pos;
    if (source[pos] === '"') {
      pos++;
      while (pos < len) {
        const ch = source[pos];
        if (ch === "\\") {
          pos += 2;
          continue;
        }
        if (ch === '"') {
          pos++;
          const raw = source.slice(start, pos);
          return { kind: "string", value: unescapeString(raw), raw, start, end: pos };
        }
        pos++;
      }
      throw errorAt(source, start, "Unterminated string");
    }
    while (pos < len && !isTokenEnd(source[pos])) pos++;
    const raw = source.slice(start, pos);
    if (NUMBER_RE.test(raw)) {
      return { kind: "number", value: Number(raw), raw, start, end: pos };
    }
    return { kind: "symbol", value: raw, start, end: pos };
  }

  function parseList(): SList {
    const start = pos; // at '('
    pos++;
    const items: SNode[] = [];
    for (;;) {
      skipTrivia();
      if (pos >= len) throw errorAt(source, start, "Unclosed list");
      const ch = source[pos];
      if (ch === ")") {
        pos++;
        return { kind: "list", items, start, end: pos };
      }
      if (ch === "(") {
        items.push(parseList());
      } else {
        items.push(parseAtom());
      }
    }
  }

  skipTrivia();
  if (pos >= len) throw errorAt(source, pos, "Empty input");
  if (source[pos] !== "(") throw errorAt(source, pos, "Expected '('");
  const root = parseList();
  skipTrivia();
  if (pos < len) throw errorAt(source, pos, "Unexpected content after top-level list");
  // Root spans the entire source so emitVerbatim(root, src) === src.
  return { ...root, start: 0, end: len };
}

/** Byte-exact re-emission via source spans. */
export function emitVerbatim(node: SNode, source: string): string {
  return source.slice(node.start, node.end);
}

function atomText(atom: SAtom): string {
  switch (atom.kind) {
    case "symbol": return atom.value;
    case "string": return atom.raw;
    case "number": return atom.raw; // never re-format floats (invariant (c))
  }
}

function writeNode(node: SNode, indent: number): string {
  if (node.kind !== "list") return atomText(node);
  const tab = "\t".repeat(indent);
  const hasListChild = node.items.some((it) => it.kind === "list");
  if (!hasListChild) {
    return `(${node.items.map((it) => atomText(it as SAtom)).join(" ")})`;
  }
  // KiCad style: leading atoms stay on the head line, each child list goes on
  // its own indented line, closing paren on its own line. An atom appearing
  // after a list child (rare) also gets its own line.
  let out = "(";
  let sawList = false;
  let first = true;
  for (const item of node.items) {
    if (item.kind === "list") {
      sawList = true;
      out += `\n${tab}\t${writeNode(item, indent + 1)}`;
    } else if (!sawList) {
      out += first ? atomText(item) : ` ${atomText(item)}`;
    } else {
      out += `\n${tab}\t${atomText(item)}`;
    }
    first = false;
  }
  out += `\n${tab})`;
  return out;
}

/**
 * Canonical KiCad-style formatting (tabs, one child list per line). Number
 * atoms are emitted from `raw`, so parsed values keep their exact source
 * formatting. Output always ends with a newline and uses "\n" line endings.
 */
export function writeSexpr(node: SNode): string {
  return `${writeNode(node, 0)}\n`;
}

/** First child list whose head symbol === name. */
export function child(list: SList, name: string): SList | undefined {
  for (const item of list.items) {
    if (item.kind === "list") {
      const head = item.items[0];
      if (head && head.kind === "symbol" && head.value === name) return item;
    }
  }
  return undefined;
}

/** All child lists whose head symbol === name. */
export function children(list: SList, name: string): SList[] {
  const out: SList[] = [];
  for (const item of list.items) {
    if (item.kind === "list") {
      const head = item.items[0];
      if (head && head.kind === "symbol" && head.value === name) out.push(item);
    }
  }
  return out;
}

/** Number atom at `index` (0 = head symbol). Throws if not a number atom. */
export function num(list: SList, index: number): number {
  const item = list.items[index];
  if (!item || item.kind !== "number") {
    throw new SexprError(`Expected number at index ${index}`, 0, 0);
  }
  return item.value;
}

/** String or symbol atom at `index` (0 = head symbol). Throws otherwise. */
export function str(list: SList, index: number): string {
  const item = list.items[index];
  if (!item || (item.kind !== "string" && item.kind !== "symbol")) {
    throw new SexprError(`Expected string/symbol at index ${index}`, 0, 0);
  }
  return item.value;
}
