/**
 * [B24-A2] The environment-name census and `.env.example` parity (D24-4, OD-195).
 *
 * `ENVIRONMENT_NAMES` (`app/lib/deployment/environment-names.ts`) is data: one row per name the code reads, with its class, its
 * reader (a repository path) and, for an undeclared class, the reason. The classes are closed - declared: secret, configuration,
 * flag, rotation-previous; not declared: fixture, qualification-opt-in, platform, child-passthrough, not-an-environment-name.
 * This suite scans the production tree with the TypeScript parser (comments ignored): names read off `process.env`, or off an
 * identifier named `env` or `environment`, by dot, `?.` or string-literal element access; string literals of environment-name shape
 * that start with a prefix from a closed list; and the names that come from data (the acquisition source registry's secrets and
 * fallbacks, the transfer descriptors' credential names, the MCP server registry's and the provider registry's credentials). Every
 * hit is a census row; every row's reader holds its name in code; every entry of B24-A1's flag inventory is a row whose class is
 * its kind's image under the D16 map; and `.env.example` declares every name of a declared class exactly once while every
 * declaration names a census row.
 *
 * Failing first on 1b2c08c: the census does not exist, and at least 44 names are read and undeclared (task Lead note 1; page section
 * 8). Files are read as text; nothing is written to disk and no process is started. The scan yields between files, so no case holds
 * the worker for long.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";
import { SOURCE_REGISTRY } from "@/app/lib/acquisition/source-registry";
import {
  DECLARED_ENVIRONMENT_NAME_CLASSES,
  ENVIRONMENT_NAME_CLASSES,
  ENVIRONMENT_NAMES,
  FLAG_KIND_TO_CLASS,
  UNDECLARED_CLASS_REASONS,
  type EnvironmentNameRow,
} from "@/app/lib/deployment/environment-names";
import { FLAG_INVENTORY, FLAG_KINDS } from "@/app/lib/deployment/flag-inventory";
import { PROVIDER_TRANSFER_DESCRIPTORS } from "@/app/lib/manufacturing-providers/provider-egress";
import { PROVIDER_ROWS } from "@/app/lib/manufacturing-providers/provider-registry";
import { MCP_SERVER_REGISTRY } from "@/app/lib/mcp/server-registry";
import { collectProductionFiles } from "@/app/lib/project/__tests__/_import-gate-helpers";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const lines = (path: string): string[] => read(path).split(NEWLINE);
const CENSUS = "app/lib/deployment/environment-names.ts";
const INVENTORY = "app/lib/deployment/flag-inventory.ts";
const PAGE = "artifacts/ai-control-plane-b24/edge-security.md";
const EXAMPLE = ".env.example";
/** `.env.example`'s last line at 1b2c08c: the additions are appended after it, so no existing line moves. */
const EXAMPLE_LINES_AT_BASE = 93;

/** D16: B24-A1's nine kinds -> the census classes; a `secret` named `*_PREVIOUS` is the one refinement (rotation-previous). */
const KIND_TO_CLASS = {
  "enable-flag": "flag",
  "disable-switch": "flag",
  "rollout-stage": "flag",
  shadow: "flag",
  fixture: "fixture",
  "live-test-gate": "qualification-opt-in",
  configuration: "configuration",
  secret: "secret",
  tooling: "platform",
} as const;
const imageOf = (kind: keyof typeof KIND_TO_CLASS, name: string): string => (kind === "secret" && name.endsWith("_PREVIOUS") ? "rotation-previous" : KIND_TO_CLASS[kind]);

/** The closed prefix list of the literal rule: a string literal of environment-name shape starting with one of these is a hit. */
const LITERAL_PREFIXES = ["SIRKIT_", "NEXT_PUBLIC_", "KICAD_", "DATABASE_", "DIGIKEY_", "MOUSER_", "OCTOPART_", "NEXAR_", "SCHGEN_", "OPENAI_", "ANTHROPIC_", "SUPABASE_", "FREEROUTING_", "JAVA_", "HF_", "NODE_"] as const;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const LITERAL = new RegExp(`^(?:${LITERAL_PREFIXES.join("|")})[A-Z0-9_]*[A-Z0-9]$`);

/** The names one source reads, by the three code rules (comments are not in the syntax tree). */
function namesIn(path: string, text: string): Set<string> {
  const kind = /\.(?:tsx|jsx)$/.test(path) ? ts.ScriptKind.TSX : /\.(?:js|mjs|cjs)$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind);
  const hits = new Set<string>();
  const environmentObject = (node: ts.Expression): boolean => {
    let inner = node;
    while (ts.isParenthesizedExpression(inner) || ts.isNonNullExpression(inner)) inner = inner.expression;
    if (ts.isIdentifier(inner)) return inner.text === "env" || inner.text === "environment";
    return ts.isPropertyAccessExpression(inner) && inner.name.text === "env" && ts.isIdentifier(inner.expression) && inner.expression.text === "process";
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && environmentObject(node.expression) && ENV_NAME.test(node.name.text)) hits.add(node.name.text);
    if (ts.isElementAccessExpression(node) && environmentObject(node.expression) && ts.isStringLiteralLike(node.argumentExpression) && ENV_NAME.test(node.argumentExpression.text)) hits.add(node.argumentExpression.text);
    if (ts.isStringLiteralLike(node) && LITERAL.test(node.text)) hits.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

/** A path under a git worktree inside the repository (a directory below the root holding a `.git` entry). */
const worktreeCache = new Map<string, boolean>();
function underWorktree(path: string): boolean {
  const parts = path.split("/").slice(0, -1);
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const dir = parts.slice(0, depth).join("/");
    if (!worktreeCache.has(dir)) worktreeCache.set(dir, existsSync(join(ROOT, dir, ".git")));
    if (worktreeCache.get(dir)) return true;
  }
  return false;
}
/** The scan's files: B14's production walker (`collectProductionFiles`), minus tests, specs, e2e*, the Playwright and vitest
 *  configs, the Playwright output folders, any worktree inside the repository, the census itself and A1's inventory (the lists). */
function excluded(path: string): string | null {
  if (/\.(?:test|spec)\.[a-z]+$/.test(path) || /(?:^|\/)__tests__\//.test(path)) return "test";
  if (/^e2e[^/]*\//.test(path)) return "e2e";
  if (["playwright.config.ts", "playwright.orchestration.config.ts", "vitest.config.ts"].includes(path)) return "config";
  if (/^(?:playwright-report|test-results)[^/]*\//.test(path)) return "playwright output";
  if (path === CENSUS || path === INVENTORY) return "list";
  if (underWorktree(path)) return "worktree";
  return null;
}

type Scan = { files: number; hits: Map<string, string[]> };
let scan: Scan;
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** The names that come from data rather than code: each pinned to its source. */
function dataNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const entry of Object.values(SOURCE_REGISTRY)) for (const reference of entry.auth.secrets) for (const name of [reference.env, ...reference.fallbacks]) names.set(name, "app/lib/acquisition/source-registry.ts");
  for (const descriptor of PROVIDER_TRANSFER_DESCRIPTORS) if (descriptor.auth.kind === "header") names.set(descriptor.auth.env, "app/lib/manufacturing-providers/provider-egress.ts");
  for (const entry of MCP_SERVER_REGISTRY) for (const reference of entry.auth.secrets) names.set(reference.env, "app/lib/mcp/server-registry.ts");
  for (const row of PROVIDER_ROWS) for (const reference of row.credentials.references) names.set(reference.env, "app/lib/manufacturing-providers/provider-registry.ts");
  return names;
}

const ROWS = new Map<string, EnvironmentNameRow>(ENVIRONMENT_NAMES.map((row) => [row.name, row]));
const DECLARED = new Set<string>(DECLARED_ENVIRONMENT_NAME_CLASSES);
/** `.env.example`'s declaration lines: `NAME=` or `# NAME=` at the start of a line. */
const declarations = (): Array<{ name: string; line: number; text: string }> =>
  lines(EXAMPLE).flatMap((text, index) => {
    const match = /^(?:# )?([A-Z][A-Z0-9_]*)=/.exec(text);
    return match ? [{ name: match[1]!, line: index + 1, text }] : [];
  });

beforeAll(async () => {
  const files = [...collectProductionFiles(ROOT)].filter(([path]) => excluded(path) === null);
  const hits = new Map<string, string[]>();
  let done = 0;
  for (const [path, text] of files) {
    for (const name of namesIn(path, text)) hits.set(name, [...(hits.get(name) ?? []), path]);
    done += 1;
    if (done % 40 === 0) await yieldToLoop();
  }
  for (const [name, source] of dataNames()) hits.set(name, [...(hits.get(name) ?? []), `${source} (data)`]);
  scan = { files: files.length, hits };
}, 300_000);

describe("[B24-A2] the environment-name census (D24-4, OD-195)", () => {
  it("1. the census is data and imports nothing (so neither import gate can trip: worker-principal outside app/api, app/lib/auth and the proxy, b16-0-1-ci-gates.test.ts:247-264; mcp-bearer outside route-handlers and the MCP server, b20-b2-import-gates.test.ts:74); its classes are closed, four declared and five undeclared, each undeclared class with its reason; every row is well formed, named once, sorted, and its reader a repository file that is neither the census nor A1's inventory", () => {
    expect(read(CENSUS)).not.toMatch(/^\s*import\b/m);
    expect(read(CENSUS)).not.toMatch(/\brequire\(/);
    expect([...ENVIRONMENT_NAME_CLASSES]).toEqual(["secret", "configuration", "flag", "rotation-previous", "fixture", "qualification-opt-in", "platform", "child-passthrough", "not-an-environment-name"]);
    expect([...DECLARED_ENVIRONMENT_NAME_CLASSES]).toEqual(["secret", "configuration", "flag", "rotation-previous"]);
    expect(Object.keys(UNDECLARED_CLASS_REASONS)).toEqual(["fixture", "qualification-opt-in", "platform", "child-passthrough", "not-an-environment-name"]);
    expect(UNDECLARED_CLASS_REASONS.fixture).toMatch(/^honoured only outside production/);
    expect(UNDECLARED_CLASS_REASONS["qualification-opt-in"]).toMatch(/^arms an opt-in test or live run/);
    expect(UNDECLARED_CLASS_REASONS.platform).toMatch(/NODE_ENV, NEXT_RUNTIME, NODE_OPTIONS and the like/);
    expect(UNDECLARED_CLASS_REASONS["child-passthrough"]).toMatch(/KICAD_CONFIG_HOME/);
    expect(UNDECLARED_CLASS_REASONS["not-an-environment-name"]).toMatch(/SIRKIT_D1N4148/);
    expect(Object.isFrozen(ENVIRONMENT_NAMES)).toBe(true);
    expect(ENVIRONMENT_NAMES.map((row) => row.name)).toEqual([...ENVIRONMENT_NAMES.map((row) => row.name)].sort());
    expect(ROWS.size).toBe(ENVIRONMENT_NAMES.length);
    for (const row of ENVIRONMENT_NAMES) {
      expect(Object.keys(row).sort(), row.name).toEqual(["class", "name", "reader", "reason"]);
      expect(row.name, row.name).toMatch(ENV_NAME);
      expect(ENVIRONMENT_NAME_CLASSES, row.name).toContain(row.class);
      if (DECLARED.has(row.class)) expect(row.reason, row.name).toBeNull();
      else expect(row.reason?.length ?? 0, row.name).toBeGreaterThan(20);
      expect(existsSync(join(ROOT, row.reader)), `${row.name} ${row.reader}`).toBe(true);
      expect([CENSUS, INVENTORY], row.name).not.toContain(row.reader);
    }
  });

  it("2. counterexample (red on 1b2c08c, where no census existed and at least 44 names were read and undeclared): the scan covers the production tree, and every hit - code and data - is a census row", { timeout: 60_000 }, () => {
    expect(scan.files).toBeGreaterThan(1000);
    expect(scan.hits.size).toBeGreaterThan(60);
    const unclassified = [...scan.hits].filter(([name]) => !ROWS.has(name)).map(([name, sites]) => `${name} at ${sites.slice(0, 3).join(", ")}`);
    expect(unclassified).toEqual([]);
    // what the task's Lead note 1 lists beyond the discovery's twenty names is found by the scan
    for (const name of ["MOUSER_API_KEY", "SIRKIT_ACQUISITION_DISABLED_SOURCES", "SIRKIT_ATOMIC_CATALOG_TENANT_ID", "SIRKIT_ATOMIC_CATALOG_PROJECT_ID", "SIRKIT_MAPPING_STAGE4", "SIRKIT_PASSIVE_POLICY_STAGE5", "SIRKIT_FOOTPRINT_RESOLVER_SHADOW", "SIRKIT_PHYSICAL_BINDING_SHADOW", "SCHGEN_ENDPOINT_URL", "SCHGEN_ENDPOINT_TOKEN", "HF_TOKEN", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "KICAD_CONFIG_HOME", "SIRKIT_B16_1C_RECORD_ROUTES", "SIRKIT_DB_QUALIFICATION", "SIRKIT_DB_QUALIFICATION_URL", "SIRKIT_LIVE_ORCHESTRATION_EVALUATION", "SIRKIT_LIVE_ORCHESTRATION_PROVIDER"]) expect(scan.hits.has(name), name).toBe(true);
    expect([...scan.hits.keys()].filter((name) => name.startsWith("SIRKIT_FIXTURE_")).sort()).toEqual(["SIRKIT_FIXTURE_AGENT", "SIRKIT_FIXTURE_CLOCK", "SIRKIT_FIXTURE_ROUTER", "SIRKIT_FIXTURE_ROUTER_DUMP", "SIRKIT_FIXTURE_ROUTER_FIXTURE", "SIRKIT_FIXTURE_RUNTIME"]);
    // the data sources: the transfer descriptors, the MCP server registry and the provider registry hold no credential name today
    expect(PROVIDER_TRANSFER_DESCRIPTORS).toEqual([]);
    expect(MCP_SERVER_REGISTRY).toEqual([]);
    expect(PROVIDER_ROWS.flatMap((row) => row.credentials.references)).toEqual([]);
    expect([...dataNames().keys()].sort()).toEqual(["DIGIKEY_CLIENT_ID", "DIGIKEY_CLIENT_SECRET", "MOUSER_API_KEY", "NEXAR_API_KEY", "OCTOPART_API_KEY"]);
  });

  it("3. every row's reader holds its name in code (its own scan, comments ignored): a name that lives only in a comment there fails - NGSPICE_BIN at app/api/simulate/route.ts, diagnostic-runner.ts and model-simulation/provider.ts, where it is only a comment", { timeout: 60_000 }, () => {
    const holds = (row: Pick<EnvironmentNameRow, "name" | "reader">): boolean => namesIn(row.reader, read(row.reader)).has(row.name);
    const stale = ENVIRONMENT_NAMES.filter((row) => !holds(row)).map((row) => `${row.name} not in ${row.reader}`);
    expect(stale).toEqual([]);
    for (const reader of ["app/api/simulate/route.ts", "app/lib/computation/diagnostic-runner.ts", "app/lib/model-simulation/provider.ts"]) {
      expect(read(reader), reader).toContain("NGSPICE_BIN");
      expect(holds({ name: "NGSPICE_BIN", reader }), reader).toBe(false);
    }
    expect(ROWS.has("NGSPICE_BIN")).toBe(false);
  });

  it("4. D16: the map from B24-A1's nine kinds is total, pinned here as a constant; every entry of A1's inventory is a census row whose class is its kind's image (a secret named *_PREVIOUS -> rotation-previous); SIRKIT_AUTH_MODE is configuration (declared), never a fixture; child-passthrough and not-an-environment-name have no A1 kind", () => {
    expect(Object.keys(KIND_TO_CLASS).sort()).toEqual([...FLAG_KINDS].sort());
    expect(FLAG_KIND_TO_CLASS).toEqual(KIND_TO_CLASS);
    const mismatched: string[] = [];
    for (const entry of FLAG_INVENTORY) {
      const row = ROWS.get(entry.name);
      const image = imageOf(entry.kind, entry.name);
      if (!row || row.class !== image) mismatched.push(`${entry.name}: kind ${entry.kind} -> ${image}, census ${row?.class ?? "absent"}`);
    }
    expect(mismatched).toEqual([]);
    expect(FLAG_INVENTORY.find((entry) => entry.name === "SIRKIT_AUTH_MODE")?.kind).toBe("configuration");
    expect(ROWS.get("SIRKIT_AUTH_MODE")?.class).toBe("configuration");
    const images = new Set(FLAG_INVENTORY.map((entry) => imageOf(entry.kind, entry.name)));
    for (const unmapped of ["child-passthrough", "not-an-environment-name"]) expect(images.has(unmapped), unmapped).toBe(false);
    expect(ENVIRONMENT_NAMES.filter((row) => row.class === "child-passthrough").map((row) => row.name)).toEqual(["KICAD_CONFIG_HOME"]);
    // A1's two refinement entries, appended by this increment
    for (const name of ["SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS", "SIRKIT_MCP_TOKEN_SECRET_PREVIOUS"]) {
      expect(FLAG_INVENTORY.find((entry) => entry.name === name)?.kind, name).toBe("secret");
      expect(ROWS.get(name)?.class, name).toBe("rotation-previous");
    }
    expect(ROWS.get("KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS")?.class).toBe("rotation-previous");
    expect(FLAG_INVENTORY.some((entry) => entry.name === "KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS")).toBe(false);
  });

  it("5. the census by class, counted (the page states the same counts); B24-D1's three names are no rows yet (no file reads them at A2's tree), and the classes they will take - qualification-opt-in and platform through live-test-gate and tooling - are undeclared, so they need no new class and no .env.example line; [B24-D1, 2026-10-09] reviewed pin move: landed - the three are read and are rows (qualification-opt-in and platform, D16), and GITHUB_STEP_SUMMARY with them (platform)", () => {
    const counts = Object.fromEntries(ENVIRONMENT_NAME_CLASSES.map((name) => [name, ENVIRONMENT_NAMES.filter((row) => row.class === name).length]));
    expect(counts).toEqual(CLASS_COUNTS);
    expect(ENVIRONMENT_NAMES).toHaveLength(Object.values(CLASS_COUNTS).reduce((sum, count) => sum + count, 0));
    for (const name of ["SIRKIT_B24_BENCHMARK", "SIRKIT_B24_BENCHMARK_DIR", "SIRKIT_JOB_STARTED_AT", "GITHUB_STEP_SUMMARY"]) { // [B24-D1, 2026-10-09] reviewed pin move: read and rows since B24-D1 (was: neither, at A2's tree)
      expect(scan.hits.has(name), name).toBe(true);
      expect(ROWS.get(name)?.class, name).toBe(name === "SIRKIT_B24_BENCHMARK" ? "qualification-opt-in" : "platform");
    }
    expect(DECLARED.has(KIND_TO_CLASS["live-test-gate"])).toBe(false);
    expect(DECLARED.has(KIND_TO_CLASS.tooling)).toBe(false);
  });
});

describe("[B24-A2] .env.example parity (D24-4, OD-195)", () => {
  it("6. counterexample (red on 1b2c08c): .env.example declares every name of a declared class exactly once, as NAME= or # NAME=; every declaration line names a census row; no name of an undeclared class is declared; every name read and undeclared is of an undeclared class", { timeout: 60_000 }, () => {
    const declared = declarations();
    const count = (name: string): number => declared.filter((entry) => entry.name === name).length;
    // the counterexample's measure: the names the code reads that .env.example does not declare, and those of a declared class
    const readAndUndeclared = [...scan.hits.keys()].filter((name) => ROWS.get(name)?.class !== "not-an-environment-name" && count(name) === 0);
    expect(readAndUndeclared.filter((name) => DECLARED.has(ROWS.get(name)?.class ?? "secret")), `${readAndUndeclared.length} names are read and not declared in .env.example`).toEqual([]);
    expect(readAndUndeclared.sort()).toEqual(ENVIRONMENT_NAMES.filter((row) => !DECLARED.has(row.class) && row.class !== "not-an-environment-name" && scan.hits.has(row.name)).map((row) => row.name).sort());
    const missing = ENVIRONMENT_NAMES.filter((row) => DECLARED.has(row.class) && count(row.name) !== 1).map((row) => `${row.name} (${row.class}) declared ${count(row.name)} times`);
    expect(missing).toEqual([]);
    expect(declared.filter((entry) => !ROWS.has(entry.name)).map((entry) => `.env.example:${entry.line} ${entry.name}`)).toEqual([]);
    expect(declared.filter((entry) => !DECLARED.has(ROWS.get(entry.name)?.class ?? "")).map((entry) => `${entry.name} (${ROWS.get(entry.name)?.class})`)).toEqual([]);
  });

  it("7. the additions are appended after .env.example's last line at 1b2c08c (:93), commented and empty, so no existing line moves (b20-b2-mcp-access-token :294-299, b20-a0-feature-flag :105-112, runtime-profile.ts:452, the discovery's :6-79)", () => {
    const example = lines(EXAMPLE);
    expect(example[78]).toBe("# SIRKIT_MCP_TOKEN_SECRET=");
    expect(example[86]).toBe("# SIRKIT_DEPLOYMENT_ENV=");
    expect(example[EXAMPLE_LINES_AT_BASE - 1]).toBe("# SIRKIT_DIAGNOSTIC_RUNNER_DISABLED=");
    const added = declarations().filter((entry) => entry.line > EXAMPLE_LINES_AT_BASE);
    expect(added.length).toBeGreaterThanOrEqual(30);
    for (const entry of added) expect(entry.text, `.env.example:${entry.line}`).toBe(`# ${entry.name}=`);
    expect(example.slice(EXAMPLE_LINES_AT_BASE).every((line) => line === "" || line.startsWith("#"))).toBe(true);
    expect(read(EXAMPLE).endsWith(NEWLINE)).toBe(true);
  });

  it("8. the names pinned by name (D24-4, section 2.1, 9.4; OD-195): the ten B22/B23 names, the expected origin, the KiCad token, the five distributor names, the auth mode, the orchestration pair, the pool size and the three previous values - each a row of a declared class, declared exactly once", () => {
    const pinned = [
      "SIRKIT_NAMED_COMPUTATIONS", "SIRKIT_KICAD_CLI_INSTALL_ROOT", "SIRKIT_KICAD_CLI_INSTALL_SHA256", "SIRKIT_FREEROUTING_INSTALL_ROOT", "SIRKIT_FREEROUTING_INSTALL_SHA256",
      "SIRKIT_NGSPICE_OCI_IMAGE", "SIRKIT_OCI_CLI_PATH", "SIRKIT_OCI_CLI_SHA256", "SIRKIT_MANUFACTURING_DISABLED_PROVIDERS", "SIRKIT_ORDERING_DISABLED",
      "SIRKIT_EXPECTED_ORIGIN", "KICAD_HTTP_LIBRARY_TOKEN", "DIGIKEY_CLIENT_ID", "DIGIKEY_CLIENT_SECRET", "MOUSER_API_KEY", "OCTOPART_API_KEY", "NEXAR_API_KEY",
      "SIRKIT_AUTH_MODE", "SIRKIT_ORCHESTRATION_ENABLED", "SIRKIT_ORCHESTRATION_ROLE_MODELS", "SIRKIT_DB_POOL_MAX",
      "SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS", "KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS", "SIRKIT_MCP_TOKEN_SECRET_PREVIOUS",
    ];
    expect(pinned).toHaveLength(24);
    const declared = declarations();
    for (const name of pinned) {
      expect(DECLARED.has(ROWS.get(name)?.class ?? ""), `${name} ${ROWS.get(name)?.class}`).toBe(true);
      expect(declared.filter((entry) => entry.name === name), name).toHaveLength(1);
    }
    // A1's two names are rows too
    expect(ROWS.get("SIRKIT_DEPLOYMENT_ENV")?.class).toBe("configuration");
    expect(ROWS.get("SIRKIT_DIAGNOSTIC_RUNNER_DISABLED")?.class).toBe("flag");
  });

  it("9. the page states the census by class with counts and every undeclared name with its class, the kind -> class map with its _PREVIOUS refinement, the narrowing of OD-195's default, and how B24-D1's three names fit", () => {
    const page = read(PAGE);
    const start = page.search(new RegExp(`${NEWLINE}## 5\\. `));
    const five = page.slice(start, page.indexOf(`${NEWLINE}## `, start + 1));
    for (const [name, count] of Object.entries(CLASS_COUNTS)) expect(five, name).toMatch(new RegExp(`^\\| \`${name}\` \\| ${count} \\|`, "m"));
    for (const row of ENVIRONMENT_NAMES.filter((candidate) => !DECLARED.has(candidate.class))) expect(five, row.name).toContain(`\`${row.name}\``);
    for (const [kind, image] of Object.entries(KIND_TO_CLASS)) expect(five, kind).toMatch(new RegExp(`\`${kind}\`[^\\n]*\`${image}\``));
    for (const fact of ["_PREVIOUS", "every name the code reads", "every name of a declared class", "SIRKIT_B24_BENCHMARK", "SIRKIT_JOB_STARTED_AT", "b24-a2-env-names", "NGSPICE_BIN"]) expect(five, fact).toContain(fact);
    const total = /^(\d+) rows\.(.*)$/m.exec(five); expect(total, "the section states its row total").not.toBeNull(); expect(Number([...total![2]!.matchAll(/-> (\d+)/g)].map((move) => move[1]).pop() ?? total![1]), "the stated total (the last dated move, else the count) is the census's").toBe(ENVIRONMENT_NAMES.length); // [B24-A3 review, 2026-10-08] coverage-a2-page-stale-total: the table summed to 81 under "80 rows."
  });

  it("10. [B24-A2 review, 2026-10-06] regressions-3, coverage-5 (red on the page the review read): B24-A1's page states the inventory as the tree has it - section 3's count of names (49 at A1) and its count of secrets (3 at A1) each carry a dated B24-A2 note giving FLAG_INVENTORY's size and its secret count, naming the two *_PREVIOUS names, in place (no line of A1's page moves)", () => {
    const a1 = read("artifacts/ai-control-plane-b24/environments-and-deployment.md");
    const three = a1.slice(a1.indexOf(`${NEWLINE}## 3. `), a1.indexOf(`${NEWLINE}## 4. `));
    const secrets = FLAG_INVENTORY.filter((entry) => entry.kind === "secret").length;
    expect([FLAG_INVENTORY.length, secrets]).toEqual([68, 5]); // [PR-D, 2026-10-17] reviewed pin move: 67 -> 68, SIRKIT_BUILD_ITERATION_CAP (configuration; its dated note on A1's page section 3); [B24-E, 2026-10-10] reviewed pin move: 66 -> 67, B24-E's SIRKIT_AUTH_QUALIFICATION_TENANT_ID (live-test-gate; OD-191), its own dated note on A1's page section 3 (66 -> 67), D4's note held to its own 65 -> 66; [B24-D4, 2026-10-10] reviewed pin move: 65 -> 66, B24-D4's SIRKIT_E2E_SKIP (tooling; OD-30, the lead's option A), its own dated note on A1's page section 3 (65 -> 66), D1's note held to its own 62 -> 65; [B24-A3, 2026-10-06] reviewed pin move: 51 -> 52, B24-A3's SIRKIT_TRUSTED_CLIENT_IP_HEADER (configuration); A2's note keeps its 49 -> 51 and A3's dated note on the same line gives 51 -> 52; [B24-B3, 2026-10-08] reviewed pin move: 52 -> 62, the ten live-test-gate names of B24-B3's live-suite registry (OD-209); [B24-D1, 2026-10-09] reviewed pin move: 62 -> 65, B24-D1's SIRKIT_B24_BENCHMARK (live-test-gate), SIRKIT_B24_BENCHMARK_DIR and SIRKIT_JOB_STARTED_AT (tooling) (OD-212, OD-30)
    const notes = three.split(NEWLINE).filter((line) => line.includes("[B24-A2, 2026-10-06]"));
    expect(notes.join(" ")).toContain("49 -> 51"); expect(three.split(NEWLINE).filter((line) => line.includes("[B24-A3, 2026-10-06]")).join(" ")).toContain("51 -> 52"); expect(three.split(NEWLINE).filter((line) => line.includes("[B24-B3, 2026-10-08]")).join(" ")).toContain("52 -> 62"); expect(three.split(NEWLINE).filter((line) => line.includes("[B24-D1, 2026-10-09]")).join(" ")).toContain("62 -> 65"); expect(three.split(NEWLINE).filter((line) => line.includes("[B24-D4, 2026-10-10]")).join(" ")).toContain("65 -> 66"); expect(three.split(NEWLINE).filter((line) => line.includes("[B24-E, 2026-10-10]")).join(" ")).toContain("66 -> 67"); expect(three.split(NEWLINE).filter((line) => line.includes("[PR-D, 2026-10-17]")).join(" ")).toContain(`67 -> ${FLAG_INVENTORY.length}`); // [PR-D, 2026-10-17] reviewed pin move: B24-E's note is held to its own 66 -> 67 (was: 66 -> the inventory's size), and PR-D's note carries 67 -> 68 (SIRKIT_BUILD_ITERATION_CAP, configuration); // [B24-E, 2026-10-10] reviewed pin move: D4's note is held to its own 65 -> 66 (was: 65 -> the inventory's size), and B24-E's note carries 66 -> 67 // [B24-D4, 2026-10-10] reviewed pin move: D1's note is held to its own 62 -> 65 (was: 62 -> the inventory's size), and B24-D4's note carries 65 -> 66 // [B24-B3, 2026-10-08] reviewed pin move: A3's note is held to its own 51 -> 52 and the size now rides B24-B3's dated note (was `51 -> ${FLAG_INVENTORY.length}` on A3's); [B24-D1, 2026-10-09] reviewed pin move: B3's note is held to its own 52 -> 62 and the size now rides B24-D1's dated note
    expect(notes.join(" ")).toContain(`secret (3) -> secret (${secrets})`);
    for (const name of ["SIRKIT_MCP_TOKEN_SECRET_PREVIOUS", "SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS"]) expect(notes.join(" "), name).toContain(`\`${name}\``);
    // in place: section 3 still opens on A1's line 99 and section 4 on A1's line 125
    expect(a1.split(NEWLINE)[98]).toBe("## 3. The flag inventory and the sandbox switch (D24-11, OD-200)");
    expect(a1.split(NEWLINE)[124]).toMatch(/^## 4\. /);
  });
});

/** The census by class (the page's section 5 table states the same numbers). */
const CLASS_COUNTS: Readonly<Record<string, number>> = {
  secret: 14,
  configuration: 29, // [PR-D, 2026-10-17] reviewed pin move: 28 -> 29, SIRKIT_BUILD_ITERATION_CAP (PR-C's operator cap, inventoried under OD-242); [B24-A3, 2026-10-06] reviewed pin move: 27 -> 28, SIRKIT_TRUSTED_CLIENT_IP_HEADER (D16 map from A1's configuration kind; OD-197)
  flag: 14,
  "rotation-previous": 3,
  fixture: 6,
  "qualification-opt-in": 18, // [B24-E, 2026-10-10] reviewed pin move: 17 -> 18, SIRKIT_AUTH_QUALIFICATION_TENANT_ID (D16: live-test-gate -> qualification-opt-in; the production-auth target's selector tenant, OD-191); [B24-B3, 2026-10-08] reviewed pin move: 4 -> 16, the twelve names B24-B3's live-suite registry reads (PCB_ASSIST_LIVE, SPICE_WORKER_LIVE and the ten live-test-gate names; D16, OD-209); [B24-D1, 2026-10-09] reviewed pin move: 16 -> 17, SIRKIT_B24_BENCHMARK (D16: live-test-gate -> qualification-opt-in; OD-212)
  platform: 12, // [B24-D4, 2026-10-10] reviewed pin move: 11 -> 12, SIRKIT_E2E_SKIP (D16: tooling -> platform; OD-30's split of page-browser-e2e, the lead's option A; read by playwright.config.ts); [B24-D1, 2026-10-09] reviewed pin move: 8 -> 11, SIRKIT_B24_BENCHMARK_DIR and SIRKIT_JOB_STARTED_AT (D16: tooling -> platform; OD-212, OD-30) and GITHUB_STEP_SUMMARY (the runner's step-summary path B24-D1's headroom script and latency gate append to; platform, no inventory entry)
  "child-passthrough": 1,
  "not-an-environment-name": 3,
};
