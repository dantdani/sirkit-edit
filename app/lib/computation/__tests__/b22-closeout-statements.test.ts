/**
 * [B22 closeout (1/2), 2026-10-02] The closeout's tripwire (D22-14's closeout half under OD-144, D22-16's retitles; the D20-30 / B21
 * pattern of `b21-closeout-statements`). Since B22 the legacy ngspice paths start no process of their own: every ngspice process is
 * the diagnostic runner's, diagnostic only, with no isolation boundary and no OS limit (OD-134, OD-136, OD-145), the executable is the
 * digest-pinned install (OD-135), and the agent set is 36 (OD-139). So the standing statements that called the runner a sandbox,
 * confined, isolated or networkless, called local execution authoritative, chose the executable from PATH, or counted the set as 12
 * or 33 are superseded IN PLACE with a dated note - never rewritten, no line added - and the stale titles are retitled to what their
 * bodies assert (assertions and `it(` counts unchanged). This suite pins that no production source, test file or page states a
 * superseded claim uncorrected outside a small explicit allow-list, that each production note keeps what it must say, that the
 * retired titles never come back, that every page statement the closeout noted keeps its note in its own block, that the closeout
 * page's dated note covers the B16.0.23..B16.0.24.1 simulator stop-condition lines, and that its export record holds against the tree.
 * [B22 closeout (1/2) review] Since the review: pages are scanned for the counts and 'no network' beside ngspice too (each admission
 * pinned), a count of 12 is a claim only in the agent-set wording, page notes keep what their statements need, each tombstone is its
 * signature's, and the page's note and retitle tables are re-derived row for row (case 9).
 * Failing first on c9fbbb0 (before the notes, the retitles and the page): see `closeout-statements.md` section 5. Files are read as
 * text; nothing is written to disk and no process is started.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
/** The closeout's dated note, as every superseded statement carries it (the references after the parenthesis vary by item). */
const NOTE = "[superseded 2026-10-02 by the B22 closeout (";
/** The same-line note every retitled case carries. */
const RETITLED = "[B22 closeout, 2026-10-02] retitled (D22-16)";
const SELF = "app/lib/computation/__tests__/b22-closeout-statements.test.ts";
const PAGE = "artifacts/ai-control-plane-b22/closeout-statements.md";

/** The superseded claims, in the vocabulary the closeout's sweep used (D22-14's class). Code and pages are scanned for these. */
const CLAIMS: ReadonlyArray<readonly [string, RegExp]> = [
  ["the ngspice runner as a sandbox or a confined process", /\bngspice sandbox\b|\bsandboxed or blocked\b|\bsafely confined\b/gi],
  // [B22 closeout (1/2) review] tests-2: and 'no network' in one sentence with ngspice, the diagnostic runner or the simulator
  ["'no network' as the runner's own guarantee", /no network, a strict timeout|runner performs no network I\/O|\bno network\b(?!, no model)(?:[^.|\n]|\n(?![\n#|]|\s*- |\s*\d+\. ))*?\b(?:ngspice|diagnostic runner|simulat)|\b(?:ngspice|diagnostic runner|simulat)\w*(?:[^.|\n]|\n(?![\n#|]|\s*- |\s*\d+\. ))*?\bno network\b(?!, no model)/gi],
  ["local execution as authoritative", /authoritative execution stays available|authoritative execution was not expanded/gi],
  ["the ngspice run as isolated", /\bisolated ngspice\b|\bisolated smoke test\b|server-owned isolated fixture|isolated queued jobs/gi],
  ["the executable chosen from PATH", /selected from mutable environment\/PATH|selects ngspice from mutable|mutable PATH execution|mutable PATH\/no validated|installed and on `PATH`/gi],
];
/** ... and the counts and process facts B22 changed (D22-16's class; OD-136, OD-139, OD-140). Code (production and tests) is scanned
 *  for all of these; [B22 closeout (1/2) review] tests-2: so are the pages, outside the page allow-list and the dated chapters below. */
const CODE_CLAIMS: ReadonlyArray<readonly [string, RegExp]> = [
  ...CLAIMS,
  ["the simulate route as the process pattern", /NGSpice pattern in|the NGSpice route: spawn/gi],
  // [B22 closeout (1/2) review] regressions-1: a count of 12 only in the agent-set wording it targets (never "exactly 12 pads")
  ["a stale agent-set or registry count", /tools (?:remain )?exactly 12\b|exposure (?:is|remains) exactly 12\b|exposes exactly 12 tools|exactly 12 (?:agent-exposed|exposed tools)|exactly 12 with exactly (?:that one|ONE) PCB|agent surface: exactly 12\b|all eleven exposed|outside the 33|the 33 approve|subset of the 33|\(33 ids\)|every one of the 33|reviewed 33\b|identity, 33 ids|\(33 with it\)|the 24 agent tools|42 x 5 today/gi],
  ["the five spawners", /\bfive (?:process )?spawners\b/gi],
  ["one addition as the only difference", /the addition is the only difference|pins the addition as the only|by that ONE descriptor and nothing else|A4's one descriptor is the only difference/gi],
  ["process configuration before B22-A3 or B22-B", /module constants, not body-derived|allowlist of all three spawners|each naming child_process/gi],
];

/** The code lines that state a claim and are true as written, each allowed by its exact text (the pages have their own list below). */
const ALLOWED: ReadonlyArray<{ readonly path: string; readonly text: string; readonly why: string }> = [
  { path: "app/lib/computation/__tests__/b22-b-catalog.test.ts", text: "for (const title of [\"no id of the reviewed 33 matches a pattern today\"", why: "B22-B's page pin: named-computations.md section 9 quotes the two titles as they read before this closeout" },
  { path: "app/lib/computation/__tests__/b22-b-catalog.test.ts", text: "// the prose only: the section 8 citation table records the base", why: "B22-B's comment naming the B21 citation row's words, as of the row's date" },
  { path: "app/lib/computation/__tests__/b22-b-catalog.test.ts", text: "/outside the 33|reviewed 33|the 33 are not/", why: "B22-B's own tripwire over the B21 specialist-roles prose" },
  { path: "app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts", text: " * five spawners by absence alone (F4).", why: "B20-B4 history: until B4 the dispatch header held for four of the five spawners of that time" },
];
/** The one statement wrapped over two lines whose note sits on the NEXT line. */
const WRAPPED: ReadonlyArray<{ readonly path: string; readonly text: string }> = [
  { path: "app/lib/pcb/autoroute/runner.ts", text: "Freerouting subprocess runner (PCB Stage 9). Mirrors the NGSpice pattern in" },
];
/** [B22 closeout (1/2) review] tests-2: the page lines that state a claim and stay as written - the finder's dated records, each by text
 *  on the line the statement starts on, with what each admits pinned in case 2 (no other page line is allowed). */
const PAGE_ALLOWED: ReadonlyArray<{ readonly path: string; readonly text: string; readonly why: string }> = [
  { path: "artifacts/ai-control-plane-b16-0-23/compilation-confinement-proof.md", text: "- **No simulator, no fs, no network, no process, no env** in the compile call", why: "true as written: the compile call graph imports no simulator, file, network or process module - a statement about the compiler, not the runner" },
  { path: "artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md", text: "The lead ran ngspice-46 (`ngspice_con -b`, Windows;", why: "SEC-1's probe method: each probe deck ran only ngspice's own echo and set, read no path outside its directory and used no network - the probe decks, not the runner" },
  { path: "artifacts/ai-control-plane-b21/README.md", text: "a qualification or any id outside the 33 never validates", why: "B21's dated chapter row (the B21 README is the B21 lead's record of its own close)" },
  { path: "artifacts/ai-control-plane-b21/orchestration-contracts.md", text: "a qualification or any id outside the 33 never validates", why: "the same B21 dated chapter row, copied onto the B21-A page" },
  { path: "artifacts/ai-control-plane-b21/orchestration-contracts.md", text: "| C24 | `app/lib/engineering/agent-exposure.ts` | 30 |", why: "a B21 'Citations, as of base' row: the cited line as it read on B21's base" },
  { path: "artifacts/ai-control-plane-b21/specialist-roles.md", text: "| C27 | `app/lib/engineering/agent-exposure.ts` | 30 |", why: "a B21 'Citations, as of base' row: the cited line as it read on B21's base" },
  { path: "artifacts/ai-control-plane-b21/specialist-roles.md", text: "(an id outside the 33 [B22-B review, 2026-10-02: 36]", why: "corrected in place by B22-B's own dated count note" },
  { path: "artifacts/ai-control-plane-b21/specialist-roles.md", text: "a registry id outside the 33 [B22-B review, 2026-10-02: 36]", why: "corrected in place by B22-B's own dated count note" },
  { path: "artifacts/ai-control-plane-b21/specialist-roles.md", text: "no id of the reviewed 33 [B22-B review, 2026-10-02: 36]", why: "corrected in place by B22-B's own dated count note" },
  { path: "artifacts/ai-control-plane-b22/threat-model.md", text: "by reading the five spawners; [B22-A3, 2026-10-01] three since the three", why: "corrected in place by B22-A3's own dated note" },
  { path: "artifacts/ai-control-plane-b22/deck-and-secret-corrections.md", text: "five spawners - the new module imports no process module)", why: "a B22-A1 gate record: the spawners as that run found them" },
  { path: "artifacts/ai-control-plane-b22/deck-and-secret-corrections.md", text: "census 20 files 218 passed (165 / 162 / 3 / 0, five spawners)", why: "a B22-A1 gate record: the spawners as that run found them" },
  { path: "artifacts/ai-control-plane-b22/runtime-profiles.md", text: "`b20-b4-process-gate` (still exactly the five spawners)", why: "a B22-A2 gate record: the spawners as that run found them" },
  { path: "artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md", text: "b20-b4-process-gate` (the five spawners unchanged - the fix adds none)", why: "a SEC-1 gate record: the spawners as that run found them" },
  { path: `artifacts/ai-control-plane-b22/named-computations.md`, text: "case 7's title, \"... the 33 approve nothing; ... since no id of the reviewed 33 matches a pattern today\"", why: "B22-B's list of the stale titles it left to the closeout, quoting them as they read; b22-b-catalog case 7 pins the quote, and F2's note records the retitle" },
  { path: `artifacts/ai-control-plane-b22/named-computations.md`, text: "case 3's title, \"naming an id outside the 33\";", why: "the same B22-B list, quoting the title as it read; F2's note records the retitle" },
  { path: `artifacts/ai-control-plane-b22/named-computations.md`, text: "case 5's title, \"the agent set is still B3's 32 without A4's one addition (33 with it)\"", why: "the same B22-B list; b22-b-catalog case 7 pins the quote, and F2's note records the retitle" },
  { path: `artifacts/ai-control-plane-b22/named-computations.md`, text: "- the comments `b21-a-contracts.test.ts:6` (\"outside the 33\") and `b21-c-role-tools.test.ts:140` (\"outside the 33\");", why: "the same B22-B list, quoting the two comments as they read; each carries the closeout's note in place" },
];
/** [B22 closeout (1/2) review] tests-2: the B15 and B16 chapters' own verdicts and reports count the agent set as it was on their dates
 *  ("exactly 12"); they are dated chapter records the closeout leaves as written, admitted for that claim only, their number pinned. */
const PAGE_HISTORY = { dir: /^artifacts\/ai-control-plane-b1[56](?:-[0-9a-z-]+)?\//, claim: "a stale agent-set or registry count", admits: 38 } as const;
const PAGE_ALLOWED_ADMITS = 20;

const SOURCE = /\.(?:tsx?|mjs|cjs|js)$/;
function sources(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" || entry.name.startsWith(".") ? [] : sources(path);
    return SOURCE.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
const productionSources = (): string[] => [
  ...["app", "lib", "components", "scripts", "e2e", "e2e-orchestration"].flatMap((dir) => sources(dir)),
  ...readdirSync(ROOT, { withFileTypes: true }).filter((entry) => entry.isFile() && SOURCE.test(entry.name)).map((entry) => entry.name),
];
function everyFile(dir: string, keep: (name: string) => boolean): string[] {
  let entries;
  try {
    entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name.startsWith(".") ? [] : everyFile(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}
/** The lead's records (reserved files) quote the claims; they are not scanned. */
const LEAD_RECORDS = (path: string): boolean => path.startsWith("artifacts/remaining-builder-program/") || path === "artifacts/ai-control-plane-b22/README.md" || path === "artifacts/ai-control-plane-b22/discovery.md";
const testFiles = (): string[] => everyFile("app", (name) => SOURCE.test(name)).filter((path) => (path.includes("/__tests__/") || /\.test\.tsx?$/.test(path)) && path !== SELF);
/** Every page: the artifacts' Markdown (the lead's records and this closeout's own page aside), the docs and the root README. */
const pages = (): string[] => [
  ...everyFile("artifacts", (name) => name.endsWith(".md")).filter((path) => !LEAD_RECORDS(path) && path !== PAGE),
  ...everyFile("docs", (name) => name.endsWith(".md")),
  "README.md",
];
const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

/** Every code line that states a claim with no closeout note on it (or, for the wrapped statement, on the line after it), outside the allow-list. */
function uncorrectedCode(paths: readonly string[], text: (path: string) => string): string[] {
  const found: string[] = [];
  for (const path of paths) {
    const lines = text(path).split(NEWLINE);
    lines.forEach((line, index) => {
      for (const [claim, pattern] of CODE_CLAIMS) {
        if (!new RegExp(pattern.source, pattern.flags).test(line)) continue;
        if (line.includes(NOTE)) continue;
        if ((lines[index + 1] ?? "").includes(NOTE) && WRAPPED.some((entry) => entry.path === path && line.includes(entry.text))) continue;
        if (ALLOWED.some((entry) => entry.path === path && line.includes(entry.text))) continue;
        found.push(`${path}:${index + 1} (${claim})`);
      }
    });
  }
  return found;
}
/** A page statement's own block: a table row is its line; otherwise from the statement to a blank line, a bullet, a numbered item or a heading. */
function blockAt(text: string, index: number): string {
  const lineStart = text.lastIndexOf(NEWLINE, index) + 1;
  const lineEnd = text.indexOf(NEWLINE, index);
  if (text.startsWith("|", lineStart)) return text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
  const rest = text.slice(index);
  const end = /\n\n|\n {0,4}- |\n {0,4}\d+\. |\n#/.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}
/** Every page statement of a claim whose own block carries no closeout note, with the line it starts on. */
function pageClaims(paths: readonly string[], text: (path: string) => string): Array<{ readonly path: string; readonly line: number; readonly claim: string; readonly text: string }> {
  const found: Array<{ readonly path: string; readonly line: number; readonly claim: string; readonly text: string }> = [];
  for (const path of paths) {
    const page = text(path);
    const lines = page.split(NEWLINE);
    for (const [claim, pattern] of CODE_CLAIMS) {
      for (const match of page.matchAll(new RegExp(pattern.source, pattern.flags))) {
        if (blockAt(page, match.index!).includes(NOTE)) continue;
        const line = page.slice(0, match.index!).split(NEWLINE).length;
        found.push({ path, line, claim, text: lines[line - 1] ?? "" });
      }
    }
  }
  return found;
}
/** What admits a page statement: an allowed line, or a dated B15/B16 chapter record of the count. */
const admittedBy = (found: { readonly path: string; readonly claim: string; readonly text: string }): "allowed" | "history" | null =>
  PAGE_ALLOWED.some((entry) => entry.path === found.path && found.text.includes(entry.text)) ? "allowed" : PAGE_HISTORY.dir.test(found.path) && found.claim === PAGE_HISTORY.claim ? "history" : null;
/** Every page statement of a claim whose own block carries no closeout note and that nothing admits. */
function uncorrectedPages(paths: readonly string[], text: (path: string) => string): string[] {
  return pageClaims(paths, text).filter((found) => admittedBy(found) === null).map((found) => `${found.path}:${found.line} (${found.claim})`);
}
/** The text with every closeout note removed, from its opening bracket to the bracket that closes it. */
function unnoted(text: string): string {
  let out = text;
  for (let start = out.indexOf(NOTE); start >= 0; start = out.indexOf(NOTE)) {
    let depth = 0;
    let end = start;
    for (; end < out.length; end += 1) {
      if (out[end] === "[") depth += 1;
      else if (out[end] === "]" && --depth === 0) break;
    }
    out = out.slice(0, start) + out.slice(end + 1);
  }
  return out;
}
/** Each closeout note's own text. */
function notesIn(text: string): string[] {
  const found: string[] = [];
  for (let start = text.indexOf(NOTE); start >= 0; start = text.indexOf(NOTE, start + 1)) {
    let depth = 0;
    let end = start;
    for (; end < text.length; end += 1) {
      if (text[end] === "[") depth += 1;
      else if (text[end] === "]" && --depth === 0) break;
    }
    found.push(text.slice(start, end + 1));
  }
  return found;
}

/** The superseded production statements and what each note must keep saying - ALL eight production lines that carry the note. */
const NOTED: ReadonlyArray<{ readonly path: string; readonly claim: string; readonly keeps: readonly string[] }> = [
  { path: "app/api/simulate/route.ts", claim: " * confined ngspice sandbox.", keeps: ["this route starts no process", "no isolation boundary", "no OS limit", "production simulation authority stays BLOCKED"] },
  { path: "app/api/simulate/route.ts", claim: " * env), no network, a strict timeout", keeps: ["never a denial", "are the diagnostic runner's"] },
  { path: "app/model-simulation/page.tsx", claim: "Mutable PATH execution cannot sign off CD-10.", keeps: ["digest-pinned install", "still diagnostic only"] },
  { path: "app/lib/model-simulation/provider.ts", claim: "\"Executable is selected from mutable environment/PATH.\"", keeps: ["digest-pinned install", "providerRevisionId"] },
  { path: "app/lib/model-simulation/provider.ts", claim: "localeAndTimeZone: \"uncontrolled-local\"", keeps: ["exact map", "no HOME or USERPROFILE", "Node's eight win32 additions"] }, // [B22 closeout (1/2) review] security-3: and the caveat beside it
  { path: "app/api/spice/models/smoke-test/route.ts", claim: "\"Minimal isolated ngspice fixture completed.\"", keeps: ["not isolated", "no isolation boundary"] },
  { path: "app/lib/pcb/autoroute/runner.ts", claim: " * app/api/simulate/route.ts: write input to a temp file", keeps: ["starts no process", "does not share"] },
  { path: "app/lib/pcb/fab/kicad-cli-runner.ts", claim: "// runFreerouting / the NGSpice route: spawn", keeps: ["starts no process", "does not share"] },
];

/** The stale titles the closeout retitled (assertions unchanged): the retired wording, per suite - it may never return in a title. */
const RETIRED_TITLES: ReadonlyArray<readonly [string, string]> = [
  ["app/lib/auth/__tests__/b16-0-20-simulation-confinement-gate.test.ts", "tools EXACTLY 12;"],
  ["app/lib/auth/__tests__/b16-0-21-tranche14-confinement-gate.test.ts", "tools EXACTLY 12;"],
  ["app/lib/auth/__tests__/b16-0-23-tranche16-confinement-gate.test.ts", "tools remain EXACTLY 12 agent-exposed"],
  ["app/lib/auth/__tests__/b16-0-24-tranche17-confinement-gate.test.ts", "exactly 12 agent-exposed tools"],
  ["app/lib/auth/__tests__/b16-0-24-tranche17-confinement-gate.test.ts", "the executable/env/limits are module constants"],
  ["app/lib/auth/__tests__/b16-0-24-tranche17-confinement-gate.test.ts", "the pinned install and the profile's exact map"], // [B22 closeout (1/2) review] tests-4: the first retitle named runner facts its body never reads
  ["app/lib/auth/__tests__/b16-0-ai-approval-lifecycle.test.ts", "agent exposure remains exactly 12"],
  ["app/lib/pcb/proposal/__tests__/b15-2-2-exact-outline-and-shape.test.ts", "exposure is exactly 12 with"],
  ["app/lib/pcb/proposal/__tests__/b15-2-core-closure.test.ts", "exposes exactly 12 tools"],
  ["app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts", "own row (33 ids)"],
  ["app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts", "naming an id outside the 33"],
  ["app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts", "the 33 approve nothing"],
  ["app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts", "no id of the reviewed 33 matches"],
  ["app/lib/agent/orchestration/__tests__/b21-c-role-tools.test.ts", "subset of the 33 within"],
  ["app/lib/agent/orchestration/__tests__/b21-c-role-tools.test.ts", "(identity, 33 ids)"],
  ["app/lib/agent/orchestration/__tests__/b21-a-contracts.test.ts", "(a subset of the 33)"],
  ["app/lib/agent/orchestration/__tests__/b21-a-contracts.test.ts", "an id outside the 33"],
  ["app/lib/agent/orchestration/__tests__/b21-a-contracts.test.ts", "every one of the 33 exposed ids"],
  ["app/lib/engineering/__tests__/b20-b3-mcp-subset-move.test.ts", "(33 with it)"],
  ["app/lib/engineering/__tests__/b20-b1-mcp-exposure.test.ts", "the 24 agent tools"],
  ["app/lib/engineering/__tests__/b20-b1-mcp-exposure.test.ts", "A4's one descriptor is the only difference"],
  ["app/lib/computation/__tests__/b22-a2-runtime-profile.test.ts", "the ngspice allowlist of all three spawners"],
  ["app/lib/computation/__tests__/b22-a2-process-census.test.ts", "each naming child_process"],
  ["app/lib/agent/__tests__/b09-1-boundary.test.ts", "all eleven exposed schemas"],
];
/** Each retitled suite's `it(` count, as measured on c9fbbb0: a retitle never changes one (several are pinned on their pages). */
const IT_COUNTS: Readonly<Record<string, number>> = {
  "app/lib/auth/__tests__/b16-0-20-simulation-confinement-gate.test.ts": 9,
  "app/lib/auth/__tests__/b16-0-21-tranche14-confinement-gate.test.ts": 9,
  "app/lib/auth/__tests__/b16-0-23-tranche16-confinement-gate.test.ts": 10,
  "app/lib/auth/__tests__/b16-0-24-tranche17-confinement-gate.test.ts": 14,
  "app/lib/auth/__tests__/b16-0-ai-approval-lifecycle.test.ts": 5,
  "app/lib/pcb/proposal/__tests__/b15-2-2-exact-outline-and-shape.test.ts": 14,
  "app/lib/pcb/proposal/__tests__/b15-2-core-closure.test.ts": 20,
  "app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts": 10,
  "app/lib/agent/orchestration/__tests__/b21-c-role-tools.test.ts": 5,
  "app/lib/agent/orchestration/__tests__/b21-a-contracts.test.ts": 15,
  "app/lib/engineering/__tests__/b20-b3-mcp-subset-move.test.ts": 8,
  "app/lib/engineering/__tests__/b20-b1-mcp-exposure.test.ts": 22,
  "app/lib/computation/__tests__/b22-a2-runtime-profile.test.ts": 18,
  "app/lib/computation/__tests__/b22-a2-process-census.test.ts": 7,
  "app/lib/agent/__tests__/b09-1-boundary.test.ts": 18,
};

const B24 = "artifacts/ai-control-plane-b16-0-24/";
const B23 = "artifacts/ai-control-plane-b16-0-23/";
const B22 = "artifacts/ai-control-plane-b22/";
const OC = "artifacts/ai-control-plane-b21/orchestration-contracts.md";
const DS = `${B22}deck-and-secret-corrections.md`;
/** Every page statement the closeout noted: each carries the note in its own block (bullet, numbered item, paragraph or table row). */
const NOTED_PAGES: ReadonlyArray<readonly [string, string]> = [
  [`${B24}simulate-process-security-proof.md`, "hardened into a confined"],
  [`${B24}simulate-process-security-proof.md`, "runner performs no network I/O"],
  [`${B24}unknowns-and-owner-decisions.md`, "so authoritative execution stays available"],
  [`${B24}README.md`, "was hardened into a confined ngspice sandbox."],
  [`${B24}final-verdict.md`, "| simulation execution safely confined |"],
  [`${B24}human-truth-contract.md`, "Authoritative execution was NOT expanded"],
  [`${B24}simulate-input-confinement.md`, "| executable | `NGSPICE_EXECUTABLE` module constant"],
  [`${B24}simulate-input-confinement.md`, "| arguments | fixed `[\"-b\", netlistPath]`"],
  [`${B24}simulate-input-confinement.md`, "| working directory | per-request `mkdtemp` isolated dir"],
  [`${B24}simulate-input-confinement.md`, "| environment | `safeEnvironment()` allowlist"],
  [`${B24}simulate-input-confinement.md`, "Gate: the spawn args never reference `body`"],
  [`${B24}simulator-output-and-cleanup-proof.md`, "| stdout/stderr accumulation |"],
  [`${B24}simulator-output-and-cleanup-proof.md`, "`finally { if (directory) await rm(directory, { recursive: true, force: true })"],
  [`${B24}simulator-output-and-cleanup-proof.md`, "The per-request isolated directory guarantees no cross-run artifact leakage"],
  ["artifacts/ai-control-plane-b16-0-24-1/superseded-claims.md", "ratchet, the chat boundary/streaming/tracing proofs, the simulate spawn"],
  [`${B23}final-verdict.md`, "| execution sandboxed or blocked |"],
  [`${B23}smoke-test-truthfulness-proof.md`, "runs a minimal isolated ngspice fixture"],
  [`${B23}smoke-test-truthfulness-proof.md`, "**Server-owned isolated fixture**"],
  [`${B23}unknowns-and-owner-decisions.md`, "**smoke-test / /api/simulate spawns inherit the full server env**"],
  [`${B23}pre-edit-counterexamples.md`, "The smoke-test spawn inherits the full server environment"],
  [`${B23}reports-and-bundles-proof.md`, "**No directory traversal**: the optional raw-vector read is confined by a"],
  ["artifacts/ai-control-plane-b16-0-20/zero-process-zero-network-proof.md", "measure/denominator/readiness/propose are pure computations over the"],
  ["README.md", "Isolated queued jobs with manifests"],
  ["docs/STATUS.md", "Simulation depends on an external binary being installed and on `PATH`"],
  ["docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md", "| `app/lib/spice/server/worker.ts` | Selects ngspice from mutable environment/PATH"],
  ["docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md", "| Provider state | Local ngspice diagnostic only; mutable PATH"],
  ["artifacts/ai-control-plane-b20/mcp-server-proposals.md", "So none of the app's five process spawners is reached"],
  [OC, "(C24, the one reviewed 33-id list)"],
  [OC, "mutation, an atomic authority command, an id outside the 33"],
  [OC, "Every one of the 33"],
  [OC, "the two external reads and the proposal tools"],
  [OC, "(case 7 pins every one of the 33"],
  ["artifacts/ai-control-plane-b21/specialist-roles.md", "every row a sorted, duplicate-free subset of the 33"],
  [DS, "SEC-1's suite still pins the allowlist literally"],
  [DS, "`/api/simulate` keeps its own caps (1 MB per stream, 3,000-character errors)"],
  [DS, "The ngspice allowlist is untouched: HOME and USERPROFILE in it"],
  [DS, "FreeRouting's shared `tmpdir()` cwd and its"],
  [DS, "- **D22-4:** the compile preview keeps"],
  [DS, "- **D22-5:** HOME and USERPROFILE in the ngspice allowlist"],
  [DS, "- **D22-7 (B22-C):**"],
  [DS, "- **D22-8:** the worker's whole read of `result.raw`"],
  [DS, "- **OD-150:** the evidence half (D22-21) - B22-C."],
  [`${B22}isolation-verdict.md`, "| executable identity |"],
  [`${B22}isolation-verdict.md`, "| secrets in the child environment |"],
  [`${B22}isolation-verdict.md`, "| filesystem |"],
  [`${B22}isolation-verdict.md`, "| wall clock and kill |"],
  [`${B22}threat-model.md`, "| the host filesystem |"],
  [`${B22}threat-model.md`, "| T7 |"], // [B22 closeout (1/2) review] coverage-4: T7's hand-off of the FreeRouting and kicad-cli kills to "B22-B/D"
  [`${B22}runtime-profiles.md`, "no runner reads a profile yet"],
  [`${B22}named-computations.md`, "D22-10 stays B22-C's for them)"],
  [`${B22}named-computations.md`, "now carry a dated note (36), in place, with no line moved."],
  [`${B22}sec-1-spice-deck-injection.md`, "The suite pins the three allowlists equal"],
  [`${B22}sec-1-spice-deck-injection.md`, "in the allowlist (B22-A3's profile environment)"],
  [`${B22}sec-1-spice-deck-injection.md`, "**The environment allowlist** is unchanged and pinned equal across the three ngspice spawners."],
  [`${B22}sec-1-spice-deck-injection.md`, "**Residual (unchanged from round 1, recorded for B22-A1):**"],
  [`${B22}diagnostic-runner.md`, "(the run-plan preflight is the job"],
  [`${B22}diagnostic-runner.md`, "- FreeRouting and kicad-cli keep their legacy spawns"], // [B22 closeout (1/2) review] coverage-4: the same hand-off
  [`${B22}diagnostic-runner.md`, "The B16.0.24 \"sandbox\" sentences in `/api/simulate`'s header stay for the closeout"],
  [`${B22}simulation-authority.md`, "The dated notes beside the B16.0.24 records and the"],
  [`${B22}simulation-authority.md`, "- **OD-144**: the UI half applied as its default"],
];
/** [B22 closeout (1/2) review] What a page statement's note must keep saying (and never say): the open INFERRED readings stay open, a
 *  kill_unconfirmed run is no "exit", and the exact map is not the child's whole environment on win32. */
const PAGE_NOTE_KEEPS: ReadonlyArray<{ readonly path: string; readonly statement: string; readonly keeps: readonly string[]; readonly never: readonly string[]; readonly finding: string }> = [
  { path: `${B22}sec-1-spice-deck-injection.md`, statement: "**Residual (unchanged from round 1, recorded for B22-A1):**", keeps: ["INFERRED until a live probe", "still open"], never: [], finding: "security-1" },
  { path: DS, statement: "- **D22-4:** the compile preview keeps", keeps: ["still open: the XSPICE card and token readings (INFERRED until a live probe", "osdi load"], never: [], finding: "security-1, coverage-3" },
  { path: `${B22}isolation-verdict.md`, statement: "| wall clock and kill |", keeps: ["kill_unconfirmed", "slot held"], never: ["terminal only after exit"], finding: "security-2" },
  { path: `${B22}isolation-verdict.md`, statement: "| filesystem |", keeps: ["kill_unconfirmed"], never: ["on every path"], finding: "security-2" },
  { path: `${B22}threat-model.md`, statement: "| the host filesystem |", keeps: ["kill_unconfirmed"], never: ["on every path"], finding: "security-2" },
  { path: DS, statement: "`/api/simulate` keeps its own caps (1 MB per stream, 3,000-character errors)", keeps: ["kill_unconfirmed"], never: ["on every path"], finding: "security-2" },
  { path: DS, statement: "- **D22-8:** the worker's whole read of `result.raw`", keeps: ["kill_unconfirmed"], never: ["on every path"], finding: "security-2" },
  { path: `${B22}sec-1-spice-deck-injection.md`, statement: "in the allowlist (B22-A3's profile environment)", keeps: ["eight server variables", "USERPROFILE among them"], never: [], finding: "security-3" },
  { path: `${B22}isolation-verdict.md`, statement: "| secrets in the child environment |", keeps: ["eight server variables", "USERPROFILE among them"], never: [], finding: "security-3" },
];
/** Every note the closeout wrote in a test file or a page, by file: a note reverted or dropped (or one added unregistered) changes a count. */
const NOTE_COUNTS: Readonly<Record<string, number>> = {
  "app/api/mcp/__tests__/b20-d2-never-reachable-sweep.test.ts": 1,
  "app/lib/agent/orchestration/__tests__/b21-a-contracts.test.ts": 1,
  "app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts": 3,
  "app/lib/agent/orchestration/__tests__/b21-c-role-tools.test.ts": 1,
  "app/lib/auth/__tests__/b16-0-ai-approval-lifecycle.test.ts": 1,
  "app/lib/engineering/__tests__/b20-b1-mcp-exposure.test.ts": 1,
  "app/lib/engineering/__tests__/b20-b3-mcp-subset-move.test.ts": 1,
  "app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts": 1,
  "app/lib/mcp/server/__tests__/b20-b4-withhold-proposals.test.ts": 2,
  "app/lib/pcb/proposal/__tests__/b15-2-core-closure.test.ts": 1,
  "app/lib/spice/__tests__/worker-integration.test.ts": 2,
  [`${B24}simulate-process-security-proof.md`]: 2,
  [`${B24}unknowns-and-owner-decisions.md`]: 1,
  [`${B24}README.md`]: 1,
  [`${B24}final-verdict.md`]: 1,
  [`${B24}human-truth-contract.md`]: 1,
  [`${B24}simulate-input-confinement.md`]: 5,
  [`${B24}simulator-output-and-cleanup-proof.md`]: 3,
  "artifacts/ai-control-plane-b16-0-24-1/superseded-claims.md": 1,
  [`${B23}final-verdict.md`]: 1,
  [`${B23}smoke-test-truthfulness-proof.md`]: 2,
  [`${B23}unknowns-and-owner-decisions.md`]: 1,
  [`${B23}pre-edit-counterexamples.md`]: 1,
  [`${B23}reports-and-bundles-proof.md`]: 1,
  "artifacts/ai-control-plane-b16-0-20/zero-process-zero-network-proof.md": 1,
  "README.md": 1,
  "docs/STATUS.md": 1,
  "docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md": 2,
  "artifacts/ai-control-plane-b20/mcp-server-proposals.md": 1,
  [OC]: 5,
  "artifacts/ai-control-plane-b21/specialist-roles.md": 1,
  [DS]: 9,
  [`${B22}isolation-verdict.md`]: 4,
  [`${B22}threat-model.md`]: 2, // [B22 closeout (1/2) review] coverage-4: + T7
  [`${B22}runtime-profiles.md`]: 1,
  [`${B22}named-computations.md`]: 2,
  [`${B22}sec-1-spice-deck-injection.md`]: 4,
  [`${B22}diagnostic-runner.md`]: 3, // [B22 closeout (1/2) review] coverage-4: + the FreeRouting and kicad-cli hand-off
  [`${B22}simulation-authority.md`]: 2,
};

/** A page section: from its heading line to the next `## ` heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`${NEWLINE}${heading}`);
  if (start < 0) return "";
  const end = text.indexOf(`${NEWLINE}## `, start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}
const STOP_LINE = /^- `(artifacts\/[^`]+\.md):(\d+)`/gm;
const STOP_NOTE = "[B22 closeout, 2026-10-02] The B16.0.23, B16.0.24 and B16.0.24.1 stop-condition lines";
const EXPORT_ROW = /^\| `((?:app|scripts)\/[^`]+\.ts)` \| `([A-Za-z_][A-Za-z0-9_]*|\*)` \| (-|`[A-Za-z_]+`) \| (test seam|test oracle|vocabulary|documentary constant|extension point|re-export seam|dormant contract|injection seam|operator tool|type name|parameter) \| (RECORD|RETIRE) \| `([a-z0-9-]+\.md)` \| ([^|]+) \|$/gm;
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
/** The production modules each dormant module may be imported by (both are inert until OD-159's approval route). */
const DORMANT_IMPORTERS: Readonly<Record<string, readonly string[]>> = {
  "app/lib/computation/requests.ts": ["app/lib/computation/request-executors.ts"],
  "app/lib/computation/request-executors.ts": [],
};
const RECORD_HEADING = "The B22 closeout's export record";
/** A retired parameter's problems in its module's text: the signature still takes it, or its own tombstone is gone. */
function retiredParameterProblems(row: { readonly module: string; readonly name: string; readonly member: string }, own: string): string[] {
  const problems: string[] = [];
  const signature = new RegExp(`export function ${row.name}\\(([^)]*)\\)`).exec(own);
  if (!signature) problems.push(`${row.module}: no ${row.name}`);
  else if (new RegExp(`\\b${row.member}\\b`).test(signature[1]!)) problems.push(`${row.name} still takes ${row.member}`);
  // [B22 closeout (1/2) review] coverage-5, tests-3: the tombstone on the signature's own line (two retirements share one module)
  if (!new RegExp(`export function ${row.name}\\([^)]*\\)[^\\n]*\\[B22 closeout, 2026-10-02\\] retired: the \`${row.member}\` parameter`).test(own)) problems.push(`${row.module}: no tombstone on ${row.name}'s signature line for its ${row.member}`);
  return problems;
}
/** A retired type name's problems: still declared in its module, named by a production source, or not exactly one tombstone. */
function retiredTypeProblems(row: { readonly module: string; readonly name: string }, own: string, namedBy: readonly string[]): string[] {
  const problems: string[] = [];
  if (/\b(?:type|interface)\s/.test(stripComments(own).split(NEWLINE).find((line) => new RegExp(`\\b${row.name}\\b`).test(line)) ?? "")) problems.push(`${row.module}: ${row.name} is still declared`);
  if (namedBy.length > 0) problems.push(`${row.name} is still named by ${namedBy.join(", ")}`);
  if (occurrences(own, `[B22 closeout, 2026-10-02] retired: \`${row.name}\``) !== 1) problems.push(`${row.module}: no single tombstone for ${row.name}`);
  return problems;
}
/** [B22 closeout (1/2) review] regressions-1: ordinary engineering lines that count 12 of something - never an agent-set claim. */
const NOT_CLAIMS = ["  it(\"emits exactly 12 pads for the QFN-12\", () => {", "// exactly 12 months of history", "const outline = 12.5; // exactly 12.5 mm across"];
/** [B22 closeout (1/2) review] tests-2: statements the review added without a note - a page's stale count and spawner count, and
 *  'no network' beside ngspice on a page and in a route comment. */
const STALE_PAGE_LINE = "The agent set is every one of the 33 exposed ids, and none of the app's five process spawners is reached.";
const NETWORK_LINE = "the diagnostic runner runs ngspice with no network.";
/** [B22 closeout (1/2) review] coverage-2: the one page quoting retired titles - B22-B's own list, whose quotes `b22-b-catalog` case 7
 *  pins - each line by the words that open its quote. */
const QUOTING: ReadonlyArray<readonly [string, string]> = [
  [`${B22}named-computations.md`, "`b21-c-least-privilege` case 7's title, \""],
  [`${B22}named-computations.md`, "`b21-c-least-privilege` case 3's title, \""],
  [`${B22}named-computations.md`, "`b20-b3-mcp-subset-move` case 5's title, \""],
];
/** [B22 closeout (1/2) review] coverage-1, tests-5: the closeout's code tag, and the page's own account of what is pinned. */
const TAG = "[B22 closeout, 2026-10-02] ";
const PINNED_SECTIONS = "Sections 1 to 4 are re-derived from the tree by";
const NOTE_ROW = /^\| ([A-Za-z0-9-]+) \| `([^`]+):(\d+)` \| ([^|]+) \| ([^|]+) \|$/gm;
const TITLE_ROW = /^\| ([A-Za-z0-9-]+) \| `([^`]+):(\d+)` \| (.+) \| (\d+) \|$/gm;
/** A page subsection: from its `### ` heading to the next heading of any level. */
function subsection(text: string, heading: string): string {
  const start = text.indexOf(`${NEWLINE}${heading}`);
  if (start < 0) return "";
  const end = text.slice(start + 1).search(/\n#{2,3} /);
  return end < 0 ? text.slice(start) : text.slice(start, start + 1 + end);
}

describe("[B22 closeout] the sandbox, authority and count statements are superseded in place, and none comes back uncorrected (D22-14, D22-16, OD-144)", () => {
  it("1. no production source or test file states a superseded claim uncorrected: every line that calls the ngspice runner a sandbox, confined, isolated or networkless, calls local execution authoritative, chooses the executable from PATH, names the simulate route as the process pattern, or counts the agent set, the registry or the spawners as before B22 carries the closeout's dated note on it (or, for the one wrapped statement, on the line after it) - or is one of four statements true as written (the allow-list)", () => {
    // [B22 closeout (1/2) lead] the check's new issue: the 'no network' proximity rule must not flag the repository's own test-header
    // disclaimer "No network, no model" beside a simulation word (true of the test, not a runner guarantee), and must still flag a claim
    const network = new RegExp(CLAIMS.find(([label]) => label.startsWith("'no network'"))![1].source, "i");
    expect(network.test(" * No network, no model, no simulator spawn: the SPICE route is faked.")).toBe(false);
    expect(network.test(" * hardened into a confined ngspice runner that has no network.")).toBe(true);
    const paths = productionSources();
    expect(paths).toEqual(expect.arrayContaining(["app/api/simulate/route.ts", "app/model-simulation/page.tsx", "app/lib/pcb/autoroute/runner.ts", "scripts/print-install-tree-digest.ts"]));
    expect(paths.filter((path) => path.includes("/__tests__/") || /\.test\.tsx?$/.test(path))).toEqual([]);
    const tests = testFiles();
    expect(tests).toEqual(expect.arrayContaining(["app/lib/spice/__tests__/worker-integration.test.ts", "app/api/mcp/__tests__/b20-d2-never-reachable-sweep.test.ts"]));
    expect(tests).not.toContain(SELF);
    expect(uncorrectedCode([...paths, ...tests], read)).toEqual([]);
  });

  it("2. no page states a superseded claim uncorrected: every artifact page (the lead's records aside), every doc and the root README that calls the runner a sandbox, confined, isolated or networkless (or puts 'no network' in one sentence with ngspice, the diagnostic runner or the simulator), calls local execution authoritative, chooses the executable from PATH, names the simulate route as the process pattern, or counts the agent set, the registry or the spawners as before B22 carries the closeout's dated note in that statement's own block - or is one of the finder's dated records the page allow-list names, or a B15/B16 chapter's own dated count, each admission pinned", () => {
    const paths = pages();
    expect(paths).toEqual(expect.arrayContaining([`${B24}simulate-process-security-proof.md`, "docs/STATUS.md", "README.md"]));
    expect(paths).not.toContain(PAGE);
    expect(paths.filter(LEAD_RECORDS)).toEqual([]);
    expect(uncorrectedPages(paths, read)).toEqual([]);
    // [B22 closeout (1/2) review] tests-2: what the allow-list and the dated chapters admit is pinned, so neither can grow unseen
    const admitted = pageClaims(paths, read).map(admittedBy);
    expect([admitted.filter((by) => by === "allowed").length, admitted.filter((by) => by === "history").length]).toEqual([PAGE_ALLOWED_ADMITS, PAGE_HISTORY.admits]);
  });

  it("3. the allow-lists are small, exact and cannot rot, and the scans bite: four code statements and eighteen page lines, each on exactly one line of its file, each still stating a claim and none carrying a note; the one wrapped statement is followed by its note; with every note stripped the scans report exactly the statements the closeout noted; an ordinary count of 12 is not reported while every retired \"12\" title wording is; an unnoted count, spawner or 'no network' statement added to a page or a route comment is reported; an allowed line moved to another file is reported; and a page note moved away from its statement's block is reported", () => {
    // [B22 closeout (1/2) review] regressions-1: an ordinary count of 12 is no agent-set claim, while every retired "12" title wording
    // still is; tests-2: a page's stale count or spawner count, and 'no network' beside ngspice on a page or in a route comment, are reported
    const misses: string[] = [];
    for (const line of NOT_CLAIMS) misses.push(...uncorrectedCode(["app/lib/pcb/__tests__/qfn-pads.test.ts"], () => line).map((found) => `${found}: ${line}`));
    for (const [suite, wording] of RETIRED_TITLES.filter(([, text]) => /\b12\b/.test(text))) if (uncorrectedCode([suite], () => `  it("${wording}", () => {`).length === 0) misses.push(`${suite}: "${wording}" not reported`);
    const authority = `${B22}simulation-authority.md`;
    const stalePage = uncorrectedPages([authority], () => STALE_PAGE_LINE);
    for (const claim of ["(a stale agent-set or registry count)", "(the five spawners)"]) if (!stalePage.some((found) => found.endsWith(claim))) misses.push(`${authority}: ${STALE_PAGE_LINE} ${claim} not reported`);
    if (uncorrectedPages([authority], () => `The B22 runner page says ${NETWORK_LINE}`).length === 0) misses.push(`${authority}: ${NETWORK_LINE} not reported`);
    if (uncorrectedCode(["app/api/simulate/route.ts"], () => ` * ${NETWORK_LINE}`).length === 0) misses.push(`app/api/simulate/route.ts: ${NETWORK_LINE} not reported`);
    expect(misses).toEqual([]);
    expect(ALLOWED).toHaveLength(4);
    for (const entry of ALLOWED) {
      const lines = read(entry.path).split(NEWLINE).filter((line) => line.includes(entry.text));
      expect(lines, `${entry.path}: ${entry.text}`).toHaveLength(1);
      expect(CODE_CLAIMS.some(([, pattern]) => new RegExp(pattern.source, pattern.flags).test(lines[0]!)), entry.text).toBe(true);
      expect(lines[0], entry.text).not.toContain(NOTE);
      expect(entry.why.length, entry.text).toBeGreaterThan(20);
    }
    expect(WRAPPED).toHaveLength(1);
    for (const entry of WRAPPED) {
      const lines = read(entry.path).split(NEWLINE);
      const at = lines.flatMap((line, index) => (line.includes(entry.text) ? [index] : []));
      expect(at, entry.text).toHaveLength(1);
      expect(lines[at[0]!]).not.toContain(NOTE);
      expect(lines[at[0]! + 1]).toContain(NOTE);
    }
    // [B22 closeout (1/2) review] tests-2: the page allow-list cannot rot either - each entry's text on exactly one line of its page, that
    // line still stating a claim the scan finds, and carrying no closeout note
    expect(PAGE_ALLOWED).toHaveLength(18);
    for (const entry of PAGE_ALLOWED) {
      const lines = read(entry.path).split(NEWLINE).filter((line) => line.includes(entry.text));
      expect(lines, `${entry.path}: ${entry.text}`).toHaveLength(1);
      expect(pageClaims([entry.path], read).some((found) => found.text.includes(entry.text)), `${entry.path}: ${entry.text}`).toBe(true);
      expect(lines[0], entry.text).not.toContain(NOTE);
      expect(entry.why.length, entry.text).toBeGreaterThan(20);
    }
    const stripped = (path: string): string => unnoted(read(path));
    expect(uncorrectedCode([...productionSources(), ...testFiles()], stripped).sort()).toEqual([
      "app/api/mcp/__tests__/b20-d2-never-reachable-sweep.test.ts:397 (a stale agent-set or registry count)",
      "app/api/simulate/route.ts:14 ('no network' as the runner's own guarantee)",
      "app/api/simulate/route.ts:4 (the ngspice runner as a sandbox or a confined process)",
      "app/api/spice/models/smoke-test/route.ts:89 (the ngspice run as isolated)",
      "app/lib/agent/orchestration/__tests__/b21-a-contracts.test.ts:6 (a stale agent-set or registry count)",
      "app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts:168 (a stale agent-set or registry count)",
      "app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts:170 (a stale agent-set or registry count)",
      "app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts:171 (a stale agent-set or registry count)",
      "app/lib/agent/orchestration/__tests__/b21-c-role-tools.test.ts:140 (a stale agent-set or registry count)",
      "app/lib/auth/__tests__/b16-0-ai-approval-lifecycle.test.ts:4 (a stale agent-set or registry count)",
      "app/lib/engineering/__tests__/b20-b1-mcp-exposure.test.ts:521 (one addition as the only difference)",
      "app/lib/engineering/__tests__/b20-b3-mcp-subset-move.test.ts:27 (one addition as the only difference)",
      "app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts:14 (the five spawners)",
      "app/lib/mcp/server/__tests__/b20-b4-withhold-proposals.test.ts:142 (one addition as the only difference)",
      "app/lib/mcp/server/__tests__/b20-b4-withhold-proposals.test.ts:53 (one addition as the only difference)",
      "app/lib/model-simulation/provider.ts:6 (the executable chosen from PATH)",
      "app/lib/pcb/autoroute/runner.ts:2 (the simulate route as the process pattern)",
      "app/lib/pcb/fab/kicad-cli-runner.ts:2 (the simulate route as the process pattern)",
      "app/lib/pcb/proposal/__tests__/b15-2-core-closure.test.ts:312 (a stale agent-set or registry count)",
      "app/lib/spice/__tests__/worker-integration.test.ts:21 (the ngspice run as isolated)",
      "app/lib/spice/__tests__/worker-integration.test.ts:78 (the ngspice run as isolated)",
      "app/model-simulation/page.tsx:8 (the executable chosen from PATH)",
    ]);
    expect(uncorrectedPages(pages(), stripped).sort()).toEqual([
      "README.md:62 (the ngspice run as isolated)",
      `${B23}final-verdict.md:10 (the ngspice runner as a sandbox or a confined process)`,
      `${B23}smoke-test-truthfulness-proof.md:19 (the ngspice run as isolated)`,
      `${B23}smoke-test-truthfulness-proof.md:4 (the ngspice run as isolated)`,
      `${B24}README.md:8 (the ngspice runner as a sandbox or a confined process)`,
      `${B24}final-verdict.md:10 (the ngspice runner as a sandbox or a confined process)`,
      `${B24}human-truth-contract.md:45 (local execution as authoritative)`,
      `${B24}simulate-process-security-proof.md:30 ('no network' as the runner's own guarantee)`,
      `${B24}simulate-process-security-proof.md:5 (the ngspice runner as a sandbox or a confined process)`,
      `${B24}unknowns-and-owner-decisions.md:26 (local execution as authoritative)`,
      // [B22 closeout (1/2) review] tests-2: the count and spawner statements the closeout noted on pages, now that pages are scanned for them
      "artifacts/ai-control-plane-b20/mcp-server-proposals.md:181 (the five spawners)",
      `${OC}:195 (a stale agent-set or registry count)`,
      `${OC}:198 (a stale agent-set or registry count)`,
      `${OC}:199 (a stale agent-set or registry count)`,
      `${OC}:206 (a stale agent-set or registry count)`,
      "artifacts/ai-control-plane-b21/specialist-roles.md:306 (a stale agent-set or registry count)",
      `${B22}named-computations.md:364 (a stale agent-set or registry count)`,
      `${B22}named-computations.md:364 (a stale agent-set or registry count)`,
      "docs/STATUS.md:48 (the executable chosen from PATH)",
      "docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md:102 (the executable chosen from PATH)",
      "docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md:22 (the executable chosen from PATH)",
    ]);
    const allowed = ALLOWED[3]!;
    expect(uncorrectedCode(["app/lib/mcp/server/__tests__/moved.test.ts"], () => read(allowed.path))).toEqual(["app/lib/mcp/server/__tests__/moved.test.ts:19 (the five spawners)"]);
    const readme = read(`${B24}README.md`);
    const note = notesIn(readme)[0]!;
    const moved = `${readme.replace(note, "")}${NEWLINE}${NEWLINE}${note}${NEWLINE}`;
    expect(uncorrectedPages([`${B24}README.md`], () => moved)).toEqual([`${B24}README.md:8 (the ngspice runner as a sandbox or a confined process)`]);
  });

  it("4. each superseded production statement keeps its own words and its note says the truth beside it - the route starts no process, the runner is diagnostic with no isolation boundary and no OS limit, the install is digest-pinned, authority stays BLOCKED - for ALL eight production lines that carry the note, and no other production line carries one; no note spells what a raw-source gate forbids", () => {
    const matched = new Set<string>();
    for (const noted of NOTED) {
      const lines = read(noted.path).split(NEWLINE).flatMap((line, index) => (line.includes(noted.claim) && line.includes(NOTE) ? [[index, line] as const] : []));
      expect(lines, `${noted.path}: ${noted.claim}`).toHaveLength(1);
      matched.add(`${noted.path}:${lines[0]![0] + 1}`);
      const note = lines[0]![1].slice(lines[0]![1].indexOf(NOTE));
      for (const kept of noted.keeps) expect(note, `${noted.path}: ${kept}`).toContain(kept);
    }
    expect(NOTED).toHaveLength(8);
    const everyNoted = productionSources().flatMap((path) => read(path).split(NEWLINE).flatMap((line, index) => (line.includes(NOTE) ? [`${path}:${index + 1}`] : [])));
    expect(everyNoted.sort()).toEqual([...matched].sort());
    // the raw-source gates: b22-a3-single-spawner (no executable token in app/), b16-0-23/b16-0-24 (no process module or spawn call in
    // the routes' raw source), b21-closeout-statements (no single-agent claim in production)
    for (const path of new Set(NOTED.map((noted) => noted.path))) {
      for (const note of notesIn(read(path))) expect(note, path).not.toMatch(/NGSPICE_EXECUTABLE|process\.env|spawn\(|child_process|single[- ]agent|\bsandbox(ed)? (is|are) (qualified|validated|proven)\b/i);
    }
  });

  it("5. the stale test titles the closeout retitled never come back: none of the retired wordings is in any title of its suite, every such suite carries the closeout's same-line retitle note - 20 retitled cases in 15 suites - and every `it(` count is unchanged", () => {
    const titleLines = (path: string): string[] => read(path).split(NEWLINE).filter((line) => /^\s*(?:it|describe)(?:\.runIf\([^)]*\))?\(/.test(line));
    const problems: string[] = [];
    for (const [path, retired] of RETIRED_TITLES) {
      if (titleLines(path).some((line) => line.slice(0, line.indexOf("\", ") < 0 ? undefined : line.indexOf("\", ")).includes(retired))) problems.push(`${path}: a title still says "${retired}"`);
      if (!titleLines(path).some((line) => line.includes(RETITLED))) problems.push(`${path}: no retitle note`);
    }
    // [B22 closeout (1/2) review] coverage-2: the only page lines that quote a retired title are B22-B's own list (b22-b-catalog case 7
    // pins its quotes), each once, and the closeout page records them as left as written instead of claiming no page quotes one
    const quoting = pages().flatMap((path) => read(path).split(NEWLINE).flatMap((line) => (line.includes("title") && (line.match(/"[^"]*"/g) ?? []).some((quote) => RETIRED_TITLES.some(([, retired]) => quote.includes(retired))) ? [[path, line] as const] : [])));
    for (const [path, line] of quoting) if (QUOTING.filter(([page, opens]) => page === path && line.includes(opens)).length !== 1) problems.push(`${path}: an unrecorded quote of a retired title: ${line.trim()}`);
    if (quoting.length !== QUOTING.length) problems.push(`${quoting.length} page lines quote a retired title, ${QUOTING.length} recorded`);
    if (read(PAGE).includes("no page quotes a retitled title")) problems.push("the closeout page still says no page quotes a retitled title");
    for (const named of ["`named-computations.md` section 9", "`b22-b-catalog` case 7"]) if (!section(read(PAGE), "## 6. ").includes(named)) problems.push(`the closeout page's section 6 does not name ${named}`);
    expect(problems).toEqual([]);
    const suites = [...new Set(RETIRED_TITLES.map(([path]) => path))];
    expect(suites.sort()).toEqual(Object.keys(IT_COUNTS).sort());
    expect(suites.reduce((count, path) => count + titleLines(path).filter((line) => line.includes(RETITLED)).length, 0)).toBe(20);
    for (const [path, count] of Object.entries(IT_COUNTS)) expect((read(path).match(/^\s*it\(/gm) ?? []).length, path).toBe(count);
    // a retitle note is never the B21 closeout's marker (b21-closeout-statements pins its own count) and always says the assertions stayed
    for (const path of suites) for (const line of read(path).split(NEWLINE).filter((text) => text.includes(RETITLED))) expect(line, path).toMatch(/; assertions unchanged$/);
  });

  it("6. every page statement the closeout noted carries the note in its own block (60 statements, the B22 pages' own hand-offs to the closeout among them), each note keeps what its statement needs (an INFERRED reading stays open, a kill_unconfirmed run is no exit, the exact map is not the win32 child's whole environment), and every test file and page keeps its pinned number of notes - 75 - while no other file carries one (the lead's records are not scanned)", () => {
    const problems: string[] = [];
    for (const [path, statement] of NOTED_PAGES) {
      if (statement.includes(NOTE)) problems.push(`${path}: the entry is a note, not a stale statement`);
      const text = read(path);
      const count = occurrences(text, statement);
      if (count !== 1) problems.push(`${path}: ${statement} occurs ${count} times`);
      else if (!blockAt(text, text.indexOf(statement)).includes(NOTE)) problems.push(`${path}: ${statement} carries no closeout note in its block`);
    }
    // [B22 closeout (1/2) review] security-1..3, coverage-3: what a note must keep saying beside its statement, and never say
    for (const entry of PAGE_NOTE_KEEPS) {
      const text = read(entry.path);
      const notes = text.includes(entry.statement) ? notesIn(blockAt(text, text.indexOf(entry.statement))) : [];
      if (notes.length !== 1) problems.push(`${entry.path}: ${entry.statement} has ${notes.length} closeout notes in its block (${entry.finding})`);
      for (const kept of entry.keeps) if (!notes.some((note) => note.includes(kept))) problems.push(`${entry.path}: ${entry.statement} - the note does not say "${kept}" (${entry.finding})`);
      for (const said of entry.never) if (notes.some((note) => note.includes(said))) problems.push(`${entry.path}: ${entry.statement} - the note says "${said}" (${entry.finding})`);
    }
    // ... and in every closeout note anywhere: a run cut short by kill_unconfirmed is no "exit", and an environment without HOME or
    // USERPROFILE is the map's, never the win32 child's (Node adds eight server variables there)
    for (const path of [...productionSources(), ...testFiles(), ...pages()]) {
      for (const note of notesIn(read(path))) {
        if (/terminal only after exit|on every path/.test(note) && !note.includes("kill_unconfirmed")) problems.push(`${path}: a note says a run ends or is cleaned up on every path without kill_unconfirmed: ${note}`);
        if (/HOME|USERPROFILE|holds neither/.test(note) && !/\beight\b/.test(note)) problems.push(`${path}: a note drops HOME or USERPROFILE without Node's eight win32 additions: ${note}`);
      }
    }
    expect(problems).toEqual([]);
    expect(NOTED_PAGES).toHaveLength(60);
    const counts: Record<string, number> = {};
    for (const path of [...testFiles(), ...pages()]) {
      const count = occurrences(read(path), NOTE);
      if (count > 0) counts[path] = count;
    }
    expect(counts).toEqual(NOTE_COUNTS);
    expect(Object.values(NOTE_COUNTS).reduce((sum, count) => sum + count, 0)).toBe(15 + 60);
  });

  it("7. the closeout page's dated note covers the B16.0.23, B16.0.24 and B16.0.24.1 stop-condition lines that list simulator expansion as not started: seven lines, each still as written, none noted in place, and the note says what B22 started and that production authority stays BLOCKED", () => {
    const stops = section(read(PAGE), "## 4. ");
    expect(stops).toContain(STOP_NOTE);
    for (const kept of ["are true for their own chapters and stay as written", "the diagnostic runner", "runtime profiles", "unqualified OCI design", "production simulation authority stays BLOCKED"]) expect(stops, kept).toContain(kept);
    const listed = [...stops.matchAll(STOP_LINE)].map((match) => [match[1]!, Number(match[2])] as const);
    expect(listed).toHaveLength(7);
    expect(new Set(listed.map(([path, line]) => `${path}:${line}`)).size).toBe(7);
    for (const [path, line] of listed) {
      expect(path, path).toMatch(/^artifacts\/ai-control-plane-b16-0-2[34](?:-1)?\//);
      const text = read(path).split(NEWLINE)[line - 1] ?? "";
      expect(text, `${path}:${line}`).toMatch(/simulator-(?:platform|runner) expansion/);
      expect(text, `${path}:${line}`).not.toContain("[superseded");
    }
  });

  it("8. the closeout page records every B22 export with no production caller and what was done with it, re-derived from the tree: a recorded export is still exported and used only as its kind says (no other production source names it; a vocabulary is typed from it; a test names a seam; a dormant module has no production importer but its dormant sibling); a retired one is gone, its tombstone or retired parameter in place; and each B22 page names its records", () => {
    const rows = [...section(read(PAGE), "## 3. ").matchAll(EXPORT_ROW)].map((match) => ({ module: match[1]!, name: match[2]!, member: match[3]!.replace(/`/g, ""), kind: match[4]!, decision: match[5]!, page: match[6]!, why: match[7]!.trim() }));
    expect(rows).toHaveLength(30);
    expect(rows.filter((row) => row.decision === "RETIRE")).toHaveLength(4);
    const production = productionSources().map((path) => [path, read(path)] as const);
    const stripped = new Map(production.map(([path, text]) => [path, stripComments(text)] as const));
    const tests = testFiles().map((path) => read(path));
    const named = (name: string, except: string): string[] => [...stripped].filter(([path, text]) => path !== except && new RegExp(`\\b${name}\\b`).test(text)).map(([path]) => path);
    const importers = (module: string): string[] => {
      const base = module.slice(module.lastIndexOf("/") + 1).replace(/\.ts$/, "");
      const specifier = new RegExp(`(?:from\\s+|import\\(\\s*)["'][^"']*\\/${base}["']`);
      return production.filter(([path, text]) => path !== module && specifier.test(text)).map(([path]) => path).sort();
    };
    const problems: string[] = [];
    for (const row of rows) {
      const own = read(row.module);
      const exported = new RegExp(`export (?:const|function|type|interface|class) ${row.name}\\b`).test(own);
      if (row.why.length < 20) problems.push(`${row.name}: no reason`);
      if (row.decision === "RECORD") {
        if (["test seam", "test oracle", "vocabulary", "documentary constant", "extension point"].includes(row.kind)) {
          if (!exported) problems.push(`${row.module}: ${row.name} is not exported`);
          const others = named(row.name, row.module);
          if (others.length > 0) problems.push(`${row.name} is named by ${others.join(", ")}`);
          if (row.kind === "vocabulary" && !own.includes(`typeof ${row.name}`)) problems.push(`${row.name}: no type is read from it`);
          if ((row.kind === "test seam" || row.kind === "test oracle") && !tests.some((text) => new RegExp(`\\b${row.name}\\b`).test(text))) problems.push(`${row.name}: no test names it`);
        } else if (row.kind === "re-export seam") {
          if (!new RegExp(`export \\{ ${row.name}\\b`).test(own)) problems.push(`${row.module}: ${row.name} is not re-exported`);
          const tail = row.module.replace(/\.ts$/, "").split("/").slice(-2).join("/");
          const imports = new RegExp(`(?:from\\s+|import\\(\\s*)["'][^"']*\\/${tail}["']`);
          const users = production.filter(([path, text]) => path !== row.module && imports.test(text)).map(([path]) => path);
          if (users.length > 0) problems.push(`${row.module} is imported by ${users.join(", ")}`);
          if (!tests.some((text) => imports.test(text) && new RegExp(`\\b${row.name}\\b`).test(text))) problems.push(`${row.name}: no test imports it from ${row.module}`);
        } else if (row.kind === "dormant contract") {
          if (row.name !== "*" && !exported) problems.push(`${row.module}: ${row.name} is not exported`);
          expect(DORMANT_IMPORTERS[row.module], row.module).toBeDefined();
          const found = importers(row.module);
          if (JSON.stringify(found) !== JSON.stringify([...DORMANT_IMPORTERS[row.module]!].sort())) problems.push(`${row.module} is imported by ${found.join(", ")}`);
        } else if (row.kind === "injection seam") {
          if (!own.includes(`${row.name}?:`)) problems.push(`${row.module}: no ${row.name} option`);
          const others = named(row.name, row.module);
          if (others.length > 0) problems.push(`${row.name} is set by ${others.join(", ")}`);
        } else if (row.kind === "operator tool") {
          if (importers(row.module).length > 0) problems.push(`${row.module} is imported by production code`);
          if (read("package.json").includes(row.module.slice(row.module.lastIndexOf("/") + 1))) problems.push(`${row.module} is a package script`);
        } else problems.push(`${row.name}: ${row.kind} is not a record kind`);
      } else if (row.kind === "type name") problems.push(...retiredTypeProblems(row, own, named(row.name, "")));
      else if (row.kind === "parameter") problems.push(...retiredParameterProblems(row, own));
      else problems.push(`${row.name}: ${row.kind} is not a retirement kind`);
      const record = read(`${B22}${row.page}`);
      const at = record.indexOf(RECORD_HEADING);
      const block = at < 0 ? "" : record.slice(at);
      const mention = row.name === "*" ? `\`${row.module.slice(row.module.lastIndexOf("/") + 1)}\`` : `\`${row.name}\``;
      if (!block.includes(mention)) problems.push(`${row.page} does not record ${mention}`);
    }
    // [B22 closeout (1/2) review] coverage-5, tests-3: each retired parameter's tombstone is its own signature's, and every retirement
    // check bites - a dropped tombstone, a parameter taken again and a type declared again are each reported
    const retired = (name: string) => rows.find((row) => row.name === name && row.decision === "RETIRE")!;
    const waveforms = read("app/lib/spice/waveforms.ts");
    const untombed = waveforms.split(NEWLINE).map((line) => (line.startsWith("export function parseNgspiceAsciiRawResult(") && line.includes(` // ${TAG}`) ? line.slice(0, line.indexOf(` // ${TAG}`)) : line)).join(NEWLINE);
    if (untombed === waveforms) problems.push("waveforms.ts: no tombstone on parseNgspiceAsciiRawResult's signature line to drop");
    if (retiredParameterProblems(retired("parseNgspiceAsciiRawResult"), untombed).length === 0) problems.push("parseNgspiceAsciiRawResult's own tombstone dropped: not reported");
    if (retiredParameterProblems(retired("parseNgspiceAsciiRaw"), waveforms.replace("export function parseNgspiceAsciiRaw(raw: string)", "export function parseNgspiceAsciiRaw(raw: string, options?: unknown)")).length === 0) problems.push("parseNgspiceAsciiRaw taking options again: not reported");
    const authority = read("app/lib/computation/simulation-authority-server.ts");
    if (retiredParameterProblems(retired("serverSimulationEnvironments"), authority.replace("export function serverSimulationEnvironments()", "export function serverSimulationEnvironments(read?: () => unknown)")).length === 0) problems.push("serverSimulationEnvironments taking read again: not reported");
    if (retiredTypeProblems(retired("ArtifactParser"), `${read("app/lib/computation/catalog.ts")}${NEWLINE}export type ArtifactParser = string;${NEWLINE}`, []).length === 0) problems.push("ArtifactParser declared again: not reported");
    // [B22 closeout (1/2) review] tests-5: the dead mock key recorded outside the table keeps its annotation on its one line
    const mockKey = read("app/lib/spice/__tests__/b16-0-2-spice-scope-isolation.test.ts").split(NEWLINE).filter((line) => line.includes("NGSPICE_EXECUTABLE:"));
    if (mockKey.length !== 1 || !mockKey[0]!.includes(`${TAG}no longer read: worker.ts exports no executable since B22-A3`)) problems.push(`b16-0-2-spice-scope-isolation.test.ts: the dead mock key's annotation (${mockKey.length} lines)`);
    if (!section(read(PAGE), "## 3. ").includes("`b16-0-2-spice-scope-isolation.test.ts:20`")) problems.push("the page's section 3 does not record the dead mock key");
    expect(problems).toEqual([]);
    // the deliveries OD-141, D22-19 and OD-159 describe as delivered and unbound are recorded, never retired
    for (const unbound of ["app/lib/computation/evidence-store.ts", "app/lib/computation/deck-validator.ts", "app/lib/computation/requests.ts", "app/lib/computation/request-executors.ts"]) {
      expect(rows.some((row) => row.module === unbound && row.decision === "RECORD"), unbound).toBe(true);
      expect(rows.some((row) => row.module === unbound && row.decision === "RETIRE"), unbound).toBe(false);
    }
  });

  it("9. the page's sections 1 and 2 are the tree's notes and retitles, row for row - each row's file:line carries the note with the row's references and words, or the retitle note in a suite of the row's `it(` count; no note or retitle in the tree lacks a row and every retired wording has one - every closeout tag in app/ is a retitle, a tombstone or the dead mock key's annotation, and the page's head says which sections the tripwire re-derives (coverage-1, tests-5)", () => {
    const page = read(PAGE);
    const problems: string[] = [];
    const head = page.slice(0, page.indexOf(`${NEWLINE}## 0. `));
    if (head.includes("Every section below is pinned")) problems.push("the page's head says every section is pinned");
    if (!head.includes(PINNED_SECTIONS)) problems.push(`the page's head does not say: ${PINNED_SECTIONS}`);
    const noteRows: string[] = [];
    for (const [heading, count] of [["### 1.1 ", 8], ["### 1.2 ", 15], ["### 1.3 ", 60]] as const) {
      const rows = [...subsection(page, heading).matchAll(NOTE_ROW)];
      if (rows.length !== count) problems.push(`${heading}: ${rows.length} rows, not ${count}`);
      for (const [, item, path, line, references, says] of rows) {
        const text = read(path!).split(NEWLINE)[Number(line) - 1] ?? "";
        if (!text.includes(`${NOTE}${references!.trim()}): ${says!.trim().replace(/ \.\.\.$/, "")}`)) problems.push(`${item} ${path}:${line}: the line does not carry the row's note`);
        noteRows.push(`${path}:${line}`);
      }
    }
    const treeNotes = [...productionSources(), ...testFiles(), ...pages()].flatMap((path) => read(path).split(NEWLINE).flatMap((line, index) => (line.includes(NOTE) ? [`${path}:${index + 1}`] : [])));
    expect(problems).toEqual([]);
    expect(noteRows.sort()).toEqual(treeNotes.sort());
    const titleRows = [...section(page, "## 2. ").matchAll(TITLE_ROW)].map(([, item, path, line, retired, count]) => ({ item: item!, path: path!, line: Number(line), retired: retired!, count: Number(count) }));
    expect(titleRows).toHaveLength(20);
    for (const row of titleRows) {
      const own = read(row.path);
      expect(own.split(NEWLINE)[row.line - 1], `${row.item} ${row.path}:${row.line}`).toContain(RETITLED);
      expect((own.match(/^\s*it\(/gm) ?? []).length, row.path).toBe(row.count);
      expect(IT_COUNTS[row.path], row.path).toBe(row.count);
    }
    const treeRetitles = testFiles().flatMap((path) => read(path).split(NEWLINE).flatMap((line, index) => (line.includes(RETITLED) ? [`${path}:${index + 1}`] : [])));
    expect(titleRows.map((row) => `${row.path}:${row.line}`).sort()).toEqual(treeRetitles.sort());
    for (const [path, retired] of RETIRED_TITLES) expect(titleRows.some((row) => row.path === path && row.retired.includes(retired)), `${path}: ${retired}`).toBe(true);
    // every closeout tag in code: the 20 retitle notes, the 4 tombstones (one per retired row) and the dead mock key's annotation
    const tags = [...productionSources(), ...testFiles()].flatMap((path) => read(path).split(NEWLINE).filter((line) => line.includes(TAG)).map((line) => [path, line] as const));
    const kinds = tags.map(([path, line]) => (line.includes(RETITLED) ? "retitle" : line.includes(`${TAG}retired: `) ? "tombstone" : line.includes(`${TAG}no longer read: `) ? "mock key" : `unregistered: ${path}: ${line.trim()}`));
    expect(kinds.filter((kind) => kind.startsWith("unregistered"))).toEqual([]);
    expect([kinds.filter((kind) => kind === "retitle").length, kinds.filter((kind) => kind === "tombstone").length, kinds.filter((kind) => kind === "mock key").length]).toEqual([20, 4, 1]);
  });
});
