/**
 * [B21 E2] The run view over the additive events (OD-126, OD-127): `reduceRunView` gains PURE counters - the specialists the plan
 * scheduled, those that finished (a task's final attempt), the degraded notices and the partial result - and `projectRunView` ONE
 * additive status line, null for every run that carried no orchestration event (every single-agent run is unchanged). An older
 * reducer ignores the events: they change none of the answer, the notes, the label, the history or the failure, and the page's
 * pre-E2 switch has no case for them (they reach its `default`, where an older page wrote nothing and this one writes the event's
 * own run-log line). The page gains no control: the two in-place wires render text rows through the existing run-log step, and the
 * page's control markup counts are HEAD's (the B17-A inventory and the B18-D UI gates run as gates beside this suite).
 * [B21 E2 fix] Case 6 records what an OLDER v1 page loses (coverage-3, tests-4); case 7 pins the finished counter on a task's final
 * outcome over the scheduler's closing events (tests-2, coverage-6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORCHESTRATION_RUN_EVENT_TYPES, isOrchestrationRunEventType, type AgentRunEvent } from "@/app/lib/agent/contracts";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { MAX_ORCHESTRATION_LINE_CHARS, ORCHESTRATION_STATUS_PREFIX, initialRunView, orchestrationRunLogLine, orchestrationStatusLine, projectRunView, reduceRunView, type RunViewState } from "@/app/lib/project/chat-run-view";
import { RUN_EVENT_TRACE_TYPES, degradedEvent, notRunAgainEvent, orchestrationRunEventIssue, partialResultEvent, planEvent, specialistFinishedEvent, staleResultEvent } from "../run-events";
import { E2_RUN_ID, runE2Dag, schedulerLines } from "./_e2-fixtures";
import { coordinatorContext } from "./_merge-fixtures";

const ROOT = process.cwd();
/** the chat protocol version the route streams (read from its source: no route module is loaded here) */
const CHAT_PROTOCOL_VERSION = Number(/^export const CHAT_PROTOCOL_VERSION = (\d+);$/m.exec(readFileSync(join(ROOT, "app/api/chat/route.ts"), "utf8"))?.[1]);
const PRE_E2_FIELDS = ["answer", "interim", "pendingExecutions", "resolvedExecutions", "pendingReviews", "terminal", "failure", "receivedExecutions", "droppedExecutions", "failedAttempts"] as const;
const fold = (events: ReadonlyArray<Record<string, unknown>>): RunViewState => events.reduce(reduceRunView, initialRunView());
const pre = (state: RunViewState): Record<string, unknown> => Object.fromEntries(PRE_E2_FIELDS.map((key) => [key, state[key]]));
const record = (events: readonly AgentRunEvent[]): Array<Record<string, unknown>> => events.map((event) => JSON.parse(JSON.stringify({ v: CHAT_PROTOCOL_VERSION, seq: 0, ...event })) as Record<string, unknown>);
/** a B18-D-shaped single-agent stream: an interim note beside a read, a refused call, the final answer, the terminal */
const SINGLE: Array<Record<string, unknown>> = [
  { type: "run_started", runId: E2_RUN_ID, provider: "openai" },
  { type: "text_delta", text: "(interim) reading the board", phase: "interim" },
  { type: "tool_finished", title: "Inspect board", tier: 0, ok: true, status: "succeeded" },
  { type: "tool_refused", title: null, tier: null, status: "unknown_tool" },
  { type: "text_delta", text: "The board has two footprints.", phase: "final" },
  { type: "run_completed", runId: E2_RUN_ID, finalText: "The board has two footprints.", steps: 2, toolCalls: 1, usage: { inputTokens: 1, outputTokens: 1 }, model: "m" },
];

vi.stubGlobal("fetch", () => { throw new Error("no network"); });
beforeEach(() => resetAdmissionControl());
afterEach(() => resetAdmissionControl());

describe("[B21 E2] the run view: pure counters and one status line (OD-126, OD-127)", () => {
  it("1. over the REAL scheduler's events (a retried task, a role with no tools) plus the runtime's partial result: scheduled from the plan, finished counting each task's FINAL attempt only, one degraded notice, the partial result - and the ONE status line says exactly that", async () => {
    const run = await runE2Dag(["circuit-topology", "component-sourcing-evidence", "verification-critic"], { "circuit-topology": { kind: "throw-once", reason: "network" } }, { context: coordinatorContext({ componentAuthority: undefined }) });
    const partial = partialResultEvent(E2_RUN_ID, { planned: 3, tasks: run.ran!.tasks, notStarted: run.ran!.notStarted, handedOn: true })!; // [B21 E2 fix: regressions-1] the not-started tasks as a list
    const state = fold([{ type: "run_started" }, ...record(run.events), ...record([partial]), { type: "run_completed" }]);
    expect(state).toMatchObject({ orchestrated: true, specialistsScheduled: 2, specialistsFinished: 2, specialistsDegraded: 1, partialResult: { usable: 2, planned: 3 } });
    expect(projectRunView(state).status).toBe(`${ORCHESTRATION_STATUS_PREFIX}2 scheduled · 2 finished · degraded mode (1 notice in the log above) · partial result: 2 of 3 usable`);
    expect(orchestrationStatusLine(state)).toBe(projectRunView(state).status);
    // a clean run: no degraded clause, no partial clause
    const clean = await runE2Dag(["verification-critic"]);
    expect(projectRunView(fold(record(clean.events))).status).toBe(`${ORCHESTRATION_STATUS_PREFIX}1 scheduled · 1 finished`);
    // two notices are plural
    expect(orchestrationStatusLine(fold(record([degradedEvent(E2_RUN_ID, "provider_paused", "a"), degradedEvent(E2_RUN_ID, "provider_paused", "b")])))).toBe(`${ORCHESTRATION_STATUS_PREFIX}0 scheduled · 0 finished · degraded mode (2 notices in the log above)`);
  });

  it("2. an older reducer ignores the events: interleaving every orchestration event into a single-agent stream leaves every pre-E2 field of the state and the whole projection but its status line identical - the answer, the notes, the label, the history and the failure; a run with no orchestration event has no status line", async () => {
    const run = await runE2Dag(["verification-critic", "circuit-topology"], { "circuit-topology": { kind: "throw", reason: "insufficient_quota" } });
    const orchestration = record(run.events);
    expect(orchestration.map((event) => event.type)).toEqual(expect.arrayContaining(["plan", "specialist_started", "specialist_finished"]));
    const mixed = [SINGLE[0]!, ...orchestration.slice(0, 2), SINGLE[1]!, SINGLE[2]!, ...orchestration.slice(2), SINGLE[3]!, ...record([degradedEvent(E2_RUN_ID, "provider_outage", "x"), partialResultEvent(E2_RUN_ID, { planned: 2, tasks: [], notStarted: [{ taskId: "task-1-verification-critic" }, { taskId: "task-2-circuit-topology" }], handedOn: false /* [B21 E2 fix: regressions-1] a list */ })!]), SINGLE[4]!, SINGLE[5]!];
    const without = fold(SINGLE);
    const withEvents = fold(mixed);
    expect(pre(withEvents)).toEqual(pre(without));
    const { status, ...projection } = projectRunView(withEvents);
    const { status: none, ...baseline } = projectRunView(without);
    expect(projection).toEqual(baseline);
    expect(none).toBeNull();
    expect(status).toMatch(/^Specialists: /);
    // step by step: each orchestration event changes no pre-E2 field
    let state = fold(SINGLE.slice(0, 3));
    for (const event of orchestration) {
      const next = reduceRunView(state, event);
      expect(pre(next), String(event.type)).toEqual(pre(state));
      state = next;
    }
    // forged counters are ignored, never trusted: a negative, fractional or huge figure, a missing runsAgain
    const forged = fold([{ type: "plan", scheduled: -1 }, { type: "plan", scheduled: 2.5 }, { type: "partial_result", usable: 1e9, planned: 2 }, { type: "partial_result", usable: 2, planned: 2 }, { type: "specialist_finished" }]);
    expect(forged).toMatchObject({ orchestrated: true, specialistsScheduled: 0, specialistsFinished: 0, partialResult: null });
  });

  it("3. the pin that the older PAGE ignores them too: the NDJSON envelope stays protocol 1; the page's applyAgentEvent switch has no case for any of the five (they reach its `default`, where HEAD wrote nothing); its default renders only the event's own run-log line; the status line is written once, before the notes", () => {
    expect(CHAT_PROTOCOL_VERSION).toBe(1);
    const page = readFileSync(join(ROOT, "app/page.tsx"), "utf8");
    const start = page.indexOf("const applyAgentEvent = (event: Record<string, unknown>): void => {");
    const end = page.indexOf("while (true) {", start);
    expect(start).toBeGreaterThan(0);
    const body = page.slice(start, end);
    const cases = [...body.matchAll(/^\s*case "([a-z_]+)":/gm)].map((match) => match[1]!);
    expect(cases).toEqual(["text_delta", "tool_started", "tool_finished", "tool_refused", "proposal_ready", "pcb_proposal_ready", "generation_proposal_ready", "view_command_ready", "layout_candidate_ready", "stackup_candidate_ready", "draft_request_ready", "module_contracts_ready", "execution_grant_ready", "execution_settled", "warning", "run_failed"]); // [PR-G, 2026-10-17] pin move (OD-248, OD-249): + stackup_candidate_ready (beside layout_candidate_ready: the PCB editor's preview, Accept = the Stackup selector's own commit), draft_request_ready (a review-task card whose one action opens the existing publication request prefilled) and module_contracts_ready (a collapsible engineering-note card, no apply) - each through its SAFE receiver in app/lib/project; [PR-D, 2026-10-17] pin move (OD-246): + generation_proposal_ready, the page's intake of the agent's Build-mode generation proposal (sirkit.schematic.generate-proposal, OD-243) - a case beside pcb_proposal_ready's that offers the verified sealed proposal in the existing review dialog; still no case for any of the five orchestration events (asserted next)
    for (const type of ORCHESTRATION_RUN_EVENT_TYPES) expect(cases).not.toContain(type);
    expect(body).toMatch(/default:\n\s*\{ const line = orchestrationRunLogLine\(event\); if \(line\) appendActivityStep\(logId, line\.text, line\.status\); return; \}/);
    expect(page.match(/orchestrationRunLogLine\(/g)).toHaveLength(1);
    expect(page.match(/projected\.status/g)).toHaveLength(2);
    expect(page).toContain("for (const note of [...(projected.status ? [projected.status] : []), ...projected.notes]) appendActivityStep(logId, note, \"done\");");
  });

  it("4. the run-log line of an event is its own server sentence (running for a specialist that just started, done otherwise), bounded; any other event, a missing or empty message gives no line", () => {
    expect(orchestrationRunLogLine({ type: "specialist_started", message: "Orchestration: specialist schematic started." })).toEqual({ text: "Orchestration: specialist schematic started.", status: "running" });
    for (const type of ["plan", "specialist_finished", "partial_result", "degraded"]) expect(orchestrationRunLogLine({ type, message: ` line ${type} ` })).toEqual({ text: `line ${type}`, status: "done" });
    expect(orchestrationRunLogLine({ type: "degraded", message: "x".repeat(5_000) })!.text).toHaveLength(MAX_ORCHESTRATION_LINE_CHARS);
    for (const event of [{ type: "warning", message: "w" }, { type: "run_completed", message: "m" }, { type: "plan" }, { type: "plan", message: 7 }, { type: "degraded", message: "   " }, { type: "specialist_spawned", message: "m" }]) expect(orchestrationRunLogLine(event), JSON.stringify(event)).toBeNull();
  });

  it("5. no new control (OD-127): the page's control markup counts are HEAD's (recorded from 3a32317), the E2 wires are text rows through the existing run-log step, and the chat components are untouched", () => {
    const page = readFileSync(join(ROOT, "app/page.tsx"), "utf8");
    const counts = Object.fromEntries(["onClick=", "<button", "<input", "<select", "onChange=", "<textarea"].map((token) => [token, page.split(token).length - 1]));
    expect(counts).toEqual({ "onClick=": 85, "<button": 42, "<input": 3, "<select": 2, "onChange=": 19, "<textarea": 0 }); // [PR-G, 2026-10-17] pin move: onClick= 82 -> 85, <button 41 -> 42 - the draft-request review card's one `<Button>` ("Open the publication request", `draft-request-open`, view: opens the existing publication request prefilled), the module-contract note's `<button>` collapse (`module-note-toggle`, view) and the draft-request publication dialog's Close `<Button>` (view.page-dismiss); inventoried by B17-A 640/65 -> 646/66 with StackupCandidatePanel's two sites (Accept = pcb.board-geometry through the editor's own stackup path; Discard = view); nothing orchestration-related; [PR-F, 2026-10-17] pin move: onClick= 81 -> 82, <button 40 -> 41 - the Build sidebar's "Missing parts (N)" line (`missing-parts-open`, a view control: opens the PCB tab's Missing parts list; inventoried by B17-A, 636/64 -> 640/65 with the list's own three sites), nothing orchestration-related; [PR-D, 2026-10-17] pin move: onClick= 77 -> 81, <button 38 -> 40 - HEAD's counts since PR-E 390afa4 (the settings dialog and the entry action, inventoried there: the B17-A summary 630/64 -> 636/64; PR-C 6bdd7f7 had moved the inventory 628/63 -> 630/64 with these counts unchanged); PR-D's generation-proposal intake (OD-246) adds no control markup and the B17-A inventory is byte-identical to HEAD
    for (const line of page.split("\n").filter((text) => text.includes("[B21 E2]"))) expect(line, line.slice(0, 80)).not.toMatch(/<[A-Za-z]|onClick|onChange|disabled=/);
    expect(page.split("\n").filter((text) => text.includes("[B21 E2]"))).toHaveLength(2);
    for (const file of ["AutonomyModeControl.tsx", "ExecutionEntryActions.tsx", "ChatMarkdown.tsx"]) expect(readFileSync(join(ROOT, "app/components/chat", file), "utf8"), file).not.toMatch(/orchestration|specialist/i);
  });

  it("6. [B21 E2 fix: coverage-3, tests-4] what an OLDER v1 page loses (RECORDED as OD-126's owner question, never called harmless): a pre-E2 page renders a warning as a run-log row and ignores an unknown type (its `default`), so over HEAD's stream - B21-B's plan, status and stand-down lines as warnings - it showed every line, and over E2's stream it shows only the warnings left: it loses exactly the lines the plan, specialist_finished and degraded events now carry, and protocol version 1 cannot tell it; this page renders every one of them, plus the started and partial-result lines", async () => {
    const run = await runE2Dag(["circuit-topology", "verification-critic"], { "verification-critic": { kind: "call-unknown" } });
    const partial = partialResultEvent(E2_RUN_ID, { planned: 3, tasks: run.ran!.tasks, notStarted: [{ taskId: "task-3-schematic" }], handedOn: false })!;
    const standDown = degradedEvent(E2_RUN_ID, "provider_outage", "Orchestration: the provider failed during the specialists (provider_outage); no follow-up turn was made and the assistant's answer above stands. 2 specialist result(s) are committed in the record.");
    const e2: Array<Record<string, unknown>> = record([...run.events, standDown, partial]);
    const traced = (event: Record<string, unknown>): boolean => (RUN_EVENT_TRACE_TYPES as readonly unknown[]).includes(event.type);
    // HEAD's stream: B21-B's lines were warnings carrying the same sentences; no started or partial-result event existed
    const head = e2.flatMap((event) => (traced(event) ? [{ type: "warning", runId: E2_RUN_ID, message: event.message }] : isOrchestrationRunEventType(event.type) ? [] : [event]));
    /** HEAD's applyAgentEvent: a warning is a run-log row; the five reach its `default`, which wrote nothing */
    const olderPage = (events: ReadonlyArray<Record<string, unknown>>): string[] => events.flatMap((event) => (event.type === "warning" ? [String(event.message)] : []));
    const thisPage = (events: ReadonlyArray<Record<string, unknown>>): string[] => events.flatMap((event) => (event.type === "warning" ? [String(event.message)] : [orchestrationRunLogLine(event)?.text ?? []].flat()));
    expect(olderPage(head)).toEqual(schedulerLines(e2));
    const lost = olderPage(head).filter((line) => !olderPage(e2).includes(line));
    expect(lost).toEqual(e2.filter(traced).map((event) => String(event.message)));
    expect(lost.length).toBeGreaterThanOrEqual(4);
    expect(olderPage(e2)).toEqual(["Orchestration: specialist verification-critic (task task-2-verification-critic, attempt 0) tool (unknown) refused: unknown_tool."]);
    expect(thisPage(e2)).toEqual(expect.arrayContaining(olderPage(head)));
    expect(thisPage(e2).filter((line) => !olderPage(head).includes(line))).toEqual(e2.filter((event) => event.type === "specialist_started" || event.type === "partial_result").map((event) => String(event.message)));
    expect(CHAT_PROTOCOL_VERSION).toBe(1);
  });

  it("7. [B21 E2 fix: tests-2, coverage-6] the finished counter counts a task by its FINAL outcome: a promised retry the scheduler withheld is closed by a final escalated event (counted once); a stale committed result that was not run again is closed as `stale` (not finished: the partial result counts it not started); a retried-then-accepted task once; a replay once", () => {
    const retried = { taskId: "task-1-circuit-topology", role: "circuit-topology" as const, attempt: 0, status: "escalated" as const, reason: "provider_network: the specialist run failed before a result (retrying once)", resultDigest: null, provider: "openai" as const, model: "scripted-e2" };
    const promised = specialistFinishedEvent(E2_RUN_ID, retried, "Orchestration: specialist circuit-topology escalated (task task-1-circuit-topology, attempt 0): provider_network: the specialist run failed before a result (retrying once).", true);
    const stale = staleResultEvent(E2_RUN_ID, { taskId: "task-2-verification-critic", role: "verification-critic", attempt: 0, resultDigest: "eng1-0123456789abcdef", reason: "stale_scope: moved" }, "Orchestration: specialist verification-critic committed result (task task-2-verification-critic, attempt 0, result eng1-0123456789abcdef) is STALE - it was produced against another scope or revision, or the merge judged it stale or expired; the task runs again.");
    const plan = planEvent({ runId: E2_RUN_ID, rule: "b21-e2-fixture", tasks: [{ taskId: "task-1-circuit-topology", role: "circuit-topology" }, { taskId: "task-2-verification-critic", role: "verification-critic" }], scheduled: 2, notRun: 0, parallelism: 1, wallTimeMs: 300_000, outputTokenCeiling: 1, message: "Orchestration: 2 specialist(s) scheduled after this turn." });
    const closedRetry = notRunAgainEvent(promised, "deadline");
    const closedStale = notRunAgainEvent(stale, "deadline");
    for (const event of [promised, stale, closedRetry, closedStale]) expect(orchestrationRunEventIssue(event), event.message).toBeNull();
    expect(closedRetry).toMatchObject({ status: "escalated", runsAgain: false, attempt: 0, provider: "openai", reason: retried.reason, message: "Orchestration: specialist circuit-topology (task task-1-circuit-topology) was not run again (deadline); attempt 0 stands escalated." });
    expect(closedStale).toMatchObject({ status: "stale", runsAgain: false, provider: null, message: "Orchestration: specialist verification-critic (task task-2-verification-critic) was not run again (deadline); its committed result (attempt 0) stays stale and is not handed on." });
    expect(fold(record([plan, promised, closedRetry, stale, closedStale]))).toMatchObject({ specialistsScheduled: 2, specialistsFinished: 1 });
    const accepted = specialistFinishedEvent(E2_RUN_ID, { ...retried, attempt: 1, status: "accepted", reason: null, resultDigest: "eng1-0123456789abcdef" }, "Orchestration: specialist circuit-topology accepted (task task-1-circuit-topology, attempt 1, result eng1-0123456789abcdef).");
    const replayed = specialistFinishedEvent(E2_RUN_ID, { ...retried, taskId: "task-2-verification-critic", role: "verification-critic", status: "replayed", reason: null, resultDigest: "eng1-0123456789abcdef" }, "Orchestration: specialist verification-critic replayed from the record (task task-2-verification-critic, attempt 0, result eng1-0123456789abcdef); it did not run again.");
    expect(fold(record([plan, promised, accepted, replayed]))).toMatchObject({ specialistsFinished: 2 });
  });
});
