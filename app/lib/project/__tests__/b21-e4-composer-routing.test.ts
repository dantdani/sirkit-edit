/**
 * [B21 E4] The composer reaches the DAG with the runbook's own sentence (D21-38). Until B21-E4 the composer's rule 5b paired a
 * replace / swap verb with a part / component / MPN word only, so "Replace the NE555 timer U1 with a lower-power timer." (runbook
 * scenario 17) fell to rule 8 and went to the schematic editor, which cannot make a replacement. The router's strict replacement
 * grammar (B21-D3's `partKindSwap`, the six-round adversarial corpus) now lives in composer-routing.ts beside `REPLACE_PART` as ONE
 * exported predicate, rule 5b uses it, and the router imports it (never the reverse). Over the SAME corpus through the composer:
 * every genuine request and every recorded semantic residue reaches the assistant; no false DAG phrasing changes its route (the
 * predicate is false for every one of them); the only routes that move are the ones the predicate names - each pinned below against
 * HEAD fafc90e's composer (its routes over the corpus recorded from the HEAD module before the move, a digest). No new control: the
 * three route labels are B18's and the page's one import of this module is unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { normalizeRouterMessage, routeTaskComplexity, type RouterFacts } from "@/app/lib/agent/orchestration/router";
import { FALSE_DAG, RECORDED_SEMANTIC, REPLACEMENT_REQUESTS } from "@/app/lib/agent/orchestration/__tests__/_d3-router-corpus";
import { SCENARIO_17, SCENARIO_17_VARIANTS } from "@/app/lib/agent/orchestration/__tests__/_d3-fixtures";
import * as composer from "../composer-routing";
import { COMPOSER_ROUTE_LABELS, REPLACE_PART, partKindSwap, routeComposerMessage, type ComposerRouting } from "../composer-routing";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const SWAP_REASON = "asks to swap a part: the assistant prepares the server-owned replacement proposal the schematic editor cannot make";
const FACTS: RouterFacts = { hasSchematic: true, hasBoard: true, actorRole: "pcb_editor", autonomyMode: "proposal_only", selectionCount: 0 };
/** the router's replacement predicate, called the way the router calls it (its own normalization, the raw message) */
const predicate = (text: string): boolean => partKindSwap(normalizeRouterMessage(text), text);
const CORPUS = [...FALSE_DAG, ...REPLACEMENT_REQUESTS, ...RECORDED_SEMANTIC];

/** HEAD fafc90e's `routeComposerMessage` (composer-routing.ts:34-58 at that commit) copied as the baseline: its routes over the corpus
 *  hash to HEAD_COMPOSER_DIGEST, which was RECORDED from the HEAD module itself before the move - so the copy is HEAD's behaviour. */
const HEAD_COMPOSER_DIGEST = "eng1-eb39b36a0f07a413";
function headComposer(text: string, hasSchematic: boolean): ComposerRouting {
  const EDIT_VERB = /^(?:edit|change|set|rename|delete|remove|add|replace|swap|connect|disconnect|rewire|fix|update)\b/;
  const GENERATE_VERB = /^(?:create|build|make|draw)\b/;
  const EXECUTION_VERB = /^(?:please\s+)?(?:move|shift|nudge|rotate|turn|flip|put|undo|redo)\b/;
  const PCB_NOUN = /\b(?:silk(?:screen)?|vias?|tracks?|traces?|dimensions?|copper|zones?|pours?|keep-?outs?|courtyards?|drills?|layers?|pcb|drc|board outline)\b/;
  const MAKE_PART = /^make\s+(?:r|c|u|d|led|j|sw)\d+\b/;
  const HEAD_REPLACE_PART = /\b(?:replace|replacing|swap|swapping|substitute)\b[^.!?]*\b(?:parts?|components?|mpns?|alternates?|alternatives?|chips?)\b/;
  const TIER3_WORD = /\b(?:release|publish|order|purchase|buy|qualify|upload|ship)\b/;
  const t = text.trim().toLowerCase();
  const hints: ComposerRouting["hints"] = TIER3_WORD.test(t) ? ["tier3-release"] : [];
  const routed = (route: ComposerRouting["route"], reason: string): ComposerRouting => ({ route, reason, hints });
  if (!t) return routed("ask", "nothing to send yet");
  if (!hasSchematic) return routed("generate", "the project has no schematic yet: the message describes a circuit to generate");
  if (/^(?:generate|design)\b/.test(t)) return routed("generate", "asks to generate or design a circuit");
  if (EXECUTION_VERB.test(t)) return routed("ask", "a move, rotate, flip, undo or redo request: the assistant handles it");
  if ((EDIT_VERB.test(t) || GENERATE_VERB.test(t)) && PCB_NOUN.test(t)) return routed("ask", "names a PCB object the schematic editor cannot change: the assistant handles it");
  if (HEAD_REPLACE_PART.test(t)) return routed("ask", SWAP_REASON);
  if (MAKE_PART.test(t)) return routed("edit", "changes a named schematic part");
  if (GENERATE_VERB.test(t)) return routed("generate", "asks to create a circuit");
  if (EDIT_VERB.test(t)) return routed("edit", "an edit to the current schematic");
  return routed("ask", "a question or request for the assistant");
}
/** the corpus phrasings whose composer answer CHANGES (HEAD's route and reason, then the new ones): a schematic edit that now reaches
 *  the assistant, or a request rule 9 already sent to the assistant that rule 5b now names as a part swap (the same route) */
const moved = (texts: readonly string[]): Array<{ text: string; from: string; to: string; fromReason: string; toReason: string }> => texts.flatMap((text) => {
  const before = headComposer(text, true);
  const after = routeComposerMessage(text, true);
  return before.route === after.route && before.reason === after.reason ? [] : [{ text, from: before.route, to: after.route, fromReason: before.reason, toReason: after.reason }];
});
const RULE_9 = "a question or request for the assistant";

describe("[B21 E4] the composer reaches the DAG with the runbook's own sentence (D21-38)", () => {
  it("1. the runbook's scenario-17 sentence and its two natural variants reach the ASSISTANT as a part swap (rule 5b) - at HEAD rule 8 sent them to the schematic editor, which cannot make a replacement - and the router routes the same sentences to the replacement DAG through the same predicate; without a schematic the design prompt still generates", () => {
    for (const text of [SCENARIO_17, ...SCENARIO_17_VARIANTS]) {
      expect(headComposer(text, true).route, `HEAD: ${text}`).toBe("edit");
      expect(routeComposerMessage(text, true), text).toEqual({ route: "ask", reason: SWAP_REASON, hints: [] });
      expect(predicate(text), text).toBe(true);
      expect(routeTaskComplexity(text, FACTS).rule, text).toBe("D-component-replacement");
      expect(routeComposerMessage(text, false).route, text).toBe("generate");
    }
    expect(SCENARIO_17).toBe("Replace the NE555 timer U1 with a lower-power timer.");
  });

  it("2. the SAME six-round corpus through the composer: every genuine request (194) and every recorded semantic residue (46) routes to the assistant; the 133 genuine requests and 36 residues HEAD sent to the schematic editor move from `edit` to `ask`, and 46 genuine polite or question-form requests rule 9 already sent to the assistant are now named a part swap (same route) - each because the new predicate holds; nothing else changes", () => {
    expect(engineeringDigest(CORPUS.map((text) => ({ text, ...headComposer(text, true) }))), "the HEAD copy is HEAD's composer").toBe(HEAD_COMPOSER_DIGEST);
    expect(REPLACEMENT_REQUESTS).toHaveLength(194);
    expect(RECORDED_SEMANTIC).toHaveLength(46);
    for (const text of [...REPLACEMENT_REQUESTS, ...RECORDED_SEMANTIC]) expect(routeComposerMessage(text, true), JSON.stringify(text)).toEqual({ route: "ask", reason: expect.any(String), hints: expect.any(Array) });
    const genuine = moved(REPLACEMENT_REQUESTS);
    const residue = moved(RECORDED_SEMANTIC);
    expect(genuine.filter((entry) => entry.from !== entry.to)).toHaveLength(133);
    expect(residue.filter((entry) => entry.from !== entry.to)).toHaveLength(36);
    expect(genuine.filter((entry) => entry.from === entry.to)).toHaveLength(46);
    expect(residue.filter((entry) => entry.from === entry.to)).toHaveLength(0);
    for (const entry of [...genuine, ...residue]) {
      if (entry.from === entry.to) expect(entry, entry.text).toMatchObject({ from: "ask", to: "ask", fromReason: RULE_9, toReason: SWAP_REASON });
      else expect(entry, entry.text).toMatchObject({ from: "edit", to: "ask", toReason: SWAP_REASON });
      expect(predicate(entry.text), entry.text).toBe(true);
      expect(REPLACE_PART.test(entry.text.trim().toLowerCase()), entry.text).toBe(false);
    }
    // the residue that moves is the recorded semantic one (a listed word in another sense): the router routes it to the DAG too
    for (const entry of residue) expect(routeTaskComplexity(entry.text, FACTS).rule, entry.text).toBe("D-component-replacement");
    expect(residue.map((entry) => entry.text)).toEqual(expect.arrayContaining(["Replace the NE555 timer with a bipolar timer.", "Replace the LM317 regulator with a 3.3 V regulator for the 3V3 rail.", "Replace the op-amp with a faster op-amp for the blinker.", "Replace PS2 with a microcontroller."]));
  });

  it("3. no FALSE DAG phrasing changes its composer route: the predicate is false for all 1007 of them (under the router's own normalization), and each one's route and reason equal HEAD's - 652 schematic edits and 355 assistant requests, exactly as before; the value changes and B18's scenario sentences route as they did", () => {
    expect(FALSE_DAG).toHaveLength(1007);
    expect(FALSE_DAG.filter(predicate)).toEqual([]);
    expect(moved(FALSE_DAG)).toEqual([]);
    const routes = FALSE_DAG.map((text) => routeComposerMessage(text, true).route);
    expect({ edit: routes.filter((route) => route === "edit").length, ask: routes.filter((route) => route === "ask").length, generate: routes.filter((route) => route === "generate").length }).toEqual({ edit: 652, ask: 355, generate: 0 });
    for (const text of ["replace R1 with 4.7k", "replace C1 with 100nF", "Replace the 10k resistor with a 4.7k resistor.", "Swap the 100nF capacitor for a 1uF capacitor.", "Replace C3 with 10uF for the LDO.", "Replace R1 with 10k for the timer.", "Replace the gate resistor for the MOSFET driver.", "Swap R4 and R5 for the op-amp gain.", "Replace C5 with 10uF near the regulator.", "Replace U1 with a TLC555."]) {
      expect(routeComposerMessage(text, true), text).toEqual(headComposer(text, true));
      expect(routeComposerMessage(text, true).route, text).toBe("edit");
    }
    for (const text of ["Delete U1 and replace it with the approved lower-power part while preserving compatible nets.", "Swap U1 for a lower-power alternative.", "Move R3 2 mm to the right.", "Add silkscreen text REV B at 10, 10.", "What does R1 connect to?", "Would you replace U1 with a timer?"]) expect(routeComposerMessage(text, true), text).toEqual(headComposer(text, true));
  });

  it("4. ONE predicate, imported by the router and never the reverse: composer-routing.ts imports nothing; router.ts imports `partKindSwap` and `POLITE` from it and defines neither; over the whole corpus the router's replacement decision IS the predicate and the composer asks wherever it holds - with any whitespace, case or trailing punctuation the router's normalization folds (the composer restates that one line verbatim)", () => {
    const composerSource = read("app/lib/project/composer-routing.ts");
    const routerSource = read("app/lib/agent/orchestration/router.ts");
    expect(composerSource).not.toMatch(/^import /m);
    expect(routerSource).toMatch(/^import \{ POLITE, partKindSwap \} from "\.\.\/\.\.\/project\/composer-routing";/m);
    for (const defined of [/\bconst POLITE =/, /\bconst PART_KIND_SWAP =/, /\bfunction partKindSwap\(/, /\bconst ACTIVE_KIND =/, /\bconst REPLACEMENT_FORMS\b/, /\bconst VACUOUS_FORMS\b/, /\bconst KIND_FAMILIES\b/, /\bconst OPINION =/, /\bconst QUESTION_REQUEST =/]) {
      expect(routerSource, String(defined)).not.toMatch(defined);
      expect(composerSource, String(defined)).toMatch(defined);
    }
    // the composer's normalization is the router's line, verbatim
    const routerLine = /export function normalizeRouterMessage\(text: string\): string \{\n\s*return (.+);\n\}/.exec(routerSource.replaceAll(String.fromCharCode(13), ""))![1]!;
    expect(composerSource).toContain(`return ${routerLine};`);
    for (const text of CORPUS) {
      expect(routeTaskComplexity(text, FACTS).rule === "D-component-replacement", JSON.stringify(text)).toBe(predicate(text));
      if (predicate(text)) expect(routeComposerMessage(text, true), JSON.stringify(text)).toEqual({ route: "ask", reason: SWAP_REASON, hints: [] });
    }
    for (const text of [`  ${SCENARIO_17.toUpperCase()}  `, SCENARIO_17.replace(/ /g, "   "), `${SCENARIO_17.slice(0, -1)}!`, `${SCENARIO_17}..`, `Please ${SCENARIO_17.toLowerCase()}`, "Can you replace U1 with a CMOS timer?", `${SCENARIO_17.slice(0, -1)}?`, `${SCENARIO_17.slice(0, -1)}?!`]) {
      expect(routeComposerMessage(text, true).reason === SWAP_REASON, JSON.stringify(text)).toBe(predicate(text));
      expect(routeTaskComplexity(text, FACTS).rule === "D-component-replacement", JSON.stringify(text)).toBe(predicate(text));
    }
  });

  it("5. no new control and no new export beyond the predicate and its prefix: the module's runtime exports are the three B18 labels, `REPLACE_PART`, `partKindSwap`, `POLITE` and `routeComposerMessage`; the route labels are B18's three; the page imports this module by its one unchanged line", () => {
    expect(Object.keys(composer).sort()).toEqual(["COMPOSER_ROUTE_LABELS", "POLITE", "REPLACE_PART", "partKindSwap", "routeComposerMessage"]);
    expect(COMPOSER_ROUTE_LABELS).toEqual({ ask: "ask the assistant", edit: "edit the schematic", generate: "generate a schematic" });
    expect(read("app/page.tsx").split(String.fromCharCode(10)).filter((line) => line.includes("composer-routing"))).toEqual(['import { COMPOSER_ROUTE_LABELS, routeComposerMessage, type ComposerRoute } from "@/app/lib/project/composer-routing"; // [B18-D I1]']);
  });

  it("6. [B21 E4 fix: security-3] the scans E4 added are linear on ANY composer text ([B21 E4 lead] B18-E's REPLACE_PART at rule 5b stays super-linear on a self-pasted run, RECORDED on the page) - the page routes the composer's text on every render and the text is unbounded: a 150 000-character text of each hostile shape (a run of sentence punctuation then a letter, a whitespace run inside the runbook sentence) routes through rule 5b, and through the router, in well under a second; the two normalization lines and the predicate's raw trailing run find the trailing run from its START alone (a lookbehind - the old scans restarted inside the run: quadratic), each with exactly the old answer on the corpus and on hostile texts", () => {
    const n = 150_000;
    const shapes: Array<[string, string, ComposerRouting["route"], boolean]> = [
      ["a run of ! then a letter", `${"!".repeat(n)}a`, "ask", false],
      ["a run of ? then a letter", `${"?".repeat(n)}x`, "ask", false],
      ["the runbook sentence, a run of . then a letter", `${SCENARIO_17}${".".repeat(n)}x`, "edit", false],
      ["a whitespace run inside the runbook sentence", `Replace${" ".repeat(n)}the NE555 timer U1 with a lower-power timer.`, "ask", true],
    ];
    const slow: string[] = [];
    for (const [name, text, route, swap] of shapes) {
      const started = performance.now();
      const routed = routeComposerMessage(text, true);
      const planned = routeTaskComplexity(text, FACTS);
      const ms = performance.now() - started;
      if (ms > 1_000) slow.push(`${name}: ${Math.round(ms)} ms`);
      // the answers are the predicate's: the whitespace run folds to the runbook sentence (a part swap); the others are no swap
      expect(routed.route, name).toBe(route);
      expect(routed.reason === SWAP_REASON, name).toBe(swap);
      expect(planned.rule === "D-component-replacement", name).toBe(swap);
    }
    expect(slow).toEqual([]);
    const LINEAR_NORMALIZE = 'return text.replace(/\\s+/g, " ").trim().toLowerCase().replace(/(?<![.!?])[.!?]+$/, "").trim();';
    expect(read("app/lib/project/composer-routing.ts")).toContain(LINEAR_NORMALIZE);
    expect(read("app/lib/agent/orchestration/router.ts")).toContain(LINEAR_NORMALIZE);
    expect(read("app/lib/project/composer-routing.ts")).toContain('const trailing = /(?<![.!?\\s])[.!?\\s]*$/.exec(raw.trim())?.[0] ?? "";');
    // the same answers: HEAD's two scans, copied, against the linear ones - the lookbehind only refuses to START inside a run
    const headNormalize = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!?]+$/, "").trim();
    const headTrailing = (raw: string): string => /[.!?\s]*$/.exec(raw.trim())?.[0] ?? "";
    const linearTrailing = (raw: string): string => /(?<![.!?\s])[.!?\s]*$/.exec(raw.trim())?.[0] ?? "";
    const nbsp = String.fromCharCode(0xa0);
    const hostile = ["", " ", "!", "?!", "a!", "a! !", "a.b.", "x...y...", "timer.\t\n?", ` ${SCENARIO_17}..`, `${SCENARIO_17.slice(0, -1)} ?! `, `${SCENARIO_17.slice(0, -1)}?${nbsp}!`, `a${nbsp}!`, "Can you replace U1 with a CMOS timer? ", "!!!a!!!", ". . .", "a . b ."];
    for (const text of [...CORPUS, ...hostile]) {
      expect(normalizeRouterMessage(text), JSON.stringify(text)).toBe(headNormalize(text));
      expect(linearTrailing(text), JSON.stringify(text)).toBe(headTrailing(text));
    }
  }, 120_000);
});
