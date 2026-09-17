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
 * [B19-D I5d row 46] The deepest list nesting accepted. Real KiCad symbol and footprint files nest a handful of levels; the
 * atomic ingestion preflight (`assertBoundedSExpression`) uses the same bound. The parser is iterative, so a hostile file
 * gets this refusal instead of a stack overflow.
 */
export const SEXP_MAX_DEPTH = 160;

export interface SExpParseOptions {
  /** deepest list nesting accepted (default {@link SEXP_MAX_DEPTH}) */
  maxDepth?: number;
}

/**
 * Parse a full S-expression document into a tree. The document is exactly one expression: content after it is refused.
 * Throws on malformed input (unterminated string/list, stray characters, trailing content, nesting beyond the bound).
 */
export function parseSExp(input: string, options: SExpParseOptions = {}): SExpr {
  const forms = parseForms(input, options.maxDepth ?? SEXP_MAX_DEPTH, true);
  if (forms.length !== 1) throw new Error("S-expression parse error at offset 0: the document is empty");
  return forms[0];
}

/**
 * [B19-D I5d row 46] Parse a sequence of top-level expressions (a `.kicad_dru` file is a list of forms, not one list). A
 * stray `)` is an error, never the silent end of a synthetic wrapper.
 */
export function parseSExpForms(input: string, options: SExpParseOptions = {}): SExpr[] {
  return parseForms(input, options.maxDepth ?? SEXP_MAX_DEPTH, false);
}

function parseForms(input: string, maxDepth: number, single: boolean): SExpr[] {
  let pos = 0;

  function fail(message: string): never {
    throw new Error(`S-expression parse error at offset ${pos}: ${message}`);
  }

  function skipWhitespace(): void {
    while (pos < input.length) {
      const ch = input[pos];
      // a U+FEFF byte-order mark is trivia, as in the lossless reader (`pcb/sexpr.ts`), so both readers split a file alike
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\uFEFF") {
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
        ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\uFEFF" ||
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

  // Iterative: an explicit stack of open lists replaces recursion, so nesting depth is a checked number, not the call stack.
  const forms: SExpr[] = [];
  const open: SExpr[][] = [];
  const place = (node: SExpr): void => {
    if (open.length > 0) open[open.length - 1].push(node);
    else forms.push(node);
  };
  for (;;) {
    skipWhitespace();
    if (pos >= input.length) break;
    const ch = input[pos];
    if (single && open.length === 0 && forms.length > 0) fail("unexpected content after the top-level expression");
    if (ch === "(") {
      if (open.length >= maxDepth) fail(`nesting depth exceeds ${maxDepth}`);
      open.push([]);
      pos++;
    } else if (ch === ")") {
      const closed = open.pop();
      if (!closed) fail("unexpected ')'");
      pos++;
      place(closed);
    } else {
      place(ch === '"' ? parseQuotedString() : parseAtom());
    }
  }
  if (open.length > 0) fail("unterminated list");
  return forms;
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
