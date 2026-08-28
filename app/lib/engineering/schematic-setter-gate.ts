/**
 * B07.1 — STRUCTURAL enforcement of the schematic projection-setter boundary.
 *
 * The B07 tripwire only required each direct `setComponents`/`setWires`/
 * `setKicadComponents`/`setNetLabels` call in app/page.tsx to carry a line
 * comment containing `b07:` — so any future direct mutation could
 * self-certify by adding that comment. This module replaces the comment
 * convention with a whitelist of FUNCTION BODIES:
 *
 *  - `applyGesturePreviewFrame`          — non-authoritative gesture preview
 *  - `applyCanonicalSchematicProjection` — adoption of a committed canonical
 *                                          transaction result
 *  - `applyLifecycleSchematicProjection` — lifecycle replacement (hydration,
 *                                          undo/redo, checkpoint restore,
 *                                          canonical recovery adoption,
 *                                          AI apply, gesture rollback)
 *
 * The audit is a pure function over the page source, so the CI test can run
 * it against BOTH the real file and adversarial variants (a forged `b07:`
 * comment, an aliased setter, a new raw call) without touching the tree.
 * Outside the three approved bodies, the raw setter identifiers (the four
 * projection setters plus B07.2's `setAuthoritativeSchematic` authoritative
 * mirror) may appear ONLY in their `useState` destructuring declarations —
 * calls, aliases, ref-stashes, and prop threading are all violations.
 * Comments have NO exempting power.
 */

export const RAW_SCHEMATIC_SETTERS = ["setComponents", "setWires", "setKicadComponents", "setNetLabels", "setAuthoritativeSchematic"] as const;

export const APPROVED_PROJECTION_APPLIERS = [
  "applyGesturePreviewFrame",
  "applyCanonicalSchematicProjection",
  "applyLifecycleSchematicProjection",
] as const;

export interface SetterGateViolation {
  line: number;
  identifier: string;
  reason: string;
  text: string;
}

interface SourceRange {
  start: number;
  end: number;
}

/** Byte range of `const <name> = useCallback(…)` including the full argument
 *  list, found by paren matching (string/comment aware enough for this file). */
function applierBodyRange(source: string, name: string): SourceRange | null {
  const declaration = `const ${name} = useCallback(`;
  const start = source.indexOf(declaration);
  if (start < 0) return null;
  if (source.indexOf(declaration, start + 1) >= 0) return null; // must be unique
  let index = start + declaration.length - 1; // at the opening paren
  let depth = 0;
  let mode: "code" | "line-comment" | "block-comment" | "string" = "code";
  let quote = "";
  for (; index < source.length; index += 1) {
    const ch = source[index];
    const next = source[index + 1];
    if (mode === "line-comment") {
      if (ch === "\n") mode = "code";
      continue;
    }
    if (mode === "block-comment") {
      if (ch === "*" && next === "/") { mode = "code"; index += 1; }
      continue;
    }
    if (mode === "string") {
      if (ch === "\\") { index += 1; continue; }
      if (ch === quote) mode = "code";
      continue;
    }
    if (ch === "/" && next === "/") { mode = "line-comment"; index += 1; continue; }
    if (ch === "/" && next === "*") { mode = "block-comment"; index += 1; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { mode = "string"; quote = ch; continue; }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return { start, end: index + 1 };
    }
  }
  return null;
}

const DECLARATION_PATTERN = /const\s*\[\s*\w+\s*,\s*(setComponents|setWires|setKicadComponents|setNetLabels|setAuthoritativeSchematic)\s*\]\s*=\s*useState/;

/**
 * Audit the page source. Returns [] when every raw setter occurrence is
 * either its useState declaration or inside an approved applier body, and
 * every approved applier exists exactly once.
 */
export function auditSchematicSetterAuthority(source: string): SetterGateViolation[] {
  const violations: SetterGateViolation[] = [];
  const ranges: SourceRange[] = [];
  for (const name of APPROVED_PROJECTION_APPLIERS) {
    const range = applierBodyRange(source, name);
    if (!range) {
      violations.push({ line: 0, identifier: name, reason: `approved projection applier "${name}" must exist exactly once as \`const ${name} = useCallback(…)\``, text: "" });
      continue;
    }
    ranges.push(range);
  }
  const pattern = new RegExp(`\\b(${RAW_SCHEMATIC_SETTERS.join("|")})\\b`, "g");
  const lineStarts: number[] = [0];
  for (let index = 0; index < source.length; index += 1) if (source[index] === "\n") lineStarts.push(index + 1);
  const lineOf = (offset: number): number => {
    let low = 0, high = lineStarts.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (lineStarts[mid] <= offset) low = mid; else high = mid - 1; }
    return low + 1;
  };
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    const offset = match.index;
    if (ranges.some((range) => offset >= range.start && offset < range.end)) continue;
    const line = lineOf(offset);
    const text = source.slice(lineStarts[line - 1], source.indexOf("\n", lineStarts[line - 1]) === -1 ? source.length : source.indexOf("\n", lineStarts[line - 1])).trim();
    if (DECLARATION_PATTERN.test(text)) continue;
    // A pure comment line cannot execute a setter; note that a comment ON a
    // code line ("setComponents(x) /* b07: */") is still flagged.
    if (text.startsWith("//") || text.startsWith("*") || text.startsWith("/*")) continue;
    violations.push({
      line,
      identifier: match[1],
      reason: `raw schematic setter "${match[1]}" referenced outside the approved projection appliers (comments cannot exempt it)`,
      text: text.slice(0, 120),
    });
  }
  return violations;
}
