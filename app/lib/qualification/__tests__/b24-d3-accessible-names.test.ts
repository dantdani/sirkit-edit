/**
 * [B24-D3] D24-32, OD-215 - the accessible-name rule over B17-A's control sites (app/lib/engineering/accessible-names.ts) and its
 * census (artifacts/ai-control-plane-b24/accessible-name-census.csv and its summary), the in-scope names and announcements, the
 * canvases declared non-accessible, the shared dialogs, the page's line count, the dependency names, the import gate and the page
 * artifacts/ai-control-plane-b24/accessibility.md.
 *
 *  1. every scanned site has exactly one status from the closed sets; the recomputed B17 key multiset equals scanControlSites'
 *     exactly and the join is on the key (AssignmentQueuePanel.tsx's two same-line button pairs resolve); the census CSV and its
 *     summary byte-match the render, and the census counts B17-A's committed inventory site for site;
 *  2. in scope (ACCESSIBILITY_SCOPE): zero `unnamed` sites and the structural rules hold (no positive tabIndex, no tabIndex={-1} on
 *     a native control, no click or key handler on a non-interactive element without a role, tabIndex={0} and a key handler);
 *  3. out of scope: the unnamed count is at most its post-D3 pin (102; 111 at 3773c6a), and every unnamed key is in the frozen
 *     list this suite holds (UNNAMED_KEYS_AFTER_D3) - never the regenerated census;
 *  4. the exemptions are closed: a backdrop's and a canvas gesture's reason names a keyboard path that exists in the same file (a
 *     backdrop's closer by its accessible name); the name-forwarding list is read by AST;
 *  5. every in-scope shared Dialog has a DialogTitle; BomView.tsx holds no role="dialog" literal, imports the shared dialog and
 *     holds no button named by a glyph alone inside a DialogContent; the hand-rolled dialogs outside BomView are exactly four;
 *  6. the literals: the transcript is a polite log with aria-busy and its label, the prompt carries its label, the two errors are
 *     alerts, both canvas hosts are images named by their statements, the minimum-width notice is CSS only; each literal once;
 *  7. app/page.tsx has exactly its pinned line count (8459 at 3773c6a; 8556 after product reliability C; 8618 after E; B21's page suites resolve its line citations);
 *  8. package.json's dependency names are 3773c6a's (no axe, jest-axe, lighthouse or user-event, OD-215); no statement, notice or
 *     in-scope name matches B19-E's purchase wording;
 *  9. the rule module is imported only by this suite and its generator (importClosure);
 * 10. the page: its sections in order, its scope list equals ACCESSIBILITY_SCOPE, every WCAG row names an existing case or says
 *     NOT MEASURED or NOT MET (and reads PROPOSED when only an unrun browser spec measures it), a focus-return claim cites case 11,
 *     and every citation resolves on its line;
 * 11. the focus return after a run, a model run of app/page.tsx's own code: back to the prompt only when the run was sent from it,
 *     focus fell to body and no pointer was pressed since.
 * Case 2 also lists an in-scope control named by a glyph alone (a name worded for a person). [B24-D3 review, 2026-10-10]: cases 2,
 * 3, 4, 5 and 10 strengthened and case 11 added for the review's findings (accessibility.md section 5).
 *
 * Failing first on 3773c6a: the suite failed to load (the rule module and the statements absent); with the rule in place and
 * before any fix, case 2 printed the in-scope counterexample list recorded verbatim on accessibility.md section 5. Files are read
 * as text; nothing is written. The census walks every scanned surface twice (B17-A's scan and the rule's), so the cases that read
 * it carry explicit budgets (lead lesson 14).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { scanControlSites, type ControlSite } from "@/app/lib/engineering/control-surface";
import {
  BACKDROP_EXEMPTIONS,
  CANVAS_HOSTS,
  EXEMPT_REASONS,
  NAME_FORWARDING,
  NAME_SOURCES,
  computeAccessibleNameCensus,
  exemptionProblems,
  handRolledDialogs,
  nameForwardingProblems,
  renderAccessibleNameCensusCsv,
  renderScopeList,
  sharedDialogs,
  summarizeAccessibleNameCensus,
  type AccessibleNameCensus,
} from "@/app/lib/engineering/accessible-names";
import { CHAT_PROMPT_LABEL, CHAT_TRANSCRIPT_LABEL, EDITOR_MIN_WIDTH_PX, MIN_WIDTH_NOTICE, PCB_CANVAS_STATEMENT, SCHEMATIC_CANVAS_STATEMENT } from "@/app/lib/accessibility/statements";
import { collectProductionFiles } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { importClosure } from "@/app/lib/mcp/server/__tests__/_import-closure";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const CENSUS_CSV = "artifacts/ai-control-plane-b24/accessible-name-census.csv";
const CENSUS_SUMMARY = "artifacts/ai-control-plane-b24/accessible-name-census-summary.json";
const B17_SUMMARY = "artifacts/ai-control-plane-b17/ui-control-inventory-summary.json";
const PAGE = "artifacts/ai-control-plane-b24/accessibility.md";
const RULE_MODULE = "app/lib/engineering/accessible-names";
const GENERATOR = "scripts/generate-b24-accessible-names.ts";
const SELF = "app/lib/qualification/__tests__/b24-d3-accessible-names.test.ts";

/** [B24-D3, 2026-10-10] The out-of-scope `unnamed` count measured by the rule at 3773c6a, before any D3 fix (accessibility.md
 *  section 5). It may only fall; a new unnamed site anywhere fails, even after regeneration (the generator refuses one too). */
const OUT_OF_SCOPE_UNNAMED_AT_3773C6A = 111;
/** [B24-D3, 2026-10-10] app/page.tsx's line count at 3773c6a (8459 at f663d71; unchanged since). [Product reliability C, 2026-10-14] 8556:
 *  the composer submission for every route, the journey strip and its facts, the proposal notes and the proposal persistence; the citation
 *  tables that name page lines (accessibility.md, B21's composer-and-first-turn.md) were refreshed in the same change, which is what this
 *  pin exists to force. [Product reliability E, 2026-10-16] 8618: the empty sheet's circuit-entry action, the workspace settings dialog
 *  (sheet size, AI brain, autonomy, runtime), the chat header's one-line summary, the computed design checks and the 3D tab's
 *  presentation; the citation tables were refreshed again in the same change. [Product reliability D, 2026-10-16] 8690: the intake of the
 *  agent's Build-mode generation proposal (`generation_proposal_ready` -> the SAFE receiver -> `offerGenerationProposal`, the same review
 *  dialog, pin and pending-proposal store as the composer's Generate; no new control); the citation tables were refreshed in the same change. */
const PAGE_LINES_AT_3773C6A = 8690;
/** [B24-D3, 2026-10-10] package.json's dependency names at 3773c6a (OD-215: no new dependency; an axe devDependency needs the owner). */
const DEPENDENCIES_AT_3773C6A = ["@anthropic-ai/sdk", "@base-ui/react", "@react-three/drei", "@react-three/fiber", "@supabase/ssr", "@supabase/supabase-js", "@xyflow/react", "class-variance-authority", "clsx", "drizzle-orm", "flatbush", "highlight.js", "immer", "jszip", "katex", "lucide-react", "next", "openai", "pixi-viewport", "pixi.js", "polygon-clipping", "postgres", "radix-ui", "react", "react-dom", "react-markdown", "rehype-highlight", "rehype-katex", "remark-gfm", "remark-math", "tailwind-merge", "three", "tw-animate-css"];
const DEV_DEPENDENCIES_AT_3773C6A = ["@electric-sql/pglite", "@playwright/test", "@tailwindcss/postcss", "@testing-library/dom", "@testing-library/react", "@types/node", "@types/react", "@types/react-dom", "@types/three", "drizzle-kit", "eslint", "eslint-config-next", "fake-indexeddb", "jsdom", "tailwindcss", "tsx", "typescript", "vitest"];
const FORBIDDEN_DEPENDENCIES = ["axe-core", "@axe-core/playwright", "jest-axe", "lighthouse", "@testing-library/user-event"];
/** The hand-rolled dialogs outside OD-215's list, each recorded open on the page (section 4), never moved by D3. */
const NON_BOM_HAND_ROLLED = ["app/components/pcb/FabDialog.tsx", "app/components/pcb/RoutingRulesPanel.tsx", "app/components/pcb/ShortcutsHelp.tsx", "app/components/pcb/SyncPlacementDialog.tsx"];
/** The suites and specs a WCAG row may name, by the name the page uses. */
const CASE_FILES: Readonly<Record<string, string>> = {
  "b24-d3-accessible-names": SELF,
  "b24-d3-bom-dialogs": "app/lib/qualification/__tests__/b24-d3-bom-dialogs.test.tsx",
  "keyboard-and-focus": "e2e/keyboard-and-focus.spec.ts",
  "minimum-width": "e2e/minimum-width.spec.ts",
};

let census: AccessibleNameCensus;
let sites: ControlSite[];

beforeAll(async () => {
  sites = scanControlSites(ROOT);
  await new Promise<void>((resolve) => setImmediate(resolve));
  census = await computeAccessibleNameCensus(ROOT);
}, 120_000); // the census walks every scanned surface twice (lead lesson 14); the cases that read it carry the same budget

/** A JSX element's attribute: its literal text, `{expression}` text, or null when absent. */
function attribute(node: ts.JsxOpeningLikeElement, name: string): string | null {
  for (const property of node.attributes.properties) {
    if (!ts.isJsxAttribute(property) || property.name.getText() !== name) continue;
    const initializer = property.initializer;
    if (!initializer) return "";
    if (ts.isStringLiteral(initializer)) return initializer.text;
    if (ts.isJsxExpression(initializer) && initializer.expression) return ts.isStringLiteral(initializer.expression) ? initializer.expression.text : `{${initializer.expression.getText()}}`;
    return "";
  }
  return null;
}
/** Every opening element of a source file whose tag and attributes match. */
function elements(path: string, tag: string, where: (node: ts.JsxOpeningLikeElement) => boolean): ts.JsxOpeningLikeElement[] {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.ES2022, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: ts.JsxOpeningLikeElement[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === tag && where(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
/** The text of a JSX element's subtree (its JsxText and expression children, as written). */
const subtreeText = (node: ts.JsxOpeningLikeElement): string => (ts.isJsxOpeningElement(node) ? node.parent.getText() : node.getText());
/** Does the element hold `{expression}` as a direct child? */
const holds = (node: ts.JsxOpeningLikeElement, expression: string): boolean => ts.isJsxOpeningElement(node) && node.parent.children.some((child) => ts.isJsxExpression(child) && child.expression?.getText() === expression);
/** The rows of a CSV file (RFC 4180 quoting, as the census renders it), header first. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === NEWLINE) { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}
const caseTitles = (path: string): string[] => [...read(path).matchAll(/\b(?:it|test)\(\s*["'`](\d+)\. /g)].map((match) => match[1]!);
const section = (text: string, n: number): string => {
  const start = text.search(new RegExp(`^## ${n}\\. `, "m"));
  expect(start, `section ${n}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const next = rest.search(/^## \d+\. /m);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
};

describe("[B24-D3] the accessible-name rule and its census (D24-32, OD-215)", () => {
  it("1. every scanned site has exactly one closed status; the recomputed B17 keys equal scanControlSites' exactly and the join is on the key; the census byte-matches the render", { timeout: 120_000 }, () => {
    const statuses = new Set<string>(["unnamed", ...NAME_SOURCES.map((source) => `named:${source}`), ...EXEMPT_REASONS.map((reason) => `exempt:${reason}`)]);
    expect(census.rows.filter((row) => !statuses.has(row.status)).map((row) => `${row.key}: ${row.status}`)).toEqual([]);
    expect([...census.recomputedKeys].sort()).toEqual(sites.map((site) => site.key).sort());
    expect(census.rows.map((row) => row.key)).toEqual(sites.map((site) => site.key).sort((a, b) => a.localeCompare(b)));
    expect(new Set(census.rows.map((row) => row.key)).size).toBe(census.rows.length);
    expect(census.scopeProblems).toEqual([]);
    // The join is on the key, never on (surface, line, kind, element): B17-A records the attribute's line only, and these lines
    // each hold two buttons of the same kind and element.
    const assignmentButtons = sites.filter((site) => site.surface === "app/components/pcb/AssignmentQueuePanel.tsx" && site.kind === "click" && site.element === "button");
    const byLine = new Map<number, ControlSite[]>();
    for (const site of assignmentButtons) byLine.set(site.line, [...byLine.get(site.line) ?? [], site]);
    const sameLinePairs = [...byLine].filter(([, pair]) => pair.length > 1);
    expect(sameLinePairs, "the AST scan still finds both same-line button pairs").toHaveLength(2);
    for (const [line, pair] of sameLinePairs) {
      expect(pair, `AssignmentQueuePanel.tsx:${line}`).toHaveLength(2);
      expect(new Set(pair.map((site) => site.key)).size).toBe(2);
      for (const site of pair) expect(census.rows.filter((row) => row.key === site.key), site.key).toHaveLength(1);
    }
    // The committed census is the render, and it counts B17-A's committed inventory site for site.
    expect(existsSync(join(ROOT, CENSUS_CSV)), `run: ${GENERATOR}`).toBe(true);
    expect(read(CENSUS_CSV)).toBe(renderAccessibleNameCensusCsv(census.rows));
    expect(JSON.parse(read(CENSUS_SUMMARY))).toEqual(summarizeAccessibleNameCensus(census));
    const b17 = JSON.parse(read(B17_SUMMARY)) as { sites: number; surfaces: number };
    const summary = summarizeAccessibleNameCensus(census);
    expect([summary.sites, summary.surfaces]).toEqual([b17.sites, b17.surfaces]);
  });

  it("2. in scope: zero unnamed sites, and the structural rules hold", { timeout: 120_000 }, () => {
    const unnamed = census.rows.filter((row) => row.inScope && row.status === "unnamed").map((row) => `${row.key} (line ${row.line}${row.detail ? `; ${row.detail}` : ""})`);
    const structural = census.structural.map((problem) => `${problem.rule}: ${problem.surface}:${problem.line} ${problem.detail}`);
    // [B24-D3 review, 2026-10-10] security-2: a name worded for a person - an in-scope control named by a glyph alone (no letter or
    // digit; `*`, a value known only at run time, is not judged) is listed too, as the More checks button's "⋯" was.
    const glyphNamed = census.rows.filter((row) => row.inScope && row.status.startsWith("named:") && !row.detail.includes("*") && !/[\p{L}\p{N}]/u.test(row.detail)).map((row) => `${row.key}: ${row.status} "${row.detail}" (line ${row.line}; a glyph is not a name worded for a person)`);
    expect([...unnamed, ...structural, ...glyphNamed]).toEqual([]);
    expect(census.rows.filter((row) => row.inScope).length).toBeGreaterThan(100); // the scope is OD-215's surfaces, never a sample
  });

  it("3. out of scope: the unnamed count is at most its post-D3 pin (below its 3773c6a number), and every unnamed key is in the frozen list (never the regenerated census)", { timeout: 120_000 }, () => {
    const outOfScope = census.rows.filter((row) => !row.inScope && row.status === "unnamed");
    // [B24-D3 review, 2026-10-10] correctness-1, security-1: the bound is the post-D3 count, pinned beside the 3773c6a record, and
    // the keys are checked against a list this suite holds - the generator never rewrites it - so a new unnamed site fails here
    // even after the census is regenerated (case 1 makes the committed census equal the render, so it cannot be the baseline).
    expect(OUT_OF_SCOPE_UNNAMED_AFTER_D3).toBeLessThanOrEqual(OUT_OF_SCOPE_UNNAMED_AT_3773C6A);
    expect(UNNAMED_KEYS_AFTER_D3).toHaveLength(OUT_OF_SCOPE_UNNAMED_AFTER_D3);
    expect(new Set(UNNAMED_KEYS_AFTER_D3).size).toBe(UNNAMED_KEYS_AFTER_D3.length);
    const frozen = new Set<string>(UNNAMED_KEYS_AFTER_D3);
    expect(census.rows.filter((row) => row.status === "unnamed" && !frozen.has(row.key)).map((row) => `${row.key} (${row.surface}:${row.line}; ${row.detail})`), "a new unnamed site: name it (a visible <label>, htmlFor or an aria-label worded for a person); the frozen list moves only by review").toEqual([]);
    expect(outOfScope.length).toBeLessThanOrEqual(OUT_OF_SCOPE_UNNAMED_AFTER_D3);
    const [header, ...body] = csvRows(read(CENSUS_CSV));
    expect(header).toEqual(["key", "surface", "kind", "element", "in_scope", "status", "detail"]);
    const committed = new Set(body.filter((cells) => cells[5] === "unnamed").map((cells) => cells[0]!));
    expect(outOfScope.map((row) => row.key).filter((key) => !committed.has(key))).toEqual([]);
  });

  it("4. the exemptions are closed: backdrop and canvas-gesture reasons name a keyboard path that exists in the same file; forwarding is read by AST", { timeout: 120_000 }, () => {
    expect(exemptionProblems(ROOT, census)).toEqual([]);
    expect(nameForwardingProblems(ROOT)).toEqual([]);
    const backdrops = census.rows.filter((row) => row.status === "exempt:backdrop");
    expect(backdrops.map((row) => row.key).sort()).toEqual(BACKDROP_EXEMPTIONS.map((entry) => entry.key).sort());
    for (const row of backdrops) {
      const entry = BACKDROP_EXEMPTIONS.find((candidate) => candidate.key === row.key)!;
      expect(row.detail).toBe(`closed by ${entry.closedBy}`);
      expect(read(row.surface), `${row.key}: its closing control is in the same file`).toContain(entry.closedBy);
      // [B24-D3 review, 2026-10-10] security-2: the reason names the closer by its ACCESSIBLE name (the census's computed name), never
      // by a title its content overrides: a button in the same file, named exactly `closedBy`.
      const closers = census.rows.filter((candidate) => candidate.surface === row.surface && candidate.kind === "click" && ["button", "Button"].includes(candidate.element) && candidate.status.startsWith("named:") && candidate.detail === entry.closedBy);
      expect(closers.map((closer) => closer.key), `${row.key}: a button whose accessible name is "${entry.closedBy}"`).not.toEqual([]);
    }
    const gestures = census.rows.filter((row) => row.status === "exempt:canvas-gesture");
    expect(gestures.length).toBeGreaterThan(0);
    for (const row of gestures) {
      const host = CANVAS_HOSTS.find((candidate) => candidate.surface === row.surface);
      expect(host, `${row.key}: inside a declared canvas host`).toBeDefined();
      expect(host!.goTo.surface, `${row.key}: its keyboard path is in the same file`).toBe(row.surface);
      expect(row.detail).toBe(`go to: ${host!.goTo.name} (${host!.goTo.testId})`);
    }
    for (const host of CANVAS_HOSTS) {
      const goTo = elements(host.goTo.surface, "input", (node) => attribute(node, "data-testid") === host.goTo.testId);
      expect(goTo, `${host.goTo.surface} ${host.goTo.testId}`).toHaveLength(1);
      expect(attribute(goTo[0]!, "aria-label")).toBe(host.goTo.name);
    }
    expect(census.rows.filter((row) => row.status === "named:forwarded" && !NAME_FORWARDING.some((entry) => entry.component === row.element && entry.surface === row.surface)).map((row) => row.key)).toEqual([]);
  });

  it("5. every in-scope shared Dialog has a DialogTitle; BomView holds no role=\"dialog\" literal and imports the shared dialog; the hand-rolled dialogs outside BomView are exactly four", { timeout: 120_000 }, () => {
    const shared = sharedDialogs(ROOT);
    expect(shared.filter((dialog) => dialog.inScope).length).toBeGreaterThanOrEqual(8);
    expect(shared.filter((dialog) => dialog.inScope && !dialog.titled).map((dialog) => `${dialog.surface}:${dialog.line}`)).toEqual([]);
    const handRolled = handRolledDialogs(ROOT);
    expect(handRolled.filter((dialog) => dialog.surface === "app/components/bom/BomView.tsx").map((dialog) => `${dialog.surface}:${dialog.line}`)).toEqual([]);
    expect(read("app/components/bom/BomView.tsx")).toMatch(/^import \{[^}]*\bDialog\b[^}]*\bDialogContent\b[^}]*\bDialogTitle\b[^}]*\} from "@\/components\/ui\/dialog";/m);
    const bom = shared.filter((dialog) => dialog.surface === "app/components/bom/BomView.tsx");
    expect(bom.map((dialog) => dialog.titled)).toEqual([true, true, true, true]);
    // [B24-D3 review, 2026-10-10] correctness-3: the drawers' "✕" stays gone - no button inside a BomView DialogContent is named by a
    // glyph alone (its name would be the glyph, never "Close"; DialogContent's own Close is the one closer).
    expect(glyphButtonsInDialogs("app/components/bom/BomView.tsx")).toEqual([]);
    expect(handRolled.map((dialog) => dialog.surface).sort()).toEqual(NON_BOM_HAND_ROLLED);
  });

  it("6. the literals: a polite log with aria-busy and its label, the prompt's label, two alerts, two canvas images named by their statements, the CSS-only notice; each literal once", { timeout: 30_000 }, () => {
    const page = read("app/page.tsx");
    const log = elements("app/page.tsx", "div", (node) => attribute(node, "role") === "log");
    expect(log).toHaveLength(1);
    expect([attribute(log[0]!, "aria-live"), attribute(log[0]!, "aria-relevant"), attribute(log[0]!, "aria-busy"), attribute(log[0]!, "aria-label")]).toEqual(["polite", "additions text", "{loading}", CHAT_TRANSCRIPT_LABEL]);
    expect(subtreeText(log[0]!)).toContain("<MessageBubble ");
    const prompt = elements("app/page.tsx", "Textarea", (node) => attribute(node, "data-testid") === "prompt-input");
    expect(prompt.map((node) => attribute(node, "aria-label"))).toEqual([CHAT_PROMPT_LABEL]);
    const genError = elements("app/page.tsx", "div", (node) => holds(node, "genError"));
    expect(genError.map((node) => attribute(node, "role"))).toEqual(["alert"]);
    const refusal = elements("app/components/pcb/ProviderExchangePanel.tsx", "div", (node) => attribute(node, "data-testid") === "p2g-provider-result");
    expect(refusal.map((node) => attribute(node, "role"))).toEqual(["alert"]);
    const schematic = elements("app/page.tsx", "svg", (node) => attribute(node, "data-testid") === "schematic-canvas");
    expect(schematic.map((node) => [attribute(node, "role"), attribute(node, "aria-label")])).toEqual([["img", SCHEMATIC_CANVAS_STATEMENT]]);
    const pcb = elements("app/components/pcb/PcbCanvas.tsx", "div", (node) => attribute(node, "ref") === "{hostRef}");
    expect(pcb.map((node) => [attribute(node, "role"), attribute(node, "aria-label")])).toEqual([["img", "{PCB_CANVAS_STATEMENT}"]]);
    expect(read("app/components/pcb/PcbCanvas.tsx")).toMatch(/^import \{ PCB_CANVAS_STATEMENT \} from "@\/app\/lib\/accessibility\/statements";/m);
    for (const statement of [SCHEMATIC_CANVAS_STATEMENT, PCB_CANVAS_STATEMENT]) {
      expect(statement).toMatch(/pointer-only/);
      expect(statement).toContain("Go to component");
    }
    for (const literal of [CHAT_TRANSCRIPT_LABEL, CHAT_PROMPT_LABEL, SCHEMATIC_CANVAS_STATEMENT]) expect(page.split(literal).length, literal).toBe(2);
    // [B24-D3b] the notice: rendered by the root layout beside the identity banner, shown by CSS below the minimum and hidden at or
    // above it - no script, no listener, no control (so no B17-A site).
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/^import \{ MIN_WIDTH_NOTICE \} from "\.\/lib\/accessibility\/statements";/m);
    const notice = elements("app/layout.tsx", "div", (node) => attribute(node, "data-testid") === "min-width-notice");
    expect(notice).toHaveLength(1);
    expect(attribute(notice[0]!, "className")!.split(" ")).toEqual(expect.arrayContaining(["hidden", `max-[${EDITOR_MIN_WIDTH_PX}px]:block`]));
    expect(subtreeText(notice[0]!)).toContain("{MIN_WIDTH_NOTICE}");
    expect(MIN_WIDTH_NOTICE).toContain(EDITOR_MIN_WIDTH_PX.toLocaleString("en-US"));
    expect(scanControlSites(ROOT, ["app/layout.tsx"])).toEqual([]);
  });

  it("7. app/page.tsx has exactly its 3773c6a line count", () => {
    const page = read("app/page.tsx");
    expect(page.endsWith(NEWLINE)).toBe(true);
    expect(page.split(NEWLINE).length - 1).toBe(PAGE_LINES_AT_3773C6A);
  });

  it("8. package.json's dependency names are 3773c6a's; no statement, notice or in-scope name matches B19-E's purchase wording", { timeout: 120_000 }, () => {
    const manifest = JSON.parse(read("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(DEPENDENCIES_AT_3773C6A);
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toEqual(DEV_DEPENDENCIES_AT_3773C6A);
    for (const name of FORBIDDEN_DEPENDENCIES) expect([...DEPENDENCIES_AT_3773C6A, ...DEV_DEPENDENCIES_AT_3773C6A], name).not.toContain(name);
    // B19-E's own pattern, read from its suite so the two never drift apart.
    const tripwire = read("app/lib/engineering/__tests__/b19-e-no-purchase-tripwire.test.ts");
    const declared = tripwire.match(/^const PURCHASE_WORDING = \/(.+)\/i;$/m);
    expect(declared, "B19-E's PURCHASE_WORDING").not.toBeNull();
    const wording = new RegExp(declared![1]!, "i");
    const copy = [CHAT_TRANSCRIPT_LABEL, CHAT_PROMPT_LABEL, SCHEMATIC_CANVAS_STATEMENT, PCB_CANVAS_STATEMENT, MIN_WIDTH_NOTICE, ...census.rows.filter((row) => row.inScope && row.status.startsWith("named:")).map((row) => row.detail)];
    expect(copy.filter((text) => wording.test(text))).toEqual([]);
  });

  it("9. the rule module is imported only by this suite and its generator", { timeout: 120_000 }, async () => {
    const files = collectProductionFiles(ROOT);
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Every importer names the module in a static specifier (B14.4 pins zero opaque module loads), so the files that spell its
    // base name are a superset of its direct importers; a transitive importer reaches one of them. Each is walked with
    // importClosure, one at a time (a single walk from every production file blocks the worker for about 30 s).
    const spellers = [...files.entries()].filter(([file, text]) => file !== `${RULE_MODULE}.ts` && text.includes("accessible-names")).map(([file]) => file);
    const reaching: string[] = [];
    for (const file of spellers) {
      if (importClosure(files, [file]).has(`${RULE_MODULE}.ts`)) reaching.push(file);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(reaching, "the production files that reach the rule module").toEqual([GENERATOR]);
    const generatorSpellers = [...files.entries()].filter(([file, text]) => file !== GENERATOR && text.includes("generate-b24-accessible-names")).map(([file]) => file);
    expect(generatorSpellers.filter((file) => importClosure(files, [file]).has(GENERATOR)), "nothing imports the generator").toEqual([]);
    expect(read(SELF)).toContain(`from "@/${RULE_MODULE}"`);
  });

  it("10. the page: sections in order, the scope list equals ACCESSIBILITY_SCOPE, every WCAG row names a case or says NOT MEASURED or NOT MET, every citation resolves on its line", () => {
    expect(existsSync(join(ROOT, PAGE)), PAGE).toBe(true);
    const text = read(PAGE);
    const headings = [...text.matchAll(/^## (\d+)\. /gm)].map((match) => Number(match[1]));
    expect(headings).toEqual(Array.from({ length: 14 }, (_, index) => index));
    expect(section(text, 1).split(NEWLINE).filter((line) => /^- (chat|approval dialogs|side panels|B23): /.test(line))).toEqual(renderScopeList());
    const wcag = section(text, 8).split(NEWLINE).filter((line) => /^\| \d+\.\d+\.\d+ /.test(line));
    expect(wcag.length).toBeGreaterThanOrEqual(50);
    const titles = Object.fromEntries(Object.entries(CASE_FILES).map(([name, path]) => [name, existsSync(join(ROOT, path)) ? caseTitles(path) : []]));
    const unbacked = wcag.filter((row) => {
      if (/NOT MEASURED|NOT MET/.test(row)) return false;
      const cited = [...row.matchAll(/`(b24-d3-accessible-names|b24-d3-bom-dialogs|keyboard-and-focus|minimum-width) (\d+)`/g)];
      return cited.length === 0 || cited.some((match) => !titles[match[1]!]!.includes(match[2]!));
    });
    expect(unbacked).toEqual([]);
    // [B24-D3 review, 2026-10-10] security-3: "tested" stands only on executed evidence - a row whose cases are all browser-spec
    // cases (written; the builder runs no browser) reads PROPOSED until the lead's green run flips BROWSER_SPECS_EXECUTED (a reviewed
    // pin move); and a claim that the focus return is CONFIRMED by a case cites the case that executes it.
    const executed = BROWSER_SPECS_EXECUTED ? Object.keys(CASE_FILES) : UNIT_SUITES;
    const stateOf = (row: string): string => row.split("|")[3]?.trim() ?? "";
    expect(wcag.filter((row) => !/^(tested in part|PROPOSED|NOT MEASURED|NOT MET)$/.test(stateOf(row))), "a WCAG row's state").toEqual([]);
    expect(wcag.filter((row) => stateOf(row) === "tested in part" && ![...row.matchAll(/`(b24-d3-accessible-names|b24-d3-bom-dialogs|keyboard-and-focus|minimum-width) \d+`/g)].some((match) => executed.includes(match[1]!))), "a WCAG row tested only by a browser spec not yet run").toEqual([]);
    const ruleTitles = caseTitleTexts(SELF);
    const focusClaims = text.split(/\n(?:[ \t]*\n|(?=- ))/).map((block) => block.replace(/\s+/g, " ")).filter((block) => /focus returns to the prompt|returns focus to the prompt|the focus return/i.test(block) && /CONFIRMED/.test(block));
    const miscited = focusClaims.filter((block) => {
      const cited = citedCases(block, "b24-d3-accessible-names");
      return cited.length > 0 && !cited.some((n) => /focus return/i.test(ruleTitles.get(n) ?? ""));
    });
    expect(miscited.map((block) => block.slice(0, 160)), "a focus-return claim cites the case that executes the return").toEqual([]);
    const citations =[...section(text, 13).matchAll(/^\| (C\d+) \| `([^`]+)` \| (\d+) \| (?:—|`([^`]+)`) \| `([^`]+)` \|/gm)].map((match) => ({ id: match[1]!, path: match[2]!, line: Number(match[3]), anchor: match[5]!.replaceAll("\\|", "|") })); // a table cell escapes "|"
    expect(citations.length).toBeGreaterThanOrEqual(20);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    const wrong = citations.filter((citation) => !existsSync(join(ROOT, citation.path)) || !(read(citation.path).split(NEWLINE)[citation.line - 1] ?? "").includes(citation.anchor)).map((citation) => `${citation.id} ${citation.path}:${citation.line} ${citation.anchor}`);
    expect(wrong).toEqual([]);
  });

  it("11. the focus return after a run, a model run of app/page.tsx's own code: the prompt gets focus back only when the run was sent from it, focus fell to body and no pointer was pressed since", { timeout: 30_000 }, async () => {
    // [B24-D3 review, 2026-10-10] correctness-2: the return focused the prompt whenever focus was on body, so a person who pressed a
    // pointer on a surface that takes no focus (the schematic or PCB canvas, the BOM, the simulator) lost the editor's shortcuts to
    // the prompt. The case runs send's busy line, the root element's pointer capture and the run end's block, as written in the page,
    // over FocusModel (the focus rules they rely on), in five runs.
    const code = pageRunCode();
    const outcomes: Record<string, Outcome> = {};
    for (const [name, scenario] of Object.entries(FOCUS_SCENARIOS)) {
      outcomes[name] = await simulateRun(code, scenario);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(outcomes).toEqual({ sentFromThePromptUntouched: "prompt", pointerPressedDuringTheRun: "body", pointerPressedAsThePromptComesBack: "body", sentFromAnotherControl: "body", focusMovedDuringTheRun: "other" });
  });
});

/** [B24-D3 review, 2026-10-10] correctness-1, security-1: the out-of-scope `unnamed` count after D3 (accessibility.md section 2),
 *  the ratchet's bound beside the 3773c6a record (111). It may only fall; a move is a reviewed pin move with a dated note. */
const OUT_OF_SCOPE_UNNAMED_AFTER_D3 = 102;
/** [B24-D3 review, 2026-10-10] correctness-1, security-1: the keys the census lists `unnamed` after D3 (every one out of scope),
 *  frozen here; the generator never rewrites this list. A key may leave it when its control is named; none may join it except by a
 *  reviewed pin move with a dated note (case 3). */
const UNNAMED_KEYS_AFTER_D3: readonly string[] = [
  "app/components/bom/BomView.tsx|click|div|(none)|setExportMenuOpen",
  "app/components/bom/BomView.tsx|click|div|(none)|setSnapPopoverOpen",
  "app/components/circuit-verification/CircuitVerificationWorkspace.tsx|change|select|(none)|setCategory",
  "app/components/circuit-verification/CircuitVerificationWorkspace.tsx|change|select|(none)|setResult",
  "app/components/pcb/CommandPalette.tsx|pointer|div|(none)|onClose",
  "app/components/pcb/ContextMenu.tsx|context-menu|div|(none)|e.preventDefault",
  "app/components/pcb/FabDialog.tsx|click|div|(none)|onClose",
  "app/components/pcb/PcbEditor.tsx|change|AutorouteSetup|(none)|editorRuntime.getHistory,commitPcbCandidate().then,commitPcbCandidate,produce",
  "app/components/pcb/PcbEditor.tsx|change|PlacementSetup|(none)|editorRuntime.getHistory,commitPcbCandidate().then,commitPcbCandidate,produce",
  "app/components/pcb/PcbEditor.tsx|change|RoutingControls|(none)|updateRoutingPreferences",
  "app/components/pcb/PcbEditor.tsx|palette|palette|align-*|commit",
  "app/components/pcb/ShortcutsHelp.tsx|click|div|(none)|onClose",
  "app/components/schematic-compiler/SchematicCompilerWorkspace.tsx|change|select|(none)|setSheetId",
  "app/components/schematic-compiler/SchematicCompilerWorkspace.tsx|change|select|(none)|setVariantId",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,?.find,draft.cornerSets.find",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,draft.measurements.find",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,draft.measurements.find#2",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,draft.outputs.find",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,draft.outputs.find#2",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,draft.specifications.find",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,draft.specifications.find,Number",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,draft.specifications.find#2",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,draft.sweeps.find",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,draft.sweeps.find#2",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,draft.variables.find",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,draft.variables.find#2",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,Number",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutate,Number#2",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutateTest",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|mutateTest,Number",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|patch",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|patch,Number",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|patch#10",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|patch#2",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|patch#3",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|patch#4",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|patch#5",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|patch#6",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|patch#7",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|patch#8",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|patch#9",
  "app/components/spice/SpiceStudio.tsx|change|input|(none)|structuredClone,next.runPlans.find,commit",
  "app/components/spice/SpiceStudio.tsx|change|input|Description|mutate,draft.variables.find",
  "app/components/spice/SpiceStudio.tsx|change|input|from|mutate,draft.measurements.find",
  "app/components/spice/SpiceStudio.tsx|change|input|Input source: V1|patch",
  "app/components/spice/SpiceStudio.tsx|change|input|Output: v(out)|patch",
  "app/components/spice/SpiceStudio.tsx|change|input|Search simulation commands…|setPaletteQuery",
  "app/components/spice/SpiceStudio.tsx|change|input|Source, e.g. V1|patch",
  "app/components/spice/SpiceStudio.tsx|change|input|to|mutate,draft.measurements.find",
  "app/components/spice/SpiceStudio.tsx|change|select|(none)|assign",
  "app/components/spice/SpiceStudio.tsx|change|select|(none)|mutate",
  "app/components/spice/SpiceStudio.tsx|change|select|(none)|mutate,draft.measurements.find",
  "app/components/spice/SpiceStudio.tsx|change|select|(none)|mutate,draft.specifications.find",
  "app/components/spice/SpiceStudio.tsx|change|select|(none)|patch",
  "app/components/spice/SpiceStudio.tsx|change|select|(none)|props.setCompareRunId",
  "app/components/spice/SpiceStudio.tsx|change|select|(none)|setActiveRunPlanId",
  "app/components/spice/SpiceStudio.tsx|change|textarea|.options …|patch,?.split().filter,?.split",
  "app/components/spice/SpiceStudio.tsx|change|textarea|(none)|mutateTest",
  "app/components/spice/SpiceStudio.tsx|change|textarea|Verify startup, ripple, stability, and current across temperature and component tolerance…|props.setInstruction",
  "app/components/spice/SpiceStudio.tsx|click|button|(none)|mutate,draft.measurements.filter",
  "app/components/spice/SpiceStudio.tsx|click|button|(none)|mutate,draft.outputs.filter",
  "app/components/spice/SpiceStudio.tsx|click|button|(none)|mutate,draft.specifications.filter",
  "app/components/spice/SpiceStudio.tsx|click|button|(none)|mutate,draft.sweeps.filter",
  "app/components/spice/SpiceStudio.tsx|click|button|(none)|mutate,draft.variables.filter",
  "app/components/spice/SpiceStudio.tsx|click|button|(none)|onCancel",
  "app/components/spice/SpiceStudio.tsx|click|button|(none)|props.onClose",
  "app/components/spice/SpiceStudio.tsx|click|button|(none)|props.onDismiss",
  "app/components/spice/SpiceStudio.tsx|click|div|(none)|props.setActivePaneId",
  "app/components/spice/SpiceStudio.tsx|pointer|div|(none)|setPaletteOpen",
  "app/components/spice/SpiceWaveformPlot.tsx|pointer|canvas|(none)|onPointerDown",
  "app/page.tsx|change|AnalysisPicker|(none)|setAnalysisConfig",
  "app/page.tsx|change|input|(none)|handleImportProjectFile",
  "app/page.tsx|change|Input|(none)|onChange",
  "app/page.tsx|change|Input|(none)|setDraft",
  "app/page.tsx|change|input|NET_NAME|setLabelDraft",
  "app/page.tsx|change|KicadPropertiesPanel|(none)|setComponentPropertiesCanonical",
  "app/page.tsx|change|PickerField|(none)|onChange",
  "app/page.tsx|change|PickerField|(none)|onChange#2",
  "app/page.tsx|change|PickerField|(none)|onChange#3",
  "app/page.tsx|change|PickerField|(none)|onChange#4",
  "app/page.tsx|change|PickerField|(none)|onChange#5",
  "app/page.tsx|change|PickerField|(none)|onChange#6",
  "app/page.tsx|change|PickerField|(none)|onChange#7",
  "app/page.tsx|change|PickerField|(none)|onChange#8",
  "app/page.tsx|change|PickerField|(none)|parseInt,isNaN,onChange",
  "app/page.tsx|change|PropertiesPanel|(none)|setComponentPropertiesCanonical,schDisplayRef",
  "app/page.tsx|key|Input|(none)|e.preventDefault,commit,setDraft",
  "app/page.tsx|key|input|NET_NAME|e.preventDefault,commitLabelDraft,setLabelDraft",
  "app/page.tsx|pointer|circle|(none)|handlePinClick",
  "app/page.tsx|pointer|div|(none)|onResizeDown",
  "app/page.tsx|pointer|div|(none)|onTitleBarDown",
  "app/page.tsx|pointer|div|(none)|setActivePaneId",
  "app/page.tsx|pointer|div|(none)|startDrag",
  "app/page.tsx|pointer|div|(none)|startDrag#2",
  "app/page.tsx|pointer|g|(none)|handleBodyClick,onCompMoveStart",
  "app/page.tsx|pointer|g|(none)|onMouseDown",
  "app/page.tsx|pointer|g|(none)|onMouseDown#2",
  "app/page.tsx|pointer|g|(none)|onMouseDown#3",
  "app/page.tsx|pointer|g|(none)|onMouseDown#4",
  "app/page.tsx|pointer|polyline|(none)|handleWireClick",
  "app/page.tsx|pointer|rect|(none)|onMouseDown",
  "app/page.tsx|pointer|svg|(none)|onSvgDown",
];

/** [B24-D3 review, 2026-10-10] security-3: the suites the builder executes; a WCAG row tested only by the browser specs reads
 *  PROPOSED until the lead's green run of both specs flips BROWSER_SPECS_EXECUTED to true (a reviewed pin move, with the run named
 *  on accessibility.md section 5, the rows moved to "tested in part" in the same change). */
const UNIT_SUITES: readonly string[] = ["b24-d3-accessible-names", "b24-d3-bom-dialogs"];
const BROWSER_SPECS_EXECUTED = true; // [B24-D3 lead, 2026-10-10] both specs green on the lead's runs, named on accessibility.md section 5

/** Each case of a suite by its number, with its title as written. */
function caseTitleTexts(path: string): Map<string, string> {
  return new Map([...read(path).matchAll(/\b(?:it|test)\(\s*["'`](\d+)\. ([^"'`]*)/g)].map((match) => [match[1]!, match[2]!]));
}
/** The case numbers a page block cites for a suite: `suite` 4, 6 / `suite 4` / `suite` 1-3. */
function citedCases(block: string, suite: string): string[] {
  const numbers: string[] = [];
  for (const match of block.matchAll(new RegExp(`\`${suite}(?:\` | )(\\d+(?:(?:-|, )\\d+)*)`, "g"))) {
    for (const part of match[1]!.split(", ")) {
      const [from, to] = part.split("-").map(Number);
      for (let n = from!; n <= (to ?? from!); n += 1) numbers.push(String(n));
    }
  }
  return numbers;
}

/** [B24-D3 review, 2026-10-10] correctness-3: the buttons inside a file's `DialogContent`s named by a glyph alone (their JSX text
 *  holds no letter or digit and they carry no aria-label) - such a button's name is its glyph, never "Close". */
function glyphButtonsInDialogs(path: string): string[] {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node, inDialog: boolean): void => {
    let inside = inDialog;
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(source);
      if (tag === "DialogContent") inside = true;
      if (inDialog && (tag === "button" || tag === "Button") && attribute(node.openingElement, "aria-label") === null) {
        const text = node.children.map((child) => (ts.isJsxText(child) ? child.text : ts.isJsxExpression(child) && child.expression && ts.isStringLiteral(child.expression) ? child.expression.text : "")).join("").trim();
        if (text.length > 0 && !/[\p{L}\p{N}]/u.test(text)) found.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} <${tag}> "${text}"`);
      }
    }
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(source, false);
  return found;
}

// ─── [B24-D3 review, 2026-10-10] correctness-2: the run's focus code, as app/page.tsx writes it, over a model of focus ─────

/** The page's own code for the focus return: send's statements on the line that sets the busy flag, the run end's block (the one
 *  that clears send's own busy flag) and the root element's pointer capture handler (null when there is none). */
interface RunCode { readonly start: string; readonly end: string; readonly capture: string | null }
function pageRunCode(): RunCode {
  const source = ts.createSourceFile("app/page.tsx", read("app/page.tsx"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  const home = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "Home");
  expect(home?.body, "function Home").toBeDefined();
  const send = home!.body!.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "send");
  expect(send?.body, "Home's send").toBeDefined();
  const busy = send!.body!.statements.filter((statement) => ts.isExpressionStatement(statement) && statement.expression.getText(source) === "setLoading(true)");
  expect(busy, "send sets its busy flag once").toHaveLength(1);
  const start = send!.body!.statements.filter((statement) => lineOf(statement) === lineOf(busy[0]!)).map((statement) => statement.getText(source)).join(NEWLINE);
  const ends: ts.Block[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIfStatement(node) && node.expression.getText(source) === "activeChatRef.current === scope.requestId" && ts.isBlock(node.thenStatement) && node.thenStatement.getText(source).includes("setLoading(false)")) ends.push(node.thenStatement);
    ts.forEachChild(node, visit);
  };
  visit(send!.body!);
  expect(ends, "send clears its own busy flag once").toHaveLength(1);
  const end = ends[0]!.statements.map((statement) => statement.getText(source)).join(NEWLINE);
  let root = home!.body!.statements.filter(ts.isReturnStatement).at(-1)?.expression;
  while (root !== undefined && ts.isParenthesizedExpression(root)) root = root.expression;
  expect(root !== undefined && ts.isJsxElement(root), "Home renders one root element").toBe(true);
  const capture = (root as ts.JsxElement).openingElement.attributes.properties.find((property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(source) === "onPointerDownCapture");
  const handler = capture?.initializer !== undefined && ts.isJsxExpression(capture.initializer) ? capture.initializer.expression : undefined;
  return { start, end, capture: handler === undefined ? null : handler.getText(source) };
}

/** A model of the focus rules the run's code relies on: focus() moves focus only to an enabled, connected, focusable element; a
 *  focused element that turns disabled or is removed leaves focus on body (the HTML focus fix-up); a pointer press reaches the root's
 *  capture handler first, then focuses its target only if that takes focus (a canvas does not); requestAnimationFrame queues a
 *  callback for the next frame, which the case runs. */
class ModelElement {
  connected = true;
  private off = false;
  constructor(readonly owner: FocusModel, readonly tagName: string, private readonly attributes: Readonly<Record<string, string>>, readonly focusable: boolean) {}
  get disabled(): boolean { return this.off; }
  set disabled(value: boolean) {
    this.off = value;
    if (value && this.owner.activeElement === this) this.owner.activeElement = this.owner.body;
  }
  get dataset(): Record<string, string> {
    return Object.fromEntries(Object.entries(this.attributes).filter(([name]) => name.startsWith("data-")).map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));
  }
  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  focus(): void { if (this.connected && this.focusable && !this.off) this.owner.activeElement = this; }
  blur(): void { if (this.owner.activeElement === this) this.owner.activeElement = this.owner.body; }
  remove(): void { this.connected = false; this.blur(); }
}
class FocusModel {
  readonly body: ModelElement;
  activeElement: ModelElement;
  private readonly elements: ModelElement[] = [];
  private readonly frames: Array<() => void> = [];
  readonly window = { requestAnimationFrame: (callback: (time: number) => void): number => this.frames.push(() => callback(0)) };
  constructor() {
    this.body = new ModelElement(this, "BODY", {}, false);
    this.activeElement = this.body;
  }
  add(tagName: string, attributes: Readonly<Record<string, string>>, focusable = true): ModelElement {
    const element = new ModelElement(this, tagName, attributes, focusable);
    this.elements.push(element);
    return element;
  }
  querySelector(selector: string): ModelElement | null {
    const match = /^\[([a-z-]+)="([^"]*)"\]$/.exec(selector);
    expect(match, `a selector the model reads: ${selector}`).not.toBeNull();
    return this.elements.find((element) => element.connected && element.getAttribute(match![1]!) === match![2]!) ?? null;
  }
  runFrame(): void {
    for (const callback of this.frames.splice(0)) callback();
  }
}

type Outcome = "prompt" | "body" | "other";
interface FocusScenario { readonly sentFrom: "prompt" | "retry"; readonly during: "nothing" | "pointer" | "pointer-after-end" | "focus-elsewhere" }
/** The five runs of case 11: sent with Enter from the prompt (a keyboard person) or from another control (the retry card's button,
 *  by keyboard); during the run nothing, a pointer press on the canvas, a pointer press as the prompt comes back, or a Tab to
 *  another control. */
const FOCUS_SCENARIOS: Readonly<Record<string, FocusScenario>> = {
  sentFromThePromptUntouched: { sentFrom: "prompt", during: "nothing" },
  pointerPressedDuringTheRun: { sentFrom: "prompt", during: "pointer" },
  pointerPressedAsThePromptComesBack: { sentFrom: "prompt", during: "pointer-after-end" },
  sentFromAnotherControl: { sentFrom: "retry", during: "nothing" },
  focusMovedDuringTheRun: { sentFrom: "prompt", during: "focus-elsewhere" },
};

async function simulateRun(code: RunCode, scenario: FocusScenario): Promise<Outcome> {
  const dom = new FocusModel();
  const prompt = dom.add("textarea", { "data-testid": "prompt-input" });
  const retry = dom.add("button", { "data-testid": "chat-retry" });
  const other = dom.add("button", { "data-testid": "other-control" });
  const canvas = dom.add("svg", { "data-testid": "schematic-canvas" }, false);
  // The page's identifiers: the DOM, a request scope, the busy setter (its re-render is modelled below) and its refs, one shared
  // `{ current }` per name (activeChatRef holds this run's request id, as send set it on the line before).
  const refs = new Map<string, { current: unknown }>([["activeChatRef", { current: "run-1" }]]);
  const sandbox: Record<string, unknown> = { document: dom, window: dom.window, HTMLElement: ModelElement, HTMLTextAreaElement: ModelElement, scope: { requestId: "run-1" }, setLoading: (): void => undefined };
  const scope = new Proxy(sandbox, {
    has: (target, name) => typeof name === "string" && (name in target || name.endsWith("Ref")),
    get: (target, name) => {
      if (typeof name !== "string") return undefined;
      if (name in target) return target[name];
      if (!refs.has(name)) refs.set(name, { current: null });
      return refs.get(name);
    },
  });
  const run = (typescript: string, result = ""): unknown => {
    const js = ts.transpileModule(typescript, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^"use strict";\s*/, "").replace(/^export \{\};\s*$/m, "");
    return new Function("__scope", `with (__scope) {${NEWLINE}${js}${NEWLINE}${result}}`)(scope);
  };
  const capture = code.capture === null ? null : (run(`const __capture = (${code.capture});`, "return __capture;") as (event: unknown) => void);
  const pointerDown = (target: ModelElement): void => {
    capture?.({ type: "pointerdown", target });
    target.focus();
  };
  (scenario.sentFrom === "prompt" ? prompt : retry).focus();
  run(code.start); // send: the line that sets the busy flag (Enter on the prompt, or the retry control by keyboard)
  prompt.disabled = true; // the re-render: the prompt is disabled while the run streams, and focus falls to body
  if (scenario.sentFrom === "retry") retry.remove(); // the retry card gives way to the new turn
  if (scenario.during === "pointer") pointerDown(canvas);
  if (scenario.during === "focus-elsewhere") other.focus();
  run(code.end); // the run ends: send clears its own busy flag
  for (let frame = 0; frame < 40; frame += 1) {
    if (frame === 0 && scenario.during === "pointer-after-end") pointerDown(canvas);
    if (frame === 3) prompt.disabled = false; // the re-render after setLoading(false)
    dom.runFrame();
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  dom.runFrame();
  return dom.activeElement === prompt ? "prompt" : dom.activeElement === dom.body ? "body" : "other";
}
