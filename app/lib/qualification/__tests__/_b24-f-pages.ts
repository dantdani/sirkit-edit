/**
 * [B24-F] Readers for B24-F's pages and maps, test-only (lead decision D17: no production module and no generator imports this file).
 * Pure over text: a Markdown table is read under its heading by the heading's text, never by its line; a cell holds no `|`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const ROOT = process.cwd();

/** A repository file's text with LF line ends, or "" when it is no file. */
export function readRepo(path: string): string {
  try {
    return readFileSync(join(ROOT, ...path.split("/")), "utf8").split(`${CR}${NEWLINE}`).join(NEWLINE);
  } catch {
    return "";
  }
}

export interface MarkdownTable {
  /** the 1-based line of the header row */
  readonly line: number;
  /** the nearest heading above the table, as written (with its `#`s) */
  readonly heading: string;
  readonly header: readonly string[];
  readonly rows: ReadonlyArray<readonly string[]>;
}

const cellsOf = (line: string): string[] => line.slice(1, -1).split("|").map((cell) => cell.trim());

/** Every Markdown table of a page: a `| ... |` row followed by a `|---|` separator, then its rows until the first non-row line. */
export function markdownTables(text: string): MarkdownTable[] {
  const lines = text.split(NEWLINE);
  const tables: MarkdownTable[] = [];
  let heading = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^#{1,6} /.test(line)) heading = line;
    if (!(line.startsWith("|") && line.endsWith("|") && /^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[index + 1] ?? ""))) continue;
    const header = cellsOf(line);
    const rows: string[][] = [];
    let at = index + 2;
    for (; at < lines.length && lines[at]!.startsWith("|") && lines[at]!.endsWith("|"); at += 1) rows.push(cellsOf(lines[at]!));
    tables.push({ line: index + 1, heading, header, rows });
    index = at - 1;
  }
  return tables;
}

/** The one table under the heading that starts with `prefix` (the first table after it, before the next heading). */
export function tableUnder(text: string, prefix: string): MarkdownTable {
  const found = markdownTables(text).filter((table) => table.heading.replace(/^#{1,6} /, "").startsWith(prefix));
  if (found.length !== 1) throw new Error(`B24_F_TABLE: ${found.length} tables under "${prefix}"`);
  return found[0]!;
}

/** A table's rows as records keyed by its header. */
export function records(table: MarkdownTable): Array<Readonly<Record<string, string>>> {
  return table.rows.map((row) => Object.fromEntries(table.header.map((name, index) => [name, row[index] ?? ""])));
}

/** A page section: from the heading that starts with `prefix` (any level) to the next heading of the same or a higher level. */
export function sectionOf(text: string, prefix: string): string {
  const lines = text.split(NEWLINE);
  const start = lines.findIndex((line) => /^#{1,6} /.test(line) && line.replace(/^#{1,6} /, "").startsWith(prefix));
  if (start < 0) return "";
  const level = /^#+/.exec(lines[start]!)![0].length;
  const end = lines.findIndex((line, index) => index > start && /^#{1,6} /.test(line) && /^#+/.exec(line)![0].length <= level);
  return lines.slice(start, end < 0 ? undefined : end).join(NEWLINE);
}

/** Every backticked `path:line` (or `path:line, :line`) citation of a page: the path and its first line. */
export function citations(text: string): Array<{ readonly path: string; readonly line: number }> {
  const out: Array<{ path: string; line: number }> = [];
  for (const match of text.matchAll(/`((?:app|artifacts|scripts|docs|e2e|e2e-orchestration|e2e-production-auth|lib|components|\.github|drizzle)\/[^`\s:]+|[A-Za-z0-9_.-]+\.(?:json|ts|tsx|yml|md|mjs))(?::(\d+)(?:-\d+)?)`/g)) {
    out.push({ path: match[1]!, line: Number(match[2]) });
  }
  return out;
}
