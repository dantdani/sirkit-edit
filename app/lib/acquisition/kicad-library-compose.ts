/**
 * [PR-M, 2026-10-18] Section M2 (design M2.3): KiCad's split symbol libraries (`<library>.kicad_symdir/<name>.kicad_sym`, one file per
 * symbol) let a symbol `(extends "PARENT")` a symbol of the SAME library stored in another file - the official 1N4148 extends 1N4001. The
 * production parser reads one library text and resolves `extends` inside it, so a derived symbol read alone is `unsupported`
 * (extends_missing_parent). This module assembles the ONE library text KiCad itself sees for that symbol: the child file's header and
 * the parent chain's `(symbol ...)` blocks followed by the child's, each block copied BYTE FOR BYTE from its retrieved file (a
 * deterministic normalization; every input object is stored and hashed on its own, and the composition records their hashes).
 *
 * Bounded: every input passes the s-expression preflight first; at most `COMPOSE_MAX_DEPTH` parents; a name defined twice, a missing
 * parent or a cycle is a refusal (and the parser would mark it unsupported anyway).
 */
import { assertBoundedSExpression } from "../atomic/security";
import { child, children, parseSexpr, type SList } from "../pcb/sexpr";

export const COMPOSE_MAX_DEPTH = 2;
export const KICAD_COMPOSE_VERSION = "sirkit.kicad-symdir-compose/1" as const;

export interface SymbolBlock { name: string; extendsName: string | null; raw: string }

function atom(node: SList | undefined, index: number): string | null {
  const item = node?.items[index];
  if (!item || item.kind === "list") return null;
  return item.kind === "number" ? item.raw : item.value;
}

/** The library's top-level symbol blocks (name, parent, exact text), or null when the text is not a KiCad symbol library. */
export function topLevelSymbolBlocks(text: string): { header: string; blocks: SymbolBlock[]; footer: string } | null {
  assertBoundedSExpression(text);
  let root: SList;
  try { root = parseSexpr(text); } catch { return null; }
  // the lossless root covers the whole source; its first list is the library
  const library = root.items[0]?.kind === "symbol" ? root : root.items.find((item): item is SList => item.kind === "list");
  if (!library || library.kind !== "list") return null;
  const head = library.items[0];
  if (!head || head.kind !== "symbol" || head.value !== "kicad_symbol_lib") return null;
  const symbols = children(library, "symbol");
  if (symbols.length === 0) return { header: text, blocks: [], footer: "" };
  const blocks = symbols.map((node) => ({ name: atom(node, 1) ?? "", extendsName: atom(child(node, "extends"), 1), raw: text.slice(node.start, node.end) }));
  return { header: text.slice(0, symbols[0]!.start), blocks, footer: text.slice(symbols.at(-1)!.end) };
}

/** The `extends` parent of `name` in this library text (null: a root symbol, or the name is not defined here). */
export function symbolParent(text: string, name: string): string | null {
  return topLevelSymbolBlocks(text)?.blocks.find((block) => block.name === name)?.extendsName ?? null;
}

export type ComposeOutcome = { ok: true; text: string; composed: boolean } | { ok: false; code: "not_a_library" | "missing_parent" | "duplicate_name" | "too_deep"; detail: string };

/**
 * One library text for `name`: the child alone when it extends nothing, else the child's header, every ancestor's block (root first),
 * the child's blocks and the child's footer. `parents` maps a parent name to its own file's text.
 */
export function composeSymbolLibrary(childText: string, name: string, parents: ReadonlyMap<string, string>): ComposeOutcome {
  const childLib = topLevelSymbolBlocks(childText);
  if (!childLib) return { ok: false, code: "not_a_library", detail: "the symbol file is not a KiCad symbol library" };
  const own = childLib.blocks.find((block) => block.name === name);
  if (!own) return { ok: false, code: "missing_parent", detail: `the file does not define ${name}` };
  if (own.extendsName === null) return { ok: true, text: childText, composed: false };
  const chain: SymbolBlock[] = [];
  const seen = new Set<string>(childLib.blocks.map((block) => block.name));
  let next: string | null = own.extendsName;
  while (next !== null) {
    const wanted: string = next;
    // a parent already in the text (the child's own file, or a file added above) is resolved by the parser; a cycle is its refusal
    if (childLib.blocks.some((block) => block.name === wanted) || chain.some((block) => block.name === wanted)) break;
    if (chain.length >= COMPOSE_MAX_DEPTH) return { ok: false, code: "too_deep", detail: `the extends chain is deeper than ${COMPOSE_MAX_DEPTH}` };
    const parentText = parents.get(wanted);
    if (parentText === undefined) return { ok: false, code: "missing_parent", detail: `the parent symbol ${wanted} was not retrieved` };
    const parentLib = topLevelSymbolBlocks(parentText);
    if (!parentLib) return { ok: false, code: "not_a_library", detail: `the parent ${wanted} is not a KiCad symbol library` };
    const parent = parentLib.blocks.find((block) => block.name === wanted);
    if (!parent) return { ok: false, code: "missing_parent", detail: `the parent file does not define ${wanted}` };
    for (const block of parentLib.blocks) {
      if (seen.has(block.name)) return { ok: false, code: "duplicate_name", detail: `${block.name} is defined twice or forms a cycle` };
      seen.add(block.name);
    }
    chain.unshift(...parentLib.blocks);
    next = parent.extendsName;
  }
  const separator = /\r\n/.test(childText) ? "\r\n\t" : "\n\t";
  const body = [...chain.map((block) => block.raw), ...childLib.blocks.map((block) => block.raw)].join(separator);
  return { ok: true, text: `${childLib.header}${body}${childLib.footer}`, composed: true };
}
