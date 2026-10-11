/**
 * [B24-F] D24-37, D24-38, OD-220 - the derived maps of the final product verdict, rendered from the tree:
 *
 *   pnpm exec tsx scripts/generate-b24-maps.ts
 *
 * Writes six files to artifacts/ai-control-plane-b24/: trust-boundary-map.md, current-system-map.md, coverage-matrix.csv,
 * agent-graph.md, permission-autonomy-matrix.csv and generator-inventory.md. The B20-B2 pattern (`generate-b16-0-7-artifacts.ts`):
 * every render is a pure exported function of `rootDir` (tree reads only, sorted rows, LF, no timestamp), and a file is written only
 * when this module runs as a script. `b24-f-maps` byte-pins the six files and checks this script's text (no environment, clock,
 * randomness, network, process, thread or database module, no version-control call, no test module); `b24-f-generator-inventory`
 * checks the inventory against the tree and the workflows.
 *
 * Text rules (OD-220): a Markdown map carries ids, closed-vocabulary values, numbers and paths only - no evidence string, note, reason,
 * title or control label from code (a cell that would hold a `|` or a line break refuses the render). Free text goes only into the two
 * CSVs. Route forms come from the byte-pinned route-wrapper matrix (B16.0.7), never from a test helper (lead decision D17); the B23
 * provider registry is read from its byte-pinned CSV; the process spawners and the provider SDK importers are derived by the rules of
 * the gates that pin them, and the suites compare both with those pins.
 * [B24-F review, 2026-10-10] correctness-7: the inventory's pinning suites, each suite's check and each output's pin class are derived
 * from the test files' text (`pinningSuitesByOutput`, `suiteChecker`); only the outputs are listed here. security-3: the permission
 * matrix carries the registry's role gate (`role_permitted`) beside the tier function's decision.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import ts from "typescript";
import { allRoutePolicies } from "../app/lib/auth/route-policy";
import { routeResourceClassification } from "../app/lib/auth/route-resource-classification";
import { listRouteFiles } from "../app/lib/auth/route-tree";
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE } from "../app/lib/engineering/action-registry";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "../app/lib/engineering/agent-exposure";
import { classifyControlSites } from "../app/lib/engineering/control-registry";
import { scanControlSites } from "../app/lib/engineering/control-surface";
import { GRANTED_EXECUTION_TOOLS } from "../app/lib/engineering/granted-execution-families";
import { INTENTIONAL_MCP_EXPOSED_TOOL_IDS } from "../app/lib/engineering/mcp-exposure-review";
import { AUTONOMY_MODES, decideAgentExecution, defaultAutonomySetting, permissionTierOfAction, permissionTierOfDescriptor, type AgentAutonomySetting } from "../app/lib/engineering/permission-tiers";
import { sirkitToolRegistry } from "../app/lib/engineering/tool-catalog";
import type { ProjectRole } from "../app/lib/engineering/types";
import { SPECIALIST_ROLES } from "../app/lib/agent/orchestration/contracts";
import { MERGE_DECISION_PRECEDENCE, MERGE_RULES } from "../app/lib/agent/orchestration/merge";
import { INTENTIONAL_ROLE_TOOL_IDS, PROPOSING_ROLES } from "../app/lib/agent/orchestration/role-tools";
import { DAG_ROLE_LISTS, FULL_CIRCUIT_TRIM, ROUTER_RULES } from "../app/lib/agent/orchestration/router";
import { SPECIALIST_CAPS } from "../app/lib/agent/orchestration/scheduler";
import { SOURCE_IDS, SOURCE_REGISTRY } from "../app/lib/acquisition/source-registry";
import { MCP_SERVER_REGISTRY } from "../app/lib/mcp/server-registry";
import { LLM_PROVIDER_IDS } from "../app/lib/llm/types";

const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
/** Where the six maps live (repository-relative). */
export const B24_MAPS_DIR = "artifacts/ai-control-plane-b24";
/** The six outputs, in render order. */
export const B24_MAP_FILES = Object.freeze(["trust-boundary-map.md", "current-system-map.md", "coverage-matrix.csv", "agent-graph.md", "permission-autonomy-matrix.csv", "generator-inventory.md"] as const);
export type B24MapFile = (typeof B24_MAP_FILES)[number];
/** The seven members of `ProjectRole` (a type only, `app/lib/engineering/types.ts:15`): declared here, pinned to the union by `b24-f-maps` 6. */
export const PERMISSION_MATRIX_ROLES = Object.freeze(["viewer", "commenter", "pcb_editor", "automation", "reviewer", "project_admin", "migration_admin"] as const satisfies readonly ProjectRole[]);
/** The three settings of the permission matrix: the two autonomy modes, and `unavailable` (no setting, `null`). */
export const PERMISSION_MATRIX_SETTINGS = Object.freeze([...AUTONOMY_MODES, "unavailable"] as const);

const WRAPPER_MATRIX = "artifacts/ai-control-plane-b16-0-7/route-wrapper-matrix.csv";
const B23_REGISTRY_CSV = "artifacts/ai-control-plane-b23/provider-registry.csv";
const CONTROL_SUMMARY = "artifacts/ai-control-plane-b17/ui-control-inventory-summary.json";
const WORKFLOW_DETERMINISTIC = ".github/workflows/deterministic-manufacturing.yml";
const WORKFLOW_BENCHMARK = ".github/workflows/benchmark.yml";
const PACKAGE_FILE = "package.json";
const LEDGER = "artifacts/remaining-builder-program/EXECUTION_LEDGER.md";

// ── tree reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const toPosix = (path: string): string => path.split(sep).join("/");
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort(byCodePoint);
const readText = (rootDir: string, path: string): string => readFileSync(join(rootDir, ...path.split("/")), "utf8").split(`${CR}${NEWLINE}`).join(NEWLINE);
const lineOf = (rootDir: string, path: string, line: number): string => readText(rootDir, path).split(NEWLINE)[line - 1] ?? "";
const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;

/** Every source file under `dir` (repository-relative), skipping tests' directories, dependencies and dot directories, sorted. */
function productionSources(rootDir: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (relativeDir: string): void => {
    const full = join(rootDir, ...relativeDir.split("/"));
    if (!existsSync(full)) return;
    for (const entry of readdirSync(full)) {
      if (entry === "__tests__" || entry === "node_modules" || entry.startsWith(".")) continue;
      const path = `${relativeDir}/${entry}`;
      if (statSync(join(full, entry)).isDirectory()) walk(path);
      else if (SOURCE_FILE.test(entry)) out.push(path);
    }
  };
  walk(dir);
  return out.sort(byCodePoint);
}

/** Every test file under app/ (inside a `__tests__` directory, `.test.ts(x)`), sorted. */
function testFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (relativeDir: string): void => {
    for (const entry of readdirSync(join(rootDir, ...relativeDir.split("/")))) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const path = `${relativeDir}/${entry}`;
      if (statSync(join(rootDir, ...path.split("/"))).isDirectory()) walk(path);
      else if (/\.test\.tsx?$/.test(entry) && path.includes("/__tests__/")) out.push(path);
    }
  };
  walk("app");
  return out.sort(byCodePoint);
}

const parse = (path: string, text: string): ts.SourceFile => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** A file's module specifiers: imports, re-exports, `require(...)` and `import(...)` with a static string; `typeOnly` marks an `import type`. */
function moduleSpecifiers(path: string, text: string): Array<{ readonly specifier: string; readonly typeOnly: boolean }> {
  const found: Array<{ specifier: string; typeOnly: boolean }> = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = ts.isImportDeclaration(node) ? Boolean(node.importClause?.isTypeOnly) : node.isTypeOnly;
      found.push({ specifier: node.moduleSpecifier.text, typeOnly });
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]!) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      found.push({ specifier: (node.arguments[0] as ts.StringLiteralLike).text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(path, text));
  return found;
}

/** A cell of a Markdown map: ids, closed values, numbers and paths only - a `|` or a line break is free text and refuses the render. */
function cell(value: string | number | boolean): string {
  const text = String(value);
  if (text.includes("|") || text.includes(NEWLINE) || text.includes(CR)) throw new Error(`B24_MAP_FREE_TEXT: ${text.slice(0, 60)}`);
  return text === "" ? "-" : text;
}
const tableRow = (cells: ReadonlyArray<string | number | boolean>): string => `| ${cells.map(cell).join(" | ")} |`;
const table = (header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | boolean>>): string[] => [tableRow(header), `|${header.map(() => "---|").join("")}`, ...rows.map(tableRow)];
const csvCell = (value: string | number | boolean): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.split('"').join('""')}"` : text;
};
const csvLine = (cells: ReadonlyArray<string | number | boolean>): string => cells.map(csvCell).join(",");
const page = (lines: readonly string[]): string => `${lines.join(NEWLINE)}${NEWLINE}`;
const provenance = (render: string): string => `Generated by \`scripts/generate-b24-maps.ts\` (\`${render}\`); byte-pinned by \`b24-f-maps\`; never edited by hand.`;

/** A minimal CSV reader (quoted cells, doubled quotes, LF rows). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(value); value = ""; }
    else if (char === NEWLINE) { row.push(value); rows.push(row); row = []; value = ""; }
    else if (char !== CR) value += char;
  }
  if (value !== "" || row.length > 0) { row.push(value); rows.push(row); }
  return rows;
}

// ── the derivations ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The route census from the byte-pinned route-wrapper matrix (B16.0.7): every method with its form. */
export function routeCensus(rootDir: string): { readonly total: number; readonly canonical: number; readonly factories: number; readonly raw: number; readonly methods: readonly string[] } {
  const [header, ...rows] = parseCsv(readText(rootDir, WRAPPER_MATRIX));
  const method = header!.indexOf("method"), route = header!.indexOf("route"), form = header!.indexOf("current_form");
  if (method < 0 || route < 0 || form < 0) throw new Error("B24_MAP_WRAPPER_MATRIX: the header lost a column");
  const forms = rows.map((cells) => cells[form]!);
  const count = (value: string): number => forms.filter((entry) => entry === value).length;
  return { total: rows.length, canonical: count("canonical-wrapper"), factories: count("factory"), raw: rows.length - count("canonical-wrapper") - count("factory"), methods: rows.map((cells) => `${cells[method]} ${cells[route]}`).sort(byCodePoint) };
}

/** The node modules that start a process or a thread, or compile code (`b20-b4-process-gate`'s PROCESS_MODULE). */
const PROCESS_MODULE = /^(?:node:)?(?:child_process|worker_threads|cluster|vm|module)(?:\/|$)/;
/** The process and thread starters under app/: the production files whose run-time module references name a process, thread or vm
 *  module (the reference half of `b20-b4-process-gate` case 1's rule; a type-only import is erased). */
export function processSpawners(rootDir: string): string[] {
  return productionSources(rootDir, "app").filter((path) => moduleSpecifiers(path, readText(rootDir, path)).some((entry) => !entry.typeOnly && PROCESS_MODULE.test(entry.specifier)));
}

/** The provider SDK specifiers (`b21-a-import-gates`' SDK_SPECIFIER). */
const SDK_MODULE = /^(?:openai|@anthropic-ai\/sdk)(?:\/.*)?$/;
const PRODUCTION_ROOTS = ["app", "lib", "components", "scripts", "e2e", "e2e-orchestration", "e2e-production-auth"] as const;
/** Every production source that references a provider SDK module, type-only references included (`b21-a-import-gates` case 1's rule). */
export function sdkImporters(rootDir: string): string[] {
  return PRODUCTION_ROOTS.flatMap((dir) => productionSources(rootDir, dir)).filter((path) => moduleSpecifiers(path, readText(rootDir, path)).some((entry) => SDK_MODULE.test(entry.specifier))).sort(byCodePoint);
}

/** A same-module string constant's value: `const NAME = "..."` (or a template with no substitution, `as const` allowed). */
function stringConstants(file: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      let value: ts.Expression = node.initializer;
      while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value)) value = value.expression;
      if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) constants.set(node.name.text, value.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return constants;
}

/** The durable aggregate types: every `aggregateType:` operand of an object literal in production code under app/ and lib/, resolved
 *  to a string literal or a same-module string constant; any other operand is `UNRESOLVED <file>:<line>`, never dropped. */
export function durableAggregateTypes(rootDir: string): { readonly resolved: ReadonlyArray<readonly [string, readonly string[]]>; readonly unresolved: readonly string[] } {
  const byType = new Map<string, Set<string>>();
  const unresolved: string[] = [];
  for (const path of [...productionSources(rootDir, "app"), ...productionSources(rootDir, "lib")]) {
    const text = readText(rootDir, path);
    if (!text.includes("aggregateType")) continue;
    const file = parse(path, text);
    const constants = stringConstants(file);
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === "aggregateType") {
        let operand: ts.Expression = node.initializer;
        while (ts.isAsExpression(operand) || ts.isParenthesizedExpression(operand)) operand = operand.expression;
        const value = ts.isStringLiteral(operand) || ts.isNoSubstitutionTemplateLiteral(operand) ? operand.text : ts.isIdentifier(operand) ? constants.get(operand.text) : undefined;
        if (value === undefined) unresolved.push(`${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`);
        else byType.set(value, (byType.get(value) ?? new Set<string>()).add(path));
      } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === "aggregateType") {
        unresolved.push(`${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  const byPlace = (a: string, b: string): number => {
    const [pathA, lineA] = [a.slice(0, a.lastIndexOf(":")), Number(a.slice(a.lastIndexOf(":") + 1))];
    const [pathB, lineB] = [b.slice(0, b.lastIndexOf(":")), Number(b.slice(b.lastIndexOf(":") + 1))];
    return byCodePoint(pathA, pathB) || lineA - lineB;
  };
  return { resolved: [...byType].sort(([a], [b]) => byCodePoint(a, b)).map(([type, paths]) => [type, sortedUnique(paths)] as const), unresolved: unresolved.sort(byPlace) };
}

/** The PostgreSQL tables the migrations create (`drizzle/*.sql`), each with the first migration that names it. */
export function migrationTables(rootDir: string): { readonly migrations: readonly string[]; readonly tables: ReadonlyArray<readonly [string, string]> } {
  const migrations = readdirSync(join(rootDir, "drizzle")).filter((name) => name.endsWith(".sql") && statSync(join(rootDir, "drizzle", name)).isFile()).sort(byCodePoint);
  const first = new Map<string, string>();
  for (const name of migrations) {
    for (const match of readText(rootDir, `drizzle/${name}`).matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[A-Za-z_][\w]*)(?:\.("[^"]+"|[A-Za-z_][\w]*))?/gi)) {
      const table = (match[2] ?? match[1]!).split('"').join("");
      if (!first.has(table)) first.set(table, `drizzle/${name}`);
    }
  }
  return { migrations: migrations.map((name) => `drizzle/${name}`), tables: [...first].sort(([a], [b]) => byCodePoint(a, b)) };
}

/** The browser stores: every `*-idb.ts` module in production code. */
export function browserStores(rootDir: string): string[] {
  return PRODUCTION_ROOTS.flatMap((dir) => productionSources(rootDir, dir)).filter((path) => /-idb\.ts$/.test(path)).sort(byCodePoint);
}

/** The reviewed agent-facing tool counts, from the registry and the two reviewed lists. */
export function toolCounts(): { readonly registry: number; readonly agentExposed: number; readonly mcpExposed: number; readonly agentOnly: number; readonly granted: number; readonly proposals: number; readonly byTier: readonly number[] } {
  const tools = sirkitToolRegistry().list();
  const exposed = tools.filter((tool) => tool.agentExposed);
  const byTier = [0, 1, 2, 3].map((tier) => exposed.filter((tool) => permissionTierOfDescriptor(tool) === tier).length);
  const agentOnly = INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.filter((id) => !INTENTIONAL_MCP_EXPOSED_TOOL_IDS.includes(id)).length;
  return { registry: tools.length, agentExposed: INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length, mcpExposed: INTENTIONAL_MCP_EXPOSED_TOOL_IDS.length, agentOnly, granted: GRANTED_EXECUTION_TOOLS.length, proposals: exposed.filter((tool) => tool.operationClass === "propose").length, byTier };
}

/** The classified control sites (B17-A's scanner and rules). */
function classifiedControls(rootDir: string) {
  const { classified, unmatched } = classifyControlSites(scanControlSites(rootDir));
  if (unmatched.length > 0) throw new Error(`B24_MAP_UNCLASSIFIED_CONTROLS: ${unmatched.length}`);
  return [...classified].sort((a, b) => byCodePoint(a.key, b.key));
}

/** The generators: every `scripts/generate-*.ts` and `scripts/gen-*.ts`. */
export function generatorScripts(rootDir: string): string[] {
  return readdirSync(join(rootDir, "scripts")).filter((name) => /^(?:generate|gen)-.+\.ts$/.test(name)).map((name) => `scripts/${name}`).sort(byCodePoint);
}

// ── trust-boundary-map.md ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** trust-boundary-map.md: every route row joined with its resource classification, then the spawners, the SDK importers, the external
 *  providers by registry and the stores. */
export function renderTrustBoundaryMap(rootDir: string): string {
  const classification = new Map(routeResourceClassification().map((row) => [`${row.method} ${row.path}`, row] as const));
  const routes = [...allRoutePolicies()].sort((a, b) => byCodePoint(a.path, b.path) || byCodePoint(a.method, b.method)).map((policy) => {
    const row = classification.get(`${policy.method} ${policy.path}`);
    if (row === undefined) throw new Error(`B24_MAP_UNCLASSIFIED_ROUTE: ${policy.method} ${policy.path}`);
    return [policy.method, policy.path, policy.authClass, policy.identitySource, policy.permittedRoles.join(";"), policy.requiresCsrf, policy.providerCredit, policy.authoritativeWrite, policy.releaseOrQualification, policy.externalTransfer, policy.spend, row.externalProcess === "" ? "none" : row.externalProcess, row.outboundEgress, row.modelEgress, row.durableAccess];
  });
  const providerCsv = parseCsv(readText(rootDir, B23_REGISTRY_CSV));
  const providerHeader = providerCsv[0]!;
  const column = (name: string): number => {
    const index = providerHeader.indexOf(name);
    if (index < 0) throw new Error(`B24_MAP_B23_REGISTRY_CSV: no ${name} column`);
    return index;
  };
  const providers = providerCsv.slice(1).filter((cells) => cells.length === providerHeader.length).map((cells) => [cells[column("id")]!, cells[column("kind")]!, cells[column("api_access")]!, cells[column("enabled_feature_tier")]!, cells[column("registry_version")]!]);
  const aggregates = durableAggregateTypes(rootDir);
  const { tables } = migrationTables(rootDir);
  return page([
    "# B24-F - Trust-boundary map",
    "",
    provenance("renderTrustBoundaryMap"),
    "",
    `## 1. Routes (${routes.length} rows: \`allRoutePolicies()\` joined with \`routeResourceClassification()\`)`,
    "",
    ...table(["method", "path", "authClass", "identitySource", "permittedRoles", "requiresCsrf", "providerCredit", "authoritativeWrite", "releaseOrQualification", "externalTransfer", "spend", "externalProcess", "outboundEgress", "modelEgress", "durableAccess"], routes),
    "",
    "## 2. Process and thread starters under app/ (the reference rule of `b20-b4-process-gate` case 1)",
    "",
    ...table(["#", "path"], processSpawners(rootDir).map((path, index) => [index + 1, path])),
    "",
    "## 3. Provider SDK importers (the rule of `b21-a-import-gates` case 1)",
    "",
    ...table(["#", "path"], sdkImporters(rootDir).map((path, index) => [index + 1, path])),
    "",
    "## 4. External providers by registry",
    "",
    "### 4.1 LLM providers (`LLM_PROVIDER_IDS`, `app/lib/llm/types.ts`)",
    "",
    ...table(["#", "provider"], LLM_PROVIDER_IDS.map((id, index) => [index + 1, id])),
    "",
    "### 4.2 B19 acquisition sources (`SOURCE_REGISTRY`, `app/lib/acquisition/source-registry.ts`)",
    "",
    ...table(["id", "status"], SOURCE_IDS.map((id) => [id, SOURCE_REGISTRY[id].state.status])),
    "",
    `### 4.3 B20 MCP servers (\`MCP_SERVER_REGISTRY\`, \`app/lib/mcp/server-registry.ts\`): ${MCP_SERVER_REGISTRY.length} rows`,
    "",
    ...table(["id", "status"], MCP_SERVER_REGISTRY.map((entry) => [entry.id, entry.state.status])),
    "",
    `### 4.4 B23 manufacturing providers (\`${B23_REGISTRY_CSV}\`, byte-pinned): ${providers.length} rows`,
    "",
    ...table(["id", "kind", "api_access", "enabled_feature_tier", "registry_version"], providers),
    "",
    "## 5. Stores",
    "",
    `### 5.1 Durable aggregate types (\`aggregateType:\` operands under app/ and lib/): ${aggregates.resolved.length} resolved, ${aggregates.unresolved.length} unresolved`,
    "",
    ...table(["aggregate type", "modules"], aggregates.resolved.map(([type, paths]) => [type, paths.join(", ")])),
    "",
    ...table(["UNRESOLVED operand"], aggregates.unresolved.map((at) => [`UNRESOLVED ${at}`])),
    "",
    `### 5.2 PostgreSQL tables (\`CREATE TABLE\` in \`drizzle/*.sql\`): ${tables.length}`,
    "",
    ...table(["table", "first migration"], tables),
    "",
    "### 5.3 Browser IndexedDB stores (`*-idb.ts`)",
    "",
    ...table(["#", "path"], browserStores(rootDir).map((path, index) => [index + 1, path])),
  ]);
}

// ── current-system-map.md ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The one test file under app/ with this file name (a pin or a pinning suite is named by its file name and found in the tree). */
export function resolveTestFile(rootDir: string, name: string, files: readonly string[] = testFiles(rootDir)): string {
  const found = files.filter((path) => path.endsWith(`/${name}`));
  if (found.length !== 1) throw new Error(`B24_MAP_TEST_FILE: ${name} is ${found.length} files`);
  return found[0]!;
}

/** Where each count's literal pin sits: a test file by name (or a repository path) and its line; `null` is derived, unpinned. */
export const COUNT_PINS: Readonly<Record<string, readonly [file: string, lines: readonly number[]] | null>> = Object.freeze({
  "route-methods": ["b16-1c-invariant-tripwires.test.ts", [48]],
  "canonical-wrappers": ["b16-1c-invariant-tripwires.test.ts", [48]],
  "approved-factories": ["b16-1c-invariant-tripwires.test.ts", [48]],
  "raw-handlers": ["b16-1c-invariant-tripwires.test.ts", [48]],
  "registry-tools": ["b20-c1-three-way-parity.test.ts", [241]],
  "agent-exposed-tools": ["b20-c1-three-way-parity.test.ts", [241]],
  "mcp-exposed-tools": ["b20-c1-three-way-parity.test.ts", [241]],
  "agent-only-tools": ["b20-c1-three-way-parity.test.ts", [241]],
  "granted-tier-1-tools": null,
  "agent-exposed-proposal-tools": null,
  "agent-exposed-tier-0-tools": null,
  "agent-exposed-tier-1-tools": null,
  "agent-exposed-tier-2-tools": null,
  "agent-exposed-tier-3-tools": null,
  "action-records": ["b23-a-tier3-vocabulary.test.ts", [272]],
  "control-sites": [CONTROL_SUMMARY, [3]],
  "control-surfaces": [CONTROL_SUMMARY, [4]],
  "route-files": null,
  "b01-route-paths": null,
  "sql-migrations": ["b16-b-migrations.test.ts", [39, 119]],
  "postgres-tables": null,
  "process-spawners": ["b20-b4-process-gate.test.ts", [40]],
  "provider-sdk-importers": ["b21-a-import-gates.test.ts", [91]],
  generators: null,
});

/** Every reviewed count, derived from code, in the page's order. */
export function currentSystemCounts(rootDir: string): ReadonlyArray<readonly [id: string, value: number]> {
  const census = routeCensus(rootDir);
  const tools = toolCounts();
  const controls = classifiedControls(rootDir);
  const { migrations, tables } = migrationTables(rootDir);
  return [
    ["route-methods", census.total], ["canonical-wrappers", census.canonical], ["approved-factories", census.factories], ["raw-handlers", census.raw],
    ["registry-tools", tools.registry], ["agent-exposed-tools", tools.agentExposed], ["mcp-exposed-tools", tools.mcpExposed], ["agent-only-tools", tools.agentOnly],
    ["granted-tier-1-tools", tools.granted], ["agent-exposed-proposal-tools", tools.proposals],
    ["agent-exposed-tier-0-tools", tools.byTier[0]!], ["agent-exposed-tier-1-tools", tools.byTier[1]!], ["agent-exposed-tier-2-tools", tools.byTier[2]!], ["agent-exposed-tier-3-tools", tools.byTier[3]!],
    ["action-records", ACTION_COVERAGE_REGISTRY.length],
    ["control-sites", controls.length], ["control-surfaces", new Set(controls.map((row) => row.surface)).size],
    ["route-files", listRouteFiles(rootDir).length], ["b01-route-paths", new Set(API_ROUTE_COVERAGE.map((entry) => entry.path)).size],
    ["sql-migrations", migrations.length], ["postgres-tables", tables.length],
    ["process-spawners", processSpawners(rootDir).length], ["provider-sdk-importers", sdkImporters(rootDir).length],
    ["generators", generatorScripts(rootDir).length],
  ];
}

/** The hand-written lines a derived count supersedes (D24-38): each line's stale value is read from the line by `pattern`. */
export const SUPERSEDED_LINES: ReadonlyArray<{ readonly path: string; readonly line: number; readonly quantity: string; readonly pattern: RegExp; readonly derived: readonly string[]; readonly mapping: "CONFIRMED" | "INFERRED" }> = Object.freeze([
  { path: "artifacts/ai-control-plane-b16-1c/current-prompt-to-gerber-map.md", line: 18, quantity: "route-census", pattern: /the (\d+) route methods \((\d+) canonical wrappers, (\d+) factories, (\d+) raw\)/, derived: ["route-methods", "canonical-wrappers", "approved-factories", "raw-handlers"], mapping: "CONFIRMED" },
  { path: "artifacts/ai-control-plane-b16-1c/current-prompt-to-gerber-map.md", line: 18, quantity: "agent-exposed-tools", pattern: /the (\d+) agent-exposed tools/, derived: ["agent-exposed-tools"], mapping: "CONFIRMED" },
  { path: "artifacts/ai-control-plane-b18/permission-tiers.md", line: 30, quantity: "route-census", pattern: /moved \d+ \S+ (\d+) methods \((\d+) canonical \+ (\d+) factories \+ \*\*(\d+) raw\*\*\)/, derived: ["route-methods", "canonical-wrappers", "approved-factories", "raw-handlers"], mapping: "CONFIRMED" },
  { path: "artifacts/ai-control-plane-b18/permission-tiers.md", line: 37, quantity: "route-census", pattern: /\((\d+) = (\d+) \+ (\d+) \+ (\d+)\)/, derived: ["route-methods", "canonical-wrappers", "approved-factories", "raw-handlers"], mapping: "CONFIRMED" },
  { path: "artifacts/ai-control-plane-b18/permission-tiers.md", line: 37, quantity: "action-records", pattern: /\((\d+) records, \d+ routes\)/, derived: ["action-records"], mapping: "CONFIRMED" },
  { path: "artifacts/ai-control-plane-b18/permission-tiers.md", line: 37, quantity: "b01-route-paths", pattern: /\(\d+ records, (\d+) routes\)/, derived: ["b01-route-paths"], mapping: "INFERRED" },
  { path: "artifacts/ai-control-plane-b18/permission-tiers.md", line: 37, quantity: "control-sites-and-surfaces", pattern: /\((\d+) \/ (\d+) unchanged\)/, derived: ["control-sites", "control-surfaces"], mapping: "CONFIRMED" },
  { path: "artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md", line: 14, quantity: "sql-migrations", pattern: /\| Migrations applied \| (\d+) \(/, derived: ["sql-migrations"], mapping: "CONFIRMED" },
  { path: "artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md", line: 16, quantity: "sql-migrations", pattern: /for all (\d+) files/, derived: ["sql-migrations"], mapping: "CONFIRMED" },
  { path: "artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md", line: 17, quantity: "sql-migrations", pattern: /\| Ledger rows \| (\d+),/, derived: ["sql-migrations"], mapping: "CONFIRMED" },
]);

/** Each superseded line's stale value (as the line holds it) beside the derived one; a line that no longer holds its pattern refuses. */
export function supersededValues(rootDir: string, counts: ReadonlyArray<readonly [string, number]> = currentSystemCounts(rootDir)): ReadonlyArray<readonly [path: string, line: number, quantity: string, stale: string, derived: string, mapping: string]> {
  const value = new Map(counts);
  return SUPERSEDED_LINES.map((entry) => {
    const match = entry.pattern.exec(lineOf(rootDir, entry.path, entry.line));
    if (match === null) throw new Error(`B24_MAP_SUPERSEDED_LINE: ${entry.path}:${entry.line} no longer holds its ${entry.quantity}`);
    return [entry.path, entry.line, entry.quantity, match.slice(1).join("/"), entry.derived.map((id) => String(value.get(id))).join("/"), entry.mapping] as const;
  });
}

/** current-system-map.md: every reviewed count derived from code beside its pin, then the superseded hand-written lines. */
export function renderCurrentSystemMap(rootDir: string): string {
  const files = testFiles(rootDir);
  const counts = currentSystemCounts(rootDir);
  const pinOf = (id: string): string => {
    const pin = COUNT_PINS[id];
    if (pin === undefined) throw new Error(`B24_MAP_COUNT_PIN: ${id} has no pin entry`);
    if (pin === null) return "derived, unpinned";
    const [file, lines] = pin;
    const path = file.includes("/") ? file : resolveTestFile(rootDir, file, files);
    return `${path}:${lines.join(", :")}`;
  };
  return page([
    "# B24-F - Current-system map",
    "",
    provenance("renderCurrentSystemMap"),
    "",
    "## 1. Counts, each derived from code",
    "",
    ...table(["count", "derived", "pin"], counts.map(([id, value]) => [id, value, pinOf(id)])),
    "",
    "## 2. Superseded hand-written pages (D24-38)",
    "",
    ...table(["path:line", "quantity", "stale value", "derived value", "mapping"], supersededValues(rootDir, counts).map(([path, line, quantity, stale, derived, mapping]) => [`${path}:${line}`, quantity, stale, derived, mapping])),
  ]);
}

// ── coverage-matrix.csv ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The specialist roles whose reviewed row holds a tool. */
function specialistRolesOf(toolId: string): string[] {
  return SPECIALIST_ROLES.filter((role) => INTENTIONAL_ROLE_TOOL_IDS[role].includes(toolId));
}

/** coverage-matrix.csv: control -> record -> command -> tool -> agent exposure -> role -> MCP exposure -> tier. Rows: every classified
 *  site x record x owning tool, every record no site reaches, every tool whose owning command is no record. */
export function renderCoverageMatrix(rootDir: string): string {
  const records = new Map(ACTION_COVERAGE_REGISTRY.map((record) => [record.id, record] as const));
  const tools = [...sirkitToolRegistry().list()].sort((a, b) => byCodePoint(a.toolId, b.toolId));
  const toolsOf = (recordId: string) => tools.filter((tool) => tool.owningCommandId === recordId);
  const header = ["control_key", "control_surface", "control_class", "record_id", "command", "tool_id", "agent_exposed", "required_roles", "specialist_roles", "mcp_exposed", "record_tier", "tool_tier"];
  const rows: string[] = [csvLine(header)];
  const recordCells = (recordId: string): string[] => {
    const record = records.get(recordId);
    return [recordId, record?.domainCommand ?? "-"];
  };
  const toolCells = (tool: (typeof tools)[number] | null): Array<string | number | boolean> => tool === null
    ? ["-", "-", "-", "-", "-"]
    : [tool.toolId, tool.agentExposed, tool.requiredRoles.join(";") || "-", specialistRolesOf(tool.toolId).join(";") || "-", INTENTIONAL_MCP_EXPOSED_TOOL_IDS.includes(tool.toolId)];
  const tierOf = (recordId: string): string => {
    const record = records.get(recordId);
    return record === undefined ? "-" : String(permissionTierOfAction(record));
  };
  const reached = new Set<string>();
  for (const site of classifiedControls(rootDir)) {
    const ids = site.recordIds.length > 0 ? [...site.recordIds] : ["-"];
    for (const recordId of ids) {
      if (recordId !== "-") reached.add(recordId);
      const owned = recordId === "-" ? [] : toolsOf(recordId);
      for (const tool of owned.length > 0 ? owned : [null]) {
        rows.push(csvLine([site.key, site.surface, site.classification, ...(recordId === "-" ? ["-", "-"] : recordCells(recordId)), ...toolCells(tool), recordId === "-" ? "-" : tierOf(recordId), tool === null ? "-" : permissionTierOfDescriptor(tool)]));
      }
    }
  }
  for (const record of [...ACTION_COVERAGE_REGISTRY].sort((a, b) => byCodePoint(a.id, b.id))) {
    if (reached.has(record.id)) continue;
    const owned = toolsOf(record.id);
    for (const tool of owned.length > 0 ? owned : [null]) rows.push(csvLine(["-", "-", "-", ...recordCells(record.id), ...toolCells(tool), tierOf(record.id), tool === null ? "-" : permissionTierOfDescriptor(tool)]));
  }
  for (const tool of tools) if (!records.has(tool.owningCommandId)) rows.push(csvLine(["-", "-", "-", "-", "-", ...toolCells(tool), "-", permissionTierOfDescriptor(tool)]));
  return `${rows.join(NEWLINE)}${NEWLINE}`;
}

// ── agent-graph.md ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** agent-graph.md: the specialist roles, their reviewed tool rows, the DAG kinds, the router's rule ids and runbook lines, the full-circuit
 *  trim, the caps and the merge's precedence and rule ids - identifiers and numbers only (no note, summary or rule text). */
export function renderAgentGraph(rootDir: string): string {
  void rootDir;
  const roles = SPECIALIST_ROLES.map((role) => [role, PROPOSING_ROLES.includes(role), INTENTIONAL_ROLE_TOOL_IDS[role].length] as const);
  const roleTools = SPECIALIST_ROLES.flatMap((role) => [...INTENTIONAL_ROLE_TOOL_IDS[role]].sort(byCodePoint).map((toolId) => [role, toolId] as const));
  const dags = Object.entries(DAG_ROLE_LISTS).map(([kind, list]) => [kind, list.length, list.join(" -> ")] as const);
  const rules = ROUTER_RULES.map((rule, index) => [index + 1, rule.id, rule.kind, rule.runbook, rule.roles === null ? "-" : rule.roles.join(" -> ")] as const);
  const caps = Object.entries(SPECIALIST_CAPS).map(([key, value]) => [key, value] as const);
  return page([
    "# B24-F - Agent and specialist graph",
    "",
    provenance("renderAgentGraph"),
    "",
    `## 1. Specialist roles (\`SPECIALIST_ROLES\`, \`app/lib/agent/orchestration/contracts.ts\`): ${roles.length}`,
    "",
    ...table(["role", "proposing", "reviewed tools"], roles),
    "",
    `## 2. Per-role tool ids (\`INTENTIONAL_ROLE_TOOL_IDS\`, \`app/lib/agent/orchestration/role-tools.ts\`): ${roleTools.length} rows`,
    "",
    ...table(["role", "tool id"], roleTools),
    "",
    `## 3. Proposing roles (\`PROPOSING_ROLES\`): ${PROPOSING_ROLES.length}`,
    "",
    ...table(["#", "role"], PROPOSING_ROLES.map((role, index) => [index + 1, role])),
    "",
    `## 4. DAG kinds (\`DAG_ROLE_LISTS\`, \`app/lib/agent/orchestration/router.ts\`): ${dags.length}`,
    "",
    ...table(["kind", "roles", "order"], dags),
    "",
    `## 5. Router rules (\`ROUTER_RULES\`, first match wins): ${rules.length}`,
    "",
    ...table(["#", "id", "plan kind", "runbook", "roles"], rules),
    "",
    "## 6. The full-circuit trim (`FULL_CIRCUIT_TRIM`)",
    "",
    ...table(["field", "roles"], [["priority", FULL_CIRCUIT_TRIM.priority.join(" -> ")], ["foldedIntoCoordinator", FULL_CIRCUIT_TRIM.foldedIntoCoordinator.join(" -> ")], ["layoutSwap", `${FULL_CIRCUIT_TRIM.layoutSwap.replaces} -> ${FULL_CIRCUIT_TRIM.layoutSwap.by}`]]),
    "",
    "## 7. Caps (`SPECIALIST_CAPS`, `app/lib/agent/orchestration/scheduler.ts`)",
    "",
    ...table(["cap", "value"], caps),
    "",
    "## 8. Merge (`app/lib/agent/orchestration/merge.ts`)",
    "",
    `### 8.1 Decision precedence (\`MERGE_DECISION_PRECEDENCE\`): ${MERGE_DECISION_PRECEDENCE.length}`,
    "",
    ...table(["#", "decision"], MERGE_DECISION_PRECEDENCE.map((decision, index) => [index + 1, decision])),
    "",
    `### 8.2 Rules (\`MERGE_RULES\`): ${MERGE_RULES.length}`,
    "",
    ...table(["id", "runbook"], MERGE_RULES.map((rule) => [rule.id, rule.runbook])),
  ]);
}

// ── permission-autonomy-matrix.csv ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The setting a matrix row stands for: an autonomy mode, or `null` for `unavailable` (no setting). */
export function settingOf(setting: (typeof PERMISSION_MATRIX_SETTINGS)[number]): AgentAutonomySetting | null {
  if (setting === "unavailable") return null;
  return { ...defaultAutonomySetting({ tenantId: "matrix", projectId: "matrix" }), mode: setting };
}

/** permission-autonomy-matrix.csv: `decideAgentExecution` over every registry tool x the three settings x the seven roles x the
 *  explicit-request fact. [B24-F review, 2026-10-10] security-3: `role_permitted` is the registry's role gate (the tool's
 *  `requiredRoles`), which the gateway applies before the tier function; `decision` is the tier function's alone, so a row whose role is
 *  not permitted is refused before its decision is reached. */
export function renderPermissionAutonomyMatrix(rootDir: string): string {
  void rootDir;
  const header = ["tool_id", "tier", "agent_exposed", "mcp_exposed", "setting", "role", "role_permitted", "explicit_user_request", "decision", "requires_grant", "requires_human_approval"];
  const rows: string[] = [csvLine(header)];
  for (const tool of [...sirkitToolRegistry().list()].sort((a, b) => byCodePoint(a.toolId, b.toolId))) {
    const tier = permissionTierOfDescriptor(tool);
    for (const setting of PERMISSION_MATRIX_SETTINGS) {
      for (const role of PERMISSION_MATRIX_ROLES) {
        for (const explicitUserRequest of [false, true]) {
          const decision = decideAgentExecution({ tier, setting: settingOf(setting), actorRole: role, explicitUserRequest });
          rows.push(csvLine([tool.toolId, tier, tool.agentExposed, INTENTIONAL_MCP_EXPOSED_TOOL_IDS.includes(tool.toolId), setting, role, tool.requiredRoles.includes(role), explicitUserRequest, decision.decision, decision.requiresGrant, decision.requiresHumanApproval]));
        }
      }
    }
  }
  return `${rows.join(NEWLINE)}${NEWLINE}`;
}

// ── generator-inventory.md ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Each generator's outputs, reviewed at `58c0834`. [B24-F review, 2026-10-10] correctness-7: the pinning suites, each suite's check
 *  and the pin class are derived from the test files (`pinningSuitesByOutput`, `suiteChecker`), never typed here. */
export const GENERATOR_OUTPUTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "gen-demo-fixtures.ts": ["app/lib/pcb/demo/fixtures.ts"],
  "gen-silk-font.ts": ["app/lib/pcb/silk/hershey-simplex.json"],
  "generate-action-toolability-matrix.ts": ["artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv", "artifacts/ai-control-plane-b01/api-route-coverage.csv", "artifacts/ai-control-plane-b01/ui-control-fingerprint.json"],
  "generate-agent-artifacts.ts": ["artifacts/ai-control-plane-b09/agent-exposed-tool-manifest.csv", "artifacts/ai-control-plane-b09/agent-exposed-tool-manifest.json", "artifacts/ai-control-plane-b09/tool-activation-audit.csv", "artifacts/ai-control-plane-b09/provider-schema-parity.json", "artifacts/ai-control-plane-b09/normalized-loop-replay-fixtures.json"],
  "generate-b06-schematic-artifacts.ts": ["artifacts/ai-control-plane-b06/schematic-replay-fixtures.json", "artifacts/ai-control-plane-b06-1/replacement-connectivity-fixtures.json", "artifacts/ai-control-plane-b06-2/recovery-fixtures.json", "artifacts/ai-control-plane-b06-3/lineage-recovery-fixtures.json", "artifacts/ai-control-plane-b07/schematic-graph-replay-fixtures.json"],
  "generate-b10-artifacts.ts": ["artifacts/ai-control-plane-b10/runtime-tool-availability.csv"],
  "generate-b11-artifacts.ts": ["artifacts/ai-control-plane-b11/replay-trace-pins.json", "artifacts/ai-control-plane-b11/evaluation-case-matrix.csv", "artifacts/ai-control-plane-b11/evaluation-results.json"],
  "generate-b16-0-1-artifacts.ts": ["artifacts/ai-control-plane-b16-0-1/exact-route-authorization-policy.csv"],
  "generate-b16-0-2-artifacts.ts": ["artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv"],
  "generate-b16-0-4-artifacts.ts": ["artifacts/ai-control-plane-b16-0-4/method-authorization-matrix.csv", "artifacts/ai-control-plane-b16-0-4/request-body-boundary-matrix.csv"],
  "generate-b16-0-7-artifacts.ts": [WRAPPER_MATRIX],
  "generate-b16-0-8-baseline.ts": ["app/lib/auth/__tests__/_raw-route-baseline.json"],
  "generate-b16-0-artifacts.ts": ["artifacts/ai-control-plane-b16-0/auth-route-coverage.csv"],
  "generate-b17-control-inventory.ts": ["artifacts/ai-control-plane-b17/ui-control-inventory.csv", CONTROL_SUMMARY],
  "generate-b19-source-registry.ts": ["artifacts/ai-control-plane-b19/source-registry.csv"],
  "generate-b20-mcp-parity.ts": ["artifacts/ai-control-plane-b20/mcp-parity.json", "artifacts/ai-control-plane-b20/mcp-parity.md"],
  "generate-b20-mcp-server-registry.ts": ["artifacts/ai-control-plane-b20/mcp-server-registry.csv"],
  "generate-b20-mcp-tool-manifest.ts": ["artifacts/ai-control-plane-b20/mcp-tool-manifest.csv", "artifacts/ai-control-plane-b20/mcp-tool-manifest.json"],
  "generate-b21-artifacts.ts": ["artifacts/ai-control-plane-b21/evaluation-matrix.csv", "artifacts/ai-control-plane-b21/evaluation-matrix.json", "artifacts/ai-control-plane-b21/replay-trace-pins-b21.json"],
  "generate-b23-provider-registry.ts": [B23_REGISTRY_CSV],
  "generate-b24-accessible-names.ts": ["artifacts/ai-control-plane-b24/accessible-name-census.csv", "artifacts/ai-control-plane-b24/accessible-name-census-summary.json"],
  "generate-b24-eval-catalog.ts": ["artifacts/ai-control-plane-b24/eval-catalog.csv", "artifacts/ai-control-plane-b24/eval-catalog.json"],
  "generate-b24-maps.ts": B24_MAP_FILES.map((file) => `${B24_MAPS_DIR}/${file}`),
  "generate-b24-scenario-map.ts": ["artifacts/ai-control-plane-b24/scenario-map.csv", "artifacts/ai-control-plane-b24/scenario-map.json"],
  "generate-b24-threshold-census.ts": ["artifacts/ai-control-plane-b24/threshold-census.csv"],
  "generate-pcb-shape-descriptor.ts": ["app/lib/agent/generated/pcb-shape-descriptor.ts"],
  "generate-read-invocation-artifacts.ts": ["artifacts/ai-control-plane-b05/activated-read-bindings.csv", "artifacts/ai-control-plane-b05/read-replay-fixtures.json", "artifacts/ai-control-plane-b05-1/resource-consumption-matrix.csv", "artifacts/ai-control-plane-b05-1/composite-replay-fixtures.json"],
  "generate-tool-registry-artifacts.ts": ["artifacts/ai-control-plane-b04/tool-registry.csv", "artifacts/ai-control-plane-b04/non-callable-coverage.csv", "artifacts/ai-control-plane-b04/provider-schema-parity.json"],
});

// [B24-F review, 2026-10-10] correctness-7: the pinning suites, derived. A pinning suite is a test file under app/ whose text names the
// output - its repository path, its quoted path segments, its directory (a string, a string prefix or quoted segments) with its exact
// base name (quoted, or after a `/` or a `}` and before a quote), a relative import of it - or a `__tests__` helper module it imports
// that does so; the B24 maps are also named by an import of `B24_MAP_FILES` from this script.

const RELATIVE_SPECIFIER = /(?:from\s+|import\(\s*|import\s+|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
const withoutExtension = (path: string): string => path.replace(/\.(?:ts|tsx|mts|mjs|js|json)$/, "");
const relativeTargets = (path: string, text: string): string[] => [...text.matchAll(RELATIVE_SPECIFIER)].map((match) => posix.normalize(posix.join(posix.dirname(path), match[1]!)));
const splitOutput = (output: string): readonly [dir: string, base: string] => [output.slice(0, output.lastIndexOf("/")), output.slice(output.lastIndexOf("/") + 1)];
const dirNamedIn = (text: string, dir: string): boolean => [`"${dir}"`, `"${dir}/`, `\`${dir}/`, dir.split("/").map((segment) => `"${segment}"`).join(", ")].some((form) => text.includes(form));
const B24_MAPS_GENERATOR = "scripts/generate-b24-maps";

/** Whether a file's text names an output (the rule above, the file alone); `mapList`: the text names `B24_MAP_FILES`. */
function fileNamesOutput(path: string, text: string, output: string, mapList: boolean = /\bB24_MAP_FILES\b/.test(text)): boolean {
  const [dir, base] = splitOutput(output);
  if (!text.includes(withoutExtension(base)) && !mapList) return false;
  if (text.includes(output) || text.includes(output.split("/").map((segment) => `"${segment}"`).join(", "))) return true;
  if (dirNamedIn(text, dir) && ["\"", "'", "`", "/", "}"].some((before) => ["\"", "'", "`"].some((after) => text.includes(`${before}${base}${after}`)))) return true;
  const targets = relativeTargets(path, text);
  if (targets.some((target) => withoutExtension(target) === withoutExtension(output))) return true;
  return output.startsWith(`${B24_MAPS_DIR}/`) && (B24_MAP_FILES as readonly string[]).includes(base) && mapList && targets.includes(B24_MAPS_GENERATOR);
}

/** The `__tests__` helper modules a file imports (one level; never a test file). */
function testHelpersOf(rootDir: string, path: string, text: string): string[] {
  return relativeTargets(path, text).filter((target) => target.includes("/__tests__/")).map((target) => [`${target}.ts`, `${target}.tsx`].find((candidate) => !/\.test\.tsx?$/.test(candidate) && existsSync(join(rootDir, ...candidate.split("/"))))).filter((helper): helper is string => helper !== undefined);
}

/** The inventory's own suite: it names outputs only as data about this page (its anchors and bites), never to pin one, so it is no
 *  pinning suite of any output (b24-f-generator-inventory applies the same rule). */
export const INVENTORY_SUITE = "app/lib/qualification/__tests__/b24-f-generator-inventory.test.ts";

/** Each output's pinning suites (the rule above), from one read of every test file and of the helpers they import. */
export function pinningSuitesByOutput(rootDir: string, outputs: readonly string[], files: readonly string[] = testFiles(rootDir)): ReadonlyMap<string, readonly string[]> {
  const found = new Map<string, string[]>(outputs.map((output) => [output, []]));
  const helperText = new Map<string, string>();
  for (const suite of files.filter((path) => path !== INVENTORY_SUITE)) {
    const text = readText(rootDir, suite);
    const mapList = /\bB24_MAP_FILES\b/.test(text);
    const helpers = testHelpersOf(rootDir, suite, text).map((helper) => {
      if (!helperText.has(helper)) helperText.set(helper, readText(rootDir, helper));
      return [helper, helperText.get(helper)!, /\bB24_MAP_FILES\b/.test(helperText.get(helper)!)] as const;
    });
    for (const output of outputs) if (fileNamesOutput(suite, text, output, mapList) || helpers.some(([helper, source, helperMapList]) => fileNamesOutput(helper, source, output, helperMapList))) found.get(output)!.push(suite);
  }
  return found;
}

/** How a pinning suite checks an output: `bytes` - an `expect(...)` equality (`toBe`, `toStrictEqual`, `toEqual`) whose subject or
 *  expected value is the output's whole text as read (a read call of the output's path, or a call of a local function that returns
 *  that whole text; a CRLF normalisation or a `toString` allowed; never a parse, a split or a field); `digest` - an equality against a
 *  hash of that text, a hash call on the output's path, or a 64-hex pin keyed by its path; `content` - anything else that names it. */
export type SuiteCheck = "bytes" | "digest" | "content";
const READ_CALL = /^(?:readFileSync|readFile|readRepo|readRaw|readText|read)$/;
const HASH_CALL = /^(?:hashFile|sha|sha256|digestOf|fileDigest)$/;
const HEX_DIGEST = /^[0-9a-f]{64}$/;
const EQUALITY = new Set(["toBe", "toStrictEqual", "toEqual"]);
const NO_PARAMS: ReadonlySet<string> = new Set();

/** A suite's reader: parsed once, it tells how the suite checks each output (`read` reads a helper module's text by repository path). */
export function suiteChecker(path: string, text: string, read: (path: string) => string): (output: string) => SuiteCheck {
  const file = parse(path, text);
  const unwrap = (node: ts.Expression): ts.Expression => {
    let current = node;
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
    return current;
  };
  // every declaration of a name, with the node its scope spans: a variable (an initializer, or a for-of binding), an import, a function
  type Declaration = { readonly scope: ts.Node; readonly at: number; readonly init?: ts.Expression; readonly forOf?: ts.Expression; readonly element?: number; readonly importedFrom?: string; readonly importedName?: string; readonly fn?: ts.Node };
  const declarations = new Map<string, Declaration[]>();
  const add = (name: string, declaration: Declaration): void => { declarations.set(name, [...(declarations.get(name) ?? []), declaration]); };
  const scopeOf = (node: ts.Node): ts.Node => {
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isForOfStatement(parent) || ts.isForStatement(parent) || ts.isFunctionLike(parent)) return parent;
    return file;
  };
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      const forOf = ts.isVariableDeclarationList(node.parent) && ts.isForOfStatement(node.parent.parent) ? node.parent.parent : null;
      if (ts.isIdentifier(node.name)) {
        const fn = node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer : undefined;
        add(node.name.text, { scope: forOf ?? scopeOf(node), at: node.getStart(file), init: node.initializer, forOf: forOf?.expression, fn });
      } else if (ts.isArrayBindingPattern(node.name)) {
        node.name.elements.forEach((element, index) => { if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) add(element.name.text, { scope: forOf ?? scopeOf(node), at: node.getStart(file), forOf: forOf?.expression, element: index }); });
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) add(node.name.text, { scope: scopeOf(node), at: node.getStart(file), fn: node });
    else if (ts.isImportSpecifier(node)) {
      const declaration = node.parent.parent.parent;
      if (ts.isImportDeclaration(declaration) && ts.isStringLiteral(declaration.moduleSpecifier)) add(node.name.text, { scope: file, at: 0, importedFrom: declaration.moduleSpecifier.text, importedName: (node.propertyName ?? node.name).text });
    }
    ts.forEachChild(node, collect);
  };
  collect(file);
  const bindingOf = (identifier: ts.Identifier): Declaration | undefined => {
    const at = identifier.getStart(file);
    const inScope = (declarations.get(identifier.text) ?? []).filter((declaration) => declaration.scope.getStart(file) <= at && at < declaration.scope.getEnd());
    return inScope.sort((a, b) => b.scope.getStart(file) - a.scope.getStart(file) || b.at - a.at).find((declaration) => declaration.at <= at || declaration.importedFrom !== undefined || declaration.fn !== undefined);
  };
  const exportedFrom = (specifier: string, name: string, output: string): boolean => {
    if (!specifier.startsWith(".")) return false;
    const target = posix.normalize(posix.join(posix.dirname(path), specifier));
    if (!target.includes("/__tests__/")) return false;
    const helper = [`${target}.ts`, `${target}.tsx`].map((candidate) => [candidate, read(candidate)] as const).find(([, source]) => source.length > 0);
    if (helper === undefined) return false;
    const declaration = parse(helper[0], helper[1]).statements.flatMap((statement) => (ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])).find((entry) => ts.isIdentifier(entry.name) && entry.name.text === name);
    const init = declaration?.initializer;
    return init !== undefined && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) && init.text === output;
  };
  return (output) => {
    const [dir, base] = splitOutput(output);
    const dirNamed = dirNamedIn(text, dir);
    const isMap = output.startsWith(`${B24_MAPS_DIR}/`) && (B24_MAP_FILES as readonly string[]).includes(base);
    const literal = (value: string): boolean => value === output || ((value.includes("/") || dirNamed) && output.endsWith(`/${value}`));
    // `params`: inside a local reader function, its parameters stand for the path its caller passes
    const denotes = (node: ts.Expression, depth = 0, params: ReadonlySet<string> = NO_PARAMS): boolean => {
      if (depth > 6) return false;
      const expression = unwrap(node);
      if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return literal(expression.text);
      if (ts.isTemplateExpression(expression)) {
        const tail = expression.templateSpans.at(-1)!;
        if (tail.literal.text === "") return denotes(tail.expression, depth + 1, params);
        return dirNamed && (tail.literal.text === base || tail.literal.text === `/${base}`);
      }
      if (ts.isCallExpression(expression)) {
        const callee = ts.isIdentifier(expression.expression) ? expression.expression.text : ts.isPropertyAccessExpression(expression.expression) ? expression.expression.name.text : "";
        if (callee !== "join" && callee !== "resolve") return false;
        if (expression.arguments.some((argument) => denotes(argument, depth + 1, params))) return true;
        const strings = expression.arguments.map(unwrap).filter((argument): argument is ts.StringLiteral => ts.isStringLiteral(argument)).map((argument) => argument.text);
        return strings.length > 0 && literal(strings.join("/"));
      }
      if (ts.isIdentifier(expression)) {
        if (params.has(expression.text)) return true;
        const binding = bindingOf(expression);
        if (binding === undefined) return false;
        if (binding.importedFrom !== undefined) return (isMap && binding.importedName === "B24_MAP_FILES" && posix.normalize(posix.join(posix.dirname(path), binding.importedFrom)) === B24_MAPS_GENERATOR) || exportedFrom(binding.importedFrom, binding.importedName ?? expression.text, output);
        if (binding.forOf !== undefined) {
          const iterated = unwrap(binding.forOf);
          if (ts.isIdentifier(iterated) && iterated.text === "B24_MAP_FILES") return denotes(iterated, depth + 1);
          return iterated.getText(file).includes(`"${output}"`) || (dirNamed && iterated.getText(file).includes(`"${base}"`));
        }
        return binding.init !== undefined && binding.fn === undefined && denotes(binding.init, depth + 1);
      }
      return false;
    };
    const readsText = (node: ts.Expression, depth = 0, params: ReadonlySet<string> = NO_PARAMS): boolean => {
      if (depth > 6) return false;
      const expression = unwrap(node);
      if (ts.isIdentifier(expression)) {
        const binding = bindingOf(expression);
        return binding !== undefined && binding.init !== undefined && binding.fn === undefined && binding.forOf === undefined && readsText(binding.init, depth + 1, params);
      }
      if (!ts.isCallExpression(expression)) return false;
      const callee = expression.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        if (method === "replaceAll" || method === "replace" || method === "toString") return readsText(callee.expression, depth + 1, params);
        if (method === "join" && ts.isCallExpression(callee.expression) && ts.isPropertyAccessExpression(callee.expression.expression) && callee.expression.expression.name.text === "split") return readsText(callee.expression.expression.expression, depth + 1, params);
        if (method !== "readFileSync" && method !== "readFile") return false;
      } else if (ts.isIdentifier(callee)) {
        // a local function reads only when it returns the whole text of the path its argument names; any other reader by its name
        const binding = bindingOf(callee);
        const reads = binding?.fn !== undefined ? returnsText(binding.fn, depth + 1) : READ_CALL.test(callee.text);
        if (!reads) return false;
      } else return false;
      return expression.arguments.some((argument) => denotes(argument, depth + 1, params));
    };
    /** Whether a local function returns the whole text of the file its parameter names (an expression body, or one `return`). */
    const returnsText = (fn: ts.Node, depth: number): boolean => {
      if (!(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn)) || fn.body === undefined) return false;
      const params = new Set(fn.parameters.flatMap((parameter) => (ts.isIdentifier(parameter.name) ? [parameter.name.text] : [])));
      const returns = ts.isBlock(fn.body) ? fn.body.statements.filter(ts.isReturnStatement) : [];
      const returned = !ts.isBlock(fn.body) ? fn.body : returns.length === 1 ? returns[0]!.expression : undefined;
      return returned !== undefined && readsText(returned, depth, params);
    };
    const digests = (node: ts.Node): boolean => {
      let found = false;
      const visit = (child: ts.Node): void => {
        if (found) return;
        if (ts.isCallExpression(child)) {
          const callee = child.expression;
          if (ts.isPropertyAccessExpression(callee) && callee.name.text === "update" && child.arguments.some((argument) => readsText(argument))) found = true;
          if (ts.isIdentifier(callee)) {
            const binding = bindingOf(callee);
            const hashes = HASH_CALL.test(callee.text) || (binding?.fn !== undefined && /\bcreateHash\(/.test(binding.fn.getText(file)));
            if (hashes && child.arguments.some((argument) => denotes(argument))) found = true;
          }
        }
        ts.forEachChild(child, visit);
      };
      visit(node);
      return found;
    };
    let check: SuiteCheck = "content";
    const visit = (node: ts.Node): void => {
      if (check === "bytes") return;
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && EQUALITY.has(node.expression.name.text) && ts.isCallExpression(node.expression.expression) && ts.isIdentifier(node.expression.expression.expression) && node.expression.expression.expression.text === "expect" && node.arguments.length > 0) {
        const subject = node.expression.expression.arguments[0];
        const expected = unwrap(node.arguments[0]!);
        const trivial = expected.kind === ts.SyntaxKind.TrueKeyword || expected.kind === ts.SyntaxKind.FalseKeyword || expected.kind === ts.SyntaxKind.NullKeyword || ts.isNumericLiteral(expected) || (ts.isIdentifier(expected) && expected.text === "undefined");
        if (subject !== undefined && !trivial) {
          if (readsText(subject) || readsText(expected)) check = "bytes";
          else if (digests(subject) || digests(expected)) check = "digest";
        }
      }
      if (ts.isPropertyAssignment(node) && (ts.isStringLiteral(node.name) || ts.isNoSubstitutionTemplateLiteral(node.name)) && literal(node.name.text) && ts.isStringLiteral(node.initializer) && HEX_DIGEST.test(node.initializer.text) && check === "content") check = "digest";
      ts.forEachChild(node, visit);
    };
    visit(file);
    return check;
  };
}

/** How one suite checks one output (`suiteChecker` for a single output). */
export function pinCheckOf(path: string, text: string, output: string, read: (path: string) => string): SuiteCheck {
  return suiteChecker(path, text, read)(output);
}

/** The vitest jobs, in the order `_ci-admission.ts`' CI_JOB_IDS lists them (the browser jobs run no vitest file). */
export const VITEST_CI_JOBS = Object.freeze(["prompt-to-gerber", "database-delivery", "benchmark-core", "benchmark-nightly", "agent-boundary-suites", "benchmark-latency"] as const);
type VitestJob = (typeof VITEST_CI_JOBS)[number];

/** The block of a workflow job: from its key line (two-space indent) to the next job key. */
function jobLines(lines: readonly string[], job: string): readonly string[] {
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start < 0 || lines.findIndex((line, index) => index > start && line === `  ${job}:`) >= 0) throw new Error(`B24_MAP_WORKFLOW: job ${job} is not one key`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line));
  return lines.slice(start, end < 0 ? undefined : end);
}

/** Each vitest job's positional filters and `--exclude` patterns, read from the two workflows and `package.json`'s `stage10:test`. */
export function vitestJobFilters(rootDir: string): Readonly<Record<VitestJob, { readonly filters: readonly string[]; readonly excludes: readonly string[] }>> {
  const deterministic = readText(rootDir, WORKFLOW_DETERMINISTIC).split(NEWLINE);
  const benchmark = readText(rootDir, WORKFLOW_BENCHMARK).split(NEWLINE);
  const folded = (job: string): { filters: string[]; excludes: string[] } => {
    const block = jobLines(deterministic, job);
    const run = block.findIndex((line) => line.trim() === "pnpm exec vitest run");
    if (run < 0) throw new Error(`B24_MAP_WORKFLOW: ${job} has no folded vitest step`);
    const filters: string[] = [];
    const excludes: string[] = [];
    for (const line of block.slice(run + 1)) {
      const text = line.trim();
      if (text.includes("--reporter")) return { filters, excludes };
      const exclude = /^--exclude '([^'\s]+)'$/.exec(text);
      if (exclude) excludes.push(exclude[1]!);
      else if (text.startsWith("--")) throw new Error(`B24_MAP_WORKFLOW: ${job} has the flag ${text}`);
      else filters.push(...text.split(/\s+/).filter(Boolean));
    }
    throw new Error(`B24_MAP_WORKFLOW: ${job}'s vitest step has no --reporter line`);
  };
  const scripts = (JSON.parse(readText(rootDir, PACKAGE_FILE)) as { scripts: Record<string, string> }).scripts;
  const stage10 = (scripts["stage10:test"] ?? "").replace(/^vitest run\s+/, "").split(/\s+/).filter(Boolean);
  const inline = (job: string): { filters: string[]; excludes: string[] } => {
    const block = jobLines(benchmark, job);
    const runs = block.filter((line) => line.trim().startsWith("- run: pnpm exec vitest run "));
    if (runs.length !== 1) throw new Error(`B24_MAP_WORKFLOW: ${job} has ${runs.length} inline vitest steps`);
    const tokens = runs[0]!.trim().slice("- run: pnpm exec vitest run ".length).split(/\s+/);
    const flag = tokens.findIndex((token) => token.startsWith("--"));
    const filters = tokens.slice(0, flag < 0 ? undefined : flag);
    if (block.some((line) => line.trim().startsWith("- run: pnpm run stage10:test"))) filters.push(...stage10);
    return { filters, excludes: [] };
  };
  return { "prompt-to-gerber": folded("prompt-to-gerber"), "database-delivery": folded("database-delivery"), "benchmark-core": inline("benchmark-core"), "benchmark-nightly": inline("benchmark-nightly"), "agent-boundary-suites": folded("agent-boundary-suites"), "benchmark-latency": inline("benchmark-latency") };
}

/** The vitest jobs that run a test file: a positional filter selects it (B19-E's `selected` rule) and no exclude leaves it out. */
export function ciJobsOf(path: string, jobs: ReturnType<typeof vitestJobFilters>): VitestJob[] {
  const normal = posix.normalize(path);
  if (!(normal.startsWith("app/") && normal.includes("/__tests__/") && /\.test\.tsx?$/.test(normal))) return [];
  return VITEST_CI_JOBS.filter((job) => jobs[job].filters.some((filter) => normal.includes(filter)) && !jobs[job].excludes.some((pattern) => (pattern.endsWith("/**") ? normal.startsWith(pattern.slice(0, -2)) : normal === pattern)));
}

/** The four pin classes (OD-220). */
export const PIN_CLASSES = Object.freeze(["byte-pinned-in-CI", "byte-pinned-outside-CI", "content-checked", "unpinned"] as const);
export type PinClass = (typeof PIN_CLASSES)[number];

/** The ledger lines that count generators, and the set each count denotes (discovery section 2.8, 9.5 item 32). */
export const LEDGER_GENERATOR_COUNTS: ReadonlyArray<{ readonly line: number; readonly denotes: string }> = Object.freeze([
  { line: 2488, denotes: "no list recorded" },
  { line: 4735, denotes: "scripts/generate-*.ts at f663d71 (INFERRED)" },
  { line: 4767, denotes: "scripts/generate-*.ts at f663d71 (INFERRED)" },
]);

/** One inventory row: a generator's output with one pinning suite (`none` when no suite names it), the suite's check and CI jobs. */
export interface InventoryRow { readonly generator: string; readonly output: string; readonly pinClass: PinClass; readonly suite: string; readonly check: SuiteCheck | "-"; readonly jobs: readonly string[] }
/** The inventory's rows: one per generator x output x pinning suite (a suite-less output once), each with the suite's check, its CI
 *  jobs and the output's pin class. [B24-F review, 2026-10-10] correctness-7: all derived - an output is byte-pinned (in CI when one
 *  of its `bytes` or `digest` suites runs in a CI job, else outside CI), content-checked when its suites only name it, unpinned when
 *  no suite names it. */
export function generatorInventoryRows(rootDir: string): readonly InventoryRow[] {
  const scripts = generatorScripts(rootDir);
  const listed = Object.keys(GENERATOR_OUTPUTS).map((name) => `scripts/${name}`).sort(byCodePoint);
  if (JSON.stringify(scripts) !== JSON.stringify(listed)) throw new Error(`B24_MAP_GENERATORS: the tree holds ${scripts.join(", ")}; the inventory lists ${listed.join(", ")}`);
  const jobs = vitestJobFilters(rootDir);
  const readOrEmpty = (path: string): string => (existsSync(join(rootDir, ...path.split("/"))) ? readText(rootDir, path) : "");
  const suitesOf = pinningSuitesByOutput(rootDir, scripts.flatMap((script) => GENERATOR_OUTPUTS[script.slice("scripts/".length)]!));
  const checkers = new Map<string, (output: string) => SuiteCheck>();
  const checkerOf = (suite: string): ((output: string) => SuiteCheck) => {
    if (!checkers.has(suite)) checkers.set(suite, suiteChecker(suite, readText(rootDir, suite), readOrEmpty));
    return checkers.get(suite)!;
  };
  return scripts.flatMap((script) => GENERATOR_OUTPUTS[script.slice("scripts/".length)]!.flatMap((output): InventoryRow[] => {
    const suites = suitesOf.get(output)!;
    const checks = suites.map((suite) => checkerOf(suite)(output));
    const jobsOf = suites.map((suite) => ciJobsOf(suite, jobs));
    const byteSuites = suites.map((_, index) => index).filter((index) => checks[index] !== "content");
    const pinClass: PinClass = suites.length === 0 ? "unpinned" : byteSuites.length === 0 ? "content-checked" : byteSuites.some((index) => jobsOf[index]!.length > 0) ? "byte-pinned-in-CI" : "byte-pinned-outside-CI";
    return suites.length === 0 ? [{ generator: script, output, pinClass, suite: "none", check: "-", jobs: [] }] : suites.map((suite, index) => ({ generator: script, output, pinClass, suite, check: checks[index]!, jobs: jobsOf[index]! }));
  }));
}

/** generator-inventory.md: one row per generator, then its outputs with their pin classes, pinning suites and CI jobs, then the records. */
export function renderGeneratorInventory(rootDir: string): string {
  const rows = generatorInventoryRows(rootDir);
  const scripts = generatorScripts(rootDir);
  const packageScripts = Object.entries((JSON.parse(readText(rootDir, PACKAGE_FILE)) as { scripts: Record<string, string> }).scripts);
  const runsGenerator = packageScripts.filter(([, command]) => /scripts\/gen(?:erate)?-/.test(command)).length;
  const ledger = LEDGER_GENERATOR_COUNTS.map((entry) => {
    const match = /\b(\d+) generators\b/.exec(lineOf(rootDir, LEDGER, entry.line));
    if (match === null) throw new Error(`B24_MAP_LEDGER: ${LEDGER}:${entry.line} names no generator count`);
    return [`${LEDGER}:${entry.line}`, Number(match[1]), entry.denotes] as const;
  });
  return page([
    "# B24-F - Generator inventory",
    "",
    provenance("renderGeneratorInventory"),
    "",
    `## 1. Generators (\`scripts/generate-*.ts\` and \`scripts/gen-*.ts\`): ${scripts.length}`,
    "",
    ...table(["generator", "run command", "outputs", "pin classes"], scripts.map((script) => {
      const own = rows.filter((row) => row.generator === script);
      return [script, `pnpm exec tsx ${script}`, new Set(own.map((row) => row.output)).size, PIN_CLASSES.filter((pinClass) => own.some((row) => row.pinClass === pinClass)).join(", ")];
    })),
    "",
    `## 2. Outputs, pin classes, pinning suites, checks and CI jobs: ${rows.length} rows (${new Set(rows.map((row) => row.output)).size} outputs)`,
    "",
    ...table(["generator", "output", "pin class", "pinning suite", "check", "CI jobs"], rows.map((row) => [row.generator, row.output, row.pinClass, row.suite, row.check, row.jobs.length === 0 ? "none" : row.jobs.join(", ")])),
    "",
    "## 3. Recorded, not fixed (OD-220)",
    "",
    "### 3.1 `package.json` scripts",
    "",
    ...table(["scripts", "scripts that run a generator", "regenerate-all or drift command"], [[packageScripts.length, runsGenerator, runsGenerator]]),
    "",
    "### 3.2 Unpinned outputs",
    "",
    ...table(["generator", "output"], rows.filter((row) => row.pinClass === "unpinned").map((row) => [row.generator, row.output])),
    "",
    "### 3.3 The ledger's generator counts",
    "",
    ...table(["path:line", "count", "denotes"], ledger),
    "",
    "### 3.4 Generators now",
    "",
    ...table(["glob", "count"], [["scripts/generate-*.ts", scripts.filter((script) => script.startsWith("scripts/generate-")).length], ["scripts/gen-*.ts", scripts.filter((script) => script.startsWith("scripts/gen-")).length]]),
  ]);
}

// ── all six ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The six renders, keyed by file name. */
export const B24_MAP_RENDERERS: Readonly<Record<B24MapFile, (rootDir: string) => string>> = Object.freeze({
  "trust-boundary-map.md": renderTrustBoundaryMap,
  "current-system-map.md": renderCurrentSystemMap,
  "coverage-matrix.csv": renderCoverageMatrix,
  "agent-graph.md": renderAgentGraph,
  "permission-autonomy-matrix.csv": renderPermissionAutonomyMatrix,
  "generator-inventory.md": renderGeneratorInventory,
});

// Run only as a script (tsx): importing this module from a test writes nothing (the generate-b16-0-7-artifacts precedent).
const invokedAsScript = Boolean(process.argv[1] && process.argv[1].split("\\").join("/").includes("generate-b24-maps"));
if (invokedAsScript) {
  const ROOT = process.cwd();
  const outDir = join(ROOT, ...B24_MAPS_DIR.split("/"));
  mkdirSync(outDir, { recursive: true });
  for (const file of B24_MAP_FILES) {
    const text = B24_MAP_RENDERERS[file](ROOT);
    writeFileSync(join(outDir, file), text);
    process.stdout.write(`Wrote ${toPosix(relative(ROOT, join(outDir, file)))} (${text.split(NEWLINE).length - 1} lines)\n`);
  }
}

