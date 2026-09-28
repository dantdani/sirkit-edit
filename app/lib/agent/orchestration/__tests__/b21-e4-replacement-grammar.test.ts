/**
 * [B21 E4] The router's replacement grammar MOVED into the composer module (D21-38) with the router's answers byte-identical. B21-D3's
 * appended section of router.ts - `partKindSwap(message, raw)` and every constant it reads (the closed vocabularies, the three request
 * shapes, `REPLACEMENT_FORMS`, `PART_WORD_FORMS`, `VACUOUS_FORMS`, `KIND_FAMILIES`, `OPINION`, `QUESTION_REQUEST`) with its polite-prefix
 * pattern `PART_KIND_SWAP` and the router's `POLITE` - is now ONE exported predicate in app/lib/project/composer-routing.ts beside
 * `REPLACE_PART`; the router imports it (and `POLITE`) on the line that imported `REPLACE_PART`, its rule line unchanged. Pinned: the
 * router's answers over the six-round corpus under five fact sets equal HEAD fafc90e's (digests RECORDED from the HEAD module before
 * the move); the grammar's code lines, trailing comments included, hash to HEAD's (moved verbatim, `export ` aside); the router keeps
 * none of them; no cycle. [B21 E4 fix: security-3] One moved line was then rewritten linear (the raw trailing run found from its start
 * alone) - case 2 pins it exactly and hashes the rest against HEAD's; case 1's digests prove every answer unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { POLITE, REPLACE_PART, partKindSwap } from "@/app/lib/project/composer-routing";
import { normalizeRouterMessage, routeTaskComplexity, type RouterFacts } from "../router";
import { FALSE_DAG, RECORDED_SEMANTIC, REPLACEMENT_REQUESTS } from "./_d3-router-corpus";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const ROUTER = "app/lib/agent/orchestration/router.ts";
const COMPOSER = "app/lib/project/composer-routing.ts";
const BASE: RouterFacts = { hasSchematic: true, hasBoard: true, actorRole: "pcb_editor", autonomyMode: "proposal_only", selectionCount: 0 };
const FACTS: Record<string, RouterFacts> = {
  base: BASE,
  noSchematic: { ...BASE, hasSchematic: false },
  viewer: { ...BASE, actorRole: "viewer" },
  noBoard: { ...BASE, hasBoard: false },
  admin: { ...BASE, actorRole: "project_admin", selectionCount: 2 },
};
/** RECORDED from HEAD fafc90e (the router module before the move): `engineeringDigest({ schema, facts, answers })` over the corpus */
const HEAD_ROUTER_ANSWERS: Record<string, string> = { base: "eng1-9d830a74b0d2cae3", noSchematic: "eng1-0159a53968206430", viewer: "eng1-876a51640526a8b9", noBoard: "eng1-f7045b53464d0a7e", admin: "eng1-4c33d34a1e74ed7b" };
/** RECORDED from HEAD fafc90e: the code lines of router.ts:70 (`POLITE`), :101 (`PART_KIND_SWAP`) and :201-291 (the grammar) - comment-only
 *  lines dropped, trailing comments kept, a leading `export ` stripped - 47 lines */
const HEAD_GRAMMAR = { count: 47, digest: "eng1-4625e5cec7a07ae5" };
const codeLines = (lines: readonly string[]): string[] => lines.filter((line) => { const t = line.trim(); return t.length > 0 && !t.startsWith("/**") && !t.startsWith("*") && !t.startsWith("//"); }).map((line) => line.replace(/^export /, ""));
/** [B21 E4 fix: security-3] reviewed pin move: ONE code line of the moved grammar was rewritten after the move - the raw message's trailing
 *  run, found from its START alone (a lookbehind; the old scan restarted inside a whitespace run: quadratic on the composer's unbounded
 *  text). It is the same run on every text (b21-e4-composer-routing case 6), so every answer is unchanged (case 1's digests). The pin stays
 *  exact: that line is exactly `now`, and with HEAD's text put back in its place the 47 lines hash to HEAD's digest. */
const LINEAR_TRAILING = {
  head: "  const trailing = /[.!?\\s]*$/.exec(raw.trim())?.[0] ?? \"\";",
  now: "  const trailing = /(?<![.!?\\s])[.!?\\s]*$/.exec(raw.trim())?.[0] ?? \"\"; // [B21 E4 fix: security-3] the same trailing run, found from its START alone (a lookbehind): linear on any text",
};
const CORPUS = [...FALSE_DAG, ...REPLACEMENT_REQUESTS, ...RECORDED_SEMANTIC];

describe("[B21 E4] the replacement grammar moved into the composer module; the router's answers byte-identical", () => {
  it("1. the router's answers are byte-identical to HEAD's: over the whole six-round corpus (1007 false DAG phrasings, 194 genuine requests, 46 recorded residues) under five fact sets - a schematic and a board with a pcb_editor, no schematic, a viewer, no board, a project_admin with a selection - each digest equals the one recorded from HEAD fafc90e before the move", () => {
    expect([FALSE_DAG.length, REPLACEMENT_REQUESTS.length, RECORDED_SEMANTIC.length]).toEqual([1007, 194, 46]);
    for (const [name, facts] of Object.entries(FACTS)) {
      expect(engineeringDigest({ schema: "b21-e4-router-answers", facts, answers: CORPUS.map((text) => routeTaskComplexity(text, facts)) }), name).toBe(HEAD_ROUTER_ANSWERS[name]);
    }
  });

  it("2. moved VERBATIM: the grammar's code lines in composer-routing.ts - from `export const POLITE` to the closing brace of `partKindSwap` - hash to HEAD's 47 code lines of router.ts (trailing comments included, `export ` aside); router.ts keeps none of them and ends with `routeTaskComplexity`", () => {
    const composer = read(COMPOSER).split(NEWLINE);
    const from = composer.findIndex((line) => line.startsWith("export const POLITE = "));
    const to = composer.findIndex((line, index) => index > from && line.startsWith("export function partKindSwap(message: string, raw: string): boolean {"));
    const end = composer.findIndex((line, index) => index > to && line === "}");
    expect([from, to, end].every((index) => index > 0)).toBe(true);
    const moved = codeLines(composer.slice(from, end + 1));
    expect(moved).toHaveLength(HEAD_GRAMMAR.count);
    expect(moved.filter((line) => line === LINEAR_TRAILING.now)).toHaveLength(1); // [B21 E4 fix: security-3] the one rewritten line, exactly
    expect(engineeringDigest(moved.map((line) => (line === LINEAR_TRAILING.now ? LINEAR_TRAILING.head : line)))).toBe(HEAD_GRAMMAR.digest);
    const router = read(ROUTER);
    for (const line of moved.filter((entry) => entry.startsWith("const ") || entry.startsWith("function "))) expect(router, line.slice(0, 40)).not.toContain(line);
    expect(router.trimEnd().endsWith(`  return single("S-default");${NEWLINE}}`)).toBe(true);
  });

  it("3. ONE predicate, the router importing it: router.ts imports `POLITE` and `partKindSwap` from composer-routing.ts on the line that imported `REPLACE_PART` (line 23) and calls the predicate on its unchanged rule line (177); composer-routing.ts imports nothing, so no cycle; the router's head-verb rules read the imported prefix", () => {
    const lines = read(ROUTER).split(NEWLINE);
    expect(lines[22]).toMatch(/^import \{ POLITE, partKindSwap \} from "\.\.\/\.\.\/project\/composer-routing";/);
    expect(lines.filter((line) => line.startsWith("import ") && line.includes("composer-routing"))).toHaveLength(1);
    expect(lines[176]).toContain("if (facts.hasSchematic && partKindSwap(message, userMessage)) return dag(\"D-component-replacement\"");
    expect(lines.some((line) => /\bREPLACE_PART\b/.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/**"))).toBe(false);
    expect(read(COMPOSER)).not.toMatch(/^import /m);
    expect(POLITE.startsWith("(?:(?:please|now|just|first|ok|okay|go ahead and|let's|can you|could you|would you|")).toBe(true);
    expect(routeTaskComplexity("Could you please release the board?", BASE).kind).toBe("refused");
    expect(routeTaskComplexity("go ahead and move R3 2 mm to the right", BASE).rule).toBe("S-explicit");
  });

  it("4. the router's replacement decision IS the predicate: for every corpus phrasing (a schematic present, a pcb_editor) `D-component-replacement` exactly when `partKindSwap(normalizeRouterMessage(text), text)` holds; the part-word forms still require the composer's pairing (`REPLACE_PART`) to agree", () => {
    for (const text of CORPUS) expect(routeTaskComplexity(text, BASE).rule === "D-component-replacement", JSON.stringify(text)).toBe(partKindSwap(normalizeRouterMessage(text), text));
    for (const text of ["Swap U1 for a lower-power alternative.", "Delete U1 and replace it with the approved lower-power part while preserving compatible nets."]) {
      expect(REPLACE_PART.test(normalizeRouterMessage(text)), text).toBe(true);
      expect(partKindSwap(normalizeRouterMessage(text), text), text).toBe(true);
    }
  });
});
