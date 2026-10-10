/**
 * [B21 closeout, 2026-09-29] The closeout's tripwire (D21-27, OD-113; the D20-30 pattern of `b20-b4-withhold-proposals` case 8).
 * B21 put a flag-gated specialist orchestration ON TOP of the proven single-agent tool loop, so the standing statements that described
 * the chat surface as that loop alone - and the Retry that "always starts a NEW run" (since B21-E3 the same send resumes an offered
 * run) - are superseded IN PLACE with a dated note, never rewritten, and the flag-off truth is kept: with SIRKIT_ORCHESTRATION_ENABLED
 * off every message is the single-agent loop exactly as before. This suite pins that no production source states the old claim
 * uncorrected outside a small explicit allow-list (the flag-off statements B21 itself wrote), that each superseded header keeps the
 * flag-off truth beside its note, that the stale test titles the closeout retitled never come back, and that the page statements a
 * later increment made untrue carry the closeout's note in their own block. Files are read as text; nothing is written to disk.
 * [B21 closeout-1 fix] The adversarial review's findings, fixed test-first: every production note is pinned with what it keeps
 * (all sixteen) and every test and page keeps its number of notes; the next-line allowance covers exactly three wrapped statements;
 * a table row's note must be the first block after its table; a note that says the trace records a line states the recorder's
 * shared 32-warning bound; the route header's proposal bound is the scheduler's (proved by a run over the D2 fixtures, in memory);
 * and the closeout page (`closeout-statements.md`) records the B07.5..B16 stop-condition lines and the exports with no production
 * caller, each checked against the tree.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentRunEvent } from "@/app/lib/agent/contracts";
import { SPECIALIST_CAPS } from "../scheduler";
import { mergeSpecialistOutcome, specialistApprovalDecision } from "../merge";
import { mergeDeps } from "./_merge-fixtures";
import { TIER1_ARGS, runProposingDag } from "./_d2-fixtures";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
/** the closeout's dated note, as every superseded statement carries it */
const NOTE = "[superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): ";
/** the same-line note every retitled case carries */
const RETITLED = "[B21 closeout, 2026-09-29] retitled";
const SELF = "app/lib/agent/orchestration/__tests__/b21-closeout-statements.test.ts";
/** [B21 closeout-1 fix] the closeout's own page (the B21 README is the lead's, which points to it) */
const PAGE = "artifacts/ai-control-plane-b21/closeout-statements.md";

/** The old claim, in the vocabulary the closeout's sweep used. */
const OLD_CLAIM: ReadonlyArray<readonly [string, RegExp]> = [
  ["the chat surface as the single-agent loop alone", /single[- ]agent/gi],
  ["a Retry that always starts a NEW run", /[Rr]etry (?:always )?starts a NEW|Starts a NEW run|Retry is a new run/g],
  ["a promise of B21-E's that B21-E did not keep", /B21-E's strict result tool closes it|until B21-E gives it a policy input/g],
];

/** The flag-off statements B21 itself wrote: true as written, each allowed by its exact line text. */
const ALLOWED: ReadonlyArray<{ readonly path: string; readonly text: string; readonly why: string }> = [
  { path: "app/lib/agent/orchestration/role-tools.ts", text: "the existing single-agent set,", why: "B21-C: the coordinator's row IS the exposure list, the single-agent set unchanged" },
  { path: "app/lib/agent/orchestration/role-tools.ts", text: "coordinator: \"The existing single-agent set, unchanged:", why: "B21-C: ROLE_NOTES' coordinator note, the page's cell" },
  { path: "app/lib/agent/orchestration/role-tools.ts", text: "The coordinator's row holds the whole single-agent set", why: "B21-C: why a coordinator row may hold an execution" },
  { path: "app/lib/project/chat-run-view.ts", text: "(every single-agent run: its run log is unchanged)", why: "B21-E2: a run with no orchestration event keeps its run log" },
  { path: "app/lib/agent/fixture-agent-adapter.ts", text: "anything else is null (the single-agent scripts above answer)", why: "B21-F: the scripted coordinator's own instructions" },
  { path: "e2e-orchestration/specialist-orchestration.spec.ts", text: "the coordinator through its single-agent scripts", why: "B21-F2: the same scripts in the browser" },
];

/** [B21 closeout-1 fix] tests-3: the three statements wrapped over two lines, whose note sits on the NEXT line - the only lines the
 *  next-line allowance covers (any other claim line directly above a noted line is reported). */
const WRAPPED: ReadonlyArray<{ readonly path: string; readonly text: string }> = [
  { path: "app/lib/auth/route-handlers.ts", text: "The body-scope STREAMING agent boundary. The single agent" },
  { path: "app/lib/agent/run-consumer.ts", text: "current run's state. Retry always starts a NEW run (the injected" },
  { path: "app/page.tsx", text: "the owned Retry / Use-other-provider event; retry starts a NEW" },
];

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
/** [B21 closeout-1 fix] Every file under `dir` whose name `keep` admits, tests included. */
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
/** The lead's records (reserved files): they may quote a note; they are not notes. */
const LEAD_RECORDS = (path: string): boolean => path.startsWith("artifacts/remaining-builder-program/") || path === "artifacts/ai-control-plane-b21/README.md" || path === "artifacts/ai-control-plane-b21/discovery.md";
const testFiles = (): string[] => everyFile("app", (name) => SOURCE.test(name)).filter((path) => (path.includes("/__tests__/") || /\.test\.tsx?$/.test(path)) && path !== SELF);
const pages = (): string[] => everyFile("artifacts", (name) => name.endsWith(".md")).filter((path) => !LEAD_RECORDS(path));
const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

/** Every line that states the old claim with no closeout note on it (or, for a WRAPPED statement, on the line after it), outside the allow-list. */
function uncorrected(paths: readonly string[], text: (path: string) => string): string[] {
  const found: string[] = [];
  for (const path of paths) {
    const lines = text(path).split(NEWLINE);
    lines.forEach((line, index) => {
      for (const [claim, pattern] of OLD_CLAIM) {
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

/** The superseded statements and what each note must keep saying (the flag-off truth, or what replaced the claim) - [B21 closeout-1
 *  fix] tests-2: ALL sixteen production lines that carry the note (case 3 pins that no other production line does). */
const NOTED: ReadonlyArray<{ readonly path: string; readonly claim: string; readonly keeps: readonly string[] }> = [
  { path: "app/api/chat/route.ts", claim: " * over the provider-neutral single-agent tool loop", keeps: ["SIRKIT_ORCHESTRATION_ENABLED off - the default - every message runs this one loop exactly as before", `at most one inert sealed proposal per specialist run - one per attempt, at most ${SPECIALIST_CAPS.attemptsPerTask} attempts per task`, "a failed attempt's seal, which no merge judged, withholds the presentation", "at most ONE follow-up coordinator turn", "refused with no provider call"] },
  { path: "app/lib/agent/contracts.ts", claim: " * B09 — provider-neutral single-agent tool-loop contracts", keeps: ["off by default: off, every message is the single-agent loop exactly as before", "./orchestration/contracts.ts"] },
  { path: "app/lib/auth/route-handlers.ts", claim: " * chat surface ", keeps: ["sole adopter", "off by default, and off every stream is the single-agent loop's", "nothing in this boundary changed"] },
  { path: "app/lib/agent/run-consumer.ts", claim: " * `startNewRun` is the page's fresh `send()`", keeps: ["SIRKIT_ORCHESTRATION_ENABLED=1", "RESUMES an offered orchestrated run under its own run id", "every run with the flag off, is a new run"] },
  { path: "app/lib/agent/run-consumer.ts", claim: "  /** Starts a NEW run (fresh scope + fresh AbortController)", keeps: ["SIRKIT_ORCHESTRATION_ENABLED=1", "resumes an offered orchestrated run"] },
  { path: "app/page.tsx", claim: "        // send() run (fresh scope + fresh AbortController", keeps: ["with the orchestration flag on", "resumes an offered orchestrated run"] },
  { path: "app/api/chat/orchestration-runtime.ts", claim: "(Retry is a new run", keeps: ["resumes this stood-down run under its run id", "never re-running it"] },
  { path: "app/api/chat/orchestration-runtime.ts", claim: "B21-E's strict result tool closes it", keeps: ["it did not", "OD-108's deviation stands for the owner"] },
  { path: "app/lib/agent/orchestration/role-tools.ts", claim: "until B21-E gives it a policy input.\",", keeps: ["gave it none", "still holds no tool"] },
  { path: "app/api/chat/orchestration-runtime.ts", claim: "leaves the coordinator's own completed answer as the one terminal under a warning", keeps: ["since B21-E2 that line is a `degraded` event carrying the same sentence", "within the recorder's shared 32-warning bound", "trace_event_capacity_reached", "the stream always carries the line"] },
  { path: "app/api/chat/orchestration-runtime.ts", claim: "without consulting the router, and the route is byte-identical to HEAD", keeps: ["what stays byte-identical with the flag off is the route's stream", "where E4's first-turn gate never fires"] },
  { path: "app/lib/acquisition/admission-control.ts", claim: " * server, or one tool of an MCP server", keeps: ["since B21-E1, an LLM provider with an optional model"] },
  { path: "app/lib/acquisition/admission-control.ts", claim: "What a meter is for: a distributor source, an MCP server, or one tool of an MCP server", keeps: ["since B21-E1, an LLM provider"] },
  { path: "app/lib/agent/fixture-agent-adapter.ts", claim: "a plain reply that names the scripted instructions", keeps: ["since B21-F (D21-40)", "neither exists with SIRKIT_ORCHESTRATION_ENABLED off"] },
  { path: "app/lib/agent/orchestration/scheduler.ts", claim: "role whose set is empty is NOT RUN (`role_has_no_tools`, a visible warning", keeps: ["since B21-E2 a `degraded` event carrying the same line"] },
  { path: "app/lib/agent/orchestration/store.ts", claim: "The composition root installs the production factory", keeps: ["binds ITS OWN factory", "the setter below is a test seam"] },
];

/** [B21 closeout-1 fix] tests-2: every note the closeout wrote in a test file or a page, by file - a note reverted or dropped (or
 *  one added unregistered) changes a count. Production notes are NOTED's (case 3); the lead's records are not scanned. */
const NOTE_COUNTS: Readonly<Record<string, number>> = {
  "app/api/chat/__tests__/b21-b-chat-router.test.ts": 4,
  "app/api/chat/__tests__/b21-d2-chat-proposals.test.ts": 1,
  "app/api/chat/__tests__/b21-d3-chat-replacement.test.ts": 1,
  "app/lib/agent/orchestration/__tests__/_d2-fixtures.ts": 1,
  "app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts": 1,
  "app/lib/agent/orchestration/__tests__/b21-c-no-elevation.test.ts": 1,
  "app/lib/agent/orchestration/__tests__/b21-d2-proposing-roles.test.ts": 1,
  "app/lib/agent/orchestration/__tests__/b21-d2-provenance.test.ts": 1,
  "app/lib/agent/orchestration/__tests__/b21-d3-scenario17.test.ts": 1,
  "app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts": 1,
  "artifacts/ai-control-plane-b11-1/replay-capsule-validation.md": 1,
  "artifacts/ai-control-plane-b11-2/replay-context-schema.md": 1,
  "artifacts/ai-control-plane-b11-3/regression-matrix.md": 1,
  "artifacts/ai-control-plane-b11-4/regression-matrix.md": 1,
  "artifacts/ai-control-plane-b11-5/validation-summary.md": 1,
  "artifacts/ai-control-plane-b11-6/validation-summary.md": 1,
  "artifacts/ai-control-plane-b11-7/validation-summary.md": 1,
  "artifacts/ai-control-plane-b21/composer-and-first-turn.md": 1,
  "artifacts/ai-control-plane-b21/evaluation-matrix.md": 5,
  "artifacts/ai-control-plane-b21/merge-and-disagreement.md": 4,
  "artifacts/ai-control-plane-b21/orchestration-contracts.md": 1,
  "artifacts/ai-control-plane-b21/provider-routing-and-failure.md": 3,
  "artifacts/ai-control-plane-b21/run-events-and-trace.md": 3,
  "artifacts/ai-control-plane-b21/specialist-proposals.md": 5,
  "artifacts/ai-control-plane-b21/specialist-replacement.md": 6,
  "artifacts/ai-control-plane-b21/specialist-roles.md": 7,
  "artifacts/ai-control-plane-b21/task-complexity-router.md": 11,
};

/** The stale titles the closeout retitled (assertions unchanged): the retired wording, per file - it may never return in a title. */
const RETIRED_TITLES: ReadonlyArray<readonly [string, string]> = [
  ["app/lib/agent/__tests__/b09-2-closure.test.ts", "the exact static set (ELEVEN ids since B14)"],
  ["app/lib/agent/__tests__/b09-3-closure.test.ts", "the exact static set (ELEVEN distinct ids since B14)"],
  ["app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts", "the context is v2 and the capsule v3; older versions refuse EXPLICITLY"],
  ["app/lib/agent/__tests__/b11-4-capture-ownership.test.ts", "the wire contract did NOT change: the committed versions are unchanged"],
  ["app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts", "8. the nine B11-scanned files are byte-identical to HEAD and carry"],
  ["app/lib/agent/orchestration/__tests__/b21-e2b-page.test.ts", "(byte-identical to HEAD 41330e6), the provider literal"],
  ["app/lib/agent/orchestration/__tests__/b21-b-scheduler.test.ts", "three specialists run ONE AT A TIME in plan order"],
  ["app/lib/agent/orchestration/__tests__/b21-b-scheduler.test.ts", "runs task 2 at the next attempt and task 3;"],
  ["app/api/chat/__tests__/b21-b-chat-router.test.ts", "two further adapter runs, one at a time, each a read-only specialist prompt"],
  ["app/api/chat/__tests__/b21-b-chat-router.test.ts", "a REASON-ONLY warning says the orchestration record was unavailable"],
  ["app/api/chat/__tests__/b21-b-chat-router.test.ts", "one terminal under a warning that names the outage"],
  ["app/api/chat/__tests__/b21-b-chat-router.test.ts", "12. the specialist-results envelope is bounded and sanitized:"],
  ["app/api/chat/__tests__/b21-b-chat-router.test.ts", "the warning carries the closed reason only"],
  ["app/api/chat/__tests__/b21-b-chat-router.test.ts", "the stand-down warning names the failure"],
  ["app/api/chat/__tests__/b21-b-chat-router.test.ts", "the replacement DAG runs ALL THREE specialists through the production POST"],
  ["app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts", "(`role_has_no_tools`, a visible warning)"],
  ["app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts", "(a visible warning, never run with the coordinator's set)"],
  ["app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts", "is reported in the outcome and in the follow-up envelope"],
  ["app/api/chat/__tests__/b21-d-chat-merge.test.ts", "under a reason-only warning, no follow-up turn is made"],
  ["app/lib/agent/orchestration/__tests__/b21-d2-proposing-roles.test.ts", "SPECIALIST_PROPOSAL_TOOL_IDS is the Tier 1 edit and the bounded PCB edit - each"],
  ["app/lib/agent/orchestration/__tests__/b21-d2-proposing-roles.test.ts", "the circuit and schematic specialists the Tier 1 edit"],
  ["app/lib/agent/orchestration/__tests__/b21-d2-proposing-roles.test.ts", "a long-running proposal or the replacement - not in its view"],
  ["app/lib/agent/orchestration/__tests__/b21-d2-proposing-roles.test.ts", "it still refuses each of those five"],
  ["app/lib/agent/orchestration/__tests__/b21-d2-provenance.test.ts", "6. the replacement proposal stays DORMANT for specialists"],
  ["app/lib/agent/orchestration/__tests__/b21-d-merge.test.ts", "(the dormant OD-120 proposal tools stay dormant: no role gains a tool)"],
  ["app/lib/agent/orchestration/__tests__/b21-d-merge.test.ts", "never calls its artifacts verified or sealed"],
  ["app/lib/agent/orchestration/__tests__/b21-c-no-elevation.test.ts", "each loop runs over the read-only registry, the derived context and its own list"],
  ["app/lib/agent/orchestration/__tests__/b21-d3-replacement-roles.test.ts", "RECORDED: the composer sends the runbook sentence to the schematic editor"],
  ["app/lib/agent/orchestration/__tests__/b21-e4-first-turn.test.ts", "(the person's whole share of the provider's minute used up)"],
  ["app/api/chat/__tests__/b21-e1-chat-provider.test.ts", "the NEXT request's specialists make no call at all and it stands down visibly too"],
  ["app/api/chat/__tests__/b21-d3-chat-replacement.test.ts", "the route itself never resumes"],
  ["app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts", "(A's three, B's router and scheduler);"],
  ["app/lib/agent/orchestration/__tests__/b21-a-store.test.ts", "the capture and the redaction - never the durable runtime"],
  ["app/api/chat/__tests__/b21-d2-chat-proposals.test.ts", "(dormant: its sealer needs the pin-facts reads only the coordinator's gateway holds)"],
  ["app/lib/agent/orchestration/__tests__/b21-f-page.test.ts", "the spec's three tests send"],
  ["app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts", "the B21 suites ride ONE directory filter"], // [B21 closeout lead] the one the run left for the lead
];

/** The page statements a later increment made untrue: each carries the closeout's note in its own block (bullet, paragraph or row).
 *  [B21 closeout-1 fix] tests-4: an entry is a stale statement, never the note itself (the specialist-roles row's note is NOTED_ROWS'). */
const NOTED_PAGES: ReadonlyArray<readonly [string, string]> = [
  ["artifacts/ai-control-plane-b21/task-complexity-router.md", "own pairing, imported (C35)"],
  ["artifacts/ai-control-plane-b21/task-complexity-router.md", "one terminal event that reports the run's totals, no new run event"],
  ["artifacts/ai-control-plane-b21/task-complexity-router.md", "provider fallback stays human-driven and truthful"],
  ["artifacts/ai-control-plane-b21/task-complexity-router.md", "the per-task trace STOPPED (D21-41)"],
  ["artifacts/ai-control-plane-b21/task-complexity-router.md", "the first answer stands under a warning naming the stop"],
  ["artifacts/ai-control-plane-b21/task-complexity-router.md", "makes it a true tool result"],
  ["artifacts/ai-control-plane-b21/task-complexity-router.md", "The citation C45 stays as of this page's base."],
  ["artifacts/ai-control-plane-b21/task-complexity-router.md", "Stop mid-DAG; the envelope bounded and sanitized"],
  ["artifacts/ai-control-plane-b21/task-complexity-router.md", "case 17: all three specialists with the component authority loaded"],
  ["artifacts/ai-control-plane-b21/task-complexity-router.md", "| Retry is always a new run"],
  ["artifacts/ai-control-plane-b21/specialist-roles.md", "B21-E gives it a policy input)"],
  ["artifacts/ai-control-plane-b21/specialist-roles.md", "with a durable source returning U1's binding all three run through the production POST"],
  ["artifacts/ai-control-plane-b21/specialist-roles.md", "each loop runs over the read-only registry view and the derived context"],
  ["artifacts/ai-control-plane-b21/specialist-roles.md", "the envelope naming the missing evidence"],
  ["artifacts/ai-control-plane-b21/specialist-roles.md", "nothing in C depends on the answer."],
  ["artifacts/ai-control-plane-b21/specialist-roles.md", "envelope (`specialistResultsEnvelope`; [B21 D fix] superseded"],
  ["artifacts/ai-control-plane-b21/merge-and-disagreement.md", "the merge's lines ride the run log's"],
  ["artifacts/ai-control-plane-b21/merge-and-disagreement.md", "the mid-DAG commit stays B21-E/F's"],
  ["artifacts/ai-control-plane-b21/merge-and-disagreement.md", "(none can today:"],
  ["artifacts/ai-control-plane-b21/specialist-proposals.md", "it still refuses those five before"],
  ["artifacts/ai-control-plane-b21/specialist-proposals.md", "still carries its own seal; the route never replays"],
  ["artifacts/ai-control-plane-b21/specialist-proposals.md", "until B21-E's route-level resume (route case 7; `specialist-replacement.md`)."],
  ["artifacts/ai-control-plane-b21/specialist-proposals.md", "assertions as moved here."],
  ["artifacts/ai-control-plane-b21/specialist-proposals.md", "D's route suite header noted in place."],
  ["artifacts/ai-control-plane-b21/specialist-replacement.md", "is a data-flow design change for B21-E"],
  ["artifacts/ai-control-plane-b21/specialist-replacement.md", "Stale titles kept (case 1 \"three specialists\""],
  ["artifacts/ai-control-plane-b21/specialist-replacement.md", "its title (\"one grammar\") is kept for the closeout."],
  ["artifacts/ai-control-plane-b21/specialist-replacement.md", "that pin and the title move together at the closeout."],
  ["artifacts/ai-control-plane-b21/specialist-replacement.md", "Stale titles kept (\"stays DORMANT\", \"those five\")."],
  ["artifacts/ai-control-plane-b21/specialist-replacement.md", "a fresh run id per POST: the route never resumes"],
  ["artifacts/ai-control-plane-b21/orchestration-contracts.md", "orchestration modules' imports, not who imports them)."],
  ["artifacts/ai-control-plane-b21/provider-routing-and-failure.md", "this page keeps the E1 sections."],
  ["artifacts/ai-control-plane-b21/provider-routing-and-failure.md", "the rule is in place for B21-E2."],
  ["artifacts/ai-control-plane-b21/provider-routing-and-failure.md", "no composer routing (B21-E2, D21-38)."],
  ["artifacts/ai-control-plane-b21/run-events-and-trace.md", "B21-E3's (a later run)"],
  ["artifacts/ai-control-plane-b21/run-events-and-trace.md", "no first-turn breaker (B21-E3); no evaluations (B21-F)."],
  ["artifacts/ai-control-plane-b21/run-events-and-trace.md", "composer routing or first-turn breaker (B21-E3"],
  ["artifacts/ai-control-plane-b21/composer-and-first-turn.md", "for the closeout (the stale-title"],
  ["artifacts/ai-control-plane-b21/evaluation-matrix.md", "(the runtime's envelope headers, C30, C31"],
  ["artifacts/ai-control-plane-b21/evaluation-matrix.md", "above are the closeout's to retitle with OD-113's set (section 7)."],
  ["artifacts/ai-control-plane-b21/evaluation-matrix.md", "the title kept, never retitled, for the closeout's set)."],
  ["artifacts/ai-control-plane-b21/evaluation-matrix.md", "kept for the closeout's retitling (section 7's list)."],
  ["artifacts/ai-control-plane-b11-1/replay-capsule-validation.md", "(and is now v3 / context v2 after B11.3 made the board"],
  ["artifacts/ai-control-plane-b11-2/replay-context-schema.md", "(capsule `…capsule.v3`"],
  ["artifacts/ai-control-plane-b11-3/regression-matrix.md", "| Context v2 / capsule v3; older versions refuse explicitly"],
  ["artifacts/ai-control-plane-b11-4/regression-matrix.md", "| The wire contract did not change"],
  ["artifacts/ai-control-plane-b11-5/validation-summary.md", "## Versioning — capsule v3 / context v2 remain correct"],
  ["artifacts/ai-control-plane-b11-6/validation-summary.md", "## Versioning — capsule v3 / context v2 remain correct"],
  ["artifacts/ai-control-plane-b11-7/validation-summary.md", "## Versioning — capsule v3 / context v2 remain correct"],
];
/** [B21 closeout-1 fix] tests-4: a stale table row that must stay verbatim (the C page's row is pinned equal to `ROLE_NOTES`) carries
 *  its note as the FIRST block after its table - a blockquote naming the row - never anywhere else on the page. */
const NOTED_ROWS: ReadonlyArray<{ readonly path: string; readonly row: string; readonly names: string }> = [
  { path: "artifacts/ai-control-plane-b21/specialist-roles.md", row: "| `cost-latency-router` | `:827` | — | — | A policy role over the plan's caps and provider choice", names: "the `cost-latency-router` row's \"until B21-E gives it a policy input\"" },
];
/** The statement's own block: a table row is its line; otherwise up to a blank line (unless a quoted note follows it) or a bullet. */
function blockAt(text: string, index: number): string {
  const lineStart = text.lastIndexOf(NEWLINE, index) + 1;
  if (text.startsWith("|", lineStart)) return text.slice(index, text.indexOf(NEWLINE, index) < 0 ? undefined : text.indexOf(NEWLINE, index));
  const rest = text.slice(index);
  const end = /\n\n(?!> )|\n- |\n {2}- /.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}
/** The row's problems: it must occur once, verbatim, and the first non-blank line after its table must be the note naming it. */
function rowNoteProblems(entry: (typeof NOTED_ROWS)[number], text: string): string[] {
  const lines = text.split(NEWLINE);
  const at = lines.flatMap((line, index) => (line.startsWith(entry.row) ? [index] : []));
  if (at.length !== 1) return [`${entry.path}: the row occurs ${at.length} times`];
  let next = at[0]!;
  while (next < lines.length && lines[next]!.startsWith("|")) next += 1;
  while (next < lines.length && lines[next]!.trim() === "") next += 1;
  const quote = lines[next] ?? "";
  return quote.startsWith(`> ${NOTE}`) && quote.includes(entry.names) ? [] : [`${entry.path}: the first block after the row's table is not its note (line ${next + 1})`];
}

/** [B21 closeout-1 fix] regressions-1: each closeout note's own text, from its opening bracket to the bracket that closes it. */
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
const TRACE_CLAIM = /\btrace records?\b|\brecord(?:s|ed)? (?:it |them |the same line )?(?:on|in) the trace\b/i;
const TRACE_BOUND = "the recorder's shared 32-warning bound";

/** A page section: from its heading line to the next `## ` heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`${NEWLINE}${heading}`);
  if (start < 0) return "";
  const end = text.indexOf(`${NEWLINE}## `, start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}
/** [B21 closeout-1 fix] coverage-1: the stop-condition lines the page's dated note covers, as `path:line`. */
const STOP_LINE = /^- `(artifacts\/[^`]+\.md):(\d+)`/gm;
const STOP_NOTE = "[B21 closeout, 2026-09-29] The B07.5..B16 stop-condition lines";
/** [B21 closeout-1 fix] coverage-2: the page's record of the B21 exports with no production caller. */
const EXPORT_ROW = /^\| `(app\/[^`]+\.ts)` \| `([A-Za-z_][A-Za-z0-9_]*)` \| (test seam|test oracle|documentary table|vocabulary|type name) \| ([^|]+) \|$/gm;
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const sealsOf = (events: readonly AgentRunEvent[]): number => events.filter((event) => event.type === "proposal_ready" || event.type === "pcb_proposal_ready").length;

describe("[B21 closeout] the standing single-agent statements are superseded in place, and none comes back uncorrected (D21-27, OD-113)", () => {
  it("1. no production source states the old single-agent-only claim uncorrected: every line that describes the chat surface as the single-agent loop alone, a Retry that always starts a NEW run, or a B21-E promise B21-E did not keep carries the closeout's dated note on it (or, for one of three wrapped statements, on the line after it) - or is one of the flag-off statements B21 itself wrote (the allow-list)", () => {
    const paths = productionSources();
    expect(paths).toEqual(expect.arrayContaining(["app/api/chat/route.ts", "app/lib/agent/contracts.ts", "app/lib/auth/route-handlers.ts", "app/page.tsx", "e2e-orchestration/specialist-orchestration.spec.ts", "playwright.config.ts"]));
    expect(paths.filter((path) => path.includes("/__tests__/") || /\.test\.tsx?$/.test(path))).toEqual([]);
    expect(uncorrected(paths, read)).toEqual([]);
  });

  it("2. the allow-list is small, exact and cannot rot: six flag-off statements, each on exactly one line of its file, each still stating the claim (an entry that no longer does must leave the list) and none carrying a note; the next-line allowance covers exactly three wrapped statements, each followed by its note; and the scan bites - the same statement without its note, an allowed line moved to another file, or a fresh claim written directly above an UNRELATED noted line is reported", () => {
    expect(ALLOWED).toHaveLength(6);
    for (const entry of ALLOWED) {
      const lines = read(entry.path).split(NEWLINE).filter((line) => line.includes(entry.text));
      expect(lines, `${entry.path}: ${entry.text}`).toHaveLength(1);
      expect(OLD_CLAIM.some(([, pattern]) => new RegExp(pattern.source, pattern.flags).test(lines[0]!)), entry.text).toBe(true);
      expect(lines[0], entry.text).not.toContain(NOTE);
      expect(entry.why.length, entry.text).toBeGreaterThan(20);
    }
    expect(WRAPPED).toHaveLength(3);
    for (const entry of WRAPPED) {
      const lines = read(entry.path).split(NEWLINE);
      const at = lines.flatMap((line, index) => (line.includes(entry.text) ? [index] : []));
      expect(at, `${entry.path}: ${entry.text}`).toHaveLength(1);
      expect(lines[at[0]!], entry.text).not.toContain(NOTE);
      expect(lines[at[0]! + 1], entry.text).toContain(NOTE);
    }
    const unnoted = (path: string): string => read(path).split(NEWLINE).map((line) => (line.includes(NOTE) ? line.slice(0, line.indexOf(NOTE)) : line)).join(NEWLINE);
    expect(uncorrected(["app/api/chat/route.ts"], unnoted)).toEqual(["app/api/chat/route.ts:3 (the chat surface as the single-agent loop alone)"]);
    expect(uncorrected(["app/lib/agent/run-consumer.ts"], unnoted)).toEqual(["app/lib/agent/run-consumer.ts:9 (a Retry that always starts a NEW run)", "app/lib/agent/run-consumer.ts:37 (a Retry that always starts a NEW run)"]);
    expect(uncorrected(["app/lib/agent/moved.ts"], () => read("app/lib/project/chat-run-view.ts"))).toHaveLength(1);
    // [B21 closeout-1 fix] tests-3: a new claim on the line directly above store.ts's noted JSDoc is NOT excused by that note
    const store = read("app/lib/agent/orchestration/store.ts").split(NEWLINE);
    const noted = store.findIndex((line) => line.includes(NOTE));
    expect(noted).toBeGreaterThan(0);
    const injected = store.map((line, index) => (index === noted - 1 ? "// the chat surface is the single-agent loop alone" : line)).join(NEWLINE);
    expect(uncorrected(["app/lib/agent/orchestration/store.ts"], () => injected)).toEqual([`app/lib/agent/orchestration/store.ts:${noted} (the chat surface as the single-agent loop alone)`]);
  });

  it("3. each superseded statement keeps its own words and its note says the truth beside it: the flag-off single-agent loop exactly as before, what the flag adds, and what replaced a promise - for ALL sixteen production lines that carry the note, and no other production line carries one; route.ts's 'No silent cross-provider fallback exists;' stands un-noted (three B21 pages pin it as standing)", () => {
    const matched = new Set<string>();
    for (const noted of NOTED) {
      const lines = read(noted.path).split(NEWLINE).flatMap((line, index) => (line.includes(noted.claim) && line.includes(NOTE) ? [[index, line] as const] : []));
      expect(lines, `${noted.path}: ${noted.claim}`).toHaveLength(1);
      matched.add(`${noted.path}:${lines[0]![0] + 1}`);
      const note = lines[0]![1].slice(lines[0]![1].indexOf(NOTE));
      for (const kept of noted.keeps) expect(note, `${noted.path}: ${kept}`).toContain(kept);
    }
    expect(NOTED).toHaveLength(16);
    const everyNoted = productionSources().flatMap((path) => read(path).split(NEWLINE).flatMap((line, index) => (line.includes(NOTE) ? [`${path}:${index + 1}`] : [])));
    expect(everyNoted.sort()).toEqual([...matched].sort());
    const standing = read("app/api/chat/route.ts").split(NEWLINE).filter((line) => line.includes("No silent cross-provider fallback exists;"));
    expect(standing).toEqual([" * (existing classification). No silent cross-provider fallback exists;"]);
  });

  it("4. the stale test titles the closeout retitled never come back: none of the retired wordings is in any title of its suite, and every such suite carries the closeout's same-line retitle note - 36 retitled cases in all, the `it(` counts unchanged", () => {
    const titleLines = (path: string): string[] => read(path).split(NEWLINE).filter((line) => /^\s*it\(/.test(line));
    for (const [path, retired] of RETIRED_TITLES) {
      expect(titleLines(path).filter((line) => line.slice(0, line.indexOf("\", ") < 0 ? undefined : line.indexOf("\", ")).includes(retired)), `${path}: ${retired}`).toEqual([]);
      expect(titleLines(path).some((line) => line.includes(RETITLED)), path).toBe(true);
    }
    const suites = [...new Set(RETIRED_TITLES.map(([path]) => path))];
    expect(suites.reduce((count, path) => count + titleLines(path).filter((line) => line.includes(RETITLED)).length, 0)).toBe(36);
  });

  it("5. every page statement a later increment made untrue carries the closeout's note in its own block (bullet, paragraph or table row) - the B21 pages' and the B11 pages' that still named the capsule v3; no entry is a note itself; and a row that must stay verbatim has its note as the first block after its table", () => {
    const problems: string[] = [];
    for (const [path, statement] of NOTED_PAGES) {
      if (statement.includes("[superseded 2026-09-29")) problems.push(`${path}: the entry is a note, not a stale statement`);
      const text = read(path);
      const count = occurrences(text, statement);
      if (count !== 1) problems.push(`${path}: ${statement} occurs ${count} times`);
      else if (!blockAt(text, text.indexOf(statement)).includes(NOTE)) problems.push(`${path}: ${statement} carries no closeout note in its block`);
    }
    for (const entry of NOTED_ROWS) problems.push(...rowNoteProblems(entry, read(entry.path)));
    expect(problems).toEqual([]);
    expect([NOTED_PAGES.length, NOTED_ROWS.length]).toEqual([49, 1]);
    // the row check bites: the same note moved to the end of the page is reported
    const row = NOTED_ROWS[0]!;
    const lines = read(row.path).split(NEWLINE);
    const quote = lines.findIndex((line) => line.startsWith(`> ${NOTE}`) && line.includes(row.names));
    const moved = [...lines.slice(0, quote), ...lines.slice(quote + 2), "", lines[quote]!].join(NEWLINE);
    expect(rowNoteProblems(row, moved)).toHaveLength(1);
  });

  it("6. [B21 closeout-1 fix] every note the closeout wrote in a test file or a page stays: each file carries its pinned number of notes and no other file carries one (a reverted or dropped note is reported; the lead's reserved records are not scanned)", () => {
    const counts: Record<string, number> = {};
    for (const path of [...testFiles(), ...pages()]) {
      const count = occurrences(read(path), NOTE);
      if (count > 0) counts[path] = count;
    }
    expect(counts).toEqual(NOTE_COUNTS);
    expect(Object.values(NOTE_COUNTS).reduce((sum, count) => sum + count, 0)).toBe(13 + 53);
  });

  it("7. [B21 closeout-1 fix] a closeout note that says the trace records a line states the recorder's SHARED 32-warning bound beside it (TRACE_BOUNDS.maxWarnings: past it the trace records `trace_event_capacity_reached`, while the stream always carries the line) - in production, tests and pages", () => {
    const unbounded: string[] = [];
    let claims = 0;
    for (const path of [...productionSources(), ...testFiles(), ...pages()]) {
      for (const note of notesIn(read(path))) {
        if (!TRACE_CLAIM.test(note)) continue;
        claims += 1;
        if (!note.includes(TRACE_BOUND) || !note.includes("trace_event_capacity_reached")) unbounded.push(`${path}: ${note.slice(NOTE.length, NOTE.length + 80)}`);
      }
    }
    expect(unbounded).toEqual([]);
    expect(claims).toBe(2);
  });

  it("8. [B21 closeout-1 fix] the route header's proposal bound is the scheduler's: ONE inert sealed proposal per specialist RUN - the loop's single-flight starts afresh with each attempt and a task has SPECIALIST_CAPS.attemptsPerTask attempts - so a circuit specialist that seals and then fails retryably seals again on its retry: two sealed artifacts from one task, the failed attempt's unjudged seal withholding the presentation (`incomplete`); route.ts's note states that bound, not one per specialist", async () => {
    expect([SPECIALIST_CAPS.maxSpecialists, SPECIALIST_CAPS.attemptsPerTask]).toEqual([4, 2]);
    const run = await runProposingDag(["circuit-topology"], { "circuit-topology": { call: { toolId: "sirkit.schematic.propose-tier1-edit", args: TIER1_ARGS("10k") }, failContinue: { reason: "rate_limit", times: 1 } } }, { runId: "run-b21-closeout-two-seals" });
    expect(run.loops.map((loop) => sealsOf(loop.events))).toEqual([1, 1]);
    expect(run.outcome.tasks.map((task) => [task.attempt, task.status, task.sealedArtifactDigests?.length ?? 0])).toEqual([[0, "escalated", 1], [1, "accepted", 1]]);
    const judged = await mergeSpecialistOutcome({ runId: run.scope.runId, context: run.context, outcome: run.outcome }, mergeDeps(run.store, { now: () => Date.now() }));
    if (judged.kind !== "merged") throw new Error(`the merge refused: ${judged.reason}`);
    expect(specialistApprovalDecision(judged, { coordinatorSealed: false, outcome: run.outcome }).outcome).toBe("incomplete");
    const header = read("app/api/chat/route.ts").split(NEWLINE)[2]!;
    expect(header).toContain(`at most four zero-authority specialists one at a time (reads, and at most one inert sealed proposal per specialist run - one per attempt, at most ${SPECIALIST_CAPS.attemptsPerTask} attempts per task`);
    expect(header).not.toContain("inert sealed proposal each");
  });

  it("9. [B21 closeout-1 fix] the closeout page's dated note covers the B07.5..B16 stop-condition lines (D21-27's artifact half): 73 lines, each still listing multi-agent work or agent orchestration as not started, none rewritten or noted in place, and the note keeps the flag-off truth", () => {
    const stops = section(read(PAGE), "## 2. ");
    expect(stops).toContain(STOP_NOTE);
    for (const kept of ["are true for their own chapters and stay as written", "SIRKIT_ORCHESTRATION_ENABLED=1", "It is off by default: with the flag off, every chat message runs the single-agent loop"]) expect(stops, kept).toContain(kept);
    const listed = [...stops.matchAll(STOP_LINE)].map((match) => [match[1]!, Number(match[2])] as const);
    expect(listed).toHaveLength(73);
    expect(new Set(listed.map(([path, line]) => `${path}:${line}`)).size).toBe(73);
    for (const [path, line] of listed) {
      expect(path.startsWith("artifacts/ai-control-plane-b21/") || path.startsWith("artifacts/ai-control-plane-b11"), path).toBe(false);
      const text = read(path).split(NEWLINE)[line - 1] ?? "";
      expect(text, `${path}:${line}`).toMatch(/multi-agent|agent orchestration/);
      expect(text, `${path}:${line}`).not.toContain("[superseded");
    }
  });

  it("10. [B21 closeout-1 fix] the closeout page records every B21 export with no production caller and why it stays (D21-36's other half): each is still exported by its module, referenced by no other production source, and used in its own module only as the record says - a test seam, test oracle, documentary table or type name only at its declaration, a vocabulary only through `typeof`", () => {
    const rows = [...section(read(PAGE), "## 3. ").matchAll(EXPORT_ROW)].map((match) => ({ module: match[1]!, name: match[2]!, kind: match[3]!, why: match[4]!.trim() }));
    expect(rows).toHaveLength(31); // [B24-Fa, 2026-10-10] reviewed pin move (OD-220, OD-240): 34 -> 31 - MERGE_RULES, FULL_CIRCUIT_TRIM and ROUTER_RULES are read since B24-F by scripts/generate-b24-maps.ts (the agent graph), a production caller, so their three rows on closeout-statements.md section 3.2 carry a dated in-place note and no longer parse as a row
    expect(new Set(rows.map((row) => row.name)).size).toBe(31); // [B24-Fa, 2026-10-10] reviewed pin move (OD-220, OD-240): 34 -> 31, the same three rows
    const production = productionSources().map((path) => [path, stripComments(read(path))] as const);
    const problems: string[] = [];
    for (const row of rows) {
      const word = new RegExp(`\\b${row.name}\\b`, "g");
      const named = new RegExp(`\\b${row.name}\\b`);
      const own = production.find(([path]) => path === row.module)?.[1] ?? "";
      if (!new RegExp(`export (?:const|function|type|interface) ${row.name}\\b`).test(own)) problems.push(`${row.module}: ${row.name} is not exported`);
      for (const [path, text] of production) if (path !== row.module && named.test(text)) problems.push(`${path} references ${row.name}`);
      const uses = own.match(word)?.length ?? 0;
      const typed = own.match(new RegExp(`typeof ${row.name}\\b`, "g"))?.length ?? 0;
      if (row.kind === "vocabulary" ? typed < 1 || uses !== typed + 1 : uses !== 1) problems.push(`${row.module}: ${row.name} used ${uses} times (${typed} as typeof) - not a ${row.kind}`);
      if (row.why.length < 20) problems.push(`${row.name}: no reason`);
    }
    expect(problems).toEqual([]);
    expect(stripComments(read("app/api/chat/orchestration-runtime.ts"))).not.toMatch(/\bspecialistResultsEnvelope\b/);
  });
});
