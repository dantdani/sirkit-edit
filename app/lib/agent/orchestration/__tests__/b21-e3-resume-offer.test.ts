/**
 * [B21 E3] "Resume" on the chat surface is a RUN-LOG LINE, never a control (OD-127; the B17-A inventory and the B18-D gates untouched):
 * the page folds the stream into a small observation beside the run view (a `plan` event: the record exists; a stand-down `degraded`
 * reason: the follow-up turn did not answer), and a DAG run that ended without its follow-up's answer - stood down, stopped, cut or
 * cancelled - leaves ONE offer line naming its run id (the `X-Sirkit-Run-Id` the route issued). The human's next send of the SAME
 * message on the SAME provider in the SAME project and branch - the composer's send or the recovery card's Retry, which is the same
 * `send(text)` - carries `resumeRunId` and opens its run log with one resuming line; anything else is a new run, and the offer is spent
 * by any send - except a resume the route refused only for now (another request of the run still holds it, or its record could not be
 * read), which keeps it. A DAG run that is never resumable offers nothing. No network, no model.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEGRADED_REASONS } from "@/app/lib/agent/contracts";
import {
  CHAT_RESUME_STAND_DOWN_REASONS, CHAT_RESUME_TRANSIENT_REFUSALS, chatResumeFor, chatResumeKeptAfter, chatResumeOfferLine, chatResumingLine, initialChatResumeObservation, observeChatResume, resumableChatRun, restoredChatResume, type ChatResumeObservation,
} from "@/app/lib/project/chat-run-view";
import { CHAT_RESUME_REFUSALS } from "@/app/api/chat/orchestration-runtime";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const RUN = "run-0e3c0000-0000-4000-8000-000000000001";
const SENT = { text: "Replace the NE555 timer U1 with a lower-power timer.", provider: "openai", projectId: "project-1", branchId: "main" };
const fold = (events: Array<Record<string, unknown>>): ChatResumeObservation => events.reduce(observeChatResume, initialChatResumeObservation());
const PLAN = { type: "plan", message: "Orchestration: 4 specialist(s) scheduled after this turn" };
const degraded = (reason: string): Record<string, unknown> => ({ type: "degraded", reason, message: `Orchestration: ${reason}` });

describe("[B21 E3] the resume offer is a run-log line", () => {
  it("1. the stand-down reasons ARE the runtime's: every reason `runOrchestratedChat` stands down with (its `down(...)` calls), each a member of the closed degraded vocabulary; a notice that does not end the run is not one", () => {
    const runtime = read("app/api/chat/orchestration-runtime.ts");
    const downs = [...new Set([...runtime.matchAll(/down\("([a-z_]+)"/g)].map((match) => match[1]!))].sort();
    expect([...CHAT_RESUME_STAND_DOWN_REASONS].sort()).toEqual(downs);
    for (const reason of CHAT_RESUME_STAND_DOWN_REASONS) expect((DEGRADED_REASONS as readonly string[]).includes(reason), reason).toBe(true);
    for (const notice of ["role_has_no_tools", "compatible_fallback", "coordinator_artifact_held"]) expect((CHAT_RESUME_STAND_DOWN_REASONS as readonly string[]).includes(notice), notice).toBe(false);
  });

  it("2. a DAG run that ended WITHOUT its follow-up's answer is resumable - stood down (any stand-down reason), stopped, cut or cancelled after its plan; a run whose follow-up answered, a single-agent run, a first turn that failed before any plan, a notice that is not a stand-down, and a run id the route could not have issued are not", () => {
    const ending = (terminal: "completed" | "failed" | null, runId: string | null = RUN) => ({ terminal, runId, ...SENT });
    for (const reason of CHAT_RESUME_STAND_DOWN_REASONS) expect(resumableChatRun(fold([PLAN, degraded(reason), { type: "run_completed" }]), ending("completed")), reason).toEqual({ runId: RUN, ...SENT });
    expect(resumableChatRun(fold([PLAN, { type: "run_failed", reason: "cancelled" }]), ending("failed"))).toEqual({ runId: RUN, ...SENT }); // Stop, a cut stream, a cancelled DAG
    expect(resumableChatRun(fold([PLAN]), ending(null))).toEqual({ runId: RUN, ...SENT }); // a stream that ended before its terminal (the page synthesizes the failure)
    expect(resumableChatRun(fold([PLAN, { type: "run_completed" }]), ending("completed"))).toBeNull(); // the follow-up answered: the run is finished
    expect(resumableChatRun(fold([PLAN, degraded("coordinator_artifact_held"), degraded("compatible_fallback"), degraded("role_has_no_tools")]), ending("completed"))).toBeNull();
    expect(resumableChatRun(fold([{ type: "text_delta", text: "hi" }]), ending("completed"))).toBeNull(); // a single-agent run
    expect(resumableChatRun(fold([degraded("no_specialist_ran")]), ending("completed"))).toBeNull(); // no plan: nothing was recorded to resume
    expect(resumableChatRun(fold([{ type: "run_failed", reason: "provider_overloaded" }]), ending("failed"))).toBeNull(); // the first turn failed: no plan
    for (const runId of [null, "run-1", RUN.toUpperCase(), `${RUN} `, "task-1-schematic"]) expect(resumableChatRun(fold([PLAN, degraded("follow_up_failed")]), ending("completed", runId)), String(runId)).toBeNull();
    // the fold ignores everything else and never throws on a malformed event
    expect(fold([{ type: "plan" }, { type: "degraded" }, { type: "degraded", reason: 7 }, {}])).toEqual({ planned: true, stoodDown: false });
  });

  it("3. the next send resumes ONLY the same message on the same provider in the same project and branch; it carries the run id and ONE resuming line; the offer line names the run id and says what is replayed; neither line is a control", () => {
    const offer = resumableChatRun(fold([PLAN, degraded("provider_outage")]), { terminal: "completed", runId: RUN, ...SENT });
    expect(chatResumeFor(offer, SENT)).toEqual({ runId: RUN, line: chatResumingLine(RUN) });
    for (const [label, next] of [["another message", { ...SENT, text: "Replace U1." }], ["another provider", { ...SENT, provider: "anthropic" }], ["another project", { ...SENT, projectId: "project-2" }], ["another branch", { ...SENT, branchId: "feature" }]] as const) {
      expect(chatResumeFor(offer, next), label).toBeNull();
    }
    expect(chatResumeFor(null, SENT)).toBeNull();
    expect(chatResumeOfferLine(RUN, SENT.provider)).toContain(RUN);
    expect(chatResumeOfferLine(RUN, SENT.provider)).toMatch(/send the same message again/i);
    expect(chatResumeOfferLine(RUN, SENT.provider)).toMatch(/replayed from the record/);
    expect(chatResumingLine(RUN)).toContain(RUN);
    expect(chatResumingLine(RUN)).toMatch(/replayed from the record/);
    for (const line of [chatResumeOfferLine(RUN, SENT.provider), chatResumingLine(RUN)]) expect(line).not.toMatch(/<|button|click/i);
  });

  it("4. the page's wiring: it reads the run id the route issued, folds the observation beside the run view, appends the offer line after the status line and the resuming line before \"Calling assistant\", sends `resumeRunId` only from `chatResumeFor`, spends the offer on every send and clears it on a project switch - with no new control (no JSX was added: the Retry and the composer's send stay the only actions)", () => {
    const page = read("app/page.tsx");
    const lines = page.split(NEWLINE);
    const one = (fragment: string): number => { const found = lines.flatMap((line, index) => (line.includes(fragment) ? [index + 1] : [])); expect(found, fragment).toHaveLength(1); return found[0]!; };
    const readRunId = one('const streamRunId = res.headers.get("X-Sirkit-Run-Id");');
    const folded = one("resumeObservation = observeChatResume(resumeObservation, event);");
    expect(lines[folded - 1]).toContain("runView = reduceRunView(runView, event);");
    const offered = one("if (resumable) appendActivityStep(logId, chatResumeOfferLine(resumable.runId, resumable.provider), \"done\");");
    expect(offered).toBeGreaterThan(one("for (const note of [...(projected.status ? [projected.status] : []), ...projected.notes]) appendActivityStep(logId, note, \"done\");"));
    const resuming = one("if (chatResume) appendActivityStep(logId, chatResume.line, \"done\");");
    expect(lines[resuming - 1]).toContain('appendActivityStep(logId, "Calling assistant");');
    expect(one("...(chatResume ? { resumeRunId: chatResume.runId } : {}),")).toBeGreaterThan(resuming);
    expect(page.match(/resumeRunId/g)).toHaveLength(1);
    const spent = one("const offeredResume = resumableChatRunRef.current ?? restoredChatResume(messages, {"); // [B21 E3 fix: coverage-1] the offer read back from the saved run log when none is held in memory
    expect(lines[spent - 1]).toContain("resumableChatRunRef.current = null;");
    expect(lines[spent - 1]).toContain("const runProvider = aiBrainRef.current;");
    expect(readRunId).toBeGreaterThan(spent);
    expect(lines[one("lastAiRetryRef.current = null;") - 1]).toContain("resumableChatRunRef.current = null;");
    expect(page).toContain("const resumableChatRunRef = useRef<ResumableChatRun | null>(null);");
    // [B21 E3 fix: tests-9] no snapshot pin on the page's length: every line a page cites is checked where it is cited (this suite's page
    // case 5, the B20 page suites); the controls are the B17-A inventory's. Here: no line of E3's wiring writes JSX
    const wiring = lines.filter((line) => /resumableChatRunRef|chatResume|restoredChatResume|resumeObservation|streamRunId/.test(line));
    expect(wiring.length).toBeGreaterThanOrEqual(10);
    for (const line of wiring) expect(line, line.trim().slice(0, 80)).not.toMatch(/(?:^|[\s({>=?:,&|])<\/?[A-Za-z]/); // a JSX tag (a generic type follows an identifier)
  });

  it("5. a resume the route refuses ONLY FOR NOW keeps its offer - another request of the run still holds it (`resume_in_progress`) or its record could not be read (`resume_unavailable`), each a code of the route's closed refusals - so the next send of the same message tries the resume again; every other refusal, a body without a code and a send that was no resume spend it; the page reads the code from a CLONE of the refused response before the shared error path reads the body, only for a resume of the current scope", () => {
    const offered = resumableChatRun(fold([PLAN, degraded("follow_up_failed")]), { terminal: "completed", runId: RUN, ...SENT });
    expect([...CHAT_RESUME_TRANSIENT_REFUSALS]).toEqual(["resume_in_progress", "resume_unavailable"]);
    for (const code of CHAT_RESUME_TRANSIENT_REFUSALS) {
      expect(Object.hasOwn(CHAT_RESUME_REFUSALS, code), code).toBe(true);
      expect(chatResumeKeptAfter({ ok: false, error: "x", code }, offered), code).toBe(offered);
    }
    for (const code of Object.keys(CHAT_RESUME_REFUSALS).filter((key) => !(CHAT_RESUME_TRANSIENT_REFUSALS as readonly string[]).includes(key))) expect(chatResumeKeptAfter({ ok: false, code }, offered), code).toBeNull();
    for (const body of [null, "resume_in_progress", ["resume_in_progress"], { error: "x" }, { code: 409 }, { code: "provider_unavailable" }]) expect(chatResumeKeptAfter(body, offered), JSON.stringify(body)).toBeNull();
    expect(chatResumeKeptAfter({ code: "resume_in_progress" }, null)).toBeNull();
    const page = read("app/page.tsx").split(NEWLINE);
    const refusal = page.flatMap((line, index) => (line.includes("resumableChatRunRef.current = chatResumeKeptAfter(") ? [index + 1] : []));
    expect(refusal).toHaveLength(1);
    const line = page[refusal[0]! - 1]!;
    expect(line).toContain("if (!res.ok) { if (chatResume && scope.isCurrent()) { resumableChatRunRef.current = chatResumeKeptAfter(await res.clone().json().catch(() => null), offeredResume); if (resumableChatRunRef.current) appendActivityStep(logId, chatResumeOfferLine(resumableChatRunRef.current.runId, resumableChatRunRef.current.provider), \"done\"); } await throwAiResponseError(res,");
    expect(page[refusal[0]!]).toContain('if (!res.body) throw new Error("No response body"); const streamRunId = res.headers.get("X-Sirkit-Run-Id");');
  });

  it("6. [B21 E3 fix: coverage-1] the offer SURVIVES a reload and a project switched back to: the run log is saved with the project, so when no offer is held in memory the next send reads the LATEST chat send's log back - its offer line names the run id and the provider, the user message before it is the text - and the same message resumes; a later chat send supersedes it whatever its outcome, another kind of log after it does not; an interrupted send, a forged run id or no user message offers nothing; a kept offer is said again in the refused send's own log", () => {
    const scope = { projectId: SENT.projectId, branchId: SENT.branchId };
    const offer = chatResumeOfferLine(RUN, SENT.provider);
    const saved = [
      { id: "u1", role: "user", content: "an earlier message" },
      { id: "l1", role: "log", title: "Working", status: "done", entries: [{ id: "e1", text: "Submitting message", status: "done" }, { id: "e2", text: "Calling assistant", status: "done" }] },
      { id: "u2", role: "user", content: SENT.text },
      { id: "l2", role: "log", title: "Working", status: "done", entries: [{ id: "e3", text: "Submitting message", status: "done" }, { id: "e4", text: "Calling assistant", status: "done" }, { id: "e5", text: "Orchestration: 4 specialist(s) scheduled after this turn", status: "done" }, { id: "e6", text: offer, status: "done" }] },
      { id: "a2", role: "assistant", content: "(the coordinator's first answer)" },
    ];
    const restored = restoredChatResume(saved, scope);
    expect(restored).toEqual({ runId: RUN, ...SENT });
    expect(chatResumeFor(restored, SENT)).toEqual({ runId: RUN, line: chatResumingLine(RUN) });
    expect(chatResumeFor(restoredChatResume(saved, scope), { ...SENT, provider: "anthropic" })).toBeNull(); // the provider the line names is the run's
    expect(restoredChatResume(saved, { ...scope, projectId: "project-2" })).toEqual({ runId: RUN, ...SENT, projectId: "project-2" }); // bound to the project whose log it is
    expect(restoredChatResume([...saved, { id: "l3", role: "log", title: "Generating", status: "done", entries: [{ id: "e7", text: "Generating schematic", status: "done" }] }], scope)).toEqual({ runId: RUN, ...SENT });
    const later = [...saved, { id: "u3", role: "user", content: "Something else." }, { id: "l4", role: "log", title: "Working", status: "error", entries: [{ id: "e8", text: "Submitting message", status: "done" }, { id: "e9", text: "Calling assistant", status: "error" }] }];
    expect(restoredChatResume(later, scope)).toBeNull();
    const interrupted = [...saved.slice(0, 3), { id: "l2", role: "log", title: "Working", status: "error", entries: [{ id: "e3", text: "Submitting message (interrupted by reload)", status: "error" }] }];
    expect(restoredChatResume(interrupted, scope)).toBeNull();
    const withLine = (line: string) => [...saved.slice(0, 3), { ...saved[3]!, entries: [{ id: "e3", text: "Submitting message", status: "done" }, { id: "e6", text: line, status: "done" }] }];
    for (const forged of [offer.replace(RUN, "run-1"), offer.replace(RUN, RUN.toUpperCase()), `(quoted) ${offer}`, offer.replace("Resume: ", "Resume:")]) {
      expect(restoredChatResume(withLine(forged), scope), forged.slice(0, 60)).toBeNull();
    }
    expect(restoredChatResume(withLine(offer), scope)).toEqual({ runId: RUN, ...SENT });
    expect(restoredChatResume(saved.slice(3), scope)).toBeNull(); // no user message before the log
    expect(restoredChatResume([], scope)).toBeNull();
    // the page consults it only when no offer is held in memory, and says a kept offer again in the refused send's log
    const page = read("app/page.tsx");
    expect(page.match(/restoredChatResume\(/g)).toHaveLength(1);
    expect(page).toContain("const offeredResume = resumableChatRunRef.current ?? restoredChatResume(messages, { projectId: projectScopeRegistryRef.current?.current.projectId ?? \"local\", branchId: projectScopeRegistryRef.current?.current.branchId ?? \"local\" });");
    expect(page.match(/chatResumeOfferLine\(/g)).toHaveLength(2);
  });

  it("7. [B21 E3 fix: coverage-4] the offer and resuming lines are TRUE whatever the resume finds: the first answer is replayed unless the record withheld it ([B21 E3 lead]), a committed specialist result only while it is still current - one whose design, selection or seal lifetime moved runs again, paid, as does one that did not finish; neither line promises that nothing is re-run or re-paid", () => {
    const offer = chatResumeOfferLine(RUN, "anthropic");
    expect(offer.startsWith(`Resume: send the same message again on anthropic to resume run ${RUN} - `)).toBe(true);
    for (const line of [offer, chatResumingLine(RUN)]) {
      expect(line).toMatch(/first answer is replayed from the record unless the record withheld it, /); expect(line).not.toMatch(/always replayed/);
      expect(line).toMatch(/runs again \(paid\)/);
      expect(line).toMatch(/design, selection or seal lifetime/);
      expect(line).toMatch(/did not finish/);
      expect(line).not.toMatch(/never re-run|paid again|every committed specialist result are replayed/);
    }
  });
});
