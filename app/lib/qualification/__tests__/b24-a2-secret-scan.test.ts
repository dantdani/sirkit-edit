/**
 * [B24-A2] The secret scan, in CI (D24-4, OD-195, runbook :168).
 *
 * `runSecretScan({ entries, allowlist })` (`app/lib/deployment/secret-scan.ts`) is pure: it takes `{ path, text }` entries and
 * returns `lines` of the form `path:line rule` - never the matched text - an exit code (1 on any hit the allowlist does not hold)
 * and the binary and oversized entries it skipped, counted. Its rules are closed and pinned: PEM private-key markers (the `PRIVATE
 * KEY` and `PRIVATE KEY BLOCK` forms), the provider key shapes the B19 source registry and the B20 MCP server registry already refuse
 * (restated, not imported) and a Supabase secret-key shape. No rule matches its own statement. The allowlist holds exact paths, a
 * rule, the sha256 of the line and a reason; globs and directories are refused; a stale entry and a changed line fail (the stale
 * check in tree mode only). `scripts/scan-secrets.ts` is a thin shell: it lists files (tree mode, `--staged`, `--history <range>`)
 * through read-only git calls and prints the lines. The CI job `secret-scan` follows production-smoke; [B24-D0, 2026-10-09] it was the workflow's last job until B24-D0 appended `agent-boundary-suites` after it (OD-30's split).
 *
 * A marker planted in a temporary directory would never reach a scan that enumerates `git ls-files`, so these cases drive the pure
 * function with injected entries, every marker and key-shaped fake assembled at run time (the `b21-e3-resume-record.test.ts:223`
 * precedent); git is an injected fake. Failing first on 1b2c08c: the module, the script and the job do not exist (page section 8).
 * Nothing is written to disk and no process is started. [B24-A2F, 2026-10-09] The history-only allowlist entries are the last describe block (one line here: ci-split.md cites case (c) at :183 and :187).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SECRET_SCAN_MAX_BYTES,
  SECRET_SCAN_RULES,
  allowlistProblems,
  collectSecretScanEntries,
  lineDigest,
  parseDiffTree,
  parseRevList,
  parseSecretScanArguments,
  runSecretScan,
  runSecretScanCommand,
  type SecretScanAllowlistEntry,
  type SecretScanIo,
} from "@/app/lib/deployment/secret-scan";
import { SECRET_SCAN_ALLOWLIST } from "@/app/lib/deployment/secret-scan-allowlist";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NUL = String.fromCharCode(0);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const WORKFLOW = ".github/workflows/deterministic-manufacturing.yml";
const PAGE = "artifacts/ai-control-plane-b24/edge-security.md";

/** Run-time assembled samples, one per rule: no line of this file matches any rule. */
const DASHES = "-".repeat(5);
const SAMPLES: Readonly<Record<string, string>> = {
  "pem-private-key": [DASHES, "BEGIN RSA PRIV", "ATE KEY", DASHES].join(""),
  "pem-private-key-block": [DASHES, "BEGIN PGP PRIV", "ATE KEY BLOCK", DASHES].join(""),
  "anthropic-key-shape": ["sk", "ant", ["b24a2", "x".repeat(24)].join("")].join("-"),
  "openai-key-shape": ["sk", "B24A2".repeat(7)].join("-"),
  "github-token-shape": ["gh", "p_", "b".repeat(36)].join(""),
  "aws-access-key-id-shape": ["AK", "IA", "B24A2".repeat(3), "Q"].join(""),
  "huggingface-token-shape": ["hf", "_", "c".repeat(30)].join(""),
  "jwt-shape": ["ey", "J", "a".repeat(20), ".", "b".repeat(20)].join(""),
  "supabase-secret-key-shape": ["sb", "_secret_", "d".repeat(20)].join(""),
};
const ruleOf = (sample: string): string => (sample.startsWith("pem-private-key") ? "pem-private-key" : sample);

/** A fake git: canned answers by argument list, every call recorded. */
function fakeGit(answers: Record<string, string | Uint8Array>, files: Record<string, string> = {}): SecretScanIo & { calls: string[][]; reads: string[] } {
  const calls: string[][] = [];
  const reads: string[] = [];
  const encoder = new TextEncoder();
  return {
    calls,
    reads,
    git: (args, input) => {
      calls.push([...args]);
      const key = args.join(" ");
      if (args[0] === "cat-file" && args[1] === "--batch") {
        const oids = String(input ?? "").split(NEWLINE).filter(Boolean);
        reads.push(...oids);
        const parts: Uint8Array[] = [];
        for (const oid of oids) {
          const body = encoder.encode(String(answers[`blob ${oid}`] ?? ""));
          parts.push(encoder.encode(`${oid} blob ${body.byteLength}${NEWLINE}`), body, encoder.encode(NEWLINE));
        }
        const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
        const out = new Uint8Array(total);
        let at = 0;
        for (const part of parts) { out.set(part, at); at += part.byteLength; }
        return out;
      }
      if (args[0] === "cat-file" && args[1] === "--batch-check") {
        const oids = String(input ?? "").split(NEWLINE).filter(Boolean);
        return encoder.encode(oids.map((oid) => `${oid} blob ${encoder.encode(String(answers[`blob ${oid}`] ?? "")).byteLength}`).join(NEWLINE) + NEWLINE);
      }
      const answer = answers[key];
      if (answer === undefined) throw new Error(`fake git: no answer for ${key}`);
      return typeof answer === "string" ? encoder.encode(answer) : answer;
    },
    readFile: (path) => (path in files ? encoder.encode(files[path]!) : null),
  };
}
const oid = (seed: string): string => seed.repeat(40).slice(0, 40);
const z = (...tokens: string[]): string => tokens.map((token) => `${token}${NUL}`).join("");
const record = (status: string, blob: string, path: string, mode = "100644"): string[] => [`:${status === "A" ? "000000" : "100644"} ${mode} ${status === "A" ? "0".repeat(40) : oid("e")} ${blob} ${status}`, path];

describe("[B24-A2] the scanner (D24-4, OD-195)", () => {
  it("(a) counterexample (red on 1b2c08c, where no scan existed): a PEM marker and a key-shaped fake, assembled at run time in injected entries, give exit 1 and lines exactly `path:line rule`, the matched text absent from every output; each rule's sample hits its rule", () => {
    const entries = [
      { path: "app/planted/marker.ts", text: ["// a planted file", `const pem = "${SAMPLES["pem-private-key"]}";`, "export {};"].join(NEWLINE) },
      { path: "app/planted/key.ts", text: ["export const a = 1;", "", `const key = "${SAMPLES["anthropic-key-shape"]}";`].join(NEWLINE) },
    ];
    const result = runSecretScan({ entries, allowlist: [] });
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["app/planted/marker.ts:2 pem-private-key", "app/planted/key.ts:3 anthropic-key-shape"]);
    const output = JSON.stringify(result);
    for (const sample of Object.values(SAMPLES)) expect(output).not.toContain(sample);
    expect(result.skipped).toEqual({ oversized: 0, missing: 0 }); // [B24-A2 review, 2026-10-06] security-1: no binary count (a NUL byte skips nothing), + missing
    // every sample hits its own rule
    for (const [name, sample] of Object.entries(SAMPLES)) {
      const hit = runSecretScan({ entries: [{ path: "x.ts", text: sample }], allowlist: [], mode: "staged" });
      expect(hit.lines, name).toContain(`x.ts:1 ${ruleOf(name)}`);
    }
    // the closed, pinned rules ([B24-A2 review, 2026-10-06] security-2, reviewed pin move: OpenAI's and GitHub's current forms added to
    // their rules, + connection-string-password; case (h) holds each new form's hit and miss)
    expect(SECRET_SCAN_RULES.map((rule) => rule.id)).toEqual(["pem-private-key", "anthropic-key-shape", "openai-key-shape", "github-token-shape", "aws-access-key-id-shape", "huggingface-token-shape", "jwt-shape", "supabase-secret-key-shape", "connection-string-password"]);
    expect(SECRET_SCAN_RULES.map((rule) => rule.pattern.source)).toEqual([
      "-{5}BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-{5}",
      "sk-ant-[A-Za-z0-9_-]{20,}",
      "sk-[A-Za-z0-9]{32,}|\\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}",
      "gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}",
      "AKIA[0-9A-Z]{16}",
      "hf_[A-Za-z0-9]{30,}",
      "eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}",
      "sb_secret_[A-Za-z0-9_-]{20,}",
      "[A-Z][A-Z0-9_]*_URL\\s*[=:]\\s*[\"'`]?(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\\+srv)?|rediss?|amqps?):\\/\\/[^\\s:/@]+:(?!<)[^\\s@/]{6,}@|postgres(?:ql)?:\\/\\/[^\\s:/@]+:(?!<)[^\\s@/]{6,}@[A-Za-z0-9.-]*\\.supabase\\.(?:co|com)\\b",
    ]);
    for (const rule of SECRET_SCAN_RULES) expect(rule.pattern.flags, rule.id).toBe("");
    // a bare prefix is no hit (only a prefix followed by at least 20 key characters is)
    expect(runSecretScan({ entries: [{ path: "x.ts", text: ["sb", "_secret_", "short"].join("") }], allowlist: [], mode: "staged" }).lines).toEqual([]);
  });

  // [B24-A2 review, 2026-10-06] security-1, reviewed pin move: a NUL byte no longer skips an entry - the binary-looking entry below is
  // scanned and its key reported (it was skipped and counted binary); entries over the size bound are still skipped and counted
  it("(a2) entries over the size bound are skipped and counted, never scanned; an entry holding a NUL byte is scanned (no binary skip); a CRLF line hits as its text", () => {
    const binary = { path: "public/x.png", text: `PNG${NUL}${SAMPLES["github-token-shape"]}` };
    const oversized = { path: "data/big.json", text: SAMPLES["jwt-shape"], bytes: SECRET_SCAN_MAX_BYTES + 1 };
    const crlf = { path: "docs/a.md", text: ["one", SAMPLES["huggingface-token-shape"], "three"].join(`${CR}${NEWLINE}`) };
    const result = runSecretScan({ entries: [binary, oversized, crlf], allowlist: [], mode: "staged" });
    expect(result.skipped).toEqual({ oversized: 1, missing: 0 });
    expect(result.lines).toEqual(["public/x.png:1 github-token-shape", "docs/a.md:2 huggingface-token-shape"]);
    expect(SECRET_SCAN_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(lineDigest(`${SAMPLES["huggingface-token-shape"]}`)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("(b) an allowlisted hit exits 0; a stale entry, a changed line, a glob and a directory entry each exit 1 or are refused", () => {
    const line = `const fake = "${SAMPLES["aws-access-key-id-shape"]}";`;
    const entries = [{ path: "app/x/__tests__/a.test.ts", text: ["// sentinel", line].join(NEWLINE) }];
    const entry: SecretScanAllowlistEntry = { path: "app/x/__tests__/a.test.ts", rule: "aws-access-key-id-shape", sha256: lineDigest(line), reason: "a key-shaped fake that the redaction test feeds its classifier" };
    expect(runSecretScan({ entries, allowlist: [entry] })).toMatchObject({ exitCode: 0, lines: [], allowlisted: 1 });
    // stale: the entry's line no longer hits (tree mode)
    const stale = runSecretScan({ entries: [{ path: entry.path, text: "// the sentinel is gone" }], allowlist: [entry] });
    expect(stale.exitCode).toBe(1);
    expect(stale.lines.join(" ")).toMatch(/stale/);
    // a changed line: a hit on the same path and rule with another text is not allowlisted, and the entry is stale
    const changed = runSecretScan({ entries: [{ path: entry.path, text: `${line} // edited` }], allowlist: [entry] });
    expect(changed.exitCode).toBe(1);
    expect(changed.lines).toContain(`${entry.path}:1 aws-access-key-id-shape`);
    // globs and directories are refused before any line is judged
    for (const path of ["app/**/a.test.ts", "app/x/__tests__/*.test.ts", "app/x/__tests__/", "app/x/__tests__/a.test.ts/", "/app/x/__tests__/a.test.ts", "app/x/../x/__tests__/a.test.ts", "app\\x\\a.test.ts", "app/x/__tests__/a.test.[tj]s", "app/{x,y}/a.test.ts"]) {
      const refused = runSecretScan({ entries, allowlist: [{ ...entry, path }] });
      expect(refused.exitCode, path).toBe(1);
      expect(allowlistProblems([{ ...entry, path }]).length, path).toBeGreaterThan(0);
    }
    // a directory spelled without a slash is no file of the tree: refused in tree mode
    const directory = runSecretScan({ entries, allowlist: [entry, { ...entry, path: "app/x/__tests__" }] });
    expect(directory.exitCode).toBe(1);
    expect(directory.lines.join(" ")).toMatch(/app\/x\/__tests__ /);
    // a malformed digest, an unknown rule and a short reason are refused; a duplicate entry too
    expect(allowlistProblems([{ ...entry, sha256: "abc" }])).not.toEqual([]);
    expect(allowlistProblems([{ ...entry, rule: "any-rule" as never }])).not.toEqual([]);
    expect(allowlistProblems([{ ...entry, reason: "fake" }])).not.toEqual([]);
    expect(allowlistProblems([entry, entry])).not.toEqual([]);
    expect(allowlistProblems([entry])).toEqual([]);
    // the stale check is tree mode's only: a staged or history run sees part of the tree
    expect(runSecretScan({ entries: [], allowlist: [entry], mode: "staged" }).exitCode).toBe(0);
    expect(runSecretScan({ entries: [], allowlist: [entry], mode: "history" }).exitCode).toBe(0);
  });

  it("(c) the CI job: secret-scan follows production-smoke and precedes the appended agent-boundary-suites ([B24-D0, 2026-10-09] was: the workflow's last job is secret-scan), declares no permissions (it inherits contents: read), checks out, sets up pnpm and node 24, installs, then runs pnpm exec tsx scripts/scan-secrets.ts; the file has exactly four lines containing `playwright test` ([PR-L7, 2026-10-20] was three: + page-browser-e2e-agent's, OD-254; [B24-D4, 2026-10-10] was two: + page-browser-e2e-b24's, OD-30's split; b21-f-page.test.ts:259-267)", () => { // [B24-D0, 2026-10-09] reviewed pin move: secret-scan follows production-smoke and precedes B24-D0's appended agent-boundary-suites (OD-30's split); the job is found by content and read to the next header; [B24-D0 review, 2026-10-09] correctness-5: the title retitled in place to what the body pins
    const all = read(WORKFLOW).split(NEWLINE);
    const jobsAt = all.indexOf("jobs:");
    const headers = all.flatMap((line, index) => (index > jobsAt && /^ {2}[a-z][a-z0-9-]*:$/.test(line) ? [index] : []));
    const last = all.indexOf("  secret-scan:");
    expect(headers).toContain(last);
    expect(headers.map((index) => all[index]!.trim())).toEqual(["prompt-to-gerber:", "database-delivery:", "page-browser-e2e:", "production-smoke:", "secret-scan:", "agent-boundary-suites:", "page-browser-e2e-b24:", "page-browser-e2e-agent:"]); // [PR-L7, 2026-10-20] reviewed pin move: + the browser job PR-L7 appended after page-browser-e2e-b24 (OD-254); [B24-D4, 2026-10-10] reviewed pin move: + the browser job B24-D4 appended after agent-boundary-suites (OD-30's split of page-browser-e2e)
    expect(headers[headers.indexOf(last) - 1]).toBe(all.indexOf("  production-smoke:"));
    const job = all.slice(last, headers[headers.indexOf(last) + 1]).join(NEWLINE);
    expect(job).not.toMatch(/permissions:/);
    expect(job).toMatch(/^ {4}runs-on: ubuntu-latest$/m);
    const steps = job.split(NEWLINE).filter((line) => /^ {6}- /.test(line)).map((line) => line.trim());
    // [B24-A2 review, 2026-10-06] security-3, reviewed pin move: + the pull request's history step after the tree scan (case (k))
    expect(steps).toEqual(["- uses: actions/checkout@v4", "- uses: pnpm/action-setup@v4", "- uses: actions/setup-node@v4", "- run: pnpm install --frozen-lockfile", "- run: pnpm exec tsx scripts/scan-secrets.ts", "- name: Scan every commit of the pull request (a secret added, then deleted, stays in the history a merge keeps)"]);
    expect(job).toMatch(/^ {10}node-version: 24$/m);
    expect(job).not.toMatch(/\$\{\{[^}]*\bsecrets\./);
    expect(read(WORKFLOW).match(/^permissions:$/gm)).toHaveLength(1);
    expect(all.filter((line) => line.includes("playwright test"))).toHaveLength(4); // [PR-L7, 2026-10-20] reviewed pin move: 3 -> 4, page-browser-e2e-agent's run line (OD-254); [B24-D4, 2026-10-10] reviewed pin move: 2 -> 3, page-browser-e2e-b24's run line (the four moved specs, [B24-D4 lead, 2026-10-10] option (b); OD-30's split)
  });

  it("(d) scanning the scanner, its allowlist, the script, this suite and the page gives zero hits with no allowlist entry; the allowlist is exactly the six sentinel lines of the task's Lead note 2 and, since the review round, the two connection-string fakes, each holding in the tree; [B24-A2F, 2026-10-09] and a ninth, history-only entry for the fake B24-C3 committed and the lead's fix rewrote, which holds in history only (cases l-q)", () => {
    const own = ["app/lib/deployment/secret-scan.ts", "app/lib/deployment/secret-scan-allowlist.ts", "scripts/scan-secrets.ts", "app/lib/qualification/__tests__/b24-a2-secret-scan.test.ts", PAGE];
    const clean = runSecretScan({ entries: own.map((path) => ({ path, text: read(path) })), allowlist: [], mode: "staged" });
    expect(clean).toMatchObject({ exitCode: 0, lines: [] });
    // [B24-A2 review, 2026-10-06] security-2, reviewed pin move: six -> eight - the two test fakes the connection-string rule hits, each
    // read in its test first (a named SENTINEL password; a fixture for a project named deadtenant)
    expect(SECRET_SCAN_ALLOWLIST.map((entry) => `${entry.path} ${entry.rule}`)).toEqual([
      "app/lib/mcp/server/__tests__/b20-c3-descriptor-text-gate.test.ts pem-private-key",
      "app/lib/agent/__tests__/b11-1-trace-integrity.test.ts anthropic-key-shape",
      "app/lib/agent/__tests__/b11-1-trace-integrity.test.ts anthropic-key-shape",
      "app/lib/agent/__tests__/b11-1-trace-integrity.test.ts anthropic-key-shape",
      "app/lib/agent/__tests__/b11-1-trace-integrity.test.ts aws-access-key-id-shape",
      "app/lib/agent/__tests__/b11-trace-replay-evaluation.test.ts anthropic-key-shape",
      "app/api/__tests__/b16-0-12-tranche-parity.test.ts connection-string-password",
      "app/lib/db/__tests__/b16-b-database-qualification.test.ts connection-string-password",
      "app/lib/engineering/__tests__/pr-d-catalog-inspect.test.ts anthropic-key-shape", // [PR-G lead, 2026-10-17] reviewed pin move, nine -> twelve: the three redaction cases PR-D/PR-F added (a key-shaped alphabet placeholder inside a thrown error message, asserted never to leak into the refusal diagnostics), each read in its test first
      "app/lib/engineering/__tests__/pr-d-generate-proposal.test.ts anthropic-key-shape",
      "app/lib/parts/__tests__/pr-f-missing-facts-read.test.ts anthropic-key-shape",
      "app/lib/qualification/__tests__/b24-c3-trace-read.test.ts connection-string-password", // [B24-A2F, 2026-10-09] reviewed pin move, eight -> nine: the history-only entry for the fake B24-C3 committed at ba4f562:75 and the lead's fix rewrote (aaa6a1b)
    "app/lib/engineering/__tests__/pr-d-generate-proposal.test.ts anthropic-key-shape", "app/lib/schematic/__tests__/l6-plan-assumptions.test.ts openai-key-shape", ]); /* [PR-L6 integration, 2026-10-19] reviewed pin move, thirteen -> fourteen: a third history-only entry, LAST - the l6-plan-assumptions literal as committed at 2240363a, rewritten at 9a42c36b (on the closing line: line-neutral) */ // [PR-L, 2026-10-18] reviewed pin move, twelve -> thirteen: a second history-only entry, LAST - PR-D's v1 line of the generate-proposal redaction case (committed at e5817558), rewritten by runbook L.5 for the 2.0.0 port; the tree entry above now holds the rewritten line (on the closing line: line-neutral)
    expect(allowlistProblems(SECRET_SCAN_ALLOWLIST)).toEqual([]);
    for (const entry of SECRET_SCAN_ALLOWLIST) expect(entry.reason.length, entry.path).toBeGreaterThan(40);
    // over the files the allowlist names, tree mode passes: every ordinary entry holds its line, nothing else hits ([B24-A2F, 2026-10-09]
    // the ninth, history-only, is neither used nor stale, so the count stays 8)
    const files = [...new Set(SECRET_SCAN_ALLOWLIST.map((entry) => entry.path))];
    const named = runSecretScan({ entries: files.map((path) => ({ path, text: read(path) })), allowlist: SECRET_SCAN_ALLOWLIST });
    expect(named).toMatchObject({ exitCode: 0, lines: [], allowlisted: 11 /* [PR-G lead, 2026-10-17] 8 -> 11: the three PR-D/PR-F redaction cases */ });
    // without the allowlist those files hit eight times, and the lines (never the text) say where
    const bare = runSecretScan({ entries: files.map((path) => ({ path, text: read(path) })), allowlist: [], mode: "staged" });
    expect(bare.lines).toHaveLength(11) /* [PR-G lead, 2026-10-17] 8 -> 11: the three PR-D/PR-F redaction cases */;
    for (const line of bare.lines) expect(line).toMatch(/^app\/[a-z0-9/_.-]+\/__tests__\/[a-z0-9_.-]+\.test\.ts:\d+ [a-z-]+$/); // [B24-A2 review, 2026-10-06] app/lib/ -> app/: one fake is under app/api/__tests__
  });
});

describe("[B24-A2] the script's modes (D5)", () => {
  it("(e) the argument parser accepts exactly tree mode, --staged and --history <range>; a missing range, or one beginning with `-`, is refused before any git call", () => {
    expect(parseSecretScanArguments([])).toEqual({ ok: true, mode: "tree" });
    expect(parseSecretScanArguments(["--staged"])).toEqual({ ok: true, mode: "staged" });
    expect(parseSecretScanArguments(["--history", "57c3b29..HEAD"])).toEqual({ ok: true, mode: "history", range: "57c3b29..HEAD" });
    for (const argv of [["--history"], ["--history", ""], ["--history", "-n1"], ["--history", "--all"], ["--history", "a..b", "c"], ["--staged", "x"], ["--tree"], ["--history=main"], ["main"], ["--history", "a b"]]) {
      expect(parseSecretScanArguments(argv).ok, argv.join(" ")).toBe(false);
      const io = fakeGit({});
      const result = runSecretScanCommand(argv, io, SECRET_SCAN_ALLOWLIST);
      expect(result.exitCode, argv.join(" ")).toBe(2);
      expect(io.calls, argv.join(" ")).toEqual([]);
    }
  });

  it("(e2) history mode, through the pure parser and an injected git: each blob is read once and scanned once per path, under the first commit of the range that brought it there, as `<commit>:<path>:<line> <rule>`, the text absent; an allowlisted sentinel (same path, rule and line hash) exits 0 with no stale-entry failure; deletions, links and submodules are not read", () => {
    const [A, B, M] = [oid("a"), oid("b"), oid("c")];
    const [X, S, T, L, G] = [oid("1"), oid("2"), oid("3"), oid("4"), oid("5")];
    const sentinel = `const probe = "${SAMPLES["anthropic-key-shape"]}";`;
    const answers: Record<string, string> = {
      "rev-list --reverse 57c3b29..HEAD --": [A, B, M, ""].join(NEWLINE),
      [`diff-tree -r -m --root --no-renames --no-abbrev -z ${A}`]: z(A, ...record("A", X, "app/x.ts"), ...record("A", S, "app/s.test.ts"), ...record("A", L, "app/link.ts", "120000")),
      [`diff-tree -r -m --root --no-renames --no-abbrev -z ${B}`]: z(B, ...record("M", T, "app/t.ts"), ...record("D", "0".repeat(40), "app/gone.ts"), ...record("A", G, "vendor/sub", "160000")),
      // a merge, shown against each parent: the second parent brings app/x.ts's blob again, already seen
      [`diff-tree -r -m --root --no-renames --no-abbrev -z ${M}`]: z(M, ...record("M", X, "app/x.ts"), M, ...record("A", X, "app/copy.ts")),
      [`blob ${X}`]: ["line one", `const leaked = "${SAMPLES["github-token-shape"]}";`].join(NEWLINE),
      [`blob ${S}`]: ["// a redaction sentinel", sentinel].join(NEWLINE),
      [`blob ${T}`]: "export const clean = true;",
    };
    const io = fakeGit(answers);
    const collected = collectSecretScanEntries({ ok: true, mode: "history", range: "57c3b29..HEAD" }, io);
    expect(collected.entries.map((entry) => entry.path)).toEqual([`${A}:app/x.ts`, `${A}:app/s.test.ts`, `${B}:app/t.ts`, `${M}:app/copy.ts`]);
    expect([...io.reads].sort()).toEqual([X, S, T].sort());
    expect(io.calls.every((call) => ["rev-list", "diff-tree", "cat-file"].includes(call[0]!))).toBe(true);
    const allow: SecretScanAllowlistEntry = { path: "app/s.test.ts", rule: "anthropic-key-shape", sha256: lineDigest(sentinel), reason: "a key-shaped fake the redaction test feeds its classifier, never a key" };
    const result = runSecretScan({ entries: collected.entries, allowlist: [allow, ...SECRET_SCAN_ALLOWLIST], mode: "history" });
    expect(result.lines).toEqual([`${A}:app/x.ts:2 github-token-shape`, `${M}:app/copy.ts:2 github-token-shape`]);
    expect(result.exitCode).toBe(1);
    expect(JSON.stringify(result)).not.toContain(SAMPLES["github-token-shape"]);
    // with the leaked blob gone, only the allowlisted sentinel hits: exit 0, and the real six (not in this range) are no stale failure
    const clean = runSecretScan({ entries: collected.entries.filter((entry) => !/:app\/(?:x|copy)\.ts$/.test(entry.path)), allowlist: [allow, ...SECRET_SCAN_ALLOWLIST], mode: "history" });
    expect(clean).toMatchObject({ exitCode: 0, lines: [], allowlisted: 1 });
    // the whole command, as the script runs it
    const command = runSecretScanCommand(["--history", "57c3b29..HEAD"], fakeGit(answers), [allow]);
    expect(command.exitCode).toBe(1);
    expect(command.lines).toEqual([`${A}:app/x.ts:2 github-token-shape`, `${M}:app/copy.ts:2 github-token-shape`]);
  });

  it("(e3) the pure parsers: rev-list lines are commit ids and nothing else; diff-tree -z records keep the regular files added or changed, skip deletions, links and submodules, and refuse a malformed record", () => {
    expect(parseRevList([oid("a"), oid("b"), ""].join(NEWLINE))).toEqual([oid("a"), oid("b")]);
    expect(() => parseRevList(`${oid("a")}${NEWLINE}fatal: bad revision`)).toThrow();
    const parsed = parseDiffTree(z(oid("a"), ...record("A", oid("1"), "a b/c.ts"), ...record("M", oid("2"), "x.ts", "100755"), ...record("D", "0".repeat(40), "gone.ts"), ...record("A", oid("3"), "l", "120000")));
    expect(parsed).toEqual([{ blob: oid("1"), path: "a b/c.ts" }, { blob: oid("2"), path: "x.ts" }]);
    expect(() => parseDiffTree(z(":100644 100644 abc M", "x.ts"))).toThrow();
  });

  it("(e4) tree and staged modes: tree lists `git ls-files` (tracked and untracked-unignored) and reads each regular file; staged reads the index blobs of the added, modified or retyped paths; the stale check runs in tree mode only", () => {
    const listed = z("a.ts", "b.ts", "gone.ts");
    const tree = fakeGit({ "ls-files -z --cached --others --exclude-standard": listed }, { "a.ts": "export {};", "b.ts": `const k = "${SAMPLES["openai-key-shape"]}";` });
    const treeResult = runSecretScanCommand([], tree, []);
    expect(treeResult.lines).toEqual(["b.ts:1 openai-key-shape"]);
    expect(treeResult.exitCode).toBe(1);
    expect(treeResult.unreadable).toBe(1);
    // [B24-A2 review, 2026-10-06] security-3, reviewed pin move: the staged diff has no --diff-filter (a staged deletion counts as staged)
    const staged = fakeGit({ "diff --cached --raw -z --no-renames --no-abbrev": z(...record("A", oid("7"), "new.ts")), [`blob ${oid("7")}`]: ["", "", `x = "${SAMPLES["supabase-secret-key-shape"]}"`].join(NEWLINE) });
    const stagedResult = runSecretScanCommand(["--staged"], staged, SECRET_SCAN_ALLOWLIST);
    expect(stagedResult.lines).toEqual(["new.ts:3 supabase-secret-key-shape"]);
    expect(staged.calls.map((call) => call[0])).toEqual(["diff", "cat-file", "cat-file"]);
  });

  it("(f) the script is the only file that runs git: read-only commands through execFileSync with an argument array and no shell; no app/lib/deployment module imports a process module", () => {
    const script = read("scripts/scan-secrets.ts");
    expect(script).toMatch(/import \{ execFileSync \} from "node:child_process";/);
    expect(script).toMatch(/execFileSync\("git", \[\.\.\.args\]/);
    expect(script).not.toMatch(/shell:|\bexec\(|\bspawn\(|execSync\(/);
    expect(script).toContain("runSecretScanCommand(");
    for (const path of ["app/lib/deployment/secret-scan.ts", "app/lib/deployment/secret-scan-allowlist.ts", "app/lib/deployment/environment-names.ts", "app/lib/deployment/auth-url-allowlist.ts", "app/lib/deployment/configuration.ts", "app/lib/deployment/flag-inventory.ts", "app/lib/deployment/readiness.ts"]) {
      expect(read(path), path).not.toMatch(/from "(?:node:)?(?:child_process|worker_threads|cluster|vm)"|require\(/);
    }
    // the read-only git commands the module asks for, and nothing that writes
    const scanner = read("app/lib/deployment/secret-scan.ts"); // [B24-A2 review, 2026-10-06] renamed from `module` (eslint @next/next/no-assign-module-variable)
    for (const command of ["\"ls-files\"", "\"diff\"", "\"rev-list\"", "\"diff-tree\"", "\"cat-file\""]) expect(scanner, command).toContain(command);
    expect(scanner).not.toMatch(/"(?:add|commit|push|checkout|reset|stash|merge|rebase|update-index|write-tree|config)"/);
  });
});

describe("[B24-A2] the page edge-security.md, its scan half", () => {
  it("(g) the page states the rules without a matching literal, the size bound, the allowlist by path and reason (never a value), the three modes with the installed git's flags, and the exact --history command the closeout runs for SECRETS EXPOSED, a hit going to the lead as path:line rule only", () => {
    const page = read(PAGE);
    const start = page.search(new RegExp(`${NEWLINE}## 6\\. `));
    const six = page.slice(start, page.indexOf(`${NEWLINE}## `, start + 1));
    for (const rule of SECRET_SCAN_RULES) expect(six, rule.id).toContain(`\`${rule.id}\``);
    for (const entry of SECRET_SCAN_ALLOWLIST) expect(six, entry.path).toContain(`\`${entry.path}\``);
    for (const fact of ["4 MiB", "`pnpm exec tsx scripts/scan-secrets.ts`", "`pnpm exec tsx scripts/scan-secrets.ts --staged`", "`pnpm exec tsx scripts/scan-secrets.ts --history main`", "`pnpm exec tsx scripts/scan-secrets.ts --history 57c3b29..HEAD`", "SECRETS EXPOSED", "path:line rule", "`<commit>:<path>:<line> <rule>`", "git version 2.55.0.windows.3", "--no-renames", "--root", "b24-a2-secret-scan", "secret-scan"]) expect(six, fact).toContain(fact);
    expect(runSecretScan({ entries: [{ path: PAGE, text: page }], allowlist: [], mode: "staged" }).lines).toEqual([]);
  });
});

// ── [B24-A2 review, 2026-10-06] the review round: each case red on the tree the review read (security-1..3), or proven against a
// deliberate breakage of the source, restored by hash (tests-2..4); every fake assembled at run time, nothing written, no process ──

/** A fake git for the review cases: canned answers by argument list (the staged diff answered with or without a diff filter, so a case
 *  judges the behaviour, not the flags); `cat-file --batch-check` reports each blob's size, an override, or `missing`; `--batch` returns
 *  every blob asked for except the ones held back; every call and every blob asked of `--batch` is recorded. Files are bytes. */
function reviewGit(options: { answers?: Record<string, string>; blobs?: Record<string, string>; sizes?: Record<string, number>; missing?: readonly string[]; heldBack?: readonly string[]; files?: Record<string, Uint8Array> }): SecretScanIo & { calls: string[][]; reads: string[] } {
  const calls: string[][] = [];
  const reads: string[] = [];
  const encoder = new TextEncoder();
  const bytesOf = (id: string): Uint8Array => encoder.encode(options.blobs?.[id] ?? "");
  return {
    calls,
    reads,
    git: (args, input) => {
      calls.push([...args]);
      const ids = String(input ?? "").split(NEWLINE).filter(Boolean);
      if (args[0] === "cat-file" && args[1] === "--batch-check") return encoder.encode(ids.map((id) => (options.missing?.includes(id) ? `${id} missing` : `${id} blob ${options.sizes?.[id] ?? bytesOf(id).byteLength}`)).join(NEWLINE) + NEWLINE);
      if (args[0] === "cat-file" && args[1] === "--batch") {
        reads.push(...ids);
        return Buffer.concat(ids.filter((id) => !options.heldBack?.includes(id)).flatMap((id) => [Buffer.from(`${id} blob ${bytesOf(id).byteLength}${NEWLINE}`), Buffer.from(bytesOf(id)), Buffer.from(NEWLINE)]));
      }
      const key = args.join(" ").replace(/ --diff-filter=[A-Z]+$/, "");
      const answer = options.answers?.[key];
      if (answer === undefined) throw new Error(`fake git: no answer for ${key}`);
      return encoder.encode(answer);
    },
    readFile: (path) => options.files?.[path] ?? null,
  };
}
const unscannedPaths = (lines: readonly string[]): string[] => lines.filter((line) => line.startsWith("unscanned: ")).map((line) => line.split(" ")[1]!);
const STAGED_DIFF = "diff --cached --raw -z --no-renames --no-abbrev";
const HISTORY = (range: string): string => `rev-list --reverse ${range} --`;
const DIFF_TREE = (commit: string): string => `diff-tree -r -m --root --no-renames --no-abbrev -z ${commit}`;

describe("[B24-A2 review, 2026-10-06] the scan's review round", () => {
  it("(h) security-2 (red before the review fix, where the rules missed them): the rules catch the formats the project holds - OpenAI project, service-account and admin keys; GitHub OAuth, user, server and refresh tokens and fine-grained tokens; a database URL with a password assigned to a *_URL name; a Postgres URL with a password at a Supabase host - and leave alone a word that only contains a prefix, a too-short key, a <placeholder> password, a short password and an https URL with userinfo", () => {
    const db = (scheme: string, rest: string): string => [scheme, rest].join(":");
    const hits: ReadonlyArray<readonly [string, string]> = [
      [`const key = "${["sk", "proj", "B24a2_x-".repeat(4)].join("-")}";`, "openai-key-shape"],
      [`const key = "${["sk", "svcacct", "B24a2x".repeat(5)].join("-")}";`, "openai-key-shape"],
      [`OPENAI_ADMIN=${["sk", "admin", "b24a2X".repeat(4)].join("-")}`, "openai-key-shape"],
      [`token: "${["gh", "o_", "e".repeat(36)].join("")}"`, "github-token-shape"],
      [`token: "${["gh", "u_", "f".repeat(36)].join("")}"`, "github-token-shape"],
      [`token: "${["gh", "s_", "g".repeat(36)].join("")}"`, "github-token-shape"],
      [`token: "${["gh", "r_", "h".repeat(36)].join("")}"`, "github-token-shape"],
      [`token: "${["github", "pat", "B24A2b24a2_".repeat(6)].join("_")}"`, "github-token-shape"],
      [`${["DATABASE", "URL"].join("_")}=${db("postgresql", "//postgres")}:${["b24a2", "not", "a", "password"].join("-")}@db.example.invalid:5432/postgres`, "connection-string-password"],
      [`  ${["SIRKIT", "DB", "QUALIFICATION", "URL"].join("_")}: "${db("redis", "//cache")}:${"b24a2pw".repeat(2)}@cache.example.invalid:6379",`, "connection-string-password"],
      [`const u = "${db("postgres", "//postgres.b24a2ref")}:${["b24a2", "fake", "pw"].join("-")}@aws-0-eu-west-1.pooler.${["supabase", "com"].join(".")}:6543/postgres";`, "connection-string-password"],
    ];
    hits.forEach(([text, rule], index) => {
      const result = runSecretScan({ entries: [{ path: "x.ts", text }], allowlist: [], mode: "staged" });
      expect(result.lines, `hit ${index}`).toEqual([`x.ts:1 ${rule}`]);
      expect(JSON.stringify(result), `hit ${index}`).not.toContain(text.trim().slice(-16));
    });
    const misses = [
      `const task = "${["task", "proj", "a".repeat(30)].join("-")}";`,
      `const key = "${["sk", "proj", "short"].join("-")}";`,
      `token: "${["gh", "x_", "e".repeat(36)].join("")}"`,
      `${["DATABASE", "URL"].join("_")}=${db("postgresql", "//postgres.<project-ref>")}:<your-db-password>@aws-0-<region>.pooler.${["supabase", "com"].join(".")}:5432/postgres`,
      `${["REDIS", "URL"].join("_")}=${db("redis", "//u")}:pw@cache.example.invalid:6379`,
      `see ${db("https", "//user")}:longpassword@example.invalid/x`,
    ];
    misses.forEach((text, index) => expect(runSecretScan({ entries: [{ path: "x.ts", text }], allowlist: [], mode: "staged" }).lines, `miss ${index}`).toEqual([]));
  });

  it("(i) security-1 (red before the review fix, where one NUL byte skipped a whole file as binary): no file goes unscanned for a NUL byte - a UTF-8 source holding raw NULs (app/lib/engineering/pcb-delta.ts, production code, is one of three tracked .ts files that do), UTF-16 with a byte-order mark (little or big endian), BOM-less UTF-16 and a binary file are each read in tree mode, and a planted marker or key in each is reported as path:line rule; a binary file holding none gives no line", () => {
    const pem = SAMPLES["pem-private-key"]!;
    const key = SAMPLES["anthropic-key-shape"]!;
    const token = SAMPLES["github-token-shape"]!;
    const real = "app/lib/engineering/pcb-delta.ts";
    const realBytes = readFileSync(join(ROOT, real));
    expect(realBytes.includes(0), `${real} holds a raw NUL byte`).toBe(true);
    const plantedLine = realBytes.toString("utf8").split(NEWLINE).length;
    const text = ["line one", `const k = "${key}";`, "three", ""].join(NEWLINE);
    const little = Buffer.from(text, "utf16le");
    const big = Buffer.from(little).swap16();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0xff, 0x00, 0xc3]);
    const binary = Buffer.concat([png, Buffer.from(`x${token}x`, "latin1"), Buffer.from([0, 0xfe, 0x00, 0x0d])]);
    const binaryLine = binary.subarray(0, binary.indexOf(token)).filter((byte) => byte === 0x0a).length + 1;
    const files: Record<string, Uint8Array> = {
      [real]: Buffer.concat([realBytes, Buffer.from(`const planted = "${pem}";${NEWLINE}`, "utf8")]),
      "notes/utf16le-bom.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), little]),
      "notes/utf16be-bom.txt": Buffer.concat([Buffer.from([0xfe, 0xff]), big]),
      "notes/utf16le.txt": little,
      "public/leaky.png": binary,
      "public/clean.png": Buffer.concat([png, png]),
    };
    const io = reviewGit({ answers: { "ls-files -z --cached --others --exclude-standard": z(...Object.keys(files)) }, files });
    const result = runSecretScanCommand([], io, []);
    expect(result.lines).toEqual([`${real}:${plantedLine} pem-private-key`, "notes/utf16le-bom.txt:2 anthropic-key-shape", "notes/utf16be-bom.txt:2 anthropic-key-shape", "notes/utf16le.txt:2 anthropic-key-shape", `public/leaky.png:${binaryLine} github-token-shape`]);
    expect(result.exitCode).toBe(1);
    expect(result.entries).toBe(6);
    for (const sample of [pem, key, token]) expect(JSON.stringify(result)).not.toContain(sample);
  });

  it("(j) security-1, tests-4 (red before the review fix, where a blob git did not return was dropped, or scanned as empty): in --history and --staged a blob over the bound is never read (never asked of cat-file --batch) and is counted oversized; a blob batch-check reports missing, or one --batch does not return, is never passed silently - it is counted, named as unscanned and fails the run", () => {
    const A = oid("a");
    const [X, O, M, H] = [oid("1"), oid("2"), oid("3"), oid("4")];
    const blobs = { [X]: "export const x = 1;", [O]: "o", [H]: "export const h = 1;" };
    const history = reviewGit({
      answers: { [HISTORY("57c3b29..HEAD")]: `${A}${NEWLINE}`, [DIFF_TREE(A)]: z(A, ...record("A", X, "app/x.ts"), ...record("A", O, "data/big.bin"), ...record("A", M, "app/m.ts"), ...record("A", H, "app/h.ts")) },
      blobs,
      sizes: { [O]: SECRET_SCAN_MAX_BYTES + 1 },
      missing: [M],
      heldBack: [H],
    });
    const result = runSecretScanCommand(["--history", "57c3b29..HEAD"], history, []);
    expect([...history.reads].sort()).toEqual([X, H].sort());
    expect(result.skipped.oversized).toBe(1);
    expect(unscannedPaths(result.lines)).toEqual([`${A}:app/m.ts`, `${A}:app/h.ts`]);
    expect((result.skipped as { missing?: number }).missing).toBe(2);
    expect(result.exitCode).toBe(1);
    const staged = reviewGit({ answers: { [STAGED_DIFF]: z(...record("A", O, "data/big.bin"), ...record("M", M, "app/m.ts"), ...record("A", X, "app/x.ts")) }, blobs, sizes: { [O]: SECRET_SCAN_MAX_BYTES + 1 }, missing: [M] });
    const stagedResult = runSecretScanCommand(["--staged"], staged, []);
    expect(staged.reads).toEqual([X]);
    expect(stagedResult.skipped.oversized).toBe(1);
    expect(unscannedPaths(stagedResult.lines)).toEqual(["app/m.ts"]);
    expect(stagedResult.exitCode).toBe(1);
    // with every blob returned and none over the bound, nothing is unscanned and the run is clean
    const clean = runSecretScanCommand(["--staged"], reviewGit({ answers: { [STAGED_DIFF]: z(...record("A", X, "app/x.ts")) }, blobs }), []);
    expect(clean).toMatchObject({ exitCode: 0, lines: [] });
  });

  it("(k) security-3 (red before the review fix, where an empty --staged or --history run exited 0 having read nothing, and CI scanned only the merged tree): --staged with nothing staged and --history over a range with no commit exit 1, saying nothing was scanned (a staged deletion, or a range of deletions only, is no such case); the CI job checks out the whole history and, on a pull request, also scans every commit of it (base..head), so a secret added and then deleted inside the pull request is caught before a merge keeps it", () => {
    const empty = runSecretScanCommand(["--staged"], reviewGit({ answers: { [STAGED_DIFF]: "" } }), []);
    expect(empty.exitCode).toBe(1);
    expect(empty.lines.join(" ")).toMatch(/^nothing scanned: /);
    const none = runSecretScanCommand(["--history", "origin/main..HEAD"], reviewGit({ answers: { [HISTORY("origin/main..HEAD")]: "" } }), []);
    expect(none.exitCode).toBe(1);
    expect(none.lines.join(" ")).toMatch(/^nothing scanned: /);
    const deletion = runSecretScanCommand(["--staged"], reviewGit({ answers: { [STAGED_DIFF]: z(...record("D", "0".repeat(40), "app/gone.ts")) } }), []);
    expect(deletion).toMatchObject({ exitCode: 0, lines: [] });
    const A = oid("a");
    const deletions = runSecretScanCommand(["--history", "a..b"], reviewGit({ answers: { [HISTORY("a..b")]: `${A}${NEWLINE}`, [DIFF_TREE(A)]: z(A, ...record("D", "0".repeat(40), "app/gone.ts")) } }), []);
    expect(deletions).toMatchObject({ exitCode: 0, lines: [] });
    // CI: the whole history, and every commit of a pull request
    const all = read(WORKFLOW).split(NEWLINE);
    const job = all.slice(all.indexOf("  secret-scan:")).join(NEWLINE);
    expect(job).toContain(["      - uses: actions/checkout@v4", "        with:", "          fetch-depth: 0"].join(NEWLINE));
    const history = [
      "      - name: Scan every commit of the pull request (a secret added, then deleted, stays in the history a merge keeps)",
      "        if: github.event_name == 'pull_request'",
      "        env:",
      "          BASE_SHA: ${{ github.event.pull_request.base.sha }}",
      "          HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
      '        run: pnpm exec tsx scripts/scan-secrets.ts --history "$BASE_SHA..$HEAD_SHA"',
    ].join(NEWLINE);
    expect(job).toContain(history);
    expect(job.indexOf(`      - run: pnpm exec tsx scripts/scan-secrets.ts${NEWLINE}`)).toBeLessThan(job.indexOf(history));
    expect(read(WORKFLOW)).toMatch(/^ {2}pull_request:$/m);
  });

  it("(b2) tests-3: an allowlist entry holds one path and one rule - the allowlisted line copied to a second path hits there (the entry stays used); moved to a new path it hits there and its entry is stale; an entry with the right path and digest but another rule allowlists nothing; a line hitting two rules is allowlisted for the entry's rule only", () => {
    const line = `const fake = "${SAMPLES["aws-access-key-id-shape"]}";`;
    const entry: SecretScanAllowlistEntry = { path: "app/x/__tests__/a.test.ts", rule: "aws-access-key-id-shape", sha256: lineDigest(line), reason: "a key-shaped fake that the redaction test feeds its classifier" };
    const copied = runSecretScan({ entries: [{ path: entry.path, text: line }, { path: "app/lib/y.ts", text: line }], allowlist: [entry] });
    expect(copied).toMatchObject({ exitCode: 1, lines: ["app/lib/y.ts:1 aws-access-key-id-shape"], allowlisted: 1 });
    const moved = runSecretScan({ entries: [{ path: "app/lib/y.ts", text: line }], allowlist: [entry] });
    expect(moved.exitCode).toBe(1);
    expect(moved.lines[0]).toBe("app/lib/y.ts:1 aws-access-key-id-shape");
    expect(moved.lines.slice(1).join(" ")).toMatch(/entry 1 \(app\/x\/__tests__\/a\.test\.ts aws-access-key-id-shape\) is stale: that path is no file of the tree/);
    const other = runSecretScan({ entries: [{ path: entry.path, text: line }], allowlist: [{ ...entry, rule: "jwt-shape" }], mode: "staged" });
    expect(other).toMatchObject({ exitCode: 1, lines: [`${entry.path}:1 aws-access-key-id-shape`], allowlisted: 0 });
    const both = `const two = "${SAMPLES["aws-access-key-id-shape"]}" + "${SAMPLES["huggingface-token-shape"]}";`;
    const half = runSecretScan({ entries: [{ path: entry.path, text: both }], allowlist: [{ ...entry, sha256: lineDigest(both) }], mode: "staged" });
    expect(half).toMatchObject({ exitCode: 1, lines: [`${entry.path}:1 huggingface-token-shape`], allowlisted: 1 });
  });

  it("(f2) tests-2: the script's exit is the scan's - `process.exitCode = result.exitCode;` once, its last statement, and no other exit (no other exitCode assignment, no process.exit)", () => {
    const script = read("scripts/scan-secrets.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(script.match(/process\.exitCode = result\.exitCode;/g) ?? []).toHaveLength(1);
    expect(script.match(/process\.exitCode\s*=/g) ?? []).toHaveLength(1);
    expect(script).not.toMatch(/process\.exit\s*\(|process\.abort\s*\(|process\.kill\s*\(/);
    const statements = script.split(NEWLINE).map((line) => line.trim()).filter((line) => line.length > 0);
    expect(statements[statements.length - 1]).toBe("process.exitCode = result.exitCode;");
  });

  it("(g2) security-1, security-2, security-3 (red before the review fix): the page's section 6 states that no file is skipped for a NUL byte (UTF-16 read by its byte-order mark, NULs dropped for a second match), that a blob git does not return fails the run, that an empty --staged or --history run fails, the connection-string rule in words, the pull request's history scan in CI and the pre-push command over the unpushed commits; it still matches no rule", () => {
    const page = read(PAGE);
    const start = page.search(new RegExp(`${NEWLINE}## 6\\. `));
    const six = page.slice(start, page.indexOf(`${NEWLINE}## `, start + 1));
    for (const fact of ["NUL byte", "UTF-16", "byte-order mark", "unscanned", "nothing scanned", "`connection-string-password`", "fetch-depth: 0", "`pnpm exec tsx scripts/scan-secrets.ts --history \"$BASE_SHA..$HEAD_SHA\"`", "`pnpm exec tsx scripts/scan-secrets.ts --history origin/<branch>..HEAD`"]) expect(six, fact).toContain(fact);
    expect(six).not.toMatch(/skipped and counted, never scanned|the binary entries \(a\s+NUL byte\)/);
    expect(runSecretScan({ entries: [{ path: PAGE, text: page }], allowlist: [], mode: "staged" }).lines).toEqual([]);
  });
});

// ── [B24-A2F, 2026-10-09] the history-only allowlist entries (the lead's corrective increment; OD-195 amended): a line that hit at
// one commit and was rewritten by a later one stays in the history CI's pull-request step scans (`--history "$BASE_SHA..$HEAD_SHA"`),
// and an ordinary entry for it is stale in tree mode. The shape below is B24-C3's as committed at `ba4f562:75` - a template literal
// assigned to a `_URL` name, user and password from joined fragments, host db.invalid - assembled at run time here as everywhere;
// nothing is written and no process is started (the real scanner's tree and history runs are recorded on the page, section 15). ──

/** B24-C3's rewritten shape, assembled: no line of this file matches the connection-string rule. */
const HISTORY_LINE = `const ${["FAKE", "URL"].join("_")} = \`${["postgres:", "//", "oper", "ator"].join("")}:${["pass", "word"].join("")}@db.invalid:5433/sirkit\`;`;
const C3_TEST = "app/lib/qualification/__tests__/b24-c3-trace-read.test.ts";
const HISTORY_ONLY: SecretScanAllowlistEntry = { path: C3_TEST, rule: "connection-string-password", sha256: lineDigest(HISTORY_LINE), historyOnly: true, reason: "a fake connection string committed once and replaced at 0123abc by joined fragments, so it exists only in history" };
const ORDINARY: SecretScanAllowlistEntry = { path: HISTORY_ONLY.path, rule: HISTORY_ONLY.rule, sha256: HISTORY_ONLY.sha256, reason: HISTORY_ONLY.reason };
const USERINFO = ["oper", "ator", ":", "pass", "word"].join(""); // the rule id itself ends in the word password, so the text is checked by its userinfo

describe("[B24-A2F, 2026-10-09] the history-only allowlist entries (OD-195 amended)", () => {
  it("(l) red first on b3a4f2d (the entry was stale): in tree mode a history-only entry whose line hits nowhere is not stale - exit 0, nothing allowlisted, no line; the same entry without the mark is stale as before; a path absent from the tree is no stale failure either", () => {
    const tree = [{ path: C3_TEST, text: ["// the fake is assembled from joined fragments now", "export {};"].join(NEWLINE) }];
    expect(runSecretScan({ entries: tree, allowlist: [HISTORY_ONLY] })).toMatchObject({ exitCode: 0, lines: [], allowlisted: 0 });
    const stale = runSecretScan({ entries: tree, allowlist: [ORDINARY] });
    expect(stale.exitCode).toBe(1);
    expect(stale.lines).toEqual([`allowlist: entry 1 (${C3_TEST} connection-string-password) is stale: no line of that file hits with that digest`]);
    expect(runSecretScan({ entries: [{ path: "app/other.ts", text: "export {};" }], allowlist: [HISTORY_ONLY] })).toMatchObject({ exitCode: 0, lines: [] });
  });

  it("(m) red first on b3a4f2d (the hit was allowlisted): a tree line hitting a history-only entry's path, rule and digest is reported, never allowlisted - the line was declared gone, so its return is a finding: exit 1, the `path:line rule` line, allowlisted 0, no stale line, the text absent; the ordinary entry allowlists the same line as before", () => {
    const back = [{ path: C3_TEST, text: ["// the fake came back", HISTORY_LINE].join(NEWLINE) }];
    const result = runSecretScan({ entries: back, allowlist: [HISTORY_ONLY] });
    expect(result).toMatchObject({ exitCode: 1, lines: [`${C3_TEST}:2 connection-string-password`], allowlisted: 0 });
    expect(JSON.stringify(result)).not.toContain(USERINFO);
    expect(runSecretScan({ entries: back, allowlist: [ORDINARY] })).toMatchObject({ exitCode: 0, lines: [], allowlisted: 1 });
  });

  it("(n) in --history mode a history-only entry allowlists the hit exactly as an ordinary one (same path, rule and digest: exit 0, allowlisted 1, the match counted), through the pure scan and the command with an injected git; red first on b3a4f2d in its last assertion, where the same allowlist left the tree scan red (stale) - the kind's whole point", () => {
    const commit = oid("d");
    const blob = ["// as committed", HISTORY_LINE].join(NEWLINE);
    expect(runSecretScan({ entries: [{ path: `${commit}:${C3_TEST}`, text: blob }], allowlist: [HISTORY_ONLY], mode: "history" })).toMatchObject({ exitCode: 0, lines: [], allowlisted: 1 });
    const io = fakeGit({ "rev-list --reverse 57c3b29..HEAD --": `${commit}${NEWLINE}`, [`diff-tree -r -m --root --no-renames --no-abbrev -z ${commit}`]: z(commit, ...record("A", oid("6"), C3_TEST)), [`blob ${oid("6")}`]: blob });
    const command = runSecretScanCommand(["--history", "57c3b29..HEAD"], io, [HISTORY_ONLY, ...SECRET_SCAN_ALLOWLIST]);
    expect(command).toMatchObject({ exitCode: 0, lines: [], allowlisted: 1, entries: 1 });
    expect(JSON.stringify(command)).not.toContain(USERINFO);
    expect(runSecretScan({ entries: [{ path: C3_TEST, text: "export {};" }], allowlist: [HISTORY_ONLY] })).toMatchObject({ exitCode: 0, lines: [] });
  });

  it("(o) red first on b3a4f2d (the staged line was allowlisted): in --staged mode a history-only entry never allowlists - the line is about to enter the tree, so it is reported (exit 1, allowlisted 0), through the pure scan and the command; an ordinary entry still allowlists it", () => {
    const staged = [{ path: C3_TEST, text: HISTORY_LINE }];
    expect(runSecretScan({ entries: staged, allowlist: [HISTORY_ONLY], mode: "staged" })).toMatchObject({ exitCode: 1, lines: [`${C3_TEST}:1 connection-string-password`], allowlisted: 0 });
    expect(runSecretScan({ entries: staged, allowlist: [ORDINARY], mode: "staged" })).toMatchObject({ exitCode: 0, lines: [], allowlisted: 1 });
    const io = fakeGit({ "diff --cached --raw -z --no-renames --no-abbrev": z(...record("M", oid("8"), C3_TEST)), [`blob ${oid("8")}`]: HISTORY_LINE });
    expect(runSecretScanCommand(["--staged"], io, [HISTORY_ONLY])).toMatchObject({ exitCode: 1, lines: [`${C3_TEST}:1 connection-string-password`], allowlisted: 0 });
  });

  it("(p) red first on b3a4f2d (every reason passed): allowlistProblems refuses a history-only entry whose reason names no replacing commit (a 7-40 hex id), or says neither replaced nor rewritten, or whose mark is not true - each named by its entry, never by the line - and an unusable allowlist fails the run in every mode; the good entry, a rewritten one and every ordinary entry pass", () => {
    expect(allowlistProblems([HISTORY_ONLY])).toEqual([]);
    expect(allowlistProblems([{ ...HISTORY_ONLY, reason: "a fake connection string committed once and rewritten at 0123abc4567 by joined fragments; it exists only in history" }])).toEqual([]);
    const noId = { ...HISTORY_ONLY, reason: "a fake connection string committed once and replaced by joined fragments, so it exists only in history" };
    const noWord = { ...HISTORY_ONLY, reason: "a fake connection string committed once and taken out at 0123abc, so it exists only in history" };
    const notTrue = { ...HISTORY_ONLY, historyOnly: false as never };
    for (const [name, entry] of [["no id", noId], ["no word", noWord], ["not true", notTrue]] as const) {
      const problems = allowlistProblems([entry]);
      expect(problems.length, name).toBeGreaterThan(0);
      for (const problem of problems) expect(problem, name).toMatch(/^entry 1 \(app\/lib\/qualification\/__tests__\/b24-c3-trace-read\.test\.ts\): /);
      for (const mode of ["tree", "staged", "history"] as const) expect(runSecretScan({ entries: [], allowlist: [entry], mode }).exitCode, `${name} ${mode}`).toBe(1);
    }
    expect(allowlistProblems([{ ...HISTORY_ONLY, reason: "a fake connection string committed once; it exists only in history now" }])).toHaveLength(2);
    expect(allowlistProblems([ORDINARY, { ...ORDINARY, sha256: lineDigest("x"), reason: noId.reason }])).toEqual([]);
  });

  it("(q) red first on b3a4f2d (eight entries): the committed allowlist's ninth entry is history-only - B24-C3's test path, the connection-string rule, the lead's 64-hex digest over the line as committed at ba4f562, a reason naming ba4f562:75 and aaa6a1b and saying replaced; no line of that file at HEAD carries the digest, so tree mode over it is green with nothing allowlisted and nothing stale, and the eight ordinary entries carry no mark", () => {
    expect(SECRET_SCAN_ALLOWLIST).toHaveLength(14); /* [PR-L6 integration, 2026-10-19] reviewed pin move: 13 -> 14 (the l6-plan-assumptions literal as a third history-only entry, LAST) */ // [PR-L, 2026-10-18] reviewed pin move: 12 -> 13 (PR-D's v1 generate-proposal line as a second history-only entry, after this one); [PR-G lead, 2026-10-17] reviewed pin move: 9 -> 12 (the three PR-D/PR-F redaction cases, ordinary entries placed before the history-only one, which stays last)
    const ninth = SECRET_SCAN_ALLOWLIST[11] /* [PR-G lead, 2026-10-17] the history-only entry stays LAST: index 8 -> 11 after the three ordinary PR-D/PR-F entries */!;
    expect(ninth).toMatchObject({ path: C3_TEST, rule: "connection-string-password", historyOnly: true });
    expect(ninth.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ninth.sha256).toBe("8bbe84aef14181902a233659797cf030bfd89aceb5f844542df7aee61e584a01");
    for (const word of ["ba4f562:75", "aaa6a1b", "replaced", ["FAKE", "URL"].join("_"), ["FAKE", "CONNECTION"].join("_"), "db.invalid", "no credential"]) expect(ninth.reason).toContain(word);
    expect(SECRET_SCAN_ALLOWLIST.slice(0, 11).every((entry) => entry.historyOnly === undefined)).toBe(true);
    expect(allowlistProblems(SECRET_SCAN_ALLOWLIST)).toEqual([]);
    const current = read(C3_TEST);
    expect(current.split(NEWLINE).map((raw) => lineDigest(raw.endsWith(CR) ? raw.slice(0, -1) : raw))).not.toContain(ninth.sha256);
    expect(runSecretScan({ entries: [{ path: C3_TEST, text: current }], allowlist: [ninth] })).toMatchObject({ exitCode: 0, lines: [], allowlisted: 0 });
    expect(runSecretScan({ entries: [{ path: C3_TEST, text: current }], allowlist: [], mode: "staged" }).lines).toEqual([]); /* [PR-L/M integration, 2026-10-18] F7 (on this line: no line moves, the page citations of (r) and (s) hold): the thirteenth entry - the second history-only one, LAST - is pinned as the ninth is (inside this case, so the page's it( counts hold): PR-D's test path, the key-shape rule, the digest of the line as committed at e5817558, a reason naming e5817558 AND the replacing commit 00d0343 and saying rewritten; no line of that file at HEAD carries the digest; the header names the last TWO; the file's CURRENT line is the ordinary tree entry's (it holds the rewritten line); the history-only entry beside it is never used, never stale */ { const thirteenth = SECRET_SCAN_ALLOWLIST[12]!; expect(SECRET_SCAN_ALLOWLIST).toHaveLength(14) /* [PR-L6 integration, 2026-10-19] 13 -> 14 */; expect(thirteenth).toMatchObject({ path: "app/lib/engineering/__tests__/pr-d-generate-proposal.test.ts", rule: "anthropic-key-shape", historyOnly: true }); expect(thirteenth.sha256).toBe("4ac308fec5066095a8b2153307f2c714c48da82f5326474fdf097ce9d4495eeb"); for (const word of ["e5817558", "00d0343", "rewritten", "runbook L.5", "no key material", "history"]) expect(thirteenth.reason, word).toContain(word); expect(SECRET_SCAN_ALLOWLIST.filter((entry) => entry.historyOnly === true)).toEqual([SECRET_SCAN_ALLOWLIST[11], SECRET_SCAN_ALLOWLIST[12], SECRET_SCAN_ALLOWLIST[13]]) /* [PR-L6 integration, 2026-10-19] + the fourteenth */; expect(allowlistProblems([thirteenth])).toEqual([]); const currentPrD = read(thirteenth.path); expect(currentPrD.split(NEWLINE).map((raw) => lineDigest(raw.endsWith(CR) ? raw.slice(0, -1) : raw))).not.toContain(thirteenth.sha256); const forPath = SECRET_SCAN_ALLOWLIST.filter((entry) => entry.path === thirteenth.path); expect(forPath.map((entry) => entry.historyOnly === true)).toEqual([false, true]); expect(runSecretScan({ entries: [{ path: thirteenth.path, text: currentPrD }], allowlist: forPath })).toMatchObject({ exitCode: 0, lines: [], allowlisted: 1 }); const header = read("app/lib/deployment/secret-scan-allowlist.ts").split(NEWLINE).slice(0, 7).join(" "); expect(header).toContain("the LAST TWO"); expect(header).toContain("00d0343"); } /* [PR-L6 integration, 2026-10-19] the fourteenth entry - the third history-only one, LAST - pinned the same way, on this line (no line moves) */ { const fourteenth = SECRET_SCAN_ALLOWLIST[13]!; expect(fourteenth).toMatchObject({ path: "app/lib/schematic/__tests__/l6-plan-assumptions.test.ts", rule: "openai-key-shape", historyOnly: true }); expect(fourteenth.sha256).toBe("e4e6b02a0774fb3e13b9a94a68d7ce97237f20787db4df08286de9410337eade"); for (const word of ["2240363a", "9a42c36b", "rewritten", "no key material", "history"]) expect(fourteenth.reason, word).toContain(word); expect(allowlistProblems([fourteenth])).toEqual([]); const currentL6 = read(fourteenth.path); expect(currentL6.split(NEWLINE).map((raw) => lineDigest(raw.endsWith(CR) ? raw.slice(0, -1) : raw))).not.toContain(fourteenth.sha256); expect(runSecretScan({ entries: [{ path: fourteenth.path, text: currentL6 }], allowlist: [fourteenth] })).toMatchObject({ exitCode: 0, lines: [], allowlisted: 0 }); const header3 = read("app/lib/deployment/secret-scan-allowlist.ts").split(NEWLINE).slice(0, 7).join(" "); expect(header3).toContain("the LAST THREE"); expect(header3).toContain("9a42c36b"); }
  });

  it("(r) [B24-A2F review, 2026-10-09] security-1, red first on the review's tree: the allowlist module's header amends the sentence the ninth entry falsifies - `Every entry is a test sentinel ... read in its test` (its :3-4) carries the dated history-only exception on those lines, the stale sentence (:5-6) keeps its own, and the header stays seven lines (the import on :8), so C26 :10, C31 :50 and C42 :67 hold", () => {
    const header = read("app/lib/deployment/secret-scan-allowlist.ts").split(NEWLINE).map((raw) => (raw.endsWith(CR) ? raw.slice(0, -1) : raw));
    expect(header[0]).toBe("/**");
    expect(header[6]).toBe(" */");
    expect(header[7]).toMatch(/^import type \{ SecretScanAllowlistEntry \}/);
    expect(header[2]).toContain("Every entry is a test sentinel");
    expect(header[3]).toContain("read in its test before it was added here");
    const sentinel = header.slice(2, 4).join(" ");
    for (const fact of ["[B24-A2F, 2026-10-09]", "historyOnly: true", "history"]) expect(sentinel, fact).toContain(fact);
    const stale = header.slice(4, 6).join(" ");
    for (const fact of ["makes its entry stale", "except an entry marked `historyOnly: true`", "[B24-A2F, 2026-10-09]", "(LB-13)"]) expect(stale, fact).toContain(fact);
    expect(header[86]).toBe("    historyOnly: true as const,"); // [PR-G lead, 2026-10-17] pin move: 66 -> 86, the three ordinary entries (20 lines) sit above the history-only one
  });

  it("(s) [B24-A2F review, 2026-10-09] security-3, green at launch - the kind's limit pinned as the page records it (section 15, INFERRED): in --history mode a history-only entry matches its path, rule and digest under every commit of the range, no commit compared, exactly as an ordinary entry does; the id its reason names is checked for shape only, so a numeral of seven digits passes; a `commit` field compared against the `<commit>:` prefix is the lead's choice, not this increment's", () => {
    const range = [oid("a"), oid("b")].map((commit) => ({ path: `${commit}:${C3_TEST}`, text: ["// as committed", HISTORY_LINE].join(NEWLINE) }));
    expect(runSecretScan({ entries: range, allowlist: [HISTORY_ONLY], mode: "history" })).toMatchObject({ exitCode: 0, lines: [], allowlisted: 2 });
    expect(runSecretScan({ entries: range, allowlist: [ORDINARY], mode: "history" })).toMatchObject({ exitCode: 0, lines: [], allowlisted: 2 });
    expect(HISTORY_ONLY.reason).not.toMatch(/a{7}|b{7}/); // the reason names neither commit of the range, and the entry matched under both
    expect(allowlistProblems([{ ...HISTORY_ONLY, reason: "a fake connection string committed once and replaced at 1234567 by joined fragments, so it exists only in history" }])).toEqual([]);
    // the tree-mode half of the limit is case (l): neither commit's blob is in the tree, so the entry is never stale there
    expect(runSecretScan({ entries: [{ path: C3_TEST, text: "export {};" }], allowlist: [HISTORY_ONLY] })).toMatchObject({ exitCode: 0, lines: [], allowlisted: 0 });
  });
});
