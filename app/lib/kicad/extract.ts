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
import { safeHref } from "../net/href-policy";
import { emitVerbatim, parseSexpr } from "../pcb/sexpr";

/**
 * [B19-D I5d rows 45, 08] A problem found while resolving one symbol. The symbol is still returned (a library ingest must not
 * sink on one bad symbol), but a consumer that needs a trustworthy definition must treat it as not valid.
 */
export type ExtractionIssue = {
  code: "duplicate_symbol_name" | "extends_cycle" | "extends_missing_parent" | "extends_depth" | "empty_symbol_block";
  message: string;
};

/**
 * [B19-D I5d row 45] How many `extends` links are followed. KiCad derives a symbol from a root symbol (one level); a chain
 * this long is not a real library, and resolution is iterative so a hostile chain is a checked number, not the call stack.
 */
export const EXTENDS_MAX_DEPTH = 16;

/**
 * [B19-D I5d review] Inheritance multiplies what later work handles: every derived symbol carries its parent's properties
 * and raw block. A caller that hashes or stores each symbol (atomic ingestion) passes bounds, checked before any property map
 * is built; exceeding one throws this error with a stable code.
 */
export interface ExtractionBudget {
  /** total property entries across all resolved symbols */
  maxResolvedProperties?: number;
  /** total characters of resolved raw symbol blocks */
  maxResolvedRawChars?: number;
}

export class ExtractionBudgetError extends Error {
  constructor(readonly code: "expanded_property_budget" | "expanded_raw_budget", message: string) {
    super(message);
    this.name = "ExtractionBudgetError";
  }
}

/**
 * [B19-D I5d review] What an operator ingest may upsert: symbols with no extraction issue. A duplicated name, a cyclic, dangling
 * or cut `extends` chain, or a missing definition block is skipped and reported, never ingested silently.
 */
export function symbolsSafeToIngest(symbols: readonly ExtractedSymbol[]): { accepted: ExtractedSymbol[]; skipped: Array<{ name: string; codes: string[] }> } {
  const accepted: ExtractedSymbol[] = [];
  const skipped: Array<{ name: string; codes: string[] }> = [];
  for (const symbol of symbols) {
    if (symbol.issues.length === 0) accepted.push(symbol);
    else skipped.push({ name: symbol.name, codes: [...new Set(symbol.issues.map((issue) => issue.code))].sort() });
  }
  return { accepted, skipped };
}

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
  /** [B19-D I5d] problems resolving this symbol; empty when its definition is trustworthy */
  issues: ExtractionIssue[];
};

/**
 * Extract all (non-extends) symbols from one parsed file.
 * `rawText` is the original file source, used to recover each symbol's raw block.
 */
export function extractSymbols(parsedFile: SExpr, rawText: string): ExtractedSymbol[] {
  if (!isList(parsedFile)) return [];

  let sourceByName: Map<string, string>;
  try {
    sourceByName = topLevelSymbolBlocks(rawText);
  } catch {
    sourceByName = new Map(); // text that does not parse has no trustworthy blocks; each symbol reports an empty block
  }
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
export function extractLibrary(rawFiles: string[], budget: ExtractionBudget = {}): ExtractedSymbol[] {
  // Pass 1: gather all top-level symbols across every file, keyed by name.
  const raws = new Map<string, RawSymbol>();
  const duplicated = new Set<string>();
  for (const raw of rawFiles) {
    let tree: SExpr;
    let sourceByName: Map<string, string>;
    try {
      // one bounded document: trailing content or hostile nesting makes the file malformed
      tree = parseSExp(raw);
      sourceByName = topLevelSymbolBlocks(raw);
    } catch {
      continue; // a single malformed file shouldn't sink the library
    }
    if (!isList(tree)) continue;

    for (const node of findChildren(tree, "symbol")) {
      const name = getString(node[1]);
      if (!name) continue;
      // [B19-D I5d row 45] a second definition of a name is a conflict, never a silent last-wins replacement
      if (raws.has(name)) duplicated.add(name);
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
  let resolvedProperties = 0;
  let resolvedRawChars = 0;
  for (const sym of raws.values()) {
    const chain = symbolChain(sym, raws);
    // [B19-D I5d review] the cost of resolving this symbol is known from its chain before any map is built
    const properties = chain.members.reduce((total, member) => total + Object.keys(member.properties).length, 0);
    resolvedProperties += properties;
    if (budget.maxResolvedProperties !== undefined && resolvedProperties > budget.maxResolvedProperties) {
      throw new ExtractionBudgetError("expanded_property_budget", `The library expands to more than ${budget.maxResolvedProperties} symbol properties after inheritance`);
    }
    const resolved = foldChain(chain);
    resolvedRawChars += resolved.symbolRaw.length;
    if (budget.maxResolvedRawChars !== undefined && resolvedRawChars > budget.maxResolvedRawChars) {
      throw new ExtractionBudgetError("expanded_raw_budget", `The library expands to more than ${budget.maxResolvedRawChars} characters of symbol definitions after inheritance`);
    }
    const issues = [...chain.issues];
    if (duplicated.has(sym.name)) issues.unshift({ code: "duplicate_symbol_name", message: "The library defines this symbol name more than once" });
    // [B19-D I5d review] deriving from a duplicated name inherits whichever definition came last — as ambiguous as the duplicate
    else if (chain.members.slice(1).some((member) => duplicated.has(member.name))) issues.unshift({ code: "duplicate_symbol_name", message: "The symbol inherits from a symbol name the library defines more than once" });
    if (!resolved.symbolRaw) issues.push({ code: "empty_symbol_block", message: "No symbol definition block was found for this symbol" });
    out.push(buildExtractedSymbol(sym.name, resolved.properties, resolved.pins, resolved.symbolRaw, issues));
  }
  return out;
}

type ResolvedSymbol = {
  properties: Record<string, string>;
  pins: KicadPin[];
  symbolRaw: string;
};

type SymbolChain = { members: RawSymbol[]; issues: ExtractionIssue[] };

/**
 * Resolve one symbol against its parent chain. A child with no pins of its own
 * (the usual `extends` case) inherits the parent's pins and geometry; its
 * properties override the parent's.
 *
 * [B19-D I5d row 45] Iterative: the chain is collected first (stopping at a cycle, a missing parent or
 * {@link EXTENDS_MAX_DEPTH}) and folded from the root down. Each stop is reported as an issue instead of resolving silently
 * to whatever the chain happened to reach.
 */
function symbolChain(sym: RawSymbol, raws: Map<string, RawSymbol>): SymbolChain {
  const chain: RawSymbol[] = [sym];
  const seen = new Set<string>([sym.name]);
  const issues: ExtractionIssue[] = [];
  for (let current = sym; current.parent !== null;) {
    if (seen.has(current.parent)) {
      issues.push({ code: "extends_cycle", message: "The symbol's extends chain is cyclic" });
      break;
    }
    const parent = raws.get(current.parent);
    if (!parent) {
      issues.push({ code: "extends_missing_parent", message: "The symbol extends a symbol that is not in the library" });
      break;
    }
    if (chain.length > EXTENDS_MAX_DEPTH) {
      issues.push({ code: "extends_depth", message: `The symbol's extends chain is deeper than ${EXTENDS_MAX_DEPTH} levels` });
      break;
    }
    seen.add(parent.name);
    chain.push(parent);
    current = parent;
  }
  return { members: chain, issues };
}

function foldChain({ members }: SymbolChain): ResolvedSymbol {
  const root = members[members.length - 1];
  let resolved: ResolvedSymbol = { properties: root.properties, pins: root.pins, symbolRaw: root.symbolRaw };
  for (let index = members.length - 2; index >= 0; index--) {
    const child = members[index];
    const inherit = child.pins.length === 0;
    resolved = {
      // a child with no properties of its own shares its parent's map instead of copying it
      properties: Object.keys(child.properties).length === 0 ? resolved.properties : { ...resolved.properties, ...child.properties },
      pins: inherit ? resolved.pins : child.pins,
      symbolRaw: inherit ? resolved.symbolRaw : child.symbolRaw,
    };
  }
  return resolved;
}

// ─── Per-symbol extraction ──────────────────────────────────────────────────

function extractOneSymbol(
  symbolNode: SExpr[],
  sourceByName: Map<string, string>,
): ExtractedSymbol | null {
  const name = getString(symbolNode[1]);
  if (!name) return null;
  const symbolRaw = sourceByName.get(name) ?? "";
  return buildExtractedSymbol(
    name,
    extractProperties(symbolNode),
    extractPins(symbolNode),
    symbolRaw,
    symbolRaw ? [] : [{ code: "empty_symbol_block", message: "No symbol definition block was found for this symbol" }],
  );
}

/** Assemble an ExtractedSymbol from resolved property/pin/source data. */
function buildExtractedSymbol(
  name: string,
  properties: Record<string, string>,
  pins: KicadPin[],
  symbolRaw: string,
  issues: ExtractionIssue[],
): ExtractedSymbol {
  return {
    name,
    description: cleanProp(properties["Description"]),
    keywords: cleanProp(properties["ki_keywords"]),
    mpn: cleanProp(properties["MPN"] ?? properties["Mpn"]),
    manufacturer: cleanProp(properties["Manufacturer"]),
    // [B19-D I5c row 34] a Datasheet that is not a web link is not a datasheet link (the raw property stays in `properties`)
    datasheet: safeHref(cleanProp(properties["Datasheet"]), "document"),
    footprintHint: cleanProp(properties["Footprint"]),
    properties,
    pins,
    symbolRaw,
    issues,
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
    const parsed = parsePin(pin, 1, 1);
    if (parsed) pins.push(parsed);
  }
  for (const unit of findChildren(symbolNode, "symbol")) {
    const unitIdentity = parseUnitBodyIdentity(getString(unit[1]));
    for (const pin of findChildren(unit, "pin")) {
      const parsed = parsePin(pin, unitIdentity.unit, unitIdentity.bodyStyle);
      if (parsed) pins.push(parsed);
    }
  }
  const counts = new Map<string, number>();
  for (const pin of pins) counts.set(pin.number, (counts.get(pin.number) ?? 0) + 1);
  for (const pin of pins) pin.stacked = (counts.get(pin.number) ?? 0) > 1;
  return pins;
}

function parseUnitBodyIdentity(name: string | null): { unit: number; bodyStyle: number } {
  const match = name?.match(/_(\d+)_(\d+)$/);
  return {
    unit: match ? Number(match[1]) : 1,
    bodyStyle: match ? Number(match[2]) : 1,
  };
}

/** Parse a single `(pin <type> <style> (at x y angle) (length L) (name ..) (number ..))`. */
function parsePin(pinNode: SExpr[], unit: number, bodyStyle: number): KicadPin | null {
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
    unit,
    bodyStyle,
    hidden: pinNode.some((node) => node === "hide"),
    stacked: false,
  };
}

// ─── Raw-source recovery ────────────────────────────────────────────────────

/**
 * Build a map from top-level symbol name → its raw S-expression text.
 *
 * [B19-D I5d row 08] The file is read once with the lossless parser and each top-level `(symbol …)` block is sliced by its
 * own source span, keyed by the name exactly as the parser unescaped it — the same reading `parseSExp` gives the pins. A
 * separate text scan with its own escape handling let two differently escaped names collide, so a symbol could be exported
 * with another symbol's block. Nested unit sub-symbols are children of a top-level block, never entries here. For a name
 * defined twice the last block wins, matching the last definition in the parsed tree (the duplicate is reported).
 */
function topLevelSymbolBlocks(rawText: string): Map<string, string> {
  const map = new Map<string, string>();
  const root = parseSexpr(rawText);
  for (const node of root.items) {
    if (node.kind !== "list") continue;
    const headNode = node.items[0];
    const nameNode = node.items[1];
    if (headNode?.kind !== "symbol" || headNode.value !== "symbol") continue;
    if (nameNode?.kind !== "string" && nameNode?.kind !== "symbol") continue;
    map.set(nameNode.value, emitVerbatim(node, rawText));
  }
  return map;
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
