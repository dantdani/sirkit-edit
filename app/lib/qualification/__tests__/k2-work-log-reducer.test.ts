/**
 * [K2, 2026-11-04] Section K, increment K2 (runbook K.2, K.8 item 1; OD-260 items 5, 6 and 8): the Work log's pure reducer
 * (app/lib/project/work-log.ts) and its stored contract (work-log-contract.ts), over the run events the page receives, an acquisition
 * task's public view and a design task's milestones. Pure: no network, no store, no provider.
 *
 *  1. phases keep a dispatch, a received result, a proposal, a refusal and a committed change apart; model text adds no row;
 *  2. one run per log: run_started pins it; a retired run's or another run's late event changes nothing; a replayed route sequence is dropped;
 *  3. a followed acquisition task's stored events fold in order, each once; a foreign project's or an unfollowed task's view changes nothing;
 *     a history the task's ring no longer holds is counted ("earlier steps not kept"); a blocked or waiting step names the next action;
 *  4. the bound: past 40 rows the oldest are dropped and counted; the collapsed summary counts every step and names the latest phase only;
 *  5. redaction: secret-shaped text redacted, every URL removed; the only link a row carries is a CAD source's registry documentation;
 *  6. cancellation, failure and a reload say what really happened; a stored log reads back exactly or not at all, and the project
 *     persistence validator applies the same rule;
 *  7. a design task's milestones and its remaining allowance;
 *  8. a turn that ended on the page without its run's own ending (Stop answer, a dropped stream, a failed request) says how, once; a
 *     log that has its ending, never saw its run, or follows a task only (a Build start) is unchanged - by the page and by a reload;
 *     model text, warnings and unknown types return the SAME state (no row, no re-render).
 *  9. [K2 review, 2026-11-04] honesty-K2-PT-1: a POISONED settlement, a settlement with no outcome and a retirement whose outcome nobody
 *     learned MAY have changed the board (never "nothing was changed"); not-committed and an issued grant's retirement still say it;
 * 10. [K2 review, 2026-11-04] honesty-K2-PT-2: an acquisition start that attached says the attached task's REAL state;
 * 11. [K2 review, 2026-11-04] honesty-K2-PT-3 / PT-4: orchestration - a withdrawn promise to run a task again is its own row; a compatible
 *     fallback is a changed approach, not a block;
 * 12. [K2 review, 2026-11-04] events-K2-EV-2: what happened to the page's follow of a task (a failed read, a task the server no longer has,
 *     the read bound) is said once per position, only for a live task the log follows in its own project.
 */
import { describe, expect, it } from "vitest";
import { isStoredChatMessage } from "@/lib/persistence";
import { CAD_SOURCE_REGISTRY } from "@/app/lib/acquisition/cad-source-registry";
import { CAD_ACQUISITION_TASK_REFERENCE_SCHEMA, type CadAcquisitionEvent, type CadAcquisitionTaskView } from "@/app/lib/acquisition/cad-acquisition-contract";
import { OUTCOME_UNKNOWN_RETIREMENT_REASONS } from "@/app/lib/engineering/execution-grant";
import { degradedEvent, notRunAgainEvent, staleResultEvent } from "@/app/lib/agent/orchestration/run-events";
import { toolLineLabel } from "@/app/lib/project/chat-run-view";
import {
  WORK_LOG_BOUNDS, WORK_LOG_PHASES, emptyWorkLog, isStoredWorkLog, liveWorkLogFollows, noteWorkLogFollow, readStoredWorkLog, reduceWorkLogAcquisition, reduceWorkLogGeneration, reduceWorkLogRunEvent,
  restoredWorkLog, workLogSummary, workLogText, workOfStored, endWorkLogRun, type WorkLogState,
} from "@/app/lib/project/work-log";

const OWNER = { projectId: "project-k2", branchId: "main" } as const;
const TASK_ID = `cr-task:${"a".repeat(32)}`;
const fold = (state: WorkLogState, events: ReadonlyArray<Record<string, unknown>>): WorkLogState => events.reduce(reduceWorkLogRunEvent, state);
const started = (runId = "run-k2", seq = 1) => ({ type: "run_started", runId, provider: "openai", seq });
const reference = (overrides: Record<string, unknown> = {}) => ({ schema: CAD_ACQUISITION_TASK_REFERENCE_SCHEMA, taskId: TASK_ID, disposition: "started", scope: { ...OWNER }, state: "queued", stage: "local-search", nextAction: "wait", refDes: ["D1", "D2"], durability: "process-memory", ...overrides });

function taskView(events: CadAcquisitionEvent[], overrides: Partial<CadAcquisitionTaskView> = {}): CadAcquisitionTaskView {
  return {
    schema: "sirkit.component-resolution-task.v1", taskId: TASK_ID, state: "running", stage: "retrieve", stages: [],
    targets: [{ componentId: "kc-1", refDes: "D1", value: "1N4001", catalogPartId: "p", symbol: "Diode:1N4001", footprint: null, exactMpn: null }, { componentId: "kc-2", refDes: "D2", value: "1N4001", catalogPartId: "p", symbol: "Diode:1N4001", footprint: null, exactMpn: null }],
    requirement: {}, attempts: [], candidate: null, handoff: null, publication: null, proposal: null, applied: null, preflight: null, blocker: null, nextAction: "wait",
    events, createdAt: "2026-11-04T10:00:00.000Z", updatedAt: "2026-11-04T10:00:05.000Z", ...overrides,
  };
}
const event = (seq: number, kind: CadAcquisitionEvent["kind"], message: string, data?: CadAcquisitionEvent["data"]): CadAcquisitionEvent => ({ seq, at: `2026-11-04T10:00:0${seq % 10}.000Z`, kind, message, ...(data ? { data } : {}) });
const followed = (): WorkLogState => fold(emptyWorkLog(OWNER), [started(), { type: "acquisition_task_ready", runId: "run-k2", seq: 2, toolId: "sirkit.parts.acquisition-start", callId: "c1", task: reference() }]);

describe("[K2] the Work log reducer", () => {
  it("1. phases keep a dispatch, a received result, a proposal, a refusal and a committed change apart; model text (interim or final) adds no row", () => {
    const log = fold(emptyWorkLog(OWNER), [
      started(),
      { type: "text_delta", runId: "run-k2", seq: 2, text: "I will import the footprint now.", phase: "interim" },
      { type: "tool_started", runId: "run-k2", seq: 3, callId: "c1", toolId: "sirkit.parts.candidate-search", title: "Search", tier: 0 },
      { type: "tool_finished", runId: "run-k2", seq: 4, callId: "c1", toolId: "sirkit.parts.candidate-search", title: "Search", tier: 0, ok: true, status: "succeeded" },
      { type: "tool_started", runId: "run-k2", seq: 5, callId: "c2", toolId: "sirkit.schematic.propose-component-resolution", title: "Resolve", tier: 2 },
      { type: "tool_finished", runId: "run-k2", seq: 6, callId: "c2", toolId: "sirkit.schematic.propose-component-resolution", title: "Resolve", tier: 2, ok: true, status: "proposal_sealed" },
      { type: "tool_refused", runId: "run-k2", seq: 7, callId: "c3", toolId: "sirkit.parts.acquisition-status", title: "Status", tier: 0, status: "repeated_call" },
      { type: "tool_finished", runId: "run-k2", seq: 8, callId: "c4", toolId: "x", title: "Grant", tier: 1, ok: true, status: "execution_grant_issued" },
      { type: "execution_settled", runId: "run-k2", seq: 9, toolId: "x", grantId: "g1", status: "settled", outcome: "committed", reason: null, settlement: null },
      { type: "text_delta", runId: "run-k2", seq: 10, text: "Done - the part is imported and applied.", phase: "final" },
      { type: "run_completed", runId: "run-k2", seq: 11, finalText: "Done", steps: 3, toolCalls: 4, usage: { inputTokens: 1, outputTokens: 1 }, model: "m" },
    ]);
    expect(log.rows.map((row) => row.phase)).toEqual(["dispatched", "received", "dispatched", "proposed", "refused", "dispatched", "committed"]);
    expect(log.rows[0]!.text).toBe("Searching the local library for eligible published revisions"); // the resolution tool's public line
    expect(log.rows[1]!.text).toBe("T0 · Search — done");
    expect(log.rows[3]!.text).toBe("T2 · Resolve — proposal sealed — awaiting your review");
    expect(log.rows[4]!.text).toBe("T0 · Status — refused before running (repeated_call) — nothing ran");
    expect(log.rows[6]!.text).toBe("Applied in your editor — the server recorded the committed transaction");
    expect(log.rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(JSON.stringify(log)).not.toMatch(/I will import|imported and applied/); // never model text
    expect(log.run).toBe("completed");
    expect(new Set(log.rows.map((row) => row.phase)).size).toBeGreaterThan(4);
    for (const row of log.rows) expect(WORK_LOG_PHASES).toContain(row.phase);
  });

  it("2. one run per log: run_started pins it; a retired or foreign run's late event and a replayed route sequence change nothing", () => {
    expect(reduceWorkLogRunEvent(emptyWorkLog(OWNER), { type: "tool_started", runId: "run-k2", seq: 1, callId: "c1", title: "T" })).toEqual(emptyWorkLog(OWNER)); // nothing before the run starts
    const log = fold(emptyWorkLog(OWNER), [started("run-current"), { type: "tool_started", runId: "run-current", seq: 2, callId: "c1", title: "Inspect", toolId: "t" }]);
    expect(log.owner.runId).toBe("run-current");
    const late = fold(log, [
      { type: "tool_finished", runId: "run-retired", seq: 3, callId: "c1", title: "Inspect", toolId: "t", ok: true, status: "succeeded" },
      { type: "run_started", runId: "run-other", seq: 4, provider: "openai" },
      { type: "run_failed", runId: "run-retired", seq: 5, reason: "cancelled", message: "x" },
      { type: "tool_finished", runId: "run-current", seq: 2, callId: "c1", title: "Inspect", toolId: "t", ok: true, status: "succeeded" }, // a replayed sequence
      { type: "tool_finished", runId: "run-current", callId: "c1", title: "Inspect", toolId: "t", ok: true, status: "succeeded" }, // no seq (a test double): keyed
    ]);
    expect(late.rows.map((row) => row.key)).toEqual(["run:run-current:c1:started", "run:run-current:c1:finished"]);
    expect(late.run).toBe("running");
    expect(fold(late, [{ type: "tool_finished", runId: "run-current", callId: "c1", title: "Inspect", toolId: "t", ok: true, status: "succeeded" }])).toBe(late); // a duplicate key: the same state
    expect(late.owner.runId).toBe("run-current");
  });

  it("3. a followed acquisition task's stored events fold in order, each once; a foreign project's or an unfollowed task's view changes nothing; a dropped history is counted; a blocked step names the next action", () => {
    const log = followed();
    expect(log.follows).toEqual([{ kind: "acquisition", taskId: TASK_ID, cursor: 0, terminal: false, state: "queued" }]);
    expect(log.rows.at(-1)).toMatchObject({ phase: "waiting", origin: "page", subject: "D1, D2" });
    const fixture = CAD_SOURCE_REGISTRY["fixture-kicad"].displayName;
    const first = reduceWorkLogAcquisition(log, taskView([
      event(3, "local_search", "Searching the local library for a published revision of Diode:1N4001 for D1, D2."),
      event(1, "accepted", "The acquisition task was accepted."),
      event(2, "worker_claimed", "A worker started the acquisition step (attempt 1).", { kind: "acquire", attempt: 1 }),
    ]), OWNER);
    expect(first.rows.slice(-3).map((row) => [row.phase, row.origin, row.attempt])).toEqual([["dispatched", "acquisition", null], ["dispatched", "acquisition", 1], ["dispatched", "acquisition", null]]);
    expect(first.follows[0]!.cursor).toBe(3);
    // the same view again, and an older one: nothing new
    expect(reduceWorkLogAcquisition(first, taskView([event(1, "accepted", "The acquisition task was accepted.")]), OWNER)).toBe(first); // the SAME state: a poll that saw no step re-renders nothing
    // a foreign project's answer and a task this log does not follow change nothing
    expect(reduceWorkLogAcquisition(first, taskView([event(4, "retrieved", "Retrieved 2 object(s).")]), { projectId: "another-project", branchId: "main" })).toBe(first);
    expect(reduceWorkLogAcquisition(first, taskView([event(4, "retrieved", "Retrieved 2 object(s).")], { taskId: `cr-task:${"b".repeat(32)}` }), OWNER)).toBe(first);
    // the ring dropped seq 4-5 before this log read again: counted, and the gap is said
    const later = reduceWorkLogAcquisition(first, taskView([
      event(6, "source_selected", `${fixture}: used - served the symbol and footprint`),
      event(7, "retrieved", `Retrieved 2 object(s) from ${fixture}: symbol-file sha256 0123456789ab, footprint sha256 0123456789ab.`),
      event(8, "stored", "Stored the objects."),
      event(9, "validated", "Validated the pin-to-pad mapping."),
      event(10, "awaiting_handoff", "Awaiting a person to send the package for component review (a reviewer approves; a different administrator publishes)."),
    ], { state: "awaiting-review", nextAction: "send-for-review" }), OWNER);
    expect(later.gap).toBe(true);
    expect(later.dropped).toBe(2);
    expect(later.rows.slice(-5).map((row) => row.phase)).toEqual(["dispatched", "received", "stored", "validated", "waiting"]);
    expect(later.rows.at(-4)!.source).toEqual({ label: `${fixture} - documentation`, href: CAD_SOURCE_REGISTRY["fixture-kicad"].provider.documentation[0] });
    expect(later.rows.at(-1)!.next).toBe("Send the package for component review from the Missing parts list (a person's step; two other people publish it)");
    expect(later.follows[0]).toMatchObject({ cursor: 10, terminal: false, state: "awaiting-review" });
    // a blocked task: the server's remedy is the next action
    const blocked = reduceWorkLogAcquisition(later, taskView([event(11, "blocked", "No admitted CAD source carries the symbol and footprint this part names.")], { state: "waiting-for-resource", blocker: { code: "no_matching_asset", message: "m", remedy: "Choose another package or part, or file an unverified draft request with the datasheet's pin table.", draftOffered: true, detail: null } }), OWNER);
    expect(blocked.rows.at(-1)).toMatchObject({ phase: "blocked", next: "Choose another package or part, or file an unverified draft request with the datasheet's pin table." });
    // a malformed or foreign reference is not followed (and says so)
    const foreign = fold(emptyWorkLog(OWNER), [started(), { type: "acquisition_task_ready", runId: "run-k2", seq: 2, callId: "c1", task: reference({ scope: { projectId: "another-project", branchId: "main" } }) }]);
    expect(foreign.follows).toEqual([]);
    expect(foreign.rows.at(-1)).toMatchObject({ phase: "refused", origin: "page" });
    expect(fold(emptyWorkLog(OWNER), [started(), { type: "acquisition_task_ready", runId: "run-k2", seq: 2, callId: "c1", task: { ...reference(), signedUrl: "x" } }]).follows).toEqual([]);
  });

  it("4. past 40 rows the oldest are dropped and counted ('earlier steps not kept'); the summary counts every step", () => {
    let log = fold(emptyWorkLog(OWNER), [started()]);
    for (let index = 0; index < 50; index += 1) log = reduceWorkLogRunEvent(log, { type: "tool_started", runId: "run-k2", seq: index + 2, callId: `c${index}`, title: `Step ${index}`, toolId: "t" });
    expect(log.rows).toHaveLength(WORK_LOG_BOUNDS.rows);
    expect(log.dropped).toBe(10);
    expect(log.rows[0]!.text).toBe("Step 10 — request sent; no result yet");
    expect(workLogSummary(log)).toBe("50 steps · latest: Started (this answer)"); // never a row's text again (the entry's own rows say it)
    expect(log.rows.map((row) => row.seq)).toEqual(Array.from({ length: 40 }, (_, index) => index + 11));
  });

  it("5. redaction: secret-shaped text is redacted and every URL removed; the only link a row carries is a CAD source's registry documentation", () => {
    const key = ["sk", "proj", "0123456789abcdefghij"].join("-");
    const signed = "https://cdn.example.com/kicad/1N4001.kicad_sym?X-Amz-Signature=abcdef0123456789&X-Amz-Credential=AKIA";
    expect(workLogText(`Retrieved from ${signed} with ${key} and Bearer abcdefghijklmnop`)).toBe("Retrieved from [link removed] with [redacted] and [redacted]");
    expect(workLogText("see www.example.com/private for it")).toBe("see [link removed] for it");
    const log = reduceWorkLogAcquisition(followed(), taskView([event(1, "retrieved", `Retrieved 1 object(s) from ${signed} token=${key}`)]), OWNER);
    const text = JSON.stringify(log);
    expect(text).not.toContain("X-Amz");
    expect(text).not.toContain(key);
    expect(text).not.toMatch(/https?:\/\/(?!www\.kicad\.org|gitlab\.com\/kicad)/);
    // a stored log whose link is not registry documentation does not read back
    const tampered = JSON.parse(JSON.stringify(log)) as WorkLogState;
    tampered.rows[0]!.source = { label: "evil", href: "https://evil.example.com/download" };
    expect(readStoredWorkLog(tampered)).toBeNull();
    // a stored row's text is cleaned again on every read: a URL or a secret-shaped string written into a stored log never shows
    const dirty = JSON.parse(JSON.stringify(log)) as WorkLogState;
    dirty.rows[0]!.text = `Retrieved from ${signed} with ${key}`;
    expect(readStoredWorkLog(dirty)!.rows[0]!.text).toBe("Retrieved from [link removed] with [redacted]");
    const bounded = workLogText("x".repeat(1_000));
    expect(bounded).toHaveLength(WORK_LOG_BOUNDS.textChars);
  });

  it("6. cancellation, failure and a reload say what really happened; a stored log reads back exactly or not at all; the persistence validator applies the same rule", () => {
    const cancelled = fold(followed(), [{ type: "run_failed", runId: "run-k2", seq: 3, reason: "cancelled", message: "The run was cancelled." }]);
    expect(cancelled.run).toBe("cancelled");
    expect(cancelled.rows.at(-1)).toMatchObject({ phase: "cancelled", text: "Answer stopped — the turn ended; a task it started keeps its own state below" });
    expect(liveWorkLogFollows(cancelled, "acquisition").map((entry) => entry.taskId)).toEqual([TASK_ID]); // the task is still followed
    const failed = fold(emptyWorkLog(OWNER), [started(), { type: "run_failed", runId: "run-k2", seq: 2, reason: "deadline", message: "x" }]);
    expect(failed.rows.at(-1)).toMatchObject({ phase: "blocked", next: "Send the message again, or ask the assistant to continue" });
    // a reload mid-turn: the stored rows come back, the turn says it was interrupted, nothing is replayed
    const stored = JSON.parse(JSON.stringify(followed())) as unknown;
    expect(isStoredWorkLog(stored)).toBe(true);
    const restored = workOfStored(stored).work!;
    expect(restored.run).toBe("interrupted");
    expect(restored.rows.slice(0, -1)).toEqual(followed().rows);
    expect(restored.rows.at(-1)).toMatchObject({ phase: "interrupted", origin: "page" });
    expect(restoredWorkLog(restored)).toBe(restored); // once
    expect(workOfStored(undefined)).toEqual({});
    expect(workOfStored({ schema: "sirkit.work-log.v0" })).toEqual({});
    // the persistence validator: a log entry with a valid Work log is a stored chat message; one with a malformed log is not
    const entry = { id: "log-1", role: "log", title: "Working", status: "done", entries: [{ id: "e1", text: "Submitting message", status: "done" }] };
    expect(isStoredChatMessage({ ...entry, work: stored })).toBe(true);
    expect(isStoredChatMessage(entry)).toBe(true);
    for (const bad of [{ ...(stored as object), rows: "x" }, { ...(stored as object), run: "exploded" }, { ...(stored as object), rows: [{ key: "k", seq: 1, phase: "thinking", origin: "run", text: "t" }] }]) expect(isStoredChatMessage({ ...entry, work: bad })).toBe(false);
  });

  it("7. a design task's milestones fold in order with their phases and the remaining allowance; a foreign task view changes nothing", () => {
    const view = { taskId: "generation-task:1", scope: { tenantId: "local", ...OWNER }, state: "running" as const, terminal: false, blocker: null, allowance: { units: 1, extensions: 0, maxExtensions: 4, remaining: { modelCalls: 58, outputTokens: 470_000, catalogSearches: 298 }, windowEndsAt: "2026-11-07T10:00:00.000Z" } };
    const milestones = [
      { seq: 2, at: "t", type: "plan_ready", phase: "planning", blockId: null, message: "The plan has 3 blocks." },
      { seq: 1, at: "t", type: "task_accepted", phase: null, blockId: null, message: "Accepted." },
      { seq: 3, at: "t", type: "block_saved", phase: "designing", blockId: "b1", message: "Block b1 saved." },
      { seq: 4, at: "t", type: "review_recorded", phase: null, blockId: null, message: "The reviewed design was applied." },
    ];
    const log = reduceWorkLogGeneration(emptyWorkLog(OWNER), view, milestones, false);
    expect(log.rows.map((row) => [row.phase, row.origin])).toEqual([["dispatched", "generation"], ["stored", "generation"], ["stored", "generation"], ["committed", "generation"]]);
    expect(log.rows[2]!.subject).toBe("block b1");
    expect(log.allowance).toBe("Allowance left: 58 model calls · 470,000 output tokens · 298 catalog searches (task units, not money; 0 of 4 extensions used)");
    expect(reduceWorkLogGeneration(log, view, milestones, false)).toBe(log); // each once; nothing new is the SAME state
    expect(reduceWorkLogGeneration(log, { ...view, scope: { tenantId: "local", projectId: "another-project", branchId: "main" } }, [{ seq: 9, at: "t", type: "failed", phase: null, blockId: null, message: "x" }], false)).toBe(log);
    expect(reduceWorkLogGeneration(log, view, [], true).gap).toBe(true);
  });
  it("8. a turn that ended on the page without its run's ending says how (Stop answer, a dropped stream), once; an ended, unstarted or task-only log is unchanged; model text returns the same state", () => {
    const live = followed();
    const stopped = endWorkLogRun(live, "stopped");
    expect(stopped.run).toBe("cancelled");
    expect(stopped.rows.at(-1)).toMatchObject({ phase: "cancelled", origin: "page", text: "Answer stopped by you — the turn ended before the assistant finished; a task it started keeps its own state below" });
    expect(liveWorkLogFollows(stopped, "acquisition").map((entry) => entry.taskId)).toEqual([TASK_ID]); // the task is still followed
    const cut = endWorkLogRun(live, "ended");
    expect(cut.run).toBe("interrupted");
    expect(cut.rows.at(-1)).toMatchObject({ phase: "interrupted", origin: "page", next: "Send the message again, or ask the assistant to continue" });
    expect(cut.rows.at(-1)!.text).toMatch(/^The answer ended without its final event \(the connection dropped or the request failed\)/);
    // [K2 review, 2026-11-04] tests-K2-R3, reviewed pin move: this case said "the page's own run_failed for a dropped stream reads the same
    // way" over a run_failed WITH the run's id - but the page builds its synthetic run_failed (Stop answer, a dropped stream) for its run
    // view only, without a runId, and no server emits `stream_cut` or `stopped`: those reducer branches were dead and are removed. The
    // page's synthetic event changes nothing here; the hook's endRun says those endings (in the browser: l5-chat-task 3, k2-work-log 2).
    expect(reduceWorkLogRunEvent(live, { type: "run_failed", reason: "stream_cut", message: "The connection ended before the assistant finished." })).toBe(live);
    expect(reduceWorkLogRunEvent(live, { type: "run_failed", reason: "stopped", message: "Stopped by you." })).toBe(live);
    for (const ended of [stopped, cut, fold(live, [{ type: "run_completed", runId: "run-k2", seq: 3, finalText: "x", steps: 1, toolCalls: 1, usage: { inputTokens: 1, outputTokens: 1 }, model: "m" }]), fold(live, [{ type: "run_failed", runId: "run-k2", seq: 3, reason: "deadline", message: "x" }])]) {
      expect(endWorkLogRun(ended, "ended")).toBe(ended);
      expect(endWorkLogRun(ended, "stopped")).toBe(ended);
      expect(restoredWorkLog(ended)).toBe(ended); // a reload adds nothing to a turn that has its ending
    }
    const unstarted = emptyWorkLog(OWNER);
    expect(endWorkLogRun(unstarted, "ended")).toBe(unstarted); // never saw its run: nothing to say about it
    // a task-only log (a Build start's design task: no chat turn) is not "interrupted" by a reload or a page ending
    const taskOnly = reduceWorkLogGeneration(emptyWorkLog(OWNER), { taskId: "generation-task:2", scope: { tenantId: "local", ...OWNER }, state: "running", terminal: false, blocker: null }, [{ seq: 1, at: "t", type: "task_accepted", phase: null, blockId: null, message: "Accepted." }], false);
    expect(taskOnly.owner.runId).toBeNull();
    expect(restoredWorkLog(taskOnly)).toBe(taskOnly);
    expect(workOfStored(JSON.parse(JSON.stringify(taskOnly))).work).toEqual(taskOnly);
    expect(endWorkLogRun(taskOnly, "ended")).toBe(taskOnly);
    // model text, warnings and unknown types: the SAME state (the page records nothing and re-renders nothing for them)
    for (const event of [{ type: "text_delta", runId: "run-k2", seq: 9, text: "I imported it.", phase: "final" }, { type: "warning", runId: "run-k2", seq: 10, message: "w" }, { type: "reasoning", runId: "run-k2", seq: 11, text: "x" }]) expect(reduceWorkLogRunEvent(live, event)).toBe(live);
  });

  it("9. [K2 review] a POISONED settlement, a settlement with no outcome and a retirement whose outcome nobody learned MAY have changed the board - never 'nothing was changed'; not-committed and an issued grant's retirement still say it", () => {
    const settled = (seq: number, grantId: string, status: string, outcome: string | null, reason: string | null) => ({ type: "execution_settled", runId: "run-k2", seq, toolId: "x", grantId, status, outcome, reason, settlement: null });
    const log = fold(emptyWorkLog(OWNER), [
      started(),
      settled(2, "g-poisoned", "settled", "poisoned", null),
      settled(3, "g-no-outcome", "settled", null, null),
      settled(4, "g-unsettled", "retired", null, "consumed_unsettled"),
      settled(5, "g-recovery", "retired", null, "recovery_required"),
      settled(6, "g-not-committed", "settled", "not-committed", null),
      settled(7, "g-expired", "retired", null, "expired"),
      settled(8, "g-rejected", "retired", null, "commit_rejected"),
    ]);
    const mayHaveChanged = log.rows.slice(0, 4);
    expect(mayHaveChanged.map((row) => row.phase)).toEqual(["blocked", "blocked", "blocked", "blocked"]);
    for (const row of mayHaveChanged) {
      expect(row.text).toMatch(/the board MAY have changed$/);
      expect(row.text).not.toMatch(/nothing was changed|Not applied/);
      expect(row.next).toBe("Check the board and the revision history; the editor's Undo restores the previous board."); // the execution entry's own next step
    }
    expect(mayHaveChanged[0]!.text).toBe("The change LANDED but could not be verified (the editor reported poisoned) — the board MAY have changed");
    expect(mayHaveChanged[1]!.text).toBe("The change LANDED but could not be verified (the editor reported no outcome) — the board MAY have changed");
    expect(mayHaveChanged[2]!.text).toBe("Outcome unknown — the change was started but its result was never confirmed (consumed_unsettled); the board MAY have changed");
    expect(mayHaveChanged[3]!.text).toBe("Outcome unknown — the change was started but its result was never confirmed (recovery_required); the board MAY have changed");
    expect(log.rows.slice(4).map((row) => [row.phase, row.text])).toEqual([
      ["refused", "Not applied — the editor reported not-committed; nothing was changed"],
      ["cancelled", "Not applied — the change was retired (expired); nothing was changed"],
      ["cancelled", "Not applied — the change was retired (commit_rejected); nothing was changed"],
    ]);
    expect(workLogSummary(log)).toBe("7 steps · latest: Stopped (this answer)");
    // the retry guard (app/lib/execution-grant/store.ts) reads the SAME list: what it treats as "MAY have changed" the log never calls unchanged
    expect(OUTCOME_UNKNOWN_RETIREMENT_REASONS).toEqual(["recovery_required", "consumed_unsettled"]);
  });

  it("10. [K2 review] an acquisition start that attached says the attached task's real state - waiting for a person, waiting for a source, stopping or ended is not 'already running'", () => {
    const attach = (state: string): WorkLogState => fold(emptyWorkLog(OWNER), [started(), { type: "acquisition_task_ready", runId: "run-k2", seq: 2, callId: "c1", task: reference({ disposition: "attached", state }) }]);
    const following = `Following acquisition task ${TASK_ID.slice(0, 16)}…`;
    expect(attach("running").rows.at(-1)).toMatchObject({ phase: "waiting", text: `${following} (already running; nothing new started): its recorded steps appear here as the worker reports them` });
    expect(attach("queued").rows.at(-1)!.text).toBe(`${following} (already queued for a worker; nothing new started): its recorded steps appear here as the worker reports them`);
    expect(attach("awaiting-review").rows.at(-1)).toMatchObject({ phase: "waiting", text: `${following} (already waiting for a person's step; nothing new started): its recorded steps appear here as the worker reports them` });
    expect(attach("waiting-for-resource").rows.at(-1)!.text).toBe(`${following} (already waiting for a source or its retry time; nothing new started): its recorded steps appear here as the worker reports them`);
    expect(attach("cancel-requested").rows.at(-1)!.text).toBe(`${following} (already being stopped; nothing new started): its recorded steps appear here as the worker reports them`);
    for (const state of ["succeeded", "cancelled", "failed", "stale"]) {
      const log = attach(state);
      expect(log.rows.at(-1), state).toMatchObject({ phase: "received", text: `${following} (it had already ended (${state}); nothing new started): its recorded steps appear here` });
      expect(log.follows[0], state).toMatchObject({ terminal: true, state });
    }
    for (const state of ["queued", "awaiting-review", "waiting-for-resource", "cancel-requested", "succeeded", "cancelled", "failed", "stale"]) expect(attach(state).rows.at(-1)!.text, state).not.toContain("already running");
    expect(followed().rows.at(-1)!.text).toBe(`${following} (queued for a worker): its recorded steps appear here as the worker reports them`); // a start is unchanged
    // the run line names no state (the store attaches in any state); the Work log row above says the real one
    expect(toolLineLabel({ title: "Obtain", tier: 1, ok: true, status: "acquisition_task_attached" })).toBe("T1 · Obtain — following the acquisition task that already exists for these parts — nothing new was started");
  });

  it("11. [K2 review] orchestration: a withdrawn promise to run a task again is its own row; a compatible fallback is a changed approach, not a block", () => {
    const open = staleResultEvent("run-k2", { taskId: "task-1", role: "circuit-topology", attempt: 1, resultDigest: `sha256:${"a".repeat(64)}`, reason: "stale" }, "Orchestration: specialist circuit-topology (task task-1) committed result is stale; the task runs again.");
    const withdrawn = notRunAgainEvent(open, "the DAG wall time ran out");
    expect(withdrawn.runsAgain).toBe(false);
    const log = fold(emptyWorkLog(OWNER), [started(), { ...open, seq: 2 }, { ...withdrawn, seq: 3 }, { ...withdrawn, seq: 4 }]);
    expect(log.rows.map((row) => row.text)).toEqual([open.message, withdrawn.message]); // both steps; the replayed withdrawal once
    expect(log.rows.at(-1)!.text).toMatch(/was not run again \(the DAG wall time ran out\)/);
    const fallback = degradedEvent("run-k2", "compatible_fallback", "Orchestration: specialist circuit-topology (task task-1) runs on anthropic (claude) instead of openai: a compatible fallback.", { taskId: "task-1", role: "circuit-topology", provider: "anthropic", model: "claude" });
    const paused = degradedEvent("run-k2", "provider_paused", "Orchestration: the coordinator's provider is paused; nothing more runs.");
    const degraded = fold(emptyWorkLog(OWNER), [started(), { ...fallback, seq: 2 }, { ...paused, seq: 3 }]);
    expect(degraded.rows.map((row) => row.phase)).toEqual(["intent", "blocked"]);
  });

  it("12. [K2 review] what happened to the page's follow of a task is said once per position, only for a live task the log follows in its own project", () => {
    const log = followed();
    const short = `${TASK_ID.slice(0, 16)}…`;
    const unreadable = noteWorkLogFollow(log, OWNER, TASK_ID, { kind: "unreadable", code: "NETWORK" });
    expect(unreadable.rows.at(-1)).toMatchObject({ phase: "interrupted", origin: "page", next: null, text: `Could not read acquisition task ${short} (NETWORK); this page keeps reading it - its next recorded steps appear here when a read succeeds` });
    expect(noteWorkLogFollow(unreadable, OWNER, TASK_ID, { kind: "unreadable", code: "HTTP_503" })).toBe(unreadable); // the same position: once
    const moved = reduceWorkLogAcquisition(unreadable, taskView([event(1, "accepted", "The acquisition task was accepted.")]), OWNER);
    expect(noteWorkLogFollow(moved, OWNER, TASK_ID, { kind: "unreadable", code: "NETWORK" }).rows).toHaveLength(moved.rows.length + 1); // a new position: said again
    const gone = noteWorkLogFollow(moved, OWNER, TASK_ID, { kind: "gone", code: "COMPONENT_RESOLUTION_TASK_NOT_FOUND" });
    expect(gone.rows.at(-1)).toMatchObject({ phase: "interrupted", next: "If the part is still missing, start the acquisition again from the Missing parts list" });
    expect(gone.rows.at(-1)!.text).toBe(`Acquisition task ${short} can no longer be read: the server has no such task in this project (COMPONENT_RESOLUTION_TASK_NOT_FOUND). The steps above are what was recorded; this page stopped following it`);
    const bound = noteWorkLogFollow(moved, OWNER, TASK_ID, { kind: "bound", reads: 400 });
    expect(bound.rows.at(-1)!.text).toBe(`Stopped following acquisition task ${short} on this page after 400 reads; the task itself goes on - reload the page or open the project again to read it again`);
    // a code is never a channel for text: only its identifier characters stay (no URL, nothing secret-shaped)
    const odd = noteWorkLogFollow(log, OWNER, TASK_ID, { kind: "unreadable", code: "https://evil.example.com/x?token=abc def" }).rows.at(-1)!.text;
    expect(odd).toContain("(httpsevil.example.comxtokenabcdef)");
    expect(odd).not.toMatch(/:\/\/|\?|=/);
    // another project's or branch's note, a task the log does not follow and an ended task change nothing
    expect(noteWorkLogFollow(log, { projectId: "another-project", branchId: "main" }, TASK_ID, { kind: "unreadable", code: "NETWORK" })).toBe(log);
    expect(noteWorkLogFollow(log, OWNER, `cr-task:${"b".repeat(32)}`, { kind: "gone", code: "X" })).toBe(log);
    const ended = reduceWorkLogAcquisition(log, taskView([event(1, "cancelled", "The acquisition was cancelled.")], { state: "cancelled" }), OWNER);
    expect(ended.follows[0]!.terminal).toBe(true);
    expect(noteWorkLogFollow(ended, OWNER, TASK_ID, { kind: "bound", reads: 400 })).toBe(ended);
  });
});
