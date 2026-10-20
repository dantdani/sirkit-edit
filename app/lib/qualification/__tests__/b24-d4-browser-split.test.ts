/**
 * [B24-D4] The OD-30 split of page-browser-e2e (the lead's corrective increment). CI's page-browser-e2e ran 27 min 40 s of 30 at
 * B24-D3's run (38061798204; its OD-30 headroom step: 2 min 20 s, `split_required`), and OD-30's rule ("within five minutes of the
 * limit: split the job") applies; no `timeout-minutes` is raised. The two specs B24-D3 added (`e2e/keyboard-and-focus.spec.ts`,
 * `e2e/minimum-width.spec.ts`) and, [B24-D4 lead, 2026-10-10] by the lead's option (b) of `ci-split.md` section 11.9 (so that
 * page-browser-e2e keeps OD-30's five minutes), the two B24-D2 added (`e2e/multi-tab.spec.ts`, `e2e/crash-recovery.spec.ts`) move
 * into a job appended at the end of the workflow, `page-browser-e2e-b24` (B24's own browser specs; the lead renamed the draft's
 * accessibility-only name, which would misdescribe it); every other spec
 * and the orchestration step stay. Insertions only, as B24-D0 split prompt-to-gerber: `playwright.config.ts:21` gains, in place,
 * `testIgnore` read from `SIRKIT_E2E_SKIP` (a comma-separated list of spec globs; unset or empty ignores nothing); page-browser-e2e's
 * first browser step gains an `env:` mapping setting it to the four moved specs; the lead's option A (2026-10-10) inventories the name
 * (one row in `flag-inventory.ts`, one in `environment-names.ts`). This suite pins the split to the tree:
 *
 *  1. (i) the new job is appended last, after agent-boundary-suites ([PR-L7, 2026-10-20] OD-254 appended page-browser-e2e-agent after it, the workflow's last job now, pinned the same way in case 1; cases 2, 3 and 5 read both appended jobs): one blank line and its `[B24-D4]` comment lines, then exactly
 *     its steps in order - B24-D1's start step, page-browser-e2e's checkout, pnpm, node, install and browser-install steps verbatim,
 *     one named step running `pnpm exec playwright test` with the four specs ([B24-D4 lead, 2026-10-10] B24-D2's two, then B24-D3's
 *     two, in that fixed order), an always() upload of its own report and test results
 *     under its own artifact name, B24-D1's headroom step - with `timeout-minutes: 20`, `CI: "true"` and no secret, database or live
 *     resource; every other job's limit unchanged;
 *  2. (ii) the `SIRKIT_E2E_SKIP` value inserted under page-browser-e2e's first browser step names exactly the specs the new job runs,
 *     each spec exists, each glob is `**` + `/<name>.spec.ts`, and no other line of the workflow names the variable; the admission
 *     helper reads both lists from the workflow (`_ci-admission.ts`) and refuses a malformed glob, a glob naming no spec, an
 *     argument that is not an `e2e/` spec and a missing or doubled run line;
 *  3. (iii) every spec `playwright.config.ts` collects (`testDir` and `testMatch`, read from the config) runs in exactly one of the
 *     two jobs, as the helper derives it from the workflow and line 21's `testIgnore` reader - never from a hand list; the moved
 *     specs are the skip list's; the orchestration spec stays in page-browser-e2e;
 *  4. (iv) `playwright.config.ts` keeps its 71 lines, line 21 still starts `testMatch: /.*\.spec\.ts/,` and holds the reader and a
 *     dated note, every other line is 1fe719e's (the file with line 21 restored hashes to 1fe719e's), and the orchestration config is
 *     1fe719e's byte for byte; [PR-G, 2026-10-17] 74 lines since PR-F's three (OD-248), which case 4 takes out by text before the hash;
 *  5. (v) A1's insertion table ends with D4's two rows, the env mapping (`:418`, 2) and the appended job (its first line, its count
 *     including the leading blank line, A2's convention); with D4's lines taken out the workflow is 1fe719e's byte for byte, so no line
 *     was removed, reordered or edited;
 *  6. the lead's option A: one inventory row and one census row, each appended on `SIRKIT_E2E_PORT`'s line (neither module gains a
 *     line), describing the reader exactly; no runtime record changes (a tooling row stays out of the deployment configuration);
 *  7. the page (`ci-split.md` section 11): its parts in order, the CI figures as the lead recorded them, the two specs' local times,
 *     the OD-30 arithmetic computed here and stated INFERRED, no CI time claimed CONFIRMED for the new job, this suite's row with its
 *     real `it(` count, every citation on the line it names, and the records for the lead under their headings. [B24-D4 review,
 *     2026-10-10] security-1: each job's estimate takes the figure conservative FOR IT - page-browser-e2e loses the two specs'
 *     MEASURED CI share and gains the orchestration step its runs never reached (estimated from B24-C2's job), the new job takes the
 *     ratio's larger share - and the records carry the result (under OD-30's five minutes), never the first draft's 19 min 24 s;
 *     [B24-D4 lead, 2026-10-10] option (b): page-browser-e2e loses the four moved specs' measured CI share on D3's run (B24-D3's two
 *     and B24-D2's two: multi-tab 168.0 s, crash-recovery 48.2 s) and gains the orchestration step; the new job takes the ratio's
 *     share for B24-D3's two and B24-D2's two as measured; BOTH headrooms must be at least OD-30's five minutes, stated INFERRED, and
 *     the records (the OD-30 amendment, the discovery line, the README row, the ledger) say the lead chose option (b) and the rename,
 *     give both expected figures and never say the lead decides before commit;
 *  8. [B24-D4 review, 2026-10-10] the other pages D4 edits: `edge-security.md` section 5's census paragraph reads whole (D4's row
 *     note before the `SIRKIT_AUTH_MODE` sentence, on the paragraph's first line, where `b24-a2-env-names` 9 reads the total;
 *     correctness-5), and the present-tense citations of the OD-30 steps that follow D4's `env:` mapping carry a dated D4 note naming
 *     the lines the workflow holds them on now (`performance-and-reliability.md`, `ci-split.md` section 4; security-4). [B24-D4 lead,
 *     2026-10-10] The rename: the draft name is in no workflow, config, module, helper, census, script, spec or test line, and every
 *     page line that still names it carries the lead's dated note; D2's page names the new job where it named page-browser-e2e as the
 *     CI job that runs B24-D2's two specs (sections 25, 27 and 29).
 *
 * Red first at `1fe719e` (`d4r2-07-red-browser-split`): cases 1, 2, 3, 5, 6 and 7 fail (no job, no skip list, no rows, no inventory
 * row, no section) and case 4 fails on line 21's reader; its invariants (71 lines, the `testMatch` start, the orchestration config)
 * hold by design. [B24-D4 review, 2026-10-10] Cases 7 (the arithmetic) and 8 failed first on the D4 tree before the review round's
 * page edits (`d4fix-04-red-browser-split`). [B24-D4 lead, 2026-10-10] Cases 1, 2, 3, 5, 7 and 8 failed first on the D4 tree before
 * the lead's option (b) and the rename were applied (`d4lead-01-red-browser-split`). Files are read as text; nothing is written to
 * disk and no process is started.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FLAG_INVENTORY } from "@/app/lib/deployment/flag-inventory";
import { ENVIRONMENT_NAMES } from "@/app/lib/deployment/environment-names";
import { buildDeploymentConfiguration } from "@/app/lib/deployment/configuration";
import { ciAdmission, readRepoText, type RepoReader } from "./_ci-admission";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = readRepoText;
const lines = (path: string): string[] => read(path).split(NEWLINE);
const WORKFLOW = ".github/workflows/deterministic-manufacturing.yml";
const CONFIG = "playwright.config.ts";
const ORCHESTRATION_CONFIG = "playwright.orchestration.config.ts";
const ENV_PAGE = "artifacts/ai-control-plane-b24/environments-and-deployment.md";
const PAGE = "artifacts/ai-control-plane-b24/ci-split.md";
const SELF = "app/lib/qualification/__tests__/b24-d4-browser-split.test.ts";
const DATE = "2026-10-10";
const JOB = "page-browser-e2e-b24"; // [B24-D4 lead, 2026-10-10] renamed: the job runs B24's own browser specs (option (b)), not accessibility's alone
const SKIP_ENV = "SIRKIT_E2E_SKIP";
/** The specs the new job runs, in the run line's fixed order: [B24-D4 lead, 2026-10-10] option (b) - B24-D2's two (multi-tab,
 *  crash-recovery), then the two B24-D3 added (task-D4 "Lead decisions"): the expectation the tree is held to. */
const MOVED_SPECS = ["e2e/multi-tab.spec.ts", "e2e/crash-recovery.spec.ts", "e2e/keyboard-and-focus.spec.ts", "e2e/minimum-width.spec.ts"] as const; const AGENT_JOB = "page-browser-e2e-agent"; const AGENT_SPECS = ["e2e/agent-execution.spec.ts"] as const; // [PR-L7, 2026-10-20] OD-254: the second appended browser job and the spec it runs (page-browser-e2e skips it too)
/** 1fe719e's bytes (LF), the tree D4 starts from: the workflow, `playwright.config.ts` and the orchestration config. */
const SHA_WORKFLOW_AT_BASE = "dde22b3d0737a62db577ff5bcd454e8eb6b68c0acf0b03ee0f287efd78d739c4";
const SHA_CONFIG_AT_BASE = "92f72ee81ef2158dcfb524d961aeb9d60116e1966ade404297c986dd759bf171";
const SHA_ORCHESTRATION_CONFIG_AT_BASE = "6239dff5e0000229266b56b0bd1e69f8e4bd70df4541e3ff01e203062a7b2701";
const WORKFLOW_LINES_AT_BASE = 626;
const CONFIG_LINES = 74; // [PR-G, 2026-10-17] reviewed pin move: 71 -> 74, PR-F's three lines in the fixture server's env (PR_F_CONFIG_LINES; OD-248: the fixture proof must never reach a vendor), all below line 21, which keeps its place and text
/** [PR-G, 2026-10-17] PR-F's three inserted lines (OD-248), each read: its dated two-line comment and the operator-disabled distributor sources
 *  for the fixture server, by their own first words; case 4 takes exactly them out before the base hash, so every other line stays 1fe719e's. */
const PR_F_CONFIG_LINES = ["      // [PR-F, 2026-10-17] the fixture proof must never reach a vendor: ", "      // fixture server unless the shell names its own set ", "      SIRKIT_ACQUISITION_DISABLED_SOURCES: process.env.SIRKIT_ACQUISITION_DISABLED_SOURCES ?? "] as const;
const TEST_MATCH = "testMatch: /.*\\.spec\\.ts/,";
/** [PR-L, 2026-10-17] reviewed pin move (runbook L.4, increment 4): the fixture web server starts through scripts/dev-with-worker.mjs, so the
 *  browser proofs have a generation worker beside next dev (the pump transport under the fixture runtime). ONE line changed IN PLACE, by its
 *  own first words, with a dated note; case 4 maps it back to its base text before the base hash, so every other line stays 1fe719e's. */
const PR_L_COMMAND_LINE = "    command: `node scripts/dev-with-worker.mjs --port ${PORT}`, // [PR-L, 2026-10-17] ";
const BASE_COMMAND_LINE = "    command: `pnpm exec next dev --port ${PORT}`,";
/** Line 21's reader, exactly (the expression the guard mirrors below; any other spelling fails case 4). */
const SKIP_READER = `testIgnore: (process.env.${SKIP_ENV} ?? "").split(",").map((glob) => glob.trim()).filter(Boolean),`;
/** The first inserted line: right after page-browser-e2e's first browser step (`:417` at 1fe719e, B21's C49). */
const ENV_FIRST_LINE = 418;
/** OD-30's figures as the lead recorded them (task-D4 "Why"): B24-D3's run, B24-D2's run, and the ratio's two times. */
const CI_D3_SECONDS = 27 * 60 + 40;
const CI_D3_HEADROOM_SECONDS = 2 * 60 + 20;
const CI_D2_SECONDS = 21 * 60 + 46;
const CI_D2_HEADROOM_SECONDS = 8 * 60 + 23;
const CI_AGENT_EXECUTION_SECONDS = 750;
const LOCAL_AGENT_EXECUTION_SECONDS = 171;
/** B24-D3's two specs' local times (B24-D3's lead runs: about 111 s and 2 s). */
const LOCAL_MOVED_SECONDS = 111 + 2;
/** page-browser-e2e's setup on B24-D3's run, read off the log's step timestamps: 14:59:37 (the start step) to 15:00:33 (`playwright test`). */
const CI_SETUP_SECONDS = 56;
/** [B24-D4 review, 2026-10-10] security-1: the two specs' CI times on B24-D3's run as its log prints them (keyboard-and-focus 1-4:
 *  2.2m, 4.8s, 1.1m, 1.4m; minimum-width 1-3: 117ms, 2.6s, 2.0s; keyboard-and-focus 5 did not run). */
const CI_D3_MOVED_MEASURED = [2.2 * 60, 4.8, 1.1 * 60, 1.4 * 60, 0.117, 2.6, 2.0];
/** [B24-D4 lead, 2026-10-10] option (b): B24-D2's two specs' CI times on B24-D3's run as its log prints them (multi-tab 1-2: 1.6m,
 *  1.2m - case 2 failing, case 3 did not run; crash-recovery (a), (b): 22.6s, 25.6s). */
const CI_D3_D2_SPECS_MEASURED = [1.6 * 60, 1.2 * 60, 22.6, 25.6];
/** B24-C2's page-browser-e2e job, the orchestration step included (21 min 15 s, the lead's reading, this page's section 4), and the
 *  two specs B24-D2 added after it, on D2's run (crash-recovery 21.6s; multi-tab 1.9m and 1.1m, case 3 not run). */
const CI_C2_SECONDS = 21 * 60 + 15;
const CI_D2_ADDED_SPECS_SECONDS = 21.6 + 1.9 * 60 + 1.1 * 60;
/** OD-30's line: a headroom under five minutes is `split_required`. */
const OD30_HEADROOM_SECONDS = 5 * 60;

const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const lineCount = (all: readonly string[]): number => all.length - (all[all.length - 1] === "" ? 1 : 0);
const minutesSeconds = (value: number): string => {
  const whole = Math.round(value);
  return `${Math.floor(whole / 60)} min ${String(whole % 60).padStart(2, "0")} s`;
};

describe("[B24-D4] the OD-30 split of page-browser-e2e", () => {
  it("1. (i) the new job is appended last with exactly its steps in order: B24-D1's start step, page-browser-e2e's setup verbatim, one named step running the four specs ([B24-D4 lead, 2026-10-10] option (b)), an always() upload under its own name, B24-D1's headroom step; 20 minutes, CI true, no secret, database or live resource; every other job's limit unchanged", () => {
    const workflow = lines(WORKFLOW);
    const keys = workflow.flatMap((line, index) => (index > workflow.indexOf("jobs:") && /^ {2}[a-z][a-z0-9-]*:$/.test(line) ? [line.trim()] : []));
    expect(keys).toEqual(["prompt-to-gerber:", "database-delivery:", "page-browser-e2e:", "production-smoke:", "secret-scan:", "agent-boundary-suites:", `${JOB}:`, `${AGENT_JOB}:`]); // [PR-L7, 2026-10-20] reviewed pin move: + page-browser-e2e-agent, appended after this job (OD-254)
    const start = workflow.indexOf(`  ${JOB}:`);
    let end = workflow.indexOf(`  ${AGENT_JOB}:`); while (/^(?:| {2}# .*)$/.test(workflow[end - 1]!)) end -= 1; // [PR-L7, 2026-10-20] reviewed pin move: the job's own lines end where page-browser-e2e-agent's region begins (was the workflow's end; OD-254)
    const block = workflow.slice(start, end);
    // appended: its [B24-D4] comment lines right above its key, one blank line above them, agent-boundary-suites's headroom step above that
    let above = start - 1;
    while (workflow[above]!.startsWith("  # ")) above -= 1;
    expect(start - above, "its comment lines").toBeGreaterThanOrEqual(2);
    expect(workflow.slice(above + 1, start).join(NEWLINE)).toContain("[B24-D4]");
    expect(workflow[above]).toBe("");
    expect(workflow[above - 1]).toBe("        run: pnpm exec tsx scripts/ci-job-headroom.ts .github/workflows/deterministic-manufacturing.yml agent-boundary-suites");
    // page-browser-e2e's setup, copied verbatim
    const browserStart = workflow.indexOf("  page-browser-e2e:");
    const browser = workflow.slice(browserStart, workflow.findIndex((line, index) => index > browserStart && /^ {2}[a-z][a-z0-9-]*:$/.test(line)));
    const setup = browser.slice(browser.indexOf("      - uses: actions/checkout@v4"), browser.indexOf("      - run: pnpm exec playwright install --with-deps chromium") + 1);
    expect(setup).toHaveLength(10);
    expect(block).toEqual([
      `  ${JOB}:`,
      "    runs-on: ubuntu-latest",
      "    timeout-minutes: 20",
      "    env:",
      '      CI: "true"',
      "    steps:",
      `      - run: echo "SIRKIT_JOB_STARTED_AT=$(date +%s)" >> "$GITHUB_ENV" # [B24-D1] OD-30: ${JOB}'s start`,
      ...setup,
      "      - name: B24's browser specs (B24-D2's two, B24-D3's two; OD-30's split)", // [B24-D4 lead, 2026-10-10] option (b) and the rename
      `        run: pnpm exec playwright test ${MOVED_SPECS.join(" ")}`,
      "      - name: Upload browser evidence (B24's specs)", // [B24-D4 lead, 2026-10-10] the rename: the label names the job's specs truthfully
      "        if: always()",
      "        uses: actions/upload-artifact@v4",
      "        with:",
      `          name: ${JOB}-report`,
      "          path: |",
      "            playwright-report",
      "            test-results",
      "          if-no-files-found: ignore",
      "          retention-days: 14",
      `      - if: always() # [B24-D1] OD-30: ${JOB}'s headroom`,
      `        run: pnpm exec tsx scripts/ci-job-headroom.ts ${WORKFLOW} ${JOB}`,
    ]);
    const text = [...workflow.slice(above, start), ...block].join(NEWLINE);
    for (const absent of ["secrets.", "permissions:", "DATABASE_URL", "SUPABASE", "OPENAI", "ANTHROPIC", "next build", "next start", SKIP_ENV.concat(":")]) expect(text, absent).not.toContain(absent);
    // the run step is named, so its line never holds B21's C49 anchor (`- run: pnpm exec playwright test`, cited exactly once)
    expect(workflow.filter((line) => line.includes("- run: pnpm exec playwright test"))).toEqual(["      - run: pnpm exec playwright test"]);
    // no timeout-minutes raised: the six earlier jobs keep theirs, the new job has 20
    expect(workflow.filter((line) => /^ {4}timeout-minutes: /.test(line)).map((line) => line.trim())).toEqual(["timeout-minutes: 25", "timeout-minutes: 15", "timeout-minutes: 30", "timeout-minutes: 20", "timeout-minutes: 10", "timeout-minutes: 20", "timeout-minutes: 20", "timeout-minutes: 30"]); // [PR-L7, 2026-10-20] reviewed pin move: + page-browser-e2e-agent's 30 (OD-254); no limit raised
    expect(workflow.some((line) => /^\s+needs:/.test(line)), "no job waits on another").toBe(false); const agentStart = workflow.indexOf(`  ${AGENT_JOB}:`); let agentAbove = agentStart - 1; while (workflow[agentAbove]!.startsWith("  # ")) agentAbove -= 1; expect(workflow[agentAbove]).toBe(""); expect(workflow[agentAbove - 1]).toBe(`        run: pnpm exec tsx scripts/ci-job-headroom.ts ${WORKFLOW} ${JOB}`); expect(workflow.slice(agentAbove + 1, agentStart).join(NEWLINE)).toContain("[PR-L7]"); expect(workflow.slice(agentStart, lineCount(workflow))).toEqual([`  ${AGENT_JOB}:`, "    runs-on: ubuntu-latest", "    timeout-minutes: 30", "    env:", '      CI: "true"', "    steps:", `      - run: echo "SIRKIT_JOB_STARTED_AT=$(date +%s)" >> "$GITHUB_ENV" # [B24-D1] OD-30: ${AGENT_JOB}'s start`, ...setup, "      - name: The agent-execution browser spec (OD-254; OD-30's split)", `        run: pnpm exec playwright test ${AGENT_SPECS.join(" ")}`, "      - name: Upload browser evidence (the agent-execution spec)", "        if: always()", "        uses: actions/upload-artifact@v4", "        with:", `          name: ${AGENT_JOB}-report`, "          path: |", "            playwright-report", "            test-results", "          if-no-files-found: ignore", "          retention-days: 14", `      - if: always() # [B24-D1] OD-30: ${AGENT_JOB}'s headroom`, `        run: pnpm exec tsx scripts/ci-job-headroom.ts ${WORKFLOW} ${AGENT_JOB}`]); for (const absent of ["secrets.", "permissions:", "DATABASE_URL", "SUPABASE", "OPENAI", "ANTHROPIC", "next build", "next start", SKIP_ENV.concat(":")]) expect(workflow.slice(agentAbove, lineCount(workflow)).join(NEWLINE), absent).not.toContain(absent); // [PR-L7, 2026-10-20] OD-254: the second appended browser job, last: its [PR-L7] comment lines, page-browser-e2e's setup verbatim, one named step running agent-execution, its own upload, B24-D1's headroom step; 30 minutes (OD-30's browser limit)
  });

  it("2. (ii) the SIRKIT_E2E_SKIP value under page-browser-e2e's first browser step names exactly the specs the new job runs, each existing, each glob **/<name>.spec.ts, and no other line names the variable; the helper reads both lists and refuses a malformed glob, a glob naming no spec, a non-e2e argument and a missing or doubled run line", () => {
    const workflow = lines(WORKFLOW);
    const run = workflow.indexOf("      - run: pnpm exec playwright test");
    expect(run + 1, "page-browser-e2e's first browser step, unmoved by D4 (B21's C49)").toBe(insertionRows().filter((row) => row.task === "PR-G" || row.task === "PR-L7").reduce((at, row) => (at >= row.first ? at + row.count : at), ENV_FIRST_LINE - 1)); // [PR-L7, 2026-10-20] reviewed pin move (OD-254): and through PR-L7's rows (its 71 prompt-to-gerber and 13 database-delivery lines above this step); [PR-G, 2026-10-17] reviewed pin move (OD-250): D4's line carried through PR-G's rows (its 39 prompt-to-gerber lines above this step; was ENV_FIRST_LINE - 1 itself)
    expect(workflow[run + 1]).toBe("        env:");
    const entry = /^ {10}SIRKIT_E2E_SKIP: "([^"]*)" # \[B24-D4\] OD-30: [^\n]+$/.exec(workflow[run + 2]!);
    expect(entry, "the one env entry, quoted, with its dated comment").not.toBeNull();
    expect(workflow[run + 3]).toBe("      # [B21 F2] D21-43: the orchestration spec on its own config and flag-on server, AFTER the step above - one next dev at a time");
    expect(workflow.filter((line) => /^\s+SIRKIT_E2E_SKIP:/.test(line)), "no other step sets it").toHaveLength(1);
    // the reader's own parse (line 21: split on commas, trim, drop blanks), applied to the value
    const globs = entry![1]!.split(",").map((glob) => glob.trim()).filter(Boolean);
    expect(globs).toEqual([...MOVED_SPECS, ...AGENT_SPECS].map((spec) => `**/${spec.slice("e2e/".length)}`)); // [PR-L7, 2026-10-20] reviewed pin move: + agent-execution, which page-browser-e2e-agent runs (OD-254)
    for (const glob of globs) expect(glob, glob).toMatch(/^\*\*\/[a-z0-9-]+\.spec\.ts$/);
    for (const spec of MOVED_SPECS) expect(existsSync(join(ROOT, spec)), spec).toBe(true);
    const args = /^ {8}run: pnpm exec playwright test ((?:e2e\/[a-z0-9-]+\.spec\.ts ?)+)$/.exec(workflow[workflow.indexOf(`  ${JOB}:`) + 18]!);
    expect(args, "the new job's one run line").not.toBeNull();
    expect(args![1]!.trim().split(" ")).toEqual([...MOVED_SPECS]);
    // the helper derives the same two lists from the files
    const admission = ciAdmission();
    expect(admission.browser.skip).toEqual(globs);
    expect(admission.browser.b24).toEqual([...MOVED_SPECS]); expect(admission.browser.agent).toEqual([...AGENT_SPECS]); // [PR-L7, 2026-10-20] OD-254: the second appended job's spec, read the same way
    // ... and refuses each malformed shape (each plant changes the text; the message starts CI_ANCHOR)
    const original = read(WORKFLOW);
    const withWorkflow = (text: string): RepoReader => (path) => (path === WORKFLOW ? text : read(path));
    const bites = (text: string, pattern: RegExp): boolean => {
      expect(text, "the plant changes the text").not.toBe(original);
      try {
        ciAdmission(withWorkflow(text));
        return false;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return message.startsWith("CI_ANCHOR: ") && pattern.test(message);
      }
    };
    const value = `"${entry![1]}"`;
    const runLine = `        run: pnpm exec playwright test ${MOVED_SPECS.join(" ")}`;
    const plants: ReadonlyArray<readonly [string, string, RegExp]> = [
      ["a glob that is not **/<name>.spec.ts", original.replace(value, '"e2e/keyboard-and-focus.spec.ts,**/minimum-width.spec.ts"'), /a skip glob that is not/],
      ["a glob naming no spec", original.replace(value, '"**/keyboard-and-focus.spec.ts,**/no-such.spec.ts"'), /names no spec/],
      ["an unquoted value", original.replace(value, entry![1]!), /SIRKIT_E2E_SKIP/],
      ["a second env entry", original.replace(`${value} #`, `${value}${NEWLINE}          OTHER: "1" #`), /SIRKIT_E2E_SKIP|env/],
      ["a non-e2e argument", original.replace(runLine, `${runLine} app/lib/qualification/__tests__`), /an argument that is not an e2e spec/],
      ["the run line dropped", original.replace(`${runLine}${NEWLINE}`, ""), /absent/],
      ["the run line doubled", original.replace(`${runLine}${NEWLINE}`, `${runLine}${NEWLINE}${runLine}${NEWLINE}`), /appears twice/],
      ["the skip list and the new job disagree", original.replace(value, '"**/keyboard-and-focus.spec.ts"'), new RegExp(`skips .* but ${JOB} runs|the skip list`)],
      ["the skip list without B24-D2's two", original.replace(value, '"**/keyboard-and-focus.spec.ts,**/minimum-width.spec.ts"'), new RegExp(`skips .* but ${JOB} runs|the skip list`)], // [B24-D4 lead, 2026-10-10] option (b)
      ["the new job's key dropped", original.replace(`${NEWLINE}  ${JOB}:${NEWLINE}`, NEWLINE), /absent$/],
      ["the new job's key doubled", original.replace(`${NEWLINE}  ${JOB}:${NEWLINE}`, `${NEWLINE}  ${JOB}:${NEWLINE}  ${JOB}:${NEWLINE}`), /appears twice$/], ["the skip list without agent-execution", original.replace(value, `"${MOVED_SPECS.map((spec) => `**/${spec.slice(4)}`).join(",")}"`), new RegExp(`skips .* but ${JOB} runs .* and ${AGENT_JOB} runs`)], ["the agent job's run line dropped", original.replace(`        run: pnpm exec playwright test ${AGENT_SPECS.join(" ")}${NEWLINE}`, ""), new RegExp(`${AGENT_JOB}'s playwright test line absent`)], ["a spec in both appended jobs", original.replace(`        run: pnpm exec playwright test ${AGENT_SPECS.join(" ")}${NEWLINE}`, `        run: pnpm exec playwright test ${AGENT_SPECS.join(" ")} e2e/minimum-width.spec.ts${NEWLINE}`), /a spec runs in both appended browser jobs/], ["the agent job's key dropped (its run line falls into page-browser-e2e-b24's block)", original.replace(`${NEWLINE}  ${AGENT_JOB}:${NEWLINE}`, NEWLINE), new RegExp(`${JOB}'s playwright test line appears twice$`)], // [PR-L7, 2026-10-20] OD-254: the second appended job bites the same way
    ];
    expect(plants.filter(([, text, pattern]) => !bites(text, pattern)).map(([name]) => name)).toEqual([]);
  });

  it("3. (iii) every spec playwright.config.ts collects runs in exactly one of the two jobs, as the helper derives it from the workflow and line 21's reader; the moved specs are the skip list's; the orchestration spec stays in page-browser-e2e", () => {
    const config = lines(CONFIG);
    expect(config[19]).toBe('  testDir: "./e2e",');
    const specs: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        const path = `${dir}/${entry}`;
        if (statSync(join(ROOT, path)).isDirectory()) walk(path);
        else if (/.*\.spec\.ts/.test(entry)) specs.push(path); // the config's testMatch, applied to the file name
      }
    };
    walk("e2e");
    specs.sort();
    expect(specs.length).toBeGreaterThanOrEqual(9);
    const admission = ciAdmission();
    const browserJobs = (spec: string): string[] => admission.jobsOf(spec).filter((job) => job === "page-browser-e2e" || job === JOB || job === AGENT_JOB); // [PR-L7, 2026-10-20] reviewed pin move: + page-browser-e2e-agent (OD-254); every spec still runs in exactly one browser job
    expect(specs.filter((spec) => browserJobs(spec).length !== 1).map((spec) => `${spec}: ${browserJobs(spec).join("+") || "none"}`)).toEqual([]);
    const moved = specs.filter((spec) => browserJobs(spec)[0] === JOB);
    expect(moved).toEqual([...MOVED_SPECS].sort()); // [B24-D4 lead, 2026-10-10] the four, in the walk's (sorted) order
    // the moved set is the skip list's, by Playwright's rule for a `**/` glob (the file name at any depth), never a hand list
    expect(specs.filter((spec) => admission.browser.skip.some((glob) => spec.endsWith(`/${glob.slice(3)}`)))).toEqual([...moved, ...AGENT_SPECS].sort()); expect(specs.filter((spec) => browserJobs(spec)[0] === AGENT_JOB)).toEqual([...AGENT_SPECS]); // [PR-L7, 2026-10-20] reviewed pin move: the skip list is both appended jobs' specs (OD-254)
    expect(specs.filter((spec) => admission.browser.b24.includes(spec))).toEqual(moved);
    expect(specs.filter((spec) => !moved.includes(spec) && !(AGENT_SPECS as readonly string[]).includes(spec)).every((spec) => JSON.stringify(admission.jobsOf(spec)) === JSON.stringify(["page-browser-e2e"]))).toBe(true); // [PR-L7, 2026-10-20] reviewed pin move: agent-execution aside (OD-254)
    expect(admission.jobsOf("e2e-orchestration/specialist-orchestration.spec.ts")).toEqual(["page-browser-e2e"]);
    // the orchestration step never sees the variable: its env is page-browser-e2e's first browser step's alone (case 2), and its config sets no testIgnore
    expect(read(ORCHESTRATION_CONFIG)).not.toContain("testIgnore");
  });

  it("4. (iv) playwright.config.ts keeps its 71 lines; line 21 still starts testMatch and holds the SIRKIT_E2E_SKIP reader and a dated note; every other line is 1fe719e's; the orchestration config is 1fe719e's byte for byte", () => {
    const config = lines(CONFIG);
    expect(lineCount(config)).toBe(CONFIG_LINES);
    const line = config[20]!;
    expect(line.startsWith(`  ${TEST_MATCH}`)).toBe(true);
    expect(line.startsWith(`  ${TEST_MATCH} ${SKIP_READER} // [B24-D4, ${DATE}] `), line).toBe(true);
    expect(config.filter((text) => text.includes(SKIP_ENV))).toEqual([line]);
    // [PR-G, 2026-10-17] PR-F's three lines stand together once, below line 21, each starting as PR_F_CONFIG_LINES names it; with them taken out too, the file hashes to 1fe719e's
    const prF = config.findIndex((text) => text.startsWith(PR_F_CONFIG_LINES[0]));
    expect(prF).toBeGreaterThan(20);
    expect(PR_F_CONFIG_LINES.map((first, index) => (config[prF + index] ?? "").startsWith(first))).toEqual([true, true, true]);
    expect(config.filter((text) => PR_F_CONFIG_LINES.some((first) => text.startsWith(first)))).toHaveLength(3);
    expect(config.filter((text) => text.startsWith(PR_L_COMMAND_LINE)), "[PR-L, 2026-10-17] the one changed command line").toHaveLength(1);
    expect(config.filter((text) => text.trimStart().startsWith("command:")), "one web server command").toHaveLength(1);
    const base = config.filter((_, index) => index < prF || index >= prF + PR_F_CONFIG_LINES.length).map((text) => (text.startsWith(PR_L_COMMAND_LINE) ? BASE_COMMAND_LINE : text)); // [PR-L, 2026-10-17] the command line read at its base text
    expect(sha([...base.slice(0, 20), `  ${TEST_MATCH}`, ...base.slice(21)].join(NEWLINE)), "every other line is 1fe719e's").toBe(SHA_CONFIG_AT_BASE);
    expect(sha(read(ORCHESTRATION_CONFIG))).toBe(SHA_ORCHESTRATION_CONFIG_AT_BASE);
  });

  it("5. (v) A1's insertion table ends with D4's two rows - the env mapping (:418, 2) inside page-browser-e2e and the appended job (its first line, its count with the leading blank line) - and with D4's lines taken out the workflow is 1fe719e's byte for byte", () => {
    const rows = insertionRows();
    const mine = rows.filter((row) => row.task === "B24-D4");
    const later = rows.slice(rows.indexOf(mine[0]!) + 2); expect(rows.slice(rows.indexOf(mine[0]!), rows.indexOf(mine[0]!) + 2)).toEqual(mine); expect(later.map((row) => row.task)).toEqual([...Array(5).fill("PR-G"), ...Array(5).fill("PR-L7")]); /* [PR-L7, 2026-10-20] reviewed pin move: + PR-L7's five rows (OD-254) */ const atD4 = (line: number): number => [...later].reverse().reduce((at, row) => (at >= row.first + row.count ? at - row.count : at), line); // [PR-G, 2026-10-17] reviewed pin move (OD-250): D4's two rows are followed by PR-G's five, the only later rows (was: the table's last two); a line of this tree is read at D4's tree by taking PR-G's rows out
    const workflow = lines(WORKFLOW);
    const start = workflow.indexOf(`  ${JOB}:`);
    let first = start;
    while (/^(?:| {2}# .*)$/.test(workflow[first - 1]!)) first -= 1;
    let next = workflow.indexOf(`  ${AGENT_JOB}:`); while (/^(?:| {2}# .*)$/.test(workflow[next - 1]!)) next -= 1; const count = next - first; // [PR-L7, 2026-10-20] reviewed pin move: to page-browser-e2e-agent's region (was the workflow's end; OD-254)
    expect(mine.map((row) => [row.date, row.job, row.first, row.count])).toEqual([[DATE, "page-browser-e2e", ENV_FIRST_LINE, 2], [DATE, JOB, atD4(first + 1), count]]); // [PR-G, 2026-10-17] the job's first line at D4's tree (was first + 1: PR-G's rows above it moved it +59)
    expect(workflow[first]).toBe("");
    // every line since A1 is recorded (A1's own check, `b24-a1-environment-profile` 14 and 16)
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(lineCount(workflow) - 435);
    // insertions only: D4's two groups taken out leave 1fe719e's workflow
    const d4Tree = [...later].reverse().reduce((all: string[], row) => [...all.slice(0, row.first - 1), ...all.slice(row.first - 1 + row.count)], workflow); const without = [...d4Tree.slice(0, ENV_FIRST_LINE - 1), ...d4Tree.slice(ENV_FIRST_LINE + 1, atD4(first + 1) - 1)]; // [PR-G, 2026-10-17] reviewed pin move (OD-250): PR-G's groups taken out first (insertions only: the rows, last to first), then D4's
    expect(lineCount([...without, ""])).toBe(WORKFLOW_LINES_AT_BASE);
    expect(sha(`${without.join(NEWLINE)}${NEWLINE}`), "the workflow without D4's lines").toBe(SHA_WORKFLOW_AT_BASE);
  });

  it("6. the lead's option A: SIRKIT_E2E_SKIP has one inventory row (tooling, unset ignores nothing, disables, owner playwright.config.ts:21, no constant, a list parse) and one census row (platform, read by playwright.config.ts), each appended on SIRKIT_E2E_PORT's line; no runtime record changes", () => {
    expect(FLAG_INVENTORY.find((entry) => entry.name === SKIP_ENV)).toEqual({ name: SKIP_ENV, kind: "tooling", default: "unset (ignores nothing)", direction: "disables", owner: `${CONFIG}:21`, constant: null, rule: { parse: "list" } });
    const census = ENVIRONMENT_NAMES.find((row) => row.name === SKIP_ENV);
    expect(census).toMatchObject({ class: "platform", reader: CONFIG });
    expect(census!.reason!.length).toBeGreaterThan(20);
    // appended on the line of the neighbouring name, so neither module gains a line (their cited lines hold)
    const inventory = lines("app/lib/deployment/flag-inventory.ts");
    expect(lineCount(inventory)).toBe(130);
    expect(inventory.filter((line) => line.includes(`"${SKIP_ENV}"`))).toEqual(inventory.filter((line) => line.includes('"SIRKIT_E2E_PORT"')));
    const names = lines("app/lib/deployment/environment-names.ts");
    expect(lineCount(names)).toBe(150);
    expect(names.filter((line) => line.includes(`"${SKIP_ENV}"`))).toEqual(names.filter((line) => line.includes('"SIRKIT_E2E_PORT"')));
    // a tooling row is no flag: the deployment configuration's record does not list it
    expect(buildDeploymentConfiguration({}).flags.map((flag) => flag.name)).not.toContain(SKIP_ENV);
    expect(buildDeploymentConfiguration({ [SKIP_ENV]: "**/keyboard-and-focus.spec.ts" }).flags).toEqual(buildDeploymentConfiguration({}).flags);
  });

  it("7. the page: ci-split.md section 11, its parts in order, the CI figures as recorded, the local times, the OD-30 arithmetic stated INFERRED, no CI time CONFIRMED for the new job, this suite's row with its it( count, every citation on its line, the records for the lead", () => {
    const page = read(PAGE);
    const at = page.indexOf(`${NEWLINE}## 11. B24-D4 - the OD-30 split of page-browser-e2e${NEWLINE}`);
    expect(at, "section 11").toBeGreaterThan(page.indexOf(`${NEWLINE}## 10. Citations${NEWLINE}`));
    const eleven = page.slice(at);
    expect(eleven.slice(1).includes(`${NEWLINE}## `), "section 11 is the page's last").toBe(false);
    const parts = ["11.0 What B24-D4 is", "11.1 The measurement", "11.2 The split: before and after", "11.3 The mechanism, and why it is insertion-only", "11.4 The OD-30 arithmetic", "11.5 Part 1: B24-D3's two CI reds", "11.6 The guards and the pins moved", "11.7 Test-first record and gates", "11.8 What stays open", "11.9 For the lead", "11.10 Citations"];
    const positions = parts.map((title) => eleven.indexOf(`${NEWLINE}### ${title}${NEWLINE}`));
    expect(positions.every((position) => position > 0), JSON.stringify(positions)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const part = (title: string): string => {
      const start = eleven.indexOf(`${NEWLINE}### ${title}${NEWLINE}`);
      const next = eleven.indexOf(`${NEWLINE}### `, start + 1);
      return eleven.slice(start, next < 0 ? undefined : next);
    };
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "PROPOSED", "UNKNOWN"]) expect(eleven, label).toContain(`**${label}**`);
    for (const fact of ["38061798204", "38049453257", minutesSeconds(CI_D3_SECONDS), minutesSeconds(CI_D3_HEADROOM_SECONDS), minutesSeconds(CI_D2_SECONDS), minutesSeconds(CI_D2_HEADROOM_SECONDS), `${CI_AGENT_EXECUTION_SECONDS} s`, `${LOCAL_AGENT_EXECUTION_SECONDS} s`, "111 s", "option A", "insertions only", `\`${SKIP_ENV}\``, "168 = 165 canonical + 3 factories + 0 raw", "48 / 37 / 9 / 28", "107 action records", "32 migrations", "`1fe719e`"]) expect(eleven, fact).toContain(fact);
    // the arithmetic: each job's expected CI time, stated INFERRED (task-D4 Part 2, 4). [B24-D4 review, 2026-10-10] security-1: the
    // figure conservative for each job - page-browser-e2e loses only the moved specs' measured CI share (the smaller) and gains the
    // orchestration step (never reached on D2's or D3's run; B24-C2's job less D2's job without the two specs D2 added); the new job
    // takes the ratio's share (the larger). [B24-D4 lead, 2026-10-10] option (b): the moved specs are four - page-browser-e2e loses
    // B24-D3's two and B24-D2's two as measured on D3's run; the new job takes the ratio's share for B24-D3's two and B24-D2's two as
    // measured (multi-tab case 2 failing, case 3 not run); each job's headroom must be at least OD-30's five minutes (was: the two-spec
    // split left page-browser-e2e under them, 25 min 39 s of 30)
    const ratio = CI_AGENT_EXECUTION_SECONDS / LOCAL_AGENT_EXECUTION_SECONDS;
    const share = LOCAL_MOVED_SECONDS * ratio;
    const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
    const measuredD3Specs = sum(CI_D3_MOVED_MEASURED);
    const measuredD2Specs = sum(CI_D3_D2_SPECS_MEASURED);
    const measured = measuredD3Specs + measuredD2Specs;
    const orchestration = CI_C2_SECONDS - (CI_D2_SECONDS - CI_D2_ADDED_SPECS_SECONDS);
    const browserEstimate = CI_D3_SECONDS - measured + orchestration;
    const jobEstimate = CI_SETUP_SECONDS + share + measuredD2Specs;
    const four = part(parts[4]);
    expect(four).toContain(`ratio ${ratio.toFixed(2)}`);
    expect(four).toContain(`= ${minutesSeconds(share)}`);
    for (const figure of [measuredD3Specs, measuredD2Specs, measured]) expect(four).toContain(`= ${minutesSeconds(figure)}`);
    expect(four).toContain(`about ${minutesSeconds(orchestration)}`);
    const verdict = "\\*\\*INFERRED\\*\\*: at least OD-30's five minutes";
    expect(four).toMatch(new RegExp(`page-browser-e2e: ${minutesSeconds(CI_D3_SECONDS)} - ${minutesSeconds(measured)} \\+ ${minutesSeconds(orchestration)} = ${minutesSeconds(browserEstimate)} of 30, a headroom of ${minutesSeconds(30 * 60 - browserEstimate)}, ${verdict}`));
    expect(four).toMatch(new RegExp(`${JOB}: ${CI_SETUP_SECONDS} s of setup \\+ ${minutesSeconds(share)} \\+ ${minutesSeconds(measuredD2Specs)} = ${minutesSeconds(jobEstimate)} of 20, a headroom of ${minutesSeconds(20 * 60 - jobEstimate)}, ${verdict}`));
    for (const [job, limit, estimate] of [["page-browser-e2e", 30, browserEstimate], [JOB, 20, jobEstimate]] as const) expect(limit * 60 - estimate, `${job}: on these figures OD-30's five minutes hold`).toBeGreaterThanOrEqual(OD30_HEADROOM_SECONDS);
    expect(eleven, "the decision is taken").not.toMatch(/the lead decides before commit|the lead's decision before commit/);
    // no record promises the first draft's anti-conservative figure (page-browser-e2e less the ratio's share)
    expect(eleven).not.toContain(minutesSeconds(CI_D3_SECONDS - share));
    expect(eleven).not.toContain(minutesSeconds(30 * 60 - Math.round(CI_D3_SECONDS - share)));
    expect(eleven).not.toMatch(new RegExp(`${JOB}[^\\n]*\\b\\d+ min \\d+ s\\b[^\\n]*\\*\\*CONFIRMED\\*\\*`));
    expect(eleven).not.toMatch(new RegExp(`\\*\\*CONFIRMED\\*\\*[^\\n]*${JOB}[^\\n]*\\b\\d+ min \\d+ s\\b`));
    // this suite's row with its real it( count
    const rows = [...part(parts[7]).matchAll(/^\| `(app\/[^`]+\.test\.tsx?)` \| (\d+) \|/gm)];
    expect(rows.map((row) => row[1])).toContain(SELF);
    for (const row of rows) expect((read(row[1]!).match(/^\s*it\(/gm) ?? []).length, `${row[1]} it( blocks`).toBe(Number(row[2]));
    // every citation stands on the line it names
    const citations = [...part(parts[10]).matchAll(/^\| (D4-C\d+) \| `([^`]+)` \| (\d+) \| `(.+)` \|$/gm)];
    expect(citations.length).toBeGreaterThanOrEqual(10);
    expect(citations.map((row) => row[1])).toEqual(citations.map((_, index) => `D4-C${index + 1}`));
    expect(citations.filter((row) => !(lines(row[2]!)[Number(row[3]) - 1] ?? "").includes(row[4]!.replaceAll("\\|", "|"))).map((row) => `${row[1]} ${row[2]}:${row[3]}`)).toEqual([]);
    // the records for the lead (the lead's rules: one dated line per amendment, the headings exactly)
    const lead = part(parts[9]);
    for (const heading of ["### OD-30 amendment", "### The discovery section 10 line", "### The README row", `### B24-D4 - the OD-30 split of page-browser-e2e (${DATE} local; increment workflow + lead; this commit)`]) expect(lead.includes(heading) || eleven.includes(heading), heading).toBe(true);
    expect(eleven).toMatch(new RegExp(`^- \\[B24-D4, ${DATE}\\] B24-D4 landed `, "m"));
    expect(eleven).toMatch(/^\| B24-D4 /m);
    expect(eleven).toMatch(new RegExp(`^- \\[B24-D4, ${DATE}\\] D24-30: `, "m"));
    expect(eleven).toMatch(new RegExp(`^- \\[B24-D4, ${DATE}\\] D24-32: `, "m"));
    expect(eleven).toMatch(new RegExp(`^- \\[B24-D4, ${DATE}\\] OD-30: [^\\n]*option A`, "m"));
    // [B24-D4 review, 2026-10-10] security-1: the OD-30 amendment, the README row and the ledger carry the estimate with its caveat.
    // [B24-D4 lead, 2026-10-10] and the discovery section 10 line: each says the lead chose option (b) and the job's name, names the
    // four specs, gives both expected figures with OD-30's five minutes held, INFERRED, and no record says the lead decides before commit
    const records: ReadonlyArray<readonly [string, RegExp]> = [
      ["the OD-30 amendment", new RegExp(`^- \\[B24-D4, ${DATE}\\] OD-30: [^\\n]*`, "m")],
      ["the discovery section 10 line", new RegExp(`^- \\[B24-D4, ${DATE}\\] B24-D4 landed [^\\n]*`, "m")],
      ["the README row", /^\| B24-D4 [^\n]*/m],
      ["the ledger paragraph", /^Test-first on `chapter\/b24-production-qualification` from `1fe719e`[^\n]*/m],
    ];
    for (const [name, pattern] of records) {
      const record = pattern.exec(eleven)?.[0] ?? "";
      for (const fact of [`${minutesSeconds(browserEstimate)} of 30`, `${minutesSeconds(jobEstimate)} of 20`, "at least OD-30's five minutes", "INFERRED", "option (b)", "2026-10-10", `\`${JOB}\``, ...MOVED_SPECS.map((spec) => spec.slice("e2e/".length, -".spec.ts".length))]) expect(record, `${name}: ${fact}`).toContain(fact);
      expect(record, name).not.toMatch(/decides before commit|decision before commit/);
    }
  });

  it("8. [B24-D4 review] the other pages D4 edits: edge-security.md section 5's census paragraph reads whole, and the present-tense citations of the OD-30 steps after D4's env mapping carry a dated D4 note naming the lines that hold them now; [B24-D4 lead, 2026-10-10] the draft job name is gone from the code and noted wherever a page keeps it, and D2's page names the new job for B24-D2's two specs", () => {
    // edge-security.md section 5: the paragraph under the class table, "<n> rows. ..." on its first line (b24-a2-env-names 9 reads the
    // total there), D4's note before the SIRKIT_AUTH_MODE sentence, which reads whole once the paragraph's lines are joined
    const edge = lines("artifacts/ai-control-plane-b24/edge-security.md");
    const first = edge.findIndex((line) => /^\d+ rows\. /.test(line));
    expect(first).toBeGreaterThan(0);
    const paragraph = edge.slice(first, edge.indexOf("", first)).join(" ");
    expect(paragraph).toContain("`SIRKIT_AUTH_MODE` is `configuration`, declared: it is honoured only outside production (`mode.ts:36-41`) but it is a deployment knob, never a fixture.");
    expect(edge[first]).toContain(`[B24-D4, ${DATE}] 97 -> 98: + \`${SKIP_ENV}\` (\`platform\`, the row above). `); expect(edge[first].indexOf(`[B24-D4, ${DATE}] 97 -> 98: `)).toBeLessThan(edge[first].indexOf("`SIRKIT_AUTH_MODE` is")); // [B24-E, 2026-10-10] reviewed pin move: D4's note is held to its own text and to standing before the SIRKIT_AUTH_MODE sentence (was: directly before it); B24-E's "98 -> 99" note now stands between them, the last move on the line, where b24-a2-env-names 9 reads the total
    // the OD-30 steps' lines, read off the workflow
    const workflow = lines(WORKFLOW);
    const lineOf = (needle: string): number => {
      const found = workflow.flatMap((line, index) => (line.includes(needle) ? [index + 1] : []));
      expect(found, needle).toHaveLength(1);
      return found[0]!;
    };
    const browserStart = lineOf("# [B24-D1] OD-30: page-browser-e2e's start");
    const browserHeadroom = lineOf("# [B24-D1] OD-30: page-browser-e2e's headroom");
    const boundaryStart = lineOf("# [B24-D1] OD-30: agent-boundary-suites's start");
    const boundaryHeadroom = lineOf("# [B24-D1] OD-30: agent-boundary-suites's headroom");
    const boundaryKey = lineOf("  agent-boundary-suites:");
    // the job's block: its blank line and three [B24-D0] comment lines above its key, through its headroom step's run line
    const boundaryFirst = boundaryKey - 4;
    expect(workflow[boundaryFirst - 1]).toBe("");
    expect(workflow.slice(boundaryFirst, boundaryKey - 1).every((line) => line.startsWith("  # "))).toBe(true);
    expect(workflow[boundaryHeadroom]).toContain("ci-job-headroom.ts");
    expect(workflow[browserHeadroom]).toContain("ci-job-headroom.ts");
    const reliability = lines("artifacts/ai-control-plane-b24/performance-and-reliability.md");
    const prG = insertionRows().filter((row) => row.task === "PR-G"); const prL7 = insertionRows().filter((row) => row.task === "PR-L7"); const out = (rows: ReturnType<typeof insertionRows>) => (line: number): number => [...rows].reverse().reduce((at, row) => (at >= row.first + row.count ? at - row.count : at), line); const atPrG = out(prL7); const atD4 = (line: number): number => out(prG)(atPrG(line)); const nowOf = (line: number): number => [...prG, ...prL7].reduce((at, row) => (at >= row.first ? at + row.count : at), line); const now = `[B24-D4, ${DATE}] now \`:${atD4(browserStart)}\` and \`:${atD4(browserHeadroom)}-${atD4(browserHeadroom) + 1}\`, \`:${atD4(boundaryStart)}\` and \`:${atD4(boundaryHeadroom)}-${atD4(boundaryHeadroom) + 1}\``; const nowPrG = `[PR-G, 2026-10-17] now \`:${atPrG(browserStart)}\` and \`:${atPrG(browserHeadroom)}-${atPrG(browserHeadroom) + 1}\`, \`:${atPrG(boundaryStart)}\` and \`:${atPrG(boundaryHeadroom)}-${atPrG(boundaryHeadroom) + 1}\``; const nowPrL7 = `[PR-L7, 2026-10-20] now \`:${browserStart}\` and \`:${browserHeadroom}-${browserHeadroom + 1}\`, \`:${boundaryStart}\` and \`:${boundaryHeadroom}-${boundaryHeadroom + 1}\``; expect(nowOf(atD4(boundaryStart))).toBe(boundaryStart); /* [PR-L7, 2026-10-20] reviewed pin move (OD-254): D4's note at D4's tree and the PR-G note at PR-G's tree (the later rows taken out), and a PR-L7 note names the lines that hold them now */ // [PR-G, 2026-10-17] reviewed pin move (OD-250): D4's note names the lines at D4's tree (PR-G's rows taken out), and a PR-G note names the lines that hold them now
    const steps = reliability.filter((line) => line.includes("`page-browser-e2e`'s at `:405` and `:432-433`, `agent-boundary-suites`'s at `:565` and `:624-625`"));
    expect(steps).toHaveLength(1);
    expect(steps[0]).toContain(now); expect(steps[0]).toContain(nowPrG); expect(steps[0]).toContain(nowPrL7); // [PR-G, 2026-10-17] + the PR-G note; [PR-L7, 2026-10-20] + the PR-L7 note
    const block = `[B24-D4, ${DATE}] now \`:${atD4(boundaryFirst)}-${atD4(boundaryHeadroom) + 1}\``; const blockPrG = `[PR-G, 2026-10-17] now \`:${atPrG(boundaryFirst)}-${atPrG(boundaryHeadroom) + 1}\`, its start step at \`:${atPrG(boundaryStart)}\`, its headroom step at \`:${atPrG(boundaryHeadroom)}-${atPrG(boundaryHeadroom) + 1}\``; const blockPrL7 = `[PR-L7, 2026-10-20] now \`:${boundaryFirst}-${boundaryHeadroom + 1}\`, its start step at \`:${boundaryStart}\`, its headroom step at \`:${boundaryHeadroom}-${boundaryHeadroom + 1}\``; /* [PR-L7, 2026-10-20] PR-G's lines at PR-G's tree; the PR-L7 note the lines now */ // [PR-G, 2026-10-17] reviewed pin move (OD-250): as `now`
    const readme = reliability.filter((line) => line.includes("`:557-625` (`agent-boundary-suites`, with D1's start step at `:565`"));
    expect(readme).toHaveLength(1);
    expect(readme[0]).toContain(`${block}, its start step at \`:${atD4(boundaryStart)}\`, its headroom step at \`:${atD4(boundaryHeadroom)}-${atD4(boundaryHeadroom) + 1}\``); expect(readme[0]).toContain(blockPrG); expect(readme[0]).toContain(blockPrL7); // [PR-G, 2026-10-17] D4's lines at D4's tree, then the PR-G note; [PR-L7, 2026-10-20] then the PR-L7 note
    const d0 = lines(PAGE).filter((line) => line.includes("[B24-D1, 2026-10-09] the block is `:557-625`"));
    expect(d0).toHaveLength(1);
    expect(d0[0]).toContain(`${block}, its start step at \`:${atD4(boundaryStart)}\`, its headroom step at \`:${atD4(boundaryHeadroom)}-${atD4(boundaryHeadroom) + 1}\``); expect(d0[0]).toContain(blockPrG); expect(d0[0]).toContain(blockPrL7); // [PR-G, 2026-10-17] D4's lines at D4's tree, then the PR-G note; [PR-L7, 2026-10-20] then the PR-L7 note
    // [B24-D4 lead, 2026-10-10] the rename: the draft name (assembled, so this file never holds it) is gone from every file D4 edits
    // but its pages, where each line that still names it carries the lead's dated note
    const draft = ["page-browser-e2e", "accessibility"].join("-");
    const code: string[] = [WORKFLOW, CONFIG, ORCHESTRATION_CONFIG, "artifacts/ai-control-plane-b24/threshold-census.csv"];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        const path = `${dir}/${entry}`;
        if (statSync(join(ROOT, path)).isDirectory()) walk(path);
        else if (/\.(?:ts|tsx|mjs)$/.test(entry)) code.push(path);
      }
    };
    for (const dir of ["app/lib/qualification", "app/lib/agent/orchestration/__tests__", "app/lib/deployment", "app/lib/evaluation", "scripts", "e2e", "e2e-orchestration"]) walk(dir);
    expect(code.length).toBeGreaterThan(60);
    expect(code.filter((path) => read(path).includes(draft))).toEqual([]);
    const pages = [PAGE, "artifacts/ai-control-plane-b24/accessibility.md", "artifacts/ai-control-plane-b24/edge-security.md", ENV_PAGE, "artifacts/ai-control-plane-b24/performance-and-reliability.md", "artifacts/ai-control-plane-b21/evaluation-matrix.md"];
    const lead = `[B24-D4 lead, ${DATE}]`;
    expect(pages.flatMap((path) => lines(path).flatMap((line, index) => (line.includes(draft) && !line.includes(lead) ? [`${path}:${index + 1}`] : [])))).toEqual([]);
    expect(lines(PAGE).some((line) => line.includes(lead) && line.includes(draft) && line.includes(`\`${JOB}\``) && line.includes("renamed")), "ci-split.md records the rename").toBe(true);
    // D2's page: where it named page-browser-e2e as the CI job that runs B24-D2's two specs, the new job is named with the lead's note
    const bullet = (text: string): string => {
      const at = reliability.findIndex((line) => line.includes(text));
      expect(at, text).toBeGreaterThan(0);
      let end = at + 1;
      while (end < reliability.length && /^ {2}\S/.test(reliability[end]!)) end += 1;
      return reliability.slice(at, end).join(" ");
    };
    for (const text of ["- The two browser specs' outcomes and durations, and the CI durations of page-browser-e2e and prompt-to-gerber with them", "- Run both Playwright configurations with the two new specs;", "The spec is unchanged; the browser proof is the lead's CI run"]) {
      const said = bullet(text);
      expect(said, text).toContain(lead);
      expect(said, text).toContain(`\`${JOB}\``);
    }
  });
});

/** A1's insertion table (environments-and-deployment.md section 10, its last table): task, date, job, first line, count. */
function insertionRows(): Array<{ task: string; date: string; job: string; first: number; count: number }> {
  const page = read(ENV_PAGE);
  const start = page.indexOf(`${NEWLINE}## 10. The workflow shift (old -> new)${NEWLINE}`);
  const ten = page.slice(start, page.indexOf(`${NEWLINE}## `, start + 1)).split(NEWLINE);
  const header = ten.indexOf("| task | job | first line | count |");
  const rows: Array<{ task: string; date: string; job: string; first: number; count: number }> = [];
  for (let index = header + 2; index < ten.length && ten[index]!.startsWith("|"); index += 1) {
    const row = /^\| \[(B24-[A-F]\d*[a-z]?|PR-[A-G]|PR-L7), (\d{4}-\d{2}-\d{2})\] \| ([a-z][a-z0-9-]*) \| `:(\d+)` \| ([1-9]\d*) \|$/.exec(ten[index]!); // [PR-G, 2026-10-17] reviewed pin move: + PR-[A-G] (OD-250), as b24-a1-environment-profile's; [PR-L7, 2026-10-20] reviewed pin move: + PR-L7 (OD-254: PR-L7's five rows - the 69 admitted prompt-to-gerber entries at `:313`, the two moved ones' excludes at `:440`, the 13 admitted database-delivery entries at `:495`, the two moved suites in agent-boundary-suites at `:761`, the appended page-browser-e2e-agent job at `:809`)
    if (row) rows.push({ task: row[1]!, date: row[2]!, job: row[3]!, first: Number(row[4]), count: Number(row[5]) });
  }
  return rows;
}
