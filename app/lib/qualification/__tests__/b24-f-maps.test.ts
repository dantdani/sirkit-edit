/**
 * [B24-F] The derived maps (D24-37, D24-38; OD-220): `scripts/generate-b24-maps.ts` renders six files into
 * artifacts/ai-control-plane-b24/, byte-pinned here, each re-derived from the tree.
 *
 *  1. each of the six outputs equals its renderer (CRLF normalised);
 *  2. two renders are byte-identical, and the script's text holds no environment read, clock, randomness, network, process, thread or
 *     database module, version-control call or test module, and runs its argument, working-directory, output and file-write calls only
 *     inside its `invokedAsScript` block (the check bites on planted probes); this suite's own whole-tree walks each run in a case with
 *     a 180 s budget and a yield first ([B24-F review, 2026-10-10] correctness-6);
 *  3. the route rows equal the census's methods one for one; the public model-egress rows are exactly the reviewed public set; the
 *     externalTransfer rows are exactly the policy table's; spend is false on every row;
 *  4. the process starters are `b20-b4-process-gate`'s APP_SPAWNERS and the SDK importers `b21-a-import-gates`' pinned list, as
 *     58c0834 holds both (lead decision D9);
 *  5. every site, record and tool appears in the coverage matrix; each tier equals the decision function's; the MCP column equals the
 *     reviewed MCP list; no agent-exposed Tier 3 row exists; the rows are exactly every site x each of its records x each record's
 *     owning tools, every record no site reaches and every tool no record owns ([B24-F review, 2026-10-10] correctness-3);
 *  6. every permission row equals `decideAgentExecution` (its setting built from the permission module, not the generator's), beside
 *     the registry's role gate (`role_permitted`); the execute_explicit rows are exactly Tier 1 x execute_explicit_tier1 x the Tier 1
 *     roles x an explicit request; the row count is registry x 3 x 7 x 2, and the role list equals the union's ([B24-F review,
 *     2026-10-10] correctness-2, security-3);
 *  7. the agent graph equals the imported data and never renders a role note or a rule text; the script imports `role-tools`,
 *     `permission-tiers` and `DAG_ROLE_LISTS` (D24-37's counterexample);
 *  8. the count rule: every pinned count equals the literal its pin holds and that literal is the value the earlier task left (D9);
 *     the test files are listed once (a whole-tree walk with its own budget);
 *  9. each superseded hand-written line still holds its stale value, which differs from the derived one (D24-38's counterexample;
 *     the check bites in memory on a line that states the derived value or none);
 * 10. no output carries a closeout note prefix or tag, a closeout tripwire's claim word, B23's control name or retired title, or B20's
 *     stale proposal phrase (assembled at run time, so this file spells none).
 *
 * Every whole-tree walk has its own case with a 180 s timeout and a yield first (the worker-RPC lesson). Failing first on 58c0834 with
 * the generator written and its outputs absent: cases 1, 3-8 and 10. Files are read as text; nothing is written and no process starts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { allRoutePolicies } from "@/app/lib/auth/route-policy";
import { PUBLIC_MODEL_EGRESS } from "@/app/lib/auth/route-resource-classification";
import { listRouteFiles, routePathOf } from "@/app/lib/auth/route-tree";
import { exportedHttpMethods } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { ACTION_COVERAGE_REGISTRY } from "@/app/lib/engineering/action-registry";
import { classifyControlSites } from "@/app/lib/engineering/control-registry";
import { scanControlSites } from "@/app/lib/engineering/control-surface";
import { INTENTIONAL_MCP_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/mcp-exposure-review";
import { decideAgentExecution, defaultAutonomySetting, permissionTierOfAction, permissionTierOfDescriptor, TIER1_EXECUTE_ROLES, type AgentAutonomySetting, type AutonomyMode } from "@/app/lib/engineering/permission-tiers";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import type { ProjectRole } from "@/app/lib/engineering/types";
import { SPECIALIST_ROLES } from "@/app/lib/agent/orchestration/contracts";
import { MERGE_DECISION_PRECEDENCE, MERGE_RULES } from "@/app/lib/agent/orchestration/merge";
import { INTENTIONAL_ROLE_TOOL_IDS, PROPOSING_ROLES } from "@/app/lib/agent/orchestration/role-tools";
import { DAG_ROLE_LISTS, FULL_CIRCUIT_TRIM, ROUTER_RULES } from "@/app/lib/agent/orchestration/router";
import { SPECIALIST_CAPS } from "@/app/lib/agent/orchestration/scheduler";
import { B24_MAP_FILES, B24_MAP_RENDERERS, B24_MAPS_DIR, COUNT_PINS, PERMISSION_MATRIX_ROLES, PERMISSION_MATRIX_SETTINGS, SUPERSEDED_LINES, parseCsv, resolveTestFile, type B24MapFile } from "../../../../scripts/generate-b24-maps";
import { readRepo, records, tableUnder } from "./_b24-f-pages";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const GENERATOR = "scripts/generate-b24-maps.ts";
const SELF = "app/lib/qualification/__tests__/b24-f-maps.test.ts";
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const committed = (file: B24MapFile): string => readRepo(`${B24_MAPS_DIR}/${file}`);
/** The first render of each map (case 1), compared byte for byte with the second (case 2). */
const firstRender = new Map<B24MapFile, string>();
const renderOnce = (file: B24MapFile): string => {
  let text = firstRender.get(file);
  if (text === undefined) {
    text = B24_MAP_RENDERERS[file](ROOT);
    firstRender.set(file, text);
  }
  return text;
};
/** [B24-F review, 2026-10-10] correctness-6: every test file under app/ (a `__tests__` directory, `.test.ts(x)`), walked once per case. */
function testFileList(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, ...dir.split("/")))) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const path = `${dir}/${entry}`;
      if (statSync(join(ROOT, ...path.split("/"))).isDirectory()) walk(path);
      else if (/\.test\.tsx?$/.test(entry) && path.includes("/__tests__/")) out.push(path);
    }
  };
  walk("app");
  return out.sort();
}
/** [B24-F review, 2026-10-10] correctness-6: the cases of this suite that walk the whole tree without their own 180 s budget and a yield
 *  first (the worker-RPC lesson, `app/lib/project/__tests__/b14-4-ast-import-gates.test.ts:64, :291`). */
function unbudgetedWalks(text: string): string[] {
  const file = ts.createSourceFile(SELF, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const WALK = /\b(?:testFileList|resolveTestFile|scanControlSites|listRouteFiles|renderOnce)\(|B24_MAP_RENDERERS\[/;
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "it" && node.arguments.length >= 2 && ts.isStringLiteralLike(node.arguments[0]!)) {
      const body = node.arguments[node.arguments.length - 1]!;
      if (WALK.test(body.getText(file))) {
        const options = node.arguments.length === 3 ? node.arguments[1]!.getText(file) : "";
        const first = ts.isArrowFunction(body) && ts.isBlock(body.body) ? body.body.statements[0]?.getText(file) ?? "" : "";
        if (!/\btimeout: 180_000\b/.test(options) || first !== "await yieldToLoop();") found.push(node.arguments[0]!.text.slice(0, 2));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// ── the script check (case 2) ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The write calls a script may make only inside its `invokedAsScript` block (assembled: this file spells no write call). */
const WRITERS = new Set([["write", "FileSync"], ["mkdir", "Sync"], ["write", "File"], ["mkdir", ""], ["append", "FileSync"], ["rm", "Sync"], ["unlink", "Sync"], ["cp", "Sync"], ["rename", "Sync"], ["createWrite", "Stream"]].map((parts) => parts.join("")));
const NETWORK_OR_PROCESS = /^(?:node:)?(?:child_process|worker_threads|cluster|net|http|https|http2|tls|dgram|dns)(?:\/|$)/;
const DATABASE = /^(?:postgres|pg|@electric-sql\/pglite|drizzle-orm)(?:\/|$)|(?:^|\/)app\/lib\/db\/|(?:^|\/)disposable-postgres$|\.\.\/db\//;
/** What the script's text breaks: the forbidden references anywhere, and the script-only calls outside the `invokedAsScript` block. */
function scriptFindings(text: string): string[] {
  const file = ts.createSourceFile(GENERATOR, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings: string[] = [];
  const inScriptBlock = (node: ts.Node): boolean => {
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
      if (ts.isIfStatement(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "invokedAsScript") return true;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.name.text === "invokedAsScript") return true;
    }
    return false;
  };
  const specifier = (value: string): void => {
    if (NETWORK_OR_PROCESS.test(value)) findings.push(`module ${value}`);
    if (DATABASE.test(value)) findings.push(`database module ${value}`);
    if (value.includes("__tests__")) findings.push(`test module ${value}`);
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if ((callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === "require")) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) specifier(node.arguments[0].text);
      for (const argument of node.arguments) if (ts.isStringLiteralLike(argument) && /^git(?:\s|$)/.test(argument.text)) findings.push(`a git call: ${argument.text}`);
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (WRITERS.has(name) && !inScriptBlock(node)) findings.push(`${name} outside the script block`);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const [object, member] = [node.expression.text, node.name.text];
      if (object === "process" && member === "env") findings.push("process.env");
      if (object === "process" && ["argv", "cwd", "stdout"].includes(member) && !inScriptBlock(node)) findings.push(`process.${member} outside the script block`);
      if (object === "Math" && member === "random") findings.push("Math.random");
    }
    if (ts.isIdentifier(node) && (node.text === "Date" || node.text === "fetch") && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) findings.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

// ── the pages' tables ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const routeRows = (): Array<Readonly<Record<string, string>>> => records(tableUnder(committed("trust-boundary-map.md"), "1. Routes"));
const listUnder = (prefix: string): string[] => tableUnder(committed("trust-boundary-map.md"), prefix).rows.map((row) => row[1]!);
const appSpawners = (): string[] => [.../const APP_SPAWNERS = \[([^\]]*)\];/.exec(readRepo("app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts"))![1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
const pinnedSdkImporters = (): string[] => {
  const line = readRepo("app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts").split(NEWLINE)[90] ?? "";
  return [.../expect\(importers\)\.toEqual\(\[([^\]]*)\]\)/.exec(line)![1]!.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
};
const csvRecords = (text: string): Array<Readonly<Record<string, string>>> => {
  const [header, ...rows] = parseCsv(text);
  return rows.map((row) => Object.fromEntries(header!.map((name, index) => [name, row[index] ?? ""])));
};

/** The values each pin held when the earlier task left it (lead decision D9): a pin holding another value is a STOP. */
const D9: Readonly<Record<string, number>> = { "route-methods": 177, "canonical-wrappers": 174, "approved-factories": 3, "raw-handlers": 0, "registry-tools": 63, "agent-exposed-tools": 51, "mcp-exposed-tools": 9, "agent-only-tools": 42, "action-records": 113, "control-sites": 708, "control-surfaces": 73, "sql-migrations": 32, "process-spawners": 5, "provider-sdk-importers": 6 }; // [PR-J3, 2026-10-22] pin move (D9, runbook J.3 / OD-255 item 7 / OD-257): control-sites 663 -> 708 (707 from the navigator's surfaces, then + 1 when the page's label map gained the scoped label glyph's pointer-down site, app/page.tsx ScopedNetLabelGlyph onLabelMouseDown, classified under schematic.drag-gesture) and control-surfaces 70 -> 73 - the B17-A summary's literals since the Sheets navigator (app/components/schematic/SheetNavigator.tsx: the chip, the tree and its keys, New / Rename / Up / Down / Add port / Delete, the Move to sheet and Follow signal dialogs with their drafts; SheetBlocksLayer.tsx: the overview block's double-click; ScopedNetLabelGlyph.tsx: the scoped label's drag), each classified under a PR-J3 rule; action-records unchanged at 113 (the two section J records flipped partial -> implemented, no record added); [PR-J, 2026-10-22] pin move (D9, runbook J / OD-255): action-records 111 -> 113 (schematic.sheet-structure, schematic.move-to-sheet); [PR-M, 2026-10-18] pin move (D9, section M2): route-methods 175 -> 177 and canonical-wrappers 172 -> 174 (GET and POST /api/parts/acquisitions, two canonical wrappers); registry-tools 61 -> 63, agent-exposed-tools 49 -> 51 and agent-only-tools 40 -> 42 (the CAD acquisition start and status: agent-exposed, MCP-withheld); action-records 110 -> 111 (parts.cad-acquisition); control-sites 656 -> 663 and control-surfaces 68 -> 70 (the Missing parts list's acquisition panel and the Build Library's component review inbox: seven controls on two new surfaces, each classified) - the literals b16-1c, b20-c1 P7, b23-a case 5 and the control inventory now hold; [PR-L, 2026-10-18] pin move (D9, runbook L.5): registry-tools 59 -> 61, agent-exposed-tools 47 -> 49 and agent-only-tools 38 -> 40 (the durable generation task's inspection and control request: agent-exposed, MCP-withheld) - the literals b20-c1 P7 now holds; control-sites 654 -> 656 (app/page.tsx's design control chip, Confirm and Dismiss, each classified; the surface count unchanged); [PR-M, 2026-10-17] pin move (D9): registry-tools 56 -> 59, agent-exposed-tools 44 -> 47 and agent-only-tools 35 -> 38 (the schematic-instance inspection, the resolution candidate search and the component resolution proposal: agent-exposed, MCP-withheld), action-records 108 -> 110 (schematic.resolve-components-propose and schematic.resolve-components) - the literals b20-c1 P7 and b23-a case 5 now hold; [PR-L, 2026-10-17] pin move (D9): route-methods 168 -> 174 and canonical-wrappers 165 -> 171 - the literals b16-1c-invariant-tripwires.test.ts:48 holds since runbook L.4's six generation-task methods (POST/GET /api/generation-tasks, GET /api/generation-tasks/[id], GET .../events, POST .../control, POST /api/generation-worker, each a canonical wrapper; 3 factories and 0 raw unchanged); control-sites 646 -> 649 and control-surfaces 66 -> 67 - the B17-A summary's literals since the design task's status card (GenerationTaskStatus.tsx, a new surface: its action buttons, Retry block and Start again), each classified under a PR-L rule; // [PR-G, 2026-10-17] pin move (D9): control-sites 640 -> 646 and control-surfaces 65 -> 66 - the B17-A summary's literals since PR-G's six control sites (StackupCandidatePanel.tsx's Accept and Discard, a new surface; app/page.tsx's draft-request open button, its dialog and Close, and the module-note toggle), each classified under a PR-G rule; // [PR-F lead, 2026-10-17] pin move (D9): registry-tools 52 -> 56, agent-exposed-tools 40 -> 44, agent-only-tools 31 -> 35 (the four PR-F descriptors), action-records 107 -> 108 (parts.draft-request), control-sites 636 -> 640 and control-surfaces 64 -> 65 (the Missing parts list); // [PR-D, 2026-10-17] pin move (D9): registry-tools 48 -> 52, agent-exposed-tools 37 -> 40, agent-only-tools 28 -> 31 - the literal b20-c1-three-way-parity.test.ts:241 holds since PR-D's four descriptors (OD-243, OD-244: the Build-mode generation proposal, the Schematic-to-PCB preflight read and the catalog part inspection agent-exposed and withheld from MCP, the component review request registered not callable; mcp-exposed-tools stays 9); control-sites 628 -> 636, control-surfaces 63 -> 64 - the B17-A summary's literals since PR-C 6bdd7f7 (630/64) and PR-E 390afa4 (636/64), byte-identical to HEAD under PR-D [PR-M, 2026-10-18] pin move (D9): route-methods 174 -> 175 and canonical-wrappers 171 -> 172 (+ POST /api/component-resolution-authority, the reviewed resolution's fresh-facts endpoint); control-sites 649 -> 654 and control-surfaces 67 -> 68 (the resolution review dialog's Approve, Discard, close and receipt Dismiss on its new surface, and the Missing parts list's Find a replacement in the library)
/** The literal a pin's line holds for a count, read by the line's own shape. */
function pinnedLiteral(id: string, lines: readonly string[]): number[] {
  const one = (pattern: RegExp, index: number, line: string): number => Number(pattern.exec(line)?.[index] ?? Number.NaN);
  return lines.map((line) => {
    switch (id) {
      case "route-methods": return one(/total: (\d+), canonical: (\d+), factories: (\d+), raw: (\d+)/, 1, line);
      case "canonical-wrappers": return one(/total: (\d+), canonical: (\d+), factories: (\d+), raw: (\d+)/, 2, line);
      case "approved-factories": return one(/total: (\d+), canonical: (\d+), factories: (\d+), raw: (\d+)/, 3, line);
      case "raw-handlers": return one(/total: (\d+), canonical: (\d+), factories: (\d+), raw: (\d+)/, 4, line);
      case "registry-tools": return one(/registry: (\d+), agentExposed: (\d+), mcpExposed: (\d+), agentOnly: (\d+)/, 1, line);
      case "agent-exposed-tools": return one(/registry: (\d+), agentExposed: (\d+), mcpExposed: (\d+), agentOnly: (\d+)/, 2, line);
      case "mcp-exposed-tools": return one(/registry: (\d+), agentExposed: (\d+), mcpExposed: (\d+), agentOnly: (\d+)/, 3, line);
      case "agent-only-tools": return one(/registry: (\d+), agentExposed: (\d+), mcpExposed: (\d+), agentOnly: (\d+)/, 4, line);
      case "action-records": return one(/expect\(actionIds\)\.toHaveLength\((\d+)\)/, 1, line);
      case "control-sites": return one(/"sites": (\d+),/, 1, line);
      case "control-surfaces": return one(/"surfaces": (\d+),/, 1, line);
      case "sql-migrations": return one(/\.toHaveLength\((\d+)\)/, 1, line);
      case "process-spawners": return /^const APP_SPAWNERS = \[$/.test(line) ? appSpawners().length : Number.NaN;
      case "provider-sdk-importers": return /expect\(importers\)\.toEqual\(\[/.test(line) ? pinnedSdkImporters().length : Number.NaN;
      default: return Number.NaN;
    }
  });
}

/** What a superseded line breaks: it no longer holds its stale value, or the value equals the derived one. */
function supersededProblem(lineText: string, pattern: RegExp, derived: string): string | null {
  const match = pattern.exec(lineText);
  if (match === null) return "no stale value";
  return match.slice(1).join("/") === derived ? "the stale value equals the derived one" : null;
}

// ── the forbidden texts (case 10), assembled at run time ────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_IN_PAGES: ReadonlyArray<readonly [string, RegExp]> = [
  ["a closeout note prefix", new RegExp([["[superseded 2026-09-29 by the B21 clos", "eout ("], ["[superseded 2026-10-02 by the B22 clos", "eout ("], ["[superseded 2026-10-05 by the B23 clos", "eout ("], ["[superseded 2026-10-10 by B24", "-E ("]].map((parts) => parts.join("").replace(/[[\]().]/g, "\\$&")).join("|"))],
  ["a closeout tag", new RegExp([["[B21 clos", "eout, 2026-09-29]"], ["[B22 clos", "eout, 2026-10-02]"], ["[B23 clos", "eout, 2026-10-05]"]].map((parts) => parts.join("").replace(/[[\]().]/g, "\\$&")).join("|"))],
  ["a closeout tripwire's claim word", new RegExp([String.raw`single[- ]agent`, String.raw`\bsand` + String.raw`box`, String.raw`\bno net` + String.raw`work\b`, "five" + " spawners", "exactly" + " 12", String.raw`\biso` + String.raw`lated\b`].join("|"), "i")],
  ["B23's control name", new RegExp(["Send", "to", "fab"].join(" "))],
  ["B23's retired title", new RegExp(["only the CSV", "generator reads the registry"].join(" "))],
  ["B20's stale proposal phrase", new RegExp(["B4 inert" + " proposals", "inert-proposal" + " subset", String.raw`B4 \(` + String.raw`proposals\)`].join("|"))],
];
const FORBIDDEN_IN_CSVS = [FORBIDDEN_IN_PAGES[0]!, FORBIDDEN_IN_PAGES[1]!, FORBIDDEN_IN_PAGES[5]!];

describe("[B24-F] the derived maps are the tree's (D24-37, D24-38; OD-220)", () => {
  it("1. each of the six outputs exists and equals its renderer, CRLF normalised (a whole-tree walk)", { timeout: 180_000 }, async () => {
    await yieldToLoop();
    expect(B24_MAP_FILES).toHaveLength(6);
    for (const file of B24_MAP_FILES) {
      await yieldToLoop();
      expect(committed(file).length, `${file}: run pnpm exec tsx ${GENERATOR}`).toBeGreaterThan(0);
      expect(committed(file), file).toBe(renderOnce(file));
    }
  });

  it("2. two renders are byte-identical, and the script holds none of the forbidden references; its argument, working-directory, output and write calls stand only in its invokedAsScript block (the check bites on planted probes)", { timeout: 180_000 }, async () => {
    await yieldToLoop();
    for (const file of B24_MAP_FILES) {
      await yieldToLoop();
      expect(B24_MAP_RENDERERS[file](ROOT), file).toBe(renderOnce(file));
    }
    const script = readRepo(GENERATOR);
    expect(scriptFindings(script)).toEqual([]);
    const planted: ReadonlyArray<readonly [string, string]> = [
      [`const now = ${"Da" + "te"}.now();`, "Date"],
      [`const seed = ${["Math", "random"].join(".")}();`, "Math.random"],
      [`const key = ${["process", "env"].join(".")}.HOME;`, "process.env"],
      [`import { spawn } from "node:${"child" + "_process"}";`, `module node:${"child" + "_process"}`],
      [`import { Worker } from "node:${"worker" + "_threads"}";`, `module node:${"worker" + "_threads"}`],
      [`import { request } from "node:${"ht" + "tps"}";`, `module node:${"ht" + "tps"}`],
      [`import { db } from "../app/lib/${"db"}/client";`, `database module ../app/lib/${"db"}/client`],
      [`import { x } from "../app/lib/auth/${"__tests__"}/_boundary-analysis";`, `test module ../app/lib/auth/${"__tests__"}/_boundary-analysis`],
      [`run("${"g" + "it"} log");`, `a git call: ${"g" + "it"} log`],
      [`${["write", "FileSync"].join("")}("x", "y");`, `${["write", "FileSync"].join("")} outside the script block`],
      [`const here = ${["process", "cwd"].join(".")}();`, "process.cwd outside the script block"],
      [`const page = ${"fet" + "ch"}("https://example.invalid/");`, "fetch"],
    ];
    for (const [probe, finding] of planted) expect(scriptFindings(`${script}${NEWLINE}${probe}${NEWLINE}`), probe).toContain(finding);
    // [B24-F review, 2026-10-10] correctness-6: this suite's own whole-tree walks each run in a case with a 180 s budget and a yield
    // first; the check bites on a walking case without them
    expect(unbudgetedWalks(readRepo(SELF))).toEqual([]);
    expect(unbudgetedWalks(`it("9. probe", () => { const files = testFileList(); });`)).toEqual(["9."]);
  });

  it("3. the route rows equal the census's methods one for one; the public modelEgress rows are exactly the reviewed public set, the externalTransfer rows exactly the policy table's, and spend is false on every row (a whole-tree walk)", { timeout: 180_000 }, async () => {
    await yieldToLoop();
    const rows = routeRows();
    const census: string[] = [];
    for (const file of listRouteFiles(ROOT)) {
      const path = routePathOf(ROOT, file);
      for (const method of exportedHttpMethods(readFileSync(file, "utf8"), file)) census.push(`${method} ${path}`);
    }
    expect(rows.map((row) => `${row.method} ${row.path}`).sort()).toEqual(census.sort());
    expect(new Set(rows.map((row) => `${row.method} ${row.path}`)).size).toBe(rows.length);
    expect(new Set(rows.filter((row) => row.authClass === "public" && row.modelEgress === "true").map((row) => row.path))).toEqual(new Set(Object.keys(PUBLIC_MODEL_EGRESS)));
    expect(rows.filter((row) => row.externalTransfer === "true").map((row) => `${row.method} ${row.path}`)).toEqual(allRoutePolicies().filter((policy) => policy.externalTransfer).map((policy) => `${policy.method} ${policy.path}`));
    expect(rows.filter((row) => row.externalTransfer === "true").map((row) => `${row.method} ${row.path}`)).toEqual(["POST /api/pcb/provider-exchange"]);
    expect(rows.filter((row) => row.spend !== "false")).toEqual([]);
  });

  it("4. the process starters are b20-b4-process-gate's APP_SPAWNERS and the provider SDK importers b21-a-import-gates' pinned list, as 58c0834 holds both (D9)", () => {
    expect(listUnder("2. Process and thread starters")).toEqual(appSpawners());
    expect(appSpawners()).toEqual(["app/lib/computation/diagnostic-runner.ts", "app/lib/computation/engine-host.ts", "app/lib/computation/engine-worker.mjs", "app/lib/pcb/autoroute/runner.ts", "app/lib/pcb/fab/kicad-cli-runner.ts"]);
    expect(listUnder("3. Provider SDK importers")).toEqual(pinnedSdkImporters());
    expect(pinnedSdkImporters()).toHaveLength(6);
  });

  it("5. every site, record and tool appears in the coverage matrix; each tier equals the decision function's; the MCP column equals the reviewed MCP list; no agent-exposed Tier 3 row exists (a whole-tree walk)", { timeout: 180_000 }, async () => {
    await yieldToLoop();
    const rows = csvRecords(committed("coverage-matrix.csv"));
    expect(rows.length).toBeGreaterThan(600);
    const sites = classifyControlSites(scanControlSites(ROOT)).classified;
    await yieldToLoop();
    const keys = new Set(rows.map((row) => row.control_key));
    expect(sites.filter((site) => !keys.has(site.key)).map((site) => site.key)).toEqual([]);
    const recordIds = new Set(rows.map((row) => row.record_id));
    expect(ACTION_COVERAGE_REGISTRY.filter((record) => !recordIds.has(record.id)).map((record) => record.id)).toEqual([]);
    const tools = sirkitToolRegistry().list();
    const toolIds = new Set(rows.map((row) => row.tool_id));
    expect(tools.filter((tool) => !toolIds.has(tool.toolId)).map((tool) => tool.toolId)).toEqual([]);
    const records = new Map(ACTION_COVERAGE_REGISTRY.map((record) => [record.id, record] as const));
    const byId = new Map(tools.map((tool) => [tool.toolId, tool] as const));
    const problems: string[] = [];
    for (const row of rows) {
      if (row.record_id !== "-" && row.record_tier !== String(permissionTierOfAction(records.get(row.record_id)!))) problems.push(`${row.record_id}: record tier ${row.record_tier}`);
      if (row.tool_id === "-") continue;
      const tool = byId.get(row.tool_id)!;
      if (row.tool_tier !== String(permissionTierOfDescriptor(tool))) problems.push(`${row.tool_id}: tool tier ${row.tool_tier}`);
      if (row.mcp_exposed !== String(INTENTIONAL_MCP_EXPOSED_TOOL_IDS.includes(row.tool_id))) problems.push(`${row.tool_id}: mcp ${row.mcp_exposed}`);
      if (row.agent_exposed !== String(tool.agentExposed)) problems.push(`${row.tool_id}: agent ${row.agent_exposed}`);
      if (row.agent_exposed === "true" && row.tool_tier === "3") problems.push(`${row.tool_id}: an agent-exposed Tier 3 row`);
      if (row.record_id !== "-" && row.record_id !== tool.owningCommandId) problems.push(`${row.tool_id}: owned by ${tool.owningCommandId}, joined to ${row.record_id}`);
    }
    expect(problems).toEqual([]);
    expect(new Set(rows.filter((row) => row.mcp_exposed === "true").map((row) => row.tool_id))).toEqual(new Set(INTENTIONAL_MCP_EXPOSED_TOOL_IDS));
    // [B24-F review, 2026-10-10] correctness-3: the row space itself - each site's rows hold exactly its records (or `-`), each (site or
    // unreached record) x record holds exactly the record's owning tools (or `-`), the siteless record rows are exactly the records no
    // site reaches, and the recordless tool rows exactly the tools whose owning command is no record
    const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
    const ownedBy = (recordId: string): string[] => tools.filter((tool) => tool.owningCommandId === recordId).map((tool) => tool.toolId);
    const spaceProblems: string[] = [];
    for (const site of sites) {
      const own = rows.filter((row) => row.control_key === site.key);
      const want = site.recordIds.length > 0 ? sorted(site.recordIds) : ["-"];
      if (JSON.stringify(sorted(own.map((row) => row.record_id!))) !== JSON.stringify(want)) spaceProblems.push(`${site.key}: records ${sorted(own.map((row) => row.record_id!)).join(";")}, the site reaches ${want.join(";")}`);
    }
    const toolsByPair = new Map<string, string[]>();
    for (const row of rows) if (row.record_id !== "-") toolsByPair.set(JSON.stringify([row.control_key, row.record_id]), [...(toolsByPair.get(JSON.stringify([row.control_key, row.record_id])) ?? []), row.tool_id!]);
    for (const [pair, got] of toolsByPair) {
      const [control, recordId] = JSON.parse(pair) as [string, string];
      const want = ownedBy(recordId).length > 0 ? sorted(ownedBy(recordId)) : ["-"];
      if (JSON.stringify(sorted(got)) !== JSON.stringify(want)) spaceProblems.push(`${control} x ${recordId}: tools ${sorted(got).join(";")}, owned ${want.join(";")}`);
    }
    const reachedBySites = new Set(sites.flatMap((site) => [...site.recordIds]));
    if (JSON.stringify(sorted(rows.filter((row) => row.control_key === "-" && row.record_id !== "-").map((row) => row.record_id!))) !== JSON.stringify(sorted(ACTION_COVERAGE_REGISTRY.filter((record) => !reachedBySites.has(record.id)).map((record) => record.id)))) spaceProblems.push("the siteless record rows are not the records no site reaches");
    if (JSON.stringify(sorted(rows.filter((row) => row.record_id === "-" && row.tool_id !== "-").map((row) => row.tool_id!))) !== JSON.stringify(sorted(tools.filter((tool) => !records.has(tool.owningCommandId)).map((tool) => tool.toolId)))) spaceProblems.push("the recordless tool rows are not the tools no record owns");
    expect(spaceProblems).toEqual([]);
    expect(new Set(rows.map((row) => JSON.stringify([row.control_key, row.record_id, row.tool_id]))).size).toBe(rows.length);
    expect(sites.filter((site) => site.recordIds.length > 1).length).toBeGreaterThan(30);
  });

  it("6. every permission row equals decideAgentExecution over every registry tool x the three settings x the seven roles x the explicit-request fact, beside the registry's role gate; the execute_explicit rows are exactly Tier 1 x execute_explicit_tier1 x the Tier 1 roles x an explicit request; the role list equals ProjectRole's members", () => {
    const union = /^export type ProjectRole = ((?:"[a-z_]+"(?: \| )?)+);$/m.exec(readRepo("app/lib/engineering/types.ts"));
    expect(union, "ProjectRole's union").not.toBeNull();
    expect([...PERMISSION_MATRIX_ROLES]).toEqual([...union![1]!.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!));
    expect([...PERMISSION_MATRIX_SETTINGS]).toEqual(["proposal_only", "execute_explicit_tier1", "unavailable"]);
    const tools = sirkitToolRegistry().list();
    const text = committed("permission-autonomy-matrix.csv");
    const rows = csvRecords(text);
    expect(rows).toHaveLength(tools.length * 3 * 7 * 2);
    // [B24-F review, 2026-10-10] security-3: the registry's role gate stands beside the tier function's decision, which never reads it
    expect(parseCsv(text)[0]).toEqual(["tool_id", "tier", "agent_exposed", "mcp_exposed", "setting", "role", "role_permitted", "explicit_user_request", "decision", "requires_grant", "requires_human_approval"]);
    // [B24-F review, 2026-10-10] correctness-2: the setting is built here from the permission module, never through the generator's own
    const settingFor = (setting: string): AgentAutonomySetting | null => (setting === "unavailable" ? null : { ...defaultAutonomySetting({ tenantId: "t", projectId: "p" }), mode: setting as AutonomyMode });
    const problems: string[] = [];
    for (const row of rows) {
      const tool = tools.find((candidate) => candidate.toolId === row.tool_id);
      if (tool === undefined) { problems.push(`${row.tool_id}: no registry tool`); continue; }
      const tier = permissionTierOfDescriptor(tool);
      const role = row.role as ProjectRole;
      const decision = decideAgentExecution({ tier, setting: settingFor(row.setting!), actorRole: role, explicitUserRequest: row.explicit_user_request === "true" });
      const expected = { tier: String(tier), agent_exposed: String(tool.agentExposed), mcp_exposed: String(INTENTIONAL_MCP_EXPOSED_TOOL_IDS.includes(tool.toolId)), role_permitted: String(tool.requiredRoles.includes(role)), decision: decision.decision, requires_grant: String(decision.requiresGrant), requires_human_approval: String(decision.requiresHumanApproval) };
      for (const [key, value] of Object.entries(expected)) if (row[key] !== value) problems.push(`${row.tool_id} ${row.setting} ${row.role} ${row.explicit_user_request}: ${key} ${row[key]} not ${value}`);
    }
    expect(problems).toEqual([]);
    const key = (row: Readonly<Record<string, string>>): string => `${row.tool_id} ${row.setting} ${row.role} ${row.explicit_user_request}`;
    expect(new Set(rows.map(key)).size).toBe(rows.length);
    const explicit = tools.filter((tool) => permissionTierOfDescriptor(tool) === 1).flatMap((tool) => TIER1_EXECUTE_ROLES.map((role) => `${tool.toolId} execute_explicit_tier1 ${role} true`)).sort();
    expect(explicit.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.decision === "execute_explicit").map(key).sort()).toEqual(explicit);
    // a refused role's row says so: some row's decision is executable for a role the tool's registry entry refuses
    expect(rows.some((row) => row.role_permitted === "false" && row.decision === "execute_direct")).toBe(true);
  });

  it("7. the agent graph equals the imported data - roles, per-role tools, proposing roles, the six DAG kinds, the router's rule ids and runbook lines, the trim, the caps, the merge's precedence and rule ids - and renders no role note and no rule text; the script imports role-tools, permission-tiers and DAG_ROLE_LISTS (D24-37's counterexample)", () => {
    const page = committed("agent-graph.md");
    expect(records(tableUnder(page, "1. Specialist roles"))).toEqual(SPECIALIST_ROLES.map((role) => ({ role, proposing: String(PROPOSING_ROLES.includes(role)), "reviewed tools": String(INTENTIONAL_ROLE_TOOL_IDS[role].length) })));
    expect(tableUnder(page, "2. Per-role tool ids").rows).toEqual(SPECIALIST_ROLES.flatMap((role) => [...INTENTIONAL_ROLE_TOOL_IDS[role]].sort().map((toolId) => [role, toolId])));
    expect(tableUnder(page, "3. Proposing roles").rows.map((row) => row[1])).toEqual([...PROPOSING_ROLES]);
    expect(tableUnder(page, "4. DAG kinds").rows).toEqual(Object.entries(DAG_ROLE_LISTS).map(([kind, list]) => [kind, String(list.length), list.join(" -> ")]));
    expect(Object.keys(DAG_ROLE_LISTS)).toHaveLength(6);
    expect(tableUnder(page, "5. Router rules").rows).toEqual(ROUTER_RULES.map((rule, index) => [String(index + 1), rule.id, rule.kind, rule.runbook, rule.roles === null ? "-" : rule.roles.join(" -> ")]));
    expect(tableUnder(page, "6. The full-circuit trim").rows).toEqual([["priority", FULL_CIRCUIT_TRIM.priority.join(" -> ")], ["foldedIntoCoordinator", FULL_CIRCUIT_TRIM.foldedIntoCoordinator.join(" -> ")], ["layoutSwap", `${FULL_CIRCUIT_TRIM.layoutSwap.replaces} -> ${FULL_CIRCUIT_TRIM.layoutSwap.by}`]]);
    expect(tableUnder(page, "7. Caps").rows).toEqual(Object.entries(SPECIALIST_CAPS).map(([key, value]) => [key, String(value)]));
    expect(tableUnder(page, "8.1 Decision precedence").rows.map((row) => row[1])).toEqual([...MERGE_DECISION_PRECEDENCE]);
    expect(tableUnder(page, "8.2 Rules").rows).toEqual(MERGE_RULES.map((rule) => [rule.id, rule.runbook]));
    // never a note or a rule text: no rule summary, merge rule, merge text or proof is on the page, and no role note's words
    for (const text of [...ROUTER_RULES.map((rule) => rule.summary), ...MERGE_RULES.flatMap((rule) => [rule.rule, rule.merge, rule.proof])]) expect(page.includes(text), text.slice(0, 40)).toBe(false);
    const notes = /export const ROLE_N[O]TES[^=]*= Object\.freeze\(\{([\s\S]*?)\}\);/.exec(readRepo("app/lib/agent/orchestration/role-tools.ts"))?.[1] ?? "";
    expect(notes.length).toBeGreaterThan(100);
    for (const match of notes.matchAll(/: "([^"]{20,})"/g)) expect(page.includes(match[1]!.slice(0, 40)), match[1]!.slice(0, 40)).toBe(false);
    const specifiers = [...readRepo(GENERATOR).matchAll(/from "([^"]+)"/g)].map((match) => match[1]!);
    expect(specifiers).toEqual(expect.arrayContaining(["../app/lib/agent/orchestration/role-tools", "../app/lib/engineering/permission-tiers", "../app/lib/agent/orchestration/router"]));
    expect(readRepo(GENERATOR)).toMatch(/import \{[^}]*\bDAG_ROLE_LISTS\b[^}]*\} from "\.\.\/app\/lib\/agent\/orchestration\/router";/);
  });

  it("8. the count rule: every pinned count on current-system-map.md equals the literal its own pin holds, each literal is the value the earlier task left (D9), the unpinned counts say so, and the agent-exposed Tier 3 count is 0 (a whole-tree walk, once)", { timeout: 180_000 }, async () => {
    await yieldToLoop();
    // [B24-F review, 2026-10-10] correctness-6: the test files are listed once here, not once per pin (twelve walks before)
    const files = testFileList();
    const rows = records(tableUnder(committed("current-system-map.md"), "1. Counts"));
    expect(rows.map((row) => row.count)).toEqual(Object.keys(COUNT_PINS));
    const problems: string[] = [];
    for (const row of rows) {
      const pin = COUNT_PINS[row.count];
      if (pin === null) {
        if (row.pin !== "derived, unpinned") problems.push(`${row.count}: ${row.pin}`);
        continue;
      }
      const [file, lines] = pin!;
      const path = file.includes("/") ? file : resolveTestFile(ROOT, file, files);
      if (row.pin !== `${path}:${lines.join(", :")}`) problems.push(`${row.count}: cites ${row.pin}`);
      const text = readRepo(path).split(NEWLINE);
      const literals = pinnedLiteral(row.count, lines.map((line) => text[line - 1] ?? ""));
      for (const literal of literals) {
        if (literal !== Number(row.derived)) problems.push(`${row.count}: derived ${row.derived}, its pin holds ${literal}`);
        if (literal !== D9[row.count]) problems.push(`${row.count}: the pin holds ${literal}, the earlier task left ${D9[row.count]} (STOP)`);
      }
    }
    expect(problems).toEqual([]);
    expect(Object.keys(D9).sort()).toEqual(Object.entries(COUNT_PINS).filter(([, pin]) => pin !== null).map(([id]) => id).sort());
    expect(rows.find((row) => row.count === "agent-exposed-tier-3-tools")?.derived).toBe("0");
  });

  it("9. each superseded hand-written line still holds its stale value, which differs from the derived one (D24-38's counterexample); the check bites on a line that states the derived value or none", () => {
    const table = records(tableUnder(committed("current-system-map.md"), "2. Superseded hand-written pages"));
    const derivedOf = new Map(records(tableUnder(committed("current-system-map.md"), "1. Counts")).map((row) => [row.count, row.derived] as const));
    expect(new Set(SUPERSEDED_LINES.map((entry) => `${entry.path}:${entry.line}`))).toEqual(new Set(["artifacts/ai-control-plane-b16-1c/current-prompt-to-gerber-map.md:18", "artifacts/ai-control-plane-b18/permission-tiers.md:30", "artifacts/ai-control-plane-b18/permission-tiers.md:37", "artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md:14", "artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md:16", "artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md:17"]));
    const problems: string[] = [];
    SUPERSEDED_LINES.forEach((entry, index) => {
      const derived = entry.derived.map((id) => derivedOf.get(id) ?? "?").join("/");
      const line = readRepo(entry.path).split(NEWLINE)[entry.line - 1] ?? "";
      const problem = supersededProblem(line, entry.pattern, derived);
      if (problem !== null) problems.push(`${entry.path}:${entry.line} ${entry.quantity}: ${problem}`);
      const row = table[index];
      if (row?.["path:line"] !== `${entry.path}:${entry.line}` || row["stale value"] !== entry.pattern.exec(line)?.slice(1).join("/") || row["derived value"] !== derived) problems.push(`${entry.path}:${entry.line} ${entry.quantity}: the page's row`);
      // the bite: the same line stating the derived value, or no value, is reported
      const stale = entry.pattern.exec(line);
      if (stale !== null) {
        let restated = line;
        const values = derived.split("/");
        stale.slice(1).forEach((value, at) => { restated = restated.replace(new RegExp(`\\b${value}\\b`), values[at] ?? value); });
        if (supersededProblem(restated, entry.pattern, derived) === null) problems.push(`${entry.path}:${entry.line}: restating the derived value is not reported`);
      }
      if (supersededProblem("", entry.pattern, derived) === null) problems.push(`${entry.path}:${entry.line}: an empty line is not reported`);
    });
    expect(problems).toEqual([]);
  });

  it("10. no output carries a closeout note prefix or tag, a closeout tripwire's claim word, B23's control name or retired title, or B20's stale proposal phrase; the two CSVs carry no note prefix, tag or stale phrase", () => {
    const problems: string[] = [];
    for (const file of B24_MAP_FILES) {
      const text = committed(file);
      if (text.length === 0) problems.push(`${file}: absent`);
      for (const [what, pattern] of file.endsWith(".md") ? FORBIDDEN_IN_PAGES : FORBIDDEN_IN_CSVS) if (pattern.test(text)) problems.push(`${file}: ${what}`);
    }
    expect(problems).toEqual([]);
    // the scan bites: each kind is found in a planted text of its own
    const PLANTED = [["[superseded 2026-10-02 by the B22 clos", "eout (D22-16): x]"].join(""), ["[B23 clos", "eout, 2026-10-05] retitled"].join(""), ["the", ["single", "agent"].join("-"), "loop"].join(" "), ["Send", "to", "fab"].join(" "), ["only the CSV", "generator reads the registry"].join(" "), ["B4 inert", "proposals"].join(" ")];
    expect(FORBIDDEN_IN_PAGES.map(([, pattern], index) => pattern.test(PLANTED[index]!))).toEqual(FORBIDDEN_IN_PAGES.map(() => true));
  });
});

