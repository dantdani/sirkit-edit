/**
 * [B24-F] The generator inventory (D24-37; OD-220): `generator-inventory.md`, rendered by `scripts/generate-b24-maps.ts`, checked
 * against the tree, the test files and the workflows.
 *
 *  1. the generator rows equal the `scripts/generate-*.ts` and `scripts/gen-*.ts` listing, each with its `pnpm exec tsx` command;
 *  2. every output path exists, the outputs table lists exactly the outputs the generator declares, and each row carries its check;
 *  3. every pinning suite exists and names its output: by repository path, by quoted path segments, by its directory with its exact
 *     base name, by a relative import of the output, or through a `__tests__` helper module it imports that does so; each row's check
 *     (`bytes`, `digest`, `content`) is the generator's reading of that suite, which holds on the reviewed anchors and bites on planted
 *     suite texts ([B24-F review, 2026-10-10] correctness-7: the pin class and the suites are derived, never typed);
 *  4. an output is byte-pinned-in-CI exactly when a `bytes` or `digest` suite of it runs in a CI job, byte-pinned-outside-CI when such
 *     suites exist and none runs, content-checked when its suites only name or read it, unpinned when none names it; each row's CI-job
 *     column equals what B24-B1's `_ci-admission.ts` (as B24-B2, D0, D1 and D4 extended it) derives for its suite (D17);
 *  5. every test file that names an output by the rule of case 3 is one of its pinning suites, and no test file names an unpinned
 *     output (a whole-tree walk; correctness-7: the suite lists are complete); this suite names outputs only as data about the page
 *     (its anchors and bites) and is no pinning suite (the generator's INVENTORY_SUITE);
 *  6. the B24 generator is listed with its own suite, and the records hold: no `package.json` script runs a generator, and the
 *     ledger's lines hold the counts the page reads.
 *
 * Failing first on 58c0834 with the generator written and its outputs absent: every case. Files are read as text; nothing is
 * written and no process starts.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { B24_MAP_FILES, B24_MAPS_DIR, GENERATOR_OUTPUTS, INVENTORY_SUITE, PIN_CLASSES, generatorScripts, pinCheckOf, suiteChecker } from "../../../../scripts/generate-b24-maps";
import { ciAdmission } from "./_ci-admission";
import { readRepo, records, tableUnder } from "./_b24-f-pages";

const ROOT = process.cwd();
const PAGE = "artifacts/ai-control-plane-b24/generator-inventory.md";
const SELF = "app/lib/qualification/__tests__/b24-f-generator-inventory.test.ts";
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const generators = () => records(tableUnder(readRepo(PAGE), "1. Generators"));
const outputs = () => records(tableUnder(readRepo(PAGE), "2. Outputs"));
const CHECKS = ["bytes", "digest", "content"] as const;

/** Every test file under app/ (a `.test.ts(x)` file in a `__tests__` directory), repository-relative. */
function testFiles(): string[] {
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
/** The relative module specifiers of a file, resolved to repository paths (without an extension). */
function relativeImports(path: string, text: string): string[] {
  return [...text.matchAll(/(?:from\s+|import\(\s*|import\s+|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g)].map((match) => posix.normalize(posix.join(posix.dirname(path), match[1]!)));
}
const withoutExtension = (path: string): string => path.replace(/\.(?:ts|tsx|mts|mjs|js|json)$/, "");
/** The `__tests__` helper modules a file imports (one level). */
const helpersOf = (path: string, text: string): string[] => relativeImports(path, text).filter((target) => target.includes("/__tests__/")).map((target) => [`${target}.ts`, `${target}.tsx`].find((candidate) => existsSync(join(ROOT, ...candidate.split("/"))) && !/\.test\.tsx?$/.test(candidate))).filter((path): path is string => path !== undefined);
/** Whether a file's text names an output: its repository path, its quoted path segments, its directory (a string, a string prefix or
 *  quoted segments) with its exact base name (quoted, or after a `/` or a `}` and before a quote), a relative import of it, or - the
 *  B24 maps - an import of `B24_MAP_FILES` from the generator. */
function namesOutput(path: string, text: string, output: string, mapList: boolean = /\bB24_MAP_FILES\b/.test(text)): boolean {
  const slash = output.lastIndexOf("/");
  const [dir, base] = [output.slice(0, slash), output.slice(slash + 1)];
  if (!text.includes(withoutExtension(base)) && !mapList) return false;
  if (text.includes(output) || text.includes(output.split("/").map((segment) => `"${segment}"`).join(", "))) return true;
  const dirNamed = [`"${dir}"`, `"${dir}/`, `\`${dir}/`, dir.split("/").map((segment) => `"${segment}"`).join(", ")].some((form) => text.includes(form));
  if (dirNamed && ["\"", "'", "`", "/", "}"].some((before) => ["\"", "'", "`"].some((after) => text.includes(`${before}${base}${after}`)))) return true;
  if (relativeImports(path, text).some((target) => withoutExtension(target) === withoutExtension(output))) return true;
  return output.startsWith(`${B24_MAPS_DIR}/`) && (B24_MAP_FILES as readonly string[]).includes(base) && mapList && relativeImports(path, text).includes("scripts/generate-b24-maps");
}
/** A suite and the `__tests__` helpers it imports, read once: whether it, or one of them, names an output. */
function suiteNamer(suite: string): (output: string) => boolean {
  const text = readRepo(suite);
  const mapList = /\bB24_MAP_FILES\b/.test(text);
  const helpers = helpersOf(suite, text).map((helper) => [helper, readRepo(helper)] as const).map(([helper, helperText]) => [helper, helperText, /\bB24_MAP_FILES\b/.test(helperText)] as const);
  return (output) => namesOutput(suite, text, output, mapList) || helpers.some(([helper, helperText, helperMapList]) => namesOutput(helper, helperText, output, helperMapList));
}
const namedBySuite = (suite: string, output: string): boolean => suiteNamer(suite)(output);

describe("[B24-F] the generator inventory is the tree's (D24-37; OD-220)", () => {
  it("1. the generator rows equal the scripts/generate-*.ts and scripts/gen-*.ts listing, in order, each with its pnpm exec tsx command and a pin class from the closed four", () => {
    const listed = readdirSync(join(ROOT, "scripts")).filter((name) => /^(?:generate|gen)-.+\.ts$/.test(name)).map((name) => `scripts/${name}`).sort();
    const rows = generators();
    expect(rows.map((row) => row.generator)).toEqual(listed);
    expect(generatorScripts(ROOT)).toEqual(listed);
    expect(Object.keys(GENERATOR_OUTPUTS).map((name) => `scripts/${name}`).sort()).toEqual(listed);
    for (const row of rows) {
      expect(row["run command"], row.generator).toBe(`pnpm exec tsx ${row.generator}`);
      for (const pinClass of row["pin classes"]!.split(", ")) expect(PIN_CLASSES as readonly string[], row.generator).toContain(pinClass);
    }
    expect(listed.length).toBeGreaterThanOrEqual(28);
  });

  it("2. every output path exists, the outputs table lists exactly the outputs the generator declares, and every row carries a check from the closed set", () => {
    expect(tableUnder(readRepo(PAGE), "2. Outputs").header).toEqual(["generator", "output", "pin class", "pinning suite", "check", "CI jobs"]);
    const rows = outputs();
    const declared = Object.entries(GENERATOR_OUTPUTS).flatMap(([script, list]) => list.map((output) => `scripts/${script} ${output}`)).sort();
    expect([...new Set(rows.map((row) => `${row.generator} ${row.output}`))].sort()).toEqual(declared);
    expect(rows.filter((row) => !existsSync(join(ROOT, ...row.output!.split("/")))).map((row) => row.output)).toEqual([]);
    for (const row of rows) expect([...CHECKS, "-"], `${row.output} ${row["pinning suite"]}`).toContain(row.check);
    expect(rows.filter((row) => (row["pinning suite"] === "none") !== (row.check === "-"))).toEqual([]);
  });

  it("3. every pinning suite exists and names its output; each row's check is the generator's reading of that suite, which holds on the reviewed anchors and bites on planted texts", () => {
    const problems: string[] = [];
    const rows = outputs();
    const checkers = new Map<string, (output: string) => string>();
    const checkOf = (suite: string, output: string): string => {
      if (!checkers.has(suite)) checkers.set(suite, suiteChecker(suite, readRepo(suite), readRepo));
      return checkers.get(suite)!(output);
    };
    for (const row of rows) {
      if (row["pinning suite"] === "none") {
        if (row["pin class"] !== "unpinned") problems.push(`${row.output}: ${row["pin class"]} with no suite`);
        continue;
      }
      const suite = row["pinning suite"]!;
      if (!existsSync(join(ROOT, ...suite.split("/"))) || !/\/__tests__\/[^/]+\.test\.tsx?$/.test(suite)) { problems.push(`${row.output}: ${suite} is no suite`); continue; }
      if (!namedBySuite(suite, row.output!)) problems.push(`${row.output}: ${suite} does not name it`);
      const want = checkOf(suite, row.output!);
      if (row.check !== want) problems.push(`${row.output} / ${suite}: check ${row.check}, the reading ${want}`);
    }
    expect(problems).toEqual([]);
    // [B24-F review, 2026-10-10] correctness-7: the reading on suites read by hand at 58c0834 - a for-of over the paths (P9), a name
    // reused in two cases with a parsed value (the fingerprint), a parsed summary, a digest through a helper's constant, a digest map,
    // parsed lines, the maps' own loop, a two-step read, a parsed reader
    const ANCHORS: ReadonlyArray<readonly [string, string, (typeof CHECKS)[number]]> = [
      ["artifacts/ai-control-plane-b20/mcp-parity.md", "app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts", "bytes"],
      ["artifacts/ai-control-plane-b20/mcp-parity.json", "app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts", "bytes"],
      ["artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv", "app/lib/engineering/__tests__/action-registry.test.ts", "bytes"],
      ["artifacts/ai-control-plane-b01/ui-control-fingerprint.json", "app/lib/engineering/__tests__/action-registry.test.ts", "content"],
      ["artifacts/ai-control-plane-b17/ui-control-inventory-summary.json", "app/lib/engineering/__tests__/b17-a-control-inventory.test.ts", "content"],
      ["artifacts/ai-control-plane-b11/replay-trace-pins.json", "app/lib/agent/orchestration/__tests__/b21-f-evaluation.test.ts", "digest"],
      ["artifacts/ai-control-plane-b11/replay-trace-pins.json", "app/lib/agent/__tests__/b11-1-trace-integrity.test.ts", "content"],
      ["app/lib/agent/generated/pcb-shape-descriptor.ts", "app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts", "digest"],
      ["app/lib/agent/generated/pcb-shape-descriptor.ts", "app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts", "bytes"],
      ["artifacts/ai-control-plane-b10/runtime-tool-availability.csv", "app/lib/agent/__tests__/b10-editor-context.test.ts", "content"],
      ["artifacts/ai-control-plane-b24/trust-boundary-map.md", "app/lib/qualification/__tests__/b24-f-maps.test.ts", "bytes"],
      ["artifacts/ai-control-plane-b24/threshold-census.csv", "app/lib/qualification/__tests__/b24-d1-threshold-census.test.ts", "bytes"],
    ];
    for (const [output, suite, check] of ANCHORS) expect(rows.find((row) => row.output === output && row["pinning suite"] === suite)?.check, `${output} / ${suite}`).toBe(check);
    // the reading bites on planted suite texts: a whole-text equality, a parsed equality, a file digest, a for-of over paths, a split
    // read, and a name that a later case binds to another file
    const OUT = ["x", "y", "out.csv"].join("/");
    const OTHER = ["x", "y", "other.csv"].join("/");
    const planted: ReadonlyArray<readonly [string, string]> = [
      [`const P = "${OUT}";\nit("a", () => { expect(read(P)).toBe(render()); });`, "bytes"],
      [`it("a", () => { expect(JSON.parse(read("${OUT}"))).toEqual(value); });`, "content"],
      [`it("a", () => { expect(createHash("sha256").update(readFileSync(join(ROOT, "${OUT}"))).digest("hex")).toBe(PIN); });`, "digest"],
      [`it("a", () => { for (const [path, render] of [["${OUT}", r]] as const) expect(read(path)).toBe(render()); });`, "bytes"],
      [`it("a", () => { expect(read("${OUT}").split("\\n")).toContain("a"); });`, "content"],
      [`it("a", () => { const committed = read("${OTHER}"); expect(committed).toBe(r()); });\nit("b", () => { const committed = JSON.parse(read("${OUT}")); expect(committed).toEqual(v); });`, "content"],
    ];
    expect(planted.map(([text]) => pinCheckOf("app/x/__tests__/probe.test.ts", text, OUT, () => ""))).toEqual(planted.map(([, check]) => check));
  });

  it("4. a byte-pinned-in-CI output has a bytes or digest suite a CI job selects, a byte-pinned-outside-CI one has such suites and none selected, a content-checked one only content suites, an unpinned one none; each row's CI-job column is what _ci-admission.ts derives for its suite (D17)", () => {
    const admission = ciAdmission();
    const rows = outputs();
    const problems: string[] = [];
    for (const row of rows) {
      const expected = row["pinning suite"] === "none" ? [] : admission.jobsOf(row["pinning suite"]!);
      if (row["CI jobs"] !== (expected.length === 0 ? "none" : expected.join(", "))) problems.push(`${row.output} / ${row["pinning suite"]}: ${row["CI jobs"]}, derived ${expected.join(", ") || "none"}`);
    }
    for (const output of new Set(rows.map((row) => row.output))) {
      const own = rows.filter((row) => row.output === output);
      const byteRows = own.filter((row) => row.check === "bytes" || row.check === "digest");
      const want = own.every((row) => row["pinning suite"] === "none") ? "unpinned" : byteRows.length === 0 ? "content-checked" : byteRows.some((row) => row["CI jobs"] !== "none") ? "byte-pinned-in-CI" : "byte-pinned-outside-CI";
      if (new Set(own.map((row) => row["pin class"])).size !== 1) problems.push(`${output}: two pin classes`);
      if (own[0]!["pin class"] !== want) problems.push(`${output}: ${own[0]!["pin class"]}, its checks give ${want}`);
    }
    expect(problems).toEqual([]);
    expect(rows.some((row) => row["pin class"] === "byte-pinned-in-CI")).toBe(true);
  });

  it("5. every test file that names an output is one of its pinning suites, and no test file names an unpinned output (a whole-tree walk)", { timeout: 180_000 }, async () => {
    await yieldToLoop();
    const rows = outputs();
    const listed = new Map<string, Set<string>>();
    for (const row of rows) if (row["pinning suite"] !== "none") listed.set(row.output!, (listed.get(row.output!) ?? new Set()).add(row["pinning suite"]!));
    const all = [...new Set(rows.map((row) => row.output!))];
    expect(all.filter((output) => !listed.has(output)).length).toBeGreaterThan(0);
    const unlisted: string[] = [];
    let done = 0;
    // this suite names outputs only as data about the page (its anchors and bites), never to pin one (the generator's INVENTORY_SUITE)
    expect(INVENTORY_SUITE).toBe(SELF);
    for (const suite of testFiles().filter((path) => path !== SELF)) {
      const names = suiteNamer(suite);
      for (const output of all) if (names(output) && !listed.get(output)?.has(suite)) unlisted.push(`${suite} names ${output}`);
      if (++done % 80 === 0) await yieldToLoop();
    }
    expect(unlisted).toEqual([]);
    // the walk bites: a suite importing the demo fixtures by a relative specifier, without its extension, names them
    const demo = ["app/lib/pcb/demo", "fixtures.ts"].join("/");
    expect(namesOutput(["app/lib/pcb/demo/__tests__", "probe.test.ts"].join("/"), `import { X } from "../fixtures";`, demo)).toBe(true);
  });

  it("6. the B24 generator is listed with its own suite for each of its six outputs, and the records hold: no package.json script runs a generator, and each ledger line holds the count the page reads", () => {
    const own = outputs().filter((row) => row.generator === "scripts/generate-b24-maps.ts");
    expect(new Set(own.map((row) => row.output)).size).toBe(6);
    for (const output of new Set(own.map((row) => row.output))) expect(own.filter((row) => row.output === output && row.check === "bytes").map((row) => row["pinning suite"]), output).toContain("app/lib/qualification/__tests__/b24-f-maps.test.ts");
    expect(own.every((row) => row["pin class"] === "byte-pinned-in-CI")).toBe(true);
    const scripts = Object.values((JSON.parse(readRepo("package.json")) as { scripts: Record<string, string> }).scripts);
    expect(scripts.filter((command) => /scripts\/gen(?:erate)?-/.test(command))).toEqual([]);
    expect(records(tableUnder(readRepo(PAGE), "3.1 `package.json` scripts"))).toEqual([{ scripts: String(scripts.length), "scripts that run a generator": "0", "regenerate-all or drift command": "0" }]);
    const ledger = readRepo("artifacts/remaining-builder-program/EXECUTION_LEDGER.md").split(String.fromCharCode(10));
    for (const row of records(tableUnder(readRepo(PAGE), "3.3 The ledger's generator counts"))) {
      const line = Number(/:(\d+)$/.exec(row["path:line"]!)![1]);
      expect(ledger[line - 1], row["path:line"]).toContain(`${row.count} generators`);
    }
  });
});
