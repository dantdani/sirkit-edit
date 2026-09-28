/**
 * [B21 E2b] E2's second run on the page `run-events-and-trace.md`, pinned by content: section 3 names the stop AND the application
 * and keeps the stop's record whole; its subsections 3.2 to 3.7 hold the lead's reading of OD-112, the block (its table IS the code's
 * closed keys, the verdicts and the attributed kinds ARE the code's lists, the index bound IS `MAX_TASK_INDEX`), the task identity's
 * four functions, the book, the durable trace record (its keys ARE a real record's), where each string of a per-task trace comes from
 * (every top-level key of a real finalized trace listed) and what stands unchanged (the hashes quoted ARE the files'); every E2b
 * citation resolves by content exactly once and, for every production file E2b changed, on the line it states; every E2b suite row
 * carries its real `it(` count and the suites ride the orchestration directory filter; what E2's second run does NOT do is stated;
 * and E2's second run's texts for the lead follow the first run's in full. No network, no model.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorOccurrences, pageCitations } from "@/app/lib/mcp/server/__tests__/_citations";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { AgentTraceRecorder, InMemoryTraceSink } from "@/app/lib/agent/trace-recorder";
import { ORCHESTRATION_RUN_EVENT_TYPES } from "@/app/lib/agent/contracts";
import { B11_SCANNED_FILES } from "../tripwires";
import {
  DurableOrchestrationTraceStore, MAX_TASK_INDEX, ORCHESTRATION_TRACE_AGGREGATE_TYPE, ORCHESTRATION_TRACE_ATTRIBUTED_KINDS, ORCHESTRATION_TRACE_BLOCK_KEYS, ORCHESTRATION_TRACE_BLOCK_OPTIONAL_KEYS,
  ORCHESTRATION_TRACE_RECORD_SCHEMA, ORCHESTRATION_TRACE_SCHEMA, TRACE_BLOCK_DECISIONS, attributeSpecialistTrace, specialistTraceRunId,
} from "../trace-attribution";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b21/run-events-and-trace.md";
/** E2's first run's citations run C1..C66; E2's second run's follow */
const FIRST_RUN_CITATIONS = 66;
/** every production file E2b changed: its cited lines must be current */
const CHANGED_E2B = ["app/lib/agent/orchestration/trace-attribution.ts", "app/lib/agent/orchestration/store.ts", "app/api/chat/orchestration-runtime.ts"];
const SUITES_E2B = [
  "app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-e2b-task-identity.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-e2b-page.test.ts",
];
const ROUTE_SUITE = "app/api/chat/__tests__/b21-e2-chat-events.test.ts";
/** every file E2b wrote or changed (the page's own rows included) */
const WRITTEN = [
  ...CHANGED_E2B, ...SUITES_E2B, ROUTE_SUITE, PAGE, "app/lib/agent/orchestration/__tests__/_e2-fixtures.ts", "app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts",
  "app/lib/agent/orchestration/__tests__/b21-a-store.test.ts", "app/lib/agent/orchestration/__tests__/b21-e2-page.test.ts", "artifacts/ai-control-plane-b21/orchestration-contracts.md",
];
const quoted = (value: string): string => `\`${value}\``;
const ticks = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
const cells = (row: string): string[] => row.split(" | ").map((cell) => cell.replace(/^\| /, "").replace(/ \|$/, ""));
const flat = (text: string): string => text.replace(/\s+/g, " ");
const section = (page: string, from: number): string => page.slice(page.indexOf(`## ${from}. `), page.indexOf(`## ${from + 1}. `) > 0 ? page.indexOf(`## ${from + 1}. `) : undefined);
const subsection = (page: string, id: string): string => { const text = section(page, 3); const start = text.indexOf(`### ${id} `); const next = text.indexOf(NEWLINE + "### ", start + 1); return start < 0 ? "" : text.slice(start, next > 0 ? next : undefined); };
const sha = (path: string): string => createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");
const TRACE_SCOPE = { tenantId: "tenant-page", projectId: "project-page", branchId: "main" };
/** a real finalized per-task trace (a step, a read, a closing step) and its document through the REAL cascade */
function realDocument() {
  const recorder = new AgentTraceRecorder({ runId: specialistTraceRunId("run-page", 1, "circuit-topology"), traceId: "trace-page", provider: "openai", promptVersion: "1.4.0", promptDigest: "eng1-0000000000000001", registryDigest: "eng1-0000000000000002", scope: TRACE_SCOPE, contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null } }, new InMemoryTraceSink(), () => 0);
  recorder.recordRunStarted();
  recorder.recordStep({ model: "gpt-fake", usage: { inputTokens: 1, outputTokens: 1 }, toolCallCount: 1 });
  recorder.recordTool({ callId: "call-1", toolId: "sirkit.validation.connectivity-verify", version: "1.0.0", operationClass: "read", args: {}, outcomeClass: "read", status: "succeeded", verification: null, output: { ok: true } });
  recorder.recordStep({ model: "gpt-fake", usage: { inputTokens: 1, outputTokens: 1 }, toolCallCount: 0 });
  recorder.recordTerminal("completed", null);
  const attributed = attributeSpecialistTrace(recorder.finalize({ outcome: "completed", failureReason: null }), { taskIndex: 1, role: "circuit-topology", parentRunId: "run-page" }, "accepted");
  if (!attributed.ok) throw new Error(attributed.detail);
  return attributed.document;
}

describe("[B21 E2b] E2's second run on the run-events-and-trace page", () => {
  it("1. section 3 names the stop AND the application, keeps the stop's record whole as 3.1 and holds 3.2 to 3.7 in order; the title and section 0 say the block was applied; the lead's reading is quoted (the run id `<runId>:<n>-<role>`, the INDEX and role, the task id reconstructed, no rule narrowed) with the `[B21 E2b]` tag", () => {
    const page = read(PAGE);
    expect(page.split(NEWLINE)[0]).toContain("E2's second run: the trace block applied");
    expect(page).toMatch(/^## 3\. The trace block \(OD-112\): STOPPED - D21-41, then APPLIED \(B21-E2 2\/2\)$/m);
    const three = section(page, 3);
    expect([...three.matchAll(/^### (3\.\d) /gm)].map((match) => match[1])).toEqual(["3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7"]);
    for (const claim of ["**What was asked.**", "**What stops it.**", "`trace.runId: contains secret-shaped content`", "**UNVERIFIED**", "`held.sha256`"]) expect(subsection(page, "3.1"), claim).toContain(claim);
    const reading = flat(subsection(page, "3.2"));
    for (const claim of ["`<runId>:<n>-<role>`", "INDEX", "never the literal task id", "`task-<n>-<role>`", "reconstructed", "no rule is narrowed", "[B21 E2b]"]) expect(reading, claim).toContain(claim);
    expect(flat(section(page, 0))).toContain("**The trace block (OD-112 as the lead read it; section 3.2 onward): APPLIED by E2's second run (B21-E2 2/2).**");
  });

  it("2. the block table IS the code's closed keys then its one optional key, the verdicts and the attributed kinds ARE the code's lists, the index bound IS MAX_TASK_INDEX, the four identity functions and the schemas are quoted; the durable record's keys quoted ARE a real record's keys (read back through the REAL store) and name no task id", async () => {
    const page = read(PAGE);
    const block = subsection(page, "3.3");
    const rows = block.split(NEWLINE).filter((line) => /^\| `[A-Za-z]+`/.test(line)).map(cells);
    expect(rows.map((row) => ticks(row[0]!)[0])).toEqual([...ORCHESTRATION_TRACE_BLOCK_KEYS, ...ORCHESTRATION_TRACE_BLOCK_OPTIONAL_KEYS]);
    const text = flat(block);
    expect(text).toContain(TRACE_BLOCK_DECISIONS.map(quoted).join(", "));
    expect(text).toContain(ORCHESTRATION_TRACE_ATTRIBUTED_KINDS.map(quoted).join(" and "));
    expect(text).toContain(`\`MAX_TASK_INDEX\` (${MAX_TASK_INDEX})`);
    for (const name of ["specialistTaskId", "specialistTaskIdentity", "specialistTraceRunId", "specialistTraceIdentity", "orchestrationBlockIssue", "validateOrchestrationTrace", "attributeSpecialistTrace", ORCHESTRATION_TRACE_SCHEMA]) expect(text, name).toContain(quoted(name));
    const repository = new InMemoryDurableWorkflowRepository();
    const store = new DurableOrchestrationTraceStore(repository);
    expect(await store.append({ scope: TRACE_SCOPE, document: realDocument(), at: "2026-09-27T12:00:00.000Z" })).toMatchObject({ ok: true });
    const record = (await store.history(TRACE_SCOPE, specialistTraceRunId("run-page", 1, "circuit-topology")))[0]!.record;
    const durable = flat(subsection(page, "3.5"));
    expect(durable).toContain(Object.keys(record).map(quoted).join(", "));
    expect(Object.keys(record)).not.toContain("taskId");
    for (const value of [ORCHESTRATION_TRACE_AGGREGATE_TYPE, ORCHESTRATION_TRACE_RECORD_SCHEMA, "orchestrationTraceStoreOf", "AGENT_ORCHESTRATION_TRACE_MISMATCH"]) expect(durable, value).toContain(quoted(value));
  });

  it("3. where each string of a per-task trace comes from: the table of 3.6 lists every top-level key of a real finalized trace and the attribution, each with its origin; the whole-document proof and the inputs that DID carry the task id are named", () => {
    const page = read(PAGE);
    const origin = subsection(page, "3.6");
    const listed = new Set(origin.split(NEWLINE).filter((line) => line.startsWith("| `")).flatMap((line) => ticks(cells(line)[0]!)));
    const document = realDocument();
    for (const key of Object.keys(document.trace)) expect(listed.has(key), key).toBe(true);
    expect(listed.has("attribution")).toBe(true);
    const text = flat(origin);
    for (const claim of ["`Task: <taskId>`", "the prompt digest", "`b21-e2b-task-identity.test.ts` case 3", "`ta[redacted]`", "no string or key"]) expect(text, claim).toContain(claim);
  });

  it("4. what stands unchanged is stated and TRUE: the hashes 3.7 quotes for the nine B11-scanned files and redaction.ts ARE the files' (byte-identical to HEAD 41330e6), the provider literal and the five pinned run events stand, and every committed pin E2b left green is named", () => { // [B21 F, 2026-09-28] E2b's title: since B21-F 3.7's replay-capsule hash is F's (its dated note), the other eight and redaction.ts 41330e6's; the closeout retitles it
    const page = read(PAGE);
    const unchanged = flat(subsection(page, "3.7"));
    for (const file of [...B11_SCANNED_FILES, "app/lib/agent/redaction.ts"]) {
      expect(unchanged, file).toContain(quoted(file));
      expect(unchanged, file).toContain(sha(file));
    }
    expect(unchanged).toContain("`provider: \"openai\" | \"anthropic\";`");
    expect(unchanged).toContain(ORCHESTRATION_RUN_EVENT_TYPES.map(quoted).join(", "));
    for (const pin of ["`b20-a4-trace-attribution.test.ts` case 7", "`b20-b2-import-gates.test.ts`", "`b11-1-trace-integrity.test.ts`", "`b11-trace-replay-evaluation.test.ts`", "`b18-b-loop-execution.test.ts`", "`b21-a-import-gates.test.ts` case 4", "`b21-d3-pin-facts.test.ts` case 1"]) expect(unchanged, pin).toContain(pin);
  });

  it("5. every E2b citation (after the first run's C1..C66) resolves by content exactly once and, for every production file E2b changed, on the line it states; each changed file is cited; the E2b suites and the route suite carry their real `it(` counts; the E2b suites ride the orchestration directory filter with no explicit CI entry (the redundancy rule) and the route suite keeps its one explicit entry", () => {
    const page = read(PAGE);
    const citations = pageCitations(page);
    const second = citations.slice(FIRST_RUN_CITATIONS);
    expect(second.length).toBeGreaterThanOrEqual(15);
    expect(second[0]!.id).toBe(`C${FIRST_RUN_CITATIONS + 1}`);
    expect(second.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => citation.id)).toEqual([]);
    for (const path of CHANGED_E2B) expect(second.some((citation) => citation.path === path), path).toBe(true);
    const stale = citations.filter((citation) => CHANGED_E2B.includes(citation.path) && !(read(citation.path).split(NEWLINE)[citation.line - 1] ?? "").includes(citation.anchor)).map((citation) => `${citation.id} ${citation.path}:${citation.line}`);
    expect(stale).toEqual([]);
    const rows = new Map([...page.matchAll(/^\| `((?:app|e2e)\/[^`]+\.(?:test|spec)\.tsx?)` \| (\d+) \|/gm)].map((row) => [row[1]!, Number(row[2])]));
    for (const suite of [...SUITES_E2B, ROUTE_SUITE]) {
      expect(rows.has(suite), suite).toBe(true);
      expect((read(suite).match(/^\s*it\(/gm) ?? []).length, `${suite} it( blocks`).toBe(rows.get(suite));
    }
    const workflow = read(".github/workflows/deterministic-manufacturing.yml");
    expect(workflow).toMatch(/^ {10}app\/lib\/agent\/orchestration\/__tests__$/m);
    for (const suite of SUITES_E2B) expect(workflow, suite).not.toContain(suite);
    expect(workflow.match(/b21-e2-chat-events\.test\.ts/g)).toHaveLength(1);
  });

  it("6. what E2's second run does NOT do is stated in section 4, and E2's second run's texts for the lead follow the first run's in full: OD-112 as applied (2/2) with the lead's reading and the owner's remaining options, the README row B21-E2 (2/2), the ledger paragraph, PROGRAM_STATE naming B21-E3 next, the discovery closure clauses quoting each defect's title VERBATIM from discovery.md (D21-11's trace half, D21-3's calls half, D21-41), the section-10 lines and the report line", () => {
    const page = read(PAGE);
    const not = flat(section(page, 4)).toLowerCase();
    for (const claim of ["what e2's second run does not do", "no edit to the nine b11-scanned files", "no change to `redaction.ts`", "no new run-event type", "no ui change", "no route, descriptor or request-key change", "165 = 162 canonical + 3 factories + 0 raw", "no reserved-file edit", "no route-level resume"]) expect(not, claim).toContain(claim);
    const lead = section(page, 6);
    const second = lead.slice(lead.indexOf("### E2's second run (2/2): the reserved texts"));
    expect(lead.indexOf("### E2's second run (2/2): the reserved texts")).toBeGreaterThan(lead.indexOf("### Discovery closure clauses"));
    expect(second).toMatch(/^### OD-112 .*as applied \(B21-E2 2\/2, 2026-09-27\)$/m);
    for (const claim of ["`<runId>:<n>-<role>`", "(A) anchor", "(C) a task-id grammar", "(D) editing the scanned validator"]) expect(second, claim).toContain(claim);
    expect(second).toMatch(/^\| B21-E2 \(2\/2\) /m);
    expect(second).toMatch(/^### B21-E2 \(2\/2\) — /m);
    expect(flat(second)).toContain("B21-E3");
    const discovery = flat(read("artifacts/ai-control-plane-b21/discovery.md"));
    const text = flat(second);
    for (const [defect, verdict] of [["D21-11", "the trace half CLOSED by B21-E2 (2/2)"], ["D21-3", "the calls half CLOSED by B21-E2 (2/2)"], ["D21-41", "CLOSED by B21-E2 (2/2)"]] as const) {
      const title = new RegExp(`\\*\\*(${defect} — [^*]+)\\*\\*`).exec(discovery)?.[1];
      expect(title, defect).toBeTruthy();
      expect(text, defect).toContain(`**${title!}** — ${verdict}`);
    }
    expect(second).toContain("B21-E2, run 2 of 2");
    expect(second).toContain("MULTI-AGENT STATUS");
  });

  it("7. every file E2b wrote or changed is LF-only with no raw control, format or line-separator character (such a character in a test is written with String.fromCharCode), and names no credential-shaped literal", () => {
    const codes = [...Array.from({ length: 32 }, (_, code) => code).filter((code) => code !== 9 && code !== 10), 0x7f, 0x2028, 0x2029];
    const forbidden = new RegExp(`[${codes.map((code) => String.fromCharCode(code)).join("")}]`);
    for (const file of WRITTEN) {
      const text = readFileSync(join(ROOT, file), "utf8");
      expect(forbidden.test(text), file).toBe(false);
      expect(text, file).not.toMatch(/\bsk-(?:ant-)?[A-Za-z0-9]{20,}/);
    }
  });

  it("8. [B21 E2b fix] the page and its lead texts say what the adversarial review found and how each finding was answered: every confirmed finding has its row; 3.4 says a document with no step or tool invocation carries no verdict and no model, a document closed at a provider switch carries none, the switch IS reachable (the earlier 'not reachable' claim gone), the unrecorded line is bounded by construction and a call refused before it ran is a closed line on its task's document; 3.3 and 3.5 state the whole-document text rule and the scope binding; the lead texts quote D21-12's title VERBATIM with its addendum, and the D21-11 clause says what a document with no step carries", () => {
    const page = read(PAGE);
    const review = flat(page.slice(page.indexOf("**The review's findings (E2b)**"), page.indexOf("## 6. ")));
    expect(page.indexOf("**The review's findings (E2b)**")).toBeGreaterThan(page.indexOf("**Gates (E2b)**"));
    for (const id of ["regressions-1", "regressions-2", "regressions-3", "security-1", "security-3", "coverage-1", "coverage-2", "coverage-3", "tests-1", "tests-2", "tests-3", "tests-4", "tests-5"]) expect(review, id).toContain(`\`${id}\``);
    const book = flat(subsection(page, "3.4"));
    for (const claim of ["carries no verdict", "names no model", "closed at the switch", "the scheduler routes every attempt again", "`DEFAULT_REDACTION_CHARS`", "`+N more`", "`refusedCallLine`"]) expect(book, claim).toContain(claim);
    for (const gone of ["not reachable today", "`provider_switched`", "every document is closed with the verdict of its task's LAST outcome"]) expect(book, gone).not.toContain(gone);
    const block = flat(subsection(page, "3.3"));
    for (const claim of ["`forbiddenTextPath`", "`cleanTraceText`", "`trace_input_normalized`", "a lone surrogate"]) expect(block, claim).toContain(claim);
    const durable = flat(subsection(page, "3.5"));
    for (const claim of ["`sameTraceScope`", "names another scope"]) expect(durable, claim).toContain(claim);
    expect(flat(subsection(page, "3.6"))).toContain("`refusedCallLine`");
    const lead = flat(section(page, 6));
    const second = lead.slice(lead.indexOf("### E2's second run (2/2): the reserved texts"));
    const discovery = flat(read("artifacts/ai-control-plane-b21/discovery.md"));
    const title = /\*\*(D21-12 — [^*]+)\*\*/.exec(discovery)?.[1];
    expect(title).toMatch(/^D21-12 — Pre-invocation refusals are untraced/);
    expect(second).toContain(`**${title!}** — addendum by B21-E2 (2/2)`);
    expect(second).toContain("a document with no step or tool invocation names no model and carries no verdict");
  });
});
