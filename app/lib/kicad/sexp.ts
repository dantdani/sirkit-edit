/**
 * Hand-written recursive-descent parser for KiCad S-expressions.
 *
 * A `.kicad_sym` file is one big nested list. We parse it into a simple tree of
 * nodes — each node is a string atom, a number, or a list of nodes. We do NOT
 * try to assign semantics here (what a `symbol` or `pin` means); that is the
 * job of `extract.ts`. This keeps the parser tiny, fast, and reusable.
 */

/** A parsed S-expression node: a bare atom, a number, or a nested list. */
export type SExpr = string | number | SExpr[];

/**
 * Parse a full S-expression document into a tree.
 * Throws on malformed input (unterminated string/list, stray characters).
 */
export function parseSExp(input: string): SExpr {
  let pos = 0;

  function fail(message: string): never {
    throw new Error(`S-expression parse error at offset ${pos}: ${message}`);
  }

  function skipWhitespace(): void {
    while (pos < input.length) {
      const ch = input[pos];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        pos++;
      } else {
        break;
      }
    }
  }

  function parseQuotedString(): string {
    pos++; // consume opening quote
    let out = "";
    while (pos < input.length) {
      const ch = input[pos];
      if (ch === "\\") {
        const next = input[pos + 1];
        switch (next) {
          case "n": out += "\n"; break;
          case "t": out += "\t"; break;
          case "r": out += "\r"; break;
          case '"': out += '"'; break;
          case "\\": out += "\\"; break;
          default: out += next ?? ""; break;
        }
        pos += 2;
      } else if (ch === '"') {
        pos++; // consume closing quote
        return out;
      } else {
        out += ch;
        pos++;
      }
    }
    fail("unterminated string");
  }

  function parseAtom(): string | number {
    const start = pos;
    while (pos < input.length) {
      const ch = input[pos];
      if (
        ch === " " || ch === "\t" || ch === "\n" || ch === "\r" ||
        ch === "(" || ch === ")" || ch === '"'
      ) {
        break;
      }
      pos++;
    }
    if (pos === start) fail(`unexpected character '${input[pos]}'`);
    const text = input.slice(start, pos);
    // KiCad numeric atoms: integers, decimals, optional sign/exponent.
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
      return Number(text);
    }
    return text;
  }

  function parseList(): SExpr[] {
    pos++; // consume "("
    const items: SExpr[] = [];
    while (pos < input.length) {
      skipWhitespace();
      const ch = input[pos];
      if (ch === ")") { pos++; return items; }
      if (ch === undefined) break;
      items.push(parseNode());
    }
    fail("unterminated list");
  }

  function parseNode(): SExpr {
    skipWhitespace();
    const ch = input[pos];
    if (ch === "(") return parseList();
    if (ch === '"') return parseQuotedString();
    return parseAtom();
  }

  skipWhitespace();
  return parseNode();
}

// ─── Tree-navigation helpers ────────────────────────────────────────────────

/** Type guard: is this node a list (vs. a leaf atom/number)? */
export function isList(node: SExpr): node is SExpr[] {
  return Array.isArray(node);
}

/** The tag name of a list, i.e. its first element if that element is an atom. */
export function head(list: SExpr[]): string | null {
  const first = list[0];
  return typeof first === "string" ? first : null;
}

/** First direct child list whose tag equals `tag`, or null. */
export function findChild(list: SExpr[], tag: string): SExpr[] | null {
  for (const item of list) {
    if (isList(item) && head(item) === tag) return item;
  }
  return null;
}

/** All direct child lists whose tag equals `tag`. */
export function findChildren(list: SExpr[], tag: string): SExpr[][] {
  const out: SExpr[][] = [];
  for (const item of list) {
    if (isList(item) && head(item) === tag) out.push(item);
  }
  return out;
}

/** Read a node as a string (returns null for numbers/lists). */
export function getString(node: SExpr | undefined): string | null {
  return typeof node === "string" ? node : null;
}

/** Read a node as a number, coercing numeric strings (returns null otherwise). */
export function getNumber(node: SExpr | undefined): number | null {
  if (typeof node === "number") return node;
  if (typeof node === "string") {
    const n = Number(node);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
