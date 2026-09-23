/**
 * [B20 B4] Content-anchored citations (not a test file). A record cites a statement by the text it names (its anchor),
 * optionally inside one named function's body, and states the line AS OF a named base for the reader. The tests check the
 * anchor — it occurs exactly once where it is cited — never the line, so an unrelated edit to a shared file cannot break
 * them, while a change to the cited statement itself does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Citation {
  readonly id: string;
  readonly path: string;
  /** the line as of the base the page names (for the reader; never checked) */
  readonly line: number;
  /** the start of the enclosing function's declaration line, or null for the whole file */
  readonly within: string | null;
  readonly anchor: string;
}

const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);

export function sourceLines(root: string, path: string): string[] {
  return readFileSync(join(root, path), "utf8").replaceAll(CARRIAGE_RETURN + NEWLINE, NEWLINE).split(NEWLINE);
}

/** The lines an anchor is searched in: the whole file, or the body of the ONE function whose declaration line starts with
 *  `within`, up to the next line that is exactly "}" (null when that function is not there exactly once). */
export function citationScope(root: string, path: string, within: string | null): string[] | null {
  const lines = sourceLines(root, path);
  if (within === null) return lines;
  const starts = lines.flatMap((line, index) => (line.startsWith(within) ? [index] : []));
  if (starts.length !== 1) return null;
  const end = lines.findIndex((line, index) => index > starts[0]! && line === "}");
  return end < 0 ? null : lines.slice(starts[0], end + 1);
}

/** How many lines of the cited scope hold the anchor (-1 when the scope itself cannot be found). */
export function anchorOccurrences(root: string, citation: Pick<Citation, "path" | "within" | "anchor">): number {
  const scope = citationScope(root, citation.path, citation.within);
  return scope === null ? -1 : scope.filter((line) => line.includes(citation.anchor)).length;
}

/** The citation rows of a page table: id C<n>, the path, the line as of the base, the enclosing function or a dash, the anchor
 *  (every text cell in code quotes). */
export function pageCitations(page: string): Citation[] {
  const rows = [...page.matchAll(/^\| (C\d+) \| `([^`]+)` \| (\d+) \| (?:—|`([^`]+)`) \| `([^`]+)` \|/gm)];
  return rows.map((row) => ({ id: row[1]!, path: row[2]!, line: Number(row[3]), within: row[4] ?? null, anchor: row[5]! }));
}
