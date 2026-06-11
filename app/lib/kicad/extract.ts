/**
 * Turns a parsed `.kicad_sym` S-expression tree into a typed list of parts.
 *
 * Responsibilities:
 *  - find every top-level `(symbol "...")` block in the file
 *  - pull out the user-facing metadata (description, keywords, MPN, …)
 *  - flatten the nested unit sub-symbols into a single structured pin list
 *  - capture the raw S-expression source of each symbol for future re-rendering
 *
 * Symbols that merely `(extends "PARENT")` another symbol are skipped — they
 * carry no geometry of their own; we ingest the parent.
 */

import {
  type SExpr,
  parseSExp,
  isList,
  head,
  findChild,
  findChildren,
  getString,
  getNumber,
} from "./sexp";
import {
  type KicadPin,
  toKicadPinType,
  normalizePinOrientation,
} from "./types";

/** One fully-extracted KiCad symbol, ready to embed and upsert. */
export type ExtractedSymbol = {
  name: string;
  description: string | null;
  keywords: string | null;
  mpn: string | null;
  manufacturer: string | null;
  datasheet: string | null;
  footprintHint: string | null;
  /** Every KiCad property, verbatim, keyed by property name. */
  properties: Record<string, string>;
  pins: KicadPin[];
  /** Original S-expression text for this `(symbol ...)` block. */
  symbolRaw: string;
};

/**
 * Extract all (non-extends) symbols from one parsed file.
 * `rawText` is the original file source, used to recover each symbol's raw block.
 */
export function extractSymbols(parsedFile: SExpr, rawText: string): ExtractedSymbol[] {
  if (!isList(parsedFile)) return [];

  const sourceByName = mapTopLevelSymbolSource(rawText);
  const out: ExtractedSymbol[] = [];

  for (const symbolNode of findChildren(parsedFile, "symbol")) {
    if (isExtendsSymbol(symbolNode)) continue;
    const extracted = extractOneSymbol(symbolNode, sourceByName);
    if (extracted) out.push(extracted);
  }
  return out;
}

/** True if this symbol derives its geometry from a parent via `(extends ...)`. */
export function isExtendsSymbol(symbolNode: SExpr[]): boolean {
  return findChild(symbolNode, "extends") !== null;
}

// ─── Library-level extraction with `extends` resolution ─────────────────────

/** A raw, unresolved top-level symbol gathered during pass 1. */
type RawSymbol = {
  name: string;
  /** Parent symbol name if this is `(extends "PARENT")`, else null. */
  parent: string | null;
  properties: Record<string, string>;
  pins: KicadPin[];
  symbolRaw: string;
};

/**
 * Extract every part from a whole library (all `.kicad_sym` files of one
 * `.kicad_symdir`), resolving `extends` inheritance.
 *
 * Many real parts (e.g. LM358) carry no geometry of their own — they
 * `(extends "PARENT")` and only override metadata. Rather than drop them, we
 * inherit the parent's pins and symbol geometry and apply the child's property
 * overrides. Inheritance is resolved transitively across the whole library.
 */
export function extractLibrary(rawFiles: string[]): ExtractedSymbol[] {
  // Pass 1: gather all top-level symbols across every file, keyed by name.
  const raws = new Map<string, RawSymbol>();
  for (const raw of rawFiles) {
    let tree: SExpr;
    try {
      tree = parseSExp(raw);
    } catch {
      continue; // a single malformed file shouldn't sink the library
    }
    if (!isList(tree)) continue;

    const sourceByName = mapTopLevelSymbolSource(raw);
    for (const node of findChildren(tree, "symbol")) {
      const name = getString(node[1]);
      if (!name) continue;
      raws.set(name, {
        name,
        parent: getString(findChild(node, "extends")?.[1]),
        properties: extractProperties(node),
        pins: extractPins(node),
        symbolRaw: sourceByName.get(name) ?? "",
      });
    }
  }

  // Pass 2: resolve inheritance into final parts (one per unique name).
  const out: ExtractedSymbol[] = [];
  for (const sym of raws.values()) {
    const resolved = resolveSymbol(sym, raws, new Set());
    out.push(buildExtractedSymbol(sym.name, resolved.properties, resolved.pins, resolved.symbolRaw));
  }
  return out;
}

type ResolvedSymbol = {
  properties: Record<string, string>;
  pins: KicadPin[];
  symbolRaw: string;
};

/**
 * Resolve one symbol against its parent chain. A child with no pins of its own
 * (the usual `extends` case) inherits the parent's pins and geometry; its
 * properties override the parent's. `seen` guards against cyclic `extends`.
 */
function resolveSymbol(
  sym: RawSymbol,
  raws: Map<string, RawSymbol>,
  seen: Set<string>,
): ResolvedSymbol {
  if (sym.parent && !seen.has(sym.name)) {
    const parent = raws.get(sym.parent);
    if (parent) {
      seen.add(sym.name);
      const base = resolveSymbol(parent, raws, seen);
      const inherit = sym.pins.length === 0;
      return {
        properties: { ...base.properties, ...sym.properties },
        pins: inherit ? base.pins : sym.pins,
        symbolRaw: inherit ? base.symbolRaw : sym.symbolRaw,
      };
    }
  }
  return { properties: sym.properties, pins: sym.pins, symbolRaw: sym.symbolRaw };
}

// ─── Per-symbol extraction ──────────────────────────────────────────────────

function extractOneSymbol(
  symbolNode: SExpr[],
  sourceByName: Map<string, string>,
): ExtractedSymbol | null {
  const name = getString(symbolNode[1]);
  if (!name) return null;
  return buildExtractedSymbol(
    name,
    extractProperties(symbolNode),
    extractPins(symbolNode),
    sourceByName.get(name) ?? "",
  );
}

/** Assemble an ExtractedSymbol from resolved property/pin/source data. */
function buildExtractedSymbol(
  name: string,
  properties: Record<string, string>,
  pins: KicadPin[],
  symbolRaw: string,
): ExtractedSymbol {
  return {
    name,
    description: cleanProp(properties["Description"]),
    keywords: cleanProp(properties["ki_keywords"]),
    mpn: cleanProp(properties["MPN"] ?? properties["Mpn"]),
    manufacturer: cleanProp(properties["Manufacturer"]),
    datasheet: cleanProp(properties["Datasheet"]),
    footprintHint: cleanProp(properties["Footprint"]),
    properties,
    pins,
    symbolRaw,
  };
}

/** Collect every `(property "Key" "Value" ...)` into a verbatim record. */
function extractProperties(symbolNode: SExpr[]): Record<string, string> {
  const props: Record<string, string> = {};
  for (const prop of findChildren(symbolNode, "property")) {
    const key = getString(prop[1]);
    const value = getString(prop[2]);
    if (key !== null) props[key] = value ?? "";
  }
  return props;
}

/**
 * Flatten pins from the nested unit sub-symbols (e.g. "R_1_1") into one list.
 * Also picks up any pins defined directly on the parent symbol, for safety.
 */
function extractPins(symbolNode: SExpr[]): KicadPin[] {
  const pins: KicadPin[] = [];

  for (const pin of findChildren(symbolNode, "pin")) {
    const parsed = parsePin(pin);
    if (parsed) pins.push(parsed);
  }
  for (const unit of findChildren(symbolNode, "symbol")) {
    for (const pin of findChildren(unit, "pin")) {
      const parsed = parsePin(pin);
      if (parsed) pins.push(parsed);
    }
  }
  return pins;
}

/** Parse a single `(pin <type> <style> (at x y angle) (length L) (name ..) (number ..))`. */
function parsePin(pinNode: SExpr[]): KicadPin | null {
  const at = findChild(pinNode, "at");
  const x = getNumber(at?.[1]) ?? 0;
  const y = getNumber(at?.[2]) ?? 0;
  const angle = getNumber(at?.[3]) ?? 0;

  const lengthNode = findChild(pinNode, "length");
  const length = getNumber(lengthNode?.[1]) ?? 0;

  const nameNode = findChild(pinNode, "name");
  const numberNode = findChild(pinNode, "number");

  return {
    number: getString(numberNode?.[1]) ?? "",
    name: getString(nameNode?.[1]) ?? "~",
    type: toKicadPinType(getString(pinNode[1])),
    position: { x, y },
    orientation: normalizePinOrientation(angle),
    length,
  };
}

// ─── Raw-source recovery ────────────────────────────────────────────────────

/**
 * Build a map from top-level symbol name → its raw S-expression text.
 *
 * We scan the raw file tracking parenthesis depth (ignoring parens inside
 * quoted strings). A top-level `(symbol ...)` opens while depth === 1 (directly
 * inside the root `kicad_symbol_lib` list). This naturally distinguishes real
 * parts from the nested unit sub-symbols, which open at deeper depth.
 */
function mapTopLevelSymbolSource(rawText: string): Map<string, string> {
  const map = new Map<string, string>();
  let depth = 0;
  let inString = false;
  let symbolStart: number | null = null;

  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i];

    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }

    if (ch === "(") {
      if (depth === 1 && symbolStart === null && tokenAfterParenIs(rawText, i, "symbol")) {
        symbolStart = i;
      }
      depth++;
    } else if (ch === ")") {
      depth--;
      // Closed the top-level symbol block (back down to depth 1).
      if (symbolStart !== null && depth === 1) {
        const block = rawText.slice(symbolStart, i + 1);
        const name = readSymbolName(block);
        if (name !== null) map.set(name, block);
        symbolStart = null;
      }
    }
  }
  return map;
}

/** Does the token immediately following the `(` at `parenIdx` equal `expected`? */
function tokenAfterParenIs(rawText: string, parenIdx: number, expected: string): boolean {
  let i = parenIdx + 1;
  while (i < rawText.length) {
    const ch = rawText[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
    break;
  }
  return rawText.startsWith(expected, i) && isTokenBoundary(rawText[i + expected.length]);
}

function isTokenBoundary(ch: string | undefined): boolean {
  return ch === undefined ||
    ch === " " || ch === "\t" || ch === "\n" || ch === "\r" ||
    ch === "(" || ch === ")" || ch === '"';
}

/** Read the quoted name out of a `(symbol "NAME" ...)` block, unescaping it. */
function readSymbolName(block: string): string | null {
  const match = /^\(\s*symbol\s+"((?:[^"\\]|\\.)*)"/.exec(block);
  if (!match) return null;
  return match[1]
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r");
}

// ─── Misc ───────────────────────────────────────────────────────────────────

/** Normalize a KiCad property value: treat "" and the "~" sentinel as absent. */
function cleanProp(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "~") return null;
  return trimmed;
}

/** Exposed only so the root list's tag can be sanity-checked by callers/tests. */
export function fileTag(parsedFile: SExpr): string | null {
  return isList(parsedFile) ? head(parsedFile) : null;
}
